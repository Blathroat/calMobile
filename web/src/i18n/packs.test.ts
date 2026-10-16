import { describe, expect, it } from 'vitest';
import {
  PackError,
  chooseLanguage,
  fetchPack,
  installPack,
  parsePack,
  readLangState,
  rememberServerLang,
  removePack,
  resolveActiveId,
  writeLangState,
  type LangState,
} from './packs';

const empty = (): LangState => ({ packs: [], choice: '', serverDefault: '', joinDefault: '' });

function pack(id: string, strings: Record<string, string> = { 'auth.login.title': id }) {
  return { id, name: id.toUpperCase(), strings };
}

describe('语言包', () => {
  it('缺字段、坏键和过长名称都拒绝', () => {
    expect(() => parsePack(null)).toThrow(PackError);
    expect(() => parsePack({ id: 'EN', name: 'English', strings: {} })).toThrow(PackError);
    expect(() => parsePack({ id: 'en', name: '', strings: {} })).toThrow(PackError);
    expect(() => parsePack({ id: 'en', name: 'English', strings: { 'not a key': 'x' } })).toThrow(PackError);
    expect(() => parsePack({ id: 'en', name: 'English', strings: { 'auth.login.title': 1 } })).toThrow(PackError);
    expect(() => parsePack({ id: 'english', name: 'English', strings: {} }, 'en')).toThrow(PackError);
  });

  it('空串保留，列表里的名称必须和文件里的 id 一致', () => {
    expect(parsePack({ id: 'en', name: 'English', strings: { 'auth.login.title': '' } }, 'en').strings).toEqual({
      'auth.login.title': '',
    });
  });

  it('报名站只在默认名称已安装时使用它', () => {
    const state = { ...empty(), packs: [pack('en')], joinDefault: 'en', serverDefault: 'en', choice: 'ja' };
    expect(resolveActiveId(state, 'join')).toBe('en');
    expect(resolveActiveId({ ...state, joinDefault: '' }, 'join')).toBe('zh');
    expect(resolveActiveId({ ...state, packs: [] }, 'join')).toBe('zh');
  });

  it('应用里用户的选择优先于服务器默认', () => {
    const state = { ...empty(), packs: [pack('en'), pack('ja')], serverDefault: 'en', choice: 'ja' };
    expect(resolveActiveId(state, 'app')).toBe('ja');
    expect(resolveActiveId({ ...state, choice: 'zh' }, 'app')).toBe('zh');
    expect(resolveActiveId({ ...state, choice: '' }, 'app')).toBe('en');
    expect(resolveActiveId({ ...state, choice: '', serverDefault: '' }, 'app')).toBe('zh');
    expect(resolveActiveId({ ...state, choice: 'missing' }, 'app')).toBe('zh');
  });

  it('默认名称不在下载列表里时，报名站不记下它', () => {
    expect(rememberServerLang(empty(), 'en', ['ja']).joinDefault).toBe('');
    expect(rememberServerLang(empty(), 'en', ['en']).joinDefault).toBe('en');
    expect(rememberServerLang(empty(), '', ['en'])).toMatchObject({ serverDefault: '', joinDefault: '' });
    expect(rememberServerLang(empty(), 'Bad', ['Bad']).serverDefault).toBe('');
  });

  it('自动安装不覆盖已有的包，手动安装会换掉', () => {
    const first = installPack(empty(), pack('en', { 'auth.login.title': '旧' }), false);
    const kept = installPack(first, pack('en', { 'auth.login.title': '新' }), false);
    expect(kept.packs[0]?.strings['auth.login.title']).toBe('旧');
    const replaced = installPack(first, pack('en', { 'auth.login.title': '新' }), true);
    expect(replaced.packs[0]?.strings['auth.login.title']).toBe('新');
  });

  it('删除当前选择后回到未选择', () => {
    const installed = chooseLanguage(installPack(empty(), pack('en'), false), 'en');
    expect(removePack(installed, 'en').choice).toBe('');
  });

  it('读写本机存储时丢掉坏包', () => {
    const memory = new Map<string, string>();
    const storage = {
      getItem: (key: string) => memory.get(key) ?? null,
      setItem: (key: string, value: string) => void memory.set(key, value),
    };
    writeLangState(storage, installPack(empty(), pack('en'), false));
    memory.set('calmobile.lang.packs', JSON.stringify([pack('en'), { id: 'no', name: '', strings: {} }, pack('ja')]));
    const loaded = readLangState(storage);
    expect(loaded.packs.map((item) => item.id)).toEqual(['en', 'ja']);
  });

  it('下载失败、地址不对和 id 对不上都不写入', async () => {
    const fetchImpl = (async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith('/missing.json')) return new Response('no', { status: 404 });
      if (url.endsWith('/wrong.json')) {
        return new Response(JSON.stringify({ id: 'ja', name: 'Japanese', strings: {} }), { status: 200 });
      }
      return new Response(JSON.stringify({ id: 'en', name: 'English', strings: { 'auth.login.title': 'Log in' } }), {
        status: 200,
      });
    }) as typeof fetch;

    await expect(fetchPack('ftp://example.com/en.json', 'en', fetchImpl, false)).rejects.toMatchObject({
      code: 'badUrl',
    });
    await expect(fetchPack('http://example.com/en.json', 'en', fetchImpl, false)).rejects.toMatchObject({
      code: 'badUrl',
    });
    await expect(fetchPack('https://example.com/missing.json', 'en', fetchImpl, false)).rejects.toMatchObject({
      code: 'downloadFailed',
    });
    await expect(fetchPack('https://example.com/wrong.json', 'en', fetchImpl, false)).rejects.toMatchObject({
      code: 'idMismatch',
    });
    const pack = await fetchPack('https://example.com/en.json', 'en', fetchImpl, true);
    expect(pack.strings['auth.login.title']).toBe('Log in');
  });
});
