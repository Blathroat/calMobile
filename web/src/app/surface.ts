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
  registrationForm: (id: string) => string;
  registrationDetail: (id: string) => string;
}

/** 两套路径。测试直接传入 `join`，页面用下面的 `paths`。 */
export function surfacePaths(join: boolean): SurfacePaths {
  if (!join) {
    return {
      home: '/home',
      registrations: '/my-registrations',
      registrationForm: (id) => `/registration-form/${encodeURIComponent(id)}`,
      registrationDetail: (id) => `/registration-detail/${encodeURIComponent(id)}`,
    };
  }
  return {
    home: '/mine',
    registrations: '/mine',
    registrationForm: (id) => `/e/${encodeURIComponent(id)}`,
    registrationDetail: (id) => `/mine/${encodeURIComponent(id)}`,
  };
}

export const paths = surfacePaths(isJoinSurface);
