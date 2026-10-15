/**
 * 报名站入口。启动顺序与 `src/main.ts` 相同，落点换成「我的活动」。
 * 界面文案随这份构建打进页面，`t()` 直接读 `web/src/i18n/strings.ts`。
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
