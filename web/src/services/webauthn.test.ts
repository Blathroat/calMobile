/**
 * 通行密钥的路径选择：能力协商说原生支持才走桥；旧壳（清单里没有 `passkey.*`）回退浏览器
 * WebAuthn，与没有原生桥时同一套逻辑；两边都不支持时返回 null（页面按不可用处理）。
 *
 * 这里 mock 掉 `native-bridge` 的桥接实例与 `supportsNativeAction`，浏览器 WebAuthn 用
 * `navigator.credentials` / `PublicKeyCredential` / 安全上下文三个桩点模拟。
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
import { createCredential, getCredential, isPasskeySupported } from './webauthn';

/** 浏览器返回的凭据（真实 WebAuthn 对象的最小形状：二进制字段都是 ArrayBuffer）。 */
function credentialStub() {
  return {
    id: 'cred-1',
    rawId: new Uint8Array([1, 2, 3]).buffer,
    type: 'public-key',
    response: {
      clientDataJSON: new Uint8Array([4]).buffer,
      attestationObject: new Uint8Array([5]).buffer,
      authenticatorData: new Uint8Array([6]).buffer,
      signature: new Uint8Array([7]).buffer,
    },
  };
}

interface BrowserHandlers {
  create?: ReturnType<typeof vi.fn>;
  get?: ReturnType<typeof vi.fn>;
}

/** 模拟「浏览器真的支持 WebAuthn」：安全上下文 + PublicKeyCredential + navigator.credentials。 */
function stubBrowserWebAuthn(handlers: BrowserHandlers): void {
  Object.defineProperty(window, 'isSecureContext', { value: true, configurable: true });
  vi.stubGlobal('PublicKeyCredential', function PublicKeyCredential() {});
  vi.stubGlobal('navigator', {
    credentials: {
      create: handlers.create ?? vi.fn(),
      get: handlers.get ?? vi.fn(),
    },
  });
}

const originalSecureContext = Object.getOwnPropertyDescriptor(window, 'isSecureContext');

beforeEach(() => {
  vi.clearAllMocks();
  mocks.hasNative.mockReturnValue(true);
});

afterEach(() => {
  vi.unstubAllGlobals();
  if (originalSecureContext) Object.defineProperty(window, 'isSecureContext', originalSecureContext);
  else Reflect.deleteProperty(window, 'isSecureContext');
});

describe('createCredential / getCredential 的路径选择', () => {
  it('能力协商说原生支持时走原生桥，浏览器 WebAuthn 不介入', async () => {
    mocks.supportsNativeAction.mockResolvedValue(true);
    mocks.call.mockResolvedValue({
      credentialJson: JSON.stringify({ id: 'cred-1', rawId: 'AQID', type: 'public-key', response: {} }),
    });
    const create = vi.fn();
    stubBrowserWebAuthn({ create });

    await expect(createCredential({ challenge: 'AQID' })).resolves.toMatchObject({ id: 'cred-1', rawId: 'AQID' });

    expect(mocks.supportsNativeAction).toHaveBeenCalledWith('passkey.available');
    expect(mocks.supportsNativeAction).toHaveBeenCalledWith('passkey.create');
    expect(mocks.call).toHaveBeenCalledWith('passkey.create', { optionsJson: JSON.stringify({ challenge: 'AQID' }) });
    expect(create).not.toHaveBeenCalled();
  });

  it('旧壳没有通行密钥动作时回退浏览器 WebAuthn', async () => {
    // 清单里没有 passkey.*：supportsNativeAction 全部为 false。
    mocks.supportsNativeAction.mockResolvedValue(false);
    const create = vi.fn().mockResolvedValue(credentialStub());
    stubBrowserWebAuthn({ create });

    const result = await createCredential({ challenge: 'AQID', user: { id: 'AQID' } });

    expect(result).toMatchObject({ id: 'cred-1', type: 'public-key' });
    expect(create).toHaveBeenCalledTimes(1);
    expect(mocks.call).not.toHaveBeenCalled();
  });

  it('断言（getCredential）同样按能力回退浏览器 WebAuthn', async () => {
    mocks.supportsNativeAction.mockResolvedValue(false);
    const get = vi.fn().mockResolvedValue(credentialStub());
    stubBrowserWebAuthn({ get });

    await expect(
      getCredential({ challenge: 'AQID', allowCredentials: [{ id: 'AQID', type: 'public-key' }] }),
    ).resolves.toMatchObject({ id: 'cred-1' });
    expect(get).toHaveBeenCalledTimes(1);
    expect(mocks.call).not.toHaveBeenCalled();
  });

  it('原生与浏览器都不支持时返回 null（现有不可用处理）', async () => {
    mocks.supportsNativeAction.mockResolvedValue(false);
    // 不桩 WebAuthn：jsdom 没有 PublicKeyCredential。
    await expect(createCredential({})).resolves.toBeNull();
    await expect(getCredential({})).resolves.toBeNull();
    expect(mocks.call).not.toHaveBeenCalled();
  });

  it('原生被用户取消时归一成 null，不抛错', async () => {
    mocks.supportsNativeAction.mockResolvedValue(true);
    mocks.call.mockRejectedValue(new NativeBridgeError('已取消添加通行密钥', 'cancelled'));

    await expect(createCredential({})).resolves.toBeNull();
  });
});

describe('isPasskeySupported（同步快速判断）', () => {
  it('App 里有原生桥时乐观为真，浏览器里看 WebAuthn 是否存在', () => {
    mocks.hasNative.mockReturnValue(true);
    expect(isPasskeySupported()).toBe(true);

    mocks.hasNative.mockReturnValue(false);
    expect(isPasskeySupported()).toBe(false);

    stubBrowserWebAuthn({});
    expect(isPasskeySupported()).toBe(true);
  });
});
