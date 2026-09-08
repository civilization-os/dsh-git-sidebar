# dsh-git-sidebar

DeepSeek Harness 的 Git 侧边栏与 Diff 查看插件，基于 `dsh-better-sidebar` 的公开扩展服务。

## 安装

```powershell
dsh plugin --profile web add @civilization/dsh-git-sidebar --registry=https://registry.npmjs.org/
```

## 产品范围

Git 与 Diff 放在同一个插件中：Git 面板负责仓库导航，Diff 视图负责阅读选中的变更，两者共享当前会话的工作目录与仓库上下文。

当前功能：

- 显示当前仓库、分支及工作区状态。
- 按“暂存 / 未暂存 / 未跟踪”分组展示变更文件。
- 点击变更文件打开 Diff；支持单栏统一视图和旧/新文件双栏视图，未跟踪文本文件按完整新增展示。
- 展示提交历史，点击提交查看提交 Diff。
- 支持刷新、暂存、取消暂存与丢弃单文件更改；破坏性操作必须使用 Harness 统一确认对话框。
- 使用 Harness 设计变量和现有组件，避免浏览器原生 `alert` / `confirm`。

## 当前状态

- 已注册 Git 侧边栏与 `.diff` / `.patch` 文件查看器。
- 支持刷新、暂存、取消暂存、提交和带自定义确认弹窗的单文件丢弃。
- Git 内提供快速 Diff 预览，也能将 Diff 拉出为独立工作台标签；独立标签可继续使用侧边栏自带的拖拽、停靠和浮窗操作。
- Git 功能设置包含自动刷新、刷新间隔、未跟踪文件、历史数量、默认 Diff 布局和打开位置；Diff 文件预览设置包含长行自动换行。

## Host 集成

插件复用 `dsh-better-sidebar` 0.18.0 的 `/sidebar/api/git.*` 路由。仓库发现、工作区边界、会话归属和 Git 目标校验都由 Host 处理，插件不自行启动 Git 进程。

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
