/**
 * 清理只服务旧原生页面的资源。
 *
 * legacy 页面删除后，res/values 里的 strings / colors / dimens / styles 绝大多数条目
 * 已无人引用，只保留 WebView 外壳真正需要的那几条：
 * - app_name（应用名）
 * - AppTheme 引用的 7 个颜色
 * - CalendarHelper 用到的 8 条日历提示文案
 *
 * 用法：node scripts/trim-resources.js [--write]
 */

const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const valuesDir = path.join(root, 'app', 'src', 'main', 'res', 'values');
const javaDir = path.join(root, 'app', 'src', 'main', 'java', 'com', 'example', 'calmobile');
const write = process.argv.includes('--write');

function read(file) {
    return fs.readFileSync(path.join(valuesDir, file), 'utf8');
}

/** 抓出每个资源条目的完整文本（含可能的子标签）。 */
function entries(xml, tag) {
    const pattern = new RegExp(`<${tag}\\b[^>]*>[\\s\\S]*?</${tag}>|<${tag}\\b[^>]*/>`, 'g');
    return xml.match(pattern) || [];
}

function nameOf(entry) {
    const match = /name="([^"]+)"/.exec(entry);
    return match ? match[1] : '';
}

// 1. Java 侧真正引用的 string 资源（WebView 外壳 + CalendarHelper）
const javaSources = fs.readdirSync(javaDir)
    .filter((name) => name.endsWith('.java'))
    .map((name) => fs.readFileSync(path.join(javaDir, name), 'utf8'))
    .join('\n');
const usedStrings = new Set(['app_name']);
for (const match of javaSources.matchAll(/R\.string\.(\w+)/g)) {
    usedStrings.add(match[1]);
}

// 2. AppTheme 引用的颜色
const themeXml = read('themes.xml');
const usedColors = new Set();
for (const match of themeXml.matchAll(/@color\/(\w+)/g)) {
    usedColors.add(match[1]);
}

const kept = { string: [], color: [] };

const stringsXml = read('strings.xml');
const stringEntries = entries(stringsXml, 'string');
for (const entry of stringEntries) {
    if (usedStrings.has(nameOf(entry))) {
        kept.string.push(entry);
    }
}

const colorsXml = read('colors.xml');
const colorEntries = entries(colorsXml, 'color');
for (const entry of colorEntries) {
    if (usedColors.has(nameOf(entry))) {
        kept.color.push(entry);
    }
}

const dropped = {
    string: stringEntries.length - kept.string.length,
    color: colorEntries.length - kept.color.length,
    dimens: entries(read('dimens.xml'), 'dimen').length,
    styles: entries(read('styles.xml'), 'style').length,
};

console.log(`保留 string ${kept.string.length} 条，删除 ${dropped.string} 条`);
console.log(`保留 color ${kept.color.length} 条，删除 ${dropped.color} 条`);
console.log(`删除 dimens ${dropped.dimens} 条、styles ${dropped.styles} 条（styles.xml 整体删除）`);

const missing = [...usedStrings].filter((name) => !kept.string.some((entry) => nameOf(entry) === name));
if (missing.length > 0) {
    console.error(`FAIL 以下 string 被 Java 引用但未找到：${missing.join(', ')}`);
    process.exitCode = 1;
}

if (!write) {
    console.log('\n（预演模式：加 --write 才会改写资源文件）');
    process.exit(process.exitCode || 0);
}

const header = (title) => '<?xml version="1.0" encoding="utf-8"?>\n'
    + `<!-- ${title}\n`
    + '     WebView 外壳只保留真正需要的条目；旧原生页面的资源已随 legacy 一并删除。\n'
    + '     前端文案在 strings_frontend.xml（由 scripts/extract-strings.js 生成）。\n'
    + '-->\n'
    + '<resources>\n';

fs.writeFileSync(path.join(valuesDir, 'strings.xml'),
    `${header('应用名与原生系统能力（日历）用到的提示文案。')}${kept.string.join('\n')}\n</resources>\n`);
fs.writeFileSync(path.join(valuesDir, 'colors.xml'),
    `${header('AppTheme 引用的基础颜色。')}${kept.color.join('\n')}\n</resources>\n`);
fs.unlinkSync(path.join(valuesDir, 'dimens.xml'));
fs.unlinkSync(path.join(valuesDir, 'styles.xml'));
console.log('\n已改写 strings.xml / colors.xml，并删除 dimens.xml、styles.xml');
