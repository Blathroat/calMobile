<script setup lang="ts">
/**
 * 屏幕 12 · 展会简介（Markdown 编辑）
 *
 * 保存的是 Markdown 源码，详情页按 Markdown 渲染；预览走 `@/services/markdown`
 * 的渲染入口（与详情页同一套清洗），不自行拼 HTML。
 * 图片与视频先由原生选择，再上传到服务器，正文只写服务器地址。
 * 编辑已有展会且从表单带 `?draft=1` 进来时，先用内存稿里的正文起稿
 * （表单里刚写、还没保存的纯文本简介），保存成功后把最新正文写回草稿并带回表单：
 * 表单靠它恢复其他还没保存的字段，也不清掉草稿。
 */
import { computed, nextTick, onMounted, reactive, ref } from 'vue';
import { onBeforeRouteLeave, useRoute, useRouter } from 'vue-router';
import { api } from '@/app/runtime';
import { useAsync } from '@/composables/useAsync';
import { useBootstrapStore } from '@/stores/bootstrap';
import { toast } from '@/services/toast';
import { openSheet } from '@/services/sheet';
import { allowedFormats, uploadCountLimit, uploadSizeLimitMb, uploadSizeError } from '@/services/validate';
import { device } from '@/services/device-services';
import { publishImportedMedia } from '@/services/publish-media';
import { htmlToMarkdown, loadHtmlConverter, loadMarkdownParser, markdownToHtml, plainText } from '@/services/markdown';
import { clearExhibitionDraft, patchExhibitionDraft, readExhibitionDraft } from '@/services/exhibition-draft';
import AppIcon from '@/components/AppIcon.vue';
import UploadProgressMask from '@/components/upload-progress-mask.vue';
import PasteTextPanel from '@/components/PasteTextPanel.vue';
import StateBlock from '@/components/StateBlock.vue';
import SkeletonBlock from '@/components/SkeletonBlock.vue';
import type { ExhibitionDetail, JsonObject } from '@/api/types';
import { t } from '@/i18n';

interface MediaTile {
  kind: 'image' | 'video';
  url: string;
}

/**
 * 正在上传的媒体占位：上传期间在媒体网格里显示本地预览 / 文件名 + 进度遮罩，
 * 成功后把地址换成服务器地址、遮罩满 100 停留结束才移除占位（正文那时已有服务器地址）。
 */
interface PendingMedia {
  /** 区分先后两次上传：回调只改自己那一份占位。 */
  id: number;
  kind: 'image' | 'video';
  /** 图片先放本地地址预览；上传成功后换成服务器地址。 */
  url: string;
  fileName: string;
  progress: number;
}

const route = useRoute();
const router = useRouter();
const bootstrap = useBootstrapStore();
const query = useAsync<ExhibitionDetail>();

/** 已有展会走 `?id=`。新建还没有 id 时走 `?draft=1`，正文先记在内存稿里。 */
const exhibitionId = computed(() => String(route.params.id ?? route.query.id ?? ''));
const draftMode = computed(() => !exhibitionId.value && String(route.query.draft ?? '') === '1');
const exhibition = computed<JsonObject>(() => (query.data.value?.exhibition ?? {}) as JsonObject);
const notFound = computed(() =>
  draftMode.value ? readExhibitionDraft() === null : !exhibitionId.value || query.data.value?.found === false,
);
const loadFailed = computed(() => query.error.value !== undefined && query.data.value === undefined);

const content = ref('');
const saving = ref(false);
const showPreview = ref(false);
const editor = ref<HTMLTextAreaElement>();
/** 内容只从取回的详情写一次，之后预览 / 打字都不再被覆盖。 */
const seeded = ref(false);
const canSave = computed(
  () =>
    seeded.value &&
    !query.loading.value &&
    !loadFailed.value &&
    !notFound.value &&
    (draftMode.value || Boolean(exhibition.value.id)),
);
const previewLabel = t('exhibition.editor.preview');
const continueLabel = t('exhibition.editor.continueEditing');

