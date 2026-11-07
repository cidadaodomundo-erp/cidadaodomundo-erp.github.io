// NÚCLEO DE VENDAS (05/11/2026, bloco 6 da migração): MOVIDO do docs/dashboard.html, sem mudar nada.
// A carga de vendas do iFood (carregar), os domínios (LOJAS, UNIDADES, DATAS, ROWS...), a barra do topo
// (perímetro, período, marcas, Limpar filtros), as lojas ativas (activeLojas, activeUnidades) e as linhas
// filtradas (linhasFiltradas, linhasCancelamentoFiltradas, somaConciliacaoRaw, periodoAnterior).
// Quem usa: o painel antigo e as páginas do Canal. A página define renderAll() e mostrarModulo(); este arquivo
// chama as duas só quando a pessoa mexe num filtro. Carregar DEPOIS do <div id="barraVendas"> e antes do script da página.

// A barra do topo entra no lugar do <div id="barraVendas"> antes de tudo: o resto deste arquivo lê os campos dela.
(function () {
  const lugar = document.getElementById('barraVendas');
  if (lugar) lugar.outerHTML = `
    <!-- Perimetro de gestao (12/08/2026): Boqueirao e de outra gestao (Loana).
         Isso NAO e filtro — e o unico controle global do painel. Padrao =
         Minha gestao (13 lojas); "Rede completa" mostra chip de aviso e
         esconde farol de metas (calibradas para Minha gestao). -->
    <div id="perimetroBar" style="display:flex; flex-wrap:wrap; justify-content:center; gap:8px; align-items:center; margin-bottom:12px;"></div>

    <!-- A faixa de recados (16/10/2026) saiu em 24/10/2026: aviso à equipe vai só pelo WhatsApp do robô (dono). -->

    <!-- 01/11/2026 (dono: adaptar ao celular): até 760 px o número vem primeiro; período, marcas e a explicação ficam atrás deste botão -->
    <button class="preset-btn" type="button" id="filtrosCel" onclick="filtrosCelTroca()"></button>
    <div class="periodo-presets" id="periodoPresets"></div>

    <!-- De/Ate viraram ESTADO INTERNO (etapa 2, 12/08/2026): as janelas por
         modulo escrevem aqui e todo o codigo antigo continua lendo. Datas
         livres na tela eram convite a recorte sem sentido (semana cheia vs
         meia semana). Recorte exotico: pedir ao Claude. -->
    <div class="filters" style="margin-bottom:10px; display:none;">
      <label>De <input type="date" id="fDataIni"></label>
      <label>Até <input type="date" id="fDataFim"></label>
    </div>

    <div id="filtrosTopo" style="display:flex; flex-wrap:wrap; justify-content:center; align-items:flex-start; gap:8px;">
      <div class="topnav" id="topnav" style="margin-bottom:0;"></div>
      <details class="lojadrop" style="margin-bottom:0;">
        <summary id="lojaSummary">Marcas (loja): todas</summary>
        <div class="loja-options" id="lojaOptions"></div>
      </details>
    </div>

    <!-- Dia da semana e Turno APOSENTADOS como filtro (12/08/2026): eram os
         campeoes do "filtro fantasma" — um 'so JANTAR' esquecido distorcia a
         home e o placar em silencio. Viram analise no futuro modulo Atrasos e
         turnos. Escondidos (nao removidos) para o codigo dos sets continuar
         inicializando com tudo marcado. -->
    <div style="display:none;">
      <details class="lojadrop filtro-dropdown">
        <summary id="fDiaSummary">Dia da semana: todos</summary>
        <div class="loja-options" id="fDiaOptions"></div>
      </details>
      <details class="lojadrop filtro-dropdown">
        <summary id="fTurnoSummary">Turno: todos</summary>
        <div class="loja-options" id="fTurnoOptions"></div>
      </details>
    </div>

    <div id="limparFiltrosBar" style="display:flex; justify-content:center; margin-bottom:20px; border-bottom:1px solid #34332f; padding-top:20px; padding-bottom:20px;">
      <button class="preset-btn" onclick="resetFiltros()">Limpar filtros</button>
    </div>

`;
})();

// ------------------------------------------------------------------
// Dominios fixos do negocio (ordem logica, nao alfabetica)
// ------------------------------------------------------------------
const TURNOS = ["MADRUGADA", "ALMOÇO", "CAFÉ DA TARDE", "JANTAR"];
const DIAS = ["SEGUNDA", "TERÇA", "QUARTA", "QUINTA", "SEXTA", "SÁBADO", "DOMINGO"];
const STATUS = ["CONCLUIDO", "CANCELADO", "CANCELAMENTO PARCIAL"];

// Remove os rotulos "(inicial)"/"(final)" do texto da semana, mantendo so as datas.
function formatarSemana(s) {
  return s.replace(' (inicial)', '').replace(' (final)', '');
}

// Preenchidos dinamicamente a partir dos dados reais (crescem a cada mes importado)
let LOJAS = [];
let UNIDADES = [];
let SEMANAS = [];
let MESES = [];
let ANOS = [];
let DATAS = [];
let TIPOS_PAGAMENTO = [];
// ROWS cols: loja,unidade,turno,semana,dia,data,status,n,valor_itens,itens_cancelados,frete_cliente,incentivo_ifood,incentivo_rede,promo_loja,taxa_servico,taxas_comissoes,frete_sob_demanda,valor_liquido,tipo_pagamento
let ROWS = [];
// CONCILIACAO cols: loja, data (string 'YYYY-MM-DD'), grupo, valor — lancamentos novos da conciliacao financeira
let CONCILIACAO = [];
// MOTIVOS cols: loja, turno, semana, dia, data, responsavel (string), n, valor — cancelamentos por motivo
let MOTIVOS = [];
// PROMOCOES cols: loja, competencia ('YYYY-MM'), estrategia, pedidos, vendas, invLoja, invIfood
let PROMOCOES = [];

let activeUnidades = new Set();

