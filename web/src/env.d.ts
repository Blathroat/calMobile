/// <reference types="vite/client" />

declare global {
  interface Window {
    CalMobileStrings?: Record<string, string>;
  }
  const jsQR: ((data: Uint8ClampedArray, width: number, height: number) => { data: string } | null) | undefined;
}

export {};
