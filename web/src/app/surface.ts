/**
 * 当前前端是 App 还是浏览器报名站。
 *
 * `VITE_SURFACE=join` 只在报名站构建里设置。App 构建不定义它，下面的判断在打包时
 * 就是常量，报名站专有的分支不会进 APK。
 */
export const isJoinSurface = import.meta.env.VITE_SURFACE === 'join';

export interface SurfacePaths {
  /** 登录成功、以及「没有别的地方可去」时的落点。 */
  home: string;
  registrations: string;
  /** 展会详情。应用里要求登录；报名站的分享链接先落到这里（未登录也能看）。 */
  exhibitionDetail: (id: string) => string;
  /** 报名信息表单。报名站是详情页里的「立即报名」，未登录也能进。 */
  registrationForm: (id: string) => string;
  registrationDetail: (id: string) => string;
  /**
   * 未登录报名后的状态页。凭据在 query（`?token=`），所以页面自己拼 query；
   * 应用里没有这一屏，指向自己的报名详情。
   */
  registrationStatus: (id: string) => string;
  meetingDetail: (id: string) => string;
  meetingApply: (id: string) => string;
}

/** 两套路径。测试直接传入 `join`，页面用下面的 `paths`。 */
export function surfacePaths(join: boolean): SurfacePaths {
  if (!join) {
    const registrationDetail = (id: string) => `/registration-detail/${encodeURIComponent(id)}`;
    return {
      home: '/home',
      registrations: '/my-registrations',
      exhibitionDetail: (id) => `/detail/${encodeURIComponent(id)}`,
      registrationForm: (id) => `/registration-form/${encodeURIComponent(id)}`,
      registrationDetail,
      registrationStatus: registrationDetail,
      meetingDetail: (id) => `/meeting-detail/${encodeURIComponent(id)}`,
      meetingApply: (id) => `/meeting-apply/${encodeURIComponent(id)}`,
    };
  }
  return {
    home: '/mine',
    registrations: '/mine',
    // 分享链接 `/e/:id` 先给详情，报名表单在下一层：未登录也能报名。
    exhibitionDetail: (id) => `/e/${encodeURIComponent(id)}`,
    registrationForm: (id) => `/e/${encodeURIComponent(id)}/register`,
    registrationDetail: (id) => `/mine/${encodeURIComponent(id)}`,
    registrationStatus: (id) => `/e/${encodeURIComponent(id)}/status`,
    meetingDetail: (id) => `/mine/m/${encodeURIComponent(id)}`,
    meetingApply: (id) => `/m/${encodeURIComponent(id)}`,
  };
}

export const paths = surfacePaths(isJoinSurface);
