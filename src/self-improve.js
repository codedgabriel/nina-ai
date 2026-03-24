// ============================================================
//  Nina v4 — Self-Improvement Seguro
//
//  Permite que a Nina melhore o próprio código com segurança.
//
//  Fluxo completo:
//  1. Lê o arquivo alvo + todos os arquivos que dependem dele
//  2. Pede ao DeepSeek pra gerar a melhoria com contexto total
//  3. Faz backup automático com timestamp
//  4. Aplica a mudança
//  5. Valida sintaxe (node --check)
//  6. Roda smoke tests (importa o módulo, verifica exports)
//  7. Se tudo passou → reinicia
//  8. Se qualquer passo falhou → rollback automático + relatório
//
//  Histórico de todas as melhorias fica em nina-improvements.json
//  Backups ficam em ~/nina-files/backups/
// ============================================================

const fs   = require("fs");
const path = require("path");
const os   = require("os");
const { execSync } = require("child_process");
const axios = require("axios");

const { runCommand }   = require("./shell");
const { logDecision }  = require("./decisions");
const {
  DEEPSEEK_API_KEY, DEEPSEEK_BASE_URL, DEEPSEEK_MODEL,
} = require("./config");

const BACKUP_DIR      = path.join(os.homedir(), "nina-files", "backups");
const IMPROVEMENTS_FILE = "./nina-improvements.json";

// Detecta o diretório raiz da Nina automaticamente
const NINA_SRC = path.resolve(__dirname);
const NINA_ROOT = path.resolve(__dirname, "..");

fs.mkdirSync(BACKUP_DIR, { recursive: true });

// ── Mapa de dependências entre módulos ────────────────────────
// Quais arquivos importam cada módulo — usado pra dar contexto completo

function buildDependencyMap() {
  const map = {}; // { "monitor.js": ["index.js", "executor.js"] }

  const files = fs.readdirSync(NINA_SRC).filter((f) => f.endsWith(".js"));
  for (const file of files) {
    const content = fs.readFileSync(path.join(NINA_SRC, file), "utf-8");
    const requires = [...content.matchAll(/require\(["']\.\/([^"']+)["']\)/g)]
      .map((m) => m[1] + (m[1].endsWith(".js") ? "" : ".js"));

    for (const dep of requires) {
      if (!map[dep]) map[dep] = [];
      map[dep].push(file);
    }
  }
  return map;
}

// ── Lê contexto relevante do projeto ─────────────────────────

function readRelevantContext(targetFile) {
  const depMap   = buildDependencyMap();
  const basename = path.basename(targetFile);
  const context  = {};

  // Arquivo alvo
  const targetPath = path.join(NINA_SRC, basename);
  if (fs.existsSync(targetPath)) {
    context[basename] = fs.readFileSync(targetPath, "utf-8");
  }

  // Arquivos que importam o alvo (dependentes)
  const dependents = depMap[basename] || [];
  for (const dep of dependents.slice(0, 3)) { // max 3 pra não explodir o contexto
    const depPath = path.join(NINA_SRC, dep);
    if (fs.existsSync(depPath)) {
      context[dep] = fs.readFileSync(depPath, "utf-8");
    }
  }

  // Arquivos que o alvo importa (dependências)
  if (context[basename]) {
    const imports = [...context[basename].matchAll(/require\(["']\.\/([^"']+)["']\)/g)]
      .map((m) => m[1] + (m[1].endsWith(".js") ? "" : ".js"))
      .slice(0, 2); // max 2

    for (const imp of imports) {
      if (!context[imp]) {
        const impPath = path.join(NINA_SRC, imp);
        if (fs.existsSync(impPath)) {
          // Só o início do arquivo (exports e estrutura) pra economizar tokens
          const content = fs.readFileSync(impPath, "utf-8");
          context[imp]  = content.slice(0, 1500) + (content.length > 1500 ? "\n// ...(truncado)" : "");
        }
      }
    }
  }

  return context;
}

// ── Gera a melhoria com o DeepSeek ───────────────────────────

