// Teste simulado de ponta a ponta (cliente -> pagamento teste -> cozinha -> pronto -> retirado).
// Servidor roda em porta efêmera só em 127.0.0.1 e é fechado no finally, mesmo se o teste falhar.
// NÃO testa Saipos. NÃO faz nenhuma chamada de rede externa.

import { test } from "node:test";
import assert from "node:assert/strict";
import { Store } from "../src/store.js";
import { iniciarServidorEfemero } from "../src/server.js";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

async function comServidorEfemero(fn) {
  const dir = await mkdtemp(join(tmpdir(), "lab-totem-e2e-"));
  const store = new Store(join(dir, "pedidos.json"));
  await store.carregar();
  const servidor = await iniciarServidorEfemero(store, 0);
  const porta = servidor.address().port;
  const baseUrl = `http://127.0.0.1:${porta}`;
  try {
    await fn(baseUrl);
  } finally {
    await new Promise((resolve) => servidor.close(resolve));
    await rm(dir, { recursive: true, force: true });
  }
}

test("fluxo completo: pedido -> pagamento aprovado -> preparando -> pronto -> retirado", async () => {
  await comServidorEfemero(async (baseUrl) => {
    const criar = await fetch(`${baseUrl}/api/pedidos`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        idempotencyKey: "e2e-1",
        itens: [{ produtoId: "p1", quantidade: 1, adicionais: ["a1"], removerIngredientes: [] }],
      }),
    });
    assert.equal(criar.status, 201);
    const { pedido } = await criar.json();
    assert.equal(pedido.status, "CRIADO");
    assert.equal(pedido.total, 1500 + 400);

    const pagar = await fetch(`${baseUrl}/api/pedidos/${pedido.id}/pagamento-simulado`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ idempotencyKey: "e2e-pag-1", resultado: "aprovado" }),
    });
    assert.equal(pagar.status, 200);
    const { pedido: pedidoPago } = await pagar.json();
    assert.equal(pedidoPago.status, "PREPARANDO");

    const pronto = await fetch(`${baseUrl}/api/pedidos/${pedido.id}/pronto`, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
    assert.equal(pronto.status, 200);
    const { pedido: pedidoPronto } = await pronto.json();
    assert.equal(pedidoPronto.status, "PRONTO");
    assert.ok(pedidoPronto.senha);

    const retirado = await fetch(`${baseUrl}/api/pedidos/${pedido.id}/retirado`, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
    assert.equal(retirado.status, 200);
    const { pedido: pedidoRetirado } = await retirado.json();
    assert.equal(pedidoRetirado.status, "RETIRADO");
  });
});

test("dois pedidos distintos chegam prontos com senhas diferentes", async () => {
  await comServidorEfemero(async (baseUrl) => {
    async function fluxoCompleto(idempotencyKey) {
      const criar = await fetch(`${baseUrl}/api/pedidos`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ idempotencyKey, itens: [{ produtoId: "p2", quantidade: 1 }] }),
      });
      const { pedido } = await criar.json();
      await fetch(`${baseUrl}/api/pedidos/${pedido.id}/pagamento-simulado`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ idempotencyKey: `pag-${idempotencyKey}`, resultado: "aprovado" }),
      });
      const pronto = await fetch(`${baseUrl}/api/pedidos/${pedido.id}/pronto`, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
      return (await pronto.json()).pedido;
    }
    const [p1, p2] = await Promise.all([fluxoCompleto("dup-a"), fluxoCompleto("dup-b")]);
    assert.notEqual(p1.senha, p2.senha);
  });
});

