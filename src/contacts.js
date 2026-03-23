// ============================================================
//  Nina — Gerenciamento de Contatos e Perfis
// ============================================================

const Database = require("better-sqlite3");
const { DB_PATH } = require("./config");

const db = new Database(DB_PATH);

db.exec(`
  CREATE TABLE IF NOT EXISTS contacts (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    number     TEXT UNIQUE NOT NULL,
    name       TEXT,
    notes      TEXT,
    created_at DATETIME DEFAULT (datetime('now','localtime')),
    updated_at DATETIME DEFAULT (datetime('now','localtime'))
  );

  CREATE TABLE IF NOT EXISTS pending_identification (
    number   TEXT PRIMARY KEY,
    asked_at DATETIME DEFAULT (datetime('now','localtime'))
  );
`);

function getContact(number) {
  return db.prepare("SELECT * FROM contacts WHERE number = ?").get(number);
}

function saveContact(number, name, notes = null) {
  db.prepare(`
    INSERT INTO contacts (number, name, notes)
    VALUES (?, ?, ?)
    ON CONFLICT(number) DO UPDATE SET
      name       = COALESCE(excluded.name, name),
      notes      = COALESCE(excluded.notes, notes),
      updated_at = datetime('now','localtime')
  `).run(number, name, notes);
}

function updateContactNotes(number, notesJson) {
  db.prepare(`
    UPDATE contacts SET notes = ?, updated_at = datetime('now','localtime')
    WHERE number = ?
  `).run(notesJson, number);
}

function isWaitingIdentification(number) {
  return !!db.prepare("SELECT 1 FROM pending_identification WHERE number = ?").get(number);
}

function markAskedIdentification(number) {
  db.prepare("INSERT OR IGNORE INTO pending_identification (number) VALUES (?)").run(number);
}

function clearPendingIdentification(number) {
  db.prepare("DELETE FROM pending_identification WHERE number = ?").run(number);
}

function getAllContacts() {
  return db.prepare("SELECT * FROM contacts ORDER BY name").all();
}

/**
 * Retorna o perfil de um contato como texto legível para o prompt.
 */
function getContactProfile(contact) {
  if (!contact) return "";
  let profile = `Nome: ${contact.name}`;
  if (contact.notes) {
    try {
      const facts = JSON.parse(contact.notes);
      const lines = Object.entries(facts).map(([k, v]) => `- ${k}: ${v}`).join("\n");
      if (lines) profile += `\nO que sei sobre ${contact.name}:\n${lines}`;
    } catch {
      if (contact.notes) profile += `\nNotas: ${contact.notes}`;
    }
  }
  return profile;
}

module.exports = {
  getContact, saveContact, updateContactNotes,
  isWaitingIdentification, markAskedIdentification, clearPendingIdentification,
  getAllContacts, getContactProfile,
};
