// Testes do validador/adaptador de catalogo Goomer (contrato /2). Fixture ESTRITAMENTE SINTETICA
// (tests/fixtures/catalogo-sintetico.json); nenhum dado real. Evidencia estrutural: docs/GOOMER-EVIDENCIA-12-11.md.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { validarCatalogo, adaptarParaApp, FORMATO_SAIDA } from "../tools/import-goomer.mjs";

const raiz = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const C = createRequire(import.meta.url)(path.join(raiz, "src", "core.js"));
const fixture = JSON.parse(fs.readFileSync(path.join(raiz, "tests", "fixtures", "catalogo-sintetico.json"), "utf8"));
const clone = () => JSON.parse(JSON.stringify(fixture));
const AGORA = new Date("2026-11-12T12:00:00Z");
const v = (c, o = {}) => validarCatalogo(c, { agora: AGORA, ...o });
const falha = (c, re, o) => { const r = v(c, o); assert.ok(r.erros.length > 0, "deveria falhar: " + re); assert.ok(r.erros.some((e) => re.test(e)), `esperava ${re} em: ${r.erros.join(" | ")}`); assert.equal(r.catalogo, null); };
const ok = (c) => { const r = v(c); assert.deepEqual(r.erros, []); return r; };
const sel = (variacao, opcoes) => ({ variacao, quantidade: 1, obs: "", retiradas: [], opcoes: opcoes.map((id) => ({ opcao: id, quantidade: 1 })) });

test("fixture sintetica valida; visivel e disponivel permanecem separados; sem bloqueios", () => {
  assert.match(fixture.origem.sistema, /SINTETICO/);
  const r = ok(clone());
  assert.equal(r.catalogo.formato, FORMATO_SAIDA);
  assert.deepEqual(r.catalogo.resumo, { categorias: 2, produtos: 3, variacoes: 4, grupos: 2, opcoes: 5, visiveis: 2, disponiveis: 2, gruposMinimoOpcional: 1 });
  assert.deepEqual(r.bloqueiosApp, []);
  const p1 = r.catalogo.produtos.find((p) => p.id === 9101);
  assert.equal(p1.visivel, true);
  assert.equal(p1.disponivel, false);
  assert.ok(r.avisos.some((a) => /preco 0/.test(a)));
});

test("sem fonte/dados completos: falha clara, nada preenchido", () => {
  falha(null, /objeto/);
  falha({}, /obrigatorio ausente/);
  const vazio = clone(); vazio.produtos = []; vazio.categorias = [];
  falha(vazio, /vazio - catalogo completo/);
  const semPreco = clone(); delete semPreco.produtos[0].variacoes[0].centavos;
  falha(semPreco, /ausente "centavos"/);
  const semPdv = clone(); delete semPdv.produtos[0].variacoes[0].codigoPdv;
  falha(semPdv, /codigoPdv/);
  const pdvVazio = clone(); pdvVazio.opcoes[0].codigoPdv = "  ";
  falha(pdvVazio, /codigoPdv obrigatorio/);
  const v1 = clone(); v1.formato = "goomer-salao-catalogo/1";
  falha(v1, /formato deve ser "goomer-salao-catalogo\/2"/);
});

test("centavos: somente inteiros seguros nao negativos", () => {
  for (const ruim of [10.5, "1000", -1, null, Number.NaN, Number.MAX_SAFE_INTEGER + 2, 33.99]) {
    const c = clone(); c.produtos[0].variacoes[0].centavos = ruim;
    falha(c, /centavos.*inteiro/);
  }
  const o = clone(); o.opcoes[0].centavos = 1.5;
  falha(o, /opcao 9401.*centavos/);
});

test("ids unicos e referencias existentes", () => {
  const dupProd = clone(); dupProd.produtos[1].id = 9101; falha(dupProd, /produtos: id duplicado 9101/);
  const dupVar = clone(); dupVar.produtos[1].variacoes[0].id = 9201; falha(dupVar, /id de variacao duplicado/);
  const dupCat = clone(); dupCat.categorias[1].id = 9001; falha(dupCat, /categorias: id duplicado/);
  const idRuim = clone(); idRuim.opcoes[0].id = 0; falha(idRuim, /opcoes: id deve ser inteiro/);
  const idStr = clone(); idStr.grupos[0].id = "9301"; falha(idStr, /grupos: id deve ser inteiro/);
  const catX = clone(); catX.produtos[0].categoriaId = 1; falha(catX, /categoriaId.*nao existe/);
  const grpX = clone(); grpX.produtos[0].grupoIds = [123]; falha(grpX, /grupoId 123 nao existe/);
  const opcX = clone(); opcX.opcoes[0].grupoId = 77; falha(opcX, /opcao 9401: grupoId 77 nao existe/);
  const semVar = clone(); semVar.produtos[0].variacoes = []; falha(semVar, /pelo menos 1 variacao/);
});

