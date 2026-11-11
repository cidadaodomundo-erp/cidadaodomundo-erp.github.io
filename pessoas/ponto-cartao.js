// CONSULTA DE PONTO (rota pcartao, módulo Pessoas). Só LEITURA de rh_pessoa (mínimo) e rh_flash_batida (período escolhido).
// Não chama entrarCargos/CARGOS, não lê finanças/salário/CPF, não escreve nada, não guarda dado de pessoa no navegador.
// Fonte: resumo recebido do Flash no ERP (entrada, saída, contagem). NÃO é espelho completo e NÃO mostra intervalo.
// Regras de estado vêm de window.PontoCartaoModelo (pessoas/ponto-cartao-modelo.js); aqui só buscar, cruzar e mostrar.
(function (root, factory) {
  'use strict';
  const mod = factory(typeof require === 'function' && typeof module !== 'undefined' ? require('./ponto-cartao-modelo.js') : (root && root.PontoCartaoModelo));
  if (typeof module !== 'undefined' && module.exports) module.exports = mod;
  if (root) { root.PontoCartao = mod; root.entrarPesPonto = mod.entrarPesPonto; }
})(typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : null), function (modelo) {
  'use strict';

  const MAX_DIAS = 31;
  const PESSOAS_PATH = 'rh_pessoa?select=id,nome,unidade,admissao,desligamento,flash_id,usa_ponto&order=id.asc';
  const ULTIMA_PATH = 'rh_flash_batida?select=data,lido_em&order=data.desc,flash_id.asc&limit=1';
  const batidasPath = (de, ate) => 'rh_flash_batida?select=data,flash_id,entrada,saida,n_batidas,lido_em&data=gte.' + de + '&data=lte.' + ate + '&order=data.asc,flash_id.asc';

  const CONF = Object.freeze({
    VINCULO_NAO_CONFIRMADO: ['Vínculo não confirmado (id, flash_id ou datas do cadastro); horários não atribuídos', 'ver'],
    FORA_DO_VINCULO: ['Fora do período de vínculo (antes da admissão ou depois do desligamento); sem horário atribuído', 'ok'],
    NAO_USA_PONTO: ['Cadastro marca que não usa ponto; é só cadastro, não é falta', 'ok'],
    SEM_REGISTRO: ['Leitura recebida com 0 batidas; conferir', 'ver'],
    ENTRADA_SEM_SAIDA: ['Entrada recebida, sem saída; conferir', 'ver'],
    SAIDA_SEM_ENTRADA: ['Saída recebida, sem entrada; conferir', 'ver'],
    REGISTRADO_SEM_DETALHE: ['Entrada e saída recebidas; intervalo não disponível nesta fonte', 'ok'],
    DADOS_INVALIDOS: ['Dados inválidos ou inconsistentes na leitura; conferir', 'ruim'],
    SEM_LEITURA: ['Sem leitura recebida para este dia; conferir', 'ver'],
    AMBIGUO_CADASTRO: ['Mesmo flash_id em mais de um cadastro neste período; horários não atribuídos; dados a conferir', 'ruim'],
    DUPLICADA: ['Leituras duplicadas para este dia; horários não atribuídos; dados a conferir', 'ruim'],
  });

  // ---------- datas (sem Date/fuso local: só calendário) ----------
  // Aritmética de calendário próprio (dias desde 1970-01-01, gregoriano proléptico): sem Date/Date.UTC, que tratam ano 0..99 como 19xx.
  function dataReal(s) { return modelo.dataCalendarValida(s) && Number(s.slice(0, 4)) >= 1; }   // anos 0001..9999
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
  function validarIntervalo(de, ate) {
    if (!dataReal(de) || !dataReal(ate)) return { ok: false, motivo: 'Datas inválidas: use dia/mês/ano reais.' };
    if (de > ate) return { ok: false, motivo: 'Período invertido: a data inicial é depois da final.' };
    const dias = diasDesde1970(ate) - diasDesde1970(de) + 1;
    if (!Number.isInteger(dias) || dias < 1) return { ok: false, motivo: 'Datas inválidas: use dia/mês/ano reais.' };
    if (dias > MAX_DIAS) return { ok: false, motivo: 'Período longo demais: máximo de ' + MAX_DIAS + ' dias.' };
    return { ok: true, dias };
  }
  // itera só a quantidade validada (nunca passa de 31), então 9999-12-31 não gera loop nem ano 10000
  function listarDias(de, ate) {
    const v = validarIntervalo(de, ate); if (!v.ok) return [];
    const z = diasDesde1970(de), r = [];
    for (let i = 0; i < v.dias; i++) r.push(dataDeDias(z + i));
    return r;
  }

  // ---------- identidade/loja ----------
  const SAO_BRAZ = ['SAO BRAZ', 'SÃO BRAZ'];
  function lojaCombina(unidade, loja, redeOk) {
    if (typeof loja !== 'string') return false;
    if (typeof unidade !== 'string' || !unidade.trim()) return false;   // sem unidade válida: nunca entra, nem na REDE
    if (loja === 'REDE') return redeOk === true;
    if (unidade === loja) return true;
    return SAO_BRAZ.includes(unidade) && SAO_BRAZ.includes(loja);
  }
  function nomeSeguro(n, id) {
    if (typeof n === 'string') {
      const s = n.replace(/[\u0000-\u001f\u007f-\u009f‎‏‪-‮⁦-⁩]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 80);
      if (s) return s;
    }
    return typeof id === 'number' && Number.isSafeInteger(id) ? 'Cadastro #' + id : 'Cadastro sem nome';
  }
  const ehObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
  const idOk = (v) => typeof v === 'number' && Number.isSafeInteger(v) && v > 0;

  function periodoValido(p) {
    if (!modelo.dataCalendarValida(p.admissao)) return false;
    const d = p.desligamento;
    if (d === undefined || d === null) return true;
    return modelo.dataCalendarValida(d) && d >= p.admissao;
  }
  // outro cadastro com o MESMO flash_id pode ser o titular do dia? (período inválido = não dá para excluir)
  function podeCobrir(q, dia) {
    if (!periodoValido(q)) return true;
    return dia >= q.admissao && (q.desligamento == null || dia <= q.desligamento);
  }

  function fmtDia(s) { return s.slice(8, 10) + '/' + s.slice(5, 7) + '/' + s.slice(0, 4); }
  // timestamp SEM fuso: só reordena os caracteres, nunca converte para outro horário
  function fmtTsSemFuso(s) { return s ? s.slice(8, 10) + '/' + s.slice(5, 7) + '/' + s.slice(0, 4) + ' ' + s.slice(11, 16) : null; }
  function fmtLidoEm(iso) {
    if (!iso) return null;
    try { return new Date(iso).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' }); } catch (e) { return null; }
  }

  // ---------- cruzamento (puro) ----------
  function cruzar(o) {
    const { pessoas, batidas, de, ate, loja, redeOk, consultadoEm } = o;
    const notas = { semUnidade: 0, cadastrosInvalidos: 0, batidasInvalidas: 0, batidasSemCadastro: 0 };
    const cad = pessoas.filter((p) => { if (ehObj(p)) return true; notas.cadastrosInvalidos++; return false; });
    const porFlash = new Map(), porId = new Map();
    for (const p of cad) {
      if (modelo.flashIdValido(p.flash_id)) { if (!porFlash.has(p.flash_id)) porFlash.set(p.flash_id, []); porFlash.get(p.flash_id).push(p); }
      if (idOk(p.id)) porId.set(p.id, (porId.get(p.id) || 0) + 1);
    }
    const porChave = new Map();
    for (const b of batidas) {
      if (!ehObj(b) || !modelo.flashIdValido(b.flash_id) || !modelo.dataCalendarValida(b.data) || b.data < de || b.data > ate) { notas.batidasInvalidas++; continue; }
      const k = b.flash_id + '\u0000' + b.data;
      if (!porChave.has(k)) porChave.set(k, []);
      porChave.get(k).push(b);
    }
    const usadas = new Set();
    const alvo = cad.filter((p) => {
      if (typeof p.unidade !== 'string' || !p.unidade.trim()) notas.semUnidade++;
      return lojaCombina(p.unidade, loja, redeOk);
    });
    const dias = listarDias(de, ate);
    const linhas = [];
    for (const dia of dias) {
      for (const p of alvo) {
        const base = { pessoaId: idOk(p.id) ? p.id : null, nome: nomeSeguro(p.nome, p.id), unidade: typeof p.unidade === 'string' ? nomeSeguro(p.unidade, null) : '—', dia,
          entrada: null, saida: null, n: null, nDesconhecido: false, lidoEm: null };
        const fim = (chave, extra) => linhas.push(Object.assign(base, { chave, rotulo: CONF[chave][0], classe: CONF[chave][1] }, extra || {}));
        if (!idOk(p.id) || !modelo.flashIdValido(p.flash_id) || !periodoValido(p)) { fim('VINCULO_NAO_CONFIRMADO'); continue; }
        if (dia < p.admissao || (p.desligamento != null && dia > p.desligamento)) { fim('FORA_DO_VINCULO'); continue; }
        const concorrentes = (porFlash.get(p.flash_id) || []).filter((q) => q !== p && podeCobrir(q, dia));
        if (concorrentes.length || porId.get(p.id) > 1) { fim('AMBIGUO_CADASTRO'); continue; }
        if (p.usa_ponto === false) { fim('NAO_USA_PONTO'); continue; }
        const k = p.flash_id + '\u0000' + dia;
        const lista = porChave.get(k);
        if (!lista) { fim('SEM_LEITURA'); continue; }
        usadas.add(k);
        if (lista.length > 1) { fim('DUPLICADA'); continue; }
        let r;
        try { r = modelo.montarResumoCartao({ id: p.id, flash_id: p.flash_id, unidade: p.unidade, admissao: p.admissao, desligamento: p.desligamento == null ? undefined : p.desligamento, usa_ponto: p.usa_ponto }, lista[0], consultadoEm); }
        catch (e) { fim('DADOS_INVALIDOS'); continue; }
        fim(r.estado === 'SEM_REGISTRO' || CONF[r.estado] ? r.estado : 'DADOS_INVALIDOS', {
          entrada: fmtTsSemFuso(r.entrada), saida: fmtTsSemFuso(r.saida), n: r.n_batidas == null ? null : r.n_batidas,
          nDesconhecido: r.n_batidas_desconhecido === true, lidoEm: fmtLidoEm(r.lido_em) });
      }
    }
    // leituras do período cujo flash_id não aparece em nenhum cadastro carregado: contadas, nunca atribuídas
    for (const [k] of porChave) { if (!usadas.has(k) && !porFlash.has(k.split('\u0000')[0])) notas.batidasSemCadastro++; }
    const opcoes = alvo.filter((p) => idOk(p.id)).map((p) => ({ id: p.id, nome: nomeSeguro(p.nome, p.id) }));
    return { linhas, notas, opcoes };
  }

  // ---------- controlador ----------
  function classificaErro(e) {
    const m = e && e.message;
    return (m === '401' || m === 'sessão vencida' || (e && e.status === 401)) ? 'sessao' : 'erro';
  }
  const MSG = Object.freeze({
    carregando: 'Carregando…',
    erro: 'Não foi possível consultar agora. Nada foi exibido; tente atualizar.',
    sessao: 'Sessão vencida ou ausente. Entre de novo.',
    semacesso: 'Sem acesso confirmado a esta consulta. Nenhum dado foi lido.',
    semloja: 'Loja não identificada para este login. Nenhum dado foi lido.',
    semcadastro: 'Cadastro/contexto indisponível para esta consulta. Não dá para concluir nada sobre equipe ou ausências.',
    dadosinvalidos: 'A resposta recebida não tem o formato esperado. Nada foi exibido.',
  });

  function criar(deps) {
    const st = { gen: 0, fase: 'inicial', msg: '', dados: null, loja: null, lojas: [], travado: false, de: null, ate: null, pessoaSel: '', ultima: null, sessao: null, ativo: false, ligado: false };
    let ui = null;
    const doc = deps.doc;

    function limpar(resetPessoa) { st.dados = null; st.ultima = null; if (resetPessoa) st.pessoaSel = ''; }
    function el(tag, cls, txt) { const e = doc.createElement(tag); if (cls) e.className = cls; if (txt != null) e.textContent = txt; return e; }
    function campo(rot, ctl) { const l = el('label', 'pcart-campo'); l.appendChild(el('span', null, rot)); l.appendChild(ctl); return l; }

    function montar() {
      const raiz = doc.getElementById('view-pcartao');
      if (!raiz) throw new Error('view-pcartao ausente');
      raiz.replaceChildren();
      const w = el('div', 'pcart');
      w.appendChild(el('h2', 'pcart-titulo', 'Consulta de ponto'));
      w.appendChild(el('div', 'pcart-aviso', 'Resumo recebido do Flash no ERP. Entrada, saída e contagem; não é espelho completo e não mostra intervalo. Entrada/saída aparecem como gravadas, sem fuso. Folga e ausência são desconhecidas nesta fonte. Disponível para quem já pode consultar o RH. A loja filtra apenas o que aparece nesta tela.'));
      const ctl = el('div', 'pcart-ctl');
      const de = el('input'); de.type = 'date';
      const ate = el('input'); ate.type = 'date';
      const pes = el('select'); const loja = el('select');
      const bAtu = el('button', 'pcart-btn', 'Atualizar'); bAtu.type = 'button';
      const bUlt = el('button', 'pcart-btn', 'Ver última data disponível'); bUlt.type = 'button'; bUlt.disabled = true;
      ctl.appendChild(campo('De', de)); ctl.appendChild(campo('Até', ate)); ctl.appendChild(campo('Pessoa', pes)); ctl.appendChild(campo('Loja', loja));
      ctl.appendChild(bAtu); ctl.appendChild(bUlt);
      const status = el('div', 'pcart-status'); status.setAttribute('role', 'status');
      const meta = el('div', 'pcart-meta');
      const rol = el('div', 'pcart-rolagem');
      [ctl, status, meta, rol].forEach((x) => w.appendChild(x));
      raiz.appendChild(w);
      ui = { de, ate, pes, loja, bAtu, bUlt, status, meta, rol };
      de.value = st.de; ate.value = st.ate;
      // editar o período invalida a carga em curso e apaga o quadro na hora; só o botão Atualizar busca de novo
      const alterou = () => {
        if (de.value === st.de && ate.value === st.ate) return;
        st.de = de.value; st.ate = ate.value; st.gen++; limpar(false);
        st.fase = 'periodoalterado'; st.msg = 'Período alterado. Clique Atualizar.'; desenhar();
      };
      de.addEventListener('input', alterou); de.addEventListener('change', alterou);
      ate.addEventListener('input', alterou); ate.addEventListener('change', alterou);
      pes.addEventListener('change', () => { st.pessoaSel = pes.value; desenhar(); });
      loja.addEventListener('change', () => { deps.escolherLoja(loja.value); desenhar(); });   // volta ao valor real; a mudança chega pelo ouvinte
      bAtu.addEventListener('click', () => { st.de = de.value; st.ate = ate.value; carregar(); });
      bUlt.addEventListener('click', () => { if (st.ultima && st.ultima.data) { st.de = st.ate = st.ultima.data; de.value = ate.value = st.ultima.data; carregar(); } });
    }

    function opcoes(sel, lista, atual) {
      sel.replaceChildren();
      lista.forEach(([v, t]) => { const o = el('option', null, t); o.value = v; sel.appendChild(o); });
      sel.value = lista.some(([v]) => v === atual) ? atual : (lista[0] ? lista[0][0] : '');
    }

    function desenhar() {
      if (!ui) return;
      const f = st.fase;
      ui.status.className = 'pcart-status' + (f === 'erro' || f === 'sessao' || f === 'periodoinvalido' || f === 'dadosinvalidos' ? ' pcart-erro' : (f === 'periodoalterado' || f === 'semregistros' || f === 'semcadastro' || f === 'semacesso' || f === 'semloja' ? ' pcart-alerta' : ''));
      let txt = st.msg || MSG[f] || '';
      if (f === 'semregistros') txt = 'Nenhuma leitura do Flash recebida neste período. As linhas abaixo mostram "sem leitura recebida"; isso não é falta nem OK.';
      if (f === 'ok') txt = 'Consulta concluída. Estados são só conferência; nenhum cálculo de falta, hora extra ou desconto.';
      ui.status.textContent = txt;
      ui.loja.disabled = st.travado || st.lojas.length < 2;
      opcoes(ui.loja, st.lojas.map((l) => [l, l]), st.loja);
      const d = st.dados && st.dados.de === st.de && st.dados.ate === st.ate ? st.dados : null;   // nunca linhas de outro período
      opcoes(ui.pes, [['', 'Todas']].concat(d ? d.opcoes.map((p) => [String(p.id), p.nome]) : []), st.pessoaSel);
      if (d && st.pessoaSel && ui.pes.value !== st.pessoaSel) st.pessoaSel = '';
      ui.bUlt.disabled = !(st.ultima && st.ultima.data) || f === 'carregando';
      const m = [];
      if (d) {
        m.push('Consulta feita neste navegador em ' + (fmtLidoEm(d.consultadoEm) || 'hora desconhecida') + ' (não é a hora de leitura do Flash; ela está na coluna "Lido em").');
        if (d.notas.semUnidade) m.push(d.notas.semUnidade + ' cadastro(s) sem unidade válida ficaram de fora desta consulta (sem horários atribuídos); conferir o cadastro.');
        if (d.notas.cadastrosInvalidos) m.push(d.notas.cadastrosInvalidos + ' cadastro(s) em formato inválido ignorado(s).');
        if (d.notas.batidasInvalidas) m.push(d.notas.batidasInvalidas + ' leitura(s) com dado inválido, não atribuída(s).');
        if (d.notas.batidasSemCadastro) m.push(d.notas.batidasSemCadastro + ' dia(s) de leitura sem cadastro correspondente por flash_id, não atribuído(s).');
      }
      if (st.ultima) m.push(st.ultima.estado === 'ok' ? 'Última data com registro recebido na base (escopo global, não é cobertura fechada nem prova de leitura completa): ' + fmtDia(st.ultima.data) + (st.ultima.lidoEm ? ', lido em ' + st.ultima.lidoEm : '') + '.'
        : st.ultima.estado === 'vazio' ? 'Nenhum registro recebido na base.' : 'Última data com registro: indisponível agora.');
      ui.meta.replaceChildren();
      m.forEach((t) => ui.meta.appendChild(el('div', null, t)));
      ui.rol.replaceChildren();
      if (!d) return;
      const linhas = st.pessoaSel ? d.linhas.filter((r) => String(r.pessoaId) === st.pessoaSel) : d.linhas;
      const tab = el('table', 'pcart-tab');
      const cab = el('tr');
      ['Pessoa', 'Loja', 'Dia', 'Entrada', 'Saída', 'Batidas', 'Lido em', 'Conferência'].forEach((t) => cab.appendChild(el('th', null, t)));
      const th = el('thead'); th.appendChild(cab); tab.appendChild(th);
      const tb = el('tbody');
      linhas.forEach((r) => {
        const tr = el('tr');
        const cel = (rot, t, cls) => { const c = el('td', cls, t); c.setAttribute('data-rot', rot); tr.appendChild(c); };
        cel('Pessoa', r.nome); cel('Loja', r.unidade); cel('Dia', fmtDia(r.dia));
        cel('Entrada', r.entrada || '—'); cel('Saída', r.saida || '—');
        cel('Batidas', r.nDesconhecido ? 'desconhecido' : (r.n == null ? '—' : String(r.n)));
        cel('Lido em', r.lidoEm || '—');
        cel('Conferência', r.rotulo, 'pcart-conf pcart-conf-' + r.classe);
        tb.appendChild(tr);
      });
      tab.appendChild(tb);
      ui.rol.appendChild(tab);
    }

    async function guarda(fn) {
      let r;
      try { r = await deps.rpc(fn); } catch (e) { return 'erro'; }
      if (r.status === 401) return 'sessao';
      if (!r.ok) return 'erro';
      let b; try { b = await r.json(); } catch (e) { return 'erro'; }
      return b === true ? 'sim' : 'nao';
    }

    async function carregar() {
      const g = ++st.gen;
      limpar(false);
      const vivo = () => g === st.gen && st.ativo;
      const sid = deps.sessaoId();
      const falha = (fase, msg) => { if (!vivo()) return; limpar(false); st.fase = fase; st.msg = msg || ''; desenhar(); };
      const v = validarIntervalo(st.de, st.ate);
      if (!v.ok) { st.fase = 'periodoinvalido'; st.msg = v.motivo; desenhar(); return; }
      st.sessao = sid; st.msg = '';
      if (!sid) { st.fase = 'sessao'; desenhar(); return; }
      st.fase = 'carregando'; desenhar();
      const de = st.de, ate = st.ate;
      const sessaoMudou = () => deps.sessaoId() !== sid;
      const [a, b] = await Promise.all([guarda('pode_ver_pessoal'), guarda('pode_cadastrar_pessoal')]);
      if (!vivo()) return;
      if (sessaoMudou()) return falha('sessao');
      const rs = [a, b];
      if (rs.includes('sessao')) { if (deps.sessaoVencida) deps.sessaoVencida(); return falha('sessao'); }
      if (rs.includes('erro')) return falha('erro');
      if (rs.includes('nao')) return falha('semacesso');
      let info = null;
      try { info = await deps.lojaCarregar(); } catch (e) { info = null; }
      if (!vivo()) return;
      const atual = deps.lojaAtual();
      if (!info || !Array.isArray(info.lojas) || !info.lojas.length || typeof atual !== 'string' || !info.lojas.includes(atual)) { st.lojas = []; st.loja = null; return falha('semloja'); }
      st.lojas = info.lojas.filter((l) => typeof l === 'string'); st.loja = atual; st.travado = info.travado === true;
      let pessoas, batidas, ult;
      try {
        [pessoas, batidas, ult] = await Promise.all([
          deps.consultar(PESSOAS_PATH), deps.consultar(batidasPath(de, ate)),
          deps.consultar(ULTIMA_PATH).then((x) => x, () => 'falha')]);
      } catch (e) { if (!vivo()) return; if (classificaErro(e) === 'sessao') return falha('sessao'); return falha('erro'); }
      if (!vivo()) return;
      if (sessaoMudou()) return falha('sessao');
      if (deps.lojaAtual() !== atual) return;   // a loja mudou no meio: o ouvinte já recomeçou
      if (!Array.isArray(pessoas) || !Array.isArray(batidas)) return falha('dadosinvalidos');
      let ultima = { estado: 'indisponivel' };
      if (Array.isArray(ult)) ultima = ult.length === 0 ? { estado: 'vazio' } : (ehObj(ult[0]) && modelo.dataCalendarValida(ult[0].data) ? { estado: 'ok', data: ult[0].data, lidoEm: modelo.isoComFusoValido(ult[0].lido_em) ? fmtLidoEm(ult[0].lido_em) : null } : { estado: 'indisponivel' });
      const consultadoEm = deps.agora();
      const c = cruzar({ pessoas, batidas, de, ate, loja: atual, redeOk: info.lojas.includes('REDE'), consultadoEm });
      st.ultima = ultima;
      if (!pessoas.length || !c.opcoes.length) { st.fase = 'semcadastro'; st.msg = pessoas.length ? 'Nenhum cadastro desta loja nesta consulta; não dá para concluir nada sobre a equipe.' : ''; desenhar(); return; }
      if (st.de !== de || st.ate !== ate) return;   // inputs mudaram no meio: resultado do período antigo é descartado
      st.dados = { de, ate, linhas: c.linhas, notas: c.notas, opcoes: c.opcoes, consultadoEm };
      st.fase = batidas.length === 0 ? 'semregistros' : 'ok';
      desenhar();
    }

    function recomecar() {   // loja, sessão ou reentrada: apaga o que estava na tela antes de qualquer resposta nova
      st.gen++; limpar(true); st.fase = 'carregando'; st.msg = '';
      if (!deps.sessaoId()) st.sessao = null;
      desenhar();
      return carregar();
    }

    return {
      st,
      entrar() {
        st.ativo = true;
        if (!st.de) st.de = st.ate = deps.hoje();
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
      consultar: (c) => consultarTudo(c),
      lojaCarregar: () => lojaCarregar(), lojaAtual: () => lojaAtual(),
      escolherLoja: (l) => { if (typeof NA_CASCA !== 'undefined' && NA_CASCA) avisarCasca({ tipo: 'casca-loja-pedir', loja: l }); else lojaEscolher(l); },
      aoMudarLoja: (fn) => aoMudarLoja(fn),
      aoMudarSessao: (fn) => window.addEventListener('storage', (e) => { if (e.key === 'rmbSessao' || e.key === null) fn(); }),
      sessaoId: () => { const s = rmbSessao(); return s && s.access_token ? String(s.email || 'sessao') : null; },
      sessaoVencida: () => { if (typeof exigirLogin === 'function') exigirLogin('Sua sessão venceu. Entre de novo.'); },
      agora: () => new Date().toISOString(),
      hoje: () => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(new Date()),
    };
  }
  function entrarPesPonto() { if (!inst) inst = criar(depsPadrao()); return inst.entrar(); }

  return { criar, cruzar, validarIntervalo, listarDias, lojaCombina, nomeSeguro, entrarPesPonto, CONF, MAX_DIAS, PESSOAS_PATH, ULTIMA_PATH, batidasPath };
});

