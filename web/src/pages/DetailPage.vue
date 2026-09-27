<script setup lang="ts">
import { onMounted, computed } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { api } from '@/app/runtime';
import { useAsync } from '@/composables/useAsync';
import type { ExhibitionDetail } from '@/api/types';
import { markdownToHtml } from '@/services/markdown';
import { t } from '@/i18n';
const route = useRoute(); const router = useRouter(); const query = useAsync<ExhibitionDetail>();
const exhibition = computed(() => query.data.value?.exhibition); const fields = computed(() => query.data.value?.fields ?? []); const description = computed(() => markdownToHtml(String(exhibition.value?.description || '')));
onMounted(() => query.run(() => api.exhibitions.get(String(route.params.id))));
</script>
<template><section class="page"><button class="text-action" @click="router.back()">{{ t('s_omytgn') }}</button><div v-if="query.loading" class="state">{{ t('s_d154o') }}</div><div v-else-if="query.error" class="state error">{{ query.error.value?.message }}<button @click="query.run(() => api.exhibitions.get(String(route.params.id)))">{{ t('s_lswd2v') }}</button></div><div v-else-if="!exhibition" class="state">{{ t('s_1sdwe6p') }}</div><template v-else><header class="page-heading"><p class="eyebrow">{{ exhibition.category }}</p><h1>{{ exhibition.title }}</h1><p class="muted">{{ exhibition.date }} · {{ exhibition.time }} · {{ exhibition.venue }}</p></header><article class="card rich-content" v-html="description"></article><div class="card"><h2>{{ t('s_vrp4t3') }}</h2><p v-if="fields.length === 0">{{ t('s_hadtmi') }}</p><ul v-else><li v-for="field in fields" :key="String(field.id || field.title)">{{ field.title }}<span v-if="field.required"> *</span></li></ul></div><button class="cta" :disabled="exhibition.openForRegistration === false" @click="router.push(`/registration-form/${exhibition.id}`)">{{ exhibition.openForRegistration === false ? t('s_105o66n') : t('s_1umrk9v') }}</button></template></section></template>
