// Cardapio da loja de teste (HML). So textContent (nunca HTML dinamico). O servidor calcula e
// valida precos, horarios, limites e vinculos; aqui o front so mostra e envia {produto, variacao,
// quantidade, opcoes}. Sem codigos de integracao.
(() => {
  const CHAVE_CARRINHO = "hml.carrinho.v1";
  const CHAVE_PEDIDO = "hml.pedido.v1";
  const TRAVADOS = ["enviando", "aceito", "ambiguo", "bloqueado"];
  const $ = (id) => document.getElementById(id);
  let cfg = null;
  let menu = null;
  let carrinho = [];
  let pedido = null; // { key, itens, estado?, resultado? }
  let emVoo = false;
  let busca = "";

  function el(tag, cls, txt) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (txt !== undefined) e.textContent = txt;
    return e;
  }
  const dinheiro = (c) => (c / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
  const ler = (k) => { try { return JSON.parse(localStorage.getItem(k)); } catch { return null; } };
  const gravar = (k, v) => localStorage.setItem(k, JSON.stringify(v));

  function horarioTexto(csv) {
    const h = csv.split(",").map(Number).sort((a, b) => a - b);
    if (h.length === 24) return "o dia todo";
    const faixas = [];
    let ini = h[0], ant = h[0];
    for (const x of h.slice(1).concat([null])) {
      if (x !== null && x === ant + 1) { ant = x; continue; }
      faixas.push(`${ini}h às ${(ant + 1) % 24}h`);
      ini = x; ant = x;
    }
    return faixas.join(" e ");
  }

  const travado = () => !!pedido && TRAVADOS.includes(pedido.estado);
  const produtoPorId = (id) => menu.produtos.find((p) => p.id === id);
  const opcaoPorId = (id) => menu.opcoes.find((o) => o.id === id);
  const grupoPorId = (id) => menu.grupos.find((g) => g.id === id);

  function totalLinha(l) {
    const p = produtoPorId(l.produto);
    const v = p.variacoes.find((x) => x.indice === l.variacao);
    const ad = l.opcoes.reduce((s, o) => s + opcaoPorId(o.opcao).centavos * o.quantidade, 0);
    return (v.centavos + ad) * l.quantidade;
  }

  // ---------- cardapio ----------
  const reduzir = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  let catAtiva = null;
  let assinaturaCat = "";
  let travaSpy = false; // true enquanto um clique em categoria ainda esta rolando ate o titulo
  let timerLibera = 0;
  let timerTeto = 0;

  function liberarSpy() { travaSpy = false; clearTimeout(timerLibera); clearTimeout(timerTeto); atualizarAtiva(); }
  // Reinicia a espera a cada evento de scroll: libera 160ms depois que a rolagem parou (ou no scrollend).
  function adiarLiberacao() { clearTimeout(timerLibera); timerLibera = setTimeout(liberarSpy, 160); }
  function travarSpy() {
    travaSpy = true;
    adiarLiberacao();
    clearTimeout(timerTeto);
    timerTeto = setTimeout(liberarSpy, 5000); // teto de seguranca: nunca fica travado
  }
  window.addEventListener("scrollend", () => { if (travaSpy) liberarSpy(); });

  // Rola SOMENTE o proprio nav (nunca o documento nem ancestrais) para deixar o botao visivel/centralizado.
  function mostrarBotaoNoNav(b) {
    const nav = $("categorias");
    const rb = b.getBoundingClientRect();
    const rn = nav.getBoundingClientRect();
    if (nav.scrollWidth > nav.clientWidth + 1) {
      nav.scrollLeft += (rb.left + rb.width / 2) - (rn.left + rn.width / 2);
    }
    if (nav.scrollHeight > nav.clientHeight + 1) {
      if (rb.top < rn.top + 8) nav.scrollTop += rb.top - rn.top - 8;
      else if (rb.bottom > rn.bottom - 8) nav.scrollTop += rb.bottom - rn.bottom + 8;
    }
  }

  function marcarAtiva(id) {
    catAtiva = id;
    for (const b of $("categorias").querySelectorAll("button")) {
      const on = b.dataset.cat === String(id);
      if (on) { b.setAttribute("aria-current", "true"); mostrarBotaoNoNav(b); } else b.removeAttribute("aria-current");
    }
  }

  function atualizarAtiva() {
    if (travaSpy || document.body.classList.contains("estado-abertura")) return;
    const hs = [...$("lista").querySelectorAll("h2[id^='cat-']")];
    if (!hs.length) return;
    const topoH = document.querySelector(".topo").offsetHeight;
    const barraHorizontal = window.getComputedStyle($("categorias")).flexDirection === "row";
    const limite = topoH + (barraHorizontal ? $("categorias").offsetHeight : 0) + 48;
    let alvo = hs[0];
    for (const h of hs) if (h.getBoundingClientRect().top <= limite) alvo = h;
    if (window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 4) alvo = hs[hs.length - 1];
    const id = alvo.id.slice(4);
    if (id !== String(catAtiva)) marcarAtiva(id);
  }

  function renderCategorias() {
    const nav = $("categorias");
    nav.textContent = "";
    for (const c of menu.categorias) {
      if (!menu.produtos.some((p) => p.categoria === c.id)) continue;
      const b = el("button", "", c.nome);
      b.type = "button";
      b.dataset.cat = String(c.id);
      b.addEventListener("click", () => {
        let alvo = document.getElementById("cat-" + c.id);
        if (!alvo && busca) { busca = ""; $("busca").value = ""; renderLista(); alvo = document.getElementById("cat-" + c.id); }
        if (!alvo) return;
        travarSpy();
        marcarAtiva(c.id);
        alvo.scrollIntoView({ behavior: reduzir() ? "auto" : "smooth", block: "start" });
      });
      nav.appendChild(b);
    }
    assinaturaCat = menu.categorias.map((c) => c.id).join(",");
    if (catAtiva === null || !nav.querySelector(`[data-cat="${catAtiva}"]`)) { const p = nav.querySelector("button"); catAtiva = p ? p.dataset.cat : null; }
    marcarAtiva(catAtiva);
  }

  let rafSpy = 0;
  window.addEventListener("scroll", () => { if (travaSpy) adiarLiberacao(); if (!rafSpy) rafSpy = requestAnimationFrame(() => { rafSpy = 0; atualizarAtiva(); }); }, { passive: true });

  function cartao(p) {
    const b = el("button", "card");
    b.type = "button";
    const foto = p.fotoLocal ? el("img", "foto") : el("div", "foto foto-vazia");
    if (p.fotoLocal) {
      foto.src = p.fotoLocal;
      foto.alt = "";
      foto.loading = "lazy";
      foto.addEventListener("error", () => { const f = el("div", "foto foto-vazia"); f.setAttribute("aria-hidden", "true"); foto.replaceWith(f); });
    } else foto.setAttribute("aria-hidden", "true");
    const info = el("div", "info");
    info.appendChild(el("div", "nome", p.nome));
    if (p.descricao) info.appendChild(el("div", "desc", p.descricao));
    const menor = Math.min(...p.variacoes.map((v) => v.centavos));
    info.appendChild(el("div", "preco", (p.variacoes.length > 1 ? "a partir de " : "") + dinheiro(menor)));
    if (!p.disponivelAgora) {
      info.appendChild(el("span", "selo", p.motivoIndisponivel === "fora_do_horario" ? "Fora do horário de venda" : "Indisponível agora"));
      b.disabled = true;
    } else if (!p.variacoes.some((v) => v.pronto)) {
      info.appendChild(el("span", "selo", "Ainda estamos preparando este item na loja de teste"));
    }
    b.append(foto, info);
    if (p.disponivelAgora) b.addEventListener("click", () => abrirDialogo(p));
    return b;
  }

  function renderLista() {
    const alvo = $("lista");
    alvo.textContent = "";
    const termo = busca.trim().toLowerCase();
    let algum = false;
    for (const c of menu.categorias) {
      const ps = menu.produtos.filter((p) => p.categoria === c.id && (!termo || p.nome.toLowerCase().includes(termo) || (p.descricao || "").toLowerCase().includes(termo)));
      if (!ps.length) continue;
      algum = true;
      const h = el("h2", "", c.nome);
      h.id = "cat-" + c.id;
      alvo.appendChild(h);
      const grade = el("div", "grade");
      for (const p of ps) grade.appendChild(cartao(p));
      alvo.appendChild(grade);
    }
    if (!algum) alvo.appendChild(el("p", "", "Nenhum item encontrado."));
  }

  // ---------- dialogo do produto ----------
  const dlg = $("dialogo");
  let atual = null; // { p, sel }

  function regraGrupo(g) {
    const q = g.permitirQuantidade ? "unidades" : "opções";
    if (g.minimo > 0 && g.minimo === g.maximo) return `Escolha ${g.minimo} ${g.minimo === 1 ? "opção" : q}`;
    if (g.minimo > 0) return `Escolha de ${g.minimo} até ${g.maximo} ${q}`;
    return `Opcional: até ${g.maximo} ${q}`;
  }

  function somaGrupo(gid) {
    return [...atual.sel.opcoes].reduce((s, [id, q]) => s + (opcaoPorId(id).grupo === gid ? q : 0), 0);
  }

  function erroSelecao() {
    const { p, sel } = atual;
    if (sel.variacao === null) return "Escolha uma variação.";
    for (const gid of p.grupos) {
      const g = grupoPorId(gid);
      const s = somaGrupo(gid);
      if (s < g.minimo) return `Escolha pelo menos ${g.minimo} em “${g.nome}”.`;
      if (s > g.maximo) return `Escolha no máximo ${g.maximo} em “${g.nome}”.`;
    }
    return null;
  }

  function totalSelecao() {
    const { p, sel } = atual;
    const v = p.variacoes.find((x) => x.indice === sel.variacao);
    if (!v) return null;
    const ad = [...sel.opcoes].reduce((s, [id, q]) => s + opcaoPorId(id).centavos * q, 0);
    return (v.centavos + ad) * sel.quantidade;
  }

  function atualizarRodape() {
    const e = erroSelecao();
    const bloqueioCarrinho = travado() ? "Finalize ou descarte o pedido atual antes de adicionar itens." : carrinho.length >= menu.limites.maxItens ? `O carrinho aceita até ${menu.limites.maxItens} itens.` : null;
    $("dlgAviso").textContent = e || bloqueioCarrinho || "";
    const t = totalSelecao();
    $("dlgAdicionar").disabled = !!(e || bloqueioCarrinho);
    $("dlgAdicionar").textContent = "Adicionar ao carrinho" + (t !== null ? ` — ${dinheiro(t)}` : "");
  }

  function stepper(valor, min, max, aoMudar, nome) {
    const box = el("div", "stepper");
    const menos = el("button", "", "−");
    const mais = el("button", "", "+");
    const out = el("output", "", String(valor));
    menos.type = mais.type = "button";
    menos.setAttribute("aria-label", nome ? `Diminuir ${nome}` : "Diminuir");
    mais.setAttribute("aria-label", nome ? `Aumentar ${nome}` : "Aumentar");
    let v = valor;
    const pinta = () => { out.textContent = String(v); menos.disabled = v <= min; };
    menos.addEventListener("click", () => { if (v > min) { v -= 1; pinta(); aoMudar(v, pinta); } });
    mais.addEventListener("click", () => { if (v < max) { v += 1; pinta(); aoMudar(v, pinta); } });
    pinta();
    box.append(menos, out, mais);
    return box;
  }

  function abrirDialogo(p) {
    atual = { p, sel: { variacao: p.variacoes.length === 1 ? p.variacoes[0].indice : null, quantidade: 1, obs: "", opcoes: new Map() } };
    $("dlgTitulo").textContent = p.nome;
    $("dlgDescricao").textContent = p.descricao || "";
    $("dlgDescricao").hidden = !p.descricao;
    const foto = $("dlgFoto");
    if (p.fotoLocal) { foto.src = p.fotoLocal; foto.hidden = false; $("dlgSemFoto").hidden = true; }
    else { foto.removeAttribute("src"); foto.hidden = true; $("dlgSemFoto").hidden = false; }
    const c = $("dlgConteudo");
    c.textContent = "";

    if (p.variacoes.length > 1) {
      const box = el("div", "variacoes");
      box.appendChild(el("h3", "", "Escolha uma variação (obrigatório)"));
      for (const v of p.variacoes) {
        const lab = el("label");
        const r = el("input");
        r.type = "radio"; r.name = "variacao";
        r.addEventListener("change", () => { atual.sel.variacao = v.indice; atualizarRodape(); });
        lab.append(r, el("span", "", `${v.nome} — ${dinheiro(v.centavos)}`));
        box.appendChild(lab);
      }
      c.appendChild(box);
    }

    if (!p.ocultarQuantidade) {
      const q = el("div", "grupo");
      q.appendChild(el("h3", "", "Quantidade"));
      q.appendChild(stepper(1, 1, menu.limites.maxQuantidade, (v) => { atual.sel.quantidade = v; atualizarRodape(); }, p.nome));
      c.appendChild(q);
    }

    for (const gid of p.grupos) {
      const g = grupoPorId(gid);
      const caixa = el("div", "grupo");
      caixa.appendChild(el("h3", "", g.nome));
      caixa.appendChild(el("p", "regra", regraGrupo(g)));
      const ops = menu.opcoes.filter((o) => o.grupo === gid).sort((a, b) => a.posicao - b.posicao || a.id - b.id);
      const prontas = (p.variacoes.find((v) => v.pronto) || { opcoesProntas: [] }).opcoesProntas;
      for (const o of ops) {
        const linha = el("div", "opcao");
        const rot = el("div", "rotulo");
        rot.appendChild(el("div", "", `${o.nome} (+ ${dinheiro(o.centavos)})`));
        if (o.descricao) rot.appendChild(el("div", "pequeno", o.descricao));
        if (!prontas.includes(o.id)) rot.appendChild(el("div", "pequeno", "Ainda estamos preparando este item na loja de teste"));
        linha.appendChild(rot);
        if (g.permitirQuantidade) {
          linha.appendChild(stepper(0, 0, menu.limites.maxQuantidade, (v) => {
            if (v > 0) atual.sel.opcoes.set(o.id, v); else atual.sel.opcoes.delete(o.id);
            atualizarRodape(); // o rodape avisa se passar do maximo do grupo
          }, o.nome));
        } else {
          const b = el("button", "sel", "Selecionar");
          b.type = "button";
          b.setAttribute("aria-pressed", "false");
          b.setAttribute("aria-label", `Selecionar ${o.nome} em ${g.nome}`);
          b.addEventListener("click", () => {
            const marcado = atual.sel.opcoes.has(o.id);
            if (marcado) atual.sel.opcoes.delete(o.id);
            else {
              if (g.maximo === 1) {
                for (const id of [...atual.sel.opcoes.keys()]) if (opcaoPorId(id).grupo === gid) atual.sel.opcoes.delete(id);
              }
              atual.sel.opcoes.set(o.id, 1);
            }
            for (const x of caixa.querySelectorAll("button.sel")) {
              x.setAttribute("aria-pressed", "false");
              x.textContent = "Selecionar";
            }
            for (const [id] of atual.sel.opcoes) {
              const alvo = caixa.querySelector(`[data-opcao="${id}"]`);
              if (alvo) { alvo.setAttribute("aria-pressed", "true"); alvo.textContent = "Selecionado"; }
            }
            atualizarRodape();
          });
          b.dataset.opcao = String(o.id);
          linha.appendChild(b);
        }
        caixa.appendChild(linha);
      }
      c.appendChild(caixa);
    }

    if (!p.ocultarObservacao) {
      const box = el("div", "grupo");
      box.appendChild(el("h3", "", "Observação (opcional)"));
      const t = el("textarea");
      t.maxLength = menu.limites.maxObservacao;
      t.rows = 2;
      t.placeholder = "Ex.: sem cebola. Não escreva dados pessoais.";
      t.addEventListener("input", () => { atual.sel.obs = t.value.replace(/[\u0000-\u001f\u007f]/g, " "); });
      box.appendChild(t);
      c.appendChild(box);
    }
    atualizarRodape();
    if (dlg.showModal) dlg.showModal(); else dlg.setAttribute("open", "");
    dlg.querySelector(".dlg-corpo").scrollTop = 0;
  }

  function fecharDialogo() { if (dlg.close) dlg.close(); else dlg.removeAttribute("open"); atual = null; }

  $("dlgFoto").addEventListener("error", () => { $("dlgFoto").hidden = true; $("dlgSemFoto").hidden = false; });
  $("dlgFechar").addEventListener("click", fecharDialogo);
  dlg.addEventListener("close", () => { atual = null; }); // Esc nativo tambem limpa o estado; o carrinho nunca e tocado
  dlg.addEventListener("click", (ev) => { if (ev.target === dlg) fecharDialogo(); }); // clique no fundo (desktop)
  $("dlgAdicionar").addEventListener("click", () => {
    if (!atual || erroSelecao() || travado()) return;
    const { p, sel } = atual;
    const linha = { produto: p.id, variacao: sel.variacao, quantidade: sel.quantidade, opcoes: [...sel.opcoes].map(([opcao, quantidade]) => ({ opcao, quantidade })) };
    if (sel.obs.trim()) linha.obs = sel.obs.trim().slice(0, menu.limites.maxObservacao);
    carrinho.push(linha);
    gravar(CHAVE_CARRINHO, carrinho);
    fecharDialogo();
    renderCarrinho();
  });

  // ---------- carrinho ----------
  function bloqueioLinha(l) {
    const p = produtoPorId(l.produto);
    if (!p.disponivelAgora) return p.motivoIndisponivel === "fora_do_horario" ? "Fora do horário de venda." : "Indisponível agora.";
    const v = p.variacoes.find((x) => x.indice === l.variacao);
    if (!v.pronto || l.opcoes.some((o) => !v.opcoesProntas.includes(o.opcao))) return "Ainda estamos preparando este item na loja de teste.";
    return null;
  }

  function renderCarrinho() {
    const caixa = $("itens");
    caixa.textContent = "";
    let total = 0;
    let bloqueado = null;
    if (!carrinho.length) caixa.appendChild(el("p", "detalhe", "Seu carrinho está vazio."));
    carrinho.forEach((l, i) => {
      const p = produtoPorId(l.produto);
      const v = p.variacoes.find((x) => x.indice === l.variacao);
      const t = totalLinha(l);
      total += t;
      const linha = el("div", "linha");
      linha.appendChild(el("div", "nome", `${l.quantidade} × ${p.nome}${p.variacoes.length > 1 ? " — " + v.nome : ""}`));
      for (const o of l.opcoes) linha.appendChild(el("div", "detalhe", `${o.quantidade} × ${opcaoPorId(o.opcao).nome}`));
      if (l.obs) linha.appendChild(el("div", "detalhe", `Obs.: ${l.obs}`));
      linha.appendChild(el("div", "detalhe", dinheiro(t)));
      const b = bloqueioLinha(l);
      if (b) { linha.appendChild(el("div", "aviso-linha", b)); bloqueado = bloqueado || b; }
      const acoes = el("div", "acoes");
      const menos = el("button", "", "−");
      const mais = el("button", "", "+");
      const rem = el("button", "secundario", "Remover");
      menos.type = mais.type = rem.type = "button";
      menos.disabled = travado() || p.ocultarQuantidade || l.quantidade <= 1;
      mais.disabled = travado() || p.ocultarQuantidade || l.quantidade >= menu.limites.maxQuantidade;
      rem.disabled = travado();
      menos.addEventListener("click", () => { l.quantidade -= 1; salvarCarrinho(); });
      mais.addEventListener("click", () => { l.quantidade += 1; salvarCarrinho(); });
      rem.addEventListener("click", () => { carrinho.splice(i, 1); salvarCarrinho(); });
      acoes.append(menos, mais, rem);
      linha.appendChild(acoes);
      caixa.appendChild(linha);
    });
    $("total").textContent = dinheiro(total);
    $("valorTeste").textContent = `Valor de teste: ${dinheiro(total)} (igual ao total). Nada é cobrado.`;
    const explic = $("explicacao");
    explic.hidden = !bloqueado;
    explic.textContent = bloqueado || "";
    $("btnEnviar").disabled = !carrinho.length || !!bloqueado || emVoo || travado();
    if (menu.mapa !== "ok" && carrinho.length) {
      explic.hidden = false;
      explic.textContent = "Ainda estamos preparando este item na loja de teste.";
      $("btnEnviar").disabled = true;
    }
    // barra fixa do pedido
    const qtd = carrinho.reduce((s, l) => s + l.quantidade, 0);
    $("barraQtd").textContent = `${qtd} ${qtd === 1 ? "item" : "itens"}`;
    $("barraTotal").textContent = dinheiro(total);
    $("barraCarrinho").hidden = !(carrinho.length || (pedido && pedido.estado));
    if (!carrinho.length && !(pedido && pedido.estado) && carrinhoAberto) fecharCarrinho();
    // Inicio so fica indisponivel durante envio em andamento
    $("btnInicio").disabled = emVoo || (!!pedido && pedido.estado === "enviando");
  }

  // ---------- painel do carrinho (drawer) ----------
  let carrinhoAberto = false;
  let tokenFundo = 0;
  let focoAntes = null;
  const fundoInerte = () => [$("app"), $("barraCarrinho")];

  function abrirCarrinho() {
    if (carrinhoAberto) return;
    carrinhoAberto = true;
    focoAntes = document.activeElement;
    const fundo = $("fundoCarrinho");
    const painel = $("painelCarrinho");
    tokenFundo += 1;
    fundo.hidden = false;
    painel.removeAttribute("aria-hidden");
    painel.inert = false;
    for (const n of fundoInerte()) n.inert = true;
    void fundo.offsetWidth;
    fundo.classList.add("aberto");
    painel.classList.add("aberto");
    $("btnAbrirCarrinho").setAttribute("aria-expanded", "true");
    $("btnFecharCarrinho").focus();
  }

  function fecharCarrinho() {
    if (!carrinhoAberto) return;
    carrinhoAberto = false;
    const fundo = $("fundoCarrinho");
    const painel = $("painelCarrinho");
    const meu = ++tokenFundo;
    fundo.classList.remove("aberto");
    painel.classList.remove("aberto");
    painel.setAttribute("aria-hidden", "true");
    painel.inert = true;
    for (const n of fundoInerte()) n.inert = false;
    $("btnAbrirCarrinho").setAttribute("aria-expanded", "false");
    setTimeout(() => { if (meu === tokenFundo) fundo.hidden = true; }, 230);
    const alvo = focoAntes && document.contains(focoAntes) && !focoAntes.disabled && !focoAntes.closest("[hidden]") ? focoAntes : $("btnAbrirCarrinho");
    if (alvo && alvo.focus) alvo.focus();
  }

  $("btnAbrirCarrinho").addEventListener("click", abrirCarrinho);
  $("btnFecharCarrinho").addEventListener("click", fecharCarrinho);
  $("fundoCarrinho").addEventListener("click", fecharCarrinho);
  document.addEventListener("keydown", (ev) => { if (ev.key === "Escape" && carrinhoAberto && !dlg.open) { ev.preventDefault(); fecharCarrinho(); } });

  // ---------- abertura / descanso ----------
  function tocarAbertura() {
    const v = $("aberturaVideo");
    if (reduzir()) { v.pause(); return; }
    const p = v.play();
    if (p && p.catch) p.catch(() => { /* sem video: o poster de fundo continua */ });
  }

  function entrar() {
    document.body.classList.remove("estado-abertura");
    $("aberturaVideo").pause();
    window.scrollTo(0, 0);
    const app = $("app");
    app.tabIndex = -1;
    app.focus({ preventScroll: true });
    atualizarAtiva();
  }

  function voltarInicio() {
    if (emVoo || (pedido && pedido.estado === "enviando")) return; // nunca durante envio
    if (carrinhoAberto) fecharCarrinho();
    document.body.classList.add("estado-abertura");
    tocarAbertura();
    $("btnEntrar").focus();
  }

  $("btnEntrar").addEventListener("click", entrar);
  $("btnInicio").addEventListener("click", voltarInicio);
  $("aberturaVideo").addEventListener("error", () => { $("aberturaVideo").hidden = true; });
  $("aberturaVideo").addEventListener("stalled", () => { /* nao bloqueia: CTA ja esta ativo */ });
  document.querySelector(".barra-info").setAttribute("aria-live", "polite");

  function salvarCarrinho() { gravar(CHAVE_CARRINHO, carrinho); renderCarrinho(); }

  // ---------- envio ----------
  function mostrarResultado(r) {
    const alvo = $("resultado");
    alvo.textContent = "";
    if (!r) { $("btnNovo").hidden = true; return; }
    const p = el("p", r.estado === "aceito" || r.estado === "enviando" ? "" : "erro", r.mensagem || "");
    alvo.appendChild(p);
    if (r.senha && r.estado !== "nao_enviado") alvo.appendChild(el("div", "senha", "Senha " + r.senha));
    if (r.totalCentavos !== undefined && r.estado === "aceito") alvo.appendChild(el("p", "detalhe", `Total do pedido de teste: ${dinheiro(r.totalCentavos)}`));
    $("btnNovo").hidden = !(r.estado === "aceito" || r.estado === "ambiguo" || r.podeTentarNovamente);
    $("btnNovo").textContent = r.estado === "ambiguo" ? "Já conferi na loja de teste; começar novo pedido" : r.estado === "aceito" ? "Começar novo pedido de teste" : "Tentar de novo com um novo pedido";
    if (carrinhoAberto && alvo.scrollIntoView) alvo.scrollIntoView({ block: "nearest", behavior: reduzir() ? "auto" : "smooth" });
  }

  async function status(chave) {
    const resp = await fetch("/api/hml/status?chave=" + encodeURIComponent(chave), { cache: "no-store" });
    return resp.json();
  }

  async function aplicarStatus() {
    if (!pedido) return;
    try {
      const r = await status(pedido.key);
      if (r.estado === "inexistente") { pedido.estado = undefined; mostrarResultado(null); }
      else { pedido.estado = r.estado; gravar(CHAVE_PEDIDO, pedido); mostrarResultado(r); if (r.estado === "enviando") setTimeout(aplicarStatus, 1500); }
    } catch {
      pedido.estado = "ambiguo";
      mostrarResultado({ estado: "ambiguo", mensagem: "Não foi possível confirmar o envio. Confira o pedido na loja de teste" });
    }
    renderCarrinho();
  }

  async function enviar() {
    if (emVoo || travado() || !carrinho.length) return;
    emVoo = true;
    abrirCarrinho(); // o resultado do envio fica sempre visivel
    $("btnEnviar").disabled = true;
    if (!pedido) {
      pedido = { key: crypto.randomUUID(), itens: JSON.parse(JSON.stringify(carrinho)) };
      gravar(CHAVE_PEDIDO, pedido); // chave e itens guardados ANTES do envio
    }
    mostrarResultado({ estado: "enviando", mensagem: "Enviando o pedido para a loja de teste…" });
    try {
      const resp = await fetch("/api/hml/carrinho", {
        method: "POST", cache: "no-store",
        headers: { "Content-Type": "application/json", "X-CSRF-Token": cfg.csrf },
        body: JSON.stringify({ idempotencyKey: pedido.key, itens: pedido.itens }),
      });
      const r = await resp.json();
      emVoo = false;
      if (r.estado) { pedido.estado = r.estado; gravar(CHAVE_PEDIDO, pedido); mostrarResultado(r); }
      else {
        // recusado antes de qualquer reserva (validacao): nada foi enviado; libera a chave
        if (r.erro !== "chave_reutilizada") { pedido = null; localStorage.removeItem(CHAVE_PEDIDO); }
        mostrarResultado({ estado: "nao_enviado", mensagem: r.mensagem || "Não foi possível enviar.", podeTentarNovamente: false });
      }
    } catch {
      emVoo = false;
      await aplicarStatus(); // mesma chave: pergunta ao servidor o que aconteceu
    }
    renderCarrinho();
  }

  $("btnEnviar").addEventListener("click", enviar);
  $("btnNovo").addEventListener("click", () => {
    if (pedido && pedido.estado === "ambiguo" && !window.confirm("Você já conferiu na loja de teste se este pedido chegou?")) return;
    const aceito = pedido && pedido.estado === "aceito";
    pedido = null;
    localStorage.removeItem(CHAVE_PEDIDO);
    if (aceito || !carrinho.length) { carrinho = []; gravar(CHAVE_CARRINHO, carrinho); }
    mostrarResultado(null);
    renderCarrinho();
  });
  $("busca").addEventListener("input", (ev) => { busca = ev.target.value; if (menu) renderLista(); });

  // ---------- inicio ----------
  async function carregarMenu() {
    const resp = await fetch("/api/hml/cardapio", { cache: "no-store" });
    if (!resp.ok) throw new Error("cardapio");
    return resp.json();
  }

  function limparCarrinhoInvalido() {
    carrinho = (Array.isArray(ler(CHAVE_CARRINHO)) ? ler(CHAVE_CARRINHO) : []).filter((l) => {
      const p = l && produtoPorId(l.produto);
      return p && Number.isInteger(l.quantidade) && l.quantidade >= 1 && l.quantidade <= menu.limites.maxQuantidade &&
        p.variacoes.some((v) => v.indice === l.variacao) && Array.isArray(l.opcoes) && l.opcoes.every((o) => opcaoPorId(o.opcao) && Number.isInteger(o.quantidade) && o.quantidade >= 1);
    }).slice(0, menu.limites.maxItens);
  }

  async function atualizarPeriodicamente() {
    try {
      menu = await carregarMenu();
      // categoria ativa e scroll sao preservados: so refaz a lista (e o menu de categorias se mudou)
      if (menu.categorias.map((c) => c.id).join(",") !== assinaturaCat) renderCategorias();
      renderLista(); renderCarrinho(); atualizarAtiva();
    } catch { /* mantem o ultimo cardapio */ }
    setTimeout(atualizarPeriodicamente, 60000);
  }

  async function iniciar() {
    try {
      cfg = await (await fetch("/api/hml/config", { cache: "no-store" })).json();
      menu = await carregarMenu();
    } catch {
      $("lista").textContent = "";
      $("lista").appendChild(el("p", "erro", "O cardápio não está disponível no momento."));
      return;
    }
    const d = menu.fonte.consultadoEm ? new Date(menu.fonte.consultadoEm).toLocaleDateString("pt-BR") : "data desconhecida";
    $("fonte").textContent = `Cardápio de ${d}`;
    limparCarrinhoInvalido();
    const salvo = ler(CHAVE_PEDIDO);
    pedido = salvo && typeof salvo.key === "string" && Array.isArray(salvo.itens) ? salvo : null;
    renderCategorias();
    renderLista();
    renderCarrinho();
    await aplicarStatus();
    setTimeout(atualizarPeriodicamente, 60000);
  }
  tocarAbertura();
  iniciar();
})();
