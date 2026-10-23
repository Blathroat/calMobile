<script setup lang="ts">
/**
 * 屏幕 10 · 展商后台
 *
 * 卡片上「查看报名」「编辑展会」「复制链接」排在同一行。点卡片主体进入展会详情。
 * 都属于展会的配置，统一收进「编辑展会」的二级界面，卡片保持清爽。
 * 顶部提供「核销报名码」，展商在现场扫描用户报名详情里的二维码即可完成核销。
 *
 * 受限账号（`can.limited`）不能发布 / 修改 / 删除展会、不能改报名设置、不能核销，
 * 后端对这些写操作一律 403。入口提前置灰并说明原因，而不是让展商填完表单才吃 403；
 * 受限的展商照样能进后台、查看与审核已有的报名，因此后台本身不封。
 */
import { computed, onMounted, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { api } from '@/app/runtime';
import { useAsync } from '@/composables/useAsync';
import { usePullRefresh } from '@/services/pull-refresh';
import { useHint } from '@/composables/useHint';
import { coverOf } from '@/services/cover';
import { useBootstrapStore } from '@/stores/bootstrap';
import { useSessionStore } from '@/stores/session';
import { toast } from '@/services/toast';
import { openSheet } from '@/services/sheet';
import { registrationLink } from '@/services/registration-link';
import { modeLabel, statusTone } from '@/services/status';
import AppIcon from '@/components/AppIcon.vue';
import HintNote from '@/components/HintNote.vue';
import SegControl from '@/components/SegControl.vue';
import MeetingInbox from '@/components/MeetingInbox.vue';
import StateBlock from '@/components/StateBlock.vue';
import SkeletonBlock from '@/components/SkeletonBlock.vue';
import MediaBox from '@/components/MediaBox.vue';
import StatusTag from '@/components/StatusTag.vue';
import type { Exhibition } from '@/api/types';
import { t } from '@/i18n';

const router = useRouter();
const route = useRoute();
const bootstrap = useBootstrapStore();
const session = useSessionStore();

/** 分区 id 写进 `?tab=`，从设置页返回时仍停在私人会议。 */
const TABS = [
  { value: 'exhibitions', label: t('admin.exhibitions.title') },
  { value: 'meetings', label: t('registration.list.privateMeeting') },
];
const tabIds = new Set(TABS.map((item) => item.value));
const tab = ref(tabFromQuery());
const partitionLabel = t('exhibitor.sections');

function tabFromQuery(): string {
  const value = String(route.query.tab ?? '');
  return tabIds.has(value) ? value : 'exhibitions';
}

function changeTab(value: string): void {
  if (value === tab.value) return;
  void router.replace({ query: { ...route.query, tab: value } });
}

watch(
  () => route.fullPath,
  () => {
    if (route.path !== '/exhibitor') return;
    tab.value = tabFromQuery();
  },
);
const query = useAsync<Exhibition[]>();
/** 核销提示：与账号绑定的一次性提示，进过一次核销页就不再显示。 */
const { visible: hintVisible, dismiss: dismissHint } = useHint('exhibitor-checkin');

const items = computed<Exhibition[]>(() => query.data.value ?? []);
/** 已有内容时刷新只标记忙碌，不清空列表（避免切回本页先闪骨架屏）。 */
const hasContent = computed(() => query.data.value !== undefined);
const limited = computed(() => session.user.can?.limited === true);

/** 卡片上的报名总数：列表里每行都带 registrationCount。 */
const registrationTotal = computed(() =>
  items.value.reduce((sum, item) => sum + (Number(item.registrationCount) || 0), 0),
);

function load(): Promise<unknown> {
  return query.run(() => api.exhibitions.list());
}

/** 新建展会：受限时用同一句提示兜住残留入口。 */
function createExhibition(): void {
  if (limited.value) {
    toast(t('exhibition.form.publishBlocked'), 'error');
    return;
  }
  void router.push('/exhibition-form');
}

/** 编辑已有展会：受限时同样兜一层，别让残留入口绕过置灰。 */
function openExhibitionForm(id: unknown): void {
  if (limited.value) {
    toast(t('exhibition.form.editBlocked'), 'error');
    return;
  }
  void router.push(`/exhibition-form/${String(id)}`);
}

/** 核销报名码：受限账号进得去页面也提交不了，入口就在这里挡住。 */
const joinLinkMissing = t('exhibition.detail.registrationSiteMissing');
const joinLinkCopied = t('exhibitor.registrationLinkCopied');
const joinLinkCopy = t('exhibitor.copyLink');

async function copyJoinLink(id: unknown): Promise<void> {
  const link = registrationLink(bootstrap.publicBaseUrl, id);
  if (!link) {
    toast(joinLinkMissing, 'error');
    return;
  }
  try {
    await navigator.clipboard.writeText(link);
    toast(joinLinkCopied);
  } catch {
    openSheet({
      title: joinLinkCopy,
      message: link,
      actions: [{ label: t('common.cancel'), onClick: (close) => close() }],
    });
  }
}

function openCheckin(): void {
  if (limited.value) {
    toast(t('exhibitor.cannotCheckin'), 'error');
    return;
  }
  // 这条提示教的就是「去核销」，用户走一次这个入口就不必再看到它。
  void dismissHint();
  void router.push('/checkin');
}

/** 手指按下就先取展会详情，点进详情页时数据通常已经到了。 */
function warm(id: unknown): void {
  if (id === undefined || id === null) return;
  void api.exhibitions.get(String(id)).catch(() => undefined);
}

onMounted(() => {
  void load();
});

usePullRefresh(
  () => load(),
  computed(() => query.loading.value && hasContent.value),
  computed(() => tab.value !== 'meetings'),
);
</script>

<template>
  <!-- 顶栏已经写着「展商后台」，正文不再重复标题。分段始终在内容之前，空列表不能把切换按钮盖掉。 -->
  <SegControl :model-value="tab" :items="TABS" :label="partitionLabel" @update:model-value="changeTab" />

  <MeetingInbox v-if="tab === 'meetings'" mode="exhibitor" />

  <SkeletonBlock v-else-if="query.loading.value && !hasContent" :rows="3" />

  <StateBlock
    v-else-if="query.error.value && !hasContent"
    tone="error"
    :title="t('exhibitor.listLoadFailed')"
    :description="query.error.value.message"
    :action-label="t('common.retry')"
    @action="load"
  />

  <!-- 空态：受限账号不给「新建展会」入口，只说明原因 -->
  <StateBlock
    v-else-if="items.length === 0"
    icon="briefcase"
    :title="t('exhibitor.noHosted')"
    :description="limited ? t('exhibition.form.publishBlocked') : t('exhibitor.createFirstHint')"
    :action-label="limited ? '' : t('exhibition.editor.newExhibition')"
    @action="createExhibition"
  />

  <template v-else>
    <button
      class="cta ghost"
      type="button"
      :disabled="limited"
      :title="limited ? t('exhibitor.cannotCheckin') : undefined"
      @click="openCheckin"
    >
      {{ t('exhibitor.checkin') }}
    </button>

    <div v-if="limited" class="notice" data-tone="accent">
      <strong>{{ t('exhibition.form.publishBlocked') }}</strong>
      <span>{{ t('exhibition.form.restrictedAccount') }}</span>
    </div>

    <div v-if="query.error.value" class="notice" data-tone="accent">
      <span>{{ query.error.value.message }}</span>
    </div>

    <div class="row" data-between="true">
      <span class="section-label">{{ t('exhibitor.hostedExhibitions') }}</span>
      <span class="pill">{{
        t('exhibition.list.countLabel', { count: items.length, registrations: registrationTotal })
      }}</span>
    </div>

    <!-- 一次性提示：进过一次核销页（这条提示指的就是那个入口）就不再显示 -->
    <HintNote v-if="hintVisible" :text="t('exhibitor.checkinHint')" @dismiss="dismissHint" />

    <!-- 每张卡只有一层纸：上半整块可点进详情，一条分隔线下面放展会配置动作 -->
    <div class="list" data-gap="sm">
      <div v-for="item in items" :key="String(item.id)" class="card">
        <button
          class="exh-main"
          type="button"
          data-pressable="true"
          :aria-label="t('exhibition.list.viewAria', { title: item.title })"
          @pointerdown="warm(item.id)"
          @click="router.push(`/detail/${item.id}`)"
        >
          <MediaBox
            :src="coverOf(item.imageUri)"
            class-name="thumb thumb-cover exh-thumb"
            :alt="String(item.title || '')"
          />
          <span class="row-copy">
            <strong class="row-title exh-title">{{ item.title }}</strong>
            <span class="row-meta">{{ item.dateLabel }} {{ item.time }}</span>
            <span class="row-meta truncate">{{ item.venue }}</span>
            <!-- 状态与报名数合成一条信号灯：既没有「左边空着」的单独一行，
                 也不会和标题抢宽度。 -->
            <StatusTag
              :text="
                t('exhibition.list.statusWithRegistrations', {
                  status: modeLabel(String(item.statusCode ?? '')),
                  count: String(item.registrationCount ?? 0),
                })
              "
              :tone="statusTone(String(item.statusCode || ''))"
            />
            <span v-if="item.qrEnabled === true" class="row-meta">{{ t('exhibitor.qrEnabled') }}</span>
          </span>
        </button>

        <div class="action-row">
          <button
            class="cta ghost"
            data-size="small"
            type="button"
            @click="router.push(`/review?exhibitionId=${encodeURIComponent(String(item.id))}`)"
          >
            {{ t('admin.exhibitions.viewRegistrations') }}
          </button>
          <button
            class="cta ghost"
            data-size="small"
            type="button"
            :disabled="limited"
            :title="limited ? t('exhibition.form.editBlocked') : undefined"
            @click="openExhibitionForm(item.id)"
          >
            {{ t('admin.exhibitions.edit') }}
          </button>
          <button class="cta ghost" data-size="small" type="button" @click="copyJoinLink(item.id)">
            {{ joinLinkCopy }}
          </button>
        </div>
      </div>
    </div>
  </template>

  <!-- 右下角悬浮新建：空态里 StateBlock 已有入口，所以只在有列表时出现。
       投递到 body：路由容器带着页面切换动画的 transform，会成为 fixed 的包含块，
       留在页面里会跟着内容走而不是固定在视口右下角。 -->
  <Teleport v-if="tab === 'exhibitions' && items.length > 0" to="body">
    <button
      class="round-action exh-fab"
      type="button"
      :disabled="limited"
      :aria-label="t('exhibition.editor.newExhibition')"
      :title="limited ? t('exhibition.form.publishBlocked') : t('exhibition.editor.newExhibition')"
      @click="createExhibition"
    >
      <AppIcon name="plus" />
    </button>
  </Teleport>
</template>

<style scoped>
/* 缩略图按设计稿的 44×78 竖版；全局 .thumb 是 36×64，只在本页放大一档。 */
.exh-thumb {
  width: 44px;
  height: 78px;
}

/* 卡片主体：整块可点，纸面的内距交给外层 .card，这里只排内容 */
.exh-main {
  display: flex;
  align-items: flex-start;
  gap: var(--s3);
  width: 100%;
  min-width: 0;
  padding: 0;
  text-align: start;
}

/* 标题最多两行：320 宽下也不会被截成四五个字。 */
.exh-title {
  display: -webkit-box;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 2;
  overflow: hidden;
  overflow-wrap: anywhere;
}

/* 右下角悬浮圆形按钮：避开底部导航与安全区。 */
.exh-fab {
  position: fixed;
  right: var(--s5);
  bottom: calc(var(--s6) + var(--safe-bottom) + 56px);
  z-index: 6;
}

.exh-fab[disabled] {
  background: var(--f1);
  color: var(--ink-3);
  cursor: not-allowed;
}
</style>
