// HISTÓRICO DE PONTO DE UMA PESSOA (topo da Consulta de ponto, rota pcartao). Escolhe a pessoa e já aparecem todas as
// infrações desde a admissão, sem digitar data. Fontes (pela função do banco ponto_historico_pessoa, que confere a
// permissão de RH): batidas do Flash (rh_ponto_historico, desde 21/03/2026), refeição do Saipos (vínculos de cartão,
// apelido e venda), advertência/suspensão/atestado (rh_ocorrencia) e férias/eventos do Flash (rh_flash_ausencia).
// Regras do dia: pessoas/ponto-marcas.js. Dia antigo é calculado com o horário cadastrado HOJE.
(function (root, factory) {
  'use strict';
  const mod = factory(typeof require === 'function' && typeof module !== 'undefined' ? require('./ponto-marcas.js') : (root && root.PontoMarcas));
  if (typeof module !== 'undefined' && module.exports) module.exports = mod;
  if (root && typeof document !== 'undefined') root.PontoHistorico = mod;
})(typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : null), function (marcas) {
  'use strict';
  // ordem dos botões
  const TIPOS = Object.freeze({
    cedo: 'Saiu cedo', extra: 'Hora extra', intervalo: 'Intervalo curto', semintervalo: 'Sem intervalo',
    impar: 'Batida faltando', refeicao: 'Sem refeição', ADVERTENCIA: 'Advertência', SUSPENSAO: 'Suspensão',
    ATESTADO: 'Atestado', DECLARACAO: 'Declaração', FERIAS: 'Férias', EVENTO: 'Ausência (Flash)',
    BONIF_PERDEU: 'Perdeu bonificação', BONIF_GANHOU: 'Ganhou bonificação', AUMENTO: 'Aumento', CARGO: 'Mudou de cargo', ADMISSAO: 'Entrou na empresa',
    BONUS_FORA: 'Bônus por fora', HORA_EXTRA_FOLHA: 'Hora extra paga', FALTA_FOLHA: 'Falta descontada', VALE: 'Vale / empréstimo',
    DESC_EMPRESTIMO: 'Desconto de empréstimo', AFASTAMENTO: 'Afastamento', DESLIGAMENTO: 'Saiu da empresa',
  });
  const BOM = new Set(['BONIF_GANHOU', 'AUMENTO', 'CARGO', 'ADMISSAO', 'BONUS_FORA']);
  const GRAVE = new Set(['ADVERTENCIA', 'SUSPENSAO']);
  const NEUTRO = new Set(['ATESTADO', 'DECLARACAO', 'FERIAS', 'EVENTO', 'BONIF_GANHOU', 'AUMENTO', 'CARGO', 'ADMISSAO', 'BONUS_FORA', 'HORA_EXTRA_FOLHA', 'VALE', 'DESC_EMPRESTIMO', 'AFASTAMENTO', 'DESLIGAMENTO']);
  const reais = (v) => 'R$ ' + Number(v || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const fmt = (d) => (typeof d === 'string' && d.length >= 10 ? d.slice(8, 10) + '/' + d.slice(5, 7) + '/' + d.slice(2, 4) : '—');

  // d = resposta de ponto_historico_pessoa. Devolve {linhas, contagem, total}. Cada linha = um dia de ponto ou um registro do RH.
  function resumir(d) {
    d = d || {};
    const contagem = {}; Object.keys(TIPOS).forEach((k) => { contagem[k] = 0; });
    const linhas = [];
    const ref = d.refeicao || {}, refDias = ref.dias || {}, refAte = typeof ref.ate === 'string' ? ref.ate : '';
    for (const x of Array.isArray(d.dias) ? d.dias : []) {
      if (!x || typeof x.dia !== 'string' || !Array.isArray(x.horarios)) continue;
      const hs = x.horarios.filter((h) => typeof h === 'string');
      const itens = Array.isArray(refDias[x.dia]) ? refDias[x.dia] : [];
      const l = { tipo: 'ponto', dia: x.dia, loja: x.empresa || '', batidas: hs.map(marcas.hora), intervalo: '', refeicao: '', tipos: [], textos: [] };
      const add = (k, t) => { if (!l.tipos.includes(k)) { l.tipos.push(k); contagem[k]++; } l.textos.push(t); };
      const r = marcas.avaliar({ dia: x.dia, horarios: hs, jornada: d.jornada || null,
        refeicao: { pendente: !refAte || x.dia > refAte, disponivel: !!refAte, identificado: ref.identificado === true, itens } });
      l.refeicao = itens.length ? itens.map((i) => (i.produto || 'refeição') + (i.hora ? ' ' + i.hora : '')).join('; ') : (r.refeicao ? r.refeicao.texto : '—');
      l.refeicaoRuim = !!(r.refeicao && r.refeicao.estado === 'ruim');
      if (hs.length % 2 === 1) add('impar', hs.length + ' batida(s): faltou bater');
      else if (hs.length) {
        if (r.intervalo) l.intervalo = r.intervalo.estado === 'ruim' ? r.intervalo.texto.replace(/^intervalo de /, '') : r.intervalo.texto;
        if (r.intervalo && r.intervalo.estado === 'ruim') add(/sem intervalo/.test(r.intervalo.texto) ? 'semintervalo' : 'intervalo', r.intervalo.texto);
        if (r.entrada && r.entrada.estado === 'ruim') add('extra', r.entrada.texto.replace(/; conferir autorização$/, ''));
        if (r.saida && r.saida.estado === 'ruim') add(/mais cedo/.test(r.saida.texto) ? 'cedo' : 'extra', r.saida.texto.replace(/; conferir autorização$/, ''));
        if (l.refeicaoRuim) add('refeicao', 'não pegou refeição');
      }
      linhas.push(l);
    }
    for (const o of Array.isArray(d.ocorrencias) ? d.ocorrencias : []) {
      if (!o || typeof o.dia !== 'string' || !TIPOS[o.tipo]) continue;
      contagem[o.tipo]++;
      linhas.push({ tipo: 'rh', dia: o.dia, loja: '', batidas: [], intervalo: '', refeicao: '', tipos: [o.tipo], textos: [typeof o.motivo === 'string' && o.motivo.trim() ? o.motivo.trim() : TIPOS[o.tipo]] });
    }
    for (const a of Array.isArray(d.ausencias) ? d.ausencias : []) {
      if (!a || typeof a.inicio !== 'string' || !TIPOS[a.tipo]) continue;
      contagem[a.tipo]++;
      const ate = typeof a.fim === 'string' && a.fim !== a.inicio ? ' até ' + fmt(a.fim) : '';
      linhas.push({ tipo: 'rh', dia: a.inicio, loja: '', batidas: [], intervalo: '', refeicao: '', tipos: [a.tipo], textos: [TIPOS[a.tipo] + ate] });
    }
    const rh = (dia, k, txt) => { contagem[k]++; linhas.push({ tipo: 'rh', dia, loja: '', batidas: [], intervalo: '', refeicao: '', tipos: [k], textos: [txt] }); };
    for (const b of Array.isArray(d.bonificacao) ? d.bonificacao : []) {
      if (!b || typeof b.mes !== 'string') continue;
      const mes = b.mes.slice(5, 7) + '/' + b.mes.slice(0, 4);
      if (Number(b.perdido) > 0 && !(Number(b.cheio) > 0)) continue; // mês sem direito (férias/afastado): não é perda
      if (Number(b.perdido) > 0) rh(b.mes, 'BONIF_PERDEU', mes + ': perdeu ' + reais(b.perdido) + (Number(b.cheio) > 0 ? ' de ' + reais(b.cheio) : '') + (b.motivo ? ' (' + String(b.motivo).toLowerCase() + ')' : ''));
      else if (Number(b.valor) > 0) rh(b.mes, 'BONIF_GANHOU', mes + ': ganhou ' + reais(b.valor));
    }
    const car = Array.isArray(d.carreira) ? d.carreira : [];
    for (const c of car) {
      if (!c || typeof c.dia !== 'string') continue;
      if (c.salario_ant == null && c.cargo_ant == null) { rh(c.dia, 'CARGO', 'Primeira folha: ' + (c.cargo || 'cargo não informado') + ', ' + reais(c.salario)); continue; }
      if (Number(c.salario) > Number(c.salario_ant)) rh(c.dia, 'AUMENTO', reais(c.salario_ant) + ' → ' + reais(c.salario) + ' (+' + Math.round((c.salario / c.salario_ant - 1) * 1000) / 10 + '%)');
      if ((c.cargo || '') !== (c.cargo_ant || '')) rh(c.dia, 'CARGO', (c.cargo_ant || '?') + ' → ' + (c.cargo || '?'));
    }
    const mesDe = (x) => x.slice(5, 7) + '/' + x.slice(0, 4);
    for (const o of Array.isArray(d.outros) ? d.outros : []) {
      if (!o || typeof o.dia !== 'string' || !TIPOS[o.tipo]) continue;
      if (o.tipo === 'BONUS_FORA') rh(o.dia, o.tipo, mesDe(o.dia) + ': ' + reais(o.valor));
      else if (o.tipo === 'HORA_EXTRA_FOLHA') rh(o.dia, o.tipo, mesDe(o.dia) + ': ' + reais(o.valor) + ' na folha');
      else if (o.tipo === 'FALTA_FOLHA') rh(o.dia, o.tipo, mesDe(o.dia) + ': ' + String(o.horas).replace('.', ',') + ' h, ' + reais(o.valor));
      else if (o.tipo === 'DESC_EMPRESTIMO') rh(o.dia, o.tipo, mesDe(o.dia) + ': ' + reais(o.valor));
      else if (o.tipo === 'VALE') rh(o.dia, o.tipo, reais(o.valor) + (Number(o.parcelas) > 1 ? ' em ' + o.parcelas + ' parcelas' : ''));
      else rh(o.dia, o.tipo, typeof o.fim === 'string' ? 'até ' + fmt(o.fim) : TIPOS[o.tipo]);
    }
    if (d.pessoa && typeof d.pessoa.admissao === 'string') rh(d.pessoa.admissao, 'ADMISSAO', 'Admissão');
    if (d.pessoa && typeof d.pessoa.desligamento === 'string') rh(d.pessoa.desligamento, 'DESLIGAMENTO', 'Desligamento');
    linhas.sort((a, b) => (a.dia < b.dia ? 1 : a.dia > b.dia ? -1 : (a.tipo === 'rh' ? -1 : 1)));
    return { linhas, contagem, total: linhas.filter((l) => l.tipos.some((t) => !NEUTRO.has(t))).length };
  }

  if (typeof document === 'undefined') return { resumir, TIPOS, fmt };

  // ---------- tela (só no navegador) ----------
  const original = window.entrarPesPonto;
  let pessoas = null, gen = 0, sel = '', filtro = 'inf', modo = 'pessoa';
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
    const topo = el('div', 'phist-topo');
    topo.appendChild(el('h2', 'phist-tit', 'Quadro completo do funcionário'));
    const s = el('select', 'phist-sel'); s.setAttribute('aria-label', 'Pessoa');
    s.appendChild(new Option('Carregando pessoas…', ''));
    topo.appendChild(s);
    // 16/11 (Fábio): Eventos e ausências virou o modo "Todos da loja" desta tela
    const modos = el('div', 'phist-modos');
    const bPes = el('button', 'phist-bt', 'Uma pessoa (história inteira)'), bLoja = el('button', 'phist-bt', 'Todos da loja (por período)');
    bPes.type = 'button'; bLoja.type = 'button';
    modos.appendChild(bPes); modos.appendChild(bLoja); topo.appendChild(modos);
    sec.appendChild(topo);
    const corpo = el('div'); sec.appendChild(corpo);
    const loja = el('div'); sec.appendChild(loja);
    box.appendChild(sec);
    const trocar = (m) => {
      modo = m;
      bPes.classList.toggle('phist-on', m === 'pessoa'); bLoja.classList.toggle('phist-on', m === 'loja');
      s.hidden = m !== 'pessoa'; corpo.hidden = m !== 'pessoa'; loja.hidden = m !== 'loja';
      if (m === 'loja') {
        const v = document.getElementById('view-peventos');
        if (v && v.parentNode !== loja) loja.appendChild(v);
        try { if (window.entrarPesEventos) window.entrarPesEventos(); } catch (e) { loja.replaceChildren(el('p', 'phist-nota', 'Não deu para abrir a lista da loja agora.')); }
      }
    };
    bPes.addEventListener('click', () => trocar('pessoa')); bLoja.addEventListener('click', () => trocar('loja'));
    trocar(modo);
    try { if (!pessoas) pessoas = await rpc('ponto_historico_pessoas'); }
    catch (e) { if (g === gen) s.replaceChildren(new Option('Não deu para carregar as pessoas agora', '')); return; }
    if (g !== gen) return;
    s.replaceChildren(new Option('Escolha a pessoa: aparecem todas as infrações desde a admissão', ''));
    for (const [nome, lista] of [['Trabalhando', pessoas.filter((p) => !p.desligamento)], ['Já saíram', pessoas.filter((p) => p.desligamento)]]) {
      if (!lista.length) continue;
      const og = document.createElement('optgroup'); og.label = nome;
      for (const p of lista) og.appendChild(new Option(p.nome + ' · ' + (p.unidade || ''), String(p.id)));
      s.appendChild(og);
    }
    s.value = sel;
    s.addEventListener('change', () => { sel = s.value; filtro = 'inf'; abrir(corpo); });
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
    desenharPessoa(corpo, d);
  }
  function desenharPessoa(corpo, d) {
    const p = d.pessoa, f = d.fonte || {};
    const r = resumir(d);
    const cards = el('div', 'phist-cards');
    const card = (rot, val, cls) => { const c = el('div', 'phist-card' + (cls ? ' ' + cls : '')); c.appendChild(el('span', 'phist-card-rot', rot)); c.appendChild(el('b', null, val)); cards.appendChild(c); };
    card('Admissão', fmt(p.admissao));
    if (p.desligamento) card('Saiu', fmt(p.desligamento));
    card('Horário', d.jornada ? d.jornada.entrada + '–' + d.jornada.saida : 'sem horário', d.jornada ? '' : 'phist-c-alerta');
    card('Dias trabalhados', String(r.linhas.filter((l) => l.tipo === 'ponto').length));
    card('Dias com infração', String(r.total), r.total ? 'phist-c-ruim' : 'phist-c-ok');
    card('Advertências', String(r.contagem.ADVERTENCIA), r.contagem.ADVERTENCIA ? 'phist-c-ruim' : '');
    card('Suspensões', String(r.contagem.SUSPENSAO), r.contagem.SUSPENSAO ? 'phist-c-ruim' : '');
    card('Bonificação perdida', r.contagem.BONIF_PERDEU + ' de ' + (r.contagem.BONIF_PERDEU + r.contagem.BONIF_GANHOU) + ' meses', r.contagem.BONIF_PERDEU ? 'phist-c-ruim' : '');
    card('Aumentos', String(r.contagem.AUMENTO), r.contagem.AUMENTO ? 'phist-c-ok' : '');
    if (r.contagem.FALTA_FOLHA) card('Meses com falta', String(r.contagem.FALTA_FOLHA), 'phist-c-ruim');
    if (r.contagem.BONUS_FORA) card('Bônus por fora', String(r.contagem.BONUS_FORA) + ' meses', 'phist-c-ok');
    if (r.contagem.VALE) card('Vales', String(r.contagem.VALE));
    corpo.appendChild(cards);
    const bar = el('div', 'phist-bar'); corpo.appendChild(bar);
    const lista = el('div'); corpo.appendChild(lista);
    const botao = (k, txt, n, cls) => {
      const b = el('button', 'phist-bt' + (filtro === k ? ' phist-on' : '') + (cls ? ' ' + cls : '')); b.type = 'button';
      b.appendChild(document.createTextNode(txt)); if (n != null) b.appendChild(el('span', 'phist-n', String(n)));
      b.addEventListener('click', () => { filtro = k; desenhar(); }); bar.appendChild(b);
    };
    function desenhar() {
      bar.replaceChildren();
      botao('inf', 'Só infrações', r.total);
      botao('todos', 'Todos os dias', null);
      Object.keys(TIPOS).forEach((k) => { if (r.contagem[k]) botao(k, TIPOS[k], r.contagem[k], GRAVE.has(k) ? 'phist-grave' : BOM.has(k) ? 'phist-bom' : NEUTRO.has(k) ? '' : 'phist-ruim'); });
      lista.replaceChildren();
      const ls = r.linhas.filter((l) => filtro === 'todos' ? true : filtro === 'inf' ? l.tipos.some((t) => !NEUTRO.has(t)) : l.tipos.includes(filtro));
      if (!ls.length) { lista.appendChild(el('p', 'phist-nota', r.linhas.length ? 'Nenhuma infração encontrada.' : 'Nenhuma batida desta pessoa no Flash.')); return; }
      const rol = el('div', 'phist-rol'); const t = el('table', 'phist-tab');
      const th = el('tr'); ['Dia', 'Loja', 'Entrada', 'Intervalo', 'Saída', 'Pausa', 'Refeição', 'O que aconteceu'].forEach((x) => th.appendChild(el('th', null, x)));
      const thead = el('thead'); thead.appendChild(th); t.appendChild(thead);
      const tb = el('tbody');
      const td = (tr, txt, cls) => { const c = el('td', cls, txt); if (txt && txt.length > 14) c.title = txt; tr.appendChild(c); return c; };
      for (const l of ls) {
        const tr = el('tr', l.tipo === 'rh' ? 'phist-tr-rh' : null);
        td(tr, fmt(l.dia));
        td(tr, l.loja ? l.loja.replace('AGUA VERDE', 'Água Verde').replace('SAO BRAZ', 'São Braz').replace('AHU', 'Ahú') : '');
        const b = l.batidas, n = b.length;
        td(tr, n ? b[0] : '');
        td(tr, n >= 4 ? b[1] + '–' + b[2] : (n === 3 ? b[1] + '–?' : ''));
        td(tr, n >= 2 ? b[n - 1] : (n === 1 ? '?' : ''));
        td(tr, l.intervalo, /mínimo|sem intervalo/.test(l.intervalo) ? 'phist-tx-ruim' : null);
        td(tr, l.refeicao, l.refeicaoRuim ? 'phist-tx-ruim' : 'phist-tx-fraco');
        const c = el('td', 'phist-oque');
        if (!l.tipos.length) c.appendChild(el('span', 'phist-tag phist-tag-ok', 'tudo certo'));
        l.tipos.forEach((k) => c.appendChild(el('span', 'phist-tag ' + (GRAVE.has(k) ? 'phist-tag-grave' : BOM.has(k) ? 'phist-tag-ok' : NEUTRO.has(k) ? 'phist-tag-neutro' : 'phist-tag-ruim'), TIPOS[k])));
        const txt = l.textos.filter((x) => !Object.values(TIPOS).includes(x) && x !== 'não pegou refeição')
          .map((x) => x.replace(/^hora extra: /, '').replace(/ \(\d\d:\d\d às \d\d:\d\d\)/, '')).join('; ');
        if (txt) c.appendChild(el('span', 'phist-det', txt));
        c.title = l.textos.join('; ');
        tr.appendChild(c);
        tb.appendChild(tr);
      }
      t.appendChild(tb); rol.appendChild(t); lista.appendChild(rol);
    }
    desenhar();
    corpo.appendChild(el('p', 'phist-nota', 'Fontes: batidas do Flash de ' + fmt(f.de) + ' a ' + fmt(f.ate) + ' (o Flash não tem antes disso); refeição do Saipos até ' + fmt((d.refeicao || {}).ate) +
      '; advertência, suspensão e atestado do cadastro do RH; férias e ausências do Flash; bonificação do cálculo do RH; aumentos, cargos, hora extra paga e faltas descontadas das folhas de pagamento; bônus por fora e desconto de empréstimo do pagamento do mês; vales do financeiro. Dias antigos usam o horário cadastrado hoje. O dia de hoje aparece na consulta abaixo.'));
  }
  window.entrarPesPonto = function () {
    const res = original ? original.apply(this, arguments) : undefined;
    try { montar(); } catch (e) { }
    return res;
  };
  return { resumir, TIPOS, fmt, _desenharPessoa: desenharPessoa };
});