const previewHtml = computed(() => markdownToHtml(content.value));

/** 行数与词数：编辑区下方的状态行，与旧版编辑器的 status 栏等价。 */
const stats = computed(() => {
  const text = content.value;
  const lines = text === '' ? 0 : text.split(/\r?\n/).length;
  const words = text.trim() === '' ? 0 : text.trim().split(/\s+/).length;
  return t('exhibition.editor.stats', { lines, words });
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

/** 正在上传的媒体占位；同一时间只跑一份，工具条按钮在上传期间禁用。 */
const pendingMedia = ref<PendingMedia | null>(null);
/** 自增 id：进度回调与成功回填只在占位没被换掉时生效。 */
let pendingSeq = 0;

/** 网格里显示正文媒体，但占位已经换成服务器地址的那一格先藏起来，避免同一张图出现两格。 */
const visibleMedia = computed(() => {
  const pendingUrl = pendingMedia.value?.url;
  if (!pendingUrl) return media.value;
  return media.value.filter((item) => item.url !== pendingUrl);
});

/** 遮罩在 100% 上停留结束：移除占位，正文里那一格由 media 自己画出来。 */
function clearPendingMedia(): void {
  pendingMedia.value = null;
}

/** 媒体限制说明：数量与大小上限都来自「管理-设置」。 */
const mediaHint = computed(() => {
  const imageCount = Number(bootstrap.media.imageCount) || 8;
  const imageSize = Number(bootstrap.media.imageSizeMb) || 10;
  return t('exhibition.editor.mediaHint', {
    imageCount,
    imageSize,
    videoCount: uploadCountLimit('video'),
    videoSize: uploadSizeLimitMb('video'),
    shortUrl: t('exhibition.editor.mediaUsesShortUrl'),
  });
});

// ── 取数 ─────────────────────────────────────────────────────────

/** 历史 HTML 在编辑时转成 Markdown，保留链接、格式与媒体。 */
function initialContent(item: JsonObject): string {
  const raw = String(item.description ?? '');
  return item.descriptionFormat === 'html' ? htmlToMarkdown(raw) : raw;
}

/**
 * 表单点「使用Markdown编辑简介」时带过来的内存稿正文。
 * 只在编辑已有展会、且草稿记的正是这场展会时采用，避免串到别的展会。
 */
function pendingDraftContent(): string | undefined {
  if (String(route.query.draft ?? '') !== '1') return undefined;
  const draft = readExhibitionDraft();
  return draft && draft.id === exhibitionId.value ? draft.description : undefined;
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
  content.value = pendingDraftContent() ?? initialContent((data.exhibition ?? {}) as JsonObject);
  seeded.value = true;
}

onMounted(() => {
  void load();
});

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
  return formats.length > 0 ? formats.map((item) => `.${item}`).join('/') : t('exhibition.editor.commonFormats');
}

/** 插入图片：设备选完后在网格里先放本地预览，上传期间盖进度遮罩，成功后换成服务器地址。 */
async function insertImage(): Promise<void> {
  if (pendingMedia.value) return;
  const max = Number(bootstrap.media.imageCount) || 8;
  const current = media.value.filter((item) => item.kind === 'image').length;
  if (current >= max) {
    toast(t('exhibition.editor.imageLimitReached', { max }), 'error');
    return;
  }
  try {
    const result = await device.importMedia('image');
    if (!result?.url) {
      toast(t('admin.media.unreadableImage'), 'error');
      return;
    }
    const id = ++pendingSeq;
    pendingMedia.value = { id, kind: 'image', url: result.url, fileName: String(result.fileName ?? ''), progress: 0 };
    const url = await publishImportedMedia('image', result, (percent) => {
      const pending = pendingMedia.value;
      if (!pending || pending.id !== id) return;
      // 字节发完只到 99：服务器确认（返回地址）后才落 100。
      pending.progress = Math.min(99, Math.max(0, percent));
    });
    appendText(`\n\n![${t('exhibition.editor.imageAlt')}](${url})\n\n`);
    const pending = pendingMedia.value;
    if (pending && pending.id === id) {
      // 占位换成服务器地址；本地 object URL 已由 publish-media 收回。
      pending.url = url;
      pending.progress = 100;
    }
    const size = formatBytes(result.bytes);
    toast(
      result.compressed
        ? t('exhibition.editor.imageInsertedCompressed', { size })
        : t('exhibition.editor.imageInserted', { size }),
      'success',
    );
  } catch (reason) {
    pendingMedia.value = null;
    if (isCancelled(reason)) return;
    toast(
      reason instanceof Error
        ? reason.message
        : t('exhibition.editor.imageFormatHint', { formats: formatsHint('image') }),
      'error',
    );
  }
}

/** 插入视频：与图片同一条路，占位只显示文件名（不预览视频），成功后换成服务器地址。 */
async function insertVideo(): Promise<void> {
  if (pendingMedia.value) return;
  const max = uploadCountLimit('video');
  const current = media.value.filter((item) => item.kind === 'video').length;
  if (current >= max) {
    toast(t('exhibition.editor.videoLimitReached', { max }), 'error');
    return;
  }
  try {
    const result = await device.importMedia('video');
    if (!result?.url) {
      toast(t('exhibition.editor.videoUnreadable'), 'error');
      return;
    }
    // 视频不像图片那样会被原生压缩：超过服务器设置的上限时不要上传。
    const oversized = uploadSizeError('video', result.bytes);
    if (oversized) {
      if (result.fileName) void device.discardMedia(result.fileName).catch(() => undefined);
      toast(oversized, 'error');
      return;
    }
    const id = ++pendingSeq;
    pendingMedia.value = { id, kind: 'video', url: '', fileName: String(result.fileName ?? ''), progress: 0 };
    const url = await publishImportedMedia('video', result, (percent) => {
      const pending = pendingMedia.value;
      if (!pending || pending.id !== id) return;
      pending.progress = Math.min(99, Math.max(0, percent));
    });
    appendText(`\n\n<video controls src="${url}"></video>\n\n`);
    const pending = pendingMedia.value;
    if (pending && pending.id === id) {
      pending.url = url;
      pending.progress = 100;
    }
    toast(t('exhibition.editor.videoInserted', { size: formatBytes(result.bytes) }), 'success');
  } catch (reason) {
    pendingMedia.value = null;
    if (isCancelled(reason)) return;
    toast(
      reason instanceof Error
        ? reason.message
        : t('exhibition.editor.videoFormatHint', { formats: formatsHint('video') }),
      'error',
    );
  }
}

/** 删除媒体：从正文里摘掉这条引用，网格随之少一格。 */
function removeMedia(tile: MediaTile): void {
  const url = escapeRegExp(tile.url);
  content.value =
    tile.kind === 'image'
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
    title: t('exhibition.editor.pasteMarkdown'),
    component: PasteTextPanel,
    props: {
      model: paste,
      hint: t('exhibition.editor.pasteOrAppend'),
    },
    actions: [
      { label: t('common.cancel'), onClick: (close) => close() },
      {
        label: t('exhibition.editor.append'),
        onClick: (close) => {
          applyPaste(false);
          close();
        },
      },
      {
        label: t('exhibition.editor.replace'),
        variant: 'primary',
        onClick: (close) => {
          applyPaste(true);
          close();
        },
      },
    ],
  });
}

