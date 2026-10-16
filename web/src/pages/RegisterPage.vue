<script setup lang="ts">
/**
 * 屏幕 05 · 注册（创建账号）
 * 业务：POST /auth/register（第一步：校验 + 发码）→ POST /auth/register/verify（第二步：验证码通过才建号）
 *
 * 两步的意义在**后端**：邮箱验证通过之前不会创建账号，所以库里不会留下「注册了但邮箱没验证」
 * 的半成品。第一步的待建账号（密码已经是哈希）暂存在验证码记录里，10 分钟不验证就随过期码消失。
 *
 * 两步同页只切换模板分支：已填内容都留在响应式状态里，点「返回修改」不会丢输入；
 * 切到第二步时清空验证码输入框并把焦点放上去，省掉一次手动点击。
 *
 * 校验规则来自「管理-设置」的服务器设置（bootstrap 下发的 `limits`），页面即时提示，
 * 后端保存前会再校验一次（server/src/routes/auth-hono.ts），绕过页面直接调接口同样被拦。
 */
import { computed, nextTick, onBeforeUnmount, ref, type Ref } from 'vue';
import { useRouter } from 'vue-router';
import { api, refreshRuntimeBootstrap } from '@/app/runtime';
import { toast } from '@/services/toast';
import {
  PATTERNS,
  check,
  matchRule,
  passwordRule,
  passwordStrength,
  usernameRule,
  type CheckOptions,
} from '@/services/validate';
import type { JsonObject } from '@/api/types';
import { paths } from '@/app/surface';
import { t } from '@/i18n';
import { useBootstrapStore } from '@/stores/bootstrap';

/** 邮箱长度上限：注册接口对邮箱的字段长度限制，与后端保持一致。 */
const EMAIL_MAX = 60;

type FieldName = 'username' | 'email' | 'password' | 'confirm';

const router = useRouter();
const bootstrap = useBootstrapStore();
/** 只接受 https，避免把后端误发的地址当成可点链接。 */
const privacyPolicyUrl = computed(() => {
  const value = bootstrap.privacyPolicyUrl.trim();
  return value.startsWith('https://') ? value : '';
});

const step = ref<1 | 2>(1);
const username = ref('');
const email = ref('');
const password = ref('');
const confirm = ref('');
const code = ref('');
/** 验证码到底发去了哪个邮箱：后端回什么就显示什么，避免用户填了别名邮箱后对不上。 */
const sentTo = ref('');
const pending = ref<JsonObject | null>(null);
/** 注册凭据只提交一次；后续启动失败可在同一会话里重试。 */
let verifiedSession: AbortSignal | undefined;

const accountBusy = ref(false);
const verifyBusy = ref(false);
const resendBusy = ref(false);
const remaining = ref(0);
const codeInput = ref<HTMLInputElement>();

/** 请求级错误：校验通过、但后端拒绝或网络失败时显示在表单上。 */
const error = ref('');
const verifyError = ref('');
/** 字段级错误：显示在各自的 `.field` 里（`.field-error` + `data-invalid`），不用 alert。 */
const fieldErrors = ref<Record<FieldName, string>>({ username: '', email: '', password: '', confirm: '' });
const codeError = ref('');

/**
 * 规则与控件各声明一次：失焦、提交、输入时清除错误都复用同一份，
 * 而且 `limit()` 读的是 store，管理员改了长度上限后提示与拦截同步更新。
 */
const account = computed(() => usernameRule());
const secret = computed(() => passwordRule());
const strength = computed(() => passwordStrength(password.value));
const resendLabel = computed(() =>
  remaining.value > 0 ? `${remaining.value} ${t('auth.login.secondsUntilResend')}` : t('auth.login.resendCode'),
);

