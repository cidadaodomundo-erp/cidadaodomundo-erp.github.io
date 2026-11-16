// Integracao TV automatica: app HML real em loopback + receptor em porta efemera 127.0.0.1.
// fetch/relogio/catalogo/mapa FAKE, pasta privada TEMPORARIA com credenciais FAKE. Sem rede externa, sem Saipos real.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { mkdtemp, writeFile, rm, rename, mkdir, stat, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, basename, dirname } from "node:path";
import { randomUUID } from "node:crypto";
import { criarServidorHml, COD_STORE_TESTE, SENHA_INICIAL } from "../src/saipos-hml.js";
import { dtoFixtureV2, catalogoHmlV2, mapaFixtureV2, AS_12H } from "./fixture-cardapio.js";

const PREFIXO = "hml-tvauto-test-";
const SEGREDO = "FAKE-SECRET-aaaa1111";
const PARCEIRO = "FAKE-PARTNER-bbbb2222";
const TOKEN = "FAKE.TOKEN.cccc3333";
const LINK = "https://saipos-integration-services-catalog-production.s3.us-east-1.amazonaws.com/catalog/catalog-1.json";
const WH = "d".repeat(64); // segredo FAKE do webhook
const K = (n) => `bbbbbbbb-0000-4000-8000-${String(n).padStart(12, "0")}`;

const dirs = [];
const servers = [];
after(async () => {
  for (const s of servers) { s.closeAllConnections?.(); s.close(); }
  for (const d of dirs) if (basename(d).startsWith(PREFIXO) && dirname(d) === tmpdir()) await rm(d, { recursive: true, force: true });
});

const resp = (status, obj) => ({ status, text: async () => JSON.stringify(obj) });
const itens = () => [{ produto: 10, variacao: 1, quantidade: 1, opcoes: [{ opcao: 22, quantidade: 1 }, { opcao: 25, quantidade: 1 }] }];

function criarFetch(ordem) {
  const chamadas = [];
  const f = async (url, init = {}) => {
    chamadas.push({ url, corpo: init.body });
    if (url.endsWith("/auth")) return resp(200, { token: TOKEN });
    if (url.endsWith("/v2/catalog")) return resp(200, { url: LINK });
    if (url === LINK) return resp(200, { data: catalogoHmlV2() });
    if (url.endsWith("/order")) return ordem ? ordem(init) : resp(200, {});
    throw new Error("url inesperada");
  };
  f.pedidos = () => chamadas.filter((c) => c.url.endsWith("/order"));
  return f;
}

async function subir({ auto = true, dir, ordem, flag } = {}) {
  if (!dir) {
    dir = await mkdtemp(join(tmpdir(), PREFIXO));
    dirs.push(dir);
    await writeFile(join(dir, ".env"), `SAIPOS_SECRET=${SEGREDO}\n`);
    await writeFile(join(dir, "test-store.json"), JSON.stringify({
      storeId: "93936", environment: "desenvolvimento", testStoreVerified: true,
      expectedName: "Cidadão do Mundo - HML", codStore: COD_STORE_TESTE, idPartner: PARCEIRO,
    }));
    await writeFile(join(dir, "gama-dto.json"), JSON.stringify(dtoFixtureV2()));
    await writeFile(join(dir, "gama-hml-map.json"), JSON.stringify(mapaFixtureV2()));
  }
  const f = criarFetch(ordem);
  const server = await criarServidorHml({
    envPath: join(dir, ".env"), fetchImpl: f, timeoutMs: 3000, gamaPath: join(dir, "gama-dto.json"), agora: () => AS_12H,
    ...(auto ? { tvAutomatica: { webhook: { segredo: WH, porta: 0, ...(flag !== undefined ? { prontoAoConcluirHml: flag } : {}) } } } : {}),
  });
  await new Promise((r) => server.listen(0, r));
  servers.push(server);
  return { dir, f, server, porta: server.address().port, whPorta: server.webhookPorta() };
}

