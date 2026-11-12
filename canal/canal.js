// CANAL (05/11/2026, bloco 6 da migração): MOVIDO do docs/dashboard.html, sem mudar nada.
// Resumo do canal, Promoções, Cancelamentos, Contestações, Atendimento, Negociações, Avaliações, Relatórios,
// Qualidade & Super, Cardápio, Clientes, Site próprio, Atrasos e turnos, Frete por distância e Financeiro da
// logística. Quem carrega: o painel antigo e docs/canal/index.html. Lê o núcleo (nucleo.js, graficos.js,
// vendas.js); a página define renderAll, mostrarModulo e moduloAtivo. Quem mexe: o chat "Telas do painel".

// Liquido por loja no periodo (mesma formula validada, agregada por loja): bruto − custos
// iFood − marketing. Usada na tabela "Liquido por loja" da Visao Geral.
function resumoPorLojaPeriodo(ini, fim) {
  const activeL = activeLojas();
  const porLoja = new Map();
  const g = (i) => {
    if (!porLoja.has(i)) porLoja.set(i, { ped: 0, itens: 0, frete: 0, promo: 0, fsd: 0, taxas: 0, ads: 0, ress: 0 });
    return porLoja.get(i);
  };
  linhasFiltradas(true, ini, fim).forEach(r => {
    if (r[6] === 1) return;
    const o = g(r[0]);
    o.ped += r[7]; o.itens += (r[8] - r[9]); o.frete += r[10]; o.promo += r[13]; o.fsd += r[16];
  });
  CONCILIACAO.forEach(c => {
    if (!activeL.has(c[0])) return;
    if (ini && c[1] < ini) return;
    if (fim && c[1] > fim) return;
    const o = g(c[0]);
    if (c[2] === 'ANUNCIOS') o.ads += -c[3];
    else if (c[2] === 'RESSARCIMENTO_CANCELAMENTO') o.ress += c[3];
    else o.taxas += -c[3]; // taxa online, comissao, mensalidade, outros ajustes, entrega do iFood
  });
  const out = new Map();
  porLoja.forEach((o, i) => {
    const bruto = o.itens + o.frete;
    const liq = bruto - ((o.taxas + o.fsd - o.ress) + (o.promo + o.ads));
    out.set(i, { ped: o.ped, bruto, liq });
  });
  return out;
}

// Clicar na linha da loja DIRIGE o filtro de marcas do topo — de proposito NAO existe
// um estado de filtro paralelo aqui: dois estados para a mesma coisa e o caminho mais
// curto para o painel mostrar dois numeros diferentes da mesma loja. O recorte fica
// visivel onde a pessoa ja olha ("Marcas (loja): 1 de 13") e sai pelo proprio filtro.
// Clicar de novo na loja que ja esta sozinha volta para todas — e a saida sem ter de
// procurar o menu, o mesmo papel do X dos chips do modulo evolucao.
function focarLojaNoFiltro(i) {
  const checks = Array.from(lojaOptCont.querySelectorAll('input[data-l]'));
  if (!checks.some(c => Number(c.dataset.l) === i)) return;
  const jaSozinha = checks.filter(c => c.checked).length === 1
    && checks.some(c => c.checked && Number(c.dataset.l) === i);
  checks.forEach(c => { c.checked = jaSozinha ? true : Number(c.dataset.l) === i; });
  updateLojaSummary();
  renderAll();
}

function tabelaLiquidoPorLoja(ant) {
  const atual = resumoPorLojaPeriodo(fDataIni.value, fDataFim.value);
  const anterior = ant ? resumoPorLojaPeriodo(ant.ini, ant.fim) : null;

  const lista = [...atual.entries()]
    .map(([i, o]) => {
      const prev = anterior && anterior.get(i);
      let varTxt = '—';
      if (prev && Math.abs(prev.liq) > 0.005) {
        const v = (o.liq - prev.liq) / Math.abs(prev.liq) * 100;
        const palavra = v > 0.05 ? 'subiu' : v < -0.05 ? 'caiu' : 'estável';
        const cor = palavra === 'estável' ? '#8a897e' : (v > 0 ? 'var(--farol-ok)' : 'var(--farol-fora)');
        varTxt = `<span style="color:${cor}; font-weight:bold;">${palavra}${palavra !== 'estável' ? ' ' + pct(Math.abs(v)) + '%' : ''}</span>`;
      }
      return { nome: LOJAS[i], idx: i, ...o, varTxt };
    })
    .filter(x => x.ped > 0 || Math.abs(x.liq) > 0.005)
    .sort((a, b) => b.liq - a.liq);

  if (!lista.length) return '';

  return `<div class="section-label">Líquido por loja</div>
  <div class="caption-label" style="text-align:center;">Clique numa loja para ver só ela.</div>
  <div id="tabelaLojasResumo">
    <table>
      <tr><th>Loja</th><th>Pedidos</th><th>Bruto</th><th title="Ordenado do maior para o menor líquido do período.">Líquido</th><th>vs período anterior</th></tr>
      ${lista.map(x => `<tr style="cursor:pointer;" title="Ver só ${x.nome}: o painel inteiro passa a mostrar apenas esta loja. Clique de novo para voltar a todas." onclick="focarLojaNoFiltro(${x.idx})"><td>${x.nome}</td><td>${x.ped.toLocaleString('pt-BR')}</td>
        <td>R$ ${fmt(x.bruto)}</td><td><b>R$ ${fmt(x.liq)}</b></td><td>${x.varTxt}</td></tr>`).join('')}
      ${(() => { const t = lista.reduce((a, x) => ({ ped: a.ped + x.ped, bruto: a.bruto + x.bruto, liq: a.liq + x.liq }), { ped: 0, bruto: 0, liq: 0 });
        return `<tr class="liq"><td>TOTAL</td><td>${t.ped.toLocaleString('pt-BR')}</td>
          <td>R$ ${fmt(t.bruto)}</td><td><b>R$ ${fmt(t.liq)}</b></td><td></td></tr>`; })()}
    </table>
  </div>`;
}

// Variacao compacta em texto (subiu/caiu + cor), para tabelas.
// tipo: maiorMelhor | menorMelhor | neutro
function variacaoSpan(atual, anterior, tipo = 'maiorMelhor') {
  if (anterior === null || anterior === undefined || !isFinite(anterior)) return '<span style="color:#8a897e;">—</span>';
  if (Math.abs(anterior) < 0.005) {
    return Math.abs(atual) < 0.005
      ? '<span style="color:#8a897e;">—</span>'
      : '<span style="color:#8a897e;">apareceu agora</span>';
  }
  const v = (atual - anterior) / Math.abs(anterior) * 100;
  if (Math.abs(v) < 0.05) return '<span style="color:#8a897e;">estável</span>';
  const subiu = v > 0;
  let cor = '#8a897e';
  if (tipo === 'maiorMelhor') cor = subiu ? 'var(--farol-ok)' : 'var(--farol-fora)';
  else if (tipo === 'menorMelhor') cor = subiu ? 'var(--farol-fora)' : 'var(--farol-ok)';
  return `<span style="color:${cor}; font-weight:bold;">${subiu ? '▲' : '▼'} ${subiu ? 'subiu' : 'caiu'} ${pct(Math.abs(v))}%</span>`;
}

// Linha de indicadores rapidos logo abaixo da manchete: os numeros de "pulso" da operacao.
function kpisRapidos(m, a) {
  return `<div class="cards" style="margin-top:4px;">
    <div class="card neutral"><div class="card-lbl">Pedidos</div><div class="card-val">${m.totalPedidos.toLocaleString('pt-BR')}</div>${selo(m.totalPedidos, a && a.totalPedidos)}</div>
    <div class="card neutral"><div class="card-lbl">Ticket médio</div><div class="card-val">R$ ${fmt(m.ticketMedio)}</div>${selo(m.ticketMedio, a && a.ticketMedio)}</div>
    <div class="card neg"><div class="card-lbl">Custo iFood</div><div class="card-val">R$ ${fmt(m.custoIfood)}</div><div class="card-pct">${pct(m.custoIfoodPct)}% do bruto</div>${selo(m.custoIfood, a && a.custoIfood, 'menorMelhor')}</div>
    <div class="card neutral"${cardFarol('mkt_por_pedido', m.custoMktPorPedido)}><div class="card-lbl">Marketing por pedido</div><div class="card-val">R$ ${fmt(m.custoMktPorPedido)}</div>${selo(m.custoMktPorPedido, a && a.custoMktPorPedido, 'menorMelhor')}</div>
    <div class="card neutral"${cardFarol('taxa_cancelamento', m.nFullPct)}><div class="card-lbl">Taxa de cancelamento</div><div class="card-val">${pct(m.nFullPct)}%</div><div class="card-pct">só cancelamento total · ${pct(m.nParcialPct)}% em parcial</div>${selo(m.nFullPct, a && a.nFullPct, 'menorMelhor')}</div>
  </div>`;
}

// O EXTRATO: substitui os antigos blocos de cards com sinais de + e −. Uma tabela unica
// contando a historia do dinheiro, do bruto ao liquido, com % do bruto e variacao por linha.
function extratoFinanceiro(m, a) {
  // mesmo padrao de DFC/DRE (16/08 a noite): saida com sinal de menos no numero
  // (sinal=-1), % do bruto AO LADO do valor, comparacao na propria coluna
  const linha = (rotulo, valor, pctBруto, varHtml, classe = '', sinal = 1) =>
    `<tr class="${classe}"><td>${rotulo}</td>
     <td>R$ ${fmt(valor * sinal)}${pctBруto === null ? '' : `<span class="dre-av">${pct(pctBруto)}%</span>`}</td>
     <td>${varHtml}</td></tr>`;

  // Farol de meta numa LINHA do extrato. A meta vem de metas_kpi pelo mesmo caminho do
  // resto do painel (farolKpi) — numero de meta escrito na mao aqui seria a segunda
  // versao da verdade. So entram indicadores de TAXA/RAZAO, pela mesma razao do
  // cardFarol: meta absoluta e semanal e nao cabe num recorte de periodo qualquer.
  // Com METAS_KPI ainda nao carregado devolve vazio, igual ao cardFarol.
  const faroLinha = (chave, valor) => {
    const k = (METAS_KPI || []).find(x => x.chave === chave);
    if (!k || valor === null || valor === undefined || isNaN(valor)) return '';
    const f = farolKpi(k, valor);
    // Fora do perimetro "Minha gestao" o farolKpi nao devolve rotulo de meta, e sim um
    // aviso ("metas valem p/ Minha gestão"). No cardFarol esse texto vive so no title=;
    // aqui o rotulo E o conteudo da pilula, entao sem rotulo de meta nao ha pilula.
    if (!['na meta', 'na faixa', 'perto', 'fora'].includes(f[1])) return '';
    return ' <span style="color:' + f[0] + '; border:1px solid ' + f[0] + '; border-radius:10px; padding:1px 7px; font-size:10px; font-weight:bold;"'
      + ' title="Meta semanal: ' + fmtMeta(k) + ' — ' + f[1] + '">' + f[1] + '</span>';
  };

  // Qual linha elementar do extrato mais tirou dinheiro do resultado contra a janela
  // anterior de mesmo tamanho. A conta e em REAIS, nao em %: 1% de uma linha grande
  // pesa mais no bolso que 50% de uma pequena. Ficam de fora os subtotais (repetiriam
  // a conta das linhas que os formam) e promocoes/anuncios, que o painel trata como
  // investimento — gastar mais ali nao e piora por si so.
  const impactos = !a ? [] : [
    ['itens', m.itens - a.itens],
    ['frete', m.frete - a.frete],
    ['ressarcimento', m.ressarcimentoCancelamento - a.ressarcimentoCancelamento],
    ['taxaOnline', a.taxaOnline - m.taxaOnline],
    ['comissaoVendas', a.comissaoVendas - m.comissaoVendas],
    ['outrosAjustes', a.outrosAjustes - m.outrosAjustes],
    ['freteSobDemanda', a.freteSobDemanda - m.freteSobDemanda],
    ['entregaIfood', a.entregaIfood - m.entregaIfood],
  ].filter(p => isFinite(p[1]) && p[1] < -0.005).sort((x, y) => x[1] - y[1]);
  const piorLinha = impactos.length ? impactos[0] : null;
  const marcaPior = (chave) => (piorLinha && piorLinha[0] === chave)
    ? ' <span style="color:var(--farol-fora); border:1px solid var(--farol-fora); border-radius:10px; padding:1px 7px; font-size:10px; font-weight:bold;"'
      + ' title="Em relação ao período anterior esta linha tirou R$ ' + fmt(Math.abs(piorLinha[1]))
      + ' do resultado — a maior perda entre as linhas do extrato.">tirou mais do resultado</span>'
    : '';

  // 12/11/2026 (auditoria lote 3, canal-37/39): a ressalva dos custos próprios fica uma vez só, no título do extrato
  return `<div class="section-label">Para onde foi o dinheiro (antes dos custos próprios)</div>
  <div id="extratoFin">
    <table>
      <tr><th>Item</th><th>Valor · % do bruto</th><th>vs período anterior</th></tr>
      ${linha('Venda dos produtos' + marcaPior('itens'), m.itens, m.itensPct, variacaoSpan(m.itens, a && a.itens))}
      ${linha('Taxa de entrega paga pelo cliente' + marcaPior('frete'), m.frete, m.fretePct, variacaoSpan(m.frete, a && a.frete))}
      ${linha('<b>= Faturamento bruto</b> <span style="font-size:11px;color:var(--tx-4);">venda cheia, com frete</span>', m.bruto, 100, variacaoSpan(m.bruto, a && a.bruto), 'sub')}
      ${linha('− Taxa de pagamento online' + marcaPior('taxaOnline'), m.taxaOnline, m.taxaOnlinePct, variacaoSpan(m.taxaOnline, a && a.taxaOnline, 'menorMelhor'), '', -1)}
      ${linha('− Comissão sobre vendas' + marcaPior('comissaoVendas'), m.comissaoVendas, m.comissaoVendasPct, variacaoSpan(m.comissaoVendas, a && a.comissaoVendas, 'menorMelhor'), '', -1)}
      ${linha('− Outros ajustes (inclui mensalidade)' + marcaPior('outrosAjustes'), m.outrosAjustes, m.outrosAjustesPct, variacaoSpan(m.outrosAjustes, a && a.outrosAjustes, 'menorMelhor'), '', -1)}
      ${linha('− Frete sob demanda' + marcaPior('freteSobDemanda'), m.freteSobDemanda, m.freteSobDemandaPct, variacaoSpan(m.freteSobDemanda, a && a.freteSobDemanda, 'menorMelhor'), '', -1)}
      ${(m.entregaIfood || (a && a.entregaIfood)) ? linha('− Entrega do iFood (Full Service)' + marcaPior('entregaIfood'), m.entregaIfood, m.entregaIfoodPct, variacaoSpan(m.entregaIfood, a && a.entregaIfood, 'menorMelhor'), '', -1) : ''}
      ${linha('+ Ressarcimento por cancelamentos' + marcaPior('ressarcimento'), m.ressarcimentoCancelamento, m.ressarcimentoCancelamentoPct, variacaoSpan(m.ressarcimentoCancelamento, a && a.ressarcimentoCancelamento))}
      ${linha('<b>= Total cobrado pelo iFood</b>', m.totalDescontosComRessarcimento, m.totalDescontosComRessarcimentoPct, variacaoSpan(m.totalDescontosComRessarcimento, a && a.totalDescontosComRessarcimento, 'menorMelhor'), 'sub', -1)}
      ${linha('− Promoções bancadas pela loja', m.promoLoja, m.promoLojaPct, variacaoSpan(m.promoLoja, a && a.promoLoja, 'neutro'), '', -1)}
      ${linha('− Anúncios', m.anuncios, m.anunciosPct, variacaoSpan(m.anuncios, a && a.anuncios, 'neutro'), '', -1)}
      ${linha('<b>= Total investido em marketing</b>' + faroLinha('mkt_por_pedido', m.custoMktPorPedido), m.totalMkt, m.totalMktPct, variacaoSpan(m.totalMkt, a && a.totalMkt, 'neutro'), 'sub', -1)}
      ${linha('<b>= LÍQUIDO — o que sobra para a loja</b>' + faroLinha('margem_pct', m.liquidoPct), m.liquido, m.liquidoPct, variacaoSpan(m.liquido, a && a.liquido), 'liq')}
    </table>
  </div>`;
}

// Sinais e detalhes secundarios: resumo de cancelamentos com atalho pro modulo, e os
// recortes informativos (como o cliente pagou / quem banca a promocao) recolhidos.
function blocoSinais(m, a) {
  // 12/11/2026 (auditoria lote 3, canal-33): os cartões de cancelamento moram só na tela Cancelamentos; aqui fica o link
  return `<div style="text-align:center; margin-top:14px;">
    <button class="preset-btn" onclick="mostrarModulo('cancelamentos')">Cancelamentos do período →</button>
  </div>

  <details class="detalhes-extra">
    <summary>Mais detalhes: como o cliente pagou e quem banca as promoções</summary>
    <div class="cards" style="margin-top:12px;">
      <div class="card blue"><div class="card-lbl">Pago pelo app do iFood</div><div class="card-val">R$ ${fmt(m.vendasOnline)}</div><div class="card-pct">${pct(m.vendasOnlinePct)}%</div></div>
      <div class="card blue"><div class="card-lbl">Pago na entrega (cartão/vale)</div><div class="card-val">R$ ${fmt(m.vendasCartao)}</div><div class="card-pct">${pct(m.vendasCartaoPct)}%</div></div>
      <div class="card neg"><div class="card-lbl">Promoção bancada pela loja</div><div class="card-val">R$ ${fmt(m.investLoja)}</div><div class="card-pct" style="color:var(--farol-fora);">${pct(m.investLojaPct)}% do total</div></div>
      <div class="card pos"><div class="card-lbl">Promoção bancada pelo iFood</div><div class="card-val">R$ ${fmt(m.investPlataforma)}</div><div class="card-pct" style="color:var(--farol-ok);">${pct(m.investPlataformaPct)}% do total</div></div>
    </div>
  </details>`;
}

// Bloco de abertura da Visao Geral: o numero que resume tudo (o que sobrou), a variacao, uma
// frase em portugues explicando o resultado, e o grafico que explica POR QUE mudou.
// Frase que declara, sem ambiguidade, exatamente o recorte que esta na tela. Aparece igual em
// todos os modulos — o periodo e um so, entao a leitura e sempre a mesma independente de onde
// a pessoa esteja no painel.
function linhaContexto(ant) {
  const ini = fDataIni.value, fim = fDataFim.value;
  const dias = Math.round((new Date(fim + 'T00:00:00') - new Date(ini + 'T00:00:00')) / 86400000) + 1;

  const lojasMarcadas = Array.from(lojaOptCont.querySelectorAll('input[data-l]'));
  const nLojas = lojasMarcadas.filter(c => c.checked).length;
  const totalLojas = lojasMarcadas.length;
  const todasUnid = activeUnidades.size === UNIDADES.length;

  const partes = [];
  partes.push(`<b>${formatarDataCurta(ini)}</b> a <b>${formatarDataCurta(fim)}</b> (${dias} ${dias === 1 ? 'dia' : 'dias'})`);
  partes.push(todasUnid ? 'todas as unidades' : `unidades: <b>${Array.from(activeUnidades).join(', ')}</b>`);
  partes.push(nLojas === totalLojas ? `todas as ${totalLojas} marcas` : `<b>${nLojas}</b> de ${totalLojas} marcas`);

  const dias7 = selecionados.fDia.size === DIAS.length;
  const turnos4 = selecionados.fTurno.size === TURNOS.length;
  if (!dias7) partes.push(`apenas <b>${Array.from(selecionados.fDia).map(i => DIAS[i]).join(', ')}</b>`);
  if (!turnos4) partes.push(`apenas <b>${Array.from(selecionados.fTurno).map(i => TURNOS[i]).join(', ')}</b>`);

  const comparacao = ant
    ? `Comparado com os ${ant.dias} dias anteriores: ${formatarDataCurta(ant.ini)} a ${formatarDataCurta(ant.fim)}.`
    : `Sem período anterior de mesmo tamanho para comparar.`;

  // 12/09/2026: este texto dizia que a visao consolidada "nascera"; virou link para ela
  // e, no mesmo dia, a consolidada foi aposentada — a Evolucao de vendas mostra o iFood ao
  // lado do salao, do site e do balcao com os mesmos numeros, e e para la que o link leva.
  const canais = `<div style="margin-top:6px; color:#8a897e; font-size:11.5px;">
    Canal iFood. <a href="javascript:void(0)" onclick="mostrarModulo('evolucao')" style="color:var(--tx-3);">Ver ao lado do salão, site e balcão &rsaquo;</a>
  </div>`;

  return `<div class="contexto contexto-filtro">
    Mostrando ${partes.join(' &middot; ')}.<br>${comparacao}
    ${canais}
  </div>`;
}

function blocoAbertura(m, a, ant) {
  const variacao = (a && Math.abs(a.liquido) > 0.005) ? (m.liquido - a.liquido) / Math.abs(a.liquido) * 100 : null;
  const cor = variacao === null ? '#8a897e' : (variacao >= 0 ? 'var(--farol-ok)' : 'var(--farol-fora)');
  const seta = variacao === null ? '' : (variacao >= 0 ? '▲' : '▼');
  const deltaTexto = variacao === null
    ? 'Sem período anterior para comparar'
    : `${seta} ${pct(Math.abs(variacao))}% vs os ${ant.dias} dias anteriores (R$ ${fmt(a.liquido)})`;

  // 12/11/2026 (auditoria lote 3, canal-32/39): o hero fica só com o número e a variação — bruto, pedidos e custo do
  // iFood já estão nos cartões e no extrato logo abaixo
  return `<div class="hero" style="border-color:${cor};">
    <div class="hero-lbl">O que sobrou para a loja no período</div>
    <div class="hero-val">R$ ${fmt(m.liquido)}</div>
    <div class="hero-delta" style="color:${cor};">${deltaTexto}</div>
  </div>
  ${a ? `<div class="chart-box" style="height:320px; margin-bottom:16px;">
    <div class="chart-title">Por que o resultado mudou em relação ao período anterior</div>
    <div class="chart-canvas-wrap"><canvas id="chartWaterfall"></canvas></div>
  </div>
  <div class="caption-label" style="text-align:center; margin-top:0;">Azul: antes e agora · verde subiu o resultado · vermelho desceu.</div>` : ''}`;
}

// Os 4 cards de totais — aparecem tanto na Visao Geral (fechando o resumo) quanto no topo do
// modulo Cancelamentos, pra ele fazer sentido sozinho.
function cardsCancel(m, a) {
  return `<div class="section-label">O que perdemos com cancelamentos</div>
  <div class="cards">
    <div class="card neg"><div class="card-lbl">Total cancelado (parciais + totais)</div><div class="card-val">R$ ${fmt(m.valorCancelado)}</div><div class="card-pct">${pct(m.valorCanceladoPct)}% do bruto</div>${selo(m.valorCancelado, a && a.valorCancelado, 'menorMelhor')}</div>
    <div class="card neutral"><div class="card-lbl">Cancelamentos parciais</div><div class="card-val">R$ ${fmt(m.vParcial)}</div><div class="card-pct">${m.nParcial} pedidos (${pct(m.nParcialPct)}%)</div>${selo(m.vParcial, a && a.vParcial, 'menorMelhor')}</div>
    <div class="card neutral"${cardFarol('taxa_cancelamento', m.nFullPct)}><div class="card-lbl">Cancelamentos totais</div><div class="card-val">R$ ${fmt(m.vFull)}</div><div class="card-pct">${m.nFull} pedidos (${pct(m.nFullPct)}%)</div>${selo(m.vFull, a && a.vFull, 'menorMelhor')}</div>
    <div class="card pos"><div class="card-lbl">Devolvido pelo iFood</div><div class="card-val">R$ ${fmt(m.ressarcimentoCancelamento)}</div><div class="card-pct">${pct(m.ressarcimentoCancelamentoPct)}% do bruto</div>${selo(m.ressarcimentoCancelamento, a && a.ressarcimentoCancelamento)}</div>
  </div>
  <div style="display:flex; justify-content:center; margin-top:6px;">
    <div class="card neg highlight" style="flex:0 1 420px;">
      <div class="card-lbl">Valor perdido de verdade (cancelado − devolvido)</div>
      <div class="card-val" style="font-size:26px;">R$ ${fmt(m.valorPerdidoReal)}</div>
      <div class="card-pct">${pct(m.valorPerdidoRealPct)}% do bruto</div>
      ${selo(m.valorPerdidoReal, a && a.valorPerdidoReal, 'menorMelhor')}
    </div>
  </div>`;
}

// QUANTO DA PERDA AINDA DA PARA RECUPERAR (12/09/2026). A tela contava o que
// aconteceu e parava ali; a unica acao concreta que existe sobre cancelamento e'
// contestar, e ela mora em outro modulo. Este bloco liga as duas pontas: quanto da
// fila de contestacao ainda esta dentro do prazo, qual motivo mais pesa nela, e o
// botao que leva para la. Chega DEPOIS dos numeros, igual a faixa de alertas do
// Placar — e' outra fonte e a tabela de motivos nao pode esperar por ela.
// 07/11/2026 (auditoria dos numeros, lote 2, canal-14 e canal-25): a fila segue a loja do seletor (Rede = as 3, sem
// Boqueirao). A view lida aqui vem da planilha de pedidos, que parou em 28/10 (a extracao pelo portal foi desligada em
// 30/10). 07/11/2026 (lote 2, canal-13/14): a fonte passou a ser vw_contestacoes_fila_api, a MESMA fila da rotina
// (proposta 2026-10-30-contestacoes-fila-api.md; leitura liberada em
// script/sql/contestacoes_fila_api_leitura_painel_2026_11_07.sql). Recuperavel = A_CONTESTAR menos o descarte de
// escopo TODOS (o portal nao deixa contestar), o mesmo corte do Passo 1 da rotina.
const CONTEST_FONTE = 'vw_contestacoes_fila_api';
const contestPortalBloqueia = (r) => r.descarte_escopo === 'TODOS';
function contestUnidadeOk(u) {
  const l = (typeof canalComSeletor === 'function' && canalComSeletor()) ? lojaAtual() : null;
  if (l && l !== 'REDE') return u === l;
  const vis = typeof unidadesVisiveis === 'function' ? unidadesVisiveis() : [];
  return vis.length ? vis.includes(u) : u !== 'BOQUEIRAO';
}
function contestEscopoTxt() {
  const l = (typeof canalComSeletor === 'function' && canalComSeletor()) ? lojaAtual() : null;
  return l && l !== 'REDE' ? lojaNome(l) : 'Rede (as 3)';
}
let CANCEL_RECUP = null;

// Prazo de contestacao: a hora exata (vence_aprox, Curitiba) manda; contestavel_ate (data em UTC + 7) so' de reserva.
const contestPrazoDe = (r) => r.vence_aprox ? String(r.vence_aprox).slice(0, 16)
  : (r.contestavel_ate ? String(r.contestavel_ate).slice(0, 10) + 'T23:59' : null);
const contestDiasAte = (p) => p ? Math.ceil((new Date(p) - Date.now()) / 864e5) : null;

async function carregarRecuperavelCancel() {
  const alvo = document.getElementById('cancelRecuperavel');
  if (!alvo) return;
  if (CANCEL_RECUP === null) {
    try {
      CANCEL_RECUP = await consultarTudo(CONTEST_FONTE + '?select=id_curto,nome_loja,unidade,motivo_cancelamento,valor,contestavel_ate,vence_aprox,descarte_escopo&bloco=eq.A_CONTESTAR');
    } catch (e) {
      alvo.innerHTML = '<div class="contexto">Não consegui consultar a fila de contestação agora.</div>';
      return;
    }
  }
  const fila = CANCEL_RECUP.filter(r => contestUnidadeOk(r.unidade) && !contestPortalBloqueia(r))
    .map(r => ({ ...r, valor: Number(r.valor) || 0 }));
  if (!fila.length) {
    alvo.innerHTML = `<div class="contexto" style="border-color:var(--farol-ok);">${contestEscopoTxt()}: nada dentro do prazo de contestação agora. ✔</div>`;
    return;
  }
  const totalRecup = fila.reduce((s, r) => s + r.valor, 0);
  const porMotivoRecup = new Map();
  fila.forEach(r => {
    const mt = r.motivo_cancelamento || 'sem motivo informado';
    if (!porMotivoRecup.has(mt)) porMotivoRecup.set(mt, { n: 0, valor: 0 });
    const o = porMotivoRecup.get(mt); o.n++; o.valor += r.valor;
  });
  const pior = [...porMotivoRecup.entries()].map(([mt, o]) => ({ mt: mt, n: o.n, valor: o.valor }))
    .sort((x, y) => y.valor - x.valor)[0];
  // 07/11/2026 (lote 2, canal-13): prazo pela hora exata (vence_aprox, hora de Curitiba); contestavel_ate e' a data em UTC
  // e da um dia a mais a quem cancelou depois das 21:00 — so' fica de reserva.
  const curtos = fila.filter(r => { const d = contestDiasAte(contestPrazoDe(r)); return d !== null && d <= 2; });
  alvo.innerHTML = `<div class="contexto" style="border-color:var(--farol-perto);">
    <b>R$ ${fmt(totalRecup)}</b> em <b>${fila.length}</b> pedido(s) cancelado(s) ainda estão dentro do prazo de contestação.
    O motivo que mais pesa nessa fila é <b>${pior.mt}</b>: custou R$ ${fmt(pior.valor)} em ${pior.n} pedido(s).
    ${curtos.length ? `<b style="color:var(--farol-fora);">${curtos.length} vence(m) em até 2 dias.</b>` : ''}
    <div style="font-size:12px; color:var(--tx-3); margin-top:6px;" title="A fila de contestação segue a loja escolhida no topo e não o período: é tudo o que ainda está dentro do prazo — o mesmo recorte do módulo Contestações. Por isso ela não bate com a tabela de motivos acima. O motivo aqui é o texto cru do cancelamento, não a categoria do arquivo de classificação. Ficam fora os pedidos que o portal do iFood não deixa contestar.">
      ${contestEscopoTxt()}, tudo o que está no prazo — este bloco não segue o período do topo.
    </div>
    <div style="margin-top:8px;"><button class="preset-btn" onclick="mostrarModulo('contestacoes')">Abrir a fila de contestações →</button></div>
  </div>`;
}

// Modulo Cancelamentos completo: os cards de totais (+ valor perdido real) e a analise por
// categoria — dois graficos, cada um ordenado pela sua propria medida, e a tabela com os
// numeros exatos, incluindo o custo medio por cancelamento.
// RECORTE POR CATEGORIA DE MOTIVO (12/09/2026). Clicar na barra de "Onde se perde
// mais dinheiro" fixa a categoria: a tabela de lojas e os dois graficos de evolucao
// passam a falar so dela, e a pergunta "este motivo esta piorando ou foi pontual?"
// se responde sem sair da tela. A lista de categorias continua INTEIRA, para dar
// como trocar de escolha (regra do cross-filter do modulo Evolucao).
// Os 4 cards do topo NAO entram no recorte: eles vem de computeMetrics, que nao
// conhece motivo — a tela avisa isso em vez de deixar o leitor supor.
let CANCEL_MOTIVO = null;

function cancelFiltrarMotivo(nome) {
  CANCEL_MOTIVO = (CANCEL_MOTIVO === nome) ? null : nome;   // clicar de novo solta
  renderAll();
}

// nome de categoria vem da planilha de motivos: o clique da tabela vai por INDICE,
// nunca como string dentro do atributo HTML
let CANCEL_LISTA_MOTIVOS = [];

function cancelFiltrarMotivoIdx(i) {
  const nome = CANCEL_LISTA_MOTIVOS[i];
  if (nome !== undefined) cancelFiltrarMotivo(nome);
}

function moduloCancelamentos(m, a) {
  const motivos = resumoMotivosCancelamento();

  // Quebra por LOJA dos MESMOS cancelamentos (linhasCancelamentoFiltradas ja respeita
  // loja/unidade, turno, dia da semana e periodo; MOTIVOS: 0=loja, 6=pedidos, 7=valor).
  // A tabela de motivos responde "por que"; esta responde "onde" — e e a unica das
  // duas que diz com quem falar. Maior valor perdido primeiro, a mesma ordem da outra.
  const porLojaCancel = new Map();
  // com uma categoria fixada, esta tabela passa a dizer ONDE aquele motivo acontece
  linhasCancelamentoFiltradas().filter(r => !CANCEL_MOTIVO || r[5] === CANCEL_MOTIVO).forEach(r => {
    if (!porLojaCancel.has(r[0])) porLojaCancel.set(r[0], { n: 0, valor: 0 });
    const o = porLojaCancel.get(r[0]);
    o.n += r[6]; o.valor += r[7];
  });
  const lojasCancel = [...porLojaCancel.entries()]
    .map(([i, o]) => ({ nome: LOJAS[i], n: o.n, valor: o.valor, unit: o.n ? o.valor / o.n : 0 }))
    .sort((x, y) => y.valor - x.valor);
  const tabelaMotivos = motivos.length ? `
    <div id="tabelaMotivos">
      <table>
        <tr><th>Categoria do motivo</th><th>Pedidos</th><th>% do total</th><th>Valor perdido</th><th>R$ por cancelamento</th></tr>
        ${(() => { const ord = motivos.slice().sort((a,b)=>b.valor-a.valor);
          CANCEL_LISTA_MOTIVOS = ord.map(x => x.responsavel);   // o clique vai por indice
          return ord.map((x, i) => { const sel = CANCEL_MOTIVO === x.responsavel;
          return `<tr onclick="cancelFiltrarMotivoIdx(${i})" style="cursor:pointer;${sel ? 'background:var(--brand-wine);' : ''}" title="${sel ? 'clique para soltar o recorte' : 'clique para recortar a tela por esta categoria'}">
          <td>${sel ? '<b>' : ''}${x.responsavel === 'NAO_MAPEADO' ? 'sem categoria' : x.responsavel}${sel ? '</b> ✕' : ''}</td><td>${x.n}</td><td>${pct(x.pct)}%</td>
          <td>R$ ${fmt(x.valor)}</td><td>R$ ${fmt(x.n ? x.valor/x.n : 0)}</td></tr>`; }).join(''); })()}
        ${(() => { const t = motivos.reduce((a, x) => ({ n: a.n + x.n, v: a.v + x.valor }), { n: 0, v: 0 });
          return `<tr class="liq"><td>TOTAL</td><td>${t.n}</td><td>100%</td>
            <td>R$ ${fmt(t.v)}</td><td>R$ ${fmt(t.n ? t.v / t.n : 0)}</td></tr>`; })()}
      </table>
    </div>` : '';

  return cardsCancel(m, a) + `
  ${CANCEL_MOTIVO ? `<div class="contexto" style="border-color:var(--brand);">
    <b>Filtrando:</b>
    <button class="preset-btn active" onclick="cancelFiltrarMotivo(null)">categoria ${CANCEL_MOTIVO === 'NAO_MAPEADO' ? 'sem categoria' : CANCEL_MOTIVO} ✕</button>
    <div style="font-size:12px; color:var(--tx-3); margin-top:6px;">Os cartões acima seguem o período inteiro, sem este recorte.</div>
  </div>` : ''}
  <div style="display:flex; flex-wrap:wrap; gap:14px; align-items:stretch; margin-top:14px;">
    <div class="chart-box" style="flex:1 1 340px; height:300px;">
      <div class="chart-title">Onde se perde mais dinheiro (R$)</div>
      <div class="chart-canvas-wrap"><canvas id="chartMotivosValor"></canvas></div>
    </div>
    <div class="chart-box" style="flex:1 1 340px; height:300px;">
      <div class="chart-title">O que mais acontece (nº de cancelamentos)</div>
      <div class="chart-canvas-wrap"><canvas id="chartMotivosQtd"></canvas></div>
    </div>
  </div>

  ${tabelaMotivos}

  <div class="section-label">Quanto dessa perda ainda dá para recuperar</div>
  <div id="cancelRecuperavel"><div class="contexto">Consultando a fila de contestação...</div></div>

  ${lojasCancel.length ? `
  <div class="section-label">Onde mais se cancela — loja a loja${CANCEL_MOTIVO ? ' · ' + CANCEL_MOTIVO : ''}</div>
  <div class="caption-label" style="text-align:center;">Ordenado pelo valor perdido: a primeira linha é onde o dinheiro está saindo.</div>
  <div id="tabelaLojasCancel">
    <table>
      <tr><th>Loja</th><th>Pedidos cancelados</th><th>Valor perdido</th><th title="Valor perdido dividido pelos pedidos cancelados — mostra se a loja perde muito de uma vez ou pouco em muitos pedidos.">R$ por cancelamento</th></tr>
      ${lojasCancel.map(x => `<tr><td>${x.nome}</td><td>${x.n.toLocaleString('pt-BR')}</td>
        <td>R$ ${fmt(x.valor)}</td><td>R$ ${fmt(x.unit)}</td></tr>`).join('')}
      ${(() => { const t = lojasCancel.reduce((s, x) => ({ n: s.n + x.n, v: s.v + x.valor }), { n: 0, v: 0 });
        return `<tr class="liq"><td>TOTAL</td><td>${t.n.toLocaleString('pt-BR')}</td>
          <td>R$ ${fmt(t.v)}</td><td>R$ ${fmt(t.n ? t.v / t.n : 0)}</td></tr>`; })()}
    </table>
  </div>` : ''}

  <div class="section-label">Estamos melhorando ou piorando?${CANCEL_MOTIVO ? ' · ' + CANCEL_MOTIVO : ''}</div>
  <div class="chart-grid">
    <div class="chart-box">
      <div class="chart-title">Taxa de cancelamento (% dos pedidos)${CANCEL_MOTIVO ? ' — ' + CANCEL_MOTIVO : ''}</div>
      <div class="chart-canvas-wrap"><canvas id="chartCancelTaxa"></canvas></div>
    </div>
    <div class="chart-box">
      <div class="chart-title">Valor perdido no período (R$)${CANCEL_MOTIVO ? ' — ' + CANCEL_MOTIVO : ''}</div>
      <div class="chart-canvas-wrap"><canvas id="chartCancelValor"></canvas></div>
    </div>
  </div>
  <div class="caption-label" style="text-align:center;">Agrupado por ${granularidadeAutomatica() === 'dia' ? 'dia' : granularidadeAutomatica() === 'semana' ? 'semana' : 'mês'}, pelo tamanho do período.</div>`;
}

// ------------------------------------------------------------------
// MODULO PROMOCOES
// ------------------------------------------------------------------
// O relatorio de promocoes vem por PERIODO fechado (mes ou semana seg-dom).
// Só entram os recortes INTEIRAMENTE contidos no filtro — se pegássemos os que
// apenas encostam, um mês inteiro apareceria ao filtrar uma semana e o número
// sairia inflado. Quando nada couber, o módulo lista os períodos disponíveis.
function periodoDaPromoContido(pIni, pFim) {
  const ini = fDataIni.value, fim = fDataFim.value;
  if (!pIni || !pFim || !ini || !fim) return false;
  return String(pIni) >= ini && String(pFim) <= fim;
}

function promosNoPeriodo() {
  const activeL = activeLojas();
  return PROMOCOES.filter(p => activeL.has(p[0]) && periodoDaPromoContido(p[7], p[8]));
}

// Rótulos dos recortes que existem na base, para orientar quando o filtro não pega nenhum.
function periodosPromoDisponiveis() {
  const vistos = new Map();
  PROMOCOES.forEach(p => {
    if (!p[7] || !p[8]) return;
    vistos.set(p[7] + '|' + p[8], `${formatarDataCurta(p[7])} a ${formatarDataCurta(p[8])}`);
  });
  return [...vistos.entries()].sort().map(([, rotulo]) => rotulo);
}

function resumoPromocoes() {
  const linhas = promosNoPeriodo();

  const porEstrategia = new Map();
  linhas.forEach(([, , estrategia, ped, vendas, invL, invI]) => {
    if (!porEstrategia.has(estrategia)) porEstrategia.set(estrategia, { estrategia, ped: 0, vendas: 0, invL: 0, invI: 0 });
    const o = porEstrategia.get(estrategia);
    o.ped += ped; o.vendas += vendas; o.invL += invL; o.invI += invI;
  });

  const totalInv = linhas.reduce((s, p) => s + p[5], 0);
  const lista = Array.from(porEstrategia.values()).map(o => ({
    ...o,
    pctVerba: totalInv ? o.invL / totalInv * 100 : 0,
    invPorPedido: o.ped ? o.invL / o.ped : 0,
    ticket: o.ped ? o.vendas / o.ped : 0,
    pctIfood: (o.invL + o.invI) ? o.invI / (o.invL + o.invI) * 100 : 0,
    retornoAtribuido: o.invL ? (o.vendas - o.invL) / o.invL : 0,
  })).sort((a, b) => b.invL - a.invL);

  return {
    lista, totalInv,
    totalInvIfood: linhas.reduce((s, p) => s + p[6], 0),
    totalPedidos: linhas.reduce((s, p) => s + p[3], 0),
    totalVendas: linhas.reduce((s, p) => s + p[4], 0),
    periodos: [...new Set(linhas.map(p => `${formatarDataCurta(p[7])} a ${formatarDataCurta(p[8])}`))].sort(),
  };
}

// Mesma estrategia comparada entre lojas: e a comparacao mais confiavel que este dado permite,
// porque o tipo de promocao e o mesmo dos dois lados — some o vies de "promo barata parece ter
// retorno alto". Diferenca aqui e diferenca de operacao, nao de metrica.
function promocoesPorLoja(estrategia) {
  const porLoja = new Map();
  promosNoPeriodo().filter(p => p[2] === estrategia)
    .forEach(([loja, , , ped, vendas, invL]) => {
      if (!porLoja.has(loja)) porLoja.set(loja, { loja, ped: 0, vendas: 0, invL: 0 });
      const o = porLoja.get(loja);
      o.ped += ped; o.vendas += vendas; o.invL += invL;
    });
  return Array.from(porLoja.values())
    .filter(o => o.invL > 0)
    .map(o => ({
      nome: LOJAS[o.loja], ped: o.ped, invL: o.invL,
      invPorPedido: o.ped ? o.invL / o.ped : 0,
      ticket: o.ped ? o.vendas / o.ped : 0,
    }))
    .sort((a, b) => b.invL - a.invL);
}

// ------------------------------------------------------------------
// DECOMPOSIÇÃO POR MECÂNICA
// O relatório do iFood agrupa por COMBINAÇÃO de promoções ("Campanha Inteligente +
// Frete Grátis"), o que esconde quanto custa cada mecânica isolada. Validado em
// 10/08/2026: as mecânicas-base têm custo FIXO por pedido (CI = R$5,00 exato em
// todas as lojas; Clube ≈ R$1,85; Cupom ≈ R$3,10). Então, numa linha combinada,
// cobramos da base o seu valor fixo e atribuímos o RESÍDUO ao Frete Grátis.
// Conferência: resíduo do CI+Frete deu R$10,30/pedido contra R$10,53 do Frete
// Grátis puro (erro de 2%) — o modelo se sustenta.
function decomporPorMecanica() {
  const linhas = promosNoPeriodo();

  // custo unitario de cada mecanica quando ela aparece SOZINHA, por competencia
  const base = new Map();
  linhas.forEach(([, comp, est, ped, , invL, invI]) => {
    if (est.includes(' + ') || !ped) return;
    const k = comp + '|' + est;
    if (!base.has(k)) base.set(k, { ped: 0, invL: 0, invI: 0 });
    const o = base.get(k);
    o.ped += ped; o.invL += invL; o.invI += invI;
  });
  const unit = (comp, mec) => {
    const o = base.get(comp + '|' + mec);
    return o && o.ped ? { l: o.invL / o.ped, i: o.invI / o.ped } : { l: 0, i: 0 };
  };

  const porMec = new Map();
  const soma = (mec, l, i, ped) => {
    if (!porMec.has(mec)) porMec.set(mec, { mec, invL: 0, invI: 0, ped: 0 });
    const o = porMec.get(mec);
    o.invL += l; o.invI += i; o.ped += ped;
  };

  let totL = 0, totI = 0;
  linhas.forEach(([, comp, est, ped, , invL, invI]) => {
    totL += invL; totI += invI;
    const partes = est.split(' + ').map(s => s.trim());
    const outras = partes.filter(p => p !== 'Frete Grátis');
    if (partes.includes('Frete Grátis') && outras.length) {
      let usadoL = 0, usadoI = 0;
      outras.forEach(p => {
        const u = unit(comp, p);
        soma(p, u.l * ped, u.i * ped, ped);
        usadoL += u.l * ped; usadoI += u.i * ped;
      });
      soma('Frete Grátis', Math.max(0, invL - usadoL), Math.max(0, invI - usadoI), ped);
    } else {
      partes.forEach(p => soma(p, invL / partes.length, invI / partes.length, ped));
    }
  });

  const lista = [...porMec.values()]
    .filter(o => o.invL > 0.005 || o.invI > 0.005)
    .map(o => ({
      ...o,
      pctVerba: totL ? o.invL / totL * 100 : 0,
      alav: o.invL > 0.005 ? o.invI / o.invL : null,
      porPedido: o.ped ? o.invL / o.ped : 0,
    }))
    .sort((a, b) => b.invL - a.invL);

  const fg = porMec.get('Frete Grátis') || { invL: 0, invI: 0 };
  return {
    lista, totL, totI,
    alavGeral: totL > 0.005 ? totI / totL : null,
    semFreteL: totL - fg.invL, semFreteI: totI - fg.invI,
    alavSemFrete: (totL - fg.invL) > 0.005 ? (totI - fg.invI) / (totL - fg.invL) : null,
  };
}

// Como o frete grátis chegou ao cliente — o corte que decide realocação de verba.
// Carregado sob demanda (vw_promocoes_frete) na primeira visita ao módulo.
let PROMO_FRETE = null;

// O recorte de frete vem de outra consulta; na primeira visita ao módulo buscamos
// e redesenhamos o bloco, para não atrasar a abertura do painel.
async function entrarPromocoes() {
  if (PROMO_FRETE === null) {
    PROMO_FRETE = await consultarTudo(
      'vw_promocoes_frete?select=competencia,periodo_ini,periodo_fim,nome_loja,grupo_frete,pedidos,valor_itens,investimento_loja,investimento_ifood&order=periodo_ini'
    );
    const alvo = document.getElementById('view-promocoes');
    if (alvo) alvo.innerHTML = linhaContexto(periodoAnterior()) + moduloPromocoes();
  }
  renderChartsPromocoes();
}

// FAROL UNICO DA ALAVANCAGEM (12/09/2026). Quatro tabelas de promocao pintavam o
// MESMO numero com limiares diferentes escritos a mao: 1,00x/0,50x no frete gratis,
// 1,00x/0,80x na de loja a loja, 1,00x/0,50x nas mecanicas e sem ambar nenhum na do
// teste. A meta oficial e uma so, mora em metas_kpi (chave 'alavancagem') e ja e' o
// que o card do topo le por cardFarol — agora a tabela le a mesma coisa, com a
// tolerancia e o rotulo (na meta / perto / fora) que farolKpi ja calcula. Sem a meta
// carregada, cai no 1,00x que a propria legenda da tela promete, em vez de inventar
// um corte novo.
function alavancagemTxt(v) {
  if (v === null || v === undefined || isNaN(v)) return '—';
  const n = Number(v).toFixed(2).replace('.', ',') + 'x';
  const k = (METAS_KPI || []).find(m => m.chave === 'alavancagem');
  if (!k) return `<b style="color:${v >= 1 ? 'var(--farol-ok)' : 'var(--farol-fora)'};" title="Meta de 1,00x — a meta oficial não carregou.">${n}</b>`;
  const rotulo = farolKpi(k, v)[1];
  const cor = (rotulo === 'na meta' || rotulo === 'na faixa') ? 'var(--farol-ok)'
    : rotulo === 'perto' ? 'var(--farol-perto)'
    : rotulo === 'fora' ? 'var(--farol-fora)' : 'var(--tx-3)';
  return `<b style="color:${cor};" title="Meta semanal: ${fmtMeta(k)} — ${rotulo}">${n}</b>`;
}

function blocoFreteGratis() {
  if (!PROMO_FRETE || !PROMO_FRETE.length) return '';
  const activeL = activeLojas();
  const linhas = PROMO_FRETE.filter(r =>
    periodoDaPromoContido(r.periodo_ini, r.periodo_fim) && activeL.has(LOJAS.indexOf(r.nome_loja)));
  if (!linhas.length) return '';

  const ORDEM = ['Frete grátis dentro do Hits', 'Frete grátis avulso',
                 'Frete grátis empilhado em outro desconto', 'Sem frete grátis'];
  const por = new Map();
  linhas.forEach(r => {
    if (!por.has(r.grupo_frete)) por.set(r.grupo_frete, { ped: 0, vendas: 0, invL: 0, invI: 0 });
    const o = por.get(r.grupo_frete);
    o.ped += r.pedidos; o.vendas += Number(r.valor_itens || 0);
    o.invL += Number(r.investimento_loja || 0); o.invI += Number(r.investimento_ifood || 0);
  });
  const totL = [...por.values()].reduce((s, o) => s + o.invL, 0);
  const alavTxt = alavancagemTxt;   // farol unico: a meta de metas_kpi, nao o 0,50x da mao

  const tr = ORDEM.filter(g => por.has(g)).map(g => {
    const o = por.get(g);
    return `<tr>
      <td>${g}</td><td>${o.ped.toLocaleString('pt-BR')}</td>
      <td>R$ ${fmt(o.invL)}</td><td>${pct(totL ? o.invL / totL * 100 : 0)}%</td>
      <td>R$ ${fmt(o.invI)}</td><td>${alavTxt(o.invL > 0.005 ? o.invI / o.invL : 0)}</td>
      <td>R$ ${fmt(o.ped ? o.invL / o.ped : 0)}</td>
      <td>R$ ${fmt(o.ped ? o.vendas / o.ped : 0)}</td>
    </tr>`;
  }).join('');

  // 12/11/2026 (usabilidade, promocoes): o aviso de empilhamento subiu para o topo da tela (promoDecisaoTopo)
  const T = [...por.values()].reduce((s, o) => ({ ped: s.ped + o.ped, vendas: s.vendas + o.vendas, invI: s.invI + o.invI }), { ped: 0, vendas: 0, invI: 0 });

  // 12/11/2026 (auditoria lote 3, canal-41): legenda de uma linha
  return `
  <div class="section-label">Como o frete grátis chegou ao cliente</div>
  <div class="caption-label" style="text-align:center;">Hits: o iFood divide · avulso: quase todo nosso · empilhado em outro desconto.</div>
  <div id="tabelaFreteGratis">
    <table>
      <tr><th>Como foi entregue</th><th>Pedidos</th><th>Nós (R$)</th><th>% da verba</th><th>iFood (R$)</th><th>Alavancagem</th><th>Nosso R$/pedido</th><th>Ticket médio</th></tr>
      ${tr}
      <tr class="liq"><td><b>TOTAL</b></td><td>${T.ped.toLocaleString('pt-BR')}</td><td>R$ ${fmt(totL)}</td><td>100%</td><td>R$ ${fmt(T.invI)}</td>
        <td>${alavTxt(totL > 0.005 ? T.invI / totL : 0)}</td><td>R$ ${fmt(T.ped ? totL / T.ped : 0)}</td><td>R$ ${fmt(T.ped ? T.vendas / T.ped : 0)}</td></tr>
    </table>
  </div>`;
}

// 12/11/2026 (usabilidade, promocoes): a decisão abre a tela — o que cortar, tirado do mesmo cálculo do frete grátis
function promoDecisaoTopo() {
  if (!PROMO_FRETE || !PROMO_FRETE.length) return '';
  const activeL = activeLojas();
  const linhas = PROMO_FRETE.filter(r =>
    periodoDaPromoContido(r.periodo_ini, r.periodo_fim) && activeL.has(LOJAS.indexOf(r.nome_loja)));
  const soma = (g) => linhas.filter(r => r.grupo_frete === g).reduce((s, r) => ({ ped: s.ped + r.pedidos, invL: s.invL + Number(r.investimento_loja || 0) }), { ped: 0, invL: 0 });
  const emp = soma('Frete grátis empilhado em outro desconto'), avulso = soma('Frete grátis avulso');
  if (!emp.ped || !avulso.ped) return '';
  return `<div class="contexto" style="text-align:left; border-color:var(--farol-fora); margin-bottom:12px;">
    <b>Cortar: frete grátis empilhado custou cerca de R$ ${fmt(avulso.invL / avulso.ped * emp.ped)}</b>
    <span style="color:var(--tx-3);"> · ${emp.ped.toLocaleString('pt-BR')} pedidos com frete grátis em cima de outro desconto nosso</span></div>`;
}

// Alavancagem loja a loja — é por aqui que acompanhamos o teste: as lojas em teste
// devem subir a alavancagem sem perder pedidos contra as lojas de controle.
// Usa os pedidos (diários), não o relatório mensal de promoções, para dar leitura semanal.
function blocoAlavancagemPorLoja() {
  const rows = linhasFiltradas(true).filter(r => r[6] !== 1);
  if (!rows.length) return '';

  const porLoja = new Map();
  rows.forEach(r => {
    const k = r[0];
    if (!porLoja.has(k)) porLoja.set(k, { loja: k, uni: r[1], ped: 0, bruto: 0, nosso: 0, ifood: 0 });
    const o = porLoja.get(k);
    o.ped += r[7];
    o.bruto += (r[8] - r[9]) + r[10];
    o.nosso += r[13] + r[12];  // incentivo bancado pela loja + pela rede (os dois são nossos)
    o.ifood += r[11];          // incentivo do iFood
  });

  const lista = [...porLoja.values()]
    .filter(o => o.ped > 0)
    .map(o => ({
      ...o,
      nome: LOJAS[o.loja], unidade: UNIDADES[o.uni],
      promoPed: o.ped ? o.nosso / o.ped : 0,
      alav: o.nosso > 0.005 ? o.ifood / o.nosso : null,
    }))
    .sort((a, b) => (b.alav || 0) - (a.alav || 0));

  const totNosso = lista.reduce((s, o) => s + o.nosso, 0);
  const totIfood = lista.reduce((s, o) => s + o.ifood, 0);
  const alavTxt = alavancagemTxt;   // farol unico: a meta de metas_kpi, nao o 0,80x da mao

  return `
  <div class="section-label">Alavancagem por loja — quem faz o iFood pagar mais</div>
  <div class="caption-label" style="text-align:center;" title="Nosso = incentivo da loja + incentivo da rede (os dois saem do nosso bolso); iFood = incentivo do iFood. Acima de 1,00x o iFood banca mais que nós. É por esta tabela que acompanhamos o teste semana a semana.">
    Mesmos valores do teste acima, loja a loja, da melhor <b>alavancagem</b> para a pior — com o total da rede no fim.
  </div>
  <div id="tabelaAlavLoja">
    <table>
      <tr><th>Loja</th><th>Unidade</th><th>Pedidos</th><th>Nossa promo (R$)</th><th>Promo/pedido</th><th>iFood (R$)</th><th>Alavancagem</th></tr>
      ${lista.map(o => `<tr>
        <td>${o.nome}</td><td>${o.unidade}</td>
        <td>${o.ped.toLocaleString('pt-BR')}</td>
        <td>R$ ${fmt(o.nosso)}</td>
        <td>R$ ${fmt(o.promoPed)}</td>
        <td>R$ ${fmt(o.ifood)}</td>
        <td>${alavTxt(o.alav)}</td></tr>`).join('')}
      <tr class="sub"><td><b>REDE</b></td><td></td><td></td><td><b>R$ ${fmt(totNosso)}</b></td><td></td>
        <td><b>R$ ${fmt(totIfood)}</b></td><td>${alavTxt(totNosso > 0.005 ? totIfood / totNosso : null)}</td></tr>
    </table>
  </div>`;
}

function blocoMecanicas() {
  const d = decomporPorMecanica();
  if (!d.lista.length) return '';
  const alavTxt = alavancagemTxt;   // farol unico: a meta de metas_kpi, nao o 0,50x da mao

  const linhas = d.lista.map(o => `<tr>
      <td>${o.mec}</td>
      <td>${o.ped.toLocaleString('pt-BR')}</td>
      <td>R$ ${fmt(o.invL)}</td>
      <td>${pct(o.pctVerba)}%</td>
      <td>R$ ${fmt(o.invI)}</td>
      <td>${alavTxt(o.alav)}</td>
      <td>R$ ${fmt(o.porPedido)}</td>
    </tr>`).join('');

  return `
  <div class="section-label">Cada promoção isolada — quanto custa e quanto o iFood devolve</div>
  <div class="caption-label" style="text-align:center;">Cada mecânica pelos pedidos em que veio sozinha; o que sobra é o Frete Grátis.</div>
  <div id="tabelaMecanicas">
    <table>
      <tr><th>Promoção</th><th>Pedidos</th><th>Nós (R$)</th><th>% da verba</th><th>iFood (R$)</th><th>Alavancagem</th><th>Nosso R$/pedido</th></tr>
      ${linhas}
      <tr class="sub"><td><b>TOTAL</b></td><td></td><td><b>R$ ${fmt(d.totL)}</b></td><td>100%</td><td><b>R$ ${fmt(d.totI)}</b></td><td>${alavTxt(d.alavGeral)}</td><td></td></tr>
      <tr class="liq"><td><b>Total SEM o Frete Grátis avulso</b></td><td></td><td><b>R$ ${fmt(d.semFreteL)}</b></td><td></td><td><b>R$ ${fmt(d.semFreteI)}</b></td><td>${alavTxt(d.alavSemFrete)}</td><td></td></tr>
    </table>
  </div>`;
}

// ------------------------------------------------------------------
// TESTE DE PROMOÇÕES (desde 10/08/2026): Hits + Campanha Inteligente + Frete grátis
// (R$ 9,99 no começo; R$ 6,99 desde 13/08; o de 9,99 desligado em 13/10). Anúncios pagos à parte.
// Verbas SEMANAIS configuradas no portal (fonte de verdade: tabela verbas_promo).
// Acompanhamento diário via incentivos por pedido (quem bancou: loja/rede vs iFood).
// VERBA DO TESTE DE PROMOCOES — decisao do dono em 12/09/2026: a verba do portal
// e DIARIA, nao semanal. O painel dividia por 7 e mostrava 911,7% no Burger Agua
// Verde. Medido no dia, gasto por dia contra a verba cadastrada: Burger AV 107%,
// Ahu 99%, Sao Braz 93% — nenhuma das 13 lojas passa de 107%. Lido como semanal,
// 11 das 13 estouram e uma chega a 751%. Bate com o corte que o dono fez em 13/08
// ("verba do Hits do Sao Braz por dia para 100,00").
//
// A lista abaixo era uma CONSTANTE duplicando a tabela verbas_promo. Agora o valor
// vem do banco (vw_verbas_promo, carregada no boot) e a constante ficou so como
// ultimo recurso, para o painel nao mostrar traco se a view falhar.
let VERBAS_PROMO = null;   // nome_loja -> verba diaria total (hits + campanha inteligente)

const VERBAS_TESTE = [
  ['A Famosa Marmita', 300], ['Baixa Gastronomia', 300], ['Burger - Água Verde', 1000],
  ['Burger - Ahú', 200], ['Burger - São Braz', 200], ['Comida Brasileira - Ahú', 200],
  ['Comida Brasileira AV', 200], ['Comida Brasileira - Sb', 200], ['Vegan  - Ahú', 200],
  ['Vegan Burger Agua Verde', 200], ['Vegan - São Braz', 200], ['Ufo Burger', 200],
  ['Veganete - Agua Verde', 200],
];

const verbaDaLoja = (nome) => {
  if (VERBAS_PROMO && VERBAS_PROMO[nome] !== undefined) return VERBAS_PROMO[nome];
  const v = VERBAS_TESTE.find(([t]) => nome.includes(t));
  return v ? v[1] : null;
};

// Agrega investimento promocional por loja no intervalo: nosso (loja+rede) x iFood.
function promoTesteResumo(ini, fim) {
  const rows = linhasFiltradas(true, ini, fim).filter(r => r[6] !== 1);
  const porLoja = new Map();
  rows.forEach(r => {
    if (!porLoja.has(r[0])) porLoja.set(r[0], { loja: r[0], ped: 0, bruto: 0, nosso: 0, ifood: 0 });
    const o = porLoja.get(r[0]);
    o.ped += r[7]; o.bruto += (r[8] - r[9]) + r[10];
    o.nosso += r[13] + r[12]; o.ifood += r[11];
  });
  const lojas = [...porLoja.values()].filter(o => o.ped > 0).sort((a, b) => b.nosso - a.nosso);
  const tot = lojas.reduce((s, o) => ({ ped: s.ped + o.ped, bruto: s.bruto + o.bruto, nosso: s.nosso + o.nosso, ifood: s.ifood + o.ifood }),
    { ped: 0, bruto: 0, nosso: 0, ifood: 0 });
  return { lojas, tot };
}

function blocoTestePromos() {
  const atual = promoTesteResumo();
  if (!atual.tot.ped) return '';
  const ant = periodoAnterior();
  const antR = ant ? promoTesteResumo(ant.ini, ant.fim) : null;

  const alav = (o) => o.nosso > 0.005 ? o.ifood / o.nosso : null;
  const alavTxt = alavancagemTxt;   // farol unico: a meta de metas_kpi — esta tabela nem tinha âmbar

  // 07/11/2026 (auditoria dos numeros, lote 2, canal-19): saiu a coluna "% da verba do dia". O numerador era TODA a
  // promocao da loja (Frete gratis, Clube, cupom...) e o denominador a verba de 10/08 (vw_verbas_promo), que nao e' mais
  // a do portal (desde 19/10 a verba do Hits mora em hits_config). Dava vermelho falso de "Hits racionando" (AV 142,7%).
  // A medida certa do Hits e' vw_hits_verba_x_consumo, ainda sem tela.
  const linhas = atual.lojas.map(o => {
    const nome = LOJAS[o.loja];
    const prev = antR && antR.lojas.find(x => x.loja === o.loja);
    return `<tr>
      <td>${nome}</td><td>${o.ped.toLocaleString('pt-BR')}</td>
      <td>R$ ${fmt(o.nosso)}</td><td>R$ ${fmt(o.ifood)}</td>
      <td>${alavTxt(alav(o))}</td>
      <td>${o.ped ? 'R$ ' + fmt(o.nosso / o.ped) : '—'}</td>
      <td>${variacaoSpan(o.nosso, prev ? prev.nosso : (antR ? 0 : null), 'neutro')}</td>
    </tr>`;
  }).join('');

  const t = atual.tot;
  const alavGeral = alav(t);
  return `
  <div class="section-label" style="border-top:none; margin-top:0; padding-top:0;">Teste de promoções — quem está pagando a conta</div>
  <div class="caption-label" style="text-align:center;" title="Teste desde 10/08/2026: Hits + Campanha Inteligente + Frete grátis (até R$ 6,99 desde 13/08) e anúncios pagos à parte. Nosso = incentivo da loja + incentivo da rede (os dois saem do nosso bolso); iFood = incentivo do iFood. Fonte: pedidos do dia, no período filtrado no topo.">
Alavancagem = R$ do iFood para cada R$ 1 nosso; meta acima de 1,00x.</div>
  <div class="cards">
    <div class="card neutral"><div class="card-lbl">Investimos (loja + rede)</div><div class="card-val">R$ ${fmt(t.nosso)}</div>${selo(t.nosso, antR && antR.tot.nosso, 'neutro')}</div>
    <div class="card pos"><div class="card-lbl">iFood investiu</div><div class="card-val">R$ ${fmt(t.ifood)}</div>${selo(t.ifood, antR && antR.tot.ifood)}</div>
    <div class="card neutral"${cardFarol('alavancagem', alavGeral)}><div class="card-lbl">Alavancagem</div><div class="card-val">${alavGeral === null ? '—' : alavGeral.toFixed(2).replace('.', ',') + 'x'}</div><div class="card-pct">R$ do iFood por R$ 1 nosso</div></div>
    <div class="card neutral"><div class="card-lbl">Nosso custo por pedido</div><div class="card-val">R$ ${fmt(t.ped ? t.nosso / t.ped : 0)}</div>${selo(t.ped ? t.nosso / t.ped : 0, antR && antR.tot.ped ? antR.tot.nosso / antR.tot.ped : null, 'menorMelhor')}</div>
  </div>
  <div id="tabelaTestePromo">
    <table>
      <tr><th>Loja</th><th>Pedidos</th><th>Nós (R$)</th><th>iFood (R$)</th><th>Alavanc.</th><th>Nosso R$/pedido</th><th>Nosso invest. vs anterior</th></tr>
      ${linhas}
      <tr class="liq"><td><b>REDE</b></td><td>${t.ped.toLocaleString('pt-BR')}</td><td>R$ ${fmt(t.nosso)}</td><td>R$ ${fmt(t.ifood)}</td>
        <td>${alavTxt(alavGeral)}</td><td>${t.ped ? 'R$ ' + fmt(t.nosso / t.ped) : '—'}</td><td>${variacaoSpan(t.nosso, antR ? antR.tot.nosso : null, 'neutro')}</td></tr>
    </table>
  </div>`;
}

function moduloPromocoes() {
  const r = resumoPromocoes();
  const teste = promoDecisaoTopo() + blocoTestePromos();

  // Os blocos que dependem do relatório MENSAL de promoções (decomposição por
  // mecânica e recorte de frete) só existem nos meses importados. Os que vêm dos
  // pedidos diários — teste e alavancagem por loja — funcionam sempre e ficam fora
  // deste corte, senão o painel some justo no período mais recente.
  if (!r.lista.length) {
    const disp = periodosPromoDisponiveis();
    // 12/11/2026 (auditoria lote 3, canal-34): a "Alavancagem por loja" repetia a tabela do teste (agora com a linha REDE)
    return teste + `
    <div class="contexto" style="text-align:left; border-color:var(--farol-perto); margin-top:16px;">
      <b>Quebra por promoção só nos períodos do relatório do iFood.</b>
      ${disp.length ? `Escolha um que contenha: <b>${disp.join('</b> · <b>')}</b>` : 'Nenhum relatório importado ainda.'}
    </div>`;
  }

  const invPorPedidoGeral = r.totalPedidos ? r.totalInv / r.totalPedidos : 0;
  const pctIfoodGeral = (r.totalInv + r.totalInvIfood) ? r.totalInvIfood / (r.totalInv + r.totalInvIfood) * 100 : 0;
  const mesesTexto = r.periodos.join(' · ');

  // A estrategia com maior verba e a que vale comparar entre lojas.
  const principal = r.lista[0];
  const porLoja = promocoesPorLoja(principal.estrategia);

  const linhasTabela = r.lista.map(x => `<tr>
      <td>${x.estrategia}</td>
      <td>${x.ped.toLocaleString('pt-BR')}</td>
      <td>R$ ${fmt(x.invL)}</td>
      <td>${pct(x.pctVerba)}%</td>
      <td>R$ ${fmt(x.invPorPedido)}</td>
      <td>R$ ${fmt(x.ticket)}</td>
      <td>${pct(x.pctIfood)}%</td>
    </tr>`).join('');

  const linhasLojas = porLoja.map(x => `<tr>
      <td>${x.nome}</td>
      <td>${x.ped.toLocaleString('pt-BR')}</td>
      <td>R$ ${fmt(x.invL)}</td>
      <td>R$ ${fmt(x.invPorPedido)}</td>
      <td>R$ ${fmt(x.ticket)}</td>
    </tr>`).join('');

  // 12/11/2026 (auditoria lote 3, canal-34): "Investido pela loja" e "Bancado pelo iFood" saíram daqui (o par de cartões
  // fica no teste, no topo; o total do relatório está na linha TOTAL das mecânicas)
  return teste + blocoMecanicas() + blocoFreteGratis() + `
  <div class="section-label">Quanto e onde investimos em promoção (relatório de promoções)</div>
  <div class="caption-label" style="text-align:center;" title="O relatório vem por semana fechada (seg–dom; até julho, mês) e não recorta por dia nem turno.">Recortes inteiros dentro do período: <b>${mesesTexto}</b> · iFood bancou ${pct(pctIfoodGeral)}% do total.</div>
  <div class="cards">
    <div class="card neutral"><div class="card-lbl">Pedidos com promoção</div><div class="card-val">${r.totalPedidos.toLocaleString('pt-BR')}</div></div>
    <div class="card neutral"><div class="card-lbl">Investido por pedido</div><div class="card-val">R$ ${fmt(invPorPedidoGeral)}</div></div>
  </div>

  <details ontoggle="if (this.open) renderChartsPromocoes();" style="margin-top:14px;">
  <summary class="section-label" style="cursor:pointer;">▸ Relatório mensal do iFood: verba por estratégia e por loja</summary>
  <div class="chart-grid">
    <div class="chart-box" style="height:320px;">
      <div class="chart-title">Investimento da loja por estratégia (R$)</div>
      <div class="chart-canvas-wrap"><canvas id="chartPromoVerba"></canvas></div>
    </div>
    <div class="chart-box" style="height:320px;">
      <div class="chart-title">Custo por pedido x ticket médio de cada estratégia</div>
      <div class="chart-canvas-wrap"><canvas id="chartPromoCustoTicket"></canvas></div>
    </div>
  </div>
  <div class="caption-label" style="text-align:center;">Direita: à esquerda custa menos por pedido, acima traz pedido maior; bolha = verba.</div>

  <div class="section-label">Detalhe por estratégia</div>
  <div id="tabelaPromo">
    <table>
      <tr><th>Estratégia (verbas combinadas)</th><th>Pedidos</th><th>Investido</th><th>% da verba</th>
          <th>R$ por pedido</th><th>Ticket médio</th><th>iFood banca</th></tr>
      ${linhasTabela}
      <tr class="liq"><td><b>TOTAL</b></td><td>${r.totalPedidos.toLocaleString('pt-BR')}</td><td>R$ ${fmt(r.totalInv)}</td><td>100%</td>
        <td>R$ ${fmt(invPorPedidoGeral)}</td><td>R$ ${fmt(r.totalPedidos ? r.totalVendas / r.totalPedidos : 0)}</td><td>${pct(pctIfoodGeral)}%</td></tr>
    </table>
  </div>

  <div class="section-label">Mesma estratégia, lojas diferentes</div>
  <div class="caption-label" style="text-align:center;"><b>${principal.estrategia}</b> (a maior verba do período), loja a loja.</div>
  <div id="tabelaPromoLojas">
    <table>
      <tr><th>Loja</th><th>Pedidos</th><th>Investido</th><th>R$ por pedido</th><th>Ticket médio</th></tr>
      ${linhasLojas}
      ${(() => { const t = porLoja.reduce((s, x) => ({ ped: s.ped + x.ped, invL: s.invL + x.invL, v: s.v + x.ticket * x.ped }), { ped: 0, invL: 0, v: 0 });
        return `<tr class="liq"><td><b>TOTAL</b></td><td>${t.ped.toLocaleString('pt-BR')}</td><td>R$ ${fmt(t.invL)}</td><td>R$ ${fmt(t.ped ? t.invL / t.ped : 0)}</td><td>R$ ${fmt(t.ped ? t.v / t.ped : 0)}</td></tr>`; })()}
    </table>
  </div>
  </details>`;
}

function renderChartsPromocoes() {
  if (!document.getElementById('chartPromoVerba')) return;
  const r = resumoPromocoes();
  if (!r.lista.length) return;
  const dados = r.lista.filter(x => x.invL > 0);

  destroyChart('chartPromoVerba');
  chartInstances['chartPromoVerba'] = new Chart(document.getElementById('chartPromoVerba').getContext('2d'), {
    type: 'bar',
    data: { labels: dados.map(d => d.estrategia), datasets: [{ data: dados.map(d => d.invL), backgroundColor: corToken('--brand'), borderRadius: 4 }] },
    plugins: [pluginRotulosBarra(i => 'R$ ' + fmt(dados[i].invL))],
    options: {
      indexAxis: 'y', responsive: true, maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: { callbacks: { label: (c) => {
          const d = dados[c.dataIndex];
          return `R$ ${fmt(d.invL)} (${pct(d.pctVerba)}% da verba) em ${d.ped.toLocaleString('pt-BR')} pedidos`;
        } } },
      },
      scales: {
        x: { beginAtZero: true, max: Math.max(...dados.map(d => d.invL)) * 1.25, title: { display: true, text: 'R$ investidos pela loja' }, grid: { color: '#232321' } },
        y: { grid: { display: false }, ticks: { font: { size: 10 } } },
      },
    },
  });

  const maxInv = Math.max(1, ...dados.map(d => d.invL));
  destroyChart('chartPromoCustoTicket');
  chartInstances['chartPromoCustoTicket'] = new Chart(document.getElementById('chartPromoCustoTicket').getContext('2d'), {
    type: 'bubble',
    data: { datasets: [{
      data: dados.map(d => ({ x: d.invPorPedido, y: d.ticket, r: 5 + (d.invL / maxInv) * 22, label: d.estrategia, invL: d.invL, ped: d.ped })),
      backgroundColor: corTokenA('--brand', 0.40), borderColor: corToken('--brand'),
    }] },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: { callbacks: { label: (c) => `${c.raw.label}: custa R$ ${fmt(c.raw.x)}/pedido, ticket R$ ${fmt(c.raw.y)} — R$ ${fmt(c.raw.invL)} investidos` } },
      },
      scales: {
        x: { title: { display: true, text: 'Custo da promoção por pedido (R$)' }, beginAtZero: true },
        y: { title: { display: true, text: 'Ticket médio do pedido (R$)' } },
      },
    },
  });
}

// ------------------------------------------------------------------
// MODULOS NEGOCIACOES, AVALIACOES E RELATORIOS (carga sob demanda)
// ------------------------------------------------------------------
// null = ainda nao buscado; array = pronto. Buscados so na primeira visita ao modulo.
let NEGOCIACOES = null;

// RECORTE POR MOTIVO (12/09/2026): clicar numa barra do grafico faz a tabela de
// lojas falar so' daquele motivo. O cruzamento motivo x loja e' o que diz para qual
// gerente ligar — hoje isso se faz de cabeca. Mecanismo copiado do modulo Evolucao:
// clicar de novo solta, e a dimensao filtrada (o grafico de motivos) continua
// mostrando TODOS os motivos, senao nao da para trocar de escolha.
// O nome vai por INDICE, nunca como string dentro do onclick.
let NEG_MOTIVO = null;

let NEG_LISTA_MOTIVOS = [];

function negMotivoFiltrar(i) {
  const m = NEG_LISTA_MOTIVOS[i];
  if (!m) return;
  NEG_MOTIVO = (NEG_MOTIVO === m) ? null : m;
  renderModuloNegociacoes();
}

function negMotivoLimpar() { NEG_MOTIVO = null; renderModuloNegociacoes(); }

// Correcao 17/08/2026: "sem resposta" NAO e quem_respondeu vazio.
// Esse campo fica vazio quando a reclamacao e de um tipo que o iFood resolve direto com o
// cliente (momento "APOS A ENTREGA": item faltando, pedido improprio, item errado) — a loja
// nunca e chamada a responder. Prova: o vazio e determinado pelo MOTIVO, nao pela loja nem
// pela semana (atraso 1,3% de vazio em 400 casos x parte do item nao enviado 62% em 129), e o
// padrao se repete em 15 lojas. A Burger Agua Verde respondeu 187 de 187 negociacoes por atraso.
// Tambem: quando quem_iniciou = PARCEIRO, o vazio significa que o CLIENTE nao respondeu.
// Indices da linha: 4=momento, 5=quem_respondeu, 9=quem_iniciou.
const negRespondivel = r => (r[4] || '') !== 'APOS A ENTREGA';

const negSemResposta = r => negRespondivel(r) && (r[9] || '') === 'CLIENTE' && !r[5];

const negPosEntrega  = r => (r[4] || '') === 'APOS A ENTREGA';

let AVALIACOES = null;

// NOTA RUIM = NOTA 1, 2 OU 3 (dono, 06/10/2026: "o que considero notas ruins que baixam a
// media"; ate entao a conta era so de notas 1 e 2). A regra mora SO AQUI. Card e quadro por
// loja do modulo Avaliacoes, lista de reclamacoes, Placar/Indicadores, "Esta semana" e gerador
// de relatorio chamam estas linhas: o mesmo numero em toda tela. O indicador e' o
// pct_notas_ruins de metas_kpi (o nome e a meta vem do banco). Mudar a regra = mudar o 3
// daqui, o NOTA_RUIM_ATE de script/resumo_semanal_dados.py e o nome da meta no banco, JUNTOS.
const NOTA_RUIM_ATE = 3;

const NOTA_RUIM_ROT = 'notas 1 a ' + NOTA_RUIM_ATE;   // como a tela chama

const notaRuim = r => r[2] <= NOTA_RUIM_ATE;           // r = linha de avaliacao (r[2] = nota)

function notasRuins(ls) {                              // quantas sao e que % fazem de uma lista de avaliacoes
  const n = ls.filter(notaRuim).length;
  return { n, pct: ls.length ? n / ls.length * 100 : null };
}

// Criticas marcadas pelos clientes (vw_avaliacoes_criticas, API Review). null = ainda nao
// carregou OU a view nao respondeu: o bloco "O que mais criticam" some e o resto da tela segue.
// cols: loja, data (dia do pedido), nota, criticas[], comentario, aguardando resposta, id curto,
//       itens do pedido[] (o que o cliente pediu, ja escrito pela view; [] quando o iFood nao guarda mais)
let AVAL_CRITICAS = null;

let AVAL_CRITICAS_TENTOU = false; // a leitura das criticas sai UMA vez por visita ao painel

let AVAL_CRITICAS_BATE = null;    // true = toda critica tem a avaliacao dela nesta tela; so assim o bloco aparece

let AVAL_CRITICA_SEL = null;     // critica escolhida no grafico: recorta a lista de comentarios

let AVAL_LISTA_CRITICAS = [];    // ordem das barras, para o clique achar o nome pela posicao

function avalCriticaFiltrar(i) {
  const c = AVAL_LISTA_CRITICAS[i];
  if (!c) return;
  AVAL_CRITICA_SEL = (AVAL_CRITICA_SEL === c) ? null : c;
  renderModuloAvaliacoes();
  const el = document.getElementById('avalReclamacoes');
  if (AVAL_CRITICA_SEL && el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function avalCriticaLimpar() { AVAL_CRITICA_SEL = null; renderModuloAvaliacoes(); }

// Filtro da tela por loja (06/10/2026), mecanismo do modulo evolucao: clicar numa linha de
// "Nota por loja" (ou da tabela das lojas da critica) faz cards, graficos e reclamacoes
// falarem so daquela loja; clicar de novo solta. A tabela por loja segue com todas.
let AVAL_LOJA_SEL = null;        // indice da loja em LOJAS

let AVAL_LISTA_LOJAS = [];       // ordem das linhas de "Nota por loja", para o clique achar a loja pela posicao

let AVAL_LISTA_LOJAS_CRIT = [];  // idem, tabela das lojas da critica escolhida

let AVAL_RECL_N = 20;            // quantas reclamacoes a lista mostra (20, +20, todas)

let AVAL_RECL_CHAVE = '';        // periodo + filtro geral + loja + critica: mudou, a lista volta para 20

// Datas da lista de reclamacoes (06/10/2026, noite). AVAL_CRIT_DATAS = a view ja traz pedido_em,
// avaliado_em e visto_em (script/sql/avaliacoes_datas_e_novas.sql). false = view antiga: a lista
// sai como sempre saiu — sem hora, sem ordenar e sem "novas" — e nada da erro na tela.
let AVAL_CRIT_DATAS = false;

let AVAL_SO_NOVAS = false;       // a lista mostra so as reclamacoes que chegaram nas ultimas 24 h

let AVAL_RECL_ORD = { col: 'aval', dir: -1 };   // a lista ABRE pela avaliacao mais recente (o que chegou agora)

// coluna, nome na tela, sentido do primeiro clique (-1 = maior/mais recente primeiro), dica
const AVAL_ORD_COLS = [
  ['ped', 'Pedido', -1, 'Dia e hora do pedido (horário de Curitiba) e o turno, pela mesma regra do filtro de turno do painel.'],
  ['aval', 'Avaliação', -1, 'Dia e hora em que o cliente avaliou. O iFood só libera a avaliação cerca de 24 horas depois.'],
  ['loja', 'Loja', 1, ''],
  ['nota', 'Nota', 1, ''],
];

// Mecanismo do Contas a pagar (cpOrdenar): clicar no nome da coluna ordena; de novo, inverte.
// A ordem vale para a lista inteira (antes do "Ver mais") e trocar de ordem volta para 20.
function avalReclOrdenar(col) {
  const def = AVAL_ORD_COLS.find(c => c[0] === col);
  if (!def) return;
  AVAL_RECL_ORD = AVAL_RECL_ORD.col === col ? { col, dir: -AVAL_RECL_ORD.dir } : { col, dir: def[2] };
  AVAL_RECL_N = 20;
  renderModuloAvaliacoes();
}

// "N reclamações novas desde ontem": clicar mostra so elas; clicar de novo solta. A pagina NAO
// rola ate a lista: o botao clicado tem de ficar PARADO sob o mouse, senao o segundo clique cai
// em outra coisa (cabecalho que ordena, loja). Mesmo cuidado de avalLojaFiltrar: mede onde a
// ancora estava (id do bloco de quem foi clicado), redesenha e rola a diferenca. Mede pela BASE
// do bloco: o chip do titulo da lista, quando some, pode levar uma linha do titulo junto, e o
// que tem de ficar parado e a lista logo abaixo (senao o cabecalho que ordena sobe para o mouse).
function avalNovasFiltrar(ancora) {
  const el = () => ancora ? document.getElementById(ancora) : null;
  const antes = el();
  const base = antes ? antes.getBoundingClientRect().bottom : null;
  AVAL_SO_NOVAS = !AVAL_SO_NOVAS;
  renderModuloAvaliacoes();
  const depois = el();
  if (base === null || !depois) return;
  const alvo = document.getElementById('view-avaliacoes');
  const rolo = document.scrollingElement || document.documentElement;
  // lista que encolheu (so as novas) pode nao deixar rolagem para chegar la: sobra espaco no fim
  const falta = (rolo.scrollTop + depois.getBoundingClientRect().bottom - base) - (rolo.scrollHeight - rolo.clientHeight);
  if (falta > 0) alvo.style.minHeight = Math.ceil(alvo.offsetHeight + falta + 2) + 'px';
  const d = depois.getBoundingClientRect().bottom - base;
  if (d) window.scrollBy({ top: d, behavior: 'instant' });
}

// TURNO pela hora do pedido — a MESMA regra do filtro de turno do painel (coluna TURNO do export
// do iFood, fato_pedidos.turno; medida em 06/10/2026: as 5.734 avaliacoes casam com o pedido e a
// hora da o mesmo turno em todas): 0h e 1h madrugada, 10h a 14h almoço, 15h e 16h café da tarde,
// 17h a 23h jantar. Das 2h as 9h nunca houve pedido: fica sem turno, nao se inventa.
function avalTurno(h) {
  return (h === 0 || h === 1) ? 'madrugada' : (h >= 10 && h <= 14) ? 'almoço'
    : (h === 15 || h === 16) ? 'café da tarde' : (h >= 17 && h <= 23) ? 'jantar' : '';
}

// 'AAAA-MM-DDTHH:MM:SS' (horario de Curitiba, como a view manda) em pedacos para a tela.
// So o dia ('AAAA-MM-DD') = sem hora. Nada reconhecivel = null.
function avalDataHora(s) {
  const m = /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2}))?/.exec(s || '');
  return m ? { dia: m[3] + '/' + m[2], ano: m[1], hora: m[4] ? m[4] + ':' + m[5] : '', h: m[4] ? +m[4] : null } : null;
}

// "Nova" = entrou no nosso banco nas ultimas 24 horas (coluna visto_em). Devolve o corte como
// texto no horario de Curitiba, para comparar com o que a view manda; null = o navegador nao
// soube escrever a hora (ai ninguem e nova). Avaliacao SEM visto_em (ja existia quando a coluna
// nasceu) nunca e nova: nao se sabe quando chegou e nao se chuta.
function avalCorteNovas() {
  const c = new Date(Date.now() - 24 * 3600 * 1000).toLocaleString('sv-SE', { timeZone: 'America/Sao_Paulo' }).replace(' ', 'T');
  return /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/.test(c) ? c : null;
}

function avalLojaFiltrar(i, daCritica) {
  const l = (daCritica ? AVAL_LISTA_LOJAS_CRIT : AVAL_LISTA_LOJAS)[i];
  if (l === undefined) return;
  // O aviso "Filtrando" nasce (ou some) acima da tabela e empurra as linhas. A linha clicada
  // tem de ficar PARADA sob o mouse, senao o segundo clique cai em outra loja: mede onde ela
  // estava, redesenha, e rola a pagina a diferenca.
  const linha = () => {
    const j = (daCritica ? AVAL_LISTA_LOJAS_CRIT : AVAL_LISTA_LOJAS).indexOf(l);
    return j < 0 ? null : (document.querySelectorAll('#' + (daCritica ? 'tabelaCriticaLojas' : 'tabelaAvalLojas') + ' tr.aval-clic')[j] || null);
  };
  const antes = linha();
  const topo = antes ? antes.getBoundingClientRect().top : null;
  AVAL_LOJA_SEL = (AVAL_LOJA_SEL === l) ? null : l;
  renderModuloAvaliacoes();
  const depois = linha();
  if (topo === null || !depois) return;
  const alvo = document.getElementById('view-avaliacoes');
  const rolo = document.scrollingElement || document.documentElement;
  // pagina que encolheu (loja com poucas reclamacoes) pode nao ter rolagem para chegar la: sobra espaco no fim
  const falta = (rolo.scrollTop + depois.getBoundingClientRect().top - topo) - (rolo.scrollHeight - rolo.clientHeight);
  if (falta > 0) alvo.style.minHeight = Math.ceil(alvo.offsetHeight + falta + 2) + 'px';
  window.scrollBy({ top: depois.getBoundingClientRect().top - topo, behavior: 'instant' });
}

function avalLojaLimpar() { AVAL_LOJA_SEL = null; renderModuloAvaliacoes(); }

function avalLimparFiltros() { AVAL_LOJA_SEL = null; AVAL_CRITICA_SEL = null; AVAL_SO_NOVAS = false; renderModuloAvaliacoes(); }

// "DIA RUIM NA COZINHA" (06/10/2026, noite). A regra, num lugar so: a MESMA critica marcada em
// AVAL_DIARUIM_MIN ou mais avaliacoes de nota ruim (1 a NOTA_RUIM_ATE), em pedidos do MESMO dia,
// na MESMA unidade (cozinha: UNIDADES[lojaToUnidade[loja]], a mesma ligacao do filtro de unidade).
// Janela FIXA: pedidos dos ultimos AVAL_DIARUIM_DIAS dias (hoje contando), horario de Curitiba —
// nao depende do filtro de periodo; respeita o filtro geral de unidade/marca. Um aviso por
// unidade e dia: a critica mais repetida faz a linha, as outras do mesmo dia vem logo abaixo
// (sao quase sempre as mesmas avaliacoes: quem da nota ruim marca em media 2 criticas).
// AVAL_DIARUIM_MIN_UNIDADE: limite proprio de uma unidade, pela grafia de dim_lojas.
// Agua Verde = 5 porque ela recebe 36 avaliacoes por dia (as outras, 6 a 10): medido em
// 07/10/2026 sobre 96 dias, com 3 ela acenderia em 28 dias — o mesmo que embaralhar as criticas
// ao acaso da (26) — e a caixa ficaria acesa em 89 de 92 dias. Com 5 sao 6 dias contra 3 no
// acaso. Nas outras unidades 3 e raro de verdade (1 dia em 96). O dia e o do calendario, como
// no resto do modulo (pedido da madrugada conta no dia em que foi feito).
const AVAL_DIARUIM_MIN = 3;

const AVAL_DIARUIM_MIN_UNIDADE = { 'AGUA VERDE': 5 };

const AVAL_DIARUIM_DIAS = 7;

let AVAL_DIA_SEL = null;         // dia ruim escolhido { u: unidade, d: 'AAAA-MM-DD', c: critica }: recorta a lista de reclamacoes

let AVAL_LISTA_DIAS = [];        // ordem dos botoes do aviso, para o clique achar o caso pela posicao

const AVAL_DIAS_SEMANA = ['domingo', 'segunda', 'terça', 'quarta', 'quinta', 'sexta', 'sábado'];

const avalMesmoDia = (a, b) => !!a && !!b && a.u === b.u && a.d === b.d && a.c === b.c;

const avalUnidadeDaLoja = (i) => UNIDADES[lojaToUnidade[i]];

const avalUnidadeNome = (u) => (SERIE_UNIDADE[u] && SERIE_UNIDADE[u].nome) || u;

const avalEsc = (s) => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;')
  .replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');

// { ini, fim } em 'AAAA-MM-DD'; null = o navegador nao soube escrever a data (ai nao ha aviso).
function avalDiaRuimJanela() {
  const hoje = new Date(Date.now()).toLocaleString('sv-SE', { timeZone: 'America/Sao_Paulo' }).slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(hoje)) return null;
  const d = new Date(hoje + 'T12:00:00Z');
  d.setUTCDate(d.getUTCDate() - (AVAL_DIARUIM_DIAS - 1));
  return { ini: d.toISOString().slice(0, 10), fim: hoje };
}

// Devolve [{ u, d, aval (avaliacoes da unidade naquele dia), casos: [{ u, d, c, n, lojas, de, ate }] }],
// do dia mais recente para o mais antigo. Sem criticas carregadas e conferidas, devolve [].
// de/ate = primeira e ultima hora dos pedidos; '' quando a view ainda nao traz a hora.
function avalDiasRuins() {
  if (AVAL_CRITICAS === null || AVAL_CRITICAS_BATE !== true || AVALIACOES === null) return [];
  const jan = avalDiaRuimJanela();
  if (!jan) return [];
  const ativas = activeLojas();
  const grupos = new Map();
  AVAL_CRITICAS.forEach(r => {
    if (!notaRuim(r) || r[1] < jan.ini || r[1] > jan.fim || !ativas.has(r[0])) return;
    const u = avalUnidadeDaLoja(r[0]);
    if (u === undefined) return;
    [...new Set(r[3])].forEach(c => {
      const k = u + '|' + r[1] + '|' + c;
      if (!grupos.has(k)) grupos.set(k, { u, d: r[1], c, linhas: [] });
      grupos.get(k).linhas.push(r);
    });
  });
  const dias = new Map();
  grupos.forEach(g => {
    if (g.linhas.length < (AVAL_DIARUIM_MIN_UNIDADE[g.u] || AVAL_DIARUIM_MIN)) return;
    const horas = AVAL_CRIT_DATAS ? g.linhas.map(r => (avalDataHora(r[8]) || {}).hora || '').sort() : [];
    const comHora = horas.length > 0 && horas.every(Boolean);
    const k = g.u + '|' + g.d;
    if (!dias.has(k)) dias.set(k, { u: g.u, d: g.d, casos: [],
      aval: AVALIACOES.filter(a => a[1] === g.d && ativas.has(a[0]) && avalUnidadeDaLoja(a[0]) === g.u).length });
    dias.get(k).casos.push({ u: g.u, d: g.d, c: g.c, n: g.linhas.length, lojas: new Set(g.linhas.map(r => r[0])).size,
      de: comHora ? horas[0] : '', ate: comHora ? horas[horas.length - 1] : '' });
  });
  const lista = [...dias.values()];
  lista.forEach(x => x.casos.sort((a, b) => b.n - a.n || a.c.localeCompare(b.c, 'pt-BR')));
  return lista.sort((a, b) => (a.d < b.d ? 1 : a.d > b.d ? -1 : 0)
    || avalUnidadeNome(a.u).localeCompare(avalUnidadeNome(b.u), 'pt-BR'));
}

// "Água Verde, quinta 01/10"
function avalDiaRuimRotulo(x) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(x.d);
  return avalUnidadeNome(x.u) + ', ' + (m ? AVAL_DIAS_SEMANA[new Date(+m[1], +m[2] - 1, +m[3]).getDay()] + ' ' + m[3] + '/' + m[2] : x.d);
}

// O aviso pronto. Sem dia ruim devolve '' (nem titulo). clicavel = false nas telas sem lista
// (periodo sem avaliacao): as linhas saem como texto.
function avalDiaRuimHtml(dias, clicavel) {
  if (!dias.length) return '';
  let i = 0;
  const blocos = dias.map(x => {
    const p = x.casos[0], iP = i++;
    const frase = avalEsc(avalDiaRuimRotulo(x)) + ': <b>' + avalEsc(p.c) + ' em ' + p.n + ' notas ruins</b> no mesmo dia ('
      + x.aval.toLocaleString('pt-BR') + (x.aval === 1 ? ' avaliação' : ' avaliações') + ' do dia)'
      + (p.de ? (p.de === p.ate ? ', pedidos às ' + p.de : ', pedidos das ' + p.de + ' às ' + p.ate) : '')
      + ', em ' + p.lojas + (p.lojas === 1 ? ' loja' : ' lojas') + '.';
    const outros = x.casos.slice(1).map(c => {
      const j = i++;
      return clicavel
        ? `<button class="preset-btn${avalMesmoDia(AVAL_DIA_SEL, c) ? ' active' : ''}" id="avalDR${j}" onclick="avalDiaFiltrar(${j})" title="${avalMesmoDia(AVAL_DIA_SEL, c) ? 'clique para voltar a ver todas as reclamações' : 'clique para ler estas reclamações na lista abaixo'}">${avalEsc(c.c)} em ${c.n}<span class="aval-dr-x"> ✕</span></button>`
        : `<span>${avalEsc(c.c)} em ${c.n}</span>`;
    });
    return (clicavel
      ? `<button class="aval-dr${avalMesmoDia(AVAL_DIA_SEL, p) ? ' aval-dr-sel' : ''}" id="avalDR${iP}" onclick="avalDiaFiltrar(${iP})" title="${avalMesmoDia(AVAL_DIA_SEL, p) ? 'clique para voltar a ver todas as reclamações' : 'clique para ler estas reclamações na lista abaixo'}">${frase}<span class="aval-dr-x"> ✕</span></button>`
      : `<div class="aval-dr">${frase}</div>`)
      + (outros.length ? `<div class="aval-dr-mais"><span>No mesmo dia também:</span>${outros.join(clicavel ? '' : '<span>·</span>')}</div>` : '');
  });
  const excecoes = Object.keys(AVAL_DIARUIM_MIN_UNIDADE).map(u => AVAL_DIARUIM_MIN_UNIDADE[u] + ' na ' + avalUnidadeNome(u));
  const regra = 'A mesma crítica em ' + AVAL_DIARUIM_MIN + ' ou mais notas ruins (1 a ' + NOTA_RUIM_ATE + ') em pedidos do mesmo dia, na mesma unidade'
    + (excecoes.length ? ' (' + excecoes.join(', ') + ', que recebe mais avaliações)' : '') + '.';
  return `<div class="contexto aval-dr-caixa" id="avalDiaRuim">
    <span title="${avalEsc(regra)}"><b>Dia ruim na cozinha</b> — pedidos dos últimos ${AVAL_DIARUIM_DIAS} dias</span>
    ${blocos.join('\n    ')}
    <div style="font-size:12px; color:var(--tx-3); margin-top:8px;">Vale olhar o turno, a expedição e a entrega. Ontem e hoje ainda estão sendo avaliados.${clicavel ? '' : ' Para ler as reclamações, escolha um período com avaliações.'}</div>${(clicavel && AVAL_DIA_SEL) ? `
    <div class="aval-dr-mais"><button class="preset-btn" onclick="avalDiaLer()">ler as reclamações ↓</button></div>` : ''}
  </div>
  `;
}

// Redesenha o modulo sem tirar de baixo do mouse o que foi clicado (mesmo cuidado de
// avalLojaFiltrar e avalNovasFiltrar): mede a borda do alvo, muda o estado, redesenha e rola a
// diferenca. Dentro do aviso nada muda de tamanho ao clicar; a medida cobre o resto da pagina.
function avalRedesenharParado(pegar, borda, mudar) {
  const antes = pegar();
  const ref = antes ? antes.getBoundingClientRect()[borda] : null;
  mudar();
  renderModuloAvaliacoes();
  const depois = pegar();
  if (ref === null || !depois) return;
  const alvo = document.getElementById('view-avaliacoes');
  const rolo = document.scrollingElement || document.documentElement;
  // pagina que encolheu pode nao deixar rolagem para chegar la: sobra espaco no fim
  const falta = (rolo.scrollTop + depois.getBoundingClientRect()[borda] - ref) - (rolo.scrollHeight - rolo.clientHeight);
  if (falta > 0) alvo.style.minHeight = Math.ceil(alvo.offsetHeight + falta + 2) + 'px';
  const d = depois.getBoundingClientRect()[borda] - ref;
  if (d) window.scrollBy({ top: d, behavior: 'instant' });
}

// Clicar num dia ruim: a lista de baixo mostra so as reclamacoes dele; clicar de novo solta.
// O caso ja diz a critica: a critica escolhida no grafico sai. A loja escolhida fica se for da
// mesma unidade (a lista mostra so as dela); de outra unidade, sai. "So as novas" continua valendo.
function avalDiaFiltrar(i) {
  const k = AVAL_LISTA_DIAS[i];
  if (!k) return;
  avalRedesenharParado(() => {
    const j = AVAL_LISTA_DIAS.findIndex(x => avalMesmoDia(x, k));
    return j < 0 ? null : document.getElementById('avalDR' + j);
  }, 'top', () => {
    if (avalMesmoDia(AVAL_DIA_SEL, k)) { AVAL_DIA_SEL = null; return; }
    AVAL_DIA_SEL = { u: k.u, d: k.d, c: k.c };
    AVAL_CRITICA_SEL = null;
    if (AVAL_LOJA_SEL !== null && avalUnidadeDaLoja(AVAL_LOJA_SEL) !== k.u) AVAL_LOJA_SEL = null;
  });
}

// O X do titulo da lista. Mede pela BASE do titulo, como avalNovasFiltrar: o que tem de ficar
// parado e a lista logo abaixo.
function avalDiaLimpar(ancora) {
  avalRedesenharParado(() => ancora ? document.getElementById(ancora) : null, 'bottom', () => { AVAL_DIA_SEL = null; });
}

function avalDiaLer() {
  const el = document.getElementById('avalReclamacoes');
  if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

// "RECLAMACOES PARA A COZINHA" (07/10/2026). Quadro de trabalho do dia, dentro do modulo: um texto
// por unidade, pronto para o dono copiar e mandar. O painel nao envia nada.
// O CORTE, num lugar so (avalCozBlocos): cada bloco e UM DIA DE CHEGADA — as reclamacoes que
// entraram no nosso banco naquele dia (visto_em, dia de Curitiba). Cada reclamacao tem uma
// chegada so, entao cai em um bloco so: nenhuma se perde, nenhuma se repete. De manha manda-se o
// bloco de ONTEM, que ja fechou; o de hoje ainda esta enchendo. Ficam AVAL_COZ_DIAS dias na tela,
// cada um com o seu Copiar (fim de semana sem ninguem abrir nao se perde).
// Reclamacao SEM hora de chegada (ja estava no banco quando a coluna nasceu) nao tem a chegada
// chutada: vai para um bloco pelo dia em que o cliente AVALIOU, e o titulo do bloco diz isso.
// Nao depende do periodo nem dos filtros de loja/critica do modulo; respeita o filtro geral de
// unidade/marca. So existe quando a view ja traz as horas (AVAL_CRIT_DATAS).
// O RELOGIO DO QUADRO E A HORA EM QUE AS RECLAMACOES FORAM LIDAS (AVAL_COZ_LIDO), nao a hora de
// agora: "hoje", "ontem" e "ate HH:MM" falam do que o painel leu. Painel que ficou aberto nao
// pode dizer "nenhuma para copiar hoje" com dado velho: se o dia virou desde a leitura, o quadro
// esconde os blocos e le de novo (avalCozVigia); no mesmo dia, le de novo ao abrir o quadro ou ao
// voltar para a aba quando a leitura tem mais de AVAL_COZ_RELER_MIN minutos.
// DIA SEM NENHUMA CHEGADA NA REDE INTEIRA (todas as unidades, sem filtro) nao e "dia sem
// reclamacao": o mais provavel e a leitura nao ter rodado. O bloco diz isso e manda conferir.
// O QUE ENTRA, num lugar so: nota ruim (1 a NOTA_RUIM_ATE) entra inteira; nota 4 ou 5 com
// critica marcada entra conforme AVAL_COZ_NOTA_BOA: 'resumida' (quem ESCREVEU comentario entra
// inteira, igual a nota ruim; quem so marcou a critica entra em uma linha), 'inteira' (todas
// inteiras) ou 'fora'. Medido em 07/10/2026 sobre 28 dias: sao 82 das 208 reclamacoes e so 25
// delas trazem comentario — e e no comentario que aparece o que a cozinha precisa ler (a batata
// frita crua de 04/10 no Ahu veio numa nota 4).
const AVAL_COZ_DIAS = 7;

const AVAL_COZ_NOTA_BOA = 'resumida';

const AVAL_COZ_COMENT_MAX = 300;       // o comentario vai inteiro: o maior medido tem 300 letras; acima disso corta numa palavra

const AVAL_COZ_OLHAR_MIN = 2;          // "O que olhar hoje": a mesma critica em 2 clientes ou mais da unidade

const AVAL_COZ_OLHAR_MAX = 3;          // no maximo 3 criticas nessa linha

const AVAL_COZ_RELER_MIN = 10;         // leitura com mais de 10 minutos: le de novo ao abrir o quadro ou ao voltar para a aba

const AVAL_COZ_ESPERA_MS = 1500;       // quanto o Copiar espera o navegador responder antes de tentar o jeito antigo

// Abrir e fechar: o estado so muda no CLIQUE da pessoa no titulo (onclick, antes de o navegador
// abrir ou fechar). Nao usar ontoggle: ele tambem dispara quando a tela e redesenhada com um bloco
// ja aberto, e o bloco aberto por padrao ficaria marcado como escolha da pessoa.
let AVAL_COZ_ABERTO = false;                 // o quadro abre recolhido

const AVAL_COZ_BLOCO_ABERTO = new Map();     // bloco -> aberto? (o que a pessoa abriu ou fechou nesta visita)

const AVAL_COZ_COPIADO = new Map();          // botao -> { hm, texto }: o que ja foi copiado nesta visita

let AVAL_COZ_LIDO = null;                    // quando as reclamacoes foram lidas do banco (ms; gravado por carregarCriticasAval)

let AVAL_COZ_RELENDO = false;                // tem uma releitura em andamento

let AVAL_COZ_RELER_TENTOU = 0;               // quando foi a ultima tentativa de reler (ms)

let AVAL_COZ_RELER_FALHOU = false;           // a ultima tentativa nao conseguiu

// { hoje: 'AAAA-MM-DD', hm: 'HH:MM' } no horario de Curitiba; null = o navegador nao soube escrever.
function avalCozAgora(ms) {
  const s = new Date(ms === undefined ? Date.now() : ms).toLocaleString('sv-SE', { timeZone: 'America/Sao_Paulo' });
  return /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(s) ? { hoje: s.slice(0, 10), hm: s.slice(11, 16) } : null;
}

function avalCozDiaMais(iso, n) {
  const d = new Date(iso + 'T12:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

// 'AAAA-MM-DD...' -> { dia: '06/10', sem: 'terça' }
function avalCozDia(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso || '');
  return m ? { dia: m[3] + '/' + m[2], sem: AVAL_DIAS_SEMANA[new Date(+m[1], +m[2] - 1, +m[3]).getDay()] } : { dia: String(iso || ''), sem: '' };
}

const avalCozCmp = (a, b) => (a < b ? -1 : a > b ? 1 : 0);

const avalCozPlural = (n) => n + (n === 1 ? ' reclamação' : ' reclamações');

// Nome de item e de critica numa linha so (quebra de linha e tab viram um espaco).
const avalCozLinha = (s) => String(s == null ? '' : s).split(/\s+/).filter(Boolean).join(' ');

// Comentario numa linha so; passou do tamanho, corta no fim de uma palavra e poe reticencias.
function avalCozCorta(s, max) {
  const t = String(s == null ? '' : s).split(/\s+/).filter(Boolean).join(' ');
  const c = Array.from(t);
  if (c.length <= max) return t;
  let r = c.slice(0, max);
  const i = r.lastIndexOf(' ');
  if (i >= max * 0.6) r = r.slice(0, i);
  return r.join('').replace(/[ .,;:!?-]+$/, '') + '…';
}

// "domingo 04/10 às 15:32 (café da tarde)" — a hora e o turno do PEDIDO (avalTurno, a regra do painel)
function avalCozQuando(r) {
  const p = avalDataHora(r[8] || r[1]);
  if (!p) return '';
  const turno = p.h === null ? '' : avalTurno(p.h);
  return avalCozDia(r[8] || r[1]).sem + ' ' + p.dia + (p.hora ? ' às ' + p.hora : '') + (turno ? ' (' + turno + ')' : '');
}

// O TEXTO de uma unidade num bloco. Texto puro: nenhum sinal que o WhatsApp leia como negrito,
// lista ou citacao; nenhum dado do cliente alem do que ele escreveu. linhas = linhas de
// AVAL_CRITICAS da unidade naquele bloco; acendeu = os dias ruins que ACENDERAM neste bloco
// (avalCozAcendeu). Bloco que ja fechou tem texto fixo: nada aqui depende do dia de hoje.
function avalCozTexto(u, rotulo, linhas, acendeu) {
  const out = [avalUnidadeNome(u) + ' — reclamações do iFood'];
  if (!linhas.length) { out.push(rotulo + ': nenhuma reclamação.'); return out.join('\n'); }
  const ruins = linhas.filter(notaRuim);
  out.push(rotulo + ': ' + avalCozPlural(linhas.length) + (ruins.length === linhas.length ? ''
    : !ruins.length ? ', nenhuma com nota de 1 a ' + NOTA_RUIM_ATE : ', ' + ruins.length + ' com nota de 1 a ' + NOTA_RUIM_ATE));
  const ordem = (a, b) => a[2] - b[2] || avalCozCmp(a[8] || a[1], b[8] || b[1]) || avalCozCmp(a[6], b[6]) || avalCozCmp(a[4] || '', b[4] || '');
  const escreveu = (r) => avalCozCorta(r[4], AVAL_COZ_COMENT_MAX) !== '';
  const criticas = (r) => r[3].map(avalCozLinha).filter(Boolean);
  const inteiras = AVAL_COZ_NOTA_BOA === 'inteira' ? linhas : linhas.filter(r => notaRuim(r) || (AVAL_COZ_NOTA_BOA === 'resumida' && escreveu(r)));
  const resumidas = AVAL_COZ_NOTA_BOA === 'resumida' ? linhas.filter(r => !notaRuim(r) && !escreveu(r)) : [];
  // por loja; a loja com a nota mais baixa vem primeiro e, dentro dela, a nota mais baixa primeiro
  const lojas = new Map();
  inteiras.forEach(r => { if (!lojas.has(r[0])) lojas.set(r[0], []); lojas.get(r[0]).push(r); });
  const pior = (l) => Math.min(...lojas.get(l).map(r => r[2]));
  [...lojas.keys()].sort((a, b) => pior(a) - pior(b) || a - b).forEach(l => {
    out.push('', avalCozLinha(LOJAS[l]));
    lojas.get(l).sort(ordem).forEach(r => {
      out.push('• Nota ' + r[2] + ' — pedido de ' + avalCozQuando(r));
      const cr = criticas(r), it = r[7].map(avalCozLinha).filter(Boolean);
      if (cr.length) out.push('Criticou: ' + cr.join(', '));
      if (it.length) out.push('Pediu: ' + it.join('; '));
      const c = avalCozCorta(r[4], AVAL_COZ_COMENT_MAX);
      if (c) out.push('Cliente: “' + c + '”');
    });
  });
  if (resumidas.length) {
    out.push('', 'Nota 4 ou 5, só marcaram a crítica:');
    resumidas.sort((a, b) => a[2] - b[2] || a[0] - b[0] || ordem(a, b)).forEach(r => {
      out.push('• Nota ' + r[2] + ' — ' + avalCozLinha(LOJAS[r[0]]) + ', ' + avalCozQuando(r) + ': ' + criticas(r).join(', '));
    });
  }
  // "O que olhar hoje": so com repeticao (a mesma critica em AVAL_COZ_OLHAR_MIN clientes ou mais,
  // qualquer nota) ou com dia ruim na cozinha que acendeu neste bloco.
  const conta = new Map();
  linhas.forEach(r => new Set(criticas(r)).forEach(c => conta.set(c, (conta.get(c) || 0) + 1)));
  const rep = [...conta.entries()].filter(x => x[1] >= AVAL_COZ_OLHAR_MIN)
    .sort((a, b) => b[1] - a[1] || avalCozCmp(a[0], b[0])).slice(0, AVAL_COZ_OLHAR_MAX);
  const partes = [];
  if (rep.length) partes.push(rep.map(x => x[0] + ' (' + x[1] + ' clientes)').join(', ') + '.');
  acendeu.forEach(x => {
    const d = avalCozDia(x.d);
    partes.push((partes.length ? 'Dia ruim na cozinha' : 'dia ruim na cozinha') + ': ' + d.sem + ' ' + d.dia + ', '
      + x.casos.map(c => avalCozLinha(c.c) + ' em ' + c.n).join(', ') + ' notas ruins no mesmo dia.');
  });
  if (partes.length) out.push('', 'O que olhar hoje: ' + partes.join(' '));
  return out.join('\n');
}

// O "dia ruim na cozinha" dentro do texto. A regra e a do aviso do topo (avalDiasRuins): a mesma
// critica em AVAL_DIARUIM_MIN ou mais notas ruins (AVAL_DIARUIM_MIN_UNIDADE na unidade que tem
// limite proprio), em pedidos do mesmo dia, na mesma unidade, dentro do filtro geral. A diferenca
// e QUANDO se conta: aqui, so o que tinha chegado ate o dia do bloco — e o aviso entra UMA vez,
// no bloco em que chegou a reclamacao que completou o limite. Assim a cozinha nao recebe o mesmo
// aviso em tres manhas seguidas e o texto de um bloco que ja fechou nao muda depois.
// No bloco de hoje a conta e a mesma do aviso do topo (tudo o que chegou ate agora).
// Devolve [{ d (dia do pedido), casos: [{ c, n }] }], do dia mais recente para o mais antigo.
function avalCozAcendeu(u, d, tipo, ativas) {
  const min = AVAL_DIARUIM_MIN_UNIDADE[u] || AVAL_DIARUIM_MIN;
  const chegou = (r) => String(r[10] || r[9] || '').slice(0, 10);
  const g = new Map();
  AVAL_CRITICAS.forEach(r => {
    if (!notaRuim(r) || !ativas.has(r[0]) || avalUnidadeDaLoja(r[0]) !== u) return;
    const ch = chegou(r);
    if (!ch || ch > d) return;
    new Set(r[3]).forEach(c => {
      const k = r[1] + '|' + c;
      if (!g.has(k)) g.set(k, { d: r[1], c, ate: 0, aqui: 0, comHora: false });
      const x = g.get(k);
      x.ate++;
      if (ch === d) { x.aqui++; if (r[10]) x.comHora = true; }
    });
  });
  const dias = new Map();
  g.forEach(x => {
    // acendeu aqui = ja passa do limite e, sem as deste dia, nao passava. Na transicao (o mesmo dia
    // com bloco "chegaram" e bloco "avaliadas") o aviso fica no bloco "chegaram".
    if (x.ate < min || x.ate - x.aqui >= min || (x.comHora ? 'c' : 'a') !== tipo) return;
    if (!dias.has(x.d)) dias.set(x.d, { d: x.d, casos: [] });
    dias.get(x.d).casos.push({ c: x.c, n: x.ate });
  });
  const lista = [...dias.values()];
  lista.forEach(x => x.casos.sort((a, b) => b.n - a.n || avalCozCmp(a.c, b.c)));
  return lista.sort((a, b) => avalCozCmp(b.d, a.d));
}

// Os blocos, do mais novo para o mais antigo. null = o quadro nao aparece (sem criticas
// conferidas, sem as horas na view, ou relogio que o navegador nao soube escrever).
// "Hoje" e o dia em que as reclamacoes foram LIDAS (lido); virou = o dia de agora ja e outro.
// Cada bloco: { chave, tipo ('c' = chegaram, 'a' = avaliadas), d, hoje, semLeitura, titulo (na
//   tela), rotulo (no texto), n, unidades: [{ u, n, texto }] }.
function avalCozBlocos() {
  if (AVAL_CRITICAS === null || AVAL_CRITICAS_BATE !== true || !AVAL_CRIT_DATAS || AVAL_COZ_LIDO === null) return null;
  const ag = avalCozAgora(AVAL_COZ_LIDO), real = avalCozAgora();
  if (!ag || !real) return null;
  const ativas = activeLojas();
  const dias = [];
  for (let i = 0; i < AVAL_COZ_DIAS; i++) dias.push(avalCozDiaMais(ag.hoje, -i));
  // inicio = o primeiro dia com chegada marcada (antes dele ninguem sabe quando chegou);
  // ultima = a chegada mais recente, para a tela provar que a leitura esta em dia;
  // chegouNaRede = os dias em que chegou alguma coisa em QUALQUER unidade (sem filtro nenhum)
  let inicio = null, ultima = null;
  const chegouNaRede = new Set();
  AVAL_CRITICAS.forEach(r => {
    if (!r[10]) return;
    const v = String(r[10]);
    chegouNaRede.add(v.slice(0, 10));
    if (inicio === null || v.slice(0, 10) < inicio) inicio = v.slice(0, 10);
    if (ultima === null || v.slice(0, 16) > ultima) ultima = v.slice(0, 16);
  });
  const porBloco = new Map();
  AVAL_CRITICAS.forEach(r => {
    if (!ativas.has(r[0]) || (!notaRuim(r) && AVAL_COZ_NOTA_BOA === 'fora')) return;
    const k = r[10] ? 'c' + String(r[10]).slice(0, 10) : r[9] ? 'a' + String(r[9]).slice(0, 10) : null;
    if (k === null) return;
    if (!porBloco.has(k)) porBloco.set(k, []);
    porBloco.get(k).push(r);
  });
  const unidades = [...new Set([...ativas].map(avalUnidadeDaLoja).filter(u => u !== undefined))]
    .sort((a, b) => UNIDADES.indexOf(a) - UNIDADES.indexOf(b));
  const blocos = [];
  dias.forEach((d, i) => {
    [['c', inicio !== null && d >= inicio], ['a', false]].forEach(([tipo, sempre]) => {
      const linhas = porBloco.get(tipo + d) || [];
      if (!linhas.length && !sempre) return;
      const x = avalCozDia(d), quando = x.dia + ' (' + x.sem + ')';
      const hoje = tipo === 'c' && i === 0;
      const rotulo = tipo === 'a' ? 'Avaliadas pelo cliente em ' + quando
        : hoje ? 'Chegaram hoje, ' + quando + ', até ' + ag.hm : 'Chegaram em ' + quando;
      const titulo = tipo === 'a' ? 'Avaliadas em ' + quando + ', antes de o painel marcar a chegada'
        : hoje ? rotulo : i === 1 ? 'Chegaram ontem, ' + quando : rotulo;
      blocos.push({ chave: tipo + d, tipo, d, hoje, titulo, rotulo, n: linhas.length,
        semLeitura: tipo === 'c' && !hoje && !chegouNaRede.has(d),
        unidades: unidades.map(u => {
          const L = linhas.filter(r => avalUnidadeDaLoja(r[0]) === u);
          return { u, n: L.length, texto: avalCozTexto(u, rotulo, L, L.length ? avalCozAcendeu(u, d, tipo, ativas) : []) };
        }) });
    });
  });
  // as unidades que o filtro geral deixou de fora (o painel abre sem as lojas de outra gestao)
  const fora = UNIDADES.filter(u => !unidades.includes(u)).map(avalUnidadeNome);
  return { blocos, hoje: ag.hoje, ontem: dias[1], inicio, ultima, lido: ag, virou: real.hoje !== ag.hoje, fora };
}

// "Ahú e São Braz" / "Ahú, Boqueirão e São Braz"
const avalCozLista = (nomes) => (nomes.length <= 1 ? nomes.join('') : nomes.slice(0, -1).join(', ') + ' e ' + nomes[nomes.length - 1]);

// "Sem reclamação nesse dia: Ahú e São Braz." ('' quando toda unidade tem reclamacao)
function avalCozSem(b) {
  const nomes = b.unidades.filter(x => !x.n).map(x => avalUnidadeNome(x.u));
  return nomes.length ? 'Sem reclamação nesse dia: ' + avalCozLista(nomes) + '.' : '';
}

// O texto do "Copiar todas": os textos das unidades com reclamacao, um depois do outro, e a linha das sem.
function avalCozJuntar(textos, sem) {
  return textos.join('\n\n——————\n\n') + (sem ? '\n\n' + sem : '');
}

// O quadro pronto. '' = nada muda na tela (view sem as horas, ou nenhum bloco nos ultimos dias).
function avalCozHtml() {
  const q = avalCozBlocos();
  if (!q || !q.blocos.length) return '';
  const x = avalCozDia(q.hoje);
  const botaoLer = `<button class="preset-btn" id="avalCozAtualizar" onclick="avalCozReler()">Atualizar</button>`;
  if (q.virou) {
    // O painel ficou aberto de um dia para o outro: nada do que esta lido pode ser chamado de
    // "hoje" ou "ontem". Esconde os blocos e le de novo; se nao conseguir, manda recarregar.
    setTimeout(avalCozVigia, 0);
    const lendo = AVAL_COZ_RELENDO || !AVAL_COZ_RELER_FALHOU;
    return `<details class="aval-coz" id="avalCoz"${AVAL_COZ_ABERTO ? ' open' : ''}>
    <summary onclick="AVAL_COZ_ABERTO = !this.parentNode.open"><b>Reclamações para a cozinha</b> — <span id="avalCozResumo">${lendo ? 'atualizando…' : 'não consegui atualizar: recarregue a página'}</span></summary>
    <div class="aval-coz-cab"><span id="avalCozLido">O painel ficou aberto de um dia para o outro: o que estava aqui foi lido em ${x.dia} às ${q.lido.hm}. ${lendo ? 'Lendo de novo…' : 'Não consegui ler de novo. Recarregue a página antes de copiar.'}</span>${botaoLer}</div>
  </details>
  `;
  }
  const bOntem = q.blocos.find(b => b.tipo === 'c' && b.d === q.ontem) || null;
  const bHoje = q.blocos.find(b => b.hoje) || null;
  const nHoje = bHoje ? bHoje.n : 0;
  const jaHoje = nHoje ? nHoje + (nHoje === 1 ? ' já chegou hoje' : ' já chegaram hoje') + ' até ' + q.lido.hm : '';
  const resumo = !bOntem ? (nHoje ? nHoje + (nHoje === 1 ? ' chegou hoje' : ' chegaram hoje') + ' até ' + q.lido.hm : 'últimos ' + AVAL_COZ_DIAS + ' dias')
    : bOntem.semLeitura ? 'ontem não chegou nada: confira a leitura' + (jaHoje ? ' · ' + jaHoje : '')
    : bOntem.n ? bOntem.n + ' para copiar hoje' + (jaHoje ? ' · ' + jaHoje : '')
    : jaHoje ? 'nenhuma de ontem · ' + jaHoje + ': veja o bloco de hoje' : 'nenhuma para copiar hoje';
  // abre sozinho o bloco de ontem (o que se manda de manha); se ele esta vazio e ja chegou algo
  // hoje, o de hoje; sem nenhum dos dois, o primeiro que tiver reclamacao
  const padrao = ((bOntem && bOntem.n) ? bOntem : (bHoje && bHoje.n) ? bHoje : bOntem || q.blocos.find(b => b.n) || q.blocos[0]).chave;
  const rotuloBotao = (id, texto, parado) => {
    const c = AVAL_COZ_COPIADO.get(id);
    return (c && c.texto === texto) ? 'Copiado' + (c.hm ? ' às ' + c.hm : '') + ' ✓' : parado;
  };
  const ult = q.ultima ? avalDataHora(q.ultima) : null;
  const lido = AVAL_COZ_RELENDO ? 'Lendo de novo…'
    : (AVAL_COZ_RELER_FALHOU ? 'Não consegui ler de novo agora. O que está aqui foi lido às ' : 'Lido às ') + q.lido.hm + '.'
      + (ult ? ' Última chegada do iFood: ' + ult.dia + ' às ' + ult.hora + '.' : '');
  return `<details class="aval-coz" id="avalCoz"${AVAL_COZ_ABERTO ? ' open' : ''}>
    <summary onclick="AVAL_COZ_ABERTO = !this.parentNode.open; setTimeout(avalCozVigia, 0)"><b>Reclamações para a cozinha</b> — <span id="avalCozResumo">${resumo}</span></summary>
    <div class="aval-coz-nota">Cada bloco é o que chegou do iFood naquele dia; de manhã, mande o de ontem. Mostra sempre os últimos ${AVAL_COZ_DIAS} dias, qualquer que seja o período escolhido acima.${q.fora.length ? ' Fora do filtro de cima: ' + avalEsc(avalCozLista(q.fora)) + '.' : ''}</div>
    <div class="aval-coz-cab"><span id="avalCozLido">${lido}</span>${botaoLer}</div>
    ${q.blocos.map(b => {
      const aberto = AVAL_COZ_BLOCO_ABERTO.has(b.chave) ? AVAL_COZ_BLOCO_ABERTO.get(b.chave) : b.chave === padrao;
      const com = b.unidades.map(x => ({ x, i: UNIDADES.indexOf(x.u) })).filter(o => o.x.n);   // i = a unidade, nao a posicao: o botao e o mesmo com ou sem filtro
      const sem = avalCozSem(b);
      const idTodas = 'avalCozB_' + b.chave + '_todas';
      return `<details class="aval-coz-bloco" id="avalCozK_${b.chave}"${aberto ? ' open' : ''}>
      <summary onclick="AVAL_COZ_BLOCO_ABERTO.set('${b.chave}', !this.parentNode.open)">${avalEsc(b.titulo)}: ${b.semLeitura ? 'nada chegou — confira a leitura' : b.n ? avalCozPlural(b.n) : 'nenhuma reclamação'}</summary>
      ${!b.n ? `<div class="aval-coz-sem">${b.semLeitura ? 'Nesse dia não chegou nenhuma reclamação do iFood, em nenhuma unidade. Pode ser que a leitura não tenha rodado: confira em Sistema → Rotinas. Se foi isso, elas aparecem no bloco do dia seguinte.' : b.hoje ? 'Nenhuma reclamação chegou hoje até ' + q.lido.hm + '.' : 'Nenhuma reclamação chegou nesse dia.'}</div>` : `${b.unidades.length > 1 ? `<div class="aval-coz-cab"><span>Uma mensagem por unidade, ou todas de uma vez:</span><button class="preset-btn" id="${idTodas}" onclick="avalCozCopiar('${b.chave}', 'todas')">${rotuloBotao(idTodas, avalCozJuntar(com.map(o => o.x.texto), sem), 'Copiar todas')}</button></div>` : ''}
      ${com.map(o => {
        const id = 'avalCozB_' + b.chave + '_' + o.i;
        return `<div class="aval-coz-cab"><span><b>${avalEsc(avalUnidadeNome(o.x.u))}</b> — ${avalCozPlural(o.x.n)}</span><button class="preset-btn" id="${id}" onclick="avalCozCopiar('${b.chave}', ${o.i})">${rotuloBotao(id, o.x.texto, 'Copiar')}</button></div>
      <textarea class="aval-coz-txt" id="avalCozT_${b.chave}_${o.i}" readonly rows="${Math.min(Math.max(o.x.texto.split('\n').length + 1, 4), 14)}">${avalEsc(o.x.texto)}</textarea>`; }).join('\n      ')}
      ${sem ? `<div class="aval-coz-sem" id="avalCozS_${b.chave}">${avalEsc(sem)}</div>` : ''}`}
    </details>`; }).join('\n    ')}
  </details>
  `;
}

// Redesenha SO o quadro (o resto do modulo fica parado).
function avalCozRedesenhar() {
  const el = document.getElementById('avalCoz');
  if (!el) return;
  const t = document.createElement('template');
  t.innerHTML = avalCozHtml().trim();
  if (t.content.firstElementChild) el.replaceWith(t.content.firstElementChild);
}

// Le as avaliacoes e as reclamacoes de novo. Se a leitura falhar, fica tudo como estava (o resto
// do modulo nao perde nada) e o quadro avisa. Se nada mudou, so o quadro e redesenhado.
async function avalCozReler() {
  if (AVAL_COZ_RELENDO) return;
  AVAL_COZ_RELENDO = true;
  AVAL_COZ_RELER_FALHOU = false;
  AVAL_COZ_RELER_TENTOU = Date.now();
  avalCozRedesenhar();
  const antes = [AVALIACOES, AVAL_CRITICAS, AVAL_CRIT_DATAS, AVAL_CRITICAS_BATE, AVAL_COZ_LIDO];
  let ok = false;
  try {
    await entrarAvaliacoesSoDados();
    await carregarCriticasAval();
    AVAL_CRITICAS_BATE = null;
    await conferirCriticasAval();
    ok = AVAL_CRITICAS !== null && AVAL_CRIT_DATAS && AVAL_CRITICAS_BATE === true;
  } catch (e) {
    ok = false;
  }
  if (!ok) {
    [AVALIACOES, AVAL_CRITICAS, AVAL_CRIT_DATAS, AVAL_CRITICAS_BATE, AVAL_COZ_LIDO] = antes;
    AVAL_COZ_RELER_FALHOU = true;
  }
  AVAL_COZ_RELENDO = false;
  const mudou = ok && (JSON.stringify(antes[0]) !== JSON.stringify(AVALIACOES) || JSON.stringify(antes[1]) !== JSON.stringify(AVAL_CRITICAS));
  if (mudou && MODULO_ATUAL === 'avaliacoes') renderModuloAvaliacoes();
  else avalCozRedesenhar();
}

// Vigia a idade da leitura. Roda sozinha de minuto em minuto (so para a virada do dia), ao voltar
// para a aba e ao abrir o quadro. Le de novo quando o dia virou desde a leitura ou — fora da
// ronda do minuto — quando a leitura tem mais de AVAL_COZ_RELER_MIN minutos. Depois de uma
// tentativa que falhou, espera um minuto antes da proxima.
function avalCozVigia(soVirada) {
  if (AVAL_COZ_RELENDO || AVAL_COZ_LIDO === null || !AVAL_CRIT_DATAS || document.hidden || !document.getElementById('avalCoz')) return;
  const agora = Date.now(), a = avalCozAgora(agora), l = avalCozAgora(AVAL_COZ_LIDO);
  if (!a || !l) return;
  const virou = a.hoje !== l.hoje;
  if (!virou && (soVirada === true || agora - AVAL_COZ_LIDO < AVAL_COZ_RELER_MIN * 60000)) return;
  if (AVAL_COZ_RELER_TENTOU && agora - AVAL_COZ_RELER_TENTOU < 60000) return;
  avalCozReler();
}

document.addEventListener('visibilitychange', () => avalCozVigia());

setInterval(() => avalCozVigia(true), 60000);

// Copiar: o que vai para a area de transferencia e EXATAMENTE o texto que esta na caixa da tela
// (qual = a unidade, pela posicao em UNIDADES, ou 'todas'). O botao confirma com a hora, sem alert(),
// e fica assim (e o lembrete de que aquela ja foi copiada nesta visita).
// Se o navegador recusar a copia direta — ou nao responder em AVAL_COZ_ESPERA_MS — tenta o jeito
// antigo (caixa escondida + copiar); se os dois falharem, o botao avisa e o texto da unidade fica
// selecionado para a pessoa copiar com o dedo.
function avalCozCopiar(chave, qual) {
  const bloco = document.getElementById('avalCozK_' + chave);
  const botao = document.getElementById('avalCozB_' + chave + '_' + qual);
  if (!bloco || !botao) return;
  const areas = qual === 'todas' ? [...bloco.querySelectorAll('textarea.aval-coz-txt')]
    : [document.getElementById('avalCozT_' + chave + '_' + qual)].filter(Boolean);
  if (!areas.length) return;
  const sem = qual === 'todas' ? document.getElementById('avalCozS_' + chave) : null;
  const texto = avalCozJuntar(areas.map(a => a.value), sem ? sem.textContent : '');
  const reserva = () => {
    const t = document.createElement('textarea');
    t.value = texto;
    t.setAttribute('readonly', '');
    t.style.cssText = 'position:fixed; top:0; left:0; width:1px; height:1px; opacity:0;';
    document.body.appendChild(t);
    t.focus();
    t.select();
    t.setSelectionRange(0, texto.length);
    let ok = false;
    try { ok = document.execCommand('copy') === true; } catch (e) { ok = false; }
    t.remove();
    return ok;
  };
  // true = o navegador copiou; false = recusou; null = nao respondeu a tempo
  const direto = new Promise(resolve => {
    let pedido;
    try { pedido = navigator.clipboard.writeText(texto); } catch (e) { resolve(false); return; }
    Promise.resolve(pedido).then(() => resolve(true), () => resolve(false));
    setTimeout(() => resolve(null), AVAL_COZ_ESPERA_MS);
  });
  direto.then(ok => ok === true || reserva()).then(ok => {
    const b = document.getElementById(botao.id) || botao;   // a tela pode ter sido redesenhada no meio
    if (ok) {
      const ag = avalCozAgora();
      AVAL_COZ_COPIADO.set(botao.id, { hm: ag ? ag.hm : '', texto });
      b.textContent = 'Copiado' + (ag ? ' às ' + ag.hm : '') + ' ✓';
      return;
    }
    AVAL_COZ_COPIADO.delete(botao.id);
    b.textContent = qual === 'todas' ? 'Não consegui copiar — copie unidade por unidade' : 'Não consegui copiar — o texto ficou selecionado';
    if (qual !== 'todas') { areas[0].focus(); areas[0].select(); }
  });
}

// modo: 1 = mais 20, 2 = todas, 0 = volta para 20
function avalReclVer(modo) {
  AVAL_RECL_N = modo === 2 ? 99999 : modo === 1 ? AVAL_RECL_N + 20 : 20;
  renderModuloAvaliacoes();
  const el = document.getElementById('avalReclamacoes');
  if (modo === 0 && el) el.scrollIntoView({ block: 'start' });
}

// O mesmo numero em toda tela: quantas criticas NAO tem a avaliacao delas entre as que esta
// tela conta (mesma loja, dia do pedido, id curto e nota). Enquanto sobrar alguma — e o caso
// de vw_avaliacoes ainda lendo a planilha — o bloco inteiro fica escondido.
function avalCriticasSemPar() {
  const tem = new Set(AVALIACOES.map(r => [r[0], r[1], r[5], r[2]].join('|')));
  return AVAL_CRITICAS.filter(r => !tem.has([r[0], r[1], r[6], r[2]].join('|'))).length;
}

async function conferirCriticasAval() {
  if (AVAL_CRITICAS === null || AVALIACOES === null || AVAL_CRITICAS_BATE !== null) return;
  let fora = avalCriticasSemPar();
  if (fora) {
    // Pode ser so o importador gravando entre uma leitura e a outra: le as duas de novo, uma vez.
    try { await entrarAvaliacoesSoDados(); await carregarCriticasAval(); } catch (e) { /* fica com o que tinha */ }
    fora = AVAL_CRITICAS === null ? 0 : avalCriticasSemPar();
  }
  AVAL_CRITICAS_BATE = AVAL_CRITICAS !== null && fora === 0;
  if (fora) console.warn('Criticas: ' + fora + ' sem a avaliacao correspondente nesta tela — o bloco fica escondido.');
}

let RELATORIOS = null;

async function entrarNegociacoes() {
  const alvo = document.getElementById('view-negociacoes');
  if (NEGOCIACOES === null) {
    alvo.innerHTML = '<div class="contexto">Carregando negociações...</div>';
    await entrarNegociacoesSoDados();
  }
  renderModuloNegociacoes();
}

function negociacoesFiltradas(iniAlt = null, fimAlt = null) {
  const dIni = iniAlt || fDataIni.value, dFim = fimAlt || fDataFim.value;
  const activeL = activeLojas();
  return NEGOCIACOES.filter(r => {
    if (!activeL.has(r[0])) return false;
    if (dIni && r[1] < dIni) return false;
    if (dFim && r[1] > dFim) return false;
    const ti = TURNOS.indexOf(r[2]);
    if (ti >= 0 && !selecionados.fTurno.has(ti)) return false; // turno desconhecido nao derruba a linha
    return true;
  });
}

function renderModuloNegociacoes() {
  const alvo = document.getElementById('view-negociacoes');
  const linhas = negociacoesFiltradas();

  if (!linhas.length) {
    alvo.innerHTML = `<div class="contexto" style="border-color:#c8102e;">
      Não há negociações no período selecionado. A base começa em <b>julho/2026</b>
      (o relatório de negociações do Portal de Redes é exportado por mês).</div>`;
    return;
  }

  const total = linhas.length;
  const respondiveis = linhas.filter(negRespondivel).length;
  const posEntrega = linhas.filter(negPosEntrega).length;
  const semResposta = linhas.filter(negSemResposta).length;
  const porAtraso = linhas.filter(r => (r[3] || '').includes('ATRASO')).length;
  const valorEnvolvido = linhas.reduce((s, r) => s + r[7], 0);
  const comSuper = linhas.filter(r => (r[6] || '').toUpperCase() === 'SIM').length;

  // Janela anterior do MESMO tamanho, para os selos dos cards e a coluna de
  // comparacao da tabela. Mesmo contrato do resto do painel: sem periodo
  // anterior com dados, aNeg fica null e a comparacao simplesmente nao
  // aparece — o painel nunca inventa base de comparacao.
  const antNeg = periodoAnterior();
  const linhasAnt = antNeg ? negociacoesFiltradas(antNeg.ini, antNeg.fim) : null;
  const aNeg = linhasAnt && linhasAnt.length ? {
    total: linhasAnt.length,
    respondiveis: linhasAnt.filter(negRespondivel).length,
    posEntrega: linhasAnt.filter(negPosEntrega).length,
    semResposta: linhasAnt.filter(negSemResposta).length,
    porAtrasoPct: linhasAnt.filter(r => (r[3] || '').includes('ATRASO')).length / linhasAnt.length * 100,
    valorEnvolvido: linhasAnt.reduce((s, r) => s + r[7], 0),
    comSuper: linhasAnt.filter(r => (r[6] || '').toUpperCase() === 'SIM').length,
  } : null;

  // por motivo
  const porMotivo = new Map();
  linhas.forEach(r => {
    const m = r[3] || 'SEM MOTIVO INFORMADO';
    if (!porMotivo.has(m)) porMotivo.set(m, { n: 0, valor: 0 });
    porMotivo.get(m).n++; porMotivo.get(m).valor += r[7];
  });
  const motivos = [...porMotivo.entries()].map(([m, o]) => ({ m, ...o })).sort((a, b) => b.n - a.n).slice(0, 8);
  NEG_LISTA_MOTIVOS = motivos.map(x => x.m);
  // Motivo escolhido que sumiu do periodo (a pessoa mexeu na data la em cima) nao
  // pode deixar a tabela vazia sem dizer por que: solta sozinho.
  if (NEG_MOTIVO && !NEG_LISTA_MOTIVOS.includes(NEG_MOTIVO)) NEG_MOTIVO = null;
  const motivoDe = (r) => r[3] || 'SEM MOTIVO INFORMADO';
  const linhasRec = NEG_MOTIVO ? linhas.filter(r => motivoDe(r) === NEG_MOTIVO) : linhas;
  const linhasAntRec = !linhasAnt ? null : (NEG_MOTIVO ? linhasAnt.filter(r => motivoDe(r) === NEG_MOTIVO) : linhasAnt);
  const totalRec = linhasRec.length;
  const respondiveisRec = linhasRec.filter(negRespondivel).length;
  const semRespostaRec = linhasRec.filter(negSemResposta).length;
  const valorRec = linhasRec.reduce((s, r) => s + r[7], 0);
  // Sem janela anterior NENHUMA nao ha comparacao; com janela anterior que existe e
  // nao tem este motivo, o zero e' um zero de verdade — a mesma regra que a coluna
  // por loja ja usa.
  const semRespostaAntRec = (linhasAnt && linhasAnt.length) ? (linhasAntRec || []).filter(negSemResposta).length : null;

  // por loja
  const agruparNegPorLoja = (ls) => {
    const mapa = new Map();
    ls.forEach(r => {
      if (!mapa.has(r[0])) mapa.set(r[0], { n: 0, resp: 0, sem: 0, valor: 0 });
      const o = mapa.get(r[0]);
      o.n++; if (negRespondivel(r)) o.resp++; if (negSemResposta(r)) o.sem++; o.valor += r[7];
    });
    return mapa;
  };
  const porLoja = agruparNegPorLoja(linhasRec);
  const porLojaAnt = linhasAntRec ? agruparNegPorLoja(linhasAntRec) : null;
  // Loja sem linha na janela anterior teve ZERO sem resposta la — e diferente de
  // "nao da para comparar" (que e quando nao existe janela anterior nenhuma).
  const lojas = [...porLoja.entries()].map(([i, o]) => ({ nome: LOJAS[i], ...o, pctSem: o.resp ? o.sem / o.resp * 100 : 0,
      semAnt: porLojaAnt ? (porLojaAnt.has(i) ? porLojaAnt.get(i).sem : 0) : null }))
    .sort((a, b) => b.sem - a.sem || b.n - a.n);

  alvo.innerHTML = `
  <div class="section-label" style="border-top:none; margin-top:0; padding-top:0;">Negociações pós-entrega</div>
  <div class="caption-label" style="text-align:center;">
    Quando o cliente reclama, o iFood pode abrir uma <b>negociação</b> para a loja responder (aceitar, recusar ou
    propor solução). <b>Nem toda reclamação vira negociação:</b> as de pós-entrega (item faltando, pedido impróprio,
    item errado) o iFood resolve direto com o cliente, sem ouvir a loja — por isso elas aparecem separadas aqui e
    <b>não contam</b> como "sem resposta". Filtros de período, unidade, marca e turno se aplicam; dia da semana não.
  </div>
  <div class="cards">
    <div class="card neutral"><div class="card-lbl">Negociações</div><div class="card-val">${total.toLocaleString('pt-BR')}</div><div class="card-pct">${respondiveis} para a loja responder</div>${selo(total, aNeg && aNeg.total, 'menorMelhor')}</div>
    <div class="card neutral"${cardFarol('neg_sem_resposta_pct', respondiveis ? semResposta/respondiveis*100 : null)}><div class="card-lbl">Sem resposta da loja</div><div class="card-val">${semResposta}</div><div class="card-pct">${pct(respondiveis ? semResposta/respondiveis*100 : 0)}% das que dependem da loja</div>${selo(semResposta, aNeg && aNeg.semResposta, 'menorMelhor')}</div>
    <div class="card neutral"><div class="card-lbl">Pós-entrega (iFood decide)</div><div class="card-val">${posEntrega}</div><div class="card-pct">a loja não é ouvida</div>${selo(posEntrega, aNeg && aNeg.posEntrega, 'menorMelhor')}</div>
    <div class="card neutral"${cardFarol('neg_atraso_pct', total ? porAtraso/total*100 : null)}><div class="card-lbl">Motivadas por atraso</div><div class="card-val">${pct(porAtraso/total*100)}%</div><div class="card-pct">${porAtraso} casos</div>${selo(total ? porAtraso/total*100 : 0, aNeg && aNeg.porAtrasoPct, 'menorMelhor')}</div>
    <div class="card neg"><div class="card-lbl">Valor cancelado nas negociações</div><div class="card-val">R$ ${fmt(valorEnvolvido)}</div>${selo(valorEnvolvido, aNeg && aNeg.valorEnvolvido, 'menorMelhor')}</div>
    <div class="card neutral"><div class="card-lbl">Com impacto no Super</div><div class="card-val">${comSuper}</div><div class="card-pct">afetam o selo da loja</div>${selo(comSuper, aNeg && aNeg.comSuper, 'menorMelhor')}</div>
  </div>

  <div class="chart-box" style="height:320px; margin-top:14px;">
    <div class="chart-title">Por que os clientes abrem negociação</div>
    <div class="chart-canvas-wrap"><canvas id="chartNegMotivos"></canvas></div>
  </div>
  <div class="caption-label" style="text-align:center;" title="A tabela de lojas passa a mostrar só as negociações daquele motivo, com a comparação no mesmo recorte. Clicar de novo na mesma barra solta. Os cards do topo continuam sendo o período inteiro.">Clique numa barra para ver esse motivo loja a loja.</div>

  <div class="section-label">Onde o silêncio custa caro</div>
  ${semResposta ? `<div class="contexto" style="border-color:var(--farol-fora);">
    <b>${semResposta}</b> negociaç${semResposta === 1 ? 'ão ficou' : 'ões ficaram'} sem resposta da loja no período —
    <b>R$ ${fmt(linhas.filter(negSemResposta).reduce((s, r) => s + r[7], 0))}</b> em cancelamentos.
    Responder no app é o que evita a perda.</div>` : ''}
  <div class="caption-label" style="text-align:center;">A coluna "Para responder" exclui as reclamações de pós-entrega, que o iFood decide sozinho — o "% sem resposta" é sobre ela, não sobre o total.</div>
  ${NEG_MOTIVO ? `<div class="contexto" style="border-color:var(--brand);">
    <b>Tabela recortada por motivo:</b>
    <button class="preset-btn active" onclick="negMotivoLimpar()">${NEG_MOTIVO} ✕</button>
    <div style="font-size:12px; color:var(--tx-3); margin-top:6px;" title="Os cards e o gráfico continuam sendo o período inteiro: o gráfico precisa mostrar todos os motivos para você poder trocar de escolha.">
      Só a tabela abaixo está neste recorte.
    </div>
  </div>` : ''}
  <div id="tabelaNegLojas">
    <table>
      <tr><th>Loja</th><th>Negociações</th><th>Para responder</th><th>Sem resposta</th><th>% sem resposta</th><th>Valor cancelado</th><th title="Compara o número de negociações sem resposta com a janela imediatamente anterior, do mesmo tamanho do período filtrado.">vs período anterior</th></tr>
      ${lojas.map(x => `<tr><td>${x.nome}</td><td>${x.n}</td><td>${x.resp}</td>
        <td${x.sem ? ' style="color:var(--farol-fora); font-weight:bold;"' : ''}>${x.sem}</td>
        <td>${pct(x.pctSem)}%</td><td>R$ ${fmt(x.valor)}</td>
        <td>${variacaoSpan(x.sem, x.semAnt, 'menorMelhor')}</td></tr>`).join('')}
      <tr class="liq"><td>TOTAL${NEG_MOTIVO ? ' DO RECORTE' : ''}</td><td>${totalRec.toLocaleString('pt-BR')}</td><td>${respondiveisRec}</td><td>${semRespostaRec}</td>
        <td>${pct(respondiveisRec ? semRespostaRec / respondiveisRec * 100 : 0)}%</td><td>R$ ${fmt(valorRec)}</td>
        <td>${variacaoSpan(semRespostaRec, semRespostaAntRec, 'menorMelhor')}</td></tr>
    </table>
  </div>`;

  destroyChart('chartNegMotivos');
  const rotulo = (t) => t.length > 46 ? t.slice(0, 44) + '…' : t;
  chartInstances['chartNegMotivos'] = new Chart(document.getElementById('chartNegMotivos').getContext('2d'), {
    type: 'bar',
    data: {
      labels: motivos.map(x => rotulo(x.m)),
      // Uma cor so: a identidade do motivo vem do rotulo do eixo. A barra escolhida
      // acende em --brand, o mesmo sinal do modulo Evolucao.
      datasets: [{ data: motivos.map(x => x.n), backgroundColor: motivos.map(x => NEG_MOTIVO === x.m ? corToken('--brand') : corToken('--info')), borderRadius: 4 }],
    },
    plugins: [pluginRotulosBarra(i => `${motivos[i].n} (R$ ${fmt(motivos[i].valor)})`)],
    options: {
      indexAxis: 'y', responsive: true, maintainAspectRatio: false,
      layout: { padding: { right: 8 } },
      onClick: (_e, els) => { if (els.length) negMotivoFiltrar(els[0].index); },
      onHover: (e, els) => { e.native.target.style.cursor = els.length ? 'pointer' : 'default'; },
      plugins: {
        legend: { display: false },
        tooltip: { callbacks: { label: (c) => `${motivos[c.dataIndex].n} negociações — R$ ${fmt(motivos[c.dataIndex].valor)} cancelados` } },
      },
      scales: {
        x: { beginAtZero: true, max: Math.max(...motivos.map(x => x.n)) * 1.3, title: { display: true, text: 'negociações' }, grid: { color: '#232321' } },
        y: { grid: { display: false }, ticks: { font: { size: 10 } } },
      },
    },
  });
}

async function entrarAvaliacoes() {
  const alvo = document.getElementById('view-avaliacoes');
  const lerCriticas = AVAL_CRITICAS === null && !AVAL_CRITICAS_TENTOU;
  if (AVALIACOES === null || lerCriticas) {
    if (AVALIACOES === null) alvo.innerHTML = '<div class="contexto">Carregando avaliações...</div>';
    await Promise.all([
      AVALIACOES === null ? entrarAvaliacoesSoDados() : null,
      lerCriticas ? carregarCriticasAval() : null,
    ]);
  }
  await conferirCriticasAval();
  renderModuloAvaliacoes();
  avalCozVigia();
}

function avaliacoesFiltradas(iniAlt = null, fimAlt = null) {
  const dIni = iniAlt || fDataIni.value, dFim = fimAlt || fDataFim.value;
  const activeL = activeLojas();
  return AVALIACOES.filter(r =>
    activeL.has(r[0]) && (!dIni || r[1] >= dIni) && (!dFim || r[1] <= dFim));
}

function renderModuloAvaliacoes() {
  const alvo = document.getElementById('view-avaliacoes');
  alvo.style.minHeight = '';   // folga que o clique na loja pode ter deixado (ver avalLojaFiltrar)
  const linhasTodas = avaliacoesFiltradas();
  // A loja escolhida so solta sozinha quando SAI do filtro geral (unidade/marca). Se ela so
  // ficou sem avaliacao no periodo, a escolha fica e a tela diz isso — nunca mostra a rede
  // no lugar da loja sem avisar.
  if (AVAL_LOJA_SEL !== null && !activeLojas().has(AVAL_LOJA_SEL)) AVAL_LOJA_SEL = null;
  const LOJA = AVAL_LOJA_SEL;
  // Dia ruim na cozinha (ver avalDiasRuins): nao depende do periodo. O caso escolhido solta
  // sozinho quando some do aviso, quando ha critica escolhida no grafico ou loja de outra unidade,
  // e nas duas telas "sem avaliacao no periodo" (ali nao ha lista: o aviso vira texto).
  const diasRuins = avalDiasRuins();
  AVAL_LISTA_DIAS = diasRuins.flatMap(x => x.casos);
  if (AVAL_DIA_SEL && (!AVAL_LISTA_DIAS.some(c => avalMesmoDia(c, AVAL_DIA_SEL)) || AVAL_CRITICA_SEL
    || (LOJA !== null && avalUnidadeDaLoja(LOJA) !== AVAL_DIA_SEL.u))) AVAL_DIA_SEL = null;
  const DIA = AVAL_DIA_SEL;
  const linhas = LOJA === null ? linhasTodas : linhasTodas.filter(r => r[0] === LOJA);
  if (LOJA !== null && !linhas.length) {
    AVAL_DIA_SEL = null;
    alvo.innerHTML = avalDiaRuimHtml(diasRuins, false) + avalCozHtml() + `<div class="contexto" style="border-color:var(--brand);">
      <b>Filtrando:</b>
      <button class="preset-btn active" onclick="avalLojaLimpar()">loja ${String(LOJAS[LOJA]).replace(/&/g, '&amp;').replace(/</g, '&lt;')} ✕</button>
      <div style="margin-top:6px;">Esta loja não tem avaliação no período selecionado. Troque o período ou clique no ✕ para ver todas as lojas.</div>
    </div>`;
    return;
  }

  if (!linhas.length) {
    AVAL_DIA_SEL = null;
    alvo.innerHTML = avalDiaRuimHtml(diasRuins, false) + avalCozHtml() + `<div class="contexto" style="border-color:#c8102e;">
      Não há avaliações no período selecionado. A base começa em <b>24/06/2026</b>.</div>`;
    return;
  }

  const total = linhas.length;
  const media = linhas.reduce((s, r) => s + r[2], 0) / total;
  const dist = [1, 2, 3, 4, 5].map(n => linhas.filter(r => r[2] === n).length);
  const ruinsSel = notasRuins(linhas);   // notas 1 a 3 do que a tela mostra (rede ou loja escolhida)
  const pctRuins = ruinsSel.pct;
  const pctCinco = dist[4] / total * 100;
  // A linha TODAS da tabela por loja e sempre o total do filtro geral, com ou sem loja escolhida.
  const totalT = linhasTodas.length;
  const mediaT = linhasTodas.reduce((s, r) => s + r[2], 0) / totalT;
  const ruinsT = notasRuins(linhasTodas);

  // Janela anterior do MESMO tamanho, para os selos dos cards e a coluna de
  // comparacao da tabela por loja. Sem periodo anterior com dados a comparacao
  // some — o painel nao inventa base de comparacao.
  const antAv = periodoAnterior();
  const linhasAnt = antAv ? avaliacoesFiltradas(antAv.ini, antAv.fim) : null;
  const resumoAnt = (ls) => ls && ls.length ? {
    total: ls.length,
    media: ls.reduce((s, r) => s + r[2], 0) / ls.length,
    pctRuins: notasRuins(ls).pct,
    pctCinco: ls.filter(r => r[2] === 5).length / ls.length * 100,
  } : null;
  const aAvT = resumoAnt(linhasAnt);
  const aAv = LOJA === null ? aAvT : resumoAnt(linhasAnt && linhasAnt.filter(r => r[0] === LOJA));
  // Media simples por loja na janela anterior (nunca mediana), para a coluna da tabela.
  const mediaAntPorLoja = new Map();
  if (linhasAnt) {
    const agr = new Map();
    linhasAnt.forEach(r => {
      if (!agr.has(r[0])) agr.set(r[0], { n: 0, soma: 0 });
      const o = agr.get(r[0]); o.n++; o.soma += r[2];
    });
    agr.forEach((o, i) => mediaAntPorLoja.set(i, o.soma / o.n));
  }

  const porTag = new Map();
  linhas.forEach(r => r[3].forEach(t => porTag.set(t, (porTag.get(t) || 0) + 1)));
  const tags = [...porTag.entries()].map(([t, n]) => ({ t, n })).sort((a, b) => b.n - a.n).slice(0, 8);

  const porLoja = new Map();
  linhasTodas.forEach(r => {
    if (!porLoja.has(r[0])) porLoja.set(r[0], { n: 0, soma: 0, ruins: 0 });
    const o = porLoja.get(r[0]);
    o.n++; o.soma += r[2]; if (notaRuim(r)) o.ruins++;
  });
  const lojas = [...porLoja.entries()]
    .map(([i, o]) => ({ idx: i, nome: LOJAS[i], n: o.n, media: o.soma / o.n, ruins: o.ruins, pctRuins: o.ruins / o.n * 100,
      mediaAnt: mediaAntPorLoja.has(i) ? mediaAntPorLoja.get(i) : null }))
    .sort((a, b) => a.media - b.media);
  AVAL_LISTA_LOJAS = lojas.map(x => x.idx);

  // ---- O que mais criticam (vw_avaliacoes_criticas). Sem a view, tudo aqui fica vazio e a
  // lista de reclamacoes sai como sempre saiu.
  const esc = (s) => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  const temCriticas = AVAL_CRITICAS !== null && AVAL_CRITICAS_BATE === true;
  const lojasCrit = activeLojas();
  const critLinhasTodas = (temCriticas ? AVAL_CRITICAS : []).filter(r => lojasCrit.has(r[0])
    && (!fDataIni.value || r[1] >= fDataIni.value) && (!fDataFim.value || r[1] <= fDataFim.value));
  const critLinhas = LOJA === null ? critLinhasTodas : critLinhasTodas.filter(r => r[0] === LOJA);
  const porCritica = new Map();
  critLinhas.forEach(r => r[3].forEach(c => porCritica.set(c, (porCritica.get(c) || 0) + 1)));
  const criticas = [...porCritica.entries()].map(([c, n]) => ({ c, n }))
    .sort((a, b) => b.n - a.n || a.c.localeCompare(b.c));
  AVAL_LISTA_CRITICAS = criticas.map(x => x.c);
  if (AVAL_CRITICA_SEL && !AVAL_LISTA_CRITICAS.includes(AVAL_CRITICA_SEL)) AVAL_CRITICA_SEL = null;
  const comCritica = critLinhas.filter(r => r[3].length).length;
  const aguardando = critLinhas.filter(r => r[5]).length;
  // Liga cada reclamacao da lista de sempre a linha dela na view nova (mesma loja, dia, id
  // curto, nota e texto) para mostrar as criticas marcadas, o "aguardando resposta" e o que o
  // cliente pediu.
  // Reclamacao sem linha la (so a planilha antiga tem) fica com criticas = null: nao se sabe.
  const chaveAv = (r, curto) => [r[0], r[1], curto, r[2], r[4] || ''].join('|');
  const critPorChave = new Map(critLinhas.map(r => [chaveAv(r, r[6]), r]));
  // comDatas = a view ja traz a hora do pedido, a da avaliacao e a de entrada (visto_em). Sem
  // isso a lista sai como sempre saiu: so o dia do pedido, na ordem do pedido, sem "novas".
  const comDatas = temCriticas && AVAL_CRIT_DATAS;
  if (!comDatas) AVAL_SO_NOVAS = false;
  const corteNovas = comDatas ? avalCorteNovas() : null;
  const ehNova = (visto) => !!(visto && corteNovas && String(visto).slice(0, 19) >= corteNovas);
  const diaLinhas = DIA ? AVAL_CRITICAS.filter(r => r[1] === DIA.d && notaRuim(r) && r[3].includes(DIA.c) && lojasCrit.has(r[0])
    && avalUnidadeDaLoja(r[0]) === DIA.u && (LOJA === null || r[0] === LOJA))
    .map(r => r[4] ? r : Object.assign(r.slice(), { 4: '(sem comentário)' })) : null;
  const reclTodas = (diaLinhas || AVAL_CRITICA_SEL)
    ? (diaLinhas || critLinhas.filter(r => r[4] && r[3].includes(AVAL_CRITICA_SEL)))
        .map(r => ({ loja: r[0], data: r[1], nota: r[2], txt: r[4], criticas: r[3], aguarda: r[5], itens: r[7], ped: r[8], aval: r[9], nova: ehNova(r[10]) }))
    : linhas.filter(r => notaRuim(r) && r[4]).map(r => {
        const k = critPorChave.get(chaveAv(r, r[5]));
        return { loja: r[0], data: r[1], nota: r[2], txt: r[4], criticas: k ? k[3] : null, aguarda: k ? k[5] : false, itens: k ? k[7] : [],
          ped: k ? k[8] : null, aval: k ? k[9] : null, nova: k ? ehNova(k[10]) : false };
      });
  // "Novas desde ontem" conta na lista que a tela mostraria (periodo, filtro geral, loja e
  // critica): o numero da linha do topo e o da lista filtrada sao sempre o mesmo.
  const nNovas = reclTodas.filter(x => x.nova).length;
  const reclamacoes = AVAL_SO_NOVAS ? reclTodas.filter(x => x.nova) : reclTodas;
  if (comDatas) {
    const o = AVAL_RECL_ORD;
    const valor = { ped: x => x.ped || x.data, aval: x => x.aval || '', nota: x => x.nota }[o.col];
    reclamacoes.sort((a, b) => {
      if (o.col === 'loja') return String(LOJAS[a.loja]).localeCompare(String(LOJAS[b.loja]), 'pt-BR') * o.dir;   // A a Z como se le, com acento
      const va = valor(a), vb = valor(b);
      if (va === '' && vb !== '') return 1;    // sem hora da avaliacao: sempre no fim
      if (vb === '' && va !== '') return -1;
      return (va < vb ? -1 : va > vb ? 1 : 0) * o.dir;
    });
  }
  const novasTxt = (n) => (n ? n.toLocaleString('pt-BR') + ' ' : '') + (AVAL_CRITICA_SEL
    ? (n === 0 ? 'Nenhum comentário novo' : n === 1 ? 'comentário novo' : 'comentários novos')
    : (n === 0 ? 'Nenhuma reclamação nova' : n === 1 ? 'reclamação nova' : 'reclamações novas'))
    + ' desde ontem' + (DIA ? ' neste dia ruim' : AVAL_CRITICA_SEL ? ' com esta crítica' : '');
  const novasLinha = (comDatas && (nNovas || AVAL_SO_NOVAS)) ? `<div id="avalNovas" style="text-align:center; margin:10px 0 2px;"><button class="preset-btn${AVAL_SO_NOVAS ? ' active' : ''}" onclick="avalNovasFiltrar('avalNovas')" title="${AVAL_SO_NOVAS ? 'clique para voltar a ver todas' : 'chegaram ao painel nas últimas 24 horas — clique para a lista mostrar só elas'}">${novasTxt(nNovas)}${AVAL_SO_NOVAS ? ' ✕' : ''}</button></div>
  ` : '';
  // A lista abre com as 20 primeiras; "Ver mais" e "Ver todas" abrem o resto. Trocar periodo,
  // filtro geral, loja, critica, "so as novas" ou a ordem volta para 20.
  const chaveRecl = [fDataIni.value, fDataFim.value, [...lojasCrit].join(','), LOJA, AVAL_CRITICA_SEL, AVAL_SO_NOVAS, DIA ? DIA.u + DIA.d + DIA.c : ''].join('|');
  if (chaveRecl !== AVAL_RECL_CHAVE) { AVAL_RECL_CHAVE = chaveRecl; AVAL_RECL_N = 20; }
  const comentarios = reclamacoes.slice(0, AVAL_RECL_N);
  // Onde a critica escolhida mais aparece: o "Avaliações" e o MESMO numero da tabela por loja.
  // Conta em todas as lojas do filtro geral, mesmo com uma loja escolhida.
  const critPorLoja = new Map();
  if (AVAL_CRITICA_SEL) critLinhasTodas.forEach(r => {
    if (r[3].includes(AVAL_CRITICA_SEL)) critPorLoja.set(r[0], (critPorLoja.get(r[0]) || 0) + 1);
  });
  const lojasDaCritica = [...critPorLoja.entries()]
    .map(([i, n]) => ({ idx: i, nome: LOJAS[i], n, aval: porLoja.has(i) ? porLoja.get(i).n : null }))
    .sort((a, b) => b.n - a.n || String(a.nome).localeCompare(String(b.nome)));
  AVAL_LISTA_LOJAS_CRIT = lojasDaCritica.map(x => x.idx);

  alvo.innerHTML = `
  <div class="section-label" style="border-top:none; margin-top:0; padding-top:0;">O que os clientes estão dizendo</div>
  <div class="caption-label" style="text-align:center;">
    Avaliações deixadas no app após a entrega, incluindo as que ainda aguardam resposta da loja (as descartadas pelo iFood ficam fora). Os últimos 7 dias ainda recebem avaliações. Filtros de período, unidade e marca se aplicam; dia da semana e turno não.
  </div>
  ${avalDiaRuimHtml(diasRuins, true)}${avalCozHtml()}${novasLinha}${LOJA !== null ? `<div class="contexto" style="border-color:var(--brand);">
    <b>Filtrando:</b>
    <button class="preset-btn active" onclick="avalLojaLimpar()">loja ${esc(LOJAS[LOJA])} ✕</button>
    ${AVAL_CRITICA_SEL ? `<button class="preset-btn active" onclick="avalCriticaLimpar()">crítica ${esc(AVAL_CRITICA_SEL)} ✕</button>
    <button class="preset-btn" onclick="avalLimparFiltros()">limpar</button>` : ''}
    <div style="font-size:12px; color:var(--tx-3); margin-top:6px;">Os cards, os gráficos e as reclamações são só desta loja. A tabela por loja continua com todas, para você trocar.</div>
  </div>` : ''}
  <div class="cards">
    <div class="card neutral"${cardFarol('nota_media', media)}><div class="card-lbl">Nota média</div><div class="card-val">${media.toFixed(2).replace('.', ',')} ★</div>${selo(media, aAv && aAv.media)}</div>
    <div class="card neutral"><div class="card-lbl">Avaliações</div><div class="card-val">${total.toLocaleString('pt-BR')}</div>${selo(total, aAv && aAv.total, 'neutro')}</div>
    <div class="card pos"><div class="card-lbl">Nota 5</div><div class="card-val">${pct(pctCinco)}%</div>${selo(pctCinco, aAv && aAv.pctCinco)}</div>
    <div class="card neutral"${cardFarol('pct_notas_ruins', pctRuins)}><div class="card-lbl">Notas 1 a ${NOTA_RUIM_ATE}</div><div class="card-val">${pct(pctRuins)}%</div><div class="card-pct">${ruinsSel.n.toLocaleString('pt-BR')} ${ruinsSel.n === 1 ? 'cliente insatisfeito' : 'clientes insatisfeitos'}</div>${selo(pctRuins, aAv && aAv.pctRuins, 'menorMelhor')}</div>
  </div>

  <div style="display:flex; flex-wrap:wrap; gap:14px; align-items:stretch; margin-top:14px;">
    <div class="chart-box" style="flex:1 1 320px; height:280px;">
      <div class="chart-title">Distribuição das notas</div>
      <div class="chart-canvas-wrap"><canvas id="chartNotas"></canvas></div>
    </div>
    <div class="chart-box" style="flex:1 1 320px; height:280px;">
      <div class="chart-title">O que mais elogiam (tags marcadas)</div>
      ${tags.length ? `<div class="chart-canvas-wrap"><canvas id="chartTags"></canvas></div>` : `<div class="caption-label" style="text-align:center; margin-top:90px;">Nenhum elogio marcado no período.</div>`}
    </div>
    ${criticas.length ? `<div class="chart-box" style="flex:1 1 320px; height:280px;">
      <div class="chart-title">O que mais criticam (${comCritica} avaliações)</div>
      <div class="chart-canvas-wrap"><canvas id="chartCriticas"></canvas></div>
    </div>` : ''}
  </div>
  ${criticas.length ? `<div class="caption-label" style="text-align:center;">Clique numa crítica para ler os comentários e ver em que loja ela mais aparece.</div>` : ''}

  <div class="section-label">Nota por loja — piores primeiro</div>
  <div id="tabelaAvalLojas">
    <table>
      <tr><th>Loja</th><th>Avaliações</th><th>Nota média</th><th title="Quantas avaliações com nota de 1 a ${NOTA_RUIM_ATE} a loja recebeu no período.">Notas 1 a ${NOTA_RUIM_ATE}</th><th title="As notas de 1 a ${NOTA_RUIM_ATE} divididas por todas as avaliações da loja no período.">% notas 1 a ${NOTA_RUIM_ATE}</th><th title="Compara a nota média da loja com a janela imediatamente anterior, do mesmo tamanho do período filtrado.">vs período anterior</th></tr>
      ${lojas.map((x, i) => `<tr class="aval-clic${x.idx === LOJA ? ' aval-sel' : ''}" onclick="avalLojaFiltrar(${i})" title="${x.idx === LOJA ? 'clique para voltar a todas as lojas' : 'clique para a tela mostrar só esta loja'}"><td>${x.nome}${x.idx === LOJA ? ' ✕' : ''}</td><td>${x.n}</td>
        <td${(() => { const k = (METAS_KPI || []).find(m => m.chave === 'nota_media'); if (!k) return ''; const f = farolKpi(k, x.media); const cor = (f[1] === 'fora' || f[1] === 'perto') ? ' style="color:' + f[0] + '; font-weight:bold;"' : ''; return cor + ' title="Meta da nota: ' + fmtMeta(k) + ' — ' + f[1] + '"'; })()}>${x.media.toFixed(2).replace('.', ',')}</td>
        <td>${x.ruins}</td><td>${pct(x.pctRuins)}%</td>
        <td>${variacaoSpan(x.media, x.mediaAnt)}</td></tr>`).join('')}
      <tr class="liq"><td>TODAS</td><td>${totalT.toLocaleString('pt-BR')}</td>
        <td>${mediaT.toFixed(2).replace('.', ',')}</td><td>${ruinsT.n.toLocaleString('pt-BR')}</td><td>${pct(ruinsT.pct)}%</td>
        <td>${variacaoSpan(mediaT, aAvT && aAvT.media)}</td></tr>
    </table>
  </div>
  <div class="caption-label">Lojas com poucas avaliações oscilam muito — dê mais peso às que têm 30 ou mais. <b>Clique numa loja para a tela mostrar só ela.</b></div>

  ${(comentarios.length || AVAL_CRITICA_SEL || LOJA !== null || AVAL_SO_NOVAS || DIA) ? `
  <div class="section-label" id="avalReclamacoes">${DIA ? 'Reclamações do dia ruim — ' + esc(avalDiaRuimRotulo(DIA)) + ', ' + esc(DIA.c) : AVAL_CRITICA_SEL ? 'Comentários de quem marcou esta crítica' : 'Reclamações com comentário (nota ≤ ' + NOTA_RUIM_ATE + ')'} — ${reclamacoes.length.toLocaleString('pt-BR')}${AVAL_SO_NOVAS ? (AVAL_CRITICA_SEL ? (reclamacoes.length === 1 ? ' novo' : ' novos') : (reclamacoes.length === 1 ? ' nova' : ' novas')) : ''}${DIA ? '' : ' no período'}${AVAL_SO_NOVAS ? ` <button class="preset-btn active" style="margin-left:8px; text-transform:none; letter-spacing:0; vertical-align:middle;" onclick="avalNovasFiltrar('avalReclamacoes')" title="clique para voltar a ver todas">só as novas ✕</button>` : ''}${DIA ? ` <button class="preset-btn active" style="margin-left:8px; text-transform:none; letter-spacing:0; vertical-align:middle;" onclick="avalDiaLimpar('avalReclamacoes')" title="clique para voltar a ver todas as reclamações">dia ruim ✕</button>` : ''}</div>
  ${AVAL_CRITICA_SEL ? `${LOJA === null ? `<div class="contexto" style="border-color:var(--brand);">
    <button class="preset-btn active" onclick="avalCriticaLimpar()">${esc(AVAL_CRITICA_SEL)} ✕</button>
    <div style="font-size:12px; color:var(--tx-3); margin-top:6px;">
      Comentários de qualquer nota, não só das baixas. Clique numa loja da tabela para ver só os dela.
    </div>
  </div>` : ''}
  <div id="tabelaCriticaLojas" style="margin-bottom:14px;">
    <table>
      <tr><th>Loja</th><th>Marcaram esta crítica</th><th>Avaliações</th><th>A cada 100 avaliações</th></tr>
      ${lojasDaCritica.map((x, i) => `<tr class="aval-clic${x.idx === LOJA ? ' aval-sel' : ''}" onclick="avalLojaFiltrar(${i}, 1)" title="${x.idx === LOJA ? 'clique para voltar a todas as lojas' : 'clique para a tela mostrar só esta loja'}"><td>${esc(x.nome)}${x.idx === LOJA ? ' ✕' : ''}</td><td>${x.n}</td><td>${x.aval === null ? '–' : x.aval}</td>
        <td>${x.aval ? pct(x.n / x.aval * 100) : '–'}</td></tr>`).join('')}
    </table>
  </div>` : ''}
  ${(!AVAL_CRITICA_SEL && aguardando) ? `<div class="caption-label" style="text-align:center;">${aguardando} avaliaç${aguardando === 1 ? 'ão' : 'ões'} com crítica aguardando resposta da loja no período.</div>` : ''}
  ${comentarios.length ? `${comDatas ? `<div class="aval-ordem"><span style="font-size:12px; color:var(--tx-3);">Ordenar:</span>${AVAL_ORD_COLS.map(c => `<button class="preset-btn${AVAL_RECL_ORD.col === c[0] ? ' active' : ''}" onclick="avalReclOrdenar('${c[0]}')">${c[1]}${AVAL_RECL_ORD.col === c[0] ? (AVAL_RECL_ORD.dir > 0 ? ' ▲' : ' ▼') : ''}</button>`).join('')}</div>
  <div id="tabelaComentarios" class="aval-recl aval-dt">
    <table>
      <tr>${AVAL_ORD_COLS.map(c => `<th class="aval-ord${AVAL_RECL_ORD.col === c[0] ? ' aval-ord-sel' : ''}" onclick="avalReclOrdenar('${c[0]}')" title="${c[3] ? c[3] + ' ' : ''}Clique para ordenar; de novo, inverte.">${c[1]}${AVAL_RECL_ORD.col === c[0] ? (AVAL_RECL_ORD.dir > 0 ? ' ▲' : ' ▼') : ''}</th>`).join('')}<th>O que criticou</th><th>Comentário</th></tr>
      ${comentarios.map(x => {
        const p = avalDataHora(x.ped || x.data) || { dia: formatarDataCurta(x.data), ano: '', hora: '', h: null };
        const a = avalDataHora(x.aval);
        const turno = p.h === null ? '' : avalTurno(p.h);
        return `<tr><td>${p.dia}${p.ano ? `<span class="aval-ano">/${p.ano}</span>` : ''}${p.hora ? ' ' + p.hora : ''}${turno ? ` <span class="aval-turno">${turno}</span>` : ''}</td><td${a ? '' : ' class="aval-vz"'}>${a ? `${a.dia}<span class="aval-ano">/${a.ano}</span>${a.hora ? ' ' + a.hora : ''}` : ''}</td><td class="aval-loja">${esc(LOJAS[x.loja])}</td><td>${x.nota} ★</td>
        <td class="aval-crit${x.criticas && !x.criticas.length ? ' aval-sem' : ''}">${x.criticas === null ? '' : (x.criticas.map(esc).join(' · ') || '–')}</td>
        <td class="aval-txt">${x.nova ? '<span class="aval-nova" title="chegou ao painel nas últimas 24 horas">nova</span> ' : ''}${esc(String(x.txt))}${x.aguarda ? ' <span style="font-size:10px; color:var(--tx-4); border:1px solid var(--line-2); border-radius:8px; padding:1px 6px; white-space:nowrap;">aguardando resposta</span>' : ''}${x.itens.length ? `<div style="font-size:11px; color:var(--tx-3); margin-top:3px; overflow-wrap:break-word;">Pediu: ${x.itens.map(esc).join(' · ')}</div>` : ''}</td></tr>`; }).join('')}
    </table>
  </div>
  <div class="caption-label">Horário de Curitiba. O iFood libera a avaliação cerca de 24 horas depois de feita.${AVAL_CRITICAS.some(r => r[10]) ? '' : ' A marca “nova” aparece a partir da próxima que chegar.'}</div>` : `<div id="tabelaComentarios" class="aval-recl">
    <table>
      <tr><th>Data</th><th>Loja</th><th>Nota</th>${temCriticas ? '<th>O que criticou</th>' : ''}<th>Comentário</th></tr>
      ${comentarios.map(x => `<tr><td>${formatarDataCurta(x.data)}</td><td>${esc(LOJAS[x.loja])}</td><td>${x.nota} ★</td>
        ${temCriticas ? `<td class="aval-crit${x.criticas && !x.criticas.length ? ' aval-sem' : ''}">${x.criticas === null ? '' : (x.criticas.map(esc).join(' · ') || '–')}</td>` : ''}
        <td class="aval-txt">${esc(String(x.txt))}${x.aguarda ? ' <span style="font-size:10px; color:var(--tx-4); border:1px solid var(--line-2); border-radius:8px; padding:1px 6px; white-space:nowrap;">aguardando resposta</span>' : ''}${x.itens.length ? `<div style="font-size:11px; color:var(--tx-3); margin-top:3px; overflow-wrap:break-word;">Pediu: ${x.itens.map(esc).join(' · ')}</div>` : ''}</td></tr>`).join('')}
    </table>
  </div>`}
  ${reclamacoes.length > 20 ? `<div id="avalReclMais" style="text-align:center; margin-top:10px;">
    <span style="font-size:12.5px; color:var(--tx-3); margin-right:8px;">Mostrando ${comentarios.length} de ${reclamacoes.length.toLocaleString('pt-BR')}</span>
    ${comentarios.length < reclamacoes.length ? `<button class="preset-btn" onclick="avalReclVer(1)">Ver mais ${Math.min(20, reclamacoes.length - comentarios.length)}</button>
    <button class="preset-btn" onclick="avalReclVer(2)">Ver todas</button>` : ''}
    ${comentarios.length > 20 ? `<button class="preset-btn" onclick="avalReclVer(0)">Mostrar menos</button>` : ''}
  </div>` : ''}` : `<div class="caption-label" style="text-align:center;">${AVAL_SO_NOVAS ? (AVAL_CRITICA_SEL ? 'Nenhum comentário novo' : 'Nenhuma reclamação nova') + ' desde ontem neste recorte. Clique em “só as novas ✕” para ver todas.' : DIA ? 'Nenhuma reclamação desta loja neste dia ruim. Clique no ✕ da loja para ver as das outras lojas.' : AVAL_CRITICA_SEL ? 'Ninguém escreveu comentário com esta crítica no período.' : 'Nenhuma reclamação com comentário desta loja no período.'}</div>`}` : ''}`;

  destroyChart('chartNotas');
  chartInstances['chartNotas'] = new Chart(document.getElementById('chartNotas').getContext('2d'), {
    type: 'bar',
    data: {
      labels: ['1 ★', '2 ★', '3 ★', '4 ★', '5 ★'],
      datasets: [{ data: dist, backgroundColor: [corToken('--farol-fora'), corToken('--farol-fora'), corToken('--farol-perto'), corToken('--farol-ok'), corToken('--farol-ok')], borderRadius: 4 }],
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: { legend: { display: false }, tooltip: { callbacks: { label: (c) => `${c.raw} avaliações (${pct(c.raw / total * 100)}%)` } } },
      scales: { x: { grid: { display: false } }, y: { beginAtZero: true, grid: { color: '#232321' } } },
    },
  });

  destroyChart('chartTags');
  if (tags.length) chartInstances['chartTags'] = new Chart(document.getElementById('chartTags').getContext('2d'), {
    type: 'bar',
    data: { labels: tags.map(x => x.t), datasets: [{ data: tags.map(x => x.n), backgroundColor: corToken('--info'), borderRadius: 4 }] },
    plugins: [pluginRotulosBarra(i => String(tags[i].n))],
    options: {
      indexAxis: 'y', responsive: true, maintainAspectRatio: false,
      layout: { padding: { right: 8 } },
      plugins: { legend: { display: false } },
      scales: {
        x: { beginAtZero: true, max: Math.max(...tags.map(x => x.n)) * 1.2, grid: { color: '#232321' } },
        y: { grid: { display: false }, ticks: { font: { size: 10 } } },
      },
    },
  });

  // O que mais criticam: clique na barra recorta a lista de comentarios; clicar de novo solta.
  destroyChart('chartCriticas');
  if (criticas.length) {
    chartInstances['chartCriticas'] = new Chart(document.getElementById('chartCriticas').getContext('2d'), {
      type: 'bar',
      data: { labels: criticas.map(x => x.c), datasets: [{ data: criticas.map(x => x.n),
        backgroundColor: criticas.map(x => AVAL_CRITICA_SEL === x.c ? corToken('--brand') : corToken('--info')), borderRadius: 4 }] },
      plugins: [pluginRotulosBarra(i => String(criticas[i].n))],
      options: {
        indexAxis: 'y', responsive: true, maintainAspectRatio: false,
        layout: { padding: { right: 8 } },
        // o redesenho destroi este grafico: espera o Chart.js terminar de tratar o clique
        onClick: (_e, els) => { if (els.length) { const i = els[0].index; setTimeout(() => avalCriticaFiltrar(i), 0); } },
        onHover: (e, els) => { e.native.target.style.cursor = els.length ? 'pointer' : 'default'; },
        plugins: {
          legend: { display: false },
          tooltip: { callbacks: { label: (c) => `${c.raw} de ${comCritica} avaliações com crítica (${pct(c.raw / comCritica * 100)}%)` } },
        },
        scales: {
          x: { beginAtZero: true, max: criticas[0].n * 1.2, grid: { color: corToken('--line') } },
          y: { grid: { display: false }, ticks: { font: { size: 10 } } },
        },
      },
    });
  }
}

async function entrarRelatorios() {
  const alvo = document.getElementById('view-relatorios');
  if (RELATORIOS === null) {
    alvo.innerHTML = '<div class="contexto">Carregando relatórios...</div>';
    RELATORIOS = await consultarTudo(
      "relatorios_semanais?select=id,semana_ini,semana_fim,titulo,corpo_html,criado_em&order=semana_ini.desc"
    );
  }
  renderModuloRelatorios(RELATORIOS.length ? RELATORIOS[0].id : null);
}

function renderModuloRelatorios(idSelecionado, abaIdx = 0) {
  const alvo = document.getElementById('view-relatorios');

  // Barra do gerador sob demanda: escolhe um período e monta o relatório na hora,
  // direto no navegador. Padrão: a última semana completa (segunda a domingo).
  const hoje = new Date(); hoje.setHours(0, 0, 0, 0);
  const dow = (hoje.getDay() + 6) % 7; // 0 = segunda
  const segAtual = new Date(hoje); segAtual.setDate(segAtual.getDate() - dow);
  const domPassado = new Date(segAtual); domPassado.setDate(domPassado.getDate() - 1);
  const segPassada = new Date(domPassado); segPassada.setDate(segPassada.getDate() - 6);
  const isoD = (d) => d.toISOString().slice(0, 10);

  const gerador = `
  <div class="contexto" style="text-align:left;">
    <b>Gerar relatório de qualquer período</b> — números e alertas calculados na hora, com os filtros de
    unidade/marca atuais. <span style="color:#8a897e;">(A análise interpretada e as ações recomendadas
    continuam vindo do resumo automático de segunda-feira.)</span>
    <div style="display:flex; flex-wrap:wrap; gap:10px; align-items:center; margin-top:10px;">
      <label style="font-size:12px; color:var(--tx-3);">De <input type="date" id="relIni" value="${isoD(segPassada)}"
        style="background:#111110; border:1px solid #34332f; color:#fff; border-radius:6px; padding:5px 8px;"></label>
      <label style="font-size:12px; color:var(--tx-3);">Até <input type="date" id="relFim" value="${isoD(domPassado)}"
        style="background:#111110; border:1px solid #34332f; color:#fff; border-radius:6px; padding:5px 8px;"></label>
      <button class="preset-btn" onclick="gerarRelatorioAdHoc()">Gerar relatório</button>
    </div>
  </div>
  <div id="relatorioAdHoc"></div>`;

  if (!RELATORIOS.length) {
    alvo.innerHTML = `
    <div class="section-label" style="border-top:none; margin-top:0; padding-top:0;">Relatórios</div>
    ${gerador}
    <div class="contexto" style="border-color:#c8102e;">
      Ainda não há resumos semanais publicados.<br>
      O primeiro aparece aqui automaticamente depois que a rotina de segunda-feira rodar.</div>`;
    return;
  }
  const sel = RELATORIOS.find(r => r.id === idSelecionado) || RELATORIOS[0];

  // Relatorios novos vem estruturados em <section data-aba="..."> (Rede + uma aba por
  // unidade). Se o corpo tiver essas secoes, mostramos uma barra de abas e so o conteudo
  // da aba escolhida; relatorios antigos (sem secoes) continuam renderizando inteiros.
  const tmp = document.createElement('div');
  tmp.innerHTML = sel.corpo_html;
  const secoes = Array.from(tmp.querySelectorAll('section[data-aba]'));
  let corpoSel = sel.corpo_html;
  let barraAbas = '';
  if (secoes.length) {
    if (abaIdx < 0 || abaIdx >= secoes.length) abaIdx = 0;
    barraAbas = `
    <div class="periodo-presets" style="margin-top:8px;">
      ${secoes.map((s, i) => `<button class="preset-btn ${i === abaIdx ? 'active' : ''}"
        onclick="renderModuloRelatorios(${sel.id}, ${i})">${s.dataset.aba}</button>`).join('')}
    </div>`;
    corpoSel = secoes[abaIdx].innerHTML;
  }

  alvo.innerHTML = `
  <div class="section-label" style="border-top:none; margin-top:0; padding-top:0;">Relatórios</div>
  ${gerador}
  <div class="section-label">Resumos semanais</div>
  <div class="periodo-presets">
    ${RELATORIOS.map(r => `<button class="preset-btn ${r.id === sel.id ? 'active' : ''}"
      onclick="renderModuloRelatorios(${r.id})">${formatarDataCurta(r.semana_ini)} – ${formatarDataCurta(r.semana_fim)}</button>`).join('')}
  </div>
  ${barraAbas}
  <div class="relatorio-corpo">${corpoSel}</div>`;
}

// Relatorio sob demanda: mesmos numeros validados do painel, para o periodo escolhido,
// comparados com a janela anterior de mesmo tamanho. Os "pontos de atencao" saem de regras
// fixas (limiares), nao de analise — a analise fica com a rotina de segunda.
async function gerarRelatorioAdHoc() {
  const alvo = document.getElementById('relatorioAdHoc');
  const ini = document.getElementById('relIni').value;
  const fim = document.getElementById('relFim').value;
  if (!ini || !fim || fim < ini) {
    alvo.innerHTML = `<div class="contexto" style="border-color:var(--farol-fora);">Período inválido.</div>`;
    return;
  }
  alvo.innerHTML = `<div class="contexto">Calculando...</div>`;

  // garante as bases sob demanda
  if (NEGOCIACOES === null) await entrarNegociacoesSoDados();
  if (AVALIACOES === null) await entrarAvaliacoesSoDados();

  const dias = Math.round((new Date(fim + 'T00:00:00') - new Date(ini + 'T00:00:00')) / 86400000) + 1;
  const fimAntD = new Date(ini + 'T00:00:00'); fimAntD.setDate(fimAntD.getDate() - 1);
  const iniAntD = new Date(fimAntD); iniAntD.setDate(iniAntD.getDate() - (dias - 1));
  const iso = (d) => d.toISOString().slice(0, 10);
  const iniAnt = iso(iniAntD), fimAnt = iso(fimAntD);
  const temAnterior = fimAnt >= DATAS[0];

  const m = computeMetrics(ini, fim);
  const a = temAnterior ? computeMetrics(iniAnt, fimAnt) : null;

  const activeL = activeLojas();
  const negs = NEGOCIACOES.filter(r => activeL.has(r[0]) && r[1] >= ini && r[1] <= fim);
  const avs = AVALIACOES.filter(r => activeL.has(r[0]) && r[1] >= ini && r[1] <= fim);
  const motivos = resumoMotivosCancelamento(ini, fim).slice(0, 3);

  const negSem = negs.filter(negSemResposta).length;
  const negResp = negs.filter(negRespondivel).length;
  const negAtraso = negs.filter(r => (r[3] || '').includes('ATRASO')).length;
  const notaMedia = avs.length ? avs.reduce((s, r) => s + r[2], 0) / avs.length : null;
  const ruinsRel = notasRuins(avs);
  const pctRuins = ruinsRel.pct === null ? 0 : ruinsRel.pct;
  const kRuins = (METAS_KPI || []).find(k => k.chave === 'pct_notas_ruins');

  const linha = (nome, atual, anterior, formato, tipo = 'maiorMelhor') => {
    const f = formato === 'int' ? (v) => Math.round(v).toLocaleString('pt-BR')
      : formato === 'pct' ? (v) => pct(v) + '%'
      : (v) => 'R$ ' + fmt(v);
    let varTxt = '—';
    if (anterior !== null && Math.abs(anterior) > 0.005) {
      const v = (atual - anterior) / Math.abs(anterior) * 100;
      const palavra = v > 0.05 ? 'subiu' : v < -0.05 ? 'caiu' : 'estável';
      const bom = tipo === 'neutro' ? null : (tipo === 'maiorMelhor' ? v > 0 : v < 0);
      const cor = palavra === 'estável' || bom === null ? '#8a897e' : (bom ? 'var(--farol-ok)' : 'var(--farol-fora)');
      varTxt = `<span style="color:${cor};">${palavra}${palavra !== 'estável' ? ' ' + pct(Math.abs(v)) + '%' : ''}</span>`;
    }
    return `<tr><td>${nome}</td><td>${f(atual)}</td><td>${anterior !== null ? f(anterior) : '—'}</td><td>${varTxt}</td></tr>`;
  };

  // pontos de atencao por regra fixa
  const alertas = [];
  const alerta = (txt, modulo, tela) => `<li style="cursor:pointer;" onclick="mostrarModulo('${modulo}')"
    title="Abre ${tela}. A tela usa a janela de datas padrão dela, não o período deste relatório.">${txt}
    <span style="font-size:11px; color:var(--tx-5);">abrir ${tela} →</span></li>`;
  if (negSem > 0) alertas.push(alerta(`<b style="color:var(--farol-fora);">${negSem} negociações sem resposta</b> (${pct(negResp ? negSem / negResp * 100 : 0)}% das ${negResp} que dependem da loja) — resposta evita cancelamento automático.`, 'negociacoes', 'Negociações'));
  if (negs.length && negAtraso / negs.length > 0.4) alertas.push(alerta(`<b style="color:var(--farol-fora);">${pct(negAtraso / negs.length * 100)}% das negociações por atraso</b> — olhar preparo/despacho no pico.`, 'negociacoes', 'Negociações'));
  if (notaMedia !== null && notaMedia < 4.6) alertas.push(alerta(`<b style="color:var(--farol-fora);">Nota média ${notaMedia.toFixed(2).replace('.', ',')}</b> abaixo do padrão da rede (4,6+).`, 'avaliacoes', 'Avaliações'));
  // Notas ruins: quem decide e' o farol do indicador (metas_kpi), o mesmo do card e do Placar.
  // Aqui nao ha numero solto (ate 06/10/2026 era um "mais de 5%" escrito a mao).
  if (avs.length && kRuins && farolKpi(kRuins, pctRuins)[1] === 'fora') alertas.push(alerta(`<b style="color:var(--farol-fora);">${pct(pctRuins)}% de ${NOTA_RUIM_ROT}</b> no período (${ruinsRel.n.toLocaleString('pt-BR')} de ${avs.length.toLocaleString('pt-BR')} avaliações) — meta: até ${fmtKpi(kRuins.unidade, Number(kRuins.meta))}.`, 'avaliacoes', 'Avaliações'));
  if (m.valorCanceladoPct > 1.2) alertas.push(alerta(`<b style="color:var(--farol-fora);">Cancelamentos em ${pct(m.valorCanceladoPct)}% do bruto</b> — acima do normal (~0,9%).`, 'cancelamentos', 'Cancelamentos'));
  if (!alertas.length) alertas.push('<li>Nenhum alerta pelas regras automáticas — período dentro dos padrões.</li>');

  alvo.innerHTML = `<div class="relatorio-corpo" style="margin-top:12px;">
    <h2>Relatório de ${formatarDataCurta(ini)} a ${formatarDataCurta(fim)} (${dias} dias)</h2>
    <p style="color:#8a897e;" title="Números do banco, sem análise interpretada. Recorte atual de unidades e marcas aplicado.">Comparação: ${temAnterior ? `${formatarDataCurta(iniAnt)} a ${formatarDataCurta(fimAnt)}` : 'sem período anterior disponível'}.</p>
    <h3>Resultado</h3>
    <table>
      <tr><th>Indicador</th><th>Período</th><th>Anterior</th><th>Variação</th></tr>
      ${linha('Pedidos', m.totalPedidos, a && a.totalPedidos, 'int')}
      ${linha('Faturamento bruto (venda cheia, com frete)', m.bruto, a && a.bruto, 'moeda')}
      ${linha('Ticket médio', m.ticketMedio, a && a.ticketMedio, 'moeda')}
      ${linha('Custo total do iFood', m.custoIfood, a && a.custoIfood, 'moeda', 'menorMelhor')}
      ${linha('Marketing total', m.totalMkt, a && a.totalMkt, 'moeda', 'neutro')}
      ${linha('Líquido', m.liquido, a && a.liquido, 'moeda')}
      ${linha('Custo iFood (% do bruto)', m.custoIfoodPct, a && a.custoIfoodPct, 'pct', 'menorMelhor')}
      ${linha('Valor cancelado', m.valorCancelado, a && a.valorCancelado, 'moeda', 'menorMelhor')}
    </table>
    <h3>Qualidade e pós-venda</h3>
    <ul>
      <li>Avaliações: <b>${avs.length}</b>${notaMedia !== null ? ` — nota média <b>${notaMedia.toFixed(2).replace('.', ',')}</b>, ${pct(pctRuins)}% de ${NOTA_RUIM_ROT} (${ruinsRel.n})` : ''}</li>
      <li>Negociações: <b>${negs.length}</b> — ${negSem} sem resposta, ${negAtraso} por atraso</li>
      ${motivos.length ? `<li>Top motivos de cancelamento: ${motivos.map(x => `${x.responsavel} (${x.n})`).join(' · ')}</li>` : ''}
    </ul>
    <h3>Pontos de atenção (regras automáticas)</h3>
    <p style="color:var(--tx-5); font-size:11.5px; margin:0 0 4px;">A tela abre no período padrão dela, não neste.</p>
    <ul>${alertas.join('')}</ul>
    <p style="color:#8a897e; font-size:11.5px;">Líquido antes dos custos próprios (insumos, equipe, aluguel).
    Negociações e avaliações existem na base a partir de jun-jul/2026.</p>
  </div>`;
}

// ------------------------------------------------------------------
// Modulo Contestações: pendentes de contestar (janela de 7 dias do iFood)
// + historico do que a rotina/equipe ja contestou e os resultados.
let CONTESTACOES = null;

// Copiar o numero do pedido (12/09/2026): a contestacao e pedido a pedido no
// portal do iFood, e o numero e o que se cola la. Selecionar com o mouse numa
// tabela longa erra digito — e digito errado contesta o pedido do vizinho.
function copiarPedido(el, id) {
  const antes = el.textContent;
  navigator.clipboard.writeText(String(id)).then(() => {
    el.textContent = '✔';
    setTimeout(() => { el.textContent = antes; }, 1500);
  }).catch(() => { el.title = 'Não consegui copiar — selecione o número na tela'; });
}

async function entrarContestacoes() {
  const alvo = document.getElementById('view-contestacoes');
  if (CONTESTACOES === null) {
    alvo.innerHTML = '<div class="contexto">Carregando contestações...</div>';
    // 07/11/2026 (lote 2, canal-13): fonte = vw_contestacoes_fila_api, a fila que a rotina usa desde 30/10
    // (pedidos e eventos financeiros da API; a view ja traz so os ultimos 45 dias). Ela nao tem turno (sai da
    // hora, pela regra do painel), status (sai de cancelamento_tipo) nem origem (contestado_rotina).
    let linhas;
    try {
      linhas = await consultarTudo(
        CONTEST_FONTE + "?select=id_curto,id_curto_portal,nome_loja,unidade,data_hora_pedido,hora,cancelamento_tipo," +
        "motivo_cancelamento,valor,contestavel_ate,vence_aprox,automatizavel,contestado_rotina,bloco," +
        "descarte,descarte_escopo,descarte_detalhe&order=data_hora_pedido.desc"
      );
    } catch (e) {
      alvo.innerHTML = '<div class="contexto">Não consegui consultar a fila de contestação agora. Recarregue a página.</div>';
      return;
    }
    CONTESTACOES = { linhas };
  }
  renderModuloContestacoes();
}

function renderModuloContestacoes() {
  const alvo = document.getElementById('view-contestacoes');
  // 07/11/2026 (auditoria lote 2, canal-25): segue a loja do seletor; Rede = as 3 (o Boqueirão saiu do painel em 24/10).
  const linhas = CONTESTACOES.linhas.filter(r => contestUnidadeOk(r.unidade)).map(r => ({ ...r, valor: Number(r.valor) || 0 }));

  const hojeISO = new Date().toISOString().slice(0, 10);
  // 07/11/2026 (lote 2, canal-13): prazo pela hora exata (vence_aprox); contestavel_ate (data em UTC) so' de reserva.
  const diasAte = contestDiasAte;

  const bloco = (b) => linhas.filter(r => r.bloco === b);
  // ORDEM DA FILA (12/09/2026): primeiro o PRAZO, depois o DINHEIRO. Ordenar so pela
  // data punia o pedido de R$ 120 que vence no mesmo dia do de R$ 8 — dentro da
  // mesma faixa de prazo, quem vale mais aparece primeiro. Faixa 3 e' o pedido sem
  // prazo no export, que vai para o fim em vez de para o topo (string vazia
  // ordenava antes de tudo).
  const faixaPrazo = (r) => {
    const d = diasAte(contestPrazoDe(r));
    if (d === null) return 3;
    return d <= 2 ? 0 : d <= 5 ? 1 : 2;
  };
  const PRAZO_ROT = ['vence em até 2 dias', 'vence em 3 a 5 dias',
                     'vence em 6 dias ou mais', 'sem prazo'];
  const porPrazoEValor = (a, b) => (faixaPrazo(a) - faixaPrazo(b)) || (b.valor - a.valor);
  // 07/11/2026: a divisao segue o Passo 1 da rotina (regra SEMPRE TENTAR, dono 05/11): a rotina contesta todo
  // A_CONTESTAR, menos o descarte de escopo TODOS (o portal nao deixa — sai da conta) e o SEM_FATO_VERDADEIRO
  // (nao ha fato verdadeiro para escrever — vai ao dono).
  const aContestar = bloco('A_CONTESTAR');
  const portalBloqueia = aContestar.filter(contestPortalBloqueia);
  const aContestarVoce  = aContestar.filter(r => !contestPortalBloqueia(r) && r.descarte === 'SEM_FATO_VERDADEIRO')
                            .sort(porPrazoEValor);
  const aContestarRotina = aContestar.filter(r => !contestPortalBloqueia(r) && r.descarte !== 'SEM_FATO_VERDADEIRO')
                            .sort((a, b) => String(a.vence_aprox || a.contestavel_ate || '').localeCompare(String(b.vence_aprox || b.contestavel_ate || '')));
  const aguardando = bloco('AGUARDANDO');
  const aprovadas  = bloco('APROVADA');
  const reprovadas = bloco('REPROVADA');
  const perdidas   = bloco('PRAZO_PASSOU').filter(r => !contestPortalBloqueia(r));
  const naoContest = bloco('NAO_CONTESTAVEL');
  // Cancelamento sem hora de cancelamento na API: fica fora dos blocos em vez de virar falso "prazo perdido".
  const semDado    = bloco('SEM_DADO');

  const soma = (l) => l.reduce((s, r) => s + r.valor, 0);
  const dt = (v) => v ? formatarDataCurta(String(v).slice(0, 10)) : '—';
  const parcial = (r) => r.cancelamento_tipo === 'PARCIAL' ? ' <span style="color:#8a897e; font-size:10px;">(parcial)</span>' : '';
  const quem = (r) => r.contestado_rotina
    ? '<span style="color:var(--farol-ok);">rotina</span>' : '<span style="color:var(--tx-3);" title="Sem registro na tabela da rotina">—</span>';
  const turnoDe = (r) => { const h = /^(\d{2}):/.exec(r.hora || ''); return h ? (avalTurno(+h[1]) || '—') : '—'; };
  const pedidoPortal = (r) => r.id_curto_portal || r.id_curto;

  // Grade padrao dos blocos: hora e turno entram porque identificam a equipe
  // que estava na operacao quando o problema aconteceu.
  const grade = (lista, extra) => `<table>
    <tr><th>Loja</th><th>Pedido</th><th>Data</th><th>Hora</th><th>Turno</th><th>Motivo</th><th>Valor</th>${extra.cabecalho}</tr>
    ${lista.map(r => `<tr>
      <td>${r.nome_loja}</td>
      <td>${pedidoPortal(r)} <span onclick="copiarPedido(this, '${pedidoPortal(r)}')" title="copiar o nº ${pedidoPortal(r)} para colar no portal do iFood"
        style="cursor:pointer; color:var(--tx-5); margin-left:3px;">⧉</span></td>
      <td>${dt(r.data_hora_pedido)}</td>
      <td>${r.hora || '—'}</td><td>${turnoDe(r)}</td>
      <td style="font-size:11.5px;">${r.motivo_cancelamento || '—'}${parcial(r)}</td>
      <td>R$ ${fmt(r.valor)}</td>${extra.celula(r)}</tr>`).join('')}
  </table>`;

  const colPrazo = {
    cabecalho: '<th>Contestar até</th>',
    celula: (r) => { const p = contestPrazoDe(r); const d = diasAte(p);
      const hh = p && r.vence_aprox ? ' ' + p.slice(11, 16) : '';
      return `<td title="${PRAZO_ROT[faixaPrazo(r)]}"${d !== null && d <= 2 ? ' style="color:var(--farol-fora); font-weight:bold;"' : ''}>${dt(p)}${hh}${d !== null ? ` (${d}d)` : ''}</td>`; },
  };
  const colQuem = { cabecalho: '<th>Contestada por</th>', celula: (r) => `<td>${quem(r)}</td>` };
  // A fila da API nao traz a justificativa do iFood (era da planilha); no bloco do dono vai o porque a rotina devolveu.
  const colPrazoMotivo = {
    cabecalho: colPrazo.cabecalho + '<th>Por que a rotina devolveu</th>',
    celula: (r) => colPrazo.celula(r) + `<td style="font-size:10.5px; color:var(--tx-3);">${atdEsc(String(r.descarte_detalhe || '—').slice(0, 180))}</td>`,
  };

  alvo.innerHTML = `
  <div class="section-label" style="border-top:none; margin-top:0; padding-top:0;">Contestações de cancelamento · ${contestEscopoTxt()}, últimos 45 dias</div>
  <div class="caption-label" style="text-align:center;" title="Segue a loja do topo; o status do iFood leva até 48h.">Não segue o período do topo.</div>
  <div class="cards">
    <div class="card ${aContestarVoce.length ? 'neg' : 'neutral'}"><div class="card-lbl">Você precisa contestar</div><div class="card-val">${aContestarVoce.length}</div><div class="card-pct">R$ ${fmt(soma(aContestarVoce))}</div></div>
    <div class="card neutral"><div class="card-lbl">A rotina contesta</div><div class="card-val">${aContestarRotina.length}</div><div class="card-pct">R$ ${fmt(soma(aContestarRotina))}</div></div>
    <div class="card neutral"><div class="card-lbl">Aguardando iFood</div><div class="card-val">${aguardando.length}</div><div class="card-pct">R$ ${fmt(soma(aguardando))}</div></div>
    <div class="card pos"><div class="card-lbl">Aprovadas</div><div class="card-val">${aprovadas.length}</div><div class="card-pct">R$ ${fmt(soma(aprovadas))} recuperados</div></div>
    <div class="card ${reprovadas.length ? 'neg' : 'neutral'}"><div class="card-lbl">Reprovadas</div><div class="card-val">${reprovadas.length}</div><div class="card-pct">R$ ${fmt(soma(reprovadas))}</div></div>
  </div>

  <div class="section-label">Você precisa contestar</div>
  ${aContestarVoce.length ? `<div id="tabelaContestVoce">${grade(aContestarVoce, colPrazoMotivo)}</div>
  <div class="caption-label" style="text-align:center;" title="A rotina devolveu por não achar um fato verdadeiro para escrever.">Na ordem de fazer: quem vence antes primeiro e, no mesmo prazo, o de maior valor.</div>`
  : '<div class="contexto" style="border-color:var(--farol-ok);">Nada esperando por você agora. ✔</div>'}

  <div class="section-label">A rotina contesta sozinha</div>
  ${aContestarRotina.length ? `<div id="tabelaContestRotina">${grade(aContestarRotina, colPrazo)}</div>
  <div class="caption-label" style="text-align:center;">Entram na próxima execução da rotina (11:36; reservas às 14:36 e 16:36).</div>`
  : '<div class="contexto">Nenhum pedido na fila da rotina agora.</div>'}
  ${portalBloqueia.length ? `<div class="caption-label" style="text-align:center;" title="A rotina abriu o pedido no portal e o iFood não mostrou a opção de contestar. Não entram na conta do recuperável.">${portalBloqueia.length} pedido(s) no prazo (R$ ${fmt(soma(portalBloqueia))}) o portal do iFood não deixa contestar.</div>` : ''}

  <div class="section-label">Aguardando resposta do iFood</div>
  ${aguardando.length ? `<div id="tabelaContestAguard">${grade(aguardando, colQuem)}</div>
  <div class="caption-label" style="text-align:center;">Contestadas, sem status ainda. O iFood leva até 48h para responder.</div>`
  : '<div class="contexto">Nenhuma contestação aguardando resposta.</div>'}

  <div class="section-label">Aprovadas — valor recuperado</div>
  ${aprovadas.length ? `<div id="tabelaContestAprov">${grade(aprovadas, colQuem)}</div>`
  : '<div class="contexto">Nenhuma contestação aprovada no período.</div>'}

  <div class="section-label">Reprovadas</div>
  ${reprovadas.length ? `<div id="tabelaContestReprov">${grade(reprovadas, colQuem)}</div>`
  :'<div class="contexto" style="border-color:var(--farol-ok);">Nenhuma reprovada no período. ✔</div>'}

  ${perdidas.length ? `<div class="section-label">Prazo encerrado sem contestação</div>
  <div id="tabelaContestPerd">${grade(perdidas, colQuem)}</div>
  <div class="caption-label" style="text-align:center;">Não dá mais para contestar: escaparam R$ ${fmt(soma(perdidas))}, contra R$ ${fmt(soma(aprovadas))} recuperados nas aprovadas.</div>` : ''}

  <div class="caption-label" style="text-align:center; margin-top:14px;">${naoContest.length ? `Outros ${naoContest.length} cancelamento(s) (R$ ${fmt(soma(naoContest))}) têm motivo que o iFood nunca deixou contestar.` : ''}
  ${semDado.length ? `<br>${semDado.length} cancelamento(s) sem a hora do cancelamento ficam fora dos blocos — não são prazo perdido.` : ''}</div>`;
}

// ------------------------------------------------------------------
// ATENDIMENTO AO CLIENTE (05/10/2026) — o banco de respostas-padrao que o
// delivery cola no chat do Gestor de Pedidos. A fonte e' atd_respostas
// (script/atendimento.sql), a mesma lista de rotinas/textos-contestacao.md,
// secao "RESPOSTAS AO CLIENTE". Copiar grava um USO em atd_casos; situacao
// sem resposta vira um caso NOVO, que a rotina de contestacao leva ao dono.
// A caixa de texto e' editavel de proposito: a pessoa troca HH:MM e os campos
// em MAIUSCULAS, e o Copiar recusa enquanto sobrar campo por preencher —
// "HH:MM" indo para o cliente e' pior do que nao responder.
// ------------------------------------------------------------------
const ATD = { respostas: null, grupo: 'Todas' };

function atdEsc(s) {
  return String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}

async function entrarAtendimento() {
  const alvo = document.getElementById('view-atendimento');
  if (!ATD.respostas) {
    alvo.innerHTML = '<div class="contexto">Carregando respostas...</div>';
    try {
      ATD.respostas = await consultarTudo('atd_respostas?select=codigo,grupo,situacao,quando_usar,quando_nao,texto,depois&ativo=eq.true&order=ordem');
    } catch (e) {
      alvo.innerHTML = '<div class="contexto">Não foi possível carregar as respostas. Recarregue a página.</div>';
      return;
    }
  }
  renderModuloAtendimento();
}

function renderModuloAtendimento() {
  const alvo = document.getElementById('view-atendimento');
  const grupos = ['Todas', ...new Set(ATD.respostas.map(r => r.grupo))];
  const campo = 'background:var(--surface-2); border:1px solid var(--line); color:var(--tx-1); border-radius:8px; font-family:inherit;';
  const cartoes = ATD.respostas.map(r => `
    <div class="atd-cartao" data-grupo="${atdEsc(r.grupo)}" data-busca="${atdEsc(atdNorm(r.grupo + ' ' + r.situacao + ' ' + (r.quando_usar || '') + ' ' + r.texto))}"
         style="background:var(--surface); border:1px solid var(--line); border-radius:10px; padding:14px 16px; margin-bottom:12px;">
      <div style="display:flex; justify-content:space-between; gap:12px; align-items:baseline; flex-wrap:wrap;">
        <div style="color:var(--tx-1); font-weight:700; font-size:15px;">${atdEsc(r.situacao)}</div>
        <div style="color:var(--tx-5); font-size:11px; text-transform:uppercase; letter-spacing:.6px;">${atdEsc(r.grupo)}</div>
      </div>
      ${r.quando_usar ? `<div style="color:var(--tx-3); font-size:12.5px; margin-top:6px;"><b style="color:var(--farol-ok);">Usar quando:</b> ${atdEsc(r.quando_usar)}</div>` : ''}
      ${r.quando_nao ? `<div style="color:var(--tx-3); font-size:12.5px; margin-top:3px;"><b style="color:var(--farol-fora);">Atenção:</b> ${atdEsc(r.quando_nao)}</div>` : ''}
      <textarea id="atdTxt_${r.codigo}" rows="2" oninput="atdAjustar(this)"
                style="${campo} width:100%; box-sizing:border-box; margin-top:10px; padding:10px 12px; font-size:14px; line-height:1.5; resize:vertical;">${atdEsc(r.texto)}</textarea>
      <div style="display:flex; gap:12px; align-items:center; margin-top:8px; flex-wrap:wrap;">
        <button class="preset-btn" style="color:var(--tx-1); font-size:13px; padding:8px 16px;" onclick="atdCopiar('${r.codigo}')">Copiar resposta</button>
        <span id="atdMsg_${r.codigo}" style="font-size:12.5px; color:var(--tx-3);"></span>
      </div>
      ${r.depois ? `<div style="color:var(--tx-4); font-size:12.5px; margin-top:8px;"><b>Depois:</b> ${atdEsc(r.depois)}</div>` : ''}
    </div>`).join('');

  alvo.innerHTML = `
    <div class="section-label" style="border-top:none; margin-top:4px; padding-top:4px;">Atendimento ao cliente</div>
    <div class="contexto"><b>Discorde sem pedir desculpas</b> · só ofereça reembolso ou reenvio quando a conferência mostrar que o erro foi nosso · <b>nunca acuse o cliente</b></div>
    <div style="display:flex; gap:8px; flex-wrap:wrap; align-items:center; margin:14px 0;">
      <input id="atdBusca" type="search" placeholder="Buscar: atraso, faltou, não atende, pelo…" oninput="atdFiltrar()"
             style="${campo} flex:1; min-width:220px; padding:9px 12px; font-size:14px;">
      ${grupos.map(g => `<button class="preset-btn atd-grupo${g === ATD.grupo ? ' active' : ''}" data-g="${atdEsc(g)}" onclick="atdGrupo(this)">${atdEsc(g)}</button>`).join('')}
    </div>
    <div id="atdLista">${cartoes}</div>
    <div id="atdVazio" class="contexto" style="display:none;">Nenhuma resposta para essa busca. Descreva a situação abaixo.</div>
    <div style="background:var(--surface); border:1px solid var(--line); border-radius:10px; padding:14px 16px; margin-top:18px;">
      <div style="color:var(--tx-1); font-weight:700; font-size:15px;">Não achei a minha situação</div>
      <textarea id="atdNovo" rows="3" placeholder="O que o cliente escreveu e o que aconteceu com o pedido (número, horários)."
                style="${campo} width:100%; box-sizing:border-box; margin-top:10px; padding:10px 12px; font-size:14px; line-height:1.5; resize:vertical;"></textarea>
      <div style="display:flex; gap:12px; align-items:center; margin-top:8px; flex-wrap:wrap;">
        <button class="preset-btn" onclick="atdEnviarNovo()">Enviar para análise</button>
        <span id="atdNovoMsg" style="font-size:12.5px; color:var(--tx-3);"></span>
      </div>
    </div>`;
  document.querySelectorAll('#atdLista textarea').forEach(atdAjustar);
  atdFiltrar();
}

// Sem acento e em minusculas: quem atende digita "nao atende", "endereco".
function atdNorm(s) {
  return String(s || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

// A caixa acompanha o tamanho do texto, inclusive quando a pessoa cola a
// descricao do prato. O piso sao as 2 linhas do rows (height:auto volta a ele);
// com a tela escondida scrollHeight vem zero e fica so o piso.
function atdAjustar(t) {
  t.style.height = 'auto';
  if (t.scrollHeight) t.style.height = (t.scrollHeight + 2) + 'px';
}

function atdGrupo(btn) {
  ATD.grupo = btn.dataset.g;
  document.querySelectorAll('.atd-grupo').forEach(b => b.classList.toggle('active', b === btn));
  atdFiltrar();
}

// Filtra escondendo cartao, sem redesenhar: redesenhar apagaria o que a pessoa
// ja preencheu nas caixas de texto.
function atdFiltrar() {
  const palavras = atdNorm(document.getElementById('atdBusca').value).split(/\s+/).filter(Boolean);
  const cartoes = [...document.querySelectorAll('.atd-cartao')];
  const acha = termos => cartoes.filter(c => (ATD.grupo === 'Todas' || c.dataset.grupo === ATD.grupo)
                                          && termos.every(t => c.dataset.busca.includes(t)));
  let vivos = acha(palavras);
  // Nada com a palavra inteira: tenta pelo comeco dela ("atrasado" acha
  // "atraso", "demorou" acha "demora") antes de mandar a pessoa descrever o caso.
  if (!vivos.length && palavras.length) vivos = acha(palavras.map(t => t.slice(0, 5)));
  cartoes.forEach(c => { c.style.display = vivos.includes(c) ? '' : 'none'; });
  document.getElementById('atdVazio').style.display = vivos.length ? 'none' : '';
}

// O que ainda esta por preencher no texto: hora, valor, opcao entre colchetes e
// campo em MAIUSCULAS (ITEM, ENDERECO, DESCRICAO DO CARDAPIO).
function atdPendencias(texto) {
  const p = [];
  if (/HH:MM/.test(texto)) p.push('o horário (HH:MM)');
  if (/\bXX\b|XX,XX/.test(texto)) p.push('o valor ou o tempo (XX)');
  if (/\[[^\]]*\|[^\]]*\]/.test(texto)) p.push('a opção entre colchetes');
  // lista fechada: nome de rua ou de cliente digitado em maiusculas nao pode travar o Copiar
  (texto.match(/DESCRIÇÃO DO CARDÁPIO|ENDEREÇO|\bITEM\b/g) || []).forEach(c => p.push(c.toLowerCase()));
  return p;
}

async function atdCopiar(codigo) {
  const texto = document.getElementById('atdTxt_' + codigo).value.trim();
  const msg = document.getElementById('atdMsg_' + codigo);
  const falta = atdPendencias(texto);
  if (falta.length) {
    msg.style.color = 'var(--farol-fora)';
    msg.textContent = 'Falta preencher: ' + falta.join(', ') + '.';
    return;
  }
  let copiou = true;
  try { await navigator.clipboard.writeText(texto); }
  catch (e) {
    const t = document.getElementById('atdTxt_' + codigo);
    t.select();
    try { copiou = document.execCommand('copy'); } catch (e2) { copiou = false; }
  }
  // dizer "Copiado" sem ter copiado faz a pessoa colar no chat o que estava antes
  if (!copiou) {
    msg.style.color = 'var(--farol-fora)';
    msg.textContent = 'Não consegui copiar sozinho. O texto está selecionado: aperte Ctrl+C.';
    return;
  }
  msg.style.color = 'var(--farol-ok)';
  msg.textContent = 'Copiado. Cole no chat do Gestor de Pedidos.';
  // A caixa volta ao modelo: com "12:40" ja digitado o Copiar nao recusaria
  // mais, e o proximo cliente receberia o horario deste.
  const modelo = ATD.respostas.find(r => r.codigo === codigo);
  const caixa = document.getElementById('atdTxt_' + codigo);
  if (modelo && caixa) { caixa.value = modelo.texto; atdAjustar(caixa); }
  // registro de uso: falhar aqui nao pode atrapalhar quem esta atendendo
  try { await trFetch('atd_casos', { method: 'POST', body: JSON.stringify({ tipo: 'USO', codigo }) }); } catch (e) {}
}

async function atdEnviarNovo() {
  const caixa = document.getElementById('atdNovo');
  const msg = document.getElementById('atdNovoMsg');
  const descricao = caixa.value.trim();
  if (descricao.length < 15) {
    msg.style.color = 'var(--farol-fora)';
    msg.textContent = 'Conte um pouco mais: o que o cliente escreveu e o que aconteceu.';
    return;
  }
  msg.style.color = 'var(--tx-3)';
  msg.textContent = 'Enviando...';
  let r = null;
  try { r = await trFetch('atd_casos', { method: 'POST', body: JSON.stringify({ tipo: 'NOVO', descricao }) }); } catch (e) {}
  if (r && r.ok) {
    caixa.value = '';
    msg.style.color = 'var(--farol-ok)';
    msg.textContent = 'Enviado. A resposta padrão para esse caso entra aqui depois da análise.';
  } else {
    msg.style.color = 'var(--farol-fora)';
    msg.textContent = 'Não foi possível enviar. Tente de novo.';
  }
}

// Busca so os dados (sem renderizar o modulo) — usadas pelo gerador de relatorio.
async function entrarNegociacoesSoDados() {
  const rows = await consultarTudo(
    "vw_negociacoes?select=nome_loja,data,turno,motivo,momento,quem_respondeu,impactou_super,valor_cancelamento,valor_pedido,quem_iniciou&order=nome_loja,data"
  );
  NEGOCIACOES = rows.map(r => [
    LOJAS.indexOf(r.nome_loja), r.data, r.turno, r.motivo, r.momento,
    r.quem_respondeu, r.impactou_super,
    Number(r.valor_cancelamento || 0), Number(r.valor_pedido || 0),
    r.quem_iniciou,
  ]);
}

async function entrarAvaliacoesSoDados() {
  const rows = await consultarTudo(
    "vw_avaliacoes?select=nome_loja,data,nota,tags,comentario,id_pedido_curto&order=data.desc,nome_loja,id_pedido_curto,nota,comentario,tags"
  );
  AVALIACOES = rows.map(r => [
    LOJAS.indexOf(r.nome_loja), r.data, r.nota, r.tags || [], r.comentario, r.id_pedido_curto,
  ]);
}

// Criticas marcadas (bloco "O que mais criticam"). Nunca derruba o modulo: se a view ainda
// nao existir ou der erro, fica null e o bloco some (tenta de novo so ao recarregar a pagina).
// A ordem e completa (nenhuma linha empata em todas as colunas) — a leitura em paginas de
// 1.000 nao pula nem repete.
// 06/10/2026 (noite): cols 8, 9 e 10 = pedido_em, avaliado_em e visto_em (data e hora no horario
// de Curitiba; null quando a view ainda nao traz ou nao se sabe). A leitura pede as colunas
// novas; se a view ainda for a antiga (o SQL das datas nao rodou), le do jeito antigo e
// AVAL_CRIT_DATAS fica false — a tela nunca depende da ordem em que painel e banco mudam.
async function carregarCriticasAval() {
  AVAL_CRITICAS_TENTOU = true;
  AVAL_COZ_LIDO = Date.now();   // o relogio do quadro 'Reclamacoes para a cozinha' e a hora desta leitura
  const COLS = "nome_loja,data,nota,criticas,comentario,aguardando_resposta,id_pedido_curto,itens_pedido";
  const ORDEM = "&order=data.desc,nome_loja,id_pedido_curto,nota,avaliada_em,comentario,criticas";
  let rows = null, comDatas = true;
  try {
    rows = await consultarTudo("vw_avaliacoes_criticas?select=" + COLS + ",pedido_em,avaliado_em,visto_em" + ORDEM);
  } catch (e) {
    comDatas = false;
    try {
      rows = await consultarTudo("vw_avaliacoes_criticas?select=" + COLS + ORDEM);
    } catch (e2) {
      rows = null;
      console.warn('Críticas das avaliações indisponíveis — o bloco fica escondido.', e2);
    }
  }
  AVAL_CRIT_DATAS = rows !== null && comDatas;
  AVAL_CRITICAS = rows === null ? null : rows.map(r => [
    LOJAS.indexOf(r.nome_loja), r.data, r.nota, r.criticas || [], r.comentario,
    r.aguardando_resposta === true, r.id_pedido_curto, (r.itens_pedido || []).filter(t => t && String(t).trim()),
    r.pedido_em || null, r.avaliado_em || null, r.visto_em || null,
  ]);
}

// Comparacao entre as unidades: pedidos por semana, uma linha por unidade.
// E o primeiro grafico do painel em que a SERIE e uma entidade (a loja) em vez de uma
// medida ou um status — por isso e o unico que usa a paleta --serie-*.
//
// A cor vem de um mapa por NOME, nunca por indice: cor segue a unidade, entao tirar uma
// do filtro nao repinta as que sobraram (se fosse por posicao, sumir a Agua Verde faria
// o Ahu herdar o azul dela e o grafico mentiria de um clique para o outro).
// A grafia vem do dado como esta em dim_lojas — tres sem acento e "SÃO BRAZ" COM acento;
// e a armadilha registrada no CLAUDE.md, e por isso a chave e copiada, nao digitada.
const SERIE_UNIDADE = {
  'AGUA VERDE': { token: '--serie-1', nome: 'Água Verde' },
  'AHU':        { token: '--serie-2', nome: 'Ahú' },
  'BOQUEIRAO':  { token: '--serie-3', nome: 'Boqueirão' },
  'SÃO BRAZ':   { token: '--serie-4', nome: 'São Braz' },
};

// 'pedidos' mostra o tamanho de cada unidade; 'crescimento' poe todas comecando em 100.
// Os dois respondem perguntas diferentes: a Agua Verde faz ~5x o volume das filiais, entao
// no modo tamanho as tres filiais ficam espremidas na faixa de baixo e a comparacao entre
// elas se perde. Quem quer saber QUEM CRESCEU usa o outro modo — la o tamanho some de
// proposito e sobra so o movimento.
let MODO_UNIDADES = 'pedidos';

function trocarModoUnidades(modo) {
  MODO_UNIDADES = modo;
  ['pedidos', 'crescimento'].forEach(m => {
    const b = document.getElementById('btnUni-' + m);
    if (b) b.classList.toggle('active', m === modo);
  });
  const leg = document.getElementById('legendaUnidades');
  if (leg) leg.textContent = MODO_UNIDADES === 'pedidos' ? CANAL_LEG_UNI_PED : CANAL_LEG_UNI_CRESC;
  renderChartUnidades();
}
// 12/11/2026 (auditoria lote 3, canal-39): uma linha por modo do gráfico de unidades
const CANAL_LEG_UNI_PED = 'Cancelamento total não conta como pedido. Cada unidade tem cor fixa.';
const CANAL_LEG_UNI_CRESC = 'Cada unidade começa em 100: acima cresceu, abaixo caiu.';

function renderChartUnidades() {
  const el = document.getElementById('chartUnidades');
  if (!el) return;
  const activeL = activeLojas();
  let semanas = SEMANAS.slice(-12);                         // ate 12 semanas
  const primeira = SEMANAS.length - semanas.length;
  // A semana EM CURSO fica de fora. Ela tem menos dias que as outras, entao toda linha
  // mergulha no ultimo ponto e o grafico parece anunciar uma queda que e so o calendario
  // — no modo "quem cresceu" o tombo chega a 30 pontos. Mesma regra que o painel ja usa
  // para o mes corrente. O corte e o domingo da ultima semana fechada, nao um palpite.
  const limite = ultimaSemanaCompleta().fim;
  const porUnidade = new Map();
  ROWS.forEach(r => {
    if (r[6] === 1) return;                                 // cancelamento total nao e pedido
    if (!activeL.has(r[0])) return;                         // respeita o filtro de loja/unidade
    if (DATAS[r[5]] > limite) return;                       // semana em curso fica de fora
    const col = r[3] - primeira;
    if (col < 0) return;
    const u = UNIDADES[r[1]];
    if (!porUnidade.has(u)) porUnidade.set(u, new Array(semanas.length).fill(0));
    porUnidade.get(u)[col] += r[7];
  });
  if (!porUnidade.size) { el.closest('.chart-box').style.display = 'none'; return; }

  // Corta as colunas do fim que sobraram vazias por causa do corte acima (a semana em
  // curso, e qualquer outra sem pedido nenhum na ponta).
  let n = semanas.length;
  while (n > 1 && [...porUnidade.values()].every(a => !a[n - 1])) n--;
  if (n < semanas.length) {
    semanas = semanas.slice(0, n);
    porUnidade.forEach((a, u) => porUnidade.set(u, a.slice(0, n)));
  }

  // Ordem fixa da paleta primeiro; unidade que ainda nao esta no mapa entra depois, em
  // cinza. Nao existe 5a cor segura (farol e marca ja ocupam o resto do circulo), entao
  // unidade nova e decisao de quem cuida da paleta, nao sorteio do codigo.
  const conhecidas = Object.keys(SERIE_UNIDADE).filter(u => porUnidade.has(u));
  const novas = [...porUnidade.keys()].filter(u => !SERIE_UNIDADE[u]).sort();
  const datasets = conhecidas.concat(novas).map(u => {
    const s = SERIE_UNIDADE[u];
    const cor = corToken(s ? s.token : '--tx-4');
    let serie = porUnidade.get(u);
    if (MODO_UNIDADES === 'crescimento') {
      // Base = primeira semana COM pedido, nao a primeira da janela: unidade que abriu no
      // meio (ou ficou uma semana fora do ar) dividiria por zero e sumiria do grafico.
      const base = serie.find(v => v > 0);
      serie = base ? serie.map(v => v > 0 ? Math.round(v / base * 1000) / 10 : null) : serie.map(() => null);
    }
    return { label: s ? s.nome : u, data: serie, borderColor: cor, backgroundColor: cor };
  });
  const eixo = MODO_UNIDADES === 'pedidos' ? 'pedidos' : '100 = 1ª semana com pedido';
  renderLineChart('chartUnidades', semanas.map(formatarSemana), datasets, eixo);
}

// Tendencia bruto x liquido no rodape da Visao geral (formula completa, com conciliacao).
function renderChartTendencia() {
  const el = document.getElementById('chartTendencia');
  if (!el) return;
  const dados = computeEvolucaoCompleta(granularidadeAutomatica());
  renderLineChart('chartTendencia', dados.map(d => d.label), [
    { label: 'Bruto', data: dados.map(d => d.bruto), borderColor: corToken('--info'), backgroundColor: corToken('--info') },
    { label: 'Líquido', data: dados.map(d => d.liquido), borderColor: corToken('--info'), backgroundColor: corToken('--info') },
  ], 'R$');
}

// ------------------------------------------------------------------
// MODULOS VENDAS, CARDAPIO E CLIENTES (retratos do Portal de Redes)
// ------------------------------------------------------------------
// Estes tres modulos usam RETRATOS exportados do Portal de Redes (janelas/meses fixos),
// entao NAO seguem o filtro de datas global — cada um tem seu seletor de periodo.
// O recorte de unidades/marcas se aplica normalmente.
let CARDAPIO = null;

let CLIENTES_REDE = null;

async function entrarCardapio() {
  const alvo = document.getElementById('view-cardapio');
  if (CARDAPIO === null) {
    alvo.innerHTML = '<div class="contexto">Carregando cardápio...</div>';
    const [funil, itens, compl] = await Promise.all([
      consultarTudo("vw_cardapio_funil?select=nome_loja,periodo_ini,periodo_fim,visitas,visualizacoes,sacola,revisao,concluidos,conversao_pct&order=periodo_ini.desc"),
      consultarTudo("vw_cardapio_itens?select=periodo_ini,periodo_fim,nome_loja,categoria,item,visitas,pedidos,conversao_pct,qtd_vendida,qtd_com_promocao,valor_total&order=valor_total.desc"),
      consultarTudo("vw_cardapio_complementos?select=periodo_ini,periodo_fim,nome_loja,classificacao,complemento,pedidos,qtd_vendida,valor_total&order=valor_total.desc"),
    ]);
    CARDAPIO = { funil, itens, compl };
  }
  renderModuloCardapio();
}

// UM CONTROLE SO' PARA UMA ESCOLHA SO' (12/09/2026). O <select> "Itens e
// complementos de:" escolhia o recorte de itens a trinta linhas da tabela do funil,
// que mostra as mesmas lojas e nao clicava. Passa a ser UM controle so, e no lugar
// onde a pergunta nasce: clicar na linha da loja no funil troca o recorte de itens e
// complementos. Mecanismo do modulo Evolucao — clicar de novo solta (volta para o
// primeiro escopo, a rede quando ela existe).
// O nome da loja vai por INDICE, nunca como string dentro do onclick.
let CARDAPIO_ESCOPOS = [];

let CARDAPIO_ESCOPO = null;

function cardapioEscopo(chave, i) {
  const nome = CARDAPIO_ESCOPOS[i];
  if (!nome) return;
  renderModuloCardapio(chave, nome === CARDAPIO_ESCOPO ? null : nome);
}

function cardapioEscopoLimpar(chave) { renderModuloCardapio(chave, null); }

function renderModuloCardapio(periodoSel, lojaSel) {
  const alvo = document.getElementById('view-cardapio');
  const periodos = [...new Map(CARDAPIO.funil.map(r => [r.periodo_ini + '|' + r.periodo_fim, [r.periodo_ini, r.periodo_fim]])).values()];
  if (!periodos.length) {
    alvo.innerHTML = `<div class="contexto" style="border-color:#c8102e;">Sem dados de cardápio ainda.</div>`;
    return;
  }
  const chave = periodoSel || periodos[0][0] + '|' + periodos[0][1];
  const [pIni, pFim] = chave.split('|');
  const activeL = activeLojas();

  const funil = CARDAPIO.funil.filter(r => r.periodo_ini === pIni && r.periodo_fim === pFim && activeL.has(LOJAS.indexOf(r.nome_loja)))
    .sort((a, b) => Number(a.conversao_pct) - Number(b.conversao_pct));

  // Itens/complementos: cada export e um recorte — 'REDE' (arquivos agregados,
  // nome_loja nulo) ou uma loja especifica (exports feitos loja a loja).
  const itensPeriodo = CARDAPIO.itens.filter(r => r.periodo_ini === pIni && r.periodo_fim === pFim);
  const complPeriodo = CARDAPIO.compl.filter(r => r.periodo_ini === pIni && r.periodo_fim === pFim);
  const escopos = [...new Set(itensPeriodo.map(r => r.nome_loja || 'REDE'))]
    .sort((a, b) => (a === 'REDE' ? -1 : b === 'REDE' ? 1 : a.localeCompare(b)));
  const escopo = (lojaSel && escopos.includes(lojaSel)) ? lojaSel : escopos[0];
  CARDAPIO_ESCOPOS = escopos; CARDAPIO_ESCOPO = escopo;
  const doEscopo = (r) => (r.nome_loja || 'REDE') === escopo;
  const itensEscopo = itensPeriodo.filter(doEscopo);
  const itens = itensEscopo.slice(0, 12);
  const compl = complPeriodo.filter(doEscopo).slice(0, 8);
  // O <select> saiu (12/09/2026): quem escolhe agora e' a linha da loja na tabela do
  // funil, logo acima. Fica so' o chip que diz qual recorte esta valendo e o ✕ que
  // volta para o primeiro escopo — o mesmo chip do modulo Evolucao.
  // 12/11/2026 (auditoria lote 3, canal-46): a loja escolhida vai no título da tabela de itens; saíram as instruções
  const chipEscopo = (escopos.length > 1 && escopo !== escopos[0]) ? `
    <div style="margin:4px 0 8px;"><button class="preset-btn active" onclick="cardapioEscopoLimpar('${chave}')">${escopo} ✕</button></div>` : '';

  const totV = funil.reduce((s, r) => s + (r.visitas || 0), 0);
  const totC = funil.reduce((s, r) => s + (r.concluidos || 0), 0);
  // Um corte so de conversao na tela (12/09/2026). O card pintava de verde a
  // partir de 20% e a celula da tabela pintava de vermelho abaixo de 15%: dois
  // cortes diferentes para a mesma conta, na mesma tela. Fica o 20% do card,
  // que ja era o que a tela chamava de bom; abaixo dele a loja aparece em
  // vermelho. Nao ha meta de conversao em metas_kpi, entao o numero e um dos
  // dois que ja existiam no arquivo, nao um inventado.
  const CORTE_CONV = 20;

  // MUITO VISTO, POUCO PEDIDO (12/09/2026): a consulta ja trazia `visitas` e
  // `conversao_pct` por item e a tela jogava as duas fora — sobrava so o ranking de
  // quem vende mais, que diz onde esta o dinheiro e nao onde mexer. Aqui entra o
  // contrario: item que aparece ACIMA da media de visitas e e' pedido ABAIXO da
  // media de conversao. As duas medias sao simples (soma / quantidade de itens com
  // visita), calculadas no recorte que esta na tela.
  const convItem = (r) => (r.conversao_pct !== null && r.conversao_pct !== undefined)
    ? Number(r.conversao_pct)
    : (Number(r.visitas) ? Number(r.pedidos || 0) / Number(r.visitas) * 100 : null);
  const comVisita = itensEscopo.filter(r => Number(r.visitas || 0) > 0);
  const mediaVisitas = comVisita.length
    ? comVisita.reduce((s, r) => s + Number(r.visitas || 0), 0) / comVisita.length : 0;
  const mediaConv = comVisita.length
    ? comVisita.reduce((s, r) => s + (convItem(r) || 0), 0) / comVisita.length : 0;
  const muitoVisto = comVisita
    .filter(r => Number(r.visitas) > mediaVisitas && (convItem(r) || 0) < mediaConv)
    .sort((a, b) => (convItem(a) || 0) - (convItem(b) || 0))
    .slice(0, 5);
  const blocoMuitoVisto = muitoVisto.length ? `
  <div class="section-label">Muito visto, pouco pedido</div>
  <div class="caption-label" style="text-align:center;" title="Entre os itens deste recorte com visita registrada: os que aparecem acima da média de ${Math.round(mediaVisitas).toLocaleString('pt-BR')} visitas por item e são pedidos abaixo da média de ${pct(mediaConv)}%, do pior para o melhor. As duas médias são simples: soma dividida pelo número de itens com visita. Em vermelho, conversão abaixo de ${CORTE_CONV}% — o mesmo corte do resto da tela.">
    O cliente chega no item e não leva — é aqui que foto, preço e descrição pagam mais rápido.
  </div>
  <div id="tabelaMuitoVisto">
    <table>
      <tr><th>Item</th><th>Categoria</th><th>Visitas</th><th>Pedidos</th><th title="De quem viu o item, quantos pediram.">Conversão</th><th>Valor total</th></tr>
      ${muitoVisto.map(r => `<tr><td>${r.item}</td><td>${r.categoria || '—'}</td>
        <td>${Number(r.visitas || 0).toLocaleString('pt-BR')}</td>
        <td>${(r.pedidos || 0).toLocaleString('pt-BR')}</td>
        <td${(convItem(r) || 0) < CORTE_CONV ? ' style="color:var(--farol-fora); font-weight:bold;"' : ''}>${pct(convItem(r) || 0)}%</td>
        <td>R$ ${fmt(Number(r.valor_total || 0))}</td></tr>`).join('')}
    </table>
  </div>` : '';

  alvo.innerHTML = `
  <div class="section-label" style="border-top:none; margin-top:0; padding-top:0;">Cardápio — conversão e itens</div>
  <div class="caption-label" style="text-align:center;">
    Retrato do relatório de cardápio do Portal de Redes (seletor de período abaixo — não segue o filtro de datas do topo).
  </div>
  <div class="periodo-presets">
    ${periodos.map(([i, f]) => `<button class="preset-btn ${i === pIni && f === pFim ? 'active' : ''}"
      onclick="renderModuloCardapio('${i}|${f}')">${formatarDataCurta(i)} – ${formatarDataCurta(f)}</button>`).join('')}
  </div>
  <div class="cards">
    <div class="card neutral"><div class="card-lbl">Visitas ao cardápio</div><div class="card-val">${totV.toLocaleString('pt-BR')}</div></div>
    <div class="card neutral"><div class="card-lbl">Pedidos concluídos</div><div class="card-val">${totC.toLocaleString('pt-BR')}</div></div>
    <div class="card ${totV && totC / totV * 100 >= CORTE_CONV ? 'pos' : 'neutral'}"><div class="card-lbl">Conversão</div><div class="card-val">${pct(totV ? totC / totV * 100 : 0)}%</div><div class="card-pct">de quem visita, quantos compram · verde a partir de ${CORTE_CONV}%</div></div>
  </div>

  <div class="section-label">Funil por loja — piores primeiro</div>
  <div class="caption-label" style="text-align:center;">Visita → viu item → sacola → revisou → concluiu.${escopos.length > 1 ? ' <b>Clique na loja para ver os itens dela.</b>' : ''}</div>
  <div id="tabelaFunil">
    <table>
      <tr><th>Loja</th><th>Visitas</th><th title="Quantas vezes alguém abriu a página de um item.">Viu item</th><th>Sacola</th><th title="Quantas vezes alguém chegou na tela de revisar o pedido — o passo antes de concluir.">Revisou</th><th>Concluídos</th><th>Conversão</th></tr>
      ${funil.map(r => { const iE = escopos.indexOf(r.nome_loja); const sel = iE >= 0 && escopo === r.nome_loja;
        const solta = sel && escopo !== escopos[0];
        return `<tr${iE >= 0 ? ` onclick="cardapioEscopo('${chave}', ${iE})" style="cursor:pointer;${sel ? 'background:var(--brand-wine);' : ''}" title="${sel ? (solta ? 'É o recorte que está na tela — clique para voltar ao primeiro escopo.' : 'É o recorte de itens e complementos que está na tela.') : 'Clique para ver os itens e complementos desta loja.'}"` : ' title="Sem export de itens desta loja neste período — o recorte de itens não muda."'}><td>${sel ? '<b>' : ''}${r.nome_loja}${sel ? '</b>' : ''}${solta ? ' ✕' : ''}</td><td>${(r.visitas || 0).toLocaleString('pt-BR')}</td>
        <td>${(r.visualizacoes || 0).toLocaleString('pt-BR')}</td>
        <td>${(r.sacola || 0).toLocaleString('pt-BR')}</td>
        <td>${(r.revisao || 0).toLocaleString('pt-BR')}</td>
        <td>${(r.concluidos || 0).toLocaleString('pt-BR')}</td>
        <td${Number(r.conversao_pct) < CORTE_CONV ? ' style="color:var(--farol-fora); font-weight:bold;"' : ''}>${pct(Number(r.conversao_pct || 0))}%</td></tr>`; }).join('')}
      <tr class="liq"><td>TOTAL</td><td>${totV.toLocaleString('pt-BR')}</td>
        <td>${funil.reduce((s, r) => s + (r.visualizacoes || 0), 0).toLocaleString('pt-BR')}</td>
        <td>${funil.reduce((s, r) => s + (r.sacola || 0), 0).toLocaleString('pt-BR')}</td>
        <td>${funil.reduce((s, r) => s + (r.revisao || 0), 0).toLocaleString('pt-BR')}</td>
        <td>${totC.toLocaleString('pt-BR')}</td><td>${pct(totV ? totC / totV * 100 : 0)}%</td></tr>
    </table>
  </div>

  <div class="section-label">Itens mais vendidos · ${escopo === 'REDE' ? 'rede inteira' : escopo}</div>
  ${chipEscopo}
  <div id="tabelaItens">
    <table>
      <tr><th>Item</th><th>Categoria</th><th>Visitas</th><th>Pedidos</th><th title="De quem viu o item, quantos pediram.">Conversão</th><th>Qtd vendida</th><th>% com promoção</th><th>Valor total</th></tr>
      ${itens.map(r => `<tr><td>${r.item}</td><td>${r.categoria || '—'}</td>
        <td>${Number(r.visitas || 0) ? Number(r.visitas).toLocaleString('pt-BR') : '—'}</td>
        <td>${(r.pedidos || 0).toLocaleString('pt-BR')}</td>
        <td${convItem(r) !== null && convItem(r) < CORTE_CONV ? ' style="color:var(--farol-fora); font-weight:bold;"' : ''}>${convItem(r) === null ? '—' : pct(convItem(r)) + '%'}</td>
        <td>${(r.qtd_vendida || 0).toLocaleString('pt-BR')}</td>
        <td>${pct(r.qtd_vendida ? (r.qtd_com_promocao || 0) / r.qtd_vendida * 100 : 0)}%</td>
        <td>R$ ${fmt(Number(r.valor_total || 0))}</td></tr>`).join('')}
    </table>
  </div>
  ${blocoMuitoVisto}

  <div class="section-label">Complementos mais vendidos</div>
  <div id="tabelaCompl">
    <table>
      <tr><th>Complemento</th><th>Tipo</th><th>Pedidos</th><th>Qtd</th><th>Valor total</th></tr>
      ${compl.map(r => `<tr><td>${r.complemento}</td><td>${r.classificacao || '—'}</td><td>${(r.pedidos || 0).toLocaleString('pt-BR')}</td>
        <td>${(r.qtd_vendida || 0).toLocaleString('pt-BR')}</td><td>R$ ${fmt(Number(r.valor_total || 0))}</td></tr>`).join('')}
    </table>
  </div>`;
}

async function entrarClientes() {
  const alvo = document.getElementById('view-clientes');
  if (CLIENTES_REDE === null) {
    alvo.innerHTML = '<div class="contexto">Carregando clientes...</div>';
    CLIENTES_REDE = await consultarTudo(
      "vw_clientes_rede?select=nome_loja,mes,ativo,tipo_cliente,total_pedidos,valor_vendas,ticket_medio,total_clientes&order=mes.desc,nome_loja"
    );
  }
  renderModuloClientes();
}

function renderModuloClientes(mesSel) {
  const alvo = document.getElementById('view-clientes');
  const meses = [...new Set(CLIENTES_REDE.map(r => r.mes))].sort().reverse();
  if (!meses.length) {
    alvo.innerHTML = `<div class="contexto" style="border-color:#c8102e;">Sem dados de clientes ainda.</div>`;
    return;
  }
  const mes = mesSel || meses[0];
  const activeL = activeLojas();
  const linhas = CLIENTES_REDE.filter(r => r.mes === mes && activeL.has(LOJAS.indexOf(r.nome_loja)));

  const porTipo = new Map();
  linhas.filter(r => r.ativo).forEach(r => {
    if (!porTipo.has(r.tipo_cliente)) porTipo.set(r.tipo_cliente, { cli: 0, ped: 0, vendas: 0 });
    const o = porTipo.get(r.tipo_cliente);
    o.cli += r.total_clientes || 0; o.ped += r.total_pedidos || 0; o.vendas += Number(r.valor_vendas || 0);
  });
  const inativos = linhas.filter(r => !r.ativo).reduce((s, r) => s + (r.total_clientes || 0), 0);
  const ordemTipos = ['Novos', 'Frequentes', 'Recuperados'];

  // Mes anterior, MESMO recorte de lojas — para os selos dos cards e a coluna de
  // comparacao da tabela. "meses" vem do mais recente para o mais antigo, entao o
  // anterior e o proximo indice. Sem mes anterior carregado, aCli fica null e a
  // comparacao nao aparece.
  const mesAnt = meses[meses.indexOf(mes) + 1] || null;
  const agregarClientes = (m2) => {
    const ls = CLIENTES_REDE.filter(r => r.mes === m2 && activeL.has(LOJAS.indexOf(r.nome_loja)));
    const tipos = new Map(), lojasM = new Map();
    ls.filter(r => r.ativo).forEach(r => {
      tipos.set(r.tipo_cliente, (tipos.get(r.tipo_cliente) || 0) + (r.total_clientes || 0));
      const i = LOJAS.indexOf(r.nome_loja);
      lojasM.set(i, (lojasM.get(i) || 0) + (r.total_clientes || 0));
    });
    return { tipos, lojasM,
      inativos: ls.filter(r => !r.ativo).reduce((s, r) => s + (r.total_clientes || 0), 0) };
  };
  const aCli = mesAnt ? agregarClientes(mesAnt) : null;

  const porLoja = new Map();
  linhas.filter(r => r.ativo).forEach(r => {
    const i = LOJAS.indexOf(r.nome_loja);
    if (!porLoja.has(i)) porLoja.set(i, { Novos: 0, Frequentes: 0, Recuperados: 0 });
    porLoja.get(i)[r.tipo_cliente] = (porLoja.get(i)[r.tipo_cliente] || 0) + (r.total_clientes || 0);
  });
  // Frequentes por novo = quantos clientes frequentes a loja tem para cada cliente novo
  // do MESMO mes. E o que o rodape generico dizia em palavras e ninguem conseguia
  // comparar entre lojas; agora e coluna e e a ordem da tabela. Nao e taxa de conversao:
  // sao duas fotos do mesmo mes, ninguem persegue o cliente novo ate ele virar frequente.
  // Sem cliente novo nao ha divisao possivel: fica "—" e cai para o fim da lista, em vez
  // de virar um numero inventado.
  const lojas = [...porLoja.entries()].map(([i, o]) => {
    const total = (o.Novos || 0) + (o.Frequentes || 0) + (o.Recuperados || 0);
    return { nome: LOJAS[i], ...o, total,
      ret: (o.Novos || 0) > 0 ? (o.Frequentes || 0) / o.Novos : null,
      totalAnt: aCli ? (aCli.lojasM.has(i) ? aCli.lojasM.get(i) : 0) : null };
  }).sort((a, b) => {
    if (a.ret === null && b.ret === null) return b.total - a.total;
    if (a.ret === null) return 1;
    if (b.ret === null) return -1;
    return a.ret - b.ret || b.total - a.total;
  });

  const rotuloMes = (() => { const [a, m2] = mes.split('-'); return `${MESES_ABREV[Number(m2) - 1]}/${a}`; })();

  alvo.innerHTML = `
  <div class="section-label" style="border-top:none; margin-top:0; padding-top:0;">Clientes — canal iFood</div>
  <div class="caption-label" style="text-align:center;">
    Retrato mensal do Portal de Redes (seletor abaixo — não segue o filtro de datas do topo).
    <b>Novo</b> = primeiro pedido no mês · <b>Frequente</b> = mais de um pedido · <b>Recuperado</b> = voltou após 30+ dias sem comprar.
  </div>
  <div class="periodo-presets">
    ${meses.map(m2 => { const [a2, mm] = m2.split('-'); return `<button class="preset-btn ${m2 === mes ? 'active' : ''}"
      onclick="renderModuloClientes('${m2}')">${MESES_ABREV[Number(mm) - 1]}/${a2}</button>`; }).join('')}
  </div>
  <div class="cards">
    ${ordemTipos.map(t => { const o = porTipo.get(t) || { cli: 0, ped: 0, vendas: 0 };
      // Ticket medio do tipo = vendas DO TIPO divididas por pedidos DO TIPO, somados
      // antes de dividir. Nunca a media dos ticket_medio das linhas: media de media
      // pesa loja pequena igual a loja grande.
      const tk = o.ped ? o.vendas / o.ped : 0; return `
      <div class="card ${t === 'Novos' ? 'pos' : 'neutral'}"><div class="card-lbl">${t}</div>
      <div class="card-val">${o.cli.toLocaleString('pt-BR')}</div>
      <div class="card-pct">${o.ped.toLocaleString('pt-BR')} pedidos · R$ ${fmt(o.vendas)}</div>
      <div class="card-delta" title="Ticket médio deste tipo no mês selecionado: R$ ${fmt(o.vendas)} de vendas divididos pelos ${o.ped.toLocaleString('pt-BR')} pedidos do tipo.">ticket R$ ${fmt(tk)}</div></div>`; }).join('')}
    <div class="card neg"><div class="card-lbl">Inativos (30+ dias sem pedir)</div><div class="card-val">${inativos.toLocaleString('pt-BR')}</div><div class="card-pct">base parada — alvo de reativação</div></div>
  </div>

  <div class="section-label">Por loja (${rotuloMes}) — menos frequentes por novo primeiro</div>
  <div id="tabelaClientesLojas">
    <table>
      <tr><th>Loja</th><th>Novos</th><th>Frequentes</th><th>Recuperados</th><th>Total ativos</th><th title="Quantos clientes frequentes a loja tem para cada cliente novo do mês. Loja com muitos novos e poucos frequentes conquista mas não retém; o contrário indica base fiel com pouca atração.">Frequentes por novo</th><th title="Total de clientes ativos contra o mês anterior, no mesmo recorte de lojas.">vs mês anterior</th></tr>
      ${lojas.map(x => `<tr><td>${x.nome}</td><td>${x.Novos || 0}</td><td>${x.Frequentes || 0}</td>
        <td>${x.Recuperados || 0}</td><td><b>${x.total}</b></td>
        <td>${x.ret === null ? '<span style="color:var(--tx-5);">—</span>' : x.ret.toFixed(1).replace('.', ',')}</td>
        <td>${variacaoSpan(x.total, x.totalAnt)}</td></tr>`).join('')}
      ${(() => { const t = lojas.reduce((a, x) => ({ n: a.n + (x.Novos || 0), f: a.f + (x.Frequentes || 0),
          r: a.r + (x.Recuperados || 0), tot: a.tot + (x.total || 0) }), { n: 0, f: 0, r: 0, tot: 0 });
        const totAnt = aCli ? [...aCli.lojasM.values()].reduce((s, v) => s + v, 0) : null;
        return `<tr class="liq"><td>TOTAL</td><td>${t.n.toLocaleString('pt-BR')}</td><td>${t.f.toLocaleString('pt-BR')}</td>
          <td>${t.r.toLocaleString('pt-BR')}</td><td><b>${t.tot.toLocaleString('pt-BR')}</b></td>
          <td>${t.n ? (t.f / t.n).toFixed(1).replace('.', ',') : '—'}</td>
          <td>${variacaoSpan(t.tot, totAnt)}</td></tr>`; })()}
    </table>
  </div>
  `;
}

// Farol de meta para cards FORA do modulo Indicadores (12/08/2026).
// So vale para indicadores de TAXA/RAZAO (%, R$/pedido, "x") — que significam
// o mesmo em qualquer recorte de periodo. Meta ABSOLUTA (liquido, pedidos) e
// semanal: pintar um recorte de 30 dias com ela seria comparar coisas
// diferentes, por isso esses cards ficam sem farol de proposito.
// Tambem substituiu os limiares improvisados que existiam nos cards
// (nota >= 4,6; ruins > 5%; alavancagem >= 1) — a meta oficial e uma so.
function cardFarol(chave, valor) {
  const k = (METAS_KPI || []).find(m => m.chave === chave);
  if (!k || valor === null || valor === undefined || isNaN(valor)) return '';
  const [cor, rotulo] = farolKpi(k, valor);
  const alvo = fmtKpi(k.unidade, Number(k.meta)) +
    (k.meta2 !== null && k.meta2 !== undefined && k.meta2 !== '' ? ' a ' + fmtKpi(k.unidade, Number(k.meta2)) : '');
  const sent = k.sentido === 'abaixo' ? 'até ' : k.sentido === 'acima' ? 'mínimo ' : '';
  return ' style="border:1px solid ' + cor + ';" title="Meta semanal: ' + sent + alvo + ' — ' + rotulo + '"';
}

// 26/10/2026: tela de Pessoas movida para docs/pessoas/pessoas.js (bloco 4 do painel em módulos).
// ------------------------------------------------------------------
// MODULO FRETE POR DISTANCIA (aplicado da fila em 16/08/2026).
// A media geral esconde o que decide: o cliente distante tem o MAIOR
// ticket. Por isso a tabela mostra ticket ao lado de custo e cobrado.
// Fonte: vw_frete_faixa_canal — desde 12/09/2026 ela traz DATA e as tres lojas
// (era so Agua Verde e sem periodo), e o filtro de unidade do topo vale aqui.
let FRETE = null;

async function entrarFrete() {
  const alvo = document.getElementById('view-frete');
  if (!alvo) return;
  if (FRETE === null) {
    alvo.innerHTML = '<div class="contexto">Carregando o frete por distância...</div>';
    // A view passou a devolver uma linha por canal x faixa x DIA, com SOMAS
    // (12/09/2026). Media de media nao e media — com soma e contagem, qualquer
    // janela fecha certo no navegador.
    FRETE = await consultarTudo('vw_frete_faixa_canal?select=*&order=canal,faixa,data');
  }
  renderModuloFrete(FRETE);
}

// Janela do modulo de frete. Era a UNICA tela de dado do painel sem periodo:
// somava tudo desde fevereiro e nao reagia a mudanca na tabela de frete.
// Decisao do dono em 12/09/2026: abrir nas ultimas 4 semanas, com seletor.
// Medido antes: a escolha muda pouco o numero (acima de 3 km a sobra por entrega
// vai de R$ 2,58 somando tudo a R$ 2,38 em 30 dias) — o que muda e o tempo de
// reacao a uma mudanca de tabela.
const FRETE_JANELAS = [[28, 'Últimas 4 semanas'], [90, '90 dias'], [180, '6 meses'], [0, 'Tudo']];

let FRETE_JANELA = 28;

function freteJanela(n) { FRETE_JANELA = n; renderModuloFrete(FRETE); }

function renderModuloFrete(linhas) {
  const alvo = document.getElementById('view-frete');
  if (!alvo || !linhas) return;
  const reais = (v) => 'R$ ' + Number(v).toLocaleString('pt-BR', { minimumFractionDigits:2, maximumFractionDigits:2 });
  const ddmm = (v) => v ? v.slice(8, 10) + '/' + v.slice(5, 7) : '—';

  const todasDatas = linhas.map(l => l.data).filter(Boolean).sort();
  const maxData = todasDatas[todasDatas.length - 1] || null;
  let corte = null;
  if (FRETE_JANELA > 0 && maxData) {
    const d = new Date(maxData + 'T12:00:00'); d.setDate(d.getDate() - (FRETE_JANELA - 1));
    corte = d.toISOString().slice(0, 10);
  }
  // O filtro de unidade do topo vale aqui: a view traz as tres lojas.
  const dentro = linhas.filter(l => (!corte || l.data >= corte)
    && (!activeUnidades.size || activeUnidades.has(l.unidade)));
  const unsComDado = [...new Set(dentro.map(l => l.unidade))].sort();
  const UN_ROT = { 'AGUA VERDE': 'Água Verde', 'AHU': 'Ahú', 'SÃO BRAZ': 'São Braz', 'BOQUEIRAO': 'Boqueirão' };

  // Agrega por canal x faixa somando; a media sai da divisao no fim.
  const por = {};
  dentro.forEach(l => {
    const k = l.canal + '|' + l.faixa;
    const o = por[k] || (por[k] = { canal: l.canal, faixa: l.faixa, entregas: 0, custo: 0, frete: 0, ticket: 0, res: 0 });
    o.entregas += Number(l.entregas) || 0;
    o.custo += Number(l.soma_custo) || 0;
    o.frete += Number(l.soma_frete) || 0;
    o.ticket += Number(l.soma_ticket) || 0;
    o.res += Number(l.resultado_total) || 0;
  });
  const agregado = Object.values(por);
  const canais = [...new Set(agregado.map(l => l.canal))].sort();

  // QUATRO CARDS NO TOPO (12/09/2026). A tela abria direto nas tabelas por canal, e
  // a pergunta do dono — "quanto a loja bancou de frete no periodo?" — so era
  // respondida somando as tabelas na cabeca. Os numeros saem do MESMO agregado que
  // as tabelas usam, entao card e tabela nao tem como divergir. A faixa que mais
  // custa e a que mais sobra sao em R$ do periodo (e nao por entrega), que e o que
  // decide onde mexer; o valor por entrega vai junto, embaixo.
  const entregasPeriodo = agregado.reduce((a, l) => a + l.entregas, 0);
  const resultadoGeral = agregado.reduce((a, l) => a + l.res, 0);
  const porFaixa = new Map();
  agregado.forEach(l => {
    if (!porFaixa.has(l.faixa)) porFaixa.set(l.faixa, { faixa: l.faixa, entregas: 0, res: 0 });
    const o = porFaixa.get(l.faixa);
    o.entregas += l.entregas; o.res += l.res;
  });
  const faixasResumo = [...porFaixa.values()].sort((a, b) => a.res - b.res);
  const piorFaixa = (faixasResumo.length && faixasResumo[0].res < 0) ? faixasResumo[0] : null;
  const melhorFaixa = (faixasResumo.length && faixasResumo[faixasResumo.length - 1].res > 0)
    ? faixasResumo[faixasResumo.length - 1] : null;
  const porEntrega = (f) => f.entregas ? reais(Math.abs(f.res) / f.entregas) + ' por entrega' : 'sem entrega na faixa';
  const cardsFrete = `
  <div class="cards">
    <div class="card neutral"><div class="card-lbl">Entregas no período</div>
      <div class="card-val">${entregasPeriodo.toLocaleString('pt-BR')}</div>
      <div class="card-pct">em ${canais.length} canal(is) e ${faixasResumo.length} faixa(s) de distância</div></div>
    <div class="card ${resultadoGeral < 0 ? 'neg' : 'pos'}">
      <div class="card-lbl">${resultadoGeral < 0 ? 'A loja bancou' : 'O frete sobrou'} (frete cobrado − corridas, sem promoção)</div>
      <div class="card-val">${reais(Math.abs(resultadoGeral))}</div>
      <div class="card-pct">todos os canais e faixas</div></div>
    <div class="card ${piorFaixa ? 'neg' : 'neutral'}"><div class="card-lbl">Faixa que mais custa</div>
      <div class="card-val">${piorFaixa ? piorFaixa.faixa : '—'}</div>
      <div class="card-pct">${piorFaixa ? `${reais(Math.abs(piorFaixa.res))} bancados em ${piorFaixa.entregas.toLocaleString('pt-BR')} entregas · ${porEntrega(piorFaixa)}` : 'nenhuma faixa ficou no vermelho no período'}</div></div>
    <div class="card ${melhorFaixa ? 'pos' : 'neutral'}"><div class="card-lbl">Faixa que mais sobra</div>
      <div class="card-val">${melhorFaixa ? melhorFaixa.faixa : '—'}</div>
      <div class="card-pct">${melhorFaixa ? `${reais(melhorFaixa.res)} de sobra em ${melhorFaixa.entregas.toLocaleString('pt-BR')} entregas · ${porEntrega(melhorFaixa)}` : 'nenhuma faixa se pagou no período'}</div></div>
  </div>`;

  const seletor = '<div class="periodo-presets" style="margin-top:10px;">'
    + FRETE_JANELAS.map(([n, rot]) => `<button class="preset-btn ${FRETE_JANELA === n ? 'active' : ''}" onclick="freteJanela(${n})">${rot}</button>`).join('')
    + '</div>';

  const tabela = (canal, idx) => {
    const ls = agregado.filter(l => l.canal === canal)
      .sort((a, b) => a.faixa < b.faixa ? -1 : 1);
    const totalEntregas = ls.reduce((a, l) => a + l.entregas, 0);
    const resultado = ls.reduce((a, l) => a + l.res, 0);
    const md = (o, c) => o.entregas ? o[c] / o.entregas : 0;
    const corpo = ls.map(l => {
      const r = l.entregas ? l.res / l.entregas : 0;
      // a cor diz se a loja banca (vermelho) ou o frete se paga (verde) —
      // fato separado da interpretacao, regra da casa
      const cor = r < 0 ? 'var(--farol-fora)' : 'var(--farol-ok)';
      // faixa com pouca entrega oscila muito: avisa em vez de deixar o leitor concluir
      const poucas = l.entregas < 30;
      return `<tr>
        <td>${l.faixa}${poucas ? '<span class="dre-av">poucas entregas</span>' : ''}</td>
        <td>${l.entregas.toLocaleString('pt-BR')}</td>
        <td>${reais(md(l, 'custo'))}</td>
        <td>${reais(md(l, 'frete'))}</td>
        <td><b>${reais(md(l, 'ticket'))}</b></td>
        <td style="color:${poucas ? '#8a897e' : cor}; font-weight:600;">${reais(r)}</td>
      </tr>`;
    }).join('');
    const pond = (c) => totalEntregas ? ls.reduce((a, l) => a + l[c], 0) / totalEntregas : 0;
    return `
      <div class="section-label">${canal}</div>
      <div class="caption-label" style="text-align:center;">
        ${totalEntregas.toLocaleString('pt-BR')} entregas · a loja ${resultado < 0 ? 'banca' : 'ganha'}
        <b>${reais(Math.abs(resultado))}</b> de frete no período.
      </div>
      <div id="tabelaFreteCanal${idx}"><table>
        <tr><th>Distância</th><th>Entregas</th><th>Custo do entregador</th><th>Frete cobrado</th><th>Ticket</th><th>Sobra / falta por entrega</th></tr>
        ${corpo}
        <tr class="liq"><td>TOTAL</td><td>${totalEntregas.toLocaleString('pt-BR')}</td>
          <td>${reais(pond('custo'))}</td><td>${reais(pond('frete'))}</td>
          <td>${reais(pond('ticket'))}</td>
          <td style="color:${resultado < 0 ? 'var(--farol-fora)' : 'var(--farol-ok)'}; font-weight:700;">${reais(resultado)}<span class="dre-av">no período</span></td></tr>
      </table></div>`;
  };

  // ---------- matriz canal x faixa (12/09/2026) ----------
  // Comparar iFood e site na MESMA faixa exigia pular entre tabelas separadas e
  // guardar o numero na cabeca. A celula e a sobra/falta POR ENTREGA — o numero que
  // decide — com as entregas do cruzamento embaixo. Menos de 30 entregas fica em
  // cinza, a mesma regra de "poucas entregas" das tabelas por canal logo abaixo.
  // Sem clique: o modulo Frete nao tem estado de filtro proprio, e clique que nao
  // filtra nada e pior do que clique nenhum.
  const faixasMatriz = [...new Set(agregado.map(l => l.faixa))].sort();
  const corFrete = (r, n) => n < 30 ? 'var(--tx-3)' : r < 0 ? 'var(--farol-fora)' : 'var(--farol-ok)';
  const celFrete = (c, f) => {
    const o = agregado.find(l => l.canal === c && l.faixa === f);
    if (!o || !o.entregas) return '<td>—</td>';
    const r = o.res / o.entregas;
    return `<td title="${o.entregas.toLocaleString('pt-BR')} entregas · no período a loja ${r < 0 ? 'banca' : 'ganha'} ${reais(Math.abs(o.res))} nesta faixa deste canal"><span style="color:${corFrete(r, o.entregas)}; font-weight:600;">${reais(r)}</span><span class="dre-av">${o.entregas.toLocaleString('pt-BR')} entregas</span></td>`;
  };
  const somaFrete = (ls) => {
    const n = ls.reduce((a, l) => a + l.entregas, 0);
    const res = ls.reduce((a, l) => a + l.res, 0);
    return { n, r: n ? res / n : 0 };
  };
  const celTotFrete = (ls, forte) => {
    const t = somaFrete(ls);
    const txt = forte ? `<b>${reais(t.r)}</b>` : reais(t.r);
    return `<td><span style="color:${corFrete(t.r, t.n)}; font-weight:600;">${txt}</span><span class="dre-av">${t.n.toLocaleString('pt-BR')} entregas</span></td>`;
  };
  const matrizFrete = canais.length > 1 ? `
    <div class="section-label">Quanto sobra por entrega — canal por faixa de distância</div>
    <div class="caption-label" style="text-align:center;" title="Sobra/falta por entrega = frete cobrado menos custo do entregador, dividido pelas entregas daquele cruzamento. Faixa com menos de 30 entregas fica em cinza: o número existe, mas oscila demais para decidir em cima dele. As tabelas por canal, logo abaixo, trazem o detalhe de custo do entregador, frete cobrado e ticket de cada faixa.">Quanto sobra (ou falta) em cada entrega. <b>Vermelho = a loja está bancando; verde = o frete se paga.</b></div>
    <div id="tabelaFreteMatriz"><table>
      <tr><th>Distância</th>${canais.map(c => `<th>${c}</th>`).join('')}<th>Todos os canais</th></tr>
      ${faixasMatriz.map(f => `<tr><td>${f}</td>${canais.map(c => celFrete(c, f)).join('')}${celTotFrete(agregado.filter(l => l.faixa === f), true)}</tr>`).join('')}
      <tr class="liq"><td>TODAS AS FAIXAS</td>${canais.map(c => celTotFrete(agregado.filter(l => l.canal === c))).join('')}${celTotFrete(agregado, true)}</tr>
    </table></div>` : '';

  const rotJanela = FRETE_JANELA === 0
    ? (todasDatas.length ? `tudo, de ${ddmm(todasDatas[0])} a ${ddmm(maxData)}` : 'tudo')
    : `${ddmm(corte)} a ${ddmm(maxData)}`;

  alvo.innerHTML = `
    <div class="section-label" style="border-top:none; margin-top:0; padding-top:0;">Frete por distância — ${rotJanela}</div>
    <div class="caption-label" style="text-align:center;">
      <b>Vermelho = a loja está bancando; verde = o frete se paga.</b>
      ${unsComDado.length ? `<span style="font-size:11.5px; color:var(--tx-3); border:1px solid #34332f; border-radius:12px; padding:3px 10px; margin-left:6px;">${unsComDado.map(u => UN_ROT[u] || u).join(', ')}</span>` : ''}
    </div>
    ${seletor}
    ${agregado.length ? cardsFrete : ''}
    ${agregado.length ? matrizFrete : ''}
    ${agregado.length ? canais.map((c, i) => tabela(c, i)).join('')
      : '<div class="contexto" style="border-color:var(--farol-perto);">Sem entrega nesta janela e nestas unidades.</div>'}
    <div class="caption-label" title="As entregas vêm do TrackEat (Água Verde, Ahú e São Braz).">Faixa com menos de 30 entregas fica em cinza.</div>`;
}

// 26/10/2026: tela de Custo e cardápio movida para docs/cardapio/cardapio.js (bloco 5 do painel em módulos).
let SITE = null;

let SITE_JANELA = 90;      // dias; 90 e a janela que a agencia costuma pedir

// UMA MEDIDA POR VEZ no grafico de semanas (12/09/2026). Ele desenhava pedidos,
// clientes novos e ticket medio juntos, e o ticket so cabia num segundo eixo a
// direita — leitura que precisa de legenda, e a regra da casa e nunca dois eixos Y.
// Mecanismo copiado do modulo evolucao (EVOL_MEDIDA + seletor de botoes).
let SITE_MEDIDA = 'pedidos';   // 'pedidos' | 'fat' | 'ticket' | 'novos'

const SITE_MEDIDAS = [
  ['pedidos', 'Pedidos'], ['fat', 'Faturamento'],
  ['ticket', 'Ticket médio'], ['novos', 'Clientes novos'],
];

// Guarda o ultimo recorte desenhado, para o CSV e o resumo sairem exatamente
// iguais ao que esta na tela — relatorio que discorda da tela vira discussao.
let SITE_ULTIMO = null;
let SITE_TUDO = false;
let SITE_CLI_ABERTO = false;   // o bloco "Clientes e campanhas" continua aberto ao redesenhar     // 12/11/2026 (usabilidade, site): "ver todas" nos cupons e nas campanhas, em vez do corte calado
// 12/11/2026 (usabilidade, site): o tipo da UTM em palavra de operador (o valor cru do link fica no title)
const SITE_TIPO_UTM = { paid: 'pago', cpc: 'pago', ppc: 'pago', referral: 'link', organic: 'orgânico', social: 'rede social', email: 'e-mail', none: 'direto', '(none)': 'direto' };

async function entrarSite() {
  const alvo = document.getElementById('view-site');
  if (!alvo) return;
  if (SITE === null) {
    alvo.innerHTML = '<div class="contexto">Carregando o site próprio...</div>';
    const [vendas, atualizacao, cliente, cupom, recencia, coorte, segmentos, atribuicao] = await Promise.all([
      consultarTudo('vw_site_vendas_dia?select=*&order=data'),
      consultarTudo('vw_site_atualizacao?select=*'),
      consultarTudo('vw_crm_site_dia?select=*&order=data'),
      consultarTudo('vw_crm_site_cupom?select=*&order=mes.desc'),
      consultarTudo('vw_crm_recencia?select=*&order=ordem'),
      consultarTudo('vw_crm_coorte_novos?select=*&order=mes.desc'),
      consultarTudo('vw_crm_segmentos?select=*'),
      consultarTudo('vw_crm_atribuicao?select=*&order=clientes.desc'),
    ]);
    SITE = { vendas, atualizacao, cliente, cupom, recencia, coorte, segmentos, atribuicao };
  }
  renderModuloSite();
}

function siteJanela(n) { SITE_JANELA = n; renderModuloSite(); }

function siteMedida(m) { SITE_MEDIDA = m; renderModuloSite(); }

// RECORTE DA TELA DO SITE (12/09/2026) — mesmo mecanismo do modulo Evolucao.
// A tela respondia "o site cresceu?" e nao "o site do Ahu cresceu, ou e a Agua
// Verde puxando?". Clicar numa linha de loja ou de tipo de entrega fixa a dimensao
// e os cartoes, o grafico, a tabela de semanas, o CSV e o resumo andam junto.
// Regra do cross-filter: a dimensao fixada continua listando TODAS as suas opcoes
// (senao nao da para trocar de escolha); as outras se recortam.
// Coorte, recencia, segmentos, cupom e UTM ficam DE FORA de proposito: as quatro
// primeiras sao da rede inteira (uma pessoa = um telefone, em qualquer loja), e o
// cupom vem por mes fechado — recortar ali seria inventar dado.
let SITE_F = { loja: null, canal: null };

function siteFiltrar(tipo, valor) {
  SITE_F[tipo] = (SITE_F[tipo] === valor) ? null : valor;   // clicar de novo solta
  renderModuloSite();
}

function siteLimparFiltros() { SITE_F = { loja: null, canal: null }; renderModuloSite(); }

// Hoje em Sao Paulo. O banco roda em UTC e o navegador pode estar em outro
// fuso — data no palpite ja custou um dia de erro em outros modulos.
function siteISO(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function siteHojeSP() {
  return new Date(new Date().toLocaleString('en-US', { timeZone: 'America/Sao_Paulo' }));
}

function siteHojeISO() { return siteISO(siteHojeSP()); }

function siteISOMenos(dias) {
  const d = siteHojeSP();
  d.setDate(d.getDate() - dias);
  return siteISO(d);
}

function siteDias(deISO, ateISO) {
  return Math.round((new Date(ateISO + 'T00:00:00') - new Date(deISO + 'T00:00:00')) / 86400000);
}

// Segunda-feira da semana daquela data — mesma semana comercial do resto do painel.
function siteSemana(dataISO) {
  const d = new Date(dataISO + 'T00:00:00');
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
  return siteISO(d);
}

// O iFood no MESMO periodo e nas MESMAS unidades, direto de ROWS (ja esta na
// memoria desde a abertura do painel). Responde uma pergunta so: quanto vale,
// em venda, o pedido que migra de la para ca.
function siteIfoodNoPeriodo(iniISO, fimISO, lojaF) {
  let pedidos = 0, bruto = 0;
  ROWS.forEach(r => {
    if (r[6] === 1) return;                       // cancelamento total fora
    const data = DATAS[r[5]];
    if (data < iniISO || data > fimISO) return;
    if (!activeUnidades.has(UNIDADES[r[1]])) return;
    if (lojaF && UNIDADES[r[1]] !== lojaF) return;   // segue o recorte de loja da tela
    pedidos += r[7];
    bruto += (r[8] - r[9]) + r[10];
  });
  return { pedidos, bruto, ticket: pedidos ? bruto / pedidos : 0 };
}

function siteBarraPeriodo() {
  const op = [[30, '30 dias'], [90, '90 dias'], [180, '6 meses'], [365, '12 meses']];
  return `<div class="periodo-presets">
    <span style="font-size:12px; color:var(--tx-3); margin-right:4px;">Período do site:</span>
    ${op.map(([d, r]) => `<button class="preset-btn ${SITE_JANELA === d ? 'active' : ''}" onclick="siteJanela(${d})">${r}</button>`).join('')}
  </div>`;
}

function renderModuloSite() {
  const alvo = document.getElementById('view-site');
  if (!alvo || !SITE) return;
  const reais = (v) => 'R$ ' + fmt(Number(v || 0));
  const ddmm = (iso) => iso ? iso.slice(8, 10) + '/' + iso.slice(5, 7) : '—';
  const num = (v) => Number(v || 0).toLocaleString('pt-BR');
  const soma = (ls, c) => ls.reduce((a, r) => a + Number(r[c] || 0), 0);

  const fimISO = siteHojeISO();
  const iniISO = siteISOMenos(SITE_JANELA);
  const naJanela = (r) => activeUnidades.has(r.loja) && r.data >= iniISO && r.data <= fimISO;
  const vendas = SITE.vendas.filter(naJanela);
  const cli = SITE.cliente.filter(naJanela);
  // recorte da tela. Escolha que sumiu da janela ou do filtro de unidades do topo
  // cai sozinha, em vez de deixar a tela zerada sem dizer por que.
  if (SITE_F.loja && !vendas.some(v => v.loja === SITE_F.loja)) SITE_F.loja = null;
  if (SITE_F.canal && !vendas.some(v => v.canal === SITE_F.canal)) SITE_F.canal = null;
  // quem passa 'ignora' esta desenhando a propria dimensao e ve todas as categorias
  const passaSF = (r, ignora) => (ignora === 'loja' || !SITE_F.loja || r.loja === SITE_F.loja)
    && (ignora === 'canal' || !SITE_F.canal || r.canal === SITE_F.canal);
  const vendasF = vendas.filter(r => passaSF(r));
  const cliF = cli.filter(r => passaSF(r));

  // ---------- as duas datas de corte, e o aviso quando uma atrasa ----------
  const ativas = SITE.atualizacao.filter(a => activeUnidades.has(a.loja));
  const corte = (oQue) => {
    const ls = ativas.filter(a => a.o_que === oQue);
    return ls.length ? ls.map(a => a.ate).sort()[0] : null;   // a mais atrasada manda
  };
  const corteVenda = corte('venda');
  const corteCliente = corte('cliente');
  // 15/10/2026: cupom e UTM so existem na Accon; nas 3 lojas proprias param no
  // ultimo export manual. Data propria, para nao fingir que o cupom esta em dia.
  const corteCupom = corte('cupom') || corteCliente;
  const atrasadas = (oQue) => ativas.filter(a => a.o_que === oQue && siteDias(a.ate, fimISO) > 2)
    .sort((a, b) => a.ate < b.ate ? -1 : 1);
  const vendaAtrasada = atrasadas('venda');
  const clienteAtrasado = atrasadas('cliente');

  // 12/09/2026 (auditoria): esta tela dava DOIS avisos que se contradiziam —
  // "a venda do site está atrasada" e, tres linhas abaixo, "a venda está em dia".
  // Causa: `ate` da fonte saipos era a data do ULTIMO PEDIDO PELO SITE, entao
  // loja sem pedido no site por tres dias virava "importacao atrasada". A view
  // passou a separar as duas datas (ate = fronteira da importacao;
  // ultima_venda_canal = ultimo pedido pelo site) e aqui cada uma diz o que e.
  const avisoVenda = vendaAtrasada.length ? `
    <div class="contexto" style="border-color:var(--farol-fora); margin-bottom:10px;">
      <b>A importação da venda está atrasada — não mande relatório antes de conferir.</b><br>
      ${vendaAtrasada.map(a => `${a.loja}: até <b>${ddmm(a.ate)}</b> (${siteDias(a.ate, fimISO)} dias atrás, fonte ${a.fonte})`).join(' · ')}<br>
      <span style="font-size:12px; color:var(--tx-3);">Onde a fonte é o Saipos, o problema é a importação diária das APIs (08:00). Onde é a Accon, é o cookie do portal.</span>
    </div>` : '';
  // Loja que esta em dia na importacao mas passou dias sem pedido pelo site: e
  // fato do negocio, nao falha de fonte. Fica como nota, nao como alerta.
  const semPedido = ativas.filter(a => a.o_que === 'venda' && a.fonte === 'saipos'
      && a.ultima_venda_canal && siteDias(a.ultima_venda_canal, a.ate) >= 2
      && !vendaAtrasada.some(v => v.loja === a.loja))
    .sort((a, b) => a.ultima_venda_canal < b.ultima_venda_canal ? -1 : 1);
  const notaSemPedido = semPedido.length ? `
    <div class="contexto" style="margin-bottom:10px;">
      <b>Importação em dia; o que faltou foi pedido.</b>
      ${semPedido.map(a => `${a.loja}: último pedido pelo site em <b>${ddmm(a.ultima_venda_canal)}</b>, com o Saipos já trazido até ${ddmm(a.ate)}`).join(' · ')}.<br>
      <span style="font-size:12px; color:var(--tx-3);">Nenhuma venda foi perdida — a loja vendeu nos outros canais nesses dias e no site não entrou pedido.</span>
    </div>` : '';
  const avisoCliente = clienteAtrasado.length ? `
    <div class="contexto" style="border-color:var(--farol-perto); margin-bottom:10px;">
      <b>O dado de cliente envelheceu.</b>
      Novos, quem voltou e recência vão até <b>${ddmm(corteCliente)}</b> —
      ${clienteAtrasado.map(a => `${a.loja} ${ddmm(a.ate)} (${a.fonte === 'saipos' ? 'Saipos' : 'Accon'})`).join(' · ')}.<br>
      <span style="font-size:12px; color:var(--tx-3);">${clienteAtrasado.some(a => a.fonte === 'accon')
        ? 'No Boqueirão o cliente ainda vem do portal da Accon: é o cookie dele, que o dono renova (o login tem CAPTCHA). '
        : ''}${clienteAtrasado.some(a => a.fonte === 'saipos')
        ? 'Nas lojas do Saipos o cliente chega junto com a venda, pela importação diária das APIs (08:00) — atraso aqui é falha dela.'
        : ''}</span>
    </div>` : '';

  if (!vendas.length) {
    alvo.innerHTML = `
      <div class="section-label" style="border-top:none; margin-top:0; padding-top:0;">Site próprio</div>
      ${avisoVenda}${notaSemPedido}${avisoCliente}
      ${siteBarraPeriodo()}
      <div class="contexto" style="border-color:var(--farol-fora);">Sem pedido do site nesta janela e nestas unidades.</div>`;
    return;
  }

  const V = {
    pedidos: soma(vendasF, 'pedidos'), fat: soma(vendasF, 'faturamento'),
  };
  V.ticket = V.pedidos ? V.fat / V.pedidos : 0;
  const C = {
    novos: soma(cliF, 'clientes_novos'), pedNovos: soma(cliF, 'pedidos_novos'),
    pedidos: soma(cliF, 'pedidos'), cupomPrim: soma(cliF, 'pedidos_cupom_primeira'),
    comAccon: soma(cliF, 'pedidos_com_accon'),   // sobre quantos pedidos o cupom e conhecido
    comFrete: soma(cliF, 'pedidos_com_frete'), frete: soma(cliF, 'frete_cobrado'),
    desc: soma(cliF, 'descontos'),
  };
  // O iFood entra no MESMO recorte de loja: sem isso a "diferença de ticket"
  // compararia o site de uma loja com o iFood da rede inteira. Tipo de entrega nao
  // tem par do lado do iFood, entao o canal nao recorta essa comparacao.
  const ifood = siteIfoodNoPeriodo(iniISO, fimISO, SITE_F.loja);
  const difTicket = V.ticket - ifood.ticket;
  const fontes = [...new Set(vendasF.map(v => v.fonte))];

  // ---------- semana a semana ----------
  const porSemana = new Map();
  const pega = (k) => {
    if (!porSemana.has(k)) porSemana.set(k, { sem: k, pedidos: 0, fat: 0, novos: 0, pedNovos: 0, cupomPrim: 0, temCliente: false });
    return porSemana.get(k);
  };
  vendasF.forEach(r => {
    const o = pega(siteSemana(r.data));
    o.pedidos += Number(r.pedidos || 0); o.fat += Number(r.faturamento || 0);
  });
  cliF.forEach(r => {
    const o = pega(siteSemana(r.data));
    o.novos += Number(r.clientes_novos || 0); o.pedNovos += Number(r.pedidos_novos || 0);
    o.cupomPrim += Number(r.pedidos_cupom_primeira || 0); o.temCliente = true;
  });
  // Semana que comecou depois do corte do cliente nao tem "novos" — mostra "—".
  porSemana.forEach(o => { if (corteCliente && o.sem > corteCliente) o.temCliente = false; });
  const semAsc = [...porSemana.values()].sort((a, b) => a.sem < b.sem ? -1 : 1);
  const semDesc = [...semAsc].reverse();

  // A medida escolhida nos botoes: o rotulo, como ler a semana e como escrever o
  // numero. Semana sem dado de cliente devolve null em "Clientes novos" — barra
  // vazia, nunca zero, que e a mesma regra do traco na tabela de baixo.
  const siteMedidaRot = (SITE_MEDIDAS.find(x => x[0] === SITE_MEDIDA) || SITE_MEDIDAS[0])[1];
  const siteMedidaDe = (s) => SITE_MEDIDA === 'pedidos' ? s.pedidos
    : SITE_MEDIDA === 'fat' ? s.fat
    : SITE_MEDIDA === 'ticket' ? (s.pedidos ? s.fat / s.pedidos : 0)
    : (s.temCliente ? s.novos : null);
  const siteMedidaFmt = (v) => (v === null || v === undefined) ? '—'
    : (SITE_MEDIDA === 'fat' || SITE_MEDIDA === 'ticket') ? 'R$ ' + fmt(Number(v)) : num(v);

  // ---------- por loja e por canal (venda) ----------
  const agrupar = (linhas, campo) => {
    const m = new Map();
    linhas.forEach(r => {
      const k = r[campo];
      if (!m.has(k)) m.set(k, { chave: k, pedidos: 0, fat: 0, fontes: new Set() });
      const o = m.get(k);
      o.pedidos += Number(r.pedidos || 0); o.fat += Number(r.faturamento || 0);
      if (r.fonte) o.fontes.add(r.fonte);
    });
    return [...m.values()].sort((a, b) => b.fat - a.fat);
  };
  // as duas tabelas do recorte: cada uma ignora a PROPRIA dimensao para continuar
  // listando todas as opcoes, e obedece a outra
  const porLoja = agrupar(vendas.filter(r => passaSF(r, 'loja')), 'loja');
  const porCanal = agrupar(vendas.filter(r => passaSF(r, 'canal')), 'canal');
  // a "parte dos pedidos" da tabela de canais divide pelo total DELA, nao por
  // V.pedidos: com um canal fixado, V.pedidos e so o do canal e a conta passaria de 100%
  const totPedCanal = porCanal.reduce((a, c) => a + c.pedidos, 0);
  const novosPorLoja = new Map();
  cli.filter(r => passaSF(r, 'loja')).forEach(r => novosPorLoja.set(r.loja, (novosPorLoja.get(r.loja) || 0) + Number(r.clientes_novos || 0)));

  // ---------- cupons no periodo (Accon, por mes) ----------
  const mesIni = iniISO.slice(0, 7);
  const cupons = new Map();
  SITE.cupom.filter(c => activeUnidades.has(c.loja) && c.mes.slice(0, 7) >= mesIni).forEach(c => {
    if (!cupons.has(c.cupom)) cupons.set(c.cupom, { cupom: c.cupom, pedidos: 0, desc: 0, fat: 0 });
    const o = cupons.get(c.cupom);
    o.pedidos += Number(c.pedidos || 0); o.desc += Number(c.descontos || 0); o.fat += Number(c.faturamento || 0);
  });
  const todosCupons = [...cupons.values()].sort((a, b) => b.pedidos - a.pedidos);
  const listaCupons = SITE_TUDO ? todosCupons : todosCupons.slice(0, 8);

  const coorte = SITE.coorte.slice(0, 12);

  // ---------- base de clientes ----------
  const ordemSeg = ['LEAD (nunca comprou)', '1 pedido so', 'recorrente (2-5)', 'fiel (6+)'];
  const rotuloSeg = {
    'LEAD (nunca comprou)': 'Cadastrou e nunca comprou', '1 pedido so': 'Comprou 1 vez só',
    'recorrente (2-5)': 'Recorrente (2 a 5)', 'fiel (6+)': 'Fiel (6 ou mais)',
  };
  const segs = ordemSeg.map(s => SITE.segmentos.find(x => x.segmento === s)).filter(Boolean);
  const totalBase = SITE.segmentos.reduce((a, s) => a + Number(s.clientes || 0), 0);
  const ativos = SITE.recencia.find(r => Number(r.ordem) === 1);
  const recuperaveis = SITE.recencia.filter(r => Number(r.ordem) >= 2 && Number(r.ordem) <= 4)
    .reduce((a, r) => a + Number(r.clientes || 0), 0);

  // ---------- atribuicao (a regua da equipe de trafego) ----------
  const camp = new Map();
  SITE.atribuicao.forEach(a => {
    const k = `${a.utm_source}|${a.utm_medium}|${a.utm_campaign}`;
    if (!camp.has(k)) camp.set(k, { source: a.utm_source, medium: a.utm_medium, campanha: a.utm_campaign, clientes: 0, conv: 0, pedidos: 0 });
    const o = camp.get(k);
    o.clientes += Number(a.clientes || 0); o.conv += Number(a.converteram || 0); o.pedidos += Number(a.pedidos_total || 0);
  });
  // A tabela de UTM respondia "quem trouxe mais gente", que e volume, nao resultado.
  // A pergunta da equipe de trafego e "quem trouxe gente que COMPROU", entao a ordem
  // passa a ser por conversao — com um piso de pessoas captadas, senao a campanha de
  // uma pessoa que comprou marca 100% e sobe ao topo sem significar nada. Abaixo do
  // piso a lista segue por tamanho, no fim.
  const PISO_UTM = 10;
  const taxaUtm = (c) => c.clientes ? c.conv / c.clientes * 100 : 0;
  const campanhas = [...camp.values()].sort((a, b) => {
    const aVale = a.clientes >= PISO_UTM, bVale = b.clientes >= PISO_UTM;
    if (aVale !== bVale) return aVale ? -1 : 1;
    if (!aVale) return b.clientes - a.clientes;
    return taxaUtm(b) - taxaUtm(a);
  });
  // As duas referencias que marcam "captou muito e converteu pouco": a media SIMPLES
  // de pessoas captadas por campanha e a conversao do conjunto.
  const totCaptados = campanhas.reduce((a, c) => a + c.clientes, 0);
  const totConvUtm = campanhas.reduce((a, c) => a + c.conv, 0);
  const mediaCaptados = campanhas.length ? totCaptados / campanhas.length : 0;
  const convGeral = totCaptados ? totConvUtm / totCaptados * 100 : 0;
  const utmCara = (c) => c.clientes > mediaCaptados && taxaUtm(c) < convGeral;
  const pagas = campanhas.filter(c => c.medium === 'paid');
  const clientesPagos = pagas.reduce((a, c) => a + c.clientes, 0);
  const convPagos = pagas.reduce((a, c) => a + c.conv, 0);

  // o CSV e o resumo copiado saem do MESMO recorte da tela — relatorio que discorda
  // da tela vira discussao, que e por que este guardado existe. porLoja vai RECORTADO
  // aqui (na tela ela continua inteira, para dar como trocar de loja): sem isso o
  // resumo copiado diria "Pedidos: 325" no alto e listaria as duas lojas somando 650
  // logo abaixo — medido em 12/09/2026 antes de publicar.
  SITE_ULTIMO = { iniISO, fimISO, V, C, ifood,
    porLoja: porLoja.filter(l => !SITE_F.loja || l.chave === SITE_F.loja),
    vendas: vendasF, cli: cliF, corteVenda, corteCliente, corteCupom, semAsc };

  alvo.innerHTML = `
  <div class="section-label" style="border-top:none; margin-top:0; padding-top:0;" title="Venda e cliente vêm do Saipos, todo dia pela API; o cliente é o telefone do pedido.">Site próprio · venda e cliente até ${ddmm(corteCliente && corteCliente < corteVenda ? corteCliente : corteVenda)}</div>
  <div class="caption-label" style="text-align:center;">Cupom e campanha (UTM) até <b>${ddmm(corteCupom)}</b>.</div>
  ${avisoVenda}${notaSemPedido}${avisoCliente}
  ${siteBarraPeriodo()}
  <div style="display:flex; gap:10px; flex-wrap:wrap; align-items:center; margin:8px 0;">
    <span style="font-size:12px; color:var(--tx-3);">Para a equipe de tráfego (só número agregado):</span>
    <button class="preset-btn" onclick="siteBaixarCSV()">Baixar CSV (semana × loja)</button>
    <button class="preset-btn" id="btnSiteResumo" onclick="siteCopiarResumo()">Copiar resumo do período</button>
  </div>
  ${(SITE_F.loja || SITE_F.canal) ? `<div class="contexto" style="border-color:var(--brand);">
    <b>Filtrando:</b>
    ${SITE_F.loja ? `<button class="preset-btn active" onclick="siteFiltrar('loja','${SITE_F.loja}')">loja ${SITE_F.loja} ✕</button>` : ''}
    ${SITE_F.canal ? `<button class="preset-btn active" onclick="siteFiltrar('canal','${SITE_F.canal}')">${SITE_F.canal} ✕</button>` : ''}
    <button class="preset-btn" onclick="siteLimparFiltros()">limpar</button>
  </div>` : ''}

  <div class="cards">
    <div class="card neutral"><div class="card-lbl">Pedidos no site</div><div class="card-val">${num(V.pedidos)}</div>
      <div class="card-pct">${ddmm(iniISO)} a ${ddmm(fimISO)}</div></div>
    <div class="card neutral"><div class="card-lbl">Faturamento</div><div class="card-val">${reais(V.fat)}</div>
      <div class="card-pct">venda do canal no período</div></div>
    <div class="card ${difTicket >= 0 ? 'pos' : 'neg'}"><div class="card-lbl">Ticket médio</div><div class="card-val">${reais(V.ticket)}</div>
      <div class="card-pct">${difTicket >= 0 ? '+' : '−'}${reais(Math.abs(difTicket))} por pedido vs iFood (${reais(ifood.ticket)})</div></div>
    <div class="card neutral"><div class="card-lbl">Clientes novos</div><div class="card-val">${num(C.novos)}</div>
      <div class="card-pct">${pct(C.pedidos ? C.pedNovos / C.pedidos * 100 : 0)}% dos pedidos até ${ddmm(corteCliente)}</div></div>
  </div>
  <details style="margin:4px 0 10px;"><summary style="cursor:pointer; font-size:12.5px; color:var(--tx-3);">▸ mais do período: quem já conhecia, cupom de 1ª compra, frete</summary>
  <div class="cards">
    <div class="card neutral"><div class="card-lbl">Pedidos de quem já conhecia</div>
      <div class="card-val">${num(C.pedidos - C.pedNovos)}</div>
      <div class="card-pct">de ${num(C.pedidos)} pedidos com cliente identificado</div></div>
    <div class="card neutral"><div class="card-lbl">Cupom de primeira compra</div><div class="card-val">${num(C.cupomPrim)}</div>
      <div class="card-pct" title="conta ${num(C.comAccon)} de ${num(C.pedidos)} pedidos (os que têm o código do cupom)">pedidos com cupom de 1ª compra, até ${ddmm(corteCupom)}</div></div>
    <div class="card neutral"><div class="card-lbl">Pedidos que pagam frete</div>
      <div class="card-val">${pct(C.pedidos ? C.comFrete / C.pedidos * 100 : 0)}%</div>
      <div class="card-pct">${reais(C.frete)} cobrados de frete</div></div>
  </div></details>

  <div class="section-label">Semana a semana</div>
  <div class="periodo-presets">
    <span style="font-size:12px; color:var(--tx-3); margin-right:4px;">Medida do gráfico:</span>
    ${SITE_MEDIDAS.map(([k, r]) => `<button class="preset-btn ${SITE_MEDIDA === k ? 'active' : ''}" onclick="siteMedida('${k}')">${r}</button>`).join('')}
  </div>
  <div class="chart-box" style="height:300px;">
    <div class="chart-title">${siteMedidaRot} por semana</div>
    <div class="chart-canvas-wrap"><canvas id="chartSiteSemanas"></canvas></div>
  </div>
  <div id="tabelaSiteSemanas" style="margin-top:12px;"><table>
    <tr><th>Semana</th><th>Pedidos</th><th>Faturamento</th><th>Ticket</th><th>Clientes novos</th><th>Pedidos de quem voltou</th><th>Cupom 1ª compra</th></tr>
    ${semDesc.map(s => `<tr>
      <td>${ddmm(s.sem)}</td><td>${num(s.pedidos)}</td><td>${reais(s.fat)}</td>
      <td>${reais(s.pedidos ? s.fat / s.pedidos : 0)}</td>
      <td>${s.temCliente ? num(s.novos) : '—'}</td>
      <td>${s.temCliente ? num(s.pedidos - s.pedNovos) : '—'}</td>
      <td>${s.temCliente && !(corteCupom && s.sem > corteCupom) ? num(s.cupomPrim) : '—'}</td></tr>`).join('')}
    <tr class="liq"><td>TOTAL</td><td>${num(V.pedidos)}</td><td>${reais(V.fat)}</td><td>${reais(V.ticket)}</td>
      <td>${num(C.novos)}</td><td>${num(C.pedidos - C.pedNovos)}</td><td>${num(C.cupomPrim)}</td></tr>
  </table></div>
  <div class="caption-label" title="A semana começa na segunda. O traço quer dizer que a venda daquela semana já chegou e o dado de cliente ainda não — e, na coluna do cupom, que a semana começou depois do último export da Accon (${ddmm(corteCupom)}), a única fonte de cupom. A última linha pode estar incompleta se a semana ainda está correndo.">
    A semana começa na segunda; <b>"—" quer dizer que o dado de cliente ainda não chegou</b>.
  </div>

  <div class="section-label">Por loja</div>
  <div class="caption-label" style="text-align:center;"><b>Clique numa loja para recortar a tela por ela.</b></div>
  <div id="tabelaSiteLojas"><table>
    <tr><th>Loja</th><th>Pedidos</th><th>Faturamento</th><th>Ticket</th><th>Clientes novos</th><th>Fonte da venda</th></tr>
    ${porLoja.map(l => { const sel = SITE_F.loja === l.chave;
      return `<tr onclick="siteFiltrar('loja','${l.chave}')" style="cursor:pointer;${sel ? 'background:var(--brand-wine);' : ''}" title="${sel ? 'clique para soltar o recorte' : 'clique para ver só ' + l.chave}"><td>${sel ? '<b>' : ''}${l.chave}${sel ? '</b> ✕' : ''}</td><td>${num(l.pedidos)}</td>
      <td>${reais(l.fat)}</td><td>${reais(l.pedidos ? l.fat / l.pedidos : 0)}</td>
      <td>${num(novosPorLoja.get(l.chave) || 0)}</td>
      <td>${[...l.fontes].map(f => f === 'saipos' ? 'Saipos' : 'Accon').join(' + ')}</td></tr>`; }).join('')}
    ${(() => { const p = porLoja.reduce((a, l) => a + l.pedidos, 0), f = porLoja.reduce((a, l) => a + l.fat, 0), n = porLoja.reduce((a, l) => a + (novosPorLoja.get(l.chave) || 0), 0);
      return `<tr class="liq"><td>TOTAL</td><td>${num(p)}</td><td>${reais(f)}</td><td>${reais(p ? f / p : 0)}</td><td>${num(n)}</td><td></td></tr>`; })()}
  </table></div>

  <div class="section-label">Entrega e retirada</div>
  <div class="caption-label" style="text-align:center;"><b>Clique numa linha para recortar a tela por entrega ou por retirada.</b></div>
  <div id="tabelaSiteCanais"><table>
    <tr><th>Como o cliente recebe</th><th>Pedidos</th><th>Parte dos pedidos</th><th>Faturamento</th><th>Ticket</th></tr>
    ${porCanal.map(c => { const sel = SITE_F.canal === c.chave;
      return `<tr onclick="siteFiltrar('canal','${c.chave}')" style="cursor:pointer;${sel ? 'background:var(--brand-wine);' : ''}" title="${sel ? 'clique para soltar o recorte' : 'clique para ver só ' + c.chave}"><td>${sel ? '<b>' : ''}${c.chave}${sel ? '</b> ✕' : ''}</td><td>${num(c.pedidos)}</td>
      <td>${pct(totPedCanal ? c.pedidos / totPedCanal * 100 : 0)}%</td>
      <td>${reais(c.fat)}</td><td>${reais(c.pedidos ? c.fat / c.pedidos : 0)}</td></tr>`; }).join('')}
    ${(() => { const f = porCanal.reduce((a, c) => a + c.fat, 0);
      return `<tr class="liq"><td>TOTAL</td><td>${num(totPedCanal)}</td><td>100%</td><td>${reais(f)}</td><td>${reais(totPedCanal ? f / totPedCanal : 0)}</td></tr>`; })()}
  </table></div>

  <details style="margin-top:14px;" ${SITE_CLI_ABERTO ? 'open' : ''} ontoggle="SITE_CLI_ABERTO=this.open">
  <summary class="section-label" style="cursor:pointer;">▸ Clientes e campanhas · cupons, retorno, base e UTM (rede inteira, não segue o recorte)</summary>
  <div class="section-label">Cupons usados no período</div>
  <div id="tabelaSiteCupons"><table>
    <tr><th>Cupom</th><th>Pedidos</th><th>Desconto dado</th><th>Faturamento</th><th>Ticket</th><th>Desconto por pedido</th></tr>
    ${listaCupons.map(c => `<tr><td>${c.cupom}</td><td>${num(c.pedidos)}</td><td>${reais(c.desc)}</td>
      <td>${reais(c.fat)}</td><td>${reais(c.pedidos ? c.fat / c.pedidos : 0)}</td>
      <td>${reais(c.pedidos ? c.desc / c.pedidos : 0)}</td></tr>`).join('')}
  </table></div>
  ${todosCupons.length > 8 ? `<div style="font-size:12px; margin:4px 0;"><a href="javascript:void(0)" onclick="SITE_TUDO=!SITE_TUDO; renderModuloSite();">${SITE_TUDO ? 'ver só os 8 maiores' : 'ver todos os ' + todosCupons.length + ' cupons'}</a></div>` : ''}
  <div class="caption-label">Por mês inteiro; vai até: <b>${ativas.filter(a => a.o_que === 'cupom').map(a => `${a.loja} ${ddmm(a.ate)}`).join(' · ')}</b>.</div>

  <div class="section-label">Quem estreou em cada mês voltou?</div>
  <div id="tabelaSiteCoorte"><table>
    <tr><th>Mês da estreia</th><th>Clientes novos</th><th>Voltaram (2+ pedidos)</th><th>Quanto voltou</th><th>3 ou mais</th><th>Pedidos por cliente</th><th>Receita do grupo</th></tr>
    ${coorte.map(c => {
      const p = Number(c.novos) ? Number(c.voltaram) / Number(c.novos) * 100 : 0;
      const [ano, mes] = c.mes.split('-');
      return `<tr><td>${MESES_ABREV[Number(mes) - 1]}/${ano}</td><td>${num(c.novos)}</td><td>${num(c.voltaram)}</td>
        <td style="color:${p >= 25 ? 'var(--farol-ok)' : 'var(--farol-fora)'}; font-weight:600;">${pct(p)}%</td>
        <td>${num(c.tres_ou_mais)}</td><td>${Number(c.pedidos_por_cliente || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
        <td>${reais(c.receita_total)}</td></tr>`;
    }).join('')}
  </table></div>
  <div class="caption-label">Uma pessoa = um telefone; mês recente teve menos tempo de voltar.</div>

  <div class="section-label">Base de clientes hoje</div>
  <div class="cards">
    ${segs.map(s => `<div class="card ${s.segmento === 'fiel (6+)' ? 'pos' : 'neutral'}">
      <div class="card-lbl">${rotuloSeg[s.segmento] || s.segmento}</div>
      <div class="card-val">${num(s.clientes)}</div>
      <div class="card-pct">${pct(totalBase ? Number(s.clientes) / totalBase * 100 : 0)}% da base · ${num(s.com_email)} com e-mail</div></div>`).join('')}
    <div class="card pos"><div class="card-lbl">Comprou nos últimos 30 dias</div><div class="card-val">${num(ativos ? ativos.clientes : 0)}</div>
      <div class="card-pct">é este o tamanho real do cliente ativo</div></div>
    <div class="card neutral"><div class="card-lbl">Sumiu há 1 a 6 meses</div><div class="card-val">${num(recuperaveis)}</div>
      <div class="card-pct">alvo de reativação — ainda lembram da marca</div></div>
  </div>
  <div id="tabelaSiteRecencia"><table>
    <tr><th>Última compra</th><th>Clientes</th><th>Parte da base</th><th>Pedidos de vida do grupo</th></tr>
    ${SITE.recencia.map(r => `<tr><td>${r.faixa}</td><td>${num(r.clientes)}</td>
      <td>${pct(totalBase ? Number(r.clientes) / totalBase * 100 : 0)}%</td><td>${num(r.pedidos_total)}</td></tr>`).join('')}
  </table></div>
  <div class="caption-label" title="O cadastro (e-mail, pedidos de vida) vem do portal da Accon; desde 15/10 as compras que o Saipos registra depois do último export entram na conta, e quem estreou depois entra sem e-mail.">Uma pessoa é uma linha só; cliente novo depois do último export da Accon vem sem e-mail.</div>

  <div class="section-label">De onde veio o cliente (UTM)</div>
  <div id="tabelaSiteUtm"><table>
    <tr><th>Origem</th><th>Tipo</th><th>Campanha</th><th>Pessoas captadas</th><th>Compraram</th><th title="De quem chegou por este link, quantos fizeram pelo menos um pedido.">Parte que comprou</th><th>Pedidos</th></tr>
    ${(SITE_TUDO ? campanhas : campanhas.slice(0, 12)).map(c => `<tr${utmCara(c) ? ` style="color:var(--farol-fora);" title="Captou ${num(c.clientes)} pessoas, acima da média de ${num(Math.round(mediaCaptados))} por campanha, e converteu ${pct(taxaUtm(c))}%, abaixo dos ${pct(convGeral)}% do conjunto."` : ''}><td>${c.source}</td><td title="${c.medium || ''}">${SITE_TIPO_UTM[String(c.medium || '').toLowerCase()] || c.medium || '—'}</td><td>${c.campanha}</td>
      <td>${num(c.clientes)}</td><td>${num(c.conv)}</td>
      <td>${pct(taxaUtm(c))}%</td><td>${num(c.pedidos)}</td></tr>`).join('')}
  </table></div>
  ${campanhas.length > 12 ? `<div style="font-size:12px; margin:4px 0;"><a href="javascript:void(0)" onclick="SITE_TUDO=!SITE_TUDO; renderModuloSite();">${SITE_TUDO ? 'ver só as 12 primeiras' : 'ver todas as ' + campanhas.length + ' campanhas'}</a></div>` : ''}
  <div class="caption-label" title="A ordem é pela parte que comprou, entre as campanhas com pelo menos ${PISO_UTM} pessoas captadas — sem esse piso, campanha de uma pessoa que comprou marca 100% e sobe ao topo. Abaixo do piso a lista segue pelo tamanho, no fim. A média de captados é simples: total dividido pelo número de campanhas (${num(Math.round(mediaCaptados))} por campanha).">
    Em <span style="color:var(--farol-fora);">vermelho</span>, a campanha que captou acima da média e converteu abaixo do conjunto (${pct(convGeral)}%).
  </div>
  <div class="caption-label" title="O rastreio funciona e já grava o id da campanha do Meta, mas o volume é pequeno. A maior parte do que aparece aqui é o próprio link da Accon (accon_links / referral), que não é campanha. Isto é a linha de base: serve para comparar daqui pra frente, não para julgar o trabalho de agora.">
    <b>${num(clientesPagos)} pessoas</b> chegaram por link marcado como pago desde nov/2025 e <b>${num(convPagos)}</b> delas compraram.
    Campanha até ${ddmm(corteCupom)}.
  </div>
  </details>`;

  // O grafico so depois do innerHTML — Chart.js mede zero em container escondido.
  // UMA serie so, na cor de dado (--info): a identidade vem do rotulo do eixo e da
  // medida escolhida nos botoes. O eixo da direita morreu junto com as tres series.
  destroyChart('chartSiteSemanas');
  const cvs = document.getElementById('chartSiteSemanas');
  if (cvs && semAsc.length) {
    chartInstances['chartSiteSemanas'] = new Chart(cvs.getContext('2d'), {
      type: 'bar',
      data: {
        labels: semAsc.map(s => ddmm(s.sem)),
        datasets: [{
          label: siteMedidaRot,
          data: semAsc.map(siteMedidaDe),
          backgroundColor: corToken('--info'),
        }],
      },
      options: {
        responsive: true, maintainAspectRatio: false,
        interaction: { mode: 'index', intersect: false },
        plugins: {
          legend: { display: false },
          tooltip: { callbacks: { label: (c) => `${siteMedidaRot}: ${siteMedidaFmt(c.parsed.y)}` } },
        },
        scales: {
          x: { ticks: { maxRotation: 60, autoSkip: true } },
          y: { beginAtZero: true, ticks: { callback: (v) => siteMedidaFmt(v) } },
        },
      },
    });
  }
}

function siteCSVTexto(vendas, cli, corteCliente, corteCupom) {
  const n = (v) => Number(v || 0).toFixed(2).replace('.', ',');
  const cab = ['semana', 'loja', 'fonte_da_venda', 'pedidos', 'faturamento', 'ticket_medio',
    'clientes_novos', 'pedidos_de_estreia', 'pedidos_de_quem_voltou',
    'pedidos_cupom_primeira_compra', 'frete_cobrado'];
  const m = new Map();
  const pega = (sem, loja) => {
    const k = sem + '|' + loja;
    if (!m.has(k)) m.set(k, { sem, loja, fontes: new Set(), pedidos: 0, fat: 0, novos: 0, pedNovos: 0, pedCli: 0, cupomPrim: 0, frete: 0, temCliente: false });
    return m.get(k);
  };
  vendas.forEach(r => {
    const o = pega(siteSemana(r.data), r.loja);
    o.pedidos += Number(r.pedidos || 0); o.fat += Number(r.faturamento || 0); o.fontes.add(r.fonte);
  });
  cli.forEach(r => {
    const o = pega(siteSemana(r.data), r.loja);
    o.novos += Number(r.clientes_novos || 0); o.pedNovos += Number(r.pedidos_novos || 0);
    o.pedCli += Number(r.pedidos || 0); o.cupomPrim += Number(r.pedidos_cupom_primeira || 0);
    o.frete += Number(r.frete_cobrado || 0); o.temCliente = true;
  });
  m.forEach(o => { if (corteCliente && o.sem > corteCliente) o.temCliente = false; });
  const corpo = [...m.values()].sort((a, b) => (a.sem + a.loja) < (b.sem + b.loja) ? -1 : 1)
    .map(o => [o.sem, o.loja, [...o.fontes].join('+') || 'accon', o.pedidos, n(o.fat),
      n(o.pedidos ? o.fat / o.pedidos : 0),
      // sem dado de cliente a celula vai vazia, nunca zero
      o.temCliente ? o.novos : '', o.temCliente ? o.pedNovos : '',
      // cupom so da Accon: semana depois do ultimo export dela vai vazia (15/10/2026)
      o.temCliente ? o.pedCli - o.pedNovos : '',
      o.temCliente && !(corteCupom && o.sem > corteCupom) ? o.cupomPrim : '',
      o.temCliente ? n(o.frete) : '']);
  return [cab, ...corpo].map(l => l.join(';')).join('\r\n');
}

function siteBaixarCSV() {
  if (!SITE_ULTIMO) return;
  const csv = siteCSVTexto(SITE_ULTIMO.vendas, SITE_ULTIMO.cli, SITE_ULTIMO.corteCliente, SITE_ULTIMO.corteCupom);
  // BOM na frente: sem ele o Excel em portugues abre "SAO BRAZ" com caractere quebrado.
  const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `site-proprio_${SITE_ULTIMO.iniISO}_a_${SITE_ULTIMO.fimISO}.csv`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
}

function siteCopiarResumo() {
  if (!SITE_ULTIMO) return;
  const { iniISO, fimISO, V, C, ifood, porLoja, corteVenda, corteCliente, corteCupom } = SITE_ULTIMO;
  const r = (v) => 'R$ ' + fmt(Number(v || 0));
  const dd = (iso) => iso ? iso.slice(8, 10) + '/' + iso.slice(5, 7) : '—';
  const texto = [
    `Site próprio — ${dd(iniISO)} a ${dd(fimISO)}`,
    `Pedidos: ${V.pedidos} · Faturamento: ${r(V.fat)} · Ticket médio: ${r(V.ticket)}`,
    `Ticket no iFood no mesmo período: ${r(ifood.ticket)} (diferença de ${r(V.ticket - ifood.ticket)} por pedido)`,
    '',
    `Clientes novos: ${C.novos} (${pct(C.pedidos ? C.pedNovos / C.pedidos * 100 : 0)}% dos pedidos foram estreia)`,
    `Pedidos de quem já conhecia: ${C.pedidos - C.pedNovos}`,
    `Cupom de primeira compra: ${C.cupomPrim} pedidos · desconto total ${r(C.desc)} (cupom só vem do portal da Accon: conta ${C.comAccon} de ${C.pedidos} pedidos, até ${dd(corteCupom)})`,
    '',
    'Por loja:',
    ...porLoja.map(l => `- ${l.chave}: ${l.pedidos} pedidos, ${r(l.fat)}, ticket ${r(l.pedidos ? l.fat / l.pedidos : 0)}`),
    '',
    `Venda apurada até ${dd(corteVenda)} · dado de cliente até ${dd(corteCliente)} · cupom e campanha até ${dd(corteCupom)}.`,
  ].join('\n');
  const btn = document.getElementById('btnSiteResumo');
  navigator.clipboard.writeText(texto).then(() => {
    // 12/11/2026 (usabilidade, site): o ✓ fica com a hora, não some em 2 s
    if (btn) btn.textContent = '✓ Copiado às ' + avisoHora() + ' · copiar de novo';
  }).catch(() => { if (btn) btn.textContent = '✗ Não copiou — clique para tentar de novo'; });
}

// ------------------------------------------------------------------
// MODULO ATRASOS E TURNOS (13/08/2026). Fonte: API do Foody Delivery
// (logistica propria, 97% das entregas), tabela foody_entregas via
// vw_foody_entregas_min — busca SO a janela atual (a tabela cheia tem
// ~35 mil entregas). A regua de atraso e a PROMESSA REAL do iFood
// (parseada das notes pelo importador), NUNCA o deliveryDueDate, que e
// um padrao fixo de 60 min. E os tempos sao APONTAMENTO HUMANO — a
// caixa de qualidade do apontamento mostra o quanto da nao confiar,
// em vez de esconder. So Agua Verde por ora (mesmo limite do Saipos).
let ATRASOS = null; // { ini, fim, rows } — cache da janela buscada

// Desde 15/08/2026 o Foody cobre as 4 unidades — filtro proprio do modulo
// (o filtro global de lojas e do iFood e nao se aplica aqui).
let ATRASOS_UNIDADE = 'TODAS';

function atrasosUnidade(u) { ATRASOS_UNIDADE = u; renderModuloAtrasos(); }

// Chips de unidade dos modulos do Foody: derivadas do DADO da janela, nao
// de lista fixa — loja sem entrega no periodo nem aparece.
function chipsUnidadeFoody(rows, atual, fn) {
  if (canalComSeletor()) return '';
  const unidades = [...new Set(rows.map(r => r.unidade))].sort();
  if (unidades.length < 2) return '';
  return '<div style="margin:6px 0;">' +
    ['TODAS', ...unidades].map(u =>
      `<button class="preset-btn ${atual === u ? 'active' : ''}" onclick="${fn}('${u}')">${u === 'TODAS' ? 'Todas' : u}</button>`
    ).join('') + '</div>';
}

// PERIMETRO nos modulos do Foody (15/08/2026, pedido do dono): Boqueirao e
// gestao separada (futuramente da Loana) — em "Minha gestao" ele sai dos
// totais e dos chips, igual ao Esta semana; em "Rede completa" entra. A
// regra vem de dim_lojas.gestao via UNIDADES_PROPRIAS, nunca do codigo.
function foodyNoPerimetro(rows) {
  // UNIDADES_PROPRIAS vazia = boot (dim_lojas) ainda nao carregou — nao
  // filtra nada em vez de derrubar o modulo inteiro
  if (PERIMETRO === 'rede' || UNIDADES_PROPRIAS.size === 0) return rows;
  return rows.filter(r => UNIDADES_PROPRIAS.has(r.unidade));
}

async function entrarAtrasos() {
  const alvo = document.getElementById('view-atrasos');
  if (!alvo) return;
  const ini = fDataIni.value, fim = fDataFim.value;
  if (!ATRASOS || ATRASOS.ini !== ini || ATRASOS.fim !== fim) {
    alvo.innerHTML = '<div class="contexto">Carregando as entregas do período...</div>';
    // numero e localizador_ifood entraram na view em 12/09/2026: sem identificador a
    // tela sabia dizer que sexta a noite atrasa e nao sabia dizer QUAL pedido
    const rows = await consultarTudo(`vw_foody_entregas_min?select=unidade,data_local,turno,dia_semana,entregador,entregador_tipo,atraso_min,preparo_min,bancada_min,rua_min,sem_pronto,pronto_com_despacho,sem_promessa,dist_km,numero,localizador_ifood&data_local=gte.${ini}&data_local=lte.${fim}&order=data_local`);
    ATRASOS = { ini, fim, rows };
  }
  renderModuloAtrasos();
}

// DE QUAIS LOJAS E ESTE NUMERO (12/09/2026, auditoria).
// Ahu e Sao Braz sairam do Foody quando migraram de sistema de logistica —
// ultima entrega em 29/08 e 26/08. As telas continuavam dizendo "Visao Minha
// gestao" e mostrando so a Agua Verde: na semana de 31/08 a 06/09 as "1.381
// entregas" eram 100% AV, enquanto Ahu e Sao Braz entregaram 494 pedidos do
// iFood, invisiveis aqui. Agora a tela diz quais lojas o numero cobre.
function foodyCobertura(rows) {
  const esperadas = UNIDADES.filter(u => PERIMETRO === 'rede' || UNIDADES_PROPRIAS.has(u));
  const comDado = new Set(rows.map(r => r.unidade));
  const faltando = esperadas.filter(u => !comDado.has(u));
  const presentes = esperadas.filter(u => comDado.has(u));
  if (!faltando.length || !presentes.length) return '';
  const UN = { 'AGUA VERDE': 'Água Verde', 'AHU': 'Ahú', 'SÃO BRAZ': 'São Braz', 'BOQUEIRAO': 'Boqueirão' };
  const nome = u => UN[u] || u;
  return `<div class="contexto" style="border-color:var(--farol-fora);">
    <b>Este número é só de ${presentes.map(nome).join(' e ')}.</b>
    Sem entrega registrada no período: ${faltando.map(nome).join(', ')}.
    Pode ser loja fechada no período ou fonte parada — confira em Sistema › Rotinas.
  </div>`;
}

// Media simples DE PROPOSITO (pedido do dono, 13/08/2026): o publico e o
// operador de delivery, que entende "media" e nao "mediana". O preco disso
// (um caso absurdo puxa a media) foi avisado e aceito.
function mediaDe(valores) {
  const v = valores.filter(x => x !== null && x !== undefined).map(Number);
  if (!v.length) return null;
  return v.reduce((s, x) => s + x, 0) / v.length;
}

// RECORTE DA TELA DE ATRASOS (12/09/2026) — o padrao do modulo Evolucao trazido
// para ca. As quebras (turno, dia da semana, entregador) eram recortes
// independentes das MESMAS entregas: nao dava para perguntar "como esta o jantar
// de sexta". Agora clicar fixa a dimensao e a tela inteira anda junto.
// Regra do cross-filter: a dimensao que voce filtrou continua mostrando TODAS as
// suas categorias (senao nao da para trocar de escolha); as outras se recortam.
// A unidade NAO mora aqui de proposito: ela ja e o chip de cima, e dois controles
// para a mesma coisa e o jeito mais rapido de ninguem confiar em nenhum dos dois.
let ATRASOS_F = { turno: null, dow: null, entregador: null };

function atrasosFiltrar(tipo, valor) {
  ATRASOS_F[tipo] = (ATRASOS_F[tipo] === valor) ? null : valor;   // clicar de novo solta
  renderModuloAtrasos();
}

// a matriz turno x dia da semana e o mapa: clicar numa celula fixa as duas de uma vez
function atrasosMatriz(turno, dow) {
  const jaEra = ATRASOS_F.turno === turno && ATRASOS_F.dow === dow;
  ATRASOS_F.turno = jaEra ? null : turno;
  ATRASOS_F.dow = jaEra ? null : dow;
  renderModuloAtrasos();
}

// Nome de entregador tem acento, ponto e as vezes aspas: o clique vai por INDICE,
// nunca como string dentro do atributo HTML — e exatamente ali que a fuga quebra
// em silencio (mesma licao do filtro de item do modulo Evolucao).
let ATRASOS_LISTA_ENT = [];

function atrasosFiltrarEnt(i) {
  const k = ATRASOS_LISTA_ENT[i];
  if (k !== undefined) atrasosFiltrar('entregador', k);
}

function atrasosLimparFiltros() {
  ATRASOS_F = { turno: null, dow: null, entregador: null };
  renderModuloAtrasos();
}

function renderModuloAtrasos() {
  const alvo = document.getElementById('view-atrasos');
  if (!alvo || ATRASOS === null) return;
  // janela mudou depois da busca — rebusca em vez de mostrar dado velho
  if (ATRASOS.ini !== fDataIni.value || ATRASOS.fim !== fDataFim.value) { entrarAtrasos(); return; }
  const base = foodyNoPerimetro(ATRASOS.rows);
  // unidade escolhida saiu do perimetro (ex.: BOQUEIRAO ao voltar p/ Minha
  // gestao) — cai para Todas em vez de mostrar tela vazia
  if (ATRASOS_UNIDADE !== 'TODAS' && !base.some(r => r.unidade === ATRASOS_UNIDADE)) ATRASOS_UNIDADE = 'TODAS';
  const rows = base.filter(r => ATRASOS_UNIDADE === 'TODAS' || r.unidade === ATRASOS_UNIDADE);
  const chips = chipsUnidadeFoody(base, ATRASOS_UNIDADE, 'atrasosUnidade');
  // A chave do entregador leva a unidade: com "Todas", um mesmo nome em duas lojas
  // nao se mistura — e e esta chave que ATRASOS_F guarda.
  const chaveEnt = (r) => r.unidade + '|' + (r.entregador || '(sem apontamento)');
  // escolha que sumiu da janela ou da unidade cai sozinha, em vez de deixar a tela vazia
  if (ATRASOS_F.turno && !rows.some(r => r.turno === ATRASOS_F.turno)) ATRASOS_F.turno = null;
  if (ATRASOS_F.dow && !rows.some(r => r.dia_semana === ATRASOS_F.dow)) ATRASOS_F.dow = null;
  if (ATRASOS_F.entregador && !rows.some(r => chaveEnt(r) === ATRASOS_F.entregador)) ATRASOS_F.entregador = null;
  // Regra do cross-filter: quem passa 'ignora' esta desenhando a propria dimensao e
  // por isso ve todas as categorias; o resto da tela ve o recorte inteiro.
  const passaF = (r, ignora) => (ignora === 'turno' || !ATRASOS_F.turno || r.turno === ATRASOS_F.turno)
    && (ignora === 'dow' || !ATRASOS_F.dow || r.dia_semana === ATRASOS_F.dow)
    && (ignora === 'entregador' || !ATRASOS_F.entregador || chaveEnt(r) === ATRASOS_F.entregador);
  const rowsF = rows.filter(r => passaF(r));
  const ddmm = (v) => v ? v.slice(8, 10) + '/' + v.slice(5, 7) : '—';
  if (!rows.length) {
    alvo.innerHTML = `<div class="contexto">Sem entregas próprias entre ${ddmm(ATRASOS.ini)} e ${ddmm(ATRASOS.fim)} — os dados do TrackEat ainda não chegaram para esse período.</div>`;
    return;
  }

  const n1 = (v) => v === null ? '—' : v.toFixed(1).replace('.', ',');
  const pctTxt = (parte, todo) => todo ? (parte / todo * 100).toFixed(1).replace('.', ',') + '%' : '—';

  // Protecao combinada com o dono (13/08/2026): tempo sem sentido e
  // provavel erro de apontamento e fica FORA das medias — contado e dito
  // na tela, para o numero continuar conferivel. Faixas calibradas nas
  // caudas reais dos 6 meses (202 entregas "1h30+ antes do prometido",
  // pior caso -24h; preparo e bancada vieram limpos, faixa e so guarda).
  const FAIXA = { atraso: [-90, 120], preparo: [0, 120], bancada: [0, 120], rua: [0, 120] };
  const plausivel = (v, faixa) => v !== null && v !== undefined && Number(v) >= faixa[0] && Number(v) <= faixa[1];

  // metricas de um grupo de entregas — sempre sobre quem TEM a medida.
  // atrasoMedio conta SO quem saiu do prazo: "quando atrasa, atrasa X min"
  // e mais acionavel que uma media geral diluida pelas adiantadas.
  const resumo = (grupo) => {
    const comMedida = grupo.filter(r => plausivel(r.atraso_min, FAIXA.atraso));
    const atrasadas = comMedida.filter(r => Number(r.atraso_min) > 5);
    return {
      n: grupo.length,
      medidos: comMedida.length,
      fora: atrasadas.length,
      atrasoMedio: mediaDe(atrasadas.map(r => r.atraso_min)),
      preparo: mediaDe(grupo.filter(r => plausivel(r.preparo_min, FAIXA.preparo)).map(r => r.preparo_min)),
      bancada: mediaDe(grupo.filter(r => plausivel(r.bancada_min, FAIXA.bancada)).map(r => r.bancada_min)),
      rua: mediaDe(grupo.filter(r => plausivel(r.rua_min, FAIXA.rua)).map(r => r.rua_min)),
    };
  };

  // cartoes e caixa de qualidade leem o RECORTE (rowsF): fixar sexta a noite tem de
  // mudar o numero de cima, senao o clique mente sobre o que a tela esta mostrando
  // OS 10 QUE MAIS ATRASARAM no recorte (12/09/2026). A tela dizia que sexta a noite
  // atrasa e nao dizia QUAL pedido — numero sem caso concreto atras dele nao vira
  // conversa com o motoboy nem consulta no portal. Segue o mesmo recorte do resto da
  // tela (rowsF), entao fixar um turno muda a lista. So entra entrega com atraso
  // MEDIDO e positivo: sem promessa nao da para dizer que atrasou.
  const piores10 = rowsF.filter(r => r.atraso_min !== null && r.atraso_min !== undefined && Number(r.atraso_min) > 0)
    .slice().sort((a, b) => Number(b.atraso_min) - Number(a.atraso_min)).slice(0, 10);
  const geral = resumo(rowsF);
  const semPronto = rowsF.filter(r => r.sem_pronto).length;
  const prontoJunto = rowsF.filter(r => r.pronto_com_despacho).length;
  const semPromessa = rowsF.filter(r => r.sem_promessa).length;
  const semSentido = rowsF.filter(r =>
    (r.atraso_min !== null && !plausivel(r.atraso_min, FAIXA.atraso)) ||
    (r.rua_min !== null && !plausivel(r.rua_min, FAIXA.rua)) ||
    (r.preparo_min !== null && !plausivel(r.preparo_min, FAIXA.preparo)) ||
    (r.bancada_min !== null && !plausivel(r.bancada_min, FAIXA.bancada))).length;

  const ORDEM_TURNO = ['ALMOÇO', 'CAFÉ DA TARDE', 'JANTAR', 'MADRUGADA'];
  const turnos = [...new Set(rows.map(r => r.turno))].sort((a, b) => {
    const ia = a === null ? 99 : ORDEM_TURNO.indexOf(a);
    const ib = b === null ? 99 : ORDEM_TURNO.indexOf(b);
    return ia - ib;
  });
  const DOW = { 1: 'segunda', 2: 'terça', 3: 'quarta', 4: 'quinta', 5: 'sexta', 6: 'sábado', 7: 'domingo' };

  // 'attrs' entrou em 12/09/2026 para a linha virar clicavel sem duplicar as celulas:
  // a mesma linha serve para a leitura e para o filtro.
  const linhaResumo = (rotulo, g, classe = '', attrs = '') => `<tr class="${classe}"${attrs}><td>${rotulo}</td>
    <td>${g.n.toLocaleString('pt-BR')}</td>
    <td>${pctTxt(g.medidos - g.fora, g.medidos)}</td>
    <td>${g.fora.toLocaleString('pt-BR')}</td>
    <td>${g.atrasoMedio === null ? '—' : n1(g.atrasoMedio) + ' min'}</td>
    <td>${n1(g.preparo)} min</td>
    <td>${n1(g.bancada)} min</td>
    <td>${n1(g.rua)} min</td></tr>`;
  const cabecalho = '<tr><th></th><th>Entregas</th><th>Dentro do prazo</th><th>Fora do prazo</th><th>Atraso médio</th><th>Preparo</th><th>Bancada</th><th>Rua</th></tr>';

  // ranking de entregadores: minimo de 10 entregas no periodo para nao
  // crucificar ninguem por 2 pedidos ruins
  // O ranking obedece ao recorte de turno e de dia (mas nao ao de entregador: essa
  // dimensao e a desta tabela e tem de continuar inteira, senao nao da para trocar).
  const rowsEnt = rows.filter(r => passaF(r, 'entregador'));
  const geralEnt = resumo(rowsEnt);
  const porEntregador = {};
  rowsEnt.forEach(r => {
    // unidade na chave: com "Todas", um mesmo nome em duas lojas nao se mistura
    const k = chaveEnt(r);
    (porEntregador[k] = porEntregador[k] || []).push(r);
  });
  const multiUnidade = new Set(rows.map(r => r.unidade)).size > 1;
  const entregadores = Object.values(porEntregador)
    .filter(g => g.length >= 10)
    .map(g => ({ nome: (g[0].entregador || '(sem apontamento)') + (multiUnidade ? ' · ' + g[0].unidade : ''),
                 chave: chaveEnt(g[0]),   // o que o recorte guarda; o rotulo e so texto
                 tipo: g[0].entregador_tipo || '—', g: resumo(g),
                 dist: mediaDe(g.map(r => r.dist_km)) }))
    .sort((a, b) => (b.g.medidos ? b.g.fora / b.g.medidos : 0) - (a.g.medidos ? a.g.fora / a.g.medidos : 0));
  const foraRanking = Object.values(porEntregador).filter(g => g.length < 10).length;

  // ---------- matriz turno x dia da semana (12/09/2026) ----------
  // "Sexta a noite atrasa?" so aparecia varrendo as duas tabelas de baixo e cruzando
  // na cabeca: elas viviam lado a lado sem se encontrar. A celula e o % FORA DO PRAZO
  // do cruzamento; com menos de 30 entregas fica em cinza, a mesma regra de "poucas
  // entregas" do modulo Frete — o numero existe, mas oscila demais para decidir.
  // O corte de 10% e o MESMO do cartao "Dentro do prazo" la em cima (90% dentro):
  // numero de corte escrito duas vezes com valores diferentes e como a tela se
  // contradiz sozinha. A matriz NAO se recorta por turno nem por dia — e dela que
  // se troca de escolha.
  const POUCAS_ATR = 30;
  const baseMat = rows.filter(r => passaF(r, 'turno') && passaF(r, 'dow'));
  const turnosMat = turnos.filter(t => t !== null);
  const dowsMat = [1, 2, 3, 4, 5, 6, 7].filter(d => rows.some(r => r.dia_semana === d));
  const celTxt = (g) => {
    const p = g.medidos ? g.fora / g.medidos * 100 : null;
    const cor = (p === null || g.n < POUCAS_ATR) ? 'var(--tx-3)'
      : p > 10 ? 'var(--farol-fora)' : 'var(--farol-ok)';
    return `<span style="color:${cor}; font-weight:600;">${p === null ? '—' : n1(p) + '%'}</span><span class="dre-av">${g.n.toLocaleString('pt-BR')} entregas</span>`;
  };
  const celulaMat = (t, d) => {
    const g = resumo(baseMat.filter(r => r.turno === t && r.dia_semana === d));
    const sel = ATRASOS_F.turno === t && ATRASOS_F.dow === d;
    const tit = sel ? 'clique para soltar o recorte'
      : 'clique para ver só ' + DOW[d] + ' no ' + String(t).toLowerCase()
        + ' · ' + g.fora + ' de ' + g.medidos + ' entregas medidas fora do prazo';
    const clic = g.n ? ` onclick="atrasosMatriz('${t}',${d})" style="cursor:pointer;${sel ? 'background:var(--brand-wine);' : ''}" title="${tit}"` : '';
    return `<td${clic}>${celTxt(g)}</td>`;
  };
  // Clique na LINHA das quebras: mesma ideia da celula, uma dimensao de cada vez.
  const linhaClic = (rotulo, g, tipo, valor) => {
    const sel = ATRASOS_F[tipo] === valor;
    const arg = tipo === 'dow' ? String(valor) : `'${valor}'`;
    const attrs = ` onclick="atrasosFiltrar('${tipo}',${arg})" style="cursor:pointer;${sel ? 'background:var(--brand-wine);' : ''}" title="${sel ? 'clique para soltar o recorte' : 'clique para filtrar a tela por ' + rotulo}"`;
    return linhaResumo(`${sel ? '<b>' : ''}${rotulo}${sel ? '</b> ✕' : ''}`, g, '', attrs);
  };

  alvo.innerHTML = `
  <div class="section-label" style="border-top:none; margin-top:0; padding-top:0;">Atrasos e turnos — entregas próprias${ATRASOS_UNIDADE !== 'TODAS' ? ' · ' + ATRASOS_UNIDADE : ''}, ${ddmm(ATRASOS.ini)} a ${ddmm(ATRASOS.fim)}</div>
  ${chips}
  ${foodyCobertura(ATRASOS.rows)}
  <div class="contexto" style="border-color:var(--farol-perto);" title="O prazo usado aqui é o horário prometido ao cliente no iFood, não o prazo padrão de 60 min do Foody. Os tempos são apontados por pessoas: veja a caixa Qualidade do apontamento, no fim da tela, antes de tirar conclusão fina. No TrackEat os horários de cada etapa só existem de 29/09/2026 em diante; antes disso a entrega conta, mas sem os tempos.">Fonte: TrackEat (Água Verde, Ahú e São Braz; antes de out/26 parte vinha do Foody) — só entrega com motoboy próprio; a entrega feita pelo iFood fica fora.</div>

  ${(ATRASOS_F.turno || ATRASOS_F.dow || ATRASOS_F.entregador) ? `<div class="contexto" style="border-color:var(--brand);">
    <b>Filtrando:</b>
    ${ATRASOS_F.turno ? `<button class="preset-btn active" onclick="atrasosFiltrar('turno','${ATRASOS_F.turno}')">turno ${ATRASOS_F.turno} ✕</button>` : ''}
    ${ATRASOS_F.dow ? `<button class="preset-btn active" onclick="atrasosFiltrar('dow',${ATRASOS_F.dow})">${DOW[ATRASOS_F.dow]} ✕</button>` : ''}
    ${ATRASOS_F.entregador ? `<button class="preset-btn active" onclick="atrasosFiltrar('entregador',null)">entregador ${ATRASOS_F.entregador.split('|')[1]} ✕</button>` : ''}
    <button class="preset-btn" onclick="atrasosLimparFiltros()">limpar</button>
    <div style="font-size:12px; color:var(--tx-3); margin-top:6px;">Os cartões, as tabelas e a caixa de qualidade estão neste recorte. A matriz não se recorta por turno nem por dia, e a dimensão que você fixou continua mostrando todas as suas opções — é por elas que se troca de escolha.</div>
  </div>` : ''}

  <div class="cards">
    <div class="card"><div class="card-lbl">Entregas no período</div><div class="card-val">${geral.n.toLocaleString('pt-BR')}</div><div class="card-pct">${geral.medidos.toLocaleString('pt-BR')} têm horário prometido para comparar</div></div>
    <div class="card ${geral.medidos && (geral.medidos - geral.fora) / geral.medidos >= 0.9 ? 'pos' : 'neg'}"><div class="card-lbl">Dentro do prazo</div><div class="card-val">${pctTxt(geral.medidos - geral.fora, geral.medidos)}</div><div class="card-pct">${geral.medidos ? Math.round((geral.medidos - geral.fora) / geral.medidos * 10) : '—'} de cada 10 entregas chegam no horário</div></div>
    <div class="card neutral"><div class="card-lbl">Fora do prazo</div><div class="card-val">${geral.fora.toLocaleString('pt-BR')}</div><div class="card-pct">entregas — e quem atrasa, atrasa em média ${geral.atrasoMedio === null ? '—' : n1(geral.atrasoMedio)} min</div></div>
    <div class="card neutral"><div class="card-lbl">Tempo médio na rua</div><div class="card-val">${n1(geral.rua)} min</div><div class="card-pct">da loja até a porta do cliente</div></div>
  </div>
  <div class="caption-label" style="text-align:center;">Prazo = o horário prometido ao cliente no iFood, com 5 minutos de tolerância. "Atraso médio" conta só as entregas que saíram do prazo; preparo, bancada e rua são tempos médios de todas.</div>

  <div class="section-label">Onde o atraso acontece — turno por dia da semana</div>
  <div class="caption-label" style="text-align:center;" title="A célula é a parte das entregas MEDIDAS (as que têm horário prometido) que chegou fora do prazo; embaixo vai quantas entregas o cruzamento teve. Acima de 10% fora do prazo é o mesmo corte do cartão Dentro do prazo, lá em cima. Menos de 30 entregas fica em cinza: o número existe, mas oscila demais para decidir em cima dele.">Quanto de cada cruzamento saiu do prazo. <b>Clique numa célula para fixar o turno e o dia de uma vez.</b></div>
  <div id="tabelaAtrasosMatriz"><table>
    <tr><th>Turno</th>${dowsMat.map(d => `<th>${DOW[d]}</th>`).join('')}<th>Todos os dias</th></tr>
    ${turnosMat.map(t => `<tr><td>${t}</td>${dowsMat.map(d => celulaMat(t, d)).join('')}<td>${celTxt(resumo(baseMat.filter(r => r.turno === t)))}</td></tr>`).join('')}
    <tr class="liq"><td>TODOS OS TURNOS</td>${dowsMat.map(d => `<td>${celTxt(resumo(baseMat.filter(r => r.dia_semana === d)))}</td>`).join('')}<td>${celTxt(resumo(baseMat))}</td></tr>
  </table></div>

  <div class="section-label">Por turno (turnos do iFood: almoço 10h–14h · café 15h–16h · jantar 17h–23h · madrugada 0h–1h)</div>
  <div id="tabelaAtrasosTurno"><table>
    ${cabecalho}
    ${turnos.map(t => t === null
      ? linhaResumo('— (fora das faixas)', resumo(rows.filter(r => r.turno === null && passaF(r, 'turno'))))
      : linhaClic(t, resumo(rows.filter(r => r.turno === t && passaF(r, 'turno'))), 'turno', t)).join('')}
    ${linhaResumo('TOTAL', resumo(rows.filter(r => passaF(r, 'turno'))), 'liq')}
  </table></div>

  <div class="section-label">Por dia da semana</div>
  <div id="tabelaAtrasosDow"><table>
    ${cabecalho}
    ${[1, 2, 3, 4, 5, 6, 7].map(d => rows.some(r => r.dia_semana === d)
      ? linhaClic(DOW[d], resumo(rows.filter(r => r.dia_semana === d && passaF(r, 'dow'))), 'dow', d)
      : '').join('')}
    ${linhaResumo('TOTAL', resumo(rows.filter(r => passaF(r, 'dow'))), 'liq')}
  </table></div>

  <div class="section-label">Por entregador — piores primeiro (mínimo 10 entregas no período)</div>
  <div class="caption-label" style="text-align:center;"><b>Clique numa linha para deixar a tela inteira falando daquele entregador.</b></div>
  <div id="tabelaAtrasosEntregador"><table>
    <tr><th>Entregador</th><th>Tipo</th><th>Entregas</th><th>Dentro do prazo</th><th>Fora do prazo</th><th>Atraso médio</th><th>Rua</th><th>Distância média</th></tr>
    ${(() => { ATRASOS_LISTA_ENT = entregadores.map(e => e.chave);
      return entregadores.map((e, i) => { const sel = ATRASOS_F.entregador === e.chave;
      return `<tr onclick="atrasosFiltrarEnt(${i})" style="cursor:pointer;${sel ? 'background:var(--brand-wine);' : ''}" title="${sel ? 'clique para soltar o recorte' : 'clique para filtrar a tela por este entregador'}"><td>${sel ? '<b>' : ''}${e.nome}${sel ? '</b> ✕' : ''}</td><td>${e.tipo === 'internal' ? 'próprio' : e.tipo === 'external' ? 'externo' : e.tipo}</td>
      <td>${e.g.n}</td><td>${pctTxt(e.g.medidos - e.g.fora, e.g.medidos)}</td><td>${e.g.fora}</td><td>${e.g.atrasoMedio === null ? '—' : n1(e.g.atrasoMedio) + ' min'}</td><td>${n1(e.g.rua)} min</td><td>${n1(e.dist)} km</td></tr>`; }).join(''); })()}
    <tr class="liq"><td>TODAS AS ENTREGAS</td><td>—</td>
      <td>${geralEnt.n.toLocaleString('pt-BR')}</td><td>${pctTxt(geralEnt.medidos - geralEnt.fora, geralEnt.medidos)}</td><td>${geralEnt.fora.toLocaleString('pt-BR')}</td>
      <td>${geralEnt.atrasoMedio === null ? '—' : n1(geralEnt.atrasoMedio) + ' min'}</td><td>${n1(geralEnt.rua)} min</td>
      <td>${n1(mediaDe(rowsEnt.map(r => r.dist_km)))} km</td></tr>
  </table></div>
  ${foraRanking ? `<div class="caption-label" style="text-align:center;">${foraRanking} entregador(es) com menos de 10 entregas no período ficaram fora do ranking.</div>` : ''}

  ${piores10.length ? `<div class="section-label">Os 10 que mais atrasaram${ATRASOS_F.turno || ATRASOS_F.dow || ATRASOS_F.entregador ? ' — neste recorte' : ''}</div>
  <div class="caption-label" style="text-align:center;">O código do iFood é o que se procura no portal; quando não tem, a entrega não veio de lá e aparece o número do pedido no sistema de entrega.</div>
  <div id="tabelaAtrasosPiores"><table>
    <tr><th>Dia</th><th>Turno</th><th>Entregador</th><th>Atrasou</th><th>Na rua</th><th>Distância</th><th>Código</th></tr>
    ${piores10.map(r => `<tr>
      <td>${ddmm(r.data_local)}</td><td>${r.turno || '—'}</td>
      <td>${r.entregador || '(sem apontamento)'}</td>
      <td style="color:var(--farol-fora); font-weight:600;">${n1(r.atraso_min)} min</td>
      <td>${r.rua_min === null || r.rua_min === undefined ? '—' : n1(r.rua_min) + ' min'}</td>
      <td>${r.dist_km === null || r.dist_km === undefined ? '—' : n1(r.dist_km) + ' km'}</td>
      <td>${r.localizador_ifood ? r.localizador_ifood : (r.numero ? 'nº ' + r.numero : '—')}</td></tr>`).join('')}
  </table></div>` : ''}

  <div class="section-label" title="Sem o pronto marcado, preparo e bancada daquelas entregas não existem. Pronto marcado junto do despacho, a menos de 1 min, é cheiro de correção atrasada: o pedido esperou na estufa e alguém marcou tudo de uma vez. Sem horário prometido nas observações, a entrega fica fora da conta de prazo. Quanto maiores esses números, menos dá pra confiar no preparo e na bancada; o prazo continua confiável, porque a entrega é apontada pelo motoboy na porta do cliente.">Qualidade do apontamento — o quanto dá pra confiar nos tempos</div>
  <div class="contexto">${semSentido ? `Tempos sem sentido, fora das contas: <b>${pctTxt(semSentido, geral.n)}</b> (${semSentido}) — ex.: entrega apontada 1h30 antes do horário prometido ou mais de 2h de rua; provável erro de apontamento.
  · ` : ''}Sem "pronto" marcado: <b>${pctTxt(semPronto, geral.n)}</b> (${semPronto})
  · "Pronto" junto do despacho: <b>${pctTxt(prontoJunto, geral.n)}</b> (${prontoJunto})
  · Sem horário prometido: <b>${pctTxt(semPromessa, geral.n)}</b> (${semPromessa}).</div>`;
}

// ------------------------------------------------------------------
// MODULO FINANCEIRO DA LOGISTICA (14/08/2026). Mesma fonte do Atrasos
// (foody_entregas, so Agua Verde), via vw_foody_financeiro_min. Regra de
// pagamento do dono: o motoboy recebe O MAIOR entre a soma das corridas
// (custo_entregador) e R$20 por hora trabalhada. Sem ponto batido, a hora
// e ESTIMADA pela primeira→ultima entrega DE CADA TURNO — decisao do dono
// em 14/08/2026: a tarde parada entre almoco e jantar NAO conta como
// trabalhada. O complemento do piso e portanto uma ESTIMATIVA do painel
// para vigiar a conta, nao o acerto real com o motoboy.
// REGRA DE PAGAMENTO DO MOTOBOY — dado, nao constante (12/09/2026).
// Palavras do dono ao decidir: "o frete e pago por corrida e tem um garantido de
// 20 a hora de segunda a sexta e de 25 no fim de semana; se o motoboy nao atingir
// o valor do garantido em corridas, pagamos o garantido".
// O painel tinha R$ 20 chapado e NAO conhecia o fim de semana: nas 4 semanas ate
// 06/09 na Agua Verde isso subestimava o garantido em R$ 177 (R$ 811 contra
// R$ 988 de verdade) e escondia 19 turnos que entram no piso so no fim de semana.
// Os valores agora vem de log_regras_pagamento; as constantes ficam de socorro.
let LOGFIN_REGRA = null;      // {piso_hora_semana, piso_hora_fds, teto_horas}

const LOGFIN_PISO_HORA = 20;  // socorro: R$/hora de segunda a sexta

const LOGFIN_PISO_FDS  = 25;  // socorro: R$/hora no sabado e no domingo

const LOGFIN_HORAS_MAX = 12;  // turno acima disso e apontamento sem sentido

const logfinPisoSemana = () => LOGFIN_REGRA ? Number(LOGFIN_REGRA.piso_hora_semana) : LOGFIN_PISO_HORA;

const logfinPisoFds    = () => LOGFIN_REGRA ? Number(LOGFIN_REGRA.piso_hora_fds) : LOGFIN_PISO_FDS;

const logfinTeto       = () => LOGFIN_REGRA ? Number(LOGFIN_REGRA.teto_horas) : LOGFIN_HORAS_MAX;

// Sabado e domingo pagam o garantido maior. A data vem como 'AAAA-MM-DD' e e lida
// ao meio-dia para o fuso nao empurrar o dia.
const logfinPisoDoDia = (data) => {
  const d = new Date(data + 'T12:00:00').getDay();   // 0 domingo, 6 sabado
  return (d === 0 || d === 6) ? logfinPisoFds() : logfinPisoSemana();
};

let LOGFIN = null; // { ini, fim, rows } — cache da janela buscada

let LOGFIN_UNIDADE = 'TODAS'; // filtro proprio (Foody cobre as 4 unidades desde 15/08)

function logfinUnidade(u) { LOGFIN_UNIDADE = u; renderModuloLogfin(); }
// 12/11/2026 (usabilidade, logfin): a grade por entregador abre com 6 colunas; as outras 5 a um clique
let LOGFIN_ENT_TUDO = false;
function logfinEntTudo() { LOGFIN_ENT_TUDO = !LOGFIN_ENT_TUDO; renderModuloLogfin(); }

let LOGFIN_DIARIA = 50;   // diaria por turno de escala — padrao R$50, editavel

let LOGFIN_SIM = {};      // taxa nova por taxa atual, editada na tela

let LOGFIN_TAXAS_TELA = {}; // ultimo valor mostrado de cada taxa (p/ congelar)

// SIMULACAO QUE NAO REFAZ A TELA (12/09/2026). Cada digitacao chamava
// renderModuloLogfin(), e o innerHTML novo destruia o campo seguinte ANTES de o Tab
// chegar nele: com 6 taxas para editar, a unica ferramenta de decisao desta tela so
// andava com o mouse. Agora o change recalcula e reescreve SO as celulas calculadas
// e os tres cards — nenhum <input> e tocado, entao o foco continua andando.
// LOGFIN_SIM_BASE guarda o que o recalculo precisa; o resto da tela nao muda mesmo
// (taxa e diaria nao mexem em entregas, turnos, abate nem custo de hoje).
let LOGFIN_SIM_BASE = null;

function logfinSimCalc() {
  const b = LOGFIN_SIM_BASE;
  if (!b) return null;
  const simDiarias = LOGFIN_DIARIA * b.turnosReais;
  const linhas = b.taxasTabela.map(t => {
    const nova = LOGFIN_SIM[t.chave] !== undefined ? LOGFIN_SIM[t.chave] : t.nova;
    return { chave: t.chave, n: t.n, abate3: t.abate3, nova, total: nova * t.n };
  });
  const simCustoNovo = simDiarias + linhas.reduce((s, l) => s + l.total, 0) + b.outrosSoma;
  return { simDiarias, linhas, simCustoNovo,
    simDelta: simCustoNovo - b.custoTotal,
    turnoHoje: b.turnosReais ? b.custoTotal / b.turnosReais : 0,
    turnoNovo: b.turnosReais ? simCustoNovo / b.turnosReais : 0 };
}

// Os tres cards moram numa funcao so: a primeira pintura e o recalculo leem o mesmo
// texto, entao nao ha como um discordar do outro depois de umas edicoes.
function logfinSimCardsHTML() {
  const b = LOGFIN_SIM_BASE, s = logfinSimCalc();
  if (!b || !s) return '';
  return `
    <div class="card ${s.simDelta > 0 ? 'neg' : 'pos'}"><div class="card-lbl">Custo simulado vs atual</div><div class="card-val">${s.simDelta >= 0 ? '+' : '−'} R$ ${fmt(Math.abs(s.simDelta))}</div><div class="card-pct">no período (custo atual R$ ${fmt(b.custoTotal)} → simulado R$ ${fmt(s.simCustoNovo)})${b.dias ? ' · em 30 dias, ≈ R$ ' + fmt(Math.abs(s.simDelta) / b.dias * 30) + (s.simDelta >= 0 ? ' a mais' : ' a menos') : ''} · líquido do frete acima de 3 km: R$ ${fmt(b.custoLiquido)} → R$ ${fmt(s.simCustoNovo - b.abate)}</div></div>
    <div class="card neutral"><div class="card-lbl">Turno médio do motoboy</div><div class="card-val">R$ ${fmt(s.turnoNovo)}</div><div class="card-pct">hoje o turno médio paga R$ ${fmt(s.turnoHoje)} (diária + corridas do turno)</div></div>
    <div class="card neutral"><div class="card-lbl">Mês cheio 6x1</div><div class="card-val">R$ ${fmt(s.turnoNovo * 26)}</div><div class="card-pct">26 turnos no ritmo médio · hoje seria R$ ${fmt(s.turnoHoje * 26)}</div></div>`;
}

function logfinAtualizarSim() {
  const b = LOGFIN_SIM_BASE, s = logfinSimCalc();
  if (!b || !s) { renderModuloLogfin(); return; }   // sem base, o caminho antigo
  const escreve = (id, html) => { const el = document.getElementById(id); if (el) el.innerHTML = html; };
  s.linhas.forEach((l, i) => {
    escreve('lgsimNova' + i, 'R$ ' + fmt(l.total));
    escreve('lgsimLiq' + i, `<b>${l.total - l.abate3 < 0 ? 'sobra R$ ' + fmt(l.abate3 - l.total) : 'R$ ' + fmt(l.total - l.abate3)}</b>`);
  });
  escreve('lgsimDiariasN', 'R$ ' + fmt(s.simDiarias));
  escreve('lgsimDiariasLiq', 'R$ ' + fmt(s.simDiarias));
  escreve('lgsimTotN', 'R$ ' + fmt(s.simCustoNovo));
  escreve('lgsimTotLiq', `<b>R$ ${fmt(s.simCustoNovo - b.abate)}</b>`);
  escreve('lgsimCards', logfinSimCardsHTML());
}

function logfinTaxa(atual, v) {
  const num = Number(String(v).replace(',', '.'));
  if (!isNaN(num) && num >= 0) LOGFIN_SIM[atual] = num;
  logfinAtualizarSim();
}

function logfinDiaria(v) {
  const num = Number(String(v).replace(',', '.'));
  if (isNaN(num) || num < 0) return;
  // congela as taxas que estao na tela: mexer na diaria deve mexer SO na
  // linha das diarias (senao o proporcional recalcula por baixo e o total
  // quase nao se move — confuso de conferir). E e o que deixa os <input> de
  // taxa intocados no recalculo: o valor deles nao muda mais sozinho.
  Object.entries(LOGFIN_TAXAS_TELA).forEach(([k, t]) => { if (LOGFIN_SIM[k] === undefined) LOGFIN_SIM[k] = t; });
  LOGFIN_DIARIA = num;
  logfinAtualizarSim();
}

function logfinSimReset() { LOGFIN_SIM = {}; LOGFIN_DIARIA = 50; renderModuloLogfin(); }

async function entrarLogfin() {
  const alvo = document.getElementById('view-logfin');
  if (!alvo) return;
  const ini = fDataIni.value, fim = fDataFim.value;
  if (!LOGFIN || LOGFIN.ini !== ini || LOGFIN.fim !== fim) {
    alvo.innerHTML = '<div class="contexto">Carregando as entregas do período...</div>';
    const rows = await consultarTudo(`vw_foody_financeiro_min?select=unidade,data_local,turno,entregador,entregador_tipo,inicio_corrida,entrega,custo_entregador,taxa_entrega,dist_km&data_local=gte.${ini}&data_local=lte.${fim}&order=data_local`);
    if (LOGFIN_REGRA === null) {
      // regra vigente hoje; a tabela guarda historico por data de vigencia
      try {
        const rg = await consultarTudo('log_regras_pagamento?select=*&order=vigente_desde.desc&limit=1');
        if (rg && rg.length) LOGFIN_REGRA = rg[0];
      } catch (e) { LOGFIN_REGRA = null; }   // cai nas constantes de socorro
    }
    LOGFIN = { ini, fim, rows };
  }
  renderModuloLogfin();
}

function renderModuloLogfin() {
  const alvo = document.getElementById('view-logfin');
  if (!alvo || LOGFIN === null) return;
  // janela mudou depois da busca — rebusca em vez de mostrar dado velho
  if (LOGFIN.ini !== fDataIni.value || LOGFIN.fim !== fDataFim.value) { entrarLogfin(); return; }
  const base = foodyNoPerimetro(LOGFIN.rows);
  if (LOGFIN_UNIDADE !== 'TODAS' && !base.some(r => r.unidade === LOGFIN_UNIDADE)) LOGFIN_UNIDADE = 'TODAS';
  const rows = base.filter(r => LOGFIN_UNIDADE === 'TODAS' || r.unidade === LOGFIN_UNIDADE);
  const chips = chipsUnidadeFoody(base, LOGFIN_UNIDADE, 'logfinUnidade');
  const ddmm = (v) => v ? v.slice(8, 10) + '/' + v.slice(5, 7) : '—';
  if (!rows.length) {
    alvo.innerHTML = `<div class="contexto">Sem entregas próprias entre ${ddmm(LOGFIN.ini)} e ${ddmm(LOGFIN.fim)} — os dados do TrackEat ainda não chegaram para esse período.</div>`;
    return;
  }

  const n1 = (v) => v === null ? '—' : v.toFixed(1).replace('.', ',');
  const pctTxt = (parte, todo) => todo ? (parte / todo * 100).toFixed(1).replace('.', ',') + '%' : '—';

  // 1 grupo = 1 entregador num turno de um dia — a unidade da regra de
  // pagamento. horas = ultima entrega − primeiro aceite/coleta do turno;
  // fica de fora da conta quando falta horario ou o valor nao faz sentido
  // (mesma filosofia da FAIXA do modulo Atrasos: contado e dito na tela).
  const semEntregador = rows.filter(r => !r.entregador).length;
  const semCusto = rows.filter(r => r.entregador && r.custo_entregador === null).length;
  const grupos = {};
  rows.filter(r => r.entregador).forEach(r => {
    // unidade na chave: com "Todas" selecionado, um mesmo nome em duas
    // lojas sao turnos (e pagamentos) separados
    const chave = r.unidade + '|' + r.entregador + '|' + r.data_local + '|' + (r.turno || '—');
    const g = grupos[chave] || (grupos[chave] = {
      unidade: r.unidade, entregador: r.entregador, tipo: r.entregador_tipo,
      data: r.data_local, turno: r.turno || '—', n: 0, ganho: 0, ini: null, fim: null });
    g.n += 1;
    g.ganho += Number(r.custo_entregador) || 0;
    if (r.inicio_corrida && r.entrega) {
      const a = new Date(r.inicio_corrida).getTime(), b = new Date(r.entrega).getTime();
      if (g.ini === null || a < g.ini) g.ini = a;
      if (g.fim === null || b > g.fim) g.fim = b;
    }
  });
  let turnosSemHora = 0, turnosSemSentido = 0;
  const lista = Object.values(grupos);
  lista.forEach(g => {
    g.horas = (g.ini !== null && g.fim !== null) ? (g.fim - g.ini) / 36e5 : null;
    if (g.horas === null) turnosSemHora += 1;
    else if (g.horas < 0 || g.horas > logfinTeto()) { turnosSemSentido += 1; g.horas = null; }
    // A regra do pagamento, turno a turno: o maior entre as corridas e o garantido
    // da hora — R$ 20 de segunda a sexta, R$ 25 no sabado e no domingo.
    g.piso = logfinPisoDoDia(g.data);
    g.complemento = g.horas === null ? 0 : Math.max(0, g.piso * g.horas - g.ganho);
    g.pago = g.ganho + g.complemento;
  });

  const soma = (arr, f) => arr.reduce((s, x) => s + f(x), 0);
  const entregas = rows.length;
  const dias = new Set(rows.map(r => r.data_local)).size;
  const corridas = soma(rows, r => Number(r.custo_entregador) || 0);
  const complemento = soma(lista, g => g.complemento);
  const custoTotal = corridas + complemento;
  // Regra do dono (14/08/2026): o frete cobrado do cliente ACIMA de 3 km
  // abate o custo da logistica — ate 3 km o frete e subsidiado na promo
  // (verba contada no modulo de promocoes, nao aqui). O frete dessas
  // corridas vem cheio na taxa_entrega do Foody.
  const acima3 = rows.filter(r => Number(r.dist_km) > 3);
  const abate = soma(acima3, r => Number(r.taxa_entrega) || 0);
  const custoLiquido = custoTotal - abate;

  // metricas de horas SEMPRE so sobre os turnos que tem hora valida —
  // misturar quem nao tem horario deixaria o R$/hora inconferivel.
  const resumoHoras = (gs) => {
    const ok = gs.filter(g => g.horas !== null);
    const horas = soma(ok, g => g.horas);
    return {
      horas: ok.length ? horas : null,
      entregasHora: horas > 0 ? soma(ok, g => g.n) / horas : null,
      reaisHora: horas > 0 ? soma(ok, g => g.pago) / horas : null,
    };
  };

  const ORDEM_TURNO = ['ALMOÇO', 'CAFÉ DA TARDE', 'JANTAR', 'MADRUGADA', '—'];
  const turnos = [...new Set(lista.map(g => g.turno))]
    .sort((a, b) => ORDEM_TURNO.indexOf(a) - ORDEM_TURNO.indexOf(b));

  const linhaTurno = (rotulo, gs, classe = '') => {
    const n = soma(gs, g => g.n), ganho = soma(gs, g => g.ganho), comp = soma(gs, g => g.complemento);
    const h = resumoHoras(gs);
    return `<tr class="${classe}"><td>${rotulo}</td><td>${n.toLocaleString('pt-BR')}</td>
      <td>R$ ${fmt(ganho)}</td><td>R$ ${fmt(n ? ganho / n : 0)}</td>
      <td>${h.horas === null ? '—' : n1(h.horas) + ' h'}</td>
      <td>${h.entregasHora === null ? '—' : n1(h.entregasHora)}</td>
      <td>${h.reaisHora === null ? '—' : 'R$ ' + fmt(h.reaisHora)}</td>
      <td>${comp > 0 ? 'R$ ' + fmt(comp) : '—'}</td></tr>`;
  };

  // por entregador: a tabela e a conta de pagamento, entao TODO MUNDO
  // aparece (sem corte de minimo de entregas — dinheiro tem que fechar).
  const porEntregador = {};
  lista.forEach(g => {
    const k = g.unidade + '|' + g.entregador;
    (porEntregador[k] = porEntregador[k] || []).push(g);
  });
  const multiUnidade = new Set(rows.map(r => r.unidade)).size > 1;
  const entregadores = Object.values(porEntregador).map(gs => {
    const h = resumoHoras(gs);
    return { nome: gs[0].entregador + (multiUnidade ? ' · ' + gs[0].unidade : ''),
             tipo: gs[0].tipo, turnos: gs.length,
             dias: new Set(gs.map(g => g.data)).size,
             n: soma(gs, g => g.n), ganho: soma(gs, g => g.ganho),
             comp: soma(gs, g => g.complemento), h };
  // Ordem pelo COMPLEMENTO do garantido, maior primeiro (12/09/2026): a tabela e a
  // conta de pagamento, e o complemento e' o dinheiro que a loja poe alem das
  // corridas — quem tem zero nao custa nada a mais e vai para o fim. Entre dois com
  // o mesmo complemento (o zero, quase sempre), desempata pelo volume de entregas,
  // que era a ordem antiga.
  }).sort((a, b) => (b.comp - a.comp) || (b.n - a.n));

  // evolucao semanal (semana seg–dom, mesma convencao do resto do painel)
  const segundaDe = (s) => { const d = new Date(s + 'T00:00:00'); d.setDate(d.getDate() - (d.getDay() + 6) % 7); return d.toISOString().slice(0, 10); };
  const semanas = {};
  rows.forEach(r => {
    const w = semanas[segundaDe(r.data_local)] || (semanas[segundaDe(r.data_local)] = { n: 0, ganho: 0, comp: 0 });
    w.n += 1; w.ganho += Number(r.custo_entregador) || 0;
  });
  lista.forEach(g => { const w = semanas[segundaDe(g.data)]; if (w) w.comp += g.complemento; });
  const chavesSemana = Object.keys(semanas).sort();

  // ---- SIMULACAO (14/08/2026, pedida pelo dono): diaria fixa por turno de
  // ESCALA + tabela de corrida reajustada na mesma proporcao, mirando o
  // MESMO custo total de hoje. Janela do iFood nao e turno de escala (quem
  // roda 10h–16h atravessa almoco e cafe): almoco+cafe = DIA,
  // jantar+madrugada = NOITE — senao a diaria seria contada duas vezes.
  const TURNO_REAL = { 'ALMOÇO': 'DIA', 'CAFÉ DA TARDE': 'DIA', 'JANTAR': 'NOITE', 'MADRUGADA': 'NOITE' };
  const turnosReais = new Set(lista.map(g => g.unidade + '|' + g.entregador + '|' + g.data + '|' + (TURNO_REAL[g.turno] || g.turno))).size;
  const simDiarias = LOGFIN_DIARIA * turnosReais;
  // ponto de partida das taxas editaveis: o reajuste proporcional que
  // fecha no custo de hoje (arredondado ao quarto de real). Dali em
  // diante quem manda e o que o dono digitar na tela (LOGFIN_SIM).
  const simFator = corridas > 0 ? Math.max(0, (custoTotal - simDiarias) / corridas) : 0;
  // a tabela real de hoje sai dos proprios dados: os valores discretos de
  // custo_entregador. Valores raros (bonus, ajuste) ficam como estao.
  const porTaxa = {};
  let outrosN = 0, outrosSoma = 0, outrosAbate = 0;
  rows.forEach(r => {
    if (r.custo_entregador === null) return;
    const v = Number(r.custo_entregador);
    const x = (porTaxa[v.toFixed(2)] = porTaxa[v.toFixed(2)] || { n: 0, abate3: 0 });
    x.n += 1;
    // a mesma regra do frete, faixa a faixa: o que o cliente paga acima
    // de 3 km abate o custo daquele raio
    if (Number(r.dist_km) > 3) x.abate3 += Number(r.taxa_entrega) || 0;
  });
  const taxasTabela = Object.entries(porTaxa)
    .filter(([, x]) => x.n >= Math.max(10, entregas * 0.005))
    .map(([v, x]) => ({ v: Number(v), n: x.n, abate3: x.abate3 }))
    .sort((a, b) => a.v - b.v);
  Object.entries(porTaxa).forEach(([v, x]) => {
    if (!taxasTabela.some(t => t.v === Number(v))) { outrosN += x.n; outrosSoma += Number(v) * x.n; outrosAbate += x.abate3; }
  });
  taxasTabela.forEach(t => {
    const chave = t.v.toFixed(2);
    t.nova = LOGFIN_SIM[chave] !== undefined ? LOGFIN_SIM[chave] : Math.round(t.v * simFator * 4) / 4;
    t.chave = chave;
    LOGFIN_TAXAS_TELA[chave] = t.nova;
  });
  const simCorridas = taxasTabela.reduce((s, t) => s + t.nova * t.n, 0) + outrosSoma;
  const simCustoNovo = simDiarias + simCorridas;
  // Base do recalculo sem refazer a tela. O delta e os dois "turno medio" saiam
  // daqui e agora saem de logfinSimCalc(), para a primeira pintura e cada edicao
  // lerem exatamente a mesma conta.
  LOGFIN_SIM_BASE = { taxasTabela, outrosSoma, turnosReais, custoTotal, custoLiquido, abate, dias };

  alvo.innerHTML = `
  <div class="section-label" style="border-top:none; margin-top:0; padding-top:0;">Financeiro da logística — entregas próprias${LOGFIN_UNIDADE !== 'TODAS' ? ' · ' + LOGFIN_UNIDADE : ''}, ${ddmm(LOGFIN.ini)} a ${ddmm(LOGFIN.fim)}</div>
  ${chips}
  ${foodyCobertura(LOGFIN.rows)}
  <div class="contexto" style="border-color:var(--farol-perto);" title="Regra combinada de pagamento: o motoboy recebe o maior entre as corridas e o garantido por hora, turno a turno — R$ ${fmt(logfinPisoSemana())} de segunda a sexta e R$ ${fmt(logfinPisoFds())} no sábado e no domingo. A tarde parada entre almoço e jantar não conta como trabalhada. A hora é estimada da primeira à última entrega do turno, não é ponto batido: o complemento é a estimativa do painel para vigiar a conta, não o acerto real.">Fonte: TrackEat (Água Verde, Ahú e São Braz; antes de out/26 parte vinha do Foody) — só entrega com motoboy próprio.</div>

  <div class="cards">
    <div class="card"><div class="card-lbl">Entregas no período</div><div class="card-val">${entregas.toLocaleString('pt-BR')}</div><div class="card-pct">média de ${n1(dias ? entregas / dias : null)} por dia, em ${dias} dia(s) com entrega</div></div>
    <div class="card neutral"><div class="card-lbl">Pago em corridas</div><div class="card-val">R$ ${fmt(corridas)}</div><div class="card-pct">média de R$ ${fmt(entregas ? corridas / entregas : 0)} por entrega</div></div>
    <div class="card ${complemento > corridas * 0.05 ? 'neg' : 'neutral'}"><div class="card-lbl">Custo total estimado</div><div class="card-val">R$ ${fmt(custoTotal)}</div><div class="card-pct">corridas + R$ ${fmt(complemento)} de complemento do garantido</div></div>
    <div class="card neutral"><div class="card-lbl">Custo líquido do frete</div><div class="card-val">R$ ${fmt(custoLiquido)}</div><div class="card-pct">o frete cobrado do cliente acima de 3 km (R$ ${fmt(abate)} em ${acima3.length.toLocaleString('pt-BR')} corridas) abate o custo</div></div>
  </div>
  <div class="caption-label" style="text-align:center;" title="Corridas = soma do valor pago por entrega registrado no sistema de entrega (TrackEat). Complemento = quanto o garantido por hora paga além das corridas, calculado turno a turno; os valores vêm da regra de pagamento cadastrada. Até 3 km o frete do cliente é subsidiado na promoção (a verba está no módulo de promoções), por isso só o frete acima de 3 km abate aqui.">Garantido por hora: R$ ${fmt(logfinPisoSemana())} de segunda a sexta e R$ ${fmt(logfinPisoFds())} no fim de semana; só o frete acima de 3 km abate o custo.</div>

  <div class="section-label">Por turno (janelas do iFood: almoço 10h–14h · café 15h–16h · jantar 17h–23h · madrugada 0h–1h)</div>
  <div id="tabelaLogfinTurno"><table>
    <tr><th>Turno</th><th>Entregas</th><th>Corridas</th><th>R$ por entrega</th><th>Horas estimadas</th><th>Entregas por hora</th><th>R$ por hora</th><th>Complemento</th></tr>
    ${turnos.map(t => linhaTurno(t === '—' ? '— (fora das faixas)' : t, lista.filter(g => g.turno === t))).join('')}
    ${linhaTurno('TOTAL', lista, 'liq')}
  </table></div>

  <div class="section-label" title="O complemento é o quanto o garantido por hora paga além das corridas, turno a turno. Quem aparece com traço fechou o turno só com as corridas e não custou nada a mais. Entre dois com o mesmo complemento, o de mais entregas vem primeiro.">Estimativa por entregador (maior complemento do garantido primeiro)</div>
  <div id="tabelaLogfinEntregador"><table>
    ${(() => { const X = LOGFIN_ENT_TUDO;   // X = as 5 colunas extras (Tipo, Dias, Turnos, Horas, Entregas/h)
      const t = entregadores.reduce((a, e) => ({ turnos: a.turnos + e.turnos, n: a.n + e.n,
        ganho: a.ganho + e.ganho, comp: a.comp + e.comp, horas: a.horas + (e.h.horas || 0) }),
        { turnos: 0, n: 0, ganho: 0, comp: 0, horas: 0 });
      return `<tr><th>Entregador</th>${X ? '<th>Tipo</th><th>Dias</th><th>Turnos</th>' : ''}<th>Entregas</th><th>Corridas</th><th>Complemento</th><th>Total</th>${X ? '<th>Horas</th><th>Entregas/h</th>' : ''}<th>R$/h</th></tr>`
      + entregadores.map(e => `<tr><td>${e.nome}</td>${X ? `<td>${e.tipo === 'internal' ? 'próprio' : e.tipo === 'external' ? 'externo' : '—'}</td>
        <td>${e.dias}</td><td>${e.turnos}</td>` : ''}<td>${e.n.toLocaleString('pt-BR')}</td>
        <td>R$ ${fmt(e.ganho)}</td><td>${e.comp > 0 ? 'R$ ' + fmt(e.comp) : '—'}</td><td><b>R$ ${fmt(e.ganho + e.comp)}</b></td>
        ${X ? `<td>${e.h.horas === null ? '—' : n1(e.h.horas)}</td>
        <td>${e.h.entregasHora === null ? '—' : n1(e.h.entregasHora)}</td>` : ''}
        <td>${e.h.reaisHora === null ? '—' : 'R$ ' + fmt(e.h.reaisHora)}</td></tr>`).join('')
      + `<tr class="liq"><td>TOTAL</td>${X ? `<td>—</td><td>—</td><td>${t.turnos}</td>` : ''}<td>${t.n.toLocaleString('pt-BR')}</td>
        <td>R$ ${fmt(t.ganho)}</td><td>R$ ${fmt(t.comp)}</td><td><b>R$ ${fmt(t.ganho + t.comp)}</b></td>
        ${X ? `<td>${t.horas ? n1(t.horas) : '—'}</td><td>${t.horas ? n1(t.n / t.horas) : '—'}</td>` : ''}
        <td>${t.horas ? 'R$ ' + fmt((t.ganho + t.comp) / t.horas) : '—'}</td></tr>`; })()}
  </table></div>
  <div style="font-size:12px; margin:4px 0;"><a href="javascript:void(0)" onclick="logfinEntTudo()">${LOGFIN_ENT_TUDO ? 'ver só as 6 colunas principais' : 'ver também tipo, dias, turnos, horas e entregas por hora'}</a></div>
  <div class="caption-label" style="text-align:center;" title="Horas e R$/h contam só os turnos com horário confiável.">R$/h perto do garantido (R$ ${fmt(logfinPisoSemana())} semana, R$ ${fmt(logfinPisoFds())} fim de semana) = o garantido paga essa pessoa.</div>

  <div class="section-label">Semana a semana (seg–dom)</div>
  <div id="tabelaLogfinSemana"><table>
    <tr><th>Semana</th><th>Entregas</th><th>Corridas</th><th>Complemento</th><th>Custo total</th><th>Custo por entrega</th></tr>
    ${chavesSemana.map(w => { const s = semanas[w]; const tot = s.ganho + s.comp;
      return `<tr><td>${ddmm(w)}</td><td>${s.n.toLocaleString('pt-BR')}</td><td>R$ ${fmt(s.ganho)}</td>
        <td>${s.comp > 0 ? 'R$ ' + fmt(s.comp) : '—'}</td><td>R$ ${fmt(tot)}</td><td>R$ ${fmt(s.n ? tot / s.n : 0)}</td></tr>`; }).join('')}
    ${(() => { const t = chavesSemana.reduce((a, w) => { const s = semanas[w];
        return { n: a.n + s.n, g: a.g + s.ganho, c: a.c + s.comp }; }, { n: 0, g: 0, c: 0 });
      return `<tr class="liq"><td>TOTAL</td><td>${t.n.toLocaleString('pt-BR')}</td><td>R$ ${fmt(t.g)}</td>
        <td>R$ ${fmt(t.c)}</td><td>R$ ${fmt(t.g + t.c)}</td><td>R$ ${fmt(t.n ? (t.g + t.c) / t.n : 0)}</td></tr>`; })()}
  </table></div>

  <details class="detalhes-extra" style="margin-top:16px;" ontoggle="window.LOGFIN_SIM_ABERTA=this.open"${window.LOGFIN_SIM_ABERTA ? ' open' : ''}>
  <summary>Simulação — diária por turno + taxa por corrida (editável)</summary>
  <div class="contexto" title="Cada motoboy ganha uma diária por turno de escala (dia = almoço+café, noite = jantar+madrugada; a janela do iFood não vale como turno, senão a diária contaria duas vezes) mais a taxa por corrida. As taxas começam no reajuste proporcional que, com diária de R$ 50, empata com o custo de hoje.">Edite a coluna <b>Taxa nova</b> e a diária na última linha e veja na hora quanto muda — foram <b>${turnosReais} turnos</b> no período.
  <button class="preset-btn" onclick="logfinSimReset()" style="margin-left:8px;">voltar ao padrão (diária 50 + proporcional)</button></div>
  <div id="tabelaLogfinSim"><table>
    <tr><th>Taxa de hoje</th><th>Corridas no período</th><th>Taxa nova</th><th>Corridas com a nova</th><th>Frete do cliente abate (&gt;3 km)</th><th>Custo líquido da faixa</th></tr>
    ${taxasTabela.map((t, i) => `<tr><td>R$ ${fmt(t.v)}</td><td>${t.n.toLocaleString('pt-BR')}</td>
      <td>R$ <input type="number" value="${t.nova.toFixed(2)}" min="0" step="0.25" style="width:75px; font-size:14px;" onchange="logfinTaxa('${t.chave}', this.value)"></td>
      <td id="lgsimNova${i}">R$ ${fmt(t.nova * t.n)}</td>
      <td>${t.abate3 > 0 ? '− R$ ' + fmt(t.abate3) : '—'}</td>
      <td id="lgsimLiq${i}"><b>${t.nova * t.n - t.abate3 < 0 ? 'sobra R$ ' + fmt(t.abate3 - t.nova * t.n) : 'R$ ' + fmt(t.nova * t.n - t.abate3)}</b></td></tr>`).join('')}
    ${outrosN ? `<tr><td>outros valores</td><td>${outrosN.toLocaleString('pt-BR')}</td><td>como estão</td><td>R$ ${fmt(outrosSoma)}</td><td>${outrosAbate > 0 ? '− R$ ' + fmt(outrosAbate) : '—'}</td><td>${outrosSoma - outrosAbate < 0 ? 'sobra R$ ' + fmt(outrosAbate - outrosSoma) : 'R$ ' + fmt(outrosSoma - outrosAbate)}</td></tr>` : ''}
    <tr><td><b>Diárias</b></td><td>${turnosReais.toLocaleString('pt-BR')} turnos</td>
      <td>R$ <input type="number" value="${LOGFIN_DIARIA.toFixed(2)}" min="0" step="5" style="width:75px; font-size:14px;" onchange="logfinDiaria(this.value)"></td>
      <td id="lgsimDiariasN">R$ ${fmt(simDiarias)}</td><td>—</td><td id="lgsimDiariasLiq">R$ ${fmt(simDiarias)}</td></tr>
    <tr class="liq"><td><b>Total simulado</b></td><td>${entregas.toLocaleString('pt-BR')}</td><td>diárias + corridas</td><td id="lgsimTotN">R$ ${fmt(simCustoNovo)}</td><td>${abate > 0 ? '− R$ ' + fmt(abate) : '—'}</td><td id="lgsimTotLiq"><b>R$ ${fmt(simCustoNovo - abate)}</b></td></tr>
  </table></div>
  <div class="cards" id="lgsimCards">${logfinSimCardsHTML()}</div>
  <div class="caption-label" style="text-align:center;">A diária substitui o garantido por hora; o turno médio reparte o custo pelos ${turnosReais} turnos.</div>
  </details>

  <div class="section-label">Qualidade do apontamento — o quanto dá pra confiar nessa conta</div>
  <div class="contexto" title="As corridas das entregas sem entregador apontado entram no total, mas ficam fora da conta por pessoa. Turno sem horário confiável fica fora das horas e do complemento: hoje são ${turnosSemHora} sem horário e ${turnosSemSentido} com hora sem sentido (mais de ${fmt(logfinTeto())}h no turno). Turno com uma entrega só tem hora do tamanho daquela corrida, então o garantido quase não aparece nele: é o limite da régua primeira-última entrega, que ponto batido resolveria.">Entregas sem entregador apontado: <b>${pctTxt(semEntregador, entregas)}</b> (${semEntregador}).
  ${semCusto ? ` · Entregas sem valor de corrida registrado: <b>${semCusto}</b>.` : ''}
  · Turnos sem horário confiável: <b>${turnosSemHora + turnosSemSentido}</b> de ${lista.length}.</div>`;
}

// ------------------------------------------------------------------
// MODULO QUALIDADE & SUPER (12/08/2026). O nivel Super era um dado orfao:
// importado toda semana (fato_qualidade_semana) e exibido em lugar nenhum —
// na semana 03-09/08 duas lojas cairam de nivel e uma ficou Nao elegivel
// sem ninguem ver. Quem caiu de nivel grita primeiro.
let QUALIDADE = null;

function rankNivel(n) {
  if (!n) return -1;
  const m = String(n).match(/(\d)/);
  return m ? Number(m[1]) : 0; // 'Nao elegivel' -> 0
}

async function entrarQualidade() {
  const alvo = document.getElementById('view-qualidade');
  if (!alvo) return;
  if (QUALIDADE === null) {
    alvo.innerHTML = '<div class="contexto">Carregando qualidade...</div>';
    QUALIDADE = await consultarTudo('vw_qualidade_semana?select=periodo_ini,periodo_fim,nome_loja,unidade,nivel_super,pedidos_totais,pct_cancelamentos_super,pct_atrasados_5min,tempo_medio_atraso_min,media_avaliacoes,qtd_avaliacoes,pct_respostas_negociacoes&order=periodo_ini.desc');
  }
  renderModuloQualidade();
}

// A SERIE DA LOJA (12/09/2026). A tela mostrava so' semana atual x anterior, e o
// resto do dado ja estava carregado: a consulta traz TODOS os periodos
// (order=periodo_ini.desc) e renderModuloQualidade usava dois. Clicar na linha abre
// as 8 ultimas semanas daquela loja — nivel e os quatro criterios — que e' o que
// separa tropeco de tendencia. Mecanismo do modulo Evolucao: clicar de novo solta.
// O nome vai por INDICE, nunca como string dentro do onclick.
let QUAL_LOJA = null;

let QUAL_LISTA = [];

function qualAbrirLoja(i) {
  const nome = QUAL_LISTA[i];
  if (!nome) return;
  QUAL_LOJA = (QUAL_LOJA === nome) ? null : nome;
  renderModuloQualidade();
}

function qualFecharLoja() { QUAL_LOJA = null; renderModuloQualidade(); }

function renderModuloQualidade() {
  const alvo = document.getElementById('view-qualidade');
  const activeL = activeLojas();
  const rows = QUALIDADE.filter(r => activeL.has(LOJAS.indexOf(r.nome_loja)));
  if (!rows.length) {
    alvo.innerHTML = '<div class="contexto">Sem dados de qualidade para o recorte atual.</div>';
    return;
  }

  const periodos = [...new Set(rows.map(r => r.periodo_ini))].sort().reverse();
  const atualIni = periodos[0], antIni = periodos[1] || null;
  const atual = rows.filter(r => r.periodo_ini === atualIni);
  const antPor = {};
  rows.filter(r => r.periodo_ini === antIni).forEach(r => { antPor[r.nome_loja] = r; });

  const ddmm = (v) => v ? v.slice(8, 10) + '/' + v.slice(5, 7) : '—';
  const num = (v, c = 1) => (v === null || v === undefined) ? '—' : Number(v).toFixed(c).replace('.', ',');

  const n5 = atual.filter(r => rankNivel(r.nivel_super) === 5).length;
  const n4 = atual.filter(r => rankNivel(r.nivel_super) === 4).length;
  const baixo = atual.filter(r => rankNivel(r.nivel_super) <= 3).length;

  // Os 4 criterios de qualidade que a tabela ja mostra sao os que derrubam o nivel
  // Super. Unidades diferentes (% e minutos) nao se somam, entao "qual mais piorou"
  // e decidido pela variacao de cada criterio contra ELE MESMO na semana anterior.
  // Tres sao menor-melhor; a taxa de resposta as negociacoes e maior-melhor.
  const CRIT_SUPER = [
    { campo: 'pct_atrasados_5min', rotulo: 'atraso acima de 5 min', un: '%', casas: 1, menorMelhor: true },
    { campo: 'tempo_medio_atraso_min', rotulo: 'atraso médio', un: ' min', casas: 0, menorMelhor: true },
    { campo: 'pct_cancelamentos_super', rotulo: 'cancelamentos', un: '%', casas: 2, menorMelhor: true },
    { campo: 'pct_respostas_negociacoes', rotulo: 'resposta às negociações', un: '%', casas: 1, menorMelhor: false },
  ];
  // Number(null) e 0, nao NaN. Sem esta conversao uma semana SEM o indicador (loja
  // que nao teve negociacao nenhuma, por exemplo) viraria "caiu de 95% para 0%" —
  // comparacao inventada a partir de dado que nao existe.
  const numCrit = (x) => (x === null || x === undefined || x === '') ? NaN : Number(x);
  const piorCriterio = (r, a) => {
    let pior = null;
    CRIT_SUPER.forEach(c => {
      const v = numCrit(r[c.campo]), p = numCrit(a[c.campo]);
      if (!isFinite(v) || !isFinite(p)) return;
      const piora = c.menorMelhor ? v - p : p - v;          // positivo = piorou
      if (piora <= 0) return;
      const rel = Math.abs(p) > 0.005 ? piora / Math.abs(p) * 100 : 100;
      if (!pior || rel > pior.rel) pior = { rel: rel, c: c, v: v, p: p };
    });
    if (!pior) return null;
    const f = (x) => Number(x).toFixed(pior.c.casas).replace('.', ',') + pior.c.un;
    return { rotulo: pior.c.rotulo,
             detalhe: pior.c.rotulo + ': ' + f(pior.p) + ' na semana anterior, ' + f(pior.v) + ' nesta' };
  };

  const mudancas = atual.map(r => {
    const a = antPor[r.nome_loja];
    return a ? { loja: r.nome_loja, de: a.nivel_super, para: r.nivel_super,
                 delta: rankNivel(r.nivel_super) - rankNivel(a.nivel_super),
                 pior: piorCriterio(r, a) } : null;
  }).filter(m => m && m.delta !== 0);
  const caiu = mudancas.filter(m => m.delta < 0);
  const subiu = mudancas.filter(m => m.delta > 0);

  const ordenado = [...atual].sort((a, b) =>
    rankNivel(a.nivel_super) - rankNivel(b.nivel_super) ||
    (Number(b.pct_atrasados_5min) || 0) - (Number(a.pct_atrasados_5min) || 0));

  // AS 8 ULTIMAS SEMANAS DA LOJA ESCOLHIDA. Nenhuma consulta nova e nenhuma conta
  // nova: sai de `rows`, a mesma lista da tabela de cima, que ja respeita o filtro
  // de unidade do topo. Loja que saiu do recorte (mudou o filtro) solta sozinha,
  // em vez de abrir um bloco vazio.
  QUAL_LISTA = ordenado.map(r => r.nome_loja);
  if (QUAL_LOJA && !QUAL_LISTA.includes(QUAL_LOJA)) QUAL_LOJA = null;
  let blocoSerie = '';
  if (QUAL_LOJA) {
    const serie = rows.filter(r => r.nome_loja === QUAL_LOJA)
      .sort((x, y) => String(y.periodo_ini || '').localeCompare(String(x.periodo_ini || '')))
      .slice(0, 8);
    const corNivel = (n) => rankNivel(n) >= 5 ? 'var(--farol-ok)' : rankNivel(n) === 4 ? 'var(--tx-2)' : 'var(--farol-fora)';
    blocoSerie = `
  <div class="section-label">${QUAL_LOJA} — as últimas ${serie.length} semanas</div>
  <div class="contexto" style="border-color:var(--brand);">
    <b>Abrindo ${QUAL_LOJA}</b> — nível e os quatro critérios, semana a semana.
    <button class="preset-btn active" onclick="qualFecharLoja()">${QUAL_LOJA} ✕</button>
    <div style="font-size:12px; color:var(--tx-3); margin-top:6px;" title="Mesma fonte da tabela acima (relatório semanal de qualidade da rede) e mesmo recorte de unidades do topo. Uma semana ruim no meio de semanas boas é tropeço; três em fila é tendência.">
      Da semana mais recente para a mais antiga.
    </div>
  </div>
  <div id="tabelaQualidadeSerie"><table>
    <tr><th>Semana</th><th>Nível</th><th>% atraso +5min</th><th>Atraso médio</th><th>% canc. Super</th><th>Nota</th><th>% resp. negoc.</th></tr>
    ${serie.map(r => `<tr><td>${ddmm(r.periodo_ini)} a ${ddmm(r.periodo_fim)}</td>
      <td style="color:${corNivel(r.nivel_super)}; font-weight:bold;">${r.nivel_super}</td>
      <td>${num(r.pct_atrasados_5min)}%</td>
      <td>${num(r.tempo_medio_atraso_min, 0)} min</td>
      <td>${num(r.pct_cancelamentos_super, 2)}%</td>
      <td>${num(r.media_avaliacoes, 2)}${r.qtd_avaliacoes ? ' <span style="color:var(--tx-5); font-size:10px;">(' + r.qtd_avaliacoes + ')</span>' : ''}</td>
      <td>${num(r.pct_respostas_negociacoes)}%</td></tr>`).join('')}
  </table></div>`;
  }

  alvo.innerHTML = `
  <div class="section-label" style="border-top:none; margin-top:0; padding-top:0;">Qualidade &amp; Super — semana ${ddmm(atualIni)}${antIni ? ' (vs ' + ddmm(antIni) + ')' : ''}</div>
  <div class="caption-label" style="text-align:center;">O nível Super afeta visibilidade e condições no iFood. Fonte: relatório semanal de qualidade da rede.</div>
  <div class="cards">
    <div class="card pos"><div class="card-lbl">Nível 5</div><div class="card-val">${n5}</div><div class="card-pct">loja(s)</div></div>
    <div class="card neutral"><div class="card-lbl">Nível 4</div><div class="card-val">${n4}</div><div class="card-pct">loja(s)</div></div>
    <div class="card ${baixo ? 'neg' : 'pos'}"><div class="card-lbl">Nível 3 ou abaixo</div><div class="card-val">${baixo}</div><div class="card-pct">inclui "Não elegível"</div></div>
  </div>
  ${caiu.length ? `<div class="contexto" style="border-color:var(--farol-fora);"><b>Caíram de nível:</b> ${caiu.map(m => '<span' + (m.pior ? ' title="' + m.pior.detalhe + '"' : '') + '>' + m.loja + ' (' + m.de + ' → ' + m.para + ')' + (m.pior ? ' — piorou em ' + m.pior.rotulo : '') + '</span>').join(' · ')}</div>` : ''}
  ${subiu.length ? `<div class="contexto" style="border-color:var(--farol-ok);"><b>Subiram de nível:</b> ${subiu.map(m => `${m.loja} (${m.de} → ${m.para})`).join(' · ')}</div>` : ''}
  ${!caiu.length && !subiu.length && antIni ? '<div class="contexto">Nenhuma mudança de nível vs a semana anterior.</div>' : ''}

  <div class="section-label">Loja a loja — piores primeiro</div>
  <div id="tabelaQualidade"><table>
    <tr><th>Loja</th><th>Nível</th><th>vs ant.</th><th>% atraso +5min</th><th>Atraso médio</th><th>% canc. Super</th><th title="Vem do relatório semanal de qualidade do iFood e vale só para a semana fechada mostrada no título — por isso não bate com o módulo Avaliações, que conta avaliação por avaliação no período escolhido no topo.">Nota</th><th>% resp. negoc.</th></tr>
    ${ordenado.map((r, iL) => {
      const sel = QUAL_LOJA === r.nome_loja;
      const a = antPor[r.nome_loja];
      const d = a ? rankNivel(r.nivel_super) - rankNivel(a.nivel_super) : null;
      const seta = d === null ? '—' : d > 0 ? '<span style="color:var(--farol-ok);">▲ subiu</span>' : d < 0 ? '<span style="color:var(--farol-fora);">▼ caiu</span>' : '=';
      const nivelCor = rankNivel(r.nivel_super) >= 5 ? 'var(--farol-ok)' : rankNivel(r.nivel_super) === 4 ? 'var(--tx-2)' : 'var(--farol-fora)';
      return `<tr onclick="qualAbrirLoja(${iL})" style="cursor:pointer;${sel ? 'background:var(--brand-wine);' : ''}" title="${sel ? 'A série desta loja está aberta logo abaixo — clique para fechar.' : 'Clique para ver as 8 últimas semanas desta loja.'}">
        <td>${sel ? '<b>' : ''}${r.nome_loja}${sel ? '</b> ✕' : ''}</td>
        <td style="color:${nivelCor}; font-weight:bold;">${r.nivel_super}</td>
        <td>${seta}</td>
        <td>${num(r.pct_atrasados_5min)}%</td>
        <td>${num(r.tempo_medio_atraso_min, 0)} min</td>
        <td>${num(r.pct_cancelamentos_super, 2)}%</td>
        <td>${num(r.media_avaliacoes, 2)}${r.qtd_avaliacoes ? ' <span style="color:#8a897e; font-size:10px;">(' + r.qtd_avaliacoes + ')</span>' : ''}</td>
        <td>${num(r.pct_respostas_negociacoes)}%</td></tr>`;
    }).join('')}
  </table></div>
  <div class="caption-label" style="text-align:center;" title="A linha da loja abre a série dela logo abaixo; clicar de novo fecha.">Clique numa loja para ver as 8 últimas semanas dela.</div>
  ${blocoSerie}
  <div class="caption-label" style="text-align:center;">Atualiza quando o relatório semanal de qualidade é importado — a rotina automática dele ainda está na fila (hoje o download é manual, quebra SEMANA).</div>`;
}

// Agrupamento automatico pelo tamanho do periodo filtrado — evita colocar mais um controle na
// tela e evita grafico ilegivel (ex.: 7 meses agrupados por dia).
function granularidadeAutomatica() {
  const ini = fDataIni.value, fim = fDataFim.value;
  if (!ini || !fim) return 'semana';
  const dias = Math.round((new Date(fim + 'T00:00:00') - new Date(ini + 'T00:00:00')) / 86400000) + 1;
  if (dias <= 21) return 'dia';
  if (dias <= 100) return 'semana';
  return 'mes';
}

// Cancelamentos agrupados no tempo: taxa (% dos pedidos) e valor perdido.
function computeEvolucaoCancelamentos(gran) {
  const rows = linhasFiltradas();
  const grupos = new Map();
  const pegaGrupo = (info) => {
    if (!grupos.has(info.key)) grupos.set(info.key, { label: info.label, sort: info.sort, total: 0, cancelados: 0, valor: 0 });
    return grupos.get(info.key);
  };
  rows.forEach(r => {
    const g = pegaGrupo(periodoKeyGenerico(DATAS[r[5]], gran));
    g.total += r[7];
    if (CANCEL_MOTIVO) return;   // com categoria fixada o cancelado vem de MOTIVOS
    if (r[6] === 1) { g.cancelados += r[7]; g.valor += r[8]; }          // cancelamento total
    else if (r[6] === 2) { g.cancelados += r[7]; g.valor += r[9]; }     // parcial: so o item cancelado
  });
  // Categoria fixada: o cancelado vem de vw_cancelamentos_motivo, a unica fonte que
  // sabe o motivo (ROWS nao tem essa coluna). O TOTAL de pedidos continua saindo de
  // ROWS — senao a taxa deixaria de ser "% dos pedidos" e nao se compararia com a
  // mesma tela sem recorte. MOTIVOS: 4=data, 5=responsavel, 6=pedidos, 7=valor.
  if (CANCEL_MOTIVO) {
    linhasCancelamentoFiltradas().forEach(r => {
      if (r[5] !== CANCEL_MOTIVO) return;
      const g = pegaGrupo(periodoKeyGenerico(DATAS[r[4]], gran));
      g.cancelados += r[6]; g.valor += r[7];
    });
  }
  return Array.from(grupos.values())
    .sort((a,b) => a.sort < b.sort ? -1 : a.sort > b.sort ? 1 : 0)
    .map(g => ({ label: g.label, taxa: g.total ? g.cancelados/g.total*100 : 0, valor: g.valor, cancelados: g.cancelados, total: g.total }));
}

function renderChartsCancelEvolucao() {
  if (!document.getElementById('chartCancelTaxa')) return;
  const dados = computeEvolucaoCancelamentos(granularidadeAutomatica());
  const labels = dados.map(d => d.label);

  renderLineChart('chartCancelTaxa', labels, [
    { label: '% dos pedidos cancelados', data: dados.map(d=>d.taxa), borderColor: corToken('--info'), backgroundColor: corToken('--info') },
  ], '%');

  destroyChart('chartCancelValor');
  chartInstances['chartCancelValor'] = new Chart(document.getElementById('chartCancelValor').getContext('2d'), {
    type: 'bar',
    data: { labels, datasets: [{ data: dados.map(d=>d.valor), backgroundColor: corToken('--info'), borderRadius: 4 }] },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: { callbacks: { label: (c) => `R$ ${fmt(dados[c.dataIndex].valor)} — ${dados[c.dataIndex].cancelados} de ${dados[c.dataIndex].total} pedidos` } },
      },
      scales: { x: { ticks: { maxRotation: 60, autoSkip: true } }, y: { beginAtZero: true, title: { display: true, text: 'R$' } } },
    },
  });
}

// Dois graficos separados (valor e quantidade) em vez de barras lado a lado num grafico so.
// Motivo: sao unidades diferentes (R$ x pedidos). Num eixo unico as barras de quantidade
// sumiriam perto das de valor; com dois eixos, o grafico fica visualmente enganoso (da pra
// fazer qualquer serie "ganhar" so escolhendo as escalas). Dois graficos com a MESMA ordem de
// categorias mostram a comparacao com honestidade.
// Barra (e nao pizza) porque a tarefa e comparar magnitude — varias categorias aqui tem
// valores proximos e virariam fatias ambiguas.
function renderChartMotivos() {
  const base = resumoMotivosCancelamento();

  // Cada grafico e ordenado pela SUA propria medida (maior -> menor), entao cada um responde
  // sua pergunta de imediato: "onde se perde mais dinheiro" e "o que mais acontece". A ordem
  // das categorias muda de um grafico pro outro de proposito — e essa mudanca que mostra
  // quando algo e frequente mas barato. O custo unitario esta na tabela abaixo.
  function barras(id, chave, cor, tituloEixo, formatarTooltip, formatarRotulo, clicavel) {
    const el = document.getElementById(id);
    if (!el) return;
    destroyChart(id);
    const dados = base.slice().sort((a,b) => b[chave] - a[chave]);
    const valores = dados.map(d => d[chave]);
    const maxValor = Math.max(0, ...valores);
    chartInstances[id] = new Chart(el.getContext('2d'), {
      type: 'bar',
      data: {
        labels: dados.map(d => d.responsavel),
        // Uma cor so por barra: a identidade vem do rotulo do eixo. A categoria
        // fixada fica na cor da marca nos DOIS graficos — e o que mostra, de
        // relance, que a tela inteira esta falando dela.
        datasets: [{ data: valores, backgroundColor: dados.map(d => CANCEL_MOTIVO === d.responsavel ? corToken('--brand') : cor), borderRadius: 4, borderSkipped: false }],
      },
      plugins: [pluginRotulosBarra(i => formatarRotulo(dados[i]))],
      options: {
        indexAxis: 'y',
        responsive: true,
        maintainAspectRatio: false,
        layout: { padding: { right: 8 } },
        onClick: clicavel ? (_e, els) => { if (els.length) cancelFiltrarMotivo(dados[els[0].index].responsavel); } : undefined,
        onHover: clicavel ? (e, els) => { e.native.target.style.cursor = els.length ? 'pointer' : 'default'; } : undefined,
        plugins: {
          legend: { display: false },
          tooltip: { callbacks: {
            label: (c) => formatarTooltip(dados[c.dataIndex]),
            afterLabel: clicavel ? (c) => (CANCEL_MOTIVO === dados[c.dataIndex].responsavel ? 'clique para soltar o recorte' : 'clique para recortar a tela por esta categoria') : undefined,
          } },
        },
        scales: {
          // Sobra de 22% no eixo pra caber o numero na ponta da barra sem cortar.
          x: { beginAtZero: true, max: maxValor * 1.22 || 1, title: { display: true, text: tituloEixo }, grid: { color: '#232321' } },
          y: { grid: { display: false } },
        },
      },
    });
  }

  // So a barra do VALOR filtra: e a que responde "onde se perde mais dinheiro", a
  // pergunta que leva a agir. A de quantidade acompanha o destaque, sem virar um
  // segundo controle para a mesma coisa.
  barras('chartMotivosValor', 'valor', corToken('--info'), 'R$ perdidos',
    d => `R$ ${fmt(d.valor)} em ${d.n} pedidos (R$ ${fmt(d.n ? d.valor/d.n : 0)} por cancelamento)`,
    d => 'R$ ' + fmt(d.valor), true);

  barras('chartMotivosQtd', 'n', corToken('--info'), 'pedidos cancelados',
    d => `${d.n} pedidos (${pct(d.pct)}% dos cancelamentos) — R$ ${fmt(d.valor)}`,
    d => `${d.n} (${pct(d.pct)}%)`);

  renderChartsCancelEvolucao();
}

// Chave de periodo generica, calculada direto a partir de uma data (string 'YYYY-MM-DD'),
// sem depender dos indices de semana/dia_semana pre-calculados de ROWS. Precisamos disso pra
// agrupar CONCILIACAO (que so tem loja+data) na mesma "caixinha" de periodo que os pedidos,
// pros graficos executivos que cruzam as duas fontes.
function periodoKeyGenerico(dataStr, gran) {
  const [yyyy, mm] = dataStr.split('-');
  if (gran === 'dia') return { key: dataStr, label: dataStr.split('-').reverse().join('/'), sort: dataStr };
  if (gran === 'diaSemana') {
    const d = new Date(dataStr + 'T00:00:00');
    const idx = (d.getDay() + 6) % 7; // 0=Segunda ... 6=Domingo, mesma ordem de DIAS
    return { key: String(idx), label: DIAS[idx], sort: String(idx).padStart(2,'0') };
  }
  if (gran === 'mes') {
    const key = `${yyyy}-${mm}`;
    return { key, label: `${MESES_ABREV[Number(mm)-1]}/${yyyy}`, sort: key };
  }
  if (gran === 'ano') return { key: yyyy, label: yyyy, sort: yyyy };
  // semana: chave = segunda-feira (seg-dom) da semana que contem essa data. E' um identificador
  // estavel calculado independente do texto de "semana" que vem do banco.
  const d = new Date(dataStr + 'T00:00:00');
  const idxSemana = (d.getDay() + 6) % 7;
  d.setDate(d.getDate() - idxSemana);
  const seg = d.toISOString().slice(0,10);
  const dom = new Date(d); dom.setDate(dom.getDate() + 6);
  const domStr = dom.toISOString().slice(0,10);
  const fmtDDMM = (s) => s.split('-').slice(1).reverse().join('/');
  return { key: seg, label: `${fmtDDMM(seg)} - ${fmtDDMM(domStr)}`, sort: seg };
}

// Agregacao completa por periodo (mesma formula validada de computeMetrics: bruto, descontos
// com conciliacao, investimento em mkt, custo iFood e liquido) — usada pelos graficos
// executivos do modulo Evolucao (ponte do liquido e as duas dispersoes).
function computeEvolucaoCompleta(gran) {
  const rows = linhasFiltradas();
  const activeL = activeLojas();
  const dIni = fDataIni.value, dFim = fDataFim.value;

  const grupos = new Map();
  function getGrupo(info) {
    if (!grupos.has(info.key)) {
      grupos.set(info.key, {
        label: info.label, sort: info.sort,
        totalPedidos: 0, itens: 0, frete: 0, promoLoja: 0, freteSobDemanda: 0,
        taxaCartao: 0, comissao: 0, mensalidade: 0, outrosAj: 0, entregaIfood: 0, anuncios: 0, ressarcimento: 0,
      });
    }
    return grupos.get(info.key);
  }

  rows.forEach(r => {
    if (r[6] === 1) return; // ignora cancelamento total (mesma regra do bruto/liquido)
    const dataStr = DATAS[r[5]];
    const g = getGrupo(periodoKeyGenerico(dataStr, gran));
    g.totalPedidos += r[7];
    g.itens += (r[8] - r[9]);
    g.frete += r[10];
    g.promoLoja += r[13] + r[12];  // loja + rede: os dois sao nossos (07/11/2026, lote 2 canal-24)
    g.freteSobDemanda += r[16];
  });

  CONCILIACAO.forEach(c => {
    const [lojaIdx, dataStr, grupoNome, valor] = c;
    if (!activeL.has(lojaIdx)) return;
    if (dIni && dataStr < dIni) return;
    if (dFim && dataStr > dFim) return;
    const g = getGrupo(periodoKeyGenerico(dataStr, gran));
    if (grupoNome === 'TAXA_CARTAO') g.taxaCartao += -valor;
    else if (grupoNome === 'COMISSAO_VENDAS') g.comissao += -valor;
    else if (grupoNome === 'MENSALIDADE') g.mensalidade += -valor;
    else if (grupoNome === 'OUTROS_AJUSTES') g.outrosAj += -valor;
    else if (grupoNome === 'ENTREGA_IFOOD') g.entregaIfood += -valor;   // Full Service (15/10/2026)
    else if (grupoNome === 'ANUNCIOS') g.anuncios += -valor;
    else if (grupoNome === 'RESSARCIMENTO_CANCELAMENTO') g.ressarcimento += valor;
  });

  const lista = Array.from(grupos.values()).sort((a,b) => a.sort < b.sort ? -1 : a.sort > b.sort ? 1 : 0);

  return lista.map(g => {
    const bruto = g.itens + g.frete;
    const totalTaxasComissoes = g.taxaCartao + g.comissao + g.mensalidade + g.outrosAj;
    const totalDescontos = totalTaxasComissoes + g.freteSobDemanda + g.entregaIfood;
    const totalDescontosComRessarcimento = totalDescontos - g.ressarcimento;
    const totalMkt = g.promoLoja + g.anuncios;
    const custoIfood = totalDescontosComRessarcimento + totalMkt;
    const liquido = bruto - custoIfood;
    return {
      label: g.label,
      totalPedidos: g.totalPedidos,
      bruto, liquido,
      ticketMedio: g.totalPedidos ? bruto/g.totalPedidos : 0,
      totalMkt,
      mktPorPedido: g.totalPedidos ? totalMkt/g.totalPedidos : 0,
      liquidoPorPedido: g.totalPedidos ? liquido/g.totalPedidos : 0,
      totalDescontosComRessarcimento,
      custoIfood,
    };
  });
}

function renderLineChart(id, labels, datasets, yLabel) {
  destroyChart(id);
  const ctx = document.getElementById(id).getContext('2d');
  chartInstances[id] = new Chart(ctx, {
    type: 'line',
    data: { labels, datasets: datasets.map(d => ({ tension: .25, pointRadius: 2, ...d })) },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      interaction: { mode: 'index', intersect: false },
      scales: {
        x: { ticks: { maxRotation: 60, autoSkip: true } },
        y: { title: { display: !!yLabel, text: yLabel }, beginAtZero: true },
      },
      plugins: { legend: { display: datasets.length > 1 } },
    },
  });
}

// Explica a diferenca de resultado entre o periodo FILTRADO e o periodo anterior de mesmo
// tamanho — exatamente a mesma comparacao dos selos dos cards, pra nao existir dois numeros
// diferentes de "variacao" no painel.
// A decomposicao e exata: volume + ticket reconstroem a variacao do bruto (bruto = pedidos x
// ticket), e descontos + marketing completam ate o liquido.
function renderChartWaterfall(m, a, ant) {
  const el = document.getElementById('chartWaterfall');
  if (!el || !a) return;
  destroyChart('chartWaterfall');
  const ctx = el.getContext('2d');

  const efeitoVolume = (m.totalPedidos - a.totalPedidos) * a.ticketMedio;
  const efeitoTicket = m.totalPedidos * (m.ticketMedio - a.ticketMedio);
  const efeitoDescontos = -(m.totalDescontosComRessarcimento - a.totalDescontosComRessarcimento);
  const efeitoMkt = -(m.totalMkt - a.totalMkt);

  let acumulado = a.liquido;
  const barras = [{ label: ['Período', 'anterior'], from: 0, to: a.liquido, tipo: 'total' }];
  [['Mais/menos pedidos', efeitoVolume], ['Ticket médio', efeitoTicket],
   ['Taxas e comissões', efeitoDescontos], ['Marketing', efeitoMkt]]
    .forEach(([nome, valor]) => {
      const de = acumulado;
      acumulado += valor;
      barras.push({ label: nome, from: Math.min(de, acumulado), to: Math.max(de, acumulado), tipo: valor >= 0 ? 'pos' : 'neg', delta: valor });
    });
  barras.push({ label: ['Período', 'atual'], from: 0, to: acumulado, tipo: 'total' });

  const cores = { total: corToken('--info'), pos: corToken('--farol-ok'), neg: corToken('--farol-fora') };

  chartInstances['chartWaterfall'] = new Chart(ctx, {
    type: 'bar',
    data: {
      labels: barras.map(b => b.label),
      datasets: [{ data: barras.map(b => [b.from, b.to]), backgroundColor: barras.map(b => cores[b.tipo]), borderRadius: 4 }],
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: { callbacks: { label: (c) => {
          const b = barras[c.dataIndex];
          return b.tipo === 'total' ? `R$ ${fmt(b.to)}` : `${b.delta >= 0 ? '+' : ''}R$ ${fmt(b.delta)}`;
        } } },
      },
      scales: {
        x: { ticks: { maxRotation: 0, autoSkip: false, font: { size: 10 } } },
        y: { beginAtZero: true, title: { display: true, text: 'R$' } },
      },
    },
  });
}

// O PEDAÇO DO renderAll QUE É DO CANAL (05/11/2026): o painel antigo e a página do Canal chamam o mesmo.
function renderAllCanal(m, a, ant, contexto, ativo) {
  let html = plcCabecalhoQuebra('resumo') + contexto;
  html += blocoAbertura(m, a, ant);
  html += kpisRapidos(m, a);
  html += tabelaLiquidoPorLoja(ant);
  html += extratoFinanceiro(m, a);
  html += blocoSinais(m, a);
  // Fecho da pagina: a tendencia no tempo (o unico grafico que valia manter do antigo
  // modulo Tendencias — bruto x liquido, com agrupamento automatico pelo tamanho do periodo).
  html += `<div class="section-label">Evolução do resultado</div>
    <div class="chart-box" style="height:300px;">
      <div class="chart-title">Faturamento bruto x líquido, por ${granularidadeAutomatica() === 'dia' ? 'dia' : granularidadeAutomatica() === 'semana' ? 'semana' : 'mês'}</div>
      <div class="chart-canvas-wrap"><canvas id="chartTendencia"></canvas></div>
    </div>
    <div class="chart-box" style="height:340px; margin-top:14px;">
      <div class="chart-title">Pedidos por semana, unidade a unidade</div>
      <div style="display:flex; gap:6px; justify-content:center; margin-bottom:8px;">
        <button class="navbtn ${MODO_UNIDADES === 'pedidos' ? 'active' : ''}" id="btnUni-pedidos" onclick="trocarModoUnidades('pedidos')">Pedidos</button>
        <button class="navbtn ${MODO_UNIDADES === 'crescimento' ? 'active' : ''}" id="btnUni-crescimento" onclick="trocarModoUnidades('crescimento')">Quem cresceu</button>
      </div>
      <div class="chart-canvas-wrap"><canvas id="chartUnidades"></canvas></div>
    </div>
    <div class="caption-label" id="legendaUnidades" style="text-align:center;">${MODO_UNIDADES === 'pedidos' ? CANAL_LEG_UNI_PED : CANAL_LEG_UNI_CRESC}</div>`;
  document.getElementById('view-content').innerHTML = html;
  document.getElementById('view-cancelamentos').innerHTML = contexto + moduloCancelamentos(m, a);
  document.getElementById('view-promocoes').innerHTML = contexto + moduloPromocoes();
  // So desenha os graficos do modulo que esta visivel — Chart.js calcula tamanho zero em
  // container escondido, e o grafico sairia deformado.
  if (ativo === 'resumo') { renderChartWaterfall(m, a, ant); renderChartTendencia(); renderChartUnidades(); }
  if (ativo === 'cancelamentos') { renderChartMotivos(); carregarRecuperavelCancel(); }
  if (ativo === 'promocoes') entrarPromocoes();
  // telas de carga sob demanda: so redesenha se os dados ja foram buscados
  if (ativo === 'qualidade' && QUALIDADE !== null) renderModuloQualidade();
  if (ativo === 'atrasos' && ATRASOS !== null) renderModuloAtrasos();
  if (ativo === 'logfin' && LOGFIN !== null) renderModuloLogfin();
  if (ativo === 'frete' && FRETE !== null) renderModuloFrete(FRETE);
  if (ativo === 'negociacoes' && NEGOCIACOES !== null) renderModuloNegociacoes();
  if (ativo === 'avaliacoes' && AVALIACOES !== null) renderModuloAvaliacoes();
  if (ativo === 'cardapio' && CARDAPIO !== null) renderModuloCardapio();
  if (ativo === 'clientes' && CLIENTES_REDE !== null) renderModuloClientes();
  if (ativo === 'site' && SITE !== null) renderModuloSite();
}

// O PEDAÇO DO mostrarModulo QUE É DO CANAL (05/11/2026): o que cada tela faz ao entrar.
function entrarTelaCanal(nome) {
  if (nome === 'resumo') {
    const ant = periodoAnterior();
    if (ant) renderChartWaterfall(computeMetrics(), computeMetrics(ant.ini, ant.fim), ant);
    renderChartTendencia();
  }
  if (nome === 'cardapio') entrarCardapio();
  if (nome === 'clientes') entrarClientes();
  if (nome === 'site') entrarSite();
  if (nome === 'cancelamentos') { renderChartMotivos(); carregarRecuperavelCancel(); }
  if (nome === 'promocoes') entrarPromocoes();
  if (nome === 'negociacoes') entrarNegociacoes();
  if (nome === 'avaliacoes') entrarAvaliacoes();
  if (nome === 'relatorios') entrarRelatorios();
  if (nome === 'contestacoes') entrarContestacoes();
  if (nome === 'atendimento') entrarAtendimento();
  if (nome === 'qualidade') entrarQualidade();
  if (nome === 'atrasos') entrarAtrasos();
  if (nome === 'logfin') entrarLogfin();
  if (nome === 'frete') entrarFrete();
}
