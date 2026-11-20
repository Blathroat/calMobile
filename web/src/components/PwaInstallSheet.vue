<script setup lang="ts">
/**
 * 「安装到主屏幕」说明抽屉（由 `services/sheet.ts` 的 `openSheet({ component })` 打开）。
 *
 * 两种来路决定底部多不多一颗按钮：
 * - `mode: 'app'`：用户已经在完整应用里，只讲解安装步骤（首页每次进入、设置页入口）；
 * - `mode: 'join'`：用户还在报名站浏览器里，多给一条「打开完整应用」的路。
 *
 * **步骤按平台分**：iOS Safari 用分享面板；iOS 其它浏览器（微信、Chrome 等）先提示换到
 * Safari；Android 走浏览器菜单；桌面等其它平台只给一句「从浏览器菜单安装」。内置浏览器
 * 本身装不上，Android 与桌面额外给一句说明。
 *
 * 复制与打开的地址是**完整应用**入口 `{对外域名}/app/`：加到主屏幕要加到 `/app/` 这一屏，
 * 直接添加当前报名页只会把那一页存成图标。没配对外域名时退回当前域名，保持与其它分享链接
 * 同样的「不猜 127.0.0.1」约定。
 *
 * 面板只负责内容与复制反馈；关闭走 `closeSheet()`，与其它抽屉一致，关闭不记任何状态。
 */
import { computed } from 'vue';
import { useBootstrapStore } from '@/stores/bootstrap';
import { copyText } from '@/services/clipboard';
import { isAndroid, isInAppBrowser, isIos, isIosSafari } from '@/services/platform';
import { closeSheet } from '@/services/sheet';
import { toast } from '@/services/toast';
import { t } from '@/i18n';

defineProps<{ mode: 'app' | 'join' }>();

const bootstrap = useBootstrapStore();
/** 平台与浏览器在页面生命周期里不会变，setup 里各读一次即可。 */
const ios = isIos();
const android = isAndroid();
const inApp = isInAppBrowser();

/** 开头一句说明：iOS 用 Safari 分享面板，Android 用浏览器菜单，其余是桌面浏览器。 */
function installIntro(): string {
  if (ios) return t('pwa.install.intro');
  if (android) return t('pwa.install.androidIntro');
  return t('pwa.install.desktopIntro');
}

/** 分步说明：iOS 三步分享，Android 三步菜单，桌面只有一句。 */
function installSteps(): string[] {
  if (ios) return [t('pwa.install.stepOpen'), t('pwa.install.stepShare'), t('pwa.install.stepAdd')];
  if (android) {
    return [t('pwa.install.androidStepOpen'), t('pwa.install.androidStepMenu'), t('pwa.install.androidStepAdd')];
  }
  return [t('pwa.install.desktopStep')];
}

/** 当前浏览器装不上时的提示：iOS 非 Safari 要换浏览器，内置浏览器在 Android / 桌面上也装不了。 */
function installNotice(): string {
  if (ios) return isIosSafari() ? '' : t('pwa.install.notSafari');
  return inApp ? t('pwa.install.browserNotInstallable') : '';
}

const intro = installIntro();
const steps = installSteps();
const notice = installNotice();
/** 只有一步时单独成段，不加序号圆点。 */
const singleStep = steps.length === 1 ? (steps[0] ?? '') : '';

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
    <p class="pwa-intro">{{ intro }}</p>

    <!-- 装不上时先说清原因：iOS 非 Safari 要换浏览器，内置浏览器要换系统浏览器 -->
    <p v-if="notice" class="notice" data-tone="warn">{{ notice }}</p>

    <!-- 桌面只有一步，不再套序号圆点 -->
    <ol v-if="steps.length > 1" class="pwa-steps">
      <li v-for="step in steps" :key="step">{{ step }}</li>
    </ol>
    <p v-else class="pwa-step-note">{{ singleStep }}</p>

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

/* 桌面只有一条安装说明：不加序号圆点，读起来是一段补充说明 */
.pwa-step-note {
  margin: 0;
  color: var(--ink-2);
  font-size: var(--fs-meta);
  line-height: 1.5;
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
