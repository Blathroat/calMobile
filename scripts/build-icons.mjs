/**
 * 从一个方形 PNG 源图生成站点、PWA 和 Android 用的全部图标。
 *
 * 源图是可选项：`APP_ICON` 指向仓库内或绝对路径的 PNG；不配时用
 * `web/public/icons/icon-1024.png`。`APP_ICON_BACKGROUND` 是可选的十六进制底色，
 * 用于 PWA maskable、Apple 主屏幕、Android 自适应图标和圆角图标留白；不配时用
 * 默认强调色 `#41707e`。`APP_ICON_TRANSPARENT=1` 时不铺底色，并且 Android
 * 不生成 adaptive 图标（启动器可能把透明背景渲染成黑底）。
 *
 * 之所以自己解码 / 缩放进 PNG：CI 不保证有 ImageMagick、Pillow 或 sharp，
 * 而这些图标的尺寸都很小，用 Node 内置的 zlib 足够。源图只支持 8 位 RGB/RGBA、
 * 非隔行的 PNG；这也是当前设计源图（Pillow 导出的 PNG）的格式。
 *
 * 产物分两处：
 * - 站点 / PWA：`web/dist/icons/*.png`（含 1024）与 `web/dist/favicon.ico`，构建后由服务端托管；
 *   `web/public/icons/` 里保留默认图标，开发服务器仍能直接打开。
 * - Android：`app/build/generated/icons/res/`，由 Gradle 的 `buildIcons` 任务生成，
 *   再作为额外的资源目录参与打包。透明模式不生成 `mipmap-anydpi-v26`。
 */

import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { deflateSync, inflateSync } from 'node:zlib';
import { loadBuildEnv } from './client-target.mjs';

/** 仓库根目录：脚本在 `scripts/` 下，往上跳一级。 */
export const ROOT = path.resolve(fileURLToPath(new URL('..', import.meta.url)));

/** 没配置 `APP_ICON` 时使用的设计源图。 */
export const DEFAULT_ICON = 'web/public/icons/icon-1024.png';

/** 没配置 `APP_ICON_BACKGROUND` 时使用的底色，与页面默认强调色一致。 */
export const DEFAULT_BACKGROUND = '#41707e';

const PNG_SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
const PNG_BIT_DEPTH = 8;

/** Android 启动图标与自适应前景图的密度档位。 */
const ANDROID_DENSITIES = [
  { name: 'mdpi', legacy: 48, foreground: 108 },
  { name: 'hdpi', legacy: 72, foreground: 162 },
  { name: 'xhdpi', legacy: 96, foreground: 216 },
  { name: 'xxhdpi', legacy: 144, foreground: 324 },
  { name: 'xxxhdpi', legacy: 192, foreground: 432 },
];

/** CRC-32 表：PNG 每个 chunk 都要它。 */
const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let index = 0; index < 256; index += 1) {
    let value = index;
    for (let bit = 0; bit < 8; bit += 1) value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
    table[index] = value >>> 0;
  }
  return table;
})();

/**
 * @param {Buffer} bytes
 * @returns {number}
 */
function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

/**
 * 把 `APP_ICON_BACKGROUND` 解析成 RGB；支持 `#rgb`、`#rrggbb`，不带 `#` 也行。
 * @param {unknown} value
 * @returns {{ r: number, g: number, b: number }}
 */
export function parseHexColor(value) {
  const text = String(value ?? '').trim();
  const long = /^#?([0-9a-f]{6})$/i.exec(text);
  const short = /^#?([0-9a-f]{3})$/i.exec(text);
  const hex = long?.[1] ?? (short ? short[1].replace(/./g, (char) => char + char) : '');
  if (!hex) throw new Error(`APP_ICON_BACKGROUND 不是十六进制颜色：${text || '空'}`);
  return {
    r: Number.parseInt(hex.slice(0, 2), 16),
    g: Number.parseInt(hex.slice(2, 4), 16),
    b: Number.parseInt(hex.slice(4, 6), 16),
  };
}

/**
 * @param {{ r: number, g: number, b: number }} color
 * @returns {string}
 */
function hexColor(color) {
  return `#${[color.r, color.g, color.b].map((value) => value.toString(16).padStart(2, '0')).join('')}`;
}

/**
 * @param {number} value
 * @returns {number}
 */
