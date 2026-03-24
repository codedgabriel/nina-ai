// ============================================================
//  Nina v4 — Monitor Proativo
//
//  Age em background sem ser chamada:
//  - Vigia CPU, RAM, disco a cada 5min
//  - Reinicia serviços caídos automaticamente
//  - Otimiza o servidor às 3h (limpa lixo, verifica updates)
//  - Manda resumo do dia às 8h
//  - Gera resumo comprimido das conversas do dia à meia-noite
//    (base da memória de longo prazo)
// ============================================================

const cron  = require("node-cron");
const os    = require("os");
const fs    = require("fs");
const path  = require("path");
const axios = require("axios");

const { runCommand }          = require("./shell");
const { getBudgetStatus, getBudgetConfig, isBlocked } = require("./budget");
const { logDecision } = require("./decisions");
let _smartNotify = null;
// Integra com o sistema de notificações inteligentes quando disponível
function setSmartNotify(fn) { _smartNotify = fn; }
const { isAuthenticated, listEmails, listEvents }   = require("./google");
const { saveNote, getMessagesByNumber } = require("./db");
const { generateDailySummary }= require("./memory");
const {
  LOGS_DIR, MY_NUMBER,
  DEEPSEEK_API_KEY, DEEPSEEK_BASE_URL, DEEPSEEK_MODEL,
} = require("./config");

let _send = null; // client.sendMessage(MY_NUMBER, text)

// ── Email watchers ────────────────────────────────────────────
// Separado dos watchers genéricos — usa Gmail API diretamente
// sem depender do DuckDuckGo ou shell

const EMAIL_WATCHERS_FILE = "./nina-email-watchers.json";

function loadEmailWatchers() {
  try {
    if (require("fs").existsSync(EMAIL_WATCHERS_FILE))
      return JSON.parse(require("fs").readFileSync(EMAIL_WATCHERS_FILE, "utf-8"));
  } catch {}
  return [];
}

function saveEmailWatchers(w) {
  require("fs").writeFileSync(EMAIL_WATCHERS_FILE, JSON.stringify(w, null, 2));
}

let emailWatchers   = loadEmailWatchers();
let emailCronJobs   = new Map();

function addEmailWatcher(opts) {
  const { description, query, interval = "5m" } = opts;
  const id = Date.now().toString(36);
  const w  = { id, description, query, interval, active: true,
               createdAt: new Date().toISOString(), lastChecked: null,
               seenIds: [] };
  emailWatchers.push(w);
  saveEmailWatchers(emailWatchers);
  scheduleEmailWatcher(w);
  return w;
}

function removeEmailWatcher(id) {
  const job = emailCronJobs.get(id);
  if (job) { job.stop(); emailCronJobs.delete(id); }
  emailWatchers = emailWatchers.filter((w) => w.id !== id);
  saveEmailWatchers(emailWatchers);
}

function listEmailWatchers() {
  if (!emailWatchers.length) return "nenhum watcher de email configurado";
  return emailWatchers.map((w) => {
    const last = w.lastChecked ? new Date(w.lastChecked).toLocaleTimeString("pt-BR") : "nunca";
    return `[${w.id}] ${w.description}\n  query: ${w.query} | a cada: ${w.interval} | último: ${last}`;
  }).join("\n\n");
}

function intervalToCronEmail(interval) {
  const m = interval.match(/^(\d+)(m|h)$/);
  if (!m) return "*/5 * * * *";
  return m[2] === "m" ? `*/${m[1]} * * * *` : `0 */${m[1]} * * *`;
}

async function checkEmailWatcher(w) {
  try {
    const { isAuthenticated, listEmails } = require("./google");
    if (!isAuthenticated()) return;

    // Busca emails com a query — só os não vistos antes
    const raw    = await listEmails({ query: w.query + " is:unread", maxResults: 5 });
    if (raw.includes("nenhum email")) return;

    // Extrai assuntos e remetentes do texto retornado
    const lines = raw.split("\n").filter((l) => l.startsWith("De:") || l.startsWith("Assunto:"));
    if (!lines.length) return;

    // Verifica se já notificou (usa hash do conteúdo como ID simples)
    const hash = require("crypto").createHash("md5").update(raw).digest("hex").slice(0, 8);
    if (w.seenIds.includes(hash)) return;

    // Notifica
    const idx = emailWatchers.findIndex((x) => x.id === w.id);
    if (idx >= 0) {
      emailWatchers[idx].lastChecked = new Date().toISOString();
      emailWatchers[idx].seenIds = [...(emailWatchers[idx].seenIds || []).slice(-50), hash];
      saveEmailWatchers(emailWatchers);
    }

    const preview = lines.slice(0, 4).join("\n");
    notify(`email watcher "${w.description}":\n${preview}`);

  } catch (err) {
    console.error(`[EmailWatcher:${w.id}] Erro:`, err.message);
  }
}

