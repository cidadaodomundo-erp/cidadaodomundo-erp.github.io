// node --test supabase/functions/fabio-delivery-chegada/leitura.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { responder, criarLimitador, corsHeaders, diaOperacional, hmDe, unidadeCanonica, ERP_URL, ERP_ANON_KEY, ORIGEM } from './leitura.mjs';

const JWT = 'aaa.bbb.ccc';
const AGORA = Date.parse('2026-11-12T18:00:00Z');   // 15:00 BRT, dia operacional 2026-11-12

function erp(over = {}) {
  const cfg = {
    user: { status: 200, body: { id: 'u1', email: 'x@y', user_metadata: { lojas: ['REDE'], modulos: ['delivery'] } } },
    eh_dono: false, pode_ver_pessoal: true, meus_modulos: null,
    painel_minhas_lojas: [{ lojas: ['AGUA VERDE'], loja_inicial: 'AGUA VERDE', travado: true }], ...over,
  };
  const chamadas = [];
  const f = async (url, init) => {
    chamadas.push({ url, init });
    if (url === ERP_URL + '/auth/v1/user') {
      if (cfg.user instanceof Error) throw cfg.user;
      return new Response(JSON.stringify(cfg.user.body), { status: cfg.user.status });
    }
    const m = /\/rest\/v1\/rpc\/(\w+)$/.exec(url);
    if (m && m[1] in cfg) {
      const v = cfg[m[1]];
      if (v && v.__status) return new Response('erro', { status: v.__status });
      if (v && v.__bruto !== undefined) return new Response(v.__bruto, { status: 200 });
      return new Response(JSON.stringify(v), { status: 200 });
    }
    throw new Error('url inesperada');
  };
  f.chamadas = chamadas;
  return f;
}
// formato exato de fabio_delivery.chegada_consulta (docs/chegada-instalacao.sql)
const linha = (o = {}) => ({
  unidade: 'AGUA VERDE', motoboy: 'Moto A', n_turno: 1, na_escala: true, vivo_rodando: false,
  escala_txt: '18:00', escala_saida_txt: '23:00', limite_txt: '18:30',
  chegada_fila_txt: '17:55:07', chegada_fila_em: '2026-11-12T20:55:07+00:00', patio_gps_txt: null, anotado_txt: null,
  chegou_txt: '17:55', chegou_fonte: 'fila', primeira_entrega_txt: null,
  saida_registrada_txt: '18:10:42', tempo_registrado_min: 16, tempo_fonte: 'fila',
  direito: 'ok', garantido_perdido: false, motivo_sem_prova: null, atraso_min: -5,
  garantido_manual: null, garantido_motivo: null, rango_manual: null, rango_motivo: null, ...o,
});
const consulta = (linhas, o = {}) => ({ dia: '2026-11-12', hoje: '2026-11-12', ao_vivo: true, consultado_em: '2026-11-12T18:00:00.123-03:00', unidade: 'AGUA VERDE', robo: { atualizado_em: '2026-11-12T17:59:00Z', ok: true }, linhas, ...o });
function db(mapa) {
  const f = async (dia, unidades) => {
    f.chamadas.push({ dia, unidades });
    return unidades.map((u) => (mapa[u] === undefined ? { unidade: u, ok: false, valor: null } : { unidade: u, ok: true, valor: mapa[u] }));
  };
  f.chamadas = [];
  return f;
}
async function chamar(o = {}) {
  const fetchImpl = o.fetchImpl || erp(o.erp);
  const lerConsulta = o.lerConsulta || db({ 'AGUA VERDE': consulta([linha()]) });
  const r = await responder({
    metodo: 'GET', origem: ORIGEM, authorization: 'Bearer ' + JWT, query: { dia: '2026-11-12', unidade: 'AGUA VERDE' },
    agora: () => AGORA, timeoutMs: 50, limitador: criarLimitador(), fetchImpl, lerConsulta, ...(o.c || {}),
  });
  return { r, fetchImpl, lerConsulta };
}
const rpcs = (f) => f.chamadas.filter((x) => x.url.includes('/rpc/')).length;

