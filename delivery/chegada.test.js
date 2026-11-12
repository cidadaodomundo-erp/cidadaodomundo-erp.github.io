// node --test delivery/chegada.test.js   (Chegada dos motoboys: modelo e controller; rede, sessão, loja e DOM são ficções;
// fixtures fictícias SÓ aqui nos testes — a página de produção não tem mock)
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const M = require('./chegada-modelo.js');
const T = require('./chegada.js');

const settle = async () => { for (let i = 0; i < 30; i++) await new Promise((r) => setImmediate(r)); };
const AGORA = Date.parse('2026-11-12T15:00:00Z');   // 12:00 em Brasília → dia operacional 2026-11-12
const HOJE = '2026-11-12';

// ------------------------------------------------------------------------------------------------ fixtures (teste)
function linha(o) {
  return Object.assign({ motoboy: 'Motoboy Ficticio', n_turno: 1, na_escala: true, escala_txt: '11:00:00', escala_saida_txt: '15:00:00',
    limite_txt: '11:10:00', chegada_fila_txt: '10:58:12', chegada_fila_em: '2026-11-12T13:58:12Z', patio_gps_txt: null, anotado_txt: null,
    primeira_entrega_txt: '11:20:00', saida_registrada_txt: '15:02:00', tempo_registrado_min: 244, tempo_fonte: 'fila',
    atraso_min: 0, direito: 'ok', garantido_perdido: false }, o || {});
}
function unidade(nome, o) {
  return Object.assign({ unidade: nome, status: 'ok', hoje: HOJE, ao_vivo: true, consultado_em: '2026-11-12T15:00:00Z',
    robo: { atualizado_em: '2026-11-12T14:59:00Z', ok: true }, campos_invalidos: 0, linhas: [linha()] }, o || {});
}
function resposta(dia, us) { return { dia, dia_operacional: dia, unidades: us.map((u) => u.unidade), por_unidade: us }; }
const json = (corpo, status) => ({ ok: (status || 200) < 400, status: status || 200, json: async () => corpo });

// ------------------------------------------------------------------------------------------------------- modelo
test('modelo: legenda da fila é "Fila do TrackEat"; chegada observada na ordem fila > GPS > anotado', () => {
  assert.equal(M.ROTULO_FONTE.fila, 'Fila do TrackEat');
  assert.equal(M.chegadaObservada(linha()).rotulo, 'Fila do TrackEat');
  assert.equal(M.chegadaObservada(linha({ chegada_fila_txt: null, patio_gps_txt: '10:59' })).fonte, 'patio_gps');
  assert.equal(M.chegadaObservada(linha({ chegada_fila_txt: null, anotado_txt: '11:01' })).fonte, 'anotado');
  assert.equal(M.chegadaObservada(linha({ chegada_fila_txt: null, chegou_txt: '11:20', chegou_fonte: 'primeira_entrega' })), null, 'primeira entrega não é chegada');
});

test('modelo: intervalo só com tempo_fonte válido (fila/patio_gps) E saída registrada; sem tempo_confiavel', () => {
  assert.deepEqual(M.intervaloRegistrado(linha()), { min: 244, texto: '4h 04min', fonte: 'fila', rotulo: 'Fila do TrackEat' });
  assert.equal(M.intervaloRegistrado(linha({ tempo_fonte: 'patio_gps' })).rotulo, 'Pátio (GPS)');
  assert.equal(M.intervaloRegistrado(linha({ tempo_fonte: null })), null);
  assert.equal(M.intervaloRegistrado(linha({ tempo_fonte: 'anotado' })), null);
  assert.equal(M.intervaloRegistrado(linha({ saida_registrada_txt: null })), null);
  assert.equal(M.intervaloRegistrado(linha({ tempo_registrado_min: -1 })), null);
  assert.equal(M.intervaloRegistrado(linha({ tempo_registrado_min: 12.5 })), null);
  const src = fs.readFileSync(path.join(__dirname, 'chegada-modelo.js'), 'utf8') + fs.readFileSync(path.join(__dirname, 'chegada.js'), 'utf8');
  assert.doesNotMatch(src, /tempo_confiavel|confiavel/);
});

