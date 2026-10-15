<script setup lang="ts">
/**
 * 私人会议申请列表。
 *
 * 展商和报名管理一样：点头像去公开页，点卡片其他地方打开详情抽屉。
 * 待审核卡片始终是「通过 / 拒绝」；审完后只留一颗「查看详情」，再改状态从抽屉里进。
 * 被限制的会议，主办人的通过和拒绝不可点。管理员的限制和删除也在抽屉里。
 * 展商页先写「收到的申请」，再放设置按钮。分享地址在底部一行，右侧是小复制图标。
 */
import { computed, onMounted, watch } from 'vue';
import { useRouter } from 'vue-router';
import { api } from '@/app/runtime';
import { useAsync } from '@/composables/useAsync';
import { useBootstrapStore } from '@/stores/bootstrap';
import { useSessionStore } from '@/stores/session';
import { toast } from '@/services/toast';
import { confirmSheet, openSheet } from '@/services/sheet';
import type { SheetAction } from '@/services/sheet';
import { meetingLink } from '@/services/registration-link';
import { statusTone } from '@/services/status';
import { answerLines, formatMeetingWhen, truncate } from '@/services/format';
import StateBlock from '@/components/StateBlock.vue';
import SkeletonBlock from '@/components/SkeletonBlock.vue';
import StatusTag from '@/components/StatusTag.vue';
import RoleTag from '@/components/RoleTag.vue';
import AppIcon from '@/components/AppIcon.vue';
import RegistrationDetailSheet from '@/components/RegistrationDetailSheet.vue';
import type { JsonObject } from '@/api/types';
import { t } from '@/i18n';

const props = defineProps<{
  mode: 'exhibitor' | 'admin';
  exhibitorId?: string;
}>();

const router = useRouter();
const bootstrap = useBootstrapStore();
const session = useSessionStore();
const query = useAsync<JsonObject>();

const data = computed(() => query.data.value);
const records = computed<JsonObject[]>(() => (Array.isArray(data.value?.records) ? data.value.records as JsonObject[] : []));
const hasRecords = computed(() => data.value !== undefined);
const pendingCount = computed(() => records.value.filter((record) => String(record.status || '') === '待审核').length);
const exhibitorId = computed(() => String(
  data.value?.exhibitorId || props.exhibitorId || (props.mode === 'exhibitor' ? session.user.id : '') || '',
));
const link = computed(() => meetingLink(bootstrap.publicBaseUrl, exhibitorId.value));

const COPY = {
  settings: t('s_1k704n3'),
  section: t('s_1361yrb'),
  empty: t('s_18jitmg'),
  lockedHint: t('s_jpofr2'),
  lock: t('s_17lo3mv'),
  unlock: t('s_1mj72e8'),
  remove: t('s_pxrfjx'),
  approve: t('s_j666m6'),
  reject: t('s_1qrntx4'),
  detail: t('s_ox3r68'),
  adjust: t('s_4hlup6'),
  close: t('s_g0fanx'),
  copy: t('s_1xbipwq'),
  missing: t('s_18o1cfv'),
  copied: t('s_4396rd'),
  statusTitle: t('s_ung7fv'),
  deleteTitle: t('s_pxrfjx'),
  visitorFallback: t('s_1in002o'),
};

function load(): void {
  const id = props.mode === 'admin' ? String(props.exhibitorId || '') : '';
  void query.run(() => api.meetings.inbox(id ? { exhibitorId: id } : {}));
}

onMounted(load);
watch(() => props.exhibitorId, () => {
  if (props.mode === 'admin') load();
});

function summary(record: JsonObject): string {
  return truncate(record.answers, 34) || t('s_1ye52vk');
}

function reviewed(record: JsonObject): boolean {
  const status = String(record.status || '');
  return status === '已通过' || status === '已拒绝' || status === '已撤销';
}

function canChange(record: JsonObject): boolean {
  if (props.mode === 'admin') return true;
  return record.locked !== true;
}

function openProfile(record: JsonObject): void {
  const id = String(record.visitorId || '');
  if (!id) return;
  const nickname = String(record.visitorName || 'user');
  void router.push({
    path: `/user-public/${encodeURIComponent(nickname)}`,
    query: { userId: id },
  });
}

async function changeStatus(record: JsonObject, status: string): Promise<void> {
  try {
    await api.meetings.setStatus(String(record.id), status);
    toast(t('s_19ouzm0'), 'success');
    load();
  } catch (reason) {
    toast(reason instanceof Error ? reason.message : String(reason), 'error');
  }
}

function askStatus(record: JsonObject): void {
  const name = String(record.visitorName || COPY.visitorFallback);
  openSheet({
    title: COPY.statusTitle,
    message: `为「${name}」的私人会议选择通过或拒绝。`,
    layout: 'stack',
    actions: [
      { label: COPY.approve, onClick: (close) => { close(); void changeStatus(record, '已通过'); } },
      { label: COPY.reject, onClick: (close) => { close(); void changeStatus(record, '已拒绝'); } },
    ],
  });
}

