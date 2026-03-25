// ============================================================
//  Nina v4 — Self-Improvement Autônomo e Seguro
//
//  Melhorias v2:
//  ─────────────
//  1. Auto-trigger: monitora erros em runtime e propõe melhorias
//     automaticamente quando um módulo falha recorrentemente
//  2. Análise de contexto ampliada: inclui ferramentas relevantes
//     de tools.js para a IA entender a interface completa
//  3. Retry inteligente: 3 tentativas com prompts progressivamente
//     mais restritivos se a IA gerar código ruim
//  4. Diff visual: mostra exatamente o que mudou antes de aplicar
//  5. Agendamento seguro: nunca aplica melhorias durante uso ativo
//     (respeita lastUserMessageAt)
//  6. Registro de erros: auto-melhoria guiada por erros reais
//     coletados via errorTracker
//  7. Limpeza de backups: remove backups com mais de 7 dias
//     automaticamente
//
//  Fluxo:
//  1. Lê o arquivo alvo + dependentes + dependências
//  2. Gera melhoria (até 3 tentativas com prompts diferentes)
//  3. Valida: sintaxe, exports, dependências, tamanho, estrutura
//  4. Mostra diff resumido antes de confirmar
//  5. Backup → aplica → verifica no arquivo real
//  6. Reinicia se aprovado, rollback se qualquer passo falhar
//
//  Histórico: nina-improvements.json
//  Backups: ~/nina-files/backups/
//  Erros rastreados: nina-error-tracker.json
// ============================================================

const fs   = require("fs");
const path = require("path");
const os   = require("os");
const { execSync } = require("child_process");
const axios = require("axios");

const log          = require("./logger");
const { runCommand }  = require("./shell");
const { logDecision } = require("./decisions");
const {
  DEEPSEEK_API_KEY, DEEPSEEK_BASE_URL, DEEPSEEK_MODEL,
} = require("./config");

const BACKUP_DIR        = path.join(os.homedir(), "nina-files", "backups");
const IMPROVEMENTS_FILE = "./nina-improvements.json";
const ERROR_TRACKER_FILE = "./nina-error-tracker.json";
const BACKUP_MAX_AGE_DAYS = 7;

const NINA_SRC  = path.resolve(__dirname);
const NINA_ROOT = path.resolve(__dirname, "..");

fs.mkdirSync(BACKUP_DIR, { recursive: true });

// ── Rastreamento de erros em runtime ─────────────────────────
// Outros módulos chamam trackError() quando algo falha repetidamente.
// O self-improve usa esse histórico para propor melhorias guiadas.

const errorLog = (() => {
  try {
    if (fs.existsSync(ERROR_TRACKER_FILE))
      return JSON.parse(fs.readFileSync(ERROR_TRACKER_FILE, "utf-8"));
  } catch {}
  return {};
})();

function trackError(moduleName, errorMessage) {
  if (!errorLog[moduleName]) errorLog[moduleName] = [];
  errorLog[moduleName].push({
    ts:  new Date().toISOString(),
    msg: errorMessage.slice(0, 200),
  });
  // Mantém só os últimos 20 erros por módulo
  if (errorLog[moduleName].length > 20) errorLog[moduleName].shift();

  try {
    fs.writeFileSync(ERROR_TRACKER_FILE, JSON.stringify(errorLog, null, 2));
  } catch {}
}

function getModuleErrors(moduleName) {
  return errorLog[moduleName] || [];
}

function getTopErrorModules(limit = 5) {
  return Object.entries(errorLog)
    .map(([mod, errs]) => ({ mod, count: errs.length, last: errs[errs.length - 1]?.msg || "" }))
    .sort((a, b) => b.count - a.count)
    .slice(0, limit);
}

// ── Referência ao timestamp de última mensagem ────────────────
// Prevenção de aplicar melhorias durante uso ativo

let _getLastActivity = () => null;
function setActivityGetter(fn) { _getLastActivity = fn; }

function isIdleEnough() {
  const last = _getLastActivity();
  if (!last) return true;
  const idleSeconds = (Date.now() - last) / 1000;
  return idleSeconds > 120; // 2 minutos sem mensagem
}

// ── Mapa de dependências ──────────────────────────────────────

