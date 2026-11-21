import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile, writeFile, access, readdir } from "node:fs/promises";
import { join } from "node:path";
import { ambiente, rodar, fakeFetch, servidorPadrao, abortar, semVazamento, SEGREDO, COD_STORE } from "./ajuda.js";
import { validarPayload } from "../src/payload.js";

const ARGS_PREPARE = ["prepare", "--item", "12606018", "--choice", "12606018.12326242", "--payment-code", "DIN", "--senha", "1234"];
const semRede = () => fakeFetch(() => { throw new Error("rede nao deveria ser usada"); });

async function preparado(a, extras = []) {
  const f = semRede();
  const r = await rodar([...ARGS_PREPARE, ...extras], { env: a.env, fetchImpl: f });
  assert.equal(f.chamadas.length, 0);
  return r;
}
const lerArquivo = async (a, orderId) => JSON.parse(await readFile(join(a.dir, "payloads", `${orderId}.json`), "utf8"));
const ledger = async (a, orderId) => JSON.parse(await readFile(join(a.dir, "ledger", `${orderId}.json`), "utf8"));
const enviarOrder = (a, f, orderId, extra = ["--sandbox"]) => rodar(["send", "--order", orderId, ...extra], { env: a.env, fetchImpl: f });

test("prepare gera UMA ficha TICKET fiel ao contrato, sem rede e sem imprimir o payload", async () => {
  const a = await ambiente();
  try {
    const r = await preparado(a);
    assert.equal(r.codigo, 0);
    assert.equal(r.json.resultado, "preparado_nao_enviado");
    assert.equal(r.json.totalReais, "29.00");
    assert.equal(r.json.payload, undefined);
    assert.ok(semVazamento(r.texto));
    assert.match(r.json.orderId, /^HML-\d{14}-[0-9a-f]{8}$/);

    const { payload, sha256, codStore } = await lerArquivo(a, r.json.orderId);
    assert.equal(sha256, r.json.sha256);
    assert.equal(codStore, COD_STORE);
    assert.equal(payload.cod_store, COD_STORE);
    assert.deepEqual(payload.customer, { id: "-1", name: "TESTE" });
    assert.equal(payload.notes, "TESTE-NAO PRODUZIR | senha-nossa:1234");
    assert.equal(payload.display_id, "1234");
    assert.deepEqual(payload.order_method, { mode: "TICKET", ticket_reference: "TESTE-1234" });
    assert.equal(payload.items[0].integration_code, "12606018");
    assert.equal(payload.items[0].unit_price, 25.9);
    assert.deepEqual(payload.items[0].choice_items, [{ integration_code: "12606018.12326242", desc_item_choice: "Queijo Teste", aditional_price: 3.1, quantity: 1 }]);
    assert.deepEqual(payload.payment_types, [{ code: "DIN", amount: 29, change_for: 0 }]);
    for (const proibido of ["delivery_address", "total_amount", "table"]) assert.equal(proibido in payload, false);
    assert.deepEqual(validarPayload(payload), []);
  } finally { await a.limpar(); }
});

test("prepare rejeita pagamento zero quando os itens possuem valor", async () => {
  const a = await ambiente();
  try {
    const r = await preparado(a, ["--payment-zero"]);
    assert.equal(r.codigo, 1);
    assert.equal(r.json.erro, "PAGAMENTO_DIVERGENTE");
  } finally { await a.limpar(); }
});

test("prepare recusa codigo nao confirmado, desabilitado, sem preco e sem codigo de pagamento", async () => {
  for (const [args, erro] of [
    [["prepare", "--item", "NAO-EXISTE", "--payment-code", "DIN"], "CODIGO_NAO_CONFIRMADO"],
    [["prepare", "--item", "12606018", "--choice", "12606018", "--payment-code", "DIN"], "CODIGO_NAO_CONFIRMADO"],
    [["prepare", "--item", "12606018", "--choice", "12606018.OFF", "--payment-code", "DIN"], "CODIGO_DESABILITADO"],
    [["prepare", "--item", "SEMPRECO", "--payment-code", "DIN"], "PRECO_INVALIDO"],
    [["prepare", "--item", "12606018"], "PAGAMENTO_SEM_CODIGO"],
    [["prepare", "--payment-code", "DIN"], "ITEM_AUSENTE"],
  ]) {
    const a = await ambiente();
    try {
      const f = semRede();
      const r = await rodar(args, { env: a.env, fetchImpl: f });
      assert.equal(r.json.erro, erro, args.join(" "));
      assert.equal(f.chamadas.length, 0);
      await assert.rejects(access(join(a.dir, "payloads")));
    } finally { await a.limpar(); }
  }
});

test("prepare sem catalogo => CATALOGO_AUSENTE (nao inventa produto)", async () => {
  const a = await ambiente({ catalogo: null });
  try {
    assert.equal((await rodar(ARGS_PREPARE, { env: a.env, fetchImpl: semRede() })).json.erro, "CATALOGO_AUSENTE");
  } finally { await a.limpar(); }
});

test("validarPayload rejeita campos extras, soma errada e marcas ausentes", async () => {
  const a = await ambiente();
  try {
    const { payload } = await lerArquivo(a, (await preparado(a)).json.orderId);
    const clone = () => structuredClone(payload);
    const casos = [
      (p) => { p.delivery_address = { rua: "x" }; },
      (p) => { p.customer.document_number = "123"; },
      (p) => { p.payment_types[0].amount = 5; },
      (p) => { p.notes = "pedido real"; },
      (p) => { p.items[0].choice_items[0].additional_price = 3.1; delete p.items[0].choice_items[0].aditional_price; },
      (p) => { p.order_method.mode = "DELIVERY"; },
      (p) => { p.order_id = "REAL-1"; },
    ];
    for (const alterar of casos) {
      const p = clone();
      alterar(p);
      assert.ok(validarPayload(p).length > 0, alterar.toString());
    }
  } finally { await a.limpar(); }
});