test("grupos: minimo/maximo coerentes e atendiveis", () => {
  const inv = clone(); inv.grupos[0].minimo = 3; inv.grupos[0].maximo = 2; falha(inv, /minimo \(3\) maior que maximo \(2\)/);
  const neg = clone(); neg.grupos[1].minimo = -1; falha(neg, /minimo deve ser inteiro >= 0/);
  const zero = clone(); zero.grupos[1].maximo = 0; falha(zero, /maximo deve ser inteiro >= 1/);
  const frac = clone(); frac.grupos[0].maximo = 1.5; falha(frac, /maximo deve ser inteiro/);
  const imposs = clone(); imposs.grupos[0].minimo = 3; imposs.grupos[0].maximo = 3; falha(imposs, /impossivel de atender com 2 opcao/);
  const atende = clone(); atende.grupos[0].minimo = 2; atende.grupos[0].maximo = 2; ok(atende);
});

test("estados visivel/disponivel: somente boolean, nunca deduzidos nem convertidos", () => {
  for (const ruim of ["Visivel", "true", 1, null]) {
    const p = clone(); p.produtos[0].visivel = ruim; falha(p, /"visivel" deve ser boolean/);
  }
  const d = clone(); d.opcoes[0].disponivel = "Indisponivel"; falha(d, /"disponivel" deve ser boolean/);
  const falta = clone(); delete falta.categorias[0].disponivel; falha(falta, /"disponivel"/);
});

test("origem, data e loja", () => {
  const loja = clone(); loja.origem.lojaId = "270370"; falha(loja, /lojaId deve ser a string "269560"/);
  const lojaNum = clone(); lojaNum.origem.lojaId = 269560; falha(lojaNum, /lojaId/);
  falha(clone(), /lojaId deve ser a string "111"/, { lojaId: "111" });
  const semData = clone(); delete semData.origem.coletadoEm; falha(semData, /coletadoEm/);
  const dataRuim = clone(); dataRuim.origem.coletadoEm = "12/11/2026"; falha(dataRuim, /ISO-8601/);
  const semFuso = clone(); semFuso.origem.coletadoEm = "2026-11-12T10:00:00"; falha(semFuso, /ISO-8601/);
  const futura = clone(); futura.origem.coletadoEm = "2027-01-01T00:00:00Z"; falha(futura, /futuro/);
  const sis = clone(); sis.origem.sistema = ""; falha(sis, /sistema/);
  const met = clone(); delete met.origem.metodo; falha(met, /metodo/);
});

test("campos desconhecidos sao recusados e codigoPdv repetido vira aviso (sem deduzir pares)", () => {
  const extra = clone(); extra.produtos[0].precoSugerido = 1; falha(extra, /campo desconhecido "precoSugerido"/);
  const rep = clone(); rep.opcoes[0].codigoPdv = "SINT-0001";
  const r = ok(rep);
  assert.ok(r.avisos.some((a) => /SINT-0001.*repetido.*Saipos/.test(a)));
});

test("obrigatorio e campo SEPARADO de minimo (evidencia Goomer: min 1, max 3, required=0)", () => {
  const r = ok(clone());
  const g = r.catalogo.grupos.find((x) => x.id === 9302);
  assert.equal(g.minimo, 1);
  assert.equal(g.maximo, 3);
  assert.equal(g.obrigatorio, false); // preservado, nao virou obrigatorio
  assert.equal(r.catalogo.grupos.find((x) => x.id === 9301).obrigatorio, true);
  const sem = clone(); delete sem.grupos[1].obrigatorio; falha(sem, /ausente "obrigatorio"/);
  for (const ruim of ["false", 0, null]) { const c = clone(); c.grupos[1].obrigatorio = ruim; falha(c, /"obrigatorio" deve ser boolean/); }
  const aviso = clone(); aviso.grupos[1].obrigatorio = true; aviso.grupos[1].minimo = 0;
  assert.ok(ok(aviso).avisos.some((a) => /obrigatorio=true com minimo 0/.test(a)));
});

