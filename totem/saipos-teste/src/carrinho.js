// Carrinho HML (formato preparado 2): varios itens, quantidades e complementos com quantidade.
// NAO relaxa nem altera o legado de 1 item (payload.js/envio.js). Formula oficial (criar-pedido):
//   total = SUM( (unit_price + SUM(aditional_price * choice.quantity)) * item.quantity )
// Dinheiro em centavos inteiros; convertido para reais so no JSON do fio.

import { randomBytes } from "node:crypto";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { ErroConector, resumirErroApi } from "./erros.js";
import { gravarJsonAtomico, sha256Json } from "./arquivos.js";
import { emCentavos } from "./payload.js";
import { obterToken } from "./auth.js";

export const FORMATO_2 = "saipos-teste-prepared/2";
export const MAX_ITENS = 20;
export const MAX_QTD = 20;
export const MAX_COMPLEMENTOS_POR_ITEM = 40;
export const MAX_TOTAL_CENTAVOS = 10_000_000; // R$ 100.000,00 (trava de seguranca do ensaio)

const CAMPOS_RAIZ = ["order_id", "display_id", "cod_store", "created_at", "notes", "total_discount", "customer", "order_method", "items", "payment_types"];
const ORDER_ID = /^HML-[A-Za-z0-9-]+$/;
const texto = (v) => typeof v === "string" && v.trim().length > 0;
const qtdOk = (v) => Number.isInteger(v) && v >= 1 && v <= MAX_QTD;
const centOk = (v) => Number.isSafeInteger(v) && v >= 0;

export const emReais = (centavos) => Number((centavos / 100).toFixed(2));

export function totalItemCentavos(unit, complementos, quantidade) {
  const adicionais = complementos.reduce((s, c) => s + c.centavos * c.quantidade, 0);
  return (unit + adicionais) * quantidade;
}

function dataCompacta(d) {
  return d.toISOString().replace(/[-:T]/g, "").slice(0, 14);
}

// itens: [{ codigo, descricao, centavos, quantidade, nota?, complementos: [{ codigo, descricao, centavos, quantidade }] }]
// mode: "TICKET" (padrao, legado) ou "TAKEOUT" (opt-in, so HML; Saipos so emite READY_TO_DELIVER em TAKEOUT/DELIVERY).
export const MODOS_CARRINHO = ["TICKET", "TAKEOUT"];
export const COD_STORE_HML_TAKEOUT = "ef2dc467-a4a8-4734-a4d7-eb3442ff3401"; // TAKEOUT so nesta loja HML
// Telefone ARTIFICIAL constante exigido pela Saipos em TAKEOUT (customer.phone). Nunca numero real.
export const TELEFONE_FAKE_HML = "00000000000";

