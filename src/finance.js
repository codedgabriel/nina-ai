// ============================================================
//  Nina v4 — Finanças Autônomas
//
//  Integra Binance + DeFi (Aave/Compound) pra estratégias
//  de longo prazo definidas pelo usuário.
//
//  Fluxo:
//  1. Você define a estratégia uma vez ("DCA em ETH, 
//     lending no Aave, horizonte 3 anos")
//  2. Nina executa autonomamente sem precisar ser chamada
//  3. Te avisa só quando algo importante acontece
//  4. Relatório periódico (semanal/mensal) automático
//
//  Estratégias suportadas:
//  - DCA         : compra X de qualquer ativo a cada período
//  - Lending     : empresta em Aave/Compound pelo maior yield
//  - Rebalancing : mantém proporção entre ativos
//  - Hodl        : compra e segura, move pra cold wallet
//  - Híbrido     : combinação das acima
// ============================================================

const fs   = require("fs");
const path = require("path");
const os   = require("os");
const axios = require("axios");
const cron  = require("node-cron");

const { runCommand }   = require("./shell");
const { logDecision }  = require("./decisions");
const { enqueue }      = require("./notifications");
const {
  DEEPSEEK_API_KEY, DEEPSEEK_BASE_URL, DEEPSEEK_MODEL,
} = require("./config");

const FINANCE_FILE  = "./nina-finance.json";
const FINANCE_LOG   = path.join(os.homedir(), "nina-files", "logs", "finance.log");

fs.mkdirSync(path.dirname(FINANCE_LOG), { recursive: true });

// ── Estado persistente ────────────────────────────────────────

function loadFinance() {
  try {
    if (fs.existsSync(FINANCE_FILE))
      return JSON.parse(fs.readFileSync(FINANCE_FILE, "utf-8"));
  } catch {}
  return {
    strategies:   [],    // estratégias ativas
    positions:    {},    // posições atuais { asset: { amount, avg_price, platform } }
    transactions: [],    // histórico de transações (últimas 200)
    totalInvested: 0,    // total investido em USD
    startDate:    null,
    reportCron:   "0 8 * * 1", // segunda-feira às 8h
  };
}

function saveFinance(state) {
  fs.writeFileSync(FINANCE_FILE, JSON.stringify(state, null, 2));
}

let finance = loadFinance();

function logTx(entry) {
  finance.transactions.unshift({ ...entry, ts: new Date().toISOString() });
  if (finance.transactions.length > 200) finance.transactions.pop();
  saveFinance(finance);

  const line = `[${new Date().toISOString()}] ${entry.type} | ${entry.asset} | ${entry.amount} | $${entry.usd_value} | ${entry.platform} | ${entry.note || ""}\n`;
  fs.appendFileSync(FINANCE_LOG, line);

  logDecision({
    category:    "tool",
    action:      `${entry.type}: ${entry.amount} ${entry.asset} ($${entry.usd_value})`,
    reason:      entry.note || entry.strategy,
    urgency:     "info",
    triggered_by: "autonomous",
  });
}

// ── Binance API ───────────────────────────────────────────────

function getBinanceClient() {
  const key    = process.env.BINANCE_API_KEY    || "";
  const secret = process.env.BINANCE_API_SECRET || "";
  if (!key || !secret) return null;
  return { key, secret, base: "https://api.binance.com" };
}

async function binanceRequest(method, endpoint, params = {}) {
  const client = getBinanceClient();
  if (!client) throw new Error("BINANCE_API_KEY e BINANCE_API_SECRET não configuradas");

  const crypto  = require("crypto");
  const ts      = Date.now();
  const query   = new URLSearchParams({ ...params, timestamp: ts });
  const sig     = crypto.createHmac("sha256", client.secret).update(query.toString()).digest("hex");
  query.append("signature", sig);

  const url = `${client.base}${endpoint}?${query}`;
  const res = await axios({ method, url, headers: { "X-MBX-APIKEY": client.key }, timeout: 15000 });
  return res.data;
}

async function getBinancePrice(symbol) {
  const res = await axios.get(`https://api.binance.com/api/v3/ticker/price?symbol=${symbol}USDT`, { timeout: 5000 });
  return parseFloat(res.data.price);
}

async function getBinanceBalance() {
  const account = await binanceRequest("GET", "/api/v3/account");
  return account.balances
    .filter((b) => parseFloat(b.free) > 0 || parseFloat(b.locked) > 0)
    .map((b) => ({ asset: b.asset, free: parseFloat(b.free), locked: parseFloat(b.locked) }));
}

