const log = require("./logger");
// ============================================================
//  Nina v4 — Notificações Inteligentes
//
//  Diferente do monitor (que vigia recursos do servidor),
//  este módulo gerencia notificações com CONTEXTO e URGÊNCIA.
//
//  O problema com notificações burras:
//  - "CPU alta" às 3h da manhã quando você está dormindo → inútil
//  - "Email novo" quando você está numa reunião → irritante
//  - "Lembrete: reunião às 14h" às 13h55 → tarde demais
//
//  Notificações inteligentes:
//  1. Urgência: CRÍTICO | IMPORTANTE | INFO | SILENCIOSO
//  2. Timing: considera hora do dia, compromissos, contexto
//  3. Agrupamento: acumula notificações baixas e manda em batch
//  4. Antecipação: avisa compromissos com tempo de deslocamento
//  5. Silêncio inteligente: não incomoda no horário de descanso
// ============================================================

const cron  = require("node-cron");
const axios = require("axios");

const {
  DEEPSEEK_API_KEY, DEEPSEEK_BASE_URL, DEEPSEEK_MODEL, MY_NUMBER,
} = require("./config");
const { getCurrentLocation, estimateTravelTime, getNamedLocation } = require("./location");

let _send = null;
function setNotificationSender(fn) { _send = fn; }

// ── Configuração ──────────────────────────────────────────────

const CONFIG = {
  quietHours: { start: 23, end: 7 },  // não incomoda entre 23h e 7h
  batchInterval: 30,                   // agrupa notificações baixas a cada 30min
  calendarLeadTime: 60,                // avisa compromissos com 60min de antecedência
  travelBuffer: 15,                    // adiciona 15min de margem no deslocamento
};

// ── Fila de notificações ──────────────────────────────────────

const queue = {
  critico:    [],  // envia imediatamente sempre
  importante: [],  // envia imediatamente em horário ativo
  info:       [],  // agrupa e envia no próximo batch
  silencioso: [],  // só aparece no resumo diário
};

function isQuietHours() {
  const h = new Date().getHours();
  const { start, end } = CONFIG.quietHours;
  return start > end
    ? h >= start || h < end   // ex: 23-7 atravessa meia-noite
    : h >= start && h < end;
}

// ── Classifica urgência com IA ────────────────────────────────

async function classifyUrgency(notification) {
  if (!DEEPSEEK_API_KEY) return "info";

  try {
    const res = await axios.post(
      `${DEEPSEEK_BASE_URL}/chat/completions`,
      {
        model: DEEPSEEK_MODEL,
        messages: [
          {
            role: "system",
            content: `Classifique a urgência de uma notificação para o usuário.
Responda SOMENTE com uma das palavras: critico | importante | info | silencioso

critico    = requer ação imediata (servidor caído, erro crítico, emergência)
importante = deve ver em breve mas não urgente (email importante, lembrete próximo)
info       = informativo, pode esperar (atualização de preço, notícia)
silencioso = pode ir pro resumo diário (log de auditoria, estatística)`,
          },
          {
            role: "user",
            content: `Notificação: "${notification.message}"\nContexto: ${notification.context || "nenhum"}`,
          },
        ],
        temperature: 0.1,
        max_tokens:  10,
      },
      { headers: { Authorization: `Bearer ${DEEPSEEK_API_KEY}` }, timeout: 10_000 }
    );

    const raw = res.data?.choices?.[0]?.message?.content?.trim().toLowerCase();
    return ["critico", "importante", "info", "silencioso"].includes(raw) ? raw : "info";
  } catch {
    return "info";
  }
}

// ── Enfileira notificação ─────────────────────────────────────

async function enqueue(message, opts = {}) {
  const {
    urgency: explicitUrgency,
    context = "",
    source  = "sistema",
    skipAI  = false,
  } = opts;

  const urgency = explicitUrgency ||
    (skipAI ? "info" : await classifyUrgency({ message, context }));

  const entry = {
    message,
    context,
    source,
    urgency,
    ts: new Date().toISOString(),
  };

  queue[urgency]?.push(entry);

  // Despacha imediatamente se crítico ou importante em horário ativo
  if (urgency === "critico") {
    await dispatch(entry, true);
  } else if (urgency === "importante" && !isQuietHours()) {
    await dispatch(entry, false);
  }

  log.info("Notify", `[${urgency}] ${message.slice(0, 80)}`);
}

