// Gera UMA ficha TICKET de homologacao a partir de codigos do catalogo TESTE.
// Contrato: criar-pedido + estrutura-campos-endpoints (ver docs/pesquisa-conexao.md).
// Dinheiro: calculado em centavos inteiros; enviado em reais (mesma unidade de unit_price).
// Item e cada complemento: quantidade 1 (a semantica de multiplicacao nao e documentada).

import { randomBytes, randomInt } from "node:crypto";
import { readFile } from "node:fs/promises";
import { ErroConector } from "./erros.js";

const CAMPOS_RAIZ = ["order_id", "display_id", "cod_store", "created_at", "notes", "total_discount", "customer", "order_method", "items", "payment_types"];
const MAX_COMPLEMENTOS = 10;

export async function carregarCatalogo(caminho) {
  let linhas;
  try {
    linhas = JSON.parse(await readFile(caminho, "utf8"));
  } catch (erro) {
    const ausente = erro.code === "ENOENT";
    throw new ErroConector(
      ausente ? "CATALOGO_AUSENTE" : "CATALOGO_ILEGIVEL",
      ausente ? "catalogo-teste.json ausente. Rode 'catalog --download' (ou coloque a lista do /v2/catalog ao lado do .env)." : "catalogo-teste.json ilegivel."
    );
  }
  if (!Array.isArray(linhas)) {
    throw new ErroConector("CATALOGO_FORMATO_INESPERADO", "catalogo-teste.json nao e uma lista.");
  }
  return linhas;
}

export function emCentavos(reais) {
  if (typeof reais !== "number" || !Number.isFinite(reais) || reais < 0) return null;
  const c = Math.round(reais * 100);
  return Math.abs(reais * 100 - c) < 1e-6 ? c : null;
}

function desabilitado(v) {
  return ![true, 1, "1", "Y"].includes(v);
}

// Localiza por codigo_saipos exato. Exige campo de nome do papel, preco valido,
// habilitado, e consistencia de preco entre linhas repetidas do mesmo codigo.
export function localizarCodigo(catalogo, codigo, papel) {
  const campoNome = papel === "item" ? "item" : "complemento_item";
  const campoHabilitado = papel === "item" ? "store_item_enabled" : "store_choice_item_enabled";
  const linhas = catalogo.filter((l) => l && l.codigo_saipos === codigo && l.tipo === (papel === "item" ? "PRATO" : "COMPLEMENTO") && typeof l[campoNome] === "string" && l[campoNome]);
  if (linhas.length === 0) {
    throw new ErroConector("CODIGO_NAO_CONFIRMADO", `Codigo ${papel} '${codigo}' nao existe no catalogo TESTE (como ${papel}).`);
  }
  const precos = new Set(linhas.map((l) => l.price));
  if (precos.size !== 1) {
    throw new ErroConector("PRECO_AMBIGUO", `Codigo ${papel} '${codigo}' tem precos diferentes no catalogo.`);
  }
  const linha = linhas[0];
  const centavos = emCentavos(linha.price);
  if (centavos === null) {
    throw new ErroConector("PRECO_INVALIDO", `Codigo ${papel} '${codigo}' sem preco valido (numero >= 0 com ate 2 casas).`);
  }
  if (desabilitado(linha[campoHabilitado]) || (papel === "complemento" && desabilitado(linha.store_choice_enabled)) || linha.store_item_enabled === "N") {
    throw new ErroConector("CODIGO_DESABILITADO", `Codigo ${papel} '${codigo}' esta desabilitado no catalogo.`);
  }
  return { codigo, descricao: linha[campoNome], centavos, lojaItem: linha.id_store_item, tipoItem: linha.item_type, grupo: linha.id_store_choice, min: linha.min_choices, max: linha.max_choices, calculo: linha.calc_method };
}

function dataCompacta(d) {
  return d.toISOString().replace(/[-:T]/g, "").slice(0, 14);
}

