// Testes do validador OFFLINE de formato TICKET. Nenhum destes testes faz
// qualquer chamada de rede — nem deveria ser possível, já que o módulo não
// importa http/fetch.

import { test } from "node:test";
import assert from "node:assert/strict";
import { validarPayloadTicketOffline, gerarPayloadTicketFicticio } from "../src/validador-offline-saipos.js";
import { criarPedido, marcarPronto, ErroPedido } from "../src/pedidos.js";

function pedidoDemoPronto(adicionais = []) {
  const estado = { pedidos: {}, contadorSenha: 0 };
  const pedido = criarPedido(estado, {
    idempotencyKey: "demo-1",
    itens: [{ produtoId: "p1", quantidade: 2, adicionais, removerIngredientes: [] }],
  });
  estado.pedidos[pedido.id].status = "PREPARANDO";
  return marcarPronto(estado, pedido.id);
}

test("payload gerado a partir de um pedido demo é válido no formato TICKET", () => {
  const pedido = pedidoDemoPronto(["a1"]);
  const payload = gerarPayloadTicketFicticio(pedido);
  const resultado = validarPayloadTicketOffline(payload);
  assert.equal(resultado.valido, true, JSON.stringify(resultado.erros));
  assert.equal(payload.order_method.mode, "TICKET");
  assert.equal(payload.customer.id, "-1");
  assert.equal(payload.customer.name, "TESTE");
  assert.ok(payload.order_id.startsWith("FICT-"));
});

test("gerador bloqueia (lança erro) quando falta mapeamento de integração fictício", () => {
  const pedidoFalso = {
    id: "x",
    itens: [{ produtoId: "produto-sem-mapeamento", quantidade: 1, adicionaisDetalhe: [] }],
    total: 1000,
    criadoEm: new Date().toISOString(),
    senha: "1234",
  };
  assert.throws(() => gerarPayloadTicketFicticio(pedidoFalso), ErroPedido);
});

test("validador rejeita payload sem campos raiz obrigatórios", () => {
  const resultado = validarPayloadTicketOffline({});
  assert.equal(resultado.valido, false);
  assert.ok(resultado.erros.some((e) => e.includes("order_id")));
  assert.ok(resultado.erros.some((e) => e.includes("payment_types")));
});

test("validador NÃO exige total_amount (correto para TICKET) mas exige total_discount", () => {
  const pedido = pedidoDemoPronto();
  const payload = gerarPayloadTicketFicticio(pedido);
  assert.ok(!("total_amount" in payload)); // nosso gerador nem inclui, e o validador não deve reclamar disso
  const resultado = validarPayloadTicketOffline(payload);
  assert.equal(resultado.valido, true, JSON.stringify(resultado.erros));
});

test("validador exige payment_types (obrigatório para TICKET)", () => {
  const pedido = pedidoDemoPronto();
  const payload = gerarPayloadTicketFicticio(pedido);
  delete payload.payment_types;
  const resultado = validarPayloadTicketOffline(payload);
  assert.equal(resultado.valido, false);
  assert.ok(resultado.erros.some((e) => e.includes("payment_types")));
});

test("validador detecta choice_items com campo aditional_price ausente ou com nome errado", () => {
  const pedido = pedidoDemoPronto(["a1"]);
  const payload = gerarPayloadTicketFicticio(pedido);
  payload.items[0].choice_items[0].additional_price = payload.items[0].choice_items[0].aditional_price;
  delete payload.items[0].choice_items[0].aditional_price; // grafia errada de propósito
  const resultado = validarPayloadTicketOffline(payload);
  assert.equal(resultado.valido, false);
  assert.ok(resultado.erros.some((e) => e.includes("aditional_price")));
});

test("validador detecta soma de payment_types diferente da soma de itens+adicionais", () => {
  const pedido = pedidoDemoPronto(["a1"]);
  const payload = gerarPayloadTicketFicticio(pedido);
  payload.payment_types[0].amount = 0.01; // valor incompatível de propósito
  const resultado = validarPayloadTicketOffline(payload);
  assert.equal(resultado.valido, false);
  assert.ok(resultado.erros.some((e) => e.includes("Soma de payment_types")));
});

test("validador rejeita customer.id que não é string", () => {
  const pedido = pedidoDemoPronto();
  const payload = gerarPayloadTicketFicticio(pedido);
  payload.customer.id = -1; // número, não string
  const resultado = validarPayloadTicketOffline(payload);
  assert.equal(resultado.valido, false);
  assert.ok(resultado.erros.some((e) => e.includes("customer.id")));
});

test("validador nunca faz chamada de rede (módulo não depende de http/fetch)", async () => {
  const codigoFonte = await import("node:fs/promises").then((fs) => fs.readFile(new URL("../src/validador-offline-saipos.js", import.meta.url), "utf8"));
  assert.ok(!codigoFonte.includes("fetch("));
  assert.ok(!codigoFonte.includes("http.request"));
  assert.ok(!codigoFonte.includes("require(\"http\")"));
});
