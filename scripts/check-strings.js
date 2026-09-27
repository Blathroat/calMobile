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

/**
 * 源码里的一次 `t('s_xxx')` 调用。
 *
 * 单/双引号与括号内的多余空格都要认：只认 `t('s_xxx')` 这一种写法时，
 * `t("s_xxx")` 与 `t( 's_xxx' )` 在三处校验里全部不可见，
 * key 一旦不存在，运行时会把这个 key 原样显示给用户。
 * `scripts/extract-strings.js` 用的是同一条正则。
 */
const T_CALL = /\bt\(\s*(['"])(s_[a-z0-9]+)\1\s*\)/g;

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
    for (const match of source.matchAll(T_CALL)) {
        if (!usedKeys.has(match[2])) {
            usedKeys.set(match[2], path.relative(root, file));
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

// 4. 文案资源不得以空白开头或结尾
//    Android 会裁掉 `<string>` 的首尾空白，而 JSON 里原样保留 —— 同一份文案在原生注入后
//    就少了一个空格。真机上「验证码已发送到 」+ 邮箱因此渲染成「验证码已发送到xxx@…」。
//    需要间隔就用标点，或把空白交给页面里的相邻文本 / 布局，不要留在文案资源里。
for (const match of xml.matchAll(/<string name="(s_[a-z0-9]+)">([\s\S]*?)<\/string>/g)) {
    if (/^\s|\s$/.test(match[2])) {
        failures.push(`strings_frontend.xml 中的 ${match[1]} 首尾带空白（Android 会裁掉，页面与资源会不一致）`);
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
