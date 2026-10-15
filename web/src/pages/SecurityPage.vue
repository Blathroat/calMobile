<script setup lang="ts">
/** 邮箱、两步验证方式与活动设备入口。带输入的安全操作统一通过全局抽屉完成。 */
import { computed, onMounted, reactive, ref } from 'vue';
import { useRouter } from 'vue-router';
import { api } from '@/app/runtime';
import { useSessionStore } from '@/stores/session';
import { useBootstrapStore } from '@/stores/bootstrap';
import { toast } from '@/services/toast';
import { openSheet } from '@/services/sheet';
import SecuritySetupSheet from '@/components/SecuritySetupSheet.vue';
import SkeletonBlock from '@/components/SkeletonBlock.vue';
import StateBlock from '@/components/StateBlock.vue';
import SegControl from '@/components/SegControl.vue';
import type { JsonObject } from '@/api/types';
import { t } from '@/i18n';

type FactorMode = 'off' | 'totp' | 'email';
type SheetAction = 'email-factor-start' | 'email-send' | 'email-verify' | 'factor-email' | 'factor-totp' | 'disable' | 'password-change' | 'regenerate';
type IdentityScope = 'password' | 'email' | 'totp' | 'factor';
type IdentityMethod = 'email' | 'totp';
const modeOptions: Array<{ value: FactorMode; label: string }> = [
  { value: 'off', label: t('common.close') },
  { value: 'totp', label: t('security.totp.recommended') },
  { value: 'email', label: t('auth.login.emailCode') },
];
const copy = {
  changeEmail: t('security.email.change'),
  devicesTitle: t('security.devices.title'),
  devicesDescription: t('security.viewDevices'),
  manageDevices: t('security.manageDevices'),
  passwordTitle: t('security.password.account'),
  passwordDescription: t('security.password.changeLogin'),
  passwordChanged: t('security.password.updatedSignIn'),
  rotateTotp: t('security.totp.rotate'),
  disableDescription: t('security.disableKeepsAuthenticator'),
};

const router = useRouter();
const session = useSessionStore();
const bootstrap = useBootstrapStore();
const info = reactive<JsonObject>({});
const loading = ref(true);
const loadError = ref('');
const error = ref('');
const notice = ref('');
const busy = ref(false);
const selectedMode = ref<FactorMode>('off');
let drawerCommitted = false;

const enabled = computed(() => info.twoFactorEnabled === true);
const totpEnabled = computed(() => info.totpEnabled === true);
const canEnable = computed(() => info.canEnable === true);
const activeMode = computed<FactorMode>(() => {
  if (!enabled.value) return 'off';
  return info.twoFactorMethod === 'totp' ? 'totp' : 'email';
});
const availableModeOptions = computed(() => modeOptions.map((option) => ({
  ...option,
  disabled: option.value !== 'off' && !canEnable.value && option.value !== activeMode.value,
})));
const emailLabel = computed(() => {
  const email = String(info.email || '');
  if (!email) return t('security.email.unbound');
  return `${email}${info.emailVerified === true ? t('security.email.verified') : t('security.email.unverified')}`;
});
const methodHint = computed(() => {
  if (!enabled.value) return canEnable.value ? t('security.chooseMethod') : t('security.email.unavailable');
  const name = activeMode.value === 'totp' ? t('security.totp.recommended') : t('security.email.enableWithCode');
  return `${t('security.currentMethod')}：${name}；${t('security.backupCodesLeft')} ${Number(info.backupCodesLeft) || 0} ${t('admin.limits.items')}`;
});

function errorText(reason: unknown): string {
  return reason instanceof Error && reason.message ? reason.message : t('auth.register.failed');
}

function assertOk(result: JsonObject): void {
  if (result.ok === false) throw new Error(String(result.error || t('auth.register.failed')));
}

async function load(): Promise<void> {
  loading.value = true;
  loadError.value = '';
  try {
    Object.assign(info, await api.security.get());
    selectedMode.value = activeMode.value;
  } catch (reason) {
    loadError.value = errorText(reason);
  } finally {
    loading.value = false;
  }
}

