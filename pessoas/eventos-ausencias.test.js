// node --test pessoas/eventos-ausencias.test.js   (a partir da raiz do portal já com os arquivos desta entrega sobrepostos à cópia do main)
// Módulo REAL; só rede, DOM e sessão são ficções; todos os dados abaixo são FICTÍCIOS. Nenhuma rede, banco ou navegador.
// Os testes que usam o consultarTudo REAL precisam de nucleo/nucleo.js: procuram na raiz do portal e, se não houver, na cópia-fonte.
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const EA = require('./eventos-ausencias.js');
const RAIZ = path.join(__dirname, '..');
const FONTE = 'C:\\Users\\Fabio Ikoma\\Documents\\Codex\\2026-11-09\\vam\\work\\ponto-pessoas-integracao-10-11';
const ler = (rel) => fs.readFileSync(path.join(RAIZ, rel), 'utf8');
const lerNucleo = () => {
  for (const base of [RAIZ, process.env.PORTAL_BASE, FONTE]) {
    if (!base) continue;
    const p = path.join(base, 'nucleo', 'nucleo.js');
    if (fs.existsSync(p)) return fs.readFileSync(p, 'utf8');
  }
  throw new Error('nucleo/nucleo.js não encontrado (defina PORTAL_BASE)');
};

// ---------- DOM de mentira (sem innerHTML: se o código tentar, falha) ----------
class FEl {
  constructor(tag) { this.tag = tag; this.children = []; this.attrs = {}; this.ev = {}; this.className = ''; this.value = ''; this.disabled = false; this._t = ''; }
  set textContent(v) { this.children = []; this._t = String(v); }
  get textContent() { return this._t + this.children.map((c) => c.textContent).join(''); }
  set innerHTML(v) { throw new Error('innerHTML proibido'); }
  appendChild(c) { this.children.push(c); return c; }
  replaceChildren() { this.children = []; this._t = ''; }
  setAttribute(k, v) { this.attrs[k] = v; }
  addEventListener(n, f) { this.ev[n] = f; }
}
const todos = (e, f, o = []) => { if (f(e)) o.push(e); e.children.forEach((c) => todos(c, f, o)); return o; };
const resp = (v, status = 200) => ({ status, ok: status < 400, json: async () => v });
const settle = async () => { for (let i = 0; i < 40; i++) await new Promise((r) => setImmediate(r)); };

const P = (o) => Object.assign({ id: 1, nome: 'Ana Teste', apelido: 'Aninha', unidade: 'AHU', flash_id: 'F1', admissao: '2020-01-01', desligamento: null }, o);
const A = (o) => Object.assign({ mes_lido: '2026-11-01', flash_id: 'F1', tipo: 'ATESTADO', inicio: '2026-11-10', fim: '2026-11-12', periodo: 'dia inteiro' }, o);
const O = (o) => Object.assign({ pessoa_id: 1, data: '2026-11-10', tipo: 'ATESTADO', fonte: 'ficticia', lido_em: '2026-11-10T20:00:00-03:00' }, o);
const ehUltima = (c) => /[?&]limit=1(&|$)/.test(c);   // limit=1 exato (a ausência pede limit=1000, que NÃO é "última data")

function mk(o = {}) {
  const raiz = new FEl('div'); const log = []; const ouv = []; const sessCb = [];
  const est = { loja: o.loja === undefined ? 'AHU' : o.loja, sess: 'usuario-ficticio' };
  const doc = { createElement: (t) => new FEl(t), getElementById: (id) => (id === 'view-peventos' ? raiz : null) };
  const portas = { tudo: [], um: [] };
  const rota = async (c, porta) => {
    log.push(c);
    const principalAus = c.startsWith('rh_flash_ausencia') && !ehUltima(c);
    const ultima = ehUltima(c) && (c.startsWith('rh_flash_ausencia') || c.startsWith('rh_ocorrencia'));
    const certa = (c.startsWith('rh_pessoa') || (c.startsWith('rh_ocorrencia') && !ultima)) ? 'tudo' : (principalAus || ultima) ? 'um' : null;
    if (certa !== porta) throw new Error('porta errada (' + porta + ') para ' + c);   // defeito do código, não mascarado
    if (o.consultar) { const r = await o.consultar(c, porta); if (r !== undefined) return r; }
    if (c.startsWith('rh_pessoa')) return o.pessoas || [P()];
    if (c.startsWith('rh_flash_ausencia')) return ultima ? (o.ultAus || []) : (o.aus || []);
    return ultima ? (o.ultOco || []) : (o.oco || []);
  };
  const deps = {
    doc, raiz, log, est,
    rpc: async (fn) => { log.push('rpc:' + fn); const r = o.rpc ? o.rpc(fn) : true; if (r instanceof Error) throw r; return typeof r === 'object' && r && 'status' in r ? r : resp(r); },
    // DUAS PORTAS, como no código real: consultarTudo (paginada) só aceita pessoas e ocorrência; consultar (uma página) só ausência e ULTIMA_*.
    // O gancho o.consultar(c, porta) vale para as duas portas (erros configurados em qualquer fonte continuam testáveis).
    consultarTudo: async (c) => { portas.tudo.push(c); return rota(c, 'tudo'); },
    consultar: async (c) => { portas.um.push(c); return rota(c, 'um'); },
    portas,
    lojaCarregar: async () => (o.info === undefined ? { lojas: ['AGUA VERDE', 'AHU', 'SÃO BRAZ', 'REDE'], travado: false } : o.info),
    lojaAtual: () => est.loja,
    escolherLoja: (l) => { est.loja = l; ouv.forEach((f) => f(l)); },
    aoMudarLoja: (f) => ouv.push(f), aoMudarSessao: (f) => sessCb.push(f),
    sessaoId: () => est.sess, agora: () => '2026-11-10T15:00:00.000Z', hoje: () => o.hoje || '2026-11-10',
  };
  const c = EA.criar(deps);
  return { c, deps, raiz, log, est, sessCb };
}
const tbody = (raiz) => todos(raiz, (e) => e.tag === 'tbody')[0];
const linhas = (raiz) => { const t = tbody(raiz); return t ? t.children.map((tr) => tr.children.map((td) => td.textContent)) : []; };
const metaTxt = (raiz) => todos(raiz, (e) => e.className === 'peve-meta').map((e) => e.textContent).join('\n');
const statusTxt = (raiz) => todos(raiz, (e) => /^peve-status/.test(e.className))[0].textContent;
const statusCls = (raiz) => todos(raiz, (e) => /^peve-status/.test(e.className))[0].className;
const tudoTxt = (raiz) => raiz.textContent;
const selects = (raiz) => todos(raiz, (e) => e.tag === 'select');   // [unidade, tipo]
const campoBusca = (raiz) => todos(raiz, (e) => e.tag === 'input' && e.type === 'search')[0];
const COL = { pessoa: 0, unidade: 1, origem: 2, tipo: 3, inicio: 4, fim: 5, detalhe: 6, recebido: 7, situacao: 8 };

