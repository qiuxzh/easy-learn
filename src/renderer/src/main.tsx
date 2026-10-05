import React from 'react';
import ReactDOM from 'react-dom/client';
import { TooltipProvider } from '@/components/ui/tooltip';
import { initReadingStateSync } from '@/utils/reading-state-sync';
import { ensureChatStreamControllerInitialized } from '@/stores/chat-stream-controller';
import { useConfigStore } from '@/stores/config-store';
import { App } from './App';
import './index.css';

initReadingStateSync();
// 会话事件必须常驻监听：会话在后台运行时前端仍要收下事件，不能等到打开会话才开始听
ensureChatStreamControllerInitialized();

// 配置中心常驻，初始化后订阅后端配置变更
void useConfigStore.getState().initialize();

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <TooltipProvider>
      <App />
    </TooltipProvider>
  </React.StrictMode>
);
