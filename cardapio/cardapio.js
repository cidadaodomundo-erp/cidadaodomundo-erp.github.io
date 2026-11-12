// Custo e cardápio do painel Cidadão do Mundo: Preço alvo por produto (rateio), Engenharia de cardápio e Fichas técnicas.
// Saiu de docs/dashboard.html em 26/10/2026 (bloco 5 do painel em módulos): MOVIDO, não copiado, em dois trechos aqui em
// sequência. Carregado pelo dashboard.html e por docs/cardapio/index.html, depois do nucleo.js. mostrarModulo é de cada
// página. Desempenho do cardápio e Promoções seguem no dashboard.html (leem a carga de vendas e os filtros do topo).
// Quem mexe aqui: o chat "Telas do painel"; os dados são das frentes Cardápio e Margem e preço.

// ------------------------------------------------------------------
// MODULO SITE PROPRIO (ACCON) — 21/08/2026, fonte da venda trocada em 22/08
// ------------------------------------------------------------------
// Por que existe: o dono quer (1) migrar cliente do iFood para o site e
// (2) mandar relatorio de venda do site para a equipe de trafego pago,
// que cruza com as campanhas dela.
//
// DUAS FONTES, DE PROPOSITO (decisao de 22/08/2026):
//   VENDA   -> vw_site_vendas_dia. Sai do SAIPOS, que chega todo dia pela
//              API, sem cookie e sem CAPTCHA (Accon so no Boqueirao, que o
//              Saipos nao cobre, e nos meses de 2025, antes do Saipos ter
//              o canal). Conferido: mai/26 218 pedidos nos dois, jun 182 x
//              184, jul 147 x 146.
//   CLIENTE -> views vw_crm_*. DESDE 15/10/2026 tambem sai do SAIPOS nas 3
//              lojas proprias: a API traz o telefone do cliente em 100% das
//              vendas do site, igual ao da Accon em 1.744 de 1.744 pedidos
//              casados (script/conferir_cliente_site_saipos.py). A Accon fica
//              so para o Boqueirao, para 2025 e para CUPOM e UTM, que so ela
//              tem — esses dois param no ultimo export manual de cada loja
//              (vw_site_atualizacao, o_que = 'cupom').
// Por isso a tela mostra a data de corte do cupom separada. Cookie vencido
// atrasa so cupom/UTM e o Boqueirao, nunca venda nem cliente das 3 lojas.
//
// Cuidados que estao no codigo de proposito:
// - "cliente novo" e primeiro pedido DENTRO da janela de 12 meses que o
//   portal da Accon guarda — nao e primeiro pedido da vida.
// - Semana depois do corte do cliente mostra "—" na coluna de novos, em
//   vez de zero: zero seria mentira, "—" e "ainda nao sabemos".
// - O periodo e proprio do modulo (o filtro de datas do topo e do iFood).
//   O filtro de UNIDADES do topo, esse sim, vale aqui.
// ======================================================================
// RESULTADO POR CANAL (rateio de despesas) — 22/08/2026
// Pergunta que responde: de cada R$ 100 vendidos num canal, quanto vai
// para operar esse canal (sem a materia-prima, que entra pela ficha)?
// Fonte: mv_rateio_canal_mensal (recalculada na rotina das 07:30),
// vw_rateio_resumo_canal, vw_rateio_pct_canal_precificacao e
// vw_rateio_preco_alvo. Criterios por subtipo em rateio_criterios
// (decisoes do dono em 13, 21 e 22/08/2026 — contexto/project_rateio_despesas_canal.md).
// Duas leituras: REAL (com o beneficio dos R$ 500 mil do iFood) e CHEIA
// (comissao de 9,5% de volta) — precificar pela cheia.
// ======================================================================
let RATEIO = null;
let RATEIO_CANAL = 'IFOOD';
let RATEIO_UNIDADE = null;   // desde 22/08/2026 o rateio existe para as 3 lojas; desde 28/10 a loja vem do topo
// 28/10/2026 (seletor de loja único): o preço alvo é por loja e não se soma — na Rede a tela pede a loja. Sem o loja.js
// (painel antigo) vale a barra própria, começando na Água Verde, como antes.
let CAR_OUVE_LOJA = false;
function carComSeletor() { return typeof lojaAtual === 'function' && typeof LOJA_INFO !== 'undefined' && !!LOJA_INFO; }
function carEscolherLoja(u) {
  if (window.parent !== window) { try { parent.postMessage({ tipo: 'casca-loja-pedir', loja: u }, location.origin); } catch (e) {} return; }
  if (typeof lojaEscolher === 'function') lojaEscolher(u);
}
let RATEIO_BUSCA = '';
let RATEIO_MARGEM = 0.10;   // lucro final desejado, escolhido na tela (10% e o padrao)
let RATEIO_ORDEM = 'margem';
let RATEIO_ABERTO = null;   // indice (em RATEIO.preco) do produto com a conta aberta

async function entrarRateio() {
  const alvo = document.getElementById('view-rateio');
  if (!alvo) return;
  if (typeof lojaCarregar === 'function' && await lojaCarregar()) {
    if (!CAR_OUVE_LOJA) { CAR_OUVE_LOJA = true; aoMudarLoja(() => { if (typeof window.reentrarTela === 'function') window.reentrarTela(); else entrarRateio(); }); }
    const l = lojaAtual();
    if (!l || l === 'REDE') {
      alvo.innerHTML = !l ? '<div class="contexto" style="border-color:var(--farol-fora);">Sem loja cadastrada para este login — fale com o Neto.</div>'
        : `<div class="contexto" style="text-align:left;"><b>O preço alvo é por loja.</b> Cada loja tem o seu custo de canal, então a Rede não tem um preço só. Escolha a loja:
          <div style="display:flex; gap:8px; flex-wrap:wrap; margin-top:10px;">${LOJA_INFO.lojas.filter((u) => u !== 'REDE')
            .map((u) => `<button class="preset-btn active" onclick="carEscolherLoja('${u}')">${lojaNome(u)}</button>`).join('')}</div></div>`;
      return;
    }
    if (l !== RATEIO_UNIDADE) { RATEIO_UNIDADE = l; RATEIO = null; RATEIO_CANAL = 'IFOOD'; RATEIO_ABERTO = null; }
  } else if (!RATEIO_UNIDADE) RATEIO_UNIDADE = 'AGUA VERDE';
  if (RATEIO === null) {
    alvo.innerHTML = '<div class="contexto">Carregando o preço alvo...</div>';
    try {
      const U = encodeURIComponent(RATEIO_UNIDADE);
      const pct = await consultarTudo(`vw_rateio_pct_canal_precificacao?select=*&unidade=eq.${U}`);
      const [resumo, preco, semCriterio] = await Promise.all([
        consultarTudo(`vw_rateio_resumo_canal?select=*&unidade=eq.${U}&order=mes`),
        // 07/11/2026 (proposta Cardapio, auditoria lote 2): a regua oficial e a
        // vw_margem_produto (§C16) — pro-labore da DRE e mao de obra por tipo de produto
        // (mercadoria e chope nao levam a da cozinha). A tela so le; nada de conta aqui.
        consultarTudo(`vw_margem_produto?select=produto,nome_base,grupo,fora_da_base,classe,categoria,canal,custo_ficha,preco_atual,qtd_vendida,preco_instavel,preco_min,preco_max,ingredientes_sem_custo,pct_ficha,pct_embalagem,pct_mo_aplicada,pct_mo_canal,pct_adm,pct_venda,pct_uso_consumo,pct_outros,pct_beneficio_ifood,pct_pro_labore,pct_despesa_real,pct_despesa_cheia,margem_alvo,de,ate,lucro_final_real,lucro_final_cheio,lucro_final_reais,preco_alvo_final&unidade=eq.${U}&preco_atual=not.is.null&order=lucro_final_cheio`),
        // Conta de despesa que apareceu no dinheiro sem criterio decidido — cairia em
        // "por vendas" em silencio (foi assim que a Agencia Oito passou despercebida).
        consultarTudo('vw_rateio_sem_criterio?select=*').catch(() => []),
      ]);
      // 07/11/2026 (Cardápio, 60627ca): o nome da base vem da própria vw_margem_produto (nome_base, grupo, fora_da_base)
      preco.forEach(r => { r.fora_da_base = r.fora_da_base === true; });
      RATEIO = { pct, resumo, preco, semCriterio };
    } catch (e) {
      alvo.innerHTML = `<div class="contexto" style="border-color:#c8102e;">Não consegui ler o rateio: ${e.message || e}</div>`;
      return;
    }
  }
  renderModuloRateio();
}

function rateioCanal(c) { RATEIO_CANAL = c; RATEIO_ABERTO = null; renderModuloRateio(); }
function rateioUnidade(u) { RATEIO_UNIDADE = u; RATEIO = null; RATEIO_CANAL = 'IFOOD'; RATEIO_ABERTO = null; entrarRateio(); }
function rateioBarraUnidades() {
  if (carComSeletor()) return `<div style="margin:0 0 12px; font-size:13px; color:var(--tx-3);">Loja: <b style="color:var(--tx-1);">${lojaNome(RATEIO_UNIDADE)}</b> <span style="font-size:12px;">· troque no seletor do topo</span></div>`;
  const nomes = { 'AGUA VERDE': 'Água Verde', 'AHU': 'Ahú', 'SÃO BRAZ': 'São Braz' };
  return `<div style="display:flex; gap:8px; margin:0 0 12px;">${Object.keys(nomes).map(u =>
    `<button onclick="rateioUnidade('${u}')" style="font:inherit; font-size:12.5px; padding:5px 12px; border-radius:999px; cursor:pointer; border:1px solid ${u === RATEIO_UNIDADE ? '#c8102e' : '#34332f'}; background:${u === RATEIO_UNIDADE ? '#c8102e' : '#1a1a19'}; color:#fff;">${nomes[u]}</button>`).join('')}</div>`;
}
function rateioBusca(v) { RATEIO_BUSCA = (v || '').toUpperCase(); renderRateioPreco(); }
function rateioMargem(m) { RATEIO_MARGEM = m; renderModuloRateio(); }
function rateioOrdem(v) { RATEIO_ORDEM = v; renderRateioPreco(); }
function rateioAbrir(i) { RATEIO_ABERTO = RATEIO_ABERTO === i ? null : i; renderRateioPreco(); }
// Preco alvo com o lucro final escolhido na tela (07/11/2026). Tudo vem aberto da
// vw_margem_produto: a view da o preco_alvo_final com a margem_alvo dela (10%); para
// outra margem so troca o m na mesma conta da view —
// custo_ficha / (1 - embalagem - despesa cheia - pro-labore - m). Nenhum % e refeito aqui.
function rateioAlvo(r, m) {
  if (r.preco_alvo_final != null && Math.abs(m - Number(r.margem_alvo)) < 0.0001) return Number(r.preco_alvo_final);
  const denom = 1 - Number(r.pct_embalagem || 0) - Number(r.pct_despesa_cheia || 0) - Number(r.pct_pro_labore || 0) - m;
  return denom > 0 ? Number(r.custo_ficha) / denom : null;
}
// linha de referencia do canal para o cartao: um produto de cozinha (leva a mao de
// obra cheia do canal); sem ele, o primeiro do canal
function rateioRefCanal(c) {
  const doCanal = RATEIO.preco.filter(r => r.canal === c);
  return doCanal.find(r => Number(r.pct_mo_aplicada) === Number(r.pct_mo_canal) && Number(r.pct_mo_canal) > 0) || doCanal[0] || null;
}

