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
import AppIcon from '@/components/AppIcon.vue';
import SkeletonBlock from '@/components/SkeletonBlock.vue';
import StateBlock from '@/components/StateBlock.vue';
import SegControl from '@/components/SegControl.vue';
import type { JsonObject } from '@/api/types';
import { t } from '@/i18n';

type FactorMode = 'off' | 'totp' | 'email';
type SheetAction =
  | 'email-factor-start'
  | 'email-send'
  | 'email-verify'
  | 'factor-email'
  | 'factor-totp'
  | 'disable'
  | 'password-change'
  | 'regenerate';
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
const availableModeOptions = computed(() =>
  modeOptions.map((option) => ({
    ...option,
    disabled: option.value !== 'off' && !canEnable.value && option.value !== activeMode.value,
  })),
);
const emailLabel = computed(() => {
  const email = String(info.email || '');
  if (!email) return t('security.email.unbound');
  return info.emailVerified === true
    ? t('security.email.verified', { email })
    : t('security.email.unverified', { email });
});
const methodHint = computed(() => {
  if (!enabled.value) return canEnable.value ? t('security.chooseMethod') : t('security.email.unavailable');
  const name = activeMode.value === 'totp' ? t('security.totp.recommended') : t('security.email.enableWithCode');
  return t('security.methodSummary', { method: name, codes: Number(info.backupCodesLeft) || 0 });
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
      verifyIdentity: (method: IdentityMethod, code: string, scope: IdentityScope) =>
        verifyIdentity(method, code, scope, options.kind),
      onIdentityFailure: () => {
        selectedMode.value = activeMode.value;
      },
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
        session.applyUser({ ...session.user, ...(result.user as JsonObject | undefined) });
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
    title: t('security.email.change'),
    kind: 'change-email',
    action: 'email-send',
    identityScope: 'email',
    totpAvailable: totpEnabled.value,
    maskedEmail: maskedCurrentEmail(),
  });
}

