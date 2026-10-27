import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';
import { EmbeddingModelSettings } from '@/components/settings/EmbeddingModelSettings';
import { OcrSettings } from '@/components/settings/OcrSettings';
import { ReaderSettings } from '@/components/settings/ReaderSettings';

/** 配置页左侧的分组类型。 */
type SettingsSection = 'general' | 'appearance' | 'reader' | 'models' | 'ocr';

/** 左侧配置分组。 */
const SETTINGS_SECTIONS: Array<{ value: SettingsSection; label: string }> = [
  { value: 'general', label: '通用' },
  { value: 'appearance', label: '外观' },
  { value: 'reader', label: '阅读' },
  { value: 'models', label: '模型' },
  { value: 'ocr', label: '文字提取' },
];

interface SettingsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/** 设置弹窗骨架，具体配置项后续按分组补充。 */
export function SettingsDialog({ open, onOpenChange }: SettingsDialogProps) {
  const [activeSection, setActiveSection] = useState<SettingsSection>('general');

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        overlayClassName="bg-mask-2"
        className="flex h-[min(640px,calc(100vh-3rem))] w-[min(960px,calc(100vw-3rem))] max-w-none gap-0 overflow-hidden p-0"
        closeButtonClassName="right-2 top-2"
      >
        <DialogTitle className="sr-only">设置</DialogTitle>

        <aside className="w-44 shrink-0 border-r border-stroke-3 p-3">
          <div
            className="flex flex-col gap-1"
            role="tablist"
            aria-label="配置分组"
            aria-orientation="vertical"
          >
            {SETTINGS_SECTIONS.map(section => (
              <Button
                key={section.value}
                type="button"
                role="tab"
                variant="ghost"
                pressed={activeSection === section.value}
                className="w-full justify-start"
                aria-selected={activeSection === section.value}
                aria-controls={`settings-panel-${section.value}`}
                onClick={() => setActiveSection(section.value)}
              >
                {section.label}
              </Button>
            ))}
          </div>
        </aside>

        <section
          id={`settings-panel-${activeSection}`}
          className="min-w-0 flex-1 overflow-y-auto p-4"
          role="tabpanel"
        >
          {activeSection === 'reader' && <ReaderSettings />}
          {activeSection === 'models' && <EmbeddingModelSettings />}
          {activeSection === 'ocr' && <OcrSettings />}
        </section>
      </DialogContent>
    </Dialog>
  );
}
