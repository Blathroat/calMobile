/**
 * 演示数据。
 *
 * 这一层是**临时**的：只为在真实后端完成前让前端能通过 HTTP 跑通，
 * 字段形状与 `WebAppActions` 的输出严格一致（见根目录 README「前后端边界」），
 * 因此前端换到 HTTP 后页面渲染结果与现在完全相同。
 *
 * 数据全部放在内存里，进程重启即回到初始状态。
 */

const ACCOUNTS = [
  { username: 'demo', password: 'password', role: 'admin', nickname: 'demo', email: 'demo@example.com' },
  { username: 'exhibitor', password: 'password', role: 'exhibitor', nickname: 'exhibitor', email: 'exhibitor@example.com' },
  { username: 'user', password: 'password', role: 'user', nickname: 'user', email: 'user@example.com' },
];

const ROLE_LABEL = { admin: '管理员', exhibitor: '展商', user: '普通用户', guest: '访客' };

/** 展会。`date` 同时给出 year/month/day，与 exhibitionPayload 一致。 */
const EXHIBITIONS = [
  {
    id: 'exh-1',
    title: '华南智能家居展',
    venue: '深圳会展中心 3 号馆',
    time: '09:00-17:30',
    date: '2026-06-08',
    category: '智能家居',
    status: '无需审核',
    description: '# 展会亮点\n\n- 智能门锁与全屋方案\n- 节能家电现场体验',
    exhibitor: '华南会展',
    exhibitorNote: '面向渠道商与终端用户',
    highlights: ['智能门锁', '全屋方案', '节能家电'],
    imageUri: '',
    registrationStart: '2026-05-01',
    registrationEnd: '2026-05-31',
    qrEnabled: true,
  },
  {
    id: 'exh-2',
    title: '大湾区物流技术展',
    venue: '广州琶洲展馆 C 区',
    time: '10:00-18:00',
    date: '2026-06-15',
    category: '物流技术',
    status: '需审核',
    description: 'AGV、仓储机器人与冷链物流方案。',
    exhibitor: '大湾区物流协会',
    exhibitorNote: '面向制造业与物流企业',
    highlights: ['AGV', '仓储机器人'],
    imageUri: '',
    registrationStart: '2026-05-10',
    registrationEnd: '2026-06-10',
    qrEnabled: false,
  },
  {
    id: 'exh-3',
    title: '数字健康峰会',
    venue: '上海国家会展中心',
    time: '09:30-16:00',
    date: '2026-06-22',
    category: '医疗健康',
    status: '截止报名',
    description: '医疗 AI、远程诊疗和穿戴设备专题。',
    exhibitor: '数字健康联盟',
    exhibitorNote: '面向医疗机构与设备厂商',
    highlights: ['医疗 AI', '穿戴设备'],
    imageUri: '',
    registrationStart: '2026-05-01',
    registrationEnd: '2026-06-01',
    qrEnabled: false,
  },
  {
    id: 'exh-4',
    title: '国际新材料展',
    venue: '北京国家会议中心',
    time: '09:00-17:00',
    date: '2026-08-10',
    category: '新材料',
    status: '仅展示',
    description: '碳纤维、石墨烯和可降解材料展示。',
    exhibitor: '新材料产业协会',
    exhibitorNote: '面向研发与采购',
    highlights: ['碳纤维', '石墨烯'],
    imageUri: '',
    registrationStart: '',
    registrationEnd: '',
    qrEnabled: false,
  },
];

/** 报名记录。`statusLabel` 是审核状态，`checkInCode` 仅在启用二维码且已通过时下发。 */
const REGISTRATIONS = [
  {
    id: 'registration-1',
    exhibitionId: 'exh-1',
    visitorName: '张伟',
    visitorType: '专业观众',
    answers: '姓名 / 公司名称：张伟\n参观身份：专业观众\n报名需求：希望安排展商洽谈',
    registrationTime: '06-08 09:15',
    statusLabel: '已通过',
  },
  {
    id: 'registration-2',
    exhibitionId: 'exh-1',
    visitorName: '李娜',
    visitorType: '采购负责人',
    answers: '姓名 / 公司名称：李娜\n参观身份：采购负责人',
    registrationTime: '06-08 10:30',
    statusLabel: '已通过',
  },
  {
    id: 'registration-3',
    exhibitionId: 'exh-2',
    visitorName: '王磊',
    visitorType: '专业观众',
    answers: '姓名 / 公司名称：王磊',
    registrationTime: '06-09 14:20',
    statusLabel: '待审核',
  },
];

const CODE_PREFIX = 'CALMOBILE-CHECKIN|';

module.exports = {
  ACCOUNTS,
  ROLE_LABEL,
  EXHIBITIONS,
  REGISTRATIONS,
  CODE_PREFIX,
};
