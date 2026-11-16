// HISTÓRICO DE PONTO DE UMA PESSOA (topo da Consulta de ponto, rota pcartao). Escolhe a pessoa e já aparecem todas as
// infrações desde a admissão, sem digitar data. Fonte: rh_ponto_historico (carga do Flash, desde 21/03/2026), pelas funções
// do banco ponto_historico_pessoas / ponto_historico_pessoa (conferem a permissão de RH). Regras: pessoas/ponto-marcas.js.
// Dia antigo é calculado com o horário cadastrado HOJE. Refeição não entra no histórico (só no dia, na consulta abaixo).
(function (root, factory) {
  'use strict';
  const mod = factory(typeof require === 'function' && typeof module !== 'undefined' ? require('./ponto-marcas.js') : (root && root.PontoMarcas));
  if (typeof module !== 'undefined' && module.exports) module.exports = mod;
  if (root && typeof document !== 'undefined') root.PontoHistorico = mod;
})(typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : null), function (marcas) {
  'use strict';
  const TIPOS = Object.freeze({
    cedo: 'Saiu mais cedo', extra: 'Hora extra (conferir autorização)', intervalo: 'Intervalo menor que 1h',
    semintervalo: 'Sem intervalo em turno longo', impar: 'Batida faltando (número ímpar)',
  });
  const fmt = (d) => (typeof d === 'string' && d.length >= 10 ? d.slice(8, 10) + '/' + d.slice(5, 7) + '/' + d.slice(0, 4) : '—');

  // dias: [{dia, empresa, horarios:[ts]}]; devolve {linhas:[{dia, empresa, batidas, tipos:[], textos:[]}], contagem:{tipo:n}, total}
  function resumir(dias, jornada) {
    const contagem = {}; Object.keys(TIPOS).forEach((k) => { contagem[k] = 0; });
    const linhas = [];
    for (const d of Array.isArray(dias) ? dias : []) {
      if (!d || typeof d.dia !== 'string' || !Array.isArray(d.horarios)) continue;
      const hs = d.horarios.filter((h) => typeof h === 'string');
      const l = { dia: d.dia, empresa: d.empresa || '', batidas: hs.map(marcas.hora), tipos: [], textos: [] };
      const add = (k, t) => { l.tipos.push(k); l.textos.push(t); contagem[k]++; };
      if (hs.length % 2 === 1) add('impar', hs.length + ' batida(s): faltou bater entrada ou saída');
      else if (hs.length) {
        const r = marcas.avaliar({ dia: d.dia, horarios: hs, jornada: jornada || null, refeicao: { disponivel: true, identificado: false, itens: [] } });
        if (r.intervalo && r.intervalo.estado === 'ruim') add(/sem intervalo/.test(r.intervalo.texto) ? 'semintervalo' : 'intervalo', r.intervalo.texto);
        if (r.entrada && r.entrada.estado === 'ruim') add('extra', r.entrada.texto);
        if (r.saida && r.saida.estado === 'ruim') add(/mais cedo/.test(r.saida.texto) ? 'cedo' : 'extra', r.saida.texto);
      }
      linhas.push(l);
    }
    linhas.sort((a, b) => (a.dia < b.dia ? 1 : -1));
    return { linhas, contagem, total: linhas.filter((l) => l.tipos.length).length };
  }

  if (typeof document === 'undefined') return { resumir, TIPOS };

  // ---------- tela (só no navegador) ----------
  const original = window.entrarPesPonto;
  let pessoas = null, gen = 0, sel = '', todos = false, filtro = '';
  const el = (tag, cls, txt) => { const e = document.createElement(tag); if (cls) e.className = cls; if (txt != null) e.textContent = txt; return e; };
  async function rpc(fn, args) {
    const r = await trRpc(fn, args || {});
    if (!r.ok) throw new Error('HTTP ' + r.status);
    const t = await r.text(); return t ? JSON.parse(t) : null;
  }
  function caixa() {
    let b = document.getElementById('view-phist');
    if (!b) { const v = document.getElementById('view-pcartao'); if (!v) return null; b = el('div'); b.id = 'view-phist'; v.parentNode.insertBefore(b, v); }
    return b;
  }
  async function montar() {
    const box = caixa(); if (!box) return;
    const g = ++gen;
    box.replaceChildren();
    const sec = el('section', 'phist');
    sec.appendChild(el('h2', 'phist-tit', 'Histórico de infrações de uma pessoa'));
    sec.appendChild(el('p', 'phist-nota', 'Escolha a pessoa: aparecem todas as infrações desde a admissão, sem digitar data.'));
    const linha = el('div', 'phist-ctl');
    const s = el('select', 'phist-sel'); s.setAttribute('aria-label', 'Pessoa');
    s.appendChild(new Option('Carregando pessoas…', ''));
    linha.appendChild(s);
    sec.appendChild(linha);
    const corpo = el('div'); sec.appendChild(corpo);
    box.appendChild(sec);
    try { if (!pessoas) pessoas = await rpc('ponto_historico_pessoas'); }
    catch (e) { if (g === gen) { s.replaceChildren(new Option('Não deu para carregar as pessoas agora', '')); } return; }
    if (g !== gen) return;
    s.replaceChildren(new Option('— escolha a pessoa —', ''));
    const grupos = [['Trabalhando', pessoas.filter((p) => !p.desligamento)], ['Já saíram', pessoas.filter((p) => p.desligamento)]];
    for (const [nome, lista] of grupos) {
      if (!lista.length) continue;
      const og = document.createElement('optgroup'); og.label = nome;
      for (const p of lista) og.appendChild(new Option(p.nome + ' — ' + (p.unidade || '') + (p.dias ? '' : ' (sem batidas)'), String(p.id)));
      s.appendChild(og);
    }
    s.value = sel;
    s.addEventListener('change', () => { sel = s.value; todos = false; filtro = ''; abrir(corpo); });
    if (sel) abrir(corpo);
  }
  async function abrir(corpo) {
    const g = ++gen;
    corpo.replaceChildren();
    if (!sel) return;
    corpo.appendChild(el('p', 'phist-nota', 'Carregando o histórico…'));
    let d;
    try { d = await rpc('ponto_historico_pessoa', { p_pessoa: Number(sel) }); } catch (e) { d = null; }
    if (g !== gen) return;
    corpo.replaceChildren();
    if (!d || !d.pessoa) { corpo.appendChild(el('p', 'phist-erro', 'Não deu para carregar o histórico agora.')); return; }
    const p = d.pessoa, f = d.fonte || {};
    const r = resumir(d.dias, d.jornada);
    const info = el('p', 'phist-info');
    info.textContent = 'Admissão: ' + fmt(p.admissao) + (p.desligamento ? ' · Saiu: ' + fmt(p.desligamento) : '') + ' · Horário cadastrado: ' +
      (d.jornada ? d.jornada.entrada + ' às ' + d.jornada.saida : 'nenhum (sem horário não dá para marcar saída cedo nem hora extra)') +
      ' · Dias com batida: ' + r.linhas.length + ' · Dias com infração: ' + r.total;
    corpo.appendChild(info);
    const chips = el('div', 'phist-chips');
    const chip = (k, txt, n) => {
      const b = el('button', 'phist-chip' + (filtro === k ? ' phist-on' : '') + (n ? ' phist-ruim' : ''), txt + ': ' + n); b.type = 'button';
      b.addEventListener('click', () => { filtro = filtro === k ? '' : k; todos = false; desenhar(); }); chips.appendChild(b);
    };
    const lista = el('div');
    function desenhar() {
      chips.replaceChildren();
      Object.keys(TIPOS).forEach((k) => chip(k, TIPOS[k], r.contagem[k]));
      const bt = el('button', 'phist-chip' + (todos ? ' phist-on' : ''), todos ? 'Mostrar só as infrações' : 'Mostrar todos os dias'); bt.type = 'button';
      bt.addEventListener('click', () => { todos = !todos; filtro = ''; desenhar(); }); chips.appendChild(bt);
      lista.replaceChildren();
      const ls = r.linhas.filter((l) => (filtro ? l.tipos.includes(filtro) : (todos || l.tipos.length)));
      if (!ls.length) { lista.appendChild(el('p', 'phist-nota', r.linhas.length ? 'Nenhuma infração encontrada neste histórico.' : 'Nenhuma batida desta pessoa no histórico do Flash.')); return; }
      const rol = el('div', 'pcart-rolagem'); const t = el('table', 'pcart-tab');
      const th = el('tr'); ['Dia', 'Loja', 'Batidas', 'O que aconteceu'].forEach((x) => th.appendChild(el('th', null, x)));
      const thead = el('thead'); thead.appendChild(th); t.appendChild(thead);
      const tb = el('tbody');
      for (const l of ls) {
        const tr = el('tr');
        tr.appendChild(el('td', null, fmt(l.dia)));
        tr.appendChild(el('td', null, l.empresa));
        tr.appendChild(el('td', null, l.batidas.join(' · ')));
        tr.appendChild(el('td', l.tipos.length ? 'phist-ruim-tx' : 'phist-ok-tx', l.tipos.length ? l.textos.join('; ') : 'tudo certo'));
        tb.appendChild(tr);
      }
      t.appendChild(tb); rol.appendChild(t); lista.appendChild(rol);
    }
    corpo.appendChild(chips); corpo.appendChild(lista);
    desenhar();
    corpo.appendChild(el('p', 'phist-nota', 'Fonte: Flash, de ' + fmt(f.de) + ' a ' + fmt(f.ate) + '. O Flash não tem batidas antes disso. ' +
      'Dias antigos usam o horário cadastrado hoje. Refeição não entra aqui; o dia de hoje aparece na consulta abaixo.'));
  }
  window.entrarPesPonto = function () {
    const r = original ? original.apply(this, arguments) : undefined;
    try { montar(); } catch (e) { }
    return r;
  };
  return { resumir, TIPOS };
});
