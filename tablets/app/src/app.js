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
  // Rodada enviada sem resposta: carrinho travado ate reenviar (mesma chave, nao duplica).
  function travado() {
    if (!(ENVIO && ENVIO.temPendente())) return false;
    msg("A cozinha ainda não confirmou a rodada anterior. Toque em Confirmar para reenviar (não duplica) antes de mudar o carrinho.");
    return true;
  }
  function salvar() { if (storage && !C.gravarEstado(storage, estado)) $("avisoStorage").hidden = false; }
  const msg = (t) => { $("msg").textContent = t; };
  const hora = (iso) => { const d = new Date(iso); return isNaN(d) ? "" : d.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" }); };

  // Frases de "pedir e facil" (so no modo servidor; a demonstracao avulsa fica como era).
  const FACIL = !!ENVIO;
  if (FACIL) {
    const passos = el("ol", "passos-facil");
    passos.setAttribute("aria-label", "Como pedir");
    for (const [n, t] of [["1", "Toque na foto"], ["2", "Escolha do seu jeito"], ["3", ENVIO.pagarAntes ? "Confirme e pague aqui" : "Confirme e pronto"]]) {
      const li = el("li"); li.append(el("span", "passo-n cubano", n), el("span", "", t)); passos.appendChild(li);
    }
    $("notaPrevia").after(passos);
  }
  $("notaPrevia").textContent = FACIL
    ? "Pedir aqui é fácil: sem fila e sem esperar o garçom. Você escolhe, confirma e a gente leva até a mesa."
    : ENVIO && ENVIO.pixReal ? "Pedir aqui é fácil: você escolhe, paga com Pix e a gente leva até a mesa."
    : ENVIO
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
      if (travado()) return;
      C.adicionarAoCarrinho(ix, estado, Object.assign({ produto: p.id }, selecao()));
    } catch (e) { $("dpAviso").textContent = e.message; return; }
    salvar();
    fecharProduto();
    renderComanda();
    msg(FACIL ? `Pronto! “${p.nome}” está no carrinho. Quer mais alguma coisa? Quando terminar, é só tocar em ${ENVIO.pagarAntes ? "Confirmar e pagar" : "Confirmar"}.`
      : `“${p.nome}” adicionado ao carrinho. Ainda não registrado na comanda.`);
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
      ? `Ocupação: mesa ${estado.mesa}. ${ENVIO ? (ENVIO.pixReal ? "Pague cada rodada com Pix; a equipe confere e leva até a mesa." : "Modo teste: as rodadas vão para a cozinha de teste; nada é cobrado.") : "Simulada: nada é enviado ao Saipos nem à cozinha."}`
      : estado.comanda
        ? `Ocupação: cartão/comanda ${estado.comanda} (identificador da comanda, não é pagamento). ${ENVIO ? (ENVIO.pixReal ? "Pague cada rodada com Pix; a equipe confere e leva até a mesa." : "Modo teste: as rodadas vão para a cozinha de teste; nada é cobrado.") : "Simulada: nada é enviado ao Saipos nem à cozinha."}`
        : "Cartão/comanda ainda não definido: toque no botão do topo e confirme o identificador antes de registrar.";
    // carrinho
    const caixa = $("itens");
    caixa.textContent = "";
    if (!estado.carrinho.length) {
      const v = el("p", "vazio");
      v.append(el("strong", "", FACIL ? "Seu pedido começa aqui" : "O carrinho está vazio"),
        el("span", "", FACIL ? "É só tocar na foto do que você quiser. Leva poucos segundos." : "Toque em uma foto do cardápio para escolher o primeiro item."));
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
      menos.addEventListener("click", () => { if (!travado() && C.alterarQuantidadeLinha(ix, estado, i, -1)) { salvar(); renderComanda(); } });
      mais.addEventListener("click", () => { if (!travado() && C.alterarQuantidadeLinha(ix, estado, i, 1)) { salvar(); renderComanda(); } });
      rem.addEventListener("click", () => { if (!travado() && C.removerLinha(estado, i)) { salvar(); renderComanda(); } });
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
      h.appendChild(el("span", "selo", (r.idServidor && ETAPA[preparo.get(r.idServidor)]) || r.status));
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
      let nome = null;
      if (FACIL) {
        nome = await pedirNome();
        if (nome === null) { msg("Tudo bem, o carrinho continua aqui. Quando quiser, toque em Confirmar."); return; }
      }
      const ok = FACIL ? await confirmar(`TUDO CERTO, ${nome.toLocaleUpperCase("pt-BR")}?`,
        `${qtd} ${qtd === 1 ? "item" : "itens"}, ${reais(C.totalCarrinho(ix, estado))}, para a ${C.rotuloOcupacao(estado).toLowerCase()}. ${ENVIO.pagarAntes ? "Agora é só pagar e a cozinha começa na hora." : "Confirme e a cozinha começa na hora."}${ENVIO.pixReal ? "" : " (Teste: nada é cobrado.)"}`,
        ENVIO.pagarAntes ? "Sim, ir para o pagamento" : "Sim, enviar à cozinha")
      : await confirmar("REGISTRAR PEDIDO",
        `Registrar rodada ${estado.rodadas.length + 1} em ${C.rotuloOcupacao(estado).toLowerCase()}: ${qtd} ${qtd === 1 ? "item" : "itens"}, ${reais(C.totalCarrinho(ix, estado))}? Depois de registrada, a mesa/comanda não pode mais ser trocada até fechar a comanda. ${ENVIO ? "A rodada vai para a cozinha de teste. Nada é cobrado." : "Demonstração: nada é enviado à cozinha."}`,
        ENVIO ? "Enviar à cozinha" : "Registrar rodada");
      if (!ok) { msg("Registro cancelado. O carrinho foi mantido."); return; }
      if (ENVIO) {
        msg("Enviando a rodada para a cozinha…");
        let res = await ENVIO.enviarRodada({ ocupacao: C.ocupacaoAtual(estado), numero: estado.rodadas.length + 1, itens: estado.carrinho, nome });
        if (!res.ok) { msg(res.mensagem); return; } // carrinho mantido; tocar de novo reenvia com a MESMA chave (sem duplicar)
        if (res.aguardandoPagamento) {
          // Paga ANTES: so depois do pagamento aprovado a rodada vai para a cozinha (e o carrinho vira rodada aqui).
          msg("Escolha como pagar. A rodada vai para a cozinha assim que o pagamento for aprovado.");
          const fim = await telaPagamento(res);
          if (!fim.ok) { msg(fim.mensagem); return; }
          ENVIO.limparPendente();
          res = fim.res;
        }
        const r = C.confirmarRodada(ix, estado);
        if (r) {
          if (C.STATUS_VALIDOS.includes(res.status)) r.status = res.status;
          if (typeof res.id === "string") r.idServidor = res.id;
          if (res.totalCentavos !== r.totalCentavos) console.warn("total do servidor difere do tablet");
          salvar();
          msg(FACIL
            ? `Rodada ${r.numero}: pedido feito!${r.status && res.mensagem.startsWith("Pagamento aprovado") ? " Pagamento aprovado." : ""} Já está na cozinha e você acompanha aqui ao lado. Quer mais alguma coisa? É só pedir de novo.`
            : `Rodada ${r.numero} — ${res.mensagem}`);
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
    if (ENVIO) {
      const pin = await pedirPin("Fechar a conta desta mesa (equipe)");
      if (!pin) return;
      const r = await ENVIO.fecharMesa(C.ocupacaoAtual(estado), pin);
      if (!r.ok) { msg(r.mensagem); return; }
      encerrarLocal("Conta fechada pela equipe. Tablet liberado para o próximo cliente.");
      return;
    }
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
  $("btnMesa").addEventListener("click", async () => {
    if (ENVIO && !(await pedirPin("Trocar a mesa deste tablet (equipe)"))) return;
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

  // ---------- modo servidor: senha da equipe, mesa fixa, andamento e fechamento pela equipe ----------
  const ETAPA = { NOVO: "Recebida na cozinha", PREPARANDO: "Preparando", PRONTO: "Pronta", ENTREGUE: "Entregue" };
  const preparo = new Map(); // idServidor -> etapa (so memoria; vem do servidor)
  function encerrarLocal(texto) {
    C.fecharComanda(estado);
    preparo.clear();
    if (ENVIO) ENVIO.limparPendente();
    try { localStorage.removeItem(CHAVE_NOME); } catch { /* ok */ }
    salvar(); renderComanda();
    msg(texto);
  }
  // Pede a senha da equipe e confere no servidor. Retorna a senha ou null.
  let dlgPin = null;
  function pedirPin(titulo) {
    if (!dlgPin) {
      dlgPin = el("dialog");
      dlgPin.id = "dlgPin";
      const box = el("div", "dlg-simples");
      box.append(el("h2", "cubano", "SO PARA A EQUIPE"), el("p", "pequeno"));
      const inp = el("input"); inp.type = "password"; inp.inputMode = "numeric"; inp.maxLength = 8; inp.autocomplete = "off"; inp.id = "pinNumero";
      const lab = el("label", "", "Senha da equipe"); lab.htmlFor = "pinNumero";
      const erro = el("p", "aviso"); erro.setAttribute("role", "alert");
      const linha = el("div", "acoes-linha");
      const nao = el("button", "btn sec", "Cancelar"); nao.type = "button";
      const sim = el("button", "btn prim", "Confirmar"); sim.type = "button";
      linha.append(nao, sim);
      box.append(lab, inp, erro, linha);
      dlgPin.appendChild(box);
      document.body.appendChild(dlgPin);
    }
    const [, info, , inp, erro, linha] = dlgPin.firstChild.children;
    const [nao, sim] = linha.children;
    info.textContent = titulo;
    inp.value = ""; erro.textContent = "";
    return new Promise((ok) => {
      const sair = (v) => { sim.onclick = nao.onclick = inp.onkeydown = null; fechar(dlgPin); ok(v); };
      nao.onclick = () => sair(null);
      const tentar = async () => {
        sim.disabled = true;
        const r = await ENVIO.conferirPin(inp.value);
        sim.disabled = false;
        if (r.ok) sair(inp.value); else { erro.textContent = r.mensagem; inp.select(); }
      };
      sim.onclick = tentar;
      inp.onkeydown = (ev) => { if (ev.key === "Enter") { ev.preventDefault(); tentar(); } };
      abrir(dlgPin);
      inp.focus();
    });
  }
  // ---------- primeiro nome de quem pede (para o garcom entregar) ----------
  const CHAVE_NOME = "cdm-tablet-nome-v1";
  const NOME_OK = /^[\p{L}][\p{L}' -]{0,19}$/u;
  let dlgNome = null;
  function pedirNome() {
    if (!dlgNome) {
      dlgNome = el("dialog"); dlgNome.id = "dlgNome";
      const box = el("div", "dlg-simples");
      const inp = el("input"); inp.id = "nomeCliente"; inp.type = "text"; inp.maxLength = 20; inp.autocomplete = "off"; inp.setAttribute("autocapitalize", "words"); inp.placeholder = "Ex.: Ana";
      const lab = el("label", "", "Seu primeiro nome"); lab.htmlFor = "nomeCliente";
      const erro = el("p", "aviso"); erro.setAttribute("role", "alert");
      const linha = el("div", "acoes-linha");
      const nao = el("button", "btn sec", "Voltar"); nao.type = "button";
      const sim = el("button", "btn prim", "Continuar"); sim.type = "button";
      linha.append(nao, sim);
      box.append(el("h2", "cubano", "COMO VOCÊ SE CHAMA?"), el("p", "pequeno", "Só o primeiro nome, para o garçom entregar o pedido certinho para você."), lab, inp, erro, linha);
      dlgNome.appendChild(box);
      document.body.appendChild(dlgNome);
    }
    const inp = dlgNome.querySelector("#nomeCliente"), erro = dlgNome.querySelector(".aviso");
    const [nao, sim] = dlgNome.querySelector(".acoes-linha").children;
    try { inp.value = localStorage.getItem(CHAVE_NOME) || ""; } catch { inp.value = ""; }
    erro.textContent = "";
    return new Promise((ok) => {
      const sair = (v) => { sim.onclick = nao.onclick = inp.onkeydown = null; dlgNome.oncancel = null; fechar(dlgNome); ok(v); };
      const tentar = () => {
        const t = inp.value.normalize("NFC").trim().replace(/\s+/g, " ");
        if (!NOME_OK.test(t)) { erro.textContent = t ? "Use só letras (até 20)." : "Digite seu primeiro nome."; inp.focus(); return; }
        try { localStorage.setItem(CHAVE_NOME, t); } catch { /* ok */ }
        sair(t);
      };
      nao.onclick = () => sair(null);
      sim.onclick = tentar;
      inp.onkeydown = (ev) => { if (ev.key === "Enter") { ev.preventDefault(); tentar(); } };
      dlgNome.oncancel = (ev) => { ev.preventDefault(); sair(null); };
      abrir(dlgNome);
      inp.focus(); inp.select();
    });
  }

  // ---------- pagamento antes da cozinha (TESTE: simulado; QR para pagar no celular) ----------
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
    svg.setAttribute("aria-label", "QR Code para pagar no celular");
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
  // No tablet so o Pix: Apple Pay e Google Pay sao do celular do cliente (pelo QR). Digitar cartao nao e oferecido aqui.
  const FORMAS_PAG = [["pix", "Pagar com Pix aqui"]];
  let dlgPag = null;
  async function telaPagamento(res) {
    const info = await ENVIO.pagamento(res.token);
    const pix = info && info.pix ? info.pix : null; // Pix da loja (QR com valor; a equipe confirma)
    if (!dlgPag) { dlgPag = el("dialog"); dlgPag.id = "dlgPag"; document.body.appendChild(dlgPag); }
    dlgPag.textContent = "";
    const box = el("div", "pag");
    box.appendChild(el("h2", "cubano", "PAGAR A RODADA"));
    box.appendChild(el("p", "pag-total cubano", reais(res.totalCentavos)));
    box.appendChild(el("p", "pag-facil", pix ? "Falta pouco! Abra o app do seu banco, escolha Pix e leia este QR Code. O valor já vem preenchido."
      : "Falta pouco! Aponte a câmera do celular para o QR Code e pague com Apple Pay, Google Pay ou Pix."));
    box.appendChild(el("p", "pequeno", pix ? `${C.rotuloOcupacao(estado)} · rodada ${estado.rodadas.length + 1}. Recebedor: ${pix.recebedor}. Assim que a equipe confirmar o Pix, o pedido vai para a cozinha.`
      : `${C.rotuloOcupacao(estado)} · rodada ${estado.rodadas.length + 1}. Pagou, a cozinha já começa. TESTE: nada é cobrado.`));
    const cols = el("div", "pag-cols");
    const qrBox = el("div", "pag-qr");
    const qr = desenharQr(pix ? pix.copiaECola : `${location.origin}/pagar?t=${res.token}`);
    if (qr) qrBox.appendChild(qr);
    qrBox.appendChild(el("p", "pequeno", pix ? "Pix com o valor certo. Não precisa digitar nada." : "Abra a câmera do celular, aponte aqui e toque no link. Um toque no Apple Pay ou Google Pay e pronto."));
    const botoes = el("div", "pag-formas");
    botoes.appendChild(el("p", "pequeno", "Sem celular por perto? Pague com Pix aqui:"));
    for (const [forma, nome] of FORMAS_PAG) { const b = el("button", "btn prim", nome); b.type = "button"; b.dataset.forma = forma; botoes.appendChild(b); }
    const recusa = el("button", "btn sec", "Simular recusado (teste)"); recusa.type = "button"; recusa.dataset.forma = "credito"; recusa.dataset.recusar = "1";
    botoes.appendChild(recusa);
    if (pix) {
      botoes.textContent = "";
      botoes.appendChild(el("p", "pequeno", "Pagando pelo mesmo celular? Copie o código Pix e cole no app do banco:"));
      const cc = el("textarea", "pix-cc"); cc.readOnly = true; cc.rows = 4; cc.value = pix.copiaECola; cc.setAttribute("aria-label", "Pix copia e cola");
      const copiar = el("button", "btn sec", "Copiar código Pix"); copiar.type = "button";
      copiar.addEventListener("click", async () => { try { await navigator.clipboard.writeText(pix.copiaECola); copiar.textContent = "Copiado!"; } catch { cc.select(); } });
      botoes.append(cc, copiar, el("p", "aviso", "Pagou? Aguarde aqui: a equipe confere o Pix e o pedido segue sozinho para a cozinha."));
    }
    cols.append(qrBox, botoes);
    const st = el("p", "aviso pag-status"); st.setAttribute("role", "status");
    const cancelar = el("button", "btn sec", "Cancelar pagamento"); cancelar.type = "button";
    box.append(cols, st, cancelar);
    dlgPag.appendChild(box);
    return new Promise((ok) => {
      let acabou = false, ocupado = false;
      const sair = (v) => { if (acabou) return; acabou = true; clearInterval(timer); fechar(dlgPag); ok(v); };
      const tratar = (j) => {
        if (!j) return;
        if (j.estado === "aprovado" && j.rodada) sair({ ok: true, res: j.rodada });
        else if (j.estado === "cancelado") { ENVIO.limparPendente(); sair({ ok: false, mensagem: "Pagamento cancelado. Nada foi cobrado; o carrinho continua aqui." }); }
        else if (j.estado === "recusado") st.textContent = "Pagamento recusado. Escolha outra forma ou tente de novo.";
      };
      botoes.addEventListener("click", async (ev) => {
        const b = ev.target.closest("button");
        if (!b || ocupado || b.closest(".csim")) return;
        ocupado = true;
        // Cartao/carteira: mostra o passo que o cliente faz no pagamento real (simulado; nada e enviado).
        if (!b.dataset.recusar && window.CDMCartaoSim && b.dataset.forma !== "pix") {
          st.textContent = "";
          const feito = await window.CDMCartaoSim.abrir(botoes, { forma: b.dataset.forma, totalCentavos: res.totalCentavos });
          if (!feito) { ocupado = false; return; }
        }
        for (const x of botoes.querySelectorAll("button")) x.disabled = true;
        st.textContent = "Processando o pagamento…";
        const j = await ENVIO.simularPagamento(res.token, b.dataset.forma, b.dataset.recusar ? "recusado" : "aprovado");
        if (j && j.ok === false) st.textContent = j.mensagem; else tratar(j);
        ocupado = false;
        for (const x of botoes.querySelectorAll("button")) x.disabled = false;
      });
      cancelar.addEventListener("click", async () => {
        if (ocupado) return;
        ocupado = true;
        const r = await ENVIO.cancelarPagamento(res.token);
        ocupado = false;
        if (r.ok) sair({ ok: false, mensagem: r.mensagem });
        else { st.textContent = r.mensagem; tratar(await ENVIO.pagamento(res.token)); }
      });
      dlgPag.addEventListener("cancel", (ev) => ev.preventDefault(), { once: false }); // Esc nao fecha: use "Cancelar pagamento"
      const timer = setInterval(async () => { if (!ocupado && !acabou) tratar(await ENVIO.pagamento(res.token)); }, 2000);
      abrir(dlgPag);
    });
  }

  if (ENVIO) {
    // Tablet preso a uma mesa pelo endereco (/tablet?mesa=5): so vale com a comanda vazia.
    if (ENVIO.mesaFixa && C.comandaVazia(estado) && !(estado.modalidade === "mesa" && estado.mesa === ENVIO.mesaFixa)) {
      try { C.definirOcupacao(estado, "mesa", ENVIO.mesaFixa); salvar(); } catch { /* mantem */ }
    }
    $("btnFechar").textContent = "Fechar conta (equipe)";
    $("btnConfirmar").textContent = ENVIO.pagarAntes ? "Confirmar e pagar" : "Confirmar pedido";
    $("btnConfirmar").nextElementSibling.textContent = ENVIO.pagarAntes ? "Confira, pague aqui mesmo e a cozinha já começa. Simples assim." : "Confira e envie: a cozinha começa na hora.";
    if (ENVIO.pagarAntes && ENVIO.temPendente() && estado.carrinho.length) msg("Há uma rodada esperando pagamento. Toque em Confirmar para continuar.");
    // Andamento das rodadas e fechamento feito pela equipe (tela da cozinha/caixa)
    let consultando = false;
    const consultar = async () => {
      if (consultando || !C.ocupacaoPronta(estado)) return;
      consultando = true;
      try {
        const minhas = estado.rodadas.filter((x) => x.idServidor);
        if (!minhas.length) return;
        const r = await ENVIO.estadoMesa(minhas.map((x) => x.idServidor));
        if (!r || !Array.isArray(r.rodadas)) return;
        let mudou = false;
        for (const x of r.rodadas) if (preparo.get(x.id) !== x.preparo) { preparo.set(x.id, x.preparo); mudou = true; }
        const fechadas = new Set(r.rodadas.filter((x) => x.fechada).map((x) => x.id));
        // Libera so quando TODAS as rodadas deste tablet foram fechadas pela equipe e nao ha envio pendente.
        if (minhas.every((x) => fechadas.has(x.idServidor)) && !ENVIO.temPendente()) {
          encerrarLocal("Conta fechada. Obrigado pela visita!");
          return;
        }
        if (mudou) renderComanda();
      } finally { consultando = false; }
    };
    setInterval(consultar, 5000);
    consultar();
    // Cardapio sempre atual (horarios/itens): a cada 20 min, com o carrinho vazio e 2 min sem toque, recarrega a tela.
    // Carrinho, rodadas e envio pendente ficam guardados no aparelho; nada se perde.
    const abertoEm = Date.now();
    let ultimoToque = Date.now();
    document.addEventListener("pointerdown", () => { ultimoToque = Date.now(); }, { capture: true, passive: true });
    setInterval(() => {
      const agora = Date.now();
      if (agora - abertoEm < 20 * 60000 || agora - ultimoToque < 2 * 60000) return;
      if (estado.carrinho.length || ENVIO.temPendente() || document.querySelector("dialog[open]") || confirmando) return;
      location.reload();
    }, 60000);
    // Tela cheia (o Android pede um toque). O toque que liga a tela cheia NAO abre nada: se abrisse uma janela
    // (produto, pagamento) no mesmo toque, a pagina em tela cheia ficaria por cima dela e a janela sumiria.
    let engolirClique = false;
    document.addEventListener("pointerdown", (ev) => {
      const d = document.documentElement;
      if (document.fullscreenElement || !d.requestFullscreen || document.querySelector("dialog[open]")) return;
      engolirClique = true;
      ev.preventDefault();
      d.requestFullscreen().catch(() => { engolirClique = false; });
    }, { capture: true });
    document.addEventListener("click", (ev) => {
      if (!engolirClique) return;
      engolirClique = false;
      ev.preventDefault(); ev.stopPropagation();
    }, { capture: true });
  }

  renderCategorias();
  renderLista();
  renderComanda();
  const primeira = $("categorias").querySelector("button");
  if (primeira) primeira.setAttribute("aria-current", "true");
})();