const RULES: Record<FieldName, () => CheckOptions> = {
  username: () => ({ required: true, ...account.value }),
  email: () => ({
    label: t('auth.register.email'),
    required: true,
    max: EMAIL_MAX,
    pattern: PATTERNS.email,
    patternMessage: t('auth.register.emailInvalid'),
  }),
  password: () => ({ required: true, min: secret.value.min, max: secret.value.max }),
  // 一致性校验挂在确认框上：用户改的就是这个框，错误跟着它才会在改对后立刻消失。
  confirm: () => ({
    label: t('auth.register.confirmPassword'),
    required: true,
    max: secret.value.max,
    custom: (value: string) => matchRule(value, password.value),
  }),
};

const VALUES: Record<FieldName, Ref<string>> = { username, email, password, confirm };

function validateField(name: FieldName): string {
  const message = check(VALUES[name].value, RULES[name]());
  fieldErrors.value[name] = message;
  return message;
}

/** 输入过程中只重算已经有错的字段：没有错的字段等失焦或提交时再提示。 */
function onFieldInput(name: FieldName): void {
  if (fieldErrors.value[name]) validateField(name);
}

function validateAccount(): boolean {
  const names: FieldName[] = ['username', 'email', 'password', 'confirm'];
  // 逐个校验而不是遇到第一个就返回：每个字段的错误都要在原位显示出来。
  return names.map((name) => validateField(name)).every((message) => message === '');
}

/** 重发倒计时句柄：离开页面时必须清掉，否则计时器会一直在后台跑。 */
let timer: number | undefined;

/** 切到某一步：只切显隐，不重建输入内容。 */
function showStep(next: 1 | 2): void {
  step.value = next;
  error.value = '';
  verifyError.value = '';
  codeError.value = '';
  if (next === 2) {
    void nextTick(() => codeInput.value?.focus());
  } else {
    verifiedSession = undefined;
    stopCountdown();
  }
}

/** 重发倒计时：按钮上的秒数与后端的冷却时间保持一致。 */
function startCountdown(seconds: unknown): void {
  stopCountdown();
  remaining.value = Number(seconds) > 0 ? Number(seconds) : 60;
  timer = window.setInterval(tick, 1000);
}

function tick(): void {
  remaining.value -= 1;
  if (remaining.value <= 0) stopCountdown();
}

function stopCountdown(): void {
  if (timer !== undefined) {
    window.clearInterval(timer);
    timer = undefined;
  }
  remaining.value = 0;
}

onBeforeUnmount(stopCountdown);

async function submitAccount(): Promise<void> {
  error.value = '';
  if (!validateAccount()) return;
  accountBusy.value = true;
  try {
    const payload: JsonObject = {
      username: username.value.trim(),
      email: email.value.trim(),
      password: password.value,
      confirmPassword: confirm.value,
    };
    const sent = await api.auth.register(payload);
    if (!sent?.ok) {
      error.value = String(sent?.error || t('auth.register.failed'));
      return;
    }
    // 这一步后端没建账号，只回了「码发到哪、多久过期、多久能重发」。
    pending.value = payload;
    sentTo.value = String(sent.email || payload.email || '');
    code.value = '';
    showStep(2);
    startCountdown(sent.resendAfterSec);
    toast(t('auth.login.codeSent'), 'success');
  } catch (reason) {
    error.value = messageOf(reason);
  } finally {
    accountBusy.value = false;
  }
}

async function verifyAccount(): Promise<void> {
  verifyError.value = '';
  const needsVerification = verifiedSession !== api.session.signal;
  codeError.value = needsVerification
    ? check(code.value, {
        label: t('auth.login.emailCode'),
        required: true,
        pattern: PATTERNS.verificationCode,
        patternMessage: t('auth.register.enterSixDigits'),
      })
    : '';
  if (codeError.value) return;
  verifyBusy.value = true;
  try {
    if (needsVerification) {
      const saved = await api.auth.registerVerify({
        email: pending.value?.email || email.value.trim(),
        code: code.value.trim(),
      });
      if (!saved?.ok) {
        verifyError.value = String(saved?.error || t('auth.register.failed'));
        return;
      }
      verifiedSession = api.session.signal;
    }
    await refreshRuntimeBootstrap();
    stopCountdown();
    toast(t('auth.register.createdAndSignedIn'), 'success');
    await router.replace(paths.home);
  } catch (reason) {
    verifyError.value = messageOf(reason);
  } finally {
    verifyBusy.value = false;
  }
}

