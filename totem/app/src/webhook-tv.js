// TV automatica (HML): receptor ISOLADO de avisos Saipos + regra pura de transicao.
// Contrato oficial (eventos-pedido): POST {event, cod_store, order_id}.
//   TAKEOUT/DELIVERY: CONFIRMED, READY_TO_DELIVER, DISPATCHED, CONCLUDED, CANCELLED.
//   TICKET: so CONFIRMED, CONCLUDED, CANCELLED (nao existe "pronto") -> TICKET nunca vira PRONTO.
// Este modulo NAO faz rede de saida, nao serve UI/arquivos e nao registra nada em log.

import http from "node:http";
import { readFile } from "node:fs/promises";
import { isAbsolute } from "node:path";
import { timingSafeEqual } from "node:crypto";

export const FONTE_WEBHOOK = "saipos-webhook";
export const MODO_AUTOMATICO = "TAKEOUT";
export const EVENTOS = ["CONFIRMED", "READY_TO_DELIVER", "DISPATCHED", "CONCLUDED", "CANCELLED"];
export const PORTA_PADRAO = 4656;
export const LIMITE_CORPO_WEBHOOK = 4096;

const SEGREDO = /^[a-f0-9]{64}$/;
const ORDER_ID = /^HML-[A-Za-z0-9-]{1,100}$/;

export const segredoValido = (s) => typeof s === "string" && SEGREDO.test(s);

// Valida o formato guardado em entry.saipos (usado pelo validador do estado raiz v1).
export function avisosValidos(s) {
  if (s === undefined) return true;
  if (!s || typeof s !== "object" || Array.isArray(s) || Object.keys(s).join() !== "vistos") return false;
  const v = s.vistos;
  if (!v || typeof v !== "object" || Array.isArray(v)) return false;
  return Object.entries(v).every(([k, d]) => EVENTOS.includes(k) && typeof d === "string" && !Number.isNaN(Date.parse(d)));
}

