// Pagamento do totem: regra unica para qualquer TEF (SuperTEF, Saipos, Rede, SiTef, PayGo...) e Pix.
// Nenhuma cobranca real aqui. O adaptador "simulado" so existe para teste.
// Regras:
//  - so "aprovado" libera o pedido para a cozinha;
//  - a mesma chave (idempotencyKey) nunca gera duas cobrancas;
//  - "aguardando" (Pix com QR na tela / maquininha) nao libera; reconsulta ate o banco confirmar;
//  - resposta incerta (queda de rede) fica "incerto" e NAO libera nem cobra de novo:
//    precisa consultar o TEF antes de qualquer nova tentativa;
//  - o registro e gravado (aoMudar) ANTES de pedir a cobranca: se o PC cair no meio,
//    ao voltar o totem sabe que existe uma cobranca e so consulta, nunca cobra de novo;
//  - cancelar so pede ao banco/maquininha para cancelar e depois CONSULTA: se o cliente
//    pagou no ultimo segundo, vale o "aprovado".

export const ESTADOS = Object.freeze({
  AGUARDANDO: "aguardando",
  APROVADO: "aprovado",
  RECUSADO: "recusado",
  CANCELADO: "cancelado",
  INCERTO: "incerto",
});

export const FORMAS = Object.freeze(["debito", "credito", "pix"]);

const FINAIS = new Set([ESTADOS.APROVADO, ESTADOS.RECUSADO, ESTADOS.CANCELADO]);
const TODOS = new Set(Object.values(ESTADOS));
const CAMPOS = ["idempotencyKey", "centavos", "forma", "estado", "criadoEm", "atualizadoEm", "autorizacao", "motivo", "qr", "mensagem", "expiraEm"];

function registroValido(r) {
  return !!r && typeof r === "object" && !Array.isArray(r) &&
    Object.keys(r).every((k) => CAMPOS.includes(k)) &&
    typeof r.idempotencyKey === "string" && r.idempotencyKey.length >= 8 &&
    Number.isInteger(r.centavos) && r.centavos > 0 && FORMAS.includes(r.forma) && TODOS.has(r.estado);
}

