// Ponte HML: tela do app -> pedido -> Saipos (SOMENTE loja TESTE, sem operacao real).
// Servidor separado do simulador. Reusa o conector sibling outputs/saipos-teste (nao alterado).
// Nunca expoe segredo/token/idPartner/link do catalogo. Nao simula em caso de falha.

import http from "node:http";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import { resolverCaminhos, carregarMeta, lerSegredo } from "../../saipos-teste/src/config.js";
import { criarHttp } from "../../saipos-teste/src/http.js";
import { obterToken } from "../../saipos-teste/src/auth.js";
import { pedirLinkCatalogo, baixarCatalogo } from "../../saipos-teste/src/catalogo.js";
import { carregarCatalogo, localizarCodigo } from "../../saipos-teste/src/payload.js";
import { preparar, enviar } from "../../saipos-teste/src/envio.js";
import { ErroConector } from "../../saipos-teste/src/erros.js";
import { lerJsonOpcional, gravarJsonAtomico, sha256Json } from "../../saipos-teste/src/arquivos.js";
import { prepararCarrinho, enviarCarrinho } from "../../saipos-teste/src/carrinho.js";
import { carregarDto, carregarMapa, montarVisao, validarCarrinho, hashCarrinho, ErroCardapio } from "./cardapio-hml.js";
import { criarReceptorWebhook, aplicarAviso, avisosValidos, segredoValido, FONTE_WEBHOOK, MODO_AUTOMATICO, PORTA_PADRAO } from "./webhook-tv.js";

const AQUI = fileURLToPath(new URL(".", import.meta.url));
const PUBLIC_DIR = join(AQUI, "..", "public");
const PACOTE_CONECTOR = join(AQUI, "..", "..", "saipos-teste");

export const COD_STORE_TESTE = "ef2dc467-a4a8-4734-a4d7-eb3442ff3401";
export const CODIGO_PRODUTO = "40101353";
export const PAGAMENTO_CODIGO = "DIN"; // codigo conferido no canal HML; valor 0, nada cobrado
export const SENHA_INICIAL = 9201; // contador apartado (9101 ja foi usada)
const LIMITE_CORPO = 16 * 1024;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const DTO_PADRAO = join(AQUI, "..", "data", "gama-cardapio.json");
const FOTO = /^\/gama-fotos\/p(\d{1,8})\.webp$/;

const ESTATICOS = {
  "/": ["cardapio-hml.html", "text/html; charset=utf-8"],
  "/cardapio-hml.html": ["cardapio-hml.html", "text/html; charset=utf-8"],
  "/cardapio-hml.js": ["cardapio-hml.js", "text/javascript; charset=utf-8"],
  "/cardapio-hml.css": ["cardapio-hml.css", "text/css; charset=utf-8"],
  "/saipos.html": ["saipos.html", "text/html; charset=utf-8"],
  "/saipos.js": ["saipos.js", "text/javascript; charset=utf-8"],
  "/estilo.css": ["estilo.css", "text/css; charset=utf-8"],
  "/cozinha-hml.html": ["cozinha-hml.html", "text/html; charset=utf-8"],
  "/cozinha-hml.js": ["cozinha-hml.js", "text/javascript; charset=utf-8"],
  "/tv-hml.html": ["tv-hml.html", "text/html; charset=utf-8"],
  "/tv-hml.js": ["tv-hml.js", "text/javascript; charset=utf-8"],
  "/tv-hml.css": ["tv-hml.css", "text/css; charset=utf-8"],
  // Assets fixos da marca (allowlist explicita; nada de servidor de diretorio generico).
  "/marca/Cubano-Regular.otf": ["marca/Cubano-Regular.otf", "font/otf"],
  "/marca/Barlow-Regular.ttf": ["marca/Barlow-Regular.ttf", "font/ttf"],
  "/marca/Barlow-SemiBold.ttf": ["marca/Barlow-SemiBold.ttf", "font/ttf"],
  "/marca/OFL-Barlow.txt": ["marca/OFL-Barlow.txt", "text/plain; charset=utf-8"],
  "/marca/logo-cdm.png": ["marca/logo-cdm.png", "image/png"],
  "/marca/arte-colagem.png": ["marca/arte-colagem.png", "image/png"],
  "/marca/burger-hero.jpg": ["marca/burger-hero.jpg", "image/jpeg"],
  "/marca/abertura.mp4": ["marca/abertura.mp4", "video/mp4"],
  "/marca/abertura-poster.jpg": ["marca/abertura-poster.jpg", "image/jpeg"],
};

