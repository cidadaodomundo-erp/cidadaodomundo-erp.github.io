import { test } from "node:test";
import assert from "node:assert/strict";
import {
  calcularPedido,
  criarPedido,
  confirmarPagamentoSimulado,
  marcarPronto,
  marcarRetirado,
  cancelarPedido,
  ErroPedido,
  LOJA_FICTICIA_ID,
} from "../src/pedidos.js";
import { Store } from "../src/store.js";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

async function novoStoreTemporario() {
  const dir = await mkdtemp(join(tmpdir(), "lab-totem-"));
  const store = new Store(join(dir, "pedidos.json"));
  await store.carregar();
  return { store, dir };
}

test("calcula total somando adicionais e ignorando remoções no preço", () => {
  const { total, itens } = calcularPedido([
    { produtoId: "p1", quantidade: 2, adicionais: ["a1"], removerIngredientes: ["ing1"] },
  ]);
  assert.equal(itens[0].precoUnitario, 1500 + 400);
  assert.equal(total, (1500 + 400) * 2);
});

test("adicionais e remoções duplicados na mesma lista são deduplicados", () => {
  const { itens } = calcularPedido([
    { produtoId: "p1", quantidade: 1, adicionais: ["a1", "a1"], removerIngredientes: ["ing1", "ing1"] },
  ]);
  assert.equal(itens[0].adicionais.length, 1);
  assert.equal(itens[0].removerIngredientes.length, 1);
});

test("rejeita produto desconhecido", () => {
  assert.throws(() => calcularPedido([{ produtoId: "inexistente" }]), ErroPedido);
});

test("rejeita adicional não permitido para o produto", () => {
  assert.throws(() => calcularPedido([{ produtoId: "p2", adicionais: ["a1"] }]), ErroPedido);
});

test("rejeita quantidade inválida (fora de 1..20)", () => {
  assert.throws(() => calcularPedido([{ produtoId: "p1", quantidade: 0 }]), ErroPedido);
  assert.throws(() => calcularPedido([{ produtoId: "p1", quantidade: 1.5 }]), ErroPedido);
  assert.throws(() => calcularPedido([{ produtoId: "p1", quantidade: 21 }]), ErroPedido);
});

test("rejeita pedido com mais de 100 itens", () => {
  const itens = Array.from({ length: 101 }, () => ({ produtoId: "p2", quantidade: 1 }));
  assert.throws(() => calcularPedido(itens), ErroPedido);
});

test("criarPedido exige idempotencyKey", () => {
  assert.throws(
    () => criarPedido({ pedidos: {} }, { itens: [{ produtoId: "p1" }] }),
    ErroPedido
  );
});

test("criarPedido rejeita loja diferente da loja fictícia fixa", () => {
  assert.throws(
    () => criarPedido({ pedidos: {} }, { idempotencyKey: "k1", itens: [{ produtoId: "p1" }], lojaId: "OUTRA-LOJA" }),
    ErroPedido
  );
});

test("criarPedido aceita a loja fictícia explícita e grava lojaId no pedido", () => {
  const estado = { pedidos: {} };
  const pedido = criarPedido(estado, { idempotencyKey: "k1", itens: [{ produtoId: "p1" }], lojaId: LOJA_FICTICIA_ID });
  assert.equal(pedido.lojaId, LOJA_FICTICIA_ID);
});

test("reenvio com mesma idempotencyKey e mesmo payload retorna o mesmo pedido (sem duplicar)", async () => {
  const { store, dir } = await novoStoreTemporario();
  const payload = { idempotencyKey: "k1", itens: [{ produtoId: "p1", quantidade: 1 }] };
  const pedido1 = await store.transacao((estado) => criarPedido(estado, payload));
  const pedido2 = await store.transacao((estado) => criarPedido(estado, payload));
  assert.equal(pedido1.id, pedido2.id);
  assert.equal(store.listarPedidos().length, 1);
  await rm(dir, { recursive: true, force: true });
});

test("reenvio com mesma idempotencyKey mas dados diferentes é rejeitado e não muda nada", async () => {
  const { store, dir } = await novoStoreTemporario();
  await store.transacao((estado) => criarPedido(estado, { idempotencyKey: "k1", itens: [{ produtoId: "p1", quantidade: 1 }] }));
  await assert.rejects(
    () => store.transacao((estado) => criarPedido(estado, { idempotencyKey: "k1", itens: [{ produtoId: "p1", quantidade: 2 }] })),
    ErroPedido
  );
  assert.equal(store.listarPedidos().length, 1);
  assert.equal(store.listarPedidos()[0].total, 1500);
  await rm(dir, { recursive: true, force: true });
});

test("pagamento simulado reprovado não avança o pedido e fica persistido como recusado", async () => {
  const { store, dir } = await novoStoreTemporario();
  const pedido = await store.transacao((estado) => criarPedido(estado, { idempotencyKey: "k1", itens: [{ produtoId: "p2", quantidade: 1 }] }));
  const atualizado = await store.transacao((estado) => confirmarPagamentoSimulado(estado, pedido.id, { idempotencyKey: "pg1", resultado: "recusado" }));
  assert.equal(atualizado.status, "CRIADO");
  assert.equal(atualizado.pagamento.resultado, "recusado");
  await rm(dir, { recursive: true, force: true });
});

