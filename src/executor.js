// ============================================================
//  Nina — Executor de Ferramentas
//  Recebe chamadas do modelo e executa as funções reais
// ============================================================

const path = require("path");
const os   = require("os");

const { runCommand, isDangerous, getSystemStats, writeCodeFile, readCodeFile } = require("./shell");
const { searchWeb }                       = require("./search");
const { saveTextNote, findNotes }         = require("./files");
const { saveReminder }                    = require("./db");
const { searchMessages }                  = require("./db");
const { searchVector }                    = require("./vector");
const { getAllContacts, getContactProfile } = require("./contacts");
const { getMessagesByNumber }              = require("./db");

// Comandos que precisam confirmação
const DANGEROUS_PATTERNS = [
  /\brm\s+-rf\b/, /\brmdir\b/, /\bmkfs\b/, /\bdd\b/,
  /\bshutdown\b/, /\breboot\b/, /\bpoweroff\b/,
];

function isDangerousStrict(cmd) {
  return DANGEROUS_PATTERNS.some((r) => r.test(cmd));
}

/**
 * Executa uma tool call retornada pelo modelo.
 * Retorna string com o resultado.
 */
async function executeTool(toolName, toolArgs, context = {}) {
  console.log(`[Tool] ${toolName}`, toolArgs);

  try {
    switch (toolName) {

      case "run_shell": {
        const { cmd } = toolArgs;
        if (!cmd) return "erro: nenhum comando especificado";

        // Bloqueia comandos extremamente destrutivos
        if (isDangerousStrict(cmd)) {
          return `NEEDS_CONFIRMATION:${cmd}`;
        }

        const { output, error } = await runCommand(cmd, 60_000);
        return error ? `Erro: ${error}` : (output || "(sem output)");
      }

      case "search_web": {
        const { query } = toolArgs;
        const result = await searchWeb(query);
        return result || "Nenhum resultado encontrado na web.";
      }

      case "save_note": {
        const { title, content } = toolArgs;
        saveTextNote(title || "Nota", content);
        return `Nota "${title}" salva.`;
      }

      case "find_notes": {
        const { query } = toolArgs;
        const notes = findNotes(query);
        if (!notes.length) return "Nenhuma nota encontrada.";
        return notes.map((n) => `• ${n.title}: ${n.content}`).join("\n");
      }

      case "set_reminder": {
        const { time, text } = toolArgs;
        // Valida formato HH:MM
        if (!/^\d{1,2}:\d{2}$/.test(time)) {
          return `Formato de horário inválido: ${time}. Use HH:MM`;
        }
        const [h, m] = time.split(":").map(Number);
        const formatted = `${String(h).padStart(2,"0")}:${String(m).padStart(2,"0")}`;
        saveReminder(text, formatted);
        return `Lembrete salvo para ${formatted}: "${text}"`;
      }

      case "get_system_stats": {
        return await getSystemStats();
      }

      case "read_file": {
        const { path: filePath } = toolArgs;
        const content = readCodeFile(filePath);
        if (!content) return `Arquivo não encontrado: ${filePath}`;
        return content.length > 3000 ? content.slice(0, 3000) + "\n...(truncado)" : content;
      }

      case "write_file": {
        const { path: filePath, content } = toolArgs;
        const saved = writeCodeFile(filePath, content);
        return `Arquivo salvo em: ${saved}`;
      }

      case "search_memory": {
        const { query, from_number } = toolArgs;
        let results = await searchVector(query, from_number || null, 5);
        if (!results.length) {
          results = searchMessages(query, from_number || null, 5).map((r) => ({
            text: r.content, role: r.role, created_at: r.created_at,
          }));
        }
        if (!results.length) return "Nada encontrado nas conversas antigas.";
        return results.map((r) =>
          `[${r.created_at}] ${r.role === "user" ? "Usuário" : "Nina"}: ${r.text}`
        ).join("\n");
      }

      case "get_contact_info": {
        const { name } = toolArgs;
        const contacts = getAllContacts();
        const contact  = contacts.find((c) =>
          c.name && c.name.toLowerCase().includes(name.toLowerCase())
        );
        if (!contact) return `Contato "${name}" não encontrado.`;

        const profile = getContactProfile(contact);
        const msgs    = getMessagesByNumber(contact.number, 10).filter((m) => m.role === "user");
        let result    = profile || `Nome: ${contact.name}`;
        if (msgs.length) {
          result += `\n\nÚltimas mensagens:\n` + msgs.map((m) => `- ${m.content}`).join("\n");
        }
        return result;
      }

      case "restart_self": {
        setTimeout(() => process.exit(0), 1000);
        return "Reiniciando...";
      }

      default:
        return `Ferramenta desconhecida: ${toolName}`;
    }
  } catch (err) {
    console.error(`[Tool] Erro em ${toolName}:`, err.message);
    return `Erro ao executar ${toolName}: ${err.message}`;
  }
}

module.exports = { executeTool };