function chamar(porta, { metodo = "GET", caminho = "/", headers = {}, corpo } = {}) {
  return new Promise((ok, fail) => {
    const dados = corpo === undefined ? undefined : JSON.stringify(corpo);
    const h = { ...headers };
    if (dados !== undefined) h["content-length"] = Buffer.byteLength(dados);
    const r = http.request({ host: "127.0.0.1", port: porta, method: metodo, path: caminho, headers: h }, (res) => {
      let t = "";
      res.on("data", (d) => (t += d));
      res.on("end", () => { let json = null; try { json = JSON.parse(t); } catch { /* texto */ } ok({ status: res.statusCode, texto: t, json }); });
    });
    r.on("error", fail);
    r.end(dados);
  });
}
async function post(porta, caminho, corpo) {
  const cfg = (await chamar(porta, { caminho: "/api/hml/config" })).json;
  return chamar(porta, { metodo: "POST", caminho, corpo, headers: { "content-type": "application/json", origin: `http://127.0.0.1:${porta}`, "x-csrf-token": cfg.csrf } });
}
const aviso = (h, event, orderId, loja = COD_STORE_TESTE) =>
  chamar(h.whPorta, { metodo: "POST", caminho: "/" + WH, headers: { "content-type": "application/json" }, corpo: { event, cod_store: loja, order_id: orderId } });
const preparo = async (h) => (await chamar(h.porta, { caminho: "/api/hml/preparo" })).json;
const orderIdDe = (h, i = 0) => JSON.parse(h.f.pedidos()[i].corpo).order_id;
const esperar = async (cond) => { for (let i = 0; i < 200 && !cond(); i++) await new Promise((r) => setTimeout(r, 10)); };
const parar = (s) => new Promise((r) => { s.closeAllConnections?.(); s.close(() => r()); });
const existe = (p) => stat(p).then(() => true, () => false);

async function pedido(h, n = 1) {
  const r = await post(h.porta, "/api/hml/carrinho", { idempotencyKey: K(n), itens: itens() });
  assert.equal(r.json.estado, "aceito", r.texto);
  return r.json;
}

test("callback HTTP real -> /preparo: PRONTO; POST em TAKEOUT; saude sem segredo; botao PRONTO manual 409; RETIRADO manual idempotente", async () => {
  const h = await subir();
  assert.equal((await preparo(h)).webhook.estado, "aguardando_avisos");
  const p = await pedido(h);
  const corpoEnviado = JSON.parse(h.f.pedidos()[0].corpo);
  assert.equal(corpoEnviado.order_method.mode, "TAKEOUT");
  assert.equal(corpoEnviado.customer.phone, "00000000000"); // telefone fake HML exigido pela Saipos em TAKEOUT
  assert.deepEqual(corpoEnviado.customer, { id: "-1", name: "TESTE", phone: "00000000000" });
  const antes = await preparo(h);
  assert.equal(antes.preparando.length, 1);
  assert.equal(antes.preparando[0].auto, true);
  const pid = antes.preparando[0].id;
  const oid = orderIdDe(h);

  assert.equal((await post(h.porta, `/api/hml/preparo/${pid}/pronto`, { actionKey: randomUUID() })).status, 409);
  assert.equal((await preparo(h)).pronto.length, 0);

  assert.equal((await aviso(h, "CONFIRMED", oid)).status, 200);
  assert.equal((await preparo(h)).pronto.length, 0);
  assert.equal((await aviso(h, "READY_TO_DELIVER", oid)).json.resultado, "aplicado");
  const dep = await preparo(h);
  assert.deepEqual(dep.pronto.map((x) => x.senha), [p.senha]);
  assert.equal(dep.preparando.length, 0);
  assert.equal((await aviso(h, "READY_TO_DELIVER", oid)).json.resultado, "repetido");
  assert.equal(dep.webhook.estado, "recebendo");
  assert.ok(!JSON.stringify(dep.webhook).includes(WH));
  assert.ok(!JSON.stringify(dep).includes(WH));

  const chave = randomUUID();
  assert.equal((await post(h.porta, `/api/hml/preparo/${pid}/retirado`, { actionKey: chave })).status, 200);
  assert.equal((await post(h.porta, `/api/hml/preparo/${pid}/retirado`, { actionKey: chave })).status, 200);
  assert.equal((await preparo(h)).retirados.length, 1);
  await aviso(h, "READY_TO_DELIVER", oid);
  assert.equal((await preparo(h)).pronto.length, 0); // READY tardio nao reabre
  assert.equal(h.f.pedidos().length, 1); // nenhum reenvio
});

