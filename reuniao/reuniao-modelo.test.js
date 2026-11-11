/* Testes do modelo da Reunião semanal. Node stdlib: node --test reuniao/ */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const M = require('./reuniao-modelo.js');

// ---- fixtures (nada de dado real: e-mails e lojas fictícios) ----
const A_MAIL = 'pessoa.a@exemplo.test';
const B_MAIL = 'pessoa.b@exemplo.test';
const LOJAS_REDE = ['REDE', 'AGUA VERDE', 'AHU', 'SÃO BRAZ'];
const DIA1 = '2026-11-11';
const DIA2 = '2026-11-18';
const XSS = '<img src=x onerror=alert(1)>"\'&<script>x</script>';

function armazem(email, lojas) {
  const a = M.criarArmazem();
  a.sincronizarIdentidade(email);
  a.definirLojas(lojas || LOJAS_REDE);
  return a;
}

test('pauta inicial: só tópicos estruturais genéricos, decisão/responsável/prazo vazios, sem histórico', () => {
  const a = armazem(A_MAIL);
  const r = a.obter(DIA1, 'REDE');
  assert.deepEqual(r.temas.map((t) => t.tema), ['Vendas/Pedidos', 'Delivery/Qualidade', 'Equipe/escala', 'Compras/Manutenção']);
  r.temas.forEach((t) => { assert.equal(t.decisao, ''); assert.equal(t.responsavel, ''); assert.equal(t.prazo, ''); });
  assert.deepEqual(r.participantes, []);
  assert.equal(r.ata, '');
  assert.equal(M.rascunhoEditado(r), false);
  assert.equal(a.temConteudo(), false);
});

test('rascunhos de dia e loja diferentes não se misturam', () => {
  const a = armazem(A_MAIL);
  M.definirAta(a.obter(DIA1, 'AHU'), 'nota do Ahú dia 1');
  M.adicionarParticipante(a.obter(DIA1, 'AHU'), 'Ana');
  assert.equal(a.obter(DIA1, 'AGUA VERDE').ata, '');
  assert.equal(a.obter(DIA2, 'AHU').ata, '');
  assert.deepEqual(a.obter(DIA2, 'AHU').participantes, []);
  // voltar ao primeiro contexto retoma o respectivo rascunho
  assert.equal(a.obter(DIA1, 'AHU').ata, 'nota do Ahú dia 1');
  assert.equal(a.tamanho(), 3);
});

test('não vaza outra loja: loja fora da allowlist é recusada e rascunho de loja removida é descartado', () => {
  const a = armazem(A_MAIL, ['AHU']);
  assert.throws(() => a.obter(DIA1, 'AGUA VERDE'), /loja/);
  assert.throws(() => a.obter(DIA1, 'REDE'), /loja/);
  assert.throws(() => a.obter(DIA1, ''), /loja/);        // '' só vale para login sem loja cadastrada
  M.definirAta(a.obter(DIA1, 'AHU'), 'privado do Ahú');
  a.definirLojas(['SÃO BRAZ']);                           // allowlist mudou: Ahú saiu
  assert.equal(a.tamanho(), 0);
  assert.throws(() => a.obter(DIA1, 'AHU'), /loja/);
  // protótipo não é chave
  assert.throws(() => a.obter(DIA1, '__proto__'), /loja/);
  assert.throws(() => a.obter(DIA1, 'constructor'), /loja/);
});

test('login sem loja cadastrada usa um único contexto neutro', () => {
  const a = armazem(A_MAIL, []);
  assert.doesNotThrow(() => a.obter(DIA1, ''));
  assert.throws(() => a.obter(DIA1, 'AHU'), /loja/);
});

test('dia inválido é recusado', () => {
  const a = armazem(A_MAIL);
  ['2026-02-30', '2026-13-01', '', null, undefined, 'ontem', '2026-1-1'].forEach((d) => {
    assert.throws(() => a.obter(d, 'REDE'), /dia/);
  });
});

test('conta A -> B: troca de identidade apaga o rascunho na hora e B começa limpo', () => {
  const a = armazem(A_MAIL);
  M.definirAta(a.obter(DIA1, 'REDE'), 'segredo da conta A');
  assert.equal(a.sincronizarIdentidade(B_MAIL), 'trocada');
  assert.equal(a.tamanho(), 0);
  assert.equal(a.temConteudo(), false);
  a.definirLojas(LOJAS_REDE);
  assert.equal(a.obter(DIA1, 'REDE').ata, '');
});

