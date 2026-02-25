// ============================================================
//  Nina — Configurações Centrais
// ============================================================

const os   = require("os");
const path = require("path");

module.exports = {
  // Seu número principal (usado pra lembretes)
  MY_NUMBER: "559881076109@c.us",

  // Todos os números que a Nina responde
  ALLOWED_NUMBERS: [
    "559881076109@c.us",
    "559884686483@c.us",
  ],

  // Ollama
  OLLAMA_URL:     "http://localhost:11434/api/chat",
  OLLAMA_MODEL:   "llama3.2:3b",
  OLLAMA_TIMEOUT: 300_000,

  // Banco de dados
  DB_PATH: "./nina.db",

  // Quantas mensagens recentes incluir no contexto
  CONTEXT_MESSAGES: 6,

  // Sessão WhatsApp
  SESSION_PATH: "./.wwebjs_auth",

  // Pastas de arquivos
  NOTES_DIR:  path.join(os.homedir(), "Documents", "nina"),
  PHOTOS_DIR: path.join(os.homedir(), "nina-files", "fotos"),
};
