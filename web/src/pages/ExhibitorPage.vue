<script setup lang="ts">
/**
 * 屏幕 10 · 展商后台
 * 线框：docs/newUI/remaining-ui.html #screen-exhibitor-backend
 *
 * 卡片上只保留「查看报名」与「编辑展会」两个入口：报名方式、编辑简介与删除展会
 * 都属于展会的配置，统一收进「编辑展会」的二级界面，卡片保持清爽。
 * 顶部提供「核销报名码」，展商在现场扫描用户报名详情里的二维码即可完成核销。
 *
 * 受限账号（`can.limited`）不能发布 / 修改 / 删除展会、不能改报名设置、不能核销，
 * 后端对这些写操作一律 403。入口提前置灰并说明原因，而不是让展商填完表单才吃 403；
 * 受限的展商照样能进后台、查看与审核已有的报名，因此后台本身不封。
 */
import { computed, onMounted } from 'vue';
import { useRouter } from 'vue-router';
import { api } from '@/app/runtime';
import { useAsync } from '@/composables/useAsync';
import { useBootstrapStore } from '@/stores/bootstrap';
import { useSessionStore } from '@/stores/session';
import { toast } from '@/services/toast';
import { statusTone } from '@/services/status';
import AppIcon from '@/components/AppIcon.vue';
import StateBlock from '@/components/StateBlock.vue';
import SkeletonBlock from '@/components/SkeletonBlock.vue';
import MediaBox from '@/components/MediaBox.vue';
import StatusTag from '@/components/StatusTag.vue';
import type { Exhibition } from '@/api/types';
import { t } from '@/i18n';

const router = useRouter();
const bootstrap = useBootstrapStore();
const session = useSessionStore();
const query = useAsync<Exhibition[]>();

const items = computed<Exhibition[]>(() => query.data.value ?? []);
/** 已有内容时刷新只标记忙碌，不清空列表（避免切回本页先闪骨架屏）。 */
const hasContent = computed(() => query.data.value !== undefined);
const limited = computed(() => session.user.can?.limited === true);

/** 卡片上的报名总数：列表里每行都带 registrationCount。 */
const registrationTotal = computed(() => items.value.reduce(
  (sum, item) => sum + (Number(item.registrationCount) || 0),
  0,
));

function load(): void {
  void query.run(() => api.exhibitions.list());
}

/** 新建展会：受限时用同一句提示兜住残留入口。 */
function createExhibition(): void {
  if (limited.value) {
    toast(t('s_19wazv8'), 'error');
    return;
  }
  void router.push('/exhibition-form');
}

/** 编辑已有展会：受限时同样兜一层，别让残留入口绕过置灰。 */
function openExhibitionForm(id: unknown): void {
  if (limited.value) {
    toast(t('s_1wwetl9'), 'error');
    return;
  }
  void router.push(`/exhibition-form/${String(id)}`);
}

/** 核销报名码：受限账号进得去页面也提交不了，入口就在这里挡住。 */
function openCheckin(): void {
  if (limited.value) {
    toast(t('s_14pxh3f'), 'error');
    return;
  }
  void router.push('/checkin');
}

/** 手指按下就先取展会详情，点进详情页时数据通常已经到了。 */
function warm(id: unknown): void {
  if (id === undefined || id === null) return;
  void api.exhibitions.get(String(id)).catch(() => undefined);
}

onMounted(load);
</script>

<template>
  <header class="row" data-between="true">
    <div class="stack" data-gap="sm">
      <span class="eyebrow">{{ bootstrap.brand.en }}</span>
      <h2>{{ t('s_1omalh8') }}</h2>
    </div>
    <button
      class="icon-button"
      data-variant="outlined"
      type="button"
      :aria-label="t('s_zqzoiq')"
      :title="limited ? t('s_14pxh3f') : t('s_zqzoiq')"
      :disabled="limited"
      @click="openCheckin"
    >
      <AppIcon name="check" />
    </button>
  </header>

  <SkeletonBlock v-if="query.loading.value && !hasContent" :rows="3" />

  <StateBlock
    v-else-if="query.error.value && !hasContent"
    tone="error"
    :title="t('s_4e7do4')"
    :description="query.error.value.message"
    :action-label="t('s_lswd2v')"
    @action="load"
  />

  <!-- 空态：受限账号不给「新建展会」入口，只说明原因 -->
  <StateBlock
    v-else-if="items.length === 0"
    icon="briefcase"
    :title="t('s_f4agbb')"
    :description="limited ? t('s_19wazv8') : t('s_1t8d6e3')"
    :action-label="limited ? '' : t('s_p9fllo')"
    @action="createExhibition"
  />

  <template v-else>
    <div class="row" data-between="true">
      <span class="section-label">{{ t('s_15vddzv') }}</span>
      <span class="pill">{{ `${items.length} 个 · ${registrationTotal} 条报名` }}</span>
    </div>

    <div v-if="limited" class="notice" data-tone="accent">
      <strong>{{ t('s_19wazv8') }}</strong>
      <span>{{ t('s_1yv1vu0') }}</span>
    </div>

    <div v-if="query.error.value" class="notice" data-tone="accent">
      <span>{{ query.error.value.message }}</span>
    </div>

    <button
      class="cta ghost"
      type="button"
      :disabled="limited"
      :title="limited ? t('s_14pxh3f') : undefined"
      @click="openCheckin"
    >
      {{ t('s_zqzoiq') }}
    </button>
    <p class="field-hint text-center">{{ t('s_1w3gehu') }}</p>

    <div class="list" data-gap="sm">
      <div v-for="item in items" :key="String(item.id)" class="card">
        <button
          class="row-card"
          type="button"
          data-pressable="true"
          style="border: 0; padding: 0; background: transparent"
          :aria-label="`查看 ${item.title} 详情`"
          @pointerdown="warm(item.id)"
          @click="router.push(`/detail/${item.id}`)"
        >
          <MediaBox :src="String(item.imageUri || '')" class-name="thumb thumb-cover" :alt="String(item.title || '')" />
          <span class="row-copy">
            <strong class="row-title truncate">{{ item.title }}</strong>
            <span class="row-meta">{{ item.dateLabel }} {{ item.time }}</span>
            <span class="row-meta truncate">{{ item.venue }}</span>
            <span class="row-meta">{{ `${item.status} · ${item.registrationCount ?? 0} 条报名` }}</span>
            <span v-if="item.qrEnabled === true" class="row-meta">{{ t('s_1ibqlvv') }}</span>
          </span>
          <StatusTag :text="String(item.modeLabel || '')" :tone="statusTone(String(item.status || ''))" />
        </button>
        <div class="grid-cols-2">
          <button
            class="cta ghost"
            data-size="small"
            type="button"
            @click="router.push(`/review?exhibitionId=${encodeURIComponent(String(item.id))}`)"
          >
            {{ t('s_j8kyoz') }}
          </button>
          <button
            class="cta ghost"
            data-size="small"
            type="button"
            :disabled="limited"
            :title="limited ? t('s_1wwetl9') : undefined"
            @click="openExhibitionForm(item.id)"
          >
            {{ t('s_eutzzb') }}
          </button>
        </div>
      </div>
    </div>

    <button
      class="cta"
      type="button"
      :disabled="limited"
      :title="limited ? t('s_19wazv8') : undefined"
      @click="createExhibition"
    >
      {{ t('s_p9fllo') }}
    </button>
  </template>
</template>
