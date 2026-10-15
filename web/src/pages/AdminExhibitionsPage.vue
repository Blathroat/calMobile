<script setup lang="ts">
/**
 * 管理员查看某一位展商或管理员开办的全部展会。
 *
 * 卡片按钮与管理后台「展会」分区相同。
 */
import { computed, onMounted, watch } from 'vue';
import { useRoute } from 'vue-router';
import { api } from '@/app/runtime';
import { useAsync } from '@/composables/useAsync';
import AdminExhibitionCard from '@/components/AdminExhibitionCard.vue';
import StateBlock from '@/components/StateBlock.vue';
import SkeletonBlock from '@/components/SkeletonBlock.vue';
import type { Exhibition } from '@/api/types';
import { t } from '@/i18n';

const route = useRoute();
const exhibitorId = computed(() => String(route.params.exhibitorId ?? ''));
const query = useAsync<Exhibition[]>();
const items = computed(() => query.data.value ?? []);

function load(): void {
  void query.run(() => api.exhibitions.list({ exhibitorId: exhibitorId.value }));
}

onMounted(load);
watch(exhibitorId, load);
</script>

<template>
  <SkeletonBlock v-if="query.loading.value && query.data.value === undefined" :rows="3" />
  <StateBlock
    v-else-if="query.error.value && query.data.value === undefined"
    tone="error"
    :title="t('common.loadFailed')"
    :description="query.error.value.message"
    :action-label="t('common.retry')"
    @action="load"
  />
  <template v-else>
    <div class="row" data-between="true">
      <span class="section-label">{{ t('admin.exhibitions.all') }}</span>
      <span class="pill">{{ `${items.length} 个展会` }}</span>
    </div>
    <StateBlock
      v-if="items.length === 0"
      icon="search"
      :title="t('admin.exhibitions.empty')"
      :description="t('admin.exhibitions.shownWhenCreated')"
    />
    <div v-else class="list" data-gap="sm" :data-busy="query.loading.value ? 'true' : undefined">
      <AdminExhibitionCard
        v-for="item in items"
        :key="String(item.id)"
        :item="item"
        @changed="load"
      />
    </div>
  </template>
</template>
