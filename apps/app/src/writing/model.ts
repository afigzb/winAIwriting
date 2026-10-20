import { z } from "zod";
import { starterReferences } from "./reference-pack.ts";

export const stages = [
  { id: "intent", title: "本章意图", hint: "目标、视角与边界" },
  { id: "timeline", title: "故事时间线", hint: "事件顺序与转折" },
  { id: "events", title: "小事件", hint: "人物目的与因果" },
  { id: "scenes", title: "场景扩写", hint: "动作、对白与细节" },
  { id: "draft", title: "完整章节", hint: "衔接、节奏与叙述" },
  { id: "style", title: "风格核对", hint: "逐项检查与修改建议" },
] as const;
export type StageId = (typeof stages)[number]["id"];
export const categories = ["战斗", "写景", "对白", "心理", "过渡"] as const;
const safeId = z.string().regex(/^[a-zA-Z0-9_-]{1,100}$/);
export const referenceSchema = z.object({
  id: safeId,
  title: z.string().min(1).max(160),
  text: z.string().max(500_000),
  kind: z.enum(["temporary", "manuscript"]),
  tags: z.array(z.string()),
  source: z.string(),
  indexed: z.boolean(),
});
export const citationSchema = z.object({
  sourceId: z.string(),
  title: z.string(),
  kind: z.enum(["temporary", "manuscript"]),
  source: z.string(),
  excerpt: z.string(),
});
export const revisionSchema = z.object({
  id: safeId,
  content: z.string().min(1),
  feedback: z.string(),
  createdAt: z.string(),
  model: z.string(),
  sessionId: z.string().optional(),
  prompt: z.string(),
  references: z.array(citationSchema),
});
export const stepSchema = z.object({
  id: z.enum(["intent", "timeline", "events", "scenes", "draft", "style"]),
  status: z.enum(["pending", "waiting", "approved", "stale"]),
  revisions: z.array(revisionSchema),
  approvedRevisionId: z.string().nullable(),
});
export const runSchema = z.object({
  id: safeId,
  title: z.string().min(1).max(160),
  request: z.string().min(1),
  createdAt: z.string(),
  steps: z.array(stepSchema).length(6),
  finalizedAt: z.string().nullable(),
});
export const projectSchema = z
  .object({
    schemaVersion: z.literal(1),
    id: safeId,
    title: z.string().min(1).max(160),
    brief: z.string(),
    style: z.string(),
    references: z.array(referenceSchema),
    runs: z.array(runSchema),
    history: z.array(
      z.object({
        id: z.string(),
        at: z.string(),
        action: z.string(),
        detail: z.string(),
      }),
    ),
  })
  .superRefine((project, ctx) => {
    for (const run of project.runs) {
      if (run.steps.some((step, index) => step.id !== stages[index]?.id))
        ctx.addIssue({ code: "custom", message: "生成阶段顺序无效" });
      let previousApproved = true;
      for (const step of run.steps) {
        if (
          step.status === "approved" &&
          (!previousApproved ||
            !step.revisions.some((r) => r.id === step.approvedRevisionId))
        )
          ctx.addIssue({ code: "custom", message: "确认记录与版本不一致" });
        previousApproved = step.status === "approved";
      }
      if (
        run.finalizedAt &&
        run.steps.some((step) => step.status !== "approved")
      )
        ctx.addIssue({ code: "custom", message: "定稿章节缺少确认记录" });
    }
  });
