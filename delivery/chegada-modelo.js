// MOTOBOYS RODANDO NO DIA · regras de apresentação (12/11/2026, Fabio). UMD: roda no navegador (window.ChegadaModelo)
// e no Node (require). Sem rede, sem DOM, sem sessão: só transforma a resposta da função fabio-delivery-chegada
// (contrato do coordenador) no que a tela mostra. Quem decide o direito é o backend; aqui só se traduz, sem inventar perda.
(function (raiz, fabrica) {
  const api = fabrica();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else raiz.ChegadaModelo = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const ENDPOINT = 'https://kqvoatdprjwxyadhvtdd.supabase.co/functions/v1/fabio-delivery-chegada';
  const VIRADA_HORA = 5;               // o dia operacional do Delivery vira às 05h de Brasília
  const BRT_MS = -3 * 3600000;         // America/Sao_Paulo: UTC-3 fixo (sem horário de verão desde 2019)
  const ROTULO_FONTE = {
    fila: 'Fila do TrackEat',
    patio_gps: 'Pátio (GPS)',
    anotado: 'Anotado à mão pela loja',
  };
  const FONTES_TEMPO = ['fila', 'patio_gps'];   // tempo_fonte válido do intervalo registrado (contrato)

  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const pad = (n) => String(n).padStart(2, '0');
  const txt = (v) => (typeof v === 'string' && v.trim() ? v.trim() : null);
  const ehObj = (v) => !!v && typeof v === 'object' && !Array.isArray(v);

  function diaOperacional(agoraMs) {
    const t = Number(agoraMs == null ? Date.now() : agoraMs);
    return new Date(t + BRT_MS - VIRADA_HORA * 3600000).toISOString().slice(0, 10);
  }
  function diaValido(s) {
    if (typeof s !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
    const d = new Date(s + 'T12:00:00Z');
    return !isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
  }
  function diaBR(s) { return diaValido(s) ? s.slice(8, 10) + '/' + s.slice(5, 7) + '/' + s.slice(0, 4) : null; }
  function montarUrl(dia, unidade) {
    return ENDPOINT + '?dia=' + encodeURIComponent(dia) + '&unidade=' + encodeURIComponent(unidade);
  }
  // hora "HH:MM" ou "HH:MM:SS" vinda da fonte; qualquer outra coisa não vira horário
  function hora(v) { const s = txt(v); return s && /^([01]?\d|2[0-3]):[0-5]\d(:[0-5]\d)?$/.test(s) ? s : null; }
  function partesISO(iso) {
    const t = typeof iso === 'string' ? Date.parse(iso) : NaN;
    if (!isFinite(t)) return null;
    const d = new Date(t + BRT_MS);
    return { h: pad(d.getUTCHours()), m: pad(d.getUTCMinutes()), s: pad(d.getUTCSeconds()), dia: pad(d.getUTCDate()), mes: pad(d.getUTCMonth() + 1) };
  }
  function horaISO(iso, comSeg) { const p = partesISO(iso); return p ? p.h + ':' + p.m + (comSeg ? ':' + p.s : '') : null; }
  function dataHoraISO(iso) { const p = partesISO(iso); return p ? p.dia + '/' + p.mes + ' às ' + p.h + ':' + p.m : null; }

  // Chegada observada: Fila do TrackEat > pátio GPS > anotado à mão (identificado). Primeira entrega e último sinal
  // NUNCA contam como chegada. chegou_txt do servidor só vale se a fonte dele for uma dessas três.
  function chegadaObservada(l) {
    l = l || {};
    const f = hora(l.chegada_fila_txt); if (f) return { hora: f, fonte: 'fila', rotulo: ROTULO_FONTE.fila };
    const g = hora(l.patio_gps_txt); if (g) return { hora: g, fonte: 'patio_gps', rotulo: ROTULO_FONTE.patio_gps };
    const a = hora(l.anotado_txt); if (a) return { hora: a, fonte: 'anotado', rotulo: ROTULO_FONTE.anotado };
    const c = hora(l.chegou_txt);
    if (c && Object.prototype.hasOwnProperty.call(ROTULO_FONTE, l.chegou_fonte)) return { hora: c, fonte: l.chegou_fonte, rotulo: ROTULO_FONTE[l.chegou_fonte] };
    return null;
  }
  // Saída: só a saída registrada. Nunca o último sinal nem a última entrega.
  function saidaRegistrada(l) { return hora((l || {}).saida_registrada_txt); }
  // Intervalo registrado (bruto) informado pelo servidor: só vale com tempo_fonte 'fila' ou 'patio_gps' E saída registrada.
  // Pode conter pausas; não é hora líquida. Sem tempo_fonte válido (ex.: chegada anotada à mão) não há intervalo.
  function intervaloRegistrado(l) {
    l = l || {};
    const m = l.tempo_registrado_min;
    if (!Number.isInteger(m) || m < 0) return null;
    if (FONTES_TEMPO.indexOf(l.tempo_fonte) < 0) return null;
    if (!saidaRegistrada(l)) return null;
    return { min: m, texto: Math.floor(m / 60) + 'h ' + pad(m % 60) + 'min', fonte: l.tempo_fonte, rotulo: ROTULO_FONTE[l.tempo_fonte] };
  }
  // 13/11/2026 (Fabio, caderneta #6729): embaixo da saída registrada, duas linhas separadas — última entrega e última
  // vez no pátio. "Foi embora por volta de" é ESTIMATIVA e só aparece quando a última vez no pátio é DEPOIS da última
  // entrega e o aplicativo não deu mais sinal (último sinal até 10 min depois do pátio; ao vivo, sem sinal há 30 min).
  // Nunca é saída registrada e não muda garantido, refeição, pagamento nem lacres. Sem dado = null (a tela mostra pendência).
  const SINAL_PERTO_MIN = 10, SEM_SINAL_AO_VIVO_MIN = 30;
  // minutos do dia operacional (vira às 05h): 00:10 vem depois de 23:50
  function minOp(h) { if (!h) return null; const p = h.split(':'); const m = (+p[0]) * 60 + (+p[1]); return m < VIRADA_HORA * 60 ? m + 1440 : m; }
  function fimDoTurno(l, aoVivo) {
    l = l || {};
    const entrega = hora(l.ultima_entrega_txt), patio = hora(l.ultimo_patio_txt), sinal = hora(l.ultimo_sinal_txt);
    let foiEmbora = null;
    if (entrega && patio && sinal) {
      const e = minOp(entrega), p = minOp(patio), s = minOp(sinal);
      const calado = aoVivo === true ? (Number.isInteger(l.sinal_min) && l.sinal_min >= SEM_SINAL_AO_VIVO_MIN) : true;
      if (p > e && s >= p && s - p <= SINAL_PERTO_MIN && calado) foiEmbora = patio.slice(0, 5);
    }
    return { entrega: entrega ? entrega.slice(0, 5) : null, patio: patio ? patio.slice(0, 5) : null, foiEmbora };
  }
  // de onde veio a hora da fila: o site do TrackEat lido pelo nosso robô (principal, Fabio 12/11) ou a API (segunda fonte)
  const ROTULO_FILA_FONTE = { site: 'site do TrackEat (robô)', api: 'API do TrackEat' };
  function filaFonte(l) { const f = (l || {}).chegada_fila_fonte; return Object.prototype.hasOwnProperty.call(ROTULO_FILA_FONTE, f) ? ROTULO_FILA_FONTE[f] : null; }
  function marcaEscala(l) {
    const v = (l || {}).na_escala;
    if (v === true) return null;
    return v === false ? 'Fora da escala' : 'Escala não confirmada';
  }

  const SIM = (m) => ({ estado: 'sim', texto: 'Sim', motivo: m, manual: false });
  const NAO = (m) => ({ estado: 'nao', texto: 'Não', motivo: m, manual: false });
  const AGUARDA = (m) => ({ estado: 'aguardando', texto: 'Aguardando', motivo: m, manual: false });
  const CONFERIR = (m) => ({ estado: 'conferir', texto: 'A conferir', motivo: m, manual: false });
  const PERDIDO_OUTRO = 'Garantido já perdido em outro turno do dia';

  // atraso_min é contado desde a ENTRADA COMBINADA (escala_txt), não desde o limite de tolerância.
  function atrasoTxt(l) {
    const a = l.atraso_min;
    const ent = hora(l.escala_txt);
    if (Number.isFinite(a) && a > 0) return 'Chegou ' + a + ' min depois da entrada combinada' + (ent ? ' (' + ent + ')' : '');
    const lim = hora(l.limite_txt);
    return 'Chegou depois do limite de tolerância' + (lim ? ' (' + lim + ')' : '');
  }

  function calculado(l) {
    if (l.na_escala !== true) {
      const m = l.na_escala === false ? 'Fora da escala, sem definição manual: conferir com a loja' : 'Escala não confirmada pela fonte: conferir';
      return { garantido: CONFERIR(m), refeicao: CONFERIR(m) };
    }
    switch (l.direito) {
      case 'no_prazo': { const m = 'Ainda dentro do prazo de chegada'; return { garantido: AGUARDA(m), refeicao: AGUARDA(m) }; }
      case 'aguarda_balcao': { const m = 'Aguardando conferência no balcão'; return { garantido: AGUARDA(m), refeicao: AGUARDA(m) }; }
      case 'ok':
        return { garantido: l.garantido_perdido === true ? NAO(PERDIDO_OUTRO) : SIM('Chegou dentro do limite'),
                 refeicao: SIM('Chegou dentro do limite') };
      case 'sem_prova': {
        const m = 'Sem prova de atraso: sem corte automático, conferir';
        return { garantido: l.garantido_perdido === true ? NAO(PERDIDO_OUTRO) : SIM(m), refeicao: SIM(m) };
      }
      case 'rango_excecao':
        return { garantido: NAO(atrasoTxt(l)), refeicao: SIM('Refeição mantida por exceção') };
      case 'perdeu': case 'perdeu_ambos': { const m = atrasoTxt(l); return { garantido: NAO(m), refeicao: NAO(m) }; }
      case 'nao_chegou': { const m = 'Sem chegada registrada: conferir (não é falta confirmada)'; return { garantido: CONFERIR(m), refeicao: CONFERIR(m) }; }
      default: { const m = 'Situação não informada pela fonte: conferir'; return { garantido: CONFERIR(m), refeicao: CONFERIR(m) }; }
    }
  }
  function manual(v, motivo) {
    return { estado: v ? 'sim' : 'nao', texto: v ? 'Sim' : 'Não', manual: true,
             motivo: 'Definido manualmente: ' + (txt(motivo) || 'sem motivo escrito') };
  }
  // Manual (boolean) prevalece só no campo dele; o outro campo segue a regra automática.
  function direitos(l) {
    l = l || {};
    const c = calculado(l);
    return {
      garantido: typeof l.garantido_manual === 'boolean' ? manual(l.garantido_manual, l.garantido_motivo) : c.garantido,
      refeicao: typeof l.rango_manual === 'boolean' ? manual(l.rango_manual, l.rango_motivo) : c.refeicao,
    };
  }

  // campos_invalidos é um NÚMERO (contagem). Qualquer outra coisa = não informado.
  function camposInvalidos(u) { const n = (u || {}).campos_invalidos; return Number.isInteger(n) && n > 0 ? n : 0; }
  // robo.ok === false: a leitura do robô está desatualizada. NÃO é falha comprovada da fonte.
  function situacaoRobo(u) {
    const r = ehObj((u || {}).robo) ? u.robo : null;
    return { atualizado: r ? dataHoraISO(r.atualizado_em) : null, desatualizado: !!r && r.ok === false };
  }
  // histórico só quando o servidor diz ao_vivo === false
  function ehHistorico(u) { return !!u && u.ao_vivo === false; }

  const normUnidade = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase().trim();
  const lojasReais = (lojas) => (Array.isArray(lojas) ? lojas : []).map(normUnidade).filter((x) => x && x !== 'REDE');
  // Só as lojas autorizadas e escolhidas. REDE: só as lojas autorizadas que vierem na resposta; sem loja autorizada,
  // NADA (falha fechada: nunca "todas" por padrão).
  function unidadesVisiveis(resp, loja, lojas) {
    const lista = (resp && Array.isArray(resp.por_unidade) ? resp.por_unidade : []).filter(ehObj);
    if (!loja) return [];
    const ok = lojasReais(lojas);
    if (normUnidade(loja) === 'REDE') {
      if (!ok.length) return [];
      return lista.filter((u) => ok.indexOf(normUnidade(u.unidade)) >= 0);
    }
    if (ok.indexOf(normUnidade(loja)) < 0) return [];
    return lista.filter((u) => normUnidade(u.unidade) === normUnidade(loja));
  }
  // Estrutura mínima do contrato e dia EXATO pedido. Qualquer desvio = resposta não usada.
  function validarResposta(j, dia) {
    if (!ehObj(j)) return { ok: false, motivo: 'resposta sem formato' };
    if (j.dia !== dia) return { ok: false, motivo: 'resposta de outro dia' };
    if (j.dia_operacional != null && !diaValido(j.dia_operacional)) return { ok: false, motivo: 'dia operacional inválido' };
    if (!Array.isArray(j.por_unidade)) return { ok: false, motivo: 'resposta sem lojas' };
    for (const u of j.por_unidade) {
      if (!ehObj(u) || !txt(u.unidade)) return { ok: false, motivo: 'loja sem identificação' };
      if (u.status !== 'ok' && u.status !== 'indisponivel') return { ok: false, motivo: 'situação da loja inválida' };
      if (u.status === 'ok') {
        if (!Array.isArray(u.linhas)) return { ok: false, motivo: 'loja sem lista' };
        if (typeof u.ao_vivo !== 'boolean') return { ok: false, motivo: 'ao_vivo inválido' };
      }
      if (u.hoje != null && !diaValido(u.hoje)) return { ok: false, motivo: 'hoje inválido' };
      if (u.campos_invalidos != null && !(Number.isInteger(u.campos_invalidos) && u.campos_invalidos >= 0)) return { ok: false, motivo: 'campos_invalidos inválido' };
      if (u.robo != null && !ehObj(u.robo)) return { ok: false, motivo: 'robo inválido' };
      if (ehObj(u.robo) && u.robo.ok != null && typeof u.robo.ok !== 'boolean') return { ok: false, motivo: 'robo.ok inválido' };
    }
    return { ok: true };
  }

  return { ENDPOINT, VIRADA_HORA, ROTULO_FONTE, FONTES_TEMPO, esc, txt, diaOperacional, diaValido, diaBR, montarUrl, hora, horaISO, dataHoraISO,
           chegadaObservada, saidaRegistrada, intervaloRegistrado, fimDoTurno, filaFonte, marcaEscala, direitos, camposInvalidos, situacaoRobo, ehHistorico,
           unidadesVisiveis, validarResposta, normUnidade, lojasReais };
});
