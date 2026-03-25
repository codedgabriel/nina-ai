// ============================================================
//  Nina v4 — Definição das Ferramentas (Function Calling)
//  Formato OpenAI — compatível com DeepSeek
// ============================================================

const tools = [

  // ── Sistema & Shell ───────────────────────────────────────

  {
    type: "function",
    function: {
      name: "run_shell",
      description: "Executa um comando shell no servidor. Use para listar arquivos, verificar processos, instalar pacotes, gerenciar serviços, ou qualquer tarefa do sistema operacional.",
      parameters: {
        type: "object",
        properties: {
          cmd:         { type: "string",  description: "O comando shell a executar" },
          working_dir: { type: "string",  description: "Diretório de trabalho (opcional)" },
          timeout_sec: { type: "integer", description: "Timeout em segundos (padrão: 60)" },
        },
        required: ["cmd"],
      },
    },
  },

  {
    type: "function",
    function: {
      name: "run_script",
      description: "Cria e executa um script completo (Python, Bash, Node.js). Use quando a tarefa é complexa demais pra um comando só. O script é salvo em ~/nina-files/scripts/ e executado. Ideal para automações, processamento de dados, tarefas em múltiplos passos.",
      parameters: {
        type: "object",
        properties: {
          filename:  { type: "string", description: "Nome do arquivo (ex: backup.py, analise.sh, fetch.js)" },
          code:      { type: "string", description: "Código completo do script" },
          lang:      { type: "string", description: "Linguagem: python, bash, node", enum: ["python", "bash", "node"] },
          args:      { type: "string", description: "Argumentos de linha de comando (opcional)" },
        },
        required: ["filename", "code", "lang"],
      },
    },
  },

  {
    type: "function",
    function: {
      name: "get_system_stats",
      description: "Retorna uso atual de CPU, RAM, disco, uptime e processos principais do servidor.",
      parameters: { type: "object", properties: {} },
    },
  },

  {
    type: "function",
    function: {
      name: "list_processes",
      description: "Lista processos rodando no sistema, com uso de CPU e memória. Útil para debugging e monitoramento.",
      parameters: {
        type: "object",
        properties: {
          filter: { type: "string", description: "Filtrar por nome de processo (opcional)" },
        },
      },
    },
  },

  {
    type: "function",
    function: {
      name: "kill_process",
      description: "Mata um processo pelo PID ou nome. Requer confirmação para processos críticos.",
      parameters: {
        type: "object",
        properties: {
          pid:   { type: "integer", description: "PID do processo" },
          name:  { type: "string",  description: "Nome do processo (alternativo ao PID)" },
          force: { type: "boolean", description: "Usar SIGKILL ao invés de SIGTERM" },
        },
      },
    },
  },

  // ── Arquivos ──────────────────────────────────────────────

  {
    type: "function",
    function: {
      name: "read_file",
      description: "Lê o conteúdo de um arquivo no servidor. Para arquivos grandes, retorna os primeiros 4000 caracteres.",
      parameters: {
        type: "object",
        properties: {
          path:       { type: "string",  description: "Caminho do arquivo (absoluto ou relativo ao home)" },
          start_line: { type: "integer", description: "Linha inicial para ler (opcional)" },
          end_line:   { type: "integer", description: "Linha final para ler (opcional)" },
        },
        required: ["path"],
      },
    },
  },

  {
    type: "function",
    function: {
      name: "write_file",
      description: "Cria ou sobrescreve um arquivo com o conteúdo especificado. Cria diretórios intermediários automaticamente.",
      parameters: {
        type: "object",
        properties: {
          path:    { type: "string", description: "Caminho do arquivo" },
          content: { type: "string", description: "Conteúdo a escrever" },
          append:  { type: "boolean", description: "Se true, adiciona ao final em vez de sobrescrever" },
        },
        required: ["path", "content"],
      },
    },
  },

  {
    type: "function",
    function: {
      name: "list_dir",
      description: "Lista o conteúdo de um diretório com detalhes de tamanho e data.",
      parameters: {
        type: "object",
        properties: {
          path:      { type: "string",  description: "Caminho do diretório (padrão: home)" },
          recursive: { type: "boolean", description: "Listar recursivamente" },
        },
      },
    },
  },

  {
    type: "function",
    function: {
      name: "find_files",
      description: "Busca arquivos no sistema por nome, extensão ou conteúdo.",
      parameters: {
        type: "object",
        properties: {
          pattern:    { type: "string", description: "Padrão de nome (ex: '*.py', 'config*')" },
          search_dir: { type: "string", description: "Diretório base da busca (padrão: home)" },
          content:    { type: "string", description: "Busca por conteúdo dentro dos arquivos (grep)" },
        },
        required: ["pattern"],
      },
    },
  },

  // ── Web & Informação ──────────────────────────────────────

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
      name: "fetch_url",
      description: "Baixa o conteúdo de uma URL. Útil para ler páginas, APIs públicas, documentação ou RSS feeds.",
      parameters: {
        type: "object",
        properties: {
          url:     { type: "string", description: "URL a acessar" },
          headers: { type: "object", description: "Headers HTTP opcionais (ex: Authorization)" },
        },
        required: ["url"],
      },
    },
  },

  // ── Notas & Memória ───────────────────────────────────────

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
          tags:    { type: "string", description: "Tags separadas por vírgula (opcional)" },
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
      name: "search_memory",
      description: "Busca em conversas antigas por tema ou palavra-chave.",
      parameters: {
        type: "object",
        properties: {
          query:       { type: "string", description: "O que buscar nas conversas" },
          from_number: { type: "string", description: "Número do contato para filtrar (opcional)" },
        },
        required: ["query"],
      },
    },
  },

  // ── Lembretes & Agenda ────────────────────────────────────

  {
    type: "function",
    function: {
      name: "set_reminder",
      description: "Cria um lembrete para enviar mensagem em um horário específico. Pode mandar pra você (padrão) ou diretamente para outro contato salvo via target_name.",
      parameters: {
        type: "object",
        properties: {
          time: { type: "string",  description: "Horário no formato HH:MM" },
          text: { type: "string",  description: "Texto do lembrete" },
          date:        { type: "string", description: "Data no formato YYYY-MM-DD (opcional, padrão: hoje)" },
          target_name: { type: "string", description: "Nome do contato pra quem enviar a mensagem (opcional — se vazio, manda pra DG). Ex: 'Jhully', 'João'" },
        },
        required: ["time", "text"],
      },
    },
  },

  {
    type: "function",
    function: {
      name: "list_reminders",
      description: "Lista os lembretes pendentes.",
      parameters: { type: "object", properties: {} },
    },
  },

  {
    type: "function",
    function: {
      name: "schedule_script",
      description: "Agenda um script para rodar automaticamente em um horário (cron). Útil para backups, relatórios periódicos, monitoramentos.",
      parameters: {
        type: "object",
        properties: {
          name:        { type: "string", description: "Nome identificador da tarefa" },
          cron_expr:   { type: "string", description: "Expressão cron (ex: '0 8 * * *' = todo dia às 8h)" },
          script_path: { type: "string", description: "Caminho do script a executar" },
          description: { type: "string", description: "Descrição do que a tarefa faz" },
        },
        required: ["name", "cron_expr", "script_path"],
      },
    },
  },

  // ── Contatos ──────────────────────────────────────────────

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

  // ── Auto-gestão ───────────────────────────────────────────

  {
    type: "function",
    function: {
      name: "restart_self",
      description: "Reinicia o processo da Nina. Use quando tiver instável ou após atualizar o código.",
      parameters: { type: "object", properties: {} },
    },
  },

  {
    type: "function",
    function: {
      name: "self_update",
      description: "Faz git pull no próprio repositório da Nina e reinicia. Só use se souber que há atualizações.",
      parameters: {
        type: "object",
        properties: {
          repo_path: { type: "string", description: "Caminho do repositório (padrão: detecta automaticamente)" },
        },
      },
    },
  },


  {
    type: "function",
    function: {
      name: "get_monitor_status",
      description: "Retorna o status atual do monitor proativo: thresholds, último alerta, próxima otimização.",
      parameters: { type: "object", properties: {} },
    },
  },

  {
    type: "function",
    function: {
      name: "run_optimization",
      description: "Força uma rodada de otimização agora: limpa caches, verifica updates de segurança, checa serviços.",
      parameters: { type: "object", properties: {} },
    },
  },

  {
    type: "function",
    function: {
      name: "send_file",
      description: "Envia um arquivo para o usuário no WhatsApp. Use quando criar um HTML, script, PDF, zip ou qualquer arquivo que o usuário pediu pra receber. Pode enviar um arquivo existente no disco ou criar a partir de conteúdo.",
      parameters: {
        type: "object",
        properties: {
          filename:    { type: "string", description: "Nome do arquivo a enviar (ex: site.html, backup.zip)" },
          file_path:   { type: "string", description: "Caminho do arquivo no servidor (use se o arquivo já existe)" },
          content:     { type: "string", description: "Conteúdo do arquivo (use se quiser criar e enviar direto)" },
          caption:     { type: "string", description: "Legenda/mensagem junto com o arquivo (opcional)" },
        },
        required: ["filename"],
      },
    },
  },

  {
    type: "function",
    function: {
      name: "get_monitor_status",
      description: "Mostra o status do monitor proativo: thresholds configurados, últimos alertas, serviços vigiados.",
      parameters: { type: "object", properties: {} },
    },
  },

  {
    type: "function",
    function: {
      name: "run_optimization_now",
      description: "Executa a rotina de otimização agora, sem esperar as 3h automáticas. Limpa lixo, verifica atualizações, etc.",
      parameters: { type: "object", properties: {} },
    },
  },

  {
    type: "function",
    function: {
      name: "get_memory_context",
      description: "Mostra o contexto de memória atual: fatos aprendidos, resumos de dias anteriores e memórias semânticas recentes.",
      parameters: {
        type: "object",
        properties: {
          query: { type: "string", description: "Busca específica na memória (opcional)" },
        },
      },
    },
  },

  // ── Watchers ──────────────────────────────────────────────

  {
    type: "function",
    function: {
      name: "add_watcher",
      description: `Cria um watcher que monitora algo e notifica quando a condição for atingida.
Tipos disponíveis:
- price: monitora preço de ativo (bitcoin, dólar, ação). Ex: "me avisa se BTC cair abaixo de 90k"
- log: vigia um arquivo de log por padrão/erro. Ex: "me avisa se aparecer ERROR em /var/log/app.log"
- url: monitora se uma URL cai, muda de status ou de conteúdo. Ex: "me avisa se meusite.com cair"
- command: roda um comando periodicamente e avisa se o output mudar. Ex: "roda df -h e me avisa se disco passar de 80%"
- keyword: vigia aparecimento de palavra em arquivo ou URL`,
      parameters: {
        type: "object",
        properties: {
          description: { type: "string", description: "Descrição curta do watcher (ex: 'Bitcoin abaixo de 90k')" },
          type:        { type: "string", description: "Tipo: price | log | url | command | keyword", enum: ["price","log","url","command","keyword"] },
          target:      { type: "string", description: "O que monitorar: URL, caminho de arquivo, comando shell ou ticker de preço" },
          condition:   { type: "string", description: "Condição em linguagem natural que dispara o alerta" },
          interval:    { type: "string", description: "Frequência: '30s', '5m', '1h', '6h', '1d' (padrão: 5m)" },
          oneshot:     { type: "boolean", description: "Se true, desativa o watcher após disparar uma vez" },
          lines:       { type: "integer", description: "Para logs: quantas linhas do final verificar (padrão: 50)" },
        },
        required: ["description", "type", "target", "condition"],
      },
    },
  },

  {
    type: "function",
    function: {
      name: "list_watchers",
      description: "Lista todos os watchers configurados com status, último check e quantas vezes dispararam.",
      parameters: { type: "object", properties: {} },
    },
  },

  {
    type: "function",
    function: {
      name: "remove_watcher",
      description: "Remove um watcher pelo ID.",
      parameters: {
        type: "object",
        properties: {
          id: { type: "string", description: "ID do watcher (obtido via list_watchers)" },
        },
        required: ["id"],
      },
    },
  },

  {
    type: "function",
    function: {
      name: "pause_watcher",
      description: "Pausa um watcher sem remover. Resume com resume_watcher.",
      parameters: {
        type: "object",
        properties: {
          id: { type: "string", description: "ID do watcher" },
        },
        required: ["id"],
      },
    },
  },

  {
    type: "function",
    function: {
      name: "resume_watcher",
      description: "Reativa um watcher pausado.",
      parameters: {
        type: "object",
        properties: {
          id: { type: "string", description: "ID do watcher" },
        },
        required: ["id"],
      },
    },
  },

  {
    type: "function",
    function: {
      name: "check_watcher_now",
      description: "Força uma verificação imediata de um watcher sem esperar o próximo ciclo.",
      parameters: {
        type: "object",
        properties: {
          id: { type: "string", description: "ID do watcher" },
        },
        required: ["id"],
      },
    },
  },

  // ── Browser autônomo ──────────────────────────────────────

  {
    type: "function",
    function: {
      name: "browser_task",
      description: `Navega na web de forma autônoma para completar uma tarefa complexa.
Use quando precisar: fazer login, preencher formulários, extrair dados de sites sem API, fazer compras, reservas, pesquisar preços, testar um site, qualquer coisa que um humano faria no browser.
A Nina planeja e executa os cliques/preenchimentos sozinha até completar o objetivo.
Exemplos:
- "acessa meusite.com, faz login com X e Y, e me traz o relatório do mês"
- "vai no mercadolivre e me traz os 5 primeiros resultados de 'teclado mecânico' com preços"
- "acessa esses 3 concorrentes e extrai os preços dos planos"
- "testa se o formulário de cadastro do meusite.com está funcionando"`,
      parameters: {
        type: "object",
        properties: {
          task: {
            type: "string",
            description: "Descrição completa da tarefa em linguagem natural. Inclua credenciais se necessário (ex: 'faz login com email X e senha Y').",
          },
          max_steps: {
            type: "integer",
            description: "Máximo de ações no browser (padrão: 15, máx: 30)",
          },
          start_url: {
            type: "string",
            description: "URL inicial opcional. Se não fornecida, a IA decide onde começar.",
          },
        },
        required: ["task"],
      },
    },
  },

  {
    type: "function",
    function: {
      name: "browser_fetch",
      description: "Abre uma URL no browser real (com JS) e retorna o texto da página. Melhor que fetch_url para sites que precisam de JavaScript pra renderizar conteúdo.",
      parameters: {
        type: "object",
        properties: {
          url: { type: "string", description: "URL a acessar" },
        },
        required: ["url"],
      },
    },
  },

  {
    type: "function",
    function: {
      name: "browser_close",
      description: "Fecha a sessão do browser para liberar memória. O browser reabre automaticamente na próxima tarefa.",
      parameters: { type: "object", properties: {} },
    },
  },

  // ── Orçamento & Autonomia ─────────────────────────────────

  {
    type: "function",
    function: {
      name: "get_budget_status",
      description: "Mostra quanto gastou hoje em API (tokens, custo em USD), histórico dos últimos dias e limite configurado.",
      parameters: { type: "object", properties: {} },
    },
  },

  {
    type: "function",
    function: {
      name: "set_budget_limit",
      description: "Define o limite diário de gasto de API em dólares. Quando atingir, para de responder até o dia seguinte.",
      parameters: {
        type: "object",
        properties: {
          usd: { type: "number", description: "Limite em dólares (ex: 1.50, 5.00)" },
        },
        required: ["usd"],
      },
    },
  },

  {
    type: "function",
    function: {
      name: "get_autonomy_status",
      description: "Mostra a configuração atual de autonomia — o que Nina pode fazer sozinha vs. o que pede confirmação vs. o que nunca faz.",
      parameters: { type: "object", properties: {} },
    },
  },

  {
    type: "function",
    function: {
      name: "set_autonomy",
      description: `Muda o nível de autonomia de uma categoria de ação.
Categorias disponíveis: shell_read, shell_write, shell_execute, shell_install, shell_dangerous, shell_system, browser_read, browser_interact, browser_auth, browser_purchase, file_read, file_write, file_delete, file_system, network_fetch, network_send, network_external, cron_add, cron_remove, self_restart, self_update, self_modify
Níveis: auto (faz sem perguntar), confirm (pede confirmação), deny (nunca faz)`,
      parameters: {
        type: "object",
        properties: {
          category: { type: "string", description: "Categoria de ação (ex: browser_auth, shell_install)" },
          level:    { type: "string", description: "Nível: auto | confirm | deny", enum: ["auto","confirm","deny"] },
        },
        required: ["category", "level"],
      },
    },
  },

  // ── Skills dinâmicas ──────────────────────────────────────

  {
    type: "function",
    function: {
      name: "learn_skill",
      description: `Aprende uma nova habilidade em runtime — escreve e registra um script reutilizável.
Use quando:
- O usuário pede algo que você não consegue fazer com as tools atuais
- Uma tarefa vai se repetir e vale a pena ter um script dedicado
- Você quer encapsular uma sequência complexa de passos em algo simples de chamar

Exemplos de skills que você pode criar:
- "consultar_cnpj": dado um CNPJ, consulta a Receita Federal e retorna dados da empresa
- "resumir_pdf": dado um caminho de PDF, extrai e resume o conteúdo
- "monitorar_preco_produto": dado uma URL de produto, extrai o preço atual
- "backup_postgres": faz backup de um banco de dados PostgreSQL
- "converter_moeda": converte valores entre moedas consultando API pública

Após criar, a skill fica disponível para uso imediato via run_skill.`,
      parameters: {
        type: "object",
        properties: {
          name:         { type: "string",  description: "Nome único da skill (snake_case, ex: consultar_cnpj)" },
          description:  { type: "string",  description: "Quando usar essa skill — descreva o caso de uso" },
          code:         { type: "string",  description: "Código completo do script" },
          lang:         { type: "string",  description: "Linguagem: python | bash | node", enum: ["python","bash","node"] },
          args_schema:  { type: "string",  description: "Como passar argumentos (ex: 'CNPJ como $1', 'URL como primeiro argumento')" },
          example:      { type: "string",  description: "Exemplo de chamada: run_skill('consultar_cnpj', '12.345.678/0001-99')" },
          dependencies: { type: "array",   items: { type: "string" }, description: "Pacotes necessários (ex: ['requests', 'beautifulsoup4'])" },
        },
        required: ["name", "description", "code", "lang"],
      },
    },
  },

  {
    type: "function",
    function: {
      name: "run_skill",
      description: "Executa uma skill previamente aprendida passando argumentos. Use list_skills para ver as disponíveis.",
      parameters: {
        type: "object",
        properties: {
          name: { type: "string", description: "Nome da skill" },
          args: { type: "string", description: "Argumentos para o script (como linha de comando)" },
        },
        required: ["name"],
      },
    },
  },

  {
    type: "function",
    function: {
      name: "list_skills",
      description: "Lista todas as skills aprendidas com descrição, linguagem e estatísticas de uso.",
      parameters: { type: "object", properties: {} },
    },
  },

  {
    type: "function",
    function: {
      name: "remove_skill",
      description: "Remove uma skill pelo nome.",
      parameters: {
        type: "object",
        properties: {
          name: { type: "string", description: "Nome da skill a remover" },
        },
        required: ["name"],
      },
    },
  },

  {
    type: "function",
    function: {
      name: "learn_native_tool",
      description: `Aprende uma tool nativa — nível avançado de aprendizado.
Diferente de learn_skill (que cria scripts), isso cria uma tool formal que aparece no seu arsenal de capacidades, com parâmetros tipados que o DeepSeek entende nativamente.
Use quando a skill vai ser usada frequentemente e se beneficia de parâmetros estruturados.
O executor_code deve ser um módulo JS que exporta: async function(args, context) { return "resultado"; }`,
      parameters: {
        type: "object",
        properties: {
          name:          { type: "string", description: "Nome da tool (snake_case)" },
          description:   { type: "string", description: "Descrição completa — quando e como usar" },
          parameters:    { type: "object", description: "JSON Schema dos parâmetros da tool" },
          executor_code: { type: "string", description: "Código JS do executor: module.exports = async function(args, context) { ... }" },
        },
        required: ["name", "description", "executor_code"],
      },
    },
  },

  {
    type: "function",
    function: {
      name: "list_native_tools",
      description: "Lista as tools nativas aprendidas dinamicamente (além das tools built-in).",
      parameters: { type: "object", properties: {} },
    },
  },

  {
    type: "function",
    function: {
      name: "remove_native_tool",
      description: "Remove uma tool nativa pelo nome.",
      parameters: {
        type: "object",
        properties: {
          name: { type: "string", description: "Nome da tool" },
        },
        required: ["name"],
      },
    },
  },

  // ── Gmail ────────────────────────────────────────────────

  {
    type: "function",
    function: {
      name: "gmail_list",
      description: "Lista emails recentes. Por padrão lista os não lidos. Aceita qualquer query do Gmail (ex: 'from:banco', 'subject:fatura', 'is:unread').",
      parameters: {
        type: "object",
        properties: {
          query:      { type: "string",  description: "Query Gmail (padrão: 'is:unread')" },
          maxResults: { type: "integer", description: "Quantos emails (padrão: 10)" },
        },
      },
    },
  },

  {
    type: "function",
    function: {
      name: "gmail_read",
      description: "Lê o conteúdo completo de um email pelo ID (obtido via gmail_list).",
      parameters: {
        type: "object",
        properties: {
          message_id: { type: "string", description: "ID do email" },
        },
        required: ["message_id"],
      },
    },
  },

  {
    type: "function",
    function: {
      name: "gmail_send",
      description: "Envia um email.",
      parameters: {
        type: "object",
        properties: {
          to:      { type: "string", description: "Destinatário (email)" },
          subject: { type: "string", description: "Assunto" },
          body:    { type: "string", description: "Corpo do email" },
        },
        required: ["to", "subject", "body"],
      },
    },
  },

  {
    type: "function",
    function: {
      name: "gmail_mark_read",
      description: "Marca um email como lido.",
      parameters: {
        type: "object",
        properties: {
          message_id: { type: "string", description: "ID do email" },
        },
        required: ["message_id"],
      },
    },
  },

  // ── Google Calendar ───────────────────────────────────────

  {
    type: "function",
    function: {
      name: "calendar_list",
      description: "Lista eventos do Google Calendar. Por padrão mostra os próximos 7 dias.",
      parameters: {
        type: "object",
        properties: {
          days:       { type: "integer", description: "Quantos dias à frente (padrão: 7)" },
          maxResults: { type: "integer", description: "Máximo de eventos (padrão: 20)" },
        },
      },
    },
  },

  {
    type: "function",
    function: {
      name: "calendar_create",
      description: "Cria um evento no Google Calendar. Datas no formato ISO: '2025-03-15T14:00:00'.",
      parameters: {
        type: "object",
        properties: {
          title:       { type: "string", description: "Título do evento" },
          start:       { type: "string", description: "Início (ISO datetime)" },
          end:         { type: "string", description: "Fim (ISO datetime)" },
          description: { type: "string", description: "Descrição (opcional)" },
          location:    { type: "string", description: "Local (opcional)" },
          attendees:   { type: "array", items: { type: "string" }, description: "Lista de emails dos convidados (opcional)" },
        },
        required: ["title", "start", "end"],
      },
    },
  },

  {
    type: "function",
    function: {
      name: "calendar_delete",
      description: "Deleta um evento do calendário pelo ID.",
      parameters: {
        type: "object",
        properties: {
          event_id: { type: "string", description: "ID do evento" },
        },
        required: ["event_id"],
      },
    },
  },

  // ── Visão ─────────────────────────────────────────────────

  {
    type: "function",
    function: {
      name: "analyze_image_file",
      description: "Analisa uma imagem já salva no servidor. Use quando precisar analisar screenshots, gráficos gerados por scripts, ou fotos salvas anteriormente.",
      parameters: {
        type: "object",
        properties: {
          filepath: { type: "string", description: "Caminho da imagem no servidor" },
          question: { type: "string", description: "O que quer saber sobre a imagem" },
        },
        required: ["filepath"],
      },
    },
  },

  {
    type: "function",
    function: {
      name: "google_auth_status",
      description: "Verifica se o Google está autenticado e mostra como conectar se não estiver.",
      parameters: { type: "object", properties: {} },
    },
  },

  {
    type: "function",
    function: {
      name: "google_auth_connect",
      description: "Inicia o processo de autenticação Google. Retorna um link que o usuário deve acessar e então colar o código.",
      parameters: { type: "object", properties: {} },
    },
  },

  {
    type: "function",
    function: {
      name: "google_auth_code",
      description: "Finaliza a autenticação Google com o código recebido após autorização.",
      parameters: {
        type: "object",
        properties: {
          code: { type: "string", description: "Código de autorização do Google" },
        },
        required: ["code"],
      },
    },
  },

  // ── Email Watchers ────────────────────────────────────────

  {
    type: "function",
    function: {
      name: "email_watcher_add",
      description: `Cria um watcher que monitora emails e notifica quando chegar algo novo.
Usa queries do Gmail: 'from:banco', 'from:joao@empresa.com', 'subject:fatura', 'from:github.com', etc.
Exemplos:
- "me avisa quando chegar email do João" → query: from:joao@empresa.com
- "me avisa sobre faturas" → query: subject:fatura OR subject:boleto
- "monitora emails do GitHub" → query: from:github.com`,
      parameters: {
        type: "object",
        properties: {
          description: { type: "string", description: "Descrição do watcher (ex: 'emails do João')" },
          query:       { type: "string", description: "Query Gmail (ex: 'from:joao@x.com', 'subject:fatura')" },
          interval:    { type: "string", description: "Frequência: '5m', '15m', '1h' (padrão: 5m)" },
        },
        required: ["description", "query"],
      },
    },
  },

  {
    type: "function",
    function: {
      name: "email_watcher_list",
      description: "Lista os watchers de email ativos.",
      parameters: { type: "object", properties: {} },
    },
  },

  {
    type: "function",
    function: {
      name: "email_watcher_remove",
      description: "Remove um watcher de email pelo ID.",
      parameters: {
        type: "object",
        properties: {
          id: { type: "string", description: "ID do watcher" },
        },
        required: ["id"],
      },
    },
  },

  // ── Localização ───────────────────────────────────────────

  {
    type: "function",
    function: {
      name: "get_location",
      description: "Retorna a localização atual de DG e todos os locais salvos (casa, trabalho, etc.).",
      parameters: { type: "object", properties: {} },
    },
  },

  {
    type: "function",
    function: {
      name: "set_location",
      description: "Define ou atualiza a localização de DG por texto. Também salva locais com nome (casa, trabalho).",
      parameters: {
        type: "object",
        properties: {
          text:  { type: "string", description: "Cidade ou endereço (ex: 'São Luís, MA', 'Av. Paulista, São Paulo')" },
          label: { type: "string", description: "Nome pra salvar (ex: 'casa', 'trabalho') — opcional" },
        },
        required: ["text"],
      },
    },
  },

  {
    type: "function",
    function: {
      name: "estimate_travel",
      description: "Estima tempo e distância de deslocamento entre dois pontos.",
      parameters: {
        type: "object",
        properties: {
          from:  { type: "string", description: "Origem (texto ou 'atual' pra usar localização atual)" },
          to:    { type: "string", description: "Destino (texto ou nome de local salvo como 'trabalho')" },
          mode:  { type: "string", description: "Meio: driving | walking | cycling | transit (padrão: driving)", enum: ["driving","walking","cycling","transit"] },
        },
        required: ["to"],
      },
    },
  },

  // ── Notificações ──────────────────────────────────────────

  {
    type: "function",
    function: {
      name: "get_notification_status",
      description: "Status do sistema de notificações: modo atual (silencioso/ativo), fila pendente, configurações.",
      parameters: { type: "object", properties: {} },
    },
  },

  {
    type: "function",
    function: {
      name: "set_quiet_hours",
      description: "Define o horário de silêncio — período em que só notificações críticas passam.",
      parameters: {
        type: "object",
        properties: {
          start: { type: "integer", description: "Hora de início (0-23, ex: 23)" },
          end:   { type: "integer", description: "Hora de fim (0-23, ex: 7)" },
        },
        required: ["start", "end"],
      },
    },
  },

  {
    type: "function",
    function: {
      name: "set_calendar_lead",
      description: "Define com quantos minutos de antecedência avisar sobre compromissos do calendário.",
      parameters: {
        type: "object",
        properties: {
          minutes: { type: "integer", description: "Minutos de antecedência (padrão: 60)" },
        },
        required: ["minutes"],
      },
    },
  },

  // ── Histórico de decisões ─────────────────────────────────

  {
    type: "function",
    function: {
      name: "get_decision_history",
      description: "Mostra o histórico de ações autônomas da Nina: otimizações, watchers disparados, scripts executados, contatos proativos. Use quando o usuário perguntar 'o que você fez essa semana?' ou similar.",
      parameters: {
        type: "object",
        properties: {
          days:     { type: "integer", description: "Quantos dias atrás (padrão: 7)" },
          category: { type: "string",  description: "Filtrar por categoria: monitor | tool | watcher | notification | skill | proactive | optimization" },
        },
      },
    },
  },

  // ── Sistema proativo ──────────────────────────────────────

  {
    type: "function",
    function: {
      name: "get_proactive_status",
      description: "Status do sistema proativo: quantos contatos hoje, cooldown restante, configurações.",
      parameters: { type: "object", properties: {} },
    },
  },

  {
    type: "function",
    function: {
      name: "set_proactive_config",
      description: "Configura o sistema proativo: threshold de ausência, horário de padrão esperado, máximo de contatos por dia.",
      parameters: {
        type: "object",
        properties: {
          silence_threshold_hours: { type: "number",  description: "Horas sem msg pra considerar ausente (padrão: 4)" },
          pattern_hour:            { type: "integer", description: "Hora que você costuma mandar a primeira msg (padrão: 8)" },
          max_contacts_per_day:    { type: "integer", description: "Máximo de contatos proativos por dia (padrão: 3)" },
        },
      },
    },
  },

  // ── IoT ───────────────────────────────────────────────────

  {
    type: "function",
    function: {
      name: "iot_register",
      description: `Registra um dispositivo IoT para a Nina controlar.
Tipos: camera | sensor | relay | speaker | custom
Protocolos: http | https | rtsp | mqtt | tasmota | shelly | shell | ssh

Exemplos de registro:
- Câmera IP HTTP:  type=camera, protocol=http, host=192.168.1.100, path=/snapshot.jpg
- Câmera RTSP:     type=camera, protocol=rtsp, host=192.168.1.100, path=/stream1
- Câmera Rpi SSH:  type=camera, protocol=ssh, ssh_host=192.168.1.50, ssh_user=pi
- Sensor HTTP:     type=sensor, protocol=http, host=192.168.1.101, path=/data
- Relé Tasmota:    type=relay, protocol=tasmota, host=192.168.1.102
- Relé Shelly:     type=relay, protocol=shelly, host=192.168.1.103
- Sensor MQTT:     type=sensor, protocol=mqtt, host=192.168.1.1, topic=sensors/quarto`,
      parameters: {
        type: "object",
        properties: {
          name:         { type: "string", description: "Nome do dispositivo (ex: 'câmera da sala', 'sensor do quarto')" },
          type:         { type: "string", description: "Tipo: camera | sensor | relay | speaker | custom", enum: ["camera","sensor","relay","speaker","custom"] },
          protocol:     { type: "string", description: "Protocolo: http | https | rtsp | mqtt | tasmota | shelly | shell | ssh" },
          host:         { type: "string", description: "IP ou hostname (ex: 192.168.1.100)" },
          port:         { type: "integer", description: "Porta (opcional)" },
          path:         { type: "string", description: "Path da URL (ex: /snapshot.jpg, /stream1)" },
          username:     { type: "string", description: "Usuário para autenticação (opcional)" },
          password:     { type: "string", description: "Senha para autenticação (opcional)" },
          topic:        { type: "string", description: "Tópico MQTT (opcional)" },
          ssh_host:     { type: "string", description: "Host SSH (se diferente do host principal)" },
          ssh_user:     { type: "string", description: "Usuário SSH (padrão: pi)" },
          ssh_cmd:      { type: "string", description: "Comando SSH a executar" },
          capabilities: { type: "array", items: { type: "string" }, description: "Capacidades: snapshot, stream, motion, ptz, temperature, humidity, critical" },
          notes:        { type: "string", description: "Observações livres" },
        },
        required: ["name", "type", "protocol"],
      },
    },
  },

  {
    type: "function",
    function: {
      name: "iot_list",
      description: "Lista todos os dispositivos IoT registrados com status e capacidades.",
      parameters: { type: "object", properties: {} },
    },
  },

  {
    type: "function",
    function: {
      name: "iot_ping",
      description: "Verifica se um dispositivo IoT está online. Se não especificar nome, verifica todos.",
      parameters: {
        type: "object",
        properties: {
          name: { type: "string", description: "Nome ou ID do dispositivo (opcional — omita para verificar todos)" },
        },
      },
    },
  },

  {
    type: "function",
    function: {
      name: "iot_snapshot",
      description: "Captura um frame/foto de uma câmera IoT e envia no WhatsApp. Suporta câmeras HTTP, RTSP e Raspberry Pi via SSH.",
      parameters: {
        type: "object",
        properties: {
          name: { type: "string", description: "Nome ou ID da câmera" },
        },
        required: ["name"],
      },
    },
  },

  {
    type: "function",
    function: {
      name: "iot_read_sensor",
      description: "Lê o valor atual de um sensor IoT (temperatura, umidade, presença, etc.).",
      parameters: {
        type: "object",
        properties: {
          name: { type: "string", description: "Nome ou ID do sensor" },
        },
        required: ["name"],
      },
    },
  },

  {
    type: "function",
    function: {
      name: "iot_control",
      description: "Liga, desliga ou alterna um relé/atuador IoT. Suporta Tasmota (Sonoff), Shelly, MQTT e HTTP genérico.",
      parameters: {
        type: "object",
        properties: {
          name:   { type: "string", description: "Nome ou ID do dispositivo" },
          action: { type: "string", description: "Ação: on (ligar), off (desligar), toggle (alternar)", enum: ["on","off","toggle"] },
        },
        required: ["name", "action"],
      },
    },
  },

  {
    type: "function",
    function: {
      name: "iot_remove",
      description: "Remove um dispositivo IoT do registro.",
      parameters: {
        type: "object",
        properties: {
          name: { type: "string", description: "Nome ou ID do dispositivo" },
        },
        required: ["name"],
      },
    },
  },

  // ── Self-improvement ──────────────────────────────────────

  {
    type: "function",
    function: {
      name: "improve_self",
      description: `Melhora o próprio código da Nina com segurança total.
Pipeline automático:
1. Lê o arquivo + arquivos dependentes (contexto completo)
2. Gera a melhoria com DeepSeek (até 3 tentativas com estratégias diferentes)
3. Valida sintaxe, exports, tamanho mínimo, estrutura e dependências
4. Faz backup automático com timestamp
5. Aplica a mudança e verifica de novo no arquivo real
6. Se qualquer passo falhar → rollback automático

Use para: adicionar funcionalidades, corrigir bugs, otimizar código, melhorar logs.
Não use para: mudar arquitetura, mover funções entre arquivos, renomear exports.

Exemplos de instruções:
- "adiciona verificação de temperatura da CPU no checkResources"
- "melhora o log de notificações pra incluir o timestamp formatado"
- "adiciona retry com backoff exponencial no checkEmailWatcher"
- "otimiza o buildMemoryContext pra não buscar quando a mensagem tem menos de 5 chars"
- "corrige o erro recorrente de timeout no transcribeAudio"`,
      parameters: {
        type: "object",
        properties: {
          file:             { type: "string",  description: "Nome do arquivo a melhorar (ex: monitor.js, memory.js)" },
          instruction:      { type: "string",  description: "O que melhorar — seja específico e descritivo" },
          dry_run:          { type: "boolean", description: "Se true, apenas mostra o que mudaria sem aplicar nada (padrão: false)" },
          skip_idle_check:  { type: "boolean", description: "Se true, aplica mesmo com usuário ativo (padrão: false — espera 2 min de inatividade)" },
        },
        required: ["file", "instruction"],
      },
    },
  },

  {
    type: "function",
    function: {
      name: "self_improve_status",
      description: "Status do sistema de auto-melhoria: histórico, módulos com erros recentes, se está pronto para melhorar.",
      parameters: { type: "object", properties: {} },
    },
  },

  {
    type: "function",
    function: {
      name: "rollback_self",
      description: "Reverte um arquivo para o backup mais recente antes da última melhoria.",
      parameters: {
        type: "object",
        properties: {
          file: { type: "string", description: "Nome do arquivo pra reverter (ex: monitor.js)" },
        },
        required: ["file"],
      },
    },
  },

  {
    type: "function",
    function: {
      name: "list_backups",
      description: "Lista backups disponíveis para rollback.",
      parameters: {
        type: "object",
        properties: {
          file: { type: "string", description: "Filtrar por arquivo específico (opcional)" },
        },
      },
    },
  },

  {
    type: "function",
    function: {
      name: "get_improvement_history",
      description: "Histórico de todas as melhorias de código aplicadas pela Nina.",
      parameters: {
        type: "object",
        properties: {
          limit: { type: "integer", description: "Quantos registros mostrar (padrão: 10)" },
        },
      },
    },
  },

  // ── Capacidades dinâmicas ─────────────────────────────────

  {
    type: "function",
    function: {
      name: "caps_status",
      description: "Mostra tudo que a Nina sabe fazer: hardware detectado, APIs registradas, integrações ativas, tuning atual e histórico de upgrades.",
      parameters: { type: "object", properties: {} },
    },
  },

  {
    type: "function",
    function: {
      name: "caps_detect_hardware",
      description: "Detecta automaticamente CPU, RAM, disco e GPU do servidor via shell.",
      parameters: { type: "object", properties: {} },
    },
  },

  {
    type: "function",
    function: {
      name: "caps_update_hardware",
      description: "Registra uma mudança de hardware e recalibra os thresholds automaticamente. Use quando o usuário disser 'troquei o processador', 'agora tem mais RAM', etc.",
      parameters: {
        type: "object",
        properties: {
          description: { type: "string", description: "O que mudou (ex: 'troquei pra i7 com 32GB de RAM')" },
          cpu:         { type: "string",  description: "Modelo do CPU (opcional)" },
          ram_gb:      { type: "integer", description: "RAM em GB (opcional)" },
          disk_type:   { type: "string",  description: "Tipo de disco: SSD, HDD, NVMe (opcional)" },
          disk_gb:     { type: "integer", description: "Tamanho do disco em GB (opcional)" },
          gpu:         { type: "string",  description: "Modelo da GPU (opcional)" },
        },
        required: ["description"],
      },
    },
  },

  {
    type: "function",
    function: {
      name: "caps_register_api",
      description: `Registra uma nova API que a Nina pode usar e opcionalmente cria skills automaticamente.
Use quando o usuário disser "pode usar a API do X agora" ou "liberou a key da Binance".
Com auto_learn=true, o DeepSeek gera skills Python pra essa API automaticamente.`,
      parameters: {
        type: "object",
        properties: {
          name:        { type: "string",  description: "Nome da API (ex: binance, openweather, twilio)" },
          description: { type: "string",  description: "O que essa API faz" },
          key_env:     { type: "string",  description: "Variável de ambiente da key (ex: BINANCE_API_KEY)" },
          base_url:    { type: "string",  description: "URL base da API" },
          docs_url:    { type: "string",  description: "URL da documentação (opcional)" },
          auto_learn:  { type: "boolean", description: "Se true, cria skills automaticamente via DeepSeek" },
        },
        required: ["name", "description"],
      },
    },
  },

  {
    type: "function",
    function: {
      name: "caps_update_tuning",
      description: "Ajusta um parâmetro de configuração da Nina. Use quando o hardware mudou e os limites precisam ser recalibrados manualmente.",
      parameters: {
        type: "object",
        properties: {
          key:   { type: "string",  description: "Parâmetro: max_tool_rounds | shell_timeout_sec | script_timeout_sec | monitor_cpu_alert | monitor_ram_alert | monitor_disk_alert | parallel_tools" },
          value: { type: "number",  description: "Novo valor" },
        },
        required: ["key", "value"],
      },
    },
  },

  // ── Finanças autônomas ────────────────────────────────────

  {
    type: "function",
    function: {
      name: "finance_create_strategy",
      description: `Cria uma estratégia financeira autônoma que roda sozinha sem precisar ser chamada.
Tipos:
- dca: compra X de um ativo a cada período (Dollar Cost Average)
- lending: monitora e alerta sobre melhores yields no DeFi (Aave/Compound)
- hodl: compra e registra posição de longo prazo
- hybrid: combinação de estratégias

Exemplos:
- "DCA $25/semana em ETH e BTC por 3 anos" → type=dca, assets=["ETH","BTC"], amount_usd=25, frequency=weekly, horizon_months=36
- "monitora yield de USDC no DeFi" → type=lending, assets=["USDC"]
- "compra $100 de SOL e esquece por 2 anos" → type=hodl, assets=["SOL"], total_budget=100, horizon_months=24`,
      parameters: {
        type: "object",
        properties: {
          name:            { type: "string",  description: "Nome da estratégia" },
          type:            { type: "string",  description: "dca | lending | hodl | hybrid", enum: ["dca","lending","hodl","hybrid"] },
          assets:          { type: "array",   items: { type: "string" }, description: "Ativos (ex: ['BTC','ETH','SOL'])" },
          amount_usd:      { type: "number",  description: "Valor por execução em USD (pra DCA)" },
          total_budget:    { type: "number",  description: "Orçamento total em USD" },
          frequency:       { type: "string",  description: "daily | weekly | monthly", enum: ["daily","weekly","monthly"] },
          horizon_months:  { type: "integer", description: "Horizonte em meses (ex: 36 = 3 anos)" },
          risk_level:      { type: "string",  description: "conservative | moderate | aggressive", enum: ["conservative","moderate","aggressive"] },
          notes:           { type: "string",  description: "Observações da estratégia" },
        },
        required: ["type", "assets"],
      },
    },
  },

  {
    type: "function",
    function: {
      name: "finance_status",
      description: "Status das estratégias financeiras ativas: progresso, último ciclo, orçamento usado.",
      parameters: { type: "object", properties: {} },
    },
  },

  {
    type: "function",
    function: {
      name: "finance_report",
      description: "Gera relatório completo: posições atuais, P&L, estratégias em andamento e últimas transações.",
      parameters: { type: "object", properties: {} },
    },
  },

  {
    type: "function",
    function: {
      name: "finance_defi_rates",
      description: "Consulta os melhores yields de lending no DeFi (Aave v3 + Compound) em tempo real.",
      parameters: {
        type: "object",
        properties: {
          asset: { type: "string", description: "Filtrar por ativo (ex: USDC, ETH, DAI) — opcional" },
        },
      },
    },
  },

  {
    type: "function",
    function: {
      name: "finance_binance_balance",
      description: "Consulta o saldo atual na Binance.",
      parameters: { type: "object", properties: {} },
    },
  },

  {
    type: "function",
    function: {
      name: "finance_binance_buy",
      description: "Executa ordem de compra a mercado na Binance.",
      parameters: {
        type: "object",
        properties: {
          asset:     { type: "string", description: "Ativo a comprar (ex: BTC, ETH, SOL)" },
          usd_amount:{ type: "number", description: "Valor em USD a gastar" },
        },
        required: ["asset", "usd_amount"],
      },
    },
  },

  {
    type: "function",
    function: {
      name: "finance_pause_strategy",
      description: "Pausa uma estratégia financeira sem remover.",
      parameters: {
        type: "object",
        properties: {
          id: { type: "string", description: "ID ou nome da estratégia" },
        },
        required: ["id"],
      },
    },
  },

  {
    type: "function",
    function: {
      name: "finance_resume_strategy",
      description: "Retoma uma estratégia financeira pausada.",
      parameters: {
        type: "object",
        properties: {
          id: { type: "string", description: "ID ou nome da estratégia" },
        },
        required: ["id"],
      },
    },
  },

];

module.exports = { tools };

