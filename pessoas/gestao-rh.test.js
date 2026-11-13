// Testes da Gestão do RH — erros do dia (regra pura, tela com DOM de mentira, ligação na casca). Só nomes e dados fictícios.
// node --test pessoas/gestao-rh.test.js
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const M = require('./gestao-rh-modelo.js');
const T = require('./gestao-rh.js');
const RAIZ = path.join(__dirname, '..');
const ler = (...p) => fs.readFileSync(path.join(RAIZ, ...p), 'utf8');

const DIA = '2026-11-12', HOJE = '2026-11-13';
const hs = (...hm) => hm.map((x) => (x.startsWith('+') ? '2026-11-13T' + x.slice(1) : DIA + 'T' + x) + ':00');
const pessoa = (id, nome, extra) => Object.assign({ id, nome, unidade: 'AGUA VERDE', flash_id: 'f' + id, usa_ponto: true, cargo_confianca: false }, extra || {});
const bat = (id, ...hm) => ({ data: DIA, flash_id: 'f' + id, horarios: hs(...hm), n_batidas: hm.length });
function resposta(extra) {
  return Object.assign({
    fonte: 'Flash — leitura direta', dia: DIA, unidade: 'AGUA VERDE', lidoEm: '2026-11-13T12:00:00.000Z', jornadas: {},
    pessoas: [pessoa(1, 'Ana Teste'), pessoa(2, 'Bruno Teste'), pessoa(3, 'Carla Teste'), pessoa(4, 'Davi Teste'), pessoa(5, 'Eva Teste', { usa_ponto: false }), pessoa(6, 'Fabi Teste')],
    batidas: [bat(1, '10:00', '14:00', '15:00', '19:00'), bat(2, '10:00', '14:00', '14:20', '19:00'), bat(3, '11:00', '15:00'), bat(6, '16:00', '20:00', '21:00', '+01:30')],
    refeicoes: { disponivel: true, porPessoa: { 1: [{ tipo: 'REFEICAO', produto: 'Bisteca', quantidade: 1, hora: '14:10' }] }, identificados: [1, 2, 3], indisponiveis: [] },
    avisos: ['aviso <b>do</b> leitor'],
  }, extra || {});
}
const linha = (r, id) => r.linhas.find((l) => l.id === id);
const cats = (l) => l.apontamentos.map((a) => a.categoria);

test('medidas: intervalo é a soma das saídas do meio e o líquido desconta o intervalo', () => {
  assert.deepEqual(M.medir([600, 840, 900, 1140]), { intervalo: 60, liquido: 480 });
  assert.deepEqual(M.medir([600, 720, 735, 840, 900, 1140]), { intervalo: 75, liquido: 465 });
  assert.deepEqual(M.medir([600, 840]), { intervalo: null, liquido: null });
  assert.deepEqual(M.medir([600, 720, 735, 840, 900]), { intervalo: null, liquido: null }, 'número ímpar não mede');
  assert.equal(M.intervaloLegal(361), 60); assert.equal(M.intervaloLegal(360), 15); assert.equal(M.intervaloLegal(240), 0);
});

test('minutos do dia: madrugada do dia seguinte soma 24h; data estranha ou fora de ordem invalida a leitura', () => {
  assert.deepEqual(M.minutosDoDia(hs('16:00', '+01:30'), DIA), [960, 1530]);
  assert.equal(M.minutosDoDia(['2026-11-10T10:00:00'], DIA), null);
  assert.equal(M.minutosDoDia(hs('15:00', '10:00'), DIA), null);
  assert.equal(M.minutosDoDia('x', DIA), null);
});

