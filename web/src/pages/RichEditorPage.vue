<script setup lang="ts">
/**
 * 屏幕 12 · 展会简介（Markdown 编辑）
 *
 * 保存的是 Markdown 源码，详情页按 Markdown 渲染；预览走 `@/services/markdown`
 * 的渲染入口（与详情页同一套清洗），不自行拼 HTML。
 * 图片与视频先由原生选择，再上传到服务器，正文只写服务器地址。
 */
import { computed, nextTick, onMounted, reactive, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { api } from '@/app/runtime';
import { useAsync } from '@/composables/useAsync';
import { useBootstrapStore } from '@/stores/bootstrap';
import { toast } from '@/services/toast';
import { openSheet } from '@/services/sheet';
import { allowedFormats, uploadCountLimit, uploadSizeLimitMb, uploadSizeError } from '@/services/validate';
import { device } from '@/services/device-services';
import { publishImportedMedia } from '@/services/publish-media';
import { htmlToMarkdown, loadHtmlConverter, loadMarkdownParser, markdownToHtml, plainText } from '@/services/markdown';
import { patchExhibitionDraft, readExhibitionDraft } from '@/services/exhibition-draft';
import AppIcon from '@/components/AppIcon.vue';
import PasteTextPanel from '@/components/PasteTextPanel.vue';
import StateBlock from '@/components/StateBlock.vue';
import SkeletonBlock from '@/components/SkeletonBlock.vue';
import type { ExhibitionDetail, JsonObject } from '@/api/types';
import { t } from '@/i18n';

interface MediaTile {
  kind: 'image' | 'video';
  url: string;
}

const route = useRoute();
const router = useRouter();
const bootstrap = useBootstrapStore();
const query = useAsync<ExhibitionDetail>();

/** 已有展会走 `?id=`。新建还没有 id 时走 `?draft=1`，正文先记在内存稿里。 */
const exhibitionId = computed(() => String(route.params.id ?? route.query.id ?? ''));
const draftMode = computed(() => !exhibitionId.value && String(route.query.draft ?? '') === '1');
const exhibition = computed<JsonObject>(() => (query.data.value?.exhibition ?? {}) as JsonObject);
const notFound = computed(() => (draftMode.value
  ? readExhibitionDraft() == null
  : !exhibitionId.value || query.data.value?.found === false));
const loadFailed = computed(() => query.error.value !== undefined && query.data.value === undefined);

const content = ref('');
const saving = ref(false);
const showPreview = ref(false);
const editor = ref<HTMLTextAreaElement>();
/** 内容只从取回的详情写一次，之后预览 / 打字都不再被覆盖。 */
const seeded = ref(false);
const canSave = computed(() => seeded.value && !query.loading.value && !loadFailed.value
  && !notFound.value && (draftMode.value || Boolean(exhibition.value.id)));
const previewLabel = t('s_k2jp4x');
const continueLabel = t('s_ajd5o');

const previewHtml = computed(() => markdownToHtml(content.value));

/** 行数与词数：编辑区下方的状态行，与旧版编辑器的 status 栏等价。 */
const stats = computed(() => {
  const text = content.value;
  const lines = text === '' ? 0 : text.split(/\r?\n/).length;
  const words = text.trim() === '' ? 0 : text.trim().split(/\s+/).length;
  return `${lines} 行 · ${words} 词`;
});

/**
 * 正文里已经插入的媒体：媒体网格只负责「看有哪些、能删掉」，
 * 删除时同时把对应的 Markdown / video 标签从正文里移除。
 */
const media = computed<MediaTile[]>(() => {
  const list: MediaTile[] = [];
  for (const match of content.value.matchAll(/!\[[^\]]*]\(([^)\s]+)\)/g)) {
    if (match[1]) list.push({ kind: 'image', url: match[1] });
  }
  for (const match of content.value.matchAll(/<video\b[^>]*src="([^"]+)"/gi)) {
    if (match[1]) list.push({ kind: 'video', url: match[1] });
  }
  return list;
});

