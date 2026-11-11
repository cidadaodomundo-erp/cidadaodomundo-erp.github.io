/* Modelo puro de Chegada e Escala do Delivery.
 * CommonJS + browser UMD. Sem rede, sem DB, sem DOM, sem HTML, sem relogio do PC.
 * Nao calcula pagamento, atraso, falta, garantido ou refeicao. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.ModeloDelivery = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var REDE = 'REDE';
  var CAMPOS_ESCALA = ['dia', 'unidade', 'turno', 'nome_na_escala', 'inicio', 'fim', 'gravado_em'];
  var SITUACAO = 'Chegada a conferir';
  var CAMPOS_HORA = { foody: ['coleta', 'despacho', 'entrega'], trackeat: ['coleta', 'saida', 'entrega'] };
  var FONTES = ['foody', 'trackeat'];

  function ehTexto(v) { return typeof v === 'string' && v.length > 0; }
  function ehObjeto(v) { return v !== null && typeof v === 'object' && !Array.isArray(v); }

  /* Data de calendario valida YYYY-MM-DD. */
  function validarDia(s) {
    if (typeof s !== 'string') return false;
    var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
    if (!m) return false;
    var y = +m[1], mo = +m[2], d = +m[3];
    if (mo < 1 || mo > 12 || d < 1) return false;
    var dt = new Date(Date.UTC(y, mo - 1, d));
    return dt.getUTCFullYear() === y && dt.getUTCMonth() === mo - 1 && dt.getUTCDate() === d;
  }

  /* HH:MM[:SS] -> segundos do dia, ou null. */
  function parseHora(s) {
    if (typeof s !== 'string') return null;
    var m = /^(\d{2}):(\d{2})(?::(\d{2}))?$/.exec(s);
    if (!m) return null;
    var h = +m[1], mi = +m[2], se = m[3] === undefined ? 0 : +m[3];
    if (h > 23 || mi > 59 || se > 59) return null;
    return h * 3600 + mi * 60 + se;
  }

  function fmtHora(seg) {
    function p(n) { return (n < 10 ? '0' : '') + n; }
    return p(Math.floor(seg / 3600)) + ':' + p(Math.floor((seg % 3600) / 60)) + ':' + p(seg % 60);
  }

  /* Instante com timezone EXPLICITO (Z ou +-HH:MM) -> epoch ms, ou null.
   * Sem timezone = invalido (nunca assume fuso do PC). */
  function parseInstante(s) {
    if (typeof s !== 'string') return null;
    var m = /^(\d{4}-\d{2}-\d{2})[T ](\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,6}))?)?(Z|[+-]\d{2}:\d{2})$/.exec(s);
    if (!m || !validarDia(m[1])) return null;
    var h = +m[2], mi = +m[3], se = m[4] === undefined ? 0 : +m[4];
    if (h > 23 || mi > 59 || se > 59) return null;
    var ms = m[5] === undefined ? 0 : +(m[5] + '00').slice(0, 3);
    var off = 0;
    if (m[6] !== 'Z') {
      var oh = +m[6].slice(1, 3), om = +m[6].slice(4, 6);
      if (oh > 23 || om > 59) return null;
      off = (m[6][0] === '-' ? -1 : 1) * (oh * 60 + om);
    }
    var p = m[1].split('-');
    return Date.UTC(+p[0], +p[1] - 1, +p[2], h, mi, se, ms) - off * 60000;
  }

  function iso(ms) { return new Date(ms).toISOString(); }

  /* Normaliza linhas da escala: so os 7 campos permitidos, nada de payload bruto. */
  function normalizarEscala(rows) {
    var linhas = [], avisos = [], rejeitadas = 0;
    if (!Array.isArray(rows)) return { linhas: linhas, rejeitadas: 0, avisos: ['Escala: resposta invalida'], parcial: true };
    rows.forEach(function (r) {
      if (!ehObjeto(r) || !validarDia(r.dia) || !ehTexto(r.unidade) || !ehTexto(r.nome_na_escala)) { rejeitadas++; return; }
      var ini = null, fim = null;
      if (r.inicio !== null && r.inicio !== undefined) { ini = parseHora(r.inicio); if (ini === null) { rejeitadas++; return; } }
      if (r.fim !== null && r.fim !== undefined) { fim = parseHora(r.fim); if (fim === null) { rejeitadas++; return; } }
      var janela = 'indeterminada', fimDiaSeguinte = false;
      if (ini !== null && fim !== null) {
        if (fim > ini) janela = 'mesmo_dia';
        else if (fim < ini) { janela = 'vira_dia'; fimDiaSeguinte = true; }
      }
      var gravMs = parseInstante(r.gravado_em);
      var turno = (r.turno === null || r.turno === undefined) ? null : (typeof r.turno === 'string' ? r.turno : String(r.turno));
      linhas.push({
        fonte: 'escala',
        dia: r.dia,
        unidade: r.unidade,
        turno: turno,
        nome: r.nome_na_escala,
        inicio: ini === null ? null : fmtHora(ini),
        fim: fim === null ? null : fmtHora(fim),
        janela: janela,
        fimDiaSeguinte: fimDiaSeguinte,
        gravadoEm: gravMs === null ? null : iso(gravMs),
        frescor: gravMs === null ? 'desconhecido' : 'gravado_em'
      });
    });
    if (rejeitadas) avisos.push('Escala: ' + rejeitadas + ' linha(s) invalida(s) descartada(s)');
    return { linhas: linhas, rejeitadas: rejeitadas, avisos: avisos, parcial: rejeitadas > 0 };
  }

  /* Lojas concretas que a selecao permite. Allowlist obrigatoria.
   * REDE so amplia as lojas concretas da propria lista; nunca e curinga. */
  function lojasPermitidas(allowlist, lojaEscolhida) {
    if (!Array.isArray(allowlist)) return [];
    var concretas = allowlist.filter(function (l) { return ehTexto(l) && l !== REDE; });
    if (lojaEscolhida === REDE) return allowlist.indexOf(REDE) >= 0 ? concretas : [];
    return ehTexto(lojaEscolhida) && concretas.indexOf(lojaEscolhida) >= 0 ? [lojaEscolhida] : [];
  }

  function filtrarEscala(linhas, opc) {
    opc = opc || {};
    var lojas = lojasPermitidas(opc.allowlist, opc.lojaEscolhida);
    if (!validarDia(opc.dia) || !lojas.length || !Array.isArray(linhas)) return [];
    return linhas.filter(function (l) { return l && l.dia === opc.dia && lojas.indexOf(l.unidade) >= 0; });
  }

  /* Atividade: agrupa por fonte+unidade+turno+nome EXATO. Fontes nunca se fundem. */
  function agruparAtividade(fontes, opc) {
    opc = opc || {};
    fontes = fontes || {};
    var estados = opc.estados || {};
    var lojas = lojasPermitidas(opc.allowlist, opc.lojaEscolhida);
    var diaOk = validarDia(opc.dia);
    var avisos = [], grupos = {}, ordem = [], porFonte = {};
    var parcial = false;

    FONTES.forEach(function (f) {
      var estado = typeof estados[f] === 'string' ? estados[f] : 'desconhecido';
      var rows = fontes[f];
      var info = { estado: estado, recebidas: 0, rejeitadas: 0 };
      porFonte[f] = info;
      if (estado !== 'ok') { parcial = true; avisos.push('Atividade ' + f + ': leitura ' + estado); }
      if (!Array.isArray(rows)) { if (estado === 'ok') { info.estado = 'falha'; parcial = true; avisos.push('Atividade ' + f + ': resposta invalida'); } return; }
      if (!diaOk || !lojas.length) return;
      rows.forEach(function (r) {
        info.recebidas++;
        if (!ehObjeto(r) || !validarDia(r.data_local) || !ehTexto(r.unidade) || !ehTexto(r.entregador)) { info.rejeitadas++; return; }
        if (r.data_local !== opc.dia || lojas.indexOf(r.unidade) < 0) { info.recebidas--; return; }
        var min = null, ruim = false;
        CAMPOS_HORA[f].forEach(function (c) {
          var v = r[c];
          if (v === null || v === undefined || v === '') return;
          var ms = parseInstante(v);
          if (ms === null) { ruim = true; return; }
          if (min === null || ms < min) min = ms;
        });
        if (ruim || min === null) { info.rejeitadas++; return; }
        var imp = parseInstante(r.importado_em);
        var turno = (r.turno === null || r.turno === undefined) ? null : String(r.turno);
        var k = JSON.stringify([f, r.unidade, turno, r.entregador]);
        var g = grupos[k];
        if (!g) {
          g = grupos[k] = { fonte: f, unidade: r.unidade, turno: turno, motoboy: r.entregador,
            _min: min, _imp: imp, chegadaRegistrada: null, inicioPrevisto: null, situacao: SITUACAO };
          ordem.push(k);
        } else {
          if (min < g._min) g._min = min;
          if (imp !== null && (g._imp === null || imp > g._imp)) g._imp = imp;
        }
      });
      if (info.rejeitadas) { parcial = true; avisos.push('Atividade ' + f + ': ' + info.rejeitadas + ' linha(s) invalida(s) descartada(s)'); }
    });

    var linhas = ordem.map(function (k) {
      var g = grupos[k];
      return { fonte: g.fonte, unidade: g.unidade, turno: g.turno, motoboy: g.motoboy,
        primeiraAtividade: iso(g._min), ultimaLeitura: g._imp === null ? null : iso(g._imp),
        chegadaRegistrada: null, inicioPrevisto: null, situacao: SITUACAO };
    });
    function cmpStr(x, y) { return x < y ? -1 : x > y ? 1 : 0; }
    /* Comparador total: primeira atividade, depois turno, fonte, unidade, motoboy. Igualdade = 0. */
    linhas.sort(function (a, b) {
      return cmpStr(a.primeiraAtividade, b.primeiraAtividade) ||
        cmpStr(a.turno || '', b.turno || '') ||
        cmpStr(a.fonte, b.fonte) ||
        cmpStr(a.unidade, b.unidade) ||
        cmpStr(a.motoboy, b.motoboy);
    });
    return { linhas: linhas, fontes: porFonte, parcial: parcial, avisos: avisos,
      /* Ausencia de linha NUNCA prova falta: so "a conferir". */
      ausenciaProvaFalta: false };
  }

  return {
    REDE: REDE, CAMPOS_ESCALA: CAMPOS_ESCALA, SITUACAO: SITUACAO,
    validarDia: validarDia, parseHora: parseHora, parseInstante: parseInstante,
    normalizarEscala: normalizarEscala, lojasPermitidas: lojasPermitidas,
    filtrarEscala: filtrarEscala, agruparAtividade: agruparAtividade
  };
});
