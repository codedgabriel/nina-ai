// ============================================================
//  Nina v4 — Visão de Imagens (DeepSeek Vision)
//
//  Quando você manda uma foto no WhatsApp, a Nina:
//  1. Baixa a imagem
//  2. Converte pra base64
//  3. Manda pro DeepSeek com a pergunta do usuário
//  4. Responde com análise completa
//
//  Suporta: fotos, screenshots, documentos fotografados,
//  gráficos, notas fiscais, prints de erro, qualquer coisa.
// ============================================================

const axios = require("axios");
const fs    = require("fs");
const path  = require("path");
const os    = require("os");

const {
  DEEPSEEK_API_KEY,
  DEEPSEEK_BASE_URL,
  DEEPSEEK_VISION_MODEL,
  DEEPSEEK_TIMEOUT,
  PHOTOS_DIR,
} = require("./config");
const { trackUsage } = require("./budget");

fs.mkdirSync(PHOTOS_DIR, { recursive: true });

// ── Mimetypes suportados pelo DeepSeek Vision ─────────────────
const SUPPORTED_TYPES = ["image/jpeg", "image/png", "image/webp", "image/gif"];

/**
 * Analisa uma imagem mandada no WhatsApp.
 *
 * @param {object} media    - Objeto media do whatsapp-web.js (tem .data em base64 e .mimetype)
 * @param {string} caption  - Legenda/pergunta que o usuário mandou junto com a foto
 * @param {object} contact  - Contato que mandou
 * @returns {string}        - Resposta da Nina sobre a imagem
 */
async function analyzeImage(media, caption = "", contact = null) {
  if (!DEEPSEEK_API_KEY) {
    return "DEEPSEEK_API_KEY não configurada — não consigo analisar imagens.";
  }

  const mimetype = media.mimetype?.split(";")[0] || "image/jpeg";

  // Normaliza mimetype se necessário
  const finalMime = SUPPORTED_TYPES.includes(mimetype) ? mimetype : "image/jpeg";

  // Salva em disco pra ter registro
  const ext      = finalMime.split("/")[1] || "jpg";
  const filename = `foto_${Date.now()}.${ext}`;
  const filepath = path.join(PHOTOS_DIR, filename);
  const buffer   = Buffer.from(media.data, "base64");
  fs.writeFileSync(filepath, buffer);

  // Monta o prompt — se não tiver legenda, pede análise geral
  const userPrompt = caption?.trim()
    ? caption.trim()
    : "Descreva o que você vê nessa imagem. Seja detalhado e útil.";

  const name = contact?.name || "DG";

  try {
    const res = await axios.post(
      `${DEEPSEEK_BASE_URL}/chat/completions`,
      {
        model: DEEPSEEK_VISION_MODEL,
        messages: [
          {
            role: "system",
            content: `Você é Nina, assistente de ${name}. Analise a imagem e responda em português do Brasil. Seja direto e útil. Sem emoji.`,
          },
          {
            role: "user",
            content: [
              {
                type: "image_url",
                image_url: {
                  url: `data:${finalMime};base64,${media.data}`,
                },
              },
              {
                type: "text",
                text: userPrompt,
              },
            ],
          },
        ],
        max_tokens: 1024,
        temperature: 0.3,
      },
      {
        headers: {
          Authorization: `Bearer ${DEEPSEEK_API_KEY}`,
          "Content-Type": "application/json",
        },
        timeout: DEEPSEEK_TIMEOUT,
      }
    );

    const usage = res.data?.usage;
    if (usage) trackUsage(DEEPSEEK_VISION_MODEL, usage.prompt_tokens, usage.completion_tokens);

    const answer = res.data?.choices?.[0]?.message?.content?.trim();
    console.log(`[Vision] Imagem analisada: ${filepath}`);
    return answer || "não consegui analisar a imagem";

  } catch (err) {
    console.error("[Vision] Erro:", err.response?.data || err.message);

    // DeepSeek pode não suportar visão no modelo atual — fallback descritivo
    if (err.response?.status === 400) {
      return `foto salva em ${filepath}. (análise de imagem indisponível no modelo atual — tente deepseek-vl2)`;
    }
    return `foto salva em ${filepath}. erro ao analisar: ${err.message}`;
  }
}

/**
 * Versão pra analisar arquivo já salvo em disco.
 * Útil pra tools que precisam analisar screenshots do servidor.
 */
async function analyzeImageFile(filepath, question = "") {
  if (!fs.existsSync(filepath)) return `arquivo não encontrado: ${filepath}`;

  const ext      = path.extname(filepath).toLowerCase();
  const mimeMap  = { ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".png": "image/png", ".webp": "image/webp" };
  const mimetype = mimeMap[ext] || "image/jpeg";
  const data     = fs.readFileSync(filepath).toString("base64");

  return analyzeImage({ data, mimetype }, question);
}

module.exports = { analyzeImage, analyzeImageFile };
