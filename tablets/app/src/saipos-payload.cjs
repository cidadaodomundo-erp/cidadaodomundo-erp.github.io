"use strict";
// Construtores PUROS e OFFLINE de payload Saipos Order API, modo TABLE (mesa/comanda) -- RASCUNHO PARA HML, NAO HOMOLOGADO.
//
// O QUE ESTE MODULO NAO E: nao envia nada, nao tem transporte, nao le ambiente, nao usa token/segredo, nao usa relogio,
// nao decide reenvio, nao promete idempotencia, nao esta ligado ao front nem ao build. So transforma dados que o CHAMADOR
// fornece explicitamente em objetos JSON revisaveis. Nada e inventado: codigos, precos, quantidades, datas, ids, loja,
// mesa/comanda, item_external_code. Campo ausente/undefined/invalido/nao documentado => ErroPayload (lista TODOS os problemas).
// Propriedade presente com valor undefined e tratada como erro (nunca como "ausente" aceito). So propriedades PROPRIAS
// do objeto de entrada contam (herdadas sao ignoradas, logo um obrigatorio herdado conta como ausente).
//
// FONTES: docs/SAIPOS-CONFERENCIA-ATUAL.md (conferida pelo coordenador no site oficial em 12/11/2026) e
// work/saipos-docs/criar-pedido.md. Mapeamento aqui = o que essas fontes dizem; divergencias abertas estao em
// docs/INTEGRACAO-SALAO.md (ex.: PUT /order x "rodadas por POST com mesmo order_id": exige ensaio em HML).
//
// DINHEIRO: entrada em CENTAVOS inteiros (nunca float). Saida no corpo = number em reais (centavos/100, divisao
// exata de inteiro por 100; imprime sempre com <= 2 casas), como nos exemplos oficiais (unit_price: 13, aditional_price: 3).
// Toda soma/multiplicacao do total de conferencia precisa dar Number.isSafeInteger (limite TECNICO, nao comercial);
// se perder precisao, o payload e recusado.
// CODIGOS: strings preservadas literalmente ("007" continua "007"); numero JS e recusado (perderia zeros).

const CONTRATO = "saipos-table-rascunho-hml-nao-homologado";
const MAX_ORDER_ID = 40; // order_id string max 40 (conferencia 12/11)

class ErroPayload extends Error {
  constructor(problemas) {
    super("Payload recusado: " + problemas.join("; "));
    this.name = "ErroPayload";
    this.problemas = problemas;
  }
}

const ehObj = (v) => v !== null && typeof v === "object" && !Array.isArray(v);
const proprio = (o, k) => Object.prototype.hasOwnProperty.call(o, k);
const centavosOk = (n) => typeof n === "number" && Number.isSafeInteger(n) && n >= 0;
const quantidadeOk = (n) => typeof n === "number" && Number.isSafeInteger(n) && n >= 1;
const reais = (c) => c / 100;
function temControle(s) {
  for (let i = 0; i < s.length; i++) { const c = s.charCodeAt(i); if (c < 32 || c === 127 || c === 8232 || c === 8233) return true; }
  return false;
}
// texto literal: string nao vazia, sem espacos nas pontas, sem caracteres de controle (nada e "limpo" em silencio)
const textoOk = (s) => typeof s === "string" && s.length > 0 && s === s.trim() && !temControle(s);
const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:\d{2})$/;
const isoOk = (s) => typeof s === "string" && ISO.test(s) && !Number.isNaN(Date.parse(s));

// Chaves: desconhecidas (so proprias) => erro; obrigatorias ausentes (ou herdadas) => erro; QUALQUER propriedade propria
// com valor undefined (obrigatoria ou opcional) => erro.
function chaves(o, obrigatorias, opcionais, onde, P) {
  for (const k of Object.keys(o)) {
    if (!obrigatorias.includes(k) && !opcionais.includes(k)) P.push(`${onde}: campo nao documentado/nao suportado "${k}"`);
    else if (o[k] === undefined) P.push(`${onde}: "${k}" esta presente com valor undefined (omita o campo ou informe o valor; nada e inferido)`);
  }
  for (const k of obrigatorias) if (!proprio(o, k)) P.push(`${onde}: campo obrigatorio ausente "${k}"`);
}
// Valida texto literal de um campo PROPRIO ja defined (undefined ja foi reportado por chaves()).
function texto(o, k, onde, P, { max } = {}) {
  if (!proprio(o, k) || o[k] === undefined) return false;
  if (!textoOk(o[k])) { P.push(`${onde}: "${k}" deve ser texto literal nao vazio, sem espacos nas pontas e sem controles (recebido ${JSON.stringify(o[k])}); codigos nao podem ser numero`); return false; }
  if (max && o[k].length > max) { P.push(`${onde}: "${k}" excede ${max} caracteres`); return false; }
  return true;
}

