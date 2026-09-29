/**
 * `adb reverse` 自动接通的单元测试。
 *
 * 这段逻辑的价值全在「判断准不准」上：映射在不在、该不该重接、日志什么时候打。
 * 用例把 adb 换成假执行器，因此不依赖真机、也不会真的改本机的端口映射。
 */

import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import {
  adbReverseDisabled,
  ensureAdbReverse,
  hasReverseMapping,
  resolveAdbPath,
  watchAdbReverse,
  type CommandResult,
  type CommandRunner,
} from './adb-reverse.js';

/** 真实输出形如 `host-16 tcp:3000 tcp:3000`（`adb reverse --list` 每条一行）。 */
const LISTED = 'host-16 tcp:3000 tcp:3000\n';

function ok(stdout = ''): CommandResult {
  return { ok: true, stdout, message: '' };
}

function fail(message: string): CommandResult {
  return { ok: false, stdout: '', message };
}

/** 假 adb：按调用顺序返回预设结果，并记下每次参数。 */
function fakeRunner(results: CommandResult[]): { run: CommandRunner; calls: string[][] } {
  const calls: string[][] = [];
  const run: CommandRunner = async (args) => {
    calls.push(args);
    return results.shift() ?? ok();
  };
  return { run, calls };
}

describe('hasReverseMapping', () => {
  it('认得出已经接好的映射', () => {
    assert.equal(hasReverseMapping(LISTED, 3000), true);
    assert.equal(hasReverseMapping('emulator-5554 tcp:8080 tcp:8080\r\n', 8080), true);
  });

  it('端口只是前缀或错位都不算接好', () => {
    assert.equal(hasReverseMapping('host-16 tcp:30000 tcp:30000\n', 3000), false);
    assert.equal(hasReverseMapping('host-16 tcp:13000 tcp:13000\n', 3000), false);
    // 设备侧没错、本机侧接错了端口：应用照样连不上，必须重接。
    assert.equal(hasReverseMapping('host-16 tcp:3000 tcp:3001\n', 3000), false);
    assert.equal(hasReverseMapping('', 3000), false);
  });
});

describe('adbReverseDisabled', () => {
  it('默认开着，只有明确写 0/false/no/off 才关', () => {
    assert.equal(adbReverseDisabled({}), false);
    assert.equal(adbReverseDisabled({ ADB_REVERSE: '' }), false);
    assert.equal(adbReverseDisabled({ ADB_REVERSE: '1' }), false);
    assert.equal(adbReverseDisabled({ ADB_REVERSE: '0' }), true);
    assert.equal(adbReverseDisabled({ ADB_REVERSE: ' OFF ' }), true);
  });
});

