import assert from 'node:assert/strict';
import { clientBranding, resolveBranding } from './branding.js';

test('没有品牌环境变量时全部回落到构建期默认值', () => {
  const branding = resolveBranding({});
  assert.equal(branding.appActive, false);
  assert.equal(branding.joinActive, false);
  assert.deepEqual(branding.warnings, []);
  assert.deepEqual(clientBranding(branding), {});
});

test('运行时 PWA 名称、标题、描述与颜色被解析成实例身份', () => {
  const branding = resolveBranding({
    PWA_APP_NAME: '活动排期助手',
    PWA_APP_SHORT_NAME: '青枳',
    PWA_APP_DESCRIPTION: '青枳 · 活动日历',
    APP_TITLE: '青枳 · 活动排期助手',
    JOIN_TITLE: '青枳',
    PWA_LANG: 'zh-CN',
    PWA_THEME_COLOR: '#FDCC32',
    PWA_THEME_COLOR_DARK: '#101215',
    PWA_BACKGROUND_COLOR: '#f7f6f3',
  });
  assert.equal(branding.appActive, true);
  assert.equal(branding.joinActive, true);
  assert.equal(branding.indexActive, true);
  assert.equal(branding.manifestActive, true);
  assert.deepEqual(clientBranding(branding), {
    appName: '活动排期助手',
    shortName: '青枳',
    description: '青枳 · 活动日历',
    appTitle: '青枳 · 活动排期助手',
    joinTitle: '青枳',
    lang: 'zh-CN',
    themeColor: '#FDCC32',
    themeColorDark: '#101215',
    backgroundColor: '#f7f6f3',
  });
});

test('只配报名站标题不会触发应用页面层', () => {
  const branding = resolveBranding({ JOIN_TITLE: '青枳' });
  assert.equal(branding.appActive, false);
  assert.equal(branding.joinActive, true);
  assert.equal(branding.indexActive, false);
  assert.equal(branding.manifestActive, false);
});

test('只配图标会触发页面层，但不改 index 与 manifest', () => {
  const branding = resolveBranding({ APP_ICON: '/srv/icon.png' });
  assert.equal(branding.appActive, true);
  assert.equal(branding.indexActive, false);
  assert.equal(branding.manifestActive, false);
  assert.equal(branding.icon, '/srv/icon.png');
});

test('非法颜色与语言标签被忽略并给 warning', () => {
  const branding = resolveBranding({
    PWA_THEME_COLOR: 'warm',
    PWA_THEME_COLOR_DARK: '#abc',
    PWA_LANG: 'not a lang',
  });
  assert.equal(branding.themeColor, '');
  assert.equal(branding.themeColorDark, '#abc');
  assert.equal(branding.lang, '');
  assert.ok(branding.warnings.some((item) => item.includes('PWA_THEME_COLOR')));
  assert.ok(branding.warnings.some((item) => item.includes('PWA_LANG')));
});

test('文本压成单行，过长只提示不拒绝启动', () => {
  const branding = resolveBranding({
    PWA_APP_NAME: '  活动\n排期   助手  ',
    PWA_APP_SHORT_NAME: '青'.repeat(30),
  });
  assert.equal(branding.appName, '活动 排期 助手');
  assert.equal(branding.shortName.length, 30);
  assert.ok(branding.warnings.some((item) => item.includes('PWA_APP_SHORT_NAME')));
});

test('APP_ICON 与 PWA_ICON_DIR 同时配置时优先预生成目录并提示', () => {
  const branding = resolveBranding({
    APP_ICON: '/srv/icon.png',
    PWA_ICON_DIR: '/srv/icons',
  });
  assert.equal(branding.icon, '/srv/icon.png');
  assert.equal(branding.iconDir, '/srv/icons');
  assert.ok(branding.warnings.some((item) => item.includes('PWA_ICON_DIR')));
});
