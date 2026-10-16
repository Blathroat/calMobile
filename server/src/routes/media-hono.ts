/**
 * 已上传头像的静态分发。
 *
 * 不挂在 `/api/v1` 下：`<img>` 不会带 Authorization，公开主页也要能显示头像。
 * 文件名是随机串，这里不列目录、不接受调用方给的路径。
 *
 * 应用页面和报名站与接口同源，图片也能直接显示。
 * `Cross-Origin-Resource-Policy` 仍是 `cross-origin`，别的页面嵌这张图时不会被浏览器拦住。
 */

import { Hono } from 'hono';
import type { Context } from 'hono';
import { resolveUploadConfig } from '../config/upload.js';
import { notFound } from '../domain/errors.js';
import { avatarContentType, readAvatarFile } from '../services/avatar-store.js';
import { contentContentType, readContentFile } from '../services/content-media.js';
import { applyHeaders } from '../server/node-middleware.js';

const MEDIA_HEADERS: [string, string][] = [
  ['Cache-Control', 'public, max-age=31536000, immutable'],
  ['Cross-Origin-Resource-Policy', 'cross-origin'],
  ['X-Content-Type-Options', 'nosniff'],
];

export function createMediaRoutes(): Hono {
  const app = new Hono();

  app.get('/avatars/:name', async (c) => {
    const fileName = c.req.param('name');
    const bytes = await readAvatarFile(fileName, resolveUploadConfig());
    if (!bytes) throw notFound();
    const type = avatarContentType(fileName.slice(fileName.lastIndexOf('.') + 1));
    return imageResponse(c, bytes, type);
  });

  app.get('/files/:name', async (c) => {
    const fileName = c.req.param('name');
    const bytes = await readContentFile(fileName, resolveUploadConfig());
    if (!bytes) throw notFound();
    const type = contentContentType(fileName.slice(fileName.lastIndexOf('.') + 1));
    return imageResponse(c, bytes, type);
  });

  return app;
}

function imageResponse(c: Context, bytes: Buffer, type: string): Response {
  const headers: [string, string][] = [['Content-Type', type], ...MEDIA_HEADERS];
  applyHeaders(c, headers);
  return new Response(new Uint8Array(bytes), { status: 200, headers });
}