const CABECALHOS = {
  "Cache-Control": "no-store",
  "Referrer-Policy": "same-origin",
  "X-Content-Type-Options": "nosniff",
  "Content-Security-Policy":
    "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self'; connect-src 'self'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'; object-src 'none'",
};

const MENSAGENS = {
  enviando: "Enviando o pedido para a loja de teste…",
  aceito: "Pedido enviado para a loja de teste; aguardando conferência na cozinha",
  ambiguo: "Não foi possível confirmar o envio. Confira o pedido na loja de teste",
  bloqueado: "Este pedido foi bloqueado por segurança. Confira o pedido na loja de teste",
  recusado: "A loja de teste recusou o pedido. Nada foi cobrado.",
  nao_enviado: "O pedido não foi enviado. Nada foi cobrado.",
};

const ERROS = {
  host_invalido: "Endereço não permitido.",
  origem_invalida: "Origem não permitida.",
  protecao_invalida: "Sessão da tela inválida. Recarregue a página.",
  tipo_invalido: "Formato de envio não aceito.",
  corpo_grande: "Envio grande demais.",
  pedido_invalido: "Pedido não permitido nesta etapa.",
  chave_invalida: "Identificação do pedido inválida.",
  chave_reutilizada: "Esta identificação já foi usada com outro pedido.",
  nao_encontrado: "Não encontrado.",
  metodo: "Operação não permitida.",
  cardapio_indisponivel: "O cardápio não está disponível no momento.",
  acao_invalida: "Ação inválida.",
  transicao_invalida: "Esta ação não é possível no estado atual do pedido.",
  pronto_automatico: "Neste pedido o PRONTO vem do Saipos; aguarde o aviso.",
  interno: "Algo deu errado. Confira o pedido na loja de teste.",
};

export function hashPedido(corpo) {
  const extras = Object.keys(corpo).filter((k) => !["idempotencyKey", "code", "quantity"].includes(k)).sort();
  return sha256Json({ code: corpo.code, quantity: corpo.quantity, extras });
}

function corpoValido(c) {
  const chaves = Object.keys(c).sort().join(",");
  return chaves === "code,idempotencyKey,quantity" && c.code === CODIGO_PRODUTO && c.quantity === 1 && Number.isInteger(c.quantity);
}

function reais(centavos) {
  return `R$ ${(centavos / 100).toFixed(2).replace(".", ",")}`;
}

function resumir(e) {
  const estado = ["reservado", "preparado"].includes(e.estado) ? "enviando" : e.estado;
  const r = {
    estado,
    senha: e.senha ?? null,
    orderId: e.orderId ?? null,
    mensagem: MENSAGENS[estado] ?? MENSAGENS.bloqueado,
    podeTentarNovamente: estado === "recusado" || estado === "nao_enviado",
  };
  if (e.totalCentavos !== undefined) r.totalCentavos = e.totalCentavos; // so pedidos de carrinho
  return r;
}

async function iniciarBackend({ envPath, fetchImpl, timeoutMs }) {
  const caminhos = resolverCaminhos({ CONNECTOR_ENV_PATH: envPath }, PACOTE_CONECTOR);
  const meta = await carregarMeta(caminhos.metaPath);
  if (meta.codStore !== COD_STORE_TESTE) {
    throw new ErroConector("LOJA_NAO_PERMITIDA", "A loja configurada não é a loja de teste autorizada.");
  }
  const secret = await lerSegredo(caminhos.envPath);
  const cliente = criarHttp({ fetchImpl, timeoutMs });
  const { token } = await obterToken({ http: cliente, caminhos, meta, secret });
  const { link } = await pedirLinkCatalogo({ http: cliente, token, segredos: [secret, meta.idPartner, token] });
  await baixarCatalogo({ link, destino: caminhos.catalogPath, fetchImpl, timeoutMs });
  const catalogo = await carregarCatalogo(caminhos.catalogPath);
  const item = localizarCodigo(catalogo, CODIGO_PRODUTO, "item");
  if (item.centavos !== 0) {
    throw new ErroConector("PRODUTO_DIVERGENTE", "O produto do cardápio não tem preço zero; etapa bloqueada.");
  }
  return { caminhos, meta, catalogo, item: { codigo: item.codigo, nome: item.descricao, centavos: item.centavos } };
}

