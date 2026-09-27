/**
 * 判断「当前模块是不是这次 Node 进程的入口」。
 *
 * CommonJS 的 `require.main === module` 在 ESM 里没有对应物，这里改用入口文件比对：
 * `node src/index.ts` / `node dist/index.js` 时 `process.argv[1]` 正是被打进来的那份脚本，
 * 转成 file URL 后与 `import.meta.url` 比一次即可。
 *
 * 被别的模块 import（路由注册表、契约测试、tsx watch 的重复加载）时一律是 false，
 * 因此不会出现「谁 import 谁启动」。
 */

import { pathToFileURL } from 'node:url';

/**
 * @param moduleUrl **必须由调用方传 `import.meta.url`**：写在默认值里的话，
 *                  求值发生在本模块，拿到的就成了 `entry.ts` 自己的 URL。
 * @param argv 形如 `process.argv`（含 node 与脚本路径，函数自己取下标 1）。
 */
export function isEntry(moduleUrl: string, argv: string[] = process.argv): boolean {
  const invoked = argv[1];
  if (!invoked) {
    return false;
  }
  // argv[1] 可能是相对路径（`node dist/index.js`），pathToFileURL 按 cwd 解析，
  // 与 Node 解析模块路径的基准一致，因此能和 import.meta.url 对上。
  return pathToFileURL(invoked).href === moduleUrl;
}
