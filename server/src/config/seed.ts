/**
 * 开发库示例数据。
 *
 * 只用于本地演示与契约测试的准备（`pnpm db:seed`、`test/global-setup-contract.ts`），
 * 生产环境在 `seed()` 开头直接拒绝。数据形状与 `src/test` 下的用例、演示脚本共享，
 * 改固定 id 或字段之前先看一遍引用到的地方。
 */

// 运行环境要先定下来：seed 也可能对着生产库跑（会直接拒绝），
// 而 pool 在加载的那一刻就按 NODE_ENV 选好库了（见 config/runtime.ts）。
import * as runtime from './runtime.js';
import { pool } from './pool.js';
import bcrypt from 'bcryptjs';
import * as labels from '../domain/labels.js';
import { DEFAULT_SETTINGS } from './default-settings.js';

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** 示例账号：一个 id 一行，重复执行 seed 时按 id 更新成期望值。 */
interface SeedAccount {
  id: string;
  username: string;
  email: string;
  nickname: string;
  role: 'user' | 'exhibitor' | 'admin';
  status: 'active' | 'limited' | 'banned';
  bio: string;
  region: string;
  socialMedia: string;
  avatar: string;
  /** 展商身份到期时间（相对今天的天数，负数表示已过期）；null 表示永久或不是展商。 */
  expiresInDays: number | null;
  acceptMeetings: boolean;
  meetingAllowCancel: boolean;
  meetingNotice: string;
  showRegistrations: boolean;
  seenHints: string[];
  /** 注册时间距今多少天，只影响用户列表排序与「注册时间」展示。 */
  registerDaysAgo: number;
  /** 最近登录地区（管理端用户列表展示；本人登录后会被真实来源覆盖）。 */
  lastLoginRegion: string;
}

/** 示例收集项：报名页按顺序渲染，type 只认 text / radio / checkbox。 */
interface SeedField {
  title: string;
  type: 'text' | 'radio' | 'checkbox';
  required: boolean;
  options: string[];
}

/**
 * 示例展会。
 *
 * 日期一律用「相对今天的天数」表示：写死日期的示例数据过一阵就全部过期，
 * 报名窗口与日历落点都跟着失效。dayOffset 为 0 表示今天。
 *
 * exh-1 是日历落点（最早的一场），月视图契约测试依赖「落点那个月里的展会都归
 * exhibitor 账号」，因此新增展会都放在 +60 天以后，不要插到它前面。
 */
interface SeedExhibition {
  id: string;
  title: string;
  venue: string;
  time: string;
  dayOffset: number;
  /** 闭展日期相对今天的天数；null 表示单日展会。 */
  endOffset: number | null;
  status: 'review' | 'optional' | 'display' | 'closed' | 'ended';
  category: string;
  description: string;
  exhibitorId: string;
  exhibitorNote: string;
  registrationNotice: string;
  /** 报名窗口起止（相对今天的天数）；null 表示不设窗口。 */
  registerFrom: number | null;
  registerTo: number | null;
  qrEnabled: boolean;
  allowCancel: boolean;
  fields: SeedField[];
}

/**
 * 示例报名：状态覆盖 pending / approved / rejected / cancelled / attended 五种。
 *
 * attendanceStart / attendanceEnd 是多天展会报名时选的参加时间段（相对今天的天数）；
 * checkInHoursAgo 只给「已参加」用，表示核销时间相对现在多少小时之前。
 * answers 与对应展会的收集项格式一致：每行「标题：值」，多选值用「、」连接。
 */
interface SeedRegistration {
  id: string;
  exhibitionId: string;
  visitorId: string;
  visitorName: string;
  visitorType: string;
  answers: string;
  status: 'pending' | 'approved' | 'rejected' | 'cancelled' | 'attended';
  attendanceStart: number | null;
  attendanceEnd: number | null;
  checkInHoursAgo: number | null;
}

/** 示例私人会议：日期用相对今天的天数，保证演示时都还在未来。 */
interface SeedMeeting {
  id: string;
  exhibitorId: string;
  visitorId: string;
  visitorName: string;
  dayOffset: number;
  time: string;
  answers: string;
  status: 'pending' | 'approved' | 'rejected' | 'cancelled';
}

/** 示例邀请码：固定 code 便于演示；重复执行时把次数与有效期恢复成这里的期望值。 */
interface SeedInvite {
  id: string;
  code: string;
  maxUses: number;
  durationDays: number;
  /** 有效期（相对今天的天数）；null 表示不过期。 */
  validDays: number | null;
}

/**
 * 示例数据：账号、展会（含收集项）、报名、私人会议、邀请码、服务器设置。可重复执行。生产环境拒绝执行。
 *
 * 幂等约定：账号 / 展会 / 报名 / 邀请码按固定 id 写入，重复执行时更新成这里的期望值
 * （演示中改过的状态会被重置）；收集项与私人会议按存在性跳过，避免撞上唯一约束。
 * 与契约测试共享的固定数据是账号 demo / exhibitor / user 与展会 exh-1..4、报名 reg-1..3，
 * 改它们的形状之前先看一遍 src/test 下引用到的地方。
 */
