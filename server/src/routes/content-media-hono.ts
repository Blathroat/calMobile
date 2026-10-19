/**
 * 展会封面和简介媒体上传。
 *
 * 正文是文件字节，不走 2MB 的 JSON 体积守卫。单文件上限用管理设置里的图片或视频大小。
 * 写入前先按存储策略腾位置。
 */

import { Hono } from 'hono';
import { resolveUploadConfig } from '../config/upload.js';
import { badRequest } from '../domain/errors.js';
import { assertNotLimited, requireExhibitor } from '../domain/permissions.js';
import { readServerSettings } from '../domain/settings.js';
import { readCappedBytes } from '../services/avatar-store.js';
import { inspectContent, storedContentUrl, writeContentFile, type ContentKind } from '../services/content-media.js';
import { ensureRoom } from '../services/media-gc.js';
import { mutate } from '../http/respond.js';
import { authenticateHono, userOf, type HonoEnv } from './hono-utils.js';

const app = new Hono<HonoEnv>();

function kindOf(value: string | undefined): ContentKind {
  if (value === 'image' || value === 'video') return value;
  throw badRequest('请说明要上传的是图片还是视频', { code: 'media.kindRequired' });
}

app.post('/', authenticateHono, async (c) => {
  const user = requireExhibitor({ user: userOf(c) });
  assertNotLimited(user, 'exhibition');
  return mutate(c, async () => {
    const kind = kindOf(c.req.query('kind'));
    const settings = await readServerSettings();
    const limitMb = kind === 'video' ? settings.media.videoSizeMb : settings.media.imageSizeMb;
    const maxBytes = limitMb * 1024 * 1024;
    const declared = Number(c.req.header('content-length'));
    const read = await readCappedBytes(c.req.raw.body, maxBytes, Number.isFinite(declared) ? declared : undefined);
    if (!read.ok || read.bytes.byteLength === 0) {
      const label = kind === 'video' ? '视频' : '图片';
      throw badRequest(`${label}超过 ${limitMb} MB 限制`, {
        code: kind === 'video' ? 'media.videoTooLarge' : 'media.imageTooLarge',
        params: { max: limitMb },
      });
    }
    const formats = kind === 'video' ? settings.upload.videoFormats : settings.upload.imageFormats;
    const inspected = inspectContent(read.bytes, kind, formats);
    if (!inspected.ok) {
      if (inspected.reason === 'too-large') throw badRequest('图片尺寸过大', { code: 'media.imageDimensionsTooLarge' });
      if (inspected.reason === 'format') {
        throw badRequest(`服务器设置不允许上传这种格式，允许：${formats.join('、')}`, {
          code: 'media.formatRejected',
          params: { formats: formats.join('、') },
        });
      }
      throw badRequest(kind === 'video' ? '无法识别的视频' : '无法识别的图片', {
        code: kind === 'video' ? 'media.videoUnreadable' : 'media.imageUnreadable',
      });
    }
    await ensureRoom(read.bytes.byteLength);
    const config = resolveUploadConfig();
    const fileName = await writeContentFile(read.bytes, inspected.extension, config);
    return { url: storedContentUrl(fileName, config), bytes: read.bytes.byteLength };
  });
});

export function createContentMediaRoutes() {
  return app;
}

export const CONTENT_MEDIA_ENDPOINTS: readonly [string, string][] = [['POST', '/']];
