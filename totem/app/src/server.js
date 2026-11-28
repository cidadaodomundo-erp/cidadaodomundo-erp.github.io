// Servidor HTTP local, isolado. Só escuta em 127.0.0.1. Sem CORS, sem chamadas externas.
// NUNCA conecta ao Saipos real. Uso: criarServidor(store) retorna um http.Server não iniciado.

import http from "node:http";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { PRODUTOS, ADICIONAIS, INGREDIENTES } from "./cardapio.js";
import {
  criarPedido,
  confirmarPagamentoSimulado,
  marcarPronto,
  marcarRetirado,
  cancelarPedido,
  ErroPedido,
} from "./pedidos.js";

const __dirname = fileURLToPath(new URL(".", import.meta.url));
const PUBLIC_DIR = join(__dirname, "..", "public");
const LIMITE_CORPO_BYTES = 64 * 1024;

// Allowlist explícita de arquivos estáticos — sem resolução de caminho livre,
// sem risco de path traversal ou de "sibling prefix" (ex.: pasta "public-x").
const ARQUIVOS_ESTATICOS = {
  "/": { arquivo: "totem.html", tipo: "text/html; charset=utf-8" },
  "/totem.html": { arquivo: "totem.html", tipo: "text/html; charset=utf-8" },
  "/totem.js": { arquivo: "totem.js", tipo: "text/javascript; charset=utf-8" },
  "/cozinha.html": { arquivo: "cozinha.html", tipo: "text/html; charset=utf-8" },
  "/cozinha.js": { arquivo: "cozinha.js", tipo: "text/javascript; charset=utf-8" },
  "/tv.html": { arquivo: "tv.html", tipo: "text/html; charset=utf-8" },
  "/tv.js": { arquivo: "tv.js", tipo: "text/javascript; charset=utf-8" },
  "/estilo.css": { arquivo: "estilo.css", tipo: "text/css; charset=utf-8" },
};

function enviarJson(res, status, corpo) {
  const dados = JSON.stringify(corpo);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(dados),
  });
  res.end(dados);
}

function hostPermitido(req) {
  const host = req.headers.host || "";
  return /^(127\.0\.0\.1|localhost)(:\d+)?$/.test(host);
}

async function lerCorpoJson(req) {
  const partes = [];
  let total = 0;
  for await (const pedaco of req) {
    total += pedaco.length;
    if (total > LIMITE_CORPO_BYTES) {
      throw new ErroPedido(`Corpo da requisição excede o limite de ${LIMITE_CORPO_BYTES} bytes.`, "CORPO_MUITO_GRANDE");
    }
    partes.push(pedaco);
  }
  const texto = Buffer.concat(partes).toString("utf8");
  if (!texto) return {};
  try {
    return JSON.parse(texto);
  } catch {
    throw new ErroPedido("JSON inválido no corpo da requisição.", "JSON_INVALIDO");
  }
}

async function servirArquivoEstatico(req, res) {
  const caminho = req.url.split("?")[0];
  const entrada = ARQUIVOS_ESTATICOS[caminho];
  if (!entrada) {
    res.writeHead(404).end("Não encontrado.");
    return;
  }
  try {
    const conteudo = await readFile(join(PUBLIC_DIR, entrada.arquivo));
    res.writeHead(200, { "Content-Type": entrada.tipo });
    res.end(conteudo);
  } catch {
    res.writeHead(404).end("Não encontrado.");
  }
}

export function criarServidor(store) {
  const servidor = http.createServer(async (req, res) => {
    try {
      if (!hostPermitido(req)) {
        return enviarJson(res, 403, { erro: "Host não permitido. Este laboratório só aceita 127.0.0.1/localhost.", codigo: "HOST_NAO_PERMITIDO" });
      }

      const url = new URL(req.url, "http://127.0.0.1");
      if (req.method === "POST") {
        const origem = req.headers.origin;
        if (req.headers["sec-fetch-site"] === "cross-site" ||
            (origem && origem !== `http://${req.headers.host}`)) {
          return enviarJson(res, 403, { erro: "Origem externa não permitida.", codigo: "ORIGEM_NAO_PERMITIDA" });
        }
        if (!/^application\/json(?:;|$)/i.test(req.headers["content-type"] || "")) {
          return enviarJson(res, 415, { erro: "Envie dados JSON.", codigo: "FORMATO_INVALIDO" });
        }
      }

      if (req.method === "GET" && url.pathname === "/api/cardapio") {
        return enviarJson(res, 200, { produtos: PRODUTOS, adicionais: ADICIONAIS, ingredientes: INGREDIENTES });
      }

      if (req.method === "GET" && url.pathname === "/api/pedidos") {
        return enviarJson(res, 200, { pedidos: store.listarPedidos() });
      }

      if (req.method === "POST" && url.pathname === "/api/pedidos") {
        const corpo = await lerCorpoJson(req);
        const pedido = await store.transacao((estado) => criarPedido(estado, corpo));
        return enviarJson(res, 201, { pedido });
      }

      const matchAcao = url.pathname.match(
        /^\/api\/pedidos\/([a-f0-9-]+)\/(pagamento-simulado|pronto|retirado|cancelar)$/
      );
      if (req.method === "POST" && matchAcao) {
        const [, id, acao] = matchAcao;
        const corpo = await lerCorpoJson(req);

        if (acao === "pagamento-simulado") {
          const pedido = await store.transacao((estado) => confirmarPagamentoSimulado(estado, id, corpo));
          const status = pedido.pagamento?.resultado === "aprovado" ? 200 : 400;
          return enviarJson(res, status, status === 200
            ? { pedido }
            : { pedido, erro: "Pagamento simulado não aprovado.", codigo: "PAGAMENTO_NAO_APROVADO" });
        }

        if (acao === "pronto") {
          const pedido = await store.transacao((estado) => marcarPronto(estado, id));
          return enviarJson(res, 200, { pedido });
        }
        if (acao === "retirado") {
          const pedido = await store.transacao((estado) => marcarRetirado(estado, id));
          return enviarJson(res, 200, { pedido });
        }
        if (acao === "cancelar") {
          const pedido = await store.transacao((estado) => cancelarPedido(estado, id));
          return enviarJson(res, 200, { pedido });
        }
      }

      if (req.method === "GET") {
        return servirArquivoEstatico(req, res);
      }

      return enviarJson(res, 404, { erro: "Rota não encontrada." });
    } catch (erro) {
      if (erro instanceof ErroPedido) {
        return enviarJson(res, erro.codigo === "PEDIDO_NAO_ENCONTRADO" ? 404 : 400, { erro: erro.message, codigo: erro.codigo });
      }
      return enviarJson(res, 500, { erro: "Erro interno no laboratório.", detalhe: erro.message });
    }
  });

  return servidor;
}

export function iniciarServidorEfemero(store, porta = 0) {
  return new Promise((resolve) => {
    const servidor = criarServidor(store);
    servidor.listen(porta, "127.0.0.1", () => {
      resolve(servidor);
    });
  });
}
