<script setup lang="ts">
/**
 * 管理后台「设置」分区。
 *
 * 纯展示 + 事件回抛：取数、校验、保存与上传都留在 AdminPage。
 * 表单是 AdminPage 里的 reactive 对象，作为普通 prop 下传；子组件只改它的嵌套字段，
 * 不整体替换，因此父组件不需要处理 update:modelValue（也避免 v-model 对 const 绑定的改写）。
 */
import AppIcon from '@/components/AppIcon.vue';
import SegControl from '@/components/SegControl.vue';
import SkeletonBlock from '@/components/SkeletonBlock.vue';
import StateBlock from '@/components/StateBlock.vue';
import { computed, type Ref } from 'vue';
import type { JsonObject } from '@/api/types';
import { t } from '@/i18n';

interface LimitItem {
  key: string;
  label: string;
  hint: string;
  unit: string;
}

/** 与 AdminPage 里那份 reactive 表单同形；嵌套字段由子组件直接改。 */
interface AdminSettingsForm {
  brand: { zh: string; en: string };
  announcement: string;
  announcementEnabled: boolean;
  categories: string;
  canRevise: boolean;
  canReviseAttended: boolean;
  imageCount: number;
  imageSizeMb: number;
  videoCount: number;
  videoSizeMb: number;
  avatarSizeMb: number;
  avatarFormats: string;
  imageFormats: string;
  videoFormats: string;
  limits: Record<string, number>;
  defaultCover: string;
  maxFutureExhibitions: number;
  maxFutureMeetings: number;
  storageMb: number;
  whenFull: 'reject' | 'evict-oldest';
  inviteUses: number;
  inviteValidHours: number;
}

interface InviteItem {
  id: string;
  code: string;
  maxUses: number;
  usedCount: number;
  expiresAt: string;
  status: string;
}

const props = defineProps<{
  form: AdminSettingsForm;
  settingsQuery: { data: Ref<JsonObject | undefined>; error: Ref<Error | undefined>; loading: Ref<boolean> };
  loaded: boolean;
  settingsError: string;
  settingsSaving: boolean;
  coverBusy: boolean;
  canEditSettings: boolean;
  storageFull: boolean;
  storagePercent: number;
  storageCaption: string;
  storagePolicies: { value: string; label: string }[];
  limitGroups: Array<{ id: string; title: string; items: LimitItem[] }>;
  pairLimits: (items: LimitItem[]) => LimitItem[][];
  copy: {
    coverTitle: string;
    coverHint: string;
    limitIntro: string;
    exhibitorLimit: string;
    exhibitorLimitHint: string;
    meetingLimit: string;
    meetingLimitHint: string;
    avatarSection: string;
    avatarFormats: string;
    storageTitle: string;
    storageHint: string;
    storageLimit: string;
    storageWhenFull: string;
  };
  invites: InviteItem[];
  inviteBusy: boolean;
}>();
const emit = defineEmits<{
  retry: [];
  save: [];
  'pick-cover': [];
  generate: [];
  revoke: [id: string];
  copy: [code: string];
}>();

/** 过期和已删除的码由服务端清掉；这里再滤一次，避免缓存里的旧行继续占位。 */
const visibleInvites = computed(() =>
  props.invites.filter((item) => item.status !== 'expired' && item.status !== 'revoked'),
);

function inviteStatusLabel(status: string): string {
  if (status === 'exhausted') return t('admin.invites.exhausted');
  if (status === 'expired') return t('admin.invites.expired');
  if (status === 'revoked') return t('admin.invites.revoked');
  return t('admin.invites.available');
}
</script>

