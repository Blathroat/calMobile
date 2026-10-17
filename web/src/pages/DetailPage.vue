<script setup lang="ts">
/**
 * 屏幕 03 · 展会详情
 *
 * 业务：展会信息 + 报名收集项 + 系统日历 + 分享。
 * 简介可能是展商编辑器产出的 HTML，也可能是 Markdown，两种格式都在渲染前过清洗入口。
 */
import { computed, onMounted, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { api } from '@/app/runtime';
import { useAsync } from '@/composables/useAsync';
import { usePullRefresh } from '@/services/pull-refresh';
import { tagRead, type CachedRead } from '@/services/query-cache';
import { useBootstrapStore } from '@/stores/bootstrap';
import { useSessionStore } from '@/stores/session';
import { registrationLink } from '@/services/registration-link';
import { device } from '@/services/device-services';
import { loadMarkdownParser, markdownToHtml, plainText, sanitizeHtml } from '@/services/markdown';
import { coverOf } from '@/services/cover';
import { toast } from '@/services/toast';
import { openSheet } from '@/services/sheet';
import AppIcon from '@/components/AppIcon.vue';
import StateBlock from '@/components/StateBlock.vue';
import SkeletonBlock from '@/components/SkeletonBlock.vue';
import StatusTag from '@/components/StatusTag.vue';
import RoleTag from '@/components/RoleTag.vue';
import AvatarBox from '@/components/AvatarBox.vue';
import ImageViewer from '@/components/ImageViewer.vue';
import { formatDateWithWeekday } from '@/services/format';
import type { ExhibitionDetail, JsonObject } from '@/api/types';
import { t } from '@/i18n';

const route = useRoute();
const router = useRouter();
const session = useSessionStore();
const bootstrap = useBootstrapStore();
const joinLinkMissing = t('exhibition.detail.registrationSiteMissing');
const query = useAsync<ExhibitionDetail>();

const COPY = {
  /** 封面的 aria-label：点开后看大图。 */
  openViewer: t('exhibition.detail.viewLargeImage'),
};

const exhibition = computed(() => query.data.value?.exhibition);
const fields = computed<JsonObject[]>(() => query.data.value?.fields ?? []);
const found = computed(() => query.data.value?.found !== false);
const exhibitionId = computed(() => String(route.params.id ?? ''));

const calendarState = ref<{ inCalendar: boolean; granted: boolean }>({ inCalendar: false, granted: false });
const calendarBusy = ref(false);
/** 大图查看：封面放大到全屏，支持双指缩放。 */
const viewerOpen = ref(false);
/** 封面：自己上传的优先，其次管理员设置的缺省封面，都没有就是空串（画占位图）。 */
const cover = computed(() => coverOf(exhibition.value?.imageUri));
/** 日历状态只读一次：数据刷新会重画正文，但不该重复请求。 */
let calendarRequested = false;

/** 简介：HTML 走清洗，Markdown 走渲染入口，空简介给出说明而不是空白。 */
const description = computed(() => {
  const item = exhibition.value;
  if (!item) return { html: '', text: '' };
  const raw = String(item.description ?? '');
  if (item.descriptionFormat === 'html') {
    if (/<[a-z][\s\S]*>/i.test(raw)) return { html: sanitizeHtml(raw), text: '' };
    return { html: '', text: plainText(raw, 4000) };
  }
  return { html: markdownToHtml(raw), text: '' };
});

/** 已登录且后端明确下发可报名。 */
const canRegister = computed(() => session.user.can?.register === true);

/**
 * 已登录但被限制报名（`can.register` 明确为 false）。
 *
 * 必须与访客分开：访客的 `register` 也是 falsy，但访客的引导是「先去登录」，
 * 受限用户已经登录了，需要的是「为什么不能报名」。只认后端明确下发的 `false`。
 */
const registerLimited = computed(() => session.loggedIn === true && session.user.can?.register === false);

const registerBlocked = computed(() => exhibition.value?.openForRegistration === false || registerLimited.value);
const registerLabel = computed(() => {
  if (exhibition.value?.openForRegistration === false) return t('exhibition.detail.registrationClosed');
  return registerLimited.value || canRegister.value
    ? t('exhibition.detail.registerNow')
    : t('exhibition.detail.registerAfterLogin');
});

function footerHint(): string {
  const item = exhibition.value;
  if (!item) return '';
  if (item.openForRegistration === false) {
    return `${item.modeLabel || item.status}：该展会当前不接受报名。`;
  }
  if (registerLimited.value) return t('exhibition.detail.registerRestricted');
  // 访客进不来这一页（守守卫按「访客只可访问首页」处理），所以这里不再区分「先登录」的引导。
  return t('exhibition.detail.trackInActivities');
}

async function load(): Promise<void> {
  calendarRequested = false;
  const data = await query.run(() => {
    const pending = api.exhibitions.get(exhibitionId.value) as CachedRead<ExhibitionDetail>;
    return tagRead(
      pending.then(async (detail) => {
        if (detail.exhibition?.description) await loadMarkdownParser();
        return detail;
      }),
      pending.cached,
      pending.revalidating,
    );
  });
  if (data?.found === false) {
    calendarState.value = { inCalendar: false, granted: false };
    return;
  }
  if (!calendarRequested) {
    calendarRequested = true;
    void loadCalendarState();
  }
}

async function loadCalendarState(): Promise<void> {
  const item = exhibition.value;
  if (!item) return;
  try {
    const result = await device.calendarStatus({ title: String(item.title ?? ''), date: String(item.date ?? '') });
    calendarState.value = { inCalendar: result.inCalendar === true, granted: result.granted === true };
  } catch {
    calendarState.value = { inCalendar: false, granted: false };
  }
}

async function toggleCalendar(): Promise<void> {
  const item = exhibition.value;
  if (!item) return;
  calendarBusy.value = true;
  try {
    const result = await device.toggleCalendar({
      title: String(item.title ?? ''),
      venue: String(item.venue ?? ''),
      time: String(item.time ?? ''),
      // 日期用后端下发的 ISO 日期：原生按它写入，不再猜月份。
      date: String(item.date ?? ''),
      description: plainText(item.description, 200),
    });
    calendarState.value = { inCalendar: result.inCalendar === true, granted: result.granted === true };
    toast(result.message || t('exhibition.detail.calendarUpdated'), 'success');
  } catch (reason) {
    toast(reason instanceof Error ? reason.message : String(reason), 'error');
  } finally {
    calendarBusy.value = false;
  }
}

function startRegistration(): void {
  const item = exhibition.value;
  if (!item) return;
  if (registerLimited.value) {
    toast(t('exhibition.detail.registerRestricted'), 'error');
    return;
  }
  if (!canRegister.value) {
    toast(t('exhibition.detail.loginBeforeRegister'));
    return;
  }
  void router.push(`/registration-form/${item.id}`);
}

function share(): void {
  const item = exhibition.value;
  if (!item) return;
  const link = registrationLink(bootstrap.publicBaseUrl, item.id);
  const text = [
    String(item.title ?? ''),
    `${formatDateWithWeekday(item.date)} ${item.time}`,
    String(item.venue ?? ''),
    link ? `${t('exhibition.detail.registrationLinkPrefix')}${link}` : '',
  ]
    .filter(Boolean)
    .join('\n');
  openSheet({
    title: t('exhibition.detail.shareExhibition'),
    message: (link ? text : `${text}\n${joinLinkMissing}`).replace(/\n/g, ' · '),
    actions: [
      { label: t('common.cancel'), onClick: (close) => close() },
      {
        label: t('exhibition.detail.share'),
        variant: 'primary',
        onClick: async (close) => {
          close();
          try {
            await device.shareText(String(item.title ?? ''), text);
          } catch (reason) {
            toast(reason instanceof Error ? reason.message : String(reason), 'error');
          }
        },
      },
    ],
  });
}

// 会话只用于判断「能不能报名」，取到即可。
usePullRefresh(
  () => load(),
  computed(() => query.loading.value && query.data.value !== undefined),
);

onMounted(() => {
  void load();
});
</script>

<template>
  <Teleport defer to="#app-top-actions">
    <button
      class="icon-button"
      type="button"
      :aria-label="t('exhibition.detail.shareExhibition')"
      :title="t('exhibition.detail.shareExhibition')"
      @click="share"
    >
      <AppIcon name="share" />
    </button>
  </Teleport>

  <SkeletonBlock v-if="query.loading.value && !query.data.value" :rows="3" />

  <StateBlock
    v-else-if="query.error.value"
    tone="error"
    :title="t('common.loadFailed')"
    :description="query.error.value.message"
    :action-label="t('common.retry')"
    @action="load"
  />

  <!-- 展会可能刚被删除：说明原因并给出返回入口，重试没有意义 -->
  <StateBlock
    v-else-if="!found || !exhibition"
    tone="error"
    :title="t('exhibition.detail.notFound')"
    :description="String(query.data.value?.error || t('exhibition.detail.removedByExhibitor'))"
    :action-label="t('exhibition.detail.backHome')"
    @action="router.push('/home')"
  />

  <template v-else>
    <!-- 展会封面：设计比例 1080×1920 的竖版海报；点开后可以看大图并双指缩放。
         展会自己没有封面时用管理员设置的缺省封面，两处都为空才画占位图。 -->
    <button
      v-if="cover"
      class="hero ph-img hero-button"
      type="button"
      :aria-label="COPY.openViewer"
      @click="viewerOpen = true"
    >
      <img :src="cover" :alt="`${exhibition.title} 展会图片`" />
    </button>
    <div v-else class="hero ph-img" aria-hidden="true" />

    <div class="stack" data-gap="sm">
      <h2>{{ exhibition.title }}</h2>
      <p class="muted">
        {{ exhibition.exhibitor || t('exhibition.detail.brandMark') }} · {{ exhibition.exhibitorNote }}
      </p>
    </div>

    <div class="card" data-tone="fill">
      <div class="row" data-gap="md">
        <span class="dim" aria-hidden="true"><AppIcon name="calendar" size="icon icon-sm" /></span>
        <span class="row-meta">{{ formatDateWithWeekday(exhibition.date) }} {{ exhibition.time }}</span>
      </div>
      <div class="row" data-gap="md">
        <span class="dim" aria-hidden="true"><AppIcon name="home" size="icon icon-sm" /></span>
        <span class="row-meta">{{ exhibition.venue }}</span>
      </div>
      <div class="row" data-gap="md">
        <StatusTag :text="String(exhibition.modeLabel || exhibition.status || '')" />
        <span class="row-meta">{{
          exhibition.openForRegistration
            ? t('exhibition.detail.registrationNeeded')
            : t('exhibition.detail.registrationUnavailable')
        }}</span>
      </div>
    </div>

    <button
      class="row-card"
      type="button"
      data-pressable="true"
      :aria-label="`查看 ${exhibition.exhibitor} 的公开主页`"
      @click="router.push(`/user-public/${encodeURIComponent(String(exhibition.exhibitor))}`)"
    >
      <AvatarBox :name="String(exhibition.exhibitor || '')" />
      <span class="row-copy">
        <span class="name-line">
          <strong class="row-title">{{ exhibition.exhibitor }}</strong>
          <RoleTag :role-code="String(exhibition.exhibitorRole || '')" />
        </span>
        <span class="row-meta">{{ t('exhibition.detail.viewExhibitorHome') }}</span>
      </span>
      <AppIcon name="chevronRight" />
    </button>

    <div class="stack" data-gap="sm">
      <span class="section-label">{{ t('exhibition.detail.introduction') }}</span>
      <div v-if="description.html" class="rich-content" v-html="description.html" />
      <p v-else-if="description.text" class="row-meta">{{ description.text }}</p>
      <p v-else class="muted">{{ t('exhibition.detail.introductionEmpty') }}</p>
    </div>

    <div class="stack" data-gap="sm">
      <span class="section-label">{{ t('exhibition.detail.registrationInfo') }}</span>
      <p class="row-meta">
        {{
          fields.length > 0
            ? `展商配置了 ${fields.length} 项信息：${fields.map((field) => String(field.title)).join('、')}`
            : t('exhibition.detail.noExtraRegistrationInfo')
        }}
      </p>
    </div>
  </template>

  <!-- 底部固定操作区：加入日历 + 报名 -->
  <Teleport v-if="exhibition && found" defer to="#app-foot">
    <div class="page-foot">
      <div class="stack" data-gap="sm">
        <div class="grid-cols-2">
          <button
            class="cta ghost"
            type="button"
            :disabled="calendarBusy"
            :data-loading="calendarBusy ? 'true' : 'false'"
            @click="toggleCalendar"
          >
            {{
              calendarState.inCalendar
                ? t('exhibition.detail.removeFromCalendar')
                : t('exhibition.detail.addToCalendar')
            }}
          </button>
          <button
            class="cta"
            type="button"
            :disabled="registerBlocked"
            :title="registerLimited ? t('exhibition.detail.registerRestricted') : undefined"
            @click="startRegistration"
          >
            {{ registerLabel }}
          </button>
        </div>
        <p class="field-hint text-center">{{ footerHint() }}</p>
      </div>
    </div>
  </Teleport>

  <!-- 大图查看：只画显示与手势，关闭由本页处理 -->
  <ImageViewer
    v-if="viewerOpen && exhibition && cover"
    :src="cover"
    :alt="`${exhibition.title} 展会图片`"
    @close="viewerOpen = false"
  />
</template>

<style>
/* 可点开的封面：清掉按钮自带的内边距 / 字体 / 居中，只保留 .hero 的尺寸与描边 */
.hero-button {
  display: block;
  padding: 0;
  font: inherit;
  color: inherit;
  cursor: pointer;
  appearance: none;
}
</style>
