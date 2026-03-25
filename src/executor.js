const log = require("./logger");
// ============================================================
//  Nina v4 — Executor de Ferramentas (Agentic)
// ============================================================

const path = require("path");
const os   = require("os");
const fs   = require("fs");
const axios = require("axios");

const {
  runCommand, getSystemStats, writeCodeFile, readCodeFile,
} = require("./shell");
const { searchWeb }                        = require("./search");
const { saveTextNote, findNotes }          = require("./files");
const { saveReminder, getPendingReminders,
        searchMessages }                   = require("./db");
const { searchVector }                     = require("./vector");
const { getAllContacts, getContactProfile } = require("./contacts");
const { getMessagesByNumber }              = require("./db");
const { sendFile, sendFileFromContent }    = require("./sender");
const { getMonitorStatus, runOptimizationNow } = require("./monitor");
const {
  addWatcher, removeWatcher, pauseWatcher, resumeWatcher,
  listWatchers, runWatcher,
}                                          = require("./watchers");
const {
  agenticBrowse, fetchPageText, closeBrowser,
}                                          = require("./browser");
const {
  checkAutonomy, getBudgetStatus, setBudgetLimit,
  getAutonomyStatus, setAutonomy,
}                                          = require("./budget");
const {
  registerSkill, runSkill, listSkills, removeSkill,
  registerNativeTool, runNativeTool, getNativeToolDefs,
  listNativeTools, removeNativeTool,
}                                          = require("./skills");
const {
  addEmailWatcher, removeEmailWatcher, listEmailWatchers,
}                                          = require("./monitor");
const { logDecision, formatDecisionHistory } = require("./decisions");
const {
  getProactiveStatus, setSilenceThreshold,
  setPatternHour, setMaxContactsPerDay,
}                                          = require("./proactive");
const {
  isConfigured, isAuthenticated, getAuthUrl, exchangeCode,
  listEmails, readEmail, sendEmail, markAsRead,
  listEvents, createEvent, deleteEvent,
}                                          = require("./google");
const { analyzeImageFile }                 = require("./vision");
const {
  updateLocationFromText, saveNamedLocation,
  getCurrentLocation, getNamedLocation,
  estimateTravelTime, getLocationStatus, geocode,
}                                          = require("./location");
const {
  getNotificationStatus, setQuietHours, setCalendarLeadTime,
  enqueue,
}                                          = require("./notifications");
const { buildMemoryContext }               = require("./memory");
const {
  improveFile, rollbackFile, listBackups,
  getImprovementHistory, getSelfImproveStatus,
}                                          = require("./self-improve");
const { SCRIPTS_DIR, LOGS_DIR, SHELL_TIMEOUT, SCRIPT_TIMEOUT } = require("./config");

// Garante que as pastas existam
[SCRIPTS_DIR, LOGS_DIR].forEach((d) => fs.mkdirSync(d, { recursive: true }));

// ── Padrões que pedem confirmação ────────────────────────────
const DANGEROUS_PATTERNS = [
  /\brm\s+-rf\b/, /\brmdir\b/, /\bmkfs\b/, /\bdd\b/,
  /\bshutdown\b/, /\breboot\b/, /\bpoweroff\b/,
  />\s*\/dev\//, /\bsudo\s+rm\b/,
];

function isDangerous(cmd) {
  return DANGEROUS_PATTERNS.some((r) => r.test(cmd));
}

// ── Helpers ───────────────────────────────────────────────────

function resolvePath(p) {
  if (!p) return os.homedir();
  return p.startsWith("/") ? p : path.join(os.homedir(), p);
}

// ── Executor principal ─────────────────────────────────────────

// Função opcional para mandar updates intermediários pro usuário
let _sendProgress = null;
function setSendProgress(fn) { _sendProgress = fn; }