function applyPaste(replaceAll: boolean): void {
  const value = paste.text.trim();
  if (!value) {
    toast(t('exhibition.editor.pasteEmpty'), 'error');
    return;
  }
  const current = content.value;
  content.value = replaceAll || !current.trim() ? value : `${current.trimEnd()}\n\n${value}`;
  toast(replaceAll ? t('exhibition.editor.pasteReplaced') : t('exhibition.editor.pasteAppended'), 'success');
}

function clearAll(): void {
  if (!content.value.trim()) return;
  openSheet({
    title: t('exhibition.editor.clearDescription'),
    message: t('exhibition.editor.clearKeepsPublished'),
    actions: [
      { label: t('common.cancel'), onClick: (close) => close() },
      {
        label: t('exhibition.editor.clear'),
        variant: 'primary',
        onClick: (close) => {
          content.value = '';
          close();
          toast(t('exhibition.editor.cleared'));
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
      toast(
        markdown ? t('exhibition.editor.descriptionSaved', { summary }) : t('exhibition.editor.descriptionCleared'),
        'success',
      );
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
      status: exhibition.value.statusCode,
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
      toast(String(result?.error || t('exhibition.form.saveFailed')), 'error');
      return;
    }
    const summary = plainText(markdownToHtml(markdown), 20);
    toast(
      markdown ? t('exhibition.editor.descriptionSaved', { summary }) : t('exhibition.editor.descriptionCleared'),
      'success',
    );
    // 正文已经落库，但草稿不能清：表单里其他字段可能还是未保存的修改，
    // 把最新简介写回草稿，表单返回后用草稿恢复，那些内容才不会丢。
    patchExhibitionDraft(markdown);
    await router.replace(`/exhibition-form/${encodeURIComponent(String(exhibition.value.id ?? exhibitionId.value))}`);
  } catch (reason) {
    toast(reason instanceof Error ? reason.message : String(reason), 'error');
  } finally {
    saving.value = false;
  }
}

/** 目标是展会编辑表单（新建 `/exhibition-form`，编辑 `/exhibition-form/:id`）。 */
function isExhibitionFormPath(path: string): boolean {
  return path === '/exhibition-form' || path.startsWith('/exhibition-form/');
}

/**
 * 内存稿是表单那一份草稿：只有回到编辑表单时才留着 —— 保存简介后表单要用它恢复
 * 其他还没保存的字段；去别处说明这次编辑流程已经结束，顺手清掉，避免陈旧稿串到下一次。
 */
onBeforeRouteLeave((to) => {
  if (isExhibitionFormPath(to.path)) return;
  clearExhibitionDraft();
});

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
    :title="t('common.loadFailed')"
    :description="query.error.value?.message"
    :action-label="t('common.retry')"
    @action="load"
  />

  <StateBlock
    v-else-if="notFound"
    tone="error"
    :title="t('exhibition.detail.notFound')"
    :description="String(query.data.value?.error || t('exhibition.editor.loadDescriptionFailed'))"
    :action-label="t('exhibition.form.backToExhibitor')"
    @action="router.replace('/exhibitor')"
  />

  <template v-else>
    <!-- 页面顶部由外壳顶栏负责，不再重复一张展会标题卡；工具条只留格式。
         预览和粘贴在编辑区下方，避免同一颗粘贴出现两次。 -->
    <div class="toolbar" role="toolbar" :aria-label="t('exhibition.editor.title')">
      <button type="button" :aria-pressed="false" :title="t('exhibition.editor.heading')" @click="prefixLine('## ')">
        H2
      </button>
      <button
        type="button"
        :aria-pressed="false"
        :title="t('exhibition.editor.bold')"
        @click="surround('**', '**', t('exhibition.editor.textPlaceholder'))"
      >
        <strong>B</strong>
      </button>
      <button
        type="button"
        :aria-pressed="false"
        :title="t('exhibition.editor.italic')"
        @click="surround('*', '*', t('exhibition.editor.textPlaceholder'))"
      >
        <em>I</em>
      </button>
      <button type="button" :aria-pressed="false" :title="t('exhibition.editor.quote')" @click="prefixLine('> ')">
        &gt;
      </button>
      <button type="button" :aria-pressed="false" :title="t('exhibition.editor.bulletList')" @click="prefixLine('- ')">
        •
      </button>
      <button
        type="button"
        :aria-pressed="false"
        :title="t('exhibition.editor.numberedList')"
        @click="prefixLine('1. ')"
      >
        1.
      </button>
      <button
        type="button"
        :aria-pressed="false"
        :title="t('exhibition.editor.link')"
        @click="surround('[', '](https://)', t('exhibition.editor.linkPlaceholder'))"
      >
        <AppIcon name="share" size="icon icon-sm" />
      </button>
      <button
        type="button"
        :aria-pressed="false"
        :title="t('exhibition.editor.insertImage')"
        :disabled="pendingMedia !== null"
        @click="insertImage"
      >
        <AppIcon name="image" size="icon icon-sm" />
      </button>
      <button
        type="button"
        :aria-pressed="false"
        :title="t('exhibition.editor.insertVideo')"
        :disabled="pendingMedia !== null"
        @click="insertVideo"
      >
        <AppIcon name="video" size="icon icon-sm" />
      </button>
      <button
        type="button"
        :aria-pressed="false"
        :title="t('exhibition.editor.table')"
        @click="appendText(t('exhibition.editor.tableTemplate'))"
      >
        <AppIcon name="list" size="icon icon-sm" />
      </button>
      <button type="button" :aria-pressed="false" :title="t('exhibition.editor.clearContent')" @click="clearAll">
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
      :placeholder="t('exhibition.editor.placeholder')"
      @blur="rememberSelection"
      @select="rememberSelection"
      @click="rememberSelection"
      @keyup="rememberSelection"
    />

    <div class="row" data-between="true">
      <span class="field-hint">{{ stats }}</span>
      <span class="field-hint">{{
        showPreview ? t('exhibition.editor.preview') : t('exhibition.editor.placeholder')
      }}</span>
    </div>

    <!-- 这一行只放预览和粘贴。插入图片、插入视频留在上面的工具条。 -->
    <div class="action-row" data-fill="true">
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
        {{ t('exhibition.editor.pasteMarkdown') }}
      </button>
    </div>
    <p class="field-hint">{{ mediaHint }}</p>

    <!-- 媒体网格：正文里已有的图片与视频，逐格可删 -->
    <div class="stack" data-gap="sm">
      <div class="row" data-between="true">
        <span class="section-label">{{ t('exhibition.editor.insertImage') }}</span>
        <span v-if="media.length > 0" class="pill">{{
          t('exhibition.editor.mediaCount', { count: media.length })
        }}</span>
      </div>
      <p v-if="media.length === 0 && pendingMedia === null" class="field-hint">
        {{ t('exhibition.form.emptyDescription') }}
      </p>
      <div v-if="media.length > 0 || pendingMedia !== null" class="media-grid">
        <div v-for="tile in visibleMedia" :key="tile.url" class="media-tile">
          <img
            v-if="tile.kind === 'image'"
            :src="tile.url"
            :alt="t('exhibition.editor.insertImage')"
            @error="removeMedia(tile)"
          />
          <!-- 视频用同一套槽位：`.media-tile img` 的铺满规则同样适用于 video -->
          <video v-else :src="tile.url" muted playsinline preload="metadata" @error="removeMedia(tile)" />
          <button type="button" :aria-label="t('exhibition.editor.clearContent')" @click="removeMedia(tile)">×</button>
        </div>
        <!-- 上传中的占位：图片显示本地预览，视频只垫文件名；遮罩从底部向上变亮并报百分比。
             遮罩满 100 停留结束后发 settled，占位这时才移除，正文里的服务器地址由真实格子补上。 -->
        <div v-if="pendingMedia !== null" class="media-tile media-tile-pending">
          <img
            v-if="pendingMedia.kind === 'image' && pendingMedia.url"
            :src="pendingMedia.url"
            :alt="t('exhibition.editor.insertImage')"
          />
          <span v-else class="media-file-name">{{ pendingMedia.fileName || t('exhibition.editor.insertVideo') }}</span>
          <UploadProgressMask :progress="pendingMedia.progress" @settled="clearPendingMedia" />
        </div>
      </div>
    </div>
  </template>

  <!-- 底部固定保存区 -->
  <Teleport v-if="!loadFailed && !notFound" defer to="#app-foot">
    <div class="page-foot">
      <div class="stack" data-gap="sm">
        <button
          class="cta"
          type="button"
          :disabled="saving || !canSave"
          :data-loading="saving ? 'true' : 'false'"
          @click="save"
        >
          {{ t('exhibition.editor.saveDescription') }}
        </button>
        <p class="field-hint text-center">{{ t('exhibition.editor.rendersAsMarkdown') }}</p>
      </div>
    </div>
  </Teleport>
</template>

<style>
.editor-surface {
  min-height: 192px;
  padding: var(--s3);
  border: var(--hairline) solid var(--stroke);
  border-radius: var(--r-input);
  background: var(--screen);
  font-size: var(--fs-body);
  line-height: 1.6;
  overflow-wrap: anywhere;
}

.editor-surface:focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: 2px;
}

.editor-surface:empty::before {
  content: attr(data-placeholder);
  color: var(--ink-3);
}

.toolbar {
  display: flex;
  flex-wrap: wrap;
  gap: var(--s2);
  padding: var(--s2);
  border: var(--hairline) solid var(--stroke);
  border-radius: var(--r-input);
  background: var(--f3);
}

.toolbar button {
  min-width: 44px;
  min-height: 40px;
  padding: 0 var(--s2);
  border: var(--hairline) solid var(--stroke);
  border-radius: var(--r-chip);
  background: var(--screen);
  color: var(--ink-2);
  font-size: var(--fs-label);
  font-weight: 700;
}

.toolbar button[aria-pressed='true'] {
  background: var(--dark);
  border-color: var(--dark);
  color: var(--on-dark);
}

.media-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(96px, 1fr));
  gap: var(--s2);
}

