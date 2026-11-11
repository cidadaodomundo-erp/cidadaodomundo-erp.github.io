// PONTO AO VIVO (rota pao, módulo Pessoas). Só LEITURA (GET) de rh_pessoa, rh_flash_batida, rh_flash_ausencia e rh_ocorrencia.
// Não escreve, não guarda dado de pessoa no navegador, usa só textContent (nunca innerHTML). Regras ficam em ponto-ao-vivo-modelo.js.
// Atualiza sozinho a cada 60 s SOMENTE enquanto a tela está ativa, visível e o dia consultado é hoje.
(function (root, factory) {
  'use strict';
  const modelo = factory(typeof require === 'function' && typeof module !== 'undefined' ? require('./ponto-ao-vivo-modelo.js') : (root && root.PontoAoVivoModelo));
  if (typeof module !== 'undefined' && module.exports) module.exports = modelo;
  if (root) { root.PontoAoVivo = modelo; root.entrarPesPontoAoVivo = modelo.entrarPesPontoAoVivo; }
})(typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : null), function (M) {
  'use strict';

  const INTERVALO_ATUALIZACAO_MS = 60000;
  const LIMITE_AUSENCIA = 1000;   // se vierem 1000, pode haver mais: a fonte é tratada como indisponível
  const PESSOAS_PATH = 'rh_pessoa?select=id,nome,unidade,admissao,desligamento,flash_id,usa_ponto,folga_fixa_dow&order=id.asc';
  const batidasPath = (dia, comHorarios) => 'rh_flash_batida?select=data,flash_id,entrada,saida,n_batidas,' + (comHorarios ? 'horarios,' : '') + 'lido_em&data=eq.' + dia + '&order=flash_id.asc';
  const ausenciaPath = (dia) => 'rh_flash_ausencia?select=flash_id,inicio,fim&inicio=lt.' + M.diaSeguinte(dia)
    + '&or=(fim.gte.' + dia + ',and(fim.is.null,inicio.gte.' + dia + '))&order=inicio.desc,flash_id.asc,fim.asc&limit=' + LIMITE_AUSENCIA;
  const ocorrenciaPath = (dia) => 'rh_ocorrencia?select=id,pessoa_id,data&data=eq.' + dia + '&order=id.asc';

  const ehObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
  function classificaErro(e) { const m = e && typeof e.message === 'string' ? e.message : ''; return (e && e.status === 401) || /sess[ãa]o vencida|\b401\b/i.test(m) ? 'sessao' : 'erro'; }
  // cai na consulta sem `horarios` SÓ se o erro disser inequivocamente que a coluna não existe (400 + PGRST204 citando horarios)
  function colunaHorariosAusente(e) {
    if (!e || e.status !== 400 || typeof e.message !== 'string') return false;
    const i = e.message.indexOf('{'); if (i < 0) return false;
    let j; try { j = JSON.parse(e.message.slice(i)); } catch (x) { return false; }
    if (!ehObj(j) || j.code !== 'PGRST204') return false;
    return /['"]horarios['"]/.test((typeof j.message === 'string' ? j.message : '') + ' ' + (typeof j.details === 'string' ? j.details : ''));
  }

  const FILTROS = Object.freeze([['TODOS', 'Todos'], ['DENTRO', 'Dentro da loja'], ['INTERVALO', 'No intervalo'], ['JA_SAIU', 'Já saiu'], ['SEM_BATIDA', 'Ainda sem batida'], ['CONFERIR', 'Conferir / alertas']]);
  const passaFiltro = (f, l) => f === 'TODOS' || (f === 'CONFERIR' ? (l.alertas.length > 0 || ['CONFERIR', 'SAIU_OU_INTERVALO', 'INCOMPLETO'].includes(l.situacao)) : l.situacao === f);

  function criar(deps) {
    const st = { ativo: false, fase: 'carregando', msg: '', dia: null, loja: null, lojas: [], filtro: 'TODOS', dados: null, gen: 0, montado: false, cancelar: null };
    const ui = {};
    const el = (t, c, txt) => { const e = deps.doc.createElement(t); if (c) e.className = c; if (txt !== undefined) e.textContent = txt; return e; };

    function montar() {
      if (st.montado) return;
      const raiz = deps.doc.getElementById('view-pao'); if (!raiz) return;
      raiz.replaceChildren();
      ui.raiz = raiz;
      ui.titulo = el('h2', 'pao-titulo', 'Ponto ao Vivo'); raiz.appendChild(ui.titulo);
      ui.sub = el('p', 'pao-sub', 'Somente leitura. Mostra o que o relógio já enviou; ausência de batida não é falta nem atraso.'); raiz.appendChild(ui.sub);
      const barra = el('div', 'pao-barra');
      ui.dia = el('input'); ui.dia.type = 'date'; ui.dia.setAttribute('aria-label', 'Dia'); barra.appendChild(ui.dia);
      ui.selLoja = el('select'); ui.selLoja.setAttribute('aria-label', 'Loja'); barra.appendChild(ui.selLoja);
      ui.selFiltro = el('select'); ui.selFiltro.setAttribute('aria-label', 'Situação');
      FILTROS.forEach(([v, t]) => { const o = el('option', null, t); o.value = v; ui.selFiltro.appendChild(o); });
      barra.appendChild(ui.selFiltro);
      ui.btn = el('button', 'pao-btn', 'Atualizar'); ui.btn.type = 'button'; barra.appendChild(ui.btn);
      raiz.appendChild(barra);
      ui.status = el('div', 'pao-status'); raiz.appendChild(ui.status);
      ui.resumo = el('div', 'pao-resumo'); raiz.appendChild(ui.resumo);
      ui.avisos = el('div', 'pao-avisos'); raiz.appendChild(ui.avisos);
      ui.rol = el('div', 'pao-rol'); raiz.appendChild(ui.rol);
      ui.dia.addEventListener('change', () => { st.dia = ui.dia.value; sincronizarRelogio(); recomecar(); });
      ui.selLoja.addEventListener('change', () => { if (st.lojas.includes(ui.selLoja.value)) deps.escolherLoja(ui.selLoja.value); });
      ui.selFiltro.addEventListener('change', () => { st.filtro = ui.selFiltro.value; desenhar(); });
      ui.btn.addEventListener('click', () => { recomecar(); });
      st.montado = true;
    }

    const MSG = {
      carregando: 'Carregando…', sessao: 'Sessão vencida ou ausente. Entre de novo.', erro: 'Não foi possível consultar agora. Nada foi alterado.',
      semacesso: 'Seu acesso não permite ver o ponto.', semloja: 'Nenhuma loja disponível para você.', dadosinvalidos: 'Resposta inesperada do servidor; nada exibido.',
      semcadastro: 'Nenhum cadastro desta loja nesta consulta.', diainvalido: 'Dia inválido.',
    };
    function desenhar() {
      if (!st.montado) return;
      ui.rol.replaceChildren(); ui.resumo.replaceChildren(); ui.avisos.replaceChildren();
      ui.dia.value = st.dia || '';
      ui.selLoja.replaceChildren();
      st.lojas.forEach((l) => { const o = el('option', null, l); o.value = l; ui.selLoja.appendChild(o); });
      ui.selLoja.value = st.loja || '';
      ui.status.className = 'pao-status' + (['erro', 'sessao', 'dadosinvalidos', 'diainvalido'].includes(st.fase) ? ' pao-erro' : '');
      ui.status.textContent = st.fase === 'ok' ? '' : (MSG[st.fase] || '') + (st.msg ? ' ' + st.msg : '');
      if (st.fase !== 'ok' || !st.dados) return;
      const d = st.dados, r = d.resultado.resumo;
      const quadro = [['Dentro da loja', r.DENTRO], ['No intervalo', r.INTERVALO], ['Já saiu', r.JA_SAIU], ['Ainda sem batida', r.SEM_BATIDA], ['Conferir', r.CONFERIR + r.SAIU_OU_INTERVALO + r.INCOMPLETO], ['Com alerta', r.comAlerta]];
      quadro.forEach(([t, v]) => { const c = el('div', 'pao-card'); c.appendChild(el('b', null, String(v))); c.appendChild(el('span', null, t)); ui.resumo.appendChild(c); });
      const av = d.resultado.avaliacao;
      [av.atrasoJornadaIntervalo, av.folga].concat(d.resultado.avisos).forEach((t) => ui.avisos.appendChild(el('p', 'pao-aviso', t)));
      const linhas = d.resultado.linhas.filter((l) => passaFiltro(st.filtro, l));
      if (!linhas.length) { ui.rol.appendChild(el('p', 'pao-vazio', 'Nenhuma pessoa neste filtro.')); return; }
      const tab = el('table', 'pao-tab');
      const cab = el('tr'); ['Pessoa', 'Loja', 'Situação', 'Batidas', 'Entrada', 'Intervalo', 'Saída', 'Alertas / conferência'].forEach((t) => cab.appendChild(el('th', null, t)));
      const th = el('thead'); th.appendChild(cab); tab.appendChild(th);
      const tb = el('tbody');
      linhas.forEach((l) => {
        const tr = el('tr');
        const cel = (rot, t, cls) => { const c = el('td', cls, t); c.setAttribute('data-rot', rot); tr.appendChild(c); return c; };
        cel('Pessoa', l.nome); cel('Loja', l.unidade);
        cel('Situação', l.rotulo, 'pao-sit pao-sit-' + l.classe);
        cel('Batidas', l.n === null ? '—' : String(l.n) + (l.impar ? ' (ímpar)' : ''));
        cel('Entrada', l.entrada || '—');
        cel('Intervalo', l.intervaloSaida ? l.intervaloSaida + ' → ' + (l.intervaloVolta || 'ainda fora') : '—');
        cel('Saída', l.saida || (l.segundaBatida ? l.segundaBatida + ' (saída ou intervalo)' : '—'));
        const c = cel('Alertas / conferência', '', 'pao-alertas');
        c.appendChild(el('div', 'pao-expl', l.explicacao));
        l.alertas.forEach((a) => c.appendChild(el('div', 'pao-alerta', 'CONFERIR · ' + a.texto)));
        if (l.lidoHaMin !== null) c.appendChild(el('div', 'pao-lido', 'lido há ' + l.lidoHaMin + ' min'));
        tb.appendChild(tr);
      });
      tab.appendChild(tb); ui.rol.appendChild(tab);
    }

    function pararRelogio() { if (st.cancelar) { st.cancelar(); st.cancelar = null; } }
    function ligarRelogio() {
      pararRelogio();
      if (!st.ativo || !deps.temporizador || !deps.visivel() || st.dia !== deps.hoje()) return;
      st.cancelar = deps.temporizador(() => {
        if (!st.ativo || !deps.visivel() || st.dia !== deps.hoje()) { pararRelogio(); return; }
        if (st.fase === 'carregando') return;
        carregar(true);
      }, INTERVALO_ATUALIZACAO_MS);
    }
    function sincronizarRelogio() {
      if (!st.ativo || !deps.visivel() || st.dia !== deps.hoje()) pararRelogio();
      else if (!st.cancelar) ligarRelogio();
    }

    async function guarda(fn) {
      let r; try { r = await deps.rpc(fn); } catch (e) { return 'erro'; }
      if (r.status === 401) return 'sessao';
      if (!r.ok) return 'erro';
      let b; try { b = await r.json(); } catch (e) { return 'erro'; }
      return b === true ? 'sim' : 'nao';
    }
    async function buscarBatidas(dia) {
      try { return await deps.consultar(batidasPath(dia, true)); }
      catch (e) { if (!colunaHorariosAusente(e)) throw e; return deps.consultar(batidasPath(dia, false)); }
    }
    async function fonteOpcional(caminho, limite) {   // falha não-401 => fonte indisponível (nunca vira "sem ausência")
      try { const r = await deps.consultar(caminho); if (!Array.isArray(r) || (limite && r.length >= limite)) return { ok: false, lista: [] }; return { ok: true, lista: r }; }
      catch (e) { if (classificaErro(e) === 'sessao') throw e; return { ok: false, lista: [] }; }
    }

    // silencioso=true: atualização automática; mantém a tela atual até a resposta chegar
    async function carregar(silencioso) {
      const g = ++st.gen;
      const vivo = () => g === st.gen && st.ativo;
      const falha = (fase, msg) => { if (!vivo()) return; st.dados = null; st.fase = fase; st.msg = msg || ''; desenhar(); };
      if (!M.dataReal(st.dia)) { st.dados = null; st.fase = 'diainvalido'; st.msg = ''; desenhar(); return; }
      const sid = deps.sessaoId();
      if (!sid) return falha('sessao');
      if (!silencioso) { st.dados = null; st.fase = 'carregando'; st.msg = ''; desenhar(); }
      const dia = st.dia;
      const [a, b] = await Promise.all([guarda('pode_ver_pessoal'), guarda('pode_cadastrar_pessoal')]);
      if (!vivo()) return;
      if (deps.sessaoId() !== sid) return falha('sessao');
      if ([a, b].includes('sessao')) { if (deps.sessaoVencida) deps.sessaoVencida(); return falha('sessao'); }
      if ([a, b].includes('erro')) return falha('erro');
      if ([a, b].includes('nao')) return falha('semacesso');
      let info = null; try { info = await deps.lojaCarregar(); } catch (e) { info = null; }
      if (!vivo()) return;
      const atual = deps.lojaAtual();
      if (!info || !Array.isArray(info.lojas) || !info.lojas.length || typeof atual !== 'string' || !info.lojas.includes(atual)) { st.lojas = []; st.loja = null; return falha('semloja'); }
      st.lojas = info.lojas.filter((l) => typeof l === 'string'); st.loja = atual;
      let pessoas, batidas, aus, oco;
      try {
        [pessoas, batidas, aus, oco] = await Promise.all([deps.consultar(PESSOAS_PATH), buscarBatidas(dia), fonteOpcional(ausenciaPath(dia), LIMITE_AUSENCIA), fonteOpcional(ocorrenciaPath(dia), 0)]);
      } catch (e) { if (!vivo()) return; return falha(classificaErro(e) === 'sessao' ? 'sessao' : 'erro'); }
      if (!vivo()) return;
      if (deps.sessaoId() !== sid || st.dia !== dia || deps.lojaAtual() !== atual) return;
      if (!Array.isArray(pessoas) || !Array.isArray(batidas)) return falha('dadosinvalidos');
      let resultado;
      try {
        resultado = M.cruzar({
          pessoas, batidas, ausencias: aus.lista, ocorrencias: oco.lista, dia, consultadoEm: deps.agora(), loja: atual, redeOk: info.lojas.includes('REDE'),
          fontes: { ausencias: aus.ok, ocorrencias: oco.ok }, escalaDia: deps.escalaDia ? deps.escalaDia(dia) : null, dowConvencao: deps.dowConvencao || null,
        });
      } catch (e) { return falha('dadosinvalidos'); }
      if (!resultado.linhas.length) { st.dados = null; st.fase = 'semcadastro'; desenhar(); return; }
      st.dados = { resultado }; st.fase = 'ok'; desenhar();
    }
    function recomecar() { st.gen++; st.dados = null; st.fase = 'carregando'; desenhar(); return carregar(false); }

    return {
      st, carregar, recomecar, desenhar,
      entrar() {
        st.ativo = true; if (!st.dia) st.dia = deps.hoje();
        montar();
        if (!st.ligado) {
          st.ligado = true;
          deps.aoMudarLoja(() => { if (st.ativo) recomecar(); });
          if (deps.aoMudarSessao) deps.aoMudarSessao(() => { if (st.ativo) recomecar(); });
          if (deps.aoMudarVisibilidade) deps.aoMudarVisibilidade(() => sincronizarRelogio());
        }
        ligarRelogio();
        return recomecar();
      },
      sair() { st.ativo = false; st.gen++; pararRelogio(); },
    };
  }

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
      visivel: () => { const v = document.getElementById('modulo-pao'); return !!v && v.style.display !== 'none' && !document.hidden; },
      temporizador: (fn, ms) => { const h = setInterval(fn, ms); return () => clearInterval(h); },
      aoMudarVisibilidade: (fn) => {
        document.addEventListener('visibilitychange', fn);
        const v = document.getElementById('modulo-pao');
        const o = v && typeof MutationObserver !== 'undefined' ? new MutationObserver(fn) : null;
        if (o) o.observe(v, { attributes: true, attributeFilter: ['style', 'class', 'hidden'] });
        return () => { document.removeEventListener('visibilitychange', fn); if (o) o.disconnect(); };
      },
      escalaDia: null,      // objeto futuro (escala diária): hoje não existe no ERP
      dowConvencao: null,   // 'DOM0' | 'SEG1': escolha do Fabio
    };
  }
  function entrarPesPontoAoVivo() { if (!inst) inst = criar(depsPadrao()); return inst.entrar(); }

  return Object.assign({}, M, { criar, entrarPesPontoAoVivo, PESSOAS_PATH, batidasPath, ausenciaPath, ocorrenciaPath, colunaHorariosAusente, passaFiltro, INTERVALO_ATUALIZACAO_MS });
});