test("restart: estado persistido, nenhum novo POST; pedido antigo/ID desconhecido/loja errada nao mudam", async () => {
  const h = await subir();
  const p = await pedido(h);
  const oid = orderIdDe(h);
  await aviso(h, "READY_TO_DELIVER", oid);
  assert.equal((await aviso(h, "READY_TO_DELIVER", "HML-DESCONHECIDO")).json.resultado, "ignorado");
  assert.equal((await aviso(h, "CANCELLED", oid, "outra-loja")).json.resultado, "ignorado");
  assert.equal((await preparo(h)).pronto.length, 1);
  await parar(h.server);

  const h2 = await subir({ dir: h.dir });
  assert.equal(h2.f.pedidos().length, 0); // restart sem novo POST
  const x = await preparo(h2);
  assert.deepEqual(x.pronto.map((e) => e.senha), [p.senha]);
  assert.equal((await aviso(h2, "READY_TO_DELIVER", oid)).json.resultado, "repetido");
  // CANCELLED apos restart tira da fila
  await aviso(h2, "CANCELLED", oid);
  const y = await preparo(h2);
  assert.equal(y.pronto.length + y.preparando.length + y.retirados.length, 0);
});

test("ordens: CONCLUDED->READY nao vira pronto; CANCELLED->READY nao vira pronto", async () => {
  const h = await subir();
  await pedido(h, 1);
  await pedido(h, 2);
  const [a, b] = [orderIdDe(h, 0), orderIdDe(h, 1)];
  await aviso(h, "CONCLUDED", a);
  await aviso(h, "READY_TO_DELIVER", a);
  await aviso(h, "CANCELLED", b);
  await aviso(h, "READY_TO_DELIVER", b);
  const x = await preparo(h);
  assert.equal(x.pronto.length, 0);
  assert.equal(x.preparando.length, 0);
  assert.equal(x.retirados.length, 0); // encerrado sem PRONTO nao e retirada fisica
  assert.equal(x.encerrados.length, 1);
});

test("opt-in HML: pedido novo marcado; CONFIRMED+CONCLUDED -> PRONTO sem rota pronto; retirada manual; restart sem POST; antigo segue omitido", async () => {
  const h0 = await subir(); // sem flag: pedido "antigo"
  await pedido(h0, 1);
  const antigo = orderIdDe(h0);
  await parar(h0.server);

  const h = await subir({ dir: h0.dir, flag: true });
  const p = await pedido(h, 2);
  assert.equal(h.f.pedidos().length, 1);
  const novo = orderIdDe(h);
  const est = JSON.parse(await readFile(join(h.dir, "ui-hml-state.json"), "utf8"));
  const marcados = Object.values(est.chaves).filter((e) => e.prontoAoConcluirHml === true);
  assert.deepEqual(marcados.map((e) => e.orderId), [novo]); // so o novo carrega a marca

  await aviso(h, "CONCLUDED", novo);
  assert.equal((await preparo(h)).pronto.length, 0); // CONCLUDED sozinho aguarda CONFIRMED
  await aviso(h, "CONFIRMED", novo);
  const x = await preparo(h);
  assert.deepEqual(x.pronto.map((e) => e.senha), [p.senha]);
  await aviso(h, "CONCLUDED", antigo); // antigo sem flag: encerrado, nunca PRONTO
  const y = await preparo(h);
  assert.equal(y.pronto.length, 1);
  assert.equal(y.retirados.length, 0);
  assert.equal(y.encerrados.length, 1);

  await parar(h.server);
  const h2 = await subir({ dir: h.dir, flag: true });
  assert.equal(h2.f.pedidos().length, 0); // restart sem POST
  const z = await preparo(h2);
  assert.equal(z.pronto.length, 1);
  await aviso(h2, "CONCLUDED", novo); // duplicata
  assert.equal((await post(h2.porta, `/api/hml/preparo/${z.pronto[0].id}/retirado`, { actionKey: randomUUID() })).status, 200);
  await aviso(h2, "CONCLUDED", novo);
  const w = await preparo(h2);
  assert.equal(w.pronto.length, 0);
  assert.equal(w.retirados.length, 1); // retirada manual; duplicata nao reabre
});

test("opt-in: flag de tipo estranho falha antes de qualquer rede", async () => {
  let n = 0;
  const f = async () => { n++; throw new Error("rede proibida"); };
  for (const v of ["true", 1, null, {}]) {
    await assert.rejects(criarServidorHml({ envPath: "/nao/existe/.env", fetchImpl: f, tvAutomatica: { webhook: { segredo: WH, prontoAoConcluirHml: v } } }));
  }
  assert.equal(n, 0);
});

