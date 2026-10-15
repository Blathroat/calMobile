<script setup lang="ts">
/** 已登录设备列表；每一行按设备聚合会话，可以远程撤销单台或全部设备。 */
import { onMounted, ref } from 'vue';
import { useRouter } from 'vue-router';
import { api } from '@/app/runtime';
import { useSessionStore } from '@/stores/session';
import { confirmSheet } from '@/services/sheet';
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
  lastActive: t('security.devices.recentActivity'),
  firstSeen: t('security.devices.firstLogin'),
  activeSessions: t('security.devices.activeSessions'),
  revokeThisDevice: t('security.devices.signOutThis'),
  unnamedDevice: t('security.devices.unnamedDevice'),
  unknownDate: t('admin.users.unknown'),
  processing: t('security.devices.processing'),
  revokeDeviceTitle: t('security.devices.signOut'),
  confirmRevoke: t('security.devices.confirmSignOut'),
  confirmSuffix: t('security.devices.confirmSuffix'),
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
  } catch (reason) {
    loadError.value = errorText(reason);
  } finally {
    loading.value = false;
  }
}

onMounted(load);

function signOutLocally(): void {
  api.session.clear();
  session.clear();
  void router.replace('/login');
}

function revokeDevice(device: DeviceSession): void {
  confirmSheet({
    title: copy.revokeDeviceTitle,
    message: `${copy.confirmRevoke}「${device.deviceName || copy.unnamedDevice}」${copy.confirmSuffix}`,
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
  <SkeletonBlock v-if="loading" :rows="3" />
  <StateBlock
    v-else-if="loadError"
    tone="error"
    :title="t('security.profileLoadFailed')"
    :description="loadError"
    :action-label="t('common.retry')"
    @action="load"
  />
  <template v-else>
    <div class="card stack" data-gap="sm">
      <p class="field-hint">{{ copy.deviceRevocationHint }}</p>
      <p v-if="notice" class="field-error" role="alert">{{ notice }}</p>
      <StateBlock v-if="devices.length === 0" :title="copy.emptyTitle" :description="copy.emptyDescription" />
      <article v-for="device in devices" :key="device.id" class="stack" data-gap="sm">
        <div class="row" data-between="true">
          <div class="row-copy">
            <strong class="row-title">{{ device.deviceName || copy.unnamedDevice }}</strong>
            <span class="row-meta">{{ device.current ? copy.currentDevice : copy.otherDevice }}</span>
          </div>
        </div>
        <div class="stack" data-gap="xs">
          <span class="row-meta">{{ copy.lastActive }}：{{ dateLabel(device.lastActive) }}</span>
          <span class="row-meta">{{ copy.firstSeen }}：{{ dateLabel(device.firstSeen) }}</span>
          <span v-if="device.activeSessions > 1" class="row-meta"
            >{{ device.activeSessions }} {{ copy.activeSessions }}</span
          >
        </div>
        <button
          class="cta ghost"
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
