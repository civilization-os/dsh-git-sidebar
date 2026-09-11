# dsh-git-sidebar

DeepSeek Harness 的原生 Git 侧边栏与 Diff 查看插件，直接嵌入 DSH 官方右侧栏（`sidebarRightTabs`）体系。

## 安装

```powershell
dsh plugin --profile web add @civilization/dsh-git-sidebar --registry=https://registry.npmjs.org/
```

## 产品特性

Git 与 Diff 放在同一个插件中：Git 面板负责仓库导航，Diff 视图负责阅读选中的变更，两者共享当前会话的工作目录与仓库上下文。

当前功能：

- 原生接入 DSH 0.1.5+ 官方右侧栏（Guide 导航页与标签页系统），完全独立自主，无需任何第三方插件。
- 100% 遵循 DSH 官方 `--dsw-alias-*` 语义化设计系统，极致适配浅色/深色/透明壁纸皮肤。
- 显示当前仓库、分支及工作区状态，支持一键切换分支与**基于当前提交快速创建新分支**。
- **远程仓库同步**：实时展示当前分支与远程上游的领先/落后提交数（Ahead / Behind 状态徽标），支持一键执行 Pull（拉取）、Push（推送）、Fetch（抓取）与快速 Sync（同步）。
- **工作区暂存管理 (Git Stash)**：支持一键暂存未提交修改（含未跟踪文件，支持输入自定义说明），并能快速恢复与丢弃暂存（Stash Pop）。
- **变更文件列表视图切换**：支持在“树形视图 (Tree View)”与“扁平视图 (Flat View)”之间一键自由切换，多级目录支持折叠与计数。
- **完善的未跟踪文件丢弃 (Discard)**：彻底修复对未跟踪新增文件的丢弃操作，支持单个文件安全移除或一键全部丢弃未暂存变更。
- **块级暂存 (Stage / Unstage Selected Hunk)**：在统一 Diff 视图中为每个差异代码块（Hunk）提供独立的“暂存此块 / 取消暂存块”操作，实现精细化代码提交管理。
- 按“暂存的更改 / 更改”清晰分组，支持一键全部暂存、全部取消暂存与提交。
- 超大 Commit 安全熔断与多文件手风琴折叠，拒绝浏览器假死。
- 专业连续时间轴 Git 提交树（Timeline Tree Rail），带节点发光、一键复制 Commit SHA 与增量分页加载。
- 单栏统一视图（Unified）与双栏对比视图（Split）即时切换。
- 内置独立 Host 端 Git RPC 引擎，直接执行系统 Git 指令，无需依赖其它中间件。

## 技术约束

- 不修改相邻 Harness 或 `dsh-better-sidebar` 源码。
- 所有扩展记录通过 `ctx.effect` 注册并释放。
- Git 命令必须使用 argv 数组执行，不拼接 shell 字符串。
- 所有仓库路径必须限制在当前会话工作目录内，并验证解析后的绝对路径。
- 初始读取操作只读；丢弃更改等破坏性动作必须明确确认并精确限定文件。
- 不把凭据、远端令牌或完整环境变量写入结果与日志。

## 开发

```powershell
pnpm install
pnpm typecheck
pnpm build
```

本地联调时，在 Web profile 的 `package.json` 中使用：

```json
"@civilization/dsh-git-sidebar": "link:D:/project/dsh-git-sidebar"
```

插件包自带 `cordis.patch.yml`，正式安装时走 DSH bundle 通道。

## 验证与限制

- 运行 `pnpm typecheck` 和 `pnpm build`。
- 本地联调验证 Git 状态、文件与提交 Diff、暂存操作及功能设置。
- 提交文件树和多 worktree 选择器尚未实现。
- 推送到 `main` 后，GitHub Actions 会在检查通过且 npm 尚无相同版本时发布到官方 registry；发布凭据由仓库的 `NPM_TOKEN` Secret 提供。
