<script setup lang="ts">
/** 邮箱、两步验证方式与活动设备入口。带输入的安全操作统一通过全局抽屉完成。 */
import { computed, onMounted, reactive, ref } from 'vue';
import { useRouter } from 'vue-router';
import { api } from '@/app/runtime';
import { useSessionStore } from '@/stores/session';
import { useBootstrapStore } from '@/stores/bootstrap';
import { toast } from '@/services/toast';
import { openSheet } from '@/services/sheet';
import { formatLocalChineseDate } from '@/services/format';
import { createCredential, isPasskeySupported } from '@/services/webauthn';
import { nativeBridge } from '@/services/native-bridge';
import SecuritySetupSheet from '@/components/SecuritySetupSheet.vue';
import AppIcon from '@/components/AppIcon.vue';
import SkeletonBlock from '@/components/SkeletonBlock.vue';
import StateBlock from '@/components/StateBlock.vue';
import SegControl from '@/components/SegControl.vue';
import type { JsonObject } from '@/api/types';
import { t } from '@/i18n';

type FactorMode = 'off' | 'passkey' | 'totp' | 'email';
type SheetAction =
  | 'email-factor-start'
  | 'email-send'
  | 'email-verify'
  | 'factor-email'
  | 'factor-totp'
  | 'disable'
  | 'password-change'
  | 'regenerate'
  | 'passkey-add'
  | 'passkey-enable';
