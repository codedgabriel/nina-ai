const log = require("./logger");
// ============================================================
//  Nina v4 — Memória Contínua e Automática
//
//  Problema que resolve:
//  O LLM não tem memória entre chamadas. O código antigo pegava
//  as últimas N mensagens, mas se você falou de algo há 3 dias,
//  ela não lembrava — a não ser que você pedisse pra buscar.
//
//  Solução:
//  1. Busca semântica automática a cada mensagem (ChromaDB/FTS)
//     → traz memórias RELEVANTES para o assunto atual
//  2. Fatos aprendidos (learner.js) sempre presentes no prompt
//  3. Resumo diário comprimido (salvo em DB) → memória de longo prazo
//     sem explodir o contexto com histórico bruto
// ============================================================

const axios = require("axios");
const { searchVector }  = require("./vector");
const {
  searchMessages, getAllFacts,
  saveNote, searchNotes,
}                       = require("./db");
const {
  DEEPSEEK_API_KEY, DEEPSEEK_BASE_URL, DEEPSEEK_MODEL,
} = require("./config");

// ── 1. Busca semântica automática ─────────────────────────────

async function recallRelevantMemory(userMessage, fromNumber, limit = 6) {
  let results = [];

  try {
    const vec = await searchVector(userMessage, fromNumber, limit);
    if (vec.length > 0) {
      results = vec.map((r) => ({
        text: r.text, role: r.role, created_at: r.created_at,
      }));
    }
  } catch {}

  if (results.length === 0) {
    try {
      results = searchMessages(userMessage, fromNumber, limit).map((r) => ({
        text: r.content, role: r.role, created_at: r.created_at,
      }));
    } catch {}
  }

  if (results.length === 0) return "";

  const lines = results.map((r) => {
    const who  = r.role === "user" ? "você disse" : "nina respondeu";
    const when = r.created_at ? ` (${r.created_at.slice(0, 10)})` : "";
    return `- ${who}${when}: "${r.text.slice(0, 200)}"`;
  });

  return `\n\n## Memórias relevantes (buscadas automaticamente)\n${lines.join("\n")}`;
}

// ── 2. Bloco de fatos aprendidos ──────────────────────────────

function buildFactsBlock(contact = null) {
  const facts = getAllFacts();
  const lines = [];

  if (facts.length > 0) {
    lines.push("## Fatos sobre DG (memória permanente)");
    lines.push(facts.map((f) => `- ${f.key}: ${f.value}`).join("\n"));
  }

  // Perfil do contato atual (se não for DG)
  if (contact?.notes) {
    try {
      const profile = JSON.parse(contact.notes);
      const entries = Object.entries(profile);
      if (entries.length > 0) {
        lines.push(`\n## Perfil de ${contact.name}`);
        lines.push(entries.map(([k, v]) => `- ${k}: ${v}`).join("\n"));
      }
    } catch {}
  }

  return lines.length > 0 ? `\n\n${lines.join("\n")}` : "";
}

// ── 3. Resumo diário comprimido (memória de longo prazo) ──────
//
// Todo dia a Nina comprime o histórico do dia em ~10 frases
// e salva como nota. Esse resumo é injetado no prompt no dia seguinte.
// Assim ela tem "memória" de semanas sem explodir o contexto.

async function generateDailySummary(fromNumber, messagesOfDay) {
  if (!DEEPSEEK_API_KEY || messagesOfDay.length === 0) return;

  const dialogue = messagesOfDay
    .slice(-40) // máx 40 msgs por resumo
    .map((m) => `${m.role === "user" ? "DG" : "Nina"}: ${m.content}`)
    .join("\n");

  try {
    const res = await axios.post(
      `${DEEPSEEK_BASE_URL}/chat/completions`,
      {
        model: DEEPSEEK_MODEL,
        messages: [
          {
            role: "system",
            content: "Você comprime conversas em resumos concisos. Responda SOMENTE com o resumo, sem preâmbulo.",
          },
          {
            role: "user",
            content: `Resuma essa conversa em no máximo 8 bullet points curtos, capturando decisões tomadas, fatos relevantes sobre DG e tarefas executadas. Ignore small talk.\n\n${dialogue}`,
          },
        ],
        temperature: 0.2,
        max_tokens:  400,
      },
      {
        headers: { Authorization: `Bearer ${DEEPSEEK_API_KEY}` },
        timeout: 30_000,
      }
    );

    const summary = res.data?.choices?.[0]?.message?.content?.trim();
    if (summary) {
      const date = new Date().toISOString().slice(0, 10);
      saveNote(`Resumo ${date}`, summary, null);
      log.info("Memory", `resumo ${date} salvo`);
    }
  } catch (err) {
    log.error("Memory", `erro ao gerar resumo: ${err.message}`);
  }
}

// ── 4. Recupera resumos recentes ──────────────────────────────

function getRecentSummaries(days = 5) {
  const notes = searchNotes("Resumo 20"); // busca notas de resumo
  if (!notes.length) return "";

  const relevant = notes
    .filter((n) => n.title.startsWith("Resumo"))
    .slice(0, days);

  if (!relevant.length) return "";

  return `\n\n## Resumos de dias anteriores (memória de longo prazo)\n` +
    relevant.map((n) => `### ${n.title}\n${n.content}`).join("\n\n");
}

// ── API pública: buildMemoryContext ───────────────────────────
// Chamada pelo deepseek.js antes de cada resposta

async function buildMemoryContext(userMessage, fromNumber, contact = null) {
  // Executa em paralelo para não bloquear a resposta
  const [semanticMemory, summaries, facts] = await Promise.all([
    recallRelevantMemory(userMessage, fromNumber),
    Promise.resolve(getRecentSummaries(3)),
    Promise.resolve(buildFactsBlock(contact)),
  ]);

  return { semanticMemory, summaries, facts };
}

module.exports = {
  buildMemoryContext,
  generateDailySummary,
  recallRelevantMemory,
  buildFactsBlock,
};
