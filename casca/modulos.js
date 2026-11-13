// OS MÓDULOS DA CASCA — MENU NOVO OFICIAL (dono, sáb 07/11/2026 03:51, no Organizador: "gostei do menu, pode aplicar, pode
// tirar o equipe da frente dos módulos"). Veio da simulação ?menu=proposta (casca/modulos-proposta.js, 07/11 02:11), que
// partiu do artefato "Reorganização do Menu" (05/11). Cada módulo abre UMA lista (semAbas): a separação Lançar/Acompanhar
// saiu (dono 07/11: "será que essa separação de lançar e acompanhar é necessária?"); os campos lancar/acompanhar só dão a
// ordem. A "Hoje na rede" mora dentro de "Agora". As junções de telas e os consertos de número seguem depois, tela a tela.
// Cada chave é a do menu do painel (casca/menu.js). Tela do menu que não estiver aqui aparece em "Outras telas" (nada some)
// e o script/gerar_menu_casca.py avisa. Tela nova no painel = uma linha aqui, no módulo dela, e as palavras dela em casca/busca.js.
window.CASCA_MODULOS_CFG = {
  semAbas: true,          // o módulo abre uma lista só, na ordem abaixo
  hojeNoModulo: true,     // "Hoje na rede" fica dentro de "Agora", não solta no alto do menu
  // nome de tela que muda só no menu novo
  rotulos: {
    resumo: 'Resumo do iFood',
    cardapio: 'Desempenho do cardápio',
    logfin: 'Motoboys · Financeiro da logística',
    macertos: 'Motoboys · Acertos',
    contestacoes: 'Cancelamentos · Contestações',
    reembolsos: 'Pedir reembolso',
  },
  // telas que não estão no menu.js e entram no menu novo
  extras: { reembolsos: { rotulo: 'Pedir reembolso', icone: '💸' },   // dono 07/11: fica, para pedir daqui pra frente (com o Histórico)
    notasfaltam: { rotulo: 'Notas sem conta / sem entrada', icone: '🧾' },
    cartao: { rotulo: 'Compra no cartão', icone: '💳' },
    compliance: { rotulo: 'Documentos e renovações', icone: '📑' },   // 13/11: alvarás, licenças, limpezas, extintores (Compliance)   // 13/11: compra no cartão + anexar a fatura (Hellen)   // 12/11: onde a Rita resolve as tarefas 30 e 82
    motoboys: { rotulo: 'Motoboys', icone: '🛵' } },   // 12/11: junção abaixo (Financeiro da logística + Acertos)
  // JUNÇÕES (dono 12/11/2026 00:32: "Pode juntar as duas sugestões"; livro chat-frente-telas/respostas/juncoes-contestacoes-motoboys):
  // um item só no menu; ao abrir, a casca mostra as abas logo abaixo do título. Cada aba é a tela que já existia (mesma
  // chave, mesma página, mesmo cálculo). Quem vê o item: quem pode abrir qualquer uma das abas (painel_acesso das chaves
  // antigas continua valendo, sem SQL). Os endereços antigos (#contestacoes, #logfin, #macertos) abrem a aba deles.
  juncoes: {
    cancelamentos: { abas: [['cancelamentos', 'Cancelamentos'], ['contestacoes', 'Contestações']] },
    motoboys: { abas: [['logfin', 'Financeiro da logística'], ['macertos', 'Acertos']] },
  },
};
window.CASCA_MODULOS = [
  { id: 'agora', nome: 'Agora', icone: '📍',
    lancar: [], acompanhar: ['hoje', 'agenda', 'compliance', 'vendasagora'] },   // 12/11 16:55: o Controle das atividades virou o bloco Equipe da agenda   // 12/11 16:39: o Plano (Em desenvolvimento) entrou na agenda   // 07/11: Esta semana virou a "Semana em curso" da Hoje
  { id: 'dinheiro', nome: 'Dinheiro', icone: '💰',
    lancar: ['contaspagar', 'contasreceber', 'concbanco', 'caixa', 'cartao', 'reembolsos'],
    acompanhar: ['projecao', 'fluxo', 'rede'] },
  { id: 'resultado', nome: 'Resultado', icone: '📊',
    lancar: [], acompanhar: ['placar', 'semana', 'dre',   /* 07/11: Fechamento virou aba do Placar */ 'indicadores', 'evolucao', 'lucrouni', 'despesas'] },
  { id: 'vendas', nome: 'Vendas e canais', icone: '🛵',
    lancar: [], acompanhar: ['resumo', 'promocoes', 'cancelamentos', 'cardapio', 'clientes', 'site', 'frete', 'motoboys'] },   // 12/11: Contestações é aba de Cancelamentos; Motoboys junta logfin + macertos (juncoes)
  { id: 'estoque', nome: 'Estoque', icone: '📦',
    lancar: ['contagem', 'conferencias', 'reqpedir', 'reqseparar'], acompanhar: ['controle', 'posicao'] },
  { id: 'compras', nome: 'Compras', icone: '🛒', lancar: ['notasfaltam'], acompanhar: ['comprateto'] },
  { id: 'producao', nome: 'Produção', icone: '🍳',
    lancar: ['processos', 'plprod', 'separacao', 'ordens', 'producao', 'fechaturno'], acompanhar: ['prodhist'] },   // o ciclo, na ordem (dono, 27/10)
  { id: 'listas', nome: 'Listas', icone: '🧺', lancar: ['listas'], acompanhar: ['listasfin'] },
  { id: 'cardapiocusto', nome: 'Cardápio e custo', icone: '📋', lancar: ['fichas'], acompanhar: ['engcard', 'rateio'] },
  { id: 'atacado', nome: 'Atacado', icone: '🚚', lancar: ['orcamentos', 'lojaempresas'], acompanhar: [] },
  { id: 'pessoas', nome: 'Pessoas', icone: '👥',
    lancar: ['phoje', 'pcalc', 'rh', 'penvio', 'pconf', 'padm', 'pferias', 'presc', 'cargos', 'pseguro', 'pacertos'], acompanhar: [] },   // ordem do dono (06/11)
  { id: 'fabio', nome: 'Operação do Fabio', icone: '🧭',
    lancar: [], acompanhar: ['atrasos', 'atendimento', 'link:portal-qualidade'] },
  // 02/11/2026 (dono): junção com o Fabio, passo 1: um cartão em cada painel que abre o outro. Link puro, sem login nem dado.
  { id: 'portal', nome: 'Portal da operação', icone: '🔗', externo: 'https://cidadaodomundo.github.io/', lancar: [], acompanhar: [] },
  { id: 'sistema', nome: 'Sistema', icone: '⚙️',
    lancar: [], acompanhar: ['rotinas', 'telas', 'conciliacao', 'relatorios', 'link:promos.html'] },
];


