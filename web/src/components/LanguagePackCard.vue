<script setup lang="ts">
/**
 * 个人设置里的语言。
 *
 * 选择记在本机。链接和文件安装的包也在本机，不进页面包。
 * 切换、安装和删除当前语言后会重新加载，因为 `t()` 不是响应式的。
 */
import { computed, ref } from 'vue';
import { useBootstrapStore } from '@/stores/bootstrap';
import SegControl from '@/components/SegControl.vue';
import {
  deleteLanguage,
  downloadChineseTemplate,
  installPackFromText,
  installPackFromUrl,
  installedPacks,
  langErrorText,
  languageChoice,
  selectLanguage,
  t,
} from '@/i18n';

const bootstrap = useBootstrapStore();
const packs = installedPacks();
const choice = languageChoice();
const url = ref('');
const error = ref('');
const busy = ref(false);

const items = computed(() => [
  { value: 'zh', label: t('settings.lang.chinese') },
  ...packs.filter((pack) => pack.id !== 'zh').map((pack) => ({ value: pack.id, label: pack.name })),
  { value: '', label: t('settings.lang.followServer') },
]);

const serverName = computed(() => bootstrap.lang.defaultPack || t('settings.lang.chinese'));

async function download(): Promise<void> {
  error.value = '';
  busy.value = true;
  try {
    await installPackFromUrl(url.value.trim());
  } catch (reason) {
    error.value = langErrorText(reason);
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
  error.value = '';
  busy.value = true;
  try {
    await installPackFromText(await file.text());
  } catch (reason) {
    error.value = langErrorText(reason);
  } finally {
    busy.value = false;
  }
}
</script>

<template>
  <div class="card">
    <span class="section-label">{{ t('settings.lang.title') }}</span>
    <SegControl
      :model-value="choice"
      :items="items"
      :label="t('settings.lang.title')"
      @update:model-value="selectLanguage"
    />
    <p class="field-hint">{{ t('settings.lang.followServer') }} · {{ serverName }}</p>

    <form class="form" @submit.prevent="download">
      <div class="field" :data-invalid="error ? 'true' : 'false'">
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
        <p v-if="error" class="field-error" role="alert">{{ error }}</p>
      </div>
      <button class="cta" type="submit" :disabled="busy" :data-loading="busy ? 'true' : 'false'">
        {{ t('settings.lang.download') }}
      </button>
    </form>

    <label class="cta ghost" for="settings-lang-file">{{ t('settings.lang.file') }}</label>
    <input id="settings-lang-file" class="sr-only" type="file" accept="application/json,.json" @change="fromFile" />

    <p v-if="packs.length === 0" class="field-hint">{{ t('settings.lang.empty') }}</p>
    <div v-for="pack in packs" :key="pack.id" class="switch-row">
      <span class="switch-copy">
        <strong>{{ pack.name }}</strong>
        <span class="row-meta">{{ pack.id }}</span>
      </span>
      <button class="text-action" type="button" @click="deleteLanguage(pack.id)">
        {{ t('settings.lang.remove') }}
      </button>
    </div>

    <button class="text-action" type="button" @click="downloadChineseTemplate">
      {{ t('settings.lang.template') }}
    </button>
  </div>
</template>
