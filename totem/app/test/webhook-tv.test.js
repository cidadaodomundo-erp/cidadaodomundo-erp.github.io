// Testes locais com fixtures: sem rede externa, sem Saipos, sem reenvio. Receptor so em 127.0.0.1 porta efemera.
import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { aplicarAviso, criarReceptorWebhook, lerConfigWebhook, FONTE_WEBHOOK, segredoValido } from "../src/webhook-tv.js";
import { montarPayloadCarrinho, validarPayloadCarrinho, TELEFONE_FAKE_HML } from "../../saipos-teste/src/carrinho.js";

const SEG = "a".repeat(64);
const LOJA = "ef2dc467-a4a8-4734-a4d7-eb3442ff3401";
const T = "2026-11-11T10:00:00.000Z";
const auto = (extra = {}) => ({ modo: "TAKEOUT", fonte: FONTE_WEBHOOK, estado: "aceito", orderId: "HML-1", preparo: { estado: "PREPARANDO", desde: T }, ...extra });

test("READY_TO_DELIVER -> PRONTO; repetido nao muda", () => {
  const e = auto();
  assert.equal(aplicarAviso(e, "READY_TO_DELIVER", T).resultado, "aplicado");
  assert.equal(e.preparo.estado, "PRONTO");
  assert.equal(aplicarAviso(e, "READY_TO_DELIVER", "2026-11-11T11:00:00.000Z").mudou, false);
  assert.equal(e.preparo.prontoEm, T);
});

test("CONFIRMED so registra", () => {
  const e = auto();
  aplicarAviso(e, "CONFIRMED", T);
  assert.equal(e.preparo.estado, "PREPARANDO");
});

const T2 = "2026-11-11T10:05:00.000Z";
test("CONCLUDED -> READY: encerrado (RETIRADO semPronto), READY tardio nao vira PRONTO", () => {
  const e = auto();
  aplicarAviso(e, "CONCLUDED", T);
  assert.equal(e.preparo.estado, "RETIRADO");
  assert.equal(e.preparo.semPronto, true);
  assert.equal(e.preparo.prontoEm, undefined);
  aplicarAviso(e, "READY_TO_DELIVER", T2);
  assert.equal(e.preparo.estado, "RETIRADO");
  assert.equal(e.preparo.retiradoEm, T);
});

test("CANCELLED -> READY: cancelado e tardio nao reabre; duplicado early/late idempotente", () => {
  const e = auto();
  aplicarAviso(e, "CANCELLED", T);
  aplicarAviso(e, "READY_TO_DELIVER", T2);
  aplicarAviso(e, "CANCELLED", T2);
  assert.equal(e.preparo.estado, "CANCELADO");
  assert.equal(e.preparo.canceladoEm, T);
  assert.equal(e.preparo.prontoEm, undefined);
});

test("PRONTO + CONCLUDED mantem PRONTO (retirada manual); CANCELLED depois de RETIRADO so registra", () => {
  const e = auto();
  aplicarAviso(e, "READY_TO_DELIVER", T);
  aplicarAviso(e, "CONCLUDED", T2);
  assert.equal(e.preparo.estado, "PRONTO");
  const r = auto({ preparo: { estado: "RETIRADO", desde: T, prontoEm: T, retiradoEm: T } });
  aplicarAviso(r, "CANCELLED", T2);
  assert.equal(r.preparo.estado, "RETIRADO");
  assert.ok(r.saipos.vistos.CANCELLED);
});

test("CANCELLED visto antes de aceito e reaplicado quando ha preparo (derivado de vistos)", () => {
  const e = auto({ estado: "ambiguo", preparo: undefined });
  aplicarAviso(e, "CANCELLED", T);
  e.estado = "aceito"; e.preparo = { estado: "PREPARANDO", desde: T };
  aplicarAviso(e, "READY_TO_DELIVER", T2);
  assert.equal(e.preparo.estado, "CANCELADO");
});

test("restart: estado serializado (JSON) continua coerente e idempotente", () => {
  const e = auto();
  aplicarAviso(e, "READY_TO_DELIVER", T);
  const volta = JSON.parse(JSON.stringify(e));
  assert.equal(aplicarAviso(volta, "READY_TO_DELIVER", T2).mudou, false);
  assert.equal(volta.preparo.prontoEm, T);
});

