// ============================================================
//  Nina v4 — Gmail + Google Calendar
//
//  Setup (uma vez só):
//  1. Acessa console.cloud.google.com
//  2. Cria projeto → Ativa Gmail API + Calendar API
//  3. Credenciais → OAuth 2.0 → Tipo: App de desktop
//  4. Baixa o JSON e extrai client_id e client_secret
//  5. Exporta: GOOGLE_CLIENT_ID=... GOOGLE_CLIENT_SECRET=...
//  6. Manda "nina, conecta google" no WhatsApp
//     → Ela te manda um link → você autoriza → cola o código
//     → Token salvo em nina-google-token.json para sempre
//
//  Após autenticado, tudo funciona automaticamente.
// ============================================================

const { google }   = require("googleapis");
const fs           = require("fs");
const path         = require("path");

const {
  GOOGLE_CLIENT_ID,
  GOOGLE_CLIENT_SECRET,
  GOOGLE_REDIRECT_URI,
  GOOGLE_TOKEN_FILE,
} = require("./config");

// ── OAuth2 Client ─────────────────────────────────────────────

function getOAuth2Client() {
  return new google.auth.OAuth2(
    GOOGLE_CLIENT_ID,
    GOOGLE_CLIENT_SECRET,
    GOOGLE_REDIRECT_URI
  );
}

function isConfigured() {
  return !!(GOOGLE_CLIENT_ID && GOOGLE_CLIENT_SECRET);
}

function isAuthenticated() {
  return isConfigured() && fs.existsSync(GOOGLE_TOKEN_FILE);
}

function loadToken(auth) {
  if (!fs.existsSync(GOOGLE_TOKEN_FILE)) return false;
  const token = JSON.parse(fs.readFileSync(GOOGLE_TOKEN_FILE, "utf-8"));
  auth.setCredentials(token);
  return true;
}

function saveToken(auth) {
  fs.writeFileSync(GOOGLE_TOKEN_FILE, JSON.stringify(auth.credentials, null, 2));
}

// ── Auth flow ─────────────────────────────────────────────────

/**
 * Gera o link de autorização pra mandar pro usuário.
 */
function getAuthUrl() {
  const auth = getOAuth2Client();
  return auth.generateAuthUrl({
    access_type: "offline",
    scope: [
      "https://www.googleapis.com/auth/gmail.readonly",
      "https://www.googleapis.com/auth/gmail.send",
      "https://www.googleapis.com/auth/gmail.modify",
      "https://www.googleapis.com/auth/calendar.readonly",
      "https://www.googleapis.com/auth/calendar.events",
    ],
    prompt: "consent",
  });
}

/**
 * Troca o código de autorização pelo token e salva.
 */
async function exchangeCode(code) {
  const auth = getOAuth2Client();
  const { tokens } = await auth.getToken(code.trim());
  auth.setCredentials(tokens);
  saveToken(auth);
  return true;
}

/**
 * Retorna cliente autenticado ou null.
 */
function getAuthClient() {
  if (!isAuthenticated()) return null;
  const auth = getOAuth2Client();
  loadToken(auth);

  // Auto-refresh token
  auth.on("tokens", (tokens) => {
    if (tokens.refresh_token) {
      const current = JSON.parse(fs.readFileSync(GOOGLE_TOKEN_FILE, "utf-8"));
      fs.writeFileSync(GOOGLE_TOKEN_FILE, JSON.stringify({ ...current, ...tokens }, null, 2));
    }
  });

  return auth;
}

// ── Gmail ─────────────────────────────────────────────────────

/**
 * Lista emails recentes não lidos.
 */
async function listEmails(opts = {}) {
  const auth = getAuthClient();
  if (!auth) return "Google não autenticado. manda 'conecta google' pra começar.";

  const gmail  = google.gmail({ version: "v1", auth });
  const {
    maxResults = 10,
    query      = "is:unread",
    labelIds   = ["INBOX"],
  } = opts;

  const res = await gmail.users.messages.list({
    userId: "me",
    q: query,
    labelIds,
    maxResults,
  });

  const messages = res.data.messages || [];
  if (!messages.length) return "nenhum email encontrado.";

  // Busca detalhes de cada email
  const details = await Promise.all(
    messages.slice(0, maxResults).map(async (m) => {
      const detail = await gmail.users.messages.get({
        userId: "me",
        id:     m.id,
        format: "metadata",
        metadataHeaders: ["From", "Subject", "Date"],
      });

      const headers = detail.data.payload?.headers || [];
      const get     = (name) => headers.find((h) => h.name === name)?.value || "";
      const snippet = detail.data.snippet || "";

      return {
        id:      m.id,
        from:    get("From").replace(/<[^>]+>/, "").trim(),
        subject: get("Subject"),
        date:    get("Date"),
        snippet: snippet.slice(0, 120),
      };
    })
  );

  return details
    .map((e) => `De: ${e.from}\nAssunto: ${e.subject}\n${e.snippet}`)
    .join("\n\n─────────\n\n");
}

/**
 * Lê o conteúdo completo de um email pelo ID.
 */
