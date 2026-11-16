import assert from 'node:assert/strict';
import { checkInCode, checkinCodePrefix, configureCheckinCodePrefix, parseCheckInCode } from './labels.js';

/**
 * 报名码前缀按实例配置：默认沿用历史值，换过前缀的实例要能生成新码、同时还能核销旧码。
 *
 * 这些用例只碰模块内的前缀状态，不连数据库；每个用例结束都恢复默认值，
 * 避免影响同一进程里其它用例。
 */

const LEGACY = 'CALMOBILE-CHECKIN';

test.afterEach(() => {
  configureCheckinCodePrefix(LEGACY);
});

test('没配前缀时沿用历史值', () => {
  configureCheckinCodePrefix('');
  assert.equal(checkinCodePrefix(), LEGACY);
  assert.equal(checkInCode('exh-1', 'reg-1', 'abc123'), `${LEGACY}|exh-1|reg-1|abc123`);
});

test('配了合法前缀后新码用它，旧码仍然可以解析', () => {
  configureCheckinCodePrefix('CHECKIN');
  const fresh = checkInCode('exh-1', 'reg-1', 'abc123');
  assert.equal(fresh, 'CHECKIN|exh-1|reg-1|abc123');
  assert.deepEqual(parseCheckInCode(fresh), {
    exhibitionId: 'exh-1',
    registrationId: 'reg-1',
    secret: 'abc123',
  });

  // 换前缀前发出去的码不能被判成无效：解析时同时认历史前缀。
  assert.deepEqual(parseCheckInCode(`${LEGACY}|exh-2|reg-2|def456`), {
    exhibitionId: 'exh-2',
    registrationId: 'reg-2',
    secret: 'def456',
  });
});

test('前缀只认字母数字下划线横线，写错退回历史值', () => {
  configureCheckinCodePrefix('CHECK IN');
  assert.equal(checkinCodePrefix(), LEGACY);

  configureCheckinCodePrefix('CHECKIN|');
  assert.equal(checkinCodePrefix(), 'CHECKIN', '结尾竖线自动去掉，不产生两个分隔符');

  assert.equal(parseCheckInCode('随便一段文本'), null);
  assert.equal(parseCheckInCode('CHECKIN|exh-1'), null, '没有报名 id 不算报名码');
});
