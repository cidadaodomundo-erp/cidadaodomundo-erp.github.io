"use strict";
// Tela da cozinha de teste: lista rodadas das mesas e avisos (atendente/conta). Somente textContent.
(() => {
  const cfg = JSON.parse(document.getElementById("cfg").textContent);
  const $ = (id) => document.getElementById(id);
  const reais = (c) => (c / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
  const hora = (iso) => new Date(iso).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
  const minutos = (iso) => Math.max(0, Math.round((Date.now() - Date.parse(iso)) / 60000));
  function el(tag, cls, txt) { const e = document.createElement(tag); if (cls) e.className = cls; if (txt !== undefined) e.textContent = txt; return e; }
  const SAIPOS = { aceito: ["Saipos teste: ficha ", "ok"], ambiguo: ["Saipos: conferir na loja TESTE", "atencao"], recusado: ["Saipos recusou", "atencao"], nao_enviado: ["Saipos: não enviado", "atencao"], reservado: ["Saipos: enviando", ""], enviando: ["Saipos: enviando", ""] };
  const ETAPA = { NOVO: "Nova", PREPARANDO: "Preparando", PRONTO: "Pronta" };
  let ocupado = false;

  async function post(caminho, corpo = {}) {
    const r = await fetch(caminho, { method: "POST", headers: { "Content-Type": "application/json", "X-CDM-CSRF": cfg.csrf }, body: JSON.stringify(corpo) });
    if (!r.ok) { let j = null; try { j = await r.json(); } catch { /* */ } throw new Error((j && j.mensagem) || "Falhou"); }
  }
  async function acao(caminho, corpo) {
    if (ocupado) return;
    ocupado = true;
    $("pinErro").textContent = "";
    try { await post(caminho, corpo); } catch (e) { (corpo && corpo.pin !== undefined ? $("pinErro") : $("estado")).textContent = e.message; } finally { ocupado = false; atualizar(); }
  }
  function fecharConta(m) {
    const pin = $("pin").value.trim();
    if (!pin) { $("pinErro").textContent = "Digite a senha da equipe para fechar a conta."; $("pin").focus(); return; }
    acao("/api/cozinha/mesa/fechar", { ocupacao: m.chave, pin });
  }

  function card(r) {
    const c = el("article", "card " + r.preparo);
    const h = el("h2", "cubano", r.rotulo);
    c.appendChild(h);
    const meta = el("div", "meta", `Rodada ${r.numero} · ${hora(r.criadoEm)} (${minutos(r.criadoEm)} min) · ${ETAPA[r.preparo] || r.preparo}`);
    if (r.saipos) {
      const [t, cls] = SAIPOS[r.saipos.estado] || ["Saipos: ?", "atencao"];
      meta.appendChild(el("span", "selo " + cls, r.saipos.estado === "aceito" ? t + r.saipos.ficha : t));
    }
    c.appendChild(meta);
    for (const i of r.itens) {
      c.appendChild(el("div", "item", `${i.quantidade} × ${i.nome}${i.variacao ? " — " + i.variacao : ""}`));
      for (const o of i.opcoes) c.appendChild(el("div", "sub", `+ ${o.quantidade} × ${o.nome}`));
      for (const x of i.retiradas) c.appendChild(el("div", "sub", `SEM ${x}`));
      if (i.obs) c.appendChild(el("div", "obs", `Obs.: ${i.obs}`));
    }
    c.appendChild(el("div", "meta", `Total da rodada (teste): ${reais(r.totalCentavos)}`));
    const b = el("div", "botoes");
    const botao = (txt, alvo, sec) => { const x = el("button", sec ? "sec" : "", txt); x.type = "button"; x.addEventListener("click", () => acao(`/api/cozinha/rodada/${r.id}/${alvo}`)); b.appendChild(x); };
    if (r.preparo === "NOVO") botao("Começar preparo", "preparando");
    if (r.preparo !== "PRONTO") botao("Marcar pronta", "pronto", r.preparo === "NOVO");
    botao("Entregue na mesa", "entregue", r.preparo !== "PRONTO");
    c.appendChild(b);
    return c;
  }

  function pintar(d) {
    const av = $("avisos");
    av.textContent = "";
    for (const a of d.avisos) {
      const x = el("div", "aviso", `${a.rotulo}: ${a.tipo === "conta" ? "PEDIU A CONTA" : "CHAMOU ATENDENTE"} · ${hora(a.em)}`);
      const v = el("button", "sec", "Visto"); v.type = "button";
      v.addEventListener("click", () => acao(`/api/cozinha/aviso/${a.id}/visto`));
      x.appendChild(v); av.appendChild(x);
    }
    const l = $("lista");
    l.textContent = "";
    if (!d.rodadas.length) l.appendChild(el("p", "vazio", "Nenhuma rodada esperando. Os pedidos dos tablets aparecem aqui sozinhos."));
    for (const r of d.rodadas) l.appendChild(card(r));
    const ms = $("mesas");
    ms.textContent = "";
    if (!d.mesas.length) ms.appendChild(el("p", "meta", "Nenhuma conta aberta."));
    for (const m of d.mesas) {
      const x = el("div", "mesa");
      const t = el("div");
      t.append(el("strong", "", m.rotulo), el("div", "meta", `${m.rodadas} rodada(s) · ${reais(m.totalCentavos)} · desde ${hora(m.desde)}${m.pendentes ? ` · ${m.pendentes} na cozinha` : ""}`));
      const b = el("button", "sec", "Fechar conta"); b.type = "button";
      b.addEventListener("click", () => fecharConta(m));
      x.append(t, b); ms.appendChild(x);
    }
    const e = $("entregues");
    e.textContent = d.entregues.length ? d.entregues.map((r) => `${r.rotulo} R${r.numero} (${hora(r.criadoEm)})`).join(" · ") : "Nenhuma ainda.";
    $("estado").textContent = `${cfg.modo === "saipos" ? "Ligado à loja TESTE do Saipos" : "Cozinha de teste (sem Saipos)"} · atualizado ${hora(d.agora)}`;
  }

  async function atualizar() {
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), 4000);
    try {
      const r = await fetch("/api/cozinha", { cache: "no-store", signal: ctl.signal });
      pintar(await r.json());
    } catch { $("estado").textContent = "Sem conexão com o servidor do salão"; }
    finally { clearTimeout(t); }
  }
  atualizar();
  setInterval(() => { if (!ocupado) atualizar(); }, 2000);
})();