// Regra pura. Muta `e` (entrada de pedido) e devolve { resultado, mudou }.
// - So pedidos criados no modo automatico (modo TAKEOUT + fonte webhook) reagem; legados/TICKET: "ignorado".
// - Guarda apenas o NOME do evento + data (nunca o corpo bruto). Repetido => nada muda.
// - READY_TO_DELIVER: PREPARANDO -> PRONTO (nunca regride RETIRADO/CANCELADO).
// - CANCELLED: sai das filas (CANCELADO), terminal. Evento posterior nao reabre.
// - Comportamento padrao (prontoAoConcluirHml ausente => false na configuracao; so true ativa o opt-in): CONCLUDED/DISPATCHED/CONFIRMED so registrados; RETIRADO continua manual e CONCLUDED nunca vira PRONTO.
//   Opt-in HML explicito (prontoAoConcluirHml === true) e um comportamento separado do padrao, descrito abaixo.
// - Pedido nao aceito (enviando/ambiguo/...): registra, mas NAO promove (nao finge prontidao).
// Politica explicita (derivada SEMPRE de saipos.vistos, entao independe da ordem de chegada):
//   1. CANCELLED visto (qualquer momento, inclusive antes de aceito): PREPARANDO/PRONTO -> CANCELADO (terminal, preserva datas).
//      Cancelamento DEPOIS de RETIRADO so e registrado (historico da retirada nao e reescrito nem reaberto).
//   2. CONCLUDED visto sem pronto: PREPARANDO -> RETIRADO com semPronto:true (encerrado pelo Saipos; nunca "pronto" falso).
//      Com o pedido ja PRONTO, a retirada segue manual.
//   Opt-in HML (e.prontoAoConcluirHml === true, so pedidos novos): CONFIRMED+CONCLUDED (ou READY_TO_DELIVER) => PRONTO; ver ramo abaixo.
//   3. READY_TO_DELIVER so promove PREPARANDO -> PRONTO se NAO houver CANCELLED nem CONCLUDED vistos (READY tardio nao reabre).
export function aplicarAviso(e, evento, iso) {
  if (!e || e.modo !== MODO_AUTOMATICO || e.fonte !== FONTE_WEBHOOK || !EVENTOS.includes(evento)) return { resultado: "ignorado", mudou: false };
  let mudou = false;
  const antes = e.saipos?.vistos ?? {};
  if (!antes[evento]) { e.saipos = { vistos: { ...antes, [evento]: iso } }; mudou = true; }
  const v = e.saipos.vistos;
  const p = e.preparo;
  if (e.estado === "aceito" && p) {
    if (v.CANCELLED && (p.estado === "PREPARANDO" || p.estado === "PRONTO")) {
      e.preparo = { ...p, estado: "CANCELADO", canceladoEm: v.CANCELLED };
      mudou = true;
    } else if (e.prontoAoConcluirHml === true) {
      // Adaptador HML opt-in (so pedido novo marcado): na HML o clique PRONTO da cozinha encerra o Balcao
      // (CONFIRMED -> CONCLUDED, sem READY_TO_DELIVER). CONCLUDED sozinho so aguarda CONFIRMED; nunca cai em RETIRADO semPronto.
      if (!v.CANCELLED && p.estado === "PREPARANDO") {
        if (v.READY_TO_DELIVER) {
          e.preparo = { ...p, estado: "PRONTO", prontoEm: v.READY_TO_DELIVER };
          mudou = true;
        } else if (v.CONFIRMED && v.CONCLUDED) {
          e.preparo = { ...p, estado: "PRONTO", prontoEm: v.CONCLUDED, origemPronto: "CONCLUDED" };
          mudou = true;
        }
      }
    } else if (!v.CANCELLED && v.CONCLUDED && p.estado === "PREPARANDO") {
      e.preparo = { ...p, estado: "RETIRADO", retiradoEm: v.CONCLUDED, semPronto: true };
      mudou = true;
    } else if (!v.CANCELLED && !v.CONCLUDED && v.READY_TO_DELIVER && p.estado === "PREPARANDO") {
      e.preparo = { ...p, estado: "PRONTO", prontoEm: v.READY_TO_DELIVER };
      mudou = true;
    }
  }
  return { resultado: mudou ? "aplicado" : "repetido", mudou };
}

// Config privada: arquivo JSON {segredo: 64hex, porta?} lido por caminho absoluto (nunca por argv/segredo).
export async function lerConfigWebhook(caminho) {
  if (typeof caminho !== "string" || !isAbsolute(caminho)) throw new Error("Caminho da configuração do webhook deve ser absoluto.");
  let c;
  try { c = JSON.parse(await readFile(caminho, "utf8")); } catch { throw new Error("Configuração do webhook ilegível."); }
  if (!c || typeof c !== "object" || !segredoValido(c.segredo)) throw new Error("Configuração do webhook inválida (segredo de 64 hex).");
  const porta = c.porta ?? PORTA_PADRAO;
  if (!Number.isInteger(porta) || porta < 1024 || porta > 65535) throw new Error("Porta do webhook inválida.");
  // Padrao: ausente => false (valor de retorno atual; comportamento padrao, sem opt-in HML). null/outro tipo => rejeita.
  const prontoAoConcluirHml = c.prontoAoConcluirHml === undefined ? false : c.prontoAoConcluirHml;
  if (typeof prontoAoConcluirHml !== "boolean") throw new Error("Configuração do webhook inválida (prontoAoConcluirHml deve ser booleano).");
  return { segredo: c.segredo, porta, prontoAoConcluirHml };
}

