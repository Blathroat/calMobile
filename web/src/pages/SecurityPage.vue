<script setup lang="ts">
/**
 * 安全设置：邮箱与两步验证。
 * 旧实现：`profile.js` 的 `securityCard()`（`git show 5e3d9ab^`），本页把它按屏幕拆出来。
 *
 * 两条放一起，因为它们是同一件事的两半：邮箱就是找回密码与两步验证的凭据。
 * 两个改动都**要过验证码**（改邮箱发到新地址、开启两步验证发到现邮箱），
 * 所以这里的每个动作都是「点一下 → 输码 → 生效」，面板原地展开在触发按钮附近。
 *
 * 关两步验证与改邮箱这类不可逆动作先走一次 `confirmSheet`；面板内的失败落在
 * `.field-error` 上、成功落在 `.notice` 上，toast 只作为附加反馈。
 */
import { computed, onMounted, reactive, ref } from 'vue';
import { api, bootApp } from '@/app/runtime';
import { useSessionStore } from '@/stores/session';
import { toast } from '@/services/toast';
import { confirmSheet } from '@/services/sheet';
import { PATTERNS, check } from '@/services/validate';
import QrCanvas from '@/components/QrCanvas.vue';
import SkeletonBlock from '@/components/SkeletonBlock.vue';
import StateBlock from '@/components/StateBlock.vue';
import type { JsonObject } from '@/api/types';
import { t } from '@/i18n';

const session = useSessionStore();

type Panel = '' | 'email' | 'choose' | 'totp' | 'enable2fa' | 'disable2fa' | 'backupCodes' | 'codes';
type ConfirmKind = '' | 'disable' | 'regenerate';

const info = reactive<JsonObject>({});
const loading = ref(true);
const loadError = ref('');
const error = ref('');
const notice = ref('');
const panel = ref<Panel>('');
const confirmKind = ref<ConfirmKind>('');
const confirmPassword = ref('');
const confirmError = ref('');
const busy = ref(false);
/** 取消二次确认时用它强制开关重建，避免原生 checkbox 停在错误的一面。 */
const renderKey = ref(0);

// 各面板自己的输入与结果
const pendingEmail = ref('');
const newEmail = ref('');
const emailCode = ref('');
const twoFactorCode = ref('');
const totpSecret = ref('');
const totpUri = ref('');
const totpCode = ref('');
const qrError = ref('');
const newCodes = ref<string[]>([]);

const emailInvalid = ref(false);
const emailCodeInvalid = ref(false);
const twoFactorCodeInvalid = ref(false);
const totpCodeInvalid = ref(false);

const enabled = computed(() => info.twoFactorEnabled === true);
const totpEnabled = computed(() => info.totpEnabled === true);
const canEnable = computed(() => info.canEnable === true);
const emailLabel = computed(() => {
  const email = String(info.email || '');
  if (!email) return t('s_tv7wlb');
  return `${email}${info.emailVerified === true ? t('s_1m3j883') : t('s_1webb8b')}`;
});

const methodLabel = computed(() => {
  if (totpEnabled.value) return t('s_1lteqo2');
  return info.emailVerified === true ? t('s_s8pbve') : t('s_bk5dms');
});

/** 已开启时说明当前方式与剩余备用码，未开启时说明开启条件。 */
const factorHint = computed(() => {
  if (enabled.value) {
    return `当前验证方式：${methodLabel.value}；备用码还剩 ${Number(info.backupCodesLeft) || 0} 个。`;
  }
  return canEnable.value ? t('s_kzys7n') : t('s_1qj48cz');
});

/** 密钥分组展示：4 个一组，方便手抄核对（旧实现同一处理）。 */
const secretGroups = computed(() => totpSecret.value.match(/.{1,4}/g)?.join(' ') ?? '');

function errorText(reason: unknown): string {
  return reason instanceof Error && reason.message ? reason.message : t('s_osck6n');
}

/** 一次只留一条原位提示：新动作开始时先清掉上一条。 */
function clearMessages(): void {
  error.value = '';
  notice.value = '';
}

async function load(): Promise<void> {
  await bootApp().catch(() => undefined);
  loading.value = true;
  loadError.value = '';
  try {
    const result = await api.security.get();
    Object.assign(info, result ?? {});
  } catch (reason) {
    loadError.value = errorText(reason);
  } finally {
    loading.value = false;
  }
}

/**
 * 动作成功后重读安全状态：**不动** `loading`，否则整页会退回骨架屏，
 * 刚写上的成功提示也会跟着一起消失（旧实现只重画这一张卡）。
 */
