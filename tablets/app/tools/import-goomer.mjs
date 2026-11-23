// Importador/validador de catalogo Goomer NORMALIZADO (salao, loja 269560). LOCAL: sem rede, sem Saipos, sem ERP.
//
// ESTADO: ainda NAO ha fonte completa. O coordenador extrai o catalogo pela UI autenticada (ver
// docs/GOOMER-EVIDENCIA-12-11.md, evidencia parcial) e grava um arquivo no formato abaixo. Este script apenas VALIDA,
// normaliza e informa o que o app de demonstracao NAO suporta. NUNCA preenche, estima ou deduz preco, codigo PDV,
// adicionais, minimos, obrigatoriedade ou restricoes. Dado ausente/invalido = erro claro e nada gravado.
//
// USO: node tools/import-goomer.mjs <entrada.json> [--loja 269560] [--saida norm.json] [--saida-app menu-app.json]
//                                   [--permitir-bloqueios] [--validar]
//      Codigos de saida: 0 ok, 1 invalido OU bloqueado para o app, 2 uso/arquivo ausente.
//      Regra suportada pelo app ausente => "bloqueio": sem --permitir-bloqueios nada e gravado e o exit e 1.
//
// CONTRATO DE ENTRADA  formato = "goomer-salao-catalogo/2"   (v2: obrigatorio, formaPreco, restricoes explicitas)
// {
//   "formato": "goomer-salao-catalogo/2",
//   "origem": { "sistema": str, "lojaId": "269560" (string), "coletadoEm": "ISO-8601 com fuso, nao futura", "metodo": str },
//   "categorias": [ { "id": int>0, "nome": str, "visivel": bool, "disponivel": bool, "restricoes": R } ],
//   "produtos":   [ { "id": int>0, "nome": str, "descricao": str, "categoriaId": int, "visivel": bool, "disponivel": bool,
//                     "fotoArquivo": str|null, "restricoes": R, "grupoIds": [int],
//                     "variacoes": [ { "id": int>0, "nome": str, "codigoPdv": str, "centavos": int>=0 } ] (>=1) } ],
//   "grupos":     [ { "id": int>0, "nome": str,
//                     "minimo": int>=0   (min_choices),
//                     "maximo": int>=1   (>= minimo),
//                     "obrigatorio": bool (required) -- SEPARADO de minimo: minimo 1 com obrigatorio=false e valido
//                                          (Goomer "Vai turbinar seu lanche hoje?": min 1, max 3, required=0),
//                     "permitirQuantidade": bool (allow_quantity),
//                     "formaPreco": "individual"|"maior"|"media" (pricing_type I/...),
//                     "selecaoPadrao": bool (is_default_selected_options),
//                     "tipo": str nao vazia (type, preservado sem interpretar),
//                     "produtoComoOpcao": bool (is_product), "opcaoDetalhada": bool (is_option_detailed) } ],
//   "opcoes":     [ { "id": int>0, "nome": str, "grupoId": int, "codigoPdv": str, "centavos": int>=0, "visivel": bool, "disponivel": bool } ]
// }
// R (restricoes) = { "horarios": X, "menus": X, "pracas": X }  com  X = { "estado": "sem-restricao"|"restrito"|"nao-coletado",
//                    "detalhe": (obrigatorio e nao vazio se "restrito"; proibido nos demais) }.
//   Horario/menu/praca NUNCA sao omitidos em silencio: ou vem "sem-restricao" (coletado e confirmado), ou "restrito"
//   com detalhe, ou "nao-coletado". O app de demonstracao NAO aplica horarios/menus/pracas => qualquer estado diferente
//   de "sem-restricao" e BLOQUEIO para uso no app.
//
// BLOQUEIOS PARA O APP (preservados no normalizado, mas impedem importacao para uso): restricoes != sem-restricao;
//   formaPreco "maior"/"media" (o motor soma cada opcao individualmente); selecaoPadrao=true (motor nao pre-seleciona);
//   produtoComoOpcao=true; opcaoDetalhada=true.
// Demais regras: centavos inteiros seguros; IDs unicos; referencias existentes; visivel/disponivel booleanos separados;
// codigoPdv texto opaco (duplicata = aviso, sem deduzir pares pai.filho); campos desconhecidos recusados.
//
// SAIDA normalizada: { formato:"cdm-salao-catalogo-normalizado/2", origem, resumo, categorias, produtos, grupos, opcoes, avisos, bloqueiosApp }
// ADAPTADOR (adaptarParaApp): converte o normalizado para o formato do motor (src/core.js) SEM tocar o contrato legado VNDX.
//   Recusa se houver bloqueios. Regra de estados NAO APROVADA (provisoria, a confirmar; o normalizado preserva visivel/disponivel de tudo, inclusive produtos visiveis pausados): so entra no app o que tem visivel E disponivel
//   (categoria, produto e opcao). Defaults do adaptador (nao vem do catalogo): ocultarObservacao=false, ocultarQuantidade=false.
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

