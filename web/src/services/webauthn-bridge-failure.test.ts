/**
 * 通行密钥失败语义：只有「用户取消」才返回 null；桥回包坏了、旧壳回退不了都要抛可读中文，
 * 页面据此显示原因而不是把抽屉静默收起来。
 *
 * 这里 mock 掉 native-bridge 的桥接实例与能力协商，只钉 webauthn.ts 自己的判断。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  hasNative: vi.fn(),
  supportsNativeAction: vi.fn(),
  call: vi.fn(),
}));

vi.mock('./native-bridge', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./native-bridge')>();
  return {
    ...actual,
    nativeBridge: { hasNative: mocks.hasNative, call: mocks.call, report: vi.fn() },
    supportsNativeAction: mocks.supportsNativeAction,
  };
});

import { NativeBridgeError } from './native-bridge';
import { createCredential, getCredential } from './webauthn';

/** 期待这次调用失败，并把失败原因取出来做断言。 */
async function failureOf(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise;
  } catch (error) {
    return error;
  }
  throw new Error('预期失败，但调用成功返回了');
}

/** 断言错误信息里有中文：页面只给用户看中文，英文原文只该进日志。 */
function expectReadableChinese(error: unknown): void {
  expect(error).toBeInstanceOf(NativeBridgeError);
  expect((error as Error).message).toMatch(/[\u4e00-\u9fff]/u);
}

const originalSecureContext = Object.getOwnPropertyDescriptor(window, 'isSecureContext');

beforeEach(() => {
  vi.clearAllMocks();
  mocks.hasNative.mockReturnValue(true);
  mocks.supportsNativeAction.mockResolvedValue(true);
});

afterEach(() => {
  vi.unstubAllGlobals();
  if (originalSecureContext) Object.defineProperty(window, 'isSecureContext', originalSecureContext);
  else Reflect.deleteProperty(window, 'isSecureContext');
});

describe('原生桥回包损坏', () => {
  it('成功回调里没有 credentialJson 时抛可读中文，而不是当用户取消返回 null', async () => {
    mocks.call.mockResolvedValue({});
    expectReadableChinese(await failureOf(createCredential({ challenge: 'AQID' })));
    expectReadableChinese(await failureOf(getCredential({ challenge: 'AQID' })));
  });

  it('credentialJson 不是 JSON 时同样按失败处理', async () => {
    mocks.call.mockResolvedValue({ credentialJson: 'not-json' });
    expectReadableChinese(await failureOf(createCredential({ challenge: 'AQID' })));
  });

  it('credentialJson 缺 response 字段时按失败处理', async () => {
    mocks.call.mockResolvedValue({
      credentialJson: JSON.stringify({ id: 'cred-1', rawId: 'AQID', type: 'public-key' }),
    });
    expectReadableChinese(await failureOf(createCredential({ challenge: 'AQID' })));
  });

  it('正常回包原样返回凭据', async () => {
    mocks.call.mockResolvedValue({
      credentialJson: JSON.stringify({ id: 'cred-1', rawId: 'AQID', type: 'public-key', response: {} }),
    });
    await expect(createCredential({ challenge: 'AQID' })).resolves.toMatchObject({ id: 'cred-1', rawId: 'AQID' });
  });
});

describe('用户取消与不可预期失败要分开', () => {
  it('cancelled 归一成 null（页面静默，不弹错误）', async () => {
    mocks.call.mockRejectedValue(new NativeBridgeError('已取消添加通行密钥', 'cancelled'));
    await expect(createCredential({})).resolves.toBeNull();
    await expect(getCredential({})).resolves.toBeNull();
  });

  it('unsupported 不静默：旧壳且 WebView 没有 WebAuthn 时抛可读中文', async () => {
    mocks.call.mockRejectedValue(new NativeBridgeError('未实现的动作：passkey.create', 'unsupported'));
    expectReadableChinese(await failureOf(createCredential({ challenge: 'AQID' })));
  });

  it('能力协商说不支持、容器又没有 WebAuthn 时抛可读中文', async () => {
    mocks.supportsNativeAction.mockResolvedValue(false);
    expectReadableChinese(await failureOf(createCredential({ challenge: 'AQID', user: { id: 'AQID' } })));
    expectReadableChinese(await failureOf(getCredential({ challenge: 'AQID' })));
  });

  it('原生把英文系统错误原样回传时也抛出来，交给页面的中文映射兜底', async () => {
    mocks.call.mockRejectedValue(new NativeBridgeError("Request doesn't finish on time!"));
    await expect(createCredential({ challenge: 'AQID' })).rejects.toThrow("Request doesn't finish on time!");
  });
});

describe('浏览器分支的选项损坏', () => {
  it('没有原生桥、服务端选项不是对象时抛可读中文，而不是静默返回 null', async () => {
    mocks.hasNative.mockReturnValue(false);
    expectReadableChinese(await failureOf(createCredential('not-an-object')));
    expectReadableChinese(await failureOf(getCredential(42)));
  });
});
