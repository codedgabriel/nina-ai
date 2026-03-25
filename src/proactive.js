const log = require("./logger");
// ============================================================
//  Nina v4 — Resposta Proativa a Contexto
//
//  A Nina te contacta sem você pedir quando detecta que faz
//  sentido. Não é spam — é julgamento contextual.
//
//  Gatilhos implementados:
//
//  1. SILÊNCIO + ANOMALIA
//     Você não manda mensagem há X horas E algo estranho
//     aconteceu no servidor → ela te avisa.
//
//  2. REUNIÃO IMINENTE SEM CONTEXTO
//     Tem reunião em 15min e você não falou nada hoje
//     → ela te lembra proativamente.
//
//  3. WATCHER CRÍTICO + AUSÊNCIA
//     Um watcher disparou algo importante e você está
//     offline há muito tempo → ela insiste.
//
//  4. PADRÃO QUEBRADO
//     Você costuma mandar mensagem todo dia às 8h mas
//     hoje não mandou até as 10h → ela verifica se está ok.
//
//  Anti-spam:
//  - Cooldown de 2h entre contatos proativos
//  - Máximo 3 contatos proativos por dia
//  - Nunca no horário de silêncio (exceto crítico)
//  - Registra cada contato no histórico de decisões
// ============================================================

const cron  = require("node-cron");
const axios = require("axios");

const {
  DEEPSEEK_API_KEY, DEEPSEEK_BASE_URL, DEEPSEEK_MODEL, MY_NUMBER,
} = require("./config");
const { logDecision, getRecentActions, getDecisions } = require("./decisions");

let _send      = null;
let _getLastMsg = null;  // função que retorna timestamp da última msg do usuário

function setProactiveSender(fn) { _send = fn; }
function setLastMessageGetter(fn) { _getLastMsg = fn; }

// ── Estado anti-spam ──────────────────────────────────────────

const state = {
  lastContact:    0,    // timestamp do último contato proativo
  contactsToday:  0,    // quantos contatos hoje
  lastContactDay: null, // dia do último reset
};

const LIMITS = {
  cooldownMs:    2 * 60 * 60 * 1000, // 2h entre contatos
  maxPerDay:     3,                   // máximo 3 por dia
  silenceHours:  { start: 23, end: 7 },
  silenceThresholdHours: 4,           // horas sem msg pra considerar "ausente"
  patternHour:   8,                   // hora que você costuma mandar a primeira msg
  patternTolerance: 120,              // minutos de tolerância no padrão
};

function resetDailyIfNeeded() {
  const today = new Date().toISOString().slice(0, 10);
  if (state.lastContactDay !== today) {
    state.contactsToday  = 0;
    state.lastContactDay = today;
  }
}

function canContact() {
  resetDailyIfNeeded();
  const now = Date.now();
  const h   = new Date().getHours();

  // Horário de silêncio
  const { start, end } = LIMITS.silenceHours;
  const inQuiet = start > end ? (h >= start || h < end) : (h >= start && h < end);
  if (inQuiet) return false;

  // Cooldown
  if (now - state.lastContact < LIMITS.cooldownMs) return false;

  // Limite diário
  if (state.contactsToday >= LIMITS.maxPerDay) return false;

  return true;
}

function canContactCritical() {
  // Crítico ignora silêncio e cooldown, mas respeita limite diário
  resetDailyIfNeeded();
  return state.contactsToday < LIMITS.maxPerDay + 2; // 2 extras pra crítico
}