async function refresh(): Promise<void> {
  try {
    const result = await api.security.get();
    Object.assign(info, result ?? {});
  } catch {
    // 重读失败保留上一次的显示值：本次动作已经成功了，不该改口说没成功。
  }
}

onMounted(load);

/** 切换面板：只改面板时不重取数据，避免开关闪回旧值。 */
function open(next: Panel): void {
  panel.value = next;
  confirmKind.value = '';
  confirmPassword.value = '';
  confirmError.value = '';
  clearMessages();
  if (next !== 'codes') newCodes.value = [];
  if (next !== 'email') {
    pendingEmail.value = '';
    newEmail.value = '';
    emailCode.value = '';
  }
  if (next !== 'totp') qrError.value = '';
  emailInvalid.value = false;
  emailCodeInvalid.value = false;
  twoFactorCodeInvalid.value = false;
  totpCodeInvalid.value = false;
}

/**
 * 跑一个会改状态的动作：统一处理忙碌、错误与重读。
 * `reload` 为真时静默重读安全状态，让开关与提示回到后端权威值。
 */
async function run(action: () => Promise<void>, options: { reload?: boolean } = {}): Promise<void> {
  busy.value = true;
  clearMessages();
  try {
    await action();
  } catch (reason) {
    error.value = errorText(reason);
  } finally {
    busy.value = false;
    if (options.reload) await refresh();
  }
}

// ── 邮箱：先发码到新地址，通过才落库 ─────────────────────────────

async function sendEmailCode(): Promise<void> {
  emailInvalid.value = false;
  const message = check(newEmail.value, {
    label: t('s_185tvls'),
    required: true,
    max: 120,
    pattern: PATTERNS.email,
    patternMessage: t('s_1u3yg0h'),
  });
  if (message) {
    error.value = message;
    emailInvalid.value = true;
    return;
  }
  await run(async () => {
    const result = await api.security.changeEmail(newEmail.value.trim());
    if (result.ok !== true) throw new Error(String(result.error || t('s_osck6n')));
    pendingEmail.value = String(result.email || newEmail.value.trim());
    notice.value = t('s_akobwu');
    toast(t('s_akobwu'), 'success');
  });
}

async function verifyEmail(): Promise<void> {
  emailCodeInvalid.value = false;
  if (!PATTERNS.verificationCode.test(emailCode.value.trim())) {
    error.value = t('s_1x20l1k');
    emailCodeInvalid.value = true;
    return;
  }
  await run(async () => {
    const result = await api.security.verifyEmail(pendingEmail.value, emailCode.value.trim());
    if (result.ok !== true) throw new Error(String(result.error || t('s_osck6n')));
    // 后端把整份用户对象带回来：换邮箱等于换了身份凭据，会话必须一起更新。
    session.applyUser({ ...session.user, ...(result.user as JsonObject | undefined ?? {}) });
    notice.value = t('s_vhfyh8');
    toast(t('s_vhfyh8'), 'success');
    pendingEmail.value = '';
    panel.value = '';
  }, { reload: true });
}

// ── 两步验证 ──────────────────────────────────────────────────────

/** 关两步验证要当前密码：会话被偷不等于能关掉第二道锁，因此先二次确认。 */
function askDisable(): void {
  clearMessages();
  confirmSheet({
    title: t('s_1b3874r'),
    message: t('s_kikkwz'),
    confirmLabel: t('s_1b3874r'),
    tone: 'danger',
    onConfirm: () => {
      confirmKind.value = 'disable';
      confirmPassword.value = '';
      confirmError.value = '';
      panel.value = 'disable2fa';
    },
  });
  // 原生 checkbox 在被点后自己就翻了面，而 `:checked` 绑定的 `enabled` 没变：
  // 重建开关，用户若取消确认，界面不会停在「已关闭」而实际还开着。
  renderKey.value += 1;
}

async function disableTwoFactor(): Promise<void> {
  confirmError.value = '';
  if (!confirmPassword.value) {
    confirmError.value = t('s_1okxm8b');
    return;
  }
  await run(async () => {
    const result = await api.security.disableTwoFactor(confirmPassword.value);
    if (result.ok !== true) throw new Error(String(result.error || t('s_osck6n')));
    confirmPassword.value = '';
    panel.value = '';
    notice.value = t('s_gupxm1');
    toast(t('s_gupxm1'), 'success');
  }, { reload: true });
}