export function montarPayloadCarrinho({ meta, itens, paymentCode, senha, agora = new Date(), mode = "TICKET" }) {
  if (!MODOS_CARRINHO.includes(mode)) throw new ErroConector("MODO_INVALIDO", "Modo de pedido nao permitido.");
  if (mode === "TAKEOUT" && meta?.codStore !== COD_STORE_HML_TAKEOUT) throw new ErroConector("TAKEOUT_SO_HML", "TAKEOUT so e permitido na loja HML autorizada.");
  if (!texto(paymentCode)) throw new ErroConector("PAGAMENTO_SEM_CODIGO", "Informe o codigo da forma de pagamento.");
  if (!Array.isArray(itens) || itens.length < 1 || itens.length > MAX_ITENS) throw new ErroConector("ITENS_FORA_DO_LIMITE", `O carrinho precisa ter de 1 a ${MAX_ITENS} itens.`);
  let total = 0;
  for (const it of itens) {
    const comps = it.complementos ?? [];
    if (!texto(it.codigo) || !texto(it.descricao) || !centOk(it.centavos) || !qtdOk(it.quantidade)) throw new ErroConector("ITEM_INVALIDO", "Item do carrinho invalido.");
    if (comps.length > MAX_COMPLEMENTOS_POR_ITEM) throw new ErroConector("COMPLEMENTOS_DEMAIS", "Complementos demais no item.");
    if (new Set(comps.map((c) => c.codigo)).size !== comps.length) throw new ErroConector("COMPLEMENTO_REPETIDO", "Complemento repetido no mesmo item.");
    for (const c of comps) {
      if (!texto(c.codigo) || !texto(c.descricao) || !centOk(c.centavos) || !qtdOk(c.quantidade)) throw new ErroConector("COMPLEMENTO_INVALIDO", "Complemento invalido.");
    }
    total += totalItemCentavos(it.centavos, comps, it.quantidade);
    if (!Number.isSafeInteger(total) || total > MAX_TOTAL_CENTAVOS) throw new ErroConector("TOTAL_FORA_DO_LIMITE", "Total do carrinho acima do limite do ensaio.");
  }
  const senhaTexto = String(senha);
  const orderId = `HML-${dataCompacta(agora)}-${randomBytes(4).toString("hex")}`;
  const payload = {
    order_id: orderId,
    display_id: senhaTexto,
    cod_store: meta.codStore,
    created_at: agora.toISOString(),
    notes: `TESTE-NAO PRODUZIR | senha-nossa:${senhaTexto}`,
    total_discount: 0,
    customer: mode === "TAKEOUT"
      ? { id: "-1", name: "TESTE", phone: TELEFONE_FAKE_HML }
      : { id: "-1", name: "TESTE" },
    order_method: mode === "TAKEOUT"
      ? { mode: "TAKEOUT", scheduled: false, delivery_date_time: agora.toISOString() }
      : { mode: "TICKET", ticket_reference: `TESTE-${senhaTexto}` },
    items: itens.map((it) => ({
      integration_code: it.codigo,
      desc_item: it.descricao,
      quantity: it.quantidade,
      unit_price: emReais(it.centavos),
      notes: it.nota ? `TESTE ${it.nota}`.slice(0, 120) : "TESTE",
      choice_items: (it.complementos ?? []).map((c) => ({
        integration_code: c.codigo,
        desc_item_choice: c.descricao,
        aditional_price: emReais(c.centavos),
        quantity: c.quantidade,
      })),
    })),
    payment_types: [{ code: paymentCode.trim(), amount: emReais(total), change_for: 0 }],
  };
  return { payload, resumo: { orderId, senha: senhaTexto, totalCentavos: total } };
}

