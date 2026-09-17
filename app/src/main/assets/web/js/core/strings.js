/**
 * 用户可见文案。
 *
 * 文案本体统一维护在 `app/src/main/res/values/strings_frontend.xml`（由
 * `scripts/extract-strings.js` 从本目录源码生成），原生在页面加载完成后通过
 * `CalMobileStrings` 注入 `{ key: 文案 }`，前端用 t('key') 取用。
 *
 * 这样做的好处：
 * - 文案只有一份来源，改文案不必翻 JS；
 * - 后续接入服务端下发或做多语言时，只换注入内容即可，页面不用改。
 *
 * 取不到时回退为 key 本身，便于在测试与未注入环境里定位问题；
 * `scripts/check-strings.js` 会校验源码里的每个 key 都有对应资源，防止静默缺失。
 */

let strings = {};
let missingReported = new Set();

/** 原生注入入口；index.html 在脚本执行前就会调用它。 */
export function applyStrings(source) {
    if (source && typeof source === 'object') {
        strings = source;
    }
}

/** 取一条文案；未注入或缺失时返回 key。 */
export function t(key) {
    if (!key) {
        return '';
    }
    const value = strings[key];
    if (typeof value === 'string' && value !== '') {
        return value;
    }
    if (typeof window !== 'undefined' && window.CalMobileStrings) {
        const injected = window.CalMobileStrings[key];
        if (typeof injected === 'string' && injected !== '') {
            strings = window.CalMobileStrings;
            return injected;
        }
    }
    // 只在“原生已注入过文案、唯独缺这一条”时告警：纯 Node 环境（静态检查导入模块）
    // 本来就没有注入，告警只会变成噪音。
    if (typeof window !== 'undefined' && window.CalMobileStrings && !missingReported.has(key)) {
        missingReported.add(key);
        console.warn(`[strings] 缺少文案资源：${key}`);
    }
    return key;
}

/** 当前已加载的文案数量，供调试显示。 */
export function stringCount() {
    return Object.keys(strings).length;
}
