import { afterEach, describe, expect, it } from 'vitest';
import { ApiError, HttpClient, TransportError } from './http-client';

function response(status: number, body: unknown): Response {
  return { ok: status >= 200 && status < 300, status, json: async () => body } as Response;
}

/** 假 XHR：只实现 http-client 用到的那些成员，行为由每个用例通过 `FakeXhr.behavior` 注入。 */
interface FakeProgressEvent {
  lengthComputable?: boolean;
  loaded?: number;
  total?: number;
}

class FakeUpload {
  private readonly listeners = new Map<string, Array<(event: FakeProgressEvent) => void>>();

  addEventListener(type: string, listener: (event: FakeProgressEvent) => void): void {
    const list = this.listeners.get(type) ?? [];
    list.push(listener);
    this.listeners.set(type, list);
  }

  emit(type: string, event: FakeProgressEvent): void {
    for (const listener of this.listeners.get(type) ?? []) listener(event);
  }
}

class FakeXhr {
  static instances: FakeXhr[] = [];
  static behavior: (xhr: FakeXhr, index: number) => void = () => undefined;

  upload = new FakeUpload();
  method = '';
  url = '';
  status = 0;
  statusText = '';
  responseText = '';
  timeout = 0;
  aborted = false;
  readonly headers: Record<string, string> = {};
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  ontimeout: (() => void) | null = null;
  onabort: (() => void) | null = null;

  constructor() {
    FakeXhr.instances.push(this);
  }

  open(method: string, url: string): void {
    this.method = method;
    this.url = url;
  }

  setRequestHeader(key: string, value: string): void {
    this.headers[key] = value;
  }

  send(): void {
    const index = FakeXhr.instances.indexOf(this);
    queueMicrotask(() => FakeXhr.behavior(this, index));
  }

  abort(): void {
    this.aborted = true;
    this.onabort?.();
  }
}

function success(xhr: FakeXhr, body: unknown = { ok: true }, status = 200): void {
  xhr.status = status;
  xhr.responseText = JSON.stringify(body);
  xhr.onload?.();
}

function restartFake(): void {
  FakeXhr.instances = [];
  FakeXhr.behavior = () => undefined;
}

/** 建一个走 XHR 的客户端：只在上传进度场景才会到 FakeXhr。 */
function uploadClient(extra: Partial<ConstructorParameters<typeof HttpClient>[0]> = {}): HttpClient {
  return new HttpClient({
    baseUrl: 'http://test',
    xhrFactory: () => new FakeXhr() as unknown as XMLHttpRequest,
    // 真正走 fetch 的用例会直接失败，避免掩盖「本该用 XHR 却用了 fetch」的回归。
    fetcher: async () => {
      throw new Error('上传请求不应走 fetch');
    },
    ...extra,
  });
}

afterEach(restartFake);

describe('HttpClient', () => {
  it('classifies business and transport failures', async () => {
    const business = new HttpClient({ baseUrl: 'http://test', fetcher: async () => response(403, { error: '无权' }) });
    await expect(business.request('/x')).rejects.toBeInstanceOf(ApiError);
    const transport = new HttpClient({ baseUrl: 'http://test', fetcher: async () => response(502, {}) });
    await expect(transport.request('/x')).rejects.toBeInstanceOf(TransportError);
  });

  it('refreshes once and retries with the new token', async () => {
    let token = 'old';
    let calls = 0;
    const client = new HttpClient({
      baseUrl: 'http://test',
      getAccessToken: () => token,
      refresh: async () => {
        token = 'new';
        return true;
      },
      fetcher: async (_url, init) => {
        calls += 1;
        return response(calls === 1 ? 401 : 200, { token: init?.headers && 'ok' });
      },
    });
    await client.request('/x');
    expect(calls).toBe(2);
  });

  it('超时与调用方取消分开报：reason 分别是 timeout / aborted', async () => {
    /** 永远不回的假请求：只有 abort 时才会 reject。 */
    const hanging = (_url: string, init?: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
      });

    // 超时自己触发（超时设 10ms）
    const timeoutClient = new HttpClient({ baseUrl: 'http://test', timeoutMs: 10, fetcher: hanging as typeof fetch });
    await expect(timeoutClient.request('/x')).rejects.toMatchObject({ name: 'TransportError', reason: 'timeout' });

    // 调用方主动取消（超时给足，不会先触发）
    const abortable = new HttpClient({ baseUrl: 'http://test', timeoutMs: 5_000, fetcher: hanging as typeof fetch });
    const controller = new AbortController();
    const pending = abortable.request('/x', { signal: controller.signal });
    controller.abort();
    await expect(pending).rejects.toMatchObject({ name: 'TransportError', reason: 'aborted' });
  });
});

