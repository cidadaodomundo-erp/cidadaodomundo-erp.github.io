/* Modelo + leitura de Quem conserta. Node stdlib: node --test manutencao/ . Sem rede: trFetch é dublê. */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const M = require('./manutencao-modelo.js');
const D = require('./manutencao-dados.js');

const resp = (status, body, o = {}) => ({ status, ok: status >= 200 && status < 300, json: async () => { if (o.jsonErro) throw new Error('json'); return body; } });
const pr = (id, nome, extra = {}) => ({ id, nome, setor: 'Elétrica', telefone: '(41) 3000-0000', ativo: true, ...extra });
const sempre = () => true;

test('fonte: só a tabela prestador, só id,setor,nome,telefone,ativo, ativo=eq.true, GET paginado por id', async () => {
  const urls = [];
  const d = D.criar({ modelo: M, trFetch: async (u, o) => { urls.push({ u, o }); return resp(200, []); } });
  await d.ler(sempre);
  assert.equal(urls.length, 1);
  assert.equal(urls[0].o.method, 'GET');
  assert.equal(urls[0].u, 'prestador?select=id,setor,nome,telefone,ativo&ativo=eq.true&order=id.asc&limit=200&offset=0');
  assert.deepEqual(M.CAMPOS_PRESTADOR, ['id', 'setor', 'nome', 'telefone', 'ativo']);
  assert.ok(!/loja/.test(urls[0].u), 'diretório geral: sem filtro de loja');
});

test('403 = não liberada (nunca zero prestadores); 200 [] = vazio de verdade; erro de rede/500/corpo ruim = falha', async () => {
  const rodar = async (h) => (await D.criar({ modelo: M, trFetch: async () => h() }).ler(sempre));
  assert.deepEqual(await rodar(() => resp(403, { message: 'permission denied' })), { fase: 'pronto', resultado: { estado: 'naoliberada', linhas: [] } });
  const vazio = await rodar(() => resp(200, []));
  assert.equal(vazio.resultado.estado, 'ok'); assert.deepEqual(vazio.resultado.linhas, []);
  for (const h of [() => { throw new Error('offline'); }, () => resp(500, {}), () => resp(200, { message: 'x' }), () => resp(200, [], { jsonErro: true })]) {
    assert.equal((await rodar(h)).resultado.estado, 'falha');
  }
  assert.deepEqual(await rodar(() => resp(401, {})), { fase: 'sessao' });
});

test('ativo é estrito (truthiness do JS não vale), campos extras são descartados, ordem alfabética sem ranking', () => {
  const n = M.normalizarPrestadores([
    pr(1, 'Zeca'), pr(2, 'ângelo', { o_campo_proibido: 'SEGREDO', destaque: true }),
    pr(3, 'Truthy', { ativo: 'false' }), pr(4, 'Um', { ativo: 1 }), pr(5, 'Nulo', { ativo: null }), pr(6, 'T', { ativo: 't' }),
    pr(7, '   '), pr('x', 'IdRuim'), pr(1, 'Duplicado'), 'lixo', null]);
  assert.deepEqual(n.linhas.map((l) => l.nome), ['ângelo', 'Zeca']);
  assert.deepEqual(Object.keys(n.linhas[0]).sort(), ['id', 'nome', 'setor', 'telefone']);
  assert.equal(n.inativos, 4); assert.equal(n.duplicadas, 1); assert.equal(n.invalidas, 4);
  assert.equal(M.normalizarPrestadores({}), null);
});

test('busca por nome/setor sem acento e filtro de setor; setor ausente é uma opção explícita', () => {
  const l = M.normalizarPrestadores([pr(1, 'Ana', { setor: 'Elétrica' }), pr(2, 'Bia', { setor: 'Hidráulica' }), pr(3, 'Caio', { setor: null })]).linhas;
  assert.deepEqual(M.filtrarPrestadores(l, { texto: 'eletrica' }).map((x) => x.nome), ['Ana']);
  assert.deepEqual(M.filtrarPrestadores(l, { setor: 'hidraulica' }).map((x) => x.nome), ['Bia']);
  assert.deepEqual(M.filtrarPrestadores(l, { setor: M.SEM_SETOR }).map((x) => x.nome), ['Caio']);
  assert.deepEqual(M.listarSetores(l).map((s) => s.rotulo), ['Elétrica', 'Hidráulica', 'Sem setor informado']);
});

test('paginação: 10 páginas cheias = parcial; resposta antiga (vigente falso depois do await/json) é descartada', async () => {
  const lote = (ini) => Array.from({ length: 200 }, (_, i) => pr(ini + i, 'P' + (ini + i)));
  let n = 0;
  const r = await D.criar({ modelo: M, trFetch: async () => resp(200, lote(n++ * 200 + 1)) }).ler(sempre);
  assert.equal(n, 10); assert.equal(r.resultado.estado, 'parcial'); assert.equal(r.resultado.linhas.length, 2000);
  let vivo = true;
  const d = D.criar({ modelo: M, trFetch: async () => ({ status: 200, ok: true, json: async () => { vivo = false; return [pr(1, 'Velha')]; } }) });
  assert.deepEqual(await d.ler(() => vivo), { fase: 'descartado' });
});

test('abaDoHash: só #prestadores abre o diretório', () => {
  assert.equal(M.abaDoHash('#prestadores'), 'prestadores');
  ['#chamados', '', '#x', undefined, null].forEach((h) => assert.equal(M.abaDoHash(h), 'chamados'));
});