async function sendProactive(message, reason, urgency = "info") {
  if (!_send) return;

  const isCritical = urgency === "critico";
  if (isCritical ? !canContactCritical() : !canContact()) return;

  state.lastContact   = Date.now();
  state.contactsToday++;

  await _send(message).catch((e) =>
    log.error("Proactive", String("[Proactive] Erro ao enviar:", e.message)
  );

  logDecision({
    category:    "proactive",
    action:      `contato proativo: "${message.slice(0, 80)}"`,
    reason,
    urgency,
    triggered_by: "autonomous",
  });

  log.info("Proactive", `enviado: ${message.slice(0, 80)}`);
}

// ── Consulta IA pra decidir se deve contactar ─────────────────

async function shouldContact(context, recentActions) {
  if (!DEEPSEEK_API_KEY) return { should: false };

  const actionsText = recentActions.length > 0
    ? recentActions.map((a) => `- ${a.action} (${a.created_at.slice(11, 16)})`).join("\n")
    : "nenhuma ação recente";

  try {
    const res = await axios.post(
      `${DEEPSEEK_BASE_URL}/chat/completions`,
      {
        model: DEEPSEEK_MODEL,
        messages: [
          {
            role: "system",
            content: `Você é Nina, assistente proativa. Decida se deve contactar DG agora.
Responda SOMENTE com JSON:
{"should": true|false, "message": "mensagem curta pra DG em pt-BR, sem emoji, max 2 frases", "urgency": "critico|importante|info"}
Se não há motivo real: {"should": false}

Regras:
- Só contacte se há algo genuinamente útil ou importante
- Não incomode por bobagem
- Prefira não contactar em caso de dúvida`,
          },
          {
            role: "user",
            content: `Contexto: ${context}\n\nAções recentes da Nina:\n${actionsText}`,
          },
        ],
        temperature: 0.2,
        max_tokens:  200,
      },
      { headers: { Authorization: `Bearer ${DEEPSEEK_API_KEY}` }, timeout: 15_000 }
    );

    const raw = res.data?.choices?.[0]?.message?.content?.trim();
    const m   = raw?.match(/\{[\s\S]*\}/);
    return m ? JSON.parse(m[0]) : { should: false };
  } catch {
    return { should: false };
  }
}

// ── Gatilho 1: Silêncio + Anomalia ───────────────────────────

async function checkSilenceAnomaly() {
  if (!_getLastMsg) return;

  const lastMsgTime = _getLastMsg();
  if (!lastMsgTime) return;

  const hoursSilent = (Date.now() - lastMsgTime) / 3600000;
  if (hoursSilent < LIMITS.silenceThresholdHours) return;

  // Verifica se houve anomalias nas últimas horas
  const recentActions = getRecentActions(LIMITS.silenceThresholdHours);
  const anomalies     = recentActions.filter((a) =>
    a.category === "monitor" || a.category === "watcher"
  );

  if (anomalies.length === 0) return;

  const context = `DG está há ${hoursSilent.toFixed(1)}h sem mandar mensagem. ` +
    `Houve ${anomalies.length} evento(s) no servidor nesse período: ` +
    anomalies.map((a) => a.action).join(", ");

  const decision = await shouldContact(context, recentActions);
  if (decision.should) {
    await sendProactive(decision.message, context, decision.urgency || "importante");
  }
}

// ── Gatilho 2: Reunião iminente sem contato ───────────────────

async function checkUpcomingMeetingNoContext() {
  try {
    const { isAuthenticated, listEvents } = require("./google");
    if (!isAuthenticated() || !_getLastMsg) return;

    const events = await listEvents({ days: 1, maxResults: 10 });
    if (events.includes("nenhum evento")) return;

    const now   = new Date();
    const lines = events.split("\n").filter((l) => l.includes("—"));

    for (const line of lines) {
      const timeMatch = line.match(/(\d{2}):(\d{2})/);
      if (!timeMatch) continue;

      const eventTime = new Date();
      eventTime.setHours(parseInt(timeMatch[1]), parseInt(timeMatch[2]), 0, 0);

      const minutesUntil = (eventTime - now) / 60000;
      if (minutesUntil < 10 || minutesUntil > 20) continue; // janela: 10-20min

      // Verifica se já falou sobre esse evento hoje
      const lastMsg     = _getLastMsg();
      const hoursSilent = lastMsg ? (Date.now() - lastMsg) / 3600000 : 999;

      if (hoursSilent < 2) continue; // falou há menos de 2h, já está ativo

      const eventName = line.split("—")[1]?.trim() || "compromisso";

      await sendProactive(
        `em ${Math.round(minutesUntil)}min: ${eventName}`,
        `reunião iminente sem contato recente (${hoursSilent.toFixed(1)}h sem msg)`,
        "importante"
      );
      break;
    }
  } catch {}
}

// ── Gatilho 3: Padrão quebrado ────────────────────────────────

async function checkBrokenPattern() {
  if (!_getLastMsg) return;

  const now    = new Date();
  const hour   = now.getHours();
  const minute = now.getMinutes();

  // Só verifica no período após o horário esperado (ex: 8h) + tolerância
  const minutesSinceExpected = (hour * 60 + minute) - (LIMITS.patternHour * 60);
  if (minutesSinceExpected < LIMITS.patternTolerance ||
      minutesSinceExpected > LIMITS.patternTolerance + 30) return;

  const lastMsg     = _getLastMsg();
  const hoursSilent = lastMsg ? (Date.now() - lastMsg) / 3600000 : 999;

  // Se não mandou mensagem hoje e já passou do horário esperado
  if (hoursSilent < 12) return; // mandou algo nas últimas 12h

  // Verifica se isso é realmente incomum (últimos 3 dias tinha msg pela manhã)
  const recentDecisions = getDecisions({ days: 3, category: "proactive", limit: 5 });
  const alreadyChecked  = recentDecisions.some((d) =>
    d.action.includes("padrão quebrado") &&
    d.created_at.slice(0, 10) === now.toISOString().slice(0, 10)
  );
  if (alreadyChecked) return;

  const recentActions = getRecentActions(12);
  const decision = await shouldContact(
    `DG costuma mandar mensagem por volta das ${LIMITS.patternHour}h mas hoje ainda não mandou (${hoursSilent.toFixed(0)}h de silêncio)`,
    recentActions
  );

  if (decision.should) {
    await sendProactive(decision.message, "padrão de mensagem quebrado", "info");
  }
}

// ── Funções de configuração ───────────────────────────────────

function getProactiveStatus() {
  resetDailyIfNeeded();
  const now = Date.now();
  const cooldownLeft = Math.max(0, LIMITS.cooldownMs - (now - state.lastContact));

  return [
    `contatos hoje: ${state.contactsToday}/${LIMITS.maxPerDay}`,
    `cooldown restante: ${cooldownLeft > 0 ? Math.round(cooldownLeft / 60000) + "min" : "pronto"}`,
    `ausência threshold: ${LIMITS.silenceThresholdHours}h`,
    `padrão esperado: ${LIMITS.patternHour}h (±${LIMITS.patternTolerance}min)`,
    `horário de silêncio: ${LIMITS.silenceHours.start}h–${LIMITS.silenceHours.end}h`,
  ].join("\n");
}

function setSilenceThreshold(hours) {
  LIMITS.silenceThresholdHours = hours;
  return `threshold de ausência: ${hours}h`;
}

function setPatternHour(hour) {
  LIMITS.patternHour = hour;
  return `padrão de mensagem esperado às ${hour}h`;
}

function setMaxContactsPerDay(n) {
  LIMITS.maxPerDay = n;
  return `máximo de contatos proativos por dia: ${n}`;
}

// ── Start ─────────────────────────────────────────────────────

function startProactive() {
  // Checa silêncio + anomalia a cada 30min
  cron.schedule("*/30 * * * *", () => {
    checkSilenceAnomaly().catch(console.error);
  });

  // Checa reunião iminente a cada 5min
  cron.schedule("*/5 * * * *", () => {
    checkUpcomingMeetingNoContext().catch(console.error);
  });

  // Checa padrão quebrado uma vez por dia (às 10h)
  cron.schedule("0 10 * * *", () => {
    checkBrokenPattern().catch(console.error);
  });

  log.info("Proactive", "sistema ativo");
}

module.exports = {
  setProactiveSender,
  setLastMessageGetter,
  startProactive,
  getProactiveStatus,
  setSilenceThreshold,
  setPatternHour,
  setMaxContactsPerDay,
  sendProactive,
};