test("TAKEOUT fora da loja HML e recusado (montar e validar); TICKET segue livre", () => {
  const it = [{ codigo: "1", descricao: "x", centavos: 0, quantidade: 1, complementos: [] }];
  assert.throws(() => montarPayloadCarrinho({ meta: { codStore: "outra-loja" }, itens: it, paymentCode: "DIN", senha: 1, mode: "TAKEOUT" }));
  const t = montarPayloadCarrinho({ meta: { codStore: LOJA }, itens: it, paymentCode: "DIN", senha: 1, mode: "TAKEOUT" }).payload;
  assert.ok(validarPayloadCarrinho({ ...t, cod_store: "outra-loja" }).length > 0);
  assert.equal(montarPayloadCarrinho({ meta: { codStore: "outra-loja" }, itens: it, paymentCode: "DIN", senha: 1 }).payload.order_method.mode, "TICKET");
});

test("fora de ordem e apos RETIRADO/cancelado nao regride", () => {
  const r = auto({ preparo: { estado: "RETIRADO", desde: T, prontoEm: T, retiradoEm: T } });
  aplicarAviso(r, "READY_TO_DELIVER", T);
  assert.equal(r.preparo.estado, "RETIRADO");
  const c = auto();
  aplicarAviso(c, "CANCELLED", T);
  aplicarAviso(c, "READY_TO_DELIVER", T);
  assert.equal(c.preparo.estado, "CANCELADO");
});

test("legado/TICKET e nao aceito: nada muda ou so registra", () => {
  const legado = { estado: "aceito", orderId: "HML-1", preparo: { estado: "PREPARANDO", desde: T } };
  assert.equal(aplicarAviso(legado, "READY_TO_DELIVER", T).resultado, "ignorado");
  assert.equal(legado.preparo.estado, "PREPARANDO");
  const amb = auto({ estado: "ambiguo", preparo: undefined });
  aplicarAviso(amb, "READY_TO_DELIVER", T);
  assert.equal(amb.preparo, undefined);
  assert.ok(amb.saipos.vistos.READY_TO_DELIVER);
});

test("payload TAKEOUT valido; TICKET continua padrao; modo estranho recusado", () => {
  const it = [{ codigo: "1", descricao: "x", centavos: 0, quantidade: 1, complementos: [] }];
  const meta = { codStore: LOJA };
  assert.equal(montarPayloadCarrinho({ meta, itens: it, paymentCode: "DIN", senha: 9301 }).payload.order_method.mode, "TICKET");
  const t = montarPayloadCarrinho({ meta, itens: it, paymentCode: "DIN", senha: 9301, mode: "TAKEOUT" }).payload;
  assert.deepEqual(validarPayloadCarrinho(t), []);
  assert.throws(() => montarPayloadCarrinho({ meta, itens: it, paymentCode: "DIN", senha: 9301, mode: "DELIVERY" }));
});

const opt = (extra = {}) => auto({ prontoAoConcluirHml: true, ...extra });

test("opt-in: Confirmed->Concluded e Concluded->Confirmed dao PRONTO; Concluded sozinho nao chama", () => {
  const a = opt();
  aplicarAviso(a, "CONFIRMED", T);
  aplicarAviso(a, "CONCLUDED", T2);
  assert.equal(a.preparo.estado, "PRONTO");
  assert.equal(a.preparo.prontoEm, T2);
  assert.equal(a.preparo.semPronto, undefined);
  const b = opt();
  aplicarAviso(b, "CONCLUDED", T);
  assert.equal(b.preparo.estado, "PREPARANDO");
  aplicarAviso(b, "CONFIRMED", T2);
  assert.equal(b.preparo.estado, "PRONTO");
  assert.equal(aplicarAviso(b, "CONCLUDED", "2026-11-11T12:00:00.000Z").mudou, false);
  assert.equal(b.preparo.prontoEm, T);
});

