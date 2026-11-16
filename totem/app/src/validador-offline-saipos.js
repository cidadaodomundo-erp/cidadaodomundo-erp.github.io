// VALIDADOR OFFLINE DE FORMATO — TICKET (Order API Saipos).
// NUNCA ENVIA NADA A LUGAR ALGUM. NUNCA CHAMA REDE. NUNCA USA CREDENCIAIS.
// Apenas confere se um payload TEM o formato exigido pela documentação
// pública da Order API para pedidos do tipo TICKET (modo recomendado pela
// Saipos para totem de autoatendimento), conforme lido e registrado em
// docs/saipos-oficial.md. NÃO afirma "homologado" — é só uma
// checagem de formato antes de qualquer tentativa real (que não ocorre aqui).

import { ErroPedido } from "./pedidos.js";
import { buscarProduto, buscarAdicional } from "./cardapio.js";

// Mapeamento de códigos de integração FICTÍCIOS, só para este laboratório.
// Produto/adicional sem entrada aqui bloqueia a geração do payload —
// não existe fallback nem invenção de código.
const MAPEAMENTO_INTEGRACAO_PRODUTO_FICTICIO = {
  p1: "FICT-P1",
  p2: "FICT-P2",
  p3: "FICT-P3",
};

const MAPEAMENTO_INTEGRACAO_ADICIONAL_FICTICIO = {
  a1: "FICT-A1",
  a2: "FICT-A2",
  a3: "FICT-A3",
};

function centavosParaReais(centavos) {
  return Math.round(centavos) / 100;
}

// Gera um payload TICKET fictício a partir de um pedido já criado no
// laboratório (não de dados arbitrários), para fins de checagem de formato.
// Lança ErroPedido se faltar mapeamento de integração — mapeamento ausente
// bloqueia, nunca é inventado.
export function gerarPayloadTicketFicticio(pedido) {
  const items = pedido.itens.map((item) => {
    const codigoProduto = MAPEAMENTO_INTEGRACAO_PRODUTO_FICTICIO[item.produtoId];
    if (!codigoProduto) {
      throw new ErroPedido(
        `Mapeamento de integração fictício ausente para o produto ${item.produtoId}.`,
        "MAPEAMENTO_AUSENTE"
      );
    }
    const produto = buscarProduto(item.produtoId);

    const choice_items = (item.adicionaisDetalhe || []).map((adicional) => {
      const codigoAdicional = MAPEAMENTO_INTEGRACAO_ADICIONAL_FICTICIO[adicional.id];
      if (!codigoAdicional) {
        throw new ErroPedido(
          `Mapeamento de integração fictício ausente para o adicional ${adicional.id}.`,
          "MAPEAMENTO_AUSENTE"
        );
      }
      return {
        integration_code: codigoAdicional,
        desc_item_choice: adicional.nome,
        aditional_price: centavosParaReais(adicional.preco),
        quantity: 1,
      };
    });

    return {
      integration_code: codigoProduto,
      desc_item: produto.nome,
      quantity: item.quantidade,
      unit_price: centavosParaReais(produto.precoBase),
      notes: item.removerIngredientesDetalhe?.length
        ? `TESTE sem: ${item.removerIngredientesDetalhe.map((i) => i.nome).join(", ")}`
        : "TESTE",
      choice_items,
    };
  });

  return {
    order_id: `FICT-${pedido.id}`,
    display_id: `FICT-${pedido.senha || "0000"}`,
    cod_store: "FICT-LOJA-TESTE",
    created_at: pedido.criadoEm,
    notes: "TESTE",
    total_discount: 0,
    customer: { id: "-1", name: "TESTE" },
    order_method: { mode: "TICKET", ticket_reference: `FICT-${pedido.id}` },
    items,
    payment_types: [{ code: "FICT-PAG", amount: centavosParaReais(pedido.total), change_for: 0 }],
  };
}