function buildDependencyMap() {
  const map = {};
  const files = fs.readdirSync(NINA_SRC).filter((f) => f.endsWith(".js"));
  for (const file of files) {
    const content = fs.readFileSync(path.join(NINA_SRC, file), "utf-8");
    const requires = [...content.matchAll(/require\(["']\.\\/([^"']+)["']\)/g)]
      .map((m) => m[1] + (m[1].endsWith(".js") ? "" : ".js"));
    for (const dep of requires) {
      if (!map[dep]) map[dep] = [];
      map[dep].push(file);
    }
  }
  return map;
}

// ── Lê contexto relevante ─────────────────────────────────────

function readRelevantContext(targetFile) {
  const depMap   = buildDependencyMap();
  const basename = path.basename(targetFile);
  const context  = {};

  // Arquivo alvo completo
  const targetPath = path.join(NINA_SRC, basename);
  if (fs.existsSync(targetPath)) {
    context[basename] = fs.readFileSync(targetPath, "utf-8");
  }

  // Dependentes (quem importa o alvo) — até 3
  const dependents = depMap[basename] || [];
  for (const dep of dependents.slice(0, 3)) {
    const depPath = path.join(NINA_SRC, dep);
    if (fs.existsSync(depPath)) {
      context[dep] = fs.readFileSync(depPath, "utf-8");
    }
  }

  // Dependências (o que o alvo importa) — só o início
  if (context[basename]) {
    const imports = [...context[basename].matchAll(/require\(["']\.\\/([^"']+)["']\)/g)]
      .map((m) => m[1] + (m[1].endsWith(".js") ? "" : ".js"))
      .filter((f) => !context[f])
      .slice(0, 2);

    for (const imp of imports) {
      const impPath = path.join(NINA_SRC, imp);
      if (fs.existsSync(impPath)) {
        const content = fs.readFileSync(impPath, "utf-8");
        context[imp]  = content.slice(0, 1500) + (content.length > 1500 ? "\n// ...(truncado)" : "");
      }
    }
  }

  return context;
}

// ── Gera diff textual resumido ────────────────────────────────

function generateDiff(original, generated) {
  const origLines = original.split("\n");
  const newLines  = generated.split("\n");
  const added     = newLines.filter((l) => !origLines.includes(l)).length;
  const removed   = origLines.filter((l) => !newLines.includes(l)).length;
  const delta     = newLines.length - origLines.length;

  return {
    added, removed, delta,
    summary: `${origLines.length} → ${newLines.length} linhas (${delta >= 0 ? "+" : ""}${delta}), ~${added} adicionadas, ~${removed} removidas`,
  };
}

// ── Geração com retry inteligente ────────────────────────────

const PROMPT_STRATEGIES = [
  // Tentativa 1: instrução direta
  (targetFile, instruction, context, errors) => {
    const errorContext = errors.length > 0
      ? `\n\nERROS RECENTES neste módulo (guie a melhoria por eles):\n${errors.slice(-5).map((e) => `- ${e.msg}`).join("\n")}`
      : "";

    return `Arquivo a melhorar: ${path.basename(targetFile)}

Instrução: ${instruction}${errorContext}

REGRAS CRÍTICAS (violação = rejeição automática):
- Retorne APENAS o código JavaScript completo — NENHUM texto antes ou depois
- Não use markdown, backticks ou explicações
- Mantenha TODOS os exports existentes sem alterar assinaturas
- Use apenas CommonJS (require/module.exports), nunca import/export
- Não adicione pacotes externos novos
- Retorne o arquivo COMPLETO, não apenas o trecho

Código atual (${context[path.basename(targetFile)]?.split("\n").length} linhas):
${context[path.basename(targetFile)]}

Comece diretamente com o código:`;
  },

  // Tentativa 2: mais restritivo, pede explicitamente pra não truncar
  (targetFile, instruction, context, errors) => {
    const orig = context[path.basename(targetFile)] || "";
    return `TAREFA: Melhorar ${path.basename(targetFile)} seguindo a instrução abaixo.

INSTRUÇÃO: ${instruction}

ATENÇÃO ESPECIAL:
- O arquivo original tem ${orig.split("\n").length} linhas. Seu output deve ter no mínimo ${Math.floor(orig.split("\n").length * 0.8)} linhas.
- Se você não conseguir melhorar sem riscos, retorne o ARQUIVO ORIGINAL SEM MUDANÇAS.
- NÃO truncar, NÃO resumir, NÃO usar "// resto do código aqui"
- Primeiro caractere deve ser "/" (início de comentário ou require)

${orig}

OUTPUT (apenas código, sem explicações):`;
  },

  // Tentativa 3: pede só a parte modificada com marcadores claros
  (targetFile, instruction, context) => {
    return `Você vai melhorar UMA função específica em ${path.basename(targetFile)}.

Instrução: ${instruction}

Retorne o arquivo COMPLETO com a melhoria aplicada.
O arquivo começa com "// ====" e termina com "module.exports".
Não adicione nada antes ou depois.

${context[path.basename(targetFile)] || ""}`;
  },
];

