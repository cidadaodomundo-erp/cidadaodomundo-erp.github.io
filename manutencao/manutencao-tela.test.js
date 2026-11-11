/* Regressões comportamentais da tela (manutencao.js) com um DOM mínimo em vm. Node stdlib: node --test manutencao/
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
const pr = (id, nome, extra = {}) => ({ id, nome, setor: 'Elétrica', telefone: '(41) 3000-0000', ativo: true, ...extra });
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
  ['bloqueio', 'statusGeral', 'app', 'abaChamados', 'abaPrestadores', 'btnAtualizar', 'btnQuemConserta', 'painelChamados', 'painelPrestadores',
    'buscaTexto', 'filtroSetor', 'fontePrest', 'statusPrest', 'listaPrest', 'campoLoja', 'lojaInfo'].forEach((id) => { ids[id] = new E('div', id); });
  const est = {
    email: o.email === undefined ? 'a@exemplo.test' : o.email, loja: o.loja === undefined ? 'AHU' : o.loja,
    info: o.info === undefined ? INFO : o.info, hidden: !!o.hidden, urls: [], removidos: [], lojaChamadas: 0, cb: null, reloads: 0,
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
    location: { origin: 'https://exemplo.test', href: '', hash: o.hash || '', reload() { est.reloads++; } },
    NA_CASCA: !!o.casca, avisarCasca: (m) => { if (o.casca) messages.push(m); },
    localStorage: { removeItem(k) { est.removidos.push(k); est.email = null; } },
    rmbSessao: () => (est.email ? { email: est.email, access_token: 'TOKEN-NUNCA-NO-DOM' } : null),
    trFetch: async (url, opts) => { est.urls.push({ url, metodo: opts && opts.method }); return est.handler(url, est.urls.length); },
    lojaCarregar: async () => { est.lojaChamadas++; if (est.deferLojas) await est.deferLojas; return est.info; },
    lojaAtual: () => est.loja,
    lojaNome: (l) => ({ 'AGUA VERDE': 'Água Verde', 'AHU': 'Ahú', 'SÃO BRAZ': 'São Braz' }[l] || l),
    aoMudarLoja(fn) { est.cb = fn; }
  };
  ctx.self = win;
  vm.createContext(ctx);
  ['manutencao-modelo.js', 'manutencao-dados.js', 'manutencao.js'].forEach((f) => vm.runInContext(fs.readFileSync(path.join(__dirname, f), 'utf8'), ctx, { filename: f }));
  const fireW = (n, ev = {}) => (evW[n] || []).forEach((f) => f(ev));
  const fireD = (n) => (evD[n] || []).forEach((f) => f({}));
  const texto = (id) => ids[id].textContent;
  const nomes = () => ids.listaPrest.children.filter((c) => c.tagName === 'ARTICLE').map((c) => c.children[0].textContent);
  const pagina = () => Object.values(ids).map((e) => e.textContent + '|' + e.value).join('\n');
  const botao = (id) => ids[id].children.find((c) => c.tagName === 'BUTTON');
  return { ctx, win, ids, est, messages, all, fireW, fireD, texto, nomes, pagina, botao, start() { win.ManutencaoTela.iniciar(); } };
}

test('aba Chamados (padrão): nenhuma consulta ao diretório; mostra a loja escolhida; Quem conserta não é lida', async () => {
  const t = montar({ handler: () => resp(200, [pr(1, 'Ana')]) });
  t.start();
  assert.equal(t.ids.app.hidden, true);                       // oculta enquanto aguarda as lojas
  await settle();
  assert.equal(t.ids.app.hidden, false);
  assert.equal(t.est.urls.length, 0);
  assert.equal(t.ids.painelChamados.hidden, false); assert.equal(t.ids.painelPrestadores.hidden, true);
  assert.match(t.texto('campoLoja'), /Ahú/);
  assert.match(t.texto('lojaInfo'), /nenhum chamado é gravado/);
  t.est.loja = 'SÃO BRAZ'; t.est.cb('SÃO BRAZ');
  assert.match(t.texto('campoLoja'), /São Braz/);
  assert.equal(t.est.urls.length, 0);
});

test('Chamados fora da casca: atalho abre o diretório na própria página e só então consulta; voltar a Chamados não relê', async () => {
  const t = montar({ handler: () => resp(200, [pr(2, 'Zeca'), pr(1, 'ana')]) });
  t.start(); await settle();
  t.ids.btnQuemConserta.click(); await settle();
  assert.equal(t.est.urls.length, 1); assert.equal(t.est.urls[0].metodo, 'GET');
  assert.ok(t.est.urls[0].url.startsWith('prestador?select=id,setor,nome,telefone,ativo&ativo=eq.true'));
  assert.deepEqual(t.nomes(), ['ana', 'Zeca']);
  assert.equal(t.ids.painelPrestadores.hidden, false);
  assert.match(t.texto('fontePrest'), /Fonte: Cadastro de prestadores do portal novo · consultado em \d\d\/\d\d\/\d{4} \d\d:\d\d/);
  assert.match(t.texto('listaPrest'), /\(41\) 3000-0000/);
  t.ids.abaChamados.click(); t.ids.abaPrestadores.click(); await settle();
  assert.equal(t.est.urls.length, 1);
  t.ids.btnAtualizar.click(); await settle();
  assert.equal(t.est.urls.length, 2);                         // só o botão manual relê
});

test('na casca: o atalho e as abas só mandam postMessage {casca-modulo}; nada é consultado pela página dos chamados', async () => {
  const t = montar({ casca: true });
  t.start(); await settle();
  // objetos criados dentro da VM têm outro protótipo: compara-se a forma JSON (chaves, tipos e valores exatos)
  const norm = (m) => JSON.parse(JSON.stringify(m));
  assert.deepEqual(t.messages.map(norm)[0], { tipo: 'casca-modulo', nome: 'manutencao' });
  t.ids.btnQuemConserta.click(); t.ids.abaPrestadores.click(); await settle();
  assert.deepEqual(t.messages.slice(1).map(norm), [{ tipo: 'casca-modulo', nome: 'prestadores' }, { tipo: 'casca-modulo', nome: 'prestadores' }]);
  assert.equal(t.est.urls.length, 0);
  assert.equal(t.ids.painelChamados.hidden, false);
  const p = montar({ casca: true, hash: '#prestadores', handler: () => resp(200, [pr(1, 'Ana')]) });   // a rota prestadores abre o diretório sem lojas
  p.start(); await settle();
  assert.deepEqual(JSON.parse(JSON.stringify(p.messages[0])), { tipo: 'casca-modulo', nome: 'prestadores' });
  assert.equal(p.est.lojaChamadas, 0); assert.deepEqual(p.nomes(), ['Ana']);
  p.ids.abaChamados.click(); assert.deepEqual(JSON.parse(JSON.stringify(p.messages[p.messages.length - 1])), { tipo: 'casca-modulo', nome: 'manutencao' });
});

test('diretório: 403 = "não liberada" (nunca zero); depois 200 [] = vazio distinto; falha de rede/500 = outro aviso', async () => {
  const t = montar({ hash: '#prestadores', handler: () => resp(403, { message: 'permission denied for table prestador' }) });
  t.start(); await settle();
  assert.match(t.texto('statusPrest'), /A consulta de prestadores ainda não foi liberada/);
  assert.ok(!/Nenhum prestador ativo|0 prestador|permission denied/.test(t.pagina()));
  assert.equal(t.texto('fontePrest'), ''); assert.equal(t.ids.listaPrest.children.length, 0);
  t.est.handler = () => resp(200, []);
  t.botao('statusPrest').click(); await settle();
  assert.match(t.texto('listaPrest'), /Nenhum prestador ativo no Cadastro de prestadores do portal novo/);
  assert.match(t.texto('fontePrest'), /Fonte: Cadastro de prestadores/);
  assert.ok(!/ainda não foi liberada/.test(t.pagina()));
  for (const h of [() => { throw new Error('offline'); }, () => resp(500, {}), () => resp(200, [], { jsonErro: true })]) {
    const u = montar({ hash: '#prestadores', handler: h });
    u.start(); await settle();
    assert.match(u.texto('statusPrest'), /conexão ou serviço/);
    assert.ok(!/ainda não foi liberada|Nenhum prestador ativo|\b0 prestador/.test(u.pagina()));
    assert.ok(u.botao('statusPrest'));
  }
});

test('ativo estrito, campos extras fora da tela, texto malicioso só como texto, telefone sem link', async () => {
  const mal = '<img src=x onerror=alert(1)>';
  const t = montar({ hash: '#prestadores', handler: () => resp(200, [
    pr(1, mal, { telefone: 'javascript:alert(3)', segredo: 'SEGREDO' }), pr(2, 'Falso', { ativo: 'false' }), pr(3, 'Inativo', { ativo: false }), pr(4, 'Um', { ativo: 1 })]) });
  t.start(); await settle();
  assert.deepEqual(t.nomes(), [mal]);
  assert.match(t.texto('listaPrest'), /javascript:alert\(3\)/);
  assert.ok(!/SEGREDO|Falso|Inativo|Um\b|TOKEN/.test(t.pagina()));
  const tags = new Set(t.all.map((e) => e.tagName));
  ['IMG', 'SCRIPT', 'A', 'IFRAME'].forEach((x) => assert.ok(!tags.has(x), x));
});

test('busca e filtro de setor só no que já foi lido (sem novo GET)', async () => {
  const t = montar({ hash: '#prestadores', handler: () => resp(200, [pr(1, 'Zeca', { setor: 'Elétrica' }), pr(2, 'Ângela', { setor: 'Elétrica' }), pr(3, 'Bruno', { setor: 'Hidráulica' })]) });
  t.start(); await settle();
  assert.deepEqual(t.nomes(), ['Ângela', 'Bruno', 'Zeca']);
  t.ids.buscaTexto.value = 'angela'; t.ids.buscaTexto.fire('input');
  assert.deepEqual(t.nomes(), ['Ângela']);
  assert.match(t.texto('listaPrest'), /1 de 3 prestador/);
  t.ids.buscaTexto.value = '';  t.ids.buscaTexto.fire('input');
  t.ids.filtroSetor.value = 'hidraulica'; t.ids.filtroSetor.fire('change');
  assert.deepEqual(t.nomes(), ['Bruno']);
  t.ids.buscaTexto.value = 'nada-assim'; t.ids.buscaTexto.fire('input');
  assert.match(t.texto('listaPrest'), /Nenhum prestador bate com a busca/);
  assert.equal(t.est.urls.length, 1);
});

test('hidden inicial e moldura escondida: nenhuma consulta; reentrarTela retoma uma única vez; escondida NO MEIO descarta a resposta', async () => {
  const t = montar({ hash: '#prestadores', hidden: true, handler: () => resp(200, [pr(1, 'Ana')]) });
  t.start(); await settle();
  assert.equal(t.est.urls.length, 0);
  t.fireW('focus'); t.fireW('resize'); await settle();
  assert.equal(t.est.urls.length, 0);
  t.est.hidden = false; t.fireD('visibilitychange'); await settle();
  assert.deepEqual(t.nomes(), ['Ana']); assert.equal(t.est.urls.length, 1);
  t.fireD('visibilitychange'); t.win.reentrarTela(); await settle();
  assert.equal(t.est.urls.length, 1);
  // iframe ancestral escondido (como a casca guarda molduras)
  const u = montar({ hash: '#prestadores', handler: () => resp(200, [pr(1, 'Ana')]) });
  const topo = { frameElement: { hidden: true } }; topo.parent = topo; u.win.parent = topo;
  u.start(); await settle();
  assert.equal(u.est.urls.length, 0);
  topo.frameElement.hidden = false; u.win.reentrarTela(); await settle();
  assert.deepEqual(u.nomes(), ['Ana']);
  // escondida no meio da leitura
  const d = defer();
  const v = montar({ hash: '#prestadores', handler: (x, n) => (n === 1 ? d.p : resp(200, [pr(2, 'Depois')])) });
  v.start(); await settle();
  v.est.hidden = true; d.res(resp(200, [pr(1, 'Escondida')])); await settle();
  assert.ok(!/Escondida/.test(v.pagina()));
  v.est.hidden = false; v.fireD('visibilitychange'); await settle();
  assert.deepEqual(v.nomes(), ['Depois']);
});

test('troca para Chamados no meio da leitura: resposta do diretório é descartada e relida ao voltar', async () => {
  const d = defer();
  const t = montar({ hash: '#prestadores', handler: (u, n) => (n === 1 ? d.p : resp(200, [pr(2, 'Nova')])) });
  t.start(); await settle();
  t.ids.abaChamados.click(); await settle();
  d.res(resp(200, [pr(1, 'Velha')])); await settle();
  assert.ok(!/Velha/.test(t.pagina()));
  t.ids.abaPrestadores.click(); await settle();
  assert.deepEqual(t.nomes(), ['Nova']);
  assert.equal(t.est.urls.length, 2);
});

test('Chamados nasce fechado: falha de lojaCarregar não é lista vazia e tem retry manual; conta sem loja mostra cadastro pendente', async () => {
  const t = montar({ info: null });
  t.start(); assert.equal(t.ids.app.hidden, true);
  await settle();
  assert.equal(t.ids.app.hidden, true);
  assert.match(t.texto('statusGeral'), /Não foi possível carregar as lojas autorizadas/);
  t.fireW('focus'); t.fireD('visibilitychange'); await settle();
  assert.equal(t.est.lojaChamadas, 1);
  t.est.info = INFO; t.botao('statusGeral').click(); await settle();
  assert.equal(t.ids.app.hidden, false);
  const u = montar({ info: { lojas: [], loja_inicial: null, travado: false }, loja: null });
  u.start(); await settle();
  assert.equal(u.ids.app.hidden, false);
  assert.match(u.texto('lojaInfo'), /cadastro de loja desta conta ainda está pendente/);
  assert.equal(u.est.urls.length, 0);
});

test('conta A -> B DURANTE a carga inicial das lojas: nunca fica oculta sem aviso; nenhum GET; sessão de B intacta', async () => {
  const d = defer();
  const t = montar({ deferLojas: d.p });
  t.start();
  t.est.email = 'b@exemplo.test'; d.res(); await settle();
  assert.equal(t.ids.app.hidden, true); assert.equal(t.ids.bloqueio.hidden, false);
  assert.match(t.texto('bloqueio'), /outro usuário/); assert.match(t.texto('bloqueio'), /Recarregar/);
  assert.equal(t.est.urls.length, 0); assert.deepEqual(t.est.removidos, []);
  t.botao('bloqueio').click(); assert.equal(t.est.reloads, 1);
  const e = defer();                                          // logout durante a carga
  const u = montar({ deferLojas: e.p });
  u.start(); u.est.email = null; e.res(); await settle();
  assert.equal(u.ids.bloqueio.hidden, false); assert.match(u.texto('bloqueio'), /Sem sessão/);
  assert.match(u.ctx.location.href, /sistema\.html$/);
});

test('conta A -> B com dados do diretório na tela: some tudo no ato, sem reler e sem apagar a sessão de B; logout limpa e pede login uma vez', async () => {
  for (const [alvo, ev] of [['W', 'storage'], ['W', 'focus'], ['W', 'pageshow'], ['D', 'visibilitychange']]) {
    const t = montar({ hash: '#prestadores', handler: () => resp(200, [pr(1, 'PESSOA-A', { telefone: 'TEL-A' })]) });
    t.start(); await settle();
    t.ids.buscaTexto.value = 'BUSCA-A';
    t.est.email = 'b@exemplo.test';
    if (alvo === 'W') t.fireW(ev, { key: 'rmbSessao' }); else t.fireD(ev);
    assert.ok(!/PESSOA-A|TEL-A|BUSCA-A/.test(t.pagina()), ev);
    assert.equal(t.ids.app.hidden, true, ev); assert.match(t.texto('bloqueio'), /outro usuário/, ev);
    t.ids.btnAtualizar.click(); await settle();
    assert.equal(t.est.urls.length, 1, ev); assert.deepEqual(t.est.removidos, [], ev); assert.equal(t.est.email, 'b@exemplo.test');
  }
  const t = montar({ hash: '#prestadores', handler: () => resp(200, [pr(1, 'PESSOA-A')]) });
  t.start(); await settle();
  t.est.email = null; t.fireW('storage', { key: 'rmbSessao' });
  assert.ok(!/PESSOA-A/.test(t.pagina())); assert.match(t.ctx.location.href, /sistema\.html$/);
  t.ctx.location.href = 'MARCA'; t.fireW('focus'); t.fireD('visibilitychange');
  assert.equal(t.ctx.location.href, 'MARCA');
});

test('A->B com resposta de A ainda no ar: nada de A aparece; 401 atrasado de A não remove a sessão de B', async () => {
  const d = defer();
  const t = montar({ hash: '#prestadores', handler: () => d.p });
  t.start(); await settle();
  t.est.email = 'b@exemplo.test'; t.fireW('storage', { key: 'rmbSessao' });
  d.res(resp(200, [pr(1, 'PESSOA-A')])); await settle();
  assert.ok(!/PESSOA-A/.test(t.pagina())); assert.equal(t.est.urls.length, 1);
  const e = defer();
  const u = montar({ hash: '#prestadores', handler: () => e.p });
  u.start(); await settle();
  u.est.email = 'b@exemplo.test'; u.fireW('storage', { key: 'rmbSessao' });
  e.res(resp(401, {})); await settle();
  assert.deepEqual(u.est.removidos, []); assert.equal(u.est.email, 'b@exemplo.test'); assert.equal(u.ctx.location.href, '');
  // 401 da conta atual encerra a sessão dela
  const c = montar({ hash: '#prestadores', handler: () => resp(401, {}) });
  c.start(); await settle();
  assert.deepEqual(c.est.removidos, ['rmbSessao']); assert.match(c.ctx.location.href, /sistema\.html$/);
  assert.ok(!/Nenhum prestador|ainda não foi liberada/.test(c.pagina()));
  const k = montar({ casca: true, hash: '#prestadores', handler: () => resp(401, {}) });
  k.start(); await settle();
  assert.equal(k.ctx.location.href, ''); assert.ok(k.messages.some((m) => m.tipo === 'casca-login'));
});

test('renovação de token da MESMA conta (caixa/espaço diferentes) não muda nada nem relê', async () => {
  const t = montar({ hash: '#prestadores', handler: () => resp(200, [pr(1, 'Ana')]) });
  t.start(); await settle();
  t.est.email = '  A@EXEMPLO.TEST ';
  t.fireW('storage', { key: 'rmbSessao' }); t.fireW('focus'); t.fireW('pageshow'); await settle();
  assert.deepEqual(t.nomes(), ['Ana']); assert.equal(t.ids.bloqueio.hidden, true); assert.equal(t.est.urls.length, 1);
});

test('sem sessão: fora da casca vai ao login existente; na casca só avisa o pai; nada é consultado', async () => {
  const f = montar({ email: null, hash: '#prestadores' }); f.start(); await settle();
  assert.match(f.ctx.location.href, /sistema\.html$/); assert.equal(f.ids.app.hidden, true);
  assert.equal(f.est.lojaChamadas, 0); assert.equal(f.est.urls.length, 0);
  const c = montar({ email: null, casca: true }); c.start(); await settle();
  assert.equal(c.ctx.location.href, ''); assert.ok(c.messages.some((m) => m.tipo === 'casca-login'));
});

test('Atualizar manual: só a leitura mais recente vale, mesmo que a anterior responda depois (sucesso ou erro)', async () => {
  const d1 = defer();
  const t = montar({ hash: '#prestadores', handler: (u, n) => (n === 1 ? d1.p : resp(200, [pr(2, 'Nova')])) });
  t.start(); await settle();
  t.ids.btnAtualizar.click(); await settle();
  d1.res(resp(200, [pr(1, 'Velha')])); await settle();
  assert.deepEqual(t.nomes(), ['Nova']);
  const e1 = defer();
  const u = montar({ hash: '#prestadores', handler: (x, n) => (n === 1 ? e1.p : resp(200, [pr(2, 'Nova')])) });
  u.start(); await settle(); u.ids.btnAtualizar.click(); await settle();
  e1.rej(new Error('queda antiga')); await settle();
  assert.deepEqual(u.nomes(), ['Nova']); assert.ok(!/conexão ou serviço/.test(u.pagina()));
});

test('lista que atingiu o teto avisa que é parcial', async () => {
  const lote = (n, ini) => Array.from({ length: n }, (_, i) => pr(ini + i, 'P' + String(ini + i).padStart(5, '0')));
  const t = montar({ hash: '#prestadores', handler: (u, n) => resp(200, lote(200, (n - 1) * 200 + 1)) });
  t.start(); await settle();
  assert.equal(t.est.urls.length, 10);
  assert.match(t.texto('statusPrest'), /Lista parcial/); assert.match(t.texto('listaPrest'), /2000 prestador/);
});