async function refresh(): Promise<void> {
  Object.assign(info, await api.security.get());
  selectedMode.value = activeMode.value;
}

onMounted(load);

function openFormSheet(options: {
  title: string;
  kind: 'change-email' | 'email-factor' | 'totp' | 'password' | 'change-password' | 'identity-only';
  action: SheetAction;
  identityScope?: IdentityScope;
  totpAvailable?: boolean;
  initialEmail?: string;
  maskedEmail?: string;
  secret?: string;
  otpauthUri?: string;
}): void {
  drawerCommitted = false;
  openSheet({
    title: options.title,
    component: SecuritySetupSheet,
    size: 'full',
    onClose: () => {
      if (!drawerCommitted) selectedMode.value = activeMode.value;
    },
    props: {
      kind: options.kind,
      action: options.action,
      initialEmail: options.initialEmail,
      maskedEmail: options.maskedEmail,
      secret: options.secret,
      otpauthUri: options.otpauthUri,
      identityScope: options.identityScope,
      totpAvailable: options.totpAvailable,
      passwordMin: Number(bootstrap.limits.passwordMin) || 6,
      passwordMax: Number(bootstrap.limits.passwordMax) || 32,
      sendIdentityCode: requestIdentityCode,
      verifyIdentity: (method: IdentityMethod, code: string, scope: IdentityScope) => verifyIdentity(method, code, scope, options.kind),
      onIdentityFailure: () => { selectedMode.value = activeMode.value; },
      submitAction: submitSheetAction,
    },
  });
}

async function submitSheetAction(payload: {
  action: string;
  email?: string;
  code?: string;
  password?: string;
  newPassword?: string;
  confirmPassword?: string;
  stepUpToken?: string;
}): Promise<{ pendingEmail?: string; backupCodes?: string[]; maskedEmail?: string; close?: boolean }> {
  let result: JsonObject;
  try {
    switch (payload.action as SheetAction) {
    case 'email-factor-start':
      result = await api.security.enableTwoFactor(String(payload.stepUpToken || ''));
      assertOk(result);
      return { maskedEmail: String(result.maskedEmail || maskedCurrentEmail()), close: false };
    case 'email-send':
      try {
        result = await api.security.changeEmail(String(payload.email || ''), String(payload.stepUpToken || ''));
        assertOk(result);
        return { pendingEmail: String(result.email || payload.email || ''), close: false };
      } catch (reason) {
        const failed = reason instanceof Error ? reason : new Error(errorText(reason));
        Object.assign(failed, { pendingEmail: String(payload.email || '') });
        throw failed;
      }
    case 'email-verify':
      result = await api.security.verifyEmail(String(payload.email || ''), String(payload.code || ''));
      assertOk(result);
      session.applyUser({ ...session.user, ...(result.user as JsonObject | undefined ?? {}) });
      drawerCommitted = true;
      await refresh();
      notice.value = t('security.email.changed');
      toast(t('security.email.changed'), 'success');
      return { close: true };
    case 'factor-email':
      result = await api.security.verifyTwoFactor(String(payload.code || ''));
      assertOk(result);
      drawerCommitted = true;
      await refresh();
      notice.value = t('security.twoFactorOn');
      toast(t('security.twoFactorOn'), 'success');
      return { backupCodes: Array.isArray(result.backupCodes) ? result.backupCodes.map(String) : [], close: true };
    case 'factor-totp':
      result = await api.security.totpEnable(String(payload.code || ''), String(payload.stepUpToken || ''));
      assertOk(result);
      drawerCommitted = true;
      await refresh();
      notice.value = t('security.totp.bound');
      toast(t('security.totp.bound'), 'success');
      return { backupCodes: Array.isArray(result.backupCodes) ? result.backupCodes.map(String) : [], close: true };
    case 'disable':
      result = await api.security.disableTwoFactor(String(payload.stepUpToken || ''));
      assertOk(result);
      drawerCommitted = true;
      await refresh();
      notice.value = t('security.twoFactorOff');
      toast(t('security.twoFactorOff'), 'success');
      return { close: true };
    case 'password-change':
      result = await api.profile.changePassword({
        newPassword: payload.newPassword,
        confirmPassword: payload.confirmPassword,
        stepUpToken: payload.stepUpToken,
      });
      assertOk(result);
      drawerCommitted = true;
      api.session.clear();
      session.clear();
      toast(copy.passwordChanged, 'success');
      void router.replace('/login');
      return { close: true };
    case 'regenerate':
      result = await api.security.backupCodes(String(payload.password || ''));
      assertOk(result);
      drawerCommitted = true;
      await refresh();
      return { backupCodes: Array.isArray(result.backupCodes) ? result.backupCodes.map(String) : [], close: true };
    default:
      throw new Error(t('auth.register.failed'));
    }
  } catch (reason) {
    if (['factor-email', 'factor-totp', 'disable'].includes(payload.action)) selectedMode.value = activeMode.value;
    throw reason;
  }
}

