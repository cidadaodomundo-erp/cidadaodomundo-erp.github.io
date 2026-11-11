/* Regressões comportamentais do modelo puro de Taxas e Freelas. Node stdlib: node --test freelas/ */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const M = require('./freelas-modelo.js');

const ALLOW = ['AGUA VERDE', 'AHU', 'SÃO BRAZ', 'REDE'];
const rec = (loja, allow = ALLOW) => M.resolverRecorte(allow, loja);
const ct = (id, nome, extra = {}) => ({ id, nome, setor: 'Cozinha', telefone: '(41) 90000-0000', tipo: 'Freela', ativo: true, loja: 'AHU', ...extra });

test('REDE não é curinga: vira só as lojas concretas que a allowlist trouxe', () => {
  const r = rec('REDE');
  assert.equal(r.estado, 'ok');
  assert.deepEqual(r.lojas, ['AGUA VERDE', 'AHU', 'SÃO BRAZ']);   // sem BOQUEIRAO (não veio) e sem a palavra REDE
  assert.ok(!M.variantesServidor(r.lojas).some((v) => /^rede$/i.test(v) || /boqueir/i.test(v)));
});

test('REDE escolhida sem REDE na allowlist, loja fora da allowlist e allowlist inválida/sem concretas: nada é consultado', () => {
  assert.equal(rec('REDE', ['AHU']).estado, 'sem_escolha');
  assert.equal(rec('BOQUEIRAO').estado, 'sem_escolha');
  assert.equal(rec(null).estado, 'sem_escolha');
  assert.equal(rec('AHU', []).estado, 'sem_loja');
  assert.equal(rec('REDE', ['REDE']).estado, 'sem_loja');         // só a palavra REDE não é loja
  assert.equal(rec('AHU', null).estado, 'invalida');
  assert.equal(rec('AHU', 'AHU').estado, 'invalida');
  assert.equal(rec('AHU', [null, 7, '  ']).estado, 'sem_loja');
});

test('loja concreta escolhida: só ela, mesmo com alias de acento/caixa', () => {
  assert.deepEqual(rec('AHU').lojas, ['AHU']);
  assert.deepEqual(rec('SAO BRAZ').lojas, ['SÃO BRAZ']);          // alias sem acento resolve para o nome da allowlist
  assert.deepEqual(rec('são braz').lojas, ['SÃO BRAZ']);
});

test('variantes do filtro do servidor: só aliases CONHECIDOS das lojas do recorte, sem aspas/barras', () => {
  const v = M.variantesServidor(['SÃO BRAZ']);
  assert.ok(v.includes('SÃO BRAZ') && v.includes('SAO BRAZ') && v.includes('São Braz'));
  assert.ok(!v.some((x) => /ahu|agua|boqueir/i.test(x)));
  assert.deepEqual(M.variantesServidor(['LOJA NOVA']), ['LOJA NOVA']);   // sem alias conhecido: só o nome real
  assert.deepEqual(M.variantesServidor(['A"B', 'C\\D']), []);            // valor que quebraria o filtro nunca vai
});

test('contatos: só loja do recorte e só ativo; loja nula/desconhecida não é atribuída nem exposta', () => {
  const r = M.normalizarContatos([
    ct(1, 'Ana'),
    ct(2, 'Bia', { loja: 'SÃO BRAZ' }),                 // outra loja conhecida: intrusa
    ct(3, 'Caio', { loja: null }),
    ct(4, 'Dani', { loja: 'LOJA MISTERIOSA' }),
    ct(5, 'Edu', { loja: '   ' }),
    ct(6, 'Fábio', { loja: 'BOQUEIRAO' }),             // conhecida, mas fora da allowlist
    ct(7, 'Gil', { ativo: false }),
    ct(8, 'Hugo', { ativo: null }),
    ct(9, 'Iara', { loja: 'Ahu' })                      // alias de caixa da loja certa
  ], rec('AHU'));
  assert.deepEqual(r.linhas.map((l) => l.nome), ['Ana', 'Iara']);
  assert.ok(r.linhas.every((l) => l.loja === 'AHU'));
  assert.equal(r.semLoja, 3);
  assert.equal(r.fora, 2);
  assert.equal(r.inativos, 2);
  assert.ok(!JSON.stringify(r.linhas).match(/Caio|Dani|Edu|MISTERIOSA/));
});

