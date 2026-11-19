"use strict";
// Pagina de pagamento aberta pelo QR Code (celular do cliente) — TESTE: simula o pagamento. Somente textContent.
(() => {
  const cfg = JSON.parse(document.getElementById("cfg").textContent);
  const $ = (id) => document.getElementById(id);
  const token = new URLSearchParams(location.search).get("t") || "";
  const reais = (c) => (c / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
  // Carteira do celular primeiro (um toque + rosto/digital). Cartao digitado so como ultimo recurso, escondido.
  const ehApple = /iPhone|iPad|Macintosh/.test(navigator.userAgent);
  const FORMAS = [ehApple ? ["applepay", "Apple Pay"] : ["googlepay", "Google Pay"], ["pix", "Pix"], ehApple ? ["googlepay", "Google Pay"] : ["applepay", "Apple Pay"]];
  let ocupado = false;
  let total = 0;

  function mostrar(d) {
    $("titulo").textContent = `${d.rotulo}${d.nome ? " · " + d.nome : ""} · rodada ${d.numero}`;
    $("total").textContent = reais(d.totalCentavos);
    total = d.totalCentavos;
    const ul = $("itens"); ul.textContent = "";
    for (const i of d.itens) { const li = document.createElement("li"); li.textContent = `${i.quantidade} × ${i.nome}`; ul.appendChild(li); }
    const res = $("resultado");
    const formas = $("formas");
    if (d.estado === "aprovado") {
      formas.hidden = true; res.hidden = false; res.className = "ok";
      res.textContent = "Pagamento aprovado! O pedido já foi para a cozinha. Pode guardar o celular.";
      return;
    }
    if (d.estado === "cancelado") {
      formas.hidden = true; res.hidden = false; res.className = "erro";
      res.textContent = "Este pagamento foi cancelado na mesa. Nada foi cobrado.";
      return;
    }
    if (d.estado === "recusado") { res.hidden = false; res.className = "erro"; res.textContent = "Pagamento recusado. Escolha outra forma ou tente de novo."; }
    if (!formas.childElementCount) {
      for (const [forma, nome] of FORMAS) {
        const b = document.createElement("button"); b.type = "button"; b.textContent = `Pagar com ${nome}`;
        b.addEventListener("click", async () => {
          if (ocupado) return;
          if (forma !== "pix" && window.CDMCartaoSim) {
            $("resultado").hidden = true;
            const feito = await window.CDMCartaoSim.abrir($("formas"), { forma, totalCentavos: total });
            if (!feito) return;
          }
          pagar(forma, "aprovado");
        });
        formas.appendChild(b);
      }
      const dig = document.createElement("button"); dig.type = "button"; dig.className = "link-discreto"; dig.textContent = "Não tem Apple Pay nem Google Pay? Digitar o cartão";
      dig.addEventListener("click", async () => {
        if (ocupado) return;
        $("resultado").hidden = true;
        if (await window.CDMCartaoSim.abrir($("formas"), { forma: "credito", totalCentavos: total })) pagar("credito", "aprovado");
      });
      formas.appendChild(dig);
      const r = document.createElement("button"); r.type = "button"; r.className = "sec"; r.textContent = "Simular cartão recusado (teste)";
      r.addEventListener("click", () => pagar("credito", "recusado"));
      formas.appendChild(r);
    }
  }
  async function pagar(forma, resultado) {
    if (ocupado) return;
    ocupado = true;
    for (const b of $("formas").querySelectorAll(":scope > button")) b.disabled = true;
    try {
      const r = await fetch("/api/pagamento/simular", { method: "POST", headers: { "Content-Type": "application/json", "X-CDM-CSRF": cfg.csrf }, body: JSON.stringify({ token, forma, resultado }) });
      const j = await r.json().catch(() => null);
      if (!r.ok || !j) throw new Error((j && j.mensagem) || "Não foi possível pagar.");
      mostrar(j);
    } catch (e) {
      $("resultado").hidden = false; $("resultado").className = "erro"; $("resultado").textContent = e.message;
    } finally {
      ocupado = false;
      for (const b of $("formas").querySelectorAll("button")) b.disabled = false;
    }
  }
  async function carregar() {
    try {
      const r = await fetch(`/api/pagamento?t=${encodeURIComponent(token)}`, { cache: "no-store" });
      const j = await r.json();
      if (!r.ok) throw new Error(j.mensagem || "Pagamento não encontrado.");
      mostrar(j);
    } catch (e) { $("titulo").textContent = e.message; }
  }
  carregar();
})();