function openDetail(record: JsonObject): void {
  const answers = answerLines(record.answers);
  const actions: SheetAction[] = [];
  if (canChange(record)) {
    actions.push({
      label: COPY.adjust,
      variant: 'primary',
      onClick: (close) => {
        close();
        askStatus(record);
      },
    });
  }
  if (props.mode === 'admin') {
    actions.push({
      label: record.locked === true ? COPY.unlock : COPY.lock,
      onClick: (close) => {
        close();
        void toggleLock(record);
      },
    });
    actions.push({
      label: COPY.remove,
      variant: 'danger',
      onClick: (close) => {
        close();
        askDelete(record);
      },
    });
  }
  actions.push({ label: COPY.close, onClick: (close) => close() });
  const when = formatMeetingWhen(record.meetingDate, record.meetingTime);
  openSheet({
    title: String(record.visitorName || COPY.visitorFallback),
    size: 'full',
    component: RegistrationDetailSheet,
    props: {
      status: String(record.status || ''),
      statusTone: statusTone(String(record.status || '')),
      registrationTime: when,
      answers: answers.map((line) => ({
        label: line.label || t('s_otl7kf'),
        value: line.value || '—',
      })),
      hint: canChange(record) ? '' : COPY.lockedHint,
    },
    actions,
  });
}

async function toggleLock(record: JsonObject): Promise<void> {
  const locked = record.locked !== true;
  try {
    await api.meetings.setLock(String(record.id), locked);
    toast(locked ? t('s_ptv6uh') : t('s_pfnsj4'), 'success');
    load();
  } catch (reason) {
    toast(reason instanceof Error ? reason.message : String(reason), 'error');
  }
}

function askDelete(record: JsonObject): void {
  const name = String(record.visitorName || COPY.visitorFallback);
  confirmSheet({
    title: COPY.deleteTitle,
    message: `删除「${name}」的私人会议后无法恢复。`,
    confirmLabel: COPY.remove,
    tone: 'danger',
    onConfirm: async () => {
      try {
        await api.meetings.remove(String(record.id));
        toast(t('s_1pmufjh'), 'success');
        load();
      } catch (reason) {
        toast(reason instanceof Error ? reason.message : String(reason), 'error');
      }
    },
  });
}

async function copyLink(): Promise<void> {
  if (!link.value) {
    toast(COPY.missing, 'error');
    return;
  }
  try {
    await navigator.clipboard.writeText(link.value);
    toast(COPY.copied);
  } catch {
    openSheet({
      title: COPY.copy,
      message: link.value,
      actions: [{ label: t('s_1589w37'), onClick: (close) => close() }],
    });
  }
}
</script>

<template>
  <div v-if="mode === 'exhibitor'" class="row" data-between="true">
    <span class="section-label">{{ COPY.section }}</span>
    <span v-if="hasRecords" class="pill">{{ `待审核 ${pendingCount} · 共 ${records.length} 条` }}</span>
  </div>
  <button
    v-if="mode === 'exhibitor'"
    class="cta ghost"
    type="button"
    @click="router.push('/meeting-settings')"
  >
    {{ COPY.settings }}
  </button>

  <SkeletonBlock v-if="query.loading.value && !hasRecords" :rows="3" />
  <StateBlock
    v-else-if="query.error.value && !hasRecords"
    tone="error"
    :title="t('s_kvpltc')"
    :description="query.error.value.message"
    :action-label="t('s_lswd2v')"
    @action="load"
  />
  <template v-else>
    <div v-if="query.error.value" class="notice" data-tone="accent">
      <span>{{ query.error.value.message }}</span>
    </div>
    <StateBlock v-if="records.length === 0" icon="ticket" :title="COPY.empty" />
    <div v-else class="list" data-gap="sm" :data-busy="query.loading.value ? 'true' : undefined">
      <div v-for="record in records" :key="String(record.id)" class="card">
        <div class="row" data-gap="md">
          <button
            v-if="record.visitorId"
            class="avatar"
            type="button"
            :aria-label="`查看 ${record.visitorName} 的公开页`"
            @click="openProfile(record)"
          >
            {{ String(record.visitorName || '用').slice(0, 1) }}
          </button>
          <span v-else class="avatar" aria-hidden="true">{{ String(record.visitorName || '用').slice(0, 1) }}</span>
          <button
            class="row-card"
            type="button"
            data-pressable="true"
            style="flex: 1 1 auto; min-width: 0; border: 0; padding: 0; background: transparent"
            :aria-label="`查看 ${record.visitorName} 的会议详情`"
            @click="openDetail(record)"
          >
            <span class="row-copy">
              <span class="name-line">
                <strong class="row-title">{{ record.visitorName }}</strong>
                <RoleTag :role-code="String(record.visitorRole || '')" />
              </span>
              <span class="row-meta">{{ formatMeetingWhen(record.meetingDate, record.meetingTime) }}</span>
              <span class="row-meta truncate">{{ summary(record) }}</span>
            </span>
            <StatusTag :text="String(record.status || '')" :tone="statusTone(String(record.status || ''))" />
          </button>
        </div>

        <div v-if="reviewed(record)" class="action-row">
          <button class="cta ghost" data-size="small" type="button" @click="openDetail(record)">{{ COPY.detail }}</button>
        </div>
        <template v-else>
          <div class="action-row">
            <button
              class="cta"
              data-size="small"
              type="button"
              :disabled="!canChange(record)"
              @click="changeStatus(record, '已通过')"
            >
              {{ COPY.approve }}
            </button>
            <button
              class="cta ghost"
              data-size="small"
              type="button"
              :disabled="!canChange(record)"
              @click="changeStatus(record, '已拒绝')"
            >
              {{ COPY.reject }}
            </button>
          </div>
          <p v-if="!canChange(record)" class="field-hint">{{ COPY.lockedHint }}</p>
        </template>
      </div>
    </div>
  </template>

  <Teleport defer to="#app-foot">
    <div class="page-foot" data-compact="true">
      <div class="copy-line">
        <span class="row-meta truncate">{{ link || COPY.missing }}</span>
        <button class="icon-hit" type="button" :aria-label="COPY.copy" @click="copyLink">
          <AppIcon name="copy" size="icon icon-sm" />
        </button>
      </div>
    </div>
  </Teleport>
</template>
