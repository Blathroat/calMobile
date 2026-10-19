<script setup lang="ts">
/**
 * 屏幕 06 · 找回密码
 * 业务：POST /auth/password/forgot（发码）→ POST /auth/password/reset（验证码 + 新密码）
 *
 * 后端**不区分「这个邮箱注册过没有」**：两种情况响应完全一致，所以这里的提示必须写成
 * 「如果该邮箱已注册，验证码会发送到：」。写成「已发送」的话，填错邮箱的用户会一直等
 * 一封永远不会来的邮件 —— 而「某个邮箱是否注册过」本来就不该被这个接口透露出去。
 *
 * 两步同页：第一步只要邮箱，第二步要验证码与新密码。重置成功后后端会撤销该用户全部刷新
 * 令牌，所以回到登录页重新登录是必须的（其它设备上的登录状态也一并失效）。
 */
import { computed, nextTick, onBeforeUnmount, ref } from 'vue';
import { useRouter } from 'vue-router';
import { api } from '@/app/runtime';
import { toast } from '@/services/toast';
import { PATTERNS, check, matchRule, passwordRule } from '@/services/validate';
import { t } from '@/i18n';

/** 邮箱长度上限：找回密码接口对邮箱的字段长度限制，与后端保持一致。 */
const EMAIL_MAX = 120;

const router = useRouter();

const step = ref<1 | 2>(1);
const email = ref('');
const code = ref('');
const password = ref('');
const confirm = ref('');
/** 第一步输入过的邮箱：重发与「换一个邮箱」都要用。 */
const pendingEmail = ref('');
const sentTo = ref('');
const codeInput = ref<HTMLInputElement>();

const requestBusy = ref(false);
const resetBusy = ref(false);
const resendBusy = ref(false);
const remaining = ref(0);

/** 请求级错误：校验通过、但后端拒绝或网络失败时显示在表单上。 */
const error = ref('');
const resetError = ref('');
/** 字段级错误：显示在各自的 `.field` 里（`.field-error` + `data-invalid`），不用 alert。 */
const emailError = ref('');
const codeError = ref('');
const passwordError = ref('');
const confirmError = ref('');

const secret = computed(() => passwordRule());
const resendLabel = computed(() =>
  remaining.value > 0 ? t('auth.login.secondsUntilResend', { seconds: remaining.value }) : t('auth.login.resendCode'),
);

let timer: number | undefined;