test("pagamento simulado aprovado avança para PREPARANDO", async () => {
  const { store, dir } = await novoStoreTemporario();
  const pedido = await store.transacao((estado) => criarPedido(estado, { idempotencyKey: "k1", itens: [{ produtoId: "p2", quantidade: 1 }] }));
  const atualizado = await store.transacao((estado) => confirmarPagamentoSimulado(estado, pedido.id, { idempotencyKey: "pg1", resultado: "aprovado" }));
  assert.equal(atualizado.status, "PREPARANDO");
  await rm(dir, { recursive: true, force: true });
});

test("reenvio do mesmo pagamento (retry de rede) com mesmo resultado não reaplica/duplica efeito", async () => {
  const { store, dir } = await novoStoreTemporario();
  const pedido = await store.transacao((estado) => criarPedido(estado, { idempotencyKey: "k1", itens: [{ produtoId: "p2", quantidade: 1 }] }));
  await store.transacao((estado) => confirmarPagamentoSimulado(estado, pedido.id, { idempotencyKey: "pg1", resultado: "aprovado" }));
  const historicoAntes = store.obterPedido(pedido.id).historico.length;
  const repetido = await store.transacao((estado) => confirmarPagamentoSimulado(estado, pedido.id, { idempotencyKey: "pg1", resultado: "aprovado" }));
  assert.equal(repetido.historico.length, historicoAntes);
  await rm(dir, { recursive: true, force: true });
});

test("reenvio com mesma idempotencyKey de pagamento mas resultado diferente é rejeitado (não vira sucesso)", async () => {
  const { store, dir } = await novoStoreTemporario();
  const pedido = await store.transacao((estado) => criarPedido(estado, { idempotencyKey: "k1", itens: [{ produtoId: "p2", quantidade: 1 }] }));
  await store.transacao((estado) => confirmarPagamentoSimulado(estado, pedido.id, { idempotencyKey: "pg1", resultado: "recusado" }));
  await assert.rejects(
    () => store.transacao((estado) => confirmarPagamentoSimulado(estado, pedido.id, { idempotencyKey: "pg1", resultado: "aprovado" })),
    ErroPedido
  );
  assert.equal(store.obterPedido(pedido.id).status, "CRIADO"); // continua recusado, nunca virou sucesso
  await rm(dir, { recursive: true, force: true });
});

test("não permite pagar pedido com idempotencyKey diferente depois de já ter tentativa registrada", async () => {
  const { store, dir } = await novoStoreTemporario();
  const pedido = await store.transacao((estado) => criarPedido(estado, { idempotencyKey: "k1", itens: [{ produtoId: "p2", quantidade: 1 }] }));
  await store.transacao((estado) => confirmarPagamentoSimulado(estado, pedido.id, { idempotencyKey: "pg1", resultado: "aprovado" }));
  await assert.rejects(
    () => store.transacao((estado) => confirmarPagamentoSimulado(estado, pedido.id, { idempotencyKey: "pg2", resultado: "aprovado" })),
    ErroPedido
  );
  await rm(dir, { recursive: true, force: true });
});

test("marcarPronto exige status PREPARANDO (não depende de pagamento do aparelho)", () => {
  const estado = { pedidos: { x: { id: "x", status: "CRIADO", historico: [] } }, contadorSenha: 0 };
  assert.throws(() => marcarPronto(estado, "x"), ErroPedido);

  const estadoOk = { pedidos: {}, contadorSenha: 0 };
  const criado = criarPedido(estadoOk, { idempotencyKey: "pronto-real", itens: [{ produtoId: "p2", quantidade: 1 }] });
  confirmarPagamentoSimulado(estadoOk, criado.id, { idempotencyKey: "pag-pronto", resultado: "aprovado" });
  const pedidoOk = marcarPronto(estadoOk, criado.id);
  assert.equal(pedidoOk.status, "PRONTO");
  assert.ok(pedidoOk.senha);
});

test("senhas de dois pedidos consecutivos são diferentes (alocadas por contador, não pelo histórico)", () => {
  const estado = { pedidos: {}, contadorSenha: 0 };
  const a = criarPedido(estado, { idempotencyKey: "senha-a", itens: [{ produtoId: "p2", quantidade: 1 }] });
  const b = criarPedido(estado, { idempotencyKey: "senha-b", itens: [{ produtoId: "p2", quantidade: 1 }] });
  confirmarPagamentoSimulado(estado, a.id, { idempotencyKey: "pag-a", resultado: "aprovado" });
  confirmarPagamentoSimulado(estado, b.id, { idempotencyKey: "pag-b", resultado: "aprovado" });
  const pa = marcarPronto(estado, a.id);
  const pb = marcarPronto(estado, b.id);
  assert.notEqual(pa.senha, pb.senha);
});

test("marcarRetirado exige status PRONTO", () => {
  const estado = { pedidos: { x: { id: "x", status: "PREPARANDO", historico: [] } } };
  assert.throws(() => marcarRetirado(estado, "x"), ErroPedido);
});

test("cancelarPedido não é permitido depois de PRONTO", () => {
  const estado = { pedidos: { x: { id: "x", status: "PRONTO", historico: [] } } };
  assert.throws(() => cancelarPedido(estado, "x"), ErroPedido);
});

test("fluxo completo de transições válidas", () => {
  const estado = { pedidos: { x: { id: "x", status: "CRIADO", pagamento: null, historico: [] } }, contadorSenha: 0 };
  confirmarPagamentoSimulado(estado, "x", { idempotencyKey: "pg1", resultado: "aprovado" });
  assert.equal(estado.pedidos.x.status, "PREPARANDO");
  marcarPronto(estado, "x");
  assert.equal(estado.pedidos.x.status, "PRONTO");
  marcarRetirado(estado, "x");
  assert.equal(estado.pedidos.x.status, "RETIRADO");
});
