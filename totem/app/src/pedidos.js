// Regras de negócio do laboratório: validação, cálculo de total no servidor,
// máquina de estados e idempotência. Programa determinístico, sem IA por pedido.
// Todas as funções aqui operam sobre um `estado` (clone fornecido pelo
// Store.transacao) e só devem mutá-lo quando a operação é válida; quando
// lançam ErroPedido, a transação é abortada e nada é persistido.

import { randomUUID } from "node:crypto";
import { buscarProduto, buscarAdicional, ingredienteExiste } from "./cardapio.js";

export const LOJA_FICTICIA_ID = "LOJA-FICTICIA-01";
export const LIMITE_ITENS_POR_PEDIDO = 100;
export const LIMITE_QUANTIDADE_POR_ITEM = 20;

export class ErroPedido extends Error {
  constructor(mensagem, codigo) {
    super(mensagem);
    this.codigo = codigo;
  }
}

const TRANSICOES = {
  CRIADO: ["PAGO", "CANCELADO"],
  PAGO: ["PREPARANDO", "CANCELADO"],
  PREPARANDO: ["PRONTO", "CANCELADO"],
  PRONTO: ["RETIRADO"],
  RETIRADO: [],
  CANCELADO: [],
};

function dedupe(lista) {
  return [...new Set(lista)];
}

function validarItem(itemBruto) {
  if (!itemBruto || typeof itemBruto !== "object") {
    throw new ErroPedido("Item inválido.", "ITEM_INVALIDO");
  }
  const { produtoId, quantidade = 1, adicionais = [], removerIngredientes = [] } = itemBruto;

  const produto = buscarProduto(produtoId);
  if (!produto) {
    throw new ErroPedido(`Produto desconhecido: ${produtoId}`, "PRODUTO_DESCONHECIDO");
  }

  if (!Number.isInteger(quantidade) || quantidade < 1 || quantidade > LIMITE_QUANTIDADE_POR_ITEM) {
    throw new ErroPedido(
      `Quantidade deve ser um inteiro entre 1 e ${LIMITE_QUANTIDADE_POR_ITEM}.`,
      "QUANTIDADE_INVALIDA"
    );
  }

  if (!Array.isArray(adicionais) || !Array.isArray(removerIngredientes)) {
    throw new ErroPedido("Adicionais/remoções devem ser listas.", "FORMATO_INVALIDO");
  }

  const adicionaisUnicos = dedupe(adicionais);
  const removerUnicos = dedupe(removerIngredientes);

  for (const adicionalId of adicionaisUnicos) {
    if (!produto.adicionaisPermitidos.includes(adicionalId)) {
      throw new ErroPedido(
        `Adicional ${adicionalId} não é permitido para o produto ${produtoId}.`,
        "ADICIONAL_NAO_PERMITIDO"
      );
    }
    if (!buscarAdicional(adicionalId)) {
      throw new ErroPedido(`Adicional desconhecido: ${adicionalId}`, "ADICIONAL_DESCONHECIDO");
    }
  }

  for (const ingredienteId of removerUnicos) {
    if (!ingredienteExiste(ingredienteId)) {
      throw new ErroPedido(`Ingrediente desconhecido: ${ingredienteId}`, "INGREDIENTE_DESCONHECIDO");
    }
    if (!produto.ingredientesRemoviveis.includes(ingredienteId)) {
      throw new ErroPedido(
        `Ingrediente ${ingredienteId} não pode ser removido do produto ${produtoId}.`,
        "REMOCAO_NAO_PERMITIDA"
      );
    }
  }

  const adicionaisResolvidos = adicionaisUnicos.map((id) => {
    const a = buscarAdicional(id);
    return { id: a.id, nome: a.nome, preco: a.preco };
  });
  const removerResolvidos = removerUnicos.map((id) => ({ id, nome: nomeIngrediente(id) }));

  const precoAdicionais = adicionaisResolvidos.reduce((soma, a) => soma + a.preco, 0);
  const precoUnitario = produto.precoBase + precoAdicionais;

  return {
    produtoId,
    nomeProduto: produto.nome,
    quantidade,
    adicionais: adicionaisUnicos,
    adicionaisDetalhe: adicionaisResolvidos,
    removerIngredientes: removerUnicos,
    removerIngredientesDetalhe: removerResolvidos,
    precoUnitario,
    subtotal: precoUnitario * quantidade,
  };
}

function nomeIngrediente(id) {
  const mapa = { ing1: "Cebola", ing2: "Picles" };
  return mapa[id] || id;
}

export function calcularPedido(itensBrutos) {
  if (!Array.isArray(itensBrutos) || itensBrutos.length === 0) {
    throw new ErroPedido("Pedido precisa de ao menos um item.", "PEDIDO_VAZIO");
  }
  if (itensBrutos.length > LIMITE_ITENS_POR_PEDIDO) {
    throw new ErroPedido(
      `Pedido excede o limite de ${LIMITE_ITENS_POR_PEDIDO} itens.`,
      "LIMITE_ITENS_EXCEDIDO"
    );
  }
  const itens = itensBrutos.map(validarItem);
  const total = itens.reduce((soma, item) => soma + item.subtotal, 0);
  return { itens, total };
}

function mesmoPayload(a, b) {
  return JSON.stringify(a) === JSON.stringify(b);
}

function transicionar(pedido, novoStatus) {
  const permitidos = TRANSICOES[pedido.status] || [];
  if (!permitidos.includes(novoStatus)) {
    throw new ErroPedido(
      `Transição inválida: ${pedido.status} -> ${novoStatus}`,
      "TRANSICAO_INVALIDA"
    );
  }
  const agora = new Date().toISOString();
  pedido.status = novoStatus;
  pedido.atualizadoEm = agora;
  pedido.historico.push({ status: novoStatus, em: agora });
}

