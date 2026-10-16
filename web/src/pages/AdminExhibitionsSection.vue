<script setup lang="ts">
/**
 * 管理后台「展会」分区。
 *
 * 纯展示 + 事件回抛：取数、防抖、导出与卡片动作都留在 AdminPage。
 */
import AdminExhibitionCard from '@/components/AdminExhibitionCard.vue';
import SkeletonBlock from '@/components/SkeletonBlock.vue';
import StateBlock from '@/components/StateBlock.vue';
import type { Ref } from 'vue';
import type { Exhibition } from '@/api/types';
import { t } from '@/i18n';

defineProps<{
  exhibitions: { data: Ref<Exhibition[] | undefined>; error: Ref<Error | undefined>; loading: Ref<boolean> };
  exhibitionItems: Exhibition[];
  query: string;
}>();
const emit = defineEmits<{ retry: []; search: [value: string]; export: []; changed: [] }>();
</script>

<template>
  <SkeletonBlock v-if="exhibitions.loading.value && exhibitions.data.value === undefined" :rows="3" />
  <StateBlock
    v-else-if="exhibitions.error.value && exhibitions.data.value === undefined"
    tone="error"
    :title="t('common.loadFailed')"
    :description="exhibitions.error.value.message"
    :action-label="t('common.retry')"
    @action="emit('retry')"
  />
  <template v-else>
    <div class="field">
      <label for="admin-exhibition-search">{{ t('admin.exhibitions.search') }}</label>
      <input
        id="admin-exhibition-search"
        class="input"
        type="search"
        autocomplete="off"
        :placeholder="t('admin.exhibitions.searchPlaceholder')"
        @input="emit('search', ($event.target as HTMLInputElement).value)"
      />
    </div>
    <div class="row" data-between="true">
      <span class="section-label">{{ t('admin.exhibitions.all') }}</span>
      <span class="pill">{{ `${exhibitionItems.length} 个展会` }}</span>
    </div>
    <div v-if="exhibitions.error.value" class="notice" data-tone="accent">
      <span>{{ exhibitions.error.value.message }}</span>
    </div>

    <StateBlock
      v-if="exhibitionItems.length === 0"
      icon="search"
      :title="query ? `没有找到与“${query}”相关的展会` : t('admin.exhibitions.empty')"
      :description="query ? t('admin.exhibitions.tryAnotherKeyword') : t('admin.exhibitions.shownWhenCreated')"
    />
    <div v-else class="list" data-gap="sm" :data-busy="exhibitions.loading.value ? 'true' : undefined">
      <AdminExhibitionCard
        v-for="item in exhibitionItems"
        :key="String(item.id)"
        :item="item"
        @changed="emit('changed')"
      />
    </div>

    <button class="cta ghost" type="button" :disabled="exhibitionItems.length === 0" @click="emit('export')">
      {{ t('admin.exhibitions.exportCsv') }}
    </button>
  </template>
</template>