async function placeBinanceOrder(symbol, side, usdAmount) {
  const price = await getBinancePrice(symbol);
  const qty   = (usdAmount / price).toFixed(6);

  const order = await binanceRequest("POST", "/api/v3/order", {
    symbol:    symbol + "USDT",
    side,
    type:      "MARKET",
    quoteOrderQty: usdAmount,
  });

  return {
    orderId:      order.orderId,
    symbol,
    side,
    qty:          parseFloat(order.executedQty),
    price:        parseFloat(order.fills?.[0]?.price || price),
    usd_value:    usdAmount,
    status:       order.status,
  };
}

// ── DeFi: Aave Yield ──────────────────────────────────────────
// Usa a API pública do Aave pra consultar APY sem precisar
// de carteira conectada. Para depositar de verdade, precisa
// de wallet com ETH pra gas — indica isso pro usuário.

async function getAaveRates() {
  try {
    // Aave v3 Subgraph
    const query = `{
      reserves(where: { isActive: true, isFrozen: false }) {
        symbol
        liquidityRate
        stableBorrowRate
        variableBorrowRate
        totalLiquidity
        totalCurrentVariableDebt
      }
    }`;

    const res = await axios.post(
      "https://api.thegraph.com/subgraphs/name/aave/protocol-v3",
      { query },
      { timeout: 10000 }
    );

    const reserves = res.data?.data?.reserves || [];
    return reserves
      .map((r) => ({
        asset:      r.symbol,
        supply_apy: (parseFloat(r.liquidityRate) / 1e27 * 100).toFixed(2),
        borrow_apy: (parseFloat(r.variableBorrowRate) / 1e27 * 100).toFixed(2),
      }))
      .filter((r) => parseFloat(r.supply_apy) > 0)
      .sort((a, b) => parseFloat(b.supply_apy) - parseFloat(a.supply_apy));
  } catch {
    // Fallback: API REST do Aave
    try {
      const res = await axios.get("https://aave-api-v2.aave.com/data/markets-data", { timeout: 10000 });
      const reserves = res.data?.proto?.reserves || [];
      return reserves
        .filter((r) => r.isActive && !r.isFrozen)
        .map((r) => ({
          asset:      r.symbol,
          supply_apy: (parseFloat(r.liquidityRate) * 100).toFixed(2),
          borrow_apy: (parseFloat(r.variableBorrowRate) * 100).toFixed(2),
        }))
        .filter((r) => parseFloat(r.supply_apy) > 0)
        .sort((a, b) => parseFloat(b.supply_apy) - parseFloat(a.supply_apy))
        .slice(0, 10);
    } catch {
      return [];
    }
  }
}

async function getCompoundRates() {
  try {
    const res = await axios.get("https://api.compound.finance/api/v2/ctoken", { timeout: 10000 });
    return (res.data?.cToken || [])
      .map((t) => ({
        asset:      t.underlying_symbol || t.symbol,
        supply_apy: (parseFloat(t.supply_rate?.value || 0) * 100).toFixed(2),
        borrow_apy: (parseFloat(t.borrow_rate?.value || 0) * 100).toFixed(2),
        platform:   "Compound",
      }))
      .filter((t) => parseFloat(t.supply_apy) > 0)
      .sort((a, b) => parseFloat(b.supply_apy) - parseFloat(a.supply_apy))
      .slice(0, 10);
  } catch {
    return [];
  }
}

async function getBestYield(asset = null) {
  const [aave, compound] = await Promise.all([getAaveRates(), getCompoundRates()]);

  const all = [
    ...aave.map((r) => ({ ...r, platform: "Aave v3" })),
    ...compound,
  ];

  if (asset) {
    const filtered = all.filter((r) =>
      r.asset.toUpperCase().includes(asset.toUpperCase())
    );
    return filtered.sort((a, b) => parseFloat(b.supply_apy) - parseFloat(a.supply_apy));
  }

  return all.sort((a, b) => parseFloat(b.supply_apy) - parseFloat(a.supply_apy)).slice(0, 15);
}

// ── Estratégias ───────────────────────────────────────────────

