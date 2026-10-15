import { afterEach, describe, expect, it } from 'vitest';
import { createApp, nextTick, type App } from 'vue';
import CollectFieldsCard, { type CollectField } from './CollectFieldsCard.vue';

let app: App | undefined;

afterEach(() => {
  app?.unmount();
  app = undefined;
  document.body.innerHTML = '';
});

function mount(fields: CollectField[]): void {
  document.body.innerHTML = '<div id="collect-test"></div>';
  app = createApp(CollectFieldsCard, {
    fields,
    label: '报名收集项',
    hint: '报名的人会按这些问题填写',
    titleMax: 40,
  });
  app.mount('#collect-test');
}

function typeButton(label: string): HTMLButtonElement {
  const button = [...document.querySelectorAll<HTMLButtonElement>('.seg button')]
    .find((item) => item.textContent?.trim() === label);
  if (!button) throw new Error(`找不到类型按钮 ${label}`);
  return button;
}

describe('报名收集项编辑卡', () => {
  it('类型是滑动分段，切到单选只留一个空选项', async () => {
    const fields: CollectField[] = [{ title: '称呼', type: '文本', required: false, options: [] }];
    mount(fields);
    expect([...document.querySelectorAll('.seg button')].map((button) => button.textContent?.trim()))
      .toEqual(['文本', '单选', '多选']);
    typeButton('单选').click();
    await nextTick();
    expect(fields[0]?.type).toBe('单选');
    expect(fields[0]?.options).toEqual(['']);
    expect(document.body.textContent).not.toContain('至少写下两个选项');
  });

  it('已经有一个选项时，改成多选不会再补一格', async () => {
    const fields: CollectField[] = [{ title: '来源', type: '单选', required: true, options: ['朋友'] }];
    mount(fields);
    expect(document.querySelectorAll('.option-input')).toHaveLength(1);
    typeButton('多选').click();
    await nextTick();
    expect(fields[0]?.type).toBe('多选');
    expect(fields[0]?.options).toEqual(['朋友']);
  });
});
