/* Regressões comportamentais da tela (freelas.js) com um DOM mínimo em vm. Node stdlib: node --test freelas/
 * Sem rede, sem impressão, sem download: trFetch, lojaCarregar e rmbSessao são dublês controlados pelo teste. */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const settle = async () => { for (let i = 0; i < 12; i++) await new Promise((r) => setImmediate(r)); };
const defer = () => { const d = {}; d.p = new Promise((res, rej) => { d.res = res; d.rej = rej; }); return d; };
const resp = (status, body, o = {}) => ({
  status, ok: status >= 200 && status < 300,
  json: async () => { if (o.espera) await o.espera; if (o.jsonErro) throw new Error('json'); return body; }
});
const ct = (id, nome, extra = {}) => ({ id, nome, setor: 'Cozinha', telefone: '(41) 90000-0000', tipo: 'Freela', ativo: true, loja: 'AHU', ...extra });
const INFO = { lojas: ['AGUA VERDE', 'AHU', 'SÃO BRAZ'], loja_inicial: 'AHU', travado: false };

function montar(o = {}) {
  const all = [], messages = [], evW = {}, evD = {};
  class E {
    constructor(tag, id) { this.tagName = tag.toUpperCase(); this.id = id; this.children = []; this.ev = {}; this.attrs = {}; this.value = ''; this.hidden = false; this._text = ''; this.disabled = false; this.className = ''; all.push(this); }
    set textContent(v) { this._text = String(v); this.children = []; }
    get textContent() { return this._text + this.children.map((c) => c.textContent).join(''); }
    set innerHTML(v) { throw new Error('innerHTML proibido'); }
    appendChild(e) { this.children.push(e); e.parent = this; return e; }
    setAttribute(k, v) { this.attrs[k] = v; }
    addEventListener(n, f) { (this.ev[n] = this.ev[n] || []).push(f); }
    fire(n) { (this.ev[n] || []).forEach((f) => f({ preventDefault() {}, target: this })); }
    click() { this.fire('click'); }
  }
  const ids = {};
  ['bloqueio', 'statusGeral', 'app', 'abaContatos', 'abaValores', 'btnAtualizar', 'painelContatos', 'painelValores', 'buscaTexto', 'filtroSetor',
    'fonteContatos', 'statusContatos', 'listaContatos', 'fonteValores', 'statusValores', 'listaValores'].forEach((id) => { ids[id] = new E('div', id); });
  const est = {
    email: o.email === undefined ? 'a@exemplo.test' : o.email, loja: o.loja === undefined ? 'AHU' : o.loja,
    info: o.info === undefined ? INFO : o.info, hidden: !!o.hidden, urls: [], removidos: [], usos: 0, lojaChamadas: 0, cb: null, reloads: 0,
    handler: o.handler || (() => resp(200, [])), deferLojas: o.deferLojas || null
  };
  const win = { addEventListener(n, f) { (evW[n] = evW[n] || []).push(f); }, frameElement: null };
  win.parent = win;
  const doc = {
    getElementById: (id) => ids[id], createElement: (t) => new E(t),
    addEventListener(n, f) { (evD[n] = evD[n] || []).push(f); },
    get hidden() { return est.hidden; }
  };
  const ctx = {
    console, window: win, document: doc,
    location: { origin: 'https://exemplo.test', href: '', reload() { est.reloads++; } },
    NA_CASCA: !!o.casca, avisarCasca: (m) => { if (o.casca) messages.push(m); }, parent: { postMessage: (m) => messages.push(m) },
    localStorage: { removeItem(k) { est.removidos.push(k); est.email = null; } },    // como o real: apagar a sessão deixa de ter e-mail
    rmbSessao: () => (est.email ? { email: est.email, access_token: 'TOKEN-NUNCA-NO-DOM' } : null),
    registrarUso() { est.usos++; },
    trFetch: async (url, opts) => { est.urls.push({ url, metodo: opts && opts.method }); return est.handler(url, est.urls.length); },
    lojaCarregar: async () => { est.lojaChamadas++; if (est.deferLojas) await est.deferLojas; return est.info; },
    lojaAtual: () => est.loja,
    lojaNome: (l) => ({ 'AGUA VERDE': 'Água Verde', 'AHU': 'Ahú', 'SÃO BRAZ': 'São Braz' }[l] || l),
    aoMudarLoja(fn) { est.cb = fn; }
  };
  ctx.self = win;
  vm.createContext(ctx);
  ['freelas-modelo.js', 'freelas-dados.js', 'freelas.js'].forEach((f) => vm.runInContext(fs.readFileSync(path.join(__dirname, f), 'utf8'), ctx, { filename: f }));
  const fireW = (n, ev = {}) => (evW[n] || []).forEach((f) => f(ev));
  const fireD = (n) => (evD[n] || []).forEach((f) => f({}));
  const texto = (id) => ids[id].textContent;
  const cartoes = (id) => ids[id].children.filter((c) => c.tagName === 'ARTICLE');
  const nomes = (id) => cartoes(id).map((c) => c.children[0].textContent);
  const pagina = () => Object.values(ids).map((e) => e.textContent + '|' + e.value).join('\n');
  const botao = (id) => ids[id].children.find((c) => c.tagName === 'BUTTON');
  const filtroLoja = (u) => decodeURIComponent(new URLSearchParams(u.url.split('?')[1]).get('loja'));
  return { ctx, win, ids, est, messages, all, fireW, fireD, texto, cartoes, nomes, pagina, botao, filtroLoja,
    start() { win.FreelasTela.iniciar(); } };
}