function validarBase(e, exigeDisplayCriado, P) {
  texto(e, "pedidoId", "pedido", P, { max: MAX_ORDER_ID });
  texto(e, "lojaCodigo", "pedido", P);
  if (proprio(e, "displayId")) texto(e, "displayId", "pedido", P);
  if (proprio(e, "criadoEm") && e.criadoEm !== undefined && !isoOk(e.criadoEm)) {
    P.push(exigeDisplayCriado ? 'pedido: "criadoEm" deve ser ISO-8601 com fuso (o modulo nao le o relogio)' : 'pedido: "criadoEm" deve ser ISO-8601 com fuso');
  }
}

function validarComplemento(c, i, j, modo, P) {
  const onde = `item ${i} complemento ${j}`;
  if (!ehObj(c)) { P.push(`${onde}: deve ser objeto`); return; }
  chaves(c, ["codigo", "descricao", "quantidade", "precoAdicionalCentavos"], modo === "post" ? ["observacao"] : [], onde, P);
  texto(c, "codigo", onde, P); texto(c, "descricao", onde, P);
  if (proprio(c, "observacao")) texto(c, "observacao", onde, P);
  if (proprio(c, "quantidade") && c.quantidade !== undefined && !quantidadeOk(c.quantidade)) P.push(`${onde}: "quantidade" deve ser inteiro >= 1`);
  if (proprio(c, "precoAdicionalCentavos") && c.precoAdicionalCentavos !== undefined && !centavosOk(c.precoAdicionalCentavos)) P.push(`${onde}: "precoAdicionalCentavos" deve ser inteiro >= 0 (centavos, nunca decimal)`);
}

function validarItens(itens, modo, P) {
  if (!Array.isArray(itens) || itens.length === 0) { P.push('itens: lista nao vazia obrigatoria (nada e preenchido por inferencia)'); return; }
  itens.forEach((it, i) => {
    const onde = `item ${i}`;
    if (!ehObj(it)) { P.push(`${onde}: deve ser objeto`); return; }
    const obrig = ["codigo", "descricao", "quantidade", "precoCentavos"].concat(modo === "put" ? ["codigoExterno"] : []);
    const opc = ["complementos"].concat(modo === "post" ? ["observacao", "garcomId"] : []);
    chaves(it, obrig, opc, onde, P);
    texto(it, "codigo", onde, P); texto(it, "descricao", onde, P);
    if (modo === "put") texto(it, "codigoExterno", onde, P);
    if (proprio(it, "observacao")) texto(it, "observacao", onde, P);
    if (proprio(it, "garcomId")) texto(it, "garcomId", onde, P);
    if (proprio(it, "quantidade") && it.quantidade !== undefined && !quantidadeOk(it.quantidade)) P.push(`${onde}: "quantidade" deve ser inteiro >= 1`);
    if (proprio(it, "precoCentavos") && it.precoCentavos !== undefined && !centavosOk(it.precoCentavos)) P.push(`${onde}: "precoCentavos" deve ser inteiro >= 0 (centavos, nunca decimal)`);
    if (proprio(it, "complementos") && it.complementos !== undefined) {
      if (!Array.isArray(it.complementos)) P.push(`${onde}: "complementos" deve ser lista`);
      else it.complementos.forEach((c, j) => validarComplemento(c, i, j, modo, P));
    }
  });
}

