<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { useRouter } from 'vue-router';
import { api } from '@/app/runtime';
import { useBootstrapStore } from '@/stores/bootstrap';
import { useAsync } from '@/composables/useAsync';
import type { JsonObject } from '@/api/types';
const router = useRouter(); const bootstrap = useBootstrapStore(); const now = new Date();
const year = ref(now.getFullYear()); const month = ref(now.getMonth() + 1); const selectedDay = ref(0); const monthData = useAsync<JsonObject>();
const items = computed(() => Array.isArray(monthData.data.value?.selected) ? monthData.data.value.selected as JsonObject[] : []);
const eventDays = computed(() => Array.isArray(monthData.data.value?.eventDays) ? monthData.data.value.eventDays as number[] : []);
const loadError = computed(() => monthData.error.value?.message ?? '加载失败');
async function load() { await monthData.run(() => api.exhibitions.month({ year: year.value, month: month.value, day: selectedDay.value || undefined })); }
function shift(delta: number) { const next = new Date(year.value, month.value - 1 + delta, 1); year.value = next.getFullYear(); month.value = next.getMonth() + 1; selectedDay.value = 0; void load(); }
function selectDay(day: number) { selectedDay.value = day; void load(); }
onMounted(load);
</script>
<template>
  <section class="page"><header class="topbar"><div><p class="eyebrow">{{ bootstrap.brand.en }}</p><h1>{{ bootstrap.brand.zh }}</h1></div><button class="icon-button" @click="router.push('/profile')">个人</button></header>
    <div class="month-nav"><button @click="shift(-1)">‹</button><strong>{{ year }} 年 {{ month }} 月</strong><button @click="shift(1)">›</button></div>
    <div v-if="monthData.loading" class="state">正在加载展会…</div><div v-else-if="monthData.error.value" class="state error">{{ loadError }} <button @click="load">重试</button></div>
    <template v-else><p class="muted">本月 {{ eventDays.length }} 个有展会的日期</p><div class="day-list"><button v-for="day in eventDays" :key="day" :aria-pressed="selectedDay === day" @click="selectDay(day)">{{ day }} 日</button></div><section class="list"><button v-for="item in items" :key="String(item.id)" class="row-card" @click="router.push(`/detail/${item.id}`)"><strong>{{ item.title }}</strong><span>{{ item.venue }}</span><span>{{ item.time }}</span></button><p v-if="items.length === 0" class="state">当天没有展会</p></section></template>
  </section>
</template>