describe('HttpClient 上传进度', () => {
  it('带 onUploadProgress 的字节请求走 XHR，进度从 0 到 100 且带令牌与类型', async () => {
    restartFake();
    const progress: number[] = [];
    FakeXhr.behavior = (xhr) => {
      xhr.upload.emit('progress', { lengthComputable: true, loaded: 30, total: 100 });
      xhr.upload.emit('progress', { lengthComputable: true, loaded: 100, total: 100 });
      success(xhr, { ok: true, url: '/media/a.jpg' });
    };
    const client = uploadClient({ getAccessToken: () => 'token-1' });
    const result = await client.request<{ url: string }>('/media', {
      method: 'POST',
      bytes: new Uint8Array([1, 2, 3]),
      contentType: 'image/jpeg',
      onUploadProgress: (percent) => progress.push(percent),
    });

    expect(result.url).toBe('/media/a.jpg');
    expect(progress[0]).toBe(0);
    expect(progress.at(-1)).toBe(100);
    expect(progress).toContain(30);
    // 进度只能是 0–100 的整数。
    expect(progress.every((value) => Number.isInteger(value) && value >= 0 && value <= 100)).toBe(true);

    const xhr = FakeXhr.instances[0]!;
    expect(xhr.method).toBe('POST');
    expect(xhr.url).toBe('http://test/media');
    expect(xhr.headers.Authorization).toBe('Bearer token-1');
    expect(xhr.headers['Content-Type']).toBe('image/jpeg');
  });

  it('上传响应里的规则失败仍按 ApiError 抛出', async () => {
    restartFake();
    FakeXhr.behavior = (xhr) => success(xhr, { ok: false, error: '服务器空间已满' });
    const client = uploadClient();
    const pending = client.request('/media', {
      method: 'POST',
      bytes: new Uint8Array([1]),
      onUploadProgress: () => undefined,
    });
    await expect(pending).rejects.toBeInstanceOf(ApiError);
    await expect(pending).rejects.toThrow('服务器空间已满');
  });

  it('上传收到 401 时刷新一次并重放，进度重新从 0 报', async () => {
    restartFake();
    let token = 'old';
    const progress: number[] = [];
    FakeXhr.behavior = (xhr, index) => {
      if (index === 0) {
        success(xhr, { error: 'expired' }, 401);
        return;
      }
      expect(xhr.headers.Authorization).toBe('Bearer new');
      success(xhr, { ok: true });
    };
    const client = uploadClient({
      getAccessToken: () => token,
      refresh: async () => {
        token = 'new';
        return true;
      },
    });
    await client.request('/media', {
      method: 'POST',
      bytes: new Uint8Array([1]),
      onUploadProgress: (percent) => progress.push(percent),
    });

    expect(FakeXhr.instances).toHaveLength(2);
    expect(progress.filter((value) => value === 0)).toHaveLength(2);
  });

  it('上传超时与调用方取消仍归成 timeout / aborted', async () => {
    restartFake();
    const timeoutClient = uploadClient({ timeoutMs: 10 });
    const upload = { method: 'POST' as const, bytes: new Uint8Array([1]), onUploadProgress: () => undefined };
    await expect(timeoutClient.request('/media', upload)).rejects.toMatchObject({
      name: 'TransportError',
      reason: 'timeout',
    });

    restartFake();
    const abortable = uploadClient({ timeoutMs: 5_000 });
    const controller = new AbortController();
    const pending = abortable.request('/media', { ...upload, signal: controller.signal });
    controller.abort();
    await expect(pending).rejects.toMatchObject({ name: 'TransportError', reason: 'aborted' });
    expect(FakeXhr.instances[0]?.aborted).toBe(true);
  });

  it('上传响应不是 JSON 或 5xx 时归成传输失败', async () => {
    restartFake();
    FakeXhr.behavior = (xhr) => {
      xhr.status = 200;
      xhr.responseText = 'not json';
      xhr.onload?.();
    };
    const badJson = uploadClient();
    await expect(
      badJson.request('/media', { method: 'POST', bytes: new Uint8Array([1]), onUploadProgress: () => undefined }),
    ).rejects.toMatchObject({ name: 'TransportError' });

    restartFake();
    FakeXhr.behavior = (xhr) => success(xhr, { error: 'boom' }, 503);
    const serverError = uploadClient();
    await expect(
      serverError.request('/media', {
        method: 'POST',
        bytes: new Uint8Array([1]),
        onUploadProgress: () => undefined,
      }),
    ).rejects.toMatchObject({ name: 'TransportError' });
  });

  it('进度回调自己抛错不会打断上传', async () => {
    restartFake();
    FakeXhr.behavior = (xhr) => {
      xhr.upload.emit('progress', { lengthComputable: true, loaded: 50, total: 100 });
      success(xhr, { ok: true, url: '/media/a.jpg' });
    };
    const client = uploadClient();
    const result = await client.request<{ url: string }>('/media', {
      method: 'POST',
      bytes: new Uint8Array([1]),
      onUploadProgress: () => {
        throw new Error('界面回调异常');
      },
    });
    expect(result.url).toBe('/media/a.jpg');
  });
});
