/**
 * `/status` 状态页：给人看的 HTML。
 *
 * 单文件自包含：样式与脚本全部内联，不依赖构建、CDN 或任何外部资源，
 * 因此数据库挂掉时页面照样能打开，并把「哪儿坏了、坏成什么样」直接显示出来。
 *
 * **首屏由服务端渲染**：`renderStatusPage(report)` 把 `/api/v1/status` 的报告直接写进 HTML，
 * 打开就有数据、不会先闪一屏空白；页面里的脚本只负责之后每 5 秒 `fetch('/api/v1/status')`
 * 做局部更新（不整页 reload）。
 *
 * 颜色取自 Android 客户端的设计令牌（`app/src/main/assets/web/styles/tokens.css`）：
 * 背景 #F7F6F3 / 卡片 #FFFFFF / 主文字 #20252B / 次文字 #626A74 / 描边 #C5CAD1 /
 * 主按钮 #48515D / 强调色 #C05621；深色跟随 `prefers-color-scheme`。
 *
 * 约定：下面的 `renderXxx`（服务端首屏）与页面脚本里的同名函数产出**同一套 DOM 结构**，
 * 改动其中一个就要同步另一个；页面脚本里不能用模板字符串（外层就是模板字符串）。
 */

/** 数据量卡片里的表名与中文名。 */
const COUNT_FIELDS = [
  ['users', '用户'],
  ['exhibitions', '展会'],
  ['registrations', '报名'],
  ['exhibition_fields', '收集项'],
  ['app_settings', '服务器设置'],
];

/** 自检项状态 → 中文标签。 */
const CHECK_LABELS = { ok: '通过', fail: '失败' };

