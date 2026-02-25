// ============================================================
//  Nina — Memória Persistente (SQLite)
// ============================================================

const Database = require("better-sqlite3");
const { DB_PATH } = require("./config");

const db = new Database(DB_PATH);

db.exec(`
  CREATE TABLE IF NOT EXISTS messages (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    role        TEXT NOT NULL,
    content     TEXT NOT NULL,
    from_number TEXT NOT NULL DEFAULT 'unknown',
    created_at  DATETIME DEFAULT (datetime('now','localtime'))
  );

  CREATE TABLE IF NOT EXISTS reminders (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    text        TEXT NOT NULL,
    remind_at   TEXT NOT NULL,
    remind_date TEXT,
    sent        INTEGER DEFAULT 0,
    created_at  DATETIME DEFAULT (datetime('now','localtime'))
  );

  CREATE TABLE IF NOT EXISTS facts (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    key        TEXT UNIQUE NOT NULL,
    value      TEXT NOT NULL,
    updated_at DATETIME DEFAULT (datetime('now','localtime'))
  );

  CREATE TABLE IF NOT EXISTS notes (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    title      TEXT NOT NULL,
    content    TEXT NOT NULL,
    filename   TEXT,
    created_at DATETIME DEFAULT (datetime('now','localtime'))
  );

  CREATE VIRTUAL TABLE IF NOT EXISTS messages_fts
    USING fts5(role, content, from_number, content=messages, content_rowid=id);

  CREATE TRIGGER IF NOT EXISTS messages_fts_insert
    AFTER INSERT ON messages BEGIN
      INSERT INTO messages_fts(rowid, role, content, from_number)
      VALUES (new.id, new.role, new.content, new.from_number);
    END;
`);

// ── Mensagens ────────────────────────────────────────────────

function saveMessage(role, content, fromNumber = "unknown") {
  db.prepare(
    "INSERT INTO messages (role, content, from_number) VALUES (?, ?, ?)"
  ).run(role, content, fromNumber);
}

function getRecentMessages(fromNumber, limit = 5) {
  return db
    .prepare("SELECT role, content FROM messages WHERE from_number = ? ORDER BY id DESC LIMIT ?")
    .all(fromNumber, limit)
    .reverse();
}

// Busca mensagens de QUALQUER contato por palavra-chave
function searchMessages(query, fromNumber = null, limit = 5) {
  try {
    if (fromNumber) {
      return db.prepare(`
        SELECT m.role, m.content, m.created_at, m.from_number
        FROM messages_fts f
        JOIN messages m ON m.id = f.rowid
        WHERE messages_fts MATCH ? AND m.from_number = ?
        ORDER BY rank LIMIT ?
      `).all(query, fromNumber, limit);
    }
    return db.prepare(`
      SELECT m.role, m.content, m.created_at, m.from_number
      FROM messages_fts f
      JOIN messages m ON m.id = f.rowid
      WHERE messages_fts MATCH ?
      ORDER BY rank LIMIT ?
    `).all(query, limit);
  } catch {
    return [];
  }
}

// Busca as últimas N mensagens de um contato específico (por nome/número)
function getMessagesByNumber(fromNumber, limit = 20) {
  return db.prepare(
    "SELECT role, content, created_at FROM messages WHERE from_number = ? ORDER BY id DESC LIMIT ?"
  ).all(fromNumber, limit).reverse();
}

function getLastMessageId() {
  return db.prepare("SELECT MAX(id) as id FROM messages").get()?.id || 0;
}

// ── Lembretes ────────────────────────────────────────────────

function saveReminder(text, remindAt, remindDate = null) {
  db.prepare(
    "INSERT INTO reminders (text, remind_at, remind_date) VALUES (?, ?, ?)"
  ).run(text, remindAt, remindDate);
}

function getPendingReminders() {
  return db.prepare("SELECT * FROM reminders WHERE sent = 0").all();
}

function markReminderSent(id) {
  db.prepare("UPDATE reminders SET sent = 1 WHERE id = ?").run(id);
}

// ── Fatos ────────────────────────────────────────────────────

function saveFact(key, value) {
  db.prepare(`
    INSERT INTO facts (key, value) VALUES (?, ?)
    ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=datetime('now','localtime')
  `).run(key, value);
}

function getAllFacts() {
  return db.prepare("SELECT key, value FROM facts").all();
}

// ── Notas ────────────────────────────────────────────────────

function saveNote(title, content, filename = null) {
  db.prepare("INSERT INTO notes (title, content, filename) VALUES (?, ?, ?)").run(title, content, filename);
}

function searchNotes(query) {
  return db.prepare(
    "SELECT * FROM notes WHERE title LIKE ? OR content LIKE ? ORDER BY id DESC LIMIT 5"
  ).all(`%${query}%`, `%${query}%`);
}

function getRecentNotes(limit = 5) {
  return db.prepare("SELECT * FROM notes ORDER BY id DESC LIMIT ?").all(limit);
}

module.exports = {
  saveMessage, getRecentMessages, searchMessages, getMessagesByNumber, getLastMessageId,
  saveReminder, getPendingReminders, markReminderSent,
  saveFact, getAllFacts,
  saveNote, searchNotes, getRecentNotes,
};