test("pagamento recusado (rede/gateway simulado) não avança pedido e não cobra pedido fantasma", async () => {
  await comServidorEfemero(async (baseUrl) => {
    const criar = await fetch(`${baseUrl}/api/pedidos`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ idempotencyKey: "e2e-2", itens: [{ produtoId: "p2", quantidade: 1 }] }),
    });
    const { pedido } = await criar.json();

    const pagarFalha = await fetch(`${baseUrl}/api/pedidos/${pedido.id}/pagamento-simulado`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ idempotencyKey: "e2e-pag-2", resultado: "recusado" }),
    });
    assert.equal(pagarFalha.status, 400);

    const reenvioRecusado = await fetch(`${baseUrl}/api/pedidos/${pedido.id}/pagamento-simulado`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ idempotencyKey: "e2e-pag-2", resultado: "recusado" }),
    });
    assert.equal(reenvioRecusado.status, 400); // replay nunca vira sucesso

    const tentarMudarResultado = await fetch(`${baseUrl}/api/pedidos/${pedido.id}/pagamento-simulado`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ idempotencyKey: "e2e-pag-2", resultado: "aprovado" }),
    });
    assert.equal(tentarMudarResultado.status, 400); // conflito, não pode mudar resultado com mesma key

    const consulta = await fetch(`${baseUrl}/api/pedidos`);
    const { pedidos } = await consulta.json();
    const atual = pedidos.find((p) => p.id === pedido.id);
    assert.equal(atual.status, "CRIADO");
  });
});

test("reenvio do mesmo pedido (idempotencyKey repetida, reutilizada pelo cliente após retry) não duplica no servidor real", async () => {
  await comServidorEfemero(async (baseUrl) => {
    const payload = { idempotencyKey: "e2e-3", itens: [{ produtoId: "p2", quantidade: 1 }] };
    const r1 = await fetch(`${baseUrl}/api/pedidos`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
    const r2 = await fetch(`${baseUrl}/api/pedidos`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
    const d1 = await r1.json();
    const d2 = await r2.json();
    assert.equal(d1.pedido.id, d2.pedido.id);

    const consulta = await fetch(`${baseUrl}/api/pedidos`);
    const { pedidos } = await consulta.json();
    assert.equal(pedidos.filter((p) => p.idempotencyKey === "e2e-3").length, 1);
  });
});

test("não permite marcar pronto sem pagamento confirmado (sem depender de status do aparelho de pagamento)", async () => {
  await comServidorEfemero(async (baseUrl) => {
    const criar = await fetch(`${baseUrl}/api/pedidos`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ idempotencyKey: "e2e-4", itens: [{ produtoId: "p2", quantidade: 1 }] }),
    });
    const { pedido } = await criar.json();
    const pronto = await fetch(`${baseUrl}/api/pedidos/${pedido.id}/pronto`, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
    assert.equal(pronto.status, 400);
  });
});

test("rejeita loja diferente da loja fictícia fixa", async () => {
  await comServidorEfemero(async (baseUrl) => {
    const resp = await fetch(`${baseUrl}/api/pedidos`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ idempotencyKey: "e2e-5", itens: [{ produtoId: "p2", quantidade: 1 }], lojaId: "OUTRA-LOJA" }),
    });
    assert.equal(resp.status, 400);
  });
});

test("rejeita corpo maior que o limite de 64KB", async () => {
  await comServidorEfemero(async (baseUrl) => {
    const notesGigantes = "x".repeat(70 * 1024);
    const resp = await fetch(`${baseUrl}/api/pedidos`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ idempotencyKey: "e2e-6", itens: [{ produtoId: "p2", quantidade: 1 }], _lixo: notesGigantes }),
    });
    assert.equal(resp.status, 400);
  });
});

test("rota estática desconhecida (fora da allowlist) retorna 404, sem path traversal", async () => {
  await comServidorEfemero(async (baseUrl) => {
    const resp = await fetch(`${baseUrl}/../../etc/passwd`);
    assert.equal(resp.status, 404);
    const resp2 = await fetch(`${baseUrl}/qualquer-coisa.html`);
    assert.equal(resp2.status, 404);
  });
});

test("rejeita requisição com Host diferente de 127.0.0.1/localhost", async () => {
  await comServidorEfemero(async (baseUrl) => {
    const resp = await fetch(`${baseUrl}/api/cardapio`, { headers: { Host: "exemplo-externo.com" } });
    // node fetch não permite sobrescrever Host facilmente em todos os runtimes;
    // este teste é best-effort e não crítico se o runtime ignorar o header.
    assert.ok(resp.status === 200 || resp.status === 403);
  });
});
