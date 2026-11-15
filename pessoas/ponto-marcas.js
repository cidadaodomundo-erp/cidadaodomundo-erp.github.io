// Marcas do dia na Consulta de ponto: verde quando está tudo certo; vermelho no campo exato que está errado.
// Regra pura (sem rede, sem DOM). Só avalia o dia lido direto no Flash (com todas as batidas e as refeições).
// Regras: tolerância de 10 min. Saiu antes do horário cadastrado = "saiu mais cedo". Passou do horário (antes da
// entrada ou depois da saída) = "hora extra, conferir autorização" (ainda não existe registro de autorização).
// Turno de mais de 6 h precisa de intervalo de pelo menos 1 h. Sem refeição lançada = vermelho.
(function (root, factory) {
  'use strict';
  const mod = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = mod;
  if (root) root.PontoMarcas = mod;
})(typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : null), function () {
  'use strict';
  const TOL = 10, INTERVALO_MIN = 60, TURNO_LONGO = 360;
  const TS = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})/;
  const HM = /^([01]\d|2[0-3]):([0-5]\d)/;
  const DIA = /^(\d{4})-(\d{2})-(\d{2})$/;

  function minutosTs(s) {
    const m = typeof s === 'string' ? TS.exec(s) : null;
    if (!m) return null;
    return Date.UTC(+m[1], +m[2] - 1, +m[3]) / 60000 + (+m[4]) * 60 + (+m[5]);
  }
  function minutosDia(dia) { const m = typeof dia === 'string' ? DIA.exec(dia) : null; return m ? Date.UTC(+m[1], +m[2] - 1, +m[3]) / 60000 : null; }
  function hm(s) { const m = typeof s === 'string' ? HM.exec(s) : null; return m ? (+m[1]) * 60 + (+m[2]) : null; }
  function dur(min) { const h = Math.floor(min / 60), m = min % 60; return h ? h + 'h' + (m ? String(m).padStart(2, '0') : '') : m + ' min'; }
  function hora(s) { const m = typeof s === 'string' ? TS.exec(s) : null; return m ? m[4] + ':' + m[5] : '—'; }

  // jornada cadastrada {entrada:'HH:MM', saida:'HH:MM'} no dia operacional; saída antes da entrada = vira a noite
  function jornadaNoDia(j, dia) {
    const base = minutosDia(dia), e = j ? hm(j.entrada) : null, s = j ? hm(j.saida) : null;
    if (base == null || e == null || s == null) return null;
    return { ini: base + e, fim: base + s + (s <= e ? 1440 : 0), texto: j.entrada.slice(0, 5) + ' às ' + j.saida.slice(0, 5) };
  }

  // o: { dia, horarios:[ts...], jornada:{entrada,saida}|null, refeicao:{disponivel, identificado, itens:[{tipo,produto,hora}]} }
  function avaliar(o) {
    const hs = (Array.isArray(o.horarios) ? o.horarios : []).map((t) => ({ t, m: minutosTs(t) })).filter((x) => x.m != null).sort((a, b) => a.m - b.m);
    const r = { andamento: false, entrada: null, saida: null, intervalo: null, refeicao: null, problemas: [], geral: 'neutro' };
    const marca = (campo, estado, texto) => { r[campo] = { estado, texto }; if (estado === 'ruim') r.problemas.push(texto); };
    const n = hs.length;
    // refeição (independe do fim do turno para mostrar o que foi pego)
    const ref = o.refeicao || {};
    const itens = Array.isArray(ref.itens) ? ref.itens : [];
    const txtRef = itens.map((i) => (i.produto || i.tipo || 'refeição') + (i.hora ? ' (' + String(i.hora).slice(0, 5) + ')' : '')).join('; ');
    if (n === 0) { r.geral = 'neutro'; return r; }
    if (n % 2 === 1) {   // ainda trabalhando (ou faltou bater): não julga
      r.andamento = true;
      if (itens.length) marca('refeicao', 'ok', txtRef);
      return r;
    }
    const ini = hs[0].m, fim = hs[n - 1].m;
    // intervalo: maior pausa entre pares (saída e volta)
    let pausa = 0;
    for (let i = 1; i + 1 < n; i += 2) pausa = Math.max(pausa, hs[i + 1].m - hs[i].m);
    const trabalhado = fim - ini - pausa;
    if (n >= 4) marca('intervalo', pausa >= INTERVALO_MIN ? 'ok' : 'ruim', pausa >= INTERVALO_MIN ? dur(pausa) : 'intervalo de ' + dur(pausa) + ' (mínimo 1h)');
    else marca('intervalo', trabalhado > TURNO_LONGO ? 'ruim' : 'ok', trabalhado > TURNO_LONGO ? 'sem intervalo em ' + dur(trabalhado) + ' de turno' : 'turno curto, sem intervalo');
    // horário cadastrado
    const j = jornadaNoDia(o.jornada, o.dia);
    if (!j) { marca('entrada', 'sem', 'sem horário cadastrado'); marca('saida', 'sem', 'sem horário cadastrado'); }
    else {
      const antes = j.ini - ini;
      marca('entrada', antes > TOL ? 'ruim' : 'ok', antes > TOL ? 'hora extra: entrou ' + dur(antes) + ' antes (' + j.texto + '); conferir autorização' : 'no horário');
      const depois = fim - j.fim;
      if (depois > TOL) marca('saida', 'ruim', 'hora extra: saiu ' + dur(depois) + ' depois (' + j.texto + '); conferir autorização');
      else if (-depois > TOL) marca('saida', 'ruim', 'saiu ' + dur(-depois) + ' mais cedo (' + j.texto + ')');
      else marca('saida', 'ok', 'no horário');
    }
    // refeição
    if (!ref.disponivel) marca('refeicao', 'sem', 'não deu para ler as refeições');
    else if (itens.length) marca('refeicao', 'ok', txtRef);
    else if (!ref.identificado) marca('refeicao', 'sem', 'sem cartão de refeição cadastrado');
    else marca('refeicao', 'ruim', 'não pegou refeição');
    const est = ['entrada', 'saida', 'intervalo', 'refeicao'].map((k) => r[k] && r[k].estado);
    r.geral = est.includes('ruim') ? 'ruim' : (est.every((e) => e === 'ok') ? 'ok' : 'neutro');
    return r;
  }
  // correções do RH (respostas no grupo do WhatsApp): hora extra autorizada, refeição corrigida ou justificado
  function corrigir(r, cs) {
    if (!r || !Array.isArray(cs) || !cs.length) return r;
    const quem = (c) => 'corrigido pelo RH' + (c.autor_nome ? ': ' + c.autor_nome : '') + (typeof c.em === 'string' && c.em.length >= 16 ? ', ' + c.em.slice(11, 16) : '');
    const ok = (k, c) => { if (r[k] && r[k].estado === 'ruim') r[k] = { estado: 'ok', texto: quem(c), corrigido: true }; };
    for (const c of cs) {
      if (c.tipo === 'hora_extra_autorizada') { if (r.entrada && /hora extra/.test(r.entrada.texto)) ok('entrada', c); if (r.saida && /hora extra/.test(r.saida.texto)) ok('saida', c); }
      else if (c.tipo === 'refeicao') ok('refeicao', c);
      else if (c.tipo === 'justificado') ['entrada', 'saida', 'intervalo', 'refeicao'].forEach((k) => ok(k, c));
    }
    r.problemas = ['entrada', 'saida', 'intervalo', 'refeicao'].filter((k) => r[k] && r[k].estado === 'ruim').map((k) => r[k].texto);
    const est = ['entrada', 'saida', 'intervalo', 'refeicao'].map((k) => r[k] && r[k].estado);
    r.geral = est.includes('ruim') ? 'ruim' : (est.every((e) => e === 'ok') ? 'ok' : 'neutro');
    return r;
  }
  return { avaliar, corrigir, hora, TOL };
});
