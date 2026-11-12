// node --test supabase/functions/fabio-ponto-leitura/   (módulo REAL; fetch, relógio, cache e banco são ficções; nenhum dado real)
import test from 'node:test';
import assert from 'node:assert/strict';
import * as L from './leitura.mjs';

const JWT = 'aaa.bbb.ccc', CHAVE = 'SEGREDO-TESTE-FLASH', ANON = 'anon-key-ficticia';
const AGORA = Date.parse('2026-11-12T21:00:00Z');           // 18:00 em Brasília
const MADRUGADA = Date.parse('2026-11-13T04:30:00Z');       // 01:30 em Brasília
const DIA = '2026-11-12';
const R = (corpo, status = 200) => ({ ok: status < 400, status, json: async () => corpo });
const A = (time, o) => Object.assign({ time, attendanceStatus: 'ScheduledTime', approvalStatus: 'Approved', followingDay: false }, o);

const PESSOAS = [
  { id: 1, nome: 'Ana Teste', unidade: 'AGUA VERDE', admissao: '2020-01-01', desligamento: null, flash_id: 'E1', usa_ponto: true, cargo_confianca: false },
  { id: 2, nome: 'Bia Souza', unidade: 'AGUA VERDE', admissao: '2020-01-01', desligamento: null, flash_id: 'E2', usa_ponto: true, cargo_confianca: false },
  { id: 3, nome: 'Caio Lima', unidade: 'AHU', admissao: '2020-01-01', desligamento: null, flash_id: 'E3', usa_ponto: true, cargo_confianca: false },
];
const FLASH_AV = L.EMPRESAS['AGUA VERDE'], FLASH_AHU = L.EMPRESAS['AHU'];
const flashDia = (dia, extra = []) => ({ data: [
  { date: dia, employeeId: 'E1', documentNumber: '123.456', pis: '99999', attendances: [A(dia + 'T08:00:00'), A(dia + 'T12:00:00'), A(dia + 'T13:00:00'), A(dia + 'T17:00:00')] },
  { date: dia, employeeId: 'E2', attendances: [A(dia + 'T09:00:00')] },
  { date: dia, employeeId: 'E9', attendances: [A(dia + 'T09:30:00')] },
].concat(extra) });
const VENDAS = [
  { id_sale: 1, shift_date: DIA, unidade: 'AGUA VERDE', comanda_id: 153854, nome_venda: 'FUNC', cliente_nome: 'x', cancelada: false, hora_venda: '12:10:00' },
  { id_sale: 2, shift_date: DIA, unidade: 'AGUA VERDE', comanda_id: 777, nome_venda: 'Almoço do Bia', cliente_nome: 'bia', cancelada: false, hora_venda: '13:00:00' },
  { id_sale: 3, shift_date: DIA, unidade: 'AGUA VERDE', comanda_id: 153854, nome_venda: 'x', cliente_nome: '', cancelada: true, hora_venda: '14:00:00' },
  { id_sale: 4, shift_date: DIA, unidade: 'AGUA VERDE', comanda_id: 555, nome_venda: 'mesa 4', cliente_nome: '', cancelada: false, hora_venda: '15:00:00' },
];
const IT = (o) => Object.assign({ id_sale: 1, id_sale_item: 1, shift_date: DIA, unidade: 'AGUA VERDE', produto: 'QUINTA - ALMOCO FUNCIONARIOS', quantidade: 1, preco_unit: 0, deletado: false, observacao: 'segredo obs' }, o);
const ITENS = [IT({}), IT({ id_sale: 2, id_sale_item: 2, produto: 'ALMOÇO FUNCIONÁRIO', quantidade: 2 }), IT({ id_sale_item: 3, preco_unit: 5 }), IT({ id_sale_item: 4, deletado: true }),
  IT({ id_sale: 3, id_sale_item: 5 }), IT({ id_sale: 4, id_sale_item: 6, produto: 'LANCHE FUNCIONARIO' }), IT({ id_sale_item: 7, produto: 'COCA 350' })];
const VINC = [
  { unidade: 'AGUA VERDE', tipo: 'CARTAO', chave: '153854', nome: 'Ana Teste', valido_desde: '2026-01-01' },
  { unidade: 'AGUA VERDE', tipo: 'APELIDO', chave: 'Bia', nome: 'BIA SOUZA', valido_desde: '2026-01-01' },
];

function mkFetch(o = {}) {
  const chamadas = [];
  const fetchImpl = async (url, init = {}) => {
    const u = new URL(url); const p = u.pathname; const h = init.headers || {};
    chamadas.push({ url, host: u.host, path: p, headers: h, method: init.method || 'GET', q: u.searchParams });
    if (u.host === 'api.flashapp.services') {
      if (o.flash) return o.flash(u.searchParams.get('companyId'), u.searchParams.get('date'));
      return R(flashDia(u.searchParams.get('date')));
    }
    if (p === '/auth/v1/user') return o.auth || R({ id: 'u1', email: 'x@y.z' });
    if (p === '/rest/v1/rpc/pode_ver_pessoal') return R(o.ver === undefined ? true : o.ver);
    if (p === '/rest/v1/rpc/pode_cadastrar_pessoal') return R(o.cad === undefined ? true : o.cad);
    if (p === '/rest/v1/rpc/painel_minhas_lojas') return R(o.painel === undefined ? [{ lojas: ['AGUA VERDE', 'AHU'], loja_inicial: 'AGUA VERDE', travado: false }] : o.painel);   // formato real: RETURNS TABLE => array de 1 linha
    const tabela = { '/rest/v1/rh_pessoa': o.pessoas || PESSOAS, '/rest/v1/vendas_saipos': o.vendas || VENDAS, '/rest/v1/saipos_itens_venda': o.itens || ITENS }[p];
    if (tabela !== undefined) {
      if (o.rest) { const x = o.rest(p); if (x) return x; }
      const sd = u.searchParams.get('shift_date');
      const linhas = sd ? tabela.filter((r) => 'eq.' + r.shift_date === sd) : tabela;
      const lim = Number(u.searchParams.get('limit')), off = Number(u.searchParams.get('offset'));
      return R(linhas.slice(off, off + lim));
    }
    throw new Error('rota inesperada ' + p);
  };
  return { fetchImpl, chamadas };
}
function ctx(o = {}, f = mkFetch(o)) {
  return Object.assign({
    metodo: 'GET', authorization: 'Bearer ' + JWT, query: { dia: DIA, unidade: 'AGUA VERDE' },
    env: { supabaseUrl: 'https://x.supabase.co', anonKey: ANON }, fetchImpl: f.fetchImpl, agora: () => AGORA, cache: L.criarCache({ agora: () => AGORA }),
    obterChaveFlash: async () => CHAVE, obterVinculos: async () => VINC, timeoutMs: 1000, _f: f,
  }, o.ctx || {});
}
const rodar = async (o = {}) => { const c = ctx(o); const r = await L.responder(c); return Object.assign(r, { f: c._f }); };
const flashCalls = (f) => f.chamadas.filter((c) => c.host === 'api.flashapp.services');

// ---------- Flash: conversão ----------
test('converterDia: times sem fuso, ordem cronológica e followingDay SÓ soma 1 dia quando o time ainda tem a data do dia', () => {
  const j = { data: [{ date: DIA, employeeId: 'E1', attendances: [
    A('2026-11-12T22:00:00'), A('2026-11-12T02:10:00', { followingDay: true }), A('2026-11-13T03:00:00', { followingDay: true }), A('2026-11-12T18:00:00')] }] };
  const r = L.converterDia(j, DIA);
  assert.deepEqual(r.funcionarios, [{ flash_id: 'E1', horarios: ['2026-11-12T18:00:00', '2026-11-12T22:00:00', '2026-11-13T02:10:00', '2026-11-13T03:00:00'] }]);
});
test('converterDia: descarta e CONTA (não entrega meia lista) funcionário com batida ilegível, de outro dia, id repetido ou sem lista', () => {
  const j = { data: [
    { date: DIA, employeeId: 'ok', attendances: [A(DIA + 'T08:00:00')] },
    { date: DIA, employeeId: 'ruim', attendances: [A(DIA + 'T08:00:00'), A('lixo')] },
    { date: DIA, employeeId: 'longe', attendances: [A('2026-11-14T08:00:00')] },
    { date: DIA, employeeId: 'rep', attendances: [A(DIA + 'T08:00:00')] }, { date: DIA, employeeId: 'rep', attendances: [A(DIA + 'T09:00:00')] },
    { date: DIA, employeeId: 'semlista' }, { date: '2026-11-11', employeeId: 'outrodia', attendances: [] }, 'x',
    { date: DIA, employeeId: 'hora', attendances: [A(DIA + 'T25:00:00')] },
  ] };
  const r = L.converterDia(j, DIA);
  assert.deepEqual(r.funcionarios.map((f) => f.flash_id), ['ok']);
  assert.deepEqual(r.descartes, { invalidos: 5, duplicados: 1, foraDoDia: 1, naoAprovadas: 0 });
});
test('converterDia: aprovação diferente de Approved é contada; formato inesperado vira erro', () => {
  assert.equal(L.converterDia({ data: [{ employeeId: 'E1', attendances: [A(DIA + 'T08:00:00', { approvalStatus: 'Pending' })] }] }, DIA).descartes.naoAprovadas, 1);
  for (const j of [null, {}, { data: 'x' }, []]) assert.throws(() => L.converterDia(j, DIA), (e) => e.codigo === 'flash_formato' && e.status === 502);
});
test('montarBatidas: n=1 sem saída; n>=2 saída = última; só cadastro permitido; sem campos extras', () => {
  const f = [{ flash_id: 'E1', horarios: [DIA + 'T08:00:00'] }, { flash_id: 'E2', horarios: [DIA + 'T08:00:00', DIA + 'T12:00:00', DIA + 'T13:00:00'] }, { flash_id: 'E9', horarios: [DIA + 'T08:00:00'] }, { flash_id: 'E4', horarios: [] }];
  const r = L.montarBatidas(f, new Set(['E1', 'E2', 'E4']), DIA, '2026-11-12T20:59:00.000Z');
  assert.equal(r.semCadastro, 1); assert.equal(r.linhas.length, 2);
  assert.deepEqual(r.linhas[0], { data: DIA, flash_id: 'E1', entrada: DIA + 'T08:00:00', saida: null, n_batidas: 1, horarios: [DIA + 'T08:00:00'], lido_em: '2026-11-12T20:59:00.000Z' });
  assert.equal(r.linhas[1].saida, DIA + 'T13:00:00'); assert.equal(r.linhas[1].n_batidas, 3);
  assert.deepEqual(Object.keys(r.linhas[1]).sort(), ['data', 'entrada', 'flash_id', 'horarios', 'lido_em', 'n_batidas', 'saida']);
});

