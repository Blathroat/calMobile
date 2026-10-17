<script setup lang="ts">
/**
 * 应用外壳：顶栏 + 可滚动内容区 + 底部导航（或页面页脚）。
 *
 * 结构与 `styles/tokens.css` 的 `.app` 网格一一对应，页面只往内容区放内容：
 * - 顶栏标题、返回键与底部导航项由路由 meta 决定（见 `app/shell.ts`）；
 * - 页面需要固定操作区时用 `Teleport to="#app-foot"`，它落在网格的第三行；
 * - 轻提示与底部面板是全局的，每个页面都不用自己挂载容器。
 */
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { RouterView, useRoute, useRouter } from 'vue-router';
import AppTopBar from '@/components/AppTopBar.vue';
import AppIcon from '@/components/AppIcon.vue';
import AppTabBar from '@/components/AppTabBar.vue';
import AppToasts from '@/components/AppToasts.vue';
import AppSheet from '@/components/AppSheet.vue';
import { bodyAttrs, tabItems } from '@/app/shell';
import { paths } from '@/app/surface';
import { navigation } from '@/app/navigation';
import { preloadTabs, resetPreload } from '@/app/preload';
import { bindPullGesture, pullDragging, pullOffset, pullSettling, pullSpinning } from '@/services/pull-refresh';
import { api } from '@/app/runtime';
import { closeSheet, confirmSheet, sheet } from '@/services/sheet';
import { toast } from '@/services/toast';
import { watchSystemMode } from '@/app/theme';
import { useBootstrapStore } from '@/stores/bootstrap';
import { useSessionStore } from '@/stores/session';
import { t } from '@/i18n';

const route = useRoute();
const router = useRouter();
const session = useSessionStore();
const bootstrap = useBootstrapStore();

const items = computed(() => tabItems(session.user.can));
const showTabs = computed(() => route.meta.tab !== undefined);
const title = computed(() => (typeof route.meta.title === 'string' ? t(route.meta.title) : ''));
const topAction = computed(() => route.meta.topAction);
const attrs = computed(() => bodyAttrs(route.meta));
const logoutBusy = ref(false);
const bodyEl = ref<HTMLElement>();
const showPull = computed(() => pullDragging.value || pullOffset.value > 0 || pullSpinning.value || pullSettling.value);
/** 内容下移。滑出到 0 时仍留着 transform，过渡才播得完。 */
const pullShift = computed(() => {
  if (!pullSettling.value && pullOffset.value <= 0) return undefined;
  return { transform: `translate3d(0, ${pullOffset.value}px, 0)` };
});
/** 圈放在内容让开的空隙里，不跟内容一起被推出屏幕。 */
const indicatorShift = computed(() => {
  if (!pullSettling.value && pullOffset.value <= 0 && !pullDragging.value) return undefined;
  return { transform: `translate3d(0, ${pullOffset.value - 30}px, 0)` };
});
let unbindPull: (() => void) | undefined;

function onTopAction(): void {
  const action = topAction.value;
  if (!action) return;
  if (action.action === 'logout') {
    confirmSheet({
      title: t('profile.logout'),
      message: t('app.logoutMessage'),
      confirmLabel: t('profile.logout'),
      tone: 'danger',
      onConfirm: async () => {
        if (logoutBusy.value) return;
        logoutBusy.value = true;
        try {
          await api.auth.logout();
          session.clear();
          toast(t('profile.loggedOut'));
          await router.replace('/login');
        } catch (reason) {
          toast(reason instanceof Error ? reason.message : String(reason), 'error');
        } finally {
          logoutBusy.value = false;
        }
      },
    });
    return;
  }
  if (action.to) void router.push(action.to);
}

/**
 * 启动数据落定、以及身份变化（登录 / 退出 / 换号）之后，重新热身底部导航那几个页面。
 * 放在外壳里而不是每个页面里：缓存被 `afterAuth` 清空的时机只有外壳看得全。
 */
watch(
  () => [bootstrap.booted, session.loggedIn, session.role].join('|'),
  () => {
    if (!bootstrap.booted) return;
    resetPreload();
    preloadTabs();
  },
  { immediate: true },
);

/** 会话续期被认证端拒绝后立即回登录页，并带回用户原本所在地址。 */
watch(
  () => session.expired,
  (expired) => {
    if (!expired || route.path === '/login') return;
    void router.replace({
      path: '/login',
      query: { redirect: route.fullPath, expired: '1' },
    });
  },
  { flush: 'sync' },
);

/**
 * 换页时收起底部面板：面板属于上一屏（报名详情、状态选择、手动输入报名码），
 * 跟着路由留在新页面上会盖住正文——底部面板是全局挂载的，只有外壳看得全这次切换。
 */
watch(
  () => route.fullPath,
  () => {
    if (sheet.current) closeSheet();
  },
);

onMounted(() => {
  watchSystemMode();
  if (bodyEl.value) unbindPull = bindPullGesture(bodyEl.value);
});
onBeforeUnmount(() => unbindPull?.());
</script>

<template>
  <div
    class="app"
    :data-nav="showTabs ? 'bottom' : 'none'"
    :data-direction="navigation.direction.value"
    :data-tab-move="navigation.tabMove.value === 'none' ? undefined : navigation.tabMove.value"
  >
    <!-- 页脚槽写在最前面：页面用 Teleport 投递固定操作区，目标必须已经存在。
         它在网格里的位置由 tokens.css 固定到第三行。 -->
    <div id="app-foot" class="app-foot" />
    <AppTopBar :title="title" :show-back="route.meta.back === true" :back-to="paths.home">
      <template #actions>
        <!-- 页面级操作由路由 meta 声明（例如个人页右上角的「设置」入口），
             页面组件不用为了一个图标去改外壳。详情页的分享按钮投递到 #app-top-actions。 -->
        <div id="app-top-actions" />
        <button
          v-if="topAction"
          class="icon-button"
          type="button"
          :aria-label="t(topAction.label)"
          :title="t(topAction.label)"
          @click="onTopAction"
        >
          <AppIcon :name="topAction.icon" />
        </button>
      </template>
    </AppTopBar>
    <main
      ref="bodyEl"
      class="app-body"
      v-bind="attrs"
      :data-pulling="pullDragging ? 'true' : undefined"
      :data-pull-settle="pullSettling ? 'true' : undefined"
    >
      <div class="pull-indicator" :data-on="showPull ? 'true' : undefined" :style="indicatorShift">
        <span class="pull-spinner" :data-spin="pullSpinning ? 'true' : undefined" />
        <span class="sr-only">{{ showPull ? t('common.refreshing') : t('common.pullRefresh') }}</span>
      </div>
      <RouterView v-slot="{ Component }">
        <!-- 单独一层承载页面切换动画：`.app-body` 在切换之间是同一个元素，
             动画需要挂在每次都重建的节点上。
             键用 `fullPath`，所以换 query（例如管理页的 `?tab=`）也会重建页面；
             页面自己 watch query 完成切换的（`meta.queryInPlace`）则只认 path，
             免得为了换一个分区把整页重新挂载、数据重新取一遍。
             下拉时的位移只在 offset > 0 时写 inline transform，避免盖住页面切换动画。 -->
        <div
          :key="route.meta.queryInPlace === true ? route.path : route.fullPath"
          class="route-enter page-surface"
          :style="pullShift"
        >
          <component :is="Component" />
        </div>
      </RouterView>
    </main>
    <AppTabBar v-if="showTabs" :items="items" />
    <AppToasts />
    <AppSheet />
  </div>
</template>
