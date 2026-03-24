#!/bin/bash
# ============================================================
#  Nina v4 — Start
# ============================================================

cd "$(dirname "$0")"

# DeepSeek obrigatório
if [ -z "$DEEPSEEK_API_KEY" ]; then
  echo "[Nina] ERRO: DEEPSEEK_API_KEY não definida."
  echo "       export DEEPSEEK_API_KEY=sk-..."
  exit 1
fi

# Groq opcional (áudio)
if [ -z "$GROQ_API_KEY" ]; then
  echo "[Nina] AVISO: GROQ_API_KEY não definida — transcrição de áudio desativada."
else
  echo "[Nina] Groq Whisper ativo."
fi

echo "[Nina] Iniciando memória vetorial..."
python3 memory/server.py &
MEMORY_PID=$!
sleep 3

echo "[Nina] Iniciando WhatsApp..."
npm start

kill $MEMORY_PID 2>/dev/null
