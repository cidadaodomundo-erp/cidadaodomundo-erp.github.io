/* Setores do agrupamento "Sistema operacional do Fábio" + Delivery na casca (etapa 1, 12/11/2026).
 * Roda o script REAL do sistema.html com casca/*.js e nucleo/loja.js; DOM, rede, sessão e loja são ficções (só e-mail fake).
 * Node stdlib: node --test casca/ . Sem rede, sem git (o diff da revisão é auditado manualmente pelo coordenador). */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const RAIZ = path.join(__dirname, '..');
const ler = (...p) => fs.readFileSync(path.join(RAIZ, ...p), 'utf8');
const settle = async () => { for (let i = 0; i < 30; i++) await new Promise((r) => setImmediate(r)); };

const SISTEMA = ler('sistema.html');
const SCRIPTS_SRC = [...SISTEMA.matchAll(/<script src="([^"?]+)(?:\?[^"]*)?"><\/script>/g)].map((m) => m[1]).filter((s) => !/ajuda\.js$/.test(s));
const INLINE = [...SISTEMA.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => m[1]);

// ---------------------------------------------------------------------------------------------- ficção do navegador
function elemento(tag) {
  const cls = new Set();
  const e = {
    tagName: tag, id: '', className: '', innerHTML: '', textContent: '', value: '', hidden: false, disabled: false, title: '', src: '',
    style: {}, dataset: {}, children: [], ev: {}, onclick: null, onchange: null,
    classList: { add: (c) => cls.add(c), remove: (c) => cls.delete(c), contains: (c) => cls.has(c),
      toggle: (c, f) => { const on = f === undefined ? !cls.has(c) : !!f; if (on) cls.add(c); else cls.delete(c); return on; } },
    addEventListener(n, f) { e.ev[n] = f; }, setAttribute() {}, focus() {}, blur() {}, select() {},
    appendChild(c) { e.children.push(c); c.pai = e; return c; },
    remove() { if (e.pai) e.pai.children = e.pai.children.filter((x) => x !== e); },
    querySelector(s) { return s === '.home' ? e.children.find((c) => c.className === 'home') || null : null; },
  };
  return e;
}

function abrirCasca({ pode = null, hash = '' } = {}) {
  const els = {};
  const $ = (id) => els[id] || (els[id] = Object.assign(elemento('div'), { id }));
  const store = { rmbSessao: JSON.stringify({ access_token: 'token-ficticio', email: 'conta-teste@exemplo.test', expira_em: Date.now() + 36e5 }) };
  const sess = {};
  const chamadas = [], abertas = [];
  const loc = { pathname: '/sistema.html', search: '', hash, origin: 'https://exemplo.test' };
  const resp = (corpo) => ({ ok: true, status: 200, json: async () => corpo });
  const ctx = {
    console, URLSearchParams, setTimeout: () => 0, clearTimeout() {},
    location: loc,
    history: { replaceState(_a, _b, u) { const i = String(u).indexOf('#'); loc.hash = i >= 0 ? String(u).slice(i) : ''; } },
    localStorage: { getItem: (k) => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = String(v); }, removeItem: (k) => { delete store[k]; } },
    sessionStorage: { getItem: (k) => (k in sess ? sess[k] : null), setItem: (k, v) => { sess[k] = String(v); }, removeItem: (k) => { delete sess[k]; } },
    matchMedia: () => ({ matches: false }),
    addEventListener() {},
    open: (u, alvo, extra) => { abertas.push({ u, alvo, extra }); return null; },
    fetch: async (url, op = {}) => {
      chamadas.push({ url: String(url), metodo: op.method || 'GET' });
      if (/\/auth\/v1\/user$/.test(url)) return resp({ email: 'conta-teste@exemplo.test' });
      if (/rpc\/meus_modulos$/.test(url)) return resp(pode || []);       // [] = sem restrição (PODE null), como o painel
      if (/rpc\/painel_minhas_lojas$/.test(url)) return resp([{ lojas: ['AHU'], loja_inicial: 'AHU', travado: true }]);
      if (/rpc\/pode_ver_pessoal$/.test(url)) return resp(false);
      if (/rpc\/tr_meu_papel$/.test(url)) return resp('OPERACAO');
      if (/rpc\/agenda_ve_equipe$/.test(url)) return resp(false);
      if (/rpc\/painel_meu_tema$/.test(url)) return resp('escuro');
      return resp([]);
    },
    document: {
      documentElement: elemento('html'), body: elemento('body'),
      getElementById: $, createElement: (t) => elemento(t),
      querySelector: (s) => (s === '.app' ? $('__app') : null), querySelectorAll: () => [],
      addEventListener() {},
    },
  };
  ctx.window = ctx; ctx.parent = ctx;
  vm.createContext(ctx);
  SCRIPTS_SRC.forEach((s) => vm.runInContext(ler(s), ctx, { filename: s }));
  INLINE.forEach((s, i) => vm.runInContext(s, ctx, { filename: 'sistema.html#inline' + i }));
  const ev = (codigo) => vm.runInContext(codigo, ctx);
  return { ctx, els, $, ev, chamadas, abertas, loc };
}

