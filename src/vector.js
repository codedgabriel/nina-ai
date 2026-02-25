// ============================================================
//  Nina — Cliente da Memória Vetorial (ChromaDB via HTTP)
// ============================================================

const axios = require("axios");

const MEMORY_URL = "http://127.0.0.1:5001";
const TIMEOUT    = 30_000;

let _available   = null;
let _lastCheck   = 0;

async function isAvailable() {
  const now = Date.now();
  if (_available !== null && (now - _lastCheck) < 60_000) return _available;
  try {
    await axios.get(`${MEMORY_URL}/health`, { timeout: 3_000 });
    if (!_available) console.log("[Vector] Memória vetorial disponível.");
    _available = true;
  } catch {
    if (_available !== false) console.warn("[Vector] Memória vetorial indisponível — usando SQLite.");
    _available = false;
  }
  _lastCheck = now;
  return _available;
}

async function saveToVector(id, text, role, fromNumber, createdAt) {
  if (!(await isAvailable())) return;
  try {
    await axios.post(`${MEMORY_URL}/save`, {
      id: String(id), text, role,
      from_number: fromNumber,
      created_at:  createdAt,
    }, { timeout: TIMEOUT });
  } catch (err) {
    console.error("[Vector] Erro ao salvar:", err.message);
  }
}

async function searchVector(query, fromNumber = null, limit = 5) {
  if (!(await isAvailable())) return [];
  try {
    const res = await axios.post(`${MEMORY_URL}/search`, {
      query, from_number: fromNumber, limit,
    }, { timeout: TIMEOUT });
    return res.data?.results || [];
  } catch (err) {
    console.error("[Vector] Erro na busca:", err.message);
    return [];
  }
}

module.exports = { saveToVector, searchVector };
