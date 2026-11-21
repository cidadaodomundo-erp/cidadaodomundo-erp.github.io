async function carregar() {
  const resp = await fetch("/api/pedidos");
  const { pedidos } = await resp.json();
  const prontos = pedidos.filter((p) => p.status === "PRONTO");
  const preparando = pedidos.filter((p) => p.status === "PREPARANDO");
  const container = document.getElementById("senhas");
  container.innerHTML = '<h2>Preparando</h2>' + (preparando.map(p => `<div class="senha">${p.senha}</div>`).join('') || '<p>Nenhum pedido em preparo.</p>')
    + '<h2>Pronto para retirar</h2>' + (prontos.map(p => `<div class="senha">${p.senha}</div>`).join('') || '<p>Nenhuma senha pronta (fictício).</p>');
}

carregar();
setInterval(carregar, 2000);
