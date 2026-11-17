// Cardapio da loja de teste (HML). So textContent (nunca HTML dinamico). O servidor calcula e
// valida precos, horarios, limites e vinculos; aqui o front so mostra e envia {produto, variacao,
// quantidade, opcoes}. Sem codigos de integracao.
(() => {
  const CHAVE_CARRINHO = "hml.carrinho.v1";
  const CHAVE_PEDIDO = "hml.pedido.v1";
  const TRAVADOS = ["pagando", "enviando", "aceito", "ambiguo", "bloqueado"];
  const NOME_FORMA = { pix: "Pix", debito: "Débito", credito: "Crédito" };
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
    if (cfg && cfg.pagamento) {
      $("rotuloPagamento").textContent = cfg.pagamento.formas.map((f) => NOME_FORMA[f] || f).join(", ");
      $("valorTeste").textContent = "Você escolhe na próxima tela.";
      $("btnEnviar").textContent = "Ir para o pagamento";
      $("btnEnviar").hidden = !!pedido && pedido.estado === "pagando";
    } else {
      $("valorTeste").textContent = `Valor de teste: ${dinheiro(total)} (igual ao total). Nada é cobrado.`;
    }
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

  // ---------- quiosque: volta sozinho para a abertura ----------
  const OCIOSO_MS = 90000;      // cliente abandonou o cardapio/carrinho
  const DEPOIS_SENHA_MS = 30000; // pedido concluido: libera para o proximo cliente
  let ultimoToque = Date.now();
  for (const ev of ["pointerdown", "keydown", "input", "wheel", "touchstart"]) document.addEventListener(ev, () => { ultimoToque = Date.now(); }, { passive: true });
  function reiniciarTotem() {
    clearTimeout(timerPagamento);
    assinaturaPagamento = "";
    pedido = null; localStorage.removeItem(CHAVE_PEDIDO);
    carrinho = []; gravar(CHAVE_CARRINHO, carrinho);
    mostrarResultado(null);
    renderCarrinho();
    if ($("dialogo").open) $("dialogo").close();
    voltarInicio();
  }
  setInterval(() => {
    if (document.body.classList.contains("estado-abertura") || emVoo) return;
    const parado = Date.now() - ultimoToque;
    const pg = pedido && pedido.pagamento;
    if (pedido && pedido.estado === "aceito") { if (parado > DEPOIS_SENHA_MS) reiniciarTotem(); return; }
    if (pedido && pedido.pago) return; // pago: so atendente/fluxo encerram
    if (pedido && ["enviando", "ambiguo", "bloqueado"].includes(pedido.estado)) return;
    if (pg && (pg.estado === "aguardando" || pg.estado === "incerto")) return; // cliente pode estar pagando
    if (parado > OCIOSO_MS) reiniciarTotem();
  }, 5000);

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
    const pago = !!(pedido && pedido.pago);
    let msg = r.mensagem || "";
    if (pago && r.estado === "nao_enviado") msg = "Pagamento aprovado. Tentando enviar para a cozinha de novo…";
    if (pago && ["recusado", "ambiguo", "bloqueado"].includes(r.estado)) msg = "Seu pagamento foi aprovado. Chame um atendente e mostre esta tela.";
    const p = el("p", r.estado === "aceito" || r.estado === "enviando" ? "" : "erro", msg);
    alvo.appendChild(p);
    if (pago && r.estado === "nao_enviado") {
      pedido.tentativas = (pedido.tentativas || 0) + 1;
      gravar(CHAVE_PEDIDO, pedido);
      if (pedido.tentativas <= 5) setTimeout(enviar, 3000); // mesma chave: nunca paga de novo
      else alvo.firstChild.textContent = "Seu pagamento foi aprovado, mas o pedido não chegou à cozinha. Chame um atendente e mostre esta tela.";
    }
    if (r.senha && r.estado !== "nao_enviado") alvo.appendChild(el("div", "senha", "Senha " + r.senha));
    if (r.totalCentavos !== undefined && r.estado === "aceito") alvo.appendChild(el("p", "detalhe", `Total do pedido de teste: ${dinheiro(r.totalCentavos)}`));
    if (r.estado === "aceito" && pedido && pedido.pagamento && pedido.pagamento.estado === "aprovado") {
      const pg = pedido.pagamento;
      const recibo = el("div", "recibo");
      recibo.appendChild(el("p", "recibo-titulo", "Comprovante (teste)"));
      recibo.appendChild(el("p", "", `Pago com ${NOME_FORMA[pg.forma] || pg.forma}: ${dinheiro(pg.totalCentavos)}`));
      if (pg.autorizacao) recibo.appendChild(el("p", "", `Autorização: ${pg.autorizacao}`));
      recibo.appendChild(el("p", "", "Acompanhe sua senha na TV."));
      alvo.appendChild(recibo);
    }
    $("btnNovo").hidden = !(r.estado === "aceito" || r.estado === "ambiguo" || r.podeTentarNovamente) || (pago && r.estado === "nao_enviado" && pedido.tentativas <= 5);
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

  // ---------- pagamento (so quando o servidor liga a etapa) ----------
  let timerPagamento = null;
  let assinaturaPagamento = "";
  let fimQr = null;

  function textoVence() {
    if (!fimQr) return "";
    const s = Math.max(0, Math.round((fimQr - Date.now()) / 1000));
    return s > 0 ? `O QR Code vence em ${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}` : "QR Code vencido. Conferindo…";
  }
  setInterval(() => { const v = document.querySelector(".vence"); if (v) v.textContent = textoVence(); }, 1000);

  async function cancelarPagamento() {
    if (!pedido || emVoo) return;
    emVoo = true;
    clearTimeout(timerPagamento);
    try {
      const resp = await fetch("/api/hml/pagamento/cancelar", {
        method: "POST", cache: "no-store",
        headers: { "Content-Type": "application/json", "X-CSRF-Token": cfg.csrf },
        body: JSON.stringify({ idempotencyKey: pedido.key }),
      });
      emVoo = false;
      await tratarPagamento(await resp.json()); // se pagou no ultimo segundo, vale o aprovado
    } catch {
      emVoo = false;
      await consultarPagamento();
    }
  }

  function desenharQr(texto) {
    if (typeof window.qrcode !== "function") return null;
    const qr = window.qrcode(0, "M");
    qr.addData(texto);
    qr.make();
    const n = qr.getModuleCount();
    const NS = "http://www.w3.org/2000/svg";
    const svg = document.createElementNS(NS, "svg");
    svg.setAttribute("viewBox", `-4 -4 ${n + 8} ${n + 8}`);
    svg.setAttribute("class", "qr");
    svg.setAttribute("role", "img");
    svg.setAttribute("aria-label", "QR Code do Pix");
    const fundo = document.createElementNS(NS, "rect");
    fundo.setAttribute("x", "-4"); fundo.setAttribute("y", "-4");
    fundo.setAttribute("width", String(n + 8)); fundo.setAttribute("height", String(n + 8)); fundo.setAttribute("fill", "#fff");
    svg.appendChild(fundo);
    let d = "";
    for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) if (qr.isDark(r, c)) d += `M${c} ${r}h1v1h-1z`;
    const path = document.createElementNS(NS, "path");
    path.setAttribute("d", d); path.setAttribute("fill", "#111");
    svg.appendChild(path);
    return svg;
  }

  function mostrarEscolha(aviso) {
    const alvo = $("resultado");
    alvo.textContent = "";
    $("btnNovo").hidden = true;
    const caixa = el("div", "pagar");
    caixa.appendChild(el("h3", "pagar-titulo", "Como você quer pagar?"));
    if (aviso) caixa.appendChild(el("p", "erro", aviso));
    const grade = el("div", "formas");
    for (const f of cfg.pagamento.formas) {
      const b = el("button", "forma forma-" + f, NOME_FORMA[f] || f);
      b.type = "button";
      b.addEventListener("click", () => escolherForma(f));
      grade.appendChild(b);
    }
    caixa.appendChild(grade);
    const voltar = el("button", "secundario", "Voltar e mudar o pedido");
    voltar.type = "button";
    voltar.addEventListener("click", () => {
      clearTimeout(timerPagamento);
      pedido = null; localStorage.removeItem(CHAVE_PEDIDO);
      mostrarResultado(null); renderCarrinho();
    });
    caixa.appendChild(voltar);
    alvo.appendChild(caixa);
    if (alvo.scrollIntoView) alvo.scrollIntoView({ block: "nearest" });
  }

  function mostrarPagamento(r) {
    const alvo = $("resultado");
    const assinatura = [r.estado, r.forma, r.qr, r.mensagem, r.totalCentavos].join("|");
    if (assinatura === assinaturaPagamento && alvo.querySelector(".pagar")) return; // nada mudou: nao redesenha o QR
    assinaturaPagamento = assinatura;
    fimQr = r.expiraEm ? Date.parse(r.expiraEm) : null;
    alvo.textContent = "";
    const caixa = el("div", "pagar");
    caixa.appendChild(el("h3", "pagar-titulo", `${NOME_FORMA[r.forma] || "Pagamento"} · ${dinheiro(r.totalCentavos || 0)}`));
    caixa.appendChild(el("p", r.estado === "recusado" || r.estado === "cancelado" ? "erro" : "pagar-msg", r.mensagem || ""));
    if (r.estado === "aguardando" && r.forma === "pix" && r.qr) {
      const svg = desenharQr(r.qr);
      if (svg) caixa.appendChild(svg);
      caixa.appendChild(el("p", "detalhe", "Ou use o Pix copia e cola:"));
      caixa.appendChild(el("p", "copia", r.qr));
      if (fimQr) caixa.appendChild(el("p", "vence", textoVence()));
    }
    if (r.estado === "aguardando" && r.forma !== "pix") caixa.appendChild(el("div", "maquininha", "💳"));
    if (r.estado === "aguardando" || r.estado === "incerto") {
      caixa.appendChild(el("div", "esperando", "Aguardando confirmação…"));
      if (r.estado === "aguardando") {
        const c = el("button", "secundario", "Cancelar pagamento");
        c.type = "button";
        c.addEventListener("click", cancelarPagamento);
        caixa.appendChild(c);
      }
    }
    if (r.estado === "recusado" || r.estado === "cancelado") {
      const de = el("button", "cta", "Escolher outra forma de pagamento");
      de.type = "button";
      de.addEventListener("click", () => {
        assinaturaPagamento = "";
        // nova chave: a tentativa recusada fica registrada e nunca vira cobranca
        pedido = { key: crypto.randomUUID(), itens: pedido.itens, estado: "pagando" };
        gravar(CHAVE_PEDIDO, pedido);
        mostrarEscolha();
      });
      caixa.appendChild(de);
    }
    alvo.appendChild(caixa);
  }

  async function tratarPagamento(r) {
    clearTimeout(timerPagamento);
    if (!pedido) return;
    if (r.estado === "inexistente") { mostrarEscolha(); return; }
    if (!r.estado) { mostrarEscolha(r.mensagem || "Não foi possível iniciar o pagamento."); return; }
    pedido.pagamento = { forma: r.forma, estado: r.estado, totalCentavos: r.totalCentavos, autorizacao: r.autorizacao ?? null };
    gravar(CHAVE_PEDIDO, pedido);
    mostrarPagamento(r);
    if (r.estado === "aprovado") {
      pedido.pago = true;
      pedido.estado = undefined; // libera o envio para a cozinha
      gravar(CHAVE_PEDIDO, pedido);
      setTimeout(enviar, 900);
    } else if (r.estado === "aguardando" || r.estado === "incerto") {
      timerPagamento = setTimeout(consultarPagamento, 1500);
    }
  }

  async function consultarPagamento() {
    if (!pedido) return;
    try {
      const resp = await fetch("/api/hml/pagamento?chave=" + encodeURIComponent(pedido.key), { cache: "no-store" });
      await tratarPagamento(await resp.json());
    } catch {
      timerPagamento = setTimeout(consultarPagamento, 3000); // sem rede: so reconsulta, nunca cobra de novo
    }
  }

  async function escolherForma(forma) {
    if (!pedido || emVoo) return;
    emVoo = true;
    mostrarPagamento({ estado: "incerto", forma, totalCentavos: 0, mensagem: "Iniciando o pagamento…" });
    try {
      const resp = await fetch("/api/hml/pagamento", {
        method: "POST", cache: "no-store",
        headers: { "Content-Type": "application/json", "X-CSRF-Token": cfg.csrf },
        body: JSON.stringify({ idempotencyKey: pedido.key, forma, itens: pedido.itens }),
      });
      emVoo = false;
      await tratarPagamento(await resp.json());
    } catch {
      emVoo = false;
      await consultarPagamento(); // mesma chave: pergunta o que aconteceu
    }
  }

  function irParaPagamento() {
    abrirCarrinho();
    if (!pedido) pedido = { key: crypto.randomUUID(), itens: JSON.parse(JSON.stringify(carrinho)) };
    pedido.estado = "pagando";
    gravar(CHAVE_PEDIDO, pedido);
    renderCarrinho();
    mostrarEscolha();
  }

  async function enviar() {
    if (cfg && cfg.pagamento && !(pedido && pedido.pago)) { if (!emVoo && !travado() && carrinho.length) irParaPagamento(); return; }
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
    // Pedido em andamento (tela recarregada / totem reiniciado): pula a abertura e mostra o pedido.
    if (pedido && (pedido.estado === "pagando" || pedido.pago || TRAVADOS.includes(pedido.estado))) { entrar(); abrirCarrinho(); }
    if (cfg.pagamento && pedido && pedido.estado === "pagando") await consultarPagamento();
    else await aplicarStatus();
    setTimeout(atualizarPeriodicamente, 60000);
  }
  tocarAbertura();
  iniciar();
})();