test("legado inalterado: sem tvAutomatica => TICKET, sem receptor, sem campo webhook, sem botao auto", async () => {
  const h = await subir({ auto: false });
  assert.equal(h.whPorta, null);
  await pedido(h);
  assert.equal(JSON.parse(h.f.pedidos()[0].corpo).order_method.mode, "TICKET");
  const x = await preparo(h);
  assert.equal("webhook" in x, false);
  assert.equal(x.preparando[0].auto, undefined);
  assert.equal((await chamar(h.porta, { caminho: "/api/hml/webhook-status" })).json.estado, "nao_ligado");
  const pid = x.preparando[0].id;
  assert.equal((await post(h.porta, `/api/hml/preparo/${pid}/pronto`, { actionKey: randomUUID() })).status, 200);
});

test("guardas antes da rede: segredo invalido/ausente nao chama fetch", async () => {
  let n = 0;
  const f = async () => { n++; throw new Error("rede proibida"); };
  for (const tv of [{ webhook: { segredo: "curto" } }, { webhook: {} }, {}]) {
    await assert.rejects(criarServidorHml({ envPath: "/nao/existe/.env", fetchImpl: f, tvAutomatica: tv }));
  }
  assert.equal(n, 0);
});

test("callback DURANTE o POST /order: sem deadlock; aplicado depois do POST resolver", async () => {
  let liberar;
  const portao = new Promise((r) => { liberar = r; });
  const h = await subir({ ordem: async () => { await portao; return resp(200, {}); } });
  const envio = post(h.porta, "/api/hml/carrinho", { idempotencyKey: K(7), itens: itens() });
  await esperar(() => h.f.pedidos().length === 1);
  const oid = orderIdDe(h);
  const cb = aviso(h, "READY_TO_DELIVER", oid); // fica na fila ate o POST acabar
  await new Promise((r) => setTimeout(r, 50));
  liberar(); // o POST fake resolve independente do ACK do webhook
  const [e, c] = await Promise.all([envio, cb]);
  assert.equal(e.json.estado, "aceito");
  assert.equal(c.status, 200);
  assert.equal(c.json.resultado, "aplicado");
  assert.equal((await preparo(h)).pronto.length, 1);
});

test("erro de disco: 500 sem ack, rollback em memoria; retentativa apos recuperar aplica", async () => {
  const h = await subir();
  await pedido(h);
  const oid = orderIdDe(h);
  const estadoPath = join(h.dir, "ui-hml-state.json");
  assert.ok(await existe(estadoPath));
  await rename(estadoPath, estadoPath + ".bak");
  await mkdir(estadoPath); // diretorio no lugar do arquivo: o rename atomico falha
  const falha = await aviso(h, "READY_TO_DELIVER", oid);
  assert.equal(falha.status, 500);
  assert.ok(!falha.texto.includes(h.dir));
  const x = await preparo(h);
  assert.equal(x.pronto.length, 0); // rollback: nao finge prontidao
  assert.equal(x.preparando.length, 1);
  await rm(estadoPath, { recursive: true });
  await rename(estadoPath + ".bak", estadoPath);
  assert.equal((await aviso(h, "READY_TO_DELIVER", oid)).json.resultado, "aplicado");
  assert.equal((await preparo(h)).pronto.length, 1);
});

test("falha ao escutar no principal fecha o receptor", async () => {
  const ocupado = http.createServer();
  await new Promise((r) => ocupado.listen(0, "127.0.0.1", r));
  const portaOcupada = ocupado.address().port;
  try {
    const h = await subir(); // sobe normal para obter dir pronto
    await parar(h.server);
    const f = criarFetch();
    const s = await criarServidorHml({ envPath: join(h.dir, ".env"), fetchImpl: f, timeoutMs: 3000, gamaPath: join(h.dir, "gama-dto.json"), tvAutomatica: { webhook: { segredo: WH, porta: 0 } } });
    const erro = new Promise((r) => s.once("error", r));
    s.listen(portaOcupada);
    await erro;
    await new Promise((r) => setTimeout(r, 100));
    assert.equal(s.webhookPorta(), null); // receptor fechou (sem endereco)
  } finally { ocupado.close(); }
});
