/**
 * WebView 前端静态检查。
 *
 * 校验四件事：
 * 1. assets/web 下的页面与脚本能作为 ES 模块解析（语法与导入路径）；
 * 2. 数据动作：`js/core/api.js` 的 `ENDPOINTS` 就是前端数据动作的全集，
 *    每一项都要能解析出 `method` + `path`，且 path 以 `/` 开头
 *    （后端是否真有这条路由由 server/src/test/api.test.ts 的交叉校验负责）；
 * 3. 系统动作：前端 `call('…')` 用到的动作必须在 `WebAppActions` 的 switch 里有 case，
 *    并且属于 10 个系统能力白名单；白名单之外的原生动作（例如又加回数据实现）报错；
 *    `WebAppActions` 里有、前端却从来不 `call` 的动作（死动作）同样报错；
 * 4. 页面文件与设计的屏幕编号一一对应，且页面只通过 `core/api.js` 取数据；
 * 5. 路由注册一致：`js/app.js` 的 `defineRoute(...)`、`js/pages/*.js` 与
 *    `webui-render.test.js` 的 `ROUTES` 三处 id 集合必须相同。
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
const renderTestFile = path.join(root, 'scripts', 'webui-render.test.js');

/**
 * 原生保留的系统能力白名单。
 *
 * 数据（展会 / 报名 / 用户 / 设置 / 认证）全部由 `server/` 提供，前端经 `core/api.js`
 * 走 HTTP；原生只剩「只有设备能做」的这 10 个动作，多一个都算把数据实现加回了原生。
 */