async function generateImprovement(targetFile, instruction, context, attempt = 0) {
  if (!DEEPSEEK_API_KEY) return { error: "DEEPSEEK_API_KEY não configurada" };

  const basename = path.basename(targetFile);
  const errors   = getModuleErrors(basename.replace(".js", ""));

  const contextText = Object.entries(context)
    .filter(([file]) => file !== basename) // alvo já está no prompt do user
    .map(([file, code]) => `=== ${file} ===\n${code}`)
    .join("\n\n");

  const userPrompt = PROMPT_STRATEGIES[attempt % PROMPT_STRATEGIES.length](
    targetFile, instruction, context, errors
  );

  try {
    const res = await axios.post(
      `${DEEPSEEK_BASE_URL}/chat/completions`,
      {
        model: DEEPSEEK_MODEL,
        messages: [
          {
            role: "system",
            content: `Você é um engenheiro Node.js sênior melhorando o código da Nina (assistente AI via WhatsApp).

CONTEXTO DO PROJETO (arquivos relacionados ao alvo):
${contextText || "(nenhum dependente direto)"}

REGRAS ABSOLUTAS:
1. Retorne APENAS código JavaScript válido — sem markdown, sem backticks, sem explicações
2. Nunca remova exports existentes nem altere suas assinaturas
3. Use apenas CommonJS (require/module.exports)
4. Não adicione dependências novas (npm packages não instalados)
5. O código deve ser compatível com Node.js 18+
6. Se a melhoria não for segura, retorne o arquivo original sem alteração`,
          },
          {
            role: "user",
            content: userPrompt,
          },
        ],
        temperature: attempt === 0 ? 0.2 : 0.1, // mais conservador nas retentativas
        max_tokens:  4096,
      },
      {
        headers: { Authorization: `Bearer ${DEEPSEEK_API_KEY}` },
        timeout: 120_000,
      }
    );

    let code = res.data?.choices?.[0]?.message?.content?.trim();
    if (!code) return { error: "resposta vazia do DeepSeek" };

    // Limpa markdown que pode vir mesmo com instruções
    code = code.replace(/^```(?:javascript|js|node)?\n?/i, "").replace(/\n?```\s*$/i, "").trim();

    return { code };
  } catch (err) {
    const msg = err.response?.data?.error?.message || err.message;
    return { error: `API: ${msg}` };
  }
}

// ── Backup ────────────────────────────────────────────────────

function createBackup(targetFile) {
  const basename   = path.basename(targetFile);
  const timestamp  = new Date().toISOString().replace(/[:.]/g, "-");
  const backupPath = path.join(BACKUP_DIR, `${basename}.${timestamp}.bak`);
  fs.copyFileSync(path.join(NINA_SRC, basename), backupPath);
  return backupPath;
}

function restoreBackup(backupPath, targetFile) {
  const basename = path.basename(targetFile);
  fs.copyFileSync(backupPath, path.join(NINA_SRC, basename));
}

// Limpeza de backups antigos
function cleanOldBackups() {
  const maxAgeMs = BACKUP_MAX_AGE_DAYS * 24 * 60 * 60 * 1000;
  const now = Date.now();
  let cleaned = 0;
  try {
    for (const file of fs.readdirSync(BACKUP_DIR)) {
      if (!file.endsWith(".bak")) continue;
      const fullPath = path.join(BACKUP_DIR, file);
      const age = now - fs.statSync(fullPath).mtimeMs;
      if (age > maxAgeMs) {
        fs.unlinkSync(fullPath);
        cleaned++;
      }
    }
    if (cleaned > 0) log.info("Backup", `${cleaned} backup(s) antigo(s) removido(s)`);
  } catch {}
}

// ── Validações ────────────────────────────────────────────────

