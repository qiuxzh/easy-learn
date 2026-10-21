import { useEffect, useState, type ReactNode } from 'react';
import { EditorContent, useEditor, useEditorState, type Editor } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import { TableKit } from '@tiptap/extension-table';
import { Markdown } from '@tiptap/markdown';
import {
  ArrowDownToLine,
  ArrowLeftToLine,
  ArrowRightToLine,
  ArrowUpToLine,
  Bold,
  Braces,
  ChevronDown,
  Code,
  Columns3,
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
  Rows3,
  Strikethrough,
  Table as TableIcon,
  TableCellsMerge,
  TableCellsSplit,
  Trash2,
  Undo2,
} from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
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
    extensions: [StarterKit, Markdown, TableKit],
    content: value,
    contentType: 'markdown',
    editorProps: {
      attributes: {
        class: cn(
          minHeightClassName,
          'max-w-none px-5 py-4 text-body-lg leading-7 outline-none',
          '[&_h1]:mb-4 [&_h1]:mt-2 [&_h1]:text-3xl [&_h1]:font-bold',
          '[&_h2]:mb-3 [&_h2]:mt-2 [&_h2]:text-2xl [&_h2]:font-semibold',
          '[&_h3]:mb-2 [&_h3]:mt-2 [&_h3]:text-xl [&_h3]:font-semibold',
          '[&_p]:my-2 [&_p:first-child]:mt-0 [&_p:last-child]:mb-0 [&_ul]:my-2 [&_ul]:list-disc [&_ul]:pl-6',
          '[&_ol]:my-2 [&_ol]:list-decimal [&_ol]:pl-6',
          '[&_blockquote]:my-3 [&_blockquote]:border-l-4 [&_blockquote]:border-primary-border [&_blockquote]:pl-4 [&_blockquote]:italic [&_blockquote]:text-muted-foreground',
          '[&_code]:rounded-sm [&_code]:bg-muted [&_code]:px-1.5 [&_code]:py-0.5 [&_code]:font-mono [&_code]:text-sm',
          '[&_pre]:my-3 [&_pre]:overflow-x-auto [&_pre]:rounded-lg [&_pre]:bg-muted [&_pre]:p-4',
          '[&_pre_code]:bg-transparent [&_pre_code]:p-0',
          '[&_hr]:my-5 [&_hr]:border-stroke-3',
          '[&_.tableWrapper]:my-3 [&_.tableWrapper]:overflow-x-auto',
          '[&_.tableWrapper]:rounded-sm [&_.tableWrapper]:border [&_.tableWrapper]:border-stroke-3',
          '[&_table]:w-full [&_table]:border-collapse [&_table]:text-body-lg',
          '[&_th]:bg-surface-2 [&_th]:px-3 [&_th]:py-2 [&_th]:text-left [&_th]:align-top [&_th]:font-semibold',
          '[&_td]:border-t [&_td]:border-stroke-3 [&_td]:px-3 [&_td]:py-2 [&_td]:align-top',
          '[&_th_p]:my-0 [&_td_p]:my-0',
          '[&_.selectedCell]:bg-primary-surface'
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
        'overflow-hidden rounded-xl hairline border-stroke-3 bg-background transition-shadow',
        className
      )}
    >
      <div className="flex min-h-11 items-center justify-between gap-2 border-b bg-surface-2 px-2 py-1.5">
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
            <div className="pointer-events-none absolute left-5 top-4 text-body-lg leading-7 text-ink-secondary">
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
            'resize-y rounded-none border-0 bg-surface-1 px-5 py-4 font-mono text-sm leading-6 shadow-none focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring'
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
      <TableMenu editor={editor} state={state} disabled={disabled} />
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

/** 插入表格网格的候选尺寸，逐格对应可插入的列数与行数。 */
const TABLE_GRID = Array.from({ length: 20 }, (_, index) => ({
  cols: (index % 5) + 1,
  rows: Math.floor(index / 5) + 1,
}));

/** 表格插入与单元格操作的工具栏菜单。 */
function TableMenu({
  editor,
  state,
  disabled,
}: {
  editor: Editor;
  state: ReturnType<typeof useMarkdownEditorState>;
  disabled: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [hoverSize, setHoverSize] = useState({ rows: 3, cols: 3 });
  const inTable = state?.inTable ?? false;

  /** 插入表格并收起菜单；GFM 表格必须有表头行，插入时固定带上。 */
  function insertTable(rows: number, cols: number) {
    editor.chain().focus().insertTable({ rows, cols, withHeaderRow: true }).run();
    setOpen(false);
  }

  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <DropdownMenuTrigger asChild>
        <Toggle
          type="button"
          pressed={inTable}
          disabled={disabled}
          aria-label="表格"
          className={cn('gap-0.5 px-1.5', inTable && 'bg-accent')}
        >
          <TableIcon />
          <ChevronDown className="size-3 opacity-70" />
        </Toggle>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="start"
        className="w-[264px]"
        onCloseAutoFocus={event => {
          event.preventDefault();
          if (!editor.isDestroyed) editor.commands.focus();
        }}
      >
        <DropdownMenuLabel className="flex items-center justify-between px-2 py-1 text-xs font-medium text-muted-foreground">
          <span>{inTable ? `表格 ${state?.tableSize}` : '插入表格'}</span>
          <span className="tabular-nums">
            {hoverSize.cols} × {hoverSize.rows}
          </span>
        </DropdownMenuLabel>
        <div className="grid w-[170px] grid-cols-5 gap-1 px-2 pb-1">
          {TABLE_GRID.map(({ rows, cols }) => {
            const active = cols <= hoverSize.cols && rows <= hoverSize.rows;
            return (
              <button
                key={`${rows}-${cols}`}
                type="button"
                aria-label={`插入 ${cols} 列 ${rows} 行表格`}
                disabled={inTable}
                className={cn(
                  'h-4 rounded-xs border transition-colors',
                  active ? 'border-primary-border bg-primary-surface' : 'border-stroke-3',
                  inTable && 'cursor-not-allowed opacity-40'
                )}
                onMouseEnter={() => setHoverSize({ rows, cols })}
                onClick={() => insertTable(rows, cols)}
              />
            );
          })}
        </div>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          disabled={!inTable}
          onSelect={() => editor.chain().focus().addRowBefore().run()}
        >
          <ArrowUpToLine />
          上方插入行
        </DropdownMenuItem>
        <DropdownMenuItem
          disabled={!inTable}
          onSelect={() => editor.chain().focus().addRowAfter().run()}
        >
          <ArrowDownToLine />
          下方插入行
        </DropdownMenuItem>
        <DropdownMenuItem
          disabled={!inTable}
          onSelect={() => editor.chain().focus().addColumnBefore().run()}
        >
          <ArrowLeftToLine />
          左侧插入列
        </DropdownMenuItem>
        <DropdownMenuItem
          disabled={!inTable}
          onSelect={() => editor.chain().focus().addColumnAfter().run()}
        >
          <ArrowRightToLine />
          右侧插入列
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          disabled={!state?.canMerge}
          onSelect={() => editor.chain().focus().mergeCells().run()}
        >
          <TableCellsMerge />
          合并单元格
        </DropdownMenuItem>
        <DropdownMenuItem
          disabled={!state?.canSplit}
          onSelect={() => editor.chain().focus().splitCell().run()}
        >
          <TableCellsSplit />
          拆分单元格
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          disabled={!inTable}
          onSelect={() => editor.chain().focus().deleteRow().run()}
        >
          <Rows3 />
          删除行
        </DropdownMenuItem>
        <DropdownMenuItem
          disabled={!inTable}
          onSelect={() => editor.chain().focus().deleteColumn().run()}
        >
          <Columns3 />
          删除列
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          disabled={!inTable}
          className="text-destructive focus:text-destructive"
          onSelect={() => editor.chain().focus().deleteTable().run()}
        >
          <Trash2 />
          删除表格
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
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
          inTable: false,
          tableSize: '',
          canMerge: false,
          canSplit: false,
          canUndo: false,
          canRedo: false,
        };
      }
      const table = findTableNode(currentEditor);
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
        inTable: Boolean(table),
        tableSize: table ? `${table.firstChild?.childCount ?? 0} × ${table.childCount}` : '',
        canMerge: Boolean(table) && currentEditor.can().mergeCells(),
        canSplit: Boolean(table) && currentEditor.can().splitCell(),
        canUndo: currentEditor.can().chain().focus().undo().run(),
        canRedo: currentEditor.can().chain().focus().redo().run(),
      };
    },
  });
}

/** 光标所在的表格节点，光标不在表格内时为 null。 */
function findTableNode(editor: Editor) {
  const { $from } = editor.state.selection;
  for (let depth = $from.depth; depth > 0; depth -= 1) {
    const node = $from.node(depth);
    if (node.type.name === 'table') return node;
  }
  return null;
}

/** 带 Tooltip 和激活态的 Markdown 工具栏按钮。 */
function ToolbarButton({ label, active, disabled, onClick, children }: ToolbarButtonProps) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Toggle
          type="button"
          pressed={active}
          disabled={disabled}
          aria-label={label}
          onPressedChange={() => onClick()}
          className="p-0"
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
