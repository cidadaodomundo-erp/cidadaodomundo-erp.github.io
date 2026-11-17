// Pix na tela do totem, pelo padrao oficial do Banco Central (API Pix: /cob).
// Funciona com o banco da conta PJ que receber o Pix. Nada aqui tem chave ou senha:
// o acesso ao banco (token, certificado) vem de fora, pelo "banco" injetado.
//
// Encaixa no src/pagamento.js como adaptador: cobrar() cria a cobranca e devolve
// "aguardando" com o QR (copia e cola); consultar() pergunta ao banco se foi paga.
// Pagamento so conta como aprovado quando o banco diz CONCLUIDA com o valor exato.

const TXID = /^[a-zA-Z0-9]{26,35}$/;
export const VALIDADE_SEGUNDOS = 300; // 5 minutos na tela

// txid aceito pelo BC: 26 a 35 letras/numeros. Derivado da chave do pedido,
// assim o mesmo pedido sempre gera o mesmo txid (nunca duas cobrancas).
export function txidDoPedido(idempotencyKey) {
  const limpo = String(idempotencyKey).replace(/[^a-zA-Z0-9]/g, "");
  const txid = ("CDM" + limpo).slice(0, 35).padEnd(26, "0");
  if (!TXID.test(txid)) throw new Error("txid invalido");
  return txid;
}

const reais = (centavos) => (centavos / 100).toFixed(2);

// banco: { criarCobranca(txid, corpo), consultarCobranca(txid) } -> respostas no formato do BC.
// chavePix: chave Pix da loja (CNPJ ou aleatoria), informada na configuracao do servidor.
// banco.removerCobranca(txid) e opcional (PATCH /cob/{txid} status REMOVIDA_PELO_USUARIO_RECEBEDOR).
// QR vencido (ATIVA depois de criacao + expiracao + folga) conta como cancelado: o BC nao aceita mais pagar.
export const FOLGA_VENCIMENTO_MS = 60_000;

export function adaptadorPix({ banco, chavePix, descricao = "Cidadao do Mundo - Totem", agora = () => Date.now() }) {
  if (!banco || typeof banco.criarCobranca !== "function" || typeof banco.consultarCobranca !== "function") {
    throw new Error("banco Pix invalido");
  }
  if (typeof chavePix !== "string" || chavePix.trim().length < 5) throw new Error("chave Pix ausente");

  function traduzir(cob, centavos) {
    const status = cob && cob.status;
    if (status === "CONCLUIDA") {
      const pago = Math.round(Number(cob.valor?.original) * 100);
      return { estado: "aprovado", centavos: pago, autorizacao: cob.txid || null };
    }
    if (status === "REMOVIDA_PELO_USUARIO_RECEBEDOR" || status === "REMOVIDA_PELO_PSP") {
      return { estado: "cancelado", motivo: status };
    }
    if (status === "ATIVA") {
      const criacao = Date.parse(cob.calendario?.criacao ?? "");
      const exp = Number(cob.calendario?.expiracao ?? VALIDADE_SEGUNDOS);
      if (Number.isFinite(criacao) && agora() > criacao + exp * 1000 + FOLGA_VENCIMENTO_MS) {
        return { estado: "cancelado", motivo: "QR_VENCIDO" };
      }
      const r = { estado: "aguardando", qr: cob.pixCopiaECola || null, centavos };
      if (Number.isFinite(criacao)) r.expiraEm = new Date(criacao + exp * 1000).toISOString();
      return r;
    }
    return { estado: "incerto" };
  }

  return {
    async cobrar({ idempotencyKey, centavos, forma }) {
      if (forma !== "pix") throw new Error("este adaptador so faz Pix");
      const txid = txidDoPedido(idempotencyKey);
      const cob = await banco.criarCobranca(txid, {
        calendario: { expiracao: VALIDADE_SEGUNDOS },
        valor: { original: reais(centavos) },
        chave: chavePix.trim(),
        solicitacaoPagador: descricao.slice(0, 140),
      });
      return traduzir(cob, centavos);
    },
    async consultar({ idempotencyKey }) {
      const cob = await banco.consultarCobranca(txidDoPedido(idempotencyKey));
      return traduzir(cob);
    },
    async cancelar({ idempotencyKey }) {
      if (typeof banco.removerCobranca === "function") await banco.removerCobranca(txidDoPedido(idempotencyKey));
    },
  };
}

// Banco de mentira para testes. Nao fala com nenhum banco.
export function bancoPixSimulado({ agora = () => Date.now() } = {}) {
  const cobrancas = new Map();
  let criadas = 0;
  return {
    get criadas() { return criadas; },
    async criarCobranca(txid, corpo) {
      if (!cobrancas.has(txid)) {
        criadas += 1;
        cobrancas.set(txid, { txid, status: "ATIVA", calendario: { criacao: new Date(agora()).toISOString(), expiracao: corpo.calendario.expiracao }, valor: { original: corpo.valor.original }, pixCopiaECola: "00020126SIMULADO" + txid });
      }
      return { ...cobrancas.get(txid) };
    },
    async consultarCobranca(txid) {
      const c = cobrancas.get(txid);
      return c ? { ...c } : { status: "DESCONHECIDA" };
    },
    async removerCobranca(txid) {
      const c = cobrancas.get(txid);
      if (c && c.status === "ATIVA") c.status = "REMOVIDA_PELO_USUARIO_RECEBEDOR";
    },
    pagar(txid, valorOriginal) {
      const c = cobrancas.get(txid);
      if (!c || c.status !== "ATIVA") return false; // removida/vencida nao recebe

      c.status = "CONCLUIDA";
      if (valorOriginal) c.valor = { original: valorOriginal };
      return true;
    },
    expirar(txid) { cobrancas.get(txid).status = "REMOVIDA_PELO_PSP"; },
  };
}
