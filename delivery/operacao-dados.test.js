// node --test delivery/operacao-dados.test.js   (leitura de Chegada e Escala; rede, sessão e loja são ficções; só dados fictícios)
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const M = require('./operacao-modelo.js');
const D = require('./operacao-dados.js');
const OP = require('./operacao.js');

const settle = async () => { for (let i = 0; i < 10; i++) await new Promise((r) => setImmediate(r)); };
const defer = () => { let res; const p = new Promise((r) => { res = r; }); return { p, res }; };
const ok = (rows) => ({ ok: true, status: 200, json: async () => rows });
const erro = (status) => ({ ok: false, status, json: async () => ({ message: 'detalhe privado' }) });
const sempre = () => true;
const escRow = (o = {}) => ({ dia: '2026-11-11', unidade: 'AHU', turno: 'JANTAR', nome_na_escala: 'Fulano Teste', inicio: '18:00:00', fim: '23:00:00', gravado_em: '2026-11-10T20:00:00+00:00', ...o });
const fRow = (o = {}) => ({ data_local: '2026-11-11', unidade: 'AHU', turno: 'JANTAR', entregador: 'Fulano Teste', coleta: '2026-11-11T21:30:00+00:00', despacho: null, entrega: '2026-11-11T21:50:00+00:00', importado_em: '2026-11-11T22:00:00.123456+00:00', ...o });
const tRow = (o = {}) => ({ data_local: '2026-11-11', unidade: 'AHU', turno: 'JANTAR', entregador: 'Fulano Teste', coleta: '2026-11-11T21:40:00+00:00', saida: null, entrega: null, importado_em: '2026-11-11T22:05:00+00:00', ...o });

function montar({ lojas = ['AHU', 'SÃO BRAZ'], loja = 'AHU', info, resposta }) {
  const chamadas = [];
  const est = { loja };
  const dd = D.criar({
    modelo: M,
    lojaCarregar: async () => (info !== undefined ? info : { lojas }),
    lojaAtual: () => est.loja,
    trFetch: async (url, opts) => { chamadas.push({ url, metodo: opts && opts.method }); return resposta(url); }
  });
  return { dd, chamadas, est };
}

test('duas fontes são sempre consultadas; uma falha e a outra aparece como PARCIAL', async () => {
  const t = montar({ resposta: (u) => (u.startsWith('foody_entregas') ? erro(500) : ok([tRow()])) });
  const r = await t.dd.ler('chegada', '2026-11-11', sempre);
  assert.equal(r.fase, 'pronto');
  assert.equal(t.chamadas.length, 2);
  assert.ok(t.chamadas.every((c) => c.metodo === 'GET'));
  assert.equal(r.resultado.estado, 'parcial');
  assert.equal(r.resultado.fontes.foody.estado, 'falha');
  assert.equal(r.resultado.fontes.trackeat.estado, 'ok');
  assert.equal(r.resultado.linhas.length, 1);
  assert.equal(r.resultado.linhas[0].fonte, 'trackeat');
  // as duas fontes falhando não vira "vazio": é falha
  const t2 = montar({ resposta: () => erro(500) });
  const r2 = await t2.dd.ler('chegada', '2026-11-11', sempre);
  assert.equal(r2.resultado.estado, 'falha');
  assert.match(OP.render('chegada', { dia: '2026-11-11', loja: 'AHU', dados: r2 }), /Isso não significa que não houve atividade/);
});

test('Foody zerado no dia não corta o TrackEat; mesmo motoboy nas duas fontes não é fundido nem somado', async () => {
  const t = montar({ resposta: (u) => (u.startsWith('foody_entregas') ? ok([]) : ok([tRow()])) });
  const r = await t.dd.ler('chegada', '2026-11-11', sempre);
  assert.equal(r.resultado.estado, 'ok');
  assert.equal(r.resultado.linhas.length, 1);
  const t2 = montar({ resposta: (u) => (u.startsWith('foody_entregas') ? ok([fRow()]) : ok([tRow()])) });
  const r2 = await t2.dd.ler('chegada', '2026-11-11', sempre);
  assert.deepEqual(r2.resultado.linhas.map((l) => l.fonte).sort(), ['foody', 'trackeat']);
  assert.ok(r2.resultado.linhas.every((l) => l.chegadaRegistrada === null && l.situacao === 'Chegada a conferir'));
});

