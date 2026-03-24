// ============================================================
//  Nina v4 — Cliente DeepSeek (OpenAI-compatible API)
// ============================================================

const axios = require("axios");
const {
  DEEPSEEK_API_KEY, DEEPSEEK_BASE_URL, DEEPSEEK_MODEL,
  DEEPSEEK_TIMEOUT, CONTEXT_MESSAGES, MAX_TOOL_ROUNDS,
} = require("./config");
const { buildSystemPrompt } = require("./personality");
const { getRecentMessages } = require("./db");
const { buildMemoryContext } = require("./memory");
const { trackUsage, isBlocked, getBudgetConfig } = require("./budget");
const { tools }             = require("./tools");
const { getNativeToolDefs } = require("./skills");
const { executeTool }       = require("./executor");

if (!DEEPSEEK_API_KEY) {
  console.warn("[DeepSeek] ⚠️  DEEPSEEK_API_KEY não definida.");
}

const http = axios.create({
  baseURL: DEEPSEEK_BASE_URL,
  timeout: DEEPSEEK_TIMEOUT,
  headers: {
    "Authorization": `Bearer ${DEEPSEEK_API_KEY}`,
    "Content-Type":  "application/json",
  },
});

async function askNina(userMessage, contact = null, fromNumber = "unknown") {
  // ── Memória automática ──────────────────────────────────────
  // Busca contexto relevante ANTES de montar o prompt
  // Sem isso ela só lembra das últimas N mensagens da sessão
  const memoryCtx = await buildMemoryContext(userMessage, fromNumber, contact);

  const system  = buildSystemPrompt(contact, memoryCtx);
  const history = getRecentMessages(fromNumber, CONTEXT_MESSAGES);

  // Combina tools built-in com tools nativas aprendidas em runtime
  const seen = new Set();
    const allTools = [...tools].filter(t => {
      if (seen.has(t.function.name)) return false;
      seen.add(t.function.name);
      return true;
    });

  const messages = [{ role: "system", content: system }];
  for (const msg of history) {
    messages.push({
      role:    msg.role === "user" ? "user" : "assistant",
      content: msg.content,
    });
  }
  messages.push({ role: "user", content: userMessage });

  // Verifica orçamento antes de começar
  if (isBlocked()) {
    const cfg = getBudgetConfig();
    return `limite diário de API atingido ($${cfg.dailyLimitUSD}). tenta amanhã ou aumenta o limite com "muda limite de api pra X dólares".`;
  }

  let rounds = 0;

  while (rounds < MAX_TOOL_ROUNDS) {
    rounds++;

    let response;
    try {
      console.log("[DeepSeek Debug] messages count:", messages.length);
      console.log("[DeepSeek Debug] first message role:", messages[0]?.role);
      console.log("[DeepSeek Debug] system prompt slice:", messages[0]?.content?.slice(0, 100));
      console.log("[DeepSeek Debug] last message:", JSON.stringify(messages[messages.length-1]));
      console.log("[DeepSeek Debug] all messages:", JSON.stringify(messages.slice(1), null, 2).slice(0, 1000));
      response = await http.post("/chat/completions", {
        model:       DEEPSEEK_MODEL,
        messages,
        tools: allTools,
        tool_choice: "auto",
        temperature: 0.7,
        max_tokens:  2048,
      });
    } catch (err) {
      console.error("[DeepSeek] Erro:", err.response?.data || err.message);
      if (err.response?.status === 401) return "Chave da API inválida.";
      if (err.response?.status === 429) return "Limite de requisições, tenta em instantes.";
      if (err.code === "ECONNABORTED")   return "Timeout — tenta de novo.";
      return "Travei na API, manda de novo.";
    }

    const choice = response.data?.choices?.[0];
    if (!choice) return "...";
    console.log("[DeepSeek Debug] finish_reason:", choice.finish_reason);
    console.log("[DeepSeek Debug] content:", JSON.stringify(choice.message?.content));
    console.log("[DeepSeek Debug] tool_calls:", JSON.stringify(choice.message?.tool_calls)?.slice(0, 300));
    console.log("[DeepSeek Debug] full response:", JSON.stringify(response.data).slice(0, 500));

    const responseMsg = choice.message;

    // Sem tool calls → resposta final
    if (!responseMsg.tool_calls || responseMsg.tool_calls.length === 0) {
      const usage = response.data.usage;
      if (usage) {
        console.log(`[DeepSeek] Tokens: in=${usage.prompt_tokens} out=${usage.completion_tokens}`);
        trackUsage(DEEPSEEK_MODEL, usage.prompt_tokens, usage.completion_tokens);
      }
      return responseMsg.content?.trim() || "...";
    }

    messages.push(responseMsg);

    // Executa tools
    const toolResults = await Promise.all(
      responseMsg.tool_calls.map(async (tc) => {
        const name = tc.function?.name;
        let args = {};
        try { args = JSON.parse(tc.function?.arguments || "{}"); } catch {}

        const result = await executeTool(name, args, { fromNumber, contact });

        if (typeof result === "string" && result.startsWith("NEEDS_CONFIRMATION:")) {
          return { id: tc.id, name, result, needsConfirm: true };
        }
        return { id: tc.id, name, result, needsConfirm: false };
      })
    );

    const confirmNeeded = toolResults.find((r) => r.needsConfirm);
    if (confirmNeeded) {
      const cmd = confirmNeeded.result.replace("NEEDS_CONFIRMATION:", "");
      return `⚠️ comando perigoso detectado:\n\`${cmd}\`\n\nconfirma ou cancela?`;
    }

    for (const { id, name, result } of toolResults) {
      console.log(`[Tool] ${name} → ${String(result).slice(0, 120)}`);
      messages.push({ role: "tool", tool_call_id: id, content: String(result) });
    }
  }

  return "Atingi o limite de operações encadeadas. Tenta com uma tarefa menor.";
}

module.exports = { askNina };
