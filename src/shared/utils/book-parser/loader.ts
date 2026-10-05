import JSZip from 'jszip';
import type { FoliateLoader } from './types';

/**
 * 把 JSZip 包成 foliate-js 需要的 loader 接口。
 * 浏览器和主进程（jsdom）共用；jsdom 需 copyBlob 避免 SharedArrayBuffer Blob 不兼容。
 */
export function makeZipLoader(zip: JSZip, opts: { copyBlob?: boolean } = {}): FoliateLoader {
  const loadText = async (name: string): Promise<string | null> => {
    const entry = zip.file(name);
    if (!entry || entry.dir) return null;
    return entry.async('text');
  };

  const loadBlob = opts.copyBlob
    ? async (name: string, _type?: string): Promise<Blob | null> => {
        const entry = zip.file(name);
        if (!entry || entry.dir) return null;
        const src = await entry.async('uint8array');
        // 复制到独立的 ArrayBuffer，避免 jsdom Blob 不接受 SharedArrayBuffer
        const copy = new Uint8Array(src.byteLength);
        copy.set(src);
        return new Blob([copy]);
      }
    : async (name: string, _type?: string): Promise<Blob | null> => {
        const entry = zip.file(name);
        if (!entry || entry.dir) return null;
        return entry.async('blob');
      };

  // getSize 是 foliate-js SectionProgress 计算进度的基础（各 section 未压缩字节数）。
  // JSZipObject 没有公开 size，但运行时 _data 是 CompressedObject 含 uncompressedSize。
  const getSize = (name: string): number => {
    const entry = zip.file(name);
    const data = entry as { _data?: { uncompressedSize?: number } } | null;
    return data?._data?.uncompressedSize ?? 0;
  };

  return { loadText, loadBlob, getSize };
}