test('modelo: atraso desde a ENTRADA COMBINADA, não desde o limite de tolerância', () => {
  const d = M.direitos(linha({ direito: 'perdeu', atraso_min: 17 }));
  assert.equal(d.garantido.estado, 'nao');
  assert.equal(d.garantido.motivo, 'Chegou 17 min depois da entrada combinada (11:00:00)');
  assert.doesNotMatch(d.garantido.motivo, /11:10/);
});

test('modelo: direitos separados; manual só vale no próprio campo', () => {
  const d = M.direitos(linha({ direito: 'perdeu', atraso_min: 20, garantido_manual: true, garantido_motivo: 'combinado' }));
  assert.equal(d.garantido.estado, 'sim'); assert.equal(d.garantido.manual, true); assert.match(d.garantido.motivo, /combinado/);
  assert.equal(d.refeicao.estado, 'nao'); assert.equal(d.refeicao.manual, false);
  const r = M.direitos(linha({ direito: 'perdeu', rango_manual: true }));
  assert.equal(r.garantido.estado, 'nao'); assert.equal(r.refeicao.estado, 'sim');
  assert.equal(M.direitos(linha({ direito: 'nao_chegou' })).garantido.estado, 'conferir', 'sem chegada não é falta');
  assert.equal(M.direitos(linha({ direito: 'ok', garantido_perdido: true })).garantido.estado, 'nao');
});

test('modelo: campos_invalidos é número; robo.ok false = desatualizado; histórico só com ao_vivo === false', () => {
  assert.equal(M.camposInvalidos(unidade('AHU', { campos_invalidos: 3 })), 3);
  assert.equal(M.camposInvalidos(unidade('AHU', { campos_invalidos: ['x'] })), 0);
  assert.equal(M.situacaoRobo(unidade('AHU', { robo: { atualizado_em: null, ok: false } })).desatualizado, true);
  assert.equal(M.situacaoRobo(unidade('AHU', { robo: { atualizado_em: null, ok: null } })).desatualizado, false);
  assert.equal(M.ehHistorico(unidade('AHU', { ao_vivo: false })), true);
  assert.equal(M.ehHistorico(unidade('AHU', { ao_vivo: undefined })), false);
});

test('modelo: validarResposta exige o dia exato e a estrutura do contrato', () => {
  assert.equal(M.validarResposta(resposta(HOJE, [unidade('AHU')]), HOJE).ok, true);
  assert.equal(M.validarResposta(resposta('2026-11-11', [unidade('AHU')]), HOJE).ok, false, 'outro dia');
  assert.equal(M.validarResposta({ por_unidade: [unidade('AHU')] }, HOJE).ok, false, 'sem dia');
  assert.equal(M.validarResposta(null, HOJE).ok, false);
  assert.equal(M.validarResposta([], HOJE).ok, false);
  assert.equal(M.validarResposta({ dia: HOJE }, HOJE).ok, false, 'sem por_unidade');
  assert.equal(M.validarResposta(resposta(HOJE, [unidade('AHU', { status: 'talvez' })]), HOJE).ok, false);
  assert.equal(M.validarResposta(resposta(HOJE, [unidade('AHU', { linhas: null })]), HOJE).ok, false);
  assert.equal(M.validarResposta(resposta(HOJE, [unidade('AHU', { ao_vivo: 'sim' })]), HOJE).ok, false);
  assert.equal(M.validarResposta(resposta(HOJE, [unidade('AHU', { campos_invalidos: ['a'] })]), HOJE).ok, false);
  assert.equal(M.validarResposta(resposta(HOJE, [unidade('AHU', { robo: { ok: 'x' } })]), HOJE).ok, false);
  assert.equal(M.validarResposta(resposta(HOJE, [{ unidade: 'AHU', status: 'indisponivel' }]), HOJE).ok, true);
});

