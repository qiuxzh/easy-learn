import { defineConfig } from 'electron-vite';
import react from '@vitejs/plugin-react';
import { resolve, dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { normalizePath } from 'vite';
import { viteStaticCopy } from 'vite-plugin-static-copy';

const __dirname = dirname(fileURLToPath(import.meta.url));

/**
 * pdfjs 的可选运行时资源目录。
 * cmaps 决定「无内嵌字体的中文 PDF」是否乱码，wasm 供 JBIG2 / JPEG2000 扫描页解码，
 * iccs 是 ICC 色彩配置。它们都不参与打包，只是需要能被 fetch 到。
 */
const PDFJS_ASSET_DIRS = ['cmaps', 'standard_fonts', 'wasm', 'iccs'] as const;

/** pdfjs-dist 包根目录 */
const PDFJS_SOURCE_ROOT = resolve(__dirname, 'node_modules/pdfjs-dist');

export default defineConfig({
  main: {
    build: {
      sourcemap: true,
      rollupOptions: {
        // 原生 / WASM 模块必须外部化，由 node_modules 在运行时提供：
        // - pdfium 按 import.meta.url 定位同目录下的 pdfium.wasm，被 bundle 成单文件后路径失效
        // - @napi-rs/canvas 带 .node 原生绑定，被打进 ESM 产物会退化成顶层 require()，
        //   启动即报 "require is not defined in ES module scope"
        // 后两项属于主进程的 ETL / OCR 链（pdfium 光栅化 + canvas 编码页面图），
        // 该链目前没有接入口，因此不会被静态 import 到主 bundle；保留在这里是为了接线时不再踩坑。
        // 渲染进程的 PDF 预览走的是 pdf.js，与它们无关，两条链不得互相 import。
        external: ['better-sqlite3', 'jieba-wasm', '@hyzyla/pdfium', '@napi-rs/canvas'],
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
    plugins: [
      react(),
      // pdfjs 的可选运行时资源：dev 由插件直接服务、build 时拷进产物目录，
      // 对外 URL 统一是 /pdfjs/<目录>/<文件>（pdf-book.ts 用 document.baseURI 拼绝对地址）
      viteStaticCopy({
        targets: PDFJS_ASSET_DIRS.map(dir => ({
          // src 是相对 Vite root（src/renderer）解析的，这里用绝对路径；
          // Windows 的反斜杠在 tinyglobby 里是转义字符，必须 normalizePath
          src: normalizePath(join(PDFJS_SOURCE_ROOT, dir, '*')),
          dest: `pdfjs/${dir}`,
        })),
      }),
    ],
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