function validarDestino(d, P) {
  if (!ehObj(d)) { P.push('destino: objeto obrigatorio {tipo:"mesa", descTable} ou {tipo:"comanda", descOrderPad}'); return null; }
  chaves(d, ["tipo"], ["descTable", "descOrderPad", "integrationCode", "integrationCodeConfirmado"], "destino", P);
  const tipo = proprio(d, "tipo") ? d.tipo : undefined;
  if (tipo === "mesa") {
    if (proprio(d, "descOrderPad")) P.push("destino: mesa nao aceita descOrderPad (destinos nao se misturam)");
    if (!proprio(d, "descTable")) P.push('destino: mesa exige "descTable" (identificador literal do cadastro real)');
    const okDesc = texto(d, "descTable", "destino", P);
    if (proprio(d, "integrationCode")) {
      if (d.integrationCodeConfirmado !== true) P.push('destino: "integrationCode" da mesa so e aceito com integrationCodeConfirmado === true (codigo vem de cadastro real confirmado)');
      texto(d, "integrationCode", "destino", P);
    } else if (proprio(d, "integrationCodeConfirmado")) P.push('destino: "integrationCodeConfirmado" sem "integrationCode"');
    if (!okDesc) return null;
    const t = { desc_table: d.descTable };
    if (proprio(d, "integrationCode") && d.integrationCodeConfirmado === true && textoOk(d.integrationCode)) t.integration_code = d.integrationCode;
    return t;
  }
  if (tipo === "comanda") {
    if (proprio(d, "descTable")) P.push("destino: comanda nao aceita descTable (destinos nao se misturam)");
    if (proprio(d, "integrationCode") || proprio(d, "integrationCodeConfirmado")) P.push("destino: integrationCode para comanda nao esta documentado; caso recusado (exigiria inferencia)");
    if (!proprio(d, "descOrderPad")) P.push('destino: comanda exige "descOrderPad" (identificador literal do cadastro real)');
    const okPad = texto(d, "descOrderPad", "destino", P);
    return okPad ? { desc_order_pad: d.descOrderPad } : null;
  }
  P.push(`destino: tipo deve ser "mesa" ou "comanda" (recebido ${JSON.stringify(tipo)})`);
  return null;
}

function itemPost(it) {
  const o = { integration_code: it.codigo, desc_item: it.descricao, quantity: it.quantidade, unit_price: reais(it.precoCentavos) };
  if (proprio(it, "observacao")) o.notes = it.observacao;
  if (proprio(it, "garcomId")) o.id_store_waiter = it.garcomId;
  if (it.complementos && it.complementos.length) {
    o.choice_items = it.complementos.map((c) => {
      const x = { integration_code: c.codigo, desc_item_choice: c.descricao, aditional_price: reais(c.precoAdicionalCentavos), quantity: c.quantidade };
      if (proprio(c, "observacao")) x.notes = c.observacao;
      return x;
    });
  }
  return o;
}
function itemPut(it) {
  const o = { integration_code: it.codigo, item_external_code: it.codigoExterno, desc_item: it.descricao, quantity: it.quantidade, unit_price: reais(it.precoCentavos) };
  if (it.complementos && it.complementos.length) {
    o.choice_items = it.complementos.map((c) => ({ integration_code: c.codigo, desc_item_choice: c.descricao, aditional_price: reais(c.precoAdicionalCentavos), quantity: c.quantidade }));
  }
  return o;
}

// Exige que um resultado intermediario seja inteiro seguro (limite tecnico); senao recusa (perda de precisao).
function seguro(n, descr) {
  if (!Number.isSafeInteger(n)) throw new ErroPayload([`total: ${descr} excede o limite tecnico de inteiro seguro (perda de precisao); payload recusado`]);
  return n;
}

// Conferencia para revisao humana (NAO vai no corpo; a Saipos calcula o total): ((unit + soma(adicional*qtd)) * qtd) por item.
// Cada multiplicacao e soma e checada com Number.isSafeInteger; lanca ErroPayload se qualquer passo perder precisao.
function totalItensCentavos(itens) {
  let total = 0;
  itens.forEach((it, i) => {
    let adicionais = 0;
    (it.complementos || []).forEach((c, j) => {
      const parcela = seguro(c.precoAdicionalCentavos * c.quantidade, `item ${i} complemento ${j} (preco x quantidade)`);
      adicionais = seguro(adicionais + parcela, `item ${i} soma de adicionais`);
    });
    const unitarioComAdicionais = seguro(it.precoCentavos + adicionais, `item ${i} preco + adicionais`);
    const linha = seguro(unitarioComAdicionais * it.quantidade, `item ${i} (preco com adicionais x quantidade)`);
    total = seguro(total + linha, `soma dos itens ate o item ${i}`);
  });
  return total;
}

