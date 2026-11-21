import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile, rm, mkdtemp } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { ambiente, rodar, fakeFetch, servidorPadrao, abortar, semVazamento, pacoteDir, jwtFalso, SEGREDO, ID_PARTNER, COD_STORE } from "./ajuda.js";
import { criarHttp } from "../src/http.js";
import { baixarCatalogo } from "../src/catalogo.js";

const semRede = () => fakeFetch(() => { throw new Error("rede nao deveria ser usada"); });

test("sem CONNECTOR_ENV_PATH falha fechado, sem rede", async () => {
  const f = semRede();
  const r = await rodar(["test"], { env: {}, fetchImpl: f });
  assert.equal(r.codigo, 1);
  assert.equal(r.json.erro, "ENV_PATH_AUSENTE");
  assert.equal(f.chamadas.length, 0);
});

test("caminho relativo e caminho dentro de outputs/ sao rejeitados", async () => {
  const f = semRede();
  assert.equal((await rodar(["setup"], { env: { CONNECTOR_ENV_PATH: ".env" }, fetchImpl: f })).json.erro, "ENV_PATH_RELATIVO");
  const dentro = join(pacoteDir, "..", "privado-errado", ".env");
  assert.equal((await rodar(["setup"], { env: { CONNECTOR_ENV_PATH: dentro }, fetchImpl: f })).json.erro, "ENV_PATH_DENTRO_DE_OUTPUTS");
});

test("setup cria .env vazio, e idempotente e nao sobrescreve", async () => {
  const a = await ambiente({ meta: false, catalogo: null });
  try {
    const r = await rodar(["setup"], { env: a.env, fetchImpl: semRede() });
    assert.equal(r.json.criado, false);
    assert.equal(r.json.path, a.env.CONNECTOR_ENV_PATH);
    assert.match(await readFile(a.env.CONNECTOR_ENV_PATH, "utf8"), new RegExp(SEGREDO));
    assert.ok(semVazamento(r.texto));

    await rm(a.env.CONNECTOR_ENV_PATH);
    const r2 = await rodar(["setup"], { env: a.env, fetchImpl: semRede() });
    assert.equal(r2.json.criado, true);
    assert.equal(await readFile(a.env.CONNECTOR_ENV_PATH, "utf8"), "SAIPOS_SECRET=\n");
  } finally { await a.limpar(); }
});

test("meta ausente => erro claro e nenhuma chamada de rede", async () => {
  const a = await ambiente({ meta: false });
  try {
    const f = semRede();
    const r = await rodar(["test"], { env: a.env, fetchImpl: f });
    assert.equal(r.json.erro, "META_AUSENTE");
    assert.equal(f.chamadas.length, 0);
  } finally { await a.limpar(); }
});

for (const [nome, override, campo] of [
  ["storeId errado", { storeId: "1" }, "storeId"],
  ["ambiente nao DEV", { environment: "producao" }, "environment"],
  ["nao verificada", { testStoreVerified: false }, "testStoreVerified"],
  ["nome diferente", { expectedName: "Outra Loja" }, "expectedName"],
  ["codStore vazio", { codStore: " " }, "codStore"],
  ["idPartner ausente", { idPartner: undefined }, "idPartner"],
]) {
  test(`meta reprovada (${nome}) => nao envia nada`, async () => {
    const a = await ambiente({ meta: override });
    try {
      const f = semRede();
      const r = await rodar(["test"], { env: a.env, fetchImpl: f });
      assert.equal(r.json.erro, "META_REPROVADA");
      assert.ok(r.json.detalhes.campos.includes(campo));
      assert.equal(f.chamadas.length, 0);
    } finally { await a.limpar(); }
  });
}

test("secret vazio => SECRET_NAO_PREENCHIDO sem rede", async () => {
  const a = await ambiente({ secret: "" });
  try {
    const f = semRede();
    const r = await rodar(["test"], { env: a.env, fetchImpl: f });
    assert.equal(r.json.erro, "SECRET_NAO_PREENCHIDO");
    assert.equal(f.chamadas.length, 0);
  } finally { await a.limpar(); }
});

test("test: auth + link do catalogo; Authorization sem Bearer; host unico; sem vazamento", async () => {
  const a = await ambiente();
  try {
    const srv = servidorPadrao();
    const f = fakeFetch(srv);
    const r = await rodar(["test"], { env: a.env, fetchImpl: f });
    assert.equal(r.codigo, 0);
    assert.equal(r.json.resultado, "ok");
    assert.equal(r.json.loja.codStore, COD_STORE);
    assert.equal(r.json.catalogo.hostDoLink, "saipos-integration-services-catalog-production.s3.us-east-1.amazonaws.com");
    assert.ok(semVazamento(r.texto, [srv.token]));

    const [auth, cat] = f.chamadas;
    assert.equal(auth.url, "https://order-api.saipos.com/auth");
    assert.equal(auth.metodo, "POST");
    assert.deepEqual(auth.corpo, { idPartner: ID_PARTNER, secret: SEGREDO });
    assert.equal(cat.url, "https://order-api.saipos.com/v2/catalog");
    assert.equal(cat.metodo, "GET");
    assert.equal(cat.headers.Authorization, srv.token);
    for (const c of f.chamadas) assert.equal(c.redirect, "manual");
  } finally { await a.limpar(); }
});