test('caminho feliz: autentica no ERP com chave pública ERP, devolve linhas projetadas', async () => {
  const { r, fetchImpl, lerConsulta } = await chamar();
  assert.equal(r.status, 200);
  assert.equal(r.corpo.unidade, 'AGUA VERDE');
  assert.deepEqual(r.corpo.unidades, ['AGUA VERDE']);
  assert.equal(r.corpo.por_unidade[0].status, 'ok');
  assert.equal(r.corpo.por_unidade[0].linhas.length, 1);
  assert.equal(r.corpo.por_unidade[0].consultado_em, '2026-11-12T21:00:00.123Z');
  assert.equal(fetchImpl.chamadas[0].url, ERP_URL + '/auth/v1/user');
  for (const ch of fetchImpl.chamadas) {
    assert.ok(ch.url.startsWith(ERP_URL));
    assert.equal(ch.init.headers.apikey, ERP_ANON_KEY);
    assert.equal(ch.init.headers.Authorization, 'Bearer ' + JWT);
  }
  assert.deepEqual(lerConsulta.chamadas, [{ dia: '2026-11-12', unidades: ['AGUA VERDE'] }]);
  assert.ok(!JSON.stringify(r.corpo).includes('x@y'));
});

test('sem JWT / JWT malformado: 401 sem rede e sem banco', async () => {
  for (const a of [null, '', 'Basic abc', 'Bearer nao-jwt', 'Bearer ' + 'a'.repeat(5000) + '.b.c']) {
    const { r, fetchImpl, lerConsulta } = await chamar({ c: { authorization: a } });
    assert.equal(r.status, 401);
    assert.equal(fetchImpl.chamadas.length, 0);
    assert.equal(lerConsulta.chamadas.length, 0);
  }
});

test('auth recusada: 401, nenhuma RPC e nenhum banco', async () => {
  for (const status of [401, 403]) {
    const { r, fetchImpl, lerConsulta } = await chamar({ erp: { user: { status, body: {} } } });
    assert.equal(r.status, 401);
    assert.equal(rpcs(fetchImpl), 0);
    assert.equal(lerConsulta.chamadas.length, 0);
  }
  const { r } = await chamar({ erp: { user: { status: 200, body: { email: 'sem id' } } } });
  assert.equal(r.status, 401);
});

test('auth indisponível (erro de rede, 500, timeout): 502, sem banco', async () => {
  for (const user of [new Error('rede'), { status: 500, body: {} }]) {
    const { r, lerConsulta } = await chamar({ erp: { user } });
    assert.equal(r.status, 502); assert.equal(r.corpo.erro, 'auth_indisponivel'); assert.equal(lerConsulta.chamadas.length, 0);
  }
  const pendurado = (url, init) => new Promise((_, rej) => init.signal.addEventListener('abort', () => rej(new Error('abort'))));
  const { r, lerConsulta } = await chamar({ fetchImpl: pendurado, c: { timeoutMs: 20 } });
  assert.equal(r.status, 502); assert.equal(lerConsulta.chamadas.length, 0);
});

test('permissão: precisa dono OU pessoal', async () => {
  let x = await chamar({ erp: { eh_dono: false, pode_ver_pessoal: false } });
  assert.equal(x.r.status, 403); assert.equal(x.lerConsulta.chamadas.length, 0);
  x = await chamar({ erp: { eh_dono: null, pode_ver_pessoal: null } });
  assert.equal(x.r.status, 403);
  x = await chamar({ erp: { eh_dono: true, pode_ver_pessoal: false } });
  assert.equal(x.r.status, 200);
});

test('permissão: meus_modulos null ou com delivery; sem delivery = 403', async () => {
  assert.equal((await chamar({ erp: { meus_modulos: null } })).r.status, 200);
  assert.equal((await chamar({ erp: { meus_modulos: ['vendas', 'Delivery'] } })).r.status, 200);
  const x = await chamar({ erp: { meus_modulos: ['vendas'] } });
  assert.equal(x.r.status, 403); assert.equal(x.r.corpo.erro, 'sem_modulo'); assert.equal(x.lerConsulta.chamadas.length, 0);
  assert.equal((await chamar({ erp: { meus_modulos: [] } })).r.status, 403);
});

