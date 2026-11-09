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
    reembolsos: 'Pedir reembolso',
    plano: 'Em desenvolvimento',   // dono 07/11 03:59: o plano, com a evolução em cima (o Fabio acompanha)
  },
  // telas que não estão no menu.js e entram no menu novo
  extras: { reembolsos: { rotulo: 'Pedir reembolso', icone: '💸' } },   // dono 07/11: fica, para pedir daqui pra frente (com o Histórico)
};
window.CASCA_MODULOS = [
  { id: 'agora', nome: 'Agora', icone: '📍',
    lancar: [], acompanhar: ['hoje', 'agenda', 'plano', 'vendasagora', 'atividades'] },   // 07/11: Esta semana virou a "Semana em curso" da Hoje
  { id: 'dinheiro', nome: 'Dinheiro', icone: '💰',
    lancar: ['contaspagar', 'contasreceber', 'concbanco', 'caixa', 'reembolsos'],
    acompanhar: ['projecao', 'fluxo', 'rede'] },
  { id: 'resultado', nome: 'Resultado', icone: '📊',
    lancar: [], acompanhar: ['placar', 'semana', 'dre',   /* 07/11: Fechamento virou aba do Placar */ 'indicadores', 'evolucao', 'lucrouni', 'despesas'] },
  { id: 'vendas', nome: 'Vendas e canais', icone: '🛵',
    lancar: [], acompanhar: ['resumo', 'promocoes', 'cancelamentos', 'contestacoes', 'cardapio', 'clientes', 'site', 'frete', 'logfin', 'macertos'] },
  { id: 'estoque', nome: 'Estoque', icone: '📦',
    lancar: ['contagem', 'conferencias', 'reqpedir', 'reqseparar'], acompanhar: ['controle', 'posicao'] },
  { id: 'compras', nome: 'Compras', icone: '🛒', lancar: [], acompanhar: ['comprateto'] },
  { id: 'producao', nome: 'Produção', icone: '🍳',
    lancar: ['processos', 'plprod', 'separacao', 'ordens', 'producao', 'fechaturno'], acompanhar: ['prodhist'] },   // o ciclo, na ordem (dono, 27/10)
  { id: 'listas', nome: 'Listas', icone: '🧺', lancar: ['listas'], acompanhar: ['listasfin'] },
  { id: 'cardapiocusto', nome: 'Cardápio e custo', icone: '📋', lancar: ['fichas'], acompanhar: ['engcard', 'rateio'] },
  { id: 'atacado', nome: 'Atacado', icone: '🚚', lancar: ['orcamentos', 'lojaempresas'], acompanhar: [] },
  { id: 'pessoas', nome: 'Pessoas', icone: '👥',
    lancar: ['phoje', 'pcalc', 'rh', 'penvio', 'pconf', 'padm', 'pferias', 'presc', 'cargos', 'pacertos'], acompanhar: [] },   // ordem do dono (06/11)
  { id: 'fabio', nome: 'Operação do Fabio', icone: '🧭',
    lancar: [], acompanhar: ['delivery', 'atrasos', 'atendimento', 'link:portal-qualidade'] },
  // 02/11/2026 (dono): junção com o Fabio, passo 1: um cartão em cada painel que abre o outro. Link puro, sem login nem dado.
  { id: 'portal', nome: 'Portal da operação', icone: '🔗', externo: 'https://cidadaodomundo.github.io/', lancar: [], acompanhar: [] },
  { id: 'sistema', nome: 'Sistema', icone: '⚙️',
    lancar: [], acompanhar: ['rotinas', 'telas', 'conciliacao', 'relatorios', 'link:promos.html'] },
];