// ---------- autenticação e autorização ----------
test('sem Bearer, Bearer estranho ou método errado: nada é consultado', async () => {
  for (const authorization of [undefined, '', 'Bearer', 'Basic abc', 'Bearer sem-pontos', 'Bearer ' + 'a.b.' + 'c'.repeat(5000)]) {
    const r = await rodar({ ctx: { authorization } }); assert.equal(r.status, 401, String(authorization)); assert.equal(r.f.chamadas.length, 0);
  }
  const p = await rodar({ ctx: { metodo: 'POST' } }); assert.equal(p.status, 405); assert.equal(p.f.chamadas.length, 0);
});
test('JWT recusado pelo /auth/v1/user: 401 e nenhuma leitura de dado', async () => {
  const r = await rodar({ auth: R({ msg: 'bad' }, 401) });
  assert.equal(r.status, 401); assert.deepEqual(r.corpo, { erro: 'nao_autenticado' });
  assert.deepEqual(r.f.chamadas.map((c) => c.path), ['/auth/v1/user']);
});
test('auth fora do ar: 502 (não libera)', async () => { assert.equal((await rodar({ auth: R({}, 500) })).status, 502); });
test('exige pode_ver_pessoal E pode_cadastrar_pessoal === true; qualquer outra coisa é 403 sem ler pessoa/Flash/Saipos', async () => {
  for (const [ver, cad] of [[false, true], [true, false], [null, true], [true, 'true'], [{}, true], [1, 1]]) {
    const r = await rodar({ ver, cad });
    assert.equal(r.status, 403, JSON.stringify([ver, cad]));
    assert.ok(r.f.chamadas.every((c) => c.path.startsWith('/auth/') || c.path.includes('/rpc/')));
  }
});
test('painel_minhas_lojas real (array de 1 linha): autoriza só as lojas da linha; REDE só se estiver nela', async () => {
  const linha = (lojas) => [{ lojas, loja_inicial: lojas[0] || null, travado: false }];
  assert.equal((await rodar({ painel: linha(['AGUA VERDE']) })).status, 200);
  assert.equal((await rodar({ painel: linha(['AHU']) })).status, 403, 'unidade fora da linha');
  assert.equal((await rodar({ painel: linha(['REDE', 'AGUA VERDE']), ctx: { query: { dia: DIA, unidade: 'REDE' } } })).status, 200);
  assert.equal((await rodar({ painel: linha(['AGUA VERDE']), ctx: { query: { dia: DIA, unidade: 'REDE' } } })).status, 403);
  assert.equal((await rodar({ painel: { lojas: ['AGUA VERDE'], loja_inicial: 'AGUA VERDE', travado: true } })).status, 200, 'objeto válido segue aceito (compatibilidade)');
});
test('painel_minhas_lojas: array com 0 ou 2+ linhas, linha sem lojas, lojas fora de text[] ou tipo errado = 403', async () => {
  const ok = { lojas: ['AGUA VERDE'], loja_inicial: 'AGUA VERDE', travado: false };
  for (const painel of [[], [ok, ok], [{}], [{ lojas: 'AGUA VERDE' }], [{ lojas: ['AGUA VERDE', 7] }], [null], ['AGUA VERDE'], [[ok]], null, 'AGUA VERDE', 7, { lojas: [1] }]) {
    const r = await rodar({ painel }); assert.equal(r.status, 403, JSON.stringify(painel));
    assert.ok(!r.f.chamadas.some((x) => x.host === 'api.flashapp.services' || x.path.endsWith('/rh_pessoa')));
  }
});
test('painel_minhas_lojas inválido, unidade fora da lista ou REDE sem permissão: 403; unidade inexistente: 400', async () => {
  assert.equal((await rodar({ painel: [] })).status, 403);
  assert.equal((await rodar({ painel: { lojas: 'AGUA VERDE' } })).status, 403);
  assert.equal((await rodar({ painel: { lojas: ['AHU'] } })).status, 403);
  assert.equal((await rodar({ ctx: { query: { dia: DIA, unidade: 'REDE' } } })).status, 403);
  assert.equal((await rodar({ ctx: { query: { dia: DIA, unidade: 'OUTRA' } } })).status, 400);
  assert.equal((await rodar({ ctx: { query: { dia: DIA } } })).status, 400);
});
test('REDE só com REDE na lista: expande para as lojas reais da lista (e nenhuma além)', async () => {
  const r = await rodar({ painel: { lojas: ['REDE', 'AGUA VERDE', 'AHU'] }, ctx: { query: { dia: DIA, unidade: 'REDE' } } });
  assert.equal(r.status, 200); assert.deepEqual(r.corpo.unidades, ['AGUA VERDE', 'AHU']); assert.equal(r.corpo.unidade, 'REDE');
  assert.deepEqual(flashCalls(r.f).map((c) => c.q.get('companyId')).sort(), [FLASH_AHU, FLASH_AV].sort());
  const so = await rodar({ painel: { lojas: ['REDE', 'AHU'] }, ctx: { query: { dia: DIA, unidade: 'REDE' } } });
  assert.deepEqual(so.corpo.unidades, ['AHU']); assert.deepEqual(flashCalls(so.f).map((c) => c.q.get('companyId')), [FLASH_AHU]);
});
test('SÃO BRAZ com acento ou sem: mesma empresa', async () => {
  const r = await rodar({ painel: { lojas: ['SÃO BRAZ'] }, ctx: { query: { dia: DIA, unidade: 'SAO BRAZ' } } });
  assert.equal(r.status, 200); assert.deepEqual(flashCalls(r.f).map((c) => c.q.get('companyId')), [L.EMPRESAS['SAO BRAZ']]);
  assert.ok(r.f.chamadas.some((c) => c.path.endsWith('/rh_pessoa') && c.q.get('unidade') === 'in.("SAO BRAZ","SÃO BRAZ")'));
});
test('dia: formato, calendário, futuro e fora dos últimos 7 dias são 400; hoje e 6 dias atrás passam', async () => {
  for (const dia of ['12/11/2026', '2026-02-30', '2026-11-13', '2026-11-05', '', undefined]) assert.equal((await rodar({ ctx: { query: { dia, unidade: 'AGUA VERDE' } } })).status, 400, String(dia));
  for (const dia of ['2026-11-12', '2026-11-06']) assert.equal((await rodar({ ctx: { query: { dia, unidade: 'AGUA VERDE' } } })).status, 200, dia);
});