/** 重发用的还是第一步提交过的那份入参，用户不需要退回去重填。 */
async function resendCode(): Promise<void> {
  if (!pending.value || remaining.value > 0 || resendBusy.value) return;
  verifyError.value = '';
  resendBusy.value = true;
  try {
    const sent = await api.auth.register(pending.value);
    if (!sent?.ok) {
      verifyError.value = String(sent?.error || t('auth.register.failed'));
      return;
    }
    toast(t('auth.login.codeSent'), 'success');
    startCountdown(sent.resendAfterSec);
  } catch (reason) {
    verifyError.value = messageOf(reason);
  } finally {
    resendBusy.value = false;
  }
}

function messageOf(reason: unknown): string {
  return reason instanceof Error ? reason.message : String(reason);
}
</script>

<template>
  <div class="stack" data-gap="sm">
    <h2>{{ t('auth.register.createProfile') }}</h2>
    <p class="muted">{{ t('auth.register.intro') }}</p>
  </div>

  <!-- 第一步：账号信息 -->
  <form v-if="step === 1" class="form" novalidate @submit.prevent="submitAccount">
    <div class="field" :data-invalid="fieldErrors.username ? 'true' : undefined">
      <label for="register-username">{{ account.label }}（{{ account.min }}–{{ account.max }} 个字符）</label>
      <input
        id="register-username"
        v-model="username"
        class="input"
        type="text"
        autocomplete="username"
        :maxlength="account.max"
        :placeholder="t('auth.register.usernamePlaceholder')"
        @input="onFieldInput('username')"
        @blur="validateField('username')"
      />
      <p class="field-hint">{{ t('auth.register.usernameHint') }}</p>
      <p v-if="fieldErrors.username" class="field-error" role="alert">{{ fieldErrors.username }}</p>
      <span class="field-counter" :data-over="username.length > (account.max ?? 0) ? 'true' : 'false'"
        >{{ username.length }}/{{ account.max }}</span
      >
    </div>

    <div class="field" :data-invalid="fieldErrors.email ? 'true' : undefined">
      <label for="register-email">{{ t('auth.register.email') }}</label>
      <input
        id="register-email"
        v-model="email"
        class="input"
        type="email"
        autocomplete="email"
        :maxlength="EMAIL_MAX"
        :placeholder="t('auth.register.emailPlaceholder')"
        @input="onFieldInput('email')"
        @blur="validateField('email')"
      />
      <p v-if="fieldErrors.email" class="field-error" role="alert">{{ fieldErrors.email }}</p>
      <span class="field-counter" :data-over="email.length > EMAIL_MAX ? 'true' : 'false'"
        >{{ email.length }}/{{ EMAIL_MAX }}</span
      >
    </div>

    <div class="field" :data-invalid="fieldErrors.password ? 'true' : undefined">
      <label for="register-password">{{ secret.label }}（{{ secret.min }}–{{ secret.max }} 个字符）</label>
      <input
        id="register-password"
        v-model="password"
        class="input"
        type="password"
        autocomplete="new-password"
        :maxlength="secret.max"
        :placeholder="t('auth.register.setPassword')"
        @input="onFieldInput('password')"
        @blur="validateField('password')"
      />
      <p class="field-hint">至少 {{ secret.min }} 个字符</p>
      <p v-if="fieldErrors.password" class="field-error" role="alert">{{ fieldErrors.password }}</p>
      <span class="field-counter" :data-over="password.length > (secret.max ?? 0) ? 'true' : 'false'"
        >{{ password.length }}/{{ secret.max }}</span
      >
    </div>

    <div class="field" :data-invalid="fieldErrors.confirm ? 'true' : undefined">
      <label for="register-confirm">{{ t('auth.register.confirmPassword') }}</label>
      <input
        id="register-confirm"
        v-model="confirm"
        class="input"
        type="password"
        autocomplete="new-password"
        :maxlength="secret.max"
        :placeholder="t('auth.register.reenterPassword')"
        @input="onFieldInput('confirm')"
        @blur="validateField('confirm')"
      />
      <p v-if="fieldErrors.confirm" class="field-error" role="alert">{{ fieldErrors.confirm }}</p>
      <span class="field-counter" :data-over="confirm.length > (secret.max ?? 0) ? 'true' : 'false'"
        >{{ confirm.length }}/{{ secret.max }}</span
      >
    </div>

    <div class="row" data-between="true">
      <span class="row-meta">{{ t('auth.register.passwordStrength') }}</span>
      <span class="password-meter" :data-level="strength.level">{{ strength.label }}</span>
    </div>

    <p v-if="error" class="field-error" role="alert">{{ error }}</p>
    <p class="field-hint">
      {{ t('auth.register.privacy') }}
      <a v-if="privacyPolicyUrl" :href="privacyPolicyUrl" target="_blank" rel="noopener noreferrer">{{
        t('auth.register.privacyPolicy')
      }}</a>
    </p>
    <button class="cta" type="submit" :data-loading="accountBusy ? 'true' : undefined" :disabled="accountBusy">
      {{ t('auth.register.createAccount') }}
    </button>
  </form>

  <!-- 第二步：邮箱验证码 -->
  <form v-else class="form" novalidate @submit.prevent="verifyAccount">
    <div class="stack" data-gap="sm">
      <!-- 冒号放在文案资源里而不是尾随空格：Android 的 string 资源会裁掉首尾空白。 -->
      <p class="muted">
        {{ t('auth.login.codeSentTo') }}<strong>{{ sentTo }}</strong>
      </p>
      <p class="field-hint">{{ t('auth.register.codeHint') }}</p>
    </div>

    <div class="field" :data-invalid="codeError ? 'true' : undefined">
      <label for="register-code">{{ t('auth.login.emailCode') }}</label>
      <input
        id="register-code"
        ref="codeInput"
        v-model="code"
        class="input"
        type="text"
        inputmode="numeric"
        maxlength="6"
        autocomplete="one-time-code"
        :placeholder="t('auth.register.sixDigits')"
        @input="codeError = ''"
      />
      <p v-if="codeError" class="field-error" role="alert">{{ codeError }}</p>
    </div>

    <p v-if="verifyError" class="field-error" role="alert">{{ verifyError }}</p>
    <button class="cta" type="submit" :data-loading="verifyBusy ? 'true' : undefined" :disabled="verifyBusy">
      {{ t('auth.register.verifyAndCreate') }}
    </button>
    <button
      class="cta ghost"
      type="button"
      :data-loading="resendBusy ? 'true' : undefined"
      :disabled="remaining > 0 || resendBusy"
      @click="resendCode"
    >
      {{ resendLabel }}
    </button>
    <button class="cta ghost" type="button" @click="showStep(1)">{{ t('auth.register.backToEdit') }}</button>
  </form>

  <button class="cta ghost" type="button" @click="router.replace('/login')">
    {{ t('auth.register.backToLogin') }}
  </button>
</template>

<style>
.password-meter {
  min-width: 56px;
  padding: 2px var(--s2);
  border-radius: var(--r-chip);
  background: var(--f1);
  color: var(--ink-2);
  font-size: var(--fs-tag);
  font-weight: 700;
  text-align: center;
}

.password-meter[data-level='2'] {
  background: var(--warn-tint);
  color: var(--warn-ink);
}

.password-meter[data-level='3'] {
  background: var(--screen);
  border: var(--hairline) solid var(--accent-edge);
  color: var(--accent-ink);
}
</style>
