/**
 * 日历 ICS 的组装规则：UTC DTSTAMP、稳定 UID、全天 / 多天 / 时段的 DTSTART / DTEND、
 * 文本转义与 75 字节折行，以及「先分享、分享不可用再下载」的结果映射。
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { addExhibitionToCalendar, buildExhibitionIcs, type CalendarEventInput } from './calendar-ics';
import { downloadBlob, shareFile } from './browser-device';

vi.mock('./browser-device', () => ({
  downloadBlob: vi.fn(),
  shareFile: vi.fn(),
}));

const NOW = new Date('2026-11-18T11:08:27.123Z');

const BASE: CalendarEventInput = {
  title: '秋季展会',
  date: '2026-11-17',
  venue: '会展中心',
  id: 'exh-1',
};

/** 把折行拼回去：RFC 5545 的续行是 CRLF + 一个空格。 */
function unfold(ics: string): string[] {
  return ics
    .replace(/\r\n[ \t]/g, '')
    .split('\r\n')
    .filter(Boolean);
}

function line(ics: string, prefix: string): string | undefined {
  return unfold(ics).find((item) => item.startsWith(prefix));
}

/** 按 UTF-8 字节数校验折行（71 个中文标题字符 = 213 字节，必须被折开）。 */
function utf8Bytes(text: string): number {
  return new TextEncoder().encode(text).length;
}

describe('buildExhibitionIcs', () => {
  it('多天全天事件用 VALUE=DATE，DTEND 是闭展次日且不带时区块', () => {
    const ics = buildExhibitionIcs({ ...BASE, endDate: '2026-11-22' }, NOW);
    expect(line(ics, 'DTSTART;VALUE=DATE:')).toBe('DTSTART;VALUE=DATE:20261117');
    expect(line(ics, 'DTEND;VALUE=DATE:')).toBe('DTEND;VALUE=DATE:20261123');
    expect(ics).not.toContain('BEGIN:VTIMEZONE');
    expect(ics.startsWith('BEGIN:VCALENDAR\r\n')).toBe(true);
    expect(ics.endsWith('\r\n')).toBe(true);
  });

  it('没有 endDate 时按单日事件写，DTEND 仍是次日', () => {
    const ics = buildExhibitionIcs(BASE, NOW);
    expect(line(ics, 'DTSTART;VALUE=DATE:')).toBe('DTSTART;VALUE=DATE:20261117');
    expect(line(ics, 'DTEND;VALUE=DATE:')).toBe('DTEND;VALUE=DATE:20261118');
  });

  it('有 09:00-17:30 时段时按 Asia/Shanghai 写本地时间并附 VTIMEZONE', () => {
    const ics = buildExhibitionIcs({ ...BASE, time: '09:00-17:30' }, NOW);
    expect(line(ics, 'DTSTART;TZID=Asia/Shanghai:')).toBe('DTSTART;TZID=Asia/Shanghai:20261117T090000');
    expect(line(ics, 'DTEND;TZID=Asia/Shanghai:')).toBe('DTEND;TZID=Asia/Shanghai:20261117T173000');
    expect(ics).toContain('BEGIN:VTIMEZONE');
    expect(ics).toContain('TZID:Asia/Shanghai');
    expect(ics).toContain('TZOFFSETFROM:+0800');
    expect(ics).toContain('TZOFFSETTO:+0800');
  });

  it('只有开始时间时默认一小时', () => {
    const ics = buildExhibitionIcs({ ...BASE, time: '09:00' }, NOW);
    expect(line(ics, 'DTSTART;TZID=Asia/Shanghai:')).toBe('DTSTART;TZID=Asia/Shanghai:20261117T090000');
    expect(line(ics, 'DTEND;TZID=Asia/Shanghai:')).toBe('DTEND;TZID=Asia/Shanghai:20261117T100000');
  });

  it('多天 + 时段从开始日写到闭展日', () => {
    const ics = buildExhibitionIcs({ ...BASE, endDate: '2026-11-22', time: '09:00-17:30' }, NOW);
    expect(line(ics, 'DTSTART;TZID=Asia/Shanghai:')).toBe('DTSTART;TZID=Asia/Shanghai:20261117T090000');
    expect(line(ics, 'DTEND;TZID=Asia/Shanghai:')).toBe('DTEND;TZID=Asia/Shanghai:20261122T173000');
  });

  it('时间解析不出来时当全天处理，不猜时间', () => {
    for (const time of ['全天', '', '9 点到 17 点', '25:00-26:00']) {
      const ics = buildExhibitionIcs({ ...BASE, time }, NOW);
      expect(line(ics, 'DTSTART;VALUE=DATE:')).toBe('DTSTART;VALUE=DATE:20261117');
      expect(ics).not.toContain('BEGIN:VTIMEZONE');
    }
  });

  it('文本值转义逗号、分号、反斜杠与换行', () => {
    const ics = buildExhibitionIcs(
      {
        ...BASE,
        title: '秋季,展会;特别\\版',
        venue: '会展中心, 3 号馆; 东门',
        description: '第一行\n第二行',
      },
      NOW,
    );
    expect(line(ics, 'SUMMARY:')).toBe('SUMMARY:秋季\\,展会\\;特别\\\\版');
    expect(line(ics, 'LOCATION:')).toBe('LOCATION:会展中心\\, 3 号馆\\; 东门');
    // 换行在 ICS 里只能是字面量 \n，不能真的换行把属性值截断。
    expect(line(ics, 'DESCRIPTION:')).toBe('DESCRIPTION:第一行\\n第二行');
  });

  it('DTSTAMP 是 UTC，now 固定时得到确定值', () => {
    expect(line(buildExhibitionIcs(BASE, NOW), 'DTSTAMP:')).toBe('DTSTAMP:20261118T110827Z');
    expect(line(buildExhibitionIcs(BASE), 'DTSTAMP:')).toMatch(/^DTSTAMP:\d{8}T\d{6}Z$/);
  });

  it('UID 稳定：同一场展会两次导出相同，有 id 用 id，没有用标题 + 日期', () => {
    const first = line(buildExhibitionIcs(BASE, new Date('2020-01-01T00:00:00Z')), 'UID:');
    const second = line(buildExhibitionIcs(BASE, new Date('2030-12-31T23:59:59Z')), 'UID:');
    expect(first).toBe(second);
    expect(first).toContain('exh-1');

    const noId = line(buildExhibitionIcs({ ...BASE, id: undefined }, NOW), 'UID:');
    expect(noId).not.toContain('exh-1');
    expect(noId).toContain('2026-11-17');
    expect(noId).toBe(line(buildExhibitionIcs({ ...BASE, id: undefined }, NOW), 'UID:'));
  });

  it('长行按 75 字节折行，续行以空格开头且内容没有被切断', () => {
    const title = '很长的展会名称'.repeat(20);
    const ics = buildExhibitionIcs({ ...BASE, title }, NOW);
    const physical = ics.split('\r\n').filter(Boolean);
    for (const item of physical) expect(utf8Bytes(item)).toBeLessThanOrEqual(75);
    expect(physical.some((item) => item.startsWith(' '))).toBe(true);
    // 拼回去以后标题一个字符都不少。
    expect(line(ics, 'SUMMARY:')).toBe(`SUMMARY:${title}`);
  });

  it('日期缺失或不存在时直接失败，不猜月份', () => {
    expect(() => buildExhibitionIcs({ ...BASE, date: '' })).toThrow();
    expect(() => buildExhibitionIcs({ ...BASE, date: '2026-02-30' })).toThrow();
  });
});