// ---------- caminho feliz, chaves e privacidade ----------
test('resposta: contrato, só quem tem cadastro, nenhum dado proibido; Flash com x-flash-auth, REST com o JWT do chamador', async () => {
  const r = await rodar();
  assert.equal(r.status, 200);
  const c = r.corpo;
  assert.equal(c.fonte, 'Flash — leitura direta'); assert.equal(c.dia, DIA);
  assert.deepEqual(c.batidas.map((b) => b.flash_id), ['E1', 'E2']);
  assert.equal(c.batidas[0].n_batidas, 4); assert.equal(c.batidas[0].saida, DIA + 'T17:00:00'); assert.equal(c.batidas[1].saida, null);
  assert.deepEqual(c.pessoas.map((p) => p.id), [1, 2], 'pessoa de outra loja não vem');
  assert.deepEqual(Object.keys(c.pessoas[0]).sort(), ['admissao', 'cargo_confianca', 'desligamento', 'flash_id', 'id', 'nome', 'unidade', 'usa_ponto']);
  assert.deepEqual(c.anterior, { pedido: false, ok: false }); assert.deepEqual(c.batidasAnterior, []);
  assert.equal(c.consultadoEm, new Date(AGORA).toISOString());
  const texto = JSON.stringify(c);
  for (const proibido of [CHAVE, ANON, JWT, 'documentNumber', '123.456', 'pis', '99999', 'E9', 'segredo obs', 'nome_venda', 'cliente', 'observacao', 'id_sale', 'x@y.z'])
    assert.ok(!texto.includes(proibido), 'vazou: ' + proibido);
  const fl = flashCalls(r.f); assert.equal(fl.length, 1);
  assert.equal(fl[0].headers['x-flash-auth'], CHAVE); assert.ok(!('Authorization' in fl[0].headers) && !('authorization' in fl[0].headers));
  assert.equal(fl[0].q.get('date'), DIA); assert.equal(fl[0].path, '/time-and-attendance/v1/attendance/day');
  const rest = r.f.chamadas.filter((x) => x.path.startsWith('/rest/v1/'));
  assert.ok(rest.length >= 5 && rest.every((x) => x.headers.Authorization === 'Bearer ' + JWT && x.headers.apikey === ANON), 'REST sempre com o JWT do chamador (RLS vale)');
  assert.ok(r.f.chamadas.every((x) => x.method === 'GET' || x.path.includes('/rpc/')), 'nenhuma escrita');
});
test('leituras REST pedem o mínimo: unidade, dia, vigência e ordem estável', async () => {
  const r = await rodar();
  const pes = r.f.chamadas.find((x) => x.path.endsWith('/rh_pessoa'));
  assert.equal(pes.q.get('select'), 'id,nome,unidade,admissao,desligamento,flash_id,usa_ponto,cargo_confianca');
  assert.equal(pes.q.get('unidade'), 'in.("AGUA VERDE")'); assert.equal(pes.q.get('admissao'), 'lte.' + DIA); assert.equal(pes.q.get('or'), '(desligamento.is.null,desligamento.gte.2026-11-11)');
  const it = r.f.chamadas.find((x) => x.path.endsWith('/saipos_itens_venda'));
  assert.equal(it.q.get('shift_date'), 'eq.' + DIA); assert.equal(it.q.get('preco_unit'), 'eq.0'); assert.equal(it.q.get('deletado'), 'not.is.true');
  assert.ok(!it.q.get('select').includes('*'));
  const ve = r.f.chamadas.find((x) => x.path.endsWith('/vendas_saipos'));
  assert.equal(ve.q.get('cancelada'), 'not.is.true');
});

// ---------- falhas do Flash ----------
test('Flash fora do ar, formato ruim ou segredo ausente: erro explícito, sem fallback e sem vazar nada', async () => {
  for (const [o, status, erro] of [[{ flash: () => R({}, 500) }, 502, 'flash_indisponivel'], [{ flash: () => { throw new Error('rede ' + CHAVE); } }, 502, 'flash_indisponivel'],
    [{ flash: () => R({ x: 1 }) }, 502, 'flash_formato'], [{ ctx: { obterChaveFlash: async () => null } }, 502, 'config_indisponivel'], [{ ctx: { obterChaveFlash: async () => { throw new Error(CHAVE); } } }, 502, 'config_indisponivel']]) {
    const r = await rodar(o);
    assert.equal(r.status, status); assert.deepEqual(r.corpo, { erro });
    assert.ok(!JSON.stringify(r.corpo).includes(CHAVE));
    assert.ok(!r.f.chamadas.some((x) => /rh_flash_batida/.test(x.path)), 'nunca lê a tabela em lote como se fosse ao vivo');
  }
});
test('timeout: leitura que nunca responde vira 502 (AbortController)', async () => {
  const f = mkFetch({ flash: () => new Promise(() => {}) });
  const fetchImpl = (url, init) => (new URL(url).host === 'api.flashapp.services' ? new Promise((_, rej) => init.signal.addEventListener('abort', () => rej(new Error('abort')))) : f.fetchImpl(url, init));
  const c = ctx({}, { fetchImpl, chamadas: [] }); c.timeoutMs = 30;
  const r = await L.responder(c);
  assert.equal(r.status, 502); assert.equal(r.corpo.erro, 'flash_indisponivel');
});

// ---------- madrugada / virada ----------
const noAgora = (iso) => ({ agora: () => Date.parse(iso), cache: L.criarCache({ agora: () => Date.parse(iso) }) });
test('madrugada: um único dia lido (o operacional); não existe mais leitura de "ontem" separada', async () => {
  const r = await rodar({ ctx: Object.assign({ query: { dia: '2026-11-12', unidade: 'AGUA VERDE' } }, noAgora('2026-11-13T07:00:00Z')) });   // 04:00 BRT
  assert.equal(r.status, 200); assert.deepEqual(r.corpo.anterior, { pedido: false, ok: false }); assert.deepEqual(r.corpo.batidasAnterior, []);
  assert.deepEqual(flashCalls(r.f).map((c) => c.q.get('date')), ['2026-11-12']); assert.equal(r.corpo.diaOperacional, '2026-11-12');
});
test('dia operacional é o teto e a base dos 7 dias: antes das 07h o dia civil atual é futuro (400); às 07h passa; base op-6', async () => {
  const at = (iso, dia) => rodar({ ctx: Object.assign({ query: { dia, unidade: 'AGUA VERDE' } }, noAgora(iso)) });
  const fut = await at('2026-11-13T07:00:00Z', '2026-11-13');   // 04:00 BRT, operacional 12/11
  assert.equal(fut.status, 400); assert.deepEqual(fut.corpo, { erro: 'dia_fora_da_janela' }); assert.ok(!fut.f.chamadas.some((x) => x.host === 'api.flashapp.services' || x.path.endsWith('/rh_pessoa')), 'rejeitado antes de ler dados');
  assert.equal((await at('2026-11-13T05:59:00Z', '2026-11-13')).status, 400);   // 02:59
  assert.equal((await at('2026-11-13T09:59:00Z', '2026-11-13')).status, 400);   // 06:59
  assert.equal((await at('2026-11-13T10:00:00Z', '2026-11-13')).status, 200);   // 07:00
  assert.equal((await at('2026-11-13T07:00:00Z', '2026-11-06')).status, 200);   // op-6
  assert.equal((await at('2026-11-13T07:00:00Z', '2026-11-05')).status, 400);   // op-7
});
test('jornada: 04h civil 13/11, operacional 12/11, conferida em 13/11 = ACEITA (frescor contra o dia civil)', async () => {
  let chamou = 0;
  const j = [{ unidade: 'AGUA VERDE', nome: 'Ana Teste', entrada: '08:00', saida: '22:00', conferido_em: '2026-11-13' }];
  const r = await rodar({ ctx: Object.assign({ query: { dia: '2026-11-12', unidade: 'AGUA VERDE' }, obterJornadas: async () => { chamou++; return j; } }, noAgora('2026-11-13T07:00:00Z')) });
  assert.equal(chamou, 1); assert.deepEqual(r.corpo.jornadas, { 1: { entrada: '08:00', saida: '22:00', conferidoEm: '2026-11-13' } });
  const velha = await rodar({ ctx: Object.assign({ query: { dia: '2026-11-12', unidade: 'AGUA VERDE' }, obterJornadas: async () => [Object.assign({}, j[0], { conferido_em: '2026-11-05' })] }, noAgora('2026-11-13T07:00:00Z')) });
  assert.deepEqual(velha.corpo.jornadas, {}, '8 dias contra o dia civil');
});
test('histórico (dia operacional já virou): obterJornadas NÃO é chamado e jornadas={}', async () => {
  let chamou = 0;
  const r = await rodar({ ctx: Object.assign({ query: { dia: '2026-11-12', unidade: 'AGUA VERDE' }, obterJornadas: async () => { chamou++; return []; } }, noAgora('2026-11-13T10:30:00Z')) });   // 07:30 BRT, op 13/11
  assert.equal(r.status, 200); assert.equal(chamou, 0); assert.deepEqual(r.corpo.jornadas, {});
});
test('virada no Flash: followingDay vira o dia seguinte na resposta', async () => {
  const noite = { data: [{ date: DIA, employeeId: 'E1', attendances: [A('2026-11-12T18:00:00'), A('2026-11-12T02:10:00', { followingDay: true })] }] };
  const r = await rodar({ flash: () => R(noite), ctx: { query: { dia: DIA, unidade: 'AGUA VERDE' } } });
  assert.deepEqual(r.corpo.batidas[0].horarios, ['2026-11-12T18:00:00', '2026-11-13T02:10:00']); assert.equal(r.corpo.batidas[0].saida, '2026-11-13T02:10:00');
});