function openPasswordChange(): void {
  openFormSheet({
    title: t('security.password.change'),
    kind: 'change-password',
    action: 'password-change',
    identityScope: 'password',
    totpAvailable: totpEnabled.value,
    maskedEmail: maskedCurrentEmail(),
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
      onClose: () => {
        selectedMode.value = activeMode.value;
      },
      actions: [
        {
          label: t('common.cancel'),
          onClick: (close) => {
            close();
            selectedMode.value = previous;
          },
        },
        {
          label: t('security.confirmDisable'),
          variant: 'danger',
          onClick: (close) => {
            close();
            selectedMode.value = 'off';
            openFormSheet({
              title: t('security.confirmDisable'),
              kind: 'identity-only',
              action: 'disable',
              identityScope: 'factor',
              totpAvailable: totpEnabled.value,
              maskedEmail: maskedCurrentEmail(),
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
        title: t('security.email.enableWithCode'),
        kind: 'email-factor',
        action: 'factor-email',
        identityScope: 'factor',
        totpAvailable: totpEnabled.value,
        maskedEmail: maskedCurrentEmail(),
      });
    } else if (totpEnabled.value) {
      const activated = await api.security.activateTotp();
      assertOk(activated);
      await refresh();
      notice.value = t('security.totp.bound');
      toast(t('security.totp.bound'), 'success');
    } else {
      openFormSheet({
        title: t('security.totp.recommended'),
        kind: 'totp',
        action: 'factor-totp',
        identityScope: 'totp',
        totpAvailable: false,
        maskedEmail: maskedCurrentEmail(),
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
    title: t('security.regenerateBackupCodes'),
    message: t('security.backupCodesInvalidate'),
    actions: [
      { label: t('common.cancel'), onClick: (close) => close() },
      {
        label: t('security.generateBackupCodes'),
        variant: 'danger',
        onClick: (close) => {
          close();
          openFormSheet({ title: t('security.regenerateBackupCodes'), kind: 'password', action: 'regenerate' });
        },
      },
    ],
  });
}

async function rebindTotp(): Promise<void> {
  openFormSheet({
    title: copy.rotateTotp,
    kind: 'totp',
    action: 'factor-totp',
    identityScope: 'totp',
    totpAvailable: totpEnabled.value,
    maskedEmail: maskedCurrentEmail(),
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
    <!-- 账号安全清单：密码 / 邮箱 / 两步验证 / 登录设备，每项一条行卡，
         左侧图标 + 中间标题与状态说明 + 右端动作，旧的卡片分组头去掉。 -->
    <div class="security-page">
      <p v-if="error" class="notice" data-tone="error" role="alert">{{ error }}</p>
      <p v-if="notice" class="notice" data-tone="ok" role="status">{{ notice }}</p>

      <!-- 密码 -->
      <button class="row-card security-row" type="button" data-pressable="true" @click="openPasswordChange">
        <span class="security-icon" aria-hidden="true"><AppIcon name="lock" /></span>
        <span class="row-copy">
          <strong class="row-title">{{ copy.passwordTitle }}</strong>
          <span class="row-meta">{{ copy.passwordDescription }}</span>
        </span>
        <span class="security-action">{{ t('security.password.change') }}</span>
      </button>

      <!-- 邮箱 -->
      <button class="row-card security-row" type="button" data-pressable="true" @click="openEmailChange">
        <span class="security-icon" aria-hidden="true"><AppIcon name="mail" /></span>
        <span class="row-copy">
          <strong class="row-title">{{ t('auth.register.email') }}</strong>
          <span class="row-meta truncate">{{ emailLabel }}</span>
        </span>
        <span class="security-action">{{ copy.changeEmail }}</span>
      </button>

      <!-- 两步验证：三选一的分段控件就是状态说明；它横跨整行，窄屏下三个选项才放得下 -->
      <section class="row-card security-row security-factor">
        <span class="security-icon" aria-hidden="true"><AppIcon name="shield" /></span>
        <div class="factor-body">
          <strong class="row-title">{{ t('auth.login.twoFactor') }}</strong>
          <p class="field-hint">{{ methodHint }}</p>
        </div>
        <SegControl
          :items="availableModeOptions"
          :model-value="selectedMode"
          :disabled="busy"
          :label="t('auth.login.twoFactor')"
          @update:model-value="(value: string) => chooseMode(value as FactorMode)"
        />
        <div v-if="enabled || totpEnabled" class="security-actions">
          <button v-if="enabled" class="text-action" type="button" :disabled="busy" @click="askRegenerate">
            {{ t('security.regenerateBackupCodes') }}
          </button>
          <button v-if="totpEnabled" class="text-action" type="button" :disabled="busy" @click="rebindTotp">
            {{ copy.rotateTotp }}
          </button>
        </div>
      </section>

      <!-- 登录设备：列出当前账号的活动会话，可远程下线 -->
      <button
        class="row-card security-row"
        type="button"
        data-pressable="true"
        @click="router.push('/security/devices')"
      >
        <span class="security-icon" aria-hidden="true"><AppIcon name="device" /></span>
        <span class="row-copy">
          <strong class="row-title">{{ copy.devicesTitle }}</strong>
          <span class="row-meta">{{ copy.devicesDescription }}</span>
        </span>
        <span class="security-action">{{ copy.manageDevices }}</span>
      </button>
    </div>
  </template>
</template>

<style>
/* 清单：行与行之间 --s2，整列直接排在纸面上。 */
.security-page {
  display: flex;
  flex-direction: column;
  gap: var(--s2);
}

.security-icon {
  flex: none;
  display: inline-flex;
  color: var(--ink-3);
}

/* 右端动作：小字距标签，点整行都会打开对应抽屉。 */
.security-action {
  flex: none;
  color: var(--ink-3);
  font-size: var(--fs-label);
  font-weight: 700;
  letter-spacing: 0.04em;
  white-space: nowrap;
}

/* 两步验证块内容更多：左侧图标 + 右侧内容，分段控件与动作横跨整行。 */
.security-page .security-factor {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr);
  align-items: start;
  gap: var(--s3);
}

.factor-body {
  display: grid;
  gap: var(--s2);
  min-width: 0;
}

.security-factor > .seg,
.security-actions {
  grid-column: 1 / -1;
}

/* 三选一在窄行里要放得下：行内边距收窄一档，仍用令牌。 */
.security-factor .seg button {
  padding-inline: var(--s2);
}

/* 备用码相关操作：两颗文字按钮，行内排。 */
.security-actions {
  display: flex;
  flex-wrap: wrap;
  gap: var(--s1) var(--s3);
}

.security-actions .text-action {
  min-height: var(--touch);
  padding-inline: 0;
}
</style>
