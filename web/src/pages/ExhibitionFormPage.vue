<script setup lang="ts">
/**
 * 屏幕 11 · 展会编辑（新建 / 编辑）
 * 线框：docs/newUI/remaining-ui.html #screen-exhibition-form
 *
 * 展商后台卡片上的「报名方式」「编辑简介」收进本页的「报名与简介设置」栏。
 * 「删除展会」放在页面内容最下方。新建与编辑共用同一页：
 * 路由带 `:id` 就是编辑（先取详情），不带就是新建（空表单），保存成功后换成编辑地址。
 *
 * 表单只填一次（`built` 闸）：首屏取数回来才落模型，之后的渲染不再覆盖用户输入。
 * 校验规则与上限统一走 `@/services/validate`，错误就地显示在 `.field-error` 并标 `data-invalid`。
 */
import { computed, onMounted, reactive, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { api } from '@/app/runtime';
import { useAsync } from '@/composables/useAsync';
import { useBootstrapStore } from '@/stores/bootstrap';
import { useSessionStore } from '@/stores/session';
import { toast } from '@/services/toast';
import { confirmSheet } from '@/services/sheet';
import {
  PATTERNS, allowedFormats, check, limit, uploadCountLimit, uploadSizeLimitMb, validateAll,
} from '@/services/validate';
import { EXHIBITION_STATUS, REGISTRATION_MODES } from '@/services/status';
import { device } from '@/services/device-services';
import { loadMarkdownParser, markdownToHtml, plainText } from '@/services/markdown';
import CollectFieldsCard, { type CollectField } from '@/components/CollectFieldsCard.vue';
import { firstCollectFieldError } from '@/services/collect-fields';
import StateBlock from '@/components/StateBlock.vue';
import SkeletonBlock from '@/components/SkeletonBlock.vue';
import SegControl from '@/components/SegControl.vue';
import type { ExhibitionDetail, JsonObject } from '@/api/types';
import { t } from '@/i18n';

const MODES = REGISTRATION_MODES.map((value) => ({ value, label: value }));
/** 分类下拉的占位项：清单由管理员维护，这里只提示「还没选」。 */
const categoryPlaceholder = t('s_ph3tpb');

const route = useRoute();
const router = useRouter();
const bootstrap = useBootstrapStore();
const session = useSessionStore();

const exhibitionId = computed(() => String(route.params.id ?? ''));
const isCreate = computed(() => exhibitionId.value === '');
const limited = computed(() => session.user.can?.limited === true);

/**
 * 分类下拉的选项：管理员配置的清单。
 * 老数据的分类可能已经不在清单里，仍把它作为一个选项带上，
 * 否则一进编辑页就会把展会分类悄悄改成空值。
 */
const categoryOptions = computed<string[]>(() => {
  const list = (Array.isArray(bootstrap.categories) ? bootstrap.categories : []).map((item) => String(item));
  const current = form.category.trim();
  return current && !list.includes(current) ? [current, ...list] : list;
});

const detail = useAsync<ExhibitionDetail>();
const saving = ref(false);
/** 新建保存成功后 `id` 才有值：简介入口与删除按钮据此从置灰切到可用。 */
const createdId = ref('');
const notFound = computed(() => !isCreate.value && detail.data.value !== undefined && detail.data.value.found === false);
const loadFailed = computed(() => detail.error.value !== undefined && detail.data.value === undefined);

const form = reactive({
  title: '',
  venue: '',
  date: '',
  time: '09:00-17:00',
  status: EXHIBITION_STATUS.REVIEW_REQUIRED as string,
  category: '',
  description: '',
  imageUri: '',
  registrationStart: '',
  registrationEnd: '',
  qrEnabled: false,
  allowCancel: true,
});
const fields = ref<CollectField[]>([]);
/** 表单只填一次：编辑页的数据到了才落模型，之后渲染不再覆盖用户输入。 */
const built = ref(false);
const formError = ref('');
const invalidField = ref('');

// ── 封面 / 报名方式 / 简介的可变展示 ──────────────────────────────

/** 允许的图片后缀：管理员在「管理-设置」里配置，缺省时给一句常见格式。 */
const formatHint = computed(() => {
  const list = allowedFormats('image');
  return list.length > 0 ? list.map((item) => `.${item}`).join('/') : t('s_1qnyx3k');
});

/** 简介预览：Markdown 先渲染再抽纯文本，摘要与详情页看到的一致。 */
const descriptionSummary = computed(() => {
  if (!form.description) return t('s_12ibypn');
  return plainText(markdownToHtml(form.description), 70) || t('s_1fpy22o');
});

const qrHint = computed(() => (form.qrEnabled ? t('s_mu5yl5') : t('s_3xcdlm')));
const allowCancelLabel = t('s_7dpqcv');
const allowCancelHint = t('s_1h0j3w0');

/** 媒体限制说明：数量与大小上限都来自「管理-设置」。 */
const mediaHint = computed(() => {
  const imageCount = Number(bootstrap.media.imageCount) || 8;
  const imageSize = Number(bootstrap.media.imageSizeMb) || 10;
  return `图片 ${imageCount} 张 / 单张 ${imageSize} MB，`
    + `视频 ${uploadCountLimit('video')} 个 / 单个不超过 ${uploadSizeLimitMb('video')} MB；${t('s_vkgi23')}`;
});

// ── 校验 ─────────────────────────────────────────────────────────

/**
 * 逐字段的校验顺序：保存前一格一格地报错，与旧实现的 `validateAll(validators)` 等价。
 * 规则与上限来自 `@/services/validate`，这里只声明每一格用什么规则。
 */
function fieldChecks(): Array<[string, () => string]> {
  return [
    ['title', () => check(form.title, { label: t('s_1co82cb'), required: true, max: limit('exhibitionTitle', 60) })],
    ['venue', () => check(form.venue, { label: t('s_1tlfy5l'), required: true, max: limit('exhibitionVenue', 60) })],
    ['date', () => check(form.date, {
      label: t('s_s2nfay'), required: true, pattern: PATTERNS.date, patternMessage: t('s_1appv4n'),
    })],
    ['time', () => check(form.time, {
      label: t('s_kgtsw4'), max: 20, pattern: PATTERNS.timeRange, patternMessage: t('s_1q49p4s'),
    })],
    ['registrationEnd', () => check(form.registrationEnd, {
      label: t('s_cbxrmr'),
      custom: () => (form.registrationStart && form.registrationEnd && form.registrationEnd < form.registrationStart
        ? t('s_1gcmqh3') : ''),
    })],
    ['category', () => check(form.category, {
      label: t('s_9xu72h'), max: limit('category', 20), pattern: PATTERNS.category, patternMessage: t('s_ariomv'),
    })],
    ['registrationStart', () => check(form.registrationStart, {
      label: t('s_k1e25y'),
      custom: () => (form.registrationStart && form.date && form.registrationStart > form.date
        ? t('s_h8z5hw') : ''),
    })],
  ];
}

/** 保存前校验：第一条错误显示在原位（字段红框 + 统一说明），并给一次轻提示。 */
function failFirst(): boolean {
  invalidField.value = '';
  const checks = fieldChecks();
  const result = validateAll(checks.map(([, run]) => run));
  if (!result.ok) {
    invalidField.value = checks[result.index]?.[0] ?? '';
    formError.value = result.message;
    toast(result.message, 'error');
    return true;
  }
  const fieldMessage = firstCollectFieldError(fields.value, {
    title: limit('fieldTitle', 30),
    radio: limit('radioOption', 60),
    check: limit('checkOption', 60),
  });
  if (fieldMessage) {
    formError.value = fieldMessage;
    invalidField.value = 'fields';
    toast(formError.value, 'error');
    return true;
  }
  formError.value = '';
  return false;
}

/** 该字段是否处于「校验未通过」：红框 + 说明，不再依赖全局错误条。 */
function isInvalid(name: string): boolean {
  return invalidField.value === name;
}

// ── 取数 ─────────────────────────────────────────────────────────

function fillFrom(item: JsonObject, data: ExhibitionDetail): void {
  form.title = String(item.title ?? '');
  form.venue = String(item.venue ?? '');
  form.date = String(item.date ?? '');
  form.time = String(item.time ?? '');
  const status = String(item.status ?? '');
  form.status = MODES.some((mode) => mode.value === status) ? status : EXHIBITION_STATUS.REVIEW_REQUIRED;
  form.category = String(item.category ?? '');
  form.description = String(item.description ?? '');
  form.imageUri = String(item.imageUri ?? '');
  form.registrationStart = String(item.registrationStart ?? '');
  form.registrationEnd = String(item.registrationEnd ?? '');
  form.qrEnabled = item.qrEnabled === true;
  form.allowCancel = item.allowCancel !== false;
  fields.value = (data.fields ?? []).map((field) => ({
    title: String(field.title ?? ''),
    type: String(field.type ?? '文本'),
    required: field.required === true,
    // 选项在模型里统一为数组，界面上按条目增删。
    options: normalizeOptions(field.options),
  }));
}

/** 新建展会没有要取的数据，直接出空表单（受限账号已在上面拦掉）。 */
async function load(): Promise<void> {
  if (isCreate.value) {
    built.value = true;
    return;
  }
  const data = await detail.run(async () => {
    const result = await api.exhibitions.get(exhibitionId.value);
    if (result.exhibition?.description) await loadMarkdownParser();
    return result;
  });
  if (!data || data.found === false) return;
  if (built.value) return;
  built.value = true;
  fillFrom(data.exhibition ?? {}, data);
}

onMounted(() => { void load(); });

// ── 封面 ─────────────────────────────────────────────────────────

/** 封面直接落盘成短 URL，避免把图片塞进简介或展会记录。 */
async function pickCover(): Promise<void> {
  try {
    const stored = await device.importMedia('image') as { url?: string; compressed?: boolean };
    if (!stored?.url) {
      toast(t('s_1dc9o49'), 'error');
      return;
    }
    form.imageUri = stored.url;
    toast(stored.compressed ? t('s_1bbs6qg') : t('s_1ckoagi'), 'success');
  } catch (reason) {
    // 用户在系统选择器点了取消：按稳定错误码判断，不匹配文案。
    if (isCancelled(reason)) return;
    toast(reason instanceof Error ? reason.message : String(reason), 'error');
  }
}

function removeCover(): void {
  form.imageUri = '';
}

// ── 报名方式 / 简介 / 二维码 / 删除 ──────────────────────────────

/**
 * 切换报名方式。
 *
 * 三个选项直接摆在页面里（分段控件），不再弹抽屉：选项本身就是全部信息，
 * 多一层面板只会让「改一个开关」变成两次点击。已保存的展会立即写库，
 * 新建时随保存一起提交。
 */
async function changeMode(value: string): Promise<void> {
  if (value === form.status) return;
  form.status = value;
  if (!isCreate.value) await saveStatusOnly();
}

/** 只提交报名方式（状态），保存后停留在当前页，不打断展商的编辑。 */
async function saveStatusOnly(): Promise<void> {
  try {
    const saved = await api.exhibitions.save(buildPayload());
    if (saved?.ok !== true) {
      toast(String(saved?.error || t('s_1n4563g')), 'error');
      return;
    }
    toast(t('s_i0as17'), 'success');
  } catch (reason) {
    toast(reason instanceof Error ? reason.message : String(reason), 'error');
  }
}

function editDescription(): void {
  const id = createdId.value || exhibitionId.value;
  if (!id) {
    toast(t('s_1wz04v2'), 'error');
    return;
  }
  void router.push(`/rich-editor?id=${encodeURIComponent(id)}`);
}

function askDelete(): void {
  confirmSheet({
    title: t('s_1u7mlaq'),
    message: `删除「${form.title || t('s_1yjopwv')}」后，展会信息与报名收集项都会移除，且无法恢复。`,
    confirmLabel: t('s_1t2vi4h'),
    tone: 'danger',
    onConfirm: async () => {
      try {
        // 写接口统一返回 { ok, error }，只判断响应本身会把失败当成成功。
        const result = await api.exhibitions.remove(exhibitionId.value);
        const ok = result?.ok === true;
        toast(String(ok ? t('s_1jj834o') : (result?.error || t('s_1ijrr73'))), ok ? 'success' : 'error');
        if (ok) await router.replace('/exhibitor');
      } catch (reason) {
        toast(reason instanceof Error ? reason.message : String(reason), 'error');
      }
    },
  });
}

// ── 保存 ─────────────────────────────────────────────────────────

/** 组装保存用的 payload，「保存」与「报名方式」即时写库共用同一份结构。 */
function buildPayload(): JsonObject {
  return {
    id: createdId.value || exhibitionId.value,
    title: form.title.trim(),
    venue: form.venue.trim(),
    date: form.date,
    day: Number(form.date.slice(8, 10)) || 0,
    time: form.time.trim(),
    status: form.status,
    category: form.category.trim(),
    description: form.description,
    descriptionFormat: 'md',
    imageUri: form.imageUri,
    registrationStart: form.registrationStart,
    registrationEnd: form.registrationEnd,
    qrEnabled: form.qrEnabled,
    allowCancel: form.allowCancel,
    // 空选项不下发，避免保存出无意义的选项条目。
    fields: fields.value
      .filter((item) => item.title.trim() !== '')
      .map((item) => ({
        title: item.title.trim(),
        type: item.type,
        required: item.required,
        options: item.type === '文本'
          ? []
          : item.options.map((option) => option.trim()).filter(Boolean),
      })),
  };
}

async function submit(): Promise<void> {
  if (saving.value) return;
  if (failFirst()) return;
  saving.value = true;
  try {
    const saved = await api.exhibitions.save(buildPayload());
    if (saved?.ok !== true) {
      formError.value = String(saved?.error || t('s_1q9u8le'));
      toast(formError.value, 'error');
      return;
    }
    const exhibition = (saved.exhibition ?? {}) as JsonObject;
    createdId.value = String(exhibition.id ?? createdId.value);
    form.description = String(exhibition.description ?? form.description);
    form.imageUri = String(exhibition.imageUri ?? form.imageUri);
    toast(isCreate.value ? t('s_opaqad') : t('s_1sfkhdl'), 'success');
    // 新建成功后换成编辑地址：简介入口与删除按钮随之可用，再点保存就是更新。
    if (isCreate.value) await router.replace(`/exhibition-form/${encodeURIComponent(createdId.value)}`);
    else await router.replace('/exhibitor');
  } catch (reason) {
    formError.value = reason instanceof Error ? reason.message : String(reason);
    toast(formError.value, 'error');
  } finally {
    saving.value = false;
  }
}

function isCancelled(reason: unknown): boolean {
  return Boolean(reason && typeof reason === 'object' && (reason as { code?: unknown }).code === 'cancelled');
}

/** 选项来源兼容字符串（逗号分隔）与数组，模型内统一为数组。 */
function normalizeOptions(options: unknown): string[] {
  if (Array.isArray(options)) return options.map((item) => String(item));
  return String(options || '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

const canEditDescription = computed(() => !isCreate.value || createdId.value !== '');
</script>

<template>
  <!-- 受限账号：后端对展会写操作一律 403，深链也绕不过去，整页顶掉不给填了存不下的表单 -->
  <StateBlock
    v-if="limited"
    icon="briefcase"
    tone="error"
    :title="isCreate ? t('s_19wazv8') : t('s_1wwetl9')"
    :description="t('s_1yv1vu0')"
    :action-label="t('s_dn4ida')"
    @action="router.replace('/exhibitor')"
  />

  <SkeletonBlock v-else-if="detail.loading.value && !detail.data.value" :rows="4" />

  <StateBlock
    v-else-if="loadFailed"
    tone="error"
    :title="t('s_kvpltc')"
    :description="detail.error.value?.message"
    :action-label="t('s_lswd2v')"
    @action="load"
  />

  <StateBlock
    v-else-if="notFound"
    tone="error"
    :title="t('s_1vim1qp')"
    :description="String(detail.data.value?.error || t('s_1qfu0ss'))"
    :action-label="t('s_dn4ida')"
    @action="router.replace('/exhibitor')"
  />

  <template v-else-if="built">
    <div class="form">
      <div class="field" :data-invalid="isInvalid('title') ? 'true' : 'false'">
        <label for="form-title">{{ t('s_1co82cb') }}<span class="required" aria-hidden="true"> *</span></label>
        <input
          id="form-title"
          v-model="form.title"
          class="input"
          type="text"
          :placeholder="t('s_giboid')"
          :maxlength="limit('exhibitionTitle', 60)"
        />
      </div>
      <div class="field" :data-invalid="isInvalid('venue') ? 'true' : 'false'">
        <label for="form-venue">{{ t('s_25fwki') }}<span class="required" aria-hidden="true"> *</span></label>
        <input
          id="form-venue"
          v-model="form.venue"
          class="input"
          type="text"
          :placeholder="t('s_vih0tf')"
          :maxlength="limit('exhibitionVenue', 60)"
        />
      </div>
      <div class="grid-cols-2">
        <div class="field" :data-invalid="isInvalid('date') ? 'true' : 'false'">
          <label for="form-date">{{ t('s_s2nfay') }}<span class="required" aria-hidden="true"> *</span></label>
          <input id="form-date" v-model="form.date" class="input" type="date" />
          <p v-if="isInvalid('date')" class="field-error" role="alert">{{ formError }}</p>
        </div>
        <div class="field" :data-invalid="isInvalid('time') ? 'true' : 'false'">
          <label for="form-time">{{ t('s_kgtsw4') }}</label>
          <input id="form-time" v-model="form.time" class="input" type="text" placeholder="09:00-17:00" maxlength="20" />
          <p v-if="isInvalid('time')" class="field-error" role="alert">{{ formError }}</p>
        </div>
      </div>
      <div class="grid-cols-2">
        <div class="field" :data-invalid="isInvalid('registrationStart') ? 'true' : 'false'">
          <label for="form-reg-start">{{ t('s_4o8ie2') }}</label>
          <input id="form-reg-start" v-model="form.registrationStart" class="input" type="date" />
          <p v-if="isInvalid('registrationStart')" class="field-error" role="alert">{{ formError }}</p>
        </div>
        <div class="field" :data-invalid="isInvalid('registrationEnd') ? 'true' : 'false'">
          <label for="form-reg-end">{{ t('s_60i0xr') }}</label>
          <input id="form-reg-end" v-model="form.registrationEnd" class="input" type="date" />
          <p v-if="isInvalid('registrationEnd')" class="field-error" role="alert">{{ formError }}</p>
        </div>
      </div>
      <div class="field" :data-invalid="isInvalid('category') ? 'true' : 'false'">
        <label for="form-category">{{ t('s_9xu72h') }}</label>
        <!-- 分类是管理员在「管理后台-设置」里维护的清单，展商这里只能从清单里选 -->
        <select id="form-category" v-model="form.category" class="select">
          <option value="">{{ categoryPlaceholder }}</option>
          <option v-for="item in categoryOptions" :key="item" :value="item">{{ item }}</option>
        </select>
        <p v-if="isInvalid('category')" class="field-error" role="alert">{{ formError }}</p>
      </div>
      <p v-if="formError && !invalidField" class="field-error" role="alert">{{ formError }}</p>
      <p v-if="isInvalid('fields')" class="field-error" role="alert">{{ formError }}</p>
    </div>

    <!-- 封面：1080×1920 竖版海报，可上传 / 更换 / 移除 -->
    <div class="card">
      <div class="row" data-between="true">
        <span class="section-label">{{ t('s_63jsvx') }}</span>
        <span class="pill">1080 × 1920</span>
      </div>
      <div v-if="form.imageUri" class="hero ph-img hero-compact">
        <img :src="form.imageUri" :alt="t('s_63jsvx')" />
      </div>
      <div v-else class="hero ph-img hero-compact" aria-hidden="true" />
      <div class="row" data-gap="md">
        <button class="cta ghost" data-size="small" type="button" style="flex: 1 1 0" @click="pickCover">
          {{ form.imageUri ? t('s_xocxb0') : t('s_6piprk') }}
        </button>
        <button
          v-if="form.imageUri"
          class="cta ghost"
          data-size="small"
          type="button"
          style="flex: 1 1 0"
          @click="removeCover"
        >
          {{ t('s_eab5ax') }}
        </button>
      </div>
    </div>

    <!-- 报名与简介设置：报名方式是三个互斥分段按钮，简介收在这一栏 -->
    <div class="card">
      <span class="section-label">{{ t('s_1ylv0q2') }}</span>
      <div class="field">
        <span class="field-label">{{ t('s_1vv5l4v') }}</span>
        <SegControl :model-value="form.status" :items="MODES" :label="t('s_1vv5l4v')" @update:model-value="changeMode" />
      </div>
      <hr class="divider" />
      <div class="stack" data-gap="sm">
        <!-- 不再重复「展会简介」小标题：这一栏的「报名与简介设置」已经说明了用途，
             按钮本身就是入口，左边留标题只会让这一行更挤。 -->
        <div class="row">
          <button
            class="cta ghost"
            data-size="small"
            type="button"
            :disabled="!canEditDescription"
            :title="canEditDescription ? undefined : t('s_1wz04v2')"
            @click="editDescription"
          >
            {{ canEditDescription ? t('s_21ce2x') : t('s_1wz04v2') }}
          </button>
        </div>
        <p class="row-meta clamp-2">{{ descriptionSummary }}</p>
      </div>
      <hr class="divider" />
      <div class="switch-row">
        <span class="switch-copy">
          <strong>{{ t('s_1birmm3') }}</strong>
          <span class="row-meta">{{ t('s_2ccwmm') }}</span>
        </span>
        <label class="switch" for="form-qr-enabled">
          <input id="form-qr-enabled" v-model="form.qrEnabled" type="checkbox" />
          <span />
        </label>
      </div>
      <p class="field-hint">{{ qrHint }}</p>
      <hr class="divider" />
      <div class="switch-row">
        <span class="switch-copy">
          <strong>{{ allowCancelLabel }}</strong>
          <span class="row-meta">{{ allowCancelHint }}</span>
        </span>
        <label class="switch" for="form-allow-cancel">
          <input id="form-allow-cancel" v-model="form.allowCancel" type="checkbox" />
          <span />
        </label>
      </div>
    </div>

    <!-- 报名收集项：与私人会议设置共用同一张卡，样式保持一致 -->
    <CollectFieldsCard
      :fields="fields"
      :label="t('s_s8p5nm')"
      :hint="mediaHint"
      :title-max="limit('fieldTitle', 30)"
      :radio-max="limit('radioOption', 60)"
      :check-max="limit('checkOption', 60)"
    />

    <!-- 删除放在内容最下，保存仍固定在页脚。新建还没有展会，按钮不可点。 -->
    <div class="card">
      <span class="section-label">{{ t('s_qtyy0e') }}</span>
      <button class="cta danger" type="button" :disabled="isCreate" @click="askDelete">
        {{ isCreate ? t('s_mj5xsg') : t('s_1u7mlaq') }}
      </button>
    </div>
  </template>

  <!-- 底部固定保存区：保存后可在详情页确认展示效果 -->
  <Teleport v-if="built && !limited && !loadFailed && !notFound" defer to="#app-foot">
    <div class="page-foot">
      <div class="stack" data-gap="sm">
        <button class="cta" type="button" :disabled="saving" :data-loading="saving ? 'true' : 'false'" @click="submit">
          {{ isCreate ? t('s_gya40f') : t('s_10q6dxb') }}
        </button>
        <p class="field-hint text-center">{{ t('s_167n8sn') }}</p>
      </div>
    </div>
  </Teleport>
</template>