test('erro de RPC nunca vira null nem permissão', async () => {
  for (const fn of ['eh_dono', 'pode_ver_pessoal', 'meus_modulos', 'painel_minhas_lojas']) {
    const x = await chamar({ erp: { eh_dono: true, [fn]: { __status: 500 } } });
    assert.equal(x.r.status, 502, fn); assert.equal(x.lerConsulta.chamadas.length, 0);
  }
  const x = await chamar({ erp: { meus_modulos: { __bruto: 'não json' } } });
  assert.equal(x.r.status, 502); assert.equal(x.r.corpo.erro, 'rpc_formato');
});

test('RPC malformada: 502 rpc_formato', async () => {
  for (const over of [{ eh_dono: 'true' }, { pode_ver_pessoal: 1 }, { meus_modulos: {} }, { meus_modulos: [1] }, { meus_modulos: 'delivery' },
    { painel_minhas_lojas: { lojas: ['AGUA VERDE'] } }, { painel_minhas_lojas: [{ lojas: 'AGUA VERDE' }] },
    { painel_minhas_lojas: [{ lojas: ['AGUA VERDE'] }, { lojas: ['AHU'] }] }, { painel_minhas_lojas: [null] }]) {
    const x = await chamar({ erp: over });
    assert.equal(x.r.status, 502, JSON.stringify(over)); assert.equal(x.r.corpo.erro, 'rpc_formato'); assert.equal(x.lerConsulta.chamadas.length, 0);
  }
  const x = await chamar({ erp: { painel_minhas_lojas: [] } });
  assert.equal(x.r.status, 403); assert.equal(x.r.corpo.erro, 'sem_lojas');
});

test('loja fora da lista: 403; user_metadata ignorado', async () => {
  let x = await chamar({ c: { query: { dia: '2026-11-12', unidade: 'AHU' } } });
  assert.equal(x.r.status, 403); assert.equal(x.lerConsulta.chamadas.length, 0);
  x = await chamar({ c: { query: { dia: '2026-11-12', unidade: 'REDE' } } });   // metadata diz REDE, painel não
  assert.equal(x.r.status, 403); assert.equal(x.lerConsulta.chamadas.length, 0);
});

test('REDE: só com REDE na lista, expande apenas lojas reais autorizadas', async () => {
  const lerConsulta = db({ 'SAO BRAZ': consulta([linha({ unidade: 'SAO BRAZ' })], { unidade: 'SAO BRAZ' }), AHU: consulta([linha({ unidade: 'AHU' })], { unidade: 'AHU' }) });
  const x = await chamar({ lerConsulta, erp: { painel_minhas_lojas: [{ lojas: ['AHU', 'REDE', 'São Braz', 'BATEL'], loja_inicial: 'REDE', travado: false }] }, c: { query: { dia: '2026-11-12', unidade: 'rede' } } });
  assert.equal(x.r.status, 200);
  assert.deepEqual(lerConsulta.chamadas[0].unidades, ['SAO BRAZ', 'AHU']);
  assert.deepEqual(x.r.corpo.por_unidade.map((p) => [p.unidade, p.status]), [['SAO BRAZ', 'ok'], ['AHU', 'ok']]);
  const y = await chamar({ erp: { painel_minhas_lojas: [{ lojas: ['REDE'] }] }, c: { query: { dia: '2026-11-12', unidade: 'REDE' } } });
  assert.equal(y.r.status, 403); assert.equal(y.lerConsulta.chamadas.length, 0);
});

test('SAO BRAZ com acento normaliza', async () => {
  const lerConsulta = db({ 'SAO BRAZ': consulta([linha({ unidade: 'São Braz' })], { unidade: 'São Braz' }) });
  const x = await chamar({ lerConsulta, erp: { painel_minhas_lojas: [{ lojas: ['SÃO BRAZ'] }] }, c: { query: { dia: '2026-11-12', unidade: 'São Braz' } } });
  assert.equal(x.r.status, 200);
  assert.deepEqual(lerConsulta.chamadas[0].unidades, ['SAO BRAZ']);
  assert.equal(x.r.corpo.por_unidade[0].linhas[0].unidade, 'SAO BRAZ');
});