const SYSTEM_ACTIONS = [
    'ui.sync',
    'camera.ensurePermission',
    'calendar.status',
    'calendar.toggle',
    'notify.requestPermission',
    'media.pickImage',
    'media.import',
    'media.store',
    'share.text',
    'export.csv',
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

/** 前端模块：vendor 下是第三方 UMD 包，不参与动作名的静态扫描。 */
function frontendModules() {
    return walk(webRoot, '.js').filter((file) => !file.includes(`${path.sep}vendor${path.sep}`));
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

/** 取出 `const ENDPOINTS = { … }` 的对象字面量正文（按大括号配平）。 */
function endpointBlock(source) {
    const start = source.indexOf('const ENDPOINTS = {');
    if (start < 0) {
        return '';
    }
    const open = source.indexOf('{', start);
    let depth = 0;
    for (let index = open; index < source.length; index += 1) {
        const char = source[index];
        if (char === '{') {
            depth += 1;
        } else if (char === '}') {
            depth -= 1;
            if (depth === 0) {
                return source.slice(open + 1, index);
            }
        }
    }
    return '';
}

/**
 * 解析 `core/api.js` 的 ENDPOINTS。
 *
 * 返回 Map：动作名 → `[{ method, path }]`（一个动作可能按条件映射到多个端点，
 * 例如 `exhibitions.save` 的 POST / PUT）。动作名的键集合就是前端数据动作的全集。
 */
function collectEndpoints(source = fs.readFileSync(apiFile, 'utf8')) {
    const body = endpointBlock(source);
    const endpoints = new Map();
    if (!body) {
        return endpoints;
    }
    // 每一项都在对象里缩进四个空格，形如 `bootstrap: () => ({ … }),`
    const entryPattern = /(?:^|\n)[ \t]{4}(?:'([a-zA-Z0-9.]+)'|([a-zA-Z0-9.]+)):[ \t]*/g;
    const entries = [];
    let match;
    while ((match = entryPattern.exec(body)) !== null) {
        entries.push({ action: match[1] || match[2], at: match.index, length: match[0].length });
    }
    entries.forEach((entry, index) => {
        const from = entry.at + entry.length;
        const to = index + 1 < entries.length ? entries[index + 1].at : body.length;
        const slice = body.slice(from, to);
        const methods = [...slice.matchAll(/method:[ \t]*'([A-Z]+)'/g)].map((item) => item[1]);
        const paths = [...slice.matchAll(/path:[ \t]*(?:`([^`]*)`|'([^']*)')/g)]
            .map((item) => item[1] ?? item[2] ?? '');
        endpoints.set(entry.action, methods.map((method, position) => ({
            method,
            path: paths[position] ?? '',
        })));
    });
    return endpoints;
}

/**
 * 前端直接调用原生桥接的地方：动作名 → 调用它的文件集合。
 * `core/api.js` 里的 `call(action, payload)` 传的是变量，匹配不到字面量，因此不会混进来。
 */
function collectCallSites() {
    const sites = new Map();
    for (const file of frontendModules()) {
        const source = fs.readFileSync(file, 'utf8');
        const pattern = /\bcall\(\s*'([a-zA-Z0-9.]+)'/g;
        let match;
        while ((match = pattern.exec(source)) !== null) {
            const action = match[1];
            if (!sites.has(action)) {
                sites.set(action, new Set());
            }
            sites.get(action).add(path.relative(root, file));
        }
    }
    return sites;
}

function collectImplementedActions() {
    const source = fs.readFileSync(actionsFile, 'utf8');
    const actions = new Set();
    const pattern = /case "([a-zA-Z0-9.]+)":/g;
    let match;
    while ((match = pattern.exec(source)) !== null) {
        actions.add(match[1]);
    }
    return actions;
}

function isPage(file) {
    return file.includes(`${path.sep}pages${path.sep}`);
}

/**
 * 数据动作：ENDPOINTS 的键集合就是全集，每一项都要能翻出 method + path，
 * 且 path 以 `/` 开头（拼在 `BASE_URL` 后面）。
 */
function checkDataActions(endpoints) {
    if (endpoints.size === 0) {
        fail('未能从 core/api.js 的 ENDPOINTS 解析出任何数据动作，请检查文件结构');
        return;
    }
    for (const [action, routes] of endpoints) {
        if (routes.length === 0) {
            fail(`数据动作 ${action} 没有解析出 method + path`);
            continue;
        }
        for (const route of routes) {
            if (!route.method || !route.path) {
                fail(`数据动作 ${action} 没有解析出 method + path`);
            } else if (!route.path.startsWith('/')) {
                fail(`数据动作 ${action} 的 path 必须以 / 开头：${route.path}`);
            }
        }
    }
}

/**
 * 系统动作：前端 `call('…')` 用到的动作必须在白名单里，且在 `WebAppActions` 有 case。
 * 白名单之外的动作说明有人又往原生加了数据实现。
 */
function checkSystemActions(endpoints, callSites, implemented) {
    for (const [action, files] of callSites) {
        const where = [...files].join('、');
        // 页面绕过 api.js 直接调数据动作：由 checkApiBoundary 报更准确的原因。
        const bypass = endpoints.has(action) && [...files].every(isPage);
        if (bypass) {
            continue;
        }
        if (!SYSTEM_ACTIONS.includes(action)) {
            fail(`${where} 调用了白名单之外的原生动作 ${action}；数据动作只能走 core/api.js 的 ENDPOINTS`);
            continue;
        }
        if (!implemented.has(action)) {
            fail(`${where} 调用了未实现的动作 ${action}`);
        }
    }
}

/** 死动作：`WebAppActions` 里有、前端却从来不 `call` 的动作。 */
function checkDeadActions(callSites, implemented) {
    const dead = [...implemented].filter((action) => !callSites.has(action)).sort();
    if (dead.length > 0) {
        fail(`WebAppActions 里存在前端从来不调用的动作，请删除：${dead.join(', ')}`);
    }
}

/**
 * 页面不得绕过 core/api.js 直接调用数据类动作。
 * 数据动作的全集就是 ENDPOINTS 的键，这样后端加接口时不用改本文件。
 */
function checkApiBoundary(endpoints) {
    const pagesDir = path.join(webRoot, 'js', 'pages');
    let violations = 0;
    for (const file of walk(pagesDir, '.js')) {
        const source = fs.readFileSync(file, 'utf8');
        const pattern = /\bcall\(\s*'([a-zA-Z0-9.]+)'/g;
        let match;
        while ((match = pattern.exec(source)) !== null) {
            if (endpoints.has(match[1])) {
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

/**
 * 去掉注释，避免把被注释掉的 `defineRoute('x', …)` / `['x', {}]` 当成有效注册。
 * 只处理行注释（整行与行尾）和块注释，够用且不需要引号感知。
 */
function stripComments(source) {
    return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
}

/**
 * 路由注册一致性。
 *
 * `core/router.js` 对未注册的 id 会**静默回落首页**（见 router.js 的 render），
 * 所以漏注册一条 `defineRoute('review', …)` 不会报错，只会「点进去是首页」。
 * 这里把三处 id 集合对齐，任何一处增删都要同步另外两处：
 *
 * 1. `js/app.js` 里 `defineRoute('id', …)` 的 id；
 * 2. `js/pages/*.js` 的文件名（`exhibition-form.js` ↔ `exhibition-form`）；
 * 3. `scripts/webui-render.test.js` 里 `ROUTES` 的 id（每个页面至少渲染一次）。
 */
function collectRouteIds() {
    const app = stripComments(fs.readFileSync(appFile, 'utf8'));
    const registered = new Set([...app.matchAll(/defineRoute\(\s*['"]([a-z-]+)['"]/g)].map((match) => match[1]));

    const pagesDir = path.join(webRoot, 'js', 'pages');
    const pages = new Set(fs.readdirSync(pagesDir)
        .filter((name) => name.endsWith('.js'))
        .map((name) => name.replace(/\.js$/, '')));

    const test = stripComments(fs.readFileSync(renderTestFile, 'utf8'));
    const block = /const ROUTES = \[([\s\S]*?)\n\];/.exec(test);
    const rendered = new Set(block
        ? [...block[1].matchAll(/\[\s*['"]([a-z-]+)['"]/g)].map((match) => match[1])
        : []);

    return { registered, pages, rendered };
}

/** 打印差集用的稳定顺序。 */
function sorted(set) {
    return [...set].sort();
}

function checkRouteRegistry() {
    const { registered, pages, rendered } = collectRouteIds();
    if (registered.size === 0) {
        fail('未能从 js/app.js 解析出任何 defineRoute，请检查文件结构');
        return;
    }
    if (rendered.size === 0) {
        fail('未能从 scripts/webui-render.test.js 解析出 ROUTES，请检查文件结构');
        return;
    }

    // 三处集合两两对齐；只报「少了什么 / 多了什么」，方便一眼看出该补哪边。
    const pairs = [
        ['js/app.js 的 defineRoute', registered, 'js/pages/*.js 的页面文件', pages],
        ['js/app.js 的 defineRoute', registered, 'webui-render.test.js 的 ROUTES', rendered],
    ];
    for (const [leftLabel, left, rightLabel, right] of pairs) {
        const missing = sorted(new Set([...left].filter((id) => !right.has(id))));
        const extra = sorted(new Set([...right].filter((id) => !left.has(id))));
        if (missing.length > 0) {
            fail(`${rightLabel} 缺少 ${leftLabel} 里已注册的路由：${missing.join(', ')}`);
        }
        if (extra.length > 0) {
            fail(`${leftLabel} 缺少 ${rightLabel} 里的路由：${extra.join(', ')}`);
        }
    }
}

async function main() {
    const fileCount = checkFileLayout();
    const endpoints = collectEndpoints();
    const callSites = collectCallSites();
    const implemented = collectImplementedActions();

    checkDataActions(endpoints);
    if (implemented.size === 0) {
        fail('未能从 WebAppActions.java 解析出任何动作，请检查文件结构');
    } else {
        checkSystemActions(endpoints, callSites, implemented);
        checkDeadActions(callSites, implemented);
    }
    checkApiBoundary(endpoints);
    checkRouteRegistry();
    const moduleCount = await checkModules();

    if (failures.length > 0) {
        console.error(`\n共 ${failures.length} 项检查失败`);
        process.exitCode = 1;
        return;
    }
    const { registered } = collectRouteIds();
    console.log(`PASS webui-check: ${fileCount} 个前端文件、${moduleCount} 个 ES 模块解析通过；`
        + `core/api.js 的 ${endpoints.size} 个数据动作都有 method + path；`
        + `原生 ${implemented.size} 个系统动作都有调用且都在白名单内；页面均通过 core/api.js 取数据；`
        + `${registered.size} 条路由在 app.js、页面文件与渲染测试三处一致`);
}

if (require.main === module) {
    main();
}

module.exports = {
    EXPECTED_PAGES,
    SYSTEM_ACTIONS,
    collectEndpoints,
    collectCallSites,
    collectImplementedActions,
    collectRouteIds,
};
