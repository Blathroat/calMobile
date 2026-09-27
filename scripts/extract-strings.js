/**
 * 把前端用户可见文案迁移到 res/values/strings.xml。
 *
 * 做法：
 * 1. 扫描 web/src 下 Vue、TypeScript 与页面模块里的中文字符串字面量；
 * 2. 按「模块 + 语义」生成 string 资源名；
 * 3. 改写源码：字面量换成 `t('key')`，并补上 core/strings.js 的导入；
 * 4. 输出 strings 片段供合并进 strings.xml。
 *
 * 只处理**普通字符串字面量**（'…' / "…"），模板字符串与含 ${} 的插值文本不动，
 * 避免把变量插值拆坏；这类文本保留原样并在报告里列出。
 *
 * 用法：node scripts/extract-strings.js [--write]
 */

const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const jsRoot = path.join(root, 'web', 'src');
const write = process.argv.includes('--write');

/**
 * 跳过：纯技术字符串、状态枚举、协议值与格式化常量。
 *
 * `format.ts` 里的「周日」「年/月」与 `status.ts` 里的报名方式说明是格式化常量与
 * 界面侧唯一声明的状态词汇（与后端 `labels.ts` 按值对齐），转成资源 key 反而会让
 * 它们变成死资源；`theme.ts` / `vendor.ts` 里的中文只出现在模板字符串里。
 */
const SKIP_FILES = new Set([
    'status.js', 'api.js', 'bridge.js', 'vendor.js', 'markdown.js', 'dom.js', 'sanitize.js',
    'format.ts', 'status.ts', 'theme.ts', 'vendor.ts',
]);

/**
 * 跳过测试文件：里面的中文是夹具数据（问候语、错误文案），改成 `t('key')` 会让
 * 断言与被测行为一起变味，资源里也会多出一批永远不会渲染的 key。
 */
function isTestFile(file) {
    return /\.test\.(ts|js)$/.test(file);
}
const HAN = /[\u4e00-\u9fa5]/;
/** 这些是桥接协议里的值，前后端按值比较，不能换成 key。 */
const PROTOCOL_VALUES = new Set([
    '待审核', '已通过', '已拒绝', '已参加', '已撤销', '需审核', '无需审核', '仅展示',
    '截止报名', '已结束', '报名中', '全部', '文本', '单选', '多选', '必填', '选填',
]);

/**
 * 源码里的一次 `t('s_xxx')` 调用。
 *
 * 单/双引号与括号内的多余空格都要认：只认 `t('s_xxx')` 这一种写法时，
 * `t("s_xxx")` 与 `t( 's_xxx' )` 会被当成新文案再迁移一遍（或让既有资源变成死资源）。
 * `scripts/check-strings.js` 用的是同一条正则。
 */
