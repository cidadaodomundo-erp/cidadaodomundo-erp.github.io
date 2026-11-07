// SIMULAÇÃO DO MENU NOVO (dono, sáb 07/11/2026 02:11: "sim, pede a simulação pro Telas"; 02:13: "eu vou aprovando vendo as telas").
// Vale SÓ com sistema.html?menu=proposta — sem o parâmetro, todo mundo segue com o menu de hoje (casca/modulos.js).
// Base: artefato "Reorganização do Menu" (05/11). Nesta etapa só muda grupo, ordem e nome; as JUNÇÕES aparecem como itens
// vizinhos ("· junta …") no grupo certo, sem refazer tela. "Sai do menu" fica num grupo no fim, para ver o que some.
// Só vira oficial com o "pode" do dono: aí este arquivo passa a ser o casca/modulos.js.
(function () {
  let pedido = '';
  try { pedido = new URLSearchParams(location.search).get('menu') || ''; } catch (e) {}
  if (pedido !== 'proposta') return;
  window.CASCA_PROPOSTA = {
    // nome novo de tela (só na simulação)
    rotulos: {
      estasemana: 'Esta semana · junta na Hoje',
      fechamento: 'Fechamento do mês · junta no Placar',
      contestacoes: 'Contestações · junta em Cancelamentos',
      resumo: 'Resumo do iFood',
      cardapio: 'Desempenho do cardápio',
      logfin: 'Motoboys · Financeiro da logística',
      macertos: 'Motoboys · Acertos (junta com o de cima)',
      reembolsos: 'Pedir reembolso',
    },
    // telas que hoje não estão no menu e entram na simulação
    extras: { reembolsos: { rotulo: 'Pedir reembolso', icone: '💸' } },   // 07/11 (dono): fica, sem histórico, só para pedir daqui pra frente
    // 07/11 (dono: "será que essa separação de lançar e acompanhar é necessária?"): na simulação o módulo abre UMA lista
    semAbas: true,
    modulos: [
      { id: 'p-agora', nome: 'Agora', icone: '📍',
        lancar: [], acompanhar: ['hoje', 'estasemana', 'vendasagora', 'atividades'] },
      { id: 'p-dinheiro', nome: 'Dinheiro', icone: '💰',
        lancar: ['contaspagar', 'contasreceber', 'concbanco', 'caixa', 'reembolsos'],
        acompanhar: ['projecao', 'fluxo', 'rede'] },
      { id: 'p-resultado', nome: 'Resultado', icone: '📊',
        lancar: [], acompanhar: ['placar', 'fechamento', 'semana', 'dre', 'indicadores', 'evolucao', 'lucrouni', 'despesas'] },
      { id: 'p-vendas', nome: 'Vendas e canais', icone: '🛵',
        lancar: [], acompanhar: ['resumo', 'promocoes', 'cancelamentos', 'contestacoes', 'cardapio', 'clientes', 'site', 'frete', 'logfin', 'macertos'] },
      // Operação da equipe: como hoje, por dentro não muda
      { id: 'p-estoque', nome: 'Equipe · Estoque', icone: '📦',
        lancar: ['contagem', 'conferencias', 'reqpedir', 'reqseparar'], acompanhar: ['controle', 'posicao'] },
      { id: 'p-compras', nome: 'Equipe · Compras', icone: '🛒', lancar: [], acompanhar: ['comprateto'] },
      { id: 'p-producao', nome: 'Equipe · Produção', icone: '🍳',
        lancar: ['processos', 'plprod', 'separacao', 'ordens', 'producao', 'fechaturno'], acompanhar: ['prodhist'] },
      { id: 'p-listas', nome: 'Equipe · Listas', icone: '🧺', lancar: ['listas'], acompanhar: ['listasfin'] },
      { id: 'p-cardapio', nome: 'Equipe · Cardápio e custo', icone: '📋', lancar: ['fichas'], acompanhar: ['engcard', 'rateio'] },
      { id: 'p-atacado', nome: 'Equipe · Atacado', icone: '🚚', lancar: ['orcamentos', 'lojaempresas'], acompanhar: [] },
      { id: 'p-pessoas', nome: 'Equipe · Pessoas', icone: '👥',
        lancar: ['phoje', 'pcalc', 'rh', 'penvio', 'pconf', 'padm', 'pferias', 'presc', 'cargos', 'pacertos'], acompanhar: [] },
      { id: 'p-fabio', nome: 'Operação do Fabio', icone: '🧭',
        lancar: [], acompanhar: ['atrasos', 'atendimento', 'link:portal-qualidade'] },
      { id: 'portal', nome: 'Portal da operação', icone: '🔗', externo: 'https://cidadaodomundo.github.io/', lancar: [], acompanhar: [] },
      { id: 'p-sistema', nome: 'Sistema', icone: '⚙️', lancar: [], acompanhar: ['plano', 'rotinas', 'telas', 'conciliacao', 'relatorios', 'link:promos.html'] },
    ],
  };
})();
