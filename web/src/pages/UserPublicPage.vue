<script setup lang="ts">
import { computed, onMounted } from 'vue'; import { useRoute, useRouter } from 'vue-router'; import { api } from '@/app/runtime'; import { useAsync } from '@/composables/useAsync'; import type { JsonObject } from '@/api/types';
const route = useRoute(); const router = useRouter(); const query = useAsync<JsonObject>(); const profile = computed(() => query.data.value ?? {});
onMounted(() => query.run(() => api.users.publicProfile({ nickname: String(route.params.nickname) })));
</script>
<template><section class="page"><button class="text-action" @click="router.back()">返回</button><div v-if="query.loading" class="state">正在加载…</div><p v-else-if="query.error" class="state error">{{ query.error.value?.message }}</p><article v-else class="card"><h1>{{ profile.nickname }}</h1><p>{{ profile.bio || '暂无简介' }}</p><p class="muted">{{ profile.region }}</p></article></section></template>