/** 媒体限制说明：数量与大小上限都来自「管理-设置」。 */
const mediaHint = computed(() => {
  const imageCount = Number(bootstrap.media.imageCount) || 8;
  const imageSize = Number(bootstrap.media.imageSizeMb) || 10;
  return `媒体数量与大小受服务器设置限制：图片 ${imageCount} 张 / 单张 ${imageSize} MB，`
    + `视频 ${uploadCountLimit('video')} 个 / 单个不超过 ${uploadSizeLimitMb('video')} MB；${t('s_vkgi23')}`;
});

// ── 取数 ─────────────────────────────────────────────────────────

/** 历史 HTML 在编辑时转成 Markdown，保留链接、格式与媒体。 */
function initialContent(item: JsonObject): string {
  const raw = String(item.description ?? '');
  return item.descriptionFormat === 'html' ? htmlToMarkdown(raw) : raw;
}

async function load(): Promise<void> {
  if (draftMode.value) {
    const draft = readExhibitionDraft();
    if (!draft || seeded.value) return;
    await query.run(async () => {
      await loadMarkdownParser();
      return {
        found: true,
        exhibition: {
          id: '',
          title: draft.title,
          description: draft.description,
          descriptionFormat: 'md',
        },
      };
    });
    if (seeded.value || !query.data.value) return;
    content.value = draft.description;
    seeded.value = true;
    return;
  }
  if (!exhibitionId.value) {
    return;
  }
  const data = await query.run(async () => {
    const detail = await api.exhibitions.get(exhibitionId.value);
    if (detail.found === false) return detail;
    await loadMarkdownParser();
    if (detail.exhibition?.descriptionFormat === 'html') await loadHtmlConverter();
    return detail;
  });
  if (!data || data.found === false || seeded.value) return;
  content.value = initialContent((data.exhibition ?? {}) as JsonObject);
  seeded.value = true;
}

onMounted(() => { void load(); });

// ── 编辑区与工具条 ───────────────────────────────────────────────

/** 记录光标位置：点工具条会让输入框失焦，插入前必须知道插在哪里。 */
let cursorStart = 0;
let cursorEnd = 0;

function rememberSelection(): void {
  const node = editor.value;
  if (!node) return;
  cursorStart = node.selectionStart ?? 0;
  cursorEnd = node.selectionEnd ?? 0;
}

function focusEditor(): void {
  void nextTick(() => editor.value?.focus());
}

/**
 * 在光标处替换 / 插入文本。
 * 有选中内容就包住它，没有就插入占位文本并把它选起来，便于直接改写。
 */
function surround(prefix: string, suffix: string, placeholder: string): void {
  const text = content.value;
  const start = Math.min(cursorStart, text.length);
  const end = Math.min(Math.max(cursorEnd, start), text.length);
  const selected = text.slice(start, end);
  const body = selected || placeholder;
  content.value = `${text.slice(0, start)}${prefix}${body}${suffix}${text.slice(end)}`;
  const bodyStart = start + prefix.length;
  cursorStart = bodyStart;
  cursorEnd = bodyStart + body.length;
  focusEditor();
  void nextTick(() => {
    editor.value?.setSelectionRange(cursorStart, cursorEnd);
  });
}

/** 行首前缀（标题、引用、清单）：作用于光标所在的那一行。 */
function prefixLine(prefix: string): void {
  const text = content.value;
  const start = Math.min(cursorStart, text.length);
  const lineStart = text.lastIndexOf('\n', Math.max(0, start - 1)) + 1;
  content.value = `${text.slice(0, lineStart)}${prefix}${text.slice(lineStart)}`;
  cursorStart = lineStart + prefix.length;
  cursorEnd = cursorStart;
  focusEditor();
}

function appendText(text: string): void {
  content.value = `${content.value.trimEnd()}${text}`;
}

function formatBytes(bytes: unknown): string {
  const value = Number(bytes) || 0;
  if (value >= 1024 * 1024) return `${(value / 1024 / 1024).toFixed(1)} MB`;
  if (value >= 1024) return `${Math.round(value / 1024)} KB`;
  return `${value} B`;
}

// ── 媒体 ─────────────────────────────────────────────────────────

