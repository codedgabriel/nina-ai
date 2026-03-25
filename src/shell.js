// ============================================================
//  Nina v4 — Acesso Total ao Servidor
// ============================================================

const { exec } = require("child_process");
const fs       = require("fs");
const path     = require("path");
const os       = require("os");

// ── runCommand com cwd opcional ───────────────────────────────

// Códigos de erro que valem retry automático
const RETRYABLE_ERRORS = [
  "ETIMEDOUT", "ECONNRESET", "ECONNREFUSED", "ENOTFOUND",
  "temporary failure", "try again", "temporarily unavailable",
];

function isRetryable(errMsg) {
  if (!errMsg) return false;
  const lower = errMsg.toLowerCase();
  return RETRYABLE_ERRORS.some(e => lower.includes(e.toLowerCase()));
}

function runCommand(cmd, timeout = 60_000, cwd = undefined, retries = 1) {
  return new Promise((resolve) => {
    const opts = { timeout, maxBuffer: 4 * 1024 * 1024 };
    if (cwd) opts.cwd = cwd;

    function attempt(attemptsLeft) {
      exec(cmd, opts, (err, stdout, stderr) => {
        if (err && !stdout) {
          const errMsg = stderr || err.message || "comando falhou sem output";

          // Diagnóstico de erro mais descritivo
          let diagnosis = errMsg.trim();
          if (err.code === "ETIMEDOUT" || err.killed) {
            diagnosis = `timeout após ${timeout / 1000}s — comando: ${cmd.slice(0, 80)}`;
          } else if (err.code === "ENOENT") {
            const prog = cmd.split(" ")[0];
            diagnosis = `programa não encontrado: ${prog}`;
          } else if (err.code) {
            diagnosis = `[${err.code}] ${errMsg.trim()}`;
          }

          // Retry automático para erros transitórios
          if (attemptsLeft > 0 && isRetryable(errMsg)) {
            console.log(`[Shell] Retry automático (${attemptsLeft} tentativa(s) restante(s)): ${cmd.slice(0, 60)}`);
            setTimeout(() => attempt(attemptsLeft - 1), 2000);
            return;
          }

          resolve({ output: null, error: diagnosis });
        } else {
          const out = stdout.trim() || stderr.trim() || "(sem output)";
          resolve({ output: out, error: null });
        }
      });
    }

    attempt(retries);
  });
}

// ── Stats do sistema ──────────────────────────────────────────

async function getSystemStats() {
  const total  = os.totalmem();
  const free   = os.freemem();
  const used   = total - free;
  const memPct = ((used / total) * 100).toFixed(1);

  const [disk, cpu, upt, load] = await Promise.all([
    runCommand("df -h / | tail -1").then((r) => r.output || "?"),
    runCommand("top -bn1 | grep 'Cpu(s)' | awk '{print $2}'").then((r) => r.output || "?"),
    runCommand("uptime -p").then((r) => r.output || "?"),
    runCommand("uptime | awk -F'load average:' '{print $2}'").then((r) => r.output?.trim() || "?"),
  ]);

  return [
    `RAM:    ${(used/1024/1024/1024).toFixed(1)}GB / ${(total/1024/1024/1024).toFixed(1)}GB (${memPct}%)`,
    `CPU:    ${cpu}% em uso  |  Load: ${load}`,
    `Disco:  ${disk}`,
    `Uptime: ${upt}`,
  ].join("\n");
}

// ── Arquivos ──────────────────────────────────────────────────

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

module.exports = { runCommand, getSystemStats, writeCodeFile, readCodeFile };
