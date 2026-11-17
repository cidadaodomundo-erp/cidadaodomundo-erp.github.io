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
      if (p && p.txt === txt && typeof p.chave === "string") return p.chave;
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

  const chaveOcup = (o) => (o.modalidade === "mesa" ? `mesa:${o.mesa}` : `comanda:${o.comanda}`);
  window.CDMEnvio = {
    modo: cfg.modo,
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
    async estadoMesa(ocupacao) {
      const ctl = new AbortController();
      const t = setTimeout(() => ctl.abort(), 4000);
      try {
        const r = await fetch(`/api/tablet/estado?ocupacao=${encodeURIComponent(chaveOcup(ocupacao))}`, { cache: "no-store", signal: ctl.signal });
        return r.ok ? await r.json() : null;
      } catch { return null; } finally { clearTimeout(t); }
    },
    async enviarRodada({ ocupacao, numero, itens }) {
      const conteudo = { ocupacao, numero, itens };
      const idempotencyKey = chave(conteudo);
      let r;
      try { r = await post("/api/rodada", { idempotencyKey, ...conteudo }); }
      catch { return { ok: false, mensagem: "Sem conexão com a cozinha. O carrinho foi mantido: toque em Confirmar de novo (não duplica)." }; }
      if (r.status === 200 && r.json && r.json.ok) {
        limpar();
        return { ok: true, id: r.json.id, status: r.json.status, mensagem: r.json.mensagem, totalCentavos: r.json.totalCentavos };
      }
      if (r.status >= 400 && r.status < 500) limpar(); // recusado de vez: proxima tentativa e outro pedido
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
