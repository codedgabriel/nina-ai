// ============================================================
//  Nina v4 — Skills Dinâmicas
//
//  Sistema de aprendizado em runtime — dois níveis:
//
//  NÍVEL 1: Skills (instantâneo, sem reiniciar)
//  ─────────────────────────────────────────────
//  A Nina escreve um script Python/Node/Bash e o registra
//  como "skill". Da próxima vez que precisar dessa capacidade,
//  chama o script diretamente via run_skill.
//  Disponível imediatamente após criação.
//
//  NÍVEL 2: Tools nativas (hot-reload)
//  ─────────────────────────────────────
//  A Nina escreve uma tool completa (definição JSON + executor JS)
//  e a registra no sistema. O cliente DeepSeek é recarregado
//  com as novas tools — sem derrubar o WhatsApp.
//  Disponível após hot-reload (~2s).
//
//  Persistência: nina-skills.json
//  Skills ficam disponíveis entre reinicializações.
// ============================================================

const fs   = require("fs");
const path = require("path");
const os   = require("os");
const { runCommand } = require("./shell");
const { SCRIPTS_DIR, LOGS_DIR } = require("./config");

const SKILLS_FILE    = "./nina-skills.json";
const SKILLS_DIR     = path.join(os.homedir(), "nina-files", "skills");
const NATIVE_TOOLS_FILE = "./nina-native-tools.json";

fs.mkdirSync(SKILLS_DIR, { recursive: true });

// ── Carrega skills salvas ─────────────────────────────────────

function loadSkills() {
  try {
    if (fs.existsSync(SKILLS_FILE)) {
      return JSON.parse(fs.readFileSync(SKILLS_FILE, "utf-8"));
    }
  } catch {}
  return [];
}

function saveSkills(skills) {
  fs.writeFileSync(SKILLS_FILE, JSON.stringify(skills, null, 2), "utf-8");
}

let skills = loadSkills();

// ── NÍVEL 1: Skills (scripts reutilizáveis) ───────────────────

/**
 * Registra uma nova skill.
 * Uma skill é um script salvo com metadados pra Nina saber quando usar.
 */
function registerSkill(opts) {
  const {
    name,         // identificador único, ex: "consultar_cnpj"
    description,  // quando usar essa skill
    code,         // código do script
    lang,         // python | bash | node
    args_schema,  // como passar argumentos, ex: "CNPJ como $1"
    example,      // exemplo de chamada
    dependencies, // pacotes necessários (opcional)
    author = "nina",
  } = opts;

  // Verifica se já existe
  const existing = skills.findIndex((s) => s.name === name);

  const filename = `skill_${name}.${lang === "python" ? "py" : lang === "node" ? "js" : "sh"}`;
  const filepath = path.join(SKILLS_DIR, filename);

  // Salva o script
  fs.writeFileSync(filepath, code, "utf-8");
  if (lang === "bash") fs.chmodSync(filepath, "755");

  const skill = {
    name,
    description,
    lang,
    filepath,
    codeHash: opts.codeHash || null,
    args_schema: args_schema || "",
    example:     example || "",
    dependencies: dependencies || [],
    author,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    callCount: existing >= 0 ? skills[existing].callCount : 0,
    lastCalled: existing >= 0 ? skills[existing].lastCalled : null,
  };

  if (existing >= 0) {
    skills[existing] = skill;
  } else {
    skills.push(skill);
  }

  saveSkills(skills);
  console.log(`[Skills] Skill "${name}" registrada: ${filepath}`);
  return skill;
}

/**
 * Executa uma skill pelo nome, passando argumentos.
 */
async function runSkill(name, args = "") {
  const skill = skills.find((s) => s.name === name);
  if (!skill) return `skill "${name}" não encontrada. use list_skills pra ver as disponíveis.`;

  // Instala dependências se necessário
  if (skill.dependencies?.length > 0 && skill.lang === "python") {
    const missing = [];
    for (const dep of skill.dependencies) {
      const { error } = await runCommand(`python3 -c "import ${dep}" 2>/dev/null`);
      if (error) missing.push(dep);
    }
    if (missing.length > 0) {
      console.log(`[Skills] Instalando deps: ${missing.join(", ")}`);
      await runCommand(`pip3 install ${missing.join(" ")} --break-system-packages --quiet`);
    }
  }

  const runners = { python: "python3", bash: "bash", node: "node" };
  const runner  = runners[skill.lang] || "bash";
  const cmd     = `${runner} "${skill.filepath}" ${args} 2>&1`;

  const logPath = path.join(LOGS_DIR, `skill_${name}.log`);
  const { output, error } = await runCommand(cmd, 120_000);

  // Log da execução
  const entry = `[${new Date().toISOString()}] args: ${args}\n${output || error}\n${"─".repeat(40)}\n`;
  fs.appendFileSync(logPath, entry);

  // Atualiza stats
  const idx = skills.findIndex((s) => s.name === name);
  if (idx >= 0) {
    skills[idx].callCount  = (skills[idx].callCount || 0) + 1;
    skills[idx].lastCalled = new Date().toISOString();
    saveSkills(skills);
  }

  const result = output || error || "(sem output)";
  return result.length > 3000 ? result.slice(0, 3000) + "\n...(truncado)" : result;
}

