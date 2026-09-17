/**
 * 项目结构静态检查。
 *
 * 当前版本前端由 WebView 承载：
 *   - Android 侧：WebShellActivity + WebAppBridge + WebAppActions 提供界面外壳与业务桥接；
 *   - Web 侧：app/src/main/assets/web 下的页面模块按 newUI 的 17 屏拆分。
 *
 * 检查覆盖入口清单、桥接契约、页面文件、设计令牌与文档关键内容。
 * 用法：node scripts/smoke-check.js
 */

const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const WEB_ROOT = 'app/src/main/assets/web';

/**
 * 前端文案资源。
 * 源码里的中文字面量已改为 t('key')，断言时按资源还原成文案，
 * 这样“这一屏有没有某个文案”的结构检查仍然读得懂。
 */
const FRONTEND_STRINGS = (() => {
  const file = path.join(root, 'app/src/main/res/values/strings_frontend.xml');
  const map = new Map();
  if (!fs.existsSync(file)) {
    return map;
  }
  const xml = fs.readFileSync(file, 'utf8');
  for (const match of xml.matchAll(/<string name="(s_[a-z0-9]+)">([\s\S]*?)<\/string>/g)) {
    map.set(match[1], match[2]
      .replace(/\\'/g, "'")
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&amp;/g, '&'));
  }
  return map;
})();

/** 把 t('s_xxx') 还原为文案本体，便于对文件内容做文案断言。 */
function resolveStrings(content) {
  return content.replace(/\bt\('(s_[a-z0-9]+)'\)/g,
    (match, key) => (FRONTEND_STRINGS.has(key) ? FRONTEND_STRINGS.get(key) : match));
}

function parseAttributes(source) {
  const attributes = {};
  const attributePattern = /([:\w-]+)\s*=\s*(['"])(.*?)\2/g;
  let match;
  while ((match = attributePattern.exec(source)) !== null) {
    attributes[match[1]] = match[3];
  }
  return attributes;
}

function findComponents(xml) {
  const components = [];
  const stack = [];
  const tagPattern = /<!--[\s\S]*?-->|<[^>]+>/g;
  const source = xml.replace(/<!--[\s\S]*?-->/g, '');
  let match;

  while ((match = tagPattern.exec(source)) !== null) {
    const tag = match[0];
    if (tag.startsWith('<!--') || tag.startsWith('<?') || tag.startsWith('<!')) {
      continue;
    }
    if (tag.startsWith('</')) {
      const closedType = tag.match(/^<\/\s*([\w-]+)/)?.[1];
      const item = stack.pop();
      if (item?.type === 'component' && item.nameType === closedType) {
        components.push(item);
      }
      continue;
    }

    const opening = tag.match(/^<\s*([\w-]+)/);
    if (!opening) {
      continue;
    }
    const tagName = opening[1];
    const selfClosing = /\/\s*>$/.test(tag);
    const attributes = parseAttributes(tag);

    if (tagName === 'activity' || tagName === 'activity-alias') {
      const component = {
        type: 'component',
        nameType: tagName,
        name: attributes['android:name'],
        exported: attributes['android:exported'],
        launcher: false
      };
      if (selfClosing) {
        components.push(component);
      } else {
        stack.push(component);
      }
      continue;
    }

    if (tagName === 'intent-filter') {
      const filter = { type: 'filter', hasMain: false, hasLauncher: false };
      const component = [...stack].reverse().find((item) => item.type === 'component');
      if (component) {
        filter.component = component;
      }
      if (selfClosing) {
        continue;
      }
      stack.push(filter);
      continue;
    }

    if (tagName === 'action' || tagName === 'category') {
      const attributes = parseAttributes(tag);
      const filter = [...stack].reverse().find((item) => item.type === 'filter');
      if (filter && attributes['android:name'] === 'android.intent.action.MAIN' && tagName === 'action') {
        filter.hasMain = true;
      }
      if (filter && attributes['android:name'] === 'android.intent.category.LAUNCHER' && tagName === 'category') {
        filter.hasLauncher = true;
      }
      if (filter?.hasMain && filter?.hasLauncher) {
        filter.component.launcher = true;
      }
      continue;
    }

    if (!selfClosing) {
      stack.push({ type: 'other', nameType: tagName });
    }
  }

  return components;
}

function findLauncherActivities(xml) {
  return findComponents(xml)
    .filter((component) => component.launcher)
    .map((component) => component.name);
}

/** WebView 外壳是唯一启动入口，且必须显式导出。 */
function validateLauncherManifest(xml) {
  const launcherComponents = findComponents(xml).filter((component) => component.launcher);
  const launcherActivities = launcherComponents.map((component) => component.name);
  return launcherActivities.length === 1
    && launcherActivities[0] === '.WebShellActivity'
    && launcherComponents[0].exported === 'true';
}

function walkScripts(directory) {
  const files = [];
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const full = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...walkScripts(full));
    } else if (entry.name.endsWith('.js')) {
      files.push(full);
    }
  }
  return files;
}

