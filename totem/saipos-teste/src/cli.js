// Comandos: setup | test | catalog [--download] | prepare ... | send --order <id> --sandbox
// Toda saida passa por emitir(): so resumos, com segredo/token/idPartner redigidos.

import { resolverCaminhos, setup, lerSegredo, carregarMeta } from "./config.js";
import { criarHttp } from "./http.js";
import { obterToken } from "./auth.js";
import { pedirLinkCatalogo, baixarCatalogo } from "./catalogo.js";
import { preparar, enviar } from "./envio.js";
import { ErroConector, redigir } from "./erros.js";

const AJUDA = `saipos-teste (loja TESTE/DEV; CONNECTOR_ENV_PATH obrigatorio, caminho absoluto fora de outputs/)
  setup                         cria .env vazio se ausente
  where                         mostra apenas o caminho privado de configuração
  test                          auth + pede link do catalogo (sem baixar)
  catalog [--download]          pede link; com --download baixa p/ catalogo-teste.json
  prepare --item COD [--choice COD]... --payment-code COD [--payment-zero] [--senha N] [--item-note TXT]
  send --order HML-... --sandbox
`;

function lerArgs(args) {
  const o = { choice: [] };
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    const proximo = () => {
      const v = args[++i];
      if (v === undefined || v.startsWith("--")) throw new ErroConector("ARGUMENTO_INVALIDO", `${a} exige um valor.`);
      return v;
    };
    if (a === "--item") o.item = proximo();
    else if (a === "--choice") o.choice.push(proximo());
    else if (a === "--payment-code") o.paymentCode = proximo();
    else if (a === "--senha") o.senha = proximo();
    else if (a === "--item-note") o.itemNota = proximo();
    else if (a === "--order") o.order = proximo();
    else if (a === "--payment-zero") o.pagamentoZero = true;
    else if (a === "--sandbox") o.sandbox = true;
    else if (a === "--download") o.download = true;
    else throw new ErroConector("ARGUMENTO_DESCONHECIDO", `Argumento desconhecido: ${a}`);
  }
  return o;
}

const reais = (c) => (c / 100).toFixed(2);

export async function principal(argv, { env = process.env, fetchImpl = globalThis.fetch, saida = (t) => process.stdout.write(t), pacoteDir, agora = Date.now, timeoutMs } = {}) {
  const segredos = [];
  const emitir = (obj) => saida(`${redigir(JSON.stringify(obj, null, 2), segredos)}\n`);

  try {
    const [comando, ...resto] = argv;
    if (!comando || comando === "help" || comando === "--help") {
      saida(AJUDA);
      return 0;
    }
    const args = lerArgs(resto);
    const caminhos = resolverCaminhos(env, pacoteDir);
    if (comando === "where") { emitir({path:caminhos.envPath}); return 0; }

    if (comando === "setup") {
      emitir(await setup(caminhos));
      return 0;
    }
    if (!["test", "catalog", "prepare", "send"].includes(comando)) {
      throw new ErroConector("COMANDO_DESCONHECIDO", `Comando desconhecido: ${comando}`);
    }

    const meta = await carregarMeta(caminhos.metaPath);
    segredos.push(meta.idPartner);
    const http = criarHttp({ fetchImpl, timeoutMs });

    if (comando === "prepare") {
      const opcoes = { itemCodigo: args.item, complementos: args.choice, paymentCode: args.paymentCode, pagamentoZero: args.pagamentoZero === true, senha: args.senha, itemNota: args.itemNota };
      const r = await preparar({ caminhos, meta, opcoes, agora: new Date(agora()) });
      emitir({
        resultado: "preparado_nao_enviado",
        orderId: r.orderId,
        artefato: r.artefato,
        sha256: r.sha256,
        senhaNossa: r.senha,
        item: { codigo: r.item.codigo, descricao: r.item.descricao, preco: reais(r.item.centavos) },
        complementos: r.complementos.map((c) => ({ codigo: c.codigo, descricao: c.descricao, preco: reais(c.centavos) })),
        totalReais: reais(r.totalCentavos),
        pagamento: { valorReais: reais(r.pagamentoCentavos), observacao: "metadado de teste; nada e cobrado" },
      });
      return 0;
    }

    const secret = await lerSegredo(caminhos.envPath);
    segredos.push(secret);

    if (comando === "send") {
      const r = await enviar({ http, caminhos, meta, secret, orderId: args.order, sandbox: args.sandbox === true, agora });
      emitir({ resultado: r.estado, ...r });
      return r.estado === "aceito_pela_api" ? 0 : 2;
    }

    const auth = await obterToken({ http, caminhos, meta, secret, agora });
    segredos.push(auth.token);
    const resumoAuth = { origem: auth.origem, expiraEm: auth.expiraEm ?? "nao legivel no token" };
    const { link, host } = await pedirLinkCatalogo({ http, token: auth.token, segredos });
    segredos.push(link);

    const saidaBase = { loja: { storeId: meta.storeId, codStore: meta.codStore, nome: meta.expectedName }, auth: resumoAuth, catalogo: { linkObtido: true, hostDoLink: host } };
    if (comando === "catalog" && args.download) {
      const d = await baixarCatalogo({ link, destino: caminhos.catalogPath, fetchImpl, timeoutMs });
      saidaBase.catalogo = { ...saidaBase.catalogo, baixado: true, linhas: d.linhas, codigosDistintos: d.codigosDistintos, arquivo: "catalogo-teste.json (privado)" };
    }
    emitir({ resultado: "ok", ...saidaBase });
    return 0;
  } catch (erro) {
    if (erro instanceof ErroConector) {
      saida(`${redigir(JSON.stringify({ erro: erro.codigo, mensagem: erro.message, detalhes: erro.detalhes }, null, 2), segredos)}\n`);
      return 1;
    }
    saida(`${JSON.stringify({ erro: "ERRO_INTERNO", mensagem: redigir(erro?.message ?? "erro", segredos).slice(0, 200) })}\n`);
    return 1;
  }
}