// Cria o pedido dentro do `estado` (clone da transação). Loja fictícia é fixa
// e validada explicitamente: qualquer outro valor de lojaId é rejeitado.
export function criarPedido(estado, { idempotencyKey, itens: itensBrutos, lojaId }) {
  if (!idempotencyKey || typeof idempotencyKey !== "string") {
    throw new ErroPedido("idempotencyKey é obrigatória.", "IDEMPOTENCY_KEY_AUSENTE");
  }

  if (lojaId !== undefined && lojaId !== LOJA_FICTICIA_ID) {
    throw new ErroPedido(
      `Loja desconhecida: ${lojaId}. Este laboratório só aceita a loja fictícia fixa ${LOJA_FICTICIA_ID}.`,
      "LOJA_INVALIDA"
    );
  }

  const existente = Object.values(estado.pedidos).find((p) => p.idempotencyKey === idempotencyKey);
  if (existente) {
    if (mesmoPayload(existente.itensOriginais, itensBrutos)) {
      return existente; // reenvio idêntico: não duplica, não muda nada
    }
    throw new ErroPedido(
      "Já existe pedido com esta idempotencyKey, mas com dados diferentes.",
      "IDEMPOTENCY_CONFLITO"
    );
  }

  const { itens, total } = calcularPedido(itensBrutos);

  const agora = new Date().toISOString();
  const pedido = {
    id: randomUUID(),
    idempotencyKey,
    lojaId: LOJA_FICTICIA_ID,
    itensOriginais: itensBrutos,
    itens,
    total,
    status: "CRIADO",
    senha: String(SENHA_MIN + estado.contadorSenha),
    criadoEm: agora,
    atualizadoEm: agora,
    historico: [{ status: "CRIADO", em: agora }],
    pagamento: null,
  };

  estado.contadorSenha += 1;
  estado.pedidos[pedido.id] = pedido;
  return pedido;
}

// Pagamento simulado nunca lança erro depois de já ter mutado o pedido de
// forma a deixar a transação com estado inconsistente: ou aborta antes de
// mudar nada (erro de uso/conflito), ou muda e retorna normalmente — mesmo
// quando o resultado é "recusado" (fica persistido como recusado, nunca
// retorna 200 nem avança o pedido). O chamador (servidor) decide o código
// HTTP olhando pedido.pagamento.resultado.
export function confirmarPagamentoSimulado(estado, pedidoId, { idempotencyKey, resultado }) {
  if (!idempotencyKey || typeof idempotencyKey !== "string") {
    throw new ErroPedido("idempotencyKey do pagamento é obrigatória.", "IDEMPOTENCY_KEY_AUSENTE");
  }
  if (!["aprovado", "recusado"].includes(resultado)) {
    throw new ErroPedido("Resultado de pagamento de teste inválido.", "RESULTADO_INVALIDO");
  }

  const pedido = estado.pedidos[pedidoId];
  if (!pedido) {
    throw new ErroPedido("Pedido não encontrado.", "PEDIDO_NAO_ENCONTRADO");
  }

  if (pedido.pagamento) {
    if (pedido.pagamento.idempotencyKey !== idempotencyKey) {
      throw new ErroPedido(
        "Este pedido já teve uma tentativa de pagamento com outra idempotencyKey.",
        "PAGAMENTO_JA_TENTADO"
      );
    }
    if (pedido.pagamento.resultado !== (resultado === "aprovado" ? "aprovado" : "recusado")) {
      throw new ErroPedido(
        "Reenvio com a mesma idempotencyKey de pagamento, mas resultado diferente do original, não é permitido.",
        "IDEMPOTENCY_PAGAMENTO_CONFLITO"
      );
    }
    return pedido; // replay idêntico (aprovado ou recusado): devolve o mesmo estado já persistido
  }

  if (pedido.status !== "CRIADO") {
    throw new ErroPedido(
      `Pagamento só pode ser confirmado em pedidos CRIADO (status atual: ${pedido.status}).`,
      "STATUS_INVALIDO_PARA_PAGAMENTO"
    );
  }

  const aprovado = resultado === "aprovado";
  pedido.pagamento = {
    idempotencyKey,
    resultado: aprovado ? "aprovado" : "recusado",
    em: new Date().toISOString(),
  };

  if (aprovado) {
    transicionar(pedido, "PAGO");
    transicionar(pedido, "PREPARANDO");
  }

  return pedido;
}

// "Pronto" só pode ser acionado pela cozinha, após PREPARANDO, e não depende
// do aparelho/status de pagamento. Senha já foi alocada na criação por um contador de loja
// persistido no próprio estado, nunca calculada a partir do tamanho do
// histórico — por isso é única mesmo com vários pedidos e sobrevive a restart.
const SENHA_MIN = 1000;

export function marcarPronto(estado, pedidoId) {
  const pedido = estado.pedidos[pedidoId];
  if (!pedido) {
    throw new ErroPedido("Pedido não encontrado.", "PEDIDO_NAO_ENCONTRADO");
  }
  transicionar(pedido, "PRONTO"); // lança antes de mutar nada se status atual não permitir

  return pedido;
}

export function marcarRetirado(estado, pedidoId) {
  const pedido = estado.pedidos[pedidoId];
  if (!pedido) throw new ErroPedido("Pedido não encontrado.", "PEDIDO_NAO_ENCONTRADO");
  transicionar(pedido, "RETIRADO");
  return pedido;
}

export function cancelarPedido(estado, pedidoId) {
  const pedido = estado.pedidos[pedidoId];
  if (!pedido) throw new ErroPedido("Pedido não encontrado.", "PEDIDO_NAO_ENCONTRADO");
  transicionar(pedido, "CANCELADO");
  return pedido;
}