test("auth 400 => AUTH_RECUSADA resumida, sem vazamento", async () => {
  const a = await ambiente();
  try {
    const corpo = { t: "auth", dateTime: "2026-11-10T12:00:00Z", errorMessage: `Erro na validação dos dados enviados. >> Id do parceiro ou secret inválidos! ${SEGREDO}`, guidRequest: "g-1", extra: "descartado" };
    const f = fakeFetch(servidorPadrao({ sobrescrever: { "/auth": { status: 400, corpo } } }));
    const r = await rodar(["test"], { env: a.env, fetchImpl: f });
    assert.equal(r.codigo, 1);
    assert.equal(r.json.erro, "AUTH_RECUSADA");
    assert.equal(r.json.detalhes.api.guidRequest, "g-1");
    assert.equal(r.json.detalhes.api.extra, undefined);
    assert.ok(semVazamento(r.texto));
  } finally { await a.limpar(); }
});

test("auth 500, timeout e redirect => falhas especificas sem token", async () => {
  for (const [sobrescrever, esperado] of [
    [{ "/auth": { status: 500, corpo: { t: "auth", errorMessage: "Erro interno, comunique o time técnico." } } }, "AUTH_ERRO_SERVIDOR"],
    [{ "/auth": () => { throw abortar(); } }, "AUTH_SEM_RESPOSTA"],
    [{ "/auth": { status: 302, corpo: {} } }, "AUTH_SEM_RESPOSTA"],
    [{ "/auth": { status: 200, corpo: { semToken: true } } }, "AUTH_RESPOSTA_INESPERADA"],
    [{ "/auth": { status: 418, corpo: {} } }, "AUTH_STATUS_INESPERADO"],
  ]) {
    const a = await ambiente();
    try {
      const r = await rodar(["test"], { env: a.env, fetchImpl: fakeFetch(servidorPadrao({ sobrescrever })) });
      assert.equal(r.json.erro, esperado);
      assert.ok(semVazamento(r.texto));
    } finally { await a.limpar(); }
  }
});

test("token em cache e reutilizado; perto de expirar renova; anti-spam apos falha", async () => {
  const t0 = Date.now();
  const a = await ambiente();
  try {
    const longo = servidorPadrao({ token: jwtFalso(Math.floor(t0 / 1000) + 172800) });
    const f1 = fakeFetch(longo);
    await rodar(["test"], { env: a.env, fetchImpl: f1, agora: () => t0 });
    await rodar(["test"], { env: a.env, fetchImpl: f1, agora: () => t0 + 60_000 });
    assert.equal(f1.deRota("/auth").length, 1);
    assert.match(await readFile(join(a.dir, "token-cache.json"), "utf8"), /token/);
  } finally { await a.limpar(); }

  const b = await ambiente();
  try {
    const curto = servidorPadrao({ token: jwtFalso(Math.floor(t0 / 1000) + 600) });
    const f2 = fakeFetch(curto);
    await rodar(["test"], { env: b.env, fetchImpl: f2, agora: () => t0 });
    await rodar(["test"], { env: b.env, fetchImpl: f2, agora: () => t0 + 60_000 });
    assert.equal(f2.deRota("/auth").length, 2);
  } finally { await b.limpar(); }

  const c = await ambiente();
  try {
    const f3 = fakeFetch(servidorPadrao({ sobrescrever: { "/auth": { status: 400, corpo: {} } } }));
    await rodar(["test"], { env: c.env, fetchImpl: f3, agora: () => t0 });
    const r = await rodar(["test"], { env: c.env, fetchImpl: f3, agora: () => t0 + 5_000 });
    assert.equal(r.json.erro, "AUTH_MUITO_RECENTE");
    assert.equal(f3.chamadas.length, 1);
  } finally { await c.limpar(); }
});

test("http: rota/host fora da allowlist e redirect", async () => {
  const f = fakeFetch(() => ({ status: 200, corpo: {} }));
  const http = criarHttp({ fetchImpl: f });
  await assert.rejects(http.requisitar({ metodo: "GET", caminho: "/data/search_sales" }), { codigo: "ROTA_NAO_PERMITIDA" });
  await assert.rejects(http.requisitar({ metodo: "POST", caminho: "/v2/catalog" }), { codigo: "ROTA_NAO_PERMITIDA" });
  assert.equal(f.chamadas.length, 0);
  const r = await criarHttp({ fetchImpl: fakeFetch(() => ({ status: 301, corpo: {} })) }).requisitar({ metodo: "POST", caminho: "/auth", corpo: {} });
  assert.equal(r.falha, "redirect");
});