describe('addExhibitionToCalendar', () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it('分享成功返回 shared，不触发下载', async () => {
    vi.mocked(shareFile).mockResolvedValue('shared');
    await expect(addExhibitionToCalendar(BASE)).resolves.toBe('shared');

    const call = vi.mocked(shareFile).mock.calls[0]!;
    const file = call[0];
    expect(file.type).toContain('text/calendar');
    expect(file.name.endsWith('.ics')).toBe(true);
    expect(await file.text()).toContain('BEGIN:VEVENT');
    expect(downloadBlob).not.toHaveBeenCalled();
  });

  it('分享不可用时退回下载并返回 downloaded', async () => {
    vi.mocked(shareFile).mockResolvedValue('unsupported');
    await expect(addExhibitionToCalendar(BASE)).resolves.toBe('downloaded');

    const call = vi.mocked(downloadBlob).mock.calls[0]!;
    expect(call[0]).toBeInstanceOf(Blob);
    expect(call[0].type).toContain('text/calendar');
    expect(call[1]).toMatch(/\.ics$/);
  });

  it('用户取消原样返回 cancelled，不触发下载', async () => {
    vi.mocked(shareFile).mockResolvedValue('cancelled');
    await expect(addExhibitionToCalendar(BASE)).resolves.toBe('cancelled');
    expect(downloadBlob).not.toHaveBeenCalled();
  });

  it('分享抛错时向上失败，不偷偷退回下载', async () => {
    vi.mocked(shareFile).mockRejectedValue(new Error('share failed'));
    await expect(addExhibitionToCalendar(BASE)).rejects.toThrow('share failed');
    expect(downloadBlob).not.toHaveBeenCalled();
  });
});
