import { mkdir, readFile, realpath, rename, writeFile } from "node:fs/promises";
import path from "node:path";

const allowed =
  /^(?:project\.json|README\.md|\.opencode\/agents\/novelist\.md|\.opencode\/skills\/[a-z-]+\/SKILL\.md|references\/(?:temporary|manuscript)\/[\w-]+\.md|chapters\/[\w-]+\.md|workflow\/[\w-]+\/(?:intent|timeline|events|scenes|draft|style)\/v\d+-[\w-]+\.md)$/;
export async function saveProjectFiles(root, files) {
  if (!files || typeof files !== "object" || Array.isArray(files))
    throw new Error("无效的项目文件");
  const entries = Object.entries(files);
  if (entries.length > 10000 || !Object.hasOwn(files, "project.json"))
    throw new Error("项目文件数量超出限制");
  for (const [name, content] of entries) {
    if (
      !allowed.test(name) ||
      typeof content !== "string" ||
      Buffer.byteLength(content) > 20_000_000
    )
      throw new Error("无效的项目文件路径或内容");
  }
  const canonicalRoot = await realpath(root);
  const write = async (name, content) => {
    const pieces = name.split("/");
    let directory = canonicalRoot;
    for (const piece of pieces.slice(0, -1)) {
      directory = path.join(directory, piece);
      await mkdir(directory, { recursive: true });
      const resolved = await realpath(directory);
      const relative = path.relative(canonicalRoot, resolved);
      if (relative.startsWith("..") || path.isAbsolute(relative))
        throw new Error("项目目录中存在指向外部的链接");
    }
    const target = path.join(directory, pieces.at(-1));
    // Respect an existing novelist persona in the user's workspace.
    if (
      name.startsWith(".opencode/") &&
      (await readFile(target, "utf8").then(
        () => true,
        (error) => {
          if (error.code === "ENOENT") return false;
          throw error;
        },
      ))
    )
      return;
    const temporary = `${target}.${crypto.randomUUID()}.tmp`;
    await writeFile(temporary, content, "utf8");
    await rename(temporary, target);
  };
  for (const [name, content] of entries.filter(
    ([name]) => name !== "project.json",
  ))
    await write(name, content);
  await write("project.json", files["project.json"]);
}

export function registerWritingIpc({ ipcMain, dialog, getWindow }) {
  const roots = new Map();
  let queue = Promise.resolve();
  function trust(event) {
    const window = getWindow();
    if (
      !window ||
      event.sender !== window.webContents ||
      event.senderFrame !== event.sender.mainFrame
    )
      throw new Error("仅小说工作台主窗口可访问项目文件");
  }
  ipcMain.handle("winai:project-open", async (event) => {
    trust(event);
    await queue.catch(() => {});
    const result = await dialog.showOpenDialog(getWindow(), {
      title: "选择小说项目文件夹",
      properties: ["openDirectory", "createDirectory"],
    });
    if (result.canceled || !result.filePaths[0]) return null;
    const selected = await realpath(result.filePaths[0]);
    const content = await readFile(
      path.join(selected, "project.json"),
      "utf8",
    ).catch((error) => {
      if (error.code === "ENOENT") return null;
      throw error;
    });
    const token = crypto.randomUUID();
    roots.set(token, selected);
    return { path: selected, content, token };
  });
  ipcMain.handle("winai:project-save", async (event, files, token) => {
    trust(event);
    const selected = roots.get(token);
    if (!selected) throw new Error("请重新选择项目文件夹");
    const task = queue
      .catch(() => {})
      .then(() => saveProjectFiles(selected, files));
    queue = task;
    await task;
  });
}
