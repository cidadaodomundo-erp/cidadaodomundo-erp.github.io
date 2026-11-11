// PONTO AO VIVO — modelo puro (sem rede, DOM, storage, timer, escrita). Somente leitura e classificação.
// Reutiliza as validações do pacote de ponto completo (ponto-cartao-modelo.js: calendário, timestamps, vínculo por flash_id,
// janela de vínculo, usa_ponto). Contratos lidos: rh_pessoa, rh_flash_batida (horarios opcional), rh_flash_ausencia, rh_ocorrencia.
// REGRA DURA: ausência de batida NUNCA vira falta/atraso/infração. Alertas são sempre "CONFERIR", com explicação, e só
// existem quando as fontes necessárias foram realmente fornecidas. Sem escala diária/horário oficial: degrada com segurança.
// Nada de histórico, CPF, PIS, payload, texto livre, observação ou autor entra aqui. Tipo de ausência/ocorrência NÃO é lido.
(function (root, factory) {
  'use strict';
  let modelo = null;
  if (typeof require === 'function' && typeof module !== 'undefined') {
    try { modelo = require('./ponto-cartao-modelo.js'); }
    catch (e) {
      if (!e || e.code !== 'MODULE_NOT_FOUND') throw e;
      modelo = require('../../../pacote-rh-ponto-completo-11-11/portal/pessoas/ponto-cartao-modelo.js');
    }
  } else if (root) modelo = root.PontoCartaoModelo;
  const mod = factory(modelo);
  if (typeof module !== 'undefined' && module.exports) module.exports = mod;
  if (root) root.PontoAoVivoModelo = mod;
})(typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : null), function (modelo) {
  'use strict';
  if (!modelo || typeof modelo.montarResumoCartao !== 'function') throw new Error('ponto-cartao-modelo.js é obrigatório (validações do pacote de ponto completo)');

  const SIT = Object.freeze({
    DENTRO: 'DENTRO', INTERVALO: 'INTERVALO', JA_SAIU: 'JA_SAIU', SEM_BATIDA: 'SEM_BATIDA',
    SAIU_OU_INTERVALO: 'SAIU_OU_INTERVALO', INCOMPLETO: 'INCOMPLETO', AUSENCIA_REGISTRADA: 'AUSENCIA_REGISTRADA',
    CONFERIR: 'CONFERIR', FORA_DO_VINCULO: 'FORA_DO_VINCULO', NAO_USA_PONTO: 'NAO_USA_PONTO', DIA_FUTURO: 'DIA_FUTURO',
  });
  const ROTULO = Object.freeze({
    DENTRO: ['Dentro da loja', 'ok'], INTERVALO: ['No intervalo', 'ok'], JA_SAIU: ['Já saiu', 'neutro'],
    SEM_BATIDA: ['Ainda sem batida', 'ver'], SAIU_OU_INTERVALO: ['Saiu ou em intervalo (CONFERIR)', 'ver'],
    INCOMPLETO: ['Batidas incompletas (CONFERIR)', 'ver'], AUSENCIA_REGISTRADA: ['Ausência registrada (Flash)', 'neutro'],
    CONFERIR: ['CONFERIR', 'ver'], FORA_DO_VINCULO: ['Fora do vínculo', 'neutro'], NAO_USA_PONTO: ['Não usa ponto (cadastro)', 'neutro'],
    DIA_FUTURO: ['Dia futuro', 'neutro'],
  });
  const LIMITE_LEITURA_MIN_PADRAO = 30;
  const MAX_BATIDAS = 24;

  const ehObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

  // ---------- calendário próprio (sem Date) ----------
  function diasDesde1970(s) {
    let y = Number(s.slice(0, 4)); const m = Number(s.slice(5, 7)), d = Number(s.slice(8, 10));
    if (m <= 2) y -= 1;
    const era = Math.floor(y / 400), yoe = y - era * 400;
    const doy = Math.floor((153 * (m + (m > 2 ? -3 : 9)) + 2) / 5) + d - 1;
    return era * 146097 + yoe * 365 + Math.floor(yoe / 4) - Math.floor(yoe / 100) + doy - 719468;
  }
  function dataDeDias(z) {
    z += 719468;
    const era = Math.floor(z / 146097), doe = z - era * 146097;
    const yoe = Math.floor((doe - Math.floor(doe / 1460) + Math.floor(doe / 36524) - Math.floor(doe / 146096)) / 365);
    const doy = doe - (365 * yoe + Math.floor(yoe / 4) - Math.floor(yoe / 100));
    const mp = Math.floor((5 * doy + 2) / 153), d = doy - Math.floor((153 * mp + 2) / 5) + 1, m = mp < 10 ? mp + 3 : mp - 9;
    const y = yoe + era * 400 + (m <= 2 ? 1 : 0);
    return String(y).padStart(4, '0') + '-' + String(m).padStart(2, '0') + '-' + String(d).padStart(2, '0');
  }
  const dataReal = (s) => modelo.dataCalendarValida(s) && Number(s.slice(0, 4)) >= 1;
  const diaSeguinte = (s) => dataDeDias(diasDesde1970(s) + 1);
  const dowDom0 = (s) => (((diasDesde1970(s) + 4) % 7) + 7) % 7;   // 1970-01-01 foi quinta-feira

  // ---------- horas ----------
  const normTs = (ts) => ts.slice(0, 10) + ' ' + ts.slice(11, 19);
  const hhmm = (ts) => ts.slice(11, 16);
  const minAbs = (ts) => diasDesde1970(ts.slice(0, 10)) * 1440 + Number(ts.slice(11, 13)) * 60 + Number(ts.slice(14, 16));
  function minHHMM(s) { const m = typeof s === 'string' ? /^([01]\d|2[0-3]):([0-5]\d)$/.exec(s) : null; return m ? Number(m[1]) * 60 + Number(m[2]) : null; }
  function fmtMin(n) { return String(Math.floor(n / 60)).padStart(2, '0') + ':' + String(n % 60).padStart(2, '0'); }
  // relógio de Brasília a partir de ISO com fuso (Intl; nunca soma -3h fixo). Falha => null (tudo vira CONFERIR).
  function brtAgora(iso) {
    if (!modelo.isoComFusoValido(iso)) return null;
    const d = new Date(iso); if (Number.isNaN(d.getTime())) return null;
    try {
      const p = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(d);
      const g = (t) => (p.find((x) => x.type === t) || {}).value;
      const data = g('year') + '-' + g('month') + '-' + g('day'), min = Number(g('hour')) * 60 + Number(g('minute'));
      if (!dataReal(data) || !Number.isFinite(min)) return null;
      return { data, min, ms: d.getTime() };
    } catch (e) { return null; }
  }

  // ---------- loja / nome ----------
  const SAO_BRAZ = ['SAO BRAZ', 'SÃO BRAZ'];
  function lojaCombina(unidade, loja, redeOk) {
    if (typeof loja !== 'string' || typeof unidade !== 'string' || !unidade.trim()) return false;
    if (loja === 'REDE') return redeOk === true;
    return unidade === loja || (SAO_BRAZ.includes(unidade) && SAO_BRAZ.includes(loja));
  }
  function nomeSeguro(n, id) {
    if (typeof n === 'string') {
      const s = n.replace(/[\u0000-\u001f\u007f-\u009f‎‏‪-‮⁦-⁩]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 80);
      if (s) return s;
    }
    return 'Cadastro ' + String(Number.isInteger(id) ? id : '?');
  }

  // ---------- escala diária (OBJETO FUTURO, hoje inexistente no ERP): só entra se for fornecida e válida ----------
  // { inicio:'HH:MM', fim:'HH:MM' (>inicio, mesmo dia), toleranciaMin:int 0..120, intervaloMinimoMin:int>0 (opcional),
  //   temIntervalo:true|false (opcional), folga:true|false (opcional) }
  function escalaValida(e) {
    if (!ehObj(e)) return null;
    const ini = minHHMM(e.inicio), fim = minHHMM(e.fim);
    const out = {
      inicio: ini, fim: ini !== null && fim !== null && fim > ini ? fim : null,
      tol: Number.isInteger(e.toleranciaMin) && e.toleranciaMin >= 0 && e.toleranciaMin <= 120 ? e.toleranciaMin : null,
      intervaloMin: Number.isInteger(e.intervaloMinimoMin) && e.intervaloMinimoMin > 0 && e.intervaloMinimoMin <= 240 ? e.intervaloMinimoMin : null,
      temIntervalo: e.temIntervalo === true || e.temIntervalo === false ? e.temIntervalo : null,
      folga: e.folga === true || e.folga === false ? e.folga : null,
    };
    return out;
  }

  // ---------- batidas (horarios opcional) ----------
  // Devolve { lista: ['YYYY-MM-DD HH:MM:SS',...] | null, divergente: bool }.
  // lista null+divergente=false => sem detalhe (coluna ausente/nula). divergente=true => dado incoerente: não usar nada dele.
  function lerHorarios(b, dia) {
    const h = b.horarios;
    if (h === undefined || h === null) return { lista: null, divergente: false };
    if (!Array.isArray(h) || h.length > MAX_BATIDAS) return { lista: null, divergente: true };
    const prox = diaSeguinte(dia), lista = [];
    for (const t of h) {
      if (!modelo.timestampSemFusoValido(t)) return { lista: null, divergente: true };
      const d = t.slice(0, 10);
      if (d !== dia && d !== prox) return { lista: null, divergente: true };
      lista.push(normTs(t));
    }
    for (let i = 1; i < lista.length; i++) if (minAbs(lista[i]) < minAbs(lista[i - 1])) return { lista: null, divergente: true };
    const n = modelo.contarInteiro(b.n_batidas);
    if (n.desconhecido || n.valor !== lista.length) return { lista: null, divergente: true };
    const e = b.entrada, s = b.saida;
    if (lista.length === 0) { if ((e !== null && e !== undefined) || (s !== null && s !== undefined)) return { lista: null, divergente: true }; }
    else {
      if (!modelo.timestampSemFusoValido(e) || normTs(e) !== lista[0]) return { lista: null, divergente: true };
      if (lista.length === 1) { if (s !== null && s !== undefined) return { lista: null, divergente: true }; }
      else if (!modelo.timestampSemFusoValido(s) || normTs(s) !== lista[lista.length - 1]) return { lista: null, divergente: true };
    }
    return { lista, divergente: false };
  }

  // ---------- ausência (rh_flash_ausencia: só flash_id, inicio, fim) ----------
  function diaDe(v) {
    if (typeof v !== 'string' || v.length < 10) return null;
    if (v.length > 10 && v[10] !== ' ' && v[10] !== 'T') return null;
    const d = v.slice(0, 10); return dataReal(d) ? d : null;
  }
  function indexarAusencias(lista, dia) {
    const porFlash = new Map(); let invalidas = 0;
    (Array.isArray(lista) ? lista : []).forEach((a) => {
      if (!ehObj(a) || !modelo.flashIdValido(a.flash_id)) { invalidas++; return; }
      const i = diaDe(a.inicio), f = a.fim === null || a.fim === undefined ? null : diaDe(a.fim);
      if (!i || (a.fim !== null && a.fim !== undefined && !f)) { invalidas++; return; }
      if (f && f < i) { invalidas++; return; }
      if (i <= dia && dia <= (f || i)) porFlash.set(a.flash_id, true);
    });
    return { porFlash, invalidas };
  }
  function indexarOcorrencias(lista, dia) {
    const set = new Set(); let invalidas = 0;
    (Array.isArray(lista) ? lista : []).forEach((o) => {
      if (!ehObj(o) || !(Number.isInteger(o.pessoa_id) && o.pessoa_id > 0) || !dataReal(o.data)) { invalidas++; return; }
      if (o.data === dia) set.add(o.pessoa_id);
    });
    return { set, invalidas };
  }

  function folgaDoCadastro(dow, dia, conv) {
    if (!Number.isInteger(dow)) return { estado: 'sem' };
    if (conv !== 'DOM0' && conv !== 'SEG1') return { estado: 'convencao' };
    const d0 = dowDom0(dia);
    if (conv === 'DOM0') return dow >= 0 && dow <= 6 ? { estado: dow === d0 ? 'sim' : 'nao' } : { estado: 'sem' };
    return dow >= 1 && dow <= 7 ? { estado: dow === (d0 === 0 ? 7 : d0) ? 'sim' : 'nao' } : { estado: 'sem' };
  }

  /**
   * cruzar({ pessoas, batidas, ausencias, ocorrencias, dia, consultadoEm, loja, redeOk, fontes, escalaDia, dowConvencao, limiteLeituraMin })
   *  - fontes: { ausencias:true|false, ocorrencias:true|false } (false/ausente = fonte NÃO carregada ou truncada)
   *  - escalaDia: Map|objeto { [pessoaId]: escala } — objeto futuro; ausente em produção hoje
   *  - dowConvencao: 'DOM0' | 'SEG1' | null (definição administrativa pendente; null => folga fixa do cadastro não é usada)
   */
  function cruzar(o) {
    const { pessoas, batidas, dia, consultadoEm, loja, redeOk } = o;
    const fontes = ehObj(o.fontes) ? o.fontes : {};
    const limite = Number.isInteger(o.limiteLeituraMin) && o.limiteLeituraMin > 0 ? o.limiteLeituraMin : LIMITE_LEITURA_MIN_PADRAO;
    const avisos = [];
    const agora = brtAgora(consultadoEm);
    if (!dataReal(dia)) throw new Error('dia inválido');
    const posicao = !agora ? 'desconhecida' : (dia === agora.data ? 'hoje' : (dia < agora.data ? 'passado' : 'futuro'));
    if (!agora) avisos.push('Hora da consulta inválida: nenhuma situação ao vivo foi atribuída; tudo em CONFERIR.');

    const escalaDe = (id) => {
      const m = o.escalaDia; if (!m) return null;
      return escalaValida(m instanceof Map ? m.get(id) : (ehObj(m) ? m[id] : null));
    };
    const aus = fontes.ausencias === true ? indexarAusencias(o.ausencias, dia) : null;
    const oco = fontes.ocorrencias === true ? indexarOcorrencias(o.ocorrencias, dia) : null;
    if (aus && aus.invalidas) avisos.push(aus.invalidas + ' linha(s) de ausência inválida(s) ignorada(s).');
    if (oco && oco.invalidas) avisos.push(oco.invalidas + ' linha(s) de ocorrência inválida(s) ignorada(s).');
    if (!aus) avisos.push('Fonte de ausências indisponível: nenhuma ausência pôde ser considerada.');
    if (!oco) avisos.push('Fonte de ocorrências indisponível.');

    // cadastro: flash_id repetido em mais de um cadastro => ambíguo (nunca atribui horário)
    const contaFlash = new Map();
    (Array.isArray(pessoas) ? pessoas : []).forEach((p) => { if (ehObj(p) && modelo.flashIdValido(p.flash_id)) contaFlash.set(p.flash_id, (contaFlash.get(p.flash_id) || 0) + 1); });
    const porFlash = new Map(); let batidaSemCadastro = 0;
    const flashesCadastro = new Set(contaFlash.keys());
    (Array.isArray(batidas) ? batidas : []).forEach((b) => {
      if (!ehObj(b) || b.data !== dia || !modelo.flashIdValido(b.flash_id)) return;
      if (!flashesCadastro.has(b.flash_id)) batidaSemCadastro++;
      porFlash.set(b.flash_id, (porFlash.get(b.flash_id) || []).concat([b]));
    });
    if (batidaSemCadastro) avisos.push(batidaSemCadastro + ' leitura(s) do dia sem cadastro correspondente (não exibidas).');

    // frescor da leitura do dia (maior lido_em válido entre as linhas do dia)
    let ultimaLeituraMs = null;
    porFlash.forEach((ls) => ls.forEach((b) => { const t = modelo.isoComFusoValido(b.lido_em) ? Date.parse(b.lido_em) : NaN; if (!Number.isNaN(t) && (ultimaLeituraMs === null || t > ultimaLeituraMs)) ultimaLeituraMs = t; }));
    const leituraIdadeMin = agora && ultimaLeituraMs !== null ? Math.max(0, Math.round((agora.ms - ultimaLeituraMs) / 60000)) : null;
    const leituraFresca = leituraIdadeMin !== null && leituraIdadeMin <= limite;
    if (posicao === 'hoje' && !leituraFresca) avisos.push(leituraIdadeMin === null ? 'Nenhuma leitura datada do dia: não dá para dizer quem ainda não bateu.' : 'Última leitura do dia há ' + leituraIdadeMin + ' min (limite ' + limite + '): situações podem estar defasadas.');

    const linhas = [];
    (Array.isArray(pessoas) ? pessoas : []).forEach((p) => {
      if (!ehObj(p) || !lojaCombina(p.unidade, loja, redeOk)) return;
      linhas.push(montarLinha(p));
    });

    function montarLinha(p) {
      const L = {
        nome: nomeSeguro(p.nome, p.id), unidade: typeof p.unidade === 'string' ? p.unidade : '', dia,
        situacao: SIT.CONFERIR, explicacao: '', n: null, entrada: null, intervaloSaida: null, intervaloVolta: null, saida: null,
        segundaBatida: null, impar: false, incompleto: false, alertas: [], lidoHaMin: null, semEscala: true,
      };
      const alerta = (codigo, texto) => L.alertas.push({ codigo, texto });
      const fim = (sit, expl) => { L.situacao = sit; L.explicacao = expl || ''; L.rotulo = ROTULO[sit][0]; L.classe = ROTULO[sit][1]; return Object.freeze(L); };

      if (posicao === 'desconhecida') return fim(SIT.CONFERIR, 'A hora da consulta é inválida; não há como saber o dia atual.');
      if (modelo.flashIdValido(p.flash_id) && contaFlash.get(p.flash_id) > 1) return fim(SIT.CONFERIR, 'Mesmo flash_id em mais de um cadastro: batidas não atribuídas.');
      const linhasDia = modelo.flashIdValido(p.flash_id) ? (porFlash.get(p.flash_id) || []) : [];
      if (linhasDia.length > 1) return fim(SIT.CONFERIR, 'Leituras duplicadas para este dia: batidas não atribuídas.');
      const b = linhasDia[0] || null;

      const temAus = aus ? aus.porFlash.get(p.flash_id) === true : null;   // null = desconhecido
      const ctx = { id: p.id, flash_id: p.flash_id, unidade: p.unidade, admissao: p.admissao, desligamento: p.desligamento === null ? undefined : p.desligamento, usa_ponto: p.usa_ponto };
      let r;
      try {
        r = modelo.montarResumoCartao(ctx, b ? b : { data: dia, flash_id: p.flash_id, n_batidas: 0 }, consultadoEm, { folgaConfirmada: null, ausenciaConfirmada: temAus });
      } catch (e) { return fim(SIT.CONFERIR, 'Cadastro ou leitura em formato não reconhecido.'); }
      if (r.estado === 'VINCULO_NAO_CONFIRMADO') return fim(SIT.CONFERIR, 'Vínculo não confirmado (id, flash_id ou datas do cadastro).');
      if (r.estado === 'FORA_DO_VINCULO') return fim(SIT.FORA_DO_VINCULO, 'Dia fora do período de vínculo (antes da admissão ou depois do desligamento).');
      if (r.estado === 'NAO_USA_PONTO') return fim(SIT.NAO_USA_PONTO, 'Cadastro marca que não usa ponto; não é falta.');
      if (r.estado === 'DADOS_INVALIDOS' || r.estado === 'SAIDA_SEM_ENTRADA') return fim(SIT.CONFERIR, 'Dados da leitura inválidos ou inconsistentes.');
      if (posicao === 'futuro') return fim(SIT.DIA_FUTURO, 'Dia ainda não chegou; nada a classificar.');

      const esc = escalaDe(p.id);
      L.semEscala = !esc;
      const folgaCad = folgaDoCadastro(p.folga_fixa_dow, dia, o.dowConvencao);
      const emFolga = (esc && esc.folga === true) ? true : (esc && esc.folga === false ? false : (folgaCad.estado === 'sim' ? true : (folgaCad.estado === 'nao' ? false : null)));
      const temOco = oco ? oco.set.has(p.id) : null;
      if (b) { const t = modelo.isoComFusoValido(b.lido_em) ? Date.parse(b.lido_em) : NaN; if (agora && !Number.isNaN(t)) L.lidoHaMin = Math.max(0, Math.round((agora.ms - t) / 60000)); }

      // ---- sem batida ----
      const n0 = b ? modelo.contarInteiro(b.n_batidas) : { valor: 0, desconhecido: false };
      if (b && !n0.desconhecido && n0.valor === 0 && ((b.entrada !== null && b.entrada !== undefined) || (b.saida !== null && b.saida !== undefined) || (Array.isArray(b.horarios) && b.horarios.length > 0))) {
        return fim(SIT.CONFERIR, 'Contagem zero, mas há horário na leitura: dados inconsistentes.');
      }
      if (!b || (!n0.desconhecido && n0.valor === 0)) {
        L.n = 0;
        if (temAus === true) return fim(SIT.AUSENCIA_REGISTRADA, 'Há ausência registrada no Flash cobrindo o dia; o tipo não é lido nem interpretado.');
        const motivos = [];
        if (!b && posicao === 'hoje' && !leituraFresca) return fim(SIT.CONFERIR, 'Sem leitura recente do dia; não dá para afirmar que ainda não bateu.');
        if (temAus === null) motivos.push('fonte de ausências indisponível');
        if (temOco === true) motivos.push('há ocorrência registrada neste dia (tipo não lido)');
        if (emFolga === null) motivos.push('folga do dia desconhecida');
        if (!esc) motivos.push('sem escala diária/horário oficial');
        // só com TODAS as fontes e escala completa pode surgir o alerta de possível atraso — sempre CONFERIR, nunca infração
        if (esc && esc.inicio !== null && esc.tol !== null && posicao === 'hoje' && leituraFresca && temAus === false && temOco === false && emFolga === false && agora.min > esc.inicio + esc.tol) {
          alerta('SEM_BATIDA_APOS_HORARIO', 'Sem batida lida ' + (agora.min - esc.inicio) + ' min após o horário previsto (' + fmtMin(esc.inicio) + '): CONFERIR. Pode ser leitura atrasada, troca de escala ou ausência ainda não lançada.');
        }
        return fim(SIT.SEM_BATIDA, 'Nenhuma batida lida; isto não é falta nem atraso' + (motivos.length ? ' (' + motivos.join('; ') + ')' : '') + '.');
      }
      if (n0.desconhecido) return fim(SIT.CONFERIR, 'Contagem de batidas desconhecida.');

      // ---- com batidas ----
      const n = n0.valor; L.n = n;
      const hz = lerHorarios(b, dia);
      if (hz.divergente) return fim(SIT.CONFERIR, 'Lista de horários divergente de entrada/saída/contagem, fora do dia ou fora de ordem; nada atribuído.');
      const lista = hz.lista;
      if (!lista) {   // sem detalhe: só entrada/saída/contagem coerentes entre si
        const eOk = modelo.timestampSemFusoValido(b.entrada), sOk = modelo.timestampSemFusoValido(b.saida);
        const ok = n === 1 ? (eOk && (b.saida === null || b.saida === undefined)) : (eOk && sOk);
        if (!ok || n > MAX_BATIDAS) return fim(SIT.CONFERIR, 'Contagem e horários de entrada/saída inconsistentes.');
        if (b.entrada.slice(0, 10) !== dia) return fim(SIT.CONFERIR, 'Entrada fora do dia consultado.');
      }
      const ent = lista ? lista[0] : normTs(b.entrada);
      const ult = lista ? lista[n - 1] : (n >= 2 ? normTs(b.saida) : null);
      L.entrada = hhmm(ent);
      L.impar = n % 2 === 1;

      let sit, expl;
      if (posicao === 'hoje') {
        if (n % 2 === 1) { sit = SIT.DENTRO; expl = 'Número ímpar de batidas: última foi entrada/retorno (por paridade; uma batida perdida inverte isto).'; if (n >= 3) expl = 'Voltou do intervalo (por paridade; uma batida perdida inverte isto).'; }
        else if (n === 4) { sit = SIT.JA_SAIU; expl = 'Quatro batidas: jornada com intervalo encerrada (por paridade).'; }
        else if (n === 2) {
          if (esc && esc.temIntervalo === true) { sit = SIT.INTERVALO; expl = 'Duas batidas e a escala prevê intervalo.'; }
          else if (esc && esc.temIntervalo === false) { sit = SIT.JA_SAIU; expl = 'Duas batidas e a escala não prevê intervalo.'; }
          else { sit = SIT.SAIU_OU_INTERVALO; expl = 'Duas batidas: pode ser saída final ou saída para intervalo; sem escala não dá para decidir.'; }
        } else { sit = SIT.SAIU_OU_INTERVALO; expl = n + ' batidas (par ≥ 6): saída final ou novo intervalo; conferir.'; }
      } else {   // dia passado
        if (n % 2 === 1) { sit = SIT.INCOMPLETO; L.incompleto = true; expl = 'Dia encerrado com número ímpar de batidas (' + n + '): falta uma batida.'; alerta('BATIDAS_IMPARES', 'Número ímpar de batidas (' + n + ') em dia já encerrado: CONFERIR batida faltante.'); }
        else { sit = SIT.JA_SAIU; expl = 'Dia encerrado com número par de batidas.'; }
      }

      // colunas de horário
      if (lista) {
        if (n >= 2 && sit !== SIT.SAIU_OU_INTERVALO) {
          if (n === 2 && sit === SIT.INTERVALO) L.intervaloSaida = hhmm(lista[1]);
          else if (n === 2) L.saida = hhmm(lista[1]);
          else if (n >= 3) { L.intervaloSaida = hhmm(lista[1]); L.intervaloVolta = hhmm(lista[2]); }
          if (n === 4 || (n >= 2 && n % 2 === 0 && sit === SIT.JA_SAIU)) L.saida = hhmm(lista[n - 1]);
        } else if (n >= 2) L.segundaBatida = hhmm(lista[1]);
      } else if (n >= 2) {
        if (sit === SIT.JA_SAIU) L.saida = hhmm(ult);
        else if (sit === SIT.INTERVALO) L.intervaloSaida = hhmm(ult);
        else if (sit === SIT.SAIU_OU_INTERVALO) L.segundaBatida = hhmm(ult);
      }
      if (sit === SIT.INTERVALO && lista && n === 2) L.intervaloSaida = hhmm(lista[1]);

      // ---- alertas (todos CONFERIR; só com fontes reais) ----
      if (temAus === true) alerta('AUSENCIA_E_BATIDA', 'Há ausência registrada no Flash e também batida no mesmo dia: CONFERIR.');
      if (emFolga === true && temAus !== true) alerta('BATIDA_EM_FOLGA', 'Há batida em dia marcado como folga: CONFERIR (troca de folga ou cobertura podem explicar).');
      if (esc && temAus !== true) {
        const entMin = Number(ent.slice(11, 13)) * 60 + Number(ent.slice(14, 16));
        if (esc.inicio !== null && esc.tol !== null && emFolga !== true && entMin > esc.inicio + esc.tol && ent.slice(0, 10) === dia) {
          alerta('ENTRADA_APOS_PREVISTO', 'Entrada ' + L.entrada + ' após o horário previsto ' + fmtMin(esc.inicio) + ' (+' + esc.tol + ' min): CONFERIR.');
        }
        if (lista && n >= 4 && esc.intervaloMin !== null) {
          const dur = Math.round((minAbs(lista[2]) - minAbs(lista[1])));
          if (dur < esc.intervaloMin) alerta('INTERVALO_CURTO', 'Intervalo de ' + dur + ' min, abaixo do mínimo da escala (' + esc.intervaloMin + ' min): CONFERIR.');
        }
        const encerrado = sit === SIT.JA_SAIU && ult && ult.slice(0, 10) === dia;
        if (encerrado && esc.inicio !== null && esc.fim !== null && esc.tol !== null) {
          const entMin2 = entMin, saiMin = Number(ult.slice(11, 13)) * 60 + Number(ult.slice(14, 16));
          if (Math.abs(entMin2 - esc.inicio) > esc.tol || Math.abs(saiMin - esc.fim) > esc.tol) {
            alerta('JORNADA_DIVERGENTE', 'Entrada/saída ' + L.entrada + '–' + hhmm(ult) + ' diferem da escala ' + fmtMin(esc.inicio) + '–' + fmtMin(esc.fim) + ' além da tolerância: CONFERIR.');
          }
        }
      }
      if (posicao === 'hoje' && !leituraFresca) alerta('LEITURA_ANTIGA', 'Leitura do dia possivelmente defasada: a situação pode ter mudado.');
      return fim(sit, expl);
    }

    linhas.sort((a, b) => (a.unidade + '\u0000' + a.nome).localeCompare(b.unidade + '\u0000' + b.nome, 'pt-BR'));
    const resumo = { total: linhas.length, comAlerta: 0 };
    Object.keys(SIT).forEach((k) => { resumo[k] = 0; });
    linhas.forEach((l) => { resumo[l.situacao]++; if (l.alertas.length) resumo.comAlerta++; });
    const comEscala = linhas.filter((l) => !l.semEscala).length;
    const avaliacao = Object.freeze({
      escalaDiaria: comEscala > 0, pessoasComEscala: comEscala,
      atrasoJornadaIntervalo: comEscala > 0
        ? 'Avaliados só para ' + comEscala + ' pessoa(s) com escala fornecida.'
        : 'NÃO AVALIADOS: não existe escala diária/horário oficial no ERP mínimo (rh_pessoa, rh_flash_batida, rh_flash_ausencia, rh_ocorrencia). Objeto futuro: definição administrativa.',
      folga: o.dowConvencao === 'DOM0' || o.dowConvencao === 'SEG1' ? 'Folga fixa do cadastro usada (convenção ' + o.dowConvencao + ').' : 'Folga fixa do cadastro NÃO usada: convenção do dia da semana não definida (definição administrativa pendente).',
    });
    return Object.freeze({ dia, posicao, linhas: Object.freeze(linhas), resumo: Object.freeze(resumo), avisos: Object.freeze(avisos), avaliacao, leituraIdadeMin });
  }

  return {
    SIT, ROTULO, LIMITE_LEITURA_MIN_PADRAO, cruzar, lerHorarios, escalaValida, folgaDoCadastro, indexarAusencias, indexarOcorrencias,
    brtAgora, lojaCombina, nomeSeguro, dataReal, diaSeguinte, diasDesde1970, dataDeDias, dowDom0,
  };
});