// ---------- cache ----------
test('cache: leituras simultâneas do mesmo dia/empresa viram UMA chamada ao Flash; dentro do TTL não repete; depois do TTL repete', async () => {
  let t = AGORA; const cache = L.criarCache({ agora: () => t });
  const f = mkFetch();
  const um = () => L.responder(Object.assign(ctx({}, f), { cache, agora: () => t }));
  const rs = await Promise.all([um(), um(), um()]);
  assert.ok(rs.every((r) => r.status === 200)); assert.equal(flashCalls(f).length, 1);
  await um(); assert.equal(flashCalls(f).length, 1);
  t += 61000; await um(); assert.equal(flashCalls(f).length, 2);
});
test('cache: falha não é guardada; empresas diferentes não se misturam', async () => {
  const cache = L.criarCache({ agora: () => AGORA });
  let falha = true;
  const f = mkFetch({ flash: (emp, d) => (falha ? R({}, 500) : R(flashDia(d))) });
  const um = () => L.responder(Object.assign(ctx({}, f), { cache }));
  assert.equal((await um()).status, 502); falha = false; assert.equal((await um()).status, 200);
  assert.equal(cache.tamanho(), 1);
  await L.responder(Object.assign(ctx({ painel: { lojas: ['AHU'] } }, mkFetch({ painel: { lojas: ['AHU'] } })), { cache, query: { dia: DIA, unidade: 'AHU' } }));
  assert.equal(cache.tamanho(), 2);
});
test('cache: o que o usuário B vê depende do cadastro DELE (RLS), não do que A leu antes', async () => {
  const cache = L.criarCache({ agora: () => AGORA });
  await L.responder(Object.assign(ctx({}), { cache }));
  const b = await L.responder(Object.assign(ctx({ pessoas: [PESSOAS[0]] }), { cache }));
  assert.deepEqual(b.corpo.batidas.map((x) => x.flash_id), ['E1']); assert.deepEqual(b.corpo.pessoas.map((p) => p.id), [1]);
});

// ---------- paginação ----------
test('paginação: junta todas as páginas; múltiplo exato fecha na página vazia; truncar é erro', async () => {
  const muitas = Array.from({ length: 5 }, (_, i) => Object.assign({}, PESSOAS[0], { id: i + 1, nome: 'P' + i, flash_id: 'F' + i }));
  const r = await rodar({ pessoas: muitas, ctx: { pageSize: 2 } });
  assert.equal(r.status, 200); assert.equal(r.corpo.pessoas.length, 5);
  const pg = r.f.chamadas.filter((x) => x.path.endsWith('/rh_pessoa')); assert.deepEqual(pg.map((x) => x.q.get('offset')), ['0', '2', '4']); assert.ok(pg.every((x) => x.q.get('limit') === '2'));
  const exato = await rodar({ pessoas: muitas.slice(0, 4), ctx: { pageSize: 2 } });
  assert.equal(exato.corpo.pessoas.length, 4); assert.equal(exato.f.chamadas.filter((x) => x.path.endsWith('/rh_pessoa')).length, 3);
  const corta = await rodar({ pessoas: muitas, ctx: { pageSize: 2, maxPaginas: 2 } });
  assert.equal(corta.status, 502); assert.equal(corta.corpo.erro, 'rest_truncado');
});
test('resposta REST fora do formato ou 401 do REST', async () => {
  assert.equal((await rodar({ rest: (p) => (p.endsWith('rh_pessoa') ? R({ x: 1 }) : null) })).corpo.erro, 'rest_formato');
  assert.equal((await rodar({ rest: (p) => (p.endsWith('rh_pessoa') ? R([], 401) : null) })).status, 401);
});

// ---------- refeição ----------
test('refeição: cartão (comanda) e alias único, itens como no antigo, só campos do contrato, sem dono só no aviso', async () => {
  const r = await rodar(); const rf = r.corpo.refeicoes;
  assert.equal(rf.disponivel, true); assert.deepEqual(rf.identificados, [1, 2]);
  assert.deepEqual(rf.porPessoa['1'], [{ tipo: 'almoço', produto: 'almoco', quantidade: 1, hora: '12:10' }]);
  assert.deepEqual(rf.porPessoa['2'], [{ tipo: 'almoço', produto: 'almoço', quantidade: 2, hora: '13:00' }]);
  assert.deepEqual(Object.keys(rf.porPessoa).sort(), ['1', '2']);
  assert.ok(r.corpo.avisos.some((a) => /^1 item\(ns\) de refeição sem dono/.test(a)));
  assert.deepEqual(r.corpo.refeicoesAnterior, { disponivel: false, porPessoa: {}, identificados: [] });
});
test('refeição na madrugada (04:00 civil 13/11, operacional 12/11): vem como a refeição do próprio dia operacional', async () => {
  const r = await rodar({ ctx: Object.assign({ query: { dia: '2026-11-12', unidade: 'AGUA VERDE' } }, noAgora('2026-11-13T07:00:00Z')) });
  assert.equal(r.status, 200); assert.equal(r.corpo.refeicoes.disponivel, true); assert.deepEqual(Object.keys(r.corpo.refeicoes.porPessoa).sort(), ['1', '2']);
  assert.deepEqual(r.corpo.refeicoesAnterior, { disponivel: false, porPessoa: {}, identificados: [] });
});
test('refeição: falha de leitura, de vínculos ou cadastro vazio = INDISPONÍVEL (200, sem afirmar "não lançou")', async () => {
  const casos = [{ rest: (p) => (p.endsWith('saipos_itens_venda') ? R({}, 500) : null) }, { rest: (p) => (p.endsWith('vendas_saipos') ? R([], 500) : null) },
    { ctx: { obterVinculos: async () => { throw new Error('db'); } } }, { ctx: { obterVinculos: async () => [] } }];
  for (const o of casos) {
    const r = await rodar(o);
    assert.equal(r.status, 200); assert.equal(r.corpo.refeicoes.disponivel, false); assert.deepEqual(r.corpo.refeicoes.porPessoa, {});
    assert.ok(r.corpo.avisos.some((a) => /Refeição/.test(a)));
    assert.equal(r.corpo.batidas.length, 2, 'ponto continua');
  }
});

const PE = [{ id: 1, nome: 'Ana Teste', unidade: 'AGUA VERDE' }, { id: 2, nome: 'Bia Souza', unidade: 'AGUA VERDE' }, { id: 3, nome: 'Ana Teste', unidade: 'AHU' }];
const V = (o) => Object.assign({ id_sale: 1, unidade: 'AGUA VERDE', comanda_id: 100, nome_venda: '', cliente_nome: '', cancelada: false, hora_venda: '12:00:00' }, o);
const VC = (o) => Object.assign({ unidade: 'AGUA VERDE', tipo: 'CARTAO', chave: '100', nome: 'Ana Teste', valido_desde: '2026-01-01' }, o);
const cr = (o) => L.construirRefeicoes(Object.assign({ vendas: [V()], itens: [IT({ observacao: '' })], vinculos: [VC()], pessoas: PE, dia: DIA }, o));
test('refeição: caso base atribui por cartão', () => { assert.deepEqual(Object.keys(cr().porPessoa), ['1']); });
test('refeição: cartão da Ana + apelido da Bia no texto = CONFLITO, ninguém recebe', () => {
  const r = cr({ vendas: [V({ nome_venda: 'mesa da bia' })], vinculos: [VC(), VC({ tipo: 'APELIDO', chave: 'bia', nome: 'Bia Souza' })] });
  assert.deepEqual(r.porPessoa, {}); assert.ok(r.avisos.some((a) => /conflito/.test(a)));
});
test('refeição: mesma chave de cartão para duas pessoas na mesma vigência = conflito; vigência mais nova resolve', () => {
  const dois = cr({ vinculos: [VC(), VC({ nome: 'Bia Souza' })] });
  assert.deepEqual(dois.porPessoa, {}); assert.deepEqual(dois.identificados, []); assert.ok(dois.avisos.some((a) => /em conflito/.test(a)));
  const novo = cr({ vinculos: [VC({ valido_desde: '2026-01-01' }), VC({ nome: 'Bia Souza', valido_desde: '2026-06-01' })] });
  assert.deepEqual(Object.keys(novo.porPessoa), ['2']);
});
test('refeição: vínculo futuro, nome sem pessoa única e homônimos são ignorados com aviso', () => {
  assert.deepEqual(cr({ vinculos: [VC({ valido_desde: '2026-12-01' })] }).porPessoa, {});
  const sem = cr({ vinculos: [VC({ nome: 'Fulano Inexistente' })] }); assert.deepEqual(sem.porPessoa, {}); assert.ok(sem.avisos.some((a) => /sem pessoa ativa nesse dia \(vínculo inativo ou cadastro a conferir\)/.test(a)));
  const hom = cr({ pessoas: PE.concat([{ id: 9, nome: 'ANA  TESTE', unidade: 'AGUA VERDE' }]) }); assert.deepEqual(hom.porPessoa, {}); assert.ok(hom.avisos.some((a) => /nome repetido/.test(a)));
});
test('refeição: nome igual em OUTRA unidade não se mistura (nome completo + unidade)', () => {
  const r = cr({ vinculos: [VC({ unidade: 'AHU', nome: 'Ana Teste', chave: '100' })] });
  assert.deepEqual(r.porPessoa, {}, 'cartão cadastrado na AHU não vale numa venda da AGUA VERDE');
  const ahu = cr({ vendas: [V({ unidade: 'AHU' })], itens: [IT({ unidade: 'AHU', observacao: '' })], vinculos: [VC({ unidade: 'AHU' })] });
  assert.deepEqual(Object.keys(ahu.porPessoa), ['3']);
});
test('refeição: nunca casa primeiro nome por heurística; só alias cadastrado, por frase inteira, normalizando acento e caixa', () => {
  assert.deepEqual(cr({ vendas: [V({ comanda_id: 999, nome_venda: 'Ana' })] }).porPessoa, {});
  const ok = cr({ vendas: [V({ comanda_id: 999, nome_venda: 'refeição ZÉ-bia' })], vinculos: [VC({ tipo: 'APELIDO', chave: 'Zé Bia' })] });
  assert.deepEqual(Object.keys(ok.porPessoa), ['1']);
  assert.deepEqual(cr({ vendas: [V({ comanda_id: 999, nome_venda: 'zebiana' })], vinculos: [VC({ tipo: 'APELIDO', chave: 'zebia' })] }).porPessoa, {}, 'pedaço de palavra não conta');
});
test('refeição: o mesmo alias para duas pessoas da unidade é conflito e não atribui', () => {
  const r = cr({ vendas: [V({ comanda_id: 999, nome_venda: 'pretinho' })], vinculos: [VC({ tipo: 'APELIDO', chave: 'pretinho' }), VC({ tipo: 'APELIDO', chave: 'pretinho', nome: 'Bia Souza' })] });
  assert.deepEqual(r.porPessoa, {}); assert.ok(r.avisos.some((a) => /conflito/.test(a)));
});
test('refeição: alias na observação do item também identifica; cancelada, deletado, preço e produto comum não contam', () => {
  const vinc = [VC({ tipo: 'APELIDO', chave: 'aninha' })];
  const ok = cr({ vendas: [V({ comanda_id: 999 })], itens: [IT({ observacao: 'p/ Aninha' })], vinculos: vinc }); assert.deepEqual(Object.keys(ok.porPessoa), ['1']);
  for (const [v, i] of [[{ cancelada: true }, {}], [{}, { deletado: true }], [{}, { preco_unit: 0.01 }], [{}, { preco_unit: null }], [{}, { produto: 'COCA' }]])
    assert.deepEqual(cr({ vendas: [V(v)], itens: [IT(Object.assign({ observacao: '' }, i))] }).porPessoa, {}, JSON.stringify([v, i]));
});
test('refeição: item que começa com dia da semana e hífen conta; "FUNCION" em qualquer lugar conta', () => {
  assert.ok(L.ehItemRefeicao(IT({ produto: 'Terça - Prato' }), { cancelada: false })); assert.ok(L.ehItemRefeicao(IT({ produto: 'Almoço funcionário' }), { cancelada: false }));
  assert.ok(!L.ehItemRefeicao(IT({ produto: 'Terça prato' }), { cancelada: false }));
});
test('refeição: unidade sem acento, comanda 0/vazia nunca casa cartão', () => {
  assert.deepEqual(cr({ vendas: [V({ comanda_id: 0 })], vinculos: [VC({ chave: '0' })] }).porPessoa, {});
  assert.deepEqual(cr({ vendas: [V({ comanda_id: null })] }).porPessoa, {});
});

