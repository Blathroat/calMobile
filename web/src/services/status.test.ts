import { describe, expect, it } from 'vitest';
import {
  EXHIBITION_STATUS,
  REGISTRATION_STATUS,
  USER_STATUS,
  acceptsRegistration,
  exhibitionModeCode,
  modeLabel,
  statusTone,
} from './status';

describe('已截止报名的展示状态', () => {
  it('需审核 / 无需审核在报名截止后显示「截止报名」', () => {
    for (const statusCode of [EXHIBITION_STATUS.REVIEW_REQUIRED, EXHIBITION_STATUS.REVIEW_OPTIONAL]) {
      const mode = exhibitionModeCode({ statusCode, registrationEnded: true });
      expect(mode).toBe(EXHIBITION_STATUS.CLOSED);
      expect(modeLabel(mode)).toBe('截止报名');
      expect(statusTone(mode)).toBe('danger');
    }
  });

  it('未截止或其它报名方式保持原状态', () => {
    expect(exhibitionModeCode({ statusCode: 'review', registrationEnded: false })).toBe('review');
    expect(exhibitionModeCode({ statusCode: 'review' })).toBe('review');
    for (const statusCode of ['display', 'closed', 'ended'] as const) {
      expect(exhibitionModeCode({ statusCode, registrationEnded: true })).toBe(statusCode);
    }
  });

  it('暂停 / 恢复报名只看报名方式，不看报名截止', () => {
    expect(acceptsRegistration('review')).toBe(true);
    expect(acceptsRegistration('optional')).toBe(true);
    expect(acceptsRegistration('display')).toBe(false);
    expect(acceptsRegistration('closed')).toBe(false);
    expect(acceptsRegistration('ended')).toBe(false);
  });
});

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
    // 截止报名是终态：砖红（与「已拒绝 / 已撤销」同一档），不是琥珀。
    expect(statusTone(EXHIBITION_STATUS.CLOSED)).toBe('danger');
    expect(statusTone(EXHIBITION_STATUS.DISPLAY_ONLY)).toBe('info');
  });

  it('未知 code 仍然是灰色，不猜语义', () => {
    expect(statusTone('mystery')).toBe('muted');
    expect(statusTone(null)).toBe('muted');
  });
});