export function montarPayload({ meta, catalogo, itemCodigo, complementos = [], paymentCode, pagamentoZero = false, senha, itemNota = "", agora = new Date() }) {
  if (typeof paymentCode !== "string" || !paymentCode.trim()) {
    throw new ErroConector("PAGAMENTO_SEM_CODIGO", "Informe --payment-code (codigo da forma de pagamento mapeada no canal). Nao ha default.");
  }
  if (!itemCodigo) throw new ErroConector("ITEM_AUSENTE", "Informe --item <codigo_saipos>.");
  if (complementos.length > MAX_COMPLEMENTOS) {
    throw new ErroConector("COMPLEMENTOS_DEMAIS", `No maximo ${MAX_COMPLEMENTOS} complementos.`);
  }

  const item = localizarCodigo(catalogo, itemCodigo, "item");
  if (new Set(complementos).size !== complementos.length) throw new ErroConector("COMPLEMENTO_REPETIDO", "O mesmo complemento foi informado mais de uma vez.");
  const escolhidos = complementos.map((c) => localizarCodigo(catalogo, c, "complemento"));
  if (item.tipoItem === "pizza" || escolhidos.some(c => c.calculo)) throw new ErroConector("CALCULO_NAO_SUPORTADO", "Este ensaio só admite composição simples, sem rateio ou regras especiais.");
  for (const c of escolhidos) {
    if (item.lojaItem == null || c.lojaItem == null || String(item.lojaItem) !== String(c.lojaItem)) throw new ErroConector("COMPLEMENTO_OUTRO_ITEM", "O complemento não tem vínculo confirmado com o item escolhido.");
  }
  const grupos = new Map();
  for (const linha of catalogo) {
    if (!linha || linha.tipo !== "COMPLEMENTO" || String(linha.id_store_item) !== String(item.lojaItem) || desabilitado(linha.store_choice_enabled) || linha.id_store_choice == null) continue;
    const chave = String(linha.id_store_choice);
    if (!grupos.has(chave)) grupos.set(chave,{min:linha.min_choices ?? 0,max:linha.max_choices ?? null});
  }
  for (const [chave,g] of grupos) {
    const n=escolhidos.filter(c=>String(c.grupo)===chave).length;
    if ((Number.isInteger(g.min) && n<g.min) || (Number.isInteger(g.max) && n>g.max)) throw new ErroConector("COMPLEMENTOS_FORA_DO_LIMITE", "A seleção não atende aos limites do grupo de complementos.");
  }
  const totalCentavos = item.centavos + escolhidos.reduce((s, c) => s + c.centavos, 0);
  if (pagamentoZero && totalCentavos !== 0) throw new ErroConector("PAGAMENTO_DIVERGENTE", "Pagamento zero só é aceito quando o total dos itens também é zero.");
  const pagamentoCentavos = pagamentoZero ? 0 : totalCentavos;
  const senhaTexto = String(senha ?? randomInt(1000, 10000));
  const orderId = `HML-${dataCompacta(agora)}-${randomBytes(4).toString("hex")}`;

  const payload = {
    order_id: orderId,
    display_id: senhaTexto,
    cod_store: meta.codStore,
    created_at: agora.toISOString(),
    notes: `TESTE-NAO PRODUZIR | senha-nossa:${senhaTexto}`,
    total_discount: 0,
    customer: { id: "-1", name: "TESTE" },
    order_method: { mode: "TICKET", ticket_reference: `TESTE-${senhaTexto}` },
    items: [
      {
        integration_code: item.codigo,
        desc_item: item.descricao,
        quantity: 1,
        unit_price: item.centavos / 100,
        notes: itemNota ? `TESTE ${itemNota}`.slice(0, 120) : "TESTE",
        choice_items: escolhidos.map((c) => ({
          integration_code: c.codigo,
          desc_item_choice: c.descricao,
          aditional_price: c.centavos / 100,
          quantity: 1,
        })),
      },
    ],
    payment_types: [{ code: paymentCode.trim(), amount: pagamentoCentavos / 100, change_for: 0 }],
  };
  return { payload, resumo: { orderId, senha: senhaTexto, item, complementos: escolhidos, totalCentavos, pagamentoCentavos } };
}

const texto = (v) => typeof v === "string" && v.trim().length > 0;

// Revalida o arquivo preparado antes de qualquer envio (formato + soma em centavos).
export function validarPayload(p) {
  const erros = [];
  if (!p || typeof p !== "object") return ["payload nao e objeto"];
  for (const k of Object.keys(p)) if (!CAMPOS_RAIZ.includes(k)) erros.push(`campo nao permitido: ${k}`);
  for (const k of CAMPOS_RAIZ) if (!(k in p)) erros.push(`campo ausente: ${k}`);
  if (!/^HML-[A-Za-z0-9-]+$/.test(p.order_id ?? "")) erros.push("order_id fora do padrao HML-...");
  if (!texto(p.display_id)) erros.push("display_id vazio");
  if (!texto(p.cod_store)) erros.push("cod_store vazio");
  if (!texto(p.created_at) || Number.isNaN(Date.parse(p.created_at))) erros.push("created_at invalido");
  if (!String(p.notes ?? "").startsWith("TESTE-NAO PRODUZIR")) erros.push("notes sem marca TESTE-NAO PRODUZIR");
  if (p.total_discount !== 0) erros.push("total_discount deve ser 0");
  const c = p.customer;
  if (!c || c.id !== "-1" || c.name !== "TESTE" || Object.keys(c).length !== 2) erros.push("customer deve ser {id:'-1', name:'TESTE'}");
  const om = p.order_method;
  if (!om || om.mode !== "TICKET" || !texto(om.ticket_reference)) erros.push("order_method deve ser TICKET com ticket_reference");

  let somaItens = 0;
  if (!Array.isArray(p.items) || p.items.length !== 1) {
    erros.push("items deve ter exatamente 1 item");
  } else {
    const it = p.items[0];
    if (!texto(it.integration_code) || !texto(it.desc_item)) erros.push("item sem integration_code/desc_item");
    if (it.quantity !== 1) erros.push("item.quantity deve ser 1");
    const base = emCentavos(it.unit_price);
    if (base === null) erros.push("item.unit_price invalido");
    else somaItens += base;
    if (!Array.isArray(it.choice_items)) erros.push("choice_items deve ser lista");
    else {
      it.choice_items.forEach((ci, i) => {
        if (!texto(ci.integration_code) || !texto(ci.desc_item_choice)) erros.push(`choice_items[${i}] sem codigo/descricao`);
        if (ci.quantity !== 1) erros.push(`choice_items[${i}].quantity deve ser 1`);
        const preco = emCentavos(ci.aditional_price);
        if (preco === null) erros.push(`choice_items[${i}].aditional_price invalido (grafia oficial com um 'd')`);
        else somaItens += preco;
      });
    }
  }

  if (!Array.isArray(p.payment_types) || p.payment_types.length !== 1) {
    erros.push("payment_types deve ter exatamente 1 pagamento");
  } else {
    const pg = p.payment_types[0];
    if (!texto(pg.code)) erros.push("payment_types[0].code vazio");
    const valor = emCentavos(pg.amount);
    if (valor === null) erros.push("payment_types[0].amount invalido");
    else if (valor !== somaItens) erros.push("pagamento nao confere com itens+complementos");
    if (pg.change_for !== 0) erros.push("payment_types[0].change_for deve ser 0");
  }
  return erros;
}