export const FORMATO_ENTRADA = "goomer-salao-catalogo/2";
export const FORMATO_SAIDA = "cdm-salao-catalogo-normalizado/2";
export const FORMAS_PRECO = ["individual", "maior", "media"];
export const ESTADOS_RESTRICAO = ["sem-restricao", "restrito", "nao-coletado"];

const CAMPOS = {
  raiz: ["formato", "origem", "categorias", "produtos", "grupos", "opcoes"],
  origem: ["sistema", "lojaId", "coletadoEm", "metodo"],
  categoria: ["id", "nome", "visivel", "disponivel", "restricoes"],
  produto: ["id", "nome", "descricao", "categoriaId", "visivel", "disponivel", "fotoArquivo", "restricoes", "grupoIds", "variacoes"],
  variacao: ["id", "nome", "codigoPdv", "centavos"],
  grupo: ["id", "nome", "minimo", "maximo", "obrigatorio", "permitirQuantidade", "formaPreco", "selecaoPadrao", "tipo", "produtoComoOpcao", "opcaoDetalhada"],
  opcao: ["id", "nome", "grupoId", "codigoPdv", "centavos", "visivel", "disponivel"],
  restricoes: ["horarios", "menus", "pracas"],
  restricao: ["estado", "detalhe"],
};

const ehObj = (v) => v !== null && typeof v === "object" && !Array.isArray(v);
const idOk = (v) => Number.isSafeInteger(v) && v > 0;
const txt = (v) => typeof v === "string" && v.trim().length > 0;
const vazio = (d) => d === undefined || d === null || (Array.isArray(d) && d.length === 0) || (ehObj(d) && Object.keys(d).length === 0) || (typeof d === "string" && !d.trim());

