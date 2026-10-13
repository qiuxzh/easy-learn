import { useState } from 'react';
import { IconGitBranch } from '@tabler/icons-react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';

/** 分支命名弹窗属性。 */
interface ForkSessionDialogProps {
  /** 名称输入框的初始值。 */
  defaultTitle: string;
  /** 是否正在创建分支，为真时按钮置忙、禁止关闭。 */
  pending: boolean;
  /** 打开状态变化回调，关闭时由父组件收起弹窗。 */
  onOpenChange: (open: boolean) => void;
  /** 确认回调，参数是用户填写的名称。 */
  onConfirm: (title: string) => void;
}

/**
 * 分支命名弹窗：用户填好名称点确认后才真正发起分支请求。
 * 由调用方在需要时挂载，因此名称初值直接取 defaultTitle，不需要额外的重置逻辑。
 * 名称删空时提交空串，由主进程按源会话标题自动命名。
 */
export function ForkSessionDialog({
  defaultTitle,
  pending,
  onOpenChange,
  onConfirm,
}: ForkSessionDialogProps) {
  const [title, setTitle] = useState(defaultTitle);

  /** 提交：只把名称交出去，创建结果由调用方处理 */
  const handleSubmit = () => {
    if (pending) return;
    onConfirm(title.trim());
  };

  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>分支会话</DialogTitle>
          <DialogDescription>基于当前回复创建新的会话。创建后自动切换到分支会话</DialogDescription>
        </DialogHeader>

        <div className="space-y-2">
          <p className="text-sm font-medium">会话名称</p>
          <Input
            autoFocus
            value={title}
            onChange={event => setTitle(event.target.value)}
            onKeyDown={event => {
              if (event.key === 'Enter') {
                handleSubmit();
              }
            }}
            placeholder="给这个分支起个名字"
          />
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={pending}>
            取消
          </Button>
          <Button onClick={handleSubmit} disabled={pending}>
            <IconGitBranch className="h-4 w-4" />
            {pending ? '创建中…' : '创建分支'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
