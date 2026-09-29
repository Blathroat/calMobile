/**
 * 开发期把设备端口反接到开发机（`adb reverse`）。
 *
 * 页面里的接口地址写死 `http://127.0.0.1:3000`（见 `web/src/api/client.ts`），而设备里的
 * `127.0.0.1` 指的是设备自己，所以模拟器与真机必须靠 `adb reverse tcp:3000 tcp:3000`
 * 才能连上后端。这个映射**不写盘**：adb server 重启、设备重连、换一台设备、机器重启都会丢，
 * 丢了以后应用里每个请求都失败，看起来像「后端没起」——这就是「只跑了 `pnpm dev`，
 * 模拟器连不上」的全部原因。
 *
 * 因此 `pnpm dev` 启动时接一次，并在运行期间轮询补回（设备晚于服务启动也能自愈）。
 * 只有开发入口 `scripts/dev.ts` 引入本模块，生产入口不碰；要自己管 adb 的人用
 * `ADB_REVERSE=0` 关掉。
 */

import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

/** 有设备时的轮询间隔：映射刚丢时用户只需重进一次页面，不值得等更久。 */
export const REVERSE_POLL_FAST_MS = 5_000;

/** 没设备时的轮询间隔：等的只是「模拟器什么时候启动」，密了没有意义。 */
export const REVERSE_POLL_SLOW_MS = 15_000;

/** 一次 adb 调用的结果；失败只把原因留给日志，不抛异常。 */
export interface CommandResult {
  ok: boolean;
  stdout: string;
  /** 失败原因（stderr 或 execFile 的错误信息）。 */
  message: string;
}

/** adb 调用的注入点：单测换成假实现，不真的起子进程。 */
export type CommandRunner = (args: string[]) => Promise<CommandResult>;

export type ReverseOutcome =
  /** 映射已经在了（本进程接的，或 `emu.ps1 reverse` 早先接的）。 */
  | 'ready'
  /** 刚接上。 */
  | 'mapped'
  /** adb 在，但设备侧用不了：没有设备、没授权、或设备多于一台。 */
  | 'no-device'
  /** adb 本身不可用：没装、不在 PATH、adb server 起不来。 */
  | 'unavailable';

export interface ReverseAttempt {
  outcome: ReverseOutcome;
  /** 失败时 adb 的原话，只用于日志（已经过截断）。 */
  detail: string;
}

export interface AdbReverseOptions {
  /** 后端端口；应用侧写死 3000，改端口只有浏览器调试用得上。 */
  port: number;
  /** 默认按 `ADB` / Android SDK 目录 / PATH 依次找。 */
  adbPath?: string;
  run?: CommandRunner;
}

export interface WatchAdbReverseOptions extends AdbReverseOptions {
  log?: (message: string) => void;
  /** 仅单测覆盖：把两种间隔压到毫秒级。 */
  fastMs?: number;
  slowMs?: number;
}

const NO_DEVICE_PATTERN = /no devices|device not found|device offline|more than one device|unauthorized/i;

/**
 * `adb reverse --list` 的输出里是否已经有「设备 3000 → 本机 3000」。
 *
 * 输出形如 `host-16 tcp:3000 tcp:3000`（最左边是 adb 的临时名字，不是稳定标识）。
 * 两端都必须匹配：`tcp:3000 tcp:3001` 这种错位映射对应用没有用，得重接。
 */
export function hasReverseMapping(listOutput: string, port: number): boolean {
  const wanted = String(port);
  return listOutput.split(/\r?\n/).some((line) => {
    const match = /tcp:(\d+)\s+tcp:(\d+)/.exec(line);
    return match?.[1] === wanted && match?.[2] === wanted;
  });
}

/** `ADB_REVERSE=0|false|no|off` 关闭自动接通（默认开着）。 */
export function adbReverseDisabled(env: Record<string, string | undefined> = {}): boolean {
  const raw = (env.ADB_REVERSE ?? '').trim().toLowerCase();
  return raw === '0' || raw === 'false' || raw === 'no' || raw === 'off';
}

/**
 * adb 的位置：`ADB` 优先，其次 Android SDK 的默认安装目录，最后交给 PATH。
 *
 * 找不到也照样返回 `adb`：让调用处统一走「执行失败」这条路，不必在这里判两遍。
 */