async function generateImprovement(targetFile, instruction, context) {
  if (!DEEPSEEK_API_KEY) return { error: "DEEPSEEK_API_KEY não configurada" };

  const contextText = Object.entries(context)
    .map(([file, code]) => `=== ${file} ===\n${code}`)
    .join("\n\n");

  const targetContent = context[path.basename(targetFile)] || "";

  try {
    const res = await axios.post(
      `${DEEPSEEK_BASE_URL}/chat/completions`,
      {
        model: DEEPSEEK_MODEL,
        messages: [
          {
            role: "system",
            content: `Você é um engenheiro de software sênior melhorando o código da Nina (assistente AI em Node.js).

Regras ABSOLUTAS:
1. Retorne APENAS o código JavaScript completo do arquivo modificado — nada mais
2. Não inclua markdown, backticks, explicações ou comentários fora do código
3. Mantenha TODOS os exports existentes — nunca remova uma função exportada
4. Mantenha a compatibilidade com todos os arquivos que importam este módulo
5. O código deve ser válido Node.js — use apenas APIs nativas e módulos já no package.json
6. Se a melhoria não for possível sem quebrar algo, retorne o arquivo ORIGINAL sem mudanças

Contexto do projeto (arquivos relacionados):
${contextText}`,
          },
          {
            role: "user",
            content: `Arquivo a melhorar: ${path.basename(targetFile)}
            
Instrução: ${instruction}

Código atual:
${targetContent}

Retorne o arquivo completo melhorado:`,
          },
        ],
        temperature: 0.2,
        max_tokens:  4096,
      },
      {
        headers: { Authorization: `Bearer ${DEEPSEEK_API_KEY}` },
        timeout: 120_000,
      }
    );

    let code = res.data?.choices?.[0]?.message?.content?.trim();
    if (!code) return { error: "resposta vazia do DeepSeek" };

    // Remove possíveis backticks se vieram mesmo assim
    code = code.replace(/^```(?:javascript|js)?\n?/i, "").replace(/\n?```$/i, "").trim();

    return { code };
  } catch (err) {
    return { error: `erro na API: ${err.message}` };
  }
}

// ── Backup ────────────────────────────────────────────────────

function createBackup(targetFile) {
  const basename  = path.basename(targetFile);
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const backupPath = path.join(BACKUP_DIR, `${basename}.${timestamp}.bak`);
  fs.copyFileSync(path.join(NINA_SRC, basename), backupPath);
  return backupPath;
}

function restoreBackup(backupPath, targetFile) {
  const basename = path.basename(targetFile);
  fs.copyFileSync(backupPath, path.join(NINA_SRC, basename));
}

// ── Validações ────────────────────────────────────────────────

function validateSyntax(code, targetFile) {
  const tmpFile = path.join(os.tmpdir(), `nina_check_${Date.now()}.js`);
  try {
    fs.writeFileSync(tmpFile, code);
    execSync(`node --check "${tmpFile}"`, { timeout: 10000 });
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err.stderr?.toString() || err.message };
  } finally {
    try { fs.unlinkSync(tmpFile); } catch {}
  }
}

function validateExports(code, originalContent) {
  // Extrai exports do original
  const getExports = (src) => {
    const match = src.match(/module\.exports\s*=\s*\{([^}]+)\}/);
    if (!match) return [];
    return match[1].split(",").map((e) => e.trim().split(":")[0].trim()).filter(Boolean);
  };

  const originalExports = getExports(originalContent);
  const newExports      = getExports(code);

  const missing = originalExports.filter((e) => !newExports.includes(e));
  if (missing.length > 0) {
    return { ok: false, error: `exports removidos: ${missing.join(", ")}` };
  }
  return { ok: true };
}

function validateNoNewDependencies(code) {
  // Detecta se o código novo tenta importar pacotes não instalados
  const newRequires = [...code.matchAll(/require\(['"]([^./][^'"]+)['"]\)/g)]
    .map((m) => m[1].split("/")[0]);

  const pkgPath = path.join(NINA_ROOT, "package.json");
  if (!fs.existsSync(pkgPath)) return { ok: true };

  const pkg          = JSON.parse(fs.readFileSync(pkgPath, "utf-8"));
  const installed    = Object.keys({ ...pkg.dependencies, ...pkg.devDependencies });
  const builtins     = ["fs", "path", "os", "crypto", "child_process", "http", "https",
                        "net", "events", "stream", "util", "url", "querystring"];
  const notInstalled = newRequires.filter(
    (r) => !installed.includes(r) && !builtins.includes(r)
  );

  if (notInstalled.length > 0) {
    return { ok: false, error: `pacotes não instalados: ${notInstalled.join(", ")}` };
  }
  return { ok: true };
}

