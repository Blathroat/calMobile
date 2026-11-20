/**
 * 资料字段写入（本人保存与管理员代改共用）。
 *
 * 只处理 `PUT /profile` 与 `PUT /users/:id/profile` 都允许编辑的字段：
 * 昵称、简介、地区、社交账号、头像与「展示我的报名」。邮箱不允许在这里改；
 * 新头像必须先走上传接口，这里只允许清空，避免把设备私有路径写进库。
 *
 * 头像上传本身也被两条路由共用（本人 `POST /profile/avatar` 与管理员
 * `POST /users/:id/avatar`）：大小上限、格式白名单、尺寸限制、存储额度、
 * 旧文件清理只有 `replaceAvatarFromUpload()` 这一份实现，路由只决定操作哪个账号。
 */
import { query } from '../config/pool.js';
import { resolveUploadConfig } from '../config/upload.js';
import {
  deleteStoredAvatar,
  formatAllowed,
  inspectAvatar,
  readCappedBytes,
  storedAvatarUrl,
  writeAvatarFile,
} from '../services/avatar-store.js';
import { ensureRoom } from '../services/media-gc.js';
import { badRequest } from './errors.js';
import { readServerSettings } from './settings.js';
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

/** 头像上传的请求体来源：Hono 的请求流与 Content-Length 头。 */
export interface AvatarUploadSource {
  /** 请求体流；没有正文时是 null。 */
  stream: ReadableStream<Uint8Array> | null;
  /** 声明的字节数（请求头原值）；没有时按未知长度读到上限为止。 */
  contentLength?: string;
}

/**
 * 校验、落盘并替换指定账号的头像，返回新的站内地址。
 *
 * 本人 `POST /profile/avatar` 与管理员 `POST /users/:id/avatar` 共用这一份：
 * 大小上限（`min(avatarSizeMb, UPLOAD_MAX_MB)`）、格式白名单、尺寸、存储额度、
 * 写库失败回滚新文件、成功后删旧文件都只在这里做。只写目标账号的 `users.avatar`，
 * 不碰会话，也不判断目标账号是否受限——管理员代改不受目标状态影响。
 */
export async function replaceAvatarFromUpload(userId: string, source: AvatarUploadSource): Promise<{ url: string }> {
  const settings = await readServerSettings();
  const config = resolveUploadConfig();
  const limitMb = Math.min(settings.upload.avatarSizeMb, config.maxMb);
  const maxBytes = limitMb * 1024 * 1024;
  const declared = Number(source.contentLength);
  const read = await readCappedBytes(source.stream, maxBytes, Number.isFinite(declared) ? declared : undefined);
  if (!read.ok)
    throw badRequest(`头像超过 ${limitMb} MB 限制`, {
      code: 'profile.avatarTooLarge',
      params: { max: limitMb },
    });
  const inspected = inspectAvatar(read.bytes);
  if (!inspected.ok) {
    const tooLarge = inspected.reason === 'too-large';
    throw badRequest(tooLarge ? '图片尺寸过大' : '无法识别的图片', {
      code: tooLarge ? 'media.imageDimensionsTooLarge' : 'media.imageUnreadable',
    });
  }
  if (!formatAllowed(inspected.image.extension, settings.upload.avatarFormats)) {
    throw badRequest(
      `服务器设置不允许上传 .${inspected.image.extension} 格式，允许：${settings.upload.avatarFormats.join('、')}`,
      {
        code: 'profile.avatarFormatRejected',
        params: { ext: inspected.image.extension, formats: settings.upload.avatarFormats.join('、') },
      },
    );
  }
  await ensureRoom(read.bytes.byteLength);
  const previous = await currentAvatar(userId);
  const fileName = await writeAvatarFile(read.bytes, inspected.image.extension, config);
  const url = storedAvatarUrl(fileName, config);
  try {
    await query('UPDATE users SET avatar = $2, updated_at = now() WHERE id = $1', [userId, url]);
  } catch (error) {
    await deleteStoredAvatar(url, config);
    throw error;
  }
  await deleteStoredAvatar(previous, config);
  return { url };
}