test('fluxo: contatos ordenados, só da loja, telefone como texto, sem link, sem ação de contratar; valores só ao abrir a aba', async () => {
  const t = montar({ handler: (u) => (u.startsWith('freela_contato') ? resp(200, [
    ct(2, 'Zeca'), ct(1, 'ana', { destaque: true, o_que_quer: 'SEGREDO-OQUER', telefone2: '99999' }), ct(3, 'Bia', { loja: 'SÃO BRAZ' }),
    ct(4, 'Caio', { loja: null }), ct(5, 'Dani', { ativo: false })]) : resp(200, [])) });
  t.start(); await settle();
  assert.equal(t.ids.app.hidden, false);
  assert.deepEqual(t.nomes('listaContatos'), ['ana', 'Zeca']);
  assert.equal(t.est.urls.length, 1);                       // valores NÃO é lido antes de abrir a aba
  assert.equal(t.est.urls[0].metodo, 'GET');
  assert.ok(t.est.urls[0].url.startsWith('freela_contato?select=id,nome,setor,telefone,tipo,ativo,loja&ativo=eq.true&loja=in.'));
  assert.match(t.texto('listaContatos'), /\(41\) 90000-0000/);
  assert.match(t.texto('fonteContatos'), /Fonte: portal novo, cadastro de contatos/);
  assert.match(t.texto('fonteContatos'), /consultado em \d\d\/\d\d\/\d{4} \d\d:\d\d/);
  assert.match(t.texto('statusContatos'), /sem loja definida/);   // aviso geral (Caio), sem expor o nome
  assert.ok(!/Caio|Bia|Dani|SEGREDO|99999|TOKEN/.test(t.pagina()));
  assert.equal(t.all.filter((e) => e.tagName === 'A').length, 0);
  assert.ok(!/contratar|whatsapp|mensagem/i.test(t.texto('listaContatos')));
  assert.equal(t.est.usos, 1);
});

test('abrir "Valores por hora": uma leitura, NULL não vira zero, data inválida explícita, outra loja/loja nula fora', async () => {
  const t = montar({ handler: (u) => (u.startsWith('freela_valor_hora') ? resp(200, [
    { loja: 'AHU', valor_hora: null, atualizado_em: 'lixo' }, { loja: 'AHU', valor_hora: 25, atualizado_em: '2026-11-10T15:30:00+00:00' },
    { loja: 'SÃO BRAZ', valor_hora: 31, atualizado_em: '2026-11-10' }, { loja: null, valor_hora: 99, atualizado_em: null }]) : resp(200, [])) });
  t.start(); await settle();
  t.ids.abaValores.click(); await settle();
  assert.equal(t.est.urls.length, 2);
  assert.ok(t.est.urls[1].url.startsWith('freela_valor_hora?select=loja,valor_hora,atualizado_em&loja=in.'));
  assert.equal(t.ids.painelValores.hidden, false); assert.equal(t.ids.painelContatos.hidden, true);
  const tx = t.texto('listaValores');
  assert.match(tx, /R\$ 25,00/); assert.match(tx, /10\/11\/2026 12:30/);
  assert.match(tx, /Não informado no cadastro/); assert.match(tx, /Data inválida no cadastro/);
  assert.ok(!/R\$ 0,00|R\$ 99|R\$ 31/.test(tx));
  assert.deepEqual(t.cartoes('listaValores').map((c) => c.children[0].textContent), ['Ahú', 'Ahú']);
  assert.match(t.texto('fonteValores'), /Fonte: portal novo, cadastro de valores por hora/);
  assert.match(tx, /não indica qual valor está em vigor/);
  t.ids.abaContatos.click(); t.ids.abaValores.click(); await settle();
  assert.equal(t.est.urls.length, 2);                       // voltar à aba já lida não relê
  t.ids.btnAtualizar.click(); await settle();
  assert.equal(t.est.urls.length, 3);                       // só o botão manual relê
});

