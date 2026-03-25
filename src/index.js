// ============================================================
//  Nina v4 — Handler Principal
//  WhatsApp + DeepSeek + Groq Whisper + Monitor Proativo
// ============================================================

const fs     = require("fs");
const log    = require("./logger");
const { Client, LocalAuth } = require("whatsapp-web.js");
const qrcode = require("qrcode-terminal");

const { MY_NUMBER, SESSION_PATH, ALLOWED_NUMBERS, DANGEROUS_CONFIRM } = require("./config");
const { saveMessage, getLastMessageId }             = require("./db");
const { saveToVector }                              = require("./vector");
const { askNina }                                   = require("./deepseek");
const { learnFromMessage }                          = require("./learner");
const { savePhoto }                                 = require("./files");
const { transcribeAudio }                           = require("./audio");
const { setClient, sendText, sendMultipleMessages } = require("./sender");
const { updateLocationFromCoords }                  = require("./location");
const { startNotifications, setNotificationSender, enqueue } = require("./notifications");
const {
  setProactiveSender, setLastMessageGetter, startProactive,
} = require("./proactive");
const { setSendProgress }                           = require("./executor");
const { handleReminderIfNeeded, startReminderCron, setMessageSender, setAnyMessageSender } = require("./reminders");
const { startMonitor, setMonitorSender, setSmartNotify } = require("./monitor");
const { initPreinstalledSkills }                    = require("./preinstalled-skills");
const { initCapabilities }                          = require("./capabilities");
const { startFinance }                              = require("./finance");
const { initPreinstalledSkills2 }                   = require("./preinstalled-skills-2");
const { startWatchers, setWatcherSender }           = require("./watchers");
const {
  getContact, saveContact,
  isWaitingIdentification, markAskedIdentification, clearPendingIdentification,
} = require("./contacts");
const { setActivityGetter, autoImproveIfNeeded } = require("./self-improve");

// ── Estado global ─────────────────────────────────────────────

const pendingConfirmations = new Map();
let lastUserMessageAt = null;

// FIX: declarar _sendMessage ANTES de notifyRestart() que já a referencia
let _sendMessage = null;

// ── Watchdog ──────────────────────────────────────────────────

const UPTIME_FILE = "./nina-last-start.json";

function notifyRestart() {
  try {
    const now = Date.now();
    if (fs.existsSync(UPTIME_FILE)) {
      const last     = JSON.parse(fs.readFileSync(UPTIME_FILE, "utf-8"));
      const downtime = Math.round((now - last.ts) / 1000);
      if (downtime > 30) {
        setTimeout(() => {
          if (_sendMessage) {
            const mins = Math.round(downtime / 60);
            const text = downtime < 120
              ? `voltei. fiquei ${downtime}s fora.`
              : `voltei. fiquei ${mins} minuto(s) fora.`;
            _sendMessage(text).catch(() => {});
          }
        }, 10_000);
      }
    }
    fs.writeFileSync(UPTIME_FILE, JSON.stringify({ ts: now, pid: process.pid }));
  } catch {}
}

// ── Sinais do processo ────────────────────────────────────────

process.on("SIGTERM", async () => {
  log.info("Nina", "SIGTERM recebido — encerrando graciosamente");
  try {
    if (_sendMessage) await _sendMessage("encerrando por sinal do sistema. volto em instantes.");
  } catch {}
  process.exit(0);
});

process.on("uncaughtException", (err) => {
  log.error("Nina", "Erro não capturado: " + err.message, err.stack);
});

process.on("unhandledRejection", (reason) => {
  log.error("Nina", "Promise rejeitada: " + String(reason));
});

// ── Normaliza número WhatsApp ─────────────────────────────────

function normalizeNumber(from) {
  // FIX: usa replace com regex para cobrir variações de @lid
  return from.replace(/@lid(\b|$)/i, "@c.us");
}

// ── Cliente WhatsApp ──────────────────────────────────────────

const client = new Client({
  authStrategy: new LocalAuth({ dataPath: SESSION_PATH }),
  puppeteer: {
    headless: true,
    args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage", "--disable-gpu"],
  },
});

