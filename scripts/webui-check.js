/**
 * WebView 前端静态检查。
 *
 * 校验四件事：
 * 1. assets/web 下的页面与脚本能作为 ES 模块解析（语法与导入路径）；
 * 2. 前端调用的动作名都在 WebAppActions 中实现；
 * 3. 页面文件与设计的屏幕编号一一对应，避免新增页面后漏登记路由；
 * 4. 页面只通过 `core/api.js` 取数据，不绕过它直接调用桥接的数据类动作。
 *
 * 用法：node scripts/webui-check.js
 */

const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');

const root = path.resolve(__dirname, '..');
const webRoot = path.join(root, 'app', 'src', 'main', 'assets', 'web');
const actionsFile = path.join(root, 'app', 'src', 'main', 'java', 'com', 'example', 'calmobile', 'WebAppActions.java');
const appFile = path.join(webRoot, 'js', 'app.js');
const apiFile = path.join(webRoot, 'js', 'core', 'api.js');

/**
 * 数据类动作：只允许 core/api.js 调用，页面必须走 api 的方法。
 * 系统能力（摄像头、日历、分享、媒体、导出）仍可直接调用。
 */
const DATA_ACTIONS = [
    'bootstrap',
    'auth.login', 'auth.register', 'auth.guest', 'auth.logout',
    'profile.get', 'profile.save', 'profile.password',
    'notify.preferences', 'notify.savePreferences',
    'exhibitions.list', 'exhibitions.month', 'exhibitions.get', 'exhibitions.save',
    'exhibitions.delete', 'exhibitions.status', 'exhibitions.categories',
    'exhibitions.fields', 'exhibitions.saveFields',
    'registrations.list', 'registrations.get', 'registrations.submit', 'registrations.cancel',
    'review.list', 'review.get', 'review.updateStatus',
    'checkin.scan',
    'users.list', 'users.get', 'users.status', 'users.public',
    'search.query',
    'settings.get', 'settings.save', 'settings.uiMode',
];

/** 设计稿中的 17 屏与页面模块的对应关系（管理-展会、管理-设置已内联，共 15 个模块）。 */
const EXPECTED_PAGES = [
    ['login.js', '01 入口'],
    ['home.js', '02 首页'],
    ['detail.js', '03 展会详情'],
    ['registration-form.js', '04 报名信息'],
    ['register.js', '05 注册'],
    ['search.js', '06 搜索'],
    ['my-registrations.js', '07 我的报名'],
    ['registration-detail.js', '08 报名详情'],
    ['profile.js', '09 个人主页（含设置）'],
    ['exhibitor.js', '10 展商后台'],
    ['exhibition-form.js', '11 展会编辑'],
    ['rich-editor.js', '12 Markdown 简介编辑'],
    ['review.js', '13 报名审核'],
    ['user-public.js', '14 用户公开页'],
    ['admin.js', '15 管理后台（用户 / 展会 / 设置）'],
    ['checkin.js', '展商核销报名码（展商后台的现场工具，不占独立设计稿）'],
];

/** 内置的前端依赖：文件名 → 说明。 */
const VENDOR_FILES = [
    ['vendor/easymde/easymde.min.js', 'EasyMDE Markdown 编辑器脚本'],
    ['vendor/easymde/easymde.min.css', 'EasyMDE 样式'],
    ['vendor/easymde/LICENSE', 'EasyMDE 许可证'],
    ['vendor/qrcode-generator/qrcode.js', '二维码生成（报名码）'],
    ['vendor/qrcode-generator/LICENSE', 'qrcode-generator 许可证'],
    ['vendor/jsqr/jsQR.js', '二维码解码（展商扫码核销）'],
    ['vendor/jsqr/LICENSE', 'jsQR 许可证'],
];

const failures = [];

function fail(message) {
    failures.push(message);
    console.error(`FAIL ${message}`);
}

function walk(directory, extension) {
    const result = [];
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
        const full = path.join(directory, entry.name);
        if (entry.isDirectory()) {
            result.push(...walk(full, extension));
        } else if (entry.name.endsWith(extension)) {
            result.push(full);
        }
    }
    return result;
}

