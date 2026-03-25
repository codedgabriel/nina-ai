const log = require("./logger");
// ============================================================
//  Nina v4 — Lembretes com suporte a terceiros
//
//  Agora suporta:
//  - Lembretes pra você (como sempre)
//  - Lembretes pra outros contatos salvos
//    Ex: "manda mensagem pra Jhully às 17h lembrando de tomar remédio"
//    → às 17h a Nina manda diretamente pra Jhully no WhatsApp
// ============================================================

const cron = require("node-cron");
const {
  saveReminder, getPendingReminders, markReminderSent,
} = require("./db");
const { getAllContacts } = require("./contacts");
const { MY_NUMBER }     = require("./config");
const { logDecision }   = require("./decisions");

let _sendMessage = null;     // envia pro número principal (DG)
let _sendToAny   = null;     // envia pra qualquer número

function setMessageSender(fn)  { _sendMessage = fn; }
function setAnyMessageSender(fn) { _sendToAny = fn; }

// ── Parser de linguagem natural ───────────────────────────────

function parseReminder(message) {
  const msg = message.toLowerCase();

  const isReminder = /\b(lembr|lembra|lembrar|avisa|avise|me lembra|me avisa|lembrete|consegue me lembrar|pode me lembrar|manda mensagem)\b/.test(msg);
  if (!isReminder) return null;

  let hour = null, minute = 0;

  const timeRegex = /(?:às?|as)\s+(\d{1,2})(?:[h:](\d{2}))?/;
  const match     = msg.match(timeRegex);
  if (match) {
    hour   = parseInt(match[1], 10);
    minute = match[2] ? parseInt(match[2], 10) : 0;
  }
  if (!match) {
    if (/meia[\s-]noite/.test(msg)) { hour = 0;  minute = 0; }
    else if (/meio[\s-]dia/.test(msg))  { hour = 12; minute = 0; }
  }
  if (hour === null) return null;

  let text = message;
  const afterKeyword = message.match(/(?:de |para |pra |:\s*)(.+)/i);
  if (afterKeyword) {
    text = afterKeyword[1].replace(/às?\s+\d{1,2}(?:[h:]\d{2})?/i, "").trim();
  }

  const time = `${String(hour).padStart(2,"0")}:${String(minute).padStart(2,"0")}`;
  return { time, text: text || message };
}

function handleReminderIfNeeded(message) {
  const parsed = parseReminder(message);
  if (!parsed) return false;
  saveReminder(parsed.text, parsed.time);
  log.info("Lembrete", `salvo: "${parsed.text}" às ${parsed.time}`);
  return parsed;
}

// ── Resolve nome de contato para número ───────────────────────

function resolveContactNumber(name) {
  if (!name) return null;
  const contacts = getAllContacts();
  const nameLower = name.toLowerCase().trim();
  const found = contacts.find((c) =>
    c.name && c.name.toLowerCase().includes(nameLower)
  );
  return found || null;
}

// ── Cron: verifica lembretes a cada minuto ────────────────────

function startReminderCron() {
  cron.schedule("* * * * *", async () => {
    const now         = new Date();
    const currentTime = `${String(now.getHours()).padStart(2,"0")}:${String(now.getMinutes()).padStart(2,"0")}`;
    const currentDate = now.toISOString().slice(0, 10);

    const pending = getPendingReminders();

    for (const reminder of pending) {
      if (reminder.remind_at !== currentTime) continue;
      if (reminder.remind_date && reminder.remind_date !== currentDate) continue;

      const targetNumber = reminder.target_number;
      const targetName   = reminder.target_name || "contato";
      const text         = reminder.text;

      try {
        if (targetNumber && targetNumber !== MY_NUMBER && _sendToAny) {
          // Manda pro contato terceiro
          await _sendToAny(targetNumber, text);
          // Avisa DG que mandou
          if (_sendMessage) {
            await _sendMessage(`lembrete enviado pra ${targetName}: "${text}"`);
          }
          logDecision({
            category:    "notification",
            action:      `lembrete enviado pra ${targetName} (${targetNumber})`,
            reason:      `horário programado: ${currentTime}`,
            result:      text.slice(0, 80),
            urgency:     "info",
            triggered_by: "cron",
          });
          log.info("Lembrete", `enviado → ${targetName}: "${text.slice(0, 60)}"`);
        } else {
          // Manda pro próprio DG
          if (_sendMessage) await _sendMessage(`🔔 ${text}`);
          logDecision({
            category:    "notification",
            action:      `lembrete enviado pra DG`,
            reason:      `horário programado: ${currentTime}`,
            result:      text.slice(0, 80),
            urgency:     "info",
            triggered_by: "cron",
          });
          log.info("Lembrete", `enviado → DG: "${text.slice(0, 60)}"`);
        }
      } catch (err) {
        log.error("Lembrete", err.message);
      }

      markReminderSent(reminder.id);
    }
  });

  log.info("Lembrete", "cron ativo");
}

module.exports = {
  handleReminderIfNeeded,
  startReminderCron,
  setMessageSender,
  setAnyMessageSender,
  resolveContactNumber,
};
