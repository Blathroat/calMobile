/**
 * 应用外壳的派生规则：底部导航项、内容区密度、顶栏标题。
 *
 * 外壳（`.app` / `.topbar` / `.app-body` / `.tabbar`）只在这里和 `App.vue` 里描述一次，
 * 页面只提供内容。布局的类名与 `styles/tokens.css`、`styles/motion.css` 一一对应，
 * 页面不再自己拼 `.page` 这类旧容器的类名。
 */
import { t } from '@/i18n';
import { isJoinSurface, paths } from '@/app/surface';

export interface TabItem {
  /** 路由 id，与 `router.ts` 的路径一致 */
  id: string;
  path: string;
  label: string;
  icon: string;
}

/** 内容区的间距：默认 `--s4`（12px）。`tight` 用 `--s3`，目前也是 12px。 */
export type BodyGap = 'default' | 'tight';

export interface ShellMeta {
  title?: string;
  back?: boolean;
  tab?: string;
  bodyGap?: BodyGap;
  bodyPad?: 'none';
  bodyAlign?: 'center';
}

/**
 * 底部导航项，按角色过滤（与旧版 MainActivity 的标签可见性一致）：
 * 首页与我的活动人人可见，展商后台与管理后台只在后端明确下发能力时出现，
 * 个人页固定在最后。
 */
export function tabItems(can: Record<string, boolean> | undefined): TabItem[] {
  if (isJoinSurface) {
    return [{ id: 'my-registrations', path: paths.registrations, label: t('registration.list.title'), icon: 'ticket' }];
  }
  const items: TabItem[] = [
    { id: 'home', path: '/home', label: t('nav.home'), icon: 'home' },
    { id: 'my-registrations', path: '/my-registrations', label: t('registration.list.title'), icon: 'ticket' },
  ];
  if (can?.exhibitor) {
    items.push({ id: 'exhibitor', path: '/exhibitor', label: t('nav.exhibitor'), icon: 'briefcase' });
  }
  if (can?.admin) {
    items.push({ id: 'admin', path: '/admin', label: t('nav.admin'), icon: 'shield' });
  }
  items.push({ id: 'profile', path: '/profile', label: t('nav.profile'), icon: 'user' });
  return items;
}

/** 内容区属性：只在 meta 明确要求时输出，其余交给 tokens.css 的默认值。 */
export function bodyAttrs(meta: ShellMeta): Record<string, string> {
  const attrs: Record<string, string> = {};
  if (meta.bodyPad === 'none') attrs['data-pad'] = 'none';
  if (meta.bodyGap === 'tight') attrs['data-gap'] = 'tight';
  if (meta.bodyAlign === 'center') attrs['data-align'] = 'center';
  return attrs;
}