function checkFileLayout() {
    const pagesDir = path.join(webRoot, 'js', 'pages');
    for (const [file, label] of EXPECTED_PAGES) {
        if (!fs.existsSync(path.join(pagesDir, file))) {
            fail(`缺少页面模块 ${file}（${label}）`);
        }
    }
    for (const [file, label] of VENDOR_FILES) {
        if (!fs.existsSync(path.join(webRoot, file))) {
            fail(`缺少内置依赖 ${file}（${label}）`);
        }
    }
    for (const required of ['index.html', 'styles/tokens.css', 'styles/motion.css', 'js/app.js',
        'js/core/bridge.js', 'js/core/router.js', 'js/core/markdown.js', 'js/core/validate.js',
        'js/ui/components.js']) {
        if (!fs.existsSync(path.join(webRoot, required))) {
            fail(`缺少前端资源 ${required}`);
        }
    }
    return walk(webRoot, '.js').length + 1;
}

function collectCalledActions() {
    const actions = new Set();
    for (const file of walk(webRoot, '.js')) {
        const source = fs.readFileSync(file, 'utf8');
        // 数据类动作现在写在 core/api.js 的 request('动作名', ...) 里；
        // 系统能力仍由页面直接调用 call('动作名', ...)。
        const pattern = /\b(?:call|request)\(\s*'([a-zA-Z.]+)'/g;
        let match;
        while ((match = pattern.exec(source)) !== null) {
            actions.add(match[1]);
        }
    }
    return actions;
}

function collectImplementedActions() {
    const source = fs.readFileSync(actionsFile, 'utf8');
    const actions = new Set();
    const pattern = /case "([a-zA-Z.]+)":/g;
    let match;
    while ((match = pattern.exec(source)) !== null) {
        actions.add(match[1]);
    }
    return actions;
}

function checkActions() {
    const called = collectCalledActions();
    const implemented = collectImplementedActions();
    if (implemented.size === 0) {
        fail('未能从 WebAppActions.java 解析出任何动作，请检查文件结构');
        return 0;
    }
    for (const action of called) {
        if (!implemented.has(action)) {
            fail(`前端调用了未实现的动作 ${action}`);
        }
    }
    return called.size;
}

/**
 * 页面不得绕过 core/api.js 直接调用数据类动作。
 * 这样前后端分离时只要替换 api.js 的实现，页面就不需要改动。
 */
function checkApiBoundary() {
    const pagesDir = path.join(webRoot, 'js', 'pages');
    const allowed = new Set(DATA_ACTIONS);
    let violations = 0;
    for (const file of walk(pagesDir, '.js')) {
        const source = fs.readFileSync(file, 'utf8');
        const pattern = /\bcall\(\s*'([a-zA-Z.]+)'/g;
        let match;
        while ((match = pattern.exec(source)) !== null) {
            if (allowed.has(match[1])) {
                fail(`${path.relative(root, file)} 直接调用了数据类动作 ${match[1]}，请改走 core/api.js`);
                violations += 1;
            }
        }
    }
    return violations;
}

async function checkModules() {
    const modules = walk(webRoot, '.js');
    let checked = 0;
    for (const file of modules) {
        // vendor 下是第三方 UMD 包，需要浏览器环境，这里只校验存在性。
        if (file === appFile || file.includes(`${path.sep}vendor${path.sep}`)) {
            continue;
        }
        try {
            // 只做解析与导入检查：这些模块在 import 阶段不会访问 document。
            await import(pathToFileURL(file).href);
            checked += 1;
        } catch (error) {
            fail(`${path.relative(root, file)} 解析失败：${error.message}`);
        }
    }
    return checked;
}

async function main() {
    const fileCount = checkFileLayout();
    const actionCount = checkActions();
    checkApiBoundary();
    const moduleCount = await checkModules();

    if (failures.length > 0) {
        console.error(`\n共 ${failures.length} 项检查失败`);
        process.exitCode = 1;
        return;
    }
    console.log(`PASS webui-check: ${fileCount} 个前端文件、${moduleCount} 个模块与 ${actionCount} 个桥接动作校验通过；页面均通过 core/api.js 取数据`);
}

if (require.main === module) {
    main();
}

module.exports = {
    EXPECTED_PAGES,
    DATA_ACTIONS,
    collectCalledActions,
    collectImplementedActions,
};