// ------------------------------------------------------------------
// Carregamento inicial
// ------------------------------------------------------------------
async function carregar() {
  // 24/10/2026: as tres leituras grandes da abertura saem juntas (antes, uma esperava a outra)
  const concPromessa = consultarTudo("mv_conciliacao_agregado?select=nome_loja,data,grupo,valor&order=nome_loja,data,grupo");
  const gestaoPromessa = consultarTudo('dim_lojas?select=nome_loja,unidade,gestao');
  concPromessa.catch(() => {}); gestaoPromessa.catch(() => {});
  const agregado = await consultarTudo(
    // mv (pre-calculada) e nao vw: a view ao vivo soma fato_pedidos inteira a
    // cada visita e estourava os 3s de timeout do anon na partida a frio (erro
    // 57014 na primeira carga, achado do dono em 13/08/2026). O watch_and_import
    // recalcula a mv apos cada importacao — mesmo padrao da conciliacao.
    "mv_resumo_agregado?select=nome_loja,unidade,turno,semana,dia_semana,data,status,n,valor_itens,valor_itens_cancelados,taxa_entrega,incentivo_ifood,incentivo_rede,incentivo_loja,taxa_servico,taxas_comissoes,frete_sob_demanda,valor_liquido,tipo_pagamento" +
    "&order=nome_loja,turno,data,status,tipo_pagamento"
  );

  LOJAS = [...new Set(agregado.map(r => r.nome_loja))].sort();
  UNIDADES = [...new Set(agregado.map(r => r.unidade))].sort();

  // Perimetro de gestao: a regra mora em dim_lojas.gestao, nunca no codigo
  // (regra duplicada no front apodrece — licao das contestacoes).
  const gestaoRows = await gestaoPromessa;
  gestaoRows.forEach(r => { GESTAO_LOJA[r.nome_loja] = r.gestao; });
  UNIDADES_PROPRIAS = new Set(gestaoRows.filter(r => r.gestao !== 'terceiros').map(r => r.unidade));
  // Ordena pelo numero da semana (o texto comeca com "18 27/04 ..."), nao alfabeticamente.
  SEMANAS = [...new Set(agregado.map(r => r.semana))].sort((a,b) => parseInt(a,10) - parseInt(b,10));
  DATAS = [...new Set(agregado.map(r => r.data))].sort();
  MESES = [...new Set(agregado.map(r => r.data.slice(0,7)))].sort();
  ANOS = [...new Set(agregado.map(r => r.data.slice(0,4)))].sort();
  // Forma de pagamento pode vir em branco (forma nova, ainda nao mapeada no import) — nunca inventamos, so agrupamos a parte.
  TIPOS_PAGAMENTO = [...new Set(agregado.map(r => r.tipo_pagamento || 'NAO_MAPEADO'))].sort();

  ROWS = agregado.map(r => [
    LOJAS.indexOf(r.nome_loja),
    UNIDADES.indexOf(r.unidade),
    TURNOS.indexOf(r.turno),
    SEMANAS.indexOf(r.semana),
    DIAS.indexOf(r.dia_semana),
    DATAS.indexOf(r.data),
    STATUS.indexOf(r.status),
    r.n,
    Number(r.valor_itens),
    Number(r.valor_itens_cancelados),
    Number(r.taxa_entrega),
    Number(r.incentivo_ifood),
    Number(r.incentivo_rede),
    Number(r.incentivo_loja),
    Number(r.taxa_servico),
    Number(r.taxas_comissoes),
    Number(r.frete_sob_demanda),
    Number(r.valor_liquido),
    TIPOS_PAGAMENTO.indexOf(r.tipo_pagamento || 'NAO_MAPEADO'),
  ]);

  ROWS.forEach(r => { lojaToUnidade[r[0]] = r[1]; });

  // Lancamentos da conciliacao financeira usados no Bloco 2 (taxa de cartao, comissao sobre
  // vendas, mensalidade, anuncios, outros ajustes). So tem loja + data (nao tem turno/semana/dia
  // calculados aqui), entao esse valor respeita os filtros de loja/unidade e periodo, mas nao
  // Semana/Dia da semana/Turno.
  // Usa a versao materializada (pre-calculada): a view normal precisava classificar e somar
  // 400 mil+ lancamentos a cada abertura do painel e passou a estourar o tempo limite do
  // Supabase. A materializada e' atualizada automaticamente pelo watch_and_import.py.
  const conciliacao = await concPromessa;
  CONCILIACAO = conciliacao.map(r => [LOJAS.indexOf(r.nome_loja), r.data, r.grupo, Number(r.valor)]);

  // Metas oficiais (metas_kpi) carregadas ja no boot: qualquer modulo pinta o
  // farol nos cards sem depender de uma visita previa ao Indicadores. E a
  // MESMA fonte do placar — card e placar nunca podem discordar.
  METAS_KPI = await consultarTudo('metas_kpi?select=chave,nome,bloco,sentido,meta,meta2,unidade,descricao,ordem&ativo=eq.true&order=ordem');

  // Verba DIARIA de promocao por loja (12/09/2026): dado, nao constante. Tabela
  // pequena, carregada no boot para nao depender da ordem de entrada nos modulos.
  try {
    const vb = await consultarTudo('vw_verbas_promo?select=nome_loja,verba_total');
    VERBAS_PROMO = {}; vb.forEach(r => { VERBAS_PROMO[r.nome_loja] = Number(r.verba_total); });
  } catch (e) { VERBAS_PROMO = null; }   // cai na constante antiga

  // Cancelamentos (totais e parciais) classificados por categoria de motivo. Tem as mesmas
  // dimensoes de ROWS, entao respeita todos os filtros normalmente.
  // Promocoes: vem por PERIODO (o relatorio do iFood aceita mes ou recorte de dias).
  // Desde 10/08/2026 extraimos por ciclo semanal seg-dom, o mesmo do repasse do iFood.
  // So existe de junho/2026 em diante — o portal disponibiliza apenas 90 dias.
  const promos = await consultarTudo(
    "vw_promocoes_agregado?select=nome_loja,competencia,periodo_ini,periodo_fim,estrategia,pedidos,vendas,investimento_loja,investimento_ifood&order=nome_loja,periodo_ini,estrategia"
  );
  PROMOCOES = promos.map(r => [
    LOJAS.indexOf(r.nome_loja), r.competencia, r.estrategia,
    r.pedidos, Number(r.vendas), Number(r.investimento_loja), Number(r.investimento_ifood),
    r.periodo_ini, r.periodo_fim,
  ]);

  const motivos = await consultarTudo(
    "vw_cancelamentos_motivo?select=nome_loja,turno,semana,dia_semana,data,status,responsavel,n,valor&order=nome_loja,data"
  );
  MOTIVOS = motivos.map(r => [
    LOJAS.indexOf(r.nome_loja),
    TURNOS.indexOf(r.turno),
    SEMANAS.indexOf(r.semana),
    DIAS.indexOf(r.dia_semana),
    DATAS.indexOf(r.data),
    r.responsavel,
    r.n,
    Number(r.valor),
  ]);

  activeUnidades = new Set(unidadesVisiveis());
  await canalLojaPreparar();
}

// ------------------------------------------------------------------
// Filtros de topo (data, semana, dia, turno)
// ------------------------------------------------------------------
const fDataIni = document.getElementById('fDataIni');
const fDataFim = document.getElementById('fDataFim');

