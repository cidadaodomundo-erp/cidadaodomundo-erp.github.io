// Testes locais (node --test tests/). Sem rede. FIXTURE abaixo e sintetica, usada so nos testes.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const raiz = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const C = require(path.join(raiz, "src", "core.js"));

const FIXTURE = {
  produtos: [
    { id: 1, nome: "P1", categoria: 1, variacoes: [{ indice: 1, nome: "Unidade", centavos: 1000 }], grupos: [10, 11], ingredientes: [], ocultarObservacao: false, ocultarQuantidade: false },
    { id: 2, nome: "P2", categoria: 1, variacoes: [{ indice: 1, nome: "Peq", centavos: 500 }, { indice: 2, nome: "Grande", centavos: 900 }], grupos: [], ingredientes: ["cebola"], ocultarObservacao: true, ocultarQuantidade: true },
    { id: 3, nome: "P3", categoria: 1, variacoes: [{ indice: 1, nome: "Unidade", centavos: 2000 }], grupos: [12, 13], ingredientes: [], ocultarObservacao: false, ocultarQuantidade: false },
  ],
  grupos: [
    // 12: espelha a evidencia Goomer (minimo 1, maximo 3, required=0). 13: minimo 2 opcional. Dados sinteticos.
    { id: 12, nome: "Turbine (sintetico)", minimo: 1, maximo: 3, obrigatorio: false, permitirQuantidade: false },
    { id: 13, nome: "Molhos (sintetico)", minimo: 2, maximo: 3, obrigatorio: false, permitirQuantidade: false },
    { id: 10, nome: "Extras", minimo: 0, maximo: 3, permitirQuantidade: true },
    { id: 11, nome: "Ponto", minimo: 1, maximo: 1, permitirQuantidade: false },
  ],
  opcoes: [
    { id: 100, nome: "Bacon", grupo: 10, centavos: 600, posicao: 1 },
    { id: 101, nome: "Ovo", grupo: 10, centavos: 400, posicao: 2 },
    { id: 120, nome: "T1", grupo: 12, centavos: 400, posicao: 1 },
    { id: 121, nome: "T2", grupo: 12, centavos: 600, posicao: 2 },
    { id: 122, nome: "T3", grupo: 12, centavos: 600, posicao: 3 },
    { id: 123, nome: "T4", grupo: 12, centavos: 100, posicao: 4 },
    { id: 130, nome: "M1", grupo: 13, centavos: 500, posicao: 1 },
    { id: 131, nome: "M2", grupo: 13, centavos: 500, posicao: 2 },
    { id: 132, nome: "M3", grupo: 13, centavos: 500, posicao: 3 },
    { id: 110, nome: "Mal passada", grupo: 11, centavos: 0, posicao: 1 },
    { id: 111, nome: "Ao ponto", grupo: 11, centavos: 0, posicao: 2 },
  ],
};
const ix = C.indexar(FIXTURE);
const sel1 = (o = {}) => ({ variacao: 1, quantidade: 1, obs: "", opcoes: [{ opcao: 110, quantidade: 1 }], retiradas: [], ...o });
const store = () => { const m = new Map(); return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, v), m }; };

test("mesa valida 1-150", () => {
  for (const ok of [1, 12, 150, "7", " 150 ", "007"]) assert.ok(C.normalizarMesa(ok) !== null, String(ok));
  for (const ruim of [0, 151, -1, 1.5, "", "abc", "12a", "1e2", null, undefined, "1000", NaN]) assert.equal(C.normalizarMesa(ruim), null, String(ruim));
  assert.equal(C.novoEstado().mesa, 12);
});