test('dia fechado: aponta intervalo abaixo do legal, batidas incompletas e refeição não localizada', () => {
  const r = M.apontar(resposta(), { hojeOperacional: HOJE });
  assert.equal(r.ok, true); assert.equal(r.fechado, true);
  assert.deepEqual(cats(linha(r, 1)), []); assert.equal(linha(r, 1).nivel, 'SEM');
  assert.equal(linha(r, 1).refeicao.estado, 'lancada'); assert.equal(linha(r, 1).refeicaoErro, false);
  assert.deepEqual(cats(linha(r, 2)), ['INTERVALO_ABAIXO_LEGAL']); assert.equal(linha(r, 2).nivel, 'SERIO');
  assert.match(linha(r, 2).apontamentos[0].texto, /20 min.*60 min/);
  assert.equal(linha(r, 2).refeicaoErro, true);
  assert.deepEqual(cats(linha(r, 3)), ['BATIDAS_INCOMPLETAS']); assert.equal(linha(r, 3).nivel, 'INFRACAO');
  // sem vínculo de refeição confirmado: nunca vira "não lançou"
  assert.equal(linha(r, 6).refeicao.estado, 'sem_vinculo'); assert.equal(linha(r, 6).refeicaoErro, false);
  assert.equal(linha(r, 6).viradaNoite, true); assert.equal(linha(r, 6).liquido, 510);
  // quem não bateu não é acusado de falta; quem não usa ponto fica fora
  assert.deepEqual(r.semBatida.map((p) => p.id), [4]); assert.equal(r.foraDoPonto, 1);
  assert.deepEqual(r.linhas.map((l) => l.id), [2, 3, 1, 6]);   // mais sério primeiro
  assert.equal(r.kpis.SERIO, 1); assert.equal(r.kpis.INFRACAO, 1); assert.equal(r.kpis.REF_NAO, 2); assert.equal(r.kpis.SEM_BATIDA, 1); assert.equal(r.kpis.TOTAL, 4);
  assert.equal(r.atrasoAvaliado, false);
  // o número de cada cartão é igual ao tamanho da lista que ele abre
  ['SERIO', 'INFRACAO', 'VERBAL', 'CONFERIR', 'SEM', 'REF_NAO'].forEach((k) => assert.equal(r.kpis[k], M.filtrar(r.linhas, k).length, k));
  assert.equal(r.kpis.SEM, 2);
  // 5 batidas (ímpar) em dia fechado: batidas incompletas, sem acusar intervalo; em andamento não aponta
  const imp = resposta({ batidas: [bat(1, '10:00', '14:00', '14:10', '18:00', '19:00')] });
  const li = linha(M.apontar(imp, { hojeOperacional: HOJE }), 1);
  assert.deepEqual(cats(li), ['BATIDAS_INCOMPLETAS']); assert.equal(li.liquido, null); assert.match(li.apontamentos[0].texto, /5 batidas.*ímpar/);
  assert.deepEqual(cats(linha(M.apontar(imp, { hojeOperacional: DIA }), 1)), []);
  assert.ok(!r.avisos.join(' ').includes('<'));
});

test('dia em andamento: não acusa batida incompleta nem refeição', () => {
  const r = M.apontar(resposta(), { hojeOperacional: DIA });
  assert.equal(r.emAndamento, true);
  assert.deepEqual(cats(linha(r, 3)), []); assert.equal(linha(r, 3).refeicaoErro, false); assert.equal(r.kpis.REF_NAO, 0);
  // sem "hoje" confiável também não acusa
  assert.equal(M.apontar(resposta(), {}).fechado, false);
});

