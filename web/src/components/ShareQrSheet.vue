<script setup lang="ts">
/**
 * 「分享展会」抽屉：高对比光学白底卡片展示报名二维码，导出透明底黑点 PNG。
 */
import { computed, ref } from 'vue';
import QrCanvas from './QrCanvas.vue';
import { device } from '@/services/device-services';
import { nativeBridge } from '@/services/native-bridge';
import { closeSheet } from '@/services/sheet';
import { toast } from '@/services/toast';
import { t } from '@/i18n';

const props = withDefaults(
  defineProps<{
    text: string;
    title?: string;
    fileName?: string;
  }>(),
  { title: '', fileName: 'exhibition-qr.png' },
);

const qrRef = ref<InstanceType<typeof QrCanvas> | null>(null);
const qrError = ref('');
const saving = ref(false);

const fileName = computed(() => props.fileName || 'exhibition-qr.png');

function download(dataUrl: string): void {
  const link = document.createElement('a');
  link.href = dataUrl;
  link.download = fileName.value;
  document.body.appendChild(link);
  link.click();
  link.remove();
  toast(t('share.saved'), 'success');
}

async function saveToLocal(): Promise<void> {
  if (saving.value) return;
  const dataUrl = qrError.value ? '' : (qrRef.value?.toPngDataUrl() ?? '');
  if (!dataUrl) {
    toast(t('share.saveFailed'), 'error');
    return;
  }
  if (!nativeBridge.hasNative()) {
    download(dataUrl);
    return;
  }
  saving.value = true;
  try {
    const result = await device.saveImage(dataUrl, fileName.value);
    if (result?.saved === false) {
      toast(t('share.saveFailed'), 'error');
      return;
    }
    toast(t('share.saved'), 'success');
  } catch (reason) {
    if ((reason as { code?: string } | null)?.code === 'cancelled') return;
    toast(t('share.saveFailed'), 'error');
  } finally {
    saving.value = false;
  }
}
</script>

<template>
  <div class="stack" data-gap="sm">
    <div class="share-qr-card">
      <QrCanvas
        ref="qrRef"
        :text="props.text"
        :size="480"
        background="transparent"
        foreground="#000000"
        :label="t('share.qrLabel')"
        @error="qrError = $event"
      />
    </div>
    <p v-if="qrError" class="field-hint text-center">{{ t('share.qrErrorHint', { error: qrError }) }}</p>
    <strong v-if="props.title" class="share-qr-title">{{ props.title }}</strong>
    <span class="share-qr-link row-meta truncate">{{ props.text }}</span>
    <p class="field-hint text-center">{{ t('share.hint') }}</p>
    <div class="share-qr-actions">
      <button class="cta ghost" type="button" @click="closeSheet()">{{ t('common.close') }}</button>
      <button class="cta" type="button" :disabled="saving || !!qrError" @click="saveToLocal">
        {{ saving ? t('share.saving') : t('share.save') }}
      </button>
    </div>
  </div>
</template>

<style>
.share-qr-card {
  display: grid;
  justify-items: center;
  padding: var(--s4);
  border: var(--hairline) solid var(--stroke);
  border-radius: var(--r-card);
  background: #ffffff;
}

.share-qr-card .qr-canvas {
  width: min(216px, 60vw);
  padding: 0;
  border: 0;
  background: transparent;
}

.share-qr-title {
  color: var(--ink);
  font-size: var(--fs-sm);
  font-weight: 600;
  text-align: center;
}

.share-qr-link {
  font-family: var(--font-mono);
  font-size: var(--fs-xs);
  text-align: center;
}

.share-qr-actions {
  display: flex;
  gap: var(--s2);
  margin-top: var(--s2);
}

.share-qr-actions .cta {
  flex: 1 1 0;
  width: auto;
  min-width: 0;
}
</style>