client.on("qr", (qr) => {
  log.info("Nina", "Escaneie o QR Code:");
  qrcode.generate(qr, { small: true });
});

client.on("ready", () => {
  log.info("Nina", "Conectada. DeepSeek + Groq + Monitor ativo.");

  const send = (text) => client.sendMessage(MY_NUMBER, text);

  _sendMessage = send;
  setClient(client);
  setMessageSender(send);
  setAnyMessageSender((number, text) => client.sendMessage(number, text));
  setMonitorSender(send);
  setWatcherSender(send);
  setSendProgress((num, txt) => client.sendMessage(num, txt).catch(() => {}));
  setNotificationSender(send);
  startNotifications();
  setSmartNotify((notifMsg, opts) => enqueue(notifMsg, opts));
  setProactiveSender(send);
  setLastMessageGetter(() => lastUserMessageAt);
  setActivityGetter(() => lastUserMessageAt);  // self-improve usa para checar inatividade
  startProactive();
  startReminderCron();
  startMonitor();
  startWatchers();
  initPreinstalledSkills();
  initPreinstalledSkills2();
  initCapabilities();
  startFinance();

  // Auto-melhoria guiada por erros — verifica a cada 30 min
  setInterval(() => {
    autoImproveIfNeeded(_sendMessage).catch(() => {});
  }, 30 * 60 * 1000);
});

client.on("auth_failure", (m) => log.error("Nina", "Falha auth: " + m));
client.on("disconnected",  (r) => log.warn("Nina", "Desconectada: " + r));

// ── Helpers ───────────────────────────────────────────────────

async function persist(role, content, fromNumber) {
  saveMessage(role, content, fromNumber);
  const id = getLastMessageId();
  saveToVector(id, content, role, fromNumber, new Date().toISOString()).catch(() => {});
}

// ── Deduplicação de mensagens ─────────────────────────────────

const processing = new Set();

// ── Handler de mensagens ──────────────────────────────────────

