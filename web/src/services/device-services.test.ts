import { describe, expect, it, vi } from 'vitest';
import { device } from './device-services';
import { nativeBridge } from './native-bridge';

describe('device services', () => {
  it('keeps device action names behind a typed service', async () => {
    const spy = vi.spyOn(nativeBridge, 'call').mockResolvedValue({ saved: true } as never);
    await device.calendarStatus('2026-09-20');
    expect(spy).toHaveBeenCalledWith('calendar.status', { date: '2026-09-20' });
    spy.mockRestore();
  });
});