const C = abrirCasca().ctx;   // só para ler as constantes dos arquivos da casca
const fabioNoMenu = C.CASCA_MENU.flatMap((g) => g.itens).filter((i) => i.origem === 'fabio').map((i) => i.chave);
const ANTIGO_RE = /cidadaodomundo\.github\.io|portal antigo/i;

// --------------------------------------------------------------------------------------------------------- testes
test('um agrupamento só (id outras, nome exato), com TODAS as telas da sobra; nenhum grupo paralelo; módulos do Neto intocados', async () => {
  const t = abrirCasca(); await settle();
  const mods = JSON.parse(t.ev('JSON.stringify(MODULOS)'));
  const neto = JSON.parse(JSON.stringify(t.ctx.CASCA_MODULOS));
  assert.deepEqual(mods.map((m) => m.id), [...neto.map((m) => m.id), 'outras'], 'só o agrupamento outras foi acrescentado');
  neto.forEach((m, i) => assert.deepEqual(mods[i], m, 'módulo do Neto mudou: ' + m.id));
  const o = mods.find((m) => m.id === 'outras');
  assert.equal(o.nome, 'Sistema operacional do Fábio');
  fabioNoMenu.forEach((k) => assert.ok(o.acompanhar.includes(k), 'tela do Fábio saiu do agrupamento: ' + k));
  // nenhum atalho externo no agrupamento: nenhuma chave antigo:*, nenhum item com link
  assert.ok(!o.acompanhar.some((k) => /^antigo:/.test(k)), 'chave antigo:* no agrupamento');
  o.acompanhar.forEach((k) => assert.equal(t.ev(`!!(ITENS[${JSON.stringify(k)}] || {}).link`), false, 'link externo no agrupamento: ' + k));
  assert.equal(t.ev("Object.keys(ITENS).filter((k) => /^antigo:/.test(k)).length"), 0, 'nenhum item antigo:* ativo');
  // cada tela da sobra em exatamente um setor; setores não acrescentam nada
  const nosSetores = o.setores.flatMap((s) => s.chaves);
  assert.deepEqual([...nosSetores].sort(), [...o.acompanhar].sort());
  assert.equal(new Set(nosSetores).size, nosSetores.length);
  assert.deepEqual(o.setores.slice(0, 3).map((s) => s.nome), ['Delivery', 'Salão', 'RH']);
  assert.ok(o.setores.find((s) => s.id === 'rh').chaves.includes('pao'), 'Ponto ao vivo fica no RH do agrupamento do Fábio');
  assert.ok(!mods.find((m) => m.id === 'pessoas').lancar.includes('pao') && !mods.find((m) => m.id === 'pessoas').acompanhar.includes('pao'));
  assert.deepEqual(o.setores.find((s) => s.id === 'delivery').chaves, ['delivery', 'chegada'], 'Delivery: Delivery do dia e Chegada nativos');
  assert.deepEqual(o.setores.find((s) => s.id === 'salao').chaves, ['salao', 'reservas', 'pausados'], 'Reservas e Pausados no Salão');
});

test('rotas: delivery, salao, reservas e pausados ligados; telas por loja e junções preservadas', () => {
  assert.equal(C.CASCA_PAGINAS.delivery, 'delivery/index.html');
  assert.equal(C.CASCA_PAGINAS.salao, 'salao/index.html');
  assert.equal(C.CASCA_PAGINAS.reservas, 'reservas/index.html');
  assert.equal(C.CASCA_PAGINAS.pausados, 'pausados/index.html');
  assert.ok(fs.existsSync(path.join(RAIZ, 'delivery', 'index.html')) && fs.existsSync(path.join(RAIZ, 'salao', 'index.html')));
  assert.equal(C.CASCA_PAGINAS.pao, 'pessoas/index.html#pao');
  ['delivery', 'pao', 'reservas', 'pausados'].forEach((k) => assert.ok(C.CASCA_TELAS_POR_LOJA.includes(k), 'tela por loja: ' + k));
  Object.entries(C.CASCA_PAGINAS).forEach(([k, v]) => assert.doesNotMatch(String(v), ANTIGO_RE, 'rota para o portal antigo: ' + k));
  assert.deepEqual(JSON.parse(JSON.stringify(C.CASCA_MODULOS_CFG.juncoes)), {
    cancelamentos: { abas: [['cancelamentos', 'Cancelamentos'], ['contestacoes', 'Contestações']] },
    motoboys: { abas: [['logfin', 'Financeiro da logística'], ['macertos', 'Acertos']] } });
});

