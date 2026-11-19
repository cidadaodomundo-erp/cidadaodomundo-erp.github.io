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
  notaschegou: 'estoque/index.html#notaschegou',   // 17/11/2026: Notas que chegaram (robô da NF, passo 3)
  prodhist: 'estoque/index.html#prodhist',
  // 29/10/2026 (dono): uma tela só de conferências, com abas (Embalagem, Receitas, Produtos, Bebidas)
  conferencias: 'estoque/index.html#conferencias',
  // 05/11/2026 (dono): requisição de material
  reqpedir: 'estoque/index.html#reqpedir',
  reqseparar: 'estoque/index.html#reqseparar',
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
  pcartao: 'pessoas/index.html#pcartao',   // Consulta de ponto (rh_pessoa + rh_flash_batida, só leitura)
  peventos: 'pessoas/index.html#peventos', // Eventos e ausências (rh_flash_ausencia + rh_ocorrencia, só leitura)
  pao: 'pessoas/index.html#pao',   // 12/11/2026: Ponto ao Vivo (RH), leitura de rh_flash_batida
  prh: 'pessoas/index.html#prh',   // 13/11/2026: Gestão do RH — erros do dia (leitor próprio fabio-ponto-leitura, só leitura)
  padm: 'pessoas/index.html#padm',
  pseguro: 'pessoas/index.html#pseguro',   // 13/11/2026: Seguro de vida (RH), só leitura
  // atividades: saiu do menu em 12/11/2026 (dono 16:55); #atividades abre a agenda no bloco Equipe (sistema.html, abrir)
  agenda: 'agenda/index.html',
  biblioteca: 'biblioteca/index.html',
  estudos: 'estudos.html',   // 19/11/2026: Estudos do Neto (cópia dos artefatos; só Neto e Fabio, artefato_copia)
  usuarios: 'usuarios/index.html',   // 18/11/2026: Usuários do painel (só o dono; criar, editar, senha, telas)   // 18/11/2026: Biblioteca — guias, estudos e dossiês de um clique (painel_biblioteca)
  desperdicio: 'desperdicio/index.html',   // 18/11/2026: Desperdício — perdas dos últimos 30 dias (vw_est_perda, só leitura)
  regras: 'regras/index.html',   // 16/11/2026: Regras em vigor (só o dono; vw_regras_em_vigor)
  notasfaltam: 'notas/index.html',
  cartao: 'cartao/index.html',
  compliance: 'compliance/index.html',   // 13/11/2026: Documentos e renovações (Compliance; dono #569)   // 13/11/2026: Compra no cartão + Anexar fatura (Financeiro; missão do dono 02:26/02:29)   // 12/11/2026: notas sem conta / sem entrada (tarefas 30 e 82 da Rita)
  cargos: 'pessoas/index.html#cargos',
  // 29/10/2026 (dono): cada passo da folha é uma tela
  pcalc: 'pessoas/index.html#pcalc',
  pferias: 'pessoas/index.html#pferias',
  macertos: 'pessoas/index.html#macertos',
  presc: 'pessoas/index.html#presc',
  penvio: 'pessoas/index.html#penvio',
  pconf: 'pessoas/index.html#pconf',
  pacertos: 'pessoas/index.html#pacertos',
  rh: 'pessoas/index.html#rh',
  flash: 'pessoas/index.html#flash',
  reembolsos: 'pessoas/index.html#reembolsos',
  // 26/10/2026 (bloco 5): Custo e cardápio (Desempenho do cardápio e Promoções seguem no painel antigo)
  fichas: 'cardapio/index.html#fichas',
  engcard: 'cardapio/index.html#engcard',
  rateio: 'cardapio/index.html#rateio',
  saiposcod: 'cardapio/index.html#saiposcod',   // 16/11/2026: Código que falhou no Saipos (Cardápio; dono 12/11)
  // 01/11/2026 (dono): acompanhamento do dia, sem a carga de vendas do painel
  vendasagora: 'vendas/index.html',
  // 05/11/2026 (bloco 6): Canal · iFood, Site próprio e Entrega
  resumo: 'canal/index.html#resumo',
  promocoes: 'canal/index.html#promocoes',
  cancelamentos: 'canal/index.html#cancelamentos',
  contestacoes: 'canal/index.html#contestacoes',
  atendimento: 'canal/index.html#atendimento',
  negociacoes: 'canal/index.html#negociacoes',
  avaliacoes: 'canal/index.html#avaliacoes',
  qualidade: 'canal/index.html#qualidade',
  cardapio: 'canal/index.html#cardapio',
  clientes: 'canal/index.html#clientes',
  site: 'canal/index.html#site',
  atrasos: 'canal/index.html#atrasos',
  frete: 'canal/index.html#frete',
  logfin: 'canal/index.html#logfin',
  // 05/11/2026: a última tela que ainda abria no painel antigo (Resumos semanais)
  relatorios: 'canal/index.html#relatorios',
  // 05/11/2026 (bloco 7): Começar por aqui, Resultado e Financeiro
  estasemana: 'gestao/index.html#estasemana',
  hoje: 'gestao/index.html#hoje',
  placar: 'gestao/index.html#placar',
  indicadores: 'gestao/index.html#indicadores',
  semana: 'gestao/index.html#semana',
  fechamento: 'gestao/index.html#fechamento',
  evolucao: 'gestao/index.html#evolucao',
  dre: 'gestao/index.html#dre',
  fluxo: 'gestao/index.html#fluxo',
  despesas: 'gestao/index.html#despesas',
  lucrouni: 'gestao/index.html#lucrouni',
  concbanco: 'gestao/index.html#concbanco',
  conciliacao: 'gestao/index.html#conciliacao',
  contaspagar: 'gestao/index.html#contaspagar',
  contasreceber: 'gestao/index.html#contasreceber',
  projecao: 'gestao/index.html#projecao',
  rede: 'gestao/index.html#rede',
  // 05/11/2026 (último bloco): Sistema
  // plano: saiu do menu em 12/11/2026 (dono 16:39); #plano abre a agenda no bloco Desenvolvimentos (sistema.html, abrir)
  rotinas: 'sistema/index.html#rotinas',
  telas: 'sistema/index.html#telas',
  // 12/11/2026: telas do agrupamento "Operação das lojas" que passam a abrir a
  // página delas. As outras telas desse agrupamento ainda não têm linha aqui e aparecem sem botão ativo (docs/delivery-migracao.md).
  delivery: 'delivery/index.html',   // Delivery do dia: placar, tempo, cancelamentos e avaliações (delivery_dia)
  freelas: 'freelas/index.html?v=20261116a',        // 16/11/2026: Taxas e Freelas (consulta + loja de cada freela)
  reuniao: 'reuniao/index.html?v=20261115a',        // Reunião semanal (pauta temporária, separada por loja)
  temperaturas: 'temperaturas/index.html',   // 19/11/2026 (Organizador 00:03): tela do Fabio, em Produção, para quem vê a Produção
  manutencao: 'manutencao/index.html?v=20261115a#chamados',      // Manutenção (chamados só preparados)
  prestadores: 'manutencao/index.html?v=20261115a#prestadores',  // Quem conserta (diretório de prestador, só consulta)
  pagarmoto: 'delivery/pagar-motoboys.html?v=20261116f',  // 16/11/2026: Pagar motoboys (pagar_motoboys_dia, só leitura); só quem vê pessoal
  chegada: 'delivery/chegada.html',  // 12/11/2026: Chegada dos motoboys (fabio-delivery-chegada, só leitura); permissão = a do Delivery
  salao: 'salao/index.html',         // 17/11/2026: Central do Salão (eventos da cidade, reservas, tablet, Google, equipe)
  reservas: 'reservas/index.html',   // 12/11/2026: Reservas (GetIn), mesma página, religada no novo local do Fábio
  pausados: 'pausados/index.html?modo=salao&v=20261116a',   // 16/11/2026: Itens pausados do Salão = só Goomer (tablet)
  pausadosdel: 'pausados/index.html?modo=delivery&v=20261116a',   // 16/11/2026: Itens pausados do Delivery = iFood x Site (Accon), iFood é a referência
  motodocs: 'delivery/motoboys-documentos.html?v=20261117a',   // 17/11/2026: Documentos dos motoboys (erp_motoboys_ler); só quem vê pessoal
  escalaclima: 'delivery/escala.html?v=20261117a',   // 17/11/2026: Escala e Clima (erp_escala_clima_ler + Open-Meteo), só leitura
  taxaponto: 'taxa/painel.html?v=20261117a',   // 17/11/2026: Ponto dos taxas pelo QR (erp_taxa_ponto_ler, taxa_qr_codigo_da_semana)
  avaldel: 'avaliacoes/index.html?modo=delivery&v=20261116a',     // 16/11/2026: Avaliações do dia do Delivery (iFood; Accon sem avaliações no sistema)
  avalsalao: 'avaliacoes/index.html?modo=salao&v=20261116a',      // 16/11/2026: Avaliações do dia do Salão (Google, API oficial)
  mercadolivre: 'mercadolivre/index.html?v=20261117a',            // 17/11/2026: Compras · Mercado Livre (cotação; robô de Compras no Escritório 2; nada é comprado sozinho)
};