test('URLs exatas: só campos mínimos, valores codificados, ordem estável, página de 250', async () => {
  const t = montar({ loja: 'SÃO BRAZ', resposta: () => ok([]) });
  await t.dd.ler('escala', '2026-11-11', sempre);
  assert.equal(t.chamadas[0].url, 'motoboy_escala?select=dia,unidade,turno,nome_na_escala,inicio,fim,gravado_em&dia=eq.2026-11-11&unidade=eq.S%C3%83O%20BRAZ&order=dia.asc,unidade.asc,turno.asc,nome_na_escala.asc,inicio.asc,fim.asc,gravado_em.asc&limit=250&offset=0');
  const t2 = montar({ resposta: () => ok([]) });
  await t2.dd.ler('chegada', '2026-11-11', sempre);
  const urls = t2.chamadas.map((c) => c.url).sort();
  assert.deepEqual(urls, [
    'foody_entregas?select=data_local,unidade,turno,entregador,coleta,despacho,entrega,importado_em&data_local=eq.2026-11-11&unidade=eq.AHU&order=uid.asc&limit=250&offset=0',
    'trackeat_api_entregas?select=data_local,unidade,turno,entregador,coleta,saida,entrega,importado_em&data_local=eq.2026-11-11&unidade=eq.AHU&order=id_delivery.asc&limit=250&offset=0'
  ]);
  assert.ok(!t2.chamadas.some((c) => /endereco|coord|comentario|pix|cliente|payload|status|valor/i.test(c.url)));
});

test('403 da escala = "ainda não liberada", nunca lista vazia; 401 = sessão, sem dados', async () => {
  const t = montar({ resposta: () => erro(403) });
  const r = await t.dd.ler('escala', '2026-11-11', sempre);
  assert.equal(r.fase, 'pronto');
  assert.equal(r.resultado.estado, 'naoliberada');
  assert.equal(r.resultado.mensagem, 'A leitura da escala ainda não foi liberada');
  assert.deepEqual(r.resultado.linhas, []);
  const h = OP.render('escala', { dia: '2026-11-11', loja: 'AHU', dados: r });
  assert.match(h, /ainda não foi liberada/);
  assert.doesNotMatch(h, /Sem linhas de escala|<table|detalhe privado/);
  for (const aba of ['escala', 'chegada']) {
    const t2 = montar({ resposta: () => erro(401) });
    const r2 = await t2.dd.ler(aba, '2026-11-11', sempre);
    assert.deepEqual(r2, { fase: 'sessao' });
  }
});

test('allowlist vazia, loja fora da lista, REDE sem permissão, lojas não carregadas e dia inválido: nenhuma consulta', async () => {
  const casos = [
    { info: { lojas: [] } }, { info: null }, { info: { lojas: ['AHU'] }, loja: 'OUTRA LOJA' },
    { info: { lojas: ['AHU', 'SÃO BRAZ'] }, loja: 'REDE' }, { info: { lojas: ['AHU'] }, loja: null }
  ];
  for (const c of casos) {
    for (const aba of ['escala', 'chegada']) {
      const t = montar({ ...c, resposta: () => ok([]) });
      const r = await t.dd.ler(aba, '2026-11-11', sempre);
      assert.equal(r.fase, 'aviso');
      assert.equal(t.chamadas.length, 0);
    }
  }
  const t = montar({ resposta: () => ok([]) });
  assert.equal((await t.dd.ler('escala', '2026-02-30', sempre)).fase, 'aviso');
  assert.equal(t.chamadas.length, 0);
  const sem = montar({ info: null, resposta: () => ok([]) });
  assert.match((await sem.dd.ler('escala', '2026-11-11', sempre)).mensagem, /Carregando as lojas autorizadas/);
});

