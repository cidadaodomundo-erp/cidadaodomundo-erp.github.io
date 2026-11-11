/* Regressões comportamentais da tela (reuniao.js) com um DOM mínimo em vm. Node stdlib: node --test reuniao/ */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const settle = async () => { for (let i = 0; i < 8; i++) await new Promise((r) => setImmediate(r)); };

function montar({ email = 'a@exemplo.test', defer = null, casca = false } = {}) {
  const all = [], messages = [], events = {};
  class E {
    constructor(tag, id) { this.tagName = tag.toUpperCase(); this.id = id; this.children = []; this.ev = {}; this.attrs = {}; this.value = ''; this.hidden = false; this._text = ''; this.disabled = false; all.push(this); }
    set textContent(v) { this._text = String(v); this.children = []; }
    get textContent() { return this._text + this.children.map((c) => c.textContent).join(''); }
    set innerHTML(v) { throw new Error('innerHTML proibido'); }
    appendChild(e) { this.children.push(e); e.parent = this; return e; }
    setAttribute(k, v) { this.attrs[k] = v; }
    addEventListener(n, f) { (this.ev[n] = this.ev[n] || []).push(f); }
    fire(n) { (this.ev[n] || []).forEach((f) => f({ preventDefault() {}, target: this })); }
    click() { this.fire('click'); }
    remove() { if (this.parent) this.parent.children = this.parent.children.filter((c) => c !== this); }
    focus() {}
  }
  const ids = {};
  ['avisoCtx', 'bloqueio', 'app', 'ata', 'dia', 'loja', 'participantes', 'temas', 'btnTema', 'limparBox', 'atalhos', 'impressao', 'novoPart', 'btnPart', 'btnExportar', 'btnImprimir']
    .forEach((id) => { ids[id] = new E('div', id); });
  const est = { email, loja: 'AHU', lojas: ['AHU', 'SÃO BRAZ'], prints: 0, cb: null };
  const ctx = {
    console, Blob, URL: { createObjectURL() { return 'blob:x'; }, revokeObjectURL() {} }, setTimeout() {},
    window: { addEventListener(n, f) { (events[n] = events[n] || []).push(f); }, print() { est.prints++; } },
    document: { getElementById: (id) => ids[id], createElement: (t) => new E(t), body: new E('body'), addEventListener() {}, hidden: false },
    location: { origin: 'https://exemplo.test', href: '', reload() {} }, NA_CASCA: casca,
    avisarCasca: (m) => { if (casca) messages.push(m); },      // fora da casca é noop, como no index real
    parent: { postMessage: (m) => messages.push(m) },
    rmbSessao: () => (est.email ? { email: est.email } : null), registrarUso() {}, trHoje: () => '2026-11-11',
    lojaCarregar: async () => { if (defer) await defer; return { lojas: est.lojas }; },
    lojaAtual: () => est.loja, lojaNome: (l) => l, lojaTravada: () => false,
    aoMudarLoja: (fn) => { est.cb = fn; }, LOJA_INFO: { lojas: est.lojas }
  };
  ctx.self = ctx.window;
  vm.createContext(ctx);
  ['reuniao-modelo.js', 'reuniao.js'].forEach((f) => vm.runInContext(fs.readFileSync(path.join(__dirname, f), 'utf8'), ctx, { filename: f }));
  const fire = (n) => (events[n] || []).forEach((f) => f({ key: 'rmbSessao' }));
  const campos = () => all.filter((e) => e.tagName === 'TEXTAREA' && e.parent && e.parent.tagName === 'LABEL');
  return { ctx, ids, est, messages, fire, campos, all,
    start() { ctx.window.ReuniaoTela.iniciar(); },
    setAta(v) { ids.ata.value = v; ids.ata.fire('input'); } };
}

test('1. conta A->B: bloqueio limpa ata, campos, participantes, pauta e impressão do DOM', async () => {
  const t = montar(); t.start(); await settle();
  t.setAta('SEGREDO-A');
  t.ids.novoPart.value = 'PESSOA-A'; t.ids.btnPart.click();
  const dec = t.campos()[0]; dec.value = 'DECISAO-A'; dec.fire('input');
  t.ids.btnImprimir.click();
  assert.match(t.ids.impressao.textContent, /SEGREDO-A/);
  t.ids.novoPart.value = 'RASCUNHO-NOVOPART';
  t.est.email = 'b@exemplo.test'; t.fire('storage');
  assert.equal(t.ids.app.hidden, true);
  assert.equal(t.ids.ata.value, ''); assert.equal(t.ids.novoPart.value, '');
  assert.equal(t.ids.ata.disabled, true);
  ['temas', 'participantes', 'impressao', 'limparBox'].forEach((id) => assert.equal(t.ids[id].textContent, '', id));
  // nada do que a conta A digitou sobra em qualquer elemento da página (campos escondidos incluídos)
  const vivos = Object.values(t.ids).map((e) => e.value + '/' + e.textContent).join('|');
  assert.ok(!/SEGREDO-A|DECISAO-A|PESSOA-A|RASCUNHO-NOVOPART/.test(vivos));
  assert.equal(t.est.prints, 1);
});