test('modelo: REDE sem lojas autorizadas falha fechado; REDE mostra só as autorizadas; loja não autorizada não aparece', () => {
  const r = resposta(HOJE, [unidade('AHU'), unidade('BATEL'), unidade('CENTRO')]);
  assert.deepEqual(M.unidadesVisiveis(r, 'REDE', []), []);
  assert.deepEqual(M.unidadesVisiveis(r, 'REDE', ['REDE']), []);
  assert.deepEqual(M.unidadesVisiveis(r, 'REDE', null), []);
  assert.deepEqual(M.unidadesVisiveis(r, 'REDE', ['AHU', 'BATEL']).map((u) => u.unidade), ['AHU', 'BATEL']);
  assert.deepEqual(M.unidadesVisiveis(r, 'CENTRO', ['AHU']), []);
  assert.deepEqual(M.unidadesVisiveis(r, 'AHU', ['AHU']).map((u) => u.unidade), ['AHU']);
});

test('render: seis campos por linha além do nome (celular), direitos separados, robô desatualizado não é falha, histórico, campos inválidos', () => {
  const r = resposta('2026-11-10', [unidade('AHU', { ao_vivo: false, campos_invalidos: 2, robo: { atualizado_em: '2026-11-10T20:00:00Z', ok: false } })]);
  const h = T.renderizar({ fase: 'ok', resp: r }, { M, loja: 'AHU', lojas: ['AHU'], lojaNome: (l) => l });
  const tr = (/<tbody>([\s\S]*?)<\/tbody>/.exec(h) || [])[1];
  const rots = [...tr.matchAll(/<td data-rot="([^"]+)"/g)].map((m) => m[1]);
  assert.deepEqual(rots, ['Motoboy', 'Entrada combinada', 'Chegada observada', 'Saída registrada', 'Intervalo registrado', 'Garantido', 'Refeição']);
  assert.match(h, /leitura do robô desatualizada: não é falha comprovada/);
  assert.doesNotMatch(h, /acusou falha/);
  assert.match(h, /histórico · consulta atual, não é fechamento/);
  assert.doesNotMatch(h, /ao vivo</);
  assert.match(h, /A fonte mandou 2 campos fora do formato/);
  assert.match(h, /Fila do TrackEat/);
  assert.doesNotMatch(h, /Fila de saída \(com segundos\)/);
  const indis = T.renderizar({ fase: 'ok', resp: resposta(HOJE, [{ unidade: 'AHU', status: 'indisponivel' }]) }, { M, loja: 'AHU', lojas: ['AHU'] });
  assert.match(indis, /indisponível agora/);
  const rede = T.renderizar({ fase: 'ok', resp: resposta(HOJE, [unidade('AHU')]) }, { M, loja: 'REDE', lojas: [] });
  assert.doesNotMatch(rede, /<table/, 'REDE sem lojas: nenhuma tabela');
});

// --------------------------------------------------------------------------------------------------- controller
function montar(op) {
  op = op || {};
  const els = {};
  const el = (id) => els[id] || (els[id] = { id, innerHTML: '', textContent: '', value: '', max: '', hidden: false, ev: {},
    addEventListener(n, f) { this.ev[n] = f; } });
  ['dia', 'conteudo', 'estado', 'lojaBox', 'lojaSel', 'btnHoje', 'btnAtualizar'].forEach(el);
  const docEv = {}, winEv = {};
  const doc = { hidden: !!op.oculta, getElementById: (id) => els[id] || null, addEventListener: (n, f) => { docEv[n] = f; } };
  const win = { frameElement: null, addEventListener: (n, f) => { winEv[n] = f; } };
  const timers = new Map(); let tid = 0;
  const x = { els, doc, win, docEv, winEv, timers, chamadas: [], logins: [], recargas: 0, mudouLoja: null,
    sess: { access_token: 'jwt-ficticio', email: 'conta@exemplo.test' }, loja: op.loja || 'AHU', lojas: op.lojas || ['AHU', 'BATEL'],
    responder: op.responder || ((u) => json(resposta(new URL(u).searchParams.get('dia'), [unidade(new URL(u).searchParams.get('unidade'))]))) };
  x.polls = () => [...timers.entries()].filter(([, t]) => t.ms === T.POLL_MS);
  x.prazos = () => [...timers.entries()].filter(([, t]) => t.ms === T.TIMEOUT_MS);
  x.disparar = (id) => { const t = timers.get(id); timers.delete(id); t.f(); };
  x.tela = T.criarTela({
    doc, win, M,
    fetch: (u, o) => { x.chamadas.push({ u, o }); return x.responder(u, o, x.chamadas.length); },
    sessao: () => x.sess, cabecalho: () => ({ Authorization: 'Bearer ' + (x.sess && x.sess.access_token) }),
    renovar: async () => !!op.renova,
    lojaCarregar: async () => ({ lojas: x.lojas }), lojaAtual: () => x.loja, lojaNome: (l) => l, aoMudarLoja: (f) => { x.mudouLoja = f; },
    naCasca: true, avisar() {}, registrarUso() {},
    agora: () => AGORA, setTimeout: (f, ms) => { const id = ++tid; timers.set(id, { f, ms }); return id; }, clearTimeout: (id) => { timers.delete(id); },
    AbortController,
    irLogin: (r) => x.logins.push(r), recarregar: () => { x.recargas++; },
  });
  return x;
}
function pendente() {
  let resolver;
  const p = (u, o) => new Promise((res, rej) => {
    resolver = res;
    if (o && o.signal) o.signal.addEventListener('abort', () => rej(Object.assign(new Error('abortado'), { name: 'AbortError' })));
  });
  return { p, resolver: (v) => resolver(v) };
}

