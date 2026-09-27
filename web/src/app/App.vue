<script setup lang="ts">
/**
 * 应用外壳：顶栏 + 可滚动内容区 + 底部导航（或页面页脚）。
 *
 * 结构与 `styles/tokens.css` 的 `.app` 网格一一对应，页面只往内容区放内容：
 * - 顶栏标题、返回键与底部导航项由路由 meta 决定（见 `app/shell.ts`）；
 * - 页面需要固定操作区时用 `Teleport to="#app-foot"`，它落在网格的第三行；
 * - 轻提示与底部面板是全局的，每个页面都不用自己挂载容器。
 */
import { computed, onMounted } from 'vue';
import { RouterView, useRoute } from 'vue-router';
import AppTopBar from '@/components/AppTopBar.vue';
import AppTabBar from '@/components/AppTabBar.vue';
import AppToasts from '@/components/AppToasts.vue';
import AppSheet from '@/components/AppSheet.vue';
import { bodyAttrs, tabItems } from '@/app/shell';
import { navigation } from '@/app/navigation';
import { watchSystemMode } from '@/app/theme';
import { useSessionStore } from '@/stores/session';
import { t } from '@/i18n';

const route = useRoute();
const session = useSessionStore();

const items = computed(() => tabItems(session.user.can));
const showTabs = computed(() => route.meta.tab !== undefined);
const title = computed(() => (typeof route.meta.title === 'string' ? t(route.meta.title) : ''));
const attrs = computed(() => bodyAttrs(route.meta));

onMounted(watchSystemMode);
</script>

<template>
  <div class="app" :data-nav="showTabs ? 'bottom' : 'none'" :data-direction="navigation.direction.value">
    <!-- 页脚槽写在最前面：页面用 Teleport 投递固定操作区，目标必须已经存在。
         它在网格里的位置由 tokens.css 固定到第三行。 -->
    <div id="app-foot" class="app-foot" />
    <AppTopBar :title="title" :show-back="route.meta.back === true" />
    <main class="app-body" v-bind="attrs">
      <RouterView v-slot="{ Component }">
        <!-- 单独一层承载页面切换动画：`.app-body` 在切换之间是同一个元素，
             动画需要挂在每次都重建的节点上。 -->
        <div :key="route.fullPath" class="route-enter page-surface">
          <component :is="Component" />
        </div>
      </RouterView>
    </main>
    <AppTabBar v-if="showTabs" :items="items" />
    <AppToasts />
    <AppSheet />
  </div>
</template>
