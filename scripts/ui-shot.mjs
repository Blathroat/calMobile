/**
 * 逐屏截图（CDP）。
 *
 * 用 Chrome DevTools Protocol 驱动真实 Chromium：注入原生下发的文案资源、按需桩掉原生桥、
 * 设置手机视口，然后按真实流程登录并逐条路由截图。界面回归靠它出证据，比在模拟器上
 * 用坐标点击可靠得多（WebView 的文案不一定进无障碍树，模拟器里连输入账号都很别扭）。
 *
 * 用法：
 *   node scripts/ui-shot.mjs --out .omo/evidence/ui
 *   node scripts/ui-shot.mjs --account exhibitor --routes exhibitor,review
 *   node scripts/ui-shot.mjs --stub-native --routes settings,profile   # 桩原生桥（可选头像等）
 *   node scripts/ui-shot.mjs --routes admin --click 展会               # 进入后先点某个文案
 *
 * 先起前端静态服务（脚本不负责起服务）：
 *   pnpm --dir web build
 *   pnpm --dir web exec vite preview --port 5173 --strictPort
 *
 * 需要后端在 127.0.0.1:3000（`pnpm --dir server dev`），且 CORS 允许前端来源（开发期用 `*`）。
 * 依赖：本机安装的 Chrome（`--chrome` 可指定路径）、Node ≥ 24（自带 fetch 与 WebSocket）。
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const DEFAULT_CHROME = resolveChrome();

/** 找本机可用的 Chromium：CI 上通常是 `/usr/bin/google-chrome`，本地是安装目录。 */
function resolveChrome() {
  const candidates = [
    process.env.CHROME_PATH,
    process.platform === 'win32' ? 'C:/Program Files/Google/Chrome/Application/chrome.exe' : '',
    '/usr/bin/google-chrome',
    '/usr/bin/google-chrome-stable',
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    process.platform === 'win32' ? 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe' : '',
  ].filter(Boolean);
  return candidates.find((item) => fs.existsSync(item)) ?? candidates[0];
}

/** 解析 `--key value` 形式的参数。 */
function parseArgs(argv) {
  const options = {
    out: '.omo/evidence/ui-shot',
    base: 'http://localhost:5173/assets/web/',
    account: 'user',
    password: 'password',
    routes: 'profile,settings,my-registrations,home,detail',
    click: '',
    chrome: DEFAULT_CHROME,
    'stub-native': false,
    // 传入一个真实刷新令牌（`--stub-native` 时生效）：用来验证「冷启动免登录」，
    // 脚本会把它当作设备里已存的会话交给 `session.load`。
    'refresh-token': '',
    port: 9333,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith('--')) continue;
    const key = token.slice(2);
    const next = argv[index + 1];
    if (next === undefined || next.startsWith('--')) {
      options[key] = true;
      continue;
    }
    options[key] = next;
    index += 1;
  }
  return options;
}

const options = parseArgs(process.argv.slice(2));
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** 文案资源：与原生 `InjectStrings` 注入的 `window.CalMobileStrings` 同一份。 */
function loadStrings() {
  const file = path.resolve('app/src/main/res/values/strings_frontend.xml');
  const xml = fs.readFileSync(file, 'utf8');
  const strings = {};
  for (const match of xml.matchAll(/<string name="([^"]+)">([\s\S]*?)<\/string>/g)) {
    strings[match[1]] = match[2]
      .replace(/\\'/g, "'")
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&amp;/g, '&');
  }
  return strings;
}

/**
 * 原生桥桩：让「选图 → 裁剪 → 落盘」这类要走设备能力的流程也能在浏览器里跑通。
 * 只实现截图会用到的动作，其余一律回成功空对象。
 */
