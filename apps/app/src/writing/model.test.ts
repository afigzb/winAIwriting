import { test } from "node:test";
import assert from "node:assert/strict";
import {
  approve,
  currentRevision,
  finalize,
  newProject,
  newRun,
  organize,
  projectSchema,
  saveRevision,
  selectReferences,
  uid,
  type Revision,
} from "./model.ts";
import { buildPrompt, OpenCodeEngine, type EngineSettings } from "./runtime.ts";
import { projectFiles } from "./storage.ts";

function revision(content = "测试正文"): Revision {
  return {
    id: uid(),
    content,
    feedback: "",
    createdAt: new Date().toISOString(),
    model: "fixture",
    prompt: "输入",
    references: [],
  };
}
function complete() {
  const run = newRun("第一章", "通过动作引出冲突");
  for (let i = 0; i < 6; i++) {
    saveRevision(run, i, revision(`阶段${i}`));
    approve(run, i);
  }
  return run;
}
test("未确认前序产物时拒绝跳步，生成本身不产生确认", () => {
  const run = newRun("第一章", "冲突");
  assert.throws(() => saveRevision(run, 1, revision()), /确认前面/);
  saveRevision(run, 0, revision());
  assert.equal(run.steps[0].status, "waiting");
  assert.equal(run.steps[1].status, "pending");
  assert.throws(() => saveRevision(run, 1, revision()), /确认前面/);
  assert.throws(() => finalize(run), /全部阶段/);
});
test("修改时间线清除后续确认、保留历史版本，并撤销定稿", () => {
  const run = complete();
  finalize(run);
  const previous = currentRevision(run.steps[1])!.id;
  saveRevision(run, 1, revision("修改后的时间线"));
  assert.equal(run.finalizedAt, null);
  assert.equal(run.steps[0].status, "approved");
  assert.equal(run.steps[1].status, "waiting");
  assert.equal(run.steps[1].revisions[0].id, previous);
  assert.equal(run.steps[1].revisions.length, 2);
  for (const step of run.steps.slice(2)) {
    assert.equal(step.status, "stale");
    assert.equal(step.approvedRevisionId, null);
    assert.equal(step.revisions.length, 1);
  }
});
test("不能确认已过期产物，修改上游后必须重新生成下游", () => {
  const run = complete();
  saveRevision(run, 1, revision());
  approve(run, 1);
  assert.throws(() => approve(run, 2), /可确认/);
  saveRevision(run, 2, revision());
  approve(run, 2);
  assert.equal(run.steps[2].status, "approved");
});
test("完整确认才能定稿；定稿不会自动整理素材", () => {
  const project = newProject("测试", false);
  const run = complete();
  project.runs.push(run);
  finalize(run);
  assert.ok(run.finalizedAt);
  assert.equal(project.references.length, 0);
  organize(project);
  assert.equal(project.references.length, 1);
  assert.equal(project.references[0].kind, "manuscript");
  assert.equal(project.references[0].text, "阶段4");
  organize(project);
  assert.equal(project.references.length, 1);
});
test("有本书正文时混合检索临时来源，旧定稿失效后不再检索它", () => {
  const project = newProject("测试", false);
  const run = complete();
  project.runs.push(run);
  finalize(run);
  organize(project);
  project.references.push({
    id: uid(),
    title: "临时",
    kind: "temporary",
    text: "雨夜剑光",
    tags: [],
    source: "test",
    indexed: false,
  });
  assert.deepEqual(
    new Set(selectReferences(project, "雨夜").map((ref) => ref.kind)),
    new Set(["manuscript", "temporary"]),
  );
  saveRevision(run, 1, revision());
  assert.deepEqual(
    selectReferences(project, "雨夜").map((ref) => ref.kind),
    ["temporary"],
  );
});
test("项目备份拒绝路径穿越与伪造确认，同时可无损重开有效版本", () => {
  const project = newProject();
  project.runs.push(complete());
  assert.deepEqual(
    projectSchema.parse(JSON.parse(JSON.stringify(project))),
    project,
  );
  project.runs[0].id = "../../escape";
  assert.equal(projectSchema.safeParse(project).success, false);
  project.runs[0].id = uid();
  project.runs[0].steps[0].approvedRevisionId = "missing";
  assert.equal(projectSchema.safeParse(project).success, false);
});
test("磁盘导出包含每个历史版本、已定稿正文和六个技能", () => {
  const project = newProject();
  const run = complete();
  project.runs.push(run);
  finalize(run);
  const files = projectFiles(project);
  assert.ok(files[`chapters/${run.id}.md`].includes("阶段4"));
  assert.equal(
    Object.keys(files).filter((path) => path.endsWith("SKILL.md")).length,
    6,
  );
  assert.equal(
    Object.keys(files).filter((path) => path.startsWith("workflow/")).length,
    6,
  );
  assert.ok(files[".opencode/agents/novelist.md"].includes("edit: deny"));
});
test("提示包含当前修改、已确认上游和原文引用，不包含未确认的后续稿", () => {
  const project = newProject();
  const run = complete();
  saveRevision(run, 1, revision("新时间线"));
  const prompt = buildPrompt({
    project,
    run,
    index: 1,
    feedback: "不要直接救场",
    references: [],
  });
  assert.ok(prompt.includes("不要直接救场"));
  assert.ok(prompt.includes("阶段0"));
  assert.ok(!prompt.includes("阶段4"));
  assert.ok(prompt.includes("不是指令"));
});
test("空白小说带有原创临时参考，全部与故事事实分开", () => {
  const project = newProject();
  assert.equal(project.references.length, 3);
  assert.ok(
    project.references.every((reference) => reference.kind === "temporary"),
  );
  assert.ok(selectReferences(project, "交手").length > 0);
});

