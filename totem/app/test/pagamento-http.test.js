// Servidor de demonstracao (tudo simulado): pedido so vai para a loja depois do pagamento aprovado.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { rm } from "node:fs/promises";
import { subirDemo } from "../bin/start-demo.js";

const demo = await subirDemo({ porta: 0, pixSegundos: 0.2, cartaoSegundos: 0, log: () => {} });
after(async () => { demo.server.closeAllConnections?.(); demo.server.close(); await rm(demo.dir, { recursive: true, force: true }); });
const B = `http://127.0.0.1:${demo.porta}`;
const cfg = await (await fetch(B + "/api/hml/config")).json();
const menu = await (await fetch(B + "/api/hml/cardapio")).json();
const p = menu.produtos.find((x) => x.disponivelAgora && x.grupos.every((g) => menu.grupos.find((y) => y.id === g).minimo === 0) && x.variacoes.length === 1);
const itens = [{ produto: p.id, variacao: p.variacoes[0].indice, quantidade: 2, opcoes: [] }];
const post = (caminho, corpo) => fetch(B + caminho, { method: "POST", headers: { "content-type": "application/json", origin: B, "x-csrf-token": cfg.csrf }, body: JSON.stringify(corpo) });
const K = (n) => `dddddddd-0000-4000-8000-${String(n).padStart(12, "0")}`;
const espera = (ms) => new Promise((r) => setTimeout(r, ms));

test("config anuncia as formas de pagamento", () => {
  assert.deepEqual(cfg.pagamento.formas, ["pix", "debito", "credito"]);
});

test("sem pagamento o pedido NAO vai para a loja (402)", async () => {
  const r = await post("/api/hml/carrinho", { idempotencyKey: K(1), itens });
  assert.equal(r.status, 402);
});

test("Pix: QR na tela, banco confirma, pedido vai com o valor calculado pelo servidor", async () => {
  const r = await (await post("/api/hml/pagamento", { idempotencyKey: K(2), forma: "pix", itens })).json();
  assert.equal(r.estado, "aguardando");
  assert.ok(r.qr);
  assert.equal(r.totalCentavos, p.variacoes[0].centavos * 2);
  assert.equal((await post("/api/hml/carrinho", { idempotencyKey: K(2), itens })).status, 402);
  await espera(400);
  const ok = await (await fetch(`${B}/api/hml/pagamento?chave=${K(2)}`)).json();
  assert.equal(ok.estado, "aprovado");
  const pedido = await (await post("/api/hml/carrinho", { idempotencyKey: K(2), itens })).json();
  assert.equal(pedido.estado, "aceito");
  assert.ok(pedido.senha);
});

test("pagar um carrinho e mandar outro (mais caro) com a mesma chave e bloqueado", async () => {
  await post("/api/hml/pagamento", { idempotencyKey: K(3), forma: "debito", itens });
  await espera(50);
  await fetch(`${B}/api/hml/pagamento?chave=${K(3)}`);
  const maior = [{ ...itens[0], quantidade: 3 }];
  assert.equal((await post("/api/hml/carrinho", { idempotencyKey: K(3), itens: maior })).status, 402);
  assert.equal((await post("/api/hml/pagamento", { idempotencyKey: K(3), forma: "debito", itens: maior })).status, 409);
});

test("forma desconhecida e recusada", async () => {
  assert.equal((await post("/api/hml/pagamento", { idempotencyKey: K(4), forma: "fiado", itens })).status, 400);
});
