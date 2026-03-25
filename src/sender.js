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

// ── Quebra de mensagens estilo WhatsApp ───────────────────────
//
// Regras:
//  1. Se o texto tem até 200 chars e até 3 linhas → manda de uma vez
//  2. Se não → tenta quebrar em blocos menores por parágrafo/linha em branco
//  3. Cada bloco deve ser autocontido (sem conectivos artificiais)
//  4. Máximo de 4000 chars por mensagem (limite WhatsApp)
//
// Lógica de quebra:
//  - Primeiro divide por linha em branco (parágrafos naturais)
//  - Se algum parágrafo ainda for grande, divide por quebra de linha simples
//  - Agrupa parágrafos pequenos consecutivos em uma mensagem só
//    (até 200 chars / 3 linhas por mensagem)

const MAX_CHARS_PER_MSG  = 200;  // acima disso → candidato a quebra
const MAX_LINES_PER_MSG  = 3;    // acima disso → candidato a quebra
const WHATSAPP_HARD_LIMIT = 4000; // limite absoluto do WhatsApp

function splitIntoMessages(text) {
  if (!text || !text.trim()) return ["..."];

  // Caso simples: curto o suficiente pra mandar de uma vez
  const lines = text.split("\n");
  if (text.length <= MAX_CHARS_PER_MSG && lines.length <= MAX_LINES_PER_MSG) {
    return [text.trim()];
  }

  // Divide por blocos separados por linha(s) em branco
  const paragraphs = text
    .split(/\n{2,}/)
    .map(p => p.trim())
    .filter(Boolean);

  // Se só tem um parágrafo longo, divide por linha simples
  const chunks = [];
  for (const para of paragraphs) {
    const paraLines = para.split("\n").map(l => l.trim()).filter(Boolean);

    // Parágrafo cabe em uma mensagem → adiciona como unidade
    if (para.length <= MAX_CHARS_PER_MSG && paraLines.length <= MAX_LINES_PER_MSG) {
      chunks.push(para);
      continue;
    }

    // Parágrafo grande: quebra linha por linha agrupando
    let current = [];
    let currentLen = 0;

    for (const line of paraLines) {
      const wouldBeLen = currentLen + (current.length > 0 ? 1 : 0) + line.length;
      const wouldBeLines = current.length + 1;

      if (current.length > 0 && (wouldBeLen > MAX_CHARS_PER_MSG || wouldBeLines > MAX_LINES_PER_MSG)) {
        chunks.push(current.join("\n"));
        current = [line];
        currentLen = line.length;
      } else {
        current.push(line);
        currentLen = wouldBeLen;
      }
    }
    if (current.length > 0) chunks.push(current.join("\n"));
  }

  // Garante que nenhum chunk ultrapassa o limite absoluto do WhatsApp
  const safeChunks = chunks.map(c =>
    c.length > WHATSAPP_HARD_LIMIT ? c.slice(0, WHATSAPP_HARD_LIMIT - 20) + "\n...(truncado)" : c
  );

  return safeChunks.filter(Boolean);
}

// ── Texto simples (única mensagem, sem quebra) ────────────────

async function sendText(msg, senderNumber, text) {
  const safe = text.length > WHATSAPP_HARD_LIMIT
    ? text.slice(0, WHATSAPP_HARD_LIMIT - 20) + "\n...(truncado)"
    : text;
  try {
    await msg.reply(safe);
  } catch {
    try { await _client.sendMessage(senderNumber, safe); }
    catch (e) { console.error("[Sender] Falha ao enviar texto:", e.message); }
  }
}

// ── Múltiplas mensagens curtas estilo WhatsApp ────────────────
//
// Use esta função em vez de sendText para respostas da Nina.
// Quebra automaticamente textos longos em várias mensagens,
// com delay natural entre elas (simula digitação humana).

const DELAY_BETWEEN_MSGS_MS = 600; // pausa entre mensagens (ms)

async function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function sendMultipleMessages(msg, senderNumber, text) {
  const parts = splitIntoMessages(text);

  if (parts.length === 1) {
    // Uma só mensagem → comportamento original
    return sendText(msg, senderNumber, parts[0]);
  }

  // Primeira mensagem: usa reply pra manter o contexto da thread
  try {
    await msg.reply(parts[0]);
  } catch {
    try { await _client.sendMessage(senderNumber, parts[0]); }
    catch (e) { console.error("[Sender] Falha msg 1:", e.message); return; }
  }

  // Mensagens subsequentes: envia diretamente com delay
  for (let i = 1; i < parts.length; i++) {
    await sleep(DELAY_BETWEEN_MSGS_MS);
    try {
      await _client.sendMessage(senderNumber, parts[i]);
    } catch (e) {
      console.error(`[Sender] Falha msg ${i + 1}:`, e.message);
    }
  }

  console.log(`[Sender] Mensagem enviada em ${parts.length} parte(s)`);
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

module.exports = { setClient, sendText, sendFile, sendFileFromContent, sendMultipleMessages, splitIntoMessages };
