/**
 * 前端 API 的演示实现（内存数据，无数据库）。
 *
 * 每个处理函数对应 `js/core/api.js` 里的一个方法，返回值与 `WebAppActions`
 * 完全同形，因此前端只换传输层就能跑通。真实后端完成后整体替换本文件。
 *
 * 约定：处理函数返回 `{ ok: false, error }` 表示业务失败（HTTP 仍为 200），
 * 抛出的异常才会变成 500——与桥接层「业务失败走返回值、崩溃走异常」一致。
 */

const {
  ACCOUNTS, ROLE_LABEL, EXHIBITIONS, REGISTRATIONS, CODE_PREFIX,
} = require('./demo-data');

/** 每个会话只保留内存态；演示用，不做持久化。 */
const sessions = new Map();

let nextRegistrationId = 100;

// ── 工具 ────────────────────────────────────────────────────────

function monthOf(date, fallback) {
  const value = Number(String(date || '').slice(5, 7));
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

function dayOf(date, fallback) {
  const value = Number(String(date || '').slice(8, 10));
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

function yearOf(date, fallback) {
  const value = Number(String(date || '').slice(0, 4));
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

/** 报名方式标签，与 WebAppActions.modeLabel 保持一致。 */
function modeLabel(status) {
  if (status === '仅展示') {
    return '仅展示';
  }
  if (status === '截止报名') {
    return '截止报名';
  }
  if (status === '已结束') {
    return '已结束';
  }
  return status === '无需审核' ? '报名中 · 无需审核' : '报名中 · 需审核';
}

function registrationCode(exhibitionId, recordId) {
  return `${CODE_PREFIX}${exhibitionId}|${recordId}`;
}

/** 报名码只在启用二维码、且状态为已通过或已参加时下发。 */
function checkInCodeFor(exhibition, record) {
  const usable = record.statusLabel === '已通过' || record.statusLabel === '已参加';
  return exhibition.qrEnabled && usable
    ? registrationCode(exhibition.id, record.id)
    : '';
}

function findExhibition(id) {
  return EXHIBITIONS.find((item) => item.id === id) || null;
}

function findRegistration(id) {
  return REGISTRATIONS.find((item) => item.id === id) || null;
}

function countByExhibition(exhibitionId) {
  return REGISTRATIONS.filter((item) => item.exhibitionId === exhibitionId).length;
}

/**
 * 首页日历的落点月份：最早一个有展会的月份。
 *
 * 由 bootstrap 下发给前端，替代原来「请求的月份没有展会就悄悄改成六月」的隐式回落——
 * 那既让 `exhibitions.month` 的返回值和入参对不上，也让缓存键不稳定（预加载打不中）。
 */
function landingMonth() {
  const months = EXHIBITIONS
    .map((item) => ({ year: yearOf(item.date, 2026), month: monthOf(item.date, 6) }))
    .sort((a, b) => (a.year - b.year) || (a.month - b.month));
  return months[0] || { year: 2026, month: 6 };
}

function exhibitionPayload(item) {
  return {
    id: item.id,
    title: item.title,
    venue: item.venue,
    time: item.time,
    category: item.category,
    description: item.description,
    descriptionFormat: 'md',
    status: item.status,
    mode: item.status === '仅展示' ? 'display' : 'review',
    modeLabel: modeLabel(item.status),
    openForRegistration: item.status === '需审核' || item.status === '无需审核',
    year: yearOf(item.date, 2026),
    month: monthOf(item.date, 6),
    day: dayOf(item.date, 1),
    date: item.date,
    dateLabel: `${monthOf(item.date, 6)}月${dayOf(item.date, 1)}日`,
    exhibitor: item.exhibitor,
    exhibitorNote: item.exhibitorNote,
    highlights: item.highlights,
    imageUri: item.imageUri,
    registrationStart: item.registrationStart,
    registrationEnd: item.registrationEnd,
    qrEnabled: item.qrEnabled,
    registrationCount: countByExhibition(item.id),
    fieldCount: 3,
  };
}

function registrationPayload(record) {
  const exhibition = findExhibition(record.exhibitionId);
  return {
    id: record.id,
    exhibitionId: record.exhibitionId,
    exhibitionTitle: exhibition ? exhibition.title : '',
    exhibitionDay: exhibition ? dayOf(exhibition.date, 1) : 1,
    exhibitionTime: exhibition ? exhibition.time : '',
    exhibitionVenue: exhibition ? exhibition.venue : '',
    visitorName: record.visitorName,
    visitorType: record.visitorType,
    answers: record.answers,
    status: record.statusLabel,
    statusLabel: record.statusLabel,
    qrEnabled: Boolean(exhibition && exhibition.qrEnabled),
    checkInCode: exhibition ? checkInCodeFor(exhibition, record) : '',
  };
}

function userPayload(username) {
  const account = ACCOUNTS.find((item) => item.username === username);
  if (!account) {
    return {
      loggedIn: false,
      guest: true,
      role: 'guest',
      roleLabel: ROLE_LABEL.guest,
      username: '',
      nickname: '',
      avatar: '',
      can: { register: false, profile: false, exhibitor: false, admin: false },
    };
  }
  // 个人资料与隐私偏好统一放在 account.profile 上（首次访问时补默认值），
  // 这样 userPayload 与 users.public 读的是同一份数据。
  const profile = account.profile || (account.profile = {});
  return {
    loggedIn: true,
    guest: false,
    role: account.role,
    roleLabel: ROLE_LABEL[account.role],
    username: account.username,
    nickname: account.nickname,
    email: account.email,
    bio: profile.bio || '',
    region: profile.region || '',
    socialMedia: profile.socialMedia || '',
    avatar: profile.avatar || '',
    showRegistrations: profile.showRegistrations === true,
    status: '正常',
    can: {
      register: true,
      profile: true,
      exhibitor: account.role === 'exhibitor' || account.role === 'admin',
      admin: account.role === 'admin',
    },
  };
}

// ── 处理函数 ────────────────────────────────────────────────────

const handlers = {
  // 连通性检查：前端启动时先探一次，失败就退回原生桥接。
  ping: () => ({ ok: true, service: 'calmobile-demo-server', version: '0.1.0' }),

  /** 与服务端 settings 一并下发的启动数据，字段与 bootstrap 动作一致。 */
  bootstrap: () => ({
    user: userPayload(currentUsername()),
    theme: { index: 0, colors: ['#C05621', '#48515D', '#245D3C', '#2F6F8F'] },
    ui: { mode: 'auto' },
    capabilities: { calendar: false, notifications: false, richText: true, export: true },
    categories: ['智能家居', '物流技术', '医疗健康', '新材料'],
    review: { canRevise: false, statuses: ['待审核', '已通过', '已拒绝'] },
    media: { imageCount: 8, imageSizeMb: 10, videoCount: 2 },
    announcement: { enabled: false, text: '' },
    brand: { zh: '发现展会', en: 'ExpoHub' },
    limits: {
      exhibitionTitle: 60, exhibitionVenue: 60, category: 20, fieldTitle: 30,
      usernameMin: 3, usernameMax: 20, passwordMin: 6, passwordMax: 32,
      nickname: 20, bio: 200, region: 40, answer: 200,
    },
    server: { avatarSizeMb: 2, imageFormats: ['jpg', 'png'], videoFormats: ['mp4'] },
    calendar: { available: false, landing: landingMonth() },
  }),

  'auth.login': (body) => {
    const account = ACCOUNTS.find((item) => item.username === body.username);
    if (!account || account.password !== body.password) {
      return { ok: false, error: '账号或密码不正确', user: userPayload('') };
    }
    const token = `demo-token-${account.username}`;
    sessions.set(token, account.username);
    return { ok: true, error: '', token, user: userPayload(account.username) };
  },

  'auth.register': (body) => {
    const username = String(body.username || '').trim();
    if (!username) {
      return { ok: false, error: '请输入用户名', user: userPayload('') };
    }
    if (ACCOUNTS.some((item) => item.username === username)) {
      return { ok: false, error: '该用户名已被注册', user: userPayload('') };
    }
    ACCOUNTS.push({
      username,
      password: String(body.password || ''),
      role: 'user',
      nickname: username,
      email: String(body.email || ''),
    });
    return { ok: true, error: '', user: userPayload(username) };
  },

  'auth.guest': () => userPayload(''),

  'auth.logout': () => true,

  'profile.get': () => userPayload(currentUsername()),

  'profile.save': (body) => {
    const account = ACCOUNTS.find((item) => item.username === currentUsername());
    if (!account) {
      return { ok: false, error: '请先登录', user: userPayload('') };
    }
    if (body.nickname !== undefined) {
      account.nickname = String(body.nickname).trim() || account.username;
    }
    if (body.email !== undefined) {
      account.email = String(body.email).trim();
    }
    const profile = account.profile || (account.profile = {});
    if (body.bio !== undefined) {
      profile.bio = String(body.bio);
    }
    if (body.region !== undefined) {
      profile.region = String(body.region);
    }
    if (body.socialMedia !== undefined) {
      profile.socialMedia = String(body.socialMedia);
    }
    if (body.avatar !== undefined) {
      profile.avatar = String(body.avatar);
    }
    // 隐私开关：只在这里写入，users.public 直接读它
    if (body.showRegistrations !== undefined) {
      profile.showRegistrations = body.showRegistrations === true;
    }
    return { ok: true, error: '', user: userPayload(account.username) };
  },

  'profile.password': (body) => {
    if (!body.currentPassword || !body.newPassword) {
      return { ok: false, error: '请填写完整密码' };
    }
    if (body.newPassword !== body.confirmPassword) {
      return { ok: false, error: '两次输入的新密码不一致' };
    }
    return { ok: true, error: '', note: '演示服务不会修改密码，仅校验输入' };
  },

  'notify.preferences': () => ({
    exhibitionReminder: true, registrationUpdates: true, granted: false,
  }),

  'notify.savePreferences': (body) => ({
    exhibitionReminder: Boolean(body.exhibitionReminder),
    registrationUpdates: Boolean(body.registrationUpdates),
    granted: false,
  }),

  'exhibitions.list': (body) => {
    const query = String(body.query || '').trim();
    return EXHIBITIONS
      .filter((item) => !query
                || item.title.includes(query)
                || item.venue.includes(query)
                || item.category.includes(query))
      .map(exhibitionPayload);
  },

  'exhibitions.get': (body) => {
    const item = findExhibition(body.id);
    if (!item) {
      return { found: false, error: '展会不存在或已删除' };
    }
    return { found: true, exhibition: exhibitionPayload(item), fields: defaultFields() };
  },

  /**
     * 月视图：返回当月全部展会、有展会的日期，以及选中日期的展会。
     *
     * 只带 year / month 两个参数（前端与预加载用同一形状，缓存键才稳定）；
     * `day` 可选，用于深链定位初始选中日期，缺省落到当月第一个有展会的日期。
     * 请求的月份一律照原样返回——「打开应用先看哪个月」由 bootstrap 的
     * `calendar.landing` 决定，不再由这个接口替调用方改月份。
     */
  'exhibitions.month': (body) => {
    const year = Number(body.year) || landingMonth().year;
    const month = Number(body.month) || landingMonth().month;
    const payloads = EXHIBITIONS.map(exhibitionPayload);

    const days = payloads.filter((item) => item.year === year && item.month === month);
    const eventDays = [...new Set(days.map((item) => item.day))].sort((a, b) => a - b);
    // 选中日期以调用方为准：用户点的可能是没有展会的那一天，页面会显示空状态。
    // 只有在调用方没指定日期时才回落到第一个有展会的日期。
    let day = Number(body.day) || 0;
    if (day <= 0) {
      day = eventDays[0] || 0;
    }
    const selected = days.filter((item) => item.day === day);

    const summary = (item) => ({
      id: item.id, day: item.day, title: item.title, time: item.time,
      venue: item.venue, status: item.status, modeLabel: item.modeLabel,
      openForRegistration: item.openForRegistration,
      imageUri: item.imageUri, category: item.category,
    });

    return {
      year,
      month,
      day,
      monthLabel: `${year} 年 ${month} 月`,
      eventDays,
      exhibitions: days.map(summary),
      selected: selected.map(summary),
    };
  },

  'exhibitions.save': (body) => {
    const title = String(body.title || '').trim();
    if (!title) {
      return { ok: false, error: '展会名称不能为空' };
    }
    const status = String(body.status || '需审核');
    const existing = findExhibition(body.id);
    const item = existing || {
      id: `exh-${EXHIBITIONS.length + 1}`,
      exhibitor: '主办方',
      exhibitorNote: '主办方公开信息',
      highlights: [],
      imageUri: '',
      description: '',
    };
    Object.assign(item, {
      title,
      venue: String(body.venue || '').trim(),
      time: String(body.time || '').trim(),
      date: String(body.date || item.date),
      category: String(body.category || ''),
      status,
      description: String(body.description || ''),
      imageUri: String(body.imageUri || ''),
      registrationStart: String(body.registrationStart || ''),
      registrationEnd: String(body.registrationEnd || ''),
      qrEnabled: body.qrEnabled === undefined ? Boolean(item.qrEnabled) : Boolean(body.qrEnabled),
    });
    if (!existing) {
      EXHIBITIONS.push(item);
    }
    return { ok: true, error: '', exhibition: exhibitionPayload(item) };
  },

  'exhibitions.delete': (body) => {
    const index = EXHIBITIONS.findIndex((item) => item.id === body.id);
    if (index < 0) {
      return false;
    }
    EXHIBITIONS.splice(index, 1);
    return true;
  },

  'exhibitions.status': (body) => {
    const item = findExhibition(body.id);
    if (!item) {
      return false;
    }
    item.status = String(body.status || item.status);
    return true;
  },

  'exhibitions.categories': () => ['智能家居', '物流技术', '医疗健康', '新材料'],

  'exhibitions.fields': () => defaultFields(),

  'exhibitions.saveFields': () => ({ ok: true, fields: defaultFields() }),

  'registrations.list': () => REGISTRATIONS.map(registrationPayload),

  'registrations.get': (body) => {
    const record = findRegistration(body.id);
    return record
      ? { found: true, registration: registrationPayload(record) }
      : { found: false, error: '报名记录不存在' };
  },

  'registrations.submit': (body) => {
    const exhibition = findExhibition(body.exhibitionId);
    const visitorName = String(body.visitorName || '报名用户');
    if (REGISTRATIONS.some((item) => item.exhibitionId === body.exhibitionId
            && item.visitorName === visitorName && item.statusLabel !== '已撤销')) {
      return { ok: false, error: '已提交过该展会的报名' };
    }
    const autoApproved = Boolean(exhibition && exhibition.status === '无需审核');
    const record = {
      id: `registration-${nextRegistrationId++}`,
      exhibitionId: String(body.exhibitionId || ''),
      visitorName,
      visitorType: String(body.visitorType || '自定义报名'),
      answers: String(body.answers || ''),
      registrationTime: new Date().toISOString().slice(5, 16).replace('T', ' '),
      statusLabel: autoApproved ? '已通过' : '待审核',
    };
    REGISTRATIONS.push(record);
    return {
      ok: true,
      error: '',
      autoApproved,
      statusLabel: record.statusLabel,
      registration: registrationPayload(record),
    };
  },

  'registrations.cancel': (body) => {
    const record = findRegistration(body.id);
    if (!record) {
      return { ok: false, error: '撤销失败，请稍后重试' };
    }
    record.statusLabel = '已撤销';
    return { ok: true, error: '' };
  },

  'review.list': (body) => {
    const all = REGISTRATIONS.filter((item) => !body.exhibitionId
            || item.exhibitionId === body.exhibitionId);
    const status = String(body.status || '全部');
    const records = all
      .filter((item) => status === '全部' || item.statusLabel === status)
      .map((item) => ({
        id: item.id,
        exhibitionId: item.exhibitionId,
        visitorName: item.visitorName,
        registrationTime: item.registrationTime,
        answers: item.answers,
        summary: item.answers.replace(/\n/g, ' ').slice(0, 46),
        status: item.statusLabel,
      }));
    const counts = { total: all.length };
    for (const value of ['待审核', '已通过', '已拒绝', '已参加']) {
      counts[value] = all.filter((item) => item.statusLabel === value).length;
    }
    return { exhibitionId: body.exhibitionId || '', status, records, counts };
  },

  'review.get': (body) => {
    const record = findRegistration(body.id);
    return record
      ? { found: true, record: { id: record.id, status: record.statusLabel } }
      : { found: false, error: '报名记录不存在' };
  },

  'review.updateStatus': (body) => {
    const record = findRegistration(body.id);
    if (!record) {
      return { ok: false, error: '报名记录不存在' };
    }
    record.statusLabel = String(body.status || record.statusLabel);
    return { ok: true, error: '', record: { id: record.id, status: record.statusLabel } };
  },

  /** 扫码核销：把报名从「已通过」推进到「已参加」，重复扫码给出提示。 */
  'checkin.scan': (body) => {
    const raw = String(body.code || '').trim();
    const parsed = parseCheckInCode(raw);
    if (!parsed) {
      return { ok: false, error: '无法识别的报名码，请扫描报名详情里的二维码' };
    }
    const record = findRegistration(parsed.recordId);
    if (!record) {
      return { ok: false, error: '报名记录不存在，可能已被撤销' };
    }
    const exhibition = findExhibition(record.exhibitionId);
    const info = {
      recordId: record.id,
      visitorName: record.visitorName,
      exhibitionId: record.exhibitionId,
      exhibitionTitle: exhibition ? exhibition.title : '',
      registrationTime: record.registrationTime,
      answers: record.answers.replace(/\n/g, ' ').slice(0, 46),
    };
    if (record.statusLabel === '已参加') {
      return {
        ok: false,
        duplicated: true,
        status: record.statusLabel,
        error: `${record.visitorName} 的报名码已经核销过了`,
        record: info,
      };
    }
    if (record.statusLabel !== '已通过') {
      return {
        ok: false,
        status: record.statusLabel,
        error: `当前状态为「${record.statusLabel}」，只有已通过的报名可以核销`,
        record: info,
      };
    }
    record.statusLabel = '已参加';
    return {
      ok: true,
      duplicated: false,
      status: record.statusLabel,
      message: `已核销 ${record.visitorName} 的报名`,
      error: '',
      record: info,
    };
  },

  'users.list': () => ACCOUNTS.map((item, index) => ({
    id: `user-${index + 1}`,
    nickname: item.nickname,
    email: item.email,
    status: '正常',
    registrationTime: '2026-06-01',
    lastLoginTime: '2026-06-12 14:20',
    role: ROLE_LABEL[item.role],
  })),

  'users.get': (body) => {
    const index = Number(String(body.id || '').replace('user-', '')) - 1;
    const account = ACCOUNTS[index];
    return account
      ? { found: true, user: { id: body.id, nickname: account.nickname, role: ROLE_LABEL[account.role] } }
      : { found: false, error: '用户不存在' };
  },

  'users.status': () => true,

  'users.public': (body) => {
    const index = Number(String(body.userId || '').replace('user-', '')) - 1;
    const account = ACCOUNTS.find((item) => item.nickname === body.nickname)
            || (Number.isFinite(index) && index >= 0 ? ACCOUNTS[index] : null);
    if (!account) {
      return { found: false, error: '用户不存在或未公开' };
    }
    const isAdmin = userPayload(currentUsername()).role === 'admin';
    const profile = account.profile || {};
    // 普通访问者按用户的隐私设置过滤；管理员不受限制。
    const showRegistrations = profile.showRegistrations === true;
    return {
      found: true,
      nickname: account.nickname,
      role: ROLE_LABEL[account.role],
      bio: profile.bio || '',
      region: profile.region || '',
      avatar: profile.avatar || '',
      socialMedia: profile.socialMedia || '',
      showRegistrations,
      viewedAsAdmin: isAdmin,
      registrations: (isAdmin || showRegistrations)
        ? REGISTRATIONS.filter((item) => item.visitorName === account.nickname)
          .map(registrationPayload)
        : [],
    };
  },

  'search.query': (body) => {
    const query = String(body.query || '').trim();
    if (!query) {
      return { query, exhibitions: [], users: [], count: 0 };
    }
    const exhibitions = EXHIBITIONS
      .filter((item) => item.title.includes(query) || item.venue.includes(query)
                || item.category.includes(query))
      .map(exhibitionPayload);
    const users = ACCOUNTS
      .filter((item) => item.nickname.includes(query) || item.email.includes(query))
      .map((item, index) => ({
        id: `user-${index + 1}`,
        nickname: item.nickname,
        email: item.email,
        role: ROLE_LABEL[item.role],
        status: '正常',
      }));
    return { query, exhibitions, users, count: exhibitions.length + users.length };
  },

  'settings.get': () => settingsPayload(),

  'settings.save': (body) => {
    if (body.themeIndex !== undefined) {
      settings.theme.index = Number(body.themeIndex) || 0;
    }
    if (body.appTitleZh !== undefined) {
      settings.brand.zh = String(body.appTitleZh) || '发现展会';
    }
    if (body.appTitleEn !== undefined) {
      settings.brand.en = String(body.appTitleEn) || 'ExpoHub';
    }
    if (body.announcement !== undefined) {
      settings.announcement.text = String(body.announcement);
    }
    if (body.announcementEnabled !== undefined) {
      settings.announcement.enabled = Boolean(body.announcementEnabled);
    }
    if (body.canRevise !== undefined) {
      settings.review.canRevise = Boolean(body.canRevise);
    }
    if (Array.isArray(body.categories) && body.categories.length > 0) {
      settings.categories = body.categories.map((item) => String(item).trim()).filter(Boolean);
    }
    return { ok: true, error: '', settings: settingsPayload() };
  },

  'settings.uiMode': (body) => {
    const mode = ['auto', 'light', 'dark'].includes(body.mode) ? body.mode : 'auto';
    settings.ui.mode = mode;
    return { ok: true, error: '', mode };
  },
};

// 设置只在进程内保留，字段与 settings 动作一致。
const settings = {
  theme: { index: 0, colors: ['#C05621', '#48515D', '#245D3C', '#2F6F8F'] },
  ui: { mode: 'auto' },
  announcement: { enabled: false, text: '' },
  brand: { zh: '发现展会', en: 'ExpoHub' },
  categories: ['智能家居', '物流技术', '医疗健康', '新材料'],
  review: { canRevise: false },
  media: { imageCount: 8, imageSizeMb: 10, videoCount: 2 },
  upload: { avatarSizeMb: 2, imageFormats: ['jpg', 'png'], videoFormats: ['mp4'] },
  limits: {
    exhibitionTitle: 60, exhibitionVenue: 60, category: 20, fieldTitle: 30,
    usernameMin: 3, usernameMax: 20, passwordMin: 6, passwordMax: 32,
    nickname: 20, bio: 200, region: 40, answer: 200,
  },
};

function settingsPayload() {
  return JSON.parse(JSON.stringify(settings));
}

/** 当前请求对应的登录用户名：演示服务用 Authorization 头里的 demo token。 */
let currentRequestUsername = '';

function currentUsername() {
  return currentRequestUsername;
}

/** 设置当前请求的用户；由 HTTP 入口在分发前调用。 */
function setCurrentUser(username) {
  currentRequestUsername = username || '';
}

function usernameFromAuthHeader(header) {
  const value = String(header || '');
  if (!value.startsWith('Bearer ')) {
    return '';
  }
  return sessions.get(value.slice('Bearer '.length)) || '';
}

/** 没有报名收集项时回退到默认三项，与 ExhibitionConfiguration 一致。 */
function defaultFields() {
  return [
    { title: '姓名 / 公司名称', type: '文本', required: true, options: [] },
    { title: '参观身份', type: '单选', required: true, options: ['专业观众', '采购负责人', '媒体伙伴'] },
    { title: '报名需求', type: '多选', required: false, options: ['希望安排展商洽谈', '开展前一天提醒'] },
  ];
}

/** 解析扫码内容：完整报名码，或直接是报名记录 id。 */
function parseCheckInCode(raw) {
  if (!raw) {
    return null;
  }
  if (raw.startsWith(CODE_PREFIX)) {
    const body = raw.slice(CODE_PREFIX.length);
    const at = body.indexOf('|');
    if (at <= 0) {
      return null;
    }
    const recordId = body.slice(at + 1).trim();
    return recordId ? { exhibitionId: body.slice(0, at).trim(), recordId } : null;
  }
  const record = findRegistration(raw);
  return record ? { exhibitionId: record.exhibitionId, recordId: record.id } : null;
}

module.exports = {
  handlers,
  setCurrentUser,
  usernameFromAuthHeader,
};