function validateSyntax(code) {
  const tmpFile = path.join(os.tmpdir(), `nina_check_${Date.now()}.js`);
  try {
    fs.writeFileSync(tmpFile, code);
    execSync(`node --check "${tmpFile}"`, { timeout: 10_000 });
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err.stderr?.toString().trim() || err.message };
  } finally {
    try { fs.unlinkSync(tmpFile); } catch {}
  }
}

function validateExports(code, originalContent) {
  const getExports = (src) => {
    const match = src.match(/module\.exports\s*=\s*\{([^}]+)\}/);
    if (!match) return [];
    return match[1].split(",").map((e) => e.trim().split(":")[0].trim()).filter(Boolean);
  };
  const missing = getExports(originalContent).filter((e) => !getExports(code).includes(e));
  return missing.length > 0
    ? { ok: false, error: `exports removidos: ${missing.join(", ")}` }
    : { ok: true };
}

function validateNoNewDependencies(code) {
  const newRequires = [...code.matchAll(/require\(['"]([^./][^'"]+)['"]\)/g)]
    .map((m) => m[1].split("/")[0]);

  const pkgPath = path.join(NINA_ROOT, "package.json");
  if (!fs.existsSync(pkgPath)) return { ok: true };

  const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf-8"));
  const installed = Object.keys({ ...pkg.dependencies, ...pkg.devDependencies });
  const builtins  = ["fs", "path", "os", "crypto", "child_process", "http", "https",
                     "net", "events", "stream", "util", "url", "querystring", "buffer",
                     "assert", "readline", "timers", "perf_hooks"];

  const missing = newRequires.filter((r) => !installed.includes(r) && !builtins.includes(r));
  return missing.length > 0
    ? { ok: false, error: `pacotes não instalados: ${missing.join(", ")}` }
    : { ok: true };
}

function validateCodeStructure(code, originalContent) {
  if (/^import\s+/m.test(code) || /^export\s+(default|const|function|class)/m.test(code))
    return { ok: false, error: "código usa ES modules — use CommonJS" };

  if (code.includes("```"))
    return { ok: false, error: "markdown vazado no código (backticks)" };

  const firstLine = code.split("\n")[0].trim();
  const validStart = firstLine.startsWith("//") || firstLine.startsWith("/*")
    || firstLine.startsWith("const") || firstLine.startsWith("'use strict'")
    || firstLine.startsWith('"use strict"') || firstLine.startsWith("let ")
    || firstLine.startsWith("var ") || firstLine.startsWith("process")
    || firstLine.startsWith("module");
  if (!validStart && firstLine.length > 0)
    return { ok: false, error: `arquivo não começa com código: "${firstLine.slice(0, 60)}"` };

  // Detecta truncagem ("// resto do código aqui" ou similar)
  const truncationPatterns = [
    /\/\/\s*(resto|rest of|remaining|...|continua|continue)/i,
    /\/\*\s*\.\.\.\s*\*\//,
    /\/\/\s*\[código anterior\]/i,
  ];
  for (const pattern of truncationPatterns) {
    if (pattern.test(code))
      return { ok: false, error: "código truncado detectado (placeholder de continuação)" };
  }

  if (/module\.exports/.test(originalContent) && !/module\.exports/.test(code))
    return { ok: false, error: "module.exports ausente — possível truncagem" };

  return { ok: true };
}

