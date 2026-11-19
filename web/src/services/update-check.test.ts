import { describe, expect, it } from 'vitest';
import { compareVersions, currentVersion, shouldPrompt, updateMarker } from './update-check';

describe('应用更新判断', () => {
  it('有版本号时不论来源都按版本比较', () => {
    const current = currentVersion();
    expect(shouldPrompt({ source: 'url', version: '999.0.0', url: 'https://example.com/app.apk' })).toBe(true);
    expect(shouldPrompt({ source: 'url', version: '0.0.0', url: 'https://example.com/app.apk' })).toBe(false);
    expect(shouldPrompt({ source: 'url', version: current, url: 'https://example.com/app.apk' })).toBe(false);
  });

  it('没有版本号时保留旧直链行为', () => {
    expect(shouldPrompt({ source: 'url', version: '', url: 'https://example.com/app.apk' })).toBe(true);
    expect(shouldPrompt({ source: 'url', version: '', url: '' })).toBe(false);
  });

  it('去重标记优先用版本号，没有版本号时用地址', () => {
    expect(updateMarker({ source: 'url', version: '1.2.3', url: 'https://example.com/a.apk' })).toBe('1.2.3');
    expect(updateMarker({ source: 'url', version: '', url: 'https://example.com/a.apk' })).toBe(
      'https://example.com/a.apk',
    );
  });

  it('版本比较按数字段而不是字符串', () => {
    expect(compareVersions('1.20.0', '1.3.0')).toBe(1);
    expect(compareVersions('v1.0', '1.0.0')).toBe(0);
    expect(compareVersions('0.9.9', '1.0.0')).toBe(-1);
  });
});