test('controller: GET com Bearer do ERP, dia e unidade na URL; desenha e agenda UM poll de 10 s', async () => {
  const x = montar(); await x.tela.iniciar(); await settle();
  assert.equal(x.chamadas.length, 1);
  const { u, o } = x.chamadas[0];
  assert.equal(u, M.ENDPOINT + '?dia=' + HOJE + '&unidade=AHU');
  assert.equal(o.method, 'GET'); assert.equal(o.headers.Authorization, 'Bearer jwt-ficticio'); assert.equal(o.credentials, 'omit');
  assert.match(x.els.conteudo.innerHTML, /Motoboy Ficticio/);
  assert.equal(x.polls().length, 1); assert.equal(x.polls()[0][1].ms, 10000);
  assert.equal(x.prazos().length, 0, 'prazo de 30 s limpo ao terminar');
});

test('controller: 401 sem renovação leva ao login e limpa a tela; 403 = sem permissão', async () => {
  const x = montar({ responder: () => json(null, 401) }); await x.tela.iniciar(); await settle();
  assert.equal(x.logins.length, 1); assert.equal(x.els.conteudo.innerHTML, '');
  const y = montar({ responder: () => json(null, 403) }); await y.tela.iniciar(); await settle();
  assert.match(y.els.conteudo.innerHTML, /não tem permissão/);
});

test('controller: resposta de outro dia não é exibida', async () => {
  const x = montar({ responder: () => json(resposta('2026-11-11', [unidade('AHU')])) }); await x.tela.iniciar(); await settle();
  assert.doesNotMatch(x.els.conteudo.innerHTML, /Motoboy Ficticio/);
  assert.match(x.els.conteudo.innerHTML, /Não foi possível consultar/);
});

test('controller: troca de loja no meio descarta a leitura antiga (sequência/loja)', async () => {
  const d1 = pendente();
  const x = montar({ responder: (u, o, n) => (n === 1 ? d1.p(u, o) : json(resposta(HOJE, [unidade('BATEL', { linhas: [linha({ motoboy: 'Do Batel' })] })]))) });
  const ini = x.tela.iniciar(); await settle();
  x.loja = 'BATEL'; x.mudouLoja(); await settle(); await ini;
  d1.resolver(json(resposta(HOJE, [unidade('AHU', { linhas: [linha({ motoboy: 'Do Ahu' })] })]))); await settle();
  assert.equal(x.chamadas.length, 2);
  assert.match(x.els.conteudo.innerHTML, /Do Batel/); assert.doesNotMatch(x.els.conteudo.innerHTML, /Do Ahu/);
  assert.equal(x.polls().length, 1, 'um poll só');
});

test('controller: outra conta durante a leitura = nada exibido, tela limpa e recarrega', async () => {
  const d1 = pendente();
  const x = montar({ responder: (u, o) => d1.p(u, o) });
  x.tela.iniciar(); await settle();
  x.sess = { access_token: 'outro', email: 'outra@exemplo.test' };
  d1.resolver(json(resposta(HOJE, [unidade('AHU')]))); await settle();
  assert.equal(x.recargas, 1); assert.equal(x.els.conteudo.innerHTML, '');
});

