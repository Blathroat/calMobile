<script setup lang="ts">
/**
 * iOS「安装到主屏幕」说明抽屉（由 `services/sheet.ts` 的 `openSheet({ component })` 打开）。
 *
 * 两种来路决定底部多不多一颗按钮：
 * - `mode: 'app'`：用户已经在完整应用里，只讲解安装步骤（首页一次性提示、设置页入口）；
 * - `mode: 'join'`：用户还在报名站浏览器里，多给一条「打开完整应用」的路。
 *
 * 复制与打开的地址是**完整应用**入口 `{对外域名}/app/`：iOS 的「添加到主屏幕」要加到
 * `/app/` 这一屏，直接添加当前报名页只会把那一页存成图标。没配对外域名时退回当前域名，
 * 保持与其它分享链接同样的「不猜 127.0.0.1」约定。
 *
 * 面板只负责内容与复制反馈；关闭走 `closeSheet()`，与其它抽屉一致。
 */
import { computed } from 'vue';
import { useBootstrapStore } from '@/stores/bootstrap';
import { copyText } from '@/services/clipboard';
import { isIosSafari } from '@/services/platform';
import { closeSheet } from '@/services/sheet';
import { toast } from '@/services/toast';
import { t } from '@/i18n';

defineProps<{ mode: 'app' | 'join' }>();

const bootstrap = useBootstrapStore();
/**
 * 是否是 Safari。非 Safari 的 iOS 浏览器（微信、Chrome 等）没有「添加到主屏幕」，
 * 要先换到 Safari；这一步读一次即可，本机浏览器在页面生命周期里不会变。
 */
const safari = isIosSafari();

/** 完整应用地址：对外域名 + `/app/`（构建的 base）；没有对外域名时用当前域名。 */
const appUrl = computed(() => {
  const base = String(bootstrap.publicBaseUrl ?? '')
    .trim()
    .replace(/\/+$/, '');
  return `${base || window.location.origin}/app/`;
});

/** 复制地址：失败时地址仍显示在面板上，用户可以手动选择。 */
async function copyAppUrl(): Promise<void> {
  const copied = await copyText(appUrl.value);
  toast(copied ? t('pwa.install.copied') : t('pwa.install.copyFailed'), copied ? 'success' : 'error');
}

/** 报名站里的入口：直接跳到完整应用；安装说明在那边也能重复看。 */
function openApp(): void {
  window.location.assign(appUrl.value);
}
</script>

<template>
  <div class="stack" data-gap="sm">
    <p class="pwa-intro">{{ t('pwa.install.intro') }}</p>

    <!-- 非 Safari：先说明要换浏览器，下面三步换过去之后照旧能用 -->
    <p v-if="!safari" class="notice" data-tone="warn">{{ t('pwa.install.notSafari') }}</p>

    <ol class="pwa-steps">
      <li>{{ t('pwa.install.stepOpen') }}</li>
      <li>{{ t('pwa.install.stepShare') }}</li>
      <li>{{ t('pwa.install.stepAdd') }}</li>
    </ol>

    <!-- 完整应用地址：复制失败时还能照着选，不必回到上级页面找入口 -->
    <div class="pwa-address">
      <span class="pwa-url">{{ appUrl }}</span>
      <button class="cta ghost" data-size="small" type="button" @click="copyAppUrl">
        {{ t('pwa.install.copyLink') }}
      </button>
    </div>

    <p class="field-hint">{{ t('pwa.install.loginHint') }}</p>

    <div class="pwa-actions">
      <button class="cta ghost" type="button" @click="closeSheet()">{{ t('pwa.install.close') }}</button>
      <!-- 报名站才需要「回完整应用」；应用里这一屏已经是完整应用 -->
      <button v-if="mode === 'join'" class="cta" type="button" @click="openApp">
        {{ t('pwa.install.openApp') }}
      </button>
    </div>
  </div>
</template>

<style scoped>
.pwa-intro {
  margin: 0;
  color: var(--ink-2);
  font-size: var(--fs-meta);
  line-height: 1.6;
}

/* 安装步骤：左侧序号圆点 + 一行说明，序号只做视觉引导，读屏按普通有序列表读 */
.pwa-steps {
  display: grid;
  gap: var(--s2);
  margin: 0;
  padding: 0;
  list-style: none;
  counter-reset: pwa-step;
}

.pwa-steps > li {
  display: flex;
  align-items: flex-start;
  gap: var(--s2);
  color: var(--ink-2);
  font-size: var(--fs-meta);
  line-height: 1.5;
}

.pwa-steps > li::before {
  counter-increment: pwa-step;
  content: counter(pwa-step);
  flex: none;
  width: 20px;
  height: 20px;
  display: grid;
  place-items: center;
  border-radius: var(--r-pill);
  background: var(--accent-tint);
  border: var(--hairline) solid var(--accent-edge);
  color: var(--accent-ink);
  font-size: var(--fs-tag);
  font-weight: 700;
  line-height: 1;
}

/* 地址一行：等宽显示，长地址允许断行；地址本身可整体选中，复制失败时手动抄 */
.pwa-address {
  display: flex;
  align-items: center;
  gap: var(--s2);
  padding: var(--s2) var(--s3);
  border: var(--hairline) solid var(--stroke);
  border-radius: var(--r-input);
  background: var(--f3);
}

.pwa-url {
  flex: 1 1 auto;
  min-width: 0;
  color: var(--ink-2);
  font-size: var(--fs-meta);
  overflow-wrap: anywhere;
  user-select: all;
  -webkit-user-select: all;
}

.pwa-address .cta {
  flex: none;
  width: auto;
  padding-inline: var(--s3);
}

/* 底部按钮：关闭在左、回应用在右；只有一颗时靠右收口 */
.pwa-actions {
  display: flex;
  gap: var(--s2);
  margin-top: var(--s1);
}

.pwa-actions .cta {
  flex: 1 1 0;
  width: auto;
  min-width: 0;
}
</style>