test('REDE consulta uma loja concreta por vez e nunca manda "REDE" ao filtro', async () => {
  const t = montar({ lojas: ['AHU', 'SÃO BRAZ', 'REDE'], loja: 'REDE', resposta: () => ok([]) });
  await t.dd.ler('escala', '2026-11-11', sempre);
  assert.equal(t.chamadas.length, 2);
  assert.ok(t.chamadas.every((c) => !c.url.includes('REDE')));
});

test('linhas de loja alheia ou de outro dia são descartadas mesmo se o servidor mandar', async () => {
  const t = montar({ resposta: (u) => (u.startsWith('motoboy_escala')
    ? ok([escRow(), escRow({ unidade: 'LOJA ALHEIA', nome_na_escala: 'Alheio Teste' }), escRow({ dia: '2026-11-10', nome_na_escala: 'Ontem Teste' })])
    : u.startsWith('foody')
      ? ok([fRow(), fRow({ unidade: 'LOJA ALHEIA', entregador: 'Alheio Teste' })]) : ok([])) });
  const e = await t.dd.ler('escala', '2026-11-11', sempre);
  assert.deepEqual(e.resultado.linhas.map((l) => l.nome), ['Fulano Teste']);
  const a = await t.dd.ler('chegada', '2026-11-11', sempre);
  assert.deepEqual(a.resultado.linhas.map((l) => l.motoboy), ['Fulano Teste']);
});

test('trocar dia, loja ou sessão no meio da leitura descarta a resposta antiga', async () => {
  const d = defer();
  const t = montar({ resposta: () => d.p });
  let vig = true;
  const p = t.dd.ler('escala', '2026-11-11', () => vig);
  await settle();
  vig = false; // trocou dia/sessão
  d.res(ok([escRow()]));
  const r = await p;
  assert.deepEqual(r, { fase: 'descartado' });
  const d2 = defer();
  const t2 = montar({ resposta: () => d2.p });
  const p2 = t2.dd.ler('chegada', '2026-11-11', sempre);
  await settle();
  t2.est.loja = 'SÃO BRAZ'; // trocou a loja
  d2.res(ok([fRow()]));
  assert.deepEqual(await p2, { fase: 'descartado' });
});

test('limite: 8 páginas de 250 com a última cheia = PARCIAL; fim exato em página cheia + vazia = completo', async () => {
  const cheia = Array.from({ length: 250 }, (_, i) => escRow({ nome_na_escala: 'Teste ' + i }));
  const t = montar({ resposta: () => ok(cheia) });
  const r = await t.dd.ler('escala', '2026-11-11', sempre);
  assert.equal(t.chamadas.length, 8);
  assert.deepEqual(t.chamadas.map((c) => +/offset=(\d+)/.exec(c.url)[1]), [0, 250, 500, 750, 1000, 1250, 1500, 1750]);
  assert.equal(r.resultado.estado, 'parcial');
  assert.equal(r.resultado.parcial, true);
  assert.equal(r.resultado.linhas.length, 2000);
  assert.match(OP.render('escala', { dia: '2026-11-11', loja: 'AHU', dados: r }), /Parcial/);
  let n = 0;
  const t2 = montar({ resposta: () => (n++ === 0 ? ok(cheia) : ok([])) });
  const r2 = await t2.dd.ler('escala', '2026-11-11', sempre);
  assert.equal(t2.chamadas.length, 2);
  assert.equal(r2.resultado.estado, 'ok');
});

test('JSON inválido ou resposta que não é lista: falha sem dados', async () => {
  const t = montar({ resposta: () => ({ ok: true, status: 200, json: async () => { throw new Error('x'); } }) });
  const r = await t.dd.ler('escala', '2026-11-11', sempre);
  assert.equal(r.resultado.estado, 'falha');
  assert.deepEqual(r.resultado.linhas, []);
  const t2 = montar({ resposta: () => ok({ nao: 'lista' }) });
  assert.equal((await t2.dd.ler('escala', '2026-11-11', sempre)).resultado.estado, 'falha');
  const t3 = montar({ resposta: () => { throw new Error('rede'); } });
  assert.equal((await t3.dd.ler('chegada', '2026-11-11', sempre)).resultado.estado, 'falha');
});