/** 允许的格式：服务器没配就回落到「常见」，错误提示里因此始终有下一步可走。 */
function formatsHint(kind: 'image' | 'video'): string {
  const formats = allowedFormats(kind);
  return formats.length > 0 ? formats.map((item) => `.${item}`).join('/') : t('s_1ylglbm');
}

/** 插入图片：设备选完后上传，正文只留下服务器地址。 */
async function insertImage(): Promise<void> {
  const max = Number(bootstrap.media.imageCount) || 8;
  const current = media.value.filter((item) => item.kind === 'image').length;
  if (current >= max) {
    toast(`图片数量已达上限（${max} 张）`, 'error');
    return;
  }
  try {
    const result = await device.importMedia('image');
    if (!result?.url) {
      toast(t('s_1dc9o49'), 'error');
      return;
    }
    const url = await publishImportedMedia('image', result);
    appendText(`\n\n![展会图片](${url})\n\n`);
    const size = formatBytes(result.bytes);
    toast(result.compressed ? `图片已压缩为 ${size} 并插入` : `图片已插入（${size}）`, 'success');
  } catch (reason) {
    if (isCancelled(reason)) return;
    toast(reason instanceof Error ? reason.message : `请选择 ${formatsHint('image')} 格式的图片`, 'error');
  }
}

/** 插入视频：与图片同一条路，区别只在写进正文的形式（详情页白名单允许 `<video>`）。 */
async function insertVideo(): Promise<void> {
  const max = uploadCountLimit('video');
  const current = media.value.filter((item) => item.kind === 'video').length;
  if (current >= max) {
    toast(`视频数量已达上限（${max} 个）`, 'error');
    return;
  }
  try {
    const result = await device.importMedia('video');
    if (!result?.url) {
      toast(t('s_s0oos7'), 'error');
      return;
    }
    // 视频不像图片那样会被原生压缩：超过服务器设置的上限时不要上传。
    const oversized = uploadSizeError('video', result.bytes);
    if (oversized) {
      if (result.fileName) void device.discardMedia(result.fileName).catch(() => undefined);
      toast(oversized, 'error');
      return;
    }
    const url = await publishImportedMedia('video', result);
    appendText(`\n\n<video controls src="${url}"></video>\n\n`);
    toast(`视频已插入（${formatBytes(result.bytes)}）`, 'success');
  } catch (reason) {
    if (isCancelled(reason)) return;
    toast(reason instanceof Error ? reason.message : `请选择 ${formatsHint('video')} 格式的视频`, 'error');
  }
}

/** 删除媒体：从正文里摘掉这条引用，网格随之少一格。 */
function removeMedia(tile: MediaTile): void {
  const url = escapeRegExp(tile.url);
  content.value = tile.kind === 'image'
    ? content.value.replace(new RegExp(`!\\[[^\\]]*\\]\\(${url}\\)`, 'g'), '')
    : content.value.replace(new RegExp(`<video\\b[^>]*src="${url}"[^>]*></video>`, 'gi'), '');
}

// ── 粘贴 / 清空 / 保存 ───────────────────────────────────────────

/**
 * 直接粘贴 Markdown：共享底部面板承载输入框（`PasteTextPanel`），按钮仍由面板服务管。
 *
 * 不读系统剪贴板 —— WebView 读剪贴板需要额外权限与安全上下文，长按粘贴才是可靠路径。
 */
const paste = reactive({ text: '' });

function openPasteSheet(): void {
  paste.text = '';
  openSheet({
    title: t('s_7zi2sm'),
    component: PasteTextPanel,
    props: {
      model: paste,
      hint: t('s_wo4aqm'),
    },
    actions: [
      { label: t('s_1589w37'), onClick: (close) => close() },
      { label: t('s_booftk'), onClick: (close) => { applyPaste(false); close(); } },
      { label: t('s_ekbz2c'), variant: 'primary', onClick: (close) => { applyPaste(true); close(); } },
    ],
  });
}

function applyPaste(replaceAll: boolean): void {
  const value = paste.text.trim();
  if (!value) {
    toast(t('s_ijdxmv'), 'error');
    return;
  }
  const current = content.value;
  content.value = replaceAll || !current.trim() ? value : `${current.trimEnd()}\n\n${value}`;
  toast(replaceAll ? t('s_17pstxc') : t('s_1oas91y'), 'success');
}