type IdentityScope = 'password' | 'email' | 'totp' | 'factor';
type IdentityMethod = 'email' | 'totp';
/** 已绑定的一枚通行密钥，时间在渲染前先格式化好。 */
interface PasskeyRow {
  id: string;
  name: string;
  createdLabel: string;
  lastUsedLabel: string;
}
// 通行密钥排第一并带「推荐」；TOTP 把原来的「推荐」让出来。
const modeOptions: Array<{ value: FactorMode; label: string }> = [
  { value: 'off', label: t('common.close') },
  { value: 'passkey', label: `${t('security.passkey.title')} · ${t('security.passkey.recommended')}` },
  { value: 'totp', label: 'TOTP' },
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
/** 当前环境能不能唤起系统通行密钥（安全上下文 + 原生接口）。 */
const passkeySupported = ref(isPasskeySupported());
/** 正在删除的凭据 id：期间禁用该行按钮，避免重复提交。 */
const removingPasskeyId = ref('');
let drawerCommitted = false;

const enabled = computed(() => info.twoFactorEnabled === true);
const totpEnabled = computed(() => info.totpEnabled === true);
const canEnable = computed(() => info.canEnable === true);
const activeMode = computed<FactorMode>(() => {
  if (!enabled.value) return 'off';
  if (info.twoFactorMethod === 'passkey') return 'passkey';
  return info.twoFactorMethod === 'totp' ? 'totp' : 'email';
});
const passkeyRows = computed<PasskeyRow[]>(() => {
  const list: unknown[] = Array.isArray(info.passkeys) ? info.passkeys : [];
  return list
    .filter((item): item is JsonObject => typeof item === 'object' && item !== null)
    .map((item) => {
      const created = formatLocalChineseDate(item.createdAt);
      const used = formatLocalChineseDate(item.lastUsedAt);
      return {
        id: String(item.id ?? ''),
        name: String(item.name ?? '') || t('security.passkey.defaultName'),
        createdLabel: created ? t('security.passkey.createdAt', { time: created }) : '',
        lastUsedLabel: used ? t('security.passkey.lastUsed', { time: used }) : t('security.passkey.neverUsed'),
      };
    });
});
/** 服务端标记或列表任一条都算「已绑定至少一枚」。 */
const passkeyBound = computed(() => info.passkeyBound === true || passkeyRows.value.length > 0);
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
/** 还能用的备用码数量：0 是「最后一道退路没了」，界面要明说。 */
const backupCount = computed(() => Number(info.backupCodesLeft) || 0);
const methodHint = computed(() => {
  if (!enabled.value) return canEnable.value ? t('security.chooseMethod') : t('security.email.unavailable');
  const name =
    activeMode.value === 'totp'
      ? 'TOTP'
      : activeMode.value === 'passkey'
        ? t('security.passkey.title')
        : t('security.email.enableWithCode');
  // 0 枚时不再说「还剩 0 个」：下面那条提示负责把话说清楚。
  return backupCount.value > 0
    ? t('security.methodSummary', { method: name, codes: backupCount.value })
    : t('security.methodSummaryNoCodes', { method: name });
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

onMounted(() => {
  void load();
  void probePasskeySupport();
});

/**
 * App 里 `isPasskeySupported()` 只能说「有原生桥」，真正有没有凭据提供方要在设备上问一次。
 * 探测失败（动作不存在、设备没有 Play 服务等）时按不支持处理：按钮置灰并给出原因，
 * 不要让用户点开一个必然失败的流程。
 */
async function probePasskeySupport(): Promise<void> {
  if (!nativeBridge.hasNative() || !passkeySupported.value) return;
  try {
    const result = await nativeBridge.call('passkey.available', {});
    passkeySupported.value = result.supported === true;
  } catch {
    passkeySupported.value = false;
  }
}

function openFormSheet(options: {
  title: string;
  kind:
    | 'change-email'
    | 'email-factor'
    | 'totp'
    | 'password'
    | 'change-password'
    | 'identity-only'
    | 'passkey'
    | 'passkey-enable';
  action: SheetAction;
  identityScope?: IdentityScope;
  totpAvailable?: boolean;
  passwordHint?: string;
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
      passwordHint: options.passwordHint,
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
      case 'passkey-add': {
        const registered = await registerPasskey(String(payload.stepUpToken || ''));
        // 用户在系统面板里取消：静默收起抽屉，不当失败提示
        if (!registered) return { close: true };
        applyPasskeys(registered);
        drawerCommitted = true;
        await refresh();
        notice.value = t('security.passkey.added');
        toast(t('security.passkey.added'), 'success');
        return { close: true };
      }
      case 'passkey-enable': {
        result = await api.security.passkeyEnable(String(payload.stepUpToken || ''));
        assertOk(result);
        drawerCommitted = true;
        await refresh();
        // 切到通行密钥时服务端会补一批备用码（原本一枚都没有时）：当场展示一次，别让它只存在库里
        const codes = Array.isArray(result.backupCodes) ? result.backupCodes.map(String) : [];
        notice.value = t('security.passkey.methodHint');
        toast(t('security.passkey.methodHint'), 'success');
        return codes.length ? { backupCodes: codes, close: true } : { close: true };
      }
      default:
        throw new Error(t('auth.register.failed'));
    }
  } catch (reason) {
    if (['factor-email', 'factor-totp', 'disable', 'passkey-enable'].includes(payload.action)) {
      selectedMode.value = activeMode.value;
    }
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

/**
 * 绑定一枚通行密钥：身份复核票换注册选项 → 系统面板创建 → 只保存凭据。
 * 绑定本身不切换两步验证方式；用户取消时返回 null（不抛错）。
 */
async function registerPasskey(stepUpToken: string): Promise<JsonObject | null> {
  try {
    const challenge = await api.security.passkeyOptions(stepUpToken);
    const credential = await createCredential(challenge.options);
    if (!credential) return null;
    const registered = await api.security.passkeyRegister({
      challengeId: String(challenge.challengeId || ''),
      credential,
      name: t('security.passkey.defaultName'),
    });
    assertOk(registered);
    return registered;
  } catch (reason) {
    // 系统面板拒绝、验证过期、服务端规则失败都落在这一条：不再暴露底层英文报错
    if (reason instanceof Error && reason.name === 'ApiError') throw reason;
    throw new Error(t('security.passkey.failed'));
  }
}

/** 用列表接口的返回同步凭据，随后由 refresh() 对齐两步验证状态。 */
function applyPasskeys(result: JsonObject): void {
  if (Array.isArray(result.passkeys)) info.passkeys = result.passkeys;
  info.passkeyBound = Array.isArray(info.passkeys) ? info.passkeys.length > 0 : info.passkeyBound === true;
}

/** 打开添加通行密钥的身份复核抽屉。 */
function startAddPasskey(): void {
  if (!passkeySupported.value) return;
  error.value = '';
  notice.value = '';
  openFormSheet({
    title: t('security.passkey.add'),
    kind: 'passkey',
    action: 'passkey-add',
    identityScope: 'factor',
    totpAvailable: totpEnabled.value,
    maskedEmail: maskedCurrentEmail(),
  });
}

/** 删除一枚凭据：先确认，失败时直接展示服务端已本地化的文案。 */
function askRemovePasskey(passkey: PasskeyRow): void {
  openSheet({
    title: t('security.passkey.remove'),
    message: t('security.passkey.removeConfirm'),
    actions: [
      { label: t('common.cancel'), onClick: (close) => close() },
      {
        label: t('security.passkey.remove'),
        variant: 'danger',
        onClick: (close) => {
          close();
          void removePasskey(passkey);
        },
      },
    ],
  });
}

async function removePasskey(passkey: PasskeyRow): Promise<void> {
  if (removingPasskeyId.value) return;
  removingPasskeyId.value = passkey.id;
  error.value = '';
  try {
    const result = await api.security.passkeyRemove(passkey.id);
    assertOk(result);
    applyPasskeys(result);
    await refresh();
    notice.value = t('security.passkey.removed');
    toast(t('security.passkey.removed'), 'success');
  } catch (reason) {
    // 最后一枚且正作为两步验证方式时服务端会拒绝，文案已经是本机语言
    toast(reason instanceof Error && reason.message ? reason.message : t('security.passkey.failed'), 'error');
  } finally {
    removingPasskeyId.value = '';
  }
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
  if (target === 'passkey') {
    if (!passkeyBound.value) {
      selectedMode.value = previous;
      error.value = t('security.passkey.none');
      return;
    }
    // 已有凭据：先做一次身份复核，通过后才把两步验证方式切到通行密钥
    openFormSheet({
      title: t('security.passkey.title'),
      kind: 'passkey-enable',
      action: 'passkey-enable',
      identityScope: 'factor',
      totpAvailable: totpEnabled.value,
      maskedEmail: maskedCurrentEmail(),
    });
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
  // 一枚都没有时这是「第一次生成」：不要说「旧码会失效」，也就没有旧码可谈。
  const first = backupCount.value === 0;
  const title = first ? t('security.backupCodesCreate') : t('security.regenerateBackupCodes');
  openSheet({
    title,
    message: first ? t('security.backupCodesFirst') : t('security.backupCodesInvalidate'),
    actions: [
      { label: t('common.cancel'), onClick: (close) => close() },
      {
        label: title,
        variant: 'danger',
        onClick: (close) => {
          close();
          openFormSheet({
            title,
            kind: 'password',
            action: 'regenerate',
            ...(first ? { passwordHint: t('security.backupCodesFirst') } : {}),
          });
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

      <!-- 两步验证：四选一的分段控件就是状态说明；它横跨整行，窄屏下四个选项才放得下 -->
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
        <!-- 备用码是通行密钥 / 验证器丢失时唯一的退路：没有就明说，快用完也提醒 -->
        <p v-if="enabled && backupCount === 0" class="notice" data-tone="warn" role="status">
          {{ t('security.backupCodesMissing') }}
        </p>
        <p v-else-if="enabled && backupCount <= 2" class="notice" data-tone="warn" role="status">
          {{ t('security.backupCodesLow', { count: backupCount }) }}
        </p>
        <div v-if="enabled || totpEnabled" class="security-actions">
          <button v-if="enabled" class="text-action" type="button" :disabled="busy" @click="askRegenerate">
            {{ backupCount === 0 ? t('security.backupCodesCreate') : t('security.regenerateBackupCodes') }}
          </button>
          <button v-if="totpEnabled" class="text-action" type="button" :disabled="busy" @click="rebindTotp">
            {{ copy.rotateTotp }}
          </button>
        </div>
      </section>

      <!-- 通行密钥：这里只增删凭据，至于用它做两步验证，由上面的分段控件切换 -->
      <section class="row-card security-row security-passkey">
        <span class="security-icon" aria-hidden="true"><AppIcon name="lock" /></span>
        <div class="passkey-body">
          <strong class="row-title">{{ t('security.passkey.title') }}</strong>
          <p class="field-hint">{{ t('security.passkey.intro') }}</p>
          <ul v-if="passkeyRows.length > 0" class="passkey-list">
            <li v-for="item in passkeyRows" :key="item.id" class="passkey-item">
              <span class="passkey-copy">
                <strong class="passkey-name">{{ item.name }}</strong>
                <span class="row-meta">
                  <template v-if="item.createdLabel">{{ item.createdLabel }}</template>
                  <template v-if="item.createdLabel && item.lastUsedLabel"> · </template>
                  <template v-if="item.lastUsedLabel">{{ item.lastUsedLabel }}</template>
                </span>
              </span>
              <button
                class="text-action passkey-remove"
                type="button"
                :disabled="removingPasskeyId === item.id"
                :aria-label="`${t('security.passkey.remove')} ${item.name}`"
                @click="askRemovePasskey(item)"
              >
                {{ t('security.passkey.remove') }}
              </button>
            </li>
          </ul>
          <p v-else class="field-hint">{{ t('security.passkey.none') }}</p>
          <p v-if="!passkeySupported" class="field-hint">{{ t('security.passkey.unsupported') }}</p>
          <button
            class="cta ghost passkey-add"
            type="button"
            :disabled="!passkeySupported || Boolean(removingPasskeyId)"
            @click="startAddPasskey"
          >
            {{ t('security.passkey.add') }}
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
.security-factor > .notice,
.security-actions {
  grid-column: 1 / -1;
}

/* 提示块贴边铺满整行时不再额外加左右内距，卡片自己的内距已经够了。 */
.security-factor > .notice {
  margin: 0;
}

/* 四个选项在窄行里要放得下：行内边距收窄一档，仍用令牌。 */
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

/* 通行密钥块：图标 + 内容两列；凭据逐条排，底部整行是添加按钮。 */
.security-page .security-passkey {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr);
  align-items: start;
  gap: var(--s3);
}

.passkey-body {
  display: grid;
  gap: var(--s2);
  min-width: 0;
}

.passkey-list {
  display: grid;
  gap: var(--s2);
  margin: 0;
  padding: 0;
  list-style: none;
}

.passkey-item {
  display: flex;
  align-items: center;
  gap: var(--s3);
  min-width: 0;
  padding-top: var(--s2);
  border-top: var(--hairline) solid var(--stroke);
}

.passkey-copy {
  display: grid;
  flex: 1 1 auto;
  gap: var(--s1);
  min-width: 0;
}

.passkey-name {
  overflow: hidden;
  font-size: var(--fs-body);
  font-weight: 700;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.passkey-item .passkey-remove {
  min-height: var(--touch);
  padding-inline: 0;
  color: var(--danger-ink);
  white-space: nowrap;
}

.passkey-item .passkey-remove[disabled] {
  color: var(--ink-3);
  cursor: not-allowed;
}
</style>
