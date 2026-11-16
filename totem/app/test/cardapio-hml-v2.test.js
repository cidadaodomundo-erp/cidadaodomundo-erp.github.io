// Testes do mapa v2 (complemento por produto+variacao+opcao, codigo composto). Fixtures ficticias, sem rede/segredos.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, basename, dirname } from "node:path";
import { carregarDto, carregarMapa, montarVisao, validarCarrinho, ErroCardapio } from "../src/cardapio-hml.js";
import { COD_STORE, AS_12H, dtoFixtureV2, catalogoHmlV2, mapaFixtureV2 } from "./fixture-cardapio.js";

const PREFIXO = "hml-cardapio-v2-test-";
const dirs = [];
after(async () => {
  for (const d of dirs) if (basename(d).startsWith(PREFIXO) && dirname(d) === tmpdir()) await rm(d, { recursive: true, force: true });
});

async function ctxCom({ mapa = mapaFixtureV2(), catalogo = catalogoHmlV2() } = {}) {
  const d = await mkdtemp(join(tmpdir(), PREFIXO));
  dirs.push(d);
  await writeFile(join(d, "dto.json"), JSON.stringify(dtoFixtureV2()));
  const dto = await carregarDto(join(d, "dto.json"));
  if (mapa !== null) await writeFile(join(d, "map.json"), JSON.stringify(mapa));
  return { dto, mapa: await carregarMapa(join(d, "map.json"), COD_STORE, dto), catalogo };
}

const corpo = (itens) => ({ idempotencyKey: "11111111-1111-4111-8111-111111111111", itens });
const burger = (opcoes) => ({ produto: 10, variacao: 1, quantidade: 1, opcoes });
const cerveja = (variacao, opcoes) => ({ produto: 11, variacao, quantidade: 1, opcoes });
const op = (opcao, quantidade = 1) => ({ opcao, quantidade });
const molho = op(25);
const bloqueia = (ctx, itens, motivo) => assert.throws(() => validarCarrinho(ctx, corpo(itens), AS_12H), (e) => e instanceof ErroCardapio && e.status === 409 && e.motivo === motivo, motivo);
const codigosDe = (r) => r.itensHml.map((i) => [i.codigo, i.complementos.map((c) => c.codigo)]);

test("v2: dois produtos com a MESMA opcao (id 22) usam codigos compostos de prefixos diferentes", async () => {
  const ctx = await ctxCom();
  assert.equal(ctx.mapa.estado, "ok");
  const r = validarCarrinho(ctx, corpo([burger([op(22, 2), molho]), cerveja(1, [op(22)])]), AS_12H);
  assert.deepEqual(codigosDe(r), [["501", ["501.22", "501.25"]], ["901", ["901.22"]]]);
  assert.equal(r.totalCentavos, 3399 + 1299 * 2 + 200 + 1300 + 1299);
});

test("v2: um produto com 2 variacoes e a mesma opcao => codigo por variacao", async () => {
  const ctx = await ctxCom();
  assert.deepEqual(codigosDe(validarCarrinho(ctx, corpo([cerveja(1, [op(22)])]), AS_12H)), [["901", ["901.22"]]]);
  assert.deepEqual(codigosDe(validarCarrinho(ctx, corpo([cerveja(2, [op(22)])]), AS_12H)), [["902", ["902.22"]]]);
});

test("v2: codigo de OUTRA variacao e rejeitado mesmo com mesmo nome/preco/grupo", async () => {
  const m = mapaFixtureV2();
  m.opcoes.find((o) => o.produto === 11 && o.variacao === 2).codigoHml = "901.22"; // pertence a 300ml
  bloqueia(await ctxCom({ mapa: m }), [cerveja(2, [op(22)])], "complemento_outro_item_ou_ausente");
});

test("v2: codigo de outro produto/item e rejeitado", async () => {
  const m = mapaFixtureV2();
  m.opcoes.find((o) => o.produto === 11 && o.variacao === 1).codigoHml = "501.22";
  bloqueia(await ctxCom({ mapa: m }), [cerveja(1, [op(22)])], "complemento_outro_item_ou_ausente");
});

test("v2: linha do catalogo em outra loja-item, outro tamanho ou sem tamanho nao vale", async () => {
  for (const mut of [
    (l) => { l.id_store_item = 99; },
    (l) => { l.tamanho = "500ml"; },
    (l) => { delete l.tamanho; },
  ]) {
    const cat = catalogoHmlV2();
    mut(cat.find((l) => l.codigo_saipos === "901.22"));
    bloqueia(await ctxCom({ catalogo: cat }), [cerveja(1, [op(22)])], "complemento_outro_item_ou_ausente");
  }
});

test("v2: preco divergente (mapa x DTO, catalogo x DTO) bloqueia", async () => {
  const m = mapaFixtureV2();
  m.opcoes.find((o) => o.produto === 10 && o.opcao === 22).precoCentavos = 1300;
  bloqueia(await ctxCom({ mapa: m }), [burger([op(22), molho])], "preco_divergente");
  const cat = catalogoHmlV2();
  cat.find((l) => l.codigo_saipos === "501.22").price = 13;
  bloqueia(await ctxCom({ catalogo: cat }), [burger([op(22), molho])], "preco_divergente");
});

