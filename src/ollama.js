// ============================================================
//  Nina — Comunicação com Ollama (Function Calling)
// ============================================================

const axios = require("axios");
const { OLLAMA_URL, OLLAMA_MODEL, OLLAMA_TIMEOUT, CONTEXT_MESSAGES } = require("./config");
const { buildSystemPrompt } = require("./personality");
const { getRecentMessages } = require("./db");
const { tools }             = require("./tools");
const { executeTool }       = require("./executor");

const MAX_TOOL_ROUNDS = 5; // máximo de chamadas encadeadas por mensagem

async function askNina(userMessage, contact = null, fromNumber = "unknown") {
  const system  = buildSystemPrompt(contact);
  const history = getRecentMessages(fromNumber, CONTEXT_MESSAGES);

  const messages = [{ role: "system", content: system }];

  for (const msg of history) {
    messages.push({
      role:    msg.role === "user" ? "user" : "assistant",
      content: msg.content,
    });
  }

  messages.push({ role: "user", content: userMessage });

  let pendingConfirmation = null;
  let rounds = 0;

  // Loop de agentic tool use
  while (rounds < MAX_TOOL_ROUNDS) {
    rounds++;

    let response;
    try {
      response = await axios.post(
        OLLAMA_URL,
        {
          model:    OLLAMA_MODEL,
          messages,
          tools,
          stream:   false,
          options: {
            temperature: 0.4,
            num_predict: 500,
            num_ctx:     4096,
          },
        },
        { timeout: OLLAMA_TIMEOUT }
      );
    } catch (err) {
      console.error("[Ollama] Erro:", err.message);
      if (err.code === "ECONNREFUSED") return "Ollama não tá rodando.";
      return "travei, manda de novo";
    }

    const responseMsg = response.data?.message;
    if (!responseMsg) return "...";

    // Sem tool calls — resposta final
    if (!responseMsg.tool_calls || responseMsg.tool_calls.length === 0) {
      return responseMsg.content?.trim() || "...";
    }

    // Adiciona resposta do assistente ao histórico
    messages.push(responseMsg);

    // Executa cada tool call
    for (const toolCall of responseMsg.tool_calls) {
      const toolName = toolCall.function?.name;
      const toolArgs = toolCall.function?.arguments || {};

      const result = await executeTool(toolName, toolArgs, { fromNumber, contact });

      // Detecta se precisa de confirmação
      if (typeof result === "string" && result.startsWith("NEEDS_CONFIRMATION:")) {
        const cmd = result.replace("NEEDS_CONFIRMATION:", "");
        pendingConfirmation = cmd;
        return `⚠️ comando perigoso detectado:\n\`${cmd}\`\n\nconfirma ou cancela?`;
      }

      // Adiciona resultado da tool ao histórico
      messages.push({
        role:    "tool",
        content: result,
      });

      console.log(`[Tool] ${toolName} → ${String(result).slice(0, 100)}`);
    }
  }

  return "atingi o limite de operações encadeadas, tenta de novo";
}

module.exports = { askNina };
