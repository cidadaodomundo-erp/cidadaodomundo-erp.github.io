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
const settle = async () => { for (let i = 0; i < 20; i++) await new Promise((r) => setImmediate(r)); };
// texto visível: tira as tags (senão "h2" conta como dígito) e as entidades mais comuns
const textoVisivel = (h) => h.replace(/<[^>]+>/g, ' ').replace(/&[a-z#0-9]+;/gi, ' ');

function montar({ sessao = true, rpc = null, hoje = '2026-11-11', est = { loja: null, ouv: null } } = {}) {
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
  const hist = { pilha: [''], i: 0 };
  const loc = {
    get hash() { return hist.pilha[hist.i]; },
    set hash(v) { hist.pilha = hist.pilha.slice(0, hist.i + 1); hist.pilha.push('#' + v); hist.i++; (ouvintesJanela.hashchange || (() => {}))(); },
    href: ''
  };
  const ir = (d) => { hist.i += d; (ouvintesJanela.hashchange || (() => {}))(); };
  let agora = new Date(hoje + 'T15:00:00Z');
  class DataFalsa extends Date { constructor(...a) { if (a.length) super(...a); else super(agora.getTime()); } }
  const store = { rmbSessao: sessao ? '{"access_token":"x"}' : null };
  const intervalos = [];
  const ctx = {
    console, Date: DataFalsa, Promise, JSON, URL,
    window: { addEventListener: (n, f) => { ouvintesJanela[n] = f; } },
    document: {
      documentElement: { classList: { add() {} } },
      getElementById: (i) => els[i],
      querySelectorAll: (s) => (s === '#abas button' ? botoes : [])
    },
    location: loc,
    localStorage: { getItem: (k) => store[k] || null, removeItem: (k) => { store[k] = null; } },
    setInterval: (f) => { intervalos.push(f); return 1; },
    rmbSessao: () => JSON.parse(store.rmbSessao || 'null'),
    registrarUso() {}, carimboDados() {}, trEscH: OP.esc,
    // stub fiel ao real: lê o corpo JSON e usa a mensagem; sem mensagem, cai no HTTP
    trErroDe: async (r) => { try { const j = await r.json(); return j.message || 'HTTP ' + r.status; } catch (e) { return 'HTTP ' + r.status; } },
    trRpcSeguro: async (fn, args) => { chamadas.push({ fn, args }); return rpc ? rpc(fn, args) : { ok: false, status: 0, json: async () => ({}) }; },
    // loja: ficção controlada por `est` (lojaCarregar real faz rede; aqui não)
    lojaCarregar: async () => null,
    lojaAtual: () => est.loja,
    lojaNome: (l) => ({ 'AHU': 'Ahú', 'SÃO BRAZ': 'São Braz', 'REDE': 'Rede (as 3)' })[l] || (l ? String(l) : ''),
    aoMudarLoja: (fn) => { est.ouv = fn; }
  };
  ctx.window.parent = ctx.window; // parent === window => NA_CASCA falso
  ctx.self = ctx.window;
  vm.createContext(ctx);
  vm.runInContext(OPERACAO_SRC, ctx);
  ctx.DeliveryOperacao = ctx.window.DeliveryOperacao;
  vm.runInContext(scripts[0], ctx); // NA_CASCA / avisarCasca
  return {
    ctx, els, botoes, chamadas, loc, ir, intervalos, store, est,
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
  assert.equal(t.els.operacao.innerHTML, '');
  assert.match(t.loc.href, /sistema\.html/);
});

test('só consulta delivery_dia e acompanha o dia escolhido e a virada do dia', async () => {
  const t = montar({ rpc: rpcOk, hoje: '2026-11-11' });
  t.iniciar('#chegada');
  await settle();
  assert.deepEqual([...new Set(t.chamadas.map((c) => c.fn))], ['delivery_dia']);
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
  const est = { loja: 'AHU', ouv: null };
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
  assert.equal((HTML.match(/data-aba=/g) || []).length, 7);
});
