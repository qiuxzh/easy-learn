import { defineConfig } from 'electron-vite';
import react from '@vitejs/plugin-react';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  main: {
    build: {
      sourcemap: true,
      rollupOptions: {
        // pdfium 在运行时按 import.meta.url 定位同目录下的 pdfium.wasm，
        // 被 bundle 成单文件后这个路径会失效，故保持外部化，由 node_modules 提供
        external: ['better-sqlite3', 'jieba-wasm', '@hyzyla/pdfium'],
      },
    },
    resolve: {
      alias: {
        '@shared': resolve(__dirname, 'src/shared'),
        '@main': resolve(__dirname, 'src/main'),
      },
    },
  },
  preload: {
    build: {
      rollupOptions: {
        input: {
          index: resolve(__dirname, 'src/preload/index.ts'),
        },
      },
    },
    resolve: {
      alias: {
        '@shared': resolve(__dirname, 'src/shared'),
      },
    },
  },
  renderer: {
    root: './src/renderer',
    build: {
      rollupOptions: {
        input: {
          index: resolve(__dirname, 'src/renderer/index.html'),
        },
      },
    },
    plugins: [react()],
    // 显式声明 streamdown 系列依赖，强制 Vite 在启动时一次性完成预打包
    // 并稳定 hash；否则 markdown 渲染时会动态 import 子 chunk，若 Vite 在
    // 改文件后重新生成 hash 而浏览器仍在请求旧 hash，会触发 404
    optimizeDeps: {
      include: [
        'streamdown',
        '@streamdown/code',
        '@streamdown/math',
        '@streamdown/mermaid',
        'mermaid',
      ],
    },
    resolve: {
      alias: {
        '@': resolve(__dirname, 'src/renderer/src'),
        '@shared': resolve(__dirname, 'src/shared'),
      },
    },
    // 排除以下目录的文件变更触发 HMR/页面刷新，
    // 这些目录仅作为参考文档/备份/临时脚本使用，无需参与热更新
    server: {
      watch: {
        ignored: [
          '**/docs/**',
          '**/temp_script/**',
          // 编辑器/工具做原子写入时会在同级目录建隐藏临时目录
          // （.<文件名>.<pid>.<uuid>.tmpdir/<文件名>.tmp），写完即删。
          // Windows 上监听这种瞬时文件会抛 EBUSY，chokidar 把错误抛给未监听的
          // error 事件会直接终止 dev 进程，故整体排除；目录名以点开头，
          // 普通 * 不匹配点开头，模式里需显式写 .*.tmpdir
          '**/.*.tmpdir',
          '**/.*.tmpdir/**',
        ],
      },
    },
  },
});
