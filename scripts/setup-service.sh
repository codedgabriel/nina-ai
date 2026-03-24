#!/bin/bash
# ============================================================
#  Nina v4 — Instala como serviço systemd
#  Roda como: sudo bash scripts/setup-service.sh
# ============================================================

set -e

NINA_DIR="$(cd "$(dirname "$0")/.." && pwd)"
NINA_USER="${SUDO_USER:-$(whoami)}"
NODE_PATH="$(which node)"

echo "[Nina] Instalando serviço systemd..."
echo "  Diretório: $NINA_DIR"
echo "  Usuário:   $NINA_USER"
echo "  Node:      $NODE_PATH"

# ── Serviço de memória vetorial ───────────────────────────────
cat > /etc/systemd/system/nina-memory.service << UNIT
[Unit]
Description=Nina Memory — ChromaDB vetorial
After=network.target

[Service]
Type=simple
User=$NINA_USER
WorkingDirectory=$NINA_DIR/memory
ExecStart=/usr/bin/python3 $NINA_DIR/memory/server.py
Restart=always
RestartSec=5
StandardOutput=append:$NINA_DIR/nina-memory.log
StandardError=append:$NINA_DIR/nina-memory.log

[Install]
WantedBy=multi-user.target
UNIT

# ── Serviço principal da Nina ─────────────────────────────────
cat > /etc/systemd/system/nina.service << UNIT
[Unit]
Description=Nina AI — Assistente pessoal
After=network-online.target nina-memory.service
Wants=network-online.target nina-memory.service

[Service]
Type=simple
User=$NINA_USER
WorkingDirectory=$NINA_DIR
ExecStart=$NODE_PATH $NINA_DIR/src/index.js
Restart=always
RestartSec=10
StartLimitInterval=120
StartLimitBurst=5
EnvironmentFile=-/etc/nina.env
StandardOutput=append:$NINA_DIR/nina.log
StandardError=append:$NINA_DIR/nina.log
LimitNOFILE=65536

[Install]
WantedBy=multi-user.target
UNIT

# ── Arquivo de credenciais ────────────────────────────────────
if [ ! -f /etc/nina.env ]; then
  cat > /etc/nina.env << ENV
# Nina — credenciais
# Edite e rode: sudo systemctl restart nina

DEEPSEEK_API_KEY=
GROQ_API_KEY=
GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=
BINANCE_API_KEY=
BINANCE_API_SECRET=
ENV
  chmod 600 /etc/nina.env
  echo ""
  echo "[Nina] IMPORTANTE: edite /etc/nina.env com suas credenciais antes de continuar"
  echo "  sudo nano /etc/nina.env"
  read -p "  Pressione Enter quando terminar..."
fi

# ── Ativa serviços ────────────────────────────────────────────
systemctl daemon-reload
systemctl enable nina-memory nina
systemctl start nina-memory
sleep 3
systemctl start nina

echo ""
echo "Pronto. Nina rodando como serviço do sistema."
echo ""
echo "sudo systemctl status nina          # status"
echo "sudo systemctl restart nina         # reinicia"  
echo "sudo systemctl stop nina            # para"
echo "sudo journalctl -u nina -f          # logs ao vivo"
echo "sudo nano /etc/nina.env             # credenciais"
echo "cat $NINA_DIR/nina.log              # log completo"
