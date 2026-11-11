# 后台任务

用户点了一个慢操作，它可能要跑几十秒。这期间应用不能卡住，窗口关了再开最好还能接着做，用户也可能想暂停或取消。任务系统管的就是这些：把工作放到后台跑，并记住每条工作走到哪一步。

它不关心业务产物是什么。产物写在各领域自己的表里，任务系统只负责「执行」这一层。

## 先认识几个名字

- **任务**：一条后台工作。数据库里一行，记录它属于哪个类型、现在是排队/运行/暂停/失败、进度多少。
- **任务类型**：一个字符串名字。调度器靠它找到你写的处理函数。
- **调度器**（`TaskScheduler`）：唯一在后台取任务、调用函数、写回状态的角色。
- **上下文**（`ctx`）：函数被调用时调度器交给你的东西，里面有本次任务的入参、中断信号和进度上报口。
- **入参**（`payload`）：入队时你自己给的参数，原样放在 `ctx.payload` 里。

下面按「先跑一个最小的，再把真实业务接进来」的顺序走。

## 第一步：写处理函数

一个任务的核心就是你写的这个函数：

```ts
async run(ctx) {
  for (let step = 1; step <= 3; step += 1) {
    await new Promise(resolve => setTimeout(resolve, 200));
    ctx.report(step, 3);
  }
}
```

`ctx.report(已完成, 总数)` 是这里唯一必须记住的调用，界面上的进度条靠它。进度只保存已完成和总数，百分比由界面自己算。`ctx.signal` 管暂停和取消，后面讲。

## 第二步：包成任务定义

调度器需要知道这个函数叫什么、能同时跑几个：

```ts
const demoTask: TaskDefinition = {
  taskType: 'demo',
  maxConcurrency: 1,
  run: async ctx => {
    for (let step = 1; step <= 3; step += 1) {
      await new Promise(resolve => setTimeout(resolve, 200));
      ctx.report(step, 3);
    }
  },
};
```

`taskType` 是任务类型的名字；`maxConcurrency` 是这个类型最多同时跑几个。`pausable` 为 `false` 时表示任务暂停后无法续跑，暂停请求会被拒绝；省略时默认可暂停。

## 第三步：交给调度器

调度器在装配根创建一次，注册你想让它支持的所有任务类型：

```ts
const scheduler = new TaskScheduler({
  taskRepo: repos.taskRepo,
  definitions: [demoTask],
  workspace: createTaskWorkspace(paths.taskWorkDir),
});
scheduler.start();
```

`taskRepo` 指向任务表，`definitions` 是任务类型清单，`workspace` 是任务临时目录。调用 `start()` 之后调度器才开始取任务；不调用它，入队后什么都不会发生。

## 第四步：入队，看它跑

```ts
scheduler.enqueue({ taskType: 'demo', payload: {} });
```

`payload` 是这次任务自己的参数，函数里通过 `ctx.payload` 取。控制台会依次出现 `created`、`updated`、`progress`、`settled`；`progress` 按 500ms 节流，三步的任务通常只看到最后一次。

## 把真实业务接进来

真实任务不用改结构，只是把原来的处理循环放进 `run`：

```ts
async run(ctx) {
  const { inputId } = ctx.payload as { inputId: string };

  // 业务自己的准备与写入，与任务系统无关；下面只标出需要配合的位置。
  const units = await loadUnits(inputId);

  for (let index = 0; index < units.length; index += 1) {
    if (ctx.signal.aborted) throw new Error('任务已中止');
    await saveUnit(inputId, index, units[index]);
    ctx.report(index + 1, units.length);
  }
}
```

三处配合各管一件事：

- **`ctx.signal`**：暂停和取消只发出 abort，不会终止 Promise。每个单元前检查一次，任务才能停在单元边界。
- **`saveUnit`**：写入要按稳定键覆盖。崩溃恢复和失败重试都会重派同一个任务，追加写会留下重复数据。
- **`ctx.report`**：数字只是给界面看的快照。恢复时应该查领域表算出已完成多少，而不是相信上次上报的值。

`ctx.workspaceDir` 是任务专属临时目录，完成或取消时删除，失败或暂停时保留，适合放临时文件、下载缓存这类可丢的中间文件。不用它也可以。

## 暂停、恢复、取消

运行中的任务暂停时，调度器只能发出 abort，不会立刻把行写成 `paused`——要等函数停下来才写。所以函数必须自己检查 `ctx.signal`。

恢复时怎么续跑由函数自己决定：查领域表跳过已完成的单元，或者从头重跑；调度器不记录续跑模式。声明 `pausable: false` 的任务，暂停请求会被直接拒绝。

取消会删任务行和临时目录，领域产物不动。重试只对 `failed` 任务有效，保留入参、进度和临时目录。两者都会等旧执行退出，避免同一任务跑两份。

**试试破坏它**：删掉例子里的 `if (ctx.signal.aborted)` 再暂停任务。函数会继续跑完，暂停请求在 5 秒宽限后返回 `abort_timeout`，任务变成 `failed`。

## 崩溃恢复与退出

`start()` 会把上次残留的 `running` 全部改判成 `queued`，中断的任务自动续跑；`paused` 和 `failed` 保持不变。

这也是写入必须幂等的原因：重启后没有内存状态可用，只有领域表里的行。

退出时调度器 abort 所有运行中的任务，最多等 200ms。没停稳的行保持 `running`，下次启动恢复成 `queued`。函数在 abort 之后不能再假设自己还拥有数据库。

## 容易踩的坑

- 入队不自动去重：同一件事连点两次会排两个任务，单飞由领域自己查。
- 用 `report` 当断点：恢复后应该数领域表。
- 忘记检查 `signal`：暂停会变成失败。
- 非幂等写入：恢复或重试后出现重复数据。
- 删掉任务类型：历史任务找不到处理器，落 `NO_HANDLER`。
- 把并发当全局：每个类型独立限流。
- 拿任务行当历史：完成和取消会删行，只有失败行保留。
