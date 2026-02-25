#!/bin/bash
# Inicia o microserviço de memória vetorial da Nina
cd "$(dirname "$0")"
echo "[Nina Memory] Iniciando servidor ChromaDB..."
python3 server.py