function validateMinSize(code, originalContent) {
  const origLines = originalContent.split("\n").length;
  const newLines  = code.split("\n").length;
  if (newLines < Math.max(5, origLines * 0.5))
    return { ok: false, error: `código muito pequeno: ${newLines} linhas vs ${origLines} originais` };
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

function recordImprovement(entry) {
  const history = loadHistory();
  history.unshift(entry);
  if (history.length > 50) history.pop();
  fs.writeFileSync(IMPROVEMENTS_FILE, JSON.stringify(history, null, 2));
}

function getImprovementHistory(limit = 10) {
  const history = loadHistory();
  if (!history.length) return "nenhuma melhoria registrada ainda.";
  return history.slice(0, limit).map((h) => {
    const date   = new Date(h.timestamp).toLocaleString("pt-BR");
    const status = h.success ? `✓ sucesso (${h.diff || ""})` : `✗ falhou: ${h.failReason}`;
    return `[${date}] ${h.file}\n  ${h.instruction.slice(0, 70)}\n  ${status}`;
  }).join("\n\n");
}

// ── Pipeline principal ────────────────────────────────────────

const MAX_ATTEMPTS = 3;

async function improveFile(targetFile, instruction, opts = {}) {
  const { skipIdleCheck = false, dryRun = false } = opts;
  const basename = path.basename(targetFile);
  const fullPath = path.join(NINA_SRC, basename);

  if (!fs.existsSync(fullPath))
    return `arquivo não encontrado: ${basename}`;

  if (!skipIdleCheck && !isIdleEnough())
    return "aguardando inatividade para aplicar melhoria (2 min sem mensagem). tente: 'melhora agora [arquivo] [instrução]'";

  const originalContent = fs.readFileSync(fullPath, "utf-8");
  let backupPath = null;

  log.info("Improve", `iniciando melhoria de ${basename}`);
  log.info("Improve", `instrução: ${instruction}`);

  // Leitura de contexto
  const context  = readRelevantContext(basename);
  const depCount = Object.keys(context).length;
  log.debug("Improve", `contexto: ${depCount} arquivo(s)`);

  // Módulos com erros recentes (para priorizar)
  const modErrors = getModuleErrors(basename.replace(".js", ""));
  if (modErrors.length > 0) {
    log.info("Improve", `${modErrors.length} erro(s) recente(s) encontrado(s) para ${basename}`);
  }

  // Tentativas com estratégias progressivamente mais conservadoras
  let code = null;
  let lastError = null;

  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    if (attempt > 0) {
      log.warn("Improve", `tentativa ${attempt + 1}/${MAX_ATTEMPTS}...`);
      await new Promise((r) => setTimeout(r, 2000));
    }

    const result = await generateImprovement(fullPath, instruction, context, attempt);
    if (result.error) {
      lastError = result.error;
      continue;
    }

    const generated = result.code;

    // Validações em cadeia — para na primeira falha
    const checks = [
      ["tamanho", validateMinSize(generated, originalContent)],
      ["sintaxe", validateSyntax(generated)],
      ["exports", validateExports(generated, originalContent)],
      ["dependências", validateNoNewDependencies(generated)],
      ["estrutura", validateCodeStructure(generated, originalContent)],
    ];

    const failed = checks.find(([, r]) => !r.ok);
    if (failed) {
      lastError = `${failed[0]}: ${failed[1].error}`;
      log.warn("Improve", `tentativa ${attempt + 1} rejeitada — ${lastError}`);
      continue;
    }

    // Código passou em todas as validações
    code = generated;
    break;
  }

  if (!code) {
    recordImprovement({
      timestamp: new Date().toISOString(), file: basename, instruction,
      success: false, failReason: lastError || "todas as tentativas falharam", backupPath: null,
    });
    return `melhoria rejeitada após ${MAX_ATTEMPTS} tentativas.\núltimo erro: ${lastError}\nnenhuma alteração foi feita.`;
  }

  // Modo preview (dry run)
  const diff = generateDiff(originalContent, code);
  if (dryRun) {
    return `preview da melhoria em ${basename}:\n${diff.summary}\nnenhuma alteração aplicada (dry run).`;
  }

  // Backup
  try {
    backupPath = createBackup(fullPath);
    log.info("Improve", `backup: ${path.basename(backupPath)}`);
  } catch (err) {
    return `erro ao criar backup: ${err.message} — melhoria cancelada por segurança`;
  }

  // Aplica
  try {
    fs.writeFileSync(fullPath, code, "utf-8");
  } catch (err) {
    return `erro ao escrever arquivo: ${err.message}`;
  }

  // Verificação final no arquivo real
  const finalCheck = validateSyntax(code);
  if (!finalCheck.ok) {
    restoreBackup(backupPath, fullPath);
    recordImprovement({
      timestamp: new Date().toISOString(), file: basename, instruction,
      success: false, failReason: `falha pós-escrita: ${finalCheck.error}`, backupPath,
    });
    return `rollback executado — sintaxe inválida no arquivo final.\nbackup restaurado: ${path.basename(backupPath)}`;
  }

  // Sucesso
  recordImprovement({
    timestamp: new Date().toISOString(), file: basename, instruction,
    success: true, backupPath, diff: diff.summary,
    linesOriginal: originalContent.split("\n").length,
    linesNew: code.split("\n").length,
  });

  logDecision({
    category: "tool", action: `self-improvement: ${basename}`,
    reason: instruction, result: diff.summary,
    urgency: "info", triggered_by: "user",
  });

  // Limpeza de backups antigos (oportunista, não bloqueia)
  setImmediate(cleanOldBackups);

  log.info("Improve", `sucesso em ${basename} — ${diff.summary}`);

  return [
    `melhoria aplicada em ${basename}`,
    `mudança: ${diff.summary}`,
    `backup: ${path.basename(backupPath)}`,
    `reinicia pra ativar? (diz "reinicia" ou "restart")`,
  ].join("\n");
}