export function validarCatalogo(c, { lojaId = "269560", agora = new Date() } = {}) {
  const erros = [];
  const avisos = [];
  const bloqueiosApp = [];
  const E = (m) => erros.push(m);
  const W = (m) => avisos.push(m);
  const B = (m) => bloqueiosApp.push(m);

  function campos(o, permitidos, onde, opcionais = []) {
    for (const k of Object.keys(o)) if (!permitidos.includes(k)) E(`${onde}: campo desconhecido "${k}"`);
    for (const k of permitidos) if (!(k in o) && !opcionais.includes(k)) E(`${onde}: campo obrigatorio ausente "${k}"`);
  }
  const bool = (o, k, onde) => { if (k in o && typeof o[k] !== "boolean") E(`${onde}: "${k}" deve ser boolean (true/false), recebido ${JSON.stringify(o[k])}`); };
  const dinheiro = (o, onde) => {
    if (!("centavos" in o)) return;
    if (typeof o.centavos !== "number" || !Number.isSafeInteger(o.centavos) || o.centavos < 0) E(`${onde}: "centavos" deve ser inteiro >= 0 (recebido ${JSON.stringify(o.centavos)}); preco nunca e estimado`);
    else if (o.centavos === 0) W(`${onde}: preco 0 centavo(s) - confirmar no Saipos`);
  };
  const lista = (o, k, onde) => { if (!Array.isArray(o[k])) { E(`${onde}: "${k}" deve ser lista`); return []; } return o[k]; };

  function restricoes(o, onde) {
    if (!("restricoes" in o)) return; // ausencia ja virou erro em campos()
    const r = o.restricoes;
    if (!ehObj(r)) { E(`${onde}: "restricoes" deve ser objeto com horarios/menus/pracas (nada e omitido em silencio)`); return; }
    campos(r, CAMPOS.restricoes, `${onde} restricoes`);
    for (const k of CAMPOS.restricoes) {
      if (!(k in r)) continue;
      const x = r[k];
      const w = `${onde} restricoes.${k}`;
      if (!ehObj(x)) { E(`${w}: deve ser objeto {estado, detalhe?}`); continue; }
      campos(x, CAMPOS.restricao, w, ["detalhe"]);
      if (!ESTADOS_RESTRICAO.includes(x.estado)) { E(`${w}: estado deve ser ${ESTADOS_RESTRICAO.join("|")} (recebido ${JSON.stringify(x.estado)})`); continue; }
      if (x.estado === "restrito" && vazio(x.detalhe)) E(`${w}: estado "restrito" exige detalhe nao vazio (a regra nao pode ser perdida)`);
      if (x.estado !== "restrito" && "detalhe" in x) E(`${w}: detalhe so e permitido com estado "restrito"`);
      if (x.estado !== "sem-restricao") B(`${onde}: ${k} "${x.estado}" - o app de demonstracao nao aplica ${k}`);
    }
  }

  if (!ehObj(c)) return { erros: ["raiz: JSON deve ser um objeto"], avisos, bloqueiosApp, catalogo: null };
  campos(c, CAMPOS.raiz, "raiz");
  if (c.formato !== FORMATO_ENTRADA) E(`raiz: formato deve ser "${FORMATO_ENTRADA}"`);

  if (!ehObj(c.origem)) E("origem: objeto obrigatorio");
  else {
    campos(c.origem, CAMPOS.origem, "origem");
    if (!txt(c.origem.sistema)) E('origem: "sistema" obrigatorio');
    if (!txt(c.origem.metodo)) E('origem: "metodo" obrigatorio');
    if (typeof c.origem.lojaId !== "string" || c.origem.lojaId !== String(lojaId)) E(`origem: lojaId deve ser a string "${lojaId}" (recebido ${JSON.stringify(c.origem.lojaId)})`);
    const t = typeof c.origem.coletadoEm === "string" && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:\d{2})$/.test(c.origem.coletadoEm) ? Date.parse(c.origem.coletadoEm) : NaN;
    if (Number.isNaN(t)) E('origem: "coletadoEm" deve ser ISO-8601 com fuso (ex.: 2026-11-12T15:00:00Z)');
    else if (t > agora.getTime() + 5 * 60e3) E('origem: "coletadoEm" esta no futuro');
  }

  const unico = (itens, nome) => {
    const vistos = new Set();
    for (const it of itens) {
      if (!ehObj(it)) continue;
      if (!idOk(it.id)) E(`${nome}: id deve ser inteiro > 0 (recebido ${JSON.stringify(it.id)})`);
      else if (vistos.has(it.id)) E(`${nome}: id duplicado ${it.id}`);
      else vistos.add(it.id);
    }
    return vistos;
  };
  const objs = (itens, nome) => itens.filter((i, n) => (ehObj(i) ? true : (E(`${nome}[${n}]: deve ser objeto`), false)));

  const categorias = objs(lista(c, "categorias", "raiz"), "categorias");
  const produtos = objs(lista(c, "produtos", "raiz"), "produtos");
  const grupos = objs(lista(c, "grupos", "raiz"), "grupos");
  const opcoes = objs(lista(c, "opcoes", "raiz"), "opcoes");
  if (!categorias.length) E("categorias: vazio - catalogo completo e obrigatorio (nada e preenchido por inferencia)");
  if (!produtos.length) E("produtos: vazio - catalogo completo e obrigatorio (nada e preenchido por inferencia)");

  const idsCat = unico(categorias, "categorias");
  unico(produtos, "produtos");
  const idsGrp = unico(grupos, "grupos");
  unico(opcoes, "opcoes");

  for (const x of categorias) {
    const o = `categoria ${x.id}`;
    campos(x, CAMPOS.categoria, o);
    if (!txt(x.nome)) E(`${o}: nome obrigatorio`);
    bool(x, "visivel", o); bool(x, "disponivel", o);
    restricoes(x, o);
  }

  const varIds = new Set();
  const pdvVisto = new Map();
  const marca = (cod, onde) => (pdvVisto.get(cod) || pdvVisto.set(cod, []).get(cod)).push(onde);
  for (const p of produtos) {
    const o = `produto ${p.id}`;
    campos(p, CAMPOS.produto, o);
    if (!txt(p.nome)) E(`${o}: nome obrigatorio`);
    if (typeof p.descricao !== "string") E(`${o}: descricao deve ser texto ("" se nao houver)`);
    bool(p, "visivel", o); bool(p, "disponivel", o);
    restricoes(p, o);
    if (!idsCat.has(p.categoriaId)) E(`${o}: categoriaId ${JSON.stringify(p.categoriaId)} nao existe em categorias`);
    if (p.fotoArquivo !== null && !txt(p.fotoArquivo)) E(`${o}: fotoArquivo deve ser texto ou null`);
    const gids = lista(p, "grupoIds", o);
    if (new Set(gids).size !== gids.length) E(`${o}: grupoIds com repeticao`);
    for (const g of gids) if (!idsGrp.has(g)) E(`${o}: grupoId ${JSON.stringify(g)} nao existe em grupos`);
    const vs = lista(p, "variacoes", o);
    if (!vs.length) E(`${o}: precisa de pelo menos 1 variacao`);
    for (const v of vs) {
      if (!ehObj(v)) { E(`${o}: variacao deve ser objeto`); continue; }
      const ov = `${o} variacao ${v.id}`;
      campos(v, CAMPOS.variacao, ov);
      if (!idOk(v.id)) E(`${ov}: id deve ser inteiro > 0`);
      else if (varIds.has(v.id)) E(`${ov}: id de variacao duplicado no catalogo`);
      else varIds.add(v.id);
      if (!txt(v.nome)) E(`${ov}: nome obrigatorio`);
      if (!txt(v.codigoPdv)) E(`${ov}: codigoPdv obrigatorio (texto; nunca deduzido)`);
      else marca(v.codigoPdv, ov);
      dinheiro(v, ov);
    }
  }

  const contaOpcoes = new Map();
  for (const x of opcoes) {
    const o = `opcao ${x.id}`;
    campos(x, CAMPOS.opcao, o);
    if (!txt(x.nome)) E(`${o}: nome obrigatorio`);
    if (!txt(x.codigoPdv)) E(`${o}: codigoPdv obrigatorio (texto; nunca deduzido)`);
    else marca(x.codigoPdv, o);
    bool(x, "visivel", o); bool(x, "disponivel", o);
    dinheiro(x, o);
    if (!idsGrp.has(x.grupoId)) E(`${o}: grupoId ${JSON.stringify(x.grupoId)} nao existe em grupos`);
    else contaOpcoes.set(x.grupoId, (contaOpcoes.get(x.grupoId) || 0) + 1);
  }

  let gruposMinimoOpcional = 0;
  for (const g of grupos) {
    const o = `grupo ${g.id}`;
    campos(g, CAMPOS.grupo, o);
    if (!txt(g.nome)) E(`${o}: nome obrigatorio`);
    if (!txt(g.tipo)) E(`${o}: "tipo" obrigatorio (texto preservado, nao interpretado)`);
    for (const k of ["obrigatorio", "permitirQuantidade", "selecaoPadrao", "produtoComoOpcao", "opcaoDetalhada"]) bool(g, k, o);
    const okMin = Number.isSafeInteger(g.minimo) && g.minimo >= 0;
    const okMax = Number.isSafeInteger(g.maximo) && g.maximo >= 1;
    if (!okMin) E(`${o}: minimo deve ser inteiro >= 0 (recebido ${JSON.stringify(g.minimo)})`);
    if (!okMax) E(`${o}: maximo deve ser inteiro >= 1 (recebido ${JSON.stringify(g.maximo)})`);
    if (okMin && okMax && g.minimo > g.maximo) E(`${o}: minimo (${g.minimo}) maior que maximo (${g.maximo})`);
    if (okMin && g.permitirQuantidade === false && g.minimo > (contaOpcoes.get(g.id) || 0)) E(`${o}: minimo ${g.minimo} impossivel de atender com ${contaOpcoes.get(g.id) || 0} opcao(oes)`);
    if (!(contaOpcoes.get(g.id) > 0)) E(`${o}: grupo sem nenhuma opcao`);
    // obrigatorio e minimo sao independentes: nunca se deduz um do outro
    if (g.obrigatorio === true && okMin && g.minimo === 0) W(`${o}: obrigatorio=true com minimo 0 - confirmar na UI Goomer`);
    if (g.obrigatorio === false && okMin && g.minimo > 0) gruposMinimoOpcional += 1;
    if (!("formaPreco" in g)) { /* ausencia ja e erro */ }
    else if (!FORMAS_PRECO.includes(g.formaPreco)) E(`${o}: formaPreco deve ser ${FORMAS_PRECO.join("|")} (recebido ${JSON.stringify(g.formaPreco)})`);
    else if (g.formaPreco !== "individual") B(`${o}: formaPreco "${g.formaPreco}" nao suportada pelo motor do app (soma cada opcao individualmente)`);
    if (g.selecaoPadrao === true) B(`${o}: selecaoPadrao=true nao suportada (o app nao pre-seleciona opcoes)`);
    if (g.produtoComoOpcao === true) B(`${o}: produtoComoOpcao=true nao suportado`);
    if (g.opcaoDetalhada === true) B(`${o}: opcaoDetalhada=true nao suportada`);
  }

  for (const [cod, onde] of pdvVisto) if (onde.length > 1) W(`codigoPdv "${cod}" repetido em: ${onde.join("; ")} - validar pares pai.filho no Saipos`);

  if (erros.length) return { erros, avisos, bloqueiosApp, catalogo: null };
  const catalogo = {
    formato: FORMATO_SAIDA,
    origem: { ...c.origem },
    resumo: { categorias: categorias.length, produtos: produtos.length, variacoes: varIds.size, grupos: grupos.length, opcoes: opcoes.length,
      visiveis: produtos.filter((p) => p.visivel).length, disponiveis: produtos.filter((p) => p.disponivel).length, gruposMinimoOpcional },
    categorias, produtos, grupos, opcoes, avisos, bloqueiosApp,
  };
  return { erros, avisos, bloqueiosApp, catalogo };
}

