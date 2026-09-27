<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'; import { api } from '@/app/runtime'; import { useAsync } from '@/composables/useAsync'; import type { Registration } from '@/api/types';
const query = useAsync<Registration[]>(); const items = computed(() => query.data.value ?? []); const error = ref(''); onMounted(() => query.run(() => api.review.list()));
async function update(id: string, status: string) { error.value = ''; try { await api.review.updateStatus(id, status); await query.run(() => api.review.list()); } catch (reason) { error.value = reason instanceof Error ? reason.message : String(reason); } }
</script>
<template><section class="page"><h1>报名审核</h1><p v-if="error" class="error">{{ error }}</p><div v-if="query.loading" class="state">正在加载…</div><div v-else class="list"><article v-for="item in items" :key="item.id" class="row-card"><strong>{{ item.exhibitionTitle }}</strong><span>{{ item.visitorName }} · {{ item.statusLabel || item.status }}</span><div><button class="cta ghost" @click="update(item.id, 'approved')">通过</button><button class="cta ghost" @click="update(item.id, 'rejected')">拒绝</button></div></article></div></section></template>
