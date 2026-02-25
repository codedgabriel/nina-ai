// ============================================================
//  Nina — Acesso ao Servidor: Notas, Arquivos e Fotos
// ============================================================

const fs   = require("fs");
const path = require("path");
const { NOTES_DIR, PHOTOS_DIR } = require("./config");
const { saveNote, searchNotes, getRecentNotes } = require("./db");

// Garante que as pastas existem
function ensureDirs() {
  [NOTES_DIR, PHOTOS_DIR].forEach((dir) => {
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
      console.log(`[Files] Pasta criada: ${dir}`);
    }
  });
}
ensureDirs();

// ── Notas de texto ───────────────────────────────────────────

/**
 * Salva uma nota em disco e no banco de dados.
 * Retorna o caminho do arquivo criado.
 */
function saveTextNote(title, content) {
  const safe     = title.replace(/[^a-zA-Z0-9À-ú\s]/g, "").trim().replace(/\s+/g, "_");
  const timestamp = new Date().toISOString().slice(0, 10);
  const filename  = `${timestamp}_${safe}.txt`;
  const filepath  = path.join(NOTES_DIR, filename);

  const fileContent = `${title}\n${"=".repeat(title.length)}\n${content}\n\nSalvo em: ${new Date().toLocaleString("pt-BR")}`;
  fs.writeFileSync(filepath, fileContent, "utf-8");

  saveNote(title, content, filename);
  console.log(`[Files] Nota salva: ${filepath}`);
  return filepath;
}

/**
 * Busca notas por palavra-chave.
 */
function findNotes(query) {
  return searchNotes(query);
}

/**
 * Retorna notas recentes.
 */
function listRecentNotes() {
  return getRecentNotes(5);
}

// ── Fotos ────────────────────────────────────────────────────

/**
 * Salva uma foto (buffer ou base64) em disco.
 * Retorna o caminho salvo.
 */
function savePhoto(dataBuffer, originalName = null) {
  const timestamp = Date.now();
  const ext       = originalName ? path.extname(originalName) : ".jpg";
  const filename  = `${timestamp}${ext}`;
  const filepath  = path.join(PHOTOS_DIR, filename);

  fs.writeFileSync(filepath, dataBuffer);
  console.log(`[Files] Foto salva: ${filepath}`);
  return filepath;
}

// ── Criar arquivo genérico (código, etc.) ───────────────────

/**
 * Salva qualquer conteúdo como arquivo com extensão definida.
 */
function saveFile(filename, content) {
  const filepath = path.join(NOTES_DIR, filename);
  fs.writeFileSync(filepath, content, "utf-8");
  console.log(`[Files] Arquivo salvo: ${filepath}`);
  return filepath;
}

module.exports = { saveTextNote, findNotes, listRecentNotes, savePhoto, saveFile };
