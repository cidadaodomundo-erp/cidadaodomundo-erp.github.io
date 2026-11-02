// Telas que JÁ SAÍRAM do docs/dashboard.html para uma página própria (14/10/2026).
//
// A casca (docs/sistema.html) abre toda tela do menu dentro do painel antigo, a não ser
// que ela esteja aqui: aí abre a página nova numa moldura própria, sem carregar o painel.
// Cada bloco que for separado (ordem no mapa de contexto/project_painel_em_modulos.md)
// entra com uma linha, por exemplo:
//     listas: 'listas/index.html',
// O endereço é relativo a docs/. A tela continua no menu do painel com o mesmo nome:
// quem decide se ela sai do menu é o dono, item a item.
window.CASCA_PAGINAS = {
  // 24/10/2026 (bloco 1): as Listas abrem na página delas, sem a carga de vendas do painel
  listas: 'listas/index.html#pedidos',
  listasfin: 'listas/index.html#financeiro',
  // 24/10/2026 (bloco 2): Produção e estoque
  contagem: 'estoque/index.html#contagem',
  processos: 'estoque/index.html#processos',
  plprod: 'estoque/index.html#plprod',
  // 27/10/2026 (dono): o ciclo em quatro telas
  separacao: 'estoque/index.html#separacao',
  ordens: 'estoque/index.html#ordens',
  producao: 'estoque/index.html#producao',
  // 02/11/2026: fechamento do turno (dono, 23/10) e teto de compra (dono, 02/11)
  fechaturno: 'estoque/index.html#fechaturno',
  comprateto: 'estoque/index.html#comprateto',
  prodhist: 'estoque/index.html#prodhist',
  // 29/10/2026 (dono): uma tela só de conferências, com abas (Embalagem, Receitas, Produtos, Bebidas)
  conferencias: 'estoque/index.html#conferencias',
  controle: 'estoque/index.html#controle',
  posicao: 'estoque/index.html#posicao',
  // 29/10/2026 (dono): módulo Atacado
  orcamentos: 'atacado/index.html#orcamentos',
  lojaempresas: 'atacado/index.html#lojaempresas',
  // 26/10/2026 (bloco 3): Fechamento de Caixas
  caixa: 'caixa/index.html#caixa',
  // 26/10/2026 (bloco 4): Pessoas
  // 02/11/2026 (dono): o que está pendente no módulo, numa tela só
  phoje: 'pessoas/index.html#phoje',
  cargos: 'pessoas/index.html#cargos',
  // 29/10/2026 (dono): cada passo da folha é uma tela
  pcalc: 'pessoas/index.html#pcalc',
  pferias: 'pessoas/index.html#pferias',
  macertos: 'pessoas/index.html#macertos',
  presc: 'pessoas/index.html#presc',
  penvio: 'pessoas/index.html#penvio',
  pconf: 'pessoas/index.html#pconf',
  pcusto: 'pessoas/index.html#pcusto',
  pacertos: 'pessoas/index.html#pacertos',
  rh: 'pessoas/index.html#rh',
  flash: 'pessoas/index.html#flash',
  reembolsos: 'pessoas/index.html#reembolsos',
  // 26/10/2026 (bloco 5): Custo e cardápio (Desempenho do cardápio e Promoções seguem no painel antigo)
  fichas: 'cardapio/index.html#fichas',
  engcard: 'cardapio/index.html#engcard',
  rateio: 'cardapio/index.html#rateio',
  // 01/11/2026 (dono): acompanhamento do dia, sem a carga de vendas do painel
  vendasagora: 'vendas/index.html',
};

// 28/10/2026 (seletor de loja único): telas que já seguem a loja escolhida no topo da casca. As outras mostram a faixa
// "esta tela ainda não separa pela loja". Entra uma chave por tela migrada (proposta 2026-10-28-seletor-loja-unico.md).
window.CASCA_TELAS_POR_LOJA = ['caixa',
  'contagem', 'processos', 'plprod', 'separacao', 'ordens', 'producao', 'fechaturno', 'comprateto', 'prodhist', 'controle', 'posicao',
  'listas', 'listasfin',
  'phoje', 'cargos', 'pcalc', 'pferias', 'presc', 'penvio', 'pconf', 'pcusto', 'pacertos', 'flash', 'rateio',
  'estasemana', 'resumo', 'cancelamentos', 'promocoes', 'qualidade', 'site', 'evolucao',
  'negociacoes', 'avaliacoes', 'cardapio', 'clientes', 'frete', 'atrasos', 'logfin', 'macertos',
  'hoje', 'placar', 'indicadores', 'fechamento', 'semana', 'dre', 'fluxo', 'despesas', 'lucrouni', 'concbanco', 'contaspagar', 'contasreceber', 'projecao', 'vendasagora'];