function scheduleEmailWatcher(w) {
  if (!w.active) return;
  const job = cron.schedule(intervalToCronEmail(w.interval), () => {
    checkEmailWatcher(w).catch(console.error);
  });
  emailCronJobs.set(w.id, job);
  console.log(`[EmailWatcher] "${w.description}" agendado (${w.interval})`);
}

function startEmailWatchers() {
  emailWatchers.filter((w) => w.active).forEach(scheduleEmailWatcher);
  console.log(`[EmailWatcher] ${emailWatchers.length} watcher(s) de email carregado(s)`);
}

function setMonitorSender(fn) { _send = fn; }

function notify(text, urgency = null) {
  if (_smartNotify) {
    // Rota pelo sistema inteligente — respeita quiet hours e urgência
    _smartNotify(text, { urgency, source: "monitor", skipAI: !!urgency }).catch(
      (e) => console.error("[Monitor] smartNotify err:", e.message)
    );
  } else if (_send) {
    _send(text).catch((e) => console.error("[Monitor] notify err:", e.message));
  }
  console.log(`[Monitor] → ${text.slice(0, 120)}`);
  actionLog.push({ ts: new Date().toISOString(), text });
}

// ── Log de ações proativas ────────────────────────────────────
const actionLog = [];

// ── Estado entre checks ───────────────────────────────────────
const state = {
  lastCpuAlert:  0,
  lastRamAlert:  0,
  lastDiskAlert: 0,
  highCpuRounds: 0,
  highRamRounds: 0,
  services:      {},
};

// Thresholds ajustáveis
const THRESHOLDS = {
  cpu:  80,   // % CPU pra alertar
  ram:  85,   // % RAM pra alertar
  disk: 88,   // % disco pra alertar
  alertCooldown: 30 * 60 * 1000, // 30min entre alertas do mesmo tipo
};

// ── Consulta a IA antes de agir ───────────────────────────────

async function aiDecide(context, question) {
  if (!DEEPSEEK_API_KEY) return { should_act: false };
  try {
    const res = await axios.post(
      `${DEEPSEEK_BASE_URL}/chat/completions`,
      {
        model: DEEPSEEK_MODEL,
        messages: [
          {
            role: "system",
            content: `Você é Nina, assistente proativa. Analise os dados e decida se deve agir.
Responda SOMENTE com JSON válido:
{"should_act": true|false, "message": "msg pra DG em pt-BR, sem emoji, max 2 frases", "command": "comando shell opcional"}
Se não há nada urgente: {"should_act": false}`,
          },
          { role: "user", content: `Dados: ${context}\nPergunta: ${question}` },
        ],
        temperature: 0.2,
        max_tokens:  200,
      },
      { headers: { Authorization: `Bearer ${DEEPSEEK_API_KEY}` }, timeout: 20_000 }
    );

    const raw = res.data?.choices?.[0]?.message?.content?.trim();
    const m   = raw?.match(/\{[\s\S]*\}/);
    return m ? JSON.parse(m[0]) : { should_act: false };
  } catch {
    return { should_act: false };
  }
}

// ── Check de recursos ─────────────────────────────────────────

