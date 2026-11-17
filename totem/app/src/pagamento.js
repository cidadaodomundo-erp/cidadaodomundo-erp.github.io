// Pagamento do totem: regra unica para qualquer TEF (SiTef, PayGo, etc.).
// Nenhuma cobranca real aqui. O adaptador "simulado" so existe para teste.
// Regras:
//  - so "aprovado" libera o pedido para a cozinha;
//  - a mesma chave (idempotencyKey) nunca gera duas cobrancas;
//  - resposta incerta (queda de rede) fica "incerto" e NAO libera nem cobra de novo:
//    precisa consultar o TEF antes de qualquer nova tentativa.

export const ESTADOS = Object.freeze({
  AGUARDANDO: "aguardando",
  APROVADO: "aprovado",
  RECUSADO: "recusado",
  CANCELADO: "cancelado",
  INCERTO: "incerto",
});

export const FORMAS = Object.freeze(["debito", "credito", "pix"]);

const FINAIS = new Set([ESTADOS.APROVADO, ESTADOS.RECUSADO, ESTADOS.CANCELADO]);

export function criarPagamentos({ adaptador, agora = () => new Date().toISOString() } = {}) {
  if (!adaptador || typeof adaptador.cobrar !== "function" || typeof adaptador.consultar !== "function") {
    throw new Error("adaptador TEF invalido: precisa de cobrar() e consultar()");
  }
  const registros = new Map(); // idempotencyKey -> registro

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
      if (existente.estado === ESTADOS.INCERTO) return reconsultar(pedido.idempotencyKey);
      return { ...existente }; // nunca cobra de novo
    }
    const reg = { idempotencyKey: pedido.idempotencyKey, centavos: pedido.centavos, forma: pedido.forma, estado: ESTADOS.AGUARDANDO, criadoEm: agora() };
    registros.set(reg.idempotencyKey, reg);
    try {
      const r = await adaptador.cobrar({ idempotencyKey: reg.idempotencyKey, centavos: reg.centavos, forma: reg.forma });
      aplicar(reg, r);
    } catch {
      reg.estado = ESTADOS.INCERTO;
    }
    reg.atualizadoEm = agora();
    return { ...reg };
  }

  async function reconsultar(idempotencyKey) {
    const reg = registros.get(idempotencyKey);
    if (!reg) throw new Error("pagamento desconhecido");
    if (FINAIS.has(reg.estado)) return { ...reg };
    try {
      aplicar(reg, await adaptador.consultar({ idempotencyKey }));
    } catch {
      reg.estado = ESTADOS.INCERTO;
    }
    reg.atualizadoEm = agora();
    return { ...reg };
  }

  function aplicar(reg, r) {
    const estado = r && r.estado;
    if (estado === ESTADOS.APROVADO) {
      if (r.centavos !== reg.centavos) { reg.estado = ESTADOS.INCERTO; reg.motivo = "valor aprovado diferente"; return; }
      reg.estado = ESTADOS.APROVADO;
      reg.autorizacao = typeof r.autorizacao === "string" ? r.autorizacao : null;
    } else if (estado === ESTADOS.RECUSADO || estado === ESTADOS.CANCELADO) {
      reg.estado = estado;
      reg.motivo = typeof r.motivo === "string" ? r.motivo : null;
    } else {
      reg.estado = ESTADOS.INCERTO;
    }
  }

  function liberaCozinha(idempotencyKey) {
    const reg = registros.get(idempotencyKey);
    return !!reg && reg.estado === ESTADOS.APROVADO;
  }

  return { pagar, reconsultar, liberaCozinha };
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
