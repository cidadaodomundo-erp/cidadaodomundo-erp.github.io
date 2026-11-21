// prepare: grava a ficha em arquivo privado. send: UMA tentativa por order_id,
// com reserva exclusiva (arquivo criado com flag 'wx') ANTES do POST. Nao ha retry.
// Timeout/5xx/3xx/erro de rede => 'ambiguo': so a UI da loja TESTE resolve.

import { readFile, writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { ErroConector, resumirErroApi } from "./erros.js";
import { gravarJsonAtomico, sha256Json } from "./arquivos.js";
import { carregarCatalogo, montarPayload, validarPayload } from "./payload.js";
import { obterToken } from "./auth.js";

const FORMATO = "saipos-teste-prepared/1";
const PADRAO_ORDER_ID = /^HML-[A-Za-z0-9-]+$/;

export async function preparar({ caminhos, meta, opcoes, agora = new Date() }) {
  const catalogo = await carregarCatalogo(caminhos.catalogPath);
  const { payload, resumo } = montarPayload({ meta, catalogo, ...opcoes, agora });
  const erros = validarPayload(payload);
  if (erros.length) {
    throw new ErroConector("PAYLOAD_REPROVADO", "Payload gerado reprovou na validacao local.", { erros });
  }
  const sha = sha256Json(payload);
  await mkdir(caminhos.payloadsDir, { recursive: true });
  const arquivo = join(caminhos.payloadsDir, `${resumo.orderId}.json`);
  await writeFile(
    arquivo,
    JSON.stringify({ formato: FORMATO, storeId: meta.storeId, codStore: meta.codStore, sha256: sha, criadoEm: agora.toISOString(), payload }, null, 2),
    { encoding: "utf8", mode: 0o600, flag: "wx" }
  );
  return { ...resumo, sha256: sha, artefato: `payloads/${resumo.orderId}.json` };
}

async function lerPreparado(caminhos, orderId, meta) {
  if (!PADRAO_ORDER_ID.test(orderId ?? "")) {
    throw new ErroConector("ORDER_ID_INVALIDO", "Informe --order com um order_id gerado por 'prepare' (HML-...).");
  }
  let arq;
  try {
    arq = JSON.parse(await readFile(join(caminhos.payloadsDir, `${orderId}.json`), "utf8"));
  } catch (erro) {
    throw new ErroConector(erro.code === "ENOENT" ? "PREPARADO_AUSENTE" : "PREPARADO_ILEGIVEL", "Arquivo preparado ausente ou ilegivel. Rode 'prepare'.");
  }
  const problemas = [];
  if (arq?.formato !== FORMATO) problemas.push("formato");
  if (arq?.storeId !== meta.storeId) problemas.push("storeId");
  if (arq?.codStore !== meta.codStore || arq?.payload?.cod_store !== meta.codStore) problemas.push("codStore");
  if (arq?.payload?.order_id !== orderId) problemas.push("order_id");
  if (!arq?.payload || sha256Json(arq.payload) !== arq.sha256) problemas.push("sha256 (arquivo alterado)");
  if (problemas.length) {
    throw new ErroConector("PREPARADO_REPROVADO", `Arquivo preparado nao confere: ${problemas.join(", ")}.`);
  }
  const erros = validarPayload(arq.payload);
  if (erros.length) throw new ErroConector("PAYLOAD_REPROVADO", "Payload preparado reprovou na validacao local.", { erros });
  return arq;
}

export async function enviar({ http, caminhos, meta, secret, orderId, sandbox, agora = Date.now }) {
  if (sandbox !== true) {
    throw new ErroConector("FLAG_SANDBOX_AUSENTE", "send exige a opcao --sandbox.");
  }
  const preparado = await lerPreparado(caminhos, orderId, meta);
  const reserva = join(caminhos.ledgerDir, `${orderId}.json`);

  const { token } = await obterToken({ http, caminhos, meta, secret, agora });

  await mkdir(caminhos.ledgerDir, { recursive: true });
  try {
    await writeFile(
      reserva,
      JSON.stringify({ orderId, sha256: preparado.sha256, estado: "tentando", iniciadoEm: new Date(agora()).toISOString() }, null, 2),
      { encoding: "utf8", mode: 0o600, flag: "wx" }
    );
  } catch (erro) {
    if (erro.code === "EEXIST") {
      throw new ErroConector("JA_TENTADO", "Este order_id ja teve uma tentativa de envio. Nao ha reenvio; confira a UI da loja TESTE ou rode 'prepare' de novo.");
    }
    throw erro;
  }

  const resp = await http.requisitar({ metodo: "POST", caminho: "/order", headers: { Authorization: token }, corpo: preparado.payload });

  let estado;
  let nota;
  if (resp.falha) {
    estado = "ambiguo";
    nota = `sem resposta utilizavel (${resp.falha}); o pedido pode ter sido recebido`;
  } else if (resp.status === 200) {
    estado = "aceito_pela_api";
    nota = "API respondeu 200; isso nao prova aparecimento na UI/cozinha";
  } else if (resp.status >= 500) {
    estado = "ambiguo";
    nota = `API respondeu ${resp.status}; o pedido pode ter sido recebido`;
  } else {
    estado = "recusado";
    nota = `API respondeu ${resp.status}`;
  }
  const api = resp.falha ? null : resumirErroApi(resp.json, [secret, token, meta.idPartner]);
  const final = { orderId, sha256: preparado.sha256, estado, httpStatus: resp.status ?? null, falha: resp.falha ?? null, api, nota, finalizadoEm: new Date(agora()).toISOString() };
  await gravarJsonAtomico(reserva, final);
  return { orderId, estado, httpStatus: final.httpStatus, falha: final.falha, api, nota };
}
