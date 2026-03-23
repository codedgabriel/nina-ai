// ============================================================
//  Nina — Detecção de Intenção
// ============================================================

function detectIntent(message) {
  const msg = message.toLowerCase();

  // Salvar nota
  if (/\b(anota|anote|salva|salve|guarda|guarde|registra|registre|pode anotar|pode salvar)\b/.test(msg)) {
    const content = message.replace(/^(anota|anote|salva|salve|guarda|guarde|registra|registre|pode anotar|pode salvar)\s*(aí|ai|isso|que)?\s*/i, "").trim();
    return { type: "save_note", content };
  }

  // Buscar nota
  if (/\b(procura nas notas|busca nas notas|tem alguma nota|tem anotado)\b/.test(msg)) {
    const query = message.replace(/^.*?(procura|busca)\s*(nas notas)?\s*/i, "").trim();
    return { type: "find_note", query: query || message };
  }

  // Listar notas
  if (/\b(lista as notas|minhas notas|quais notas|me mostra as notas)\b/.test(msg)) {
    return { type: "list_notes" };
  }

  // Busca em memória
  if (/\b(o que (eu|a gente) (falou|conversou|disse)|lembra quando|você lembra|busca na memória)\b/.test(msg)) {
    return { type: "search_memory", query: message };
  }

  // Stats do servidor
  if (/\b(cpu|ram|memória do servidor|disco|espaço|uptime|recursos do servidor|como tá o servidor|status do servidor)\b/.test(msg)) {
    return { type: "server_stats" };
  }

  // Executar comando shell
  if (/\b(executa|execute|roda|rode|roda o comando|execute o comando|comando:|shell:|bash:)\b/.test(msg)) {
    // Extrai o comando — tudo depois de "executa", "roda", etc.
    const cmd = message.replace(/^.*(executa|execute|roda|rode|roda o comando|execute o comando|comando:|shell:|bash:)\s*/i, "").trim();
    return { type: "shell_command", cmd };
  }

  // Confirmar comando perigoso
  if (/^(sim|confirma|confirmo|pode executar|executa|yes|ok)$/i.test(msg.trim())) {
    return { type: "confirm_command" };
  }

  // Cancelar comando
  if (/^(não|nao|cancela|cancelo|não executa|no)$/i.test(msg.trim())) {
    return { type: "cancel_command" };
  }

  // Criar/editar arquivo de código
  if (/\b(cria o arquivo|crie o arquivo|edita o arquivo|edite o arquivo|escreve no arquivo|salva o código|cria um script)\b/.test(msg)) {
    return { type: "write_file", raw: message };
  }

  // Ler arquivo
  if (/\b(lê o arquivo|le o arquivo|mostra o arquivo|abre o arquivo|conteúdo do arquivo)\b/.test(msg)) {
    const filepath = message.replace(/^.*(lê|le|mostra|abre|conteúdo d[oa])\s*(o\s+)?arquivo\s*/i, "").trim();
    return { type: "read_file", filepath };
  }

  // Listar diretório
  if (/\b(lista os arquivos|ls |lista o diretório|o que tem em|lista a pasta)\b/.test(msg)) {
    const dir = message.replace(/^.*(lista os arquivos|lista o diretório|o que tem em|lista a pasta)\s*/i, "").trim();
    return { type: "list_dir", dir };
  }

  // Reiniciar Nina
  if (/\b(reinicia|reinicie|restart|se reinicia|reinicia você)\b/.test(msg)) {
    return { type: "restart" };
  }

  return null;
}

function extractNoteTitle(content) {
  const words = content.split(/\s+/).slice(0, 5).join(" ");
  return words.length > 3 ? words : "Nota sem título";
}

module.exports = { detectIntent, extractNoteTitle };
