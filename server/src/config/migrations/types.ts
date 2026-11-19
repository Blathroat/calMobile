/**
 * 迁移步骤的类型定义。
 */

export interface MigrationStep {
  id: string;
  sql: string;
  /**
   * 可选：SQL 的绑定参数（按 `THEME_COLORS` 这类「只在代码里维护一份」的常量生成）。
   *
   * 用参数而不是把值拼进 SQL 有两条理由：一是色板只在 `THEME_COLORS` 里写一次，
   * 不会和迁移步骤里手抄的列表漂移；二是 pg 驱动在**简单查询**协议下会在发送前
   * 扫描 `$` 找占位符，SQL 文本里出现美元引用之类的字面量会被截断成语法错误，
   * 走参数即改用扩展协议，不再有这类坑。
   */
  params?: (palette: readonly string[]) => readonly unknown[];
}
