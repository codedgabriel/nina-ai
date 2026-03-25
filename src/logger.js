// ============================================================
//  Nina v4 — Logger Centralizado
//
//  Substitui todos os console.log espalhados por um sistema
//  único com:
//  - Níveis: DEBUG | INFO | WARN | ERROR
//  - Prefixos padronizados e alinhados
//  - Deduplicação: mesma mensagem em menos de 2s → ignorada
//  - Timestamp opcional (ativado via LOG_TIMESTAMPS=1)
//  - LOG_LEVEL env para filtrar (debug|info|warn|error)
// ============================================================

const LEVELS = { debug: 0, info: 1, warn: 2, error: 3 };

const MIN_LEVEL = LEVELS[process.env.LOG_LEVEL?.toLowerCase()] ?? LEVELS.info;
const SHOW_TS   = process.env.LOG_TIMESTAMPS === "1";

// Deduplicação: evita spam de mensagens idênticas em sequência rápida
const recentMessages = new Map(); // mensagem → timestamp
const DEDUP_WINDOW_MS = 2000;

function isDuplicate(key) {
  const now = Date.now();
  const last = recentMessages.get(key);
  if (last && (now - last) < DEDUP_WINDOW_MS) return true;
  recentMessages.set(key, now);
  // Limpeza periódica para não vazar memória
  if (recentMessages.size > 200) {
    for (const [k, t] of recentMessages) {
      if (now - t > DEDUP_WINDOW_MS * 10) recentMessages.delete(k);
    }
  }
  return false;
}

function format(level, tag, message) {
  const ts  = SHOW_TS ? `${new Date().toISOString().slice(11, 23)} ` : "";
  const lvl = level === "error" ? "ERR" : level === "warn" ? "WRN" : level === "info" ? "INF" : "DBG";
  // Tag padronizada com padding para alinhar colunas
  const padded = `[${tag}]`.padEnd(18);
  return `${ts}${lvl} ${padded} ${message}`;
}

function log(level, tag, message, ...extra) {
  if (LEVELS[level] < MIN_LEVEL) return;

  const key  = `${tag}:${message}`;
  const line = format(level, tag, message);

  if (isDuplicate(key)) return;

  const fn = level === "error" ? console.error
           : level === "warn"  ? console.warn
           : console.log;

  if (extra.length > 0) {
    fn(line, ...extra);
  } else {
    fn(line);
  }
}

// ── API pública ───────────────────────────────────────────────

const logger = {
  debug: (tag, msg, ...extra) => log("debug", tag, msg, ...extra),
  info:  (tag, msg, ...extra) => log("info",  tag, msg, ...extra),
  warn:  (tag, msg, ...extra) => log("warn",  tag, msg, ...extra),
  error: (tag, msg, ...extra) => log("error", tag, msg, ...extra),
};

module.exports = logger;
