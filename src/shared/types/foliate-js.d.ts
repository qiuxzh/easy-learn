declare module 'foliate-js/epub.js' {
  export class EPUB {
    constructor(loader: {
      loadText: (name: string) => Promise<string | null>;
      loadBlob: (name: string, type?: string) => Promise<Blob | null>;
      getSize: (name: string) => number;
    });
    init(): Promise<unknown>;
  }
}

declare module 'foliate-js/epubcfi.js' {
  interface CfiRange {
    startContainer: Node;
    startOffset: number;
    endContainer: Node;
    endOffset: number;
    collapsed: boolean;
  }

  export function fromRange(range: CfiRange): string;
  export function joinIndir(...cfis: string[]): string;
}