async function carregarEstado(caminho) {
  const bruto = await lerJsonOpcional(caminho); // corrompido => erro, nunca recomeca do zero
  const estado = { v: 1, proximaSenha: SENHA_INICIAL, chaves: {} };
  if (bruto === null) return { estado, alterado: false };
  if (!bruto || typeof bruto !== "object" || bruto.v !== 1 ||
      typeof bruto.chaves !== "object" || bruto.chaves === null || Array.isArray(bruto.chaves) ||
      !Number.isSafeInteger(bruto.proximaSenha) || bruto.proximaSenha < SENHA_INICIAL ||
      Object.entries(bruto.chaves).some(([k,e]) => !UUID.test(k) || !e || typeof e !== "object" ||
        !/^[a-f0-9]{64}$/.test(e.hash ?? "") || !Number.isSafeInteger(e.senha) ||
        e.senha < SENHA_INICIAL || e.senha >= bruto.proximaSenha ||
        !["reservado","preparado","enviando","aceito","ambiguo","bloqueado","recusado","nao_enviado"].includes(e.estado) ||
        (e.orderId !== null && !/^HML-[A-Za-z0-9-]+$/.test(e.orderId ?? "")) || !preparoValido(e))) {
    throw new ErroConector("ESTADO_INVALIDO", "Arquivo de estado da tela inválido; não foi sobrescrito.");
  }
  const pids = Object.values(bruto.chaves).map((e) => e.pid).filter((p) => p !== undefined);
  if (new Set(pids).size !== pids.length) {
    throw new ErroConector("ESTADO_INVALIDO", "Arquivo de estado da tela inválido; não foi sobrescrito.");
  }
  estado.chaves = bruto.chaves;
  estado.proximaSenha = Math.max(SENHA_INICIAL, Number.isInteger(bruto.proximaSenha) ? bruto.proximaSenha : 0);
  let alterado = false;
  for (const e of Object.values(estado.chaves)) {
    if (e.estado === "enviando") { e.estado = "ambiguo"; alterado = true; }
    else if (e.estado === "reservado" || e.estado === "preparado") { e.estado = "bloqueado"; alterado = true; }
    else if (e.estado === "aceito" && !e.preparo) {
      // Migracao de aceitos antigos: so estado local, nenhum POST.
      e.pid = e.pid ?? randomUUID();
      e.preparo = { estado: "PREPARANDO", desde: Number.isNaN(Date.parse(e.criadoEm)) ? new Date().toISOString() : e.criadoEm };
      alterado = true;
    }
  }
  return { estado, alterado };
}

const PREPARO = ["PREPARANDO", "PRONTO", "RETIRADO", "CANCELADO"];
const dataOk = (v) => typeof v === "string" && !Number.isNaN(Date.parse(v));

function preparoValido(e) {
  // Campos do modo automatico (opcionais; pedidos antigos seguem validos): modo TAKEOUT <=> fonte webhook.
  if ((e.modo === undefined) !== (e.fonte === undefined)) return false;
  if (e.modo !== undefined && (e.modo !== MODO_AUTOMATICO || e.fonte !== FONTE_WEBHOOK)) return false;
  if (!avisosValidos(e.saipos) || (e.saipos !== undefined && e.modo === undefined)) return false;
  if (e.preparo?.estado === "CANCELADO" && (e.modo === undefined || !dataOk(e.preparo.canceladoEm))) return false;
  if (e.prontoAoConcluirHml !== undefined && (e.prontoAoConcluirHml !== true || e.modo === undefined)) return false;
  if (e.pid !== undefined && !(typeof e.pid === "string" && UUID.test(e.pid))) return false;
  if (e.acoes !== undefined && (typeof e.acoes !== "object" || e.acoes === null || Array.isArray(e.acoes) ||
      Object.entries(e.acoes).some(([k, v]) => !UUID.test(k) || !["pronto", "retirado"].includes(v)))) return false;
  if (e.preparo === undefined) return e.acoes === undefined;
  const p = e.preparo;
  if (!p || typeof p !== "object" || !PREPARO.includes(p.estado) || e.estado !== "aceito" || typeof e.pid !== "string") return false;
  if (!dataOk(p.desde)) return false;
  if (p.semPronto !== undefined && (p.semPronto !== true || p.estado !== "RETIRADO" || e.modo === undefined)) return false;
  if (p.estado !== "PREPARANDO" && p.estado !== "CANCELADO" && p.semPronto !== true && !dataOk(p.prontoEm)) return false;
  if (p.estado === "RETIRADO" && !dataOk(p.retiradoEm)) return false;
  return true;
}

const ROTA_ACAO = /^\/api\/hml\/preparo\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\/(pronto|retirado)$/i;

