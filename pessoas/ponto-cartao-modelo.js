// RASCUNHO ISOLADO — não conectado a rotas reais, sem fetch/RPC/storage/escrita/timer/DOM, sem dados reais.
// rh_flash_batida (contrato) tem só: data (date), flash_id (text), entrada/saida (timestamp WITHOUT time zone),
// n_batidas (integer), lido_em (timestamp WITH time zone). NÃO tem batidas intermediárias nem intervalo.
// Este módulo NUNCA calcula falta, atraso, horas extras, desconto, bonificação ou intervalo real — devolve só um
// ESTADO fixo (enum) e fatos validados, nunca um veredito. Todas as validações exigem o TIPO primitivo exato antes
// de qualquer comparação/regex — nunca deixa `typeof x !== 'string'` chegar a um `.test()`/comparação que coagisse
// objeto para string (o que permitiria um objeto com `toString` fingir ser um valor válido).
(function (root, factory) {
  'use strict';
  const mod = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = mod;
  if (root) root.PontoCartaoModelo = mod;
})(typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : null), function () {
  'use strict';

  const ESTADOS = Object.freeze({
    VINCULO_NAO_CONFIRMADO: 'VINCULO_NAO_CONFIRMADO',
    FORA_DO_VINCULO: 'FORA_DO_VINCULO',
    NAO_USA_PONTO: 'NAO_USA_PONTO',
    SEM_REGISTRO: 'SEM_REGISTRO',
    ENTRADA_SEM_SAIDA: 'ENTRADA_SEM_SAIDA',
    SAIDA_SEM_ENTRADA: 'SAIDA_SEM_ENTRADA',
    REGISTRADO_SEM_DETALHE: 'REGISTRADO_SEM_DETALHE',
    DADOS_INVALIDOS: 'DADOS_INVALIDOS',
  });

  const UNIDADES_RECONHECIDAS = Object.freeze(['AGUA VERDE', 'AHU', 'SAO BRAZ', 'SÃO BRAZ']);

  function ehObjetoPlano(v) { return v !== null && typeof v === 'object' && !Array.isArray(v); }

  // ---- validação de calendário real (sem Date/fuso, para não "corrigir" 30/02 sozinho) ----
  function diasNoMes(ano, mes) {
    const bissexto = (ano % 4 === 0 && ano % 100 !== 0) || ano % 400 === 0;
    return [31, bissexto ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][mes - 1];
  }
  const DATA_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
  // Exige tipo string ANTES do regex: testar regex em não-string coagiria via toString.
  function dataCalendarValida(v) {
    if (typeof v !== 'string') return false;
    const m = DATA_RE.exec(v);
    if (!m) return false;
    const ano = Number(m[1]), mes = Number(m[2]), dia = Number(m[3]);
    if (mes < 1 || mes > 12) return false;
    return dia >= 1 && dia <= diasNoMes(ano, mes);
  }

  const TS_SEM_FUSO_RE = /^(\d{4}-\d{2}-\d{2})[ T](\d{2}):(\d{2}):(\d{2})(\.\d+)?$/;
  function timestampSemFusoValido(v) {
    if (typeof v !== 'string') return false;
    const m = TS_SEM_FUSO_RE.exec(v);
    if (!m) return false;
    if (!dataCalendarValida(m[1])) return false;
    const h = Number(m[2]), mi = Number(m[3]), se = Number(m[4]);
    return h <= 23 && mi <= 59 && se <= 59;
  }

  // Timestamp COM fuso: a data/hora local E o offset precisam ter horas/minutos em faixa real (00-23 / 00-59).
  // '+99:99' e '+03:60' são sintaticamente parecidos com um offset mas não existem — isto só valida formato e
  // faixa numérica do offset escrito, NUNCA converte o horário para outro fuso nem infere o fuso real do servidor.
  const ISO_COM_FUSO_RE = /^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2}):(\d{2})(\.\d+)?(Z|[+-]\d{2}:\d{2})$/;
  const OFFSET_RE = /^[+-](\d{2}):(\d{2})$/;
  function isoComFusoValido(v) {
    if (typeof v !== 'string') return false;
    const m = ISO_COM_FUSO_RE.exec(v);
    if (!m) return false;
    if (!dataCalendarValida(m[1])) return false;
    const h = Number(m[2]), mi = Number(m[3]), se = Number(m[4]);
    if (h > 23 || mi > 59 || se > 59) return false;
    const fuso = m[6];
    if (fuso === 'Z') return true;
    const fm = OFFSET_RE.exec(fuso);
    if (!fm) return false;
    const fh = Number(fm[1]), fmin = Number(fm[2]);
    return fh <= 23 && fmin <= 59;
  }

  // ---- identidade ----
  function idValido(v) { return typeof v === 'number' && Number.isInteger(v) && Number.isSafeInteger(v) && v > 0; }
  // Recusa string vazia e string só-espaços (trim só para VALIDAR; a comparação de identidade usa o valor original,
  // nunca o trimado — nada de normalizar/comparar por nome ou CPF, só o identificador exato do flash_id).
  function flashIdValido(v) { return typeof v === 'string' && v.trim().length > 0; }

  // ---- contagem segura: Number() coage false/[]/' '/true; aqui só número inteiro seguro >=0 ou string só-dígitos ----
  function contarInteiro(v) {
    if (typeof v === 'number' && Number.isInteger(v) && Number.isSafeInteger(v) && v >= 0) return { valor: v, desconhecido: false };
    if (typeof v === 'string' && /^\d+$/.test(v)) {
      const n = Number(v);
      if (Number.isSafeInteger(n)) return { valor: n, desconhecido: false };
    }
    return { valor: null, desconhecido: true };
  }

  // ---- tri-estado explícito: só true/false são fatos; qualquer outro tipo normaliza para desconhecido (null) ----
  function triEstado(v) { return v === true || v === false ? v : null; }

  function unidadeReconhecida(v) {
    // reconhece a unidade de contexto de forma consistente; NÃO é prova de RLS no servidor — é só rótulo de exibição.
    return typeof v === 'string' && UNIDADES_RECONHECIDAS.includes(v) ? v : null;
  }

  function congelar(obj) { return Object.freeze(obj); }

  /**
   * @param {object} pessoaContexto - só os campos necessários: { id (number inteiro positivo), flash_id (string não vazia,
   *   sem ser só espaços), unidade (string reconhecida, opcional), admissao (date 'YYYY-MM-DD', obrigatória),
   *   desligamento (date, opcional, >= admissao), usa_ponto (boolean) }. cargo_confianca NÃO é usado: por si só não isenta nada.
   * @param {object} batida - { data: 'YYYY-MM-DD', flash_id: string, entrada/saida: timestamp sem fuso 'YYYY-MM-DD HH:MM:SS'
   *   ou 'YYYY-MM-DDTHH:MM:SS', n_batidas, lido_em: timestamp COM fuso ISO }
   * @param {string} consultadoEmIso - ISO8601 com fuso, de quando a tela monta o resumo (nunca confundido com lido_em)
   * @param {object} [ausenciaContexto] - tri-estados explícitos, nunca derivados:
   *   { folgaConfirmada: true|false|null, ausenciaConfirmada: true|false|null }
   *   folga_fixa_dow do cadastro NÃO é usado para inferir isto: é só contexto informativo, não prova cobertura do dia.
   */
  function montarResumoCartao(pessoaContexto, batida, consultadoEmIso, ausenciaContexto) {
    if (!ehObjetoPlano(batida)) throw new Error('montarResumoCartao exige a batida (objeto simples de rh_flash_batida)');
    if (!ehObjetoPlano(pessoaContexto)) throw new Error('montarResumoCartao exige o contexto da pessoa (objeto simples)');

    // captura cada valor de entrada UMA VEZ em local — nunca relê getters.
    const pId = pessoaContexto.id, pFlashId = pessoaContexto.flash_id, pAdmissao = pessoaContexto.admissao,
      pDesligamento = pessoaContexto.desligamento, pUsaPonto = pessoaContexto.usa_ponto, pUnidade = pessoaContexto.unidade;
    const bData = batida.data, bFlashId = batida.flash_id, bEntrada = batida.entrada, bSaida = batida.saida,
      bNBatidas = batida.n_batidas, bLidoEm = batida.lido_em;

    const consultadoEmValido = isoComFusoValido(consultadoEmIso);
    const consultadoEm = consultadoEmValido ? consultadoEmIso : null;

    const idOk = idValido(pId);
    const flashIdPessoaOk = flashIdValido(pFlashId);
    const admissaoOk = dataCalendarValida(pAdmissao);
    const desligamentoPresente = pDesligamento !== undefined && pDesligamento !== null;
    const desligamentoOk = !desligamentoPresente || (admissaoOk && dataCalendarValida(pDesligamento) && pDesligamento >= pAdmissao);

    const flashIdBatidaOk = flashIdValido(bFlashId);
    // comparação de identidade sempre com o valor ORIGINAL (não trimado): flashIdValido só valida que não é vazio/espaço.
    const vinculoPorFlashId = flashIdPessoaOk && flashIdBatidaOk && pFlashId === bFlashId;

    const dataBatidaOk = dataCalendarValida(bData);

    if (!idOk || !admissaoOk || !desligamentoOk || !vinculoPorFlashId) {
      return congelar({
        estado: ESTADOS.VINCULO_NAO_CONFIRMADO,
        vinculoConfirmado: false,
        data: dataBatidaOk ? bData : null,
        unidadeContexto: unidadeReconhecida(pUnidade),
        consultado_em: consultadoEm,
        consultado_em_desconhecido: !consultadoEmValido,
        incertezas: Object.freeze(['vínculo não confirmado: id/flash_id/admissão da pessoa inválidos ou ausentes, ou flash_id da batida não corresponde exatamente ao da pessoa (sem match por nome)']),
      });
    }

    if (!dataBatidaOk) {
      return congelar({
        estado: ESTADOS.DADOS_INVALIDOS,
        vinculoConfirmado: true,
        data: null,
        unidadeContexto: unidadeReconhecida(pUnidade),
        consultado_em: consultadoEm,
        consultado_em_desconhecido: !consultadoEmValido,
        incertezas: Object.freeze(['data da batida em formato ou calendário inválido: conteúdo não exibido']),
      });
    }

    if (bData < pAdmissao || (desligamentoPresente && bData > pDesligamento)) {
      return congelar({
        estado: ESTADOS.FORA_DO_VINCULO, vinculoConfirmado: true, data: bData,
        unidadeContexto: unidadeReconhecida(pUnidade), consultado_em: consultadoEm, consultado_em_desconhecido: !consultadoEmValido,
        incertezas: Object.freeze(['data fora do período de vínculo (antes da admissão ou depois do desligamento): sem pendência nem horário atribuído']),
      });
    }

    if (pUsaPonto === false) {
      return congelar({
        estado: ESTADOS.NAO_USA_PONTO, vinculoConfirmado: true, data: bData,
        unidadeContexto: unidadeReconhecida(pUnidade), consultado_em: consultadoEm, consultado_em_desconhecido: !consultadoEmValido,
        incertezas: Object.freeze(['cadastro marca usa_ponto=false: estado explícito do cadastro, não é falta (cargo_confianca sozinho não isenta nada e não é usado aqui)']),
      });
    }

    // horários — preserva a string bruta SÓ se o formato/calendário for válido; nunca ecoa conteúdo inválido/lixo/payload.
    const incertezas = [];
    const entradaPresente = bEntrada !== undefined && bEntrada !== null;
    const saidaPresente = bSaida !== undefined && bSaida !== null;
    const entradaValida = entradaPresente && timestampSemFusoValido(bEntrada);
    const saidaValida = saidaPresente && timestampSemFusoValido(bSaida);
    if (entradaPresente && !entradaValida) incertezas.push('entrada em formato/calendário inválido: conteúdo não exibido');
    if (saidaPresente && !saidaValida) incertezas.push('saida em formato/calendário inválido: conteúdo não exibido');
    if (entradaValida) incertezas.push('entrada sem fuso registrado: não prova horário de Brasília');
    if (saidaValida) incertezas.push('saida sem fuso registrado: não prova horário de Brasília');

    const { valor: nBatidas, desconhecido: nBatidasDesconhecido } = contarInteiro(bNBatidas);
    if (nBatidasDesconhecido) incertezas.push('n_batidas ausente ou inválido: contagem desconhecida, diferente de zero');
    if (!nBatidasDesconhecido && nBatidas >= 4) incertezas.push('n_batidas>=4 não prova intervalo completo: a tabela não guarda as batidas intermediárias');

    const folgaConfirmada = triEstado(ausenciaContexto && ausenciaContexto.folgaConfirmada);
    const ausenciaConfirmada = triEstado(ausenciaContexto && ausenciaContexto.ausenciaConfirmada);
    if (folgaConfirmada === null) incertezas.push('folga desconhecida para este dia: conferir manualmente, não é abono e não é falta');
    else incertezas.push('folga ' + (folgaConfirmada ? 'confirmada' : 'negada') + ' explicitamente para este dia');
    if (ausenciaConfirmada === null) incertezas.push('ausência desconhecida para este dia: conferir manualmente, não é abono e não é falta');
    else incertezas.push('ausência ' + (ausenciaConfirmada ? 'confirmada' : 'negada') + ' explicitamente para este dia');

    const lidoEmValido = bLidoEm !== undefined && bLidoEm !== null && isoComFusoValido(bLidoEm);
    if (!lidoEmValido) incertezas.push('lido_em ausente ou em formato inválido: momento da leitura desconhecido');

    // Sem entrada e sem saída: o ESTADO depende só da contagem de batidas, nunca presumida.
    // SEM_REGISTRO exige n_batidas VÁLIDO e IGUAL A ZERO. Contagem desconhecida ou positiva sem nenhum horário é
    // inconsistência de dados (não dá pra dizer que "não há registro" se a contagem diz o contrário ou é incerta):
    // vira DADOS_INVALIDOS, com incerteza explícita — nunca falta, abono ou qualquer veredito financeiro/legal.
    let estado;
    if (entradaPresente && !entradaValida) {
      estado = ESTADOS.DADOS_INVALIDOS;
    } else if (saidaPresente && !saidaValida) {
      estado = ESTADOS.DADOS_INVALIDOS;
    } else if (!entradaPresente && !saidaPresente) {
      if (!nBatidasDesconhecido && nBatidas === 0) {
        estado = ESTADOS.SEM_REGISTRO;
        incertezas.push('nenhum dado de horário nem batida (n_batidas=0 confirmado): ausência de registro, não falta confirmada');
      } else if (nBatidasDesconhecido) {
        estado = ESTADOS.DADOS_INVALIDOS;
        incertezas.push('sem entrada e sem saída, mas n_batidas desconhecido: dados insuficientes para dizer que não há registro');
      } else {
        estado = ESTADOS.DADOS_INVALIDOS;
        incertezas.push('sem entrada e sem saída, mas n_batidas indica ' + nBatidas + ' batida(s): inconsistente, não é SEM_REGISTRO');
      }
    } else if (entradaValida && !saidaPresente) {
      estado = ESTADOS.ENTRADA_SEM_SAIDA;
    } else if (!entradaPresente && saidaValida) {
      estado = ESTADOS.SAIDA_SEM_ENTRADA;
    } else {
      estado = ESTADOS.REGISTRADO_SEM_DETALHE;
    }

    return congelar({
      estado,
      vinculoConfirmado: true,
      data: bData,
      unidadeContexto: unidadeReconhecida(pUnidade),
      entrada: entradaValida ? bEntrada : null,
      saida: saidaValida ? bSaida : null,
      n_batidas: nBatidas,
      n_batidas_desconhecido: nBatidasDesconhecido,
      folgaConfirmada,
      ausenciaConfirmada,
      lido_em: lidoEmValido ? bLidoEm : null,
      lido_em_desconhecido: !lidoEmValido,
      consultado_em: consultadoEm,
      consultado_em_desconhecido: !consultadoEmValido,
      incertezas: Object.freeze(incertezas),
    });
  }

  return { ESTADOS, montarResumoCartao, contarInteiro, dataCalendarValida, timestampSemFusoValido, isoComFusoValido, flashIdValido };
});