test('controller: ocultar aborta a leitura em voo e para o poll; ao voltar, lê de novo', async () => {
  const d1 = pendente(); let sinal = null;
  const x = montar({ responder: (u, o, n) => { if (n === 1) { sinal = o.signal; return d1.p(u, o); } return json(resposta(HOJE, [unidade('AHU')])); } });
  x.tela.iniciar(); await settle();
  x.doc.hidden = true; x.docEv.visibilitychange(); await settle();
  assert.equal(sinal.aborted, true);
  assert.equal(x.polls().length, 0); assert.equal(x.prazos().length, 0);
  x.doc.hidden = false; x.docEv.visibilitychange(); await settle();
  assert.equal(x.chamadas.length, 2);
  assert.match(x.els.conteudo.innerHTML, /Motoboy Ficticio/);
  assert.equal(x.polls().length, 1);
});

test('controller: aberta oculta não consulta; poll oculto não consulta', async () => {
  const x = montar({ oculta: true }); await x.tela.iniciar(); await settle();
  assert.equal(x.chamadas.length, 0);
  const y = montar(); await y.tela.iniciar(); await settle();
  y.doc.hidden = true;
  const [id] = y.polls()[0]; y.disparar(id); await settle();
  assert.equal(y.chamadas.length, 1, 'oculta: o poll não lê');
});

test('controller: poll não sobrepõe leitura em voo', async () => {
  const d2 = pendente();
  const x = montar({ responder: (u, o, n) => (n === 1 ? json(resposta(HOJE, [unidade('AHU')])) : d2.p(u, o)) });
  await x.tela.iniciar(); await settle();
  const [id] = x.polls()[0]; x.disparar(id); await settle();
  assert.equal(x.chamadas.length, 2);
  x.tela.consultar(false); await settle();
  assert.equal(x.chamadas.length, 2, 'não dispara outra com uma em voo');
  assert.equal(x.polls().length, 0, 'sem poll enquanto lê');
});

test('controller: dia passado não tem poll', async () => {
  const x = montar(); await x.tela.iniciar(); await settle();
  x.els.dia.value = '2026-11-10'; x.els.dia.ev.change(); await settle();
  assert.match(x.chamadas[1].u, /dia=2026-11-10/);
  assert.equal(x.polls().length, 0);
});

test('controller: prazo de 30 s interrompe a leitura e mostra o aviso', async () => {
  const d1 = pendente(); let sinal = null;
  const x = montar({ responder: (u, o) => { sinal = o.signal; return d1.p(u, o); } });
  x.tela.iniciar(); await settle();
  const [id, t] = x.prazos()[0]; assert.equal(t.ms, 30000);
  x.disparar(id); await settle();
  assert.equal(sinal.aborted, true);
  assert.match(x.els.conteudo.innerHTML, /passou de 30 s/);
});

test('controller: REDE sem loja autorizada falha fechado (sem rede); REDE com lojas pede unidade=REDE e mostra só as autorizadas', async () => {
  const x = montar({ loja: 'REDE', lojas: ['REDE'] }); await x.tela.iniciar(); await settle();
  assert.equal(x.chamadas.length, 0);
  assert.match(x.els.conteudo.innerHTML, /Visão da rede sem nenhuma loja autorizada/);
  const y = montar({ loja: 'REDE', lojas: ['REDE', 'AHU'], responder: () => json(resposta(HOJE, [unidade('AHU'), unidade('CENTRO', { linhas: [linha({ motoboy: 'Nao Autorizado' })] })])) });
  await y.tela.iniciar(); await settle();
  assert.match(y.chamadas[0].u, /unidade=REDE/);
  assert.match(y.els.conteudo.innerHTML, /Motoboy Ficticio/);
  assert.doesNotMatch(y.els.conteudo.innerHTML, /Nao Autorizado/);
});

test('produção sem mock: página e scripts não trazem fixtures nem dados fictícios', () => {
  const prod = ['chegada.html', 'chegada.js', 'chegada-modelo.js'].map((f) => fs.readFileSync(path.join(__dirname, f), 'utf8')).join('\n');
  assert.doesNotMatch(prod, /Ficticio|exemplo\.test|mock|fixture/i);
});