test("catalog --download so baixa de https *.amazonaws.com e grava em arquivo privado", async () => {
  const a = await ambiente({ catalogo: null });
  try {
    const f = fakeFetch(servidorPadrao());
    const r = await rodar(["catalog", "--download"], { env: a.env, fetchImpl: f });
    assert.equal(r.codigo, 0);
    assert.equal(r.json.catalogo.baixado, true);
    assert.equal(r.json.catalogo.linhas, 4);
    assert.ok(semVazamento(r.texto));
    assert.equal(JSON.parse(await readFile(join(a.dir, "catalogo-teste.json"), "utf8")).length, 4);
  } finally { await a.limpar(); }

  const b = await ambiente({ catalogo: null });
  try {
    const f = fakeFetch(servidorPadrao({ sobrescrever: { "/v2/catalog": { status: 200, corpo: { url: "https://exemplo.invalid/c.json" } } } }));
    const r = await rodar(["catalog", "--download"], { env: b.env, fetchImpl: f });
    assert.equal(r.json.erro, "CATALOGO_HOST_NAO_PERMITIDO");
    assert.equal(f.chamadas.some((c) => c.url.includes("exemplo.invalid")), false);
  } finally { await b.limpar(); }
});

// Mock SEM REDE: fetch simulado, sem chamada real. Cobre envelope {data: lista} e formatos invalidos do download.
const LINK_CATALOGO_OK = "https://saipos-integration-services-catalog-production.s3.us-east-1.amazonaws.com/catalog/catalog-123.json";
const respostaMock = (corpo) => ({ status: 200, text: async () => JSON.stringify(corpo) });
const LINHA = { codigo_saipos: "A1", tipo: "PRATO", item: "Diversos", price: 0, store_item_enabled: "Y" };

async function destinoTemp() {
  const dir = await mkdtemp(join(tmpdir(), "catalogo-teste-"));
  return { dir, destino: join(dir, "catalogo-teste.json") };
}

test("baixarCatalogo aceita envelope {data: lista} e grava somente a lista (mock sem rede)", async () => {
  const { dir, destino } = await destinoTemp();
  try {
    const chamadas = [];
    const fetchImpl = async (url, opts) => { chamadas.push({ url, opts }); return respostaMock({ data: [LINHA, { ...LINHA, codigo_saipos: "B2" }], extra: "descartado" }); };
    const r = await baixarCatalogo({ link: LINK_CATALOGO_OK, destino, fetchImpl });
    assert.equal(chamadas.length, 1);
    assert.equal(chamadas[0].opts.redirect, "manual");
    assert.equal(r.linhas, 2);
    assert.equal(r.codigosDistintos, 2);
    assert.deepEqual(JSON.parse(await readFile(destino, "utf8")), [LINHA, { ...LINHA, codigo_saipos: "B2" }]);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test("baixarCatalogo continua aceitando lista antiga (mock sem rede)", async () => {
  const { dir, destino } = await destinoTemp();
  try {
    const r = await baixarCatalogo({ link: LINK_CATALOGO_OK, destino, fetchImpl: async () => respostaMock([LINHA]) });
    assert.equal(r.linhas, 1);
    assert.deepEqual(JSON.parse(await readFile(destino, "utf8")), [LINHA]);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test("baixarCatalogo rejeita formatos invalidos sem gravar arquivo (mock sem rede)", async () => {
  const invalidos = [
    ["raiz null", null],
    ["raiz string", "texto"],
    ["raiz numero", 42],
    ["objeto sem data", {}],
    ["data nao array (objeto)", { data: {} }],
    ["data nao array (null)", { data: null }],
    ["data nao array (string)", { data: "x" }],
    ["lista com null", [null]],
    ["lista com primitivo", [1]],
    ["lista com array", [[]]],
    ["envelope com null", { data: [null] }],
    ["envelope com primitivo", { data: [1] }],
    ["envelope com array", { data: [[]] }],
  ];
  for (const [nome, corpo] of invalidos) {
    const { dir, destino } = await destinoTemp();
    try {
      let chamadas = 0;
      const fetchImpl = async () => { chamadas++; return respostaMock(corpo); };
      await assert.rejects(baixarCatalogo({ link: LINK_CATALOGO_OK, destino, fetchImpl }), { codigo: "CATALOGO_FORMATO_INESPERADO" }, nome);
      assert.equal(chamadas, 1, nome);
      await assert.rejects(readFile(destino, "utf8"), { code: "ENOENT" }, nome);
    } finally { await rm(dir, { recursive: true, force: true }); }
  }
});
