import { spawn } from "node:child_process";
import { cp, mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const mode = process.argv[2] ?? "dev";
const entry = process.env.npm_execpath;
if (!entry)
  throw new Error(
    "请使用 pnpm writing:dev / writing:build / writing:desktop 启动",
  );
const children = new Set();
function start(args) {
  const child = spawn(process.execPath, [entry, ...args], {
    cwd: root,
    stdio: "inherit",
    windowsHide: true,
  });
  children.add(child);
  child.once("exit", () => children.delete(child));
  return child;
}
async function run(args) {
  const child = start(args);
  const code = await new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("exit", resolve);
  });
  if (code !== 0)
    throw new Error(`命令失败（${code}）：pnpm ${args.join(" ")}`);
}
function stop() {
  for (const child of children) child.kill();
}
process.on("SIGINT", () => {
  stop();
  process.exit(130);
});
process.on("SIGTERM", () => {
  stop();
  process.exit(143);
});
if (mode === "build" || mode === "desktop" || mode === "package") {
  await run([
    "--filter",
    "@openwork/app",
    "exec",
    "tsc",
    "--noEmit",
    "-p",
    "tsconfig.writing.json",
  ]);
  await run([
    "--filter",
    "@openwork/app",
    "exec",
    "vite",
    "build",
    "--config",
    "vite.writing.config.ts",
  ]);
  if (mode !== "build") {
    const destination = path.join(root, "dist/writing-desktop/app");
    await mkdir(destination, { recursive: true });
    for (const name of [
      "writing-main.mjs",
      "writing-files.mjs",
      "writing-preload.cjs",
    ])
      await cp(
        path.join(root, "apps/desktop/electron", name),
        path.join(destination, name),
      );
    const uiDestination = path.resolve(destination, "ui");
    if (!uiDestination.startsWith(path.join(root, "dist") + path.sep))
      throw new Error("构建暂存路径不在项目 dist 内");
    await rm(uiDestination, { recursive: true, force: true });
    await cp(path.join(root, "apps/app/dist-writing"), uiDestination, {
      recursive: true,
    });
    await cp(path.join(root, "LICENSE"), path.join(destination, "LICENSE"));
    await writeFile(
      path.join(destination, "package.json"),
      JSON.stringify(
        {
          name: "winaiwriting",
          version: "0.1.0",
          type: "module",
          main: "writing-main.mjs",
          description: "本地小说 AI 工作台",
          author: "winAIwriting",
          license: "MIT",
        },
        null,
        2,
      ),
    );
    if (mode === "desktop")
      await run([
        "--filter",
        "@openwork/desktop",
        "exec",
        "electron",
        destination,
      ]);
    else
      await run([
        "--filter",
        "@openwork/desktop",
        "exec",
        "electron-builder",
        "--projectDir",
        destination,
        "--config",
        path.join(root, "apps/desktop/electron-builder.writing.yml"),
        "--win",
        "--x64",
      ]);
  }
} else if (mode === "dev") {
  console.log("小说工作台：http://127.0.0.1:5188/writing.html");
  await run([
    "--filter",
    "@openwork/app",
    "exec",
    "vite",
    "--config",
    "vite.writing.config.ts",
  ]);
} else throw new Error(`未知启动方式：${mode}`);
