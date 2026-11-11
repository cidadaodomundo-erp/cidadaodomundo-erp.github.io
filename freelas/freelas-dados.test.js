/* Regressões comportamentais da leitura (freelas-dados.js): URLs, paginação, 403 x 200[], descarte de resposta antiga.
 * Node stdlib: node --test freelas/ . Sem rede: o trFetch é um dublê que só registra o que seria pedido. */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const M = require('./freelas-modelo.js');
const D = require('./freelas-dados.js');

const resp = (status, body, o = {}) => ({
  status, ok: status >= 200 && status < 300,
  json: async () => { if (o.espera) await o.espera; if (o.jsonErro) throw new Error('json quebrado'); return body; }
});
const ct = (id, extra = {}) => ({ id, nome: 'Pessoa ' + String(id).padStart(5, '0'), setor: 'Cozinha', telefone: '1', tipo: 'Freela', ativo: true, loja: 'AHU', ...extra });
const ALLOW = { lojas: ['AGUA VERDE', 'AHU', 'SÃO BRAZ', 'REDE'], loja_inicial: 'AHU', travado: false };

function montar({ info = ALLOW, loja = 'AHU', handler = () => resp(200, []) } = {}) {
  const est = { loja, info, urls: [], metodos: [], vig: () => true };
  const dd = D.criar({
    modelo: M,
    trFetch: async (url, opts) => { est.urls.push(url); est.metodos.push(opts && opts.method); return handler(url, est.urls.length); },
    lojaCarregar: async () => est.info,
    lojaAtual: () => est.loja
  });
  return { est, dd, ler: (aba) => dd.ler(aba, () => est.vig()) };
}
const params = (url) => new URLSearchParams(url.split('?')[1]);
const lojasDoFiltro = (url) => { const v = params(url).get('loja'); assert.match(v, /^in\.\(.*\)$/); return v.slice(4, -1).split(',').map((x) => x.replace(/^"|"$/g, '')); };

test('URLs: só GET, só as duas tabelas, só as colunas permitidas, contato com ativo=eq.true', async () => {
  const t = montar();
  await t.ler('contatos'); await t.ler('valores');
  assert.equal(t.est.urls.length, 2);
  assert.ok(t.est.metodos.every((m) => m === 'GET'));
  const [c, v] = t.est.urls;
  assert.ok(c.startsWith('freela_contato?select=id,nome,setor,telefone,tipo,ativo,loja&ativo=eq.true&loja=in.'));
  assert.ok(v.startsWith('freela_valor_hora?select=loja,valor_hora,atualizado_em&loja=in.'));
  assert.equal(params(c).get('select'), 'id,nome,setor,telefone,tipo,ativo,loja');
  assert.equal(params(v).get('select'), 'loja,valor_hora,atualizado_em');
  assert.equal(params(c).get('limit'), '200'); assert.equal(params(c).get('offset'), '0');
  assert.ok(!params(v).has('ativo'));      // valor-hora não tem coluna ativo: não se inventa filtro
  t.est.urls.forEach((u) => {
    assert.ok(!/o_que_quer|telefone2|primeiro_contato|destaque|criado_em|rpc\/|\*/.test(decodeURIComponent(u)), u);
    assert.ok(/^(freela_contato|freela_valor_hora)\?/.test(u), u);
  });
});

test('filtro de loja no servidor: só a loja escolhida (e seus aliases); REDE = concretas da allowlist; nunca outra filial', async () => {
  const a = montar({ loja: 'SÃO BRAZ' });
  await a.ler('contatos');
  const l1 = lojasDoFiltro(a.est.urls[0]);
  assert.ok(l1.includes('SÃO BRAZ') && l1.includes('SAO BRAZ'));
  assert.ok(!l1.some((x) => /ahu|agua|rede|boqueir/i.test(x)), l1.join());
  const r = montar({ loja: 'REDE' });
  await r.ler('valores');
  const l2 = lojasDoFiltro(r.est.urls[0]);
  ['AGUA VERDE', 'AHU', 'SÃO BRAZ'].forEach((x) => assert.ok(l2.includes(x), x));
  assert.ok(!l2.some((x) => /^rede$/i.test(x) || /boqueir/i.test(x)), l2.join());
});

