/**
 * 演示后端入口：零依赖，只用 Node 内置 http。
 *
 * 作用是在真实后端完成前，给前端一个可通过 HTTP 访问的 `js/core/api.js` 实现，
 * 用来验证「前端换传输层」这条链路。数据在 `demo-api.js`，全部为内存示例数据。
 *
 * 启动：node server/src/demo-server.js   （或 npm run demo）
 * 端口：process.env.DEMO_PORT，默认 4000
 *
 * Android 模拟器访问宿主机要用 10.0.2.2；真机用
 * `adb reverse tcp:4000 tcp:4000` 后访问 127.0.0.1:4000。
 */

const http = require('node:http');
const { handlers, setCurrentUser, usernameFromAuthHeader } = require('./demo-api');

const PORT = Number(process.env.DEMO_PORT) || 4000;
/** 前端资源来自 https://appassets.androidplatform.net，属于跨域，这里统一放开。 */
const ALLOW_ORIGIN = process.env.DEMO_CORS_ORIGIN || '*';

function send(res, status, payload) {
    const body = JSON.stringify(payload);
    res.writeHead(status, {
        'Content-Type': 'application/json; charset=utf-8',
        'Content-Length': Buffer.byteLength(body),
        'Access-Control-Allow-Origin': ALLOW_ORIGIN,
        'Access-Control-Allow-Headers': 'Content-Type, Authorization',
        'Access-Control-Allow-Methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS',
        'Cache-Control': 'no-store',
    });
    res.end(body);
}

function readBody(req) {
    return new Promise((resolve) => {
        const chunks = [];
        req.on('data', (chunk) => chunks.push(chunk));
        req.on('end', () => {
            const raw = Buffer.concat(chunks).toString('utf8');
            if (!raw) {
                resolve({});
                return;
            }
            try {
                resolve(JSON.parse(raw));
            } catch (ignored) {
                resolve({});
            }
        });
    });
}

const server = http.createServer(async (req, res) => {
    const started = Date.now();
    if (req.method === 'OPTIONS') {
        send(res, 204, {});
        return;
    }

    const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
    // 兼容 /api/v1/xxx、/api/xxx 与 /xxx 三种前缀写法。
    const action = url.pathname
        .replace(/^\/api(\/v1)?\//, '')
        .replace(/^\/+/, '');
    const query = Object.fromEntries(url.searchParams.entries());
    const body = req.method === 'GET' ? query : { ...query, ...(await readBody(req)) };

    setCurrentUser(usernameFromAuthHeader(req.headers.authorization));

    const handler = handlers[action];
    let status = 200;
    let payload;
    if (!handler) {
        status = 404;
        payload = { ok: false, error: `未实现的接口：${action || url.pathname}` };
    } else {
        try {
            payload = handler(body);
        } catch (error) {
            status = 500;
            payload = { ok: false, error: `服务端异常：${error.message}` };
            console.error(`[demo] ${action} 处理失败`, error);
        }
    }

    console.log(`[demo] ${req.method} /${action} ${status} ${Date.now() - started}ms`);
    send(res, status, payload);
});

server.listen(PORT, () => {
    console.log(`演示后端已启动：http://127.0.0.1:${PORT}`);
    console.log(`连通性检查：http://127.0.0.1:${PORT}/ping`);
    console.log('Android 模拟器请用 http://10.0.2.2:%d；真机先执行 adb reverse tcp:%d tcp:%d',
        PORT, PORT, PORT);
});
