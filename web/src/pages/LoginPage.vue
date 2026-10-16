<script setup lang="ts">
/**
 * 屏幕 01 · 入口（登录 / 访客 / 两步验证）
 *
 * 账号开了两步验证时，`POST /auth/login` **不回令牌**，只回一张 5 分钟有效的预认证票
 * 并把验证码发到邮箱；这一步拿票 + 码换真正的会话。也就是说：密码对了但码没过，
 * 客户端手里没有任何可用凭据 —— 否则「密码泄露」就等于「账号到手」。
 */
import { computed, onBeforeUnmount, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { api, refreshRuntimeBootstrap } from '@/app/runtime';
import { useBootstrapStore } from '@/stores/bootstrap';
import { useSessionStore } from '@/stores/session';
import { toast } from '@/services/toast';
import { check, limit } from '@/services/validate';
import type { AuthResult } from '@/api/types';
import { isJoinSurface, paths } from '@/app/surface';
import { t } from '@/i18n';

const route = useRoute();
const router = useRouter();
const session = useSessionStore();
const bootstrap = useBootstrapStore();

const step = ref<1 | 2>(1);
const account = ref('');
const password = ref('');
const code = ref('');
const trustThisDevice = ref(false);
const error = ref('');
const verifyError = ref('');
const busy = ref(false);
const guestBusy = ref(false);
const resendBusy = ref(false);
const expiredSession = computed(() => route.query.expired === '1');
const expiredSessionMessage = t('auth.login.sessionExpired');

/** 账号框的上限：这个框也能填邮箱，卡在用户名的 20 会把长邮箱直接挡在外面。 */
const ACCOUNT_MAX = 120;
/** 验证码框上限：6 位验证码或 `XXXXX-XXXXX` 备用码都装得下。 */
const CODE_MAX = 12;
/** 密码上限由后端配置下发；取不到时与注册页用同一个兜底值。 */
const passwordMax = computed(() => Number(limit('passwordMax', 32)) || 32);

const trustDeviceLabel = t('auth.login.trustDevice');

/** 预认证票：第二步与重发都要用它；它本身不是登录凭据。 */
const ticket = ref('');
/** 验证码已消费时只重试启动数据；换会话后不能沿用这个完成标记。 */
let verifiedSession: AbortSignal | undefined;
const maskedEmail = ref('');
/** 这个账号能用哪些第二因子（由第一步下发）：验证器 / 邮箱验证码 / 备用码。 */
const methods = ref({ totp: false, email: true, backup: false });
/** 第一步有没有真的发出邮件验证码（绑了验证器时不会发）。 */
const emailSent = ref(false);
const remaining = ref(0);
let timer: number | undefined;

const methodHint = computed(() => {
  const lines: string[] = [];
  if (methods.value.totp) lines.push(t('auth.login.totpBoundHint'));
  if (methods.value.backup) lines.push(t('auth.login.backupHint'));
  return lines.join(' ');
});

const resendLabel = computed(() => {
  if (remaining.value > 0) return `${remaining.value} ${t('auth.login.secondsUntilResend')}`;
  return emailSent.value ? t('auth.login.resendCode') : t('auth.login.sendEmailCode');
});

/** 登录前所在页面携带的参数（例如展会 id），登录后原样带回。 */
function redirectTarget(): string {
  const value = route.query.redirect;
  return typeof value === 'string' && value ? value : paths.home;
}

/** 进入登录态之后的收尾：提示 + 跳回原页面（替换历史，不新增返回栈）。 */
async function enterAs(): Promise<void> {
  await refreshRuntimeBootstrap();
  stopCountdown();
  toast(`欢迎回来，${session.user.nickname || session.user.username}`, 'success');
  await router.replace(redirectTarget());
}

/** 后端只回 `ok:false` 而没带原因时兜一句通用文案，否则错误行会是空白。 */
function message(reason: unknown): string {
  const text = reason instanceof Error ? reason.message : String(reason);
  return text || t('auth.login.failed');
}

async function submit(): Promise<void> {
  error.value = '';
  const validated =
    check(account.value, { label: t('auth.login.account'), required: true, max: ACCOUNT_MAX }) ||
    check(password.value, { label: t('auth.login.password'), required: true, max: passwordMax.value });
  if (validated) {
    error.value = validated;
    return;
  }
  busy.value = true;
  try {
    const result = (await api.auth.login(account.value.trim(), password.value)) as AuthResult;
    if (result.twoFactorRequired) {
      // 这一步没有令牌：只有一张票，外加（邮箱是主方式时）一封刚发出的验证码邮件
      ticket.value = String(result.ticket ?? '');
      methods.value = (result.methods as typeof methods.value) ?? methods.value;
      emailSent.value = result.emailSent === true;
      maskedEmail.value = String(result.maskedEmail ?? '');
      code.value = '';
      error.value = '';
      verifyError.value = '';
      trustThisDevice.value = false;
      step.value = 2;
      const wait = Number(result.resendAfterSec);
      if (wait > 0) startCountdown(wait);
      return;
    }
    await enterAs();
  } catch (reason) {
    error.value = message(reason);
  } finally {
    busy.value = false;
  }
}

async function verify(): Promise<void> {
  verifyError.value = '';
  const needsVerification = verifiedSession !== api.session.signal;
  const invalid =
    needsVerification &&
    check(code.value, {
      label: t('auth.login.emailCode'),
      required: true,
      max: CODE_MAX,
      // 第二因子三选一：6 位验证码（验证器或邮箱），或 XXXXX-XXXXX 形式的备用码
      custom: (value) =>
        /^\d{6}$/.test(value) || /^[0-9A-Z]{5}-[0-9A-Z]{5}$/i.test(value) ? '' : t('auth.login.codeOrBackupInvalid'),
    });
  if (invalid) {
    verifyError.value = invalid;
    return;
  }
  busy.value = true;
  try {
    if (needsVerification) {
      await api.auth.loginVerify({
        ticket: ticket.value,
        code: code.value.trim(),
        trustDevice: trustThisDevice.value,
      });
      verifiedSession = api.session.signal;
    }
    await enterAs();
  } catch (reason) {
    verifyError.value = message(reason);
  } finally {
    busy.value = false;
  }
}

async function resend(): Promise<void> {
  if (!ticket.value) return;
  verifyError.value = '';
  resendBusy.value = true;
  try {
    const sent = await api.auth.loginCode(ticket.value);
    toast(t('auth.login.codeSent'), 'success');
    // 从这一刻起才算「已经发过邮件」：按钮文案与「验证码已发送到…」都跟着变
    emailSent.value = true;
    startCountdown(Number((sent as { resendAfterSec?: number }).resendAfterSec));
  } catch (reason) {
    verifyError.value = message(reason);
  } finally {
    resendBusy.value = false;
  }
}

/** 访客身份也由后端签发：后端没起或端口没转发时必须说清楚，否则按钮像坏的。 */
async function guest(): Promise<void> {
  error.value = '';
  guestBusy.value = true;
  try {
    await api.auth.guest();
    await refreshRuntimeBootstrap();
    await router.replace('/home');
  } catch (reason) {
    error.value = message(reason);
  } finally {
    guestBusy.value = false;
  }
}

function startCountdown(seconds: number): void {
  stopCountdown();
  remaining.value = Number(seconds) > 0 ? Number(seconds) : 60;
  timer = window.setInterval(() => {
    remaining.value -= 1;
    if (remaining.value <= 0) stopCountdown();
  }, 1000);
}

function stopCountdown(): void {
  if (timer !== undefined) window.clearInterval(timer);
  timer = undefined;
  remaining.value = 0;
}

function backToStepOne(): void {
  verifiedSession = undefined;
  ticket.value = '';
  step.value = 1;
  verifyError.value = '';
  trustThisDevice.value = false;
  stopCountdown();
}

onBeforeUnmount(stopCountdown);
</script>

<template>
  <!-- 入口页版式与旧版（master）一致：内容区的两道内距由外壳给（左右各 32px），
       品牌方块靠左、标题与说明居中，注册 / 忘记密码跟在表单后面随内容滚动。 -->
  <div class="stack">
    <div class="stack" data-align="text">
      <span class="brand-mark" aria-hidden="true">{{ t('exhibition.detail.brandMark') }}</span>
      <h2>{{ bootstrap.brand.zh }}</h2>
      <p class="muted">{{ t('auth.login.tagline') }}</p>
    </div>

    <div
      v-if="bootstrap.announcement.enabled === true && bootstrap.announcement.text"
      class="notice"
      data-tone="accent"
    >
      <strong>{{ t('auth.login.announcement') }}</strong>
      <span>{{ bootstrap.announcement.text }}</span>
    </div>
    <p v-if="expiredSession" class="notice" data-tone="accent" role="status">{{ expiredSessionMessage }}</p>

    <!-- 第一步：账号与密码 -->
    <form v-if="step === 1" class="form" novalidate @submit.prevent="submit">
      <div class="field">
        <label for="login-account">{{ t('auth.login.account') }}</label>
        <input
          id="login-account"
          v-model="account"
          class="input"
          type="text"
          :placeholder="t('auth.login.accountPlaceholder')"
          autocomplete="username"
          :maxlength="ACCOUNT_MAX"
        />
        <span class="field-counter" aria-live="polite" :data-over="account.length > ACCOUNT_MAX ? 'true' : 'false'">
          {{ account.length }}/{{ ACCOUNT_MAX }}
        </span>
      </div>
      <div class="field">
        <label for="login-password">{{ t('auth.login.password') }}</label>
        <input
          id="login-password"
          v-model="password"
          class="input"
          type="password"
          :placeholder="t('auth.login.passwordPlaceholder')"
          autocomplete="current-password"
          :maxlength="passwordMax"
        />
        <span class="field-counter" aria-live="polite" :data-over="password.length > passwordMax ? 'true' : 'false'">
          {{ password.length }}/{{ passwordMax }}
        </span>
      </div>
      <p v-if="error" class="field-error" role="alert">{{ error }}</p>
      <button class="cta" type="submit" :disabled="busy" :data-loading="busy ? 'true' : 'false'">
        {{ t('auth.login.title') }}
      </button>
      <button
        v-if="!isJoinSurface"
        class="cta ghost"
        type="button"
        :disabled="guestBusy"
        :data-loading="guestBusy ? 'true' : 'false'"
        @click="guest"
      >
        {{ t('auth.login.browseAsGuest') }}
      </button>
    </form>

    <!-- 第二步：两步验证 -->
    <form v-else class="form" novalidate @submit.prevent="verify">
      <div class="stack" data-gap="sm">
        <h2>{{ t('auth.login.twoFactor') }}</h2>
        <!-- 冒号而不是尾随空格：Android 会裁掉 string 资源的首尾空白 -->
        <p v-if="emailSent" class="muted">
          {{ t('auth.login.codeSentTo') }}<strong>{{ maskedEmail }}</strong>
        </p>
        <!-- 绑了验证器时第一步不会自动发邮件（省一封多半用不上的信，也避开 60 秒冷却） -->
        <p v-else class="muted">{{ t('auth.login.totpOrEmailHint') }}</p>
        <p class="field-hint">{{ t('auth.login.codeHint') }}</p>
        <p v-if="methodHint" class="field-hint">{{ methodHint }}</p>
      </div>
      <div class="field">
        <label for="login-code">{{ t('auth.login.emailCode') }}</label>
        <input
          id="login-code"
          v-model="code"
          class="input"
          type="text"
          inputmode="numeric"
          :maxlength="CODE_MAX"
          :placeholder="t('auth.login.codeOrBackup')"
          autocomplete="one-time-code"
        />
        <span class="field-counter" aria-live="polite" :data-over="code.length > CODE_MAX ? 'true' : 'false'">
          {{ code.length }}/{{ CODE_MAX }}
        </span>
      </div>
      <div class="check-row">
        <label class="check-label" for="login-trust-device">
          <input id="login-trust-device" v-model="trustThisDevice" type="checkbox" />
          <span>{{ trustDeviceLabel }}</span>
        </label>
      </div>
      <p v-if="verifyError" class="field-error" role="alert">{{ verifyError }}</p>
      <button class="cta" type="submit" :disabled="busy" :data-loading="busy ? 'true' : 'false'">
        {{ t('auth.login.verifyAndLogin') }}
      </button>
      <!-- 邮箱验证码不可用（邮箱没验证）时，别摆一个点了会报错的按钮 -->
      <button
        v-if="methods.email"
        class="cta ghost"
        type="button"
        :disabled="resendBusy || remaining > 0"
        :data-loading="resendBusy ? 'true' : 'false'"
        @click="resend"
      >
        {{ resendLabel }}
      </button>
      <button class="cta ghost" type="button" @click="backToStepOne">{{ t('auth.login.previousStep') }}</button>
    </form>

    <!-- 第一步才有「注册 / 忘记密码」。 -->
    <div v-if="step === 1" class="stack" data-gap="sm">
      <footer class="row auth-entry">
        <span class="dim">{{ t('auth.login.noAccountYet') }}</span>
        <button class="text-action" type="button" @click="router.push('/register')">
          {{ t('auth.login.signUp') }}
        </button>
      </footer>
      <div class="row auth-entry" data-flush="true">
        <button class="text-action" type="button" @click="router.push('/forgot-password')">
          {{ t('auth.login.forgotPassword') }}
        </button>
      </div>
    </div>
  </div>
</template>

<style>
/* 入口页的文字入口行（注册 / 忘记密码）：居中，并保持旧版的上下留白。
   `data-flush` 是第二行，只留左右内距，避免两行之间被撑开。 */
.auth-entry {
  justify-content: center;
  padding: var(--s3);
}

.auth-entry[data-flush='true'] {
  padding: 0 var(--s3);
}

/* 入口页的品牌标记：线框的 .brand-mark（圆角方底 + 品牌首字）。
   旧版的入口 hero 用的是 `.ph-img`（无描边、只填底色），这里保持一致。 */
.brand-mark {
  width: 84px;
  height: 84px;
  display: grid;
  place-items: center;
  border-radius: var(--r-panel);
  background: var(--f2);
  color: var(--frame);
  font-size: 34px;
  font-weight: 800;
}
</style>