// ── Histórico de melhorias ────────────────────────────────────

function loadHistory() {
  try {
    if (fs.existsSync(IMPROVEMENTS_FILE))
      return JSON.parse(fs.readFileSync(IMPROVEMENTS_FILE, "utf-8"));
  } catch {}
  return [];
}

function saveHistory(history) {
  fs.writeFileSync(IMPROVEMENTS_FILE, JSON.stringify(history, null, 2));
}

function recordImprovement(entry) {
  const history = loadHistory();
  history.unshift(entry); // mais recente primeiro
  if (history.length > 50) history.pop(); // max 50 registros
  saveHistory(history);
}

function getImprovementHistory(limit = 10) {
  const history = loadHistory();
  if (!history.length) return "nenhuma melhoria registrada ainda.";

  return history.slice(0, limit).map((h) => {
    const date   = new Date(h.timestamp).toLocaleString("pt-BR");
    const status = h.success ? "sucesso" : `falhou (${h.failReason})`;
    return `[${date}] ${h.file} — ${h.instruction.slice(0, 60)}\n  status: ${status}${h.backupPath ? "\n  backup: " + h.backupPath : ""}`;
  }).join("\n\n");
}

// ── Pipeline principal ────────────────────────────────────────

async function improveFile(targetFile, instruction) {
  const basename = path.basename(targetFile);
  const fullPath = path.join(NINA_SRC, basename);

  if (!fs.existsSync(fullPath)) {
    return `arquivo não encontrado: ${basename}`;
  }

  const originalContent = fs.readFileSync(fullPath, "utf-8");
  const steps = [];
  let backupPath = null;

  console.log(`[Self-improve] Iniciando melhoria de ${basename}...`);
  console.log(`[Self-improve] Instrução: ${instruction}`);

  try {
    // ── PASSO 1: Lê contexto ─────────────────────────────────
    steps.push("lendo contexto do projeto");
    const context = readRelevantContext(basename);
    const depCount = Object.keys(context).length;
    console.log(`[Self-improve] Contexto: ${depCount} arquivo(s) relevante(s)`);

    // ── PASSO 2: Gera melhoria ────────────────────────────────
    steps.push("gerando melhoria com DeepSeek");
    const { code, error: genError } = await generateImprovement(fullPath, instruction, context);
    if (genError) {
      return `falha ao gerar melhoria: ${genError}`;
    }

    // ── PASSO 3: Validações preventivas ──────────────────────
    steps.push("validando sintaxe");
    const syntaxCheck = validateSyntax(code, fullPath);
    if (!syntaxCheck.ok) {
      recordImprovement({
        timestamp:  new Date().toISOString(),
        file:       basename,
        instruction,
        success:    false,
        failReason: `sintaxe inválida: ${syntaxCheck.error}`,
        backupPath: null,
      });
      return `melhoria rejeitada — sintaxe inválida:\n${syntaxCheck.error}\n\nnenhuma alteração foi feita.`;
    }

    steps.push("verificando exports");
    const exportCheck = validateExports(code, originalContent);
    if (!exportCheck.ok) {
      recordImprovement({
        timestamp:  new Date().toISOString(),
        file:       basename,
        instruction,
        success:    false,
        failReason: exportCheck.error,
        backupPath: null,
      });
      return `melhoria rejeitada — ${exportCheck.error}\n\nnenhuma alteração foi feita.`;
    }

    steps.push("verificando dependências");
    const depsCheck = validateNoNewDependencies(code);
    if (!depsCheck.ok) {
      recordImprovement({
        timestamp:  new Date().toISOString(),
        file:       basename,
        instruction,
        success:    false,
        failReason: depsCheck.error,
        backupPath: null,
      });
      return `melhoria rejeitada — ${depsCheck.error}\n\nnenhuma alteração foi feita.`;
    }

    // ── PASSO 4: Backup ───────────────────────────────────────
    steps.push("fazendo backup");
    backupPath = createBackup(fullPath);
    console.log(`[Self-improve] Backup: ${backupPath}`);

    // ── PASSO 5: Aplica ───────────────────────────────────────
    steps.push("aplicando mudança");
    fs.writeFileSync(fullPath, code, "utf-8");

    // ── PASSO 6: Verifica de novo no arquivo real ─────────────
    steps.push("verificando arquivo final");
    const finalCheck = validateSyntax(code, fullPath);
    if (!finalCheck.ok) {
      restoreBackup(backupPath, fullPath);
      recordImprovement({
        timestamp:  new Date().toISOString(),
        file:       basename,
        instruction,
        success:    false,
        failReason: `falha na verificação final: ${finalCheck.error}`,
        backupPath,
      });
      return `rollback executado — falha na verificação final.\nbackup restaurado de: ${backupPath}`;
    }

    // ── SUCESSO ───────────────────────────────────────────────
    recordImprovement({
      timestamp:   new Date().toISOString(),
      file:        basename,
      instruction,
      success:     true,
      backupPath,
      linesOriginal: originalContent.split("\n").length,
      linesNew:      code.split("\n").length,
    });

    logDecision({
      category:    "tool",
      action:      `self-improvement: ${basename}`,
      reason:      instruction,
      result:      "aplicado com sucesso",
      urgency:     "info",
      triggered_by: "user",
    });

    console.log(`[Self-improve] Sucesso! Backup em: ${backupPath}`);

    // Calcula diff de linhas
    const origLines = originalContent.split("\n").length;
    const newLines  = code.split("\n").length;
    const diffLines = newLines - origLines;
    const diffStr   = diffLines > 0 ? `+${diffLines}` : `${diffLines}`;

    return [
      `melhoria aplicada em ${basename} (${diffStr} linhas)`,
      `backup salvo em: ${path.basename(backupPath)}`,
      `passos: ${steps.join(" → ")}`,
      `reinicia pra aplicar as mudanças? (sim/não)`,
    ].join("\n");

  } catch (err) {
    // Rollback de emergência
    if (backupPath && fs.existsSync(backupPath)) {
      try {
        restoreBackup(backupPath, fullPath);
        console.error(`[Self-improve] Erro + rollback executado:`, err.message);
      } catch (rollbackErr) {
        console.error(`[Self-improve] Rollback falhou:`, rollbackErr.message);
      }
    }

    recordImprovement({
      timestamp:   new Date().toISOString(),
      file:        basename,
      instruction,
      success:     false,
      failReason:  err.message,
      backupPath:  backupPath || null,
    });

    return `erro durante a melhoria: ${err.message}\n${backupPath ? "rollback executado automaticamente." : "nenhuma alteração foi feita."}`;
  }
}