// gamaPath: DTO do cardapio (padrao data/gama-cardapio.json); mapPath: mapa Gama->HML ao lado do .env
// (padrao gama-hml-map.json); agora: relogio injetavel (testes).
// tvAutomatica (opt-in, padrao null = comportamento legado TICKET + botoes locais):
//   { webhook: { segredo: <64hex privado>, porta?: 4656 (0 = efemera, testes) } }
// Liga pedidos de carrinho em TAKEOUT e o receptor 127.0.0.1 separado; fecha junto com o servidor.
export async function criarServidorHml({ envPath, fetchImpl = globalThis.fetch, timeoutMs, gamaPath = DTO_PADRAO, mapPath, agora = () => new Date(), tvAutomatica = null } = {}) {
  if (tvAutomatica !== null && !segredoValido(tvAutomatica?.webhook?.segredo)) {
    throw new ErroConector("WEBHOOK_CONFIG_INVALIDA", "Configuração do webhook inválida.");
  }
  if (tvAutomatica !== null && tvAutomatica.webhook.prontoAoConcluirHml !== undefined && typeof tvAutomatica.webhook.prontoAoConcluirHml !== "boolean") {
    throw new ErroConector("WEBHOOK_CONFIG_INVALIDA", "Configuração do webhook inválida.");
  }
  const prontoAoConcluirHml = tvAutomatica?.webhook?.prontoAoConcluirHml === true; // so apos guardas de loja (iniciarBackend) vale para novos pedidos
  // Guardas de loja (UUID/storeId/ambiente) e credencial rodam ANTES de qualquer rede/mutacao.
  const { caminhos, meta, item, catalogo } = await iniciarBackend({ envPath, fetchImpl, timeoutMs });
  const cliente = criarHttp({ fetchImpl, timeoutMs });

  // Cardapio completo: falha aqui NAO derruba o fluxo legado; so deixa o cardapio indisponivel.
  let cardapio = null;
  try {
    const dto = await carregarDto(gamaPath);
    const mapa = await carregarMapa(mapPath ?? join(caminhos.dir, "gama-hml-map.json"), meta.codStore, dto);
    cardapio = { ctx: { dto, mapa, catalogo } };
  } catch { /* cardapio indisponivel */ }
  const statePath = join(caminhos.dir, "ui-hml-state.json");
  const { estado, alterado } = await carregarEstado(statePath);
  const salvar = () => gravarJsonAtomico(statePath, estado);
  if (alterado) await salvar();
  const csrf = randomBytes(24).toString("hex");

  let fila = Promise.resolve();
  const serial = (fn) => {
    const p = fila.then(fn);
    fila = p.then(() => {}, () => {});
    return p;
  };

  async function mudar(e, patch) {
    Object.assign(e, patch);
    try { await salvar(); } catch { /* ja enviado ou bloqueado: estado em memoria vale */ }
  }

  async function executar(chave, corpo) {
    const hash = hashPedido(corpo);
    const existente = estado.chaves[chave];
    if (existente) {
      return existente.hash === hash
        ? { status: 200, corpo: resumir(existente) }
        : { status: 409, corpo: erro("chave_reutilizada") };
    }
    if (!corpoValido(corpo)) return { status: 400, corpo: erro("pedido_invalido") };

    const senha = Math.max(estado.proximaSenha, SENHA_INICIAL);
    const e = { hash, estado: "reservado", senha, orderId: null, criadoEm: new Date().toISOString() };
    estado.chaves[chave] = e;
    estado.proximaSenha = senha + 1;
    try {
      await salvar();
    } catch {
      delete estado.chaves[chave];
      estado.proximaSenha = senha;
      return { status: 500, corpo: erro("interno") };
    }

    let prep;
    try {
      prep = await preparar({
        caminhos, meta,
        opcoes: { itemCodigo: CODIGO_PRODUTO, complementos: [], paymentCode: PAGAMENTO_CODIGO, pagamentoZero: true, senha },
      });
      if (prep.item.codigo !== CODIGO_PRODUTO || prep.totalCentavos !== 0 || prep.pagamentoCentavos !== 0 || prep.complementos.length !== 0) {
        throw new ErroConector("RESUMO_DIVERGENTE", "Resumo divergente.");
      }
    } catch {
      await mudar(e, { estado: "nao_enviado" });
      return { status: 200, corpo: resumir(e) };
    }

    // Mapeamento chave -> orderId persistido ANTES de enviar.
    e.orderId = prep.orderId;
    e.estado = "enviando";
    try {
      await salvar();
    } catch {
      e.estado = "bloqueado";
      return { status: 200, corpo: resumir(e) };
    }

    try {
      const r = await enviar({ http: cliente, caminhos, meta, secret: await lerSegredo(caminhos.envPath), orderId: prep.orderId, sandbox: true });
      const mapa = { aceito_pela_api: "aceito", ambiguo: "ambiguo", recusado: "recusado" };
      const novo = mapa[r.estado] ?? "ambiguo";
      const extra = novo === "aceito" ? { pid: randomUUID(), preparo: { estado: "PREPARANDO", desde: new Date().toISOString() } } : {};
      await mudar(e, { estado: novo, httpStatus: r.httpStatus ?? null, ...extra });
    } catch (err) {
      const antesDaRede = err instanceof ErroConector && err.codigo !== "JA_TENTADO";
      await mudar(e, { estado: antesDaRede ? "nao_enviado" : "ambiguo" });
    }
    return { status: 200, corpo: resumir(e) };
  }

  // Pedido do carrinho (formato preparado 2). Valida TUDO em memoria antes de reservar qualquer coisa:
  // mapa ausente/invalido, item nao pronto, horario, limites => resposta sem auth/prepare/ledger/contador.
  async function executarCarrinho(chave, corpo) {
    const hash = hashCarrinho(corpo);
    const existente = estado.chaves[chave];
    if (existente) {
      return existente.hash === hash
        ? { status: 200, corpo: resumir(existente) }
        : { status: 409, corpo: erro("chave_reutilizada") };
    }
    if (!cardapio) return { status: 503, corpo: erro("cardapio_indisponivel") };
    let val;
    try {
      val = validarCarrinho(cardapio.ctx, corpo, agora());
    } catch (err) {
      if (err instanceof ErroCardapio) return { status: err.status, corpo: { erro: err.codigo, mensagem: err.message, motivo: err.motivo ?? null } };
      throw err;
    }

    const senha = Math.max(estado.proximaSenha, SENHA_INICIAL);
    const e = {
      hash, tipo: "carrinho", estado: "reservado", senha, orderId: null, criadoEm: agora().toISOString(),
      totalCentavos: val.totalCentavos, resumoCarrinho: val.resumo,
      ...(tvAutomatica ? { modo: MODO_AUTOMATICO, fonte: FONTE_WEBHOOK, ...(prontoAoConcluirHml ? { prontoAoConcluirHml: true } : {}) } : {}), // persistido antes da rede
    };
    estado.chaves[chave] = e;
    estado.proximaSenha = senha + 1;
    try {
      await salvar();
    } catch {
      delete estado.chaves[chave];
      estado.proximaSenha = senha;
      return { status: 500, corpo: erro("interno") };
    }

    let prep;
    try {
      prep = await prepararCarrinho({ caminhos, meta, itens: val.itensHml, paymentCode: PAGAMENTO_CODIGO, senha, agora: agora(), mode: tvAutomatica ? MODO_AUTOMATICO : "TICKET" });
      if (prep.totalCentavos !== val.totalCentavos) throw new ErroConector("RESUMO_DIVERGENTE", "Resumo divergente.");
    } catch {
      await mudar(e, { estado: "nao_enviado" });
      return { status: 200, corpo: resumir(e) };
    }

    e.orderId = prep.orderId; // mapeamento chave -> orderId persistido ANTES de enviar
    e.estado = "enviando";
    try {
      await salvar();
    } catch {
      e.estado = "bloqueado";
      return { status: 200, corpo: resumir(e) };
    }

    try {
      const r = await enviarCarrinho({ http: cliente, caminhos, meta, secret: await lerSegredo(caminhos.envPath), orderId: prep.orderId, sandbox: true });
      const mapa = { aceito_pela_api: "aceito", ambiguo: "ambiguo", recusado: "recusado" };
      const novo = mapa[r.estado] ?? "ambiguo";
      const extra = novo === "aceito" ? { pid: randomUUID(), preparo: { estado: "PREPARANDO", desde: new Date().toISOString() } } : {};
      await mudar(e, { estado: novo, httpStatus: r.httpStatus ?? null, ...extra });
    } catch (err) {
      const antesDaRede = err instanceof ErroConector && err.codigo !== "JA_TENTADO";
      await mudar(e, { estado: antesDaRede ? "nao_enviado" : "ambiguo" });
    }
    return { status: 200, corpo: resumir(e) };
  }

  // Preparo e estado LOCAL da nossa cozinha/TV; nunca vai ao Saipos.
  function aceitos() {
    return Object.values(estado.chaves).filter((e) => e.estado === "aceito" && e.preparo && e.pid);
  }

  function listarPreparo() {
    const lista = aceitos();
    const porSenha = (a, b) => a.senha - b.senha;
    return {
      preparando: lista.filter((e) => e.preparo.estado === "PREPARANDO").sort(porSenha)
        .map((e) => ({ id: e.pid, senha: e.senha, desde: e.preparo.desde, ...(e.fonte === FONTE_WEBHOOK ? { auto: true } : {}) })),
      pronto: lista.filter((e) => e.preparo.estado === "PRONTO")
        .sort((a, b) => Date.parse(a.preparo.prontoEm) - Date.parse(b.preparo.prontoEm) || porSenha(a, b))
        .map((e) => ({ id: e.pid, senha: e.senha, desde: e.preparo.desde, prontoEm: e.preparo.prontoEm })),
      // semPronto = encerrado pelo Saipos sem PRONTO: nao e retirada fisica, fica fora de "retirados".
      retirados: lista.filter((e) => e.preparo.estado === "RETIRADO" && !e.preparo.semPronto)
        .sort((a, b) => Date.parse(b.preparo.retiradoEm) - Date.parse(a.preparo.retiradoEm) || b.senha - a.senha)
        .slice(0, 10)
        .map((e) => ({ senha: e.senha, retiradoEm: e.preparo.retiradoEm })),
      encerrados: lista.filter((e) => e.preparo.estado === "RETIRADO" && e.preparo.semPronto === true)
        .sort((a, b) => Date.parse(b.preparo.retiradoEm) - Date.parse(a.preparo.retiradoEm) || b.senha - a.senha)
        .slice(0, 10)
        .map((e) => ({ senha: e.senha, encerradoEm: e.preparo.retiradoEm })),
      geradoEm: new Date().toISOString(),
    };
  }

  async function executarAcao(pid, acao, actionKey) {
    const e = aceitos().find((x) => x.pid === pid);
    if (!e) return { status: 404, corpo: erro("nao_encontrado") };
    const visao = () => ({ id: e.pid, senha: e.senha, preparo: e.preparo.estado, prontoEm: e.preparo.prontoEm ?? null, retiradoEm: e.preparo.retiradoEm ?? null });
    if (e.acoes?.[actionKey]) {
      return e.acoes[actionKey] === acao ? { status: 200, corpo: visao() } : { status: 409, corpo: erro("transicao_invalida") };
    }
    if (acao === "pronto" && e.fonte === FONTE_WEBHOOK) return { status: 409, corpo: erro("pronto_automatico") }; // TV segue o Saipos
    const atual = e.preparo.estado;
    const alvo = acao === "pronto" ? "PRONTO" : "RETIRADO";
    if (atual === alvo) return { status: 200, corpo: visao() }; // ja efetivada: sem novo evento
    const valida = (acao === "pronto" && atual === "PREPARANDO") || (acao === "retirado" && atual === "PRONTO");
    if (!valida) return { status: 409, corpo: erro("transicao_invalida") };

    const antes = { preparo: e.preparo, acoes: e.acoes };
    const agora = new Date().toISOString();
    e.preparo = { ...e.preparo, estado: alvo, [acao === "pronto" ? "prontoEm" : "retiradoEm"]: agora };
    e.acoes = { ...(e.acoes ?? {}), [actionKey]: acao };
    try {
      await salvar(); // gravacao atomica ANTES de responder
    } catch {
      e.preparo = antes.preparo;
      if (antes.acoes === undefined) delete e.acoes; else e.acoes = antes.acoes;
      return { status: 500, corpo: erro("interno") };
    }
    return { status: 200, corpo: visao() };
  }

  // Aviso Saipos: mesma fila serial dos demais comandos; grava atomico ANTES de resolver (ack) e desfaz se o disco falhar.
  // Se um POST /order esta em andamento, o aviso espera a fila e so entao e aplicado ao pedido ja resolvido.
  async function aplicarAvisoSaipos({ event, orderId }) {
    const e = Object.values(estado.chaves).find((x) => x.orderId === orderId);
    if (!e) return { resultado: "ignorado" }; // id desconhecido: nada muda
    const antes = { saipos: e.saipos, preparo: e.preparo };
    const r = aplicarAviso(e, event, new Date().toISOString());
    if (!r.mudou) return { resultado: r.resultado };
    try {
      await salvar();
    } catch {
      if (antes.saipos === undefined) delete e.saipos; else e.saipos = antes.saipos;
      if (antes.preparo === undefined) delete e.preparo; else e.preparo = antes.preparo;
      throw new Error("persistencia");
    }
    return { resultado: r.resultado };
  }

  const receptor = tvAutomatica
    ? criarReceptorWebhook({
        segredo: tvAutomatica.webhook.segredo, codStore: meta.codStore,
        porta: tvAutomatica.webhook.porta ?? PORTA_PADRAO,
        aoAviso: (ev) => serial(() => aplicarAvisoSaipos(ev)),
      })
    : null;
  const statusWebhook = () => receptor
    ? receptor.status()
    : { ativo: false, estado: "nao_ligado", ultimoAvisoEm: null };

  function erro(chave) {
    return { erro: chave, mensagem: ERROS[chave] ?? ERROS.interno };
  }

  function responder(res, status, corpo) {
    const dados = JSON.stringify(corpo);
    res.writeHead(status, { ...CABECALHOS, "Content-Type": "application/json; charset=utf-8", "Content-Length": Buffer.byteLength(dados) });
    res.end(dados);
  }

  async function lerCorpo(req) {
    const partes = [];
    let total = 0;
    for await (const p of req) {
      total += p.length;
      if (total > LIMITE_CORPO) return { grande: true };
      partes.push(p);
    }
    try {
      const v = JSON.parse(Buffer.concat(partes).toString("utf8"));
      return v && typeof v === "object" && !Array.isArray(v) ? { valor: v } : { invalido: true };
    } catch {
      return { invalido: true };
    }
  }

  function csrfOk(recebido) {
    if (typeof recebido !== "string") return false;
    const a = Buffer.from(recebido);
    const b = Buffer.from(csrf);
    return a.length === b.length && timingSafeEqual(a, b);
  }

  async function tratar(req, res) {
    const porta = server.address().port;
    const h = req.headers;
    if (h.host !== `127.0.0.1:${porta}`) return responder(res, 403, erro("host_invalido"));
    const url = new URL(req.url, `http://127.0.0.1:${porta}`);
    const caminho = url.pathname;
    // Excecao minima: navegacao GET de documento HTML estatico allowlisted (abrir o app pelo Chrome).
    const docHtmlEstatico = req.method === "GET" && Object.hasOwn(ESTATICOS, caminho) && ESTATICOS[caminho][1].startsWith("text/html") &&
      h["sec-fetch-mode"] === "navigate" && h["sec-fetch-dest"] === "document";
    const site = h["sec-fetch-site"];
    if (site !== undefined && site !== "same-origin" && site !== "none" && !(site === "cross-site" && docHtmlEstatico)) {
      return responder(res, 403, erro("origem_invalida"));
    }

    if (req.method === "GET") {
      const est = ESTATICOS[caminho];
      if (est) {
        try {
          const conteudo = await readFile(join(PUBLIC_DIR, est[0]));
          res.writeHead(200, { ...CABECALHOS, "Content-Type": est[1] });
          return void res.end(conteudo);
        } catch {
          return responder(res, 404, erro("nao_encontrado"));
        }
      }
      if (caminho === "/api/hml/config") {
        return responder(res, 200, {
          csrf,
          loja: meta.expectedName,
          produto: { codigo: item.codigo, nome: item.nome, precoCentavos: item.centavos, preco: reais(item.centavos) },
        });
      }
      const foto = caminho.match(FOTO);
      if (foto) {
        try {
          const conteudo = await readFile(join(PUBLIC_DIR, "gama-fotos", `p${foto[1]}.webp`));
          res.writeHead(200, { ...CABECALHOS, "Content-Type": "image/webp" });
          return void res.end(conteudo);
        } catch {
          return responder(res, 404, erro("nao_encontrado"));
        }
      }
      if (caminho === "/api/hml/cardapio") {
        if (!cardapio) return responder(res, 503, erro("cardapio_indisponivel"));
        return responder(res, 200, montarVisao(cardapio.ctx, agora()));
      }
      if (caminho === "/api/hml/preparo") return responder(res, 200, receptor ? { ...listarPreparo(), webhook: statusWebhook() } : listarPreparo());
      if (caminho === "/api/hml/webhook-status") return responder(res, 200, statusWebhook());
      if (caminho === "/api/hml/status") {
        const chave = url.searchParams.get("chave");
        if (!UUID.test(chave ?? "")) return responder(res, 400, erro("chave_invalida"));
        const e = estado.chaves[chave];
        return responder(res, 200, e ? resumir(e) : { estado: "inexistente", senha: null, orderId: null, mensagem: "", podeTentarNovamente: false });
      }
      return responder(res, 404, erro("nao_encontrado"));
    }

    const acao = req.method === "POST" ? caminho.match(ROTA_ACAO) : null;
    if (acao) {
      if (h.origin !== `http://127.0.0.1:${porta}`) return responder(res, 403, erro("origem_invalida"));
      if (String(h["content-type"] ?? "").split(";")[0].trim().toLowerCase() !== "application/json") return responder(res, 415, erro("tipo_invalido"));
      if (!csrfOk(h["x-csrf-token"])) return responder(res, 403, erro("protecao_invalida"));
      if (Number(h["content-length"] ?? 0) > LIMITE_CORPO) {
        req.resume();
        return responder(res, 413, erro("corpo_grande"));
      }
      const lido = await lerCorpo(req);
      if (lido.grande) return responder(res, 413, erro("corpo_grande"));
      const v = lido.valor;
      if (lido.invalido || Object.keys(v).join() !== "actionKey" || typeof v.actionKey !== "string" || !UUID.test(v.actionKey)) {
        return responder(res, 400, erro("acao_invalida"));
      }
      const r = await serial(() => executarAcao(acao[1].toLowerCase(), acao[2].toLowerCase(), v.actionKey.toLowerCase()));
      return responder(res, r.status, r.corpo);
    }

    if (req.method === "POST" && caminho === "/api/hml/carrinho") {
      if (h.origin !== `http://127.0.0.1:${porta}`) return responder(res, 403, erro("origem_invalida"));
      if (String(h["content-type"] ?? "").split(";")[0].trim().toLowerCase() !== "application/json") return responder(res, 415, erro("tipo_invalido"));
      if (!csrfOk(h["x-csrf-token"])) return responder(res, 403, erro("protecao_invalida"));
      if (Number(h["content-length"] ?? 0) > LIMITE_CORPO) {
        req.resume();
        return responder(res, 413, erro("corpo_grande"));
      }
      const lido = await lerCorpo(req);
      if (lido.grande) return responder(res, 413, erro("corpo_grande"));
      if (lido.invalido) return responder(res, 400, erro("pedido_invalido"));
      if (typeof lido.valor.idempotencyKey !== "string" || !UUID.test(lido.valor.idempotencyKey)) return responder(res, 400, erro("chave_invalida"));
      lido.valor.idempotencyKey = lido.valor.idempotencyKey.toLowerCase();
      const r = await serial(() => executarCarrinho(lido.valor.idempotencyKey, lido.valor));
      return responder(res, r.status, r.corpo);
    }

    if (req.method === "POST" && caminho === "/api/hml/pedido") {
      if (h.origin !== `http://127.0.0.1:${porta}`) return responder(res, 403, erro("origem_invalida"));
      if (String(h["content-type"] ?? "").split(";")[0].trim().toLowerCase() !== "application/json") return responder(res, 415, erro("tipo_invalido"));
      if (!csrfOk(h["x-csrf-token"])) return responder(res, 403, erro("protecao_invalida"));
      if (Number(h["content-length"] ?? 0) > LIMITE_CORPO) {
        req.resume();
        return responder(res, 413, erro("corpo_grande"));
      }
      const lido = await lerCorpo(req);
      if (lido.grande) return responder(res, 413, erro("corpo_grande"));
      if (lido.invalido) return responder(res, 400, erro("pedido_invalido"));
      if (typeof lido.valor.idempotencyKey !== "string" || !UUID.test(lido.valor.idempotencyKey)) return responder(res, 400, erro("chave_invalida"));
      const chave = lido.valor.idempotencyKey.toLowerCase();
      lido.valor.idempotencyKey = chave;
      const r = await serial(() => executar(chave, lido.valor));
      return responder(res, r.status, r.corpo);
    }
    return responder(res, 405, erro("metodo"));
  }

  const server = http.createServer((req, res) => {
    tratar(req, res).catch(() => {
      if (!res.headersSent) responder(res, 500, erro("interno"));
      else res.end();
    });
  });
  // Guard nao desligavel: so loopback.
  const listenBase = (porta, cb) => http.Server.prototype.listen.call(server, porta, "127.0.0.1", cb);
  server.listen = (porta, cb) => {
    if (!receptor) return listenBase(porta, cb);
    // Receptor sobe com o servidor; se a porta do webhook falhar, o servidor principal nao fica meio ligado.
    receptor.iniciar().then(() => listenBase(porta, cb), (err) => server.emit("error", err));
    return server;
  };
  if (receptor) {
    // Os dois listeners vivem e morrem juntos: close() fecha ambos (mesmo sem ter escutado) e erro de listen no principal fecha o receptor.
    const fecharBase = server.close.bind(server);
    server.close = (cb) => {
      const fim = receptor.fechar();
      return fecharBase((err) => { fim.then(() => cb?.(err)); });
    };
    server.prependListener("error", (err) => {
      receptor.fechar();
      if (server.listenerCount("error") === 1) throw err; // ninguem mais ouve: nao engolir
    });
  }
  server.webhookPorta = () => receptor?.porta() ?? null; // so para testes/orquestracao local
  return server;
}