// 05/11/2026: telas que não têm loja nenhuma — a casca esconde o seletor "Vendo" (dono, 23/10, no Plano)
// 07/11/2026 (auditoria lote 1, resultado-33): 'atividades' é por pessoa, não por loja — sai de POR_LOJA e vem para cá.
window.CASCA_TELAS_SEM_LOJA = ['plano', 'telas', 'rotinas', 'atividades', 'pseguro', 'cartao', 'compliance', 'regras', 'biblioteca', 'estudos', 'usuarios',
  'prestadores',    // Quem conserta é um diretório geral (o cadastro de prestadores não tem loja)
  'mercadolivre'];  // 17/11/2026: cada pedido de compra escolhe a loja de entrega na própria tela (o banco filtra pelas lojas do login)

// 28/10/2026 (seletor de loja único): telas que já seguem a loja escolhida no topo da casca. As outras mostram a faixa
// "esta tela ainda não separa pela loja". Entra uma chave por tela migrada (proposta 2026-10-28-seletor-loja-unico.md).
window.CASCA_TELAS_POR_LOJA = ['caixa',
  'contagem', 'processos', 'plprod', 'separacao', 'ordens', 'producao', 'fechaturno', 'comprateto', 'notaschegou', 'prodhist', 'controle', 'posicao', 'reqpedir', 'reqseparar',
  'listas', 'listasfin',
  'phoje', 'pcartao', 'pao', 'peventos', 'prh', 'padm', 'cargos', 'pcalc', 'pferias', 'presc', 'penvio', 'pconf', 'pacertos', 'flash', 'rateio', 'saiposcod',
  'estasemana', 'resumo', 'cancelamentos', 'promocoes', 'qualidade', 'site', 'evolucao',
  'negociacoes', 'avaliacoes', 'contestacoes', 'cardapio', 'clientes', 'frete', 'atrasos', 'logfin', 'macertos',
  'hoje', 'placar', 'indicadores', 'fechamento', 'semana', 'dre', 'fluxo', 'despesas', 'lucrouni', 'concbanco', 'contaspagar', 'contasreceber', 'projecao', 'vendasagora',
  'delivery', 'chegada', 'reservas', 'pausados', 'pausadosdel', 'avaldel', 'avalsalao', 'motodocs', 'escalaclima', 'taxaponto', 'reuniao', 'manutencao', 'freelas'];   // 12/11/2026: o Delivery do dia segue a loja do topo (aoMudarLoja/lojaAtual) e só mostra as lojas autorizadas

