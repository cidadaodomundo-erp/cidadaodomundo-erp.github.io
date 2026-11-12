/* Ligação da rota pao (Ponto ao Vivo): ordem de carga dos scripts e registro na casca. Node stdlib: node --test pessoas/ . Sem rede. */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const RAIZ = path.join(__dirname, '..');
const ler = (...p) => fs.readFileSync(path.join(RAIZ, ...p), 'utf8');

test('pessoas/index.html carrega as dependências do Ponto ao Vivo na ordem certa', () => {
  const html = ler('pessoas', 'index.html');
  const pos = (f) => { const i = html.search(new RegExp('<script src="' + f.replace('.', '\\.') + '[?"]')); assert.ok(i >= 0, 'falta ' + f); return i; };
  assert.ok(pos('pessoas.js') < pos('ponto-cartao-modelo.js'));
  assert.ok(pos('ponto-cartao-modelo.js') < pos('ponto-ao-vivo-modelo.js'));
  assert.ok(pos('ponto-ao-vivo-modelo.js') < pos('ponto-ao-vivo.js'));
  assert.match(html, /<link rel="stylesheet" href="ponto-ao-vivo\.css/);
  assert.match(html, /id="modulo-pao"[^>]*><div id="view-pao">/);
  assert.match(html, /pao:\s*entrarPesPontoAoVivo,\s/);
});

test('rota pao registrada na casca (menu, página, módulo, busca, por loja) com selo Fábio', () => {
  const ctx = { window: {} }; ctx.window = ctx; vm.createContext(ctx);
  ['menu.js', 'paginas.js', 'modulos.js', 'busca.js'].forEach((f) => vm.runInContext(ler('casca', f), ctx, { filename: f }));
  const g = (k) => JSON.parse(JSON.stringify(ctx[k]));
  const itens = g('CASCA_MENU').flatMap((x) => x.itens).filter((i) => i.chave === 'pao');
  assert.equal(itens.length, 1);
  assert.equal(itens[0].origem, 'fabio');
  assert.equal(g('CASCA_PAGINAS').pao, 'pessoas/index.html#pao');
  assert.ok(g('CASCA_TELAS_POR_LOJA').includes('pao'));
  assert.ok(g('CASCA_BUSCA').pao.length > 0);
  // ordem expressa 12/11: fora do módulo Pessoas e de qualquer módulo fixo; cai no agrupamento de sobra (sistema.html)
  const mods = g('CASCA_MODULOS');
  assert.ok(!mods.some((m) => (m.lancar || []).includes('pao') || (m.acompanhar || []).includes('pao')));
  const sis = ler('sistema.html');
  assert.match(sis, /nome: 'Sistema operacional do Fábio'/);
  assert.doesNotMatch(sis, /nome: 'Outras telas'/);
});


