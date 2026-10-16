import { describe, expect, it } from 'vitest';
import { resolveMediaUrl } from './media-url';

describe('resolveMediaUrl', () => {
  it('把站内路径补到给定的源，绝对地址和报名站的相对路径保持原样', () => {
    expect(resolveMediaUrl('/media/avatars/abc.jpg', 'http://127.0.0.1:3000')).toBe(
      'http://127.0.0.1:3000/media/avatars/abc.jpg',
    );
    expect(resolveMediaUrl('/media/avatars/abc.jpg', 'https://app.example.com')).toBe(
      'https://app.example.com/media/avatars/abc.jpg',
    );
    expect(resolveMediaUrl('/media/avatars/abc.jpg', '')).toBe('/media/avatars/abc.jpg');
    expect(resolveMediaUrl('https://cdn.example.com/media/avatars/abc.jpg', 'https://app.example.com')).toBe(
      'https://cdn.example.com/media/avatars/abc.jpg',
    );
  });
});
