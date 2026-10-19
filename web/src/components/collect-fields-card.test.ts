import { afterEach, describe, expect, it } from 'vitest';
import { createApp, nextTick, type App } from 'vue';
import CollectFieldsCard, { type CollectField } from './CollectFieldsCard.vue';

let app: App | undefined;

afterEach(() => {
  app?.unmount();
  app = undefined;
  document.body.innerHTML = '';
});

function mount(fields: CollectField[], extra: { hint?: string; radioMax?: number; checkMax?: number } = {}): void {
  document.body.innerHTML = '<div id="collect-test"></div>';
  app = createApp(CollectFieldsCard, {
    fields,
    label: '报名收集项',
    // 不传 hint 时不带这个 prop，验证「可选」这一档。
    hint: 'hint' in extra ? extra.hint : '卡片说明小字',
    titleMax: 40,
    radioMax: extra.radioMax,
    checkMax: extra.checkMax,
  });
  app.mount('#collect-test');
}

function typeButton(label: string): HTMLButtonElement {
  const button = [...document.querySelectorAll<HTMLButtonElement>('.seg button')].find(
    (item) => item.textContent?.trim() === label,
  );
  if (!button) throw new Error(`找不到类型按钮 ${label}`);
  return button;
}

describe('报名收集项编辑卡', () => {
  it('类型是滑动分段，切到单选只留一个空选项', async () => {
    const fields: CollectField[] = [{ title: '称呼', type: 'text', required: false, options: [] }];
    mount(fields);
    expect([...document.querySelectorAll('.seg button')].map((button) => button.textContent?.trim())).toEqual([
      '文本',
      '单选',
      '多选',
    ]);
    typeButton('单选').click();
    await nextTick();
    expect(fields[0]?.type).toBe('radio');
    expect(fields[0]?.options).toEqual(['']);
    expect(document.body.textContent).not.toContain('至少写下两个选项');
  });

  it('已经有一个选项时，改成多选不会再补一格', async () => {
    const fields: CollectField[] = [{ title: '来源', type: 'radio', required: true, options: ['朋友'] }];
    mount(fields);
    expect(document.querySelectorAll('.option-input')).toHaveLength(1);
    typeButton('多选').click();
    await nextTick();
    expect(fields[0]?.type).toBe('checkbox');
    expect(fields[0]?.options).toEqual(['朋友']);
  });

  it('说明文案为空或没传时不渲染那段小字，传了仍照旧显示', async () => {
    mount([], { hint: '' });
    expect(document.body.textContent).not.toContain('卡片说明小字');
    // 只剩下「还没有收集项」这一条提示。
    expect(document.querySelectorAll('.card > .field-hint')).toHaveLength(1);

    app?.unmount();
    mount([]);
    await nextTick();
    expect(document.querySelectorAll('.card > .field-hint')).toHaveLength(2);
    expect(document.body.textContent).toContain('卡片说明小字');

    app?.unmount();
    mount([], { hint: undefined });
    await nextTick();
    expect(document.body.textContent).not.toContain('卡片说明小字');
    expect(document.querySelectorAll('.card > .field-hint')).toHaveLength(1);
  });

  it('单选和多选的选项输入使用各自的字数上限', async () => {
    const radio: CollectField[] = [{ title: '来源', type: 'radio', required: false, options: ['友'] }];
    mount(radio, { radioMax: 4, checkMax: 8 });
    expect(document.querySelector<HTMLInputElement>('.option-input')?.maxLength).toBe(4);
    const check: CollectField[] = [{ title: '需求', type: 'checkbox', required: false, options: ['车'] }];
    app?.unmount();
    mount(check, { radioMax: 4, checkMax: 8 });
    await nextTick();
    expect(document.querySelector<HTMLInputElement>('.option-input')?.maxLength).toBe(8);
  });
});