// A conta do canal na ordem da DRE morava aqui ate 25/08/2026. Saiu porque a
// leitura de RESULTADO (por canal, turno e dia) unificou na Mini DRE por turno
// (docs/dre-turno.html, gerada por script/gerar_dre_turno.py) — este modulo
// ficou so com o que e dele: PRECO (markup do canal x custo da ficha) e o
// alerta de despesa sem criterio. Atacado e Filiais da AV seguem nos cartoes.
// 12/09/2026: a Mini DRE por turno saiu do menu (pagina parada em julho). A leitura
// viva de venda por canal x faixa x dia e o modulo Evolucao de vendas.
function renderModuloRateio() {
  const alvo = document.getElementById('view-rateio');
  if (!alvo || !RATEIO) return;
  const reais = (v) => 'R$ ' + fmt(Number(v || 0));
  const pc = (v) => (100 * Number(v || 0)).toFixed(1).replace('.', ',') + '%';
  const mesNome = (iso) => { const [a, m] = iso.split('-'); return ['jan','fev','mar','abr','mai','jun','jul','ago','set','out','nov','dez'][Number(m) - 1] + '/' + a.slice(2); };
  const ordem = ['IFOOD', 'SALÃO', 'SITE PRÓPRIO', 'ATACADO', 'FILIAIS'];
  const nome = { 'IFOOD': 'iFood', 'SALÃO': 'Salão (com balcão)', 'SITE PRÓPRIO': 'Site próprio', 'ATACADO': 'Atacado', 'FILIAIS': 'Filiais (listas)' };

  // Janela = os 3 ultimos meses fechados (a view de precificacao ja decide quais).
  const pctMap = {}; RATEIO.pct.forEach(r => pctMap[r.canal] = r);
  const de = RATEIO.pct.length ? RATEIO.pct[0].de : null, ate = RATEIO.pct.length ? RATEIO.pct[0].ate : null;
  const resumoJanela = RATEIO.resumo.filter(r => de && r.mes >= de && r.mes <= ate);
  const porCanal = {};
  resumoJanela.forEach(r => {
    const c = porCanal[r.canal] || (porCanal[r.canal] = { receita: 0, direto: 0, rateado: 0, beneficio: 0, provisorio: false, _de: de, _ate: ate });
    c.receita += Number(r.receita || 0); c.direto += Number(r.custo_direto || 0);
    c.rateado += Number(r.custo_rateado || 0); c.beneficio += Number(r.beneficio_ifood || 0);
    c.provisorio = c.provisorio || !!r.provisorio;
  });
  const canais = ordem.filter(c => porCanal[c]);
  if (!canais.length) {
    alvo.innerHTML = rateioBarraUnidades() + '<div class="contexto" style="border-color:#c8102e;">Sem dado de rateio ainda para esta loja — a materializada é recalculada na rotina das 07:30.</div>';
    return;
  }
  if (!porCanal[RATEIO_CANAL]) RATEIO_CANAL = canais[0];

  // O markup do canal, do jeito que o dono pensa (25/08/2026): o custo de operar
  // vira um multiplicador sobre o custo da ficha. E 1/sobra — varia um pouco por
  // produto (embalagem), entao o numero e referencia, nao regra por item.
  const multDe = (c) => {
    const ref = rateioRefCanal(c);
    if (!ref) return null;
    const alvoUm = rateioAlvo(Object.assign({}, ref, { custo_ficha: 1, preco_alvo_final: null }), RATEIO_MARGEM);
    return alvoUm ? alvoUm.toFixed(1).replace('.', ',') : null;
  };
  const plDe = (c) => { const ref = rateioRefCanal(c); return ref ? Number(ref.pct_pro_labore || 0) : 0; };
  const cards = canais.map(c => {
    const x = porCanal[c];
    const real = x.receita ? (x.direto + x.rateado) / x.receita : 0;
    const cheia = x.receita ? (x.direto + x.rateado + x.beneficio) / x.receita : 0;
    const sobra = 1 - cheia;
    const m = multDe(c);
    const plp = plDe(c);
    return `<div class="card rateio-card ${c === RATEIO_CANAL ? 'ativo' : ''}" onclick="rateioCanal('${c}')">
      <div class="card-lbl">${nome[c] || c}</div>
      <div class="card-val">${m ? `ficha × ${m}` : pc(cheia)}</div>
      <div class="card-pct">${m ? `é o preço alvo aqui · ${pc(cheia)} de custo` : 'de cada R$ 100 vai para operar'}${x.beneficio ? ` · real ${pc(real)}` : ''}</div>
      <div class="card-pct" style="color:#8a897e; font-size:12px;">vendeu ${reais(x.receita)} · sobram ${pc(sobra - plp)} para ingrediente e lucro${plp > 0.0005 ? ` (pró-labore de ${pc(plp)} já descontado)` : ' (sem pró-labore local)'}</div>
    </div>`;
  }).join('');

  const temPreco = RATEIO.preco.some(r => r.canal === RATEIO_CANAL);
  const sobraRef = RATEIO.preco.find(r => r.canal === RATEIO_CANAL);
  const mult = multDe(RATEIO_CANAL);
  const pctM = Math.round(100 * RATEIO_MARGEM);
  const pill = (m) => `<button onclick="rateioMargem(${m})" style="font:inherit; font-size:12px; padding:3px 10px; border-radius:999px; cursor:pointer; border:1px solid ${Math.abs(m - RATEIO_MARGEM) < 0.001 ? '#c8102e' : '#34332f'}; background:${Math.abs(m - RATEIO_MARGEM) < 0.001 ? '#c8102e' : '#1a1a19'}; color:#fff;">${Math.round(100 * m)}%</button>`;
  const plPct = plDe(RATEIO_CANAL);
  const precoBloco = temPreco ? `
    <div class="section-label">Preço alvo · ${nome[RATEIO_CANAL] || RATEIO_CANAL} — comissão cheia, pró-labore pago e o lucro que você escolher</div>
    <div class="contexto">Lucro final desejado: ${[0.05, 0.10, 0.15, 0.20].map(pill).join(' ')} &nbsp;·&nbsp; com ${pctM}%, o preço alvo neste canal é o <b>custo da ficha × ~${mult || '—'}</b>.
      ${plPct > 0.0005 ? `Pró-labore da loja (${pc(plPct)}) já descontado.` : 'Sem pró-labore local.'}
      <b>Clique num produto para abrir a conta dele.</b> Lucro abaixo de ${pctM}% âmbar; negativo, vermelho.</div>
    <div style="display:flex; flex-wrap:wrap; gap:10px; align-items:center; margin:10px 0 6px;">
      <span style="font-size:12px; color:var(--tx-3);">ordenar:</span>
      <select onchange="rateioOrdem(this.value)" style="font:inherit; font-size:12.5px; background:#111110; color:#fff; border:1px solid #34332f; border-radius:6px; padding:3px 6px;">
        <option value="margem" ${RATEIO_ORDEM === 'margem' ? 'selected' : ''}>pior margem primeiro</option>
        <option value="ganho" ${RATEIO_ORDEM === 'ganho' ? 'selected' : ''}>maior ganho primeiro</option>
        <option value="vendidos" ${RATEIO_ORDEM === 'vendidos' ? 'selected' : ''}>mais vendidos primeiro</option>
        <option value="nome" ${RATEIO_ORDEM === 'nome' ? 'selected' : ''}>A a Z</option>
      </select>
      <input type="text" placeholder="buscar produto" oninput="rateioBusca(this.value)" style="background:#111110; color:#fff; border:1px solid #34332f; border-radius:6px; padding:4px 8px;" value="${RATEIO_BUSCA}">
    </div>
    <div id="tabelaRateioPreco"></div>` : '';

  alvo.innerHTML = `
    <div class="section-label" style="border-top:none; margin-top:0; padding-top:0;">Preço alvo por produto · ${mesNome(de)} a ${mesNome(ate)}</div>
    ${rateioBarraUnidades()}
    <div class="contexto" title="O custo de operar cada canal vira um markup sobre o custo da ficha; a matéria-prima entra pela ficha. Leitura cheia: comissão de 9,5% do iFood, que o benefício zera até dez/26–jan/27 — é por ela que se precifica. Venda por canal, horário e dia: Evolução de vendas.">Cartões: de cada R$ 100 vendidos, quanto vai para operar o canal (comissão cheia). Clique no canal.${canais.some(c => porCanal[c].provisorio) ? ' <span style="color:var(--tx-3);">Parte da folha ainda cai na proporção geral (nomes sem setor).</span>' : ''}</div>
    ${(RATEIO.semCriterio || []).length ? `<div class="contexto" style="border-color:#c8102e;"><b>Conta nova sem critério de rateio</b> — está caindo em "por vendas" sem ninguém ter decidido: ${RATEIO.semCriterio.map(r => `${String(r.subtipo).toLowerCase()} (${reais(r.valor_3m)} em 3 meses)`).join(' · ')}. Decidir em rateio_criterios.</div>` : ''}
    <div class="cards">${cards}</div>
    ${precoBloco}`;
  if (temPreco) renderRateioPreco();
}

