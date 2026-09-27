import { createApp } from 'vue';
import { createPinia } from 'pinia';
import App from '@/app/App.vue';
import { router } from '@/app/router';
import { bootApp } from '@/app/runtime';
import { useSessionStore } from '@/stores/session';
import '@/styles/tokens.css';
import '@/styles/motion.css';

createApp(App)
  .use(createPinia())
  .use(router)
  .mount('#app');

/**
 * 首帧**不等** bootstrap：bootstrap 是一次远端请求，等它会把启动拖成白屏。
 * 先按已知状态渲染入口页（未登录时是登录页），数据落定后再纠正一次入口：
 * 服务端说已登录、而首帧停在登录页时，替换历史跳到首页（不新增返回栈）。
 * 失败时登录页照常可用，连接问题在提交表单时就地报错。
 */
void bootApp()
  .then(() => {
    const session = useSessionStore();
    const current = router.currentRoute.value;
    if (!session.loggedIn) return;
    if (current.path !== '/login' && current.path !== '/') return;
    const redirect = typeof current.query.redirect === 'string' ? current.query.redirect : '';
    void router.replace(redirect || '/home');
  })
  .catch((error: unknown) => {
    console.error('bootstrap failed', error);
  });
