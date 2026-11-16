// Testes unitarios do cardapio HML (DTO, mapa, horarios, validacao do carrinho) e do formato
// preparado 2 do conector. Sem rede, sem segredos, arquivos temporarios com prefixo verificado.

import { test, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, basename, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import {
  carregarDto, carregarMapa, montarVisao, validarCarrinho, hashCarrinho, agoraSaoPaulo, motivoIndisponivel, ErroCardapio, CODIGO_DIVERSOS,
} from "../src/cardapio-hml.js";
import { montarPayloadCarrinho, validarPayloadCarrinho, totalItemCentavos } from "../../saipos-teste/src/carrinho.js";
import { validarPayload, montarPayload } from "../../saipos-teste/src/payload.js";
import {
  COD_STORE, AS_01H, AS_12H, dtoFixture, catalogoHml, mapaFixture, itemBurger, itemCerveja, TOTAL_REFERENCIA,
} from "./fixture-cardapio.js";

const PREFIXO = "hml-cardapio-test-";
const QUI = dirname(fileURLToPath(import.meta.url));
const dirs = [];
after(async () => {
  for (const d of dirs) if (basename(d).startsWith(PREFIXO) && dirname(d) === tmpdir()) await rm(d, { recursive: true, force: true });
});

async function ctxCom({ mapa = mapaFixture(), catalogo = catalogoHml(), uuid = COD_STORE, dto = dtoFixture() } = {}) {
  const d = await mkdtemp(join(tmpdir(), PREFIXO));
  dirs.push(d);
  await writeFile(join(d, "dto.json"), JSON.stringify(dto));
  const dtoCarregado = await carregarDto(join(d, "dto.json"));
  if (mapa !== null) await writeFile(join(d, "map.json"), typeof mapa === "string" ? mapa : JSON.stringify(mapa)); // null => sem arquivo
  return { dto: dtoCarregado, mapa: await carregarMapa(join(d, "map.json"), uuid, dtoCarregado), catalogo };
}

let ctxBasePromessa;
const getBase = () => (ctxBasePromessa ??= ctxCom());

const corpo = (itens) => ({ idempotencyKey: "11111111-1111-4111-8111-111111111111", itens });
function rejeita(fn, { status, codigo, motivo }) {
  assert.throws(fn, (e) => {
    assert.ok(e instanceof ErroCardapio, String(e));
    if (status) assert.equal(e.status, status);
    if (codigo) assert.equal(e.codigo, codigo);
    if (motivo) assert.equal(e.motivo, motivo);
    return true;
  });
}

test("DTO real e mapa de exemplo validam; Feijoada (cat 41) fora do horario as 01h e disponivel as 12h", async () => {
  const dto = await carregarDto(join(QUI, "..", "data", "gama-cardapio.json"));
  assert.ok(dto.produtos.size > 0 && dto.grupos.get(38).ativo === 0);
  const feij = [206, 207].map((id) => dto.produtos.get(id));
  assert.ok(feij.every(Boolean));
  for (const p of feij) {
    assert.equal(motivoIndisponivel(dto, p, AS_01H), "fora_do_horario");
    assert.equal(motivoIndisponivel(dto, p, AS_12H), null);
  }
  const mapa = await carregarMapa(join(QUI, "..", "data", "gama-hml-map.example.json"), COD_STORE, dto);
  assert.equal(mapa.estado, "ok");
});

test("relogio em America/Sao_Paulo", () => {
  assert.deepEqual(agoraSaoPaulo(AS_01H), { dia: "Quarta-Feira", hora: 1 });
  assert.equal(agoraSaoPaulo(AS_12H).hora, 12);
});

test("mapa: ausente/nulo => ausente; invalidos => invalido", async () => {
  assert.equal((await ctxCom({ mapa: null })).mapa.estado, "ausente");
  assert.equal((await ctxCom({ mapa: "null" })).mapa.estado, "ausente");
  const mut = (f) => { const m = mapaFixture(); f(m); return m; };
  const ruins = {
    schema: mut((m) => { m.schema = "outro"; }),
    versao: mut((m) => { m.version = 2; }),
    extra: mut((m) => { m.lixo = 1; }),
    item_extra: mut((m) => { m.itens[0].nome = "x"; }),
    item_repetido: mut((m) => { m.itens.push({ ...m.itens[0] }); }),
    codigo_repetido: mut((m) => { m.itens[1].codigoHml = m.itens[0].codigoHml; }),
    codigo_numero: mut((m) => { m.itens[0].codigoHml = 10; }),
    codigo_vazio: mut((m) => { m.itens[0].codigoHml = ""; }),
    diversos: mut((m) => { m.itens[0].codigoHml = CODIGO_DIVERSOS; }),
    preco: mut((m) => { m.itens[0].precoCentavos = 33.99; }),
    produto_desconhecido: mut((m) => { m.itens[0].produto = 9999; }),
    variacao_desconhecida: mut((m) => { m.itens[0].variacao = 9; }),
    opcao_desconhecida: mut((m) => { m.opcoes[0].opcao = 9999; }),
    opcao_repetida: mut((m) => { m.opcoes.push({ ...m.opcoes[0] }); }),
    grupo_desconhecido: mut((m) => { m.grupos = [{ grupo: 9999, idStoreChoice: 1 }]; }),
  };
  for (const [nome, m] of Object.entries(ruins)) assert.equal((await ctxCom({ mapa: m })).mapa.estado, "invalido", nome);
  assert.equal((await ctxCom({ mapa: "{nao json" })).mapa.estado, "invalido");
  assert.equal((await ctxCom({ uuid: "00000000-0000-4000-8000-000000000000" })).mapa.estado, "invalido"); // loja de outro UUID
});

test("carrinho valido: 2 itens, qtd 2 e adicional qtd 2; formula oficial em centavos; ordem deterministica", async () => {
  const ctx = await getBase();
  const v = validarCarrinho(ctx, corpo([itemBurger(), itemCerveja()]), AS_12H);
  assert.equal(v.totalCentavos, TOTAL_REFERENCIA);
  assert.equal(v.itensHml.length, 2);
  assert.deepEqual(v.itensHml[0].complementos.map((c) => [c.codigo, c.quantidade, c.centavos]), [["HML-ANEIS", 2, 1299], ["HML-MOLHO", 1, 200]]);
  // codigo global HML-MOLHO resolvido na linha do MESMO item (2,00 e nao 9,99)
  assert.equal(totalItemCentavos(3399, v.itensHml[0].complementos, 2), 12394);
  // mesma selecao em outra ordem => mesmo hash e mesmo resultado
  const invertido = itemBurger({ opcoes: [{ opcao: 25, quantidade: 1 }, { opcao: 22, quantidade: 2 }] });
  assert.deepEqual(validarCarrinho(ctx, corpo([invertido, itemCerveja()]), AS_12H).itensHml[0].complementos.map((c) => c.codigo), ["HML-ANEIS", "HML-MOLHO"]);
  // o hash do carrinho nao colide com o corpo legado do Diversos
  assert.notEqual(hashCarrinho(corpo([itemCerveja()])), hashCarrinho({ idempotencyKey: "x", code: CODIGO_DIVERSOS, quantity: 1 }));
  // grupo 38 inativo: min 1 ignorado
  const bebida = validarCarrinho(ctx, corpo([{ produto: 12, variacao: 1, quantidade: 1, opcoes: [] }]), AS_12H);
  assert.equal(bebida.totalCentavos, 800);
});

test("bloqueios de mapa/catalogo: ausente, invalido, codigo Gama no lugar do HML, preco, outro item, limites, desativado", async () => {
  const ok = [itemCerveja()];
  const base = await getBase();
  rejeita(() => validarCarrinho({ ...base, mapa: { estado: "ausente" } }, corpo(ok), AS_12H), { status: 409, codigo: "item_nao_pronto", motivo: "mapa_ausente" });
  rejeita(() => validarCarrinho({ ...base, mapa: { estado: "invalido", erro: "x" } }, corpo(ok), AS_12H), { status: 409, motivo: "mapa_invalido" });

  const por = async (mutMapa, mutCat, itens = ok) => {
    const m = mapaFixture(); mutMapa?.(m);
    const c = catalogoHml(); mutCat?.(c);
    return { ctx: await ctxCom({ mapa: m, catalogo: c }), itens };
  };
  let r = await por((m) => { m.itens[1].codigoHml = "11"; }); // ID do Gama usado como codigo
  rejeita(() => validarCarrinho(r.ctx, corpo(r.itens), AS_12H), { motivo: "codigo_hml_ausente" });
  r = await por(null, (c) => { c.find((l) => l.codigo_saipos === "HML-CERV-500").price = 22; }); // preco do HML diferente
  rejeita(() => validarCarrinho(r.ctx, corpo(r.itens), AS_12H), { motivo: "preco_divergente" });
  r = await por((m) => { m.itens[1].precoCentavos = 2200; }); // preco do mapa diferente
  rejeita(() => validarCarrinho(r.ctx, corpo(r.itens), AS_12H), { motivo: "preco_divergente" });
  r = await por(null, (c) => { c.find((l) => l.codigo_saipos === "HML-CERV-500").store_item_enabled = "N"; });
  rejeita(() => validarCarrinho(r.ctx, corpo(r.itens), AS_12H), { motivo: "desativado" });
  r = await por(null, null, [{ produto: 11, variacao: 1, quantidade: 1, opcoes: [] }]); // variacao sem vinculo
  rejeita(() => validarCarrinho(r.ctx, corpo(r.itens), AS_12H), { motivo: "sem_mapeamento" });
  // complemento de OUTRO item (mesmo codigo so existe no item 12): bloqueia
  r = await por((m) => { m.opcoes.find((o) => o.opcao === 23).codigoHml = "HML-OUTRO"; }, (c) => c.push({ ...c.find((l) => l.codigo_saipos === "HML-BACON"), codigo_saipos: "HML-OUTRO", id_store_item: 12 }), [itemBurger({ opcoes: [{ opcao: 23, quantidade: 1 }, { opcao: 25, quantidade: 1 }] })]);
  rejeita(() => validarCarrinho(r.ctx, corpo(r.itens), AS_12H), { motivo: "complemento_outro_item_ou_ausente" });
  // limites do grupo diferentes entre Gama e HML
  r = await por(null, (c) => { c.find((l) => l.codigo_saipos === "HML-ANEIS").max_choices = 5; }, [itemBurger()]);
  rejeita(() => validarCarrinho(r.ctx, corpo(r.itens), AS_12H), { motivo: "limites_diferentes" });
  // complemento sem mapeamento
  r = await por((m) => { m.opcoes = m.opcoes.filter((o) => o.opcao !== 22); }, null, [itemBurger()]);
  rejeita(() => validarCarrinho(r.ctx, corpo(r.itens), AS_12H), { motivo: "sem_mapeamento" });
});

test("regras de grupos e quantidades: min, max, permitir quantidade, inativos", async () => {
  const ctx = await getBase();
  const burger = (opcoes, q = 1) => ({ produto: 10, variacao: 1, quantidade: q, opcoes });
  const ruim = (itens, trecho) => assert.throws(() => validarCarrinho(ctx, corpo(itens), AS_12H), (e) => e instanceof ErroCardapio && e.status === 400 && e.message.includes(trecho), trecho);
  ruim([burger([])], "pelo menos 1"); // grupo Molho min 1 vazio
  ruim([burger([{ opcao: 22, quantidade: 4 }, { opcao: 25, quantidade: 1 }])], "no máximo 3"); // max 3, qtd 4
  ruim([burger([{ opcao: 22, quantidade: 2 }, { opcao: 23, quantidade: 2 }, { opcao: 25, quantidade: 1 }])], "no máximo 3"); // soma entre opcoes
  ruim([burger([{ opcao: 25, quantidade: 2 }])], "não permite quantidade"); // grupo sem permitir quantidade
  ruim([burger([{ opcao: 25, quantidade: 1 }, { opcao: 26, quantidade: 1 }])], "no máximo 1");
  ruim([burger([{ opcao: 25, quantidade: 1 }, { opcao: 91, quantidade: 1 }])], "inativa"); // opcao inativa
  ruim([burger([{ opcao: 25, quantidade: 1 }, { opcao: 90, quantidade: 1 }])], "grupo ativo"); // opcao do grupo 38 inativo
  ruim([burger([{ opcao: 25, quantidade: 1 }, { opcao: 25, quantidade: 1 }])], "repetida");
  ruim([burger([{ opcao: 9999, quantidade: 1 }])], "desconhecida");
  ruim([{ produto: 11, variacao: 2, quantidade: 1, opcoes: [{ opcao: 22, quantidade: 1 }] }], "grupo ativo deste produto"); // opcao de outro produto
  ruim([{ produto: 9999, variacao: 1, quantidade: 1, opcoes: [] }], "Produto desconhecido");
  ruim([{ produto: 11, variacao: 9, quantidade: 1, opcoes: [] }], "Variação");
  // quantidade 2 de opcao valida (grupo permite) e apenas 1 unidade em produto sem quantidade
  assert.ok(validarCarrinho(ctx, corpo([burger([{ opcao: 22, quantidade: 2 }, { opcao: 26, quantidade: 1 }])]), AS_12H));
  ruim([{ produto: 30, variacao: 1, quantidade: 2, opcoes: [] }], "1 unidade");
  ruim([{ produto: 30, variacao: 1, quantidade: 1, obs: "oi", opcoes: [] }], "observação");
});

test("estrutura estrita: campos extras (preco/total), limites 20, tipos e observacao", async () => {
  const ctx = await getBase();
  const ruim = (c, status = 400) => assert.throws(() => validarCarrinho(ctx, c, AS_12H), (e) => e instanceof ErroCardapio && e.status === status);
  ruim({ ...corpo([itemCerveja()]), total: 1 });
  ruim({ ...corpo([itemCerveja()]), preco: 1 });
  ruim(corpo([{ ...itemCerveja(), unit_price: 1 }]));
  ruim(corpo([{ ...itemCerveja(), centavos: 1 }]));
  ruim(corpo([{ ...itemCerveja(), opcoes: [{ opcao: 22, quantidade: 1, centavos: 1 }] }]));
  ruim(corpo([]));
  ruim(corpo(Array.from({ length: 21 }, () => itemCerveja())));
  for (const q of [0, 21, 1.5, "2", -1, null, NaN]) ruim(corpo([itemCerveja({ quantidade: q })]));
  ruim(corpo([itemCerveja({ obs: "x".repeat(81) })]));
  ruim(corpo([itemCerveja({ obs: "a\nb" })]));
  ruim(corpo([itemCerveja({ obs: 5 })]));
  ruim({ idempotencyKey: "x" });
  ruim(corpo("nao-lista"));
  assert.ok(validarCarrinho(ctx, corpo(Array.from({ length: 20 }, () => itemCerveja({ quantidade: 20 }))), AS_12H)); // 20 itens x 20 e permitido
  ruim(corpo(Array.from({ length: 20 }, () => ({ produto: 31, variacao: 1, quantidade: 20, opcoes: [] }))), 400); // total acima do limite
  assert.throws(() => validarCarrinho(ctx, corpo(Array.from({ length: 20 }, () => ({ produto: 31, variacao: 1, quantidade: 20, opcoes: [] }))), AS_12H), (e) => e.codigo === "total_fora_do_limite");
});

test("horarios do produto e da CATEGORIA no relogio injetavel (Feijoada 01h falso, 12h verdadeiro)", async () => {
  const ctx = await getBase();
  const feij = [{ produto: 20, variacao: 1, quantidade: 1, opcoes: [] }];
  const pf = [{ produto: 21, variacao: 1, quantidade: 1, opcoes: [] }]; // horario proprio 24h, categoria so 11-17h
  rejeita(() => validarCarrinho(ctx, corpo(feij), AS_01H), { status: 409, codigo: "fora_do_horario" });
  rejeita(() => validarCarrinho(ctx, corpo(pf), AS_01H), { status: 409, codigo: "fora_do_horario" });
  assert.equal(validarCarrinho(ctx, corpo(feij), AS_12H).totalCentavos, 4500);
  const v1 = montarVisao(ctx, AS_01H);
  const v12 = montarVisao(ctx, AS_12H);
  const get = (v, id) => v.produtos.find((p) => p.id === id);
  assert.equal(get(v1, 20).disponivelAgora, false);
  assert.equal(get(v1, 20).motivoIndisponivel, "fora_do_horario");
  assert.equal(get(v1, 11).disponivelAgora, true);
  assert.equal(get(v12, 20).disponivelAgora, true);
  // produtos preservados no cardapio mesmo fora do horario
  assert.ok(get(v1, 20) && get(v1, 21));
});

test("visao para o front: sem codigos Saipos, grupo inativo oculto, vinculos prontos por variacao", async () => {
  const ctx = await getBase();
  const v = montarVisao(ctx, AS_12H);
  const texto = JSON.stringify(v);
  assert.ok(!texto.includes("HML-") && !texto.includes("codigoHml") && !texto.includes(COD_STORE));
  assert.equal(v.mapa, "ok");
  assert.ok(!v.grupos.some((g) => g.id === 38));
  assert.ok(!v.opcoes.some((o) => o.id === 90 || o.id === 91)); // opcao do grupo inativo e opcao inativa nao aparecem
  const burger = v.produtos.find((p) => p.id === 10);
  assert.deepEqual(burger.grupos, [4, 5]);
  assert.equal(burger.variacoes[0].pronto, true);
  assert.deepEqual(burger.variacoes[0].opcoesProntas.sort(), [22, 23, 25, 26]);
  const cerv = v.produtos.find((p) => p.id === 11);
  assert.deepEqual(cerv.variacoes.map((x) => x.pronto), [false, true]); // 300ml sem vinculo
  assert.equal(cerv.variacoes[0].motivoBloqueio, "sem_mapeamento");
  assert.ok(v.fonte.consultadoEm && /pode não refletir/.test(v.fonte.aviso));
  const sem = montarVisao({ ...ctx, mapa: { estado: "ausente" } }, AS_12H);
  assert.equal(sem.mapa, "ausente");
  assert.ok(sem.produtos.every((p) => p.variacoes.every((x) => !x.pronto)));
});

test("conector: formato 2 usa a formula oficial; legado de 1 item segue restrito", () => {
  const meta = { codStore: COD_STORE };
  const itens = [
    { codigo: "A", descricao: "A", centavos: 3399, quantidade: 2, complementos: [{ codigo: "X", descricao: "X", centavos: 1299, quantidade: 2 }, { codigo: "Y", descricao: "Y", centavos: 200, quantidade: 1 }] },
    { codigo: "B", descricao: "B", centavos: 2100, quantidade: 1, complementos: [] },
  ];
  const { payload, resumo } = montarPayloadCarrinho({ meta, itens, paymentCode: "DIN", senha: 9300 });
  assert.equal(resumo.totalCentavos, 14494);
  assert.equal(payload.payment_types[0].amount, 144.94);
  assert.equal(payload.items[0].choice_items[0].quantity, 2);
  assert.deepEqual(validarPayloadCarrinho(payload), []);
  // adulteracoes reprovam
  const clone = () => JSON.parse(JSON.stringify(payload));
  let p = clone(); p.payment_types[0].amount = 140; assert.ok(validarPayloadCarrinho(p).length);
  p = clone(); p.items[0].choice_items.push({ ...p.items[0].choice_items[0] }); assert.ok(validarPayloadCarrinho(p).length); // repetido
  p = clone(); p.items[1].quantity = 0; assert.ok(validarPayloadCarrinho(p).length);
  p = clone(); p.items[1].quantity = 21; assert.ok(validarPayloadCarrinho(p).length);
  p = clone(); p.items = []; assert.ok(validarPayloadCarrinho(p).length);
  p = clone(); p.notes = "x"; assert.ok(validarPayloadCarrinho(p).length);
  p = clone(); p.extra = 1; assert.ok(validarPayloadCarrinho(p).length);
  assert.throws(() => montarPayloadCarrinho({ meta, itens: [], paymentCode: "DIN", senha: 1 }), (e) => e.codigo === "ITENS_FORA_DO_LIMITE");
  assert.throws(() => montarPayloadCarrinho({ meta, itens: [{ ...itens[0], complementos: [itens[0].complementos[0], itens[0].complementos[0]] }], paymentCode: "DIN", senha: 1 }), (e) => e.codigo === "COMPLEMENTO_REPETIDO");
  // legado: o payload de 2 itens continua REPROVADO pelo validador de 1 item
  assert.ok(validarPayload(payload).length > 0);
  assert.equal(typeof montarPayload, "function");
});