test('unidades reais do banco antigo (título) e do ERP (maiúscula) normalizam nos dois sentidos', async () => {
  for (const [titulo, canon] of [['Água Verde', 'AGUA VERDE'], ['Ahú', 'AHU'], ['São Braz', 'SAO BRAZ']]) {
    assert.equal(unidadeCanonica(titulo), canon);
    assert.equal(unidadeCanonica(canon), canon);
    assert.equal(unidadeCanonica('  ' + titulo.toLowerCase() + ' '), canon);
    const lerConsulta = db({ [canon]: consulta([linha({ unidade: titulo })], { unidade: titulo }) });
    const x = await chamar({ lerConsulta, erp: { painel_minhas_lojas: [{ lojas: [titulo] }] }, c: { query: { dia: '2026-11-12', unidade: titulo } } });
    assert.equal(x.r.status, 200, titulo);
    assert.deepEqual(lerConsulta.chamadas[0].unidades, [canon]);   // banco recebe canônica; SQL converte para o título
    assert.equal(x.r.corpo.unidade, canon);
    assert.equal(x.r.corpo.por_unidade[0].unidade, canon);
    assert.equal(x.r.corpo.por_unidade[0].linhas[0].unidade, canon);
  }
  // linha de outra loja real (título) derruba só a loja
  const x = await chamar({ lerConsulta: db({ 'AGUA VERDE': consulta([linha({ unidade: 'Ahú' })]) }) });
  assert.equal(x.r.status, 502);
});

test('unidade inválida: 400 sem banco', async () => {
  for (const unidade of [null, '', 'BATEL', 'AGUA', 'REDE;drop']) {
    const x = await chamar({ c: { query: { dia: '2026-11-12', unidade } } });
    assert.equal(x.r.status, 400); assert.equal(x.r.corpo.erro, 'unidade_invalida'); assert.equal(x.lerConsulta.chamadas.length, 0);
  }
});

test('data: calendário real, sem futuro, janela de 60 dias', async () => {
  for (const [dia, erro] of [['2026-02-30', 'dia_invalido'], ['2026-11-1', 'dia_invalido'], [null, 'dia_invalido'], ['2026-11-13', 'dia_futuro'], ['2026-09-12', 'dia_fora_da_janela']]) {
    const x = await chamar({ c: { query: { dia, unidade: 'AGUA VERDE' } } });
    assert.equal(x.r.status, 400, String(dia)); assert.equal(x.r.corpo.erro, erro); assert.equal(x.lerConsulta.chamadas.length, 0);
  }
  const lerConsulta = db({ 'AGUA VERDE': consulta([], { dia: '2026-09-13', ao_vivo: false }) });
  assert.equal((await chamar({ lerConsulta, c: { query: { dia: '2026-09-13', unidade: 'AGUA VERDE' } } })).r.status, 200);
});

test('dia operacional vira às 05:00 BRT', async () => {
  assert.equal(diaOperacional(Date.parse('2026-11-13T07:59:00Z')), '2026-11-12');
  assert.equal(diaOperacional(Date.parse('2026-11-13T08:00:00Z')), '2026-11-13');
  let x = await chamar({ c: { agora: () => Date.parse('2026-11-13T07:59:00Z'), query: { dia: '2026-11-13', unidade: 'AGUA VERDE' } } });
  assert.equal(x.r.status, 400);
  const lerConsulta = db({ 'AGUA VERDE': consulta([], { dia: '2026-11-13', hoje: '2026-11-13' }) });
  x = await chamar({ lerConsulta, c: { agora: () => Date.parse('2026-11-13T08:00:00Z'), query: { dia: '2026-11-13', unidade: 'AGUA VERDE' } } });
  assert.equal(x.r.status, 200); assert.equal(x.r.corpo.dia_operacional, '2026-11-13');
});

test('método, OPTIONS e origem', async () => {
  let x = await chamar({ c: { metodo: 'POST' } });
  assert.equal(x.r.status, 405); assert.equal(x.fetchImpl.chamadas.length, 0);
  x = await chamar({ c: { metodo: 'OPTIONS' } });
  assert.equal(x.r.status, 204); assert.equal(x.r.corpo, null); assert.equal(x.fetchImpl.chamadas.length, 0);
  x = await chamar({ c: { origem: 'https://malicioso.example' } });
  assert.equal(x.r.status, 403); assert.equal(x.fetchImpl.chamadas.length, 0); assert.equal(x.lerConsulta.chamadas.length, 0);
  x = await chamar({ c: { origem: '' } });   // servidor autenticado sem Origin
  assert.equal(x.r.status, 200);
  assert.equal(corsHeaders(ORIGEM)['Access-Control-Allow-Origin'], ORIGEM);
  assert.equal(corsHeaders('https://malicioso.example')['Access-Control-Allow-Origin'], undefined);
  assert.equal(corsHeaders('')['Access-Control-Allow-Origin'], undefined);
  assert.match(corsHeaders(ORIGEM)['Cache-Control'], /no-store/);
  assert.equal(corsHeaders(ORIGEM)['Access-Control-Allow-Methods'], 'GET, OPTIONS');
});