// ---------- rota e casca ----------
test('rota peventos registrada por inteiro, no módulo Pessoas, azul/selo Fábio, sem remover pcartao', () => {
  const ctx = (f) => { const w = {}; vm.runInNewContext(ler(f), { window: w }); return w; };
  const menu = ctx('casca/menu.js').CASCA_MENU;
  const item = menu.find((g) => g.id === 'gRh').itens.find((i) => i.chave === 'peventos');
  assert.ok(item); assert.equal(item.rotulo, 'Eventos e ausências'); assert.equal(item.origem, 'fabio'); assert.ok(item.icone);
  assert.equal(menu.flatMap((g) => g.itens).filter((i) => i.chave === 'peventos').length, 1);
  assert.ok(menu.find((g) => g.id === 'gRh').itens.some((i) => i.chave === 'pcartao'), 'pcartao continua no menu');
  const pg = ctx('casca/paginas.js');
  assert.equal(pg.CASCA_PAGINAS.peventos, 'pessoas/index.html#peventos');
  assert.equal(pg.CASCA_PAGINAS.pcartao, 'pessoas/index.html#pcartao');
  assert.ok(pg.CASCA_TELAS_POR_LOJA.includes('peventos'));
  const mods = ctx('casca/modulos.js').CASCA_MODULOS.find((m) => m.id === 'pessoas');
  assert.equal(mods.lancar.filter((x) => x === 'peventos').length, 1);
  assert.ok(mods.lancar.includes('pcartao'));
  const busca = ctx('casca/busca.js').CASCA_BUSCA.peventos;
  assert.ok(busca && ['ausencia', 'eventos', 'ocorrencias'].every((t) => busca.some((s) => s.includes(t))));
  const html = ler('pessoas/index.html');
  assert.match(html, /id="modulo-peventos"[^>]*><div id="view-peventos">/);
  assert.match(html, /peventos:\s*entrarPesEventos/);
  assert.match(html, /eventos-ausencias\.css/);
  assert.match(html, /pessoas\.js[^>]*>[\s\S]*eventos-ausencias\.js/);
  assert.match(html, /pcartao:\s*entrarPesPonto/);
  const sis = ler('sistema.html');
  assert.match(sis, /SO_PESSOAL = new Set\(\['macertos', 'pcartao'\]\)/);   // como na fonte: nada mudou para as outras telas
  assert.match(sis, /SO_PESSOAL_E_CADASTRO = new Set\(\['peventos'\]\)/);
  assert.match(sis, /i\.origem === 'fabio' \? '<span class="selo-fabio">Fábio<\/span>'/);
  assert.match(sis, /casca\/menu\.js\?v=20261110d/); assert.match(sis, /casca\/paginas\.js\?v=20261110d/);
  assert.match(sis, /casca\/modulos\.js\?v=20261110c/); assert.match(sis, /casca\/busca\.js\?v=20261110c/);
  assert.equal(typeof EA.entrarPesEventos, 'function');
});

test('casca origem/source: a escolha de unidade vai à casca por casca-loja-pedir e a rota usa a mesma origem', () => {
  const src = ler('pessoas/eventos-ausencias.js');
  assert.match(src, /avisarCasca\(\{ tipo: 'casca-loja-pedir', loja: l \}\)/);
  assert.match(src, /aoMudarLoja\(fn\)/);
  assert.match(ler('pessoas/index.html'), /parent\.postMessage\(msg, location\.origin\)/);
});

