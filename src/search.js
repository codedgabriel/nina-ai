// ============================================================
//  Nina — Busca na Web (DuckDuckGo, sem API key)
// ============================================================

const axios = require("axios");

const SEARCH_TIMEOUT = 10_000;

/**
 * Busca no DuckDuckGo Instant Answer API.
 * Retorna um resumo ou null se não encontrar.
 */
async function searchWeb(query) {
  try {
    const res = await axios.get("https://api.duckduckgo.com/", {
      params: {
        q:              query,
        format:         "json",
        no_html:        1,
        skip_disambig:  1,
        no_redirect:    1,
      },
      timeout: SEARCH_TIMEOUT,
      headers: { "User-Agent": "Nina-AI/1.0" },
    });

    const data = res.data;

    // Resposta direta (ex: "quem é Elon Musk")
    if (data.AbstractText && data.AbstractText.length > 20) {
      return data.AbstractText.slice(0, 500);
    }

    // Resposta de definição
    if (data.Definition && data.Definition.length > 10) {
      return data.Definition.slice(0, 500);
    }

    // Resultados relacionados
    if (data.RelatedTopics && data.RelatedTopics.length > 0) {
      const topics = data.RelatedTopics
        .filter((t) => t.Text)
        .slice(0, 3)
        .map((t) => t.Text)
        .join(" | ");
      if (topics.length > 10) return topics.slice(0, 500);
    }

    // Fallback: busca HTML simples
    return await searchWebFallback(query);

  } catch (err) {
    console.error("[Search] Erro DuckDuckGo:", err.message);
    return await searchWebFallback(query);
  }
}

/**
 * Fallback: scraping leve do DuckDuckGo HTML.
 */
async function searchWebFallback(query) {
  try {
    const res = await axios.get("https://html.duckduckgo.com/html/", {
      params: { q: query },
      timeout: SEARCH_TIMEOUT,
      headers: {
        "User-Agent": "Mozilla/5.0 (compatible; Nina-AI/1.0)",
        "Accept-Language": "pt-BR,pt;q=0.9",
      },
    });

    // Extrai snippets dos resultados
    const html     = res.data;
    const snippets = [];
    const regex    = /<a class="result__snippet"[^>]*>([\s\S]*?)<\/a>/g;
    let match;
    while ((match = regex.exec(html)) !== null && snippets.length < 3) {
      const text = match[1].replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim();
      if (text.length > 20) snippets.push(text);
    }

    if (snippets.length > 0) return snippets.join(" | ").slice(0, 600);
    return null;
  } catch {
    return null;
  }
}

/**
 * Detecta se uma mensagem pede busca na web.
 */
function needsWebSearch(message) {
  const msg = message.toLowerCase();
  return /\b(pesquisa|pesquise|busca|busque|procura|procure|googla|o que é|quem é|quando foi|qual é|me fala sobre|notícia|notícias|atual|atualmente|hoje|agora)\b/.test(msg);
}

module.exports = { searchWeb, needsWebSearch };
