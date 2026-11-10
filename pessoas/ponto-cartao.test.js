// node --test pessoas/ponto-cartao.test.js   (módulos REAIS; só rede, DOM e sessão são ficções; nenhum dado de pessoa real)
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const PC = require('./ponto-cartao.js');
const RAIZ = path.join(__dirname, '..');
const ler = (rel) => fs.readFileSync(path.join(RAIZ, rel), 'utf8');

// ---------- DOM de mentira (sem innerHTML: se o código tentar, falha) ----------
class FEl {
  constructor(tag) { this.tag = tag; this.children = []; this.attrs = {}; this.ev = {}; this.className = ''; this.value = ''; this.disabled = false; this._t = ''; }
  set textContent(v) { this.children = []; this._t = String(v); }
  get textContent() { return this._t + this.children.map((c) => c.textContent).join(''); }
  set innerHTML(v) { throw new Error('innerHTML proibido'); }
  appendChild(c) { this.children.push(c); return c; }
  replaceChildren() { this.children = []; this._t = ''; }
  setAttribute(k, v) { this.attrs[k] = v; }
  addEventListener(n, f) { this.ev[n] = f; }
}
const todos = (e, f, o = []) => { if (f(e)) o.push(e); e.children.forEach((c) => todos(c, f, o)); return o; };
const resp = (v, status = 200) => ({ status, ok: status < 400, json: async () => v });
const settle = async () => { for (let i = 0; i < 20; i++) await new Promise((r) => setImmediate(r)); };

const P = (o) => Object.assign({ id: 1, nome: 'Ana Teste', unidade: 'AHU', admissao: '2020-01-01', desligamento: null, flash_id: 'F1', usa_ponto: true }, o);
const B = (o) => Object.assign({ data: '2026-11-10', flash_id: 'F1', entrada: '2026-11-10T08:05:00', saida: '2026-11-10T17:00:00', n_batidas: 2, lido_em: '2026-11-10T20:00:00-03:00' }, o);

function mk(o = {}) {
  const raiz = new FEl('div'); const log = []; const ouv = []; const sessCb = [];
  const est = { loja: o.loja === undefined ? 'AHU' : o.loja, sess: 'usuario-ficticio' };
  const doc = { createElement: (t) => new FEl(t), getElementById: (id) => (id === 'view-pcartao' ? raiz : null) };
  const deps = {
    doc, raiz, log, est,
    rpc: async (fn) => { log.push('rpc:' + fn); const r = o.rpc ? o.rpc(fn) : true; if (r instanceof Error) throw r; return typeof r === 'object' && r && 'status' in r ? r : resp(r); },
    consultar: async (c) => { log.push(c); return o.consultar ? o.consultar(c) : (c.startsWith('rh_pessoa') ? [P()] : (c.includes('limit=1') ? [] : [])); },
    lojaCarregar: async () => (o.info === undefined ? { lojas: ['AGUA VERDE', 'AHU', 'SÃO BRAZ'], travado: false } : o.info),
    lojaAtual: () => est.loja,
    escolherLoja: (l) => { est.loja = l; ouv.forEach((f) => f(l)); },
    aoMudarLoja: (f) => ouv.push(f), aoMudarSessao: (f) => sessCb.push(f),
    sessaoId: () => est.sess, agora: () => '2026-11-10T15:00:00.000Z', hoje: () => '2026-11-10',
  };
  const c = PC.criar(deps);
  return { c, deps, raiz, log, est, sessCb };
}
const tabelaTxt = (raiz) => todos(raiz, (e) => e.tag === 'tbody').map((t) => t.textContent).join('|');
const tabelas = (log) => log.filter((x) => !x.startsWith('rpc:'));

