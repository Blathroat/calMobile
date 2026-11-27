/**
 * 首页页面测试的共享挂载。
 *
 * 只抽「每个 home-*.test.ts 都要写一遍」的部分：挂载外壳、内存路由、容器清理与 flush。
 * `vi.mock` 仍留在各测试文件里（hoist 只对当前文件生效），这样 mock 差异仍由用例自己声明。
 */
import { createApp, h, nextTick, type App } from 'vue';
import { createPinia, setActivePinia } from 'pinia';
import { createMemoryHistory, createRouter } from 'vue-router';
import HomePage from './HomePage.vue';
import { navigation } from '@/app/navigation';
import { useBootstrapStore } from '@/stores/bootstrap';
import { useSessionStore } from '@/stores/session';

const mounted: App[] = [];

/** 等微任务与重渲染跑完。 */
export async function flush(): Promise<void> {
  for (let index = 0; index < 8; index += 1) await Promise.resolve();
  await nextTick();
}

/** 挂载首页：返回新容器；用例结束用 `unmountHomePages()` 统一卸载。 */
export async function mountHomePage(options: { loggedIn?: boolean } = {}): Promise<HTMLElement> {
  const pinia = createPinia();
  setActivePinia(pinia);
  // 首屏等启动数据落定才显示提示与安装引导：测试里直接标「已拿到」。
  useBootstrapStore().apply();
  if (options.loggedIn) {
    useSessionStore().applyUser({ id: 'u1', username: 'user', loggedIn: true, can: {} });
  }
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [{ path: '/:pathMatch(.*)*', component: HomePage }],
  });
  router.beforeEach(() => {
    navigation.begin();
  });
  await router.push('/home');
  const container = document.createElement('div');
  document.body.appendChild(container);
  const app = createApp({ render: () => h(HomePage) })
    .use(pinia)
    .use(router);
  app.mount(container);
  mounted.push(app);
  await flush();
  return container;
}

/** 卸载本次测试挂过的所有首页实例（多个用例共用一份模块状态，必须清干净）。 */
export function unmountHomePages(): void {
  for (const app of mounted.splice(0)) app.unmount();
}
