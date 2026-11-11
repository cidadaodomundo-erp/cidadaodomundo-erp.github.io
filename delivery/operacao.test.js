// node --test delivery/operacao.test.js   (script REAL do index.html e operacao.js; rede, DOM, sessão e loja são ficções; só dados fictícios)
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const OP = require('./operacao.js');

const HTML = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8');
const scripts = [...HTML.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => m[1]);
const PRINCIPAL = scripts.find((s) => s.includes("const TELA = 'delivery'"));
const OPERACAO_SRC = fs.readFileSync(path.join(__dirname, 'operacao.js'), 'utf8');
const MODELO_SRC = fs.readFileSync(path.join(__dirname, 'operacao-modelo.js'), 'utf8');
const DADOS_SRC = fs.readFileSync(path.join(__dirname, 'operacao-dados.js'), 'utf8');
const settle = async () => { for (let i = 0; i < 20; i++) await new Promise((r) => setImmediate(r)); };
// texto visível: tira as tags (senão "h2" conta como dígito) e as entidades mais comuns
const textoVisivel = (h) => h.replace(/<[^>]+>/g, ' ').replace(/&[a-z#0-9]+;/gi, ' ');

const SEM_RESPOSTA = () => ({ ok: false, status: 0, json: async () => ({}) });
// leitura: ficção do trFetch (só GET); est: loja escolhida e lojas autorizadas (ficção de lojaCarregar/lojaAtual)
function montar({ sessao = true, rpc = null, leitura = null, hoje = '2026-11-11',
  est = { loja: 'LOJA TESTE', lojas: ['LOJA TESTE', 'AHU', 'SÃO BRAZ'], ouv: null } } = {}) {
  let oculto = false;        // document.hidden (aba em segundo plano)
  let frameOculto = false;   // moldura da casca escondida (window.frameElement.hidden)
  const docOuv = {};
  const els = {};
  const mk = (id) => {
    const e = { id, innerHTML: '', style: {}, value: '', max: '', dataset: {}, ev: {}, textContent: '',
      classList: { on: false, toggle(_c, f) { e.on = f; } },
      addEventListener(n, f) { e.ev[n] = f; } };
    return e;
  };
  ['titulo', 'dia', 'fontes', 'erroMsg', 'conteudo', 'legado', 'operacao', 'opBanner', 'abas'].forEach((i) => { els[i] = mk(i); });
  els.erroMsg.style.display = 'none';
  const botoes = ['placar', 'tempo', 'cancel', 'quali', 'chegada', 'escala', 'conferencia'].map((a) => {
    const b = mk('b-' + a); b.dataset.aba = a; return b;
  });
  const ouvintesJanela = {};
  const chamadas = [];
  const leituras = [];
  const hist = { pilha: [''], i: 0 };
  const loc = {
    get hash() { return hist.pilha[hist.i]; },
    set hash(v) { hist.pilha = hist.pilha.slice(0, hist.i + 1); hist.pilha.push('#' + v); hist.i++; (ouvintesJanela.hashchange || (() => {}))(); },
    href: '',
    reloads: 0,
    reload() { this.reloads++; this.antes = { op: els.operacao.innerHTML, cont: els.conteudo.innerHTML, sessao: store.rmbSessao }; }
  };
  const ir = (d) => { hist.i += d; (ouvintesJanela.hashchange || (() => {}))(); };
  let agora = new Date(hoje + 'T15:00:00Z');
  class DataFalsa extends Date { constructor(...a) { if (a.length) super(...a); else super(agora.getTime()); } }
  // sessão fictícia com e-mail fake (conta A); nunca dado real
  const store = { rmbSessao: sessao ? '{"access_token":"x","email":"conta-a@exemplo.test"}' : null };
  const intervalos = [];
  const ctx = {
    console, Date: DataFalsa, Promise, JSON, URL,
    window: { addEventListener: (n, f) => { ouvintesJanela[n] = f; }, get frameElement() { return { get hidden() { return frameOculto; } }; } },
    document: {
      documentElement: { classList: { add() {} } },
      get hidden() { return oculto; },
      addEventListener(n, f) { docOuv[n] = f; },
      getElementById: (i) => els[i],
      querySelectorAll: (s) => (s === '#abas button' ? botoes : [])
    },
    location: loc,
    localStorage: { getItem: (k) => store[k] || null, removeItem: (k) => { store[k] = null; } },
    setInterval: (f) => { intervalos.push(f); return 1; },
    rmbSessao: () => { try { return JSON.parse(store.rmbSessao || 'null'); } catch (e) { return null; } }, // igual ao núcleo
    registrarUso() {}, carimboDados() {}, trEscH: OP.esc,
    // stub fiel ao real: lê o corpo JSON e usa a mensagem; sem mensagem, cai no HTTP
    trErroDe: async (r) => { try { const j = await r.json(); return j.message || 'HTTP ' + r.status; } catch (e) { return 'HTTP ' + r.status; } },
    trRpcSeguro: async (fn, args) => { chamadas.push({ fn, args }); return rpc ? rpc(fn, args) : { ok: false, status: 0, json: async () => ({}) }; },
    trFetch: async (url, opts) => { leituras.push({ url, metodo: opts && opts.method }); return leitura ? leitura(url) : SEM_RESPOSTA(); },
    // loja: ficção controlada por `est` (lojaCarregar real faz rede; aqui não)
    lojaCarregar: async () => { if (est.defer) await est.defer.p; return est.semInfo ? null : { lojas: est.lojas || []  }; },
    lojaAtual: () => est.loja,
    lojaNome: (l) => ({ 'AHU': 'Ahú', 'SÃO BRAZ': 'São Braz', 'REDE': 'Rede (as 3)' })[l] || (l ? String(l) : ''),
    aoMudarLoja: (fn) => { est.ouv = fn; }
  };
  ctx.window.parent = ctx.window; // parent === window => NA_CASCA falso
  ctx.self = ctx.window;
  vm.createContext(ctx);
  vm.runInContext(OPERACAO_SRC, ctx);
  vm.runInContext(MODELO_SRC, ctx);
  vm.runInContext(DADOS_SRC, ctx);
  ctx.DeliveryOperacao = ctx.window.DeliveryOperacao;
  ctx.ModeloDelivery = ctx.window.ModeloDelivery;
  ctx.DeliveryDados = ctx.window.DeliveryDados;
  vm.runInContext(scripts[0], ctx); // NA_CASCA / avisarCasca
  return {
    ctx, els, botoes, chamadas, leituras, loc, ir, intervalos, store, est, janela: ouvintesJanela, docOuv,
    ocultar(v) { oculto = v; },
    ocultarFrame(v) { frameOculto = v; },
    iniciar(hashInicial) { if (hashInicial) { hist.pilha = [hashInicial]; } vm.runInContext(PRINCIPAL, ctx); },
    clicar(aba) { const b = botoes.find((x) => x.dataset.aba === aba); els.abas.ev.click({ target: { closest: () => b } }); },
    virarDia(novo) { agora = new Date(novo + 'T15:00:00Z'); },
    ativa: () => botoes.filter((b) => b.on).map((b) => b.dataset.aba)
  };
}

const DADOS_FICT = {
  unidades: [{ unidade: 'LOJA TESTE', pedidos: 3, concluidos: 2, valor_concluido: 10, cancelados: 1, valor_cancelado: 5 }],
  cancelamentos: [{ unidade: 'LOJA TESTE', motivo: 'Motivo fictício', origem: 'TOTAL', qtd: 1, valor: 5 }],
  avaliacoes_ruins: [],
  ultimo_dado: {}
};
const rpcOk = () => ({ ok: true, status: 200, json: async () => DADOS_FICT });
const visivel = (t, id) => t.els[id].style.display !== 'none';
// promessa controlada: quem tem `res` decide quando ela resolve (sem espera real)
const defer = () => { let res; const p = new Promise((r) => { res = r; }); return { p, res }; };

test('hash inicial abre cada aba nova mesmo com a leitura do delivery falhando', async () => {
  for (const aba of ['chegada', 'escala', 'conferencia']) {
    const t = montar({ rpc: null });
    t.iniciar('#' + aba);
    await settle();
    assert.deepEqual(t.ativa(), [aba]);
    assert.ok(visivel(t, 'operacao'));
    assert.equal(t.els.legado.style.display, 'none');
    assert.match(t.els.operacao.innerHTML, /Em construção/);
    assert.match(t.els.erroMsg.textContent, /Não deu para ler o delivery/);
    assert.equal(t.els.conteudo.innerHTML, '');
  }
});

test('hash desconhecido cai no Placar; 3 abas antigas seguem com dados', async () => {
  const t = montar({ rpc: rpcOk });
  t.iniciar('#lixo');
  await settle();
  assert.deepEqual(t.ativa(), ['placar']);
  assert.match(t.els.conteudo.innerHTML, /LOJA TESTE/);
  assert.match(t.els.conteudo.innerHTML, /tabelaPlacar/);
  for (const [aba, id] of [['tempo', 'tabelaTempo'], ['cancel', 'tabelaCancel'], ['quali', 'tabelaNotas']]) {
    t.clicar(aba);
    await settle();
    assert.deepEqual(t.ativa(), [aba]);
    assert.match(t.els.conteudo.innerHTML, new RegExp(id));
    assert.ok(visivel(t, 'legado'));
    assert.equal(t.els.operacao.style.display, 'none');
  }
});

test('voltar/avançar alternam entre antigas e novas', async () => {
  const t = montar({ rpc: rpcOk });
  t.iniciar('#placar');
  await settle();
  t.clicar('chegada'); t.clicar('escala'); t.clicar('quali');
  assert.deepEqual(t.ativa(), ['quali']);
  t.ir(-1); assert.deepEqual(t.ativa(), ['escala']); assert.match(t.els.operacao.innerHTML, /Escala do Delivery/);
  t.ir(-1); assert.deepEqual(t.ativa(), ['chegada']);
  t.ir(+1); assert.deepEqual(t.ativa(), ['escala']);
  t.ir(+1); assert.deepEqual(t.ativa(), ['quali']);
  assert.match(t.els.conteudo.innerHTML, /tabelaNotas/);
});

test('erro HTTP do delivery_dia mostra a mensagem; 401 limpa tudo e manda logar', async () => {
  const t = montar({ rpc: () => ({ ok: false, status: 500, json: async () => ({ message: 'falhou' }) }) });
  t.iniciar('#placar');
  await settle();
  assert.match(t.els.erroMsg.textContent, /falhou/);
  t.clicar('conferencia');
  assert.match(t.els.operacao.innerHTML, /Conferência do Delivery/);
  const t2 = montar({ rpc: () => ({ ok: false, status: 401, json: async () => ({}) }) });
  t2.iniciar('#escala');
  await settle();
  assert.equal(t2.store.rmbSessao, null);
  assert.equal(t2.els.operacao.innerHTML, '');
  assert.match(t2.loc.href, /sistema\.html/);
});

test('exceção/rede no rpc: não há rejeição sem tratar, aviso aparece e abas novas seguem', async () => {
  const t = montar({ rpc: () => { throw new Error('rede caiu'); } });
  t.iniciar('#chegada');
  await settle();
  assert.match(t.els.erroMsg.textContent, /rede caiu/);
  assert.match(t.els.operacao.innerHTML, /Chegada do dia/);
  assert.equal(t.els.conteudo.innerHTML, '');
  t.clicar('placar');
  await settle();
  assert.equal(t.els.conteudo.innerHTML, '');
  assert.match(t.els.erroMsg.textContent, /rede caiu/);
});

test('dados de outro dia não aparecem quando a leitura do dia atual falha', async () => {
  let n = 0;
  const t = montar({ rpc: () => { n++; return n === 1 ? rpcOk() : { ok: false, status: 500, json: async () => ({ message: 'caiu' }) }; } });
  t.iniciar('#placar');
  await settle();
  assert.match(t.els.conteudo.innerHTML, /LOJA TESTE/);
  t.els.dia.value = '2026-11-09'; t.els.dia.ev.change();
  await settle();
  assert.doesNotMatch(t.els.conteudo.innerHTML, /LOJA TESTE/);
  assert.match(t.els.erroMsg.textContent, /caiu/);
});

test('HTTP 500 antigo com corpo pendente não apaga a leitura nova nem mostra aviso antigo', async () => {
  const d1 = defer(), j1 = defer();
  let n = 0;
  const t = montar({ rpc: () => { n++; return n === 1 ? d1.p : rpcOk(); } });
  t.iniciar('#placar'); // leitura 1 fica pendente
  await settle();
  t.intervalos[0](); // leitura 2 (mais recente) completa com sucesso
  await settle();
  assert.match(t.els.conteudo.innerHTML, /LOJA TESTE/);
  d1.res({ ok: false, status: 500, json: () => j1.p }); // 500 chega, corpo ainda não
  await settle();
  j1.res({ message: 'antigo' }); // corpo chega depois
  await settle();
  assert.match(t.els.conteudo.innerHTML, /LOJA TESTE/);
  assert.doesNotMatch(t.els.erroMsg.textContent, /antigo/);
  assert.notEqual(t.els.erroMsg.style.display, 'block');
});

test('HTTP 500 antigo que chega depois de a sessão ser encerrada não mostra aviso', async () => {
  const d1 = defer(), j1 = defer();
  let n = 0;
  const t = montar({ rpc: () => { n++; return n === 1 ? d1.p : { ok: false, status: 401, json: async () => ({}) }; } });
  t.iniciar('#placar');
  await settle();
  t.intervalos[0](); // leitura nova: 401 encerra a sessão
  await settle();
  assert.equal(t.store.rmbSessao, null);
  d1.res({ ok: false, status: 500, json: () => j1.p });
  j1.res({ message: 'antigo' });
  await settle();
  assert.doesNotMatch(t.els.erroMsg.textContent, /antigo/);
  assert.notEqual(t.els.erroMsg.style.display, 'block');
  assert.equal(t.els.conteudo.innerHTML, '');
});

test('sem sessão: nada é mostrado nem consultado, nem por hashchange', async () => {
  const t = montar({ sessao: false, rpc: rpcOk });
  t.iniciar('#chegada');
  await settle();
  t.ir(+1);
  t.loc.hash = 'escala';
  await settle();
  assert.equal(t.chamadas.length, 0);
  assert.equal(t.leituras.length, 0);
  assert.equal(t.els.operacao.innerHTML, '');
  assert.match(t.loc.href, /sistema\.html/);
});

test('só consulta delivery_dia e acompanha o dia escolhido e a virada do dia', async () => {
  const t = montar({ rpc: rpcOk, hoje: '2026-11-11' });
  t.iniciar('#chegada');
  await settle();
  assert.deepEqual([...new Set(t.chamadas.map((c) => c.fn))], ['delivery_dia']);
  // a Chegada lê as DUAS fontes de atividade, só por GET, e nunca a escala
  assert.ok(t.leituras.length >= 2);
  assert.ok(t.leituras.every((l) => l.metodo === 'GET'));
  assert.ok(t.leituras.some((l) => l.url.startsWith('foody_entregas?')) && t.leituras.some((l) => l.url.startsWith('trackeat_api_entregas?')));
  assert.ok(!t.leituras.some((l) => l.url.startsWith('motoboy_escala')));
  assert.match(t.els.operacao.innerHTML, /11\/11\/2026/);
  t.els.dia.value = '2026-11-09'; t.els.dia.ev.change();
  await settle();
  assert.match(t.els.operacao.innerHTML, /09\/11\/2026/);
  t.els.dia.value = '2026-11-11'; t.els.dia.ev.change();
  t.virarDia('2026-11-12');
  t.intervalos[0]();
  await settle();
  assert.equal(t.els.dia.value, '2026-11-12');
  assert.match(t.els.operacao.innerHTML, /12\/11\/2026/);
  assert.equal(t.chamadas.at(-1).args.p_dia, '2026-11-12');
});

test('loja real: mostra o nome da loja atual e atualiza ao mudar; sem loja não inventa', async () => {
  const est = { loja: 'AHU', lojas: ['AHU', 'SÃO BRAZ'], ouv: null };
  const t = montar({ rpc: rpcOk, est });
  t.iniciar('#chegada');
  await settle();
  assert.match(t.els.operacao.innerHTML, /Ahú/);
  est.loja = 'SÃO BRAZ'; est.ouv('SÃO BRAZ');
  await settle();
  assert.match(t.els.operacao.innerHTML, /São Braz/);
  assert.doesNotMatch(t.els.operacao.innerHTML, /Ahú/);
  est.loja = null; est.ouv(null);
  await settle();
  assert.match(t.els.operacao.innerHTML, /Ainda não ligado \(nenhuma loja escolhida\)/);
});

test('conteúdo não inventa dados: sem tabela, sem números, campos ausentes declarados', () => {
  const ctx = { dia: '2026-11-11', loja: null };
  for (const aba of OP.ABAS_NOVAS) {
    const h = OP.render(aba, ctx);
    assert.match(h, /Em construção/);
    assert.doesNotMatch(h, /<table|<input|<form|<button|<select|<textarea/);
  }
  const ch = OP.render('chegada', ctx);
  for (const c of ['Dia', 'Loja', 'Turno', 'Motoboy', 'Início previsto', 'Chegada registrada', 'Primeira atividade', 'Fonte', 'Última leitura', 'Situação de conferência']) assert.ok(ch.includes('<dt>' + c + '</dt>'), c);
  assert.match(ch, /primeira entrega <strong>não comprova<\/strong>/);
  assert.match(ch, /não significa<\/strong> falta nem atraso/);
  assert.match(ch, /A conferir/);
  assert.match(ch, /Ainda não ligado \(nenhuma loja escolhida\)/);
  // só o dia informado tem dígitos no texto visível (as tags não contam)
  assert.equal(textoVisivel(ch).replace(/11\/11\/2026/g, '').match(/\d/), null);
  const esc = OP.render('escala', ctx);
  for (const c of ['Dia', 'Loja', 'Turno', 'Motoboy', 'Início', 'Fim', 'Vira a madrugada', 'Situação da alteração']) assert.ok(esc.includes('<dt>' + c + '</dt>'), c);
  assert.equal(textoVisivel(esc).replace(/11\/11\/2026/g, '').match(/\d/), null);
  const conf = OP.render('conferencia', ctx);
  for (const a of OP.ABAS_ANTIGAS) assert.ok(conf.includes('href="#' + a + '"'), a);
  for (const f of ['Mapa', 'Passagem de turno', 'Sacola']) assert.ok(conf.includes(f));
  assert.equal((conf.match(/class="op-selo"/g) || []).length, 4); // título + 3 futuros
});

test('sem XSS: dia e loja são escapados/validados; dia inválido não vira texto', () => {
  const h = OP.render('chegada', { dia: '2026-11-11', loja: '<img src=x onerror=alert(1)>' });
  assert.doesNotMatch(h, /<img/);
  assert.match(h, /&lt;img/);
  assert.equal(OP.diaBR('"><script>'), null);
  assert.equal(OP.diaBR('2026-02-30'), null);
  assert.equal(OP.diaBR('2026-11-11'), '11/11/2026');
  assert.doesNotMatch(OP.render('escala', { dia: '<b>' }), /<b>/);
  assert.equal(OP.abaDoHash('#%E0%A4%A'), 'placar');
  assert.equal(OP.abaDoHash('#<script>'), 'placar');
});

test('código novo não consulta nem grava; sintaxe dos scripts ok', () => {
  assert.doesNotMatch(OPERACAO_SRC, /fetch|XMLHttpRequest|trRpc|trRest|localStorage|sessionStorage|supabase|eval\(|new Function|document\./i);
  for (const s of scripts) new vm.Script(s);
  new vm.Script(OPERACAO_SRC);
  assert.ok(HTML.includes('src="operacao.js'));
  assert.ok(HTML.includes('src="operacao-modelo.js') && HTML.includes('src="operacao-dados.js'));
  assert.equal((HTML.match(/data-aba=/g) || []).length, 7);
  // a leitura nova só usa o núcleo (GET): nada de sessão, chave, armazenamento, escrita nem rede direta
  new vm.Script(DADOS_SRC); new vm.Script(MODELO_SRC);
  for (const src of [DADOS_SRC, MODELO_SRC]) {
    assert.doesNotMatch(src, /localStorage|sessionStorage|cookie|rmbSessao|access_token|apikey|Authorization|SUPABASE|\bfetch\s*\(|XMLHttpRequest|trRpc|eval\(|new Function|document\.|console\./);
    assert.doesNotMatch(src, /method:\s*'(POST|PATCH|PUT|DELETE)'/);
  }
  assert.doesNotMatch(OPERACAO_SRC, /console\./);
});

const rows = (o) => ({ ok: true, status: 200, json: async () => o });
const escRow = (o = {}) => ({ dia: '2026-11-11', unidade: 'AHU', turno: 'JANTAR', nome_na_escala: 'Fulano Teste', inicio: '18:00:00', fim: '23:00:00', gravado_em: '2026-11-10T20:00:00+00:00', ...o });
const fRow = (o = {}) => ({ data_local: '2026-11-11', unidade: 'AHU', turno: 'JANTAR', entregador: 'Fulano Teste', coleta: '2026-11-11T21:30:00+00:00', despacho: null, entrega: '2026-11-11T21:50:00+00:00', importado_em: '2026-11-11T22:00:00.123456+00:00', ...o });
const tRow = (o = {}) => ({ data_local: '2026-11-11', unidade: 'AHU', turno: 'JANTAR', entregador: 'Fulano Teste', coleta: '2026-11-11T21:40:00+00:00', saida: null, entrega: null, importado_em: '2026-11-11T22:05:00+00:00', ...o });
const estAHU = () => ({ loja: 'AHU', lojas: ['AHU', 'SÃO BRAZ'], ouv: null });

test('abas antigas obedecem ao seletor de loja: só linhas da loja escolhida; bruto guardado para refiltrar', async () => {
  const dados = {
    unidades: [{ unidade: 'AHU', pedidos: 4, concluidos: 3, valor_concluido: 10, cancelados: 1, valor_cancelado: 2 },
      { unidade: 'SÃO BRAZ', pedidos: 7, concluidos: 7, valor_concluido: 20, cancelados: 0, valor_cancelado: 0 },
      { unidade: 'LOJA ALHEIA', pedidos: 9, concluidos: 9, valor_concluido: 99, cancelados: 0, valor_cancelado: 0 }],
    cancelamentos: [{ unidade: 'AHU', motivo: 'Motivo A', origem: 'TOTAL', qtd: 1, valor: 2 }, { unidade: 'SÃO BRAZ', motivo: 'Motivo B', origem: 'TOTAL', qtd: 1, valor: 3 }],
    avaliacoes_ruins: [{ unidade: 'SÃO BRAZ', pedido: 'P1', nota: 1, comentario: 'x', respondida: false }], ultimo_dado: {}
  };
  const est = estAHU();
  const t = montar({ rpc: () => ({ ok: true, status: 200, json: async () => dados }), est });
  t.iniciar('#placar');
  await settle();
  assert.match(t.els.conteudo.innerHTML, /Ahú/);
  assert.doesNotMatch(t.els.conteudo.innerHTML, /São Braz|LOJA ALHEIA/);
  assert.match(t.els.conteudo.innerHTML, /Pedidos no iFood<\/div><div class="card-val">4</); // só a loja escolhida entra na soma
  t.clicar('cancel'); assert.match(t.els.conteudo.innerHTML, /Motivo A/); assert.doesNotMatch(t.els.conteudo.innerHTML, /Motivo B/);
  t.clicar('quali'); assert.doesNotMatch(t.els.conteudo.innerHTML, /P1/);
  est.loja = 'SÃO BRAZ'; est.ouv('SÃO BRAZ'); await settle();
  assert.match(t.els.conteudo.innerHTML, /P1/); // refiltrado do dado bruto
  assert.match(t.els.fontes.innerHTML, /Última leitura geral das fontes/);
});

test('abas antigas: sem lojas carregadas ou sem cadastro não mostram todas as lojas', async () => {
  const dados = { unidades: [{ unidade: 'AHU', pedidos: 4 }], cancelamentos: [], avaliacoes_ruins: [], ultimo_dado: {} };
  const t = montar({ rpc: () => ({ ok: true, status: 200, json: async () => dados }), est: { loja: null, lojas: ['AHU'], semInfo: true, ouv: null } });
  t.iniciar('#placar'); await settle();
  assert.match(t.els.conteudo.innerHTML, /Carregando as lojas autorizadas/);
  assert.doesNotMatch(t.els.conteudo.innerHTML, /Ahú/);
  const t2 = montar({ rpc: () => ({ ok: true, status: 200, json: async () => dados }), est: { loja: null, lojas: [], ouv: null } });
  t2.iniciar('#placar'); await settle();
  assert.match(t2.els.conteudo.innerHTML, /não tem loja cadastrada/);
  assert.doesNotMatch(t2.els.conteudo.innerHTML, /Ahú/);
});

test('leitura só com Chegada ou Escala aberta e tela visível; antigas e conferência não consultam as novas fontes', async () => {
  const t = montar({ rpc: rpcOk, est: estAHU(), leitura: () => rows([]) });
  t.iniciar('#placar'); await settle();
  for (const a of ['tempo', 'cancel', 'quali', 'conferencia']) { t.clicar(a); await settle(); }
  assert.equal(t.leituras.length, 0);
  t.ocultar(true);
  t.clicar('chegada'); await settle(); t.intervalos[0](); await settle();
  assert.equal(t.leituras.length, 0); // tela oculta: nenhuma leitura nova
  t.ocultar(false);
  t.intervalos[0](); await settle();
  assert.equal(t.leituras.length, 2); // Foody e TrackEat
  assert.equal(t.intervalos.length, 1); // um único timer, o de 5 min que já existia
});

test('Chegada: Foody falha e TrackEat segue; fonte falha vira PARCIAL, não vazio; "Tentar de novo" só refaz a leitura', async () => {
  let foodyOk = false;
  const t = montar({ rpc: rpcOk, est: estAHU(),
    leitura: (u) => (u.startsWith('foody') ? (foodyOk ? rows([fRow({ entregador: 'Ciclano Foody' })]) : { ok: false, status: 500, json: async () => ({}) }) : rows([tRow()])) });
  t.iniciar('#chegada'); await settle();
  const h = t.els.operacao.innerHTML;
  assert.match(h, /Atividade registrada nas entregas/);
  assert.match(h, /Parcial/);
  assert.match(h, /Foody:<\/strong> não foi possível ler agora/);
  assert.match(h, /TrackEat:<\/strong> lida/);
  assert.match(h, /Chegada a conferir/);
  assert.doesNotMatch(h, /Não há atividade recebida/);
  assert.doesNotMatch(h, /Ao vivo|AO VIVO/i);
  const antes = t.leituras.length;
  foodyOk = true;
  t.els.operacao.ev.click({ target: { closest: () => ({}) } });
  await settle();
  assert.equal(t.leituras.length - antes, 2);
  assert.ok(t.leituras.every((l) => l.metodo === 'GET'));
  assert.match(t.els.operacao.innerHTML, /Ciclano Foody/);
  assert.doesNotMatch(t.els.operacao.innerHTML, /Parcial/);
});

test('Escala: 403 diz que ainda não foi liberada, nunca "nenhum escalado"; 200 sem linhas é outra mensagem', async () => {
  const t = montar({ rpc: rpcOk, est: estAHU(), leitura: () => ({ ok: false, status: 403, json: async () => ({ code: '42501', message: 'segredo' }) }) });
  t.iniciar('#escala'); await settle();
  assert.match(t.els.operacao.innerHTML, /A leitura da escala ainda não foi liberada/);
  assert.doesNotMatch(t.els.operacao.innerHTML, /<table|Sem linhas de escala|segredo|Nenhum escalado/i);
  const t2 = montar({ rpc: rpcOk, est: estAHU(), leitura: () => rows([]) });
  t2.iniciar('#escala'); await settle();
  assert.match(t2.els.operacao.innerHTML, /Sem linhas de escala/);
  assert.doesNotMatch(t2.els.operacao.innerHTML, /ainda não foi liberada/);
});

test('Escala: tabela real, fim no dia seguinte, alterações seguem Em construção; futuro só na Escala', async () => {
  const t = montar({ rpc: rpcOk, est: estAHU(),
    leitura: () => rows([escRow({ nome_na_escala: 'Noturno Teste', inicio: '22:00:00', fim: '02:00:00' }), escRow({ nome_na_escala: 'Aberto Teste', inicio: '18:00:00', fim: null }), escRow({ unidade: 'LOJA ALHEIA', nome_na_escala: 'Alheio Teste' })]) });
  t.iniciar('#escala'); await settle();
  const h = t.els.operacao.innerHTML;
  assert.match(h, /Noturno Teste/); assert.match(h, /Termina no dia seguinte/);
  assert.match(h, /Aberto Teste/); assert.match(h, /A conferir/);
  assert.doesNotMatch(h, /Alheio Teste/);
  assert.match(h, /Situação da alteração/); assert.match(h, /Ainda não ligado/);
  assert.doesNotMatch(h, /<input|<textarea|<select/);
  // dia futuro: aceito na Escala (max liberado); ao voltar para uma aba antiga o dia vira Hoje antes de qualquer consulta
  t.els.dia.value = '2026-11-12'; t.els.dia.ev.change(); await settle();
  assert.equal(t.els.dia.max, '');
  assert.ok(t.leituras.some((l) => l.url.includes('dia=eq.2026-11-12')));
  assert.ok(!t.chamadas.some((c) => c.args.p_dia === '2026-11-12'));
  t.clicar('placar'); await settle();
  assert.equal(t.els.dia.value, '2026-11-11');
  assert.equal(t.els.dia.max, '2026-11-11');
  assert.ok(!t.chamadas.some((c) => c.args.p_dia === '2026-11-12'));
  assert.equal(t.chamadas.at(-1).args.p_dia, '2026-11-11');
});

test('trocar dia ou loja descarta a resposta que ainda estava em voo e limpa a lista antes do contexto novo', async () => {
  const d1 = defer();
  let n = 0;
  const est = estAHU();
  const t = montar({ rpc: rpcOk, est, leitura: () => { n++; return n === 1 ? d1.p : rows([escRow({ dia: '2026-11-10', nome_na_escala: 'Dia Novo Teste' })]); } });
  t.iniciar('#escala'); await settle();
  t.els.dia.value = '2026-11-10'; t.els.dia.ev.change(); await settle();
  assert.match(t.els.operacao.innerHTML, /Dia Novo Teste/);
  d1.res(rows([escRow({ nome_na_escala: 'Dia Velho Teste' })])); await settle();
  assert.doesNotMatch(t.els.operacao.innerHTML, /Dia Velho Teste/);
  assert.match(t.els.operacao.innerHTML, /Dia Novo Teste/);
  // loja: a lista da loja anterior sai na hora, antes de a nova chegar
  const d2 = defer();
  const est2 = estAHU();
  const t2 = montar({ rpc: rpcOk, est: est2, leitura: (u) => (u.includes('unidade=eq.AHU') ? rows([escRow({ nome_na_escala: 'Da Loja Ahu' })]) : d2.p) });
  t2.iniciar('#escala'); await settle();
  assert.match(t2.els.operacao.innerHTML, /Da Loja Ahu/);
  est2.loja = 'SÃO BRAZ'; est2.ouv('SÃO BRAZ');
  assert.doesNotMatch(t2.els.operacao.innerHTML, /Da Loja Ahu/);
  assert.match(t2.els.operacao.innerHTML, /Carregando/);
  d2.res(rows([escRow({ unidade: 'SÃO BRAZ', nome_na_escala: 'Da Loja Sao Braz' })])); await settle();
  assert.match(t2.els.operacao.innerHTML, /Da Loja Sao Braz/);
});

test('401 numa leitura nova apaga os dados novos e usa o login existente; sessão removida em outra aba também limpa', async () => {
  const t = montar({ rpc: rpcOk, est: estAHU(), leitura: () => ({ ok: false, status: 401, json: async () => ({}) }) });
  t.iniciar('#chegada'); await settle();
  assert.equal(t.store.rmbSessao, null);
  assert.equal(t.els.operacao.innerHTML, '');
  assert.match(t.loc.href, /sistema\.html/);
  const t2 = montar({ rpc: rpcOk, est: estAHU(), leitura: () => rows([escRow()]) });
  t2.iniciar('#escala'); await settle();
  assert.match(t2.els.operacao.innerHTML, /Fulano Teste/);
  t2.store.rmbSessao = null;
  t2.janela.storage({ key: 'rmbSessao', newValue: null });
  assert.equal(t2.els.operacao.innerHTML, '');
  assert.match(t2.loc.href, /sistema\.html/);
  const antes = t2.leituras.length;
  t2.intervalos[0](); await settle();
  assert.equal(t2.leituras.length, antes);
});

// ---- Bloqueios do revisor: troca de conta, visibilidade durante awaits e moldura da casca oculta ----
const CONTA_A = '{"access_token":"x","email":"conta-a@exemplo.test"}';
const CONTA_B = JSON.stringify({ access_token: 'y', email: 'conta-b@exemplo.test' });

test('troca de conta A→B: limpa tudo ANTES do reload, preserva o login B e não consulta mais', async () => {
  const t = montar({ rpc: rpcOk, est: estAHU(), leitura: () => rows([escRow({ nome_na_escala: 'Conta A Teste' })]) });
  t.iniciar('#escala'); await settle();
  assert.match(t.els.operacao.innerHTML, /Conta A Teste/);
  t.store.rmbSessao = CONTA_B;
  t.janela.storage({ key: 'rmbSessao', newValue: CONTA_B });
  assert.equal(t.loc.reloads, 1);
  assert.equal(t.loc.antes.op, '');          // no momento do reload, a lista da conta A já tinha saído
  assert.equal(t.loc.antes.cont, '');
  assert.equal(t.loc.antes.sessao, CONTA_B); // o login B não foi apagado
  assert.equal(t.store.rmbSessao, CONTA_B);
  assert.doesNotMatch(t.els.operacao.innerHTML, /Conta A Teste/);
  const antes = t.leituras.length;
  t.intervalos[0](); await settle();
  t.clicar('chegada'); await settle();
  assert.equal(t.leituras.length, antes);    // SESSAO_OK falso: nada mais é consultado
});

test('renovação do token da mesma conta (e-mail igual, normalizado) não recarrega nem derruba a tela', async () => {
  const t = montar({ rpc: rpcOk, est: estAHU(), leitura: () => rows([escRow({ nome_na_escala: 'Conta A Teste' })]) });
  t.iniciar('#escala'); await settle();
  const renovado = JSON.stringify({ access_token: 'novo', email: '  CONTA-A@exemplo.test ' });
  t.store.rmbSessao = renovado;
  t.janela.storage({ key: 'rmbSessao', newValue: renovado });
  assert.equal(t.loc.reloads, 0);
  assert.match(t.els.operacao.innerHTML, /Conta A Teste/);
  assert.equal(t.store.rmbSessao, renovado);
});

test('sessão nova inválida (JSON quebrado ou sem e-mail) não reusa A: limpa e recarrega; o valor fica no storage', async () => {
  for (const novo of ['não é json', JSON.stringify({ access_token: 'z' })]) {
    const t = montar({ rpc: rpcOk, est: estAHU(), leitura: () => rows([escRow({ nome_na_escala: 'Conta A Teste' })]) });
    t.iniciar('#escala'); await settle();
    t.store.rmbSessao = novo;
    t.janela.storage({ key: 'rmbSessao', newValue: novo });
    assert.equal(t.loc.reloads, 1);
    assert.equal(t.loc.antes.op, '');
    assert.doesNotMatch(t.els.operacao.innerHTML, /Conta A Teste/);
    assert.equal(t.store.rmbSessao, novo);
  }
});

test('logout (newValue nulo) continua exigindo login, sem reload', async () => {
  const t = montar({ rpc: rpcOk, est: estAHU(), leitura: () => rows([escRow()]) });
  t.iniciar('#escala'); await settle();
  t.store.rmbSessao = null;
  t.janela.storage({ key: 'rmbSessao', newValue: null });
  assert.equal(t.loc.reloads, 0);
  assert.equal(t.els.operacao.innerHTML, '');
  assert.match(t.loc.href, /sistema\.html/);
});

test('resposta em voo da conta A não aparece depois da troca para B', async () => {
  const d = defer();
  const t = montar({ rpc: rpcOk, est: estAHU(), leitura: () => d.p });
  t.iniciar('#escala'); await settle();
  t.store.rmbSessao = CONTA_B;
  t.janela.storage({ key: 'rmbSessao', newValue: CONTA_B });
  d.res(rows([escRow({ nome_na_escala: 'Vazou Teste' })])); await settle();
  assert.doesNotMatch(t.els.operacao.innerHTML, /Vazou Teste/);
});

test('aba oculta enquanto a lista de lojas carrega: nenhum GET; ao voltar, a leitura retoma', async () => {
  const d = defer();
  const t = montar({ rpc: rpcOk, est: { loja: 'AHU', lojas: ['AHU'], ouv: null, defer: d }, leitura: () => rows([]) });
  t.iniciar('#chegada'); await settle();
  t.ocultar(true);          // document.hidden = true durante o await da loja
  d.res(); await settle();
  assert.equal(t.leituras.length, 0);
  t.ocultar(false);
  t.docOuv.visibilitychange(); await settle();
  assert.equal(t.leituras.length, 2); // Foody e TrackEat, só depois de visível
});

test('moldura da casca oculta no meio da 1ª página: a próxima página não é pedida e a resposta é descartada', async () => {
  const d = defer();
  let n = 0;
  const cheia = Array.from({ length: 250 }, (_, i) => escRow({ nome_na_escala: 'Pag ' + i }));
  const t = montar({ rpc: rpcOk, est: estAHU(), leitura: () => { n++; return d.p; } });
  t.iniciar('#escala'); await settle();
  assert.equal(n, 1);
  t.ocultarFrame(true);     // a casca escondeu a moldura; document.hidden continua false
  d.res(rows(cheia)); await settle();
  assert.equal(n, 1);
  assert.doesNotMatch(t.els.operacao.innerHTML, /Pag 0/);
  t.ocultarFrame(false);
  t.ctx.window.reentrarTela(); await settle();
  assert.ok(n > 1);         // voltou: a leitura recomeça
});

test('moldura da casca oculta ao abrir: zero GET nas abas novas e no timer; reentrarTela retoma com o filtro atual', async () => {
  const t = montar({ rpc: rpcOk, est: estAHU(), leitura: () => rows([escRow({ nome_na_escala: 'Frame Teste' })]) });
  t.ocultarFrame(true);
  t.iniciar('#escala'); await settle();
  assert.equal(t.leituras.length, 0);
  t.intervalos[0](); await settle();
  assert.equal(t.leituras.length, 0);
  assert.equal(t.intervalos.length, 1); // um único timer, o de 5 min que já existia
  t.ocultarFrame(false);
  t.ctx.window.reentrarTela(); await settle();
  assert.match(t.els.operacao.innerHTML, /Frame Teste/);
  assert.equal(t.els.dia.value, '2026-11-11'); // filtro de dia preservado
  assert.ok(t.leituras.length >= 1);
});

test('aba oculta ao abrir a Chegada: nenhuma leitura de atividade; ao voltar, as duas fontes são lidas', async () => {
  const t = montar({ rpc: rpcOk, est: estAHU(), leitura: () => rows([]) });
  t.ocultar(true);
  t.iniciar('#chegada'); await settle();
  assert.equal(t.leituras.length, 0);
  t.ocultar(false);
  t.docOuv.visibilitychange(); await settle();
  assert.equal(t.leituras.length, 2);
});