function iguais(a, b) {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

// aoAviso({event, orderId}) -> Promise<{resultado}>; deve persistir ANTES de resolver (ack so depois).
// Rejeitar => 500 (Saipos pode reenviar). Sem CORS, sem UI, sem Host/Origin (chamada servidor-a-servidor).
export function criarReceptorWebhook({ segredo, codStore, aoAviso, porta = PORTA_PADRAO, timeoutMs = 15000, agora = () => new Date() }) {
  if (!segredoValido(segredo)) throw new Error("Segredo do webhook inválido.");
  if (typeof codStore !== "string" || !codStore || typeof aoAviso !== "function") throw new Error("Receptor mal configurado.");
  const caminhoSecreto = `/${segredo}`;
  let ultimoAvisoEm = null;
  let ligado = false;

  const responder = (res, status, corpo, extra = {}) => {
    if (res.headersSent || res.writableEnded) return;
    const d = JSON.stringify(corpo);
    res.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Content-Length": Buffer.byteLength(d), "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff", Connection: "close", ...extra });
    res.end(d);
  };

  async function lerCorpo(req) {
    const partes = [];
    let total = 0;
    for await (const p of req) {
      total += p.length;
      if (total > LIMITE_CORPO_WEBHOOK) return { grande: true };
      partes.push(p);
    }
    try {
      const v = JSON.parse(Buffer.concat(partes).toString("utf8"));
      return v && typeof v === "object" && !Array.isArray(v) ? { valor: v } : { invalido: true };
    } catch { return { invalido: true }; }
  }

  async function tratar(req, res) {
    const caminho = String(req.url ?? "").split("?")[0];
    if (!iguais(caminho, caminhoSecreto)) return responder(res, 404, { erro: "nao_encontrado" });
    if (req.method !== "POST") return responder(res, 405, { erro: "metodo" }, { Allow: "POST" });
    if (String(req.headers["content-type"] ?? "").split(";")[0].trim().toLowerCase() !== "application/json") return responder(res, 415, { erro: "tipo_invalido" });
    if (Number(req.headers["content-length"] ?? 0) > LIMITE_CORPO_WEBHOOK) { req.resume(); return responder(res, 413, { erro: "corpo_grande" }); }
    const lido = await lerCorpo(req);
    if (lido.grande) return responder(res, 413, { erro: "corpo_grande" });
    const v = lido.valor;
    if (lido.invalido || typeof v.event !== "string" || typeof v.cod_store !== "string" || typeof v.order_id !== "string") return responder(res, 400, { erro: "aviso_invalido" });
    if (v.cod_store !== codStore) return responder(res, 200, { ok: true, resultado: "ignorado" }); // loja errada: nada muda, sem eco
    ultimoAvisoEm = agora().toISOString();
    if (!EVENTOS.includes(v.event) || !ORDER_ID.test(v.order_id)) return responder(res, 200, { ok: true, resultado: "ignorado" });
    const r = await aoAviso({ event: v.event, orderId: v.order_id });
    return responder(res, 200, { ok: true, resultado: r?.resultado ?? "ignorado" });
  }

  const server = http.createServer((req, res) => {
    const t = setTimeout(() => responder(res, 503, { erro: "ocupado" }), timeoutMs);
    res.on("close", () => clearTimeout(t));
    tratar(req, res).catch(() => responder(res, 500, { erro: "interno" }));
  });
  server.headersTimeout = 5000;
  server.requestTimeout = 10000;
  server.keepAliveTimeout = 1000;
  server.on("listening", () => { ligado = true; });
  server.on("close", () => { ligado = false; });

  return {
    server,
    iniciar: () => new Promise((ok, falha) => {
      server.once("error", falha);
      server.listen(porta, "127.0.0.1", () => { server.off("error", falha); ok(server.address().port); }); // so loopback
    }),
    fechar: () => new Promise((ok) => { if (!server.listening) return ok(); server.close(() => ok()); server.closeAllConnections?.(); }),
    porta: () => server.address()?.port ?? null,
    // Sem segredo/porta/URL. "recebendo" so prova que ja chegou aviso valido desde o inicio; nao prova link vivo agora.
    status: () => ({ ativo: ligado, estado: !ligado ? "nao_ligado" : ultimoAvisoEm ? "recebendo" : "aguardando_avisos", ultimoAvisoEm }),
  };
}
