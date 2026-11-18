/**
 * 运行时品牌配置。
 *
 * 同一份运行时包会被部署到不同域名（`PUBLIC_BASE_URL`），页面包本身不再写域名；
 * 但 PWA 名称、页面标题和图标仍可能因实例而异。这些值不是构建期变量：服务启动时
 * 从这里读出来，由 `server/src/server/runtime-web.ts` 生成一份实例专属的页面层。
 *
 * 解析保持纯函数，构建期 `web/.env` / 进程环境里的同名 `PWA_*` / `APP_ICON`
 * 仍可作为静态产物兜底；服务器运行环境里非空的值优先。
 *
 * 两个边界：
 * - 这里只做文本、长度、颜色和布尔解析，不读磁盘、不生成图片；
 * - 写进 HTML 前必须转义，写进 `<script>` 的 JSON 必须防 `</script>`，由运行时层负责。
 */

import { bool } from './runtime.js';

export type EnvLike = NodeJS.ProcessEnv | Record<string, string | undefined>;

/** 下发给页面的品牌信息；空字段不写进 `bootstrap.branding`。 */
export interface ClientBranding {
  appName?: string;
  shortName?: string;
  description?: string;
  appTitle?: string;
  joinTitle?: string;
  lang?: string;
  themeColor?: string;
  themeColorDark?: string;
  backgroundColor?: string;
}

/** 服务端启动时用到的完整品牌配置。`active` 字段决定是否值得生成运行时页面层。 */
export interface BrandingConfig {
  appName: string;
  shortName: string;
  description: string;
  appTitle: string;
  joinTitle: string;
  lang: string;
  themeColor: string;
  themeColorDark: string;
  backgroundColor: string;
  /** 应用图标源图；相对路径按运行时包根解析，建议写绝对路径。 */
  icon: string;
  /** 非透明图标/留白的底色；只有同时配置 `icon` 或 `iconDir` 时生效。 */
  iconBackground: string;
  /** 透明图标模式：生成透明 PNG/ICO，Android 侧不生成 adaptive 图标；需要图标源。 */
  iconTransparent: boolean;
  /** 预生成图标目录；相对路径按运行时包根解析；与 `APP_ICON` 二选一。 */
  iconDir: string;
  /** 应用页面（标题 / manifest / 图标）有任何需要运行时覆盖的内容。 */
  appActive: boolean;
  /** 报名站标题需要运行时覆盖。 */
  joinActive: boolean;
  /** `index.html` 的标题或 meta 需要改。 */
  indexActive: boolean;
  /** `manifest.webmanifest` 需要改。 */
  manifestActive: boolean;
  /** 解析期的非致命问题；启动自检会打进 warning。 */
  warnings: string[];
}

const COLOR_PATTERN = /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i;
const LANG_PATTERN = /^[A-Za-z]{2,3}(?:-[A-Za-z0-9]{2,8})*$/;

/** 标题/名称只保留单行：换行会把 HTML 属性或 PWA 名称弄坏。 */
function oneLine(value: unknown): string {
  return String(value ?? '')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * 解析运行时品牌配置（纯函数，用例直接喂环境对象）。
 *
 * 空值一律返回空串，由页面产物里的构建期默认值兜底；服务端不在这里补 `zh.json`
 * 的中文，因为运行时包不带 `web/src`。
 */
export function resolveBranding(env: EnvLike = {}): BrandingConfig {
  const warnings: string[] = [];

  const appName = oneLine(env.PWA_APP_NAME);
  const shortName = oneLine(env.PWA_APP_SHORT_NAME);
  const description = oneLine(env.PWA_APP_DESCRIPTION);
  const appTitle = oneLine(env.APP_TITLE);
  const joinTitle = oneLine(env.JOIN_TITLE);
  const rawLang = oneLine(env.PWA_LANG);
  const lang = rawLang && LANG_PATTERN.test(rawLang) ? rawLang : '';
  if (rawLang && !lang) warnings.push(`PWA_LANG 不是合法的语言标签，已忽略：${rawLang}`);

  const color = (name: string): string => {
    const value = oneLine(env[name]);
    if (!value) return '';
    if (!COLOR_PATTERN.test(value)) {
      warnings.push(`${name} 不是十六进制颜色，已忽略：${value}`);
      return '';
    }
    return value;
  };
  const themeColor = color('PWA_THEME_COLOR');
  const themeColorDark = color('PWA_THEME_COLOR_DARK');
  const backgroundColor = color('PWA_BACKGROUND_COLOR');
  const iconBackground = color('APP_ICON_BACKGROUND');

  const icon = oneLine(env.APP_ICON);
  const iconDir = oneLine(env.PWA_ICON_DIR);
  const iconTransparent = bool(env.APP_ICON_TRANSPARENT);
  if (icon && iconDir) {
    warnings.push('APP_ICON 与 PWA_ICON_DIR 同时配置，运行时使用 PWA_ICON_DIR');
  }

  if (appName.length > 60) warnings.push(`PWA_APP_NAME 超过 60 个字符，主屏幕名称可能被截断`);
  if (shortName.length > 24) warnings.push(`PWA_APP_SHORT_NAME 超过 24 个字符，iOS 主屏幕会截断`);
  if (description.length > 300) warnings.push('PWA_APP_DESCRIPTION 超过 300 个字符，建议精简');
  if (appTitle.length > 80) warnings.push('APP_TITLE 超过 80 个字符，建议精简');
  if (joinTitle.length > 40) warnings.push('JOIN_TITLE 超过 40 个字符，报名站页签会截断');

  const indexActive = Boolean(appTitle || appName || shortName || description || themeColor || themeColorDark);
  const manifestActive = Boolean(appName || shortName || description || lang || themeColor || backgroundColor);
  const appActive = Boolean(indexActive || manifestActive || icon || iconDir);
  const joinActive = Boolean(joinTitle);

  return {
    appName,
    shortName,
    description,
    appTitle,
    joinTitle,
    lang,
    themeColor,
    themeColorDark,
    backgroundColor,
    icon,
    iconBackground,
    iconTransparent,
    iconDir,
    appActive,
    joinActive,
    indexActive,
    manifestActive,
    warnings,
  };
}

/** 只把有值的部分下发给页面；`bootstrap.branding` 与注入脚本共用这一份。 */
export function clientBranding(config: BrandingConfig): ClientBranding {
  const out: ClientBranding = {};
  if (config.appName) out.appName = config.appName;
  if (config.shortName) out.shortName = config.shortName;
  if (config.description) out.description = config.description;
  if (config.appTitle) out.appTitle = config.appTitle;
  if (config.joinTitle) out.joinTitle = config.joinTitle;
  if (config.lang) out.lang = config.lang;
  if (config.themeColor) out.themeColor = config.themeColor;
  if (config.themeColorDark) out.themeColorDark = config.themeColorDark;
  if (config.backgroundColor) out.backgroundColor = config.backgroundColor;
  return out;
}
