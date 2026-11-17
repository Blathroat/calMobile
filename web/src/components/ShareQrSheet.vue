<script setup lang="ts">
/**
 * 「分享展会」抽屉：白底卡片上展示报名二维码、展会名称与报名链接，底部「保存到本地」。
 *
 * 二维码内容由调用方拼好（`services/registration-link.ts` 的 `registrationLink`）；
 * 没配报名站地址时调用方直接提示、不会打开本抽屉，所以这里默认 `text` 非空。
 *
 * 导出的是**透明背景 + 黑色点**的 PNG：白底只属于展示容器，不画进画布，
 * 保存到相册或转发后在聊天、文档里都不会带一块白板。保存走原生相册
 * （`device.saveImage`）；浏览器预览里没有原生桥，退回浏览器下载，与报名码
 * 长按保存同一套退路。
 *
 * 面板只负责内容，关闭由 `ExhibitorPage` 通过 `openSheet` 的 actions 控制。
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
    /** 二维码内容：报名站分享链接，调用方已校验非空。 */
    text: string;
    /** 展会名称，显示在二维码下方。 */
    title?: string;
    /** 保存成图片的文件名；原生只当展示名，落盘名由系统补全。 */
    fileName?: string;
  }>(),
  { title: '', fileName: 'exhibition-qr.png' },
);

const qrRef = ref<InstanceType<typeof QrCanvas> | null>(null);
const qrError = ref('');
const saving = ref(false);

const fileName = computed(() => props.fileName || 'exhibition-qr.png');

/** 浏览器预览里的退路：交给浏览器下载，文件确实落地成 PNG，因此按保存成功提示。 */
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
  // 画布没画出来时不能存一张空白 PNG，还告诉用户保存成功。
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
    // 用户在系统面板里取消按稳定错误码判断，不匹配文案。
    if ((reason as { code?: string } | null)?.code === 'cancelled') return;
    toast(t('share.saveFailed'), 'error');
  } finally {
    saving.value = false;
  }
}
</script>

<template>
  <div class="stack" data-gap="sm">
    <!-- 白底卡片只负责「好扫」：导出的画布本身没有底色，透明 PNG 里只有黑点。 -->
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
    <!-- 两颗按钮并排：保存是主操作，关闭是退路；都放在内容里，不再交给 sheet 的 actions
         叠成两行（面板只有一个内容组件时，动作栏会独占一行）。 -->
    <div class="share-qr-actions">
      <button class="cta ghost" type="button" @click="closeSheet()">{{ t('common.close') }}</button>
      <button class="cta" type="button" :disabled="saving || !!qrError" @click="saveToLocal">
        {{ saving ? t('share.saving') : t('share.save') }}
      </button>
    </div>
  </div>
</template>

<style>
/* 展示用的白底卡片：深色模式下也保持白底，保证相机扫得出来。 */
.share-qr-card {
  display: grid;
  justify-items: center;
  padding: var(--s3);
  border: var(--hairline) solid var(--stroke);
  border-radius: var(--r-card);
  background: #ffffff;
}

/* 抽屉里的二维码是主角：比报名码大一档，窄屏也留得下。 */
.share-qr-card .qr-canvas {
  width: min(220px, 62vw);
  padding: 0;
  border: 0;
  background: transparent;
}

/* 展会名称与链接居中收在二维码下面，长标题最多两行。 */
.share-qr-title {
  color: var(--ink);
  font-size: var(--fs-body);
  font-weight: 700;
  text-align: center;
}

.share-qr-link {
  text-align: center;
}

/* 保存与关闭并排、等宽；窄屏也放得下两枚短按钮。 */
.share-qr-actions {
  display: flex;
  gap: var(--s2);
  margin-top: var(--s1);
}

.share-qr-actions .cta {
  flex: 1 1 0;
  width: auto;
  min-width: 0;
}
</style>