test("validacao de grupos min/max e variacao obrigatoria", () => {
  const p1 = ix.produto(1), p2 = ix.produto(2);
  assert.equal(C.validarSelecao(ix, p1, sel1()), null);
  assert.match(C.validarSelecao(ix, p1, sel1({ opcoes: [] })), /pelo menos 1/);
  assert.match(C.validarSelecao(ix, p1, sel1({ opcoes: [{ opcao: 110, quantidade: 1 }, { opcao: 111, quantidade: 1 }] })), /no máximo 1/);
  assert.match(C.validarSelecao(ix, p1, sel1({ opcoes: [{ opcao: 110, quantidade: 1 }, { opcao: 100, quantidade: 4 }] })), /no máximo 3/);
  assert.match(C.validarSelecao(ix, p1, sel1({ opcoes: [{ opcao: 110, quantidade: 2 }] })), /não permite quantidade/);
  assert.match(C.validarSelecao(ix, p1, sel1({ variacao: 9 })), /variação/);
  assert.match(C.validarSelecao(ix, p1, sel1({ quantidade: 0 })), /Quantidade/);
  assert.match(C.validarSelecao(ix, p1, sel1({ opcoes: [{ opcao: 110, quantidade: 1 }, { opcao: 999, quantidade: 1 }] })), /inválida/);
  assert.match(C.validarSelecao(ix, p1, sel1({ obs: "x".repeat(141) })), /Observação/);
  assert.match(C.validarSelecao(ix, p2, { variacao: null, quantidade: 1, opcoes: [] }), /variação/);
  assert.match(C.validarSelecao(ix, p2, { variacao: 1, quantidade: 2, opcoes: [] }), /quantidade/);
  assert.match(C.validarSelecao(ix, p2, { variacao: 1, quantidade: 1, opcoes: [], obs: "oi" }), /observação/);
  assert.match(C.validarSelecao(ix, p2, { variacao: 1, quantidade: 1, opcoes: [], retiradas: ["alface"] }), /Retirada/);
  assert.equal(C.validarSelecao(ix, p2, { variacao: 2, quantidade: 1, opcoes: [], retiradas: ["cebola"] }), null);
});

test("calculos em centavos: variacao + adicionais x quantidade", () => {
  const p1 = ix.produto(1);
  const s = sel1({ quantidade: 3, opcoes: [{ opcao: 110, quantidade: 1 }, { opcao: 100, quantidade: 2 }, { opcao: 101, quantidade: 1 }] });
  assert.equal(C.totalSelecao(ix, p1, s), (1000 + 1200 + 400) * 3);
  const e = C.novoEstado();
  C.adicionarAoCarrinho(ix, e, { produto: 1, ...s });
  C.adicionarAoCarrinho(ix, e, { produto: 2, variacao: 2, quantidade: 1, opcoes: [] });
  assert.equal(C.totalCarrinho(ix, e), 7800 + 900);
  assert.equal(C.reais(7800).replace(/\s/g, " "), "R$ 78,00");
  assert.equal(C.alterarQuantidadeLinha(ix, e, 0, -1), true);
  assert.equal(C.totalCarrinho(ix, e), 5200 + 900);
  assert.equal(C.alterarQuantidadeLinha(ix, e, 1, 1), false); // ocultarQuantidade
  assert.equal(C.alterarQuantidadeLinha(ix, e, 0, 99), false);
});

test("rodadas acrescentam sem apagar; duplo disparo nao duplica", () => {
  const e = C.novoEstado();
  assert.equal(C.confirmarRodada(ix, e), null);
  C.adicionarAoCarrinho(ix, e, { produto: 1, ...sel1() });
  const r1 = C.confirmarRodada(ix, e);
  assert.equal(C.confirmarRodada(ix, e), null); // segundo clique imediato
  assert.equal(e.rodadas.length, 1);
  assert.equal(r1.status, "Registrado nesta demonstração");
  assert.equal(e.carrinho.length, 0);
  C.adicionarAoCarrinho(ix, e, { produto: 2, variacao: 2, quantidade: 1, opcoes: [] });
  const r2 = C.confirmarRodada(ix, e);
  assert.equal(e.rodadas.length, 2);
  assert.equal(r2.numero, 2);
  assert.equal(e.rodadas[0], r1);
  assert.equal(C.totalComanda(e), 1000 + 900);
});

test("historico e snapshot independem do catalogo", () => {
  const e = C.novoEstado();
  C.adicionarAoCarrinho(ix, e, { produto: 1, ...sel1({ obs: "sem sal\nobrigado" }) });
  const r = C.confirmarRodada(ix, e);
  assert.equal(r.itens[0].obs, "sem sal obrigado");
  assert.equal(r.itens[0].nome, "P1");
  assert.equal(r.itens[0].totalCentavos, 1000);
});

