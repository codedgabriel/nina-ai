// ============================================================
//  Nina v4 — Configurações Centrais
// ============================================================

const os   = require("os");
const path = require("path");

module.exports = {
  MY_NUMBER: "559881076109@c.us",

  ALLOWED_NUMBERS: [
    "559881076109@c.us",
    "559884686483@c.us",
    "37598747697245@lid"
  ],

  // ── Ollama (aprendizado local em background) ──────────────
  OLLAMA_URL:     process.env.OLLAMA_URL     || "http://127.0.0.1:11434/api/chat",
  OLLAMA_MODEL:   process.env.OLLAMA_MODEL   || "llama3",
  OLLAMA_TIMEOUT: parseInt(process.env.OLLAMA_TIMEOUT || "60000", 10),

  // ── Groq API (Whisper) ────────────────────────────────────
  GROQ_API_KEY: process.env.GROQ_API_KEY || "",

  // ── DeepSeek API ─────────────────────────────────────────
  DEEPSEEK_API_KEY:  process.env.DEEPSEEK_API_KEY || "",
  DEEPSEEK_BASE_URL: "https://api.deepseek.com/v1",
  DEEPSEEK_MODEL:    "deepseek-chat",
  DEEPSEEK_TIMEOUT:  120_000,

  // ── Banco de dados ────────────────────────────────────────
  DB_PATH: "./nina.db",
  CONTEXT_MESSAGES: 10,

  // ── Sessão WhatsApp ───────────────────────────────────────
  SESSION_PATH: "./.wwebjs_auth",

  // ── Pastas de arquivos ────────────────────────────────────
  NOTES_DIR:   path.join(os.homedir(), "Documents", "nina"),
  PHOTOS_DIR:  path.join(os.homedir(), "nina-files", "fotos"),
  SCRIPTS_DIR: path.join(os.homedir(), "nina-files", "scripts"),
  LOGS_DIR:    path.join(os.homedir(), "nina-files", "logs"),

  // ── Google (Gmail + Calendar) ────────────────────────────
  GOOGLE_CLIENT_ID:     process.env.GOOGLE_CLIENT_ID     || "",
  GOOGLE_CLIENT_SECRET: process.env.GOOGLE_CLIENT_SECRET || "",
  GOOGLE_REDIRECT_URI:  "urn:ietf:wg:oauth:2.0:oob",
  GOOGLE_TOKEN_FILE:    "./nina-google-token.json",

  // ── Visão (DeepSeek Vision) ───────────────────────────────
  // Usa a mesma DEEPSEEK_API_KEY — modelo diferente
  DEEPSEEK_VISION_MODEL: "deepseek-chat",  // deepseek-chat suporta imagens via base64

  // ── Agentic ───────────────────────────────────────────────
  MAX_TOOL_ROUNDS:   20,
  SCRIPT_TIMEOUT:    300_000,
  SHELL_TIMEOUT:     60_000,
  DANGEROUS_CONFIRM: false,
};