function showStep(next: 1 | 2): void {
  step.value = next;
  error.value = '';
  resetError.value = '';
  codeError.value = '';
  if (next === 2) {
    void nextTick(() => codeInput.value?.focus());
  } else {
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

/** 输入过程中只重算已经有错的字段：没有错的字段留到失焦或提交时再提示。 */
function onEmailInput(): void {
  if (emailError.value) emailError.value = validateEmail();
}

function validateEmail(): string {
  return check(email.value, {
    label: t('auth.register.email'),
    required: true,
    max: EMAIL_MAX,
    pattern: PATTERNS.email,
    patternMessage: t('auth.register.emailInvalid'),
  });
}

function validateCode(): string {
  return check(code.value, {
    label: t('auth.login.emailCode'),
    required: true,
    pattern: PATTERNS.verificationCode,
    patternMessage: t('auth.register.enterSixDigits'),
  });
}

function validatePassword(): string {
  return check(password.value, { required: true, min: secret.value.min, max: secret.value.max });
}

/** 一致性校验挂在确认框上：用户改的就是这个框，错误跟着它才会在改对后立刻消失。 */
function validateConfirm(): string {
  return check(confirm.value, {
    label: t('auth.register.confirmPassword'),
    required: true,
    max: secret.value.max,
    custom: (value: string) => matchRule(value, password.value),
  });
}

/**
 * 请求发码：成功就进第二步并开始倒计时。
 *
 * 返回可展示的错误而不是直接写状态：两步的错误显示位置不同（第一步在表单上，
 * 第二步在重置表单上），由调用方决定放哪里；异常留给调用方 catch。
 */
async function requestCode(target: string): Promise<string> {
  const sent = await api.auth.forgotPassword(target);
  if (!sent?.ok) return String(sent?.error || t('auth.register.failed'));
  pendingEmail.value = target;
  sentTo.value = target;
  showStep(2);
  startCountdown(sent.resendAfterSec);
  return '';
}

async function submitRequest(): Promise<void> {
  error.value = '';
  emailError.value = validateEmail();
  if (emailError.value) return;
  requestBusy.value = true;
  try {
    error.value = await requestCode(email.value.trim());
  } catch (reason) {
    error.value = messageOf(reason);
  } finally {
    requestBusy.value = false;
  }
}

async function submitReset(): Promise<void> {
  resetError.value = '';
  codeError.value = validateCode();
  passwordError.value = validatePassword();
  confirmError.value = validateConfirm();
  if (codeError.value || passwordError.value || confirmError.value) return;
  resetBusy.value = true;
  try {
    const result = await api.auth.resetPassword({
      email: pendingEmail.value || email.value.trim(),
      code: code.value.trim(),
      newPassword: password.value,
      confirmPassword: confirm.value,
    });
    if (!result?.ok) {
      resetError.value = String(result?.error || t('auth.register.failed'));
      return;
    }
    stopCountdown();
    toast(t('auth.forgot.resetSuccess'), 'success');
    await router.replace('/login');
  } catch (reason) {
    resetError.value = messageOf(reason);
  } finally {
    resetBusy.value = false;
  }
}

async function resendCode(): Promise<void> {
  if (!pendingEmail.value || remaining.value > 0 || resendBusy.value) return;
  resetError.value = '';
  resendBusy.value = true;
  try {
    const failure = await requestCode(pendingEmail.value);
    if (failure) {
      resetError.value = failure;
      return;
    }
    // requestCode 成功后倒计时重新开始，这里给出「重发成功」的轻提示。
    if (remaining.value > 0) toast(t('auth.login.codeSent'), 'success');
  } catch (reason) {
    resetError.value = messageOf(reason);
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
    <h2>{{ t('auth.forgot.resetLoginPassword') }}</h2>
    <p class="muted">{{ t('auth.forgot.intro') }}</p>
  </div>

  <!-- 第一步：邮箱 -->
  <form v-if="step === 1" class="form" novalidate @submit.prevent="submitRequest">
    <div class="field" :data-invalid="emailError ? 'true' : undefined">
      <label for="forgot-email">{{ t('auth.forgot.registeredEmail') }}</label>
      <input
        id="forgot-email"
        v-model="email"
        class="input"
        type="email"
        autocomplete="email"
        :maxlength="EMAIL_MAX"
        :placeholder="t('auth.register.emailPlaceholder')"
        @input="onEmailInput"
        @blur="emailError = validateEmail()"
      />
      <p class="field-hint">{{ t('auth.forgot.spamHint') }}</p>
      <p v-if="emailError" class="field-error" role="alert">{{ emailError }}</p>
    </div>

    <p v-if="error" class="field-error" role="alert">{{ error }}</p>
    <button class="cta" type="submit" :data-loading="requestBusy ? 'true' : undefined" :disabled="requestBusy">
      {{ t('auth.forgot.sendCode') }}
    </button>
  </form>

  <!-- 第二步：验证码 + 新密码 -->
  <form v-else class="form" novalidate @submit.prevent="submitReset">
    <div class="stack" data-gap="sm">
      <!-- 冒号放在文案资源里而不是尾随空格：Android 的 string 资源会裁掉首尾空白。 -->
      <p class="muted">
        {{ t('auth.forgot.sentIfRegistered') }}<strong>{{ sentTo }}</strong>
      </p>
      <p class="field-hint">{{ t('auth.forgot.doNotForward') }}</p>
    </div>

    <div class="field" :data-invalid="codeError ? 'true' : undefined">
      <label for="forgot-code">{{ t('auth.login.emailCode') }}</label>
      <input
        id="forgot-code"
        ref="codeInput"
        v-model="code"
        class="input"
        type="text"
        inputmode="numeric"
        maxlength="6"
        autocomplete="one-time-code"
        :placeholder="t('auth.register.sixDigits')"
        @input="codeError = ''"
        @blur="codeError = validateCode()"
      />
      <p v-if="codeError" class="field-error" role="alert">{{ codeError }}</p>
    </div>

    <div class="field" :data-invalid="passwordError ? 'true' : undefined">
      <label for="forgot-password"
        >{{ t('auth.forgot.newPassword') }}（{{ secret.min }}–{{ secret.max }} 个字符）</label
      >
      <input
        id="forgot-password"
        v-model="password"
        class="input"
        type="password"
        autocomplete="new-password"
        :maxlength="secret.max"
        :placeholder="t('auth.register.setPassword')"
        @input="passwordError = ''"
        @blur="passwordError = validatePassword()"
      />
      <p v-if="passwordError" class="field-error" role="alert">{{ passwordError }}</p>
    </div>

    <div class="field" :data-invalid="confirmError ? 'true' : undefined">
      <label for="forgot-confirm">{{ t('auth.register.confirmPassword') }}</label>
      <input
        id="forgot-confirm"
        v-model="confirm"
        class="input"
        type="password"
        autocomplete="new-password"
        :maxlength="secret.max"
        :placeholder="t('auth.register.reenterPassword')"
        @input="confirmError = ''"
        @blur="confirmError = validateConfirm()"
      />
      <p v-if="confirmError" class="field-error" role="alert">{{ confirmError }}</p>
    </div>

    <p v-if="resetError" class="field-error" role="alert">{{ resetError }}</p>
    <button class="cta" type="submit" :data-loading="resetBusy ? 'true' : undefined" :disabled="resetBusy">
      {{ t('auth.forgot.reset') }}
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
    <button class="cta ghost" type="button" @click="showStep(1)">{{ t('auth.forgot.changeEmail') }}</button>
  </form>

  <button class="cta ghost" type="button" @click="router.replace('/login')">
    {{ t('auth.register.backToLogin') }}
  </button>
</template>