function clearAll(): void {
  if (!content.value.trim()) return;
  openSheet({
    title: t('s_kjpxv'),
    message: t('s_1kokqyk'),
    actions: [
      { label: t('s_1589w37'), onClick: (close) => close() },
      {
        label: t('s_9mbwb2'),
        variant: 'primary',
        onClick: (close) => {
          content.value = '';
          close();
          toast(t('s_lp789j'));
        },
      },
    ],
  });
}

async function save(): Promise<void> {
  if (saving.value || !canSave.value) return;
  const markdown = content.value.trim();
  if (draftMode.value) {
    saving.value = true;
    try {
      patchExhibitionDraft(markdown);
      const summary = plainText(markdownToHtml(markdown), 20);
      toast(markdown ? `简介已保存（${summary}）` : t('s_1lylgf9'), 'success');
      await router.back();
    } finally {
      saving.value = false;
    }
    return;
  }
  saving.value = true;
  try {
    // 只改简介：其余字段原样回传，避免把详情页里没有的字段清空。
    const result = await api.exhibitions.save({
      id: String(exhibition.value.id ?? exhibitionId.value),
      title: exhibition.value.title,
      venue: exhibition.value.venue,
      time: exhibition.value.time,
      status: exhibition.value.status,
      category: exhibition.value.category,
      date: exhibition.value.date,
      description: markdown,
      descriptionFormat: 'md',
      registrationStart: exhibition.value.registrationStart,
      registrationEnd: exhibition.value.registrationEnd,
      qrEnabled: exhibition.value.qrEnabled,
      imageUri: exhibition.value.imageUri,
      fields: query.data.value?.fields ?? [],
    });
    if (result?.ok !== true) {
      toast(String(result?.error || t('s_1q9u8le')), 'error');
      return;
    }
    const summary = plainText(markdownToHtml(markdown), 20);
    toast(markdown ? `简介已保存（${summary}）` : t('s_1lylgf9'), 'success');
    await router.replace(`/exhibition-form/${encodeURIComponent(String(exhibition.value.id ?? exhibitionId.value))}`);
  } catch (reason) {
    toast(reason instanceof Error ? reason.message : String(reason), 'error');
  } finally {
    saving.value = false;
  }
}

