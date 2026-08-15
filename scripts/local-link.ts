// 本地依赖覆盖（postinstall 钩子 + 手动 on/off）：
//   local.override.json（gitignored，不上传）存在时，把列出的依赖链接到本地路径（Windows junction）。
//   package.json 始终保持 git 依赖——fork/他人 clone 即装；本机每次 bun install 后自动重链。
//   bun run local:on  = 生成 marker（从 example 复制）并 install（postinstall 生效）
//   bun run local:off = 删除 marker 并 install（还原 GitHub 安装）
import { existsSync, readFileSync, writeFileSync, rmSync, symlinkSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

const MARKER = "local.override.json";
const EXAMPLE = "local.override.json.example";
const cmd = process.argv[2];

function install(): void {
  const r = spawnSync("bun", ["install"], { stdio: "inherit" });
  if (r.status !== 0) process.exit(r.status ?? 1);
}

function link(): void {
  try {
    const map = JSON.parse(readFileSync(MARKER, "utf8")) as Record<string, string>;
    for (const [name, target] of Object.entries(map)) {
      const link = join("node_modules", name);
      rmSync(link, { recursive: true, force: true });
      symlinkSync(target, link, "junction");
      console.log(`[local-link] ${name} -> ${target}`);
    }
  } catch (e) {
    console.error(`[local-link] 链接失败: ${e instanceof Error ? e.message : e}`);
    process.exit(1);
  }
}

if (cmd === "on") {
  if (!existsSync(MARKER)) {
    if (!existsSync(EXAMPLE)) {
      console.error(`[local-link] 缺少 ${EXAMPLE}`);
      process.exit(1);
    }
    writeFileSync(MARKER, readFileSync(EXAMPLE));
    console.log(`[local-link] 已生成 ${MARKER}（gitignored，不上传）`);
  }
  install();
} else if (cmd === "off") {
  rmSync(MARKER, { force: true });
  install();
} else {
  if (!existsSync(MARKER)) process.exit(0); // 无 marker（fork/他人机器）→ no-op
  link();
}