function addStrategy(opts) {
  const {
    name,
    type,           // dca | lending | rebalancing | hodl | hybrid
    assets,         // ["BTC", "ETH", "SOL"] ou ["USDC"] pra lending
    allocation,     // { BTC: 60, ETH: 40 } em %
    amount_usd,     // valor por execução (pra DCA)
    total_budget,   // orçamento total em USD
    frequency,      // "weekly" | "monthly" | "daily"
    horizon_months, // horizonte em meses (ex: 36 = 3 anos)
    risk_level,     // "conservative" | "moderate" | "aggressive"
    notes,
  } = opts;

  // Cron baseado na frequência
  const cronMap = {
    daily:   "0 9 * * *",
    weekly:  "0 9 * * 1",
    monthly: "0 9 1 * *",
  };

  const id = `${type}_${Date.now().toString(36)}`;

  const strategy = {
    id,
    name: name || `Estratégia ${type}`,
    type,
    assets:          assets || [],
    allocation:      allocation || {},
    amount_usd:      amount_usd || 0,
    total_budget:    total_budget || 0,
    spent_usd:       0,
    frequency,
    cron_expr:       cronMap[frequency] || cronMap.weekly,
    horizon_months:  horizon_months || 12,
    risk_level:      risk_level || "moderate",
    notes:           notes || "",
    active:          true,
    createdAt:       new Date().toISOString(),
    lastExecutedAt:  null,
    nextExecuteAt:   null,
    executionCount:  0,
    projectedEnd:    new Date(Date.now() + (horizon_months || 12) * 30 * 24 * 3600000).toISOString(),
  };

  if (!finance.startDate) finance.startDate = new Date().toISOString();
  finance.strategies.push(strategy);
  saveFinance(finance);

  logDecision({
    category:    "tool",
    action:      `estratégia criada: ${strategy.name}`,
    reason:      `${type} | budget $${total_budget} | horizonte ${horizon_months}m`,
    urgency:     "info",
    triggered_by: "user",
  });

  return strategy;
}

// ── Execução de estratégias ───────────────────────────────────

async function executeDCA(strategy) {
  if (!getBinanceClient()) {
    return "Binance API não configurada — configure BINANCE_API_KEY e BINANCE_API_SECRET";
  }

  if (strategy.spent_usd >= strategy.total_budget) {
    strategy.active = false;
    saveFinance(finance);
    await enqueue(
      `estratégia "${strategy.name}" concluída — orçamento de $${strategy.total_budget} esgotado`,
      { urgency: "importante", source: "finance", skipAI: true }
    );
    return "orçamento esgotado";
  }

  const perAsset = strategy.amount_usd / strategy.assets.length;
  const results  = [];

  for (const asset of strategy.assets) {
    const remaining = strategy.total_budget - strategy.spent_usd;
    const amount    = Math.min(perAsset, remaining / strategy.assets.length);
    if (amount < 1) continue;

    try {
      const order = await placeBinanceOrder(asset, "BUY", amount);

      logTx({
        type:      "DCA_BUY",
        asset,
        amount:    order.qty,
        usd_value: amount,
        price:     order.price,
        platform:  "Binance",
        strategy:  strategy.name,
        note:      `execução #${strategy.executionCount + 1}`,
      });

      // Atualiza posição
      if (!finance.positions[asset]) {
        finance.positions[asset] = { amount: 0, avg_price: 0, platform: "Binance" };
      }
      const pos  = finance.positions[asset];
      const newQty = pos.amount + order.qty;
      pos.avg_price = ((pos.amount * pos.avg_price) + (order.qty * order.price)) / newQty;
      pos.amount    = newQty;

      strategy.spent_usd += amount;
      results.push(`comprei $${amount} de ${asset} @ $${order.price.toFixed(2)}`);
    } catch (err) {
      results.push(`erro ao comprar ${asset}: ${err.message}`);
    }
  }

  strategy.executionCount++;
  strategy.lastExecutedAt = new Date().toISOString();
  saveFinance(finance);

  return results.join("\n");
}

async function executeLendingCheck(strategy) {
  // Verifica se há yield melhor disponível e notifica
  const rates = await getBestYield(strategy.assets[0]);
  if (!rates.length) return "sem dados de yield disponíveis";

  const best = rates[0];
  const current = strategy.notes?.currentPlatform;

  if (current && best.platform !== current && parseFloat(best.supply_apy) > 1) {
    await enqueue(
      `yield melhor disponível: ${best.asset} no ${best.platform} está em ${best.supply_apy}% a.a. (era ${current})`,
      { urgency: "info", source: "finance", skipAI: true }
    );
  }

  return `melhor yield atual: ${best.asset} @ ${best.supply_apy}% a.a. no ${best.platform}`;
}

// ── Executor de estratégias (cron) ────────────────────────────

let strategyCrons = new Map();

function scheduleStrategy(strategy) {
  if (!strategy.active) return;

  const job = cron.schedule(strategy.cron_expr, async () => {
    console.log(`[Finance] Executando estratégia: ${strategy.name}`);

    let result = "";
    try {
      if (strategy.type === "dca") {
        result = await executeDCA(strategy);
      } else if (strategy.type === "lending") {
        result = await executeLendingCheck(strategy);
      }
      console.log(`[Finance] ${strategy.name}: ${result}`);
    } catch (err) {
      console.error(`[Finance] Erro em ${strategy.name}:`, err.message);
    }
  });

  strategyCrons.set(strategy.id, job);
}

// ── Relatório ─────────────────────────────────────────────────

