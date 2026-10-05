import { Toaster } from './components/ui/sonner';
import { Wrapper } from './components/layout/Wrapper';
import { AppLayout } from './components/layout/AppLayout';

export function App() {
  return (
    <Wrapper>
      <AppLayout />
      <Toaster position="top-center" duration={1500} offset="24px" />
    </Wrapper>
  );
}
