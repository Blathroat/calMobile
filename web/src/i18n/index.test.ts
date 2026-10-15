import { describe, expect, it } from 'vitest';
import { t } from './index';
import { strings } from './strings';

describe('t', () => {
  it('reads the frontend table and falls back when missing', () => {
    expect(t('auth.login.title')).toBe(strings.auth.login.title);
    expect(t('missing', '默认文案')).toBe('默认文案');
    expect(t('missing')).toBe('missing');
  });
});
