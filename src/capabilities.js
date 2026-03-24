// ============================================================
//  Nina v4 — Capacidades Dinâmicas
//
//  Registra o que a Nina pode fazer, quais APIs tem acesso,
//  qual hardware está rodando e como se auto-configura
//  quando você diz que algo mudou.
//
//  Exemplos de uso pelo WhatsApp:
//  "nina, pode usar a API da Binance agora" → registra + aprende skill
//  "nina, troquei o processador" → ajusta thresholds automaticamente
//  "nina, agora tem 32GB de RAM" → recalibra limites de alerta
//  "nina, pode gastar até $10/dia de API" → atualiza budget
//  "nina, o servidor agora tem SSD NVMe" → ajusta timeouts
//
//  Persiste em nina-capabilities.json
// ============================================================

const fs    = require("fs");
const path  = require("path");
const axios = require("axios");
const { runCommand }  = require("./shell");
const { logDecision } = require("./decisions");
const {
  DEEPSEEK_API_KEY, DEEPSEEK_BASE_URL, DEEPSEEK_MODEL,
} = require("./config");

const CAPS_FILE = "./nina-capabilities.json";

// ── Schema padrão ─────────────────────────────────────────────

const DEFAULT_CAPS = {
  // Hardware conhecido
  hardware: {
    cpu:       null,   // "Intel i5-8250U", "Raspberry Pi 4"
    ram_gb:    null,   // 8
    disk_type: null,   // "SSD", "HDD", "NVMe"
    disk_gb:   null,   // 256
    gpu:       null,   // "NVIDIA RTX 3060" ou null
    notes:     [],     // ["trocou processador em jan/2025"]
  },

  // APIs e serviços disponíveis
  apis: {
    // { name, key_env, description, added_at, skills_created }
  },

  // Limites ajustados ao hardware
  tuning: {
    max_tool_rounds:      8,
    shell_timeout_sec:    60,
    script_timeout_sec:   300,
    browser_max_steps:    15,
    parallel_tools:       3,
    monitor_cpu_alert:    80,
    monitor_ram_alert:    85,
    monitor_disk_alert:   88,
  },

  // Integrações ativas
  integrations: {
    google:    false,
    telegram:  false,
    binance:   false,
    // adiciona conforme for liberando
  },

  // Histórico de upgrades
  upgrades: [],  // [{date, description, type: hardware|api|config}]

  updatedAt: null,
};

// ── Persistência ──────────────────────────────────────────────

function loadCaps() {
  try {
    if (fs.existsSync(CAPS_FILE)) {
      const saved = JSON.parse(fs.readFileSync(CAPS_FILE, "utf-8"));
      // Merge com defaults pra não perder campos novos
      return {
        ...DEFAULT_CAPS,
        ...saved,
        hardware:     { ...DEFAULT_CAPS.hardware,     ...saved.hardware },
        apis:         { ...DEFAULT_CAPS.apis,         ...saved.apis },
        tuning:       { ...DEFAULT_CAPS.tuning,       ...saved.tuning },
        integrations: { ...DEFAULT_CAPS.integrations, ...saved.integrations },
      };
    }
  } catch {}
  return { ...DEFAULT_CAPS };
}

function saveCaps(caps) {
  caps.updatedAt = new Date().toISOString();
  fs.writeFileSync(CAPS_FILE, JSON.stringify(caps, null, 2));
}

let caps = loadCaps();

// ── Hardware ──────────────────────────────────────────────────

/**
 * Detecta hardware automaticamente via shell.
 */
