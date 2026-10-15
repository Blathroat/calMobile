<script setup lang="ts">
/** 安全设置的表单抽屉；身份复核与后续操作在同一抽屉内完成。 */
import { computed, ref } from 'vue';
import { closeSheet } from '@/services/sheet';
import { PATTERNS, check } from '@/services/validate';
import QrCanvas from '@/components/QrCanvas.vue';
import { t } from '@/i18n';

type SheetKind = 'change-email' | 'email-factor' | 'totp' | 'password' | 'change-password' | 'identity-only';
type IdentityScope = 'password' | 'email' | 'totp' | 'factor';
type IdentityMethod = 'email' | 'totp';
interface SubmitPayload {
  action: string;
  email?: string;
  code?: string;
  password?: string;
  newPassword?: string;
  confirmPassword?: string;
  stepUpToken?: string;
}
interface SubmitResult { pendingEmail?: string; backupCodes?: string[]; maskedEmail?: string; close?: boolean; }
interface SubmitError extends Error { pendingEmail?: string; }
interface IdentityResult { stepUpToken: string; secret?: string; otpauthUri?: string; maskedEmail?: string; complete?: boolean; }

const props = defineProps<{
  kind: SheetKind;
  action: string;
  initialEmail?: string;
  maskedEmail?: string;
  secret?: string;
  otpauthUri?: string;
  identityScope?: IdentityScope;
  totpAvailable?: boolean;
  passwordMin?: number;
  passwordMax?: number;
  sendIdentityCode?: () => Promise<string>;
  verifyIdentity?: (method: IdentityMethod, code: string, scope: IdentityScope) => Promise<IdentityResult>;
  onIdentityFailure?: () => void;
  submitAction: (payload: SubmitPayload) => Promise<SubmitResult>;
}>();

const email = ref(props.initialEmail ?? '');
const pendingEmail = ref('');
const code = ref('');
const password = ref('');
const newPassword = ref('');
const confirmPassword = ref('');
const identityMethod = ref<IdentityMethod>(props.totpAvailable ? 'totp' : 'email');
const identityCodeSent = ref(false);
const identityEmail = ref(props.maskedEmail ?? '');
const maskedEmail = ref(props.maskedEmail ?? '');
const identityTicket = ref('');
const resendingEmail = ref(false);
const secret = ref(props.secret ?? '');
const otpauthUri = ref(props.otpauthUri ?? '');
const backupCodes = ref<string[]>([]);
const view = ref<SheetKind | 'identity' | 'codes'>(props.identityScope ? 'identity' : props.kind);
const error = ref('');
const notice = ref('');
const busy = ref(false);
const qrError = ref('');
const copy = {
  emailSent: t('security.setup.codeSentTo'),
  emailCodeExpiry: t('security.setup.codeExpiry'),
  changeAddress: t('security.setup.changeAddress'),
  manualSecret: t('security.setup.enterSecret'),
  identityDescription: t('security.setup.verifyIdentity'),
  disableDescription: t('security.disableKeepsAuthenticator'),
  emailMethod: t('auth.login.emailCode'),
  totpMethod: t('security.totp.recommended'),
  sendIdentityCode: t('auth.forgot.sendCode'),
  identityCodeSent: t('security.setup.identityCodeSent'),
  verifyAndContinue: t('security.setup.verifyAndContinue'),
  changePassword: t('security.password.change'),
  newPassword: t('auth.forgot.newPassword'),
  confirmPassword: t('security.setup.confirmNewPassword'),
  confirmPasswordRequired: t('security.setup.enterConfirmPassword'),
  passwordLength: t('security.setup.passwordLength'),
  passwordCharacters: t('security.setup.characters'),
  passwordMismatch: t('security.setup.passwordMismatch'),
  resendIdentityCode: t('auth.login.resendCode'),
};

const secretGroups = computed(() => secret.value.match(/.{1,4}/g)?.join(' ') ?? '');
const passwordMin = computed(() => Number(props.passwordMin) || 6);
const passwordMax = computed(() => Number(props.passwordMax) || 32);

