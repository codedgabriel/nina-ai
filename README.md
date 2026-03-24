# Nina v4 — Agentic AI via WhatsApp

Assistente pessoal que roda no seu servidor Ubuntu e responde via WhatsApp.
Usa **DeepSeek API** (nuvem) com function calling real — sem Ollama, sem GPU.

## Setup

### 1. Instala dependências

```bash
npm install
pip3 install fastapi uvicorn chromadb pydantic
```

### 2. Pega a API key do DeepSeek

Cria conta em [platform.deepseek.com](https://platform.deepseek.com) e gera uma API key.

### 3. Exporta a variável

```bash
# Coloca no ~/.bashrc ou ~/.zshrc pra persistir
export DEEPSEEK_API_KEY=sk-xxxxxxxxxxxxxxxx
```

### 4. Inicia

```bash
./start.sh
```

Escaneie o QR Code com o WhatsApp e pronto.

---

## Capacidades

| Ferramenta | O que faz |
|---|---|
| `run_shell` | Executa qualquer comando no servidor |
| `run_script` | Cria e executa scripts Python/Bash/Node |
| `list_processes` / `kill_process` | Gerencia processos |
| `get_system_stats` | CPU, RAM, disco, uptime |
| `read_file` / `write_file` | Lê e escreve arquivos |
| `list_dir` / `find_files` | Navega o sistema de arquivos |
| `search_web` | Busca no DuckDuckGo |
| `fetch_url` | Acessa qualquer URL ou API |
| `save_note` / `find_notes` | Notas persistentes |
| `search_memory` | Busca nas conversas antigas |
| `set_reminder` / `list_reminders` | Lembretes por horário |
| `schedule_script` | Agenda scripts com cron |
| `restart_self` / `self_update` | Auto-gestão do processo |

## Modelos disponíveis no DeepSeek

| Modelo | Uso |
|---|---|
| `deepseek-chat` | Padrão — rápido e capaz |
| `deepseek-reasoner` | Raciocínio complexo (mais lento) |

Para mudar o modelo, edite `DEEPSEEK_MODEL` em `src/config.js`.

## Exemplos de uso

```
"cria um script python que faz backup de ~/Documents e comprime em tar.gz"
"qual o uso de CPU agora e quais os processos mais pesados?"
"busca nas minhas notas sobre o projeto X"
"me lembra às 9h de tomar remédio"
"faz um script que roda todo dia às 8h e me manda o resumo do clima"
"atualiza o código e reinicia"
```