export function resolveAdbPath(
  env: Record<string, string | undefined> = process.env,
  platform: NodeJS.Platform = process.platform,
): string {
  const explicit = env.ADB?.trim();
  if (explicit) {
    return explicit;
  }
  const sdk = env.ANDROID_HOME?.trim() || env.ANDROID_SDK_ROOT?.trim();
  const found = [
    sdk ? join(sdk, 'platform-tools', platform === 'win32' ? 'adb.exe' : 'adb') : '',
    platform === 'win32' && env.LOCALAPPDATA
      ? join(env.LOCALAPPDATA, 'Android', 'Sdk', 'platform-tools', 'adb.exe')
      : '',
  ]
    .filter((candidate) => candidate !== '')
    .find((candidate) => existsSync(candidate));
  return found ?? 'adb';
}

/** 默认执行器：`windowsHide` 免得每次轮询闪一个黑框，单次调用按 10 秒算超时。 */
export function createAdbRunner(adbPath: string): CommandRunner {
  return async (args) =>
    new Promise<CommandResult>((resolve) => {
      execFile(adbPath, args, { windowsHide: true, timeout: 10_000 }, (error, stdout, stderr) => {
        if (error) {
          resolve({ ok: false, stdout: stdout ?? '', message: (stderr ?? '').trim() || error.message });
          return;
        }
        resolve({ ok: true, stdout: stdout ?? '', message: '' });
      });
    });
}

/** 看一眼映射在不在，不在就接一次。任何一步失败都只回报结果，不抛异常。 */
export async function ensureAdbReverse(options: AdbReverseOptions): Promise<ReverseAttempt> {
  const run = options.run ?? createAdbRunner(options.adbPath ?? resolveAdbPath());
  const listed = await run(['reverse', '--list']);
  if (!listed.ok) {
    return { outcome: 'unavailable', detail: truncate(listed.message) };
  }
  if (hasReverseMapping(listed.stdout, options.port)) {
    return { outcome: 'ready', detail: '' };
  }
  const created = await run(['reverse', `tcp:${options.port}`, `tcp:${options.port}`]);
  if (created.ok) {
    return { outcome: 'mapped', detail: '' };
  }
  const detail = truncate(created.message);
  return { outcome: NO_DEVICE_PATTERN.test(created.message) ? 'no-device' : 'unavailable', detail };
}

/**
 * 起一个轮询：立刻接一次，之后按状态选间隔重试，**只在状态变化时**打日志。
 *
 * 返回停止函数（单测收尾、或进程退出时用）。定时器 `unref()`，不挡进程退出。
 */
export function watchAdbReverse(options: WatchAdbReverseOptions): () => void {
  const log = options.log ?? ((message: string) => console.log(message));
  const fastMs = options.fastMs ?? REVERSE_POLL_FAST_MS;
  const slowMs = options.slowMs ?? REVERSE_POLL_SLOW_MS;
  let last: ReverseOutcome | undefined;
  let stopped = false;
  let timer: NodeJS.Timeout | undefined;

  // 两个函数互相调用（接完再排下一次），用函数声明省掉顺序问题。
  function schedule(outcome: ReverseOutcome): void {
    if (stopped) {
      return;
    }
    const delay = outcome === 'ready' || outcome === 'mapped' ? fastMs : slowMs;
    timer = setTimeout(() => void tick(), delay);
    timer.unref();
  }

  async function tick(): Promise<void> {
    const attempt = await ensureAdbReverse(options).catch((): ReverseAttempt => ({
      outcome: 'unavailable',
      detail: '',
    }));
    if (attempt.outcome !== last) {
      log(describeAttempt(attempt, options.port));
      last = attempt.outcome;
    }
    schedule(attempt.outcome);
  }

  void tick();
  return () => {
    stopped = true;
    if (timer) {
      clearTimeout(timer);
    }
  };
}

/** 一行中文说明；失败时带上 adb 的原话，方便一眼看出是没设备还是没装 adb。 */
function describeAttempt(attempt: ReverseAttempt, port: number): string {
  switch (attempt.outcome) {
    case 'ready':
      return `设备 → 本机 tcp:${port} 已接通（adb reverse），应用里的 127.0.0.1:${port} 可以访问后端。`;
    case 'mapped':
      return `已接通设备 tcp:${port} → 本机 tcp:${port}（adb reverse）；映射丢了会自动补回来。`;
    case 'no-device':
      return `还没检测到模拟器/真机：设备一连上就会自动接通 tcp:${port}，不必再手动跑 adb reverse。`;
    default:
      return `adb 不可用，无法自动接通 tcp:${port}（可手动运行 adb reverse tcp:${port} tcp:${port}）：${attempt.detail || '未知原因'}`;
  }
}

function truncate(message: string): string {
  const oneLine = message.replace(/\s+/g, ' ').trim();
  return oneLine.length > 200 ? `${oneLine.slice(0, 200)}…` : oneLine;
}