test('logout apaga; novo login (mesma ou outra conta) não recupera nada', () => {
  const a = armazem(A_MAIL);
  M.definirAta(a.obter(DIA1, 'REDE'), 'antes do logout');
  assert.equal(a.sincronizarIdentidade(null), 'sem-sessao');
  assert.equal(a.tamanho(), 0);
  assert.throws(() => a.obter(DIA1, 'REDE'), /sess/);
  assert.equal(a.sincronizarIdentidade(A_MAIL), 'iniciada');
  a.definirLojas(LOJAS_REDE);
  assert.equal(a.obter(DIA1, 'REDE').ata, '');
});

test('refresh/renovação do token da mesma conta (e-mail com caixa/espaço diferente) preserva o rascunho', () => {
  const a = armazem(A_MAIL);
  M.definirAta(a.obter(DIA1, 'REDE'), 'continua aqui');
  assert.equal(a.sincronizarIdentidade(A_MAIL), 'mantida');
  assert.equal(a.sincronizarIdentidade('  ' + A_MAIL.toUpperCase() + ' '), 'mantida');
  assert.equal(a.obter(DIA1, 'REDE').ata, 'continua aqui');
});

test('sessão nula/vazia é tratada como sem sessão', () => {
  [null, undefined, '', '   '].forEach((v) => {
    const a = armazem(A_MAIL);
    assert.equal(a.sincronizarIdentidade(v), 'sem-sessao');
    assert.equal(a.identidade(), null);
  });
});

test('limpar reinicia só a data+loja atual, não as outras', () => {
  const a = armazem(A_MAIL);
  M.definirAta(a.obter(DIA1, 'AHU'), 'x');
  M.definirAta(a.obter(DIA1, 'REDE'), 'y');
  assert.deepEqual(a.resumo(DIA1, 'AHU'), { temas: 4, preenchidos: 0, participantes: 0, ata: 1 });
  assert.equal(a.reiniciar(DIA1, 'AHU'), true);
  assert.equal(a.obter(DIA1, 'AHU').ata, '');
  assert.equal(a.obter(DIA1, 'REDE').ata, 'y');
  assert.equal(a.reiniciar(DIA1, 'LOJA-FORA'), false);
});

test('adicionar/remover tema e campos; prazo só aceita data válida; campo desconhecido é recusado', () => {
  const a = armazem(A_MAIL);
  const r = a.obter(DIA1, 'REDE');
  const t = M.adicionarTema(r, 'Novo assunto');
  assert.equal(r.temas.length, 5);
  assert.equal(M.definirCampoTema(r, t.id, 'decisao', 'decidido'), true);
  assert.equal(M.definirCampoTema(r, t.id, 'responsavel', 'Beto'), true);
  assert.equal(M.definirCampoTema(r, t.id, 'prazo', '2026-11-20'), true);
  assert.equal(M.definirCampoTema(r, t.id, 'prazo', '2026-02-31'), false);
  assert.equal(t.prazo, '2026-11-20');
  assert.equal(M.definirCampoTema(r, t.id, 'proximoId', '9'), false);
  assert.equal(M.definirCampoTema(r, t.id, '__proto__', 'x'), false);
  assert.equal(M.definirCampoTema(r, 9999, 'tema', 'x'), false);
  assert.equal(M.rascunhoEditado(r), true);
  assert.equal(M.removerTema(r, t.id), true);
  assert.equal(r.temas.length, 4);
  assert.equal(M.removerTema(r, t.id), false);
});

test('remover um tema inicial conta como edição (evita perda silenciosa)', () => {
  const r = M.rascunhoNovo();
  M.removerTema(r, r.temas[0].id);
  assert.equal(M.rascunhoEditado(r), true);
});

test('limites: máximo de temas e participantes; duplicado e vazio recusados', () => {
  const r = M.rascunhoNovo();
  while (M.adicionarTema(r, 'x')) { /* até o limite */ }
  assert.equal(r.temas.length, M.LIMITES.temas);
  assert.equal(M.adicionarParticipante(r, 'Ana'), true);
  assert.equal(M.adicionarParticipante(r, ' ana '), false);
  assert.equal(M.adicionarParticipante(r, '   '), false);
  assert.equal(M.removerParticipante(r, 5), false);
  assert.equal(M.removerParticipante(r, 0), true);
});

