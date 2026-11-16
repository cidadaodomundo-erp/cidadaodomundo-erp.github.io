import { test } from "node:test";
import assert from "node:assert/strict";
import { Store } from "../src/store.js";
import { criarPedido, marcarPronto, ErroPedido } from "../src/pedidos.js";
import { mkdtemp, rm, writeFile, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

test("persiste pedido e recupera após 'restart' (nova instância do Store)", async () => {
  const dir = await mkdtemp(join(tmpdir(), "lab-totem-"));
  const arquivo = join(dir, "pedidos.json");

  const store1 = new Store(arquivo);
  await store1.carregar();
  await store1.transacao((estado) => criarPedido(estado, { idempotencyKey: "k1", itens: [{ produtoId: "p2", quantidade: 1 }] }));

  const store2 = new Store(arquivo); // simula restart: nova instância lendo o mesmo arquivo
  await store2.carregar();
  const pedidos = store2.listarPedidos();

  assert.equal(pedidos.length, 1);
  assert.equal(pedidos[0].status, "CRIADO");

  await rm(dir, { recursive: true, force: true });
});

test("contador de senha sobrevive a restart: próxima senha depois do restart não repete a anterior", async () => {
  const dir = await mkdtemp(join(tmpdir(), "lab-totem-"));
  const arquivo = join(dir, "pedidos.json");

  const store1 = new Store(arquivo);
  await store1.carregar();
  const pedido1 = await store1.transacao((estado) => criarPedido(estado, { idempotencyKey: "k1", itens: [{ produtoId: "p2", quantidade: 1 }] }));
  await store1.transacao((estado) => {
    estado.pedidos[pedido1.id].status = "PREPARANDO";
    return marcarPronto(estado, pedido1.id);
  });
  const senha1 = store1.obterPedido(pedido1.id).senha;

  const store2 = new Store(arquivo); // restart
  await store2.carregar();
  const pedido2 = await store2.transacao((estado) => criarPedido(estado, { idempotencyKey: "k2", itens: [{ produtoId: "p2", quantidade: 1 }] }));
  await store2.transacao((estado) => {
    estado.pedidos[pedido2.id].status = "PREPARANDO";
    return marcarPronto(estado, pedido2.id);
  });
  const senha2 = store2.obterPedido(pedido2.id).senha;

  assert.notEqual(senha1, senha2);

  await rm(dir, { recursive: true, force: true });
});

test("duas transações concorrentes de marcarPronto não geram a mesma senha (fila serial)", async () => {
  const dir = await mkdtemp(join(tmpdir(), "lab-totem-"));
  const store = new Store(join(dir, "pedidos.json"));
  await store.carregar();

  const pedidoA = await store.transacao((estado) => criarPedido(estado, { idempotencyKey: "ka", itens: [{ produtoId: "p2", quantidade: 1 }] }));
  const pedidoB = await store.transacao((estado) => criarPedido(estado, { idempotencyKey: "kb", itens: [{ produtoId: "p2", quantidade: 1 }] }));
  await store.transacao((estado) => { estado.pedidos[pedidoA.id].status = "PREPARANDO"; });
  await store.transacao((estado) => { estado.pedidos[pedidoB.id].status = "PREPARANDO"; });

  // Disparadas "ao mesmo tempo" (sem await entre elas): a fila serial do Store
  // garante que uma transação só começa depois da outra terminar.
  const [resultadoA, resultadoB] = await Promise.all([
    store.transacao((estado) => marcarPronto(estado, pedidoA.id)),
    store.transacao((estado) => marcarPronto(estado, pedidoB.id)),
  ]);

  assert.notEqual(resultadoA.senha, resultadoB.senha);

  await rm(dir, { recursive: true, force: true });
});

test("não sobrescreve dados de outro arquivo/Store", async () => {
  const dir = await mkdtemp(join(tmpdir(), "lab-totem-"));
  const storeA = new Store(join(dir, "a.json"));
  const storeB = new Store(join(dir, "b.json"));
  await storeA.carregar();
  await storeB.carregar();

  await storeA.transacao((estado) => criarPedido(estado, { idempotencyKey: "ka", itens: [{ produtoId: "p2", quantidade: 1 }] }));
  await storeB.transacao((estado) => criarPedido(estado, { idempotencyKey: "kb", itens: [{ produtoId: "p2", quantidade: 1 }] }));

  assert.equal(storeA.listarPedidos().length, 1);
  assert.equal(storeB.listarPedidos().length, 1);

  await rm(dir, { recursive: true, force: true });
});

test("carregar em arquivo inexistente cria estado vazio com schema válido, sem erro", async () => {
  const dir = await mkdtemp(join(tmpdir(), "lab-totem-"));
  const store = new Store(join(dir, "novo.json"));
  const estado = await store.carregar();
  assert.deepEqual(estado.pedidos, {});
  assert.equal(estado.contadorSenha, 0);
  assert.equal(estado.version, 1);
  await rm(dir, { recursive: true, force: true });
});

test("arquivo JSON corrompido falha fechado: carregar lança erro e NÃO apaga/sobrescreve o arquivo", async () => {
  const dir = await mkdtemp(join(tmpdir(), "lab-totem-"));
  const arquivo = join(dir, "pedidos.json");
  await writeFile(arquivo, "{ isso nao e json valido", "utf8");

  const store = new Store(arquivo);
  await assert.rejects(() => store.carregar());

  const conteudoAposFalha = await readFile(arquivo, "utf8");
  assert.equal(conteudoAposFalha, "{ isso nao e json valido"); // intocado

  await rm(dir, { recursive: true, force: true });
});

test("schema com version inesperada falha fechado sem apagar o arquivo", async () => {
  const dir = await mkdtemp(join(tmpdir(), "lab-totem-"));
  const arquivo = join(dir, "pedidos.json");
  const conteudoOriginal = JSON.stringify({ version: 99, pedidos: {}, contadorSenha: 0 });
  await writeFile(arquivo, conteudoOriginal, "utf8");

  const store = new Store(arquivo);
  await assert.rejects(() => store.carregar());

  const conteudoAposFalha = await readFile(arquivo, "utf8");
  assert.equal(conteudoAposFalha, conteudoOriginal);

  await rm(dir, { recursive: true, force: true });
});

test("transação que lança erro não muda o arquivo em disco nem a memória", async () => {
  const dir = await mkdtemp(join(tmpdir(), "lab-totem-"));
  const arquivo = join(dir, "pedidos.json");
  const store = new Store(arquivo);
  await store.carregar();

  await store.transacao((estado) => criarPedido(estado, { idempotencyKey: "k1", itens: [{ produtoId: "p2", quantidade: 1 }] }));
  const conteudoAntes = await readFile(arquivo, "utf8");

  await assert.rejects(
    () => store.transacao((estado) => criarPedido(estado, { idempotencyKey: "k1", itens: [{ produtoId: "p1", quantidade: 1 }] })), // mesma key, payload diferente
    ErroPedido
  );

  const conteudoDepois = await readFile(arquivo, "utf8");
  assert.equal(conteudoAntes, conteudoDepois);
  assert.equal(store.listarPedidos().length, 1);

  await rm(dir, { recursive: true, force: true });
});
