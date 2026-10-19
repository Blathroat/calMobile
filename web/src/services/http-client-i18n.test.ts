/**
 * 服务端错误码 → 本地化文案。
 *
 * 断言只依赖这里自己装的语言包（`server.demo.*`），不碰 zh.json 的真实键，
 * 这样文案表怎么增删都不会让这个测试红。
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ApiError, HttpClient } from './http-client';
import { resetLangForTests, t } from '@/i18n';

/** 语言包与 localStorage 里的 strings 都是嵌套的，按点分路径拼一棵（与 i18n 的写法一致）。 */
function nested(paths: Record<string, string>): Record<string, unknown> {
  const tree: Record<string, unknown> = {};
  for (const [path, text] of Object.entries(paths)) {
    const parts = path.split('.');
    let node = tree;
    for (const part of parts.slice(0, -1)) node = (node[part] ??= {}) as Record<string, unknown>;
    node[parts[parts.length - 1]!] = text;
  }
  return tree;
}

function response(status: number, body: unknown): Response {
  return { ok: status >= 200 && status < 300, status, json: async () => body } as Response;
}

/** 只回一个固定响应的客户端；错误码映射与请求内容无关，够用。 */
function clientReturning(status: number, body: unknown): HttpClient {
  return new HttpClient({ baseUrl: 'http://test', fetcher: async () => response(status, body) });
}

/** 包里只有这一条码的文案，别的码一律走「表里没有」的回退。 */
const PACK = {
  'server.demo.pending': '还有 {count} 条待处理',
  'server.demo.locked': '已被锁定',
};

describe('服务端错误码 → 本地化文案', () => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
    localStorage.setItem(
      'calmobile.lang.packs',
      JSON.stringify([{ id: 'en', name: 'English', strings: nested(PACK) }]),
    );
    localStorage.setItem('calmobile.lang.choice', 'en');
    resetLangForTests();
  });

  afterEach(() => {
    localStorage.clear();
    sessionStorage.clear();
    resetLangForTests();
  });

  it('测试包确实生效（否则下面的断言没有意义）', () => {
    expect(t('server.demo.locked', undefined, '')).toBe('已被锁定');
  });

  it('① 有码且有文案：换成包里的文案，占位按 errorParams 替换', async () => {
    const client = clientReturning(200, {
      ok: false,
      error: '服务端原文：还有 3 条',
      errorCode: 'demo.pending',
      errorParams: { count: 3 },
    });
    await expect(client.request('/x')).rejects.toMatchObject({ name: 'ApiError', message: '还有 3 条待处理' });
  });

  it('② 有码但表里没有：保持服务端原文', async () => {
    const client = clientReturning(200, { ok: false, error: '服务端原文', errorCode: 'demo.unknown' });
    await expect(client.request('/x')).rejects.toMatchObject({ name: 'ApiError', message: '服务端原文' });
  });

  it('③ 没有码：保持服务端原文', async () => {
    const client = clientReturning(200, { ok: false, error: '服务端原文' });
    await expect(client.request('/x')).rejects.toMatchObject({ name: 'ApiError', message: '服务端原文' });
  });

  it('④ 4xx 抛出的 ApiError.message 同样是本地化后的文案', async () => {
    const client = clientReturning(403, { ok: false, error: '服务端原文', errorCode: 'demo.locked' });
    const error = await client.request('/x').catch((reason: unknown) => reason);
    expect(error).toBeInstanceOf(ApiError);
    expect((error as ApiError).message).toBe('已被锁定');
    expect((error as ApiError).status).toBe(403);
  });

  it('⑤ found:false（没有 ok 字段）同样被本地化，原文留在 errorText', async () => {
    const client = clientReturning(200, { found: false, error: '服务端原文', errorCode: 'demo.locked' });
    const data = await client.request<Record<string, unknown>>('/x');
    expect(data.found).toBe(false);
    expect(data.error).toBe('已被锁定');
    expect(data.errorText).toBe('服务端原文');
  });

  it('⑥ errorParams 里的非字符串/数字被丢掉，占位原样保留', async () => {
    const client = clientReturning(200, {
      ok: false,
      error: '服务端原文',
      errorCode: 'demo.pending',
      errorParams: { count: { bad: true }, extra: null },
    });
    await expect(client.request('/x')).rejects.toMatchObject({ name: 'ApiError', message: '还有 {count} 条待处理' });
  });

  it('⑧ 响应不是对象（数组 / 字符串 / null）：不崩、原样返回', async () => {
    for (const body of [[1, 2, 3], 'plain text', null]) {
      const client = clientReturning(200, body);
      const data = await client.request<unknown>('/x');
      expect(data).toEqual(body);
    }
  });

  it('⑨ errorCode 是字符串但 error 不是：文案按原值 String() 处理，不换成包里的', async () => {
    const client = clientReturning(200, { ok: false, error: 42, errorCode: 'demo.locked' });
    const error = (await client.request('/x').catch((reason: unknown) => reason)) as Error & { status?: number };
    // 没有可替换的字符串，所以消息是 String(42)，绝不是包里那句「已被锁定」。
    expect(error.message).toBe('42');
    expect(error.message).not.toBe('已被锁定');
    expect(error.status).toBe(200);
  });

  it('⑩ errorParams 不是对象（数组 / 字符串）：占位原样保留', async () => {
    for (const errorParams of [[{ count: 3 }], 'count=3']) {
      const client = clientReturning(200, { ok: false, error: '服务端原文', errorCode: 'demo.pending', errorParams });
      await expect(client.request('/x')).rejects.toMatchObject({ name: 'ApiError', message: '还有 {count} 条待处理' });
    }
  });

  it('⑦ 响应里已经有 errorText 时不覆盖它', async () => {
    const client = clientReturning(200, {
      found: false,
      error: '服务端原文',
      errorText: '调用方给的原文',
      errorCode: 'demo.locked',
    });
    const data = await client.request<Record<string, unknown>>('/x');
    expect(data.error).toBe('已被锁定');
    expect(data.errorText).toBe('调用方给的原文');
  });
});
