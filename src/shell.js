// ============================================================
//  Nina — Acesso Total ao Servidor
//  Executa comandos shell, monitora recursos, gerencia arquivos
// ============================================================

const { exec } = require("child_process");
const fs       = require("fs");
const path     = require("path");
const os       = require("os");

const DANGEROUS_PATTERNS = [
  /\brm\b/, /\brmdir\b/, /\bmkfs\b/, /\bdd\b/,
  /\bkill\b/, /\bkillall\b/, /\bpkill\b/,
  /\bshutdown\b/, /\breboot\b/, /\bpoweroff\b/,
  /\bchmod\s+777\b/, /\bsudo\s+rm\b/, />\s*\/dev\//,
];

// Comandos aguardando confirmação { id -> cmd }
const pendingConfirmations = new Map();
let confirmCounter = 0;

function isDangerous(cmd) {
  return DANGEROUS_PATTERNS.some((r) => r.test(cmd));
}

function runCommand(cmd, timeout = 30_000) {
  return new Promise((resolve) => {
    exec(cmd, { timeout, maxBuffer: 1024 * 1024 }, (err, stdout, stderr) => {
      if (err && !stdout) {
        resolve({ output: null, error: stderr || err.message });
      } else {
        resolve({ output: stdout.trim() || stderr.trim() || "(sem output)", error: null });
      }
    });
  });
}

function savePendingCommand(cmd) {
  const id = ++confirmCounter;
  pendingConfirmations.set(id, cmd);
  setTimeout(() => pendingConfirmations.delete(id), 120_000); // expira em 2min
  return id;
}

async function executeConfirmed(id) {
  const cmd = pendingConfirmations.get(id);
  if (!cmd) return { output: null, error: "confirmação expirada ou inválida" };
  pendingConfirmations.delete(id);
  return runCommand(cmd);
}

function hasPendingConfirmation(id) {
  return pendingConfirmations.has(id);
}

async function getSystemStats() {
  const total  = os.totalmem();
  const free   = os.freemem();
  const used   = total - free;
  const memPct = ((used / total) * 100).toFixed(1);

  const [disk, cpu, upt] = await Promise.all([
    runCommand("df -h / | tail -1").then((r) => r.output || "?"),
    runCommand("top -bn1 | grep 'Cpu(s)' | awk '{print $2}'").then((r) => r.output || "?"),
    runCommand("uptime -p").then((r) => r.output || "?"),
  ]);

  return [
    `RAM: ${(used/1024/1024/1024).toFixed(1)}GB / ${(total/1024/1024/1024).toFixed(1)}GB (${memPct}%)`,
    `CPU: ${cpu}% em uso`,
    `Disco: ${disk}`,
    `Uptime: ${upt}`,
  ].join("\n");
}

function writeCodeFile(filepath, content) {
  const resolved = filepath.startsWith("/") ? filepath : path.join(os.homedir(), filepath);
  fs.mkdirSync(path.dirname(resolved), { recursive: true });
  fs.writeFileSync(resolved, content, "utf-8");
  return resolved;
}

function readCodeFile(filepath) {
  const resolved = filepath.startsWith("/") ? filepath : path.join(os.homedir(), filepath);
  if (!fs.existsSync(resolved)) return null;
  return fs.readFileSync(resolved, "utf-8");
}

async function listDir(dirpath) {
  const resolved = (dirpath || "~").replace("~", os.homedir());
  const { output } = await runCommand(`ls -lah "${resolved}"`);
  return output;
}

function restartSelf() {
  console.log("[Shell] Reiniciando por solicitação...");
  setTimeout(() => process.exit(0), 500);
}

module.exports = {
  isDangerous, runCommand,
  savePendingCommand, executeConfirmed, hasPendingConfirmation,
  getSystemStats, writeCodeFile, readCodeFile, listDir, restartSelf,
};
