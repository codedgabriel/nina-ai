const log = require("./logger");
// ============================================================
//  Nina v4 — Watchers Customizáveis
//
//  Você configura pelo WhatsApp em linguagem natural:
//  "me avisa se bitcoin cair abaixo de 90k"
//  "vigia /var/log/app.log e me avisa se aparecer ERROR"
//  "me avisa se google.com cair"
//  "roda 'free -m' a cada 10min e me avisa se mudar muito"
//
//  Cada watcher é salvo no SQLite e roda no seu próprio cron.
//  A IA decide se a condição foi atingida antes de notificar.
// ============================================================

const cron  = require("node-cron");
const axios = require("axios");
const fs    = require("fs");

const { runCommand }   = require("./shell");
const { logDecision }  = require("./decisions");
const { searchWeb }    = require("./search");
const {
  DEEPSEEK_API_KEY, DEEPSEEK_BASE_URL, DEEPSEEK_MODEL,
} = require("./config");

let _send = null;
function setWatcherSender(fn) { _send = fn; }

function notify(text) {
  if (_send) _send(text).catch((e) => log.error("Watcher", String("[Watcher] notify err:", e.message));
  log.info("Watcher", `→ ${text.slice(0, 100)}`);
}

// ── Armazenamento em memória + persistência JSON ──────────────
// (Simples: JSON em disco. Sem depender de migração no SQLite.)

const WATCHERS_FILE = "./nina-watchers.json";

function loadWatchers() {
  try {
    if (fs.existsSync(WATCHERS_FILE)) {
      return JSON.parse(fs.readFileSync(WATCHERS_FILE, "utf-8"));
    }
  } catch {}
  return [];
}

function saveWatchers(watchers) {
  fs.writeFileSync(WATCHERS_FILE, JSON.stringify(watchers, null, 2), "utf-8");
}

let watchers = loadWatchers();
let cronJobs = new Map(); // id -> cron job

// ── Gera ID único ─────────────────────────────────────────────

function genId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 5);
}

// ── Pergunta ao DeepSeek se a condição foi atingida ───────────

