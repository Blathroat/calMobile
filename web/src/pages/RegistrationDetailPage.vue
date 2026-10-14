<script setup lang="ts">
/**
 * 屏幕 08 · 报名详情
 * 线框：docs/newUI/remaining-ui.html #screen-registration-detail
 *
 * 展商在展会设置里开启「启用报名二维码」后，审核通过的报名会由后端下发报名码，
 * 用户现场出示、展商扫码后状态变为「已参加」；二维码按需加载生成器，画不出来时
 * 就地说明改用手动输入，不让整页失败。
 *
 * 「修改报名」与「撤销报名」固定在页脚：撤销不可逆，走 confirmSheet 二次确认。
 */
import { computed, onMounted, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { api } from '@/app/runtime';
import { useAsync } from '@/composables/useAsync';
import { useBootstrapStore } from '@/stores/bootstrap';
import { toast } from '@/services/toast';
import { confirmSheet } from '@/services/sheet';
import { REGISTRATION_STATUS } from '@/services/status';
import StateBlock from '@/components/StateBlock.vue';
import SkeletonBlock from '@/components/SkeletonBlock.vue';
import StatusTag from '@/components/StatusTag.vue';
import QrCanvas from '@/components/QrCanvas.vue';
import { answerLines, formatRecordDate } from '@/services/format';
import type { Registration, RegistrationDetail } from '@/api/types';
import { paths } from '@/app/surface';
import { t } from '@/i18n';

const route = useRoute();
const router = useRouter();
const bootstrap = useBootstrapStore();

const query = useAsync<RegistrationDetail>();
const record = computed<Registration | undefined>(() => query.data.value?.registration);
const answers = computed(() => answerLines(record.value?.answers));

const cancelled = computed(() => record.value?.statusLabel === REGISTRATION_STATUS.CANCELLED);
/** 已参加是终态：后端不允许再撤销，按钮就不要画成可点的。 */
const attended = computed(() => record.value?.statusLabel === REGISTRATION_STATUS.ATTENDED);
/** 待审核的报名始终可以改；其余状态由管理员的「是否需要重新审核」决定。 */
const canRevise = computed(() => bootstrap.review.canRevise === true || record.value?.statusLabel === REGISTRATION_STATUS.PENDING);

const cancelling = ref(false);
/** 二维码绘制失败的原因：留在二维码旁边说明，同时给出手动输入的退路。 */
const qrError = ref('');

onMounted(() => { void load(); });

async function load(): Promise<void> {
  qrError.value = '';
  await query.run(() => api.registrations.get(String(route.params.id ?? '')));
}

function statusHint(status: unknown): string {
  if (status === REGISTRATION_STATUS.PENDING) return t('s_1te6cde');
  if (status === REGISTRATION_STATUS.APPROVED) {
    return bootstrap.review.canRevise === true ? t('s_i68x11') : t('s_1k42kcd');
  }
  if (status === REGISTRATION_STATUS.ATTENDED) return t('s_1cjrrf7');
  if (status === REGISTRATION_STATUS.CANCELLED) return t('s_h2sz0p');
  return t('s_1bzdeux');
}

function modifyRegistration(): void {
  const item = record.value;
  if (!item) return;
  void router.push({
    path: paths.registrationForm(String(item.exhibitionId)),
    query: { registrationId: item.id },
  });
}

function askCancel(): void {
  const item = record.value;
  if (!item) return;
  confirmSheet({
    title: t('s_1u8rnsb'),
    message: `确定撤销「${item.exhibitionTitle}」的报名吗？撤销后展商将不再审核该记录。`,
    confirmLabel: t('s_zfeh7n'),
    tone: 'danger',
    onConfirm: async () => {
      cancelling.value = true;
      try {
        const result = await api.registrations.cancel(String(item.id));
        if (!result?.ok) {
          toast(String(result?.error || t('s_qqaurb')), 'error');
          return;
        }
        // 撤销是服务端已经完成的终态，就地更新本页状态与页脚；
        // 不重新取数：`registrations.get` 的缓存键（`registration:…`）不在 cancel 的失效前缀里。
        item.statusLabel = REGISTRATION_STATUS.CANCELLED;
        item.status = REGISTRATION_STATUS.CANCELLED;
        toast(t('s_xf7p1v'), 'success');
      } catch (reason) {
        toast(reason instanceof Error ? reason.message : String(reason), 'error');
      } finally {
        cancelling.value = false;
      }
    },
  });
}
</script>

<template>
  <SkeletonBlock v-if="query.loading.value && !query.data.value" :rows="3" />

  <StateBlock
    v-else-if="query.error.value && !query.data.value"
    tone="error"
    :title="t('s_kvpltc')"
    :description="query.error.value.message"
    :action-label="t('s_lswd2v')"
    @action="load"
  />

  <!-- 报名可能刚被撤销或删除：说明原因并返回列表，重试没有意义 -->
  <StateBlock
    v-else-if="!record"
    tone="error"
    icon="info"
    :title="t('s_18st7j')"
    :description="String(query.data.value?.error || t('s_11prq8e'))"
    :action-label="t('s_qr7208')"
    @action="router.push(paths.registrations)"
  />

  <template v-else>
    <div class="card" data-tone="fill">
      <strong>{{ record.exhibitionTitle }}</strong>
      <span class="row-meta">{{ formatRecordDate(record) }} {{ record.exhibitionTime }}</span>
      <span class="row-meta">{{ record.exhibitionVenue }}</span>
    </div>

    <div class="card">
      <span class="section-label">{{ t('s_vrp4t3') }}</span>
      <div class="stack" data-gap="sm">
        <div class="row" data-between="true">
          <span class="row-meta">{{ t('s_33njx3') }}</span>
          <span class="strong truncate">{{ record.visitorName || '—' }}</span>
        </div>
        <div class="row" data-between="true">
          <span class="row-meta">{{ t('s_yz0sc5') }}</span>
          <span class="strong truncate">{{ record.visitorType || '—' }}</span>
        </div>
        <template v-if="answers.length > 0">
          <div v-for="(line, index) in answers" :key="`${line.label}-${index}`" class="row" data-between="true">
            <span class="row-meta">{{ line.label || t('s_otl7kf') }}</span>
            <span class="strong">{{ line.value || '—' }}</span>
          </div>
        </template>
        <div v-else class="row" data-between="true">
          <span class="row-meta">{{ t('s_otl7kf') }}</span>
          <span class="strong">{{ t('s_v8pba2') }}</span>
        </div>
      </div>
    </div>

    <div class="card">
      <span class="section-label">{{ t('s_c6rjk') }}</span>
      <div class="row" data-gap="md">
        <StatusTag :text="String(record.statusLabel || '')" />
        <span class="row-meta">{{ statusHint(record.statusLabel) }}</span>
      </div>
    </div>

    <!-- 报名码：只有后端下发了 checkInCode（已通过 / 已参加且展商启用二维码）才渲染 -->
    <div v-if="record.checkInCode" class="card">
      <div class="row" data-between="true">
        <span class="section-label">{{ t('s_w5wyci') }}</span>
        <StatusTag :text="attended ? t('s_107xpf9') : t('s_1qk0zaw')" :tone="attended ? 'ok' : 'pending'" />
      </div>
      <div class="qr-wrap">
        <QrCanvas
          :text="String(record.checkInCode)"
          :size="480"
          :label="t('s_16uw4a2')"
          @error="qrError = $event"
        />
      </div>
      <code class="qr-code-text">{{ record.checkInCode }}</code>
      <!-- 只在二维码画不出来时说明退路（让展商手动输入上方报名码），正常情况不再堆一句提示 -->
      <p v-if="qrError" class="field-hint text-center">{{ `${qrError}，可让展商手动输入上方报名码。` }}</p>
    </div>
  </template>

  <!-- 底部固定操作区：修改报名 + 撤销报名 -->
  <Teleport v-if="record" defer to="#app-foot">
    <div class="page-foot">
      <div class="stack" data-gap="sm">
        <div class="grid-cols-2">
          <button
            class="cta ghost"
            type="button"
            :disabled="cancelled || !canRevise || cancelling"
            @click="modifyRegistration"
          >
            {{ t('s_ebndq6') }}
          </button>
          <button
            class="cta danger"
            type="button"
            :disabled="cancelled || attended || cancelling"
            @click="askCancel"
          >
            {{ cancelled ? REGISTRATION_STATUS.CANCELLED : (attended ? REGISTRATION_STATUS.ATTENDED : t('s_1u8rnsb')) }}
          </button>
        </div>
        <p class="field-hint text-center">
          {{ cancelled ? t('s_ex1lrt') : (attended ? t('s_2vsxvu') : t('s_131vhix')) }}
        </p>
      </div>
    </div>
  </Teleport>
</template>