async function generateReport() {
  if (!finance.strategies.length && !Object.keys(finance.positions).length) {
    return "nenhuma estratégia ou posição registrada ainda.";
  }

  const lines = [`relatório financeiro — ${new Date().toLocaleDateString("pt-BR")}\n`];

  // Posições atuais
  if (Object.keys(finance.positions).length > 0) {
    lines.push("posições atuais:");
    let totalValue = 0;

    for (const [asset, pos] of Object.entries(finance.positions)) {
      try {
        const currentPrice = await getBinancePrice(asset).catch(() => pos.avg_price);
        const currentValue = pos.amount * currentPrice;
        const costBasis    = pos.amount * pos.avg_price;
        const pnl          = currentValue - costBasis;
        const pnlPct       = ((pnl / costBasis) * 100).toFixed(2);
        const sign         = pnl >= 0 ? "+" : "";

        totalValue += currentValue;
        lines.push(`  ${asset}: ${pos.amount.toFixed(6)} @ $${currentPrice.toFixed(2)} = $${currentValue.toFixed(2)} (${sign}${pnlPct}%)`);
      } catch {
        lines.push(`  ${asset}: ${pos.amount.toFixed(6)} (preço indisponível)`);
      }
    }

    lines.push(`  total estimado: $${totalValue.toFixed(2)}`);
    lines.push(`  total investido: $${finance.totalInvested.toFixed(2)}`);
  }

  // Estratégias ativas
  const active = finance.strategies.filter((s) => s.active);
  if (active.length > 0) {
    lines.push(`\nestratégias ativas (${active.length}):`);
    for (const s of active) {
      const remaining = s.total_budget - s.spent_usd;
      const endDate   = new Date(s.projectedEnd).toLocaleDateString("pt-BR");
      lines.push(`  ${s.name}: $${s.spent_usd.toFixed(0)}/$${s.total_budget} | ${s.executionCount} execuções | termina ~${endDate}`);
    }
  }

  // Últimas transações
  const recent = finance.transactions.slice(0, 5);
  if (recent.length > 0) {
    lines.push("\núltimas transações:");
    for (const tx of recent) {
      const date = new Date(tx.ts).toLocaleDateString("pt-BR");
      lines.push(`  ${date}: ${tx.type} ${tx.amount.toFixed(4)} ${tx.asset} @ $${tx.usd_value}`);
    }
  }

  return lines.join("\n");
}

// ── Status & Controle ─────────────────────────────────────────

function getFinanceStatus() {
  const active   = finance.strategies.filter((s) => s.active);
  const inactive = finance.strategies.filter((s) => !s.active);
  const positions = Object.keys(finance.positions).length;

  const lines = [
    `estratégias ativas: ${active.length}`,
    `estratégias concluídas: ${inactive.length}`,
    `posições: ${positions} ativo(s)`,
    `total investido: $${finance.totalInvested.toFixed(2)}`,
    `transações: ${finance.transactions.length}`,
  ];

  if (active.length > 0) {
    lines.push("\ndetalhes:");
    for (const s of active) {
      const pct  = s.total_budget > 0 ? ((s.spent_usd / s.total_budget) * 100).toFixed(0) : 0;
      const next = s.lastExecutedAt
        ? `última exec: ${new Date(s.lastExecutedAt).toLocaleDateString("pt-BR")}`
        : "ainda não executou";
      lines.push(`  [${s.id}] ${s.name} — ${pct}% do orçamento usado | ${next}`);
    }
  }

  return lines.join("\n");
}

function pauseStrategy(id) {
  const s = finance.strategies.find((x) => x.id === id || x.name.includes(id));
  if (!s) return `estratégia "${id}" não encontrada`;
  s.active = false;
  const job = strategyCrons.get(s.id);
  if (job) { job.stop(); strategyCrons.delete(s.id); }
  saveFinance(finance);
  return `estratégia "${s.name}" pausada`;
}

function resumeStrategy(id) {
  const s = finance.strategies.find((x) => x.id === id || x.name.includes(id));
  if (!s) return `estratégia "${id}" não encontrada`;
  s.active = true;
  scheduleStrategy(s);
  saveFinance(finance);
  return `estratégia "${s.name}" retomada`;
}

// ── Init ──────────────────────────────────────────────────────

function startFinance() {
  const active = finance.strategies.filter((s) => s.active);
  for (const s of active) scheduleStrategy(s);

  // Relatório semanal
  cron.schedule(finance.reportCron, async () => {
    try {
      const report = await generateReport();
      const { enqueue: eq } = require("./notifications");
      await eq(report, { urgency: "info", source: "finance", skipAI: true });
    } catch {}
  });

  if (active.length > 0) {
    console.log(`[Finance] ${active.length} estratégia(s) ativa(s) carregada(s)`);
  }
}

module.exports = {
  startFinance,
  addStrategy,
  pauseStrategy,
  resumeStrategy,
  getFinanceStatus,
  generateReport,
  getBestYield,
  getAaveRates,
  getCompoundRates,
  getBinanceBalance,
  getBinancePrice,
  placeBinanceOrder,
};