// Converte o catalogo normalizado para o formato do motor do app (contrato VNDX/legado intacto: aqui so se ADICIONA
// "obrigatorio"). Recusa se houver bloqueios ou se a regra provisoria de estados quebrar um grupo.
export function adaptarParaApp(cat) {
  if (!cat || cat.formato !== FORMATO_SAIDA) throw new Error(`adaptarParaApp: esperado ${FORMATO_SAIDA}`);
  if (cat.bloqueiosApp.length) throw new Error("Importacao bloqueada para uso no app:\n - " + cat.bloqueiosApp.join("\n - "));
  const ok = (x) => x.visivel && x.disponivel;
  const catsOk = new Map(cat.categorias.filter(ok).map((x) => [x.id, x]));
  const produtos = cat.produtos.filter((p) => ok(p) && catsOk.has(p.categoriaId));
  const gruposUsados = new Set(produtos.flatMap((p) => p.grupoIds));
  const opcoes = cat.opcoes.filter((o) => ok(o) && gruposUsados.has(o.grupoId));
  const contagem = new Map();
  for (const o of opcoes) contagem.set(o.grupoId, (contagem.get(o.grupoId) || 0) + 1);
  const grupos = cat.grupos.filter((g) => gruposUsados.has(g.id));
  for (const g of grupos) {
    const n = contagem.get(g.id) || 0;
    if (n === 0) throw new Error(`Importacao bloqueada: grupo ${g.id} ficou sem opcoes visiveis/disponiveis`);
    if (!g.permitirQuantidade && g.minimo > n) throw new Error(`Importacao bloqueada: grupo ${g.id} exige minimo ${g.minimo} mas so ha ${n} opcao(oes) visivel(eis)/disponivel(eis)`);
  }
  const usadas = new Set(produtos.map((p) => p.categoriaId));
  const brt = new Date(Date.parse(cat.origem.coletadoEm) - 3 * 3600e3);
  const pad = (n) => String(n).padStart(2, "0");
  return {
    meta: { origem: cat.origem.sistema, lojaId: cat.origem.lojaId, coletadoEm: cat.origem.coletadoEm, consultaData: `${pad(brt.getUTCDate())}/${pad(brt.getUTCMonth() + 1)}/${brt.getUTCFullYear()}`,
      totalProdutosSnapshot: cat.produtos.length, amostra: produtos.length,
      regraEstados: "NAO APROVADA (provisoria): so visivel E disponivel entra no app; a decisao sobre pausados visiveis esta pendente",
      excluidos: {
        produtosInvisiveis: cat.produtos.filter((p) => !p.visivel).map((p) => p.id),
        produtosVisiveisPausados: cat.produtos.filter((p) => p.visivel && !p.disponivel).map((p) => p.id),
        produtosEmCategoriaExcluida: cat.produtos.filter((p) => ok(p) && !catsOk.has(p.categoriaId)).map((p) => p.id),
        opcoesInvisiveis: cat.opcoes.filter((o) => !o.visivel).map((o) => o.id),
        opcoesVisiveisPausadas: cat.opcoes.filter((o) => o.visivel && !o.disponivel).map((o) => o.id),
      } },
    categorias: cat.categorias.filter((x) => usadas.has(x.id)).map((x) => ({ id: x.id, nome: x.nome })),
    produtos: produtos.map((p) => ({ id: p.id, nome: p.nome, descricao: p.descricao, categoria: p.categoriaId,
      variacoes: p.variacoes.map((v) => ({ indice: v.id, nome: v.nome, centavos: v.centavos, codigoPdv: v.codigoPdv })),
      grupos: p.grupoIds, ingredientes: [], ocultarObservacao: false, ocultarQuantidade: false })),
    grupos: grupos.map((g) => ({ id: g.id, nome: g.nome, minimo: g.minimo, maximo: g.maximo, obrigatorio: g.obrigatorio, permitirQuantidade: g.permitirQuantidade })),
    opcoes: opcoes.map((o, i) => ({ id: o.id, nome: o.nome, grupo: o.grupoId, descricao: "", centavos: o.centavos, posicao: i, codigoPdv: o.codigoPdv })),
    fotos: {},
  };
}

