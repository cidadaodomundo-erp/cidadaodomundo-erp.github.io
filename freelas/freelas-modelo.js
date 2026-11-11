/* Modelo puro de Taxas e Freelas (consulta dos cadastros que já existem no ERP).
 * CommonJS + browser UMD. Sem rede, sem DOM, sem storage, sem relógio, sem timers.
 * Só normaliza e filtra linhas já recebidas. Não calcula pagamento, não infere vigência, não ranqueia candidatos. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.ModeloFreelas = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var LIMITE_PAGINA = 200;
  var MAX_PAGINAS = 10;                       // teto seguro: 2.000 linhas por consulta
  var SELECT_CONTATO = 'id,nome,setor,telefone,tipo,ativo,loja';
  var SELECT_VALOR = 'loja,valor_hora,atualizado_em';
  var CAMPOS_CONTATO = SELECT_CONTATO.split(',');
  var CAMPOS_VALOR = SELECT_VALOR.split(',');
  var MAX_TEXTO = 200;
  var TETO_VALOR = 1e12;                      // acima disso o número é lixo de cadastro (e quebraria a formatação)
  var SEM_SETOR = '__sem_setor__';
  var REDE = 'REDE';

  // Aliases CONHECIDOS (só variações de acento/caixa das lojas que o portal já usa). Chave = forma sem acento, maiúscula.
  var ALIASES = {
    'AGUA VERDE': ['AGUA VERDE', 'ÁGUA VERDE', 'Agua Verde', 'Água Verde'],
    'AHU': ['AHU', 'AHÚ', 'Ahu', 'Ahú'],
    'SAO BRAZ': ['SÃO BRAZ', 'SAO BRAZ', 'São Braz', 'Sao Braz'],
    'BOQUEIRAO': ['BOQUEIRAO', 'BOQUEIRÃO', 'Boqueirao', 'Boqueirão']
  };

  function semAcento(s) {
    var t = String(s);
    return typeof t.normalize === 'function' ? t.normalize('NFD').replace(/[\u0300-\u036f]/g, '') : t;
  }
  /* Chave de comparação de loja: sem acento, maiúscula, espaços colapsados. Não-texto ou vazio = null. */
  function chaveLoja(s) {
    if (typeof s !== 'string') return null;
    var t = semAcento(s).replace(/\s+/g, ' ').trim().toUpperCase();
    return t || null;
  }
  /* Chave de busca de texto livre: sem acento, minúscula. */
  function chaveTexto(s) {
    if (s == null) return '';
    return semAcento(String(s)).replace(/\s+/g, ' ').trim().toLowerCase();
  }

  /* Recorte de lojas permitido: a allowlist REAL (resposta de lojaCarregar) + a loja escolhida.
   * REDE não é curinga: vira as lojas concretas da allowlist, e só se a própria allowlist a trouxe. */
  function resolverRecorte(allowlist, lojaEscolhida) {
    if (!Array.isArray(allowlist)) return { estado: 'invalida', lojas: [] };
    var concretas = [], vistas = {}, temRede = false;
    allowlist.forEach(function (l) {
      var k = chaveLoja(l);
      if (!k) return;
      if (k === REDE) { temRede = true; return; }
      if (vistas[k]) return;
      vistas[k] = true;
      concretas.push(l.trim());
    });
    if (!concretas.length) return { estado: 'sem_loja', lojas: [] };
    var esc = chaveLoja(lojaEscolhida);
    var lojas = [];
    if (esc === REDE) { if (temRede) lojas = concretas.slice(); }
    else if (esc && vistas[esc]) lojas = concretas.filter(function (l) { return chaveLoja(l) === esc; });
    if (!lojas.length) return { estado: 'sem_escolha', lojas: [] };
    var chaves = {};
    lojas.forEach(function (l) { chaves[chaveLoja(l)] = l; });
    return { estado: 'ok', lojas: lojas, chaves: chaves };
  }

  /* Valores que o filtro do servidor aceita para essas lojas: o nome da allowlist + aliases conhecidos. */
  function variantesServidor(lojas) {
    var out = [], visto = {};
    function add(v) {
      if (typeof v !== 'string' || !v || /["\\]/.test(v) || visto[v]) return;
      visto[v] = true; out.push(v);
    }
    (lojas || []).forEach(function (l) {
      add(l);
      (ALIASES[chaveLoja(l)] || []).forEach(add);
    });
    return out;
  }

  /* Só 'ok' atribui a loja. Nula/vazia/desconhecida = 'sem_loja' (nunca atribui nem expõe).
   * Loja conhecida mas fora do recorte escolhido = 'fora'. */
  function classificarLoja(valor, recorte) {
    var k = chaveLoja(valor);
    if (!k || !recorte || !recorte.chaves) return { tipo: 'sem_loja' };
    if (recorte.chaves[k]) return { tipo: 'ok', loja: recorte.chaves[k] };
    if (ALIASES[k]) return { tipo: 'fora' };
    return { tipo: 'sem_loja' };
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

  /* Contatos: só id,nome,setor,telefone,tipo,loja saem daqui (qualquer outro campo recebido é descartado).
   * Só ativo === true, só loja do recorte, sem duplicar id. Ordem alfabética por nome; nenhuma pontuação/destaque. */
  function normalizarContatos(rows, recorte) {
    var r = { linhas: [], semLoja: 0, fora: 0, inativos: 0, invalidas: 0, duplicadas: 0 };
    if (!Array.isArray(rows)) return null;
    var ids = {};
    rows.forEach(function (x) {
      if (!ehObjeto(x)) { r.invalidas++; return; }
      if (x.ativo !== true) { r.inativos++; return; }
      var c = classificarLoja(x.loja, recorte);
      if (c.tipo === 'sem_loja') { r.semLoja++; return; }
      if (c.tipo === 'fora') { r.fora++; return; }
      var idOk = (typeof x.id === 'number' && isFinite(x.id) && Math.floor(x.id) === x.id) || (typeof x.id === 'string' && /^\d{1,18}$/.test(x.id));
      var nome = textoCurto(x.nome);
      if (!idOk || !nome) { r.invalidas++; return; }
      var id = String(x.id);
      if (ids[id]) { r.duplicadas++; return; }
      ids[id] = true;
      r.linhas.push({ id: id, nome: nome, setor: textoCurto(x.setor), tipo: textoCurto(x.tipo), telefone: textoCurto(x.telefone), loja: c.loja });
    });
    r.linhas.sort(function (a, b) {
      return colador().compare(a.nome, b.nome) || colador().compare(a.loja, b.loja) || cmpId(a.id, b.id);
    });
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
  function filtrarContatos(linhas, f) {
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

  // ---------------------------------------------------------------- valores por hora
  /* Número finito >= 0. Texto numérico simples ("12.5") é aceito; null/vazio NÃO vira 0. */
  function lerValorHora(v) {
    if (v === null || v === undefined) return { status: 'ausente', valor: null };
    if (typeof v === 'number') return isFinite(v) && v >= 0 && v <= TETO_VALOR ? { status: 'ok', valor: v + 0 } : { status: 'invalido', valor: null };
    if (typeof v === 'string') {
      var t = v.trim();
      if (!t) return { status: 'ausente', valor: null };
      if (/^\d+(\.\d+)?$/.test(t)) { var n = Number(t); if (isFinite(n) && n <= TETO_VALOR) return { status: 'ok', valor: n }; }
    }
    return { status: 'invalido', valor: null };
  }

  function diaValido(y, m, d) {
    if (m < 1 || m > 12 || d < 1) return false;
    var dt = new Date(Date.UTC(y, m - 1, d));
    return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
  }
  /* Carimbo da fonte. Devolve { status, ms, soData }. Data inválida nunca vira "hoje" nem 1970. */
  function lerCarimbo(v) {
    if (v === null || v === undefined || v === '') return { status: 'ausente', ms: null, soData: false };
    if (typeof v !== 'string') return { status: 'invalida', ms: null, soData: false };
    var t = v.trim();
    var m = /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2})(?:\.(\d+))?)?(Z|[+-]\d{2}(?::?\d{2})?)?)?$/.exec(t);
    var ruim = { status: 'invalida', ms: null, soData: false };
    if (!m || !diaValido(+m[1], +m[2], +m[3])) return ruim;
    var dia = m[3] + '/' + m[2] + '/' + m[1];
    if (m[4] === undefined) return { status: 'ok', ms: Date.UTC(+m[1], +m[2] - 1, +m[3]), soData: true, dia: dia };
    if (+m[4] > 23 || +m[5] > 59 || (m[6] !== undefined && +m[6] > 59)) return ruim;
    var tz = m[8] || '';
    if (/^[+-]\d{2}$/.test(tz)) tz += ':00';
    else if (/^[+-]\d{4}$/.test(tz)) tz = tz.slice(0, 3) + ':' + tz.slice(3);
    var iso = m[1] + '-' + m[2] + '-' + m[3] + 'T' + m[4] + ':' + m[5] + ':' + (m[6] || '00') + (m[7] ? '.' + (m[7] + '00').slice(0, 3) : '') + tz;
    var ms = Date.parse(iso);
    if (!isFinite(ms)) return ruim;
    return { status: 'ok', ms: ms, soData: false, dia: dia };
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

  /* "R$ 1.234,50". Só número finito >= 0; nunca 0 por falta de dado. Mostra até 4 casas só se existirem. */
  function formatarMoeda(v) {
    if (typeof v !== 'number' || !isFinite(v) || v < 0 || v > TETO_VALOR) return '—';
    var s =v.toFixed(4).replace(/0{1,2}$/, '');
    if (!/\.\d{2}/.test(s)) s = v.toFixed(2);
    var partes = s.split('.');
    var inteiro = partes[0].replace(/\B(?=(\d{3})+(?!\d))/g, '.');
    return 'R$ ' + inteiro + ',' + partes[1];
  }

  /* Valor-hora: só loja,valor_hora,atualizado_em. Mostra TODAS as linhas cadastradas do recorte (o cadastro não diz qual
   * está em vigor, e esta tela não decide isso). Ordem: loja, depois atualização mais recente primeiro. */
  function normalizarValores(rows, recorte) {
    var r = { linhas: [], semLoja: 0, fora: 0, invalidas: 0, duplicadas: 0 };
    if (!Array.isArray(rows)) return null;
    var vistas = {};
    rows.forEach(function (x) {
      if (!ehObjeto(x)) { r.invalidas++; return; }
      var c = classificarLoja(x.loja, recorte);
      if (c.tipo === 'sem_loja') { r.semLoja++; return; }
      if (c.tipo === 'fora') { r.fora++; return; }
      var v = lerValorHora(x.valor_hora), d = lerCarimbo(x.atualizado_em);
      var chave = chaveLoja(c.loja) + '|' + (v.valor === null ? v.status : v.valor) + '|' + (d.ms === null ? d.status : d.ms);
      if (vistas[chave]) { r.duplicadas++; return; }
      vistas[chave] = true;
      r.linhas.push({
        loja: c.loja,
        valor: v.valor, valorStatus: v.status, valorTexto: v.status === 'ok' ? formatarMoeda(v.valor) : null,
        atualizadoMs: d.ms, atualizadoStatus: d.status,
        atualizadoTexto: d.status === 'ok' ? (d.soData ? d.dia : formatarDataHora(d.ms)) : null
      });
    });
    r.linhas.sort(function (a, b) {
      var c = colador().compare(a.loja, b.loja);
      if (c) return c;
      var ma = a.atualizadoMs === null ? -Infinity : a.atualizadoMs, mb = b.atualizadoMs === null ? -Infinity : b.atualizadoMs;
      if (ma !== mb) return ma > mb ? -1 : 1;
      var va = a.valor === null ? -1 : a.valor, vb = b.valor === null ? -1 : b.valor;
      return va === vb ? 0 : va < vb ? -1 : 1;
    });
    return r;
  }

  return {
    LIMITE_PAGINA: LIMITE_PAGINA, MAX_PAGINAS: MAX_PAGINAS, SELECT_CONTATO: SELECT_CONTATO, SELECT_VALOR: SELECT_VALOR,
    CAMPOS_CONTATO: CAMPOS_CONTATO, CAMPOS_VALOR: CAMPOS_VALOR, SEM_SETOR: SEM_SETOR, ALIASES: ALIASES,
    chaveLoja: chaveLoja, chaveTexto: chaveTexto, resolverRecorte: resolverRecorte, variantesServidor: variantesServidor,
    classificarLoja: classificarLoja, normalizarContatos: normalizarContatos, listarSetores: listarSetores,
    filtrarContatos: filtrarContatos, lerValorHora: lerValorHora, lerCarimbo: lerCarimbo, normalizarValores: normalizarValores,
    formatarMoeda: formatarMoeda, formatarDataHora: formatarDataHora
  };
});
