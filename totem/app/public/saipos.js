// Tela da loja de teste. Sem innerHTML; so textContent.
(() => {
  const CHAVE = "hml.idempotencyKey";
  const $ = (id) => document.getElementById(id);
  const TRAVADOS = ["enviando", "aceito", "ambiguo", "bloqueado"];
  let config = null;
  let enviando = false;

  function texto(el, valor) { el.textContent = valor; }

  function mostrar(r) {
    const alvo = $("resultado");
    alvo.textContent = "";
    if (!r || !r.mensagem) return;
    const p = document.createElement("p");
    p.textContent = r.mensagem;
    if (r.estado !== "aceito" && r.estado !== "enviando") p.className = "erro";
    alvo.appendChild(p);
    if (r.senha && r.estado !== "nao_enviado") {
      const s = document.createElement("div");
      s.className = "senha";
      s.textContent = "Senha " + r.senha;
      alvo.appendChild(s);
    }
    $("btnEnviar").disabled = TRAVADOS.includes(r.estado) || enviando;
    $("btnNovo").hidden = !r.podeTentarNovamente;
  }

  async function status(chave) {
    const resp = await fetch("/api/hml/status?chave=" + encodeURIComponent(chave), { cache: "no-store" });
    return resp.json();
  }

  async function atualizar() {
    const chave = localStorage.getItem(CHAVE);
    if (!chave) return;
    try {
      const r = await status(chave);
      if (r.estado === "inexistente") { $("btnEnviar").disabled = false; return; }
      mostrar(r);
      if (r.estado === "enviando") setTimeout(atualizar, 1500);
    } catch {
      mostrar({ estado: "ambiguo", mensagem: "Não foi possível confirmar o envio. Confira o pedido na loja de teste" });
    }
  }

  async function enviar() {
    if (enviando || !config) return;
    enviando = true;
    $("btnEnviar").disabled = true;
    let chave = localStorage.getItem(CHAVE);
    if (!chave) {
      chave = crypto.randomUUID();
      localStorage.setItem(CHAVE, chave); // guardada ANTES do envio
    }
    mostrar({ estado: "enviando", mensagem: "Enviando o pedido para a loja de teste…" });
    try {
      const resp = await fetch("/api/hml/pedido", {
        method: "POST",
        cache: "no-store",
        headers: { "Content-Type": "application/json", "X-CSRF-Token": config.csrf },
        body: JSON.stringify({ idempotencyKey: chave, code: config.produto.codigo, quantity: 1 }),
      });
      const r = await resp.json();
      enviando = false;
      if (r.estado) mostrar(r);
      else { texto($("resultado"), r.mensagem || "Não foi possível enviar."); $("btnEnviar").disabled = false; }
    } catch {
      enviando = false;
      await atualizar(); // mesma chave: pergunta ao servidor o que aconteceu
    }
  }

  async function iniciar() {
    try {
      config = await (await fetch("/api/hml/config", { cache: "no-store" })).json();
    } catch {
      texto($("carrinho"), "Não foi possível carregar o cardápio da loja de teste.");
      return;
    }
    texto($("loja"), config.loja);
    const prod = document.createElement("div");
    prod.className = "produto";
    const nome = document.createElement("b");
    nome.textContent = config.produto.nome;
    const preco = document.createElement("span");
    preco.className = "preco";
    preco.textContent = " — " + config.produto.preco;
    prod.append(nome, preco);
    $("produtos").appendChild(prod);
    texto($("carrinho"), "1 × " + config.produto.nome + " — " + config.produto.preco);
    texto($("total"), config.produto.preco);
    $("btnEnviar").disabled = false;
    $("btnEnviar").addEventListener("click", enviar);
    $("btnNovo").addEventListener("click", () => {
      localStorage.removeItem(CHAVE); // so por acao explicita, nunca automatico
      $("resultado").textContent = "";
      $("btnNovo").hidden = true;
      $("btnEnviar").disabled = false;
    });
    await atualizar();
  }

  iniciar();
})();