export function criarPagamentos({ adaptador, agora = () => new Date().toISOString(), registros: iniciais = [], aoMudar = async () => {} } = {}) {
  if (!adaptador || typeof adaptador.cobrar !== "function" || typeof adaptador.consultar !== "function") {
    throw new Error("adaptador TEF invalido: precisa de cobrar() e consultar()");
  }
  if (!Array.isArray(iniciais) || !iniciais.every(registroValido)) throw new Error("registros de pagamento invalidos");
  const registros = new Map(); // idempotencyKey -> registro
  for (const r of iniciais) {
    const reg = { ...r };
    if (reg.estado === ESTADOS.AGUARDANDO) reg.estado = ESTADOS.INCERTO; // apos reinicio: so consulta
    registros.set(reg.idempotencyKey, reg);
  }
  const lista = () => [...registros.values()].map((r) => ({ ...r }));
  const gravar = async () => { try { await aoMudar(lista()); } catch { /* memoria vale; proxima gravacao tenta de novo */ } };

  function validar({ idempotencyKey, centavos, forma }) {
    if (typeof idempotencyKey !== "string" || idempotencyKey.length < 8) throw new Error("idempotencyKey invalida");
    if (!Number.isInteger(centavos) || centavos <= 0 || centavos > 1_000_000) throw new Error("valor invalido");
    if (!FORMAS.includes(forma)) throw new Error("forma de pagamento invalida");
  }

  async function pagar(pedido) {
    validar(pedido);
    const existente = registros.get(pedido.idempotencyKey);
    if (existente) {
      if (existente.centavos !== pedido.centavos || existente.forma !== pedido.forma) {
        throw new Error("mesma chave com valor ou forma diferente");
      }
      if (existente.estado === ESTADOS.INCERTO || existente.estado === ESTADOS.AGUARDANDO) return reconsultar(pedido.idempotencyKey);
      return { ...existente }; // nunca cobra de novo
    }
    const reg = { idempotencyKey: pedido.idempotencyKey, centavos: pedido.centavos, forma: pedido.forma, estado: ESTADOS.INCERTO, criadoEm: agora() };
    registros.set(reg.idempotencyKey, reg);
    try {
      await aoMudar(lista()); // gravado ANTES de cobrar
    } catch {
      registros.delete(reg.idempotencyKey);
      throw new Error("nao foi possivel registrar o pagamento; nada foi cobrado");
    }
    try {
      const r = await adaptador.cobrar({ idempotencyKey: reg.idempotencyKey, centavos: reg.centavos, forma: reg.forma });
      aplicar(reg, r);
    } catch {
      reg.estado = ESTADOS.INCERTO;
    }
    reg.atualizadoEm = agora();
    await gravar();
    return { ...reg };
  }

  async function reconsultar(idempotencyKey) {
    const reg = registros.get(idempotencyKey);
    if (!reg) throw new Error("pagamento desconhecido");
    if (FINAIS.has(reg.estado)) return { ...reg };
    const antes = reg.estado;
    try {
      aplicar(reg, await adaptador.consultar({ idempotencyKey, forma: reg.forma }));
    } catch {
      reg.estado = ESTADOS.INCERTO;
    }
    reg.atualizadoEm = agora();
    if (reg.estado !== antes || FINAIS.has(reg.estado)) await gravar();
    return { ...reg };
  }

  async function cancelar(idempotencyKey) {
    const reg = registros.get(idempotencyKey);
    if (!reg) throw new Error("pagamento desconhecido");
    if (FINAIS.has(reg.estado)) return { ...reg };
    if (typeof adaptador.cancelar === "function") {
      try { await adaptador.cancelar({ idempotencyKey, forma: reg.forma }); } catch { /* a consulta abaixo decide */ }
    }
    return reconsultar(idempotencyKey); // o banco/maquininha tem a ultima palavra
  }

  function aplicar(reg, r) {
    const estado = r && r.estado;
    delete reg.mensagem;
    if (estado === ESTADOS.APROVADO) {
      if (r.centavos !== reg.centavos) { reg.estado = ESTADOS.INCERTO; reg.motivo = "valor aprovado diferente"; return; }
      reg.estado = ESTADOS.APROVADO;
      reg.autorizacao = typeof r.autorizacao === "string" ? r.autorizacao : null;
      delete reg.qr;
    } else if (estado === ESTADOS.AGUARDANDO) {
      reg.estado = ESTADOS.AGUARDANDO; // ex.: Pix com QR na tela, esperando o cliente pagar
      if (typeof r.qr === "string") reg.qr = r.qr;
      if (typeof r.mensagem === "string") reg.mensagem = r.mensagem; // ex.: "siga as instrucoes na maquininha"
      if (typeof r.expiraEm === "string") reg.expiraEm = r.expiraEm;
    } else if (estado === ESTADOS.RECUSADO || estado === ESTADOS.CANCELADO) {
      reg.estado = estado;
      reg.motivo = typeof r.motivo === "string" ? r.motivo : null;
      delete reg.qr;
    } else {
      reg.estado = ESTADOS.INCERTO;
    }
  }

  function liberaCozinha(idempotencyKey) {
    const reg = registros.get(idempotencyKey);
    return !!reg && reg.estado === ESTADOS.APROVADO;
  }

  function obter(idempotencyKey) {
    const reg = registros.get(idempotencyKey);
    return reg ? { ...reg } : null;
  }

  return { pagar, reconsultar, cancelar, liberaCozinha, obter, lista };
}

// Junta varios adaptadores num so, escolhendo pela forma de pagamento.
// Ex.: { pix: adaptadorPix(...), debito: tef, credito: tef }.
export function adaptadorPorForma(porForma) {
  const escolher = (forma) => {
    const a = porForma[forma];
    if (!a) throw new Error("forma de pagamento nao configurada");
    return a;
  };
  return {
    formas: Object.keys(porForma).filter((f) => FORMAS.includes(f)),
    async cobrar(pedido) { return escolher(pedido.forma).cobrar(pedido); },
    async consultar({ idempotencyKey, forma }) { return escolher(forma).consultar({ idempotencyKey, forma }); },
    async cancelar({ idempotencyKey, forma }) {
      const a = escolher(forma);
      if (typeof a.cancelar === "function") return a.cancelar({ idempotencyKey, forma });
    },
  };
}

// Adaptador de teste. Roteiro por chave: "aprovado" | "recusado" | "cancelado" | "erro" | "erro-depois-aprovado".
export function adaptadorSimulado(roteiro = {}) {
  const cobrancas = [];
  const resultado = new Map();
  return {
    cobrancas,
    async cobrar({ idempotencyKey, centavos, forma }) {
      cobrancas.push({ idempotencyKey, centavos, forma });
      const passo = roteiro[idempotencyKey] || "aprovado";
      if (passo === "erro") throw new Error("rede caiu");
      if (passo === "erro-depois-aprovado") { resultado.set(idempotencyKey, { estado: "aprovado", centavos, autorizacao: "SIM-" + cobrancas.length }); throw new Error("rede caiu"); }
      const r = passo === "aprovado" ? { estado: "aprovado", centavos, autorizacao: "SIM-" + cobrancas.length } : { estado: passo, motivo: "teste" };
      resultado.set(idempotencyKey, r);
      return r;
    },
    async consultar({ idempotencyKey }) {
      return resultado.get(idempotencyKey) || { estado: "incerto" };
    },
  };
}