test('limite: 12 por minuto por usuário; 13ª = 429 sem banco', async () => {
  let t = 0; const limitador = criarLimitador({ agora: () => t });
  const lerConsulta = db({ 'AGUA VERDE': consulta([linha()]) });
  for (let i = 0; i < 12; i++) assert.equal((await chamar({ lerConsulta, c: { limitador } })).r.status, 200);
  const x = await chamar({ lerConsulta, c: { limitador } });
  assert.equal(x.r.status, 429); assert.equal(lerConsulta.chamadas.length, 12);
  t = 60000; assert.equal((await chamar({ lerConsulta, c: { limitador } })).r.status, 200);
  const l2 = criarLimitador({ maxUsuarios: 3 }); for (let i = 0; i < 10; i++) l2.permitir('u' + i);
  assert.ok(l2.tamanho() <= 3);
});

test('falha de banco: 502, nunca lista vazia', async () => {
  let x = await chamar({ lerConsulta: async () => { throw new Error('conexão'); } });
  assert.equal(x.r.status, 502); assert.deepEqual(x.r.corpo, { erro: 'consulta_indisponivel' });
  x = await chamar({ lerConsulta: async () => 'lixo' });
  assert.equal(x.r.status, 502);
  x = await chamar({ lerConsulta: db({}) });
  assert.equal(x.r.status, 502);
});

test('REDE com uma loja falhando: essa loja indisponível (linhas null), outra ok', async () => {
  const lerConsulta = db({ AHU: consulta([linha({ unidade: 'AHU' })], { unidade: 'AHU' }) });
  const x = await chamar({ lerConsulta, erp: { painel_minhas_lojas: [{ lojas: ['REDE', 'AGUA VERDE', 'AHU'] }] }, c: { query: { dia: '2026-11-12', unidade: 'REDE' } } });
  assert.equal(x.r.status, 200);
  const av = x.r.corpo.por_unidade.find((p) => p.unidade === 'AGUA VERDE');
  assert.equal(av.status, 'indisponivel'); assert.equal(av.linhas, null);
});

test('resposta malformada ou de outra loja: indisponível', async () => {
  const casos = [
    consulta([linha({ unidade: 'AHU' })]), consulta('x'), consulta([linha()], { dia: '2026-11-11' }), consulta([linha()], { ao_vivo: 'sim' }),
    consulta([linha()], { consultado_em: 'ontem' }), consulta([linha()], { unidade: 'AHU' }), consulta([linha({ motoboy: '' })]),
    consulta([null]), consulta(Array.from({ length: 501 }, () => linha())), null, [],
    consulta([linha()], { unidade: undefined }), consulta([linha({ n_turno: undefined })]), consulta([linha({ n_turno: '1' })]),
    consulta([linha({ n_turno: 1.5 })]), consulta([linha({ n_turno: null })]),
  ];
  for (const v of casos) {
    const x = await chamar({ lerConsulta: db({ 'AGUA VERDE': v }) });
    assert.equal(x.r.status, 502, JSON.stringify(v).slice(0, 80));
  }
});

