// ============================================================
//  Nina v4 — Envio de Mensagens e Arquivos via WhatsApp
// ============================================================

const { MessageMedia } = require("whatsapp-web.js");
const fs   = require("fs");
const path = require("path");

let _client = null;

function setClient(client) {
  _client = client;
}

// ── Texto simples ─────────────────────────────────────────────

async function sendText(msg, senderNumber, text) {
  const safe = text.length > 4000 ? text.slice(0, 3900) + "\n...(truncado)" : text;
  try {
    await msg.reply(safe);
  } catch {
    try { await _client.sendMessage(senderNumber, safe); }
    catch (e) { console.error("[Sender] Falha ao enviar texto:", e.message); }
  }
}

// ── Arquivo (HTML, PDF, imagem, zip, qualquer coisa) ──────────

async function sendFile(senderNumber, filePath, caption = "") {
  if (!_client) throw new Error("Client não inicializado");
  if (!fs.existsSync(filePath)) throw new Error(`Arquivo não encontrado: ${filePath}`);

  const media = MessageMedia.fromFilePath(filePath);
  await _client.sendMessage(senderNumber, media, { caption });
  console.log(`[Sender] Arquivo enviado: ${filePath}`);
}

// ── Arquivo a partir de conteúdo em memória ───────────────────

async function sendFileFromContent(senderNumber, filename, content, caption = "") {
  if (!_client) throw new Error("Client não inicializado");

  // Detecta mimetype pelo nome
  const ext = path.extname(filename).toLowerCase();
  const mimeMap = {
    ".html": "text/html",
    ".css":  "text/css",
    ".js":   "application/javascript",
    ".py":   "text/x-python",
    ".sh":   "text/x-shellscript",
    ".txt":  "text/plain",
    ".json": "application/json",
    ".md":   "text/markdown",
    ".zip":  "application/zip",
    ".pdf":  "application/pdf",
    ".png":  "image/png",
    ".jpg":  "image/jpeg",
  };
  const mimetype = mimeMap[ext] || "application/octet-stream";

  const data  = Buffer.from(content).toString("base64");
  const media = new MessageMedia(mimetype, data, filename);

  await _client.sendMessage(senderNumber, media, { caption });
  console.log(`[Sender] Arquivo em memória enviado: ${filename}`);
}

module.exports = { setClient, sendText, sendFile, sendFileFromContent };
