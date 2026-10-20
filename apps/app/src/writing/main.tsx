import React, { useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  BookOpen,
  FolderOpen,
  Download,
  Library,
  Settings,
  History,
  Plus,
  Check,
  Circle,
  FileText,
  Square,
  ChevronRight,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { marked } from "marked";
import DOMPurify from "dompurify";
import { ZodError } from "zod";
import {
  approve,
  assertReady,
  currentRevision,
  finalize,
  log,
  newProject,
  newRun,
  organize,
  projectSchema,
  saveRevision,
  selectReferences,
  stages,
  uid,
  categories,
  type Project,
  type Reference,
} from "./model.ts";
import {
  browserStorage,
  chooseProject,
  download,
  readCachedProject,
  type ProjectStorage,
} from "./storage.ts";
import {
  buildPrompt,
  generateDemo,
  OpenCodeEngine,
  type EngineSettings,
} from "./runtime.ts";
import "../app/index.css";
import "./writing.css";

function initialProject() {
  try {
    return { project: readCachedProject() ?? newProject(), error: "" };
  } catch {
    return {
      project: newProject(),
      error:
        "本地缓存读取失败。未覆盖原缓存，请导入项目备份或重新打开项目文件夹。",
    };
  }
}
function stamp(value: string) {
  return new Date(value).toLocaleString("zh-CN");
}
const statusText = {
  pending: "未生成",
  waiting: "待确认",
  approved: "已确认",
  stale: "需要更新",
};
type View = "writing" | "library" | "settings" | "history";

function App() {
  const [initial] = useState(initialProject);
  const [project, setProject] = useState(initial.project);
  const [error, setError] = useState(initial.error);
  const [notice, setNotice] = useState("");
  const [view, setView] = useState<View>("writing");
  const [runId, setRunId] = useState(initial.project.runs[0]?.id ?? "");
  const [stepIndex, setStepIndex] = useState(0);
  const [versionIndex, setVersionIndex] = useState<number | null>(null);
  const [feedback, setFeedback] = useState("");
  const [busy, setBusy] = useState("");
  const lock = useRef(false);
  const abort = useRef<AbortController | null>(null);
  const storage = useRef<ProjectStorage>(browserStorage);
  const [storageLabel, setStorageLabel] = useState(browserStorage.label);
  const [engine, setEngine] = useState<EngineSettings>({
    mode: "demo",
    url: "http://127.0.0.1:4096",
    directory: "",
    model: "",
    token: "",
  });
  const [chapterTitle, setChapterTitle] = useState("第一章");
  const [request, setRequest] = useState("");
  const [newReference, setNewReference] = useState({ title: "", text: "" });
  const [libraryFilter, setLibraryFilter] = useState("");
  const run = project.runs.find((item) => item.id === runId);
  const step = run?.steps[stepIndex];
  const revision = step
    ? versionIndex === null
      ? currentRevision(step)
      : step.revisions[versionIndex]
    : undefined;
  const isCurrent =
    versionIndex === null || versionIndex === (step?.revisions.length ?? 0) - 1;
  const canGenerate =
    !!run &&
    run.steps.slice(0, stepIndex).every((item) => item.status === "approved");
  const canFinalize =
    !!run &&
    run.steps.every((item) => item.status === "approved") &&
    !run.finalizedAt;

  async function perform(label: string, operation: () => Promise<void>) {
    if (lock.current) return;
    lock.current = true;
    setBusy(label);
    setError("");
    setNotice("");
    try {
      await operation();
    } catch (problem) {
      if (problem instanceof DOMException && problem.name === "AbortError")
        setNotice("已停止，已保存的版本保持不变。");
      else if (problem instanceof ZodError)
        setError("项目数据或输入格式不正确，请检查备份文件及输入内容。");
      else
        setError(
          problem instanceof Error ? problem.message : "操作失败，请重试。",
        );
    } finally {
      lock.current = false;
      setBusy("");
      abort.current = null;
    }
  }
  async function commit(next: Project) {
    const validated = projectSchema.parse(next);
    await storage.current.save(validated);
    setProject(validated);
  }
  async function mutate(change: (next: Project) => void) {
    const next = structuredClone(project);
    change(next);
    await commit(next);
  }
  async function generate() {
    if (!run || !step) return;
    await perform("正在生成本阶段", async () => {
      assertReady(run, stepIndex);
      const controller = new AbortController();
      abort.current = controller;
      const references = selectReferences(
        project,
        `${run.request}\n${feedback}`,
      );
      const input = { project, run, index: stepIndex, feedback, references };
      const signal = AbortSignal.any([
        controller.signal,
        AbortSignal.timeout(240_000),
      ]);
      const result =
        engine.mode === "demo"
          ? await generateDemo(input, signal)
          : await new OpenCodeEngine(engine).generate(input, signal);
      signal.throwIfAborted();
      await mutate((next) => {
        const target = next.runs.find((item) => item.id === run.id);
        if (!target) throw new Error("章节已不存在");
        saveRevision(target, stepIndex, {
          id: uid(),
          content: result.content,
          feedback,
          references,
          prompt: buildPrompt(input),
          model: result.model,
          createdAt: new Date().toISOString(),
          ...(result.sessionId ? { sessionId: result.sessionId } : {}),
        });
        next.references = next.references.filter(
          (ref) => ref.id !== `chapter-${run.id}`,
        );
        log(
          next,
          "生成阶段",
          `${run.title} / ${stages[stepIndex].title}${feedback ? ` / 修改要求：${feedback}` : ""}`,
        );
      });
      setFeedback("");
      setVersionIndex(null);
    });
  }
  function selectStep(index: number) {
    if (!busy) {
      setStepIndex(index);
      setVersionIndex(null);
      setFeedback("");
    }
  }
  async function openFolder() {
    await perform("正在打开项目", async () => {
      const result = await chooseProject();
      if (!result) return;
      if (result.project) {
        setProject(result.project);
        setRunId(result.project.runs[0]?.id ?? "");
        await browserStorage.save(result.project);
      } else await result.storage.save(project);
      storage.current = result.storage;
      setStorageLabel(result.storage.label);
      setStepIndex(0);
      setVersionIndex(null);
      setNotice("项目文件夹已连接，后续操作会保存到这里。");
    });
  }
  async function createChapter(event: React.FormEvent) {
    event.preventDefault();
    await perform("正在创建章节", async () => {
      const created = newRun(chapterTitle, request);
      await mutate((next) => {
        next.runs.push(created);
        log(next, "创建章节", created.title);
      });
      setRunId(created.id);
      setStepIndex(0);
      setVersionIndex(null);
      setRequest("");
      setView("writing");
      setChapterTitle(`第${project.runs.length + 2}章`);
    });
  }
  async function addFiles(files: FileList | null) {
    if (!files) return;
    await perform("正在导入素材", async () => {
      const additions: Reference[] = [];
      for (const file of Array.from(files)) {
        if (file.size > 1_000_000)
          throw new Error(`${file.name} 超过 1 MB，请按章节拆分后导入`);
        const text = await file.text();
        if (text.includes("\u0000"))
          throw new Error("请选择 UTF-8 编码的 TXT 或 Markdown 文件");
        additions.push({
          id: uid(),
          title: file.name,
          text,
          kind: "temporary",
          tags: [],
          source: file.name,
          indexed: false,
        });
      }
      await mutate((next) => {
        next.references.push(...additions);
        log(next, "导入参考", `${additions.length} 个来源`);
      });
    });
  }

  return (
    <div className="writing-shell">
      <aside className="writing-sidebar">
        <div className="writing-brand">
          <BookOpen size={20} />
          <strong>winAIwriting</strong>
        </div>
        <div className="writing-project">
          <span className="text-muted-foreground text-xs">当前小说</span>
          <strong>{project.title}</strong>
        </div>
        <nav aria-label="工作区导航">
          {(
            [
              ["writing", "章节写作", FileText],
              ["library", "参考素材", Library],
              ["history", "操作记录", History],
              ["settings", "小说与模型", Settings],
            ] as const
          ).map(([id, title, Icon]) => (
            <Button
              key={id}
              variant={view === id ? "secondary" : "ghost"}
              disabled={!!busy}
              className="writing-nav"
              onClick={() => setView(id)}
            >
              <Icon size={16} />
              {title}
            </Button>
          ))}
        </nav>
        <div className="writing-sidebar-heading">
          <span>章节</span>
          <span>{project.runs.length}</span>
        </div>
        <div className="writing-chapters">
          {project.runs.map((item) => (
            <Button
              key={item.id}
              variant={
                item.id === runId && view === "writing" ? "secondary" : "ghost"
              }
              disabled={!!busy}
              className="writing-nav"
              onClick={() => {
                setRunId(item.id);
                selectStep(
                  item.steps.findIndex((s) => s.status !== "approved") < 0
                    ? 5
                    : item.steps.findIndex((s) => s.status !== "approved"),
                );
                setView("writing");
              }}
            >
              <FileText size={15} />
              <span className="truncate">{item.title}</span>
              {item.finalizedAt && <Check size={14} className="ml-auto" />}
            </Button>
          ))}
        </div>
        <details className="writing-new" open={!project.runs.length}>
          <summary>
            <Plus size={14} />
            新建章节
          </summary>
          <form onSubmit={createChapter} className="writing-form">
            <Label htmlFor="chapter-title">章节标题</Label>
            <Input
              id="chapter-title"
              value={chapterTitle}
              onChange={(e) => setChapterTitle(e.target.value)}
              required
              disabled={!!busy}
            />
            <Label htmlFor="chapter-request">本章想写什么</Label>
            <Textarea
              id="chapter-request"
              value={request}
              onChange={(e) => setRequest(e.target.value)}
              placeholder="人物目标、冲突、必须出现或避免的细节……"
              rows={5}
              required
              disabled={!!busy}
            />
            <Button type="submit" disabled={!!busy}>
              创建章节
            </Button>
          </form>
        </details>
        <div className="writing-sidebar-bottom">
          <span className="writing-mode">
            {engine.mode === "demo" ? "演示模式 · 未调用模型" : "OpenCode 模式"}
          </span>
          <span className="text-muted-foreground text-xs break-all">
            {storageLabel}
          </span>
        </div>
      </aside>
      <main className="writing-main">
        <header className="writing-header">
          <div>
            <span className="text-muted-foreground">{project.title}</span>
            <ChevronRight size={14} />
            <strong>
              {view === "writing"
                ? (run?.title ?? "章节写作")
                : view === "library"
                  ? "参考素材"
                  : view === "history"
                    ? "操作记录"
                    : "小说与模型"}
            </strong>
          </div>
          <div>
            <Button
              variant="ghost"
              size="sm"
              disabled={!!busy}
              onClick={() => void openFolder()}
            >
              <FolderOpen />
              打开项目文件夹
            </Button>
            <Button
              variant="outline"
              size="sm"
              disabled={!!busy}
              onClick={() =>
                download("novel-project.json", JSON.stringify(project, null, 2))
              }
            >
              <Download />
              备份项目
            </Button>
          </div>
        </header>
        {(error || notice) && (
          <div
            role={error ? "alert" : "status"}
            className={`writing-message ${error ? "text-destructive" : "text-muted-foreground"}`}
          >
            {error || notice}
          </div>
        )}
        {view === "writing" &&
          (run && step ? (
            <div className="writing-workspace">
              <div className="writing-stagebar" aria-label="生成阶段">
                {stages.map((stage, index) => (
                  <Button
                    key={stage.id}
                    variant={stepIndex === index ? "secondary" : "ghost"}
                    disabled={!!busy}
                    onClick={() => selectStep(index)}
                    className="writing-stage"
                  >
                    <span className="writing-stage-number">
                      {run.steps[index].status === "approved" ? (
                        <Check size={14} />
                      ) : (
                        index + 1
                      )}
                    </span>
                    <span>
                      {stage.title}
                      <small>{statusText[run.steps[index].status]}</small>
                    </span>
                  </Button>
                ))}
              </div>
              <div className="writing-editor-layout">
                <section className="writing-document">
                  <div className="writing-document-heading">
                    <h1>{stages[stepIndex].title}</h1>
                    <span className="text-xs text-muted-foreground">
                      {step.status === "stale"
                        ? "上游已修改，此结果需要更新"
                        : statusText[step.status]}
                      {revision
                        ? ` · v${step.revisions.indexOf(revision) + 1}`
                        : ""}
                    </span>
                  </div>
                  {revision ? (
                    <article
                      className="writing-prose writing-markdown"
                      aria-label="阶段产物"
                      dangerouslySetInnerHTML={{
                        __html: DOMPurify.sanitize(
                          marked.parse(revision.content, { async: false }),
                          {
                            ALLOWED_TAGS: [
                              "p",
                              "br",
                              "h1",
                              "h2",
                              "h3",
                              "h4",
                              "strong",
                              "em",
                              "blockquote",
                              "ul",
                              "ol",
                              "li",
                              "pre",
                              "code",
                              "hr",
                            ],
                            ALLOWED_ATTR: [],
                          },
                        ),
                      }}
                    />
                  ) : (
                    <div className="writing-empty">
                      <Circle size={28} />
                      <h2>
                        {canGenerate
                          ? `开始生成${stages[stepIndex].title}`
                          : "等待前序阶段确认"}
                      </h2>
                      <p>
                        {canGenerate
                          ? stages[stepIndex].hint
                          : "可以查看前面的产物，并补充你希望保留的细节。"}
                      </p>
                    </div>
                  )}
                  <div className="writing-controls">
                    <Label htmlFor="feedback">补充细节或修改要求</Label>
                    <Textarea
                      id="feedback"
                      value={feedback}
                      onChange={(e) => setFeedback(e.target.value)}
                      rows={3}
                      placeholder="例如：E3 不要直接救场；让主角通过对方的称呼发现破绽。"
                      disabled={!!busy || !canGenerate}
                    />
                    <div className="writing-actions">
                      <span className="text-xs text-muted-foreground">
                        {busy ||
                          (run.finalizedAt
                            ? "本章已定稿"
                            : "每一步确认后才会推进")}
                      </span>
                      {busy && abort.current ? (
                        <Button
                          variant="outline"
                          onClick={() => abort.current?.abort()}
                        >
                          <Square />
                          停止生成
                        </Button>
                      ) : (
                        <>
                          <Button
                            variant="outline"
                            disabled={!canGenerate || !!busy}
                            onClick={() => void generate()}
                          >
                            {revision
                              ? feedback.trim()
                                ? "按要求修改"
                                : "重新生成本步"
                              : "生成本阶段"}
                          </Button>
                          {step.status === "waiting" && isCurrent && (
                            <Button
                              disabled={!!busy}
                              onClick={() =>
                                void perform("正在保存确认", async () => {
                                  await mutate((next) => {
                                    const target = next.runs.find(
                                      (item) => item.id === run.id,
                                    )!;
                                    approve(target, stepIndex);
                                    log(
                                      next,
                                      "确认阶段",
                                      `${run.title} / ${stages[stepIndex].title} / ${currentRevision(target.steps[stepIndex])?.id}`,
                                    );
                                  });
                                  selectStep(Math.min(stepIndex + 1, 5));
                                  setStepIndex(Math.min(stepIndex + 1, 5));
                                  setVersionIndex(null);
                                })
                              }
                            >
                              确认{stepIndex < 5 ? "并继续" : "风格核对"}
                            </Button>
                          )}
                          {canFinalize && (
                            <Button
                              onClick={() =>
                                void perform("正在定稿", async () => {
                                  await mutate((next) => {
                                    finalize(
                                      next.runs.find(
                                        (item) => item.id === run.id,
                                      )!,
                                    );
                                    log(next, "章节定稿", run.title);
                                  });
                                  setNotice(
                                    "已定稿。可在参考素材页主动整理本章。",
                                  );
                                })
                              }
                            >
                              定稿本章
                            </Button>
                          )}
                        </>
                      )}
                    </div>
                  </div>
                </section>
                <aside className="writing-inspector">
                  <h2>本步记录</h2>
                  <div className="writing-inspector-row">
                    <span>历史版本</span>
                    <span>{step.revisions.length}</span>
                  </div>
                  {step.revisions.map((item, index) => (
                    <Button
                      key={item.id}
                      variant={revision?.id === item.id ? "secondary" : "ghost"}
                      size="sm"
                      className="writing-version"
                      disabled={!!busy}
                      onClick={() => setVersionIndex(index)}
                    >
                      <span>
                        v{index + 1}
                        {item.id === step.approvedRevisionId ? " · 已确认" : ""}
                      </span>
                      <small>{stamp(item.createdAt)}</small>
                    </Button>
                  ))}
                  {revision && (
                    <>
                      <div className="writing-inspector-row">
                        <span>生成来源</span>
                      </div>
                      <p className="text-xs text-muted-foreground">
                        {revision.model}
                      </p>
                      {revision.feedback && (
                        <details open>
                          <summary>本轮修改要求</summary>
                          <p className="text-xs whitespace-pre-wrap">
                            {revision.feedback}
                          </p>
                        </details>
                      )}
                      <details open>
                        <summary>
                          参考来源 · {revision.references.length}
                        </summary>
                        {revision.references.length ? (
                          revision.references.map((ref, index) => (
                            <details key={`${ref.sourceId}-${index}`}>
                              <summary>
                                {ref.title} ·{" "}
                                {ref.kind === "temporary" ? "临时" : "本书"}
                              </summary>
                              <p className="text-xs whitespace-pre-wrap">
                                {ref.excerpt}
                              </p>
                              <small>{ref.source}</small>
                            </details>
                          ))
                        ) : (
                          <p className="text-xs text-muted-foreground">
                            本步未使用参考片段
                          </p>
                        )}
                      </details>
                      <details>
                        <summary>查看完整输入</summary>
                        <pre className="writing-input-record">
                          {revision.prompt}
                        </pre>
                      </details>
                    </>
                  )}
                </aside>
              </div>
            </div>
          ) : (
            <div className="writing-welcome">
              <BookOpen size={36} />
              <h1>从一章开始</h1>
              <p>在左侧写下本章想法，或载入演示项目验证整个流程。</p>
              <div className="writing-actions">
                <Button
                  onClick={() => {
                    document.getElementById("chapter-request")?.focus();
                  }}
                >
                  填写本章想法
                </Button>
                <Button
                  variant="outline"
                  disabled={!!busy}
                  onClick={() =>
                    void perform("正在载入演示", async () => {
                      const demo = newProject("雨夜来信");
                      demo.brief =
                        "古城雨夜，主角赴约接取一封密信。接头人失约，信物牵涉一桩旧案。";
                      demo.style =
                        "克制的限知叙述，短对白，以动作与可观察的细节制造悬念。";
                      demo.references = [
                        {
                          id: uid(),
                          title: "自编示例 · 雨中的街巷",
                          kind: "temporary",
                          text: "巷口的灯被风吹歪了。水沿着砖缝流过去，把一枚铜钱推到他脚边。",
                          tags: ["写景"],
                          source: "内置原创示例",
                          indexed: true,
                        },
                        {
                          id: uid(),
                          title: "自编示例 · 交手",
                          kind: "temporary",
                          text: "刀背压下来时，他退了半步。鞋底碾碎一块瓦片，手里的短棍已抵住对方腕骨。",
                          tags: ["战斗"],
                          source: "内置原创示例",
                          indexed: true,
                        },
                      ];
                      const chapter = newRun(
                        "第一章 · 城门",
                        "主角抵达城门，发现接头人失约；通过细节识破试探，结尾留下门后的悬念。",
                      );
                      demo.runs.push(chapter);
                      storage.current = browserStorage;
                      setStorageLabel(browserStorage.label);
                      await commit(demo);
                      setRunId(chapter.id);
                      setStepIndex(0);
                    })
                  }
                >
                  载入演示项目
                </Button>
              </div>
            </div>
          ))}
        {view === "library" && (
          <section className="writing-page">
            <div className="writing-page-title">
              <h1>参考素材</h1>
              <Button
                disabled={!!busy}
                onClick={() =>
                  void perform("正在整理素材", async () => {
                    await mutate(organize);
                    setNotice(
                      "整理完成：按本地关键词规则初分，可手动修正标签。原文保持不变。",
                    );
                  })
                }
              >
                整理已完成内容
              </Button>
            </div>
            <div className="writing-library-counts">
              <span>
                {
                  project.references.filter((ref) => ref.kind === "temporary")
                    .length
                }{" "}
                份临时素材
              </span>
              <span>
                {
                  project.references.filter((ref) => ref.kind === "manuscript")
                    .length
                }{" "}
                份本书正文
              </span>
              <span>
                {project.runs.filter((item) => item.finalizedAt).length}{" "}
                章已定稿
              </span>
            </div>
            <div className="writing-library-tools">
              <Label htmlFor="reference-files">导入临时素材</Label>
              <Input
                id="reference-files"
                type="file"
                accept=".md,.txt"
                multiple
                disabled={!!busy}
                onChange={(e) => {
                  void addFiles(e.target.files);
                  e.target.value = "";
                }}
              />
              <Label htmlFor="reference-filter">筛选分类</Label>
              <Input
                id="reference-filter"
                placeholder="战斗、写景、对白……"
                value={libraryFilter}
                onChange={(e) => setLibraryFilter(e.target.value)}
              />
            </div>
            <details>
              <summary>粘贴参考片段</summary>
              <form
                className="writing-form"
                onSubmit={(event) => {
                  event.preventDefault();
                  void perform("正在保存素材", async () => {
                    await mutate((next) => {
                      next.references.push({
                        id: uid(),
                        title: newReference.title,
                        text: newReference.text,
                        kind: "temporary",
                        tags: [],
                        source: "手动添加",
                        indexed: false,
                      });
                      log(next, "添加参考", newReference.title);
                    });
                    setNewReference({ title: "", text: "" });
                  });
                }}
              >
                <Label htmlFor="ref-title">来源名称</Label>
                <Input
                  id="ref-title"
                  required
                  value={newReference.title}
                  onChange={(e) =>
                    setNewReference({ ...newReference, title: e.target.value })
                  }
                />
                <Label htmlFor="ref-text">参考原文</Label>
                <Textarea
                  id="ref-text"
                  required
                  rows={5}
                  value={newReference.text}
                  onChange={(e) =>
                    setNewReference({ ...newReference, text: e.target.value })
                  }
                />
                <Button disabled={!!busy} type="submit">
                  保存参考
                </Button>
              </form>
            </details>
            {!project.references.length && (
              <div className="writing-empty">
                <Library size={28} />
                <h2>还没有参考素材</h2>
                <p>导入临时文本，或在章节定稿后主动整理。</p>
              </div>
            )}
            {project.references
              .filter(
                (ref) =>
                  !libraryFilter ||
                  ref.tags.some((tag) => tag.includes(libraryFilter)) ||
                  ref.title.includes(libraryFilter),
              )
              .map((ref) => (
                <details className="writing-reference" key={ref.id}>
                  <summary>
                    <span>{ref.title}</span>
                    <span className="text-xs text-muted-foreground">
                      {ref.kind === "temporary" ? "临时素材" : "本书正文"} ·{" "}
                      {ref.indexed ? ref.tags.join(" / ") : "未整理"}
                    </span>
                  </summary>
                  <p className="writing-prose">{ref.text}</p>
                  <div className="writing-tags">
                    {categories.map((tag) => (
                      <label key={tag}>
                        <input
                          type="checkbox"
                          disabled={!!busy}
                          checked={ref.tags.includes(tag)}
                          onChange={() =>
                            void perform("正在保存分类", async () => {
                              await mutate((next) => {
                                const target = next.references.find(
                                  (r) => r.id === ref.id,
                                )!;
                                target.tags = target.tags.includes(tag)
                                  ? target.tags.filter((t) => t !== tag)
                                  : [...target.tags, tag];
                                target.indexed = true;
                                log(next, "修改分类", `${ref.title} / ${tag}`);
                              });
                            })
                          }
                        />
                        {tag}
                      </label>
                    ))}
                    <Button
                      size="xs"
                      variant="ghost"
                      disabled={!!busy}
                      onClick={() =>
                        void perform("正在移除参考", async () => {
                          await mutate((next) => {
                            next.references = next.references.filter(
                              (r) => r.id !== ref.id,
                            );
                            log(next, "移除参考", ref.title);
                          });
                        })
                      }
                    >
                      移出参考库
                    </Button>
                  </div>
                </details>
              ))}
          </section>
        )}
        {view === "settings" && (
          <section className="writing-page writing-settings">
            <h1>小说与模型</h1>
            <form
              className="writing-form"
              onSubmit={(event) => {
                event.preventDefault();
                const data = new FormData(event.currentTarget);
                void perform("正在保存设定", async () => {
                  await mutate((next) => {
                    next.title = String(data.get("title") ?? "").trim();
                    next.brief = String(data.get("brief") ?? "");
                    next.style = String(data.get("style") ?? "");
                    log(next, "保存设定", next.title);
                  });
                  setNotice("小说设定已保存，将用于下一次生成。");
                });
              }}
            >
              <Label htmlFor="novel-title">小说名称</Label>
              <Input
                id="novel-title"
                name="title"
                defaultValue={project.title}
                required
                maxLength={160}
              />
              <Label htmlFor="novel-brief">本书事实与设定</Label>
              <Textarea
                id="novel-brief"
                name="brief"
                rows={5}
                defaultValue={project.brief}
              />
              <Label htmlFor="novel-style">写作风格与偏好</Label>
              <Textarea
                id="novel-style"
                name="style"
                rows={4}
                defaultValue={project.style}
              />
              <Button type="submit" disabled={!!busy}>
                保存小说设定
              </Button>
            </form>
            <div className="writing-divider" />
            <h2>生成引擎</h2>
            <div className="writing-mode-options">
              <Button
                variant={engine.mode === "demo" ? "secondary" : "outline"}
                onClick={() => setEngine({ ...engine, mode: "demo" })}
              >
                演示模式
              </Button>
              <Button
                variant={engine.mode === "opencode" ? "secondary" : "outline"}
                onClick={() => setEngine({ ...engine, mode: "opencode" })}
              >
                OpenCode
              </Button>
            </div>
            {engine.mode === "opencode" && (
              <div className="writing-form">
                <Label htmlFor="engine-url">本地引擎地址</Label>
                <Input
                  id="engine-url"
                  value={engine.url}
                  onChange={(e) =>
                    setEngine({ ...engine, url: e.target.value })
                  }
                />
                <Label htmlFor="engine-directory">
                  项目绝对路径（与引擎工作目录一致）
                </Label>
                <Input
                  id="engine-directory"
                  value={engine.directory}
                  onChange={(e) =>
                    setEngine({ ...engine, directory: e.target.value })
                  }
                  placeholder="D:\\Novels\\雨夜来信"
                />
                <Label htmlFor="engine-model">
                  模型（留空使用引擎默认模型）
                </Label>
                <Input
                  id="engine-model"
                  value={engine.model}
                  onChange={(e) =>
                    setEngine({ ...engine, model: e.target.value })
                  }
                  placeholder="provider/model"
                />
                <details>
                  <summary>连接认证</summary>
                  <Label htmlFor="engine-token">
                    Authorization 请求头（仅本次会话保存）
                  </Label>
                  <Input
                    id="engine-token"
                    type="password"
                    autoComplete="off"
                    value={engine.token}
                    onChange={(e) =>
                      setEngine({ ...engine, token: e.target.value })
                    }
                  />
                </details>
                <Button
                  disabled={!!busy}
                  variant="outline"
                  onClick={() =>
                    void perform("正在检查引擎", async () => {
                      await new OpenCodeEngine(engine).check(
                        AbortSignal.timeout(10_000),
                      );
                      setNotice(
                        "引擎连接正常。生成前请确保项目目录中已安装 novelist agent。",
                      );
                    })
                  }
                >
                  检查引擎连接
                </Button>
                <p className="text-xs text-muted-foreground">
                  打开项目文件夹后会安装小说角色与 skills。模型密钥由 OpenWork /
                  OpenCode 管理。
                </p>
              </div>
            )}
            <div className="writing-divider" />
            <Label htmlFor="import-project">恢复项目备份</Label>
            <Input
              id="import-project"
              type="file"
              accept=".json"
              disabled={!!busy}
              onChange={(event) => {
                const file = event.target.files?.[0];
                event.target.value = "";
                if (file)
                  void perform("正在恢复项目", async () => {
                    const restored = projectSchema.parse(
                      JSON.parse(await file.text()),
                    );
                    await browserStorage.save(restored);
                    storage.current = browserStorage;
                    setStorageLabel(browserStorage.label);
                    setProject(restored);
                    setRunId(restored.runs[0]?.id ?? "");
                    setStepIndex(0);
                    setVersionIndex(null);
                    setNotice(
                      "备份已恢复到浏览器本地缓存，可再连接新的项目文件夹。",
                    );
                  });
              }}
            />
          </section>
        )}
        {view === "history" && (
          <section className="writing-page">
            <h1>操作记录</h1>
            {!project.history.length && (
              <p className="text-muted-foreground">尚无操作记录。</p>
            )}
            {[...project.history].reverse().map((item) => (
              <div className="writing-history" key={item.id}>
                <span>{item.action}</span>
                <p>{item.detail}</p>
                <time>{stamp(item.at)}</time>
              </div>
            ))}
          </section>
        )}
        <footer className="writing-footer">
          <span>
            <span className="writing-dot" />
            本地优先
          </span>
          <span>
            {project.runs.filter((item) => item.finalizedAt).length} 章定稿 ·{" "}
            {project.history.length} 条记录
          </span>
        </footer>
      </main>
    </div>
  );
}

const root = document.getElementById("root");
if (!root) throw new Error("页面入口不存在");
createRoot(root).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
