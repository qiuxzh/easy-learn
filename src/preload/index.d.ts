import { api } from './api';

declare global {
  interface Window {
    api: typeof api;
  }
}

type API = typeof api;
export type { API };
