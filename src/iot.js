// ============================================================
//  Nina v4 — IoT Hub
//
//  Infraestrutura pra conectar dispositivos físicos.
//  Hoje: registro, descoberta e ping de dispositivos.
//  Futuro: câmera, sensores, relés, automação.
//
//  Como funciona:
//  1. Você registra um dispositivo (câmera, sensor, etc.)
//  2. Nina sabe que ele existe, onde está e o que faz
//  3. Via tools: captura frame, lê sensor, aciona relé, etc.
//
//  Protocolos suportados:
//  - HTTP/HTTPS  → APIs REST de câmeras IP, sensores WiFi
//  - RTSP        → stream de câmeras IP (via ffmpeg)
//  - MQTT        → sensores e atuadores (via mosquitto-clients)
//  - WebSocket   → dispositivos com WS nativo
//  - Shell       → dispositivos acessados por SSH ou serial
//
//  Dispositivos planejados (adicione quando tiver):
//  - camera_ip   → câmera IP com RTSP/HTTP snapshot
//  - sensor_temp → DHT11/DHT22 via Raspberry Pi / ESP8266
//  - relay       → relé WiFi (Sonoff, Shelly, Tasmota)
//  - doorbell    → campainha inteligente
//  - speaker     → caixa de som (TTS local)
// ============================================================

const fs    = require("fs");
const path  = require("path");
const axios = require("axios");
const { runCommand } = require("./shell");
const { logDecision } = require("./decisions");

const IOT_FILE      = "./nina-iot-devices.json";
const IOT_MEDIA_DIR = path.join(require("os").homedir(), "nina-files", "iot");

fs.mkdirSync(IOT_MEDIA_DIR, { recursive: true });

// ── Persistência ──────────────────────────────────────────────

function loadDevices() {
  try {
    if (fs.existsSync(IOT_FILE))
      return JSON.parse(fs.readFileSync(IOT_FILE, "utf-8"));
  } catch {}
  return [];
}

function saveDevices(devices) {
  fs.writeFileSync(IOT_FILE, JSON.stringify(devices, null, 2));
}

let devices = loadDevices();

// ── CRUD de dispositivos ──────────────────────────────────────

/**
 * Registra um dispositivo IoT.
 */
function registerDevice(opts) {
  const {
    name,         // "câmera da sala", "sensor quarto"
    type,         // camera | sensor | relay | speaker | custom
    protocol,     // http | rtsp | mqtt | ws | shell | tasmota | shelly
    host,         // IP ou hostname: "192.168.1.100"
    port,         // porta (opcional)
    path: urlPath, // path da API (opcional): "/snapshot.jpg"
    username,     // auth (opcional)
    password,     // auth (opcional)
    topic,        // tópico MQTT (opcional)
    ssh_host,     // para dispositivos acessados via SSH
    ssh_user,     // usuário SSH
    ssh_cmd,      // comando SSH a executar
    capabilities, // ["snapshot", "stream", "motion", "ptz"]
    notes,        // observações livres
  } = opts;

  const id  = name.toLowerCase().replace(/\s+/g, "_").replace(/[^a-z0-9_]/g, "");
  const idx = devices.findIndex((d) => d.id === id);

  const device = {
    id, name, type, protocol,
    host:         host   || null,
    port:         port   || null,
    path:         urlPath || null,
    username:     username || null,
    password:     password || null,
    topic:        topic  || null,
    ssh_host:     ssh_host || null,
    ssh_user:     ssh_user || "pi",
    ssh_cmd:      ssh_cmd  || null,
    capabilities: capabilities || [],
    notes:        notes || "",
    online:       null,
    lastSeen:     null,
    registeredAt: idx >= 0 ? devices[idx].registeredAt : new Date().toISOString(),
    updatedAt:    new Date().toISOString(),
  };

  if (idx >= 0) {
    devices[idx] = device;
  } else {
    devices.push(device);
  }

  saveDevices(devices);
  logDecision({ category: "tool", action: `dispositivo IoT registrado: ${name} (${type})`, urgency: "info", triggered_by: "user" });
  console.log(`[IoT] Dispositivo registrado: ${name} (${type})`);
  return device;
}

