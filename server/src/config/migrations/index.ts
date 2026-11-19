/**
 * 迁移步骤汇总。
 *
 * 步骤按年代/主题拆在 `core`（0001-0009）、`accounts-security`（0010-0019）、
 * `features`（0020-0028）三个模块里，这里按发布顺序拼成 `STEPS` —— 顺序就是执行顺序，
 * 不要重排；`migrate()` 只跑 `schema_migrations` 里还没有的 id。
 */

import { STEPS as CORE_STEPS } from './core.js';
import { STEPS as ACCOUNT_SECURITY_STEPS } from './accounts-security.js';
import { STEPS as FEATURE_STEPS } from './features.js';
import type { MigrationStep } from './types.js';

/** 全部迁移步骤：id 一旦发布就不要改内容，只能追加新步骤。 */
export const STEPS: readonly MigrationStep[] = [...CORE_STEPS, ...ACCOUNT_SECURITY_STEPS, ...FEATURE_STEPS];
