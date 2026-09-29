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

  it('方向按深度与标签页算出，冷启动的第一次跳转不算前进', () => {
    // 更深一层算前进，回到浅一层算后退。
    navigation.track({ path: '/detail/exh-1' }, { path: '/home', matched: [{}] });
    expect(navigation.direction.value).toBe('forward');
    navigation.track({ path: '/home' }, { path: '/detail/exh-1', matched: [{}] });
    expect(navigation.direction.value).toBe('back');
    // 同深度的换页与底部导航之间是原地替换，不做左右滑动的观感。
    navigation.track({ path: '/search' }, { path: '/home', matched: [{}] });
    expect(navigation.direction.value).toBe('none');
    navigation.track({ path: '/profile', meta: { tab: 'profile' } }, { path: '/home', meta: { tab: 'home' } });
    expect(navigation.direction.value).toBe('none');
    // 冷启动的第一次跳转：`from` 是路由的起始位置（没有匹配到任何记录），
    // 深度比较会把它算成「进入子页」，但首帧应当是静态落地的。
    navigation.track({ path: '/login' }, { path: '/', matched: [] });
    expect(navigation.direction.value).toBe('none');
  });

  it('标签页之间按底部导航顺序记左右方向，同屏只换 query 时两个信号都不动', () => {
    navigation.track({ path: '/my-registrations', meta: { tab: 'my-registrations' } }, { path: '/home', meta: { tab: 'home' } });
    expect(navigation.tabMove.value).toBe('forward');
    navigation.track({ path: '/home', meta: { tab: 'home' } }, { path: '/profile', meta: { tab: 'profile' } });
    expect(navigation.tabMove.value).toBe('back');
    // 标签页之间不做前进 / 后退，避免叠一层淡入
    expect(navigation.direction.value).toBe('none');

    // 同一屏只换 query（管理页分区）：不动任何信号，元素不重建就不会重放动画
    navigation.track({ path: '/detail/exh-1', meta: {} }, { path: '/home', meta: {} });
    expect(navigation.direction.value).toBe('forward');
    navigation.tabMove.value = 'back';
    navigation.track({ path: '/detail/exh-1', meta: {} }, { path: '/detail/exh-1', meta: {} });
    expect(navigation.direction.value).toBe('forward');
    expect(navigation.tabMove.value).toBe('back');
  });
});
