// Maquininha TEF generica (cartao de debito/credito). Nenhuma cobranca real aqui.
//
// Qualquer empresa de TEF (SuperTEF, Saipos TEF, Rede, PayGo, SiTef...) entra como um "provedor"
// com duas funcoes. O resto do totem nao muda quando trocar de empresa.
//
//   provedor.solicitar({ referencia, centavos, tipo }) -> resposta
//   provedor.consultar({ referencia })                 -> resposta
//
//   tipo: "debito" | "credito"
//   referencia: chave unica do pedido. Repetir a mesma referencia NUNCA pode gerar outra cobranca
//               (o provedor devolve a cobranca que ja existe).
//   resposta: { status, centavos?, autorizacao?, motivo? }
//     status "pendente"  -> maquininha esperando o cliente (aproximar/inserir cartao, senha)
//     status "aprovado"  -> pago; centavos = valor aprovado; autorizacao = codigo/NSU
//     status "recusado" | "cancelado" -> nada cobrado
//     qualquer outra coisa -> incerto (o totem NAO libera e NAO cobra de novo; so reconsulta)
//
// Encaixa no src/pagamento.js como adaptador (cobrar/consultar).

export const TIPOS = Object.freeze(["debito", "credito"]);
export const MENSAGEM_MAQUININHA = "Siga as instruções na maquininha: aproxime, insira ou passe o cartão.";

function traduzir(r, centavos) {
  const status = r && r.status;
  if (status === "aprovado") {
    return { estado: "aprovado", centavos: r.centavos, autorizacao: typeof r.autorizacao === "string" ? r.autorizacao : null };
  }
  if (status === "pendente") return { estado: "aguardando", centavos, mensagem: MENSAGEM_MAQUININHA };
  if (status === "recusado" || status === "cancelado") {
    return { estado: status, motivo: typeof r.motivo === "string" ? r.motivo : null };
  }
  return { estado: "incerto" };
}

export function adaptadorTef({ provedor }) {
  if (!provedor || typeof provedor.solicitar !== "function" || typeof provedor.consultar !== "function") {
    throw new Error("provedor TEF invalido: precisa de solicitar() e consultar()");
  }
  return {
    async cobrar({ idempotencyKey, centavos, forma }) {
      if (!TIPOS.includes(forma)) throw new Error("este adaptador so faz debito ou credito");
      return traduzir(await provedor.solicitar({ referencia: idempotencyKey, centavos, tipo: forma }), centavos);
    },
    async consultar({ idempotencyKey }) {
      return traduzir(await provedor.consultar({ referencia: idempotencyKey }));
    },
  };
}

// Maquininha de mentira (teste e demonstracao). Fica "pendente" e, depois de aprovarDepoisMs,
// aplica o roteiro da referencia ("aprovado" por padrao, ou "recusado" / "cancelado").
export function tefSimulado({ aprovarDepoisMs = 5000, roteiro = {}, agora = () => Date.now() } = {}) {
  const cobrancas = new Map();
  let solicitadas = 0;
  let nsu = 100000;

  function avancar(c) {
    if (c.status !== "pendente" || agora() - c.inicio < aprovarDepoisMs) return;
    const fim = roteiro[c.referencia] || "aprovado";
    c.status = fim;
    if (fim === "aprovado") c.autorizacao = "SIM" + String(++nsu);
    else c.motivo = "simulado";
  }
  const ver = (c) => ({ status: c.status, centavos: c.centavos, autorizacao: c.autorizacao ?? null, motivo: c.motivo ?? null });

  return {
    get solicitadas() { return solicitadas; },
    async solicitar({ referencia, centavos, tipo }) {
      if (!cobrancas.has(referencia)) {
        solicitadas += 1;
        cobrancas.set(referencia, { referencia, centavos, tipo, status: "pendente", inicio: agora() });
      }
      const c = cobrancas.get(referencia);
      avancar(c);
      return ver(c);
    },
    async consultar({ referencia }) {
      const c = cobrancas.get(referencia);
      if (!c) return { status: "desconhecido" };
      avancar(c);
      return ver(c);
    },
  };
}