async function detectHardware() {
  const results = {};

  const [cpuOut, ramOut, diskOut, gpuOut] = await Promise.all([
    runCommand("lscpu | grep 'Model name' | cut -d: -f2 | xargs").then((r) => r.output),
    runCommand("free -g | awk '/^Mem:/{print $2}'").then((r) => r.output),
    runCommand("lsblk -d -o name,rota,size | grep -v NAME | head -3").then((r) => r.output),
    runCommand("nvidia-smi --query-gpu=name --format=csv,noheader 2>/dev/null || echo ''").then((r) => r.output),
  ]);

  if (cpuOut && cpuOut !== "(sem output)") results.cpu = cpuOut.trim();
  if (ramOut && !isNaN(parseInt(ramOut))) results.ram_gb = parseInt(ramOut);
  if (gpuOut && gpuOut.trim()) results.gpu = gpuOut.trim();

  // Detecta tipo de disco
  if (diskOut) {
    const hasRotating = diskOut.includes(" 1 "); // ROTA=1 = HDD
    results.disk_type = hasRotating ? "HDD" : "SSD/NVMe";
  }

  return results;
}

/**
 * Atualiza hardware e recalibra thresholds automaticamente.
 */
async function updateHardware(description, detected = null) {
  const hw = detected || await detectHardware();

  // Merge com o que já sabemos
  Object.assign(caps.hardware, hw);
  caps.hardware.notes.push(`${new Date().toLocaleDateString("pt-BR")}: ${description}`);

  // Recalibra thresholds baseado no hardware
  const ram = caps.hardware.ram_gb;
  const isDiskFast = caps.hardware.disk_type?.includes("SSD") || caps.hardware.disk_type?.includes("NVMe");

  if (ram) {
    // Mais RAM → pode ter mais processos em paralelo
    if (ram >= 32) {
      caps.tuning.max_tool_rounds    = 12;
      caps.tuning.parallel_tools     = 6;
      caps.tuning.monitor_ram_alert  = 90; // threshold mais alto
    } else if (ram >= 16) {
      caps.tuning.max_tool_rounds    = 10;
      caps.tuning.parallel_tools     = 4;
      caps.tuning.monitor_ram_alert  = 88;
    } else if (ram >= 8) {
      caps.tuning.max_tool_rounds    = 8;
      caps.tuning.parallel_tools     = 3;
      caps.tuning.monitor_ram_alert  = 85;
    } else {
      // Pouca RAM → mais conservador
      caps.tuning.max_tool_rounds    = 6;
      caps.tuning.parallel_tools     = 2;
      caps.tuning.monitor_ram_alert  = 75;
    }
  }

  if (isDiskFast) {
    // SSD/NVMe → scripts mais rápidos, timeouts menores
    caps.tuning.script_timeout_sec = 180;
    caps.tuning.shell_timeout_sec  = 30;
  }

  caps.upgrades.push({
    date:        new Date().toISOString(),
    description,
    type:        "hardware",
    hw_snapshot: { ...hw },
  });

  saveCaps(caps);
  applyTuning();

  logDecision({
    category:    "tool",
    action:      `hardware atualizado: ${description}`,
    result:      JSON.stringify(hw),
    urgency:     "info",
    triggered_by: "user",
  });

  return { hardware: caps.hardware, tuning: caps.tuning };
}

/**
 * Aplica os tunings no config em runtime (sem reiniciar).
 */
function applyTuning() {
  try {
    const config = require("./config");
    if (caps.tuning.max_tool_rounds)   config.MAX_TOOL_ROUNDS   = caps.tuning.max_tool_rounds;
    if (caps.tuning.shell_timeout_sec) config.SHELL_TIMEOUT     = caps.tuning.shell_timeout_sec * 1000;
    if (caps.tuning.script_timeout_sec) config.SCRIPT_TIMEOUT   = caps.tuning.script_timeout_sec * 1000;
    console.log("[Caps] Tuning aplicado:", caps.tuning);
  } catch {}
}

// ── APIs ──────────────────────────────────────────────────────

/**
 * Registra uma nova API disponível e cria skills automaticamente.
 */
