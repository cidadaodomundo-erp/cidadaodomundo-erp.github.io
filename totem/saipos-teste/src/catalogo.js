// Catalogo: GET /v2/catalog devolve {url} (link pre-assinado S3, 30 min).
// O link nunca e impresso. Download e opt-in e tem regra propria e estreita:
// https, host exato (ver linkPermitidoParaDownload), sem redirect, so o link devolvido pela API.

import { writeFile, mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import { ErroConector, resumirErroApi } from "./erros.js";

const LIMITE_CATALOGO = 5 * 1024 * 1024;

export async function pedirLinkCatalogo({ http, token, segredos = [] }) {
  const resp = await http.requisitar({ metodo: "GET", caminho: "/v2/catalog", headers: { Authorization: token } });
  if (resp.falha) {
    throw new ErroConector("CATALOGO_SEM_RESPOSTA", `Sem resposta utilizavel de /v2/catalog (${resp.falha}).`);
  }
  if (resp.status !== 200) {
    throw new ErroConector("CATALOGO_RECUSADO", `/v2/catalog respondeu ${resp.status}.`, {
      httpStatus: resp.status,
      api: resumirErroApi(resp.json, segredos),
    });
  }
  const link = resp.json?.url;
  if (typeof link !== "string" || !link) {
    throw new ErroConector("CATALOGO_RESPOSTA_INESPERADA", "/v2/catalog retornou 200 sem campo 'url' textual.");
  }
  let host;
  try {
    host = new URL(link).hostname;
  } catch {
    throw new ErroConector("CATALOGO_LINK_INVALIDO", "Link do catalogo nao e uma URL valida.");
  }
  return { link, host };
}

export function linkPermitidoParaDownload(link) {
  try {
    const u = new URL(link);
    return u.protocol === "https:" && !u.username && !u.password && !u.port
      && u.hostname === "saipos-integration-services-catalog-production.s3.us-east-1.amazonaws.com"
      && /^\/catalog\/catalog-\d+\.json$/.test(u.pathname);
  } catch {
    return false;
  }
}

function extrairLinhas(raiz) {
  if (Array.isArray(raiz)) return raiz;
  if (raiz && typeof raiz === "object" && Array.isArray(raiz.data)) return raiz.data;
  return null;
}

export async function baixarCatalogo({ link, destino, fetchImpl = globalThis.fetch, timeoutMs = 20000 }) {
  if (!linkPermitidoParaDownload(link)) {
    throw new ErroConector("CATALOGO_HOST_NAO_PERMITIDO", "Download recusado: o link nao e https em *.amazonaws.com.");
  }
  const controle = new AbortController();
  const timer = setTimeout(() => controle.abort(), timeoutMs);
  let texto;
  try {
    const resp = await fetchImpl(link, { method: "GET", redirect: "manual", signal: controle.signal });
    if (resp.status !== 200) {
      throw new ErroConector("CATALOGO_DOWNLOAD_FALHOU", `Download do catalogo respondeu ${resp.status}.`);
    }
    texto = await resp.text();
  } catch (erro) {
    if (erro instanceof ErroConector) throw erro;
    throw new ErroConector("CATALOGO_DOWNLOAD_SEM_RESPOSTA", "Falha de rede/timeout no download do catalogo.");
  } finally {
    clearTimeout(timer);
  }
  if (texto.length > LIMITE_CATALOGO) {
    throw new ErroConector("CATALOGO_GRANDE_DEMAIS", "Catalogo excede o limite de 5MB.");
  }
  let raiz;
  try {
    raiz = JSON.parse(texto);
  } catch {
    throw new ErroConector("CATALOGO_JSON_INVALIDO", "Catalogo baixado nao e JSON valido.");
  }
  // Formatos aceitos (observados na API real em 10/11): lista antiga ou envelope {data: lista}.
  // So a lista e normalizada e gravada; demais chaves do envelope sao descartadas.
  const linhas = extrairLinhas(raiz);
  if (!linhas || linhas.some((l) => !l || typeof l !== "object" || Array.isArray(l))) {
    throw new ErroConector("CATALOGO_FORMATO_INESPERADO", "Catalogo nao e uma lista de objetos.");
  }
  await mkdir(dirname(destino), { recursive: true });
  await writeFile(destino, JSON.stringify(linhas), { encoding: "utf8", mode: 0o600 });
  const codigos = new Set(linhas.map((l) => l.codigo_saipos).filter((c) => typeof c === "string"));
  return { linhas: linhas.length, codigosDistintos: codigos.size };
}
