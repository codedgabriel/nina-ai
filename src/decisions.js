// ============================================================
//  Nina v4 — Histórico de Decisões
//
//  Registra TUDO que a Nina faz de forma autônoma:
//  - Ações do monitor (limpou cache, reiniciou serviço)
//  - Tools executadas (run_script, browser_task, etc.)
//  - Watchers que dispararam
//  - Notificações enviadas
//  - Skills criadas
//
//  Persiste em SQLite — consultável por período, categoria, etc.
//  Você pode perguntar: "o que você fez essa semana?"
//  → ela gera um resumo legível de todas as ações com contexto.
// ============================================================

const Database = require("better-sqlite3");
const { DB_PATH } = require("./config");

const db = new Database(DB_PATH);

db.exec(`
  CREATE TABLE IF NOT EXISTS decisions (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    category    TEXT NOT NULL,
    action      TEXT NOT NULL,
    reason      TEXT,
    result      TEXT,
    urgency     TEXT DEFAULT 'info',
    triggered_by TEXT DEFAULT 'autonomous',
    created_at  DATETIME DEFAULT (datetime('now','localtime'))
  );

  CREATE INDEX IF NOT EXISTS decisions_category ON decisions(category);
  CREATE INDEX IF NOT EXISTS decisions_created ON decisions(created_at);
`);

// ── Categorias ────────────────────────────────────────────────
// monitor     → ações do monitor proativo (recursos, serviços)
// tool        → tool calls executadas autonomamente
// watcher     → watchers que dispararam
// notification→ notificações enviadas
// skill       → skills criadas ou executadas
// proactive   → contatos proativos (Nina te chamou)
// optimization→ otimizações automáticas

/**
 * Registra uma decisão/ação.
 */
function logDecision(opts) {
  const {
    category,      // monitor | tool | watcher | notification | skill | proactive | optimization
    action,        // o que foi feito (ex: "limpei cache do kernel")
    reason,        // por quê (ex: "RAM em 87% por 2 checks consecutivos")
    result,        // resultado (ex: "RAM caiu pra 72%")
    urgency = "info",
    triggered_by = "autonomous", // autonomous | user | cron | watcher
  } = opts;

  db.prepare(`
    INSERT INTO decisions (category, action, reason, result, urgency, triggered_by)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(category, action, reason || null, result || null, urgency, triggered_by);
}

/**
 * Busca decisões com filtros.
 */
function getDecisions(opts = {}) {
  const {
    days       = 7,
    category   = null,
    urgency    = null,
    limit      = 50,
    since      = null,  // ISO date string
  } = opts;

  let query = "SELECT * FROM decisions WHERE 1=1";
  const params = [];

  if (since) {
    query += " AND created_at >= ?";
    params.push(since);
  } else {
    query += " AND created_at >= datetime('now', ?)";
    params.push(`-${days} days`);
  }

  if (category) {
    query += " AND category = ?";
    params.push(category);
  }

  if (urgency) {
    query += " AND urgency = ?";
    params.push(urgency);
  }

  query += " ORDER BY created_at DESC LIMIT ?";
  params.push(limit);

  return db.prepare(query).all(...params);
}

/**
 * Contagem por categoria no período.
 */
function getDecisionStats(days = 7) {
  return db.prepare(`
    SELECT category, COUNT(*) as count, urgency
    FROM decisions
    WHERE created_at >= datetime('now', ?)
    GROUP BY category, urgency
    ORDER BY count DESC
  `).all(`-${days} days`);
}

/**
 * Formata o histórico pra leitura humana.
 */
function formatDecisionHistory(days = 7, category = null) {
  const decisions = getDecisions({ days, category, limit: 100 });

  if (!decisions.length) {
    return `nenhuma ação registrada nos últimos ${days} dias.`;
  }

  // Agrupa por dia
  const byDay = {};
  for (const d of decisions) {
    const day = d.created_at.slice(0, 10);
    if (!byDay[day]) byDay[day] = [];
    byDay[day].push(d);
  }

  const lines = [`histórico dos últimos ${days} dias (${decisions.length} ações):\n`];

  for (const [day, items] of Object.entries(byDay).sort().reverse()) {
    const date = new Date(day + "T12:00:00").toLocaleDateString("pt-BR", {
      weekday: "long", day: "numeric", month: "long",
    });
    lines.push(`── ${date} ──`);

    for (const item of items) {
      const time     = item.created_at.slice(11, 16);
      const cat      = item.category.padEnd(12);
      const action   = item.action;
      const reason   = item.reason ? ` (motivo: ${item.reason})` : "";
      const result   = item.result ? ` → ${item.result}` : "";
      lines.push(`  ${time} [${cat}] ${action}${reason}${result}`);
    }
    lines.push("");
  }

  // Resumo por categoria
  const stats = getDecisionStats(days);
  if (stats.length > 0) {
    lines.push("── resumo por categoria ──");
    const grouped = {};
    for (const s of stats) {
      grouped[s.category] = (grouped[s.category] || 0) + s.count;
    }
    for (const [cat, count] of Object.entries(grouped).sort((a, b) => b[1] - a[1])) {
      lines.push(`  ${cat}: ${count} ação(ões)`);
    }
  }

  return lines.join("\n");
}

/**
 * Ações recentes da última hora — usado pelo sistema proativo.
 */
function getRecentActions(hours = 1) {
  return db.prepare(`
    SELECT category, action, result, created_at
    FROM decisions
    WHERE created_at >= datetime('now', ?)
    ORDER BY created_at DESC
    LIMIT 20
  `).all(`-${hours} hours`);
}

module.exports = {
  logDecision,
  getDecisions,
  getDecisionStats,
  formatDecisionHistory,
  getRecentActions,
};