test("opt-in: READY_TO_DELIVER legitimo tambem vira PRONTO", () => {
  const e = opt();
  aplicarAviso(e, "READY_TO_DELIVER", T);
  assert.equal(e.preparo.estado, "PRONTO");
});

test("sem flag / flag false: CONCLUDED nunca vira PRONTO (historico semPronto)", () => {
  for (const extra of [{}, { prontoAoConcluirHml: false }]) {
    const e = auto(extra);
    aplicarAviso(e, "CONFIRMED", T);
    aplicarAviso(e, "CONCLUDED", T2);
    assert.equal(e.preparo.estado, "RETIRADO");
    assert.equal(e.preparo.semPronto, true);
  }
});

test("opt-in: CANCELLED antes/depois/fora de ordem nao reabre; RETIRADO manual + CONCLUDED duplicado nao reabre", () => {
  const c = opt();
  aplicarAviso(c, "CANCELLED", T);
  aplicarAviso(c, "CONFIRMED", T);
  aplicarAviso(c, "CONCLUDED", T2);
  assert.equal(c.preparo.estado, "CANCELADO");
  const d = opt();
  aplicarAviso(d, "CONFIRMED", T);
  aplicarAviso(d, "CONCLUDED", T);
  aplicarAviso(d, "CANCELLED", T2);
  assert.equal(d.preparo.estado, "CANCELADO");
  const r = opt({ preparo: { estado: "RETIRADO", desde: T, prontoEm: T, retiradoEm: T2 } });
  aplicarAviso(r, "CONFIRMED", T);
  aplicarAviso(r, "CONCLUDED", T);
  aplicarAviso(r, "CONCLUDED", T2);
  assert.equal(r.preparo.estado, "RETIRADO");
});

test("opt-in: restart (JSON) preserva flag e estado", () => {
  const e = opt();
  aplicarAviso(e, "CONFIRMED", T);
  aplicarAviso(e, "CONCLUDED", T2);
  const v = JSON.parse(JSON.stringify(e));
  assert.equal(v.prontoAoConcluirHml, true);
  assert.equal(aplicarAviso(v, "CONCLUDED", T).mudou, false);
  assert.equal(v.preparo.estado, "PRONTO");
});

test("lerConfigWebhook: flag opcional (padrao false), tipo estranho falha", async () => {
  const dir = await mkdtemp(join(tmpdir(), "hml-cfg-test-"));
  try {
    const ler = async (c) => { const f = join(dir, "c.json"); await writeFile(f, JSON.stringify(c)); return lerConfigWebhook(f); };
    assert.equal((await ler({ segredo: SEG })).prontoAoConcluirHml, false);
    assert.equal((await ler({ segredo: SEG, prontoAoConcluirHml: true })).prontoAoConcluirHml, true);
    for (const v of ["true", 1, null]) await assert.rejects(ler({ segredo: SEG, prontoAoConcluirHml: v }));
  } finally { await rm(dir, { recursive: true, force: true }); }
});

function post(porta, caminho, corpo, { tipo = "application/json", metodo = "POST" } = {}) {
  return new Promise((ok, falha) => {
    const dados = typeof corpo === "string" ? corpo : JSON.stringify(corpo ?? {});
    const req = http.request({ host: "127.0.0.1", port: porta, path: caminho, method: metodo, headers: { "Content-Type": tipo, "Content-Length": Buffer.byteLength(dados) } }, (res) => {
      let b = ""; res.on("data", (d) => (b += d)); res.on("end", () => ok({ status: res.statusCode, corpo: b, headers: res.headers }));
    });
    req.on("error", falha); req.end(dados);
  });
}

