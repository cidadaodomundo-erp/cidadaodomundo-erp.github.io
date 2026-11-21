// Cliente do totem fictício. Só fala com o próprio laboratório local (mesma origem).

const carrinho = [];
let cardapio = null;

// Gerado uma única vez por tentativa de pedido/pagamento, e reutilizado em
// qualquer reenvio por falha de rede — nunca um Date.now() novo a cada
// clique, senão o cliente criaria um pedido/pagamento duplicado a cada retry.
let idempotencyKeyPedidoAtual = null;
let idempotencyKeyPagamentoAtual = null;
let pedidoAtualId = null;
let tentativaEmAndamento = false;

function formatarCentavos(centavos) {
  return `R$ ${(centavos / 100).toFixed(2).replace(".", ",")} (FICTÍCIO)`;
}

function gerarChave(prefixo) {
  return `${prefixo}-${crypto.randomUUID()}`;
}

async function carregarCardapio() {
  const resp = await fetch("/api/cardapio");
  cardapio = await resp.json();
  const container = document.getElementById("produtos");
  container.innerHTML = "";
  for (const produto of cardapio.produtos) {
    const div = document.createElement("div");
    div.className = "produto";
    const adicionaisHtml = produto.adicionaisPermitidos
      .map((id) => {
        const a = cardapio.adicionais.find((x) => x.id === id);
        return `<label><input type="checkbox" data-adicional="${a.id}"> ${a.nome} (+${formatarCentavos(a.preco)})</label>`;
      })
      .join("");
    const remocoesHtml = produto.ingredientesRemoviveis
      .map((id) => {
        const i = cardapio.ingredientes.find((x) => x.id === id);
        return `<label><input type="checkbox" data-remover="${i.id}"> Remover ${i.nome}</label>`;
      })
      .join("");
    div.innerHTML = `
      <b>${produto.nome}</b> — <span class="preco">${formatarCentavos(produto.precoBase)}</span><br>
      ${adicionaisHtml}
      ${remocoesHtml}
      <button data-produto="${produto.id}">Adicionar</button>
    `;
    div.querySelector("button").addEventListener("click", () => adicionarAoCarrinho(div, produto));
    container.appendChild(div);
  }
}

function adicionarAoCarrinho(div, produto) {
  const adicionais = [...div.querySelectorAll("[data-adicional]:checked")].map((el) => el.dataset.adicional);
  const removerIngredientes = [...div.querySelectorAll("[data-remover]:checked")].map((el) => el.dataset.remover);
  carrinho.push({ produtoId: produto.id, quantidade: 1, adicionais, removerIngredientes });
  renderCarrinho();
}

function renderCarrinho() {
  const container = document.getElementById("carrinho");
  container.innerHTML = carrinho
    .map((item, i) => `<div>${item.produtoId} x${item.quantidade} <button data-remove="${i}">remover</button></div>`)
    .join("");
  container.querySelectorAll("[data-remove]").forEach((btn) => {
    btn.addEventListener("click", () => {
      carrinho.splice(Number(btn.dataset.remove), 1);
      renderCarrinho();
    });
  });
}

function definirBotaoCriarDesabilitado(desabilitado) {
  document.getElementById("btnCriar").disabled = desabilitado;
}

async function criarOuReenviarPedido() {
  const resultadoDiv = document.getElementById("resultadoPedido");
  if (!idempotencyKeyPedidoAtual) {
    idempotencyKeyPedidoAtual = gerarChave("pedido");
  }
  const resp = await fetch("/api/pedidos", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ idempotencyKey: idempotencyKeyPedidoAtual, itens: carrinho }),
  });
  const dados = await resp.json();
  if (!resp.ok) {
    throw new Error(dados.erro || "Erro desconhecido ao criar pedido.");
  }
  pedidoAtualId = dados.pedido.id;
  document.getElementById("total").textContent = formatarCentavos(dados.pedido.total);
  resultadoDiv.innerHTML = `
    <p>Pedido fictício criado. Guarde sua senha: <b>${dados.pedido.senha}</b></p>
    <button id="btnPagar">Simular pagamento aprovado (teste)</button>
  `;
  document.getElementById("btnPagar").addEventListener("click", pagarPedidoAtual);
}

async function pagarPedidoAtual() {
  const resultadoDiv = document.getElementById("resultadoPedido");
  if (!idempotencyKeyPagamentoAtual) {
    idempotencyKeyPagamentoAtual = gerarChave("pagamento");
  }
  const respPag = await fetch(`/api/pedidos/${pedidoAtualId}/pagamento-simulado`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ idempotencyKey: idempotencyKeyPagamentoAtual, resultado: "aprovado" }),
  });
  const dadosPag = await respPag.json();
  resultadoDiv.innerHTML = respPag.ok
    ? `<p>Pagamento simulado aprovado. Pedido enviado à cozinha fictícia (status: ${dadosPag.pedido.status}).</p>`
    : `<p class="erro">Erro: ${dadosPag.erro}</p>`;
  if (respPag.ok) {
    carrinho.length = 0;
    idempotencyKeyPedidoAtual = null;
    idempotencyKeyPagamentoAtual = null;
    pedidoAtualId = null;
    renderCarrinho();
  }
}

document.getElementById("btnCriar").addEventListener("click", async () => {
  const resultadoDiv = document.getElementById("resultadoPedido");
  resultadoDiv.textContent = "";

  if (tentativaEmAndamento) return; // evita clique duplo durante requisição em curso
  if (carrinho.length === 0 && !pedidoAtualId) {
    resultadoDiv.innerHTML = '<p class="erro">Carrinho vazio.</p>';
    return;
  }

  tentativaEmAndamento = true;
  definirBotaoCriarDesabilitado(true);
  try {
    await criarOuReenviarPedido();
  } catch (erro) {
    resultadoDiv.innerHTML = `<p class="erro">Erro: ${erro.message}. Você pode tentar novamente — o mesmo pedido será reaproveitado, sem duplicar.</p>`;
  } finally {
    tentativaEmAndamento = false;
    definirBotaoCriarDesabilitado(false);
  }
});

carregarCardapio();