function removeDevice(id) {
  const before = devices.length;
  devices = devices.filter((d) => d.id !== id && d.name !== id);
  saveDevices(devices);
  return devices.length < before;
}

function getDevice(nameOrId) {
  const q = nameOrId.toLowerCase();
  return devices.find((d) =>
    d.id === q || d.name.toLowerCase().includes(q)
  ) || null;
}

function listDevices() {
  if (!devices.length) {
    return "nenhum dispositivo IoT registrado.\nuse iot_register pra adicionar o primeiro.";
  }
  return devices.map((d) => {
    const status   = d.online === true ? "online" : d.online === false ? "offline" : "desconhecido";
    const lastSeen = d.lastSeen ? new Date(d.lastSeen).toLocaleString("pt-BR") : "nunca verificado";
    const caps     = d.capabilities.length ? d.capabilities.join(", ") : "nenhuma definida";
    return [
      `[${d.id}] ${d.name} (${d.type})`,
      `  protocolo: ${d.protocol} | status: ${status} | visto: ${lastSeen}`,
      `  host: ${d.host || d.ssh_host || "—"}${d.port ? ":" + d.port : ""}`,
      `  capacidades: ${caps}`,
      d.notes ? `  notas: ${d.notes}` : "",
    ].filter(Boolean).join("\n");
  }).join("\n\n");
}

// ── Ping / Health check ───────────────────────────────────────

async function pingDevice(nameOrId) {
  const device = getDevice(nameOrId);
  if (!device) return `dispositivo "${nameOrId}" não encontrado`;

  let online = false;
  let detail = "";

  try {
    if (device.protocol === "http" || device.protocol === "https") {
      const url = `${device.protocol}://${device.host}${device.port ? ":" + device.port : ""}${device.path || "/"}`;
      const res = await axios.get(url, {
        timeout: 5000,
        auth: device.username ? { username: device.username, password: device.password } : undefined,
        validateStatus: () => true,
      });
      online = res.status < 500;
      detail = `HTTP ${res.status}`;

    } else if (device.protocol === "shell" || device.protocol === "ssh") {
      const host = device.ssh_host || device.host;
      const user = device.ssh_user || "pi";
      const { output, error } = await runCommand(`ssh -o ConnectTimeout=5 -o StrictHostKeyChecking=no ${user}@${host} "echo ok" 2>&1`);
      online = !error && output?.includes("ok");
      detail = online ? "SSH ok" : (error || "sem resposta");

    } else {
      // Ping ICMP como fallback
      const { output, error } = await runCommand(`ping -c 2 -W 3 "${device.host || device.ssh_host}" 2>&1`);
      online = !error && output?.includes("bytes from");
      detail = online ? "ping ok" : "sem resposta";
    }
  } catch (err) {
    online = false;
    detail = err.message;
  }

  // Atualiza status
  const idx = devices.findIndex((d) => d.id === device.id);
  if (idx >= 0) {
    devices[idx].online  = online;
    devices[idx].lastSeen = online ? new Date().toISOString() : devices[idx].lastSeen;
    saveDevices(devices);
  }

  return `${device.name}: ${online ? "ONLINE" : "OFFLINE"} (${detail})`;
}

async function pingAll() {
  if (!devices.length) return "nenhum dispositivo registrado";
  const results = await Promise.all(devices.map((d) => pingDevice(d.id)));
  return results.join("\n");
}

// ── Câmera: captura frame ─────────────────────────────────────