async function readEmail(messageId) {
  const auth = getAuthClient();
  if (!auth) return "Google não autenticado.";

  const gmail = google.gmail({ version: "v1", auth });

  const res = await gmail.users.messages.get({
    userId: "me",
    id:     messageId,
    format: "full",
  });

  const headers = res.data.payload?.headers || [];
  const get     = (name) => headers.find((h) => h.name === name)?.value || "";

  // Extrai corpo do email
  let body = "";
  const extractBody = (parts) => {
    for (const part of parts || []) {
      if (part.mimeType === "text/plain" && part.body?.data) {
        body += Buffer.from(part.body.data, "base64").toString("utf-8");
      } else if (part.parts) {
        extractBody(part.parts);
      }
    }
  };

  if (res.data.payload?.body?.data) {
    body = Buffer.from(res.data.payload.body.data, "base64").toString("utf-8");
  } else {
    extractBody(res.data.payload?.parts);
  }

  return [
    `De: ${get("From")}`,
    `Para: ${get("To")}`,
    `Assunto: ${get("Subject")}`,
    `Data: ${get("Date")}`,
    `\n${body.slice(0, 3000)}`,
  ].join("\n");
}

/**
 * Envia um email.
 */
async function sendEmail(opts) {
  const auth = getAuthClient();
  if (!auth) return "Google não autenticado.";

  const { to, subject, body, replyToId } = opts;
  const gmail = google.gmail({ version: "v1", auth });

  // Monta o email em formato RFC 2822
  const emailLines = [
    `To: ${to}`,
    `Subject: ${subject}`,
    "Content-Type: text/plain; charset=utf-8",
    "",
    body,
  ];

  const raw = Buffer.from(emailLines.join("\n"))
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");

  const reqBody = { raw };
  if (replyToId) reqBody.threadId = replyToId;

  await gmail.users.messages.send({ userId: "me", requestBody: reqBody });
  return `email enviado para ${to}`;
}

/**
 * Marca email como lido.
 */
async function markAsRead(messageId) {
  const auth = getAuthClient();
  if (!auth) return "Google não autenticado.";

  const gmail = google.gmail({ version: "v1", auth });
  await gmail.users.messages.modify({
    userId:      "me",
    id:          messageId,
    requestBody: { removeLabelIds: ["UNREAD"] },
  });
  return `email ${messageId} marcado como lido`;
}

// ── Google Calendar ───────────────────────────────────────────

/**
 * Lista eventos dos próximos N dias.
 */
async function listEvents(opts = {}) {
  const auth = getAuthClient();
  if (!auth) return "Google não autenticado.";

  const calendar = google.calendar({ version: "v3", auth });
  const { days = 7, maxResults = 20 } = opts;

  const now    = new Date();
  const future = new Date(now.getTime() + days * 24 * 60 * 60 * 1000);

  const res = await calendar.events.list({
    calendarId:   "primary",
    timeMin:      now.toISOString(),
    timeMax:      future.toISOString(),
    maxResults,
    singleEvents: true,
    orderBy:      "startTime",
  });

  const events = res.data.items || [];
  if (!events.length) return `nenhum evento nos próximos ${days} dias.`;

  return events.map((e) => {
    const start = e.start?.dateTime || e.start?.date || "";
    const dt    = start ? new Date(start).toLocaleString("pt-BR", {
      weekday: "short", day: "numeric", month: "short",
      hour: "2-digit", minute: "2-digit",
    }) : "horário indefinido";

    const location = e.location ? ` | ${e.location.slice(0, 40)}` : "";
    return `${dt} — ${e.summary}${location}`;
  }).join("\n");
}

/**
 * Cria um evento no calendário.
 */
async function createEvent(opts) {
  const auth = getAuthClient();
  if (!auth) return "Google não autenticado.";

  const calendar = google.calendar({ version: "v3", auth });
  const {
    title,
    start,       // ISO string ou "2025-03-15T14:00:00"
    end,         // ISO string
    description,
    location,
    attendees,   // ["email@exemplo.com"]
  } = opts;

  const event = {
    summary:     title,
    description: description || "",
    location:    location    || "",
    start: { dateTime: start, timeZone: "America/Sao_Paulo" },
    end:   { dateTime: end,   timeZone: "America/Sao_Paulo" },
  };

  if (attendees?.length) {
    event.attendees = attendees.map((e) => ({ email: e }));
  }

  const res = await calendar.events.insert({
    calendarId:  "primary",
    requestBody: event,
    sendUpdates: attendees?.length ? "all" : "none",
  });

  const link = res.data.htmlLink;
  return `evento criado: "${title}"\n${new Date(start).toLocaleString("pt-BR")}\n${link}`;
}

/**
 * Deleta um evento pelo ID.
 */
async function deleteEvent(eventId) {
  const auth = getAuthClient();
  if (!auth) return "Google não autenticado.";

  const calendar = google.calendar({ version: "v3", auth });
  await calendar.events.delete({ calendarId: "primary", eventId });
  return `evento ${eventId} deletado`;
}

module.exports = {
  // Auth
  isConfigured,
  isAuthenticated,
  getAuthUrl,
  exchangeCode,
  // Gmail
  listEmails,
  readEmail,
  sendEmail,
  markAsRead,
  // Calendar
  listEvents,
  createEvent,
  deleteEvent,
};