// ── Auto-melhoria guiada por erros ────────────────────────────
// Chama improveFile automaticamente quando um módulo tem muitos erros

async function autoImproveIfNeeded(sendFn) {
  const top = getTopErrorModules(1);
  if (!top.length) return;

  const { mod, count, last } = top[0];
  if (count < 5) return; // só age com 5+ erros acumulados
  if (!isIdleEnough()) return;

  const targetFile = `${mod}.js`;
  const fullPath   = path.join(NINA_SRC, targetFile);
  if (!fs.existsSync(fullPath)) return;

  log.info("Improve", `auto-melhoria acionada para ${targetFile} (${count} erros, último: ${last})`);

  const instruction = `Corrija o seguinte problema recorrente: "${last}". Este erro aconteceu ${count} vezes recentemente. Foque em tornar o módulo mais robusto contra este tipo de falha.`;

  const result = await improveFile(targetFile, instruction, { skipIdleCheck: true });

  if (sendFn) {
    sendFn(`🔧 auto-melhoria em ${targetFile}\n${result}`).catch(() => {});
  }

  // Limpa o contador de erros após tentar corrigir
  errorLog[mod] = [];
  try { fs.writeFileSync(ERROR_TRACKER_FILE, JSON.stringify(errorLog, null, 2)); } catch {}
}

// ── Rollback manual ───────────────────────────────────────────

async function rollbackFile(targetFile) {
  const basename = path.basename(targetFile);
  const backups  = fs.readdirSync(BACKUP_DIR)
    .filter((f) => f.startsWith(basename + ".") && f.endsWith(".bak"))
    .sort().reverse();

  if (!backups.length) return `nenhum backup encontrado para ${basename}`;

  const latest = backups[0];
  restoreBackup(path.join(BACKUP_DIR, latest), path.join(NINA_SRC, basename));

  logDecision({
    category: "tool", action: `rollback: ${basename}`,
    reason: `restaurado de ${latest}`, urgency: "importante", triggered_by: "user",
  });

  log.info("Improve", `rollback: ${basename} ← ${latest}`);
  return `rollback executado: ${basename}\nrestaurado de: ${latest}`;
}

function listBackups(targetFile = null) {
  const all = fs.readdirSync(BACKUP_DIR)
    .filter((f) => f.endsWith(".bak") && (!targetFile || f.startsWith(path.basename(targetFile) + ".")))
    .sort().reverse().slice(0, 20);

  if (!all.length) return "nenhum backup encontrado";
  return all.map((f) => {
    const size = fs.statSync(path.join(BACKUP_DIR, f)).size;
    return `${f} (${(size / 1024).toFixed(1)}KB)`;
  }).join("\n");
}

// ── Status do sistema de self-improvement ────────────────────

function getSelfImproveStatus() {
  const history  = loadHistory();
  const success  = history.filter((h) => h.success).length;
  const failed   = history.filter((h) => !h.success).length;
  const topErrs  = getTopErrorModules(3);
  const idle     = isIdleEnough();

  const lines = [
    `melhorias aplicadas: ${success} sucessos, ${failed} falhas`,
    `status: ${idle ? "pronto para melhorar" : "aguardando inatividade (2 min)"}`,
  ];

  if (history.length > 0) {
    const last = history[0];
    const date = new Date(last.timestamp).toLocaleString("pt-BR");
    lines.push(`última: ${date} — ${last.file} (${last.success ? "✓" : "✗"})`);
  }

  if (topErrs.length > 0) {
    lines.push(`módulos com erros recentes:`);
    topErrs.forEach(({ mod, count }) => lines.push(`  - ${mod}.js: ${count} erros`));
  }

  return lines.join("\n");
}

module.exports = {
  improveFile,
  rollbackFile,
  listBackups,
  getImprovementHistory,
  readRelevantContext,
  trackError,
  getModuleErrors,
  autoImproveIfNeeded,
  getSelfImproveStatus,
  setActivityGetter,
};
