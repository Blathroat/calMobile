(function () {
  'use strict';

  const INITIAL = __INITIAL__;
  const AUTO_MS = 5000;
  const DATABASE_ERROR_MESSAGE = '数据库暂时不可用，请查看服务端日志';
  const MIGRATION_ERROR_MESSAGE = '迁移状态暂时不可用，请查看服务端日志';
  const CHECK_ERROR_MESSAGE = '检查失败，请查看服务端日志';
  const UNREACHABLE_ERROR_MESSAGE = '状态数据暂时不可用，请稍后重试';
  const CHECK_LABELS = { ok: '通过', fail: '失败' };
  const badge = document.getElementById('badge');
  const alertBox = document.getElementById('alert');
  const dbError = document.getElementById('db-error');
  const autoBox = document.getElementById('auto');
  const refreshButton = document.getElementById('refresh');
  let timer = null;

  function text(value, fallback) {
    return value === null || value === undefined ? fallback || '' : String(value);
  }

  function esc(value) {
    return text(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  function setText(id, value) {
    const element = document.getElementById(id);
    if (element) element.textContent = text(value);
  }

  function node(value) {
    return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  }

  function formatDuration(seconds) {
    const total = Math.max(0, Math.floor(Number(seconds) || 0));
    const days = Math.floor(total / 86400);
    const hours = Math.floor((total % 86400) / 3600);
    const minutes = Math.floor((total % 3600) / 60);
    const parts = [];
    if (days > 0) parts.push(days + ' 天');
    if (days > 0 || hours > 0) parts.push(hours + ' 小时');
    if (days > 0 || hours > 0 || minutes > 0) parts.push(minutes + ' 分');
    parts.push((total % 60) + ' 秒');
    return parts.join(' ');
  }

  function formatMs(value) {
    if (value === null || value === undefined || !isFinite(Number(value))) return '—';
    const number = Number(value);
    return number >= 100 ? Math.round(number) + ' ms' : number.toFixed(1) + ' ms';
  }

  function formatCount(value) {
    return value === null || value === undefined ? '—' : text(value);
  }

  function formatTime(value, timeZone) {
    const date = new Date(value);
    if (isNaN(date.getTime())) return '—';
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
    } catch {
      return date.toISOString();
    }
  }

  function shortVersion(value) {
    const version = text(value);
    if (!version) return '—';
    return version.split(' on ')[0].trim() || version;
  }

  function chip(value, tone) {
    return '<span class="chip' + (tone ? ' ' + tone : '') + '">' + esc(value) + '</span>';
  }

  function renderChecks(checks) {
    if (!Array.isArray(checks) || checks.length === 0) {
      return (
        '<div class="check fail"><span class="state">失败</span>' +
        '<span class="name">自检项</span><span class="detail">没有拿到任何自检结果</span>' +
        '<span class="ms">—</span></div>'
      );
    }
    return checks
      .map(function (value) {
        const check = node(value);
        const status = check.status === 'ok' ? 'ok' : 'fail';
        const detail = status === 'fail' && !check.detail ? CHECK_ERROR_MESSAGE : text(check.detail);
        return (
          '<div class="check ' +
          status +
          '">' +
          '<span class="state">' +
          CHECK_LABELS[status] +
          '</span>' +
          '<span class="name">' +
          esc(check.name) +
          '</span>' +
          '<span class="detail">' +
          esc(detail) +
          '</span>' +
          '<span class="ms">' +
          esc(formatMs(check.ms)) +
          '</span></div>'
        );
      })
      .join('');
  }

  function groupEndpoints(endpoints) {
    const groups = [];
    const index = Object.create(null);
    (Array.isArray(endpoints) ? endpoints : []).forEach(function (value) {
      const item = node(value);
      const path = text(item.path);
      const rest = path.replace(/^\/api\/v1\/?/, '');
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
    if (groups.length === 0) return '<p class="muted">没有读到任何路由</p>';
    return groups
      .map(function (group) {
        const rows = group.items
          .map(function (item) {
            const method = text(item.method);
            return (
              '<div class="endpoint"><span class="method ' +
              esc(method.toLowerCase()) +
              '">' +
              esc(method) +
              '</span><span class="path mono">' +
              esc(item.path) +
              '</span></div>'
            );
          })
          .join('');
        return '<div class="group"><p class="group-title mono">' + esc(group.prefix) + '</p>' + rows + '</div>';
      })
      .join('');
  }

  function renderMigrations(value, timeZone) {
    const migrations = node(value);
    const applied = Array.isArray(migrations.applied) ? migrations.applied : [];
    const pending = Array.isArray(migrations.pending) ? migrations.pending : [];
    setText('migrations-applied-count', applied.length);
    setText('migrations-pending-count', pending.length);
    document.getElementById('migrations-applied').innerHTML = applied.length
      ? applied
          .map(function (item) {
            item = node(item);
            return chip(text(item.id) + ' · ' + formatTime(item.appliedAt, timeZone));
          })
          .join('')
      : '<span class="muted">无</span>';
    document.getElementById('migrations-pending').innerHTML = pending.length
      ? pending
          .map(function (item) {
            return chip(item, 'warn');
          })
          .join('')
      : '<span class="muted">无</span>';
    let summary = '已应用 ' + applied.length + ' 项，没有遗漏';
    if (migrations.error && applied.length === 0) summary = MIGRATION_ERROR_MESSAGE;
    else if (pending.length > 0) summary = '已应用 ' + applied.length + ' 项，还有 ' + pending.length + ' 项未应用';
    setText('migrations-summary', summary);
  }

  function render(value) {
    const report = node(value);
    const service = node(report.service);
    const database = node(report.database);
    const pool = node(database.pool);
    const migrations = node(report.migrations);
    const counts = node(report.data);
    const checks = Array.isArray(report.checks) ? report.checks : [];
    const endpoints = Array.isArray(report.endpoints) ? report.endpoints : [];
    const connected = database.connected === true;
    const ok = report.ok === true;

    setText('service-name', service.name || 'calmobile-server');
    setText('service-version', service.version ? 'v' + service.version : 'v-');
    setText('updated', service.now ? '数据时间 ' + formatTime(service.now, service.timeZone) : '等待数据');
    badge.textContent = ok ? '正常' : '异常';
    badge.className = 'badge ' + (ok ? 'ok' : 'fail');
    if (database.error || !connected) {
      alertBox.textContent = DATABASE_ERROR_MESSAGE;
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
    state.textContent = connected ? '已连接' : '未连接';
    state.className = connected ? 'ok-text' : 'fail-text';
    setText('db-latency', formatMs(database.latencyMs));
    setText('db-version', shortVersion(database.version));
    document.getElementById('db-version').title = text(database.version);
    setText('db-name', database.database || '—');
    setText('db-host', database.host || '—');
    setText(
      'db-pool',
      'total ' +
        formatCount(pool.total) +
        ' / idle ' +
        formatCount(pool.idle) +
        ' / waiting ' +
        formatCount(pool.waiting),
    );
    dbError.textContent = database.error ? DATABASE_ERROR_MESSAGE : '';
    dbError.hidden = !database.error;

    renderMigrations(migrations, service.timeZone);
    document.getElementById('checks').innerHTML = renderChecks(checks);
    document.getElementById('endpoints').innerHTML = renderEndpoints(endpoints);
    setText('checks-count', checks.length + ' 项');
    setText('endpoints-count', endpoints.length + ' 条');
    document.querySelectorAll('[data-count]').forEach(function (element) {
      element.textContent = formatCount(counts[element.getAttribute('data-count')]);
    });
  }

  function renderUnreachable() {
    badge.textContent = '异常';
    badge.className = 'badge fail';
    alertBox.textContent = UNREACHABLE_ERROR_MESSAGE;
    alertBox.hidden = false;
  }

  async function refresh() {
    refreshButton.disabled = true;
    try {
      const response = await fetch('/api/v1/status', { cache: 'no-store' });
      const report = await response.json();
      render(report);
    } catch {
      renderUnreachable();
    } finally {
      refreshButton.disabled = false;
    }
  }

  function schedule() {
    if (timer) clearInterval(timer);
    timer = autoBox.checked ? setInterval(refresh, AUTO_MS) : null;
  }

  refreshButton.addEventListener('click', function () {
    refresh();
    schedule();
  });
  autoBox.addEventListener('change', schedule);
  document.addEventListener('visibilitychange', function () {
    if (document.hidden) {
      if (timer) clearInterval(timer);
      timer = null;
    } else {
      refresh();
      schedule();
    }
  });

  render(INITIAL);
  schedule();
})();
