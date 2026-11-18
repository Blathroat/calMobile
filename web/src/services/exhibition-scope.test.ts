import { describe, expect, it } from 'vitest';
import { canManageExhibition, exhibitionOwnerQuery } from './exhibition-scope';

const exhibitor = { id: 'usr-2', role: 'exhibitor' };
const admin = { id: 'usr-1', role: 'admin', can: { admin: true } };

describe('exhibitionOwnerQuery', () => {
  it('展商只看自己的展会', () => {
    expect(exhibitionOwnerQuery(exhibitor)).toEqual({ exhibitorId: 'usr-2' });
  });

  it('管理员在「我的活动」也只筛选自己的活动', () => {
    expect(exhibitionOwnerQuery(admin)).toEqual({ exhibitorId: 'usr-1' });
  });

  it('没有用户 id 时返回不可能命中的筛选，不把全部展会当自己的', () => {
    expect(exhibitionOwnerQuery({ role: 'exhibitor' })).toEqual({ exhibitorId: '__none__' });
    expect(exhibitionOwnerQuery(null)).toEqual({ exhibitorId: '__none__' });
  });
});

describe('canManageExhibition', () => {
  it('展商只能管理自己的展会', () => {
    expect(canManageExhibition(exhibitor, { exhibitorId: 'usr-2' })).toBe(true);
    expect(canManageExhibition(exhibitor, { exhibitorId: 'usr-3' })).toBe(false);
  });

  it('管理员可以管理任意展会，普通用户不行', () => {
    expect(canManageExhibition(admin, { exhibitorId: 'usr-2' })).toBe(true);
    expect(canManageExhibition({ id: 'usr-3', role: 'user' }, { exhibitorId: 'usr-3' })).toBe(false);
  });

  it('没有归属的历史展会，展商不能管理', () => {
    expect(canManageExhibition(exhibitor, {})).toBe(false);
    expect(canManageExhibition(exhibitor, null)).toBe(false);
  });
});
