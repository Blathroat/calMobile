/**
 * 报名站入口。启动顺序与 `src/main.ts` 相同，落点换成「我的报名」。
 * 浏览器没有原生注入。文案表由 `vite.join.config.ts` 在构建时写进页面，`t()` 读 `window.CalMobileStrings`。
 */
import { createApp } from 'vue';
import { createPinia } from 'pinia';
import App from '@/app/App.vue';
import { paths } from '@/app/surface';
import { bootApp } from '@/app/runtime';
import { useSessionStore } from '@/stores/session';
import { router } from '@/join/router';
import '@/styles/tokens.css';
import '@/styles/motion.css';

createApp(App)
  .use(createPinia())
  .use(router)
  .mount('#app');

void bootApp()
  .then(() => {
    const session = useSessionStore();
    const current = router.currentRoute.value;
    if (!session.loggedIn) return;
    if (current.path !== '/login' && current.path !== '/') return;
    const redirect = typeof current.query.redirect === 'string' ? current.query.redirect : '';
    void router.replace(redirect || paths.home);
  })
  .catch((error: unknown) => {
    console.error('bootstrap failed', error);
  });
