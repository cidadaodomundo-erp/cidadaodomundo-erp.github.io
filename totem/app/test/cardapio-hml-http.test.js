// Testes HTTP do cardapio/carrinho HML: servidor real em loopback, fetch/relogio/catalogo/mapa FAKE,
// pasta privada temporaria com credenciais FAKE. Sem rede externa, sem segredos reais.

import { test, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { mkdtemp, writeFile, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, basename, dirname } from "node:path";
import { criarServidorHml, COD_STORE_TESTE, CODIGO_PRODUTO, SENHA_INICIAL } from "../src/saipos-hml.js";
import { dtoFixtureV2, catalogoHmlV2, mapaFixtureV2, dtoFixture, catalogoHml, mapaFixture, itemBurger, itemCerveja, AS_01H, AS_12H, TOTAL_REFERENCIA } from "./fixture-cardapio.js";

const PREFIXO = "hml-carrinho-test-";
const SEGREDO = "FAKE-SECRET-aaaa1111";
const PARCEIRO = "FAKE-PARTNER-bbbb2222";
const TOKEN = "FAKE.TOKEN.cccc3333";
const LINK = "https://saipos-integration-services-catalog-production.s3.us-east-1.amazonaws.com/catalog/catalog-1.json";
const K = (n) => `bbbbbbbb-0000-4000-8000-${String(n).padStart(12, "0")}`;
const LEG = "cccccccc-0000-4000-8000-000000000001";

const dirs = [];
const servers = [];
after(async () => {
  for (const s of servers) { s.closeAllConnections?.(); s.close(); }
  for (const d of dirs) if (basename(d).startsWith(PREFIXO) && dirname(d) === tmpdir()) await rm(d, { recursive: true, force: true });
});

const resp = (status, obj) => ({ status, text: async () => JSON.stringify(obj) });
const pendurar = (init) => new Promise((_, rej) => init.signal.addEventListener("abort", () => rej(Object.assign(new Error("a"), { name: "AbortError" }))));

function criarFetch({ ordem, catalogo = catalogoHml } = {}) {
  const chamadas = [];
  const f = async (url, init = {}) => {
    chamadas.push({ url, corpo: init.body });
    if (url.endsWith("/auth")) return resp(200, { token: TOKEN });
    if (url.endsWith("/v2/catalog")) return resp(200, { url: LINK });
    if (url === LINK) return resp(200, { data: catalogo() });
    if (url.endsWith("/order")) return ordem ? ordem(init) : resp(200, {});
    throw new Error("url inesperada");
  };
  f.chamadas = chamadas;
  f.pedidos = () => chamadas.filter((c) => c.url.endsWith("/order"));
  return f;
}

// opcoes: mapa (null => sem arquivo), dto (false => caminho inexistente), relogio, estadoInicial, dir (reuso)
async function subir({ mapa = mapaFixture(), dto = dtoFixture(), inicio = AS_12H, estadoInicial, dir, ordem, catalogo } = {}) {
  if (!dir) {
    dir = await mkdtemp(join(tmpdir(), PREFIXO));
    dirs.push(dir);
    await writeFile(join(dir, ".env"), `SAIPOS_SECRET=${SEGREDO}\n`);
    await writeFile(join(dir, "test-store.json"), JSON.stringify({
      storeId: "93936", environment: "desenvolvimento", testStoreVerified: true,
      expectedName: "Cidadão do Mundo - HML", codStore: COD_STORE_TESTE, idPartner: PARCEIRO,
    }));
    if (dto) await writeFile(join(dir, "gama-dto.json"), JSON.stringify(dto));
    if (mapa !== null) await writeFile(join(dir, "gama-hml-map.json"), JSON.stringify(mapa));
    if (estadoInicial) await writeFile(join(dir, "ui-hml-state.json"), JSON.stringify(estadoInicial));
  }
  const relogio = { t: inicio };
  const f = criarFetch({ ordem, catalogo });
  const server = await criarServidorHml({ envPath: join(dir, ".env"), fetchImpl: f, timeoutMs: 300, gamaPath: join(dir, "gama-dto.json"), agora: () => relogio.t });
  await new Promise((r) => server.listen(0, r));
  servers.push(server);
  return { dir, f, server, porta: server.address().port, relogio };
}
const fechar = (s) => { s.closeAllConnections?.(); s.close(); };

function chamar(porta, { metodo = "GET", caminho = "/", headers = {}, corpo } = {}) {
  return new Promise((ok, fail) => {
    const dados = corpo === undefined ? undefined : typeof corpo === "string" ? corpo : JSON.stringify(corpo);
    const h = { ...headers };
    if (dados !== undefined) h["content-length"] = Buffer.byteLength(dados);
    const r = http.request({ host: "127.0.0.1", port: porta, method: metodo, path: caminho, headers: h }, (res) => {
      let t = "";
      res.on("data", (d) => (t += d));
      res.on("end", () => { let json = null; try { json = JSON.parse(t); } catch { /* texto */ } ok({ status: res.statusCode, headers: res.headers, texto: t, json }); });
    });
    r.on("error", fail);
    r.end(dados);
  });
}

async function post(porta, caminho, corpo, extra = {}) {
  const cfg = (await chamar(porta, { caminho: "/api/hml/config" })).json;
  const headers = { "content-type": "application/json", origin: `http://127.0.0.1:${porta}`, "x-csrf-token": cfg.csrf, ...extra };
  for (const k of Object.keys(headers)) if (headers[k] === undefined) delete headers[k];
  return chamar(porta, { metodo: "POST", caminho, corpo, headers });
}
const carrinho = (porta, chave, itens, extra) => post(porta, "/api/hml/carrinho", { idempotencyKey: chave, itens }, extra);
const existe = async (p) => stat(p).then(() => true, () => false);
const preparo = async (porta) => (await chamar(porta, { caminho: "/api/hml/preparo" })).json;

test("mapa ausente: cardapio abre, envio bloqueado ANTES de auth/prepare/ledger/contador", async () => {
  const h = await subir({ mapa: null });
  const v = (await chamar(h.porta, { caminho: "/api/hml/cardapio" })).json;
  assert.equal(v.mapa, "ausente");
  assert.ok(v.produtos.length > 0 && v.produtos.every((p) => p.variacoes.every((x) => !x.pronto)));
  const antes = h.f.chamadas.length;
  const r = await carrinho(h.porta, K(1), [itemCerveja()]);
  assert.equal(r.status, 409);
  assert.equal(r.json.erro, "item_nao_pronto");
  assert.equal(r.json.motivo, "mapa_ausente");
  assert.match(r.json.mensagem, /Ainda estamos preparando este item na loja de teste/);
  assert.equal(h.f.chamadas.length, antes); // nenhuma chamada (auth/order)
  assert.equal(await existe(join(h.dir, "ui-hml-state.json")), false); // contador intocado
  for (const d of ["payloads", "ledger"]) assert.equal(await existe(join(h.dir, d)), false);
});

const v2 = (extra = {}) => ({ dto: dtoFixtureV2(), catalogo: catalogoHmlV2, mapa: mapaFixtureV2(), ...extra });
const burgerV2 = () => ({ produto: 10, variacao: 1, quantidade: 2, opcoes: [{ opcao: 22, quantidade: 2 }, { opcao: 25, quantidade: 1 }] });
const cervejaV2 = () => ({ produto: 11, variacao: 2, quantidade: 1, opcoes: [{ opcao: 22, quantidade: 1 }] });

test("mapa v2: mesma opcao 22 em produtos/variacoes diferentes envia codigos compostos exatos; replay nao duplica", async () => {
  const h = await subir(v2());
  const itens = [burgerV2(), cervejaV2()];
  const rs = await Promise.all([1, 2, 3].map(() => carrinho(h.porta, K(1), itens)));
  assert.ok(rs.every((x) => x.status === 200 && x.json.estado === "aceito" && x.json.senha === SENHA_INICIAL), JSON.stringify(rs.map((x) => x.json)));
  assert.equal(h.f.pedidos().length, 1);
  const p = JSON.parse(h.f.pedidos()[0].corpo);
  assert.deepEqual(p.items.map((i) => i.integration_code), ["501", "902"]);
  assert.deepEqual(p.items[0].choice_items.map((c) => [c.integration_code, c.quantity, c.aditional_price]), [["501.22", 2, 12.99], ["501.25", 1, 2]]);
  assert.deepEqual(p.items[1].choice_items.map((c) => [c.integration_code, c.quantity, c.aditional_price]), [["902.22", 1, 12.99]]);
  assert.equal(r0(rs).totalCentavos, (3399 + 1299 * 2 + 200) * 2 + 2100 + 1299);
  const v = (await chamar(h.porta, { caminho: "/api/hml/cardapio" })).json;
  assert.ok(!JSON.stringify(v).includes("501.22"));
});
const r0 = (rs) => rs[0].json;

test("mapa v2 invalido ou com codigo de outra variacao bloqueia ANTES de auth/ledger/contador", async () => {
  const ruim = mapaFixtureV2();
  delete ruim.opcoes[0].produto;
  const outra = mapaFixtureV2();
  outra.opcoes.find((o) => o.produto === 11 && o.variacao === 2).codigoHml = "901.22";
  for (const [mapa, motivo, itens] of [[ruim, "mapa_invalido", [cervejaV2()]], [outra, "complemento_outro_item_ou_ausente", [cervejaV2()]]]) {
    const h = await subir(v2({ mapa }));
    const antes = h.f.chamadas.length;
    const r = await carrinho(h.porta, K(1), itens);
    assert.equal(r.status, 409);
    assert.equal(r.json.erro, "item_nao_pronto");
    assert.equal(r.json.motivo, motivo);
    assert.equal(h.f.chamadas.length, antes);
    assert.equal(await existe(join(h.dir, "ui-hml-state.json")), false);
    for (const d of ["payloads", "ledger"]) assert.equal(await existe(join(h.dir, d)), false);
  }
});

test("sucesso: 2 itens, qtd 2, adicional qtd 2, DIN = total; mapeamento persistido; entra no preparo", async () => {
  const h = await subir();
  const r = await carrinho(h.porta, K(1), [itemBurger(), itemCerveja()]);
  assert.equal(r.status, 200);
  assert.equal(r.json.estado, "aceito");
  assert.equal(r.json.senha, SENHA_INICIAL);
  assert.equal(r.json.totalCentavos, TOTAL_REFERENCIA);
  assert.equal(h.f.pedidos().length, 1);
  const p = JSON.parse(h.f.pedidos()[0].corpo);
  assert.equal(p.cod_store, COD_STORE_TESTE);
  assert.equal(p.display_id, "9201");
  assert.match(p.notes, /^TESTE-NAO PRODUZIR/);
  assert.deepEqual(p.customer, { id: "-1", name: "TESTE" });
  assert.deepEqual(p.order_method, { mode: "TICKET", ticket_reference: "TESTE-9201" });
  assert.equal(p.total_discount, 0);
  assert.equal(p.items.length, 2);
  assert.deepEqual([p.items[0].integration_code, p.items[0].quantity, p.items[0].unit_price], ["HML-BURGER", 2, 33.99]);
  assert.deepEqual(p.items[0].choice_items.map((c) => [c.integration_code, c.quantity, c.aditional_price]), [["HML-ANEIS", 2, 12.99], ["HML-MOLHO", 1, 2]]);
  assert.deepEqual([p.items[1].integration_code, p.items[1].quantity, p.items[1].unit_price], ["HML-CERV-500", 1, 21]);
  assert.deepEqual(p.payment_types, [{ code: "DIN", amount: 144.94, change_for: 0 }]);
  const estado = JSON.parse(await readFile(join(h.dir, "ui-hml-state.json"), "utf8"));
  const e = estado.chaves[K(1)];
  assert.equal(e.orderId, p.order_id);
  assert.equal(e.tipo, "carrinho");
  assert.equal(e.estado, "aceito");
  assert.equal(e.preparo.estado, "PREPARANDO");
  assert.equal(estado.proximaSenha, 9202);
  const ledger = JSON.parse(await readFile(join(h.dir, "ledger", `${p.order_id}.json`), "utf8"));
  assert.equal(ledger.estado, "aceito_pela_api");
  assert.deepEqual((await preparo(h.porta)).preparando.map((x) => x.senha), [9201]);
  const st = (await chamar(h.porta, { caminho: `/api/hml/status?chave=${K(1)}` })).json;
  assert.equal(st.estado, "aceito");
});

test("replay, concorrencia e mesma chave com outro carrinho nao duplicam POST; nova chave => proxima senha", async () => {
  const h = await subir();
  const rs = await Promise.all([1, 2, 3, 4].map(() => carrinho(h.porta, K(1), [itemCerveja()])));
  assert.ok(rs.every((x) => x.status === 200 && x.json.senha === 9201));
  assert.equal(h.f.pedidos().length, 1);
  const outro = await carrinho(h.porta, K(1), [itemCerveja({ quantidade: 2 })]);
  assert.equal(outro.status, 409);
  assert.equal(outro.json.erro, "chave_reutilizada");
  assert.equal(h.f.pedidos().length, 1);
  assert.equal((await carrinho(h.porta, K(2), [itemCerveja()])).json.senha, 9202);
  assert.equal(h.f.pedidos().length, 2);
});

test("reinicio nao duplica; interrompido vira ambiguo; senha legada 9201 RETIRADO nunca e reusada (proxima 9202)", async () => {
  const legado = {
    v: 1, proximaSenha: 9202,
    chaves: { [LEG]: { hash: "a".repeat(64), estado: "aceito", senha: 9201, orderId: "HML-20261111031827-da8848c9", criadoEm: "2026-11-11T03:18:27.000Z",
      pid: "eeeeeeee-0000-4000-8000-000000000001", preparo: { estado: "RETIRADO", desde: "2026-11-11T03:18:27.000Z", prontoEm: "2026-11-11T03:20:00.000Z", retiradoEm: "2026-11-11T03:21:00.000Z" } } },
  };
  const a = await subir({ estadoInicial: legado });
  const r = await carrinho(a.porta, K(1), [itemCerveja()]);
  assert.equal(r.json.senha, 9202);
  fechar(a.server);
  const b = await subir({ dir: a.dir });
  const r2 = await carrinho(b.porta, K(1), [itemCerveja()]);
  assert.deepEqual([r2.json.estado, r2.json.senha], ["aceito", 9202]);
  assert.equal(b.f.pedidos().length, 0);
  const salvo = JSON.parse(await readFile(join(a.dir, "ui-hml-state.json"), "utf8"));
  assert.equal(salvo.chaves[LEG].senha, 9201);
  assert.equal(salvo.chaves[LEG].preparo.estado, "RETIRADO");
  assert.equal(salvo.proximaSenha, 9203);
  fechar(b.server);

  // interrompido apos reservar/mapear, antes da resposta: vira ambiguo, sem POST
  const dir2 = (await subir()).dir;
  await writeFile(join(dir2, "ui-hml-state.json"), JSON.stringify({
    v: 1, proximaSenha: 9202,
    chaves: { [K(9)]: { hash: "b".repeat(64), tipo: "carrinho", estado: "enviando", senha: 9201, orderId: "HML-20261111999999-aaaaaaaa", criadoEm: "2026-11-11T12:00:00.000Z" } },
  }));
  const c = await subir({ dir: dir2 });
  const s = (await chamar(c.porta, { caminho: `/api/hml/status?chave=${K(9)}` })).json;
  assert.equal(s.estado, "ambiguo");
  assert.equal(c.f.pedidos().length, 0);
});

test("timeout e 5xx => ambiguo sem retry; replay devolve o mesmo e nao reenvia", async () => {
  for (const ordem of [pendurar, () => resp(503, {})]) {
    const h = await subir({ ordem });
    const r = await carrinho(h.porta, K(1), [itemCerveja()]);
    assert.equal(r.json.estado, "ambiguo");
    assert.equal(r.json.podeTentarNovamente, false);
    const r2 = await carrinho(h.porta, K(1), [itemCerveja()]);
    assert.equal(r2.json.estado, "ambiguo");
    assert.equal(h.f.pedidos().length, 1);
    // ledger ja tem a tentativa: impossivel reenviar o mesmo order_id
    const e = JSON.parse(await readFile(join(h.dir, "ui-hml-state.json"), "utf8")).chaves[K(1)];
    assert.ok(await existe(join(h.dir, "ledger", `${e.orderId}.json`)));
    assert.equal(e.preparo, undefined); // ambiguo nao entra na cozinha/TV
  }
  const rec = await subir({ ordem: () => resp(400, {}) });
  assert.equal((await carrinho(rec.porta, K(1), [itemCerveja()])).json.estado, "recusado");
  assert.equal((await preparo(rec.porta)).preparando.length, 0);
});

test("horario com relogio injetavel: Feijoada 01h bloqueia sem tocar nada; 12h envia", async () => {
  const h = await subir({ inicio: AS_01H });
  const feij = [{ produto: 20, variacao: 1, quantidade: 1, opcoes: [] }];
  const v = (await chamar(h.porta, { caminho: "/api/hml/cardapio" })).json;
  assert.equal(v.produtos.find((p) => p.id === 20).disponivelAgora, false);
  const antes = h.f.chamadas.length;
  const r = await carrinho(h.porta, K(1), feij);
  assert.deepEqual([r.status, r.json.erro, r.json.motivo], [409, "fora_do_horario", "fora_do_horario"]);
  assert.equal(h.f.chamadas.length, antes);
  assert.equal(await existe(join(h.dir, "ui-hml-state.json")), false);
  h.relogio.t = AS_12H;
  const ok = await carrinho(h.porta, K(1), feij);
  assert.equal(ok.json.estado, "aceito");
  assert.equal(JSON.parse(h.f.pedidos()[0].corpo).items[0].integration_code, "HML-FEIJ");
});

test("mapa de outra loja => invalido e bloqueia; fluxo legado de 1 item (Diversos) segue igual", async () => {
  const m = mapaFixture();
  m.storeUuid = "00000000-0000-4000-8000-000000000000";
  const h = await subir({ mapa: m });
  assert.equal((await chamar(h.porta, { caminho: "/api/hml/cardapio" })).json.mapa, "invalido");
  const r = await carrinho(h.porta, K(1), [itemCerveja()]);
  assert.deepEqual([r.status, r.json.motivo], [409, "mapa_invalido"]);
  assert.equal(h.f.pedidos().length, 0);
  const leg = await post(h.porta, "/api/hml/pedido", { idempotencyKey: K(2), code: CODIGO_PRODUTO, quantity: 1 });
  assert.equal(leg.json.estado, "aceito");
  const p = JSON.parse(h.f.pedidos()[0].corpo);
  assert.deepEqual([p.items.length, p.items[0].integration_code, p.items[0].unit_price, p.payment_types[0].code, p.payment_types[0].amount], [1, CODIGO_PRODUTO, 0, "DIN", 0]);
  // legado continua restrito a 1 item/qtd 1
  assert.equal((await post(h.porta, "/api/hml/pedido", { idempotencyKey: K(3), code: CODIGO_PRODUTO, quantity: 2 })).status, 400);
});

test("sem DTO do cardapio: 503 no cardapio e no carrinho; legado continua", async () => {
  const h = await subir({ dto: false });
  assert.equal((await chamar(h.porta, { caminho: "/api/hml/cardapio" })).status, 503);
  assert.equal((await carrinho(h.porta, K(1), [itemCerveja()])).status, 503);
  assert.equal((await post(h.porta, "/api/hml/pedido", { idempotencyKey: K(2), code: CODIGO_PRODUTO, quantity: 1 })).json.estado, "aceito");
});

test("carrinho: Host, Origin, CSRF, Sec-Fetch, tipo, tamanho, campos extras e limites", async () => {
  const h = await subir();
  const it = [itemCerveja()];
  assert.equal((await carrinho(h.porta, K(1), it, { host: "evil.com" })).status, 403);
  assert.equal((await carrinho(h.porta, K(1), it, { host: `localhost:${h.porta}` })).status, 403);
  assert.equal((await carrinho(h.porta, K(1), it, { origin: "http://evil.com" })).status, 403);
  assert.equal((await carrinho(h.porta, K(1), it, { origin: undefined })).status, 403);
  assert.equal((await carrinho(h.porta, K(1), it, { "x-csrf-token": "errado" })).status, 403);
  assert.equal((await carrinho(h.porta, K(1), it, { "x-csrf-token": undefined })).status, 403);
  assert.equal((await carrinho(h.porta, K(1), it, { "sec-fetch-site": "cross-site" })).status, 403);
  assert.equal((await carrinho(h.porta, K(1), it, { "content-type": "text/plain" })).status, 415);
  assert.equal((await post(h.porta, "/api/hml/carrinho", { idempotencyKey: K(1), itens: it, lixo: "x".repeat(17000) })).status, 413);
  assert.equal((await post(h.porta, "/api/hml/carrinho", { idempotencyKey: "nao-uuid", itens: it })).status, 400);
  assert.equal((await post(h.porta, "/api/hml/carrinho", { idempotencyKey: K(1), itens: it, total: 1 })).status, 400);
  assert.equal((await carrinho(h.porta, K(1), [{ ...itemCerveja(), preco: 1 }])).status, 400);
  assert.equal((await carrinho(h.porta, K(1), Array.from({ length: 21 }, () => itemCerveja()))).status, 400);
  assert.equal((await carrinho(h.porta, K(1), [itemCerveja({ quantidade: 21 })])).status, 400);
  assert.equal(h.f.pedidos().length, 0);
  assert.equal(await existe(join(h.dir, "ui-hml-state.json")), false);
});

test("paginas e API: raiz abre o cardapio, saipos.html segue, CSP, sem segredo/codigo Saipos, fotos so por id", async () => {
  const h = await subir();
  const raiz = await chamar(h.porta, { caminho: "/" });
  assert.equal(raiz.status, 200);
  assert.match(raiz.texto, /Enviar pedido de teste/);
  assert.equal(raiz.headers["cache-control"], "no-store");
  assert.match(raiz.headers["content-security-policy"], /default-src 'self'/);
  assert.equal(raiz.headers["access-control-allow-origin"], undefined);
  assert.doesNotMatch(raiz.texto, /<script(?![^>]*\ssrc=)/i);
  assert.equal((await chamar(h.porta, { caminho: "/saipos.html" })).status, 200);
  const js = await chamar(h.porta, { caminho: "/cardapio-hml.js" });
  assert.doesNotMatch(js.texto, /innerHTML|outerHTML|insertAdjacentHTML|document\.write|eval\(/);
  assert.equal((await chamar(h.porta, { caminho: "/cardapio-hml.css" })).status, 200);
  assert.equal((await chamar(h.porta, { caminho: "/gama-fotos/p999999.webp" })).status, 404); // sem arquivo => 404 (o front cai no quadro neutro)
  assert.equal((await chamar(h.porta, { caminho: "/gama-fotos/..%2f..%2fsrc%2fsaipos-hml.js" })).status, 404);
  assert.equal((await chamar(h.porta, { caminho: "/gama-fotos/p1.png" })).status, 404);

  const cardapio = await chamar(h.porta, { caminho: "/api/hml/cardapio" });
  const ok = await carrinho(h.porta, K(1), [itemBurger()]);
  const todos = [raiz.texto, js.texto, cardapio.texto, ok.texto, await readFile(join(h.dir, "ui-hml-state.json"), "utf8")].join("\n");
  for (const s of [SEGREDO, PARCEIRO, TOKEN, "amazonaws", COD_STORE_TESTE]) assert.ok(!todos.includes(s), s.slice(0, 8));
  for (const s of ["HML-BURGER", "HML-ANEIS", "codigoHml", "idPartner"]) assert.ok(!(raiz.texto + js.texto + cardapio.texto + ok.texto).includes(s), s);
});
