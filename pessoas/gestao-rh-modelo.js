// GESTÃO DO RH — ERROS DO DIA (rota prh, Sistema operacional do Fábio > RH). Regra PURA: não lê rede, não escreve, não guarda nada.
// Pedido do Fábio (13/11/2026): levar a função da "Gestão do RH" do portal antigo (quem não lançou refeição, quem se atrasou,
// quem ficou com batida faltando), com o visual do portal novo. Entrada = a resposta do leitor próprio já existente
// (Edge Function fabio-ponto-leitura: Flash direto + refeições do Saipos já recebidas). Nada do robô/tabelas/telas do Neto muda.
//
// Regras reimplementadas do motor antigo (mesmos limites): batidas incompletas = 1 a 3 batidas; intervalo = soma das saídas
// do meio; atraso = entrada mais de 10 e até 45 min depois do horário; mais de 45 min = horário destoa (conferir escala);
// saída mais de 10 e até 45 min depois do horário; perto do teto = 9h30 líquidas ou mais.
// DIFERENÇAS DECLARADAS (o portal novo ainda não tem jornada contratada nem escala diária):
//  - mínimo legal de intervalo usa o tempo TRABALHADO no dia (mais de 6h = 60 min; mais de 4h = 15 min), não a jornada contratada;
//  - atraso/saída só aparecem quando o leitor manda a jornada da pessoa (hoje: só no dia em andamento, retrato de até 7 dias);
//  - hora extra, jornada a menor, falta e folga NÃO são afirmadas: quem não bateu aparece como "sem batida", sem acusar falta;
//  - dia em andamento não acusa batida incompleta nem refeição (a pessoa ainda pode bater/lançar);
//  - 5 ou mais batidas em número ímpar (dia fechado) = batidas incompletas, sem calcular intervalo (o motor antigo só olhava menos de 4).
(function (root, factory) {
  'use strict';
  const m = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = m;
  if (root) root.GestaoRhModelo = m;
})(typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : null), function () {
  'use strict';

  const TOLERANCIA_MIN = 10, DIVERGENTE_MIN = 45, TETO_AVISO_MIN = 570, MAX_BATIDAS = 24;
  const NIVEL = Object.freeze({
    SERIO: { ordem: 1, rotulo: 'Sério' }, INFRACAO: { ordem: 2, rotulo: 'Batida faltando' }, VERBAL: { ordem: 3, rotulo: 'Orientar' },
    CONFERIR: { ordem: 4, rotulo: 'Conferir' }, SEM: { ordem: 9, rotulo: 'Sem apontamento' },
  });
  const CATEGORIA = Object.freeze({
    INTERVALO_ABAIXO_LEGAL: { nivel: 'SERIO', ordem: 10, rotulo: 'Intervalo abaixo do mínimo legal' },
    BATIDAS_INCOMPLETAS: { nivel: 'INFRACAO', ordem: 30, rotulo: 'Batidas incompletas' },
    ATRASO: { nivel: 'VERBAL', ordem: 40, rotulo: 'Atraso na entrada' },
    SAIU_APOS_HORARIO: { nivel: 'VERBAL', ordem: 42, rotulo: 'Saiu depois do horário' },
    ESCALA_DIVERGENTE: { nivel: 'CONFERIR', ordem: 52, rotulo: 'Horário destoa do cadastrado' },
    TETO_10H: { nivel: 'CONFERIR', ordem: 54, rotulo: 'Perto do teto de 10h' },
    LEITURA_INVALIDA: { nivel: 'CONFERIR', ordem: 56, rotulo: 'Leitura a conferir' },
  });

  const ehObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
  const DATA_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
  const TS_RE = /^(\d{4}-\d{2}-\d{2})[T ]([01]\d|2[0-3]):([0-5]\d)(?::[0-5]\d(?:\.\d+)?)?$/;
  const HM_RE = /^([01]\d|2[0-3]):([0-5]\d)$/;
  function dataValida(s) {
    const m = typeof s === 'string' ? DATA_RE.exec(s) : null; if (!m) return false;
    const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
    return d.getUTCFullYear() === +m[1] && d.getUTCMonth() === +m[2] - 1 && d.getUTCDate() === +m[3];
  }
  function somarDias(s, n) { const m = DATA_RE.exec(s); return new Date(Date.UTC(+m[1], +m[2] - 1, +m[3] + n)).toISOString().slice(0, 10); }
  const fmtHM = (min) => { const x = ((min % 1440) + 1440) % 1440; return String(Math.floor(x / 60)).padStart(2, '0') + ':' + String(x % 60).padStart(2, '0'); };
  const fmtDur = (min) => Math.floor(min / 60) + 'h' + String(min % 60).padStart(2, '0');
  const minHM = (s) => { const m = typeof s === 'string' ? HM_RE.exec(s) : null; return m ? +m[1] * 60 + +m[2] : null; };
  function texto(s, max) {
    if (typeof s !== 'string') return '';
    return s.replace(/[\u0000-\u001f\u007f<>]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
  }
  // janela de dias que o leitor aceita: o dia operacional de hoje e os 6 anteriores
  function diasPermitidos(hojeOperacional) {
    if (!dataValida(hojeOperacional)) return [];
    const out = []; for (let i = 6; i >= 0; i--) out.push(somarDias(hojeOperacional, -i)); return out;
  }

  // batidas do dia em minutos desde 00:00 do dia pedido (madrugada do dia seguinte = +1440); null = leitura não confiável
  function minutosDoDia(horarios, dia) {
    if (!Array.isArray(horarios) || horarios.length > MAX_BATIDAS) return null;
    const prox = somarDias(dia, 1); const out = [];
    for (const h of horarios) {
      const m = typeof h === 'string' ? TS_RE.exec(h) : null;
      if (!m || (m[1] !== dia && m[1] !== prox)) return null;
      out.push(+m[2] * 60 + +m[3] + (m[1] === prox ? 1440 : 0));
    }
    for (let i = 1; i < out.length; i++) if (out[i] < out[i - 1]) return null;
    return out;
  }
  // 4+ batidas: intervalo = soma das saídas do meio (2ª→3ª, 4ª→5ª…); líquido = última − primeira − intervalo
  function medir(mins) {
    const n = mins.length; if (n < 2) return { intervalo: null, liquido: null };
    if (n < 4 || n % 2 === 1) return { intervalo: null, liquido: null };   // número ímpar: falta um registro, não dá para medir sem adivinhar
    let interv = 0; for (let i = 1; i + 1 <= n - 1; i += 2) interv += mins[i + 1] - mins[i];
    return { intervalo: interv, liquido: (mins[n - 1] - mins[0]) - interv };
  }
  const intervaloLegal = (liquido) => (liquido > 360 ? 60 : (liquido > 240 ? 15 : 0));

  // mesma leitura do Ponto ao Vivo: sem cobertura = pendente; sem vínculo confirmado = não dá para afirmar; nunca inventa
  function refeicaoDe(refeicoes, id) {
    if (ehObj(refeicoes) && Array.isArray(refeicoes.indisponiveis) && refeicoes.indisponiveis.includes(id)) return { estado: 'pendente', itens: [] };
    if (!ehObj(refeicoes) || refeicoes.disponivel !== true) return { estado: 'indisponivel', itens: [] };
    const bruto = ehObj(refeicoes.porPessoa) ? refeicoes.porPessoa[id] : undefined;
    const itens = (Array.isArray(bruto) ? bruto : []).filter(ehObj).map((i) => ({
      produto: texto(i.produto, 60), quantidade: Number.isInteger(i.quantidade) && i.quantidade > 0 && i.quantidade <= 99 ? i.quantidade : 1,
      hora: minHM(i.hora) !== null ? i.hora : null,
    }));
    if (itens.length) return { estado: 'lancada', itens };
    if (!Array.isArray(refeicoes.identificados) || !refeicoes.identificados.includes(id)) return { estado: 'sem_vinculo', itens: [] };
    return { estado: 'nao_lancou', itens: [] };
  }

  function apontamentosDe({ mins, medida, jornada, fechado }) {
    const ap = []; const n = mins.length;
    const add = (cat, txt) => ap.push({ categoria: cat, nivel: CATEGORIA[cat].nivel, ordem: CATEGORIA[cat].ordem, rotulo: CATEGORIA[cat].rotulo, texto: txt });
    if (fechado && n > 0 && n < 4) add('BATIDAS_INCOMPLETAS', n + (n === 1 ? ' batida' : ' batidas') + ' no dia (o completo são 4: entrada, saída e volta do intervalo, saída).');
    else if (fechado && n % 2 === 1) add('BATIDAS_INCOMPLETAS', n + ' batidas no dia (número ímpar: falta um registro; tempo trabalhado e intervalo não calculados).');
    if (n >= 4 && medida.intervalo !== null) {
      const legal = intervaloLegal(medida.liquido);
      if (legal > 0 && medida.intervalo < legal) add('INTERVALO_ABAIXO_LEGAL', 'Intervalo de ' + medida.intervalo + ' min, abaixo do mínimo legal de ' + legal + ' min para ' + fmtDur(medida.liquido) + ' trabalhadas (Art. 71 da CLT).');
      if (medida.liquido >= TETO_AVISO_MIN) add('TETO_10H', 'Trabalhou ' + fmtDur(medida.liquido) + ' líquidas, perto do teto de 10h (Art. 59 da CLT).');
    }
    const offE = jornada ? minHM(jornada.entrada) : null, offSraw = jornada ? minHM(jornada.saida) : null;
    if (n >= 1 && offE !== null && offSraw !== null) {
      const offS = offSraw + (offSraw <= offE ? 1440 : 0);
      const ev = mins[0] - offE;
      if (Math.abs(ev) > DIVERGENTE_MIN) add('ESCALA_DIVERGENTE', 'Entrada às ' + fmtHM(mins[0]) + ', ' + Math.abs(ev) + ' min ' + (ev > 0 ? 'depois' : 'antes') + ' do horário cadastrado (' + jornada.entrada + '). Conferir escala ou troca de turno antes de falar em atraso.');
      else if (ev > TOLERANCIA_MIN) add('ATRASO', 'Entrou às ' + fmtHM(mins[0]) + ', ' + ev + ' min depois do horário cadastrado (' + jornada.entrada + ').');
      if (n >= 4 && Math.abs(ev) <= DIVERGENTE_MIN) {
        const sv = mins[n - 1] - offS;
        if (sv > TOLERANCIA_MIN && sv <= DIVERGENTE_MIN) add('SAIU_APOS_HORARIO', 'Saiu às ' + fmtHM(mins[n - 1]) + ', ' + sv + ' min depois do horário cadastrado (' + jornada.saida + ').');
        else if (Math.abs(sv) > DIVERGENTE_MIN) add('ESCALA_DIVERGENTE', 'Saída às ' + fmtHM(mins[n - 1]) + ', ' + Math.abs(sv) + ' min ' + (sv > 0 ? 'depois' : 'antes') + ' do horário cadastrado (' + jornada.saida + '). Conferir escala.');
      }
    }
    ap.sort((a, b) => a.ordem - b.ordem);
    return ap;
  }

  // resposta = corpo do leitor (um dia, uma loja ou REDE). hojeOperacional = dia operacional de agora (antes das 07h ainda é ontem).
  function apontar(resposta, opcoes) {
    const o = ehObj(opcoes) ? opcoes : {};
    const r = ehObj(resposta) ? resposta : {};
    const dia = dataValida(r.dia) ? r.dia : null;
    if (!dia) return { ok: false, erro: 'Resposta do leitor sem dia válido.', dia: null, linhas: [], semBatida: [], foraDoPonto: 0, kpis: null, avisos: [] };
    const hojeOp = dataValida(o.hojeOperacional) ? o.hojeOperacional : null;
    const fechado = hojeOp !== null && dia < hojeOp;   // sem hoje confiável: trata como em andamento (não acusa)
    const porFlash = new Map(); let leiturasRepetidas = 0;
    for (const b of Array.isArray(r.batidas) ? r.batidas : []) {
      if (!ehObj(b) || typeof b.flash_id !== 'string' || !b.flash_id) continue;
      if (porFlash.has(b.flash_id)) { porFlash.set(b.flash_id, null); leiturasRepetidas++; } else porFlash.set(b.flash_id, b);
    }
    const jornadas = ehObj(r.jornadas) ? r.jornadas : {};
    const linhas = [], semBatida = []; let foraDoPonto = 0, semVinculoFlash = 0;
    const vistos = new Set();
    for (const p of Array.isArray(r.pessoas) ? r.pessoas : []) {
      if (!ehObj(p) || !Number.isSafeInteger(p.id) || vistos.has(p.id)) continue;
      vistos.add(p.id);
      const base = { id: p.id, nome: texto(p.nome, 80) || ('Cadastro ' + p.id), unidade: texto(p.unidade, 30) };
      if (p.usa_ponto === false || p.cargo_confianca === true) { foraDoPonto++; continue; }
      if (typeof p.flash_id !== 'string' || !p.flash_id) { semVinculoFlash++; continue; }
      if (!porFlash.has(p.flash_id)) { semBatida.push(base); continue; }
      const b = porFlash.get(p.flash_id);
      const mins = b ? minutosDoDia(b.horarios, dia) : null;
      const refeicao = refeicaoDe(r.refeicoes, p.id);
      if (!mins || !mins.length) {
        linhas.push(Object.assign(base, { n: 0, batidas: [], intervalo: null, liquido: null, nivel: 'CONFERIR', refeicao, refeicaoErro: false,
          apontamentos: [{ categoria: 'LEITURA_INVALIDA', nivel: 'CONFERIR', ordem: CATEGORIA.LEITURA_INVALIDA.ordem, rotulo: CATEGORIA.LEITURA_INVALIDA.rotulo, texto: 'Leitura do relógio repetida ou ilegível para esta pessoa; horários não atribuídos.' }] }));
        continue;
      }
      const medida = medir(mins);
      const j = ehObj(jornadas[p.id]) ? jornadas[p.id] : null;
      const apontamentos = apontamentosDe({ mins, medida, jornada: j, fechado });
      linhas.push(Object.assign(base, {
        n: mins.length, batidas: mins.map(fmtHM), viradaNoite: mins[mins.length - 1] >= 1440,
        intervalo: medida.intervalo, liquido: medida.liquido,
        jornada: j && minHM(j.entrada) !== null && minHM(j.saida) !== null ? { entrada: j.entrada, saida: j.saida } : null,
        apontamentos, nivel: apontamentos.length ? apontamentos[0].nivel : 'SEM',
        refeicao, refeicaoErro: fechado && refeicao.estado === 'nao_lancou',
      }));
    }
    const col = new Intl.Collator('pt-BR');
    linhas.sort((a, b) => (NIVEL[a.nivel].ordem - NIVEL[b.nivel].ordem) || (Number(b.refeicaoErro) - Number(a.refeicaoErro)) || col.compare(a.unidade, b.unidade) || col.compare(a.nome, b.nome));
    semBatida.sort((a, b) => col.compare(a.unidade, b.unidade) || col.compare(a.nome, b.nome));
    const conta = (f) => linhas.filter(f).length;
    const kpis = {
      SERIO: conta((l) => l.nivel === 'SERIO'), INFRACAO: conta((l) => l.nivel === 'INFRACAO'), VERBAL: conta((l) => l.nivel === 'VERBAL'),
      CONFERIR: conta((l) => l.nivel === 'CONFERIR'), SEM: conta((l) => l.nivel === 'SEM' && !l.refeicaoErro),
      REF_NAO: conta((l) => l.refeicaoErro), REF_OK: conta((l) => l.refeicao.estado === 'lancada'),
      REF_SEM_VINCULO: conta((l) => l.refeicao.estado === 'sem_vinculo'),
      REF_PENDENTE: conta((l) => l.refeicao.estado === 'pendente' || l.refeicao.estado === 'indisponivel'),
      SEM_BATIDA: semBatida.length, TOTAL: linhas.length,
    };
    const avisos = (Array.isArray(r.avisos) ? r.avisos : []).map((a) => texto(a, 240)).filter(Boolean).slice(0, 20);
    if (leiturasRepetidas) avisos.push(leiturasRepetidas + ' leitura(s) repetida(s) do relógio: horários dessas pessoas não foram atribuídos.');
    if (semVinculoFlash) avisos.push(semVinculoFlash + ' cadastro(s) sem vínculo com o relógio de ponto não entram nesta conferência.');
    const comJornada = linhas.filter((l) => l.jornada).length;
    return {
      ok: true, dia, fechado, emAndamento: !fechado, linhas, semBatida, foraDoPonto, kpis, avisos,
      atrasoAvaliado: comJornada > 0, comJornada,
      lidoEm: typeof r.lidoEm === 'string' ? r.lidoEm : null, fonte: texto(r.fonte, 60),
    };
  }

  function filtrar(linhas, filtro) {
    const l = Array.isArray(linhas) ? linhas : [];
    if (filtro === 'TODOS') return l;
    if (filtro === 'REF_NAO') return l.filter((x) => x.refeicaoErro);
    if (NIVEL[filtro] && filtro !== 'SEM') return l.filter((x) => x.nivel === filtro);
    if (filtro === 'SEM') return l.filter((x) => x.nivel === 'SEM' && !x.refeicaoErro);
    return l.filter((x) => x.nivel !== 'SEM' || x.refeicaoErro);   // padrão ("ERROS"): só quem tem algo para olhar
  }

  return { NIVEL, CATEGORIA, TOLERANCIA_MIN, DIVERGENTE_MIN, TETO_AVISO_MIN, dataValida, somarDias, diasPermitidos, minutosDoDia, medir, intervaloLegal, refeicaoDe, apontamentosDe, apontar, filtrar, fmtHM, fmtDur, texto };
});
