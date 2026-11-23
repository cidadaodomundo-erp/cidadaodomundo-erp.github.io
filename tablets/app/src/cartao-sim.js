"use strict";
// SIMULACAO do pagamento com cartao/carteira (TESTE). Mostra os mesmos passos que o cliente fara no checkout real
// (e.Rede): digitar o cartao ou confirmar na carteira do celular. NADA do que e digitado sai deste aparelho:
// os campos so sao conferidos aqui e apagados; o servidor so recebe "aprovado" (simulado).
(() => {
  const el = (tag, cls, txt) => { const e = document.createElement(tag); if (cls) e.className = cls; if (txt !== undefined) e.textContent = txt; return e; };
  const reais = (c) => (c / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
  const luhn = (n) => { let s = 0; for (let i = 0; i < n.length; i++) { let d = +n[n.length - 1 - i]; if (i % 2) { d *= 2; if (d > 9) d -= 9; } s += d; } return s % 10 === 0; };
  const NOMES = { credito: "Cartão de crédito", debito: "Cartão de débito", applepay: "Apple Pay", googlepay: "Google Pay" };

  // Mostra o passo dentro de "alvo" e devolve Promise: true (cliente concluiu) ou false (voltou).
  function abrir(alvo, { forma, totalCentavos }) {
    const box = el("div", "csim");
    box.appendChild(el("p", "csim-tag", "SIMULAÇÃO — no dia a dia esta tela será a do pagamento da Rede. Nada é cobrado."));
    const anteriores = [...alvo.children];
    for (const c of anteriores) c.hidden = true;
    alvo.appendChild(box);
    return new Promise((fim) => {
      const sair = (v) => { box.remove(); for (const c of anteriores) c.hidden = false; fim(v); };
      const voltar = el("button", "btn sec csim-voltar", "Voltar"); voltar.type = "button"; voltar.onclick = () => sair(false);
      if (forma === "applepay" || forma === "googlepay") {
        box.append(el("h3", "csim-tit", NOMES[forma]), el("p", "csim-total", reais(totalCentavos)),
          el("p", "", forma === "applepay" ? "Confirme com o Face ID ou a digital, como em qualquer compra no iPhone." : "Confirme com a digital ou o bloqueio de tela, como em qualquer compra no Android."));
        const ok = el("button", "btn prim csim-pagar", forma === "applepay" ? "Confirmar com Face ID" : "Confirmar com a digital"); ok.type = "button";
        ok.onclick = () => sair(true);
        box.append(ok, voltar);
        return;
      }
      box.append(el("h3", "csim-tit", NOMES[forma] || "Cartão"), el("p", "csim-total", reais(totalCentavos)));
      const campo = (rotulo, attrs, id) => {
        const l = el("label", "csim-campo"); l.append(el("span", "", rotulo));
        const i = el("input"); Object.assign(i, attrs); i.id = id; i.autocomplete = "off"; l.appendChild(i); box.appendChild(l); return i;
      };
      const num = campo("Número do cartão", { inputMode: "numeric", maxLength: 23, placeholder: "0000 0000 0000 0000" }, "csimNum");
      const linha = el("div", "csim-linha"); box.appendChild(linha);
      const val = campo("Validade", { inputMode: "numeric", maxLength: 5, placeholder: "MM/AA" }, "csimVal"); linha.appendChild(val.parentNode);
      const cvv = campo("Código (CVV)", { inputMode: "numeric", maxLength: 4, placeholder: "123" }, "csimCvv"); linha.appendChild(cvv.parentNode);
      const nome = campo("Nome impresso no cartão", { placeholder: "Como está no cartão" }, "csimNome");
      const erro = el("p", "aviso"); erro.setAttribute("role", "alert");
      const pagar = el("button", "btn prim csim-pagar", `Pagar ${reais(totalCentavos)}`); pagar.type = "button";
      box.append(erro, pagar, voltar);
      num.oninput = () => { const d = num.value.replace(/\D/g, "").slice(0, 19); num.value = d.replace(/(\d{4})(?=\d)/g, "$1 "); if (d.length >= 16 && luhn(d)) val.focus(); };
      val.oninput = () => { let d = val.value.replace(/\D/g, "").slice(0, 4); if (d.length > 2) d = d.slice(0, 2) + "/" + d.slice(2); val.value = d; if (d.length === 5) cvv.focus(); };
      cvv.oninput = () => { cvv.value = cvv.value.replace(/\D/g, "").slice(0, 4); };
      pagar.onclick = () => {
        const d = num.value.replace(/\D/g, "");
        const [mm, aa] = val.value.split("/").map(Number);
        const agora = new Date(), fimMes = new Date(2000 + (aa || 0), mm || 0, 1);
        if (d.length < 13 || !luhn(d)) { erro.textContent = "Confira o número do cartão."; num.focus(); return; }
        if (!(mm >= 1 && mm <= 12) || fimMes <= agora) { erro.textContent = "Confira a validade (MM/AA)."; val.focus(); return; }
        if (!/^\d{3,4}$/.test(cvv.value)) { erro.textContent = "Confira o código de 3 ou 4 números atrás do cartão."; cvv.focus(); return; }
        if (nome.value.trim().length < 2) { erro.textContent = "Digite o nome como está no cartão."; nome.focus(); return; }
        num.value = val.value = cvv.value = nome.value = ""; // nada fica guardado
        sair(true);
      };
      num.focus();
    });
  }
  window.CDMCartaoSim = { abrir };
})();