async function executeTool(toolName, toolArgs, context = {}) {
  log.debug("Tool", `${toolName} ${JSON.stringify(toolArgs).slice(0, 150)}`);

  try {
    switch (toolName) {

      // ── run_shell ──────────────────────────────────────────
      case "run_shell": {
        const { cmd, working_dir, timeout_sec } = toolArgs;
        if (!cmd) return "erro: nenhum comando especificado";

        // Autonomy check
        if (isDangerous(cmd)) {
          const a = checkAutonomy("shell_dangerous", cmd);
          if (!a.allowed) {
            if (a.confirm) return `NEEDS_CONFIRMATION:${cmd}`;
            return a.message;
          }
        }

        // Install commands
        if (/\b(apt|npm|pip|pip3|yarn|brew)\s+(install|add)\b/.test(cmd)) {
          const a = checkAutonomy("shell_install", cmd);
          if (!a.allowed) {
            if (a.confirm) return `NEEDS_CONFIRMATION:${cmd}`;
            return a.message;
          }
        }

        // System-level commands
        if (/\b(shutdown|reboot|poweroff|mkfs|fdisk)\b/.test(cmd)) {
          const a = checkAutonomy("shell_system", cmd);
          if (!a.allowed) return a.message;
        }

        const opts = { timeout: (timeout_sec || 60) * 1000 };
        if (working_dir) opts.cwd = resolvePath(working_dir);

        const { output, error } = await runCommand(cmd, opts.timeout, opts.cwd);
        return error ? `Erro: ${error}` : (output || "(sem output)");
      }

      // ── run_script ─────────────────────────────────────────
      case "run_script": {
        const { filename, code, lang, args = "" } = toolArgs;
        if (!filename || !code) return "erro: filename e code são obrigatórios";

        const scriptPath = path.join(SCRIPTS_DIR, filename);
        const logPath    = path.join(LOGS_DIR, filename + ".log");

        // Salva o script
        fs.writeFileSync(scriptPath, code, "utf-8");

        // Define runner
        const runners = { python: "python3", bash: "bash", node: "node" };
        const runner  = runners[lang] || "bash";

        // Torna executável se bash
        if (lang === "bash") {
          await runCommand(`chmod +x "${scriptPath}"`);
        }

        // Executa e captura output
        const cmd = `${runner} "${scriptPath}" ${args} 2>&1`;
        const { output, error } = await runCommand(cmd, SCRIPT_TIMEOUT);

        // Salva log
        const logEntry = `[${new Date().toISOString()}] ${cmd}\n${output || error}\n${"─".repeat(60)}\n`;
        fs.appendFileSync(logPath, logEntry);
        logDecision({ category: "tool", action: `executei script: ${filename}`, reason: `solicitado via run_script`, result: (output || error || "").slice(0, 100), urgency: "info", triggered_by: "user" });

        const result = output || error || "(sem output)";
        return result.length > 3000 ? result.slice(0, 3000) + "\n...(truncado)" : result;
      }

      // ── get_system_stats ───────────────────────────────────
      case "get_system_stats": {
        return await getSystemStats();
      }

      // ── list_processes ─────────────────────────────────────
      case "list_processes": {
        const { filter } = toolArgs;
        const cmd = filter
          ? `ps aux --sort=-%cpu | head -1 && ps aux --sort=-%cpu | grep -i "${filter}" | grep -v grep`
          : `ps aux --sort=-%cpu | head -20`;
        const { output } = await runCommand(cmd);
        return output || "Nenhum processo encontrado";
      }

      // ── kill_process ───────────────────────────────────────
      case "kill_process": {
        const { pid, name, force } = toolArgs;
        const sig = force ? "-9" : "-15";

        if (pid) {
          const { output, error } = await runCommand(`kill ${sig} ${pid}`);
          return error ? `Erro: ${error}` : `Processo ${pid} encerrado`;
        }
        if (name) {
          const cmd = `NEEDS_CONFIRMATION:pkill ${sig} -f "${name}"`;
          return cmd; // sempre pede confirmação para kill por nome
        }
        return "erro: especifica pid ou name";
      }

      // ── read_file ──────────────────────────────────────────
      case "read_file": {
        const { path: filePath, start_line, end_line } = toolArgs;
        const resolved = resolvePath(filePath);

        if (!fs.existsSync(resolved)) return `Arquivo não encontrado: ${resolved}`;

        let content = fs.readFileSync(resolved, "utf-8");

        // Recorte por linhas se pedido
        if (start_line || end_line) {
          const lines = content.split("\n");
          const from  = (start_line || 1) - 1;
          const to    = end_line || lines.length;
          content = lines.slice(from, to).join("\n");
        }

        if (content.length > 4000) {
          return content.slice(0, 8000) + `\n...(truncado — arquivo tem ${content.length} chars)`;
        }
        return content || "(arquivo vazio)";
      }

      // ── write_file ─────────────────────────────────────────
      case "write_file": {
        const { path: filePath, content, append } = toolArgs;
        const resolved = resolvePath(filePath);

        // Block writes to system directories
        if (/^\/(etc|sys|boot|usr|bin|sbin|lib)/.test(resolved)) {
          const a = checkAutonomy("file_system", resolved);
          if (!a.allowed) return a.message;
        }

        fs.mkdirSync(path.dirname(resolved), { recursive: true });

        if (append) {
          fs.appendFileSync(resolved, content, "utf-8");
          return `Conteúdo adicionado em: ${resolved}`;
        }
        fs.writeFileSync(resolved, content, "utf-8");
        return `Arquivo salvo em: ${resolved}`;
      }

      // ── list_dir ───────────────────────────────────────────
      case "list_dir": {
        const { path: dirPath, recursive } = toolArgs;
        const resolved = resolvePath(dirPath || "~");
        const flag = recursive ? "-R" : "-lah";
        const { output } = await runCommand(`ls ${flag} "${resolved}"`);
        return output || "Diretório vazio";
      }

      // ── find_files ─────────────────────────────────────────
      case "find_files": {
        const { pattern, search_dir, content } = toolArgs;
        const dir = resolvePath(search_dir || "~");

        let cmd;
        if (content) {
          cmd = `grep -rl "${content}" "${dir}" 2>/dev/null | head -20`;
        } else {
          cmd = `find "${dir}" -name "${pattern}" 2>/dev/null | head -30`;
        }
        const { output } = await runCommand(cmd, 30_000);
        return output || "Nenhum arquivo encontrado";
      }

      // ── search_web ─────────────────────────────────────────
      case "search_web": {
        const { query } = toolArgs;
        const result = await searchWeb(query);
        return result || "Nenhum resultado encontrado na web.";
      }

      // ── fetch_url ──────────────────────────────────────────
      case "fetch_url": {
        const { url, headers = {} } = toolArgs;
        try {
          const res  = await axios.get(url, { headers, timeout: 15_000 });
          let   data = typeof res.data === "string" ? res.data : JSON.stringify(res.data, null, 2);

          // Remove HTML tags se for página web
          if (typeof res.data === "string" && res.data.includes("<html")) {
            data = data
              .replace(/<script[\s\S]*?<\/script>/gi, "")
              .replace(/<style[\s\S]*?<\/style>/gi, "")
              .replace(/<[^>]+>/g, " ")
              .replace(/\s{2,}/g, " ")
              .trim();
          }

          return data.slice(0, 4000);
        } catch (err) {
          return `Erro ao acessar ${url}: ${err.message}`;
        }
      }

      // ── save_note ──────────────────────────────────────────
      case "save_note": {
        const { title, content, tags } = toolArgs;
        const fullContent = tags ? `${content}\n\nTags: ${tags}` : content;
        saveTextNote(title || "Nota", fullContent);
        return `Nota "${title}" salva.`;
      }

      // ── find_notes ─────────────────────────────────────────
      case "find_notes": {
        const { query } = toolArgs;
        const notes = findNotes(query);
        if (!notes.length) return "Nenhuma nota encontrada.";
        return notes.map((n) => `• ${n.title}:\n${n.content}`).join("\n\n");
      }

      // ── search_memory ──────────────────────────────────────
      case "search_memory": {
        const { query, from_number } = toolArgs;
        let results = await searchVector(query, from_number || null, 6);
        if (!results.length) {
          results = searchMessages(query, from_number || null, 6).map((r) => ({
            text: r.content, role: r.role, created_at: r.created_at,
          }));
        }
        if (!results.length) return "Nada encontrado nas conversas antigas.";
        return results
          .map((r) => `[${r.created_at || "?"}] ${r.role === "user" ? "Usuário" : "Nina"}: ${r.text}`)
          .join("\n");
      }

      // ── set_reminder ───────────────────────────────────────
      case "set_reminder": {
        const { time, text, date, target_name } = toolArgs;
        if (!/^\d{1,2}:\d{2}$/.test(time)) return `Formato inválido: ${time}. Use HH:MM`;
        const [h, m] = time.split(":").map(Number);
        const formatted = `${String(h).padStart(2,"0")}:${String(m).padStart(2,"0")}`;

        // Resolve contato terceiro se especificado
        let targetNumber = null;
        let resolvedName = null;
        if (target_name) {
          const contact = resolveContactNumber(target_name);
          if (!contact) return `Contato "${target_name}" não encontrado. Verifique o nome salvo nos contatos.`;
          targetNumber = contact.number;
          resolvedName = contact.name;
        }

        saveReminder(text, formatted, date || null, targetNumber, resolvedName);

        if (resolvedName) {
          return `Lembrete salvo para ${resolvedName} às ${formatted}: "${text}"\nVou mandar direto pra ${resolvedName} no WhatsApp na hora certa.`;
        }
        return `Lembrete salvo${date ? ` para ${date}` : ""} às ${formatted}: "${text}"`;
      }

      // ── list_reminders ─────────────────────────────────────
      case "list_reminders": {
        const pending = getPendingReminders();
        if (!pending.length) return "Nenhum lembrete pendente.";
        return pending
          .map((r) => `• ${r.remind_at}${r.remind_date ? ` (${r.remind_date})` : ""} — ${r.text}`)
          .join("\n");
      }

      // ── schedule_script ────────────────────────────────────
      case "schedule_script": {
        const { name, cron_expr, script_path, description } = toolArgs;
        const resolved = resolvePath(script_path);

        // Adiciona ao crontab
        const cronLine = `${cron_expr} ${resolved} >> ${path.join(LOGS_DIR, name + ".log")} 2>&1`;
        const addCmd   = `(crontab -l 2>/dev/null | grep -v "${name}"; echo "# Nina:${name} ${description || ""}"; echo "${cronLine}") | crontab -`;
        const { error } = await runCommand(addCmd);

        return error
          ? `Erro ao agendar: ${error}`
          : `Tarefa "${name}" agendada: ${cron_expr}\nScript: ${resolved}`;
      }

      // ── get_contact_info ───────────────────────────────────
      case "get_contact_info": {
        const { name } = toolArgs;
        const contacts  = getAllContacts();
        const contact   = contacts.find((c) =>
          c.name && c.name.toLowerCase().includes(name.toLowerCase())
        );
        if (!contact) return `Contato "${name}" não encontrado.`;

        const profile = getContactProfile(contact);
        const msgs    = getMessagesByNumber(contact.number, 10).filter((m) => m.role === "user");
        let result    = profile || `Nome: ${contact.name}`;
        if (msgs.length) {
          result += `\n\nÚltimas mensagens:\n` + msgs.map((m) => `- ${m.content}`).join("\n");
        }
        return result;
      }

      // ── restart_self ───────────────────────────────────────
      case "restart_self": {
        setTimeout(() => process.exit(0), 1000);
        return "Reiniciando em 1 segundo...";
      }

      // ── self_update ────────────────────────────────────────
      case "self_update": {
        const { repo_path } = toolArgs;
        const dir = repo_path ? resolvePath(repo_path) : path.join(os.homedir(), "nina-ai");

        if (!fs.existsSync(path.join(dir, ".git"))) {
          return `Nenhum repositório git encontrado em: ${dir}`;
        }

        const { output, error } = await runCommand(`cd "${dir}" && git pull`, 30_000);
        if (error) return `Erro no git pull: ${error}`;

        // Reinicia após update
        setTimeout(() => process.exit(0), 2000);
        return `Update concluído:\n${output}\n\nReiniciando...`;
      }

      // ── get_monitor_status ─────────────────────────────────
      case "get_monitor_status": {
        return getMonitorStatus();
      }

      // ── run_optimization ───────────────────────────────────
      case "run_optimization": {
        const result = await runOptimization();
        return result;
      }

            // ── send_file ───────────────────────────────────────────
      case "send_file": {
        const { filename, file_path, content: fileContent, caption = "" } = toolArgs;
        const { fromNumber } = context;

        if (file_path) {
          const resolved = resolvePath(file_path);
          await sendFile(fromNumber, resolved, caption || `Aqui está: ${filename}`);
          return `Arquivo "${filename}" enviado.`;
        }

        if (fileContent) {
          await sendFileFromContent(fromNumber, filename, fileContent, caption || `Aqui está: ${filename}`);
          return `Arquivo "${filename}" criado e enviado.`;
        }

        return "erro: precisa de file_path ou content";
      }

      // ── get_monitor_status ────────────────────────────────
      case "get_monitor_status": {
        return getMonitorStatus();
      }

      // ── run_optimization_now ──────────────────────────────
      case "run_optimization_now": {
        await runOptimizationNow();
        return "otimização executada";
      }

      // ── get_memory_context ────────────────────────────────
      case "get_memory_context": {
        const { query } = toolArgs;
        const { fromNumber } = context;
        const memCtx = await buildMemoryContext(query || "contexto geral", fromNumber, context.contact);
        const parts = [memCtx.facts, memCtx.summaries, memCtx.semanticMemory].filter(Boolean);
        return parts.join("\n\n") || "Nenhum contexto de memória disponível ainda.";
      }

      // ── add_watcher ──────────────────────────────────────
      case "add_watcher": {
        const w = addWatcher(toolArgs);
        logDecision({ category: "watcher", action: `criou watcher: ${toolArgs.description}`, reason: toolArgs.condition, urgency: "info", triggered_by: "user" });
        return `Watcher criado [${w.id}]\n"${w.description}"\ntipo: ${w.type} | a cada: ${w.interval}\nalvo: ${w.target}`;
      }

      case "list_watchers": {
        return listWatchers();
      }

      case "remove_watcher": {
        const ok = removeWatcher(toolArgs.id);
        return ok ? `Watcher ${toolArgs.id} removido.` : `Watcher ${toolArgs.id} não encontrado.`;
      }

      case "pause_watcher": {
        const ok = pauseWatcher(toolArgs.id);
        return ok ? `Watcher ${toolArgs.id} pausado.` : `Watcher ${toolArgs.id} não encontrado.`;
      }

      case "resume_watcher": {
        const ok = resumeWatcher(toolArgs.id);
        return ok ? `Watcher ${toolArgs.id} reativado.` : `Watcher ${toolArgs.id} não encontrado.`;
      }

      case "check_watcher_now": {
        const { id } = toolArgs;
        const w = require("./watchers").loadWatcherById
          ? require("./watchers").loadWatcherById(id)
          : null;
        // Busca o watcher direto do arquivo
        const fs2 = require("fs");
        let ws = [];
        try { ws = JSON.parse(fs2.readFileSync("./nina-watchers.json","utf-8")); } catch {}
        const found = ws.find((x) => x.id === id);
        if (!found) return `Watcher ${id} não encontrado.`;
        await runWatcher(found);
        return `Verificação de "${found.description}" executada.`;
      }

      // ── browser_task ──────────────────────────────────────
      case "browser_task": {
        const { task, max_steps = 15, start_url } = toolArgs;

        // Check if task involves auth or purchase
        const taskLower = task.toLowerCase();
        if (/login|senha|password|credential|entrar|acessar conta/.test(taskLower)) {
          const a = checkAutonomy("browser_auth", task.slice(0, 80));
          if (!a.allowed) {
            if (a.confirm) return `NEEDS_CONFIRMATION:browser_auth:${task}`;
            return a.message;
          }
        }
        if (/compra|pagar|checkout|cartão|pagamento|purchase|buy/.test(taskLower)) {
          const a = checkAutonomy("browser_purchase", task.slice(0, 80));
          if (!a.allowed) {
            if (a.confirm) return `NEEDS_CONFIRMATION:browser_purchase:${task}`;
            return a.message;
          }
        }
        const { fromNumber } = context;

        // Manda update inicial
        const sendUpdate = _sendProgress
          ? (txt) => _sendProgress(fromNumber, txt)
          : null;

        const fullTask = start_url ? `Começa em ${start_url}. ${task}` : task;

        logDecision({ category: "tool", action: `browser_task: ${task.slice(0, 80)}`, urgency: "info", triggered_by: "user" });
        const result = await agenticBrowse(fullTask, {
          max_steps: Math.min(max_steps, 30),
          send_updates: sendUpdate,
        });

        return result.length > 3000 ? result.slice(0, 3000) + "\n...(truncado)" : result;
      }

      case "browser_fetch": {
        const { url } = toolArgs;
        const result = await fetchPageText(url);
        return result.length > 3000 ? result.slice(0, 3000) + "\n...(truncado)" : result;
      }

      case "browser_close": {
        await closeBrowser();
        return "browser fechado";
      }

      // ── get_budget_status ─────────────────────────────────
      case "get_budget_status": {
        return getBudgetStatus();
      }

      case "set_budget_limit": {
        const { usd } = toolArgs;
        return setBudgetLimit(parseFloat(usd));
      }

      case "get_autonomy_status": {
        return getAutonomyStatus();
      }

      case "set_autonomy": {
        const { category, level } = toolArgs;
        return setAutonomy(category, level);
      }

      // ── Skills (nível 1) ──────────────────────────────────
      case "learn_skill": {
        const skill = registerSkill(toolArgs);
        logDecision({ category: "skill", action: `aprendi skill: ${toolArgs.name}`, reason: "learn_skill chamado", urgency: "info", triggered_by: "user" });
        return `skill "${skill.name}" aprendida e salva em ${skill.filepath}\nlinguagem: ${skill.lang}\npara usar: run_skill("${skill.name}", "argumentos")`;
      }

      case "run_skill": {
        const { name, args = "" } = toolArgs;
        return await runSkill(name, args);
      }

      case "list_skills": {
        return listSkills();
      }

      case "remove_skill": {
        const ok = removeSkill(toolArgs.name);
        return ok ? `skill "${toolArgs.name}" removida.` : `skill "${toolArgs.name}" não encontrada.`;
      }

      // ── Tools nativas (nível 2) ────────────────────────────
      case "learn_native_tool": {
        const result = registerNativeTool(toolArgs);
        if (!result.success) return `erro ao registrar tool: ${result.error}`;
        logDecision({ category: "skill", action: `registrei tool nativa: ${toolArgs.name}`, urgency: "info", triggered_by: "user" });
        return `tool nativa "${result.name}" registrada.\nexecutor: ${result.executorPath}\ndisponível imediatamente via hot-reload.`;
      }

      case "list_native_tools": {
        return listNativeTools();
      }

      case "remove_native_tool": {
        const ok = removeNativeTool(toolArgs.name);
        return ok ? `tool "${toolArgs.name}" removida.` : `tool "${toolArgs.name}" não encontrada.`;
      }

      // ── Gmail ────────────────────────────────────────────
      case "gmail_list": {
        const { query = "is:unread", maxResults = 10 } = toolArgs;
        return await listEmails({ query, maxResults });
      }

      case "gmail_read": {
        return await readEmail(toolArgs.message_id);
      }

      case "gmail_send": {
        const a = checkAutonomy("network_external", `email para ${toolArgs.to}`);
        if (!a.allowed) {
          if (a.confirm) return `NEEDS_CONFIRMATION:gmail_send:${JSON.stringify(toolArgs)}`;
          return a.message;
        }
        return await sendEmail(toolArgs);
      }

      case "gmail_mark_read": {
        return await markAsRead(toolArgs.message_id);
      }

      // ── Calendar ──────────────────────────────────────────
      case "calendar_list": {
        const { days = 7, maxResults = 20 } = toolArgs;
        return await listEvents({ days, maxResults });
      }

      case "calendar_create": {
        return await createEvent(toolArgs);
      }

      case "calendar_delete": {
        return await deleteEvent(toolArgs.event_id);
      }

      // ── Finanças autônomas ───────────────────────────────────────
      case "finance_create_strategy": {
        const strategy = addStrategy(toolArgs);
        const end = new Date(strategy.projectedEnd).toLocaleDateString("pt-BR");
        return [
          `estratégia criada: "${strategy.name}"`,
          `tipo: ${strategy.type} | ativos: ${strategy.assets.join(", ")}`,
          `orçamento: $${strategy.total_budget || "—"} | frequência: ${strategy.frequency || "—"}`,
          `horizonte: ${strategy.horizon_months} meses (até ~${end})`,
          `id: ${strategy.id}`,
          `\nvou executar automaticamente sem precisar ser chamada.`,
          strategy.total_budget ? `só te contato quando algo importante acontecer ou no relatório semanal.` : "",
        ].filter(Boolean).join("\n");
      }

      case "finance_status": {
        return getFinanceStatus();
      }

      case "finance_report": {
        return await generateReport();
      }

      case "finance_defi_rates": {
        const rates = await getBestYield(toolArgs.asset || null);
        if (!rates.length) return "sem dados de yield disponíveis no momento";
        const lines = ["melhores yields agora:\n"];
        for (const r of rates.slice(0, 10)) {
          lines.push(`  ${r.asset} no ${r.platform}: ${r.supply_apy}% a.a. (supply)`);
        }
        return lines.join("\n");
      }

      case "finance_binance_balance": {
        const balances = await getBinanceBalance();
        if (!balances.length) return "saldo zero ou Binance não configurada";
        return balances.map((b) => `${b.asset}: ${b.free} (livre) + ${b.locked} (bloqueado)`).join("\n");
      }

      case "finance_binance_buy": {
        const { asset, usd_amount } = toolArgs;
        const order = await placeBinanceOrder(asset, "BUY", usd_amount);
        return `compra executada: ${order.qty} ${asset} @ $${order.price.toFixed(2)} (total: $${usd_amount})\norderId: ${order.orderId}`;
      }

      case "finance_pause_strategy": {
        return pauseStrategy(toolArgs.id);
      }

      case "finance_resume_strategy": {
        return resumeStrategy(toolArgs.id);
      }

      // ── Capacidades dinâmicas ────────────────────────────────────
      case "caps_status": {
        return getCapabilitiesStatus();
      }

      case "caps_detect_hardware": {
        const hw = await detectHardware();
        await updateHardware("detecção automática", hw);
        const parts = Object.entries(hw).map(([k,v]) => `${k}: ${v}`).join("\n");
        return `Hardware detectado:\n${parts}\n\nThresholds recalibrados automaticamente.`;
      }

      case "caps_update_hardware": {
        const { description, ...hwFields } = toolArgs;
        const hw = Object.fromEntries(
          Object.entries(hwFields).filter(([,v]) => v !== undefined && v !== null)
        );
        const result = await updateHardware(description, Object.keys(hw).length > 0 ? hw : null);
        return `Hardware atualizado: ${description}\n\nNovos thresholds:\n${Object.entries(result.tuning).map(([k,v]) => `  ${k}: ${v}`).join("\n")}`;
      }

      case "caps_register_api": {
        return await registerAPI(toolArgs);
      }

      case "caps_update_tuning": {
        return updateTuning(toolArgs.key, toolArgs.value);
      }

      // ── Self-improvement ──────────────────────────────────────
      case "improve_self": {
        const { file, instruction, dry_run = false, skip_idle_check = false } = toolArgs;
        if (!file || !instruction) return "erro: 'file' e 'instruction' são obrigatórios";
        log.info("Improve", `${file} — ${instruction.slice(0, 80)}`);
        return await improveFile(file, instruction, { dryRun: dry_run, skipIdleCheck: skip_idle_check });
      }

      case "rollback_self": {
        if (!toolArgs.file) return "erro: 'file' é obrigatório";
        return await rollbackFile(toolArgs.file);
      }

      case "list_backups": {
        return listBackups(toolArgs.file || null);
      }

      case "get_improvement_history": {
        return getImprovementHistory(toolArgs.limit || 10);
      }

      case "self_improve_status": {
        return getSelfImproveStatus();
      }

      // ── IoT ──────────────────────────────────────────────────
      case "iot_register": {
        const device = registerDevice(toolArgs);
        return `Dispositivo registrado: ${device.name} (${device.type})\nID: ${device.id}\nProtocolo: ${device.protocol}\nHost: ${device.host || device.ssh_host || "—"}`;
      }

      case "iot_list": {
        return listDevices();
      }

      case "iot_ping": {
        const { name } = toolArgs;
        return name ? await pingDevice(name) : await pingAll();
      }

      case "iot_snapshot": {
        const { name } = toolArgs;
        const { fromNumber } = context;
        const result = await captureSnapshot(name);
        if (result.error) return `erro: ${result.error}`;

        // Envia a foto capturada no WhatsApp
        const { sendFile } = require("./sender");
        await sendFile(fromNumber, result.filepath, `snapshot: ${result.device}`);
        return `snapshot capturado e enviado: ${result.filename}`;
      }

      case "iot_read_sensor": {
        return await readSensor(toolArgs.name);
      }

      case "iot_control": {
        return await controlRelay(toolArgs.name, toolArgs.action);
      }

      case "iot_remove": {
        const ok = removeDevice(toolArgs.name);
        return ok ? `Dispositivo "${toolArgs.name}" removido.` : `Dispositivo "${toolArgs.name}" não encontrado.`;
      }

      // ── Histórico de decisões ─────────────────────────────
      case "get_decision_history": {
        const { days = 7, category = null } = toolArgs;
        return formatDecisionHistory(days, category);
      }

      // ── Sistema proativo ──────────────────────────────────
      case "get_proactive_status": {
        return getProactiveStatus();
      }

      case "set_proactive_config": {
        const results = [];
        const { silence_threshold_hours, pattern_hour, max_contacts_per_day } = toolArgs;
        if (silence_threshold_hours) results.push(setSilenceThreshold(silence_threshold_hours));
        if (pattern_hour !== undefined) results.push(setPatternHour(pattern_hour));
        if (max_contacts_per_day) results.push(setMaxContactsPerDay(max_contacts_per_day));
        return results.join("\n") || "nenhuma configuração alterada";
      }

      // ── Localização ──────────────────────────────────────
      case "get_location": {
        return getLocationStatus();
      }

      case "set_location": {
        const { text, label } = toolArgs;
        const geo = await updateLocationFromText(text);
        if (!geo) return `não consegui geocodificar: "${text}"`;
        if (label) {
          await saveNamedLocation(label, text);
          return `localização "${label}" salva: ${geo.name}`;
        }
        return `localização atualizada: ${geo.name}`;
      }

      case "estimate_travel": {
        const { from: fromText, to: toText, mode = "driving" } = toolArgs;

        // Resolve origem
        let fromLoc;
        if (!fromText || fromText === "atual") {
          fromLoc = getCurrentLocation();
          if (!fromLoc) return "localização atual não definida. manda sua localização ou diz onde está.";
        } else {
          fromLoc = getNamedLocation(fromText) || await geocode(fromText);
          if (!fromLoc) return `não consegui encontrar: "${fromText}"`;
        }

        // Resolve destino
        const toLoc = getNamedLocation(toText) || await geocode(toText);
        if (!toLoc) return `não consegui encontrar: "${toText}"`;

        const travel = estimateTravelTime(fromLoc, toLoc, mode);
        return `de ${fromLoc.name} → ${toLoc.name}\n${travel.km}km | ~${travel.minutes}min (${mode})\n(estimativa — sem tráfego em tempo real)`;
      }

      // ── Notificações ──────────────────────────────────────
      case "get_notification_status": {
        return getNotificationStatus();
      }

      case "set_quiet_hours": {
        return setQuietHours(toolArgs.start, toolArgs.end);
      }

      case "set_calendar_lead": {
        return setCalendarLeadTime(toolArgs.minutes);
      }

      // ── Email Watchers ────────────────────────────────────
      case "email_watcher_add": {
        const w = addEmailWatcher(toolArgs);
        return `watcher de email criado [${w.id}]\n"${w.description}"\nquery: ${w.query} | a cada: ${w.interval}`;
      }

      case "email_watcher_list": {
        return listEmailWatchers();
      }

      case "email_watcher_remove": {
        removeEmailWatcher(toolArgs.id);
        return `watcher ${toolArgs.id} removido`;
      }

      // ── Google Auth ───────────────────────────────────────
      case "google_auth_status": {
        if (!isConfigured()) return "GOOGLE_CLIENT_ID e GOOGLE_CLIENT_SECRET não configurados.\nVeja o README para instruções de setup.";
        if (!isAuthenticated()) return "Google configurado mas não autenticado.\nManda 'conecta google' para iniciar.";
        return "Google autenticado. Gmail e Calendar disponíveis.";
      }

      case "google_auth_connect": {
        if (!isConfigured()) return "Configura GOOGLE_CLIENT_ID e GOOGLE_CLIENT_SECRET primeiro.";
        const url = getAuthUrl();
        return `acessa esse link para autorizar:\n${url}\n\nDepois cola o código aqui com: 'código google: SEU_CODIGO'`;
      }

      case "google_auth_code": {
        await exchangeCode(toolArgs.code);
        return "Google autenticado com sucesso. Gmail e Calendar prontos.";
      }

      // ── Visão ─────────────────────────────────────────────
      case "analyze_image_file": {
        const { filepath, question = "" } = toolArgs;
        return await analyzeImageFile(filepath, question);
      }

      default: {
        // Tenta executar como tool nativa dinâmica antes de desistir
        const nativeResult = await runNativeTool(toolName, toolArgs, context);
        if (nativeResult !== null) return nativeResult;
        return `Ferramenta desconhecida: ${toolName}`;
      }
    }

  } catch (err) {
    log.error("Tool", `${toolName}: ${err.message}`);
    try {
      const { trackError } = require("./self-improve");
      trackError(toolName, err.message);
    } catch {}
    return `Erro ao executar ${toolName}: ${err.message}`;
  }
}

module.exports = { executeTool, setSendProgress };