test('sem allowlist válida, sem loja cadastrada ou sem escolha: NENHUM pedido e mensagem própria (nunca lista total)', async () => {
  const falha = montar({ info: null });
  const r1 = await falha.ler('contatos');
  assert.deepEqual([r1.fase, r1.estado], ['aviso', 'falha_lojas']);
  const vazia = montar({ info: { lojas: [] }, loja: null });
  const r2 = await vazia.ler('contatos');
  assert.deepEqual([r2.fase, r2.estado], ['aviso', 'sem_loja']);
  assert.match(r2.mensagem, /pendente/);
  const fora = montar({ loja: 'BOQUEIRAO' });
  const r3 = await fora.ler('valores');
  assert.deepEqual([r3.fase, r3.estado], ['aviso', 'sem_escolha']);
  const soRede = montar({ info: { lojas: ['REDE'] }, loja: 'REDE' });
  assert.equal((await soRede.ler('contatos')).estado, 'sem_loja');
  [falha, vazia, fora, soRede].forEach((t) => assert.equal(t.est.urls.length, 0));
  const lanca = D.criar({ modelo: M, trFetch: async () => { throw new Error('nao deveria'); }, lojaCarregar: async () => { throw new Error('x'); }, lojaAtual: () => 'AHU' });
  assert.equal((await lanca.ler('contatos', () => true)).estado, 'falha_lojas');
});

test('403 = consulta não liberada (sem linhas); 200 [] = sem registros; 500/rede = falha. Os três são diferentes', async () => {
  const t403 = montar({ handler: () => resp(403, { message: 'permission denied' }) });
  const a = await t403.ler('contatos');
  assert.equal(a.fase, 'pronto'); assert.equal(a.resultado.estado, 'naoliberada'); assert.deepEqual(a.resultado.linhas, []);
  const vazio = montar({ handler: () => resp(200, []) });
  const b = await vazio.ler('contatos');
  assert.equal(b.resultado.estado, 'ok'); assert.deepEqual(b.resultado.linhas, []); assert.deepEqual(b.resultado.lojas, ['AHU']);
  const t500 = montar({ handler: () => resp(500, {}) });
  assert.equal((await t500.ler('valores')).resultado.estado, 'falha');
  const rede = montar({ handler: () => { throw new Error('offline'); } });
  assert.equal((await rede.ler('valores')).resultado.estado, 'falha');
  const naoLista = montar({ handler: () => resp(200, { message: 'erro' }) });
  assert.equal((await naoLista.ler('contatos')).resultado.estado, 'falha');
  const jsonRuim = montar({ handler: () => resp(200, [], { jsonErro: true }) });
  assert.equal((await jsonRuim.ler('contatos')).resultado.estado, 'falha');
});

test('401 depois da renovação do núcleo vira fase "sessao"; nada é entregue', async () => {
  const t = montar({ handler: () => resp(401, {}) });
  const r = await t.ler('contatos');
  assert.equal(r.fase, 'sessao'); assert.equal(r.resultado, undefined);
});

test('dados intrusos do servidor (outra filial, loja nula, inativo) nunca chegam ao resultado', async () => {
  const t = montar({ handler: () => resp(200, [
    ct(1), ct(2, { loja: 'SÃO BRAZ', nome: 'INTRUSO-SB' }), ct(3, { loja: null, nome: 'INTRUSO-NULA' }), ct(4, { ativo: false, nome: 'INTRUSO-INATIVO' }),
    ct(5, { loja: 'Boqueirão', nome: 'INTRUSO-BOQ', o_que_quer: 'SEGREDO' })
  ]) });
  const r = await t.ler('contatos');
  assert.deepEqual(r.resultado.linhas.map((l) => l.id), ['1']);
  assert.ok(!JSON.stringify(r).match(/INTRUSO|SEGREDO/));
  assert.equal(r.resultado.avisos.semLoja, 1);
  const v = montar({ handler: () => resp(200, [{ loja: 'AHU', valor_hora: 10, atualizado_em: '2026-11-10' }, { loja: 'SÃO BRAZ', valor_hora: 77, atualizado_em: '2026-11-10' }, { loja: null, valor_hora: 88, atualizado_em: null }]) });
  const rv = await v.ler('valores');
  assert.deepEqual(rv.resultado.linhas.map((l) => l.valor), [10]);
});