async function registerAPI(opts) {
  const {
    name,           // "binance", "openweather", "twilio"
    description,    // "exchange de cripto"
    key_env,        // variável de ambiente da key: "BINANCE_API_KEY"
    base_url,       // URL base da API
    docs_url,       // documentação (opcional)
    auto_learn,     // se true, pede ao DeepSeek pra criar skills automaticamente
  } = opts;

  const id = name.toLowerCase().replace(/\s+/g, "_");

  caps.apis[id] = {
    name,
    description,
    key_env:     key_env || null,
    base_url:    base_url || null,
    docs_url:    docs_url || null,
    added_at:    new Date().toISOString(),
    skills_created: [],
  };

  caps.upgrades.push({
    date:        new Date().toISOString(),
    description: `API registrada: ${name} — ${description}`,
    type:        "api",
  });

  saveCaps(caps);

  logDecision({
    category:    "tool",
    action:      `API registrada: ${name}`,
    urgency:     "info",
    triggered_by: "user",
  });

  let result = `API "${name}" registrada.`;

  // Cria skills automaticamente se pedido
  if (auto_learn && DEEPSEEK_API_KEY) {
    result += "\n\ngerando skills automaticamente...";
    const skills = await generateAPISkills(id, name, description, base_url, docs_url);
    if (skills.length > 0) {
      caps.apis[id].skills_created = skills;
      saveCaps(caps);
      result += `\n${skills.length} skill(s) criada(s): ${skills.join(", ")}`;
    }
  }

  return result;
}

/**
 * Pede ao DeepSeek pra criar skills pra uma API nova.
 */
async function generateAPISkills(apiId, apiName, description, baseUrl, docsUrl) {
  if (!DEEPSEEK_API_KEY) return [];

  try {
    const res = await axios.post(
      `${DEEPSEEK_BASE_URL}/chat/completions`,
      {
        model: DEEPSEEK_MODEL,
        messages: [
          {
            role: "system",
            content: `Você cria skills Python pra APIs. Responda SOMENTE com JSON:
[{"name": "skill_name", "description": "quando usar", "code": "código python completo", "args_schema": "como passar args"}]
Máximo 3 skills mais úteis. Use requests. A API key vem de variável de ambiente.`,
          },
          {
            role: "user",
            content: `API: ${apiName}
Descrição: ${description}
Base URL: ${baseUrl || "desconhecida"}
Docs: ${docsUrl || "não fornecida"}

Crie as skills Python mais úteis pra essa API. Use os.environ.get("${apiId.toUpperCase()}_API_KEY") pra autenticação.`,
          },
        ],
        temperature: 0.3,
        max_tokens:  3000,
      },
      { headers: { Authorization: `Bearer ${DEEPSEEK_API_KEY}` }, timeout: 60_000 }
    );

    const raw = res.data?.choices?.[0]?.message?.content?.trim();
    const m   = raw?.match(/\[[\s\S]*\]/);
    if (!m) return [];

    const skillDefs = JSON.parse(m[0]);
    const { registerSkill } = require("./skills");
    const created = [];

    for (const def of skillDefs.slice(0, 3)) {
      try {
        registerSkill({
          name:        `${apiId}_${def.name}`,
          description: def.description,
          lang:        "python",
          args_schema: def.args_schema || "",
          code:        def.code,
          dependencies: ["requests"],
        });
        created.push(`${apiId}_${def.name}`);
      } catch {}
    }

    return created;
  } catch {
    return [];
  }
}

// ── Integrations ──────────────────────────────────────────────

function setIntegration(name, active) {
  caps.integrations[name] = active;
  saveCaps(caps);
  logDecision({ category: "tool", action: `integração ${active ? "ativada" : "desativada"}: ${name}`, urgency: "info", triggered_by: "user" });
}

// ── Status & Reports ──────────────────────────────────────────