function listSkills() {
  if (skills.length === 0) return "nenhuma skill registrada ainda.";
  return skills.map((s) => {
    const calls = s.callCount > 0 ? ` | usada ${s.callCount}x` : "";
    const last  = s.lastCalled ? ` | última: ${s.lastCalled.slice(0, 10)}` : "";
    return `[${s.lang}] ${s.name}\n  ${s.description}\n  exemplo: ${s.example || "—"}${calls}${last}`;
  }).join("\n\n");
}

function removeSkill(name) {
  const idx = skills.findIndex((s) => s.name === name);
  if (idx < 0) return false;
  try { fs.unlinkSync(skills[idx].filepath); } catch {}
  skills.splice(idx, 1);
  saveSkills(skills);
  return true;
}

function getSkill(name) {
  return skills.find((s) => s.name === name) || null;
}

// ── NÍVEL 2: Tools nativas dinâmicas (hot-reload) ────────────

/**
 * Registra uma tool nativa no formato que o DeepSeek entende.
 * Exige: definição JSON (pra mandar no prompt) + código JS do executor.
 *
 * O executor JS deve exportar uma função async:
 *   module.exports = async function(args, context) { return "resultado"; }
 */
function loadNativeTools() {
  try {
    if (fs.existsSync(NATIVE_TOOLS_FILE)) {
      return JSON.parse(fs.readFileSync(NATIVE_TOOLS_FILE, "utf-8"));
    }
  } catch {}
  return [];
}

function saveNativeTools(tools) {
  fs.writeFileSync(NATIVE_TOOLS_FILE, JSON.stringify(tools, null, 2), "utf-8");
}

let nativeToolDefs = loadNativeTools();

function registerNativeTool(opts) {
  const {
    name,
    description,
    parameters,    // JSON Schema dos parâmetros
    executor_code, // código JS do executor
  } = opts;

  // Salva o executor como arquivo JS
  const executorPath = path.join(SKILLS_DIR, `tool_${name}.js`);
  const wrappedCode  = `// Auto-gerado pela Nina em ${new Date().toISOString()}\n${executor_code}`;
  fs.writeFileSync(executorPath, wrappedCode, "utf-8");

  // Valida sintaxe do executor
  const { execSync } = require("child_process");
  try {
    execSync(`node --check "${executorPath}"`, { timeout: 5000 });
  } catch (err) {
    fs.unlinkSync(executorPath);
    return { success: false, error: `Sintaxe inválida no executor: ${err.message}` };
  }

  // Registra a definição
  const toolDef = {
    type: "function",
    function: { name, description, parameters: parameters || { type: "object", properties: {} } },
  };

  const existing = nativeToolDefs.findIndex((t) => t.function?.name === name);
  const entry = { def: toolDef, executorPath, createdAt: new Date().toISOString() };

  if (existing >= 0) {
    nativeToolDefs[existing] = entry;
  } else {
    nativeToolDefs.push(entry);
  }

  saveNativeTools(nativeToolDefs);
  console.log(`[Skills] Tool nativa "${name}" registrada.`);
  return { success: true, name, executorPath };
}

/**
 * Executa uma tool nativa dinâmica.
 * Chamado pelo executor quando o toolName não é reconhecido nas tools hardcoded.
 */
async function runNativeTool(name, args, context) {
  const entry = nativeToolDefs.find((t) => t.def?.function?.name === name);
  if (!entry) return null; // não é uma tool nativa, retorna null pra cair no default

  try {
    // Invalida o cache do require pra pegar versão mais recente
    delete require.cache[require.resolve(entry.executorPath)];
    const executor = require(entry.executorPath);
    const fn = typeof executor === "function" ? executor : executor.default || executor.run;
    if (!fn) return `erro: executor de "${name}" não exporta uma função`;

    const result = await fn(args, context);
    return String(result);
  } catch (err) {
    console.error(`[Skills] Erro ao executar tool nativa "${name}":`, err.message);
    return `erro ao executar ${name}: ${err.message}`;
  }
}

/**
 * Retorna as definições de todas as tools nativas pra incluir no prompt.
 */
function getNativeToolDefs() {
  return nativeToolDefs.map((e) => e.def);
}

function listNativeTools() {
  if (nativeToolDefs.length === 0) return "nenhuma tool nativa registrada.";
  return nativeToolDefs.map((e) => {
    const n = e.def?.function;
    return `[tool] ${n?.name}\n  ${n?.description?.slice(0, 100)}`;
  }).join("\n\n");
}

function removeNativeTool(name) {
  const idx = nativeToolDefs.findIndex((t) => t.def?.function?.name === name);
  if (idx < 0) return false;
  try { fs.unlinkSync(nativeToolDefs[idx].executorPath); } catch {}
  nativeToolDefs.splice(idx, 1);
  saveNativeTools(nativeToolDefs);
  return true;
}

module.exports = {
  // Skills (nível 1)
  registerSkill,
  runSkill,
  listSkills,
  removeSkill,
  getSkill,
  // Tools nativas (nível 2)
  registerNativeTool,
  runNativeTool,
  getNativeToolDefs,
  listNativeTools,
  removeNativeTool,
};