// Cada filtro de multipla escolha guarda um Set com os INDICES selecionados do seu dominio.
// Tudo selecionado (o padrao) equivale a "sem filtro" (igual ao "Todos" de antes).
const selecionados = {};

const FILTRO_DEFS = {
  // Semana / Mes / Ano foram removidos de proposito: diziam a mesma coisa que o periodo
  // De/Ate e podiam entrar em conflito com ele (era isso que a antiga funcao de
  // "sincronizar periodo" tentava remendar). O periodo agora tem uma fonte unica de verdade:
  // as datas De/Ate, com atalhos rapidos. Sobraram aqui so os recortes que NAO sao periodo.
  fDia: { dominio: () => DIAS, label: (v)=>v, nome: 'Dia da semana' },
  fTurno: { dominio: () => TURNOS, label: (v)=>v, nome: 'Turno' },
};

function montarDropdownMultiplo(id) {
  const dominio = FILTRO_DEFS[id].dominio();
  selecionados[id] = new Set(dominio.map((_,i)=>i));
  renderizarDropdownMultiplo(id);
}

function renderizarDropdownMultiplo(id) {
  const def = FILTRO_DEFS[id];
  const dominio = def.dominio();
  const set = selecionados[id];
  const todasMarcadas = set.size === dominio.length;
  let html = `<label><input type="checkbox" ${todasMarcadas?'checked':''} onchange="toggleTodosFiltro('${id}', this.checked)"><b>Todos</b></label>`;
  html += dominio.map((v,i) =>
    `<label><input type="checkbox" ${set.has(i)?'checked':''} onchange="toggleItemFiltro('${id}', ${i}, this.checked)">${def.label(v,i)}</label>`
  ).join('');
  document.getElementById(id + 'Options').innerHTML = html;
  // "Semana" e feminino: "todas"; os demais, "todos".
  const tudo = def.nome === 'Semana' ? 'todas' : 'todos';
  document.getElementById(id + 'Summary').textContent =
    todasMarcadas ? `${def.nome}: ${tudo}` : `${def.nome}: ${set.size} de ${dominio.length}`;
}

function toggleTodosFiltro(id, marcado) {
  const dominio = FILTRO_DEFS[id].dominio();
  selecionados[id] = marcado ? new Set(dominio.map((_,i)=>i)) : new Set();
  renderizarDropdownMultiplo(id);
  renderAll();
}

function toggleItemFiltro(id, idx, marcado) {
  if (marcado) selecionados[id].add(idx); else selecionados[id].delete(idx);
  renderizarDropdownMultiplo(id);
  renderAll();
}

// Periodo padrao ao abrir o painel: os ultimos 7 dias com dado no banco (nao os 7 dias
// de calendario, que poderiam cair num intervalo sem nenhum pedido importado ainda).
function periodoPadrao() {
  const ultima = DATAS[DATAS.length-1];
  const d = new Date(ultima + 'T00:00:00');
  d.setDate(d.getDate() - 6);
  const inicioDesejado = d.toISOString().slice(0,10);
  return { ini: inicioDesejado < DATAS[0] ? DATAS[0] : inicioDesejado, fim: ultima };
}

// ------------------------------------------------------------------
// Atalhos de periodo — substituem os antigos filtros de Semana/Mes/Ano.
// Todos escrevem nas MESMAS datas De/Ate, entao existe uma unica fonte de verdade
// para "qual periodo estou vendo".
// ------------------------------------------------------------------
const ULTIMO_DIA = () => DATAS[DATAS.length - 1];
const iso = (d) => d.toISOString().slice(0, 10);
const recuar = (dias) => { const d = new Date(ULTIMO_DIA() + 'T00:00:00'); d.setDate(d.getDate() - dias); return iso(d); };

const PRESETS = [
  { id: '7d',   rotulo: '7 dias',      calc: () => ({ ini: recuar(6),  fim: ULTIMO_DIA() }) },
  { id: '30d',  rotulo: '30 dias',     calc: () => ({ ini: recuar(29), fim: ULTIMO_DIA() }) },
  { id: 'mes',  rotulo: 'Este mês',    calc: () => { const u = ULTIMO_DIA(); return { ini: u.slice(0,8) + '01', fim: u }; } },
  { id: 'mesAnt', rotulo: 'Mês passado', calc: () => {
      const u = new Date(ULTIMO_DIA() + 'T00:00:00');
      const primeiroDesteMes = new Date(u.getFullYear(), u.getMonth(), 1);
      const fimMesAnterior = new Date(primeiroDesteMes); fimMesAnterior.setDate(0);
      const iniMesAnterior = new Date(fimMesAnterior.getFullYear(), fimMesAnterior.getMonth(), 1);
      return { ini: iso(iniMesAnterior), fim: iso(fimMesAnterior) };
    } },
  { id: '3m',   rotulo: '3 meses',     calc: () => ({ ini: recuar(89), fim: ULTIMO_DIA() }) },
  { id: 'tudo', rotulo: 'Todo o histórico', calc: () => ({ ini: DATAS[0], fim: ULTIMO_DIA() }) },
];

function aplicarPreset(id) {
  const p = PRESETS.find(x => x.id === id);
  if (!p) return;
  const { ini, fim } = p.calc();
  fDataIni.value = ini < DATAS[0] ? DATAS[0] : ini;
  fDataFim.value = fim > ULTIMO_DIA() ? ULTIMO_DIA() : fim;
  renderAll();
}

// ------------------------------------------------------------------
// JANELAS POR MODULO (etapa 2 da reforma, 12/08/2026). O periodo pertence
// ao modulo: entrar num modulo reinicia a janela dele para o padrao — fim
// do filtro pegajoso. Rotulos de gente, semanas sempre seg-dom fechadas.
// De/Ate e os presets antigos viraram estado interno (inputs escondidos).
const JANELAS = [
  { id: 'semAnt', rotulo: 'Semana passada', calc: () => ultimaSemanaCompleta() },
  { id: '4sem', rotulo: 'Últimas 4 semanas', calc: () => {
      const s = ultimaSemanaCompleta();
      const d = new Date(s.ini + 'T00:00:00'); d.setDate(d.getDate() - 21);
      return { ini: d.toISOString().slice(0, 10), fim: s.fim };
    } },
  { id: 'esteMes', rotulo: 'Este mês', calc: () => {
      const u = ULTIMO_DIA(); return { ini: u.slice(0, 8) + '01', fim: u };
    } },
  { id: 'mesAnt', rotulo: 'Mês passado', calc: () => {
      const u = new Date(ULTIMO_DIA() + 'T00:00:00');
      const fimAnt = new Date(u.getFullYear(), u.getMonth(), 0);
      const iniAnt = new Date(fimAnt.getFullYear(), fimAnt.getMonth(), 1);
      return { ini: iso(iniAnt), fim: iso(fimAnt) };
    } },
];
// So modulos que LEEM as datas do cabecalho entram aqui (conferido funcao a
// funcao em 12/08). Cardapio e Clientes tem periodo proprio — barra escondida.
const JANELA_DO_MODULO = {
  resumo: 'semAnt', cancelamentos: 'semAnt', avaliacoes: 'semAnt',
  negociacoes: 'semAnt', promocoes: 'semAnt',
  atrasos: 'semAnt', logfin: 'semAnt',
};
let JANELA_ATUAL = null;
let JANELA_DATAS = null;   // as datas que a janela da tela pôs: mudar à mão depois disso é filtro ativo