function getCapabilitiesStatus() {
  const hw  = caps.hardware;
  const api = Object.entries(caps.apis);
  const int = Object.entries(caps.integrations).filter(([, v]) => v);

  const lines = ["## Capacidades da Nina\n"];

  // Hardware
  lines.push("### Hardware");
  if (hw.cpu)       lines.push(`  CPU:   ${hw.cpu}`);
  if (hw.ram_gb)    lines.push(`  RAM:   ${hw.ram_gb}GB`);
  if (hw.disk_type) lines.push(`  Disco: ${hw.disk_type}${hw.disk_gb ? " " + hw.disk_gb + "GB" : ""}`);
  if (hw.gpu)       lines.push(`  GPU:   ${hw.gpu}`);
  if (!hw.cpu && !hw.ram_gb) lines.push("  (não detectado ainda — diga 'nina, detecta meu hardware')");

  // Tuning atual
  lines.push("\n### Configuração atual");
  lines.push(`  max tool rounds:   ${caps.tuning.max_tool_rounds}`);
  lines.push(`  parallel tools:    ${caps.tuning.parallel_tools}`);
  lines.push(`  shell timeout:     ${caps.tuning.shell_timeout_sec}s`);
  lines.push(`  alerta RAM:        ${caps.tuning.monitor_ram_alert}%`);
  lines.push(`  alerta CPU:        ${caps.tuning.monitor_cpu_alert}%`);

  // APIs
  lines.push(`\n### APIs registradas (${api.length})`);
  if (api.length === 0) {
    lines.push("  nenhuma além das built-in");
  } else {
    for (const [id, a] of api) {
      const skills = a.skills_created?.length ? ` | ${a.skills_created.length} skill(s)` : "";
      lines.push(`  ${id}: ${a.description}${skills}`);
    }
  }

  // Integrações ativas
  lines.push(`\n### Integrações ativas`);
  if (int.length === 0) {
    lines.push("  nenhuma configurada");
  } else {
    int.forEach(([k]) => lines.push(`  ${k}`));
  }

  // Histórico recente
  const recent = caps.upgrades.slice(-5).reverse();
  if (recent.length > 0) {
    lines.push("\n### Upgrades recentes");
    recent.forEach((u) => {
      const date = new Date(u.date).toLocaleDateString("pt-BR");
      lines.push(`  ${date}: ${u.description}`);
    });
  }

  return lines.join("\n");
}

function getTuning() {
  return caps.tuning;
}

function updateTuning(key, value) {
  if (!(key in caps.tuning)) return `configuração "${key}" não existe`;
  caps.tuning[key] = value;
  saveCaps(caps);
  applyTuning();
  logDecision({ category: "tool", action: `tuning atualizado: ${key}=${value}`, urgency: "info", triggered_by: "user" });
  return `${key} atualizado para ${value}`;
}

// ── Bloco de contexto pra injetar no prompt ───────────────────

function buildCapabilitiesBlock() {
  const hw  = caps.hardware;
  const api = Object.entries(caps.apis);

  const lines = [];

  if (hw.cpu || hw.ram_gb) {
    const hwParts = [
      hw.cpu ? `CPU: ${hw.cpu}` : "",
      hw.ram_gb ? `RAM: ${hw.ram_gb}GB` : "",
      hw.disk_type ? `Disco: ${hw.disk_type}` : "",
      hw.gpu ? `GPU: ${hw.gpu}` : "",
    ].filter(Boolean);
    lines.push(`Hardware: ${hwParts.join(" | ")}`);
  }

  if (api.length > 0) {
    lines.push(`APIs disponíveis: ${api.map(([id, a]) => `${id} (${a.description})`).join(", ")}`);
  }

  if (caps.upgrades.length > 0) {
    const last = caps.upgrades[caps.upgrades.length - 1];
    lines.push(`Último upgrade: ${last.description}`);
  }

  return lines.length > 0 ? `\n\n## Capacidades do sistema\n${lines.join("\n")}` : "";
}

// ── Init ──────────────────────────────────────────────────────

function initCapabilities() {
  applyTuning();
  console.log(`[Caps] ${Object.keys(caps.apis).length} API(s) registrada(s) | hardware: ${caps.hardware.cpu || "não detectado"}`);
}

module.exports = {
  initCapabilities,
  detectHardware,
  updateHardware,
  registerAPI,
  setIntegration,
  getCapabilitiesStatus,
  updateTuning,
  getTuning,
  buildCapabilitiesBlock,
};