test('atraso só com horário cadastrado: 11 a 45 min = atraso; mais de 45 = conferir escala; até 10 = tolerância', () => {
  const com = (ent, jor) => { const r = M.apontar(resposta({ batidas: [bat(1, ent, '14:00', '15:00', '19:00')], jornadas: { 1: jor } }), { hojeOperacional: DIA }); return cats(linha(r, 1)); };
  assert.deepEqual(com('10:10', { entrada: '10:00', saida: '19:00' }), []);
  assert.deepEqual(com('10:11', { entrada: '10:00', saida: '19:00' }), ['ATRASO']);
  assert.deepEqual(com('10:45', { entrada: '10:00', saida: '19:00' }), ['ATRASO']);
  assert.deepEqual(com('10:46', { entrada: '10:00', saida: '19:00' }), ['ESCALA_DIVERGENTE']);
  assert.deepEqual(com('10:00', { entrada: '10:00', saida: '18:40' }), ['SAIU_APOS_HORARIO']);
  assert.deepEqual(com('10:00', { entrada: 'xx', saida: '19:00' }), []);
  // uma batida só já mostra o atraso do dia em andamento
  const r = M.apontar(resposta({ batidas: [bat(1, '10:30')], jornadas: { 1: { entrada: '10:00', saida: '19:00' } } }), { hojeOperacional: DIA });
  assert.deepEqual(cats(linha(r, 1)), ['ATRASO']); assert.equal(r.atrasoAvaliado, true);
});

test('teto de 10h e saída depois da meia-noite com horário noturno', () => {
  const r = M.apontar(resposta({ batidas: [bat(1, '09:00', '13:00', '14:00', '19:40')] }), { hojeOperacional: HOJE });
  assert.deepEqual(cats(linha(r, 1)), ['TETO_10H']);
  const n = M.apontar(resposta({ batidas: [bat(6, '16:00', '20:00', '21:00', '+01:30')], jornadas: { 6: { entrada: '16:00', saida: '01:00' } } }), { hojeOperacional: HOJE });
  assert.deepEqual(cats(linha(n, 6)), ['SAIU_APOS_HORARIO']);
});

test('refeição: sem cobertura ou fonte fora do ar nunca vira acusação', () => {
  const pend = M.apontar(resposta({ refeicoes: { disponivel: true, porPessoa: {}, identificados: [1, 2, 3], indisponiveis: [2] } }), { hojeOperacional: HOJE });
  assert.equal(linha(pend, 2).refeicao.estado, 'pendente'); assert.equal(linha(pend, 2).refeicaoErro, false);
  const fora = M.apontar(resposta({ refeicoes: { disponivel: false } }), { hojeOperacional: HOJE });
  assert.equal(fora.kpis.REF_NAO, 0); assert.equal(linha(fora, 1).refeicao.estado, 'indisponivel');
  const semLista = M.apontar(resposta({ refeicoes: { disponivel: true, porPessoa: {} } }), { hojeOperacional: HOJE });
  assert.equal(semLista.kpis.REF_NAO, 0);
});

test('leitura repetida ou ilegível vira "conferir", sem horário atribuído; resposta sem dia é recusada', () => {
  const r = M.apontar(resposta({ batidas: [bat(1, '10:00', '14:00'), bat(1, '10:00', '14:00'), { data: DIA, flash_id: 'f2', horarios: ['lixo'] }] }), { hojeOperacional: HOJE });
  assert.deepEqual(cats(linha(r, 1)), ['LEITURA_INVALIDA']); assert.deepEqual(linha(r, 1).batidas, []);
  assert.deepEqual(cats(linha(r, 2)), ['LEITURA_INVALIDA']);
  assert.equal(M.apontar({ dia: '2026-02-30' }, {}).ok, false); assert.equal(M.apontar(null, {}).ok, false);
});

test('filtros e janela de 7 dias', () => {
  const r = M.apontar(resposta(), { hojeOperacional: HOJE });
  assert.deepEqual(M.filtrar(r.linhas, 'ERROS').map((l) => l.id), [2, 3]);
  assert.deepEqual(M.filtrar(r.linhas, 'REF_NAO').map((l) => l.id), [2, 3]);
  assert.deepEqual(M.filtrar(r.linhas, 'SEM').map((l) => l.id), [1, 6]);
  assert.equal(M.filtrar(r.linhas, 'TODOS').length, 4);
  assert.deepEqual(M.diasPermitidos(HOJE), ['2026-11-07', '2026-11-08', '2026-11-09', '2026-11-10', '2026-11-11', '2026-11-12', '2026-11-13']);
  assert.deepEqual(M.diasPermitidos('x'), []);
});

