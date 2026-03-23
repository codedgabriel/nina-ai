# ============================================================
#  Nina — Microserviço de Memória Vetorial (ChromaDB)
#  Roda em paralelo com o Node.js na porta 5001
# ============================================================

from fastapi import FastAPI, HTTPException
from pydantic import BaseModel
from typing import Optional
import chromadb
import uvicorn
import os

app = FastAPI()

# Banco vetorial salvo em disco
CHROMA_PATH = os.path.join(os.path.dirname(__file__), "chroma_db")
chroma_client = chromadb.PersistentClient(path=CHROMA_PATH)

# Coleção principal de mensagens
collection = chroma_client.get_or_create_collection(
    name="nina_messages",
    metadata={"hnsw:space": "cosine"}
)

# ── Modelos ──────────────────────────────────────────────────

class SaveRequest(BaseModel):
    id: str
    text: str
    role: str          # "user" ou "nina"
    from_number: str
    created_at: str

class SearchRequest(BaseModel):
    query: str
    from_number: Optional[str] = None
    limit: int = 5

# ── Rotas ────────────────────────────────────────────────────

@app.post("/save")
def save_message(req: SaveRequest):
    try:
        collection.upsert(
            ids=[req.id],
            documents=[req.text],
            metadatas=[{
                "role":        req.role,
                "from_number": req.from_number,
                "created_at":  req.created_at,
            }]
        )
        return {"ok": True}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/search")
def search_messages(req: SearchRequest):
    try:
        where = {"from_number": req.from_number} if req.from_number else None

        results = collection.query(
            query_texts=[req.query],
            n_results=min(req.limit, collection.count() or 1),
            where=where,
        )

        items = []
        if results["documents"] and results["documents"][0]:
            for doc, meta in zip(results["documents"][0], results["metadatas"][0]):
                items.append({
                    "text":       doc,
                    "role":       meta.get("role"),
                    "created_at": meta.get("created_at"),
                })
        return {"results": items}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/health")
def health():
    return {"ok": True, "count": collection.count()}

# ── Start ────────────────────────────────────────────────────

if __name__ == "__main__":
    print("[Nina Memory] Iniciando na porta 5001...")
    uvicorn.run(app, host="127.0.0.1", port=5001, log_level="warning")
