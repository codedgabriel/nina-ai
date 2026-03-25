const log = require("./logger");
// ============================================================
//  Nina — Aprendizado Automático de Fatos
//  Roda em background após cada mensagem recebida
// ============================================================

const axios = require("axios");
const { OLLAMA_URL, OLLAMA_MODEL } = require("./config");
const { saveContact, getContact }  = require("./contacts");

/**
 * Analisa uma mensagem e extrai fatos sobre o remetente.
 * Roda em background — não bloqueia a resposta da Nina.
 */
async function learnFromMessage(userText, contact, fromNumber) {
  // Só aprende se tiver contexto suficiente
  if (!userText || userText.length < 10) return;
  if (userText === "[foto]") return;

  const currentProfile = contact?.notes || "nenhum perfil ainda";
  const name           = contact?.name || "pessoa desconhecida";

  const prompt = `You are an information extractor. Analyze this WhatsApp message and extract any personal facts about the sender.

Sender name: ${name}
Current known profile: ${currentProfile}
Message: "${userText}"

Rules:
- Extract ONLY facts clearly stated or strongly implied in the message
- Return a JSON object with the facts, or {} if nothing new
- Keys should be short descriptive labels in portuguese
- Values should be concise
- Do NOT invent or assume anything
- Examples of good keys: "hobby", "trabalho", "mora_em", "gosta_de", "namorado", "estuda"

Respond with ONLY valid JSON, nothing else. Example: {"hobby": "lê manhwa", "gosta_de": "anime"}`;

  try {
    const response = await axios.post(
      OLLAMA_URL,
      {
        model:   OLLAMA_MODEL,
        messages: [{ role: "user", content: prompt }],
        stream:  false,
        options: {
          temperature: 0.1,  // bem baixo pra ser preciso
          num_predict: 100,
          num_ctx:     512,
        },
      },
      { timeout: 60_000 }
    );

    const raw = response.data?.message?.content?.trim();
    if (!raw) return;

    // Extrai JSON mesmo se vier com texto ao redor
    const jsonMatch = raw.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return;

    const facts = JSON.parse(jsonMatch[0]);
    if (!facts || typeof facts !== "object") return;
    if (Object.keys(facts).length === 0) return;

    // Mescla com perfil existente
    let existingProfile = {};
    try {
      existingProfile = contact?.notes ? JSON.parse(contact.notes) : {};
    } catch {
      existingProfile = {};
    }

    const updatedProfile = { ...existingProfile, ...facts };
    const profileStr     = JSON.stringify(updatedProfile);

    saveContact(fromNumber, name, profileStr);
    log.debug("Learner", `${name}: ${JSON.stringify(facts)}`);

  } catch (err) {
    // Silencioso — aprendizado em background não deve quebrar nada
    if (!err.message.includes("timeout")) {
      log.warn("Learner", err.message);
    }
  }
}

module.exports = { learnFromMessage };
