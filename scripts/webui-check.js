/**
 * WebView 前端静态检查。
 *
 * 校验三件事：
 * 1. assets/web 下的页面与脚本能作为 ES 模块解析（语法与导入路径）；
 * 2. 前端调用的动作名都在 WebAppActions 中实现；
 * 3. 页面文件与设计的屏幕编号一一对应，避免新增页面后漏登记路由。
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

/** 设计稿中的 17 屏与页面模块的对应关系。 */
const EXPECTED_PAGES = [
    ['login.js', '01 入口'],
    ['home.js', '02 首页'],
    ['detail.js', '03 展会详情'],
    ['registration-form.js', '04 报名信息'],
    ['register.js', '05 注册'],
    ['search.js', '06 搜索'],
    ['my-registrations.js', '07 我的报名'],
    ['registration-detail.js', '08 报名详情'],
    ['profile.js', '09 个人主页'],
    ['exhibitor.js', '10 展商后台'],
    ['exhibition-form.js', '11 展会编辑'],
    ['rich-editor.js', '12 富文本编辑'],
    ['review.js', '13 报名审核'],
    ['user-public.js', '14 用户公开页'],
    ['admin.js', '15 管理后台'],
    ['admin-exhibitions.js', '16 展会管理'],
    ['admin-settings.js', '17 系统设置'],
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
    for (const required of ['index.html', 'styles/tokens.css', 'js/app.js', 'js/core/bridge.js', 'js/core/router.js', 'js/ui/components.js']) {
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
        const pattern = /\bcall\(\s*'([a-zA-Z.]+)'/g;
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

async function checkModules() {
    const modules = walk(webRoot, '.js');
    let checked = 0;
    for (const file of modules) {
        if (file === appFile) {
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
    const moduleCount = await checkModules();

    if (failures.length > 0) {
        console.error(`\n共 ${failures.length} 项检查失败`);
        process.exitCode = 1;
        return;
    }
    console.log(`PASS webui-check: ${fileCount} 个前端文件、${moduleCount} 个模块与 ${actionCount} 个桥接动作校验通过`);
}

if (require.main === module) {
    main();
}

module.exports = { EXPECTED_PAGES, collectCalledActions, collectImplementedActions };
