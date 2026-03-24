// ============================================================
//  Nina v4 — Handler Principal
//  WhatsApp + DeepSeek + Groq Whisper + Monitor Proativo
// ============================================================

const { Client, LocalAuth } = require("whatsapp-web.js");
const qrcode = require("qrcode-terminal");

const { MY_NUMBER, SESSION_PATH, ALLOWED_NUMBERS } = require("./config");
const { saveMessage, getLastMessageId }             = require("./db");
const { saveToVector }                              = require("./vector");
const { askNina }                                   = require("./deepseek");
const { learnFromMessage }                          = require("./learner");
const { savePhoto }                                 = require("./files");
const { transcribeAudio }                           = require("./audio");
const { setClient, sendText }                       = require("./sender");
const { analyzeImage }                              = require("./vision");
const { updateLocationFromCoords, updateLocationFromText } = require("./location");
const { startNotifications, setNotificationSender, enqueue } = require("./notifications");
const {
  setProactiveSender, setLastMessageGetter, startProactive,
}                                                           = require("./proactive");
const { logDecision }                                       = require("./decisions");
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

const pendingConfirmations = new Map();
let lastUserMessageAt = null;  // timestamp da última msg do usuário

// ── Cliente WhatsApp ──────────────────────────────────────────

const client = new Client({
  authStrategy: new LocalAuth({ dataPath: SESSION_PATH }),
  puppeteer: {
    headless: true,
    args: ["--no-sandbox","--disable-setuid-sandbox","--disable-dev-shm-usage","--disable-gpu"],
  },
});

client.on("qr", (qr) => {
  console.log("\n[Nina] Escaneie o QR Code:\n");
  qrcode.generate(qr, { small: true });
});

client.on("ready", () => {
  console.log("[Nina] Conectada. DeepSeek + Groq + Monitor ativo.");

  const send = (text) => client.sendMessage(MY_NUMBER, text);

  setClient(client);
  _sendMessage = send;         // watchdog restart
  setMessageSender(send);    // lembretes
  setAnyMessageSender((number, text) => client.sendMessage(number, text)); // lembretes p/ terceiros
  setMonitorSender(send);    // monitor proativo
  setWatcherSender(send);    // watchers customizáveis
  setSendProgress((num, txt) => client.sendMessage(num, txt).catch(() => {}));
  setNotificationSender(send);
  startNotifications();
  setSmartNotify((msg, opts) => enqueue(msg, opts)); // monitor usa notificações inteligentes
  setProactiveSender(send);
  setLastMessageGetter(() => lastUserMessageAt);
  startProactive();
  startReminderCron();
  startMonitor();
  startWatchers();
  initPreinstalledSkills();
  initPreinstalledSkills2();
  initCapabilities();
  startFinance();
});

// ── Helpers ───────────────────────────────────────────────────

async function persist(role, content, fromNumber) {
  saveMessage(role, content, fromNumber);
  const id = getLastMessageId();
  saveToVector(id, content, role, fromNumber, new Date().toISOString()).catch(() => {});
}

// ── Debounce ──────────────────────────────────────────────────

const processing = new Set();

// ── Handler de mensagens ─────────────────────────────────────