async function captureSnapshot(nameOrId) {
  const device = getDevice(nameOrId);
  if (!device) return { error: `câmera "${nameOrId}" não encontrada` };
  if (device.type !== "camera") return { error: `${device.name} não é uma câmera` };

  const timestamp = Date.now();
  const filename  = `${device.id}_${timestamp}.jpg`;
  const filepath  = path.join(IOT_MEDIA_DIR, filename);

  try {
    if (device.protocol === "http" || device.protocol === "https") {
      // Câmera HTTP com endpoint de snapshot
      const url = `${device.protocol}://${device.host}${device.port ? ":" + device.port : ""}${device.path || "/snapshot.jpg"}`;
      const res = await axios.get(url, {
        responseType: "arraybuffer",
        timeout:      10000,
        auth: device.username ? { username: device.username, password: device.password } : undefined,
      });
      fs.writeFileSync(filepath, Buffer.from(res.data));
      logDecision({ category: "tool", action: `snapshot capturado: ${device.name}`, urgency: "info" });
      return { filepath, filename, device: device.name };

    } else if (device.protocol === "rtsp") {
      // Câmera RTSP — usa ffmpeg pra capturar um frame
      const rtspUrl = `rtsp://${device.username ? device.username + ":" + device.password + "@" : ""}${device.host}${device.port ? ":" + device.port : ""}${device.path || "/stream"}`;
      const { output, error } = await runCommand(
        `ffmpeg -rtsp_transport tcp -i "${rtspUrl}" -frames:v 1 -y "${filepath}" 2>&1`,
        15000
      );
      if (!fs.existsSync(filepath)) {
        return { error: `ffmpeg falhou: ${error || output}` };
      }
      logDecision({ category: "tool", action: `snapshot RTSP capturado: ${device.name}`, urgency: "info" });
      return { filepath, filename, device: device.name };

    } else if (device.protocol === "shell" || device.protocol === "ssh") {
      // Captura via SSH (ex: Raspberry Pi com câmera)
      const host    = device.ssh_host || device.host;
      const user    = device.ssh_user || "pi";
      const remoteFile = `/tmp/nina_snap_${timestamp}.jpg`;
      const captureCmd = device.ssh_cmd || `raspistill -o ${remoteFile} -t 100 -q 85`;

      await runCommand(`ssh -o ConnectTimeout=10 ${user}@${host} "${captureCmd}" 2>&1`);
      await runCommand(`scp ${user}@${host}:${remoteFile} "${filepath}" 2>&1`);
      await runCommand(`ssh ${user}@${host} "rm ${remoteFile}" 2>&1`);

      if (!fs.existsSync(filepath)) {
        return { error: "falha ao copiar imagem via SCP" };
      }
      return { filepath, filename, device: device.name };
    }

    return { error: `protocolo "${device.protocol}" não suporta snapshot` };

  } catch (err) {
    return { error: err.message };
  }
}

// ── Sensor: lê valor ──────────────────────────────────────────

async function readSensor(nameOrId) {
  const device = getDevice(nameOrId);
  if (!device) return `sensor "${nameOrId}" não encontrado`;
  if (device.type !== "sensor") return `${device.name} não é um sensor`;

  try {
    if (device.protocol === "http" || device.protocol === "https") {
      const url = `${device.protocol}://${device.host}${device.port ? ":" + device.port : ""}${device.path || "/"}`;
      const res = await axios.get(url, {
        timeout: 5000,
        auth: device.username ? { username: device.username, password: device.password } : undefined,
      });
      const data = typeof res.data === "object" ? JSON.stringify(res.data, null, 2) : String(res.data);
      return `${device.name}:\n${data.slice(0, 500)}`;

    } else if (device.protocol === "mqtt") {
      // Lê um valor do broker MQTT
      const broker  = device.host;
      const topic   = device.topic || `sensors/${device.id}`;
      const { output } = await runCommand(
        `mosquitto_sub -h "${broker}" -t "${topic}" -C 1 -W 5 2>&1`,
        8000
      );
      return `${device.name} (${topic}): ${output || "sem resposta"}`;

    } else if (device.protocol === "shell" || device.protocol === "ssh") {
      const host = device.ssh_host || device.host;
      const user = device.ssh_user || "pi";
      const cmd  = device.ssh_cmd || "python3 -c \"import Adafruit_DHT; h,t = Adafruit_DHT.read(11,4); print(f'temp={t:.1f}C umid={h:.1f}%')\"";
      const { output } = await runCommand(`ssh -o ConnectTimeout=10 ${user}@${host} "${cmd}" 2>&1`, 15000);
      return `${device.name}: ${output}`;
    }

    return `protocolo "${device.protocol}" não suportado para leitura de sensor`;

  } catch (err) {
    return `erro ao ler ${device.name}: ${err.message}`;
  }
}

// ── Relé / Atuador: liga/desliga ──────────────────────────────

