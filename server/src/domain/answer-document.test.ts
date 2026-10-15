import assert from 'node:assert/strict';
import { answerDocument, type AnswerField } from './answer-document.js';

const fields: AnswerField[] = [
  { title: '姓名', type: '文本', required: true },
  { title: '参观身份', type: '单选', required: true, options: ['专业观众', '媒体'] },
  { title: '报名需求', type: '多选', required: false, options: ['停车位', '翻译服务'] },
];

const limits = { textFill: 20, answer: 200 };

test('没有收集项时按行解码，空项变成空字符串，原文不改写', () => {
  const text = '姓名：未填写\n备注:有\n孤儿行';
  const result = answerDocument({ source: { text } });
  assert.deepEqual(result.lines, [
    { label: '姓名', value: '' },
    { label: '备注', value: '有' },
    { label: '', value: '孤儿行' },
  ]);
  assert.equal(result.text, text);
  assert.deepEqual(result.values, {});
  assert.deepEqual(result.problems, []);
  assert.equal(result.message, '');
});

test('空白原文没有展示行', () => {
  assert.deepEqual(answerDocument({ source: { text: '  \n' } }).lines, []);
});

test('按字段编码：空项写成未填写，多选用顿号', () => {
  const result = answerDocument({
    fields,
    source: { values: { 姓名: '张三', 参观身份: '媒体', 报名需求: ['翻译服务', '停车位'] } },
    limits,
  });
  assert.equal(result.text, '姓名：张三\n参观身份：媒体\n报名需求：翻译服务、停车位');
  assert.equal(result.message, '');
  assert.deepEqual(result.lines[2], { label: '报名需求', value: '翻译服务、停车位' });
});

test('回填认全角半角冒号、顿号和逗号，整项未填写当空', () => {
  const result = answerDocument({
    fields,
    source: { text: '姓名:张三\n参观身份：媒体\n报名需求：停车位,翻译服务' },
  });
  assert.equal(result.values['姓名'], '张三');
  assert.equal(result.values['参观身份'], '媒体');
  assert.deepEqual(result.values['报名需求'], ['停车位', '翻译服务']);
  assert.equal(result.text, '姓名：张三\n参观身份：媒体\n报名需求：停车位、翻译服务');

  const blank = answerDocument({
    fields,
    source: { text: '姓名：张三\n参观身份：媒体\n报名需求：未填写' },
  });
  assert.deepEqual(blank.values['报名需求'], []);
});

test('同一标题取第一行', () => {
  const result = answerDocument({
    fields: [{ title: '姓名', type: '文本' }],
    source: { text: '姓名：第一\n姓名：第二' },
  });
  assert.equal(result.values['姓名'], '第一');
});

test('必填、超长和非法选项一起返回，接口句子用第一个字段错误', () => {
  const result = answerDocument({
    fields,
    source: { values: { 姓名: '  ', 参观身份: '同行人员', 报名需求: ['停车位', '接送机'] } },
    limits: { textFill: 2, answer: 1 },
  });
  assert.deepEqual(
    result.problems.map((problem) => problem.title),
    ['姓名', '参观身份', '报名需求', undefined],
  );
  assert.equal(result.problems[0]?.message, '请填写「姓名」');
  assert.equal(result.problems[1]?.message, '「参观身份」只能选择：专业观众 / 媒体');
  assert.equal(result.problems[2]?.message, '「报名需求」只能选择：停车位 / 翻译服务');
  assert.equal(result.problems[3]?.message, '整段报名内容最多 1 个字符');
  assert.equal(result.message, '请填写「姓名」');
});

test('文本超长，单选的长选项不按文本框填写计算', () => {
  const result = answerDocument({
    fields: [
      { title: '来意', type: '文本', required: true },
      { title: '身份', type: '单选', required: true, options: ['专业观众'] },
    ],
    source: { values: { 来意: '超过啦', 身份: '专业观众' } },
    limits: { textFill: 2, answer: 200 },
  });
  assert.equal(result.message, '「来意」最多 2 个字符');
});

test('字段都通过时，整段超长单独成为接口句子', () => {
  const result = answerDocument({
    fields: [{ title: '来意', type: '文本', required: false }],
    source: { values: { 来意: '好' } },
    limits: { textFill: 20, answer: 1 },
  });
  assert.equal(result.message, '整段报名内容最多 1 个字符');
  assert.equal(result.problems[0]?.title, undefined);
});

test('选填多选的未填写不是非法选项，纯空白写成未填写', () => {
  const result = answerDocument({
    fields,
    source: { values: { 姓名: '张三', 参观身份: '媒体', 报名需求: '未填写' } },
    limits,
  });
  assert.deepEqual(result.values['报名需求'], []);
  assert.equal(result.text, '姓名：张三\n参观身份：媒体\n报名需求：未填写');
  assert.equal(result.message, '');
});

test('没有选项列表时不检查成员；逗号分隔的选项字符串可用', () => {
  const open = answerDocument({
    fields: [{ title: '身份', type: '单选', options: [] }],
    source: { values: { 身份: '占位' } },
    limits,
  });
  assert.equal(open.message, '');
  const listed = answerDocument({
    fields: [{ title: '身份', type: '单选', required: true, options: '专业观众,媒体' }],
    source: { values: { 身份: '媒体' } },
    limits,
  });
  assert.equal(listed.message, '');
});

test('没有收集项时忽略上限', () => {
  const result = answerDocument({ source: { text: '来意：超过啦' }, limits: { textFill: 1, answer: 1 } });
  assert.equal(result.message, '');
  assert.equal(result.lines[0]?.value, '超过啦');
});