export async function seed(): Promise<void> {
  if (runtime.isProduction) {
    throw new Error('生产环境不写入示例账号。管理员由 ADMIN_USERNAME、ADMIN_PASSWORD、ADMIN_EMAIL 在启动时创建。');
  }
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const passwordHash = await bcrypt.hash('password', 10);
    // demo / exhibitor / user 三个固定账号是契约测试与演示脚本的入口，用户名与密码不要改；
    // 其余账号覆盖管理端要看到的角色与状态：第二个展商、受限、封禁、展商身份已到期。
    const accounts: SeedAccount[] = [
      {
        id: 'usr-1',
        username: 'demo',
        email: 'demo@example.com',
        nickname: 'demo',
        role: 'admin',
        status: 'active',
        bio: '平台运营与展会审核',
        region: '广东省深圳市',
        socialMedia: 'demo_admin',
        avatar: '',
        expiresInDays: null,
        acceptMeetings: false,
        meetingAllowCancel: false,
        meetingNotice: '',
        showRegistrations: false,
        seenHints: ['home-calendar-swipe'],
        registerDaysAgo: 120,
        lastLoginRegion: '广东省深圳市',
      },
      {
        id: 'usr-2',
        username: 'exhibitor',
        email: 'exhibitor@example.com',
        nickname: 'exhibitor',
        role: 'exhibitor',
        status: 'active',
        bio: '智能家居与物流装备展主办方',
        region: '上海市',
        socialMedia: 'linyizhou_expo',
        avatar: '',
        expiresInDays: null,
        acceptMeetings: false,
        meetingAllowCancel: false,
        meetingNotice: '',
        showRegistrations: false,
        seenHints: ['home-calendar-swipe'],
        registerDaysAgo: 100,
        lastLoginRegion: '上海市',
      },
      {
        id: 'usr-3',
        username: 'user',
        email: 'user@example.com',
        nickname: 'user',
        role: 'user',
        status: 'active',
        bio: '展会常客，关注智能家居与新材料。',
        region: '北京市',
        socialMedia: '',
        avatar: '',
        expiresInDays: null,
        acceptMeetings: false,
        meetingAllowCancel: false,
        meetingNotice: '',
        showRegistrations: false,
        seenHints: [],
        registerDaysAgo: 90,
        lastLoginRegion: '北京市',
      },
      {
        id: 'usr-5',
        username: 'mediaexpo',
        email: 'mediaexpo@example.com',
        nickname: '方启明',
        role: 'exhibitor',
        status: 'active',
        bio: '跨境供应链展与医疗器械论坛的主办人，接受私人会议预约。',
        region: '浙江省杭州市',
        socialMedia: '@fangqiming',
        avatar: '/media/avatars/0123456789abcdef0123456789abcdef.png',
        expiresInDays: null,
        acceptMeetings: true,
        meetingAllowCancel: true,
        meetingNotice: '请提前一天确认会议时间',
        showRegistrations: true,
        seenHints: ['home-calendar-swipe', 'exhibitor-checkin'],
        registerDaysAgo: 60,
        lastLoginRegion: '浙江省杭州市',
      },
      {
        id: 'usr-6',
        username: 'limiteduser',
        email: 'limited@example.com',
        nickname: '陈嘉禾',
        role: 'user',
        status: 'limited',
        bio: '账号状态演示：受限账号不能报名、不能发布展会。',
        region: '四川省成都市',
        socialMedia: '',
        avatar: '',
        expiresInDays: null,
        acceptMeetings: false,
        meetingAllowCancel: false,
        meetingNotice: '',
        showRegistrations: false,
        seenHints: [],
        registerDaysAgo: 45,
        lastLoginRegion: '四川省成都市',
      },
      {
        id: 'usr-7',
        username: 'banneduser',
        email: 'banned@example.com',
        nickname: '高远',
        role: 'user',
        status: 'banned',
        bio: '账号状态演示：封禁账号在登录时就被拒绝。',
        region: '湖北省武汉市',
        socialMedia: '@gaoyuan_media',
        avatar: '',
        expiresInDays: null,
        acceptMeetings: false,
        meetingAllowCancel: false,
        meetingNotice: '',
        showRegistrations: false,
        seenHints: [],
        registerDaysAgo: 30,
        lastLoginRegion: '湖北省武汉市',
      },
      {
        id: 'usr-8',
        username: 'trialexpo',
        email: 'trial@example.com',
        nickname: '秦岚',
        role: 'exhibitor',
        status: 'active',
        bio: '限时展商演示：展商身份已到期，登录后会自动降为普通用户。',
        region: '江苏省南京市',
        socialMedia: '',
        avatar: '',
        expiresInDays: -2,
        acceptMeetings: true,
        meetingAllowCancel: false,
        meetingNotice: '',
        showRegistrations: false,
        seenHints: [],
        registerDaysAgo: 20,
        lastLoginRegion: '江苏省南京市',
      },
    ];
    for (const item of accounts) {
      // `email_verified` 必须在这里显式写 true：迁移 0004 里那条回填写在「存量账号回填」上，
      // 而**全新库是先迁移、后 seed**，回填时表还是空的 —— 不写的话示例账号一建出来就是
      // 「邮箱未验证」，找不回密码、也开不了两步验证（演示账号的邮箱本来就是占位地址，
      // 收不到信，只能按已验证处理）。
      // 重复执行时把密码、状态与资料一起恢复成期望值，演示中改乱的数据能一键回到初始形态。
      await client.query(
        `
                INSERT INTO users (id, username, password_hash, email, nickname, role, status, bio, region,
                    social_media, avatar, show_registrations, accept_meetings, meeting_allow_cancel,
                    meeting_notice, exhibitor_expires_at, seen_hints, last_login_region,
                    email_verified, email_verified_at, registration_time)
                VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15,
                    CASE WHEN $16::int IS NULL THEN NULL ELSE now() + make_interval(days => $16::int) END,
                    $17::text[], $18, true, now(), now() - make_interval(days => $19::int))
                ON CONFLICT (id) DO UPDATE SET
                    username = EXCLUDED.username,
                    password_hash = EXCLUDED.password_hash,
                    email = EXCLUDED.email,
                    nickname = EXCLUDED.nickname,
                    role = EXCLUDED.role,
                    status = EXCLUDED.status,
                    bio = EXCLUDED.bio,
                    region = EXCLUDED.region,
                    social_media = EXCLUDED.social_media,
                    avatar = EXCLUDED.avatar,
                    show_registrations = EXCLUDED.show_registrations,
                    accept_meetings = EXCLUDED.accept_meetings,
                    meeting_allow_cancel = EXCLUDED.meeting_allow_cancel,
                    meeting_notice = EXCLUDED.meeting_notice,
                    exhibitor_expires_at = EXCLUDED.exhibitor_expires_at,
                    seen_hints = EXCLUDED.seen_hints,
                    last_login_region = EXCLUDED.last_login_region,
                    email_verified = EXCLUDED.email_verified,
                    email_verified_at = EXCLUDED.email_verified_at,
                    registration_time = EXCLUDED.registration_time,
                    updated_at = now()
            `,
        [
          item.id,
          item.username,
          passwordHash,
          item.email,
          item.nickname,
          item.role,
          item.status,
          item.bio,
          item.region,
          item.socialMedia,
          item.avatar,
          item.showRegistrations,
          item.acceptMeetings,
          item.meetingAllowCancel,
          item.meetingNotice,
          item.expiresInDays,
          item.seenHints,
          item.lastLoginRegion,
          item.registerDaysAgo,
        ],
      );
    }
    console.log(`示例账号就绪（${accounts.length} 个，含第二个展商、受限、封禁与已到期展商）`);

    // 示例展会的日期**相对今天**生成：写死日期的示例数据过一阵就会全部过期，
    // 报名窗口规则一上线，演示里就再也报不上名了。偏移量以天为单位。
    //
    // 覆盖范围：五种报名方式（需审核 / 无需审核 / 仅展示 / 截止报名 / 已结束）、
    // 单日与多天、时间为空、报名窗口进行中 / 未开始 / 已截止 / 不设窗口、
    // 两种主办人（管理员与第二个展商）、带与不带报名注意事项、二维码开关、
    // 有收集项与没有收集项的展会。exh-1 是最早的一场（日历落点），不要往前插展会。
    const standardFields: SeedField[] = [
      { title: '姓名 / 公司名称', type: 'text', required: true, options: [] },
      { title: '参观身份', type: 'radio', required: true, options: ['专业观众', '采购负责人', '媒体'] },
      {
        title: '报名需求',
        type: 'checkbox',
        required: false,
        options: ['希望安排展商洽谈', '需要停车位', '需要翻译服务'],
      },
    ];
    const exhibitions: SeedExhibition[] = [
      {
        id: 'exh-1',
        title: '华南智能家居展',
        venue: '深圳会展中心 3 号馆',
        time: '09:00-17:30',
        dayOffset: 7,
        endOffset: null,
        status: 'optional',
        category: '智能家居',
        description: '# 展会亮点\n\n- 智能门锁与全屋方案\n- 节能家电现场体验',
        exhibitorId: 'usr-2',
        exhibitorNote: '面向渠道商与终端用户',
        registrationNotice: '',
        registerFrom: -14,
        registerTo: 3,
        qrEnabled: true,
        allowCancel: true,
        fields: standardFields,
      },
      {
        id: 'exh-2',
        title: '大湾区物流技术展',
        venue: '广州琶洲展馆 C 区',
        time: '10:00-18:00',
        dayOffset: 14,
        endOffset: null,
        status: 'review',
        category: '物流技术',
        description: 'AGV、仓储机器人与冷链物流方案。',
        exhibitorId: 'usr-2',
        exhibitorNote: '面向制造业与物流企业',
        registrationNotice: '',
        registerFrom: -7,
        registerTo: 10,
        qrEnabled: false,
        allowCancel: true,
        fields: standardFields,
      },
      {
        id: 'exh-3',
        title: '数字健康峰会',
        venue: '上海国家会展中心',
        time: '09:30-16:00',
        dayOffset: 21,
        endOffset: null,
        status: 'closed',
        category: '医疗健康',
        description: '医疗 AI、远程诊疗和穿戴设备专题。',
        exhibitorId: 'usr-2',
        exhibitorNote: '面向医疗机构与设备厂商',
        registrationNotice: '',
        registerFrom: -30,
        registerTo: -1,
        qrEnabled: false,
        allowCancel: true,
        fields: standardFields,
      },
      {
        id: 'exh-4',
        title: '国际新材料展',
        venue: '北京国家会议中心',
        time: '09:00-17:00',
        dayOffset: 45,
        endOffset: null,
        status: 'display',
        category: '新材料',
        description: '碳纤维、石墨烯和可降解材料展示。',
        exhibitorId: 'usr-2',
        exhibitorNote: '面向研发与采购',
        registrationNotice: '',
        registerFrom: null,
        registerTo: null,
        qrEnabled: false,
        allowCancel: true,
        fields: standardFields,
      },
      {
        // 管理员主办、多天、带报名注意事项与齐全的收集项；报名窗口进行中。
        id: 'exh-5',
        title: '国际智慧城市与物联网博览会',
        venue: '杭州国际博览中心 1 号馆',
        time: '09:00-18:00',
        dayOffset: 60,
        endOffset: 62,
        status: 'review',
        category: '智能家居',
        description: '# 展会亮点\n\n- 城市级物联网平台与数字孪生\n- 智能安防与楼宇方案现场演示',
        exhibitorId: 'usr-1',
        exhibitorNote: '管理员主办的跨天展会，面向政企客户与系统集成商',
        registrationNotice: '请携带身份证件从 A 口入场\n审核通过后可在「我的活动」里查看报名码',
        registerFrom: -10,
        registerTo: 30,
        qrEnabled: true,
        allowCancel: true,
        fields: [
          { title: '姓名 / 公司名称', type: 'text', required: true, options: [] },
          {
            title: '参观身份',
            type: 'radio',
            required: true,
            options: ['专业观众', '采购负责人', '媒体', '展商代表'],
          },
          {
            title: '报名需求',
            type: 'checkbox',
            required: false,
            options: ['希望安排展商洽谈', '需要停车位', '需要翻译服务', '需要住宿协助'],
          },
          { title: '公司规模', type: 'radio', required: false, options: ['1-50 人', '51-200 人', '200 人以上'] },
        ],
      },
      {
        // 第二个展商主办、多天、关闭二维码与撤销；报名窗口进行中。
        id: 'exh-6',
        title: '跨境供应链与仓储自动化展',
        venue: '苏州国际博览中心 B 馆',
        time: '10:00-17:30',
        dayOffset: 70,
        endOffset: 73,
        status: 'optional',
        category: '物流技术',
        description: 'AGV、无人仓与跨境物流服务商一站式对接。',
        exhibitorId: 'usr-5',
        exhibitorNote: '面向物流企业与跨境电商卖家',
        registrationNotice: '报名后请按参加时间段到馆，现场签到入场',
        registerFrom: -5,
        registerTo: 40,
        qrEnabled: false,
        allowCancel: false,
        fields: [
          { title: '姓名 / 公司名称', type: 'text', required: true, options: [] },
          { title: '参观身份', type: 'radio', required: true, options: ['专业观众', '采购负责人', '媒体'] },
        ],
      },
      {
        // 单日、**时间为空**（活动时间待定）、报名窗口还没开始、没有收集项。
        id: 'exh-7',
        title: '长三角医疗器械创新论坛',
        venue: '上海世博展览馆 2 号馆',
        time: '',
        dayOffset: 80,
        endOffset: null,
        status: 'optional',
        category: '医疗健康',
        description: '创新器械、影像设备与临床转化专题，活动时间待定。',
        exhibitorId: 'usr-5',
        exhibitorNote: '',
        registrationNotice: '',
        registerFrom: 20,
        registerTo: 40,
        qrEnabled: true,
        allowCancel: true,
        fields: [],
      },
      {
        // 需审核 + 报名窗口已截止：列表上会叠加「已截止」，报名入口关闭。
        id: 'exh-8',
        title: '先进复合材料应用展',
        venue: '北京国家会议中心 E 区',
        time: '09:30-16:30',
        dayOffset: 85,
        endOffset: null,
        status: 'review',
        category: '新材料',
        description: '碳纤维、陶瓷基与可回收复合材料应用案例。',
        exhibitorId: 'usr-2',
        exhibitorNote: '面向研发、采购与投资机构',
        registrationNotice: '',
        registerFrom: -30,
        registerTo: -5,
        qrEnabled: false,
        allowCancel: true,
        fields: [
          { title: '姓名 / 公司名称', type: 'text', required: true, options: [] },
          { title: '参观身份', type: 'radio', required: true, options: ['专业观众', '采购负责人', '媒体'] },
          { title: '采购意向', type: 'checkbox', required: false, options: ['寻找供应商', '了解新品', '商务洽谈'] },
        ],
      },
      {
        // 不设报名窗口（起止都为空）+ 没有收集项。
        id: 'exh-9',
        title: '华南智能办公空间展',
        venue: '广州保利世贸博览馆',
        time: '10:00-16:00',
        dayOffset: 90,
        endOffset: null,
        status: 'optional',
        category: '智能家居',
        description: '智能办公家具、会议系统与空间管理方案。',
        exhibitorId: 'usr-2',
        exhibitorNote: '',
        registrationNotice: '',
        registerFrom: null,
        registerTo: null,
        qrEnabled: false,
        allowCancel: true,
        fields: [],
      },
      {
        // 今天结束的展会：用来展示「已结束」状态与已参加的报名记录。
        id: 'exh-10',
        title: '智慧医疗与康复设备展',
        venue: '成都世纪城新国际会展中心',
        time: '09:00-17:00',
        dayOffset: 0,
        endOffset: null,
        status: 'ended',
        category: '医疗健康',
        description: '今天结束的示例展会：用来展示「已结束」状态与已参加的报名记录。',
        exhibitorId: 'usr-2',
        exhibitorNote: '面向医院、康复机构与经销渠道',
        registrationNotice: '',
        registerFrom: null,
        registerTo: null,
        qrEnabled: false,
        allowCancel: true,
        fields: [],
      },
      {
        // 管理员主办的「仅展示」展会：不开放报名。
        id: 'exh-11',
        title: '国际绿色建筑与节能技术展',
        venue: '南京国际博览中心 3 号馆',
        time: '09:00-17:00',
        dayOffset: 95,
        endOffset: null,
        status: 'display',
        category: '新材料',
        description: '绿色建材、光伏建筑一体化与低碳园区案例展示。',
        exhibitorId: 'usr-1',
        exhibitorNote: '仅展示，不开放报名',
        registrationNotice: '',
        registerFrom: null,
        registerTo: null,
        qrEnabled: false,
        allowCancel: true,
        fields: [],
      },
    ];
    for (const item of exhibitions) {
      await client.query(
        `
                INSERT INTO exhibitions (id, title, venue, time, exhibition_date, exhibition_end_date,
                    status, category, description, description_format, exhibitor_note, registration_notice,
                    registration_start, registration_end, qr_enabled, allow_cancel, exhibitor_id)
                VALUES ($1, $2, $3, $4, CURRENT_DATE + $5::int,
                    CASE WHEN $6::int IS NULL THEN NULL ELSE CURRENT_DATE + $6::int END,
                    $7, $8, $9, 'md', $10, $11,
                    CASE WHEN $12::int IS NULL THEN NULL ELSE CURRENT_DATE + $12::int END,
                    CASE WHEN $13::int IS NULL THEN NULL ELSE CURRENT_DATE + $13::int END,
                    $14, $15, $16)
                ON CONFLICT (id) DO UPDATE SET
                    title = EXCLUDED.title, venue = EXCLUDED.venue, time = EXCLUDED.time,
                    exhibition_date = EXCLUDED.exhibition_date,
                    exhibition_end_date = EXCLUDED.exhibition_end_date,
                    status = EXCLUDED.status, category = EXCLUDED.category,
                    description = EXCLUDED.description, description_format = EXCLUDED.description_format,
                    exhibitor_note = EXCLUDED.exhibitor_note,
                    registration_notice = EXCLUDED.registration_notice,
                    registration_start = EXCLUDED.registration_start,
                    registration_end = EXCLUDED.registration_end,
                    qr_enabled = EXCLUDED.qr_enabled, allow_cancel = EXCLUDED.allow_cancel,
                    exhibitor_id = EXCLUDED.exhibitor_id,
                    updated_at = now()
            `,
        [
          item.id,
          item.title,
          item.venue,
          item.time,
          item.dayOffset,
          item.endOffset,
          item.status,
          item.category,
          item.description,
          item.exhibitorNote,
          item.registrationNotice,
          item.registerFrom,
          item.registerTo,
          item.qrEnabled,
          item.allowCancel,
          item.exhibitorId,
        ],
      );
    }
    console.log(`示例展会就绪（${exhibitions.length} 场，日期相对今天生成）`);

    // 示例展会的报名收集项：**只写在这里**，是给演示用的数据。
    // 展会本身没有「默认收集项」这回事 —— 展商新建展会时没填收集项，报名页就是空的。
    // 按存在性跳过：重复执行不会重复插入，也不会覆盖演示中改过的收集项。
    let fieldCount = 0;
    for (const exhibition of exhibitions) {
      if (exhibition.fields.length === 0) {
        continue;
      }
      const existing = await client.query<{ total: number }>(
        'SELECT count(*)::int AS total FROM exhibition_fields WHERE exhibition_id = $1',
        [exhibition.id],
      );
      if ((existing.rows[0]?.total ?? 0) > 0) {
        continue;
      }
      for (const [index, field] of exhibition.fields.entries()) {
        await client.query(
          `
                    INSERT INTO exhibition_fields (id, exhibition_id, title, type, required, options, position)
                    VALUES ($1, $2, $3, $4, $5, $6, $7)
                `,
          [
            `field-${exhibition.id}-${index + 1}`,
            exhibition.id,
            field.title,
            field.type,
            field.required,
            JSON.stringify(field.options),
            index,
          ],
        );
        fieldCount += 1;
      }
    }
    console.log(`示例报名收集项就绪（本次补 ${fieldCount} 项）`);

    // 报名：覆盖待审核 / 已通过 / 已拒绝 / 已撤销 / 已参加五种状态；
    // 多天展会的报名带参加时间段（attendance_start / attendance_end），
    // 已参加的带核销时间（check_in_time）。管理员本人也有一条报名（exh-10）。
    const registrations: SeedRegistration[] = [
      {
        id: 'reg-1',
        exhibitionId: 'exh-1',
        visitorId: 'usr-3',
        visitorName: '张伟',
        visitorType: '专业观众',
        answers: '姓名 / 公司名称：张伟\n参观身份：专业观众\n报名需求：希望安排展商洽谈',
        status: 'approved',
        attendanceStart: null,
        attendanceEnd: null,
        checkInHoursAgo: null,
      },
      {
        id: 'reg-2',
        exhibitionId: 'exh-1',
        visitorId: 'usr-2',
        visitorName: '李娜',
        visitorType: '采购负责人',
        answers: '姓名 / 公司名称：李娜\n参观身份：采购负责人',
        status: 'approved',
        attendanceStart: null,
        attendanceEnd: null,
        checkInHoursAgo: null,
      },
      {
        id: 'reg-3',
        exhibitionId: 'exh-2',
        visitorId: 'usr-3',
        visitorName: '王磊',
        visitorType: '专业观众',
        answers: '姓名 / 公司名称：王磊',
        status: 'pending',
        attendanceStart: null,
        attendanceEnd: null,
        checkInHoursAgo: null,
      },
      {
        // 管理员主办的 exh-5：待审核，带参加时间段。
        id: 'reg-4',
        exhibitionId: 'exh-5',
        visitorId: 'usr-5',
        visitorName: '方启明',
        visitorType: '专业观众',
        answers:
          '姓名 / 公司名称：方启明\n参观身份：专业观众\n报名需求：希望安排展商洽谈、需要停车位\n公司规模：51-200 人',
        status: 'pending',
        attendanceStart: 61,
        attendanceEnd: 62,
        checkInHoursAgo: null,
      },
      {
        // 已通过 + 启用二维码：详情页能看到报名码。
        id: 'reg-5',
        exhibitionId: 'exh-5',
        visitorId: 'usr-6',
        visitorName: '陈嘉禾',
        visitorType: '采购负责人',
        answers: '姓名 / 公司名称：陈嘉禾\n参观身份：采购负责人\n报名需求：需要翻译服务\n公司规模：200 人以上',
        status: 'approved',
        attendanceStart: 60,
        attendanceEnd: 61,
        checkInHoursAgo: null,
      },
      {
        id: 'reg-6',
        exhibitionId: 'exh-5',
        visitorId: 'usr-7',
        visitorName: '高远',
        visitorType: '媒体',
        answers: '姓名 / 公司名称：高远\n参观身份：媒体\n报名需求：未填写\n公司规模：1-50 人',
        status: 'rejected',
        attendanceStart: null,
        attendanceEnd: null,
        checkInHoursAgo: null,
      },
      {
        id: 'reg-7',
        exhibitionId: 'exh-5',
        visitorId: 'usr-8',
        visitorName: '秦岚',
        visitorType: '专业观众',
        answers: '姓名 / 公司名称：秦岚\n参观身份：专业观众\n报名需求：需要停车位\n公司规模：1-50 人',
        status: 'cancelled',
        attendanceStart: null,
        attendanceEnd: null,
        checkInHoursAgo: null,
      },
      {
        // 管理员本人的报名：exh-10 今天结束，状态是已参加并带核销时间。
        id: 'reg-8',
        exhibitionId: 'exh-10',
        visitorId: 'usr-1',
        visitorName: 'demo',
        visitorType: '管理员',
        answers: '',
        status: 'attended',
        attendanceStart: null,
        attendanceEnd: null,
        checkInHoursAgo: 3,
      },
      {
        id: 'reg-9',
        exhibitionId: 'exh-10',
        visitorId: 'usr-5',
        visitorName: '方启明',
        visitorType: '专业观众',
        answers: '',
        status: 'attended',
        attendanceStart: null,
        attendanceEnd: null,
        checkInHoursAgo: 2,
      },
      {
        // 第二个展商主办的 exh-6：已通过，多天展会选了参加时间段。
        id: 'reg-10',
        exhibitionId: 'exh-6',
        visitorId: 'usr-8',
        visitorName: '秦岚',
        visitorType: '采购负责人',
        answers: '姓名 / 公司名称：秦岚\n参观身份：采购负责人',
        status: 'approved',
        attendanceStart: 71,
        attendanceEnd: 72,
        checkInHoursAgo: null,
      },
      {
        id: 'reg-11',
        exhibitionId: 'exh-6',
        visitorId: 'usr-7',
        visitorName: '高远',
        visitorType: '专业观众',
        answers: '姓名 / 公司名称：高远\n参观身份：专业观众',
        status: 'pending',
        attendanceStart: 72,
        attendanceEnd: 73,
        checkInHoursAgo: null,
      },
      {
        // 不设报名窗口的 exh-9：没有收集项，答案为空。
        id: 'reg-12',
        exhibitionId: 'exh-9',
        visitorId: 'usr-5',
        visitorName: '方启明',
        visitorType: '专业观众',
        answers: '',
        status: 'pending',
        attendanceStart: null,
        attendanceEnd: null,
        checkInHoursAgo: null,
      },
      {
        id: 'reg-13',
        exhibitionId: 'exh-8',
        visitorId: 'usr-8',
        visitorName: '秦岚',
        visitorType: '采购负责人',
        answers: '姓名 / 公司名称：秦岚\n参观身份：采购负责人\n采购意向：寻找供应商、商务洽谈',
        status: 'pending',
        attendanceStart: null,
        attendanceEnd: null,
        checkInHoursAgo: null,
      },
    ];
    for (const item of registrations) {
      // 示例报名和真实报名一样带核销凭据（建记录时就生成）。
      // 已有凭据的行保留原值：重复 seed 不会把演示用的二维码换掉。
      const secret = labels.newCheckInSecret();
      await client.query(
        `
                INSERT INTO registrations (id, exhibition_id, visitor_id, visitor_name, visitor_type,
                    answers, status, attendance_start, attendance_end, check_in_time, check_in_secret)
                VALUES ($1, $2, $3, $4, $5, $6, $7,
                    CASE WHEN $8::int IS NULL THEN NULL ELSE CURRENT_DATE + $8::int END,
                    CASE WHEN $9::int IS NULL THEN NULL ELSE CURRENT_DATE + $9::int END,
                    CASE WHEN $10::int IS NULL THEN NULL ELSE now() - make_interval(hours => $10::int) END,
                    $11)
                ON CONFLICT (id) DO UPDATE SET
                    visitor_name = EXCLUDED.visitor_name,
                    visitor_type = EXCLUDED.visitor_type,
                    answers = EXCLUDED.answers,
                    status = EXCLUDED.status,
                    attendance_start = EXCLUDED.attendance_start,
                    attendance_end = EXCLUDED.attendance_end,
                    check_in_time = EXCLUDED.check_in_time,
                    check_in_secret = CASE
                        WHEN registrations.check_in_secret = '' THEN EXCLUDED.check_in_secret
                        ELSE registrations.check_in_secret
                    END,
                    updated_at = now()
            `,
        [
          item.id,
          item.exhibitionId,
          item.visitorId,
          item.visitorName,
          item.visitorType,
          item.answers,
          item.status,
          item.attendanceStart,
          item.attendanceEnd,
          item.checkInHoursAgo,
          secret,
        ],
      );
    }
    console.log(`示例报名就绪（${registrations.length} 条）`);

    // 私人会议：四种状态都有，日期都在今天之后。全部挂在第二个展商名下，
    // 管理员与 exhibitor 的收件箱保持为空（契约测试依赖这个初始状态）。
    const meetings: SeedMeeting[] = [
      {
        id: 'meet-1',
        exhibitorId: 'usr-5',
        visitorId: 'usr-3',
        visitorName: 'user',
        dayOffset: 3,
        time: '10:30',
        answers: '来意：想了解贵司的展会合作方式\n希望形式：线下面谈',
        status: 'pending',
      },
      {
        id: 'meet-2',
        exhibitorId: 'usr-5',
        visitorId: 'usr-6',
        visitorName: '陈嘉禾',
        dayOffset: 5,
        time: '14:00',
        answers: '来意：采购对接\n希望形式：线上会议',
        status: 'approved',
      },
      {
        id: 'meet-3',
        exhibitorId: 'usr-5',
        visitorId: 'usr-7',
        visitorName: '高远',
        dayOffset: 6,
        time: '09:30',
        answers: '来意：媒体采访安排\n希望形式：线下面谈',
        status: 'rejected',
      },
      {
        id: 'meet-4',
        exhibitorId: 'usr-5',
        visitorId: 'usr-8',
        visitorName: '秦岚',
        dayOffset: 7,
        time: '',
        answers: '来意：展位合作沟通\n希望形式：线上会议',
        status: 'cancelled',
      },
    ];
    for (const item of meetings) {
      const existing = await client.query('SELECT id FROM private_meetings WHERE id = $1', [item.id]);
      if (existing.rowCount) {
        // 固定 id 已存在：日期跟着种子重新算，状态回到期望值。
        await client.query(
          `
                    UPDATE private_meetings
                       SET visitor_id = $2, visitor_name = $3, meeting_date = CURRENT_DATE + $4::int,
                           meeting_time = $5, answers = $6, status = $7, updated_at = now()
                     WHERE id = $1
                `,
          [item.id, item.visitorId, item.visitorName, item.dayOffset, item.time, item.answers, item.status],
        );
        continue;
      }
      // 同一访客对同一主办人同一天只能有一条待审核 / 已通过的申请（库里是唯一索引）。
      // 演示时可能已经约过一次，这种现场数据不去撞它，直接跳过。
      const conflicting = await client.query<{ total: number }>(
        `SELECT count(*)::int AS total
           FROM private_meetings
          WHERE exhibitor_id = $1 AND visitor_id = $2
            AND meeting_date = CURRENT_DATE + $3::int AND status IN ('pending', 'approved')`,
        [item.exhibitorId, item.visitorId, item.dayOffset],
      );
      if ((conflicting.rows[0]?.total ?? 0) > 0) {
        continue;
      }
      await client.query(
        `
                INSERT INTO private_meetings
                    (id, exhibitor_id, visitor_id, visitor_name, meeting_date, meeting_time, answers, status)
                VALUES ($1, $2, $3, $4, CURRENT_DATE + $5::int, $6, $7, $8)
            `,
        [
          item.id,
          item.exhibitorId,
          item.visitorId,
          item.visitorName,
          item.dayOffset,
          item.time,
          item.answers,
          item.status,
        ],
      );
    }
    console.log(`示例私人会议就绪（${meetings.length} 个）`);

    // 第二个展商的会议收集项：申请页按这里的顺序渲染；按存在性跳过，不覆盖演示中的改动。
    const meetingFields: SeedField[] = [
      { title: '来意', type: 'text', required: true, options: [] },
      { title: '希望形式', type: 'radio', required: true, options: ['线下面谈', '线上会议'] },
    ];
    const meetingFieldExisting = await client.query<{ total: number }>(
      'SELECT count(*)::int AS total FROM meeting_fields WHERE exhibitor_id = $1',
      ['usr-5'],
    );
    if ((meetingFieldExisting.rows[0]?.total ?? 0) === 0) {
      for (const [index, field] of meetingFields.entries()) {
        await client.query(
          `
                    INSERT INTO meeting_fields (id, exhibitor_id, title, type, required, options, position)
                    VALUES ($1, $2, $3, $4, $5, $6, $7)
                `,
          [
            `mfield-usr-5-${index + 1}`,
            'usr-5',
            field.title,
            field.type,
            field.required,
            JSON.stringify(field.options),
            index,
          ],
        );
      }
    }
    console.log('示例会议收集项就绪');

    // 邀请码：固定 code 便于演示；重复执行时把次数与有效期恢复成期望值。
    const invites: SeedInvite[] = [
      { id: 'inv-demo', code: 'DEMOEXPO', maxUses: 10, durationDays: 0, validDays: null },
      { id: 'inv-demo-trial', code: 'TRIAL30', maxUses: 5, durationDays: 30, validDays: 30 },
    ];
    for (const item of invites) {
      await client.query(
        `
                INSERT INTO exhibitor_invites (id, code, max_uses, used_count, duration_days, expires_at, created_by)
                VALUES ($1, $2, $3, 0, $4,
                    CASE WHEN $5::int IS NULL THEN NULL ELSE now() + make_interval(days => $5::int) END, 'usr-1')
                ON CONFLICT (id) DO UPDATE SET
                    code = EXCLUDED.code,
                    max_uses = EXCLUDED.max_uses,
                    used_count = 0,
                    duration_days = EXCLUDED.duration_days,
                    expires_at = EXCLUDED.expires_at,
                    revoked_at = NULL,
                    created_by = EXCLUDED.created_by
            `,
        [item.id, item.code, item.maxUses, item.durationDays, item.validDays],
      );
    }
    console.log(`示例邀请码就绪（${invites.length} 枚，code 固定）`);

    // 通知偏好：给演示账号各存一份，个人页打开就是配置过的样子。
    const notificationPreferences: { userId: string; exhibitionReminder: boolean; registrationUpdates: boolean }[] = [
      { userId: 'usr-5', exhibitionReminder: true, registrationUpdates: true },
      { userId: 'usr-6', exhibitionReminder: false, registrationUpdates: true },
      { userId: 'usr-7', exhibitionReminder: false, registrationUpdates: false },
    ];
    for (const item of notificationPreferences) {
      await client.query(
        `
                INSERT INTO notification_preferences (user_id, exhibition_reminder, registration_updates, updated_at)
                VALUES ($1, $2, $3, now())
                ON CONFLICT (user_id) DO UPDATE SET
                    exhibition_reminder = EXCLUDED.exhibition_reminder,
                    registration_updates = EXCLUDED.registration_updates,
                    updated_at = now()
            `,
        [item.userId, item.exhibitionReminder, item.registrationUpdates],
      );
    }
    console.log('示例通知偏好就绪');

    for (const [key, value] of Object.entries(DEFAULT_SETTINGS)) {
      await client.query(
        `
                INSERT INTO app_settings (key, value) VALUES ($1, $2)
                ON CONFLICT (key) DO NOTHING
            `,
        [key, JSON.stringify(value)],
      );
    }
    console.log('服务器设置默认值就绪');

    await client.query('COMMIT');
    console.log('示例数据插入完成');
  } catch (error: unknown) {
    await client.query('ROLLBACK');
    console.error('示例数据插入失败：', errorMessage(error));
    throw error;
  } finally {
    client.release();
  }
}