test('nomes com HTML saem escapados na Chegada e na Escala', async () => {
  const mau = '<img src=x onerror=alert(1)>';
  const t = montar({ resposta: (u) => (u.startsWith('motoboy_escala') ? ok([escRow({ nome_na_escala: mau })]) : u.startsWith('foody') ? ok([fRow({ entregador: mau })]) : ok([])) });
  const a = await t.dd.ler('chegada', '2026-11-11', sempre);
  const e = await t.dd.ler('escala', '2026-11-11', sempre);
  for (const h of [OP.render('chegada', { dia: '2026-11-11', loja: 'AHU', dados: a }), OP.render('escala', { dia: '2026-11-11', loja: 'AHU', dados: e })]) {
    assert.doesNotMatch(h, /<img/);
    assert.match(h, /&lt;img/);
  }
});

test('evento de madrugada aparece como dia seguinte e nunca como hora de chegada', async () => {
  // 05:10 UTC do dia 12 = 02:10 em São Paulo, dia seguinte ao dia consultado (11)
  const t = montar({ resposta: (u) => (u.startsWith('foody') ? ok([fRow({ coleta: '2026-11-12T05:10:00+00:00', entrega: null })]) : ok([])) });
  const r = await t.dd.ler('chegada', '2026-11-11', sempre);
  assert.equal(r.resultado.linhas[0].chegadaRegistrada, null);
  const h = OP.render('chegada', { dia: '2026-11-11', loja: 'AHU', dados: r });
  assert.match(h, /12\/11 02:10 \(dia seguinte\)/);
  assert.match(h, /<dt>Chegada registrada<\/dt><dd class="op-vazio">Ainda não ligado<\/dd>/);
  assert.match(h, /Chegada a conferir/);
  const tabela = /<tbody>[\s\S]*<\/tbody>/.exec(h)[0];
  assert.doesNotMatch(tabela, /chegou|chegada às|atras|falt|garantido|pagamento/i); // a linha nunca afirma chegada, atraso ou falta
  assert.doesNotMatch(h, /garantido|pagamento|Ao vivo/i);
  assert.equal(OP.fmtSP('2026-11-11T21:30:00+00:00', '2026-11-11'), '18:30');
  assert.equal(OP.fmtSP('2026-11-09T21:30:00+00:00', '2026-11-11'), '09/11 18:30');
  assert.equal(OP.fmtSP('lixo', '2026-11-11'), null);
});

test('sem atividade com as duas fontes lidas: mensagem que não comprova falta; com fonte falha: outra mensagem', async () => {
  const t = montar({ resposta: () => ok([]) });
  const r = await t.dd.ler('chegada', '2026-11-11', sempre);
  assert.match(OP.render('chegada', { dia: '2026-11-11', loja: 'AHU', dados: r }), /Não há atividade recebida para esse dia; isso não comprova falta\./);
  const t2 = montar({ resposta: (u) => (u.startsWith('foody') ? erro(500) : ok([])) });
  const h2 = OP.render('chegada', { dia: '2026-11-11', loja: 'AHU', dados: await t2.dd.ler('chegada', '2026-11-11', sempre) });
  assert.doesNotMatch(h2, /Não há atividade recebida/);
  assert.match(h2, /não foi lida por completo/);
  assert.match(h2, /Tentar de novo/);
});

test('escala: janela mesmo dia, dia seguinte e horário a conferir; sem horário inventado', async () => {
  const t = montar({ resposta: () => ok([escRow({ nome_na_escala: 'A Teste', inicio: '10:00:00', fim: '15:00:00' }),
    escRow({ nome_na_escala: 'B Teste', inicio: '22:00:00', fim: '03:00:00' }), escRow({ nome_na_escala: 'C Teste', inicio: '10:00:00', fim: '10:00:00' }),
    escRow({ nome_na_escala: 'D Teste', inicio: null, fim: null, gravado_em: null })]) });
  const r = await t.dd.ler('escala', '2026-11-11', sempre);
  const h = OP.render('escala', { dia: '2026-11-11', loja: 'AHU', dados: r });
  assert.match(h, /Termina no mesmo dia/);
  assert.match(h, /Termina no dia seguinte/);
  assert.equal((h.match(/Horário a conferir/g) || []).length, 2);
  assert.match(h, /sem hora de gravação/);
});