function maskedCurrentEmail(): string {
  const email = String(info.email || '');
  const at = email.indexOf('@');
  if (at <= 0) return email ? '***' : '';
  return `${email.slice(0, Math.min(2, at))}***${email.slice(at)}`;
}

async function requestIdentityCode(): Promise<string> {
  const result = await api.security.identityEmailCode();
  assertOk(result);
  return String(result.maskedEmail || maskedCurrentEmail());
}

async function verifyIdentity(method: IdentityMethod, code: string, scope: IdentityScope, kind: string) {
  const verified = await api.security.verifyIdentity(method, code, scope);
  assertOk(verified);
  const stepUpToken = String(verified.stepUpToken || '');
  if (!stepUpToken) throw new Error(t('auth.register.failed'));

  if (scope === 'totp') {
    const setup = await api.security.totpSetup(stepUpToken);
    assertOk(setup);
    return {
      stepUpToken: String(setup.stepUpToken || ''),
      secret: String(setup.secret || ''),
      otpauthUri: String(setup.otpauthUri || ''),
    };
  }
  if (scope === 'factor') {
    if (kind === 'identity-only') {
      const disabled = await api.security.disableTwoFactor(stepUpToken);
      assertOk(disabled);
      drawerCommitted = true;
      await refresh();
      notice.value = t('security.twoFactorOff');
      toast(t('security.twoFactorOff'), 'success');
      return { stepUpToken: '', complete: true };
    }
    return { stepUpToken };
  }
  return { stepUpToken };
}

function openEmailChange(): void {
  error.value = '';
  openFormSheet({
    title: t('security.email.change'), kind: 'change-email', action: 'email-send',
    identityScope: 'email', totpAvailable: totpEnabled.value, maskedEmail: maskedCurrentEmail(),
  });
}

function openPasswordChange(): void {
  openFormSheet({
    title: t('security.password.change'), kind: 'change-password', action: 'password-change',
    identityScope: 'password', totpAvailable: totpEnabled.value, maskedEmail: maskedCurrentEmail(),
  });
}

async function chooseMode(target: FactorMode): Promise<void> {
  if (busy.value || target === activeMode.value) return;
  const previous = activeMode.value;
  selectedMode.value = target;
  error.value = '';
  notice.value = '';
  if (target === 'off') {
    openSheet({
      title: t('security.confirmDisable'),
      message: copy.disableDescription,
      onClose: () => { selectedMode.value = activeMode.value; },
      actions: [
        { label: t('common.cancel'), onClick: (close) => { close(); selectedMode.value = previous; } },
        {
          label: t('security.confirmDisable'), variant: 'danger',
          onClick: (close) => {
            close();
            selectedMode.value = 'off';
            openFormSheet({
              title: t('security.confirmDisable'), kind: 'identity-only', action: 'disable',
              identityScope: 'factor', totpAvailable: totpEnabled.value, maskedEmail: maskedCurrentEmail(),
            });
          },
        },
      ],
    });
    return;
  }
  if (!canEnable.value) {
    selectedMode.value = previous;
    error.value = t('security.email.unavailable');
    return;
  }

  busy.value = true;
  try {
    if (target === 'email') {
      openFormSheet({
        title: t('security.email.enableWithCode'), kind: 'email-factor', action: 'factor-email',
        identityScope: 'factor', totpAvailable: totpEnabled.value, maskedEmail: maskedCurrentEmail(),
      });
    } else if (totpEnabled.value) {
      const activated = await api.security.activateTotp();
      assertOk(activated);
      await refresh();
      notice.value = t('security.totp.bound');
      toast(t('security.totp.bound'), 'success');
    } else {
      openFormSheet({
        title: t('security.totp.recommended'), kind: 'totp', action: 'factor-totp',
        identityScope: 'totp', totpAvailable: false, maskedEmail: maskedCurrentEmail(),
      });
    }
  } catch (reason) {
    selectedMode.value = previous;
    error.value = errorText(reason);
  } finally {
    busy.value = false;
  }
}

