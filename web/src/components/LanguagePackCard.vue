<script setup lang="ts">
/**
 * 个人设置里的语言。
 *
 * 选择记在本机。链接和文件安装的包也在本机，不进页面包。卡片标题由设置页的「语言」组标题承担，
 * 组件里不再重复一个卡内小标题；已安装的包用带分隔线的开关行。
 * 切换、安装和删除当前语言后会重新加载，因为 `t()` 不是响应式的；
 * 安装成功的提示会排队到重载之后（`toastAfterReload()`，由外壳挂载时弹出）。
 * 「下载中文底稿」的落盘逻辑放在这里而不是 `i18n`：那一层不能引设备桥（`native-bridge` 会成环）。
 *
 * 两条安装路径：应用里 WebView 关着文件访问，页面读不到文件选择器给的文件，正文改由原生
 * `media.importText` 读出来回传；浏览器预览没有原生桥，才用 `<input type="file">` + `File.text()`。
 */
import { computed, ref } from 'vue';
import { useBootstrapStore } from '@/stores/bootstrap';
import SegControl from '@/components/SegControl.vue';
import { device } from '@/services/device-services';
import { nativeBridge } from '@/services/native-bridge';
import { toast } from '@/services/toast';
import {
  chineseTemplate,
  deleteLanguage,
  installPackFromText,
  installPackFromUrl,
  installedPacks,
  langErrorText,
  languageChoice,
  selectLanguage,
  t,
} from '@/i18n';

/** 中文底稿的文件名；原生「另存为」与浏览器下载共用，避免两处抄写后走偏。 */
const TEMPLATE_FILE = 'zh-template.json';

/** 本机是否有原生桥：文件安装与底稿导出据此分路；它不会在页面运行期间改变。 */
const hasNative = nativeBridge.hasNative();

const bootstrap = useBootstrapStore();
const packs = installedPacks();
const choice = languageChoice();
const url = ref('');
/** 链接下载的错误：显示在链接字段下方，并给输入框标红。 */
const urlError = ref('');
/** 从文件安装的错误：显示在「从文件安装」按钮下方，不动链接字段（用户这次不是来填链接的）。 */
const fileError = ref('');
const busy = ref(false);

const items = computed(() => [
  { value: 'zh', label: t('settings.lang.chinese') },
  ...packs.filter((pack) => pack.id !== 'zh').map((pack) => ({ value: pack.id, label: pack.name })),
  { value: '', label: t('settings.lang.followServer') },
]);

const serverName = computed(() => bootstrap.lang.defaultPack || t('settings.lang.chinese'));

async function download(): Promise<void> {
  urlError.value = '';
  busy.value = true;
  try {
    await installPackFromUrl(url.value.trim());
  } catch (reason) {
    urlError.value = langErrorText(reason);
  } finally {
    busy.value = false;
  }
}

/**
 * 下载中文底稿：有原生桥时交系统「另存为」面板，浏览器里退回 Blob 下载。
 * 用户在系统面板点了取消（`code === 'cancelled'`）按约定不算失败，静默返回。
 */