// ---------- rota ----------
test('rota pcartao registrada por inteiro, no módulo Pessoas, sem cair no legado', () => {
  const ctx = (f) => { const w = {}; vm.runInNewContext(ler(f), { window: w }); return w; };
  const menu = ctx('casca/menu.js').CASCA_MENU;
  const item = menu.find((g) => g.id === 'gRh').itens.find((i) => i.chave === 'pcartao');
  assert.ok(item); assert.equal(item.rotulo, 'Consulta de ponto'); assert.equal(item.origem, 'fabio'); assert.match(item.icone, /🕒|⏰|⏱|🕐/);
  assert.equal(menu.flatMap((g) => g.itens).filter((i) => i.chave === 'pcartao').length, 1);
  const pg = ctx('casca/paginas.js');
  assert.equal(pg.CASCA_PAGINAS.pcartao, 'pessoas/index.html#pcartao');
  assert.ok(pg.CASCA_TELAS_POR_LOJA.includes('pcartao'));
  const mods = ctx('casca/modulos.js').CASCA_MODULOS.find((m) => m.id === 'pessoas');
  const l = mods.lancar; assert.equal(l.filter((x) => x === 'pcartao').length, 1); assert.ok(Math.abs(l.indexOf('pcartao') - l.indexOf('phoje')) <= 1);
  const busca = ctx('casca/busca.js').CASCA_BUSCA.pcartao;
  assert.ok(busca && ['cartao', 'espelho', 'ponto'].every((t) => busca.some((s) => s.includes(t))));
  const html = ler('pessoas/index.html');
  assert.match(html, /id="modulo-pcartao"[^>]*><div id="view-pcartao">/);
  assert.match(html, /pcartao:\s*entrarPesPonto/);
  assert.match(html, /ponto-cartao-modelo\.js[^>]*>[\s\S]*ponto-cartao\.js/);
  assert.match(ler('sistema.html'), /SO_PESSOAL = new Set\(\[[^\]]*'pcartao'/);
  assert.equal(typeof PC.entrarPesPonto, 'function');
  assert.ok(!ler('pessoas/pessoas.js').includes('entrarPesPonto'), 'pessoas.js não deve conhecer a tela nova');
});

test('o código executável não usa caminhos proibidos (comentários não contam; nada some por apagar texto)', () => {
  const src = ler('pessoas/ponto-cartao.js').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '').replace(/\s\/\/ .*$/gm, '');
  for (const re of [/innerHTML|insertAdjacentHTML|outerHTML/, /localStorage|sessionStorage/, /\bfetch\s*\(/, /entrarCargos|\bCARGOS\b/, /service_role/, /method:\s*['"](POST|PATCH|PUT|DELETE)/i, /select=\*/])
    assert.ok(!re.test(src), String(re));
});
test('comportamento: a tela nunca aciona Cargos/folha/custos nem finanças', async () => {
  const boom = () => { throw new Error('acionou tela proibida'); };
  const nomes = ['entrarCargos', 'entrarPesCusto', 'entrarPesCalc', 'entrarPesAdm', 'entrarPesHoje', 'entrarFlashRh'];
  nomes.forEach((n) => { globalThis[n] = boom; });
  Object.defineProperty(globalThis, 'CARGOS', { get: boom, configurable: true });
  try { const t = mk(); await t.c.entrar(); assert.equal(t.c.st.fase, 'semregistros'); assert.ok(tabelas(t.log).every((c) => /^rh_(pessoa|flash_batida)\?/.test(c))); }
  finally { nomes.forEach((n) => { delete globalThis[n]; }); delete globalThis.CARGOS; }
});

// ---------- guardas ----------
for (const [nome, rpc, fase] of [['false', () => false, 'semacesso'], ['null', () => null, 'semacesso'], ['401', () => resp(null, 401), 'sessao'], ['403', () => resp(null, 403), 'erro'], ['rede cai', () => new Error('x'), 'erro']]) {
  test('guarda ' + nome + ': não lê tabela e não mostra lista', async () => {
    const t = mk({ rpc });
    await t.c.entrar();
    assert.equal(t.c.st.fase, fase); assert.deepEqual(tabelas(t.log), []); assert.equal(t.c.st.dados, null); assert.equal(tabelaTxt(t.raiz), '');
  });
}
test('uma só guarda false basta; as duas devem ser === true', async () => {
  const t = mk({ rpc: (fn) => fn === 'pode_cadastrar_pessoal' ? false : true });
  await t.c.entrar(); assert.equal(t.c.st.fase, 'semacesso'); assert.deepEqual(tabelas(t.log), []);
  const u = mk({ rpc: () => 'true' }); await u.c.entrar(); assert.equal(u.c.st.fase, 'semacesso');
});
test('a guarda roda a cada reentrada', async () => {
  const t = mk(); await t.c.entrar(); await t.c.entrar();
  assert.equal(t.log.filter((x) => x === 'rpc:pode_ver_pessoal').length, 2);
});

// ---------- período ----------
test('período: 31 dias aceita, 32 recusa, calendário e inversão recusados antes de ler dados', async () => {
  assert.ok(PC.validarIntervalo('2026-10-01', '2026-10-31').ok);
  assert.ok(!PC.validarIntervalo('2026-10-01', '2026-11-01').ok);
  assert.ok(PC.validarIntervalo('2024-02-01', '2024-02-29').ok);
  for (const [a, b] of [['2026-02-30', '2026-03-01'], ['2026-11-10', '2026-11-09'], ['10/11/2026', '2026-11-10'], ['', ''], [null, '2026-11-10']])
    assert.ok(!PC.validarIntervalo(a, b).ok, a + b);
  const t = mk(); t.c.st.de = '2026-02-30'; t.c.st.ate = '2026-03-01'; t.c.st.ativo = true; await t.c.carregar();
  assert.equal(t.c.st.fase, 'periodoinvalido'); assert.deepEqual(t.log, []);
});
test('datas extremas: anos 0000/0099/0100 e 9999 sem bypass dos 31 dias nem loop', () => {
  assert.ok(!PC.validarIntervalo('0099-01-01', '0100-12-31').ok);
  assert.ok(!PC.validarIntervalo('0000-01-01', '0000-01-02').ok);
  assert.ok(!PC.validarIntervalo('0001-01-01', '9999-12-31').ok);
  const curto = PC.validarIntervalo('0099-12-15', '0100-01-14'); assert.ok(curto.ok); assert.equal(curto.dias, 31);
  assert.ok(!PC.validarIntervalo('0099-12-15', '0100-01-15').ok);
  assert.deepEqual(PC.listarDias('0001-01-01', '0001-01-02'), ['0001-01-01', '0001-01-02']);
  assert.deepEqual(PC.listarDias('0099-12-31', '0100-01-01'), ['0099-12-31', '0100-01-01']);
  assert.deepEqual(PC.listarDias('9999-12-30', '9999-12-31'), ['9999-12-30', '9999-12-31']);
  assert.deepEqual(PC.listarDias('2024-02-28', '2024-03-01'), ['2024-02-28', '2024-02-29', '2024-03-01']);
  assert.deepEqual(PC.listarDias('9999-12-31', '0001-01-01'), []);
  assert.equal(PC.listarDias('2026-10-01', '2026-10-31').length, 31);
});
test('consultas: ordem estável, só colunas mínimas, sem limit nem select=*', () => {
  for (const c of [PC.PESSOAS_PATH, PC.batidasPath('2026-11-01', '2026-11-10')]) { assert.match(c, /order=/); assert.ok(!/limit=|select=\*/.test(c)); }
  assert.match(PC.batidasPath('2026-11-01', '2026-11-10'), /data=gte\.2026-11-01&data=lte\.2026-11-10/);
  assert.ok(!/salario|cpf|telefone/i.test(PC.PESSOAS_PATH));
});

// ---------- loja ----------
test('loja: só cadastros da loja; São Braz só pelas duas grafias explícitas', () => {
  const pessoas = [P({ id: 1, nome: 'Ahu', unidade: 'AHU', flash_id: 'A' }), P({ id: 2, nome: 'Verde', unidade: 'AGUA VERDE', flash_id: 'B' }), P({ id: 3, nome: 'Braz', unidade: 'SAO BRAZ', flash_id: 'C' }), P({ id: 4, nome: 'Sem', unidade: null, flash_id: 'D' }), P({ id: 5, nome: 'Ahu minusc', unidade: 'ahu', flash_id: 'E' })];
  const r = (loja, redeOk) => PC.cruzar({ pessoas, batidas: [], de: '2026-11-10', ate: '2026-11-10', loja, redeOk, consultadoEm: '2026-11-10T15:00:00Z' });
  assert.deepEqual(r('AHU').opcoes.map((x) => x.id), [1]);
  assert.deepEqual(r('SÃO BRAZ').opcoes.map((x) => x.id), [3]);
  assert.deepEqual(r('REDE', false).opcoes, []);               // REDE só se foi recebida
  assert.deepEqual(r('REDE', true).opcoes.map((x) => x.id), [1, 2, 3, 5]);   // sem unidade (id 4) fica fora até na REDE
  assert.equal(r('AHU').notas.semUnidade, 1);
});
test('cadastro sem unidade válida (ausente, vazia, tipo errado) não recebe horário, nem em REDE, nem pela batida', () => {
  for (const unidade of [undefined, null, '', '   ', 7, {}]) {
    const r = cruz([P({ unidade })], [B()], { loja: 'REDE', redeOk: true });
    assert.deepEqual(r.linhas, []); assert.deepEqual(r.opcoes, []); assert.equal(r.notas.semUnidade, 1);
    assert.equal(PC.lojaCombina(unidade, 'REDE', true), false);
  }
});
test('loja nula, vazia ou fora da lista: semloja, nada lido, nunca vira REDE', async () => {
  for (const o of [{ info: null }, { info: { lojas: [], travado: false } }, { loja: null }, { loja: 'REDE' }]) {
    const t = mk(o); await t.c.entrar();
    assert.equal(t.c.st.fase, 'semloja'); assert.deepEqual(tabelas(t.log), []);
  }
});

// ---------- cruzamento ----------
const cruz = (pessoas, batidas, extra) => PC.cruzar(Object.assign({ pessoas, batidas, de: '2026-11-10', ate: '2026-11-10', loja: 'AHU', redeOk: false, consultadoEm: '2026-11-10T15:00:00Z' }, extra));
test('sem linha de batida não vira 0 batidas nem horário', () => {
  const [l] = cruz([P()], []).linhas;
  assert.equal(l.chave, 'SEM_LEITURA'); assert.equal(l.n, null); assert.equal(l.entrada, null); assert.match(l.rotulo, /Sem leitura recebida/);
});
test('timestamp sem fuso é só reformatado, nunca convertido; lido_em com fuso mostrado à parte', () => {
  const [l] = cruz([P()], [B({ entrada: '2026-11-10T23:30:00', saida: '2026-11-11T00:10:00' })]).linhas;
  assert.equal(l.entrada, '10/11/2026 23:30'); assert.equal(l.saida, '11/11/2026 00:10');
  assert.equal(cruz([P()], [B({ saida: '2027-01-01T00:10:00' })]).linhas[0].saida, '01/01/2027 00:10'); assert.equal(l.chave, 'REGISTRADO_SEM_DETALHE'); assert.ok(l.lidoEm);
});
test('n_batidas desconhecido não vira 0; sem horários e contagem desconhecida é dado inválido', () => {
  const [l] = cruz([P()], [B({ entrada: null, saida: null, n_batidas: null })]).linhas;
  assert.equal(l.chave, 'DADOS_INVALIDOS'); assert.equal(l.nDesconhecido, true);
});
test('batidas duplicadas no dia: nenhum horário atribuído', () => {
  const [l] = cruz([P()], [B(), B({ entrada: '2026-11-10T09:00:00' })]).linhas;
  assert.equal(l.chave, 'DUPLICADA'); assert.equal(l.entrada, null);
});
test('flash_id repetido em cadastros com períodos sobrepostos: ambos ambíguos; períodos disjuntos: cada um no seu', () => {
  const sobrep = cruz([P({ id: 1 }), P({ id: 2, nome: 'Outra' })], [B()]).linhas;
  assert.deepEqual(sobrep.map((l) => l.chave), ['AMBIGUO_CADASTRO', 'AMBIGUO_CADASTRO']); assert.ok(sobrep.every((l) => l.entrada === null));
  const disj = cruz([P({ id: 1, desligamento: '2026-06-30' }), P({ id: 2, nome: 'Nova', admissao: '2026-07-01' })], [B()]).linhas;
  assert.deepEqual(disj.map((l) => [l.pessoaId, l.chave]), [[1, 'FORA_DO_VINCULO'], [2, 'REGISTRADO_SEM_DETALHE']]);
  const inval = cruz([P({ id: 1 }), P({ id: 2, nome: 'X', admissao: 'lixo' })], [B()]).linhas;
  assert.equal(inval[0].chave, 'AMBIGUO_CADASTRO'); assert.equal(inval[1].chave, 'VINCULO_NAO_CONFIRMADO');
});
test('id duplicado no cadastro é ambíguo; vínculo só por flash_id exato (nome igual não casa)', () => {
  assert.ok(cruz([P({ id: 1, flash_id: 'A' }), P({ id: 1, flash_id: 'B' })], []).linhas.every((l) => l.chave === 'AMBIGUO_CADASTRO'));
  const r = cruz([P({ flash_id: 'F1' })], [B({ flash_id: 'f1' })]);
  assert.equal(r.linhas[0].chave, 'SEM_LEITURA'); assert.equal(r.notas.batidasSemCadastro, 1);
});
test('admissão/desligamento: fora do vínculo sem atribuir; datas inválidas não atribuem; usa_ponto=false é só cadastro', () => {
  assert.equal(cruz([P({ admissao: '2026-11-11' })], [B()]).linhas[0].chave, 'FORA_DO_VINCULO');
  assert.equal(cruz([P({ desligamento: '2026-11-09' })], [B()]).linhas[0].chave, 'FORA_DO_VINCULO');
  assert.equal(cruz([P({ admissao: '2026-02-30' })], [B()]).linhas[0].chave, 'VINCULO_NAO_CONFIRMADO');
  const l = cruz([P({ usa_ponto: false })], [B()]).linhas[0]; assert.equal(l.chave, 'NAO_USA_PONTO'); assert.equal(l.entrada, null);
});

// ---------- tela ----------
test('nome malicioso aparece só como texto, nunca como HTML; nada pessoal além de nome/loja', async () => {
  const mal = '<img src=x onerror=alert(1)>‮';
  const t = mk({ consultar: (c) => (c.startsWith('rh_pessoa') ? [P({ nome: mal })] : [B()]) });
  await t.c.entrar();   // FEl.innerHTML lançaria
  assert.equal(t.c.st.fase, 'ok');
  assert.match(tabelaTxt(t.raiz), /<img src=x onerror=alert\(1\)>/);
  assert.ok(!tabelaTxt(t.raiz).includes('‮'));
  assert.ok(todos(t.raiz, (e) => e.tag === 'img').length === 0);
});
test('estados distintos: erro de tabela, 401, formato inesperado, sem cadastro, sem registros', async () => {
  const f = async (consultar) => { const t = mk({ consultar }); await t.c.entrar(); return t; };
  const e1 = await f(() => { throw new Error('Erro 500 ... corpo secreto'); });
  assert.equal(e1.c.st.fase, 'erro'); assert.ok(!e1.raiz.textContent.includes('corpo secreto')); assert.equal(e1.c.st.dados, null);
  assert.equal((await f(() => { throw new Error('sessão vencida'); })).c.st.fase, 'sessao');
  assert.equal((await f(() => ({ x: 1 }))).c.st.fase, 'dadosinvalidos');
  assert.equal((await f(() => [])).c.st.fase, 'semcadastro');
  const sr = await f((c) => (c.startsWith('rh_pessoa') ? [P()] : []));
  assert.equal(sr.c.st.fase, 'semregistros'); assert.match(tabelaTxt(sr.raiz), /Sem leitura recebida/);
});
test('última data: só aviso de escopo global; falha dela não derruba a consulta', async () => {
  const t = mk({ consultar: (c) => { if (c.includes('limit=1')) throw new Error('x'); return c.startsWith('rh_pessoa') ? [P()] : [B()]; } });
  await t.c.entrar(); assert.equal(t.c.st.fase, 'ok'); assert.match(t.raiz.textContent, /indisponível/);
  const u = mk({ consultar: (c) => (c.includes('limit=1') ? [{ data: '2026-11-05', lido_em: '2026-11-05T22:00:00-03:00' }] : c.startsWith('rh_pessoa') ? [P()] : []) });
  await u.c.entrar(); assert.match(u.raiz.textContent, /escopo global, não é cobertura fechada/);
});
test('mudança de loja limpa na hora; resposta atrasada da loja antiga é ignorada', async () => {
  let solta; const portao = new Promise((r) => { solta = r; }); let uma = false;
  const pessoas = [P({ id: 1, nome: 'Velha Loja', unidade: 'AGUA VERDE', flash_id: 'V' }), P({ id: 2, nome: 'Nova Loja', unidade: 'AHU', flash_id: 'N' })];
  const t = mk({ loja: 'AGUA VERDE', consultar: async (c) => { if (c.startsWith('rh_pessoa') && !uma) { uma = true; await portao; } return c.startsWith('rh_pessoa') ? pessoas : []; } });
  const p1 = t.c.entrar(); await settle();
  t.deps.escolherLoja('AHU');
  assert.equal(t.c.st.dados, null); assert.equal(t.c.st.pessoaSel, '');
  await settle(); assert.match(tabelaTxt(t.raiz), /Nova Loja/);
  solta(); await p1; await settle();
  assert.ok(!tabelaTxt(t.raiz).includes('Velha Loja')); assert.match(tabelaTxt(t.raiz), /Nova Loja/); assert.equal(t.c.st.loja, 'AHU');
});
test('pessoa escolhida incompatível com a nova loja volta a Todas', async () => {
  const t = mk({ consultar: (c) => (c.startsWith('rh_pessoa') ? [P({ id: 7, unidade: 'AHU' })] : []) });
  await t.c.entrar(); t.c.st.pessoaSel = '7';
  t.deps.escolherLoja('AGUA VERDE'); assert.equal(t.c.st.pessoaSel, ''); await settle();
  assert.equal(t.c.st.fase, 'semcadastro');
});
test('reentrada e logoff apagam dados antigos; logoff não mantém memória', async () => {
  const t = mk(); await t.c.entrar(); assert.match(tabelaTxt(t.raiz), /Ana Teste/);
  t.est.sess = null; await t.c.entrar();
  assert.equal(t.c.st.fase, 'sessao'); assert.equal(t.c.st.dados, null); assert.equal(tabelaTxt(t.raiz), '');
  t.est.sess = 'usuario-ficticio'; const p = t.c.entrar(); assert.equal(t.c.st.dados, null); await p; assert.equal(t.c.st.fase, 'semregistros');
});
test('sessão trocada durante a carga: resultado descartado', async () => {
  let solta; const portao = new Promise((r) => { solta = r; });
  const t = mk({ consultar: async (c) => { await portao; return c.startsWith('rh_pessoa') ? [P()] : []; } });
  const p = t.c.entrar(); await settle(); t.est.sess = 'outro-usuario'; solta(); await p;
  assert.equal(t.c.st.dados, null); assert.equal(t.c.st.fase, 'sessao');
});
const campos = (raiz) => todos(raiz, (e) => e.tag === 'input');
const digita = (inp, v) => { inp.value = v; inp.ev.input(); };
test('editar datas (eventos reais) com consulta pendente: resposta de 10/11 não aparece sob 01/11', async () => {
  let solta; const portao = new Promise((r) => { solta = r; });
  const t = mk({ consultar: async (c) => { if (c.startsWith('rh_flash_batida?select=data,flash') ) await portao; return c.startsWith('rh_pessoa') ? [P()] : []; } });
  const p = t.c.entrar(); await settle();
  assert.equal(t.c.st.fase, 'carregando');
  const [de, ate] = campos(t.raiz); digita(de, '2026-11-01'); digita(ate, '2026-11-01');
  assert.equal(t.c.st.fase, 'periodoalterado'); assert.match(t.raiz.textContent, /Período alterado\. Clique Atualizar\./);
  solta(); await p; await settle();
  assert.equal(t.c.st.dados, null); assert.equal(tabelaTxt(t.raiz), ''); assert.ok(!/Consulta conclu/.test(t.raiz.textContent));
  assert.equal(de.value, '2026-11-01');
});
test('editar datas depois de concluir apaga o quadro na hora; Atualizar busca o novo período', async () => {
  const t = mk({ consultar: (c) => (c.startsWith('rh_pessoa') ? [P()] : []) });
  await t.c.entrar(); assert.match(tabelaTxt(t.raiz), /10\/11\/2026/);
  const [de, ate] = campos(t.raiz); const antes = tabelas(t.log).length;
  digita(de, '2026-11-01'); digita(ate, '2026-11-02');
  assert.equal(tabelaTxt(t.raiz), ''); assert.equal(tabelas(t.log).length, antes);   // sem pedido a cada tecla
  const botao = todos(t.raiz, (e) => e.tag === 'button' && e.textContent === 'Atualizar')[0];
  botao.ev.click(); await settle();
  assert.equal(t.c.st.fase, 'semregistros'); assert.match(tabelaTxt(t.raiz), /01\/11\/2026/); assert.ok(!/10\/11\/2026/.test(tabelaTxt(t.raiz)));
  assert.ok(t.log.some((c) => c.includes('data=gte.2026-11-01&data=lte.2026-11-02')));
});
test('só consome fontes de leitura permitidas', async () => {
  const t = mk(); await t.c.entrar();
  assert.deepEqual(t.log.filter((x) => x.startsWith('rpc:')).sort(), ['rpc:pode_cadastrar_pessoal', 'rpc:pode_ver_pessoal']);
  assert.ok(tabelas(t.log).every((c) => /^rh_(pessoa|flash_batida)\?select=[a-z_,]+/.test(c)));
});