test('13/11: fim do turno e fonte da fila passam validados; formato errado vira null e conta inválido', async () => {
  const boa = linha({ chegada_fila_fonte: 'site', ultima_entrega_txt: '22:40', ultimo_patio_txt: '22:58', ultimo_sinal_txt: '23:01', sinal_min: 2950 });
  let x = await chamar({ lerConsulta: db({ 'AGUA VERDE': consulta([boa]) }) });
  let l = x.r.corpo.por_unidade[0].linhas[0];
  assert.equal(l.chegada_fila_fonte, 'site');
  assert.equal(l.ultima_entrega_txt, '22:40');
  assert.equal(l.ultimo_patio_txt, '22:58');
  assert.equal(l.ultimo_sinal_txt, '23:01');
  assert.equal(l.sinal_min, 2950, 'histórico pode passar de 1 dia sem virar inválido');
  assert.equal(l.saida_registrada_txt, '18:10:42', 'saída registrada continua só a batida');
  assert.equal(x.r.corpo.por_unidade[0].campos_invalidos, 0);
  const ruim = linha({ chegada_fila_fonte: 'whatsapp', ultima_entrega_txt: 'ontem', ultimo_patio_txt: 25, sinal_min: -3 });
  x = await chamar({ lerConsulta: db({ 'AGUA VERDE': consulta([ruim]) }) });
  l = x.r.corpo.por_unidade[0].linhas[0];
  assert.equal(l.chegada_fila_fonte, null);
  assert.equal(l.ultima_entrega_txt, null);
  assert.equal(l.ultimo_patio_txt, null);
  assert.equal(l.sinal_min, null);
  assert.equal(x.r.corpo.por_unidade[0].campos_invalidos, 4);
  x = await chamar({ lerConsulta: db({ 'AGUA VERDE': consulta([linha()]) }) });
  l = x.r.corpo.por_unidade[0].linhas[0];
  assert.equal(l.ultima_entrega_txt, null, 'sem o campo = null, sem inventar');
  assert.equal(x.r.corpo.por_unidade[0].campos_invalidos, 0);
});

test('projeção allowlist: nada de quem, contato ou payload', async () => {
  const extra = linha({ quem: 'fulano@x', telefone: '41999999999', cpf: '123', payload: { a: 1 }, user_metadata: { b: 2 }, token: 't', motoboy: 'Moto\u0000 B' });
  const x = await chamar({ lerConsulta: db({ 'AGUA VERDE': consulta([extra], { quem: 'z', indicadores: { total: 9 }, robo: { atualizado_em: '2026-11-12T17:59:00Z', ok: true, log: 'segredo' } }) }) });
  assert.equal(x.r.status, 200);
  const u = x.r.corpo.por_unidade[0];
  assert.deepEqual(Object.keys(u).sort(), ['ao_vivo', 'campos_invalidos', 'consultado_em', 'hoje', 'linhas', 'robo', 'status', 'unidade']);
  assert.deepEqual(Object.keys(u.robo).sort(), ['atualizado_em', 'ok']);
  assert.deepEqual(Object.keys(u.linhas[0]).sort(), ['anotado_txt', 'atraso_min', 'chegada_fila_em', 'chegada_fila_fonte', 'chegada_fila_txt', 'chegou_fonte', 'chegou_txt', 'direito',
    'escala_saida_txt', 'escala_txt', 'garantido_manual', 'garantido_motivo', 'garantido_perdido', 'limite_txt', 'motivo_sem_prova', 'motoboy', 'n_turno',
    'na_escala', 'patio_gps_txt', 'primeira_entrega_txt', 'rango_manual', 'rango_motivo', 'saida_registrada_txt', 'sinal_min', 'tempo_fonte', 'tempo_registrado_min',
    'ultima_entrega_txt', 'ultimo_patio_txt', 'ultimo_sinal_txt', 'unidade', 'vivo_rodando']);
  const txt = JSON.stringify(x.r.corpo);
  for (const s of ['fulano', '4199', 'cpf', 'payload', 'metadata', 'segredo', 'indicadores', '"quem"', 'token', 'override', 'motivos']) assert.ok(!txt.includes(s), s);
  assert.equal(u.linhas[0].motoboy, 'Moto B');
});

test('horários preservam HH:MM:SS quando presentes (fila e saída QR); HH:MM continua HH:MM', async () => {
  assert.equal(hmDe('17:55:07'), '17:55:07');
  assert.equal(hmDe('17:55:07.123456'), '17:55:07');
  assert.equal(hmDe('17:55'), '17:55');
  for (const v of ['24:00', '17:5', '17:55:60', '17h55', 1755, null]) assert.equal(hmDe(v), null, String(v));
  const x = await chamar();
  const o = x.r.corpo.por_unidade[0].linhas[0];
  assert.equal(o.chegada_fila_txt, '17:55:07'); assert.equal(o.saida_registrada_txt, '18:10:42');
  assert.equal(o.chegada_fila_em, '2026-11-12T20:55:07.000Z');
  assert.equal(o.escala_txt, '18:00'); assert.equal(o.chegou_txt, '17:55');
  assert.equal(o.tempo_registrado_min, 16); assert.equal(o.tempo_fonte, 'fila');
  assert.equal(o.n_turno, 1); assert.equal(o.atraso_min, -5); assert.equal(o.limite_txt, '18:30');
});

