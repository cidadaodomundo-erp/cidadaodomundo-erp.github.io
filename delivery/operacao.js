// Delivery do dia: abas "Chegada do dia", "Escala do Delivery" e "Conferência do Delivery" (EM CONSTRUÇÃO).
// Só apresentação: não consulta nem grava nada, não depende dos dados das abas antigas. Todo campo ainda sem fonte
// aparece como "Ainda não ligado" ou "A conferir"; não há linhas, números ou totais de exemplo.
// Uso no navegador: window.DeliveryOperacao. Uso em teste: require('./operacao.js').
(function (raiz, fabrica) {
  const api = fabrica();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else raiz.DeliveryOperacao = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const ABAS_ANTIGAS = ['placar', 'tempo', 'cancel', 'quali'];
  const ABAS_NOVAS = ['chegada', 'escala', 'conferencia'];
  const PADRAO = 'placar';
  const NAO_LIGADO = 'Ainda não ligado';
  const A_CONFERIR = 'A conferir';

  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  // Aba escolhida a partir do hash da página; qualquer coisa desconhecida cai no Placar.
  function abaDoHash(hash) {
    let h = String(hash == null ? '' : hash).replace(/^#/, '');
    try { h = decodeURIComponent(h); } catch (e) { return PADRAO; }
    return (ABAS_ANTIGAS.indexOf(h) >= 0 || ABAS_NOVAS.indexOf(h) >= 0) ? h : PADRAO;
  }
  const ehNova = (aba) => ABAS_NOVAS.indexOf(aba) >= 0;

  // Só aceita AAAA-MM-DD de calendário válido; senão não mostra dia nenhum (não inventa).
  function diaBR(dia) {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(dia || ''));
    if (!m) return null;
    const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
    if (d.getUTCFullYear() !== +m[1] || d.getUTCMonth() !== +m[2] - 1 || d.getUTCDate() !== +m[3]) return null;
    return m[3] + '/' + m[2] + '/' + m[1];
  }

  const selo = '<span class="op-selo">Em construção</span>';

  function campos(lista, ctx) {
    const dia = diaBR(ctx && ctx.dia);
    const loja = ctx && ctx.loja ? String(ctx.loja) : null;
    return '<dl class="op-campos">' + lista.map((c) => {
      let v = c.v;
      if (c.k === 'dia') v = dia || 'Escolha um dia';
      else if (c.k === 'loja') v = loja || 'Ainda não ligado (nenhuma loja escolhida)';
      const vazio = (c.k === 'dia' && dia) || (c.k === 'loja' && loja) ? '' : ' op-vazio';
      return '<div class="op-campo"><dt>' + esc(c.t) + '</dt><dd class="' + vazio.trim() + '">' + esc(v) + '</dd></div>';
    }).join('') + '</dl>';
  }

  function chegada(ctx) {
    return '<section class="op-painel" aria-labelledby="opTChegada">' +
      '<h2 id="opTChegada">Chegada do dia ' + selo + '</h2>' +
      '<p class="op-aviso">Aqui vai aparecer, por loja e turno, quando cada motoboy chegou. Os campos abaixo ainda não estão ligados a nenhuma fonte, por isso ficam em branco.</p>' +
      campos([
        { k: 'dia', t: 'Dia' }, { k: 'loja', t: 'Loja' },
        { t: 'Turno', v: NAO_LIGADO }, { t: 'Motoboy', v: NAO_LIGADO },
        { t: 'Início previsto', v: NAO_LIGADO }, { t: 'Chegada registrada', v: NAO_LIGADO },
        { t: 'Primeira atividade', v: NAO_LIGADO }, { t: 'Fonte', v: NAO_LIGADO },
        { t: 'Última leitura', v: NAO_LIGADO }, { t: 'Situação de conferência', v: A_CONFERIR }
      ], ctx) +
      '<ul class="op-regras">' +
      '<li>A primeira entrega <strong>não comprova</strong> a hora em que o motoboy chegou.</li>' +
      '<li>Não haver leitura <strong>não significa</strong> falta nem atraso.</li>' +
      '</ul></section>';
  }

  function escala(ctx) {
    return '<section class="op-painel" aria-labelledby="opTEscala">' +
      '<h2 id="opTEscala">Escala do Delivery ' + selo + '</h2>' +
      '<p class="op-aviso">Aqui vai aparecer a escala prevista de cada loja. Nesta fase é só consulta: não há como criar nem alterar escala por esta tela.</p>' +
      campos([
        { k: 'dia', t: 'Dia' }, { k: 'loja', t: 'Loja' },
        { t: 'Turno', v: NAO_LIGADO }, { t: 'Motoboy', v: NAO_LIGADO },
        { t: 'Início', v: NAO_LIGADO }, { t: 'Fim', v: NAO_LIGADO },
        { t: 'Vira a madrugada', v: NAO_LIGADO }, { t: 'Situação da alteração', v: NAO_LIGADO }
      ], ctx) +
      '<p class="op-nota">Previsto para as próximas etapas: consultar a escala e acompanhar as alterações feitas, com a possibilidade de desfazer. Nada disso está disponível ainda.</p>' +
      '</section>';
  }

  function conferencia() {
    const atuais = [
      ['placar', 'Placar', 'Pedidos, vendas e cancelamentos do dia por loja.'],
      ['tempo', 'Tempo de entrega', 'Tempos do pedido até a entrega e entregas depois do prometido.'],
      ['cancel', 'Cancelamentos', 'Motivos dos cancelamentos do dia.'],
      ['quali', 'Avaliações do dia', 'Notas e avaliações ruins do dia.']
    ];
    const futuros = [['Mapa', 'Visão das entregas no mapa.'], ['Passagem de turno', 'Registro da passagem entre turnos.'], ['Sacola', 'Conferência das sacolas.']];
    return '<section class="op-painel" aria-labelledby="opTConf">' +
      '<h2 id="opTConf">Conferência do Delivery ' + selo + '</h2>' +
      '<p class="op-aviso">Roteiro para conferir o dia. Os blocos abaixo já existem nas abas desta página; os demais ainda estão sendo preparados.</p>' +
      '<h3>Já disponíveis</h3><ul class="op-lista">' +
      atuais.map((a) => '<li><a href="#' + a[0] + '">' + esc(a[1]) + '</a> <span>' + esc(a[2]) + '</span></li>').join('') +
      '</ul><h3>Em construção</h3><ul class="op-lista">' +
      futuros.map((f) => '<li><strong>' + esc(f[0]) + '</strong> ' + selo + ' <span>' + esc(f[1]) + '</span></li>').join('') +
      '</ul></section>';
  }

  function render(aba, ctx) {
    if (aba === 'chegada') return chegada(ctx || {});
    if (aba === 'escala') return escala(ctx || {});
    if (aba === 'conferencia') return conferencia(ctx || {});
    return '';
  }

  function banner() {
    return '<strong>Em construção:</strong> Chegada, Escala e Conferência do Delivery estão sendo incorporadas a esta área. ' +
      'As abas novas mostram o que vai aparecer; os campos ainda sem fonte ficam em branco. ' +
      '<a href="#chegada">Ver Chegada do dia</a>';
  }

  return { ABAS_ANTIGAS, ABAS_NOVAS, abaDoHash, ehNova, diaBR, render, banner, esc };
});
