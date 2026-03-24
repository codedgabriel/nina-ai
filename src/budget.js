// ============================================================
//  Nina v4 — Orçamento de API e Autonomia
//
//  Dois sistemas integrados:
//
//  1. ORÇAMENTO FINANCEIRO
//     Rastreia tokens gastos por dia e bloqueia quando passa do limite.
//     Preços baseados nos valores atuais do DeepSeek.
//     Persiste em JSON pra sobreviver a reinicializações.
//
//  2. ORÇAMENTO DE AUTONOMIA
//     Define o que a Nina pode fazer sem confirmar vs. pedir permissão.
//     Três níveis por categoria de ação:
//       "auto"    → faz sem perguntar
//       "confirm" → pede confirmação antes
//       "deny"    → nunca faz, independente do pedido
// ============================================================

const fs   = require("fs");
const path = require("path");

// ── Preços DeepSeek (USD por 1M tokens, Jan 2025) ────────────
const PRICES = {
  "deepseek-chat": {
    input:  0.27,   // $0.27 / 1M tokens de entrada
    output: 1.10,   // $1.10 / 1M tokens de saída
  },
  "deepseek-reasoner": {
    input:  0.55,
    output: 2.19,
  },
};

// ── Arquivo de estado (persiste entre reinicializações) ───────
const BUDGET_FILE = "./nina-budget.json";

function loadState() {
  try {
    if (fs.existsSync(BUDGET_FILE)) {
      return JSON.parse(fs.readFileSync(BUDGET_FILE, "utf-8"));
    }
  } catch {}
  return {
    today:       getToday(),
    tokensIn:    0,
    tokensOut:   0,
    costUSD:     0,
    totalCostUSD: 0,
    callCount:   0,
    blocked:     false,
    history:     [],  // [{date, costUSD, calls}]
  };
}

function saveState() {
  fs.writeFileSync(BUDGET_FILE, JSON.stringify(state, null, 2), "utf-8");
}

function getToday() {
  return new Date().toISOString().slice(0, 10);
}

let state = loadState();

// Reseta contadores diários se mudou o dia
function checkDayRollover() {
  const today = getToday();
  if (state.today !== today) {
    // Salva histórico do dia anterior
    state.history.push({
      date:    state.today,
      costUSD: state.costUSD,
      calls:   state.callCount,
      tokensIn:  state.tokensIn,
      tokensOut: state.tokensOut,
    });
    // Mantém últimos 30 dias
    if (state.history.length > 30) state.history.shift();

    state.today     = today;
    state.tokensIn  = 0;
    state.tokensOut = 0;
    state.costUSD   = 0;
    state.callCount = 0;
    state.blocked   = false;
    saveState();
  }
}

// ── API pública: registra uso ─────────────────────────────────

function trackUsage(model, promptTokens, completionTokens) {
  checkDayRollover();

  const prices = PRICES[model] || PRICES["deepseek-chat"];
  const cost   = (promptTokens * prices.input + completionTokens * prices.output) / 1_000_000;

  state.tokensIn    += promptTokens;
  state.tokensOut   += completionTokens;
  state.costUSD     += cost;
  state.totalCostUSD += cost;
  state.callCount   += 1;

  // Verifica se passou do limite
  const limits = getBudgetConfig();
  if (state.costUSD >= limits.dailyLimitUSD) {
    state.blocked = true;
    console.warn(`[Budget] ⚠️  Limite diário atingido: $${state.costUSD.toFixed(4)} / $${limits.dailyLimitUSD}`);
  }

  saveState();

  console.log(`[Budget] $${cost.toFixed(5)} | hoje: $${state.costUSD.toFixed(4)}/$${limits.dailyLimitUSD} | ${state.callCount} calls`);
}

function isBlocked() {
  checkDayRollover();
  const limits = getBudgetConfig();
  return state.costUSD >= limits.dailyLimitUSD;
}

function getBudgetStatus() {
  checkDayRollover();
  const limits = getBudgetConfig();
  const pct    = ((state.costUSD / limits.dailyLimitUSD) * 100).toFixed(0);
  const remaining = Math.max(0, limits.dailyLimitUSD - state.costUSD);

  const lines = [
    `orçamento hoje (${state.today}):`,
    `  gasto:     $${state.costUSD.toFixed(4)} de $${limits.dailyLimitUSD} (${pct}%)`,
    `  restante:  $${remaining.toFixed(4)}`,
    `  calls:     ${state.callCount}`,
    `  tokens:    ${state.tokensIn.toLocaleString()} in + ${state.tokensOut.toLocaleString()} out`,
    `  total acc: $${state.totalCostUSD.toFixed(4)}`,
  ];

  if (state.history.length > 0) {
    lines.push("últimos dias:");
    state.history.slice(-5).reverse().forEach((h) => {
      lines.push(`  ${h.date}: $${h.costUSD.toFixed(4)} (${h.calls} calls)`);
    });
  }

  return lines.join("\n");
}

// ── Configuração do orçamento ─────────────────────────────────
// Lida do arquivo pra ser editável sem reiniciar

const BUDGET_CONFIG_FILE = "./nina-budget-config.json";

const DEFAULT_BUDGET_CONFIG = {
  dailyLimitUSD: 2.00,   // $2/dia — barato e generoso pra uso pessoal
  warnAtPct:     80,     // avisa quando chegar em 80%
  blockOnLimit:  true,   // bloqueia quando atingir o limite
};