test('primeira entrega fica separada: não vira chegada nem sustenta tempo', async () => {
  // SQL manda 1ª entrega só em primeira_entrega_txt; chegou_* null; sem fila/pátio, tempo null
  const l = linha({ chegada_fila_txt: null, chegada_fila_em: null, chegou_txt: null, chegou_fonte: null, primeira_entrega_txt: '18:20',
    tempo_registrado_min: 40, tempo_fonte: null, direito: 'perdeu', garantido_perdido: true, atraso_min: 50 });
  // fonte forjada como texto livre não é aceita
  const forjada = linha({ motoboy: 'Moto D', chegou_txt: '18:20', chegou_fonte: '1ª entrega', tempo_fonte: 'primeira_entrega' });
  const x = await chamar({ lerConsulta: db({ 'AGUA VERDE': consulta([l, forjada]) }) });
  const [a, b] = x.r.corpo.por_unidade[0].linhas;
  assert.equal(a.chegou_txt, null); assert.equal(a.chegou_fonte, null); assert.equal(a.primeira_entrega_txt, '18:20');
  assert.equal(a.tempo_registrado_min, null); assert.equal(a.tempo_fonte, null);
  assert.equal(a.direito, 'perdeu'); assert.equal(a.garantido_perdido, true); assert.equal(a.atraso_min, 50);   // regra herdada intacta
  assert.equal(b.chegou_txt, null); assert.equal(b.chegou_fonte, null); assert.equal(b.tempo_registrado_min, null);
  assert.equal(x.r.corpo.por_unidade[0].campos_invalidos, 3);   // chegou_fonte, chegou_txt sem fonte, tempo_fonte
});

test('tempo: pátio GPS vale; anotado NÃO legitima tempo; sem saída QR ou sem início real = null', async () => {
  const gps = linha({ chegada_fila_txt: null, chegada_fila_em: null, patio_gps_txt: '17:50:12', chegou_txt: '17:50', chegou_fonte: 'patio_gps', tempo_registrado_min: 20, tempo_fonte: 'patio_gps' });
  const anot = linha({ motoboy: 'Moto C', chegada_fila_txt: null, chegada_fila_em: null, chegou_txt: null, chegou_fonte: null, anotado_txt: '17:40', tempo_registrado_min: 30, tempo_fonte: 'fila' });
  const semSaida = linha({ motoboy: 'Moto E', saida_registrada_txt: null });
  const semPatio = linha({ motoboy: 'Moto F', tempo_fonte: 'patio_gps', patio_gps_txt: null });
  const x = await chamar({ lerConsulta: db({ 'AGUA VERDE': consulta([gps, anot, semSaida, semPatio]) }) });
  const [a, b, c, d] = x.r.corpo.por_unidade[0].linhas;
  assert.equal(a.patio_gps_txt, '17:50:12'); assert.equal(a.chegou_txt, '17:50'); assert.equal(a.chegou_fonte, 'patio_gps');
  assert.equal(a.tempo_registrado_min, 20); assert.equal(a.tempo_fonte, 'patio_gps');
  assert.equal(b.anotado_txt, '17:40'); assert.equal(b.tempo_registrado_min, null); assert.equal(b.tempo_fonte, null); assert.equal(b.chegou_txt, null);
  assert.equal(c.tempo_registrado_min, null); assert.equal(d.tempo_registrado_min, null);
});

test('overrides manuais separados por direito (garantido x rango)', async () => {
  const l = linha({ n_turno: 2, garantido_manual: false, garantido_motivo: 'combinado\u0007 com Jaison', rango_manual: true, rango_motivo: null });
  const x = await chamar({ lerConsulta: db({ 'AGUA VERDE': consulta([l]) }) });
  const o = x.r.corpo.por_unidade[0].linhas[0];
  assert.equal(o.n_turno, 2);
  assert.equal(o.garantido_manual, false); assert.equal(o.garantido_motivo, 'combinado com Jaison');
  assert.equal(o.rango_manual, true); assert.equal(o.rango_motivo, null);
  assert.equal(x.r.corpo.por_unidade[0].campos_invalidos, 0);
});

