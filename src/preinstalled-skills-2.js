// ============================================================
//  Nina v4 — Skills Pré-instaladas (Pack 2)
//  Finanças BR | Produtividade | Redes & Segurança | Mídia
// ============================================================

const crypto = require("crypto");
const { registerSkill, getSkill } = require("./skills");

function registerIfChanged(opts) {
  const hash = crypto.createHash("md5").update(opts.code).digest("hex").slice(0, 8);
  const existing = getSkill(opts.name);
  if (existing?.codeHash === hash) return;
  registerSkill({ ...opts, codeHash: hash });
  console.log(`[PreSkills2] "${opts.name}" ${existing ? "atualizada" : "registrada"}`);
}

const SKILLS_2 = [
  {
    name: "cotacao_b3",
    description: "Cota\u00e7\u00e3o atual de a\u00e7\u00e3o ou FII na B3. Ex: PETR4, MXRF11, VALE3.",
    lang: "python",
    args_schema: "ticker como $1",
    example: "run_skill(\"cotacao_b3\", \"MXRF11\")",
    dependencies: ["requests"],
    code: `
import sys, requests
ticker = sys.argv[1].upper().strip() if len(sys.argv)>1 else "PETR4"
try:
    r = requests.get(f"https://brapi.dev/api/quote/{ticker}", timeout=10, headers={"User-Agent":"Nina-AI/1.0"})
    d = r.json().get("results",[])
    if not d: print(f"Ticker {ticker} nao encontrado"); sys.exit(1)
    d = d[0]
    p=d.get("regularMarketPrice",0); c=d.get("regularMarketChange",0); pct=d.get("regularMarketChangePercent",0)
    h=d.get("regularMarketDayHigh",0); lo=d.get("regularMarketDayLow",0); name=d.get("longName") or ticker
    sign="+" if c>=0 else ""
    print(f"{ticker} - {name}"); print(f"Preco:    R$ {p:.2f}"); print(f"Variacao: {sign}{c:.2f} ({sign}{pct:.2f}%)")
    print(f"Max/Min:  R$ {h:.2f} / R$ {lo:.2f}")
except Exception as e: print(f"Erro: {e}"); sys.exit(1)
`,
  },

  {
    name: "carteira_b3",
    description: "Resumo de m\u00faltiplos ativos B3 de uma vez.",
    lang: "python",
    args_schema: "tickers separados por espa\u00e7o",
    example: "run_skill(\"carteira_b3\", \"PETR4 VALE3 MXRF11\")",
    dependencies: ["requests"],
    code: `
import sys, requests
tickers=[t.upper() for t in sys.argv[1:] if t]
if not tickers: print("uso: carteira_b3 TICKER1 TICKER2"); sys.exit(1)
try:
    r=requests.get(f"https://brapi.dev/api/quote/{','.join(tickers)}",timeout=15,headers={"User-Agent":"Nina-AI/1.0"})
    results=r.json().get("results",[])
    print(f"{'TICKER':<8} {'PRECO':>8} {'VAR%':>7} {'MAX':>8} {'MIN':>8}"); print("-"*46)
    for d in results:
        t=d.get("symbol","?"); p=d.get("regularMarketPrice",0); pct=d.get("regularMarketChangePercent",0)
        h=d.get("regularMarketDayHigh",0); l=d.get("regularMarketDayLow",0); sign="+" if pct>=0 else ""
        print(f"{t:<8} R\${p:>7.2f} {sign}{pct:>6.2f}% R\${h:>6.2f} R\${l:>6.2f}")
    print(f"
{len(results)} ativo(s)")
except Exception as e: print(f"Erro: {e}"); sys.exit(1)
`,
  },

  {
    name: "dividendos_fii",
    description: "Hist\u00f3rico de dividendos de FII com yield calculado.",
    lang: "python",
    args_schema: "ticker do FII como $1",
    example: "run_skill(\"dividendos_fii\", \"MXRF11\")",
    dependencies: ["requests"],
    code: `
import sys, requests
ticker=sys.argv[1].upper().strip() if len(sys.argv)>1 else "MXRF11"
try:
    r=requests.get(f"https://brapi.dev/api/quote/{ticker}?dividends=true",timeout=10,headers={"User-Agent":"Nina-AI/1.0"})
    results=r.json().get("results",[])
    if not results: print(f"FII {ticker} nao encontrado"); sys.exit(1)
    d=results[0]; price=d.get("regularMarketPrice",0); divs=d.get("dividendsData",{}).get("cashDividends",[])
    print(f"{ticker} - R$ {price:.2f}")
    if not divs: print("Sem historico"); sys.exit(0)
    print(f"{'DATA':<12} {'VALOR':>8} {'YIELD':>7}"); print("-"*30)
    total=0
    for dv in divs[:12]:
        date=dv.get("paymentDate","?")[:10]; value=dv.get("rate",0); yld=(value/price*100) if price>0 else 0
        total+=value; print(f"{date:<12} R\${value:>6.4f} {yld:>6.2f}%")
    annual=(total/price*100) if price>0 else 0
    print(f"
Total 12m: R$ {total:.4f} | Yield: {annual:.2f}% a.a.")
except Exception as e: print(f"Erro: {e}"); sys.exit(1)
`,
  },

  {
    name: "dolar_ptax",
    description: "Cota\u00e7\u00e3o oficial PTAX do Banco Central.",
    lang: "python",
    args_schema: "data opcional YYYY-MM-DD (padr\u00e3o: hoje)",
    example: "run_skill(\"dolar_ptax\", \"\")",
    dependencies: ["requests"],
    code: `
import sys, requests
from datetime import datetime, timedelta
ds=sys.argv[1].strip() if len(sys.argv)>1 and sys.argv[1].strip() else datetime.now().strftime("%Y-%m-%d")
parts=ds.split("-"); bcb=f"{parts[1]}-{parts[2]}-{parts[0]}" if len(parts)==3 else ds
url=f"https://olinda.bcb.gov.br/olinda/servico/PTAX/versao/v1/odata/CotacaoDolarDia(dataCotacao=@dataCotacao)?@dataCotacao='{bcb}'&$top=1&$format=json"
try:
    vals=requests.get(url,timeout=10).json().get("value",[])
    if not vals:
        prev=(datetime.strptime(ds,"%Y-%m-%d")-timedelta(days=1)).strftime("%Y-%m-%d")
        p=prev.split("-"); url2=url.replace(f"'{bcb}'",f"'{p[1]}-{p[2]}-{p[0]}'")
        vals=requests.get(url2,timeout=10).json().get("value",[]); ds=prev if vals else ds
    if not vals: print(f"PTAX nao disponivel para {ds}"); sys.exit(1)
    v=vals[0]; c=v.get("cotacaoCompra",0); ve=v.get("cotacaoVenda",0)
    print(f"PTAX - {ds}"); print(f"Compra: R$ {c:.4f}"); print(f"Venda:  R$ {ve:.4f}"); print(f"Media:  R$ {(c+ve)/2:.4f}")
except Exception as e: print(f"Erro: {e}"); sys.exit(1)
`,
  },

  {
    name: "selic_atual",
    description: "Taxa Selic atual do Banco Central e hist\u00f3rico recente.",
    lang: "python",
    args_schema: "sem argumentos",
    example: "run_skill(\"selic_atual\", \"\")",
    dependencies: ["requests"],
    code: `
import requests
try:
    data=requests.get("https://api.bcb.gov.br/dados/serie/bcdata.sgs.432/dados/ultimos/12?formato=json",timeout=10).json()
    latest=data[-1]; selic=float(latest["valor"]); cdi=((1+selic/100)**(1/252)-1)*100
    print(f"Selic: {selic}% a.a. | CDI diario: {cdi:.6f}%")
    print(f"Referencia: {latest['data']}
Historico:")
    for e in data[-6:]: print(f"  {e['data']}: {e['valor']}%")
except Exception as e: print(f"Erro: {e}")
`,
  },

  {
    name: "extrair_texto_pdf",
    description: "Extrai texto completo de um PDF.",
    lang: "python",
    args_schema: "caminho do PDF como $1",
    example: "run_skill(\"extrair_texto_pdf\", \"~/Documents/contrato.pdf\")",
    dependencies: ["pymupdf"],
    code: `
import sys, os
pdf=os.path.expanduser(sys.argv[1]) if len(sys.argv)>1 else ""
if not pdf or not os.path.exists(pdf): print(f"Nao encontrado: {pdf}"); sys.exit(1)
try:
    import fitz
    doc=fitz.open(pdf); pages=[f"[Pagina {i+1}]
{p.get_text().strip()}" for i,p in enumerate(doc) if p.get_text().strip()]
    doc.close(); full="

".join(pages)
    print(f"PDF: {os.path.basename(pdf)} | {len(pages)} paginas | {len(full):,} chars"); print("-"*50)
    print(full[:8000])
    if len(full)>8000: print(f"
...({len(full)-8000:,} chars restantes)")
except ImportError: os.system("pip3 install pymupdf --break-system-packages -q"); print("pymupdf instalado - rode novamente")
except Exception as e: print(f"Erro: {e}"); sys.exit(1)
`,
  },

  {
    name: "resumir_pdf",
    description: "Resume conte\u00fado de PDF usando DeepSeek.",
    lang: "python",
    args_schema: "caminho do PDF como $1, instru\u00e7\u00e3o como $2",
    example: "run_skill(\"resumir_pdf\", \"~/relatorio.pdf\")",
    dependencies: ["pymupdf", "requests"],
    code: `
import sys, os, requests
pdf=os.path.expanduser(sys.argv[1]) if len(sys.argv)>1 else ""
inst=" ".join(sys.argv[2:]) if len(sys.argv)>2 else "Faca um resumo executivo em portugues."
if not pdf or not os.path.exists(pdf): print(f"Nao encontrado: {pdf}"); sys.exit(1)
KEY=os.environ.get("DEEPSEEK_API_KEY","")
if not KEY: print("DEEPSEEK_API_KEY nao configurada"); sys.exit(1)
try:
    import fitz
    doc=fitz.open(pdf); text="

".join(p.get_text().strip() for p in doc if p.get_text().strip()); doc.close()
except ImportError: os.system("pip3 install pymupdf --break-system-packages -q"); print("pymupdf instalado - rode novamente"); sys.exit(1)
if len(text)>12000: text=text[:12000]+"
...[truncado]"
print(f"Resumindo: {os.path.basename(pdf)}...")
try:
    r=requests.post("https://api.deepseek.com/v1/chat/completions",
        headers={"Authorization":f"Bearer {KEY}","Content-Type":"application/json"},
        json={"model":"deepseek-chat","messages":[{"role":"system","content":"Voce resume documentos de forma clara."},{"role":"user","content":f"{inst}

Documento:
{text}"}],"temperature":0.3,"max_tokens":1000},timeout=60)
    print(r.json()["choices"][0]["message"]["content"])
except Exception as e: print(f"Erro: {e}"); sys.exit(1)
`,
  },

  {
    name: "ocr_imagem",
    description: "L\u00ea texto de imagem via OCR (tesseract).",
    lang: "python",
    args_schema: "caminho da imagem como $1",
    example: "run_skill(\"ocr_imagem\", \"~/foto.jpg\")",
    dependencies: [],
    code: `
import sys, os, subprocess
img=os.path.expanduser(sys.argv[1]) if len(sys.argv)>1 else ""
lang=sys.argv[2] if len(sys.argv)>2 else "por+eng"
if not img or not os.path.exists(img): print(f"Nao encontrado: {img}"); sys.exit(1)
try:
    r=subprocess.run(["tesseract",img,"stdout","-l",lang],capture_output=True,text=True,timeout=30)
    if r.returncode!=0: os.system("apt-get install -y tesseract-ocr tesseract-ocr-por 2>/dev/null"); r=subprocess.run(["tesseract",img,"stdout","-l",lang],capture_output=True,text=True,timeout=30)
    print(f"OCR: {os.path.basename(img)}
"+"-"*40); print(r.stdout.strip() or "Nenhum texto detectado")
except FileNotFoundError: os.system("apt-get install -y tesseract-ocr tesseract-ocr-por 2>/dev/null"); print("tesseract instalado - rode novamente")
except Exception as e: print(f"Erro: {e}"); sys.exit(1)
`,
  },

  {
    name: "compactar_arquivos",
    description: "Cria arquivo ZIP de arquivos ou pastas.",
    lang: "python",
    args_schema: "nome.zip arquivo1 arquivo2 ...",
    example: "run_skill(\"compactar_arquivos\", \"backup.zip ~/Documents\")",
    dependencies: [],
    code: `
import sys, os, zipfile
from pathlib import Path
args=sys.argv[1:]
if len(args)<2: print("uso: nome.zip arquivo1 arquivo2 ..."); sys.exit(1)
out=os.path.expanduser(args[0]); targets=[os.path.expanduser(a) for a in args[1:]]
print(f"Compactando {len(targets)} item(s) em {out}...")
with zipfile.ZipFile(out,"w",zipfile.ZIP_DEFLATED) as zf:
    for t in targets:
        p=Path(t)
        if not p.exists(): print(f"Nao encontrado: {t}"); continue
        if p.is_dir():
            for f in p.rglob("*"):
                if f.is_file(): zf.write(f,f.relative_to(p.parent))
        else: zf.write(p,p.name)
print(f"Criado: {out} ({os.path.getsize(out)/1024/1024:.1f}MB)")
`,
  },

  {
    name: "converter_csv_json",
    description: "Converte CSV para JSON ou JSON para CSV.",
    lang: "python",
    args_schema: "arquivo_entrada sa\u00edda.json|csv",
    example: "run_skill(\"converter_csv_json\", \"dados.csv dados.json\")",
    dependencies: [],
    code: `
import sys, os, json, csv
src=os.path.expanduser(sys.argv[1]) if len(sys.argv)>1 else ""; dst=os.path.expanduser(sys.argv[2]) if len(sys.argv)>2 else ""
if not src or not dst: print("uso: arquivo_entrada saida.json|csv"); sys.exit(1)
if not os.path.exists(src): print(f"Nao encontrado: {src}"); sys.exit(1)
se=os.path.splitext(src)[1].lower(); de=os.path.splitext(dst)[1].lower()
try:
    if se==".csv" and de==".json":
        with open(src,encoding="utf-8-sig") as f: rows=list(csv.DictReader(f))
        with open(dst,"w",encoding="utf-8") as f: json.dump(rows,f,ensure_ascii=False,indent=2)
        print(f"Convertido: {len(rows)} linhas CSV->JSON | {dst}")
    elif se==".json" and de==".csv":
        with open(src,encoding="utf-8") as f: data=json.load(f)
        if isinstance(data,dict): data=[data]
        keys=list(data[0].keys()) if data else []
        with open(dst,"w",newline="",encoding="utf-8") as f: w=csv.DictWriter(f,fieldnames=keys); w.writeheader(); w.writerows(data)
        print(f"Convertido: {len(data)} registros JSON->CSV | {dst}")
    else: print(f"Nao suportado: {se}->{de}"); sys.exit(1)
except Exception as e: print(f"Erro: {e}"); sys.exit(1)
`,
  },

  {
    name: "whois",
    description: "Informa\u00e7\u00f5es de registro de dom\u00ednio ou IP.",
    lang: "python",
    args_schema: "dom\u00ednio ou IP como $1",
    example: "run_skill(\"whois\", \"google.com\")",
    dependencies: ["requests"],
    code: `
import sys, subprocess
target=sys.argv[1] if len(sys.argv)>1 else ""
if not target: print("uso: whois dominio.com"); sys.exit(1)
print(f"=== WHOIS: {target} ===")
try:
    r=subprocess.run(["whois",target],capture_output=True,text=True,timeout=15)
    if r.returncode!=0: subprocess.run(["apt-get","install","-y","whois"],capture_output=True); r=subprocess.run(["whois",target],capture_output=True,text=True,timeout=15)
    lines=[l for l in r.stdout.split("
") if any(k in l.lower() for k in ["domain","registrant","registrar","creation","expir","updated","name server","country","status"])]
    print("
".join(lines[:25]))
except Exception as e: print(f"Whois error: {e}")
print("
=== DNS ===")
try:
    for q in ["A","MX"]:
        r2=subprocess.run(["dig","+short",q,target],capture_output=True,text=True,timeout=5)
        if r2.stdout.strip(): print(f"{q}: {r2.stdout.strip()}")
except: pass
`,
  },

  {
    name: "traceroute",
    description: "Rastreia a rota de pacotes at\u00e9 um host.",
    lang: "python",
    args_schema: "host como $1, max saltos como $2",
    example: "run_skill(\"traceroute\", \"google.com\")",
    dependencies: [],
    code: `
import sys, subprocess
host=sys.argv[1] if len(sys.argv)>1 else "google.com"; hops=sys.argv[2] if len(sys.argv)>2 else "20"
print(f"Traceroute para {host} (max {hops} saltos)..."); print("-"*50)
for cmd in [["traceroute","-m",hops,"-w","2",host],["tracepath",host]]:
    try:
        r=subprocess.run(cmd,capture_output=True,text=True,timeout=30)
        if r.returncode==0: print(r.stdout[:2000]); sys.exit(0)
    except FileNotFoundError: continue
print("traceroute nao disponivel. instale: apt install traceroute")
`,
  },

  {
    name: "scan_portas",
    description: "Verifica portas abertas em um host.",
    lang: "python",
    args_schema: "host como $1, portas como $2 (ex: 80,443,22)",
    example: "run_skill(\"scan_portas\", \"meusite.com 80,443,22,3306\")",
    dependencies: [],
    code: `
import sys, socket, subprocess
host=sys.argv[1] if len(sys.argv)>1 else "localhost"
ports_str=sys.argv[2] if len(sys.argv)>2 else "22,80,443,3306,5432,6379,8080,27017"
print(f"Scan: {host} | Portas: {ports_str}"); print("-"*35)
try:
    r=subprocess.run(["nmap","-p",ports_str,"--open","-T4",host],capture_output=True,text=True,timeout=30)
    if r.returncode==0:
        for line in r.stdout.split("
"):
            if any(k in line for k in ["PORT","tcp","Nmap","Host"]): print(line)
        sys.exit(0)
except FileNotFoundError: pass
for port in [p.strip() for p in ports_str.split(",") if p.strip()]:
    try:
        s=socket.socket(); s.settimeout(2); res=s.connect_ex((host,int(port))); s.close()
        print(f"{'ABERTA' if res==0 else 'fechada'}  {port}/tcp")
    except Exception as e: print(f"erro     {port} ({e})")
`,
  },

  {
    name: "headers_http",
    description: "Headers HTTP de resposta de uma URL. \u00datil para debug e seguran\u00e7a.",
    lang: "python",
    args_schema: "URL como $1",
    example: "run_skill(\"headers_http\", \"https://meusite.com.br\")",
    dependencies: ["requests"],
    code: `
import sys, requests
url=sys.argv[1] if len(sys.argv)>1 else ""
if not url: print("uso: headers_http https://url.com"); sys.exit(1)
if not url.startswith("http"): url="https://"+url
try:
    r=requests.get(url,timeout=10,allow_redirects=True,headers={"User-Agent":"Nina-AI/1.0"})
    print(f"URL: {r.url}
Status: {r.status_code} {r.reason}
Tempo: {r.elapsed.total_seconds():.3f}s
")
    for k,v in sorted(r.headers.items()): print(f"  {k}: {v}")
    print("
Seguranca:")
    for h,name in [("Strict-Transport-Security","HSTS"),("Content-Security-Policy","CSP"),("X-Frame-Options","Clickjacking"),("X-Content-Type-Options","MIME")]:
        print(f"  [{'OK' if h in r.headers else 'AUSENTE'}] {name}")
except Exception as e: print(f"Erro: {e}"); sys.exit(1)
`,
  },

  {
    name: "vazamento_email",
    description: "Verifica se email foi vazado via Have I Been Pwned.",
    lang: "python",
    args_schema: "email como $1",
    example: "run_skill(\"vazamento_email\", \"usuario@gmail.com\")",
    dependencies: ["requests"],
    code: `
import sys, requests
email=sys.argv[1].strip().lower() if len(sys.argv)>1 else ""
if not email or "@" not in email: print("Email invalido"); sys.exit(1)
try:
    r=requests.get(f"https://haveibeenpwned.com/api/v3/breachedaccount/{requests.utils.quote(email)}",
        headers={"User-Agent":"Nina-AI-BreachCheck/1.0"},timeout=10)
    if r.status_code==404: print(f"{email}: NAO encontrado em vazamentos")
    elif r.status_code==401: print("Requer API key do HIBP (haveibeenpwned.com/api/key)")
    elif r.status_code==200:
        bs=r.json(); print(f"ATENCAO: {email} em {len(bs)} vazamento(s)!")
        for b in bs[:10]:
            print(f"  {b.get('BreachDate','?')} - {b.get('Name','?')} ({b.get('PwnCount',0):,} contas)")
    else: print(f"Status: {r.status_code}")
except Exception as e: print(f"Erro: {e}"); sys.exit(1)
`,
  },

  {
    name: "baixar_video",
    description: "Baixa v\u00eddeo ou \u00e1udio de YouTube, Instagram, TikTok e 1000+ sites via yt-dlp.",
    lang: "python",
    args_schema: "URL como $1, formato como $2 (video|audio), qualidade como $3 (best|720p|480p)",
    example: "run_skill(\"baixar_video\", \"https://youtube.com/... audio\")",
    dependencies: [],
    code: `
import sys, os, subprocess
from pathlib import Path
url=sys.argv[1] if len(sys.argv)>1 else ""; fmt=sys.argv[2] if len(sys.argv)>2 else "video"; quality=sys.argv[3] if len(sys.argv)>3 else "best"
if not url: print("uso: URL [video|audio] [best|720p|480p]"); sys.exit(1)
outdir=Path.home()/"nina-files"/"media"; outdir.mkdir(parents=True,exist_ok=True)
try: subprocess.run(["yt-dlp","--version"],capture_output=True,check=True)
except: os.system("pip3 install yt-dlp --break-system-packages -q")
print(f"Baixando: {url[:80]}
Formato: {fmt} | Qualidade: {quality}
Destino: {outdir}"); print("-"*40)
tpl=str(outdir/"%(title)s.%(ext)s")
if fmt=="audio": cmd=["yt-dlp","-x","--audio-format","mp3","--audio-quality","0","-o",tpl,"--no-playlist",url]
else:
    fmts={"720p":"bestvideo[height<=720]+bestaudio/best[height<=720]","480p":"bestvideo[height<=480]+bestaudio/best[height<=480]","best":"bestvideo+bestaudio/best"}
    cmd=["yt-dlp","-f",fmts.get(quality,fmts["best"]),"--merge-output-format","mp4","-o",tpl,"--no-playlist",url]
r=subprocess.run(cmd,text=True,timeout=300)
if r.returncode==0:
    print(f"
Concluido em: {outdir}")
    files=sorted(outdir.iterdir(),key=lambda f:f.stat().st_mtime,reverse=True)
    for f in files[:3]: print(f"  {f.name} ({f.stat().st_size/1024/1024:.1f}MB)")
`,
  },

  {
    name: "converter_audio",
    description: "Converte \u00e1udio entre formatos: mp3, wav, ogg, flac, aac.",
    lang: "python",
    args_schema: "arquivo_entrada.ext sa\u00edda.ext",
    example: "run_skill(\"converter_audio\", \"~/audio.wav ~/audio.mp3\")",
    dependencies: [],
    code: `
import sys, os, subprocess
src=os.path.expanduser(sys.argv[1]) if len(sys.argv)>1 else ""; dst=os.path.expanduser(sys.argv[2]) if len(sys.argv)>2 else ""
if not src or not dst: print("uso: arquivo.ext saida.ext"); sys.exit(1)
if not os.path.exists(src): print(f"Nao encontrado: {src}"); sys.exit(1)
ext=os.path.splitext(dst)[1].lower().lstrip(".")
codecs={"mp3":"libmp3lame","wav":"pcm_s16le","ogg":"libvorbis","flac":"flac","aac":"aac","m4a":"aac"}
codec=codecs.get(ext,"copy")
print(f"Convertendo: {os.path.basename(src)} -> {os.path.basename(dst)}")
r=subprocess.run(["ffmpeg","-i",src,"-acodec",codec,"-y",dst],capture_output=True,text=True,timeout=120)
if r.returncode==0: print(f"Convertido: {dst} ({os.path.getsize(dst)/1024/1024:.1f}MB)")
else:
    if "not found" in r.stderr.lower(): os.system("apt-get install -y ffmpeg 2>/dev/null"); print("ffmpeg instalado - rode novamente")
    else: print(f"Erro: {r.stderr[-300:]}")
`,
  },

  {
    name: "extrair_audio",
    description: "Extrai faixa de \u00e1udio de v\u00eddeo e salva como mp3.",
    lang: "python",
    args_schema: "arquivo_video como $1, sa\u00edda.mp3 como $2 (opcional)",
    example: "run_skill(\"extrair_audio\", \"~/video.mp4\")",
    dependencies: [],
    code: `
import sys, os, subprocess
src=os.path.expanduser(sys.argv[1]) if len(sys.argv)>1 else ""; dst=os.path.expanduser(sys.argv[2]) if len(sys.argv)>2 else src.rsplit(".",1)[0]+".mp3"
if not src or not os.path.exists(src): print(f"Nao encontrado: {src}"); sys.exit(1)
print(f"Extraindo audio de: {os.path.basename(src)}")
r=subprocess.run(["ffmpeg","-i",src,"-vn","-acodec","libmp3lame","-q:a","2","-y",dst],capture_output=True,text=True,timeout=300)
if r.returncode==0: print(f"Audio: {dst} ({os.path.getsize(dst)/1024/1024:.1f}MB)")
else:
    if "not found" in r.stderr.lower(): os.system("apt-get install -y ffmpeg 2>/dev/null"); print("ffmpeg instalado - rode novamente")
    else: print(f"Erro: {r.stderr[-300:]}")
`,
  },

  {
    name: "info_midia",
    description: "Metadados completos de m\u00eddia: dura\u00e7\u00e3o, codec, bitrate, resolu\u00e7\u00e3o.",
    lang: "python",
    args_schema: "arquivo de m\u00eddia como $1",
    example: "run_skill(\"info_midia\", \"~/video.mp4\")",
    dependencies: [],
    code: `
import sys, os, subprocess, json
f=os.path.expanduser(sys.argv[1]) if len(sys.argv)>1 else ""
if not f or not os.path.exists(f): print(f"Nao encontrado: {f}"); sys.exit(1)
print(f"Arquivo: {os.path.basename(f)}
Tamanho: {os.path.getsize(f)/1024/1024:.1f}MB")
r=subprocess.run(["ffprobe","-v","quiet","-print_format","json","-show_format","-show_streams",f],capture_output=True,text=True,timeout=15)
if r.returncode!=0: os.system("apt-get install -y ffmpeg 2>/dev/null"); print("ffmpeg instalado - rode novamente"); sys.exit(1)
try:
    d=json.loads(r.stdout); fmt=d.get("format",{}); dur=float(fmt.get("duration",0))
    print(f"Duracao:  {dur:.1f}s ({dur/60:.1f}min)
Bitrate:  {int(fmt.get('bit_rate',0))//1000} kbps
Formato:  {fmt.get('format_long_name','?')}")
    for s in d.get("streams",[]):
        t=s.get("codec_type","?"); c=s.get("codec_name","?")
        if t=="video": print(f"Video:    {c} {s.get('width','?')}x{s.get('height','?')}")
        elif t=="audio": print(f"Audio:    {c} {s.get('sample_rate','?')}Hz {s.get('channels','?')}ch")
except Exception as e: print(f"Erro ao parsear: {e}")
`,
  },

];

function initPreinstalledSkills2() {
  let count = 0;
  for (const skill of SKILLS_2) {
    try {
      registerIfChanged(skill);
      count++;
    } catch (err) {
      console.error(`[PreSkills2] Erro ao registrar "${skill.name}":`, err.message);
    }
  }
  console.log(`[PreSkills2] ${count} skills (pack 2) prontas.`);
}

module.exports = { initPreinstalledSkills2, SKILLS_2 };