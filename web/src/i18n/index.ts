export function t(key: string, fallback = key): string {
  return window.CalMobileStrings?.[key] ?? fallback;
}
