/**
 * 头像裁剪抽屉的全局状态：打开时带上待裁剪图片、回调与目标账号，关闭后全部清空。
 *
 * 目标账号是「本人 / 管理员代改」的分叉点：非空时裁剪抽屉走管理员上传接口，
 * 不能残留到下一次打开，否则本人换头像会误走管理员接口。
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { avatarCropper, closeAvatarCropper, openAvatarCropper } from './profile-avatar';

afterEach(closeAvatarCropper);

describe('头像裁剪状态', () => {
  it('默认按本人头像处理：没有目标账号与回调', () => {
    expect(avatarCropper.source).toBe('');
    expect(avatarCropper.targetUserId).toBe('');
    expect(avatarCropper.onUpdated).toBeNull();
  });

  it('打开时记录图片、回调与目标账号；关闭后一起清空', () => {
    const onUpdated = vi.fn();
    openAvatarCropper('data:image/jpeg;base64,AAAA', onUpdated, 'u2');
    expect(avatarCropper.source).toBe('data:image/jpeg;base64,AAAA');
    expect(avatarCropper.targetUserId).toBe('u2');
    expect(avatarCropper.onUpdated).toBe(onUpdated);

    closeAvatarCropper();
    expect(avatarCropper.source).toBe('');
    expect(avatarCropper.targetUserId).toBe('');
    expect(avatarCropper.onUpdated).toBeNull();
  });

  it('不传目标账号时按本人处理，上一次的目标不会残留', () => {
    openAvatarCropper('data:image/jpeg;base64,AAAA', undefined, 'u2');
    openAvatarCropper('data:image/jpeg;base64,BBBB');
    expect(avatarCropper.targetUserId).toBe('');
    expect(avatarCropper.onUpdated).toBeNull();
  });
});
