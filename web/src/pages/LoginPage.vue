<script setup lang="ts">
/**
 * 屏幕 01 · 入口（登录 / 访客 / 两步验证）
 *
 * 账号开启两步验证时，第一步只下发 5 分钟预认证票，第二步凭验证码或通行密钥换取正式会话。
 */
import { computed, onBeforeUnmount, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { api, refreshRuntimeBootstrap } from '@/app/runtime';
import { useBootstrapStore } from '@/stores/bootstrap';
import { useSessionStore } from '@/stores/session';
import { toast } from '@/services/toast';
import { check, limit } from '@/services/validate';
import { getCredential, isPasskeySupported } from '@/services/webauthn';
import type { AuthResult } from '@/api/types';
import { isJoinSurface, paths } from '@/app/surface';
import { t } from '@/i18n';

const route = useRoute();
const router = useRouter();
const session = useSessionStore();
const bootstrap = useBootstrapStore();

const agreementEnabled = computed(() => bootstrap.agreement?.enabled === true);
const agreementVersion = computed(() => Number(bootstrap.agreement?.version ?? 0) || 0);
const agreed = ref(false);
const agreementError = ref('');

watch(agreed, () => {
  agreementError.value = '';
});

function agreementBlocked(): boolean {
  if (!agreementEnabled.value || agreed.value) return false;
  agreementError.value = t('agreement.consentRequired');
  return true;
}

async function recordAgreementConsent(): Promise<void> {
  if (!agreementEnabled.value || !agreed.value || agreementVersion.value <= 0) return;
  try {
    await api.profile.agree(agreementVersion.value);
  } catch {
    /* 静默失败：全局弹窗兜底 */
  }
}

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

const ACCOUNT_MAX = 120;
const CODE_MAX = 12;
const passwordMax = computed(() => Number(limit('passwordMax', 32)) || 32);

const trustDeviceLabel = t('auth.login.trustDevice');

const ticket = ref('');
let verifiedSession: AbortSignal | undefined;
const maskedEmail = ref('');
const methods = ref({ totp: false, email: true, backup: false, passkey: false });
const passkeySupported = ref(isPasskeySupported());
const passkeyBusy = ref(false);
const emailSent = ref(false);
const remaining = ref(0);
let timer: number | undefined;

const passkeyAvailable = computed(() => methods.value.passkey === true && passkeySupported.value);

const methodHint = computed(() => {
  const lines: string[] = [];
  if (methods.value.totp) lines.push(t('auth.login.totpBoundHint'));
  if (methods.value.backup) lines.push(t('auth.login.backupHint'));
  return lines.join(' ');
});

const codeChannel = computed<'email' | 'backup' | 'none'>(() => {
  if (methods.value.email) return 'email';
  if (methods.value.backup) return 'backup';
  return 'none';
});

const resendLabel = computed(() => {
  if (remaining.value > 0) return t('auth.login.secondsUntilResend', { seconds: remaining.value });
  return emailSent.value ? t('auth.login.resendCode') : t('auth.login.sendEmailCode');
});

function redirectTarget(): string {
  const value = route.query.redirect;
  return typeof value === 'string' && value ? value : paths.home;
}

function goRegister(): void {
  const value = route.query.redirect;
  void router.push(
    typeof value === 'string' && value ? { path: '/register', query: { redirect: value } } : '/register',
  );
}

async function enterAs(): Promise<void> {
  await recordAgreementConsent();
  await refreshRuntimeBootstrap();
  stopCountdown();
  toast(t('auth.login.welcomeBack', { name: String(session.user.nickname || session.user.username || '') }), 'success');
  await router.replace(redirectTarget());
}

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
  if (agreementBlocked()) return;
  busy.value = true;
  try {
    const result = (await api.auth.login(account.value.trim(), password.value)) as AuthResult;
    if (result.twoFactorRequired) {
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
      custom: (value) =>
        /^\d{6}$/.test(value) || /^[0-9A-Z]{5}-[0-9A-Z]{5}$/i.test(value) ? '' : t('auth.login.codeOrBackupInvalid'),
    });
  if (invalid) {
    verifyError.value = invalid;
    return;
  }
  if (agreementBlocked()) return;
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

async function loginWithPasskey(): Promise<void> {
  if (!ticket.value || passkeyBusy.value) return;
  if (agreementBlocked()) return;
  verifyError.value = '';
  passkeyBusy.value = true;
  let verified = false;
  try {
    const options = await api.auth.passkeyOptions(ticket.value);
    const credential = await getCredential(options.options);
    if (!credential) return;
    await api.auth.passkeyVerify({
      ticket: ticket.value,
      challengeId: String(options.challengeId || ''),
      credential,
      trustDevice: trustThisDevice.value,
    });
    verified = true;
    verifiedSession = api.session.signal;
    await enterAs();
  } catch (reason) {
    verifyError.value = verified
      ? message(reason)
      : codeChannel.value === 'none'
        ? t('auth.login.passkeyFailedOnly')
        : t('auth.login.passkeyFailed');
  } finally {
    passkeyBusy.value = false;
  }
}

async function resend(): Promise<void> {
  if (!ticket.value) return;
  verifyError.value = '';
  resendBusy.value = true;
  try {
    const sent = await api.auth.loginCode(ticket.value);
    toast(t('auth.login.codeSent'), 'success');
    emailSent.value = true;
    startCountdown(Number((sent as { resendAfterSec?: number }).resendAfterSec));
  } catch (reason) {
    verifyError.value = message(reason);
  } finally {
    resendBusy.value = false;
  }
}

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
  <div class="stack auth-shell">
    <div class="auth-hero">
      <span class="brand-mark" aria-hidden="true">{{ t('exhibition.detail.brandMark') }}</span>
      <h2>{{ bootstrap.brand.zh }}</h2>
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
    <form v-if="step === 1" class="form auth-card" novalidate @submit.prevent="submit">
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
      <div v-if="agreementEnabled" class="check-row agreement-consent">
        <label class="check-label" for="login-agreement">
          <input id="login-agreement" v-model="agreed" type="checkbox" />
          <span class="check-copy">
            {{ t('agreement.consentPrefix')
            }}<RouterLink class="agreement-link" to="/agreement">{{ t('agreement.consentLink') }}</RouterLink>
          </span>
        </label>
        <p v-if="agreementError" class="field-error" role="alert">{{ agreementError }}</p>
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
    <form v-else class="form auth-card" novalidate @submit.prevent="verify">
      <div class="stack" data-gap="sm">
        <h2>{{ t('auth.login.twoFactor') }}</h2>
        <p v-if="emailSent" class="muted">
          {{ t('auth.login.codeSentTo') }}<strong>{{ maskedEmail }}</strong>
        </p>
        <p v-else-if="codeChannel === 'none'" class="muted">
          {{ passkeySupported ? t('auth.login.passkeyOnlyHint') : t('auth.login.passkeyUnsupportedHint') }}
        </p>
        <p v-else-if="codeChannel === 'backup'" class="muted">{{ t('auth.login.backupOnlyHint') }}</p>
        <p v-else class="muted">{{ t('auth.login.totpOrEmailHint') }}</p>
        <p v-if="codeChannel !== 'none'" class="field-hint">{{ t('auth.login.codeHint') }}</p>
        <p v-if="methodHint" class="field-hint">{{ methodHint }}</p>
      </div>
      <div v-if="passkeyAvailable" class="stack" data-gap="sm">
        <p class="field-hint">{{ t('auth.login.passkeyHint') }}</p>
        <button
          class="cta"
          type="button"
          :disabled="passkeyBusy"
          :data-loading="passkeyBusy ? 'true' : 'false'"
          @click="loginWithPasskey"
        >
          {{ t('auth.login.usePasskey') }}
        </button>
      </div>
      <p v-if="passkeyAvailable && codeChannel === 'email'" class="or-code-title">{{ t('auth.login.orUseCode') }}</p>
      <div v-if="codeChannel !== 'none'" class="field">
        <label for="login-code">
          {{ codeChannel === 'email' ? t('auth.login.emailCode') : t('auth.login.backupCode') }}
        </label>
        <input
          id="login-code"
          v-model="code"
          class="input"
          type="text"
          inputmode="numeric"
          :maxlength="CODE_MAX"
          :placeholder="codeChannel === 'email' ? t('auth.login.codeOrBackup') : t('auth.login.backupPlaceholder')"
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
      <div v-if="agreementEnabled" class="check-row agreement-consent">
        <label class="check-label" for="login-agreement">
          <input id="login-agreement" v-model="agreed" type="checkbox" />
          <span class="check-copy">
            {{ t('agreement.consentPrefix')
            }}<RouterLink class="agreement-link" to="/agreement">{{ t('agreement.consentLink') }}</RouterLink>
          </span>
        </label>
        <p v-if="agreementError" class="field-error" role="alert">{{ agreementError }}</p>
      </div>
      <p v-if="verifyError" class="field-error" role="alert">{{ verifyError }}</p>
      <button
        v-if="codeChannel !== 'none'"
        class="cta"
        :class="{ ghost: passkeyAvailable }"
        type="submit"
        :disabled="busy"
        :data-loading="busy ? 'true' : 'false'"
      >
        {{ t('auth.login.verifyAndLogin') }}
      </button>
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

    <div v-if="step === 1" class="stack" data-gap="sm">
      <footer class="row auth-entry">
        <span class="dim">{{ t('auth.login.noAccountYet') }}</span>
        <button class="text-action" type="button" @click="goRegister">
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
.auth-shell {
  padding-top: var(--s3);
}

.auth-hero {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: var(--s2);
  padding-bottom: var(--s2);
  text-align: center;
}

.auth-card {
  padding: var(--s4);
  border: var(--hairline) solid var(--stroke);
  border-radius: var(--r-card);
  background: var(--surface-card);
}

.auth-entry {
  justify-content: center;
  padding: var(--s1) var(--s3);
}

.auth-entry[data-flush='true'] {
  padding: 0 var(--s3);
}

.or-code-title {
  margin-top: var(--s1);
  color: var(--ink-2);
  font-size: var(--fs-xs);
  font-weight: 600;
}

.brand-mark {
  width: 44px;
  height: 44px;
  display: grid;
  place-items: center;
  border-radius: var(--r-card);
  background: var(--accent-solid);
  color: var(--on-dark);
  font-size: var(--fs-lg);
  font-weight: 600;
}
</style>
