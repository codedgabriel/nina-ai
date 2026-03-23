// ============================================================
//  Nina — Lembretes Inteligentes
// ============================================================

const cron = require("node-cron");
const { saveReminder, getPendingReminders, markReminderSent } = require("./db");

let _sendMessage = null;

function setMessageSender(fn) {
  _sendMessage = fn;
}

// ── Parser de linguagem natural ──────────────────────────────

function parseReminder(message) {
  const msg = message.toLowerCase();

  const isReminder = /\b(lembr|lembra|lembrar|avisa|avise|me lembra|me avisa|lembrete|consegue me lembrar|pode me lembrar)\b/.test(msg);
  if (!isReminder) return null;

  let hour   = null;
  let minute = 0;

  // "às 15:30", "as 15h30", "às 9h", "às 9"
  const timeRegex = /(?:às?|as)\s+(\d{1,2})(?:[h:](\d{2}))?/;
  const match     = msg.match(timeRegex);

  if (match) {
    hour   = parseInt(match[1], 10);
    minute = match[2] ? parseInt(match[2], 10) : 0;
  }

  if (!match) {
    if (/meia[\s-]noite/.test(msg)) { hour = 0;  minute = 0; }
    else if (/meio[\s-]dia/.test(msg)) { hour = 12; minute = 0; }
  }

  if (hour === null) return null;

  // Extrai texto do lembrete
  let text = message;
  const afterKeyword = message.match(/(?:de |para |pra |:\s*)(.+)/i);
  if (afterKeyword) {
    text = afterKeyword[1].replace(/às?\s+\d{1,2}(?:[h:]\d{2})?/i, "").trim();
  }

  const time = `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
  return { time, text: text || message };
}

function handleReminderIfNeeded(message) {
  const parsed = parseReminder(message);
  if (!parsed) return false;

  saveReminder(parsed.text, parsed.time);
  console.log(`[Lembrete] Salvo: "${parsed.text}" às ${parsed.time}`);
  return parsed;
}

// ── Cron: verifica lembretes a cada minuto ───────────────────

function startReminderCron() {
  cron.schedule("* * * * *", () => {
    if (!_sendMessage) return;

    const now         = new Date();
    const currentTime = `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;
    const currentDate = now.toISOString().slice(0, 10);

    const pending = getPendingReminders();
    for (const reminder of pending) {
      if (reminder.remind_at !== currentTime) continue;
      if (reminder.remind_date && reminder.remind_date !== currentDate) continue;

      _sendMessage(`🔔 ${reminder.text}`);
      markReminderSent(reminder.id);
      console.log(`[Lembrete] Enviado: "${reminder.text}"`);
    }
  });

  console.log("[Lembrete] Cron iniciado.");
}

module.exports = { handleReminderIfNeeded, startReminderCron, setMessageSender };
