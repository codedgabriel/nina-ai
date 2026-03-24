// ============================================================
//  Nina v4 — Browser Autônomo (Playwright)
//
//  A Nina navega na web como se fosse você:
//  - Abre páginas, clica, preenche formulários
//  - Faz login, extrai dados, tira screenshots
//  - Roda em modo headless no servidor Ubuntu
//
//  Fluxo agentic:
//  1. Você pede algo em linguagem natural
//  2. DeepSeek gera um plano de ações (navigate, click, fill, etc.)
//  3. browser.js executa cada ação no Playwright
//  4. Após cada ação, tira screenshot + extrai texto da página
//  5. DeepSeek decide o próximo passo com base no estado atual
//  6. Repete até completar a tarefa ou atingir max_steps
// ============================================================

const path = require("path");
const fs   = require("fs");
const os   = require("os");
const axios = require("axios");

const {
  DEEPSEEK_API_KEY, DEEPSEEK_BASE_URL, DEEPSEEK_MODEL,
} = require("./config");

const SCREENSHOTS_DIR = path.join(os.homedir(), "nina-files", "browser");
fs.mkdirSync(SCREENSHOTS_DIR, { recursive: true });

// ── Carrega Playwright dinamicamente ─────────────────────────
// (evita crash se não estiver instalado)

function getPlaywright() {
  try {
    return require("playwright");
  } catch {
    return null;
  }
}

// ── Estado da sessão do browser ───────────────────────────────
// Mantém um browser aberto entre chamadas pra ser mais rápido

let _browser = null;
let _context = null;
let _page    = null;
let _sessionActive = false;

async function ensureBrowser() {
  const pw = getPlaywright();
  if (!pw) throw new Error("Playwright não instalado. Rode: npm install playwright && npx playwright install chromium");

  if (!_browser || !_browser.isConnected()) {
    console.log("[Browser] Iniciando Chromium headless...");
    _browser = await pw.chromium.launch({
      headless: true,
      args: [
        "--no-sandbox",
        "--disable-setuid-sandbox",
        "--disable-dev-shm-usage",
        "--disable-blink-features=AutomationControlled", // anti-bot
      ],
    });
    _context = await _browser.newContext({
      userAgent: "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
      viewport: { width: 1280, height: 800 },
      locale: "pt-BR",
    });
    _page = await _context.newPage();
    _sessionActive = true;
    console.log("[Browser] Pronto.");
  }

  if (!_page || _page.isClosed()) {
    _page = await _context.newPage();
  }

  return _page;
}

async function closeBrowser() {
  try {
    if (_browser) await _browser.close();
  } catch {}
  _browser = null;
  _context = null;
  _page    = null;
  _sessionActive = false;
}

// ── Extrai estado atual da página ─────────────────────────────

async function getPageState(page) {
  try {
    const url   = page.url();
    const title = await page.title();

    // Extrai texto visível (limpo, sem HTML)
    const text = await page.evaluate(() => {
      const el = document.body;
      if (!el) return "";
      return el.innerText
        .replace(/\s{3,}/g, "\n")
        .trim()
        .slice(0, 3000);
    });

    // Extrai links e botões relevantes
    const interactive = await page.evaluate(() => {
      const items = [];
      document.querySelectorAll("a[href], button, input, select, textarea").forEach((el) => {
        const tag   = el.tagName.toLowerCase();
        const text  = (el.innerText || el.value || el.placeholder || el.name || "").slice(0, 60).trim();
        const href  = el.href || "";
        const type  = el.type || "";
        if (text || href) items.push({ tag, text, href, type });
      });
      return items.slice(0, 30);
    });

    return { url, title, text, interactive };
  } catch (err) {
    return { url: "erro", title: "erro", text: err.message, interactive: [] };
  }
}

// ── Tira screenshot e salva ───────────────────────────────────

