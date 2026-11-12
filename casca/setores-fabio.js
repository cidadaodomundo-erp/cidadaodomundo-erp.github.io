// SETORES DENTRO DO AGRUPAMENTO "Sistema operacional do Fábio" (id 'outras', montado em sistema.html outrasTelas()).
// Pedido do Fabio (12/11/2026): organizar ESSE agrupamento por setor (Delivery, RH, Salão…), sem mexer nos módulos do
// Neto (casca/modulos.js), sem criar grupo paralelo e sem tirar nenhuma tela de lá. O Ponto ao Vivo (pao) fica aqui, no RH.
//
// Só apresentação: a lista de telas do agrupamento continua sendo a "sobra" calculada pela casca (nada some). Tela da sobra
// que não estiver em nenhum setor cai em "Demais telas". Quem vê cada tela continua sendo visivel()/PODE/painel_acesso.
// Tela com integração pendente (acesso ainda não conectado: sem linha em casca/paginas.js, mesmo que o arquivo da página
// exista) aparece SEM botão ativo, com o aviso.
//
// Atalhos do portal antigo (cidadaodomundo.github.io): abrem em OUTRA ABA (noopener,noreferrer), sem levar login nem dado;
// lá vale o login do portal antigo. NÃO são migração: ficam até a tela ser migrada com o contrato inteiro (ver
// docs/delivery-migracao.md). Para conta restrita só aparecem se a própria chave do atalho estiver na lista dela.
// Nenhum timer, nenhuma leitura de rede, nenhuma escrita neste arquivo.
window.CASCA_SETORES_FABIO = {
  setores: [
    { id: 'delivery', nome: 'Delivery', icone: '🛵',
      chaves: ['delivery', 'antigo:chegada', 'antigo:fila', 'antigo:escala'] },
    { id: 'salao', nome: 'Salão', icone: '🍽️', chaves: ['salao', 'reservas', 'pausados'] },
    { id: 'rh', nome: 'RH', icone: '👥', chaves: ['pao', 'pcartao', 'peventos', 'freelas'] },
    { id: 'cozinha', nome: 'Cozinha e encomendas', icone: '👨‍🍳', chaves: ['cozinha', 'encomendas'] },
    { id: 'manutencao', nome: 'Manutenção e compras', icone: '🔧', chaves: ['manutencao', 'prestadores', 'mercadolivre'] },
    { id: 'gestao', nome: 'Gestão e lojas', icone: '🗓️', chaves: ['reuniao', 'tvs'] },
  ],
  // nome do setor de sobra (tela do agrupamento que não está acima)
  demais: { id: 'demais', nome: 'Demais telas', icone: '📁' },
  // atalhos para telas do portal antigo que ainda são necessárias (existem em ../antigo-atual em 12/11/2026)
  atalhos: {
    'antigo:chegada': { rotulo: 'Motoboys rodando no dia (chegada) · portal antigo', icone: '🛵',
      link: 'https://cidadaodomundo.github.io/chegada/', autorizavelPorChave: true,
      nota: 'Portal antigo, outra aba, com o login de lá. Entrada combinada, chegada, saída registrada, tempo, garantido e refeição continuam lá.' },
    'antigo:fila': { rotulo: 'Mapa de Pedidos (fila) · portal antigo', icone: '🗺️',
      link: 'https://cidadaodomundo.github.io/fila/', autorizavelPorChave: true,
      nota: 'Portal antigo, outra aba, com o login de lá. Ainda não migrado.' },
    'antigo:escala': { rotulo: 'Escala do Delivery (editar) · portal antigo', icone: '📅',
      link: 'https://cidadaodomundo.github.io/delivery/escala.html', autorizavelPorChave: true,
      nota: 'Portal antigo, outra aba, com o login de lá. Aqui a Escala é só consulta e está em construção.' },
  },
  // palavras de busca das telas do agrupamento que ainda não tinham (não sobrescreve casca/busca.js)
  busca: {
    delivery: ['delivery do dia', 'placar do delivery', 'tempo de entrega', 'cancelamentos do dia', 'avaliacoes do dia', 'entregas'],
    salao: ['salao', 'mesas', 'comandas'],
    'antigo:chegada': ['chegada', 'motoboys rodando', 'garantido', 'refeicao', 'chegada dos motoboys'],
    'antigo:fila': ['fila', 'mapa de pedidos', 'fila de pedidos'],
    'antigo:escala': ['escala do delivery', 'escala dos motoboys', 'editar escala'],
  },
};
