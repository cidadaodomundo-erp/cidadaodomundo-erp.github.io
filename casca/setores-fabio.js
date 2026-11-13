// SETORES DENTRO DO AGRUPAMENTO "Sistema operacional do Fábio" (id 'outras', montado em sistema.html outrasTelas()).
// Pedido do Fabio (12/11/2026): organizar ESSE agrupamento por setor (Delivery, RH, Salão…), sem mexer nos módulos do
// Neto (casca/modulos.js), sem criar grupo paralelo e sem tirar nenhuma tela de lá. O Ponto ao Vivo (pao) fica aqui, no RH.
//
// Só apresentação: a lista de telas do agrupamento continua sendo a "sobra" calculada pela casca (nada some). Tela da sobra
// que não estiver em nenhum setor cai em "Demais telas". Quem vê cada tela continua sendo visivel()/PODE/painel_acesso.
// Tela com integração pendente (acesso ainda não conectado: sem linha em casca/paginas.js, mesmo que o arquivo da página
// exista) aparece SEM botão ativo, com o aviso.
//
// Correção 12/11/2026 (Fabio): os botões deste agrupamento funcionam DENTRO do portal novo. Nenhum atalho para o portal
// antigo. Chegada completa, Fila e edição da Escala estão em migração: só um aviso em texto, sem botão nem link.
// Nenhum timer, nenhuma leitura de rede, nenhuma escrita neste arquivo.
window.CASCA_SETORES_FABIO = {
  setores: [
    { id: 'delivery', nome: 'Delivery', icone: '🛵', chaves: ['delivery', 'chegada'],
      aviso: 'Em migração para este portal: Fila de pedidos e edição da Escala.' },
    { id: 'salao', nome: 'Salão', icone: '🍽️', chaves: ['salao', 'reservas', 'pausados'] },
    { id: 'rh', nome: 'RH', icone: '👥', chaves: ['prh', 'pao', 'pcartao', 'peventos', 'freelas'] },
    { id: 'cozinha', nome: 'Cozinha e encomendas', icone: '👨‍🍳', chaves: ['cozinha', 'encomendas'] },
    { id: 'manutencao', nome: 'Manutenção e compras', icone: '🔧', chaves: ['manutencao', 'prestadores', 'mercadolivre'] },
    { id: 'gestao', nome: 'Gestão e lojas', icone: '🗓️', chaves: ['reuniao', 'tvs'] },
  ],
  // nome do setor de sobra (tela do agrupamento que não está acima)
  demais: { id: 'demais', nome: 'Demais telas', icone: '📁' },
  // palavras de busca das telas do agrupamento que ainda não tinham (não sobrescreve casca/busca.js)
  busca: {
    delivery: ['delivery do dia', 'placar do delivery', 'tempo de entrega', 'cancelamentos do dia', 'avaliacoes do dia', 'entregas'],
    salao: ['salao', 'mesas', 'comandas'],
  },
};