function u16(value) {
  return value & 0xff;
}

/**
 * 解码 8 位 RGB/RGBA、非隔行 PNG，统一输出 RGBA。
 * @param {Buffer} buffer
 * @returns {{ width: number, height: number, data: Uint8Array }}
 */
export function decodePng(buffer) {
  if (buffer.length < 8 || !buffer.subarray(0, 8).equals(PNG_SIGNATURE)) {
    throw new Error('APP_ICON 不是 PNG 文件');
  }
  let width = 0;
  let height = 0;
  let colorType = 0;
  let bitDepth = 0;
  let interlace = 0;
  const idat = [];
  let offset = 8;
  while (offset + 8 <= buffer.length) {
    const length = buffer.readUInt32BE(offset);
    const type = buffer.toString('ascii', offset + 4, offset + 8);
    const data = buffer.subarray(offset + 8, offset + 8 + length);
    offset += length + 12;
    if (type === 'IHDR') {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      bitDepth = data[8] ?? 0;
      colorType = data[9] ?? 0;
      interlace = data[12] ?? 0;
      continue;
    }
    if (type === 'IDAT') {
      idat.push(data);
      continue;
    }
    if (type === 'IEND') break;
  }
  if (!width || !height) throw new Error('APP_ICON 没有读到 PNG 尺寸');
  if (bitDepth !== PNG_BIT_DEPTH) throw new Error(`APP_ICON 只支持 8 位 PNG，当前是 ${bitDepth} 位`);
  if (colorType !== 2 && colorType !== 6) {
    throw new Error('APP_ICON 只支持 RGB / RGBA 彩色 PNG');
  }
  if (interlace !== 0) throw new Error('APP_ICON 不支持隔行 PNG');

  const channels = colorType === 6 ? 4 : 3;
  const stride = width * channels;
  const raw = inflateSync(Buffer.concat(idat));
  if (raw.length < (stride + 1) * height) throw new Error('APP_ICON 的 PNG 数据不完整');

  /** @type {Uint8Array[]} */
  const rows = [];
  let previous = new Uint8Array(stride);
  let cursor = 0;
  for (let y = 0; y < height; y += 1) {
    const filter = raw[cursor] ?? 0;
    cursor += 1;
    const source = raw.subarray(cursor, cursor + stride);
    cursor += stride;
    const current = new Uint8Array(stride);
    for (let index = 0; index < stride; index += 1) {
      const left = index >= channels ? (current[index - channels] ?? 0) : 0;
      const up = previous[index] ?? 0;
      const upLeft = index >= channels ? (previous[index - channels] ?? 0) : 0;
      const value = source[index] ?? 0;
      let output;
      if (filter === 0) output = value;
      else if (filter === 1) output = value + left;
      else if (filter === 2) output = value + up;
      else if (filter === 3) output = value + ((left + up) >> 1);
      else if (filter === 4) {
        const p = left + up - upLeft;
        const pa = Math.abs(p - left);
        const pb = Math.abs(p - up);
        const pc = Math.abs(p - upLeft);
        output = value + (pa <= pb && pa <= pc ? left : pb <= pc ? up : upLeft);
      } else {
        throw new Error(`APP_ICON 的 PNG 使用了未知过滤器：${filter}`);
      }
      current[index] = u16(output);
    }
    rows.push(current);
    previous = current;
  }

  const data = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    const row = rows[y];
    if (!row) continue;
    for (let x = 0; x < width; x += 1) {
      const from = x * channels;
      const to = (y * width + x) * 4;
      data[to] = row[from] ?? 0;
      data[to + 1] = row[from + 1] ?? 0;
      data[to + 2] = row[from + 2] ?? 0;
      data[to + 3] = channels === 4 ? (row[from + 3] ?? 255) : 255;
    }
  }
  return { width, height, data };
}

/**
 * @param {string} type
 * @param {Buffer} data
 * @returns {Buffer}
 */
function pngChunk(type, data) {
  const typeBytes = Buffer.from(type, 'ascii');
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([typeBytes, data])), 0);
  return Buffer.concat([length, typeBytes, data, crc]);
}

/**
 * 编码 RGBA PNG（filter 0，压缩级别 9）。
 * @param {{ width: number, height: number, data: Uint8Array }} image
 * @returns {Buffer}
 */