// ---------- categorias (conjunto, não pessoa) e apelidos curtos ----------
const CC = (o) => Object.assign({ unidade: 'AGUA VERDE', tipo: 'CATEGORIA_CLIENTE', chave: 'Mesa da Equipe', nome: 'Equipe Teste', valido_desde: '2026-01-01' }, o);
const CK = (o) => CC(Object.assign({ tipo: 'CATEGORIA_CARTAO', chave: '200' }, o));
const crc = (o) => cr(Object.assign({ vendas: [V({ comanda_id: 999, cliente_nome: 'mesa da equipe' })], vinculos: [CC()] }, o));
const rotulos = (r) => r.categorias.map((c) => c.rotulo + ':' + c.itens.length);
test('categoria: cliente EXATO normalizado (caixa/acento/espaço), nunca substring; cartão da comanda idem', () => {
  const ok = crc({ vendas: [V({ comanda_id: 999, cliente_nome: '  MESA   DA   ÉQUIPE ' })] });
  assert.deepEqual(rotulos(ok), ['Equipe Teste:1']); assert.deepEqual(ok.porPessoa, {}); assert.deepEqual(ok.identificados, []);
  for (const cliente_nome of ['mesa da equipe 2', 'a mesa da equipe', 'mesa da', '']) {
    const r = crc({ vendas: [V({ comanda_id: 999, cliente_nome })] });
    assert.deepEqual(r.categorias, [], cliente_nome); assert.ok(r.avisos.some((a) => /^1 item\(ns\) de refeição sem dono/.test(a)), 'órfão segue pendente');
  }
  assert.deepEqual(rotulos(cr({ vendas: [V({ comanda_id: 200 })], vinculos: [CK()] })), ['Equipe Teste:1']);
  assert.deepEqual(cr({ vendas: [V({ comanda_id: 2000 })], vinculos: [CK()] }).categorias, []);
  assert.deepEqual(cr({ vendas: [V({ comanda_id: 0 })], vinculos: [CK({ chave: '0' })] }).categorias, []);
});
test('categoria: unidade, vigência e conflito (mesma chave, rótulos diferentes na vigência mais nova)', () => {
  assert.deepEqual(crc({ vinculos: [CC({ unidade: 'AHU' })] }).categorias, [], 'outra unidade');
  assert.deepEqual(crc({ vinculos: [CC({ valido_desde: '2026-12-01' })] }).categorias, [], 'futuro');
  const dois = crc({ vinculos: [CC(), CC({ nome: 'Outra' })] });
  assert.deepEqual(dois.categorias, []); assert.ok(dois.avisos.some((a) => /categoria de refeição em conflito/.test(a))); assert.ok(dois.avisos.some((a) => /sem dono/.test(a)) || dois.avisos.some((a) => /conflito/.test(a)));
  assert.deepEqual(rotulos(crc({ vinculos: [CC(), CC({ nome: 'Outra', valido_desde: '2026-06-01' })] })), ['Outra:1'], 'vigência mais nova resolve');
  assert.deepEqual(rotulos(crc({ vinculos: [CC(), CC({ nome: 'EQUIPE teste' })] })), ['Equipe Teste:1'], 'mesmo rótulo normalizado não conflita');
  const cruz = cr({ vendas: [V({ comanda_id: 200, cliente_nome: 'mesa da equipe' })], vinculos: [CC(), CK({ nome: 'Diferente' })] });
  assert.deepEqual(cruz.categorias, []); assert.ok(cruz.avisos.some((a) => /identificação em conflito/.test(a)));
  const lista = L.validarVinculos([CC({ nome: ' Rótulo\u0007 muito muito muito longo para caber ' })], DIA).vinculos;
  assert.equal(lista[0].nome.length, 30); assert.ok(!/[\u0000-\u001f]/.test(lista[0].nome));
  assert.equal(L.validarVinculos([CC({ nome: '\u0007 ' })], DIA).invalidos, 1);
});
test('categoria vence alias da observação (alias bloqueado pelo grupo) e nunca vira pessoa', () => {
  const r = crc({ itens: [IT({ observacao: 'p/ bia' })], vinculos: [CC(), VC({ tipo: 'APELIDO', chave: 'bia', nome: 'Bia Souza' })] });
  assert.deepEqual(rotulos(r), ['Equipe Teste:1']); assert.deepEqual(r.porPessoa, {}, 'categoria não entra em porPessoa');
  assert.ok(!r.identificados.includes('Equipe Teste'), 'categoria não entra em identificados');
  const conf = crc({ itens: [IT({ observacao: 'pretinho' })], vinculos: [CC(), VC({ tipo: 'APELIDO', chave: 'pretinho' }), VC({ tipo: 'APELIDO', chave: 'pretinho', nome: 'Bia Souza' })] });
  assert.deepEqual(rotulos(conf), ['Equipe Teste:1'], 'alias em conflito também não bloqueia categoria');
});
test('categoria × cartão de pessoa explícita na mesma venda = conflito, sem atribuir a ninguém', () => {
  const r = cr({ vendas: [V({ comanda_id: 100, cliente_nome: 'mesa da equipe' })], vinculos: [VC(), CC()] });
  assert.deepEqual(r.porPessoa, {}); assert.deepEqual(r.categorias, []); assert.ok(r.avisos.some((a) => /^1 item\(ns\) de refeição com identificação em conflito/.test(a)));
  const c2 = cr({ vendas: [V({ comanda_id: 100 })], vinculos: [VC(), CK({ chave: '100' })] });
  assert.deepEqual(c2.porPessoa, {}); assert.deepEqual(c2.categorias, []);
});
test('apelido: 2 letras valem como token inteiro; 1 letra é rejeitada; pedaço de palavra não casa', () => {
  const ok = cr({ vendas: [V({ comanda_id: 999, nome_venda: 'refeição ZÉ' })], vinculos: [VC({ tipo: 'APELIDO', chave: 'Zé' })] });
  assert.deepEqual(Object.keys(ok.porPessoa), ['1']);
  assert.deepEqual(cr({ vendas: [V({ comanda_id: 999, nome_venda: 'zeca' })], vinculos: [VC({ tipo: 'APELIDO', chave: 'ze' })] }).porPessoa, {});
  const um = L.validarVinculos([VC({ tipo: 'APELIDO', chave: 'z' })], DIA); assert.equal(um.vinculos.length, 0); assert.equal(um.invalidos, 1);
  assert.equal(L.validarVinculos([VC({ tipo: 'APELIDO', chave: 'ze' })], DIA).vinculos.length, 1);
});
test('categoria ponta a ponta: só contagens e rótulo nos avisos (nunca chave, cliente, observação); órfão real segue pendente; refeição disponível só com categoria', async () => {
  const vendas = [V({ id_sale: 1, comanda_id: 999, cliente_nome: 'CLIENTE SECRETO XYZ' }), V({ id_sale: 2, comanda_id: 888, nome_venda: 'mesa 9', cliente_nome: 'OUTRO SIGILO' })]
    .map((x) => Object.assign(x, { shift_date: DIA }));
  const itens = [IT({ id_sale: 1, id_sale_item: 1, observacao: 'OBS SIGILOSA' }), IT({ id_sale: 2, id_sale_item: 2, observacao: 'OBS ORFA' })];
  const vinc = [CC({ chave: 'cliente secreto xyz' }), CK({ chave: '4242' })];
  const r = await rodar({ vendas, itens, ctx: { obterVinculos: async () => vinc } });
  const rf = r.corpo.refeicoes;
  assert.equal(rf.disponivel, true); assert.deepEqual(rf.porPessoa, {}); assert.deepEqual(rf.identificados, []);
  assert.deepEqual(rf.categorias.map((c) => [c.rotulo, c.itens.length]), [['Equipe Teste', 1]]);
  assert.ok(r.corpo.avisos.some((a) => /^1 item\(ns\) de refeição sem dono/.test(a)), 'órfão real continua avisado');
  const texto = JSON.stringify(r.corpo);
  for (const proibido of ['CLIENTE SECRETO', 'cliente secreto', 'OUTRO SIGILO', 'OBS SIGILOSA', 'OBS ORFA', '4242', 'cliente_nome', 'comanda']) assert.ok(!texto.includes(proibido), 'vazou: ' + proibido);
});