async function checkResources() {
  const now    = Date.now();
  const total  = os.totalmem();
  const free   = os.freemem();
  const ramPct = ((total - free) / total) * 100;

  // RAM alta por 2 checks consecutivos → age
  if (ramPct > THRESHOLDS.ram) {
    state.highRamRounds++;
    if (state.highRamRounds >= 2 && (now - state.lastRamAlert) > THRESHOLDS.alertCooldown) {
      // Limpa cache do kernel (seguro, não mata processos)
      await runCommand("sync && echo 3 > /proc/sys/vm/drop_caches 2>/dev/null || true");

      const { output: top } = await runCommand(
        "ps aux --sort=-%mem | awk 'NR>1 && $4>3 {print $11, $4\"%\"}' | head -5"
      );

      const d = await aiDecide(
        `RAM em ${ramPct.toFixed(0)}%, limpa cache executada. Processos: ${top}`,
        "Deve notificar DG?"
      );

      if (d.should_act) {
        notify(`RAM em ${ramPct.toFixed(0)}% — limpei o cache do sistema.\n${d.message}`, "importante");
        logDecision({ category: "monitor", action: `limpei cache do kernel (RAM ${ramPct.toFixed(0)}%)`, reason: `RAM acima de ${THRESHOLDS.ram}%`, result: d.message, urgency: "importante" });
        if (d.command) await runCommand(d.command);
      }

      state.lastRamAlert  = now;
      state.highRamRounds = 0;
    }
  } else {
    state.highRamRounds = 0;
  }

  // CPU alta
  const { output: cpuRaw } = await runCommand("top -bn1 | grep 'Cpu(s)' | awk '{print $2}'");
  const cpuPct = parseFloat(cpuRaw) || 0;

  if (cpuPct > THRESHOLDS.cpu) {
    state.highCpuRounds++;
    if (state.highCpuRounds >= 2 && (now - state.lastCpuAlert) > THRESHOLDS.alertCooldown) {
      const { output: top } = await runCommand(
        "ps aux --sort=-%cpu | awk 'NR>1 && $3>10 {print $11, $3\"%\"}' | head -5"
      );

      const d = await aiDecide(
        `CPU em ${cpuPct.toFixed(0)}% por 2 checks. Top: ${top}`,
        "Isso é preocupante? Deve notificar DG?"
      );

      if (d.should_act) {
        notify(d.message || `CPU em ${cpuPct.toFixed(0)}% há algum tempo.\nProcessos: ${top}`);
        if (d.command) await runCommand(d.command);
      }

      state.lastCpuAlert  = now;
      state.highCpuRounds = 0;
    }
  } else {
    state.highCpuRounds = 0;
  }

  // Disco
  const { output: diskRaw } = await runCommand("df / | tail -1 | awk '{print $5}' | tr -d '%'");
  const diskPct = parseInt(diskRaw) || 0;

  if (diskPct > THRESHOLDS.disk && (now - state.lastDiskAlert) > THRESHOLDS.alertCooldown) {
    const { output: big } = await runCommand("du -sh /* 2>/dev/null | sort -rh | head -5");
    notify(`disco em ${diskPct}%. maiores diretórios:\n${big}`, "importante");
  logDecision({ category: "monitor", action: `alerta de disco (${diskPct}%)`, reason: `disco acima de ${THRESHOLDS.disk}%`, urgency: "importante" });
    state.lastDiskAlert = now;
  }
}

// ── Serviços monitorados ──────────────────────────────────────
// Adicione aqui os serviços que você quer vigiar

const WATCHED_SERVICES = [
  // { name: "nginx",    check: "pgrep nginx",    restart: "systemctl restart nginx" },
  // { name: "postgres", check: "pgrep postgres", restart: "systemctl restart postgresql" },
];

async function checkServices() {
  for (const svc of WATCHED_SERVICES) {
    const { output, error } = await runCommand(svc.check);
    const isUp  = !error && output?.trim() !== "";
    const wasUp = state.services[svc.name] !== false;

    if (!isUp && wasUp) {
      notify(`${svc.name} caiu — tentando reiniciar...`);
      await runCommand(svc.restart);

      await new Promise((r) => setTimeout(r, 3000));
      const { output: check2 } = await runCommand(svc.check);
      notify(check2 ? `${svc.name} reiniciado` : `não consegui reiniciar ${svc.name}`);
    } else if (isUp && state.services[svc.name] === false) {
      notify(`${svc.name} voltou ao normal`);
    }

    state.services[svc.name] = isUp;
  }
}

// ── Otimização automática (3h) ────────────────────────────────

async function proactiveOptimize() {
  const done = [];

  // Logs antigos da Nina
  if (fs.existsSync(LOGS_DIR)) {
    const { output } = await runCommand(`find "${LOGS_DIR}" -name "*.log" -mtime +30 -delete -print`);
    const count = output && output !== "(sem output)" ? output.split("\n").length : 0;
    if (count > 0) done.push(`removidos ${count} log(s) com +30 dias`);
  }

  // /tmp pesado
  const { output: tmpSz } = await runCommand("du -sm /tmp 2>/dev/null | awk '{print $1}'");
  if (parseInt(tmpSz) > 200) {
    await runCommand("find /tmp -type f -atime +1 -delete 2>/dev/null || true");
    done.push(`limpei /tmp (tinha ${tmpSz}MB)`);
  }

  // Cache apt
  const { output: aptSz } = await runCommand("du -sm /var/cache/apt 2>/dev/null | awk '{print $1}'");
  if (parseInt(aptSz) > 300) {
    await runCommand("apt-get clean 2>/dev/null || true");
    done.push(`limpei cache apt (${aptSz}MB)`);
  }

  // Atualizações de segurança
  const { output: upd } = await runCommand(
    "apt-get -s upgrade 2>/dev/null | grep -c '^Inst' || echo 0"
  );
  const updCount = parseInt(upd) || 0;
  if (updCount > 0) done.push(`${updCount} atualização(ões) disponível`);

  if (done.length > 0) {
    const msg = `otimização automática (3h):\n${done.map((d) => `• ${d}`).join("\n")}`;
    // Budget status no resumo diário
  try {
    const cfg = getBudgetConfig();
    const { costUSD } = JSON.parse(require("fs").readFileSync("./nina-budget.json","utf-8"));
    const pct = ((costUSD / cfg.dailyLimitUSD) * 100).toFixed(0);
    if (pct > 50) msg += `\nAPI: $${costUSD.toFixed(4)} de $${cfg.dailyLimitUSD} (${pct}%)`;
    if (isBlocked()) msg += "\n⚠️ limite de API atingido hoje";
  } catch {}

  // Gmail + Calendar no resumo matinal
  if (isAuthenticated()) {
    try {
      const [emails, events] = await Promise.all([
        listEmails({ query: "is:unread", maxResults: 5 }),
        listEvents({ days: 1, maxResults: 5 }),
      ]);

      const emailCount = (emails.match(/De:/g) || []).length;
      if (emailCount > 0) msg += `\n${emailCount} email(s) não lido(s)`;

      const eventCount = (events.match(/—/g) || []).length;
      if (eventCount > 0) msg += `\nagenda hoje:\n${events}`;
    } catch {}
  }

  notify(msg);
    saveNote(`Otimização ${new Date().toLocaleDateString("pt-BR")}`, done.join("\n"), null);
  }
}

