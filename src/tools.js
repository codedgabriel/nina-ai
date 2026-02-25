// ============================================================
//  Nina — Definição das Ferramentas (Function Calling)
//  O modelo decide qual usar baseado no contexto
// ============================================================

const tools = [
  {
    type: "function",
    function: {
      name: "run_shell",
      description: "Executa um comando shell no servidor. Use para listar arquivos, verificar processos, instalar pacotes, ou qualquer tarefa do sistema.",
      parameters: {
        type: "object",
        properties: {
          cmd: { type: "string", description: "O comando shell a executar" },
        },
        required: ["cmd"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "search_web",
      description: "Busca informações atuais na internet. Use quando precisar de notícias, fatos recentes, preços, clima, ou qualquer informação que pode ter mudado.",
      parameters: {
        type: "object",
        properties: {
          query: { type: "string", description: "O que buscar na web" },
        },
        required: ["query"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "save_note",
      description: "Salva uma nota ou informação importante em disco para consultar depois.",
      parameters: {
        type: "object",
        properties: {
          title:   { type: "string", description: "Título curto da nota" },
          content: { type: "string", description: "Conteúdo completo da nota" },
        },
        required: ["title", "content"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "find_notes",
      description: "Busca nas notas salvas anteriormente por palavra-chave.",
      parameters: {
        type: "object",
        properties: {
          query: { type: "string", description: "Termo para buscar nas notas" },
        },
        required: ["query"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "set_reminder",
      description: "Cria um lembrete para enviar mensagem em um horário específico.",
      parameters: {
        type: "object",
        properties: {
          time: { type: "string", description: "Horário no formato HH:MM" },
          text: { type: "string", description: "Texto do lembrete" },
        },
        required: ["time", "text"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_system_stats",
      description: "Retorna uso atual de CPU, RAM, disco e uptime do servidor.",
      parameters: { type: "object", properties: {} },
    },
  },
  {
    type: "function",
    function: {
      name: "read_file",
      description: "Lê o conteúdo de um arquivo no servidor.",
      parameters: {
        type: "object",
        properties: {
          path: { type: "string", description: "Caminho completo ou relativo ao home do arquivo" },
        },
        required: ["path"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "write_file",
      description: "Cria ou edita um arquivo no servidor com o conteúdo especificado.",
      parameters: {
        type: "object",
        properties: {
          path:    { type: "string", description: "Caminho do arquivo" },
          content: { type: "string", description: "Conteúdo a escrever" },
        },
        required: ["path", "content"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "search_memory",
      description: "Busca em conversas antigas por tema ou palavra-chave.",
      parameters: {
        type: "object",
        properties: {
          query:       { type: "string",  description: "O que buscar nas conversas" },
          from_number: { type: "string",  description: "Número do contato (opcional, para filtrar)" },
        },
        required: ["query"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_contact_info",
      description: "Retorna o perfil e histórico de conversas de um contato pelo nome.",
      parameters: {
        type: "object",
        properties: {
          name: { type: "string", description: "Nome do contato" },
        },
        required: ["name"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "restart_self",
      description: "Reinicia o processo da Nina.",
      parameters: { type: "object", properties: {} },
    },
  },
];

module.exports = { tools };