function cli(argv) {
  const args = argv.slice(2);
  const comValor = ["--loja", "--saida", "--saida-app"];
  const val = (nome) => { const i = args.indexOf(nome); return i >= 0 ? args[i + 1] : undefined; };
  const entrada = args.find((a, i) => !a.startsWith("--") && (i === 0 || !comValor.includes(args[i - 1])));
  const loja = val("--loja") || "269560";
  if (!entrada) { console.error("FALHA: informe o arquivo de entrada. Nao ha fonte completa embutida; o catalogo vem da extracao autenticada do coordenador.\nUso: node tools/import-goomer.mjs <entrada.json> [--loja 269560] [--saida arquivo.json] [--saida-app menu.json] [--permitir-bloqueios] [--validar]"); return 2; }
  if (!fs.existsSync(entrada)) { console.error(`FALHA: fonte completa ausente: ${entrada}. Nenhum dado foi inferido ou preenchido.`); return 2; }
  let obj;
  try { obj = JSON.parse(fs.readFileSync(entrada, "utf8")); } catch (e) { console.error(`FALHA: JSON ilegivel: ${e.message}`); return 2; }
  const r = validarCatalogo(obj, { lojaId: loja });
  for (const w of r.avisos) console.warn("AVISO:", w);
  if (r.erros.length) { console.error(`INVALIDO (${r.erros.length} erro(s)); nada gravado:`); for (const e of r.erros) console.error(" -", e); return 1; }
  console.log("VALIDO:", JSON.stringify(r.catalogo.resumo));
  const bloqueado = r.bloqueiosApp.length > 0;
  if (bloqueado) {
    console.error(`BLOQUEADO PARA USO NO APP (${r.bloqueiosApp.length}):`);
    for (const b of r.bloqueiosApp) console.error(" -", b);
    if (!args.includes("--permitir-bloqueios")) { console.error("Nada gravado. Use --permitir-bloqueios so para gerar o normalizado (sem menu para o app)."); return 1; }
  }
  const validarApenas = args.includes("--validar");
  const saida = val("--saida");
  if (saida && !validarApenas) {
    fs.mkdirSync(path.dirname(path.resolve(saida)), { recursive: true });
    fs.writeFileSync(saida, JSON.stringify(r.catalogo, null, 2));
    console.log("Normalizado gravado:", saida);
  }
  const saidaApp = val("--saida-app");
  if (saidaApp && !validarApenas) {
    if (bloqueado) { console.error("Menu do app NAO gerado: ha bloqueios."); return 1; }
    let menu;
    try { menu = adaptarParaApp(r.catalogo); } catch (e) { console.error(e.message); return 1; }
    fs.mkdirSync(path.dirname(path.resolve(saidaApp)), { recursive: true });
    fs.writeFileSync(saidaApp, JSON.stringify(menu, null, 2));
    console.log("Menu para o app gravado:", saidaApp);
  }
  return 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) process.exitCode = cli(process.argv);
