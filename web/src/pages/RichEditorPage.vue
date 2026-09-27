<script setup lang="ts">
import { t } from '@/i18n';
import { computed, ref } from 'vue'; import { useRouter } from 'vue-router'; import { device } from '@/services/device-services'; import { markdownToHtml } from '@/services/markdown';
const router = useRouter(); const markdown = ref(''); const preview = ref(false); const error = ref(''); const rendered = computed(() => markdownToHtml(markdown.value));
async function addImage() { error.value = ''; try { const picked = await device.importMedia('image'); markdown.value += `\n![${t('s_1k84spe')}](${picked.url})\n`; } catch (reason) { error.value = reason instanceof Error ? reason.message : String(reason); } }
</script>
<template><section class="page"><button class="text-action" @click="router.back()">{{ t('s_omytgn') }}</button><header class="page-heading"><h1>{{ t('s_15s6uqt') }}</h1></header><div class="cluster"><button class="cta ghost" @click="preview = !preview">{{ preview ? t('s_qreyeg') : t('s_k2jp4x') }}</button><button class="cta ghost" @click="addImage">{{ t('s_1w5fs53') }}</button></div><textarea v-if="!preview" v-model="markdown" class="markdown-editor" rows="16" :aria-label="t('s_15s6uqt')"></textarea><article v-else class="card rich-content" v-html="rendered"></article><p v-if="error" class="error">{{ error }}</p></section></template>
