import { describe, expect, it } from 'vitest';
import { navigation } from './navigation';

describe('navigation coordinator', () => {
  it('aborts the previous scope and marks only the latest current', () => {
    const first = navigation.begin();
    const second = navigation.begin();
    expect(first.signal.aborted).toBe(true);
    expect(first.isCurrent()).toBe(false);
    expect(second.isCurrent()).toBe(true);
  });

  it('进入更深的一页算前进，回退算后退，平级标签页算原地替换', () => {
    navigation.track({ path: '/home' }, { path: '/login', matched: [{}] });
    expect(navigation.direction.value).toBe('none');
    navigation.track({ path: '/detail/exh-1' }, { path: '/home', matched: [{}] });
    expect(navigation.direction.value).toBe('forward');
    navigation.track({ path: '/home' }, { path: '/detail/exh-1', matched: [{}] });
    expect(navigation.direction.value).toBe('back');
    navigation.track({ path: '/profile', meta: { tab: 'profile' } }, { path: '/home', meta: { tab: 'home' } });
    expect(navigation.direction.value).toBe('none');
  });

  it('冷启动的第一次跳转不做前进过渡（旧版首帧静态落地）', () => {
    // `from` 是路由的起始位置：没有匹配到任何记录，深度比较会把它算成「进入子页」。
    navigation.track({ path: '/login' }, { path: '/', matched: [] });
    expect(navigation.direction.value).toBe('none');
  });
});