test('1b. logout também limpa o DOM', async () => {
  const t = montar(); t.start(); await settle();
  t.setAta('SEGREDO-A');
  t.est.email = null; t.fire('storage');
  assert.equal(t.ids.ata.value, ''); assert.equal(t.ids.app.hidden, true);
});

test('2. sem sessão FORA da casca vai ao login existente, sem mensagem ao pai; DENTRO da casca só avisa o pai', async () => {
  const fora = montar({ email: null }); fora.start(); await settle();
  assert.equal(fora.ids.app.hidden, true);
  assert.match(fora.ctx.location.href, /sistema\.html$/);
  assert.equal(fora.messages.length, 0);
  const dentro = montar({ email: null, casca: true }); dentro.start(); await settle();
  assert.equal(dentro.ctx.location.href, '');
  assert.ok(dentro.messages.some((m) => m.tipo === 'casca-login'));
  // logout no meio da sessão, fora da casca: redireciona uma única vez (revalidar repetido não reenvia)
  const meio = montar(); meio.start(); await settle();
  meio.est.email = null; meio.fire('storage');
  assert.match(meio.ctx.location.href, /sistema\.html$/);
  meio.ctx.location.href = 'MARCA'; meio.fire('storage'); meio.fire('focus');
  assert.equal(meio.ctx.location.href, 'MARCA');
});

test('3. formulário nasce fechado: nada é aceito antes da lista de lojas, e abre depois', async () => {
  let abrir; const p = new Promise((r) => { abrir = r; });
  const t = montar({ defer: p }); t.start();
  assert.equal(t.ids.app.hidden, true); assert.equal(t.ids.ata.disabled, true);
  t.setAta('ANTES');                        // evento prematuro não pode tocar rascunho nenhum
  t.ids.novoPart.value = 'X'; t.ids.btnPart.click(); t.ids.btnExportar.click(); t.ids.btnImprimir.click();
  t.ids.dia.value = '2026-11-18'; t.ids.dia.fire('change');
  assert.equal(t.est.prints, 0);
  abrir(); await settle();
  assert.equal(t.ids.app.hidden, false); assert.equal(t.ids.ata.disabled, false);
  assert.equal(t.ids.ata.value, ''); assert.equal(t.ids.participantes.children.length, 0);
  assert.equal(t.ids.dia.value, '2026-11-11');
});

test('3b. sessão que cai durante o carregamento das lojas deixa a tela travada', async () => {
  let abrir; const p = new Promise((r) => { abrir = r; });
  const t = montar({ defer: p }); t.start();
  t.est.email = null; abrir(); await settle();
  assert.equal(t.ids.app.hidden, true); assert.equal(t.ids.ata.disabled, true);
});

test('3c. troca A->B durante o carregamento das lojas: tela travada com aviso e botão de recarregar', async () => {
  let abrir; const p = new Promise((r) => { abrir = r; });
  const t = montar({ defer: p }); t.start();
  t.est.email = 'b@exemplo.test'; abrir(); await settle();
  assert.equal(t.ids.app.hidden, true); assert.equal(t.ids.ata.disabled, true);
  assert.equal(t.ids.bloqueio.hidden, false);
  assert.match(t.ids.bloqueio.textContent, /mudou para outro usuário/);
  assert.match(t.ids.bloqueio.textContent, /Recarregar/);
});

test('4. impressão: some ao mudar loja/dia e ao editar; beforeprint gera só o contexto atual; afterprint limpa', async () => {
  const t = montar(); t.start(); await settle();
  t.setAta('IMP-ANTIGA'); t.ids.btnImprimir.click();
  assert.match(t.ids.impressao.textContent, /IMP-ANTIGA/);
  t.est.loja = 'SÃO BRAZ'; t.est.cb('SÃO BRAZ');
  assert.equal(t.ids.impressao.textContent, '');
  t.setAta('SB'); t.ids.btnImprimir.click();
  t.setAta('SB-EDITADA');                      // editar invalida o bloco já montado
  assert.equal(t.ids.impressao.textContent, '');
  t.ids.dia.value = '2026-11-18'; t.ids.dia.fire('change');
  assert.equal(t.ids.impressao.textContent, '');
  // Ctrl+P (sem clique): beforeprint monta o contexto atual (novo dia, vazio), sem chamar print()
  const antes = t.est.prints;
  t.fire('beforeprint');
  assert.ok(!/IMP-ANTIGA|SB-EDITADA/.test(t.ids.impressao.textContent));
  assert.match(t.ids.impressao.textContent, /18\/11\/2026/);
  t.fire('afterprint');
  assert.equal(t.ids.impressao.textContent, '');
  assert.equal(t.est.prints, antes);
});
