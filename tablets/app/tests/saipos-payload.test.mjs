// Testes do adaptador PURO/OFFLINE src/saipos-payload.cjs. Todos os dados abaixo sao SINTETICOS (codigos como "SINT-...").
// Isto prepara revisao de contrato; NAO envia nada e nao depende de credenciais, catalogo real ou rede.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const raiz = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const arquivo = path.join(raiz, "src", "saipos-payload.cjs");
const S = createRequire(import.meta.url)(arquivo);

const congelar = (o) => { if (o && typeof o === "object") { Object.values(o).forEach(congelar); Object.freeze(o); } return o; };
const clone = (o) => JSON.parse(JSON.stringify(o));
const base = () => ({
  pedidoId: "SINT-PEDIDO-0001", displayId: "0042", lojaCodigo: "SINT-LOJA", criadoEm: "2026-01-01T12:00:00Z",
  destino: { tipo: "mesa", descTable: "012" },
  itens: [
    { codigo: "00123", descricao: "Item sintetico A", quantidade: 2, precoCentavos: 3399, observacao: "sem cebola",
      complementos: [{ codigo: "0456", descricao: "Adicional sintetico", quantidade: 1, precoAdicionalCentavos: 400 }, { codigo: "0457", descricao: "Outro adicional", quantidade: 2, precoAdicionalCentavos: 600 }] },
    { codigo: "789", descricao: "Item sintetico B", quantidade: 1, precoCentavos: 0 },
  ],
});
const rejeita = (fn, re) => { try { fn(); } catch (e) { assert.ok(e instanceof S.ErroPayload, "esperava ErroPayload: " + e); assert.ok(e.problemas.some((p) => re.test(p)), `esperava ${re} em: ${e.problemas.join(" | ")}`); return e; } assert.fail("deveria ter lancado " + re); };