// Checagem de formato pura, sem rede. Confere campos obrigatórios/opcionais
// do TICKET conforme estrutura-campos-endpoints (ver docs/saipos-oficial.md):
// total_amount NÃO é obrigatório para TICKET; payment_types É obrigatório;
// customer.id/name são obrigatórios, customer.phone é opcional;
// choice_items usa a grafia oficial "aditional_price" (um "d").
export function validarPayloadTicketOffline(payload) {
  const erros = [];
  const moeda = (valor) => Number.isFinite(valor) && valor >= 0 && Math.abs(valor * 100 - Math.round(valor * 100)) < 0.000001;

  if (!payload || typeof payload !== "object") {
    return { valido: false, erros: ["Payload inválido: não é um objeto."], aviso: AVISO };
  }

  for (const campo of ["order_id", "display_id", "cod_store", "created_at", "total_discount", "customer", "order_method", "items", "payment_types"]) {
    if (!(campo in payload) || payload[campo] === undefined || payload[campo] === null) {
      erros.push(`Campo raiz obrigatório ausente: ${campo}`);
    }
  }

  if (typeof payload.order_id !== "string") erros.push("order_id deve ser string.");
  if (typeof payload.display_id !== "string") erros.push("display_id deve ser string.");
  if (typeof payload.cod_store !== "string") erros.push("cod_store deve ser string.");
  if (typeof payload.created_at !== "string") erros.push("created_at deve ser string.");
  if (typeof payload.total_discount !== "number") erros.push("total_discount deve ser number.");
  for (const campo of ["total_discount", "total_increase", "total_amount"]) {
    if (payload[campo] !== undefined && !moeda(payload[campo])) erros.push(`${campo} deve ser um valor não negativo com até dois decimais.`);
  }
  if (typeof payload.created_at === "string" && !Number.isFinite(Date.parse(payload.created_at))) erros.push("created_at deve conter data válida.");
  for (const campo of ["order_id", "display_id", "cod_store"]) {
    if (typeof payload[campo] === "string" && !payload[campo].trim()) erros.push(`${campo} não pode ser vazio.`);
  }

  if (payload.customer && typeof payload.customer === "object") {
    if (typeof payload.customer.id !== "string") {
      erros.push('customer.id deve ser string (use "-1" para consumidor não identificado, conforme documentação).');
    }
    if (typeof payload.customer.name !== "string") erros.push("customer.name deve ser string.");
  } else {
    erros.push("customer deve ser um objeto com id e name.");
  }

  if (payload.order_method && typeof payload.order_method === "object") {
    if (payload.order_method.mode !== "TICKET") {
      erros.push('order_method.mode deve ser "TICKET" para este laboratório/totem.');
    }
  } else {
    erros.push("order_method deve ser um objeto com mode.");
  }

  let somaItens = 0;
  if (!Array.isArray(payload.items) || payload.items.length === 0) {
    erros.push("items deve ser um array não vazio.");
  } else {
    payload.items.forEach((item, i) => {
      if (!item || typeof item !== "object") { erros.push(`items[${i}] deve ser objeto.`); return; }
      if (typeof item.integration_code !== "string" || item.integration_code === "") {
        erros.push(`items[${i}].integration_code deve ser string não vazia (mapeamento ausente bloqueia).`);
      }
      if (typeof item.desc_item !== "string") erros.push(`items[${i}].desc_item deve ser string.`);
      if (!Number.isInteger(item.quantity) || item.quantity < 1) {
        erros.push(`items[${i}].quantity deve ser um inteiro positivo.`);
      }
      if (typeof item.unit_price !== "number") erros.push(`items[${i}].unit_price deve ser number.`);
      if (!moeda(item.unit_price)) erros.push(`items[${i}].unit_price inválido.`);

      let somaAdicionais = 0;
      if (item.choice_items !== undefined) {
        if (!Array.isArray(item.choice_items)) {
          erros.push(`items[${i}].choice_items deve ser array quando presente.`);
        } else {
          item.choice_items.forEach((c, j) => {
            if (!c || typeof c !== "object") { erros.push(`Adicional ${i}/${j} deve ser objeto.`); return; }
            if (!moeda(c.aditional_price)) erros.push(`Adicional ${i}/${j} possui valor inválido.`);
            if (typeof c.integration_code !== "string" || c.integration_code === "") {
              erros.push(`items[${i}].choice_items[${j}].integration_code deve ser string não vazia.`);
            }
            if (typeof c.desc_item_choice !== "string") {
              erros.push(`items[${i}].choice_items[${j}].desc_item_choice deve ser string.`);
            }
            if (typeof c.aditional_price !== "number") {
              erros.push(`items[${i}].choice_items[${j}].aditional_price deve ser number (grafia oficial com um "d").`);
            } else {
              somaAdicionais += c.aditional_price * (Number.isInteger(c.quantity) ? c.quantity : 1);
            }
            if (!Number.isInteger(c.quantity) || c.quantity < 1) {
              erros.push(`items[${i}].choice_items[${j}].quantity deve ser inteiro positivo.`);
            }
          });
        }
      }

      if (typeof item.unit_price === "number" && Number.isInteger(item.quantity)) {
        somaItens += (item.unit_price + somaAdicionais) * item.quantity;
      }
    });
  }

  let somaPagamentos = 0;
  if (!Array.isArray(payload.payment_types) || payload.payment_types.length === 0) {
    erros.push("payment_types é OBRIGATÓRIO para TICKET e deve ser array não vazio.");
  } else {
    payload.payment_types.forEach((pg, i) => {
      if (!pg || typeof pg !== "object") { erros.push(`Pagamento ${i} deve ser objeto.`); return; }
      if (!moeda(pg.amount) || !moeda(pg.change_for)) erros.push(`Pagamento ${i} possui valor inválido.`);
      if (typeof pg.code !== "string") erros.push(`payment_types[${i}].code deve ser string.`);
      if (typeof pg.amount !== "number") {
        erros.push(`payment_types[${i}].amount deve ser number.`);
      } else {
        somaPagamentos += pg.amount;
      }
      if (typeof pg.change_for !== "number") erros.push(`payment_types[${i}].change_for deve ser number.`);
    });

    if (erros.length === 0 || (Array.isArray(payload.items) && payload.items.length > 0)) {
      const totalEsperado = Math.round(somaItens * 100) - Math.round((payload.total_discount || 0) * 100) + Math.round((payload.total_increase || 0) * 100);
      const diferenca = Math.abs(Math.round(somaPagamentos * 100) - totalEsperado);
      if (totalEsperado < 0) erros.push("Desconto maior que o total.");
      if (payload.total_amount !== undefined && Math.round(payload.total_amount * 100) !== totalEsperado) erros.push("total_amount não confere com itens, desconto e acréscimo.");
      if (diferenca > 0) {
        erros.push(
          `Soma de payment_types (${somaPagamentos.toFixed(2)}) não bate com soma de itens+adicionais (${somaItens.toFixed(2)}). Valores em reais (documentação oficial não confirma centavos vs. reais de forma consistente nos exemplos; este laboratório usa reais com 2 decimais).`
        );
      }
    }
  }

  return { valido: erros.length === 0, erros, aviso: AVISO };
}

const AVISO =
  "Checagem offline de FORMATO do payload TICKET. Nunca envia nada à Saipos, nunca usa credenciais, nunca chama rede. Não substitui homologação real e não afirma que o pedido está homologado.";
