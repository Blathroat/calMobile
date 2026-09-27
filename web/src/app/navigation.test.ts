import { describe, expect, it } from 'vitest';
import { navigation } from './navigation';

describe('navigation coordinator', () => {
  it('aborts the previous scope and marks only the latest current', () => {
    const first = navigation.begin();
    const second = navigation.begin();
    expect(first.signal.aborted).toBe(true);
    expect(first.isCurrent()).toBe(false);
    expect(second.isCurrent()).toBe(true);
  });
});
