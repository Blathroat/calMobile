/**
 * 应用页面包（PWA）的安装元信息、HTML 占位符与 Service Worker 都在这里生成。
 *
 * 安装元信息不能写成静态文件：应用名、短名与描述在 `src/i18n/zh.json`，
 * 构建时读出来生成 `dist/manifest.webmanifest`；部署时可以用 `PWA_APP_NAME`、
 * `PWA_APP_SHORT_NAME`、`PWA_APP_DESCRIPTION` 三项环境变量覆盖。
 *
 * 这份脚本要能被 `node --test` 直接跑，所以只用 Node 内置模块，不引 Vite。
 */

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildWebIcons } from '../scripts/build-icons.mjs';
import { buildReleaseManifest } from './release-manifest.mjs';

/** 应用页面包在站点上的固定前缀，与 `vite.config.ts` 的 base 一致。 */
const APP_BASE = '/app/';

/**
 * manifest 引用的安装图标。文件在 `web/public/icons/`，构建后位于 dist 下的
 * `icons/`；`src` 相对 manifest 自身（manifest 就在 `/app/` 下）。
 * `maskable` 单独一条：图形缩在安全圆里，不能当普通图标用。
 */
const MANIFEST_ICONS = [
  { src: 'icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
  { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
  { src: 'icons/maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
];

/**
 * 读中文文案表并压成「点分路径 → 文案」的扁平表，键与前端 `t()` 一致。
 * @returns {Record<string, string>}
 */
export function readCopy() {
  const file = fileURLToPath(new URL('./src/i18n/zh.json', import.meta.url));
  return flatten(JSON.parse(readFileSync(file, 'utf8')));
}

/**
 * 安装元信息。默认取文案表；三项环境变量非空时覆盖对应字段，
 * 同一个构建产物就能按部署换名字。
 *
 * 三项都解析不出内容时直接抛错：安装清单里没有名字或描述属于配置错误，
 * 应该在构建时暴露，而不是把空值发到线上。
 * @param {Record<string, string | undefined>} env
 * @param {Record<string, string>} copy
 * @returns {{ name: string, shortName: string, description: string }}
 */
export function resolvePwaMeta(env, copy) {
  const override = (value) => (typeof value === 'string' ? value.trim() : '');
  const name = override(env.PWA_APP_NAME) || copyValue(copy, 'app.documentTitle');
  const shortName = override(env.PWA_APP_SHORT_NAME) || copyValue(copy, 'pwa.manifest.shortName') || name;
  const description = override(env.PWA_APP_DESCRIPTION) || copyValue(copy, 'pwa.manifest.description');
  const missing = [];
  if (!name) missing.push('app.documentTitle（或 PWA_APP_NAME）');
  if (!shortName) missing.push('pwa.manifest.shortName（或 PWA_APP_SHORT_NAME）');
  if (!description) missing.push('pwa.manifest.description（或 PWA_APP_DESCRIPTION）');
  if (missing.length > 0) throw new Error(`安装元信息缺少文案：${missing.join('、')}`);
  return { name, shortName, description };
}

/**
 * `manifest.webmanifest` 的内容。`start_url` / `scope` 取 `/app/`：
 * 页面包挂在站点这个前缀下，安装后的导航也留在这里。
 * 主题色与应用背景一致（见 `web/src/styles/tokens.css`）。
 * @param {{ name: string, shortName: string, description: string }} meta
 * @returns {{
 *   id: string,
 *   name: string,
 *   short_name: string,
 *   description: string,
 *   lang: string,
 *   start_url: string,
 *   scope: string,
 *   display: string,
 *   background_color: string,
 *   theme_color: string,
 *   icons: { src: string, sizes: string, type: string, purpose: string }[]
 * }}
 */
export function buildManifest(meta) {
  return {
    id: APP_BASE,
    name: meta.name,
    short_name: meta.shortName,
    description: meta.description,
    lang: 'zh-CN',
    start_url: APP_BASE,
    scope: APP_BASE,
    display: 'standalone',
    display_override: ['standalone', 'minimal-ui'],
    background_color: '#f7f6f3',
    theme_color: '#f7f6f3',
    icons: MANIFEST_ICONS.map((icon) => ({ ...icon })),
    prefer_related_applications: false,
  };
}

/**
 * 替换 HTML 里的 `%NAME%` 占位符，值统一做 HTML 转义。
 * `%BASE_URL%` 归 Vite 处理，这里不碰。
 * @param {string} html
 * @param {Record<string, string>} values
 * @returns {string}
 */
export function renderHtml(html, values) {
  let result = html;
  for (const [key, value] of Object.entries(values)) {
    result = result.split(`%${key}%`).join(escapeHtml(value));
  }
  return result;
}

/**
 * Service Worker 源码。
 *
 * 预缓存列表由构建产物清单决定，版本号就是清单 id：产物一变缓存名就变，
 * 旧缓存由 activate 清掉。只接管页面包：导航网络优先、`assets/` 缓存优先，
 * 业务接口、媒体、版本清单与跨域请求一律放行，不缓存业务数据。
 * @param {string[]} paths 预缓存路径，已带 `/app/` 前缀。
 * @param {string} version 版本号（`buildReleaseManifest()` 的 id）。
 * @returns {string}
 */
export function serviceWorkerSource(paths, version) {
  return `/* 由 web/pwa-build.mjs 生成，不要手改。 */
const CACHE_NAME = ${JSON.stringify(`calmobile-app-${version}`)};
const CACHE_PREFIX = 'calmobile-app-';
const PRECACHE = ${JSON.stringify(paths)};

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE_NAME);
    // 逐个预缓存：单个文件取不到不阻断安装，缺的等下次请求再走网络。
    for (const item of PRECACHE) {
      try {
        await cache.add(item);
      } catch (error) {
        console.warn('[sw] 预缓存失败', item, error);
      }
    }
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    // 不调用 skipWaiting / clients.claim：新版本先等着，旧页面关掉后再生效。
    // 这样旧页面不会在更新中途去取一份已经被新缓存清掉的旧资源。
    for (const name of await caches.keys()) {
      if (name.startsWith(CACHE_PREFIX) && name !== CACHE_NAME) await caches.delete(name);
    }
  })());
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  // 只接管应用页面包：跨域、业务接口与媒体都放行，不写进缓存。
  if (url.origin !== self.location.origin) return;
  if (!url.pathname.startsWith('/app/')) return;
  if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/media/')) return;
  // 导航与页面包资源才处理；版本清单等其它文件直接走网络，不进缓存。
  if (request.mode === 'navigate' || url.pathname.startsWith('/app/assets/')) {
    event.respondWith(respond(request, url));
  }
});

async function respond(request, url) {
  const cache = await caches.open(CACHE_NAME);
  if (request.mode === 'navigate') {
    // 导航网络优先：先拿线上最新页面，断网时回退到安装时缓存的外壳。
    try {
      return await fetch(request);
    } catch {
      return (await cache.match('/app/index.html')) || Response.error();
    }
  }
  // 页面包资源缓存优先：安装时已经预缓存过，命中就省一次网络。
  const cached = await cache.match(url.pathname);
  if (cached) return cached;
  const response = await fetch(request);
  if (response.ok) await cache.put(url.pathname, response.clone());
  return response;
}
`;
}

/**
 * 构建时替换 HTML 里的文案占位符。
 *
 * 标题按页面取：应用页面用安装元信息里的应用名（可被 `PWA_APP_NAME` 覆盖），
 * 报名站用 `join.documentTitle`；其余 PWA 占位符只在应用页面包里替换。
 * 替换后仍有占位符残留就直接报错，免得把 `%APP_TITLE%` 发到线上。
 * @param {{
 *   copy: Record<string, string>,
 *   env?: Record<string, string | undefined>,
 *   includePwa?: boolean
 * }} options
 * @returns {import('vite').Plugin}
 */
export function pwaHtmlCopyPlugin({ copy, env = {}, includePwa = false }) {
  return {
    name: 'calmobile-pwa-html',
    // 放在 post：Vite 会先用 htmlEnvHook 把 `%BASE_URL%` 换成 base，这里只管自己的占位符。
    transformIndexHtml: {
      order: 'post',
      handler(html, ctx) {
        const file = path.basename(String(ctx.filename || ctx.path || ''));
        /** @type {Record<string, string>} */
        const values = {};
        if (file === 'join.html') {
          const title = copyValue(copy, 'join.documentTitle');
          if (!title) throw new Error('报名站标题缺少文案：join.documentTitle');
          values.APP_TITLE = title;
        } else {
          const meta = resolvePwaMeta(env, copy);
          values.APP_TITLE = meta.name;
          if (includePwa) {
            values.PWA_SHORT_NAME = meta.shortName;
            values.PWA_DESCRIPTION = meta.description;
          }
        }
        const result = renderHtml(html, values);
        const leftover = result.match(/%[A-Za-z0-9_]+%/g)?.filter((token) => token !== '%BASE_URL%') ?? [];
        if (leftover.length > 0) throw new Error(`HTML 里还有没替换的占位符：${leftover.join('、')}`);
        return result;
      },
    },
  };
}

/**
 * 构建结束后写安装清单与 Service Worker。
 *
 * 顺序不能反：先落 `manifest.webmanifest`，再按完整产物清单生成预缓存列表；
 * `release.json`（热更新比对用）与 `sw.js`（SW 自己）不预缓存。
 * @param {{
 *   distDir: string,
 *   env?: Record<string, string | undefined>,
 *   copy?: Record<string, string>
 * }} options
 * @returns {import('vite').Plugin}
 */
export function pwaAssetsPlugin({ distDir, env = {}, copy = readCopy() }) {
  return {
    name: 'calmobile-pwa-assets',
    apply: 'build',
    closeBundle() {
      const root = path.resolve(distDir);
      mkdirSync(root, { recursive: true });
      // 站点 favicon、PWA 图标都从同一个 APP_ICON 源图生成；源图与底色和 Android
      // 共用 server/.env / 进程环境，这里不再读 web/.env。先落图标，再让产物清单
      // 和 Service Worker 预缓存把它们算进去。
      buildWebIcons(root);
      writeFileSync(
        path.join(root, 'manifest.webmanifest'),
        `${JSON.stringify(buildManifest(resolvePwaMeta(env, copy)), null, 2)}\n`,
      );
      const release = buildReleaseManifest(root);
      const paths = release.files
        .map((file) => file.path)
        .filter((file) => file !== 'release.json' && file !== 'sw.js')
        .map((file) => `${APP_BASE}${file}`);
      writeFileSync(path.join(root, 'sw.js'), serviceWorkerSource(paths, release.id));
    },
  };
}

/**
 * @param {Record<string, string>} copy
 * @param {string} key
 * @returns {string}
 */
function copyValue(copy, key) {
  const value = copy[key];
  return typeof value === 'string' ? value.trim() : '';
}

/**
 * @param {unknown} value
 * @param {string} [prefix]
 * @param {Record<string, string>} [out]
 * @returns {Record<string, string>}
 */
function flatten(value, prefix = '', out = {}) {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    for (const [key, child] of Object.entries(value)) flatten(child, prefix ? `${prefix}.${key}` : key, out);
    return out;
  }
  out[prefix] = value === null || value === undefined ? '' : String(value);
  return out;
}

/** @param {string} value */
function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}
