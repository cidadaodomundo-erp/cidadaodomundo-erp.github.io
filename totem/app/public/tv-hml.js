// TV de teste (HML): so senhas. Uma consulta por vez (sem sobreposicao); a proxima
// so e agendada (1,5 s) depois que a anterior termina. Falha ou timeout (4 s)
// SEMPRE limpa as senhas e avisa; nunca congela a ultima tela como atual.
(() => {
  const $ = (id) => document.getElementById(id);

  function limpar() {
    for (const id of ["preparando", "pronto", "retirados"]) $(id).textContent = "";
    if ($("webhook")) $("webhook").hidden = true; // sem conexao: nao afirma saude do webhook
  }

  function desenhar(id, lista) {
    const alvo = $(id);
    alvo.textContent = "";
    for (const it of lista) {
      const s = document.createElement("span");
      s.className = "numero";
      s.textContent = String(it.senha);
      alvo.appendChild(s);
    }
  }

  async function consultar() {
    const controle = new AbortController();
    const timer = setTimeout(() => controle.abort(), 4000);
    try {
      const resp = await fetch("/api/hml/preparo", { cache: "no-store", signal: controle.signal });
      if (!resp.ok) throw new Error("http");
      const d = await resp.json();
      desenhar("preparando", d.preparando);
      desenhar("pronto", d.pronto);
      desenhar("retirados", d.retirados);
      $("conexao").hidden = true;
      // Saude do webhook vem na MESMA resposta (campo opcional; ausente no modo legado). Sem segunda consulta.
      const w = d.webhook;
      const el = $("webhook");
      if (el) {
        if (w && typeof w === "object" && w.estado !== "nao_ligado") {
          el.hidden = false;
          el.textContent = typeof w.ultimoAvisoEm === "string" && !Number.isNaN(Date.parse(w.ultimoAvisoEm))
            ? "Último aviso do Saipos: " + new Date(w.ultimoAvisoEm).toLocaleString("pt-BR")
            : "Aguardando avisos do Saipos";
        } else {
          el.hidden = true;
        }
      }
    } catch {
      limpar();
      $("conexao").hidden = false;
    } finally {
      clearTimeout(timer);
      setTimeout(consultar, 1500);
    }
  }

  consultar();
})();
