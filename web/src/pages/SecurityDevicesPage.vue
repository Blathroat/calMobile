<script setup lang="ts">
/** 已登录设备列表；每一行按设备聚合会话，可以远程撤销单台或全部设备。 */
import { computed, onMounted, ref } from 'vue';
import { usePullRefresh } from '@/services/pull-refresh';
import { useRouter } from 'vue-router';
import { api } from '@/app/runtime';
import { useSessionStore } from '@/stores/session';
import { confirmSheet } from '@/services/sheet';
import AppIcon from '@/components/AppIcon.vue';
import SkeletonBlock from '@/components/SkeletonBlock.vue';
import StateBlock from '@/components/StateBlock.vue';
import { t } from '@/i18n';

interface DeviceSession {
  id: string;
  deviceName: string;
  firstSeen: string;
  lastActive: string;
  current: boolean;
  activeSessions: number;
}

const router = useRouter();
const session = useSessionStore();
const devices = ref<DeviceSession[]>([]);
const loading = ref(true);
const loadError = ref('');
const busyId = ref('');
const allBusy = ref(false);
const notice = ref('');
const copy = {
  deviceRevocationHint: t('security.devices.accessEnds'),
  emptyTitle: t('security.devices.noDevices'),
  emptyDescription: t('security.devices.noSessions'),
  currentDevice: t('security.devices.currentDevice'),
  otherDevice: t('security.devices.otherDevice'),
  revokeThisDevice: t('security.devices.signOutThis'),
  unnamedDevice: t('security.devices.unnamedDevice'),
  unknownDate: t('admin.users.unknown'),
  processing: t('security.devices.processing'),
  revokeDeviceTitle: t('security.devices.signOut'),
  revokedNotice: t('security.devices.signedOut'),
  revokeAllTitle: t('security.devices.signOutAll'),
  revokeAllMessage: t('security.devices.endAllSessions'),
  revokeAllButton: t('security.devices.signOutAll'),
};

const errorText = (reason: unknown): string => (reason instanceof Error ? reason.message : t('auth.register.failed'));
function dateLabel(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return copy.unknownDate;
  return new Intl.DateTimeFormat('zh-CN', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).format(date);
}

async function load(): Promise<void> {
  loading.value = true;
  loadError.value = '';
  try {
    const result = await api.security.sessions();
    devices.value = Array.isArray(result.sessions) ? (result.sessions as DeviceSession[]) : [];
    loadError.value = '';
  } catch (reason) {
    if (devices.value.length === 0) loadError.value = errorText(reason);
    else notice.value = errorText(reason);
  } finally {
    loading.value = false;
  }
}

onMounted(load);

usePullRefresh(
  () => load(),
  computed(() => loading.value && devices.value.length > 0),
);

function signOutLocally(): void {
  api.session.clear();
  session.clear();
  void router.replace('/login');
}

function revokeDevice(device: DeviceSession): void {
  confirmSheet({
    title: copy.revokeDeviceTitle,
    message: t('security.devices.confirmSignOutLine', { name: device.deviceName || copy.unnamedDevice }),
    confirmLabel: copy.revokeDeviceTitle,
    tone: 'danger',
    onConfirm: async () => {
      busyId.value = device.id;
      try {
        const result = await api.security.revokeSession(device.id);
        if (result.ok === false) throw new Error(String(result.error || t('auth.register.failed')));
        if (device.current) signOutLocally();
        else {
          notice.value = copy.revokedNotice;
          await load();
        }
      } catch (reason) {
        notice.value = errorText(reason);
      } finally {
        busyId.value = '';
      }
    },
  });
}

function revokeAll(): void {
  confirmSheet({
    title: copy.revokeAllTitle,
    message: copy.revokeAllMessage,
    confirmLabel: copy.revokeAllButton,
    tone: 'danger',
    onConfirm: async () => {
      allBusy.value = true;
      try {
        const result = await api.security.revokeAllSessions();
        if (result.ok === false) throw new Error(String(result.error || t('auth.register.failed')));
        signOutLocally();
      } catch (reason) {
        notice.value = errorText(reason);
      } finally {
        allBusy.value = false;
      }
    },
  });
}
</script>

