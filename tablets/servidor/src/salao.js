// Servidor do salao (MODO TESTE): tablets das mesas -> rodada -> tela da cozinha de teste
// e, no modo --sandbox, -> loja TESTE do Saipos ("Cidadao do Mundo - HML" [93936]) pelo conector do totem.
// Nada e cobrado. Nunca usa loja real. Nunca expoe segredo/token/idPartner/codigos Saipos ao navegador.
// Sem dependencias externas (Node 18+).

import http from "node:http";
import os from "node:os";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { randomBytes, randomUUID, createHash, timingSafeEqual } from "node:crypto";

import { montarMenu } from "../../app/tools/menu.mjs";
import { carregarDto, carregarMapa, montarVisao, validarCarrinho, motivoIndisponivel } from "../../../totem/app/src/cardapio-hml.js";
import { resolverCaminhos, carregarMeta, lerSegredo } from "../../../totem/saipos-teste/src/config.js";
import { criarHttp } from "../../../totem/saipos-teste/src/http.js";
import { obterToken } from "../../../totem/saipos-teste/src/auth.js";
import { pedirLinkCatalogo, baixarCatalogo } from "../../../totem/saipos-teste/src/catalogo.js";
import { carregarCatalogo } from "../../../totem/saipos-teste/src/payload.js";
import { prepararCarrinho, enviarCarrinho, MAX_ITENS as MAX_ITENS_SAIPOS } from "../../../totem/saipos-teste/src/carrinho.js";
import { ErroConector, resumirErroApi } from "../../../totem/saipos-teste/src/erros.js";
import { lerJsonOpcional, gravarJsonAtomico } from "../../../totem/saipos-teste/src/arquivos.js";

const require = createRequire(import.meta.url);
const C = require("../../app/src/core.js");
const SaiposMesa = require("../../app/src/saipos-payload.cjs");

const AQUI = fileURLToPath(new URL(".", import.meta.url));
const APP = join(AQUI, "..", "..", "app");
const TOTEM_APP = join(AQUI, "..", "..", "..", "totem", "app");
const PACOTE_CONECTOR = join(AQUI, "..", "..", "..", "totem", "saipos-teste");
const PUBLIC = join(AQUI, "..", "public");

export const COD_STORE_TESTE = "ef2dc467-a4a8-4734-a4d7-eb3442ff3401"; // unica loja permitida (HML 93936)
export const PAGAMENTO_CODIGO = "DIN"; // metadado de teste conferido no canal HML; nada e cobrado
export const SENHA_INICIAL = 7001; // faixa propria dos tablets (o totem usa 92xx)
export const STATUS = { local: "Na cozinha de teste", saipos: "Na cozinha e no Saipos (teste)", conferir: "Na cozinha · Saipos a conferir", enviando: "Na cozinha · enviando ao Saipos", aguardandoPagamento: "Aguardando pagamento" };
// Formas aceitas no pagamento de TESTE (simulado). Com o e.Rede liberado, o mesmo fluxo usa o checkout real.
export const FORMAS_PAGAMENTO = { pix: "Pix", credito: "Crédito", debito: "Débito", applepay: "Apple Pay", googlepay: "Google Pay" };
const TOKEN_PAG = /^[0-9a-f]{32}$/;
const LIMITE_CORPO = 48 * 1024;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const PREPARO = ["NOVO", "PREPARANDO", "PRONTO", "ENTREGUE"];
const FOTO = /^\/fotos\/p(\d{1,8})\.webp$/;

// Pix "copia e cola" estatico (BR Code do Banco Central) com valor fixo. Nao confirma sozinho: a equipe confere no app do banco.
const semAcento = (t, max) => String(t ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^A-Za-z0-9 .\-]/g, "").trim().toUpperCase().slice(0, max);
export function crc16(txt) {
  let c = 0xffff;
  for (const b of Buffer.from(txt, "utf8")) { c ^= b << 8; for (let i = 0; i < 8; i++) c = c & 0x8000 ? ((c << 1) ^ 0x1021) & 0xffff : (c << 1) & 0xffff; }
  return c.toString(16).toUpperCase().padStart(4, "0");
}
export function lerPixConfig(o) {
  if (!o) return null;
  const chave = String(o.chave ?? "").trim(), nome = semAcento(o.nome, 25), cidade = semAcento(o.cidade, 15);
  if (!chave || chave.length > 77 || !nome || !cidade) throw new ErroConector("PIX_INVALIDO", "Configuração do Pix incompleta (chave, nome e cidade).");
  return { chave, nome, cidade };
}
export function pixCopiaECola(cfg, valorCentavos, txid) {
  const f = (id, v) => id + String(v.length).padStart(2, "0") + v;
  const tx = String(txid ?? "").replace(/[^A-Za-z0-9]/g, "").slice(0, 25) || "***";
  const corpo = f("00", "01") + f("26", f("00", "br.gov.bcb.pix") + f("01", cfg.chave)) + f("52", "0000") + f("53", "986")
    + f("54", (valorCentavos / 100).toFixed(2)) + f("58", "BR") + f("59", cfg.nome) + f("60", cfg.cidade) + f("62", f("05", tx)) + "6304";
  return corpo + crc16(corpo);
}

export class ErroSalao extends Error {
  constructor(status, mensagem) { super(mensagem); this.status = status; }
}
const bad = (m) => new ErroSalao(400, m);
const objeto = (x) => !!x && typeof x === "object" && !Array.isArray(x);
const so = (o, permitidas, exigidas = permitidas) => objeto(o) && Object.keys(o).every((k) => permitidas.includes(k)) && exigidas.every((k) => k in o);

function ordenar(v) {
  if (Array.isArray(v)) return v.map(ordenar);
  if (objeto(v)) return Object.fromEntries(Object.keys(v).sort().map((k) => [k, ordenar(v[k])]));
  return v;
}
const hash = (v) => createHash("sha256").update(JSON.stringify(ordenar(v))).digest("hex");

export const chaveOcupacao = (o) => (o.modalidade === "mesa" ? `mesa:${o.mesa}` : `comanda:${o.comanda}`);
export function lerChaveOcupacao(txt) {
  const m = /^(mesa|comanda):(.{1,12})$/.exec(String(txt ?? ""));
  if (!m) throw bad("Mesa/comanda inválida.");
  return lerOcupacao(m[1] === "mesa" ? { modalidade: "mesa", mesa: m[2], comanda: null } : { modalidade: "comanda", mesa: null, comanda: m[2] });
}

export function rotuloOcupacao(o) {
  return o.modalidade === "mesa" ? `MESA ${o.mesa}` : `COMANDA ${o.comanda}`;
}

export function lerOcupacao(o) {
  if (!objeto(o)) throw bad("Mesa/comanda ausente.");
  if (o.modalidade === "mesa") {
    const m = C.normalizarMesa(o.mesa);
    if (m === null || (o.comanda !== null && o.comanda !== undefined)) throw bad("Mesa inválida.");
    return { modalidade: "mesa", mesa: m, comanda: null };
  }
  if (o.modalidade === "comanda") {
    const c = C.normalizarComanda(o.comanda);
    if (c === null || (o.mesa !== null && o.mesa !== undefined)) throw bad("Comanda inválida.");
    return { modalidade: "comanda", mesa: null, comanda: c };
  }
  throw bad("Modalidade inválida.");
}

