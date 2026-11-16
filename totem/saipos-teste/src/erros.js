// Erro simples com codigo estavel. A mensagem NUNCA deve conter segredo/token/idPartner.

export class ErroConector extends Error {
  constructor(codigo, mensagem, detalhes) {
    super(mensagem);
    this.codigo = codigo;
    this.detalhes = detalhes;
  }
}

export function redigir(texto, segredos = []) {
  let saida = String(texto ?? "");
  for (const segredo of segredos) {
    if (typeof segredo === "string" && segredo.length >= 4) {
      saida = saida.split(segredo).join("[OCULTO]");
    }
  }
  return saida;
}

// Resume o corpo de erro da API: so campos conhecidos, texto curto e redigido.
export function resumirErroApi(json, segredos = []) {
  if (!json || typeof json !== "object") return null;
  const resumo = {};
  for (const campo of ["t", "dateTime", "errorMessage", "guidRequest"]) {
    if (typeof json[campo] === "string") {
      resumo[campo] = redigir(json[campo], segredos).slice(0, 200);
    }
  }
  return resumo;
}