function renderRateioPreco() {
  const el = document.getElementById('tabelaRateioPreco');
  if (!el || !RATEIO) return;
  const reais = (v) => v == null ? '—' : 'R$ ' + fmt(Number(v));
  const pc = (v) => v == null ? '—' : (100 * Number(v)).toFixed(1).replace('.', ',') + '%';
  let ls = RATEIO.preco.map((r, i) => ({ r, i })).filter(x => x.r.canal === RATEIO_CANAL);
  if (RATEIO_BUSCA) ls = ls.filter(x => ((x.r.nome_base || '') + ' ' + (x.r.produto || '')).toUpperCase().includes(RATEIO_BUSCA));
  const cor = (m) => m == null ? '' : (m < 0 ? 'color:#e0523f;' : (m < RATEIO_MARGEM ? 'color:#d9a21b;' : ''));
  // lucro final ja vem da vw_margem_produto, depois do pro-labore (07/11/2026)
  const lucroDe = (m) => m == null ? null : Number(m);
  // ganho em 30 dias se o produto for pro alvo VENDENDO O MESMO — teto, nao promessa
  const ganhoDe = (r) => {
    const alvo = rateioAlvo(r, RATEIO_MARGEM);
    if (alvo == null || r.preco_atual == null || !Number(r.qtd_vendida)) return 0;
    return Math.max(0, Number(r.qtd_vendida) * (alvo - Number(r.preco_atual)));
  };
  const semNulo = (v, pior) => v == null ? pior : Number(v);
  if (RATEIO_ORDEM === 'ganho') ls = [...ls].sort((a, b) => ganhoDe(b.r) - ganhoDe(a.r));
  else if (RATEIO_ORDEM === 'vendidos') ls = [...ls].sort((a, b) => semNulo(b.r.qtd_vendida, -1) - semNulo(a.r.qtd_vendida, -1));
  else if (RATEIO_ORDEM === 'nome') ls = [...ls].sort((a, b) => (a.r.nome_base || a.r.produto || '').localeCompare(b.r.nome_base || b.r.produto || ''));
  else ls = [...ls].sort((a, b) => semNulo(a.r.lucro_final_cheio, 9) - semNulo(b.r.lucro_final_cheio, 9));
  const pctM = Math.round(100 * RATEIO_MARGEM);

  // a conta do produto, linha a linha, no formato da planilha antiga do dono
  // (aba iFood de "Formacao de precos.xlsx"): preco → variaveis → margem de
  // contribuicao → fixos → pro-labore → lucro final
  // 07/11/2026: as linhas sao os pct_* da vw_margem_produto, sem conta propria
  const contaDoProduto = (r) => {
    const P = r.preco_atual != null ? Number(r.preco_atual) : null;
    if (!P) return '<div class="contexto">Sem preço para abrir a conta.</div>';
    const n = (k) => Number(r[k] || 0);
    const li = (nome2, v, forte) => `<tr${forte ? ' style="font-weight:700;"' : ''}><td style="padding:3px 10px;">${nome2}</td><td style="text-align:right; padding:3px 10px;">${reais(v)}</td><td style="text-align:right; padding:3px 10px;">${(100 * v / P).toFixed(1).replace('.', ',')}%</td></tr>`;
    const emb = P * n('pct_embalagem');
    const contrib = P - Number(r.custo_ficha) - emb - P * n('pct_venda');
    return `<table style="font-size:12.5px; background:#171716; margin:4px 0 8px 22px; max-width:440px;">
      <tbody>
        ${li('Preço de hoje', P, true)}
        ${Number(r.custo_ficha) > 0
          ? li('<a href="javascript:void(0)" onclick="irParaFicha((RATEIO.preco[RATEIO_ABERTO]||{}).produto)" style="color:var(--tx-3);" title="Abre a ficha técnica deste produto: ingrediente a ingrediente, com a origem de cada custo de matéria-prima.">(−) ingrediente (ficha) →</a>', Number(r.custo_ficha))
          : li('(−) ingrediente (ficha)', Number(r.custo_ficha))}
        ${emb > 0.005 ? li('(−) embalagem', emb) : ''}
        ${li('(−) vender: impostos, iFood, pagamento, entrega', P * n('pct_venda'))}
        ${li('= margem de contribuição', contrib, true)}
        ${n('pct_mo_aplicada') > 0.0005 ? li('(−) mão de obra', P * n('pct_mo_aplicada')) : ''}
        ${li('(−) administração', P * n('pct_adm'))}
        ${n('pct_uso_consumo') > 0.0005 ? li('(−) uso e consumo', P * n('pct_uso_consumo')) : ''}
        ${n('pct_outros') > 0.0005 ? li('(−) outros', P * n('pct_outros')) : ''}
        ${n('pct_pro_labore') > 0.0005 ? li('(−) pró-labore', P * n('pct_pro_labore')) : ''}
        ${li('= lucro final real', P * n('lucro_final_real'), true)}
        ${n('pct_beneficio_ifood') > 0.0005 ? li('(−) comissão que o benefício do iFood zera hoje', P * n('pct_beneficio_ifood')) : ''}
        ${n('pct_beneficio_ifood') > 0.0005 ? li('= lucro final cheio', P * n('lucro_final_cheio'), true) : ''}
      </tbody></table>
      <div class="caption-label" style="text-align:left; margin:0 0 8px 22px;">Promoção e combo precisam pagar ao menos a <b>margem de contribuição</b> — vender abaixo dela é pagar para vender. Os fixos e o pró-labore correm de qualquer jeito.</div>`;
  };

  el.innerHTML = `<table>
    <thead><tr><th>produto</th><th>vendidos 30d</th><th>custo ficha</th><th title="O preço que MAIS APARECEU nas vendas do Saipos neste canal nos últimos 30 dias — não é média (24/08/2026: a média misturava adicional, promoção e preço antigo, e mostrava bebida de R$ 8 como R$ 26). O ⚠ marca produto cujo preço variou mais de 15% no período. Produto sem venda no canal aparece sem preço: a planilha do iFood saiu de vez em 24/08, errava em 15 de 15 itens conferidos — em branco é melhor que errado.">preço atual</th><th>CMV</th><th>lucro real</th><th>lucro cheio</th><th>preço p/ ${pctM}%</th><th title="Quanto entraria a mais em 30 dias levando o produto ao alvo e VENDENDO A MESMA QUANTIDADE — subir preço pode derrubar volume; o número é o teto, não a promessa.">ganho 30d no alvo</th></tr></thead>
    <tbody>${ls.slice(0, 300).map(({ r, i }) => { const alvoM = rateioAlvo(r, RATEIO_MARGEM); const ganho = ganhoDe(r); return `<tr onclick="rateioAbrir(${i})" style="cursor:pointer;">
      <td>${RATEIO_ABERTO === i ? '▾ ' : ''}${(r.nome_base || r.produto).toLowerCase()}${r.fora_da_base ? ' <span class="ficha-tag">fora da base</span>' : ''}${Number(r.ingredientes_sem_custo) > 0 ? ' <span class="ficha-tag">ficha incompleta</span>' : ''}</td>
      <td>${r.qtd_vendida != null ? Number(r.qtd_vendida).toLocaleString('pt-BR', {maximumFractionDigits:0}) : '<span style="color:#8a897e;">planilha</span>'}</td>
      <td>${reais(r.custo_ficha)}</td>
      <td>${r.preco_atual == null
          ? '<span style="color:#8a897e;" title="Sem venda deste produto no canal nos últimos 90 dias — e a planilha do iFood saiu de vez em 24/08 por errar em 15 de 15 itens. Preço em branco é melhor que preço errado.">sem venda</span>'
          : reais(r.preco_atual)}${r.preco_instavel
          ? ` <span title="Neste produto o preço variou de ${reais(r.preco_min)} a ${reais(r.preco_max)} no período — tem adicional ou promoção no meio. O valor mostrado é o preço que mais apareceu." style="color:#d9a21b; cursor:help;">⚠</span>`
          : ''}</td>
      <td>${pc(r.pct_ficha)}</td>
      <td style="${cor(lucroDe(r.lucro_final_real))}">${pc(lucroDe(r.lucro_final_real))}</td>
      <td style="${cor(lucroDe(r.lucro_final_cheio))}">${pc(lucroDe(r.lucro_final_cheio))}</td>
      <td>${reais(alvoM)}</td>
      <td>${ganho >= 1 ? '<b>' + reais(ganho) + '</b>' : '—'}</td></tr>${RATEIO_ABERTO === i ? `<tr><td colspan="9">${contaDoProduto(r)}</td></tr>` : ''}`; }).join('')}</tbody></table>
    ${ls.length > 300 ? `<div class="contexto">Mostrando 300 de ${ls.length} — use a busca.</div>` : ''}`;
}


// ============ ENGENHARIA DE CARDÁPIO ============
// Cruza quanto cada item VENDE com quanto SOBRA nele, e diz o que fazer com
// cada um. Só Água Verde por ora (decisão do dono 19/08: fechar aqui e depois
// replicar no São Braz).
//
// A margem aqui é PREÇO − CMV. Não é lucro: falta comissão do iFood, taxa de
// cartão, embalagem, mão de obra e ponto. Por isso os percentuais são altos
// (77% a 88%) — o aviso está na tela para ninguém ler como sobra de caixa.
let ENGCARD = null;
let ENGCARD_DIAS = 30;
let ENGCARD_GRUPO = null;   // filtro por grupo ao clicar no card
let ENGCARD_COMBO = null;   // custo do combo SO com os itens obrigatorios (regra do dono 19/08)
let ENGCARD_ADIC = null;    // venda de adicional: a segunda linha de negocio
let ENGCARD_ESTRUT = null;  // cadastro do cardapio no iFood (grupos e copias)
let ENGCARD_ALCANCE = null; // alcance x resultado de cada adicional

async function entrarEngcard() {
  const alvo = document.getElementById('view-engcard');
  if (!alvo) return;
  if (ENGCARD === null) {
    alvo.innerHTML = '<div class="contexto">Carregando a engenharia de cardápio...</div>';
    const de = new Date(Date.now() - 91 * 864e5).toISOString().slice(0, 10);
    const [itens, combos, adicionais, estrutura, alcance] = await Promise.all([
      // 07/11/2026: a mv acha o nome da base venda a venda; a tela agrupa por ele
      consultarTudo('mv_engenharia_cardapio?select=shift_date,item,nome_base,grupo,fora_da_base,unidades,receita,custo,margem' +
                    '&unidade=eq.AGUA%20VERDE&shift_date=gte.' + de),
      consultarTudo('mv_combo_obrigatorio?select=*&unidade=eq.AGUA%20VERDE&order=shift_date,combo,preco_combo&shift_date=gte.' + de),
      consultarTudo('mv_adicional_venda?select=*&unidade=eq.AGUA%20VERDE&order=shift_date,adicional,receita&shift_date=gte.' + de),
      consultarTudo('vw_ifood_estrutura_grupo?select=*'),
      consultarTudo('vw_ifood_adicional_alcance?select=*&unidade=eq.AGUA%20VERDE'),
    ]);
    ENGCARD = itens; ENGCARD_COMBO = combos; ENGCARD_ADIC = adicionais;
    ENGCARD_ESTRUT = estrutura; ENGCARD_ALCANCE = alcance;
  }
  renderModuloEngcard();
}
function engcardPeriodo(d) { ENGCARD_DIAS = d; renderModuloEngcard(); }
function engcardGrupo(g) { ENGCARD_GRUPO = (ENGCARD_GRUPO === g) ? null : g; renderModuloEngcard(); }

