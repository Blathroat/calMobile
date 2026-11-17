/**
 * 复制服务的两条通道：优先 Clipboard API，不可用或被拒绝时退回隐藏 textarea + execCommand。
 *
 * 页面只拿布尔结果决定提示文案，不再弹手动复制面板，所以两条通道都要覆盖：
 * Android WebView 里 Clipboard API 可能没有或被权限拒绝，兜底静默失败会表现为「点了复制没反应」。
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { copyText } from './clipboard';

const originalClipboard = navigator.clipboard;
const originalExecCommand = document.execCommand;

function setClipboard(value: unknown): void {
  Object.defineProperty(navigator, 'clipboard', { value, configurable: true, writable: true });
}

function setExecCommand(value: ((command: string) => boolean) | undefined): void {
  Object.defineProperty(document, 'execCommand', { value, configurable: true, writable: true });
}

afterEach(() => {
  setClipboard(originalClipboard);
  setExecCommand(originalExecCommand);
  vi.restoreAllMocks();
});

describe('复制文本', () => {
  it('优先走 Clipboard API，成功就不再碰兜底', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    const execCommand = vi.fn(() => true);
    setClipboard({ writeText });
    setExecCommand(execCommand);

    await expect(copyText('https://example.com/e/exh-1')).resolves.toBe(true);
    expect(writeText).toHaveBeenCalledWith('https://example.com/e/exh-1');
    expect(execCommand).not.toHaveBeenCalled();
  });

  it('没有 Clipboard API 时用隐藏 textarea 选中正文再复制', async () => {
    setClipboard(originalClipboard);
    let copied = '';
    setExecCommand(() => {
      const area = document.querySelector('textarea');
      copied = area?.value ?? '';
      return true;
    });

    await expect(copyText('已复制的内容')).resolves.toBe(true);
    expect(copied).toBe('已复制的内容');
    // 临时节点用完就移除，不在页面里留 textarea。
    expect(document.querySelector('textarea')).toBeNull();
  });

  it('Clipboard API 被拒绝时改走兜底', async () => {
    const writeText = vi.fn().mockRejectedValue(new Error('权限被拒绝'));
    const execCommand = vi.fn(() => true);
    setClipboard({ writeText });
    setExecCommand(execCommand);

    await expect(copyText('https://example.com/e/exh-1')).resolves.toBe(true);
    expect(writeText).toHaveBeenCalledOnce();
    expect(execCommand).toHaveBeenCalledWith('copy');
  });

  it('兜底通道返回 false 时如实报告失败', async () => {
    setClipboard(undefined);
    setExecCommand(() => false);

    await expect(copyText('https://example.com/e/exh-1')).resolves.toBe(false);
  });

  it('两条通道都不可用时返回 false，不抛异常', async () => {
    setClipboard(undefined);
    setExecCommand(undefined);

    await expect(copyText('https://example.com/e/exh-1')).resolves.toBe(false);
  });

  it('空文本不写到剪贴板', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    const execCommand = vi.fn(() => true);
    setClipboard({ writeText });
    setExecCommand(execCommand);

    await expect(copyText('')).resolves.toBe(false);
    expect(writeText).not.toHaveBeenCalled();
    expect(execCommand).not.toHaveBeenCalled();
  });
});
