/**
 * 界面文案的取用入口。正文在 `strings.ts`，按界面分区分层。
 *
 * 谁读：所有页面、路由 `meta.title`、`app/shell.ts` 的导航标签。
 * 谁写：只改 `strings.ts`。邮件正文在后端，不进这张表。
 *
 * 不变量：
 * - 路径用点连接，例如 `auth.login.title`。取不到时逐级回退：先查表 → 再用
 *   `fallback` → `fallback` 默认是路径本身。屏幕上直接出现这种路径，就是表里没有这一条。
 * - 表里该条是空串时返回空串（`??` 只兜 null / undefined），不会走 fallback。
 * - 路径停在某一层对象上、而不是一句文案时，也走 fallback。
 * - **不是响应式的**：函数不依赖任何 ref，只在重新渲染时重算。因此模块顶层或 store state
 *   初始化时取值会把当时的值固化 —— 正确做法是存路径、渲染时再 `t(path)`（`meta.title` 即如此）。
 * - 不做插值 / 复数 / 占位符：要拼参数由调用方自己拼（见 `services/validate.ts` 的提示文案）。
 */
import { strings } from './strings';

function lookup(path: string): string | undefined {
  let node: unknown = strings;
  for (const part of path.split('.')) {
    if (!node || typeof node !== 'object' || !(part in node)) return undefined;
    node = (node as Record<string, unknown>)[part];
  }
  return typeof node === 'string' ? node : undefined;
}

/**
 * 取一条界面文案。
 * @param path 点分路径，例如 `auth.login.title`，需已在 `strings.ts` 中登记
 * @param fallback 表中没有该条时的回退；缺省回退为路径本身，便于暴露漏配
 * @returns 对应文案；表里没有该条时返回 `fallback`
 */
export function t(path: string, fallback = path): string {
  return lookup(path) ?? fallback;
}
