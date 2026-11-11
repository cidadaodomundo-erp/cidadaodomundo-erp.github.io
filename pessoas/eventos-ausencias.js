// EVENTOS E AUSÊNCIAS (rota peventos, módulo Pessoas). Só CONSULTA. Registro recebido; NÃO é decisão de folha.
// Lê, e só isto: rh_pessoa (id, nome, apelido, unidade, flash_id, admissao, desligamento),
//   rh_flash_ausencia (mes_lido, flash_id, tipo, inicio, fim, periodo) e rh_ocorrencia (pessoa_id, data, tipo, fonte, lido_em).
// Nunca lê nem mostra justificativa, motivo, arquivo, zera_mes, CPF, PIS, salário, valores, observações, anexos ou decisão.
// Não infere falta, abono, desconto, bônus ou efeito financeiro. Não escreve nada. Não guarda dado de pessoa no navegador.
// Vínculo: ausência por flash_id; ocorrência por pessoa_id. Sem vínculo (ou ambíguo) não recebe nome: só entra na contagem.
// As duas fontes NUNCA são mescladas nem deduplicadas: cada linha traz a origem (Flash ou Registro do RH).
(function (root, factory) {
  'use strict';
  const mod = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = mod;
  if (root) { root.EventosAusencias = mod; root.entrarPesEventos = mod.entrarPesEventos; }
})(typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : null), function () {
  'use strict';

  const MAX_DIAS = 366;
  const POR_PAGINA = 50;
  const LIMITE_AUSENCIA = 1000;   // a consulta de ausência pede 1000 linhas; se vierem 1000, pode haver mais: recusa tudo (até 999 é aceito)
  const SEM_TIPO = '__sem_tipo__';
  const ORIGEM = Object.freeze({ flash: 'Flash', rh: 'Registro do RH' });
  const ORIGEM_ORD = Object.freeze({ flash: 0, rh: 1 });

  // ---------- caminhos (colunas mínimas, ordem total para a paginação do consultarTudo não perder nem repetir linha) ----------
  const PESSOAS_PATH = 'rh_pessoa?select=id,nome,apelido,unidade,flash_id,admissao,desligamento&order=id.asc';
  const ULTIMA_AUSENCIA_PATH = 'rh_flash_ausencia?select=mes_lido&order=mes_lido.desc.nullslast&limit=1';
  const ULTIMA_OCORRENCIA_PATH = 'rh_ocorrencia?select=lido_em&order=lido_em.desc.nullslast&limit=1';
  // o limite superior usa "menor que o dia seguinte": vale para coluna date e para timestamp
  const ausenciaPath = (de, ate) => 'rh_flash_ausencia?select=mes_lido,flash_id,tipo,inicio,fim,periodo'
    + '&inicio=lt.' + diaSeguinte(ate)
    + '&or=(fim.gte.' + de + ',and(fim.is.null,inicio.gte.' + de + '))'
    + '&order=inicio.desc,flash_id.asc,tipo.asc,fim.asc,mes_lido.desc,periodo.asc'
    + '&limit=' + LIMITE_AUSENCIA;   // UMA página só: rh_flash_ausencia não tem chave única, offset poderia perder/repetir duplicatas exatas
  // id é só técnico (ordem total única para o consultarTudo paginar sem perder/repetir): nunca é copiado para linha nem mostrado
  const ocorrenciaPath = (de, ate) => 'rh_ocorrencia?select=id,pessoa_id,data,tipo,fonte,lido_em'
    + '&data=gte.' + de + '&data=lt.' + diaSeguinte(ate)
    + '&order=data.desc,pessoa_id.asc,tipo.asc,fonte.asc,lido_em.asc,id.asc';

  // ---------- datas (calendário próprio: sem Date/fuso; anos 0001..9999) ----------
  function diasNoMes(y, m) { return m === 2 ? ((y % 4 === 0 && y % 100 !== 0) || y % 400 === 0 ? 29 : 28) : [4, 6, 9, 11].includes(m) ? 30 : 31; }
  function dataReal(s) {
    if (typeof s !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
    const y = Number(s.slice(0, 4)), m = Number(s.slice(5, 7)), d = Number(s.slice(8, 10));
    return y >= 1 && m >= 1 && m <= 12 && d >= 1 && d <= diasNoMes(y, m);
  }
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
  function diaSeguinte(s) { return dataReal(s) ? dataDeDias(diasDesde1970(s) + 1) : s; }
  function somarDias(s, n) { return dataDeDias(diasDesde1970(s) + n); }
  function validarIntervalo(de, ate) {
    if (!dataReal(de) || !dataReal(ate)) return { ok: false, motivo: 'Datas inválidas: use dia/mês/ano reais.' };
    if (de > ate) return { ok: false, motivo: 'Período invertido: a data inicial é depois da final.' };
    const dias = diasDesde1970(ate) - diasDesde1970(de) + 1;
    if (!Number.isInteger(dias) || dias < 1) return { ok: false, motivo: 'Datas inválidas: use dia/mês/ano reais.' };
    if (dias > MAX_DIAS) return { ok: false, motivo: 'Período longo demais: máximo de ' + MAX_DIAS + ' dias.' };
    return { ok: true, dias };
  }
  // aceita "AAAA-MM-DD" puro ou seguido de T/espaço (timestamp); devolve só o dia, sem conversão de fuso
  function diaDe(v) {
    if (typeof v !== 'string') return null;
    const m = /^(\d{4}-\d{2}-\d{2})(?:$|[T ])/.exec(v);
    return m && dataReal(m[1]) ? m[1] : null;
  }
  const fmtDia = (s) => s.slice(8, 10) + '/' + s.slice(5, 7) + '/' + s.slice(0, 4);
  function fmtMes(v) {
    if (typeof v === 'string') { const m = /^(\d{4})-(\d{2})/.exec(v); if (m && Number(m[2]) >= 1 && Number(m[2]) <= 12) return m[2] + '/' + m[1]; }
    const t = textoSeguro(v, 20); return t || null;
  }
  function fmtLidoEm(iso) {
    if (typeof iso !== 'string' || !iso) return null;
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return null;
    try { return d.toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' }); } catch (e) { return null; }
  }

  // ---------- texto e identidade ----------
  const CTRL = /[\u0000-\u001f\u007f-\u009f‎‏‪-‮⁦-⁩]/g;
  function textoSeguro(v, max) {
    if (typeof v !== 'string' && typeof v !== 'number') return '';
    return String(v).replace(CTRL, ' ').replace(/\s+/g, ' ').trim().slice(0, max || 80);
  }
  const normKey = (s) => String(s == null ? '' : s).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();
  const ehObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
  function idKey(v) {
    if (typeof v === 'number') return Number.isSafeInteger(v) && v > 0 ? String(v) : null;
    if (typeof v === 'string' && /^[1-9]\d{0,15}$/.test(v)) return v;
    return null;
  }
  function flashKey(v) {
    if (typeof v === 'number') return Number.isSafeInteger(v) ? String(v) : null;
    if (typeof v === 'string') { const t = v.trim(); return t ? t : null; }
    return null;
  }
  function nomeSeguro(n, id) {
    const s = textoSeguro(n, 80);
    if (s) return s;
    return typeof id === 'number' && Number.isSafeInteger(id) ? 'Cadastro #' + id : 'Cadastro sem nome';
  }
  const SAO_BRAZ = ['SAO BRAZ', 'SÃO BRAZ'];
  function unidadeCombina(unidade, loja) {
    if (unidade === loja) return true;
    return SAO_BRAZ.includes(unidade) && SAO_BRAZ.includes(loja);
  }
  // REDE ("Todas") só vale se a lista da casca a trouxer; loja específica exige unidade válida igual
  function lojaCombina(unidade, loja, redeOk) {
    if (typeof loja !== 'string' || !loja) return false;
    if (loja === 'REDE') return redeOk === true;
    if (typeof unidade !== 'string' || !unidade.trim()) return false;
    return unidadeCombina(unidade, loja);
  }
  function periodoValido(p) {
    if (!dataReal(p.admissao)) return false;
    const d = p.desligamento;
    if (d === undefined || d === null) return true;
    return dataReal(d) && d >= p.admissao;
  }
  // outro cadastro com o MESMO flash_id pode ser o dono do dia? (período inválido = não dá para excluir)
  function podeCobrir(q, dia) {
    if (!periodoValido(q)) return true;
    return dia >= q.admissao && (q.desligamento == null || dia <= q.desligamento);
  }

  // ---------- montagem das linhas (pura) ----------
  function montarLinhas(o) {
    const { pessoas, ausencias, ocorrencias, de, ate, hoje } = o;
    const notas = {
      semVinculo: { flash: 0, rh: 0 }, ambiguo: { flash: 0, rh: 0 }, invalido: { flash: 0, rh: 0 }, foraPeriodo: { flash: 0, rh: 0 },
      cadastrosInvalidos: 0, comOutraFonte: 0,
    };
    const cad = [];
    for (const p of pessoas) { if (ehObj(p)) cad.push(p); else notas.cadastrosInvalidos++; }
    const seq = new Map(); cad.forEach((p, i) => seq.set(p, i));
    const porFlash = new Map(), porId = new Map();
    for (const p of cad) {
      const fk = flashKey(p.flash_id); if (fk) { if (!porFlash.has(fk)) porFlash.set(fk, []); porFlash.get(fk).push(p); }
      const ik = idKey(p.id); if (ik) { if (!porId.has(ik)) porId.set(ik, []); porId.get(ik).push(p); }
    }
    const linhas = [];
    let idx = 0;
    const base = (p, origemKey, extra) => {
      const unid = textoSeguro(p.unidade, 40);
      return Object.assign({
        idx: idx++, origemKey, origem: ORIGEM[origemKey], pessoaSeq: seq.get(p),
        nome: nomeSeguro(p.nome, p.id), apelido: textoSeguro(p.apelido, 40),
        unidade: unid || '—', unidadeValida: !!unid && typeof p.unidade === 'string', tambem: false,
      }, extra);
    };
    const vincularFlash = (fk, dia) => {
      if (!fk) return { st: 'sem' };
      const c = porFlash.get(fk) || [];
      if (!c.length) return { st: 'sem' };
      const cand = c.length > 1 ? c.filter((q) => podeCobrir(q, dia)) : c;
      if (cand.length !== 1) return { st: 'amb' };
      const ik = idKey(cand[0].id);
      if (ik && porId.get(ik).length > 1) return { st: 'amb' };
      return { st: 'ok', p: cand[0] };
    };

    for (const a of ausencias) {
      if (!ehObj(a)) { notas.invalido.flash++; continue; }
      const ini = diaDe(a.inicio), fimRaw = a.fim == null ? null : diaDe(a.fim);
      if (!ini || (a.fim != null && !fimRaw) || (fimRaw && fimRaw < ini)) { notas.invalido.flash++; continue; }
      if (ini > ate || (fimRaw || ini) < de) { notas.foraPeriodo.flash++; continue; }
      const v = vincularFlash(flashKey(a.flash_id), ini);
      if (v.st === 'sem') { notas.semVinculo.flash++; continue; }
      if (v.st === 'amb') { notas.ambiguo.flash++; continue; }
      const tipo = textoSeguro(a.tipo, 60), per = textoSeguro(a.periodo, 60), mes = fmtMes(a.mes_lido);
      linhas.push(base(v.p, 'flash', {
        pessoaId: idKey(v.p.id), tipo, tipoKey: normKey(tipo), inicio: ini, fim: fimRaw, fimEf: fimRaw || ini,
        detalhe: per || '—', recebido: mes ? 'mês lido ' + mes : '—', programado: ini > hoje,
      }));
    }
    for (const r of ocorrencias) {
      if (!ehObj(r)) { notas.invalido.rh++; continue; }
      const dia = diaDe(r.data);
      if (!dia) { notas.invalido.rh++; continue; }
      if (dia < de || dia > ate) { notas.foraPeriodo.rh++; continue; }
      const pk = idKey(r.pessoa_id);
      const c = pk ? (porId.get(pk) || []) : [];
      if (!c.length) { notas.semVinculo.rh++; continue; }
      if (c.length > 1) { notas.ambiguo.rh++; continue; }
      const p = c[0];
      const tipo = textoSeguro(r.tipo, 60), fonte = textoSeguro(r.fonte, 40), lido = fmtLidoEm(r.lido_em);
      linhas.push(base(p, 'rh', {
        pessoaId: idKey(p.id), tipo, tipoKey: normKey(tipo), inicio: dia, fim: null, fimEf: dia,
        detalhe: fonte ? 'fonte: ' + fonte : '—', recebido: lido || '—', programado: dia > hoje,
      }));
    }
    // mesmo cadastro + mesmo tipo + dia da ocorrência dentro do período da ausência: só SINALIZA; nada é mesclado nem removido
    const aus = new Map();
    for (const l of linhas) if (l.origemKey === 'flash') { const k = l.pessoaSeq + '\u0000' + l.tipoKey; if (!aus.has(k)) aus.set(k, []); aus.get(k).push(l); }
    for (const l of linhas) {
      if (l.origemKey !== 'rh') continue;
      for (const a of aus.get(l.pessoaSeq + '\u0000' + l.tipoKey) || []) {
        if (l.inicio >= a.inicio && l.inicio <= a.fimEf) { if (!l.tambem) notas.comOutraFonte++; l.tambem = true; a.tambem = true; }
      }
    }
    return { linhas, notas };
  }

  // ---------- filtro e ordenação (puros) ----------
  function filtrarLinhas(linhas, f) {
    const palavras = normKey(f.busca).split(' ').filter(Boolean);
    const naUnidade = linhas.filter((r) => lojaCombina(r.unidadeValida ? r.unidade : null, f.loja, f.redeOk) || (f.loja === 'REDE' && f.redeOk === true));
    const semUnidade = f.loja === 'REDE' ? 0 : linhas.filter((r) => !r.unidadeValida).length;
    const tipoOk = (r) => !f.tipo || (f.tipo === SEM_TIPO ? r.tipo === '' : r.tipo === f.tipo);
    const buscaOk = (r) => { if (!palavras.length) return true; const alvo = normKey(r.nome + ' ' + r.apelido); return palavras.every((w) => alvo.includes(w)); };
    return { naUnidade, semUnidade, filtradas: naUnidade.filter((r) => tipoOk(r) && buscaOk(r)) };
  }
  const cmpTxt = (a, b) => String(a).localeCompare(String(b), 'pt-BR', { sensitivity: 'base' });
  function ordenar(linhas) {
    return linhas.slice().sort((a, b) =>
      (a.inicio < b.inicio ? 1 : a.inicio > b.inicio ? -1 : 0)
      || cmpTxt(a.nome, b.nome) || (ORIGEM_ORD[a.origemKey] - ORIGEM_ORD[b.origemKey]) || cmpTxt(a.tipo, b.tipo) || (a.idx - b.idx));
  }
  function paginar(lista, pagina) {
    const total = lista.length, paginas = Math.max(1, Math.ceil(total / POR_PAGINA));
    const p = Math.min(Math.max(1, Number.isInteger(pagina) ? pagina : 1), paginas);
    const ini = (p - 1) * POR_PAGINA;
    return { pagina: p, paginas, total, itens: lista.slice(ini, ini + POR_PAGINA), de: total ? ini + 1 : 0, ate: Math.min(total, ini + POR_PAGINA) };
  }
  function situacao(r) { return [r.programado ? 'Programado' : '', r.tambem ? 'Consta também na outra fonte' : ''].filter(Boolean).join(' · ') || '—'; }

  // ---------- controlador ----------
  function classificaErro(e) {
    const m = e && e.message, s = e && e.status;
    if (m === '401' || m === 'sessão vencida' || s === 401) return 'sessao';
    if (s === 403 || m === '403') return 'negado';
    return 'erro';
  }
  const MSG = Object.freeze({
    carregando: 'Carregando…',
    erro: 'Não foi possível consultar agora (falha ou erro do servidor). Nada foi exibido; tente atualizar.',
    negado: 'Acesso negado pelo servidor (403). Nenhum dado foi exibido.',
    sessao: 'Sessão vencida ou ausente. Entre de novo.',
    semacesso: 'Sem acesso confirmado a esta consulta (exige ver e cadastrar pessoal). Nenhum dado foi lido.',
    semloja: 'Loja não identificada para este login. Nenhum dado foi lido.',
    semcadastro: 'Cadastro de pessoas indisponível ou vazio nesta consulta. Não dá para atribuir nomes; nada foi exibido.',
    dadosinvalidos: 'A resposta recebida não tem o formato esperado. Nada foi exibido.',
    vazio: 'Nenhum registro recebido neste período nas duas fontes. Isso não prova que não houve eventos: só que nada foi recebido.',
    limiteausencia: 'A consulta de ausências do Flash voltou com 1000 linhas ou mais neste período; não dá para garantir que vieram todas (essa leitura não é paginada). Nada foi exibido, nem contagens. Reduza o período e clique Atualizar.',
    semvinculo: 'Há registros recebidos, mas nenhum com vínculo seguro a um cadastro; nenhum nome foi atribuído. Veja as contagens abaixo.',
  });

  function criar(deps) {
    const st = { gen: 0, fase: 'inicial', msg: '', dados: null, ultimas: null, loja: null, lojas: [], travado: false, de: null, ate: null, tipo: '', busca: '', pagina: 1, sessao: null, ativo: false, ligado: false };
    let ui = null;
    const doc = deps.doc;

    function limpar() { st.dados = null; st.ultimas = null; st.tipo = ''; st.busca = ''; st.pagina = 1; }
    function el(tag, cls, txt) { const e = doc.createElement(tag); if (cls) e.className = cls; if (txt != null) e.textContent = txt; return e; }
    function campo(rot, ctl) { const l = el('label', 'peve-campo'); l.appendChild(el('span', null, rot)); l.appendChild(ctl); return l; }
    function opcoes(sel, lista, atual) {
      sel.replaceChildren();
      lista.forEach(([v, t]) => { const o = el('option', null, t); o.value = v; sel.appendChild(o); });
      sel.value = lista.some(([v]) => v === atual) ? atual : (lista[0] ? lista[0][0] : '');
    }

    function montar() {
      const raiz = doc.getElementById('view-peventos');
      if (!raiz) throw new Error('view-peventos ausente');
      raiz.replaceChildren();
      const w = el('div', 'peve');
      w.appendChild(el('h2', 'peve-titulo', 'Eventos e ausências'));
      w.appendChild(el('div', 'peve-aviso', 'Somente consulta. Registro recebido, não decisão de folha: nada aqui indica falta, abono, desconto, bônus ou efeito financeiro. Cada linha mostra a fonte (Flash ou Registro do RH); as fontes não são mescladas. Disponível para quem pode ver e cadastrar pessoal. A unidade acompanha a loja escolhida na casca.'));
      const ctl = el('div', 'peve-ctl');
      const de = el('input'); de.type = 'date';
      const ate = el('input'); ate.type = 'date';
      const loja = el('select'), tipo = el('select');
      const busca = el('input'); busca.type = 'search'; busca.setAttribute('placeholder', 'Nome ou apelido'); busca.setAttribute('autocomplete', 'off');
      const bAtu = el('button', 'peve-btn', 'Atualizar'); bAtu.type = 'button';
      ctl.appendChild(campo('De', de)); ctl.appendChild(campo('Até', ate)); ctl.appendChild(campo('Unidade', loja));
      ctl.appendChild(campo('Tipo', tipo)); ctl.appendChild(campo('Buscar por nome', busca)); ctl.appendChild(bAtu);
      const status = el('div', 'peve-status'); status.setAttribute('role', 'status');
      const meta = el('div', 'peve-meta');
      const rotulo = el('div', 'peve-rotulo');
      const rol = el('div', 'peve-rolagem');
      const pag = el('div', 'peve-pag');
      [ctl, status, meta, rotulo, rol, pag].forEach((x) => w.appendChild(x));
      raiz.appendChild(w);
      ui = { de, ate, loja, tipo, busca, bAtu, status, meta, rotulo, rol, pag };
      de.value = st.de; ate.value = st.ate;
      // editar o período invalida a carga em curso e apaga o quadro; só o botão Atualizar busca de novo
      const alterou = () => {
        if (de.value === st.de && ate.value === st.ate) return;
        st.de = de.value; st.ate = ate.value; st.gen++; st.dados = null; st.ultimas = null; st.pagina = 1;
        st.fase = 'periodoalterado'; st.msg = 'Período alterado. Clique Atualizar.'; desenhar();
      };
      de.addEventListener('input', alterou); de.addEventListener('change', alterou);
      ate.addEventListener('input', alterou); ate.addEventListener('change', alterou);
      tipo.addEventListener('change', () => { st.tipo = tipo.value; st.pagina = 1; desenhar(); });
      busca.addEventListener('input', () => { st.busca = busca.value; st.pagina = 1; desenhar(); });
      loja.addEventListener('change', () => { deps.escolherLoja(loja.value); desenhar(); });   // volta ao valor real; a mudança chega pelo ouvinte
      bAtu.addEventListener('click', () => { st.de = de.value; st.ate = ate.value; carregar(); });
    }

    function desenhar() {
      if (!ui) return;
      const f = st.fase;
      const erro = ['erro', 'negado', 'sessao', 'periodoinvalido', 'dadosinvalidos', 'limiteausencia'].includes(f);
      const alerta = ['periodoalterado', 'vazio', 'semcadastro', 'semacesso', 'semloja', 'semvinculo'].includes(f);
      ui.status.className = 'peve-status' + (erro ? ' peve-erro' : alerta ? ' peve-alerta' : '');
      const d = st.dados && st.dados.de === st.de && st.dados.ate === st.ate ? st.dados : null;   // nunca linhas de outro período
      const lojaSel = st.loja;
      const redeOk = st.lojas.includes('REDE');
      const fl = d ? filtrarLinhas(d.linhas, { loja: lojaSel, redeOk, tipo: st.tipo, busca: st.busca }) : null;
      let txt = st.msg || MSG[f] || '';
      if (f === 'ok') {
        txt = fl && !fl.filtradas.length
          ? 'Nenhum item com os filtros atuais (' + fl.naUnidade.length + ' item(ns) na unidade, antes de tipo e busca). Registro recebido, não decisão de folha.'
          : 'Consulta concluída. Registros recebidos, não decisão de folha: nenhum cálculo de falta, abono, desconto ou bônus.';
      }
      ui.status.textContent = txt;
      ui.loja.disabled = st.travado || st.lojas.length < 2;
      opcoes(ui.loja, st.lojas.map((l) => [l, l === 'REDE' ? 'Todas (REDE)' : (deps.lojaNome ? deps.lojaNome(l) : l)]), st.loja);
      const tiposSet = new Set(); let temSem = false;
      if (fl) fl.naUnidade.forEach((r) => { if (r.tipo) tiposSet.add(r.tipo); else temSem = true; });
      const tipos = [...tiposSet].sort(cmpTxt).map((t) => [t, t]);
      opcoes(ui.tipo, [['', 'Todos os tipos']].concat(tipos, temSem ? [[SEM_TIPO, '(sem tipo informado)']] : []), st.tipo);
      if (d && st.tipo && ui.tipo.value !== st.tipo) st.tipo = '';
      if (ui.busca.value !== st.busca) ui.busca.value = st.busca;

      const m = [];
      if (d) {
        m.push('Consulta feita neste navegador em ' + (fmtLidoEm(d.consultadoEm) || 'hora desconhecida') + '. A hora de leitura de cada fonte está na coluna "Recebido".');
        if (fl && d.linhas.length) {   // sem nenhuma linha vinculada não se mostra contagem: "0" pareceria resultado
          const nf = fl.filtradas.filter((r) => r.origemKey === 'flash').length, nr = fl.filtradas.filter((r) => r.origemKey === 'rh').length;
          m.push('Mostrando ' + fl.filtradas.length + ' linha(s): Flash ' + nf + ' · Registro do RH ' + nr + '. Cada fonte é exibida por inteiro, sem mesclar nem remover duplicidade.');
          if (fl.semUnidade) m.push(fl.semUnidade + ' linha(s) de cadastro sem unidade válida não aparecem em unidade específica; escolha Todas (REDE) para vê-las.');
        }
        const n = d.notas;
        const sv = n.semVinculo.flash + n.semVinculo.rh, am = n.ambiguo.flash + n.ambiguo.rh;
        if (sv) m.push(sv + ' item(ns) sem vínculo com cadastro (Flash ' + n.semVinculo.flash + ' · Registro do RH ' + n.semVinculo.rh + '): não atribuídos a ninguém e sem identificador exibido; não entram nos filtros de unidade.');
        if (am) m.push(am + ' item(ns) com vínculo ambíguo (Flash ' + n.ambiguo.flash + ' · Registro do RH ' + n.ambiguo.rh + '): não atribuídos; conferir o cadastro.');
        const inv = n.invalido.flash + n.invalido.rh;
        if (inv) m.push(inv + ' item(ns) com data ou formato inválido (Flash ' + n.invalido.flash + ' · Registro do RH ' + n.invalido.rh + '), não exibidos.');
        const fp = n.foraPeriodo.flash + n.foraPeriodo.rh;
        if (fp) m.push(fp + ' item(ns) recebido(s) fora do período pedido, não exibidos.');
        if (n.cadastrosInvalidos) m.push(n.cadastrosInvalidos + ' cadastro(s) em formato inválido ignorado(s).');
        if (n.comOutraFonte) m.push(n.comOutraFonte + ' registro(s) do RH no mesmo dia e tipo de uma ausência do Flash: as duas linhas foram mantidas, marcadas "Consta também na outra fonte".');
      }
      if (st.ultimas) {
        const u = st.ultimas;
        const fr = (x, nome, med) => x.estado === 'ok' ? nome + ': última data recebida (' + med + ') ' + x.valor + '.' : x.estado === 'vazio' ? nome + ': nenhum registro recebido até agora.' : nome + ': última data recebida indisponível agora.';
        m.push(fr(u.aus, 'Flash (ausências)', 'mês lido'));
        m.push(fr(u.oco, 'Registro do RH (ocorrências)', 'lido em'));
      }
      ui.meta.replaceChildren();
      m.forEach((t) => ui.meta.appendChild(el('div', null, t)));
      ui.rotulo.replaceChildren(); ui.rol.replaceChildren(); ui.pag.replaceChildren();
      if (!d || !fl || !fl.filtradas.length) return;
      ui.rotulo.textContent = 'Registro recebido, não decisão de folha.';
      const lista = ordenar(fl.filtradas);
      const pg = paginar(lista, st.pagina); st.pagina = pg.pagina;
      const tab = el('table', 'peve-tab');
      const cab = el('tr');
      ['Pessoa', 'Unidade', 'Origem', 'Tipo', 'Início', 'Fim', 'Detalhe', 'Recebido', 'Situação'].forEach((t) => cab.appendChild(el('th', null, t)));
      const th = el('thead'); th.appendChild(cab); tab.appendChild(th);
      const tb = el('tbody');
      pg.itens.forEach((r) => {
        const tr = el('tr', 'peve-o-' + r.origemKey);
        const cel = (rot, t, cls) => { const c = el('td', cls, t); c.setAttribute('data-rot', rot); tr.appendChild(c); };
        cel('Pessoa', r.apelido && r.apelido !== r.nome ? r.nome + ' (' + r.apelido + ')' : r.nome);
        cel('Unidade', r.unidade); cel('Origem', r.origem, 'peve-origem');
        cel('Tipo', r.tipo || '—'); cel('Início', fmtDia(r.inicio)); cel('Fim', r.fim ? fmtDia(r.fim) : '—');
        cel('Detalhe', r.detalhe); cel('Recebido', r.recebido);
        cel('Situação', situacao(r), r.programado ? 'peve-prog' : '');
        tb.appendChild(tr);
      });
      tab.appendChild(tb);
      ui.rol.appendChild(tab);
      const ant = el('button', 'peve-btn', 'Anterior'); ant.type = 'button'; ant.disabled = pg.pagina <= 1;
      const prox = el('button', 'peve-btn', 'Próxima'); prox.type = 'button'; prox.disabled = pg.pagina >= pg.paginas;
      ant.addEventListener('click', () => { st.pagina = Math.max(1, st.pagina - 1); desenhar(); });
      prox.addEventListener('click', () => { st.pagina = st.pagina + 1; desenhar(); });
      ui.pag.appendChild(ant);
      ui.pag.appendChild(el('span', 'peve-pag-txt', 'Página ' + pg.pagina + ' de ' + pg.paginas + ' · linhas ' + pg.de + ' a ' + pg.ate + ' de ' + pg.total));
      ui.pag.appendChild(prox);
    }

    async function guarda(fn) {
      let r;
      try { r = await deps.rpc(fn); } catch (e) { return 'erro'; }
      if (!r) return 'erro';
      if (r.status === 401) return 'sessao';
      if (r.status === 403) return 'negado';
      if (!r.ok) return 'erro';
      let b; try { b = await r.json(); } catch (e) { return 'erro'; }
      return b === true ? 'sim' : 'nao';
    }

    async function carregar() {
      const g = ++st.gen;
      st.dados = null; st.ultimas = null; st.pagina = 1;
      const vivo = () => g === st.gen && st.ativo;
      const sid = deps.sessaoId();
      const falha = (fase, msg) => { if (!vivo()) return; limpar(); st.fase = fase; st.msg = msg || ''; desenhar(); };   // erro, negação ou logout: nada fica na tela nem nos filtros
      const v = validarIntervalo(st.de, st.ate);
      if (!v.ok) { st.fase = 'periodoinvalido'; st.msg = v.motivo; desenhar(); return; }
      st.sessao = sid; st.msg = '';
      if (!sid) { st.fase = 'sessao'; desenhar(); return; }
      st.fase = 'carregando'; desenhar();
      const de = st.de, ate = st.ate;
      const sessaoMudou = () => deps.sessaoId() !== sid;
      const rs = await Promise.all([guarda('pode_ver_pessoal'), guarda('pode_cadastrar_pessoal')]);
      if (!vivo()) return;
      if (sessaoMudou()) return falha('sessao');
      if (rs.includes('sessao')) { if (deps.sessaoVencida) deps.sessaoVencida(); return falha('sessao'); }
      if (rs.includes('negado')) return falha('negado');
      if (rs.includes('erro')) return falha('erro');
      if (!rs.every((x) => x === 'sim')) return falha('semacesso');
      let info = null;
      try { info = await deps.lojaCarregar(); } catch (e) { info = null; }
      if (!vivo()) return;
      const atual = deps.lojaAtual();
      if (!info || !Array.isArray(info.lojas) || !info.lojas.length || typeof atual !== 'string' || !info.lojas.includes(atual)) { st.lojas = []; st.loja = null; return falha('semloja'); }
      st.lojas = info.lojas.filter((l) => typeof l === 'string'); st.loja = atual; st.travado = info.travado === true;
      let pessoas, ausencias, ocorrencias, ua, uo;
      try {
        [pessoas, ausencias, ocorrencias, ua, uo] = await Promise.all([
          deps.consultarTudo(PESSOAS_PATH), deps.consultar(ausenciaPath(de, ate)), deps.consultarTudo(ocorrenciaPath(de, ate)),   // paginadas: cadastro e ocorrência (id único); ausência: UMA consulta
          deps.consultar(ULTIMA_AUSENCIA_PATH).then((x) => x, () => 'falha'),
          deps.consultar(ULTIMA_OCORRENCIA_PATH).then((x) => x, () => 'falha')]);
      } catch (e) { if (!vivo()) return; return falha(classificaErro(e)); }
      if (!vivo()) return;
      if (sessaoMudou()) return falha('sessao');
      if (deps.lojaAtual() !== atual) return;   // a loja mudou no meio: o ouvinte já recomeçou
      if (!Array.isArray(pessoas) || !Array.isArray(ausencias) || !Array.isArray(ocorrencias)) return falha('dadosinvalidos');
      if (st.de !== de || st.ate !== ate) return;   // inputs mudaram no meio: resultado do período antigo é descartado
      if (ausencias.length >= LIMITE_AUSENCIA) return falha('limiteausencia');   // possível corte: nada parcial, nem contagens
      const ult = (x, ler) => {
        if (!Array.isArray(x)) return { estado: 'indisponivel' };
        if (!x.length) return { estado: 'vazio' };
        const val = ehObj(x[0]) ? ler(x[0]) : null;
        return val ? { estado: 'ok', valor: val } : { estado: 'indisponivel' };
      };
      st.ultimas = { aus: ult(ua, (r) => fmtMes(r.mes_lido)), oco: ult(uo, (r) => fmtLidoEm(r.lido_em)) };
      if (!pessoas.length) { st.fase = 'semcadastro'; st.msg = ''; desenhar(); return; }
      const consultadoEm = deps.agora();
      const c = montarLinhas({ pessoas, ausencias, ocorrencias, de, ate, hoje: deps.hoje() });
      st.dados = { de, ate, linhas: c.linhas, notas: c.notas, consultadoEm };
      st.fase = !ausencias.length && !ocorrencias.length ? 'vazio' : (!c.linhas.length ? 'semvinculo' : 'ok');
      desenhar();
    }

    function recomecar() {   // loja, sessão ou reentrada: apaga o que estava na tela antes de qualquer resposta nova
      st.gen++; limpar(); st.fase = 'carregando'; st.msg = '';
      if (!deps.sessaoId()) st.sessao = null;
      desenhar();
      return carregar();
    }

    return {
      st,
      entrar() {
        st.ativo = true;
        if (!st.de) { const h = deps.hoje(); st.de = somarDias(h, -30); st.ate = somarDias(h, 30); }
        montar();
        if (!st.ligado) {
          st.ligado = true;
          deps.aoMudarLoja(() => { if (st.ativo) recomecar(); });
          if (deps.aoMudarSessao) deps.aoMudarSessao(() => { if (st.ativo) recomecar(); });
        }
        return recomecar();
      },
      carregar, recomecar, desenhar,
    };
  }

  // ---------- ligação ao núcleo existente (só no navegador) ----------
  let inst = null;
  function depsPadrao() {
    return {
      doc: document,
      rpc: (fn) => trRpc(fn, {}),
      consultarTudo: (c) => consultarTudo(c),   // pagina de 1000 em 1000 (só para consultas com chave única na ordem)
      consultar: (c) => consultarTudo(c),       // só para consultas que trazem o próprio limit=: o núcleo devolve UMA página, sem offset
      lojaCarregar: () => lojaCarregar(), lojaAtual: () => lojaAtual(), lojaNome: (l) => lojaNome(l),
      escolherLoja: (l) => { if (typeof NA_CASCA !== 'undefined' && NA_CASCA) avisarCasca({ tipo: 'casca-loja-pedir', loja: l }); else lojaEscolher(l); },
      aoMudarLoja: (fn) => aoMudarLoja(fn),
      aoMudarSessao: (fn) => window.addEventListener('storage', (e) => { if (e.key === 'rmbSessao' || e.key === null) fn(); }),
      sessaoId: () => { const s = rmbSessao(); return s && s.access_token ? String(s.email || 'sessao') : null; },
      sessaoVencida: () => { if (typeof exigirLogin === 'function') exigirLogin('Sua sessão venceu. Entre de novo.'); },
      agora: () => new Date().toISOString(),
      hoje: () => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(new Date()),
    };
  }
  function entrarPesEventos() { if (!inst) inst = criar(depsPadrao()); return inst.entrar(); }

  return {
    criar, montarLinhas, filtrarLinhas, ordenar, paginar, validarIntervalo, lojaCombina, entrarPesEventos,
    MAX_DIAS, POR_PAGINA, LIMITE_AUSENCIA, PESSOAS_PATH, ULTIMA_AUSENCIA_PATH, ULTIMA_OCORRENCIA_PATH, ausenciaPath, ocorrenciaPath,
  };
});