export function encodePng(image) {
  const { width, height, data } = image;
  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y += 1) {
    const start = y * (stride + 1);
    raw[start] = 0;
    for (let x = 0; x < stride; x += 1) raw[start + 1 + x] = data[y * stride + x] ?? 0;
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = PNG_BIT_DEPTH;
  header[9] = 6;
  return Buffer.concat([
    PNG_SIGNATURE,
    pngChunk('IHDR', header),
    pngChunk('IDAT', deflateSync(raw, { level: 9 })),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
}

/**
 * 把任意图片居中裁成正方形；源图不是正方形时不拉伸。
 * @param {{ width: number, height: number, data: Uint8Array }} image
 * @returns {{ width: number, height: number, data: Uint8Array }}
 */
function squareImage(image) {
  const size = Math.min(image.width, image.height);
  if (size === image.width && size === image.height) return image;
  const left = Math.floor((image.width - size) / 2);
  const top = Math.floor((image.height - size) / 2);
  const data = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y += 1) {
    const from = ((top + y) * image.width + left) * 4;
    data.set(image.data.subarray(from, from + size * 4), y * size * 4);
  }
  return { width: size, height: size, data };
}

/**
 * 双线性采样。先把 RGB 乘上 alpha 再插值，避免透明边缘发黑。
 * @param {{ width: number, height: number, data: Uint8Array }} image
 * @param {number} x
 * @param {number} y
 * @returns {{ r: number, g: number, b: number, a: number }}
 */
function sampleBilinear(image, x, y) {
  const maxX = image.width - 1;
  const maxY = image.height - 1;
  const x0 = Math.max(0, Math.min(maxX, Math.floor(x)));
  const y0 = Math.max(0, Math.min(maxY, Math.floor(y)));
  const x1 = Math.min(maxX, x0 + 1);
  const y1 = Math.min(maxY, y0 + 1);
  const fx = Math.max(0, Math.min(1, x - x0));
  const fy = Math.max(0, Math.min(1, y - y0));
  const at = (sx, sy) => {
    const offset = (sy * image.width + sx) * 4;
    return {
      r: image.data[offset] ?? 0,
      g: image.data[offset + 1] ?? 0,
      b: image.data[offset + 2] ?? 0,
      a: image.data[offset + 3] ?? 255,
    };
  };
  const weighted = (point) => {
    const alpha = point.a / 255;
    return { r: point.r * alpha, g: point.g * alpha, b: point.b * alpha, a: point.a };
  };
  const p00 = weighted(at(x0, y0));
  const p10 = weighted(at(x1, y0));
  const p01 = weighted(at(x0, y1));
  const p11 = weighted(at(x1, y1));
  const mix = (a, b, t) => a + (b - a) * t;
  const top = {
    r: mix(p00.r, p10.r, fx),
    g: mix(p00.g, p10.g, fx),
    b: mix(p00.b, p10.b, fx),
    a: mix(p00.a, p10.a, fx),
  };
  const bottom = {
    r: mix(p01.r, p11.r, fx),
    g: mix(p01.g, p11.g, fx),
    b: mix(p01.b, p11.b, fx),
    a: mix(p01.a, p11.a, fx),
  };
  const alpha = mix(top.a, bottom.a, fy);
  if (alpha <= 0) return { r: 0, g: 0, b: 0, a: 0 };
  const factor = 255 / alpha;
  return {
    r: Math.round(mix(top.r, bottom.r, fy) * factor),
    g: Math.round(mix(top.g, bottom.g, fy) * factor),
    b: Math.round(mix(top.b, bottom.b, fy) * factor),
    a: Math.round(alpha),
  };
}

/**
 * 渲染一个正方形图标。
 * @param {{ width: number, height: number, data: Uint8Array }} source
 * @param {number} size 输出边长（px）
 * @param {{ background?: { r: number, g: number, b: number } | null, scale?: number, circle?: boolean }} [options]
 * @returns {{ width: number, height: number, data: Uint8Array }}
 */
export function renderIcon(source, size, options = {}) {
  const square = squareImage(source);
  const background = options.background ?? null;
  const scale = Math.max(0.01, Math.min(1, options.scale ?? 1));
  const circle = options.circle === true;
  const output = new Uint8Array(size * size * 4);
  const inner = Math.max(1, Math.round(size * scale));
  const offset = Math.floor((size - inner) / 2);
  const radius = size / 2 - 0.5;

  const paintBackground = (x, y) => {
    if (!background) return;
    if (circle && Math.hypot(x + 0.5 - size / 2, y + 0.5 - size / 2) > radius) return;
    const index = (y * size + x) * 4;
    output[index] = background.r;
    output[index + 1] = background.g;
    output[index + 2] = background.b;
    output[index + 3] = 255;
  };

  for (let y = 0; y < size; y += 1) for (let x = 0; x < size; x += 1) paintBackground(x, y);

  for (let y = 0; y < inner; y += 1) {
    for (let x = 0; x < inner; x += 1) {
      if (circle && Math.hypot(x + offset + 0.5 - size / 2, y + offset + 0.5 - size / 2) > radius) continue;
      const sourceX = ((x + 0.5) * square.width) / inner;
      const sourceY = ((y + 0.5) * square.height) / inner;
      const pixel = sampleBilinear(square, sourceX - 0.5, sourceY - 0.5);
      if (pixel.a <= 0) continue;
      const target = ((y + offset) * size + (x + offset)) * 4;
      const alpha = pixel.a / 255;
      const dstAlpha = (output[target + 3] ?? 0) / 255;
      const outAlpha = alpha + dstAlpha * (1 - alpha);
      if (outAlpha <= 0) continue;
      output[target] = Math.round((pixel.r * alpha + (output[target] ?? 0) * dstAlpha * (1 - alpha)) / outAlpha);
      output[target + 1] = Math.round(
        (pixel.g * alpha + (output[target + 1] ?? 0) * dstAlpha * (1 - alpha)) / outAlpha,
      );
      output[target + 2] = Math.round(
        (pixel.b * alpha + (output[target + 2] ?? 0) * dstAlpha * (1 - alpha)) / outAlpha,
      );
      output[target + 3] = Math.round(outAlpha * 255);
    }
  }
  return { width: size, height: size, data: output };
}

/**
 * @param {Array<{ size: number, png: Buffer }>} images
 * @returns {Buffer}
 */
export function encodeIco(images) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(images.length, 4);
  const entries = Buffer.alloc(16 * images.length);
  let offset = 6 + entries.length;
  images.forEach((image, index) => {
    const start = index * 16;
    entries[start] = image.size >= 256 ? 0 : image.size;
    entries[start + 1] = image.size >= 256 ? 0 : image.size;
    entries[start + 2] = 0;
    entries[start + 3] = 0;
    entries.writeUInt16LE(1, start + 4);
    entries.writeUInt16LE(32, start + 6);
    entries.writeUInt32LE(image.png.length, start + 8);
    entries.writeUInt32LE(offset, start + 12);
    offset += image.png.length;
  });
  return Buffer.concat([header, entries, ...images.map((image) => image.png)]);
}

