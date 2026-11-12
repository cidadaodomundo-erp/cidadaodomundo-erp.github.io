/* Setores do agrupamento "Sistema operacional do Fábio" + Delivery na casca (etapa 1, 12/11/2026).
 * Roda o script REAL do sistema.html com casca/*.js e nucleo/loja.js; DOM, rede, sessão e loja são ficções (só e-mail fake).
 * Node stdlib: node --test casca/ . Sem rede. O último teste usa git (só leitura) para conferir que nenhum robô mudou. */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { execFileSync } = require('node:child_process');

const RAIZ = path.join(__dirname, '..');
const ANTIGO = path.join(RAIZ, '..', 'antigo-atual');   // referência local, só leitura (pode não existir na máquina)
const BASE = '96e003ff53250a4076356736671ae24e11b30b6d';   // HEAD clonado em 12/11/2026, antes desta etapa
const ler = (...p) => fs.readFileSync(path.join(RAIZ, ...p), 'utf8');
const settle = async () => { for (let i = 0; i < 30; i++) await new Promise((r) => setImmediate(r)); };
function git(args) { try { return execFileSync('git', args, { cwd: RAIZ, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }); } catch (e) { return null; } }

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
const ATALHOS = Object.keys(C.CASCA_SETORES_FABIO.atalhos);

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
  ATALHOS.forEach((k) => assert.ok(o.acompanhar.includes(k), k));
  // cada tela da sobra em exatamente um setor; setores não acrescentam nada
  const nosSetores = o.setores.flatMap((s) => s.chaves);
  assert.deepEqual([...nosSetores].sort(), [...o.acompanhar].sort());
  assert.equal(new Set(nosSetores).size, nosSetores.length);
  assert.deepEqual(o.setores.slice(0, 3).map((s) => s.nome), ['Delivery', 'Salão', 'RH']);
  assert.ok(o.setores.find((s) => s.id === 'rh').chaves.includes('pao'), 'Ponto ao vivo fica no RH do agrupamento do Fábio');
  assert.ok(!mods.find((m) => m.id === 'pessoas').lancar.includes('pao') && !mods.find((m) => m.id === 'pessoas').acompanhar.includes('pao'));
  assert.deepEqual(o.setores.find((s) => s.id === 'delivery').chaves, ['delivery', ...ATALHOS]);
});

test('rotas: delivery e salao ligados; rotas, telas por loja e junções anteriores preservadas', () => {
  assert.equal(C.CASCA_PAGINAS.delivery, 'delivery/index.html');
  assert.equal(C.CASCA_PAGINAS.salao, 'salao/index.html');
  assert.ok(fs.existsSync(path.join(RAIZ, 'delivery', 'index.html')) && fs.existsSync(path.join(RAIZ, 'salao', 'index.html')));
  assert.equal(C.CASCA_PAGINAS.pao, 'pessoas/index.html#pao');
  assert.ok(C.CASCA_TELAS_POR_LOJA.includes('delivery') && C.CASCA_TELAS_POR_LOJA.includes('pao'));
  const antes = git(['show', BASE + ':casca/paginas.js']);
  if (antes) {
    const c0 = { window: {} }; c0.window = c0; vm.createContext(c0); vm.runInContext(antes, c0);
    Object.entries(c0.CASCA_PAGINAS).forEach(([k, v]) => assert.equal(C.CASCA_PAGINAS[k], v, 'rota mudou: ' + k));
    assert.deepEqual([...C.CASCA_TELAS_POR_LOJA].filter((k) => k !== 'delivery'), [...c0.CASCA_TELAS_POR_LOJA]);
    assert.deepEqual([...C.CASCA_TELAS_SEM_LOJA], [...c0.CASCA_TELAS_SEM_LOJA]);
    ['casca/menu.js', 'casca/modulos.js', 'casca/busca.js', 'casca/modulos-proposta.js'].forEach((f) =>
      assert.equal(ler(f).replace(/\r\n/g, '\n'), git(['show', BASE + ':' + f]).replace(/\r\n/g, '\n'), f + ' não podia mudar'));
  }
  assert.deepEqual(JSON.parse(JSON.stringify(C.CASCA_MODULOS_CFG.juncoes)), {
    cancelamentos: { abas: [['cancelamentos', 'Cancelamentos'], ['contestacoes', 'Contestações']] },
    motoboys: { abas: [['logfin', 'Financeiro da logística'], ['macertos', 'Acertos']] } });
});

test('navegação sem restrição: #delivery abre a página própria; tela sem página não abre o painel antigo; atalho abre outra aba sem referência', async () => {
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
  // atalho do portal antigo
  t.ev("abrir('antigo:chegada')");
  assert.deepEqual(t.abertas, [{ u: 'https://cidadaodomundo.github.io/chegada/', alvo: '_blank', extra: 'noopener,noreferrer' }]);
  assert.ok(!molduras().some((u) => /github\.io/.test(u)), 'portal antigo nunca vai para moldura');
  // #pao continua abrindo a página do Ponto ao Vivo
  const t2 = abrirCasca({ hash: '#pao' }); await settle();
  assert.deepEqual(t2.$('vista').children.filter((c) => c.tagName === 'iframe').map((f) => f.src), ['pessoas/index.html#pao']);
});

