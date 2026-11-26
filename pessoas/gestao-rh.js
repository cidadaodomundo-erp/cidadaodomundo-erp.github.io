// GESTÃO DO RH — ERROS DO DIA (rota prh, Operação das lojas > RH). Lê o ponto por um GET ao leitor próprio
// (Edge Function fabio-ponto-leitura, com o JWT de quem está logado) por dia/loja escolhidos. A única escrita é a
// anotação "o que foi feito" (tabela ponto_feito, só pela função ponto_feito_gravar, que confere a chave do ponto).
// Não muda ponto, cadastro nem folha; não tem temporizador, não guarda dado de pessoa no navegador, não toca em robô do Neto.
// Regras em window.GestaoRhModelo (pessoas/gestao-rh-modelo.js); aqui só buscar e mostrar. Todo texto entra por textContent.
(function (root, factory) {
  'use strict';
  const mod = factory(typeof require === 'function' && typeof module !== 'undefined' ? require('./gestao-rh-modelo.js') : (root && root.GestaoRhModelo));
  if (typeof module !== 'undefined' && module.exports) module.exports = mod;
  if (root) { root.GestaoRh = mod; root.entrarPesGestaoRh = mod.entrarPesGestaoRh; }
})(typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : null), function (M) {
  'use strict';

  const KPIS = Object.freeze([
    ['ERROS', 'Para olhar', 'quem tem algum apontamento'], ['SERIO', 'Sério', 'intervalo abaixo do legal'], ['INFRACAO', 'Batida faltando', 'menos de 4 batidas'],
    ['VERBAL', 'Orientar', 'atraso ou saída depois do horário'], ['CONFERIR', 'Conferir', 'horário destoa, teto de 10h'],
    ['REF_NAO', 'Refeição não localizada', 'trabalhou e não achamos a refeição'], ['SEM', 'Sem apontamento', 'dia limpo'], ['TODOS', 'Todos com batida', ''],
  ]);
  const MSG = Object.freeze({
    carregando: 'Carregando…', sessao: 'Sessão vencida ou ausente. Entre de novo.', erro: 'Não foi possível consultar agora. Nada foi alterado.',
    semacesso: 'Seu acesso não permite ver o ponto.', semloja: 'Nenhuma loja disponível para você.', dadosinvalidos: 'Resposta inesperada do leitor; nada exibido.',
    muitas: 'Muitas consultas em pouco tempo. Espere um minuto e clique em Atualizar.', fonte: 'O relógio de ponto (Flash) não respondeu agora. Nada exibido; tente Atualizar.',
  });
  const REF_TXT = Object.freeze({
    pendente: 'dados da loja ainda não recebidos', indisponivel: 'fonte indisponível', sem_vinculo: 'sem vínculo de refeição confirmado',
  });
  const ddmm = (s) => (typeof s === 'string' && s.length >= 10 ? s.slice(8, 10) + '/' + s.slice(5, 7) : '');
  const DOW = ['domingo', 'segunda', 'terça', 'quarta', 'quinta', 'sexta', 'sábado'];
  const diaSemana = (s) => DOW[new Date(s + 'T12:00:00Z').getUTCDay()] || '';
  function horaBrt(iso) {
    const d = typeof iso === 'string' ? new Date(iso) : null; if (!d || Number.isNaN(d.getTime())) return '';
    return new Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Sao_Paulo', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(d);
  }
  function textoRefeicao(l, fechado) {
    const r = l.refeicao;
    if (r.estado === 'lancada') return r.itens.map((i) => (i.quantidade > 1 ? i.quantidade + '× ' : '') + i.produto + (i.hora ? ' (' + i.hora + ')' : '')).join(' · ');
    if (r.estado === 'nao_lancou') return fechado ? 'não localizada na leitura do dia' : 'ainda sem lançamento (dia em andamento)';
    return REF_TXT[r.estado] || '—';
  }
  function classeDoErro(e) {
    const s = e && e.status;
    if (s === 401) return 'sessao'; if (s === 403) return 'semacesso'; if (s === 429) return 'muitas'; if (s === 502) return 'fonte';
    return 'erro';
  }

  function criar(deps) {
    const st = { ativo: false, fase: 'carregando', dia: null, loja: null, filtro: 'ERROS', dados: null, gen: 0, montado: false, ligado: false, abort: null,
      feitos: {}, feitoErro: false, rascunho: {}, salvando: {}, msgFeito: {} };
    const ui = {};
    const el = (t, c, txt) => { const e = deps.doc.createElement(t); if (c) e.className = c; if (txt !== undefined) e.textContent = txt; return e; };
    const dias = () => M.diasPermitidos(deps.diaOperacional());

    function montar() {
      if (st.montado) return;
      const raiz = deps.doc.getElementById('view-prh'); if (!raiz) return;
      raiz.replaceChildren();
      raiz.appendChild(el('h2', 'grh-titulo', 'Gestão do RH — erros do dia'));
      raiz.appendChild(el('p', 'grh-sub', 'Mostra, por pessoa, o que precisa de atenção no ponto e na refeição do dia escolhido. Em "O que foi feito" você anota como resolveu (fica gravado com seu nome e a hora). Nada aqui muda cadastro, ponto ou folha.'));
      const barra = el('div', 'grh-barra');
      ui.ant = el('button', 'grh-btn', '‹ dia anterior'); ui.ant.type = 'button'; barra.appendChild(ui.ant);
      ui.dia = el('strong', 'grh-dia'); barra.appendChild(ui.dia);
      ui.prox = el('button', 'grh-btn', 'dia seguinte ›'); ui.prox.type = 'button'; barra.appendChild(ui.prox);
      ui.btn = el('button', 'grh-btn', 'Atualizar'); ui.btn.type = 'button'; barra.appendChild(ui.btn);
      raiz.appendChild(barra);
      ui.status = el('div', 'grh-status'); raiz.appendChild(ui.status);
      ui.fonte = el('div', 'grh-fonte'); raiz.appendChild(ui.fonte);
      ui.kpis = el('div', 'grh-kpis'); raiz.appendChild(ui.kpis);
      ui.rol = el('div', 'grh-rol'); raiz.appendChild(ui.rol);
      ui.sem = el('div', 'grh-sem'); raiz.appendChild(ui.sem);
      ui.avisos = el('div', 'grh-avisos'); raiz.appendChild(ui.avisos);
      ui.ant.addEventListener('click', () => passo(-1));
      ui.prox.addEventListener('click', () => passo(1));
      ui.btn.addEventListener('click', () => recomecar());
      st.montado = true;
    }
    function passo(d) {
      const ds = dias(); const i = ds.indexOf(st.dia); const j = (i < 0 ? ds.length - 1 : i) + d;
      if (j < 0 || j >= ds.length) return;
      st.dia = ds[j]; st.filtro = 'ERROS'; recomecar();
    }

    function desenhar() {
      if (!st.montado) return;
      [ui.fonte, ui.kpis, ui.rol, ui.sem, ui.avisos].forEach((x) => x.replaceChildren());
      const ds = dias(); const i = ds.indexOf(st.dia);
      ui.dia.textContent = st.dia ? ddmm(st.dia) + ' (' + diaSemana(st.dia) + ')' + (st.loja ? ' · ' + st.loja : '') : '—';
      ui.ant.disabled = i <= 0; ui.prox.disabled = i < 0 || i >= ds.length - 1;
      ui.status.className = 'grh-status' + (st.fase !== 'ok' && st.fase !== 'carregando' ? ' grh-erro' : '');
      ui.status.textContent = st.fase === 'ok' ? '' : (MSG[st.fase] || MSG.erro);
      const d = st.dados; if (st.fase !== 'ok' || !d) return;

      ui.fonte.textContent = 'Fonte: relógio de ponto Flash (leitura direta' + (d.lidoEm ? ' às ' + horaBrt(d.lidoEm) : '') + ') e refeições do Saipos já recebidas. '
        + (d.emAndamento ? 'Dia em andamento: batida incompleta e refeição ainda não são apontadas. ' : '')
        + (d.atrasoAvaliado ? 'Atraso avaliado para ' + d.comJornada + ' pessoa(s) com horário cadastrado.' : 'Atraso NÃO avaliado neste dia: o horário cadastrado só chega para o dia em andamento.');

      KPIS.forEach(([k, rot, dica]) => {
        const n = k === 'ERROS' ? M.filtrar(d.linhas, 'ERROS').length : (k === 'TODOS' ? d.kpis.TOTAL : d.kpis[k]);
        if (!n && k !== 'ERROS' && k !== 'TODOS') return;
        const b = el('button', 'grh-kpi grh-k-' + k + (st.filtro === k ? ' grh-on' : '')); b.type = 'button';
        b.appendChild(el('b', null, String(n))); b.appendChild(el('span', null, rot));
        if (dica) b.title = dica;
        b.setAttribute('aria-pressed', st.filtro === k ? 'true' : 'false');
        b.addEventListener('click', () => { st.filtro = k; desenhar(); });
        ui.kpis.appendChild(b);
      });

      const lista = M.filtrar(d.linhas, st.filtro);
      if (!lista.length) ui.rol.appendChild(el('p', 'grh-vazio', d.kpis.TOTAL ? (st.filtro === 'ERROS' ? 'Nenhum apontamento neste dia para quem bateu ponto.' : 'Ninguém neste filtro.') : 'Nenhuma batida lida neste dia para esta loja.'));
      else {
        const tab = el('table', 'grh-tab'); const th = el('tr');
        ['Pessoa', 'Batidas', 'Trabalhou · intervalo', 'Apontamentos', 'Refeição', 'O que foi feito'].forEach((t) => th.appendChild(el('th', null, t)));
        const thead = el('thead'); thead.appendChild(th); tab.appendChild(thead);
        const tb = el('tbody');
        lista.forEach((l) => {
          const tr = el('tr', 'grh-n-' + l.nivel);
          const c1 = el('td'); c1.setAttribute('data-rot', 'Pessoa'); c1.appendChild(el('div', 'grh-nome', l.nome)); c1.appendChild(el('div', 'grh-loja', l.unidade)); tr.appendChild(c1);
          const c2 = el('td', 'grh-h', l.batidas.length ? l.batidas.join('  ') + (l.viradaNoite ? ' (virou a noite)' : '') : '—'); c2.setAttribute('data-rot', 'Batidas');
          if (l.jornada) c2.appendChild(el('div', 'grh-jor', 'horário cadastrado ' + l.jornada.entrada + '–' + l.jornada.saida));
          tr.appendChild(c2);
          const c3 = el('td', 'grh-h', l.liquido === null ? '—' : M.fmtDur(l.liquido) + ' · ' + l.intervalo + ' min'); c3.setAttribute('data-rot', 'Trabalhou · intervalo'); tr.appendChild(c3);
          const c4 = el('td'); c4.setAttribute('data-rot', 'Apontamentos');
          if (!l.apontamentos.length) c4.appendChild(el('span', 'grh-ok', 'sem apontamento'));
          l.apontamentos.forEach((a) => { const p = el('div', 'grh-ap grh-a-' + a.nivel); p.appendChild(el('b', null, a.rotulo + ': ')); p.appendChild(deps.doc.createTextNode(a.texto)); c4.appendChild(p); });
          tr.appendChild(c4);
          const c5 = el('td', 'grh-ref grh-r-' + l.refeicao.estado + (l.refeicaoErro ? ' grh-r-erro' : ''), textoRefeicao(l, d.fechado)); c5.setAttribute('data-rot', 'Refeição'); tr.appendChild(c5);
          tr.appendChild(celulaFeito(l));
          tb.appendChild(tr);
        });
        tab.appendChild(tb); ui.rol.appendChild(tab);
      }

      if (d.semBatida.length) {
        const det = el('details', 'grh-det');
        det.appendChild(el('summary', null, d.semBatida.length + ' pessoa(s) do cadastro sem batida neste dia — pode ser folga, férias, atestado ou falta; este portal ainda não tem a escala para afirmar'));
        const ul = el('ul'); d.semBatida.forEach((p) => ul.appendChild(el('li', null, p.nome + ' · ' + p.unidade))); det.appendChild(ul);
        ui.sem.appendChild(det);
      }
      const notas = d.avisos.slice();
      notas.push('Ainda não aparece nesta tela: hora extra, jornada a menor, falta confirmada e atraso de dias passados (dependem de jornada contratada e escala neste sistema).');
      notas.forEach((a) => ui.avisos.appendChild(el('div', 'grh-aviso', a)));
    }

    // ---------- "o que foi feito": anotação por pessoa e dia ----------
    function celulaFeito(l) {
      const c = el('td', 'grh-feito'); c.setAttribute('data-rot', 'O que foi feito');
      (st.feitos[l.id] || []).forEach((f) => {
        const p = el('div', 'grh-f-item'); p.appendChild(deps.doc.createTextNode(f.texto));
        p.appendChild(el('span', 'grh-f-quem', ' — ' + quem(f.autor_email) + (f.em ? ' às ' + horaBrt(f.em) : ''))); c.appendChild(p);
      });
      if (st.feitoErro) { c.appendChild(el('div', 'grh-f-msg grh-erro', 'Não foi possível ler as anotações agora.')); return c; }
      if (!deps.feitoGravar) return c;
      const caixa = el('textarea', 'grh-f-txt'); caixa.rows = 2; caixa.maxLength = 500;
      caixa.placeholder = 'Ex.: folga combinada; atestado lançado na Flash; esqueceu de bater, conferido com a loja';
      caixa.value = st.rascunho[l.id] || ''; caixa.disabled = !!st.salvando[l.id];
      caixa.addEventListener('input', () => { st.rascunho[l.id] = caixa.value; });
      const b = el('button', 'grh-btn grh-f-btn', st.salvando[l.id] ? 'Salvando…' : 'Salvar'); b.type = 'button'; b.disabled = !!st.salvando[l.id];
      b.addEventListener('click', () => salvarFeito(l));
      c.appendChild(caixa); c.appendChild(b);
      if (st.msgFeito[l.id]) c.appendChild(el('div', 'grh-f-msg' + (st.msgFeito[l.id].erro ? ' grh-erro' : ''), st.msgFeito[l.id].txt));
      return c;
    }
    const quem = (email) => (typeof email === 'string' && email.includes('@') ? email.split('@')[0] : 'alguém');
    async function salvarFeito(l) {
      const texto = String(st.rascunho[l.id] || '').trim();
      if (!texto) { st.msgFeito[l.id] = { erro: true, txt: 'Escreva o que foi feito antes de salvar.' }; return desenhar(); }
      if (texto.length > 500) { st.msgFeito[l.id] = { erro: true, txt: 'Máximo de 500 letras.' }; return desenhar(); }
      const dia = st.dia, loja = st.loja;
      st.salvando[l.id] = true; st.msgFeito[l.id] = null; desenhar();
      try {
        const f = await deps.feitoGravar({ dia, pessoa_id: l.id, unidade: loja, texto });
        if (st.dia !== dia || st.loja !== loja) return;
        (st.feitos[l.id] = st.feitos[l.id] || []).push(f && typeof f.texto === 'string' ? f : { texto, autor_email: deps.sessaoId(), em: new Date().toISOString() });
        st.rascunho[l.id] = ''; st.msgFeito[l.id] = { erro: false, txt: 'Salvo.' };
      } catch (e) {
        const c = classeDoErro(e);
        st.msgFeito[l.id] = { erro: true, txt: c === 'semacesso' ? 'Seu acesso não permite anotar no ponto.' : c === 'sessao' ? 'Sessão vencida. Entre de novo e salve outra vez.' : 'Não salvou. Tente de novo.' };
        if (c === 'sessao' && deps.sessaoVencida) deps.sessaoVencida();
      } finally { st.salvando[l.id] = false; if (st.ativo) desenhar(); }
    }

    async function carregar() {
      const gen = ++st.gen; const vivo = () => st.ativo && gen === st.gen;
      if (st.abort) st.abort.abort();
      const ac = typeof AbortController !== 'undefined' ? new AbortController() : null; st.abort = ac;
      const falha = (f) => { if (!vivo()) return; st.fase = f; st.dados = null; desenhar(); };
      st.fase = 'carregando'; st.dados = null; desenhar();
      if (!deps.sessaoId()) { if (deps.sessaoVencida) deps.sessaoVencida(); return falha('sessao'); }
      const ds = dias(); if (!ds.length) return falha('erro');
      if (!ds.includes(st.dia)) st.dia = ds[ds.length - 1];
      let info = null; try { info = await deps.lojaCarregar(); } catch (e) { info = null; }
      if (!vivo()) return;
      const atual = deps.lojaAtual();
      if (!info || !Array.isArray(info.lojas) || typeof atual !== 'string' || !info.lojas.includes(atual)) { st.loja = null; return falha('semloja'); }
      st.loja = atual; const dia = st.dia; st.feitos = {}; st.feitoErro = false; st.rascunho = {}; st.msgFeito = {}; desenhar();
      let resp;
      const pFeitos = deps.feitoListar ? deps.feitoListar({ dia, unidade: atual, signal: ac ? ac.signal : undefined }).then((v) => ({ v }), (e) => ({ e })) : Promise.resolve({ v: [] });
      try { resp = await deps.leituraDireta({ dia, unidade: atual, signal: ac ? ac.signal : undefined }); }
      catch (e) { if (!vivo()) return; const c = classeDoErro(e); if (c === 'sessao' && deps.sessaoVencida) deps.sessaoVencida(); return falha(c); }
      if (!vivo() || st.dia !== dia || deps.lojaAtual() !== atual) return;
      const r = M.apontar(resp, { hojeOperacional: deps.diaOperacional() });
      if (!r.ok || r.dia !== dia) return falha('dadosinvalidos');
      const fr = await pFeitos;
      if (!vivo() || st.dia !== dia || deps.lojaAtual() !== atual) return;
      if (fr.e || !Array.isArray(fr.v)) st.feitoErro = true;
      else fr.v.forEach((f) => { if (f && f.pessoa_id != null && typeof f.texto === 'string') (st.feitos[f.pessoa_id] = st.feitos[f.pessoa_id] || []).push(f); });
      st.dados = r; st.fase = 'ok'; desenhar();
    }
    const recomecar = () => carregar();

    return {
      st, carregar, recomecar, desenhar, passo,
      entrar() {
        st.ativo = true; montar();
        if (!st.dia) { const ds = dias(); st.dia = ds.length ? ds[ds.length - 1] : null; }
        if (!st.ligado) {
          st.ligado = true;
          deps.aoMudarLoja(() => { if (st.ativo) recomecar(); });
          if (deps.aoMudarSessao) deps.aoMudarSessao(() => { if (st.ativo) recomecar(); });
        }
        return recomecar();
      },
      sair() { st.ativo = false; st.gen++; if (st.abort) { st.abort.abort(); st.abort = null; } },
    };
  }

  /* global document, window, lojaCarregar, lojaAtual, aoMudarLoja, rmbSessao, exigirLogin, SUPABASE_URL, SUPABASE_ANON_KEY */
  function depsPadrao() {
    return {
      doc: document,
      lojaCarregar: () => lojaCarregar(), lojaAtual: () => lojaAtual(),
      aoMudarLoja: (fn) => aoMudarLoja(fn),
      aoMudarSessao: (fn) => window.addEventListener('storage', (e) => { if (e.key === 'rmbSessao' || e.key === null) fn(); }),
      sessaoId: () => { const s = rmbSessao(); return s && s.access_token ? String(s.email || 'sessao') : null; },
      // anotações "o que foi feito" do dia/loja (leitura liberada pela chave do ponto)
      feitoListar: async ({ dia, unidade, signal }) => {
        const s = rmbSessao(); if (!s || !s.access_token) throw Object.assign(new Error('401'), { status: 401 });
        const r = await fetch(SUPABASE_URL + '/rest/v1/ponto_feito?select=pessoa_id,texto,autor_email,em&order=em.asc&dia=eq.' + encodeURIComponent(dia) + '&unidade=eq.' + encodeURIComponent(unidade),
          { method: 'GET', headers: { apikey: SUPABASE_ANON_KEY, Authorization: 'Bearer ' + s.access_token }, signal });
        if (!r.ok) throw Object.assign(new Error('HTTP ' + r.status), { status: r.status });
        return await r.json();
      },
      // única escrita da tela: a função do banco confere a chave do ponto e grava quem escreveu
      feitoGravar: async ({ dia, pessoa_id, unidade, texto }) => {
        const s = rmbSessao(); if (!s || !s.access_token) throw Object.assign(new Error('401'), { status: 401 });
        const r = await fetch(SUPABASE_URL + '/rest/v1/rpc/ponto_feito_gravar', { method: 'POST',
          headers: { apikey: SUPABASE_ANON_KEY, Authorization: 'Bearer ' + s.access_token, 'Content-Type': 'application/json' },
          body: JSON.stringify({ p_dia: dia, p_pessoa_id: pessoa_id, p_unidade: unidade, p_texto: texto }) });
        if (!r.ok) throw Object.assign(new Error('HTTP ' + r.status), { status: r.status });
        return await r.json();
      },
      sessaoVencida: () => { if (typeof exigirLogin === 'function') exigirLogin('Sua sessão venceu. Entre de novo.'); },
      // mesmo dia operacional do Ponto ao Vivo: antes das 07:00 (Brasília) ainda é ontem
      diaOperacional: () => {
        const p = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', hourCycle: 'h23' }).formatToParts(new Date());
        const g = (t) => p.find((x) => x.type === t).value; const hoje = g('year') + '-' + g('month') + '-' + g('day');
        return Number(g('hour')) < 7 ? M.somarDias(hoje, -1) : hoje;
      },
      leituraDireta: async ({ dia, unidade, signal }) => {
        const s = rmbSessao();
        if (!s || !s.access_token) throw Object.assign(new Error('Sessão vencida ou ausente (401)'), { status: 401 });
        const lim = new AbortController(); const h = setTimeout(() => lim.abort(), 25000);
        const cancela = () => lim.abort(); if (signal) signal.addEventListener('abort', cancela);
        try {
          const r = await fetch(SUPABASE_URL + '/functions/v1/fabio-ponto-leitura?dia=' + encodeURIComponent(dia) + '&unidade=' + encodeURIComponent(unidade),
            { method: 'GET', headers: { apikey: SUPABASE_ANON_KEY, Authorization: 'Bearer ' + s.access_token }, signal: lim.signal });
          if (!r.ok) throw Object.assign(new Error('HTTP ' + r.status), { status: r.status });
          return await r.json();
        } finally { clearTimeout(h); if (signal) signal.removeEventListener('abort', cancela); }
      },
    };
  }
  let inst = null;
  function entrarPesGestaoRh() { if (!inst) inst = criar(depsPadrao()); return inst.entrar(); }

  return { criar, entrarPesGestaoRh, KPIS, MSG, textoRefeicao, classeDoErro };
});
