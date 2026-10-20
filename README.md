# winAIwriting

面向中文网络小说的本地 AI 工作台。以 OpenWork 源码为基础，复用其 React 控件、视觉样式与 Electron 工具链，通过本地 OpenCode agent 执行写作。无需部署云端后端。

## 已完成的基础

- 六阶段：意图 → 时间线 → 小事件 → 场景扩写 → 完整章节 → 风格核对。
- 生成与确认分离；每步可补充细节、重新生成，保存输入、来源、模型和版本。
- 修改上游会撤销下游确认，保留旧稿；全部确认后才能定稿。
- 空白项目自带三份原创临时参考；与本书已定稿正文混合检索。用户主动点击后才整理正文，按本地规则初分战斗、写景、对白等，标签可修正。
- 项目文件夹保存、浏览器本地缓存、JSON 备份与恢复、定稿 Markdown、六个技能和 novelist agent。
- 明确标记的演示模式，不需要模型密钥；OpenCode V1 HTTP 适配器。

演示模式使用固定原创示例，**不会真正按修改要求改写**，用于验证操作流程。真实改写由 OpenCode 模式执行。

## 开发

需要 **Node.js 24** 和 pnpm（上游 workspace 使用 pnpm 11）。在仓库根目录执行：

```powershell
pnpm install --filter @openwork/app... --filter @openwork/desktop... --frozen-lockfile
pnpm writing:dev
```

打开 `http://127.0.0.1:5188/writing.html`。可以载入演示项目，逐步生成、确认和修改。

```powershell
pnpm writing:test
pnpm writing:typecheck
pnpm writing:build
pnpm writing:desktop
pnpm writing:package
```

`writing:desktop` 打开独立 Windows 桌面窗口。`writing:package` 生成 Windows x64 ZIP（未签名），输出到 `dist/writing-desktop/release`。首次安装需要允许 Electron 下载其运行时。原版 OpenWork 的命令仍保留，但不作为本产品的默认入口。

## 连接真实模型

1. 在小说工作台打开项目文件夹；应用会写入 `.opencode/agents/novelist.md` 和六个本地 skills。已有同名角色/技能保持不变。
2. 用 OpenWork 打开同一个文件夹，配置模型，并启动其 OpenCode V1 引擎。也可在该文件夹运行兼容 V1 的 `opencode serve`。
3. 在“小说与模型”中选择 OpenCode，填写引擎 URL、项目绝对路径和可选的 `provider/model`；认证请求头只在当前页面内存中保存。
4. 检查连接后生成。浏览器预览要求引擎允许该来源的 CORS；不要关闭浏览器安全设置。桌面版本也须配置相应引擎访问策略。

应用不内置模型密钥，不自动安装、启动或下载 OpenCode 引擎。当前适配契约为 `/session`、`/session/{id}/message`、`/session/{id}/abort`，与上游依赖 `@opencode-ai/sdk` 的 V1 形状匹配；升级 V2 前需要新增适配与契约测试。

## 项目目录

```text
project.json                       # 权威状态、确认记录、所有历史版本
chapters/<run-id>.md                # 已定稿正文
workflow/<run-id>/<stage>/v*.md     # 各阶段历史产物
references/temporary/*.md           # 临时参考原文
references/manuscript/*.md          # 主动整理的本书正文
.opencode/agents/novelist.md        # 小说专用角色
.opencode/skills/novel-*/SKILL.md    # 六个阶段技能
```

桌面通过受限 IPC 保存文件，浏览器通过目录授权保存。仅浏览器缓存时，数据受浏览器清理和容量限制；请连接项目文件夹或下载备份。文件夹中的派生 Markdown 用于查看，重新打开以 `project.json` 为准；尚未实现外部编辑冲突合并。

## 代码入口

- `apps/app/src/writing/model.ts`：阶段状态、确认、失效处理、索引及检索。
- `apps/app/src/writing/runtime.ts`：阶段输入装配、演示引擎、OpenCode 适配。
- `apps/app/src/writing/main.tsx`：小说工作区和阶段确认面板。
- `apps/app/src/writing/storage.ts`：项目读写和文件导出。
- `apps/desktop/electron/writing-files.mjs`：桌面目录访问与原子写入。
- `docs/WRITING_ARCHITECTURE.md`：模块边界和数据约定。

## 上游与许可

本项目的 CI 为 `.github/workflows/writing.yml`，在 Windows/Linux 上检查小说模块。上游依赖其私有服务、密钥和发布环境的 workflows 保存在 `docs/upstream-workflows`，避免新仓库触发无关的部署或发布任务。

上游为 [different-ai/openwork](https://github.com/different-ai/openwork)，通过 `upstream` remote 跟踪；原说明保存在 [docs/OPENWORK_UPSTREAM.md](docs/OPENWORK_UPSTREAM.md)。保留上游源码、版权与目录许可证。`ee/` 有独立许可证，本地小说入口不依赖 Den/EE 运行。新增小说模块按仓库 MIT 条款提供。

这是一版可运行的项目基础，不代表已验证文学质量。真实付费模型生成、完整上游桌面构建和签名发布需分别验证。
