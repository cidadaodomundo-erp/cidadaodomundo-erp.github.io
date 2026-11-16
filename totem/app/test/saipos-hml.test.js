// Testes offline: fetch injetado (sem rede), fixture privada temporaria com credenciais FAKE.
// Nao usa work/private-saipos nem .env real.

import { test, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { mkdtemp, writeFile, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, basename, dirname } from "node:path";
import { criarServidorHml, hashPedido, COD_STORE_TESTE, CODIGO_PRODUTO } from "../src/saipos-hml.js";

const PREFIXO = "hml-ui-test-";
const SEGREDO = "FAKE-SECRET-aaaa1111";
const PARCEIRO = "FAKE-PARTNER-bbbb2222";
const TOKEN = "FAKE.TOKEN.cccc3333";
const LINK = "https://saipos-integration-services-catalog-production.s3.us-east-1.amazonaws.com/catalog/catalog-1.json";
const LINHA = { tipo: "PRATO", codigo_saipos: CODIGO_PRODUTO, item: "Diversos", price: 0, store_item_enabled: "Y", id_store_item: 40101352, item_type: "simples" };
const K1 = "11111111-1111-4111-8111-111111111111";
const K2 = "22222222-2222-4222-8222-222222222222";
const K3 = "33333333-3333-4333-8333-333333333333";

const dirs = [];
const servers = [];
after(async () => {
  for (const s of servers) { s.closeAllConnections?.(); s.close(); }
  for (const d of dirs) {
    if (basename(d).startsWith(PREFIXO) && dirname(d) === tmpdir()) await rm(d, { recursive: true, force: true });
  }
});

async function fixture({ codStore = COD_STORE_TESTE } = {}) {
  const dir = await mkdtemp(join(tmpdir(), PREFIXO));
  dirs.push(dir);
  await writeFile(join(dir, ".env"), `SAIPOS_SECRET=${SEGREDO}\n`);
  await writeFile(join(dir, "test-store.json"), JSON.stringify({
    storeId: "93936", environment: "desenvolvimento", testStoreVerified: true,
    expectedName: "Cidadão do Mundo - HML", codStore, idPartner: PARCEIRO,
  }));
  return dir;
}

const resp = (status, obj) => ({ status, text: async () => (typeof obj === "string" ? obj : JSON.stringify(obj)) });
const pendurar = (init) => new Promise((_, rej) => init.signal.addEventListener("abort", () => rej(Object.assign(new Error("a"), { name: "AbortError" }))));

function criarFetch(o = {}) {
  const chamadas = [];
  const f = async (url, init = {}) => {
    chamadas.push({ url, metodo: init.method, corpo: init.body });
    if (url.endsWith("/auth")) return o.auth ? o.auth() : resp(200, { token: TOKEN });
    if (url.endsWith("/v2/catalog")) return resp(200, { url: LINK });
    if (url === LINK) return resp(200, o.catalogo ?? { data: [LINHA] });
    if (url.endsWith("/order")) return o.ordem ? o.ordem(init) : resp(200, {});
    throw new Error("url inesperada");
  };
  f.chamadas = chamadas;
  f.pedidos = () => chamadas.filter((c) => c.url.endsWith("/order"));
  return f;
}

async function subir(dir, opcoes = {}) {
  const f = criarFetch(opcoes);
  const server = await criarServidorHml({ envPath: join(dir, ".env"), fetchImpl: f, timeoutMs: 300 });
  await new Promise((r) => server.listen(0, r));
  servers.push(server);
  return { server, f, porta: server.address().port };
}

function chamar(porta, { metodo = "GET", caminho = "/", headers = {}, corpo } = {}) {
  return new Promise((ok, fail) => {
    const dados = corpo === undefined ? undefined : typeof corpo === "string" ? corpo : JSON.stringify(corpo);
    const h = { ...headers };
    if (dados !== undefined) h["content-length"] = Buffer.byteLength(dados);
    const r = http.request({ host: "127.0.0.1", port: porta, method: metodo, path: caminho, headers: h }, (res) => {
      let t = "";
      res.on("data", (d) => (t += d));
      res.on("end", () => {
        let json = null;
        try { json = JSON.parse(t); } catch { /* texto */ }
        ok({ status: res.statusCode, headers: res.headers, texto: t, json });
      });
    });
    r.on("error", fail);
    r.end(dados);
  });
}

async function postar(porta, corpo, extra = {}) {
  const cfg = (await chamar(porta, { caminho: "/api/hml/config" })).json;
  const headers = { "content-type": "application/json", origin: `http://127.0.0.1:${porta}`, "x-csrf-token": cfg.csrf, ...extra };
  for (const k of Object.keys(headers)) if (headers[k] === undefined) delete headers[k];
  return chamar(porta, { metodo: "POST", caminho: "/api/hml/pedido", corpo, headers });
}

const pedido = (k = K1) => ({ idempotencyKey: k, code: CODIGO_PRODUTO, quantity: 1 });

test("sucesso: 1 POST, payload zero, mapeamento persistido, senha 9201", async () => {
  const dir = await fixture();
  const { f, porta } = await subir(dir);
  const cfg = await chamar(porta, { caminho: "/api/hml/config" });
  assert.equal(cfg.json.produto.nome, "Diversos");
  assert.equal(cfg.json.produto.preco, "R$ 0,00");
  const r = await postar(porta, pedido());
  assert.equal(r.status, 200);
  assert.equal(r.json.estado, "aceito");
  assert.equal(r.json.senha, 9201);
  assert.match(r.json.mensagem, /aguardando conferência na cozinha/);
  assert.equal(f.pedidos().length, 1);
  const p = JSON.parse(f.pedidos()[0].corpo);
  assert.equal(p.cod_store, COD_STORE_TESTE);
  assert.equal(p.items.length, 1);
  assert.equal(p.items[0].integration_code, CODIGO_PRODUTO);
  assert.equal(p.items[0].quantity, 1);
  assert.equal(p.items[0].unit_price, 0);
  assert.deepEqual(p.items[0].choice_items, []);
  assert.equal(p.payment_types[0].amount, 0);
  assert.equal(p.payment_types[0].code, "DIN");
  assert.match(p.notes, /^TESTE-NAO PRODUZIR/);
  const estado = JSON.parse(await readFile(join(dir, "ui-hml-state.json"), "utf8"));
  assert.equal(estado.chaves[K1].orderId, p.order_id);
  assert.equal(estado.chaves[K1].estado, "aceito");
  assert.equal(estado.proximaSenha, 9202);
});

test("replay da mesma chave nao reenvia; payload diferente => 409; nova chave => senha 9202", async () => {
  const dir = await fixture();
  const { f, porta } = await subir(dir);
  const a = await postar(porta, pedido());
  const b = await postar(porta, pedido());
  assert.deepEqual(b.json, a.json);
  assert.equal(f.pedidos().length, 1);
  const c = await postar(porta, { ...pedido(), quantity: 2 });
  assert.equal(c.status, 409);
  assert.equal(f.pedidos().length, 1);
  const d = await postar(porta, pedido(K2));
  assert.equal(d.json.senha, 9202);
  const s = await chamar(porta, { caminho: `/api/hml/status?chave=${K1}` });
  assert.equal(s.json.estado, "aceito");
  const inex = await chamar(porta, { caminho: `/api/hml/status?chave=${K3}` });
  assert.equal(inex.json.estado, "inexistente");
});

test("concorrencia: 4 POSTs simultaneos da mesma chave => 1 envio", async () => {
  const dir = await fixture();
  const { f, porta } = await subir(dir);
  const rs = await Promise.all([1, 2, 3, 4].map(() => postar(porta, pedido())));
  assert.ok(rs.every((r) => r.status === 200 && r.json.senha === 9201));
  assert.equal(f.pedidos().length, 1);
});

test("reinicio nao duplica; estado interrompido vira ambiguo sem POST", async () => {
  const dir = await fixture();
  const a = await subir(dir);
  await postar(a.porta, pedido());
  a.server.closeAllConnections?.(); a.server.close();
  const b = await subir(dir);
  const r = await postar(b.porta, pedido());
  assert.equal(r.json.estado, "aceito");
  assert.equal(b.f.pedidos().length, 0);
  b.server.closeAllConnections?.(); b.server.close();

  const dir2 = await fixture();
  const x = await subir(dir2);
  x.server.closeAllConnections?.(); x.server.close();
  await writeFile(join(dir2, "ui-hml-state.json"), JSON.stringify({
    v: 1, proximaSenha: 9202,
    chaves: { [K1]: { hash: hashPedido(pedido()), estado: "enviando", senha: 9201, orderId: "HML-x" } },
  }));
  const y = await subir(dir2);
  const s = await chamar(y.porta, { caminho: `/api/hml/status?chave=${K1}` });
  assert.equal(s.json.estado, "ambiguo");
  assert.match(s.json.mensagem, /Confira o pedido na loja de teste/);
  const r2 = await postar(y.porta, pedido());
  assert.equal(r2.json.estado, "ambiguo");
  assert.equal(y.f.pedidos().length, 0);
});

test("timeout e 5xx => ambiguo, sem retry", async () => {
  for (const ordem of [pendurar, () => resp(503, "erro")]) {
    const dir = await fixture();
    const { f, porta } = await subir(dir, { ordem });
    const r = await postar(porta, pedido());
    assert.equal(r.json.estado, "ambiguo");
    assert.equal(r.json.podeTentarNovamente, false);
    const r2 = await postar(porta, pedido());
    assert.equal(r2.json.estado, "ambiguo");
    assert.equal(f.pedidos().length, 1);
  }
});

test("recusa 4xx => recusado", async () => {
  const dir = await fixture();
  const { f, porta } = await subir(dir, { ordem: () => resp(400, { errorMessage: "x" }) });
  const r = await postar(porta, pedido());
  assert.equal(r.json.estado, "recusado");
  assert.equal(f.pedidos().length, 1);
});

test("CodStore diferente e rejeitado antes de qualquer rede", async () => {
  const dir = await fixture({ codStore: "00000000-0000-4000-8000-000000000000" });
  const f = criarFetch();
  await assert.rejects(criarServidorHml({ envPath: join(dir, ".env"), fetchImpl: f }), (e) => e.codigo === "LOJA_NAO_PERMITIDA");
  assert.equal(f.chamadas.length, 0);
});

test("auth/catalogo: variantes", async () => {
  const d1 = await fixture();
  await assert.rejects(criarServidorHml({ envPath: join(d1, ".env"), fetchImpl: criarFetch({ auth: () => resp(400, {}) }) }), (e) => e.codigo === "AUTH_RECUSADA");
  const d2 = await fixture();
  const legado = await subir(d2, { catalogo: [LINHA] }); // lista antiga
  assert.equal((await chamar(legado.porta, { caminho: "/api/hml/config" })).json.produto.nome, "Diversos");
  const d3 = await fixture();
  await assert.rejects(criarServidorHml({ envPath: join(d3, ".env"), fetchImpl: criarFetch({ catalogo: { data: [{ ...LINHA, price: 5 }] } }) }), (e) => e.codigo === "PRODUTO_DIVERGENTE");
  const d4 = await fixture();
  await assert.rejects(criarServidorHml({ envPath: join(d4, ".env"), fetchImpl: criarFetch({ catalogo: { data: [{ ...LINHA, store_item_enabled: "N" }] } }) }), (e) => e.codigo === "CODIGO_DESABILITADO");
  const d5 = await fixture();
  await assert.rejects(criarServidorHml({ envPath: join(d5, ".env"), fetchImpl: criarFetch({ catalogo: { data: [] } }) }), (e) => e.codigo === "CODIGO_NAO_CONFIRMADO");
});

test("pedido adulterado e rejeitado sem POST", async () => {
  const dir = await fixture();
  const { f, porta } = await subir(dir);
  const ruins = [
    { ...pedido(), code: "99999999" },
    { ...pedido(), quantity: 2 },
    { ...pedido(), quantity: "1" },
    { ...pedido(), price: 1 },
    { ...pedido(), unit_price: 1 },
    { ...pedido(), choice_items: [{ integration_code: "x" }] },
    { ...pedido(), removals: ["a"] },
    { ...pedido(), codStore: "outro" },
    { idempotencyKey: K1, code: CODIGO_PRODUTO },
  ];
  for (const [i, c] of ruins.entries()) {
    const r = await postar(porta, { ...c, idempotencyKey: `aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa${String(i).padStart(2, "0")}` });
    assert.equal(r.status, 400, JSON.stringify(c));
  }
  assert.equal((await postar(porta, { ...pedido(), idempotencyKey: "nao-uuid" })).status, 400);
  assert.equal(f.pedidos().length, 0);
});

test("Host, Origin, CSRF, Sec-Fetch, Content-Type e tamanho maliciosos", async () => {
  const dir = await fixture();
  const { f, porta } = await subir(dir);
  assert.equal((await postar(porta, pedido(), { host: "evil.com" })).status, 403);
  assert.equal((await postar(porta, pedido(), { host: `localhost:${porta}` })).status, 403);
  assert.equal((await postar(porta, pedido(), { origin: "http://evil.com" })).status, 403);
  assert.equal((await postar(porta, pedido(), { origin: undefined })).status, 403);
  assert.equal((await postar(porta, pedido(), { "x-csrf-token": "errado" })).status, 403);
  assert.equal((await postar(porta, pedido(), { "x-csrf-token": undefined })).status, 403);
  assert.equal((await postar(porta, pedido(), { "sec-fetch-site": "cross-site" })).status, 403);
  assert.equal((await postar(porta, pedido(), { "content-type": "text/plain" })).status, 415);
  const grande = await postar(porta, { ...pedido(), lixo: "x".repeat(17000) });
  assert.equal(grande.status, 413);
  const g = await chamar(porta, { caminho: "/api/hml/config", headers: { host: "evil.com" } });
  assert.equal(g.status, 403);
  assert.equal(f.pedidos().length, 0);
});

test("estaticos: allowlist, CSP, no-store, sem JS inline; sem segredo em nenhuma resposta", async () => {
  const dir = await fixture();
  const { porta } = await subir(dir);
  const html = await chamar(porta, { caminho: "/saipos.html" });
  assert.equal(html.status, 200);
  assert.equal(html.headers["cache-control"], "no-store");
  assert.equal(html.headers["referrer-policy"], "same-origin");
  assert.match(html.headers["content-security-policy"], /default-src 'self'/);
  assert.equal(html.headers["access-control-allow-origin"], undefined);
  assert.doesNotMatch(html.texto, /<script(?![^>]*\ssrc=)/i);
  const js = await chamar(porta, { caminho: "/saipos.js" });
  assert.equal(js.status, 200);
  assert.doesNotMatch(js.texto, /\.innerHTML\s*=/);
  assert.equal((await chamar(porta, { caminho: "/css/../../src/saipos-hml.js" })).status, 404);
  assert.equal((await chamar(porta, { caminho: "/saipos-hml.js" })).status, 404);
  assert.equal((await chamar(porta, { caminho: "/api/hml/pedido" })).status, 404);
  assert.equal((await chamar(porta, { metodo: "DELETE", caminho: "/" })).status, 405);

  const todos = [html.texto, js.texto];
  todos.push((await chamar(porta, { caminho: "/api/hml/config" })).texto);
  todos.push((await postar(porta, pedido())).texto);
  todos.push((await postar(porta, pedido(), { "x-csrf-token": "x" })).texto);
  todos.push((await chamar(porta, { caminho: `/api/hml/status?chave=${K1}` })).texto);
  todos.push(await readFile(join(dir, "ui-hml-state.json"), "utf8"));
  const junto = todos.join("\n");
  for (const s of [SEGREDO, PARCEIRO, TOKEN, "amazonaws", COD_STORE_TESTE]) {
    assert.ok(!junto.includes(s), `vazou: ${s.slice(0, 8)}`);
  }
});

test("estado persistido invalido falha fechado sem reenvio nem sobrescrita", async () => {
  const dir = await fixture();
  const corrompido = JSON.stringify({v:1,proximaSenha:0,chaves:{}});
  await writeFile(join(dir,"ui-hml-state.json"),corrompido);
  const f = criarFetch();
  await assert.rejects(criarServidorHml({envPath:join(dir,".env"),fetchImpl:f}),e=>e.codigo==="ESTADO_INVALIDO");
  assert.equal(f.pedidos().length,0);
  assert.equal(await readFile(join(dir,"ui-hml-state.json"),"utf8"),corrompido);
});

test("cross-site: so navegacao GET de documento HTML estatico abre; API, CORS, iframe, CSS e POST seguem 403", async () => {
  const dir = await fixture();
  const { f, porta } = await subir(dir);
  const nav = { "sec-fetch-site": "cross-site", "sec-fetch-mode": "navigate", "sec-fetch-dest": "document" };
  const raiz = await chamar(porta, { caminho: "/", headers: nav });
  assert.equal(raiz.status, 200);
  assert.match(raiz.headers["content-type"], /^text\/html/);
  assert.equal(raiz.headers["cache-control"], "no-store");
  const html = await chamar(porta, { caminho: "/saipos.html", headers: nav });
  assert.equal(html.status, 200);
  assert.match(html.headers["content-type"], /^text\/html/);
  assert.equal((await chamar(porta, { caminho: "/api/hml/config", headers: nav })).status, 403);
  assert.equal((await chamar(porta, { caminho: "/", headers: { "sec-fetch-site": "cross-site", "sec-fetch-mode": "cors", "sec-fetch-dest": "empty" } })).status, 403);
  assert.equal((await chamar(porta, { caminho: "/saipos.html", headers: { "sec-fetch-site": "cross-site", "sec-fetch-mode": "navigate", "sec-fetch-dest": "iframe" } })).status, 403);
  assert.equal((await chamar(porta, { caminho: "/estilo.css", headers: nav })).status, 403);
  assert.equal((await chamar(porta, { caminho: "/saipos.js", headers: { ...nav, "sec-fetch-dest": "script" } })).status, 403);
  assert.equal((await chamar(porta, { caminho: "/", headers: { ...nav, host: "evil.com" } })).status, 403);
  // POST com chave falsa: cross-site navigate/document continua 403 antes de qualquer envio.
  const cfg = (await chamar(porta, { caminho: "/api/hml/config" })).json;
  const post = await chamar(porta, {
    metodo: "POST", caminho: "/api/hml/pedido", corpo: pedido(),
    headers: { "content-type": "application/json", origin: `http://127.0.0.1:${porta}`, "x-csrf-token": cfg.csrf, ...nav },
  });
  assert.equal(post.status, 403);
  assert.equal(post.json.erro, "origem_invalida");
  assert.equal(f.pedidos().length, 0);
});