test("mesa so muda com comanda vazia; fechar limpa e mantem mesa", () => {
  const e = C.novoEstado();
  assert.equal(C.trocarMesa(e, "45"), 45);
  assert.throws(() => C.trocarMesa(e, "151"), /inválida/);
  assert.throws(() => C.trocarMesa(e, "abc"), /inválida/);
  C.adicionarAoCarrinho(ix, e, { produto: 1, ...sel1() });
  assert.throws(() => C.trocarMesa(e, 46), /vazia/);
  C.confirmarRodada(ix, e);
  assert.throws(() => C.trocarMesa(e, 46), /vazia/);
  C.registrarSimulacao(e, "conta");
  const res = C.fecharComanda(e);
  assert.deepEqual(res, { rodadas: 1, totalCentavos: 1000 });
  assert.equal(e.mesa, 45);
  assert.ok(C.comandaVazia(e));
  assert.equal(e.simulacoes.length, 0);
  assert.equal(C.trocarMesa(e, 46), 46);
  assert.throws(() => C.registrarSimulacao(e, "pagar"), /inválido/);
});

test("persistencia: chave exclusiva, recarga preserva, estado corrompido e saneado", () => {
  assert.equal(C.CHAVE, "cdm-tablet-demo-v1");
  const st = store();
  const e = C.novoEstado();
  C.trocarMesa(e, 33);
  C.adicionarAoCarrinho(ix, e, { produto: 1, ...sel1() });
  C.confirmarRodada(ix, e);
  C.adicionarAoCarrinho(ix, e, { produto: 2, variacao: 1, quantidade: 1, opcoes: [] });
  assert.ok(C.gravarEstado(st, e));
  assert.deepEqual([...st.m.keys()], ["cdm-tablet-demo-v1"]);
  const e2 = C.lerEstado(ix, st);
  assert.deepEqual(e2, e);
  st.setItem(C.CHAVE, "{lixo");
  assert.deepEqual(C.lerEstado(ix, st), C.novoEstado());
  const ruim = { versao: 1, mesa: 999, carrinho: [{ produto: 77 }, { produto: 1, variacao: 1, quantidade: 1, opcoes: [] }], rodadas: [{ criadoEm: "x", itens: [{ nome: "a", quantidade: 1, totalCentavos: 50, opcoes: [] }] }, null], simulacoes: [{ tipo: "x", em: "y" }] };
  const s = C.sanear(ix, ruim);
  assert.equal(s.mesa, 12); // mesa invalida -> inicial
  assert.equal(s.carrinho.length, 0); // sem grupo obrigatorio / produto inexistente
  assert.equal(s.rodadas.length, 1);
  assert.equal(s.rodadas[0].totalCentavos, 50);
  assert.equal(s.simulacoes.length, 0);
  assert.equal(C.gravarEstado({ setItem() { throw new Error("cheio"); } }, e), false);
});

// ---- obrigatorio separado de minimo (evidencia Goomer 12/11: min 1, max 3, required=0) ----
test("grupo com minimo 1 e obrigatorio=false: permite zero; se escolher, respeita minimo e maximo", () => {
  const p3 = ix.produto(3);
  const s = (opcoes) => ({ variacao: 1, quantidade: 1, obs: "", retiradas: [], opcoes: opcoes.map((id) => ({ opcao: id, quantidade: 1 })) });
  assert.equal(C.grupoObrigatorio(ix.grupo(12)), false);
  assert.equal(C.validarSelecao(ix, p3, s([])), null);               // zero em ambos os grupos: permitido
  assert.equal(C.validarSelecao(ix, p3, s([120])), null);            // 1 >= minimo 1
  assert.equal(C.validarSelecao(ix, p3, s([120, 121, 122])), null);  // ate o maximo 3
  assert.match(C.validarSelecao(ix, p3, s([120, 121, 122, 123])), /no máximo 3/);
  assert.equal(C.totalSelecao(ix, p3, s([])), 2000);                 // sem adicional pago implicito
  assert.equal(C.totalSelecao(ix, p3, s([120, 121])), 2000 + 400 + 600);
});