async function dispatch(entry, isUrgent = false) {
  if (!_send) return;
  const prefix = isUrgent ? "URGENTE: " : "";
  await _send(`${prefix}${entry.message}`).catch(
    (e) => log.error("Notify", String("[Notify] dispatch err:", e.message)
  );
}

// ── Flush do batch (a cada 30min) ─────────────────────────────

async function flushInfoBatch() {
  if (isQuietHours()) return;

  const items = [...queue.info.splice(0)];
  if (!items.length) return;

  // Agrupa por fonte e resume
  const msg = items.map((i) => `• ${i.message}`).join("\n");
  await _send?.(`resumo (${items.length} avisos):\n${msg}`).catch(() => {});
}

// ── Antecipação de compromissos ───────────────────────────────
// Verifica Google Calendar e avisa antes com tempo de deslocamento

async function checkUpcomingEvents() {
  try {
    const { isAuthenticated, listEvents } = require("./google");
    if (!isAuthenticated()) return;

    const events = await listEvents({ days: 1, maxResults: 10 });
    if (events.includes("nenhum evento")) return;

    const now     = new Date();
    const lines   = events.split("\n");
    const loc     = getCurrentLocation();

    for (const line of lines) {
      // Extrai horário da linha (formato: "seg., 15 de jan. às 14:00 — Reunião")
      const timeMatch = line.match(/(\d{2}):(\d{2})/);
      if (!timeMatch) continue;

      const [, hStr, mStr] = timeMatch;
      const eventTime = new Date();
      eventTime.setHours(parseInt(hStr), parseInt(mStr), 0, 0);

      const minutesUntil = (eventTime - now) / 60000;

      // Calcula tempo de deslocamento se tiver localização
      let leadTime = CONFIG.calendarLeadTime;
      let travelMsg = "";

      if (loc) {
        // Tenta extrair localização do evento da linha
        const locMatch = line.match(/\| (.+)$/);
        if (locMatch) {
          const { geocode } = require("./location");
          const eventLoc = await geocode(locMatch[1]).catch(() => null);
          if (eventLoc) {
            const travel = estimateTravelTime(loc, eventLoc);
            leadTime = travel.minutes + CONFIG.travelBuffer;
            travelMsg = ` (~${travel.minutes}min de deslocamento, ${travel.km}km)`;
          }
        }
      }

      // Avisa se está dentro da janela de antecipação
      if (minutesUntil > 0 && minutesUntil <= leadTime && minutesUntil > leadTime - CONFIG.batchInterval) {
        const eventName = line.split("—")[1]?.trim() || "compromisso";
        await enqueue(
          `em ${Math.round(minutesUntil)}min: ${eventName}${travelMsg}`,
          { urgency: "importante", source: "calendar", skipAI: true }
        );
      }
    }
  } catch (err) {
    log.error("Notify", String("[Notify] checkUpcomingEvents:", err.message);
  }
}

// ── Notificação de clima antes de sair ────────────────────────
// Se tem compromisso fora → verifica clima

async function checkWeatherForEvents() {
  try {
    const { isAuthenticated, listEvents } = require("./google");
    if (!isAuthenticated()) return;

    const loc = getCurrentLocation();
    if (!loc) return;

    const events = await listEvents({ days: 1, maxResults: 5 });
    if (events.includes("nenhum evento")) return;

    // Se tem evento presencial nas próximas 3h, verifica clima
    const now = new Date();
    const lines = events.split("\n").filter((l) => l.includes("—"));

    for (const line of lines) {
      const timeMatch = line.match(/(\d{2}):(\d{2})/);
      if (!timeMatch) continue;

      const eventTime = new Date();
      eventTime.setHours(parseInt(timeMatch[1]), parseInt(timeMatch[2]), 0, 0);
      const hoursUntil = (eventTime - now) / 3600000;

      if (hoursUntil > 0 && hoursUntil <= 3 && line.includes("|")) {
        // Tem localização → provável evento presencial
        const { runSkill } = require("./skills");
        const weather = await runSkill("clima", loc.city || loc.name).catch(() => null);
        if (weather && (weather.includes("chuva") || weather.includes("rain") || weather.includes("storm"))) {
          await enqueue(
            `vai chover em ${loc.city || loc.name} — leva guarda-chuva pro compromisso`,
            { urgency: "info", source: "weather", skipAI: true }
          );
        }
        break; // Só verifica uma vez por ciclo
      }
    }
  } catch {}
}

// ── Status ────────────────────────────────────────────────────

function getNotificationStatus() {
  const total = Object.values(queue).reduce((s, q) => s + q.length, 0);
  const quiet = isQuietHours();
  return [
    `modo: ${quiet ? "silencioso (horário de descanso)" : "ativo"}`,
    `horário de silêncio: ${CONFIG.quietHours.start}h–${CONFIG.quietHours.end}h`,
    `fila: ${queue.critico.length} críticos | ${queue.importante.length} importantes | ${queue.info.length} info`,
    `antecipação de compromissos: ${CONFIG.calendarLeadTime}min antes`,
    `batch de info: a cada ${CONFIG.batchInterval}min`,
  ].join("\n");
}

function setQuietHours(start, end) {
  CONFIG.quietHours.start = start;
  CONFIG.quietHours.end   = end;
  return `horário de silêncio: ${start}h–${end}h`;
}

function setCalendarLeadTime(minutes) {
  CONFIG.calendarLeadTime = minutes;
  return `aviso de compromissos: ${minutes}min antes`;
}

// ── Crons ─────────────────────────────────────────────────────

function startNotifications() {
  // Flush de infos acumuladas a cada 30min
  cron.schedule(`*/${CONFIG.batchInterval} * * * *`, () => {
    flushInfoBatch().catch(console.error);
  });

  // Checa compromissos a cada 5min
  cron.schedule("*/5 * * * *", () => {
    checkUpcomingEvents().catch(console.error);
    checkWeatherForEvents().catch(console.error);
  });

  log.info("Notify", "sistema ativo");
}

module.exports = {
  enqueue,
  setNotificationSender,
  startNotifications,
  getNotificationStatus,
  setQuietHours,
  setCalendarLeadTime,
  flushInfoBatch,
};