async function controlRelay(nameOrId, action) {
  const device = getDevice(nameOrId);
  if (!device) return `dispositivo "${nameOrId}" não encontrado`;

  const actionLower = action.toLowerCase();
  const state       = /\b(on|liga|ligar|ativar|acend)\b/.test(actionLower) ? "on"
    : /\b(off|desliga|desligar|apag)\b/.test(actionLower) ? "off"
    : /\b(toggle|altern)\b/.test(actionLower) ? "toggle" : null;

  if (!state) return `ação inválida: "${action}". Use: on, off ou toggle`;

  try {
    if (device.protocol === "tasmota") {
      // Tasmota (Sonoff com firmware Tasmota)
      const cmd   = state === "toggle" ? "TOGGLE" : state === "on" ? "ON" : "OFF";
      const url   = `http://${device.host}/cm?cmnd=Power%20${cmd}`;
      const res   = await axios.get(url, { timeout: 5000 });
      const power = res.data?.POWER || res.data;
      logDecision({ category: "tool", action: `relé ${state}: ${device.name}`, urgency: "info", triggered_by: "user" });
      return `${device.name}: ${power}`;

    } else if (device.protocol === "shelly") {
      // Shelly
      const val = state === "toggle" ? null : state === "on" ? 1 : 0;
      const url = val === null
        ? `http://${device.host}/relay/0?go=toggle`
        : `http://${device.host}/relay/0?turn=${state}`;
      const res = await axios.get(url, { timeout: 5000 });
      logDecision({ category: "tool", action: `relé ${state}: ${device.name}`, urgency: "info", triggered_by: "user" });
      return `${device.name}: ${JSON.stringify(res.data)}`;

    } else if (device.protocol === "http") {
      // API HTTP genérica
      const url = `${device.protocol}://${device.host}${device.port ? ":" + device.port : ""}${device.path || "/relay"}/${state}`;
      const res = await axios.post(url, { state }, { timeout: 5000 });
      logDecision({ category: "tool", action: `atuador ${state}: ${device.name}`, urgency: "info", triggered_by: "user" });
      return `${device.name}: ${JSON.stringify(res.data)}`;

    } else if (device.protocol === "mqtt") {
      const topic = device.topic || `cmnd/${device.id}/POWER`;
      const payload = state.toUpperCase();
      const { error } = await runCommand(
        `mosquitto_pub -h "${device.host}" -t "${topic}" -m "${payload}" 2>&1`,
        5000
      );
      if (error) return `erro MQTT: ${error}`;
      logDecision({ category: "tool", action: `MQTT ${state}: ${device.name}`, urgency: "info", triggered_by: "user" });
      return `${device.name}: comando ${payload} enviado via MQTT`;

    } else if (device.protocol === "shell" || device.protocol === "ssh") {
      const host = device.ssh_host || device.host;
      const user = device.ssh_user || "pi";
      const cmd  = device.ssh_cmd?.replace("{state}", state) || `gpio write 0 ${state === "on" ? "1" : "0"}`;
      const { output } = await runCommand(`ssh -o ConnectTimeout=10 ${user}@${host} "${cmd}" 2>&1`, 10000);
      return `${device.name}: ${output || "executado"}`;
    }

    return `protocolo "${device.protocol}" não suportado para controle`;

  } catch (err) {
    return `erro ao controlar ${device.name}: ${err.message}`;
  }
}

// ── Monitor IoT: verifica dispositivos críticos ───────────────

async function checkCriticalDevices() {
  const critical = devices.filter((d) =>
    d.capabilities?.includes("critical") || d.type === "alarm"
  );
  if (!critical.length) return;

  for (const device of critical) {
    await pingDevice(device.id);
    if (!device.online) {
      const { enqueue } = require("./notifications");
      await enqueue(
        `dispositivo crítico offline: ${device.name}`,
        { urgency: "importante", source: "iot", skipAI: true }
      );
    }
  }
}

module.exports = {
  registerDevice,
  removeDevice,
  getDevice,
  listDevices,
  pingDevice,
  pingAll,
  captureSnapshot,
  readSensor,
  controlRelay,
  checkCriticalDevices,
};
