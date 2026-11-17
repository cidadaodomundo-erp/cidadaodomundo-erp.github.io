import { test } from "node:test";
import assert from "node:assert/strict";
import { criarPagamentos, ESTADOS } from "../src/pagamento.js";
import { adaptadorPix, bancoPixSimulado, txidDoPedido } from "../src/pix.js";

function montar() {
  const banco = bancoPixSimulado();
  const pag = criarPagamentos({ adaptador: adaptadorPix({ banco, chavePix: "00000000000000" }) });
  return { banco, pag };
}
const pedido = { idempotencyKey: "pedido-pix-0001", centavos: 3990, forma: "pix" };

test("Pix mostra QR e fica aguardando, sem liberar a cozinha", async () => {
  const { pag } = montar();
  const r = await pag.pagar(pedido);
  assert.equal(r.estado, ESTADOS.AGUARDANDO);
  assert.match(r.qr, /^00020126/);
  assert.equal(pag.liberaCozinha(pedido.idempotencyKey), false);
});

test("Pix pago no banco vira aprovado e libera", async () => {
  const { banco, pag } = montar();
  await pag.pagar(pedido);
  banco.pagar(txidDoPedido(pedido.idempotencyKey));
  const r = await pag.reconsultar(pedido.idempotencyKey);
  assert.equal(r.estado, ESTADOS.APROVADO);
  assert.equal(pag.liberaCozinha(pedido.idempotencyKey), true);
});

test("tocar de novo nao cria segunda cobranca Pix", async () => {
  const { banco, pag } = montar();
  await pag.pagar(pedido);
  await pag.pagar(pedido);
  assert.equal(banco.criadas, 1);
});

test("Pix pago com valor diferente nao libera", async () => {
  const { banco, pag } = montar();
  await pag.pagar(pedido);
  banco.pagar(txidDoPedido(pedido.idempotencyKey), "0.01");
  const r = await pag.reconsultar(pedido.idempotencyKey);
  assert.equal(r.estado, ESTADOS.INCERTO);
  assert.equal(pag.liberaCozinha(pedido.idempotencyKey), false);
});

test("Pix expirado vira cancelado", async () => {
  const { banco, pag } = montar();
  await pag.pagar(pedido);
  banco.expirar(txidDoPedido(pedido.idempotencyKey));
  assert.equal((await pag.reconsultar(pedido.idempotencyKey)).estado, ESTADOS.CANCELADO);
});

test("txid segue a regra do Banco Central (26 a 35 letras/numeros)", () => {
  assert.match(txidDoPedido("a-b"), /^[a-zA-Z0-9]{26,35}$/);
  assert.match(txidDoPedido("x".repeat(80)), /^[a-zA-Z0-9]{26,35}$/);
});

test("QR vencido vira cancelado e o banco nao aceita mais pagamento", async () => {
  const { adaptadorPix, bancoPixSimulado, txidDoPedido, VALIDADE_SEGUNDOS, FOLGA_VENCIMENTO_MS } = await import("../src/pix.js");
  let t = Date.parse("2026-11-17T12:00:00Z");
  const banco = bancoPixSimulado({ agora: () => t });
  const a = adaptadorPix({ banco, chavePix: "chave-teste", agora: () => t });
  const r = await a.cobrar({ idempotencyKey: "pedido-venc1", centavos: 1000, forma: "pix" });
  assert.equal(r.estado, "aguardando");
  assert.ok(r.expiraEm);
  t += VALIDADE_SEGUNDOS * 1000 + FOLGA_VENCIMENTO_MS + 1;
  assert.equal((await a.consultar({ idempotencyKey: "pedido-venc1" })).estado, "cancelado");
});

test("cancelar Pix remove a cobranca no banco", async () => {
  const { adaptadorPix, bancoPixSimulado, txidDoPedido } = await import("../src/pix.js");
  const banco = bancoPixSimulado();
  const a = adaptadorPix({ banco, chavePix: "chave-teste" });
  await a.cobrar({ idempotencyKey: "pedido-canc1", centavos: 1000, forma: "pix" });
  await a.cancelar({ idempotencyKey: "pedido-canc1" });
  assert.equal(banco.pagar(txidDoPedido("pedido-canc1")), false);
  assert.equal((await a.consultar({ idempotencyKey: "pedido-canc1" })).estado, "cancelado");
});