test("receptor: segredo, loja, tamanho, formato, metodo, sem CORS, status", async () => {
  const chamadas = [];
  const r = criarReceptorWebhook({ segredo: SEG, codStore: LOJA, porta: 0, aoAviso: async (ev) => { chamadas.push(ev); return { resultado: "aplicado" }; } });
  const porta = await r.iniciar();
  try {
    assert.equal(r.status().estado, "aguardando_avisos");
    const ev = { event: "READY_TO_DELIVER", cod_store: LOJA, order_id: "HML-1" };
    assert.equal((await post(porta, "/" + "b".repeat(64), ev)).status, 404);
    assert.equal((await post(porta, "/", ev)).status, 404);
    assert.equal((await post(porta, "/" + SEG, ev, { metodo: "GET" })).status, 405);
    assert.equal((await post(porta, "/" + SEG, ev, { tipo: "text/plain" })).status, 415);
    assert.equal((await post(porta, "/" + SEG, "{nao json")).status, 400);
    assert.equal((await post(porta, "/" + SEG, { event: 1 })).status, 400);
    assert.equal((await post(porta, "/" + SEG, { ...ev, x: "y".repeat(5000) })).status, 413);
    assert.equal((await post(porta, "/" + SEG, { ...ev, cod_store: "outra" })).status, 200);
    assert.equal(chamadas.length, 0);
    const ok = await post(porta, "/" + SEG, ev);
    assert.equal(ok.status, 200);
    assert.equal(ok.headers["access-control-allow-origin"], undefined);
    assert.equal(chamadas.length, 1);
    assert.equal(r.status().estado, "recebendo");
    assert.ok(!JSON.stringify(r.status()).includes(SEG));
  } finally { await r.fechar(); }
});

test("receptor: falha de persistencia vira 500 (sem ack)", async () => {
  const r = criarReceptorWebhook({ segredo: SEG, codStore: LOJA, porta: 0, aoAviso: async () => { throw new Error("disco"); } });
  const porta = await r.iniciar();
  try {
    const x = await post(porta, "/" + SEG, { event: "CANCELLED", cod_store: LOJA, order_id: "HML-1" });
    assert.equal(x.status, 500);
    assert.ok(!x.corpo.includes("disco"));
  } finally { await r.fechar(); }
});

test("segredoValido exige 64 hex", () => {
  assert.equal(segredoValido(SEG), true);
  assert.equal(segredoValido("abc"), false);
});

// Contrato customer: TAKEOUT exige phone fake constante; TICKET segue com 2 campos e sem phone.
const ITENS_CONTRATO = [{ codigo: "1", descricao: "x", centavos: 1000, quantidade: 1, complementos: [] }];
const montar = (mode) => montarPayloadCarrinho({ meta: { codStore: LOJA }, itens: ITENS_CONTRATO, paymentCode: "DIN", senha: 9204, mode }).payload;

test("contrato TAKEOUT: customer leva phone fake '00000000000' e valida", () => {
  const t = montar("TAKEOUT");
  assert.equal(TELEFONE_FAKE_HML, "00000000000");
  assert.deepEqual(t.customer, { id: "-1", name: "TESTE", phone: "00000000000" });
  assert.deepEqual(validarPayloadCarrinho(t), []);
});

test("contrato TAKEOUT: sem phone e rejeitado", () => {
  const t = montar("TAKEOUT");
  delete t.customer.phone;
  assert.ok(validarPayloadCarrinho(t).some((e) => e.includes("customer de TAKEOUT")));
});

test("contrato TAKEOUT: phone de outro valor e rejeitado (inclusive numero real/vazio)", () => {
  for (const phone of ["11999998888", "", 0, "00000000000 ", null]) {
    const t = montar("TAKEOUT");
    t.customer.phone = phone;
    assert.ok(validarPayloadCarrinho(t).some((e) => e.includes("customer de TAKEOUT")), `phone aceito indevidamente: ${JSON.stringify(phone)}`);
  }
});

test("contrato TAKEOUT: campo extra no customer e rejeitado", () => {
  const t = montar("TAKEOUT");
  t.customer.email = "x@x";
  assert.ok(validarPayloadCarrinho(t).some((e) => e.includes("customer de TAKEOUT")));
});

test("contrato TICKET: customer continua objeto de 2 campos, sem phone", () => {
  const t = montar("TICKET");
  assert.deepEqual(t.customer, { id: "-1", name: "TESTE" });
  assert.deepEqual(validarPayloadCarrinho(t), []);
  t.customer.phone = TELEFONE_FAKE_HML;
  assert.ok(validarPayloadCarrinho(t).some((e) => e.includes("customer de TICKET")));
});