/** 重新生成备用码会让旧码全部失效，因此同样要二次确认 + 当前密码。 */
function askRegenerate(): void {
  clearMessages();
  confirmSheet({
    title: t('s_u2zwo3'),
    message: t('s_m70x1a'),
    confirmLabel: t('s_yvmn4o'),
    tone: 'danger',
    onConfirm: () => {
      confirmKind.value = 'regenerate';
      confirmPassword.value = '';
      confirmError.value = '';
      panel.value = 'backupCodes';
    },
  });
}

async function regenerateBackupCodes(): Promise<void> {
  confirmError.value = '';
  if (!confirmPassword.value) {
    confirmError.value = t('s_1okxm8b');
    return;
  }
  await run(async () => {
    const result = await api.security.backupCodes(confirmPassword.value);
    if (result.ok !== true) throw new Error(String(result.error || t('s_osck6n')));
    newCodes.value = Array.isArray(result.backupCodes) ? result.backupCodes.map((code) => String(code)) : [];
    confirmPassword.value = '';
    panel.value = 'codes';
  }, { reload: true });
}

/** 用邮箱验证码开启：先请后端把码发到现邮箱，再输码确认。 */
async function openEmailEnable(): Promise<void> {
  await run(async () => {
    const result = await api.security.enableTwoFactor();
    if (result.ok !== true) throw new Error(String(result.error || t('s_osck6n')));
    panel.value = 'enable2fa';
    notice.value = t('s_1kc9jaw');
    toast(t('s_1kc9jaw'), 'success');
  });
}

async function verifyEmailEnable(): Promise<void> {
  twoFactorCodeInvalid.value = false;
  if (!PATTERNS.verificationCode.test(twoFactorCode.value.trim())) {
    error.value = t('s_1x20l1k');
    twoFactorCodeInvalid.value = true;
    return;
  }
  await run(async () => {
    const result = await api.security.verifyTwoFactor(twoFactorCode.value.trim());
    if (result.ok !== true) throw new Error(String(result.error || t('s_osck6n')));
    newCodes.value = Array.isArray(result.backupCodes) ? result.backupCodes.map((code) => String(code)) : [];
    // 开启成功会带一批备用码回来：切到「抄下来」面板，别让用户错过。
    panel.value = newCodes.value.length > 0 ? 'codes' : '';
    notice.value = t('s_14jjxmk');
    toast(t('s_14jjxmk'), 'success');
  }, { reload: true });
}

/** 绑定验证器第一步：拿密钥与 otpauth 地址画二维码。 */
async function startTotp(): Promise<void> {
  await run(async () => {
    const result = await api.security.totpSetup();
    if (result.ok !== true) throw new Error(String(result.error || t('s_osck6n')));
    totpSecret.value = String(result.secret || '');
    totpUri.value = String(result.otpauthUri || '');
    totpCode.value = '';
    qrError.value = '';
    panel.value = 'totp';
  });
}

async function enableTotp(): Promise<void> {
  totpCodeInvalid.value = false;
  if (!PATTERNS.verificationCode.test(totpCode.value.trim())) {
    error.value = t('s_1x20l1k');
    totpCodeInvalid.value = true;
    return;
  }
  await run(async () => {
    const result = await api.security.totpEnable(totpCode.value.trim());
    if (result.ok !== true) throw new Error(String(result.error || t('s_osck6n')));
    newCodes.value = Array.isArray(result.backupCodes) ? result.backupCodes.map((code) => String(code)) : [];
    panel.value = 'codes';
    notice.value = t('s_1p1p02k');
    toast(t('s_1p1p02k'), 'success');
  }, { reload: true });
}

/** 二维码画不出来时说明原因，并让用户改用手抄密钥。 */
function onQrError(message: string): void {
  qrError.value = message;
}
</script>

