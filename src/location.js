// ============================================================
//  Nina v4 — Contexto de Localização
//
//  A Nina sabe onde você está e usa isso pra:
//  - Clima local sem precisar dizer a cidade
//  - "Restaurantes perto de mim"
//  - "Quanto tempo até o compromisso" (com rota)
//  - Notificações com contexto geográfico
//  - Alertas de trânsito antes de compromissos
//
//  Como funciona:
//  1. Você manda sua localização pelo WhatsApp (botão de anexo → Localização)
//     → Nina salva automaticamente como "localização atual"
//  2. Você digita "estou em [cidade]" ou "minha cidade é [X]"
//     → Nina geocodifica e salva
//  3. A localização é injetada automaticamente no system prompt
//  4. Você pode ter localizações salvas com nome (casa, trabalho, etc.)
//
//  Persiste em nina-location.json entre reinicializações.
// ============================================================

const fs    = require("fs");
const path  = require("path");
const axios = require("axios");

const LOCATION_FILE = "./nina-location.json";

// ── Estado ────────────────────────────────────────────────────

function loadLocation() {
  try {
    if (fs.existsSync(LOCATION_FILE))
      return JSON.parse(fs.readFileSync(LOCATION_FILE, "utf-8"));
  } catch {}
  return {
    current:   null,   // { lat, lon, name, updatedAt }
    saved:     {},     // { "casa": { lat, lon, name }, ... }
    timezone:  "America/Sao_Paulo",
    city:      null,   // nome da cidade atual
  };
}

function saveLocation(state) {
  fs.writeFileSync(LOCATION_FILE, JSON.stringify(state, null, 2));
}

let locState = loadLocation();

// ── Geocodificação ────────────────────────────────────────────

async function geocode(query) {
  try {
    const res = await axios.get("https://nominatim.openstreetmap.org/search", {
      params: { q: query, format: "json", limit: 1, addressdetails: 1 },
      headers: { "User-Agent": "Nina-AI/1.0" },
      timeout: 10_000,
    });
    const r = res.data?.[0];
    if (!r) return null;

    const addr = r.address || {};
    const name = addr.city || addr.town || addr.village || addr.municipality || query;
    const state = addr.state || "";
    const country = addr.country_code?.toUpperCase() || "";

    return {
      lat:     parseFloat(r.lat),
      lon:     parseFloat(r.lon),
      name:    `${name}${state ? ", " + state : ""}${country ? " (" + country + ")" : ""}`,
      city:    name,
      state,
      country,
    };
  } catch {
    return null;
  }
}

async function reverseGeocode(lat, lon) {
  try {
    const res = await axios.get("https://nominatim.openstreetmap.org/reverse", {
      params: { lat, lon, format: "json", addressdetails: 1 },
      headers: { "User-Agent": "Nina-AI/1.0" },
      timeout: 10_000,
    });
    const addr = res.data?.address || {};
    const city = addr.city || addr.town || addr.village || addr.municipality || "desconhecida";
    const state = addr.state || "";
    return {
      lat, lon,
      name: `${city}${state ? ", " + state : ""}`,
      city,
      state,
      country: addr.country_code?.toUpperCase() || "",
    };
  } catch {
    return { lat, lon, name: `${lat.toFixed(4)}, ${lon.toFixed(4)}`, city: null };
  }
}

// ── API pública ───────────────────────────────────────────────

/**
 * Atualiza localização atual a partir de coordenadas (WhatsApp location share).
 */
async function updateLocationFromCoords(lat, lon) {
  const geo = await reverseGeocode(lat, lon);
  locState.current = { ...geo, updatedAt: new Date().toISOString() };
  locState.city    = geo.city;
  saveLocation(locState);
  console.log(`[Location] Atualizada: ${geo.name}`);
  return geo;
}

/**
 * Atualiza localização a partir de texto ("estou em São Luís").
 */
async function updateLocationFromText(text) {
  const geo = await geocode(text);
  if (!geo) return null;
  locState.current = { ...geo, updatedAt: new Date().toISOString() };
  locState.city    = geo.city;
  saveLocation(locState);
  console.log(`[Location] Atualizada via texto: ${geo.name}`);
  return geo;
}

/**
 * Salva uma localização com nome ("casa", "trabalho", etc.).
 */
async function saveNamedLocation(label, textOrCoords) {
  let geo;
  if (typeof textOrCoords === "string") {
    geo = await geocode(textOrCoords);
  } else {
    geo = await reverseGeocode(textOrCoords.lat, textOrCoords.lon);
  }
  if (!geo) return null;

  locState.saved[label.toLowerCase()] = { ...geo, savedAt: new Date().toISOString() };
  saveLocation(locState);
  return geo;
}

/**
 * Retorna a localização atual ou null.
 */
function getCurrentLocation() {
  return locState.current || null;
}

/**
 * Retorna localização salva por nome.
 */
function getNamedLocation(label) {
  return locState.saved[label.toLowerCase()] || null;
}

/**
 * Distância em km entre dois pontos (fórmula de Haversine).
 */
function distanceKm(lat1, lon1, lat2, lon2) {
  const R    = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a    = Math.sin(dLat/2)**2 +
               Math.cos(lat1 * Math.PI/180) * Math.cos(lat2 * Math.PI/180) *
               Math.sin(dLon/2)**2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
}

/**
 * Tempo estimado de deslocamento (estimativa simples sem API de mapas).
 * Para rotas reais, usar Google Maps API.
 */
function estimateTravelTime(fromLoc, toLoc, mode = "driving") {
  const km = distanceKm(fromLoc.lat, fromLoc.lon, toLoc.lat, toLoc.lon);
  const speeds = { driving: 50, walking: 5, cycling: 15, transit: 30 };
  const speed  = speeds[mode] || 50;
  const hours  = km / speed;
  const mins   = Math.round(hours * 60);
  return { km: km.toFixed(1), minutes: mins };
}

/**
 * Bloco de localização para injetar no system prompt.
 */
function buildLocationBlock() {
  const loc = locState.current;
  if (!loc) return "";

  const updatedAt = loc.updatedAt
    ? new Date(loc.updatedAt).toLocaleString("pt-BR", { day:"2-digit", month:"2-digit", hour:"2-digit", minute:"2-digit" })
    : "desconhecido";

  const lines = [`\n\n## Localização atual de DG\n${loc.name} (atualizada ${updatedAt})`];

  if (Object.keys(locState.saved).length > 0) {
    lines.push("Localizações salvas: " +
      Object.entries(locState.saved).map(([k, v]) => `${k} (${v.name})`).join(", "));
  }

  return lines.join("\n");
}

/**
 * Status completo da localização.
 */
function getLocationStatus() {
  const loc = locState.current;
  if (!loc) return "nenhuma localização definida. manda sua localização pelo WhatsApp ou diz 'estou em [cidade]'";

  const lines = [`localização atual: ${loc.name}`];
  if (loc.updatedAt) lines.push(`atualizada: ${new Date(loc.updatedAt).toLocaleString("pt-BR")}`);

  const saved = Object.entries(locState.saved);
  if (saved.length > 0) {
    lines.push("\nlocalizações salvas:");
    saved.forEach(([k, v]) => lines.push(`  ${k}: ${v.name}`));
  }

  return lines.join("\n");
}

module.exports = {
  updateLocationFromCoords,
  updateLocationFromText,
  saveNamedLocation,
  getCurrentLocation,
  getNamedLocation,
  distanceKm,
  estimateTravelTime,
  buildLocationBlock,
  getLocationStatus,
  geocode,
};
