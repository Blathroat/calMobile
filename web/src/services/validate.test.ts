import { describe, expect, it } from 'vitest';
import { PATTERNS } from '@/services/validate';

/**
 * 用户名规则与 `server/src/domain/schemas.ts` 的 `usernamePattern` 必须完全一致：
 * 允许 Unicode 字母、数字、组合符（中文、日文、韩文、拉丁及其它文字）与 `_` `.` `-`；
 * 空白、控制字符、标点与 emoji 拒绝。这里只测正则本身，长度上限与 trim 由 `check()` 负责。
 */
describe('用户名规则', () => {
  it('允许中文等多语言字母、数字、组合符与 _ . -', () => {
    const accepted = ['user_1.2-3', '中文用户', '山田太郎', '김민준', 'Иван', 'François', 'e\u0301le\u0301phant'];
    for (const value of accepted) expect(PATTERNS.username.test(value), value).toBe(true);
  });

  it('拒绝内部空白、控制字符、标点与 emoji', () => {
    const rejected = ['user name', 'user\nname', 'user\u0000name', '用户😀', 'user@name', 'user!', '张三，', '🎉🎉🎉'];
    for (const value of rejected) expect(PATTERNS.username.test(value), value).toBe(false);
  });
});