/**
 * 读取源图与环境配置。
 * @param {Record<string, string | undefined>} [env]
 * @returns {{ source: string, background: { r: number, g: number, b: number }, image: { width: number, height: number, data: Uint8Array } }}
 */
export function loadIconConfig(env = loadBuildEnv()) {
  const configured = String(env.APP_ICON ?? '').trim();
  const source = configured || DEFAULT_ICON;
  const absolute = path.isAbsolute(source) ? source : path.resolve(ROOT, source);
  if (!existsSync(absolute)) throw new Error(`APP_ICON 文件不存在：${absolute}`);
  const background = parseHexColor(env.APP_ICON_BACKGROUND || DEFAULT_BACKGROUND);
  return { source: absolute, background, image: decodePng(readFileSync(absolute)) };
}

/**
 * 生成站点与 PWA 图标到构建目录。
 * @param {string} distDir `web/dist`
 * @param {Record<string, string | undefined>} [env]
 * @returns {{ source: string, background: string }}
 */
export function buildWebIcons(distDir, env = loadBuildEnv()) {
  const config = loadIconConfig(env);
  const transparent = String(env.APP_ICON_TRANSPARENT ?? '') === '1';
  const background = transparent ? null : config.background;
  const iconsDir = path.join(distDir, 'icons');
  mkdirSync(iconsDir, { recursive: true });
  const png = (size, options = {}) => encodePng(renderIcon(config.image, size, { ...options, background }));
  writeFileSync(path.join(iconsDir, 'icon-192.png'), png(192));
  writeFileSync(path.join(iconsDir, 'icon-512.png'), png(512));
  writeFileSync(path.join(iconsDir, 'icon-1024.png'), png(1024));
  writeFileSync(path.join(iconsDir, 'maskable-512.png'), png(512, { scale: 0.8 }));
  writeFileSync(path.join(iconsDir, 'apple-touch-icon-180.png'), png(180));
  writeFileSync(path.join(iconsDir, 'favicon-32.png'), png(32));
  writeFileSync(path.join(distDir, 'favicon.ico'), encodeIco([16, 32, 48].map((size) => ({ size, png: png(size) }))));
  return { source: config.source, background: transparent ? 'transparent' : hexColor(config.background) };
}