test("v2: nome da escolha, nome do grupo e id_store_choice ambiguo bloqueiam", async () => {
  let cat = catalogoHmlV2();
  cat.find((l) => l.codigo_saipos === "501.22").complemento_item = "Outro";
  bloqueia(await ctxCom({ catalogo: cat }), [burger([op(22), molho])], "opcao_nome_diferente");
  cat = catalogoHmlV2();
  cat.find((l) => l.codigo_saipos === "501.22").complemento = "Molho";
  bloqueia(await ctxCom({ catalogo: cat }), [burger([op(22), molho])], "grupo_diferente");
  cat = catalogoHmlV2();
  cat.push({ ...cat.find((l) => l.codigo_saipos === "501.22"), id_store_choice: 555 });
  bloqueia(await ctxCom({ catalogo: cat }), [burger([op(22), molho])], "grupo_ambiguo");
});

test("v2: min/max nulos ou diferentes bloqueiam (sem pular conferencia)", async () => {
  for (const mut of [(l) => { l.min_choices = null; }, (l) => { delete l.max_choices; }, (l) => { l.max_choices = 9; }, (l) => { l.min_choices = 1; }]) {
    const cat = catalogoHmlV2();
    mut(cat.find((l) => l.codigo_saipos === "501.22"));
    bloqueia(await ctxCom({ catalogo: cat }), [burger([op(22), molho])], "limites_diferentes");
  }
});

test("v2: item exige tamanho == nome da variacao, codigo_interno do produto e item unico", async () => {
  for (const [mut, motivo] of [
    [(l) => { delete l.tamanho; }, "tamanho_diferente"],
    [(l) => { l.tamanho = "Grande"; }, "tamanho_diferente"],
    [(l) => { l.codigo_interno = "GAMA999"; }, "item_de_outro_produto"],
  ]) {
    const cat = catalogoHmlV2();
    mut(cat.find((l) => l.codigo_saipos === "501"));
    bloqueia(await ctxCom({ catalogo: cat }), [burger([molho])], motivo);
  }
  const cat = catalogoHmlV2();
  cat.push({ ...cat.find((l) => l.codigo_saipos === "501"), id_store_item: 77 });
  bloqueia(await ctxCom({ catalogo: cat }), [burger([molho])], "item_ambiguo");
});

test("v2: carregarMapa valida a tripla (duplicada, produto/variacao desconhecidos, opcao fora dos grupos, formato v1)", async () => {
  const mut = (f) => { const m = mapaFixtureV2(); f(m); return m; };
  const ruins = {
    repetida: mut((m) => m.opcoes.push({ ...m.opcoes[0] })),
    sem_produto: mut((m) => { delete m.opcoes[0].produto; }),
    sem_variacao: mut((m) => { delete m.opcoes[0].variacao; }),
    produto_desconhecido: mut((m) => { m.opcoes[0].produto = 9999; }),
    variacao_desconhecida: mut((m) => { m.opcoes[0].variacao = 9; }),
    opcao_de_grupo_fora_do_produto: mut((m) => { m.opcoes.push({ produto: 12, variacao: 1, opcao: 22, codigoHml: "801.22", precoCentavos: 1299 }); }),
    diversos: mut((m) => { m.opcoes[0].codigoHml = "40101353"; }),
    formato_v1: mut((m) => { m.opcoes = [{ opcao: 22, codigoHml: "X", precoCentavos: 1299 }]; }),
  };
  for (const [nome, m] of Object.entries(ruins)) assert.equal((await ctxCom({ mapa: m })).mapa.estado, "invalido", nome);
  // mesma opcao em produtos/variacoes diferentes e valida (chave e a tripla)
  assert.equal((await ctxCom()).mapa.opcoes.size, 6);
});

test("v2: sem mapa ou mapa invalido bloqueia antes de qualquer outra coisa; visao nao vaza codigos", async () => {
  const base = await ctxCom();
  assert.throws(() => validarCarrinho({ ...base, mapa: { estado: "ausente" } }, corpo([cerveja(1, [])]), AS_12H), (e) => e.status === 409 && e.motivo === "mapa_ausente");
  assert.throws(() => validarCarrinho({ ...base, mapa: { estado: "invalido" } }, corpo([cerveja(1, [])]), AS_12H), (e) => e.status === 409 && e.motivo === "mapa_invalido");
  const v = montarVisao(base, AS_12H);
  assert.ok(!JSON.stringify(v).includes("501.22") && !JSON.stringify(v).includes("codigoHml"));
  const c11 = v.produtos.find((p) => p.id === 11);
  assert.deepEqual(c11.variacoes.map((x) => [x.pronto, x.opcoesProntas]), [[true, [22]], [true, [22]]]);
  assert.deepEqual(v.produtos.find((p) => p.id === 10).variacoes[0].opcoesProntas.sort(), [22, 23, 25, 26]);
});

test("legado v1 continua funcionando (mapa por opcao)", async () => {
  const { catalogoHml, mapaFixture } = await import("./fixture-cardapio.js");
  const d = await mkdtemp(join(tmpdir(), PREFIXO));
  dirs.push(d);
  await writeFile(join(d, "dto.json"), JSON.stringify(dtoFixtureV2()));
  await writeFile(join(d, "map.json"), JSON.stringify(mapaFixture()));
  const dto = await carregarDto(join(d, "dto.json"));
  const mapa = await carregarMapa(join(d, "map.json"), COD_STORE, dto);
  assert.equal(mapa.estado, "ok");
  assert.equal(mapa.version, 1);
  const r = validarCarrinho({ dto, mapa, catalogo: catalogoHml() }, corpo([burger([op(22), molho])]), AS_12H);
  assert.deepEqual(codigosDe(r), [["HML-BURGER", ["HML-ANEIS", "HML-MOLHO"]]]);
});
