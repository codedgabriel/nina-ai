// ============================================================
//  Nina v4 — Transcrição de Áudio via Groq Whisper
//  Groq é absurdamente rápido — transcreve em < 1s
// ============================================================

const axios = require("axios");
const fs    = require("fs");
const path  = require("path");
const os    = require("os");
const { execSync } = require("child_process");

const GROQ_API_KEY  = process.env.GROQ_API_KEY || "";
const GROQ_WHISPER  = "https://api.groq.com/openai/v1/audio/transcriptions";
const AUDIO_TMP_DIR = path.join(os.homedir(), "nina-files", "audio-tmp");

fs.mkdirSync(AUDIO_TMP_DIR, { recursive: true });

if (!GROQ_API_KEY) {
  console.warn("[Audio] ⚠️  GROQ_API_KEY não definida. Transcrição de áudio desativada.");
}

/**
 * Recebe o media object do whatsapp-web.js e retorna o texto transcrito.
 * Suporta ogg (ptt), mp4, mp3, wav, webm.
 */
async function transcribeAudio(media) {
  if (!GROQ_API_KEY) return null;

  // Salva o buffer em disco (Groq precisa de um arquivo real)
  const ext      = media.mimetype.split("/")[1]?.split(";")[0] || "ogg";
  const tmpFile  = path.join(AUDIO_TMP_DIR, `audio_${Date.now()}.${ext}`);
  const buffer   = Buffer.from(media.data, "base64");
  fs.writeFileSync(tmpFile, buffer);

  // WhatsApp envia áudios como .ogg/opus — Groq aceita, mas converte pra mp3 se necessário
  let fileToSend = tmpFile;

  try {
    // Tenta converter com ffmpeg se disponível (melhora compatibilidade)
    const mp3File = tmpFile.replace(`.${ext}`, ".mp3");
    execSync(`ffmpeg -y -i "${tmpFile}" -ar 16000 -ac 1 "${mp3File}" 2>/dev/null`, { timeout: 15_000 });
    fileToSend = mp3File;
  } catch {
    // ffmpeg não disponível — envia o arquivo original mesmo
  }

  try {
    const FormData = require("form-data");
    const form = new FormData();
    form.append("file", fs.createReadStream(fileToSend), {
      filename: path.basename(fileToSend),
      contentType: "audio/mpeg",
    });
    form.append("model",    "whisper-large-v3-turbo"); // mais rápido, mesma qualidade
    form.append("language", "pt");                     // força português → mais preciso
    form.append("response_format", "text");

    const res = await axios.post(GROQ_WHISPER, form, {
      headers: {
        ...form.getHeaders(),
        "Authorization": `Bearer ${GROQ_API_KEY}`,
      },
      timeout: 30_000,
    });

    const transcript = typeof res.data === "string"
      ? res.data.trim()
      : res.data?.text?.trim();

    console.log(`[Audio] Transcrito: "${transcript?.slice(0, 100)}"`);
    return transcript || null;

  } catch (err) {
    console.error("[Audio] Erro Groq Whisper:", err.response?.data || err.message);
    return null;
  } finally {
    // Limpa arquivos temporários
    try { fs.unlinkSync(tmpFile); } catch {}
    try {
      const mp3 = tmpFile.replace(/\.\w+$/, ".mp3");
      if (fs.existsSync(mp3)) fs.unlinkSync(mp3);
    } catch {}
  }
}

module.exports = { transcribeAudio };
