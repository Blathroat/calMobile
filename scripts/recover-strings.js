/**
 * 从 git 历史恢复「文案 key → 文案本体」的映射。
 *
 * 背景：extract-strings.js 第一次运行时把中文字面量换成了 t('s_xxx')，
 * 但资源文件在重跑时被清空，导致映射丢失。key 是文案内容的哈希，无法反推，
 * 因此回到迁移前的 HEAD 版本源码，用同一个哈希函数重算一遍即可还原。
 *
 * 用法：node scripts/recover-strings.js
 */

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('node:child_process');

const root = path.resolve(__dirname, '..');

function keyFor(text) {
    let hash = 0x811c9dc5;
    for (let index = 0; index < text.length; index += 1) {
        hash ^= text.charCodeAt(index);
        hash = Math.imul(hash, 0x01000193) >>> 0;
    }
    return `s_${hash.toString(36)}`;
}

/** 与 extract-strings.js 保持一致的过滤条件。 */
const SKIP_FILES = new Set(['status.js', 'api.js', 'bridge.js', 'vendor.js', 'markdown.js', 'dom.js', 'sanitize.js', 'strings.js']);
const HAN = /[\u4e00-\u9fa5]/;
const PROTOCOL_VALUES = new Set([
    '待审核', '已通过', '已拒绝', '已参加', '已撤销', '需审核', '无需审核', '仅展示',
    '截止报名', '已结束', '报名中', '全部', '文本', '单选', '多选', '必填', '选填',
]);

/** 列出迁移涉及的文件（当前工作区改动过的 JS，排除新增文件）。 */
function changedFiles() {
    const out = execFileSync('git', ['diff', '--name-only', 'HEAD', '--', 'web/src'],
        { cwd: root, encoding: 'utf8' });
    return out.split(/\r?\n/).filter((line) => line.endsWith('.js'));
}

const mapping = new Map();
for (const rel of changedFiles()) {
    const name = path.basename(rel);
    if (SKIP_FILES.has(name)) {
        continue;
    }
    let original;
    try {
        original = execFileSync('git', ['show', `HEAD:${rel}`], { cwd: root, encoding: 'utf8' });
    } catch (ignored) {
        continue;
    }
    const re = /(['"])((?:(?!\1)[^\\\n]|\\.)*?)\1/g;
    let match;
    while ((match = re.exec(original)) !== null) {
        const body = match[2];
        if (!HAN.test(body)) {
            continue;
        }
        if (PROTOCOL_VALUES.has(body)) {
            continue;
        }
        if (/^[a-z0-9_.]+$/.test(body) || body.includes('/') || body.includes('var(--')) {
            continue;
        }
        mapping.set(keyFor(body), body);
    }
}

console.log(`恢复出 ${mapping.size} 条文案映射`);

// 只保留当前源码里真正用到的 key。
const jsRoot = path.join(root, 'app', 'src', 'main', 'assets', 'web', 'js');
function walk(dir) {
    return fs.readdirSync(dir, { withFileTypes: true })
        .flatMap((entry) => (entry.isDirectory()
            ? walk(path.join(dir, entry.name))
            : (entry.name.endsWith('.js') ? [path.join(dir, entry.name)] : [])));
}
const used = new Set();
for (const file of walk(jsRoot)) {
    const source = fs.readFileSync(file, 'utf8');
    for (const match of source.matchAll(/\bt\('(s_[a-z0-9]+)'\)/g)) {
        used.add(match[1]);
    }
}

const missing = [...used].filter((key) => !mapping.has(key));
console.log(`源码用到 ${used.size} 个 key，其中 ${missing.length} 个无法从历史恢复`);
if (missing.length > 0) {
    console.log(`  未恢复：${missing.slice(0, 10).join(', ')}${missing.length > 10 ? ' …' : ''}`);
}

const rows = [...used]
    .filter((key) => mapping.has(key))
    .sort()
    .map((key) => ({ key, text: mapping.get(key) }));

const escapeXml = (text) => text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/'/g, "\\'");

const resDir = path.join(root, 'app', 'src', 'main', 'res', 'values');
const javaDir = path.join(root, 'app', 'src', 'main', 'java', 'com', 'example', 'calmobile');
fs.writeFileSync(path.join(resDir, 'strings_frontend.xml'),
    '<?xml version="1.0" encoding="utf-8"?>\n'
    + '<!--\n'
    + '  前端（WebView）用户可见文案。\n'
    + '  由 scripts/extract-strings.js 从 web/src 生成，不要手改：\n'
    + '  改文案请改前端源码后重新运行该脚本，再执行 node scripts/check-strings.js 校验。\n'
    + '  key 是文案内容的哈希（稳定、可去重），文案本体在下面。\n'
    + '-->\n'
    + '<resources>\n'
    + rows.map((row) => `    <string name="${row.key}">${escapeXml(row.text)}</string>`).join('\n')
    + '\n</resources>\n');

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
    + rows.map((row) => `            "${row.key}",`).join('\n')
    + '\n    };\n'
    + '}\n');

console.log(`已写入 strings_frontend.xml 与 FrontendStrings.java（${rows.length} 条）`);