const NATIVE_STUB = `
window.__nativeCalls = [];
window.CalMobileNative = {
  report() {},
  invoke(action, payload, callbackId) {
    window.__nativeCalls.push(action);
    const done = (result) => setTimeout(() => window.CalMobileBridge.onResult(callbackId, true, result, null, null), 0);
    if (action === 'media.pickImage') {
      const canvas = document.createElement('canvas');
      canvas.width = 900; canvas.height = 600;
      const ctx = canvas.getContext('2d');
      ['#c05621', '#48515d', '#245d3c', '#2f6f8f', '#6b3fa0', '#a32c5e'].forEach((color, index) => {
        ctx.fillStyle = color;
        ctx.fillRect((index % 3) * 300, Math.floor(index / 3) * 300, 300, 300);
      });
      return done({ dataUrl: canvas.toDataURL('image/png') });
    }
    if (action === 'media.store') return done({ url: 'https://appassets.androidplatform.net/media/ui-shot.jpg' });
    if (action === 'ui.sync') return done({ notificationsGranted: true });
    if (action === 'calendar.status') return done({ granted: true, inCalendar: false });
    if (action === 'session.load') return done({ refreshToken: '__REFRESH_TOKEN__', username: 'me' });
    return done({ ok: true });
  },
};
`;

function connect(url) {
  const socket = new WebSocket(url);
  const pending = new Map();
  let sequence = 0;
  const ready = new Promise((resolve, reject) => {
    socket.addEventListener('open', resolve);
    socket.addEventListener('error', () => reject(new Error(`无法连接 CDP：${url}`)));
  });
  socket.addEventListener('message', (event) => {
    const message = JSON.parse(event.data);
    if (!message.id || !pending.has(message.id)) return;
    const entry = pending.get(message.id);
    pending.delete(message.id);
    if (message.error) entry.reject(new Error(message.error.message));
    else entry.resolve(message.result);
  });
  const send = (method, params = {}) => new Promise((resolve, reject) => {
    const id = ++sequence;
    const timer = setTimeout(() => {
      pending.delete(id);
      reject(new Error(`CDP 超时：${method}`));
    }, 20_000);
    pending.set(id, {
      resolve: (value) => { clearTimeout(timer); resolve(value); },
      reject: (error) => { clearTimeout(timer); reject(error); },
    });
    socket.send(JSON.stringify({ id, method, params }));
  });
  return ready.then(() => ({ socket, send }));
}