test("higiene: modulo sem rede, ambiente, relogio, require ou segredos no codigo", () => {
  const src = fs.readFileSync(arquivo, "utf8");
  for (const re of [/\bfetch\b/, /https?:/i, /XMLHttpRequest/, /WebSocket/, /process\.env/, /\brequire\s*\(/, /\bimport\s*\(/, /new Date|Date\.now/, /Math\.random/, /innerHTML/]) assert.ok(!re.test(src), String(re));
  assert.deepEqual(Object.keys(S).sort(), ["CONTRATO", "ErroPayload", "classificarDesfecho", "criarPedidoMesaComanda", "pedirConta", "rascunhoAdicaoPut", "totalItensCentavos"]);
});

test("POST mesa: corpo exato, mode TABLE, destino desc_table, strings e zeros preservados, centavos -> reais", () => {
  const r = S.criarPedidoMesaComanda(congelar(base())); // entrada congelada: o modulo nao muta
  assert.equal(r.metodo, "POST");
  assert.equal(r.rota, "/order");
  assert.equal(r.homologado, false);
  assert.match(r.contrato, /nao-homologado/);
  assert.ok(r.avisos.some((a) => /NAO HOMOLOGADO/.test(a)) && r.avisos.some((a) => /idempotencia/.test(a)));
  assert.deepEqual(r.corpo, {
    order_id: "SINT-PEDIDO-0001", display_id: "0042", cod_store: "SINT-LOJA", created_at: "2026-01-01T12:00:00Z",
    order_method: { mode: "TABLE" },
    items: [
      { integration_code: "00123", desc_item: "Item sintetico A", quantity: 2, unit_price: 33.99, notes: "sem cebola",
        choice_items: [{ integration_code: "0456", desc_item_choice: "Adicional sintetico", aditional_price: 4, quantity: 1 }, { integration_code: "0457", desc_item_choice: "Outro adicional", aditional_price: 6, quantity: 2 }] },
      { integration_code: "789", desc_item: "Item sintetico B", quantity: 1, unit_price: 0 },
    ],
    table: { desc_table: "012" },
  });
  assert.equal(r.corpo.display_id, "0042");
  assert.equal(r.corpo.table.desc_table, "012");
  // conferencia (fora do corpo): ((3399 + 400*1 + 600*2) * 2) + 0
  assert.equal(r.conferencia.totalItensCentavos, (3399 + 400 + 1200) * 2);
  assert.equal("total_amount" in r.corpo, false); // total e calculado pela Saipos; nada inventado
  assert.equal("payment_types" in r.corpo, false);
  assert.equal("customer" in r.corpo, false);
});

test("POST comanda: desc_order_pad; mesa e comanda nunca se misturam", () => {
  const c = base(); c.destino = { tipo: "comanda", descOrderPad: "A-007" };
  const r = S.criarPedidoMesaComanda(c);
  assert.deepEqual(r.corpo.table, { desc_order_pad: "A-007" });
  assert.equal("desc_table" in r.corpo.table, false);
  assert.equal(S.criarPedidoMesaComanda(base()).corpo.table.desc_order_pad, undefined);
  const m1 = base(); m1.destino = { tipo: "mesa", descTable: "1", descOrderPad: "A1" }; rejeita(() => S.criarPedidoMesaComanda(m1), /mesa nao aceita descOrderPad/);
  const m2 = base(); m2.destino = { tipo: "comanda", descOrderPad: "A1", descTable: "1" }; rejeita(() => S.criarPedidoMesaComanda(m2), /comanda nao aceita descTable/);
  const m3 = base(); m3.destino = { tipo: "mesa" }; rejeita(() => S.criarPedidoMesaComanda(m3), /mesa exige "descTable"/);
  const m4 = base(); m4.destino = { tipo: "comanda" }; rejeita(() => S.criarPedidoMesaComanda(m4), /comanda exige "descOrderPad"/);
  const m5 = base(); m5.destino = { tipo: "balcao", descTable: "1" }; rejeita(() => S.criarPedidoMesaComanda(m5), /tipo deve ser/);
  const m6 = base(); delete m6.destino; rejeita(() => S.criarPedidoMesaComanda(m6), /destino/);
});

test("integration_code da mesa: opcional, so se fornecido E confirmado; nunca para comanda", () => {
  const a = base(); a.destino = { tipo: "mesa", descTable: "12", integrationCode: "0099", integrationCodeConfirmado: true };
  assert.deepEqual(S.criarPedidoMesaComanda(a).corpo.table, { desc_table: "12", integration_code: "0099" });
  const b = base(); b.destino = { tipo: "mesa", descTable: "12", integrationCode: "0099" };
  rejeita(() => S.criarPedidoMesaComanda(b), /integrationCodeConfirmado === true/);
  const c = base(); c.destino = { tipo: "mesa", descTable: "12", integrationCode: "0099", integrationCodeConfirmado: false };
  rejeita(() => S.criarPedidoMesaComanda(c), /integrationCodeConfirmado === true/);
  const d = base(); d.destino = { tipo: "mesa", descTable: "12", integrationCodeConfirmado: true };
  rejeita(() => S.criarPedidoMesaComanda(d), /sem "integrationCode"/);
  const e = base(); e.destino = { tipo: "comanda", descOrderPad: "A1", integrationCode: "1", integrationCodeConfirmado: true };
  rejeita(() => S.criarPedidoMesaComanda(e), /nao esta documentado.*exigiria inferencia/);
  assert.equal("integration_code" in S.criarPedidoMesaComanda(base()).corpo.table, false); // ausente por padrao
});

test("codigos sao texto literal: zeros preservados; numero, espacos e controles recusados", () => {
  const r = S.criarPedidoMesaComanda(base());
  assert.equal(r.corpo.items[0].integration_code, "00123");
  assert.equal(r.corpo.items[0].choice_items[0].integration_code, "0456");
  for (const ruim of [123, 0, null, "", " 12", "12 ", "1\n2"]) {
    const c = base(); c.itens[0].codigo = ruim; rejeita(() => S.criarPedidoMesaComanda(c), /"codigo" deve ser texto literal/);
    const d = base(); d.destino = { tipo: "mesa", descTable: ruim }; rejeita(() => S.criarPedidoMesaComanda(d), /descTable/);
    const e = base(); e.itens[0].complementos[0].codigo = ruim; rejeita(() => S.criarPedidoMesaComanda(e), /complemento 0.*"codigo"/);
  }
  const lon = base(); lon.pedidoId = "x".repeat(41); rejeita(() => S.criarPedidoMesaComanda(lon), /excede 40/);
  const ok40 = base(); ok40.pedidoId = "x".repeat(40); assert.equal(S.criarPedidoMesaComanda(ok40).corpo.order_id.length, 40);
});

test("centavos e quantidades: so inteiros; conversao exata para reais", () => {
  for (let n = 0; n <= 200000; n++) {
    const s = String(n / 100);
    if (!/^\d+(\.\d{1,2})?$/.test(s) || Math.round((n / 100) * 100) !== n) assert.fail("conversao inexata para " + n);
  }
  for (const ruim of [10.5, "1000", -1, null, Number.NaN, Infinity, Number.MAX_SAFE_INTEGER + 2]) {
    const a = base(); a.itens[0].precoCentavos = ruim; rejeita(() => S.criarPedidoMesaComanda(a), /precoCentavos/);
    const b = base(); b.itens[0].complementos[0].precoAdicionalCentavos = ruim; rejeita(() => S.criarPedidoMesaComanda(b), /precoAdicionalCentavos/);
  }
  for (const ruim of [0, -1, 1.5, "2", null]) {
    const a = base(); a.itens[0].quantidade = ruim; rejeita(() => S.criarPedidoMesaComanda(a), /"quantidade" deve ser inteiro >= 1/);
    const b = base(); b.itens[0].complementos[0].quantidade = ruim; rejeita(() => S.criarPedidoMesaComanda(b), /complemento 0.*quantidade/);
  }
  assert.equal(S.totalItensCentavos(base().itens), (3399 + 400 + 1200) * 2);
});

test("faltantes e nao documentados falham, listando todos os problemas (nada e inferido)", () => {
  for (const k of ["pedidoId", "displayId", "lojaCodigo", "criadoEm", "destino", "itens"]) {
    const c = base(); delete c[k]; rejeita(() => S.criarPedidoMesaComanda(c), new RegExp(`ausente "${k}"|${k}`));
  }
  for (const k of ["codigo", "descricao", "quantidade", "precoCentavos"]) {
    const c = base(); delete c.itens[0][k]; rejeita(() => S.criarPedidoMesaComanda(c), new RegExp(`item 0: campo obrigatorio ausente "${k}"`));
  }
  for (const k of ["codigo", "descricao", "quantidade", "precoAdicionalCentavos"]) {
    const c = base(); delete c.itens[0].complementos[0][k]; rejeita(() => S.criarPedidoMesaComanda(c), new RegExp(`complemento 0: campo obrigatorio ausente "${k}"`));
  }
  const vazio = base(); vazio.itens = []; rejeita(() => S.criarPedidoMesaComanda(vazio), /lista nao vazia/);
  const dt = base(); dt.criadoEm = "12/11/2026"; rejeita(() => S.criarPedidoMesaComanda(dt), /ISO-8601/);
  const semFuso = base(); semFuso.criadoEm = "2026-01-01T12:00:00"; rejeita(() => S.criarPedidoMesaComanda(semFuso), /ISO-8601/);
  for (const k of ["pagamentos", "payment_types", "cliente", "customer", "total", "totalDesconto", "tipoServico", "service_type"]) {
    const c = base(); c[k] = {}; rejeita(() => S.criarPedidoMesaComanda(c), new RegExp(`nao documentado/nao suportado "${k}"`));
  }
  const ext = base(); ext.itens[0].codigoExterno = "X"; rejeita(() => S.criarPedidoMesaComanda(ext), /nao documentado.*"codigoExterno"/); // item_external_code so no PUT
  const multi = base(); delete multi.pedidoId; delete multi.itens[0].codigo; multi.itens[1].quantidade = 0;
  const e = rejeita(() => S.criarPedidoMesaComanda(multi), /pedidoId/);
  assert.ok(e.problemas.length >= 3);
  rejeita(() => S.criarPedidoMesaComanda(null), /objeto/);
});

test("PUT adicao (rascunho): item_external_code obrigatorio, sem table, sem campos do POST", () => {
  const entrada = { pedidoId: "SINT-PEDIDO-0001", lojaCodigo: "SINT-LOJA",
    itens: [{ codigo: "00123", codigoExterno: "SINT-EXT-0001", descricao: "Item sintetico A", quantidade: 1, precoCentavos: 3399,
      complementos: [{ codigo: "0456", descricao: "Adicional sintetico", quantidade: 1, precoAdicionalCentavos: 400 }] }] };
  const r = S.rascunhoAdicaoPut(congelar(clone(entrada)));
  assert.equal(r.metodo, "PUT");
  assert.equal(r.rota, "/order");
  assert.equal(r.homologado, false);
  assert.ok(r.avisos.some((a) => /Ensaiar em HML/.test(a)));
  assert.deepEqual(r.corpo, {
    order_id: "SINT-PEDIDO-0001", cod_store: "SINT-LOJA", order_method: { mode: "TABLE" },
    items: [{ integration_code: "00123", item_external_code: "SINT-EXT-0001", desc_item: "Item sintetico A", quantity: 1, unit_price: 33.99,
      choice_items: [{ integration_code: "0456", desc_item_choice: "Adicional sintetico", aditional_price: 4, quantity: 1 }] }],
  });
  assert.equal("table" in r.corpo, false);
  assert.equal("display_id" in r.corpo, false);
  const opc = clone(entrada); opc.displayId = "0043"; opc.criadoEm = "2026-01-01T12:05:00-03:00";
  const r2 = S.rascunhoAdicaoPut(opc);
  assert.equal(r2.corpo.display_id, "0043");
  assert.equal(r2.corpo.created_at, "2026-01-01T12:05:00-03:00");
  const sem = clone(entrada); delete sem.itens[0].codigoExterno; rejeita(() => S.rascunhoAdicaoPut(sem), /ausente "codigoExterno"/);
  const vazio = clone(entrada); vazio.itens[0].codigoExterno = ""; rejeita(() => S.rascunhoAdicaoPut(vazio), /codigoExterno/);
  const obs = clone(entrada); obs.itens[0].observacao = "x"; rejeita(() => S.rascunhoAdicaoPut(obs), /nao documentado.*"observacao"/);
  const garcom = clone(entrada); garcom.itens[0].garcomId = "1"; rejeita(() => S.rascunhoAdicaoPut(garcom), /"garcomId"/);
  const dest = clone(entrada); dest.destino = { tipo: "mesa", descTable: "1" }; rejeita(() => S.rascunhoAdicaoPut(dest), /"destino"/);
  const semLoja = clone(entrada); delete semLoja.lojaCodigo; rejeita(() => S.rascunhoAdicaoPut(semLoja), /ausente "lojaCodigo"/);
  const cp = clone(entrada); delete cp.itens[0].complementos[0].codigo; rejeita(() => S.rascunhoAdicaoPut(cp), /complemento 0: campo obrigatorio ausente "codigo"/);
});

test("pedirConta: PUT /order-status CLOSE_REQUESTED apenas; nao e pagamento nem fechamento", () => {
  const r = S.pedirConta({ pedidoId: "SINT-PEDIDO-0001", lojaCodigo: "SINT-LOJA" });
  assert.equal(r.metodo, "PUT");
  assert.equal(r.rota, "/order-status");
  assert.deepEqual(r.corpo, { order_id: "SINT-PEDIDO-0001", cod_store: "SINT-LOJA", status: "CLOSE_REQUESTED" });
  assert.deepEqual(Object.keys(r.corpo).sort(), ["cod_store", "order_id", "status"]);
  assert.ok(!/payment|amount|valor|pag|CLOSED|PAID/i.test(JSON.stringify(r.corpo).replace("CLOSE_REQUESTED", "")));
  assert.equal(r.homologado, false);
  rejeita(() => S.pedirConta({ lojaCodigo: "L" }), /ausente "pedidoId"/);
  rejeita(() => S.pedirConta({ pedidoId: "P" }), /ausente "lojaCodigo"/);
  rejeita(() => S.pedirConta({ pedidoId: "P", lojaCodigo: "L", status: "CLOSED" }), /nao documentado.*"status"/);
  rejeita(() => S.pedirConta({ pedidoId: "P", lojaCodigo: "L", pagamento: 10 }), /"pagamento"/);
  rejeita(() => S.pedirConta({ pedidoId: 12, lojaCodigo: "L" }), /pedidoId/);
  rejeita(() => S.pedirConta({ pedidoId: "x".repeat(41), lojaCodigo: "L" }), /excede 40/);
});

test("desfecho desconhecido exige reconciliacao e nunca manda repetir automaticamente", () => {
  const entradas = [undefined, null, {}, { semResposta: true }, { statusResposta: 200 }, { statusResposta: 500 }, { statusResposta: 504 }, { codigoErro: 921 }, { codigoErro: 904 },
    { codigoErro: 907 }, { codigoErro: 12345 }, { codigoErro: 908 }, { codigoErro: 912 }, { codigoErro: 931 }, { statusResposta: 200, codigoErro: 925 }];
  for (const e of entradas) assert.equal(S.classificarDesfecho(e).repetirAutomaticamente, false, JSON.stringify(e));
  for (const e of [undefined, {}, { semResposta: true }, { statusResposta: 504 }, { statusResposta: 200 }, { codigoErro: 921 }, { codigoErro: 904 }, { codigoErro: 12345 }]) {
    assert.equal(S.classificarDesfecho(e).reconciliar, true, JSON.stringify(e));
  }
  assert.equal(S.classificarDesfecho({ semResposta: true }).classe, "desconhecido");
  assert.equal(S.classificarDesfecho({ codigoErro: 908 }).classe, "rejeitado-documentado");
  assert.equal(S.classificarDesfecho({ codigoErro: 908 }).nome, "TABLE_NOT_FOUND");
  assert.equal(S.classificarDesfecho({ codigoErro: 912 }).reconciliar, false);
  assert.equal(S.classificarDesfecho({ statusResposta: 200 }).classe, "sucesso-nao-homologado");
  assert.equal(S.classificarDesfecho({ codigoErro: 12345 }).classe, "desconhecido");
});

// ---- regressoes da revisao independente (docs/REVISAO-PAYLOAD.md) ----
const putBase = () => ({ pedidoId: "SINT-PEDIDO-0001", lojaCodigo: "SINT-LOJA", displayId: "0043", criadoEm: "2026-01-01T12:05:00Z",
  itens: [{ codigo: "00123", codigoExterno: "SINT-EXT-0001", descricao: "Item sintetico A", quantidade: 1, precoCentavos: 100,
    complementos: [{ codigo: "0456", descricao: "Adicional sintetico", quantidade: 1, precoAdicionalCentavos: 50 }] }] });

test("regressao: propriedade presente com valor undefined falha (nunca vira table:null nem campo vazio)", () => {
  const mesa = base(); mesa.destino = { tipo: "mesa", descTable: undefined };
  const e1 = rejeita(() => S.criarPedidoMesaComanda(mesa), /"descTable" esta presente com valor undefined/);
  assert.ok(e1.problemas.some((p) => /mesa exige|descTable/.test(p)));
  const comanda = base(); comanda.destino = { tipo: "comanda", descOrderPad: undefined };
  rejeita(() => S.criarPedidoMesaComanda(comanda), /"descOrderPad" esta presente com valor undefined/);
  const tipo = base(); tipo.destino = { tipo: undefined, descTable: "1" }; rejeita(() => S.criarPedidoMesaComanda(tipo), /"tipo" esta presente com valor undefined/);
  const ic = base(); ic.destino = { tipo: "mesa", descTable: "1", integrationCode: undefined }; rejeita(() => S.criarPedidoMesaComanda(ic), /"integrationCode" esta presente com valor undefined/);
  const icc = base(); icc.destino = { tipo: "mesa", descTable: "1", integrationCode: "9", integrationCodeConfirmado: undefined }; rejeita(() => S.criarPedidoMesaComanda(icc), /integrationCodeConfirmado/);
  for (const k of ["pedidoId", "displayId", "lojaCodigo", "criadoEm", "destino", "itens"]) {
    const c = base(); c[k] = undefined; rejeita(() => S.criarPedidoMesaComanda(c), new RegExp(`"${k}" esta presente com valor undefined`));
  }
  for (const k of ["observacao", "referenciaParceiro"]) { const c = base(); c[k] = undefined; rejeita(() => S.criarPedidoMesaComanda(c), new RegExp(`"${k}" esta presente com valor undefined`)); }
  for (const k of ["codigo", "descricao", "quantidade", "precoCentavos", "observacao", "garcomId", "complementos"]) {
    const c = base(); c.itens[0][k] = undefined; rejeita(() => S.criarPedidoMesaComanda(c), new RegExp(`item 0: "${k}" esta presente com valor undefined`));
  }
  for (const k of ["codigo", "descricao", "quantidade", "precoAdicionalCentavos", "observacao"]) {
    const c = base(); c.itens[0].complementos[0][k] = undefined; rejeita(() => S.criarPedidoMesaComanda(c), new RegExp(`complemento 0: "${k}" esta presente com valor undefined`));
  }
  for (const k of ["pedidoId", "lojaCodigo", "displayId", "criadoEm", "itens"]) {
    const c = putBase(); c[k] = undefined; rejeita(() => S.rascunhoAdicaoPut(c), new RegExp(`"${k}" esta presente com valor undefined`));
  }
  for (const k of ["codigo", "codigoExterno", "descricao", "quantidade", "precoCentavos"]) {
    const c = putBase(); c.itens[0][k] = undefined; rejeita(() => S.rascunhoAdicaoPut(c), new RegExp(`item 0: "${k}" esta presente com valor undefined`));
  }
  for (const k of ["pedidoId", "lojaCodigo"]) { const c = { pedidoId: "P", lojaCodigo: "L" }; c[k] = undefined; rejeita(() => S.pedirConta(c), new RegExp(`"${k}" esta presente com valor undefined`)); }
});

test("regressao: textos vazios ou so com espacos falham em todos os campos de texto", () => {
  for (const ruim of ["", "   "]) {
    const m = base(); m.destino = { tipo: "mesa", descTable: ruim }; rejeita(() => S.criarPedidoMesaComanda(m), /"descTable" deve ser texto literal/);
    const c = base(); c.destino = { tipo: "comanda", descOrderPad: ruim }; rejeita(() => S.criarPedidoMesaComanda(c), /"descOrderPad" deve ser texto literal/);
    for (const k of ["pedidoId", "displayId", "lojaCodigo", "observacao", "referenciaParceiro"]) { const x = base(); x[k] = ruim; rejeita(() => S.criarPedidoMesaComanda(x), new RegExp(`"${k}" deve ser texto literal`)); }
    for (const k of ["codigo", "descricao", "observacao", "garcomId"]) { const x = base(); x.itens[0][k] = ruim; rejeita(() => S.criarPedidoMesaComanda(x), new RegExp(`item 0: "${k}" deve ser texto literal`)); }
    for (const k of ["codigo", "descricao"]) { const x = putBase(); x.itens[0][k] = ruim; rejeita(() => S.rascunhoAdicaoPut(x), new RegExp(`"${k}" deve ser texto literal`)); }
    rejeita(() => S.pedirConta({ pedidoId: ruim, lojaCodigo: "L" }), /"pedidoId" deve ser texto literal/);
  }
});

test("regressao: propriedades herdadas nao contam como fornecidas", () => {
  const herdado = base(); herdado.destino = Object.assign(Object.create({ descTable: "12" }), { tipo: "mesa" });
  rejeita(() => S.criarPedidoMesaComanda(herdado), /mesa exige "descTable"/);
  const herdado2 = base(); herdado2.destino = Object.assign(Object.create({ descOrderPad: "A1" }), { tipo: "comanda" });
  rejeita(() => S.criarPedidoMesaComanda(herdado2), /comanda exige "descOrderPad"/);
  const item = base(); item.itens[0] = Object.assign(Object.create({ codigo: "X" }), { descricao: "d", quantidade: 1, precoCentavos: 1 });
  rejeita(() => S.criarPedidoMesaComanda(item), /item 0: campo obrigatorio ausente "codigo"/);
  const topo = Object.assign(Object.create({ pedidoId: "P" }), { lojaCodigo: "L" });
  rejeita(() => S.pedirConta(topo), /ausente "pedidoId"/);
});

test("regressao: total de conferencia usa Number.isSafeInteger em toda soma/multiplicacao", () => {
  const MAX = Number.MAX_SAFE_INTEGER;
  const lim = /excede o limite tecnico de inteiro seguro/;
  const um = (mut) => { const c = base(); c.itens = [{ codigo: "1", descricao: "d", quantidade: 1, precoCentavos: 1 }]; mut(c.itens[0]); return c; };
  // caso reportado: preco MAX_SAFE x quantidade 2
  rejeita(() => S.criarPedidoMesaComanda(um((i) => { i.precoCentavos = MAX; i.quantidade = 2; })), /item 0 \(preco com adicionais x quantidade\).*excede/);
  // complemento: preco x quantidade
  rejeita(() => S.criarPedidoMesaComanda(um((i) => { i.complementos = [{ codigo: "2", descricao: "c", quantidade: 2, precoAdicionalCentavos: MAX }]; })), /complemento 0 \(preco x quantidade\)/);
  // soma de adicionais
  rejeita(() => S.criarPedidoMesaComanda(um((i) => { i.complementos = [{ codigo: "2", descricao: "c", quantidade: 1, precoAdicionalCentavos: MAX }, { codigo: "3", descricao: "c", quantidade: 1, precoAdicionalCentavos: 1 }]; })), /soma de adicionais/);
  // preco + adicionais
  rejeita(() => S.criarPedidoMesaComanda(um((i) => { i.precoCentavos = MAX; i.complementos = [{ codigo: "2", descricao: "c", quantidade: 1, precoAdicionalCentavos: 1 }]; })), /preco \+ adicionais/);
  // soma entre itens
  const dois = base(); dois.itens = [{ codigo: "1", descricao: "d", quantidade: 1, precoCentavos: MAX }, { codigo: "2", descricao: "d", quantidade: 1, precoCentavos: 1 }];
  rejeita(() => S.criarPedidoMesaComanda(dois), /soma dos itens ate o item 1/);
  // PUT tambem
  const p = putBase(); p.itens[0].precoCentavos = MAX; p.itens[0].quantidade = 2; p.itens[0].complementos = [];
  rejeita(() => S.rascunhoAdicaoPut(p), lim);
  // totalItensCentavos exportada tambem lanca ErroPayload (nunca devolve valor inseguro)
  assert.throws(() => S.totalItensCentavos([{ precoCentavos: MAX, quantidade: 2 }]), (e) => e instanceof S.ErroPayload && lim.test(e.problemas[0]));
  // limites exatos continuam aceitos: nenhum limite comercial inventado
  const metade = Math.floor(MAX / 2);
  const ok1 = S.criarPedidoMesaComanda(um((i) => { i.precoCentavos = metade; i.quantidade = 2; }));
  assert.equal(ok1.conferencia.totalItensCentavos, metade * 2);
  assert.ok(Number.isSafeInteger(ok1.conferencia.totalItensCentavos));
  const ok2 = S.criarPedidoMesaComanda(um((i) => { i.precoCentavos = MAX; }));
  assert.equal(ok2.conferencia.totalItensCentavos, MAX);
  const ok3 = S.rascunhoAdicaoPut(putBase());
  assert.equal(ok3.conferencia.totalItensCentavos, (100 + 50) * 1);
});

test("pureza: mesma entrada, mesmo resultado; entrada nao e alterada", () => {
  const e = base();
  const antes = JSON.stringify(e);
  const a = S.criarPedidoMesaComanda(e);
  const b = S.criarPedidoMesaComanda(e);
  assert.deepEqual(a, b);
  assert.equal(JSON.stringify(e), antes);
  a.corpo.items[0].desc_item = "alterado";
  assert.equal(e.itens[0].descricao, "Item sintetico A");
});