// ---------- utilitários ----------
test('horaDe: só formatos conhecidos; com fuso converte para Brasília', () => {
  assert.equal(L.horaDe('12:10:33'), '12:10'); assert.equal(L.horaDe('2026-11-12 13:05:00'), '13:05'); assert.equal(L.horaDe('2026-11-12T15:30:00Z'), '12:30');
  assert.equal(L.horaDe('2026-11-12T15:30:00+00'), '12:30'); assert.equal(L.horaDe('2026-11-12T12:30:00-03:00'), '12:30');
  for (const x of ['25:00', 'meio-dia', null, 12, '']) assert.equal(L.horaDe(x), null);
});
test('calendário e normalização', () => {
  assert.equal(L.diaAnterior('2026-03-01'), '2026-02-28'); assert.equal(L.diaSeguinte('2026-12-31'), '2027-01-01');
  assert.equal(L.normalizar('  São  Bráz '), 'SAO BRAZ'); assert.equal(L.unidadeCanonica('são braz'), 'SAO BRAZ'); assert.equal(L.unidadeCanonica('constructor'), null);
  assert.deepEqual(L.brtAgora(MADRUGADA), { data: '2026-11-13', min: 90 });
});
const ORIGEM = 'https://cidadaodomundo-erp.github.io';
test('CORS: padrão explícito, nunca "*"; origem de fora não ganha Allow-Origin; env com "*" é ignorado', () => {
  assert.deepEqual([...L.ORIGENS_PADRAO], [ORIGEM]);
  assert.equal(L.corsHeaders(ORIGEM)['Access-Control-Allow-Origin'], ORIGEM);
  for (const o of ['https://evil.example', 'http://cidadaodomundo-erp.github.io', 'null', '']) assert.ok(!('Access-Control-Allow-Origin' in L.corsHeaders(o)), o);
  assert.ok(!Object.values(L.corsHeaders(ORIGEM)).includes('*'));
  assert.deepEqual(L.origensDe(undefined), [ORIGEM]); assert.deepEqual(L.origensDe('*'), [ORIGEM]); assert.deepEqual(L.origensDe(' https://a.io , * '), ['https://a.io']);
  assert.equal(L.corsHeaders('', [])['Cache-Control'], 'no-store');
});
test('origem não permitida: 403 ANTES de autenticar ou ler qualquer dado; sem Origin e origem permitida seguem normal', async () => {
  const ruim = await rodar({ ctx: { origem: 'https://evil.example' } });
  assert.equal(ruim.status, 403); assert.deepEqual(ruim.corpo, { erro: 'origem_nao_permitida' }); assert.equal(ruim.f.chamadas.length, 0);
  assert.equal((await rodar({ ctx: { origem: ORIGEM } })).status, 200);
  assert.equal((await rodar({ ctx: { origem: undefined } })).status, 200);
  assert.equal((await rodar({ ctx: { origem: '' } })).status, 200);
  assert.equal((await rodar({ ctx: { origem: 'https://a.io', origens: ['https://a.io'] } })).status, 200);
  assert.ok(L.origemPermitida('', L.ORIGENS_PADRAO) && !L.origemPermitida('https://x.io', L.ORIGENS_PADRAO));
});

// ---------- limitador por usuário ----------
test('limitador: 12 chamadas por 60 s por user.id; a 13ª é 429 explícita; outro usuário não é afetado; janela renova', async () => {
  let t = AGORA; const lim = L.criarLimitador({ agora: () => t });
  const f = (id) => mkFetch({ auth: R({ id }) });
  const um = (id) => L.responder(Object.assign(ctx({}, f(id)), { limitador: lim, agora: () => t }));
  for (let i = 0; i < 12; i++) assert.equal((await um('u1')).status, 200, 'chamada ' + (i + 1));
  const x = await um('u1'); assert.equal(x.status, 429); assert.deepEqual(x.corpo, { erro: 'limite_de_chamadas' });
  assert.equal((await um('u2')).status, 200);
  t += 60000; assert.equal((await um('u1')).status, 200);
});
test('limitador: o 429 vem antes de permissões/dados; JWT inválido não gasta cota; memória limitada', async () => {
  const lim = L.criarLimitador({ max: 1 });
  const c1 = ctx({}); c1.limitador = lim; await L.responder(c1);
  const c2 = ctx({}); c2.limitador = lim; const r = await L.responder(c2);
  assert.equal(r.status, 429); assert.ok(c2._f.chamadas.every((x) => x.path === '/auth/v1/user'));
  const c3 = ctx({ auth: R({}, 401) }); c3.limitador = lim; assert.equal((await L.responder(c3)).status, 401);
  const pequeno = L.criarLimitador({ maxUsuarios: 3 }); for (let i = 0; i < 10; i++) pequeno.permitir('u' + i); assert.ok(pequeno.tamanho() <= 3);
});
test('autenticar devolve só o id (nada de e-mail)', async () => {
  const f = mkFetch(); const id = await L.autenticar({ fetchImpl: f.fetchImpl, supabaseUrl: 'https://x.supabase.co', anonKey: ANON, timeoutMs: 500 }, JWT);
  assert.equal(id, 'u1');
});

// ---------- vínculos: valido_desde NULL ----------
test('vínculo com valido_desde NULL vale (sem limite inicial); data futura não; data inválida é rejeitada; vigente vale', () => {
  const v = (x) => L.validarVinculos([VC(x)], DIA);
  assert.equal(v({ valido_desde: null }).vinculos.length, 1); assert.equal(v({ valido_desde: undefined }).vinculos.length, 1);
  assert.equal(v({ valido_desde: null }).vinculos[0].desde, '');
  assert.equal(v({ valido_desde: '2026-11-12' }).vinculos.length, 1); assert.equal(v({ valido_desde: '2026-01-01' }).vinculos.length, 1);
  assert.equal(v({ valido_desde: '2026-11-13' }).vinculos.length, 0); assert.equal(v({ valido_desde: '2026-11-13' }).invalidos, 0);
  for (const x of ['2026-02-30', 'ontem', '', 20261112]) { const r = v({ valido_desde: x }); assert.equal(r.vinculos.length, 0); assert.equal(r.invalidos, 1, String(x)); }
});
test('refeição com valido_desde NULL: atribui; NULL não vence data explícita mais nova; dois NULL para pessoas diferentes = conflito', () => {
  assert.deepEqual(Object.keys(cr({ vinculos: [VC({ valido_desde: null })] }).porPessoa), ['1']);
  assert.deepEqual(Object.keys(cr({ vinculos: [VC({ valido_desde: null }), VC({ nome: 'Bia Souza', valido_desde: '2026-06-01' })] }).porPessoa), ['2']);
  const c = cr({ vinculos: [VC({ valido_desde: null }), VC({ nome: 'Bia Souza', valido_desde: null })] }); assert.deepEqual(c.porPessoa, {}); assert.ok(c.avisos.some((a) => /em conflito/.test(a)));
  assert.deepEqual(cr({ vinculos: [VC({ valido_desde: null, tipo: 'APELIDO', chave: 'ninja' })], vendas: [V({ comanda_id: 9, nome_venda: 'ninja' })] }).identificados, [1]);
});
// ---------- aviso "sem pessoa ativa": só vínculo USADO no dia ----------
const AVISO_SEM = /sem pessoa ativa nesse dia/;
test('aviso sem pessoa ativa: vínculo usado (cartão exato / alias de fronteira) avisa; não usado (desligado antigo) não avisa', () => {
  const naoUsado = cr({ vinculos: [VC({ nome: 'Fulano Desligado', chave: '999' })] });
  assert.ok(!naoUsado.avisos.some((a) => AVISO_SEM.test(a)), 'cartão que nenhum item elegível usou'); assert.deepEqual(naoUsado.porPessoa, {});
  const usado = cr({ vinculos: [VC({ nome: 'Fulano Desligado', chave: '100' })] });
  assert.ok(usado.avisos.some((a) => /^1 vínculo\(s\) de refeição sem pessoa ativa/.test(a))); assert.ok(usado.avisos.some((a) => /^1 item\(ns\) de refeição sem dono/.test(a)), 'segue órfão, não some');
  assert.equal(usado.identificados.length, 0);
  const apNao = cr({ vinculos: [VC({ tipo: 'APELIDO', chave: 'zeca', nome: 'Fulano Desligado' })] });
  assert.ok(!apNao.avisos.some((a) => AVISO_SEM.test(a)));
  const apSim = cr({ vendas: [V({ comanda_id: 999, nome_venda: 'refeição Zeca' })], vinculos: [VC({ tipo: 'APELIDO', chave: 'zeca', nome: 'Fulano Desligado' })] });
  assert.ok(apSim.avisos.some((a) => AVISO_SEM.test(a))); assert.deepEqual(apSim.porPessoa, {}, 'nunca mapeia por primeiro nome');
  const apFron = cr({ vendas: [V({ comanda_id: 999, nome_venda: 'zecao' })], vinculos: [VC({ tipo: 'APELIDO', chave: 'zeca', nome: 'Fulano Desligado' })] });
  assert.ok(!apFron.avisos.some((a) => AVISO_SEM.test(a)), 'pedaço de palavra não é uso');
  const cancel = cr({ vendas: [V({ cancelada: true })], vinculos: [VC({ nome: 'Fulano Desligado', chave: '100' })] });
  assert.ok(!cancel.avisos.some((a) => AVISO_SEM.test(a)), 'venda não elegível não usa o vínculo');
  const outraUn = cr({ vinculos: [VC({ nome: 'Fulano Desligado', chave: '100', unidade: 'AHU' })] });
  assert.ok(!outraUn.avisos.some((a) => AVISO_SEM.test(a)), 'outra unidade não usa');
});

