import type { JsonObject } from '@/api/types';

const OUTCOMES_PREFIX = 'calmobile.checkin.outcomes.';
export const MAX_CHECKIN_OUTCOMES = 20;

export interface CheckInOutcome {
  id: string;
  ok: boolean;
  statusText: string;
  message: string;
  record: JsonObject;
}

export function checkinOutcomesKey(userId: unknown): string {
  return `${OUTCOMES_PREFIX}${String(userId ?? '') || 'anonymous'}`;
}

/** 逐条跳过损坏记录，避免一条旧数据让整份历史都不可见。 */
export function readCheckinOutcomes(userId: unknown): CheckInOutcome[] {
  let raw: string | null = null;
  try {
    raw = typeof window === 'undefined' ? null : (window.localStorage?.getItem(checkinOutcomesKey(userId)) ?? null);
  } catch {
    return [];
  }
  if (!raw) return [];

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];

  const outcomes: CheckInOutcome[] = [];
  for (const value of parsed) {
    const outcome = normalizeOutcome(value, outcomes.length);
    if (outcome) outcomes.push(outcome);
    if (outcomes.length >= MAX_CHECKIN_OUTCOMES) break;
  }
  return outcomes;
}

export function persistCheckinOutcomes(userId: unknown, outcomes: readonly CheckInOutcome[]): void {
  try {
    const storage = typeof window === 'undefined' ? undefined : window.localStorage;
    if (!storage) return;
    const key = checkinOutcomesKey(userId);
    if (outcomes.length === 0) storage.removeItem(key);
    else storage.setItem(key, JSON.stringify(outcomes.slice(0, MAX_CHECKIN_OUTCOMES)));
  } catch {
    // 本机存储不可用或已满时，内存里的历史仍可继续使用。
  }
}

function normalizeOutcome(value: unknown, index: number): CheckInOutcome | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const raw = value as Record<string, unknown>;
  const record = raw.record;
  if (!record || typeof record !== 'object' || Array.isArray(record)) return null;
  return {
    id: typeof raw.id === 'string' && raw.id ? raw.id : `restored-${index}`,
    ok: raw.ok === true,
    statusText: String(raw.statusText ?? ''),
    message: String(raw.message ?? ''),
    record: record as JsonObject,
  };
}