test("grupo opcional com minimo 2: zero ok, 1 recusado, 2 ok", () => {
  const p3 = ix.produto(3);
  const s = (opcoes) => ({ variacao: 1, quantidade: 1, obs: "", retiradas: [], opcoes: opcoes.map((id) => ({ opcao: id, quantidade: 1 })) });
  assert.equal(C.validarSelecao(ix, p3, s([])), null);
  assert.match(C.validarSelecao(ix, p3, s([130])), /opcional.*pelo menos 2/);
  assert.equal(C.validarSelecao(ix, p3, s([130, 131])), null);
  assert.match(C.regraGrupo(ix.grupo(13)), /Opcional: pode não escolher; se escolher, de 2 até 3/);
  const e = C.novoEstado();
  assert.throws(() => C.adicionarAoCarrinho(ix, e, { produto: 3, ...s([130]) }), /pelo menos 2/);
  C.adicionarAoCarrinho(ix, e, { produto: 3, ...s([]) }); // zero escolhas entra no carrinho
  assert.equal(C.totalCarrinho(ix, e), 2000);
});

test("legado VNDX (sem campo obrigatorio): minimo > 0 continua obrigatorio", () => {
  assert.equal(C.grupoObrigatorio({ minimo: 1 }), true);
  assert.equal(C.grupoObrigatorio({ minimo: 0 }), false);
  assert.equal(C.grupoObrigatorio({ minimo: 1, obrigatorio: false }), false);
  assert.equal(C.grupoObrigatorio({ minimo: 0, obrigatorio: true }), true);
  assert.match(C.validarSelecao(ix, ix.produto(1), sel1({ opcoes: [] })), /pelo menos 1/); // grupo 11 legado
});

// ---- modalidade mesa OU cartao/comanda (cartao = identificador, nao pagamento) ----
const comRodada = (e, sel = sel1()) => { C.adicionarAoCarrinho(ix, e, { produto: 1, ...sel }); return C.confirmarRodada(ix, e); };

test("identificador de comanda: so formato, sem faixa numerica assumida", () => {
  for (const ok of ["a12", "A-1", " 007 ", 123, "X", "99999", "0", "ABCDEFGHIJKL"]) assert.ok(C.normalizarComanda(ok) !== null, String(ok));
  assert.equal(C.normalizarComanda("a12"), "A12");
  assert.notEqual(C.normalizarComanda("007"), C.normalizarComanda("7")); // zeros a esquerda contam
  for (const ruim of ["", "   ", "A 1", "A_1", "ÇÃO", "ABCDEFGHIJKLM", "-A", null, undefined, 1.5, -1, {}]) assert.equal(C.normalizarComanda(ruim), null, String(ruim));
});

test("mesa e comanda sao modalidades separadas; mesa anterior e preservada", () => {
  const e = C.novoEstado();
  assert.equal(e.modalidade, "mesa");
  C.definirOcupacao(e, "mesa", 40);
  assert.equal(C.rotuloOcupacao(e), "MESA 40");
  C.definirOcupacao(e, "comanda", "b7");
  assert.equal(e.modalidade, "comanda");
  assert.equal(e.comanda, "B7");
  assert.equal(e.mesa, 40);
  assert.equal(C.rotuloOcupacao(e), "COMANDA B7");
  assert.throws(() => C.definirOcupacao(e, "comanda", "A B"), /Identificador inválido/);
  assert.throws(() => C.definirOcupacao(e, "mesa", 151), /Mesa inválida/);
  assert.throws(() => C.definirOcupacao(e, "cartao", "1"), /Modalidade/);
  C.definirOcupacao(e, "mesa", 41);
  assert.equal(e.comanda, "B7"); // identificador anterior nao e apagado ao voltar para mesa
});

test("rodadas carregam a ocupacao; identificador nao muda com consumo ativo", () => {
  const e = C.novoEstado();
  C.definirOcupacao(e, "comanda", "C9");
  C.adicionarAoCarrinho(ix, e, { produto: 1, ...sel1() });
  assert.throws(() => C.definirOcupacao(e, "comanda", "C10"), /vazia/); // carrinho ativo
  const r = C.confirmarRodada(ix, e);
  assert.deepEqual(r.ocupacao, { modalidade: "comanda", mesa: null, comanda: "C9" });
  assert.throws(() => C.definirOcupacao(e, "comanda", "C10"), /vazia/); // rodada registrada
  assert.throws(() => C.definirOcupacao(e, "mesa", 5), /vazia/);
  const r2 = comRodada(e);
  assert.deepEqual(r2.ocupacao, r.ocupacao);
  assert.equal(e.comanda, "C9");
});