function aplicarJanela(id) {
  const j = JANELAS.find(x => x.id === id);
  if (!j) return;
  const { ini, fim } = j.calc();
  fDataIni.value = ini < DATAS[0] ? DATAS[0] : ini;
  fDataFim.value = fim;
  JANELA_ATUAL = id;
  JANELA_DATAS = { ini: fDataIni.value, fim: fDataFim.value };
  renderJanelas();
  renderAll();
}

function renderJanelas() {
  const el = document.getElementById('periodoPresets');
  if (!el) return;
  if (!Object.prototype.hasOwnProperty.call(JANELA_DO_MODULO, MODULO_ATUAL)) {
    el.innerHTML = ''; return;
  }
  const ddmm = (v) => v ? v.slice(8, 10) + '/' + v.slice(5, 7) : '—';
  el.innerHTML =
    '<span style="font-size:12px; color:#a5a49a; margin-right:4px;">Período:</span>' +
    JANELAS.map(j =>
      `<button class="preset-btn ${JANELA_ATUAL === j.id ? 'active' : ''}" onclick="plcSoltaEAplica('${j.id}')">${j.rotulo}</button>`
    ).join('') +
    `<span style="font-size:11.5px; color:#8a897e; margin-left:6px;">${ddmm(fDataIni.value)} a ${ddmm(fDataFim.value)}</span>`;
}

function renderPresets() {
  // mantido pelo nome (chamadores antigos); a barra agora e por modulo
  renderJanelas();
}

function montarFiltrosBase() {
  const padrao = periodoPadrao();
  fDataIni.min = DATAS[0]; fDataIni.max = DATAS[DATAS.length-1]; fDataIni.value = padrao.ini;
  fDataFim.min = DATAS[0]; fDataFim.max = DATAS[DATAS.length-1]; fDataFim.value = padrao.fim;
  fDataIni.addEventListener('change', renderAll);
  fDataFim.addEventListener('change', renderAll);

  Object.keys(FILTRO_DEFS).forEach(montarDropdownMultiplo);

}

// ------------------------------------------------------------------
// Filtro de lojas (checkboxes, dependente das unidades ativas)
// ------------------------------------------------------------------
const lojaToUnidade = {};
const lojaOptCont = document.getElementById('lojaOptions');
const lojaSummary = document.getElementById('lojaSummary');

// ------------------------------------------------------------------
// PERIMETRO DE GESTAO (12/08/2026). Boqueirao pertence a outra gestao
// (Loana) — o dono so tem os dados iFood de la. 'minha' = padrao, 13
// lojas proprias; 'rede' = as 17, para conferir com o Portal ou olhar
// junto com a Loana. Nao persiste entre recargas DE PROPOSITO: recorte
// fora do padrao tem que ser escolhido de novo, nunca herdado sem ver.
let PERIMETRO = 'minha';
let MODULO_ATUAL = 'estasemana';
let GESTAO_LOJA = {};          // nome_loja -> 'propria' | 'terceiros'
let UNIDADES_PROPRIAS = new Set();

function lojaPermitida(i) {
  return PERIMETRO === 'rede' || GESTAO_LOJA[LOJAS[i]] !== 'terceiros';
}
function unidadesVisiveis() {
  return UNIDADES.filter(u => PERIMETRO === 'rede' || UNIDADES_PROPRIAS.has(u));
}

function renderPerimetro() {
  const el = document.getElementById('perimetroBar');
  if (!el) return;
  // 24/10/2026 (dono): o Boqueirão sai do painel (vai para um projeto próprio, da Loana) — sem o botão de visão,
  // o painel fica sempre nas três lojas próprias. O código da visão "rede" fica, desligado, até o projeto novo existir.
  if (PERIMETRO === 'minha') { el.innerHTML = ''; el.style.display = 'none'; return; }
  el.style.display = '';
  el.innerHTML =
    '<span style="font-size:12px; color:#a5a49a;">Visão:</span>' +
    '<button class="navbtn ' + (PERIMETRO === 'minha' ? 'active' : '') + '" onclick="setPerimetro(\'minha\')">Minha gestão</button>' +
    '<button class="navbtn ' + (PERIMETRO === 'rede' ? 'active' : '') + '" onclick="setPerimetro(\'rede\')">Rede iFood completa</button>' +
    (PERIMETRO === 'rede'
      ? '<span style="font-size:11.5px; color:#f5a623; border:1px solid #f5a623; border-radius:12px; padding:3px 10px;">incluindo Boqueirão (outra gestão) · metas e farol ocultos nesta visão</span>'
      : '');
}

function setPerimetro(p) {
  if (PERIMETRO === p) return;
  PERIMETRO = p;
  activeUnidades = new Set(unidadesVisiveis());
  renderPerimetro();
  renderTopNav();
  rebuildLojaOptions();
  renderAll();
  // modulos de carga sob demanda renderizam na entrada — reentra no atual
  mostrarModulo(MODULO_ATUAL);
}

function rebuildLojaOptions() {
  const visibleLojas = LOJAS.map((_,i)=>i).filter(i => activeUnidades.has(UNIDADES[lojaToUnidade[i]]) && lojaPermitida(i));
  const html = `<label><input type="checkbox" id="lojaTodosChk" checked onchange="toggleTodasLojas(this.checked)"><b>Todos</b></label>` +
    visibleLojas.map(i =>
      `<label><input type="checkbox" data-l="${i}" checked onchange="updateLojaSummary(); renderAll();">${LOJAS[i]}</label>`
    ).join('');
  lojaOptCont.innerHTML = html;
  updateLojaSummary();
}

// "Todos" respeita a lista de lojas visiveis no momento — se uma unidade estiver filtrada,
// marca/desmarca so as lojas dessa unidade, nao todas as lojas do sistema.
function toggleTodasLojas(marcado) {
  Array.from(lojaOptCont.querySelectorAll('input[data-l]')).forEach(c => { c.checked = marcado; });
  updateLojaSummary();
  renderAll();
}

