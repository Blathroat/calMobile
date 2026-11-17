/**
 * 资料字段写入（本人保存与管理员代改共用）。
 *
 * 只处理 `PUT /profile` 与 `PUT /users/:id/profile` 都允许编辑的字段：
 * 昵称、简介、地区、社交账号、头像与「展示我的报名」。邮箱不允许在这里改；
 * 新头像必须先走上传接口，这里只允许清空，避免把设备私有路径写进库。
 */
import { query } from '../config/pool.js';
import { resolveUploadConfig } from '../config/upload.js';
import { deleteStoredAvatar } from '../services/avatar-store.js';
import { badRequest } from './errors.js';
import type { ProfilePatchInput } from './schemas.js';

function has(value: object, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(value, key);
}

async function currentAvatar(userId: string): Promise<string> {
  const result = await query<{ avatar: string | null }>('SELECT avatar FROM users WHERE id = $1', [userId]);
  return result.rows[0]?.avatar || '';
}

/** 把补丁落到目标用户上；返回前已删掉被清空头像对应的文件。 */
export async function updateProfileRecord(userId: string, parsed: ProfilePatchInput): Promise<void> {
  const assignments: string[] = [];
  const values: unknown[] = [];
  const set = (column: string, value: unknown): void => {
    values.push(value);
    assignments.push(`${column} = $${values.length}`);
  };

  if (has(parsed, 'nickname')) set('nickname', parsed.nickname);
  if (has(parsed, 'bio')) set('bio', parsed.bio);
  if (has(parsed, 'region')) set('region', parsed.region);
  if (has(parsed, 'socialMedia')) set('social_media', parsed.socialMedia);

  let removedAvatar = '';
  if (has(parsed, 'avatar')) {
    const nextAvatar = String(parsed.avatar ?? '');
    const previous = await currentAvatar(userId);
    if (nextAvatar !== previous) {
      // 新头像只能走上传接口；清空仍然允许。
      if (nextAvatar !== '') throw badRequest('头像请通过上传更新', { code: 'profile.avatarUploadOnly' });
      set('avatar', '');
      removedAvatar = previous;
    }
  }
  if (has(parsed, 'showRegistrations')) set('show_registrations', parsed.showRegistrations);

  if (assignments.length > 0) {
    values.push(userId);
    await query(`UPDATE users SET ${assignments.join(', ')}, updated_at = now() WHERE id = $${values.length}`, values);
  }
  if (removedAvatar) await deleteStoredAvatar(removedAvatar, resolveUploadConfig());
}