// Calcula o total so depois de os itens estarem estruturalmente validos; acumula o problema em P se estourar.
function conferirTotal(itens, P) {
  if (P.length) return null;
  try { return totalItensCentavos(itens); } catch (e) { if (e instanceof ErroPayload) { P.push(...e.problemas); return null; } throw e; }
}

const AVISOS = Object.freeze([
  "RASCUNHO de contrato para HML, NAO HOMOLOGADO. Nao enviar a producao.",
  "Este modulo nao envia, nao decide reenvio e nao garante idempotencia; desfecho desconhecido exige reconciliacao (ver classificarDesfecho).",
]);

function envelope(metodo, rota, corpo, extra) {
  return Object.assign({ contrato: CONTRATO, homologado: false, metodo, rota, corpo, avisos: [...AVISOS] }, extra || {});
}
function falharSe(P) { if (P.length) throw new ErroPayload(P); }

// POST /order, modo TABLE. Obrigatorios (doc): order_id, display_id, cod_store, created_at, order_method.mode, items, table.
// Nosso contrato exige ainda codigo/descricao/quantidade/preco de cada item (a doc os marca opcionais; exigimos p/ evitar inferencia).
// customer e payment_types sao opcionais na doc e NAO sao suportados aqui (recusados).
function criarPedidoMesaComanda(entrada) {
  const P = [];
  if (!ehObj(entrada)) throw new ErroPayload(["entrada: objeto obrigatorio"]);
  chaves(entrada, ["pedidoId", "displayId", "lojaCodigo", "criadoEm", "destino", "itens"], ["observacao", "referenciaParceiro"], "pedido", P);
  validarBase(entrada, true, P);
  if (proprio(entrada, "observacao")) texto(entrada, "observacao", "pedido", P);
  if (proprio(entrada, "referenciaParceiro")) texto(entrada, "referenciaParceiro", "pedido", P);
  const table = proprio(entrada, "destino") ? validarDestino(entrada.destino, P) : (P.push('destino: objeto obrigatorio {tipo:"mesa", descTable} ou {tipo:"comanda", descOrderPad}'), null);
  validarItens(proprio(entrada, "itens") ? entrada.itens : undefined, "post", P);
  const total = conferirTotal(entrada.itens, P);
  falharSe(P);
  const method = { mode: "TABLE" };
  if (proprio(entrada, "referenciaParceiro")) method.table_reference = entrada.referenciaParceiro; // so observacao na Saipos
  const corpo = { order_id: entrada.pedidoId, display_id: entrada.displayId, cod_store: entrada.lojaCodigo, created_at: entrada.criadoEm };
  if (proprio(entrada, "observacao")) corpo.notes = entrada.observacao;
  corpo.order_method = method;
  corpo.items = entrada.itens.map(itemPost);
  corpo.table = table;
  return envelope("POST", "/order", corpo, { conferencia: { totalItensCentavos: total } });
}

// PUT /order, modo TABLE (adicao de itens) -- SO RASCUNHO. Obrigatorios (doc atual): order_id, cod_store, order_method.mode,
// items com integration_code, item_external_code, desc_item, quantity, unit_price (+ complementos com os 4 campos).
// created_at/display_id sao opcionais e so entram se fornecidos. Nao leva `table` (nao consta como obrigatorio no PUT).
// A semantica real (acrescenta? substitui?) e a divergencia com "rodadas por POST" estao NAO resolvidas: ensaio HML.
function rascunhoAdicaoPut(entrada) {
  const P = [];
  if (!ehObj(entrada)) throw new ErroPayload(["entrada: objeto obrigatorio"]);
  chaves(entrada, ["pedidoId", "lojaCodigo", "itens"], ["displayId", "criadoEm"], "pedido", P);
  validarBase(entrada, false, P);
  validarItens(proprio(entrada, "itens") ? entrada.itens : undefined, "put", P);
  const total = conferirTotal(entrada.itens, P);
  falharSe(P);
  const corpo = { order_id: entrada.pedidoId, cod_store: entrada.lojaCodigo };
  if (proprio(entrada, "displayId")) corpo.display_id = entrada.displayId;
  if (proprio(entrada, "criadoEm")) corpo.created_at = entrada.criadoEm;
  corpo.order_method = { mode: "TABLE" };
  corpo.items = entrada.itens.map(itemPut);
  return envelope("PUT", "/order", corpo, {
    conferencia: { totalItensCentavos: total },
    avisos: [...AVISOS, "PUT /order: semantica de adicao nao confirmada; diverge da descricao de rodadas por POST (mesmo order_id + desc_table/desc_order_pad). Ensaiar em HML antes de usar."],
  });
}