function updateLojaSummary() {
  const checks = Array.from(lojaOptCont.querySelectorAll('input[data-l]'));
  const total = checks.length;
  const checked = checks.filter(c=>c.checked).length;
  const todosChk = document.getElementById('lojaTodosChk');
  if (todosChk) {
    todosChk.checked = checked === total;
    todosChk.indeterminate = checked > 0 && checked < total;
  }
  lojaSummary.textContent = checked===total ? 'Marcas (loja): todas' : `Marcas (loja): ${checked} de ${total}`;
}

function activeLojas() {
  // lojaPermitida e a rede de seguranca do perimetro: mesmo que um checkbox
  // de loja de terceiros sobreviva no DOM, ela nao entra em conta nenhuma.
  return new Set(Array.from(lojaOptCont.querySelectorAll('input[data-l]'))
    .filter(c => c.checked && lojaPermitida(Number(c.dataset.l)))
    .map(c => Number(c.dataset.l)));
}

// 01/11/2026: dentro da casca o "Limpar filtros" só aparece com filtro ativo (dia, turno ou período diferente do da tela).
const TELAS_SEM_BARRA_FILTRO = ['atendimento', 'hoje', 'projecao', 'contaspagar', 'contasreceber', 'listas', 'listasfin'];
function filtroAtivo() {
  if (!VENDAS_CARREGADAS) return false;
  const base = JANELA_DATAS || periodoPadrao();
  return fDataIni.value !== base.ini || fDataFim.value !== base.fim ||
    Object.keys(FILTRO_DEFS).some((id) => selecionados[id] && selecionados[id].size !== FILTRO_DEFS[id].dominio().length) ||
    [...lojaOptCont.querySelectorAll('input[data-l]')].some((c) => !c.checked);
}
function limparFiltrosVer(nome) {
  const barra = document.getElementById('limparFiltrosBar');
  if (barra) barra.style.display = TELAS_SEM_BARRA_FILTRO.includes(nome) || (NA_CASCA && !filtroAtivo()) ? 'none' : 'flex';
  filtrosCelVer(nome);
}
function filtrosCelVer(nome) {
  const painel = document.getElementById('painel');
  const temJanela = Object.prototype.hasOwnProperty.call(JANELA_DO_MODULO, nome);
  const tem = VENDAS_CARREGADAS && (temJanela || MODULOS_COM_FILTRO_TOPO.has(nome));
  painel.classList.toggle('filtros-cel', tem);
  if (!tem) return;
  const marcas = document.getElementById('lojaSummary').textContent;
  const dm = (s) => s.slice(8, 10) + '/' + s.slice(5, 7);
  document.getElementById('filtrosCel').textContent = 'Filtros' + (temJanela ? ' · ' + dm(fDataIni.value) + ' a ' + dm(fDataFim.value) : '') +
    (/todas/i.test(marcas) ? '' : ' · ' + marcas) + (painel.classList.contains('filtros-abertos') ? ' ▴' : ' ▾');
}
function filtrosCelTroca() {
  document.getElementById('painel').classList.toggle('filtros-abertos');
  filtrosCelVer(MODULO_ATUAL);
}
function resetFiltros() {
  JANELA_DATAS = null;
  const padrao = periodoPadrao();
  fDataIni.value = padrao.ini;
  fDataFim.value = padrao.fim;
  Object.keys(FILTRO_DEFS).forEach(montarDropdownMultiplo);
  activeUnidades = new Set(unidadesVisiveis());
  canalLojaAplicar();
  renderTopNav();
  rebuildLojaOptions();
  renderAll();
}

// ------------------------------------------------------------------
// Filtro de unidades — MULTIPLA ESCOLHA (clique liga/desliga cada uma)
// ------------------------------------------------------------------
function renderTopNav() {
  const el = document.getElementById('topnav');
  if (canalComSeletor()) {
    el.innerHTML = `<span style="font-size:13px; color:var(--tx-3);">Loja: <b style="color:var(--tx-1);">${lojaNome(lojaAtual())}</b> <span style="font-size:12px;">· troque no seletor do topo</span></span>`;
    return;
  }
  const visiveis = unidadesVisiveis();
  const todasAtivas = activeUnidades.size === visiveis.length;
  let html = `<button class="navbtn ${todasAtivas?'active':''}" onclick="selecionarTodasUnidades()">Todas</button>`;
  visiveis.forEach(u => {
    const active = activeUnidades.has(u) ? 'active' : '';
    html += `<button class="navbtn ${active}" onclick="toggleUnidade('${u}')">${u}</button>`;
  });
  el.innerHTML = html;
}

function toggleUnidade(u) {
  // Clicar numa unidade ISOLA ela (etapa 2, 12/08/2026). O comportamento
  // antigo era liga/desliga: com todas ativas, clicar em AGUA VERDE REMOVIA
  // a Agua Verde — o oposto do que o dono esperava ("clico pra ver ela").
  // Para voltar ao conjunto, o botao "Todas".
  activeUnidades = new Set([u]);
  renderTopNav();
  rebuildLojaOptions();
  renderAll();
}

function selecionarTodasUnidades() {
  activeUnidades = new Set(unidadesVisiveis());
  renderTopNav();
  rebuildLojaOptions();
  renderAll();
}

// 28/10/2026 (seletor de loja único): dentro da casca, a loja escolhida no topo é o filtro de unidade das telas de vendas
// e de entrega (loja = só ela; Rede = as 3). Fora da casca (painel aberto direto) os botões de unidade continuam.
let CANAL_OUVE_LOJA = false;
function canalComSeletor() {
  // NA_CASCA: o painel antigo marca com ?casca=1; a página própria, por estar numa moldura (05/11/2026)
  return typeof NA_CASCA !== 'undefined' && NA_CASCA
    && typeof lojaAtual === 'function' && typeof LOJA_INFO !== 'undefined' && !!LOJA_INFO && !!lojaAtual();
}
function canalLojaAplicar() {
  if (!canalComSeletor()) return false;
  const l = lojaAtual(), vis = unidadesVisiveis();
  const uma = l !== 'REDE' && vis.includes(l);
  activeUnidades = uma ? new Set([l]) : new Set(vis);
  ATRASOS_UNIDADE = uma ? l : 'TODAS';
  LOGFIN_UNIDADE = uma ? l : 'TODAS';
  return true;
}
async function canalLojaPreparar() {
  if (typeof lojaCarregar !== 'function') return;
  await lojaCarregar();
  canalLojaAplicar();
  if (CANAL_OUVE_LOJA) return;
  CANAL_OUVE_LOJA = true;
  aoMudarLoja(() => {
    // trocar a loja solta o recorte que veio do Placar: dali em diante a escolha é de quem está olhando
    if (MODULO_ATUAL) plcCtxSolta(MODULO_ATUAL);
    aplicarLojaFin();
    if (!canalLojaAplicar()) return;
    PLC_UNID_ANTES = null;
    renderTopNav(); rebuildLojaOptions(); renderAll();
    // Contas e Fluxo projetado já têm os dados: trocar a loja só refiltra, sem ler o banco de novo
    if (CP && ['contaspagar', 'contasreceber'].includes(MODULO_ATUAL)) { cpRender(); return; }
    if (MODULO_ATUAL === 'projecao' && PROJ_PAGAR) { renderModuloProjecao(); return; }
    if (MODULO_ATUAL) mostrarModulo(MODULO_ATUAL);
  });
}

