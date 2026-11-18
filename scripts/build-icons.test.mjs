import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import {
  DEFAULT_BACKGROUND,
  buildAndroidIcons,
  buildWebIcons,
  decodePng,
  encodePng,
  parseHexColor,
  renderIcon,
} from './build-icons.mjs';

/** 生成一张纯色测试 PNG，避免测试依赖额外的图片库。 */
function solidPng(size, color) {
  const data = new Uint8Array(size * size * 4);
  for (let index = 0; index < size * size; index += 1) {
    data[index * 4] = color.r;
    data[index * 4 + 1] = color.g;
    data[index * 4 + 2] = color.b;
    data[index * 4 + 3] = 255;
  }
  return encodePng({ width: size, height: size, data });
}

function pngSize(buffer) {
  const image = decodePng(buffer);
  return `${image.width}x${image.height}`;
}

test('颜色解析接受 #rgb / #rrggbb，非法值报错', () => {
  assert.deepEqual(parseHexColor('#41707e'), { r: 65, g: 112, b: 126 });
  assert.deepEqual(parseHexColor('f00'), { r: 255, g: 0, b: 0 });
  assert.throws(() => parseHexColor('not-a-color'), /十六进制/);
});

test('PNG 编解码保持尺寸与颜色', () => {
  const source = solidPng(4, { r: 10, g: 20, b: 30 });
  const decoded = decodePng(source);
  assert.equal(decoded.width, 4);
  assert.equal(decoded.height, 4);
  assert.deepEqual([...decoded.data.subarray(0, 4)], [10, 20, 30, 255]);
});

test('renderIcon 输出指定尺寸，圆角图标四角透明、中心不透明', () => {
  const source = decodePng(solidPng(8, { r: 255, g: 0, b: 0 }));
  const square = renderIcon(source, 16, { background: { r: 0, g: 0, b: 255 }, scale: 0.5 });
  assert.equal(square.width, 16);
  assert.deepEqual([...square.data.subarray(0, 4)], [0, 0, 255, 255]);
  const center = (8 * 16 + 8) * 4;
  assert.deepEqual([...square.data.subarray(center, center + 4)], [255, 0, 0, 255]);

  const round = renderIcon(source, 16, { background: { r: 0, g: 0, b: 255 }, circle: true });
  assert.equal(round.data[3], 0, '圆角图标左上角应当透明');
  assert.ok((round.data[center + 3] ?? 0) > 0, '圆角图标中心应当不透明');
});

test('站点与 PWA 图标从 APP_ICON 生成，favicon 是 3 个 PNG 条目的 ICO', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'calmobile-icons-web-'));
  try {
    const result = buildWebIcons(dir, {
      APP_ICON: 'web/public/icons/icon-1024.png',
      APP_ICON_BACKGROUND: '#123456',
    });
    assert.equal(result.background, '#123456');
    assert.equal(pngSize(readFileSync(path.join(dir, 'icons', 'icon-192.png'))), '192x192');
    assert.equal(pngSize(readFileSync(path.join(dir, 'icons', 'icon-512.png'))), '512x512');
    assert.equal(pngSize(readFileSync(path.join(dir, 'icons', 'maskable-512.png'))), '512x512');
    assert.equal(pngSize(readFileSync(path.join(dir, 'icons', 'apple-touch-icon-180.png'))), '180x180');
    assert.equal(pngSize(readFileSync(path.join(dir, 'icons', 'favicon-32.png'))), '32x32');

    const ico = readFileSync(path.join(dir, 'favicon.ico'));
    assert.equal(ico.readUInt16LE(0), 0);
    assert.equal(ico.readUInt16LE(2), 1);
    assert.equal(ico.readUInt16LE(4), 3);
    assert.equal(ico[6], 16);
    assert.equal(ico[22], 32);
    assert.equal(ico[38], 48);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('自定义 APP_ICON 的尺寸与颜色进入 PWA 图标', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'calmobile-icons-custom-'));
  try {
    const source = path.join(dir, 'red.png');
    writeFileSync(source, solidPng(4, { r: 255, g: 0, b: 0 }));
    const out = path.join(dir, 'dist');
    buildWebIcons(out, { APP_ICON: source, APP_ICON_BACKGROUND: '#000000' });
    const icon = decodePng(readFileSync(path.join(out, 'icons', 'icon-192.png')));
    assert.equal(icon.width, 192);
    assert.deepEqual([...icon.data.subarray(0, 4)], [255, 0, 0, 255]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('Android 图标覆盖 5 个密度、圆角与自适应前景', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'calmobile-icons-android-'));
  try {
    buildAndroidIcons(dir, {
      APP_ICON: 'web/public/icons/icon-1024.png',
      APP_ICON_BACKGROUND: DEFAULT_BACKGROUND,
    });
    const sizes = { mdpi: 48, hdpi: 72, xhdpi: 96, xxhdpi: 144, xxxhdpi: 192 };
    for (const [density, size] of Object.entries(sizes)) {
      const legacy = path.join(dir, `mipmap-${density}`, 'ic_launcher.png');
      const round = path.join(dir, `mipmap-${density}`, 'ic_launcher_round.png');
      const foreground = path.join(dir, `mipmap-${density}`, 'ic_launcher_foreground.png');
      assert.ok(statSync(legacy).isFile());
      assert.equal(pngSize(readFileSync(legacy)), `${size}x${size}`);
      assert.equal(pngSize(readFileSync(round)), `${size}x${size}`);
      assert.equal(pngSize(readFileSync(foreground)), `${(size * 9) / 4}x${(size * 9) / 4}`);
    }
    const adaptive = readFileSync(path.join(dir, 'mipmap-anydpi-v26', 'ic_launcher.xml'), 'utf8');
    assert.match(adaptive, /@color\/ic_launcher_background/);
    assert.match(adaptive, /@mipmap\/ic_launcher_foreground/);
    const color = readFileSync(path.join(dir, 'values', 'ic_launcher_background.xml'), 'utf8');
    assert.match(color, new RegExp(DEFAULT_BACKGROUND));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