test('403 mostra "consulta não liberada" (nunca zero contatos); retry com 200 [] mostra "sem registros" com fonte e carimbo', async () => {
  const t = montar({ handler: () => resp(403, { message: 'permission denied for table freela_contato' }) });
  t.start(); await settle();
  assert.match(t.texto('statusContatos'), /A consulta dos contatos ainda não foi liberada/);
  assert.equal(t.ids.listaContatos.children.length, 0);
  assert.equal(t.texto('fonteContatos'), '');
  assert.ok(!/Sem registros|0 contato/i.test(t.pagina()));
  assert.ok(!/permission denied/.test(t.pagina()));          // mensagem técnica do banco não vai para a tela
  t.est.handler = () => resp(200, []);
  t.botao('statusContatos').click(); await settle();
  assert.match(t.texto('listaContatos'), /Sem registros de contatos ativos para Ahú/);
  assert.match(t.texto('listaContatos'), /consulta de \d\d\/\d\d\/\d{4}/);
  assert.match(t.texto('fonteContatos'), /Fonte: portal novo/);
  assert.ok(!/ainda não foi liberada/.test(t.texto('statusContatos')));
});

test('falha de conexão/serviço é diferente de bloqueio e de lista vazia; botão tenta de novo', async () => {
  for (const h of [() => { throw new Error('offline'); }, () => resp(500, {}), () => resp(200, { message: 'x' }), () => resp(200, [], { jsonErro: true })]) {
    const t = montar({ handler: h });
    t.start(); await settle();
    assert.match(t.texto('statusContatos'), /conexão ou serviço/);
    assert.ok(!/ainda não foi liberada|Sem registros/.test(t.pagina()));
    assert.equal(t.ids.listaContatos.children.length, 0);
    assert.ok(t.botao('statusContatos'));
  }
});

test('texto vindo do banco entra só como texto (XSS): nenhum elemento novo, sem innerHTML', async () => {
  const mal = '<img src=x onerror=alert(1)><script>alert(2)</script>';
  const t = montar({ handler: () => resp(200, [ct(1, mal, { setor: '"><svg onload=1>', tipo: '<b>x</b>', telefone: 'javascript:alert(3)' })]) });
  t.start(); await settle();
  assert.equal(t.nomes('listaContatos')[0], mal);
  assert.match(t.texto('listaContatos'), /javascript:alert\(3\)/);          // continua só texto, sem link
  const tags = new Set(t.all.map((e) => e.tagName));
  ['IMG', 'SCRIPT', 'SVG', 'B', 'A', 'IFRAME'].forEach((x) => assert.ok(!tags.has(x), x));
});

test('hidden inicial: nenhuma leitura (nem allowlist, nem uso) até a tela ficar visível; depois lê uma vez', async () => {
  const t = montar({ hidden: true, handler: () => resp(200, [ct(1, 'Ana')]) });
  t.start(); await settle();
  assert.equal(t.est.lojaChamadas, 0); assert.equal(t.est.urls.length, 0); assert.equal(t.est.usos, 0);
  assert.equal(t.ids.app.hidden, true);
  assert.match(t.texto('statusGeral'), /quando esta tela estiver visível/);
  t.fireW('focus'); t.fireW('resize'); await settle();                    // oculta: eventos não leem nada
  assert.equal(t.est.urls.length, 0);
  t.est.hidden = false; t.fireD('visibilitychange'); await settle();
  assert.ok(t.est.lojaChamadas >= 1); assert.equal(t.est.urls.length, 1);
  assert.deepEqual(t.nomes('listaContatos'), ['Ana']);
  t.fireD('visibilitychange'); t.fireW('focus'); t.fireW('resize'); await settle();
  assert.equal(t.est.urls.length, 1);                                      // visível de novo não relê por conta própria
});