async function takeScreenshot(page, name = "screenshot") {
  const filename = `${name}_${Date.now()}.png`;
  const filepath = path.join(SCREENSHOTS_DIR, filename);
  await page.screenshot({ path: filepath, fullPage: false });
  return filepath;
}

// ── Executa uma ação no browser ───────────────────────────────

async function executeAction(page, action) {
  const { type, selector, value, url, key, timeout = 5000 } = action;

  try {
    switch (type) {

      case "navigate":
        await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30000 });
        await page.waitForTimeout(1000);
        return `navegou para: ${url}`;

      case "click":
        await page.waitForSelector(selector, { timeout });
        await page.click(selector);
        await page.waitForTimeout(800);
        return `clicou em: ${selector}`;

      case "click_text":
        // Clica em elemento pelo texto visível
        await page.getByText(value, { exact: false }).first().click();
        await page.waitForTimeout(800);
        return `clicou no texto: "${value}"`;

      case "fill":
        await page.waitForSelector(selector, { timeout });
        await page.fill(selector, value);
        return `preencheu ${selector} com: "${value}"`;

      case "type":
        await page.waitForSelector(selector, { timeout });
        await page.type(selector, value, { delay: 50 });
        return `digitou em ${selector}: "${value}"`;

      case "press":
        await page.keyboard.press(key);
        await page.waitForTimeout(500);
        return `pressionou: ${key}`;

      case "select":
        await page.waitForSelector(selector, { timeout });
        await page.selectOption(selector, value);
        return `selecionou "${value}" em ${selector}`;

      case "scroll":
        await page.evaluate((px) => window.scrollBy(0, px), value || 500);
        return `rolou ${value || 500}px`;

      case "wait":
        await page.waitForTimeout(value || 2000);
        return `aguardou ${value || 2000}ms`;

      case "wait_for":
        await page.waitForSelector(selector, { timeout: value || 10000 });
        return `elemento apareceu: ${selector}`;

      case "extract":
        const extracted = await page.evaluate((sel) => {
          const el = document.querySelector(sel);
          return el ? el.innerText || el.value || el.textContent : null;
        }, selector);
        return `extraído de ${selector}: "${extracted}"`;

      case "extract_all":
        const all = await page.evaluate((sel) => {
          return Array.from(document.querySelectorAll(sel))
            .map((el) => el.innerText || el.textContent)
            .filter(Boolean)
            .slice(0, 20);
        }, selector);
        return `extraído (${all.length} itens): ${JSON.stringify(all)}`;

      case "screenshot":
        const fp = await takeScreenshot(page, value || "step");
        return `screenshot salvo: ${fp}`;

      case "back":
        await page.goBack();
        await page.waitForTimeout(800);
        return "voltou uma página";

      case "evaluate":
        // Executa JS arbitrário na página
        const result = await page.evaluate(value);
        return `JS executado: ${JSON.stringify(result)}`;

      default:
        return `ação desconhecida: ${type}`;
    }
  } catch (err) {
    return `erro em ${type}: ${err.message}`;
  }
}

// ── Loop agentic principal ────────────────────────────────────
//
// Passa o estado atual da página pro DeepSeek e pede o próximo passo.
// Continua até: tarefa concluída | erro | max_steps atingido