// ------------------------------------------------------------------
// Calculo das metricas (identico a logica ja validada)
// ------------------------------------------------------------------
// Mes corrente no fuso da operacao (America/Sao_Paulo, nunca UTC) como 'AAAA-MM'.
// O banco guarda competencias FUTURAS (contas a pagar ja lancadas: alugueis,
// parcelamentos) — em set e out/26 havia R$ 199 mil e R$ 44 mil de despesa com
// receita ZERO, e a coluna parecia catastrofe (16/08/2026). DFC/DRE cortam a
// EXIBICAO no mes corrente; o futuro tem casa propria, o Fluxo Projetado.
function mesCorrenteSP() { return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(new Date()).slice(0, 7); }
// Mesmo arredondamento de fmt(): evita o "-0,0%" que aparecia quando o valor era zero mas o
// calculo devolvia um negativo microscopico.

// respeitarPeriodo=false ignora os campos De/Ate (usado pontualmente por calculos que
// precisam olhar toda a base).
function linhasFiltradas(respeitarPeriodo = true, iniAlt = null, fimAlt = null) {
  const dIni = iniAlt || fDataIni.value, dFim = fimAlt || fDataFim.value;
  const activeL = activeLojas();

  return ROWS.filter(r => {
    if (!activeL.has(r[0])) return false;
    if (!selecionados.fDia.has(r[4])) return false;
    if (!selecionados.fTurno.has(r[2])) return false;
    if (respeitarPeriodo) {
      const dataStr = DATAS[r[5]];
      if (dIni && dataStr < dIni) return false;
      if (dFim && dataStr > dFim) return false;
    }
    return true;
  });
}

// Cancelamentos por motivo respeitam os mesmos filtros de ROWS (loja/unidade, dia da semana,
// turno, periodo).
function linhasCancelamentoFiltradas(iniAlt = null, fimAlt = null) {
  const dIni = iniAlt || fDataIni.value, dFim = fimAlt || fDataFim.value;
  const activeL = activeLojas();
  return MOTIVOS.filter(r => {
    if (!activeL.has(r[0])) return false;
    if (!selecionados.fTurno.has(r[1])) return false;
    if (!selecionados.fDia.has(r[3])) return false;
    const dataStr = DATAS[r[4]];
    if (dIni && dataStr < dIni) return false;
    if (dFim && dataStr > dFim) return false;
    return true;
  });
}

function resumoMotivosCancelamento(iniAlt = null, fimAlt = null) {
  const linhas = linhasCancelamentoFiltradas(iniAlt, fimAlt);
  const total = linhas.reduce((s,r)=>s+r[6],0) || 1;
  const porResp = new Map();
  linhas.forEach(r => {
    const resp = r[5];
    if (!porResp.has(resp)) porResp.set(resp, { n: 0, valor: 0 });
    const o = porResp.get(resp);
    o.n += r[6];
    o.valor += r[7];
  });
  return Array.from(porResp.entries())
    .map(([responsavel, o]) => ({ responsavel, n: o.n, valor: o.valor, pct: o.n/total*100 }))
    .sort((a,b) => b.n - a.n);
}

// Soma os ajustes novos da conciliacao (Pacote de anuncios, Mensalidade, etc.) respeitando
// loja/unidade e o periodo (De/Ate). Nao respeita Semana/Dia da semana/Turno porque a
// conciliacao nao tem essas dimensoes calculadas.
// Soma um grupo da conciliacao (TAXA_CARTAO, COMISSAO_VENDAS, MENSALIDADE, ANUNCIOS,
// OUTROS_AJUSTES, RESSARCIMENTO_CANCELAMENTO) respeitando loja/unidade e o periodo (De/Ate).
// Nao respeita Semana/Dia da semana/Turno porque a conciliacao nao tem essas dimensoes
// calculadas. Devolve o valor cru (sinal original do banco: negativo = custo, positivo = credito).
function somaConciliacaoRaw(grupo, iniAlt = null, fimAlt = null) {
  const dIni = iniAlt || fDataIni.value, dFim = fimAlt || fDataFim.value;
  const activeL = activeLojas();
  return CONCILIACAO
    .filter(c => c[2]===grupo && activeL.has(c[0]) && (!dIni || c[1] >= dIni) && (!dFim || c[1] <= dFim))
    .reduce((s,c)=>s+c[3], 0);
}

// ------------------------------------------------------------------
// Comparacao com o periodo anterior
// ------------------------------------------------------------------
// Devolve a janela imediatamente anterior, do MESMO tamanho da que esta filtrada.
// Ex.: filtro de 01/07 a 31/07 (31 dias) -> anterior = 31/05 a 30/06.
// Devolve null quando nao ha dados suficientes antes (nao inventamos base de comparacao).
function periodoAnterior() {
  const ini = fDataIni.value, fim = fDataFim.value;
  if (!ini || !fim) return null;
  const d1 = new Date(ini + 'T00:00:00'), d2 = new Date(fim + 'T00:00:00');
  const dias = Math.round((d2 - d1) / 86400000) + 1;
  if (dias < 1) return null;
  const fimAnt = new Date(d1); fimAnt.setDate(fimAnt.getDate() - 1);
  const iniAnt = new Date(fimAnt); iniAnt.setDate(iniAnt.getDate() - (dias - 1));
  const iso = (d) => d.toISOString().slice(0, 10);
  // Se a janela anterior for inteiramente antes do primeiro dado que temos, nao ha o que comparar.
  if (iso(fimAnt) < DATAS[0]) return null;
  return { ini: iso(iniAnt), fim: iso(fimAnt), dias };
}

function formatarDataCurta(iso) {
  const [a, m, d] = iso.split('-');
  return `${d}/${m}/${a}`;
}