function getBudgetConfig() {
  try {
    if (fs.existsSync(BUDGET_CONFIG_FILE)) {
      return { ...DEFAULT_BUDGET_CONFIG, ...JSON.parse(fs.readFileSync(BUDGET_CONFIG_FILE, "utf-8")) };
    }
  } catch {}
  return DEFAULT_BUDGET_CONFIG;
}

function setBudgetLimit(usd) {
  const config = getBudgetConfig();
  config.dailyLimitUSD = usd;
  fs.writeFileSync(BUDGET_CONFIG_FILE, JSON.stringify(config, null, 2));
  return `Limite diário definido: $${usd}`;
}

// ── ORÇAMENTO DE AUTONOMIA ────────────────────────────────────
//
// Categorias de ação e seus níveis de permissão padrão.
// Você pode mudar via WhatsApp: "muda autonomia de shell pra confirm"

const AUTONOMY_CONFIG_FILE = "./nina-autonomy-config.json";

const DEFAULT_AUTONOMY = {
  // "auto" = faz sem perguntar
  // "confirm" = pede confirmação
  // "deny" = nunca faz

  shell_read:       "auto",     // ls, cat, ps, df, top, grep, find
  shell_write:      "auto",     // criação de arquivos, mkdir
  shell_execute:    "auto",     // execução de scripts
  shell_install:    "confirm",  // apt install, npm install, pip install
  shell_dangerous:  "confirm",  // rm, kill, chmod, etc.
  shell_system:     "deny",     // shutdown, reboot, mkfs

  browser_read:     "auto",     // navegar, extrair dados, ler páginas
  browser_interact: "auto",     // clicar, preencher formulários
  browser_auth:     "confirm",  // fazer login em qualquer site
  browser_purchase: "confirm",  // qualquer ação que envolva dinheiro

  file_read:        "auto",     // ler arquivos
  file_write:       "auto",     // criar/editar arquivos
  file_delete:      "confirm",  // deletar arquivos
  file_system:      "deny",     // mexer em /etc, /sys, /boot

  network_fetch:    "auto",     // buscar URLs, APIs
  network_send:     "auto",     // enviar dados (webhooks, APIs)
  network_external: "confirm",  // mandar email, SMS, webhook externo

  cron_add:         "auto",     // agendar tarefas
  cron_remove:      "auto",     // remover tarefas agendadas

  self_restart:     "auto",     // reiniciar o processo
  self_update:      "confirm",  // git pull + reiniciar
  self_modify:      "deny",     // modificar o próprio código
};

function getAutonomyConfig() {
  try {
    if (fs.existsSync(AUTONOMY_CONFIG_FILE)) {
      return { ...DEFAULT_AUTONOMY, ...JSON.parse(fs.readFileSync(AUTONOMY_CONFIG_FILE, "utf-8")) };
    }
  } catch {}
  return { ...DEFAULT_AUTONOMY };
}

function setAutonomy(category, level) {
  if (!["auto", "confirm", "deny"].includes(level)) {
    return `nível inválido: use auto, confirm ou deny`;
  }
  const config = getAutonomyConfig();
  if (!(category in DEFAULT_AUTONOMY)) {
    return `categoria inválida: ${category}. Categorias: ${Object.keys(DEFAULT_AUTONOMY).join(", ")}`;
  }
  config[category] = level;
  fs.writeFileSync(AUTONOMY_CONFIG_FILE, JSON.stringify(config, null, 2));
  return `autonomia de "${category}" → ${level}`;
}

function getAutonomyStatus() {
  const config = getAutonomyConfig();
  const groups = {
    "Shell":    ["shell_read","shell_write","shell_execute","shell_install","shell_dangerous","shell_system"],
    "Browser":  ["browser_read","browser_interact","browser_auth","browser_purchase"],
    "Arquivos": ["file_read","file_write","file_delete","file_system"],
    "Rede":     ["network_fetch","network_send","network_external"],
    "Cron":     ["cron_add","cron_remove"],
    "Auto-gestão": ["self_restart","self_update","self_modify"],
  };

  const icon = { auto: "✓", confirm: "?", deny: "✗" };
  const lines = ["configuração de autonomia:"];

  for (const [group, keys] of Object.entries(groups)) {
    lines.push(`\n${group}:`);
    for (const k of keys) {
      const level = config[k];
      lines.push(`  ${icon[level]} ${k.replace(/_/g," ").padEnd(20)} ${level}`);
    }
  }

  return lines.join("\n");
}

// ── checkAutonomy: chamado pelo executor antes de agir ────────
//
// Retorna:
//   { allowed: true }           → pode executar
//   { allowed: false, confirm: true, message }  → pede confirmação
//   { allowed: false, confirm: false, message } → bloqueado

function checkAutonomy(category, description = "") {
  const config = getAutonomyConfig();
  const level  = config[category] || "confirm"; // padrão seguro

  if (level === "auto") {
    return { allowed: true };
  }

  if (level === "confirm") {
    return {
      allowed:  false,
      confirm:  true,
      message:  `preciso de confirmação para: ${description || category}`,
      category,
    };
  }

  // deny
  return {
    allowed:  false,
    confirm:  false,
    message:  `não tenho autorização para: ${description || category} (categoria: ${category} = deny)`,
    category,
  };
}

module.exports = {
  // Financeiro
  trackUsage,
  isBlocked,
  getBudgetStatus,
  setBudgetLimit,
  getBudgetConfig,
  // Autonomia
  checkAutonomy,
  getAutonomyStatus,
  setAutonomy,
  getAutonomyConfig,
  DEFAULT_AUTONOMY,
};