test('enums/booleans estritos: string nunca vira true', async () => {
  for (const d of ['ok', 'perdeu', 'rango_excecao', 'sem_prova', 'no_prazo', 'nao_chegou', 'fora']) {
    const x = await chamar({ lerConsulta: db({ 'AGUA VERDE': consulta([linha({ direito: d })]) }) });
    assert.equal(x.r.corpo.por_unidade[0].linhas[0].direito, d);
  }
  for (const m of ['nome', 'gps', 'robo', 'balcao']) {
    const x = await chamar({ lerConsulta: db({ 'AGUA VERDE': consulta([linha({ direito: 'sem_prova', motivo_sem_prova: m })]) }) });
    assert.equal(x.r.corpo.por_unidade[0].linhas[0].motivo_sem_prova, m);
  }
  const l = linha({ garantido_perdido: 'false', garantido_manual: 'true', rango_manual: 1, na_escala: 'true', direito: true });
  const x = await chamar({ lerConsulta: db({ 'AGUA VERDE': consulta([l]) }) });
  const o = x.r.corpo.por_unidade[0].linhas[0];
  assert.equal(o.garantido_perdido, null); assert.equal(o.garantido_manual, null); assert.equal(o.rango_manual, null);
  assert.equal(o.na_escala, null); assert.equal(o.direito, null);
  assert.equal(x.r.corpo.por_unidade[0].campos_invalidos, 5);
});

test('robô: sem leitura = ok null (desconhecido), nunca ok true', async () => {
  let x = await chamar({ lerConsulta: db({ 'AGUA VERDE': consulta([linha()], { robo: { atualizado_em: null, ok: null } }) }) });
  assert.deepEqual(x.r.corpo.por_unidade[0].robo, { atualizado_em: null, ok: null });
  x = await chamar({ lerConsulta: db({ 'AGUA VERDE': consulta([linha()], { robo: { atualizado_em: null, ok: true } }) }) });
  assert.equal(x.r.corpo.por_unidade[0].robo.ok, null);
  x = await chamar({ lerConsulta: db({ 'AGUA VERDE': consulta([linha()], { robo: { atualizado_em: '2026-11-12T17:00:00+00:00', ok: false } }) }) });
  assert.deepEqual(x.r.corpo.por_unidade[0].robo, { atualizado_em: '2026-11-12T17:00:00.000Z', ok: false });
  x = await chamar({ lerConsulta: db({ 'AGUA VERDE': consulta([linha()], { robo: { atualizado_em: '2026-11-12T17:59:00Z', ok: 'sim' } }) }) });
  assert.equal(x.r.corpo.por_unidade[0].robo.ok, null);
});

test('campos com tipo errado viram null e são contados, sem derrubar a loja', async () => {
  const l = linha({ escala_txt: '25:00', na_escala: 'sim', tempo_registrado_min: -3, chegada_fila_em: '2026-11-12', atraso_min: 2.5, motivo_sem_prova: 'xyz', garantido_motivo: 7 });
  const x = await chamar({ lerConsulta: db({ 'AGUA VERDE': consulta([l]) }) });
  const u = x.r.corpo.por_unidade[0], o = u.linhas[0];
  assert.equal(u.status, 'ok');
  assert.equal(o.escala_txt, null); assert.equal(o.na_escala, null); assert.equal(o.tempo_registrado_min, null); assert.equal(o.tempo_fonte, null);
  assert.equal(o.chegada_fila_em, null); assert.equal(o.atraso_min, null); assert.equal(o.motivo_sem_prova, null); assert.equal(o.garantido_motivo, null);
  assert.equal(u.campos_invalidos, 7);
});

test('erro interno não vaza mensagem', async () => {
  const x = await chamar({ fetchImpl: async () => { throw new TypeError('segredo interno'); } });
  assert.ok(!JSON.stringify(x.r.corpo).includes('segredo'));
  const y = await responder({ metodo: 'GET', origem: ORIGEM, authorization: 'Bearer ' + JWT, query: {} });
  assert.equal(y.status, 500); assert.deepEqual(y.corpo, { erro: 'config_indisponivel' });
});
