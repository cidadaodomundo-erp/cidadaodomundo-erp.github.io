/* Modelo puro de Manutenção e Quem conserta (diretório geral de prestadores que já existe no ERP).
 * CommonJS + browser UMD. Sem rede, sem DOM, sem storage, sem relógio, sem timers.
 * Só normaliza e filtra linhas já recebidas. Não ranqueia, não infere histórico, não calcula nada.
 * O cadastro NÃO tem loja: é um diretório geral da empresa. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.ModeloManutencao = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var LIMITE_PAGINA = 200;
  var MAX_PAGINAS = 10;                       // teto seguro: 2.000 linhas por consulta
  var SELECT_PRESTADOR = 'id,setor,nome,telefone,ativo';
  var CAMPOS_PRESTADOR = SELECT_PRESTADOR.split(',');
  var MAX_TEXTO = 200;
  var SEM_SETOR = '__sem_setor__';

  function semAcento(s) {
    var t = String(s);
    return typeof t.normalize === 'function' ? t.normalize('NFD').replace(/[̀-ͯ]/g, '') : t;
  }
  function chaveTexto(s) {
    if (s == null) return '';
    return semAcento(String(s)).replace(/\s+/g, ' ').trim().toLowerCase();
  }
  function ehObjeto(x) { return x !== null && typeof x === 'object' && !Array.isArray(x); }
  function textoCurto(v) {
    if (typeof v === 'number' && isFinite(v)) v = String(v);
    if (typeof v !== 'string') return null;
    var t = v.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim();
    return t ? t.slice(0, MAX_TEXTO) : null;
  }

  var _col = null;
  function colador() {
    if (!_col) {
      try { _col = new Intl.Collator('pt-BR', { sensitivity: 'base', numeric: true }); }
      catch (e) { _col = { compare: function (a, b) { return a < b ? -1 : a > b ? 1 : 0; } }; }
    }
    return _col;
  }
  function cmpId(a, b) {
    var na = Number(a), nb = Number(b);
    if (isFinite(na) && isFinite(nb) && na !== nb) return na < nb ? -1 : 1;
    return colador().compare(String(a), String(b));
  }

  /* Qual aba a página abre. Só '#prestadores' abre o diretório; qualquer outra coisa abre os chamados. */
  function abaDoHash(h) {
    return typeof h === 'string' && h.replace(/^#/, '').toLowerCase() === 'prestadores' ? 'prestadores' : 'chamados';
  }

  /* Prestadores: só id,nome,setor,telefone saem daqui (qualquer outro campo recebido é descartado).
   * Só ativo === true (estrito: "false", 0, null, "t" NÃO contam), id inteiro, nome obrigatório, sem duplicar id.
   * Ordem alfabética por nome; nenhuma pontuação/destaque. */
  function normalizarPrestadores(rows) {
    var r = { linhas: [], inativos: 0, invalidas: 0, duplicadas: 0 };
    if (!Array.isArray(rows)) return null;
    var ids = {};
    rows.forEach(function (x) {
      if (!ehObjeto(x)) { r.invalidas++; return; }
      if (x.ativo !== true) { r.inativos++; return; }
      var idOk = (typeof x.id === 'number' && isFinite(x.id) && Math.floor(x.id) === x.id && x.id >= 0) || (typeof x.id === 'string' && /^\d{1,18}$/.test(x.id));
      var nome = textoCurto(x.nome);
      if (!idOk || !nome) { r.invalidas++; return; }
      var id = String(x.id);
      if (ids[id]) { r.duplicadas++; return; }
      ids[id] = true;
      r.linhas.push({ id: id, nome: nome, setor: textoCurto(x.setor), telefone: textoCurto(x.telefone) });
    });
    r.linhas.sort(function (a, b) { return colador().compare(a.nome, b.nome) || cmpId(a.id, b.id); });
    return r;
  }

  function listarSetores(linhas) {
    var por = {}, temSem = false;
    (linhas || []).forEach(function (l) {
      if (!l.setor) { temSem = true; return; }
      var k = chaveTexto(l.setor);
      if (!por[k]) por[k] = l.setor;
    });
    var out = Object.keys(por).map(function (k) { return { valor: k, rotulo: por[k] }; });
    out.sort(function (a, b) { return colador().compare(a.rotulo, b.rotulo); });
    if (temSem) out.push({ valor: SEM_SETOR, rotulo: 'Sem setor informado' });
    return out;
  }

  /* Busca por nome/setor (sem acento, sem caixa) e filtro de setor. Mantém a ordem recebida (já alfabética). */
  function filtrarPrestadores(linhas, f) {
    f = f || {};
    var termos = chaveTexto(f.texto).split(' ').filter(Boolean);
    var setor = f.setor || '';
    return (linhas || []).filter(function (l) {
      if (setor) {
        if (setor === SEM_SETOR) { if (l.setor) return false; }
        else if (chaveTexto(l.setor) !== setor) return false;
      }
      if (!termos.length) return true;
      var alvo = chaveTexto(l.nome + ' ' + (l.setor || ''));
      return termos.every(function (t) { return alvo.indexOf(t) >= 0; });
    });
  }

  function dois(n) { return (n < 10 ? '0' : '') + n; }
  /* dd/mm/aaaa hh:mm no horário de Curitiba/São Paulo. */
  function formatarDataHora(ms) {
    if (typeof ms !== 'number' || !isFinite(ms)) return '—';
    try {
      var partes = new Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(new Date(ms));
      var p = {}; partes.forEach(function (x) { p[x.type] = x.value; });
      return p.day + '/' + p.month + '/' + p.year + ' ' + p.hour + ':' + p.minute;
    } catch (e) { return '—'; }
  }

  return {
    LIMITE_PAGINA: LIMITE_PAGINA, MAX_PAGINAS: MAX_PAGINAS, SELECT_PRESTADOR: SELECT_PRESTADOR, CAMPOS_PRESTADOR: CAMPOS_PRESTADOR,
    SEM_SETOR: SEM_SETOR, abaDoHash: abaDoHash, chaveTexto: chaveTexto, normalizarPrestadores: normalizarPrestadores,
    listarSetores: listarSetores, filtrarPrestadores: filtrarPrestadores, formatarDataHora: formatarDataHora
  };
});