test("comanda sem identificador nao registra rodada; fechar limpa o identificador (mesa e mantida em modo mesa)", () => {
  const e = C.novoEstado();
  C.definirOcupacao(e, "comanda", "Z1");
  comRodada(e);
  C.fecharComanda(e);
  assert.equal(e.modalidade, "comanda");
  assert.equal(e.comanda, null);
  assert.equal(C.rotuloOcupacao(e), "COMANDA (definir)");
  C.adicionarAoCarrinho(ix, e, { produto: 1, ...sel1() });
  assert.throws(() => C.confirmarRodada(ix, e), /identificador/);
  assert.equal(e.carrinho.length, 1);
  assert.equal(e.rodadas.length, 0);
  assert.equal(C.podeAlterarOcupacao(e), true); // identificador pendente: pode definir mesmo com carrinho
  C.definirOcupacao(e, "comanda", "Z2");
  assert.equal(e.carrinho.length, 1);
  assert.throws(() => C.definirOcupacao(e, "comanda", "Z3"), /vazia/); // agora definido + carrinho: travado
  assert.equal(C.confirmarRodada(ix, e).ocupacao.comanda, "Z2");
});

test("fechar em modo mesa mantem modalidade e mesa", () => {
  const e = C.novoEstado();
  C.definirOcupacao(e, "mesa", 77);
  comRodada(e);
  C.fecharComanda(e);
  assert.equal(e.modalidade, "mesa");
  assert.equal(e.mesa, 77);
});

test("persistencia em modo comanda: recarga preserva ocupacao nas rodadas", () => {
  const st = store();
  const e = C.novoEstado();
  C.definirOcupacao(e, "comanda", "K5");
  comRodada(e);
  comRodada(e);
  C.gravarEstado(st, e);
  const e2 = C.lerEstado(ix, st);
  assert.deepEqual(e2, e);
  assert.equal(e2.rodadas.length, 2);
  assert.equal(e2.rodadas[1].ocupacao.comanda, "K5");
  assert.equal(e2.modalidade, "comanda");
});

test("armazenamento adulterado: rodadas mandam na ocupacao; rodada de outra ocupacao e descartada", () => {
  const e = C.novoEstado();
  C.definirOcupacao(e, "comanda", "A1");
  comRodada(e);
  const bruto = JSON.parse(JSON.stringify(e));
  bruto.comanda = "B2"; // estado diz B2, mas o consumo registrado e de A1
  const intrusa = JSON.parse(JSON.stringify(bruto.rodadas[0]));
  intrusa.ocupacao = { modalidade: "comanda", mesa: null, comanda: "OUTRA" };
  bruto.rodadas.push(intrusa);
  const s = C.sanear(ix, bruto);
  assert.equal(s.comanda, "A1");
  assert.equal(s.rodadas.length, 1);
  const semId = { versao: 1, modalidade: "comanda", mesa: 5, comanda: "!!", carrinho: [], rodadas: [], simulacoes: [] };
  const s2 = C.sanear(ix, semId);
  assert.equal(s2.comanda, null);
  assert.equal(s2.mesa, 5);
  assert.equal(C.ocupacaoPronta(s2), false);
});

test("migracao do estado anterior (sem modalidade) preserva mesa, rodadas e totais", () => {
  const legado = {
    versao: 1, mesa: 33, carrinho: [{ produto: 1, variacao: 1, quantidade: 1, opcoes: [{ opcao: 110, quantidade: 1 }] }],
    rodadas: [{ numero: 1, criadoEm: "2026-11-12T12:00:00.000Z", status: "Registrado nesta demonstração", totalCentavos: 2000,
      itens: [{ produtoId: 1, nome: "P1", variacaoNome: "", quantidade: 2, opcoes: [], obs: "", retiradas: [], unitarioCentavos: 1000, totalCentavos: 2000 }] }],
    simulacoes: [],
  };
  const s = C.sanear(ix, legado);
  assert.equal(s.modalidade, "mesa");
  assert.equal(s.comanda, null);
  assert.equal(s.mesa, 33);
  assert.equal(s.rodadas.length, 1);
  assert.deepEqual(s.rodadas[0].ocupacao, { modalidade: "mesa", mesa: 33, comanda: null });
  assert.equal(C.totalComanda(s), 2000);
  assert.equal(s.carrinho.length, 1);
  assert.equal(C.podeAlterarOcupacao(s), false);
  C.gravarEstado(store(), s);
});

