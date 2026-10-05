import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';
import { cn } from '@/lib/utils';

/** 配置页左侧的分组类型。 */
type SettingsSection = 'general' | 'appearance' | 'models';

/** 左侧配置分组。 */
const SETTINGS_SECTIONS: Array<{ value: SettingsSection; label: string }> = [
  { value: 'general', label: '通用' },
  { value: 'appearance', label: '外观' },
  { value: 'models', label: '模型' },
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
        overlayClassName="bg-black/40"
        className="flex h-[min(640px,calc(100vh-3rem))] w-[min(960px,calc(100vw-3rem))] max-w-none gap-0 overflow-hidden p-0"
      >
        <DialogTitle className="sr-only">设置</DialogTitle>

        <aside className="w-44 shrink-0 border-r border-border p-3">
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
                aria-selected={activeSection === section.value}
                aria-controls={`settings-panel-${section.value}`}
                className={cn(
                  'w-full justify-start',
                  activeSection === section.value && 'bg-accent text-accent-foreground'
                )}
                onClick={() => setActiveSection(section.value)}
              >
                {section.label}
              </Button>
            ))}
          </div>
        </aside>

        <section
          id={`settings-panel-${activeSection}`}
          className="min-w-0 flex-1"
          role="tabpanel"
        />
      </DialogContent>
    </Dialog>
  );
}
