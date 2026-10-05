declare global {
  interface ImportMeta {
    hot?: {
      dispose(callback: () => void): void;
    };
  }

  interface Window {
    api: typeof import('../../preload/api').api;
  }
}

export {};
