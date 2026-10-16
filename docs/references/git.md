## 注意事项

- 提交前先需要检查要提交的文件清单，避免把本次改动不相关的文件提交
- 提交前把你当前任务无关的改动 stash 掉（`git stash push -- <路径>`，提交完再 `git stash pop`）。
- 提交信息用 `-m` 传，别写临时文件：PowerShell 的 utf8 带 BOM，commitlint 拒