test('paginação: de 200 em 200 até a página curta; última página cheia no teto = lista PARCIAL', async () => {
  const lote = (ini, n) => Array.from({ length: n }, (_, i) => ct(ini + i));
  const t = montar({ handler: (url, n) => resp(200, n === 1 ? lote(1, 200) : lote(201, 30)) });
  const r = await t.ler('contatos');
  assert.equal(r.resultado.estado, 'ok'); assert.equal(r.resultado.linhas.length, 230);
  assert.deepEqual(t.est.urls.map((u) => params(u).get('offset')), ['0', '200']);
  const cheio = montar({ handler: (url, n) => resp(200, lote((n - 1) * 200 + 1, 200)) });
  const p = await cheio.ler('contatos');
  assert.equal(p.resultado.estado, 'parcial');
  assert.equal(cheio.est.urls.length, M.MAX_PAGINAS);
  assert.equal(p.resultado.linhas.length, 200 * M.MAX_PAGINAS);
});

test('erro no meio da paginação descarta tudo: nunca mostra lista incompleta como completa', async () => {
  const t = montar({ handler: (url, n) => (n === 1 ? resp(200, Array.from({ length: 200 }, (_, i) => ct(i + 1))) : resp(500, {})) });
  const r = await t.ler('contatos');
  assert.equal(r.resultado.estado, 'falha'); assert.deepEqual(r.resultado.linhas, []);
  const t2 = montar({ handler: (url, n) => (n === 1 ? resp(200, Array.from({ length: 200 }, (_, i) => ct(i + 1))) : resp(403, {})) });
  assert.equal((await t2.ler('contatos')).resultado.estado, 'naoliberada');
});

test('resposta antiga é descartada: sessão/geração trocada antes do GET, depois do fetch e depois do r.json()', async () => {
  // antes do primeiro GET
  const a = montar(); a.est.vig = () => false;
  assert.equal((await a.ler('contatos')).fase, 'descartado'); assert.equal(a.est.urls.length, 0);
  // depois do fetch (vigência cai enquanto o GET está no ar)
  let d1; const p1 = new Promise((r) => { d1 = r; });
  const b = montar({ handler: () => p1 });
  const rb = b.ler('contatos');
  await new Promise((r) => setImmediate(r));
  b.est.vig = () => false; d1(resp(200, [ct(1)]));
  assert.equal((await rb).fase, 'descartado');
  // depois do r.json(): erro e sucesso antigos somem
  for (const o of [{}, { jsonErro: true }]) {
    let dj; const pj = new Promise((r) => { dj = r; });
    const c = montar({ handler: () => resp(200, [ct(1)], { ...o, espera: pj }) });
    const rc = c.ler('contatos');
    await new Promise((r) => setImmediate(r));
    c.est.vig = () => false; dj();
    assert.equal((await rc).fase, 'descartado', JSON.stringify(o));
  }
  // exceção do fetch depois que a leitura perdeu a vez: também descartada
  let dr; const pr = new Promise((_, rej) => { dr = rej; });
  const e = montar({ handler: () => pr });
  const re = e.ler('contatos');
  await new Promise((r) => setImmediate(r));
  e.est.vig = () => false; dr(new Error('offline'));
  assert.equal((await re).fase, 'descartado');
});

test('trocar a loja no meio da leitura descarta o resultado da loja anterior', async () => {
  let d1; const p1 = new Promise((r) => { d1 = r; });
  const t = montar({ handler: () => p1 });
  const r = t.ler('contatos');
  await new Promise((x) => setImmediate(x));
  t.est.loja = 'SÃO BRAZ'; d1(resp(200, [ct(1)]));
  assert.equal((await r).fase, 'descartado');
  // conta/loja trocada durante o carregamento da allowlist: nenhum GET sai
  let dl; const pl = new Promise((x) => { dl = x; });
  const pedidos = [];
  let loja = 'AHU';
  const t3 = D.criar({ modelo: M, trFetch: async (u) => { pedidos.push(u); return resp(200, []); }, lojaCarregar: () => pl, lojaAtual: () => loja });
  const r3 = t3.ler('contatos', () => loja === 'AHU');         // a página só aceita o resultado da loja com que começou
  loja = 'SÃO BRAZ'; dl(ALLOW);
  assert.equal((await r3).fase, 'descartado');
  assert.deepEqual(pedidos, []);
});

test('aba desconhecida não consulta nada', async () => {
  const t = montar();
  assert.equal((await t.ler('pagamentos')).fase, 'aviso');
  assert.equal(t.est.urls.length, 0);
});