async function aiEvaluate(watcher, currentValue) {
  if (!DEEPSEEK_API_KEY) {
    // Fallback sem IA: compara string simples
    return currentValue !== watcher.lastValue;
  }

  try {
    const res = await axios.post(
      `${DEEPSEEK_BASE_URL}/chat/completions`,
      {
        model: DEEPSEEK_MODEL,
        messages: [
          {
            role: "system",
            content: `Você avalia se uma condição de alerta foi atingida.
Responda SOMENTE com JSON: {"triggered": true|false, "message": "mensagem curta pra DG em pt-BR explicando o que aconteceu, sem emoji"}
Se a condição não foi atingida: {"triggered": false}`,
          },
          {
            role: "user",
            content: `Watcher: "${watcher.description}"
Condição original: "${watcher.condition}"
Valor anterior: ${watcher.lastValue ?? "nenhum (primeira verificação)"}
Valor atual: ${currentValue}

A condição foi atingida?`,
          },
        ],
        temperature: 0.1,
        max_tokens:  150,
      },
      { headers: { Authorization: `Bearer ${DEEPSEEK_API_KEY}` }, timeout: 15_000 }
    );

    const raw = res.data?.choices?.[0]?.message?.content?.trim();
    const m   = raw?.match(/\{[\s\S]*\}/);
    if (!m) return { triggered: false };
    return JSON.parse(m[0]);
  } catch (err) {
    log.error("Watcher", String("[Watcher] aiEvaluate error:", err.message);
    return { triggered: false };
  }
}

// ── Executores de cada tipo ───────────────────────────────────

async function checkPrice(watcher) {
  // Usa DuckDuckGo pra buscar o preço atual
  const result = await searchWeb(`${watcher.target} price USD current`);
  return result?.slice(0, 300) || "sem resultado";
}

async function checkLog(watcher) {
  // Lê as últimas N linhas do log
  const { output } = await runCommand(
    `tail -n ${watcher.lines || 50} "${watcher.target}" 2>/dev/null`
  );
  return output || "(arquivo vazio ou não encontrado)";
}

async function checkUrl(watcher) {
  try {
    const start = Date.now();
    const res   = await axios.get(watcher.target, {
      timeout: 10_000,
      maxRedirects: 5,
      validateStatus: () => true, // não lança erro em 4xx/5xx
    });
    const ms = Date.now() - start;
    return `status: ${res.status} | tempo: ${ms}ms | tamanho: ${String(res.data).length} chars`;
  } catch (err) {
    return `ERRO: ${err.message}`;
  }
}

async function checkCommand(watcher) {
  const { output, error } = await runCommand(watcher.target, 30_000);
  return error ? `ERRO: ${error}` : (output || "(sem output)");
}

async function checkKeyword(watcher) {
  // Monitora um arquivo ou URL por palavra-chave
  let content = "";
  if (watcher.target.startsWith("http")) {
    const res  = await axios.get(watcher.target, { timeout: 10_000 }).catch(() => null);
    content = res ? String(res.data).replace(/<[^>]+>/g, " ").slice(0, 2000) : "erro ao acessar";
  } else {
    const { output } = await runCommand(`cat "${watcher.target}" 2>/dev/null | tail -200`);
    content = output || "(não encontrado)";
  }
  return content;
}

// ── Dispatcher ─────────────────────────────────────────────────

async function runWatcher(watcher) {
  let currentValue = "";

  try {
    switch (watcher.type) {
      case "price":   currentValue = await checkPrice(watcher);   break;
      case "log":     currentValue = await checkLog(watcher);     break;
      case "url":     currentValue = await checkUrl(watcher);     break;
      case "command": currentValue = await checkCommand(watcher); break;
      case "keyword": currentValue = await checkKeyword(watcher); break;
      default:        currentValue = await checkCommand(watcher);
    }
  } catch (err) {
    log.error("Watcher", String(`[Watcher:${watcher.id}] Erro ao coletar:`, err.message);
    return;
  }

  // Avalia com IA se disparou
  const eval_ = await aiEvaluate(watcher, currentValue);

  // Atualiza lastValue e checkCount
  const idx = watchers.findIndex((w) => w.id === watcher.id);
  if (idx >= 0) {
    watchers[idx].lastValue    = currentValue;
    watchers[idx].lastChecked  = new Date().toISOString();
    watchers[idx].checkCount   = (watchers[idx].checkCount || 0) + 1;

    if (eval_.triggered) {
      watchers[idx].triggerCount = (watchers[idx].triggerCount || 0) + 1;
      watchers[idx].lastTriggered = new Date().toISOString();
      notify(`watcher "${watcher.description}":\n${eval_.message || currentValue.slice(0, 200)}`);
      logDecision({ category: "watcher", action: `watcher disparou: ${watcher.description}`, reason: watcher.condition, result: (eval_.message || "").slice(0, 100), urgency: "info" });

      // Se oneshot, desativa após disparar
      if (watcher.oneshot) {
        watchers[idx].active = false;
        stopWatcher(watcher.id);
        notify(`watcher "${watcher.description}" desativado (oneshot)`);
      }
    }

    saveWatchers(watchers);
  }
}

// ── CRUD de watchers ──────────────────────────────────────────

/**
 * Cria um novo watcher e agenda o cron.
 * Chamado pelo executor quando a Nina usa a tool add_watcher.
 */
function addWatcher(opts) {
  const {
    description,  // "me avisa se bitcoin cair abaixo de 90k"
    type,         // price | log | url | command | keyword
    target,       // o que monitorar (URL, path, comando, ticker)
    condition,    // a condição em linguagem natural
    interval,     // "5m", "1h", "30s", etc.
    oneshot = false,
    lines = 50,   // para logs: quantas linhas
  } = opts;

  const id = genId();

  // Converte interval pra cron expression
  const cronExpr = intervalToCron(interval || "5m");

  const watcher = {
    id, description, type, target, condition,
    cronExpr, interval: interval || "5m",
    oneshot, lines,
    active:       true,
    createdAt:    new Date().toISOString(),
    lastChecked:  null,
    lastValue:    null,
    lastTriggered: null,
    checkCount:   0,
    triggerCount: 0,
  };

  watchers.push(watcher);
  saveWatchers(watchers);
  scheduleWatcher(watcher);

  return watcher;
}

function removeWatcher(id) {
  stopWatcher(id);
  const before = watchers.length;
  watchers = watchers.filter((w) => w.id !== id);
  saveWatchers(watchers);
  return watchers.length < before;
}

function pauseWatcher(id) {
  const w = watchers.find((w) => w.id === id);
  if (!w) return false;
  w.active = false;
  stopWatcher(id);
  saveWatchers(watchers);
  return true;
}

function resumeWatcher(id) {
  const w = watchers.find((w) => w.id === id);
  if (!w) return false;
  w.active = true;
  scheduleWatcher(w);
  saveWatchers(watchers);
  return true;
}

function listWatchers() {
  if (watchers.length === 0) return "nenhum watcher configurado";
  return watchers.map((w) => {
    const status = w.active ? "ativo" : "pausado";
    const last   = w.lastChecked
      ? `último check: ${new Date(w.lastChecked).toLocaleTimeString("pt-BR")}`
      : "nunca verificado";
    const triggers = w.triggerCount > 0 ? ` | disparou ${w.triggerCount}x` : "";
    return `[${w.id}] ${w.description}\n  tipo: ${w.type} | a cada: ${w.interval} | ${status} | ${last}${triggers}`;
  }).join("\n\n");
}

// ── Scheduling ────────────────────────────────────────────────

function intervalToCron(interval) {
  const match = interval.match(/^(\d+)(s|m|h|d)$/);
  if (!match) return "*/5 * * * *"; // padrão: 5min

  const [, num, unit] = match;
  const n = parseInt(num);

  switch (unit) {
    case "s": return `*/${Math.max(n, 10)} * * * * *`; // mín 10s (cron com segundos)
    case "m": return `*/${n} * * * *`;
    case "h": return `0 */${n} * * *`;
    case "d": return `0 0 */${n} * *`;
    default:  return "*/5 * * * *";
  }
}

function scheduleWatcher(watcher) {
  if (!watcher.active) return;

  // Para job existente se houver
  stopWatcher(watcher.id);

  try {
    const job = cron.schedule(watcher.cronExpr, () => {
      runWatcher(watcher).catch((e) =>
        log.error("Watcher", String(`[Watcher:${watcher.id}] Erro:`, e.message)
      );
    });
    cronJobs.set(watcher.id, job);
    log.info("Watcher", `"${watcher.description}" agendado (${watcher.interval})`);
  } catch (err) {
    log.error("Watcher", String(`[Watcher] Erro ao agendar ${watcher.id}:`, err.message);
  }
}

function stopWatcher(id) {
  const job = cronJobs.get(id);
  if (job) {
    job.stop();
    cronJobs.delete(id);
  }
}

// ── Init: carrega e agenda todos os watchers salvos ───────────

function startWatchers() {
  const active = watchers.filter((w) => w.active);
  for (const w of active) scheduleWatcher(w);
  log.info("Watchers", `${active.length} watcher(s) carregado(s)`);
}

module.exports = {
  setWatcherSender,
  startWatchers,
  addWatcher,
  removeWatcher,
  pauseWatcher,
  resumeWatcher,
  listWatchers,
  runWatcher,
};
