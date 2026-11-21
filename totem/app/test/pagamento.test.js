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

test("registro e gravado ANTES de cobrar; falha ao gravar = nada cobrado", async () => {
  const a = adaptadorSimulado();
  const gravados = [];
  const ok = criarPagamentos({ adaptador: { ...a, cobrar: async (x) => { assert.equal(gravados.length, 1); return a.cobrar(x); } }, aoMudar: async (l) => { gravados.push(l); } });
  await ok.pagar({ ...base, idempotencyKey: "pedido-grv1" });
  assert.ok(gravados.length >= 2);
  const ruim = criarPagamentos({ adaptador: a, aoMudar: async () => { throw new Error("disco cheio"); } });
  await assert.rejects(() => ruim.pagar({ ...base, idempotencyKey: "pedido-grv2" }));
  assert.equal(a.cobrancas.filter((c) => c.idempotencyKey === "pedido-grv2").length, 0);
});

test("depois de reiniciar, pagamento pendente so e consultado (nunca cobrado de novo)", async () => {
  const a = adaptadorSimulado({ "pedido-rei1": "erro-depois-aprovado" });
  let salvo = [];
  const p1 = criarPagamentos({ adaptador: a, aoMudar: async (l) => { salvo = l; } });
  assert.equal((await p1.pagar({ ...base, idempotencyKey: "pedido-rei1" })).estado, ESTADOS.INCERTO);
  const p2 = criarPagamentos({ adaptador: a, registros: salvo });
  assert.equal((await p2.pagar({ ...base, idempotencyKey: "pedido-rei1" })).estado, ESTADOS.APROVADO);
  assert.equal(a.cobrancas.length, 1);
  assert.throws(() => criarPagamentos({ adaptador: a, registros: [{ idempotencyKey: "x" }] }));
});

test("cancelar consulta o banco: se o cliente ja pagou, vale o aprovado", async () => {
  let pago = false;
  const ad = {
    cobrar: async ({ centavos }) => ({ estado: "aguardando", centavos }),
    consultar: async () => (pago ? { estado: "aprovado", centavos: base.centavos } : { estado: "cancelado" }),
    cancelar: async () => {},
  };
  const p = criarPagamentos({ adaptador: ad });
  await p.pagar({ ...base, idempotencyKey: "pedido-can9" });
  pago = true;
  assert.equal((await p.cancelar("pedido-can9")).estado, ESTADOS.APROVADO);
  await p.pagar({ ...base, idempotencyKey: "pedido-can8" });
  pago = false;
  assert.equal((await p.cancelar("pedido-can8")).estado, ESTADOS.CANCELADO);
});

// ---------- revisao (17/11): casos raros ----------
test("resposta atrasada nunca desfaz aprovado (consultas ao mesmo tempo)", async () => {
  let n = 0;
  const ad = {
    cobrar: async ({ centavos }) => ({ estado: "aguardando", centavos }),
    consultar: async () => {
      n += 1;
      if (n === 1) { await new Promise((r) => setTimeout(r, 30)); return { estado: "aguardando", centavos: base.centavos }; }
      return { estado: "aprovado", centavos: base.centavos, autorizacao: "A1" };
    },
  };
  const p = criarPagamentos({ adaptador: ad });
  await p.pagar({ ...base, idempotencyKey: "pedido-race1" });
  const [a, b] = await Promise.all([p.reconsultar("pedido-race1"), p.reconsultar("pedido-race1")]);
  assert.equal(p.liberaCozinha("pedido-race1"), true);
  assert.equal(b.estado, ESTADOS.APROVADO);
  assert.equal(p.obter("pedido-race1").autorizacao, "A1");
});

test("cobranca que nunca chegou ao banco e pedida de novo com a mesma chave (nao trava)", async () => {
  const { adaptadorPix, bancoPixSimulado } = await import("../src/pix.js");
  const banco = bancoPixSimulado();
  const criar = banco.criarCobranca.bind(banco);
  let cair = true;
  banco.criarCobranca = async (...x) => { if (cair) { cair = false; throw new Error("banco fora"); } return criar(...x); };
  const p = criarPagamentos({ adaptador: adaptadorPix({ banco, chavePix: "chave-teste" }) });
  assert.equal((await p.pagar({ ...base, forma: "pix", idempotencyKey: "pedido-cai1" })).estado, ESTADOS.INCERTO);
  const r = await p.reconsultar("pedido-cai1");
  assert.equal(r.estado, ESTADOS.AGUARDANDO);
  assert.equal(banco.criadas, 1);
});

test("Pix: relogio do totem adiantado nao cancela sozinho; se o cliente pagou, vale o pago", async () => {
  const { adaptadorPix, bancoPixSimulado, txidDoPedido } = await import("../src/pix.js");
  const t0 = Date.parse("2026-11-17T12:00:00Z");
  const banco = bancoPixSimulado({ agora: () => t0 });
  // banco que ignora pedido de remocao (ja estava sendo pago)
  banco.removerCobranca = async () => { banco.pagar(txidDoPedido("pedido-rel1")); };
  const p = criarPagamentos({ adaptador: adaptadorPix({ banco, chavePix: "chave-teste", agora: () => t0 + 3600_000 }) });
  await p.pagar({ ...base, forma: "pix", idempotencyKey: "pedido-rel1" });
  assert.equal((await p.reconsultar("pedido-rel1")).estado, ESTADOS.APROVADO);
});

test("valor aprovado diferente pede atendente e nunca libera", async () => {
  const ad = { cobrar: async () => ({ estado: "aprovado", centavos: 1 }), consultar: async () => ({ estado: "cancelado" }) };
  const p = criarPagamentos({ adaptador: ad });
  const r = await p.pagar({ ...base, idempotencyKey: "pedido-dif1" });
  assert.equal(r.atendente, true);
  assert.equal((await p.reconsultar("pedido-dif1")).estado, ESTADOS.INCERTO);
  assert.equal(p.liberaCozinha("pedido-dif1"), false);
});
