import { beforeEach, describe, expect, it } from 'vitest';
import { t } from './index';

describe('t', () => {
  beforeEach(() => {
    window.CalMobileStrings = { greeting: '你好' };
  });

  it('reads injected Android strings and falls back when missing', () => {
    expect(t('greeting')).toBe('你好');
    expect(t('missing', '默认文案')).toBe('默认文案');
  });
});