test("send sem --sandbox, arquivo adulterado, meta divergente e order_id invalido sao recusados sem POST", async () => {
  const a = await ambiente();
  try {
    const { orderId } = (await preparado(a)).json;
    const f = fakeFetch(servidorPadrao());
    assert.equal((await enviarOrder(a, f, orderId, [])).json.erro, "FLAG_SANDBOX_AUSENTE");
    assert.equal((await enviarOrder(a, f, "../../etc/passwd")).json.erro, "ORDER_ID_INVALIDO");
    assert.equal((await enviarOrder(a, f, "HML-inexistente")).json.erro, "PREPARADO_AUSENTE");

    const arq = await lerArquivo(a, orderId);
    arq.payload.items[0].unit_price = 1;
    await writeFile(join(a.dir, "payloads", `${orderId}.json`), JSON.stringify(arq));
    assert.equal((await enviarOrder(a, f, orderId)).json.erro, "PREPARADO_REPROVADO");

    arq.payload.items[0].unit_price = 25.9;
    await writeFile(join(a.dir, "payloads", `${orderId}.json`), JSON.stringify(arq));
    await writeFile(join(a.dir, "test-store.json"), JSON.stringify({ storeId: "93936", environment: "desenvolvimento", testStoreVerified: true, expectedName: "Cidadão do Mundo - HML", codStore: "OUTRA-LOJA", idPartner: "p-outro" }));
    assert.equal((await enviarOrder(a, f, orderId)).json.erro, "PREPARADO_REPROVADO");
    assert.equal(f.deRota("/order").length, 0);
  } finally { await a.limpar(); }
});

test("send aceito: um POST /order com o payload preparado e Authorization sem Bearer; segundo send e bloqueado", async () => {
  const a = await ambiente();
  try {
    const { orderId } = (await preparado(a)).json;
    const srv = servidorPadrao();
    const f = fakeFetch(srv);
    const r = await enviarOrder(a, f, orderId);
    assert.equal(r.codigo, 0);
    assert.equal(r.json.estado, "aceito_pela_api");
    assert.match(r.json.nota, /nao prova/);
    assert.ok(semVazamento(r.texto, [srv.token]));

    const [post] = f.deRota("/order");
    assert.equal(post.url, "https://order-api.saipos.com/order");
    assert.equal(post.headers.Authorization, srv.token);
    assert.deepEqual(post.corpo, (await lerArquivo(a, orderId)).payload);
    assert.equal((await ledger(a, orderId)).estado, "aceito_pela_api");

    const de_novo = await enviarOrder(a, f, orderId);
    assert.equal(de_novo.json.erro, "JA_TENTADO");
    assert.equal(f.deRota("/order").length, 1);
  } finally { await a.limpar(); }
});

for (const [nome, resposta, estado, codigo] of [
  ["timeout", () => { throw abortar(); }, "ambiguo", 2],
  ["5xx", { status: 500, corpo: { t: "order", errorMessage: "Erro interno, comunique o time técnico." } }, "ambiguo", 2],
  ["redirect", { status: 302, corpo: {} }, "ambiguo", 2],
  ["400", { status: 400, corpo: { t: "order", errorMessage: "ORDER_ALREADY_EXISTS", guidRequest: "g-9" } }, "recusado", 2],
]) {
  test(`send ${nome} => ${estado}, sem retentativa automatica nem reenvio`, async () => {
    const a = await ambiente();
    try {
      const { orderId } = (await preparado(a)).json;
      const f = fakeFetch(servidorPadrao({ sobrescrever: { "/order": resposta } }));
      const r = await enviarOrder(a, f, orderId);
      assert.equal(r.codigo, codigo);
      assert.equal(r.json.estado, estado);
      assert.equal(f.deRota("/order").length, 1);
      assert.equal((await ledger(a, orderId)).estado, estado);
      assert.ok(semVazamento(r.texto));

      assert.equal((await enviarOrder(a, f, orderId)).json.erro, "JA_TENTADO");
      assert.equal(f.deRota("/order").length, 1);
    } finally { await a.limpar(); }
  });
}

test("send com auth falhando nao chama /order nem reserva ledger", async () => {
  const a = await ambiente();
  try {
    const { orderId } = (await preparado(a)).json;
    const f = fakeFetch(servidorPadrao({ sobrescrever: { "/auth": { status: 400, corpo: { errorMessage: `invalido ${SEGREDO}` } } } }));
    const r = await enviarOrder(a, f, orderId);
    assert.equal(r.json.erro, "AUTH_RECUSADA");
    assert.equal(f.deRota("/order").length, 0);
    await assert.rejects(readdir(join(a.dir, "ledger")));
    assert.ok(semVazamento(r.texto));
  } finally { await a.limpar(); }
});

test("reserva 'tentando' deixada por execucao interrompida tambem bloqueia reenvio", async () => {
  const a = await ambiente();
  try {
    const { orderId } = (await preparado(a)).json;
    const { mkdir } = await import("node:fs/promises");
    await mkdir(join(a.dir, "ledger"), { recursive: true });
    await writeFile(join(a.dir, "ledger", `${orderId}.json`), JSON.stringify({ orderId, estado: "tentando" }));
    const f = fakeFetch(servidorPadrao());
    assert.equal((await enviarOrder(a, f, orderId)).json.erro, "JA_TENTADO");
    assert.equal(f.deRota("/order").length, 0);
  } finally { await a.limpar(); }
});
