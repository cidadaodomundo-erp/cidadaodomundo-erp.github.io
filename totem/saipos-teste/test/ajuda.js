// Utilitarios de teste. Tudo ficticio: nenhum teste usa rede ou credencial real.
// Os formatos de resposta seguem os exemplos oficiais (ver work/pesquisa-saipos-conexao.md).

import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { principal } from "../src/cli.js";

export const pacoteDir = join(dirname(fileURLToPath(import.meta.url)), "..");
export const SEGREDO = "segredo-ficticio-abc123";
export const ID_PARTNER = "idpartner-ficticio-xyz789";
export const COD_STORE = "COD-TESTE-1";
export const LINK = "https://saipos-integration-services-catalog-production.s3.us-east-1.amazonaws.com/catalog/catalog-93936.json?X-Amz-Signature=assinatura-ficticia";

export function jwtFalso(expSeg) {
  const b = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");
  return `${b({ alg: "HS256", typ: "JWT" })}.${b({ exp: expSeg })}.assinatura-ficticia`;
}

export const CATALOGO = [
  { categoria: "Cat", tipo: "PRATO", tamanho: "", id_store_item: 1, item: "Prato Teste", item_type: "PRATO", codigo_saipos: "12606018", price: 25.9, store_item_enabled: true },
  { categoria: "Cat", tipo: "COMPLEMENTO", id_store_item: 1, id_store_choice: 2, complemento: "Extras", complemento_item: "Queijo Teste", codigo_saipos: "12606018.12326242", price: 3.1, store_choice_enabled: true, store_choice_item_enabled: true },
  { tipo: "COMPLEMENTO", complemento: "Extras", complemento_item: "Desligado", codigo_saipos: "12606018.OFF", price: 1, store_choice_enabled: true, store_choice_item_enabled: false },
  { tipo: "PRATO", item: "Sem Preco", codigo_saipos: "SEMPRECO", price: null, store_item_enabled: true },
];

export async function ambiente({ meta = true, secret = SEGREDO, catalogo = CATALOGO } = {}) {
  const dir = await mkdtemp(join(tmpdir(), "saipos-teste-"));
  const envPath = join(dir, ".env");
  await writeFile(envPath, `SAIPOS_SECRET=${secret}\n`);
  if (meta) {
    const base = { storeId: "93936", environment: "desenvolvimento", testStoreVerified: true, expectedName: "Cidadão do Mundo - HML", codStore: COD_STORE, idPartner: ID_PARTNER };
    await writeFile(join(dir, "test-store.json"), JSON.stringify({ ...base, ...(typeof meta === "object" ? meta : {}) }));
  }
  if (catalogo) await writeFile(join(dir, "catalogo-teste.json"), JSON.stringify(catalogo));
  return { dir, env: { CONNECTOR_ENV_PATH: envPath }, limpar: () => rm(dir, { recursive: true, force: true }) };
}

export function fakeFetch(responder) {
  const chamadas = [];
  const fn = async (url, init = {}) => {
    const c = { url, metodo: init.method, headers: init.headers ?? {}, corpo: init.body ? JSON.parse(init.body) : undefined, redirect: init.redirect };
    chamadas.push(c);
    const r = await responder(c);
    return { status: r.status, text: async () => (typeof r.corpo === "string" ? r.corpo : JSON.stringify(r.corpo ?? {})) };
  };
  fn.chamadas = chamadas;
  fn.deRota = (sufixo) => chamadas.filter((c) => c.url.endsWith(sufixo));
  return fn;
}

export const abortar = () => Object.assign(new Error("abortado"), { name: "AbortError" });

export function servidorPadrao({ token = jwtFalso(Math.floor(Date.now() / 1000) + 172800), sobrescrever = {} } = {}) {
  const responder = (c) => {
    for (const [sufixo, r] of Object.entries(sobrescrever)) {
      if (c.url.endsWith(sufixo) || c.url === sufixo) return typeof r === "function" ? r(c) : r;
    }
    if (c.url.endsWith("/auth")) return { status: 200, corpo: { token } };
    if (c.url.endsWith("/v2/catalog")) return { status: 200, corpo: { url: LINK } };
    if (c.url === LINK) return { status: 200, corpo: CATALOGO };
    if (c.url.endsWith("/order")) return { status: 200, corpo: {} };
    return { status: 404, corpo: {} };
  };
  responder.token = token;
  return responder;
}

export async function rodar(args, { env, fetchImpl, agora }) {
  let texto = "";
  const codigo = await principal(args, { env, fetchImpl, agora, pacoteDir, saida: (t) => { texto += t; } });
  let json = null;
  try { json = JSON.parse(texto); } catch { /* ajuda em texto */ }
  return { codigo, texto, json };
}

export function semVazamento(texto, extras = []) {
  for (const s of [SEGREDO, ID_PARTNER, LINK, ...extras]) if (texto.includes(s)) return false;
  return true;
}