function errorText(reason: unknown): string {
  return reason instanceof Error && reason.message ? reason.message : t('auth.register.failed');
}

async function run(action: string, values: Omit<SubmitPayload, 'action'> = {}): Promise<SubmitResult | undefined> {
  busy.value = true;
  error.value = '';
  notice.value = '';
  try {
    const result = await props.submitAction({
      action,
      ...values,
      ...(identityTicket.value ? { stepUpToken: identityTicket.value } : {}),
    });
    if (action === 'email-send' && result?.pendingEmail) {
      pendingEmail.value = result.pendingEmail;
      email.value = result.pendingEmail;
      identityTicket.value = '';
      notice.value = t('security.setup.codeSentNewEmail');
      if (props.identityScope) {
        view.value = 'change-email';
        code.value = '';
      }
    } else if (action === 'email-send' && props.identityScope) {
      identityTicket.value = '';
      view.value = 'identity';
      code.value = '';
    }
    const codes = Array.isArray(result?.backupCodes) ? result.backupCodes.map(String) : [];
    if (codes.length) {
      backupCodes.value = codes;
      view.value = 'codes';
    } else if (result?.close !== false) {
      closeSheet();
    }
    return result;
  } catch (reason) {
    error.value = errorText(reason);
    props.onIdentityFailure?.();
    const failed = reason as SubmitError;
    if (action === 'email-send' && props.identityScope) {
      identityTicket.value = '';
      view.value = 'identity';
      code.value = '';
      identityCodeSent.value = false;
    } else if (action === 'email-send' && failed.pendingEmail) email.value = failed.pendingEmail;
    return undefined;
  } finally {
    busy.value = false;
  }
}

async function sendIdentityCode(): Promise<void> {
  if (!props.sendIdentityCode) return;
  busy.value = true;
  error.value = '';
  notice.value = '';
  try {
    identityEmail.value = await props.sendIdentityCode() || identityEmail.value;
    identityCodeSent.value = true;
    notice.value = `${copy.identityCodeSent} ${identityEmail.value} · ${copy.emailCodeExpiry}`;
  } catch (reason) {
    error.value = errorText(reason);
    props.onIdentityFailure?.();
  } finally {
    busy.value = false;
  }
}

async function verifyIdentity(): Promise<void> {
  if (!props.identityScope || !props.verifyIdentity) return;
  const value = code.value.trim();
  if (!PATTERNS.verificationCode.test(value)) {
    error.value = t('auth.register.enterSixDigits');
    props.onIdentityFailure?.();
    return;
  }
  busy.value = true;
  error.value = '';
  notice.value = '';
  try {
    const result = await props.verifyIdentity(identityMethod.value, value, props.identityScope);
    identityTicket.value = result.stepUpToken;
    if (result.complete) {
      closeSheet();
      return;
    }
    if (result.maskedEmail) maskedEmail.value = result.maskedEmail;
    if (props.kind === 'email-factor') {
      const started = await props.submitAction({ action: 'email-factor-start', stepUpToken: result.stepUpToken });
      if (started?.maskedEmail) maskedEmail.value = started.maskedEmail;
    }
    if (props.kind === 'identity-only') {
      await props.submitAction({ action: props.action, stepUpToken: result.stepUpToken });
      closeSheet();
      return;
    }
    if (props.kind === 'change-email' && props.identityScope === 'email' && resendingEmail.value) {
      await run('email-send', { email: pendingEmail.value, stepUpToken: result.stepUpToken });
      resendingEmail.value = false;
      return;
    }
    if (result.secret) secret.value = result.secret;
    if (result.otpauthUri) otpauthUri.value = result.otpauthUri;
    if (props.kind === 'totp' && result.stepUpToken) identityTicket.value = result.stepUpToken;
    identityCodeSent.value = false;
    code.value = '';
    view.value = props.kind;
  } catch (reason) {
    error.value = errorText(reason);
    props.onIdentityFailure?.();
  } finally {
    busy.value = false;
  }
}

