import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
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

/** 四边透明、中心不透明的图，用来断言透明模式没有铺底色。 */
function transparentEdgePng(size, color = { r: 255, g: 0, b: 0 }) {
  const data = new Uint8Array(size * size * 4);
  for (let y = 1; y < size - 1; y += 1) {
    for (let x = 1; x < size - 1; x += 1) {
      const index = (y * size + x) * 4;
      data[index] = color.r;
      data[index + 1] = color.g;
      data[index + 2] = color.b;
      data[index + 3] = 255;
    }
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
    assert.equal(pngSize(readFileSync(path.join(dir, 'icons', 'icon-1024.png'))), '1024x1024');
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

test('APP_ICON_TRANSPARENT 生成透明站点图标，四角 alpha 为 0', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'calmobile-icons-transparent-'));
  try {
    const source = path.join(dir, 'edge.png');
    writeFileSync(source, transparentEdgePng(8));
    const out = path.join(dir, 'dist');
    const result = buildWebIcons(out, {
      APP_ICON: source,
      APP_ICON_TRANSPARENT: '1',
    });
    assert.equal(result.background, 'transparent');
    const icon = decodePng(readFileSync(path.join(out, 'icons', 'icon-192.png')));
    assert.equal(icon.data[3], 0, '左上角应透明');
    const center = (96 * 192 + 96) * 4;
    assert.equal(icon.data[center + 3], 255, '中心应不透明');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('透明模式下 Apple 主屏幕图标按图标深浅补黑 / 白底，其它图标仍透明', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'calmobile-icons-apple-'));
  try {
    const dark = path.join(dir, 'dark.png');
    const light = path.join(dir, 'light.png');
    writeFileSync(dark, transparentEdgePng(8, { r: 8, g: 16, b: 40 }));
    writeFileSync(light, transparentEdgePng(8, { r: 250, g: 245, b: 235 }));

    const darkOut = path.join(dir, 'dark-dist');
    buildWebIcons(darkOut, { APP_ICON: dark, APP_ICON_BACKGROUND: '#123456', APP_ICON_TRANSPARENT: '1' });
    const darkApple = decodePng(readFileSync(path.join(darkOut, 'icons', 'apple-touch-icon-180.png')));
    assert.equal(darkApple.width, 180);
    assert.deepEqual([...darkApple.data.subarray(0, 4)], [0, 0, 0, 255], '深色图标应铺黑底，不能留透明');
    const center = (90 * 180 + 90) * 4;
    assert.deepEqual([...darkApple.data.subarray(center, center + 4)], [8, 16, 40, 255], '中心仍是源图');

    const lightOut = path.join(dir, 'light-dist');
    buildWebIcons(lightOut, { APP_ICON: light, APP_ICON_BACKGROUND: '#123456', APP_ICON_TRANSPARENT: '1' });
    const lightApple = decodePng(readFileSync(path.join(lightOut, 'icons', 'apple-touch-icon-180.png')));
    assert.deepEqual([...lightApple.data.subarray(0, 4)], [255, 255, 255, 255], '浅色图标应铺白底');

    // 同一份构建里其它 PWA 图标保持透明：只处理 Apple 主屏幕这一枚。
    assert.equal(decodePng(readFileSync(path.join(lightOut, 'icons', 'icon-192.png'))).data[3], 0);

    // 不透明模式不受影响：仍用管理员配置的 APP_ICON_BACKGROUND。
    const opaqueOut = path.join(dir, 'opaque-dist');
    buildWebIcons(opaqueOut, { APP_ICON: dark, APP_ICON_BACKGROUND: '#123456' });
    const opaqueApple = decodePng(readFileSync(path.join(opaqueOut, 'icons', 'apple-touch-icon-180.png')));
    assert.deepEqual([...opaqueApple.data.subarray(0, 4)], [0x12, 0x34, 0x56, 255]);
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

test('Android 透明模式不生成 adaptive，legacy 图标四角透明', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'calmobile-icons-android-transparent-'));
  try {
    const source = path.join(dir, 'edge.png');
    writeFileSync(source, transparentEdgePng(8));
    const out = path.join(dir, 'res');
    const result = buildAndroidIcons(out, { APP_ICON: source, APP_ICON_TRANSPARENT: '1' });
    assert.equal(result.background, 'transparent');
    assert.equal(existsSync(path.join(out, 'mipmap-anydpi-v26')), false);
    assert.equal(existsSync(path.join(out, 'values')), false);
    const legacy = decodePng(readFileSync(path.join(out, 'mipmap-xxxhdpi', 'ic_launcher.png')));
    assert.equal(legacy.data[3], 0, '左上角应透明');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
