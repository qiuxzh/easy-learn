import { useState } from 'react';
import { Pencil, Plus, Trash2, X } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { PasswordInput } from '@/components/ui/password-input';
import { Switch } from '@/components/ui/switch';
import { cn } from '@/lib/utils';
import { useConfigStore } from '@/stores/config-store';
import type { EmbeddingConfig, EmbeddingModelEntry } from '@shared/config';

/** 新增 / 编辑表单的字段；name 是条目的键名，其余是条目本身的值。 */
interface EmbeddingModelForm {
  name: string;
  modelId: string;
  endpoint: string;
  apiKey: string;
}

/** 空表单。 */
const EMPTY_FORM: EmbeddingModelForm = {
  name: '',
  modelId: '',
  endpoint: '',
  apiKey: '',
};

/**
 * 向量模型设置：维护 embedding 配置里的模型字典与当前选中项。
 * 条目名称就是字典的键名（名称唯一由这里保证），值里不再重复存一份名称。
 * selected 缺省即「没有当前使用项」，界面不做「回退第一个」的兜底，与读取方保持一致。
 * 配置写在主进程的 config.json，这里只负责编辑与端点测试。
 * 控件尺寸一律用 Button / Input / Switch 的默认档，不在这里手工压缩。
 */
export function EmbeddingModelSettings() {
  const embedding = useConfigStore(state => state.config.embedding);
  const writeConfig = useConfigStore(state => state.set);

  const models = embedding?.models ?? {};
  const selected = embedding?.selected;
  const entries = Object.entries(models);

  const [formOpen, setFormOpen] = useState(false);
  /** 正在编辑的条目名称；null 表示当前是新增 */
  const [editingName, setEditingName] = useState<string | null>(null);
  const [form, setForm] = useState<EmbeddingModelForm>(EMPTY_FORM);
  const [testingName, setTestingName] = useState<string | null>(null);

  /**
   * 写回 embedding 区块。
   * 这里用整体替换而不是局部合并，未传 selected 时该字段会被一并移除，
   * 避免删掉模型后残留一个指向不存在模型的选中项。
   */
  const saveEmbedding = async (
    nextModels: Record<string, EmbeddingModelEntry>,
    nextSelected?: string
  ): Promise<boolean> => {
    const next: EmbeddingConfig = nextSelected
      ? { models: nextModels, selected: nextSelected }
      : { models: nextModels };

    const error = await writeConfig(['embedding'], next);
    if (error) {
      toast.error(`保存失败：${error}`);
      return false;
    }
    return true;
  };

  /** 打开新增表单。 */
  const openCreateForm = () => {
    setForm(EMPTY_FORM);
    setEditingName(null);
    setFormOpen(true);
  };

  /** 打开编辑表单，回填当前配置。 */
  const openEditForm = (name: string, entry: EmbeddingModelEntry) => {
    setForm({
      name,
      modelId: entry.modelId,
      endpoint: entry.endpoint,
      apiKey: entry.apiKey ?? '',
    });
    setEditingName(name);
    setFormOpen(true);
  };

  /** 关闭表单并清空编辑态。 */
  const closeForm = () => {
    setForm(EMPTY_FORM);
    setEditingName(null);
    setFormOpen(false);
  };

  /** 提交新增或编辑结果。 */
  const submitForm = async () => {
    const name = form.name.trim();
    const modelId = form.modelId.trim();
    const endpoint = form.endpoint.trim();
    if (!name || !modelId || !endpoint) return;

    // 名称即标识：新增或改名都不能与已有条目重名，否则会互相覆盖
    if (name !== editingName && Object.hasOwn(models, name)) {
      toast.error(`已存在名为「${name}」的向量模型，请换一个名称`);
      return;
    }

    const apiKey = form.apiKey.trim();
    const previous = editingName ? models[editingName] : undefined;

    // 换了模型或地址，之前探测到的维度不再可信，重建对象以丢弃 dimension
    const targetChanged =
      !previous || previous.modelId !== modelId || previous.endpoint !== endpoint;
    const entry: EmbeddingModelEntry = targetChanged
      ? { modelId, endpoint, apiKey }
      : { ...previous, modelId, endpoint, apiKey };

    const nextModels: Record<string, EmbeddingModelEntry> = { ...models };
    if (editingName && editingName !== name) {
      delete nextModels[editingName];
    }
    nextModels[name] = entry;

    // 改名后原来的选中项已经不存在，跟着改成新名称
    let nextSelected = selected;
    if (editingName && selected === editingName) {
      nextSelected = name;
    }
    // 还没有当前使用项时（首次添加），直接把新条目设为当前使用
    if (!nextSelected) {
      nextSelected = name;
    }

    if (await saveEmbedding(nextModels, nextSelected)) {
      closeForm();
    }
  };

  /** 删除一个条目；删掉的正好是当前使用项时退到剩下的第一个。 */
  const removeEntry = async (name: string) => {
    const nextModels: Record<string, EmbeddingModelEntry> = { ...models };
    delete nextModels[name];

    const nextSelected = selected === name ? Object.keys(nextModels)[0] : selected;

    if (await saveEmbedding(nextModels, nextSelected)) {
      if (editingName === name) closeForm();
    }
  };

  /** 切换当前使用的向量模型。 */
  const selectEntry = async (name: string, checked: boolean) => {
    await saveEmbedding(models, checked ? name : undefined);
  };

  /** 调用一次 embeddings 接口，验证连通性并把探测到的维度写回配置。 */
  const testEntry = async (name: string) => {
    const entry = models[name];
    if (!entry) return;

    setTestingName(name);

    try {
      const result = await window.api.embedding.testEndpoint({
        endpoint: entry.endpoint,
        modelId: entry.modelId,
        apiKey: entry.apiKey,
      });

      if (!result.success || !result.dimension) {
        toast.error(result.error ?? '测试失败');
        return;
      }

      // 测试是异步的，写回前确认该条目还在、且请求目标没被改过
      const latest = useConfigStore.getState().config.embedding;
      const current = latest?.models[name];
      if (
        !latest ||
        !current ||
        current.endpoint !== entry.endpoint ||
        current.modelId !== entry.modelId
      ) {
        // 直接 return 会让人以为维度写回了，这里明确说明为什么没写
        toast.info('测试通过，但该条目已被修改或删除，维度未写回');
        return;
      }

      const nextModels: Record<string, EmbeddingModelEntry> = {
        ...latest.models,
        [name]: { ...current, dimension: result.dimension },
      };
      await saveEmbedding(nextModels, latest.selected);
      toast.success(`连通正常，向量维度 ${result.dimension}`);
    } finally {
      setTestingName(null);
    }
  };

  const canSubmit = Boolean(form.name.trim() && form.modelId.trim() && form.endpoint.trim());

  return (
    <section className="rounded-lg bg-muted/60 p-4">
      {/* 标题块：用大标题 + 分隔线把这一节从正文里拎出来 */}
      <div className="mb-4 flex items-start justify-between gap-3 border-b border-border pb-3">
        <div className="min-w-0">
          <h2 className="text-lg font-semibold tracking-tight text-foreground">向量模型</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            配置用于语义检索的 embeddings 接口，可配置多个并选中一个作为当前使用。
          </p>
        </div>
        {!formOpen && (
          <Button variant="outline" className="shrink-0" onClick={openCreateForm}>
            <Plus />
            添加模型
          </Button>
        )}
      </div>

      {entries.length === 0 && !formOpen && (
        <p className="py-6 text-center text-sm text-muted-foreground">还没有配置向量模型</p>
      )}

      <div className="space-y-2">
        {entries.map(([name, entry]) => (
          <div
            key={name}
            className={cn(
              'rounded-lg border p-3 transition-colors',
              selected === name ? 'border-primary/50 bg-primary/5' : 'border-border bg-background'
            )}
          >
            <div className="flex items-center justify-between gap-2">
              <div className="flex min-w-0 flex-1 items-center gap-2">
                <span className="truncate text-sm font-medium">{name}</span>
                <span className="truncate text-sm text-muted-foreground">{entry.modelId}</span>
                {entry.dimension && (
                  <span className="shrink-0 text-sm text-muted-foreground">
                    {entry.dimension} 维
                  </span>
                )}
              </div>

              <div className="flex shrink-0 items-center gap-1">
                <Button
                  variant="ghost"
                  disabled={testingName === name}
                  onClick={() => void testEntry(name)}
                >
                  {testingName === name ? '测试中' : '测试'}
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label={`编辑 ${name}`}
                  className="text-muted-foreground hover:text-foreground"
                  onClick={() => openEditForm(name, entry)}
                >
                  <Pencil />
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label={`删除 ${name}`}
                  className="text-muted-foreground hover:text-destructive"
                  onClick={() => void removeEntry(name)}
                >
                  <Trash2 />
                </Button>
                <Switch
                  checked={selected === name}
                  onCheckedChange={checked => void selectEntry(name, checked)}
                />
              </div>
            </div>

            <p className="mt-1.5 truncate text-sm text-muted-foreground">{entry.endpoint}</p>
          </div>
        ))}
      </div>

      {formOpen && (
        <div className="mt-3 space-y-4 rounded-lg border border-border bg-background p-4">
          <div className="flex items-center justify-between">
            <h3 className="text-base font-semibold">
              {editingName ? '编辑向量模型' : '添加向量模型'}
            </h3>
            <Button variant="ghost" size="icon" aria-label="关闭表单" onClick={closeForm}>
              <X />
            </Button>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label
                htmlFor="embedding-name"
                className="mb-1.5 block text-sm text-muted-foreground"
              >
                名称 *
              </label>
              <Input
                id="embedding-name"
                value={form.name}
                placeholder="SiliconFlow Qwen3-Embedding"
                onChange={event => setForm(current => ({ ...current, name: event.target.value }))}
              />
              <p className="mt-1.5 text-xs text-muted-foreground">
                名称即这条配置的标识，不能与已有模型重复。
              </p>
            </div>
            <div>
              <label
                htmlFor="embedding-model-id"
                className="mb-1.5 block text-sm text-muted-foreground"
              >
                模型 id *
              </label>
              <Input
                id="embedding-model-id"
                value={form.modelId}
                placeholder="text-embedding-3-small"
                onChange={event =>
                  setForm(current => ({ ...current, modelId: event.target.value }))
                }
              />
            </div>
          </div>

          <div>
            <label
              htmlFor="embedding-endpoint"
              className="mb-1.5 block text-sm text-muted-foreground"
            >
              端点地址 *
            </label>
            <Input
              id="embedding-endpoint"
              value={form.endpoint}
              placeholder="https://api.openai.com/v1/embeddings"
              onChange={event => setForm(current => ({ ...current, endpoint: event.target.value }))}
            />
            <p className="mt-1.5 text-xs text-muted-foreground">
              完整的 embeddings 请求地址，程序不做拼接。
            </p>
          </div>

          <div>
            <label
              htmlFor="embedding-api-key"
              className="mb-1.5 block text-sm text-muted-foreground"
            >
              API 密钥
            </label>
            <PasswordInput
              id="embedding-api-key"
              value={form.apiKey}
              placeholder="sk-..."
              onChange={event => setForm(current => ({ ...current, apiKey: event.target.value }))}
            />
          </div>

          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={closeForm}>
              取消
            </Button>
            <Button disabled={!canSubmit} onClick={() => void submitForm()}>
              保存
            </Button>
          </div>
        </div>
      )}
    </section>
  );
}
