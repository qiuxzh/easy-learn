import { memo, useEffect } from 'react';
import { LibraryBrowser } from '@/components/LibraryBrowser';
import { LibrarySidebar } from '@/components/LibrarySidebar';
import { useLibraryStore } from '@/stores/library-store';

/** 资料库页面：左侧导航与目录树，右侧工具栏与内容视图。 */
export const LibraryPage = memo(function LibraryPage() {
  const load = useLibraryStore(s => s.load);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <div className="flex h-full min-w-0">
      <LibrarySidebar />
      <LibraryBrowser />
    </div>
  );
});
