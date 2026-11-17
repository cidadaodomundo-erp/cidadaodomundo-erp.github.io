import { test } from "node:test";
import assert from "node:assert/strict";
import { criarPagamentos, adaptadorSimulado, ESTADOS } from "../src/pagamento.js";

const base = { centavos: 4590, forma: "debito" };

test("aprovado libera a cozinha", async () => {
  const p = criarPagamentos({ adaptador: adaptadorSimulado() });
  const r = await p.pagar({ ...base, idempotencyKey: "pedido-0001" });
  assert.equal(r.estado, ESTADOS.APROVADO);
  assert.equal(p.liberaCozinha("pedido-0001"), true);
});

test("recusado e cancelado nao liberam", async () => {
  const a = adaptadorSimulado({ "pedido-rec1": "recusado", "pedido-can1": "cancelado" });
  const p = criarPagamentos({ adaptador: a });
  assert.equal((await p.pagar({ ...base, idempotencyKey: "pedido-rec1" })).estado, ESTADOS.RECUSADO);
  assert.equal((await p.pagar({ ...base, idempotencyKey: "pedido-can1" })).estado, ESTADOS.CANCELADO);
  assert.equal(p.liberaCozinha("pedido-rec1"), false);
  assert.equal(p.liberaCozinha("pedido-can1"), false);
});

test("reenvio com a mesma chave nunca cobra duas vezes", async () => {
  const a = adaptadorSimulado();
  const p = criarPagamentos({ adaptador: a });
  await p.pagar({ ...base, idempotencyKey: "pedido-dup1" });
  await p.pagar({ ...base, idempotencyKey: "pedido-dup1" });
  assert.equal(a.cobrancas.length, 1);
});

test("recusado nao vira aprovado em reenvio", async () => {
  const a = adaptadorSimulado({ "pedido-rec2": "recusado" });
  const p = criarPagamentos({ adaptador: a });
  await p.pagar({ ...base, idempotencyKey: "pedido-rec2" });
  const r = await p.pagar({ ...base, idempotencyKey: "pedido-rec2" });
  assert.equal(r.estado, ESTADOS.RECUSADO);
  assert.equal(a.cobrancas.length, 1);
});

test("queda de rede fica incerto, nao libera e reconsulta sem cobrar de novo", async () => {
  const a = adaptadorSimulado({ "pedido-net1": "erro-depois-aprovado" });
  const p = criarPagamentos({ adaptador: a });
  const r1 = await p.pagar({ ...base, idempotencyKey: "pedido-net1" });
  assert.equal(r1.estado, ESTADOS.INCERTO);
  assert.equal(p.liberaCozinha("pedido-net1"), false);
  const r2 = await p.pagar({ ...base, idempotencyKey: "pedido-net1" });
  assert.equal(r2.estado, ESTADOS.APROVADO);
  assert.equal(a.cobrancas.length, 1);
});

test("mesma chave com valor diferente e recusada", async () => {
  const p = criarPagamentos({ adaptador: adaptadorSimulado() });
  await p.pagar({ ...base, idempotencyKey: "pedido-val1" });
  await assert.rejects(p.pagar({ ...base, centavos: 1, idempotencyKey: "pedido-val1" }));
});

test("valor aprovado diferente do pedido nao libera", async () => {
  const a = { async cobrar() { return { estado: "aprovado", centavos: 1 }; }, async consultar() { return { estado: "incerto" }; } };
  const p = criarPagamentos({ adaptador: a });
  const r = await p.pagar({ ...base, idempotencyKey: "pedido-dif1" });
  assert.equal(r.estado, ESTADOS.INCERTO);
  assert.equal(p.liberaCozinha("pedido-dif1"), false);
});

test("entradas invalidas sao recusadas", async () => {
  const p = criarPagamentos({ adaptador: adaptadorSimulado() });
  await assert.rejects(p.pagar({ ...base, idempotencyKey: "x" }));
  await assert.rejects(p.pagar({ ...base, centavos: 0, idempotencyKey: "pedido-inv1" }));
  await assert.rejects(p.pagar({ ...base, forma: "cheque", idempotencyKey: "pedido-inv2" }));
});