const htmlPath = path.join(raiz, "tablet-mesas-cdm.html");
const temHtml = fs.existsSync(htmlPath);

test("artefato: sem rede, sem innerHTML, banner e textos obrigatorios", { skip: !temHtml }, () => {
  const html = fs.readFileSync(htmlPath, "utf8");
  const limpo = html.replace(/data:[^"')\s]+/g, "DATA");
  for (const re of [/https?:\/\//i, /\bfetch\s*\(/, /XMLHttpRequest/, /WebSocket/, /sendBeacon/, /innerHTML/, /<link\b/i, /<script[^>]+src=/i]) assert.ok(!re.test(limpo), String(re));
  for (const t of ["DEMONSTRAÇÃO — pedidos não chegam à cozinha", "Confirmar pedido de teste", "Registrado nesta demonstração", "cdm-tablet-demo-v1", "Chamar atendente (simulado)", "Pedir conta (simulado)", "Sem conexão · sem envio real", "Fechar comanda de teste"]) assert.ok(html.includes(t), t);
  assert.ok(html.includes("Protótipo de mesas — amostra do totem; cardápio do salão ainda não importado"));
  assert.ok(!/cart[aã]o de cr|\bpagar\b|n[uú]mero do cart/i.test(html)); // sem UI de pagamento; "cartao" = identificador
  assert.ok(html.includes("Cartão / comanda") && html.includes("não é pagamento"));
  // sintaxe dos scripts embutidos
  const scripts = [...html.matchAll(/<script>\n([\s\S]*?)<\/script>/g)].map((m) => m[1]);
  assert.equal(scripts.length, 2);
  for (const s of scripts) new Function(s); // so compila, nao executa
});

test("artefato: catalogo embutido (amostra 6-10 ou completo, fotos, fluxo completo valido por produto)", { skip: !temHtml }, () => {
  const html = fs.readFileSync(htmlPath, "utf8");
  const m = html.match(/<script type="application\/json" id="dados">([\s\S]*?)<\/script>/);
  const menu = JSON.parse(m[1]);
  // amostra (build padrao) ou cardapio completo (build --completo: todos os ativos/visiveis com foto)
  assert.ok((menu.produtos.length >= 6 && menu.produtos.length <= 10) || menu.produtos.length === 93);
  assert.equal(menu.meta.totalProdutosSnapshot, 93);
  assert.equal(menu.meta.consultaData, "11/11/2026");
  const mx = C.indexar(menu);
  const e = C.novoEstado();
  let esperado = 0;
  for (const p of menu.produtos) {
    assert.ok(menu.fotos[p.id].startsWith("data:image/webp;base64,"), "foto " + p.id);
    assert.ok(menu.categorias.some((c) => c.id === p.categoria));
    // monta a selecao minima valida: 1a variacao + opcoes ate o minimo de cada grupo
    const opcoes = [];
    for (const gid of p.grupos) {
      const g = mx.grupo(gid);
      const ops = mx.opcoesDoGrupo(gid);
      assert.ok(ops.length >= g.minimo, "opcoes suficientes para o minimo do grupo " + gid);
      for (const o of ops.slice(0, g.minimo)) opcoes.push({ opcao: o.id, quantidade: 1 });
    }
    const sel = { produto: p.id, variacao: p.variacoes[0].indice, quantidade: 2, opcoes, obs: "", retiradas: [] };
    if (p.ocultarQuantidade) sel.quantidade = 1;
    assert.equal(C.validarSelecao(mx, p, sel), null, p.nome);
    if (e.carrinho.length >= C.LIM.maxLinhasCarrinho) C.confirmarRodada(mx, e); // cardapio completo: varias rodadas
    C.adicionarAoCarrinho(mx, e, sel);
    esperado += (p.variacoes[0].centavos + opcoes.reduce((s, o) => s + mx.opcao(o.opcao).centavos, 0)) * sel.quantidade;
  }
  C.confirmarRodada(mx, e);
  assert.equal(C.totalComanda(e), esperado);
});