<template>
  <SkeletonBlock v-if="settingsQuery.loading.value && !loaded" :rows="4" />
  <StateBlock
    v-else-if="settingsQuery.error.value && !loaded"
    tone="error"
    :title="t('common.loadFailed')"
    :description="settingsQuery.error.value.message"
    :action-label="t('common.retry')"
    @action="emit('retry')"
  />
  <template v-else>
    <div class="notice" data-tone="accent">
      <strong>{{ t('admin.settings.server') }}</strong>
      <span>{{ t('admin.settings.serverScope') }}</span>
    </div>

    <div class="card">
      <span class="section-label">{{ copy.storageTitle }}</span>
      <div class="storage-meter" :data-full="storageFull ? 'true' : 'false'">
        <span :style="{ width: `${storagePercent}%` }" />
      </div>
      <p class="field-hint">{{ storageCaption }}</p>
      <p class="field-hint">{{ copy.storageHint }}</p>
      <div class="field">
        <label for="settings-storage-mb">{{ copy.storageLimit }}</label>
        <div class="row" data-gap="md">
          <input
            id="settings-storage-mb"
            v-model.number="form.storageMb"
            class="input"
            type="number"
            min="64"
            max="10240"
            inputmode="numeric"
          />
          <span class="row-meta">MB</span>
        </div>
      </div>
      <div class="field">
        <label id="settings-storage-policy">{{ copy.storageWhenFull }}</label>
        <SegControl
          :model-value="form.whenFull"
          :items="storagePolicies"
          :label="copy.storageWhenFull"
          @update:model-value="form.whenFull = $event === 'evict-oldest' ? 'evict-oldest' : 'reject'"
        />
      </div>
    </div>

    <div class="card">
      <span class="section-label">{{ t('admin.settings.brand') }}</span>
      <div class="field">
        <label for="settings-title-zh">{{ t('admin.settings.brandZh') }}</label>
        <input
          id="settings-title-zh"
          v-model="form.brand.zh"
          class="input"
          type="text"
          maxlength="20"
          :placeholder="t('admin.settings.brandZhPlaceholder')"
        />
      </div>
      <div class="field">
        <label for="settings-title-en">{{ t('admin.settings.brandEn') }}</label>
        <input
          id="settings-title-en"
          v-model="form.brand.en"
          class="input"
          type="text"
          maxlength="24"
          :placeholder="t('admin.settings.brandEnPlaceholder')"
        />
      </div>
    </div>

    <!-- 缺省展会封面：展会自己没有封面时用它替掉占位图；留空即回到占位图 -->
    <div class="card">
      <span class="section-label">{{ copy.coverTitle }}</span>
      <div class="hero ph-img hero-compact">
        <img v-if="form.defaultCover" :src="form.defaultCover" :alt="copy.coverTitle" />
      </div>
      <div class="row" data-gap="md">
        <button
          class="cta ghost"
          data-size="small"
          type="button"
          style="flex: 1 1 0"
          :disabled="coverBusy"
          :data-loading="coverBusy ? 'true' : 'false'"
          @click="emit('pick-cover')"
        >
          {{ form.defaultCover ? t('admin.media.changeCover') : t('admin.media.uploadCover') }}
        </button>
        <button
          v-if="form.defaultCover"
          class="cta ghost"
          data-size="small"
          type="button"
          style="flex: 1 1 0"
          @click="form.defaultCover = ''"
        >
          {{ t('admin.media.removeCover') }}
        </button>
      </div>
      <p class="field-hint">{{ copy.coverHint }}</p>
    </div>

    <!-- 展商端策略：单个展商可同时筹备的展会数 -->
    <div class="card">
      <span class="section-label">{{ copy.exhibitorLimit }}</span>
      <div class="field">
        <div class="row" data-gap="md">
          <input
            id="settings-max-future-exhibitions"
            v-model.number="form.maxFutureExhibitions"
            class="input"
            type="number"
            min="0"
            inputmode="numeric"
          />
          <span class="row-meta">{{ t('admin.limits.items') }}</span>
        </div>
        <p class="field-hint">{{ copy.exhibitorLimitHint }}</p>
      </div>
      <div class="field">
        <label for="settings-max-future-meetings">{{ copy.meetingLimit }}</label>
        <div class="row" data-gap="md">
          <input
            id="settings-max-future-meetings"
            v-model.number="form.maxFutureMeetings"
            class="input"
            type="number"
            min="0"
            inputmode="numeric"
          />
          <span class="row-meta">{{ t('admin.limits.items') }}</span>
        </div>
        <p class="field-hint">{{ copy.meetingLimitHint }}</p>
      </div>
    </div>

    <div class="card">
      <span class="section-label">{{ t('admin.announce.entry') }}</span>
      <textarea id="settings-announcement" v-model="form.announcement" class="textarea" rows="3" />
      <div class="switch-row">
        <span class="switch-copy">
          <strong>{{ t('admin.announce.showOnEntry') }}</strong>
        </span>
        <label class="switch" for="settings-announcement-enabled">
          <input id="settings-announcement-enabled" v-model="form.announcementEnabled" type="checkbox" />
          <span />
        </label>
      </div>
    </div>

    <div class="card">
      <span class="section-label">{{ t('admin.settings.categories') }}</span>
      <textarea id="settings-categories" v-model="form.categories" class="textarea" rows="4" />
    </div>

    <div class="card">
      <span class="section-label">{{ t('admin.settings.reviewPolicy') }}</span>
      <div class="switch-row">
        <span class="switch-copy">
          <strong>{{ t('admin.settings.allowReviseDecided') }}</strong>
        </span>
        <label class="switch" for="settings-revise">
          <input id="settings-revise" v-model="form.canRevise" type="checkbox" />
          <span />
        </label>
      </div>
      <div class="switch-row">
        <span class="switch-copy">
          <strong>{{ t('admin.settings.reviewAttended') }}</strong>
          <span class="field-hint">{{ t('admin.settings.reviewAttendedHint') }}</span>
        </span>
        <label class="switch" for="settings-revise-attended">
          <input id="settings-revise-attended" v-model="form.canReviseAttended" type="checkbox" />
          <span />
        </label>
      </div>
    </div>

    <div class="card">
      <span class="section-label">{{ t('admin.invites.title') }}</span>
      <p class="field-hint">{{ t('admin.invites.hint') }}</p>
      <div class="field">
        <label for="settings-invite-uses">{{ t('admin.invites.uses') }}</label>
        <input
          id="settings-invite-uses"
          v-model.number="form.inviteUses"
          class="input"
          type="number"
          min="1"
          max="100"
          inputmode="numeric"
          :disabled="!canEditSettings || inviteBusy"
        />
      </div>
      <div class="field">
        <label for="settings-invite-days">{{ t('admin.invites.days') }}</label>
        <input
          id="settings-invite-days"
          v-model.number="form.inviteValidHours"
          class="input"
          type="number"
          min="0"
          max="8760"
          inputmode="numeric"
          :disabled="!canEditSettings || inviteBusy"
        />
        <p class="field-hint">{{ t('admin.invites.daysHint') }}</p>
      </div>
      <button
        class="cta"
        type="button"
        :disabled="!canEditSettings || inviteBusy"
        :data-loading="inviteBusy ? 'true' : undefined"
        @click="emit('generate')"
      >
        {{ t('admin.invites.generate') }}
      </button>
      <StateBlock v-if="visibleInvites.length === 0" :title="t('admin.invites.empty')" />
      <div v-else class="list" data-gap="sm">
        <div v-for="item in visibleInvites" :key="item.id" class="row" data-between="true">
          <span class="row-copy">
            <strong class="row-title">{{ item.code }}</strong>
            <span class="row-meta">{{ `${item.usedCount}/${item.maxUses} · ${inviteStatusLabel(item.status)}` }}</span>
          </span>
          <span class="row" data-gap="sm">
            <button class="cta ghost" data-size="small" type="button" @click="emit('copy', item.code)">
              {{ t('admin.invites.copy') }}
            </button>
            <button
              class="cta ghost"
              data-size="small"
              type="button"
              :disabled="inviteBusy"
              @click="emit('revoke', item.id)"
            >
              {{ t('admin.invites.revoke') }}
            </button>
          </span>
        </div>
      </div>
    </div>

    <div class="card">
      <span class="section-label">{{ t('admin.media.richMedia') }}</span>
      <div class="field">
        <label for="settings-image-count">{{ t('admin.media.imagesPerPost') }}</label>
        <div class="row" data-gap="md">
          <input
            id="settings-image-count"
            v-model.number="form.imageCount"
            class="input"
            type="number"
            min="0"
            inputmode="numeric"
          />
          <span class="row-meta">{{ t('admin.media.sheets') }}</span>
        </div>
      </div>
      <div class="field">
        <label for="settings-image-size">{{ t('admin.media.imageSize') }}</label>
        <div class="row" data-gap="md">
          <input
            id="settings-image-size"
            v-model.number="form.imageSizeMb"
            class="input"
            type="number"
            min="0"
            inputmode="numeric"
          />
          <span class="row-meta">MB</span>
        </div>
      </div>
      <div class="field">
        <label for="settings-video-count">{{ t('admin.media.videoCount') }}</label>
        <div class="row" data-gap="md">
          <input
            id="settings-video-count"
            v-model.number="form.videoCount"
            class="input"
            type="number"
            min="0"
            inputmode="numeric"
          />
          <span class="row-meta">{{ t('admin.limits.items') }}</span>
        </div>
      </div>
      <div class="field">
        <label for="settings-video-size">{{ t('admin.media.videoSize') }}</label>
        <div class="row" data-gap="md">
          <input
            id="settings-video-size"
            v-model.number="form.videoSizeMb"
            class="input"
            type="number"
            min="0"
            inputmode="numeric"
          />
          <span class="row-meta">MB</span>
        </div>
      </div>
    </div>

    <div class="card">
      <span class="section-label">{{ t('admin.media.uploadFormats') }}</span>
      <div class="field">
        <label for="settings-image-formats">{{ t('admin.media.imageSuffixes') }}</label>
        <input
          id="settings-image-formats"
          v-model="form.imageFormats"
          class="input"
          type="text"
          maxlength="120"
          placeholder="jpg,jpeg,png,webp"
        />
      </div>
      <div class="field">
        <label for="settings-video-formats">{{ t('admin.media.videoSuffixes') }}</label>
        <input
          id="settings-video-formats"
          v-model="form.videoFormats"
          class="input"
          type="text"
          maxlength="120"
          placeholder="mp4,mov,webm"
        />
      </div>
    </div>

    <div class="card">
      <span class="section-label">{{ copy.avatarSection }}</span>
      <div class="field">
        <label for="settings-avatar-size">{{ t('admin.media.avatarSize') }}</label>
        <div class="row" data-gap="md">
          <input
            id="settings-avatar-size"
            v-model.number="form.avatarSizeMb"
            class="input"
            type="number"
            min="1"
            max="20"
            inputmode="numeric"
          />
          <span class="row-meta">MB</span>
        </div>
      </div>
      <div class="field">
        <label for="settings-avatar-formats">{{ copy.avatarFormats }}</label>
        <input
          id="settings-avatar-formats"
          v-model="form.avatarFormats"
          class="input"
          type="text"
          maxlength="80"
          placeholder="jpg,jpeg,png,webp"
        />
      </div>
    </div>

    <div class="card">
      <span class="section-label">{{ t('admin.limits.formChars') }}</span>
      <p class="field-hint">{{ copy.limitIntro }}</p>
      <div v-for="group in limitGroups" :key="group.id" class="limit-group">
        <span class="limit-group-title">{{ group.title }}</span>
        <div
          v-for="(row, rowIndex) in pairLimits(group.items)"
          :key="`${group.id}-${rowIndex}`"
          :class="row.length > 1 ? 'grid-cols-2' : undefined"
        >
          <div v-for="item in row" :key="item.key" class="field">
            <label :for="`limit-${item.key}`">{{ item.label }}</label>
            <div class="row" data-gap="md">
              <input
                :id="`limit-${item.key}`"
                v-model.number="form.limits[item.key]"
                class="input"
                type="number"
                min="0"
                inputmode="numeric"
              />
              <span class="row-meta">{{ item.unit }}</span>
            </div>
            <p class="field-hint">{{ item.hint }}</p>
          </div>
        </div>
      </div>
    </div>

    <p v-if="settingsError" class="field-error" role="alert">{{ settingsError }}</p>

    <!-- 悬浮保存：只在本分区（管理-设置）渲染，贴页面右下角；保存中或没有权限时禁用。
         用 .round-action（51px 圆形、带阴影）加 save 图标，标题与读屏名复用同一句文案。
         投递到 body：`position: fixed` 若留在页面里，页面切换的 `.route-enter` 动画期间
         transform 祖先会成为包含块，按钮会先按内容区定位再跳回屏幕右下角（长页面尤其明显）。
         放到 body 下就没有这个包含块，定位从第一帧起就是屏幕坐标。 -->
    <Teleport to="body">
      <button
        class="round-action settings-save-fab"
        type="button"
        :disabled="settingsSaving || !canEditSettings"
        :aria-label="t('admin.settings.save')"
        :title="t('admin.settings.save')"
        @click="emit('save')"
      >
        <AppIcon name="save" />
      </button>
    </Teleport>
  </template>
