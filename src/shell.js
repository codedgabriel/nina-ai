// ============================================================
//  Nina v4 — Acesso Total ao Servidor
// ============================================================

const { exec } = require("child_process");
const fs       = require("fs");
const path     = require("path");
const os       = require("os");

// ── runCommand com cwd opcional ───────────────────────────────

function runCommand(cmd, timeout = 60_000, cwd = undefined) {
  return new Promise((resolve) => {
    const opts = { timeout, maxBuffer: 4 * 1024 * 1024 };
    if (cwd) opts.cwd = cwd;

    exec(cmd, opts, (err, stdout, stderr) => {
      if (err && !stdout) {
        resolve({ output: null, error: stderr || err.message });
      } else {
        resolve({ output: stdout.trim() || stderr.trim() || "(sem output)", error: null });
      }
    });
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
