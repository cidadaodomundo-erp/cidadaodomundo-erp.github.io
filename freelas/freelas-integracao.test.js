/* Integração de Taxas e Freelas com a casca (menu/páginas/módulos/busca) + guardas de fonte.
 * Node stdlib: node --test freelas/ . Só lê arquivos do repo; sem rede. */
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

// Módulo vizinho: todos os itens originais continuam presentes e na mesma ordem relativa. Itens novos são tolerados.
// Remoção ou reordenação de um item original quebra o teste.
function preservaOriginais(atual, originais, nome) {
  originais.forEach((k) => assert.ok(atual.includes(k), nome + ': falta o item original ' + k));
  assert.deepEqual(atual.filter((k) => originais.includes(k)), originais, nome + ': item original removido ou reordenado');
}
// Scripts da casca no sistema.html: cada um aparece uma única vez, com versão YYYYMMDD+letra (sem fixar o valor).
function versoesCasca(html) {
  ['menu', 'paginas', 'modulos', 'busca'].forEach((n) => {
    const achados = html.match(new RegExp('casca/' + n + '\\.js\\?v=[^"]*"', 'g')) || [];
    assert.equal(achados.length, 1, n + ': carregado uma única vez');
    assert.match(/\?v=([^"]*)"/.exec(achados[0])[1], /^\d{8}[a-z]$/, n + ': versão no formato YYYYMMDD+letra');
  });
}

test('rota completa: UM item de menu (Taxas e Freelas, origem fabio), página, módulo e busca com a chave freelas', () => {
  const doMenu = itensMenu.filter((i) => i.chave === 'freelas');
  assert.equal(doMenu.length, 1);
  assert.equal(doMenu[0].rotulo, 'Taxas e Freelas');
  assert.equal(doMenu[0].origem, 'fabio');
  assert.match(C.CASCA_PAGINAS.freelas, /^freelas\/index\.html(\?v=\w+)?$/);
  assert.ok(fs.existsSync(path.join(RAIZ, 'freelas', 'index.html')));
  assert.deepEqual(C.CASCA_MODULOS.filter((m) => [...m.lancar, ...m.acompanhar].includes('freelas')).map((m) => m.id), ['pessoas']);
  const grupo = C.CASCA_MENU.find((g) => g.itens.some((i) => i.chave === 'freelas'));
  assert.equal(grupo.id, 'gRh'); assert.equal(grupo.nome, 'Pessoas');
  const termos = C.CASCA_BUSCA.freelas;
  ['ponto freela', 'taxa', 'valor-hora', 'valor hora', 'freela'].forEach((t) => assert.ok(termos.includes(t), t));
});

test('entra no grupo RH/Pessoas sem remover nem reordenar os itens originais (novos itens tolerados)', () => {
  const rh = C.CASCA_MENU.find((g) => g.id === 'gRh').itens.map((i) => i.chave);
  preservaOriginais(rh, ['phoje', 'pcartao', 'pao', 'peventos', 'pcalc', 'rh', 'penvio', 'pconf', 'padm', 'pferias', 'presc', 'cargos'], 'Pessoas (menu)');
  const pessoas = C.CASCA_MODULOS.find((m) => m.id === 'pessoas');
  preservaOriginais(pessoas.lancar, ['phoje', 'pcartao', 'pao', 'peventos', 'pcalc', 'rh', 'penvio', 'pconf', 'padm', 'pferias', 'presc', 'cargos', 'pacertos'], 'Pessoas (módulo)');
  assert.ok(!pessoas.acompanhar.includes('freelas'));
  // os itens vizinhos (RH do Neto) continuam como estavam
  ['pcartao', 'pao', 'peventos'].forEach((k) => assert.equal(itensMenu.find((i) => i.chave === k).origem, 'fabio'));
});

test('módulos e telas vizinhos (Reunião, Delivery, Agora, Resultado, Fabio) mantêm os itens originais; a tela está em POR_LOJA e não em SEM_LOJA', () => {
  assert.equal(C.CASCA_TELAS_POR_LOJA.filter((k) => k === 'freelas').length, 1);
  assert.ok(!C.CASCA_TELAS_SEM_LOJA.includes('freelas'));
  ['reuniao', 'delivery', 'reservas', 'pausados'].forEach((k) => assert.ok(C.CASCA_TELAS_POR_LOJA.includes(k), k));
  assert.match(C.CASCA_PAGINAS.reuniao, /^reuniao\/index\.html(\?v=\w+)?$/);
  assert.match(C.CASCA_PAGINAS.delivery, /^delivery\/index\.html(\?v=\w+)?$/);
  const mod = (id) => C.CASCA_MODULOS.find((m) => m.id === id);
  preservaOriginais(mod('agora').acompanhar, ['hoje', 'agenda', 'plano', 'vendasagora', 'atividades'], 'Agora');
  preservaOriginais(mod('resultado').acompanhar, ['placar', 'semana', 'reuniao', 'dre', 'indicadores', 'evolucao', 'lucrouni', 'despesas'], 'Resultado');
  preservaOriginais(mod('fabio').acompanhar, ['delivery', 'reservas', 'pausados', 'atrasos', 'atendimento', 'link:portal-qualidade'], 'Operação do Fabio');
});

test('não confunde com motoboys nem com as taxas da maquininha: chaves e telas existentes ficam como estão', () => {
  assert.equal(itensMenu.find((i) => i.chave === 'rede').rotulo, 'Taxas da maquininha');
  assert.equal(C.CASCA_PAGINAS.rede, 'gestao/index.html#rede');
  assert.equal(C.CASCA_PAGINAS.macertos, 'pessoas/index.html#macertos');
  assert.ok(!(C.CASCA_BUSCA.freelas || []).some((t) => /maquininha|cartao|motoboy|entregador/.test(t)));
  assert.ok(!(C.CASCA_BUSCA.rede || []).includes('freela'));
});

test('sistema.html carrega cada um dos quatro scripts da casca uma única vez, com versão YYYYMMDD+letra (sem fixar o valor)', () => {
  const html = ler('sistema.html');
  versoesCasca(html);
  assert.match(html, /casca\/modulos-proposta\.js\?v=[^"]+"/);           // o script de proposta continua carregado
  assert.ok(!/freelas/i.test(html.replace(/casca\/[a-z-]+\.js\?v=\w+/g, '')), 'sistema.html não ganhou lógica de freelas');
});

test('index.html: exige sessão existente, sem chave/JWT/endereço, scripts do núcleo na ordem, sem handlers inline', () => {
  const html = ler('freelas', 'index.html');
  const ordem = ['nucleo/nucleo.js', 'nucleo/loja.js', 'freelas-modelo.js', 'freelas-dados.js', 'freelas.js'].map((s) => html.indexOf(s));
  assert.ok(ordem.every((n) => n > 0) && ordem.every((n, i) => i === 0 || n > ordem[i - 1]));
  assert.ok(!/\son(click|load|error|input|change)\s*=/i.test(html));
  assert.ok(!/service_?role|eyJ[A-Za-z0-9_-]{20,}|apikey|supabase\.co|Authorization/i.test(html));
  assert.ok(!/<a\s|href="(tel|https?|whatsapp|mailto)/i.test(html.replace(/<link[^>]*>/g, '')), 'nenhum link de contato/ação');
  assert.match(html, /<div id="app" hidden>/, 'formulário nasce oculto');
  assert.match(html, /Em construção/);
  assert.match(html, /Só consulta/);
  ['abaContatos', 'abaValores', 'btnAtualizar', 'buscaTexto', 'filtroSetor'].forEach((id) => assert.match(html, new RegExp('id="' + id + '"')));
  // todo caminho referenciado existe
  const refs = [...html.matchAll(/(?:src|href)="([^"?#]+)(?:\?[^"]*)?"/g)].map((m) => m[1]).filter((r) => !/^https?:/.test(r));
  refs.forEach((r) => assert.ok(fs.existsSync(path.join(RAIZ, 'freelas', r)), r));
  // versões dos scripts do index.html acompanham a da página (cache)
  assert.match(C.CASCA_PAGINAS.freelas, /^freelas\/index\.html\?v=\d{8}[a-z]$/);
});

for (const arq of ['freelas.js', 'freelas-modelo.js', 'freelas-dados.js']) {
  test('guarda de fonte ' + arq + ': leitura GET, sem escrita, sem persistência, sem timer, sem innerHTML nem execução dinâmica', () => {
    const src = ler('freelas', arq).replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '').replace(/\s\/\/ .*$/gm, '');
    [/localStorage\s*\.\s*(set|get)Item/, /sessionStorage/, /indexedDB/, /XMLHttpRequest/, /sendBeacon/, /WebSocket/, /EventSource/,
      /\.innerHTML/, /insertAdjacentHTML/, /document\.write/, /\beval\s*\(/, /new Function/, /setInterval/, /setTimeout/, /requestAnimationFrame/,
      /service_?role/i, /Authorization/, /apikey/i, /access_token|refresh_token/, /eyJ[A-Za-z0-9_-]{20,}/, /supabase\.co/,
      /method\s*:\s*['"](POST|PUT|PATCH|DELETE)/i, /\brpc\//, /javascript:/i, /\.onclick\s*=/, /wa\.me|whatsapp|api\.whatsapp/i, /\btel:/i, /mailto:/i,
      /window\.open|\.href\s*=\s*['"](?!\.\.\/sistema\.html)/, /\.print\s*\(/, /createObjectURL|\.download\b/,
      /o_que_quer|telefone2|primeiro_contato|destaque|criado_em/, /fetch\s*\(/]
      .forEach((re) => assert.ok(!re.test(src), String(re) + ' em ' + arq));
  });
}

test('freelas.js: único acesso à sessão é o e-mail; remoção do login só no 401 e só da conta que leu', () => {
  const src = ler('freelas', 'freelas.js');
  assert.equal((src.match(/localStorage\.removeItem\('rmbSessao'\)/g) || []).length, 1);
  assert.equal((src.match(/rmbSessao\(\)/g) || []).length, 1);                    // só em emailAtual()
  const sessao = /function sessaoRecusada\(ident\) \{[\s\S]*?\n  \}\n/.exec(src)[0];
  assert.match(sessao, /emailAtual\(\) !== ident/);
  assert.ok(sessao.indexOf('emailAtual() !== ident') < sessao.indexOf('removeItem'));
  // a única navegação é ao login existente
  assert.deepEqual([...src.matchAll(/location\.href\s*=\s*([^;]+);/g)].map((m) => m[1]), ["'../sistema.html'"]);
});

test('freelas-dados.js: só as duas tabelas de freela, nenhuma outra fonte; só colunas da lista permitida', () => {
  const src = ler('freelas', 'freelas-dados.js') + ler('freelas', 'freelas-modelo.js');
  const tabelas = new Set(src.match(/\bfreela_[a-z_]+/g));
  assert.deepEqual([...tabelas].sort(), ['freela_contato', 'freela_valor_hora']);
  const M = require('./freelas-modelo.js');
  assert.deepEqual(M.CAMPOS_CONTATO, ['id', 'nome', 'setor', 'telefone', 'tipo', 'ativo', 'loja']);
  assert.deepEqual(M.CAMPOS_VALOR, ['loja', 'valor_hora', 'atualizado_em']);
  assert.ok(!/\b(folha|pagamento|ponto|escala_freela|qr_)\w*\?/.test(ler('freelas', 'freelas-dados.js')));
});

test('o portal não carrega manifesto, regras internas, caderno, memória nem credenciais', () => {
  ['index.html', 'freelas.js', 'freelas-modelo.js', 'freelas-dados.js', 'freelas.css'].forEach((arq) => {
    const src = ler('freelas', arq);
    assert.ok(!/MANIFESTO|NOVO_ERP|kqvoatdprjwxyadhvtdd|rtmgzsikwglsvpopbfbw|codex|coordenador|supervisor independente|caderno|memória pessoal/i.test(src), arq);
  });
});