test('moldura da casca escondida (iframe ancestral hidden) bloqueia a leitura; reentrarTela retoma ao reabrir', async () => {
  const t = montar({ handler: () => resp(200, [ct(1, 'Ana')]) });
  const topo = { frameElement: { hidden: true } }; topo.parent = topo;
  t.win.parent = topo;
  t.start(); await settle();
  assert.equal(t.est.urls.length, 0); assert.equal(t.est.lojaChamadas, 0);
  topo.frameElement.hidden = false;
  t.win.reentrarTela(); await settle();
  assert.deepEqual(t.nomes('listaContatos'), ['Ana']);
  assert.equal(t.est.urls.length, 1);
  t.win.reentrarTela(); await settle();
  assert.equal(t.est.urls.length, 1);
  // própria moldura escondida
  const u = montar({ handler: () => resp(200, []) });
  u.win.frameElement = { hidden: true };
  u.start(); await settle();
  assert.equal(u.est.urls.length, 0);
});

test('escondida NO MEIO da leitura: a resposta é descartada e a leitura refeita quando voltar', async () => {
  const d = defer();
  const t = montar({ handler: (u, n) => (n === 1 ? d.p : resp(200, [ct(2, 'Depois')])) });
  t.start(); await settle();
  t.est.hidden = true; d.res(resp(200, [ct(1, 'Escondida')])); await settle();
  assert.ok(!/Escondida/.test(t.pagina()));
  assert.match(t.texto('statusContatos'), /quando esta tela estiver visível/);
  t.est.hidden = false; t.fireD('visibilitychange'); await settle();
  assert.deepEqual(t.nomes('listaContatos'), ['Depois']);
  assert.equal(t.est.urls.length, 2);
});

test('formulário nasce fechado e só abre com allowlist válida; falha de lojaCarregar NÃO é lista vazia e tem retry manual', async () => {
  const t = montar({ info: null });
  t.start();
  assert.equal(t.ids.app.hidden, true); assert.equal(t.ids.btnAtualizar.disabled, true);
  await settle();
  assert.equal(t.ids.app.hidden, true);
  assert.match(t.texto('statusGeral'), /Não foi possível carregar as lojas autorizadas/);
  assert.ok(!/pendente|Sem registros/.test(t.pagina()));
  assert.equal(t.est.urls.length, 0);
  t.fireW('focus'); t.fireD('visibilitychange'); await settle();              // não tenta sozinha de novo
  assert.equal(t.est.lojaChamadas, 1);
  t.est.info = INFO; t.botao('statusGeral').click(); await settle();
  assert.ok(t.est.lojaChamadas >= 2);
  assert.equal(t.ids.app.hidden, false); assert.equal(t.est.urls.length, 1);
});

test('conta sem loja cadastrada (allowlist vazia): tela abre, mensagem de cadastro pendente, nenhum GET', async () => {
  const t = montar({ info: { lojas: [], loja_inicial: null, travado: false }, loja: null });
  t.start(); await settle();
  assert.equal(t.ids.app.hidden, false);
  assert.match(t.texto('statusContatos'), /cadastro de loja desta conta ainda está pendente/);
  t.ids.abaValores.click(); await settle();
  assert.match(t.texto('statusValores'), /pendente/);
  assert.equal(t.est.urls.length, 0);
});

test('REDE: um GET com as lojas concretas da allowlist (sem a palavra REDE) para os dois cadastros', async () => {
  const t = montar({ loja: 'REDE', info: { lojas: ['AGUA VERDE', 'AHU', 'SÃO BRAZ', 'REDE'], loja_inicial: 'REDE', travado: false },
    handler: () => resp(200, [ct(1, 'Ana', { loja: 'Água Verde' }), ct(2, 'Bia', { loja: 'REDE' }), ct(3, 'Caio', { loja: 'BOQUEIRAO' })]) });
  t.start(); await settle();
  const f = t.filtroLoja(t.est.urls[0]);
  assert.match(f, /AGUA VERDE/); assert.match(f, /AHU/); assert.match(f, /SÃO BRAZ/);
  assert.ok(!/REDE|BOQUEIRAO/i.test(f));
  assert.deepEqual(t.nomes('listaContatos'), ['Ana']);
  assert.match(t.texto('listaContatos'), /Água Verde/);
});