// O RODAPÉ do Líquido entra no lugar do <div id="rodapeVendas"> (05/11/2026: saiu do painel com o Canal).
(function () {
  const lugar = document.getElementById('rodapeVendas');
  if (lugar) lugar.outerHTML = `
    <div class="footer">
      Líquido = venda (itens + frete) menos taxas, comissões e entregas do iFood, promoções pagas por nós e anúncios, mais o que o iFood devolveu de cancelamento; cancelamento total fica fora, o parcial entra pelo que ficou.
    </div>
`;
})();

// Peças que as telas do Canal e as do painel antigo (Esta semana, Hoje, Placar, Indicadores) leem juntas (05/11/2026).
// iniAlt/fimAlt permitem calcular as mesmas metricas para outro periodo (o anterior), sem
// mexer nos filtros da tela — e assim mostrar a variacao em cada card.
function computeMetrics(iniAlt = null, fimAlt = null) {
  const rows = linhasFiltradas(true, iniAlt, fimAlt);
  const fin = rows.filter(r => r[6] !== 1);

  const totalPedidosFin = fin.reduce((s,r)=>s+r[7],0);
  const itens = fin.reduce((s,r)=>s+(r[8]-r[9]),0);
  const frete = fin.reduce((s,r)=>s+r[10],0);
  const bruto = itens + frete;

  const idxOnline = TIPOS_PAGAMENTO.indexOf('ONLINE');
  const idxCartao = TIPOS_PAGAMENTO.indexOf('CARTAO');
  const vendasOnline = fin.filter(r=>r[18]===idxOnline).reduce((s,r)=>s+(r[8]-r[9])+r[10],0);
  const vendasCartao = fin.filter(r=>r[18]===idxCartao).reduce((s,r)=>s+(r[8]-r[9])+r[10],0);

  // 07/11/2026 (auditoria lote 2, canal-24): o incentivo da REDE sai do nosso bolso — entra com o da loja, nunca
  // com o do iFood (mesma conta da tela Promocoes, canal.js "nosso = loja + rede"). Hoje e' R$ 0 em todo o historico.
  const promoIfoodRede = fin.reduce((s,r)=>s+r[11],0);   // so o iFood (o nome ficou por compatibilidade)
  const promoLoja = fin.reduce((s,r)=>s+r[13]+r[12],0);  // loja + rede
  const freteSobDemanda = fin.reduce((s,r)=>s+r[16],0);
  const ticketMedio = totalPedidosFin ? bruto/totalPedidosFin : 0;

  // Grupo 1: taxas e comissoes (tudo positivo = custo). Vem da conciliacao, ja separado por
  // categoria (fato_pedidos so tinha um valor combinado de taxas_comissoes). OUTROS_AJUSTES
  // aqui e so o lado de debito (taxa de parcelamento, retencao VR/VA, correcoes) — os
  // ressarcimentos de cancelamento viraram uma entrada, contabilizados abaixo.
  const taxaOnline = -somaConciliacaoRaw('TAXA_CARTAO', iniAlt, fimAlt);
  const comissaoVendas = -somaConciliacaoRaw('COMISSAO_VENDAS', iniAlt, fimAlt);
  // Mensalidade e um valor pequeno e esporadico — na APRESENTACAO ela entra dentro de
  // "Outros ajustes". No banco continua classificada a parte (grupo MENSALIDADE), entao
  // da pra destrinchar quando quiser.
  const mensalidade = -somaConciliacaoRaw('MENSALIDADE', iniAlt, fimAlt);
  const outrosAjustes = -somaConciliacaoRaw('OUTROS_AJUSTES', iniAlt, fimAlt) + mensalidade;
  const totalTaxasComissoes = taxaOnline + comissaoVendas + outrosAjustes;
  // Entrega do iFood na loja em Full Service (dono, 15/10/2026: linha propria): taxa de entrega
  // repassada + comissao por raio. Antes caia em Outros ajustes; a DRE poe em Logistica. Resultado igual.
  const entregaIfood = -somaConciliacaoRaw('ENTREGA_IFOOD', iniAlt, fimAlt);
  // Total de descontos exibido no card soma tambem o frete sob demanda e a entrega do iFood.
  const totalDescontos = totalTaxasComissoes + freteSobDemanda + entregaIfood;

  // Grupo 2: marketing pago pela loja (promo + anuncios).
  const anuncios = -somaConciliacaoRaw('ANUNCIOS', iniAlt, fimAlt);
  const totalMkt = promoLoja + anuncios;
  const custoMktPorPedido = totalPedidosFin ? totalMkt/totalPedidosFin : 0;

  // Ressarcimento de pedidos/itens cancelados: dinheiro que volta pra loja — entra no
  // Bloco 1 (entradas), nao no Bloco 2. Ja vem positivo do banco (credito), sem inverter sinal.
  const ressarcimentoCancelamento = somaConciliacaoRaw('RESSARCIMENTO_CANCELAMENTO', iniAlt, fimAlt);
  // O card "Total de descontos" tambem soma o ressarcimento.
  const totalDescontosComRessarcimento = totalDescontos - ressarcimentoCancelamento;

  // Custo iFood = Total de descontos (ja com ressarcimento) + Total investido em mkt —
  // exatamente os dois totais mostrados nos blocos acima.
  const custoIfood = totalDescontosComRessarcimento + totalMkt;
  const liquido = bruto - custoIfood;

  // Bloco 3 (Composicao de Promos) usa outra base de mkt: quem pagou (loja x plataforma).
  const totalMktGeral = promoIfoodRede + promoLoja;

  const cancelFull = rows.filter(r=>r[6]===1);
  const cancelParcial = rows.filter(r=>r[6]===2);
  const nFull = cancelFull.reduce((s,r)=>s+r[7],0);
  const nParcial = cancelParcial.reduce((s,r)=>s+r[7],0);
  const vFull = cancelFull.reduce((s,r)=>s+r[8],0);
  const vParcial = cancelParcial.reduce((s,r)=>s+r[9],0);
  const valorCancelado = vFull + vParcial;
  const totalCancelados = nFull + nParcial;
  const totalPedidosGeral = rows.reduce((s,r)=>s+r[7],0);

  // O que a operacao realmente perdeu com cancelamentos: o valor cancelado menos o que o
  // iFood devolveu (ressarcimento). E o numero que importa pro resultado, nao o valor bruto
  // cancelado — parte dele volta.
  const valorPerdidoReal = valorCancelado - ressarcimentoCancelamento;

  const safeBruto = bruto || 1;
  const safeTotal = totalPedidosGeral || 1;
  const safeMktGeral = totalMktGeral || 1;

  return {
    valorPerdidoReal, valorPerdidoRealPct: valorPerdidoReal/safeBruto*100,
    itens, itensPct: itens/safeBruto*100,
    frete, fretePct: frete/safeBruto*100,
    bruto,
    vendasOnline, vendasOnlinePct: vendasOnline/safeBruto*100,
    vendasCartao, vendasCartaoPct: vendasCartao/safeBruto*100,
    ressarcimentoCancelamento, ressarcimentoCancelamentoPct: ressarcimentoCancelamento/safeBruto*100,
    taxaOnline, taxaOnlinePct: taxaOnline/safeBruto*100,
    comissaoVendas, comissaoVendasPct: comissaoVendas/safeBruto*100,
    mensalidade, mensalidadePct: mensalidade/safeBruto*100,
    outrosAjustes, outrosAjustesPct: outrosAjustes/safeBruto*100,
    totalTaxasComissoes, totalTaxasComissoesPct: totalTaxasComissoes/safeBruto*100,
    totalDescontos, totalDescontosPct: totalDescontos/safeBruto*100,
    totalDescontosComRessarcimento, totalDescontosComRessarcimentoPct: totalDescontosComRessarcimento/safeBruto*100,
    freteSobDemanda, freteSobDemandaPct: freteSobDemanda/safeBruto*100,
    entregaIfood, entregaIfoodPct: entregaIfood/safeBruto*100,
    promoLoja, promoLojaPct: promoLoja/safeBruto*100,
    anuncios, anunciosPct: anuncios/safeBruto*100,
    totalMkt, totalMktPct: totalMkt/safeBruto*100,
    custoMktPorPedido,
    liquido, liquidoPct: liquido/safeBruto*100,
    custoIfood, custoIfoodPct: custoIfood/safeBruto*100,
    totalPedidos: totalPedidosFin, ticketMedio,
    totalMktGeral, totalMktGeralPct: totalMktGeral/safeBruto*100,
    investLoja: promoLoja, investLojaPct: promoLoja/safeMktGeral*100,
    investPlataforma: promoIfoodRede, investPlataformaPct: promoIfoodRede/safeMktGeral*100,
    valorCancelado, valorCanceladoPct: valorCancelado/safeBruto*100,
    totalCancelados, totalCanceladosPct: totalCancelados/safeTotal*100,
    nFull, nFullPct: nFull/safeTotal*100, vFull,
    nParcial, nParcialPct: nParcial/safeTotal*100, vParcial,
  };
}