// ---------- PESSOA_VENDA / CATEGORIA_VENDA (lançamento avulso; chave = id_sale; só na data exata) ----------
const PV = (o) => VC(Object.assign({ tipo: 'PESSOA_VENDA', chave: '1', valido_desde: DIA }, o));
const CV = (o) => CC(Object.assign({ tipo: 'CATEGORIA_VENDA', chave: '1', valido_desde: DIA }, o));
test('PESSOA_VENDA: atribui órfão só com data EXATA, id_sale, unidade e nome completo único; outro dia ignora; NULL/inválida rejeita', () => {
  assert.deepEqual(Object.keys(cr({ vinculos: [PV()] }).porPessoa), ['1'], 'órfão atribuído');
  assert.deepEqual(Object.keys(cr({ vinculos: [PV({ nome: 'Bia Souza' })] }).porPessoa), ['2']);
  for (const d of ['2026-11-11', '2026-11-13', '2026-01-01']) {
    const x = L.validarVinculos([PV({ valido_desde: d })], DIA); assert.equal(x.vinculos.length, 0, d); assert.equal(x.invalidos, 0, 'outro dia é ignorado, não inválido');
    assert.deepEqual(cr({ vinculos: [PV({ valido_desde: d })] }).porPessoa, {}, d);
  }
  for (const d of [null, undefined, '', 'ontem', '2026-02-30', 20261112]) { const x = L.validarVinculos([PV({ valido_desde: d })], DIA); assert.equal(x.vinculos.length, 0); assert.equal(x.invalidos, 1, String(d)); }
  assert.equal(L.validarVinculos([CV({ valido_desde: null })], DIA).invalidos, 1); assert.equal(L.validarVinculos([CV({ valido_desde: '2026-11-11' })], DIA).vinculos.length, 0);
  assert.deepEqual(cr({ vinculos: [PV({ chave: '2' })] }).porPessoa, {}, 'outro id_sale'); assert.deepEqual(cr({ vinculos: [PV({ unidade: 'AHU' })] }).porPessoa, {}, 'outra unidade');
  assert.deepEqual(cr({ vinculos: [PV({ nome: 'Ana' })] }).porPessoa, {}, 'primeiro nome não resolve');
  assert.ok(cr({ vinculos: [PV({ nome: 'Ana' })] }).avisos.some((a) => AVISO_SEM.test(a)), 'sem pessoa e usado: avisa e segue órfão');
  assert.deepEqual(cr({ vinculos: [PV({ nome: 'Ana Teste', unidade: 'AHU' })], vendas: [V({ unidade: 'AHU' })], itens: [IT({ unidade: 'AHU', observacao: '' })] }).porPessoa[3].length, 1, 'mesmo nome, unidade certa');
  const hom = cr({ vinculos: [PV()], pessoas: PE.concat([{ id: 9, nome: 'ANA TESTE', unidade: 'AGUA VERDE' }]) }); assert.deepEqual(hom.porPessoa, {}); assert.ok(hom.avisos.some((a) => /nome repetido/.test(a)));
  assert.deepEqual(Object.keys(cr({ vinculos: [PV({ chave: ' 1 ' })] }).porPessoa), ['1'], 'chave textual aparada');
});
test('PESSOA_VENDA × cartão/alias pessoal: mesma pessoa ok; outra pessoa = conflito (nada silencia a regra)', () => {
  assert.deepEqual(Object.keys(cr({ vinculos: [VC(), PV()] }).porPessoa), ['1'], 'mesma pessoa do cartão');
  const c = cr({ vinculos: [VC({ nome: 'Bia Souza' }), PV()] });
  assert.deepEqual(c.porPessoa, {}); assert.ok(c.avisos.some((a) => /^1 item\(ns\) de refeição com identificação em conflito/.test(a)));
  const apNome = (o) => cr({ vendas: [V({ comanda_id: 999, nome_venda: 'pretinho' })], vinculos: [VC({ tipo: 'APELIDO', chave: 'pretinho', nome: 'Bia Souza' }), PV(o)] });
  assert.deepEqual(apNome().porPessoa, {}); assert.ok(apNome().avisos.some((a) => /identificação em conflito/.test(a)));
  assert.deepEqual(Object.keys(apNome({ nome: 'Bia Souza' }).porPessoa), ['2']);
  const cartaoEmConflito = cr({ vinculos: [VC(), VC({ nome: 'Bia Souza' }), PV()] }); assert.deepEqual(cartaoEmConflito.porPessoa, {});
  const aliasEmConflito = cr({ vendas: [V({ comanda_id: 999, nome_venda: 'pretinho' })], vinculos: [VC({ tipo: 'APELIDO', chave: 'pretinho' }), VC({ tipo: 'APELIDO', chave: 'pretinho', nome: 'Bia Souza' }), PV()] }); assert.deepEqual(aliasEmConflito.porPessoa, {});
  const dois = cr({ vinculos: [PV(), PV({ nome: 'Bia Souza' })] }); assert.deepEqual(dois.porPessoa, {}); assert.ok(dois.avisos.some((a) => /em conflito/.test(a)));
  assert.deepEqual(Object.keys(cr({ vinculos: [PV(), PV()] }).porPessoa), ['1'], 'mesma pessoa duas vezes não conflita');
});
test('CATEGORIA_VENDA: conjunto por id_sale/dia/unidade; vence só alias; × cartão pessoal, × PESSOA_VENDA e × outra categoria = conflito', () => {
  const ok = cr({ vinculos: [CV()] }); assert.deepEqual(rotulos(ok), ['Equipe Teste:1']); assert.deepEqual(ok.porPessoa, {}); assert.deepEqual(ok.identificados, []);
  assert.deepEqual(cr({ vinculos: [CV({ valido_desde: '2026-11-11' })] }).categorias, []); assert.deepEqual(cr({ vinculos: [CV({ chave: '2' })] }).categorias, []); assert.deepEqual(cr({ vinculos: [CV({ unidade: 'AHU' })] }).categorias, []);
  const alias = cr({ itens: [IT({ observacao: 'p/ bia' })], vinculos: [CV(), VC({ tipo: 'APELIDO', chave: 'bia', nome: 'Bia Souza' })] });
  assert.deepEqual(rotulos(alias), ['Equipe Teste:1']); assert.deepEqual(alias.porPessoa, {});
  const cartao = cr({ vinculos: [CV(), VC()] }); assert.deepEqual(cartao.categorias, []); assert.deepEqual(cartao.porPessoa, {}); assert.ok(cartao.avisos.some((a) => /identificação em conflito/.test(a)));
  const pv = cr({ vinculos: [CV(), PV()] }); assert.deepEqual(pv.categorias, []); assert.deepEqual(pv.porPessoa, {}); assert.ok(pv.avisos.some((a) => /identificação em conflito/.test(a)));
  const pvCliente = cr({ vendas: [V({ comanda_id: 999, cliente_nome: 'mesa da equipe' })], vinculos: [CC(), PV()] }); assert.deepEqual(pvCliente.categorias, []); assert.deepEqual(pvCliente.porPessoa, {});
  const pvCartaoCat = cr({ vinculos: [CK({ chave: '100' }), PV()] }); assert.deepEqual(pvCartaoCat.categorias, []); assert.deepEqual(pvCartaoCat.porPessoa, {});
  const pvConf = cr({ vinculos: [CV(), PV({ nome: 'Fulano Sem Cadastro' })] }); assert.deepEqual(rotulos(pvConf), ['Equipe Teste:1'], 'PESSOA_VENDA sem pessoa resolvida não entra em jogo');
  const dois = cr({ vinculos: [CV(), CV({ nome: 'Outra' })] }); assert.deepEqual(dois.categorias, []); assert.ok(dois.avisos.some((a) => /categoria de refeição em conflito/.test(a)));
  const duasFontes = cr({ vendas: [V({ cliente_nome: 'mesa da equipe' })], vinculos: [CV({ nome: 'Outra' }), CC()] }); assert.deepEqual(duasFontes.categorias, []); assert.ok(duasFontes.avisos.some((a) => /identificação em conflito/.test(a)));
  assert.deepEqual(rotulos(cr({ vinculos: [CV(), CV({ nome: 'EQUIPE teste' })] })), ['Equipe Teste:1']);
});
test('venda avulsa ponta a ponta: só Pessoa/categoria mínimas na resposta; id_sale, cliente e observação nunca vazam', async () => {
  const vendas = [V({ id_sale: 'SEGREDOVENDA77', comanda_id: 5, cliente_nome: 'CLIENTE SIGILOSO' }), V({ id_sale: 'SEGREDOVENDA88', comanda_id: 6, cliente_nome: 'OUTRO SIGILO' })].map((x) => Object.assign(x, { shift_date: DIA }));
  const itens = [IT({ id_sale: 'SEGREDOVENDA77', id_sale_item: 1, observacao: 'OBS SIGILOSA' }), IT({ id_sale: 'SEGREDOVENDA88', id_sale_item: 2, observacao: 'OBS DOIS' })];
  const vinc = [PV({ chave: 'SEGREDOVENDA77' }), CV({ chave: 'SEGREDOVENDA88' }), PV({ chave: 'SEGREDOVENDA55', valido_desde: '2026-11-10' })];
  const r = await rodar({ vendas, itens, ctx: { obterVinculos: async () => vinc } });
  const rf = r.corpo.refeicoes; assert.equal(rf.disponivel, true);
  assert.deepEqual(Object.keys(rf.porPessoa), ['1']); assert.deepEqual(rf.identificados, [1]); assert.deepEqual(rf.categorias.map((c) => [c.rotulo, c.itens.length]), [['Equipe Teste', 1]]);
  const texto = JSON.stringify(r.corpo);
  for (const proibido of ['SEGREDOVENDA', 'CLIENTE SIGILOSO', 'OUTRO SIGILO', 'OBS SIGILOSA', 'OBS DOIS', 'id_sale', 'cliente_nome', 'valido_desde']) assert.ok(!texto.includes(proibido), 'vazou: ' + proibido);
});
test('ponta a ponta: vínculos NULL chegam à resposta (refeição disponível)', async () => {
  const r = await rodar({ ctx: { obterVinculos: async () => VINC.map((x) => Object.assign({}, x, { valido_desde: null })) } });
  assert.equal(r.corpo.refeicoes.disponivel, true); assert.deepEqual(r.corpo.refeicoes.identificados, [1, 2]);
});

