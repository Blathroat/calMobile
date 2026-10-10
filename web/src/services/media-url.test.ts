import { describe, expect, it } from 'vitest';
import { resolveMediaUrl } from './media-url';

describe('resolveMediaUrl', () => {
  it('把站内头像路径补到后端源，其它地址保持原样', () => {
    expect(resolveMediaUrl('/media/avatars/abc.jpg')).toBe('http://127.0.0.1:3000/media/avatars/abc.jpg');
    expect(resolveMediaUrl('https://cdn.example.com/media/avatars/abc.jpg')).toBe('https://cdn.example.com/media/avatars/abc.jpg');
    expect(resolveMediaUrl('https://appassets.androidplatform.net/media/local.jpg'))
      .toBe('https://appassets.androidplatform.net/media/local.jpg');
  });
});
