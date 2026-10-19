import { describe, expect, it } from 'vitest';
import { collectFieldError } from './collect-fields';

const bounds = { title: 4, radio: 2, check: 2 };

describe('收集项长度', () => {
  it('标题、单选选项和多选选项分别拦住', () => {
    expect(collectFieldError({ title: '标题太长了', type: 'text', options: [] }, bounds)).toBe(
      '文本框标题最多 4 个字符',
    );
    expect(collectFieldError({ title: '来源', type: 'radio', options: ['朋友们'] }, bounds)).toBe(
      '单选选项最多 2 个字符',
    );
    expect(collectFieldError({ title: '需求', type: 'checkbox', options: ['停车位'] }, bounds)).toBe(
      '多选选项最多 2 个字符',
    );
  });

  it('没超限时不报错', () => {
    expect(collectFieldError({ title: '来源', type: 'radio', options: ['友'] }, bounds)).toBe('');
    expect(collectFieldError({ title: '称呼', type: 'text', options: ['忽略'] }, bounds)).toBe('');
  });
});