async function agenticBrowse(task, options = {}) {
  const { max_steps = 15, send_updates = null } = options;

  if (!DEEPSEEK_API_KEY) return "DEEPSEEK_API_KEY não configurada";

  let page;
  try {
    page = await ensureBrowser();
  } catch (err) {
    return err.message;
  }

  const history = []; // histórico de ações desta sessão
  let finalResult = "";

  const systemPrompt = `Você controla um browser Chromium headless. Sua tarefa é completar o objetivo dado pelo usuário navegando na web.

A cada turno você recebe:
- Estado atual da página (URL, título, texto visível, elementos interativos)
- Histórico de ações já executadas

Você responde com JSON descrevendo a PRÓXIMA ação a tomar, ou com o resultado final se a tarefa estiver concluída.

Formatos válidos:

1. Executar uma ação:
{"action": {"type": "navigate"|"click"|"click_text"|"fill"|"type"|"press"|"select"|"scroll"|"wait"|"wait_for"|"extract"|"extract_all"|"screenshot"|"back"|"evaluate", "selector": "css selector (se aplicável)", "value": "valor (se aplicável)", "url": "URL (para navigate)", "key": "tecla (para press)"}}

2. Tarefa concluída:
{"done": true, "result": "resumo do que foi feito e dados extraídos"}

3. Erro irrecuperável:
{"error": "descrição do problema"}

Dicas:
- Prefira seletores CSS robustos: [name="email"], [type="submit"], #id
- Para textos de link/botão use click_text com o texto visível
- Se uma ação falhar, tente abordagem alternativa
- Extraia dados com extract ou extract_all antes de responder como done
- Máximo ${max_steps} ações`;

  for (let step = 0; step < max_steps; step++) {
    const state = await getPageState(page);

    const userContent = `Objetivo: ${task}

Estado atual da página:
URL: ${state.url}
Título: ${state.title}
Texto visível (primeiros 2000 chars):
${state.text}

Elementos interativos:
${state.interactive.map((i) => `${i.tag}${i.type ? `[${i.type}]` : ""}: "${i.text}" ${i.href ? `→ ${i.href}` : ""}`).join("\n").slice(0, 800)}

Histórico de ações (${history.length}/${max_steps}):
${history.slice(-5).map((h, i) => `${i + 1}. ${h}`).join("\n") || "(nenhuma ainda)"}

Qual o próximo passo?`;

    let response;
    try {
      response = await axios.post(
        `${DEEPSEEK_BASE_URL}/chat/completions`,
        {
          model: DEEPSEEK_MODEL,
          messages: [
            { role: "system", content: systemPrompt },
            { role: "user",   content: userContent },
          ],
          temperature: 0.2,
          max_tokens:  400,
          response_format: { type: "json_object" },
        },
        { headers: { Authorization: `Bearer ${DEEPSEEK_API_KEY}` }, timeout: 30_000 }
      );
    } catch (err) {
      return `erro na API: ${err.message}`;
    }

    let parsed;
    try {
      const raw = response.data?.choices?.[0]?.message?.content;
      parsed = JSON.parse(raw);
    } catch {
      return "erro: resposta da IA não era JSON válido";
    }

    // Tarefa concluída
    if (parsed.done) {
      finalResult = parsed.result || "tarefa concluída";
      break;
    }

    // Erro irrecuperável
    if (parsed.error) {
      finalResult = `erro: ${parsed.error}`;
      break;
    }

    // Executa a ação
    if (parsed.action) {
      const actionResult = await executeAction(page, parsed.action);
      history.push(`${parsed.action.type}: ${actionResult}`);
      console.log(`[Browser] Step ${step + 1}: ${actionResult}`);

      // Manda update intermediário se solicitado
      if (send_updates && step % 3 === 0 && step > 0) {
        send_updates(`navegando... (passo ${step + 1}/${max_steps})`).catch(() => {});
      }
    } else {
      finalResult = "resposta inesperada da IA";
      break;
    }

    // Chega no limite
    if (step === max_steps - 1) {
      finalResult = `atingi o limite de ${max_steps} passos. último estado: ${state.url}`;
    }
  }

  return finalResult || "concluído";
}

// ── Tarefa simples: só abre e extrai texto ────────────────────

async function fetchPageText(url) {
  let page;
  try {
    page = await ensureBrowser();
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30000 });
    await page.waitForTimeout(1500);
    const state = await getPageState(page);
    return `[${state.title}]\n${state.text}`;
  } catch (err) {
    return `erro ao acessar ${url}: ${err.message}`;
  }
}

module.exports = {
  agenticBrowse,
  fetchPageText,
  closeBrowser,
  takeScreenshot,
};
