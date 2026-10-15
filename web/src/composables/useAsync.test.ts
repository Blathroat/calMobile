import { afterEach, describe, expect, it, vi } from 'vitest';
import { effectScope } from 'vue';
import { navigation } from '@/app/navigation';
import { useAsync } from './useAsync';

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: Error) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}

afterEach(() => navigation.cancel());

describe('页面取数生命周期', () => {
  it('旧响应既不覆盖新数据，也不返回给调用方继续写表单', async () => {
    const scope = effectScope();
    const query = scope.run(() => useAsync<string>())!;
    const old = deferred<string>();
    const pending = query.run(() => old.promise);
    expect(await query.run(async () => '新数据')).toBe('新数据');
    old.resolve('旧数据');
    expect(await pending).toBeUndefined();
    expect(query.data.value).toBe('新数据');
    scope.stop();
  });

  it.each(['导航', '卸载'])('%s 后忽略结果且结束忙碌态', async (reason) => {
    navigation.begin();
    const scope = effectScope();
    const query = scope.run(() => useAsync<string>())!;
    const old = deferred<string>();
    const pending = query.run(() => old.promise);
    if (reason === '导航') navigation.begin();
    else scope.stop();
    old.resolve('离开的页面');
    expect(await pending).toBeUndefined();
    expect(query.data.value).toBeUndefined();
    expect(query.loading.value).toBe(false);
    scope.stop();
  });

  it('原地导航后同一实例可重新取数，卸载后不能再次执行任务', async () => {
    navigation.begin();
    const scope = effectScope();
    const query = scope.run(() => useAsync<string>())!;
    await query.run(async () => '用户分区');
    navigation.begin();
    expect(await query.run(async () => '展会分区')).toBe('展会分区');
    scope.stop();
    const task = vi.fn(async () => '卸载后的副作用');
    expect(await query.run(task)).toBeUndefined();
    expect(task).not.toHaveBeenCalled();
  });

  it('刷新失败保留成功内容，旧失败不关闭新请求的忙碌态', async () => {
    const scope = effectScope();
    const query = scope.run(() => useAsync<string>())!;
    await query.run(async () => '已有内容');
    const old = deferred<string>();
    const current = deferred<string>();
    const oldPending = query.run(() => old.promise);
    const currentPending = query.run(() => current.promise);
    old.reject(new Error('旧失败'));
    await oldPending;
    expect(query.error.value).toBeUndefined();
    expect(query.loading.value).toBe(true);
    current.reject(new Error('当前失败'));
    await currentPending;
    expect(query.data.value).toBe('已有内容');
    expect(query.error.value?.message).toBe('当前失败');
    scope.stop();
  });
});