/** 前端调用的动作名必须都在 WebAppActions 中实现。 */
function validateBridgeContract() {
  const actionsFile = 'app/src/main/java/com/example/calmobile/WebAppActions.java';
  const source = fs.readFileSync(path.join(root, actionsFile), 'utf8');
  const implemented = new Set();
  const casePattern = /case "([a-zA-Z.]+)":/g;
  let match;
  while ((match = casePattern.exec(source)) !== null) {
    implemented.add(match[1]);
  }
  if (implemented.size === 0) {
    return 'WebAppActions.java 中未解析到任何动作分支';
  }

  for (const file of walkScripts(path.join(root, WEB_ROOT, 'js'))) {
    const content = fs.readFileSync(file, 'utf8');
    const callPattern = /\bcall\(\s*'([a-zA-Z.]+)'/g;
    let callMatch;
    while ((callMatch = callPattern.exec(content)) !== null) {
      if (!implemented.has(callMatch[1])) {
        return `${path.relative(root, file)} 调用了未实现的动作 ${callMatch[1]}`;
      }
    }
  }
  return true;
}

/** newUI 的页面模块清单：17 屏中“管理-展会”“管理-设置”已内联，共 15 个模块。 */
const EXPECTED_PAGES = [
  'login.js',
  'home.js',
  'detail.js',
  'registration-form.js',
  'register.js',
  'search.js',
  'my-registrations.js',
  'registration-detail.js',
  'profile.js',
  'exhibitor.js',
  'exhibition-form.js',
  'rich-editor.js',
  'review.js',
  'user-public.js',
  'admin.js',
  // 展商后台的现场核销工具，不占独立设计稿
  'checkin.js'
];

function validateScreenFiles() {
  const missing = EXPECTED_PAGES.filter((file) => !fs.existsSync(path.join(root, WEB_ROOT, 'js', 'pages', file)));
  return missing.length === 0 ? true : `缺少页面模块：${missing.join(', ')}`;
}

const checks = [
  // ── 文档 ────────────────────────────────────────────────────────
  {
    id: 'project-documentation',
    file: 'README.md',
    contains: ['# CalMobile', '产品范围与角色', '已实现的关键交互', '路线图与已知限制']
  },
  {
    id: 'consolidated-requirements-document',
    file: 'README.md',
    contains: ['历史上的', '验收场景', '报名收集项']
  },
  {
    id: 'agent-rules',
    file: 'AGENTS.md',
    contains: ['# Repository Guidelines', 'Java 17', 'WebShellActivity', 'node scripts/smoke-check.js',
      'node --test scripts/webui-render.test.js']
  },
  {
    id: 'webui-documentation',
    file: 'README.md',
    contains: ['WebView', 'newUI', 'assets/web', 'WebAppBridge', 'EasyMDE']
  },

  // ── 构建与清单 ──────────────────────────────────────────────────
  {
    id: 'android-gradle-files',
    file: 'app/build.gradle',
    contains: ['compileSdk 34', 'targetSdk 34', "namespace 'com.example.calmobile'"]
  },
  {
    id: 'android-manifest-main-activity',
    file: 'app/src/main/AndroidManifest.xml',
    validate: validateLauncherManifest
  },
  {
    id: 'manifest-only-webview-entry',
    file: 'app/src/main/AndroidManifest.xml',
    contains: ['.WebShellActivity'],
    // 旧原生页面已随 WebView 迁移删除，清单里不应再出现它们的注册
    notContains: ['MainActivity', 'ExhibitionDetailActivity', 'RegistrationFormActivity',
      'AdminBackendActivity', 'RichDescriptionEditorActivity', 'LoginActivity', 'ProfileActivity']
  },
  {
    id: 'gradle-wrapper-properties',
    file: 'gradle/wrapper/gradle-wrapper.properties',
    contains: ['distributionUrl=https\\://services.gradle.org/distributions/gradle-8.5-bin.zip']
  },
  {
    id: 'gradle-wrapper-jar',
    file: 'gradle/wrapper/gradle-wrapper.jar',
    minBytes: 30000
  },

  // ── WebView 内核 ────────────────────────────────────────────────
  {
    id: 'web-shell-activity',
    file: 'app/src/main/java/com/example/calmobile/WebShellActivity.java',
    contains: ['package com.example.calmobile;', 'extends Activity', 'appassets.androidplatform.net',
      'addJavascriptInterface', 'shouldInterceptRequest', 'assets/web/']
  },
  {
    id: 'web-app-bridge',
    file: 'app/src/main/java/com/example/calmobile/WebAppBridge.java',
    contains: ['@JavascriptInterface', 'public void invoke(', 'CalMobileBridge', 'onActivityResult',
      'onRequestPermissionsResult']
  },
  {
    id: 'web-app-actions',
    // 业务动作按域拆分后，Manager 调用分散在各动作类；分发入口只保留动作清单。
    file: 'app/src/main/java/com/example/calmobile/WebAppActions.java',
    contains: ['case "bootstrap":', 'case "exhibitions.save":', 'case "registrations.submit":',
      'case "review.updateStatus":', 'case "users.list":']
  },
  {
    id: 'native-managers-wired',
    // 各域类仍然复用既有 Manager / 配置，没有另起一套业务规则
    file: 'app/src/main/java/com/example/calmobile/ExhibitionActions.java',
    contains: ['ExhibitionManager', 'ExhibitionConfiguration', 'RegistrationField']
  },
  {
    id: 'bridge-contract',
    file: 'app/src/main/java/com/example/calmobile/WebAppActions.java',
    validate: validateBridgeContract
  },
  {
    id: 'review-store-shared',
    file: 'app/src/main/java/com/example/calmobile/RegistrationReviewStore.java',
    contains: ['public final class RegistrationReviewStore', 'STATUS_PENDING', 'STATUS_APPROVED', 'STATUS_REJECTED']
  },
  {
    id: 'profile-store',
    file: 'app/src/main/java/com/example/calmobile/UserProfileStore.java',
    contains: ['public final class UserProfileStore', 'showRegistrations']
  },
  {
    id: 'exhibition-status-modes',
    file: 'app/src/main/java/com/example/calmobile/ExhibitorExhibition.java',
    contains: ['STATUS_REVIEW_REQUIRED', 'STATUS_REVIEW_OPTIONAL', 'STATUS_DISPLAY_ONLY']
  },
  {
    id: 'media-limits-persisted',
    file: 'app/src/main/java/com/example/calmobile/AppSettings.java',
    contains: ['getMediaImageLimit', 'getMediaImageSizeMb', 'getMediaVideoLimit', 'saveMediaLimits',
      'saveUploadLimits', 'saveTextLimits', 'getAnswerLimit']
  },
  {
    id: 'media-uploaded-as-url',
    // 落盘逻辑已随拆分移入 MediaActions
    file: 'app/src/main/java/com/example/calmobile/MediaActions.java',
    contains: ['inlineDataUrlsToFiles', 'storeDataUrl', 'storeUri', 'MEDIA_URL', 'importMedia']
  },
  {
    id: 'media-url-served-by-shell',
    file: 'app/src/main/java/com/example/calmobile/WebShellActivity.java',
    contains: ['MEDIA_URL', 'serveMedia', 'mediaDir']
  },
  {
    id: 'review-optional-auto-approve',
    file: 'app/src/main/java/com/example/calmobile/RegistrationActions.java',
    contains: ['autoApprove', 'STATUS_REVIEW_OPTIONAL', 'autoApproved']
  },
  {
    id: 'avatar-and-region-profile',
    file: 'app/src/main/java/com/example/calmobile/UserProfileStore.java',
    contains: ['public String region', 'public String avatar', 'showRegistrations']
  },
  {
    id: 'description-format-persisted',
    file: 'app/src/main/java/com/example/calmobile/ExhibitionConfiguration.java',
    contains: ['descriptionFormat', 'registrationQrEnabled', 'isRegistrationQrEnabled',
      'saveRegistrationQr']
  },
  {
    id: 'registration-code-and-checkin',
    file: 'app/src/main/java/com/example/calmobile/RegistrationActions.java',
    contains: ['REGISTRATION_CODE_PREFIX', 'registrationCode', 'parseCheckInCode',
      'STATUS_ATTENDED', 'canCheckInExhibition']
  },
  {
    id: 'attended-status-defined',
    file: 'app/src/main/java/com/example/calmobile/RegistrationReviewStore.java',
    contains: ['STATUS_ATTENDED']
  },
  {
    id: 'camera-permission-declared',
    file: 'app/src/main/AndroidManifest.xml',
    contains: ['android.permission.CAMERA', 'android.hardware.camera']
  },
  {
    id: 'webview-grants-camera',
    file: 'app/src/main/java/com/example/calmobile/WebShellActivity.java',
    contains: ['RESOURCE_VIDEO_CAPTURE', 'hasCameraPermission', 'PERMISSION_GRANTED']
  },
  {
    id: 'admin-can-always-review',
    file: 'app/src/main/java/com/example/calmobile/RegistrationActions.java',
    contains: ['AuthManager.getInstance().isAdmin()']
  },
  {
    id: 'admin-public-profile-unrestricted',
    file: 'app/src/main/java/com/example/calmobile/AdminActions.java',
    contains: ['viewedAsAdmin', 'asAdmin']
  },
  {
    id: 'ui-mode-persisted',
    file: 'app/src/main/java/com/example/calmobile/AppSettings.java',
    contains: ['getUiMode', 'setUiMode', 'MODE_DARK', 'isDarkMode', 'getScreenColor']
  },

  // ── Web 前端资源 ────────────────────────────────────────────────
  {
    id: 'web-entry-file',
    file: `${WEB_ROOT}/index.html`,
    contains: ['styles/tokens.css', 'js/app.js', 'id="app"']
  },
  {
    id: 'web-tokens',
    file: `${WEB_ROOT}/styles/tokens.css`,
    contains: ['--bg: #f7f6f3', '--screen: #ffffff', '--ink: #20252b', '--ink-2: #626a74',
      '--stroke: #c5cad1', '--accent: #c05621', '--dark: #48515d', '--touch: 44px']
  },
  {
    id: 'web-bridge-module',
    file: `${WEB_ROOT}/js/core/bridge.js`,
    contains: ['CalMobileNative', 'CalMobileBridge', 'export function call', 'export const state']
  },
  {
    id: 'web-router-module',
    file: `${WEB_ROOT}/js/core/router.js`,
    contains: ['export function defineRoute', 'export function navigate', 'export function back',
      'export function navItems']
  },
  {
    id: 'web-components-module',
    file: `${WEB_ROOT}/js/ui/components.js`,
    contains: ['export function topbar', 'export function segmented', 'export function stateBlock',
      'export function openSheet', 'export function toast', 'export function avatarNode',
      'export function openAvatarCropper', 'seg-indicator']
  },
  {
    id: 'web-validate-module',
    file: `${WEB_ROOT}/js/core/validate.js`,
    contains: ['export function fieldValidator', 'export function validateAll', 'export function limit',
      'state.limits', 'state.server']
  },
  {
    id: 'web-server-limits-forms',
    file: `${WEB_ROOT}/js/pages/admin.js`,
    contains: ['服务器设置', '允许的图片后缀', '头像大小上限', '表单字符数上限', 'TABS']
  },
  {
    id: 'web-server-settings-not-in-profile',
    file: `${WEB_ROOT}/js/pages/profile.js`,
    notContains: ['用户公开页', '展会分类管理', '富文本媒体限制', '设置范围明确']
  },
  {
    id: 'web-media-url-reference',
    file: `${WEB_ROOT}/js/pages/rich-editor.js`,
    contains: ["call('media.import'", 'allowedFormats'],
    notContains: ['data:image/jpeg;base64']
  },
  {
    id: 'web-calendar-swipe',
    file: `${WEB_ROOT}/js/pages/home.js`,
    contains: ['calendar-swipe', 'SWIPE_THRESHOLD', 'data-rows', 'shiftMonth']
  },
  {
    id: 'web-sanitizer',
    file: `${WEB_ROOT}/js/core/sanitize.js`,
    contains: ['export function sanitizeHtml', 'ALLOWED_TAGS']
  },
  {
    id: 'web-markdown-module',
    file: `${WEB_ROOT}/js/core/markdown.js`,
    contains: ['export function markdownToHtml', 'export function htmlToMarkdown', 'sanitizeHtml']
  },
  {
    id: 'web-motion-styles',
    file: `${WEB_ROOT}/styles/motion.css`,
    contains: ['page-in-forward', 'drawer-up', 'toast-out', 'prefers-reduced-motion',
      'cal-in-right', 'cal-out-left', 'seg-indicator']
  },
  {
    id: 'web-portrait-cover-ratio',
    file: `${WEB_ROOT}/styles/tokens.css`,
    contains: ['aspect-ratio: 1080 / 1920', 'thumb-cover', 'hero-compact', 'crop-stage']
  },
  {
    id: 'web-calendar-six-rows',
    file: `${WEB_ROOT}/styles/tokens.css`,
    contains: ['.calendar[data-rows="6"]', '.calendar-swipe', '.tabbar-indicator']
  },
  {
    id: 'web-accent-theme-applied',
    file: `${WEB_ROOT}/js/core/bridge.js`,
    contains: ['export function applyTheme', '--accent-tint', '--accent-glow', 'export function applySettings']
  },
  {
    id: 'web-accent-drives-controls',
    file: `${WEB_ROOT}/styles/tokens.css`,
    contains: ['background: var(--accent);', '.switch input:checked + span', '.seg-indicator',
      '.cal-day[aria-pressed="true"]', '.tabbar-indicator'],
    notContains: ['.topbar-title::after']
  },
  {
    id: 'web-topbar-uniform-height',
    file: `${WEB_ROOT}/styles/tokens.css`,
    contains: ['--topbar-h: 68px', 'min-height: calc(var(--safe-top) + var(--topbar-h))']
  },
  {
    id: 'app-title-setting',
    file: 'app/src/main/java/com/example/calmobile/AppSettings.java',
    contains: ['getAppTitleZh', 'getAppTitleEn', 'saveAppTitle', 'DEFAULT_APP_TITLE_ZH']
  },
  {
    id: 'app-title-bridge-and-pages',
    file: `${WEB_ROOT}/js/pages/admin.js`,
    contains: ['软件标题', 'appTitleZh', 'appTitleEn']
  },
  {
    id: 'app-title-shown-on-pages',
    file: `${WEB_ROOT}/js/pages/home.js`,
    contains: ['state.brand.en', 'state.brand.zh']
  },
  {
    id: 'web-vendor-easymde',
    file: `${WEB_ROOT}/vendor/easymde/easymde.min.js`,
    minBytes: 100000
  },
  {
    id: 'web-vendor-license',
    file: `${WEB_ROOT}/vendor/easymde/LICENSE`,
    contains: ['MIT']
  },
  {
    id: 'web-vendor-qrcode-generator',
    file: `${WEB_ROOT}/vendor/qrcode-generator/qrcode.js`,
    minBytes: 40000
  },
  {
    id: 'web-vendor-qrcode-license',
    file: `${WEB_ROOT}/vendor/qrcode-generator/LICENSE`,
    contains: ['MIT License', 'Kazuhiko Arase']
  },
  {
    id: 'web-vendor-jsqr',
    file: `${WEB_ROOT}/vendor/jsqr/jsQR.js`,
    minBytes: 200000
  },
  {
    id: 'web-vendor-jsqr-license',
    file: `${WEB_ROOT}/vendor/jsqr/LICENSE`,
    contains: ['Apache License']
  },
  {
    id: 'web-vendor-scripts-in-entry',
    file: `${WEB_ROOT}/index.html`,
    // 内置脚本改为按需加载，入口只引 core/vendor.js 加载器。
    contains: ['js/app.js'],
    notContains: ['vendor/jsqr/jsQR.js', 'vendor/qrcode-generator/qrcode.js']
  },
  {
    id: 'web-strings-pipeline',
    file: `${WEB_ROOT}/js/core/strings.js`,
    contains: ['export function t', 'applyStrings', 'CalMobileStrings']
  },
  {
    id: 'web-strings-resources',
    file: 'app/src/main/res/values/strings_frontend.xml',
    minBytes: 20000
  },
  {
    id: 'web-strings-native-injection',
    file: 'app/src/main/java/com/example/calmobile/InjectStrings.java',
    contains: ['getIdentifier', 'FrontendStrings.NAMES', 'CalMobileStrings']
  },
  {
    id: 'web-strings-injected-early',
    file: 'app/src/main/java/com/example/calmobile/WebShellActivity.java',
    contains: ['onPageStarted', 'InjectStrings.load', 'InjectStrings.script']
  },
  {
    id: 'web-asset-cache',
    file: 'app/src/main/java/com/example/calmobile/WebShellActivity.java',
    contains: ['max-age=86400', 'assetHeaders']
  },
  {
    id: 'web-dark-mode-tokens',
    file: `${WEB_ROOT}/styles/tokens.css`,
    contains: [':root[data-mode="dark"]', 'prefers-color-scheme: dark', '--on-dark', '--scrim',
      'color-scheme: dark']
  },
  {
    id: 'web-bridge-dark-mode',
    file: `${WEB_ROOT}/js/core/bridge.js`,
    contains: ['export function applyMode', 'export function effectiveMode', 'calmobile.mode',
      'data-mode']
  },
  {
    id: 'web-dark-mode-toggle',
    file: `${WEB_ROOT}/js/pages/profile.js`,
    contains: ['深色模式', 'settingsApi.saveUiMode', 'applyMode']
  },
  {
    id: 'web-api-entry',
    file: `${WEB_ROOT}/js/core/api.js`,
    contains: ['export const api', 'exhibitions', 'registrations', 'review', 'checkIn', 'settingsApi']
  },
  {
    id: 'frontend-api-transport',
    file: `${WEB_ROOT}/js/core/api.js`,
    contains: ['BASE_URL', 'export async function probe', 'TransportError', 'callRemote', 'request(',
      'CACHE_TTL', 'clearCache']
  },
  {
    id: 'frontend-lazy-vendors',
    file: `${WEB_ROOT}/index.html`,
    contains: ['js/core/vendor.js'],
    notContains: ['vendor/jsqr/jsQR.js', 'vendor/qrcode-generator/qrcode.js', 'vendor/easymde']
  },
  {
    id: 'frontend-vendor-loader',
    file: `${WEB_ROOT}/js/core/vendor.js`,
    contains: ['export function loadScript', 'loadQrEncoder', 'loadQrDecoder', 'loadStyle']
  },
  {
    id: 'frontend-startup-timing',
    file: `${WEB_ROOT}/js/core/bridge.js`,
    contains: ['export function mark', 'export function reportTimings', '__CALMOBILE_TIMING__']
  },
  {
    id: 'demo-backend',
    file: 'server/src/demo-server.js',
    contains: ['createServer', 'Access-Control-Allow-Origin', 'demo-api', 'DEMO_PORT']
  },
  {
    id: 'demo-backend-api-surface',
    file: 'server/src/demo-api.js',
    contains: ["'exhibitions.month'", "'checkin.scan'", "'settings.uiMode'", 'parseCheckInCode']
  },
  {
    id: 'frontend-backend-contract-test',
    file: 'server/test/demo-api.test.js',
    contains: ['exhibitions.list', 'checkInCode', 'qrEnabled', 'viewedAsAdmin']
  },
  {
    id: 'docs-frontend-backend-boundary',
    file: 'README.md',
    contains: ['前后端边界', 'core/api.js', 'adb reverse', 'server/test/demo-api.test.js']
  },
  {
    id: 'web-accent-light-background',
    file: `${WEB_ROOT}/styles/tokens.css`,
    contains: ['.cta.ghost', 'background: var(--screen)'],
    notContains: ['.cta.ghost {\n    background: var(--accent-tint)']
  },
  {
    id: 'web-tap-highlight-removed',
    file: `${WEB_ROOT}/styles/tokens.css`,
    contains: [':focus-visible', '-webkit-tap-highlight-color: transparent']
  },
  {
    id: 'web-calendar-dot-centered',
    file: `${WEB_ROOT}/styles/tokens.css`,
    contains: ['.cal-day[data-has-event="true"]::after', 'align-items: center']
  },
  {
    id: 'web-calendar-selection-no-box',
    file: `${WEB_ROOT}/styles/tokens.css`,
    contains: ['--accent-tint: #ffffff', '.cal-day-num', '.cal-day[aria-pressed="true"]',
      'border-bottom-color: var(--accent)']
  },
  {
    id: 'web-avatar-pinch-zoom',
    file: `${WEB_ROOT}/js/ui/components.js`,
    contains: ['pinchStartDistance', 'focalPoint', 'crop-scale'],
    notContains: ['crop-zoom']
  },
  {
    id: 'web-exhibitor-card-trimmed',
    file: `${WEB_ROOT}/js/pages/exhibitor.js`,
    contains: ['编辑展会', '查看报名', '核销报名码'],
    // 卡片上只留“查看报名 / 编辑展会”，其余动作都搬进编辑展会的二级界面
    notContains: ["actionButton('报名方式'", "actionButton('编辑简介'", "actionButton('删除展会'",
      'askDelete', 'changeStatus(']
  },
  {
    id: 'web-exhibition-form-secondary-actions',
    file: `${WEB_ROOT}/js/pages/exhibition-form.js`,
    contains: ['删除展会', '报名与简介设置', 'qrEnabled', 'descriptionButton']
  },
  {
    id: 'web-admin-tab-persisted',
    file: `${WEB_ROOT}/js/pages/admin.js`,
    contains: ['lastTab', 'keepTabInUrl']
  },
  {
    id: 'web-registration-code-shown',
    file: `${WEB_ROOT}/js/pages/registration-detail.js`,
    contains: ['checkInCode', 'drawQr', 'window.qrcode']
  },
  {
    id: 'web-checkin-page',
    file: `${WEB_ROOT}/js/pages/checkin.js`,
    contains: ['checkin.scan', 'camera.ensurePermission', 'jsQR', 'onPageStop']
  },
  {
    id: 'device-qr-verification-script',
    file: 'scripts/decode-shot.js',
    contains: ['decodePng', 'inversionAttempts', 'vendor/jsqr']
  },
  {
    id: 'web-screen-files',
    file: `${WEB_ROOT}/js/app.js`,
    validate: validateScreenFiles
  },
  {
    id: 'web-app-route-registry',
    file: `${WEB_ROOT}/js/app.js`,
    contains: ["defineRoute('login'", "defineRoute('home'", "defineRoute('detail'",
      "defineRoute('registration-form'", "defineRoute('profile'", "defineRoute('admin'",
      "defineRoute('checkin'"]
  },
  {
    id: 'no-secondary-admin-pages',
    file: `${WEB_ROOT}/js/app.js`,
    notContains: ['admin-exhibitions', 'admin-settings']
  },

  // ── 复用中的原生能力 ────────────────────────────────────────────
  {
    id: 'native-actions-dispatcher',
    // 分发入口只做路由：不出现任何业务实现细节
    file: 'app/src/main/java/com/example/calmobile/WebAppActions.java',
    contains: ['static void handle(', 'SessionActions.bootstrap', 'RegistrationActions.checkIn',
      'MediaActions.exportCsv'],
    notContains: ['ExhibitionManager.findById', 'DatabaseHelper.getInstance()']
  },
  {
    id: 'native-actions-split',
    file: 'scripts/split-webapp-actions.js',
    // 拆分脚本自身：按方法边界切分 + 归属覆盖校验
    contains: ['function scanMethods', 'OWNERS', 'FAIL 以下方法没有分配归属',
      'git', 'WebAppActions.java']
  },
  {
    id: 'native-actions-checklist',
    file: 'app/src/main/java/com/example/calmobile/WebAppActions.java',
    contains: ['case "checkin.scan":', 'case "camera.ensurePermission":', 'case "settings.uiMode":',
      'case "export.csv":']
  },
  {
    id: 'native-actions-domains',
    file: 'app/src/main/java/com/example/calmobile/SessionActions.java',
    contains: ['static Map<String, Object> bootstrap(', 'static Map<String, Object> userPayload(']
  },
  {
    id: 'legacy-removed',
    // 旧原生页面与其专属资源已删除，仓库里不应再出现
    file: 'app/src/main/AndroidManifest.xml',
    notContains: ['legacy', 'BaseActivity', 'MainTabState']
  },
  {
    id: 'strings-kept',
    file: 'app/src/main/res/values/strings.xml',
    // 只保留应用名与 CalendarHelper 用到的提示；前端文案在 strings_frontend.xml
    contains: ['app_name', 'calendar_added', 'calendar_permission_denied', 'calendar_removed']
  },
  {
    id: 'resources-trimmed',
    file: 'app/src/main/AndroidManifest.xml',
    contains: ['@style/AppTheme'],
    notContains: []
  }
];

function runChecks() {
  let failed = false;
  for (const check of checks) {
    const fullPath = path.join(root, check.file);
    if (!fs.existsSync(fullPath)) {
      console.error(`FAIL ${check.id}: missing ${check.file}`);
      failed = true;
      continue;
    }
    const stat = fs.statSync(fullPath);
    if (check.minBytes && stat.size < check.minBytes) {
      console.error(`FAIL ${check.id}: ${check.file} is ${stat.size} bytes, expected at least ${check.minBytes}`);
      failed = true;
    }
    // 断言前把 t('key') 还原成文案，前端文案迁移到资源后依然可读。
    const content = resolveStrings(fs.readFileSync(fullPath, 'utf8'));
    if (check.validate) {
      const result = check.validate(content);
      if (result !== true) {
        const detail = typeof result === 'string' ? result : 'failed its structural validation';
        console.error(`FAIL ${check.id}: ${check.file} ${detail}`);
        failed = true;
        continue;
      }
    }
    if (check.contains) {
      for (const expected of check.contains) {
        if (!content.includes(expected)) {
          console.error(`FAIL ${check.id}: ${check.file} does not contain ${expected}`);
          failed = true;
        }
      }
    }
    if (check.notContains) {
      for (const forbidden of check.notContains) {
        if (content.includes(forbidden)) {
          console.error(`FAIL ${check.id}: ${check.file} should not contain ${forbidden}`);
          failed = true;
        }
      }
    }
  }

  if (failed) {
    return false;
  }

  console.log(`PASS smoke-check: ${checks.length} project scaffold checks passed`);
  return true;
}

if (require.main === module) {
  process.exitCode = runChecks() ? 0 : 1;
}

module.exports = {
  EXPECTED_PAGES,
  findLauncherActivities,
  runChecks,
  validateLauncherManifest
};