test('conta A -> B durante a carga da allowlist: tela travada com aviso de recarregar, nenhum GET', async () => {
  const d = defer();
  const t = montar({ deferLojas: d.p });
  t.start();
  t.est.email = 'b@exemplo.test'; d.res(); await settle();
  assert.equal(t.ids.app.hidden, true);
  assert.equal(t.ids.bloqueio.hidden, false);
  assert.match(t.texto('bloqueio'), /outro usuário/); assert.match(t.texto('bloqueio'), /Recarregar/);
  assert.equal(t.est.urls.length, 0);
  t.botao('bloqueio').click(); assert.equal(t.est.reloads, 1);
});

test('logout durante a carga da allowlist: nada é liberado; vai ao login (fora da casca)', async () => {
  const d = defer();
  const t = montar({ deferLojas: d.p });
  t.start();
  t.est.email = null; d.res(); await settle();
  assert.equal(t.ids.app.hidden, true); assert.equal(t.est.urls.length, 0);
  assert.match(t.ctx.location.href, /sistema\.html$/);
});

test('logout depois de carregado: dados e DOM limpos antes de tudo; login pedido uma única vez', async () => {
  const t = montar({ handler: () => resp(200, [ct(1, 'PESSOA-A', { telefone: 'TEL-A' })]) });
  t.start(); await settle();
  t.ids.buscaTexto.value = 'BUSCA-A';
  assert.match(t.pagina(), /PESSOA-A/);
  t.est.email = null; t.fireW('storage', { key: 'rmbSessao' });
  assert.ok(!/PESSOA-A|TEL-A|BUSCA-A/.test(t.pagina()));
  assert.equal(t.ids.app.hidden, true); assert.equal(t.ids.bloqueio.hidden, false);
  assert.match(t.texto('bloqueio'), /Sem sessão/);
  assert.match(t.ctx.location.href, /sistema\.html$/);
  t.ctx.location.href = 'MARCA'; t.fireW('storage', { key: 'rmbSessao' }); t.fireW('focus'); t.fireD('visibilitychange');
  assert.equal(t.ctx.location.href, 'MARCA');
  assert.equal(t.est.urls.length, 1);
  t.ids.btnAtualizar.click(); await settle();
  assert.equal(t.est.urls.length, 1);
});

test('conta A -> B com dados na tela: some tudo no ato (storage, focus, pageshow, visibilitychange), sem reler e sem apagar a sessão de B', async () => {
  for (const [alvo, ev] of [['W', 'storage'], ['W', 'focus'], ['W', 'pageshow'], ['D', 'visibilitychange']]) {
    const t = montar({ handler: () => resp(200, [ct(1, 'PESSOA-A')]) });
    t.start(); await settle();
    t.est.email = 'b@exemplo.test';
    if (alvo === 'W') t.fireW(ev, { key: 'rmbSessao' }); else t.fireD(ev);
    assert.ok(!/PESSOA-A/.test(t.pagina()), ev);
    assert.equal(t.ids.app.hidden, true, ev);
    assert.match(t.texto('bloqueio'), /outro usuário/, ev);
    t.ids.btnAtualizar.click(); await settle();
    assert.equal(t.est.urls.length, 1, ev);
    assert.deepEqual(t.est.removidos, [], ev);               // o login novo (B) é preservado
    assert.equal(t.est.email, 'b@exemplo.test');
  }
});

test('renovação de token da MESMA conta (mesmo e-mail, caixa/espaço diferentes) não muda nada', async () => {
  const t = montar({ handler: () => resp(200, [ct(1, 'Ana')]) });
  t.start(); await settle();
  t.est.email = '  A@EXEMPLO.TEST ';
  t.fireW('storage', { key: 'rmbSessao' }); t.fireW('focus'); t.fireW('pageshow'); await settle();
  assert.deepEqual(t.nomes('listaContatos'), ['Ana']);
  assert.equal(t.ids.bloqueio.hidden, true); assert.equal(t.est.urls.length, 1);
});

