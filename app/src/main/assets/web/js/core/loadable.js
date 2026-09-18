import { t } from './strings.js';
/**
 * 「先画旧数据、再后台刷新」的取数渲染器。
 *
 * 页面原来的写法是「先replace(host, 骨架屏)，再 await 取数」，于是每次切页面、
 * 切筛选、点日期都会先闪一下空白再出内容——本地后端也要一次往返，肉眼就是
 * 极短的闪动。这里把顺序固定下来：
 *
 * 1. **同步读缓存**：命中就用旧数据立刻画出来，一帧都不等；
 * 2. 缓存没有、且容器还是空的：才画骨架屏（真正的首次加载）；
 * 3. 容器里已有内容时**不清空**，只标记 `data-busy`，旧内容留在屏幕上；
 * 4. 远端结果到达后，内容真的变了才重绘——否则列表的入场动画会被无谓重放。
 *
 * 数据的「新鲜」由 core/api.js 负责：`peek()` 会返回过期数据，`read()` 在缓存
 * 过期时重新拉取。本模块只决定什么时候画、画哪一份。
 *
 * **谁的结果算数**由下面的 `loadIds` 决定：同一块容器上后发起的加载一旦开始，
 * 先发起的那次结果就是过期的，回来也不许再画（见 `loadInto`）。
 */

import { loadErrorBlock, loadingBlock } from '../ui/components.js';
import { replace } from './dom.js';

/**
 * 每块容器当前最新一次加载的代号。
 *
 * 同一块容器上会前后发起多次加载：切月份、切筛选、防抖搜索都会连着来几次。
 * 先发的请求如果比后发的慢（后端抖动、命中不同的缓存状态都可能），回来的顺序
 * 就会反过来，把屏幕上的新内容覆盖成旧数据——用户看到的是「切了月份又跳回去，
 * 而且日期对不上视图」。所以每次加载都领一个自增代号，回写前比对：
 * 只有代号仍然是容器上最新那一次的加载，才允许改这块容器。
 */
const loadIds = new WeakMap();

/**
 * @param {HTMLElement} host 承载内容（以及骨架屏 / 错误块）的容器
 * @param {object} options
 * @param {Function} options.read     只读接口，来自 core/api.js（带 peek）
 * @param {*}        [options.params] 传给 read 的参数
 * @param {Function} options.render   `(data, host) => void`，把数据画进容器
 * @param {number}   [options.rows]   骨架屏行数，默认 3
 * @param {string}   [options.errorTitle] 加载失败时的标题
 * @param {Function} [options.onError]    自定义错误处理，默认画错误块
 * @returns {Promise<*>} 最终数据；失败、或这次加载已被更新的加载取代时返回 undefined
 */
export async function loadInto(host, options) {
    const { read, params, render, rows = 3, errorTitle, onError } = options;
    const cached = typeof read.peek === 'function' ? read.peek(params) : undefined;

    if (cached !== undefined) {
        render(cached, host);
    } else if (host.childElementCount === 0) {
        replace(host, loadingBlock(rows));
    }

    // 本次加载的代号：比它更新的加载一旦发起，这次的结果就作废。
    const loadId = (loadIds.get(host) || 0) + 1;
    loadIds.set(host, loadId);
    const expired = () => loadIds.get(host) !== loadId;

    // 旧数据留在屏幕上时给一个「正在刷新」的弱提示，不再整块清空。
    host.dataset.busy = 'true';
    try {
        const data = await read(params);
        if (expired()) {
            // 过期结果整块丢弃：不画内容，也不碰 data-busy——那个标记属于更新的那次加载。
            return undefined;
        }
        if (cached === undefined || !same(cached, data)) {
            render(data, host);
        }
        return data;
    } catch (error) {
        // 过期请求的失败同样不作数：不能让它把新一次加载的成果换成错误块。
        if (expired()) {
            return undefined;
        }
        if (onError) {
            onError(error);
        } else {
            replace(host, loadErrorBlock({
                title: errorTitle || t('s_kvpltc'),
                description: error.message,
                onRetry: () => loadInto(host, options),
            }));
        }
        return undefined;
    } finally {
        if (!expired()) {
            delete host.dataset.busy;
        }
    }
}

/**
 * 内容是否没变。
 *
 * 这里用序列化比较而不是引用比较：接口每次返回的都是新对象，引用永远不等，
 * 不比较就会在「数据没变」时也重绘一遍，列表入场动画跟着重放。
 */
function same(before, after) {
    if (before === after) {
        return true;
    }
    try {
        return JSON.stringify(before) === JSON.stringify(after);
    } catch (ignored) {
        // 含循环引用等无法序列化的情况：当作变了，重绘更安全。
        return false;
    }
}
