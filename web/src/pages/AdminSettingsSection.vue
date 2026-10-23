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
  /** 兑换后展商身份保留的天数；0 表示永久 */
  inviteDurationDays: number;
}

interface InviteItem {
  id: string;
  code: string;
  maxUses: number;
  usedCount: number;
  /** 兑换后展商身份保留的天数；0 表示永久 */
  durationDays: number;
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

/** 展商时长：0 天是永久，其余按天显示。 */
function inviteDurationLabel(item: InviteItem): string {
  return item.durationDays > 0
    ? t('admin.invites.durationDays', { days: item.durationDays })
    : t('admin.invites.permanent');
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
        <span :style="{ width: storagePercent + '%' }" />
      </div>
      <p class="field-hint">{{ storageCaption }}</p>
      <p class="field-hint">{{ copy.storageHint }}</p>
      <div class="settings-rows">
        <div class="setting-row">
          <label for="settings-storage-mb">{{ copy.storageLimit }}</label>
          <span class="setting-control">
            <input
              id="settings-storage-mb"
              v-model.number="form.storageMb"
              class="input input-line setting-num"
              type="number"
              min="64"
              max="10240"
              inputmode="numeric"
            />
            <span class="setting-unit">MB</span>
          </span>
        </div>
        <div class="field">
          <span id="settings-storage-policy" class="field-label">{{ copy.storageWhenFull }}</span>
          <SegControl
            :model-value="form.whenFull"
            :items="storagePolicies"
            :label="copy.storageWhenFull"
            @update:model-value="form.whenFull = $event === 'evict-oldest' ? 'evict-oldest' : 'reject'"
          />
        </div>
      </div>
    </div>

    <div class="card">
      <span class="section-label">{{ t('admin.settings.brand') }}</span>
      <div class="settings-rows">
        <div class="setting-row">
          <label for="settings-title-zh">{{ t('admin.settings.brandZh') }}</label>
          <span class="setting-control">
            <input
              id="settings-title-zh"
              v-model="form.brand.zh"
              class="input input-line setting-text"
              type="text"
              maxlength="20"
              :placeholder="t('admin.settings.brandZhPlaceholder')"
            />
          </span>
        </div>
        <div class="setting-row">
          <label for="settings-title-en">{{ t('admin.settings.brandEn') }}</label>
          <span class="setting-control">
            <input
              id="settings-title-en"
              v-model="form.brand.en"
              class="input input-line setting-text"
              type="text"
              maxlength="24"
              :placeholder="t('admin.settings.brandEnPlaceholder')"
            />
          </span>
        </div>
      </div>
    </div>

    <!-- 缺省展会封面：展会自己没有封面时用它替掉占位图；留空即回到占位图。
         版式与编辑展会页的封面卡一致：左侧 96×170 竖版预览，右侧竖排按钮与说明，窄屏上下堆叠。 -->
    <div class="card">
      <span class="section-label">{{ copy.coverTitle }}</span>
      <div class="cover-row">
        <div v-if="form.defaultCover" class="cover-frame ph-img">
          <img :src="form.defaultCover" :alt="copy.coverTitle" />
        </div>
        <div v-else class="cover-frame ph-img" aria-hidden="true" />
        <div class="cover-side">
          <button
            class="cta ghost"
            data-size="small"
            type="button"
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
            @click="form.defaultCover = ''"
          >
            {{ t('admin.media.removeCover') }}
          </button>
          <p class="field-hint">1080 × 1920</p>
          <p class="field-hint">{{ copy.coverHint }}</p>
        </div>
      </div>
    </div>

    <!-- 展商端策略：单个展商可同时筹备的展会数 -->
    <div class="card">
      <span class="section-label">{{ copy.exhibitorLimit }}</span>
      <div class="settings-rows">
        <div class="setting-block">
          <div class="setting-row">
            <label for="settings-max-future-exhibitions">{{ copy.exhibitorLimit }}</label>
            <span class="setting-control">
              <input
                id="settings-max-future-exhibitions"
                v-model.number="form.maxFutureExhibitions"
                class="input input-line setting-num"
                type="number"
                min="0"
                inputmode="numeric"
              />
              <span class="setting-unit">{{ t('admin.limits.items') }}</span>
            </span>
          </div>
          <p class="field-hint">{{ copy.exhibitorLimitHint }}</p>
        </div>
        <div class="setting-block">
          <div class="setting-row">
            <label for="settings-max-future-meetings">{{ copy.meetingLimit }}</label>
            <span class="setting-control">
              <input
                id="settings-max-future-meetings"
                v-model.number="form.maxFutureMeetings"
                class="input input-line setting-num"
                type="number"
                min="0"
                inputmode="numeric"
              />
              <span class="setting-unit">{{ t('admin.limits.items') }}</span>
            </span>
          </div>
          <p class="field-hint">{{ copy.meetingLimitHint }}</p>
        </div>
      </div>
    </div>

    <div class="card">
      <span class="section-label">{{ t('admin.announce.entry') }}</span>
      <textarea id="settings-announcement" v-model="form.announcement" class="textarea" rows="3" />
      <div class="switch-row" data-flush="true">
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
      <div class="switch-row" data-flush="true">
        <span class="switch-copy">
          <strong>{{ t('admin.settings.allowReviseDecided') }}</strong>
        </span>
        <label class="switch" for="settings-revise">
          <input id="settings-revise" v-model="form.canRevise" type="checkbox" />
          <span />
        </label>
      </div>
      <div class="switch-row" data-flush="true">
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
      <!-- 三个数字字段并排：次数、码有效期、兑换后的展商时长 -->
      <div class="grid-cols-3">
        <div class="field">
          <label for="settings-invite-uses">{{ t('admin.invites.uses') }}</label>
          <input
            id="settings-invite-uses"
            v-model.number="form.inviteUses"
            class="input input-line"
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
            class="input input-line"
            type="number"
            min="0"
            max="8760"
            inputmode="numeric"
            :disabled="!canEditSettings || inviteBusy"
          />
        </div>
        <div class="field">
          <label for="settings-invite-duration">{{ t('admin.invites.duration') }}</label>
          <input
            id="settings-invite-duration"
            v-model.number="form.inviteDurationDays"
            class="input input-line"
            type="number"
            min="0"
            max="3650"
            inputmode="numeric"
            :disabled="!canEditSettings || inviteBusy"
          />
        </div>
      </div>
      <p class="field-hint">{{ t('admin.invites.fieldsHint') }}</p>
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
      <div v-else class="invite-list">
        <div
          v-for="item in visibleInvites"
          :key="item.id"
          class="invite-row"
          :data-dim="item.status === 'exhausted' ? 'true' : 'false'"
        >
          <span class="invite-copy">
            <strong class="invite-code">{{ item.code }}</strong>
            <span class="row-meta">{{
              t('admin.invites.meta', {
                used: item.usedCount,
                max: item.maxUses,
                duration: inviteDurationLabel(item),
                status: inviteStatusLabel(item.status),
              })
            }}</span>
          </span>
          <span class="invite-actions">
            <button
              class="icon-button"
              type="button"
              :aria-label="t('admin.invites.copy')"
              :title="t('admin.invites.copy')"
              @click="emit('copy', item.code)"
            >
              <AppIcon name="copy" />
            </button>
            <button
              class="icon-button"
              type="button"
              :aria-label="t('admin.invites.revoke')"
              :title="t('admin.invites.revoke')"
              :disabled="inviteBusy"
              @click="emit('revoke', item.id)"
            >
              <AppIcon name="trash" />
            </button>
          </span>
        </div>
      </div>
    </div>

    <div class="card">
      <span class="section-label">{{ t('admin.media.richMedia') }}</span>
      <div class="settings-rows">
        <div class="setting-row">
          <label for="settings-image-count">{{ t('admin.media.imagesPerPost') }}</label>
          <span class="setting-control">
            <input
              id="settings-image-count"
              v-model.number="form.imageCount"
              class="input input-line setting-num"
              type="number"
              min="0"
              inputmode="numeric"
            />
            <span class="setting-unit">{{ t('admin.media.sheets') }}</span>
          </span>
        </div>
        <div class="setting-row">
          <label for="settings-image-size">{{ t('admin.media.imageSize') }}</label>
          <span class="setting-control">
            <input
              id="settings-image-size"
              v-model.number="form.imageSizeMb"
              class="input input-line setting-num"
              type="number"
              min="0"
              inputmode="numeric"
            />
            <span class="setting-unit">MB</span>
          </span>
        </div>
        <div class="setting-row">
          <label for="settings-video-count">{{ t('admin.media.videoCount') }}</label>
          <span class="setting-control">
            <input
              id="settings-video-count"
              v-model.number="form.videoCount"
              class="input input-line setting-num"
              type="number"
              min="0"
              inputmode="numeric"
            />
            <span class="setting-unit">{{ t('admin.limits.items') }}</span>
          </span>
        </div>
        <div class="setting-row">
          <label for="settings-video-size">{{ t('admin.media.videoSize') }}</label>
          <span class="setting-control">
            <input
              id="settings-video-size"
              v-model.number="form.videoSizeMb"
              class="input input-line setting-num"
              type="number"
              min="0"
              inputmode="numeric"
            />
            <span class="setting-unit">MB</span>
          </span>
        </div>
      </div>
    </div>

    <div class="card">
      <span class="section-label">{{ t('admin.media.uploadFormats') }}</span>
      <div class="settings-rows">
        <div class="setting-row">
          <label for="settings-image-formats">{{ t('admin.media.imageSuffixes') }}</label>
          <span class="setting-control">
            <input
              id="settings-image-formats"
              v-model="form.imageFormats"
              class="input input-line setting-text"
              type="text"
              maxlength="120"
              placeholder="jpg,jpeg,png,webp"
            />
          </span>
        </div>
        <div class="setting-row">
          <label for="settings-video-formats">{{ t('admin.media.videoSuffixes') }}</label>
          <span class="setting-control">
            <input
              id="settings-video-formats"
              v-model="form.videoFormats"
              class="input input-line setting-text"
              type="text"
              maxlength="120"
              placeholder="mp4,mov,webm"
            />
          </span>
        </div>
      </div>
    </div>

    <div class="card">
      <span class="section-label">{{ copy.avatarSection }}</span>
      <div class="settings-rows">
        <div class="setting-row">
          <label for="settings-avatar-size">{{ t('admin.media.avatarSize') }}</label>
          <span class="setting-control">
            <input
              id="settings-avatar-size"
              v-model.number="form.avatarSizeMb"
              class="input input-line setting-num"
              type="number"
              min="1"
              max="20"
              inputmode="numeric"
            />
            <span class="setting-unit">MB</span>
          </span>
        </div>
        <div class="setting-row">
          <label for="settings-avatar-formats">{{ copy.avatarFormats }}</label>
          <span class="setting-control">
            <input
              id="settings-avatar-formats"
              v-model="form.avatarFormats"
              class="input input-line setting-text"
              type="text"
              maxlength="80"
              placeholder="jpg,jpeg,png,webp"
            />
          </span>
        </div>
      </div>
    </div>

    <div class="card">
      <span class="section-label">{{ t('admin.limits.formChars') }}</span>
      <p class="field-hint">{{ copy.limitIntro }}</p>
      <div v-for="group in limitGroups" :key="group.id" class="limit-group">
        <span class="limit-group-title">{{ group.title }}</span>
        <div v-for="(row, rowIndex) in pairLimits(group.items)" :key="group.id + '-' + rowIndex" class="limit-pair">
          <div v-for="item in row" :key="item.key" class="setting-block">
            <div class="setting-row">
              <label :for="'limit-' + item.key">{{ item.label }}</label>
              <span class="setting-control">
                <input
                  :id="'limit-' + item.key"
                  v-model.number="form.limits[item.key]"
                  class="input input-line setting-num"
                  type="number"
                  min="0"
                  inputmode="numeric"
                />
                <span class="setting-unit">{{ item.unit }}</span>
              </span>
            </div>
            <p class="field-hint">{{ item.hint }}</p>
          </div>
        </div>
      </div>
    </div>

    <p v-if="settingsError" class="field-error" role="alert">{{ settingsError }}</p>

    <!-- 悬浮保存：只在本分区（管理-设置）渲染，贴页面右下角；保存中或没有权限时禁用。
         用 .round-action（51px 圆形、带阴影）加 save 图标，标题与读屏名复用同一句文案。
         投递到 body：fixed 若留在页面里，页面切换的 .route-enter 动画期间
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

<style scoped>
/* 卡片内的节奏：组标题到第一行留 12px，组与组之间 20px（在 .list 层）。
   设置项本身「一行标题 + 一行说明」为一组，组与组之间 16px。 */
.card {
  gap: var(--s3);
}

.settings-rows {
  display: grid;
  gap: var(--s5);
  min-width: 0;
}

.setting-row {
  display: flex;
  align-items: center;
  gap: var(--s4);
  min-width: 0;
  /* 命中区仍是 44px；标签与控件在垂直方向居中对齐，长短说明不会把行撑歪。 */
  min-height: var(--touch);
}

/* 设置项标题：比下面的说明文字更重、更大、更黑，否则读不出层级。
   说明文字走 .field-hint（--fs-meta、--ink-3）。 */
.setting-row > label,
.setting-block > label,
.setting-block > .field-label {
  flex: 1 1 auto;
  min-width: 0;
  color: var(--ink);
  font-size: var(--fs-body);
  font-weight: 700;
  line-height: 1.35;
}

.setting-control {
  flex: none;
  display: flex;
  align-items: center;
  gap: var(--s2);
  min-width: 0;
}

.setting-control .input {
  width: auto;
  min-height: var(--ctrl);
}

.setting-control .setting-num {
  width: 96px;
  text-align: end;
}

.setting-control .setting-text {
  width: 148px;
  font-size: var(--fs-meta);
}

.setting-unit {
  flex: none;
  color: var(--ink-3);
  font-size: var(--fs-meta);
  white-space: nowrap;
}

/* 一项设置 = 标题行 + 说明。说明紧贴标题（2px），组与组之间才拉开，
   这样「标题 / 说明」读成一块，而不是四行等距的散点。 */
.setting-block {
  display: grid;
  gap: 0;
  align-content: start;
  min-width: 0;
}

.setting-block .field-hint {
  margin: 2px 0 0;
  /* 说明比标题弱一档，长度也收住，避免一行拉到屏幕边缘。 */
  max-width: 34em;
}

/* 存储条：一条填充线，用满时换成砖红。 */
.storage-meter {
  height: 6px;
  overflow: hidden;
  border-radius: var(--r-pill);
  background: var(--f1);
}

.storage-meter > span {
  display: block;
  height: 100%;
  border-radius: inherit;
  background: var(--accent);
  transition: width var(--motion-base) var(--ease);
}

.storage-meter[data-full='true'] > span {
  background: var(--danger-ink);
}

/* 缺省封面：左 96×170 竖版预览，右侧竖排按钮与说明，窄屏上下堆叠。 */
.cover-row {
  display: flex;
  flex-wrap: wrap;
  align-items: flex-start;
  gap: var(--s4);
}

.cover-frame {
  flex: 0 0 96px;
  width: 96px;
  aspect-ratio: 1080 / 1920;
  border-radius: var(--r-card);
}

.cover-side {
  flex: 1 1 150px;
  min-width: 0;
  display: grid;
  gap: var(--s2);
  align-content: start;
}

.cover-side .cta {
  width: 100%;
}

.cover-side .field-hint {
  margin: 0;
}

/* 文字长度分组：同一张卡里用分隔线隔开，组内两列自适应。 */
.limit-group {
  display: grid;
  gap: var(--s5);
  padding-top: var(--s4);
  border-top: var(--hairline) solid var(--stroke);
}

.limit-group-title {
  color: var(--ink);
  font-size: var(--fs-meta);
  font-weight: 700;
  letter-spacing: 0.02em;
}

/* 组标题后面紧跟的说明段落：比它到下一组更近一档，才不会读成「下一组的开头」。 */
.section-label + .field-hint {
  margin-top: calc(var(--s1) * -1);
  max-width: 34em;
}

/* 卡里剩下几处「标签在上、控件在下」的字段（邀请码三列）：标题与输入框之间 8px，
   与设置项的标题同一档字号与字重，整页读起来是一套。 */
.card > .field {
  gap: var(--s2);
}

.card > .field > label {
  color: var(--ink);
  font-size: var(--fs-body);
  font-weight: 700;
}

.grid-cols-3 > .field {
  gap: 6px;
}

/* 邀请码列表前的说明与生成按钮之间留一档，不贴着列表第一行。 */
.invite-list {
  margin-top: var(--s1);
}

.limit-pair {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(min(260px, 100%), 1fr));
  align-items: start;
  gap: var(--s5) var(--s6);
}

/* 邀请码列表：等宽码在左，右端两枚图标按钮；已用完的行压暗。 */
.invite-list {
  display: grid;
  gap: 0;
}

.invite-row {
  display: flex;
  align-items: center;
  gap: var(--s2);
  min-height: var(--touch);
  padding-block: var(--s2);
}

.invite-row + .invite-row {
  border-top: var(--hairline) solid var(--stroke);
}

.invite-row[data-dim='true'] {
  opacity: 0.55;
}

.invite-copy {
  flex: 1 1 auto;
  min-width: 0;
  display: grid;
  gap: 2px;
}

.invite-code {
  color: var(--ink);
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  font-size: var(--fs-h3);
  font-weight: 700;
  letter-spacing: 0.06em;
}

.invite-actions {
  flex: none;
  display: flex;
  align-items: center;
  gap: var(--s1);
}

/* 悬浮保存按钮：fixed 贴屏幕右下角，但横向要落在应用这条 720px 居中列内，
   不能飘到窗口边；底部要避开底部导航与安全区。 */
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