test('A->B com resposta de A ainda no ar: nada de A aparece, nada é relido, sessão de B intacta', async () => {
  const d = defer();
  const t = montar({ handler: () => d.p });
  t.start(); await settle();
  t.est.email = 'b@exemplo.test'; t.fireW('storage', { key: 'rmbSessao' });
  d.res(resp(200, [ct(1, 'PESSOA-A')])); await settle();
  assert.ok(!/PESSOA-A/.test(t.pagina()));
  assert.match(t.texto('bloqueio'), /outro usuário/);
  assert.equal(t.est.urls.length, 1); assert.deepEqual(t.est.removidos, []);
});

test('401 ATRASADO de A não remove a sessão de B nem pede login; 401 da conta atual encerra a sessão dela', async () => {
  const d = defer();
  const t = montar({ handler: () => d.p });
  t.start(); await settle();
  t.est.email = 'b@exemplo.test'; t.fireW('storage', { key: 'rmbSessao' });
  d.res(resp(401, {})); await settle();
  assert.deepEqual(t.est.removidos, []); assert.equal(t.est.email, 'b@exemplo.test');
  assert.equal(t.ctx.location.href, '');
  assert.match(t.texto('bloqueio'), /outro usuário/);
  // conta atual: depois da renovação do núcleo ainda veio 401
  const u = montar({ handler: () => resp(401, {}) });
  u.start(); await settle();
  assert.deepEqual(u.est.removidos, ['rmbSessao']);
  assert.match(u.ctx.location.href, /sistema\.html$/);
  assert.ok(!/Sem registros|ainda não foi liberada/.test(u.pagina()));
  assert.equal(u.ids.app.hidden, true);
  // dentro da casca: só avisa o pai
  const c = montar({ casca: true, handler: () => resp(401, {}) });
  c.start(); await settle();
  assert.equal(c.ctx.location.href, '');
  assert.ok(c.messages.some((m) => m.tipo === 'casca-login'));
  assert.ok(c.messages.some((m) => m.tipo === 'casca-modulo' && m.nome === 'freelas'));
});

test('sem sessão: fora da casca vai ao login existente; dentro da casca só avisa o pai; nada é consultado', async () => {
  const f = montar({ email: null }); f.start(); await settle();
  assert.match(f.ctx.location.href, /sistema\.html$/); assert.equal(f.ids.app.hidden, true);
  assert.equal(f.est.lojaChamadas, 0); assert.equal(f.est.urls.length, 0);
  const c = montar({ email: null, casca: true }); c.start(); await settle();
  assert.equal(c.ctx.location.href, '');
  assert.ok(c.messages.some((m) => m.tipo === 'casca-login'));
});

test('troca de loja: some o anterior, relê só a nova; resposta E erro da loja antiga (inclusive após r.json) são descartados', async () => {
  const d1 = defer(), dj = defer();
  const t = montar({ handler: (u, n) => (n === 1 ? d1.p : n === 2 ? resp(200, [ct(7, 'Sol', { loja: 'SÃO BRAZ' })], { espera: dj.p }) : resp(200, [ct(8, 'Lua', { loja: 'AGUA VERDE' })])) });
  t.start(); await settle();                                  // GET 1 (AHU) no ar
  t.est.loja = 'SÃO BRAZ'; t.est.cb('SÃO BRAZ'); await settle();   // GET 2 (SÃO BRAZ) esperando o json
  assert.equal(t.est.urls.length, 2);
  assert.match(t.filtroLoja(t.est.urls[1]), /SÃO BRAZ/); assert.ok(!/AHU/.test(t.filtroLoja(t.est.urls[1])));
  assert.match(t.texto('statusContatos'), /Carregando/);
  t.est.loja = 'AGUA VERDE'; t.est.cb('AGUA VERDE'); await settle();  // GET 3 (AGUA VERDE) já responde
  assert.deepEqual(t.nomes('listaContatos'), ['Lua']);
  dj.res(); d1.rej(new Error('erro atrasado da AHU')); await settle();
  assert.deepEqual(t.nomes('listaContatos'), ['Lua']);
  assert.ok(!/erro atrasado|Sol|conexão ou serviço/.test(t.pagina()));
  assert.equal(t.est.urls.length, 3);
});

