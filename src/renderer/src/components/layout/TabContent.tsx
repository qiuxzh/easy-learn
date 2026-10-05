import { memo, type ComponentType, type ReactElement } from 'react';
import { Chat } from '@/pages/Chat';
import { BookShelf } from '@/pages/BookShelf';
import { Flashcard } from '@/pages/Flashcard';
import { Home } from '@/pages/Home';
import { CardBrowser } from '@/components/CardBrowser';
import { CardReview } from '@/components/CardReview';
import { ReaderView } from '@/components/reader/ReaderView';
import { useTabsStore, type TabType } from '@/stores/tabs-store';

/** 各 Tab 内容组件统一接收实例 ID 和必要参数。 */
type TabContentProps = {
  tabId?: string;
  bookId?: string;
  groupId?: string;
  createCardAt?: number;
};

/** Tab 类型到内容组件的映射。 */
const TAB_COMPONENTS: Record<TabType, ComponentType<TabContentProps>> = {
  home: Home as ComponentType<TabContentProps>,
  chat: Chat as ComponentType<TabContentProps>,
  bookshelf: BookShelf as ComponentType<TabContentProps>,
  'card-management': Flashcard as ComponentType<TabContentProps>,
  'card-browser': CardBrowser as ComponentType<TabContentProps>,
  'card-review': CardReview as ComponentType<TabContentProps>,
  reader: ReaderView,
};

/** 渲染全部 Tab，切换时通过 hidden 保留组件内部状态。 */
export const TabContent = memo(function TabContent(): ReactElement {
  const tabs = useTabsStore(s => s.tabs);
  const activeTabId = useTabsStore(s => s.activeTabId);

  return (
    <>
      {tabs.map(tab => {
        const Component = TAB_COMPONENTS[tab.type];
        return (
          <div key={tab.id} className={`h-full w-full ${tab.id === activeTabId ? '' : 'hidden'}`}>
            <Component
              tabId={tab.id}
              bookId={tab.params?.bookId}
              createCardAt={tab.params?.createCardAt}
              groupId={tab.params?.groupId}
            />
          </div>
        );
      })}
    </>
  );
});
