// Cliente HTTP minimo: so https://order-api.saipos.com, so 3 rotas, sem redirect.
// fetch e injetavel para testes (nenhum teste usa rede).

import { ErroConector } from "./erros.js";

export const HOST_PERMITIDO = "order-api.saipos.com";
const ROTAS = { "/auth": "POST", "/v2/catalog": "GET", "/order": "POST" };
const LIMITE_RESPOSTA = 1024 * 1024;

export function criarHttp({ fetchImpl = globalThis.fetch, timeoutMs = 15000 } = {}) {
  async function requisitar({ metodo, caminho, headers = {}, corpo }) {
    if (ROTAS[caminho] !== metodo) {
      throw new ErroConector("ROTA_NAO_PERMITIDA", `Rota ${metodo} ${caminho} fora da allowlist.`);
    }
    const url = new URL(`https://${HOST_PERMITIDO}${caminho}`);
    if (url.protocol !== "https:" || url.hostname !== HOST_PERMITIDO) {
      throw new ErroConector("HOST_NAO_PERMITIDO", "Host fora da allowlist.");
    }

    const controle = new AbortController();
    const timer = setTimeout(() => controle.abort(), timeoutMs);
    try {
      const resp = await fetchImpl(url.href, {
        method: metodo,
        headers: { ...(corpo !== undefined ? { "Content-Type": "application/json" } : {}), ...headers },
        body: corpo !== undefined ? JSON.stringify(corpo) : undefined,
        redirect: "manual",
        signal: controle.signal,
      });
      const status = resp.status;
      if (status >= 300 && status < 400) return { falha: "redirect", status };
      const texto = (await resp.text()).slice(0, LIMITE_RESPOSTA);
      let json = null;
      try {
        json = texto ? JSON.parse(texto) : null;
      } catch {
        json = null;
      }
      return { status, json };
    } catch (erro) {
      const timeout = erro?.name === "AbortError" || erro?.name === "TimeoutError";
      return { falha: timeout ? "timeout" : "rede" };
    } finally {
      clearTimeout(timer);
    }
  }
  return { requisitar };
}