test('troca de loja limpa a busca e o filtro de setor do recorte anterior', async () => {
  const t = montar({ handler: () => resp(200, [ct(1, 'Ana'), ct(2, 'Bia', { setor: 'Salão' })]) });
  t.start(); await settle();
  t.ids.buscaTexto.value = 'bia'; t.ids.buscaTexto.fire('input');
  assert.deepEqual(t.nomes('listaContatos'), ['Bia']);
  t.est.loja = 'SÃO BRAZ'; t.est.cb('SÃO BRAZ'); await settle();
  assert.equal(t.ids.buscaTexto.value, '');
  assert.equal(t.est.urls.length, 2);
});

test('Atualizar manual: só a leitura mais recente vale, mesmo que a anterior responda depois (sucesso ou erro)', async () => {
  const d1 = defer();
  const t = montar({ handler: (u, n) => (n === 1 ? d1.p : resp(200, [ct(2, 'Nova')])) });
  t.start(); await settle();
  t.ids.btnAtualizar.click(); await settle();
  assert.deepEqual(t.nomes('listaContatos'), ['Nova']);
  d1.res(resp(200, [ct(1, 'Velha')])); await settle();
  assert.deepEqual(t.nomes('listaContatos'), ['Nova']);
  const e1 = defer();
  const u = montar({ handler: (x, n) => (n === 1 ? e1.p : resp(200, [ct(2, 'Nova')])) });
  u.start(); await settle(); u.ids.btnAtualizar.click(); await settle();
  e1.rej(new Error('queda antiga')); await settle();
  assert.deepEqual(u.nomes('listaContatos'), ['Nova']);
  assert.ok(!/conexão ou serviço/.test(u.pagina()));
});

test('busca e filtro de setor trabalham só no que já foi lido (sem novo GET); sem ranking por destaque', async () => {
  const t = montar({ handler: () => resp(200, [
    ct(1, 'Zeca', { destaque: true, setor: 'Cozinha' }), ct(2, 'Ângela', { setor: 'Cozinha' }), ct(3, 'Bruno', { setor: 'Salão' }), ct(4, 'Carla', { setor: null })]) });
  t.start(); await settle();
  assert.deepEqual(t.nomes('listaContatos'), ['Ângela', 'Bruno', 'Carla', 'Zeca']);
  t.ids.buscaTexto.value = 'angela'; t.ids.buscaTexto.fire('input');
  assert.deepEqual(t.nomes('listaContatos'), ['Ângela']);
  assert.match(t.texto('listaContatos'), /1 de 4 contato/);
  t.ids.buscaTexto.value = ''; t.ids.buscaTexto.fire('input');
  t.ids.filtroSetor.value = 'salao'; t.ids.filtroSetor.fire('change');
  assert.deepEqual(t.nomes('listaContatos'), ['Bruno']);
  t.ids.filtroSetor.value = 'cozinha'; t.ids.filtroSetor.fire('change');
  assert.deepEqual(t.nomes('listaContatos'), ['Ângela', 'Zeca']);
  t.ids.buscaTexto.value = 'nada-assim'; t.ids.buscaTexto.fire('input');
  assert.match(t.texto('listaContatos'), /Nenhum contato bate com a busca/);
  assert.equal(t.est.urls.length, 1);
});

test('lista que atingiu o teto avisa que é parcial; cadastros inválidos são contados, não escondidos', async () => {
  const lote = (n, ini) => Array.from({ length: n }, (_, i) => ct(ini + i, 'P' + String(ini + i).padStart(5, '0')));
  const t = montar({ handler: (u, n) => resp(200, lote(200, (n - 1) * 200 + 1)) });
  t.start(); await settle();
  assert.equal(t.est.urls.length, 10);
  assert.match(t.texto('statusContatos'), /Lista parcial/);
  assert.match(t.texto('listaContatos'), /2000 contato/);
  const u = montar({ handler: () => resp(200, [ct(1, 'Ana'), ct(2, '   '), ct(null, 'Sem id')]) });
  u.start(); await settle();
  assert.match(u.texto('statusContatos'), /2 registro\(s\) com dados incompletos/);
});

test('cartões Ponto/QR/Pagamentos ficam só no HTML estático, em construção, sem script de dados', () => {
  const html = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8');
  ['Ponto do freela', 'QR de presença', 'Pagamentos'].forEach((n) => assert.ok(html.includes(n), n));
  assert.equal((html.match(/Em construção/g) || []).length >= 4, true);
  assert.match(html, /Nenhuma presença é registrada/);
  assert.match(html, /Nenhum pagamento é calculado ou feito/);
});