// ---------- tela: DOM mínimo de mentira ----------
function fazDoc() {
  const mk = (tag) => {
    const e = { tagName: tag, children: [], attrs: {}, listeners: {}, className: '', textContent: '', disabled: false,
      appendChild(c) { this.children.push(c); return c; }, replaceChildren() { this.children = []; this.textContent = ''; },
      setAttribute(k, v) { this.attrs[k] = v; }, addEventListener(t, f) { this.listeners[t] = f; } };
    return e;
  };
  const raiz = mk('div');
  return { raiz, createElement: mk, createTextNode: (t) => ({ tagName: '#text', textContent: t, children: [] }), getElementById: (id) => (id === 'view-prh' ? raiz : null) };
}
const todoTexto = (e) => (e.textContent || '') + (e.children || []).map(todoTexto).join(' ');
const achar = (e, f, out = []) => { if (f(e)) out.push(e); (e.children || []).forEach((c) => achar(c, f, out)); return out; };
function fazDeps(extra) {
  const doc = fazDoc(); const chamadas = [];
  const deps = Object.assign({
    doc, lojaCarregar: async () => ({ lojas: ['AGUA VERDE', 'REDE'] }), lojaAtual: () => 'AGUA VERDE', aoMudarLoja: () => {}, sessaoId: () => 'sessao',
    sessaoVencida: () => { chamadas.push('vencida'); }, diaOperacional: () => HOJE,
    leituraDireta: async (a) => { chamadas.push(a.dia + '|' + a.unidade); return resposta({ dia: a.dia, batidas: a.dia === DIA ? resposta().batidas : [] }); },
  }, extra || {});
  return { deps, doc, chamadas };
}

test('tela: abre no dia operacional, anda para o dia anterior e mostra erros, refeição e quem ficou sem batida', async () => {
  const { deps, doc, chamadas } = fazDeps(); const t = T.criar(deps);
  await t.entrar();
  assert.deepEqual(chamadas, [HOJE + '|AGUA VERDE']); assert.equal(t.st.fase, 'ok');
  t.passo(1); assert.equal(chamadas.length, 1, 'não passa de hoje');
  t.passo(-1); await new Promise((r) => setImmediate(r));
  assert.deepEqual(chamadas, [HOJE + '|AGUA VERDE', DIA + '|AGUA VERDE']);
  const txt = todoTexto(doc.raiz);
  assert.match(txt, /Bruno Teste/); assert.match(txt, /Intervalo abaixo do mínimo legal/); assert.match(txt, /não localizada na leitura do dia/);
  assert.match(txt, /1 pessoa\(s\) do cadastro sem batida/); assert.match(txt, /Atraso NÃO avaliado/);
  assert.doesNotMatch(txt, /Ana Teste/, 'filtro padrão só mostra quem tem algo para olhar');
  const kpiTodos = achar(doc.raiz, (e) => /grh-k-TODOS/.test(e.className))[0];
  kpiTodos.listeners.click();
  assert.match(todoTexto(doc.raiz), /Ana Teste/); assert.match(todoTexto(doc.raiz), /Bisteca \(14:10\)/);
  assert.equal(chamadas.length, 2, 'filtrar não consulta de novo');
});

