import { describe, expect, it } from 'vitest';
import type { ExhibitionDetail } from '@/api/types';
import { FIELD_TYPE, EXHIBITION_STATUS, REGISTRATION_MODES } from '@/services/status';
import type { ExhibitionDraft } from '@/services/exhibition-draft';
import {
  emptyExhibitionFormModel,
  exhibitionContentFromDraft,
  exhibitionContentFromServer,
  submittedExhibitionData,
} from './exhibition-form-model';

describe('展会表单模型', () => {
  it('新建表单使用稳定的空值和默认状态', () => {
    expect(emptyExhibitionFormModel()).toEqual({
      title: '',
      venue: '',
      date: '',
      endDate: '',
      time: '',
      status: EXHIBITION_STATUS.REVIEW_REQUIRED,
      category: '',
      description: '',
      imageUri: '',
      registrationStart: '',
      registrationEnd: '',
      qrEnabled: false,
      allowCancel: true,
      registrationNotice: '',
    });
  });

  it('服务器详情映射保留旧分类并兼容逗号分隔的收集项', () => {
    const detail = {
      fields: [
        { title: '公司', type: FIELD_TYPE.TEXT, required: true },
        { title: '规模', type: 'choice', required: false, options: '小型, 中型,, 大型' },
      ],
    } as unknown as ExhibitionDetail;
    const content = exhibitionContentFromServer(
      { statusCode: REGISTRATION_MODES[0], category: '已移除分类', allowCancel: false },
      detail,
    );

    expect(content.model.category).toBe('已移除分类');
    expect(content.model.status).toBe(REGISTRATION_MODES[0]);
    expect(content.model.allowCancel).toBe(false);
    expect(content.fields).toEqual([
      { title: '公司', type: FIELD_TYPE.TEXT, required: true, options: [] },
      { title: '规模', type: 'choice', required: false, options: ['小型', '中型', '大型'] },
    ]);
  });

  it('草稿缺少新增字段时补默认值并复制收集项', () => {
    const draft = {
      id: 'exh-1',
      title: '草稿展会',
      venue: '展馆',
      date: '2026-12-01',
      time: '',
      status: 'unknown',
      category: '智能家居',
      description: '',
      imageUri: '',
      registrationStart: '',
      registrationEnd: '',
      qrEnabled: false,
      allowCancel: true,
      fields: [{ title: '规模', type: 'choice', required: false, options: ['小型'] }],
    } satisfies ExhibitionDraft;

    const content = exhibitionContentFromDraft(draft);
    content.fields[0]!.options.push('大型');

    expect(content.model.endDate).toBe('');
    expect(content.model.registrationNotice).toBe('');
    expect(content.model.status).toBe(EXHIBITION_STATUS.REVIEW_REQUIRED);
    expect(draft.fields[0]!.options).toEqual(['小型']);
  });

  it('保存字段同时用于请求与未保存基线', () => {
    const model = {
      ...emptyExhibitionFormModel(),
      title: '  展会  ',
      venue: ' 展馆 ',
      time: ' 09:00-17:00 ',
      category: ' 智能家居 ',
      registrationNotice: ' 携带证件 ',
    };
    const submitted = submittedExhibitionData(model, [
      { title: ' 姓名 ', type: FIELD_TYPE.TEXT, required: true, options: ['忽略'] },
      { title: '   ', type: 'choice', required: false, options: ['忽略'] },
      { title: ' 规模 ', type: 'choice', required: false, options: [' 小型 ', ' ', ' 中型'] },
    ]);

    expect(submitted).toMatchObject({
      title: '展会',
      venue: '展馆',
      time: '09:00-17:00',
      category: '智能家居',
      registrationNotice: '携带证件',
      descriptionFormat: 'md',
      fields: [
        { title: '姓名', type: FIELD_TYPE.TEXT, required: true, options: [] },
        { title: '规模', type: 'choice', required: false, options: ['小型', '中型'] },
      ],
    });
  });
});
