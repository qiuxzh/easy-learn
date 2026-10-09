## 注意事项

- 提交前把你当前任务无关的改动 stash 掉（`git stash push -- <路径>`，提交完再 `git stash pop`）。lint-staged 跑完要把未暂存的改动放回工作区，这一步失败就会中止提交，报 `Failed to restore unstaged changes`
- 提交信息用 `-m` 传，别写临时文件：PowerShell 的 utf8 带 BOM，commitlint 拒