.media-tile {
  position: relative;
  aspect-ratio: 1;
  border: var(--hairline) solid var(--stroke);
  border-radius: var(--r-input);
  background: var(--f3);
  overflow: hidden;
}

.media-tile img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
}

.media-tile button {
  position: absolute;
  top: var(--s1);
  inset-inline-end: var(--s1);
  width: 32px;
  height: 32px;
  display: grid;
  place-items: center;
  border-radius: var(--r-pill);
  background: var(--media-scrim);
  color: var(--on-media);
  font-size: 16px;
  line-height: 1;
}

/* 上传中的占位：图片铺满（沿用 `.media-tile img`），视频没有预览就垫一条文件名。
   文件名压在遮罩上面（进度数字居中、文件名贴底），长文件名省略号截断。 */
.media-tile-pending {
  display: grid;
  place-items: center;
}

.media-file-name {
  position: absolute;
  inset-inline: var(--s1);
  bottom: var(--s1);
  z-index: 1;
  overflow: hidden;
  padding: 2px var(--s1);
  border-radius: var(--r-chip);
  background: var(--screen);
  color: var(--ink-2);
  font-size: var(--fs-meta);
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* 预览 / 粘贴 Markdown 这一行不在 `.card` 里，components.css 靠后的 `.action-row > .cta`
   按内容取宽。这里显式改回等分：一行两列、横向铺满、文案不折行。 */
.action-row[data-fill='true'] {
  align-items: stretch;
  overflow: visible;
}

.action-row[data-fill='true'] > .cta {
  flex: 1 1 0;
  width: auto;
  min-width: 0;
  white-space: nowrap;
}
</style>
