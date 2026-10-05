import { memo } from 'react';
import { HomeIcon } from 'lucide-react';

export const Home = memo(function Home() {
  return (
    <div className="flex flex-col items-center justify-center h-full text-muted-foreground">
      <HomeIcon className="h-12 w-12 mb-4" />
      <div className="text-base">欢迎使用，请从左侧选择功能</div>
    </div>
  );
});