test('contatos na REDE: cada linha cai na loja concreta dela (aliases), nunca em "REDE"', () => {
  const r = M.normalizarContatos([ct(1, 'Ana', { loja: 'Água Verde' }), ct(2, 'Bia', { loja: 'SAO BRAZ' }), ct(3, 'Caio', { loja: 'REDE' })], rec('REDE'));
  assert.deepEqual(r.linhas.map((l) => [l.nome, l.loja]), [['Ana', 'AGUA VERDE'], ['Bia', 'SÃO BRAZ']]);
  assert.equal(r.semLoja, 1);     // "REDE" gravada no cadastro não é loja concreta
});

test('contatos: só os campos permitidos saem; campos intrusos (observação, 2º telefone, destaque) são descartados', () => {
  const r = M.normalizarContatos([ct(1, 'Ana', { o_que_quer: 'SEGREDO', telefone2: '999', destaque: true, primeiro_contato: '2026-01-01', criado_em: 'x', senha: 'y' })], rec('AHU'));
  assert.deepEqual(Object.keys(r.linhas[0]).sort(), ['id', 'loja', 'nome', 'setor', 'telefone', 'tipo']);
  assert.ok(!JSON.stringify(r).match(/SEGREDO|999|destaque/));
});

test('contatos: ordem alfabética (acento/caixa ignorados) e destaque NÃO muda a posição', () => {
  const r = M.normalizarContatos([
    ct(1, 'Zeca', { destaque: true }), ct(2, 'bia'), ct(3, 'Ângela'), ct(4, 'ana', { destaque: false }), ct(5, 'Ana', { destaque: true })
  ], rec('AHU'));
  assert.deepEqual(r.linhas.map((l) => l.nome), ['ana', 'Ana', 'Ângela', 'bia', 'Zeca']);
});

test('contatos: id repetido (página sobreposta) vira uma linha; id/nome inválidos são ignorados e contados', () => {
  const r = M.normalizarContatos([
    ct(1, 'Ana'), ct(1, 'Ana de novo'), ct(null, 'Sem id'), ct(2.5, 'Id quebrado'), ct(3, '   '), ct(4, null), 'texto', null, [], ct('7', 'Id texto')
  ], rec('AHU'));
  assert.deepEqual(r.linhas.map((l) => l.nome), ['Ana', 'Id texto']);
  assert.equal(r.duplicadas, 1);
  assert.equal(r.invalidas, 7);
});

test('contatos: resposta que não é lista não vira lista vazia', () => {
  assert.equal(M.normalizarContatos(null, rec('AHU')), null);
  assert.equal(M.normalizarContatos({ message: 'x' }, rec('AHU')), null);
  assert.equal(M.normalizarValores('x', rec('AHU')), null);
});

test('contatos: texto de controle/gigante é limpo e limitado; telefone numérico vira texto', () => {
  const r = M.normalizarContatos([ct(1, 'Ana\u0000\nSilva', { telefone: 41999990000, setor: 'x'.repeat(500), tipo: { a: 1 } })], rec('AHU'));
  assert.equal(r.linhas[0].nome, 'Ana Silva');
  assert.equal(r.linhas[0].telefone, '41999990000');
  assert.equal(r.linhas[0].setor.length, 200);
  assert.equal(r.linhas[0].tipo, null);
});

