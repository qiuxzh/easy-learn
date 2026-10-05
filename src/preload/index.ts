import { contextBridge } from 'electron';
import { electronAPI } from '@electron-toolkit/preload';
import { api } from './api';

if (process.contextIsolated) {
  try {
    contextBridge.exposeInMainWorld('electronApi', electronAPI);
    contextBridge.exposeInMainWorld('api', api);
  } catch (error) {
    console.error(error);
  }
} else {
  // @ts-expect-error: fallback for non-isolated context
  window.electron = electronAPI;
  window.api = api;
}
