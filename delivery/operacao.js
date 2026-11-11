// Delivery do dia: abas "Chegada do dia", "Escala do Delivery" e "Conferência do Delivery" (EM CONSTRUÇÃO).
// Só apresentação (HTML a partir de dados já lidos por operacao-dados.js): não consulta nem grava nada. Todo campo ainda
// sem fonte aparece como "Ainda não ligado" ou "A conferir"; não há linhas, números ou totais de exemplo.
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

  const NOME_LOJA = { 'AGUA VERDE': 'Água Verde', 'AHU': 'Ahú', 'SÃO BRAZ': 'São Braz', 'SAO BRAZ': 'São Braz', 'BOQUEIRAO': 'Boqueirão' };
  const nomeLoja = (u) => NOME_LOJA[u] || u || '—';
  const FONTE_NOME = { foody: 'Foody', trackeat: 'TrackEat' };
  const ESTADO_FONTE = { ok: 'lida', parcial: 'leitura incompleta', falha: 'não foi possível ler agora', naoliberada: 'leitura ainda não liberada' };
  const MSG_SEM_ATIVIDADE = 'Não há atividade recebida para esse dia; isso não comprova falta.';
  const MSG_ESCALA_NAO_LIBERADA = 'A leitura da escala ainda não foi liberada';
  const MSG_SEM_ESCALA = 'Sem linhas de escala para este dia e esta loja; isso não conclui falta.';
  const JANELA = { mesmo_dia: 'Termina no mesmo dia', vira_dia: 'Termina no dia seguinte', indeterminada: 'Horário a conferir' };

  function diaMais1(dia) {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(dia || ''));
    if (!m) return null;
    return new Date(Date.UTC(+m[1], +m[2] - 1, +m[3] + 1)).toISOString().slice(0, 10);
  }

  // Instante (ISO com fuso) -> hora de São Paulo. Só a hora se for o dia escolhido; outro dia mostra a data;
  // o dia seguinte é dito por extenso (um evento de madrugada pertence ao dia seguinte, não ao dia escolhido).
  function fmtSP(iso, dia) {
    const ms = Date.parse(iso);
    if (!isFinite(ms)) return null;
    const p = {};
    new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
      .formatToParts(new Date(ms)).forEach((x) => { p[x.type] = x.value; });
    const d = p.year + '-' + p.month + '-' + p.day, hm = p.hour + ':' + p.minute;
    if (d === dia) return hm;
    const dm = p.day + '/' + p.month + ' ' + hm;
    return d === diaMais1(dia) ? dm + ' (dia seguinte)' : dm;
  }

  const botaoTentar = '<p><button type="button" class="op-btn" data-acao="tentar">Tentar de novo</button></p>';
  const seloParcial = ' <span class="op-selo op-parcial">Parcial</span>';
  const hm5 = (h) => (typeof h === 'string' && h.length >= 5 ? h.slice(0, 5) : null);

  function tabelaHtml(cab, linhas) {
    return '<div class="op-tabela"><table class="dl-tab"><thead><tr>' + cab.map((c) => '<th>' + esc(c) + '</th>').join('') +
      '</tr></thead><tbody>' + linhas.map((l) => '<tr>' + l.map((v) => '<td>' + esc(v == null ? '—' : v) + '</td>').join('') + '</tr>').join('') +
      '</tbody></table></div>';
  }

  function blocoChegada(ctx) {
    const d = ctx.dados;
    if (!d) return '';
    const dia = ctx.dia;
    const cab = '<h3>Atividade registrada nas entregas</h3>';
    if (d.fase === 'carregando') return cab + '<p class="op-aviso">Carregando…</p>';
    if (d.fase !== 'pronto' || !d.resultado) return cab + '<p class="op-aviso">' + esc(d.mensagem || 'Não foi possível mostrar esta leitura agora.') + '</p>';
    const r = d.resultado;
    const fontes = r.fontes || {};
    const ultima = {};
    (r.linhas || []).forEach((l) => { if (l.ultimaLeitura && (!ultima[l.fonte] || l.ultimaLeitura > ultima[l.fonte])) ultima[l.fonte] = l.ultimaLeitura; });
    const itens = Object.keys(FONTE_NOME).map((f) => {
      const est = fontes[f] ? fontes[f].estado : 'falha';
      const u = ultima[f] ? fmtSP(ultima[f], dia) : null;
      return '<li><strong>' + FONTE_NOME[f] + ':</strong> ' + esc(ESTADO_FONTE[est] || 'não foi possível ler agora') +
        (u ? ' · última leitura recebida ' + esc(u) : '') + '</li>';
    }).join('');
    let corpo;
    if (r.estado === 'falha') {
      corpo = '<p class="op-aviso">Não foi possível ler a atividade das entregas agora. Isso não significa que não houve atividade.</p>';
    } else if (!(r.linhas || []).length) {
      corpo = '<p class="op-aviso">' + (r.parcial
        ? 'Nenhuma atividade apareceu nas leituras feitas, mas ao menos uma fonte não foi lida por completo; isso não comprova falta.'
        : esc(MSG_SEM_ATIVIDADE)) + '</p>';
    } else {
      corpo = tabelaHtml(['Fonte', 'Loja', 'Turno', 'Motoboy', 'Primeira atividade', 'Última leitura', 'Situação'],
        r.linhas.map((l) => [FONTE_NOME[l.fonte] || l.fonte, nomeLoja(l.unidade), l.turno, l.motoboy,
          fmtSP(l.primeiraAtividade, dia), l.ultimaLeitura ? fmtSP(l.ultimaLeitura, dia) : 'sem hora de leitura', l.situacao]));
    }
    return cab + (r.parcial ? '<p>' + seloParcial + '</p>' : '') + '<ul class="op-fontes">' + itens + '</ul>' + corpo +
      (r.parcial ? botaoTentar : '') +
      '<p class="op-nota">As fontes aparecem separadas e não são somadas. Primeira atividade é o primeiro horário recebido (coleta, saída ou entrega); ' +
      'não é a hora em que o motoboy chegou. A hora da última leitura mostra até quando chegaram dados; esses dados podem ter atraso.</p>';
  }

  function blocoEscala(ctx) {
    const d = ctx.dados;
    const dia = ctx.dia;
    if (d.fase === 'carregando') return '<p class="op-aviso">Carregando…</p>';
    if (d.fase !== 'pronto' || !d.resultado) return '<p class="op-aviso">' + esc(d.mensagem || 'Não foi possível mostrar esta leitura agora.') + '</p>';
    const r = d.resultado;
    if (r.estado === 'naoliberada') return '<p class="op-aviso">' + esc(r.mensagem || MSG_ESCALA_NAO_LIBERADA) + '. Isso não quer dizer que ninguém está escalado.</p>';
    if (r.estado === 'falha') return '<p class="op-aviso">Não foi possível ler a escala agora. Isso não quer dizer que ninguém está escalado.</p>' + botaoTentar;
    const parcial = r.parcial ? '<p>' + seloParcial + ' <span class="op-nota">Parte da escala pode não estar na lista.</span></p>' : '';
    const botao = r.parcial ? botaoTentar : '';
    if (!(r.linhas || []).length) return parcial + '<p class="op-aviso">' + esc(MSG_SEM_ESCALA) + '</p>' + botao;
    return parcial + tabelaHtml(['Loja', 'Turno', 'Motoboy', 'Início', 'Fim', 'Janela', 'Situação da alteração', 'Gravada em'],
      r.linhas.map((l) => [nomeLoja(l.unidade), l.turno, l.nome, hm5(l.inicio) || A_CONFERIR, hm5(l.fim) || A_CONFERIR,
        JANELA[l.janela] || JANELA.indeterminada, NAO_LIGADO, l.gravadoEm ? fmtSP(l.gravadoEm, dia) : 'sem hora de gravação'])) + botao;
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
      '</ul>' + blocoChegada(ctx) + '</section>';
  }

  function escala(ctx) {
    if (ctx.dados) {
      return '<section class="op-painel" aria-labelledby="opTEscala">' +
        '<h2 id="opTEscala">Escala do Delivery ' + selo + '</h2>' +
        '<p class="op-aviso">Escala prevista de cada loja. Nesta fase é só consulta: não há como criar nem alterar escala por esta tela.</p>' +
        campos([{ k: 'dia', t: 'Dia' }, { k: 'loja', t: 'Loja' }, { t: 'Situação da alteração', v: NAO_LIGADO }], ctx) +
        blocoEscala(ctx) +
        '<p class="op-nota">Previsto para as próximas etapas: acompanhar as alterações feitas, com a possibilidade de desfazer. Nada disso está disponível ainda.</p>' +
        '</section>';
    }
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
      '<h3>Confira com a loja</h3><ul class="op-regras">' +
      '<li>Na Chegada do dia, veja se as duas fontes de entregas (Foody e TrackEat) foram lidas e a hora da última leitura de cada uma.</li>' +
      '<li>Na Escala do Delivery, veja se a escala da loja e do dia foi lida e se o fim de algum turno cai no dia seguinte.</li>' +
      '<li>Motoboy escalado sem atividade registrada: pergunte à loja. Não haver atividade não comprova falta nem atraso.</li>' +
      '<li>Atividade de madrugada pertence ao dia seguinte e não indica a hora de chegada.</li>' +
      '</ul>' +
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

  return { ABAS_ANTIGAS, ABAS_NOVAS, abaDoHash, ehNova, diaBR, fmtSP, render, banner, esc };
});
