// O MENU DO PAINEL MORA AQUI desde 05/11/2026 (o painel antigo, docs/dashboard.html, virou só um redirecionamento).
// Tela nova: uma linha aqui, a página dela em docs/casca/paginas.js e o módulo em docs/casca/modulos.js.
// Conferir: python script/gerar_menu_casca.py (diz se alguma tela do menu ficou sem página).
// Tirar, renomear ou mover tela do menu é item a item, com o sim do dono (13/09/2026).
// Tela incorporada explicitamente pelo Fabio: marcar o item com "origem": "fabio" (nunca inferir autor automaticamente).
window.CASCA_MENU = [
 {
  "id": "gComecar",
  "nome": "Começar por aqui",
  "itens": [
   {
    "chave": "plano",
    "rotulo": "Plano",
    "icone": "🗺️"
   },
   {
    "chave": "estasemana",
    "rotulo": "Esta semana",
    "icone": "🏠"
   },
   {
    "chave": "placar",
    "rotulo": "O Placar",
    "icone": "🧮"
   },
   {
    "chave": "indicadores",
    "rotulo": "Indicadores e metas",
    "icone": "🎯"
   },
   {
    "chave": "semana",
    "rotulo": "A semana",
    "icone": "📅"
   },
   {
    "chave": "reuniao",
    "rotulo": "Reunião semanal",
    "icone": "🗓️",
    "origem": "fabio"
   },
   {
    "chave": "fechamento",
    "rotulo": "Fechamento do mês",
    "icone": "📖"
   }
  ]
 },
 {
  "id": "gResultado",
  "nome": "Resultado",
  "itens": [
   {
    "chave": "evolucao",
    "rotulo": "Evolução de vendas",
    "icone": "📈"
   },
   {
    "chave": "dre",
    "rotulo": "DRE",
    "icone": "📑"
   },
   {
    "chave": "fluxo",
    "rotulo": "Fluxo de caixa realizado",
    "icone": "💵"
   },
   {
    "chave": "despesas",
    "rotulo": "Análise de despesas",
    "icone": "🧾"
   },
   {
    "chave": "rateio",
    "rotulo": "Preço alvo por produto",
    "icone": "🎯"
   },
   {
    "chave": "lucrouni",
    "rotulo": "Lucro por unidade",
    "icone": "🏦"
   },
   {
    "chave": "engcard",
    "rotulo": "Engenharia de cardápio",
    "icone": "🍔"
   },
   {
    "chave": "fichas",
    "rotulo": "Fichas técnicas",
    "icone": "📋"
   }
  ]
 },
 {
  "id": "gIfood",
  "nome": "Canal · iFood",
  "itens": [
   {
    "chave": "vendasagora",
    "rotulo": "Vendas agora",
    "icone": "⏱️"
   },
   {
    "chave": "resumo",
    "rotulo": "Resumo do canal",
    "icone": "📈"
   },
   {
    "chave": "promocoes",
    "rotulo": "Promoções",
    "icone": "🏷️"
   },
   {
    "chave": "cancelamentos",
    "rotulo": "Cancelamentos",
    "icone": "🚫"
   },
   {
    "chave": "contestacoes",
    "rotulo": "Contestações",
    "icone": "⚖️"
   },
   {
    "chave": "atendimento",
    "rotulo": "Atendimento ao cliente",
    "icone": "💬"
   },
   {
    "chave": "negociacoes",
    "rotulo": "Negociações",
    "icone": "🤝"
   },
   {
    "chave": "avaliacoes",
    "rotulo": "Avaliações",
    "icone": "⭐"
   },
   {
    "chave": "qualidade",
    "rotulo": "Qualidade & Super",
    "icone": "🏅"
   },
   {
    "chave": "cardapio",
    "rotulo": "Cardápio",
    "icone": "🍔"
   },
   {
    "chave": "clientes",
    "rotulo": "Clientes",
    "icone": "👥"
   }
  ]
 },
 {
  "id": "gSite",
  "nome": "Canal · Site próprio",
  "itens": [
   {
    "chave": "site",
    "rotulo": "Site próprio",
    "icone": "🌐"
   }
  ]
 },
 {
  "id": "gEntrega",
  "nome": "Entrega",
  "itens": [
   {
    "chave": "delivery",
    "rotulo": "Delivery do dia",
    "icone": "🛵",
    "origem": "fabio"
   },
   {
    "chave": "reservas",
    "rotulo": "Reservas (GetIn)",
    "icone": "📖",
    "origem": "fabio"
   },
   {
    "chave": "pausados",
    "rotulo": "Produtos pausados",
    "icone": "⏸️",
    "origem": "fabio"
   },
   {
    "chave": "atrasos",
    "rotulo": "Atrasos e turnos",
    "icone": "⏱️"
   },
   {
    "chave": "frete",
    "rotulo": "Frete por distância",
    "icone": "📍"
   },
   {
    "chave": "logfin",
    "rotulo": "Financeiro da logística",
    "icone": "🛵"
   },
   {
    "chave": "macertos",
    "rotulo": "Acertos dos motoboys",
    "icone": "🧾"
   }
  ]
 },
 {
  "id": "gFinanceiro",
  "nome": "Financeiro",
  "itens": [
   {
    "chave": "concbanco",
    "rotulo": "Conciliação bancária",
    "icone": "🏦"
   },
   {
    "chave": "caixa",
    "rotulo": "Fechamento de Caixas",
    "icone": "🗃️"
   },
   {
    "chave": "contaspagar",
    "rotulo": "Contas a pagar",
    "icone": "📑"
   },
   {
    "chave": "contasreceber",
    "rotulo": "Contas a receber",
    "icone": "📥"
   },
   {
    "chave": "projecao",
    "rotulo": "Fluxo projetado",
    "icone": "🔮"
   },
   {
    "chave": "rede",
    "rotulo": "Taxas da maquininha",
    "icone": "🏧"
   },
   {
    "chave": "pacertos",
    "rotulo": "Acertos da folha no Saipos",
    "icone": "🔁"
   }
  ]
 },
 {
  "id": "gRh",
  "nome": "Pessoas",
  "itens": [
   {
    "chave": "phoje",
    "rotulo": "O que fazer hoje",
    "icone": "📌"
   },
   {
    "chave": "pcartao",
    "rotulo": "Consulta de ponto",
    "icone": "🕒",
    "origem": "fabio"
   },
   {
    "chave": "pao",
    "rotulo": "Ponto ao Vivo",
    "icone": "🟢",
    "origem": "fabio"
   },
   {
    "chave": "peventos",
    "rotulo": "Eventos e ausências",
    "icone": "🗒️",
    "origem": "fabio"
   },
   {
    "chave": "pcalc",
    "rotulo": "Cálculos da folha",
    "icone": "🧮"
   },
   {
    "chave": "rh",
    "rotulo": "Descontos em folha",
    "icone": "💳"
   },
   {
    "chave": "penvio",
    "rotulo": "Envio à contabilidade",
    "icone": "📤"
   },
   {
    "chave": "pconf",
    "rotulo": "Conferência da folha",
    "icone": "✅"
   },
   {
    "chave": "padm",
    "rotulo": "Admissões",
    "icone": "🆕"
   },
   {
    "chave": "pferias",
    "rotulo": "Férias",
    "icone": "🏖️"
   },
   {
    "chave": "presc",
    "rotulo": "Rescisões",
    "icone": "📄"
   },
   {
    "chave": "cargos",
    "rotulo": "Cargos, salários e custo",
    "icone": "🪪"
   },
   {
    "chave": "freelas",
    "rotulo": "Taxas e Freelas",
    "icone": "🤝",
    "origem": "fabio"
   }
  ]
 },
 {
  "id": "gAtacado",
  "nome": "Atacado",
  "itens": [
   {
    "chave": "orcamentos",
    "rotulo": "Orçamentos",
    "icone": "🧾"
   },
   {
    "chave": "lojaempresas",
    "rotulo": "Lojinha por empresa",
    "icone": "🏪"
   }
  ]
 },
 {
  "id": "gProducao",
  "nome": "Produção e estoque",
  "itens": [
   {
    "chave": "contagem",
    "rotulo": "Contagem de estoque",
    "icone": "📋"
   },
   {
    "chave": "processos",
    "rotulo": "Processos da produção",
    "icone": "🧭"
   },
   {
    "chave": "plprod",
    "rotulo": "Planejar produção",
    "icone": "🗓️"
   },
   {
    "chave": "separacao",
    "rotulo": "Separação",
    "icone": "🧺"
   },
   {
    "chave": "ordens",
    "rotulo": "Ordens de produção",
    "icone": "⏱️"
   },
   {
    "chave": "producao",
    "rotulo": "Apontar produção",
    "icone": "🍳"
   },
   {
    "chave": "fechaturno",
    "rotulo": "Fechar o turno",
    "icone": "🔒"
   },
   {
    "chave": "prodhist",
    "rotulo": "Históricos da produção",
    "icone": "📚"
   },
   {
    "chave": "conferencias",
    "rotulo": "Conferências",
    "icone": "☑️"
   },
   {
    "chave": "reqpedir",
    "rotulo": "Pedir material",
    "icone": "🧻"
   },
   {
    "chave": "reqseparar",
    "rotulo": "Separar requisições",
    "icone": "📤"
   },
   {
    "chave": "controle",
    "rotulo": "Controle de estoque",
    "icone": "📒"
   },
   {
    "chave": "posicao",
    "rotulo": "Posição de estoque",
    "icone": "💰"
   },
   {
    "chave": "comprateto",
    "rotulo": "Teto de compra",
    "icone": "🛒"
   },
   {
    "chave": "listas",
    "rotulo": "Listas · Pedidos",
    "icone": "📦"
   },
   {
    "chave": "listasfin",
    "rotulo": "Listas · Financeiro",
    "icone": "🧾"
   }
  ]
 },
 {
  "id": "gSistema",
  "nome": "Sistema",
  "itens": [
   {
    "chave": "relatorios",
    "rotulo": "Resumos semanais",
    "icone": "🗞️"
   },
   {
    "chave": "conciliacao",
    "rotulo": "Conferência da base",
    "icone": "✅"
   },
   {
    "chave": "atividades",
    "rotulo": "Controle das atividades",
    "icone": "📋"
   },
   {
    "chave": "agenda",
    "rotulo": "Minha agenda",
    "icone": "🗓️"
   },
   {
    "chave": "rotinas",
    "rotulo": "Rotinas",
    "icone": "🤖"
   },
   {
    "chave": "telas",
    "rotulo": "Telas do painel",
    "icone": "🗺️"
   },
   {
    "chave": "link:promos.html",
    "rotulo": "Calendário de promos",
    "icone": "📅",
    "link": "promos.html"
   }
  ]
 }
];

