"use strict";
// SOMENTE no modo servidor do salao (tablets/servidor). Nunca entra no HTML standalone (build.mjs nao inclui).
// Fala apenas com o proprio servidor (mesma origem). Reenvio usa a MESMA chave => o servidor nao duplica.
(() => {
  const cfg = JSON.parse(document.getElementById("cfgEnvio").textContent); // { modo: "local" | "saipos", csrf }
  const PENDENTE = "cdm-tablet-envio-pendente-v1";
  const uuid = () => (crypto.randomUUID ? crypto.randomUUID()
    : "10000000-1000-4000-8000-100000000000".replace(/[018]/g, (c) => (c ^ (crypto.getRandomValues(new Uint8Array(1))[0] & (15 >> (c / 4)))).toString(16)));

  async function post(caminho, corpo) {
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), 20000);
    try {
      const r = await fetch(caminho, { method: "POST", headers: { "Content-Type": "application/json", "X-CDM-CSRF": cfg.csrf }, body: JSON.stringify(corpo), signal: ctl.signal, cache: "no-store" });
      let json = null;
      try { json = await r.json(); } catch { /* corpo vazio */ }
      return { status: r.status, json };
    } finally { clearTimeout(t); }
  }

  // Mesma rodada (mesmo conteudo) => mesma chave, ate o servidor confirmar.
  function chavePara(conteudo) {
    const txt = JSON.stringify(conteudo);
    try {
      const p = JSON.parse(localStorage.getItem(PENDENTE) || "null");
      if (p && p.txt === txt && typeof p.chave === "string") { memoria = p; return p.chave; }
    } catch { /* sem storage */ }
    const chave = uuid();
    try { localStorage.setItem(PENDENTE, JSON.stringify({ txt, chave })); } catch { /* sem storage: chave so em memoria */ }
    memoria = { txt, chave };
    return chave;
  }
  let memoria = null;
  const chave = (conteudo) => {
    const txt = JSON.stringify(conteudo);
    if (memoria && memoria.txt === txt) return memoria.chave;
    return chavePara(conteudo);
  };
  const limpar = () => { memoria = null; try { localStorage.removeItem(PENDENTE); } catch { /* ok */ } };
  // Envio sem resposta (queda/5xx): o servidor PODE ter recebido. Ate confirmar, o carrinho fica travado
  // para o reenvio sair igual (mesma chave) e nunca virar uma segunda rodada.
  const marcarSemResposta = () => {
    if (memoria) memoria.semResposta = true;
    try { const p = JSON.parse(localStorage.getItem(PENDENTE) || "null"); if (p) { p.semResposta = true; localStorage.setItem(PENDENTE, JSON.stringify(p)); } } catch { /* ok */ }
  };
  // Rodada esperando pagamento: carrinho tambem fica travado (o que esta sendo pago nao muda).
  const marcarPagando = () => {
    if (memoria) memoria.pagando = true;
    try { const p = JSON.parse(localStorage.getItem(PENDENTE) || "null"); if (p) { p.pagando = true; delete p.semResposta; localStorage.setItem(PENDENTE, JSON.stringify(p)); } } catch { /* ok */ }
  };
  const temPendente = () => {
    if (memoria && (memoria.semResposta || memoria.pagando)) return true;
    try { const p = JSON.parse(localStorage.getItem(PENDENTE) || "null"); return !!(p && (p.semResposta || p.pagando)); } catch { return false; }
  };
  async function getJson(caminho) {
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), 5000);
    try { const r = await fetch(caminho, { cache: "no-store", signal: ctl.signal }); return { status: r.status, json: await r.json().catch(() => null) }; }
    finally { clearTimeout(t); }
  }

  const chaveOcup = (o) => (o.modalidade === "mesa" ? `mesa:${o.mesa}` : `comanda:${o.comanda}`);
  window.CDMEnvio = {
    modo: cfg.modo,
    pagarAntes: cfg.pagarAntes === true,
    pixReal: cfg.pixReal === true,
    async pagamento(token) {
      try { const r = await getJson(`/api/pagamento?t=${encodeURIComponent(token)}`); return r.status === 200 ? r.json : null; } catch { return null; }
    },
    async simularPagamento(token, forma, resultado) {
      try {
        const r = await post("/api/pagamento/simular", { token, forma, resultado });
        return r.status === 200 && r.json ? r.json : { ok: false, mensagem: (r.json && r.json.mensagem) || "Não foi possível pagar." };
      } catch { return { ok: false, mensagem: "Sem conexão. Tente de novo (não cobra duas vezes)." }; }
    },
    async cancelarPagamento(token) {
      try {
        const r = await post("/api/pagamento/cancelar", { token });
        if (r.status === 200) { limpar(); return { ok: true, mensagem: r.json.mensagem }; }
        return { ok: false, mensagem: (r.json && r.json.mensagem) || "Não foi possível cancelar." };
      } catch { return { ok: false, mensagem: "Sem conexão. O pagamento não foi cancelado." }; }
    },
    temPendente,
    limparPendente: limpar,
    mesaFixa: Number.isInteger(cfg.mesaFixa) ? cfg.mesaFixa : null,
    async conferirPin(pin) {
      try {
        const r = await post("/api/equipe/pin", { pin: String(pin || "") });
        return r.status === 200 && r.json && r.json.ok ? { ok: true } : { ok: false, mensagem: (r.json && r.json.mensagem) || "Senha incorreta." };
      } catch { return { ok: false, mensagem: "Sem conexão com o servidor." }; }
    },
    async fecharMesa(ocupacao, pin) {
      try {
        const r = await post("/api/cozinha/mesa/fechar", { ocupacao: chaveOcup(ocupacao), pin: String(pin) });
        return r.status === 200 && r.json && r.json.ok ? { ok: true } : { ok: false, mensagem: (r.json && r.json.mensagem) || "Não foi possível fechar a conta." };
      } catch { return { ok: false, mensagem: "Sem conexão com o servidor. A conta não foi fechada." }; }
    },
    // Pergunta pelas rodadas DESTE tablet (ids do servidor); nao depende de relogio.
    async estadoMesa(ids) {
      if (!Array.isArray(ids) || !ids.length) return null;
      const ctl = new AbortController();
      const t = setTimeout(() => ctl.abort(), 4000);
      try {
        const r = await fetch(`/api/tablet/estado?ids=${encodeURIComponent(ids.slice(-60).join(","))}`, { cache: "no-store", signal: ctl.signal });
        return r.ok ? await r.json() : null;
      } catch { return null; } finally { clearTimeout(t); }
    },
    async enviarRodada({ ocupacao, numero, itens, nome }) {
      const conteudo = nome ? { ocupacao, numero, itens, nome } : { ocupacao, numero, itens };
      const idempotencyKey = chave(conteudo);
      let r;
      try { r = await post("/api/rodada", { idempotencyKey, ...conteudo }); }
      catch { marcarSemResposta(); return { ok: false, mensagem: "Sem conexão com a cozinha. O carrinho foi mantido: toque em Confirmar de novo (não duplica)." }; }
      if (r.status === 200 && r.json && r.json.ok && r.json.pagamento && r.json.pagamento.estado !== "aprovado") {
        marcarPagando();
        return { ok: true, aguardandoPagamento: true, id: r.json.id, token: r.json.pagamento.token, estadoPagamento: r.json.pagamento.estado, mensagem: r.json.mensagem, totalCentavos: r.json.totalCentavos };
      }
      if (r.status === 200 && r.json && r.json.ok) {
        limpar();
        return { ok: true, id: r.json.id, status: r.json.status, mensagem: r.json.mensagem, totalCentavos: r.json.totalCentavos };
      }
      if (r.status >= 400 && r.status < 500) limpar(); // recusado de vez: proxima tentativa e outro pedido
      else marcarSemResposta();
      return { ok: false, mensagem: (r.json && r.json.mensagem) || "A cozinha não confirmou o recebimento. O carrinho foi mantido; tente de novo." };
    },
    async aviso(tipo, ocupacao) {
      try {
        const r = await post("/api/aviso", { tipo, ocupacao, idempotencyKey: uuid() });
        if (r.status === 200 && r.json && r.json.ok) return { ok: true, mensagem: r.json.mensagem };
        return { ok: false, mensagem: (r.json && r.json.mensagem) || "Não foi possível avisar a equipe. Chame pessoalmente." };
      } catch { return { ok: false, mensagem: "Sem conexão. Chame a equipe pessoalmente." }; }
    },
  };
})();
