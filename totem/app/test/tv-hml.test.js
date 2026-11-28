// Testes offline do acompanhamento Cozinha + TV (HML). fetch injetado, fixture temporaria FAKE.
// Preparo/pronto/retirado e estado LOCAL: nenhuma acao chama o Saipos.

import { test, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { mkdtemp, writeFile, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, basename, dirname } from "node:path";
import { criarServidorHml, COD_STORE_TESTE, CODIGO_PRODUTO } from "../src/saipos-hml.js";

const PREFIXO = "hml-tv-test-";
const SEGREDO = "FAKE-SECRET-aaaa1111";
const PARCEIRO = "FAKE-PARTNER-bbbb2222";
const TOKEN = "FAKE.TOKEN.cccc3333";
const LINK = "https://saipos-integration-services-catalog-production.s3.us-east-1.amazonaws.com/catalog/catalog-1.json";
const LINHA = { tipo: "PRATO", codigo_saipos: CODIGO_PRODUTO, item: "Diversos", price: 0, store_item_enabled: "Y", id_store_item: 40101352, item_type: "simples" };
const ACAO = (n) => `aaaaaaaa-0000-4000-8000-${String(n).padStart(12, "0")}`;
const CHAVE = (n) => `bbbbbbbb-0000-4000-8000-${String(n).padStart(12, "0")}`;
const LEGADA = "cccccccc-0000-4000-8000-000000000001";

const dirs = [];
const servers = [];
after(async () => {
  for (const s of servers) { s.closeAllConnections?.(); s.close(); }
  for (const d of dirs) {
    if (basename(d).startsWith(PREFIXO) && dirname(d) === tmpdir()) await rm(d, { recursive: true, force: true });
  }
});

async function fixture() {
  const dir = await mkdtemp(join(tmpdir(), PREFIXO));
  dirs.push(dir);
  await writeFile(join(dir, ".env"), `SAIPOS_SECRET=${SEGREDO}\n`);
  await writeFile(join(dir, "test-store.json"), JSON.stringify({
    storeId: "93936", environment: "desenvolvimento", testStoreVerified: true,
    expectedName: "Cidadão do Mundo - HML", codStore: COD_STORE_TESTE, idPartner: PARCEIRO,
  }));
  return dir;
}

const resp = (status, obj) => ({ status, text: async () => JSON.stringify(obj) });
function criarFetch(o = {}) {
  const chamadas = [];
  const f = async (url, init = {}) => {
    chamadas.push({ url, corpo: init.body });
    if (url.endsWith("/auth")) return resp(200, { token: TOKEN });
    if (url.endsWith("/v2/catalog")) return resp(200, { url: LINK });
    if (url === LINK) return resp(200, { data: [LINHA] });
    if (url.endsWith("/order")) return o.ordem ? o.ordem(init) : resp(200, {});
    throw new Error("url inesperada");
  };
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

function fechar(s) { s.closeAllConnections?.(); s.close(); }

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

async function postJson(porta, caminho, corpo, extra = {}) {
  const cfg = (await chamar(porta, { caminho: "/api/hml/config" })).json;
  const headers = { "content-type": "application/json", origin: `http://127.0.0.1:${porta}`, "x-csrf-token": cfg.csrf, ...extra };
  for (const k of Object.keys(headers)) if (headers[k] === undefined) delete headers[k];
  return chamar(porta, { metodo: "POST", caminho, corpo, headers });
}

const novoPedido = (porta, n) => postJson(porta, "/api/hml/pedido", { idempotencyKey: CHAVE(n), code: CODIGO_PRODUTO, quantity: 1 });
const preparo = async (porta) => (await chamar(porta, { caminho: "/api/hml/preparo" })).json;
const acao = (porta, id, qual, n) => postJson(porta, `/api/hml/preparo/${id}/${qual}`, { actionKey: ACAO(n) });

test("aceito legado migra para PREPARANDO, mesma senha, contador intacto, sem POST", async () => {
  const dir = await fixture();
  const a = await subir(dir);
  fechar(a.server);
  await writeFile(join(dir, "ui-hml-state.json"), JSON.stringify({
    v: 1, proximaSenha: 9202,
    chaves: { [LEGADA]: { hash: "a".repeat(64), estado: "aceito", senha: 9201, orderId: "HML-20261111031827-da8848c9", criadoEm: "2026-11-11T03:18:27.000Z" } },
  }));
  const b = await subir(dir);
  const p = await preparo(b.porta);
  assert.deepEqual(p.preparando.map((x) => x.senha), [9201]);
  assert.equal(p.pronto.length, 0);
  assert.equal(b.f.pedidos().length, 0);
  const salvo = JSON.parse(await readFile(join(dir, "ui-hml-state.json"), "utf8"));
  assert.equal(salvo.proximaSenha, 9202);
  assert.equal(salvo.chaves[LEGADA].estado, "aceito");
  assert.equal(salvo.chaves[LEGADA].preparo.estado, "PREPARANDO");
  const n = await novoPedido(b.porta, 1);
  assert.equal(n.json.senha, 9202);
});

test("fluxo PREPARANDO -> PRONTO -> RETIRADO sem tocar o Saipos; TV sem dados sensiveis", async () => {
  const dir = await fixture();
  const { f, porta } = await subir(dir);
  const r = await novoPedido(porta, 1);
  assert.equal(r.json.estado, "aceito");
  let p = await preparo(porta);
  assert.equal(p.preparando.length, 1);
  assert.deepEqual(Object.keys(p.preparando[0]).sort(), ["desde", "id", "senha"]);
  const id = p.preparando[0].id;
  assert.equal((await acao(porta, id, "pronto", 1)).json.preparo, "PRONTO");
  p = await preparo(porta);
  assert.equal(p.preparando.length, 0);
  assert.equal(p.pronto[0].senha, 9201);
  assert.equal((await acao(porta, id, "retirado", 2)).json.preparo, "RETIRADO");
  p = await preparo(porta);
  assert.equal(p.pronto.length, 0);
  assert.deepEqual(p.retirados.map((x) => x.senha), [9201]);
  assert.deepEqual(Object.keys(p.retirados[0]).sort(), ["retiradoEm", "senha"]);
  assert.equal(f.pedidos().length, 1); // so o envio original
  const todo = JSON.stringify(p);
  for (const s of [SEGREDO, PARCEIRO, TOKEN, "amazonaws", COD_STORE_TESTE, "HML-"]) assert.ok(!todo.includes(s));
});

test("replay, acao igual repetida e concorrencia nao duplicam eventos", async () => {
  const dir = await fixture();
  const { porta } = await subir(dir);
  await novoPedido(porta, 1);
  const id = (await preparo(porta)).preparando[0].id;
  const rs = await Promise.all([1, 2, 3, 4].map(() => acao(porta, id, "pronto", 1)));
  assert.ok(rs.every((x) => x.status === 200 && x.json.preparo === "PRONTO"));
  const prontoEm = rs[0].json.prontoEm;
  assert.ok(rs.every((x) => x.json.prontoEm === prontoEm));
  const outra = await acao(porta, id, "pronto", 9); // chave nova, mesma acao ja efetiva
  assert.equal(outra.status, 200);
  assert.equal(outra.json.prontoEm, prontoEm);
  const reuso = await postJson(porta, `/api/hml/preparo/${id}/retirado`, { actionKey: ACAO(1) }); // chave de outra acao
  assert.equal(reuso.status, 409);
  const estado = JSON.parse(await readFile(join(dir, "ui-hml-state.json"), "utf8"));
  const e = Object.values(estado.chaves)[0];
  assert.equal(Object.keys(e.acoes).length, 1);
  assert.equal(e.preparo.estado, "PRONTO");
});

test("retirado antes de pronto => 409 sem mutar; ambiguo/recusado nunca aparecem nem aceitam acao", async () => {
  const dir = await fixture();
  const a = await subir(dir);
  await novoPedido(a.porta, 1);
  const id = (await preparo(a.porta)).preparando[0].id;
  const antes = await readFile(join(dir, "ui-hml-state.json"), "utf8");
  assert.equal((await acao(a.porta, id, "retirado", 1)).status, 409);
  assert.equal(await readFile(join(dir, "ui-hml-state.json"), "utf8"), antes);
  assert.equal((await preparo(a.porta)).preparando.length, 1);
  assert.equal((await acao(a.porta, "dddddddd-0000-4000-8000-000000000000", "pronto", 2)).status, 404);

  for (const ordem of [() => resp(503, {}), () => resp(400, {})]) {
    const d2 = await fixture();
    const b = await subir(d2, { ordem });
    const r = await novoPedido(b.porta, 1);
    assert.notEqual(r.json.estado, "aceito");
    const p = await preparo(b.porta);
    assert.deepEqual([p.preparando.length, p.pronto.length, p.retirados.length], [0, 0, 0]);
  }
});

test("reinicio conserva o preparo e nao reenvia", async () => {
  const dir = await fixture();
  const a = await subir(dir);
  await novoPedido(a.porta, 1);
  await novoPedido(a.porta, 2);
  const [x] = (await preparo(a.porta)).preparando;
  await acao(a.porta, x.id, "pronto", 1);
  fechar(a.server);
  const b = await subir(dir);
  const p = await preparo(b.porta);
  assert.deepEqual(p.pronto.map((i) => i.senha), [9201]);
  assert.deepEqual(p.preparando.map((i) => i.senha), [9202]);
  assert.equal(b.f.pedidos().length, 0);
  assert.equal((await novoPedido(b.porta, 3)).json.senha, 9203);
});

test("historico de retiradas limitado a 10, mais recentes primeiro", async () => {
  const dir = await fixture();
  const { porta } = await subir(dir);
  for (let i = 1; i <= 12; i++) await novoPedido(porta, i);
  const { preparando } = await preparo(porta);
  let n = 0;
  for (const it of preparando) {
    await acao(porta, it.id, "pronto", ++n);
    await acao(porta, it.id, "retirado", ++n);
  }
  const p = await preparo(porta);
  assert.equal(p.retirados.length, 10);
  assert.equal(p.retirados[0].senha, 9212);
  assert.equal(p.pronto.length, 0);
});

test("CSRF, Origin, Host, tipo, corpo e tamanho invalidos nas acoes", async () => {
  const dir = await fixture();
  const { porta } = await subir(dir);
  await novoPedido(porta, 1);
  const id = (await preparo(porta)).preparando[0].id;
  const c = `/api/hml/preparo/${id}/pronto`;
  const ok = { actionKey: ACAO(1) };
  assert.equal((await postJson(porta, c, ok, { "x-csrf-token": "errado" })).status, 403);
  assert.equal((await postJson(porta, c, ok, { "x-csrf-token": undefined })).status, 403);
  assert.equal((await postJson(porta, c, ok, { origin: "http://evil.com" })).status, 403);
  assert.equal((await postJson(porta, c, ok, { host: "evil.com" })).status, 403);
  assert.equal((await postJson(porta, c, ok, { "sec-fetch-site": "cross-site" })).status, 403);
  assert.equal((await postJson(porta, c, ok, { "content-type": "text/plain" })).status, 415);
  assert.equal((await postJson(porta, c, { actionKey: "x" })).status, 400);
  assert.equal((await postJson(porta, c, { ...ok, extra: 1 })).status, 400);
  assert.equal((await postJson(porta, c, {})).status, 400);
  assert.equal((await postJson(porta, c, { ...ok, lixo: "x".repeat(17000) })).status, 413);
  assert.equal((await preparo(porta)).preparando.length, 1); // nada mudou
});

test("estado persistido de preparo invalido falha fechado e nao e sobrescrito", async () => {
  const dir = await fixture();
  fechar((await subir(dir)).server);
  const ruim = JSON.stringify({
    v: 1, proximaSenha: 9202,
    chaves: { [LEGADA]: { hash: "a".repeat(64), estado: "aceito", senha: 9201, orderId: null, pid: "eeeeeeee-0000-4000-8000-000000000000", preparo: { estado: "VOANDO", desde: "2026-11-11T00:00:00.000Z" } } },
  });
  await writeFile(join(dir, "ui-hml-state.json"), ruim);
  await assert.rejects(criarServidorHml({ envPath: join(dir, ".env"), fetchImpl: criarFetch() }), (e) => e.codigo === "ESTADO_INVALIDO");
  assert.equal(await readFile(join(dir, "ui-hml-state.json"), "utf8"), ruim);
});

test("paginas: servidas com CSP, sem JS inline; TV limpa senhas na desconexao (codigo)", async () => {
  const dir = await fixture();
  const { server, porta } = await subir(dir);
  for (const caminho of ["/tv-hml.html", "/cozinha-hml.html"]) {
    const r = await chamar(porta, { caminho });
    assert.equal(r.status, 200);
    assert.match(r.headers["content-security-policy"], /default-src 'self'/);
    assert.equal(r.headers["cache-control"], "no-store");
    assert.doesNotMatch(r.texto, /<script(?![^>]*\ssrc=)/i);
    assert.match(r.texto, /Sem conexão com a cozinha de teste/);
  }
  const tv = await chamar(porta, { caminho: "/tv-hml.js" });
  const cz = await chamar(porta, { caminho: "/cozinha-hml.js" });
  for (const js of [tv.texto, cz.texto]) {
    assert.doesNotMatch(js, /innerHTML|localStorage/);
    assert.match(js, /catch[\s\S]*conexao[\s\S]*hidden = false/);
  }
  assert.match(tv.texto, /catch \{[\s\S]*?limpar\(\)/);
  assert.equal((await chamar(porta, { caminho: "/tv-hml.css" })).status, 200);
  assert.equal((await chamar(porta, { caminho: "/api/hml/preparo/x" })).status, 404);
  // servidor desligado: a consulta da TV falha (o codigo acima limpa a tela)
  fechar(server);
  await assert.rejects(chamar(porta, { caminho: "/api/hml/preparo" }));
});
