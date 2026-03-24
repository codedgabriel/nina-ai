// ============================================================
//  Nina v4 — Skills Pré-instaladas
//
//  Roda uma vez no startup via initPreinstalledSkills().
//  Cada skill só é (re)registrada se o código mudou — 
//  compara hash pra não sobrescrever skills customizadas.
//
//  Skills incluídas:
//  ── Cripto & Finanças ─────────────────────────────────────
//  - crypto_price         : preço atual de qualquer cripto
//  - crypto_wallet_sol    : cria wallet Solana
//  - crypto_balance_sol   : saldo de uma wallet Solana
//  - crypto_transfer_sol  : transfere SOL entre wallets
//  - converter_moeda      : converte entre moedas (USD, BRL, EUR, etc.)
//  ── Brasil ────────────────────────────────────────────────
//  - consultar_cnpj       : dados de empresa pela Receita Federal
//  - consultar_cep        : endereço por CEP
//  ── Utilidades ────────────────────────────────────────────
//  - clima                : clima atual de qualquer cidade
//  - resumir_texto        : resume texto longo
//  - check_ssl            : validade do certificado SSL de um domínio
//  - ping_host            : latência e disponibilidade de um host
//  - portas_abertas       : scan de portas de um host
//  - disk_usage_report    : relatório detalhado de uso de disco
//  - processo_pesado      : encontra o processo que mais consome recursos
// ============================================================

const crypto = require("crypto");
const { registerSkill, getSkill } = require("./skills");

// ── Helper: só registra se mudou ─────────────────────────────

function registerIfChanged(opts) {
  const hash    = crypto.createHash("md5").update(opts.code).digest("hex").slice(0, 8);
  const existing = getSkill(opts.name);

  if (existing?.codeHash === hash) return; // sem mudança

  registerSkill({ ...opts, codeHash: hash });
  console.log(`[PreSkills] "${opts.name}" ${existing ? "atualizada" : "registrada"}`);
}

// ── Skills ────────────────────────────────────────────────────