const T_CALL = /\bt\(\s*(['"])(s_[a-z0-9]+)\1\s*\)/g;

/**
 * 直接出现的资源名（例如路由 `meta.title: 's_xxx'`）。
 *
 * 它们不写成 `t('s_xxx')`，而是运行时 `t(meta.title)` 取用。收集时要一并算作“在用”，
 * 否则重新生成资源时会被当死资源删掉，顶栏标题就退化成显示 key。
 */
const KEY_LITERAL = /(['"])(s_[a-z0-9]+)\1/g;

function walk(dir) {
    return fs.readdirSync(dir, { withFileTypes: true })
        .flatMap((entry) => (entry.isDirectory()
            ? walk(path.join(dir, entry.name))
            : (/\.(js|ts|vue)$/.test(entry.name) ? [path.join(dir, entry.name)] : [])));
}

/**
 * 中文短语 → 资源名。
 *
 * 用内容派生的稳定 key（FNV-1a 哈希）而不是位置序号：同样的文案永远得到同一个
 * key，不会因为改一行代码就整体漂移；相同文案也会自动去重。key 只作为标识，
 * 可读的文案本体在 strings.xml 里（该文件同时按模块分组列出全部资源）。
 */
function keyFor(text) {
    let hash = 0x811c9dc5;
    for (let index = 0; index < text.length; index += 1) {
        hash ^= text.charCodeAt(index);
        hash = Math.imul(hash, 0x01000193) >>> 0;
    }
    return `s_${hash.toString(36)}`;
}

const usedKeys = new Map();
const entries = [];

/**
 * 读取上一次生成的资源，作为 key → 文案的既有映射。
 * 这样脚本是幂等的：源码里已经写成 t('s_xxx') 的文案不会因为再跑一次而丢失，
 * 新增文案才会追加进来。
 */
function loadExisting() {
    const file = path.join(root, 'app', 'src', 'main', 'res', 'values', 'strings_frontend.xml');
    const map = new Map();
    if (!fs.existsSync(file)) {
        return map;
    }
    const xml = fs.readFileSync(file, 'utf8');
    const pattern = /<string name="([^"]+)">([\s\S]*?)<\/string>/g;
    let match;
    while ((match = pattern.exec(xml)) !== null) {
        map.set(match[1], match[2]
            .replace(/\\'/g, "'")
            .replace(/&lt;/g, '<')
            .replace(/&gt;/g, '>')
            .replace(/&amp;/g, '&'));
    }
    return map;
}

const existing = loadExisting();

function register(text) {
    const key = keyFor(text);
    if (!usedKeys.has(key)) {
        usedKeys.set(key, text);
        entries.push({ key, text });
    }
    return key;
}

/** 源码里已有的 key：直接沿用既有文案，不改写。 */
function rememberExisting(key) {
    if (usedKeys.has(key)) {
        return true;
    }
    const text = existing.get(key);
    if (text === undefined) {
        return false;
    }
    usedKeys.set(key, text);
    entries.push({ key, text });
    return true;
}

function escapeXml(text) {
    return text
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/'/g, "\\'");
}

/**
 * 取出 `.vue` 的 `<script setup>` 段，返回它在原文件里的位置。
 * 模板里的中文靠 `:placeholder="t('s_xxx')"` 这类绑定书写，不参与迁移，
 * 否则 `placeholder="请输入"` 会被改成 `placeholder="t('s_xxx')"`。
 */
function scriptBlock(source) {
    const match = /<script[^>]*>([\s\S]*?)<\/script>/.exec(source);
    if (!match) {
        return null;
    }
    const start = match.index + match[0].indexOf('>') + 1;
    return { text: match[1], start, end: start + match[1].length };
}

const report = [];

for (const file of walk(jsRoot)) {
    const name = path.basename(file);
    const raw = fs.readFileSync(file, 'utf8');

    // 先收集文件里已经在用的资源名，保证幂等：再跑一次不会丢文案。
    // 收集要扫**整个文件**（模板与路由 meta 里的 key 都是活资源），也不跳过
    // SKIP_FILES：格式化常量模块里引用的文案同样在用，只是它们的字面量不参与迁移。
    for (const pattern of [T_CALL, KEY_LITERAL]) {
        for (const match of raw.matchAll(pattern)) {
            rememberExisting(match[2]);
        }
    }

    if (SKIP_FILES.has(name) || isTestFile(file)) {
        continue;
    }
    const isVue = name.endsWith('.vue');
    const block = isVue ? scriptBlock(raw) : null;
    if (isVue && !block) {
        continue;
    }
    // `.vue` 只替换 `<script>` 段：模板里的中文靠 `:placeholder="t('key')"` 这类绑定书写，
    // 直接替换引号里的内容会把 `placeholder="请输入"` 改成 `t('s_xxx')`。
    const source = isVue ? block.text : raw;
    let counter = 0;
    let changed = false;

    // 只匹配单行、非模板、不含插值的字面量。
    const replaced = source.replace(/(['"])((?:(?!\1)[^\\\n]|\\.)*?)\1/g, (match, quote, body) => {
        if (!HAN.test(body)) {
            return match;
        }
        if (PROTOCOL_VALUES.has(body)) {
            return match;
        }
        // 已是资源 key、路径、选择器、CSS 值的一律跳过。
        if (/^[a-z0-9_.]+$/.test(body) || body.includes('/') || body.includes('var(--')) {
            return match;
        }
        counter += 1;
        const key = register(body);
        changed = true;
        return `t('${key}')`;
    });

    if (!changed) {
        continue;
    }
    // 补导入：Vue 与 TS 模块的 `t` 都在 `@/i18n`（旧 runtime 的 `core/strings.js` 已删除），
    // 因此按文件类型补不同的说明符；模块名去掉扩展名后重排一下，日志里更接近导入路径。
    const specifier = '@/i18n';
    const hasImport = /from\s+['"]@\/i18n['"]/.test(replaced);
    const withImport = hasImport
        ? replaced
        : replaced.replace(/^(?=(?:import|\/\*\*|\/\/))/m, `import { t } from '${specifier}';\n`);
    const output = isVue
        ? `${raw.slice(0, block.start)}${withImport}${raw.slice(block.end)}`
        : withImport;
    report.push({ file: path.relative(root, file), strings: counter });
    if (write) {
        fs.writeFileSync(file, output);
    }
}

console.log(`迁移字符串 ${entries.length} 条，涉及 ${report.length} 个模块：`);
for (const item of report) {
    console.log(`  ${item.file}  ${item.strings} 条`);
}

// 生成可直接并入 res/values/strings.xml 的片段。
const keys = entries.map((item) => item.key).sort((a, b) => a.localeCompare(b));
const xml = keys
    .map((key) => {
        const text = entries.find((item) => item.key === key).text;
        return `    <string name="${key}">${escapeXml(text)}</string>`;
    })
    .join('\n');
const resDir = path.join(root, 'app', 'src', 'main', 'res', 'values');
const javaDir = path.join(root, 'app', 'src', 'main', 'java', 'com', 'example', 'calmobile');
if (write) {
    const header = '<?xml version="1.0" encoding="utf-8"?>\n'
        + '<!--\n'
        + '  前端（WebView）用户可见文案。\n'
        + '  由 scripts/extract-strings.js 从 web/src 生成，不要手改：\n'
        + '  改文案请改前端源码后重新运行该脚本，再执行 node scripts/check-strings.js 校验。\n'
        + '  key 是文案内容的哈希（稳定、可去重），文案本体在下面。\n'
        + '-->\n'
        + '<resources>\n';
    fs.writeFileSync(path.join(resDir, 'strings_frontend.xml'), `${header}${xml}\n</resources>\n`);

    // 资源名清单：原生侧按名查值，避免在 Java 里维护第二份列表。
    const javaLines = keys.map((key) => `            "${key}",`).join('\n');
    fs.writeFileSync(path.join(javaDir, 'FrontendStrings.java'),
        'package com.example.calmobile;\n\n'
        + '/**\n'
        + ' * 前端文案的资源名清单。\n'
        + ' * <p>\n'
        + ' * 由 scripts/extract-strings.js 生成，不要手改；改文案请改前端源码后重跑脚本。\n'
        + ' * 与 res/values/strings_frontend.xml 一一对应。\n'
        + ' */\n'
        + 'final class FrontendStrings {\n\n'
        + '    private FrontendStrings() {\n'
        + '    }\n\n'
        + '    /** key 按字典序排列，便于与资源文件对照。 */\n'
        + '    static final String[] NAMES = {\n'
        + `${javaLines}\n`
        + '    };\n'
        + '}\n');
    console.log(`\n已写入 res/values/strings_frontend.xml 与 FrontendStrings.java（${keys.length} 条）`);
} else {
    console.log('\n（预演模式：加 --write 才会改写源码与资源文件）');
}