function isCancelled(reason: unknown): boolean {
  return Boolean(reason && typeof reason === 'object' && (reason as { code?: unknown }).code === 'cancelled');
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
</script>

<template>
  <SkeletonBlock v-if="query.loading.value && !query.data.value" :rows="4" />

  <StateBlock
    v-else-if="loadFailed"
    tone="error"
    :title="t('s_kvpltc')"
    :description="query.error.value?.message"
    :action-label="t('s_lswd2v')"
    @action="load"
  />

  <StateBlock
    v-else-if="notFound"
    tone="error"
    :title="t('s_1vim1qp')"
    :description="String(query.data.value?.error || t('s_1q6xpub'))"
    :action-label="t('s_dn4ida')"
    @action="router.replace('/exhibitor')"
  />

  <template v-else>
    <div class="card" data-tone="fill">
      <strong>{{ exhibition.title || t('s_p9fllo') }}</strong>
    </div>

    <!-- 工具条只留格式。预览和粘贴在编辑区下方，避免同一颗粘贴出现两次。 -->
    <div class="toolbar" role="toolbar" :aria-label="t('s_28v8q')">
      <button type="button" :aria-pressed="false" :title="t('s_4okt0a')" @click="prefixLine('## ')">H2</button>
      <button type="button" :aria-pressed="false" :title="t('s_1e57pa0')" @click="surround('**', '**', '文本')">
        <strong>B</strong>
      </button>
      <button type="button" :aria-pressed="false" :title="t('s_69k40o')" @click="surround('*', '*', '文本')">
        <em>I</em>
      </button>
      <button type="button" :aria-pressed="false" :title="t('s_1wogqko')" @click="prefixLine('> ')">&gt;</button>
      <button type="button" :aria-pressed="false" :title="t('s_z3ic32')" @click="prefixLine('- ')">•</button>
      <button type="button" :aria-pressed="false" :title="t('s_1l65wvf')" @click="prefixLine('1. ')">1.</button>
      <button type="button" :aria-pressed="false" :title="t('s_1gqx0u5')" @click="surround('[', '](https://)', '链接文字')">
        <AppIcon name="share" size="icon icon-sm" />
      </button>
      <button type="button" :aria-pressed="false" :title="t('s_1w5fs53')" @click="insertImage">
        <AppIcon name="image" size="icon icon-sm" />
      </button>
      <button type="button" :aria-pressed="false" :title="t('s_1aj4gvd')" @click="insertVideo">
        <AppIcon name="video" size="icon icon-sm" />
      </button>
      <button type="button" :aria-pressed="false" :title="t('s_1kll7do')" @click="appendText(t('s_spr4u2'))">
        <AppIcon name="list" size="icon icon-sm" />
      </button>
      <button type="button" :aria-pressed="false" :title="t('s_14ggq2g')" @click="clearAll">
        <AppIcon name="trash" size="icon icon-sm" />
      </button>
    </div>

    <!-- 编辑区：预览打开时就地换成渲染结果，避免编辑区与预览两套内容并存 -->
    <div v-if="showPreview" class="editor-surface rich-content" v-html="previewHtml" />
    <textarea
      v-else
      ref="editor"
      v-model="content"
      class="textarea editor-surface"
      rows="12"
      :placeholder="t('s_1jvhwb1')"
      @blur="rememberSelection"
      @select="rememberSelection"
      @click="rememberSelection"
      @keyup="rememberSelection"
    />

    <div class="row" data-between="true">
      <span class="field-hint">{{ stats }}</span>
      <span class="field-hint">{{ showPreview ? t('s_k2jp4x') : t('s_1jvhwb1') }}</span>
    </div>

    <!-- 这一行只放预览和粘贴。插入图片、插入视频留在上面的工具条。 -->
    <div class="action-row">
      <button
        class="cta"
        :class="{ ghost: !showPreview }"
        data-size="small"
        type="button"
        :aria-pressed="showPreview ? 'true' : 'false'"
        :title="showPreview ? continueLabel : previewLabel"
        @click="showPreview = !showPreview"
      >
        {{ showPreview ? continueLabel : previewLabel }}
      </button>
      <button class="cta ghost" data-size="small" type="button" @click="openPasteSheet">
        <AppIcon name="edit" size="icon icon-sm" />
        {{ t('s_7zi2sm') }}
      </button>
    </div>
    <p class="field-hint">{{ mediaHint }}</p>

    <!-- 媒体网格：正文里已有的图片与视频，逐格可删 -->
    <div class="stack" data-gap="sm">
      <div class="row" data-between="true">
        <span class="section-label">{{ t('s_1w5fs53') }}</span>
        <span v-if="media.length > 0" class="pill">{{ `${media.length} 项` }}</span>
      </div>
      <p v-if="media.length === 0" class="field-hint">{{ t('s_12ibypn') }}</p>
      <div v-else class="media-grid">
        <div v-for="tile in media" :key="tile.url" class="media-tile">
          <img v-if="tile.kind === 'image'" :src="tile.url" :alt="t('s_1w5fs53')" @error="removeMedia(tile)" />
          <!-- 视频用同一套槽位：`.media-tile img` 的铺满规则同样适用于 video -->
          <video v-else :src="tile.url" muted playsinline preload="metadata" @error="removeMedia(tile)" />
          <button type="button" :aria-label="t('s_14ggq2g')" @click="removeMedia(tile)">×</button>
        </div>
      </div>
    </div>
  </template>

  <!-- 底部固定保存区 -->
  <Teleport v-if="!loadFailed && !notFound" defer to="#app-foot">
    <div class="page-foot">
      <div class="stack" data-gap="sm">
        <button class="cta" type="button" :disabled="saving || !canSave" :data-loading="saving ? 'true' : 'false'" @click="save">
          {{ t('s_1kqdxz5') }}
        </button>
        <p class="field-hint text-center">{{ t('s_4l0yq7') }}</p>
      </div>
    </div>
  </Teleport>
</template>
