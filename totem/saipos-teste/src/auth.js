// Autenticacao: POST /auth {idPartner, secret} -> {token}. Token guardado so em
// arquivo privado ao lado do .env. Nunca retorna nem imprime o valor do token
// para a camada de saida (so quem chama `obterToken` o usa no header).

import { ErroConector, resumirErroApi } from "./erros.js";
import { lerJsonOpcional, gravarJsonAtomico, sha256Json } from "./arquivos.js";

const MARGEM_MS = 30 * 60 * 1000; // renova 30 min antes de expirar
const VALIDADE_FAQ_MS = 2 * 24 * 60 * 60 * 1000; // "validade de 2 dias" (duvidas-frequentes)
const INTERVALO_MIN_AUTH_MS = 30 * 1000; // politica local anti-spam, nao regra da Saipos

export function lerExpiracaoJwt(token) {
  try {
    const partes = token.split(".");
    if (partes.length !== 3) return null;
    const payload = JSON.parse(Buffer.from(partes[1], "base64url").toString("utf8"));
    return typeof payload.exp === "number" ? payload.exp * 1000 : null;
  } catch {
    return null;
  }
}

function expiracaoDoCache(cache) {
  if (typeof cache.expiraEm === "number") return cache.expiraEm;
  if (typeof cache.obtidoEm === "number") return cache.obtidoEm + VALIDADE_FAQ_MS;
  return null;
}

export async function obterToken({ http, caminhos, meta, secret, agora = Date.now }) {
  const chave = sha256Json({ idPartner: meta.idPartner, codStore: meta.codStore });
  const cache = await lerJsonOpcional(caminhos.tokenPath);
  const agoraMs = agora();

  if (cache?.chave === chave && typeof cache.token === "string") {
    const expira = expiracaoDoCache(cache);
    if (expira !== null && agoraMs < expira - MARGEM_MS) {
      return { token: cache.token, origem: "cache", expiraEm: new Date(expira).toISOString() };
    }
  }

  if (cache?.chave === chave && typeof cache.ultimaTentativaEm === "number" && agoraMs - cache.ultimaTentativaEm < INTERVALO_MIN_AUTH_MS) {
    throw new ErroConector("AUTH_MUITO_RECENTE", "Ultima tentativa de /auth foi ha menos de 30s. Aguarde antes de repetir.");
  }

  // Registra a tentativa antes da chamada (protege contra laco de repeticao).
  await gravarJsonAtomico(caminhos.tokenPath, { chave, ultimaTentativaEm: agoraMs });

  const segredos = [secret, meta.idPartner];
  const resp = await http.requisitar({
    metodo: "POST",
    caminho: "/auth",
    corpo: { idPartner: meta.idPartner, secret },
  });

  if (resp.falha) {
    throw new ErroConector("AUTH_SEM_RESPOSTA", `Sem resposta utilizavel de /auth (${resp.falha}).`);
  }
  if (resp.status === 200) {
    const token = resp.json?.token;
    if (typeof token !== "string" || !token) {
      throw new ErroConector("AUTH_RESPOSTA_INESPERADA", "/auth retornou 200 sem campo 'token' textual.");
    }
    const expiraEm = lerExpiracaoJwt(token);
    await gravarJsonAtomico(caminhos.tokenPath, {
      chave,
      token,
      obtidoEm: agoraMs,
      expiraEm,
      ultimaTentativaEm: agoraMs,
    });
    return {
      token,
      origem: "novo",
      expiraEm: expiraEm !== null ? new Date(expiraEm).toISOString() : null,
    };
  }
  const detalhes = { httpStatus: resp.status, api: resumirErroApi(resp.json, segredos) };
  if (resp.status === 400) {
    throw new ErroConector("AUTH_RECUSADA", "/auth recusou idPartner/secret (400).", detalhes);
  }
  if (resp.status >= 500) {
    throw new ErroConector("AUTH_ERRO_SERVIDOR", `/auth respondeu ${resp.status}.`, detalhes);
  }
  throw new ErroConector("AUTH_STATUS_INESPERADO", `/auth respondeu ${resp.status} (nao documentado).`, detalhes);
}