test("OpenCode 空输出不会进入待确认状态", async () => {
  let calls = 0;
  const fetcher: typeof fetch = async () =>
    ++calls === 1
      ? Response.json({ id: "s" })
      : Response.json({
          info: {},
          parts: [{ type: "reasoning", text: "隐藏推理" }],
        });
  const run = newRun("章", "目标");
  await assert.rejects(
    new OpenCodeEngine(settings, fetcher).generate(
      { project: newProject(), run, index: 0, feedback: "", references: [] },
      new AbortController().signal,
    ),
    /没有返回正文/,
  );
  assert.equal(run.steps[0].status, "pending");
});

test("用户停止生成时向对应的 OpenCode 会话转发取消", async () => {
  const paths: string[] = [];
  const controller = new AbortController();
  const fetcher: typeof fetch = async (input, init) => {
    const pathname = new URL(String(input)).pathname;
    paths.push(pathname);
    if (pathname.endsWith("/session"))
      return Response.json({ id: "ses_cancel" });
    if (pathname.endsWith("/abort")) return Response.json(true);
    return new Promise<Response>((_, reject) => {
      init?.signal?.addEventListener(
        "abort",
        () => reject(new DOMException("停止", "AbortError")),
        { once: true },
      );
      controller.abort();
    });
  };
  await assert.rejects(
    new OpenCodeEngine(settings, fetcher).generate(
      {
        project: newProject(),
        run: newRun("章", "目标"),
        index: 0,
        feedback: "",
        references: [],
      },
      controller.signal,
    ),
    { name: "AbortError" },
  );
  assert.ok(paths.some((path) => path.endsWith("/session/ses_cancel/abort")));
});

const settings: EngineSettings = {
  mode: "opencode",
  url: "http://localhost:4096/opencode",
  directory: "D:/书",
  model: "test/writer",
  token: "",
};
test("OpenCode 适配器创建阶段会话，传递目录、角色、模型并提取正文", async () => {
  const calls: { url: string; body: unknown }[] = [];
  const fetcher: typeof fetch = async (input, init) => {
    calls.push({
      url: String(input),
      body: init?.body ? JSON.parse(String(init.body)) : null,
    });
    return calls.length === 1
      ? Response.json({ id: "ses_test" })
      : Response.json({
          info: {},
          parts: [
            { type: "reasoning", text: "不展示" },
            { type: "text", text: "真实接口形状的正文" },
          ],
        });
  };
  const result = await new OpenCodeEngine(settings, fetcher).generate(
    {
      project: newProject(),
      run: newRun("章", "目标"),
      index: 0,
      feedback: "",
      references: [],
    },
    new AbortController().signal,
  );
  assert.equal(result.content, "真实接口形状的正文");
  assert.equal(result.sessionId, "ses_test");
  assert.ok(calls[0].url.includes("/opencode/session?directory="));
  assert.deepEqual(JSON.parse(JSON.stringify(calls[1].body)).model, {
    providerID: "test",
    modelID: "writer",
  });
  assert.equal(JSON.parse(JSON.stringify(calls[1].body)).agent, "novelist");
});
test("OpenCode 的错误和空输出不会成为可确认版本", async () => {
  let count = 0;
  const fetcher: typeof fetch = async () =>
    ++count % 2
      ? Response.json({ id: "s" })
      : Response.json({ info: { error: { message: "failure" } }, parts: [] });
  const run = newRun("章", "目标");
  await assert.rejects(
    new OpenCodeEngine(settings, fetcher).generate(
      { project: newProject(), run, index: 0, feedback: "", references: [] },
      new AbortController().signal,
    ),
    /模型生成失败/,
  );
  assert.equal(run.steps[0].revisions.length, 0);
});