client.on("message", async (msg) => {
  if (!ALLOWED_NUMBERS.includes(msg.from)) return;
  if (msg.isGroupMsg || msg.from.includes("@g.us")) return;
  if (processing.has(msg.id.id)) return;

  processing.add(msg.id.id);
  setTimeout(() => processing.delete(msg.id.id), 30_000);

  const senderNumber = msg.from;
  const isOwner      = senderNumber === MY_NUMBER;

  let contact = getContact(senderNumber);
  if (isOwner && !contact) {
    saveContact(senderNumber, "DG");
    contact = getContact(senderNumber);
  }

  // ── Foto / Vídeo ──────────────────────────────────────────
  // ── Localização compartilhada pelo WhatsApp ─────────────
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
      console.error("[Location] Erro:", err.message);
    }
    return;
  }

  if (msg.hasMedia && (msg.type === "image" || msg.type === "video")) {
    try {
      const media  = await msg.downloadMedia();
      const buffer = Buffer.from(media.data, "base64");
      const ext    = media.mimetype.split("/")[1] || "jpg";
      const fp     = savePhoto(buffer, `foto.${ext}`);
      const reply  = `salvo em ${fp}`;
      await persist("user", "[foto]", senderNumber);
      await persist("nina", reply, senderNumber);
      await sendText(msg, senderNumber, reply);
    } catch {
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
      console.log(`\n[${contact?.name || senderNumber}] 🎤 "${transcript}"`);
      await sendText(msg, senderNumber, `_"${transcript}"_`); // eco do que entendeu
      await persist("user", transcript, senderNumber);
      learnFromMessage(transcript, contact, senderNumber).catch(() => {});
      handleReminderIfNeeded(transcript);

      const reply = await askNina(transcript, contact, senderNumber).catch(() => "travei, manda de novo");
      await persist("nina", reply, senderNumber);
      await sendText(msg, senderNumber, reply);
    } catch (err) {
      console.error("[Audio] Erro:", err.message);
      await sendText(msg, senderNumber, "erro ao processar áudio");
    }
    return;
  }

  if (!msg.body?.trim()) return;

  const userText = msg.body.trim();
  lastUserMessageAt = Date.now();  // atualiza timestamp de atividade
  console.log(`\n[${contact?.name || senderNumber}] ${userText}`);
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
    saveContact(senderNumber, userText.trim());
    clearPendingIdentification(senderNumber);
    contact = getContact(senderNumber);
    const reply = `ok, ${userText.trim()}`;
    await persist("nina", reply, senderNumber);
    await sendText(msg, senderNumber, reply);
    return;
  }

  // ── Confirmação de comando perigoso ───────────────────────
  if (isOwner && pendingConfirmations.has(senderNumber)) {
    const cmd = pendingConfirmations.get(senderNumber);
    const txt = userText.toLowerCase().trim();

    if (/^(sim|confirma|confirmo|pode|yes|ok|executa)$/.test(txt)) {
      pendingConfirmations.delete(senderNumber);
      const { runCommand } = require("./shell");
      const { output, error } = await runCommand(cmd, 60_000);
      const reply = error ? `erro: ${error}` : `\`\`\`\n${output}\n\`\`\``;
      await persist("nina", reply, senderNumber);
      await sendText(msg, senderNumber, reply);
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
    console.error("[Nina] Erro:", err.message);
    reply = "travei aqui, manda de novo";
  }

  if (reply.startsWith("⚠️ comando perigoso")) {
    const match = reply.match(/`([^`]+)`/);
    if (match) pendingConfirmations.set(senderNumber, match[1]);
  }

  await persist("nina", reply, senderNumber);
  console.log(`[Nina] ${reply}`);
  await sendText(msg, senderNumber, reply);
});

client.on("auth_failure", (msg) => console.error("[Nina] Falha auth:", msg));
client.on("disconnected",  (r)   => console.warn("[Nina] Desconectada:", r));

// ── Watchdog: avisa quando reinicia ──────────────────────────
// Se caiu e voltou, DG sabe que aconteceu

const UPTIME_FILE = "./nina-last-start.json";
const fs_wd = require("fs");

function notifyRestart() {
  try {
    const now = Date.now();
    if (fs_wd.existsSync(UPTIME_FILE)) {
      const last = JSON.parse(fs_wd.readFileSync(UPTIME_FILE, "utf-8"));
      const downtime = Math.round((now - last.ts) / 1000);
      // Se ficou mais de 30s fora, avisa
      if (downtime > 30) {
        // Agenda o aviso pra depois do client estar pronto
        setTimeout(() => {
          if (_sendMessage) {
            const mins = Math.round(downtime / 60);
            const msg  = downtime < 120
              ? `voltei. fiquei ${downtime}s fora.`
              : `voltei. fiquei ${mins} minuto(s) fora.`;
            _sendMessage(msg).catch(() => {});
          }
        }, 10000);
      }
    }
    fs_wd.writeFileSync(UPTIME_FILE, JSON.stringify({ ts: now, pid: process.pid }));
  } catch {}
}

// Também avisa se o processo vai morrer (SIGTERM do systemd)
let _sendMessage = null; // referência pra função de envio
process.on("SIGTERM", async () => {
  console.log("[Nina] SIGTERM recebido — encerrando graciosamente");
  try {
    if (_sendMessage) await _sendMessage("encerrando por sinal do sistema. volto em instantes.");
  } catch {}
  process.exit(0);
});

process.on("uncaughtException", (err) => {
  console.error("[Nina] Erro não capturado:", err.message);
  // Não derruba — deixa o systemd reiniciar se necessário
});

process.on("unhandledRejection", (reason) => {
  console.error("[Nina] Promise rejeitada:", reason);
});

notifyRestart();

console.log("[Nina] Inicializando...");
client.initialize();
