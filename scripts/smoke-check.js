/**
 * 项目结构静态检查。
 *
 * 当前版本前端由 WebView 承载：
 *   - Android 侧：WebShellActivity + WebAppBridge + WebAppActions 提供界面外壳与
 *     系统能力桥接（权限、日历、媒体、分享、导出），不再持有任何业务数据；
 *   - Web 侧：app/src/main/assets/web 下的页面模块按 newUI 的 17 屏拆分；
 *   - 数据侧：展会、报名、用户、设置与认证全部来自 server/ 的 Express + PostgreSQL 后端。
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

/**
 * 把 t('s_xxx') 还原为文案本体，便于对文件内容做文案断言。
 *
 * 单/双引号与括号内的多余空格都要认：只认 `t('s_xxx')` 时，`t("s_xxx")` 会原样留在
 * 文本里，下面那些「这一屏有没有某段文案」的断言就悄悄失效了。
 * 与 `scripts/check-strings.js`、`scripts/extract-strings.js` 保持同一条正则。
 */
const T_CALL = /\bt\(\s*(['"])(s_[a-z0-9]+)\1\s*\)/g;

function resolveStrings(content) {
  return content.replace(T_CALL,
    (match, quote, key) => (FRONTEND_STRINGS.has(key) ? FRONTEND_STRINGS.get(key) : match));
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
  const casePattern = /case "([a-zA-Z0-9.]+)":/g;
  let match;
  while ((match = casePattern.exec(source)) !== null) {
    implemented.add(match[1]);
  }
  if (implemented.size === 0) {
    return 'WebAppActions.java 中未解析到任何动作分支';
  }

  for (const file of walkScripts(path.join(root, WEB_ROOT, 'js'))) {
    const content = fs.readFileSync(file, 'utf8');
    const callPattern = /\bcall\(\s*'([a-zA-Z0-9.]+)'/g;
    let callMatch;
    while ((callMatch = callPattern.exec(content)) !== null) {
      if (!implemented.has(callMatch[1])) {
        return `${path.relative(root, file)} 调用了未实现的动作 ${callMatch[1]}`;
      }
    }
  }
  return true;
}

/**
 * 前端是**原生 ES 模块，没有打包器**：`import … from '…'` 只能写相对路径或绝对路径。
 *
 * 裸标识符（例如 `from 'core/strings.js'`）在浏览器 / WebView 里解析不了，整份模块直接报错 ——
 * `extract-strings.js` 补 `t` 的导入时曾经写出过这种写法（`path.relative` 对 `js/app.js`
 * 给出的是 `core/strings.js`，少了 `./`），而它只在真机加载时才炸。
 */
function validateModuleSpecifiers() {
  for (const file of walkScripts(path.join(root, WEB_ROOT, 'js'))) {
    const content = fs.readFileSync(file, 'utf8');
    for (const match of content.matchAll(/from\s+['"]([^'"]+)['"]/g)) {
      const specifier = match[1];
      if (!specifier.startsWith('.') && !specifier.startsWith('/')) {
        return `${path.relative(root, file)} 用了裸标识符 import "${specifier}"，浏览器解析不了`;
      }
    }
  }
  return true;
}

/**
 * JS 与 Java 之间的回调参数必须一一对应。
 *
 * `onResult(callbackId, ok, result, error, code)` 的 5 个参数是冻结契约：第 5 个 `code`
 * 是稳定错误码（`'cancelled'` / `'timeout'`），页面据此判断可预期的失败，
 * 不再靠匹配失败文案。两边任一侧少写一个参数（例如前端还是 4 个参数），
 * `error.code` 就会静默变成 undefined，取消分支集体失效。
 */
const BRIDGE_ON_RESULT_PARAMS = 5;

function validateOnResultArity() {
  const jsFile = `${WEB_ROOT}/js/core/bridge.js`;
  const js = resolveStrings(fs.readFileSync(path.join(root, jsFile), 'utf8'));
  const jsSignature = /window\.CalMobileBridge\s*=\s*\{[\s\S]*?onResult\(([^)]*)\)/.exec(js);
  if (!jsSignature) {
    return `${jsFile} 中没有解析到 window.CalMobileBridge.onResult 的定义`;
  }
  const jsParams = jsSignature[1].split(',').map((item) => item.trim()).filter(Boolean);
  if (jsParams.length !== BRIDGE_ON_RESULT_PARAMS) {
    return `${jsFile} 的 onResult 有 ${jsParams.length} 个参数（${jsParams.join(', ')}），契约要求 ${BRIDGE_ON_RESULT_PARAMS} 个`;
  }
  if (jsParams[4] !== 'code') {
    return `${jsFile} 的 onResult 第 5 个参数应为 code，实际是 ${jsParams[4]}`;
  }
  // 页面必须真的按码判断，而不是把参数收下就丢掉。
  if (!js.includes('error.code = code')) {
    return `${jsFile} 没有把收到的 code 挂到 Error 上（缺 error.code = code）`;
  }
  // 兜底超时也要给自己的错误打上 code，否则超时会被页面当成真失败弹红字。
  if (!/withCode\(new Error\([^)]*超时未响应[^)]*\),\s*'timeout'\)/.test(js)) {
    return `${jsFile} 的兜底超时没有打上 code = 'timeout'`;
  }

  const javaFile = 'app/src/main/java/com/example/calmobile/WebAppBridge.java';
  const java = fs.readFileSync(path.join(root, javaFile), 'utf8');
  // 原生拼给 WebView 的那段 JS 必须把第 5 个参数（codeArg）真的传进去。
  // `&amp;&amp;` 是为了只命中拼 JS 字符串的那一次调用，别抓到 Java 里的 `respond(...)` 定义。
  const javaCall = /CalMobileBridge&&window\.CalMobileBridge\.onResult\(([\s\S]*?)\);/.exec(java);
  if (!javaCall) {
    return `${javaFile} 中没有解析到 CalMobileBridge.onResult 的调用`;
  }
  const passed = javaCall[1].split(',').length;
  if (passed !== BRIDGE_ON_RESULT_PARAMS) {
    return `${javaFile} 调用 onResult 时传了 ${passed} 个参数，契约要求 ${BRIDGE_ON_RESULT_PARAMS} 个（第 5 个是错误码）`;
  }
  if (!java.includes('CODE_CANCELLED') || !java.includes('CODE_TIMEOUT')) {
    return `${javaFile} 没有定义 cancelled / timeout 两个稳定错误码`;
  }
  return true;
}

/** newUI 的页面模块清单：17 屏中“管理-展会”“管理-设置”已内联，另有核销与找回密码两个工具页。 */
const EXPECTED_PAGES = [
  'login.js',
  'home.js',
  'detail.js',
  'registration-form.js',
  'register.js',
  // 找回密码：邮箱验证码 + 新密码，不占独立设计稿
  'forgot-password.js',
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

/**
 * 已删除的原生数据层文件。
 *
 * 展会、报名、用户、设置与认证现在只由 `server/` 提供，原生侧不再持有本机实现；
 * 这些文件重新出现，就说明「后端不可用时退回本机数据」那套又回来了。
 */
const REMOVED_NATIVE_DATA_FILES = [
  'ActionSupport.java',
  'AdminActions.java',
  'AdminUser.java',
  'AdminUserManager.java',
  'AuthManager.java',
  'DatabaseHelper.java',
  'ExhibitionActions.java',
  'ExhibitionCatalog.java',
  'ExhibitionConfiguration.java',
  'ExhibitionManager.java',
  'ExhibitorExhibition.java',
  'ProfileActions.java',
  'Registration.java',
  'RegistrationActions.java',
  'RegistrationField.java',
  'RegistrationManager.java',
  'RegistrationReviewStore.java',
  'SessionActions.java',
  'UserProfileStore.java'
];

/** 原生数据层必须已经删除干净。 */
function findNativeDataLayer() {
  const directory = path.join(root, 'app/src/main/java/com/example/calmobile');
  const found = REMOVED_NATIVE_DATA_FILES.filter((file) => fs.existsSync(path.join(directory, file)));
  return found.length === 0 ? true : `原生数据层文件又出现了：${found.join(', ')}`;
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
    // README 是唯一的需求/验收来源，且只描述当前状态（不记变更历史）
    file: 'README.md',
    contains: ['验收场景', '报名收集项', '待裁决清单（未决项）'],
    notContains: ['## 变更记录', '历史上的 `TODO.md`'],
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
    // AGP 9 + Gradle 9：属性用赋值式（`compileSdk = 36.1`），方法调用式在 Gradle 10 会被移除
    file: 'app/build.gradle',
    contains: ['compileSdk = 36.1', 'targetSdk = 34', "namespace = 'com.example.calmobile'",
      'sourceCompatibility JavaVersion.VERSION_17']
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
    contains: ['distributionUrl=https\\://services.gradle.org/distributions/gradle-9.7.1-bin.zip']
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
    // 原生数据层已删除：分发入口只剩 10 个系统能力动作，数据全部走 server/ 的 HTTP 接口。
    file: 'app/src/main/java/com/example/calmobile/WebAppActions.java',
    contains: ['case "ui.sync":', 'case "camera.ensurePermission":', 'case "calendar.status":',
      'case "calendar.toggle":', 'case "notify.requestPermission":', 'case "media.pickImage":',
      'case "media.import":', 'case "media.store":', 'case "share.text":', 'case "export.csv":']
  },
  {
    id: 'native-device-mirror',
    // AppSettings 从「数据权威来源」降级成设备侧镜像：外观模式、系统栏配色与媒体上限
    file: 'app/src/main/java/com/example/calmobile/AppSettings.java',
    contains: ['normalizeMode', 'setUiMode', 'applyWindowColors', 'saveMediaLimits', 'saveUploadLimits']
  },
  {
    id: 'bridge-contract',
    file: 'app/src/main/java/com/example/calmobile/WebAppActions.java',
    validate: validateBridgeContract
  },
  {
    // 原生 ES 模块没有打包器：import 的路径只能是相对的，裸标识符在 WebView 里直接解析失败。
    id: 'web-module-specifiers',
    file: `${WEB_ROOT}/js/app.js`,
    validate: validateModuleSpecifiers
  },
  {
    // 回传结果的 5 个参数（第 5 个是稳定错误码 code）是 JS 与 Java 的共同契约：
    // 只校验动作名，会让「前端还是 4 个参数 / 原生忘了传码」这类脱节悄悄放过。
    id: 'bridge-onresult-arity',
    file: `${WEB_ROOT}/js/core/bridge.js`,
    validate: validateOnResultArity
  },
  {
    id: 'review-store-shared',
    // 审核状态词汇现在只由服务端维护；状态存英文代码、中文标签在 labels.js 映射一次
    file: 'server/src/domain/labels.js',
    contains: ['REGISTRATION_STATUS', 'pending', 'approved', 'rejected', 'cancelled', 'attended']
  },
  {
    id: 'profile-store',
    file: 'server/src/routes/profile.js',
    contains: ['showRegistrations', 'show_registrations']
  },
  {
    id: 'exhibition-status-modes',
    file: 'server/src/domain/labels.js',
    contains: ['EXHIBITION_STATUS', 'review', 'optional', 'display', 'closed', 'ended']
  },
  {
    id: 'media-limits-persisted',
    // 表单字符数上限已随服务器设置移到后端，设备侧只镜像媒体与上传上限
    file: 'app/src/main/java/com/example/calmobile/AppSettings.java',
    contains: ['getMediaImageLimit', 'getMediaImageSizeMb', 'getMediaVideoLimit',
      'getMediaVideoSizeMb', 'saveMediaLimits', 'saveUploadLimits']
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
    // 「无需审核」提交即通过的规则现在在服务端兜住
    file: 'server/src/routes/registrations.js',
    contains: ['autoApproved', "=== 'optional'", "'approved' : 'pending'"]
  },
  {
    id: 'avatar-and-region-profile',
    file: 'server/src/domain/payloads.js',
    contains: ['region', 'avatar', 'showRegistrations']
  },
  {
    id: 'description-format-persisted',
    file: 'server/src/routes/exhibitions.js',
    contains: ['descriptionFormat', 'qrEnabled']
  },
  {
    id: 'registration-code-and-checkin',
    // 报名码前缀与解析与前端 core/status.js 约定同一批字符串，只由服务端实现一次
    file: 'server/src/domain/labels.js',
    contains: ['CODE_PREFIX', 'checkInCode', 'parseCheckInCode', 'acceptsRegistration']
  },
  {
    id: 'attended-status-defined',
    file: 'server/src/routes/checkin.js',
    contains: ['parseCheckInCode', "'attended'", 'duplicated']
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
    // 展商与管理员都能审核；展商只能碰自己举办的展会
    file: 'server/src/routes/review.js',
    contains: ['requireExhibitor', 'canManageExhibition']
  },
  {
    id: 'admin-public-profile-unrestricted',
    file: 'server/src/routes/users.js',
    contains: ['viewedAsAdmin', 'showRegistrations']
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
    // 图片与视频两个入口并列在工具栏里，两者都只写短 URL（不再写内联 base64）。
    contains: ["call('media.import'", 'allowedFormats', "name: 'image'", "name: 'video'"],
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
    // 软件中英文标题属于服务器级配置，默认值与补丁规则都在服务端
    file: 'server/src/domain/settings.js',
    contains: ['appTitleZh', 'appTitleEn', 'DEFAULT_SETTINGS']
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
    // 脚本与样式用 `no-cache`（可以缓存，但每次都要回源校验），而不是 `max-age`：
    // 覆盖安装 APK 不会清掉 WebView 的 HTTP 缓存，而缓存键只有 URL，
    // `max-age` 会出现「新外壳配旧 JS 模块」这种只在升级当天复现的错乱；
    // 资源本来就在 APK 里，回源的代价只是重读一次 assets。
    contains: ['no-cache', 'assetHeaders']
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
    // 断言真实实现：深色模式写在 <html> 的 dataset.mode 上（即 data-mode 属性），
    // 字符串 "data-mode" 只出现在注释里，断言它等于什么都没校验。
    contains: ['export function applyMode', 'export function effectiveMode', 'calmobile.mode',
      'documentElement.dataset.mode']
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
    // 数据只在后端：api.js 只保留 HTTP 一条路，不该再出现原生降级入口
    file: `${WEB_ROOT}/js/core/api.js`,
    contains: ['BASE_URL', 'TransportError', 'callRemote', 'request(',
      'CACHE_TTL', 'clearCache'],
    notContains: ['export async function probe', 'export function transport', 'from \'./bridge.js\'']
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
    id: 'backend-contract-test',
    // 契约测试断言的是真实 REST 路径与字段，以及前后端路由交叉校验
    file: 'server/test/api.test.js',
    contains: ['/api/v1/exhibitions', 'checkInCode', 'qrEnabled', 'viewedAsAdmin',
      '前端每个数据动作都对应后端已注册的路由'],
  },
  {
    id: 'backend-status-page',
    // 健康状态页：服务与数据库都能一眼看到
    file: 'server/src/routes/status.js',
    contains: ['migrations', 'pool', 'endpoints'],
  },
  {
    id: 'backend-mail-channel',
    // 邮件通道：三条路（console / smtp / memory），且 memory 在生产必须被拦 ——
    // 否则线上会「发信成功」而用户永远收不到验证码。nodemailer 只在 smtp 分支延迟加载。
    file: 'server/src/services/mailer.js',
    contains: ['memory', 'console', 'smtp', 'nodemailer', 'outbox', 'closeTransporter'],
  },
  {
    id: 'backend-mail-config-guards',
    file: 'server/src/config/mail.js',
    contains: ["['console', 'smtp', 'memory']", '生产环境不能用 memory', 'MAIL_SMTP_HOST',
      'MAIL_FROM_ADDRESS', 'configured', 'describeMailConfig'],
  },
  {
    id: 'backend-mail-templates-no-links',
    // 验证码邮件不放链接（钓鱼特征会拉低送达率）；主题与品牌名要先清洗（邮件头注入）
    file: 'server/src/services/mail-templates.js',
    contains: ['verificationMail', 'sanitizeHeader', 'escapeHtml', 'subjectSuffix'],
    notContains: ['http://', 'https://', '<a href'],
  },
  {
    id: 'backend-mail-dev-sink',
    // 本地收件箱：Mailpit 容器（SMTP 1025 / 收件箱 8025），不进真实邮箱
    file: 'scripts/mail.ps1',
    contains: ['calmobile-mail', 'axllent/mailpit', '1025', '8025', 'console'],
  },
  {
    id: 'backend-mail-migration',
    // 邮箱从「联系方式」升级为「身份」：唯一索引 + 验证码 / 预认证票 / 发信留痕三张表
    file: 'server/src/config/migrate.js',
    contains: ['0004-email-verification', 'email_verified', 'two_factor_enabled',
      'users_email_unique_idx', 'email_codes', 'preauth_tickets', 'mail_log'],
  },
  {
    id: 'backend-register-two-stage',
    // 注册是两步的：第一步只发码不建号 —— 库里不该存在「注册了但邮箱没验证」的账号
    file: 'server/src/routes/auth.js',
    contains: ["router.post('/register'", "router.post('/register/verify'", 'isCodeRejected',
      'email_verified', 'issueCode', 'consumeCode'],
  },
  {
    id: 'backend-otp-rules',
    // 验证码：只存哈希、等长比较、命中即原子消费、限流按库里行数算、发信留痕
    file: 'server/src/domain/otp.js',
    contains: ['sha256', 'timingSafeEqual', 'consumed_at IS NULL', 'RESEND_COOLDOWN_SEC',
      'CodeRejected', 'mail_log'],
  },
  {
    id: 'backend-two-factor-ticket',
    // 两步验证：密码对了也只发预认证票（「密码对」≠「登录成功」），票单次使用、只存哈希
    file: 'server/src/routes/auth.js',
    contains: ['twoFactorRequired', 'issueTicket', 'consumeTicket', 'maskEmail'],
  },
  {
    id: 'backend-preauth-ticket-single-use',
    file: 'server/src/domain/preauth.js',
    contains: ['consumed_at IS NULL', 'token_hash', 'MAX_TICKET_ATTEMPTS'],
  },
  {
    id: 'backend-email-is-identity',
    // 邮箱是身份：改邮箱只能走「验证新地址」，PUT /profile 不再写 email
    file: 'server/src/routes/profile.js',
    contains: ["邮箱需要通过「验证新邮箱」修改", 'two_factor_enabled', 'security'],
  },
  {
    id: 'backend-start-is-production',
    // npm start 必须进生产模式：状态页会关、启动自检会跑
    file: 'server/package.json',
    contains: ['"start": "node src/index.js --production"', '"dev": "nodemon src/index.js"',
      '"db:migrate:prod"'],
  },
  {
    id: 'backend-runtime-modes',
    file: 'server/src/config/runtime.js',
    contains: ['resolveRuntime', '--production', 'statusPageEnabled', 'trustProxy'],
  },
  {
    id: 'backend-status-page-gated',
    // 生产默认关掉状态页；生产启动前必须做配置自检
    file: 'server/src/index.js',
    contains: ['runtime.statusPageEnabled', 'productionProblems', '状态页在生产环境已关闭',
      "app.disable('x-powered-by')"],
  },
  {
    id: 'backend-production-guards',
    file: 'server/src/config/production.js',
    contains: ['productionProblems', 'MAIL_TRANSPORT=console', 'DB_PASSWORD 还是 postgres',
      'local-dev', 'TRUST_PROXY'],
  },
  {
    id: 'backend-totp-rfc6238',
    // 自己实现 OTP：base32 + HOTP 动态截断 + ±1 步窗口，且密钥加密存储、备用码只存哈希
    file: 'server/src/domain/totp.js',
    contains: ['HMAC', 'sha1', 'base32Decode', 'aes-256-gcm', 'otpauth://totp/',
      'generateBackupCodes', 'hashBackupCode'],
  },
  {
    id: 'backend-second-factor-methods',
    // 三种第二因子并列可用：验证器 → 邮箱验证码 → 备用码；备用码命中即原子消费
    file: 'server/src/domain/two-factor.js',
    contains: ['verifySecondFactor', 'consumeBackupCode', 'used_at IS NULL', 'confirmTotpSetup',
      'regenerateBackupCodes'],
  },
  {
    id: 'backend-login-totp-invisible-until-verified',
    // 绑了验证器就不自动发邮件码（省一封多半用不上的信，也避开 60 秒冷却）
    file: 'server/src/routes/auth.js',
    contains: ['emailSent', 'methods: {', 'twoFactorRequired'],
  },
  {
    id: 'docs-frontend-backend-boundary',
    file: 'README.md',
    contains: ['前后端边界', 'core/api.js', 'adb reverse', 'server/test/api.test.js']
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
    // “查看报名 / 编辑展会”是卡片上仅有的两个入口（`smallCta`）；核销报名码在页首。
    contains: ['smallCta(', "context.navigate('review'", 'openExhibitionForm(', '核销报名码'],
    // 卡片上不能再出现这些入口：报名方式、编辑简介与删除展会都搬进“编辑展会”的二级界面。
    // 断言带上调用语法，避免命中文件头的说明性注释（注释里确实会写到这些名字）。
    notContains: ["actionButton('报名方式'", "actionButton('编辑简介'", "actionButton('删除展会'",
      'askDelete(', 'changeStatus(']
  },
  {
    id: 'limited-scope-notice',
    // 受限范围已扩大到一切展会写操作与核销，展商后台的说明必须跟着走：
    // 「仍可查看与审核已有展会」那条旧说法与当前限制不符（它曾让人以为还能编辑）。
    // 该文案是 t('s_1yv1vu0')，源码里只剩 key，所以断言资源本体。
    file: 'app/src/main/res/values/strings_frontend.xml',
    contains: [
      '<string name="s_1yv1vu0">账号已被限制，不能发布或修改展会、不能核销；仍可查看与审核已有报名。</string>',
      '<string name="s_14pxh3f">账号已被限制，不能核销</string>',
      '<string name="s_1wwetl9">账号已被限制，不能修改展会</string>'
    ],
    notContains: ['仍可查看与审核已有展会与报名']
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
    contains: ['checkInCode', 'qrCanvas']
  },
  {
    id: 'web-qr-canvas-component',
    // 二维码绘制集中在 ui/components.js：报名码与「绑定验证器」共用一套，
    // 且必须保持白底深点的高对比（深色模式不跟随主题反色，否则相机扫不出来）
    file: `${WEB_ROOT}/js/ui/components.js`,
    contains: ['export function qrCanvas', 'window.qrcode', "fillStyle = '#ffffff'", "fillStyle = '#20252b'"]
  },
  {
    id: 'web-checkin-page',
    // 核销走 core/api.js 的 checkIn（REST），只有摄像头权限是原生动作
    file: `${WEB_ROOT}/js/pages/checkin.js`,
    contains: ["import { checkIn }", 'await checkIn(', 'camera.ensurePermission', 'loadQrDecoder(', 'onPageStop']
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
    // 分发入口只做路由：不出现任何业务实现细节，只剩系统能力
    file: 'app/src/main/java/com/example/calmobile/WebAppActions.java',
    contains: ['static void handle(', 'SystemActions.calendarStatus', 'SystemActions.ensureCameraPermission',
      'MediaActions.exportCsv'],
    notContains: ['ExhibitionManager.findById', 'DatabaseHelper.getInstance()']
  },
  {
    id: 'native-actions-checklist',
    // 保留的系统动作；数据动作与 toast / pickVideo / imageData 已随数据层删除
    file: 'app/src/main/java/com/example/calmobile/WebAppActions.java',
    contains: ['case "camera.ensurePermission":', 'case "calendar.toggle":', 'case "export.csv":'],
    notContains: ['case "toast":', 'case "media.pickVideo":', 'case "media.imageData":',
      'case "bootstrap":', 'case "checkin.scan":', 'case "settings.uiMode":']
  },
  {
    id: 'native-actions-domains',
    // 系统能力只按「日历 / 权限 / 设备镜像」一个域收口
    file: 'app/src/main/java/com/example/calmobile/SystemActions.java',
    contains: ['static Map<String, Object> syncDeviceMirror(', 'static Map<String, Object> calendarStatus(']
  },
  {
    id: 'native-data-layer-removed',
    // 原生数据层（SQLite、内存示例数据与各数据域动作类）已删除：数据只由 server/ 提供。
    // 这些文件再出现，说明又加回了一套本机实现，前后端立即会分叉。
    file: 'app/src/main/java/com/example/calmobile/WebAppActions.java',
    validate: () => findNativeDataLayer()
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
    // 只保留应用名与 CalendarHelper / SystemActions 用到的日历提示；
    // 前端文案在 strings_frontend.xml（主按钮文案随功能增删，不做断言）
    contains: ['app_name', 'calendar_added', 'calendar_permission_denied', 'calendar_removed',
      'calendar_invalid_date']
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
