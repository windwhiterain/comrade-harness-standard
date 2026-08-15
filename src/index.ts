import {
  buildSystemPrompt,
  composeMessages,
  createHarness,
  loadHistory,
  loadModelResources,
  runTools,
  sqliteSessionStore,
  streamLLM,
  toolsCore,
} from "comrade-harness-lib";
import type { Flow, HistoryStep, LLMResult, ToolStep } from "comrade-harness-lib";

// standard core —— 模板（位于项目 cores/ 目录，只作为 fork 来源；提示词会告知 agent 别改模板）。
// 数据流：用 lib 的节点函数（普通函数）串成 harness —— 这就是"harness 是什么"。
// 自定义 = 改这段代码：替换节点（换个函数）、插入节点（加一行调用）。
// 没有注册表、没有图结构、没有插件 API —— 只有普通代码控制流。

const flow: Flow = async (ctx) => {
  // ① 记忆节点：最近 8 条历史作为上下文（想"每次消息独立"就改成 loadHistory(ctx.memory, 0)）
  const history = loadHistory(ctx.memory, 8);

  // ② 提示词 + 消息组装节点
  // 重新生成模式（右键"请求"）：不新增用户消息，LLM 输入的最后一条 = 上下文最后一条（重新回答它）
  let messages = composeMessages(
    buildSystemPrompt(ctx.coreId, ctx.template),
    history,
    ctx.regen ? (history.at(-1)?.text ?? "") : ctx.userText,
  );

  // ③ agent 循环：LLM 节点 ↔ 工具节点，普通 for + if。
  // 不设步数上限——循环只在两种情况下退出：LLM 不再调用工具（拿到最终回复），或工具返回 done（任务收尾）。
  // 每轮的思考片段与工具调用（含参数/结果）收进 steps，随历史存库供 UI 展示（role="step"，不喂给 LLM）。
  // 同时经 ctx.emit 实时推给请求方（SSE）：思考/工具实时上屏，最终回复逐字流出（JSON 模式是 no-op，行为一致）。
  // 终止（ctx.abortSignal，POST /api/abort）：LLM 调用被中断并保留已生成的部分作为回复；信号也传给工具——
  // run_cmd 会杀掉子进程、daemon 调用中断（工具不再"原子跑完"）；工具轮之间也检查，终止后不再进下一轮，
  // 回复"（已停止）"。已完成的步骤照存。
  const steps: HistoryStep[] = [];
  let reply: string | null = null;
  for (let step = 1; ; step++) {
    console.log(`[${ctx.coreId}] ── step ${step} ──`);
    let res: LLMResult;
    try {
      res = await streamLLM(ctx.llm, ctx.tools, messages, (d) => {
        // ← 换 LLM 行为（多模型路由/流式/重试）就换这行
        if (d.type === "reasoning") ctx.emit({ type: "think", delta: d.text });
        else ctx.emit({ type: "delta", text: d.text });
      }, { signal: ctx.abortSignal });
    } catch (e) {
      if (ctx.abortSignal.aborted) {
        reply = "（已停止）";
        break;
      }
      return { reply: `LLM 调用失败: ${e instanceof Error ? e.message : e}` };
    }
    if (res.toolCalls.length === 0) {
      if (res.reasoning) steps.push({ type: "think", content: res.reasoning });
      // 终止在流式中途发生：readSSE 返回已生成的部分，如实保存（空则标已停止）
      reply = res.content ?? (ctx.abortSignal.aborted ? "（已停止）" : "(空回复)");
      break;
    }
    if (res.reasoning) steps.push({ type: "think", content: res.reasoning });
    if (res.content) steps.push({ type: "think", content: res.content });
    messages.push({ role: "assistant", content: res.content ?? "", tool_calls: res.toolCalls });
    const toolSteps: ToolStep[] = [];
    for (const tc of res.toolCalls) {
      console.log(`[${ctx.coreId}] 工具: ${tc.function.name} ${tc.function.arguments.slice(0, 100)}`);
      ctx.emit({ type: "tool", name: tc.function.name, args: tc.function.arguments });
      toolSteps.push({ type: "tool", name: tc.function.name, args: tc.function.arguments });
    }
    const { messages: toolMsgs, done } = await runTools(ctx.tools, res.toolCalls, ctx.abortSignal); // ← 加工具拦截/审批就包这行
    if (done) {
      toolSteps.forEach((s) => {
        s.result = done;
        ctx.emit({ type: "toolResult", name: s.name, result: done });
      });
      reply = done;
      break;
    }
    for (let i = 0; i < res.toolCalls.length; i++) {
      const tm = toolMsgs.find((m) => m.tool_call_id === res.toolCalls[i].id);
      if (tm) {
        toolSteps[i].result = tm.content;
        ctx.emit({ type: "toolResult", name: toolSteps[i].name, result: tm.content });
      }
    }
    steps.push(...toolSteps);
    messages.push(...toolMsgs);
    if (ctx.abortSignal.aborted) {
      // 终止请求（工具轮已结束/被打断，不再进下一轮 LLM）
      reply = "（已停止）";
      break;
    }
  }
  const final = reply ?? "任务未完成（没有收到最终回复）。";

  // ④ 记忆节点：写入历史（用户消息 → 过程步骤 → 最终回复）；重新生成模式不新增用户消息行
  if (!ctx.regen) ctx.memory.insert("user", ctx.userText);
  for (const s of steps) ctx.memory.insert("step", JSON.stringify(s));
  ctx.memory.insert("agent", final);
  return { reply: final };
};

// 资源组装（"被加载"的部分，参数组合就够了）：
// LLM 提供者优先取公共资源库（~/.agents/models.json，RESOURCES_DIR 可覆盖），UI 可通过 /api/models 切换
// provider/模型（选择器委托给当前选中项，流不用改）；公共库缺失/全失败时回落 LLM_* 环境变量。
// 想自定义选择器（固定 provider/改初始选择）就自己用 importProviders + providerSelector 拼。
const { llm, modelSelector } = await loadModelResources();
createHarness({
  flow, // 数据流（harness 的灵魂）——上面那段代码
  llm, // LLM 提供者：公共库选择器（UI 可切换）或 LLM_* 环境变量
  modelSelector, // 供 UI 的 /api/models 切换端点
  tools: [toolsCore()], // 工具包：工作区读写/执行/daemon 控制/fork
  ui: { dir: "public" }, // 对话 UI（public/ 静态资源，普通网页）
  memory: sqliteSessionStore(process.env.DB_PATH), // 会话化消息历史：消息池 + 会话引用列表（多会话；DB_PATH 由 daemon 注入）
});
