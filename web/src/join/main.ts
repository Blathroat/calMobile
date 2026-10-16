/**
 * 报名站入口。启动顺序与 `src/main.ts` 相同，落点换成「我的活动」。
 * 内置中文随这份构建打进页面。报名站不读个人设置里的语言选择。
 */
import { createApp } from 'vue';
import { createPinia } from 'pinia';
// 与 src/main.ts 同一套顺序：tokens.css → 组件样式 → motion.css。
import '@/styles/tokens.css';
import App from '@/app/App.vue';
import { paths } from '@/app/surface';
import { bootApp } from '@/app/runtime';
import { useSessionStore } from '@/stores/session';
import { router } from '@/join/router';
import '@/styles/motion.css';

createApp(App).use(createPinia()).use(router).mount('#app');

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
