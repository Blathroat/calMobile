import { afterEach, describe, expect, it } from 'vitest';
import {
  MAX_CHECKIN_OUTCOMES,
  checkinOutcomesKey,
  persistCheckinOutcomes,
  readCheckinOutcomes,
} from './checkin-outcomes';

afterEach(() => localStorage.clear());

describe('核销结果本机存储', () => {
  it('按账号分键并跳过坏记录', () => {
    expect(checkinOutcomesKey('exhibitor-1')).toBe('calmobile.checkin.outcomes.exhibitor-1');
    expect(checkinOutcomesKey(undefined)).toBe('calmobile.checkin.outcomes.anonymous');
    localStorage.setItem(
      checkinOutcomesKey('exhibitor-1'),
      JSON.stringify([null, { id: 'bad', record: '无效' }, { id: 'valid', record: { recordId: 'reg-1' } }]),
    );

    expect(readCheckinOutcomes('exhibitor-1')).toEqual([
      { id: 'valid', ok: false, statusText: '', message: '', record: { recordId: 'reg-1' } },
    ]);
    expect(readCheckinOutcomes('other-user')).toEqual([]);
  });

  it('限制历史数量并在清空时删除账号对应的键', () => {
    const outcomes = Array.from({ length: MAX_CHECKIN_OUTCOMES + 5 }, (_, index) => ({
      id: String(index),
      ok: true,
      statusText: '已参加',
      message: '',
      record: { recordId: String(index) },
    }));

    persistCheckinOutcomes('exhibitor-1', outcomes);
    expect(readCheckinOutcomes('exhibitor-1')).toHaveLength(MAX_CHECKIN_OUTCOMES);

    persistCheckinOutcomes('exhibitor-1', []);
    expect(localStorage.getItem(checkinOutcomesKey('exhibitor-1'))).toBeNull();
  });
});
