/* Integração da Reunião semanal com a casca (menu/páginas/módulos/busca) + guardas de fonte.
 * Node stdlib: node --test reuniao/ . Só lê arquivos do repo; sem rede. */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const M = require('./reuniao-modelo.js');

const RAIZ = path.join(__dirname, '..');
const ler = (...p) => fs.readFileSync(path.join(RAIZ, ...p), 'utf8');

function carregarCasca() {
  const ctx = { window: {} };
  ctx.window = ctx;
  vm.createContext(ctx);
  ['menu.js', 'paginas.js', 'modulos.js', 'busca.js'].forEach((f) => vm.runInContext(ler('casca', f), ctx, { filename: f }));
  // cópia no realm atual: deepEqual estrito compara protótipos e o vm tem Array/Object próprios
  const copia = {};
  ['CASCA_MENU', 'CASCA_PAGINAS', 'CASCA_MODULOS', 'CASCA_BUSCA', 'CASCA_TELAS_POR_LOJA']
    .forEach((k) => { copia[k] = JSON.parse(JSON.stringify(ctx[k])); });
  return copia;
}
const C = carregarCasca();
const itensMenu = C.CASCA_MENU.flatMap((g) => g.itens);

test('rota completa: UM item de menu, página, módulo e busca com a chave reuniao', () => {
  const doMenu = itensMenu.filter((i) => i.chave === 'reuniao');
  assert.equal(doMenu.length, 1);
  assert.equal(doMenu[0].rotulo, 'Reunião semanal');
  assert.equal(doMenu[0].origem, 'fabio');
  assert.match(C.CASCA_PAGINAS.reuniao, /^reuniao\/index\.html(\?v=\w+)?$/);
  assert.ok(fs.existsSync(path.join(RAIZ, 'reuniao', 'index.html')));
  const modulos = C.CASCA_MODULOS.filter((m) => [...m.lancar, ...m.acompanhar].includes('reuniao'));
  assert.deepEqual(modulos.map((m) => m.id), ['resultado']);
  const termos = C.CASCA_BUSCA.reuniao;
  ['reuniao', 'pauta', 'ata', 'decisoes'].forEach((t) => assert.ok(termos.includes(t), t));
});

test('fica adjacente a A semana e não reordena os itens existentes do módulo Resultado', () => {
  const res = C.CASCA_MODULOS.find((m) => m.id === 'resultado').acompanhar;
  assert.equal(res.indexOf('reuniao'), res.indexOf('semana') + 1);
  assert.deepEqual(res.filter((k) => k !== 'reuniao'), ['placar', 'semana', 'dre', 'indicadores', 'evolucao', 'lucrouni', 'despesas']);
});

test('não altera outros módulos; a tela está em POR_LOJA (separa o rascunho pela loja do seletor)', () => {
  assert.equal(C.CASCA_TELAS_POR_LOJA.filter((k) => k === 'reuniao').length, 1);
  const agora = C.CASCA_MODULOS.find((m) => m.id === 'agora');
  assert.deepEqual(agora.acompanhar, ['hoje', 'agenda', 'plano', 'vendasagora', 'atividades']);
  const fabio = C.CASCA_MODULOS.find((m) => m.id === 'fabio');
  assert.deepEqual(fabio.acompanhar, ['delivery', 'reservas', 'pausados', 'atrasos', 'atendimento', 'link:portal-qualidade']);
});

test('atalhos "Ver ..." apontam para rotas exatas que já existem na casca', () => {
  M.DESTINOS.forEach((d) => {
    assert.ok(itensMenu.some((i) => i.chave === d.chave), 'item de menu ' + d.chave);
    assert.equal(String(C.CASCA_PAGINAS[d.chave]).split('?')[0], d.pagina, 'rota de ' + d.chave);
    assert.ok(fs.existsSync(path.join(RAIZ, d.pagina.split('#')[0])), 'arquivo de ' + d.chave);
  });
});

test('sistema.html carimba só os quatro scripts da casca com a mesma versão nova', () => {
  const html = ler('sistema.html');
  const versao = { menu: '20261111c', paginas: '20261111d', modulos: '20261111c', busca: '20261111c' };
  Object.keys(versao).forEach((n) => assert.match(html, new RegExp('casca/' + n + '\\.js\\?v=' + versao[n] + '"')));
});

test('index.html: exige sessão existente, sem chave/JWT/prompt, scripts do núcleo na ordem, sem handlers inline', () => {
  const html = ler('reuniao', 'index.html');
  const ordem = ['nucleo/nucleo.js', 'nucleo/loja.js', 'reuniao-modelo.js', 'reuniao.js'].map((s) => html.indexOf(s));
  assert.ok(ordem.every((n) => n > 0) && ordem.every((n, i) => i === 0 || n > ordem[i - 1]));
  assert.ok(!/\son(click|load|error|input|change)\s*=/i.test(html));
  assert.ok(!/service_?role|eyJ[A-Za-z0-9_-]{20,}|apikey|supabase\.co/i.test(html));
  assert.match(html, /<div id="app" hidden>/, 'formulário nasce oculto');
  assert.match(html, /<textarea id="ata" disabled/, 'campo nasce desabilitado');
  assert.match(html, /Em construção/);
  assert.match(html, /Pauta temporária nesta aba/);
  assert.match(html, /não é compartilhada nem salva|nem salva no sistema/);
});

for (const arq of ['reuniao.js', 'reuniao-modelo.js']) {
  test('guarda de fonte ' + arq + ': sem persistência, rede, timer de rede, innerHTML nem execução dinâmica', () => {
    const src = ler('reuniao', arq).replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    [/localStorage\s*\.\s*(set|remove)Item/, /sessionStorage/, /indexedDB/, /\bfetch\s*\(/, /XMLHttpRequest/, /sendBeacon/,
      /\.innerHTML/, /insertAdjacentHTML/, /document\.write/, /\beval\s*\(/, /new Function/, /setInterval/, /service_?role/i, /Authorization/,
      /javascript:/i, /\.onclick\s*=/, /\bon(click|load)\s*=/]
      .forEach((re) => assert.ok(!re.test(src), String(re) + ' em ' + arq));
  });
}

test('reuniao.js: download só dentro do handler de clique, com revogação; impressão só dentro do handler', () => {
  const src = ler('reuniao', 'reuniao.js');
  const exp = /function exportar\(\) \{[\s\S]*?\n  \}\n/.exec(src)[0];
  assert.match(exp, /createObjectURL/);
  assert.match(exp, /revokeObjectURL/);
  assert.match(exp, /text\/plain/);
  assert.equal((src.match(/createObjectURL/g) || []).length, 1);
  assert.match(src, /btnExportar'\)\.addEventListener\('click', exportar\)/);
  assert.equal((src.match(/window\.print\(\)/g) || []).length, 1);
  assert.match(src, /btnImprimir'\)\.addEventListener\('click', imprimir\)/);
  assert.ok(!/(^|\n)\s*(exportar|imprimir)\(\);/.test(src), 'nenhuma chamada automática');
  // atalhos: abrem em nova aba com noopener; dentro da casca só postMessage de mesma origem
  assert.match(src, /a\.rel = 'noopener noreferrer'/);
  assert.match(src, /postMessage\(\{ tipo: 'casca-modulo', nome: d\.chave \}, location\.origin\)/);
});