test('busca por nome/setor ignora acento e caixa; filtro de setor inclui "sem setor"; não reordena', () => {
  const linhas = M.normalizarContatos([
    ct(1, 'Ângela Souza', { setor: 'Cozinha' }), ct(2, 'Bruno', { setor: 'Salão' }), ct(3, 'Carla', { setor: null }), ct(4, 'Dora', { setor: 'cozinha' })
  ], rec('AHU')).linhas;
  assert.deepEqual(M.filtrarContatos(linhas, { texto: 'angela' }).map((l) => l.nome), ['Ângela Souza']);
  assert.deepEqual(M.filtrarContatos(linhas, { texto: 'SALAO' }).map((l) => l.nome), ['Bruno']);      // casa pelo setor
  assert.deepEqual(M.filtrarContatos(linhas, { texto: 'souza angela' }).map((l) => l.nome), ['Ângela Souza']);
  assert.deepEqual(M.filtrarContatos(linhas, { setor: 'cozinha' }).map((l) => l.nome), ['Ângela Souza', 'Dora']);
  assert.deepEqual(M.filtrarContatos(linhas, { setor: M.SEM_SETOR }).map((l) => l.nome), ['Carla']);
  assert.deepEqual(M.filtrarContatos(linhas, { texto: 'zzz' }), []);
  assert.deepEqual(M.listarSetores(linhas).map((s) => s.rotulo), ['Cozinha', 'Salão', 'Sem setor informado']);
});

// ------------------------------------------------------------------------------ valores
test('valor-hora: NULL não vira 0; só número finito >= 0 é moeda', () => {
  assert.deepEqual(M.lerValorHora(null), { status: 'ausente', valor: null });
  assert.deepEqual(M.lerValorHora(undefined), { status: 'ausente', valor: null });
  assert.deepEqual(M.lerValorHora('  '), { status: 'ausente', valor: null });
  assert.deepEqual(M.lerValorHora(0), { status: 'ok', valor: 0 });            // zero cadastrado é zero; ausência não
  assert.deepEqual(M.lerValorHora(25.5), { status: 'ok', valor: 25.5 });
  assert.deepEqual(M.lerValorHora('12.50'), { status: 'ok', valor: 12.5 });   // numeric do banco pode vir como texto
  [-1, -0.01, NaN, Infinity, -Infinity, 1e13, '-3', 'abc', '1,5', '1e3', '0x10', true, {}, [], '12.5.1'].forEach((x) => {
    assert.equal(M.lerValorHora(x).status, 'invalido', String(x));
    assert.equal(M.lerValorHora(x).valor, null);
  });
});

test('moeda: formato brasileiro, nunca inventa valor', () => {
  assert.equal(M.formatarMoeda(12.5), 'R$ 12,50');
  assert.equal(M.formatarMoeda(0), 'R$ 0,00');
  assert.equal(M.formatarMoeda(1234.5), 'R$ 1.234,50');
  assert.equal(M.formatarMoeda(0.1 + 0.2), 'R$ 0,30');
  assert.equal(M.formatarMoeda(12.345), 'R$ 12,345');            // não arredonda o que está cadastrado
  [null, undefined, -1, NaN, Infinity, '12', 1e13].forEach((x) => assert.equal(M.formatarMoeda(x), '—', String(x)));
});

test('carimbo da fonte: data inválida nunca vira hoje nem 1970', () => {
  ['lixo', '2026-02-30', '2026-13-01', '2026-11-10T25:00:00Z', '2026-11-10T10:61:00Z', 20261110, {}, '10/11/2026', '2026-11-10T'].forEach((x) =>
    assert.equal(M.lerCarimbo(x).status, 'invalida', String(x)));
  assert.equal(M.lerCarimbo(null).status, 'ausente');
  assert.equal(M.lerCarimbo('').status, 'ausente');
  const so = M.lerCarimbo('2026-11-10');
  assert.equal(so.status, 'ok'); assert.equal(so.soData, true); assert.equal(so.dia, '10/11/2026');
  ['2026-11-10T15:30:00+00:00', '2026-11-10T15:30:00Z', '2026-11-10 15:30:00+00', '2026-11-10T15:30:00.123456+0000'].forEach((x) =>
    assert.equal(M.lerCarimbo(x).ms, Date.UTC(2026, 10, 10, 15, 30, 0, x.includes('.123') ? 123 : 0), x));
});

