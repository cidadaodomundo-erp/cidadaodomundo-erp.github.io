// Cozinha de teste (HML): marca pronto/retirado so na NOSSA TV. Nada vai ao Saipos.
// Uma consulta por vez (proxima agendada no finally); timeout de 4 s em toda chamada.
(() => {
  const $ = (id) => document.getElementById(id);
  const TEMPO = 4000;
  const INTERVALO = 1500;
  const chaves = new Map(); // "id:acao" -> actionKey (mantida ate resposta definitiva)
  const emVoo = new Set();
  let csrf = null;
  let dados = null; // ultimo estado recebido (so em memoria)

  function aviso(t) { $("mensagem").textContent = t || ""; }

  function desenhar(id, lista, acao, rotulo) {
    const alvo = $(id);
    alvo.textContent = "";
    for (const it of lista) {
      const linha = document.createElement("div");
      linha.className = "item-cozinha";
      const n = document.createElement("span");
      n.className = "numero";
      n.textContent = String(it.senha);
      if (it.auto && acao === "pronto") { // pedido automatico: o PRONTO vem do Saipos, sem botao local
        const t = document.createElement("span");
        t.textContent = "Aguardando aviso do Saipos";
        linha.append(n, t);
        alvo.appendChild(linha);
        continue;
      }
      const b = document.createElement("button");
      b.textContent = rotulo;
      b.disabled = emVoo.has(it.id + ":" + acao);
      b.addEventListener("click", () => agir(it.id, acao));
      linha.append(n, b);
      alvo.appendChild(linha);
    }
  }

  function renderizar() {
    if (!dados) {
      $("preparando").textContent = "";
      $("pronto").textContent = "";
      return;
    }
    desenhar("preparando", dados.preparando, "pronto", "Marcar pronto");
    desenhar("pronto", dados.pronto, "retirado", "Marcar retirado");
  }

  async function consultar() {
    const controle = new AbortController();
    const timer = setTimeout(() => controle.abort(), TEMPO);
    try {
      if (!csrf) { // recupera a protecao se iniciou sem rede
        const c = await fetch("/api/hml/config", { cache: "no-store", signal: controle.signal });
        if (!c.ok) throw new Error("http");
        const j = await c.json();
        if (typeof j.csrf !== "string") throw new Error("csrf");
        csrf = j.csrf;
      }
      const resp = await fetch("/api/hml/preparo", { cache: "no-store", signal: controle.signal });
      if (!resp.ok) throw new Error("http");
      dados = await resp.json();
      renderizar();
      $("conexao").hidden = true;
    } catch {
      dados = null;
      renderizar();
      $("conexao").hidden = false;
    } finally {
      clearTimeout(timer);
      setTimeout(consultar, INTERVALO);
    }
  }

  async function agir(id, acao) {
    const k = id + ":" + acao;
    if (emVoo.has(k)) return;
    if (!csrf) { aviso("Sem conexão com a cozinha de teste. Tente de novo em instantes."); return; }
    if (!chaves.has(k)) chaves.set(k, crypto.randomUUID());
    emVoo.add(k);
    aviso("");
    renderizar(); // botao desabilitado em voo, sem consulta antes
    const controle = new AbortController();
    const timer = setTimeout(() => controle.abort(), TEMPO);
    try {
      const resp = await fetch("/api/hml/preparo/" + id + "/" + acao, {
        method: "POST",
        cache: "no-store",
        signal: controle.signal,
        headers: { "Content-Type": "application/json", "X-CSRF-Token": csrf },
        body: JSON.stringify({ actionKey: chaves.get(k) }),
      });
      if (resp.ok) {
        chaves.delete(k);
      } else if (resp.status >= 500) {
        aviso("Sem confirmação. Toque de novo para repetir o mesmo comando.");
      } else {
        chaves.delete(k); // resposta definitiva
        if (resp.status === 403) csrf = null; // sera recuperada na proxima consulta
        aviso("Não foi possível concluir. Confira o resultado na lista.");
      }
    } catch {
      aviso("Sem confirmação. Toque de novo para repetir o mesmo comando.");
    } finally {
      clearTimeout(timer);
      emVoo.delete(k);
      renderizar();
    }
  }

  consultar();
})();
