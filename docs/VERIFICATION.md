# 基础版验证记录

日期：2026-10-20（Asia/Shanghai）

上游基础：`different-ai/openwork` 的 `14a3876712fd5d6bfa54c137648bcb72d88f83fe`，保留 Git 历史和目录许可证。

## 本机通过

| 检查 | 结果 |
| --- | --- |
| `pnpm writing:test` | 16 项通过，0 失败、0 跳过 |
| TypeScript（包含在 writing:build/package 中） | 通过 |
| Vite production build | 通过 |
| 无界面 Chrome 生产页面流程 | 8 项通过，0 页面运行错误 |
| Windows x64 ZIP 打包 | 通过，未签名 |
| 最终打包 EXE 的隐藏启动自检 | exit 0；标题正确，React 工作台挂载，本地文件 IPC 桥存在 |

UI 流程包含：未确认不能跳步、生成停在待确认、修改保留旧版本、完整确认后定稿、定稿不自动整理、主动整理、刷新恢复、修改上游使下游失效、窄屏无横向溢出。

截图与机器可读的 UI 检查记录位于 [evidence](evidence)。界面采用 DESIGN.md 的 P1/P3/P5/P6、S1、V1/V2 和 T4 原则；用户明确要求的分阶段确认优先于上游 P8 的默认撤销交互偏好。

桌面验证使用独立临时数据目录，窗口保持隐藏，不使用日常 OpenWork 数据。启动测试发现并修复了 ESM 入口等待 ready 的问题；生产入口通过 Promise 回调启动窗口。

## 未作为通过项

- 未调用真实付费模型，没有验证文学质量；演示不计作真实生成。
- OpenCode V1 adapter 通过模拟 HTTP 契约测试；真实引擎/模型端到端仍需连接用户模型后验证。
- 素材分类当前是本地关键词初分，不是经过评估的语义分类器。
- 本机未执行 GitHub Actions 的 Linux runner；仅提供独立 Windows/Linux CI 定义。
- 原版 OpenWork/Den 的全栈构建、云服务、签名和自动更新未纳入本地小说基础版验收。

## 重现

```powershell
pnpm writing:test
pnpm writing:build
pnpm writing:package
# 隐藏测试打包产物，必须提供隔离数据目录：
$env:WINAI_WRITING_SMOKE_DIR = 'D:\\temp\\winaiwriting-smoke'
# 先创建该目录，再执行：
.\\dist\\writing-desktop\\release\\win-unpacked\\winAIwriting.exe --writing-smoke
```