test('navegação sem restrição: #delivery abre a página própria; tela sem página não abre o painel antigo; nenhum botão para o portal antigo', async () => {
  const t = abrirCasca({ hash: '#delivery' }); await settle();
  const molduras = () => t.$('vista').children.filter((c) => c.tagName === 'iframe').map((f) => f.src);
  assert.deepEqual(molduras(), ['delivery/index.html']);
  assert.equal(t.loc.hash, '#delivery');
  // tela do agrupamento sem página ligada: mostra o agrupamento, nunca a moldura dashboard.html
  t.ev("abrir('pcartao')");
  assert.ok(!molduras().some((u) => /dashboard\.html/.test(u)));
  assert.match(t.$('titulo').textContent, /Sistema operacional do Fábio/);
  const casa = t.$('vista').querySelector('.home').innerHTML;
  ['Delivery', 'RH', 'Salão'].forEach((s) => assert.match(casa, new RegExp('class="gh">[^<]* ' + s + '<')));
  assert.ok(casa.indexOf('Delivery<') < casa.indexOf('Salão<') && casa.indexOf('Salão<') < casa.indexOf('RH<'), 'ordem dos setores');
  assert.match(casa, /data-chave="delivery"/); assert.match(casa, /data-chave="salao"/); assert.match(casa, /data-chave="pao"/);
  assert.doesNotMatch(casa, /data-chave="pcartao"/, 'sem página = sem botão ativo');
  assert.match(casa, /integração pendente · acesso ainda não conectado/);
  assert.doesNotMatch(casa + t.$('menu').innerHTML, /sem página/);
  // setor Delivery: Delivery do dia e Chegada; Fila/Escala só como aviso em texto, sem botão nem link
  const setorDl = casa.slice(casa.indexOf('Delivery<'), casa.indexOf('Salão<'));
  assert.deepEqual([...setorDl.matchAll(/data-chave="([^"]+)"/g)].map((m) => m[1]), ['delivery', 'chegada']);
  assert.match(setorDl, /class="setor-aviso">Em migração para este portal: Fila de pedidos e edição da Escala\.</);
  assert.doesNotMatch(setorDl, /Chegada completa/, 'Chegada não é mais pendência');
  assert.doesNotMatch(casa, /antigo:|github\.io|portal antigo|href=|<iframe|↗/i, 'agrupamento outras sem link para o portal antigo');
  assert.doesNotMatch(t.$('menu').innerHTML, /antigo:|portal antigo/i);
  ['antigo:chegada', 'antigo:fila', 'antigo:escala'].forEach((k) => t.ev(`abrir(${JSON.stringify(k)})`));
  assert.equal(t.abertas.length, 0, 'nada abre outra aba');
  assert.ok(!molduras().some((u) => ANTIGO_RE.test(u)), 'portal antigo nunca vai para moldura');
  // #pao continua abrindo a página do Ponto ao Vivo
  const t2 = abrirCasca({ hash: '#pao' }); await settle();
  assert.deepEqual(t2.$('vista').children.filter((c) => c.tagName === 'iframe').map((f) => f.src), ['pessoas/index.html#pao']);
});

test('conta restrita: só a chave da lista; nenhuma chave antigo:* libera nada; links somem (regra de antes)', async () => {
  const t = abrirCasca({ pode: ['delivery'] }); await settle();
  assert.equal(t.ev("visivel('delivery')"), true);
  ['pao', 'salao', 'reservas', 'pausados', 'freelas', 'macertos', 'logfin'].forEach((k) => assert.equal(t.ev(`visivel('${k}')`), false, k));
  const menu = t.$('menu').innerHTML;
  assert.match(menu, /data-chave="delivery"/);
  assert.doesNotMatch(menu, /antigo:|github\.io|data-chave="pao"/);

  // chave antigo:* na lista (sobra de configuração antiga) não cria item nem abre nada
  const t2 = abrirCasca({ pode: ['pao', 'antigo:fila', 'antigo:chegada', 'antigo:escala'] }); await settle();
  ['antigo:fila', 'antigo:chegada', 'antigo:escala', 'delivery'].forEach((k) => assert.equal(t2.ev(`visivel(${JSON.stringify(k)})`), false, k));
  assert.equal(t2.ev("visivel('pao')"), true);
  t2.ev("abrir('antigo:fila')");
  assert.equal(t2.abertas.length, 0);
  assert.doesNotMatch(t2.$('menu').innerHTML, /antigo:|github\.io/);
  // links do Neto continuam sumindo para acesso restrito, mesmo com a chave na lista (regra de antes)
  const t3 = abrirCasca({ pode: ['link:portal-qualidade', 'link:promos.html', 'delivery'] }); await settle();
  assert.equal(t3.ev("visivel('link:portal-qualidade')"), false);
  assert.equal(t3.ev("visivel('link:promos.html')"), false);
});

test('sem rede nova: a casca só chama as leituras que já chamava (nenhuma RPC nova, nenhuma escrita nova)', async () => {
  const t = abrirCasca({ hash: '#delivery' }); await settle();
  t.ev("abrir('salao')"); t.ev("abrir('reservas')"); t.ev("abrir('pausados')"); await settle();
  assert.equal(t.abertas.length, 0, 'nada abre outra aba');
  const rpcs = new Set(t.chamadas.map((c) => (/\/rpc\/(\w+)/.exec(c.url) || [])[1]).filter(Boolean));
  const conhecidas = ['meus_modulos', 'painel_minhas_lojas', 'pode_ver_pessoal', 'tr_meu_papel', 'agenda_ve_equipe', 'painel_meu_tema', 'painel_registrar_uso', 'painel_tema_gravar'];
  [...rpcs].forEach((r) => assert.ok(conhecidas.includes(r), 'rpc nova: ' + r));
  assert.ok(!t.chamadas.some((c) => /github\.io/.test(c.url)), 'nenhuma leitura do portal antigo');
});

test('setores-fabio.js: só configuração (sem rede, timer, sessão ou token); nenhum atalho, link ou chave antigo:*', () => {
  const src = ler('casca', 'setores-fabio.js').replace(/^\s*\/\/.*$/gm, '');
  [/fetch\s*\(/, /XMLHttpRequest/, /setInterval|setTimeout/, /localStorage|sessionStorage/, /token|apikey|Authorization|eyJ/i, /rpc/i, /<iframe/i,
    /antigo:/, /https?:\/\//, /github\.io/, /autorizavelPorChave/, /atalhos/]
    .forEach((re) => assert.doesNotMatch(src, re));
  const cfg = C.CASCA_SETORES_FABIO;
  assert.equal(cfg.atalhos, undefined);
  assert.ok(!Object.keys(cfg.busca).some((k) => /^antigo:/.test(k)));
  assert.doesNotMatch(SISTEMA, /autorizavelPorChave|SETORES_CFG\.atalhos|i\.nota/);
  assert.match(SISTEMA, /if \(it\.link\) return false;/, 'regra anterior de links em acesso restrito');
  assert.equal((SISTEMA.match(/casca\/setores-fabio\.js\?v=\d{8}[a-z]"/g) || []).length, 1);
  assert.ok(SISTEMA.indexOf('casca/setores-fabio.js') < SISTEMA.indexOf('const MENU = '), 'carregado antes do script da casca');
});

test('delivery/index.html: diz o que consulta e o que está em migração; não manda ao portal antigo; nada de garantido/refeição calculado; um timer só', () => {
  const html = ler('delivery', 'index.html');
  assert.match(html, /Já consultam dados neste portal:<\/strong> Placar, Tempo de entrega, Cancelamentos e Avaliações do dia/);
  assert.match(html, /Em migração, ainda sem tela neste portal:<\/strong> Fila de pedidos/);
  assert.match(html, /Com página própria neste portal:<\/strong> Chegada dos motoboys/);
  assert.match(html, /<button data-aba="chegada">Chegada do dia<\/button>/, 'aba Chegada sem selo Em construção');
  const bloco = (/<section class="dl-migracao"[\s\S]*?<\/section>/.exec(html) || [''])[0];
  assert.ok(bloco, 'bloco de migração presente');
  assert.doesNotMatch(bloco, /portal antigo|atalho|href=|<a\b|<button/i, 'só texto, sem mandar ao portal antigo');
  assert.match(html, /Garantido e refeição <strong>não<\/strong> são calculados/);
  const semLink = html.replace(/<link[^>]*>/g, '');
  assert.doesNotMatch(semLink, /github\.io|target=|<iframe|<embed|<object/i, 'sem link, moldura ou embed do portal antigo');
  assert.equal((html.match(/data-aba=/g) || []).length, 7, 'abas do Delivery do dia iguais');
  assert.equal((html.match(/setInterval\(/g) || []).length, 1, 'nenhum polling novo');
  assert.doesNotMatch(html, /garantido_|refeicao_|direito_/i);
});

// ------------------------------------------------------------------------------- Chegada dos motoboys (12/11/2026)
test('chegada: item do Fábio no grupo Entrega, rota delivery/chegada.html, por loja, cache-bust dos scripts da casca', () => {
  const ent = C.CASCA_MENU.find((g) => g.id === 'gEntrega');
  const it = ent.itens.find((i) => i.chave === 'chegada');
  assert.ok(it, 'chegada no grupo Entrega');
  assert.equal(it.origem, 'fabio');
  assert.equal(C.CASCA_MENU.flatMap((g) => g.itens).filter((i) => i.chave === 'chegada').length, 1, 'uma chave chegada só');
  assert.equal(C.CASCA_PAGINAS.chegada, 'delivery/chegada.html');
  assert.ok(fs.existsSync(path.join(RAIZ, 'delivery', 'chegada.html')));
  assert.ok(C.CASCA_TELAS_POR_LOJA.includes('chegada'));
  assert.ok(!C.CASCA_TELAS_SEM_LOJA.includes('chegada'));
  assert.match(SISTEMA, /casca\/menu\.js\?v=20261112c"/);
  assert.match(SISTEMA, /casca\/paginas\.js\?v=20261112-chegada1"/);
  assert.match(SISTEMA, /casca\/setores-fabio\.js\?v=20261112c"/);
  assert.match(SISTEMA, /if \(chave === 'chegada'\) return visivel\('delivery'\);/);
});

test('chegada: visível com a permissão do Delivery; sem ela (mesmo com a chave chegada na lista), não', async () => {
  const t = abrirCasca({ pode: ['delivery'] }); await settle();
  assert.equal(t.ev("visivel('chegada')"), true);
  assert.match(t.$('menu').innerHTML, /data-chave="chegada"/);
  const t2 = abrirCasca({ pode: ['chegada'] }); await settle();
  assert.equal(t2.ev("visivel('chegada')"), false, 'chegada segue a permissão delivery, não uma chave própria');
  const t3 = abrirCasca({ pode: ['pao'] }); await settle();
  assert.equal(t3.ev("visivel('chegada')"), false);
  assert.doesNotMatch(t3.$('menu').innerHTML, /data-chave="chegada"/);
});

test('chegada: #chegada na casca abre delivery/chegada.html na moldura; nada do portal antigo', async () => {
  const t = abrirCasca({ hash: '#chegada' }); await settle();
  const molduras = t.$('vista').children.filter((c) => c.tagName === 'iframe').map((f) => f.src);
  assert.deepEqual(molduras, ['delivery/chegada.html']);
  assert.equal(t.abertas.length, 0);
});

test('delivery/index.html: aba Chegada e #chegada navegam para chegada.html na mesma moldura; demais abas intactas', () => {
  const html = ler('delivery', 'index.html');
  assert.match(html, /location\.replace\('chegada\.html'\)/);
  assert.match(html, /location\.assign\('chegada\.html'\)/);
  assert.match(html, /if \(ABA === 'chegada' && irParaChegada\(true\)\) ABA = 'placar';/);
  assert.match(html, /if \(b\.dataset\.aba === 'chegada' && irParaChegada\(false\)\) return;/);
  assert.match(html, /if \(nova === 'chegada' && irParaChegada\(true\)\) return;/);
  ['placar', 'tempo', 'cancel', 'quali', 'escala', 'conferencia'].forEach((a) => assert.match(html, new RegExp('data-aba="' + a + '"')));
  assert.doesNotMatch(html.replace(/<link[^>]*>/g, ''), /window\.open|target=|github\.io/);
  const ch = ler('delivery', 'chegada.html');
  assert.doesNotMatch(ch.replace(/<link[^>]*>/g, ''), /github\.io|<iframe|target=/i);
  assert.match(ch, /chegada-modelo\.js\?v=\d{8}[a-z]"/);
});
