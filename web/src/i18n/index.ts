/**
 * 文案取用入口：只读原生注入的 `window.CalMobileStrings`。
 *
 * 文案本体维护在 `app/src/main/res/values/strings_frontend.xml`：`scripts/extract-strings.js`
 * 从 `web/src` 里收集 `t(...)` 的 key，原生 `InjectStrings` 在 WebView 里把整张表注入成
 * `window.CalMobileStrings`。**前端不存文案**，改文案要改 XML（并重新跑一次提取脚本），
 * 改 key 要前后端一起改。
 *
 * 谁读：所有页面、`app/router.ts` 的 `meta.title`、`app/shell.ts` 的导航标签。
 * 谁写：只有原生注入（浏览器预览与单测里由脚本 / 测试自己赋值）。
 *
 * 不变量与坑：
 * - 取不到时逐级回退：先查表 → 再用 `fallback` → `fallback` 默认是 key 本身；
 *   所以屏幕上直接出现 `s_` 开头的短码就是「漏提取 / 没注入」，不是排版问题。
 * - 表存在但该 key 映射为空串时返回空串（`??` 只兜 null / undefined），不会走 fallback。
 * - **不是响应式的**：函数不依赖任何 ref，只在重新渲染时重算。因此模块顶层或 store state
 *   初始化时取值会把当时的值固化 —— 正确做法是存 key、渲染时再 `t(key)`（`meta.title` 即如此）。
 * - 不做插值 / 复数 / 占位符：要拼参数由调用方自己拼（见 `services/validate.ts` 的提示文案）。
 */
/**
 * 取一条文案。
 * @param key 文案 key（`s_` 开头的短码），需已在 `strings_frontend.xml` 中注册
 * @param fallback 表中没有该 key 时的回退；缺省回退为 `key` 本身，便于暴露漏配
 * @returns 对应文案；表里没有该 key 时返回 `fallback`
 */
export function t(key: string, fallback = key): string {
  return window.CalMobileStrings?.[key] ?? fallback;
}