client.on("message", async (msg) => {
  const senderNumber = normalizeNumber(msg.from);

  // FIX: filtrar grupos usando número já normalizado
  if (msg.isGroupMsg || senderNumber.includes("@g.us")) return;

  // FIX: verificação de ALLOWED_NUMBERS funcional (antes estava comentada)
  const allowedNormalized = ALLOWED_NUMBERS.map(normalizeNumber);
  if (allowedNormalized.length > 0 && !allowedNormalized.includes(senderNumber)) {
    log.warn("Nina", `Número não autorizado: ${senderNumber}`);
    return;
  }

  if (processing.has(msg.id.id)) return;
  processing.add(msg.id.id);
  setTimeout(() => processing.delete(msg.id.id), 30_000);

  const isOwner = senderNumber === normalizeNumber(MY_NUMBER);

  let contact = getContact(senderNumber);
  if (isOwner && !contact) {
    saveContact(senderNumber, "DG");
    contact = getContact(senderNumber);
  }

  // ── Localização ───────────────────────────────────────────
  if (msg.type === "location") {
    try {
      const lat = msg.location?.latitude  || msg.lat;
      const lon = msg.location?.longitude || msg.lng;
      if (lat && lon) {
        const geo   = await updateLocationFromCoords(lat, lon);
        const reply = `localização atualizada: ${geo.name}`;
        await persist("user", "[localização]", senderNumber);
        await persist("nina", reply, senderNumber);
        await sendText(msg, senderNumber, reply);
      }
    } catch (err) {
      log.error("Location", err.message);
    }
    return;
  }

  // ── Foto / Vídeo ──────────────────────────────────────────
  if (msg.hasMedia && (msg.type === "image" || msg.type === "video")) {
    try {
      const media  = await msg.downloadMedia();
      const buffer = Buffer.from(media.data, "base64");
      // FIX: strip codec info do mimetype (ex: "image/webp; codecs=...")
      const ext    = media.mimetype.split("/")[1]?.split(";")[0] || "jpg";
      const fp     = savePhoto(buffer, `foto.${ext}`);
      const reply  = `salvo em ${fp}`;
      await persist("user", "[foto]", senderNumber);
      await persist("nina", reply, senderNumber);
      await sendText(msg, senderNumber, reply);
    } catch (err) {
      log.error("Foto", err.message);
      await sendText(msg, senderNumber, "não consegui salvar a foto");
    }
    return;
  }

  // ── Áudio (voz) ───────────────────────────────────────────
  if (msg.hasMedia && (msg.type === "ptt" || msg.type === "audio")) {
    try {
      const media      = await msg.downloadMedia();
      const transcript = await transcribeAudio(media);

      if (!transcript) {
        await sendText(msg, senderNumber, "não consegui transcrever o áudio");
        return;
      }

      lastUserMessageAt = Date.now();
      log.info("Áudio", `${contact?.name || senderNumber}: "${transcript.slice(0, 80)}"`);
      await sendText(msg, senderNumber, `_"${transcript}"_`);
      await persist("user", transcript, senderNumber);
      learnFromMessage(transcript, contact, senderNumber).catch(() => {});
      handleReminderIfNeeded(transcript);

      const reply = await askNina(transcript, contact, senderNumber)
        .catch(() => "travei, manda de novo");
      await persist("nina", reply, senderNumber);
      await sendMultipleMessages(msg, senderNumber, reply);
    } catch (err) {
      log.error("Audio", err.message);
      await sendText(msg, senderNumber, "erro ao processar áudio");
    }
    return;
  }

  if (!msg.body?.trim()) return;

  const userText = msg.body.trim();
  lastUserMessageAt = Date.now();
  log.info(contact?.name || senderNumber, userText.slice(0, 120));
  await persist("user", userText, senderNumber);
  learnFromMessage(userText, contact, senderNumber).catch(() => {});

  // ── Identificação de novo contato ─────────────────────────
  if (!contact && !isWaitingIdentification(senderNumber)) {
    markAskedIdentification(senderNumber);
    const reply = "oi, não te conheço ainda. quem é?";
    await persist("nina", reply, senderNumber);
    await sendText(msg, senderNumber, reply);
    return;
  }

  if (!contact && isWaitingIdentification(senderNumber)) {
    const name = userText.trim();
    saveContact(senderNumber, name);
    clearPendingIdentification(senderNumber);
    contact = getContact(senderNumber);
    const reply = `ok, ${name}`;
    await persist("nina", reply, senderNumber);
    await sendText(msg, senderNumber, reply);
    return;
  }

  // ── Confirmação de comando perigoso ───────────────────────
  if (isOwner && pendingConfirmations.has(senderNumber)) {
    const cmd = pendingConfirmations.get(senderNumber);

    if (/(sim|confirma|confirmo|pode|yes|ok|executa)/i.test(userText.trim())) {
      pendingConfirmations.delete(senderNumber);
      const reply = await askNina(
        `O usuário já confirmou explicitamente a execução do seguinte comando. NÃO peça confirmação novamente. Execute diretamente:\n\n${cmd}`,
        contact,
        senderNumber,
      ).catch(() => "erro ao executar o comando confirmado");
      await persist("nina", reply, senderNumber);
      await sendMultipleMessages(msg, senderNumber, reply);
    } else {
      pendingConfirmations.delete(senderNumber);
      await sendText(msg, senderNumber, "cancelado");
    }
    return;
  }

  handleReminderIfNeeded(userText);

  // ── Resposta principal ────────────────────────────────────
  let reply;
  try {
    reply = await askNina(userText, contact, senderNumber);
  } catch (err) {
    log.error("Nina", err.message);
    reply = "travei aqui, manda de novo";
  }

  // FIX: DANGEROUS_CONFIRM agora importado de config, sem require() aninhado
  if (reply.startsWith("⚠️ comando perigoso") && DANGEROUS_CONFIRM) {
    const match = reply.match(/`([^`]+)`/);
    if (match) pendingConfirmations.set(senderNumber, match[1]);
  }

  await persist("nina", reply, senderNumber);
  log.info("Nina →", reply.slice(0, 120));
  await sendMultipleMessages(msg, senderNumber, reply);
});

// ── Inicia ────────────────────────────────────────────────────

notifyRestart();
log.info("Nina", "Inicializando...");
client.initialize();
