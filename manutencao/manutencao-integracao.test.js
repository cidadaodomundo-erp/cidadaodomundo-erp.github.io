/* Integração de Manutenção e Quem conserta com a casca (menu/páginas/módulos/busca) + guardas de fonte.
 * Node stdlib: node --test manutencao/ . Só lê arquivos do repo; sem rede. */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const RAIZ = path.join(__dirname, '..');
const ler = (...p) => fs.readFileSync(path.join(RAIZ, ...p), 'utf8');

function carregarCasca() {
  const ctx = { window: {} };
  ctx.window = ctx;
  vm.createContext(ctx);
  ['menu.js', 'paginas.js', 'modulos.js', 'busca.js'].forEach((f) => vm.runInContext(ler('casca', f), ctx, { filename: f }));
  const copia = {};
  ['CASCA_MENU', 'CASCA_PAGINAS', 'CASCA_MODULOS', 'CASCA_BUSCA', 'CASCA_TELAS_POR_LOJA', 'CASCA_TELAS_SEM_LOJA']
    .forEach((k) => { copia[k] = JSON.parse(JSON.stringify(ctx[k])); });
  return copia;
}
const C = carregarCasca();
const itensMenu = C.CASCA_MENU.flatMap((g) => g.itens);
function preservaOriginais(atual, originais, nome) {
  originais.forEach((k) => assert.ok(atual.includes(k), nome + ': falta o item original ' + k));
  assert.deepEqual(atual.filter((k) => originais.includes(k)), originais, nome + ': item original removido ou reordenado');
}