// ------------------------------------------------------------------
// MODULO INDICADORES E METAS — placar semanal vs metas_kpi (banco)
// ------------------------------------------------------------------
let METAS_KPI = null;

// Ultima semana completa seg-dom (mesmo recorte do resumo semanal e do repasse iFood).
function ultimaSemanaCompleta() {
  const hoje = new Date(); hoje.setHours(0, 0, 0, 0);
  const dow = (hoje.getDay() + 6) % 7; // 0 = segunda
  const segAtual = new Date(hoje); segAtual.setDate(segAtual.getDate() - dow);
  const dom = new Date(segAtual); dom.setDate(dom.getDate() - 1);
  const seg = new Date(dom); seg.setDate(seg.getDate() - 6);
  const iso = (d) => d.toISOString().slice(0, 10);
  return { ini: iso(seg), fim: iso(dom) };
}

// Meta de volume da semana (líquido, pedidos) é só da Rede: não existe alvo por loja, então numa loja o número aparece
// sem farol e fora da contagem. Meta de percentual, nota e razão vale igual em qualquer loja.
const METAS_SO_REDE = new Set(['liquido_semana', 'pedidos_semana']);

const metaSoRede = (k) => METAS_SO_REDE.has(k.chave) && canalComSeletor() && lojaFin() !== 'REDE';

function farolKpi(meta, valor) {
  if (metaSoRede(meta)) return ['#8a897e', 'alvo só da Rede'];
  // As metas foram calibradas para o perimetro "Minha gestao" (sem Boqueirao,
  // recalibradas em 12/08/2026). Na visao Rede completa, farol colorido
  // mentiria — vira cinza com o motivo no rotulo.
  if (typeof PERIMETRO !== 'undefined' && PERIMETRO === 'rede') return ['#8a897e', 'metas valem p/ Minha gestão'];
  if (valor === null || valor === undefined) return ['#8a897e', 'sem dado'];
  const m = Number(meta.meta), m2 = meta.meta2 !== null ? Number(meta.meta2) : null;
  const tol = (x) => Math.abs(x) > 0 ? Math.abs(x) * 0.10 : 5; // 10% (ou 5 p.p. quando a meta e zero)
  if (meta.sentido === 'acima') {
    if (valor >= m) return ['#3fb950', 'na meta'];
    if (valor >= m - tol(m)) return ['#f5a623', 'perto'];
    return ['#ff6b6b', 'fora'];
  }
  if (meta.sentido === 'abaixo') {
    if (valor <= m) return ['#3fb950', 'na meta'];
    if (valor <= m + tol(m)) return ['#f5a623', 'perto'];
    return ['#ff6b6b', 'fora'];
  }
  // faixa
  if (valor >= m && valor <= m2) return ['#3fb950', 'na faixa'];
  if (valor >= m - tol(m) && valor <= m2 + tol(m2)) return ['#f5a623', 'perto'];
  return ['#ff6b6b', 'fora'];
}

function fmtKpi(unidade, v) {
  if (v === null || v === undefined) return '—';
  if (unidade === 'rs') return 'R$ ' + fmt(v);
  if (unidade === 'pct') return pct(v) + '%';
  if (unidade === 'nota') return v.toFixed(2).replace('.', ',');
  if (unidade === 'x') return v.toFixed(2).replace('.', ',') + 'x';
  return Math.round(v).toLocaleString('pt-BR');
}

function fmtMeta(meta) {
  const f = (v) => fmtKpi(meta.unidade, Number(v));
  if (meta.sentido === 'faixa') return `${f(meta.meta)} – ${f(meta.meta2)}`;
  return (meta.sentido === 'acima' ? '≥ ' : '≤ ') + f(meta.meta);
}

// ===== A loja do financeiro =====
// 31/10/2026 (dono: "pode levar o seletor pro financeiro e resultado"): a loja é a do seletor do topo (nucleo/loja.js), fim do
// padrão Água Verde de 18/08. Somar as três continua sendo escolha visível: "Rede (as 3)" no topo.
// LOJA_PLC só vale dentro de plcComLoja, que roda a mesma conta trocando a loja por um instante.
let LOJA_PLC = null;

const lojaFin = () => LOJA_PLC || (typeof lojaAtual === 'function' ? lojaAtual() : null);