test('data/hora no horário de Curitiba', () => {
  assert.equal(M.formatarDataHora(Date.UTC(2026, 10, 10, 15, 30)), '10/11/2026 12:30');
  assert.equal(M.formatarDataHora(Date.UTC(2026, 10, 10, 3, 0)), '10/11/2026 00:00');   // meia-noite não vira "24:00"
  assert.equal(M.formatarDataHora(NaN), '—');
  assert.equal(M.formatarDataHora(null), '—');
});

test('valores: loja nula/desconhecida/outra loja fora; data só-dia não desloca de fuso; ausências ficam explícitas', () => {
  const r = M.normalizarValores([
    { loja: 'AHU', valor_hora: 25, atualizado_em: '2026-11-10T15:30:00+00:00' },
    { loja: 'AHU', valor_hora: null, atualizado_em: 'lixo' },
    { loja: null, valor_hora: 99, atualizado_em: '2026-11-10' },
    { loja: 'DESCONHECIDA', valor_hora: 98, atualizado_em: '2026-11-10' },
    { loja: 'SÃO BRAZ', valor_hora: 97, atualizado_em: '2026-11-10' },
    { loja: 'ahu', valor_hora: '30', atualizado_em: '2026-11-09' },
    { loja: 'AHU', valor_hora: -5, atualizado_em: null, intruso: 'x' }
  ], rec('AHU'));
  assert.equal(r.semLoja, 2);
  assert.equal(r.fora, 1);
  const por = (t) => r.linhas.find((l) => l.valorTexto === t);
  assert.equal(por('R$ 25,00').atualizadoTexto, '10/11/2026 12:30');
  assert.equal(por('R$ 30,00').atualizadoTexto, '09/11/2026');                    // só-dia: sem conversão de fuso
  const nulo = r.linhas.find((l) => l.valorStatus === 'ausente');
  assert.equal(nulo.valor, null); assert.equal(nulo.valorTexto, null); assert.equal(nulo.atualizadoStatus, 'invalida'); assert.equal(nulo.atualizadoTexto, null);
  const neg = r.linhas.find((l) => l.valorStatus === 'invalido');
  assert.equal(neg.valor, null); assert.equal(neg.atualizadoStatus, 'ausente');
  assert.ok(!r.linhas.some((l) => [97, 98, 99].includes(l.valor)));
  r.linhas.forEach((l) => assert.deepEqual(Object.keys(l).sort(), ['atualizadoMs', 'atualizadoStatus', 'atualizadoTexto', 'loja', 'valor', 'valorStatus', 'valorTexto']));
});

test('valores: mostra todas as linhas do cadastro (sem eleger "a vigente"), mais recente primeiro; duplicata exata some', () => {
  const r = M.normalizarValores([
    { loja: 'AHU', valor_hora: 20, atualizado_em: '2026-01-01T10:00:00Z' },
    { loja: 'AHU', valor_hora: 25, atualizado_em: '2026-06-01T10:00:00Z' },
    { loja: 'AHU', valor_hora: 25, atualizado_em: '2026-06-01T10:00:00Z' },
    { loja: 'AHU', valor_hora: 22, atualizado_em: null }
  ], rec('AHU'));
  assert.deepEqual(r.linhas.map((l) => l.valor), [25, 20, 22]);
  assert.equal(r.duplicadas, 1);
});

test('valores na REDE: cada linha na loja concreta; ordem por loja', () => {
  const r = M.normalizarValores([
    { loja: 'SAO BRAZ', valor_hora: 3, atualizado_em: null }, { loja: 'Agua Verde', valor_hora: 1, atualizado_em: null }, { loja: 'AHU', valor_hora: 2, atualizado_em: null }
  ], rec('REDE'));
  assert.deepEqual(r.linhas.map((l) => l.loja), ['AGUA VERDE', 'AHU', 'SÃO BRAZ']);
});