test('rotas: Manutenção e Quem conserta, um item cada (origem fabio), duas rotas casca na MESMA página, no módulo Compras', () => {
  const m = itensMenu.filter((i) => i.chave === 'manutencao'), p = itensMenu.filter((i) => i.chave === 'prestadores');
  assert.equal(m.length, 1); assert.equal(p.length, 1);
  assert.equal(m[0].rotulo, 'Manutenção'); assert.equal(p[0].rotulo, 'Quem conserta');
  assert.equal(m[0].origem, 'fabio'); assert.equal(p[0].origem, 'fabio');
  assert.match(C.CASCA_PAGINAS.manutencao, /^manutencao\/index\.html(\?v=\d{8}[a-z])?#chamados$/);
  assert.match(C.CASCA_PAGINAS.prestadores, /^manutencao\/index\.html(\?v=\d{8}[a-z])?#prestadores$/);
  assert.ok(fs.existsSync(path.join(RAIZ, 'manutencao', 'index.html')));
  ['manutencao', 'prestadores'].forEach((k) => assert.deepEqual(C.CASCA_MODULOS.filter((x) => [...x.lancar, ...x.acompanhar].includes(k)).map((x) => x.id), ['compras'], k));
  const termos = (k) => C.CASCA_BUSCA[k] || [];
  ['manutencao', 'chamado', 'conserto'].forEach((t) => assert.ok(termos('manutencao').includes(t), t));
  ['quem conserta', 'prestador'].forEach((t) => assert.ok(termos('prestadores').includes(t), t));
});

test('prestadores é SEM_LOJA (diretório geral); manutencao é POR_LOJA; nenhum dos dois nos dois', () => {
  assert.ok(C.CASCA_TELAS_SEM_LOJA.includes('prestadores')); assert.ok(!C.CASCA_TELAS_POR_LOJA.includes('prestadores'));
  assert.ok(C.CASCA_TELAS_POR_LOJA.includes('manutencao')); assert.ok(!C.CASCA_TELAS_SEM_LOJA.includes('manutencao'));
  assert.equal(C.CASCA_TELAS_POR_LOJA.filter((k) => k === 'manutencao').length, 1);
});

test('módulos e telas vizinhos continuam como estavam (Compras, Pessoas/Freelas, Reunião, Delivery, Fabio)', () => {
  const mod = (id) => C.CASCA_MODULOS.find((m) => m.id === id);
  preservaOriginais(mod('compras').acompanhar, ['comprateto'], 'Compras');
  preservaOriginais(mod('pessoas').lancar, ['phoje', 'pcartao', 'peventos', 'pcalc', 'rh', 'penvio', 'pconf', 'padm', 'pferias', 'presc', 'cargos', 'pacertos', 'freelas'], 'Pessoas');
  preservaOriginais(mod('fabio').acompanhar, ['delivery', 'reservas', 'pausados', 'atrasos', 'atendimento', 'link:portal-qualidade'], 'Operação do Fabio');
  preservaOriginais(mod('resultado').acompanhar, ['placar', 'semana', 'reuniao', 'dre', 'indicadores', 'evolucao', 'lucrouni', 'despesas'], 'Resultado');
  ['freelas', 'reuniao', 'delivery', 'reservas', 'pausados'].forEach((k) => assert.ok(C.CASCA_TELAS_POR_LOJA.includes(k), k));
  assert.match(C.CASCA_PAGINAS.freelas, /^freelas\/index\.html/); assert.match(C.CASCA_PAGINAS.reuniao, /^reuniao\/index\.html/);
  const grupo = C.CASCA_MENU.find((g) => g.itens.some((i) => i.chave === 'comprateto'));
  preservaOriginais(grupo.itens.map((i) => i.chave), ['contagem', 'controle', 'posicao', 'comprateto', 'listas', 'listasfin'], 'menu do grupo');
});

test('sistema.html: só os quatro carimbos de versão mudaram (cada script uma vez, YYYYMMDD+letra); sem lógica de manutenção', () => {
  const html = ler('sistema.html');
  ['menu', 'paginas', 'modulos', 'busca'].forEach((n) => {
    const achados = html.match(new RegExp('casca/' + n + '\\.js\\?v=[^"]*"', 'g')) || [];
    assert.equal(achados.length, 1, n);
    assert.match(/\?v=([^"]*)"/.exec(achados[0])[1], /^\d{8}[a-z]$/, n);
  });
  assert.ok(!/manutencao|prestador/i.test(html), 'sistema.html não ganhou lógica de manutenção');
});

test('index.html: chamados só preparados e desabilitados, sem Salvar habilitado, scripts na ordem, sem links de contato nem handlers inline', () => {
  const html = ler('manutencao', 'index.html');
  const ordem = ['nucleo/nucleo.js', 'nucleo/loja.js', 'manutencao-modelo.js', 'manutencao-dados.js', 'manutencao.js'].map((s) => html.indexOf(s));
  assert.ok(ordem.every((n) => n > 0) && ordem.every((n, i) => i === 0 || n > ordem[i - 1]));
  assert.ok(!/\son(click|load|error|input|change)\s*=/i.test(html));
  assert.ok(!/service_?role|eyJ[A-Za-z0-9_-]{20,}|apikey|supabase\.co|Authorization/i.test(html));
  assert.ok(!/<a\s|href="(tel|https?|whatsapp|mailto)/i.test(html.replace(/<link[^>]*>/g, '')));
  assert.match(html, /<div id="app" hidden>/);
  assert.match(html, /Em construção\.<\/strong> A abertura e o acompanhamento de chamados ainda não estão ligados\. Nada é enviado ou salvo aqui\./);
  assert.match(html, /Os campos estão preparados para a próxima etapa/);
  assert.match(html, /<fieldset class="mn-form" disabled>/);
  const form = /<fieldset class="mn-form" disabled>[\s\S]*?<\/fieldset>/.exec(html)[0];
  ['Loja', 'Equipamento/local', 'Problema', 'Prioridade', 'Responsável', 'Prazo', 'Situação'].forEach((c) => assert.ok(form.includes('>' + c + '<'), c));
  assert.ok(!/<form/i.test(html));
  assert.ok(!/type="submit"/i.test(html));
  for (const campo of form.match(/<(input|select|textarea|button)\b[^>]*>/g)) assert.match(campo, /\bdisabled\b/, campo);
  assert.match(html, /Diretório geral\.<\/strong> Este cadastro não tem loja/);
  ['abaChamados', 'abaPrestadores', 'btnAtualizar', 'btnQuemConserta', 'buscaTexto', 'filtroSetor'].forEach((id) => assert.match(html, new RegExp('id="' + id + '"')));
  const refs = [...html.matchAll(/(?:src|href)="([^"?#]+)(?:\?[^"]*)?"/g)].map((m) => m[1]).filter((r) => !/^https?:/.test(r));
  refs.forEach((r) => assert.ok(fs.existsSync(path.join(RAIZ, 'manutencao', r)), r));
});

for (const arq of ['manutencao.js', 'manutencao-modelo.js', 'manutencao-dados.js']) {
  test('guarda de fonte ' + arq + ': só GET, sem escrita, sem persistência, sem timer, sem innerHTML, sem log, sem contato externo', () => {
    const src = ler('manutencao', arq).replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '').replace(/\s\/\/ .*$/gm, '');
    [/localStorage\s*\.\s*(set|get)Item/, /sessionStorage/, /indexedDB/, /XMLHttpRequest/, /sendBeacon/, /WebSocket/, /EventSource/,
      /\.innerHTML/, /insertAdjacentHTML/, /document\.write/, /\beval\s*\(/, /new Function/, /setInterval/, /setTimeout/, /requestAnimationFrame/,
      /service_?role/i, /Authorization/, /apikey/i, /access_token|refresh_token/, /eyJ[A-Za-z0-9_-]{20,}/, /supabase\.co/,
      /method\s*:\s*['"](POST|PUT|PATCH|DELETE)/i, /\brpc\//, /registrarUso/, /javascript:/i, /\.onclick\s*=/, /wa\.me|whatsapp/i, /\btel:/i, /mailto:/i,
      /window\.open|\.href\s*=\s*['"](?!\.\.\/sistema\.html)/, /\.print\s*\(/, /createObjectURL|\.download\b/, /console\./, /fetch\s*\(/,
      /o_que_faz|numero_com|ultima_vez|criado_em|prestador_servico|chamado_/].forEach((re) => assert.ok(!re.test(src), String(re) + ' em ' + arq));
  });
}

test('manutencao.js: único acesso à sessão é o e-mail; remoção do login só no 401 e só da conta que leu; só navega ao login', () => {
  const src = ler('manutencao', 'manutencao.js');
  assert.equal((src.match(/localStorage\.removeItem\('rmbSessao'\)/g) || []).length, 1);
  assert.equal((src.match(/rmbSessao\(\)/g) || []).length, 1);
  const sessao = /function sessaoRecusada\(ident\) \{[\s\S]*?\n  \}\n/.exec(src)[0];
  assert.ok(sessao.indexOf('emailAtual() !== ident') < sessao.indexOf('removeItem'));
  assert.deepEqual([...src.matchAll(/location\.href\s*=\s*([^;]+);/g)].map((m) => m[1]), ["'../sistema.html'"]);
});

test('manutencao-dados.js: só a tabela prestador (nada financeiro, nada de outras tabelas); modelo só com as colunas permitidas', () => {
  const dados = ler('manutencao', 'manutencao-dados.js');
  assert.deepEqual([...dados.matchAll(/TABELA\s*=\s*'([^']+)'/g)].map((m) => m[1]), ['prestador']);
  assert.ok(!/prestador_servico|pagamento|folha|financeiro/i.test(dados + ler('manutencao', 'manutencao-modelo.js') + ler('manutencao', 'manutencao.js')));
  assert.deepEqual(require('./manutencao-modelo.js').CAMPOS_PRESTADOR, ['id', 'setor', 'nome', 'telefone', 'ativo']);
});

test('o portal não carrega manifesto, regras internas, caderno, memória nem credenciais', () => {
  ['index.html', 'manutencao.js', 'manutencao-modelo.js', 'manutencao-dados.js', 'manutencao.css'].forEach((arq) => {
    const src = ler('manutencao', arq);
    assert.ok(!/MANIFESTO|NOVO_ERP|kqvoatdprjwxyadhvtdd|rtmgzsikwglsvpopbfbw|codex|coordenador|supervisor independente|caderno|memória pessoal/i.test(src), arq);
  });
});

