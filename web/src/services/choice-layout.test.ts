import { describe, expect, it } from 'vitest';
import { choiceNeedsStack } from './choice-layout';

describe('单选是否改为每项一行', () => {
  it('均分后每一项都能单行放下时保持横排', () => {
    expect(choiceNeedsStack([40, 40, 40], 200, 8)).toBe(false);
  });

  it('有一项放不进均分的格子时改为竖排', () => {
    expect(choiceNeedsStack([40, 80, 40], 200, 8)).toBe(true);
  });

  it('刚好放下时不改为竖排，多一个像素就改', () => {
    const slot = (200 - 16) / 3;
    expect(choiceNeedsStack([slot, slot, slot], 200, 8)).toBe(false);
    expect(choiceNeedsStack([slot + 1, slot, slot], 200, 8)).toBe(true);
  });

  it('只有一项或容器还没宽度时不改为竖排', () => {
    expect(choiceNeedsStack([400], 120, 8)).toBe(false);
    expect(choiceNeedsStack([40, 40], 0, 8)).toBe(false);
  });
});