/**
 * 生成 Android 启动图标、圆角图标与自适应图标前景，写进 Gradle 的资源目录。
 * @param {string} outDir `app/build/generated/icons/res`
 * @param {Record<string, string | undefined>} [env]
 * @returns {{ source: string, background: string }}
 */
export function buildAndroidIcons(outDir, env = loadBuildEnv()) {
  const config = loadIconConfig(env);
  const transparent = String(env.APP_ICON_TRANSPARENT ?? '') === '1';
  const background = transparent ? null : config.background;
  rmSync(outDir, { recursive: true, force: true });
  const png = (size, options = {}) => encodePng(renderIcon(config.image, size, { ...options, background }));
  for (const density of ANDROID_DENSITIES) {
    const dir = path.join(outDir, `mipmap-${density.name}`);
    mkdirSync(dir, { recursive: true });
    writeFileSync(path.join(dir, 'ic_launcher.png'), png(density.legacy));
    writeFileSync(path.join(dir, 'ic_launcher_round.png'), png(density.legacy, { circle: true }));
    writeFileSync(
      path.join(dir, 'ic_launcher_foreground.png'),
      encodePng(renderIcon(config.image, density.foreground, { scale: 0.6 })),
    );
  }
  if (!transparent) {
    const adaptiveDir = path.join(outDir, 'mipmap-anydpi-v26');
    mkdirSync(adaptiveDir, { recursive: true });
    const adaptive = `<?xml version="1.0" encoding="utf-8"?>\n<adaptive-icon xmlns:android="http://schemas.android.com/apk/res/android">\n    <background android:drawable="@color/ic_launcher_background" />\n    <foreground android:drawable="@mipmap/ic_launcher_foreground" />\n</adaptive-icon>\n`;
    writeFileSync(path.join(adaptiveDir, 'ic_launcher.xml'), adaptive);
    writeFileSync(path.join(adaptiveDir, 'ic_launcher_round.xml'), adaptive);
    const valuesDir = path.join(outDir, 'values');
    mkdirSync(valuesDir, { recursive: true });
    writeFileSync(
      path.join(valuesDir, 'ic_launcher_background.xml'),
      `<?xml version="1.0" encoding="utf-8"?>\n<resources>\n    <color name="ic_launcher_background">${hexColor(config.background)}</color>\n</resources>\n`,
    );
  }
  return { source: config.source, background: transparent ? 'transparent' : hexColor(config.background) };
}

/**
 * @param {string[]} argv
 */
function main(argv) {
  let target = 'all';
  let out = '';
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--target') {
      target = argv[index + 1] ?? '';
      index += 1;
    } else if (arg === '--out') {
      out = argv[index + 1] ?? '';
      index += 1;
    } else {
      throw new Error(`不认识的参数：${arg}`);
    }
  }
  if (!['web', 'android', 'all'].includes(target)) throw new Error(`--target 必须是 web / android / all：${target}`);
  if (target === 'all' && out) throw new Error('--target all 不能和 --out 一起用：站点图标和 Android 资源的目录不同');
  const env = loadBuildEnv();
  if (target === 'web' || target === 'all') {
    const result = buildWebIcons(out || path.join(ROOT, 'web', 'dist'), env);
    process.stdout.write(`站点 / PWA 图标已生成：${result.background}（${result.source}）\n`);
  }
  if (target === 'android' || target === 'all') {
    const result = buildAndroidIcons(out || path.join(ROOT, 'app', 'build', 'generated', 'icons', 'res'), env);
    process.stdout.write(`Android 图标已生成：${result.background}（${result.source}）\n`);
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  try {
    main(process.argv.slice(2));
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exit(1);
  }
}
