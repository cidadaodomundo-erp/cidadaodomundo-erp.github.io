function descreverItem(item) {
  const adicionais = item.adicionaisDetalhe?.length
    ? ` + ${item.adicionaisDetalhe.map((a) => a.nome).join(", ")}`
    : "";
  const remocoes = item.removerIngredientesDetalhe?.length
    ? ` (sem ${item.removerIngredientesDetalhe.map((i) => i.nome).join(", ")})`
    : "";
  return `${item.quantidade}x ${item.nomeProduto}${adicionais}${remocoes}`;
}

async function acionar(id, acao) {
  await fetch(`/api/pedidos/${id}/${acao}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: "{}",
  });
  carregar();
}

async function carregar() {
  const resp = await fetch("/api/pedidos");
  const { pedidos } = await resp.json();
  const lista = document.getElementById("lista");
  const relevantes = pedidos.filter((p) => ["PREPARANDO", "PRONTO"].includes(p.status));

  lista.innerHTML =
    relevantes
      .map((p) => {
        const itensHtml = p.itens.map((i) => `<li>${descreverItem(i)}</li>`).join("");
        let controles = "";
        if (p.status === "PREPARANDO") {
          controles = `
            <button data-acao="pronto" data-id="${p.id}">Marcar pronto</button>
            <button data-acao="cancelar" data-id="${p.id}">Cancelar</button>
          `;
        } else if (p.status === "PRONTO") {
          controles = `
            <span>Senha: <b>${p.senha}</b></span>
            <button data-acao="retirado" data-id="${p.id}">Marcar retirado</button>
          `;
        }
        return `
          <div class="pedido-card">
            <b>Senha ${p.senha}</b> — pedido ${p.id.slice(0, 8)} — status: ${p.status}
            <ul>${itensHtml}</ul>
            ${controles}
          </div>
        `;
      })
      .join("") || "<p>Nenhum pedido em preparo (fictício).</p>";

  lista.querySelectorAll("[data-acao]").forEach((btn) => {
    btn.addEventListener("click", () => acionar(btn.dataset.id, btn.dataset.acao));
  });
}

carregar();
setInterval(carregar, 2000);
