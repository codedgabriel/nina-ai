// ============================================================
//  Nina v7 — Jarvis Mode (Function Calling Real)
//  O modelo decide sozinho quando e como usar ferramentas
// ============================================================

const { Client, LocalAuth } = require("whatsapp-web.js");
const qrcode = require("qrcode-terminal");

const { MY_NUMBER, SESSION_PATH, ALLOWED_NUMBERS } = require("./config");
const { saveMessage, getLastMessageId }            = require("./db");
const { saveToVector }                             = require("./vector");
const { askNina }                                  = require("./ollama");
const { learnFromMessage }                         = require("./learner");
const { savePhoto }                                = require("./files");
const { handleReminderIfNeeded, startReminderCron, setMessageSender } = require("./reminders");
const {
  getContact, saveContact,
  isWaitingIdentification, markAskedIdentification, clearPendingIdentification,
} = require("./contacts");

// ── Confirmações pendentes { number -> cmd } ──────────────────

const pendingConfirmations = new Map();

// ── Cliente WhatsApp ─────────────────────────────────────────

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
  console.log("[Nina] Conectada no WhatsApp. Jarvis mode ativo.");
  setMessageSender((text) => client.sendMessage(MY_NUMBER, text));
  startReminderCron();
});

// ── Helpers ──────────────────────────────────────────────────

async function persistMessage(role, content, fromNumber) {
  saveMessage(role, content, fromNumber);
  const id  = getLastMessageId();
  saveToVector(id, content, role, fromNumber, new Date().toISOString()).catch(() => {});
}

async function sendReply(msg, senderNumber, text) {
  const safe = text.length > 4000 ? text.slice(0, 3900) + "\n...(truncado)" : text;
  try {
    await msg.reply(safe);
  } catch {
    try { await client.sendMessage(senderNumber, safe); }
    catch (e) { console.error("[WhatsApp] Falha ao enviar:", e.message); }
  }
}

// ── Debounce ─────────────────────────────────────────────────

const processing = new Set();

// ── Handler ───────────────────────────────────────────────────

client.on("message", async (msg) => {
  if (!ALLOWED_NUMBERS.includes(msg.from)) return;
  if (msg.isGroupMsg || msg.from.includes("@g.us")) return;

  if (processing.has(msg.id.id)) return;
  processing.add(msg.id.id);
  setTimeout(() => processing.delete(msg.id.id), 15_000);

  const senderNumber = msg.from;
  const isOwner      = senderNumber === MY_NUMBER;

  let contact = getContact(senderNumber);
  if (isOwner && !contact) {
    saveContact(senderNumber, "DG");
    contact = getContact(senderNumber);
  }

  // ── Foto ─────────────────────────────────────────────────
  if (msg.hasMedia && (msg.type === "image" || msg.type === "video")) {
    try {
      const media    = await msg.downloadMedia();
      const buffer   = Buffer.from(media.data, "base64");
      const ext      = media.mimetype.split("/")[1] || "jpg";
      const filepath = savePhoto(buffer, `foto.${ext}`);
      const reply    = `salvo em ${filepath}`;
      await persistMessage("user", "[foto]", senderNumber);
      await persistMessage("nina", reply, senderNumber);
      await sendReply(msg, senderNumber, reply);
    } catch {
      await sendReply(msg, senderNumber, "não consegui salvar a foto");
    }
    return;
  }

  if (!msg.body || msg.body.trim() === "") return;

  const userText = msg.body.trim();
  console.log(`\n[${contact?.name || senderNumber}] ${userText}`);
  await persistMessage("user", userText, senderNumber);

  learnFromMessage(userText, contact, senderNumber).catch(() => {});

  let reply;

  // ── Identificação de novo contato ─────────────────────────
  if (!contact && !isWaitingIdentification(senderNumber)) {
    markAskedIdentification(senderNumber);
    reply = "oi, não te conheço ainda. quem é?";
    await persistMessage("nina", reply, senderNumber);
    await sendReply(msg, senderNumber, reply);
    return;
  }

  if (!contact && isWaitingIdentification(senderNumber)) {
    saveContact(senderNumber, userText.trim());
    clearPendingIdentification(senderNumber);
    contact = getContact(senderNumber);
    reply   = `ok, ${userText.trim()}`;
    await persistMessage("nina", reply, senderNumber);
    await sendReply(msg, senderNumber, reply);
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
      reply = error ? `erro: ${error}` : `\`\`\`\n${output}\n\`\`\``;
    } else {
      pendingConfirmations.delete(senderNumber);
      reply = "cancelado";
    }

    await persistMessage("nina", reply, senderNumber);
    await sendReply(msg, senderNumber, reply);
    return;
  }

  // ── Lembrete direto (parser rápido como fallback) ─────────
  // O modelo também pode criar lembretes via tool call
  handleReminderIfNeeded(userText);

  // ── Resposta principal via function calling ───────────────
  try {
    reply = await askNina(userText, contact, senderNumber);
  } catch (err) {
    console.error("[Nina] Erro:", err.message);
    reply = "travei aqui, manda de novo";
  }

  // Detecta se o modelo pediu confirmação de comando perigoso
  if (reply.startsWith("⚠️ comando perigoso")) {
    const match = reply.match(/`([^`]+)`/);
    if (match) pendingConfirmations.set(senderNumber, match[1]);
  }

  await persistMessage("nina", reply, senderNumber);
  console.log(`[Nina] ${reply}`);
  await sendReply(msg, senderNumber, reply);
});

client.on("auth_failure", (msg) => console.error("[Nina] Falha auth:", msg));
client.on("disconnected",  (r)   => console.warn("[Nina] Desconectada:", r));

console.log("[Nina] Inicializando...");
client.initialize();