// ---------- cardapio ----------

// Le o cadastro do totem e monta: dto (regras/horarios do totem) + menu no formato do tablet (todos os ativos/visiveis com foto).
export async function carregarCardapio({ gamaPath = join(TOTEM_APP, "data", "gama-cardapio.json"), fotosDir = join(TOTEM_APP, "public", "gama-fotos") } = {}) {
  const j = JSON.parse(await readFile(gamaPath, "utf8"));
  const dto = await carregarDto(gamaPath);
  const fotoArq = (p) => (p.fotoLocal ? join(fotosDir, p.fotoLocal.replace(/^\/gama-fotos\//, "")) : null);
  const elegiveis = j.produtos.filter((p) => p.ativo && p.visivel && fotoArq(p) && existsSync(fotoArq(p)));
  const menu = montarMenu(j, elegiveis);
  return { j, dto, menu, fotosDir };
}

// Produtos que o tablet pode mostrar AGORA (horario do cadastro + no sandbox, tudo mapeado na loja TESTE).
export function menuDisponivel(cardapio, data, permitidos = null) {
  const { dto, menu } = cardapio;
  const ok = (p) => motivoIndisponivel(dto, dto.produtos.get(p.id), data) === null && (!permitidos || permitidos.has(p.id));
  const produtos = menu.produtos.filter(ok);
  const cats = new Set(produtos.map((p) => p.categoria));
  return { ...menu, produtos, categorias: menu.categorias.filter((c) => cats.has(c.id)), meta: { ...menu.meta, amostra: produtos.length } };
}

// No sandbox: so produtos com TODAS as variacoes ligadas ao catalogo HML. Uma opcao ainda sem ligacao e recusada
// no envio (409 "ainda estamos preparando este item"), sem chegar ao Saipos.
export function produtosProntosNoSaipos(ctx, data) {
  const visao = montarVisao(ctx, data);
  return new Set(visao.produtos.filter((p) => p.variacoes.every((v) => v.pronto)).map((p) => p.id));
}

// Valida a rodada contra o cardapio (precos SEMPRE do servidor). Retorna linhas normalizadas + resumo para a cozinha.
export function validarRodada(cardapio, corpo, data, permitidos = null) {
  if (!so(corpo, ["idempotencyKey", "ocupacao", "numero", "itens", "nome"], ["idempotencyKey", "ocupacao", "numero", "itens"])) throw bad("Pedido com campos não permitidos.");
  const nome = lerNome(corpo.nome);
  if (typeof corpo.idempotencyKey !== "string" || !UUID.test(corpo.idempotencyKey)) throw bad("Chave do pedido inválida.");
  const ocupacao = lerOcupacao(corpo.ocupacao);
  if (!Number.isInteger(corpo.numero) || corpo.numero < 1 || corpo.numero > 200) throw bad("Número da rodada inválido.");
  if (!Array.isArray(corpo.itens) || corpo.itens.length < 1 || corpo.itens.length > C.LIM.maxLinhasCarrinho) throw bad(`A rodada precisa ter de 1 a ${C.LIM.maxLinhasCarrinho} itens.`);
  const disp = menuDisponivel(cardapio, data, permitidos);
  const ix = C.indexar(disp);
  let total = 0;
  const linhas = [];
  const resumo = [];
  for (const l of corpo.itens) {
    if (!so(l, ["produto", "variacao", "quantidade", "opcoes", "obs", "retiradas"], ["produto", "variacao", "quantidade", "opcoes"])) throw bad("Item com campos não permitidos.");
    const p = ix.produto(l.produto);
    if (!p) {
      const nome = cardapio.dto.produtos.get(l.produto)?.nome;
      throw new ErroSalao(409, nome ? `"${nome}" não está disponível agora. Remova do carrinho e tente de novo.` : "Um item da rodada não está disponível agora. Remova-o e tente de novo.");
    }
    if (!Array.isArray(l.opcoes) || l.opcoes.some((o) => !so(o, ["opcao", "quantidade"]))) throw bad("Opções inválidas.");
    if (l.obs !== undefined && typeof l.obs !== "string") throw bad("Observação inválida.");
    if (l.retiradas !== undefined && (!Array.isArray(l.retiradas) || l.retiradas.some((r) => typeof r !== "string"))) throw bad("Retirada inválida.");
    const sel = { variacao: l.variacao, quantidade: l.quantidade, opcoes: l.opcoes, obs: l.obs ?? "", retiradas: l.retiradas ?? [] };
    const erro = C.validarSelecao(ix, p, sel);
    if (erro) throw bad(erro);
    if (new Set(l.opcoes.map((o) => o.opcao)).size !== l.opcoes.length) throw bad("Opção repetida.");
    const linha = C.criarLinha(ix, p, sel);
    const valor = C.totalLinha(ix, linha);
    total += valor;
    if (!Number.isSafeInteger(total)) throw bad("Total inválido.");
    linhas.push(linha);
    const v = p.variacoes.find((x) => x.indice === linha.variacao);
    resumo.push({
      nome: p.nome, variacao: p.variacoes.length > 1 ? v.nome : "", quantidade: linha.quantidade,
      opcoes: linha.opcoes.map((o) => ({ nome: ix.opcao(o.opcao).nome, quantidade: o.quantidade })),
      obs: linha.obs || "", retiradas: linha.retiradas || [], centavos: valor,
    });
  }
  return { ocupacao, numero: corpo.numero, nome, linhas, resumo, totalCentavos: total };
}

// Primeiro nome de quem pediu (para o garcom entregar). Opcional; so letras, ate 20.
export function lerNome(v) {
  if (v === undefined || v === null || v === "") return null;
  if (typeof v !== "string") throw bad("Nome inválido.");
  const t = v.normalize("NFC").trim().replace(/\s+/g, " ");
  if (!t) return null;
  if (t.length > 20 || !/^[\p{L}][\p{L}' -]*$/u.test(t)) throw bad("Digite só o primeiro nome (letras, até 20).");
  return t.split(" ").map((w) => w.charAt(0).toLocaleUpperCase("pt-BR") + w.slice(1).toLocaleLowerCase("pt-BR")).join(" ");
}

// Nota do item na ficha Saipos: identifica mesa/rodada (TICKET nao tem campo de mesa) + observacao do cliente.
export function notaSaipos(ocupacao, numero, linha, nome = null) {
  const partes = [`${rotuloOcupacao(ocupacao)} R${numero}${nome ? " " + nome.toLocaleUpperCase("pt-BR") : ""}`];
  if (linha.retiradas?.length) partes.push(`SEM ${linha.retiradas.join(", ")}`);
  if (linha.obs) partes.push(linha.obs);
  return partes.join(" | ").slice(0, 110);
}

// ---------- estado (arquivo JSON local, gravacao atomica) ----------

function estadoVazio() { return { v: 1, proximaSenha: SENHA_INICIAL, rodadas: [], avisos: [], fechamentos: [] }; }

async function carregarEstado(caminho) {
  const bruto = await lerJsonOpcional(caminho); // corrompido => erro (nunca recomeca do zero apagando)
  if (bruto === null) return estadoVazio();
  if (!objeto(bruto) || bruto.v !== 1 || !Array.isArray(bruto.rodadas) || !Array.isArray(bruto.avisos) || !Number.isSafeInteger(bruto.proximaSenha)) {
    throw new ErroConector("ESTADO_INVALIDO", "Arquivo de estado do salão inválido; não foi sobrescrito.");
  }
  if (bruto.fechamentos === undefined) bruto.fechamentos = []; // estado de antes de 17/11
  if (!Array.isArray(bruto.fechamentos)) throw new ErroConector("ESTADO_INVALIDO", "Arquivo de estado do salão inválido; não foi sobrescrito.");
  for (const r of bruto.rodadas) if (r.contaId === undefined) { r.contaId = null; r.fechada = true; } // estado antigo: considera fechado
  // envio interrompido no meio (queda/reinicio) => incerto, NUNCA reenvia sozinho
  for (const r of bruto.rodadas) if (r.saipos && ["reservado", "enviando"].includes(r.saipos.estado)) r.saipos.estado = "ambiguo";
  return bruto;
}

// ---------- Saipos (somente loja TESTE) ----------

async function iniciarSaipos({ envPath, fetchImpl, timeoutMs }) {
  const caminhos = resolverCaminhos({ CONNECTOR_ENV_PATH: envPath }, PACOTE_CONECTOR);
  const meta = await carregarMeta(caminhos.metaPath);
  if (meta.codStore !== COD_STORE_TESTE) throw new ErroConector("LOJA_NAO_PERMITIDA", "A loja configurada não é a loja de teste autorizada.");
  const secret = await lerSegredo(caminhos.envPath);
  const cliente = criarHttp({ fetchImpl, timeoutMs });
  const { token } = await obterToken({ http: cliente, caminhos, meta, secret });
  const { link } = await pedirLinkCatalogo({ http: cliente, token, segredos: [secret, meta.idPartner, token] });
  await baixarCatalogo({ link, destino: caminhos.catalogPath, fetchImpl, timeoutMs });
  const catalogo = await carregarCatalogo(caminhos.catalogPath);
  return { caminhos, meta, catalogo, cliente };
}

// ---------- paginas ----------

function tabletHtml({ menu, modo, csrf, base, mesaFixa = null, pagarAntes = false }) {
  let html = readFileSync(join(APP, "src", "index.template.html"), "utf8");
  const dados = { ...menu, fotos: Object.fromEntries(menu.produtos.map((p) => [p.id, `/fotos/p${p.id}.webp`])) };
  const seguro = (s) => s.replace(/</g, "\\u003c").replace(/\u2028/g, "\\u2028").replace(/\u2029/g, "\\u2029");
  const faixa = modo === "saipos" ? "MODO TESTE — pedidos vão para a cozinha de teste e para a loja TESTE do Saipos" : "MODO TESTE — pedidos vão para a tela da cozinha de teste";
  const trocas = [
    [/<meta http-equiv="Content-Security-Policy"[^>]*>/, ""], // CSP vem no cabecalho HTTP (permite falar so com este servidor)
    ["DEMONSTRAÇÃO — pedidos não chegam à cozinha", faixa],
    ["Tablet de mesa (DEMONSTRAÇÃO)", "Tablet de mesa (TESTE)"],
    ["Sem conexão · sem envio real", "Teste · nada é cobrado"],
    ["Chamar atendente (simulado)", "Chamar atendente"],
    ["Pedir conta (simulado)", "Pedir conta"],
    ["Pede confirmação e registra somente neste tablet. Nada é enviado à cozinha.", "Pede confirmação e envia a rodada para a cozinha de teste. Nada é cobrado."],
  ];
  for (const [a, b] of trocas) html = html.replace(a, b);
  const cfg = `<script type="application/json" id="cfgEnvio">${seguro(JSON.stringify({ modo, csrf, mesaFixa, pagarAntes }))}</script>\n<script type="application/json" id="dados">`;
  html = html.replace('<script type="application/json" id="dados">', cfg);
  const subst = { "{{CSS}}": base.css, "{{CORE}}": base.core, "{{APP}}": base.qr + "\n" + base.cartao + "\n" + base.envio + "\n" + base.app, "{{DADOS}}": seguro(JSON.stringify(dados)), "{{LOGO}}": "/marca/logo-cdm.png" };
  for (const [k, v] of Object.entries(subst)) html = html.split(k).join(v);
  return html;
}

function baseEstatica() {
  const uri = (arq, mime) => `data:${mime};base64,${readFileSync(join(TOTEM_APP, "public", "marca", arq)).toString("base64")}`;
  const fonte = (familia, arq, peso, formato, mime) => `@font-face{font-family:"${familia}";font-weight:${peso};font-style:normal;font-display:swap;src:url(${uri(arq, mime)}) format("${formato}")}`;
  const css = [
    fonte("Cubano", "Cubano-Regular.otf", 400, "opentype", "font/otf"),
    fonte("Barlow", "Barlow-Regular.ttf", 400, "truetype", "font/ttf"),
    fonte("Barlow", "Barlow-SemiBold.ttf", 600, "truetype", "font/ttf"),
    readFileSync(join(APP, "src", "style.css"), "utf8"),
  ].join("\n");
  return {
    css,
    fontesCss: css.split("\n").slice(0, 3).join("\n"),
    core: readFileSync(join(APP, "src", "core.js"), "utf8"),
    app: readFileSync(join(APP, "src", "app.js"), "utf8"),
    envio: readFileSync(join(APP, "src", "envio.js"), "utf8"),
    qr: readFileSync(join(TOTEM_APP, "public", "vendor", "qrcode.js"), "utf8"),
    cartao: readFileSync(join(APP, "src", "cartao-sim.js"), "utf8"),
  };
}

const CSP = "default-src 'none'; img-src 'self' data:; font-src data:; style-src 'unsafe-inline'; script-src 'unsafe-inline'; connect-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'";

// ---------- servidor ----------

// modo: "local" (cozinha de teste apenas) | "saipos" (cozinha + loja TESTE do Saipos; exige envPath).
// statePath: arquivo de estado (padrao: tablets/servidor/dados/salao-estado.json no local; ao lado do .env privado no saipos).
// hosts: lista de "ip:porta" aceitos no cabecalho Host (padrao: 127.0.0.1/localhost na porta).
export async function criarServidorSalao({ modo = "local", modoSaipos = "TICKET", pin, envPath, fetchImpl = globalThis.fetch, timeoutMs, gamaPath, fotosDir, statePath, agora = () => new Date(), hostsExtras = [], pagarAntes = false, pix = null } = {}) {
  const pixCfg = pagarAntes ? lerPixConfig(pix) : null;
  if (!["local", "saipos"].includes(modo)) throw new ErroConector("MODO_INVALIDO", "Modo inválido.");
  if (!["TICKET", "TABLE"].includes(modoSaipos)) throw new ErroConector("MODO_INVALIDO", "Modo do Saipos inválido.");
  if (typeof pin !== "string" || !/^\d{4,8}$/.test(pin)) throw new ErroConector("PIN_INVALIDO", "Senha da equipe deve ter de 4 a 8 números.");
  const cardapio = await carregarCardapio({ gamaPath, fotosDir });
  let saipos = null;
  let permitidos = null;
  if (modo === "saipos") {
    if (!envPath) throw new ErroConector("SEM_CONFIG", "Defina CONNECTOR_ENV_PATH.");
    saipos = await iniciarSaipos({ envPath, fetchImpl, timeoutMs });
    const mapa = await carregarMapa(join(saipos.caminhos.dir, "gama-hml-map.json"), saipos.meta.codStore, cardapio.dto);
    if (mapa.estado !== "ok") throw new ErroConector("MAPA_" + mapa.estado.toUpperCase(), "Mapa do cardápio da loja TESTE ausente ou inválido.");
    saipos.ctx = { dto: cardapio.dto, mapa, catalogo: saipos.catalogo };
    permitidos = produtosProntosNoSaipos(saipos.ctx, agora());
    if (!permitidos.size) throw new ErroConector("CARDAPIO_VAZIO", "Nenhum produto ligado à loja TESTE.");
  }
  const caminhoEstado = statePath ?? (saipos ? join(saipos.caminhos.dir, "salao-hml-state.json") : join(AQUI, "..", "dados", "salao-estado.json"));
  const estado = await carregarEstado(caminhoEstado);
  // Gravacoes em fila: a fila do Saipos e a principal nunca gravam ao mesmo tempo (a ultima gravada e sempre a mais nova).
  let filaGravar = Promise.resolve();
  const salvar = () => { const p = filaGravar.then(() => gravarJsonAtomico(caminhoEstado, estado)); filaGravar = p.then(() => {}, () => {}); return p; };

  // Token por instalacao (guardado no estado): reiniciar o servidor nao obriga a recarregar cada tablet.
  let gravarCsrf = false;
  if (typeof estado.csrf !== "string" || !/^[0-9a-f]{48}$/.test(estado.csrf)) { estado.csrf = randomBytes(24).toString("hex"); gravarCsrf = true; }
  const csrf = estado.csrf;
  if (gravarCsrf) await salvar();
  const base = baseEstatica();
  const cozinhaHtml = readFileSync(join(PUBLIC, "cozinha.html"), "utf8")
    .replace("{{FONTES}}", base.fontesCss)
    .replace("{{CFG}}", JSON.stringify({ csrf, modo: modo }))
    .replace("{{JS}}", readFileSync(join(PUBLIC, "cozinha.js"), "utf8"));

  const pagarHtml = readFileSync(join(PUBLIC, "pagar.html"), "utf8")
    .replace("{{FONTES}}", base.fontesCss)
    .replace("{{CFG}}", JSON.stringify({ csrf }))
    .replace("{{CSS}}", readFileSync(join(APP, "src", "style.css"), "utf8").split("/* simulacao do cartao/carteira */")[1] ?? "")
    .replace("{{JS}}", readFileSync(join(APP, "src", "cartao-sim.js"), "utf8") + "\n" + readFileSync(join(PUBLIC, "pagar.js"), "utf8"));

  let fila = Promise.resolve();
  const serial = (fn) => { const p = fila.then(fn); fila = p.then(() => {}, () => {}); return p; };
  let filaS = Promise.resolve();
  const filaSaipos = (fn) => { const p = filaS.then(() => serial(() => Promise.resolve())).then(fn); filaS = p.then(() => {}, () => {}); return p; };
  const esperarSaipos = () => filaS;

  function respostaRodada(r) {
    if (r.pagamento && r.pagamento.estado !== "aprovado") {
      return { ok: true, id: r.id, status: STATUS.aguardandoPagamento, totalCentavos: r.totalCentavos,
        mensagem: `aguardando pagamento (${C.reais(r.totalCentavos)}). A rodada só vai para a cozinha depois do pagamento aprovado.`,
        pagamento: { estado: r.pagamento.estado, token: r.pagamento.token } };
    }
    const pago = r.pagamento ? `Pagamento aprovado (teste, ${FORMAS_PAGAMENTO[r.pagamento.forma]}). ` : "";
    const fim = (x) => ({ ...x, mensagem: pago + x.mensagem, pagamento: r.pagamento ? { estado: "aprovado", forma: r.pagamento.forma } : undefined });
    return fim(respostaBase(r));
  }
  function respostaBase(r) {
    let status = STATUS.local;
    let mensagem = `na cozinha de teste (${C.reais(r.totalCentavos)}). Nada foi cobrado.`;
    if (r.saipos && ["reservado", "enviando"].includes(r.saipos.estado)) { status = STATUS.enviando; mensagem = `na cozinha de teste (${C.reais(r.totalCentavos)}); enviando ao Saipos de teste. Nada foi cobrado.`; }
    else if (r.saipos) {
      if (r.saipos.estado === "aceito") { status = STATUS.saipos; mensagem = `na cozinha e na loja TESTE do Saipos, ficha ${r.saipos.senha} (${C.reais(r.totalCentavos)}). Nada foi cobrado.`; }
      else { status = STATUS.conferir; mensagem = `na cozinha de teste (${C.reais(r.totalCentavos)}). O Saipos de teste ${r.saipos.estado === "recusado" ? "recusou" : "não confirmou"} — a equipe confere.`; }
    }
    return { ok: true, id: r.id, status, mensagem, totalCentavos: r.totalCentavos };
  }

  async function enviarSaipos(r, val) {
    if (modoSaipos === "TABLE") return enviarSaiposMesa(r, val);
    const itens = val.itensHml.map((it, i) => ({ ...it, nota: notaSaipos(r.ocupacao, r.numero, val.linhas[i], r.nome) }));
    let prep;
    try {
      prep = await prepararCarrinho({ caminhos: saipos.caminhos, meta: saipos.meta, itens, paymentCode: PAGAMENTO_CODIGO, senha: r.saipos.senha, agora: agora(), mode: "TICKET" });
      if (prep.totalCentavos !== r.totalCentavos) throw new ErroConector("RESUMO_DIVERGENTE", "Resumo divergente.");
    } catch {
      r.saipos.estado = "nao_enviado";
      await salvar();
      return;
    }
    r.saipos.orderId = prep.orderId;
    r.saipos.estado = "enviando";
    await salvar(); // chave -> orderId gravado ANTES do envio
    try {
      const res = await enviarCarrinho({ http: saipos.cliente, caminhos: saipos.caminhos, meta: saipos.meta, secret: await lerSegredo(saipos.caminhos.envPath), orderId: prep.orderId, sandbox: true });
      r.saipos.estado = { aceito_pela_api: "aceito", ambiguo: "ambiguo", recusado: "recusado" }[res.estado] ?? "ambiguo";
      r.saipos.httpStatus = res.httpStatus ?? null;
    } catch (err) {
      r.saipos.estado = err instanceof ErroConector && err.codigo !== "JA_TENTADO" ? "nao_enviado" : "ambiguo";
    }
    await salvar();
  }

  // Modo mesa/comanda (TABLE) — NAO HOMOLOGADO: cada rodada e um POST /order novo para a mesa (desc_table = numero
  // da mesa) ou comanda (desc_order_pad). Exige mesas/comandas cadastradas na loja TESTE. Uma tentativa por rodada
  // (ledger exclusivo antes do POST), sem reenvio automatico; falha/sem resposta => "a conferir".
  async function enviarSaiposMesa(r, val) {
    const orderId = `MESA-${r.criadoEm.replace(/\D/g, "").slice(0, 14)}-${randomBytes(4).toString("hex")}`;
    let env;
    try {
      env = SaiposMesa.criarPedidoMesaComanda({
        pedidoId: orderId, displayId: String(r.saipos.senha), lojaCodigo: saipos.meta.codStore, criadoEm: r.criadoEm,
        destino: r.ocupacao.modalidade === "mesa" ? { tipo: "mesa", descTable: String(r.ocupacao.mesa) } : { tipo: "comanda", descOrderPad: r.ocupacao.comanda },
        observacao: `TESTE-NAO PRODUZIR | ${rotuloOcupacao(r.ocupacao)} R${r.numero}${r.nome ? " " + r.nome.toLocaleUpperCase("pt-BR") : ""}`,
        itens: val.itensHml.map((it, i) => {
          const item = { codigo: it.codigo, descricao: it.descricao, quantidade: it.quantidade, precoCentavos: it.centavos,
            complementos: it.complementos.map((c) => ({ codigo: c.codigo, descricao: c.descricao, quantidade: c.quantidade, precoAdicionalCentavos: c.centavos })) };
          const nota = notaSaipos(r.ocupacao, r.numero, val.linhas[i]).replace(/^(MESA|COMANDA) \S+ R\d+( \| )?/, "").trim();
          if (nota) item.observacao = nota;
          if (!item.complementos.length) delete item.complementos;
          return item;
        }),
      });
      if (env.conferencia.totalItensCentavos !== r.totalCentavos) throw new Error("total divergente");
    } catch {
      r.saipos.estado = "nao_enviado";
      await salvar();
      return;
    }
    r.saipos.orderId = orderId;
    r.saipos.estado = "enviando";
    await salvar();
    try {
      const secret = await lerSegredo(saipos.caminhos.envPath);
      const { token } = await obterToken({ http: saipos.cliente, caminhos: saipos.caminhos, meta: saipos.meta, secret });
      await mkdir(saipos.caminhos.ledgerDir, { recursive: true });
      await writeFile(join(saipos.caminhos.ledgerDir, `${orderId}.json`), JSON.stringify({ orderId, modo: "TABLE", estado: "tentando", em: new Date().toISOString() }), { encoding: "utf8", mode: 0o600, flag: "wx" });
      const resp = await saipos.cliente.requisitar({ metodo: "POST", caminho: "/order", headers: { Authorization: token }, corpo: env.corpo });
      r.saipos.estado = resp.falha || resp.status >= 500 ? "ambiguo" : resp.status === 200 ? "aceito" : "recusado";
      r.saipos.httpStatus = resp.status ?? null;
      r.saipos.api = resp.falha ? null : resumirErroApi(resp.json, [secret, token, saipos.meta.idPartner]);
      await gravarJsonAtomico(join(saipos.caminhos.ledgerDir, `${orderId}.json`), { orderId, modo: "TABLE", estado: r.saipos.estado, httpStatus: r.saipos.httpStatus, api: r.saipos.api, em: new Date().toISOString() });
    } catch (err) {
      r.saipos.estado = err instanceof ErroConector ? "nao_enviado" : "ambiguo";
    }
    await salvar();
  }

  async function novaRodada(corpo) {
    const existente = estado.rodadas.find((r) => r.chave === corpo?.idempotencyKey);
    const h = hash({ ocupacao: corpo?.ocupacao, numero: corpo?.numero, itens: corpo?.itens, ...(corpo?.nome ? { nome: corpo.nome } : {}) });
    if (existente) {
      if (existente.hash !== h) throw new ErroSalao(409, "Esta rodada já foi enviada com outro conteúdo.");
      if (existente.fechada) throw new ErroSalao(409, "Esta rodada é de uma conta já fechada. Toque em Confirmar de novo.");
      if (existente.pagamento?.estado === "cancelado") throw new ErroSalao(409, "Este pagamento foi cancelado. Toque em Confirmar para começar de novo.");
      return respostaRodada(existente); // reenvio do tablet: mesma resposta, nada duplicado
    }
    const data = agora();
    const val = validarRodada(cardapio, corpo, data, permitidos);
    let hml = null;
    if (saipos) {
      if (val.linhas.length > MAX_ITENS_SAIPOS) throw bad(`No teste com o Saipos, envie no máximo ${MAX_ITENS_SAIPOS} itens diferentes por rodada.`);
      hml = validarCarrinho(saipos.ctx, { idempotencyKey: corpo.idempotencyKey, itens: val.linhas.map((l) => ({ produto: l.produto, variacao: l.variacao, quantidade: l.quantidade, opcoes: l.opcoes })) }, data);
      if (hml.totalCentavos !== val.totalCentavos) throw new ErroSalao(409, "Preço do cardápio diferente da loja TESTE. Rodada não enviada.");
      hml.linhas = val.linhas;
    }
    const r = {
      id: randomUUID(), chave: corpo.idempotencyKey, hash: h, criadoEm: data.toISOString(),
      ocupacao: val.ocupacao, numero: val.numero, nome: val.nome, itens: val.resumo, totalCentavos: val.totalCentavos,
      preparo: "NOVO", contaId: null, fechada: false, saipos: null,
    };
    if (pagarAntes) {
      // Paga ANTES: a rodada espera o pagamento fora da cozinha e fora do Saipos.
      r.pagamento = { estado: "aguardando", token: randomBytes(16).toString("hex"), forma: null, tentativas: 0 };
      r.itensCliente = corpo.itens; // para remontar o pedido do Saipos quando o pagamento for aprovado
      estado.rodadas.push(r);
      await salvar();
      return respostaRodada(r);
    }
    liberar(r, hml);
    estado.rodadas.push(r);
    await salvar(); // uma gravacao so: rodada + reserva do Saipos. A cozinha ja ve a rodada.
    if (saipos) agendarSaipos(r, hml);
    return respostaRodada(r);
  }

  // Rodada entra na conta da mesa e reserva a ficha do Saipos (sem gravar; quem chama grava).
  function liberar(r, hml) {
    const chave = chaveOcupacao(r.ocupacao);
    const aberta = estado.rodadas.find((x) => x !== r && naCozinha(x) && !x.fechada && chaveOcupacao(x.ocupacao) === chave);
    r.contaId = aberta ? aberta.contaId : randomUUID();
    if (saipos && hml) { r.saipos = { estado: "reservado", senha: estado.proximaSenha, orderId: null, modo: modoSaipos }; estado.proximaSenha += 1; }
  }
  // Saipos fora da fila principal: o tablet recebe a resposta na hora; o envio segue numa fila propria.
  function agendarSaipos(r, hml) {
    if (r.saipos) filaSaipos(() => enviarSaipos(r, hml).catch(() => { r.saipos.estado = "ambiguo"; return salvar(); }));
  }
  const naCozinha = (r) => !r.pagamento || r.pagamento.estado === "aprovado";

  // ---------- pagamento (TESTE: simulado; nada e cobrado) ----------
  const porToken = (t) => {
    if (!TOKEN_PAG.test(String(t ?? ""))) throw new ErroSalao(404, "Pagamento não encontrado.");
    const r = estado.rodadas.find((x) => x.pagamento && x.pagamento.token === t);
    if (!r) throw new ErroSalao(404, "Pagamento não encontrado.");
    return r;
  };
  const txidPix = (r) => `${r.ocupacao.modalidade === "mesa" ? "MESA" + r.ocupacao.mesa : "CMD" + r.ocupacao.comanda}R${r.numero}${r.pagamento.token.slice(0, 4).toUpperCase()}`;
  function verPagamento(t) {
    const r = porToken(t);
    return { ok: true, estado: r.pagamento.estado, forma: r.pagamento.forma, totalCentavos: r.totalCentavos, rotulo: rotuloOcupacao(r.ocupacao), numero: r.numero, nome: r.nome ?? null,
      itens: r.itens.map((i) => ({ quantidade: i.quantidade, nome: i.nome })), simulado: !pixCfg, rodada: r.pagamento.estado === "aprovado" ? respostaRodada(r) : null,
      pix: pixCfg && ["aguardando", "recusado"].includes(r.pagamento.estado) ? { copiaECola: pixCopiaECola(pixCfg, r.totalCentavos, txidPix(r)), recebedor: pixCfg.nome } : null };
  }
  async function confirmarPix(corpo, daCozinha) {
    if (!pixCfg) throw new ErroSalao(404, "Pix da loja não está ligado.");
    if (!daCozinha) throw new ErroSalao(401, "Digite a senha da equipe.");
    if (!so(corpo, ["token"])) throw bad("Pedido inválido.");
    return aprovar({ token: corpo.token, forma: "pix", resultado: "aprovado" });
  }
  async function simularPagamento(corpo) {
    if (pixCfg) throw new ErroSalao(403, "Pague com o Pix pelo QR Code. A equipe confirma o Pix e o pedido vai para a cozinha.");
    return aprovar(corpo);
  }
  async function aprovar(corpo) {
    if (!so(corpo, ["token", "forma", "resultado"]) || !(corpo.forma in FORMAS_PAGAMENTO) || !["aprovado", "recusado"].includes(corpo.resultado)) throw bad("Pagamento inválido.");
    const r = porToken(corpo.token);
    const p = r.pagamento;
    if (p.estado === "aprovado") return verPagamento(corpo.token); // pagar de novo nunca cobra duas vezes
    if (p.estado === "cancelado") throw new ErroSalao(409, "Este pagamento foi cancelado na mesa.");
    p.tentativas += 1;
    if (corpo.resultado === "recusado") { p.estado = "recusado"; p.forma = corpo.forma; await salvar(); return verPagamento(corpo.token); }
    // Aprovado: confere o pedido de novo (com a hora em que foi feito) e so entao libera cozinha e Saipos.
    let hml = null;
    if (saipos) {
      const data = new Date(r.criadoEm);
      const val = validarRodada(cardapio, { idempotencyKey: r.chave, ocupacao: r.ocupacao, numero: r.numero, itens: r.itensCliente }, data, permitidos);
      hml = validarCarrinho(saipos.ctx, { idempotencyKey: r.chave, itens: val.linhas.map((l) => ({ produto: l.produto, variacao: l.variacao, quantidade: l.quantidade, opcoes: l.opcoes })) }, data);
      hml.linhas = val.linhas;
    }
    p.estado = "aprovado"; p.forma = corpo.forma; p.pagoEm = agora().toISOString();
    r.criadoEm = p.pagoEm; // na cozinha conta a partir do pagamento
    liberar(r, hml);
    delete r.itensCliente;
    await salvar();
    agendarSaipos(r, hml);
    return verPagamento(corpo.token);
  }
  async function cancelarPagamento(corpo) {
    if (!so(corpo, ["token"])) throw bad("Pedido inválido.");
    const r = porToken(corpo.token);
    if (r.pagamento.estado === "aprovado") throw new ErroSalao(409, "Este pagamento já foi aprovado; a rodada está na cozinha.");
    if (r.pagamento.estado !== "cancelado") { r.pagamento.estado = "cancelado"; r.fechada = true; r.fechadaEm = agora().toISOString(); delete r.itensCliente; await salvar(); }
    return { ok: true, mensagem: "Pagamento cancelado. Nada foi cobrado; o carrinho continua no tablet." };
  }

  async function novoAviso(corpo) {
    if (!so(corpo, ["tipo", "ocupacao", "idempotencyKey"]) || !["atendente", "conta"].includes(corpo.tipo) || !UUID.test(String(corpo.idempotencyKey))) throw bad("Aviso inválido.");
    const ocupacao = lerOcupacao(corpo.ocupacao);
    if (!estado.avisos.some((a) => a.chave === corpo.idempotencyKey)) {
      estado.avisos.push({ id: randomUUID(), chave: corpo.idempotencyKey, tipo: corpo.tipo, ocupacao, em: agora().toISOString(), visto: false });
      if (estado.avisos.length > 300) estado.avisos.splice(0, estado.avisos.length - 300);
      await salvar();
    }
    return { ok: true, mensagem: corpo.tipo === "conta" ? "Pedido de conta enviado à equipe. Já vamos até a mesa." : "A equipe foi avisada. Já vamos até a mesa." };
  }

  // Conta aberta = rodadas ainda nao fechadas da mesa/comanda (por marca na rodada, nunca por relogio).
  const rodadasAbertas = (chave) => estado.rodadas.filter((r) => naCozinha(r) && !r.fechada && chaveOcupacao(r.ocupacao) === chave);
  function mesasAbertas() {
    const chaves = [...new Set(estado.rodadas.filter((r) => naCozinha(r) && !r.fechada).map((r) => chaveOcupacao(r.ocupacao)))];
    return chaves.map((chave) => {
      const rs = rodadasAbertas(chave);
      if (!rs.length) return null;
      return { chave, rotulo: rotuloOcupacao(rs[0].ocupacao), nomes: [...new Set(rs.map((r) => r.nome).filter(Boolean))], rodadas: rs.length, totalCentavos: rs.reduce((s, r) => s + r.totalCentavos, 0), desde: rs[0].criadoEm,
        pendentes: rs.filter((r) => r.preparo !== "ENTREGUE").length };
    }).filter(Boolean).sort((a, b) => a.desde.localeCompare(b.desde));
  }

  // ---------- senha da equipe (trocar mesa, fechar conta) ----------
  // Tentativas contadas POR APARELHO (IP): um tablet errando nao trava a cozinha. Espera dobra a cada bloqueio.
  const tentativas = new Map();
  function conferirPin(valor, ip = "?") {
    const agoraMs = Date.now();
    const t = tentativas.get(ip) ?? { falhas: 0, bloqueios: 0, ate: 0 };
    if (agoraMs < t.ate) throw new ErroSalao(429, `Muitas tentativas neste aparelho. Espere ${Math.ceil((t.ate - agoraMs) / 60000)} min.`);
    const a = Buffer.from(String(valor ?? "")), b = Buffer.from(pin);
    if (a.length === b.length && timingSafeEqual(a, b)) { tentativas.delete(ip); return true; }
    t.falhas += 1;
    if (t.falhas >= 5) { t.falhas = 0; t.bloqueios += 1; t.ate = agoraMs + 60_000 * 2 ** Math.min(t.bloqueios - 1, 6); }
    tentativas.set(ip, t);
    if (tentativas.size > 500) tentativas.delete(tentativas.keys().next().value);
    throw new ErroSalao(403, "Senha da equipe incorreta.");
  }
  // Sessao da cozinha: token proprio (diferente do tablet), entregue so com a senha da equipe.
  if (typeof estado.cozinhaToken !== "string" || !/^[0-9a-f]{48}$/.test(estado.cozinhaToken)) { estado.cozinhaToken = randomBytes(24).toString("hex"); await salvar(); }
  const ehCozinha = (req) => {
    const a = Buffer.from(String(req.headers["x-cdm-cozinha"] ?? "")), b = Buffer.from(estado.cozinhaToken);
    return a.length === b.length && timingSafeEqual(a, b);
  };

  async function fecharMesa(corpo, ip, cozinha) {
    if (!so(corpo, ["ocupacao", "pin"], ["ocupacao"])) throw bad("Pedido inválido.");
    if (!cozinha) conferirPin(corpo.pin, ip);
    const o = lerChaveOcupacao(corpo.ocupacao);
    const chave = chaveOcupacao(o);
    const em0 = agora().toISOString();
    let cancelou = false;
    for (const r of estado.rodadas) if (r.pagamento && ["aguardando", "recusado"].includes(r.pagamento.estado) && chaveOcupacao(r.ocupacao) === chave) {
      r.pagamento.estado = "cancelado"; r.fechada = true; r.fechadaEm = em0; delete r.itensCliente; cancelou = true;
    }
    const rs = rodadasAbertas(chave);
    if (!rs.length) { if (cancelou) await salvar(); return { ok: true, mensagem: "Não havia conta aberta." }; }
    const em = agora().toISOString();
    for (const r of rs) { r.fechada = true; r.fechadaEm = em; if (r.preparo !== "ENTREGUE") { r.preparo = "ENTREGUE"; r.entregueEm = em; } }
    estado.fechamentos.push({ chave, contaId: rs[0].contaId, em, rodadas: rs.length, totalCentavos: rs.reduce((s, r) => s + r.totalCentavos, 0) });
    if (estado.fechamentos.length > 2000) estado.fechamentos.splice(0, estado.fechamentos.length - 2000); // so historico; nada depende dele
    arquivar();
    await salvar();
    return { ok: true, mensagem: `Conta de ${rotuloOcupacao(o)} fechada.` };
  }

  // O tablet pergunta pelas SUAS rodadas (ids). Rodada arquivada (conta fechada ha dias) conta como fechada.
  function estadoTablet(idsTxt) {
    const ids = String(idsTxt ?? "").split(",").filter((x) => UUID.test(x)).slice(0, 60);
    return { rodadas: ids.map((id) => {
      const r = estado.rodadas.find((x) => x.id === id);
      return r ? { id, preparo: r.preparo, fechada: !!r.fechada } : { id, preparo: "ENTREGUE", fechada: true };
    }) };
  }
  // Mantem o arquivo pequeno: rodadas de contas fechadas ha mais de 2 dias saem do estado (o resumo fica em fechamentos).
  function arquivar() {
    const limite = agora().getTime() - 2 * 86400e3;
    const antes = estado.rodadas.length;
    const limitePag = agora().getTime() - 86400e3; // pagamento abandonado (nao aprovado) some depois de 1 dia
    estado.rodadas = estado.rodadas.filter((r) => (r.pagamento && r.pagamento.estado !== "aprovado")
      ? Date.parse(r.criadoEm) > limitePag
      : !r.fechada || Date.parse(r.fechadaEm ?? r.criadoEm) > limite);
    return antes !== estado.rodadas.length;
  }
  if (arquivar()) await salvar();

  function painel() {
    const visiveis = estado.rodadas.filter(naCozinha);
    const ativos = visiveis.filter((r) => r.preparo !== "ENTREGUE").sort((a, b) => a.criadoEm.localeCompare(b.criadoEm));
    const entregues = visiveis.filter((r) => r.preparo === "ENTREGUE").slice(-10);
    const pub = (r) => ({
      id: r.id, criadoEm: r.criadoEm, rotulo: rotuloOcupacao(r.ocupacao), numero: r.numero, nome: r.nome ?? null, itens: r.itens, totalCentavos: r.totalCentavos,
      preparo: r.preparo, saipos: r.saipos ? { estado: r.saipos.estado, ficha: r.saipos.senha } : null,
      pago: r.pagamento ? FORMAS_PAGAMENTO[r.pagamento.forma] : null,
    });
    return {
      modo, agora: agora().toISOString(),
      rodadas: ativos.map(pub), entregues: entregues.map(pub).reverse(),
      mesas: mesasAbertas(),
      pix: pixCfg ? estado.rodadas.filter((r) => r.pagamento && ["aguardando", "recusado"].includes(r.pagamento.estado))
        .map((r) => ({ token: r.pagamento.token, rotulo: rotuloOcupacao(r.ocupacao), numero: r.numero, nome: r.nome ?? null, totalCentavos: r.totalCentavos, criadoEm: r.criadoEm, txid: txidPix(r) })) : [],
      avisos: estado.avisos.filter((a) => !a.visto).map((a) => ({ id: a.id, tipo: a.tipo, rotulo: rotuloOcupacao(a.ocupacao), em: a.em })),
    };
  }

  async function acaoCozinha(id, acao) {
    const r = estado.rodadas.find((x) => x.id === id);
    if (!r || !naCozinha(r)) throw new ErroSalao(404, "Rodada não encontrada.");
    const alvo = { preparando: "PREPARANDO", pronto: "PRONTO", entregue: "ENTREGUE" }[acao];
    if (PREPARO.indexOf(alvo) < PREPARO.indexOf(r.preparo)) throw new ErroSalao(409, "A rodada já passou desta etapa.");
    if (r.preparo !== alvo) { r.preparo = alvo; r[`${acao}Em`] = agora().toISOString(); await salvar(); }
    return { ok: true, preparo: r.preparo };
  }

  async function avisoVisto(id) {
    const a = estado.avisos.find((x) => x.id === id);
    if (!a) throw new ErroSalao(404, "Aviso não encontrado.");
    if (!a.visto) { a.visto = true; await salvar(); }
    return { ok: true };
  }

  // ---------- HTTP ----------
  const hostsOk = new Set(hostsExtras);
  const server = http.createServer(async (req, res) => {
    const enviar = (status, corpo, tipo = "application/json; charset=utf-8", extra = {}) => {
      res.writeHead(status, { "Content-Type": tipo, "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff", "Referrer-Policy": "same-origin", ...extra });
      res.end(typeof corpo === "string" || Buffer.isBuffer(corpo) ? corpo : JSON.stringify(corpo));
    };
    try {
      const porta = server.address()?.port;
      const host = req.headers.host ?? "";
      if (![`127.0.0.1:${porta}`, `localhost:${porta}`, ...[...hostsOk].map((h) => `${h}:${porta}`)].includes(host)) return enviar(421, { ok: false, mensagem: "Host não permitido." });
      const url = new URL(req.url, `http://${host}`);
      if (req.method === "GET") {
        if (url.pathname === "/" || url.pathname === "/tablet") {
          const mesaFixa = url.searchParams.has("mesa") ? C.normalizarMesa(url.searchParams.get("mesa")) : null;
          if (url.searchParams.has("mesa") && mesaFixa === null) return enviar(400, "Mesa inválida no endereço (use /tablet?mesa=1 a 150).", "text/plain; charset=utf-8");
          return enviar(200, tabletHtml({ menu: menuDisponivel(cardapio, agora(), permitidos), modo, csrf, base, mesaFixa, pagarAntes }), "text/html; charset=utf-8", { "Content-Security-Policy": CSP });
        }
        if (url.pathname === "/api/pagamento") return enviar(200, verPagamento(url.searchParams.get("t")));
        if (url.pathname === "/pagar") { porToken(url.searchParams.get("t")); return enviar(200, pagarHtml, "text/html; charset=utf-8", { "Content-Security-Policy": CSP }); }
        if (url.pathname === "/api/tablet/estado") return enviar(200, estadoTablet(url.searchParams.get("ids")));
        if (url.pathname === "/cozinha") return enviar(200, cozinhaHtml, "text/html; charset=utf-8", { "Content-Security-Policy": CSP });
        if (url.pathname === "/api/cozinha") return ehCozinha(req) ? enviar(200, painel()) : enviar(401, { ok: false, mensagem: "Digite a senha da equipe." });
        if (url.pathname === "/marca/logo-cdm.png") return enviar(200, readFileSync(join(TOTEM_APP, "public", "marca", "logo-cdm.png")), "image/png");
        const f = FOTO.exec(url.pathname);
        if (f && cardapio.menu.produtos.some((p) => p.id === Number(f[1]))) {
          const arq = join(cardapio.fotosDir, `p${Number(f[1])}.webp`);
          if (existsSync(arq)) return enviar(200, readFileSync(arq), "image/webp", { "Cache-Control": "max-age=3600" });
        }
        return enviar(404, { ok: false, mensagem: "Não encontrado." });
      }
      if (req.method !== "POST") return enviar(405, { ok: false, mensagem: "Método não permitido." });
      // POST: mesma origem, JSON, token por instancia, corpo limitado
      if (req.headers.origin !== undefined && req.headers.origin !== `http://${host}`) return enviar(403, { ok: false, mensagem: "Origem não permitida." });
      if (req.headers["sec-fetch-site"] === "cross-site") return enviar(403, { ok: false, mensagem: "Origem não permitida." });
      if (!String(req.headers["content-type"] ?? "").startsWith("application/json")) return enviar(415, { ok: false, mensagem: "Envie JSON." });
      if (req.headers["x-cdm-csrf"] !== csrf) return enviar(403, { ok: false, mensagem: "Recarregue a tela (sessão do servidor mudou)." });
      let tamanho = 0;
      const partes = [];
      for await (const parte of req) {
        tamanho += parte.length;
        if (tamanho > LIMITE_CORPO) return enviar(413, { ok: false, mensagem: "Pedido grande demais." });
        partes.push(parte);
      }
      let corpo;
      try { corpo = JSON.parse(Buffer.concat(partes).toString("utf8") || "null"); } catch { return enviar(400, { ok: false, mensagem: "JSON inválido." }); }
      let m;
      if (url.pathname === "/api/rodada") return enviar(200, await serial(() => novaRodada(corpo)));
      if (url.pathname === "/api/pagamento/simular") return enviar(200, await serial(() => simularPagamento(corpo)));
      if (url.pathname === "/api/pagamento/cancelar") return enviar(200, await serial(() => cancelarPagamento(corpo)));
      if (url.pathname === "/api/aviso") return enviar(200, await serial(() => novoAviso(corpo)));
      const ip = req.socket.remoteAddress ?? "?";
      if (url.pathname === "/api/equipe/pin") { if (!so(corpo, ["pin"])) throw bad("Pedido inválido."); conferirPin(corpo.pin, ip); return enviar(200, { ok: true }); }
      if (url.pathname === "/api/cozinha/entrar") { if (!so(corpo, ["pin"])) throw bad("Pedido inválido."); conferirPin(corpo.pin, ip); return enviar(200, { ok: true, token: estado.cozinhaToken }); }
      if (url.pathname === "/api/cozinha/mesa/fechar") return enviar(200, await serial(() => fecharMesa(corpo, ip, ehCozinha(req))));
      if (url.pathname === "/api/cozinha/pix/confirmar") return enviar(200, await serial(() => confirmarPix(corpo, ehCozinha(req))));
      if (url.pathname.startsWith("/api/cozinha/") && !ehCozinha(req)) return enviar(401, { ok: false, mensagem: "Digite a senha da equipe." });
      if ((m = /^\/api\/cozinha\/rodada\/([0-9a-f-]{36})\/(preparando|pronto|entregue)$/.exec(url.pathname))) return enviar(200, await serial(() => acaoCozinha(m[1], m[2])));
      if ((m = /^\/api\/cozinha\/aviso\/([0-9a-f-]{36})\/visto$/.exec(url.pathname))) return enviar(200, await serial(() => avisoVisto(m[1])));
      return enviar(404, { ok: false, mensagem: "Não encontrado." });
    } catch (e) {
      if (e instanceof ErroSalao) return enviar(e.status, { ok: false, mensagem: e.message });
      if (e?.status && e?.codigo && typeof e.message === "string") return enviar(e.status, { ok: false, mensagem: e.message }); // ErroCardapio do totem
      return enviar(500, { ok: false, mensagem: "Erro interno. A rodada pode não ter sido registrada; confira na cozinha." });
    }
  });
  server.salao = { pagarAntes, pixLigado: !!pixCfg, estado, caminhoEstado, permitidos, cardapio, modoSaipos, esperarSaipos, cozinhaToken: estado.cozinhaToken };
  return server;
}

export function ipsDaRede() {
  return Object.values(os.networkInterfaces()).flat().filter((i) => i && i.family === "IPv4" && !i.internal).map((i) => i.address);
}
