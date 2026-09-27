<script setup lang="ts">
import { onMounted, computed } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { api } from '@/app/runtime';
import { useAsync } from '@/composables/useAsync';
import type { ExhibitionDetail } from '@/api/types';
import { markdownToHtml } from '@/services/markdown';
const route = useRoute(); const router = useRouter(); const query = useAsync<ExhibitionDetail>();
const exhibition = computed(() => query.data.value?.exhibition); const fields = computed(() => query.data.value?.fields ?? []); const description = computed(() => markdownToHtml(String(exhibition.value?.description || '')));
onMounted(() => query.run(() => api.exhibitions.get(String(route.params.id))));
</script>
<template><section class="page"><button class="text-action" @click="router.back()">返回</button><div v-if="query.loading" class="state">正在加载展会…</div><div v-else-if="query.error" class="state error">{{ query.error.value?.message }}<button @click="query.run(() => api.exhibitions.get(String(route.params.id)))">重试</button></div><div v-else-if="!exhibition" class="state">展会不存在或已删除</div><template v-else><header class="page-heading"><p class="eyebrow">{{ exhibition.category }}</p><h1>{{ exhibition.title }}</h1><p class="muted">{{ exhibition.date }} · {{ exhibition.time }} · {{ exhibition.venue }}</p></header><article class="card rich-content" v-html="description"></article><div class="card"><h2>报名信息</h2><p v-if="fields.length === 0">无需填写额外信息</p><ul v-else><li v-for="field in fields" :key="String(field.id || field.title)">{{ field.title }}<span v-if="field.required">（必填）</span></li></ul></div><button class="cta" :disabled="exhibition.openForRegistration === false" @click="router.push(`/registration-form/${exhibition.id}`)">{{ exhibition.openForRegistration === false ? '当前不可报名' : '报名' }}</button></template></section></template>