async function sendEmailCode(): Promise<void> {
  const target = pendingEmail.value || email.value.trim();
  const validation = check(target, {
    label: t('auth.register.email'), required: true, max: 120, pattern: PATTERNS.email,
    patternMessage: t('auth.register.emailInvalid'),
  });
  if (validation) { error.value = validation; return; }
  await run('email-send', { email: target });
}

async function submitPassword(): Promise<void> {
  const nextError = check(newPassword.value, {
    label: copy.newPassword,
    required: true,
    min: passwordMin.value,
    max: passwordMax.value,
  });
  const confirmError = !confirmPassword.value
    ? copy.confirmPasswordRequired
    : newPassword.value !== confirmPassword.value
      ? copy.passwordMismatch
      : '';
  if (nextError || confirmError) {
    error.value = nextError || confirmError;
    return;
  }
  await run(props.action, { newPassword: newPassword.value, confirmPassword: confirmPassword.value });
}

async function submit(): Promise<void> {
  if (view.value === 'change-email') {
    if (!pendingEmail.value) { await sendEmailCode(); return; }
    if (!PATTERNS.verificationCode.test(code.value.trim())) {
      error.value = t('auth.register.enterSixDigits');
      return;
    }
    await run('email-verify', { email: pendingEmail.value, code: code.value.trim() });
    return;
  }
  if (view.value === 'email-factor' || view.value === 'totp') {
    if (!PATTERNS.verificationCode.test(code.value.trim())) { error.value = t('auth.register.enterSixDigits'); return; }
    await run(props.action, { code: code.value.trim() });
    return;
  }
  if (view.value === 'password') {
    if (!password.value) { error.value = t('security.setup.enterCurrentPassword'); return; }
    await run(props.action, { password: password.value });
    return;
  }
  if (view.value === 'identity-only') {
    await run(props.action);
    return;
  }
  if (view.value === 'change-password') await submitPassword();
}

function changeEmail(): void {
  pendingEmail.value = '';
  code.value = '';
  identityTicket.value = '';
  error.value = '';
  notice.value = '';
  view.value = props.identityScope ? 'identity' : 'change-email';
}

function requestEmailResend(): void {
  if (!props.identityScope || !pendingEmail.value) return;
  resendingEmail.value = true;
  identityTicket.value = '';
  identityCodeSent.value = false;
  code.value = '';
  error.value = '';
  notice.value = '';
  view.value = 'identity';
}
</script>