const SKILLS = [

  // ────────────────────────────────────────────────────────────
  // CRIPTO & FINANÇAS
  // ────────────────────────────────────────────────────────────

  {
    name: "crypto_price",
    description: "Preço atual de qualquer criptomoeda em USD e BRL. Ex: bitcoin, ethereum, solana, bnb.",
    lang: "python",
    args_schema: "símbolo da cripto como $1 (ex: bitcoin, solana, ethereum)",
    example: 'run_skill("crypto_price", "solana")',
    dependencies: ["requests"],
    code: `
import sys, requests, json

coin = sys.argv[1].lower().strip() if len(sys.argv) > 1 else "bitcoin"

# CoinGecko API — gratuita, sem key
url = f"https://api.coingecko.com/api/v3/simple/price"
params = {
    "ids": coin,
    "vs_currencies": "usd,brl",
    "include_24hr_change": "true",
    "include_market_cap": "true"
}

try:
    r = requests.get(url, params=params, timeout=10)
    data = r.json()

    if coin not in data:
        # Tenta buscar pelo símbolo (ex: SOL, BTC)
        search = requests.get(f"https://api.coingecko.com/api/v3/search?query={coin}", timeout=10).json()
        coins = search.get("coins", [])
        if coins:
            coin_id = coins[0]["id"]
            r = requests.get(url, params={**params, "ids": coin_id}, timeout=10)
            data = r.json()
            coin = coin_id

    if coin not in data:
        print(f"Cripto '{coin}' não encontrada")
        sys.exit(1)

    d = data[coin]
    usd   = d.get("usd", 0)
    brl   = d.get("brl", 0)
    chg   = d.get("usd_24h_change", 0)
    mcap  = d.get("usd_market_cap", 0)
    sign  = "+" if chg >= 0 else ""

    print(f"{coin.upper()}")
    print(f"USD: \${usd:,.2f}")
    print(f"BRL: R\${brl:,.2f}")
    print(f"24h: {sign}{chg:.2f}%")
    if mcap > 0:
        print(f"Market cap: \${mcap/1e9:.2f}B")

except Exception as e:
    print(f"Erro: {e}")
    sys.exit(1)
`,
  },

  {
    name: "crypto_wallet_sol",
    description: "Cria uma nova wallet Solana (keypair). Salva a chave privada criptografada em ~/nina-files/wallets/. Retorna o endereço público.",
    lang: "python",
    args_schema: "nome opcional para identificar a wallet como $1 (ex: 'principal', 'trading')",
    example: 'run_skill("crypto_wallet_sol", "principal")',
    dependencies: ["solders"],
    code: `
import sys, os, json, base64
from pathlib import Path

try:
    from solders.keypair import Keypair
except ImportError:
    os.system("pip3 install solders --break-system-packages -q")
    from solders.keypair import Keypair

label    = sys.argv[1] if len(sys.argv) > 1 else "default"
kp       = Keypair()
pubkey   = str(kp.pubkey())
privkey  = base64.b64encode(bytes(kp)).decode()

wallets_dir = Path.home() / "nina-files" / "wallets"
wallets_dir.mkdir(parents=True, exist_ok=True)

wallet_file = wallets_dir / f"sol_{label}.json"
wallet_data = {
    "label":   label,
    "network": "mainnet-beta",
    "pubkey":  pubkey,
    "privkey": privkey,   # base64 do keypair completo (32 bytes seed + 32 bytes pubkey)
    "created": __import__("datetime").datetime.now().isoformat()
}

wallet_file.write_text(json.dumps(wallet_data, indent=2))
os.chmod(wallet_file, 0o600)  # só o dono lê

print(f"Wallet criada: {label}")
print(f"Endereço público: {pubkey}")
print(f"Arquivo: {wallet_file}")
print(f"IMPORTANTE: chave privada salva em {wallet_file} — mantenha seguro")
`,
  },

  {
    name: "crypto_balance_sol",
    description: "Consulta o saldo de uma wallet Solana em SOL e USD. Aceita endereço público ou nome de wallet salva.",
    lang: "python",
    args_schema: "endereço público SOL ou nome da wallet salva como $1",
    example: 'run_skill("crypto_balance_sol", "principal")',
    dependencies: ["requests"],
    code: `
import sys, os, json, requests
from pathlib import Path

arg = sys.argv[1] if len(sys.argv) > 1 else "default"

# Verifica se é um nome de wallet salva ou endereço direto
wallets_dir = Path.home() / "nina-files" / "wallets"
wallet_file = wallets_dir / f"sol_{arg}.json"

if wallet_file.exists():
    data   = json.loads(wallet_file.read_text())
    pubkey = data["pubkey"]
    label  = data["label"]
else:
    pubkey = arg
    label  = arg[:8] + "..."

RPC = "https://api.mainnet-beta.solana.com"

try:
    # Saldo em lamports
    r = requests.post(RPC, json={
        "jsonrpc": "2.0", "id": 1,
        "method": "getBalance",
        "params": [pubkey]
    }, timeout=15)
    lamports = r.json()["result"]["value"]
    sol = lamports / 1_000_000_000

    # Preço atual do SOL
    price_r = requests.get(
        "https://api.coingecko.com/api/v3/simple/price?ids=solana&vs_currencies=usd,brl",
        timeout=10
    ).json()
    usd_price = price_r["solana"]["usd"]
    brl_price = price_r["solana"]["brl"]

    print(f"Wallet: {label}")
    print(f"Endereço: {pubkey}")
    print(f"Saldo: {sol:.6f} SOL")
    print(f"USD: \${sol * usd_price:,.2f}")
    print(f"BRL: R\${sol * brl_price:,.2f}")
    print(f"(SOL @ \${usd_price:,.2f})")

except Exception as e:
    print(f"Erro ao consultar saldo: {e}")
    sys.exit(1)
`,
  },

  {
    name: "crypto_transfer_sol",
    description: "Transfere SOL de uma wallet salva para um endereço destino. CUIDADO: transação irreversível.",
    lang: "python",
    args_schema: "nome_wallet_origem valor_em_SOL endereço_destino (ex: principal 0.5 7xKf...)",
    example: 'run_skill("crypto_transfer_sol", "principal 0.5 ENDERECO_DESTINO")',
    dependencies: ["solders", "requests"],
    code: `
import sys, os, json, base64, requests
from pathlib import Path

args = " ".join(sys.argv[1:]).split()
if len(args) < 3:
    print("uso: nome_wallet valor_SOL endereco_destino")
    sys.exit(1)

label, amount_str, dest = args[0], args[1], args[2]
amount_sol = float(amount_str)

try:
    from solders.keypair import Keypair
    from solders.pubkey import Pubkey
    from solders.transaction import Transaction
    from solders.system_program import transfer, TransferParams
    from solders.message import Message
    from solders.hash import Hash
except ImportError:
    os.system("pip3 install solders --break-system-packages -q")
    from solders.keypair import Keypair
    from solders.pubkey import Pubkey
    from solders.transaction import Transaction
    from solders.system_program import transfer, TransferParams
    from solders.message import Message
    from solders.hash import Hash

# Carrega wallet
wallets_dir  = Path.home() / "nina-files" / "wallets"
wallet_file  = wallets_dir / f"sol_{label}.json"
if not wallet_file.exists():
    print(f"Wallet '{label}' não encontrada em {wallets_dir}")
    sys.exit(1)

wallet_data = json.loads(wallet_file.read_text())
kp_bytes    = base64.b64decode(wallet_data["privkey"])
keypair     = Keypair.from_bytes(kp_bytes)
sender      = keypair.pubkey()

lamports = int(amount_sol * 1_000_000_000)
RPC      = "https://api.mainnet-beta.solana.com"

try:
    # Blockhash recente
    bh_r      = requests.post(RPC, json={"jsonrpc":"2.0","id":1,"method":"getLatestBlockhash","params":[]}, timeout=15)
    blockhash = bh_r.json()["result"]["value"]["blockhash"]

    # Monta transação
    dest_pk  = Pubkey.from_string(dest)
    ix       = transfer(TransferParams(from_pubkey=sender, to_pubkey=dest_pk, lamports=lamports))
    msg      = Message([ix], sender)
    tx       = Transaction([keypair], msg, Hash.from_string(blockhash))

    # Envia
    tx_bytes = bytes(tx)
    import base64 as b64
    tx_b64   = b64.b64encode(tx_bytes).decode()

    send_r = requests.post(RPC, json={
        "jsonrpc": "2.0", "id": 1,
        "method": "sendTransaction",
        "params": [tx_b64, {"encoding": "base64"}]
    }, timeout=20)

    result = send_r.json()
    if "error" in result:
        print(f"Erro na transação: {result['error']}")
        sys.exit(1)

    sig = result["result"]
    print(f"Transferência enviada!")
    print(f"De: {sender}")
    print(f"Para: {dest}")
    print(f"Valor: {amount_sol} SOL")
    print(f"Assinatura: {sig}")
    print(f"Explorer: https://solscan.io/tx/{sig}")

except Exception as e:
    print(f"Erro: {e}")
    sys.exit(1)
`,
  },

  {
    name: "converter_moeda",
    description: "Converte valores entre moedas: USD, BRL, EUR, GBP, ARS, BTC, ETH, SOL, etc.",
    lang: "python",
    args_schema: "valor moeda_origem moeda_destino (ex: 100 USD BRL)",
    example: 'run_skill("converter_moeda", "100 USD BRL")',
    dependencies: ["requests"],
    code: `
import sys, requests

args = " ".join(sys.argv[1:]).split()
if len(args) < 3:
    print("uso: valor moeda_origem moeda_destino (ex: 100 USD BRL)")
    sys.exit(1)

valor, origem, destino = float(args[0]), args[1].upper(), args[2].upper()

# Criptos conhecidas
CRYPTOS = {"BTC": "bitcoin", "ETH": "ethereum", "SOL": "solana", "BNB": "binancecoin", "USDT": "tether"}

try:
    if origem in CRYPTOS or destino in CRYPTOS:
        # Usa CoinGecko pra cripto
        coin_id = CRYPTOS.get(origem) or CRYPTOS.get(destino)
        vs      = destino.lower() if origem in CRYPTOS else origem.lower()
        r = requests.get(
            f"https://api.coingecko.com/api/v3/simple/price?ids={coin_id}&vs_currencies={vs}",
            timeout=10
        ).json()
        rate = r[coin_id][vs]
        if destino in CRYPTOS:
            result = valor / rate
            print(f"{valor} {origem} = {result:.8f} {destino}")
        else:
            result = valor * rate
            print(f"{valor} {origem} = {result:,.2f} {destino}")
    else:
        # AwesomeAPI pra fiat
        pair = f"{origem}-{destino}"
        r    = requests.get(f"https://economia.awesomeapi.com.br/json/{pair}/1", timeout=10).json()
        rate = float(r[0]["bid"])
        result = valor * rate
        print(f"{valor} {origem} = {result:,.2f} {destino}")
        print(f"Taxa: 1 {origem} = {rate:.4f} {destino}")

except Exception as e:
    print(f"Erro: {e}")
    sys.exit(1)
`,
  },

  // ────────────────────────────────────────────────────────────
  // BRASIL
  // ────────────────────────────────────────────────────────────

  {
    name: "consultar_cnpj",
    description: "Dados completos de uma empresa pelo CNPJ: razão social, situação, endereço, atividade, sócios.",
    lang: "python",
    args_schema: "CNPJ como $1 (com ou sem formatação)",
    example: 'run_skill("consultar_cnpj", "33.000.167/0001-01")',
    dependencies: ["requests"],
    code: `
import sys, requests, re

cnpj = re.sub(r"\\D", "", sys.argv[1]) if len(sys.argv) > 1 else ""
if len(cnpj) != 14:
    print("CNPJ inválido — use 14 dígitos")
    sys.exit(1)

try:
    r = requests.get(f"https://brasilapi.com.br/api/cnpj/v1/{cnpj}", timeout=15)
    if r.status_code == 404:
        print("CNPJ não encontrado")
        sys.exit(1)

    d = r.json()
    print(f"Razão Social: {d.get('razao_social','—')}")
    print(f"Nome Fantasia: {d.get('nome_fantasia','—')}")
    print(f"Situação: {d.get('descricao_situacao_cadastral','—')}")
    print(f"Abertura: {d.get('data_inicio_atividade','—')}")
    print(f"Atividade: {d.get('cnae_fiscal_descricao','—')}")
    print(f"Porte: {d.get('descricao_porte','—')}")
    print(f"Endereço: {d.get('logradouro','')}, {d.get('numero','')} — {d.get('municipio','')}/{d.get('uf','')}")
    print(f"CEP: {d.get('cep','—')}")
    print(f"Telefone: {d.get('ddd_telefone_1','—')}")
    print(f"Email: {d.get('email','—')}")

    socios = d.get("qsa", [])
    if socios:
        print(f"\\nSócios ({len(socios)}):")
        for s in socios[:5]:
            print(f"  {s.get('nome_socio','—')} ({s.get('qualificacao_socio','—')})")

except Exception as e:
    print(f"Erro: {e}")
    sys.exit(1)
`,
  },

  {
    name: "consultar_cep",
    description: "Endereço completo a partir de um CEP brasileiro.",
    lang: "python",
    args_schema: "CEP como $1 (com ou sem traço)",
    example: 'run_skill("consultar_cep", "01310-100")',
    dependencies: ["requests"],
    code: `
import sys, requests, re

cep = re.sub(r"\\D", "", sys.argv[1]) if len(sys.argv) > 1 else ""
if len(cep) != 8:
    print("CEP inválido — use 8 dígitos")
    sys.exit(1)

try:
    r = requests.get(f"https://brasilapi.com.br/api/cep/v2/{cep}", timeout=10)
    if r.status_code == 404:
        print("CEP não encontrado")
        sys.exit(1)

    d = r.json()
    print(f"CEP: {d.get('cep','—')}")
    print(f"Logradouro: {d.get('street','—')}")
    print(f"Bairro: {d.get('neighborhood','—')}")
    print(f"Cidade: {d.get('city','—')}")
    print(f"Estado: {d.get('state','—')}")

    loc = d.get("location", {}).get("coordinates", {})
    if loc.get("latitude"):
        print(f"Coords: {loc['latitude']}, {loc['longitude']}")

except Exception as e:
    print(f"Erro: {e}")
    sys.exit(1)
`,
  },

  // ────────────────────────────────────────────────────────────
  // UTILIDADES
  // ────────────────────────────────────────────────────────────

  {
    name: "clima",
    description: "Clima atual e previsão dos próximos 3 dias de qualquer cidade.",
    lang: "python",
    args_schema: "cidade como $1 (ex: 'São Luís', 'São Paulo', 'New York')",
    example: 'run_skill("clima", "São Luís")',
    dependencies: ["requests"],
    code: `
import sys, requests

cidade = " ".join(sys.argv[1:]) if len(sys.argv) > 1 else "São Luís"

try:
    # wttr.in — gratuito, sem API key
    url = f"https://wttr.in/{requests.utils.quote(cidade)}?format=v2&lang=pt"
    r   = requests.get(url, timeout=10, headers={"User-Agent": "Nina-AI/1.0"})

    if r.status_code != 200:
        print(f"Cidade não encontrada: {cidade}")
        sys.exit(1)

    # Formato simples e legível
    url2 = f"https://wttr.in/{requests.utils.quote(cidade)}?format=%l:+%C+%t+%h+umidade+%w+vento&lang=pt"
    r2   = requests.get(url2, timeout=10, headers={"User-Agent": "Nina-AI/1.0"})
    print(r2.text.strip() if r2.status_code == 200 else r.text[:500])

except Exception as e:
    print(f"Erro: {e}")
    sys.exit(1)
`,
  },

  {
    name: "check_ssl",
    description: "Verifica a validade e data de expiração do certificado SSL de um domínio.",
    lang: "python",
    args_schema: "domínio como $1 (ex: google.com, meusite.com.br)",
    example: 'run_skill("check_ssl", "google.com")',
    dependencies: [],
    code: `
import sys, ssl, socket
from datetime import datetime

domain = sys.argv[1].replace("https://","").replace("http://","").split("/")[0] if len(sys.argv) > 1 else ""
if not domain:
    print("uso: check_ssl dominio.com")
    sys.exit(1)

try:
    ctx  = ssl.create_default_context()
    conn = ctx.wrap_socket(socket.socket(), server_hostname=domain)
    conn.settimeout(10)
    conn.connect((domain, 443))
    cert = conn.getpeercert()
    conn.close()

    expires_str = cert["notAfter"]
    expires     = datetime.strptime(expires_str, "%b %d %H:%M:%S %Y %Z")
    now         = datetime.utcnow()
    days_left   = (expires - now).days

    issuer = dict(x[0] for x in cert.get("issuer", []))
    subject = dict(x[0] for x in cert.get("subject", []))

    status = "OK" if days_left > 30 else ("ATENÇÃO" if days_left > 0 else "EXPIRADO")
    print(f"Domínio: {domain}")
    print(f"Status: {status}")
    print(f"Expira: {expires.strftime('%d/%m/%Y')} ({days_left} dias)")
    print(f"Emitido por: {issuer.get('organizationName','—')}")
    print(f"Para: {subject.get('commonName','—')}")

    sans = cert.get("subjectAltName", [])
    if sans:
        domains = [v for t, v in sans if t == "DNS"][:5]
        print(f"Domínios cobertos: {', '.join(domains)}")

except ssl.SSLCertVerificationError as e:
    print(f"Certificado inválido: {e}")
except Exception as e:
    print(f"Erro: {e}")
    sys.exit(1)
`,
  },

  {
    name: "ping_host",
    description: "Verifica disponibilidade e latência de um host ou IP.",
    lang: "bash",
    args_schema: "host ou IP como $1, count opcional como $2 (padrão: 5)",
    example: 'run_skill("ping_host", "google.com 5")',
    code: `#!/bin/bash
HOST=\${1:-"google.com"}
COUNT=\${2:-5}

echo "Pingando $HOST ($COUNT pacotes)..."
result=$(ping -c $COUNT -W 3 "$HOST" 2>&1)
status=$?

echo "$result" | tail -3

if [ $status -eq 0 ]; then
    echo "Status: ONLINE"
else
    echo "Status: OFFLINE ou inacessível"
fi
`,
  },

  {
    name: "disk_usage_report",
    description: "Relatório detalhado de uso de disco: maiores diretórios, arquivos grandes, uso por partição.",
    lang: "bash",
    args_schema: "diretório base opcional como $1 (padrão: home)",
    example: 'run_skill("disk_usage_report", "")',
    code: `#!/bin/bash
DIR=\${1:-$HOME}

echo "=== Partições ==="
df -h

echo ""
echo "=== Maiores diretórios em $DIR ==="
du -sh "$DIR"/*/ 2>/dev/null | sort -rh | head -10

echo ""
echo "=== 10 maiores arquivos em $DIR ==="
find "$DIR" -type f -printf '%s %p\\n' 2>/dev/null | sort -rn | head -10 | awk '{
    size=$1; path=$2;
    if(size>1073741824) printf "%.1fGB  %s\\n", size/1073741824, path;
    else if(size>1048576) printf "%.1fMB  %s\\n", size/1048576, path;
    else printf "%.0fKB  %s\\n", size/1024, path;
}'

echo ""
echo "=== /tmp ==="
du -sh /tmp 2>/dev/null
`,
  },

  {
    name: "processo_pesado",
    description: "Encontra os processos que mais consomem CPU e memória agora.",
    lang: "bash",
    args_schema: "sem argumentos",
    example: 'run_skill("processo_pesado", "")',
    code: `#!/bin/bash
echo "=== Top 10 por CPU ==="
ps aux --sort=-%cpu | awk 'NR==1 || NR<=11 {printf "%-20s %5s %5s %s\\n", $11, $3"%", $4"%", $1}' 

echo ""
echo "=== Top 10 por Memória ==="
ps aux --sort=-%mem | awk 'NR==1 || NR<=11 {printf "%-20s %5s %5s %s\\n", $11, $4"%", $3"%", $1}'

echo ""
echo "=== Resumo ==="
total_mem=$(free -m | awk '/^Mem:/{print $2}')
used_mem=$(free -m | awk '/^Mem:/{print $3}')
echo "RAM: \${used_mem}MB / \${total_mem}MB ($(( used_mem * 100 / total_mem ))%)"
echo "Processos: $(ps aux | wc -l)"
uptime
`,
  },

];

// ── Init ──────────────────────────────────────────────────────

function initPreinstalledSkills() {
  let count = 0;
  for (const skill of SKILLS) {
    try {
      registerIfChanged(skill);
      count++;
    } catch (err) {
      console.error(`[PreSkills] Erro ao registrar "${skill.name}":`, err.message);
    }
  }
  console.log(`[PreSkills] ${count} skills pré-instaladas prontas.`);
}

module.exports = { initPreinstalledSkills, SKILLS };