test('o código executável só lê as 3 tabelas permitidas e não usa caminhos proibidos', () => {
  const src = ler('pessoas/eventos-ausencias.js').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '').replace(/\s\/\/ .*$/gm, '');
  for (const re of [/innerHTML|insertAdjacentHTML|outerHTML/, /localStorage|sessionStorage/, /\bfetch\s*\(/, /entrarCargos|\bCARGOS\b/, /service_role/, /method:\s*['"](POST|PATCH|PUT|DELETE)/i, /select=\*/,
    /justificativa|zera_mes|\bcpf\b|\bpis\b|salario|anexo|observac|\barquivo\b/i])
    assert.ok(!re.test(src), String(re));
  const tabelas = [...src.matchAll(/'(rh_[a-z_]+)\?/g)].map((m) => m[1]);
  assert.deepEqual([...new Set(tabelas)].sort(), ['rh_flash_ausencia', 'rh_ocorrencia', 'rh_pessoa']);
});

test('todas as consultas pedem só as colunas permitidas (nenhum campo proibido em select, filtro ou ordem)', async () => {
  const t = mk({ aus: [A()], oco: [O()], ultAus: [{ mes_lido: '2026-10-01' }], ultOco: [{ lido_em: '2026-11-10T20:00:00-03:00' }] });
  await t.c.entrar();
  const ok = { rh_pessoa: ['id', 'nome', 'apelido', 'unidade', 'flash_id', 'admissao', 'desligamento'], rh_flash_ausencia: ['mes_lido', 'flash_id', 'tipo', 'inicio', 'fim', 'periodo'], rh_ocorrencia: ['id', 'pessoa_id', 'data', 'tipo', 'fonte', 'lido_em'] };
  const caminhos = t.log.filter((x) => !x.startsWith('rpc:'));
  assert.equal(caminhos.length, 5);
  for (const c of caminhos) {
    const tab = c.split('?')[0]; assert.ok(ok[tab], tab);
    const cols = /select=([^&]*)/.exec(c)[1].split(','); cols.forEach((k) => assert.ok(ok[tab].includes(k), tab + '.' + k));
    assert.ok(!/justificativa|motivo|arquivo|zera_mes|cpf|pis|salario|valor|observ|anexo|decisao|select=\*/i.test(c), c);
  }
  assert.deepEqual(t.log.filter((x) => x.startsWith('rpc:')).sort(), ['rpc:pode_cadastrar_pessoal', 'rpc:pode_ver_pessoal']);
});
test('duas portas: consultarTudo só recebe cadastro e ocorrência; consultar recebe ausenciaPath e as duas ULTIMA_*', async () => {
  const t = mk({ aus: [A()], oco: [O({ id: 1 })] });
  await t.c.entrar();
  const { tudo, um } = t.deps.portas;
  assert.deepEqual(tudo, [EA.PESSOAS_PATH, EA.ocorrenciaPath('2026-10-11', '2026-12-10')]);
  assert.deepEqual(um.slice().sort(), [EA.ausenciaPath('2026-10-11', '2026-12-10'), EA.ULTIMA_AUSENCIA_PATH, EA.ULTIMA_OCORRENCIA_PATH].sort());
});

test('caminhos: período inclusivo por "menor que o dia seguinte" (virada de ano e bissexto) e ordem total para a paginação', () => {
  const a = EA.ausenciaPath('2026-12-01', '2026-12-31'), o = EA.ocorrenciaPath('2026-12-01', '2026-12-31');
  assert.match(a, /inicio=lt\.2027-01-01/); assert.match(a, /fim\.gte\.2026-12-01/); assert.match(o, /data=gte\.2026-12-01&data=lt\.2027-01-01/);
  assert.match(EA.ocorrenciaPath('2024-02-01', '2024-02-29'), /data=lt\.2024-03-01/);
  assert.match(EA.ausenciaPath('2025-02-01', '2025-02-28'), /inicio=lt\.2025-03-01/);
  for (const c of [a, o, EA.PESSOAS_PATH]) assert.match(c, /[?&]order=/);
  for (const c of [o, EA.PESSOAS_PATH]) assert.ok(!/limit=/.test(c));   // paginadas pelo consultarTudo
  assert.match(a, /&limit=1000$/);   // ausência: uma página só, sem offset
  assert.match(o, /select=id,pessoa_id,data,tipo,fonte,lido_em/); assert.match(o, /order=[^&]*,id\.asc$/);
  for (const c of [EA.ULTIMA_AUSENCIA_PATH, EA.ULTIMA_OCORRENCIA_PATH]) assert.match(c, /limit=1/);
});

// ---------- guardas ----------
for (const [nome, rpc, fase, cls] of [['false', () => false, 'semacesso', 'alerta'], ['null', () => null, 'semacesso', 'alerta'], ['401', () => resp(null, 401), 'sessao', 'erro'],
  ['403', () => resp(null, 403), 'negado', 'erro'], ['500', () => resp(null, 500), 'erro', 'erro'], ['rede cai', () => new Error('x'), 'erro', 'erro']]) {
  test('guarda ' + nome + ': não lê tabela, mostra o motivo e não mostra lista', async () => {
    const t = mk({ rpc, aus: [A()], oco: [O()] });
    await t.c.entrar();
    assert.equal(t.c.st.fase, fase); assert.deepEqual(t.log.filter((x) => !x.startsWith('rpc:')), []); assert.equal(t.c.st.dados, null);
    assert.deepEqual(linhas(t.raiz), []); assert.ok(statusTxt(t.raiz).length > 10); assert.match(statusCls(t.raiz), new RegExp('peve-' + cls));
  });
}
test('as duas guardas devem ser === true: uma false, string "true" ou 1 não bastam', async () => {
  const t = mk({ rpc: (fn) => fn === 'pode_cadastrar_pessoal' ? false : true });
  await t.c.entrar(); assert.equal(t.c.st.fase, 'semacesso'); assert.deepEqual(t.log.filter((x) => !x.startsWith('rpc:')), []);
  const u = mk({ rpc: () => 'true' }); await u.c.entrar(); assert.equal(u.c.st.fase, 'semacesso');
  const v = mk({ rpc: (fn) => fn === 'pode_ver_pessoal' ? 1 : true }); await v.c.entrar(); assert.equal(v.c.st.fase, 'semacesso');
});
test('a guarda roda a cada reentrada; negação depois de sucesso apaga dados e filtros', async () => {
  let ok = true;
  const t = mk({ rpc: () => ok, aus: [A()], oco: [O()] });
  await t.c.entrar(); assert.equal(t.c.st.fase, 'ok'); assert.equal(linhas(t.raiz).length, 2);
  campoBusca(t.raiz).value = 'ana'; campoBusca(t.raiz).ev.input();
  ok = false; await t.c.entrar();
  assert.equal(t.log.filter((x) => x === 'rpc:pode_ver_pessoal').length, 2);
  assert.equal(t.c.st.fase, 'semacesso'); assert.equal(t.c.st.dados, null); assert.deepEqual(linhas(t.raiz), []); assert.equal(t.c.st.busca, ''); assert.equal(campoBusca(t.raiz).value, '');
  assert.ok(!tudoTxt(t.raiz).includes('Ana'));
});
test('logout (sessão some) limpa dados, filtros e tela', async () => {
  const t = mk({ aus: [A()], oco: [O()], ultAus: [{ mes_lido: '2026-10-01' }] });
  await t.c.entrar(); assert.equal(linhas(t.raiz).length, 2);
  t.est.sess = null; t.sessCb.forEach((f) => f()); await settle();
  assert.equal(t.c.st.fase, 'sessao'); assert.equal(t.c.st.dados, null); assert.equal(t.c.st.ultimas, null);
  assert.deepEqual(linhas(t.raiz), []); assert.ok(!/Ana|Flash \(ausências\)/.test(tudoTxt(t.raiz)));
});
test('troca de usuário: resposta do usuário anterior não aparece', async () => {
  let libera; const portao = new Promise((r) => { libera = r; });
  const t = mk({ aus: [A()], consultar: async (c) => { if (c.startsWith('rh_pessoa')) { await portao; } return undefined; } });
  const p = t.c.entrar(); await settle();
  t.est.sess = 'outro-usuario'; t.sessCb.forEach((f) => f());
  libera(); await p; await settle();
  assert.equal(t.c.st.sessao, 'outro-usuario');
  assert.ok(['ok', 'vazio', 'semvinculo'].includes(t.c.st.fase));
});

// ---------- erros de leitura e vazio ----------
test('403 e 500 na leitura da tabela: erro visível, nada na tela, nunca vazio falso', async () => {
  for (const [status, fase] of [[403, 'negado'], [500, 'erro']]) {
    const t = mk({ consultar: async (c) => { if (c.startsWith('rh_flash_ausencia') && !ehUltima(c)) { const e = new Error('Erro ' + status + ' ao consultar x: y'); e.status = status; throw e; } } });
    await t.c.entrar();
    assert.equal(t.c.st.fase, fase); assert.equal(t.c.st.dados, null); assert.deepEqual(linhas(t.raiz), []);
    assert.match(statusCls(t.raiz), /peve-erro/); assert.ok(!/Nenhum registro recebido/.test(statusTxt(t.raiz)));
  }
});
test('falha em UMA das fontes derruba tudo: nunca mostra só metade como se fosse o total', async () => {
  const t = mk({ aus: [A()], consultar: async (c) => { if (c.startsWith('rh_ocorrencia') && !ehUltima(c)) throw new Error('Erro 500 ao consultar'); } });
  await t.c.entrar(); assert.equal(t.c.st.fase, 'erro'); assert.deepEqual(linhas(t.raiz), []);
});
test('401 na leitura vira sessão e chama a porta da casca', async () => {
  let avisou = 0;
  const t = mk({ consultar: async (c) => { if (c.startsWith('rh_pessoa')) { const e = new Error('sessão vencida'); throw e; } } });
  t.deps.sessaoVencida = () => { avisou++; };
  await t.c.entrar(); assert.equal(t.c.st.fase, 'sessao'); assert.equal(avisou, 0);   // o núcleo já chamou exigirLogin; a tela só mostra o estado
});
test('resposta fora do formato: erro de dados, sem tabela', async () => {
  const t = mk({ consultar: async (c) => (c.startsWith('rh_ocorrencia') && !ehUltima(c) ? { x: 1 } : undefined) });
  await t.c.entrar(); assert.equal(t.c.st.fase, 'dadosinvalidos'); assert.deepEqual(linhas(t.raiz), []);
});
test('vazio nas duas fontes: aviso explícito, sem tabela e sem contagem "0" que pareça resultado', async () => {
  const t = mk({ aus: [], oco: [] });
  await t.c.entrar();
  assert.equal(t.c.st.fase, 'vazio'); assert.deepEqual(linhas(t.raiz), []); assert.match(statusTxt(t.raiz), /Nenhum registro recebido/);
  assert.ok(!/Mostrando 0|Flash 0|Registro do RH 0/.test(metaTxt(t.raiz)));
});
test('cadastro vazio: não atribui nome e diz isso', async () => {
  const t = mk({ pessoas: [], aus: [A()], oco: [O()] });
  await t.c.entrar(); assert.equal(t.c.st.fase, 'semcadastro'); assert.deepEqual(linhas(t.raiz), []);
});
test('só itens sem vínculo: nenhuma linha, só contagem', async () => {
  const t = mk({ aus: [A({ flash_id: 'NAO-EXISTE' })], oco: [O({ pessoa_id: 4242 })] });
  await t.c.entrar(); assert.equal(t.c.st.fase, 'semvinculo'); assert.deepEqual(linhas(t.raiz), []);
  assert.match(metaTxt(t.raiz), /2 item\(ns\) sem vínculo/);
});

// ---------- período ----------
test('período: 366 dias aceita, 367 recusa; calendário real, bissexto, virada de ano e inversão', () => {
  assert.ok(EA.validarIntervalo('2026-01-01', '2026-12-31').ok);
  assert.equal(EA.validarIntervalo('2024-01-01', '2024-12-31').dias, 366);
  assert.ok(EA.validarIntervalo('2025-01-01', '2026-01-01').ok);
  assert.ok(!EA.validarIntervalo('2025-01-01', '2026-01-02').ok);
  assert.ok(EA.validarIntervalo('2026-01-01', '2027-01-01').ok);   // 2026 tem 365 dias: 01/01/2026..01/01/2027 = 366 dias inclusivos
  assert.ok(!EA.validarIntervalo('2026-01-01', '2027-01-02').ok);
  assert.ok(EA.validarIntervalo('2024-02-29', '2024-02-29').ok);
  assert.ok(EA.validarIntervalo('2026-12-20', '2027-01-10').ok);
  for (const [a, b] of [['2026-02-29', '2026-03-01'], ['2026-02-30', '2026-03-01'], ['2026-04-31', '2026-05-01'], ['2026-11-10', '2026-11-09'], ['10/11/2026', '2026-11-10'], ['', ''], [null, '2026-11-10'], ['2026-13-01', '2026-13-02'], ['0000-01-01', '0000-01-02']])
    assert.ok(!EA.validarIntervalo(a, b).ok, a + ' ' + b);
  assert.ok(!EA.validarIntervalo('0001-01-01', '9999-12-31').ok);
});
test('período inválido ou longo demais: nada é lido (nem a guarda)', async () => {
  for (const [de, ate] of [['2026-02-30', '2026-03-01'], ['2025-01-01', '2026-01-02']]) {
    const t = mk(); t.c.st.de = de; t.c.st.ate = ate; t.c.st.ativo = true; await t.c.carregar();
    assert.equal(t.c.st.fase, 'periodoinvalido'); assert.deepEqual(t.log, []);
  }
});
test('período padrão cobre passado e futuro (hoje ±30 dias) e vira o mês/ano sem erro', async () => {
  const t = mk({ hoje: '2026-12-20' }); await t.c.entrar();
  assert.equal(t.c.st.de, '2026-11-20'); assert.equal(t.c.st.ate, '2027-01-19');
  assert.equal(t.c.st.fase, 'vazio');
});
test('editar o período no meio da carga descarta o resultado antigo e pede Atualizar', async () => {
  let libera; const portao = new Promise((r) => { libera = r; });
  const t = mk({ aus: [A()], oco: [O()], consultar: async (c) => { if (c.startsWith('rh_pessoa')) await portao; } });
  const p = t.c.entrar(); await settle();
  const de = todos(t.raiz, (e) => e.tag === 'input' && e.type === 'date')[0];
  de.value = '2026-10-01'; de.ev.input();
  libera(); await p; await settle();
  assert.equal(t.c.st.fase, 'periodoalterado'); assert.equal(t.c.st.dados, null); assert.deepEqual(linhas(t.raiz), []);
  assert.match(statusTxt(t.raiz), /Clique Atualizar/);
});

// ---------- vínculo ----------
test('vínculo: ausência por flash_id, ocorrência por pessoa_id; sem vínculo não ganha nome nem expõe identificador', async () => {
  const t = mk({
    pessoas: [P({ id: 1, flash_id: 'F1' }), P({ id: 2, nome: 'Bia Teste', apelido: null, flash_id: 'F2' })],
    aus: [A({ flash_id: 'F1' }), A({ flash_id: 'FX-SECRETO' })], oco: [O({ pessoa_id: 2 }), O({ pessoa_id: 999 })],
  });
  await t.c.entrar();
  const l = linhas(t.raiz); assert.equal(l.length, 2);
  assert.ok(l.some((r) => r[COL.origem] === 'Flash' && r[COL.pessoa].startsWith('Ana Teste')));
  assert.ok(l.some((r) => r[COL.origem] === 'Registro do RH' && r[COL.pessoa] === 'Bia Teste'));
  assert.match(metaTxt(t.raiz), /2 item\(ns\) sem vínculo com cadastro \(Flash 1 · Registro do RH 1\)/);
  assert.ok(!/FX-SECRETO|999/.test(tudoTxt(t.raiz)));
});
test('vínculo cruzado não vale: ausência não casa por pessoa_id e ocorrência não casa por flash_id', () => {
  const r = EA.montarLinhas({ pessoas: [P({ id: 7, flash_id: 'F7' })], ausencias: [A({ flash_id: '7' })], ocorrencias: [O({ pessoa_id: 'F7' })], de: '2026-11-01', ate: '2026-11-30', hoje: '2026-11-10' });
  assert.equal(r.linhas.length, 0); assert.equal(r.notas.semVinculo.flash, 1); assert.equal(r.notas.semVinculo.rh, 1);
});
test('flash_id repetido em cadastros: só desempata por período do cadastro; sem desempate é ambíguo e não atribui', () => {
  const dados = (pessoas) => EA.montarLinhas({ pessoas, ausencias: [A({ flash_id: 'F1', inicio: '2026-11-10', fim: '2026-11-10' })], ocorrencias: [], de: '2026-11-01', ate: '2026-11-30', hoje: '2026-11-10' });
  const a = dados([P({ id: 1, nome: 'Antiga', flash_id: 'F1', desligamento: '2025-12-31' }), P({ id: 2, nome: 'Nova', flash_id: 'F1', admissao: '2026-01-01' })]);
  assert.equal(a.linhas.length, 1); assert.equal(a.linhas[0].nome, 'Nova');
  const b = dados([P({ id: 1, nome: 'Um', flash_id: 'F1' }), P({ id: 2, nome: 'Dois', flash_id: 'F1' })]);
  assert.equal(b.linhas.length, 0); assert.equal(b.notas.ambiguo.flash, 1);
  const c = dados([P({ id: 1, nome: 'Um', flash_id: 'F1' }), P({ id: 1, nome: 'Mesmo id', flash_id: 'F1' })]);
  assert.equal(c.linhas.length, 0);
});
test('pessoa_id repetido no cadastro ou nulo: ocorrência não é atribuída', () => {
  const r = EA.montarLinhas({ pessoas: [P({ id: 1 }), P({ id: 1, nome: 'Dup' })], ausencias: [], ocorrencias: [O({ pessoa_id: 1 }), O({ pessoa_id: null }), O({ pessoa_id: 'abc' })], de: '2026-11-01', ate: '2026-11-30', hoje: '2026-11-10' });
  assert.equal(r.linhas.length, 0); assert.equal(r.notas.ambiguo.rh, 1); assert.equal(r.notas.semVinculo.rh, 2);
});
test('itens com data inválida ou fora do período não viram linha e são contados', () => {
  const r = EA.montarLinhas({ pessoas: [P()], ausencias: [A({ inicio: '2026-02-30' }), A({ inicio: '2026-11-12', fim: '2026-11-10' }), A({ inicio: '2027-05-01', fim: '2027-05-02' }), null], ocorrencias: [O({ data: 'x' }), O({ data: '2026-10-01' })], de: '2026-11-01', ate: '2026-11-30', hoje: '2026-11-10' });
  assert.equal(r.linhas.length, 0); assert.equal(r.notas.invalido.flash, 3); assert.equal(r.notas.foraPeriodo.flash, 1);
  assert.equal(r.notas.invalido.rh, 1); assert.equal(r.notas.foraPeriodo.rh, 1);
});
test('ausência que cruza a virada do período aparece; sem fim informado vale só o dia de início', () => {
  const r = EA.montarLinhas({ pessoas: [P()], ausencias: [A({ inicio: '2026-10-28', fim: '2026-11-03' }), A({ tipo: 'SEM FIM', inicio: '2026-11-15', fim: null }), A({ tipo: 'ANTES', inicio: '2026-10-20', fim: null })], ocorrencias: [], de: '2026-11-01', ate: '2026-11-30', hoje: '2026-11-10' });
  assert.deepEqual(r.linhas.map((x) => x.tipo).sort(), ['ATESTADO', 'SEM FIM']); assert.equal(r.notas.foraPeriodo.flash, 1);
  assert.equal(r.linhas.find((x) => x.tipo === 'SEM FIM').fim, null);
});

// ---------- duplicidade ----------
test('mesmo dia e tipo nas duas fontes: as DUAS linhas ficam, cada uma com a sua origem, e há aviso', async () => {
  const t = mk({ aus: [A({ tipo: 'Atestado', inicio: '2026-11-10', fim: '2026-11-10' })], oco: [O({ tipo: 'ATESTADO', data: '2026-11-10' })] });
  await t.c.entrar();
  const l = linhas(t.raiz); assert.equal(l.length, 2);
  assert.deepEqual(l.map((r) => r[COL.origem]), ['Flash', 'Registro do RH']);
  assert.ok(l.every((r) => /Consta também na outra fonte/.test(r[COL.situacao])));
  assert.match(metaTxt(t.raiz), /as duas linhas foram mantidas/);
  assert.match(metaTxt(t.raiz), /Flash 1 · Registro do RH 1/);
});
test('duplicata exata dentro da MESMA fonte também não é removida', async () => {
  const t = mk({ aus: [A(), A()], oco: [O(), O()] });
  await t.c.entrar(); assert.equal(linhas(t.raiz).length, 4);
});
test('tipos diferentes no mesmo dia não são marcados como "também na outra fonte"', () => {
  const r = EA.montarLinhas({ pessoas: [P()], ausencias: [A({ tipo: 'LICENÇA' })], ocorrencias: [O({ tipo: 'ATESTADO' })], de: '2026-11-01', ate: '2026-11-30', hoje: '2026-11-10' });
  assert.ok(r.linhas.every((x) => !x.tambem)); assert.equal(r.notas.comOutraFonte, 0);
});

// ---------- filtros ----------
const PESSOAS3 = [P({ id: 1, nome: 'Ana Teste', unidade: 'AHU', flash_id: 'F1' }), P({ id: 2, nome: 'José Silva', apelido: 'Zezé', unidade: 'AGUA VERDE', flash_id: 'F2' }), P({ id: 3, nome: 'Duda Sem Unidade', apelido: null, unidade: null, flash_id: 'F3' })];
const AUS3 = [A({ flash_id: 'F1', tipo: 'ATESTADO' }), A({ flash_id: 'F2', tipo: 'LICENÇA' }), A({ flash_id: 'F3', tipo: 'ATESTADO' })];
test('filtro de unidade: loja específica só vê a unidade; cadastro sem unidade só aparece em REDE, com aviso', async () => {
  const t = mk({ pessoas: PESSOAS3, aus: AUS3 });
  await t.c.entrar();
  assert.deepEqual(linhas(t.raiz).map((r) => r[COL.pessoa].split(' (')[0]), ['Ana Teste']);
  assert.match(metaTxt(t.raiz), /1 linha\(s\) de cadastro sem unidade válida não aparecem/);
  t.deps.escolherLoja('AGUA VERDE'); await settle();
  assert.deepEqual(linhas(t.raiz).map((r) => r[COL.pessoa].split(' (')[0]), ['José Silva']);
  t.deps.escolherLoja('REDE'); await settle();
  assert.equal(linhas(t.raiz).length, 3); assert.ok(!/sem unidade válida não aparecem/.test(metaTxt(t.raiz)));
  assert.ok(linhas(t.raiz).some((r) => r[COL.unidade] === '—'));
});
test('Todas = REDE só se a casca trouxer REDE na lista; fora da lista não vira REDE', async () => {
  const sem = mk({ loja: 'REDE', info: { lojas: ['AHU', 'AGUA VERDE'], travado: false }, pessoas: PESSOAS3, aus: AUS3 });
  await sem.c.entrar(); assert.equal(sem.c.st.fase, 'semloja'); assert.deepEqual(sem.log.filter((x) => !x.startsWith('rpc:')), []);
  const com = mk({ loja: 'REDE', pessoas: PESSOAS3, aus: AUS3 });
  await com.c.entrar(); assert.equal(com.c.st.fase, 'ok'); assert.equal(linhas(com.raiz).length, 3);
  assert.equal(EA.lojaCombina('AHU', 'REDE', false), false); assert.equal(EA.lojaCombina('AHU', 'REDE', true), true);
  assert.equal(EA.lojaCombina(null, 'AHU', true), false); assert.equal(EA.lojaCombina('SAO BRAZ', 'SÃO BRAZ', false), true);
});
test('unidade sincronizada com a casca: trocar na tela pede à casca e recomeça; loja travada não deixa trocar', async () => {
  const t = mk({ pessoas: PESSOAS3, aus: AUS3 });
  await t.c.entrar();
  const selU = selects(t.raiz)[0];
  assert.deepEqual(selU.children.map((o) => o.value), ['AGUA VERDE', 'AHU', 'SÃO BRAZ', 'REDE']);
  assert.equal(selU.children.find((o) => o.value === 'REDE').textContent, 'Todas (REDE)');
  assert.equal(selU.value, 'AHU'); assert.equal(selU.disabled, false);
  selU.value = 'REDE'; selU.ev.change(); await settle();
  assert.equal(t.est.loja, 'REDE'); assert.equal(t.c.st.loja, 'REDE'); assert.equal(selects(t.raiz)[0].value, 'REDE');
  const tr = mk({ info: { lojas: ['AHU'], travado: true }, pessoas: PESSOAS3, aus: AUS3 });
  await tr.c.entrar(); assert.equal(selects(tr.raiz)[0].disabled, true); assert.equal(tr.c.st.travado, true);
});
test('trocar a unidade apaga a tela na hora e descarta resposta atrasada da unidade anterior', async () => {
  let libera; const portao = new Promise((r) => { libera = r; });
  let primeira = true;
  const t = mk({ pessoas: PESSOAS3, aus: AUS3, consultar: async (c) => { if (c.startsWith('rh_pessoa') && primeira) { primeira = false; await portao; } } });
  const p = t.c.entrar(); await settle();
  t.deps.escolherLoja('AGUA VERDE'); await settle();
  assert.deepEqual(linhas(t.raiz).map((r) => r[COL.pessoa].split(' (')[0]), ['José Silva']);
  libera(); await p; await settle();
  assert.deepEqual(linhas(t.raiz).map((r) => r[COL.pessoa].split(' (')[0]), ['José Silva']); assert.equal(t.c.st.loja, 'AGUA VERDE');
});
test('filtro de tipo: opções vêm dos dados da unidade; sem tipo tem opção própria', async () => {
  const t = mk({ loja: 'REDE', pessoas: PESSOAS3, aus: AUS3.concat([A({ flash_id: 'F1', tipo: null })]) });
  await t.c.entrar();
  const selT = selects(t.raiz)[1];
  assert.deepEqual(selT.children.map((o) => o.value), ['', 'ATESTADO', 'LICENÇA', '__sem_tipo__']);
  selT.value = 'ATESTADO'; selT.ev.change(); assert.equal(linhas(t.raiz).length, 2);
  selT.value = '__sem_tipo__'; selT.ev.change(); assert.equal(linhas(t.raiz).length, 1); assert.equal(linhas(t.raiz)[0][COL.tipo], '—');
  selT.value = ''; selT.ev.change(); assert.equal(linhas(t.raiz).length, 4);
});
test('busca por nome: sem acento, sem caixa, por apelido e por várias palavras; zera a página', async () => {
  const t = mk({ loja: 'REDE', pessoas: PESSOAS3, aus: AUS3 });
  await t.c.entrar();
  const b = campoBusca(t.raiz);
  b.value = 'JOSE'; b.ev.input(); assert.equal(linhas(t.raiz).length, 1);
  b.value = 'zeze'; b.ev.input(); assert.equal(linhas(t.raiz).length, 1);
  b.value = 'duda unid'; b.ev.input(); assert.equal(linhas(t.raiz).length, 1);
  b.value = 'ninguem'; b.ev.input(); assert.equal(linhas(t.raiz).length, 0); assert.match(statusTxt(t.raiz), /Nenhum item com os filtros atuais/);
  assert.notEqual(t.c.st.fase, 'vazio');
  b.value = ''; b.ev.input(); assert.equal(linhas(t.raiz).length, 3);
});

// ---------- ordenação ----------
test('ordenação estável: início desc, depois nome, depois origem (Flash antes de Registro do RH), depois tipo', () => {
  const pessoas = [P({ id: 1, nome: 'Zeca', flash_id: 'F1' }), P({ id: 2, nome: 'Ana', flash_id: 'F2' }), P({ id: 3, nome: 'Bia', flash_id: 'F3' })];
  const r = EA.montarLinhas({ pessoas, ausencias: [A({ flash_id: 'F3', inicio: '2026-11-10', fim: '2026-11-10' }), A({ flash_id: 'F2', inicio: '2026-11-10', fim: '2026-11-10', tipo: 'B' }), A({ flash_id: 'F2', inicio: '2026-11-10', fim: '2026-11-10', tipo: 'A' }), A({ flash_id: 'F1', inicio: '2026-11-12', fim: '2026-11-12' })],
    ocorrencias: [O({ pessoa_id: 2, data: '2026-11-10', tipo: 'C' })], de: '2026-11-01', ate: '2026-11-30', hoje: '2026-11-10' });
  const o = EA.ordenar(r.linhas).map((x) => x.nome + '|' + x.origemKey + '|' + x.tipo);
  assert.deepEqual(o, ['Zeca|flash|ATESTADO', 'Ana|flash|A', 'Ana|flash|B', 'Ana|rh|C', 'Bia|flash|ATESTADO']);
  assert.deepEqual(EA.ordenar(r.linhas.slice().reverse()).map((x) => x.nome + '|' + x.origemKey + '|' + x.tipo), o);
});
test('ordenação: linhas totalmente iguais mantêm a ordem de chegada (estável)', () => {
  const r = EA.montarLinhas({ pessoas: [P()], ausencias: [A({ periodo: 'p1' }), A({ periodo: 'p2' }), A({ periodo: 'p3' })], ocorrencias: [], de: '2026-11-01', ate: '2026-11-30', hoje: '2026-11-10' });
  assert.deepEqual(EA.ordenar(r.linhas).map((x) => x.detalhe), ['p1', 'p2', 'p3']);
});

// ---------- futuro ----------
test('ausência e ocorrência futuras são aceitas e marcadas "Programado", sem virar erro', async () => {
  const t = mk({ aus: [A({ inicio: '2026-12-01', fim: '2026-12-05' }), A({ tipo: 'HOJE', inicio: '2026-11-10', fim: '2026-11-10' })], oco: [O({ data: '2026-11-20' })] });
  await t.c.entrar();
  assert.equal(t.c.st.fase, 'ok'); assert.doesNotMatch(statusCls(t.raiz), /peve-erro/);
  const l = linhas(t.raiz);
  assert.equal(l.filter((r) => /Programado/.test(r[COL.situacao])).length, 2);
  assert.ok(!/Programado/.test(l.find((r) => r[COL.tipo] === 'HOJE')[COL.situacao]));
});
test('período inteiro no futuro é aceito', async () => {
  const t = mk({ oco: [O({ data: '2027-01-15' })] }); t.c.st.de = '2027-01-01'; t.c.st.ate = '2027-01-31';
  await t.c.entrar();
  assert.equal(t.c.st.fase, 'ok'); assert.match(linhas(t.raiz)[0][COL.situacao], /Programado/);
});

// ---------- fonte e frescor ----------
test('fonte e frescor: última data recebida por fonte (mes_lido e lido_em) e rótulo de não-decisão visíveis', async () => {
  const t = mk({ aus: [A()], oco: [O()], ultAus: [{ mes_lido: '2026-10-01' }], ultOco: [{ lido_em: '2026-11-09T20:00:00-03:00' }] });
  await t.c.entrar();
  const m = metaTxt(t.raiz);
  assert.match(m, /Flash \(ausências\): última data recebida \(mês lido\) 10\/2026/);
  assert.match(m, /Registro do RH \(ocorrências\): última data recebida \(lido em\) \d{2}\/\d{2}\/\d{4}/);
  const l = linhas(t.raiz);
  assert.ok(l.some((r) => r[COL.origem] === 'Flash' && r[COL.recebido] === 'mês lido 11/2026'));
  assert.ok(l.some((r) => r[COL.origem] === 'Registro do RH' && /\d{2}\/\d{2}\/\d{4}/.test(r[COL.recebido])));
  assert.match(tudoTxt(t.raiz), /Registro recebido, não decisão de folha/);
  assert.match(tudoTxt(t.raiz), /não decisão de folha: nada aqui indica falta, abono, desconto, bônus ou efeito financeiro/);
});
test('frescor: fonte sem registro e fonte indisponível são ditas como tal, sem inventar data', async () => {
  const t = mk({ aus: [A()], ultAus: [], consultar: async (c) => { if (c.startsWith('rh_ocorrencia') && ehUltima(c)) throw new Error('falhou'); } });
  await t.c.entrar();
  assert.equal(t.c.st.fase, 'ok');
  assert.match(metaTxt(t.raiz), /Flash \(ausências\): nenhum registro recebido até agora/);
  assert.match(metaTxt(t.raiz), /Registro do RH \(ocorrências\): última data recebida indisponível agora/);
});
test('a tela não mostra nenhum campo fora da lista, mesmo que a resposta traga (defesa)', async () => {
  const t = mk({ pessoas: [Object.assign(P(), { cpf: '000.000.000-00', salario: 1234.5 })], aus: [Object.assign(A(), { justificativa: 'SEGREDO-J', motivo: 'SEGREDO-M', arquivo: 'SEGREDO-A', valor: 99 })], oco: [Object.assign(O(), { observacao: 'SEGREDO-O', decisao: 'SEGREDO-D', zera_mes: true, anexo: 'SEGREDO-X' })] });
  await t.c.entrar();
  assert.equal(linhas(t.raiz).length, 2);
  assert.ok(!/SEGREDO|000\.000|1234/.test(tudoTxt(t.raiz)));
});

// ---------- segurança de texto ----------
test('HTML malicioso em nome, apelido, tipo, período e fonte aparece como texto: nenhum elemento é criado', async () => {
  const xss = '<img src=x onerror=alert(1)>';
  const t = mk({ pessoas: [P({ nome: xss, apelido: '<script>alert(2)</script>' })], aus: [A({ tipo: '<b>negrito</b>', periodo: xss })], oco: [O({ tipo: '"><svg onload=1>', fonte: '<iframe>' })] });
  await t.c.entrar();
  const l = linhas(t.raiz); assert.equal(l.length, 2);
  assert.ok(l[0][COL.pessoa].includes(xss)); assert.ok(l[0][COL.pessoa].includes('<script>alert(2)</script>'));
  assert.ok(tudoTxt(t.raiz).includes('<b>negrito</b>'));
  const tags = todos(t.raiz, () => true).map((e) => e.tag);
  for (const proibida of ['img', 'script', 'b', 'svg', 'iframe']) assert.ok(!tags.includes(proibida), proibida);
});
test('caracteres de controle e bidi são removidos e textos enormes cortados', () => {
  const r = EA.montarLinhas({ pessoas: [P({ nome: 'A\u202Eb\u0000c\n\td' + 'x'.repeat(500) })], ausencias: [A()], ocorrencias: [], de: '2026-11-01', ate: '2026-11-30', hoje: '2026-11-10' });
  assert.ok(!/[\u202E\u0000\n\t]/.test(r.linhas[0].nome)); assert.ok(r.linhas[0].nome.length <= 80);
});

// ---------- paginação visual ----------
test('paginação visual de 50: páginas, anterior/próxima e limites', async () => {
  const oco = Array.from({ length: 120 }, (_, i) => O({ tipo: 'T' + String(i).padStart(3, '0') }));
  const t = mk({ oco });
  await t.c.entrar();
  assert.equal(linhas(t.raiz).length, 50);
  const pag = () => todos(t.raiz, (e) => e.className === 'peve-pag')[0];
  assert.match(pag().textContent, /Página 1 de 3 · linhas 1 a 50 de 120/);
  const botoes = () => todos(pag(), (e) => e.tag === 'button');
  assert.equal(botoes()[0].disabled, true); assert.equal(botoes()[1].disabled, false);
  botoes()[1].ev.click(); assert.match(pag().textContent, /Página 2 de 3 · linhas 51 a 100/); assert.equal(linhas(t.raiz).length, 50);
  botoes()[1].ev.click(); assert.match(pag().textContent, /Página 3 de 3 · linhas 101 a 120 de 120/); assert.equal(linhas(t.raiz).length, 20); assert.equal(botoes()[1].disabled, true);
  campoBusca(t.raiz).value = 'ana'; campoBusca(t.raiz).ev.input(); assert.match(pag().textContent, /Página 1 de 3/);
  const p = EA.paginar(Array.from({ length: 50 }, (_, i) => i), 9); assert.equal(p.paginas, 1); assert.equal(p.pagina, 1); assert.equal(EA.paginar([], 1).total, 0);
});

// ---------- paginação real (consultarTudo do núcleo) ----------
function consultarTudoReal(tabelas, vistos) {
  const src = lerNucleo();
  const i = src.indexOf('function ordemDoSelect('), j = src.indexOf('// 27/10/2026: "Failed to fetch"');
  const k = src.indexOf('async function consultarTudo('), l = src.indexOf('const MESES_ABREV');
  assert.ok(i > -1 && j > i && k > -1 && l > k, 'não achei consultarTudo/ordemDoSelect em nucleo.js');
  const ctx = {
    SUPABASE_URL: 'https://ficticio.invalid', performance, setTimeout, Promise, Array, Error, console, encodeURIComponent, decodeURIComponent, RegExp, Math,
    rmbRenovarSeExpirado: async () => false, exigirLogin() {},
    buscarLeitura: async (url) => {
      vistos.push(url);
      const m = /\/rest\/v1\/([a-z_]+)\?(.*)$/.exec(url); const q = m[2];
      const lim = Number((/[?&]limit=(\d+)/.exec('?' + q) || [])[1] || 1000), off = Number((/[?&]offset=(\d+)/.exec('?' + q) || [])[1] || 0);
      const dados = tabelas[m[1]].slice(off, off + lim);
      return { status: 200, ok: true, json: async () => dados, text: async () => '' };
    },
  };
  vm.runInNewContext(src.slice(i, j) + '\n' + src.slice(k, l), ctx);
  return ctx.consultarTudo;
}
test('paginação real: consultarTudo do núcleo junta mais de 1000 linhas sem perder nem repetir (cada fonte)', async () => {
  const pessoas = Array.from({ length: 2500 }, (_, i) => P({ id: i + 1, flash_id: 'F' + (i + 1) }));
  const vistos = [];
  const ocoTodas = Array.from({ length: 2500 }, (_, i) => O({ id: 5000 + i }));
  const ct = consultarTudoReal({ rh_pessoa: pessoas, rh_ocorrencia: ocoTodas }, vistos);
  const ro = await ct(EA.ocorrenciaPath('2026-11-01', '2026-11-30'));
  assert.equal(ro.length, 2500); assert.equal(new Set(ro.map((x) => x.id)).size, 2500);
  vistos.length = 0;
  const r = await ct(EA.PESSOAS_PATH);
  assert.equal(r.length, 2500); assert.deepEqual(r.map((x) => x.id), pessoas.map((x) => x.id));
  assert.ok(vistos.every((u) => /order=/.test(u)) && vistos.every((u) => /limit=1000/.test(u)));
  assert.ok(vistos.some((u) => /offset=1000/.test(u)) && vistos.some((u) => /offset=2000/.test(u)));
  const um = await ct(EA.ULTIMA_OCORRENCIA_PATH.replace('rh_ocorrencia', 'rh_pessoa').replace('lido_em', 'id'));
  assert.equal(um.length, 1);
});
test('de ponta a ponta: 2300 ocorrências (com id único, via consultarTudo) + 900 ausências (uma página) + 1500 cadastros', async () => {
  const pessoas = Array.from({ length: 1500 }, (_, i) => P({ id: i + 1, nome: 'Pessoa ' + String(i + 1).padStart(4, '0'), apelido: null, flash_id: 'F' + (i + 1) }));
  const oco = Array.from({ length: 2300 }, (_, i) => O({ id: 900000 + i, pessoa_id: (i % 1500) + 1, tipo: 'T' + i }));
  const aus = Array.from({ length: 900 }, (_, i) => A({ flash_id: 'F' + (i + 1), tipo: 'U' + i, inicio: '2026-11-11', fim: '2026-11-11' }));
  const vistos = [];
  const ct = consultarTudoReal({ rh_pessoa: pessoas, rh_ocorrencia: oco, rh_flash_ausencia: aus }, vistos);
  const t = mk({ consultar: async (c) => ct(c) });
  await t.c.entrar(); await settle();
  assert.equal(t.c.st.fase, 'ok');
  assert.match(metaTxt(t.raiz), /Mostrando 3200 linha\(s\): Flash 900 · Registro do RH 2300/);
  assert.match(todos(t.raiz, (e) => e.className === 'peve-pag')[0].textContent, /Página 1 de 64 · linhas 1 a 50 de 3200/);
  assert.equal(linhas(t.raiz).length, 50);
  const ocoReq = vistos.filter((u) => /\/rh_ocorrencia\?/.test(u) && !/limit=1(&|$)/.test(u));
  assert.ok(ocoReq.length >= 3 && ocoReq.every((u) => /order=[^&]*,id\.asc/.test(u)) && ocoReq.some((u) => /offset=2000/.test(u)));   // paginou por offset com ordem única
  const ausReq = vistos.filter((u) => /\/rh_flash_ausencia\?/.test(u) && !/select=mes_lido&/.test(u));
  assert.equal(ausReq.length, 1); assert.ok(/limit=1000$/.test(ausReq[0]) && !/offset=/.test(ausReq[0]));   // ausência: uma única página
  assert.ok(!/90000\d/.test(tudoTxt(t.raiz)), 'id técnico não aparece');
});
test('de ponta a ponta: ausência com 1000+ linhas no servidor é recusada inteira, mesmo havendo ocorrências', async () => {
  const aus = Array.from({ length: 1500 }, (_, i) => A({ tipo: 'U' + i }));
  const vistos = [];
  const ct = consultarTudoReal({ rh_pessoa: [P()], rh_ocorrencia: [O({ id: 1 })], rh_flash_ausencia: aus }, vistos);
  const t = mk({ consultar: async (c) => ct(c) });
  await t.c.entrar(); await settle();
  assert.equal(t.c.st.fase, 'limiteausencia'); assert.deepEqual(linhas(t.raiz), []);
  assert.equal(vistos.filter((u) => /\/rh_flash_ausencia\?/.test(u) && !/select=mes_lido&/.test(u)).length, 1);
});

// ---------- ausência sem chave única: uma consulta só, limite conservador de 999 ----------
test('ausência usa deps.consultar UMA vez (sem offset); 999 linhas é aceito', async () => {
  const aus = Array.from({ length: 999 }, (_, i) => A({ tipo: 'U' + i }));
  const t = mk({ aus });
  await t.c.entrar();
  const chamadas = t.deps.portas.um.filter((c) => c.startsWith('rh_flash_ausencia') && !ehUltima(c));
  assert.equal(t.deps.portas.tudo.filter((c) => c.startsWith('rh_flash_ausencia')).length, 0);
  assert.equal(chamadas.length, 1); assert.match(chamadas[0], /&limit=1000$/); assert.ok(!/offset=/.test(chamadas[0]));
  assert.equal(t.c.st.fase, 'ok'); assert.match(metaTxt(t.raiz), /Mostrando 999 linha\(s\): Flash 999/);
  assert.match(todos(t.raiz, (e) => e.className === 'peve-pag')[0].textContent, /de 999/);
});
test('ausência com 1000 linhas: bloqueia tudo, erro visível pedindo reduzir o período, sem parcial nem contagens', async () => {
  for (const n of [1000, 1001]) {
    const t = mk({ aus: Array.from({ length: n }, (_, i) => A({ tipo: 'U' + i })), oco: [O({ id: 5 })], ultAus: [{ mes_lido: '2026-10-01' }] });
    await t.c.entrar();
    assert.equal(t.c.st.fase, 'limiteausencia'); assert.equal(t.c.st.dados, null); assert.equal(t.c.st.ultimas, null);
    assert.deepEqual(linhas(t.raiz), []); assert.match(statusCls(t.raiz), /peve-erro/); assert.match(statusTxt(t.raiz), /Reduza o período/);
    assert.equal(metaTxt(t.raiz), ''); assert.ok(!/Mostrando|sem vínculo|Flash \(ausências\)/.test(tudoTxt(t.raiz)));
    assert.equal(t.deps.portas.um.filter((c) => c.startsWith('rh_flash_ausencia') && !ehUltima(c)).length, 1);
    assert.equal(t.deps.portas.tudo.filter((c) => c.startsWith('rh_flash_ausencia')).length, 0);
  }
});
test('ocorrência: id técnico é pedido e usado na ordem, mas nunca aparece na tela nem nas linhas', async () => {
  const t = mk({ oco: [O({ id: 8123456789 }), O({ id: 8123456790, tipo: 'OUTRO' })] });
  await t.c.entrar();
  assert.equal(linhas(t.raiz).length, 2); assert.ok(!/8123456/.test(tudoTxt(t.raiz)));
  const r = EA.montarLinhas({ pessoas: [P()], ausencias: [], ocorrencias: [O({ id: 77 })], de: '2026-11-01', ate: '2026-11-30', hoje: '2026-11-10' });
  assert.ok(!('id' in r.linhas[0]) && !JSON.stringify(r.linhas).includes('77'));
  assert.ok(todos(t.raiz, (e) => Object.values(e.attrs).some((v) => /8123456/.test(String(v)))).length === 0);
});

// ---------- menu: exige as DUAS permissões; outras telas intactas ----------
test('menu: peventos só aparece com ver E cadastrar pessoal === true; macertos/pcartao seguem a regra antiga', () => {
  const sis = ler('sistema.html');
  const i = sis.indexOf('const SO_PESSOAL'), j = sis.indexOf('let GRUPOS_ABERTOS');
  assert.ok(i > -1 && j > i);
  const ctx = vm.createContext({ ITENS: { peventos: {}, pcartao: {}, macertos: {}, outra: {} }, PODE: null, sessao: () => ({ email: 'x@ficticio.invalid' }) });
  vm.runInContext(sis.slice(i, j), ctx);
  const ve = (pessoal, cadastra) => JSON.parse(vm.runInContext('VE_PESSOAL=' + pessoal + '; VE_CADASTRA=' + cadastra + '; JSON.stringify(["peventos","pcartao","macertos","outra"].map(visivel))', ctx));
  assert.deepEqual(ve('true', 'true'), [true, true, true, true]);
  assert.deepEqual(ve('true', 'false'), [false, true, true, true]);   // vê mas não cadastra: item escondido
  assert.deepEqual(ve('true', 'null'), [false, true, true, true]);
  assert.deepEqual(ve('false', 'true'), [false, false, false, true]);
  assert.deepEqual(ve('null', 'true'), [false, true, true, true]);   // pcartao/macertos: null não esconde, como hoje
  assert.match(sis, /pode_cadastrar_pessoal/);
  assert.match(sis, /\[PODE, DESC, , VE_PESSOAL, VE_GESTAO, VE_EQUIPE, VE_CADASTRA\] = await Promise\.all/);
});

// ---------- ligação ao núcleo (padrão do navegador) ----------
test('ligação padrão: usa trRpc, consultarTudo e o seletor de loja da casca (casca-loja-pedir)', async () => {
  const raiz = new FEl('div'); const msgs = []; const chamadas = [];
  const salvos = {};
  const globais = {
    NA_CASCA: true, avisarCasca: (m) => msgs.push(m),
    document: { createElement: (t) => new FEl(t), getElementById: (id) => (id === 'view-peventos' ? raiz : null) },
    window: { addEventListener() {} },
    trRpc: async (fn) => { chamadas.push('rpc:' + fn); return resp(true); },
    consultarTudo: async (c) => { chamadas.push(c.split('?')[0]); return c.startsWith('rh_pessoa') ? [P()] : []; },
    lojaCarregar: async () => ({ lojas: ['AHU', 'REDE'], travado: false }), lojaAtual: () => 'AHU', lojaNome: (l) => l, lojaEscolher: () => { chamadas.push('lojaEscolher'); },
    aoMudarLoja: () => {}, rmbSessao: () => ({ access_token: 'tok-ficticio', email: 'x@ficticio.invalid' }), exigirLogin: () => {},
  };
  for (const k of Object.keys(globais)) { salvos[k] = Object.getOwnPropertyDescriptor(globalThis, k); globalThis[k] = globais[k]; }
  try {
    await EA.entrarPesEventos(); await settle();
    assert.ok(chamadas.includes('rpc:pode_ver_pessoal') && chamadas.includes('rpc:pode_cadastrar_pessoal'));
    assert.ok(chamadas.includes('rh_pessoa') && chamadas.includes('rh_flash_ausencia') && chamadas.includes('rh_ocorrencia'));
    const sel = selects(raiz)[0]; sel.value = 'REDE'; sel.ev.change();
    assert.deepEqual(msgs, [{ tipo: 'casca-loja-pedir', loja: 'REDE' }]); assert.ok(!chamadas.includes('lojaEscolher'));
  } finally {
    for (const k of Object.keys(globais)) { if (salvos[k]) Object.defineProperty(globalThis, k, salvos[k]); else delete globalThis[k]; }
  }
});