function escapeHtml(value) {
  return String(value === null || value === undefined ? '' : value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** 秒数 → 「1 天 2 小时 3 分 4 秒」。 */
function formatDuration(seconds) {
  const total = Math.max(0, Math.floor(Number(seconds) || 0));
  const days = Math.floor(total / 86400);
  const hours = Math.floor((total % 86400) / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const parts = [];
  if (days > 0) {
    parts.push(`${days} 天`);
  }
  if (days > 0 || hours > 0) {
    parts.push(`${hours} 小时`);
  }
  if (days > 0 || hours > 0 || minutes > 0) {
    parts.push(`${minutes} 分`);
  }
  parts.push(`${total % 60} 秒`);
  return parts.join(' ');
}

/** 毫秒 → 「12.4 ms」；没有测量值时给破折号。 */
function formatMs(ms) {
  if (ms === null || ms === undefined || !Number.isFinite(Number(ms))) {
    return '—';
  }
  const value = Number(ms);
  return value >= 100 ? `${Math.round(value)} ms` : `${value.toFixed(1)} ms`;
}

/** 行数：数据库不可用时是 null，显示破折号而不是 0 ——「0 行」和「没量到」是两回事。 */
function formatCount(value) {
  return value === null || value === undefined ? '—' : String(value);
}

/** 时间戳按**服务时区**显示成「2026-06-08 14:03:05」。 */
function formatTime(iso, timeZone) {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) {
    return '—';
  }
  try {
    return new Intl.DateTimeFormat('zh-CN', {
      timeZone: timeZone || 'UTC',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false,
    }).format(date);
  } catch (error) {
    return date.toISOString();
  }
}

/** `version()` 的头一段（PostgreSQL 16.4）：后面的编译信息对排查没用。 */
function shortVersion(version) {
  const text = String(version || '');
  if (!text) {
    return '—';
  }
  const head = text.split(' on ')[0].trim();
  return head || text;
}

/** 接口清单按前缀分组：`/api/v1/x/y` 归到 `/api/v1/x`，直接挂在一级下的归到 `/api/v1`。 */
function groupEndpoints(endpoints) {
  const groups = [];
  const index = new Map();
  for (const item of endpoints || []) {
    const rest = String(item.path || '').replace(/^\/api\/v1\/?/, '');
    const segment = rest.split('/')[0];
    if (!index.has(segment)) {
      const group = { prefix: segment ? `/api/v1/${segment}` : '/api/v1', items: [] };
      index.set(segment, group);
      groups.push(group);
    }
    index.get(segment).items.push(item);
  }
  return groups;
}

function chip(text, tone) {
  return `<span class="chip${tone ? ` ${tone}` : ''}">${escapeHtml(text)}</span>`;
}

/** 自检项列表。 */
function renderChecks(checks) {
  if (!Array.isArray(checks) || checks.length === 0) {
    return '<div class="check fail"><span class="state">失败</span>'
      + '<span class="name">自检项</span><span class="detail">没有拿到任何自检结果</span>'
      + '<span class="ms">—</span></div>';
  }
  return checks.map((check) => {
    const status = check.status === 'ok' ? 'ok' : 'fail';
    return `<div class="check ${status}">`
      + `<span class="state">${CHECK_LABELS[status]}</span>`
      + `<span class="name">${escapeHtml(check.name)}</span>`
      + `<span class="detail">${escapeHtml(check.detail)}</span>`
      + `<span class="ms">${escapeHtml(formatMs(check.ms))}</span>`
      + '</div>';
  }).join('');
}

/** 接口清单：按前缀分组，方法用等宽小标签。 */
function renderEndpoints(endpoints) {
  const groups = groupEndpoints(endpoints);
  if (groups.length === 0) {
    return '<p class="muted">没有读到任何路由</p>';
  }
  return groups.map((group) => {
    const rows = group.items.map((item) => '<div class="endpoint">'
      + `<span class="method ${escapeHtml(String(item.method).toLowerCase())}">${escapeHtml(item.method)}</span>`
      + `<span class="path mono">${escapeHtml(item.path)}</span>`
      + '</div>').join('');
    return `<div class="group"><p class="group-title mono">${escapeHtml(group.prefix)}</p>${rows}</div>`;
  }).join('');
}

/** 迁移卡片里的两串标签；未应用的用高亮色。 */
function renderMigrations(migrations) {
  const applied = migrations.applied || [];
  const pending = migrations.pending || [];
  const appliedChips = applied.length > 0
    ? applied.map((item) => chip(`${item.id} · ${formatTime(item.appliedAt, migrations.timeZone)}`)).join('')
    : '<span class="muted">无</span>';
  const pendingChips = pending.length > 0
    ? pending.map((id) => chip(id, 'warn')).join('')
    : '<span class="muted">无</span>';
  let summary = `已应用 ${applied.length} 项，没有遗漏`;
  if (migrations.error && applied.length === 0) {
    summary = `读不到迁移记录：${migrations.error}`;
  } else if (pending.length > 0) {
    summary = `已应用 ${applied.length} 项，还有 ${pending.length} 项未应用`;
  }
  return {
    summary,
    applied: appliedChips,
    pending: pendingChips,
    appliedCount: applied.length,
    pendingCount: pending.length,
  };
}

/**
 * 渲染整页。`report` 就是 `/api/v1/status` 的那份报告，
 * 字段缺失时按空值降级渲染，绝不抛错 —— 页面必须打得开。
 */
function renderStatusPage(report) {
  const source = report || {};
  const service = source.service || {};
  const database = source.database || {};
  const migrations = { ...(source.migrations || {}), timeZone: service.timeZone };
  const counts = source.data || {};
  const checks = source.checks || [];
  const endpoints = source.endpoints || [];
  const ok = Boolean(source.ok);
  const pool = database.pool || {};

  // 报告进页面时转义 `<`，避免任何字段里出现 `</script>` 把脚本提前截断。
  const payload = JSON.stringify(source).replace(/</g, '\\u003c');
  const migrationViews = renderMigrations(migrations);
  const countRows = COUNT_FIELDS.map(([key, label]) => `<div><dt>${label}</dt>`
    + `<dd class="mono" data-count="${key}">${escapeHtml(formatCount(counts[key]))}</dd></div>`).join('');
  const badgeClass = ok ? 'ok' : 'fail';

  return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light dark">
<title>服务状态 · ${escapeHtml(service.name || 'calmobile-server')}</title>
<style>
*{box-sizing:border-box}
:root{
  --bg:#f7f6f3; --surface:#ffffff; --ink:#20252b; --ink-2:#626a74;
  --stroke:#c5cad1; --dark:#48515d; --accent:#c05621; --fill:#f1f2f4;
  --ok-bg:#e4efe8; --ok-ink:#245d3c; --fail-bg:#f7e6e2; --fail-ink:#a33a2a;
  --r-card:16px; --r-chip:8px;
  --mono:ui-monospace,SFMono-Regular,Menlo,Consolas,'Courier New',monospace;
}
@media (prefers-color-scheme:dark){
  :root{
    --bg:#171a1f; --surface:#1f2429; --ink:#e6e8ea; --ink-2:#9aa3ad;
    --stroke:#373e46; --dark:#48515d; --accent:#e08a52; --fill:#262c33;
    --ok-bg:#1c3226; --ok-ink:#7fc79b; --fail-bg:#3a2521; --fail-ink:#f0a08f;
  }
}
body{margin:0;background:var(--bg);color:var(--ink);-webkit-text-size-adjust:100%;
  font:16px/1.45 -apple-system,BlinkMacSystemFont,'Segoe UI','Noto Sans SC','Microsoft YaHei',sans-serif}
.wrap{max-width:1000px;margin:0 auto;padding:24px 20px 48px;display:grid;gap:16px}
.card{background:var(--surface);border:1px solid var(--stroke);border-radius:var(--r-card);padding:20px}
.card h2{margin:0 0 16px;font-size:18px;font-weight:600;display:flex;gap:8px;align-items:baseline}
.top{display:flex;flex-wrap:wrap;align-items:center;gap:16px}
.brand{flex:1 1 240px;min-width:0}
.eyebrow{margin:0 0 4px;font-size:13px;letter-spacing:.08em;color:var(--ink-2)}
h1{margin:0;font-size:26px;font-weight:600;word-break:break-all}
.version{margin-left:8px;font-family:var(--mono);font-size:14px;font-weight:400;color:var(--ink-2)}
.controls{display:flex;align-items:center;gap:12px;flex-wrap:wrap}
.btn{min-height:44px;padding:0 20px;border:0;border-radius:var(--r-chip);background:var(--dark);
  color:#fff;font-size:16px;font-family:inherit;cursor:pointer}
.btn:hover{filter:brightness(1.1)}
.toggle{display:inline-flex;align-items:center;gap:8px;min-height:44px;font-size:14px;color:var(--ink-2);cursor:pointer}
.badge{padding:10px 26px;border-radius:999px;font-size:22px;font-weight:600;letter-spacing:.06em;
  border:1px solid transparent;text-align:center}
.badge.ok{background:var(--ok-bg);color:var(--ok-ink);border-color:var(--ok-ink)}
.badge.fail{background:var(--fail-bg);color:var(--fail-ink);border-color:var(--fail-ink)}
.alert{margin:0;padding:12px 16px;border-radius:var(--r-chip);background:var(--fail-bg);
  color:var(--fail-ink);border:1px solid var(--fail-ink);word-break:break-word}
.alert.inline{margin-top:14px;font-size:14px}
.cards{display:grid;gap:16px;grid-template-columns:repeat(auto-fit,minmax(320px,1fr))}
.kv{display:grid;gap:10px;margin:0}
.kv>div{display:flex;gap:12px;justify-content:space-between;align-items:baseline;
  border-bottom:1px dashed var(--stroke);padding-bottom:8px}
.kv>div:last-child{border-bottom:0;padding-bottom:0}
.kv dt{flex:0 0 auto;font-size:14px;color:var(--ink-2)}
.kv dd{margin:0;text-align:right;word-break:break-word}
.mono{font-family:var(--mono);font-size:14px}
.muted{color:var(--ink-2)}
.ok-text{color:var(--ok-ink);font-weight:600}
.fail-text{color:var(--fail-ink);font-weight:600}
.group{margin-top:14px}
.group:first-of-type{margin-top:0}
.group-title{margin:0 0 8px;font-size:14px;color:var(--ink-2)}
.chips{display:flex;flex-wrap:wrap;gap:8px}
.chip{padding:4px 10px;border:1px solid var(--stroke);border-radius:var(--r-chip);
  background:var(--fill);font-family:var(--mono);font-size:13px}
.chip.warn{border-color:var(--fail-ink);background:var(--fail-bg);color:var(--fail-ink);font-weight:600}
.checks{display:grid;gap:8px}
.check{display:flex;flex-wrap:wrap;gap:8px;align-items:baseline;padding:10px 12px;
  border:1px solid var(--stroke);border-radius:var(--r-chip);background:var(--fill)}
.check.fail{border-color:var(--fail-ink)}
.check .state{flex:0 0 auto;padding:2px 8px;border-radius:var(--r-chip);font-size:12px;font-weight:600}
.check.ok .state{background:var(--ok-bg);color:var(--ok-ink)}
.check.fail .state{background:var(--fail-bg);color:var(--fail-ink)}
.check .name{font-weight:600}
.check .detail{flex:1 1 200px;font-size:14px;color:var(--ink-2);word-break:break-word}
.check .ms{font-family:var(--mono);font-size:12px;color:var(--ink-2)}
.endpoints{display:grid;gap:16px}
.endpoint{display:flex;gap:10px;align-items:baseline;padding:4px 0}
.method{flex:0 0 auto;min-width:58px;padding:2px 8px;border:1px solid var(--stroke);border-radius:var(--r-chip);
  background:var(--fill);font-family:var(--mono);font-size:12px;font-weight:600;text-align:center}
.method.get{color:var(--ok-ink)}
.method.post{color:var(--accent)}
.method.put{color:var(--ink-2)}
.method.delete{color:var(--fail-ink)}
.path{word-break:break-all}
.footer{margin:0;text-align:center;font-size:13px;color:var(--ink-2)}
</style>
</head>
<body>
<main class="wrap">
  <header class="card top">
    <div class="brand">
      <p class="eyebrow">后端服务状态</p>
      <h1>${escapeHtml(service.name || 'calmobile-server')}<span class="version">v${escapeHtml(service.version || '-')}</span></h1>
    </div>
    <div class="controls">
      <span class="muted" id="updated">更新于 ${escapeHtml(formatTime(service.now, service.timeZone))}</span>
      <button class="btn" id="refresh" type="button">刷新</button>
      <label class="toggle"><input id="auto" type="checkbox" checked> 自动刷新（5 秒）</label>
    </div>
    <div class="badge ${badgeClass}" id="badge">${ok ? '正常' : '异常'}</div>
  </header>

  <p class="alert" id="alert"${database.error ? '' : ' hidden'}>数据库不可用：${escapeHtml(database.error || '')}</p>

  <div class="cards">
    <section class="card">
      <h2>服务信息</h2>
      <dl class="kv">
        <div><dt>Node 版本</dt><dd class="mono" id="svc-node">${escapeHtml(service.node || '—')}</dd></div>
        <div><dt>运行时长</dt><dd id="svc-uptime">${escapeHtml(formatDuration(service.uptimeSec))}</dd></div>
        <div><dt>时区</dt><dd class="mono" id="svc-tz">${escapeHtml(service.timeZone || '—')}</dd></div>
        <div><dt>当前时间</dt><dd class="mono" id="svc-now">${escapeHtml(formatTime(service.now, service.timeZone))}</dd></div>
        <div><dt>启动时间</dt><dd class="mono" id="svc-started">${escapeHtml(formatTime(service.startedAt, service.timeZone))}</dd></div>
      </dl>
    </section>

    <section class="card">
      <h2>数据库</h2>
      <dl class="kv">
        <div><dt>连通状态</dt><dd class="${database.connected ? 'ok-text' : 'fail-text'}" id="db-state">${database.connected ? '已连接' : '未连接'}</dd></div>
        <div><dt>查询延迟</dt><dd class="mono" id="db-latency">${escapeHtml(formatMs(database.latencyMs))}</dd></div>
        <div><dt>版本</dt><dd class="mono" id="db-version" title="${escapeHtml(database.version)}">${escapeHtml(shortVersion(database.version))}</dd></div>
        <div><dt>数据库</dt><dd class="mono" id="db-name">${escapeHtml(database.database || '—')}</dd></div>
        <div><dt>地址</dt><dd class="mono" id="db-host">${escapeHtml(database.host || '—')}</dd></div>
        <div><dt>连接池</dt><dd class="mono" id="db-pool">total ${escapeHtml(formatCount(pool.total))} / idle ${escapeHtml(formatCount(pool.idle))} / waiting ${escapeHtml(formatCount(pool.waiting))}</dd></div>
      </dl>
      <p class="alert inline" id="db-error"${database.error ? '' : ' hidden'}>${escapeHtml(database.error || '')}</p>
    </section>

    <section class="card">
      <h2>迁移</h2>
      <p class="muted" id="migrations-summary">${escapeHtml(migrationViews.summary)}</p>
      <div class="group">
        <p class="group-title">已应用（<span id="migrations-applied-count">${migrationViews.appliedCount}</span>）</p>
        <div class="chips" id="migrations-applied">${migrationViews.applied}</div>
      </div>
      <div class="group">
        <p class="group-title">未应用（<span id="migrations-pending-count">${migrationViews.pendingCount}</span>）</p>
        <div class="chips" id="migrations-pending">${migrationViews.pending}</div>
      </div>
    </section>

    <section class="card">
      <h2>数据量</h2>
      <dl class="kv">
        ${countRows}
      </dl>
    </section>

    <section class="card">
      <h2>自检项 <span class="muted" id="checks-count">${checks.length} 项</span></h2>
      <div class="checks" id="checks">${renderChecks(checks)}</div>
    </section>

    <section class="card">
      <h2>接口清单 <span class="muted" id="endpoints-count">${endpoints.length} 条</span></h2>
      <div class="endpoints" id="endpoints">${renderEndpoints(endpoints)}</div>
    </section>
  </div>

  <p class="footer">数据来自 GET /api/v1/status · 每 5 秒自动刷新一次 · 深色模式跟随系统</p>
</main>
<script>
(function () {
  'use strict';

  // 首屏由服务端渲染，这份报告给脚本做第一次对齐与后续刷新用。
  const INITIAL = ${payload};
  const AUTO_MS = 5000;
  const CHECK_LABELS = { ok: '通过', fail: '失败' };
  const badge = document.getElementById('badge');
  const alertBox = document.getElementById('alert');
  const dbError = document.getElementById('db-error');
  const autoBox = document.getElementById('auto');
  const refreshBtn = document.getElementById('refresh');
  let timer = null;

  function esc(value) {
    return String(value === null || value === undefined ? '' : value)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  function setText(id, value) {
    const el = document.getElementById(id);
    if (el) { el.textContent = value; }
  }

  function formatDuration(seconds) {
    const total = Math.max(0, Math.floor(Number(seconds) || 0));
    const days = Math.floor(total / 86400);
    const hours = Math.floor((total % 86400) / 3600);
    const minutes = Math.floor((total % 3600) / 60);
    const parts = [];
    if (days > 0) { parts.push(days + ' 天'); }
    if (days > 0 || hours > 0) { parts.push(hours + ' 小时'); }
    if (days > 0 || hours > 0 || minutes > 0) { parts.push(minutes + ' 分'); }
    parts.push((total % 60) + ' 秒');
    return parts.join(' ');
  }

  function formatMs(ms) {
    if (ms === null || ms === undefined || !isFinite(Number(ms))) { return '—'; }
    const value = Number(ms);
    return value >= 100 ? Math.round(value) + ' ms' : value.toFixed(1) + ' ms';
  }

  function formatCount(value) {
    return value === null || value === undefined ? '—' : String(value);
  }

  function formatTime(iso, timeZone) {
    const date = new Date(iso);
    if (isNaN(date.getTime())) { return '—'; }
    try {
      return new Intl.DateTimeFormat('zh-CN', {
        timeZone: timeZone || 'UTC',
        year: 'numeric', month: '2-digit', day: '2-digit',
        hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
      }).format(date);
    } catch (error) {
      return date.toISOString();
    }
  }

  function shortVersion(version) {
    const text = String(version || '');
    if (!text) { return '—'; }
    const head = text.split(' on ')[0].trim();
    return head || text;
  }

  function chip(text, tone) {
    return '<span class="chip' + (tone ? ' ' + tone : '') + '">' + esc(text) + '</span>';
  }

  function renderChecks(checks) {
    if (!checks || checks.length === 0) {
      return '<div class="check fail"><span class="state">失败</span>'
        + '<span class="name">自检项</span><span class="detail">没有拿到任何自检结果</span>'
        + '<span class="ms">—</span></div>';
    }
    return checks.map(function (check) {
      const status = check.status === 'ok' ? 'ok' : 'fail';
      return '<div class="check ' + status + '">'
        + '<span class="state">' + CHECK_LABELS[status] + '</span>'
        + '<span class="name">' + esc(check.name) + '</span>'
        + '<span class="detail">' + esc(check.detail) + '</span>'
        + '<span class="ms">' + esc(formatMs(check.ms)) + '</span>'
        + '</div>';
    }).join('');
  }

  function groupEndpoints(endpoints) {
    const groups = [];
    const index = {};
    (endpoints || []).forEach(function (item) {
      const rest = String(item.path || '').replace(/^\\/api\\/v1\\/?/, '');
      const segment = rest.split('/')[0];
      if (!index[segment]) {
        index[segment] = { prefix: segment ? '/api/v1/' + segment : '/api/v1', items: [] };
        groups.push(index[segment]);
      }
      index[segment].items.push(item);
    });
    return groups;
  }

  function renderEndpoints(endpoints) {
    const groups = groupEndpoints(endpoints);
    if (groups.length === 0) { return '<p class="muted">没有读到任何路由</p>'; }
    return groups.map(function (group) {
      const rows = group.items.map(function (item) {
        return '<div class="endpoint">'
          + '<span class="method ' + esc(String(item.method).toLowerCase()) + '">' + esc(item.method) + '</span>'
          + '<span class="path mono">' + esc(item.path) + '</span>'
          + '</div>';
      }).join('');
      return '<div class="group"><p class="group-title mono">' + esc(group.prefix) + '</p>' + rows + '</div>';
    }).join('');
  }

  function renderMigrations(migrations, timeZone) {
    const applied = migrations.applied || [];
    const pending = migrations.pending || [];
    setText('migrations-applied-count', applied.length);
    setText('migrations-pending-count', pending.length);
    document.getElementById('migrations-applied').innerHTML = applied.length > 0
      ? applied.map(function (item) { return chip(item.id + ' · ' + formatTime(item.appliedAt, timeZone)); }).join('')
      : '<span class="muted">无</span>';
    document.getElementById('migrations-pending').innerHTML = pending.length > 0
      ? pending.map(function (id) { return chip(id, 'warn'); }).join('')
      : '<span class="muted">无</span>';
    let summary = '已应用 ' + applied.length + ' 项，没有遗漏';
    if (migrations.error && applied.length === 0) {
      summary = '读不到迁移记录：' + migrations.error;
    } else if (pending.length > 0) {
      summary = '已应用 ' + applied.length + ' 项，还有 ' + pending.length + ' 项未应用';
    }
    setText('migrations-summary', summary);
  }

  function render(report) {
    const service = report.service || {};
    const database = report.database || {};
    const pool = database.pool || {};
    const counts = report.data || {};

    badge.textContent = report.ok ? '正常' : '异常';
    badge.className = 'badge ' + (report.ok ? 'ok' : 'fail');

    // 顶部的红色横幅只在数据库不可用时出现；内容是数据库自己报的错。
    if (database.error) {
      alertBox.textContent = '数据库不可用：' + database.error;
      alertBox.hidden = false;
    } else {
      alertBox.hidden = true;
    }

    setText('svc-node', service.node || '—');
    setText('svc-uptime', formatDuration(service.uptimeSec));
    setText('svc-tz', service.timeZone || '—');
    setText('svc-now', formatTime(service.now, service.timeZone));
    setText('svc-started', formatTime(service.startedAt, service.timeZone));

    const state = document.getElementById('db-state');
    state.textContent = database.connected ? '已连接' : '未连接';
    state.className = database.connected ? 'ok-text' : 'fail-text';
    setText('db-latency', formatMs(database.latencyMs));
    setText('db-version', shortVersion(database.version));
    document.getElementById('db-version').title = database.version || '';
    setText('db-name', database.database || '—');
    setText('db-host', database.host || '—');
    setText('db-pool', 'total ' + formatCount(pool.total) + ' / idle ' + formatCount(pool.idle)
      + ' / waiting ' + formatCount(pool.waiting));
    dbError.textContent = database.error || '';
    dbError.hidden = !database.error;

    renderMigrations(report.migrations || {}, service.timeZone);
    document.getElementById('checks').innerHTML = renderChecks(report.checks);
    document.getElementById('endpoints').innerHTML = renderEndpoints(report.endpoints);
    setText('checks-count', (report.checks || []).length + ' 项');
    setText('endpoints-count', (report.endpoints || []).length + ' 条');
    document.querySelectorAll('[data-count]').forEach(function (el) {
      el.textContent = formatCount(counts[el.getAttribute('data-count')]);
    });
  }

  /** 刷新失败（后端都没了）时也要说清楚，而不是停在上一份数据上装没事。 */
  function renderUnreachable(error) {
    badge.textContent = '异常';
    badge.className = 'badge fail';
    alertBox.textContent = '连不上后端 /api/v1/status：' + (error && error.message ? error.message : error);
    alertBox.hidden = false;
  }

  async function refresh() {
    try {
      const response = await fetch('/api/v1/status', { cache: 'no-store' });
      render(await response.json());
      setText('updated', '更新于 ' + formatTime(new Date().toISOString(), INITIAL.service && INITIAL.service.timeZone));
    } catch (error) {
      renderUnreachable(error);
    }
  }

  function schedule() {
    if (timer) { clearInterval(timer); timer = null; }
    if (autoBox.checked) { timer = setInterval(refresh, AUTO_MS); }
  }

  refreshBtn.addEventListener('click', function () {
    refresh();
    schedule();
  });
  autoBox.addEventListener('change', schedule);
  // 标签页在后台时不必每 5 秒打一次后端，回到前台立刻补一次。
  document.addEventListener('visibilitychange', function () {
    if (document.hidden) {
      if (timer) { clearInterval(timer); timer = null; }
    } else {
      refresh();
      schedule();
    }
  });

  render(INITIAL);
  schedule();
})();
</script>
</body>
</html>
`;
}

module.exports = { renderStatusPage };
