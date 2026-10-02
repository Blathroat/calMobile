/// <reference types="vite/client" />

/**
 * 全局类型声明：这里只声明「运行时由外部注入、TS 看不见」的东西，没有可执行代码。
 *
 * `window.CalMobileStrings` 由原生 `InjectStrings` 注入，不在模块图里。
 * 浏览器预览与单测不一定注入文案，读取时要判空。
 */
declare global {
  /** 原生注入的前端文案表：key（`s_xxx`）→ 文案；浏览器里是 undefined，见 `i18n/index.ts`。 */
  interface Window {
    CalMobileStrings?: Record<string, string>;
  }
}

// 文件里有 import / export 才算模块，模块里的 `declare global` 才生效；无运行时代码。
export {};
