/**
 * 内置第三方脚本的按需加载。
 *
 * 这些库随 APK 打包（不走网络），但解析与执行要花时间：jsQR 约 257KB，
 * 启动时全部加载会明显拖慢首帧。因此只在真正用到的页面加载一次，之后复用同一个 Promise。
 */

const loaded = new Map();

/**
 * 加载一个全局脚本并等待其注册到 window。
 *
 * @param {string} src      相对 index.html 的路径
 * @param {string} globalName 脚本应挂到 window 上的全局名
 * @returns {Promise<any>} 全局对象
 */
export function loadScript(src, globalName) {
    const existing = typeof window !== 'undefined' ? window[globalName] : null;
    if (existing) {
        return Promise.resolve(existing);
    }
    if (loaded.has(src)) {
        return loaded.get(src);
    }
    const task = new Promise((resolve, reject) => {
        if (typeof document === 'undefined') {
            reject(new Error(`${globalName} 在当前环境不可用`));
            return;
        }
        const script = document.createElement('script');
        script.src = src;
        script.async = true;
        script.onload = () => {
            const value = window[globalName];
            if (value) {
                resolve(value);
            } else {
                reject(new Error(`${globalName} 未注册到全局`));
            }
        };
        script.onerror = () => reject(new Error(`无法加载 ${src}`));
        document.head.appendChild(script);
    });
    // 失败不缓存，允许下次重试。
    task.catch(() => loaded.delete(src));
    loaded.set(src, task);
    return task;
}

/** 注入样式表（只注入一次）。 */
export function loadStyle(href) {
    if (typeof document === 'undefined' || document.querySelector(`link[href="${href}"]`)) {
        return;
    }
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = href;
    document.head.appendChild(link);
}

/** 二维码生成（报名码），只在报名详情需要时加载。 */
export function loadQrEncoder() {
    return loadScript('vendor/qrcode-generator/qrcode.js', 'qrcode');
}

/** 二维码解码（展商扫码核销），只在核销页加载。 */
export function loadQrDecoder() {
    return loadScript('vendor/jsqr/jsQR.js', 'jsQR');
}
