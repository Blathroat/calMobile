import { describe, expect, it } from 'vitest';
import { EXHIBITION_STATUS, REGISTRATION_STATUS, USER_STATUS, statusTone } from './status';

describe('状态标签色调', () => {
  it('账号状态不是灰色：正常绿、受限琥珀、封禁砖红', () => {
    expect(statusTone(USER_STATUS.NORMAL)).toBe('ok');
    expect(statusTone(USER_STATUS.RESTRICTED)).toBe('warn');
    expect(statusTone(USER_STATUS.BANNED)).toBe('danger');
  });

  it('报名与展会状态保持原来的语义色', () => {
    expect(statusTone(REGISTRATION_STATUS.APPROVED)).toBe('ok');
    expect(statusTone(REGISTRATION_STATUS.PENDING)).toBe('pending');
    expect(statusTone(REGISTRATION_STATUS.REJECTED)).toBe('danger');
    expect(statusTone(EXHIBITION_STATUS.CLOSED)).toBe('warn');
    expect(statusTone(EXHIBITION_STATUS.DISPLAY_ONLY)).toBe('info');
  });

  it('未知 code 仍然是灰色，不猜语义', () => {
    expect(statusTone('mystery')).toBe('muted');
    expect(statusTone(null)).toBe('muted');
  });
});