<template>
  <div v-if="view === 'identity'" class="form" data-gap="sm">
    <p class="field-hint">{{ copy.identityDescription }}</p>
    <div v-if="totpAvailable" class="seg" role="group" :aria-label="copy.identityDescription">
      <button type="button" :aria-pressed="identityMethod === 'totp'" @click="identityMethod = 'totp'; code = ''; error = ''">{{ copy.totpMethod }}</button>
      <button type="button" :aria-pressed="identityMethod === 'email'" @click="identityMethod = 'email'; code = ''; error = ''">{{ copy.emailMethod }}</button>
    </div>
    <p v-if="identityMethod === 'email'" class="field-hint">{{ copy.emailSent }} {{ identityEmail }}。</p>
    <button v-if="identityMethod === 'email' && !identityCodeSent" class="cta ghost" type="button" :disabled="busy" @click="sendIdentityCode">
      {{ copy.sendIdentityCode }}
    </button>
    <button v-else-if="identityMethod === 'email'" class="cta ghost" type="button" :disabled="busy" @click="sendIdentityCode">
      {{ copy.resendIdentityCode }}
    </button>
    <div v-if="identityMethod === 'totp' || identityCodeSent" class="field">
      <label for="security-identity-code">{{ t('auth.register.sixDigits') }}</label>
      <input id="security-identity-code" v-model="code" class="input" type="text" inputmode="numeric" maxlength="6" autocomplete="one-time-code" :placeholder="t('auth.register.sixDigits')">
    </div>
    <p v-if="notice" class="notice" data-tone="accent" role="status">{{ notice }}</p>
    <p v-if="error" class="field-error" role="alert">{{ error }}</p>
    <div class="row" data-gap="sm">
      <button class="cta" type="button" :disabled="busy || (identityMethod === 'email' && !identityCodeSent)" @click="verifyIdentity">{{ copy.verifyAndContinue }}</button>
      <button class="cta ghost" type="button" :disabled="busy" @click="closeSheet()">{{ t('common.cancel') }}</button>
    </div>
  </div>

  <div v-else-if="view === 'change-email'" class="form" data-gap="sm">
    <p class="field-hint">{{ t('security.setup.replaceAfterCode') }}</p>
    <div class="field">
      <label for="security-sheet-email">{{ t('auth.register.email') }}</label>
      <input
        id="security-sheet-email"
        v-model="email"
        class="input"
        type="email"
        autocomplete="email"
        :disabled="Boolean(pendingEmail) || busy"
        :placeholder="t('auth.register.emailPlaceholder')"
      >
    </div>
    <p v-if="pendingEmail" class="field-hint">{{ copy.emailSent }} {{ pendingEmail }} · {{ copy.emailCodeExpiry }}</p>
    <div v-if="pendingEmail" class="field">
      <label for="security-sheet-email-code">{{ t('auth.register.sixDigits') }}</label>
      <input id="security-sheet-email-code" v-model="code" class="input" type="text" inputmode="numeric" maxlength="6" autocomplete="one-time-code" :placeholder="t('auth.register.sixDigits')">
    </div>
    <p v-if="notice" class="notice" data-tone="accent" role="status">{{ notice }}</p>
    <p v-if="error" class="field-error" role="alert">{{ error }}</p>
    <div class="row" data-gap="sm">
      <button v-if="!pendingEmail" class="cta" type="button" :disabled="busy" @click="sendEmailCode">{{ t('auth.forgot.sendCode') }}</button>
      <template v-else>
        <button class="cta" type="button" :disabled="busy" @click="submit">{{ t('security.setup.confirmChange') }}</button>
        <button v-if="identityScope" class="cta ghost" type="button" :disabled="busy" @click="requestEmailResend">{{ copy.resendIdentityCode }}</button>
        <button class="cta ghost" type="button" :disabled="busy" @click="changeEmail">{{ copy.changeAddress }}</button>
      </template>
      <button class="cta ghost" type="button" :disabled="busy" @click="closeSheet()">{{ t('common.cancel') }}</button>
    </div>
  </div>

  <div v-else-if="view === 'email-factor'" class="form" data-gap="sm">
    <p class="field-hint">{{ t('security.setup.enableTwoFactor') }}：{{ copy.emailSent }} {{ maskedEmail }} · {{ copy.emailCodeExpiry }}</p>
    <div class="field">
      <label for="security-sheet-factor-code">{{ t('auth.register.sixDigits') }}</label>
      <input id="security-sheet-factor-code" v-model="code" class="input" type="text" inputmode="numeric" maxlength="6" autocomplete="one-time-code" :placeholder="t('auth.register.sixDigits')">
    </div>
    <p v-if="error" class="field-error" role="alert">{{ error }}</p>
    <div class="row" data-gap="sm">
      <button class="cta" type="button" :disabled="busy" @click="submit">{{ t('security.setup.confirmEnable') }}</button>
      <button class="cta ghost" type="button" :disabled="busy" @click="closeSheet()">{{ t('common.cancel') }}</button>
    </div>
  </div>

  <div v-else-if="view === 'totp'" class="form" data-gap="sm">
    <p class="field-hint">{{ qrError ? `${qrError}，${copy.manualSecret}` : t('security.setup.scanOrEnter') }}</p>
    <div class="qr-wrap"><QrCanvas :text="otpauthUri || ''" :size="200" @error="qrError = $event" /></div>
    <code class="qr-code-text">{{ secretGroups }}</code>
    <div class="field">
      <label for="security-sheet-totp-code">{{ t('auth.register.sixDigits') }}</label>
      <input id="security-sheet-totp-code" v-model="code" class="input" type="text" inputmode="numeric" maxlength="6" autocomplete="one-time-code" :placeholder="t('auth.register.sixDigits')">
    </div>
    <p v-if="error" class="field-error" role="alert">{{ error }}</p>
    <div class="row" data-gap="sm">
      <button class="cta" type="button" :disabled="busy" @click="submit">{{ t('security.setup.confirmBind') }}</button>
      <button class="cta ghost" type="button" :disabled="busy" @click="closeSheet()">{{ t('common.cancel') }}</button>
    </div>
  </div>

  <div v-else-if="view === 'password'" class="form" data-gap="sm">
    <p class="field-hint">{{ action === 'disable' ? t('security.setup.disableNeedsPassword') : t('security.backupCodesInvalidate') }}</p>
    <div class="field">
      <label for="security-sheet-password">{{ t('security.setup.currentPassword') }}</label>
      <input id="security-sheet-password" v-model="password" class="input" type="password" autocomplete="current-password" :placeholder="t('auth.login.passwordPlaceholder')">
    </div>
    <p v-if="error" class="field-error" role="alert">{{ error }}</p>
    <div class="row" data-gap="sm">
      <button class="cta" type="button" :disabled="busy" @click="submit">{{ t('security.generateBackupCodes') }}</button>
      <button class="cta ghost" type="button" :disabled="busy" @click="closeSheet()">{{ t('common.cancel') }}</button>
    </div>
  </div>

  <div v-else-if="view === 'identity-only'" class="form" data-gap="sm">
    <p class="field-hint">{{ copy.disableDescription }}</p>
    <p v-if="error" class="field-error" role="alert">{{ error }}</p>
    <div class="row" data-gap="sm">
      <button class="cta danger" type="button" :disabled="busy" @click="submit">{{ t('security.confirmDisable') }}</button>
      <button class="cta ghost" type="button" :disabled="busy" @click="closeSheet()">{{ t('common.cancel') }}</button>
    </div>
  </div>

  <div v-else-if="view === 'change-password'" class="form" data-gap="sm">
    <p class="field-hint">{{ copy.passwordLength }} {{ passwordMin }}–{{ passwordMax }} {{ copy.passwordCharacters }}</p>
    <div class="field">
      <label for="security-sheet-new-password">{{ copy.newPassword }}</label>
      <input id="security-sheet-new-password" v-model="newPassword" class="input" type="password" autocomplete="new-password" :maxlength="passwordMax">
    </div>
    <div class="field">
      <label for="security-sheet-confirm-password">{{ copy.confirmPassword }}</label>
      <input id="security-sheet-confirm-password" v-model="confirmPassword" class="input" type="password" autocomplete="new-password" :maxlength="passwordMax">
    </div>
    <p v-if="error" class="field-error" role="alert">{{ error }}</p>
    <div class="row" data-gap="sm">
      <button class="cta" type="button" :disabled="busy" @click="submitPassword">{{ copy.changePassword }}</button>
      <button class="cta ghost" type="button" :disabled="busy" @click="closeSheet()">{{ t('common.cancel') }}</button>
    </div>
  </div>

  <div v-else class="stack" data-gap="sm">
    <strong>{{ t('security.setup.writeBackupCodes') }}</strong>
    <p class="field-hint">{{ t('security.setup.backupCodesOnce') }}</p>
    <div class="stack" data-gap="xs"><code v-for="item in backupCodes" :key="item" class="qr-code-text">{{ item }}</code></div>
    <button class="cta" type="button" @click="closeSheet()">{{ t('security.setup.writtenDown') }}</button>
  </div>
</template>
