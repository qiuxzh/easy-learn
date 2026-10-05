import { useEffect, useState, type ReactNode } from 'react';
import { EditorContent, useEditor, useEditorState, type Editor } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import { Markdown } from '@tiptap/markdown';
import {
  Bold,
  Braces,
  Code,
  Eraser,
  Heading1,
  Heading2,
  Heading3,
  Italic,
  List,
  ListOrdered,
  Minus,
  Quote,
  Redo2,
  Strikethrough,
  Undo2,
} from 'lucide-react';
import { Separator } from '@/components/ui/separator';
import { SegmentedToggle } from '@/components/ui/segmented-toggle';
import { Textarea } from '@/components/ui/textarea';
import { Toggle } from '@/components/ui/toggle';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';

/** Markdown 编辑器的显示模式。 */
type MarkdownEditorMode = 'live' | 'source';

/** Markdown 编辑器属性。 */
interface MarkdownEditorProps {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  className?: string;
  minHeightClassName?: string;
}

/** 工具栏按钮属性。 */
interface ToolbarButtonProps {
  label: string;
  active?: boolean;
  disabled?: boolean;
  onClick: () => void;
  children: ReactNode;
}

/** 支持默认和原始两种模式的 Markdown 编辑器。 */
export function MarkdownEditor({
  value,
  onChange,
  placeholder,
  className,
  minHeightClassName = 'min-h-44',
}: MarkdownEditorProps) {
  const [mode, setMode] = useState<MarkdownEditorMode>('live');
  const editor = useEditor({
    extensions: [StarterKit, Markdown],
    content: value,
    contentType: 'markdown',
    editorProps: {
      attributes: {
        class: cn(
          minHeightClassName,
          'max-w-none px-5 py-4 text-[15px] leading-7 outline-none',
          '[&_h1]:mb-4 [&_h1]:mt-2 [&_h1]:text-3xl [&_h1]:font-bold',
          '[&_h2]:mb-3 [&_h2]:mt-2 [&_h2]:text-2xl [&_h2]:font-semibold',
          '[&_h3]:mb-2 [&_h3]:mt-2 [&_h3]:text-xl [&_h3]:font-semibold',
          '[&_p]:my-2 [&_p:first-child]:mt-0 [&_p:last-child]:mb-0 [&_ul]:my-2 [&_ul]:list-disc [&_ul]:pl-6',
          '[&_ol]:my-2 [&_ol]:list-decimal [&_ol]:pl-6',
          '[&_blockquote]:my-3 [&_blockquote]:border-l-4 [&_blockquote]:border-primary/40 [&_blockquote]:pl-4 [&_blockquote]:italic [&_blockquote]:text-muted-foreground',
          '[&_code]:rounded [&_code]:bg-muted [&_code]:px-1.5 [&_code]:py-0.5 [&_code]:font-mono [&_code]:text-[0.9em]',
          '[&_pre]:my-3 [&_pre]:overflow-x-auto [&_pre]:rounded-lg [&_pre]:bg-muted [&_pre]:p-4',
          '[&_pre_code]:bg-transparent [&_pre_code]:p-0',
          '[&_hr]:my-5 [&_hr]:border-border'
        ),
        'aria-label': placeholder ?? 'Markdown 编辑器',
        'data-placeholder': placeholder ?? '',
      },
    },
    onUpdate: ({ editor: currentEditor }) => onChange(currentEditor.getMarkdown()),
  });

  const editorState = useMarkdownEditorState(editor);

  useEffect(() => {
    if (!editor || editor.getMarkdown() === value) return;
    editor.commands.setContent(value, { contentType: 'markdown', emitUpdate: false });
  }, [editor, value]);

  return (
    <div
      className={cn(
        'overflow-hidden rounded-xl border bg-background shadow-sm transition-shadow focus-within:border-ring focus-within:ring-3 focus-within:ring-ring/20',
        className
      )}
    >
      <div className="flex min-h-11 items-center justify-between gap-2 border-b bg-muted/35 px-2 py-1.5">
        <div
          className={cn(
            'flex min-w-0 flex-wrap items-center gap-0.5',
            mode === 'source' && 'opacity-45'
          )}
        >
          <MarkdownToolbar editor={editor} state={editorState} disabled={mode === 'source'} />
        </div>
        <SegmentedToggle
          value={mode === 'source' ? 'source' : 'preview'}
          onChange={nextMode => setMode(nextMode === 'source' ? 'source' : 'live')}
          options={[
            { value: 'source', label: '原始' },
            { value: 'preview', label: '默认' },
          ]}
        />
      </div>

      {mode === 'live' ? (
        <div className="relative">
          {!value.trim() && (
            <div className="pointer-events-none absolute left-5 top-4 text-[15px] leading-7 text-muted-foreground/65">
              {placeholder}
            </div>
          )}
          <EditorContent editor={editor} />
        </div>
      ) : (
        <Textarea
          aria-label={`${placeholder ?? 'Markdown'}原始内容`}
          value={value}
          onChange={event => onChange(event.target.value)}
          placeholder={placeholder}
          spellCheck={false}
          className={cn(
            minHeightClassName,
            'resize-y rounded-none border-0 bg-muted/15 px-5 py-4 font-mono text-[14px] leading-6 shadow-none focus-visible:ring-0'
          )}
        />
      )}
    </div>
  );
}