async function saveTemplate(): Promise<void> {
  const content = chineseTemplate();
  if (hasNative) {
    try {
      await device.exportText(TEMPLATE_FILE, content, 'application/json');
      toast(t('settings.lang.templateSaved'), 'success');
    } catch (reason) {
      // 先看稳定错误码，不匹配文案（见 services/native-bridge.ts）。
      if ((reason as { code?: string } | null)?.code === 'cancelled') return;
      toast(t('settings.lang.templateFailed'), 'error');
    }
    return;
  }
  // 浏览器预览没有系统面板，直接触发一次下载。
  try {
    const url = URL.createObjectURL(new Blob([content], { type: 'application/json' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = TEMPLATE_FILE;
    link.click();
    URL.revokeObjectURL(url);
  } catch {
    toast(t('settings.lang.templateFailed'), 'error');
    return;
  }
  toast(t('settings.lang.templateSaved'), 'success');
}

/**
 * 从文件安装（原生桥）：用户在系统文件选择器里选中的正文由原生读出来回传。
 * 用户取消（`code === 'cancelled'`）静默返回；其余失败仍显示在这一节。
 */
async function installFromDevice(): Promise<void> {
  fileError.value = '';
  busy.value = true;
  try {
    const picked = await device.importText('application/json');
    await installPackFromText(String(picked?.text ?? ''));
  } catch (reason) {
    // 先看稳定错误码，不匹配文案（见 services/native-bridge.ts）。
    if ((reason as { code?: string } | null)?.code === 'cancelled') return;
    fileError.value = langErrorText(reason);
  } finally {
    busy.value = false;
  }
}

async function fromFile(event: Event): Promise<void> {
  const input = event.target;
  if (!(input instanceof HTMLInputElement)) return;
  const file = input.files?.[0];
  input.value = '';
  if (!file) return;
  fileError.value = '';
  busy.value = true;
  try {
    await installPackFromText(await file.text());
  } catch (reason) {
    fileError.value = langErrorText(reason);
  } finally {
    busy.value = false;
  }
}
</script>

<template>
  <div class="card">
    <!-- 标题由设置页的「语言」组标题承担，卡片里直接从分段控件开始 -->
    <SegControl
      :model-value="choice"
      :items="items"
      :label="t('settings.lang.title')"
      @update:model-value="selectLanguage"
    />
    <p class="field-hint">{{ t('settings.lang.followServer') }} · {{ serverName }}</p>

    <form class="form" @submit.prevent="download">
      <div class="field" :data-invalid="urlError ? 'true' : 'false'">
        <label for="settings-lang-url">{{ t('settings.lang.url') }}</label>
        <input
          id="settings-lang-url"
          v-model="url"
          class="input"
          type="url"
          inputmode="url"
          autocomplete="off"
          :placeholder="t('settings.lang.urlPlaceholder')"
        />
        <p v-if="urlError" class="field-error" role="alert">{{ urlError }}</p>
      </div>
      <button class="cta" type="submit" :disabled="busy" :data-loading="busy ? 'true' : 'false'">
        {{ t('settings.lang.download') }}
      </button>
    </form>

    <!-- 有原生桥时由按钮直接调原生读文件（用户手势直接触发）；没有桥才用 input + File.text()。
         input 两种构建都留着，`#settings-lang-file` 是浏览器路径的入口。 -->
    <button v-if="hasNative" class="cta ghost" type="button" :disabled="busy" @click="installFromDevice">
      {{ t('settings.lang.file') }}
    </button>
    <label v-else class="cta ghost" for="settings-lang-file">{{ t('settings.lang.file') }}</label>
    <input id="settings-lang-file" class="sr-only" type="file" accept="application/json,.json" @change="fromFile" />
    <!-- 文件安装的错误跟在它自己的入口下面，不占链接字段的位置、也不标红链接输入框。 -->
    <p v-if="fileError" class="field-error" role="alert">{{ fileError }}</p>

    <p v-if="packs.length === 0" class="field-hint">{{ t('settings.lang.empty') }}</p>
    <!-- 已安装的语言包：卡片内的开关行用分隔线版式，不再各套一层边框 -->
    <div v-else class="list" data-gap="none">
      <div v-for="pack in packs" :key="pack.id" class="switch-row" data-flush="true">
        <span class="switch-copy">
          <strong>{{ pack.name }}</strong>
          <span class="row-meta">{{ pack.id }}</span>
        </span>
        <button class="text-action" type="button" @click="deleteLanguage(pack.id)">
          {{ t('settings.lang.remove') }}
        </button>
      </div>
    </div>

    <button class="text-action" type="button" @click="saveTemplate">
      {{ t('settings.lang.template') }}
    </button>
  </div>
</template>