function askRegenerate(): void {
  openSheet({
    title: t('security.regenerateBackupCodes'), message: t('security.backupCodesInvalidate'),
    actions: [
      { label: t('common.cancel'), onClick: (close) => close() },
      { label: t('security.generateBackupCodes'), variant: 'danger', onClick: (close) => {
        close();
        openFormSheet({ title: t('security.regenerateBackupCodes'), kind: 'password', action: 'regenerate' });
      } },
    ],
  });
}

async function rebindTotp(): Promise<void> {
  openFormSheet({
    title: copy.rotateTotp, kind: 'totp', action: 'factor-totp',
    identityScope: 'totp', totpAvailable: totpEnabled.value, maskedEmail: maskedCurrentEmail(),
  });
}
</script>

<template>
  <SkeletonBlock v-if="loading" :rows="3" />
  <StateBlock
    v-else-if="loadError"
    tone="error"
    :title="t('security.profileLoadFailed')"
    :description="loadError"
    :action-label="t('common.retry')"
    @action="load"
  />
  <template v-else>
    <div class="card">
      <span class="section-label">{{ t('security.section') }}</span>
      <p v-if="error" class="field-error" role="alert">{{ error }}</p>
      <p v-if="notice" class="notice" data-tone="accent" role="status">{{ notice }}</p>

      <div class="row" data-between="true">
        <span class="row-copy">
          <span class="row-title">{{ t('auth.register.email') }}</span>
          <span class="row-meta truncate">{{ emailLabel }}</span>
        </span>
        <button class="cta ghost" data-size="small" type="button" :disabled="busy" @click="openEmailChange">{{ copy.changeEmail }}</button>
      </div>

      <div class="stack" data-gap="xs">
        <span class="row-title">{{ t('auth.login.twoFactor') }}</span>
        <SegControl :items="availableModeOptions" :model-value="selectedMode" :disabled="busy" :label="t('auth.login.twoFactor')" @update:model-value="(value) => chooseMode(value as FactorMode)" />
      </div>
      <p class="field-hint">{{ methodHint }}</p>

      <div v-if="enabled || totpEnabled" class="row" data-gap="sm">
        <button v-if="enabled" class="cta ghost" data-size="small" type="button" :disabled="busy" @click="askRegenerate">{{ t('security.regenerateBackupCodes') }}</button>
        <button v-if="totpEnabled" class="cta ghost" data-size="small" type="button" :disabled="busy" @click="rebindTotp">{{ copy.rotateTotp }}</button>
      </div>
    </div>

    <div class="card">
      <span class="section-label">{{ copy.passwordTitle }}</span>
      <button class="row-card" type="button" data-pressable="true" @click="openPasswordChange">
        <span class="row-copy">
          <strong class="row-title">{{ t('security.password.change') }}</strong>
          <span class="row-meta">{{ copy.passwordDescription }}</span>
        </span>
        <span class="dim" aria-hidden="true">›</span>
      </button>
    </div>

    <div class="card">
      <span class="section-label">{{ copy.devicesTitle }}</span>
      <p class="field-hint">{{ copy.devicesDescription }}</p>
      <button class="cta ghost" type="button" @click="router.push('/security/devices')">{{ copy.manageDevices }}</button>
    </div>
  </template>
</template>