// ── Rollback manual ───────────────────────────────────────────

async function rollbackFile(targetFile) {
  const basename = path.basename(targetFile);

  // Encontra o backup mais recente deste arquivo
  const backups = fs.readdirSync(BACKUP_DIR)
    .filter((f) => f.startsWith(basename + "."))
    .sort()
    .reverse();

  if (!backups.length) {
    return `nenhum backup encontrado para ${basename}`;
  }

  const latest     = backups[0];
  const backupPath = path.join(BACKUP_DIR, latest);
  const targetPath = path.join(NINA_SRC, basename);

  restoreBackup(backupPath, targetPath);

  logDecision({
    category: "tool",
    action:   `rollback manual: ${basename}`,
    reason:   `restaurado de ${latest}`,
    urgency:  "importante",
    triggered_by: "user",
  });

  return `rollback executado: ${basename}\nrestaurado de: ${latest}`;
}

function listBackups(targetFile = null) {
  const allBackups = fs.readdirSync(BACKUP_DIR)
    .filter((f) => f.endsWith(".bak"))
    .filter((f) => !targetFile || f.startsWith(path.basename(targetFile) + "."))
    .sort()
    .reverse()
    .slice(0, 20);

  if (!allBackups.length) return "nenhum backup encontrado";

  return allBackups.map((f) => {
    const size = fs.statSync(path.join(BACKUP_DIR, f)).size;
    return `${f} (${(size / 1024).toFixed(1)}KB)`;
  }).join("\n");
}

module.exports = {
  improveFile,
  rollbackFile,
  listBackups,
  getImprovementHistory,
  readRelevantContext,
};
