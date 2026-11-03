// OS MÓDULOS DA CASCA — formato A (dono, 22/10/2026: "gostei do formato A"; proposta
// contexto/propostas-telas/2026-10-22-formato-a-modulos.md). O Início mostra um cartão por módulo e, dentro dele, duas
// abas: LANÇAR (onde se registra alguma coisa) e ACOMPANHAR (onde se lê). Nome de tela NÃO muda — só o grupo.
// Cada chave é a do menu do painel (casca/menu.js, gerado). Tela do menu que não estiver aqui aparece em "Outras telas"
// (nada some) e o script/gerar_menu_casca.py avisa. Tela nova no painel = uma linha aqui, no módulo dela.
window.CASCA_MODULOS = [
  { id: 'hoje', nome: 'Hoje na rede', icone: '📍',
    lancar: [],
    acompanhar: ['hoje', 'estasemana', 'placar', 'indicadores', 'semana', 'fechamento'] },
  { id: 'estoque', nome: 'Estoque', icone: '📦',
    lancar: ['contagem', 'conferencias'],
    acompanhar: ['controle', 'posicao'] },
  { id: 'compras', nome: 'Compras', icone: '🛒',
    lancar: [], acompanhar: ['comprateto'] },
  { id: 'producao', nome: 'Produção', icone: '🍳',
    lancar: ['processos', 'plprod', 'separacao', 'ordens', 'producao', 'fechaturno'],   // o ciclo, na ordem (dono, 27/10/2026)
    acompanhar: ['prodhist'] },
  { id: 'listas', nome: 'Listas', icone: '🧺',
    lancar: ['listas'],
    acompanhar: ['listasfin'] },
  { id: 'caixa', nome: 'Caixa', icone: '🗃️',
    lancar: ['caixa'],
    acompanhar: ['rede'] },
  { id: 'financeiro', nome: 'Financeiro', icone: '💰',
    lancar: ['concbanco', 'contaspagar', 'contasreceber'],
    acompanhar: ['projecao', 'dre', 'fluxo', 'despesas', 'lucrouni', 'evolucao', 'pacertos'] },
  { id: 'pessoas', nome: 'Pessoas', icone: '👥',
    // 29/10/2026 13:51 (dono): os passos da folha, cada um uma tela, na ordem
    lancar: ['phoje', 'cargos', 'pcalc', 'pferias', 'presc', 'penvio', 'pconf', 'rh'],
    acompanhar: ['reembolsos', 'pcusto'] },
  // 29/10/2026 15:35 (dono): módulo Atacado, tela Orçamentos
  { id: 'atacado', nome: 'Atacado', icone: '🚚',
    lancar: ['orcamentos', 'lojaempresas'], acompanhar: [] },
  { id: 'cardapio', nome: 'Cardápio', icone: '📋',
    lancar: ['fichas'],
    acompanhar: ['engcard', 'rateio', 'cardapio', 'promocoes'] },
  { id: 'vendas', nome: 'Vendas e canais', icone: '🛵',
    lancar: ['contestacoes', 'macertos'],
    // Atendimento ao cliente fica aqui até ir para o portal do Fabio (05/10); 03/11/2026: avaliações, qualidade e negociações já foram (atalho)
    acompanhar: ['vendasagora', 'resumo', 'cancelamentos', 'link:portal-qualidade', 'clientes', 'site', 'atrasos',
                 'frete', 'logfin', 'atendimento'] },
  // 02/11/2026 (dono): junção com o Fabio, passo 1: um cartão em cada painel que abre o outro. Link puro, sem login nem dado.
  { id: 'portal', nome: 'Portal da operação', icone: '🔗', externo: 'https://cidadaodomundo.github.io/', lancar: [], acompanhar: [] },
  { id: 'sistema', nome: 'Sistema', icone: '⚙️',
    lancar: [],
    acompanhar: ['plano', 'atividades', 'rotinas', 'telas', 'conciliacao', 'relatorios', 'link:promos.html'] },
];
