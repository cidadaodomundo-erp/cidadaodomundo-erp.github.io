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
