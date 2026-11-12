// PONTO AO VIVO (rota pao, módulo Pessoas). Só LEITURA. Fonte principal: leitura direta do Flash + refeições do Saipos, via a Edge
// Function fabio-ponto-leitura (GET com o JWT da sessão). Ausências e ocorrências (rh_flash_ausencia, rh_ocorrencia) são lidas direto.
// O modo antigo em lote (rh_pessoa + rh_flash_batida) só roda quando a leitura direta não é injetada (testes/legado).
// A lista tem só quem tem batida válida e vínculo ativo; cada coluna de horário diz se é exata, "sem detalhe" ou ambígua; a fonte
// e o frescor ficam sempre visíveis; refeição vem da resposta direta (indisponível = a tela diz, sem afirmar nada).
// Não escreve, não guarda dado de pessoa no navegador, usa só textContent (nunca innerHTML). Regras ficam em ponto-ao-vivo-modelo.js.
// Atualiza sozinho a cada 60 s SOMENTE enquanto a tela está ativa, visível e o dia consultado é o dia operacional atual.
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
  // cargo_confianca NÃO está provado em rh_pessoa (só existia no cadastro antigo): pede, e se o servidor recusar a coluna volta ao mínimo
  const PESSOAS_PATH_COM_CONFIANCA = PESSOAS_PATH.replace(',folga_fixa_dow', ',folga_fixa_dow,cargo_confianca');
  // último lido_em da tabela inteira: só para dizer "a última leitura foi quando" quando o dia consultado não tem linha nenhuma
  const ULTIMA_LEITURA_PATH = 'rh_flash_batida?select=lido_em&lido_em=not.is.null&order=lido_em.desc&limit=1';
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

  // a lista só tem quem tem batida válida: não existe filtro "sem batida" (quem não bateu, está de folga ou saiu do quadro não aparece)
  const FILTROS = Object.freeze([['TODOS', 'Todos com batida'], ['DENTRO', 'Dentro da loja'], ['INTERVALO', 'No intervalo'], ['JA_SAIU', 'Já saiu'], ['CONFERIR', 'Conferir / alertas']]);
  const NOTA_FONTE = 'Fonte: rh_flash_batida, gravada em lotes pela coleta existente (não é leitura ao vivo do relógio). ';
  const passaFiltro = (f, l) => f === 'TODOS' || (f === 'CONFERIR' ? (l.alertas.length > 0 || ['CONFERIR', 'SAIU_OU_INTERVALO', 'INCOMPLETO'].includes(l.situacao)) : l.situacao === f);

  // ---------- textos (puros; testáveis) ----------
  const fmtIdade = (min) => (min >= 120 ? Math.floor(min / 60) + ' h' : min + ' min');
  const mais1 = (c) => (c.mais1 ? ' (+1 dia)' : '');
  function textoCelula(c) {
    if (c.estado === 'exato') return c.v + mais1(c);
    if (c.estado === 'sem_detalhe') return 'sem detalhe';
    if (c.estado === 'ambigua') return c.v ? c.v + mais1(c) + ' (saída ou intervalo)' : 'indefinido';
    return '—';
  }
  function textoRefeicao(r) {
    if (r.estado === 'indisponivel') return 'fonte indisponível';
    if (r.estado === 'pendente') return 'dados pendentes';
    if (r.estado === 'nao_lancou') return 'não localizada na leitura';
    if (r.estado === 'sem_vinculo') return 'sem vínculo de refeição';
    return r.itens.map((i) => (i.quantidade > 1 ? i.quantidade + '× ' : '') + (i.tipo || 'refeição') + (i.produto ? ' ' + i.produto : '') + (i.hora ? ' às ' + i.hora : '')).join(' · ');
  }
  function textoBatidas(l) {
    if (l.todasBatidas) return 'todas: ' + l.todasBatidas.map((b) => b.v + (b.mais1 ? ' (+1)' : '')).join(' · ');
    if (l.n >= 3 && l.ultimaBatida) return 'última: ' + l.ultimaBatida.v + mais1(l.ultimaBatida);
    return '';
  }
  function textoFonte(f) {
    let t = f.direta ? 'Fonte: ' + f.direta + ' (relógio consultado agora; repete a cada 60 s no máximo). ' : NOTA_FONTE;
    const lei = f.ultimaLeituraRotulo ? f.ultimaLeituraRotulo + (f.idadeLeituraMin !== null ? ' (há ' + fmtIdade(f.idadeLeituraMin) + ')' : '') : null;
    if (f.direta) {
      t += f.linhasDoDia ? 'Última leitura: ' + (lei || 'sem data') + '. ' : 'Nenhuma batida lida neste dia (leitura bem-sucedida: ' + (lei || 'agora') + '). ';
      if (f.detalhe === 'completo') t += 'Horário exato de todas as batidas disponível. ';
    } else if (f.semLeituraDoDia) {
      t += 'SEM LEITURA DO DIA: nenhuma linha desta tabela para o dia consultado. ' + (lei ? 'Última leitura da tabela: ' + lei + '. ' : 'Última leitura da tabela: desconhecida. ') + 'Isto não significa que ninguém bateu.';
    } else {
      t += 'Última leitura do dia: ' + (lei || 'sem data de leitura') + '. ';
      if (f.detalhe === 'nenhum') t += 'Esta fonte não traz o horário do intervalo (só entrada, última batida e quantidade): as colunas de intervalo mostram "sem detalhe", nunca um horário deduzido. ';
      else if (f.detalhe === 'parcial') t += 'Horário de todas as batidas disponível para ' + f.comDetalhe + ' de ' + (f.comDetalhe + f.semDetalhe) + ' pessoa(s); nas demais, "sem detalhe". ';
      else if (f.detalhe === 'completo') t += 'Horário exato de todas as batidas disponível. ';
    }
    if (f.refeicao !== 'disponivel') t += f.direta ? 'Refeição: leitura indisponível agora (nada foi afirmado).' : 'Refeição: fonte ainda não ligada (sem vínculo pessoa ↔ lançamento).';
    if (f.virada === 'indisponivel') t += ' Madrugada: leitura de ontem indisponível.';
    return t.trim();
  }

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
      ui.sub = el('p', 'pao-sub', 'Somente leitura. Lista só quem tem batida válida no dia e vínculo ativo. Horário só aparece quando a fonte o traz; ausência de batida não é falta nem atraso.'); raiz.appendChild(ui.sub);
      const barra = el('div', 'pao-barra');
      ui.dia = el('input'); ui.dia.type = 'date'; ui.dia.setAttribute('aria-label', 'Dia'); barra.appendChild(ui.dia);
      ui.selLoja = el('select'); ui.selLoja.setAttribute('aria-label', 'Loja'); barra.appendChild(ui.selLoja);
      ui.selFiltro = el('select'); ui.selFiltro.setAttribute('aria-label', 'Situação');
      FILTROS.forEach(([v, t]) => { const o = el('option', null, t); o.value = v; ui.selFiltro.appendChild(o); });
      barra.appendChild(ui.selFiltro);
      ui.btn = el('button', 'pao-btn', 'Atualizar'); ui.btn.type = 'button'; barra.appendChild(ui.btn);
      raiz.appendChild(barra);
      ui.status = el('div', 'pao-status'); raiz.appendChild(ui.status);
      ui.fonte = el('div', 'pao-fonte'); raiz.appendChild(ui.fonte);
      ui.resumo = el('div', 'pao-resumo'); raiz.appendChild(ui.resumo);
      ui.avisos = el('div', 'pao-avisos'); raiz.appendChild(ui.avisos);
      ui.rol = el('div', 'pao-rol'); raiz.appendChild(ui.rol);
      ui.dia.addEventListener('change', () => { st.dia = ui.dia.value; st.seguirOp = false; sincronizarRelogio(); recomecar(); });
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
      ui.rol.replaceChildren(); ui.resumo.replaceChildren(); ui.avisos.replaceChildren(); ui.fonte.replaceChildren();
      ui.dia.value = st.dia || '';
      ui.selLoja.replaceChildren();
      st.lojas.forEach((l) => { const o = el('option', null, l); o.value = l; ui.selLoja.appendChild(o); });
      ui.selLoja.value = st.loja || '';
      ui.status.className = 'pao-status' + (['erro', 'sessao', 'dadosinvalidos', 'diainvalido'].includes(st.fase) ? ' pao-erro' : '');
      ui.status.textContent = st.fase === 'ok' ? '' : (MSG[st.fase] || '') + (st.msg ? ' ' + st.msg : '');
      if (st.fase !== 'ok' || !st.dados) return;
      const d = st.dados, res = d.resultado, r = res.resumo, f = res.fonte;
      const tf = textoFonte(f); ui.fonte.className = 'pao-fonte' + (f.semLeituraDoDia ? ' pao-fonte-sem' : '');
      ui.fonte.textContent = tf;
      // sem leitura do dia: NENHUM card (zero seria falso: "0 na loja" não é "ninguém na loja")
      if (!f.semLeituraDoDia) {
        const n = r.naLista;
        const quadro = [['Dentro da loja', n.DENTRO], ['No intervalo', n.INTERVALO], ['Já saiu', n.JA_SAIU], ['Conferir', n.SAIU_OU_INTERVALO + n.INCOMPLETO], ['Com alerta', r.comAlertaListadas]];
        quadro.forEach(([t, v]) => { const c = el('div', 'pao-card'); c.appendChild(el('b', null, String(v))); c.appendChild(el('span', null, t)); ui.resumo.appendChild(c); });
      }
      const av = res.avaliacao;
      const textos = f.direta ? [] : [av.atrasoJornadaIntervalo, av.folga];   // avisos estáticos técnicos só no modo lote; na leitura direta não aparecem
      if (!av.cargoConfianca) textos.push('Cargo de confiança: o cadastro lido não traz esse campo; o filtro por cargo NÃO foi aplicado (só "não usa ponto" e vínculo).');
      textos.concat(res.avisos).forEach((t) => ui.avisos.appendChild(el('p', 'pao-aviso', t)));
      const linhas = res.listadas.filter((l) => passaFiltro(st.filtro, l));
      if (!linhas.length) {
        ui.rol.appendChild(el('p', 'pao-vazio', f.semLeituraDoDia ? 'Sem leitura do dia: não há como listar quem bateu. Isto não significa que ninguém bateu.' : 'Nenhuma pessoa com batida válida neste filtro.'));
        return;
      }
      const tab = el('table', 'pao-tab');
      const cab = el('tr'); ['Pessoa', 'Loja', 'Situação', 'Entrada', 'Saiu intervalo', 'Voltou intervalo', 'Saída', 'Refeição', 'Batidas', 'Alertas / conferência'].forEach((t) => cab.appendChild(el('th', null, t)));
      const th = el('thead'); th.appendChild(cab); tab.appendChild(th);
      const tb = el('tbody');
      linhas.forEach((l) => {
        const tr = el('tr');
        const cel = (rot, t, cls) => { const c = el('td', cls, t); c.setAttribute('data-rot', rot); tr.appendChild(c); return c; };
        cel('Pessoa', l.nome + (l.virada ? ' (turno de ' + l.diaOrigem.slice(8, 10) + '/' + l.diaOrigem.slice(5, 7) + ')' : '')); cel('Loja', l.unidade);
        cel('Situação', l.rotulo, 'pao-sit pao-sit-' + l.classe);
        [['Entrada', 'entrada'], ['Saiu intervalo', 'saiuIntervalo'], ['Voltou intervalo', 'voltouIntervalo'], ['Saída', 'saida']].forEach(([rot, k]) => {
          const c = l.celulas[k]; cel(rot, textoCelula(c, k), 'pao-h pao-h-' + c.estado);
        });
        cel('Refeição', textoRefeicao(l.refeicao), 'pao-ref pao-ref-' + l.refeicao.estado);
        const cb = cel('Batidas', String(l.n) + (l.impar ? ' (ímpar)' : ''), 'pao-bat');
        const todas = textoBatidas(l); if (todas) cb.appendChild(el('div', 'pao-lido', todas));
        const c = cel('Alertas / conferência', '', 'pao-alertas');
        c.appendChild(el('div', 'pao-expl', l.explicacao));
        l.alertas.forEach((a) => c.appendChild(el('div', 'pao-alerta', 'CONFERIR · ' + a.texto)));
        if (l.lidoHaMin !== null) c.appendChild(el('div', 'pao-lido', 'lido há ' + fmtIdade(l.lidoHaMin)));
        tb.appendChild(tr);
      });
      tab.appendChild(tb); ui.rol.appendChild(tab);
    }

    // modo direto (Água Verde): "hoje" da tela é o dia OPERACIONAL (antes das 07:00 ainda é ontem); modo lote segue o dia civil
    const hojeTela = () => (deps.leituraDireta && deps.diaOperacional ? deps.diaOperacional() : deps.hoje());
    function pararRelogio() { if (st.cancelar) { st.cancelar(); st.cancelar = null; } }
    function ligarRelogio() {
      pararRelogio();
      if (!st.ativo || !deps.temporizador || !deps.visivel() || st.dia !== hojeTela()) return;
      st.cancelar = deps.temporizador(() => {
        // dia operacional virou (07:00) e a pessoa não escolheu outra data: acompanha o novo dia operacional
        if (st.ativo && st.seguirOp && deps.visivel() && st.dia !== hojeTela()) st.dia = hojeTela();
        if (!st.ativo || !deps.visivel() || st.dia !== hojeTela()) { pararRelogio(); return; }
        if (st.fase === 'carregando') return;
        carregar(true);
      }, INTERVALO_ATUALIZACAO_MS);
    }
    function sincronizarRelogio() {
      if (!st.ativo || !deps.visivel() || st.dia !== hojeTela()) pararRelogio();
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
    async function buscarPessoas() {
      if (st.semConfianca) return deps.consultar(PESSOAS_PATH);   // já recusada nesta sessão da tela: não repete o pedido falho a cada 60 s
      try { return await deps.consultar(PESSOAS_PATH_COM_CONFIANCA); }
      catch (e) { if (!e || e.status !== 400 || typeof e.message !== 'string' || !/cargo_confianca/.test(e.message)) throw e; st.semConfianca = true; return deps.consultar(PESSOAS_PATH); }
    }
    // dia anterior só na madrugada de HOJE (virada): falha não-401 => fonte indisponível (a tela avisa)
    async function anteriorOpcional(dia, agoraIso) {
      const a = M.brtAgora(agoraIso);
      if (!a || a.data !== dia || a.min >= M.LIMITE_VIRADA_MIN) return { pedido: false, ok: false, lista: [] };
      try { const r = await buscarBatidas(M.diaAnterior(dia)); return Array.isArray(r) ? { pedido: true, ok: true, lista: r } : { pedido: true, ok: false, lista: [] }; }
      catch (e) { if (classificaErro(e) === 'sessao') throw e; return { pedido: true, ok: false, lista: [] }; }
    }
    async function fonteOpcional(caminho, limite) {   // falha não-401 => fonte indisponível (nunca vira "sem ausência")
      try { const r = await deps.consultar(caminho); if (!Array.isArray(r) || (limite && r.length >= limite)) return { ok: false, lista: [] }; return { ok: true, lista: r }; }
      catch (e) { if (classificaErro(e) === 'sessao') throw e; return { ok: false, lista: [] }; }
    }

    // contrato da leitura direta (Edge Function fabio-ponto-leitura): qualquer desvio => "resposta inesperada", nada exibido
    function respostaValida(r, dia) {
      const L = (x) => Array.isArray(x);
      return ehObj(r) && r.dia === dia && L(r.pessoas) && L(r.batidas) && L(r.batidasAnterior) && ehObj(r.anterior) && typeof r.anterior.ok === 'boolean'
        && ehObj(r.refeicoes) && typeof r.refeicoes.disponivel === 'boolean' && ehObj(r.refeicoes.porPessoa) && typeof r.consultadoEm === 'string' && M.brtAgora(r.consultadoEm) !== null
        && (r.avisos === undefined || L(r.avisos)) && (r.jornadas === undefined || ehObj(r.jornadas));
    }
    async function carregarDireto(vivo, falha, sid, dia, atual, info) {
      if (st.abort) st.abort.abort();
      const ac = typeof AbortController !== 'undefined' ? new AbortController() : null; st.abort = ac;
      let resp, aus, oco;
      try {
        [resp, aus, oco] = await Promise.all([deps.leituraDireta({ dia, unidade: atual, signal: ac ? ac.signal : undefined }), fonteOpcional(ausenciaPath(dia), LIMITE_AUSENCIA), fonteOpcional(ocorrenciaPath(dia), 0)]);
      } catch (e) { if (!vivo()) return; return falha(classificaErro(e) === 'sessao' ? 'sessao' : 'erro', 'Leitura direta do ponto indisponível; nenhuma outra fonte foi usada no lugar.'); }
      if (!vivo()) return;
      if (deps.sessaoId() !== sid || st.dia !== dia || deps.lojaAtual() !== atual) return;
      if (!respostaValida(resp, dia)) return falha('dadosinvalidos');
      const refDe = (x) => (ehObj(x) && x.disponivel === true && ehObj(x.porPessoa) ? { disponivel: true, porPessoa: x.porPessoa, identificados: Array.isArray(x.identificados) ? x.identificados : undefined, indisponiveis: Array.isArray(x.indisponiveis) ? x.indisponiveis : undefined } : null);
      let resultado;
      try {
        resultado = M.cruzar({
          pessoas: resp.pessoas, batidas: resp.batidas, batidasAnterior: resp.batidasAnterior, ausencias: aus.lista, ocorrencias: oco.lista, dia, consultadoEm: resp.consultadoEm,
          loja: atual, redeOk: info.lojas.includes('REDE'), fontes: { ausencias: aus.ok, ocorrencias: oco.ok, anterior: resp.anterior.ok === true },
          escalaDia: deps.escalaDia ? deps.escalaDia(dia) : null, dowConvencao: deps.dowConvencao || null,
          fonteDireta: { lidoEm: typeof resp.lidoEm === 'string' ? resp.lidoEm : resp.consultadoEm, rotulo: resp.fonte }, avisosExtras: resp.avisos || [],
          refeicoes: refDe(resp.refeicoes), refeicoesAnterior: refDe(resp.refeicoesAnterior), modoAguaVerde: true, jornadas: ehObj(resp.jornadas) ? resp.jornadas : null,
        });
      } catch (e) { return falha('dadosinvalidos'); }
      if (!resultado.linhas.length) { st.dados = null; st.fase = 'semcadastro'; desenhar(); return; }
      st.dados = { resultado }; st.fase = 'ok'; desenhar();
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
      if (deps.leituraDireta) return carregarDireto(vivo, falha, sid, dia, atual, info);   // fonte própria: Flash direto + Saipos (sem cair no lote)
      let pessoas, batidas, aus, oco, ult, ant;
      const consultadoEm = deps.agora();
      try {
        [pessoas, batidas, aus, oco, ult, ant] = await Promise.all([buscarPessoas(), buscarBatidas(dia), fonteOpcional(ausenciaPath(dia), LIMITE_AUSENCIA), fonteOpcional(ocorrenciaPath(dia), 0),
          fonteOpcional(ULTIMA_LEITURA_PATH, 0), anteriorOpcional(dia, consultadoEm)]);
      } catch (e) { if (!vivo()) return; return falha(classificaErro(e) === 'sessao' ? 'sessao' : 'erro'); }
      if (!vivo()) return;
      if (deps.sessaoId() !== sid || st.dia !== dia || deps.lojaAtual() !== atual) return;
      if (!Array.isArray(pessoas) || !Array.isArray(batidas)) return falha('dadosinvalidos');
      let resultado;
      try {
        resultado = M.cruzar({
          pessoas, batidas, batidasAnterior: ant.lista, ausencias: aus.lista, ocorrencias: oco.lista, dia, consultadoEm, loja: atual, redeOk: info.lojas.includes('REDE'),
          fontes: { ausencias: aus.ok, ocorrencias: oco.ok, anterior: ant.ok }, escalaDia: deps.escalaDia ? deps.escalaDia(dia) : null, dowConvencao: deps.dowConvencao || null,
          ultimaLeituraGeral: ult.ok && ult.lista[0] && typeof ult.lista[0].lido_em === 'string' ? ult.lista[0].lido_em : null,
          refeicoes: deps.refeicoes ? deps.refeicoes(dia) : null,   // fonte futura (nenhuma ligada hoje): sem ela a coluna diz "fonte indisponível"
        });
      } catch (e) { return falha('dadosinvalidos'); }
      if (!resultado.linhas.length) { st.dados = null; st.fase = 'semcadastro'; desenhar(); return; }
      st.dados = { resultado }; st.fase = 'ok'; desenhar();
    }
    function recomecar() { st.gen++; st.dados = null; st.fase = 'carregando'; desenhar(); return carregar(false); }

    return {
      st, carregar, recomecar, desenhar,
      entrar() {
        st.ativo = true; if (!st.dia) { st.dia = hojeTela(); st.seguirOp = true; }
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
      sair() { st.ativo = false; st.gen++; pararRelogio(); if (st.abort) { st.abort.abort(); st.abort = null; } },
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
      diaOperacional: () => M.diaOperacionalDe(new Date().toISOString()),   // antes das 07:00 (Brasília) ainda é o dia operacional de ontem
      refeicoes: null,      // modo antigo (lote) não tem refeição: coluna "fonte indisponível"; no modo direto a refeição vem na própria resposta
      // leitura separada enquanto a tela está aberta: só GET à Edge Function, com o JWT da pessoa logada (nenhum segredo no navegador)
      leituraDireta: async ({ dia, unidade, signal }) => {
        const s = rmbSessao();
        if (!s || !s.access_token) throw Object.assign(new Error('Sessão vencida ou ausente (401)'), { status: 401 });
        const lim = new AbortController(); const h = setTimeout(() => lim.abort(), 25000);
        const cancela = () => lim.abort(); if (signal) signal.addEventListener('abort', cancela);
        try {
          const r = await fetch(SUPABASE_URL + '/functions/v1/fabio-ponto-leitura?dia=' + encodeURIComponent(dia) + '&unidade=' + encodeURIComponent(unidade),
            { method: 'GET', headers: { apikey: SUPABASE_ANON_KEY, Authorization: 'Bearer ' + s.access_token }, signal: lim.signal });
          if (r.status === 401) throw Object.assign(new Error('Sessão vencida (401)'), { status: 401 });
          if (!r.ok) throw Object.assign(new Error('HTTP ' + r.status), { status: r.status });
          return await r.json();
        } finally { clearTimeout(h); if (signal) signal.removeEventListener('abort', cancela); }
      },
    };
  }
  function entrarPesPontoAoVivo() { if (!inst) inst = criar(depsPadrao()); return inst.entrar(); }

  return Object.assign({}, M, { criar, entrarPesPontoAoVivo, PESSOAS_PATH, PESSOAS_PATH_COM_CONFIANCA, ULTIMA_LEITURA_PATH, batidasPath, ausenciaPath, ocorrenciaPath, colunaHorariosAusente, passaFiltro, INTERVALO_ATUALIZACAO_MS, FILTROS, textoCelula, textoRefeicao, textoBatidas, textoFonte });
});