// Revalida o arquivo preparado (formato 2) antes de qualquer envio.
export function validarPayloadCarrinho(p) {
  const erros = [];
  if (!p || typeof p !== "object") return ["payload nao e objeto"];
  for (const k of Object.keys(p)) if (!CAMPOS_RAIZ.includes(k)) erros.push(`campo nao permitido: ${k}`);
  for (const k of CAMPOS_RAIZ) if (!(k in p)) erros.push(`campo ausente: ${k}`);
  if (!ORDER_ID.test(p.order_id ?? "")) erros.push("order_id fora do padrao HML-...");
  if (!texto(p.display_id)) erros.push("display_id vazio");
  if (!texto(p.cod_store)) erros.push("cod_store vazio");
  if (!texto(p.created_at) || Number.isNaN(Date.parse(p.created_at))) erros.push("created_at invalido");
  if (!String(p.notes ?? "").startsWith("TESTE-NAO PRODUZIR")) erros.push("notes sem marca TESTE-NAO PRODUZIR");
  if (p.total_discount !== 0) erros.push("total_discount deve ser 0");
  const c = p.customer;
  const takeoutCli = p.order_method?.mode === "TAKEOUT";
  const custoBase = !!c && typeof c === "object" && c.id === "-1" && c.name === "TESTE";
  const custoOk = custoBase && (takeoutCli
    ? Object.keys(c).length === 3 && c.phone === TELEFONE_FAKE_HML
    : Object.keys(c).length === 2);
  if (!custoOk) erros.push(takeoutCli
    ? "customer de TAKEOUT deve ser {id:'-1', name:'TESTE', phone:'00000000000'} (somente este phone)"
    : "customer de TICKET deve ser {id:'-1', name:'TESTE'} sem phone");
  const om = p.order_method;
  const ticketOk = om && om.mode === "TICKET" && texto(om.ticket_reference) && Object.keys(om).length === 2;
  const takeoutOk = om && om.mode === "TAKEOUT" && om.scheduled === false && texto(om.delivery_date_time) &&
    !Number.isNaN(Date.parse(om.delivery_date_time)) && Object.keys(om).length === 3;
  if (om?.mode === "TAKEOUT" && p.cod_store !== COD_STORE_HML_TAKEOUT) erros.push("TAKEOUT so e permitido na loja HML autorizada");
  if (!ticketOk && !takeoutOk) erros.push("order_method deve ser TICKET com ticket_reference ou TAKEOUT (scheduled false)");

  let total = 0;
  if (!Array.isArray(p.items) || p.items.length < 1 || p.items.length > MAX_ITENS) {
    erros.push(`items deve ter de 1 a ${MAX_ITENS} itens`);
  } else {
    p.items.forEach((it, n) => {
      if (!texto(it.integration_code) || !texto(it.desc_item)) erros.push(`items[${n}] sem integration_code/desc_item`);
      if (!qtdOk(it.quantity)) erros.push(`items[${n}].quantity invalida`);
      const base = emCentavos(it.unit_price);
      if (base === null) { erros.push(`items[${n}].unit_price invalido`); return; }
      if (!Array.isArray(it.choice_items) || it.choice_items.length > MAX_COMPLEMENTOS_POR_ITEM) { erros.push(`items[${n}].choice_items invalido`); return; }
      const codigos = new Set();
      let adicionais = 0;
      it.choice_items.forEach((ci, i) => {
        if (!texto(ci.integration_code) || !texto(ci.desc_item_choice)) erros.push(`items[${n}].choice_items[${i}] sem codigo/descricao`);
        if (!qtdOk(ci.quantity)) erros.push(`items[${n}].choice_items[${i}].quantity invalida`);
        if (codigos.has(ci.integration_code)) erros.push(`items[${n}].choice_items[${i}] repetido`);
        codigos.add(ci.integration_code);
        const preco = emCentavos(ci.aditional_price);
        if (preco === null) erros.push(`items[${n}].choice_items[${i}].aditional_price invalido`);
        else adicionais += preco * (Number.isInteger(ci.quantity) ? ci.quantity : 0);
      });
      total += (base + adicionais) * (Number.isInteger(it.quantity) ? it.quantity : 0);
    });
  }
  if (!Array.isArray(p.payment_types) || p.payment_types.length !== 1) {
    erros.push("payment_types deve ter exatamente 1 pagamento");
  } else {
    const pg = p.payment_types[0];
    if (!texto(pg.code)) erros.push("payment_types[0].code vazio");
    const valor = emCentavos(pg.amount);
    if (valor === null) erros.push("payment_types[0].amount invalido");
    else if (valor !== total) erros.push("pagamento nao confere com a formula oficial dos itens");
    if (pg.change_for !== 0) erros.push("payment_types[0].change_for deve ser 0");
    if (total > MAX_TOTAL_CENTAVOS) erros.push("total acima do limite do ensaio");
  }
  return erros;
}

export async function prepararCarrinho({ caminhos, meta, itens, paymentCode, senha, agora = new Date(), mode = "TICKET" }) {
  const { payload, resumo } = montarPayloadCarrinho({ meta, itens, paymentCode, senha, agora, mode });
  const erros = validarPayloadCarrinho(payload);
  if (erros.length) throw new ErroConector("PAYLOAD_REPROVADO", "Payload do carrinho reprovou na validacao local.", { erros });
  const sha = sha256Json(payload);
  await mkdir(caminhos.payloadsDir, { recursive: true });
  await writeFile(
    join(caminhos.payloadsDir, `${resumo.orderId}.json`),
    JSON.stringify({ formato: FORMATO_2, storeId: meta.storeId, codStore: meta.codStore, sha256: sha, criadoEm: agora.toISOString(), payload }, null, 2),
    { encoding: "utf8", mode: 0o600, flag: "wx" }
  );
  return { ...resumo, sha256: sha };
}