function renderModuloEngcard() {
  const alvo = document.getElementById('view-engcard');
  if (!alvo || ENGCARD === null) return;
  const nu = (v) => Number(v) || 0;
  const esc = (s) => String(s == null ? '' : s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/'/g,'&#39;');
  const corte = new Date(Date.now() - ENGCARD_DIAS * 864e5).toISOString().slice(0, 10);

  // Agrupa pelo nome da base (07/11/2026). Venda sem nome na base fica fora dos 4
  // grupos e das medias, num bloco a parte com o nome do caixa.
  // Preço zero (cortesia, funcionário, motoboy) sai linha a linha ANTES de agrupar:
  // senão "X FUNCIONÁRIOS" entra no X pago e derruba a margem e as médias.
  const acc = {}, accFora = {}, accCort = {};
  ENGCARD.filter(r => r.shift_date >= corte).forEach(r => {
    const fora = r.fora_da_base === true;
    const cort = !fora && nu(r.receita) <= 0;
    const k = (fora || cort) ? r.item : (r.nome_base || r.item);
    const dest = fora ? accFora : (cort ? accCort : acc);
    const a = dest[k] || (dest[k] = { item: k, grupoBase: r.grupo || '', un: 0, rec: 0, cus: 0, mg: 0 });
    a.un += nu(r.unidades); a.rec += nu(r.receita); a.cus += nu(r.custo); a.mg += nu(r.margem);
  });
  const foraBase = Object.values(accFora).sort((a,b) => b.rec - a.rec);
  const todos = Object.values(acc);
  const vendidos = todos.filter(a => a.rec > 0);          // preço zero é cortesia
  const cortesia = Object.values(accCort).concat(todos.filter(a => a.rec <= 0));
  if (!vendidos.length) { alvo.innerHTML = '<div class="contexto">Sem itens no período.</div>'; return; }

  // Os cortes são MÉDIA SIMPLES (regra do dono): média de unidades por item e
  // margem média por unidade da casa (ponderada pelo volume, que é a margem
  // real de cada unidade vendida — não a média das médias).
  const unMedio = vendidos.reduce((s,a) => s + a.un, 0) / vendidos.length;
  const mgUnMedio = vendidos.reduce((s,a) => s + a.mg, 0) / vendidos.reduce((s,a) => s + a.un, 0);
  const GRUPOS = {
    CAMPEAO:   { nome: 'Campeões',   cor: 'var(--farol-ok)', o: 'Vende muito e sobra muito', faz: 'Proteger: não mexer no preço nem na receita' },
    POPULAR:   { nome: 'Populares',  cor: '#f6c63e', o: 'Vende muito e sobra pouco', faz: 'Puxa gente. Cada centavo ganho aqui vale muito' },
    ESCONDIDO: { nome: 'Escondidos', cor: 'var(--info)', o: 'Vende pouco e sobra muito', faz: 'Dar destaque, foto e sugestão de venda' },
    'PESO MORTO': { nome: 'Peso morto', cor: 'var(--farol-fora)', o: 'Vende pouco e sobra pouco', faz: 'Repensar a receita, o preço, ou tirar do cardápio' },
  };
  vendidos.forEach(a => {
    a.mgUn = a.mg / a.un;
    a.pct = a.mg / a.rec * 100;
    a.grupo = (a.un >= unMedio)
      ? (a.mgUn >= mgUnMedio ? 'CAMPEAO' : 'POPULAR')
      : (a.mgUn >= mgUnMedio ? 'ESCONDIDO' : 'PESO MORTO');
  });

  const totRec = vendidos.reduce((s,a) => s + a.rec, 0);
  const totMg  = vendidos.reduce((s,a) => s + a.mg, 0);
  const cards = Object.keys(GRUPOS).map(g => {
    const doGrupo = vendidos.filter(a => a.grupo === g);
    const rec = doGrupo.reduce((s,a) => s + a.rec, 0);
    const mg  = doGrupo.reduce((s,a) => s + a.mg, 0);
    const sel = ENGCARD_GRUPO === g;
    return `<div class="card" style="border:1px solid ${GRUPOS[g].cor}; cursor:pointer; ${
        sel ? 'box-shadow:0 0 0 2px ' + GRUPOS[g].cor + ';' : ''}" onclick="engcardGrupo('${g}')">
      <div class="card-lbl">${GRUPOS[g].nome}${sel ? ' ·' : ''}</div>
      <div class="card-val">${doGrupo.length}</div>
      <div class="card-pct">${GRUPOS[g].o}<br><b>${GRUPOS[g].faz}</b><br>R$ ${fmt(mg)} de margem${
        totMg ? ' · ' + (mg / totMg * 100).toFixed(0) + '% do total' : ''}</div></div>`;
  }).join('');

  // Peso morto e Populares sao os quadrantes de margem BAIXA por unidade: ali a pergunta
  // e' "qual doi mais", entao a lista abre pelo pior e pela mesma medida que fez o corte
  // (margem por unidade). Campeoes e Escondidos seguem do maior para o menor em margem
  // total, que e' a leitura de quem carrega o resultado.
  const piorPrimeiro = ENGCARD_GRUPO === 'PESO MORTO' || ENGCARD_GRUPO === 'POPULAR';
  let lista = vendidos.slice().sort((a,b) => piorPrimeiro ? a.mgUn - b.mgUn : b.mg - a.mg);
  if (ENGCARD_GRUPO) lista = lista.filter(a => a.grupo === ENGCARD_GRUPO);
  const linhas = lista.slice(0, 200).map(a => `<tr>
      <td>${esc(a.item)}${a.grupoBase ? ' <span style="color:var(--tx-3); font-size:11px;">· ' + esc(a.grupoBase.toLowerCase()) + '</span>' : ''}</td>
      <td style="color:${GRUPOS[a.grupo].cor};">${GRUPOS[a.grupo].nome}</td>
      <td>${a.un.toLocaleString('pt-BR')}</td>
      <td>R$ ${fmt(a.rec / a.un)}</td>
      <td>R$ ${fmt(a.rec)}</td>
      <td>R$ ${fmt(a.mgUn)}</td>
      <td>R$ ${fmt(a.mg)}</td>
      <td>${a.pct.toFixed(0)}%</td>
    </tr>`).join('');

  // ---- COMBOS: custo medio para PRECIFICAR (o CMV segue usando o custo real) ----
  function blocoCombos() {
    if (!ENGCARD_COMBO || !ENGCARD_COMBO.length) return '';
    const ac = {};
    ENGCARD_COMBO.filter(r => r.shift_date >= corte).forEach(r => {
      const a = ac[r.combo] || (ac[r.combo] = { combo: r.combo, n: 0, rec: 0, cus: 0,
                                                min: Infinity, max: 0 });
      const n = nu(r.vendas);
      a.n += n; a.rec += nu(r.preco_combo) * n; a.cus += nu(r.custo_combo) * n;
      a.min = Math.min(a.min, nu(r.custo_min)); a.max = Math.max(a.max, nu(r.custo_max));
    });
    const linhas = Object.values(ac).filter(a => a.n >= 5)
      .sort((a,b) => b.n - a.n).slice(0, 15).map(a => {
        const preco = a.rec / a.n, custo = a.cus / a.n;
        return `<tr><td>${esc(a.combo)}</td><td>${a.n.toLocaleString('pt-BR')}</td>
          <td>R$ ${fmt(preco)}</td><td><b>R$ ${fmt(custo)}</b></td>
          <td>R$ ${fmt(a.min)} a R$ ${fmt(a.max)}</td>
          <td>R$ ${fmt(preco - custo)}</td>
          <td>${preco ? ((preco - custo) / preco * 100).toFixed(0) : 0}%</td></tr>`;
      }).join('');
    if (!linhas) return '';

    // A tabela "a variação cobre a diferença de custo?" foi RETIRADA em 19/08,
    // horas depois de entrar. Motivo (visto no cardápio do portal): o combo tem
    // DOIS níveis — "Produtos do combo" (os lanches) e "Personalizações do
    // pedido" (acompanhamento, molho, bebida, sobremesa). A API do Saipos manda
    // o item escolhido mas NÃO o grupo a que ele responde, então a tabela
    // comparava lanche com molho e apontava diferenças que não existem. Número
    // que leva a mexer no preço errado é pior que número nenhum.
    // Volta quando mapearmos os grupos de cada combo no portal.
    return `
      <div class="section-label">Combos — quanto custa, só o que é obrigatório</div>
      <div class="caption-label" style="text-align:center;">
        O combo aqui é <b>só o que o cliente é obrigado a escolher</b>. O que ele acrescenta por
        vontade sai desta conta e vira venda de adicional, logo abaixo — são duas coisas
        diferentes e misturá-las estraga as duas. O preço é o pago <b>menos</b> o que veio de
        adicional, e este é o número para <b>decidir o preço do combo</b>.
        <br>Só entram combos cuja composição obrigatória está completa: um combo de dois lanches
        tem que dar dois obrigatórios por venda, e é essa conta que autoriza a linha a aparecer.${ENGCARD_GRUPO ? '<br><b>Este bloco é do cardápio inteiro</b> — o filtro de ' + GRUPOS[ENGCARD_GRUPO].nome + ' vale só para a tabela de itens lá em cima.' : ''}</div>
      <div id="tabelaEngcardCombo"><table>
        <thead><tr><th>Combo</th><th>Vendas</th><th>Preço médio</th><th>Custo médio</th>
          <th>Faixa de custo</th><th>Margem média</th><th>%</th></tr></thead>
        <tbody>${linhas}</tbody></table></div>`;
  }

  // ---- VENDA DE ADICIONAL: a segunda linha de negocio (regra do dono 19/08) ----
  function blocoAdicionais() {
    if (!ENGCARD_ADIC || !ENGCARD_ADIC.length) return '';
    const aa = {};
    ENGCARD_ADIC.filter(r => r.shift_date >= corte).forEach(r => {
      const a = aa[r.adicional] || (aa[r.adicional] = { nome: r.adicional, n: 0, rec: 0, cus: 0,
                                                        prod: 0, ok: true });
      a.n += nu(r.vezes); a.rec += nu(r.receita); a.cus += nu(r.custo);
      a.prod = Math.max(a.prod, nu(r.em_produtos));
      if (r.tem_custo === false) a.ok = false;
    });
    const lista = Object.values(aa).sort((a,b) => b.rec - a.rec);
    if (!lista.length) return '';
    const totRec = lista.reduce((s,a) => s + a.rec, 0);
    const comCusto = lista.filter(a => a.ok);
    const recOk = comCusto.reduce((s,a) => s + a.rec, 0);
    const cusOk = comCusto.reduce((s,a) => s + a.cus, 0);
    const linhas = lista.slice(0, 15).map(a => `<tr>
        <td>${esc(a.nome)}</td>
        <td>${a.n.toLocaleString('pt-BR')}</td>
        <td>R$ ${fmt(a.rec)}</td>
        <td>R$ ${fmt(a.rec / (a.n || 1))}</td>
        <td>${a.ok ? 'R$ ' + fmt(a.cus) : '—'}</td>
        <td>${a.ok && a.rec ? ((1 - a.cus / a.rec) * 100).toFixed(0) + '%' : '—'}</td>
        <td>${a.prod}</td></tr>`).join('');
    return `
      <div class="section-label">Venda de adicional</div>
      <div class="caption-label" style="text-align:center;">
        O que o cliente acrescenta por vontade — <b>faturamento que se soma ao combo</b>, não
        parte dele. Em ${ENGCARD_DIAS} dias foram <b>R$ ${fmt(totRec)}</b>, com margem de
        <b>${recOk ? ((1 - cusOk / recOk) * 100).toFixed(0) : 0}%</b> na parte que tem custo apurado
        (R$ ${fmt(recOk)} de R$ ${fmt(totRec)}).
        A coluna <b>produtos</b> diz em quantos itens do cardápio cada adicional é oferecido —
        adicional que vende bem e está em poucos produtos é oferta a ampliar.${ENGCARD_GRUPO ? '<br><b>Este bloco é do cardápio inteiro</b> — o filtro de ' + GRUPOS[ENGCARD_GRUPO].nome + ' vale só para a tabela de itens lá em cima.' : ''}</div>
      <div id="tabelaEngcardAdic"><table>
        <thead><tr><th>Adicional</th><th>Vezes</th><th>Receita</th><th>Preço médio</th>
          <th>Custo</th><th>Margem</th><th>Produtos</th></tr></thead>
        <tbody>${linhas}</tbody></table></div>`;
  }

  // ---- ESTRUTURA DO CARDAPIO NO IFOOD: o que so o cadastro conta ----
  function blocoEstrutura() {
    if (!ENGCARD_ESTRUT || !ENGCARD_ESTRUT.length) return '';
    const dup = ENGCARD_ESTRUT.filter(g => nu(g.copias) >= 3)
      .sort((a,b) => nu(b.copias) - nu(a.copias)).slice(0, 12);
    const linhasDup = dup.map(g => `<tr>
        <td>${esc(g.grupo)}</td><td>${esc(g.marca)}</td>
        <td><b>${nu(g.copias)}</b></td><td>${nu(g.produtos_qtd)}</td>
        <td>${g.papel === 'PRODUTO' ? 'compõe o combo' : 'adicional'}</td></tr>`).join('');

    // alcance x margem: adicional que rende bem e esta em poucos produtos
    const alc = (ENGCARD_ALCANCE || []).filter(a => nu(a.receita) > 200 && a.tem_custo)
      .sort((a,b) => nu(b.margem_pct) - nu(a.margem_pct)).slice(0, 12);
    const linhasAlc = alc.map(a => `<tr>
        <td>${esc(a.adicional)}</td>
        <td>R$ ${fmt(nu(a.receita))}</td>
        <td>${nu(a.margem_pct).toFixed(0)}%</td>
        <td>${nu(a.em_produtos)}</td></tr>`).join('');

    const totCopias = ENGCARD_ESTRUT.reduce((s,g) => s + nu(g.copias), 0);
    return `
      <div class="section-label">Estrutura do cardápio no iFood</div>
      <div class="caption-label" style="text-align:center;">
        Isto não vem de venda: é o <b>cadastro</b> do cardápio, lido do portal.
        São ${ENGCARD_ESTRUT.length} nomes de grupo em ${totCopias} grupos de fato —
        porque o mesmo grupo existe em várias cópias, uma por produto.
        <b>Mudar o preço de um adicional exige editar todas as cópias</b>, e uma que passe
        batida deixa o mesmo item com dois preços no cardápio.${ENGCARD_GRUPO ? '<br><b>Este bloco é do cardápio inteiro</b> — o filtro de ' + GRUPOS[ENGCARD_GRUPO].nome + ' vale só para a tabela de itens lá em cima.' : ''}</div>
      <div id="tabelaEngcardDup"><table>
        <thead><tr><th>Grupo</th><th>Marca</th><th>Cópias</th><th>Alcance</th><th>Papel</th></tr></thead>
        <tbody>${linhasDup}</tbody></table></div>
      ${linhasAlc ? `
      <div class="section-label">Onde ampliar a oferta de adicional</div>
      <div class="caption-label" style="text-align:center;">
        Adicional que <b>rende bem</b> mas está oferecido em <b>poucos produtos</b> é venda deixada
        na mesa — basta acrescentar o grupo em mais itens. Ordenado por margem, 90 dias.</div>
      <div id="tabelaEngcardAlc"><table>
        <thead><tr><th>Adicional</th><th>Receita 90d</th><th>Margem</th><th>Em quantos produtos</th></tr></thead>
        <tbody>${linhasAlc}</tbody></table></div>` : ''}`;
  }

  const custoCortesia = cortesia.reduce((s,a) => s + a.cus, 0);
  const unCortesia = cortesia.reduce((s,a) => s + a.un, 0);

  alvo.innerHTML = `
    <div class="section-label" style="border-top:none; margin-top:0; padding-top:0;">Engenharia de cardápio — Água Verde</div>
    <div class="caption-label" style="text-align:center;">Corte pela média: <b>${Math.round(unMedio).toLocaleString('pt-BR')} un.</b> por item e <b>R$ ${fmt(mgUnMedio)}</b> de sobra sobre ingrediente por unidade.</div>
    <div style="text-align:center; margin:10px 0;">
      ${[30, 60, 90].map(d => `<button class="preset-btn ${ENGCARD_DIAS === d ? 'active' : ''}"
        onclick="engcardPeriodo(${d})">${d} dias</button>`).join(' ')}
    </div>
    <div class="cards">${cards}</div>
    <div class="caption-label" style="text-align:center;">
      ${ENGCARD_GRUPO ? 'Mostrando só <b>' + GRUPOS[ENGCARD_GRUPO].nome + '</b>, '
                      + (piorPrimeiro ? 'do que menos sobra por unidade para o que mais sobra'
                                      : 'da maior sobra total para a menor')
                      + '. <button class="preset-btn" onclick="engcardGrupo(null)">ver todos</button>'
                      : 'Clique num grupo para filtrar a tabela.'}</div>
    <div id="tabelaEngcard"><table>
      <thead><tr><th>Item</th><th>Grupo</th><th>Unidades</th><th>Preço médio</th>
        <th>Receita</th><th title="preço menos o custo dos ingredientes; não é lucro">Sobra sobre ingrediente (un.)</th><th>Sobra sobre ingrediente (total)</th><th>% da receita</th></tr></thead>
      <tbody>${linhas}</tbody></table></div>
    ${lista.length > 200 ? '<div class="caption-label">Mostrando os 200 maiores de ' + lista.length + '.</div>' : ''}
    ${foraBase.length ? `<div class="section-label">Fora da base · ${foraBase.length} nomes do caixa · R$ ${fmt(foraBase.reduce((s,a) => s + a.rec, 0))}</div>
    <div class="caption-label" style="text-align:center;">Nome do caixa sem produto na base: não entra nos 4 grupos nem nas médias.</div>
    <div id="tabelaEngcardFora"><table>
      <thead><tr><th>Nome no caixa</th><th>Unidades</th><th>Receita</th></tr></thead>
      <tbody>${foraBase.map(a => `<tr><td>${esc(a.item)}</td><td>${a.un.toLocaleString('pt-BR')}</td><td>R$ ${fmt(a.rec)}</td></tr>`).join('')}</tbody></table></div>` : ''}
    ${blocoCombos()}
    ${blocoAdicionais()}
    ${blocoEstrutura()}
    ${cortesia.length ? `<div class="contexto" style="text-align:left; margin-top:14px;">
      <b>Fora da conta (preço zero):</b> ${cortesia.length} itens, ${unCortesia.toLocaleString('pt-BR')} unidades, <b>R$ ${fmt(custoCortesia)}</b> de ingrediente — cortesia, funcionário e motoboy.</div>` : ''}`;
}

// ============ FICHAS TÉCNICAS ============
// Pedido do dono (19/08/2026): "procuro o item numa lista, ele carrega a grade
// com ingredientes, unidade e custo, igual o esquema da Base FT da minha
// planilha, e se houver dúvida em algum custo tenho onde consultar de onde ele
// vem". A grade é a leitura da Base FT; clicar numa linha abre a origem.
//
// As três views são pequenas (311 fichas, 1.085 linhas, ~950 origens), então
// carregam de uma vez e a busca filtra no navegador — sem ida ao banco a cada
// tecla. Consulta apenas: criar/editar ficha ainda não grava (a planilha é a
// fonte de verdade e o import a substitui inteira; ver conversa de 19/08).
let FICHAS = null;
let FICHA_ABERTA = null;
let FICHA_LINHA_ABERTA = null;
// "N sem custo" virou botao (12/09/2026): ligado, a lista de escolha passa a ser SO
// essas fichas. Antes o numero avisava do problema e nao dizia quais eram — para achar
// as 12 sem custo entre 311 so' abrindo uma a uma.
let FICHA_SO_SEM_CUSTO = false;
function fichaSoSemCusto() { FICHA_SO_SEM_CUSTO = !FICHA_SO_SEM_CUSTO; renderModuloFichas(); }
// FORA DE LINHA (08/10/2026). O dono tira o produto de linha e a ficha continua guardada
// no banco; a tela mostrava todas. Quem diz o que saiu e' a coluna fora_de_linha de
// vw_ft_lista (a decisao mora em ft_produto_fora_de_linha) — a tela so' tira da busca e
// avisa quantas sao. Desligado = escondidas. View sem a coluna = nada escondido.
let FICHA_VER_FORA = false;
function fichaVerFora() { FICHA_VER_FORA = !FICHA_VER_FORA; renderModuloFichas(); }

async function entrarFichas() {
  const alvo = document.getElementById('view-fichas');
  if (!alvo) return;
  if (FICHAS === null) {
    alvo.innerHTML = '<div class="contexto">Carregando as fichas técnicas...</div>';
    const [lista, composicao, origem] = await Promise.all([
      consultarTudo('vw_ft_lista?select=*&order=ficha'),
      consultarTudo('vw_ft_composicao?select=*&order=ficha,materia_prima,qtd_ft,fonte'),
      consultarTudo('vw_ft_origem_custo?select=*'),
    ]);
    const porFicha = {};
    composicao.forEach(l => { (porFicha[l.ficha] = porFicha[l.ficha] || []).push(l); });
    const porItem = {};
    origem.forEach(o => { porItem[o.item] = o; });
    FICHAS = { lista, porFicha, porItem };
  }
  renderModuloFichas();
}

// Vem do botao "abrir esta ficha" (origemDoCusto, quando o ingrediente e' uma
// preparacao). Ate 12/09/2026 escrevia num #fichaBusca que NAO EXISTE no painel: o
// clique estourava em null e nada abria. O campo real e' o #fichaSelect, e quem abre
// a ficha e' abrirFicha — que o proprio render usa para preencher o campo.
function fichasFiltro(termo) {
  const nome = (termo || '').trim();
  if (!nome || nome === FICHA_ABERTA) return;   // abrirFicha alterna: sem isto, fecharia
  abrirFicha(nome);
}

// ---- criar / editar ficha no painel (decisão do dono 19/08, "opção 1") ----
// Grava em ft_fichas_manual, tabela própria: import_fichas.py substitui
// ft_fichas inteira a cada carga e apagaria o que fosse criado aqui. A planilha
// continua mandando — se o nome existir nos dois lugares, vale o dela.
let FICHA_EDIT = null;   // { nome, linhas:[{mp,qtd}], original }
let FICHA_MSG = null;    // confirmacao que sobrevive ao fechamento do formulario
// Versao anterior do ultimo salvamento, guardada em memoria para o "desfazer"
// (12/09/2026). Vive so enquanto a aba estiver aberta, e o botao aparece uma vez
// so: FICHA_MSG e' zerado depois de desenhar.
let FICHA_DESFAZER = null;   // { nome, novo, fonte, linhas:[{mp,qtd}] }

function fichaNova() {
  FICHA_EDIT = { nome: '', linhas: [{ mp: '', qtd: '' }, { mp: '', qtd: '' }], original: null };
  renderModuloFichas();
}
function fichaEditar(nome) {
  const linhas = (FICHAS.porFicha[nome] || []).map(l => ({ mp: l.materia_prima, qtd: String(l.qtd_ft) }));
  FICHA_EDIT = { nome, linhas: linhas.length ? linhas : [{ mp: '', qtd: '' }], original: nome };
  renderModuloFichas();
}
function fichaCancelar() { FICHA_EDIT = null; renderModuloFichas(); }
function fichaAddLinha() { fichaLerForm(); FICHA_EDIT.linhas.push({ mp: '', qtd: '' }); renderModuloFichas(); }
function fichaTirarLinha(i) { fichaLerForm(); FICHA_EDIT.linhas.splice(i, 1); renderModuloFichas(); }

// Lê o que está na tela para o estado — chamado antes de qualquer re-render,
// senão o que o usuário digitou some ao adicionar/remover linha.
function fichaLerForm() {
  if (!FICHA_EDIT) return;
  const nome = document.getElementById('fichaNomeNovo');
  if (nome) FICHA_EDIT.nome = nome.value;
  FICHA_EDIT.linhas.forEach((l, i) => {
    const mp = document.getElementById('fichaMp' + i);
    const qt = document.getElementById('fichaQtd' + i);
    if (mp) l.mp = mp.value;
    if (qt) l.qtd = qt.value;
  });
}

async function fichaSalvar() {
  fichaLerForm();
  const aviso = document.getElementById('fichaAviso');
  const diz = (txt, cor) => { aviso.style.display = 'block'; aviso.style.borderColor = cor; aviso.innerHTML = txt; };
  const nome = (FICHA_EDIT.nome || '').trim().toUpperCase();
  if (!nome) return diz('Dê um nome à ficha.', 'var(--farol-fora)');

  const { porItem } = FICHAS;
  const linhas = [];
  for (const l of FICHA_EDIT.linhas) {
    const mp = (l.mp || '').trim();
    const qtd = Number(String(l.qtd).replace(',', '.'));
    if (!mp && !l.qtd) continue;                       // linha em branco: ignora
    const o = porItem[mp];
    if (!o) return diz(`<b>${mp || '(sem nome)'}</b> não existe no cadastro de insumos nem como ficha.
      Só dá para usar matéria-prima que já tem preço — senão a ficha nasce sem custo.`, 'var(--farol-fora)');
    if (!qtd || qtd <= 0) return diz(`Falta a quantidade de <b>${mp}</b>.`, 'var(--farol-fora)');
    const preco = Number(o.preco_un_uso) || 0;
    linhas.push({ nome, materia_prima: mp, un_uso: o.un_uso || (o.tipo === 'FICHA' ? 'KG' : null),
                  qtd_ft: qtd, rendimento: 1, preco_custo: preco,
                  valor_total: Math.round(qtd * preco * 10000) / 10000 });
  }
  if (!linhas.length) return diz('Coloque pelo menos um ingrediente.', 'var(--farol-fora)');

  // Nome que já existe na planilha não pode: ela manda, e a manual seria ignorada.
  const naPlanilha = FICHAS.lista.find(f => f.ficha === nome && f.fonte === 'PLANILHA');
  if (naPlanilha && nome !== FICHA_EDIT.original) {
    return diz(`Já existe <b>${nome}</b> na planilha. A planilha manda, então esta ficha
      seria ignorada. Use outro nome, ou corrija direto na planilha.`, 'var(--farol-fora)');
  }

  diz('Salvando…', 'var(--line)');
  try {
    // troca por completo: apaga o que havia com esse nome e regrava
    const alvo = FICHA_EDIT.original || nome;
    // A versao anterior, guardada ANTES de a troca acontecer. So da para devolver o
    // que era MANUAL: ficha da planilha nunca esteve em ft_fichas_manual, e regravar
    // por cima criaria uma copia que nao existia — la desfazer e' apagar o que entrou.
    const antesFonte = (FICHAS.lista.find(f => f.ficha === alvo) || {}).fonte || null;
    const antesLinhas = antesFonte === 'MANUAL'
      ? (FICHAS.porFicha[alvo] || []).map(l => ({ mp: l.materia_prima, qtd: String(l.qtd_ft) }))
      : [];
    const del = await fetch(`${SUPABASE_URL}/rest/v1/ft_fichas_manual?nome=eq.${encodeURIComponent(alvo)}`,
                            { method: 'DELETE', headers: rmbHeaders({ Prefer: 'return=minimal' }) });
    if (!del.ok && del.status !== 404) throw new Error('não consegui limpar a versão anterior (' + del.status + ')');
    const sess = rmbSessao();
    linhas.forEach(l => { l.criado_por = (sess && sess.email) || 'painel'; });
    const r = await fetch(`${SUPABASE_URL}/rest/v1/ft_fichas_manual`,
                          { method: 'POST', headers: rmbHeaders({ Prefer: 'return=minimal' }),
                            body: JSON.stringify(linhas) });
    if (!r.ok) throw new Error(await r.text());
    FICHA_EDIT = null; FICHAS = null; FICHA_ABERTA = nome;
    FICHA_DESFAZER = { nome: alvo, novo: nome, fonte: antesFonte, linhas: antesLinhas };
    FICHA_MSG = `<b>${nome}</b> salva com ${linhas.length} ingredientes — R$ ${
      fmt(linhas.reduce((t, l) => t + l.valor_total, 0))}. Ela já vale para o CMV.
      <button class="preset-btn" style="margin-left:8px;" onclick="fichaDesfazer()"
              title="Devolve a ficha exatamente como estava antes deste salvamento. Vale só enquanto esta mensagem estiver na tela.">desfazer</button>`;
    await entrarFichas();
  } catch (e) {
    diz('Não deu para salvar: ' + e.message, 'var(--farol-fora)');
  }
}

// DESFAZER o ultimo salvamento (12/09/2026). Refaz a troca inteira em vez de remendar
// linha: apaga o nome novo (e o antigo, quando houve renome) e regrava a versao
// guardada. Meia troca deixaria a ficha com ingrediente das duas versoes.
async function fichaDesfazer() {
  const d = FICHA_DESFAZER;
  if (!d || !FICHAS) return;
  FICHA_DESFAZER = null;
  const apagar = async (n) => {
    const x = await fetch(`${SUPABASE_URL}/rest/v1/ft_fichas_manual?nome=eq.${encodeURIComponent(n)}`,
                          { method: 'DELETE', headers: rmbHeaders({ Prefer: 'return=minimal' }) });
    if (!x.ok && x.status !== 404) throw new Error('não consegui apagar ' + n + ' (' + x.status + ')');
  };
  // quantos ingredientes VOLTARAM de fato — nao os que eu queria devolver. Insumo que
  // saiu do cadastro no meio do caminho nao tem preco para regravar, e a mensagem tem
  // de dizer isso em vez de prometer uma ficha inteira que nao voltou inteira.
  let voltaram = 0;
  try {
    await apagar(d.novo);
    if (d.nome !== d.novo) await apagar(d.nome);
    if (d.linhas.length) {
      const sess = rmbSessao();
      const { porItem } = FICHAS;
      const volta = [];
      for (const l of d.linhas) {
        const o = porItem[l.mp];
        const qtd = Number(String(l.qtd).replace(',', '.')) || 0;
        if (!o || !qtd) continue;
        const preco = Number(o.preco_un_uso) || 0;
        volta.push({ nome: d.nome, materia_prima: l.mp, un_uso: o.un_uso || (o.tipo === 'FICHA' ? 'KG' : null),
                     qtd_ft: qtd, rendimento: 1, preco_custo: preco,
                     valor_total: Math.round(qtd * preco * 10000) / 10000,
                     criado_por: (sess && sess.email) || 'painel' });
      }
      if (volta.length) {
        const x = await fetch(`${SUPABASE_URL}/rest/v1/ft_fichas_manual`,
                              { method: 'POST', headers: rmbHeaders({ Prefer: 'return=minimal' }),
                                body: JSON.stringify(volta) });
        if (!x.ok) throw new Error(await x.text());
      }
      voltaram = volta.length;
    }
    FICHAS = null; FICHA_EDIT = null;
    FICHA_ABERTA = (voltaram || d.fonte === 'PLANILHA') ? d.nome : null;
    FICHA_MSG = d.linhas.length
      ? `<b>${d.nome}</b> voltou para a versão anterior, com ${voltaram} ingredientes.${
          voltaram < d.linhas.length
            ? ` <b>${d.linhas.length - voltaram} não voltaram</b> — o insumo saiu do cadastro desde então. Confira a ficha.`
            : ''}`
      : (d.fonte === 'PLANILHA'
          ? `<b>${d.novo}</b> saiu daqui — vale de novo só a ficha da planilha.`
          : `<b>${d.novo}</b> foi desfeita: não existia antes deste salvamento e voltou a não existir.`);
    await entrarFichas();
  } catch (e) {
    // 12/11/2026 (usabilidade, fichas): barra do núcleo no lugar do alert
    avisoAcao('erro', '✗ Não deu para desfazer: ' + e.message + '. Confira a ficha ' + d.nome + '.');
  }
}

// 12/11/2026 (usabilidade, fichas): a confirmação é uma linha na própria ficha (FICHA_APAGAR) e o retorno é a barra
// do núcleo (enviando → ✓/✗), no lugar do confirm/alert
let FICHA_APAGAR = null;
async function fichaExcluir(nome) {
  FICHA_APAGAR = null;
  avisoAcao('enviando', 'Apagando a ficha ' + nome + '…');
  let r;
  try {
    r = await fetch(`${SUPABASE_URL}/rest/v1/ft_fichas_manual?nome=eq.${encodeURIComponent(nome)}`,
                    { method: 'DELETE', headers: rmbHeaders({ Prefer: 'return=minimal' }) });
  } catch (e) { avisoAcao('erro', '✗ A ficha ' + nome + ' NÃO foi apagada: sem conexão.', () => fichaExcluir(nome)); return; }
  if (!r.ok) { avisoAcao('erro', '✗ A ficha ' + nome + ' NÃO foi apagada (' + r.status + ').', () => fichaExcluir(nome)); return; }
  FICHAS = null; FICHA_ABERTA = null; FICHA_EDIT = null;
  FICHA_MSG = `<b>${nome}</b> apagada.`;
  avisoAcao('ok', '✓ Ficha ' + nome + ' apagada às ' + avisoHora() + '.');
  await entrarFichas();
}

function fichaFormulario() {
  const { porItem } = FICHAS;
  const esc = (s) => String(s == null ? '' : s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/"/g,'&quot;');
  const nomes = Object.keys(porItem).sort();
  const linhas = FICHA_EDIT.linhas.map((l, i) => {
    const o = porItem[(l.mp || '').trim()];
    const preco = o ? Number(o.preco_un_uso) || 0 : null;
    const qtd = Number(String(l.qtd).replace(',', '.')) || 0;
    return `<tr>
      <td><input id="fichaMp${i}" list="fichaInsumos" value="${esc(l.mp)}" placeholder="digite para procurar"
                 oninput="fichaLerForm(); fichaAtualizarPrevia()" class="ficha-inp"></td>
      <td><input id="fichaQtd${i}" value="${esc(l.qtd)}" placeholder="0,000" inputmode="decimal"
                 oninput="fichaLerForm(); fichaAtualizarPrevia()" class="ficha-inp" style="width:90px; text-align:right;"></td>
      <td>${o ? esc(o.un_uso || (o.tipo === 'FICHA' ? 'KG' : '—')) : '—'}</td>
      <td>${preco === null ? '<span style="color:var(--farol-fora);">sem cadastro</span>' : 'R$ ' + fmt(preco)}</td>
      <td>${preco === null ? '—' : '<b>R$ ' + fmt(qtd * preco) + '</b>'}</td>
      <td><button class="preset-btn" onclick="fichaTirarLinha(${i})">tirar</button></td>
    </tr>`;
  }).join('');
  const total = FICHA_EDIT.linhas.reduce((s, l) => {
    const o = porItem[(l.mp || '').trim()];
    return s + (o ? (Number(String(l.qtd).replace(',', '.')) || 0) * (Number(o.preco_un_uso) || 0) : 0);
  }, 0);
  return `
    <div class="section-label">${FICHA_EDIT.original ? 'Editando ' + esc(FICHA_EDIT.original) : 'Nova ficha'}</div>
    <div class="caption-label" style="text-align:center;">
      Só entra matéria-prima que já tem preço — insumo comprado ou outra ficha. O preço vem do
      cadastro; você põe a quantidade. Fica gravada aqui no painel, separada da planilha:
      <b>a planilha continua mandando</b> e reimportá-la não apaga o que você criar.</div>
    <datalist id="fichaInsumos">${nomes.map(n => `<option value="${esc(n)}">`).join('')}</datalist>
    <div class="ficha-busca-linha">
      <input id="fichaNomeNovo" value="${esc(FICHA_EDIT.nome)}" placeholder="Nome da ficha (ex.: NOVO BURGER DA CASA)"
             oninput="fichaLerForm()" style="text-transform:uppercase;">
    </div>
    <div id="tabelaFichaNova"><table>
      <thead><tr><th>Matéria-prima</th><th>Qtd</th><th>Un</th><th>Preço</th><th>Valor</th><th></th></tr></thead>
      <tbody>${linhas}
        <tr class="liq"><td><b>Custo da ficha</b></td><td colspan="3"></td>
          <td id="fichaTotalPrevia"><b>R$ ${fmt(total)}</b></td><td></td></tr>
      </tbody></table></div>
    <div id="fichaAviso" class="contexto" style="display:none; text-align:left; margin-top:10px;"></div>
    <div style="margin-top:12px;">
      <button class="preset-btn" onclick="fichaAddLinha()">＋ ingrediente</button>
      <button class="preset-btn active" onclick="fichaSalvar()" style="margin-left:8px;">Salvar ficha</button>
      <button class="preset-btn" onclick="fichaCancelar()" style="margin-left:8px;">Cancelar</button>
    </div>`;
}

// Recalcula só os números da prévia, sem redesenhar (redesenhar tira o foco do campo).
function fichaAtualizarPrevia() {
  if (!FICHA_EDIT || !FICHAS) return;
  const { porItem } = FICHAS;
  let total = 0;
  FICHA_EDIT.linhas.forEach((l, i) => {
    const o = porItem[(l.mp || '').trim()];
    const qtd = Number(String(l.qtd).replace(',', '.')) || 0;
    const preco = o ? Number(o.preco_un_uso) || 0 : 0;
    total += qtd * preco;
    const tr = document.getElementById('fichaMp' + i);
    if (tr && tr.closest('tr')) {
      const c = tr.closest('tr').cells;
      c[2].textContent = o ? (o.un_uso || (o.tipo === 'FICHA' ? 'KG' : '—')) : '—';
      c[3].innerHTML = o ? 'R$ ' + fmt(preco) : '<span style="color:var(--farol-fora);">sem cadastro</span>';
      c[4].innerHTML = o ? '<b>R$ ' + fmt(qtd * preco) + '</b>' : '—';
    }
  });
  const t = document.getElementById('fichaTotalPrevia');
  if (t) t.innerHTML = '<b>R$ ' + fmt(total) + '</b>';
}
function abrirFicha(nome) {
  FICHA_ABERTA = (FICHA_ABERTA === nome) ? null : nome;
  FICHA_LINHA_ABERTA = null;
  renderModuloFichas();
}
// Vem de OUTRA tela (a conta do produto no Preço alvo, 12/09/2026): marca a ficha
// e troca de modulo. FICHAS pode estar nulo — quem carrega e' entrarFichas(), que
// mostrarModulo('fichas') chama; por isso o alvo e' marcado ANTES de trocar de tela.
function irParaFicha(nome) {
  if (!nome) return;
  FICHA_ABERTA = nome;
  FICHA_LINHA_ABERTA = null;
  FICHA_EDIT = null;
  mostrarModulo('fichas');
}

// Vindo do campo com datalist: só abre quando o texto digitado É uma ficha.
// Enquanto o usuário está no meio da palavra nada acontece — redesenhar a cada
// tecla tiraria o foco do campo e fecharia a lista do navegador.
function fichaEscolheu(txt) {
  if (!FICHAS) return;
  const alvo = (txt || '').trim();
  if (!alvo) { if (FICHA_ABERTA) { FICHA_ABERTA = null; renderModuloFichas(); } return; }
  const achou = FICHAS.lista.find(f => f.ficha === alvo);
  if (achou && achou.ficha !== FICHA_ABERTA) {
    FICHA_ABERTA = achou.ficha;
    FICHA_LINHA_ABERTA = null;
    renderModuloFichas();
  }
}
function abrirOrigemCusto(item) {
  FICHA_LINHA_ABERTA = (FICHA_LINHA_ABERTA === item) ? null : item;
  renderModuloFichas();
}

function renderModuloFichas() {
  const alvo = document.getElementById('view-fichas');
  if (!alvo || FICHAS === null) return;
  const { lista, porFicha, porItem } = FICHAS;
  const nu = (v) => Number(v) || 0;
  const esc = (s) => String(s == null ? '' : s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/'/g,'&#39;').replace(/"/g,'&quot;');
  const semAcento = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g,'').toUpperCase();

  const termo = '';   // o datalist filtra sozinho, no navegador
  const soVendaveis = document.getElementById('fichaSoVendaveis');
  const esconderPrep = soVendaveis ? soVendaveis.checked : true;

  // Fora de linha sai da busca e das contagens do cabecalho; o botao do aviso traz de
  // volta. FICHAS.lista continua INTEIRA de proposito: a trava de nome repetido
  // (fichaSalvar) e o atalho que vem do Preco alvo (irParaFicha) precisam enxergar todas.
  const foraLinha = lista.filter(f => f.fora_de_linha);
  const emLinha = FICHA_VER_FORA ? lista : lista.filter(f => !f.fora_de_linha);

  const semCusto = emLinha.filter(f => !nu(f.custo)).length;

  // Com o botao "sem custo" ligado a lista e' exatamente essas fichas — inclusive as de
  // preparacao, para o numero do botao bater com o que aparece na escolha.
  const visiveis = (FICHA_SO_SEM_CUSTO ? emLinha.filter(f => !nu(f.custo))
                                       : emLinha.filter(f => !(esconderPrep && f.e_preparacao)))
                   .sort((a,b) => a.ficha.localeCompare(b.ficha, 'pt-BR'));

  // Lista suspensa em vez de tabela (pedido do dono, 19/08): com 246 fichas a
  // tabela ocupava a tela inteira e a composição, que é o que interessa, ficava
  // abaixo da dobra. O <select> mostra uma linha e devolve a tela à grade.
  // datalist: o campo aceita texto livre e o navegador mostra tudo que CONTÉM
  // o que foi digitado. Com 246 fichas, digitar "chopp" e ver as 23 é melhor do
  // que rolar uma lista suspensa inteira.
  const opcoes = visiveis.map(f => {
    const marca = [f.e_preparacao ? 'preparação' : null,
                   f.fonte === 'MANUAL' ? 'criada no painel' : null,
                   f.fora_de_linha ? 'FORA DE LINHA' : null,
                   !nu(f.custo) ? 'SEM CUSTO' : null].filter(Boolean).join(', ');
    return `<option value="${esc(f.ficha)}">R$ ${fmt(nu(f.custo))}` +
           `${f.ingredientes ? ' · ' + f.ingredientes + ' ingr.' : ''}` +
           `${marca ? ' · ' + marca : ''}</option>`;
  }).join('');

  // A grade fica FORA da lista, em bloco próprio: tabela dentro de tabela quebra
  // a coluna fixa (o CSS de div[id^="tabela"] gruda a 1ª célula de qualquer tr).
  function gradeDaFicha(nome) {
    const linhas = (porFicha[nome] || []).slice().sort((a,b) => nu(b.valor_total) - nu(a.valor_total));
    if (!linhas.length) return '<div class="contexto">Ficha sem linhas de composição.</div>';
    const total = linhas.reduce((s,l) => s + nu(l.valor_total), 0);
    const vendas = (lista.find(f => f.ficha === nome) || {}).nomes_de_venda;
    // Ficha fora de linha aberta (pelo botao do aviso, pelo nome inteiro digitado ou
    // vinda do Preco alvo): diz que saiu e desde quando; o motivo fica no title.
    const daLista = lista.find(f => f.ficha === nome) || {};
    const foraDesde = daLista.fora_de_linha_desde ? daLista.fora_de_linha_desde.split('-').reverse().join('/') : '';
    const avisoFora = daLista.fora_de_linha ? `<div class="contexto" style="text-align:left;" title="${esc(daLista.fora_de_linha_motivo || '')}">
        <b>Fora de linha${foraDesde ? ' desde ' + foraDesde : ''}.</b> Não aparece mais na busca.${
        nu(vendas) ? ' Se ainda sair venda com o nome ligado a ela, o custo continua vindo desta ficha.' : ''}</div>` : '';
    const corpo = linhas.map(l => {
      const aberto = FICHA_LINHA_ABERTA === l.materia_prima;
      const semPreco = l.origem_do_preco === 'SEM CADASTRO';
      return `<tr class="ficha-linha${aberto ? ' sub' : ''}" onclick="abrirOrigemCusto('${esc(l.materia_prima)}')">
        <td>${aberto ? '▾' : '▸'} ${esc(l.materia_prima)}${
          semPreco ? ' <span style="color:var(--farol-fora);">sem cadastro</span>' : ''}</td>
        <td>${nu(l.qtd_ft).toFixed(3)}</td>
        <td>${esc(l.un_uso)}</td>
        <td>R$ ${fmt(nu(l.preco_custo))}</td>
        <td>${nu(l.rendimento) ? nu(l.rendimento).toFixed(3) : '—'}</td>
        <td><b>R$ ${fmt(nu(l.valor_total))}</b></td>
      </tr>`;
    }).join('');
    const origem = FICHA_LINHA_ABERTA ? origemDoCusto(FICHA_LINHA_ABERTA) : '';
    return `
      <div class="section-label">${esc(nome)}</div>
      ${avisoFora}
      <div class="caption-label" style="text-align:center;">
        Clique num ingrediente para ver de onde vem o custo dele.
        ${nu(vendas) ? nu(vendas) + ' nome' + (nu(vendas) > 1 ? 's' : '') + ' de venda apontam para esta ficha.'
                     : '<b>Nenhum nome de venda aponta para esta ficha</b> — ela não entra no CMV hoje.'}</div>
      <div id="tabelaFichaGrade"><table>
        <thead><tr><th>Matéria-prima</th><th>Qtd</th><th>Un</th>
          <th>Preço custo</th><th>Rendimento</th><th>Valor</th></tr></thead>
        <tbody>${corpo}
          <tr class="liq"><td><b>Custo da ficha</b></td>
            <td colspan="4"></td><td><b>R$ ${fmt(total)}</b></td></tr>
        </tbody></table></div>
      ${origem}
      ${(lista.find(f => f.ficha === nome) || {}).fonte === 'MANUAL' ? `
        <div style="margin-top:10px;">
          <button class="preset-btn" onclick="fichaEditar('${esc(nome)}')">Editar esta ficha</button>
          ${FICHA_APAGAR === nome
            ? `<span style="margin-left:8px; color:var(--farol-fora); font-weight:700;">Apagar esta ficha criada aqui? O CMV deixa de usá-la.</span>
               <button class="preset-btn" onclick="fichaExcluir('${esc(nome)}')" style="margin-left:6px; border-color:var(--farol-fora);">Sim, apagar</button>
               <button class="preset-btn" onclick="FICHA_APAGAR=null; renderModuloFichas();" style="margin-left:6px;">cancelar</button>`
            : `<button class="preset-btn" onclick="FICHA_APAGAR='${esc(nome)}'; renderModuloFichas();" style="margin-left:8px;">Apagar</button>`}
        </div>` : ''}`;
  }

  function origemDoCusto(item) {
    const o = porItem[item];
    if (!o) return `<div class="contexto" style="border-color:var(--farol-fora);">
      <b>${esc(item)}</b> não está cadastrado nem como insumo nem como ficha — por isso a
      linha fica sem preço.</div>`;
    if (o.tipo === 'FICHA') {
      return `<div class="contexto" style="text-align:left;">
        <b>${esc(item)}</b> é uma <b>preparação</b>: o custo dela vem da própria ficha
        (${o.ingredientes} ingredientes, R$ ${fmt(nu(o.preco_un_uso))}).
        <button class="preset-btn" style="margin-left:8px;" onclick="fichasFiltro('${esc(item)}')">abrir esta ficha</button></div>`;
    }
    const esperado = nu(o.preco_un_uso_esperado);
    const usado = nu(o.preco_un_uso);
    // Desde 12/09/2026 o custo vigente vem da ÚLTIMA NOTA FISCAL do Saipos
    // (ft_compras_nf → ft_aplicar_custo_compra). Quando é a nota que manda,
    // a "compra" da planilha é só o cadastro antigo — não vale cobrar conversão.
    const daNota = o.custo_fonte === 'NF';
    const bate = daNota || !esperado || Math.abs(esperado - usado) < 0.01;
    const dataNf = o.custo_data ? o.custo_data.split('-').reverse().join('/') : '';
    return `<div class="contexto" style="text-align:left; ${bate ? '' : 'border-color:var(--farol-fora);'}">
      <b>${esc(item)}</b> é insumo comprado.
      ${daNota ? (String(o.base_custo || '').startsWith('MEDIANA')
        ? `<b>Custo pelas notas:</b> R$ ${fmt(usado)} por ${esc(o.un_uso)} — <b>mediana das ${nu(o.n_60d)}
           notas dos últimos 60 dias</b>${o.custo_nome_saipos ? ', item <b>' + esc(o.custo_nome_saipos) + '</b> no Saipos' : ''}.
           A última, de ${dataNf}${o.custo_nf ? ' (' + esc(o.custo_nf) + ')' : ''}, veio a R$ ${fmt(nu(o.custo_ultima_nota))}.
           A mediana é a régua porque uma compra solta oscila (hortifrúti muda toda semana).`
        : `<b>Última compra:</b> R$ ${fmt(usado)} por ${esc(o.un_uso)} em ${dataNf}${
           o.custo_nf ? ' (' + esc(o.custo_nf) + ')' : ''}${
           o.custo_nome_saipos ? ', item <b>' + esc(o.custo_nome_saipos) + '</b> no Saipos' : ''}.
           Só esta nota nos últimos 60 dias, então é ela que vale.`) : ''}
      ${o.custo_fonte === 'AJUSTE' ? `<b>Custo corrigido pelo Neto:</b> R$ ${fmt(usado)} por ${esc(o.un_uso)}
        (a planilha trazia outro valor; sem nota fiscal recente para conferir).` : ''}
      ${nu(o.qtd_un_compra) ? `<br><b>${daNota ? 'Cadastro da planilha' : 'Compra'}:</b> ${nu(o.qtd_un_compra).toFixed(3)} ${esc(o.un_compra)} por
      R$ ${fmt(nu(o.preco_un_compra))}${o.fornecedor ? ' — fornecedor <b>' + esc(o.fornecedor) + '</b>' : ''}${
        (o.marca && o.marca !== o.fornecedor) ? ' (marca ' + esc(o.marca) + ')' : ''}.` : ''}
      ${daNota || o.custo_fonte === 'AJUSTE' ? '' : `<b>Uso na ficha:</b> R$ ${fmt(usado)} por ${esc(o.un_uso)}
        (custo da planilha — sem nota fiscal nos últimos 90 dias).`}
      ${bate ? '' : `<br><b style="color:var(--farol-fora);">A conversão não fecha:</b> pelo preço de compra
        deveria ser R$ ${fmt(esperado)} por ${esc(o.un_uso)}, e a ficha usa R$ ${fmt(usado)}.`}</div>`;
  }

  alvo.innerHTML = `
    <div class="section-label" style="border-top:none; margin-top:0; padding-top:0;">Fichas técnicas</div>
    <div class="caption-label" style="text-align:center;" title="Ficha criada aqui fica numa tabela própria (ft_fichas_manual) e é reaplicada depois de cada carga da planilha; se o mesmo nome existir nos dois lugares, vale o da planilha.">
      ${emLinha.length} fichas — ${emLinha.filter(f=>!f.e_preparacao).length} vendáveis e
      ${emLinha.filter(f=>f.e_preparacao).length} de preparação (base que outra ficha consome).
      ${semCusto ? `<button class="preset-btn ${FICHA_SO_SEM_CUSTO ? 'active' : ''}" onclick="fichaSoSemCusto()" title="${FICHA_SO_SEM_CUSTO ? 'voltar para a lista completa' : 'trocar a lista de escolha por essas fichas'}"><b style="color:var(--farol-fora);">${semCusto} sem custo calculado</b>${FICHA_SO_SEM_CUSTO ? ' ✕' : ' ›'}</button>` : ''}
      ${foraLinha.length ? `<button class="preset-btn ${FICHA_VER_FORA ? 'active' : ''}" onclick="fichaVerFora()" title="${FICHA_VER_FORA ? 'esconder de novo as fichas fora de linha' : 'produto que saiu de linha: a ficha continua guardada, só não aparece na busca. Clique para ver.'}">${foraLinha.length} fora de linha ${FICHA_VER_FORA ? 'na lista ✕' : (foraLinha.length > 1 ? 'não aparecem ›' : 'não aparece ›')}</button>` : ''}
      Pode criar e editar ficha aqui — reimportar a planilha não apaga o que você criar.</div>
    ${FICHA_MSG ? '<div class="contexto" style="border-color:var(--farol-ok); text-align:left;">' + FICHA_MSG + '</div>' : ''}
    <div class="ficha-busca-linha">
      <label class="ficha-check"><input type="checkbox" id="fichaSoVendaveis" ${esconderPrep ? 'checked' : ''}
             onchange="renderModuloFichas()"> esconder preparações</label>
      <button class="preset-btn active" onclick="fichaNova()">＋ Nova ficha</button>
    </div>
    <div class="ficha-busca-linha">
      <input id="fichaSelect" list="fichaLista" autocomplete="off"
             placeholder="${FICHA_SO_SEM_CUSTO ? 'Só as ' + visiveis.length + ' fichas sem custo — digite parte do nome' : 'Digite parte do nome (' + visiveis.length + ' fichas) — ex.: chopp, ayrton, feijoada'}"
             value="${esc(FICHA_ABERTA || '')}"
             oninput="fichaEscolheu(this.value)">
      <datalist id="fichaLista">${opcoes}</datalist>
    </div>
    ${FICHA_ABERTA ? gradeDaFicha(FICHA_ABERTA)
                   : '<div class="contexto">Escolha uma ficha acima para ver a composição.</div>'}`;
  if (FICHA_EDIT) alvo.insertAdjacentHTML('afterbegin', fichaFormulario());

  FICHA_MSG = null;
}