</template>

<style>
/* 管理设置里的文字长度分组：同一张卡里用分隔线隔开，方便按展会、收集项、账号查找。 */
.limit-group {
  display: grid;
  gap: var(--s3);
  padding-top: var(--s3);
  border-top: var(--hairline) solid var(--stroke);
}

.limit-group-title {
  color: var(--ink);
  font-size: var(--fs-label);
  font-weight: 700;
}

.storage-meter {
  height: 8px;
  overflow: hidden;
  border-radius: var(--r-pill);
  background: var(--f1);
}

.storage-meter > span {
  display: block;
  height: 100%;
  border-radius: inherit;
  background: var(--accent);
}

/* 悬浮保存按钮：fixed 贴屏幕右下角，但横向要落在 `.app` 这条 720px 居中列内，
   不能飘到窗口边；底部要避开底部导航与安全区。取值理由：
   - 右：窗口比 --app-max 宽时，(100vw - --app-max) / 2 正是 `.app` 右缘到窗口右缘的距离，
     再加一层内容内距 --s4，按钮就贴在这条列内；窄屏下括号内为负，max() 取 --s4 兜底，
     因此窄屏不会溢出。
   - 下：底部导航最小高度 48px（AppTabBar 里 .tab 的 min-height，等于 --ctrl 44 + --s1 4）
     + 顶部内距 --s2 + 一条 --hairline 上边框，再留 --s4 的呼吸位，最后叠上安全区
     --safe-bottom（.app 的 padding-bottom 也是这个值），所以安全区与导航都不会压住它。
   选择器带上 .round-action 是为了稳定压过 motion.css 里的 position: relative。 */
.round-action.settings-save-fab {
  position: fixed;
  right: max(var(--s4), calc((100vw - var(--app-max)) / 2 + var(--s4)));
  bottom: calc(var(--ctrl) + var(--s1) + var(--s2) + var(--hairline) + var(--s4) + var(--safe-bottom));
  z-index: 30;
}

/* 禁用时与 .cta[disabled] 同一套观感：灰底灰字、去掉阴影，指针提示不可点。 */
.settings-save-fab[disabled] {
  background: var(--f1);
  color: var(--ink-3);
  box-shadow: none;
  cursor: not-allowed;
}
</style>
