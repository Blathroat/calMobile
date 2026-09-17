/**
 * 前端文案资源一致性检查。
 *
 * 前端把用户可见文案改成 t('s_xxx')（key 为文案内容哈希），文案本体在
 * res/values/strings_frontend.xml。任何一边漏了都会静默显示成 key，
 * 因此这里做双向校验：
 *
 * 1. 源码里用到的每个 key 都要有资源；
 * 2. 资源里的每个 key 都要在源码里被用到（防止改了文案留下死资源）；
 * 3. FrontendStrings.NAMES 要与资源文件完全一致（原生按名查值）。
 *
 * 用法：node scripts/check-strings.js
 */

const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const jsRoot = path.join(root, 'app', 'src', 'main', 'assets', 'web', 'js');
const resFile = path.join(root, 'app', 'src', 'main', 'res', 'values', 'strings_frontend.xml');
const javaFile = path.join(root, 'app', 'src', 'main', 'java', 'com', 'example', 'calmobile', 'FrontendStrings.java');

const failures = [];

function walk(dir) {
    return fs.readdirSync(dir, { withFileTypes: true })
        .flatMap((entry) => (entry.isDirectory()
            ? walk(path.join(dir, entry.name))
            : (entry.name.endsWith('.js') ? [path.join(dir, entry.name)] : [])));
}

if (!fs.existsSync(resFile)) {
    console.error(`FAIL 缺少 ${path.relative(root, resFile)}，请先运行 node scripts/extract-strings.js --write`);
    process.exit(1);
}

const xml = fs.readFileSync(resFile, 'utf8');
const resourceKeys = new Set();
for (const match of xml.matchAll(/<string name="(s_[a-z0-9]+)"/g)) {
    resourceKeys.add(match[1]);
}

const usedKeys = new Map();
for (const file of walk(jsRoot)) {
    const source = fs.readFileSync(file, 'utf8');
    for (const match of source.matchAll(/\bt\('(s_[a-z0-9]+)'\)/g)) {
        if (!usedKeys.has(match[1])) {
            usedKeys.set(match[1], path.relative(root, file));
        }
    }
}

// 1. 源码用到但资源缺失
for (const [key, file] of usedKeys) {
    if (!resourceKeys.has(key)) {
        failures.push(`${file} 使用了未定义的文案 ${key}`);
    }
}

// 2. 资源存在但源码未使用
for (const key of resourceKeys) {
    if (!usedKeys.has(key)) {
        failures.push(`strings_frontend.xml 中的 ${key} 没有任何页面使用`);
    }
}

// 3. 原生清单与资源一致
const java = fs.readFileSync(javaFile, 'utf8');
const nameBlock = /static final String\[\] NAMES = \{([\s\S]*?)\};/.exec(java);
if (!nameBlock) {
    failures.push('FrontendStrings.NAMES 结构异常');
} else {
    const names = new Set([...nameBlock[1].matchAll(/"(s_[a-z0-9]+)"/g)].map((match) => match[1]));
    for (const key of resourceKeys) {
        if (!names.has(key)) {
            failures.push(`FrontendStrings.NAMES 缺少 ${key}`);
        }
    }
    for (const key of names) {
        if (!resourceKeys.has(key)) {
            failures.push(`FrontendStrings.NAMES 多出 ${key}`);
        }
    }
}

if (failures.length > 0) {
    console.error(`FAIL 文案资源有 ${failures.length} 处不一致：`);
    for (const item of failures.slice(0, 20)) {
        console.error(`  ${item}`);
    }
    if (failures.length > 20) {
        console.error(`  …还有 ${failures.length - 20} 处`);
    }
    process.exitCode = 1;
} else {
    console.log(`PASS check-strings: ${resourceKeys.size} 条前端文案在源码、资源与原生清单之间一致`);
}
