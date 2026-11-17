"use strict";
// Nucleo puro (sem DOM, sem rede) do tablet de mesas CDM - PROTOTIPO.
// Motor reaproveitado do totem (regras de grupos/opcoes/variacoes do cardapio-hml.js).
// ATENCAO: catalogo de producao do salao NAO esta aqui (ver README).
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.CDMCore = factory();
})(typeof self !== "undefined" ? self : this, function () {
  const CHAVE = "cdm-tablet-demo-v1";
  const LIM = { maxQuantidade: 20, maxObservacao: 140, maxLinhasCarrinho: 40, mesaMin: 1, mesaMax: 150, mesaInicial: 12, maxSimulacoes: 50 };
  const STATUS_RODADA = "Registrado nesta demonstração";
  // Status vindos do servidor do salao (modo teste). Qualquer outro valor volta a STATUS_RODADA ao recarregar.
  const STATUS_VALIDOS = [STATUS_RODADA, "Na cozinha de teste", "Na cozinha e no Saipos (teste)", "Na cozinha · Saipos a conferir"];

  const reais = (c) => (c / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
  const inteiro = (n, min, max) => Number.isInteger(n) && n >= min && n <= max;
  // Sem regex e sem escapes \u: troca controles (<32, 127) e separadores de linha (8232, 8233) por espaco.
  const limparTexto = (s) => Array.from(String(s == null ? "" : s), (ch) => {
    const c = ch.charCodeAt(0);
    return c < 32 || c === 127 || c === 8232 || c === 8233 ? " " : ch;
  }).join("").trim();

  function normalizarMesa(v) {
    if (typeof v === "number") return inteiro(v, LIM.mesaMin, LIM.mesaMax) ? v : null;
    if (typeof v !== "string") return null;
    const s = v.trim();
    if (!/^\d{1,3}$/.test(s)) return null;
    const n = Number(s);
    return inteiro(n, LIM.mesaMin, LIM.mesaMax) ? n : null;
  }

  // "Cartao/comanda" = so o IDENTIFICADOR da comanda (nao e pagamento). Apenas formato, SEM faixas numericas reais
  // (nao ha evidencia delas): 1 a 12 caracteres A-Z, 0-9 ou hifen; "007" e "7" sao identificadores distintos.
  function normalizarComanda(v) {
    if (typeof v === "number" && Number.isSafeInteger(v) && v >= 0) v = String(v);
    if (typeof v !== "string") return null;
    const s = v.trim().toUpperCase();
    return /^[A-Z0-9][A-Z0-9-]{0,11}$/.test(s) ? s : null;
  }

  const ocupacaoAtual = (e) => ({ modalidade: e.modalidade, mesa: e.modalidade === "mesa" ? e.mesa : null, comanda: e.modalidade === "comanda" ? e.comanda : null });
  const ocupacaoPronta = (e) => (e.modalidade === "mesa" ? normalizarMesa(e.mesa) !== null : normalizarComanda(e.comanda) !== null);
  const rotuloOcupacao = (e) => (e.modalidade === "mesa" ? `MESA ${e.mesa}` : e.comanda ? `COMANDA ${e.comanda}` : "COMANDA (definir)");
  function ocupacaoValida(o) {
    if (!o || typeof o !== "object") return null;
    if (o.modalidade === "mesa") { const m = normalizarMesa(o.mesa); return m === null ? null : { modalidade: "mesa", mesa: m, comanda: null }; }
    if (o.modalidade === "comanda") { const c = normalizarComanda(o.comanda); return c === null ? null : { modalidade: "comanda", mesa: null, comanda: c }; }
    return null;
  }
  const mesmaOcupacao = (a, b) => a.modalidade === b.modalidade && a.mesa === b.mesa && a.comanda === b.comanda;

  function indexar(menu) {
    const P = new Map(menu.produtos.map((p) => [p.id, p]));
    const G = new Map(menu.grupos.map((g) => [g.id, g]));
    const O = new Map(menu.opcoes.map((o) => [o.id, o]));
    const porGrupo = new Map();
    for (const o of menu.opcoes) {
      if (!porGrupo.has(o.grupo)) porGrupo.set(o.grupo, []);
      porGrupo.get(o.grupo).push(o);
    }
    for (const l of porGrupo.values()) l.sort((a, b) => a.posicao - b.posicao || a.id - b.id);
    return {
      produto: (id) => P.get(id),
      grupo: (id) => G.get(id),
      opcao: (id) => O.get(id),
      opcoesDoGrupo: (gid) => porGrupo.get(gid) || [],
      gruposDoProduto: (p) => p.grupos.map((id) => G.get(id)).filter(Boolean),
    };
  }

  // "Obrigatorio" e SEPARADO de minimo (evidencia Goomer: minimo 1 com required=0). Contrato legado (VNDX), sem o
  // campo, mantem a regra antiga: minimo > 0 implica obrigatorio.
  const grupoObrigatorio = (g) => (typeof g.obrigatorio === "boolean" ? g.obrigatorio : g.minimo > 0);

  function regraGrupo(g) {
    const q = g.permitirQuantidade ? "unidades" : "opções";
    if (!grupoObrigatorio(g) && g.minimo > 0) return `Opcional: pode não escolher; se escolher, de ${g.minimo} até ${g.maximo} ${q}`;
    if (g.minimo > 0 && g.minimo === g.maximo) return `Escolha ${g.minimo} ${g.minimo === 1 ? "opção" : q}`;
    if (g.minimo > 0) return `Escolha de ${g.minimo} até ${g.maximo} ${q}`;
    return `Opcional: até ${g.maximo} ${q}`;
  }

  const ingredientesDe = (p) => (p.ingredientes || []).map((i) => (typeof i === "string" ? i : i && i.nome)).filter(Boolean);

  // sel = { variacao, quantidade, opcoes:[{opcao,quantidade}], obs, retiradas:[nome] }
  function validarSelecao(ix, p, sel) {
    if (!p || !sel) return "Seleção inválida.";
    if (!p.variacoes.some((v) => v.indice === sel.variacao)) return "Escolha uma variação.";
    if (!inteiro(sel.quantidade, 1, LIM.maxQuantidade)) return `Quantidade deve ser de 1 a ${LIM.maxQuantidade}.`;
    if (p.ocultarQuantidade && sel.quantidade !== 1) return "Este item não permite alterar a quantidade.";
    const ops = Array.isArray(sel.opcoes) ? sel.opcoes : [];
    const vistos = new Set();
    const grupos = ix.gruposDoProduto(p);
    const soma = new Map(grupos.map((g) => [g.id, 0]));
    for (const it of ops) {
      const o = it && ix.opcao(it.opcao);
      if (!o || !soma.has(o.grupo)) return "Opção inválida para este produto.";
      if (vistos.has(o.id)) return "Opção repetida.";
      vistos.add(o.id);
      const g = ix.grupo(o.grupo);
      if (!inteiro(it.quantidade, 1, LIM.maxQuantidade)) return "Quantidade de opção inválida.";
      if (!g.permitirQuantidade && it.quantidade !== 1) return `“${g.nome}” não permite quantidade.`;
      soma.set(o.grupo, soma.get(o.grupo) + it.quantidade);
    }
    for (const g of grupos) {
      const s = soma.get(g.id);
      if (s === 0 && !grupoObrigatorio(g)) continue; // grupo opcional: zero e permitido, mesmo com minimo > 0
      if (s < g.minimo) return grupoObrigatorio(g) ? `Escolha pelo menos ${g.minimo} em “${g.nome}”.` : `Em “${g.nome}” (opcional), se escolher, escolha pelo menos ${g.minimo}.`;
      if (s > g.maximo) return `Escolha no máximo ${g.maximo} em “${g.nome}”.`;
    }
    const obs = sel.obs == null ? "" : String(sel.obs);
    if (obs.length > LIM.maxObservacao) return `Observação com no máximo ${LIM.maxObservacao} caracteres.`;
    if (p.ocultarObservacao && obs.trim()) return "Este item não aceita observação.";
    const ing = ingredientesDe(p);
    if ((sel.retiradas || []).some((r) => !ing.includes(r))) return "Retirada inválida.";
    return null;
  }

  function totalSelecao(ix, p, sel) {
    const v = p.variacoes.find((x) => x.indice === sel.variacao);
    if (!v) return null;
    const ad = (sel.opcoes || []).reduce((s, it) => s + ix.opcao(it.opcao).centavos * it.quantidade, 0);
    return (v.centavos + ad) * sel.quantidade;
  }

  function criarLinha(ix, p, sel) {
    const e = validarSelecao(ix, p, sel);
    if (e) throw new Error(e);
    const linha = {
      produto: p.id,
      variacao: sel.variacao,
      quantidade: sel.quantidade,
      opcoes: sel.opcoes.map((o) => ({ opcao: o.opcao, quantidade: o.quantidade })).sort((a, b) => a.opcao - b.opcao),
    };
    const obs = limparTexto(sel.obs).slice(0, LIM.maxObservacao);
    if (obs) linha.obs = obs;
    if (sel.retiradas && sel.retiradas.length) linha.retiradas = [...sel.retiradas];
    return linha;
  }

  function totalLinha(ix, l) {
    const p = ix.produto(l.produto);
    return totalSelecao(ix, p, l);
  }

  // ---------- estado da comanda local ----------
  function novoEstado() {
    return { versao: 1, modalidade: "mesa", mesa: LIM.mesaInicial, comanda: null, carrinho: [], rodadas: [], simulacoes: [] };
  }
  const comandaVazia = (e) => e.rodadas.length === 0 && e.carrinho.length === 0;
  const totalCarrinho = (ix, e) => e.carrinho.reduce((s, l) => s + totalLinha(ix, l), 0);
  const totalComanda = (e) => e.rodadas.reduce((s, r) => s + r.totalCentavos, 0);

  function adicionarAoCarrinho(ix, e, linha) {
    if (e.carrinho.length >= LIM.maxLinhasCarrinho) throw new Error(`O carrinho aceita até ${LIM.maxLinhasCarrinho} itens.`);
    const p = ix.produto(linha.produto);
    const rev = criarLinha(ix, p, linha); // revalida
    e.carrinho.push(rev);
    return rev;
  }

  function alterarQuantidadeLinha(ix, e, i, delta) {
    const l = e.carrinho[i];
    if (!l) return false;
    if (ix.produto(l.produto).ocultarQuantidade) return false;
    const n = l.quantidade + delta;
    if (!inteiro(n, 1, LIM.maxQuantidade)) return false;
    l.quantidade = n;
    return true;
  }

  function removerLinha(e, i) {
    if (!e.carrinho[i]) return false;
    e.carrinho.splice(i, 1);
    return true;
  }

  function fotografar(ix, l) {
    const p = ix.produto(l.produto);
    const v = p.variacoes.find((x) => x.indice === l.variacao);
    const opcoes = l.opcoes.map((o) => { const op = ix.opcao(o.opcao); return { nome: op.nome, quantidade: o.quantidade, centavos: op.centavos }; });
    const unit = v.centavos + opcoes.reduce((s, o) => s + o.centavos * o.quantidade, 0);
    return {
      produtoId: p.id, nome: p.nome, variacaoNome: p.variacoes.length > 1 ? v.nome : "", quantidade: l.quantidade,
      opcoes, obs: l.obs || "", retiradas: l.retiradas || [], unitarioCentavos: unit, totalCentavos: unit * l.quantidade,
    };
  }

  // Idempotente por construcao: apos o primeiro uso o carrinho fica vazio, entao um segundo
  // disparo imediato (duplo clique) devolve null e nao cria rodada duplicada.
  function confirmarRodada(ix, e, agora) {
    if (!e.carrinho.length) return null;
    if (!ocupacaoPronta(e)) throw new Error("Informe e confirme o identificador do cartão/comanda antes de registrar.");
    const itens = e.carrinho.map((l) => fotografar(ix, l));
    const r = {
      numero: e.rodadas.length + 1,
      ocupacao: ocupacaoAtual(e), // o identificador viaja com cada rodada

      criadoEm: (agora || new Date()).toISOString(),
      status: STATUS_RODADA,
      itens,
      totalCentavos: itens.reduce((s, i) => s + i.totalCentavos, 0),
    };
    e.rodadas.push(r);
    e.carrinho = [];
    return r;
  }

  function trocarMesa(e, valor) {
    const n = normalizarMesa(valor);
    if (n === null) throw new Error(`Mesa inválida. Use um número inteiro de ${LIM.mesaMin} a ${LIM.mesaMax}.`);
    if (!comandaVazia(e)) throw new Error("A mesa só pode ser alterada com a comanda vazia. Feche a comanda de teste antes.");
    e.mesa = n;
    return n;
  }

  // Pode alterar se nao ha rodadas e (carrinho vazio OU identificador ainda pendente).
  const podeAlterarOcupacao = (e) => e.rodadas.length === 0 && (e.carrinho.length === 0 || !ocupacaoPronta(e));

  // Define a ocupacao: modalidade "mesa" (1-150) ou "comanda" (identificador do cartao). Nunca com consumo ativo.
  function definirOcupacao(e, modalidade, valor) {
    if (modalidade !== "mesa" && modalidade !== "comanda") throw new Error("Modalidade inválida.");
    const id = modalidade === "mesa" ? normalizarMesa(valor) : normalizarComanda(valor);
    if (id === null) throw new Error(modalidade === "mesa" ? `Mesa inválida. Use um número inteiro de ${LIM.mesaMin} a ${LIM.mesaMax}.` : "Identificador inválido. Use de 1 a 12 letras, números ou hífen.");
    if (!podeAlterarOcupacao(e)) throw new Error("A ocupação só pode ser alterada com a comanda vazia. Feche a comanda de teste antes.");
    e.modalidade = modalidade;
    if (modalidade === "mesa") e.mesa = id; else e.comanda = id; // mesa anterior e preservada ao usar comanda
    return id;
  }

  function fecharComanda(e) {
    const resumo = { rodadas: e.rodadas.length, totalCentavos: totalComanda(e) };
    e.rodadas = [];
    e.carrinho = [];
    e.simulacoes = [];
    if (e.modalidade === "comanda") e.comanda = null; // novo cartao exige novo identificador confirmado
    return resumo; // mesa mantida
  }

  function registrarSimulacao(e, tipo, agora) {
    if (tipo !== "atendente" && tipo !== "conta") throw new Error("Tipo inválido.");
    const s = { tipo, em: (agora || new Date()).toISOString() };
    e.simulacoes.push(s);
    if (e.simulacoes.length > LIM.maxSimulacoes) e.simulacoes.shift();
    return s;
  }

  // ---------- persistencia (apenas a chave cdm-tablet-demo-v1) ----------
  function sanear(ix, bruto) {
    const e = novoEstado();
    if (!bruto || typeof bruto !== "object" || bruto.versao !== 1) return e;
    const m = normalizarMesa(bruto.mesa);
    if (m !== null) e.mesa = m;
    // Migracao: estado antigo (sem modalidade) vira modalidade "mesa" preservando a mesa.
    if (bruto.modalidade === "comanda") { e.modalidade = "comanda"; e.comanda = normalizarComanda(bruto.comanda); }
    if (Array.isArray(bruto.carrinho)) {
      for (const l of bruto.carrinho.slice(0, LIM.maxLinhasCarrinho)) {
        try { e.carrinho.push(criarLinha(ix, ix.produto(l && l.produto), l)); } catch { /* descarta linha invalida */ }
      }
    }
    if (Array.isArray(bruto.rodadas)) {
      for (const r of bruto.rodadas) {
        if (!r || typeof r.criadoEm !== "string" || !Array.isArray(r.itens) || !r.itens.length) continue;
        const itens = r.itens.filter((i) => i && typeof i.nome === "string" && inteiro(i.quantidade, 1, LIM.maxQuantidade) &&
          inteiro(i.totalCentavos, 0, 1e9) && Array.isArray(i.opcoes)).map((i) => ({
          produtoId: i.produtoId, nome: limparTexto(i.nome), variacaoNome: limparTexto(i.variacaoNome), quantidade: i.quantidade,
          opcoes: i.opcoes.filter((o) => o && typeof o.nome === "string" && inteiro(o.quantidade, 1, LIM.maxQuantidade) && inteiro(o.centavos, 0, 1e9))
            .map((o) => ({ nome: limparTexto(o.nome), quantidade: o.quantidade, centavos: o.centavos })),
          obs: limparTexto(i.obs).slice(0, LIM.maxObservacao),
          retiradas: Array.isArray(i.retiradas) ? i.retiradas.map(limparTexto) : [],
          unitarioCentavos: inteiro(i.unitarioCentavos, 0, 1e9) ? i.unitarioCentavos : 0, totalCentavos: i.totalCentavos,
        }));
        if (!itens.length) continue;
        // rodada legada (sem ocupacao) herda a atual; a 1a rodada valida fixa a ocupacao e as demais devem coincidir
        const occ = r.ocupacao === undefined ? ocupacaoAtual(e) : ocupacaoValida(r.ocupacao);
        if (!occ || (r.ocupacao === undefined && !ocupacaoPronta(e))) continue;
        if (!e.rodadas.length) { e.modalidade = occ.modalidade; if (occ.modalidade === "mesa") e.mesa = occ.mesa; else e.comanda = occ.comanda; }
        else if (!mesmaOcupacao(occ, ocupacaoAtual(e))) continue;
        e.rodadas.push({ numero: e.rodadas.length + 1, ocupacao: occ, criadoEm: r.criadoEm, status: STATUS_VALIDOS.includes(r.status) ? r.status : STATUS_RODADA, itens, totalCentavos: itens.reduce((s, i) => s + i.totalCentavos, 0) });
      }
    }
    if (Array.isArray(bruto.simulacoes)) {
      e.simulacoes = bruto.simulacoes.filter((s) => s && (s.tipo === "atendente" || s.tipo === "conta") && typeof s.em === "string").slice(-LIM.maxSimulacoes)
        .map((s) => ({ tipo: s.tipo, em: s.em }));
    }
    return e;
  }

  function lerEstado(ix, storage) {
    try {
      const txt = storage.getItem(CHAVE);
      return sanear(ix, txt ? JSON.parse(txt) : null);
    } catch { return novoEstado(); }
  }
  function gravarEstado(storage, e) {
    try { storage.setItem(CHAVE, JSON.stringify(e)); return true; } catch { return false; }
  }

  return {
    CHAVE, LIM, STATUS_RODADA, STATUS_VALIDOS, reais, normalizarMesa, grupoObrigatorio, normalizarComanda, definirOcupacao, podeAlterarOcupacao, rotuloOcupacao, ocupacaoPronta, ocupacaoAtual, indexar, regraGrupo, ingredientesDe, validarSelecao, totalSelecao, criarLinha,
    totalLinha, novoEstado, comandaVazia, totalCarrinho, totalComanda, adicionarAoCarrinho, alterarQuantidadeLinha, removerLinha,
    confirmarRodada, trocarMesa, fecharComanda, registrarSimulacao, sanear, lerEstado, gravarEstado,
  };
});