// ── Resumo diário (8h) ────────────────────────────────────────

async function dailySummary() {
  const total  = os.totalmem();
  const free   = os.freemem();
  const ramPct = (((total - free) / total) * 100).toFixed(0);

  const [disk, upt, procs] = await Promise.all([
    runCommand("df -h / | tail -1 | awk '{print $3\"/\"$2\" (\"$5\")\"}'").then((r) => r.output || "?"),
    runCommand("uptime -p").then((r) => r.output || "?"),
    runCommand("ps aux | wc -l").then((r) => r.output || "?"),
  ]);

  const date = new Date().toLocaleDateString("pt-BR", { weekday:"long", day:"numeric", month:"long" });

  let msg = `bom dia. ${date}.\nservidor: RAM ${ramPct}% | disco ${disk?.trim()} | ${procs?.trim()} processos | ${upt?.trim()}`;

  // Ações proativas do dia anterior
  const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
  const prevActions = actionLog.filter((l) => l.ts.startsWith(yesterday));
  if (prevActions.length > 0) {
    msg += `\nontem fiz:\n${prevActions.map((a) => `• ${a.text.slice(0, 80)}`).join("\n")}`;
  }

  notify(msg);
}

// ── Resumo comprimido à meia-noite (base da memória longa) ────

async function midnightSummary() {
  try {
    // Pega mensagens do dia de DG
    const msgs = getMessagesByNumber(MY_NUMBER, 60);
    if (msgs.length > 5) {
      await generateDailySummary(MY_NUMBER, msgs);
      console.log("[Monitor] Resumo diário gerado para memória de longo prazo.");
    }
  } catch (err) {
    console.error("[Monitor] Erro no resumo meia-noite:", err.message);
  }
}

// ── Status e controle via chat ────────────────────────────────

function getMonitorStatus() {
  const now   = Date.now();
  const ago   = (ms) => ms > 0 ? `${Math.round((now - ms) / 60000)}min atrás` : "nunca";
  return [
    `CPU threshold: ${THRESHOLDS.cpu}% | RAM: ${THRESHOLDS.ram}% | Disco: ${THRESHOLDS.disk}%`,
    `último alerta CPU: ${ago(state.lastCpuAlert)}`,
    `último alerta RAM: ${ago(state.lastRamAlert)}`,
    `último alerta disco: ${ago(state.lastDiskAlert)}`,
    `serviços monitorados: ${WATCHED_SERVICES.length > 0 ? WATCHED_SERVICES.map((s) => s.name).join(", ") : "nenhum configurado"}`,
    `ações no log: ${actionLog.length}`,
  ].join("\n");
}

async function runOptimizationNow() {
  await proactiveOptimize();
  return "otimização executada — vê a mensagem acima";
}

// ── Start ─────────────────────────────────────────────────────

async function checkIoTDevices() {
  try {
    const { checkCriticalDevices } = require("./iot");
    await checkCriticalDevices();
  } catch {}
}

function startMonitor() {
  cron.schedule("*/5 * * * *",  () => checkResources().catch(console.error));
  cron.schedule("*/5 * * * *",  () => checkIoTDevices().catch(console.error));
  cron.schedule("*/2 * * * *",  () => checkServices().catch(console.error));
  cron.schedule("0 3 * * *",    () => proactiveOptimize().catch(console.error));
  cron.schedule("0 8 * * *",    () => dailySummary().catch(console.error));
  cron.schedule("55 23 * * *",  () => midnightSummary().catch(console.error)); // 23h55

  startEmailWatchers();
  console.log("[Monitor] Ativo — recursos(5min) | serviços(2min) | otimização(3h) | resumo(8h) | memória(23h55)");
}

module.exports = { startMonitor, setMonitorSender, setSmartNotify, getMonitorStatus, runOptimizationNow, addEmailWatcher, removeEmailWatcher, listEmailWatchers };