test('tela: erros do leitor viram mensagem clara e nada é exibido', async () => {
  for (const [status, fase] of [[401, 'sessao'], [403, 'semacesso'], [429, 'muitas'], [502, 'fonte'], [500, 'erro']]) {
    const { deps, doc, chamadas } = fazDeps({ leituraDireta: async () => { throw Object.assign(new Error('x'), { status }); } });
    const t = T.criar(deps); await t.entrar();
    assert.equal(t.st.fase, fase); assert.equal(t.st.dados, null);
    assert.equal(achar(doc.raiz, (e) => e.tagName === 'table').length, 0);
    assert.equal(chamadas.includes('vencida'), status === 401);
  }
  const semLoja = fazDeps({ lojaAtual: () => 'OUTRA' }); const t2 = T.criar(semLoja.deps); await t2.entrar();
  assert.equal(t2.st.fase, 'semloja'); assert.equal(semLoja.chamadas.length, 0);
  const ruim = fazDeps({ leituraDireta: async () => ({ dia: '2026-01-01' }) }); const t3 = T.criar(ruim.deps); await t3.entrar();
  assert.equal(t3.st.fase, 'dadosinvalidos');
});

test('tela: só leitura — um GET ao leitor próprio, sem escrita, sem temporizador, sem HTML montado com dado', () => {
  const src = ler('pessoas', 'gestao-rh.js') + ler('pessoas', 'gestao-rh-modelo.js');
  assert.doesNotMatch(src, /innerHTML|insertAdjacentHTML|document\.write|setInterval|localStorage\.setItem|sessionStorage\.setItem/);
  assert.doesNotMatch(src, /method:\s*'(POST|PATCH|PUT|DELETE)'|\/rest\/v1|rpc\(/);
  assert.equal((src.match(/fetch\(/g) || []).length, 1);
  assert.match(src, /functions\/v1\/fabio-ponto-leitura/);
  assert.doesNotMatch(src, /cidadaodomundo\.github\.io|kqvoatdprjwxyadhvtdd/);
});

test('ligação: página, menu com selo Fábio, busca, por loja e setor RH do agrupamento do Fábio', () => {
  const html = ler('pessoas', 'index.html');
  const pos = (f) => { const i = html.search(new RegExp('<script src="' + f.replace(/\./g, '\\.') + '[?"]')); assert.ok(i >= 0, 'falta ' + f); return i; };
  assert.ok(pos('pessoas.js') < pos('gestao-rh-modelo.js')); assert.ok(pos('gestao-rh-modelo.js') < pos('gestao-rh.js'));
  assert.match(html, /<link rel="stylesheet" href="gestao-rh\.css/);
  assert.match(html, /id="modulo-prh"[^>]*><div id="view-prh">/);
  assert.match(html, /prh:\s*entrarPesGestaoRh,\s/);
  const ctx = {}; ctx.window = ctx; vm.createContext(ctx);
  ['menu.js', 'paginas.js', 'modulos.js', 'busca.js', 'setores-fabio.js'].forEach((f) => vm.runInContext(ler('casca', f), ctx, { filename: f }));
  const g = (k) => JSON.parse(JSON.stringify(ctx[k]));
  const itens = g('CASCA_MENU').flatMap((x) => x.itens).filter((i) => i.chave === 'prh');
  assert.equal(itens.length, 1); assert.equal(itens[0].origem, 'fabio'); assert.equal(itens[0].rotulo, 'Gestão do RH');
  assert.equal(g('CASCA_PAGINAS').prh, 'pessoas/index.html#prh');
  assert.ok(g('CASCA_TELAS_POR_LOJA').includes('prh')); assert.ok(g('CASCA_BUSCA').prh.length > 0);
  assert.ok(!g('CASCA_MODULOS').some((m) => (m.lancar || []).includes('prh') || (m.acompanhar || []).includes('prh')), 'fica fora dos módulos do Neto');
  assert.equal(g('CASCA_SETORES_FABIO').setores.find((s) => s.id === 'rh').chaves[0], 'prh');
  const css = ler('pessoas', 'gestao-rh.css');
  css.split('\n').filter((l) => /^\s*[#.@a-z]/i.test(l) && l.includes('{') && !l.trim().startsWith('@media')).forEach((l) => assert.match(l, /#view-prh/, 'regra fora do escopo: ' + l.slice(0, 60)));
});