/** Markdown 默认模式的格式工具栏。 */
function MarkdownToolbar({
  editor,
  state,
  disabled,
}: {
  editor: Editor | null;
  state: ReturnType<typeof useMarkdownEditorState>;
  disabled: boolean;
}) {
  if (!editor) return null;
  return (
    <>
      <ToolbarButton
        label="撤销"
        disabled={disabled || !state?.canUndo}
        onClick={() => editor.chain().focus().undo().run()}
      >
        <Undo2 />
      </ToolbarButton>
      <ToolbarButton
        label="重做"
        disabled={disabled || !state?.canRedo}
        onClick={() => editor.chain().focus().redo().run()}
      >
        <Redo2 />
      </ToolbarButton>
      <ToolbarSeparator />
      <ToolbarButton
        label="一级标题"
        active={state?.heading1}
        disabled={disabled}
        onClick={() => editor.chain().focus().toggleHeading({ level: 1 }).run()}
      >
        <Heading1 />
      </ToolbarButton>
      <ToolbarButton
        label="二级标题"
        active={state?.heading2}
        disabled={disabled}
        onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()}
      >
        <Heading2 />
      </ToolbarButton>
      <ToolbarButton
        label="三级标题"
        active={state?.heading3}
        disabled={disabled}
        onClick={() => editor.chain().focus().toggleHeading({ level: 3 }).run()}
      >
        <Heading3 />
      </ToolbarButton>
      <ToolbarSeparator />
      <ToolbarButton
        label="粗体"
        active={state?.bold}
        disabled={disabled}
        onClick={() => editor.chain().focus().toggleBold().run()}
      >
        <Bold />
      </ToolbarButton>
      <ToolbarButton
        label="斜体"
        active={state?.italic}
        disabled={disabled}
        onClick={() => editor.chain().focus().toggleItalic().run()}
      >
        <Italic />
      </ToolbarButton>
      <ToolbarButton
        label="删除线"
        active={state?.strike}
        disabled={disabled}
        onClick={() => editor.chain().focus().toggleStrike().run()}
      >
        <Strikethrough />
      </ToolbarButton>
      <ToolbarButton
        label="行内代码"
        active={state?.code}
        disabled={disabled}
        onClick={() => editor.chain().focus().toggleCode().run()}
      >
        <Code />
      </ToolbarButton>
      <ToolbarSeparator />
      <ToolbarButton
        label="无序列表"
        active={state?.bulletList}
        disabled={disabled}
        onClick={() => editor.chain().focus().toggleBulletList().run()}
      >
        <List />
      </ToolbarButton>
      <ToolbarButton
        label="有序列表"
        active={state?.orderedList}
        disabled={disabled}
        onClick={() => editor.chain().focus().toggleOrderedList().run()}
      >
        <ListOrdered />
      </ToolbarButton>
      <ToolbarButton
        label="引用"
        active={state?.blockquote}
        disabled={disabled}
        onClick={() => editor.chain().focus().toggleBlockquote().run()}
      >
        <Quote />
      </ToolbarButton>
      <ToolbarButton
        label="代码块"
        active={state?.codeBlock}
        disabled={disabled}
        onClick={() => editor.chain().focus().toggleCodeBlock().run()}
      >
        <Braces />
      </ToolbarButton>
      <ToolbarButton
        label="分割线"
        disabled={disabled}
        onClick={() => editor.chain().focus().setHorizontalRule().run()}
      >
        <Minus />
      </ToolbarButton>
      <ToolbarSeparator />
      <ToolbarButton
        label="清除格式"
        disabled={disabled}
        onClick={() => editor.chain().focus().clearNodes().unsetAllMarks().run()}
      >
        <Eraser />
      </ToolbarButton>
    </>
  );
}

/** 提取工具栏需要监听的 Tiptap 状态。 */
function useMarkdownEditorState(editor: Editor | null) {
  return useEditorState({
    editor,
    selector: ({ editor: currentEditor }) => {
      if (!currentEditor) {
        return {
          bold: false,
          italic: false,
          strike: false,
          code: false,
          heading1: false,
          heading2: false,
          heading3: false,
          bulletList: false,
          orderedList: false,
          blockquote: false,
          codeBlock: false,
          canUndo: false,
          canRedo: false,
        };
      }
      return {
        bold: currentEditor.isActive('bold'),
        italic: currentEditor.isActive('italic'),
        strike: currentEditor.isActive('strike'),
        code: currentEditor.isActive('code'),
        heading1: currentEditor.isActive('heading', { level: 1 }),
        heading2: currentEditor.isActive('heading', { level: 2 }),
        heading3: currentEditor.isActive('heading', { level: 3 }),
        bulletList: currentEditor.isActive('bulletList'),
        orderedList: currentEditor.isActive('orderedList'),
        blockquote: currentEditor.isActive('blockquote'),
        codeBlock: currentEditor.isActive('codeBlock'),
        canUndo: currentEditor.can().chain().focus().undo().run(),
        canRedo: currentEditor.can().chain().focus().redo().run(),
      };
    },
  });
}

/** 带 Tooltip 和激活态的 Markdown 工具栏按钮。 */
function ToolbarButton({ label, active, disabled, onClick, children }: ToolbarButtonProps) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Toggle
          type="button"
          size="sm"
          pressed={active}
          disabled={disabled}
          aria-label={label}
          onPressedChange={() => onClick()}
          className="size-8 p-0"
        >
          {children}
        </Toggle>
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}

/** 工具栏按钮组分隔线。 */
function ToolbarSeparator() {
  return <Separator orientation="vertical" className="mx-1 h-5" />;
}