async function lerPreparado2(caminhos, orderId, meta) {
  if (!ORDER_ID.test(orderId ?? "")) throw new ErroConector("ORDER_ID_INVALIDO", "order_id invalido.");
  let arq;
  try {
    arq = JSON.parse(await readFile(join(caminhos.payloadsDir, `${orderId}.json`), "utf8"));
  } catch (e) {
    throw new ErroConector(e.code === "ENOENT" ? "PREPARADO_AUSENTE" : "PREPARADO_ILEGIVEL", "Arquivo preparado ausente ou ilegivel.");
  }
  const problemas = [];
  if (arq?.formato !== FORMATO_2) problemas.push("formato");
  if (arq?.storeId !== meta.storeId) problemas.push("storeId");
  if (arq?.codStore !== meta.codStore || arq?.payload?.cod_store !== meta.codStore) problemas.push("codStore");
  if (arq?.payload?.order_id !== orderId) problemas.push("order_id");
  if (!arq?.payload || sha256Json(arq.payload) !== arq.sha256) problemas.push("sha256 (arquivo alterado)");
  if (problemas.length) throw new ErroConector("PREPARADO_REPROVADO", `Arquivo preparado nao confere: ${problemas.join(", ")}.`);
  const erros = validarPayloadCarrinho(arq.payload);
  if (erros.length) throw new ErroConector("PAYLOAD_REPROVADO", "Payload preparado reprovou na validacao local.", { erros });
  return arq;
}

// UMA tentativa por order_id: ledger exclusivo (flag wx) ANTES do POST; sem retry.
export async function enviarCarrinho({ http, caminhos, meta, secret, orderId, sandbox, agora = Date.now }) {
  if (sandbox !== true) throw new ErroConector("FLAG_SANDBOX_AUSENTE", "send exige sandbox.");
  const preparado = await lerPreparado2(caminhos, orderId, meta);
  const reserva = join(caminhos.ledgerDir, `${orderId}.json`);
  const { token } = await obterToken({ http, caminhos, meta, secret, agora });

  await mkdir(caminhos.ledgerDir, { recursive: true });
  try {
    await writeFile(
      reserva,
      JSON.stringify({ orderId, sha256: preparado.sha256, estado: "tentando", iniciadoEm: new Date(agora()).toISOString() }, null, 2),
      { encoding: "utf8", mode: 0o600, flag: "wx" }
    );
  } catch (e) {
    if (e.code === "EEXIST") throw new ErroConector("JA_TENTADO", "Este order_id ja teve uma tentativa de envio. Nao ha reenvio.");
    throw e;
  }

  const resp = await http.requisitar({ metodo: "POST", caminho: "/order", headers: { Authorization: token }, corpo: preparado.payload });
  let estado, nota;
  if (resp.falha) { estado = "ambiguo"; nota = `sem resposta utilizavel (${resp.falha}); o pedido pode ter sido recebido`; }
  else if (resp.status === 200) { estado = "aceito_pela_api"; nota = "API respondeu 200; isso nao prova aparecimento na UI/cozinha"; }
  else if (resp.status >= 500) { estado = "ambiguo"; nota = `API respondeu ${resp.status}; o pedido pode ter sido recebido`; }
  else { estado = "recusado"; nota = `API respondeu ${resp.status}`; }
  const api = resp.falha ? null : resumirErroApi(resp.json, [secret, token, meta.idPartner]);
  const final = { orderId, sha256: preparado.sha256, estado, httpStatus: resp.status ?? null, falha: resp.falha ?? null, api, nota, finalizadoEm: new Date(agora()).toISOString() };
  await gravarJsonAtomico(reserva, final);
  return { orderId, estado, httpStatus: final.httpStatus, falha: final.falha, api, nota };
}
