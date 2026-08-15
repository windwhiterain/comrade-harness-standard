// 本地依赖模式切换（standard 专用）
// on:  package.json 换成 link: 本地依赖（符号链接到 comrade-harness-lib），
//      并 skip-worktree package.json/bun.lock 防止本地改动被误提交
// off: 还原为提交的 git 依赖版本（github:windwhiterain/comrade-harness-lib#tag）
//
// 背景：提交的 package.json 是 git 依赖——任何机器 clone 后 bun install 都能跑（含 fork）。
// 本地开发用 package.local.json（gitignored，"不上传的文件"）覆盖为路径依赖：
// 改 lib 即时生效、类型检查走本地代码。bun link 的注册文件在 ~/.bun（用户目录，也不上传）。
import { existsSync, copyFileSync } from "node:fs";
import { spawnSync } from "node:child_process";

const mode = process.argv[2] ?? "on";
const FILES = ["package.json", "bun.lock"];

function git(...args: string[]): void {
  const r = spawnSync("git", args, { stdio: "inherit" });
  if (r.status !== 0) process.exit(r.status ?? 1);
}

function bunInstall(): void {
  const r = spawnSync("bun", ["install"], { stdio: "inherit" });
  if (r.status !== 0) process.exit(r.status ?? 1);
}

if (mode === "on") {
  if (!existsSync("package.local.json")) {
    copyFileSync("package.local.json.example", "package.local.json");
    console.log("[local] 已生成 package.local.json（gitignored）");
  }
  copyFileSync("package.local.json", "package.json");
  git("update-index", "--skip-worktree", ...FILES);
  bunInstall(); // 让 node_modules 变成指向本地 lib 的符号链接
  console.log("[local] package.json 已切换为 link: 本地依赖；package.json/bun.lock 已 skip-worktree，不会被提交");
} else {
  git("update-index", "--no-skip-worktree", ...FILES);
  git("checkout", "--", ...FILES);
  bunInstall(); // 从 GitHub 重新拉取依赖
  console.log("[local] package.json/bun.lock 已还原为提交的 git 依赖版本");
}