test("formaPreco, selecaoPadrao, tipo e flags: preservados; nao suportados bloqueiam o app", () => {
  for (const f of ["maior", "media"]) {
    const c = clone(); c.grupos[1].formaPreco = f;
    const r = ok(c);
    assert.equal(r.catalogo.grupos[1].formaPreco, f); // preservado
    assert.ok(r.bloqueiosApp.some((b) => b.includes(`formaPreco "${f}"`)));
    assert.throws(() => adaptarParaApp(r.catalogo), /bloqueada para uso no app/);
  }
  const ruim = clone(); ruim.grupos[1].formaPreco = "soma"; falha(ruim, /formaPreco deve ser individual\|maior\|media/);
  const semFp = clone(); delete semFp.grupos[1].formaPreco; falha(semFp, /ausente "formaPreco"/);
  const sp = clone(); sp.grupos[0].selecaoPadrao = true;
  assert.ok(ok(sp).bloqueiosApp.some((b) => /selecaoPadrao=true/.test(b)));
  const pc = clone(); pc.grupos[0].produtoComoOpcao = true;
  assert.ok(ok(pc).bloqueiosApp.some((b) => /produtoComoOpcao/.test(b)));
  const od = clone(); od.grupos[0].opcaoDetalhada = true;
  assert.ok(ok(od).bloqueiosApp.some((b) => /opcaoDetalhada/.test(b)));
  const tp = clone(); tp.grupos[0].tipo = ""; falha(tp, /"tipo" obrigatorio/);
  const q = clone(); q.grupos[1].permitirQuantidade = 0; falha(q, /permitirQuantidade/);
  const q2 = clone(); q2.grupos[1].permitirQuantidade = true; assert.equal(ok(q2).catalogo.grupos[1].permitirQuantidade, true); // quantidade preservada
});

test("horarios/menus/pracas: nunca omitidos em silencio; restricao ou nao-coletado bloqueia o app", () => {
  const sem = clone(); delete sem.produtos[0].restricoes; falha(sem, /ausente "restricoes"/);
  const semCat = clone(); delete semCat.categorias[0].restricoes; falha(semCat, /categoria 9001: campo obrigatorio ausente "restricoes"/);
  const faltaH = clone(); delete faltaH.produtos[0].restricoes.horarios; falha(faltaH, /ausente "horarios"/);
  const obj = clone(); obj.produtos[0].restricoes = "sem-restricao"; falha(obj, /"restricoes" deve ser objeto/);
  const est = clone(); est.produtos[0].restricoes.menus.estado = "talvez"; falha(est, /estado deve ser sem-restricao\|restrito\|nao-coletado/);
  const semDet = clone(); semDet.produtos[0].restricoes.horarios = { estado: "restrito" }; falha(semDet, /exige detalhe nao vazio/);
  const detVazio = clone(); detVazio.produtos[0].restricoes.horarios = { estado: "restrito", detalhe: [] }; falha(detVazio, /exige detalhe nao vazio/);
  const detIndevido = clone(); detIndevido.produtos[0].restricoes.pracas = { estado: "sem-restricao", detalhe: ["x"] }; falha(detIndevido, /detalhe so e permitido/);

  const rest = clone(); rest.produtos[2].restricoes.horarios = { estado: "restrito", detalhe: { dias: "SINTETICO" } };
  const r = ok(rest);
  assert.deepEqual(r.catalogo.produtos[2].restricoes.horarios.detalhe, { dias: "SINTETICO" }); // preservado
  assert.ok(r.bloqueiosApp.some((b) => /produto 9103: horarios "restrito"/.test(b)));
  assert.throws(() => adaptarParaApp(r.catalogo), /bloqueada para uso no app/);

  const nc = clone(); nc.produtos[2].restricoes.menus = { estado: "nao-coletado" };
  assert.ok(ok(nc).bloqueiosApp.some((b) => /produto 9103: menus "nao-coletado"/.test(b)));
  const pc = clone(); pc.categorias[0].restricoes.pracas = { estado: "restrito", detalhe: ["SINTETICA"] };
  assert.ok(ok(pc).bloqueiosApp.some((b) => /categoria 9001: pracas "restrito"/.test(b)));
});

test("adaptador para o motor: so visivel E disponivel (regra provisoria); min1+obrigatorio=false permite 0", () => {
  const cat = ok(clone()).catalogo;
  const menu = adaptarParaApp(cat);
  assert.deepEqual(menu.produtos.map((p) => p.id), [9103]);          // 9101 indisponivel, 9102 invisivel
  assert.deepEqual(menu.categorias.map((c) => c.id), [9001]);
  assert.deepEqual(menu.opcoes.map((o) => o.id), [9401, 9404, 9405]); // 9402 indisponivel, 9403 invisivel
  assert.equal(menu.grupos.find((g) => g.id === 9302).obrigatorio, false);
  assert.equal(menu.meta.totalProdutosSnapshot, 3);
  // o normalizado PRESERVA o estado dos visiveis pausados; o adaptador so os deixa de fora e diz quais (regra nao aprovada)
  const pausado = cat.produtos.find((p) => p.id === 9101);
  assert.equal(pausado.visivel, true);
  assert.equal(pausado.disponivel, false);
  assert.deepEqual(menu.meta.excluidos.produtosVisiveisPausados, [9101]);
  assert.deepEqual(menu.meta.excluidos.produtosInvisiveis, [9102]);
  assert.deepEqual(menu.meta.excluidos.opcoesVisiveisPausadas, [9402]);
  assert.deepEqual(menu.meta.excluidos.opcoesInvisiveis, [9403]);
  assert.match(menu.meta.regraEstados, /NAO APROVADA/);
  assert.equal(menu.produtos[0].variacoes[0].centavos, 1500);       // preco do catalogo, sem alteracao
  assert.equal(menu.produtos[0].variacoes[0].codigoPdv, "SINT-0004");
  const ix = C.indexar(menu);
  const p = ix.produto(9103);
  assert.equal(C.validarSelecao(ix, p, sel(9204, [9401])), null);         // zero em 9302: permitido
  assert.match(C.validarSelecao(ix, p, sel(9204, [])), /pelo menos 1/);   // 9301 obrigatorio
  assert.equal(C.validarSelecao(ix, p, sel(9204, [9401, 9404])), null);
  assert.equal(C.totalSelecao(ix, p, sel(9204, [9401, 9404])), 1500 + 0 + 300);
  assert.equal(C.validarSelecao(ix, p, sel(9204, [9401, 9404, 9405])), null); // ate maximo 3
});

