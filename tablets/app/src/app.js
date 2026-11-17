"use strict";
// Interface do tablet de mesas (DEMONSTRACAO). Somente textContent; nenhuma requisicao externa.
(() => {
  const C = window.CDMCore;
  const $ = (id) => document.getElementById(id);
  const menu = JSON.parse($("dados").textContent);
  const ix = C.indexar(menu);
  const reais = C.reais;
  // Modo servidor do salao (tablets/servidor): envio.js define window.CDMEnvio. No HTML standalone nao existe => demonstracao.
  const ENVIO = window.CDMEnvio || null;

  function el(tag, cls, txt) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (txt !== undefined) e.textContent = txt;
    return e;
  }

  let storage = null;
  try { storage = window.localStorage; storage.getItem(C.CHAVE); } catch { storage = null; }
  const estado = storage ? C.lerEstado(ix, storage) : C.novoEstado();
  $("avisoStorage").hidden = !!storage;
  function salvar() { if (storage && !C.gravarEstado(storage, estado)) $("avisoStorage").hidden = false; }
  const msg = (t) => { $("msg").textContent = t; };
  const hora = (iso) => { const d = new Date(iso); return isNaN(d) ? "" : d.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" }); };

  $("notaPrevia").textContent = ENVIO
    ? `Cardápio do totem (cópia de ${menu.meta.consultaData}): ${menu.meta.amostra} itens. MODO TESTE: ${ENVIO.modo === "saipos" ? "a rodada vai para a cozinha de teste e para a loja TESTE do Saipos" : "a rodada vai para a tela da cozinha de teste"}; nada é cobrado.`
    : `Protótipo de mesas — amostra do totem; cardápio do salão ainda não importado. ${menu.meta.amostra} de ${menu.meta.totalProdutosSnapshot} itens (consulta ${menu.meta.consultaData}); preços de teste, não oficiais.`;

  // ---------- cardapio ----------
  let busca = "";
  function renderCategorias() {
    const nav = $("categorias");
    nav.textContent = "";
    for (const c of menu.categorias) {
      const b = el("button", "", c.nome);
      b.type = "button";
      b.dataset.cat = String(c.id);
      b.addEventListener("click", () => {
        if (busca) { busca = ""; $("busca").value = ""; renderLista(); }
        const alvo = document.getElementById("cat-" + c.id);
        if (!alvo) return;
        for (const x of nav.querySelectorAll("button")) x.removeAttribute("aria-current");
        b.setAttribute("aria-current", "true");
        alvo.scrollIntoView({ behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth", block: "start" });
      });
      nav.appendChild(b);
    }
  }

  function cartao(p) {
    const b = el("button", "card");
    b.type = "button";
    const foto = el("img", "foto");
    foto.src = menu.fotos[p.id] || "";
    foto.alt = "";
    const moldura = el("span", "moldura");
    const mais = el("span", "mais", "+");
    mais.setAttribute("aria-hidden", "true");
    moldura.append(foto, mais);
    const info = el("div", "info");
    info.appendChild(el("div", "nome", p.nome));
    if (p.descricao) info.appendChild(el("div", "desc", p.descricao));
    const menor = Math.min(...p.variacoes.map((v) => v.centavos));
    const preco = el("div", "preco");
    if (p.variacoes.length > 1) preco.appendChild(el("span", "de", "a partir de"));
    preco.appendChild(document.createTextNode(reais(menor)));
    info.appendChild(preco);
    b.append(moldura, info);
    b.addEventListener("click", () => abrirProduto(p));
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
    if (!algum) alvo.appendChild(el("p", "", "Nenhum item encontrado nesta amostra."));
  }
  $("busca").addEventListener("input", (ev) => { busca = ev.target.value; renderLista(); });

  // ---------- dialogos genericos ----------
  function abrir(d) { if (d.showModal) d.showModal(); else d.setAttribute("open", ""); }
  function fechar(d) { if (d.close) d.close(); else d.removeAttribute("open"); }

  function confirmar(titulo, texto, rotulo) {
    return new Promise((resolve) => {
      const d = $("dlgConfirma");
      $("dcTitulo").textContent = titulo;
      $("dcTexto").textContent = texto;
      $("dcSim").textContent = rotulo || "Confirmar";
      let r = false;
      const sim = () => { r = true; fechar(d); };
      const nao = () => { r = false; fechar(d); };
      const fim = () => {
        $("dcSim").removeEventListener("click", sim);
        $("dcNao").removeEventListener("click", nao);
        d.removeEventListener("close", fim);
        resolve(r);
      };
      $("dcSim").addEventListener("click", sim);
      $("dcNao").addEventListener("click", nao);
      d.addEventListener("close", fim); // Esc fecha como "cancelar"
      abrir(d);
      $("dcNao").focus();
    });
  }

  // ---------- dialogo do produto ----------
  const dlg = $("dlgProduto");
  let atual = null; // { p, sel }

  function selecao() {
    const { sel } = atual;
    return {
      variacao: sel.variacao, quantidade: sel.quantidade, obs: sel.obs,
      opcoes: [...sel.opcoes].map(([opcao, quantidade]) => ({ opcao, quantidade })),
      retiradas: [...sel.retiradas],
    };
  }

  function atualizarRodape() {
    const s = selecao();
    const e = C.validarSelecao(ix, atual.p, s);
    $("dpAviso").textContent = e || "";
    const t = C.totalSelecao(ix, atual.p, s);
    $("dpAdicionar").disabled = !!e;
    $("dpAdicionar").textContent = "Adicionar ao carrinho" + (t !== null ? ` — ${reais(t)}` : "");
  }

  function stepper(valor, min, max, aoMudar, nome) {
    const box = el("div", "stepper");
    const menos = el("button", "", "−");
    const mais = el("button", "", "+");
    const out = el("output", "", String(valor));
    menos.type = mais.type = "button";
    menos.setAttribute("aria-label", `Diminuir ${nome}`);
    mais.setAttribute("aria-label", `Aumentar ${nome}`);
    let v = valor;
    const pinta = () => { out.textContent = String(v); menos.disabled = v <= min; mais.disabled = v >= max; };
    menos.addEventListener("click", () => { if (v > min) { v -= 1; pinta(); aoMudar(v); } });
    mais.addEventListener("click", () => { if (v < max) { v += 1; pinta(); aoMudar(v); } });
    pinta();
    box.append(menos, out, mais);
    return box;
  }

  function abrirProduto(p) {
    atual = { p, sel: { variacao: p.variacoes.length === 1 ? p.variacoes[0].indice : null, quantidade: 1, obs: "", opcoes: new Map(), retiradas: new Set() } };
    $("dpTitulo").textContent = p.nome;
    $("dpDesc").textContent = p.descricao || "";
    $("dpDesc").hidden = !p.descricao;
    const foto = $("dpFoto");
    if (menu.fotos[p.id]) { foto.src = menu.fotos[p.id]; foto.hidden = false; } else { foto.removeAttribute("src"); foto.hidden = true; }
    const c = $("dpConteudo");
    c.textContent = "";

    if (p.variacoes.length > 1) {
      const fs = el("fieldset", "grupo");
      const lg = el("legend", "", "Variação");
      lg.appendChild(el("span", "obrig", "Obrigatório"));
      fs.appendChild(lg);
      for (const v of p.variacoes) {
        const lab = el("label", "opcao");
        const r = el("input");
        r.type = "radio"; r.name = "variacao";
        r.addEventListener("change", () => { atual.sel.variacao = v.indice; atualizarRodape(); });
        lab.append(el("span", "", `${v.nome} — ${reais(v.centavos)}`), r);
        fs.appendChild(lab);
      }
      c.appendChild(fs);
    }

    if (!p.ocultarQuantidade) {
      const q = el("div", "grupo");
      q.appendChild(el("h3", "", "Quantidade"));
      q.appendChild(stepper(1, 1, C.LIM.maxQuantidade, (v) => { atual.sel.quantidade = v; atualizarRodape(); }, p.nome));
      c.appendChild(q);
    }

    for (const g of ix.gruposDoProduto(p)) {
      const caixa = el("div", "grupo");
      const h = el("h3", "", g.nome);
      if (C.grupoObrigatorio(g)) h.appendChild(el("span", "obrig", "Obrigatório"));
      caixa.appendChild(h);
      caixa.appendChild(el("p", "pequeno", C.regraGrupo(g)));
      for (const o of ix.opcoesDoGrupo(g.id)) {
        const linha = el("div", "opcao");
        const rot = el("div", "");
        rot.appendChild(el("div", "", `${o.nome} (+ ${reais(o.centavos)})`));
        if (o.descricao) rot.appendChild(el("div", "pequeno", o.descricao));
        linha.appendChild(rot);
        if (g.permitirQuantidade) {
          linha.appendChild(stepper(0, 0, C.LIM.maxQuantidade, (v) => {
            if (v > 0) atual.sel.opcoes.set(o.id, v); else atual.sel.opcoes.delete(o.id);
            atualizarRodape();
          }, o.nome));
        } else {
          const b = el("button", "sel", "Selecionar");
          b.type = "button";
          b.dataset.opcao = String(o.id);
          b.setAttribute("aria-pressed", "false");
          b.setAttribute("aria-label", `${o.nome} em ${g.nome}`);
          b.addEventListener("click", () => {
            if (atual.sel.opcoes.has(o.id)) atual.sel.opcoes.delete(o.id);
            else {
              if (g.maximo === 1) for (const id of [...atual.sel.opcoes.keys()]) if (ix.opcao(id).grupo === g.id) atual.sel.opcoes.delete(id);
              atual.sel.opcoes.set(o.id, 1);
            }
            for (const x of caixa.querySelectorAll("button.sel")) {
              const on = atual.sel.opcoes.has(Number(x.dataset.opcao));
              x.setAttribute("aria-pressed", on ? "true" : "false");
              x.textContent = on ? "Selecionado" : "Selecionar";
            }
            atualizarRodape();
          });
          linha.appendChild(b);
        }
        caixa.appendChild(linha);
      }
      c.appendChild(caixa);
    }

    const ing = C.ingredientesDe(p);
    if (ing.length) {
      const fs = el("fieldset", "grupo");
      fs.appendChild(el("legend", "", "Retirar ingredientes (opcional)"));
      for (const nome of ing) {
        const lab = el("label", "opcao");
        const cb = el("input");
        cb.type = "checkbox";
        cb.addEventListener("change", () => { if (cb.checked) atual.sel.retiradas.add(nome); else atual.sel.retiradas.delete(nome); atualizarRodape(); });
        lab.append(el("span", "", `Sem ${nome}`), cb);
        fs.appendChild(lab);
      }
      c.appendChild(fs);
    }

    if (!p.ocultarObservacao) {
      const box = el("div", "grupo");
      const lab = el("label", "", "Observação (opcional)");
      lab.htmlFor = "dpObs";
      const t = el("textarea");
      t.id = "dpObs";
      t.maxLength = C.LIM.maxObservacao;
      t.rows = 2;
      t.placeholder = "Ex.: ponto da carne, sem cebola";
      const cont = el("p", "pequeno", `0/${C.LIM.maxObservacao}`);
      t.addEventListener("input", () => { atual.sel.obs = t.value; cont.textContent = `${t.value.length}/${C.LIM.maxObservacao}`; atualizarRodape(); });
      box.append(lab, t, cont);
      c.appendChild(box);
    }
    atualizarRodape();
    abrir(dlg);
    dlg.querySelector(".dlg-corpo").scrollTop = 0;
  }

  function fecharProduto() { fechar(dlg); atual = null; }
  dlg.addEventListener("close", () => { atual = null; });
  $("dpCancelar").addEventListener("click", fecharProduto);
  $("dpFechar").addEventListener("click", fecharProduto);
  dlg.addEventListener("click", (ev) => { if (ev.target === dlg) fecharProduto(); });
  $("dpAdicionar").addEventListener("click", () => {
    if (!atual) return;
    const { p } = atual;
    try {
      C.adicionarAoCarrinho(ix, estado, Object.assign({ produto: p.id }, selecao()));
    } catch (e) { $("dpAviso").textContent = e.message; return; }
    salvar();
    fecharProduto();
    renderComanda();
    msg(`“${p.nome}” adicionado ao carrinho. Ainda não registrado na comanda.`);
  });

  // ---------- comanda ----------
  let confirmando = false;

  function descLinha(nome, variacao, qtd) { return `${qtd} × ${nome}${variacao ? " — " + variacao : ""}`; }

  function renderComanda() {
    // topo
    const rotulo = C.rotuloOcupacao(estado);
    $("mesaTxt").textContent = rotulo;
    $("btnMesa").setAttribute("aria-label", `${rotulo}. Alterar ocupação`);
    $("ocupacaoInfo").textContent = estado.modalidade === "mesa"
      ? `Ocupação: mesa ${estado.mesa}. ${ENVIO ? "Modo teste: as rodadas vão para a cozinha de teste; nada é cobrado." : "Simulada: nada é enviado ao Saipos nem à cozinha."}`
      : estado.comanda
        ? `Ocupação: cartão/comanda ${estado.comanda} (identificador da comanda, não é pagamento). ${ENVIO ? "Modo teste: as rodadas vão para a cozinha de teste; nada é cobrado." : "Simulada: nada é enviado ao Saipos nem à cozinha."}`
        : "Cartão/comanda ainda não definido: toque no botão do topo e confirme o identificador antes de registrar.";
    // carrinho
    const caixa = $("itens");
    caixa.textContent = "";
    if (!estado.carrinho.length) {
      const v = el("p", "vazio");
      v.append(el("strong", "", "O carrinho está vazio"), el("span", "", "Toque em uma foto do cardápio para escolher o primeiro item."));
      caixa.appendChild(v);
    }
    estado.carrinho.forEach((l, i) => {
      const p = ix.produto(l.produto);
      const v = p.variacoes.find((x) => x.indice === l.variacao);
      const box = el("div", "linha-item");
      box.appendChild(el("div", "nome", descLinha(p.nome, p.variacoes.length > 1 ? v.nome : "", l.quantidade)));
      for (const o of l.opcoes) box.appendChild(el("div", "det", `${o.quantidade} × ${ix.opcao(o.opcao).nome}`));
      if (l.retiradas) for (const r of l.retiradas) box.appendChild(el("div", "det", `Sem ${r}`));
      if (l.obs) box.appendChild(el("div", "det", `Obs.: ${l.obs}`));
      box.appendChild(el("div", "det", reais(C.totalLinha(ix, l))));
      const ac = el("div", "acoes");
      const menos = el("button", "", "−"), mais = el("button", "", "+"), rem = el("button", "", "Remover");
      menos.type = mais.type = rem.type = "button";
      menos.setAttribute("aria-label", `Diminuir ${p.nome}`);
      mais.setAttribute("aria-label", `Aumentar ${p.nome}`);
      rem.setAttribute("aria-label", `Remover ${p.nome} do carrinho`);
      menos.disabled = p.ocultarQuantidade || l.quantidade <= 1;
      mais.disabled = p.ocultarQuantidade || l.quantidade >= C.LIM.maxQuantidade;
      menos.addEventListener("click", () => { if (C.alterarQuantidadeLinha(ix, estado, i, -1)) { salvar(); renderComanda(); } });
      mais.addEventListener("click", () => { if (C.alterarQuantidadeLinha(ix, estado, i, 1)) { salvar(); renderComanda(); } });
      rem.addEventListener("click", () => { if (C.removerLinha(estado, i)) { salvar(); renderComanda(); } });
      ac.append(menos, mais, rem);
      box.appendChild(ac);
      caixa.appendChild(box);
    });
    const tc = C.totalCarrinho(ix, estado);
    $("totalCarrinho").textContent = reais(tc);
    $("btnConfirmar").disabled = !estado.carrinho.length || confirmando || !C.ocupacaoPronta(estado);

    // rodadas
    const rd = $("rodadas");
    rd.textContent = "";
    if (!estado.rodadas.length) rd.appendChild(el("p", "pequeno", ENVIO ? "Nenhuma rodada enviada ainda." : "Nenhuma rodada registrada nesta demonstração."));
    for (const r of estado.rodadas) {
      const box = el("div", "rodada");
      const h = el("h4", "", `Rodada ${r.numero} · ${hora(r.criadoEm)}`);
      h.appendChild(el("span", "selo", r.status));
      box.appendChild(h);
      for (const i of r.itens) {
        box.appendChild(el("div", "", descLinha(i.nome, i.variacaoNome, i.quantidade)));
        for (const o of i.opcoes) box.appendChild(el("div", "pequeno", `${o.quantidade} × ${o.nome}`));
        for (const x of i.retiradas) box.appendChild(el("div", "pequeno", `Sem ${x}`));
        if (i.obs) box.appendChild(el("div", "pequeno", `Obs.: ${i.obs}`));
      }
      box.appendChild(el("div", "pequeno", `Total da rodada: ${reais(r.totalCentavos)}`));
      rd.appendChild(box);
    }
    $("totalComanda").textContent = reais(C.totalComanda(estado));
    $("btnFechar").disabled = C.comandaVazia(estado);
    const sim = $("simInfo");
    const na = estado.simulacoes.filter((s) => s.tipo === "atendente").length;
    const nc = estado.simulacoes.length - na;
    sim.textContent = estado.simulacoes.length ? (ENVIO ? `Avisos enviados à equipe nesta comanda: ${na} de atendente, ${nc} de conta.` : `Simulações locais nesta comanda: ${na} de atendente, ${nc} de conta. Nenhuma foi enviada.`) : "";

    // barra (tablet vertical / telas estreitas)
    const qtd = estado.carrinho.reduce((s, l) => s + l.quantidade, 0);
    $("btnAbrirSheet").textContent = `Comanda · ${rotulo.toLowerCase()} · carrinho ${qtd} ${qtd === 1 ? "item" : "itens"} ${reais(tc)} · registrado ${reais(C.totalComanda(estado))}`;
  }

  const simInfo = el("p", "pequeno");
  simInfo.id = "simInfo";
  $("btnFechar").parentNode.insertBefore(simInfo, $("btnFechar"));

  // Confirmacao explicita ANTES de registrar a rodada. Trava anti-duplo-toque cobre o dialogo e o registro.
  $("btnConfirmar").addEventListener("click", async () => {
    if (confirmando || !estado.carrinho.length) return;
    confirmando = true;
    $("btnConfirmar").disabled = true;
    try {
      if (!C.ocupacaoPronta(estado)) { msg("Informe e confirme o identificador do cartão/comanda antes de registrar."); return; }
      const qtd = estado.carrinho.reduce((s, l) => s + l.quantidade, 0);
      const ok = await confirmar("REGISTRAR PEDIDO",
        `Registrar rodada ${estado.rodadas.length + 1} em ${C.rotuloOcupacao(estado).toLowerCase()}: ${qtd} ${qtd === 1 ? "item" : "itens"}, ${reais(C.totalCarrinho(ix, estado))}? Depois de registrada, a mesa/comanda não pode mais ser trocada até fechar a comanda. ${ENVIO ? "A rodada vai para a cozinha de teste. Nada é cobrado." : "Demonstração: nada é enviado à cozinha."}`,
        ENVIO ? "Enviar à cozinha" : "Registrar rodada");
      if (!ok) { msg("Registro cancelado. O carrinho foi mantido."); return; }
      if (ENVIO) {
        msg("Enviando a rodada para a cozinha…");
        const res = await ENVIO.enviarRodada({ ocupacao: C.ocupacaoAtual(estado), numero: estado.rodadas.length + 1, itens: estado.carrinho });
        if (!res.ok) { msg(res.mensagem); return; } // carrinho mantido; tocar de novo reenvia com a MESMA chave (sem duplicar)
        const r = C.confirmarRodada(ix, estado);
        if (r) {
          if (C.STATUS_VALIDOS.includes(res.status)) r.status = res.status;
          if (res.totalCentavos !== r.totalCentavos) console.warn("total do servidor difere do tablet");
          salvar();
          msg(`Rodada ${r.numero} — ${res.mensagem}`);
        }
        return;
      }
      const r = C.confirmarRodada(ix, estado);
      if (r) {
        salvar();
        msg(`Rodada ${r.numero} — ${C.STATUS_RODADA} (${reais(r.totalCentavos)}). Nada foi enviado ao Saipos nem à cozinha.`);
      }
    } catch (e) {
      msg(e.message);
    } finally {
      confirmando = false;
      renderComanda();
    }
  });

  async function avisar(tipo) {
    const res = await ENVIO.aviso(tipo, C.ocupacaoAtual(estado));
    if (res.ok) { C.registrarSimulacao(estado, tipo); salvar(); renderComanda(); }
    msg(res.mensagem);
  }
  $("btnAtendente").addEventListener("click", () => {
    if (ENVIO) { avisar("atendente"); return; }
    C.registrarSimulacao(estado, "atendente");
    salvar(); renderComanda();
    msg("SIMULAÇÃO: nenhum atendente foi avisado. Esta demonstração não envia nada. Chame a equipe pessoalmente.");
  });
  $("btnConta").addEventListener("click", () => {
    if (ENVIO) { avisar("conta"); return; }
    C.registrarSimulacao(estado, "conta");
    salvar(); renderComanda();
    msg("SIMULAÇÃO: o pedido de conta não foi enviado. Esta demonstração não envia nem processa nada. Chame a equipe pessoalmente.");
  });

  $("btnFechar").addEventListener("click", async () => {
    if (C.comandaVazia(estado)) return;
    const ok = await confirmar("FECHAR COMANDA",
      `Fechar a comanda de teste (${C.rotuloOcupacao(estado).toLowerCase()})? Serão apagados o carrinho e ${estado.rodadas.length} rodada(s) registrada(s) (${reais(C.totalComanda(estado))}). ${estado.modalidade === "mesa" ? "A mesa é mantida." : "Um novo cartão/comanda exigirá novo identificador."} Nada foi enviado ou cobrado.`,
      "Fechar e limpar");
    if (!ok) return;
    const res = C.fecharComanda(estado);
    salvar(); renderComanda();
    msg(`Comanda de teste fechada (${res.rodadas} rodada(s), ${reais(res.totalCentavos)}). Dados limpos; ${estado.modalidade === "mesa" ? `mesa ${estado.mesa} pronta para nova ocupação` : "informe o identificador do próximo cartão/comanda"}.`);
  });

  // ---------- mesa ----------
  const dm = $("dlgMesa");
  let modEscolhida = "mesa";
  function pintarModalidade() {
    const mesa = modEscolhida === "mesa";
    $("dmModMesa").setAttribute("aria-pressed", mesa ? "true" : "false");
    $("dmModCartao").setAttribute("aria-pressed", mesa ? "false" : "true");
    $("dmRotulo").textContent = mesa ? `Número da mesa (${C.LIM.mesaMin} a ${C.LIM.mesaMax})` : "Identificador do cartão/comanda";
    $("dmAjuda").textContent = mesa ? "" : "Cartão aqui é só o identificador da comanda; não é pagamento. De 1 a 12 letras, números ou hífen. Nenhuma faixa de numeração oficial foi assumida.";
    $("dmNumero").inputMode = mesa ? "numeric" : "text";
    $("dmNumero").value = mesa ? String(estado.mesa) : (estado.comanda || "");
    $("dmErro").textContent = "";
  }
  function escolherModalidade(m) { if ($("dmModMesa").disabled) return; modEscolhida = m; pintarModalidade(); $("dmNumero").focus(); }
  $("dmModMesa").addEventListener("click", () => escolherModalidade("mesa"));
  $("dmModCartao").addEventListener("click", () => escolherModalidade("comanda"));
  $("btnMesa").addEventListener("click", () => {
    const vazia = C.podeAlterarOcupacao(estado);
    modEscolhida = estado.modalidade;
    pintarModalidade();
    for (const id of ["dmNumero", "dmSalvar", "dmModMesa", "dmModCartao"]) $(id).disabled = !vazia;
    $("dmInfo").textContent = vazia
      ? "A comanda está vazia: a ocupação pode ser alterada. Tudo aqui é simulado."
      : "Há itens no carrinho ou rodadas registradas. Feche a comanda de teste antes de alterar mesa ou cartão.";
    abrir(dm);
    if (vazia) { $("dmNumero").focus(); $("dmNumero").select(); } else $("dmCancelar").focus();
  });
  $("dmCancelar").addEventListener("click", () => fechar(dm));
  async function salvarMesa() {
    const valor = $("dmNumero").value;
    const id = modEscolhida === "mesa" ? C.normalizarMesa(valor) : C.normalizarComanda(valor);
    if (id === null) {
      $("dmErro").textContent = modEscolhida === "mesa" ? `Mesa inválida. Use um número inteiro de ${C.LIM.mesaMin} a ${C.LIM.mesaMax}.` : "Identificador inválido. Use de 1 a 12 letras, números ou hífen.";
      return;
    }
    const atualId = modEscolhida === "mesa" ? estado.mesa : estado.comanda;
    if (estado.modalidade === modEscolhida && id === atualId) { fechar(dm); return; }
    const ok = await confirmar("CONFIRMAR", modEscolhida === "mesa"
      ? `Este tablet passa a identificar a comanda pela mesa ${id}?`
      : `Este tablet passa a identificar a comanda pelo cartão ${id}? Confira o identificador: não poderá mudar enquanto houver consumo.`, "Confirmar");
    if (!ok) return;
    try { C.definirOcupacao(estado, modEscolhida, id); } catch (e) { $("dmErro").textContent = e.message; return; }
    salvar(); renderComanda(); fechar(dm);
    msg(modEscolhida === "mesa" ? `Mesa ${id} definida.` : `Cartão/comanda ${id} definido (identificador, não pagamento).`);
  }
  $("dmSalvar").addEventListener("click", salvarMesa);
  $("dmNumero").addEventListener("keydown", (ev) => { if (ev.key === "Enter") { ev.preventDefault(); salvarMesa(); } });

  // ---------- painel da comanda em telas estreitas ----------
  const mq = window.matchMedia("(max-width:959px)");
  let sheet = false;
  let focoAntes = null;
  function abrirSheet() {
    if (sheet) return;
    sheet = true;
    focoAntes = document.activeElement;
    $("comanda").classList.add("aberta");
    $("app").inert = true;
    $("barra").inert = true;
    $("btnAbrirSheet").setAttribute("aria-expanded", "true");
    $("btnFecharSheet").focus();
  }
  function fecharSheet() {
    if (!sheet) return;
    sheet = false;
    $("comanda").classList.remove("aberta");
    $("app").inert = false;
    $("barra").inert = false;
    $("btnAbrirSheet").setAttribute("aria-expanded", "false");
    const alvo = focoAntes && document.contains(focoAntes) ? focoAntes : $("btnAbrirSheet");
    if (alvo.focus) alvo.focus();
  }
  $("btnAbrirSheet").addEventListener("click", abrirSheet);
  $("btnFecharSheet").addEventListener("click", fecharSheet);
  document.addEventListener("keydown", (ev) => {
    if (ev.key === "Escape" && sheet && !document.querySelector("dialog[open]")) { ev.preventDefault(); fecharSheet(); }
  });
  mq.addEventListener("change", () => { if (!mq.matches) fecharSheet(); });

  renderCategorias();
  renderLista();
  renderComanda();
  const primeira = $("categorias").querySelector("button");
  if (primeira) primeira.setAttribute("aria-current", "true");
})();