test('texto digitado: controle/bidi removidos, CRLF normalizado, limite respeitado; HTML não é interpretado (fica literal)', () => {
  assert.equal(M.limparTexto('a\u0000b‮c\r\nd‏', 50), 'abc\nd');
  assert.equal(M.limparTexto(null, 5), '');
  assert.equal(M.limparTexto('x'.repeat(500), 10).length, 10);
  assert.equal(M.limparTexto(XSS, 500), XSS);   // sem escape: o destino é textContent/.txt
});

test('ata .txt: conteúdo literal (HTML vira texto), só o que foi digitado, sem fatos inventados', () => {
  const a = armazem(A_MAIL);
  const r = a.obter(DIA1, 'AGUA VERDE');
  M.adicionarParticipante(r, XSS);
  M.definirCampoTema(r, r.temas[0].id, 'tema', XSS);
  M.definirCampoTema(r, r.temas[0].id, 'decisao', 'linha1\nlinha2');
  M.definirCampoTema(r, r.temas[0].id, 'prazo', '2026-12-01');
  M.definirAta(r, 'nota ' + XSS);
  const txt = M.gerarAta({ dia: DIA1, lojaRotulo: 'Água Verde' }, r);
  assert.match(txt, /^REUNIÃO SEMANAL — CIDADÃO DO MUNDO\n/);
  assert.match(txt, /Data: 11\/11\/2026/);
  assert.match(txt, /Loja: Água Verde/);
  assert.ok(txt.includes('1. ' + XSS));
  assert.ok(txt.includes('Participantes: ' + XSS));
  assert.match(txt, /Decisão: linha1\n {6}linha2/);
  assert.match(txt, /Prazo: 01\/12\/2026/);
  assert.match(txt, /2\. Delivery\/Qualidade\n {3}Decisão: —\n {3}Responsável: —\n {3}Prazo: —/);
  assert.ok(txt.includes('nota ' + XSS));
  assert.ok(!/R\$|\d+%/.test(txt), 'nenhum número de negócio inventado');
});

test('ata de pauta vazia: marcadores neutros, nada sugerido', () => {
  const txt = M.gerarAta({ dia: DIA1, lojaRotulo: '' }, M.rascunhoNovo());
  assert.match(txt, /Participantes: \(nenhum informado\)/);
  assert.match(txt, /ANOTAÇÕES\n—\n$/);
  assert.ok(!/Loja:/.test(txt));
});

test('nome do arquivo: limpo, com data e loja sem acento/caracteres perigosos; dia inválido -> null', () => {
  assert.equal(M.nomeArquivo(DIA1, 'SÃO BRAZ'), 'reuniao-2026-11-11-sao-braz.txt');
  assert.equal(M.nomeArquivo(DIA1, 'REDE'), 'reuniao-2026-11-11-rede.txt');
  assert.equal(M.nomeArquivo(DIA1, ''), 'reuniao-2026-11-11.txt');
  assert.equal(M.nomeArquivo(DIA1, '../..\\x:*?"<>|'), 'reuniao-2026-11-11-x.txt');
  assert.equal(M.nomeArquivo('2026-02-30', 'AHU'), null);
  assert.equal(M.nomeArquivo(undefined, 'AHU'), null);
});

test('atalhos: só os quatro destinos, href externo é caminho relativo fixo (nunca javascript:/URL de fora)', () => {
  assert.deepEqual(M.DESTINOS.map((d) => d.chave), ['semana', 'delivery', 'qualidade', 'reservas']);
  assert.deepEqual(M.DESTINOS.map((d) => d.rotulo), ['Ver A semana', 'Ver Delivery do dia', 'Ver Qualidade', 'Ver Reservas']);
  M.DESTINOS.forEach((d) => {
    const h = M.hrefExterno(d.chave);
    assert.equal(h, '../sistema.html#' + d.chave);
    assert.ok(!/^(javascript|data|https?):/i.test(h));
  });
  ['javascript:alert(1)', 'reuniao', '', null, '__proto__', 'constructor'].forEach((k) => assert.equal(M.hrefExterno(k), null));
});