<template>
  <SkeletonBlock v-if="loading && devices.length === 0" :rows="3" />
  <StateBlock
    v-else-if="loadError"
    tone="error"
    :title="t('security.profileLoadFailed')"
    :description="loadError"
    :action-label="t('common.retry')"
    @action="load"
  />
  <template v-else>
    <div class="devices-page">
      <!-- 首行说明：下线会立刻结束该设备上的登录 -->
      <p class="notice">{{ copy.deviceRevocationHint }}</p>
      <p v-if="notice" class="notice" data-tone="error" role="alert">{{ notice }}</p>

      <StateBlock v-if="devices.length === 0" :title="copy.emptyTitle" :description="copy.emptyDescription" />

      <!-- 一台设备一条行卡：线框设备图标 + 名称与时间 + 右端砖红下线 -->
      <article v-for="device in devices" :key="device.id" class="row-card device-row">
        <span class="device-icon" aria-hidden="true"><AppIcon name="device" /></span>
        <div class="device-body">
          <div class="device-head">
            <strong class="row-title device-name">{{ device.deviceName || copy.unnamedDevice }}</strong>
            <span v-if="device.current" class="pill">{{ copy.currentDevice }}</span>
          </div>
          <span class="row-meta">{{
            t('security.devices.recentActivityLine', { time: dateLabel(device.lastActive) })
          }}</span>
          <span class="row-meta">{{
            t('security.devices.firstLoginLine', { time: dateLabel(device.firstSeen) })
          }}</span>
          <span v-if="device.activeSessions > 1" class="row-meta">{{
            t('security.devices.activeSessionsLine', { count: device.activeSessions })
          }}</span>
        </div>
        <button
          class="text-action device-action"
          type="button"
          :disabled="busyId === device.id || allBusy"
          @click="revokeDevice(device)"
        >
          {{ busyId === device.id ? copy.processing : copy.revokeThisDevice }}
        </button>
      </article>

      <button
        v-if="devices.length > 0"
        class="cta danger"
        type="button"
        :disabled="allBusy || Boolean(busyId)"
        @click="revokeAll"
      >
        {{ allBusy ? copy.processing : copy.revokeAllButton }}
      </button>
    </div>
  </template>
</template>

<style>
/* 设备页：说明在上，设备逐条排下来，底部是「全部下线」。 */
.devices-page {
  display: flex;
  flex-direction: column;
  gap: var(--s3);
}

/* 一行一台设备：图标 / 名称与时间 / 右端下线，三列。 */
.devices-page .device-row {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr) auto;
  align-items: start;
  gap: var(--s3);
}

/* 设备图标：一枚 40px 的线框圆，和头像同一档视觉重量。 */
.device-icon {
  flex: none;
  width: 40px;
  height: 40px;
  display: grid;
  place-items: center;
  border: var(--hairline) solid var(--stroke);
  border-radius: var(--r-pill);
  background: var(--f3);
  color: var(--ink-2);
}

.device-icon svg {
  width: 18px;
  height: 18px;
}

.device-body {
  display: grid;
  gap: var(--s1);
  min-width: 0;
}

.device-head {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--s2);
  min-width: 0;
}

/* 设备名过长时截断，不把行撑开。 */
.device-name {
  flex: 1 1 auto;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* 下线：右端砖红文字按钮，命中区按 --touch 补齐。 */
.devices-page .device-action {
  align-self: center;
  min-height: var(--touch);
  padding-inline: 0;
  color: var(--danger-ink);
  white-space: nowrap;
}

.devices-page .device-action[disabled] {
  color: var(--ink-3);
  cursor: not-allowed;
}

.devices-page > .cta.danger {
  margin-top: var(--s1);
}
</style>
