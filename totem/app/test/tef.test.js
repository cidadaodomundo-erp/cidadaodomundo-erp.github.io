import { test } from "node:test";
import assert from "node:assert/strict";
import { adaptadorTef, tefSimulado } from "../src/tef.js";
import { criarPagamentos, adaptadorPorForma } from "../src/pagamento.js";

test("cartao: fica aguardando na maquininha e so libera depois de aprovado", async () => {
  let t = 0;
  const provedor = tefSimulado({ aprovarDepoisMs: 5000, agora: () => t });
  const pg = criarPagamentos({ adaptador: adaptadorTef({ provedor }) });
  const r = await pg.pagar({ idempotencyKey: "pedido-0001", centavos: 3399, forma: "credito" });
  assert.equal(r.estado, "aguardando");
  assert.match(r.mensagem, /maquininha/);
  assert.equal(pg.liberaCozinha("pedido-0001"), false);
  t = 6000;
  const ok = await pg.reconsultar("pedido-0001");
  assert.equal(ok.estado, "aprovado");
  assert.ok(ok.autorizacao);
  assert.equal(pg.liberaCozinha("pedido-0001"), true);
});

test("cartao: repetir o pedido nunca cobra duas vezes", async () => {
  const provedor = tefSimulado({ aprovarDepoisMs: 0 });
  const pg = criarPagamentos({ adaptador: adaptadorTef({ provedor }) });
  await pg.pagar({ idempotencyKey: "pedido-0002", centavos: 1000, forma: "debito" });
  await pg.pagar({ idempotencyKey: "pedido-0002", centavos: 1000, forma: "debito" });
  assert.equal(provedor.solicitadas, 1);
});

test("cartao recusado nao libera a cozinha", async () => {
  let t = 0;
  const provedor = tefSimulado({ aprovarDepoisMs: 1, roteiro: { "pedido-0003": "recusado" }, agora: () => t });
  const pg = criarPagamentos({ adaptador: adaptadorTef({ provedor }) });
  await pg.pagar({ idempotencyKey: "pedido-0003", centavos: 1000, forma: "debito" });
  t = 10;
  assert.equal((await pg.reconsultar("pedido-0003")).estado, "recusado");
  assert.equal(pg.liberaCozinha("pedido-0003"), false);
});

test("resposta estranha do provedor vira incerto (nao libera, nao cobra de novo)", async () => {
  const provedor = { solicitar: async () => ({ status: "??" }), consultar: async () => ({ status: "??" }) };
  const pg = criarPagamentos({ adaptador: adaptadorTef({ provedor }) });
  const r = await pg.pagar({ idempotencyKey: "pedido-0004", centavos: 1000, forma: "credito" });
  assert.equal(r.estado, "incerto");
  assert.equal(pg.liberaCozinha("pedido-0004"), false);
});

test("adaptadorTef recusa Pix e provedor invalido", async () => {
  assert.throws(() => adaptadorTef({ provedor: {} }));
  const a = adaptadorTef({ provedor: tefSimulado() });
  await assert.rejects(() => a.cobrar({ idempotencyKey: "x", centavos: 1, forma: "pix" }));
});

test("adaptadorPorForma escolhe o adaptador certo e consulta pela forma usada", async () => {
  const usados = [];
  const falso = (nome) => ({
    cobrar: async ({ centavos }) => { usados.push(nome); return { estado: "aguardando", centavos }; },
    consultar: async () => { usados.push(nome + "?"); return { estado: "aprovado", centavos: 500 }; },
  });
  const pg = criarPagamentos({ adaptador: adaptadorPorForma({ pix: falso("pix"), debito: falso("tef") }) });
  await pg.pagar({ idempotencyKey: "pedido-0005", centavos: 500, forma: "debito" });
  assert.equal((await pg.reconsultar("pedido-0005")).estado, "aprovado");
  assert.deepEqual(usados, ["tef", "tef?"]);
  await assert.rejects(() => adaptadorPorForma({ pix: falso("pix") }).cobrar({ idempotencyKey: "k", forma: "credito" }));
});
