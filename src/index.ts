import { createHarness, loadModelResources, sqliteSessionStore, standardFlow, toolsCore } from "comrade-harness-lib";
import type { Flow } from "comrade-harness-lib";

// standard core —— 模板（位于项目 cores/ 目录，只作为 fork 来源；提示词会告知 agent 别改模板）。
// 数据流 = lib 的 standardFlow（子图，普通函数）：loadContext（默认全量历史）→ agentLoop（LLM↔工具循环）
// → saveTurn（写回历史）。定制阶梯（逐层深入，每层都可替换）：
//   1. 选项：standardFlow({ systemPrompt, load: { history: N } })（窗口 N 条 / 0 = 独立回合）
//   2. hooks：loop: { hooks: { beforeTools, llmError }, llm }（工具审批/吞错/换 LLM 节点）
//   3. 整层换函数：load / loop / save 传函数
//   4. 不用 standardFlow：手拼子图（loadContext → 插入节点 → agentLoop → saveTurn）
//   5. 用 lib 节点（nodes.ts）完全手写
// 没有注册表、没有图结构、没有插件 API —— 只有普通函数与普通控制流。

const flow: Flow = standardFlow();

// 资源组装（"被加载"的部分，参数组合就够了）：
// LLM 提供者优先取公共资源库（~/.agents/models.json，RESOURCES_DIR 可覆盖），UI 可通过 /api/models 切换
// provider/模型（选择器委托给当前选中项，流不用改）；公共库缺失/全失败时回落 LLM_* 环境变量。
// 想自定义选择器（固定 provider/改初始选择）就自己用 importProviders + providerSelector 拼。
const { llm, modelSelector } = await loadModelResources();
createHarness({
  flow, // 数据流（harness 的灵魂）——上面一行 standardFlow()
  llm, // LLM 提供者：公共库选择器（UI 可切换）或 LLM_* 环境变量
  modelSelector, // 供 UI 的 /api/models 切换端点
  tools: [toolsCore()], // 工具包：工作区读写/执行/daemon 控制/fork
  ui: { dir: "public" }, // 对话 UI（public/ 静态资源，普通网页）
  memory: sqliteSessionStore(process.env.DB_PATH), // 会话化消息历史：消息池 + 会话引用列表（多会话；DB_PATH 由 daemon 注入）
});