// PUT /order-status: solicitar conta. Somente order_id, cod_store, status=CLOSE_REQUESTED. NAO e pagamento nem fechamento de venda.
function pedirConta(entrada) {
  const P = [];
  if (!ehObj(entrada)) throw new ErroPayload(["entrada: objeto obrigatorio"]);
  chaves(entrada, ["pedidoId", "lojaCodigo"], [], "pedirConta", P);
  texto(entrada, "pedidoId", "pedirConta", P, { max: MAX_ORDER_ID });
  texto(entrada, "lojaCodigo", "pedirConta", P);
  falharSe(P);
  return envelope("PUT", "/order-status", { order_id: entrada.pedidoId, cod_store: entrada.lojaCodigo, status: "CLOSE_REQUESTED" });
}

// Classificacao CONSULTIVA do desfecho de um envio feito por OUTRA camada. Nunca manda repetir: repetirAutomaticamente e sempre false.
// Sem resposta, resposta de sucesso nao homologada ou erro nao mapeado => reconciliar (consultar o estado antes de qualquer decisao humana).
const ERROS = Object.freeze({ 900: "GENERIC", 901: "AUTHENTICATION", 902: "INVALID_DATA", 904: "ORDER_ALREADY_EXISTS", 906: "COD_STORE_NOT_FOUND", 907: "CARD_ALREADY_IN_USE",
  908: "TABLE_NOT_FOUND", 910: "ORDER_CARD_NOT_FOUND", 912: "SALE_IN_CLOSING_STATUS", 914: "SALE_WITHOU_ORDER_ID", 915: "UNMAPPED_915", 916: "CARD_NOT_EXISTS",
  919: "INVALID_ORDER", 921: "ALREADY_PROCESSING", 925: "SAIPOS_BAD_GATEWAY/SAIPOS_INTERNAL_SERVER_ERROR", 931: "TABLE_BUSY",
  932: "CANNOT_CREATE_TABLE_ORDER_WHEN_HAS_CARD", 934: "NO_FREE_CARDS", 938: "ORDER_NOT_IMPORTED_BY_RESTAURANT", 950: "CONTINGENCY" });
const REJEICAO_DOCUMENTADA = new Set([902, 906, 908, 910, 912, 916, 931, 932, 934]);

function classificarDesfecho(d) {
  const base = { repetirAutomaticamente: false };
  const x = ehObj(d) ? d : {};
  if (x.semResposta === true || (x.statusResposta === undefined && x.codigoErro === undefined)) {
    return Object.assign(base, { classe: "desconhecido", reconciliar: true, orientacao: "Sem resposta utilizavel: o pedido pode ou nao ter sido aplicado. Reconciliar consultando o estado; nao reenviar automaticamente." });
  }
  if (x.codigoErro !== undefined) {
    const nome = ERROS[x.codigoErro];
    if (nome === undefined) return Object.assign(base, { classe: "desconhecido", codigoErro: x.codigoErro, reconciliar: true, orientacao: "Codigo de erro nao mapeado: reconciliar." });
    const rej = REJEICAO_DOCUMENTADA.has(x.codigoErro);
    return Object.assign(base, { classe: rej ? "rejeitado-documentado" : "ambiguo-documentado", codigoErro: x.codigoErro, nome, reconciliar: !rej,
      orientacao: rej ? "Rejeicao documentada (nada aplicado segundo a doc). Corrigir a causa; reenvio e decisao humana." : "Estado pode ter sido aplicado: reconciliar antes de qualquer decisao." });
  }
  if (typeof x.statusResposta === "number" && x.statusResposta >= 200 && x.statusResposta < 300) {
    return Object.assign(base, { classe: "sucesso-nao-homologado", reconciliar: true, orientacao: "Resposta de sucesso ainda nao homologada: confirmar pelo estado da mesa/comanda; nao reenviar." });
  }
  return Object.assign(base, { classe: "desconhecido", reconciliar: true, orientacao: "Desfecho nao reconhecido: reconciliar." });
}

module.exports = { CONTRATO, ErroPayload, criarPedidoMesaComanda, rascunhoAdicaoPut, pedirConta, totalItensCentavos, classificarDesfecho };