export type Project = z.infer<typeof projectSchema>;
export type Run = z.infer<typeof runSchema>;
export type Revision = z.infer<typeof revisionSchema>;
export type Citation = z.infer<typeof citationSchema>;
export type Reference = z.infer<typeof referenceSchema>;
export function uid() {
  return crypto.randomUUID();
}
export function newProject(
  title = "未命名小说",
  includeStarterReferences = true,
): Project {
  return {
    schemaVersion: 1,
    id: uid(),
    title,
    brief: "",
    style: "",
    references: includeStarterReferences
      ? starterReferences.map((reference) => ({
          id: uid(),
          title: reference.title,
          text: reference.text,
          tags: [...reference.tags],
          kind: "temporary",
          source: "内置原创参考库 v1",
          indexed: true,
        }))
      : [],
    runs: [],
    history: [],
  };
}
export function newRun(title: string, request: string): Run {
  if (!title.trim() || !request.trim())
    throw new Error("请填写章节标题和写作要求");
  return {
    id: uid(),
    title: title.trim(),
    request: request.trim(),
    createdAt: new Date().toISOString(),
    finalizedAt: null,
    steps: stages.map((stage) => ({
      id: stage.id,
      status: "pending",
      revisions: [],
      approvedRevisionId: null,
    })),
  };
}
export function currentRevision(step: Run["steps"][number]) {
  return step.revisions.at(-1);
}
export function log(project: Project, action: string, detail: string) {
  project.history.push({
    id: uid(),
    at: new Date().toISOString(),
    action,
    detail,
  });
}
export function assertReady(run: Run, index: number) {
  if (!Number.isInteger(index) || index < 0 || index >= stages.length)
    throw new Error("生成阶段不存在");
  if (run.steps.slice(0, index).some((step) => step.status !== "approved"))
    throw new Error("请先确认前面的阶段");
}
export function invalidateAfter(run: Run, index: number) {
  run.finalizedAt = null;
  for (const step of run.steps.slice(index + 1)) {
    step.status = step.revisions.length ? "stale" : "pending";
    step.approvedRevisionId = null;
  }
}
export function saveRevision(run: Run, index: number, revision: Revision) {
  assertReady(run, index);
  const step = run.steps[index];
  step.revisions.push(revisionSchema.parse(revision));
  step.status = "waiting";
  step.approvedRevisionId = null;
  invalidateAfter(run, index);
}
export function approve(run: Run, index: number) {
  assertReady(run, index);
  const step = run.steps[index];
  const revision = currentRevision(step);
  if (step.status !== "waiting" || !revision)
    throw new Error("当前阶段还没有可确认的产物");
  step.status = "approved";
  step.approvedRevisionId = revision.id;
}
export function finalize(run: Run) {
  if (run.steps.some((step) => step.status !== "approved"))
    throw new Error("请先确认全部阶段");
  run.finalizedAt = new Date().toISOString();
}
export function organize(project: Project) {
  // Explicit command only. Finalizing a chapter never silently indexes it.
  for (const run of project.runs.filter((run) => run.finalizedAt)) {
    const text = currentRevision(run.steps[4])?.content ?? "";
    const id = `chapter-${run.id}`;
    const existing = project.references.findIndex((ref) => ref.id === id);
    const ref: Reference = {
      id,
      title: run.title,
      text,
      kind: "manuscript",
      tags: [],
      source: `chapters/${run.id}.md`,
      indexed: false,
    };
    if (existing < 0) project.references.push(ref);
    else project.references[existing] = ref;
  }
  for (const ref of project.references) {
    const rules = [
      ["战斗", /剑|刀|拳|战|杀|躲|伤|血/],
      ["写景", /雨|风|山|树|月|天|街|城/],
      ["对白", /[“”「」]|说道|问道|低声/],
      ["心理", /想|怕|心|犹豫|记忆|意识/],
    ] as const;
    ref.tags = rules
      .filter(([, pattern]) => pattern.test(ref.text))
      .map(([tag]) => tag);
    if (!ref.tags.length) ref.tags = ["过渡"];
    ref.indexed = true;
  }
  log(
    project,
    "整理素材",
    `已整理 ${project.references.length} 个来源（本地规则初分，可手动修正分类）`,
  );
}
export function selectReferences(project: Project, query: string): Citation[] {
  const words = query.match(/[\p{Script=Han}]{2}|[a-zA-Z]{3,}/gu) ?? [];
  const activeChapters = new Set(
    project.runs
      .filter((run) => run.finalizedAt)
      .map((run) => `chapter-${run.id}`),
  );
  const candidates = project.references
    .filter(
      (ref) => !ref.id.startsWith("chapter-") || activeChapters.has(ref.id),
    )
    .flatMap((ref) =>
      ref.text
        .split(/\n\s*\n/)
        .filter((p) => p.trim())
        .map((excerpt) => ({
          sourceId: ref.id,
          title: ref.title,
          kind: ref.kind,
          source: ref.source,
          excerpt: excerpt.slice(0, 700),
          score: words.reduce(
            (score, word) => score + (excerpt.includes(word) ? 1 : 0),
            0,
          ),
        })),
    );
  const chosen: Citation[] = [];
  for (const kind of ["manuscript", "temporary"] as const) {
    const sorted = candidates
      .filter((ref) => ref.kind === kind)
      .sort((a, b) => b.score - a.score);
    for (const ref of sorted.slice(0, 3)) {
      const { score: _, ...citation } = ref;
      chosen.push(citation);
    }
  }
  return chosen;
}
