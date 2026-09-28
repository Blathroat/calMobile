<script setup lang="ts">
/**
 * 屏幕 15 · 管理后台（用户 / 展会 / 设置）
 * 线框：docs/newUI/remaining-ui.html #screen-admin-backend、#screen-admin-settings
 *
 * 展会卡片与展商后台保持一致；搜索、暂停与导出直接内联在本页。
 * 启动公告、展会分类、审核策略、媒体与上传限制、字符数上限都属于服务器设置，
 * 保存后对所有用户生效，因此统一放在「设置」分区，不再有二级页面。
 *
 * 分段只切本地状态：切分区复用已取到的数据，不整页重建；
 * 搜索框带防抖，避免每次按键都触发一次取数。
 */
import { computed, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { api, applyRuntimeBootstrap } from '@/app/runtime';
import { useAsync } from '@/composables/useAsync';
import { useBootstrapStore } from '@/stores/bootstrap';
import { useSessionStore } from '@/stores/session';
import { toast } from '@/services/toast';
import { confirmSheet, openSheet } from '@/services/sheet';
import type { SheetAction } from '@/services/sheet';
import { check } from '@/services/validate';
import { EXHIBITION_STATUS, statusTone } from '@/services/status';
import { formatDateWithWeekday, truncate } from '@/services/format';
import { device } from '@/services/device-services';
import SegControl from '@/components/SegControl.vue';
import AvatarBox from '@/components/AvatarBox.vue';
import MediaBox from '@/components/MediaBox.vue';
import StateBlock from '@/components/StateBlock.vue';
import SkeletonBlock from '@/components/SkeletonBlock.vue';
import StatusTag from '@/components/StatusTag.vue';
import type { Bootstrap, Exhibition, JsonObject, User } from '@/api/types';
import { t } from '@/i18n';

const USER_STATUSES = [t('s_tt5vxa'), t('s_1am6dte'), t('s_1j1q2yf')];

/**
 * 分区用稳定的英文 id 做值（`value` 会写进 URL 的 `?tab=`），标签才是给用户看的文案：
 * 用中文当值会让地址栏里出现百分号转义，也不便于以后改文案。
 */
const TABS = [
  { value: 'users', label: t('s_1in002o') },
  { value: 'exhibitions', label: t('s_11cd4ta') },
  { value: 'settings', label: t('s_1vmubx9') },
];

const tabIds = new Set(TABS.map((item) => item.value));

/**
 * 字符数上限的唯一清单：控件的键、提交的字段名与后端 `app_settings.limits` 的键名
 * 都从这里派生，新增一项只加一行。取值范围由后端收敛（超出会被夹到合法区间）。
 */
const TEXT_LIMITS: Array<{ key: string; label: string; hint: string }> = [
  { key: 'exhibitionTitle', label: t('s_1co82cb'), hint: t('s_1mcmbiu') },
  { key: 'exhibitionVenue', label: t('s_1tlfy5l'), hint: t('s_1mcmbiu') },
  { key: 'category', label: t('s_9xu72h'), hint: t('s_1mcmbiu') },
  { key: 'fieldTitle', label: t('s_1yqwetn'), hint: t('s_1mcmbiu') },
  { key: 'usernameMin', label: t('s_dtadu0'), hint: t('s_1mcmbiu') },
  { key: 'usernameMax', label: t('s_196bpby'), hint: t('s_1mcmbiu') },
  { key: 'passwordMin', label: t('s_e6tqxb'), hint: t('s_1jlgtug') },
  { key: 'passwordMax', label: t('s_19rf1tx'), hint: t('s_1jlgtug') },
  { key: 'nickname', label: t('s_jxewei'), hint: t('s_1mcmbiu') },
  { key: 'bio', label: t('s_euttee'), hint: t('s_1mcmbiu') },
  { key: 'region', label: t('s_16txual'), hint: t('s_1mcmbiu') },
  { key: 'answer', label: t('s_1j77by5'), hint: t('s_1mcmbiu') },
];

const router = useRouter();
const route = useRoute();
const bootstrap = useBootstrapStore();
const session = useSessionStore();

/** 当前分区来自 URL：从「查看报名」这类二级页返回时，仍停在进入前的分区。 */
const tab = ref(tabFromQuery());
const query = ref('');
const users = useAsync<User[]>();
const exhibitions = useAsync<Exhibition[]>();
const settingsQuery = useAsync<JsonObject>();

/** 服务端设置的可编辑副本：一次取回，保存时整体回填。 */
const form = reactive({
  brand: { zh: '', en: '' },
  announcement: '',
  announcementEnabled: false,
  categories: '',
  canRevise: false,
  imageCount: 8,
  imageSizeMb: 10,
  videoCount: 2,
  videoSizeMb: 50,
  avatarSizeMb: 2,
  imageFormats: '',
  videoFormats: '',
  limits: {} as Record<string, number>,
});
const settingsError = ref('');
const settingsSaving = ref(false);
const loaded = ref(false);
const panelBusy = computed(() => users.loading.value || exhibitions.loading.value || settingsQuery.loading.value);

const userItems = computed<User[]>(() => users.data.value ?? []);
const exhibitionItems = computed<Exhibition[]>(() => exhibitions.data.value ?? []);

/** 前 10 项两两一行，最后两项各占一行（与旧实现的分组一致）。 */
const limitRows = computed(() => {
  const rows: Array<Array<{ key: string; label: string; hint: string }>> = [];
  for (let index = 0; index + 1 < TEXT_LIMITS.length - 1; index += 2) {
    rows.push(TEXT_LIMITS.slice(index, index + 2));
  }
  rows.push(TEXT_LIMITS.slice(-2));
  return rows;
});

// ── 分区取数 ─────────────────────────────────────────────────────

let searchTimer: number | undefined;

/** 搜索框带 220ms 防抖，避免每次按键都触发一次取数。 */
function onSearch(value: string): void {
  window.clearTimeout(searchTimer);
  searchTimer = window.setTimeout(() => {
    query.value = value.trim();
    void loadUsers();
  }, 220);
}

function loadUsers(): Promise<unknown> {
  return users.run(() => api.users.list({ query: query.value }));
}

function loadExhibitions(): Promise<unknown> {
  return exhibitions.run(() => api.exhibitions.list({ query: query.value }));
}

function loadPanel(): void {
  // 与 TABS 的 id 比较（不是中文标签）：标签是用来显示的，改文案不该影响取数分支。
  if (tab.value === 'users') {
    void loadUsers();
    return;
  }
  if (tab.value === 'exhibitions') {
    void loadExhibitions();
    return;
  }
  void loadSettings();
}

function changeTab(value: string): void {
  if (value === tab.value) return;
  tab.value = value;
  // 搜索词跟着分区走：换分区后旧的筛选不再适用。
  query.value = '';
  // 把分区写进地址栏（替换历史，不留下一条只换过 tab 的记录）：
  // 从二级页返回时才能回到同一个分区。
  void router.replace({ query: { ...route.query, tab: value } });
  loadPanel();
}

/** URL 里的分区 id；非法或缺省时回到第一个分区。 */
function tabFromQuery(): string {
  const value = String(route.query.tab ?? '');
  return tabIds.has(value) ? value : (TABS[0]?.value ?? '');
}

// 从二级页返回、或用户直接改地址栏时，让分区跟着 URL 走。
watch(() => route.query.tab, () => {
  const next = tabFromQuery();
  if (next === tab.value) return;
  tab.value = next;
  query.value = '';
  loadPanel();
});

/**
 * 预热另外两个分区：切分区时才第一次取数，会先画一段加载态（整页闪一下）。
 * 三个分区的读接口都走查询缓存，这里只是把请求提前到当前分区画完之后发，
 * 切过去时直接命中缓存。失败无所谓：真到那一步会照常报错并给重试。
 */
function preloadPanels(): void {
  window.setTimeout(() => {
    if (tab.value !== 'users') void loadUsers().catch(() => undefined);
    if (tab.value !== 'exhibitions') void loadExhibitions().catch(() => undefined);
    if (tab.value !== 'settings') void loadSettings().catch(() => undefined);
  }, 0);
}

onMounted(() => {
  loadPanel();
  preloadPanels();
});
onBeforeUnmount(() => window.clearTimeout(searchTimer));

// ── 用户管理 ─────────────────────────────────────────────────────

/**
 * 状态面板只列出状态名，不再附「· 说明」：说明属于顶部那条账号状态提示，
 * 塞进按钮里会让每个选项都变成一句话，选起来反而更慢。
 */
function manageUser(user: User): void {
  const actions: SheetAction[] = USER_STATUSES.map((status) => ({
    label: status,
    variant: user.status === status ? 'primary' : 'ghost',
    onClick: async (close) => {
      close();
      await updateUserStatus(user, status);
    },
  }));
  // 不放「取消」：点遮罩、按返回或 Esc 都能关，面板里多一个取消只会让状态选项更不显眼。
  openSheet({
    title: `管理 ${user.nickname}`,
    message: `${user.role} · 注册于 ${user.registrationTime || t('s_1lpnuh4')}`,
    actions,
    layout: 'stack',
  });
}

async function updateUserStatus(user: User, status: string): Promise<void> {
  try {
    // 写接口统一返回 { ok, error }：只判断整个响应是否为真会把失败也当成成功。
    const result = await api.users.setStatus(String(user.id ?? ''), status);
    const ok = result?.ok === true;
    toast(String(ok ? `已将 ${user.nickname} 设为${status}` : (result?.error || t('s_10lkv9z'))), ok ? 'success' : 'error');
    if (ok) await loadUsers();
  } catch (reason) {
    toast(reason instanceof Error ? reason.message : String(reason), 'error');
  }
}

/**
 * 关闭某个账号的两步验证 —— 两步验证唯一的兜底出口。
 * 用户邮箱用不了时本人登不进去也关不掉，只有管理员能帮他恢复访问，因此要二次确认。
 */
function disableTwoFactor(user: User): void {
  confirmSheet({
    title: t('s_p1k61'),
    message: `关闭后 ${user.nickname} 登录时只校验密码。请确认这是账号本人提出的请求。`,
    confirmLabel: t('s_g0fanx'),
    tone: 'danger',
    onConfirm: async () => {
      try {
        const result = await api.users.disableTwoFactor(String(user.id ?? ''));
        const ok = result?.ok === true;
        toast(
          String(ok ? `已关闭 ${user.nickname} 的两步验证` : (result?.error || t('s_10lkv9z'))),
          ok ? 'success' : 'error',
        );
        if (ok) await loadUsers();
      } catch (reason) {
        toast(reason instanceof Error ? reason.message : String(reason), 'error');
      }
    },
  });
}

// ── 展会管理 ─────────────────────────────────────────────────────

/** 暂停 / 恢复报名：管理员暂停后普通用户不能报名，展商不能自行恢复。 */
function toggleLock(item: Exhibition): void {
  const closing = item.openForRegistration === true;
  const title = closing ? t('s_2fmcqd') : t('s_1w55sta');
  const nextStatus = closing ? EXHIBITION_STATUS.CLOSED : EXHIBITION_STATUS.REVIEW_REQUIRED;
  const message = closing
    ? `暂停后「${item.title}」不可报名，展商不能自行恢复。`
    : `恢复后「${item.title}」将重新按需审核的方式收集报名。`;
  confirmSheet({
    title,
    message,
    confirmLabel: title,
    onConfirm: async () => {
      try {
        const result = await api.exhibitions.setStatus(String(item.id), nextStatus);
        const ok = result?.ok === true;
        toast(String(ok ? `已${title}` : (result?.error || t('s_ydow7a'))), ok ? 'success' : 'error');
        if (ok) await loadExhibitions();
      } catch (reason) {
        toast(reason instanceof Error ? reason.message : String(reason), 'error');
      }
    },
  });
}

/** CSV 字段转义：含逗号、引号或换行时用双引号包住，内部引号翻倍。 */
function csvCell(value: unknown): string {
  const text = String(value ?? '');
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

async function exportCsv(): Promise<void> {
  const rows = [
    [t('s_1co82cb'), t('s_25fwki'), t('s_14s86i5'), t('s_1f90xvr'), t('s_1ccx4t4'), t('s_1kbcp7q'), t('s_xr45ks')],
    ...exhibitionItems.value.map((item) => [
      String(item.title ?? ''),
      String(item.venue ?? ''),
      String(item.date ?? item.dateLabel ?? ''),
      String(item.time ?? ''),
      String(item.modeLabel ?? item.status ?? ''),
      String(item.category ?? ''),
      String(item.description ?? '').replace(/\n/g, ' '),
    ]),
  ];
  // 带 BOM，Excel 打开中文表头才不会乱码。
  const content = `\uFEFF${rows.map((row) => row.map(csvCell).join(',')).join('\r\n')}\r\n`;
  const filename = 'exhibitions.csv';
  try {
    await device.exportCsv(filename, content);
    toast(`已导出 ${exhibitionItems.value.length} 行到 ${filename}`, 'success');
  } catch (reason) {
    // 用户在系统保存框点了取消：按码判断，不给红色错误，只说明没有导出。
    if (reason && typeof reason === 'object' && (reason as { code?: unknown }).code === 'cancelled') {
      toast(t('s_1va7jf9'));
      return;
    }
    toast(reason instanceof Error ? reason.message : String(reason), 'error');
  }
}

// ── 服务器设置 ───────────────────────────────────────────────────

const formatPattern = /^[A-Za-z0-9]+(\s*,\s*[A-Za-z0-9]+)*$/;
const titleEnPattern = /^[A-Za-z0-9][A-Za-z0-9 ._-]*$/;

async function loadSettings(): Promise<void> {
  const data = await settingsQuery.run(() => api.settings.get());
  if (!data) return;
  fillForm(data);
  loaded.value = true;
}

/** 把服务端设置落到表单：缺省项退回 bootstrap 里已经有的值。 */
function fillForm(data: JsonObject): void {
  const brand = (data.brand ?? {}) as JsonObject;
  const announcement = (data.announcement ?? {}) as JsonObject;
  const review = (data.review ?? {}) as JsonObject;
  const media = (data.media ?? {}) as JsonObject;
  const upload = (data.upload ?? {}) as JsonObject;
  const limits = (data.limits ?? {}) as JsonObject;
  const theme = (data.theme ?? {}) as JsonObject;

  form.brand.zh = String(brand.zh ?? bootstrap.brand.zh ?? '');
  form.brand.en = String(brand.en ?? bootstrap.brand.en ?? '');
  form.announcement = String(announcement.text ?? '');
  form.announcementEnabled = announcement.enabled === true;
  form.categories = (Array.isArray(data.categories) ? data.categories : []).map((item) => String(item)).join('\n');
  form.canRevise = review.canRevise === true;
  form.imageCount = Number(media.imageCount ?? bootstrap.media.imageCount ?? 8);
  form.imageSizeMb = Number(media.imageSizeMb ?? bootstrap.media.imageSizeMb ?? 10);
  form.videoCount = Number(media.videoCount ?? bootstrap.media.videoCount ?? 2);
  form.videoSizeMb = Number(media.videoSizeMb ?? bootstrap.media.videoSizeMb ?? 50);
  form.avatarSizeMb = Number(upload.avatarSizeMb ?? bootstrap.server.avatarSizeMb ?? 2);
  form.imageFormats = (Array.isArray(upload.imageFormats) ? upload.imageFormats : []).map((item) => String(item)).join(',');
  form.videoFormats = (Array.isArray(upload.videoFormats) ? upload.videoFormats : []).map((item) => String(item)).join(',');
  form.limits = {};
  for (const item of TEXT_LIMITS) form.limits[item.key] = Number(limits[item.key] ?? bootstrap.limits[item.key] ?? 0);
}

/** 上限表单的数值读取：空输入按 0 处理，后端会把 0 夹到合法区间。 */
function numberField(key: string): number {
  return Number(form.limits[key]) || 0;
}

async function saveSettings(): Promise<void> {
  settingsError.value = '';
  const checks: Array<[string, string]> = [
    [t('s_1sx8n02'), check(form.brand.zh, { label: t('s_1sx8n02'), required: true, max: 20 })],
    [t('s_1lwq2zi'), check(form.brand.en, {
      label: t('s_1lwq2zi'), required: true, max: 24, pattern: titleEnPattern, patternMessage: t('s_1q0bxzm'),
    })],
    [t('s_a4vkn3'), check(form.imageFormats, {
      label: t('s_a4vkn3'), max: 120, pattern: formatPattern, patternMessage: t('s_1c9tz51'),
    })],
    [t('s_1hybard'), check(form.videoFormats, {
      label: t('s_1hybard'), max: 120, pattern: formatPattern, patternMessage: t('s_15k74t0'),
    })],
  ];
  for (const [, message] of checks) {
    if (message) {
      settingsError.value = message;
      toast(message, 'error');
      return;
    }
  }
  settingsSaving.value = true;
  try {
    const payload: JsonObject = {
      appTitleZh: form.brand.zh.trim(),
      appTitleEn: form.brand.en.trim(),
      announcement: form.announcement.trim(),
      announcementEnabled: form.announcementEnabled,
      categories: form.categories.split('\n').map((item) => item.trim()).filter(Boolean),
      canRevise: form.canRevise,
      imageCount: Number(form.imageCount) || 0,
      imageSizeMb: Number(form.imageSizeMb) || 0,
      videoCount: Number(form.videoCount) || 0,
      videoSizeMb: Number(form.videoSizeMb) || 0,
      avatarSizeMb: Number(form.avatarSizeMb) || 0,
      imageFormats: form.imageFormats.trim(),
      videoFormats: form.videoFormats.trim(),
    };
    for (const item of TEXT_LIMITS) payload[item.key] = numberField(item.key);

    const saved = await api.settings.save(payload);
    if (saved?.ok !== true) {
      settingsError.value = String(saved?.error || t('s_jibr3q'));
      toast(settingsError.value, 'error');
      return;
    }
    const settings = (saved.settings ?? {}) as JsonObject;
    // 保存成功后把新设置落回 bootstrap：本页与其它页面立刻用上新品牌、上限与分类。
    applyRuntimeBootstrap({ ...settings, user: session.user, loggedIn: session.loggedIn } as unknown as Bootstrap);
    fillForm(settings);
    toast(t('s_1qb27ho'), 'success');
  } catch (reason) {
    settingsError.value = reason instanceof Error ? reason.message : String(reason);
    toast(settingsError.value, 'error');
  } finally {
    settingsSaving.value = false;
  }
}

const canEditSettings = computed(() => session.user.can?.admin === true || session.role === 'admin');
</script>

<template>
  <header class="row" data-between="true">
    <h2>{{ t('s_cit5ds') }}</h2>
    <span v-if="panelBusy" class="pill">{{ t('s_1tp8nhc') }}</span>
  </header>

  <SegControl :model-value="tab" :items="TABS" :label="t('s_y9zw6u')" @update:model-value="changeTab" />

  <!-- ── 用户管理 ─────────────────────────────────────────────── -->
  <template v-if="tab === 'users'">
    <SkeletonBlock v-if="users.loading.value && users.data.value === undefined" :rows="3" />
    <StateBlock
      v-else-if="users.error.value && users.data.value === undefined"
      tone="error"
      :title="t('s_kvpltc')"
      :description="users.error.value.message"
      :action-label="t('s_lswd2v')"
      @action="loadUsers"
    />
    <template v-else>
      <div class="row" data-between="true">
        <span class="section-label">{{ t('s_1oim33') }}</span>
        <span class="pill">{{ `${userItems.length} 位用户` }}</span>
      </div>
      <div class="field">
        <label for="admin-user-search">{{ t('s_jdu9oa') }}</label>
        <input
          id="admin-user-search"
          class="input"
          type="search"
          autocomplete="off"
          :placeholder="t('s_1lwkw6n')"
          @input="onSearch(($event.target as HTMLInputElement).value)"
        />
      </div>
      <div class="notice">
        <strong>{{ t('s_7tczm7') }}</strong>
        <span>{{ t('s_1pdejtj') }}</span>
      </div>
      <div v-if="users.error.value" class="notice" data-tone="accent">
        <span>{{ users.error.value.message }}</span>
      </div>

      <StateBlock
        v-if="userItems.length === 0"
        :title="query ? `没有找到与“${query}”相关的用户` : t('s_7qwgro')"
      />
      <div v-else class="list" data-gap="sm" :data-busy="users.loading.value ? 'true' : undefined">
        <div v-for="user in userItems" :key="String(user.id)" class="card">
          <div class="row" data-gap="md">
            <AvatarBox :name="String(user.nickname || '')" />
            <span class="row-copy">
              <strong class="row-title">{{ `${user.nickname} · ${user.role}` }}</strong>
              <span class="row-meta">{{ `${user.status} · 最近登录 ${user.lastLoginTime || t('s_1lpnuh4')}` }}</span>
              <span class="row-meta truncate">{{ truncate(user.email, 40) }}</span>
              <span v-if="user.twoFactorEnabled === true" class="row-meta">{{ t('s_16q73v0') }}</span>
            </span>
            <StatusTag :text="String(user.status || '')" :tone="statusTone(String(user.status || ''))" />
          </div>
          <div class="row" data-gap="md">
            <button class="cta ghost" data-size="small" type="button" style="flex: 1 1 0" @click="manageUser(user)">
              {{ t('s_pzy8ri') }}
            </button>
            <button
              class="cta ghost"
              data-size="small"
              type="button"
              style="flex: 1 1 0"
              @click="router.push(`/user-public/${encodeURIComponent(String(user.nickname ?? ''))}`)"
            >
              {{ t('s_gt2gfg') }}
            </button>
          </div>
          <!-- 兜底出口：用户邮箱用不了（离职、邮箱被回收）时，只有管理员能帮他关掉两步验证 -->
          <button
            v-if="user.twoFactorEnabled === true"
            class="cta ghost"
            data-size="small"
            type="button"
            @click="disableTwoFactor(user)"
          >
            {{ t('s_p1k61') }}
          </button>
        </div>
      </div>
    </template>
  </template>

  <!-- ── 展会管理 ─────────────────────────────────────────────── -->
  <template v-else-if="tab === 'exhibitions'">
    <SkeletonBlock v-if="exhibitions.loading.value && exhibitions.data.value === undefined" :rows="3" />
    <StateBlock
      v-else-if="exhibitions.error.value && exhibitions.data.value === undefined"
      tone="error"
      :title="t('s_kvpltc')"
      :description="exhibitions.error.value.message"
      :action-label="t('s_lswd2v')"
      @action="loadExhibitions"
    />
    <template v-else>
      <div class="field">
        <label for="admin-exhibition-search">{{ t('s_50ih74') }}</label>
        <input
          id="admin-exhibition-search"
          class="input"
          type="search"
          autocomplete="off"
          :placeholder="t('s_1ttdxgu')"
          @input="onSearch(($event.target as HTMLInputElement).value)"
        />
      </div>
      <div class="row" data-between="true">
        <span class="section-label">{{ t('s_1h3z4vq') }}</span>
        <span class="pill">{{ `${exhibitionItems.length} 个展会` }}</span>
      </div>
      <div class="notice">
        <strong>{{ t('s_19eb37e') }}</strong>
        <span>{{ t('s_2scj6a') }}</span>
      </div>
      <div v-if="exhibitions.error.value" class="notice" data-tone="accent">
        <span>{{ exhibitions.error.value.message }}</span>
      </div>

      <StateBlock
        v-if="exhibitionItems.length === 0"
        icon="search"
        :title="query ? `没有找到与“${query}”相关的展会` : t('s_1qc01ta')"
        :description="query ? t('s_1kmur0r') : t('s_1tsjagr')"
      />
      <div v-else class="list" data-gap="sm" :data-busy="exhibitions.loading.value ? 'true' : undefined">
        <div v-for="item in exhibitionItems" :key="String(item.id)" class="card">
          <button
            class="row-card"
            type="button"
            data-pressable="true"
            style="border: 0; padding: 0; background: transparent"
            :aria-label="`查看 ${item.title} 详情`"
            @click="router.push(`/detail/${item.id}`)"
          >
            <MediaBox :src="String(item.imageUri || '')" class-name="thumb thumb-cover" :alt="String(item.title || '')" />
            <span class="row-copy">
              <strong class="row-title truncate">{{ item.title }}</strong>
              <span class="row-meta">{{ `${formatDateWithWeekday(item.date)} ${item.time}` }}</span>
              <span class="row-meta truncate">{{ item.venue }}</span>
              <span class="row-meta">{{ `${item.status} · ${item.registrationCount ?? 0} 条报名` }}</span>
            </span>
            <StatusTag :text="String(item.modeLabel || item.status || '')" :tone="statusTone(String(item.status || ''))" />
          </button>
          <div class="grid-cols-2">
            <button
              class="cta ghost"
              data-size="small"
              type="button"
              @click="router.push(`/review?exhibitionId=${encodeURIComponent(String(item.id))}`)"
            >
              {{ t('s_j8kyoz') }}
            </button>
            <button
              class="cta ghost"
              data-size="small"
              type="button"
              @click="router.push(`/exhibition-form/${String(item.id)}`)"
            >
              {{ t('s_eutzzb') }}
            </button>
            <button class="cta ghost" data-size="small" type="button" @click="toggleLock(item)">
              {{ item.openForRegistration === true ? t('s_2fmcqd') : t('s_1w55sta') }}
            </button>
          </div>
        </div>
      </div>

      <button class="cta ghost" type="button" :disabled="exhibitionItems.length === 0" @click="exportCsv">
        {{ t('s_1ogoh03') }}
      </button>
      <p class="field-hint text-center">{{ t('s_nsnwn6') }}</p>
    </template>
  </template>

  <!-- ── 服务器设置 ───────────────────────────────────────────── -->
  <template v-else>
    <SkeletonBlock v-if="settingsQuery.loading.value && !loaded" :rows="4" />
    <StateBlock
      v-else-if="settingsQuery.error.value && !loaded"
      tone="error"
      :title="t('s_kvpltc')"
      :description="settingsQuery.error.value.message"
      :action-label="t('s_lswd2v')"
      @action="loadSettings"
    />
    <template v-else>
      <div class="notice" data-tone="accent">
        <strong>{{ t('s_1l8hptt') }}</strong>
        <span>{{ t('s_3fdon3') }}</span>
      </div>

      <div class="card">
        <span class="section-label">{{ t('s_vxwprj') }}</span>
        <p class="field-hint">{{ t('s_l2amry') }}</p>
        <div class="field">
          <label for="settings-title-zh">{{ t('s_1sx8n02') }}</label>
          <input
            id="settings-title-zh"
            v-model="form.brand.zh"
            class="input"
            type="text"
            maxlength="20"
            :placeholder="t('s_1wed2to')"
          />
        </div>
        <div class="field">
          <label for="settings-title-en">{{ t('s_1lwq2zi') }}</label>
          <input
            id="settings-title-en"
            v-model="form.brand.en"
            class="input"
            type="text"
            maxlength="24"
            :placeholder="t('s_17xmsms')"
          />
          <p class="field-hint">{{ t('s_7sexex') }}</p>
        </div>
      </div>

      <div class="card">
        <span class="section-label">{{ t('s_1dao2v1') }}</span>
        <textarea id="settings-announcement" v-model="form.announcement" class="textarea" rows="3" />
        <div class="switch-row">
          <span class="switch-copy">
            <strong>{{ t('s_5rwrkf') }}</strong>
            <span class="row-meta">{{ t('s_1jh4uc4') }}</span>
          </span>
          <label class="switch" for="settings-announcement-enabled">
            <input id="settings-announcement-enabled" v-model="form.announcementEnabled" type="checkbox" />
            <span />
          </label>
        </div>
      </div>

      <div class="card">
        <span class="section-label">{{ t('s_1v7py1m') }}</span>
        <textarea id="settings-categories" v-model="form.categories" class="textarea" rows="4" />
        <p class="field-hint">{{ t('s_19brgqa') }}</p>
      </div>

      <div class="card">
        <span class="section-label">{{ t('s_1shj529') }}</span>
        <div class="switch-row">
          <span class="switch-copy">
            <strong>{{ t('s_11iu5s7') }}</strong>
            <span class="row-meta">{{ t('s_qt3xw0') }}</span>
          </span>
          <label class="switch" for="settings-revise">
            <input id="settings-revise" v-model="form.canRevise" type="checkbox" />
            <span />
          </label>
        </div>
      </div>

      <div class="card">
        <span class="section-label">{{ t('s_6w32w9') }}</span>
        <div class="field">
          <label for="settings-image-count">{{ t('s_s2a1jr') }}</label>
          <div class="row" data-gap="md">
            <input id="settings-image-count" v-model.number="form.imageCount" class="input" type="number" min="0" inputmode="numeric" />
            <span class="row-meta">{{ t('s_accfpb') }}</span>
          </div>
        </div>
        <div class="field">
          <label for="settings-image-size">{{ t('s_ixjm5p') }}</label>
          <div class="row" data-gap="md">
            <input id="settings-image-size" v-model.number="form.imageSizeMb" class="input" type="number" min="0" inputmode="numeric" />
            <span class="row-meta">MB</span>
          </div>
        </div>
        <div class="field">
          <label for="settings-video-count">{{ t('s_1wlt01z') }}</label>
          <div class="row" data-gap="md">
            <input id="settings-video-count" v-model.number="form.videoCount" class="input" type="number" min="0" inputmode="numeric" />
            <span class="row-meta">{{ t('s_d5a1x9') }}</span>
          </div>
        </div>
        <div class="field">
          <label for="settings-video-size">{{ t('s_1moomrn') }}</label>
          <div class="row" data-gap="md">
            <input id="settings-video-size" v-model.number="form.videoSizeMb" class="input" type="number" min="0" inputmode="numeric" />
            <span class="row-meta">MB</span>
          </div>
        </div>
        <p class="field-hint">{{ t('s_8cnkwa') }}</p>
      </div>

      <div class="card">
        <span class="section-label">{{ t('s_15f0vvs') }}</span>
        <div class="field">
          <label for="settings-image-formats">{{ t('s_kthke1') }}</label>
          <input
            id="settings-image-formats"
            v-model="form.imageFormats"
            class="input"
            type="text"
            maxlength="120"
            placeholder="jpg,jpeg,png,webp"
          />
          <p class="field-hint">{{ t('s_uwhq7a') }}</p>
        </div>
        <div class="field">
          <label for="settings-video-formats">{{ t('s_injt47') }}</label>
          <input
            id="settings-video-formats"
            v-model="form.videoFormats"
            class="input"
            type="text"
            maxlength="120"
            placeholder="mp4,mov,webm"
          />
          <p class="field-hint">{{ t('s_1ezkwzh') }}</p>
        </div>
        <div class="field">
          <label for="settings-avatar-size">{{ t('s_1y26ptk') }}</label>
          <div class="row" data-gap="md">
            <input id="settings-avatar-size" v-model.number="form.avatarSizeMb" class="input" type="number" min="0" inputmode="numeric" />
            <span class="row-meta">MB</span>
          </div>
        </div>
      </div>

      <div class="card">
        <span class="section-label">{{ t('s_rlbden') }}</span>
        <p class="field-hint">{{ t('s_dpoory') }}</p>
        <div v-for="(row, rowIndex) in limitRows" :key="rowIndex" class="grid-cols-2">
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
              <span class="row-meta">{{ item.hint }}</span>
            </div>
          </div>
        </div>
      </div>

      <p v-if="settingsError" class="field-error" role="alert">{{ settingsError }}</p>
      <p class="field-hint text-center">{{ t('s_2olj7t') }}</p>
      <button
        class="cta"
        type="button"
        :disabled="settingsSaving || !canEditSettings"
        :data-loading="settingsSaving ? 'true' : 'false'"
        @click="saveSettings"
      >
        {{ t('s_usxjfe') }}
      </button>
    </template>
  </template>
</template>