test("adaptador + motor: minimo 2 opcional -> zero ok, 1 recusado, 2 ok", () => {
  const c = clone(); c.grupos[1].minimo = 2; c.grupos[1].maximo = 3;
  const menu = adaptarParaApp(ok(c).catalogo);
  const ix = C.indexar(menu);
  const p = ix.produto(9103);
  assert.equal(C.validarSelecao(ix, p, sel(9204, [9401])), null);
  assert.match(C.validarSelecao(ix, p, sel(9204, [9401, 9404])), /opcional.*pelo menos 2/);
  assert.equal(C.validarSelecao(ix, p, sel(9204, [9401, 9404, 9405])), null);
});

test("adaptador recusa quando a regra de estados deixa o grupo inatendivel", () => {
  const c1 = clone(); c1.opcoes.find((o) => o.id === 9404).disponivel = false; c1.opcoes.find((o) => o.id === 9405).disponivel = false;
  assert.throws(() => adaptarParaApp(ok(c1).catalogo), /grupo 9302 ficou sem opcoes/);
  const c2 = clone(); c2.grupos[1].minimo = 3; c2.grupos[1].maximo = 3; // opcoes visiveis+disponiveis restantes: 9404 e 9405 (9403 invisivel)
  assert.throws(() => adaptarParaApp(ok(c2).catalogo), /exige minimo 3 mas so ha 2/);
  assert.throws(() => adaptarParaApp({ formato: "x" }), /esperado/);
});

test("CLI: sem arquivo (2), fixture valida (0), bloqueado para o app (1, nada gravado), com --permitir-bloqueios grava so o normalizado", () => {
  const script = path.join(raiz, "tools", "import-goomer.mjs");
  const run = (...a) => spawnSync(process.execPath, [script, ...a], { encoding: "utf8" });
  const sem = run();
  assert.equal(sem.status, 2);
  assert.match(sem.stderr, /Nao ha fonte completa/);
  const ausente = run(path.join(raiz, "tests", "fixtures", "nao-existe.json"));
  assert.equal(ausente.status, 2);
  assert.match(ausente.stderr, /fonte completa ausente/);
  const fx = path.join(raiz, "tests", "fixtures", "catalogo-sintetico.json");
  const valido = run(fx, "--validar");
  assert.equal(valido.status, 0, valido.stderr);
  assert.match(valido.stdout, /VALIDO/);

  const tmp = fs.mkdtempSync(path.join(raiz, "tests", ".tmp-"));
  try {
    const bloq = clone(); bloq.grupos[1].formaPreco = "media";
    const entrada = path.join(tmp, "bloqueado.json");
    fs.writeFileSync(entrada, JSON.stringify(bloq));
    const saida = path.join(tmp, "norm.json");
    const menuApp = path.join(tmp, "menu.json");
    const r1 = run(entrada, "--saida", saida, "--saida-app", menuApp);
    assert.equal(r1.status, 1);
    assert.match(r1.stderr, /BLOQUEADO PARA USO NO APP/);
    assert.equal(fs.existsSync(saida), false);
    assert.equal(fs.existsSync(menuApp), false);
    const r2 = run(entrada, "--saida", saida, "--saida-app", menuApp, "--permitir-bloqueios");
    assert.equal(r2.status, 1); // menu do app continua recusado
    assert.equal(fs.existsSync(saida), true);
    assert.equal(fs.existsSync(menuApp), false);
    const okOut = path.join(tmp, "ok-menu.json");
    const r3 = run(fx, "--saida-app", okOut);
    assert.equal(r3.status, 0, r3.stderr);
    assert.deepEqual(JSON.parse(fs.readFileSync(okOut, "utf8")).produtos.map((p) => p.id), [9103]);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});
