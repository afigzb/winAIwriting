import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { saveProjectFiles, registerWritingIpc } from "./writing-files.mjs";

test("本地项目保存 Unicode 正文并提交状态文件，不能写出项目目录", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "winai-files-"));
  try {
    await saveProjectFiles(root, {
      "project.json": '{"schemaVersion":1}',
      "chapters/test.md": "雨落在城门上。",
    });
    assert.equal(
      await readFile(path.join(root, "chapters/test.md"), "utf8"),
      "雨落在城门上。",
    );
    await saveProjectFiles(root, {
      "project.json": '{"schemaVersion":1,"revision":2}',
    });
    assert.ok(
      (await readFile(path.join(root, "project.json"), "utf8")).includes(
        '"revision":2',
      ),
    );
    await assert.rejects(
      saveProjectFiles(root, { "project.json": "{}", "../escape.txt": "bad" }),
      /无效/,
    );
    assert.equal(
      (await readdir(root)).some((name) => name.endsWith(".tmp")),
      false,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
test("目录链接无法将章节写入项目外部", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "winai-boundary-"));
  const outside = await mkdtemp(path.join(tmpdir(), "winai-outside-"));
  try {
    await symlink(outside, path.join(root, "chapters"), "junction");
    await assert.rejects(
      saveProjectFiles(root, {
        "project.json": "{}",
        "chapters/test.md": "bad",
      }),
      /外部/,
    );
    assert.deepEqual(await readdir(outside), []);
  } finally {
    await rm(root, { recursive: true, force: true });
    await rm(outside, { recursive: true, force: true });
  }
});

test("打开另一个目录不会把原项目的保存操作重定向过去", async () => {
  const first = await mkdtemp(path.join(tmpdir(), "winai-first-"));
  const second = await mkdtemp(path.join(tmpdir(), "winai-second-"));
  try {
    const handlers = new Map();
    const sender = { mainFrame: {} };
    const event = { sender, senderFrame: sender.mainFrame };
    const paths = [first, second];
    registerWritingIpc({
      ipcMain: { handle: (name, handler) => handlers.set(name, handler) },
      dialog: {
        showOpenDialog: async () => ({
          canceled: false,
          filePaths: [paths.shift()],
        }),
      },
      getWindow: () => ({ webContents: sender }),
    });
    const a = await handlers.get("winai:project-open")(event);
    const b = await handlers.get("winai:project-open")(event);
    await handlers.get("winai:project-save")(
      event,
      { "project.json": "first" },
      a.token,
    );
    assert.equal(
      await readFile(path.join(first, "project.json"), "utf8"),
      "first",
    );
    assert.deepEqual(await readdir(second), []);
    await assert.rejects(
      handlers.get("winai:project-save")(
        event,
        { "project.json": "bad" },
        "missing",
      ),
      /重新选择/,
    );
    assert.notEqual(a.token, b.token);
  } finally {
    await rm(first, { recursive: true, force: true });
    await rm(second, { recursive: true, force: true });
  }
});
