/**
 * 前端入口：装配 Vue 应用并挂到 `index.html` 的 `#app` 上。
 *
 * 启动顺序（每一步都有原因，别调换）：
 * 1. 先 `use(createPinia())` 再 `use(router)` —— 路由守卫、`/` 的 redirect、以及每个
 *    store 的首次访问都要读 Pinia 当前实例，Pinia 没先装就会在冷启动直接报错；
 * 2. 同步 `mount('#app')`，**不等** `bootApp()`：bootstrap 是一次远端请求，
 *    等它会把启动拖成白屏，所以先按已知状态（空会话 → 登录页）渲染首帧；
 * 3. mount 之后再异步 `bootApp()`（恢复会话 → 取 bootstrap → 落到各 store），
 *    成功后按下面的规则纠正入口；失败只记日志，登录页照常可用。
 *
 * 全局样式只在这里引一次（`tokens.css` 提供变量、`motion.css` 提供动效），
 * 页面与组件不再自己 import 全局样式。
 */
import { createApp } from 'vue';
import { createPinia } from 'pinia';
import App from '@/app/App.vue';
import { router } from '@/app/router';
import { bootApp } from '@/app/runtime';
import { useSessionStore } from '@/stores/session';
import '@/styles/tokens.css';
import '@/styles/motion.css';

createApp(App).use(createPinia()).use(router).mount('#app');

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
    // 未登录：首帧停在登录页本来就是对的，不需要纠正
    if (!session.loggedIn) return;
    // 只纠正入口页：用户已经跳到别的页面时不要把他拽走
    if (current.path !== '/login' && current.path !== '/') return;
    // 登录页可能带着 redirect（被守卫拦下时写进去的），优先送回原处
    const redirect = typeof current.query.redirect === 'string' ? current.query.redirect : '';
    // 用 replace 而不是 push：登录页不该留在返回栈里，否则返回键会退回登录页
    void router.replace(redirect || '/home');
  })
  .catch((error: unknown) => {
    // 启动失败不阻塞界面：错误只记日志，连接问题在用户提交表单时就地报错
    console.error('bootstrap failed', error);
  });