test('conta restrita: atalho só com a própria chave na lista; delivery não libera atalho; nada aparece por inferência', async () => {
  const t = abrirCasca({ pode: ['delivery'] }); await settle();
  assert.equal(t.ev("visivel('delivery')"), true);
  ATALHOS.forEach((k) => assert.equal(t.ev(`visivel(${JSON.stringify(k)})`), false, k));
  ['pao', 'salao', 'freelas', 'macertos', 'logfin'].forEach((k) => assert.equal(t.ev(`visivel('${k}')`), false, k));
  const menu = t.$('menu').innerHTML;
  assert.match(menu, /data-chave="delivery"/);
  assert.doesNotMatch(menu, /antigo:|github\.io|data-chave="pao"/);
  t.ev("abrir('antigo:chegada')");
  assert.equal(t.abertas.length, 0, 'abrir não fura a permissão');

  const t2 = abrirCasca({ pode: ['pao', 'antigo:fila'] }); await settle();
  assert.equal(t2.ev("visivel('antigo:fila')"), true);
  assert.equal(t2.ev("visivel('antigo:chegada')"), false);
  assert.equal(t2.ev("visivel('delivery')"), false);
  // atalhos antigos do Neto continuam sumindo para acesso restrito, mesmo com a chave na lista (regra de antes)
  const t3 = abrirCasca({ pode: ['link:portal-qualidade', 'link:promos.html', 'delivery'] }); await settle();
  assert.equal(t3.ev("visivel('link:portal-qualidade')"), false);
  assert.equal(t3.ev("visivel('link:promos.html')"), false);
});

test('sem rede nova: a casca só chama as leituras que já chamava (nenhuma RPC nova, nenhuma escrita nova)', async () => {
  const t = abrirCasca({ hash: '#delivery' }); await settle();
  t.ev("abrir('antigo:fila')"); t.ev("abrir('salao')"); await settle();
  const rpcs = new Set(t.chamadas.map((c) => (/\/rpc\/(\w+)/.exec(c.url) || [])[1]).filter(Boolean));
  const conhecidas = ['meus_modulos', 'painel_minhas_lojas', 'pode_ver_pessoal', 'tr_meu_papel', 'agenda_ve_equipe', 'painel_meu_tema', 'painel_registrar_uso', 'painel_tema_gravar'];
  [...rpcs].forEach((r) => assert.ok(conhecidas.includes(r), 'rpc nova: ' + r));
  assert.ok(!t.chamadas.some((c) => /github\.io/.test(c.url)), 'nenhuma leitura do portal antigo');
});

test('setores-fabio.js: só configuração (sem rede, timer, sessão ou token); atalhos https do portal antigo que existem na referência', () => {
  const src = ler('casca', 'setores-fabio.js').replace(/^\s*\/\/.*$/gm, '');
  [/fetch\s*\(/, /XMLHttpRequest/, /setInterval|setTimeout/, /localStorage|sessionStorage/, /token|apikey|Authorization|eyJ/i, /rpc/i, /<iframe/i]
    .forEach((re) => assert.doesNotMatch(src, re));
  const at = C.CASCA_SETORES_FABIO.atalhos;
  const caminho = { 'antigo:chegada': 'chegada/index.html', 'antigo:fila': 'fila/index.html', 'antigo:escala': 'delivery/escala.html' };
  Object.entries(at).forEach(([k, v]) => {
    assert.match(v.link, /^https:\/\/cidadaodomundo\.github\.io\//, k);
    assert.doesNotMatch(v.link, /[?#]/, k + ': nenhum parâmetro (nada de token na URL)');
    assert.equal(v.autorizavelPorChave, true);
    assert.match(v.rotulo, /portal antigo/);
    if (fs.existsSync(ANTIGO)) assert.ok(fs.existsSync(path.join(ANTIGO, caminho[k])), 'tela antiga não existe: ' + caminho[k]);
  });
  assert.match(SISTEMA, /window\.open\(it\.link, '_blank', 'noopener,noreferrer'\)/);
  assert.equal((SISTEMA.match(/casca\/setores-fabio\.js\?v=\d{8}[a-z]"/g) || []).length, 1);
  assert.ok(SISTEMA.indexOf('casca/setores-fabio.js') < SISTEMA.indexOf('const MENU = '), 'carregado antes do script da casca');
});

test('delivery/index.html: diz o que consulta e o que não migrou; não liga ao portal antigo; nada de garantido/refeição calculado; um timer só', () => {
  const html = ler('delivery', 'index.html');
  assert.match(html, /Já consultam dados neste portal:<\/strong> Placar, Tempo de entrega, Cancelamentos e Avaliações do dia/);
  assert.match(html, /Ainda não migrado, continua no portal antigo/);
  assert.match(html, /Garantido e refeição <strong>não<\/strong> são calculados/);
  const semLink = html.replace(/<link[^>]*>/g, '');
  assert.doesNotMatch(semLink, /github\.io|target=|<iframe|<embed|<object/i, 'sem link, moldura ou embed do portal antigo');
  assert.equal((html.match(/data-aba=/g) || []).length, 7, 'abas do Delivery do dia iguais');
  assert.equal((html.match(/setInterval\(/g) || []).length, 1, 'nenhum polling novo');
  assert.doesNotMatch(html, /garantido_|refeicao_|direito_/i);
});

test('nenhum robô, workflow, banco ou credencial alterado: só arquivos de frontend desta etapa mudaram desde a base', (t) => {
  const diff = git(['diff', '--name-only', BASE]);
  const novos = git(['ls-files', '--others', '--exclude-standard']);
  if (diff === null || novos === null) { t.skip('git indisponível'); return; }
  const mudados = [...diff.split('\n'), ...novos.split('\n')].map((s) => s.trim().replace(/\\/g, '/')).filter(Boolean);
  const permitidos = new Set(['sistema.html', 'casca/paginas.js', 'casca/setores-fabio.js', 'casca/setores-fabio.test.js',
    'delivery/index.html', 'docs/delivery-migracao.md']);
  mudados.forEach((f) => assert.ok(permitidos.has(f), 'arquivo fora do escopo mudou: ' + f));
  assert.ok(!mudados.some((f) => /^\.github\/|supabase|\.sql$|robo|coletor|rotina|cron/i.test(f)));
});
