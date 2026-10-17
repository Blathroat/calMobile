/**
 * 本机的一条「上次离开时是登录态」提示。
 *
 * 只解决一件事：整页重载（切换语言、安装语言包）后，令牌还在设备存储里、但首帧
 * **会话还没恢复**，此时 `session.loggedIn === false`，路由守卫会把 `requiresAuth` 页面
 * 误判成未登录，把用户甩到登录页闪一下。守卫凭这条提示先 `await bootApp()` 恢复会话，
 * 再按真实状态判定。
 *
 * **它不是身份依据**，也不能当身份依据用：
 * - 不参与任何鉴权判定（权限、角色仍然只看后端响应）；
 * - 值为假、读不到、存储不可用时，行为与没有这条提示完全一致（照旧跳登录页）；
 * - 只表示「上次离开时本机存着登录态」，换号、退出、令牌被拒都会由 `SessionClient` 抹掉。
 *
 * 读写都吞掉异常：隐私模式禁用本机存储时，最坏结果只是闪一下登录页。
 */
const HINT_KEY = 'calmobile.session.hint';

function storage(): Storage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}

/** 会话建立（登录、换号、冷启动恢复）后记下提示。 */
export function rememberSession(): void {
  try {
    storage()?.setItem(HINT_KEY, '1');
  } catch {
    // 写不进去只是没有这条提示，不影响本次会话。
  }
}

/** 退出登录、令牌失效或用户主动清会话后抹掉提示。 */
export function forgetSession(): void {
  try {
    storage()?.removeItem(HINT_KEY);
  } catch {
    // 读不到存储时本来也没有提示。
  }
}

/**
 * 本机是否留着登录态提示。
 * @returns 上次离开时是登录态，且本机存储可读时为 true；其余情况一律 false
 */
export function hasRememberedSession(): boolean {
  try {
    return storage()?.getItem(HINT_KEY) === '1';
  } catch {
    return false;
  }
}