<template>
  <SkeletonBlock v-if="loading" :rows="3" />

  <StateBlock
    v-else-if="loadError"
    tone="error"
    :title="t('s_1sz2kuw')"
    :description="loadError"
    :action-label="t('s_lswd2v')"
    @action="load"
  />

  <template v-else>
    <div class="card">
      <span class="section-label">{{ t('s_1apxo2s') }}</span>

      <!-- 原位提示：失败在字段上，成功单独一行，toast 只作为附加反馈 -->
      <p v-if="error" class="field-error" role="alert">{{ error }}</p>
      <p v-if="notice" class="notice" data-tone="accent" role="status">{{ notice }}</p>

      <!-- 邮箱那一行：当前地址 + 验证状态 + 更换入口 -->
      <div class="row" data-between="true">
        <span class="row-copy">
          <span class="row-title">{{ t('s_185tvls') }}</span>
          <span class="row-meta truncate">{{ emailLabel }}</span>
        </span>
        <button class="cta ghost" data-size="small" type="button" :disabled="busy" @click="open(panel === 'email' ? '' : 'email')">
          {{ t('s_1ca6fcy') }}
        </button>
      </div>

      <!-- 新邮箱面板：验证码发到新地址，通过才落库 -->
      <div v-if="panel === 'email'" class="stack" data-gap="sm">
        <p class="field-hint">{{ t('s_1itmqlh') }}</p>
        <div class="field" :data-invalid="emailInvalid ? 'true' : 'false'">
          <label for="security-email">{{ t('s_185tvls') }}</label>
          <input
            id="security-email"
            v-model="newEmail"
            class="input"
            type="email"
            :placeholder="t('s_1i2pkg8')"
            autocomplete="email"
          >
        </div>
        <div v-if="pendingEmail" class="field" :data-invalid="emailCodeInvalid ? 'true' : 'false'">
          <label for="security-email-code">{{ t('s_doboo3') }}</label>
          <input
            id="security-email-code"
            v-model="emailCode"
            class="input"
            type="text"
            inputmode="numeric"
            maxlength="6"
            :placeholder="t('s_doboo3')"
          >
        </div>
        <div class="row" data-gap="sm">
          <button class="cta ghost" data-size="small" type="button" :disabled="busy" @click="sendEmailCode">
            {{ pendingEmail ? t('s_1fyr64c') : t('s_shrzdv') }}
          </button>
          <button v-if="pendingEmail" class="cta" data-size="small" type="button" :disabled="busy" @click="verifyEmail">
            {{ t('s_yh7i0p') }}
          </button>
          <button class="cta ghost" data-size="small" type="button" :disabled="busy" @click="open('')">
            {{ t('s_1589w37') }}
          </button>
        </div>
      </div>

      <!-- 两步验证：开关是总开关，打开后先选「用验证器」还是「用邮箱」 -->
      <div class="stack" data-gap="sm">
        <div :key="renderKey" class="switch-row">
          <span class="switch-copy">
            <strong>{{ t('s_15msj8x') }}</strong>
            <span class="row-meta">{{ t('s_k6xen8') }}</span>
          </span>
          <label class="switch" for="security-2fa">
            <input
              id="security-2fa"
              type="checkbox"
              :checked="enabled"
              :disabled="busy || (!canEnable && !enabled)"
              @change="($event.target as HTMLInputElement).checked ? open('choose') : askDisable()"
            >
            <span />
          </label>
        </div>
        <p class="field-hint">{{ factorHint }}</p>

        <!-- 已经开着的时候才给这两个恢复入口 -->
        <div v-if="enabled" class="row" data-gap="sm">
          <button class="cta ghost" data-size="small" type="button" :disabled="busy" @click="askRegenerate">
            {{ t('s_u2zwo3') }}
          </button>
          <button v-if="totpEnabled" class="cta ghost" data-size="small" type="button" :disabled="busy" @click="startTotp">
            {{ t('s_1xbevn8') }}
          </button>
        </div>
      </div>

      <!-- 选择第二因子的方式：验证器（推荐）或邮箱验证码 -->
      <div v-if="panel === 'choose'" class="stack" data-gap="sm">
        <p class="field-hint">{{ t('s_16wrqub') }}</p>
        <div class="row" data-gap="sm">
          <button class="cta" data-size="small" type="button" :disabled="busy" @click="startTotp">
            {{ t('s_1mdazxm') }}
          </button>
          <button class="cta ghost" data-size="small" type="button" :disabled="busy" @click="openEmailEnable">
            {{ t('s_16xoiwx') }}
          </button>
          <button class="cta ghost" data-size="small" type="button" :disabled="busy" @click="open('')">
            {{ t('s_1589w37') }}
          </button>
        </div>
      </div>

      <!-- 绑定验证器：二维码 + 手抄密钥 + 输码确认。手抄是必须的，相机与反光都可能扫不出来 -->
      <div v-if="panel === 'totp'" class="stack" data-gap="sm">
        <p class="field-hint">{{ qrError ? `${qrError}，请手动输入下面的密钥。` : t('s_ijepao') }}</p>
        <div class="qr-wrap">
          <QrCanvas :text="totpUri" :size="200" @error="onQrError" />
        </div>
        <code class="qr-code-text">{{ secretGroups }}</code>
        <div class="field" :data-invalid="totpCodeInvalid ? 'true' : 'false'">
          <label for="security-totp-code">{{ t('s_doboo3') }}</label>
          <input
            id="security-totp-code"
            v-model="totpCode"
            class="input"
            type="text"
            inputmode="numeric"
            maxlength="6"
            :placeholder="t('s_doboo3')"
          >
        </div>
        <div class="row" data-gap="sm">
          <button class="cta" data-size="small" type="button" :disabled="busy" @click="enableTotp">
            {{ t('s_115qa00') }}
          </button>
          <button class="cta ghost" data-size="small" type="button" :disabled="busy" @click="open('')">
            {{ t('s_1589w37') }}
          </button>
        </div>
      </div>

      <!-- 用邮箱验证码开启：发码后输码 -->
      <div v-if="panel === 'enable2fa'" class="stack" data-gap="sm">
        <p class="field-hint">{{ t('s_1mimz3w') }}：验证码已发到你的邮箱，10 分钟内有效。</p>
        <div class="field" :data-invalid="twoFactorCodeInvalid ? 'true' : 'false'">
          <label for="security-2fa-code">{{ t('s_doboo3') }}</label>
          <input
            id="security-2fa-code"
            v-model="twoFactorCode"
            class="input"
            type="text"
            inputmode="numeric"
            maxlength="6"
            :placeholder="t('s_doboo3')"
          >
        </div>
        <div class="row" data-gap="sm">
          <button class="cta" data-size="small" type="button" :disabled="busy" @click="verifyEmailEnable">
            {{ t('s_1jjtbcm') }}
          </button>
          <button class="cta ghost" data-size="small" type="button" :disabled="busy" @click="open('')">
            {{ t('s_1589w37') }}
          </button>
        </div>
      </div>

      <!-- 关闭两步验证要当前密码 -->
      <div v-if="panel === 'disable2fa' && confirmKind === 'disable'" class="stack" data-gap="sm">
        <p class="field-hint">{{ t('s_kikkwz') }}</p>
        <div class="field" :data-invalid="confirmError ? 'true' : 'false'">
          <label for="security-2fa-password">{{ t('s_1q7kb1c') }}</label>
          <input
            id="security-2fa-password"
            v-model="confirmPassword"
            class="input"
            type="password"
            :placeholder="t('s_f478sb')"
            autocomplete="current-password"
          >
        </div>
        <p v-if="confirmError" class="field-error" role="alert">{{ confirmError }}</p>
        <div class="row" data-gap="sm">
          <button class="cta danger" data-size="small" type="button" :disabled="busy" @click="disableTwoFactor">
            {{ t('s_1b3874r') }}
          </button>
          <button class="cta ghost" data-size="small" type="button" :disabled="busy" @click="open('')">
            {{ t('s_1589w37') }}
          </button>
        </div>
      </div>

      <!-- 重新生成备用码：同样要当前密码（旧码会全部失效） -->
      <div v-if="panel === 'backupCodes' && confirmKind === 'regenerate'" class="stack" data-gap="sm">
        <p class="field-hint">{{ t('s_m70x1a') }}</p>
        <div class="field" :data-invalid="confirmError ? 'true' : 'false'">
          <label for="security-backup-password">{{ t('s_1q7kb1c') }}</label>
          <input
            id="security-backup-password"
            v-model="confirmPassword"
            class="input"
            type="password"
            :placeholder="t('s_f478sb')"
            autocomplete="current-password"
          >
        </div>
        <p v-if="confirmError" class="field-error" role="alert">{{ confirmError }}</p>
        <div class="row" data-gap="sm">
          <button class="cta" data-size="small" type="button" :disabled="busy" @click="regenerateBackupCodes">
            {{ t('s_yvmn4o') }}
          </button>
          <button class="cta ghost" data-size="small" type="button" :disabled="busy" @click="open('')">
            {{ t('s_1589w37') }}
          </button>
        </div>
      </div>

      <!-- 一次性展示新备用码：库里只有哈希，关掉就再也看不到 -->
      <div v-if="panel === 'codes'" class="stack" data-gap="sm">
        <template v-if="newCodes.length === 0">
          <p class="field-hint">{{ t('s_1qnrion') }}</p>
        </template>
        <template v-else>
          <strong>{{ t('s_eqtk1v') }}</strong>
          <p class="field-hint">{{ t('s_116vgro') }}</p>
          <div class="stack" data-gap="xs">
            <code v-for="code in newCodes" :key="code" class="qr-code-text">{{ code }}</code>
          </div>
          <button class="cta ghost" data-size="small" type="button" @click="open('')">
            {{ t('s_1qhhjx1') }}
          </button>
        </template>
      </div>
    </div>
  </template>
</template>
