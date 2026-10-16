import { describe, expect, it } from 'vitest';
import { mediaOriginFromApiBase, resolveApiBase } from './api-base';

describe('resolveApiBase', () => {
  it('报名站忽略构建地址，应用在没注入时退回本机', () => {
    expect(resolveApiBase('join', 'https://app.example.com/api/v1')).toBe('/api/v1');
    expect(resolveApiBase(undefined, undefined)).toBe('http://127.0.0.1:3000/api/v1');
    expect(resolveApiBase(undefined, ' https://app.example.com/api/v1/ ')).toBe('https://app.example.com/api/v1');
  });

  it('媒体源跟接口同源，相对基址不补主机', () => {
    expect(mediaOriginFromApiBase('https://app.example.com/api/v1')).toBe('https://app.example.com');
    expect(mediaOriginFromApiBase('/api/v1')).toBe('');
  });
});