describe('resolveAdbPath', () => {
  it('ADB 显式指定优先', () => {
    assert.equal(resolveAdbPath({ ADB: 'D:\\sdk\\adb.exe' }, 'win32'), 'D:\\sdk\\adb.exe');
  });

  it('找不到就交给 PATH', () => {
    assert.equal(resolveAdbPath({}, 'linux'), 'adb');
    assert.equal(resolveAdbPath({ ANDROID_HOME: 'C:\\nope' }, 'win32'), 'adb');
  });

  it('认得出 SDK 目录里的 adb', () => {
    const root = mkdtempSync(join(tmpdir(), 'calmobile-adb-'));
    try {
      const sdkAdb = join(root, 'sdk', 'platform-tools', 'adb.exe');
      const localAdb = join(root, 'local', 'Android', 'Sdk', 'platform-tools', 'adb.exe');
      const unixAdb = join(root, 'local', 'Android', 'Sdk', 'platform-tools', 'adb');
      for (const file of [sdkAdb, localAdb, unixAdb]) {
        mkdirSync(dirname(file), { recursive: true });
        writeFileSync(file, '');
      }
      assert.equal(resolveAdbPath({ ANDROID_HOME: join(root, 'sdk') }, 'win32'), sdkAdb);
      assert.equal(resolveAdbPath({ ANDROID_SDK_ROOT: join(root, 'sdk') }, 'win32'), sdkAdb);
      assert.equal(resolveAdbPath({ LOCALAPPDATA: join(root, 'local') }, 'win32'), localAdb);
      // 非 Windows 用不带 .exe 的文件名
      assert.equal(resolveAdbPath({ ANDROID_HOME: join(root, 'local', 'Android', 'Sdk') }, 'linux'), unixAdb);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

describe('ensureAdbReverse', () => {
  it('已经在就不重复接', async () => {
    const { run, calls } = fakeRunner([ok(LISTED)]);
    const attempt = await ensureAdbReverse({ port: 3000, run });
    assert.equal(attempt.outcome, 'ready');
    assert.deepEqual(calls, [['reverse', '--list']]);
  });

  it('不在就接一次，两端端口一致', async () => {
    const { run, calls } = fakeRunner([ok(''), ok('3000\n')]);
    const attempt = await ensureAdbReverse({ port: 3000, run });
    assert.equal(attempt.outcome, 'mapped');
    assert.deepEqual(calls, [
      ['reverse', '--list'],
      ['reverse', 'tcp:3000', 'tcp:3000'],
    ]);
  });

  it('adb 不在（列不出来）直接认不可用，不再瞎接', async () => {
    const { run, calls } = fakeRunner([fail('spawn adb ENOENT')]);
    const attempt = await ensureAdbReverse({ port: 3000, run });
    assert.equal(attempt.outcome, 'unavailable');
    assert.match(attempt.detail, /ENOENT/);
    assert.equal(calls.length, 1);
  });

  it('没设备与其它失败分开报，便于日志给出不同建议', async () => {
    const noDevice = fakeRunner([ok(''), fail('error: no devices/emulators found')]);
    assert.equal((await ensureAdbReverse({ port: 3000, run: noDevice.run })).outcome, 'no-device');

    const multi = fakeRunner([ok(''), fail('error: more than one device/emulator')]);
    assert.equal((await ensureAdbReverse({ port: 3000, run: multi.run })).outcome, 'no-device');

    const broken = fakeRunner([ok(''), fail("adb server version (41) doesn't match this client (36)")]);
    assert.equal((await ensureAdbReverse({ port: 3000, run: broken.run })).outcome, 'unavailable');
  });
});

describe('watchAdbReverse', () => {
  it('状态没变只报一次，映射丢了会补回并再报一次', async () => {
    vi.useFakeTimers();
    try {
      const lines: string[] = [];
      let mapped = false;
      const run: CommandRunner = async (args) => {
        if (args[0] === 'reverse' && args[1] === '--list') {
          return ok(mapped ? LISTED : '');
        }
        mapped = true;
        return ok('3000\n');
      };
      const stop = watchAdbReverse({ port: 3000, run, log: (line) => lines.push(line), fastMs: 10, slowMs: 10 });

      // 第一次：接上（mapped）；第二次起列表里就有了（ready）——状态各变一次，各报一次。
      await vi.advanceTimersByTimeAsync(0);
      assert.equal(lines.length, 1);
      assert.match(lines[0] ?? '', /已接通/);

      await vi.advanceTimersByTimeAsync(11);
      assert.equal(lines.length, 2);
      assert.match(lines[1] ?? '', /已接通/);

      // 状态稳定在 ready：再跳几次也不重复刷日志。
      await vi.advanceTimersByTimeAsync(50);
      assert.equal(lines.length, 2);

      // adb server 重启把映射弄丢了：下一轮检测到并补回。
      mapped = false;
      await vi.advanceTimersByTimeAsync(11);
      assert.equal(lines.length, 3);
      assert.equal(mapped, true);

      stop();
      const after = lines.length;
      await vi.advanceTimersByTimeAsync(50);
      assert.equal(lines.length, after);
    } finally {
      vi.useRealTimers();
    }
  });

  it('没设备时报一次，设备出现后自动接通', async () => {
    vi.useFakeTimers();
    try {
      const lines: string[] = [];
      let deviceUp = false;
      const run: CommandRunner = async (args) => {
        if (args[0] === 'reverse' && args[1] === '--list') {
          return ok(deviceUp ? LISTED : '');
        }
        return deviceUp ? ok('3000\n') : fail('error: no devices/emulators found');
      };
      watchAdbReverse({ port: 3000, run, log: (line) => lines.push(line), fastMs: 10, slowMs: 10 });

      await vi.advanceTimersByTimeAsync(0);
      assert.match(lines[0] ?? '', /还没检测到模拟器/);

      deviceUp = true;
      await vi.advanceTimersByTimeAsync(20);
      assert.equal(lines.length, 2);
      assert.match(lines[1] ?? '', /已接通/);
    } finally {
      vi.useRealTimers();
    }
  });
});