// ---------- dia operacional / janela / jornada ----------
test('janela operacional: 02:59 entra e 03:00 sai; 06:59 sai e 07:00 entra', () => {
  const prox = '2026-11-13', hs = [DIA + 'T06:59:59', DIA + 'T07:00:00', prox + 'T02:59:59', prox + 'T03:00:00'];
  const r = L.montarBatidas([{ flash_id: 'E1', horarios: hs }], new Set(['E1']), DIA, 'x');
  assert.deepEqual(r.linhas[0].horarios, [DIA + 'T07:00:00', prox + 'T02:59:59']); assert.equal(r.linhas[0].n_batidas, 2); assert.equal(r.foraJanela, 2);
  assert.equal(L.montarBatidas([{ flash_id: 'E1', horarios: [prox + 'T03:00:00'] }], new Set(['E1']), DIA, 'x').linhas.length, 0);
  assert.deepEqual(L.janelaOperacional(DIA), { de: DIA + 'T07:00:00', ate: prox + 'T03:00:00' });
});
test('resposta: modoAguaVerde, diaOperacional (07:00 vira o dia) e aviso das batidas fora da janela', async () => {
  const flash = () => R({ data: [{ date: DIA, employeeId: 'E1', attendances: [A(DIA + 'T06:30:00'), A(DIA + 'T08:00:00'), A('2026-11-12T03:00:00', { followingDay: true })] }] });
  const r = await rodar({ flash });
  assert.equal(r.corpo.modoAguaVerde, true); assert.equal(r.corpo.diaOperacional, DIA);
  assert.deepEqual(r.corpo.batidas[0].horarios, [DIA + 'T08:00:00']); assert.ok(r.corpo.avisos.some((a) => /^2 batida\(s\) fora da janela operacional/.test(a)));
  const ag = (iso) => ({ agora: () => Date.parse(iso), cache: L.criarCache({ agora: () => Date.parse(iso) }) });
  const dia = (iso) => rodar({ ctx: Object.assign({ query: { dia: DIA, unidade: 'AGUA VERDE' } }, ag(iso)) }).then((x) => x.corpo.diaOperacional);
  assert.equal(await dia('2026-11-13T05:59:00Z'), DIA);   // 02:59 BRT
  assert.equal(await dia('2026-11-13T09:59:00Z'), DIA);   // 06:59 BRT
  assert.equal(await dia('2026-11-13T10:00:00Z'), '2026-11-13');   // 07:00 BRT
});
const JOR = [{ unidade: 'AGUA VERDE', nome: 'Ana Teste', entrada: '08:00:00', saida: '22:00:00', conferido_em: '2026-11-12' }];
test('jornadas: só nome+unidade únicos, retrato de até 7 dias, só quem tem batida, HH:MM; sem escrever nada', async () => {
  const r = await rodar({ ctx: { obterJornadas: async () => JOR } });
  assert.deepEqual(r.corpo.jornadas, { 1: { entrada: '08:00', saida: '22:00', conferidoEm: '2026-11-12' } });
  const sem = await rodar({ ctx: { obterJornadas: async () => JOR.concat([{ unidade: 'AGUA VERDE', nome: 'Pessoa Sem Batida', entrada: '08:00', saida: '17:00', conferido_em: '2026-11-12' }]) } });
  assert.deepEqual(Object.keys(sem.corpo.jornadas), ['1']);
  const c = L.construirJornadas({ jornadas: JOR, pessoas: PESSOAS.map((p) => ({ id: p.id, nome: p.nome, unidade: p.unidade })), hojeCivil: DIA, comBatida: new Set([1]) });
  assert.deepEqual(Object.keys(c.porPessoa), ['1']);
});
test('jornadas: vencida (8 dias), futura, inválida, duplicada, homônima ou sem pessoa = ignoradas com aviso; falha do callback não derruba o ponto', async () => {
  const j = (o) => [Object.assign({}, JOR[0], o)];
  for (const o of [{ conferido_em: '2026-11-04' }, { conferido_em: '2026-11-13' }, { entrada: '25:00' }, { nome: 'Fulano Inexistente' }, { unidade: 'REDE' }]) {
    const r = await rodar({ ctx: { obterJornadas: async () => j(o) } }); assert.deepEqual(r.corpo.jornadas, {}, JSON.stringify(o)); assert.equal(r.status, 200);
  }
  assert.deepEqual((await rodar({ ctx: { obterJornadas: async () => j({ conferido_em: '2026-11-05' }) } })).corpo.jornadas, { 1: { entrada: '08:00', saida: '22:00', conferidoEm: '2026-11-05' } });
  const dup = await rodar({ ctx: { obterJornadas: async () => JOR.concat(JOR) } }); assert.deepEqual(dup.corpo.jornadas, {}); assert.ok(dup.corpo.avisos.some((a) => /repetida/.test(a)));
  const hom = await rodar({ pessoas: PESSOAS.concat([Object.assign({}, PESSOAS[0], { id: 8, flash_id: 'E8' })]), ctx: { obterJornadas: async () => JOR } }); assert.deepEqual(hom.corpo.jornadas, {});
  const falha = await rodar({ ctx: { obterJornadas: async () => { throw new Error('db'); } } });
  assert.equal(falha.status, 200); assert.deepEqual(falha.corpo.jornadas, {}); assert.ok(falha.corpo.avisos.some((a) => /Jornada cadastral indisponível/.test(a))); assert.equal(falha.corpo.batidas.length, 2);
  assert.equal((await rodar()).corpo.jornadas && Object.keys((await rodar()).corpo.jornadas).length, 0, 'sem callback: vazio');
});
test('extrairJwt', () => { assert.equal(L.extrairJwt('Bearer a.b.c'), 'a.b.c'); assert.equal(L.extrairJwt('bearer a.b.c'), 'a.b.c'); assert.equal(L.extrairJwt('Bearer a.b'), null); assert.equal(L.extrairJwt(null), null); });

