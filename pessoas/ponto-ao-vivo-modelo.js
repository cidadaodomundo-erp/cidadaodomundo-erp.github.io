// PONTO AO VIVO — modelo puro (sem rede, DOM, storage, timer, escrita). Somente leitura e classificação.
// Reutiliza as validações do pacote de ponto completo (ponto-cartao-modelo.js: calendário, timestamps, vínculo por flash_id,
// janela de vínculo, usa_ponto). Contratos lidos: rh_pessoa, rh_flash_batida (horarios opcional), rh_flash_ausencia, rh_ocorrencia.
// REGRA DURA: ausência de batida NUNCA vira falta/atraso/infração. Alertas são sempre "CONFERIR", com explicação, e só
// existem quando as fontes necessárias foram realmente fornecidas. Sem escala diária/horário oficial: degrada com segurança.
// Nada de histórico, CPF, PIS, payload, texto livre, observação ou autor entra aqui. Tipo de ausência/ocorrência NÃO é lido.
//
// LISTA = só quem tem batida VÁLIDA no dia e vínculo ativo (linhas.listar). Sem batida, folga, ausência, desligado
// (dia fora do vínculo), não usa ponto e cargo de confiança (quando o cadastro informa) NÃO viram linha.
// COLUNAS DE HORÁRIO (celulas.*) dizem SEMPRE o que são: 'exato' (horário lido), 'nao' (não ocorreu), 'sem_detalhe'
// (a contagem diz que existe, mas a fonte não traz o horário intermediário) ou 'ambigua' (batida existe, mas não dá
// para dizer se é saída ou intervalo). Intervalo NUNCA é deduzido dos extremos (entrada/última batida).
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
    CARGO_CONFIANCA: 'CARGO_CONFIANCA',
  });
  // só estas situações viram linha da tela: batida VÁLIDA (n>=1, horários coerentes) e vínculo ativo no dia
  const LISTAVEIS = Object.freeze([SIT.DENTRO, SIT.INTERVALO, SIT.JA_SAIU, SIT.SAIU_OU_INTERVALO, SIT.INCOMPLETO]);
  const LIMITE_VIRADA_MIN = 360;   // até 06:00 (Brasília) ainda se procura turno iniciado ontem e sem saída lida
  const LIMITE_DIA_OPERACIONAL_MIN = 420;   // modo Água Verde: antes das 07:00 o dia operacional ainda é o de ontem
  const DUAS_HORAS_MIN = 120;               // regra do antigo: 2 batidas só são "no intervalo" até 2 h após a 2ª (exatas 2 h = saída)
  const JORNADA_VALIDADE_DIAS = 7;          // retrato da jornada cadastral vale no máximo 7 dias
  const ROTULO = Object.freeze({
    DENTRO: ['Dentro da loja', 'ok'], INTERVALO: ['No intervalo', 'ok'], JA_SAIU: ['Já saiu', 'neutro'],
    SEM_BATIDA: ['Ainda sem batida', 'ver'], SAIU_OU_INTERVALO: ['Saiu ou em intervalo (CONFERIR)', 'ver'],
    INCOMPLETO: ['Batidas incompletas (CONFERIR)', 'ver'], AUSENCIA_REGISTRADA: ['Ausência registrada (Flash)', 'neutro'],
    CONFERIR: ['CONFERIR', 'ver'], FORA_DO_VINCULO: ['Fora do vínculo', 'neutro'], NAO_USA_PONTO: ['Não usa ponto (cadastro)', 'neutro'],
    DIA_FUTURO: ['Dia futuro', 'neutro'], CARGO_CONFIANCA: ['Cargo de confiança (não listado)', 'neutro'],
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
  const diaAnterior = (s) => dataDeDias(diasDesde1970(s) - 1);
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
  // 'DD/MM HH:MM' em Brasília, ou null se o instante for inválido
  function rotuloBrt(iso) {
    const a = brtAgora(iso); if (!a) return null;
    return a.data.slice(8, 10) + '/' + a.data.slice(5, 7) + ' ' + fmtMin(a.min);
  }

  // ---------- loja / nome ----------
  const SAO_BRAZ = ['SAO BRAZ', 'SÃO BRAZ'];
  function lojaCombina(unidade, loja, redeOk) {
    if (typeof loja !== 'string' || typeof unidade !== 'string' || !unidade.trim()) return false;
    if (loja === 'REDE') return redeOk === true;
    return unidade === loja || (SAO_BRAZ.includes(unidade) && SAO_BRAZ.includes(loja));
  }
  function textoSeguro(n, max) {
    if (typeof n !== 'string') return '';
    return n.replace(/[\u0000-\u001f\u007f-\u009f‎‏‪-‮⁦-⁩]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
  }
  function nomeSeguro(n, id) {
    const s = textoSeguro(n, 80);
    if (s) return s;
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

  // ---------- refeição (fonte FUTURA: hoje não existe no ERP; só entra se fornecida) ----------
  // refeicoes = { disponivel:true, porPessoa: Map|objeto { [pessoaId]: [{ tipo, produto, quantidade, hora:'HH:MM' }] } }
  // Qualquer outra coisa => estado 'indisponivel' (NUNCA "não lançou": ausência de fonte não prova ausência de refeição).
  function celulaRefeicao(refeicoes, id) {
    if (!ehObj(refeicoes) || refeicoes.disponivel !== true) return { estado: 'indisponivel', itens: [] };
    const m = refeicoes.porPessoa;
    const bruto = m instanceof Map ? m.get(id) : (ehObj(m) ? m[id] : undefined);
    const itens = (Array.isArray(bruto) ? bruto : []).filter(ehObj).map((i) => ({
      tipo: textoSeguro(i.tipo, 30), produto: textoSeguro(i.produto, 60),
      quantidade: Number.isInteger(i.quantidade) && i.quantidade > 0 && i.quantidade <= 99 ? i.quantidade : 1,
      hora: minHHMM(i.hora) !== null ? i.hora : null,
    }));
    if (itens.length) return { estado: 'lancada', itens };
    // com lista de identificados, quem não tem vínculo de refeição confirmado NÃO pode ser declarado "não lançou"
    if (Array.isArray(refeicoes.identificados) && !refeicoes.identificados.includes(id)) return { estado: 'sem_vinculo', itens: [] };
    return { estado: 'nao_lancou', itens: [] };
  }

  // ---------- células de horário ----------
  const celExata = (ts, dia) => ({ estado: 'exato', v: hhmm(ts), mais1: ts.slice(0, 10) !== dia });
  const celNao = () => ({ estado: 'nao', v: null, mais1: false });
  const celSemDetalhe = () => ({ estado: 'sem_detalhe', v: null, mais1: false });
  const celAmbigua = (ts, dia) => ({ estado: 'ambigua', v: ts ? hhmm(ts) : null, mais1: ts ? ts.slice(0, 10) !== dia : false });

  /**
   * cruzar({ pessoas, batidas, batidasAnterior, ausencias, ocorrencias, dia, consultadoEm, loja, redeOk, fontes, escalaDia,
   *          dowConvencao, limiteLeituraMin, refeicoes, ultimaLeituraGeral })
   *  - fontes: { ausencias, ocorrencias, anterior: true|false } (false/ausente = fonte NÃO carregada ou truncada)
   *  - batidasAnterior: linhas de rh_flash_batida do dia anterior (só usadas na virada da madrugada, hoje, antes das 06:00)
   *  - escalaDia: Map|objeto { [pessoaId]: escala } — objeto futuro; ausente em produção hoje
   *  - dowConvencao: 'DOM0' | 'SEG1' | null (escolha do Fabio; null => folga fixa do cadastro não é usada)
   *  - refeicoes: ver celulaRefeicao (fonte futura); ultimaLeituraGeral: ISO do último lido_em da tabela (frescor sem linhas no dia)
   *  Retorna: linhas (todas do cadastro da loja), listadas (só batida válida + vínculo ativo), resumo, fonte, avisos, avaliacao.
   */
  function cruzar(o) {
    const { pessoas, batidas, dia, consultadoEm, loja, redeOk } = o;
    const fontes = ehObj(o.fontes) ? o.fontes : {};
    const limite = Number.isInteger(o.limiteLeituraMin) && o.limiteLeituraMin > 0 ? o.limiteLeituraMin : LIMITE_LEITURA_MIN_PADRAO;
    const avisos = [];
    const agora = brtAgora(consultadoEm);
    if (!dataReal(dia)) throw new Error('dia inválido');
    // modoAguaVerde (SÓ leitura direta): "hoje" é o dia OPERACIONAL (antes das 07:00 ainda é ontem); consulta histórica continua 'passado'
    const modoAV = o.modoAguaVerde === true;
    const refDia = !agora ? null : (modoAV ? (agora.min < LIMITE_DIA_OPERACIONAL_MIN ? diaAnterior(agora.data) : agora.data) : agora.data);
    const posicao = !agora ? 'desconhecida' : (dia === refDia ? 'hoje' : (dia < refDia ? 'passado' : 'futuro'));
    const agoraAbs = agora ? diasDesde1970(agora.data) * 1440 + agora.min : null;
    // jornada cadastral (retrato privado, NÃO é escala diária): só nome+unidade únicos já resolvidos pelo servidor; vence em 7 dias
    const jornadaDe = (id, dd) => {
      const m = o.jornadas, x = m instanceof Map ? m.get(id) : (ehObj(m) ? m[id] : null);
      if (!ehObj(x)) return null;
      const ini = minHHMM(x.entrada), fim = minHHMM(x.saida);
      if (ini === null || fim === null || ini === fim || !dataReal(x.conferidoEm)) return null;
      // frescor contra o dia CIVIL de agora (BRT) e só no vivo (posição 'hoje'); histórico nunca usa jornada
      if (!agora || posicao !== 'hoje') return null;
      const idade = diasDesde1970(agora.data) - diasDesde1970(x.conferidoEm);
      if (idade < 0 || idade > JORNADA_VALIDADE_DIAS) return null;
      return { fimAbs: diasDesde1970(dd) * 1440 + fim + (fim < ini ? 1440 : 0), conferidoEm: x.conferidoEm };
    };
    if (!agora) avisos.push('Hora da consulta inválida: nenhuma situação ao vivo foi atribuída; tudo em CONFERIR.');
    (Array.isArray(o.avisosExtras) ? o.avisosExtras : []).slice(0, 20).forEach((t) => { const s = textoSeguro(t, 200); if (s) avisos.push(s); });   // avisos já contados pela leitura direta (só texto)
    // leitura DIRETA (Flash) bem-sucedida: vale como leitura do dia mesmo sem nenhuma batida (lista vazia = ninguém bateu, não "sem leitura")
    const direta = ehObj(o.fonteDireta) && modelo.isoComFusoValido(o.fonteDireta.lidoEm) ? { lidoEm: o.fonteDireta.lidoEm, rotulo: textoSeguro(o.fonteDireta.rotulo, 60) || 'leitura direta' } : null;

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
    const flashesCadastro = new Set(contaFlash.keys());
    function indexarBatidas(lista, diaAlvo) {
      const mapa = new Map(); let semCadastro = 0;
      (Array.isArray(lista) ? lista : []).forEach((b) => {
        if (!ehObj(b) || b.data !== diaAlvo || !modelo.flashIdValido(b.flash_id)) return;
        if (!flashesCadastro.has(b.flash_id)) semCadastro++;
        mapa.set(b.flash_id, (mapa.get(b.flash_id) || []).concat([b]));
      });
      return { mapa, semCadastro };
    }
    const hoje = indexarBatidas(batidas, dia);
    const porFlash = hoje.mapa;
    if (hoje.semCadastro) avisos.push(hoje.semCadastro + ' leitura(s) do dia sem cadastro correspondente (não exibidas).');

    // frescor da leitura do dia (maior lido_em válido entre as linhas do dia)
    let ultimaLeituraMs = null, linhasDoDia = 0;
    porFlash.forEach((ls) => ls.forEach((b) => {
      linhasDoDia++;
      const t = modelo.isoComFusoValido(b.lido_em) ? Date.parse(b.lido_em) : NaN;
      if (!Number.isNaN(t) && (ultimaLeituraMs === null || t > ultimaLeituraMs)) ultimaLeituraMs = t;
    }));
    if (direta && posicao === 'hoje') { const t = Date.parse(direta.lidoEm); if (!Number.isNaN(t)) ultimaLeituraMs = t; }   // a leitura direta é do momento da consulta
    const leituraIdadeMin = agora && ultimaLeituraMs !== null ? Math.max(0, Math.round((agora.ms - ultimaLeituraMs) / 60000)) : null;
    const leituraFresca = leituraIdadeMin !== null && leituraIdadeMin <= limite;
    if (posicao === 'hoje' && !leituraFresca) avisos.push(leituraIdadeMin === null ? 'Nenhuma leitura datada do dia: não dá para dizer quem ainda não bateu.' : 'Última leitura do dia há ' + leituraIdadeMin + ' min (limite ' + limite + '): situações podem estar defasadas.');

    const celulasVazias = () => ({ entrada: celNao(), saiuIntervalo: celNao(), voltouIntervalo: celNao(), saida: celNao() });

    // alvo = { dia, mapa, posicao, virada }: a mesma montagem serve ao dia consultado e ao turno de ontem (virada)
    function montarLinha(p, alvo) {
      const dd = alvo.dia, pos = alvo.posicao;
      const L = {
        nome: nomeSeguro(p.nome, p.id), unidade: typeof p.unidade === 'string' ? p.unidade : '', dia: dd, pessoaId: Number.isInteger(p.id) ? p.id : null,
        situacao: SIT.CONFERIR, explicacao: '', n: null, entrada: null, impar: false, incompleto: false, alertas: [], lidoHaMin: null, semEscala: true,
        temLeitura: modelo.flashIdValido(p.flash_id) && (alvo.mapa.get(p.flash_id) || []).length > 0, listar: false,
        virada: alvo.virada === true, diaOrigem: alvo.virada === true ? dd : null,
        celulas: celulasVazias(), todasBatidas: null, ultimaBatida: null, detalhe: false,
        refeicao: celulaRefeicao(alvo.virada === true ? o.refeicoesAnterior : o.refeicoes, p.id),   // turno de ontem: só a refeição de ONTEM
      };
      const alerta = (codigo, texto) => L.alertas.push({ codigo, texto });
      const fim = (sit, expl) => { L.situacao = sit; L.explicacao = expl || ''; L.rotulo = ROTULO[sit][0]; L.classe = ROTULO[sit][1]; L.listar = LISTAVEIS.includes(sit); return Object.freeze(L); };

      if (pos === 'desconhecida') return fim(SIT.CONFERIR, 'A hora da consulta é inválida; não há como saber o dia atual.');
      if (p.cargo_confianca === true) return fim(SIT.CARGO_CONFIANCA, 'Cadastro marca cargo de confiança: fora da lista do ponto ao vivo.');
      if (modelo.flashIdValido(p.flash_id) && contaFlash.get(p.flash_id) > 1) return fim(SIT.CONFERIR, 'Mesmo flash_id em mais de um cadastro: batidas não atribuídas.');
      const linhasDia = modelo.flashIdValido(p.flash_id) ? (alvo.mapa.get(p.flash_id) || []) : [];
      if (linhasDia.length > 1) return fim(SIT.CONFERIR, 'Leituras duplicadas para este dia: batidas não atribuídas.');
      const b = linhasDia[0] || null;

      const temAus = alvo.virada ? null : (aus ? aus.porFlash.get(p.flash_id) === true : null);   // null = desconhecido
      const ctx = { id: p.id, flash_id: p.flash_id, unidade: p.unidade, admissao: p.admissao, desligamento: p.desligamento === null ? undefined : p.desligamento, usa_ponto: p.usa_ponto };
      let r;
      try {
        r = modelo.montarResumoCartao(ctx, b ? b : { data: dd, flash_id: p.flash_id, n_batidas: 0 }, consultadoEm, { folgaConfirmada: null, ausenciaConfirmada: temAus });
      } catch (e) { return fim(SIT.CONFERIR, 'Cadastro ou leitura em formato não reconhecido.'); }
      if (r.estado === 'VINCULO_NAO_CONFIRMADO') return fim(SIT.CONFERIR, 'Vínculo não confirmado (id, flash_id ou datas do cadastro).');
      if (r.estado === 'FORA_DO_VINCULO') return fim(SIT.FORA_DO_VINCULO, 'Dia fora do período de vínculo (antes da admissão ou depois do desligamento).');
      if (r.estado === 'NAO_USA_PONTO') return fim(SIT.NAO_USA_PONTO, 'Cadastro marca que não usa ponto; não é falta.');
      if (r.estado === 'DADOS_INVALIDOS' || r.estado === 'SAIDA_SEM_ENTRADA') return fim(SIT.CONFERIR, 'Dados da leitura inválidos ou inconsistentes.');
      if (pos === 'futuro') return fim(SIT.DIA_FUTURO, 'Dia ainda não chegou; nada a classificar.');

      const esc = escalaDe(p.id);
      L.semEscala = !esc;
      const folgaCad = folgaDoCadastro(p.folga_fixa_dow, dd, o.dowConvencao);
      const emFolga = (esc && esc.folga === true) ? true : (esc && esc.folga === false ? false : (folgaCad.estado === 'sim' ? true : (folgaCad.estado === 'nao' ? false : null)));
      const temOco = oco && !alvo.virada ? oco.set.has(p.id) : null;
      if (b) { const t = modelo.isoComFusoValido(b.lido_em) ? Date.parse(b.lido_em) : NaN; if (agora && !Number.isNaN(t)) L.lidoHaMin = Math.max(0, Math.round((agora.ms - t) / 60000)); }

      // ---- sem batida (não listada; fica só para contagem e para o aviso de fonte) ----
      const n0 = b ? modelo.contarInteiro(b.n_batidas) : { valor: 0, desconhecido: false };
      if (b && !n0.desconhecido && n0.valor === 0 && ((b.entrada !== null && b.entrada !== undefined) || (b.saida !== null && b.saida !== undefined) || (Array.isArray(b.horarios) && b.horarios.length > 0))) {
        return fim(SIT.CONFERIR, 'Contagem zero, mas há horário na leitura: dados inconsistentes.');
      }
      if (!b || (!n0.desconhecido && n0.valor === 0)) {
        L.n = 0;
        if (temAus === true) return fim(SIT.AUSENCIA_REGISTRADA, 'Há ausência registrada no Flash cobrindo o dia; o tipo não é lido nem interpretado.');
        const motivos = [];
        if (!b && pos === 'hoje' && !leituraFresca) return fim(SIT.CONFERIR, 'Sem leitura recente do dia; não dá para afirmar que ainda não bateu.');
        if (temAus === null) motivos.push('fonte de ausências indisponível');
        if (temOco === true) motivos.push('há ocorrência registrada neste dia (tipo não lido)');
        if (emFolga === null) motivos.push('folga do dia desconhecida');
        if (!esc) motivos.push('sem escala diária/horário oficial');
        // só com TODAS as fontes e escala completa pode surgir o alerta de possível atraso — sempre CONFERIR, nunca infração
        if (esc && esc.inicio !== null && esc.tol !== null && pos === 'hoje' && leituraFresca && temAus === false && temOco === false && emFolga === false && agora.min > esc.inicio + esc.tol) {
          alerta('SEM_BATIDA_APOS_HORARIO', 'Sem batida lida ' + (agora.min - esc.inicio) + ' min após o horário previsto (' + fmtMin(esc.inicio) + '): CONFERIR. Pode ser leitura atrasada, troca de escala ou ausência ainda não lançada.');
        }
        return fim(SIT.SEM_BATIDA, 'Nenhuma batida lida; isto não é falta nem atraso' + (motivos.length ? ' (' + motivos.join('; ') + ')' : '') + '.');
      }
      if (n0.desconhecido) return fim(SIT.CONFERIR, 'Contagem de batidas desconhecida.');

      // ---- com batidas ----
      const n = n0.valor; L.n = n;
      const hz = lerHorarios(b, dd);
      if (hz.divergente) return fim(SIT.CONFERIR, 'Lista de horários divergente de entrada/saída/contagem, fora do dia (ou da virada da madrugada) ou fora de ordem; nada atribuído.');
      const lista = hz.lista;
      if (!lista) {   // sem detalhe: só entrada/saída/contagem coerentes entre si
        const eOk = modelo.timestampSemFusoValido(b.entrada), sOk = modelo.timestampSemFusoValido(b.saida);
        const ok = n === 1 ? (eOk && (b.saida === null || b.saida === undefined)) : (eOk && sOk);
        if (!ok || n > MAX_BATIDAS) return fim(SIT.CONFERIR, 'Contagem e horários de entrada/saída inconsistentes.');
        if (b.entrada.slice(0, 10) !== dd) return fim(SIT.CONFERIR, 'Entrada fora do dia consultado.');
        if (n >= 2) {   // virada da madrugada: a saída pode cair no dia seguinte, nunca antes da entrada nem depois disso
          const sd = b.saida.slice(0, 10);
          if (sd !== dd && sd !== diaSeguinte(dd)) return fim(SIT.CONFERIR, 'Saída fora do dia consultado e da virada da madrugada.');
          if (minAbs(normTs(b.saida)) < minAbs(normTs(b.entrada))) return fim(SIT.CONFERIR, 'Saída anterior à entrada.');
        }
      }
      const ent = lista ? lista[0] : normTs(b.entrada);
      const ult = lista ? lista[n - 1] : (n >= 2 ? normTs(b.saida) : null);
      L.entrada = hhmm(ent);
      L.impar = n % 2 === 1;
      L.detalhe = !!lista;
      L.todasBatidas = lista ? lista.map((t) => ({ v: hhmm(t), mais1: t.slice(0, 10) !== dd })) : null;
      L.ultimaBatida = ult ? { v: hhmm(ult), mais1: ult.slice(0, 10) !== dd } : null;

      let sit, expl;
      if (pos === 'hoje') {
        if (n % 2 === 1) { sit = SIT.DENTRO; expl = 'Número ímpar de batidas: última foi entrada/retorno (por paridade; uma batida perdida inverte isto).'; if (n >= 3) expl = 'Voltou do intervalo (por paridade; uma batida perdida inverte isto).'; }
        else if (n === 4) { sit = SIT.JA_SAIU; expl = 'Quatro batidas: jornada com intervalo encerrada (por paridade).'; }
        else if (n === 2 && modoAV) {   // regra do antigo: no intervalo SE agora < 2ª+2h E (sem fim OU agora < fim); sem jornada, dentro das 2 h, NÃO se afirma
          const segAbs = minAbs(ult), jr = alvo.virada ? null : jornadaDe(p.id, dd);
          const jtxt = jr ? ' Jornada cadastral conferida em ' + jr.conferidoEm.slice(8, 10) + '/' + jr.conferidoEm.slice(5, 7) + '; não é escala diária.' : '';
          if (agoraAbs >= segAbs + DUAS_HORAS_MIN) { sit = SIT.JA_SAIU; expl = 'Duas batidas e já passaram 2 h da segunda: saída.'; }
          else if (jr) { if (agoraAbs < jr.fimAbs) { sit = SIT.INTERVALO; expl = 'Duas batidas, menos de 2 h da segunda e antes do fim da jornada cadastral: no intervalo.' + jtxt; } else { sit = SIT.JA_SAIU; expl = 'Duas batidas e o fim da jornada cadastral já passou: saída.' + jtxt; } }
          else { sit = SIT.SAIU_OU_INTERVALO; expl = 'Duas batidas há menos de 2 h e sem jornada cadastral recente e única: pode ser saída ou intervalo; não afirmado.'; }
        } else if (n === 2) {
          if (esc && esc.temIntervalo === true) { sit = SIT.INTERVALO; expl = 'Duas batidas e a escala prevê intervalo.'; }
          else if (esc && esc.temIntervalo === false) { sit = SIT.JA_SAIU; expl = 'Duas batidas e a escala não prevê intervalo.'; }
          else { sit = SIT.SAIU_OU_INTERVALO; expl = 'Duas batidas: pode ser saída final ou saída para intervalo; sem escala não dá para decidir.'; }
        } else { sit = SIT.SAIU_OU_INTERVALO; expl = n + ' batidas (par ≥ 6): saída final ou novo intervalo; conferir.'; }
      } else {   // dia passado
        if (n % 2 === 1) { sit = SIT.INCOMPLETO; L.incompleto = true; expl = 'Dia encerrado com número ímpar de batidas (' + n + '): falta uma batida.'; alerta('BATIDAS_IMPARES', 'Número ímpar de batidas (' + n + ') em dia já encerrado: CONFERIR batida faltante.'); }
        else { sit = SIT.JA_SAIU; expl = 'Dia encerrado com número par de batidas.'; }
      }

      // ---- colunas de horário: só horário LIDO; intervalo nunca sai dos extremos ----
      const cel = L.celulas; cel.entrada = celExata(ent, dd);
      const par = n % 2 === 0;
      if (n === 2) {
        const seg = lista ? lista[1] : ult;   // 2ª batida = última batida (n=2): é exata, só o RÓTULO depende da situação
        if (sit === SIT.INTERVALO) cel.saiuIntervalo = celExata(seg, dd);
        else if (sit === SIT.JA_SAIU) { cel.saida = celExata(seg, dd); if (modoAV) cel.saiuIntervalo = celExata(seg, dd); }   // antigo: 2 batidas encerradas mostram a 2ª nas duas colunas
        else { cel.saida = celAmbigua(seg, dd); cel.saiuIntervalo = celAmbigua(modoAV ? seg : null, dd); }
      } else if (n >= 3) {
        if (lista && n <= 4) {
          cel.saiuIntervalo = celExata(lista[1], dd); cel.voltouIntervalo = celExata(lista[2], dd);
          if (n === 4) cel.saida = celExata(lista[3], dd);
        } else if (lista) {   // 5+ batidas: não há coluna certa para cada uma; todasBatidas lista todas
          cel.saiuIntervalo = celAmbigua(null, dd); cel.voltouIntervalo = celAmbigua(null, dd);
          if (par) cel.saida = sit === SIT.JA_SAIU ? celExata(ult, dd) : celAmbigua(ult, dd);
        } else {   // contagem diz que há batida intermediária, a fonte não traz o horário
          cel.saiuIntervalo = celSemDetalhe(); cel.voltouIntervalo = celSemDetalhe();
          if (par) cel.saida = sit === SIT.JA_SAIU ? celExata(ult, dd) : celAmbigua(ult, dd);
        }
      }

      // ---- alertas (todos CONFERIR; só com fontes reais) ----
      if (temAus === true) alerta('AUSENCIA_E_BATIDA', 'Há ausência registrada no Flash e também batida no mesmo dia: CONFERIR.');
      if (emFolga === true && temAus !== true) alerta('BATIDA_EM_FOLGA', 'Há batida em dia marcado como folga: CONFERIR (troca de folga ou cobertura podem explicar).');
      if (esc && temAus !== true) {
        const entMin = Number(ent.slice(11, 13)) * 60 + Number(ent.slice(14, 16));
        if (esc.inicio !== null && esc.tol !== null && emFolga !== true && entMin > esc.inicio + esc.tol && ent.slice(0, 10) === dd) {
          alerta('ENTRADA_APOS_PREVISTO', 'Entrada ' + L.entrada + ' após o horário previsto ' + fmtMin(esc.inicio) + ' (+' + esc.tol + ' min): CONFERIR.');
        }
        if (lista && n >= 4 && esc.intervaloMin !== null) {
          const dur = Math.round((minAbs(lista[2]) - minAbs(lista[1])));
          if (dur < esc.intervaloMin) alerta('INTERVALO_CURTO', 'Intervalo de ' + dur + ' min, abaixo do mínimo da escala (' + esc.intervaloMin + ' min): CONFERIR.');
        }
        const encerrado = sit === SIT.JA_SAIU && ult && ult.slice(0, 10) === dd;
        if (encerrado && esc.inicio !== null && esc.fim !== null && esc.tol !== null) {
          const saiMin = Number(ult.slice(11, 13)) * 60 + Number(ult.slice(14, 16));
          if (Math.abs(entMin - esc.inicio) > esc.tol || Math.abs(saiMin - esc.fim) > esc.tol) {
            alerta('JORNADA_DIVERGENTE', 'Entrada/saída ' + L.entrada + '–' + hhmm(ult) + ' diferem da escala ' + fmtMin(esc.inicio) + '–' + fmtMin(esc.fim) + ' além da tolerância: CONFERIR.');
          }
        }
      }
      if (pos === 'hoje' && !alvo.virada && !leituraFresca) alerta('LEITURA_ANTIGA', 'Leitura do dia possivelmente defasada: a situação pode ter mudado.');
      if (alvo.virada) alerta('TURNO_DE_ONTEM', 'Turno iniciado em ' + dd.slice(8, 10) + '/' + dd.slice(5, 7) + ' e sem saída lida: CONFERIR se ainda está na loja (a leitura é de ontem).');
      return fim(sit, expl);
    }

    const pessoasLoja = (Array.isArray(pessoas) ? pessoas : []).filter((p) => ehObj(p) && lojaCombina(p.unidade, loja, redeOk));
    const alvoHoje = { dia, mapa: porFlash, posicao: posicao, virada: false };
    const linhas = pessoasLoja.map((p) => montarLinha(p, alvoHoje));

    // ---- virada da madrugada: hoje, antes das 06:00, turno de ontem ainda sem saída lida (nunca inferido; sempre CONFERIR) ----
    let viradaStatus = 'nao_aplica';
    if (posicao === 'hoje' && agora && agora.min < LIMITE_VIRADA_MIN && !modoAV) {   // no modo Água Verde o dia operacional já cobre a madrugada
      if (fontes.anterior !== true) { viradaStatus = 'indisponivel'; avisos.push('Madrugada: a leitura de ontem não foi carregada; turnos iniciados ontem e ainda abertos não puderam ser conferidos.'); }
      else {
        viradaStatus = 'conferida';
        const ant = indexarBatidas(o.batidasAnterior, diaAnterior(dia));
        const jaTemHoje = new Set(linhas.filter((l) => l.listar).map((l) => l.pessoaId));
        pessoasLoja.forEach((p) => {
          if (jaTemHoje.has(Number.isInteger(p.id) ? p.id : null)) return;
          const l = montarLinha(p, { dia: diaAnterior(dia), mapa: ant.mapa, posicao: 'hoje', virada: true });
          if (l.listar && l.situacao !== SIT.JA_SAIU) linhas.push(l);
        });
      }
    }

    linhas.sort((a, b) => (a.unidade + '\u0000' + a.nome).localeCompare(b.unidade + '\u0000' + b.nome, 'pt-BR'));
    const listadas = linhas.filter((l) => l.listar);
    const resumo = { total: linhas.length, comAlerta: 0 };
    Object.keys(SIT).forEach((k) => { resumo[k] = 0; });
    linhas.forEach((l) => { resumo[l.situacao]++; if (l.alertas.length) resumo.comAlerta++; });
    resumo.listadas = listadas.length;
    resumo.comAlertaListadas = listadas.filter((l) => l.alertas.length > 0).length;
    resumo.naLista = {};
    LISTAVEIS.forEach((k) => { resumo.naLista[k] = listadas.filter((l) => l.situacao === k).length; });
    resumo.ocultosConferir = linhas.filter((l) => !l.listar && l.temLeitura && l.situacao === SIT.CONFERIR).length;
    resumo.ocultosVinculo = linhas.filter((l) => !l.listar && l.temLeitura && [SIT.FORA_DO_VINCULO, SIT.NAO_USA_PONTO, SIT.CARGO_CONFIANCA].includes(l.situacao)).length;
    if (resumo.ocultosConferir) avisos.push(resumo.ocultosConferir + ' cadastro(s) com leitura no dia, mas com dado inválido, duplicado ou ambíguo, NÃO foram listados (batida válida é exigida).');
    if (resumo.ocultosVinculo) avisos.push(resumo.ocultosVinculo + ' cadastro(s) com leitura no dia fora do vínculo, sem ponto no cadastro ou cargo de confiança NÃO foram listados.');

    // ---- frescor / disponibilidade da fonte (o que a tela diz sobre de onde veio o dado) ----
    let leituraIso = null, escopoLeitura = null;
    if (ultimaLeituraMs !== null) { leituraIso = new Date(ultimaLeituraMs).toISOString(); escopoLeitura = 'dia'; }
    else if (direta) { leituraIso = direta.lidoEm; escopoLeitura = 'dia'; }
    else if (modelo.isoComFusoValido(o.ultimaLeituraGeral)) { leituraIso = o.ultimaLeituraGeral; escopoLeitura = 'geral'; }
    const geralMs = leituraIso ? Date.parse(leituraIso) : NaN;
    const idadeLeitura = agora && !Number.isNaN(geralMs) ? Math.max(0, Math.round((agora.ms - geralMs) / 60000)) : null;
    const comDetalhe = listadas.filter((l) => l.detalhe).length;
    const fonte = Object.freeze({
      tabela: direta ? null : 'rh_flash_batida', direta: direta ? direta.rotulo : null, linhasDoDia, semLeituraDoDia: !direta && linhasDoDia === 0,
      ultimaLeituraIso: leituraIso, ultimaLeituraRotulo: leituraIso ? rotuloBrt(leituraIso) : null, escopoLeitura, idadeLeituraMin: idadeLeitura,
      fresca: escopoLeitura === 'dia' && (leituraFresca || (!!direta && posicao !== 'hoje')),
      detalhe: !listadas.length ? 'sem_linhas' : (comDetalhe === listadas.length ? 'completo' : (comDetalhe === 0 ? 'nenhum' : 'parcial')),
      comDetalhe, semDetalhe: listadas.length - comDetalhe,
      refeicao: ehObj(o.refeicoes) && o.refeicoes.disponivel === true ? 'disponivel' : 'indisponivel',
      virada: viradaStatus,
    });
    const comEscala = linhas.filter((l) => !l.semEscala).length;
    const cargoConfiancaDisponivel = (Array.isArray(pessoas) ? pessoas : []).some((p) => ehObj(p) && typeof p.cargo_confianca === 'boolean');
    const avaliacao = Object.freeze({
      escalaDiaria: comEscala > 0, pessoasComEscala: comEscala,
      atrasoJornadaIntervalo: comEscala > 0
        ? 'Avaliados só para ' + comEscala + ' pessoa(s) com escala fornecida.'
        : 'NÃO AVALIADOS: não existe escala diária/horário oficial no ERP mínimo (rh_pessoa, rh_flash_batida, rh_flash_ausencia, rh_ocorrencia). Objeto futuro: escolha do Fabio.',
      folga: o.dowConvencao === 'DOM0' || o.dowConvencao === 'SEG1' ? 'Folga fixa do cadastro usada (convenção ' + o.dowConvencao + ').' : 'Folga fixa do cadastro NÃO usada: convenção do dia da semana não definida (escolha do Fabio).',
      cargoConfianca: cargoConfiancaDisponivel,
    });
    return Object.freeze({ dia, posicao, linhas: Object.freeze(linhas), listadas: Object.freeze(listadas), resumo: Object.freeze(resumo), avisos: Object.freeze(avisos), avaliacao, fonte, leituraIdadeMin });
  }

  return {
    SIT, ROTULO, LISTAVEIS, LIMITE_LEITURA_MIN_PADRAO, LIMITE_VIRADA_MIN, cruzar, lerHorarios, escalaValida, folgaDoCadastro, indexarAusencias, indexarOcorrencias,
    LIMITE_DIA_OPERACIONAL_MIN,
    // dia operacional (Água Verde) de um instante ISO com fuso: antes das 07:00 é ontem, às 07:00 é hoje; null se o instante for inválido
    diaOperacionalDe: (iso) => { const a = brtAgora(iso); return a ? (a.min < LIMITE_DIA_OPERACIONAL_MIN ? diaAnterior(a.data) : a.data) : null; },
    brtAgora, rotuloBrt, lojaCombina, nomeSeguro, dataReal, diaSeguinte, diaAnterior, diasDesde1970, dataDeDias, dowDom0, celulaRefeicao,
  };
});