/** 调试端口就绪前一直等；连不上时给出可执行的下一步。 */
async function browserWs(port) {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/json/version`, { signal: AbortSignal.timeout(800) });
      const info = await response.json();
      if (info.webSocketDebuggerUrl) return info.webSocketDebuggerUrl;
    } catch {
      // 还没起来
    }
    await sleep(250);
  }
  throw new Error(`Chrome 调试端口 ${port} 没起来，检查 --chrome 路径与是否有别的实例占着该端口`);
}

/** detail 是便捷别名：从公开列表选择真实展会，不把缺少 id 的空路由当详情页。 */
async function resolveRoute(route) {
  const target = route.startsWith('/') ? route : `/${route}`;
  if (target !== '/detail') return target;
  const response = await fetch('http://127.0.0.1:3000/api/v1/exhibitions', { signal: AbortSignal.timeout(5000) });
  if (!response.ok) throw new Error(`无法选择详情页的展会：后端返回 ${response.status}`);
  const exhibitions = await response.json();
  const exhibition = Array.isArray(exhibitions) ? exhibitions.find((item) => item?.id) : undefined;
  if (!exhibition) throw new Error('没有可供详情页截图的展会：请准备已有展会，或从 --routes 中移除 detail');
  return `/detail/${encodeURIComponent(exhibition.id)}`;
}

async function main() {
  // 前端静态服务没起就没什么可截的，先给一条能直接照抄的命令。
  try {
    const response = await fetch(options.base, { signal: AbortSignal.timeout(3000) });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
  } catch {
    console.error(`前端服务没起来：${options.base}\n先执行：\n  pnpm --dir web build\n  pnpm --dir web exec vite preview --port 5173 --strictPort`);
    process.exit(1);
  }

  // 每次截图独立 profile，避免连续执行时上一进程的目录锁阻止 Chrome 启动。
  fs.mkdirSync('.omo', { recursive: true });
  const profileDir = fs.mkdtempSync(path.resolve('.omo/ui-shot-chrome-'));
  const flags = [
    '--headless=new', '--disable-gpu', '--no-first-run', '--hide-scrollbars',
    `--remote-debugging-port=${options.port}`,
    `--user-data-dir=${profileDir}`,
    'about:blank',
  ];
  // CI（容器里以 root 运行）必须关沙箱，否则 Chrome 起不来。
  if (process.env.CI || process.getuid?.() === 0) flags.unshift('--no-sandbox');
  const chrome = spawn(options.chrome, flags, { detached: true, stdio: 'ignore' });
  const chromeStopped = new Promise((resolve) => chrome.once('exit', resolve));
  // 脱离父进程：截图结束时不会被这个子进程拖住命令行。
  chrome.unref();

  const strings = loadStrings();
  let browser;
  let session;
  try {
    browser = await connect(await browserWs(options.port));
    const { targetId } = await browser.send('Target.createTarget', { url: 'about:blank' });
    const list = await (await fetch(`http://127.0.0.1:${options.port}/json/list`)).json();
    const page = list.find((item) => item.id === targetId);
    if (!page) throw new Error('没有拿到页面目标');
    session = await connect(page.webSocketDebuggerUrl);

    await session.send('Page.enable');
    await session.send('Runtime.enable');
    await session.send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
    await session.send('Page.addScriptToEvaluateOnNewDocument', { source: `window.CalMobileStrings = ${JSON.stringify(strings)};` });
    if (options['stub-native']) {
      const stub = NATIVE_STUB.replace('__REFRESH_TOKEN__', String(options['refresh-token'] ?? '').replace(/'/g, "\\'"));
      await session.send('Page.addScriptToEvaluateOnNewDocument', { source: stub });
    }

    const evaluate = async (expression) => {
      const result = await session.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
      if (result.exceptionDetails) {
        throw new Error(`${result.exceptionDetails.text} :: ${result.exceptionDetails.exception?.description ?? ''}`);
      }
      return result.result?.value;
    };
    /** 路由、正文和加载态都落定后才留证据；空白、重定向与错误状态必须让门禁失败。 */
    const waitForScreen = async (expected) => {
      let state;
      for (let attempt = 0; attempt < 40; attempt += 1) {
        state = await evaluate(`(() => {
          const body = document.querySelector('.page-surface');
          return {
            path: location.hash.slice(1),
            title: document.querySelector('.topbar-title')?.textContent?.trim() ?? '',
            content: body?.textContent?.trim() ?? '',
            loading: Boolean(body?.querySelector('.skeleton, [aria-busy="true"], [data-busy="true"]')),
            error: [...(body?.querySelectorAll('.state[data-tone="error"], .field-error') ?? [])]
              .map((node) => node.textContent.trim()).filter(Boolean).join('；'),
          };
        })()`);
        if (state.path === expected && state.title && state.content && !state.loading) {
          if (state.error) throw new Error(`页面 ${expected} 加载失败：${state.error}`);
          return;
        }
        await sleep(250);
      }
      throw new Error(`页面 ${expected} 未就绪：实际路由 ${state?.path}，${state?.error || '路由未匹配、正文为空或仍在加载'}`);
    };
    let navigation = 0;
    const goto = async (hash, wait = 1500) => {
      navigation += 1;
      if (navigation === 1) {
        // 首次进入用真实导航，后续保持同一份页面内会话。
        await session.send('Page.navigate', { url: `${options.base}?t=${Date.now()}#${hash}` });
      } else {
        // 之后一律在站内切哈希：整页重载会丢掉内存里的访问令牌，受登录保护的页面会整批
        // 变成登录页截图——那时「截图全绿」而每一屏都是同一个页面。
        await evaluate(`(() => { location.hash = ${JSON.stringify(hash)}; return location.hash; })()`);
      }
      // 哈希路由的站内切换不一定再触发 load：等一小会儿即可。
      await sleep(wait);
      await waitForScreen(hash);
    };
    const shot = async (name) => {
      const { data } = await session.send('Page.captureScreenshot', { format: 'png' });
      fs.mkdirSync(options.out, { recursive: true });
      fs.writeFileSync(path.join(options.out, `${name}.png`), Buffer.from(data, 'base64'));
      console.log('saved', path.join(options.out, `${name}.png`));
    };

    // 登录：走真实表单，和真机同一条路径。
    // 带 `--refresh-token` 时跳过登录，直接看「设备里已存会话」能否免登录进主界面。
    if (options['refresh-token']) {
      console.log('跳过登录：使用注入的刷新令牌验证冷启动免登录');
    } else {
      await goto('/login', 2200);
      // 外壳没渲染出来时登录按钮点不动（症状是「什么都没发生」）。先单独判一次，
      // 把「资源没加载」这类原因直接说出来，而不是等下面报一句「登录没进主界面」。
      if (!await evaluate(`Boolean(document.querySelector('.app'))`)) {
        throw new Error(`登录页没有渲染出外壳：${options.base}\n多半是 Chrome 缓存了上一次构建的资源，删掉 ${profileDir} 后重试`);
      }
      await shot('01-login');
      const submitted = await evaluate(`(() => {
        const inputs = document.querySelectorAll('input');
        if (inputs.length < 2) return 'no-inputs';
        const set = (el, value) => { el.value = value; el.dispatchEvent(new Event('input', { bubbles: true })); };
        set(inputs[0], ${JSON.stringify(options.account)});
        set(inputs[1], ${JSON.stringify(options.password)});
        document.querySelector('form button[type="submit"]').click();
        return 'submitted';
      })()`);
      // 登录包含密码校验与 bootstrap；机器繁忙时不能用固定 2.4 秒把正常请求判失败。
      for (let attempt = 0; attempt < 40; attempt += 1) {
        const pending = await evaluate(`location.hash.includes('/login')
          && !document.querySelector('.field-error')?.textContent?.trim()`);
        if (!pending) break;
        await sleep(250);
      }
      // 登录失败时后面每一屏都会是登录页——那是最难看出原因的一种「截图全绿」。
      // 这里直接失败，并把页面上的错误文案带出来（多半是后端没起或账号不对）。
      const hash = await evaluate('location.hash');
      if (submitted !== 'submitted' || hash.includes('/login')) {
        const message = await evaluate(`document.querySelector('.field-error')?.textContent?.trim() ?? ''`);
        throw new Error(`登录没能进入主界面（账号 ${options.account}，hash=${hash}）${message ? `：${message}` : ''}\n检查后端是否在 127.0.0.1:3000 且 CORS 允许 ${options.base}`);
      }
    }
    await goto('/home', 2200);
    await shot('02-home');
    console.log(`首页 hash=${await evaluate('location.hash')} native=${await evaluate('JSON.stringify(window.__nativeCalls ?? [])')}`);

    let index = 3;
    for (const route of String(options.routes).split(',').map((item) => item.trim()).filter(Boolean)) {
      const target = await resolveRoute(route);
      await goto(target, 1600);
      for (const label of String(options.click).split(',').map((item) => item.trim()).filter(Boolean)) {
        const clicked = await evaluate(`(() => {
          // 只认按钮与卡片：底部导航也是「管理 / 个人」这样的文案，混进来会点错东西。
          const target = [...document.querySelectorAll('button, .row-card')]
            .find((node) => node.textContent.trim() === ${JSON.stringify(label)});
          if (!target) return 'not-found';
          target.click();
          return 'clicked';
        })()`);
        console.log(`click ${label} → ${clicked}`);
        if (clicked !== 'clicked') throw new Error(`页面 ${target} 上找不到操作：${label}`);
        await sleep(1400);
        await waitForScreen(await evaluate('location.hash.slice(1)'));
      }
      await shot(`${String(index).padStart(2, '0')}-${route.replace(/[/?=&]/g, '_')}`);
      const landed = await evaluate('location.hash');
      console.log(`route ${route} → ${landed}`);
      index += 1;
    }

    if (options['stub-native']) {
      console.log('native calls:', await evaluate('JSON.stringify(window.__nativeCalls)'));
    }
    await browser.send('Browser.close').catch(() => undefined);
    console.log('截图完成。');
  } catch (error) {
    // 失败时也保留现场，便于辨认错误状态、空白与权限重定向。
    if (session) {
      try {
        const { data } = await session.send('Page.captureScreenshot', { format: 'png' });
        fs.mkdirSync(options.out, { recursive: true });
        fs.writeFileSync(path.join(options.out, 'failure.png'), Buffer.from(data, 'base64'));
      } catch { /* 页面可能已关闭，保留原始失败原因。 */ }
    }
    throw error;
  } finally {
    session?.socket.close();
    browser?.socket.close();
    try {
      chrome.kill();
    } catch {
      // 已经退出了
    }
    await Promise.race([chromeStopped, sleep(2000)]);
    try {
      fs.rmSync(profileDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    } catch { /* Windows 上子进程可能仍占用临时目录，下次会使用另一个独立目录。 */ }
  }
}

await main();
