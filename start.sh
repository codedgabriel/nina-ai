#!/bin/bash
# ============================================================
#  Nina — Inicia todos os serviços
# ============================================================

cd "$(dirname "$0")"

echo "[Nina] Iniciando serviço de memória vetorial..."
python3 memory/server.py &
MEMORY_PID=$!

# Aguarda o serviço de memória subir
sleep 3

echo "[Nina] Iniciando WhatsApp..."
npm start

# Se o Node morrer, mata o Python também
kill $MEMORY_PID 2>/dev/null
