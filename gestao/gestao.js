// GESTÃO (05/11/2026, bloco 7 da migração): MOVIDO do docs/dashboard.html, sem mudar nada.
// Esta semana, Hoje na rede, O Placar, Indicadores e metas, A semana, Fechamento do mês, Evolução de vendas, DRE,
// Fluxo de caixa realizado, Análise de despesas, Lucro por unidade, Conciliação bancária, Contas a pagar e a receber,
// Fluxo projetado e Taxas da maquininha. Quem carrega: o painel antigo e docs/gestao/index.html. Lê o núcleo e o
// canal.js (a Esta semana usa avaliações e negociações). Quem mexe: o chat "Telas do painel".

// Busca TODAS as linhas de uma tabela/view, paginando (o Supabase limita
// a 1000 linhas por consulta), para funcionar mesmo quando o volume de
// pedidos crescer (junho, julho, ...).
// ------------------------------------------------------------------
// O NOME DA CONTA: chave por dentro, apelido na tela
// ------------------------------------------------------------------
// A conta tem dois nomes. A CHAVE ('ITAU AV') amarra 50.987 linhas e 6 chaves
// estrangeiras — ela nao muda, e e' ela que vai em todo POST. O APELIDO
// ('ITAU AV 27004-3') e' o que o dono escreve para ler na tela, e muda quando
// ele quiser (aba Apelidos de contexto/padronizacao-saipos.xlsx +
// script/aplicar_padronizacao.py).
//
// Algumas views ja devolvem `conta_exibida` pronta; outras nao. Em vez de
// esperar view por view ganhar a coluna, o painel carrega o de/para uma vez —
// sao 17 linhas — e resolve o nome em qualquer tela. `ativa` vem junto porque
// BRADESCO e FABIO PESSOAL nao tem lancamento nem extrato e nao devem aparecer
// em lista nenhuma. (21/08/2026)
let APELIDOS = null;      // chave -> nome de tela

let CONTAS_MORTAS = null; // chaves com ativa=false

async function carregarApelidos() {
  if (APELIDOS) return APELIDOS;
  APELIDOS = {}; CONTAS_MORTAS = new Set();
  const r = await fetch(`${SUPABASE_URL}/rest/v1/fin_contas?select=conta,apelido,ativa`,
                        { headers: cabecalhoLeitura() });
  if (!r.ok) return APELIDOS;   // sem o de/para a tela mostra a chave, que e' legivel
  for (const c of await r.json()) {
    if (c.apelido) APELIDOS[c.conta] = c.apelido;
    if (c.ativa === false) CONTAS_MORTAS.add(c.conta);
  }
  return APELIDOS;
}

// Mostrar. Nunca usar o retorno como chave de nada.
function nomeConta(c) { return (APELIDOS && APELIDOS[c]) || c; }

// Conta desativada some das listas; na duvida (de/para ainda nao carregado), mostra.
function contaViva(c) { return !CONTAS_MORTAS || !CONTAS_MORTAS.has(c); }

// ------------------------------------------------------------------
// Modulo Fluxo de Caixa (DFC) — realizado da empresa Agua Verde.
// Fonte: fin_lancamentos (historico jan-jul/2026 da planilha; depois Saipos).
// E' um retrato mensal da empresa inteira — NAO segue os filtros de
// loja/periodo do topo (que sao do canal iFood).
// ------------------------------------------------------------------
// NOTA MULTI-LOJA (18/08/2026): as views de DFC e DRE AGRUPAM por unidade — o
// backend sempre foi multi-loja. O painel e que nunca filtrou, e ate aqui isso
// dava certo por acidente, porque so a Agua Verde tinha dados. Com o historico
// de AHU e SAO BRAZ entrando, somar tudo faria a DRE e o DFC crescerem sem dar
// erro nenhum — o pior tipo de mudanca, a que parece resultado. O filtro fixo
// congela o comportamento de hoje; o proximo passo e um seletor de loja.
let DFC_MENSAL = null;   // vw_fin_dfc_mensal: mes, natureza, tipo, subtipo, ordem, credito, debito

let DFC_CONTAS = null;   // fin_contas: conta, saldo_inicial, ordem

let DFC_MOV = null;      // vw_fin_saldo_conta_mensal: mes, conta, movimento

// dfcModo aposentado em 13/08/2026: o % da receita agora aparece junto do
// valor em cada celula de fluxo (proposta do financeiro), sem botao de troca.
const dfcAberto = new Set();

// Mes fixado por clique no cabecalho da coluna (12/09/2026). "O que houve em
// agosto?" e a pergunta que a tabela provoca, e ate hoje ela exigia ler 9 colunas
// na horizontal: os cartoes e os dois graficos de origem e destino falavam sempre
// do periodo inteiro. Clicar de novo solta. A TABELA continua mostrando todos os
// meses de proposito — e por ela que se troca de mes sem soltar o recorte.
let FLX_MES = null;

function fluxoFixarMes(m) { FLX_MES = (FLX_MES === m) ? null : m; renderModuloDFC(); }

// Ordem dos grupos de despesa no DFC (mesma da planilha de fluxo de caixa).
const DFC_ORDEM_TIPOS = ['MATERIA PRIMA','USO E CONSUMO','PESSOAL','PRO LABORE',
  'DESPESAS COMERCIAIS','DESPESAS LOGISTICA','DESPESAS MARKETING','DESPESAS ADMINISTRATIVAS',
  'DESPESAS MANUTENÇÃO','IMPOSTOS E TAXAS','DESPESAS FINANCEIRAS'];

// Calcula o valor de cada KPI num intervalo, com as mesmas formulas do painel.
function computeKpisSemana(ini, fim) {
  const m = computeMetrics(ini, fim);
  const activeL = activeLojas();
  const negs = NEGOCIACOES.filter(r => activeL.has(r[0]) && r[1] >= ini && r[1] <= fim);
  const avs = AVALIACOES.filter(r => activeL.has(r[0]) && r[1] >= ini && r[1] <= fim);
  const negSem = negs.filter(negSemResposta).length;
  const negResp = negs.filter(negRespondivel).length;
  const negAtraso = negs.filter(r => (r[4] || '').includes('ATRASO')).length;
  return {
    liquido_semana: m.liquido,
    pedidos_semana: m.totalPedidos,
    margem_pct: m.liquidoPct,
    nota_media: avs.length ? avs.reduce((s, r) => s + r[2], 0) / avs.length : null,
    pct_notas_ruins: notasRuins(avs).pct,
    taxa_cancelamento: m.nFullPct, // so cancelamentos TOTAIS (parciais ficam no modulo Cancelamentos)
    neg_sem_resposta_pct: negResp ? negSem / negResp * 100 : null,
    neg_atraso_pct: negs.length ? negAtraso / negs.length * 100 : null,
    mkt_por_pedido: m.custoMktPorPedido,
    // investPlataforma = incentivo do iFood; promoLoja = o que saiu do nosso bolso.
    alavancagem: m.promoLoja > 0.005 ? m.investPlataforma / m.promoLoja : null,
    roa_promo: m.promoLoja > 0.005 ? m.bruto / m.promoLoja : null,
    _negs: negs, _avs: avs,
  };
}

const nomeMeta = (k) => (canalComSeletor() && lojaFin() !== 'REDE' ? k.nome.replace(/da rede/i, 'da loja') : k.nome);

// 26/10/2026: tela de Pessoas movida para docs/pessoas/pessoas.js (bloco 4 do painel em módulos).
let REDE_DADOS = null;

// TAXAS DA MAQUININHA (dono, 09/09/2026): "a ideia aqui e verificar se as taxas e os
// custos com maquininha estao batendo" — batendo com o COMBINADO. Modulo proprio de
// novo (saiu do Fechamento de Caixas), com filtro de loja e mes. O combinado e DADO
// (rede_taxa_combinada / rede_aluguel_combinado), digitado pelo dono aqui mesmo.
let REDE_FILTRO = { loja: '', mes: null };   // mes null = ultimo mes com dado; '' = tudo

function redeFiltrar(campo, valor) { REDE_FILTRO[campo] = valor; renderModuloRede(REDE_DADOS); }

async function carregarRede() {
  await carregarEmailDono();   // decide se aparecem os botoes "definir combinado"
  const [taxas, aluguel, cobrancas, depara, taxaComb, alugComb] = await Promise.all([
    consultarTudo('vw_rede_taxas_efetivas?select=unidade,mes,modalidade,bandeira_codigo,parcelas,n_vendas,bruto,mdr_cobrado&ambiente=eq.producao'),
    consultarTudo('vw_rede_aluguel?select=unidade,mes,n_cobrancas,aluguel&ambiente=eq.producao'),
    consultarTudo('vw_rede_cobrancas?select=unidade,mes,tipo_codigo,tipo_descricao,n,valor&ambiente=eq.producao'),
    consultarTudo('cartao_bandeira_de_para?select=modalidade,bandeira_codigo,bandeira'),
    consultarTudo('rede_taxa_combinada?select=*'),
    consultarTudo('rede_aluguel_combinado?select=*'),
  ]);
  return { taxas, aluguel, cobrancas, depara, taxaComb, alugComb };
}

async function entrarRede() {
  const alvo = document.getElementById('view-rede');
  if (!alvo) return;
  if (REDE_DADOS === null) {
    alvo.innerHTML = '<div class="contexto">Carregando taxas da maquininha (dados da Rede)...</div>';
    REDE_DADOS = await carregarRede();
  }
  renderModuloRede(REDE_DADOS);
}

async function redeRecarregar() { REDE_DADOS = await carregarRede(); renderModuloRede(REDE_DADOS); }

// O combinado so o dono grava (policy eh_dono). Desde 12/09/2026 ele digita NA
// PROPRIA LINHA: o campo ja chega com o valor que esta gravado. Era prompt() em
// sequencia, e prompt nao mostra o que ja existe — alem de que cancelar o segundo
// jogava fora o primeiro. Gravava-se no escuro, sem ver e sem desfazer.
async function redeGravar(tabela, conflito, corpo) {
  const s = rmbSessao();
  if (!s || !s.email) { alert('Sessão expirada — faça login de novo.'); return false; }
  const r = await fetch(`${SUPABASE_URL}/rest/v1/${tabela}?on_conflict=${conflito}`, {
    method: 'POST', headers: rmbHeaders({ Prefer: 'resolution=merge-duplicates' }),
    body: JSON.stringify({ ...corpo, quem: s.email, atualizado_em: new Date().toISOString() }),
  });
  if (!r.ok) { alert('Não consegui gravar: ' + (await r.text()).slice(0, 160)); return false; }
  return true;
}

// A taxa combinada tem VIGENCIA desde 12/09/2026 (a chave ganhou `desde`), porque a
// Rede mudou o patamar em 28/04 e sem historico os meses antigos acusavam cobranca
// indevida. Os dois campos da linha (taxa e desde quando vale) ja chegam preenchidos
// com o combinado vigente; nada e gravado sem os dois preenchidos.
async function redeDefinirTaxa(modalidade, bandeira, parcelas, chave) {
  const eT = document.getElementById('rdTx_' + chave), eD = document.getElementById('rdDt_' + chave);
  if (!eT || !eD) return;
  const txt = String(eT.value).trim();
  const pct = Number(txt.replace(',', '.'));
  if (!txt || !(pct >= 0 && pct < 20)) { alert('Digite a taxa em %, como 1,43.'); eT.focus(); return; }
  const desde = String(eD.value).trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(desde)) {
    alert('Escolha a partir de que dia essa taxa passa a valer. Os meses anteriores continuam comparados com a taxa que valia neles.');
    eD.focus(); return;
  }
  if (await redeGravar('rede_taxa_combinada', 'modalidade,bandeira,parcelas,desde',
      { modalidade, bandeira, parcelas, taxa_pct: pct, desde })) await redeRecarregar();
}

async function redeDefinirAluguel(unidade, chave) {
  const eV = document.getElementById('rdAl_' + chave), eM = document.getElementById('rdMq_' + chave);
  if (!eV || !eM) return;
  const txt = String(eV.value).trim();
  const valor = Number(txt.replace('.', '').replace(',', '.'));
  if (!txt || !(valor >= 0)) { alert('Digite o valor em reais, como 69 ou 69,00.'); eV.focus(); return; }
  const maquinas = parseInt(String(eM.value).trim(), 10);
  if (!(maquinas >= 0)) { alert('Digite a quantidade de máquinas.'); eM.focus(); return; }
  if (await redeGravar('rede_aluguel_combinado', 'unidade', { unidade, valor_mes: valor, maquinas })) await redeRecarregar();
}

function renderModuloRede(d) {
  const alvo = document.getElementById('view-rede');
  if (!alvo || !d) return;
  const { taxas, aluguel, cobrancas, depara, taxaComb, alugComb } = d;
  const reais = (v) => 'R$ ' + Number(v).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const pc = (v) => Number(v).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + '%';
  const efetiva = (mdr, br) => br > 0 ? (100 * mdr / br) : 0;
  const MOD = { CREDIT: 'crédito', DEBIT: 'débito', VAN: 'vale' };
  const nomeBand = {};
  depara.forEach(x => { nomeBand[x.modalidade + '|' + x.bandeira_codigo] = x.bandeira; });
  const band = (m, c) => nomeBand[m + '|' + c] || ('bandeira ' + c);
  const mesLabel = (m) => m ? new Date(m + 'T12:00:00').toLocaleDateString('pt-BR', { month: 'short', year: '2-digit' }) : '';

  // filtros: loja e mes (ultimos 6 com dado + "tudo")
  const meses = [...new Set([...taxas, ...aluguel].map(x => x.mes).filter(Boolean))].sort().reverse();
  if (REDE_FILTRO.mes === null) REDE_FILTRO.mes = meses[0] || '';
  const F = REDE_FILTRO;
  const lojasTodas = [...new Set([...taxas, ...aluguel].map(x => x.unidade).filter(Boolean))].sort();
  const btn = (ativo, onclick, rotulo) => `<button class="navbtn ${ativo ? 'active' : ''}" onclick="${onclick}">${rotulo}</button>`;
  const filtros = `<div style="display:flex; flex-wrap:wrap; gap:6px; align-items:center; margin:8px 0;">
    ${btn(!F.loja, "redeFiltrar('loja','')", 'Todas')}${lojasTodas.map(u => btn(F.loja === u, `redeFiltrar('loja','${u}')`, u)).join('')}
    <span style="width:12px;"></span>
    ${meses.slice(0, 6).map(m => btn(F.mes === m, `redeFiltrar('mes','${m}')`, mesLabel(m))).join('')}${btn(F.mes === '', "redeFiltrar('mes','')", 'tudo')}
  </div>`;
  const dentro = x => (!F.loja || x.unidade === F.loja) && (!F.mes || x.mes === F.mes);
  const tx = taxas.filter(dentro), al = aluguel.filter(dentro), cb = cobrancas.filter(dentro);

  // cards
  const totBruto = tx.reduce((a, t) => a + +t.bruto, 0), totMdr = tx.reduce((a, t) => a + +t.mdr_cobrado, 0);
  const totAlug = al.reduce((a, x) => a + +x.aluguel, 0);
  const card = (rot, val, sub, cor) => `<div class="card"${cor ? ` style="border:1px solid ${cor};"` : ''}><div style="font-size:12px; color:#a5a49a; text-transform:uppercase;">${rot}</div>
      <div style="font-size:24px; font-weight:700;${cor ? ` color:${cor};` : ''}">${val}</div><div style="font-size:12px; color:#8a897e;">${sub}</div></div>`;
  const cards = card('Passou na maquininha', reais(totBruto), F.mes ? mesLabel(F.mes) : 'todo o período')
    + card('Taxa cobrada', reais(totMdr), 'taxa efetiva média <b style="color:#e8e6dc;">' + pc(efetiva(totMdr, totBruto)) + '</b>')
    + card('Aluguel cobrado', reais(totAlug), al.reduce((a, x) => a + +x.n_cobrancas, 0) + ' cobrança(s) de máquina')
    + card('Custo total com a Rede', reais(totMdr + totAlug), 'taxa + aluguel', '#f5a623');

  // taxa cobrada x combinada, por modalidade + bandeira + parcelas
  // O COMBINADO TEM VIGENCIA (12/09/2026). A taxa da Rede mudou de patamar num dia
  // so, 28/04/2026, em todas as bandeiras: credito 1,47→1,43, Elo/Amex 2,27→2,23,
  // debito 0,77→0,68, Elo 1,57→1,48. Sem escolher pela data, fevereiro a abril
  // apareceriam como "cobrou a mais que o combinado" — alarme falso em tres meses.
  // Por isso a tabela guarda `desde` e aqui vale a vigencia do MES que esta na tela.
  const comb = {};
  taxaComb.forEach(c => {
    const k = c.modalidade + '|' + c.bandeira + '|' + c.parcelas;
    (comb[k] = comb[k] || []).push({ desde: c.desde || '1900-01-01', taxa: +c.taxa_pct });
  });
  Object.values(comb).forEach(v => v.sort((a, b) => a.desde < b.desde ? -1 : 1));
  // Referencia: o fim do mes escolhido. Em "tudo", o periodo pode atravessar duas
  // vigencias — ai nao da para julgar uma taxa efetiva que e mistura das duas, e a
  // tela diz isso em vez de acusar diferenca.
  const refFim = F.mes ? (() => { const d = new Date(F.mes + 'T12:00:00'); d.setMonth(d.getMonth() + 1); d.setDate(0); return d.toISOString().slice(0, 10); })() : null;
  const refIni = F.mes || null;
  const combinada = (m, b, p) => {
    const v = comb[m + '|' + b + '|' + p] || comb[m + '|*|' + p];
    if (!v || !v.length) return null;
    if (!refFim) {                       // "tudo": so julga se houver uma vigencia so
      return v.length === 1 ? v[0].taxa : 'VARIAS';
    }
    const valem = v.filter(x => x.desde <= refFim);
    if (!valem.length) return null;
    // vigencia que comecou DENTRO do mes exibido: o mes tem duas taxas
    if (valem.length > 1 && valem[valem.length - 1].desde > refIni) return 'VARIAS';
    return valem[valem.length - 1].taxa;
  };
  // A MESMA vigencia, mas inteira (taxa + desde): e ela que enche os dois campos de
  // edicao da linha, para o dono ver o que esta gravado ANTES de mudar.
  const combinadaVig = (m, b, p) => {
    const v = comb[m + '|' + b + '|' + p] || comb[m + '|*|' + p];
    if (!v || !v.length) return null;
    const valem = refFim ? v.filter(x => x.desde <= refFim) : v;
    return valem.length ? valem[valem.length - 1] : null;
  };
  const redeHojeIso = new Date(Date.now() - 3 * 36e5).toISOString().slice(0, 10);
  const idRede = (s) => String(s).replace(/[^A-Za-z0-9]/g, '');
  const campoRede = (id, val, ph, w, tit) => `<input id="${id}" value="${val}" placeholder="${ph}" title="${tit}" style="background:var(--surface-2); border:1px solid var(--line); border-radius:6px; color:var(--tx-1); padding:3px 5px; width:${w}px; text-align:right; font:inherit; font-size:11px;">`;
  const grupos = {};
  tx.forEach(t => {
    const b = band(t.modalidade, t.bandeira_codigo), p = +t.parcelas || 1;
    const k = t.modalidade + '|' + b + '|' + p;
    const g = (grupos[k] = grupos[k] || { modalidade: t.modalidade, bandeira: b, parcelas: p, n: 0, bruto: 0, mdr: 0 });
    g.n += +t.n_vendas; g.bruto += +t.bruto; g.mdr += +t.mdr_cobrado;
  });
  const ordemMod = { CREDIT: 0, DEBIT: 1, VAN: 2 };
  const dono = souODono();
  let foraDoCombinado = 0, semCombinado = 0;
  // Quanto a Rede cobrou ACIMA do combinado no filtro que esta na tela: a soma dos
  // desvios positivos das duas tabelas, taxa e aluguel. O que ela cobrou a MENOS nao
  // abate — o card responde "quanto esta saindo a mais", nao o saldo dos dois lados.
  let cobradoAMais = 0;
  // A ORDEM DAS DUAS TABELAS E' O DINHEIRO FORA DO COMBINADO, do maior para o menor.
  // Antes vinha por modalidade e depois por volume, e a linha que cobrou a mais podia
  // cair no fim — quem abre esta tela quer ver primeiro onde esta saindo dinheiro. Linha
  // sem desvio (vale, sem combinado, duas vigencias no mes) volta para a ordem antiga.
  const desvioRS = (g) => {
    const ef = efetiva(g.mdr, g.bruto), cmb = combinada(g.modalidade, g.bandeira, g.parcelas);
    if (g.modalidade === 'VAN' || typeof cmb !== 'number' || Math.abs(ef - cmb) < 0.02) return 0;
    return g.bruto * (ef - cmb) / 100;
  };
  const linhasTaxa = Object.values(grupos).sort((a, b) => Math.abs(desvioRS(b)) - Math.abs(desvioRS(a)) || (ordemMod[a.modalidade] ?? 9) - (ordemMod[b.modalidade] ?? 9) || b.bruto - a.bruto).map(g => {
    const ef = efetiva(g.mdr, g.bruto), cmb = combinada(g.modalidade, g.bandeira, g.parcelas);
    let sit, cor = '#e8e6dc';
    if (g.modalidade === 'VAN') { sit = 'a Rede só captura; a taxa é da bandeira'; cor = '#8a897e'; }
    else if (cmb === null) { sit = 'sem combinado cadastrado'; cor = '#9aa4af'; semCombinado++; }
    else if (cmb === 'VARIAS') { sit = 'o período tem duas taxas combinadas — escolha um mês para comparar'; cor = '#8a897e'; }
    else if (Math.abs(ef - cmb) < 0.02) { sit = '✔ bate com o combinado'; cor = '#3f9c5a'; }
    else { const d = ef - cmb; if (d > 0) cobradoAMais += g.bruto * d / 100; sit = `cobrou ${pc(Math.abs(d))} ${d > 0 ? 'a MAIS' : 'a menos'} que o combinado (${reais(g.bruto * d / 100)})`; cor = d > 0 ? '#ff6b6b' : '#f5a623'; foraDoCombinado++; }
    // edicao NA LINHA: os dois campos ja chegam com o combinado vigente
    const kEd = idRede(g.modalidade + '_' + g.bandeira + '_' + g.parcelas);
    const vig = combinadaVig(g.modalidade, g.bandeira, g.parcelas);
    const definir = dono && g.modalidade !== 'VAN'
      ? `<div style="margin-top:4px; display:flex; gap:4px; align-items:center; justify-content:flex-end; white-space:nowrap;">
          ${campoRede('rdTx_' + kEd, vig ? String(vig.taxa).replace('.', ',') : '', '1,43', 48, 'taxa combinada com a Rede, em % sobre a venda')}
          <span style="font-size:11px; color:var(--tx-5);">% desde</span>
          <input id="rdDt_${kEd}" type="date" value="${vig ? vig.desde : redeHojeIso}" title="a partir de que dia essa taxa passa a valer — os meses anteriores continuam comparados com a taxa que valia neles" style="background:var(--surface-2); border:1px solid var(--line); border-radius:6px; color:var(--tx-1); padding:3px 5px; font:inherit; font-size:11px;">
          <button class="preset-btn" onclick="redeDefinirTaxa('${g.modalidade}','${g.bandeira}',${g.parcelas},'${kEd}')">salvar</button>
        </div>`
      : '';
    return `<tr>
      <td style="padding:5px 8px;">${MOD[g.modalidade] || g.modalidade} ${g.bandeira.charAt(0) + g.bandeira.slice(1).toLowerCase()}${g.parcelas > 1 ? ' ' + g.parcelas + 'x' : ''}</td>
      <td style="padding:5px 8px; text-align:right; color:#a5a49a;">${g.n.toLocaleString('pt-BR')}</td>
      <td style="padding:5px 8px; text-align:right;">${reais(g.bruto)}</td>
      <td style="padding:5px 8px; text-align:right;">${reais(g.mdr)}</td>
      <td style="padding:5px 8px; text-align:right; font-weight:600;">${g.modalidade === 'VAN' ? '—' : pc(ef)}</td>
      <td style="padding:5px 8px; text-align:right; color:#a5a49a;">${cmb === null ? '—' : cmb === 'VARIAS' ? 'duas' : pc(cmb)}${definir}</td>
      <td style="padding:5px 8px; color:${cor};">${sit}</td></tr>`;
  }).join('');

  // aluguel cobrado x combinado, por loja e mes
  const alugCombDe = {};
  alugComb.forEach(c => { alugCombDe[c.unidade] = c; });
  let alugFora = 0;
  // Mesma regra da tabela de cima: primeiro o maior desvio em R$ contra o combinado;
  // sem desvio (ou sem combinado cadastrado), volta a ordem por loja e mes.
  const desvioAlug = (x) => {
    const c = alugCombDe[x.unidade];
    const d = c ? (+x.aluguel - (+c.valor_mes * +c.maquinas)) : 0;
    return Math.abs(d) < 0.01 ? 0 : d;   // o mesmo piso que a linha usa para dizer "bate"
  };
  const linhasAlug = al.slice().sort((a, b) => Math.abs(desvioAlug(b)) - Math.abs(desvioAlug(a)) || (a.unidade < b.unidade ? -1 : 1) || (a.mes < b.mes ? 1 : -1)).map(x => {
    const c = alugCombDe[x.unidade];
    let sit, cor = '#e8e6dc';
    if (!c) { sit = 'sem combinado cadastrado'; cor = '#9aa4af'; semCombinado++; }
    else {
      const esperado = +c.valor_mes * +c.maquinas;
      if (Math.abs(+x.aluguel - esperado) < 0.01) { sit = '✔ bate com o combinado'; cor = '#3f9c5a'; }
      else { const d = +x.aluguel - esperado; if (d > 0) cobradoAMais += d; sit = `${d > 0 ? 'cobrou a MAIS' : 'cobrou a menos'}: ${reais(Math.abs(d))} (combinado ${reais(esperado)} = ${c.maquinas} × ${reais(c.valor_mes)})`; cor = d > 0 ? '#ff6b6b' : '#f5a623'; alugFora++; }
    }
    // edicao NA LINHA: valor por maquina x quantidade, ja preenchidos. A chave leva
    // o mes porque a mesma loja aparece em varias linhas (uma por mes) e dois campos
    // com o mesmo id na pagina fariam o salvar ler sempre o primeiro.
    const kAl = idRede(x.unidade + '_' + (x.mes || ''));
    const definir = dono
      ? `<div style="margin-top:4px; display:flex; gap:4px; align-items:center; justify-content:flex-end; white-space:nowrap;">
          ${campoRede('rdAl_' + kAl, c ? String(+c.valor_mes).replace('.', ',') : '', '69,00', 58, 'aluguel combinado por máquina, por mês, em reais')}
          <span style="font-size:11px; color:var(--tx-5);">×</span>
          ${campoRede('rdMq_' + kAl, c ? String(c.maquinas) : '1', '1', 28, 'quantas máquinas nesta loja')}
          <button class="preset-btn" onclick="redeDefinirAluguel('${x.unidade}','${kAl}')">salvar</button>
        </div>`
      : '';
    return `<tr>
      <td style="padding:5px 8px; font-weight:600;">${x.unidade}</td>
      <td style="padding:5px 8px;">${mesLabel(x.mes)}</td>
      <td style="padding:5px 8px; text-align:right; color:#a5a49a;">${x.n_cobrancas}</td>
      <td style="padding:5px 8px; text-align:right;">${reais(x.aluguel)}</td>
      <td style="padding:5px 8px; text-align:right; color:#a5a49a;">${c ? reais(+c.valor_mes * +c.maquinas) : '—'}${definir}</td>
      <td style="padding:5px 8px; color:${cor};">${sit}</td></tr>`;
  }).join('');
  const outras = cb.filter(x => +x.tipo_codigo !== 20);
  const linhasOutras = outras.map(x => `<tr><td style="padding:5px 8px;">${x.unidade}</td><td style="padding:5px 8px;">${mesLabel(x.mes)}</td>
      <td style="padding:5px 8px;">${x.tipo_descricao || x.tipo_codigo}</td><td style="padding:5px 8px; text-align:right; color:#a5a49a;">${x.n}</td>
      <td style="padding:5px 8px; text-align:right;">${reais(x.valor)}</td></tr>`).join('');

  const resumo = foraDoCombinado || alugFora
    ? `<b class="negativo">${foraDoCombinado + alugFora} item(ns) fora do combinado</b>${semCombinado ? ` · ${semCombinado} sem combinado cadastrado` : ''}.`
    : semCombinado ? `Nada fora do combinado nos itens cadastrados · <b>${semCombinado} sem combinado</b>${dono ? ' — defina nas linhas abaixo' : ' — o dono define'}.`
    : '<b style="color:#3f9c5a;">Tudo dentro do combinado.</b>';
  const th = 'padding:4px 8px; font-weight:normal; color:#a5a49a; font-size:11px; text-transform:uppercase;';
  alvo.innerHTML = `
    <div class="section-label">Taxas da maquininha</div>
    <div class="contexto" style="text-align:left;">
      O que a <b>Rede</b> cobrou de fato (direto da API), comparado com o <b>combinado</b>. ${resumo}
      <details style="margin-top:6px; font-size:12px; color:#9aa4af;"><summary style="cursor:pointer;">como ler</summary>
        Taxa efetiva = taxa cobrada dividida pelo que passou, por tipo e bandeira. O combinado é o que foi negociado com a Rede;
        quem grava é o dono (botão "definir"). Vale (VR, Ticket, Alelo, Pluxee) a Rede só captura: a taxa é da bandeira e não aparece aqui.
        Aluguel é cobrado por máquina, uma vez por mês. Boqueirão fica fora (máquinas fora do credenciamento). Atualiza na rotina das APIs, 08:00.</details>
      ${filtros}
    </div>
    <div class="cards" style="display:flex; flex-wrap:wrap; gap:12px; margin:14px 0;">${cards}${card('Cobrado a mais que o combinado', reais(cobradoAMais), (F.mes ? mesLabel(F.mes) : 'todo o período') + (semCombinado ? ' · ' + semCombinado + ' sem combinado fica de fora' : ''), cobradoAMais > 0.005 ? 'var(--farol-fora)' : '')}</div>
    <div class="section-label">Taxa cobrada × combinada</div>
    <div class="card" style="overflow-x:auto;"><table style="border-collapse:collapse; font-size:12px; width:100%; min-width:760px;">
      <tr><th style="${th} text-align:left;">tipo e bandeira</th><th style="${th} text-align:right;">vendas</th><th style="${th} text-align:right;">passou</th>
        <th style="${th} text-align:right;">taxa cobrada</th><th style="${th} text-align:right;">efetiva</th><th style="${th} text-align:right;">combinada</th><th style="${th} text-align:left;">situação</th></tr>
      ${linhasTaxa || '<tr><td colspan="7" style="padding:8px; color:#9aa4af;">sem venda no filtro</td></tr>'}</table></div>
    <div class="section-label" style="margin-top:18px;">Aluguel cobrado × combinado</div>
    <div class="card" style="overflow-x:auto;"><table style="border-collapse:collapse; font-size:12px; width:100%; min-width:640px;">
      <tr><th style="${th} text-align:left;">loja</th><th style="${th} text-align:left;">mês</th><th style="${th} text-align:right;">máquinas cobradas</th>
        <th style="${th} text-align:right;">cobrado</th><th style="${th} text-align:right;">combinado</th><th style="${th} text-align:left;">situação</th></tr>
      ${linhasAlug || '<tr><td colspan="6" style="padding:8px; color:#9aa4af;">sem cobrança de aluguel no filtro</td></tr>'}</table></div>
    ${outras.length ? `<div class="section-label" style="margin-top:18px;">Outras cobranças da Rede</div>
    <div class="card" style="overflow-x:auto;"><table style="border-collapse:collapse; font-size:12px; width:100%;">
      <tr><th style="${th} text-align:left;">loja</th><th style="${th} text-align:left;">mês</th><th style="${th} text-align:left;">o que</th><th style="${th} text-align:right;">n</th><th style="${th} text-align:right;">valor</th></tr>${linhasOutras}</table></div>` : ''}
    <div class="contexto" style="margin-top:14px; color:#8a897e; font-size:11.5px;">Fonte: API da Rede em produção. A agenda de recebíveis não entra aqui — está fora do ar do lado da Rede.</div>`;
}

// 26/10/2026: tela de Pessoas movida para docs/pessoas/pessoas.js (bloco 4 do painel em módulos).
// ===== Conciliacao bancaria (modulo aplicado 18/08/2026) =====
// A regra que este modulo existe para impor: LER DINHEIRO ANTES DE LER LINHA.
// Linha do extrato sem par quase sempre e agregacao diferente (o banco lista o
// repasse por bandeira e o Saipos lanca o total; um boleto paga varias notas), nao
// dinheiro sumido. Em 01-12/08/2026 a ITAU AV tinha 125 linhas sem par e R$ 2,5 mil
// de diferenca sobre R$ 300 mil movimentados. Quem olha linha manda automatizar; quem
// olha dinheiro ve que esta em dia.
// Escopo: Agua Verde, Ahu e Sao Braz. BOQUEIRAO fica fora (decisao do dono, 18/08).
let CONCB = null;

// A REGRA DA CASA (dono, 19/08/2026), e ela e mais dura do que eu supunha:
// **a conciliacao bate no ZERO e fecha sempre em D-1**. Tudo que movimentou no
// banco ONTEM tem de bater no centavo ja na primeira rotina de hoje. Nao e meta
// de qualidade, e o que garante duas coisas: que nenhuma conta ficou por pagar,
// e que o saldo de partida do Fluxo Projetado do dia e real.
//
// Por isso o corte e 1 dia, nao 2 nem 3 (numeros que eu tinha chutado antes de
// perguntar), e a tolerancia em dinheiro e ZERO, nao "1% ou R$ 500" (regua que
// tambem era minha, nao da casa).
// Idade minima para uma linha entrar na fila. 1 = ONTEM em diante, que e a
// regra da casa: tudo que o banco movimentou ontem tem que bater no centavo na
// primeira rotina de hoje. Ficou como `> 1` por engano ate 19/08/2026, e o
// efeito era perverso: o cartao de cima dizia "ITAU AV nao fechou ontem,
// confira as linhas abaixo" e as linhas abaixo eram de ANTEONTEM. O dia
// cobrado era o unico que nao dava para conferir.
const CONCB_TOLERANCIA_DIAS = 1;

// Dia escolhido a mao pelas setas. Null = o sistema decide (o mais antigo em
// aberto). Fica fora do CONCB para sobreviver ao recarregar dos dados.
let CONCB_DIA_ESCOLHIDO = null;

const CONCB_TOL_CENTAVOS = 0.005;   // zero de verdade; so o arredondamento passa

async function entrarConcbanco() {
  await carregarApelidos();
  const alvo = document.getElementById('view-concbanco');
  if (!alvo) return;
  if (CONCB) { renderConcbanco(); return; }
  alvo.innerHTML = '<div class="contexto">Carregando a conciliação...</div>';
  try {
    const [placar, pend, saldoDia, pessoas, marcadas, naoConf, saldoConf, aFazer,
           diaSaldo, duvidas, sresiduo, matur, avisos, conferencia, parcial] = await Promise.all([
      consultarTudo('vw_fin_conciliacao_placar?select=*&order=data.desc'),
      consultarTudo('vw_fin_conciliacao_pendencias?select=*&order=dias.desc'),
      // 18/10/2026: a materializada nao tem RLS; o login le pela JANELA (vw_..._tela, fechada para
      // filial — script/sql/financeiro_fechado_para_filial_2026_10_18.sql). Sem a janela, a materializada.
      consultarTudo('vw_fin_conciliacao_saldo_dia_tela?select=*&order=data.desc')
        .catch(() => consultarTudo('mv_fin_conciliacao_saldo_dia?select=*&order=data.desc')),
      consultarTudo('rmb_pessoas?select=pessoa,email&ativo=is.true'),
      consultarTudo('fin_conciliacao_marcacao?select=*&order=criado_em.desc'),
      consultarTudo('vw_fin_conciliacao_nao_confirmou?select=*'),
      consultarTudo('vw_fin_conciliacao_saldo?select=*'),
      consultarTudo('vw_fin_conciliacao_a_fazer?select=*'),
      consultarTudo('vw_fin_conciliacao_dia_saldo?select=*&data=gte.'
        + new Date(Date.now() - 40 * 86400000).toISOString().slice(0, 10)),
      consultarTudo('vw_fin_conciliacao_duvidas?select=*'),
      // A VIEW, nao a tabela crua: ela esconde o residuo que o dono ja validou
      // no chat (marcacao 'saipos|...' com nao_vigiar) — caso Flavio/Viviane de
      // 28/08/2026, que reaparecia como alarme depois de validado.
      consultarTudo('vw_fin_conciliacao_saipos_residuo?select=conta,data,valor,subtipo,descricao&order=data'),
      // MATURIDADE: so as familias com volume, ordenadas por movimento. Sem o
      // corte, 490 das 600 familias sao contraparte que apareceu 3 vezes em 90
      // dias — barulho que esconde as 30 que decidem alguma coisa.
      consultarTudo('vw_fin_conciliacao_maturidade?select=*&linhas=gte.10&order=linhas.desc'),
      // Aviso da rotina unificada (28/08/2026): a rotina de conciliacao+lancamento
      // grava aqui quando termina cada passada; o banner diz a Hellen a hora de
      // agir. So leitura — quem escreve e a rotina, via conexao do servidor.
      consultarTudo('fin_conciliacao_aviso?select=*&order=criado_em.desc&limit=5'),
      // O QUE NAO BATE, LINHA A LINHA (dono, 25/09/2026: "vc que tem que nos
      // informar as diferencas entre banco e Saipos"). A conferencia ja nomeia a
      // linha que falta ou sobra no Saipos em cada dia em que o saldo nao fecha;
      // o painel nao lia isso e so mostrava o total.
      consultarTudo('vw_fin_conciliacao_conferencia?select=*&verificacao=eq.SALDO%20NAO%20FECHA'),
      // 07/11/2026 (auditoria lote 1, dinheiro-18): o dia cujo extrato veio parcial (OFX baixado no meio do dia)
      consultarTudo('vw_fin_saldo_partida?select=conta,ultimo_extrato_parcial_dia,hora_extrato').catch(() => []),
    ]);
    CONCB = { placar, pend, saldoDia, pessoas, marcadas, naoConf, saldoConf, aFazer, sresiduo,
              diaSaldo, duvidas, matur, avisos, conferencia, parcial };
  } catch (e) {
    alvo.innerHTML = '<div class="contexto">Não consegui carregar a conciliação: ' + e.message + '</div>';
    return;
  }
  renderConcbanco();
}

// --- Marcacao da conciliacao (18/08/2026) ---
// A Hellen opera a partir desta tela, entao ela nao digita no escuro: DECLARA.
// "Lancei agora" = digitou no Saipos. "Ja estava lancado" = achou la em outro
// formato, e isso e uma REGRA que o comparador nao sabe — vale mais que o
// lancamento em si, porque ensina o sistema. O login e o mesmo dos reembolsos.
// Sem login (decisao do dono, 19/08/2026): a Hellen ja entra no painel inteiro
// com a senha unica, e pedir um segundo login so para marcar era atrito sem
// ganho. O rastro continua pela identificacao escolhida na tela, lembrada no
// navegador — quem quiser marcar sem se identificar fica como PAINEL.
function concbQuem() {
  const s = rmbSessao();
  if (!s) return localStorage.getItem('concbQuem') || 'PAINEL';
  const lista = (CONCB && CONCB.pessoas) || [];
  const login = (s.email || '').toLowerCase();
  const local = login.split('@')[0];
  // 1) e-mail cadastrado bate; 2) o cadastro de rmb_pessoas.email esta vazio hoje,
  // entao aceita o nome que comeca o e-mail (hellen.algo -> HELLEN); 3) desiste e
  // mostra o proprio e-mail, que sempre identifica.
  const p = lista.find(x => (x.email || '').toLowerCase() === login)
         || lista.find(x => local.startsWith(String(x.pessoa).toLowerCase()));
  return p ? p.pessoa : (s.email || '');
}

// QUEM ESTA CONCILIANDO. Sem login, `concbQuem` devolvia sempre 'PAINEL' —
// localStorage era lido e nunca escrito. Na transicao para o robo isso e
// justamente o registro que importa: precisa dar para distinguir o que a Hellen
// fez do que o robo fez, e hoje nao dava. O dono nao quer exigir login para
// conciliar, entao pergunta-se UMA vez e guarda-se no proprio navegador.
async function concbGarantirQuem() {
  if (rmbSessao()) return concbQuem();
  const guardado = localStorage.getItem('concbQuem');
  if (guardado) return guardado;
  const pessoas = ((CONCB && CONCB.pessoas) || []).map(p => p.pessoa).filter(Boolean);
  const opcoes = pessoas.length ? pessoas.join(', ') : 'seu nome';
  const nome = prompt('Quem está conciliando?\n\n(' + opcoes + ')');
  if (!nome || !nome.trim()) return null;
  const limpo = nome.trim().toUpperCase().slice(0, 40);
  localStorage.setItem('concbQuem', limpo);
  return limpo;
}

// ATUALIZAR DE VERDADE: o painel e um HTML estatico no GitHub Pages e nao tem
// como rodar Python. Entao ele nao executa o comparador — ele INSERE um pedido
// em `fin_conciliacao_pedido`, e quem executa e `atender_conciliacao.py`, na
// maquina das rotinas. Este daqui so espera a resposta.
//
// O ciclo que isso fecha: a Hellen salva o OFX na pasta do Drive, clica
// atualizar, e o sistema importa o extrato, rele a janela curta do Saipos (para
// pegar o que ela acabou de lancar) e roda o comparador. A fila encolhe na tela
// sem ninguem ser chamado.
// ENVIAR O EXTRATO PELA TELA. Lê o arquivo como texto, manda para
// `fin_extrato_arquivo` e dispara o mesmo ciclo do botão atualizar — a rotina
// grava na pasta do Drive, importa e roda o comparador. A tela não vê o
// conteúdo de volta: a tabela só aceita escrita, de propósito.
async function concbEnviarOfx(inp, bt) {
  const arquivos = [...inp.files];
  inp.value = '';
  if (!arquivos.length) return;
  const texto = bt.textContent;
  bt.disabled = true;
  try {
    // O token de quem esta logado vale 1 hora, e este caminho era o UNICO do
    // painel que nao renovava: quem deixava a aba aberta levava
    // {"code":"PGRST303","message":"JWT expired"} e o extrato nao subia. Quem
    // envia sem login usa o anon, que nao vence — por isso so aparecia para o
    // dono. (09/09/2026)
    await rmbGarantirTokenValido();
    for (let i = 0; i < arquivos.length; i++) {
      bt.textContent = 'enviando ' + (i + 1) + '/' + arquivos.length + '...';
      const conteudo = await arquivos[i].text();
      // OFX é texto puro; arquivo grande demais aqui é sinal de que não é OFX
      if (conteudo.length > 8000000) throw new Error(arquivos[i].name + ' é grande demais');
      const envia = () => fetch(`${SUPABASE_URL}/rest/v1/fin_extrato_arquivo`, {
        method: 'POST', headers: rmbHeaders({ Prefer: 'return=minimal' }),
        body: JSON.stringify({ quem: concbQuem() || 'PAINEL',
                               nome: arquivos[i].name, conteudo }) });
      let r = await envia();
      // 401 no meio do envio: renova e repete. Se o refresh tambem morreu, a
      // sessao e apagada e a repeticao sai no anon — que tem permissao de
      // inserir aqui. Nos dois casos o extrato sobe.
      if (r.status === 401) { await rmbRenovarSeExpirado(r); r = await envia(); }
      if (!r.ok) throw new Error((await r.text()).slice(0, 120));
    }
  } catch (e) {
    bt.textContent = texto; bt.disabled = false;
    alert('Não consegui enviar: ' + e.message);
    return;
  }
  bt.textContent = texto; bt.disabled = false;
  // enviar sem importar não serve para nada: dispara o ciclo na sequência
  await concbRodarComparador(document.getElementById('concbAtualizar'));
}

async function concbRodarComparador(bt) {
  const texto = bt.textContent;
  bt.disabled = true;
  bt.textContent = 'atualizando...';
  try {
    // mesma historia do envio de OFX: renova antes, e repete uma vez no 401
    await rmbGarantirTokenValido();
    const pede = () => fetch(`${SUPABASE_URL}/rest/v1/fin_conciliacao_pedido`, {
      method: 'POST',
      headers: rmbHeaders({ Prefer: 'return=representation' }),
      body: JSON.stringify({ quem: concbQuem() || 'PAINEL' }),
    });
    let r = await pede();
    if (r.status === 401) { await rmbRenovarSeExpirado(r); r = await pede(); }
    if (!r.ok) throw new Error((await r.text()).slice(0, 120));
    const pedido = (await r.json())[0];

    // ate 3 minutos: importar OFX + janela curta do Saipos + comparador leva
    // cerca de 1 minuto quando a rede esta boa
    const limite = Date.now() + 180000;
    let estado = 'PENDENTE';
    while (Date.now() < limite && (estado === 'PENDENTE' || estado === 'RODANDO')) {
      await new Promise(s => setTimeout(s, 3000));
      const q = await fetch(
        `${SUPABASE_URL}/rest/v1/fin_conciliacao_pedido?id=eq.${pedido.id}&select=status,resumo`,
        { headers: rmbHeaders() });
      if (!q.ok) break;
      const linha = (await q.json())[0];
      if (linha) estado = linha.status;
      bt.textContent = estado === 'RODANDO' ? 'rodando...' : 'na fila...';
      if (estado === 'ERRO') { alert('Não consegui atualizar: ' + (linha.resumo || '')); break; }
    }
    if (estado === 'PENDENTE') {
      alert('O pedido entrou na fila mas ninguém atendeu. A máquina das rotinas '
          + 'pode estar desligada — a conciliação da manhã pega isso de qualquer jeito.');
    }
  } catch (e) {
    alert('Não consegui pedir a atualização: ' + e.message);
  }
  bt.textContent = texto;
  bt.disabled = false;
  CONCB = null;
  await entrarConcbanco();
}

// ENSINAR UM NOME: o par vira cadastro sozinho na proxima rodada
// (`aplicar_licoes.py`). Nao interpreto texto livre aqui — so o par de nomes,
// que e mecanico e reversivel.
// TRES CAMPOS, espelhando as colunas da grade — desenho do dono, 21/08/2026:
// o que e, a descricao a digitar no Saipos, e a categoria. O prompt de um campo
// so nao servia: perguntava "como aparece no Saipos" e recebia ora um nome, ora
// um historico, ora uma explicacao — tres coisas diferentes na mesma caixa.
//
// A CATEGORIA e o campo que vai fazer diferenca na automacao via Chrome: sem ela
// o robo sabe o que digitar no historico e nao sabe onde classificar.
// AS CATEGORIAS SAO AS NOSSAS, nao as do Saipos. O Saipos tem a mesma coisa
// escrita de tres jeitos ('Alimentação Funcionarios', 'Alimentacao Funcionarios',
// 'Alimentaçao Funcionarios') e o dono decidiu em 21/08 NAO padronizar la
// ("mexer la e muito trabalhoso"): a faxina passou a ser do nosso lado, na
// tabela fin_de_para_categoria — 245 grafias do Saipos cobertas por 106
// categorias nossas. Por isso a lista sai de categoria_nossa, distinta.
// Pendencia conhecida: quando o robo for digitar no Saipos, ele vai precisar do
// nome de LA, e o caminho de volta ainda nao esta resolvido.
// LISTA VAZIA NAO PODE PASSAR EM SILENCIO (01/09/2026). As tres funcoes abaixo
// faziam `r.ok ? await r.json() : []` — requisicao negada virava lista vazia, o
// select nascia sem opcao nenhuma e ninguem sabia por que. O dono tentou ensinar
// a regra do FABIO NUNES e a janela abriu com forma de pagamento e categoria em
// branco; o backend estava inteiro (367 categorias, 5 metodos, 23 contas, todos
// visiveis para `authenticated`), o que fica de pe como causa e a sessao caida.
// Pior: a lista vazia era MEMOIZADA — uma falha de rede contaminava a pagina ate
// dar F5. Agora avisa e nao guarda.
async function concbAvisaLista(nome, r) {
  const detalhe = await r.text().catch(() => '');
  console.error('lista ' + nome + ' falhou', r.status, detalhe);
  alert('Não consegui carregar a lista de ' + nome + ' (erro ' + r.status + ').\n\n'
      + 'Quase sempre é a sessão que expirou: recarregue a página (F5) e entre de novo.\n'
      + 'Se continuar, me chame — a lista vazia aqui esconderia o erro.');
}

let CONCB_CATEGORIAS = null;

async function concbCategorias() {
  if (CONCB_CATEGORIAS) return CONCB_CATEGORIAS;
  const r = await fetch(`${SUPABASE_URL}/rest/v1/fin_de_para_categoria`
    + '?usar=is.true&select=categoria_nossa&order=categoria_nossa.asc',
    { headers: rmbHeaders() });
  if (!r.ok) { await concbAvisaLista('categorias', r); return []; }  // sem memoizar
  const linhas = await r.json();
  // varias grafias do Saipos apontam para a mesma categoria nossa: a lista
  // mostra cada uma UMA vez, senao nasce com repetido — que foi exatamente a
  // confusao que esta proposta veio resolver
  CONCB_CATEGORIAS = [...new Set(linhas.map(x => x.categoria_nossa).filter(Boolean))];
  return CONCB_CATEGORIAS;
}

// AS LISTAS QUE O DONO MANDOU USAR (24/08/2026). Forma de pagamento sai do
// SAIPOS — "o tipo de pagamento pode pegar da lista do Saipos mesmo" — e nao de
// uma lista paralela nossa, que envelheceria sozinha. Contas de origem/destino
// somam as contas do Saipos com o vocabulario que o receituario ja usa (REDE,
// PIX), porque transferencia sai de lugar que nem sempre e conta bancaria: ele
// descreveu o caminho do iFood como "uma TEF do iFood Online para o Santander".
let CONCB_METODOS = null;

async function concbMetodos() {
  if (CONCB_METODOS) return CONCB_METODOS;
  const r = await fetch(`${SUPABASE_URL}/rest/v1/vw_fin_metodos_pagamento`
    + '?select=metodo&order=usos.desc', { headers: rmbHeaders() });
  if (!r.ok) { await concbAvisaLista('formas de pagamento', r); return []; }
  CONCB_METODOS = (await r.json()).map(x => x.metodo).filter(Boolean);
  return CONCB_METODOS;
}

let CONCB_CONTAS_REGRA = null;

async function concbContasRegra() {
  if (CONCB_CONTAS_REGRA) return CONCB_CONTAS_REGRA;
  const r = await fetch(`${SUPABASE_URL}/rest/v1/vw_fin_contas_para_regra`
    + '?select=conta,nome&order=usos.desc', { headers: rmbHeaders() });
  if (!r.ok) { await concbAvisaLista('contas', r); return []; }
  // mostra o nome (fin_contas.apelido, 04/11/2026); grava a CHAVE (conta), que é o que o robô lê
  CONCB_CONTAS_REGRA = (await r.json()).filter(x => x.conta).map(x => ({ v: x.conta, t: x.nome || x.conta }));
  return CONCB_CONTAS_REGRA;
}

async function concbFormEnsinar(d) {
  const antigo = document.getElementById('concbFormEnsinar');
  if (antigo) antigo.remove();
  // escape proprio: o `esc` do modulo e local do renderConcbanco e nao existe aqui
  const seguro = (s) => String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');
  const campo = (id, rotulo, dica) =>
    '<div style="margin-bottom:10px"><label style="display:block;font-size:11px;'
    + 'opacity:.8;margin-bottom:3px">' + rotulo + '</label>'
    + '<input id="' + id + '" placeholder="' + dica + '" style="width:100%;padding:6px 8px;'
    + 'font-size:13px;border:1px solid #8a897e;border-radius:4px;background:transparent;'
    + 'color:inherit;box-sizing:border-box"></div>';
  // Lista fechada de proposito: digitar a categoria na mao foi o que trouxe esta
  // proposta — a Hellen digitou uma em 21/08, e categoria errada joga o
  // lancamento numa conta que nao move DRE nem DFC. A saida "nao esta na lista"
  // existe para nao travar quem esta conciliando, mas marca a licao como DUVIDA
  // para alguem olhar, em vez de virar cadastro sozinha.
  // `aberta` decide se a lista tem a saida "nao esta na lista". Categoria, forma
  // de pagamento e conta tem: o cadastro do Saipos cresce e travar quem esta
  // conciliando e pior. TIPO DE LANCAMENTO nao tem, e de proposito — sao tres e
  // sao esses (dono, 24/08/2026: "deve ser despesa, receita ou transferencias").
  // Uma quarta opcao ali nao seria caso novo, seria erro de digitacao virando cadastro.
  const lista = (id, rotulo, itens, aberta = true) =>
    '<div style="margin-bottom:10px"><label style="display:block;font-size:11px;'
    + 'opacity:.8;margin-bottom:3px">' + rotulo + '</label>'
    + '<select id="' + id + '" style="width:100%;padding:6px 8px;font-size:13px;'
    + 'border:1px solid #8a897e;border-radius:4px;background:#1a1a19;color:inherit;'
    + 'box-sizing:border-box"><option value="">\u2014 escolha \u2014</option>'
    + itens.map(v => v && typeof v === 'object'
      ? '<option value="' + seguro(v.v) + '">' + seguro(v.t) + '</option>'
      : '<option>' + seguro(v) + '</option>').join('')
    + (aberta ? '<option value="__OUTRA__">n\u00e3o est\u00e1 na lista\u2026</option>' : '')
    + '</select></div>';
  const categorias = await concbCategorias();
  const metodos = await concbMetodos();
  const contasRegra = await concbContasRegra();
  // CPF/CNPJ direto do memo do OFX — o formato do banco varia, o documento não.
  const docLinha = (String(d.memo || '').match(
    /\d{3}\.\d{3}\.\d{3}-\d{2}|\d{2}\.\d{3}\.\d{3}\/\d{4}-\d{2}/) || [''])[0];
  // caixa de marcar + campo que so vale quando ela esta marcada
  const marca = (id, rotulo) =>
    '<label style="display:flex;align-items:center;gap:6px;font-size:12px;'
    + 'margin-bottom:6px;cursor:pointer"><input type="checkbox" id="' + id + '" '
    + 'style="width:14px;height:14px;cursor:pointer">' + rotulo + '</label>';
  const cx = document.createElement('div');
  cx.id = 'concbFormEnsinar';
  cx.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.6);z-index:9999;'
    + 'display:flex;align-items:center;justify-content:center';
  cx.innerHTML = '<div style="background:#1a1a19;color:#e8e6dc;padding:18px 20px;'
    + 'border-radius:8px;max-width:460px;width:92%;border:1px solid #8a897e">'
    + '<div style="font-weight:700;margin-bottom:4px">Ensinar esta linha</div>'
    + '<div style="font-size:12px;opacity:.8;margin-bottom:14px">No banco: <b>'
    + seguro(d.nome || d.memo || '') + '</b>'
    // O CPF/CNPJ QUE O OFX TRAZ (01/09/2026, ideia do dono: "o que não casar por
    // nome, casa por CPF/CNPJ"). Medido: 94% das linhas do OFX de agosto trazem a
    // chave, e as que não trazem são as que não têm contraparte (lote SISPAG,
    // rendimento, tarifa). Mostrar aqui serve para duas coisas: quem ensina
    // confere que é a pessoa certa, e o par passa a casar por chave exata — que
    // não sofre com o banco mudando o formato do histórico de um dia para o outro.
    + '</div>'
    // NOME E CPF/CNPJ EDITAVEIS (dono, 15/10/2026: "a tela de regra nao abriu o
    // campo para colocar o nome ou CPF"). Ate aqui os dois eram so texto lido do
    // memo: linha sem documento no historico nao tinha como ganhar um, e nome
    // cortado pelo banco nao tinha como ser corrigido. Vem preenchido com o que o
    // OFX traz; quem ensina confere e, se precisar, troca.
    + campo('ensNome', 'Nome no banco', 'ex.: GUSTAVO KOVACS BELETATO')
    + campo('ensDoc', 'CPF/CNPJ (com ele a regra casa pelo número, não pela grafia)',
        'ex.: 385.789.238-20 — deixe vazio se não houver')
    + campo('ensQue', 'O que é', 'ex.: compra de tinta para manutenção')
    + campo('ensDesc', 'Descrição no Saipos (o histórico a digitar)', 'ex.: TINTAS VERGINIA')
    // TIPO DE LANCAMENTO primeiro: e ele que decide se a tela pergunta contas
    // (transferencia) ou categoria (despesa/receita). Os tres valores sao os que
    // o dono ditou em 24/08/2026, e sao os mesmos que o receituario ja usava.
    + lista('ensTipo', 'Tipo de lançamento', ['DESPESA', 'RECEITA', 'TRANSFERENCIA'], false)
    + lista('ensMet', 'Forma de pagamento', metodos)
    // ROBO LANCA (dono, 16/09/2026). NAO = a regra so faz a linha casar com o que ja
    // esta no Saipos (ex.: COPEL, conta a pagar com provisao) — o robo nunca a lanca.
    // 3a OPCAO (dono, 04/11/2026 14:08: "já tem provisão, o robo só precisa baixar ao invés de lançar"): grava
    // fin_licao.acao='CONCILIAR_PROVISAO'; o aplicar_licoes leva para a regra e o robô (Passo R2g) só dá a baixa.
    + lista('ensRobo', 'Robô lança?', ['SIM', 'NÃO',
        { v: 'PROVISAO', t: 'Já tem provisão no Saipos: o robô só dá a baixa' }], false)
    + '<div id="ensDicaProv" style="display:none;font-size:11.5px;opacity:.85;margin:-4px 0 10px">'
    +   'A regra casa pelo <b>Nome no banco</b>: deixe só o que se repete todo mês (ex.: TARIFA MENSAL). '
    +   'Mês e data mudam e fariam a regra valer uma vez só.</div>'
    + '<div id="ensBlocoTransf" style="display:none">'
    +   lista('ensOri', 'Sai de qual conta', contasRegra)
    +   lista('ensDest', 'Entra em qual conta', contasRegra)
    + '</div>'
    + '<div id="ensBlocoCat">' + lista('ensCat', 'Categoria', categorias) + '</div>'
    + marca('ensAgrupa', 'O banco manda várias linhas e o Saipos lança uma só')
    + '<div id="ensBlocoPalavra" style="display:none">'
    +   campo('ensPalavra', 'Palavra que agrupa', 'ex.: REDECARD')
    + '</div>'
    + '<div style="text-align:right;margin-top:14px">'
    + '<button id="ensCancela" style="font-size:12px;padding:5px 12px;margin-right:6px;'
    + 'cursor:pointer;border:1px solid #8a897e;background:transparent;color:inherit;'
    + 'border-radius:4px">cancelar</button>'
    + '<button id="ensSalva" style="font-size:12px;padding:5px 14px;cursor:pointer;'
    + 'border:1px solid #c8102e;background:transparent;color:#c8102e;border-radius:4px">'
    + 'guardar</button></div></div>';
  document.body.appendChild(cx);
  // A TELA PERGUNTA SO O QUE CABE. Transferencia nao tem categoria e
  // despesa/receita nao tem conta de origem e destino — palavras do dono,
  // 24/08/2026: "a diferenca vai ser que nao tem conta que entra e sai, mas
  // mantem todas as outras". Mostrar os dois ao mesmo tempo convida a preencher
  // o que nao existe, e campo preenchido a toa vira cadastro errado.
  const ehTransf = () => document.getElementById('ensTipo').value === 'TRANSFERENCIA';
  const arruma = () => {
    document.getElementById('ensBlocoTransf').style.display = ehTransf() ? '' : 'none';
    document.getElementById('ensBlocoCat').style.display = ehTransf() ? 'none' : '';
    document.getElementById('ensBlocoPalavra').style.display =
      document.getElementById('ensAgrupa').checked ? '' : 'none';
  };
  document.getElementById('ensTipo').addEventListener('change', arruma);
  document.getElementById('ensAgrupa').addEventListener('change', arruma);
  // "só baixa a provisão" é conta que se repete (tarifa mensal): o nome do banco traz o mês ("...OUTUBRO") e a
  // regra 500 nasceu valendo um mês só (consertada à mão em 04/11). Ao escolher a opção, a tela tira mês e data do
  // nome e mostra a dica; quem ensina confere e pode mudar.
  document.getElementById('ensRobo').addEventListener('change', () => {
    const prov = document.getElementById('ensRobo').value === 'PROVISAO';
    document.getElementById('ensDicaProv').style.display = prov ? '' : 'none';
    if (!prov) return;
    const n = document.getElementById('ensNome');
    n.value = n.value.toUpperCase()
      .replace(/\b(JANEIRO|FEVEREIRO|MAR[CÇ]O|ABRIL|MAIO|JUNHO|JULHO|AGOSTO|SETEMBRO|OUTUBRO|NOVEMBRO|DEZEMBRO|JAN|FEV|MAR|ABR|MAI|JUN|JUL|AGO|SET|OUT|NOV|DEZ)\b/g, ' ')
      .replace(/\b\d{1,2}[\/.-]\d{1,2}([\/.-]\d{2,4})?\b|\b\d{4}\b/g, ' ')
      .replace(/\s+/g, ' ').trim();
  });
  arruma();
  document.getElementById('ensNome').value = d.nome || d.memo || '';
  document.getElementById('ensDoc').value = docLinha;
  document.getElementById('ensQue').focus();
  const fecha = () => cx.remove();
  cx.addEventListener('click', e => { if (e.target === cx) fecha(); });
  document.getElementById('ensCancela').addEventListener('click', fecha);
  document.getElementById('ensSalva').addEventListener('click', async () => {
    // LER OS TRES CAMPOS ANTES DE FECHAR. Eu fechava a janela e so entao lia dois
    // deles — os elementos ja nao existiam, `getElementById` devolvia null,
    // `.value` estourava e a gravacao morria em silencio, sem nem um aviso. O
    // dono preencheu tudo e nada chegou (21/08/2026).
    const oQue = document.getElementById('ensQue').value.trim();
    const desc = document.getElementById('ensDesc').value.trim();
    const tipoLanc = document.getElementById('ensTipo').value.trim();
    const transf = tipoLanc === 'TRANSFERENCIA';
    let met = document.getElementById('ensMet').value.trim();
    const agrupa = document.getElementById('ensAgrupa').checked;
    const palavra = document.getElementById('ensPalavra').value.trim();
    const robo = document.getElementById('ensRobo').value.trim();
    const ori = transf ? document.getElementById('ensOri').value.trim() : '';
    const dest = transf ? document.getElementById('ensDest').value.trim() : '';
    let cat = transf ? '' : document.getElementById('ensCat').value.trim();
    // "nao esta na lista" nao vira cadastro sozinho: e' justamente o caso que
    // alguem precisa olhar antes de virar regra.
    let revisar = false;
    if (cat === '__OUTRA__') {
      cat = (prompt('Qual categoria? Vou guardar para alguém conferir.') || '').trim();
      revisar = true;
    }
    // Mesma trava da categoria, pelo mesmo motivo: fora da lista nao vira
    // cadastro sozinho, vira DUVIDA para alguem olhar antes.
    if (met === '__OUTRA__') {
      met = (prompt('Qual forma de pagamento? Vou guardar para alguém conferir.') || '').trim();
      revisar = true;
    }
    let contas = { origem: ori, destino: dest };
    for (const lado of ['origem', 'destino']) {
      if (contas[lado] === '__OUTRA__') {
        contas[lado] = (prompt('Qual conta ' + (lado === 'origem' ? 'sai' : 'entra')
          + '? Vou guardar para alguém conferir.') || '').trim();
        revisar = true;
      }
    }
    // MARCOU QUE AGRUPA E NAO DISSE A PALAVRA: sem ela o agrupamento nao existe,
    // e gravar assim faria a pessoa achar que ensinou algo que nao vai valer.
    if (agrupa && !palavra) {
      alert('Você marcou que o banco manda várias linhas. Escreva a palavra que aparece em todas elas.');
      return;
    }
    // A descricao e o unico campo obrigatorio: e ela que vira o par de de-para e
    // faz a linha casar sozinha da proxima vez. Os outros dois enriquecem.
    if (!desc) { alert('A descrição do Saipos é o que faz a linha casar. Preencha ela.'); return; }
    // Sem resposta nao se chuta: SIM lancaria em dobro uma conta que so devia casar.
    if (!robo) { alert('Escolha se o robô lança (SIM), se a regra serve só para casar (NÃO) ou se já tem provisão e o robô só dá a baixa.'); return; }
    const nomeBanco = document.getElementById('ensNome').value.trim().toUpperCase();
    // O documento vai para a regra ESCRITO COMO O BANCO ESCREVE (pontos, barra e
    // traco): o aplicar_licoes usa o texto como padrao, e so digitos nao casariam
    // com "385.789.238-20" no memo. Quem digita so numeros nao precisa saber disso.
    const dig = document.getElementById('ensDoc').value.replace(/\D/g, '');
    if (dig && dig.length !== 11 && dig.length !== 14) {
      alert('O CPF tem 11 números e o CNPJ tem 14. Confira ou deixe o campo vazio.');
      return;
    }
    const docFinal = dig.length === 11
      ? dig.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, '$1.$2.$3-$4')
      : dig.length === 14
        ? dig.replace(/(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})/, '$1.$2.$3/$4-$5') : '';
    fecha();
    await concbGravarLicao({ tipo: revisar ? 'DUVIDA' : 'NOME', conta: d.conta, fitid: d.fitid,
      memo_banco: d.memo || null, nome_banco: nomeBanco || d.nome || null, texto: desc,
      o_que_e: oQue || null, categoria: cat || null, documento: docFinal || null,
      tipo_lancamento: tipoLanc || null, metodo_pagamento: met || null,
      conta_origem: contas.origem || null, conta_destino: contas.destino || null,
      agrupa: agrupa, palavra_chave: palavra || null, robo_lanca: robo === 'SIM',
      acao: robo === 'PROVISAO' ? 'CONCILIAR_PROVISAO' : null });
  });
}

async function concbEnsinar(d) { await concbFormEnsinar(d); }

// QUEM RESPONDE PELO FINANCEIRO HOJE — vem da tabela, nunca escrito aqui.
// Ate 31/08/2026 este arquivo dizia "Vou avisar o Neto", com o nome dele no
// codigo. O dono comecou a preparar a propria saida e isso vira beco sem saida:
// ninguem vai lembrar de procurar um nome solto em 12 mil linhas. Agora o papel
// e o endereco e a pessoa e o conteudo — trocar quem responde e um UPDATE em
// fin_papel. Cache por sessao; se a leitura falhar, cai no papel genErico, que
// continua verdadeiro.
let concbRespCache = null;

async function concbResponsavel() {
  if (concbRespCache) return concbRespCache;
  try {
    const r = await fetch(`${SUPABASE_URL}/rest/v1/fin_papel`
      + `?papel=eq.RESPONSAVEL_FINANCEIRO&select=nome`, { headers: rmbHeaders() });
    const j = r.ok ? await r.json() : [];
    concbRespCache = (j[0] && j[0].nome) || 'o responsável financeiro';
  } catch (e) {
    concbRespCache = 'o responsável financeiro';
  }
  return concbRespCache;
}

// Registrar a duvida sem exigir explicacao: quem nao sabe o que e a linha
// tambem nao sabe descrever o problema. O texto e opcional de proposito.
async function concbDuvida(d) {
  const texto = prompt('Vou avisar ' + (await concbResponsavel()) + ' sobre esta linha.\n\n'
    + 'No banco: ' + (d.nome || d.memo || '') + '\n\n'
    + 'Quer dizer alguma coisa? (pode deixar em branco)');
  if (texto === null) return;
  await concbGravarLicao({ tipo: 'DUVIDA', conta: d.conta, fitid: d.fitid,
    memo_banco: d.memo || null, nome_banco: d.nome || null,
    texto: texto.trim() || 'sem observação' });
}

// MANDAR UMA REGRA: qualquer coisa que nao seja um par de nomes. Fica esperando
// leitura humana de proposito — regra em texto livre virando codigo sozinha e
// como se inventa erro caro.
async function concbRecado() {
  const texto = prompt('Escreva a regra ou o recado. '
    + 'Ele fica guardado até alguém aplicar — não é interpretado automaticamente.');
  if (!texto || !texto.trim()) return;
  await concbGravarLicao({ tipo: 'RECADO', texto: texto.trim() });
}

async function concbGravarLicao(corpo) {
  corpo.quem = (await concbGarantirQuem()) || 'PAINEL';
  let r;
  // try/catch em volta: sem ele, qualquer erro daqui morre como promessa
  // rejeitada e a pessoa fica achando que gravou. Aviso na cara e obrigatorio.
  try {
    r = await fetch(`${SUPABASE_URL}/rest/v1/fin_licao`, {
      method: 'POST', headers: rmbHeaders({ Prefer: 'return=minimal' }),
      body: JSON.stringify(corpo) });
  } catch (e) {
    alert('Não consegui gravar: ' + e.message);
    return;
  }
  if (!r.ok) { alert('Não gravou: ' + (await r.text()).slice(0, 140)); return; }
  alert(corpo.tipo === 'NOME'
    ? 'Guardado. Na próxima atualização essa linha já casa sozinha.'
    : 'Guardado. Vai ser lido e aplicado — não é automático.');
}

// CONCILIAR EM LOTE: uma chamada com todas as linhas marcadas, e um recarregar
// da tela no fim. Antes era um POST e um recarregar por linha — com 30 linhas a
// pessoa passava mais tempo esperando a tela do que conciliando.
async function concbConciliarMarcadas(bt) {
  const tab = document.getElementById(bt.dataset.alvo);
  if (!tab) return;
  const marcadas = [...tab.querySelectorAll('.concb-check')].filter(x => x.checked);
  if (!marcadas.length) { alert('Marque as linhas que você já conciliou no Saipos.'); return; }
  const quem = await concbGarantirQuem();
  if (!quem) return;
  const s = rmbSessao();
  const corpo = marcadas.map(x => ({ conta: x.dataset.conta, fitid: x.dataset.fitid,
    tipo: 'CONCILIADO', quem, email: (s && s.email) || null }));
  const texto = bt.textContent;
  bt.disabled = true; bt.textContent = 'gravando...';
  let r = await fetch(`${SUPABASE_URL}/rest/v1/fin_conciliacao_marcacao`, {
    method: 'POST', headers: rmbHeaders({ Prefer: 'return=minimal' }),
    body: JSON.stringify(corpo) });
  if (await rmbRenovarSeExpirado(r)) {
    r = await fetch(`${SUPABASE_URL}/rest/v1/fin_conciliacao_marcacao`, {
      method: 'POST', headers: rmbHeaders({ Prefer: 'return=minimal' }),
      body: JSON.stringify(corpo) });
  }
  bt.disabled = false; bt.textContent = texto;
  if (!r.ok) { alert('Não gravou: ' + (await r.text()).slice(0, 140)); return; }
  CONCB = null;
  await entrarConcbanco();
}

async function concbDesmarcar(conta, fitid) {
  const url = `${SUPABASE_URL}/rest/v1/fin_conciliacao_marcacao`
    + `?conta=eq.${encodeURIComponent(conta)}&fitid=eq.${encodeURIComponent(fitid)}`;
  let r = await fetch(url, { method: 'DELETE', headers: rmbHeaders() });
  if (await rmbRenovarSeExpirado(r)) r = await fetch(url, { method: 'DELETE', headers: rmbHeaders() });
  if (!r.ok) { alert('Não desfez: ' + (await r.text()).slice(0, 140)); return; }
  CONCB = null;
  await entrarConcbanco();
}

// O MEMO do Itau empilha tres coisas: o tipo da operacao, o historico curto do
// formato antigo (nome cortado em 13 letras colado na data) e o nome completo com
// CPF. Ex.: "PIX RECEBIDO PIX TRANSF LEONARD16/08 LEONARDO ALMEIDA DE OLIVEIRA
// 064.607.109-29". Ler fiel esta certo — guardamos assim —, mas na tela isso vira
// ruido e o corte de 54 caracteres ainda cortava no meio do nome.
// Aqui e SO exibicao: o memo cru continua intacto no banco.
function memoLimpo(memo) {
  let s = String(memo || '')
    .replace(/\s*\d{3}\.\d{3}\.\d{3}-\d{2}\s*$/, '')          // CPF no fim
    .replace(/\s*\d{2}\.\d{3}\.\d{3}\/\d{4}-\d{2}\s*$/, '')  // CNPJ no fim
    .replace(/\S*\d{2}\/\d{2}(?=\s|$)/g, ' ')                  // "LEONARD16/08"
    .replace(/\s+/g, ' ').trim();
  // Tira o trecho truncado quando ele e o comeco do que vem logo depois:
  // "MARCOS AUGUS MARCOS AUGUSTO BOVING" -> "MARCOS AUGUSTO BOVING".
  const w = s.split(' ');
  for (let i = 0; i < w.length; i++) {
    for (let k = Math.min(4, Math.floor((w.length - i) / 2)); k >= 1; k--) {
      const a = w.slice(i, i + k), b = w.slice(i + k, i + 2 * k);
      if (a.length === k && b.length === k && a.every((x, j) => b[j].startsWith(x))) {
        w.splice(i, k);
        i--;
        break;
      }
    }
  }
  // O banco ainda empilha dois rotulos de operacao ("PIX RECEBIDO PIX TRANSF").
  // Como a tela ja separa Entradas de Saidas, SAIDA/ENTRADA nao acrescentam nada;
  // do resto do cabecalho ficam 2 palavras, e o que importa — QUEM — vem depois.
  const OP = ['SAIDA', 'SAÍDA', 'ENTRADA', 'PIX', 'QR', 'QRS', 'CODE', 'TRANSF',
              'RECEBIDO', 'ENVIADO', 'BOLETO', 'PAGO', 'RECEBIMENTO', 'RECEBIMENTOS',
              'PAGAMENTO', 'PAGAMENTOS', 'TED', 'DOC', 'SISPAG', 'DA'];
  let i = 0;
  while (i < w.length && OP.includes(w[i].toUpperCase())) i++;
  const tipo = w.slice(0, i).filter(x => !['SAIDA', 'SAÍDA', 'ENTRADA'].includes(x.toUpperCase()));
  const quem = w.slice(i).join(' ');
  if (!quem) return w.join(' ');
  const rotulo = tipo.slice(0, 2).join(' ').toUpperCase()
    .replace(/^DA$/, 'DÉBITO AUTOM.')          // sigla do extrato do Itaú
    .replace(/^RECEBIMENTOS? SISPAG$/, 'SISPAG');
  return (rotulo ? rotulo + ' — ' : '') + quem;
}

function renderConcbanco() {
  const alvo = document.getElementById('view-concbanco');
  if (!alvo || !CONCB) return;

  // A tela responde UMA pergunta: ontem fechou? Tudo que nao serve para agir de
  // manha foi para o fim, recolhido. A versao anterior expunha o raciocinio do
  // comparador (linhas casadas, agregacao, ancora de saldo) e o dono devolveu:
  // "tem que ser muito facil de entender, sem explicacao tecnica, pratico para
  // o dia a dia". Quem concilia precisa saber o que fazer, nao como eu penso.
  const cru = CONCB;
  const daLoja = (arr) => (arr || []).filter(r => lojaFin() === 'REDE' || r.unidade === lojaFin());
  const placar = daLoja(cru.placar), pend = daLoja(cru.pend), saldoDia = daLoja(cru.saldoDia);
  const naoConf = daLoja(cru.naoConf);
  const saldoConf = daLoja(cru.saldoConf);
  const aFazer = daLoja(cru.aFazer);
  const quem = concbQuem();
  const n = (v) => Number(v) || 0;
  const rs = (v) => n(v).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const ddmm = (d) => d ? d.slice(8, 10) + '/' + d.slice(5, 7) : '—';
  const esc = (s) => String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');

  // O nome de tela sai de nomeConta(), la de cima — o mesmo de/para do painel
  // inteiro. As views daqui tambem trazem `conta_exibida`, mas manter duas
  // fontes para a mesma pergunta e' como o nome do dono acabou escrito em dois
  // lugares e um deles envelheceu. Uma so.
  if (!placar.length) {
    alvo.innerHTML = seletorLojaFin() +
      '<div class="contexto">Sem conciliação para <b>' + nomeLojaFin() + '</b> ainda. ' +
      'A rotina roda todo dia às 08:40 e alimenta esta tela.</div>';
    return;
  }

  // ---- ONTEM, conta por conta ----
  const ontem = new Date(Date.now() - (new Date().getTimezoneOffset() + 1440) * 60000)
    .toISOString().slice(0, 10);
  // Regra do dono (19/08): entrada e saida sao conciliadas SEPARADO, e a entrada
  // vem primeiro. Entao o placar tambem separa — dizer "faltam R$ 500" sem dizer
  // de que lado obriga a pessoa a procurar nos dois.
  // OS DIAS EM ABERTO, nao só ontem. Em 21/08/2026 a Hellen precisou se ausentar
  // e ficaram dois dias para fazer — a tela dizia "conciliação de ontem" e
  // escondia o dia anterior, que era metade do trabalho. Agora ela mostra todos
  // os dias que ainda têm linha por conciliar, do marco zero até ontem, e só cai
  // para "ontem" quando não há nada em aberto.
  // O DIA A CONCILIAR É O SEGUINTE AO ÚLTIMO EM QUE OS SALDOS BATERAM — regra do
  // dono, 21/08/2026, e é melhor que "ontem" por um motivo: "ontem" é suposição,
  // isto é fato. Quando o saldo acumulado bate num dia, tudo para trás está
  // resolvido, mesmo que dias no meio tenham ficado fora (o SÃO BRAZ teve 15, 16
  // e 17/08 fora e voltou a zero em 18).
  //
  // E a conciliação é feita DIA A DIA, em ordem: fecha o 19 antes de ir ao 20.
  // Por isso a tela mostra UM dia, o mais antigo em aberto, com setas para
  // navegar — não uma pilha de dias misturados.
  //
  // E ELA SÓ VALE PARA CONTA QUE TEM FECHAMENTO PRÓPRIO. Conta que nunca fechou
  // desde o marco zero fica com `dia_a_conciliar` preso no próprio marco (a view
  // usa GREATEST(ultimo_ok + 1, marco)), e como esse é o dia mais antigo da
  // lista, ele sequestra a tela. Em 24/08/2026 a fila zerou pela primeira vez e a
  // tela voltou para 17/08 por causa da SANTANDER e da PARTICIPAÇÕES — o dono viu
  // na hora: era segunda, e o trabalho do dia era a sexta, 21/08. É a MESMA
  // armadilha do parágrafo acima, que entrou de novo pela porta do fallback: lá
  // ela foi resolvida preferindo a fila, e a fila vazia devolveu o problema.
  // O saldo dessas duas contas continua aparecendo na coluna Saldo, que é onde
  // ele se resolve.
  const diaSeguinte = (d) => new Date(Date.parse(d + 'T00:00:00Z') + 864e5)
    .toISOString().slice(0, 10);
  const pendentes = [...new Set(aFazer
    .filter(x => !x.em_dia && x.ultimo_ok && x.dia_a_conciliar === diaSeguinte(x.ultimo_ok))
    .map(x => x.dia_a_conciliar))].sort();
  // O DIA PADRÃO É O MAIS ANTIGO COM LINHA NA FILA. Tentei antes usar "o mais
  // antigo em aberto pelo saldo", mas conta que nunca fecha mantém o dia dela em
  // aberto para sempre: a SANTANDER e a PARTICIPAÇÕES prendiam a tela em 17/08
  // enquanto o trabalho real era 19 e 20/08. Fila vazia num dia significa que não
  // há o que fazer ali — o problema de saldo daquelas duas contas aparece na
  // coluna Saldo, que é onde ele se resolve, e não arrasta a tela junto.
  const comTrabalho = [...new Set(pend.filter(p => p.classe === 'ABERTA')
    .map(p => p.data).filter(d => d && d <= ontem))].sort();
  // O ÚLTIMO RECURSO NÃO PODE SER "ONTEM": o banco não movimenta sábado e
  // domingo (dono, 24/08/2026 — "tudo que acontece nesses dias aparece somente no
  // extrato de segunda"), então numa segunda "ontem" é domingo e a tela abre
  // vazia, como se nada tivesse acontecido. O último dia com movimento é fato;
  // "ontem" é suposição — a mesma troca que o parágrafo acima já fez.
  // E "MOVIMENTO" E DO BANCO (dono, 26/10/2026: "tem que sempre considerar o ultimo dia
  // movimentado"): o Saipos lanca no domingo (TEF de 25/10) e a linha do placar sem OFX
  // abria a AV e o SB num dia com banco zerado.
  const ultimoComMov = [...new Set(placar.filter(r => r.tem_ofx).map(r => r.data))]
    .filter(d => d && d <= ontem).sort().pop();
  const diaAlvo = CONCB_DIA_ESCOLHIDO || comTrabalho[0] || pendentes[0]
    || ultimoComMov || ontem;
  const dias = [diaAlvo];
  const umDiaSo = true;
  const diasNavega = [...new Set(comTrabalho.concat([diaAlvo])
    .filter(d => d && d <= ontem))].sort();

  const contas = {};
  placar.forEach(r => {
    const c = contas[r.conta] || (contas[r.conta] = { ontemMov: 0, gapEnt: 0, gapSai: 0,
      entrou: 0, saiu: 0, difEnt: 0, difSai: 0, temOntem: false, temOfx: false });
    if (dias.includes(r.data)) {
      c.temOntem = true;
      if (r.tem_ofx) c.temOfx = true;
      // O TOTAL QUE O BANCO MOVIMENTOU no dia — regra do dono, 19/08/2026: e o
      // numero que ela usa para bater cada conta contra o Saipos. A diferenca
      // nao mora aqui; mora nos quadros de baixo, linha a linha.
      c.entrou += n(r.banco_entrou);
      c.saiu += n(r.banco_saiu);
      c.ontemMov += Math.abs(n(r.banco_entrou)) + Math.abs(n(r.banco_saiu));
      c.gapEnt += n(r.falta_entrada);
      c.gapSai += n(r.falta_saida);
      // A DIFERENCA POR LADO (soma do banco - soma do Saipos no dia). O placar
      // sempre teve as duas colunas e a tela nao mostrava nenhuma — o dono
      // conferiu no extrato e cobrou (25/08/2026): "a diferenca de 4.742,47 nas
      // entradas o modulo nao esta me mostrando".
      c.difEnt += n(r.dif_dia_entrada);
      c.difSai += n(r.dif_dia_saida);
    }
  });
  Object.values(contas).forEach(c => {
    c.ontemGap = Math.max(Math.abs(c.gapEnt), Math.abs(c.gapSai));
  });

  const abertas = pend.filter(p => p.classe === 'ABERTA' && n(p.dias) >= CONCB_TOLERANCIA_DIAS);
  const ruido = pend.filter(p => p.classe === 'AGREGACAO');
  const porConta = {};
  abertas.forEach(p => (porConta[p.conta] || (porConta[p.conta] = [])).push(p));

  // ORDEM FIXA DAS CONTAS (dono, 25/09/2026): por loja, a conta principal primeiro —
  // AV, FF AV, Santander, Participacoes, Ahu, SB, FF SB. Antes a grade agrupava por
  // status (nao fecharam / fecharam / sem movimento) e a conta mudava de lugar todo dia.
  const CONCB_ORDEM = ['ITAU AV', 'ITAU FF AV', 'SANTANDER', 'PARTICIPACOES',
                       'ITAU AHU', 'ITAU SB', 'ITAU FF SB'];
  const concbOrdem = (a, b) => {
    const ia = CONCB_ORDEM.indexOf(a), ib = CONCB_ORDEM.indexOf(b);
    return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib) || a.localeCompare(b);
  };
  const nomes = Object.keys(contas).sort(concbOrdem);
  const fecharam = nomes.filter(c => contas[c].temOntem && contas[c].ontemGap < CONCB_TOL_CENTAVOS);
  const naoFecharam = nomes.filter(c => contas[c].temOntem && contas[c].ontemGap >= CONCB_TOL_CENTAVOS);
  const semMov = nomes.filter(c => !contas[c].temOntem);

  // UMA LINHA POR CONTA, cinco colunas: status, conta, entradas, saídas, saldo.
  // Antes eram duas linhas por conta — a de cima com o texto do dia e a de baixo
  // com o saldo por extenso —, e o dono cortou: "está mostrando muita
  // informação". O que cada coluna responde é uma pergunta só, e o detalhe longo
  // virou `title` (aparece ao passar o mouse) em vez de ocupar a tela.
  const saldoNaoBate = new Set();
  const contaParcial = new Set();   // 07/11/2026: extrato parcial no dia — não conta como "não fechou"
  const cartao = (conta) => {
    const c = contas[conta];
    const fechou = c.temOntem && c.ontemGap < CONCB_TOL_CENTAVOS;
    // Medido em 19/08: o Organizze leva de 2 a 5 dias para ficar completo (4 de
    // 40 linhas no dia seguinte, na ITAU AV). Sem o OFX de ontem, a diferenca
    // que aparece e atraso da FONTE, nao lancamento faltando — e cobrar por isso
    // ensina todo mundo a ignorar a lista.
    const semExtrato = c.temOntem && !c.temOfx && !fechou;
    // O TRAVESSAO AQUI E PROVISORIO: conta que nao movimentou no dia nao tem o que
    // fechar, mas TEM saldo — e o saldo pode estar conferido. Mais abaixo, quando a
    // coluna do saldo souber a resposta, esta marca e promovida a ✓ ou ✗. Sem isso a
    // linha se contradizia: travessao cinza no status e "Saipos igual" em verde no
    // saldo, na mesma linha (dono, 09/09/2026, olhando PARTICIPACOES e SANTANDER).
    let cor = !c.temOntem ? '#a5a49a' : fechou ? '#2e7d32' : semExtrato ? '#b8860b' : '#c8102e';
    let marca = !c.temOntem ? '—' : fechou ? '✓' : semExtrato ? '?' : '✗';
    // total do banco em cima; embaixo, quando os totais do dia nao batem, a
    // diferenca contra o Saipos daquele lado — e o numero que diz ONDE procurar
    // (entrada ou saida) antes de abrir os quadros linha a linha.
    const lado = (v, cor, dif) => {
      if (!c.temOntem || Math.abs(v) < CONCB_TOL_CENTAVOS)
        return '<span style="opacity:.4">—</span>';
      const difTxt = Math.abs(dif || 0) >= CONCB_TOL_CENTAVOS
        ? '<div style="font-size:11px;color:#c8102e">Saipos difere ' + rs(Math.abs(dif)) + '</div>'
        : '';
      return '<span style="color:' + cor + '">' + rs(Math.abs(v)) + '</span>' + difTxt;
    };

    // A COLUNA SALDO MOSTRA O SALDO DO BANCO NO DIA — regra do dono, 19/08/2026:
    // "o objetivo é ela ter tudo o que precisa do banco na tela do painel, sem
    // precisar abrir o extrato". Antes mostrava a DIFERENÇA, que serve para mim
    // e não para quem concilia.
    //
    // O Itaú não emite saldo todo dia (em agosto deu 14, 17 e 19, e a
    // conciliação é de 18), então o valor é calculado: último saldo declarado
    // mais o que moveu depois. Só é confiável porque o extrato é íntegro —
    // conferido no centavo nas 5 contas.
    // O SALDO TEM QUE SER O DO DIA QUE ESTA NA TELA. Ele vinha de
    // vw_fin_conciliacao_saldo, que e sempre ancorada em ONTEM — entao quem
    // navegava para o dia 19 via o saldo do dia 20 e nada batia. O dono conferiu
    // contra o extrato e cobrou (21/08/2026). Agora vem de
    // vw_fin_conciliacao_dia_saldo, que tem os dois lados dia a dia; o resumo de
    // ontem so entra quando o dia escolhido E ontem, porque so ali ele tem os
    // termos da decomposicao (fila, outra data, varredura).
    // Conta que nao movimentou no dia nao tem linha — mas TEM saldo: e o do
    // ultimo dia em que mexeu. Mostrar travessao ali sugere que falta dado, e nao
    // falta: a FF SAO BRAZ ficou parada em 19/08 e o saldo dela era 295,63.
    const sdDia = (cru.diaSaldo || [])
      .filter(x => x.conta === conta && x.data <= diaAlvo)
      .sort((a, b) => a.data < b.data ? 1 : -1)[0];
    const sdOntem = saldoConf.find(x => x.conta === conta);
    const sd = diaAlvo === ontem ? sdOntem
      : (sdDia ? { conta, data_saldo: sdDia.data, saldo_banco: sdDia.saldo_banco,
                   saldo_saipos: sdDia.saldo_saipos, diferenca: sdDia.diferenca,
                   explicado_pela_fila: null, lancado_em_outra_data: null,
                   varredura_do_banco: null, sem_explicacao: null,
                   extrato_ate: sdOntem && sdOntem.extrato_ate,
                   movimenta_diariamente: sdOntem && sdOntem.movimenta_diariamente,
                   ultimo_movimento: sdOntem && sdOntem.ultimo_movimento } : null);
    // Um centavo de diferença é arredondamento de soma, não dinheiro.
    const TOL_SALDO = 0.015;
    let saldoTxt = '<span style="opacity:.4">—</span>', saldoTitulo = '';
    if (sd) {
      // CONTA QUE NAO MOVIMENTA TODO DIA NAO ESTA "PARADA" (dono, 02/09/2026): a
      // PARTICIPACOES mexe uma vez por mes e aparecia como "extrato parado em
      // 26/08" — um alerta de falta de dado onde nao faltava dado. A view diz se
      // a conta movimenta diariamente (>= 15 dias com movimento nos ultimos 30;
      // medido: AV/AHU/FF AV/SB 21-23, FF SB 12, SANTANDER 8, PARTICIPACOES 1).
      // Quem nao movimenta mostra o ULTIMO DIA MOVIMENTADO, em tom neutro, e
      // segue com a conferencia de saldo normal.
      const diaria = sd.movimenta_diariamente !== false;
      const semExtratoDe = !sd.extrato_ate ? 'nunca'
        : (diaria && Math.round((new Date(ontem) - new Date(sd.extrato_ate)) / 86400000) > 2
            ? ddmm(sd.extrato_ate) : null);
      const ultimoMov = (!diaria && sd.ultimo_movimento) ? ddmm(sd.ultimo_movimento) : null;
      const dif = n(sd.diferenca);
      saldoTitulo = 'banco ' + rs(sd.saldo_banco) + ' · Saipos ' + rs(sd.saldo_saipos)
        + ' · diferença ' + rs(dif) + ' · na fila ' + rs(sd.explicado_pela_fila)
        + ' · outra data ' + rs(sd.lancado_em_outra_data)
        // varredura = aplicacao/resgate automatico que a casa nao lanca (Contamax)
        + (Math.abs(n(sd.varredura_do_banco)) >= TOL_SALDO
            ? ' · varredura do banco ' + rs(sd.varredura_do_banco) : '')
        + ' · sem explicação ' + rs(sd.sem_explicacao);
      // 07/11/2026 (auditoria lote 1, dinheiro-18): extrato do dia baixado no meio do dia (parcial) não
      // é diferença — falta o resto do dia no banco. A coluna diz isso e não pinta ✗.
      const parcialDia = ((cru.parcial || []).find(p => p.conta === conta) || {}).ultimo_extrato_parcial_dia;
      if (semExtratoDe) {
        // Extrato parado não é diferença: é falta de dado, e não se resolve
        // conciliando. Mostrar o saldo velho como se fosse o de ontem mente.
        saldoTxt = '<span style="color:#b8860b">extrato parado'
          + (semExtratoDe === 'nunca' ? '' : ' em ' + semExtratoDe) + '</span>';
      } else if (parcialDia && parcialDia === diaAlvo) {
        saldoTxt = '<span style="color:var(--farol-perto)">extrato parcial de ' + ddmm(parcialDia) + '</span>';
        if (marca === '✗' || !c.temOntem) { marca = '?'; cor = 'var(--farol-perto)'; }
        contaParcial.add(conta);
      } else {
        // O QUE VALE É O QUE SOBRA, não a diferença. Diferença explicada por data
        // ou pela varredura do banco não é trabalho de ninguém — some sozinha. A
        // tela dizia "diferença toda explicada" e o dono cortou: com tudo
        // conciliado, aquilo era aviso de nada. Aviso que não pede ação treina a
        // pessoa a ignorar a coluna inteira, e junto vai o aviso que importa.
        const bateu = Math.abs(dif) < TOL_SALDO;
        // Conta parada no dia: o status vem do SALDO, que é a única pergunta que
        // ela ainda responde. Verde quando banco e Saipos dão o mesmo número.
        if (!c.temOntem) {
          marca = bateu ? '✓' : '✗';
          cor = bateu ? '#2e7d32' : '#c8102e';
        }
        // A decomposição (fila, outra data, varredura) só existe para ONTEM: ela
        // depende do resíduo acumulado que o comparador grava. Em dia anterior eu
        // tenho só os dois saldos — então a diferença crua vira o alerta, sem
        // fingir que está explicada. Dizer "conferido" num dia que não fecha é o
        // pior erro possível nesta coluna.
        const temDecomposicao = sd.sem_explicacao !== null && sd.sem_explicacao !== undefined;
        const sobra = temDecomposicao ? n(sd.sem_explicacao) : dif;
        // O SALDO BATER É A VERDADE FINAL. Se banco e Saipos dão o mesmo número,
        // acabou — não importa que a decomposição em termos deixe um resto (ela
        // é aproximada por natureza; a PARTICIPAÇÕES tinha saldo igual e R$ 0,55
        // de resto, e a tela pintava de vermelho uma conta fechada).
        saldoTxt = (ultimoMov ? '<span style="opacity:.7">último movimento ' + ultimoMov + '</span> · ' : '')
          + '<b>' + rs(sd.saldo_banco) + '</b> · '
          + (bateu ? '<span style="color:#2e7d32">Saipos igual</span>'
             : Math.abs(sobra) >= TOL_SALDO
               ? '<span style="color:#c8102e">Saipos ' + rs(sd.saldo_saipos)
                 + ', R$ ' + rs(Math.abs(sobra))
                 + (temDecomposicao ? ' sem explicação' : ' de diferença') + '</span>'
               : '<span style="color:#2e7d32">conferido</span>');
        // ✓ SO COM O SALDO BATENDO (25/09/2026): a marca vinha so da fila do banco,
        // e a ITAU AV aparecia verde com o Saipos R$ 12.400 acima — a linha que
        // faltava estava marcada como conciliada e a que sobrava era do Saipos.
        if (!bateu && Math.abs(sobra) >= TOL_SALDO) {
          marca = '✗'; cor = '#c8102e'; saldoNaoBate.add(conta);
        }
      }
    }
    const td = 'style="text-align:left;font-size:12px"';
    // A linha da conta leva aos quadros dela la embaixo (12/09/2026): quem ve o
    // ✗ quer olhar as linhas daquela conta, e ate aqui precisava rolar a tela
    // procurando o nome. So fica clicavel quando existe bloco para a conta —
    // clique que nao leva a lugar nenhum nao chega a ser oferecido.
    const irPara = (porConta[conta] || []).length
      ? ' class="concb-ir" data-conta="' + esc(conta)
        + '" title="ver as linhas desta conta" style="cursor:pointer"' : '';
    return '<tr' + irPara + '><td style="text-align:left;font-size:18px;color:' + cor + '">' + marca + '</td>'
      + '<td style="text-align:left"><b>' + esc(nomeConta(conta)) + '</b></td>'
      + '<td ' + td + '>' + lado(c.entrou, '#2e7d32', c.difEnt) + '</td>'
      + '<td ' + td + '>' + lado(c.saiu, '#c8102e', c.difSai) + '</td>'
      + '<td ' + td + ' title="' + esc(saldoTitulo) + '">' + saldoTxt + '</td></tr>';
  };

  const quando = umDiaSo ? (dias[0] === ontem ? 'ontem' : 'em ' + ddmm(dias[0]))
                         : 'nestes dias';
  // A CONTA DA DIFERENCA, por conta que nao fechou no dia. E a resposta do
  // dono em 25/08: "a ideia do modulo e voce me ACHAR essas diferencas". As
  // entradas sao a propria fila (banco tem, Saipos nao); as saidas tem DOIS
  // lados, e o segundo — lancado no Saipos sem debito no banco — nunca aparecia
  // na tela. Aqui os dois fecham no centavo com o numero do cabecalho.
  const blocoDiferenca = naoFecharam.map(conta => {
    const c = contas[conta];
    if (Math.abs(c.difEnt) < CONCB_TOL_CENTAVOS && Math.abs(c.difSai) < CONCB_TOL_CENTAVOS) return '';
    const filaDia = abertas.filter(p => p.conta === conta && dias.includes(p.data));
    const fe = filaDia.filter(p => n(p.valor) > 0).reduce((s, p) => s + n(p.valor), 0);
    const fs = filaDia.filter(p => n(p.valor) < 0).reduce((s, p) => s - n(p.valor), 0);
    const sres = (cru.sresiduo || []).filter(r => r.conta === conta && dias.includes(r.data));
    const srSai = sres.filter(r => n(r.valor) < 0);
    const srTot = srSai.reduce((s, r) => s - n(r.valor), 0);
    const linhaSr = srSai.map(r =>
      '<tr><td style="text-align:left">' + esc(r.descricao || '') + '</td>' +
      '<td style="text-align:left">' + esc(r.subtipo || '') + '</td>' +
      '<td style="text-align:right">' + rs(Math.abs(n(r.valor))) + '</td></tr>').join('');
    // Dono, 03/09/2026: o titulo "A conta da diferenca" e a frase de somas
    // sairam — "podemos manter somente as grades com as diferencas". Fica so a
    // tabela do lado que a fila nao mostra (Saipos sem banco), com o nome da
    // conta no cabecalho; a fila abaixo ja e a grade do outro lado.
    return (srSai.length
        ? '<div id="tabelaConcbSres' + esc(conta).replace(/\W/g, '') + '" style="overflow-x:auto"><table style="width:100%">' +
          '<thead><tr><th style="text-align:left">' + esc(nomeConta(conta)) + ' — lançado no Saipos, sem débito no banco no dia</th>' +
          '<th style="text-align:left">Categoria</th><th style="text-align:right">Valor</th></tr></thead>' +
          '<tbody>' + linhaSr +
          '<tr><td style="text-align:left"><b>Total</b></td><td></td><td style="text-align:right"><b>' +
          rs(srTot) + '</b></td></tr></tbody></table></div>' +
          '<div class="caption-label" style="text-align:left">Lançado adiantado, valor divergente, ' +
          'ou movimento que nunca saiu do banco. Não é para lançar de novo — é para conferir se o ' +
          'lançamento está certo.</div>'
        : '');
  }).join('');

  // A grade roda ANTES do resumo: e ela que descobre as contas com o saldo fora
  // (saldoNaoBate) — sem isso o topo dizia "Tudo certo" com o saldo vermelho embaixo.
  const linhasGrade = nomes.map(cartao).join('');
  const ruins = [...new Set(naoFecharam.concat([...saldoNaoBate]))].filter(c => !contaParcial.has(c));
  const resumo = ruins.length
    ? '<b style="color:#c8102e">' + ruins.length
      + (ruins.length === 1 ? ' conta não fechou ' : ' contas não fecharam ')
      + quando + '.</b> Confira as linhas abaixo.'
    : contaParcial.size
      ? '<b style="color:var(--farol-perto)">Extrato parcial ' + quando + '.</b> O saldo fecha quando chegar o extrato do dia inteiro.'
    : '<b style="color:#2e7d32">Tudo certo ' + quando + '.</b> Nada a fazer nesta loja.';

  // O quadro "O QUE CORRIGIR NO SAIPOS" (25/09) saiu em 29/09 a pedido do dono:
  // era redundante com as tabelas de ensinar/conciliar abaixo, e confundia.

  // ---- o que conferir, uma conta de cada vez ----
  // Um estado, nao duas acoes. Antes eram dois botoes ("lancei" e "ja estava")
  // que separavam a INTENCAO de quem clica: informacao util para mim e trabalho
  // a mais para quem concilia. O dono trocou por um estado so (19/08/2026) — a
  // linha esta A CONCILIAR ate alguem dizer que conciliou.
  // Caixa de marcar, nao botao (dono, 19/08/2026): ela marca varias linhas e
  // manda conciliar de uma vez. Um botao por linha obriga a esperar o recarregar
  // da tela a cada clique — com 30 linhas isso e meia hora de espera somada.
  const botoes = (p) => '<input type="checkbox" class="concb-check"'
    + ' data-conta="' + String(p.conta).replace(/"/g, '&quot;')
    + '" data-fitid="' + String(p.fitid).replace(/"/g, '&quot;')
    + '" style="width:16px;height:16px;cursor:pointer">'
    // ENSINAR EM TODA LINHA — pedido do dono, 24/08/2026: "ele deve aparecer
    // dentro do painel ao lado de cada linha onde ainda tem duvida". Ate aqui o
    // botao so aparecia quando a linha vinha SEM descricao, que e o caso mais
    // raro: linha COM descricao tambem pode estar com a categoria errada, com a
    // forma de pagamento faltando ou pertencendo a um agrupamento que ninguem
    // cadastrou. Toda linha que chega nesta fila ainda tem duvida — e por isso
    // que ela esta aqui.
    + ('<br><button class="concb-ensina" data-conta="' + String(p.conta).replace(/"/g, '&quot;')
       + '" data-fitid="' + String(p.fitid).replace(/"/g, '&quot;')
       + '" data-nome="' + String(p.nome || '').replace(/"/g, '&quot;')
       + '" data-memo="' + String(p.memo || '').replace(/"/g, '&quot;')
       + '" style="font-size:10px;padding:2px 6px;margin-top:3px;cursor:pointer;border:none;'
       + 'background:transparent;color:inherit;opacity:.6;text-decoration:underline">'
       + 'ensinar</button>'
       // NAO SEI: a alternativa era deixar a linha na fila em silencio. Funciona
       // — ela volta amanha —, mas nao avisa ninguem, e quem concilia fica sem
       // saida quando nao acha o lancamento nem sabe cria-lo. Registrar a duvida
       // custa um clique e vira lista para o dono (pedido dele, 21/08/2026).
       + '<button class="concb-duvida" data-conta="' + String(p.conta).replace(/"/g, '&quot;')
       + '" data-fitid="' + String(p.fitid).replace(/"/g, '&quot;')
       + '" data-nome="' + String(p.nome || '').replace(/"/g, '&quot;')
       + '" data-memo="' + String(p.memo || '').replace(/"/g, '&quot;')
       + '" style="font-size:10px;padding:2px 6px;margin-top:3px;cursor:pointer;border:none;'
       + 'background:transparent;color:inherit;opacity:.6;text-decoration:underline">'
       + 'não sei</button>');

  // ENTRADA primeiro, SAIDA depois — ordem de trabalho definida pelo dono. Sao
  // duas tarefas diferentes: entrada e conferir recebimento, saida e conferir
  // pagamento, e misturar as duas na mesma lista faz a pessoa trocar de contexto
  // a cada linha.
  // Duas tarefas diferentes, nao uma (regra do dono, 19/08): quando a previsao ja
  // existe no Saipos so falta CONCILIAR — ninguem escreve nada. Quando nao existe,
  // e preciso LANCAR, que e decisao humana. Misturar as duas na mesma lista faz a
  // pessoa trocar de raciocinio linha a linha; e a segunda lista, a de lancar, e
  // onde mora a proxima automacao.
  // Quem decide o lado e a coluna `acao`, calculada no comparador. CONCILIAR
  // significa que a previsao foi achada com certeza e nao ha decisao a tomar.
  // Fica de fora quem tem pista "talvez" (valor exato com nome que nao bate: as
  // vezes acerta, como CASA DORICO x DORIGO MATERIAIS, as vezes erra feio, como
  // R$ 120 do motoboy KAWANN x "Itens Paes") e os BLOCOS de familia, que trazem
  // a receita do que digitar e nao um lancamento pronto para achar.
  const firme = (p) => p.acao === 'CONCILIAR';
  const tabela = (conta, lado, lista, temProv) => {
    lista = lista.filter(p => firme(p) === temProv);
    if (!lista.length) return '';
    const total = lista.reduce((s, x) => s + Math.abs(n(x.valor)), 0);
    // Entrada e verde, saida e vermelha, em TUDO: no titulo do bloco, na barra
    // lateral e no valor. Quem concilia trabalha os dois lados em sequencia e
    // precisa saber de relance em qual esta — o titulo sozinho perde a briga
    // quando a lista e longa e a pessoa rolou a tela.
    const ent = lado === 'ent';
    const cor = ent ? '#2e7d32' : '#c8102e';
    const idTabela = 'tabelaConcbFila' + conta.replace(/[^A-Za-z]/g, '') + lado
      + (temProv ? 'P' : 'S');
    return '<div style="margin:14px 0 6px;padding:6px 10px;border-left:4px solid ' + cor + ';'
      + 'background:' + (ent ? 'rgba(46,125,50,.07)' : 'rgba(200,16,46,.07)') + '">'
      + '<b style="color:' + cor + ';font-size:13px">'
      + (ent ? '↓ ENTRADAS' : '↑ SAÍDAS') + '</b>'
      + '<span style="font-size:12px;opacity:.85"> · '
      + (temProv ? '<b>só conciliar</b> — a previsão já está no Saipos'
                 : '<b>precisa lançar</b>')
      + ' · ' + lista.length + ' linha' + (lista.length === 1 ? '' : 's')
      + ' · R$ ' + rs(total) + '</span></div>' +
      // table-layout fixo com larguras declaradas: sem isso a coluna "Descrição"
      // estica com o texto mais longo e joga o botao para fora do quadro. Se
      // ainda nao couber, a barra horizontal aparece so nesta div.
      '<div style="overflow-x:auto" id="' + idTabela
      + '"><table style="table-layout:fixed;width:100%;min-width:560px">'
      + '<colgroup><col style="width:48px"><col style="width:86px"><col>'
      + '<col style="width:150px"><col style="width:118px"><col style="width:96px"></colgroup>'
      // O CSS do painel alinha celula de tabela a direita por padrao (serve para
      // as tabelas de numero). Aqui a maioria e texto, e texto colado na direita
      // com vao no meio fica ilegivel — so Data e Valor continuam alinhados.
      + '<thead><tr>' +
      '<th style="text-align:left">Data</th><th style="text-align:right">Valor</th>'
      + '<th style="text-align:left">Descrição</th>'
      + '<th style="text-align:left">O que é</th>'
      + '<th style="text-align:left">Categoria</th>'
      + '<th style="text-align:center"><input type="checkbox" class="concb-todos"'
      + ' data-alvo="' + idTabela + '" title="marcar todas"'
      + ' style="width:16px;height:16px;cursor:pointer"></th>' +
      '</tr></thead><tbody>' +
      // DESCRICAO e o historico a digitar, quando eu sei qual e; sem isso, mostro
      // quem esta do outro lado no banco — nunca um palpite escrito como se fosse
      // certeza. O QUE E diz de onde a linha veio; CATEGORIA e a do Saipos.
      lista.slice(0, 30).map(p =>
        '<tr><td style="font-size:12px;text-align:left">' + ddmm(p.data) + '</td>' +
        '<td style="text-align:right;color:' + cor + ';font-weight:600;white-space:nowrap">'
          + rs(p.valor) + '</td>' +
        '<td style="text-align:left;overflow:hidden;text-overflow:ellipsis">' + (p.descricao_lancar
            ? '<b>' + esc(p.descricao_lancar) + '</b>'
            : esc(p.nome || memoLimpo(p.memo))) + '</td>' +
        '<td style="text-align:left;opacity:.75;font-size:11px;overflow:hidden;text-overflow:ellipsis">'
          + (p.pista ? esc(p.pista) : '—') + '</td>' +
        '<td style="text-align:left;font-size:11px;overflow:hidden;text-overflow:ellipsis">'
          + (p.categoria ? esc(p.categoria) : '—') + '</td>' +
        '<td style="text-align:center">' + botoes(p) + '</td></tr>').join('') +
      '</tbody></table></div>' +
      '<div style="margin:4px 0 2px;text-align:right">'
      + '<button class="concb-conciliar" data-alvo="' + idTabela + '"'
      + ' style="font-size:11px;padding:4px 12px;cursor:pointer;border:1px solid ' + cor + ';'
      + 'background:transparent;color:' + cor + ';border-radius:4px">'
      + 'conciliar marcadas</button></div>' +
      (lista.length > 30 ? '<div class="contexto">Mostrando 30 de ' + lista.length + '.</div>' : '');
  };

  const blocosConferir = Object.entries(porConta).sort((a, b) => concbOrdem(a[0], b[0])).map(([conta, lista]) => {
    const ent = lista.filter(p => n(p.valor) > 0);
    const sai = lista.filter(p => n(p.valor) < 0);
    // O nome da conta e o titulo do bloco inteiro: tudo abaixo dele e daquela
    // conta ate o proximo. Antes era um rotulo do mesmo tamanho dos subtitulos e
    // se perdia no meio.
    return '<div id="concb-conta-' + encodeURIComponent(conta)
      + '" style="margin:22px 0 4px;font-size:16px;font-weight:700;'
      + 'letter-spacing:.3px;border-bottom:2px solid currentColor;padding-bottom:3px">'
      + esc(nomeConta(conta)) + '</div>' +
      tabela(conta, 'ent', ent, true) + tabela(conta, 'ent', ent, false) +
      tabela(conta, 'sai', sai, true) + tabela(conta, 'sai', sai, false);
  }).join('');

  // DUVIDA REGISTRADA E DUVIDA QUE APARECE. Quem concilia clicou "nao sei" e
  // seguiu em frente; se isso nao subir para a tela do dono, ela vira registro
  // que ninguem le — pior que nao ter botao nenhum.
  const duvidas = (cru.duvidas || []).filter(d => !d.conta
    || lojaFin() === 'REDE' || (placar.find(r => r.conta === d.conta) !== undefined));
  const blocoDuvidas = !duvidas.length ? '' :
    '<div style="margin:16px 0;padding:10px 14px;border-left:3px solid #b8860b;'
    + 'background:rgba(184,134,11,.09)">'
    + '<b style="color:#b8860b">' + duvidas.length
    + (duvidas.length === 1 ? ' linha esperando você' : ' linhas esperando você')
    + '</b><div style="font-size:12px;opacity:.85;margin-top:5px">'
    + duvidas.slice(0, 6).map(d => esc(d.quem || '?') + ' não soube o que fazer com '
        + '<b>' + esc(d.nome_banco || d.memo_banco || '(linha)') + '</b>'
        + (n(d.valor) ? ' (' + rs(d.valor) + ')' : '')
        + (d.texto && d.texto !== 'sem observação' ? ' — “' + esc(d.texto) + '”' : ''))
      .join('<br>')
    + (duvidas.length > 6 ? '<br>… e mais ' + (duvidas.length - 6) : '')
    + '</div></div>';

  const trava = naoConf.length
    ? '<div class="section-label" style="color:#c8102e">Marcado como lançado, mas ainda não apareceu</div>' +
      '<div class="contexto">Provavelmente foi lançado com valor ou data diferente do extrato. ' +
      'Se a marcação foi engano, <b>desfazer</b> devolve a linha para a fila de conciliação.</div>' +
      '<div id="tabelaConcbTrava"><table><thead><tr><th>Dia</th><th>Conta</th><th>Valor</th>' +
      '<th>O que o banco diz</th><th>Quem marcou</th><th></th></tr></thead><tbody>' +
      naoConf.map(x => '<tr><td>' + ddmm(x.data) + '</td><td>' + esc(nomeConta(x.conta)) + '</td>' +
        '<td style="text-align:right">' + rs(x.valor) + '</td><td>' + (x.memo || '').slice(0, 44) + '</td>' +
        '<td>' + (x.quem || '') + '</td>' +
        // ESTE e o unico lugar da tela onde uma marcacao errada reaparece: sem
        // desfazer aqui, a linha sai da fila para sempre e ninguem mais a ve.
        // O listener .concb-desmarca e a policy de DELETE ja existiam.
        '<td><button class="concb-desmarca" data-conta="' + esc(x.conta) +
        '" data-fitid="' + esc(x.fitid) +
        '" style="font-size:10px;padding:2px 6px;cursor:pointer;border:none;' +
        'background:transparent;color:inherit;opacity:.6;text-decoration:underline">' +
        'desfazer</button></td></tr>').join('') + '</tbody></table></div>'
    : '';

  // ---- o resto, recolhido: quem quiser auditar abre ----
  // O "Histórico: quantos dias cada conta fechou" foi desligado em 01/09/2026
  // (dono) e apagado em 12/09: o Passo 6.5 ja diz no dia, com conta e valor, e a
  // fila mostra o que falta. `saldoDia` continua sendo carregado e nao e mais
  // usado aqui — se ninguem mais precisar dele, a consulta tambem pode cair.
  const detalhe =
    (ruido.length
      ? '<details style="margin-top:8px"><summary style="cursor:pointer;font-weight:600">' +
        ruido.length + ' linhas que o sistema já explicou sozinho</summary>' +
        '<div class="contexto">Repasse de maquininha e pagamento em lote: o banco lista várias linhas ' +
        'e o Saipos lança uma só. Não é trabalho.</div></details>'
      : '');

  // Em 12/09/2026 sairam daqui dois blocos que ja estavam desligados por decisao
  // do dono em 01/09. "O que ja esta maduro para automacao" (24/08): o robo hoje
  // lanca tudo que tem regra, e o que falta aparece na fila, na linha, com o
  // botao de ensinar. E o banner do aviso da rotina (28/08): "ninguem para pra
  // ler esse texto nesse formato" — o passo a passo vive dentro dos blocos da
  // tela. O aviso continua sendo gravado em `fin_conciliacao_aviso`; `cru.matur`
  // e `cru.avisos` seguem carregados e sem uso — podem cair da consulta depois.

  alvo.innerHTML = seletorLojaFin() + plcCabecalhoQuebra('concbanco') +
    '<div class="section-label" style="border-top:none;margin-top:0;padding-top:0;' +
      'display:flex;align-items:center;gap:12px">' +
      '<span>Conciliação de ' + ddmm(diaAlvo)
        + (diaAlvo === ontem ? ' (ontem)' : '') + ' — ' + nomeLojaFin() + '</span>' +
      // Setas para andar entre os dias. A ordem importa — fecha o 19 antes de ir
      // ao 20 —, mas quem concilia às vezes precisa olhar o dia seguinte para
      // entender o de hoje, então navegar é livre e a ordem é orientação.
      (diasNavega.length > 1
        ? '<span style="font-size:12px;font-weight:normal;opacity:.85">'
          + diasNavega.map(d =>
              '<button class="concb-dia" data-dia="' + d + '" style="font-size:11px;'
              + 'padding:2px 8px;margin-right:3px;cursor:pointer;border-radius:4px;'
              + 'border:1px solid ' + (d === diaAlvo ? '#c8102e' : '#8a897e') + ';'
              + 'background:transparent;color:' + (d === diaAlvo ? '#c8102e' : 'inherit')
              + '">' + ddmm(d) + '</button>').join('')
          + (diasNavega.length > 1
              ? '<span style="opacity:.7">· ' + diasNavega.length + ' dias para conciliar</span>'
              : '') + '</span>'
        : '') +
      // Atualizar RELE o banco. Nao roda o comparador nem importa o Saipos —
      // isso e a rotina das 08:44. Serve para tirar da tela o que ja foi
      // conciliado e ver o que sobrou, sem recarregar a pagina inteira.
      '<button id="concbAtualizar" style="font-size:11px;padding:3px 10px;cursor:pointer;' +
      'border:1px solid #8a897e;background:transparent;color:inherit;border-radius:4px;' +
      'font-weight:normal">atualizar</button>' +
      '<button id="concbRecado" style="font-size:11px;padding:3px 10px;cursor:pointer;' +
      'border:1px solid #8a897e;background:transparent;color:inherit;border-radius:4px;' +
      'font-weight:normal">mandar uma regra</button>' +
      // Enviar o OFX pela tela. O painel nao grava em disco: ele manda o TEXTO do
      // arquivo para o banco e a rotina daqui o escreve na pasta do Drive, no
      // mesmo lugar em que ela salvaria a mao. Um so caminho de importacao.
      '<input type="file" id="concbArquivo" accept=".ofx" multiple style="display:none">' +
      '<button id="concbEnviarOfx" style="font-size:11px;padding:3px 10px;cursor:pointer;' +
      'border:1px solid #8a897e;background:transparent;color:inherit;border-radius:4px;' +
      'font-weight:normal">enviar extrato (OFX)</button></div>' +

    '<div class="contexto">' + resumo + '</div>' + blocoDuvidas +
    '<div id="tabelaConcbOntem"><table style="width:100%">' +
      '<colgroup><col style="width:34px"><col style="width:130px"><col style="width:110px">' +
      '<col style="width:110px"><col></colgroup>' +
      '<thead><tr>' +
      '<th style="text-align:left"></th><th style="text-align:left">Conta</th>' +
      '<th style="text-align:left">Entradas</th><th style="text-align:left">Saídas</th>' +
      '<th style="text-align:left">Saldo no banco · no Saipos</th></tr></thead><tbody>' +
      linhasGrade +
    '</tbody></table></div>' +
    blocoDiferenca +
    trava +
    (blocosConferir
      ? '<div class="section-label">O que conferir no Saipos</div>' +
        '<div class="contexto">' + (quem ? 'Você está como <b>' + quem + '</b>. ' : '') +
        'Marque o que você já lançou ou achou no Saipos e clique <b>conciliar marcadas</b> — ' +
        '<b>comece pelas entradas, depois as saídas</b>. Toda linha tem um <b>ensinar</b>: ' +
        'escreva como ela se chama no Saipos e da próxima vez ela vem pronta.</div>' +
        blocosConferir
      : '') +
    detalhe;

  alvo.querySelectorAll('.concb-dia').forEach(b => b.addEventListener('click', () => {
    CONCB_DIA_ESCOLHIDO = b.dataset.dia;
    renderConcbanco();
  }));
  const btAtu = document.getElementById('concbAtualizar');
  if (btAtu) btAtu.addEventListener('click', () => concbRodarComparador(btAtu));
  alvo.querySelectorAll('.concb-ensina').forEach(b => b.addEventListener('click', () =>
    concbEnsinar(b.dataset)));
  alvo.querySelectorAll('.concb-duvida').forEach(b => b.addEventListener('click', () =>
    concbDuvida(b.dataset)));
  const btRec = document.getElementById('concbRecado');
  if (btRec) btRec.addEventListener('click', () => concbRecado());
  const btOfx = document.getElementById('concbEnviarOfx');
  const inpOfx = document.getElementById('concbArquivo');
  if (btOfx && inpOfx) {
    btOfx.addEventListener('click', () => inpOfx.click());
    inpOfx.addEventListener('change', () => concbEnviarOfx(inpOfx, btOfx));
  }
  alvo.querySelectorAll('.concb-todos').forEach(cb => cb.addEventListener('change', () => {
    const tab = document.getElementById(cb.dataset.alvo);
    if (tab) tab.querySelectorAll('.concb-check').forEach(x => { x.checked = cb.checked; });
  }));
  alvo.querySelectorAll('.concb-conciliar').forEach(b => b.addEventListener('click', () =>
    concbConciliarMarcadas(b)));
  alvo.querySelectorAll('.concb-desmarca').forEach(b => b.addEventListener('click', () =>
    concbDesmarcar(b.dataset.conta, b.dataset.fitid)));
  alvo.querySelectorAll('.concb-ir').forEach(tr => tr.addEventListener('click', () => {
    const bloco = document.getElementById('concb-conta-' + encodeURIComponent(tr.dataset.conta));
    if (bloco) bloco.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }));
}

// ------------------------------------------------------------------
// MODULO EVOLUCAO DE VENDAS (12/09/2026)
//
// Nasceu das duas notas que o dono deixou ao decidir a revisao dos modulos:
//   "um modulo que mostra resumidamente o lucro por turno e canal de determinado
//    periodo, mas que esteja conectado com a base viva"
//   "sinto falta de uma dash com indicadores de evolucao de venda e sua quebras
//    por loja periodo canal e itens"
// As duas paginas que ele aposentou no mesmo dia (dre-turno.html e
// lucratividade-filiais.html) eram tentativas disso, congeladas em julho.
//
// Fonte: vw_venda_evolucao (dia x loja x canal x faixa de horario), do PDV do
// Saipos. A FAIXA vem de `hora_venda` — decisao de 20/08/2026, porque no salao a
// coluna `turno` do Saipos nao bate com a hora. Nunca usar `hora_origem`: a
// Goomer entrega ao Saipos 6h atrasada.
//
// O filtro de unidade do topo vale aqui. O de marca nao: a fonte tem canal, nao
// marca. A janela e propria do modulo, porque evolucao pede periodo longo e as
// janelas do cabecalho vao no maximo a 4 semanas.
// ------------------------------------------------------------------
let EVOL = null;
let EVOL_LIDO_EM = 0;   // quando o EVOL foi lido (para reler se a carga da manha chegou depois)

// 07/11/2026 (auditoria dos numeros, lote 1 — resultado-20): "ate ontem" so com o dia COMPLETO.
// O dia D so fecha na carga da manha de D+1: o Saipos no resumo-manha (06:30) e o iFood na
// importacao das 09:00. Antes disso as telas comparavam um "ontem" pela metade e a seta mudava de
// lado (sab 07/11 03:13: "caiu 10,7%" onde o dia inteiro dava "subiu 3,1%"). O ultimo dia completo
// = o dia em que a carga terminou, menos 1. Sem ler a carga, vale o relogio (07:00 e 10:00).
let CARGA_DIA = null, CARGA_DIA_LIDO = 0;
async function cargaDiaLer() {
  if (CARGA_DIA && Date.now() - CARGA_DIA_LIDO < 10 * 60000) return CARGA_DIA;
  const diaSP = (t) => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(new Date(t));
  const ler = (rot) => consultarTudo('rotinas_execucao?select=fim&rotina=eq.' + rot + '&fim=not.is.null&order=fim.desc&limit=1')
    .then(r => (r.length ? r[0].fim : null)).catch(() => null);
  const [s, i] = await Promise.all([ler('resumo-manha'), ler('importacao-diaria-apis-tarefa')]);
  CARGA_DIA = { saipos: s ? fxSomaDias(diaSP(s), -1) : null, ifood: i ? fxSomaDias(diaSP(i), -1) : null,
                saiposFim: s ? new Date(s).getTime() : 0 };
  CARGA_DIA_LIDO = Date.now();
  return CARGA_DIA;
}
function cargaUltimoDia(fonte) {
  const ontem = fxSomaDias(trHoje(), -1);
  const lido = CARGA_DIA && CARGA_DIA[fonte];
  if (lido) return lido < ontem ? lido : ontem;
  const h = Number(new Intl.DateTimeFormat('en-GB', { timeZone: 'America/Sao_Paulo', hour: '2-digit', hourCycle: 'h23' }).format(new Date()));
  return h < (fonte === 'ifood' ? 10 : 7) ? fxSomaDias(ontem, -1) : ontem;
}
// o EVOL lido antes da carga da manha tem o "ontem" pela metade: rele
function evolVelho() { return EVOL !== null && CARGA_DIA && CARGA_DIA.saiposFim > EVOL_LIDO_EM; }

// 07/11/2026 (auditoria dos numeros, lote 1 — resultado-21; regra §C3): loja fechada nao entra em
// comparacao. dim_unidade_dia diz, por unidade e dia, se a loja abriu (folga do Ahu, terca do Sao Braz,
// feriado). Sem a leitura, conta como aberta (a tela fica como era, nao esconde venda).
let ABERTO_DIA = null;
async function abertoDiaLer() {
  if (ABERTO_DIA) return ABERTO_DIA;
  try {
    const r = await consultarTudo('dim_unidade_dia?select=unidade,dia,aberto&dia=gte.' + fxSomaDias(trHoje(), -90));
    const m = {};
    r.forEach(x => { (m[x.dia] = m[x.dia] || {})[x.unidade] = x.aberto; });
    ABERTO_DIA = m;
  } catch (e) { ABERTO_DIA = {}; }
  return ABERTO_DIA;
}
function lojaAbriu(u, dia) { const d = ABERTO_DIA && ABERTO_DIA[dia]; return !d || d[u] !== false; }

// ---- QUEBRA POR ITEM (12/09/2026) ----
// Segunda metade do pedido do dono ("...e sua quebras por loja periodo canal e itens").
// Fonte: vw_venda_item_semana. Carrega SOB DEMANDA e SO A JANELA — por dia seriam 16 mil
// linhas em 8 semanas e 74 mil no ano; por semana sao 5,6 mil e 24 mil, e o servidor ja
// devolve so o recorte. Por isso este bloco tem carregamento proprio, separado do resto.
// ESTADO DE FILTRO DA TELA (12/09/2026) — o que transforma um relatorio em dashboard:
// clicar numa barra filtra a tela inteira, e nao so a tabela de baixo. A unidade NAO
// mora aqui de proposito: ela ja e' o filtro do topo, e dois controles para a mesma
// coisa e' o jeito mais rapido de ninguem confiar em nenhum dos dois.
// Regra do cross-filter: a dimensao que voce filtrou continua mostrando TODAS as suas
// categorias (senao nao da para trocar de escolha); as outras dimensoes sim se filtram.
// NOME DE EXIBICAO DO CANAL (decisao do dono, 12/08/2026): o canal chega do Saipos como
// "VNDX TECNOLOGIA" (o fornecedor do totem de autoatendimento), mas na tela e' TOTEM. So
// o ROTULO muda — dado, chave e filtro continuam crus. Virou global em 12/09/2026: a
// Visao consolidada ja traduzia e a Evolucao de vendas nao, e o mesmo canal aparecia com
// dois nomes em duas telas do mesmo painel.
const NOME_CANAL = { 'VNDX TECNOLOGIA': 'TOTEM' };

const nomeCanal = (c) => NOME_CANAL[c] || c;

let EVOL_F = { canal: null, faixa: null, item: null };

function evolFiltrar(tipo, valor) {
  EVOL_F[tipo] = (EVOL_F[tipo] === valor) ? null : valor;   // clicar de novo solta
  renderModuloEvolucao();
}

function evolLimparFiltros() { EVOL_F = { canal: null, faixa: null, item: null }; renderModuloEvolucao(); }

// a matriz canal x faixa e' o mapa: clicar numa celula fixa as duas dimensoes juntas
function evolMatriz(canal, faixa) {
  const jaEra = EVOL_F.canal === canal && EVOL_F.faixa === faixa;
  EVOL_F.canal = jaEra ? null : canal;
  EVOL_F.faixa = jaEra ? null : faixa;
  renderModuloEvolucao();
}

// O ITEM como filtro fecha o cruzamento que o dono pediu ("cruzar canal, item,
// periodo"). O nome vai por INDICE, nunca como string dentro do onclick: nome de
// produto tem aspas, & e parenteses, e a fuga de um literal JS dentro de atributo
// HTML e' exatamente o lugar onde isso quebra em silencio.
let EVOL_LISTA_ITENS = [];

function evolItemFiltrar(i) {
  const nome = EVOL_LISTA_ITENS[i];
  if (!nome) return;
  EVOL_F.item = (EVOL_F.item === nome) ? null : nome;
  renderModuloEvolucao();
}

function evolLimparItem() { EVOL_F.item = null; renderModuloEvolucao(); }

const EVOL_ORDEM_IT = 'semana,unidade,canal,item,faixa,nome_base,situacao';   // a chave única de mv_venda_item_semana

let EVOL_ITENS = null;        // { chave, carregando, atual: [], anterior: [] }

let EVOL_ITEM_N = 10;         // 10 = so os quadros do topo e do fundo; 9999 = lista inteira

function evolItemTodos() { EVOL_ITEM_N = EVOL_ITEM_N >= 9999 ? 10 : 9999; renderModuloEvolucao(); }

async function evolCarregarItens(semIni, semFim, antIni, antFim) {
  const chave = [semIni, semFim, antIni, antFim].join('|');
  if (EVOL_ITENS && EVOL_ITENS.chave === chave) return;
  EVOL_ITENS = { chave, carregando: true, atual: [], anterior: [] };
  const campos = 'semana,unidade,canal,faixa,item,nome_base,situacao,fora_da_base,qtd,receita,pedidos';
  // 22/10/2026: o item aparece pelo NOME DA BASE (regra do dono: só a base no painel). Linha que ainda não tem nome na
  // base (item antigo, parte de combo com nome do iFood) fica com o nome que veio, até a regra de exibição sair.
  const daBase = (L) => L.map((r) => ({ ...r, item: r.nome_base || r.item }));
  try {
    const [a, b] = await Promise.all([
      // ORDEM ÚNICA na paginação (22/10/2026): sem ela o PostgREST devolve as páginas de 1.000 em ordem instável e linha
      // some ou repete — os blocos "parte de combo" e "fora do cardápio" deram R$ 426 onde o banco tem R$ 846
      consultarTudo(`vw_venda_item_semana?select=${campos}&semana=gte.${semIni}&semana=lte.${semFim}&order=${EVOL_ORDEM_IT}`),
      antIni ? consultarTudo(`vw_venda_item_semana?select=${campos}&semana=gte.${antIni}&semana=lte.${antFim}&order=${EVOL_ORDEM_IT}`) : Promise.resolve([]),
    ]);
    EVOL_ITENS = { chave, carregando: false, atual: daBase(a), anterior: daBase(b) };
  } catch (e) {
    EVOL_ITENS = { chave, carregando: false, erro: String(e && e.message || e), atual: [], anterior: [] };
  }
  renderModuloEvolucao();
}

// [dias, grao, rotulo] — dias 0 = tudo o que existe
// [dias, grao, rotulo] — dias 0 = tudo o que existe.
// As duas primeiras sao de grao DIA e NAO encostam na segunda-feira de proposito: 7 e 28
// sao multiplos de 7, entao o periodo anterior cai no mesmo dia da semana e a comparacao
// dia a dia compara sabado com sabado. Encostar na segunda quebraria esse alinhamento.
const EVOL_JANELAS = [[7, 'dia', '7 dias'], [28, 'dia', '4 semanas'], [56, 'semana', '8 semanas'], [182, 'mes', '6 meses'], [0, 'mes', 'Ano todo']];

let EVOL_JANELA = 2;   // abre em 8 semanas

let EVOL_MEDIDA = 'total';   // 'total' | 'pedidos' | 'ticket'

async function entrarEvolucao() {
  const alvo = document.getElementById('view-evolucao');
  if (!alvo) return;
  await Promise.all([cargaDiaLer(), abertoDiaLer()]);
  if (EVOL === null || evolVelho()) {
    alvo.innerHTML = '<div class="contexto">Carregando a evolução das vendas...</div>';
    EVOL = await consultarTudo('vw_venda_evolucao?select=data,unidade,canal,faixa,pedidos,total,canceladas,total_cancelado&order=data');
    EVOL_LIDO_EM = Date.now();
  }
  renderModuloEvolucao();
}

function evolJanela(i) { EVOL_JANELA = i; renderModuloEvolucao(); }

function evolMedida(m) { EVOL_MEDIDA = m; renderModuloEvolucao(); }

// Rotulo do periodo do grao: a semana vira "seg 31/08", o mes vira "ago/26".
function evolChave(data, grao) {
  if (grao === 'dia') return data;
  if (grao === 'mes') return data.slice(0, 7);
  const d = new Date(data + 'T12:00:00');
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7));      // volta para a segunda
  return d.toISOString().slice(0, 10);
}

const EVOL_DIA_SEM = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb'];

function evolRotulo(chave, grao) {
  if (grao === 'mes') return MESES_ABREV[Number(chave.slice(5, 7)) - 1] + '/' + chave.slice(2, 4);
  const dm = chave.slice(8, 10) + '/' + chave.slice(5, 7);
  // no grao dia o dia da semana e a informacao que explica o tamanho da barra
  if (grao === 'dia') return EVOL_DIA_SEM[new Date(chave + 'T12:00:00').getDay()] + ' ' + dm;
  return dm;
}

function renderModuloEvolucao() {
  const alvo = document.getElementById('view-evolucao');
  if (!alvo || EVOL === null) return;
  if (!EVOL.length) { alvo.innerHTML = '<div class="contexto">Sem venda importada ainda.</div>'; return; }

  const [dias, graoJanela, rotJanela] = EVOL_JANELAS[EVOL_JANELA];
  // 07/11/2026 (auditoria resultado-20): a janela termina no ultimo dia COMPLETO da carga do Saipos
  const ultCompleto = cargaUltimoDia('saipos');
  const datasTodas = EVOL.map(r => r.data).sort();
  const datas = datasTodas.filter(d => d <= ultCompleto).length ? datasTodas.filter(d => d <= ultCompleto) : datasTodas;
  const maxData = datas[datas.length - 1], minData = datas[0];
  const recuar = (d, n) => { const x = new Date(d + 'T12:00:00'); x.setDate(x.getDate() - n); return x.toISOString().slice(0, 10); };
  // A janela ENCOSTA no comeco do grao: sem isso a primeira barra tambem nasce pela
  // metade (janela de 56 dias caindo numa quarta-feira) e o grafico mostra duas
  // barras curtas que nao sao queda. Semana volta para a segunda; mes, para o dia 1.
  const inicioDoGrao = (d) => {
    if (graoJanela === 'dia') return d;    // ver a nota em EVOL_JANELAS
    if (graoJanela === 'mes') return d.slice(0, 8) + '01';
    const x = new Date(d + 'T12:00:00');
    x.setDate(x.getDate() - ((x.getDay() + 6) % 7));
    return x.toISOString().slice(0, 10);
  };
  const iniCru = dias ? recuar(maxData, dias - 1) : minData;
  let ini = dias ? inicioDoGrao(iniCru) : minData;
  if (ini < minData) ini = minData;
  const tamanho = Math.round((new Date(maxData + 'T12:00:00') - new Date(ini + 'T12:00:00')) / 864e5) + 1;
  // periodo anterior do MESMO tamanho, colado — a mesma regra do resto do painel
  const antFim = recuar(ini, 1), antIni = dias ? recuar(antFim, tamanho - 1) : null;
  const temBase = antIni !== null && antIni >= minData;

  // A base do ITEM e' SEMANAL (vw_venda_item_semana), entao o recorte dele anda em
  // semanas fechadas, segunda a domingo. Estas quatro datas servem para carregar os
  // itens e, no modo item, para recortar a tela inteira.
  const segundaDe = (d) => { const x = new Date(d + 'T12:00:00'); x.setDate(x.getDate() - ((x.getDay() + 6) % 7)); return x.toISOString().slice(0, 10); };
  const semIni = segundaDe(ini), semFim = segundaDe(maxData);
  const antSemIni = temBase ? segundaDe(antIni) : null, antSemFim = temBase ? segundaDe(antFim) : null;
  // carrega os itens da janela (so a janela) e redesenha quando chegar
  evolCarregarItens(semIni, semFim, antSemIni, antSemFim);
  const itensProntos = !!(EVOL_ITENS && !EVOL_ITENS.carregando && !EVOL_ITENS.erro
    && EVOL_ITENS.chave === [semIni, semFim, antSemIni, antSemFim].join('|'));

  // ---------- MODO ITEM ----------
  // Com um item fixado a tela TROCA DE BASE: so vw_venda_item_semana sabe o que foi
  // vendido item a item. As linhas dela sao remoldadas no formato de vw_venda_evolucao
  // (data = segunda da semana, total = receita do item) e, com isso, cards, grafico,
  // canal, faixa, loja e matriz passam a falar do item sem mudar uma linha de calculo.
  // O preco sao duas ressalvas que a tela diz em voz alta: o grao vira SEMANA e a
  // receita e' BRUTA (item x preco, antes do desconto do pedido e sem taxa de servico).
  const ITEM = EVOL_F.item;
  if (ITEM && !itensProntos) {
    alvo.innerHTML = `<div class="section-label" style="border-top:none; margin-top:0; padding-top:0;">Evolução de vendas — ${ITEM}</div>
      <div class="contexto"${EVOL_ITENS && EVOL_ITENS.erro ? ' style="border-color:var(--farol-fora);"' : ''}>
        ${EVOL_ITENS && EVOL_ITENS.erro ? 'Não consegui carregar os itens: ' + EVOL_ITENS.erro : 'Carregando a venda deste item...'}
        <div style="margin-top:8px;"><button class="preset-btn" onclick="evolLimparFiltros()">voltar para a tela toda</button></div>
      </div>`;
    return;
  }
  const grao = ITEM ? 'semana' : graoJanela;
  const janIni = ITEM ? semIni : ini, janFim = ITEM ? semFim : maxData;
  const janAntIni = ITEM ? antSemIni : antIni, janAntFim = ITEM ? antSemFim : antFim;
  const comoEvol = (rows) => rows.filter(r => r.item === ITEM).map(r => ({
    data: r.semana, unidade: r.unidade, canal: r.canal, faixa: r.faixa,
    pedidos: Number(r.pedidos || 0), total: Number(r.receita || 0),
  }));

  const naJanela = (r, a, b) => r.data >= a && r.data <= b && (!activeUnidades.size || activeUnidades.has(r.unidade));
  // 07/11/2026 (auditoria resultado-21, §C3): nas janelas de dias inteiros de semana (7 dias, 4 semanas),
  // a comparacao so usa os dias em que a loja abriu NOS DOIS periodos (o mesmo dia da semana).
  // Nas janelas longas a folga se dilui e o dia da semana nao casa: ficam como eram.
  // A venda mostrada (cards, grafico, quebras) e' a REAL; o pareamento so entra na variacao (atualPar x anterior).
  const parear = !ITEM && temBase && (dias === 7 || dias === 28);
  const parOk = (r, desloc) => !parear || (lojaAbriu(r.unidade, r.data) && lojaAbriu(r.unidade, fxSomaDias(r.data, desloc)));
  const foraPar = {}, foraParAnt = {};
  const atual = (ITEM ? comoEvol(EVOL_ITENS.atual) : EVOL).filter(r => naJanela(r, janIni, janFim));
  const atualPar = !parear ? atual : atual
    .filter(r => { if (parOk(r, -tamanho)) return true; const k = r.unidade + '|' + r.data; foraPar[k] = (foraPar[k] || 0) + Number(r.total || 0); return false; });
  const anterior = temBase ? (ITEM ? comoEvol(EVOL_ITENS.anterior) : EVOL).filter(r => naJanela(r, janAntIni, janAntFim))
    .filter(r => { if (parOk(r, tamanho)) return true; const k = r.unidade + '|' + r.data; foraParAnt[k] = (foraParAnt[k] || 0) + Number(r.total || 0); return false; }) : [];

  // `ignora` deixa a propria dimensao passar inteira — e o que mantem as outras
  // categorias clicaveis depois de escolher uma.
  const passaF = (r, ignora) => (ignora === 'canal' || !EVOL_F.canal || r.canal === EVOL_F.canal)
                             && (ignora === 'faixa' || !EVOL_F.faixa || r.faixa === EVOL_F.faixa);
  const atualF = atual.filter(r => passaF(r)), anteriorF = anterior.filter(r => passaF(r));
  const atualC = atual.filter(r => passaF(r, 'canal')), antC = anterior.filter(r => passaF(r, 'canal'));
  const atualX = atual.filter(r => passaF(r, 'faixa')), antX = anterior.filter(r => passaF(r, 'faixa'));
  const parF = atualPar.filter(r => passaF(r)), parC = atualPar.filter(r => passaF(r, 'canal')), parX = atualPar.filter(r => passaF(r, 'faixa'));

  const soma = (rows, campo) => rows.reduce((s, r) => s + Number(r[campo] || 0), 0);
  const tot = soma(atualF, 'total'), ped = soma(atualF, 'pedidos');
  // CANCELADOS (12/09/2026): era a unica coisa que a Visao consolidada tinha e esta tela
  // nao. No modo item nao existe — a base do item so tem o que foi vendido.
  const canc = ITEM ? 0 : soma(atualF, 'total_cancelado'), cancN = ITEM ? 0 : soma(atualF, 'canceladas');
  const cancPorCanal = {};
  if (!ITEM) atualF.forEach(r => { cancPorCanal[r.canal] = (cancPorCanal[r.canal] || 0) + Number(r.total_cancelado || 0); });
  const piorCanc = Object.entries(cancPorCanal).sort((a, b) => b[1] - a[1])[0];
  const totA = soma(anteriorF, 'total'), pedA = soma(anteriorF, 'pedidos');
  const tk = ped ? tot / ped : 0, tkA = pedA ? totA / pedA : 0;
  // base da variacao: o atual so com os dias pareados (igual ao atual quando nao pareia)
  const totP = soma(parF, 'total'), pedP = soma(parF, 'pedidos'), tkP = pedP ? totP / pedP : 0;
  const nDias = new Set(atualF.map(r => r.data)).size || 1;

  // palavra do fato separada do juizo — regra da casa
  const varTxt = (a, b, casas = 1) => {
    if (!temBase || !b) return '<span style="color:var(--tx-6);">sem base para comparar</span>';
    const v = (a - b) / Math.abs(b) * 100;
    const p = Math.abs(v).toFixed(casas).replace('.', ',');
    return Math.abs(v) < 0.05 ? 'ficou igual' : `${v > 0 ? 'subiu' : 'caiu'} ${p}%`;
  };

  const ddmm = (v) => v ? v.slice(8, 10) + '/' + v.slice(5, 7) : '—';
  const UN_ROT = { 'AGUA VERDE': 'Água Verde', 'AHU': 'Ahú', 'SÃO BRAZ': 'São Braz', 'BOQUEIRAO': 'Boqueirão' };
  const unsComDado = [...new Set(atual.map(r => r.unidade))].sort();

  // ---------- serie do grafico ----------
  const serie = {};
  atualF.forEach(r => {
    const k = evolChave(r.data, grao);
    const o = serie[k] || (serie[k] = { total: 0, pedidos: 0 });
    o.total += Number(r.total || 0); o.pedidos += Number(r.pedidos || 0);
  });
  // ITEM QUE PAROU DE VENDER PRECISA CAIR ATE ZERO, nao simplesmente sumir. A base do
  // item so tem linha na semana em que houve venda, entao sem este preenchimento um
  // produto descontinuado termina o grafico no ultimo pico — e queda vira "acabou o
  // periodo". Medido em 12/09: "2 BURGERS COM DESCONTO" some depois de 24/08.
  const maisSete = (d) => { const x = new Date(d + 'T12:00:00'); x.setDate(x.getDate() + 7); return x.toISOString().slice(0, 10); };
  if (ITEM) for (let d = janIni; d <= janFim; d = maisSete(d)) if (!serie[d]) serie[d] = { total: 0, pedidos: 0 };
  const chaves = Object.keys(serie).sort();
  const medidaDe = (o) => EVOL_MEDIDA === 'total' ? o.total : EVOL_MEDIDA === 'pedidos' ? o.pedidos : (o.pedidos ? o.total / o.pedidos : 0);
  const valores = chaves.map(k => medidaDe(serie[k]));

  // O PERIODO ANTERIOR ENTRA NO GRAFICO como linha tracejada por tras das barras —
  // mesma escala, alinhado POSICAO A POSICAO (1a semana com 1a semana, sabado com
  // sabado). E por isso que as janelas de grao dia sao multiplos de 7: sem isso a
  // linha compararia terca com domingo e o desenho mentiria.
  // Barras lado a lado foram descartadas (dobram o numero de marcas e o grafico de 9
  // pontos vira 18) e segundo eixo Y esta proibido no painel.
  const serieAnt = {};
  anteriorF.forEach(r => {
    const k = evolChave(r.data, grao);
    const o = serieAnt[k] || (serieAnt[k] = { total: 0, pedidos: 0 });
    o.total += Number(r.total || 0); o.pedidos += Number(r.pedidos || 0);
  });
  // No periodo anterior o preenchimento so vale se o item JA EXISTIA: item lancado
  // depois nao ganha uma linha reta no zero, que parece defeito e nao ausencia.
  if (ITEM && Object.keys(serieAnt).length) for (let d = janAntIni; d <= janAntFim; d = maisSete(d)) if (!serieAnt[d]) serieAnt[d] = { total: 0, pedidos: 0 };
  const chavesAnt = Object.keys(serieAnt).sort().slice(-chaves.length);
  const valoresAnt = temBase && chavesAnt.length === chaves.length
    ? chavesAnt.map(k => medidaDe(serieAnt[k])) : null;
  const rotAnt = valoresAnt ? chavesAnt.map(k => evolRotulo(k, grao)) : [];
  // O ULTIMO periodo do grao quase sempre esta pela metade (a semana ou o mes em
  // curso). Mostrar sem avisar faz parecer queda — entao ele fica marcado.
  const hojeSP = new Date(Date.now() - 3 * 36e5).toISOString().slice(0, 10);
  const fimDoGrao = grao === 'dia'
    ? maxData < hojeSP                      // dia fechado e' dia que ja passou
    : grao === 'mes'
      ? (() => { const d = new Date(maxData + 'T12:00:00'); return d.getDate() >= new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate(); })()
      : new Date(maxData + 'T12:00:00').getDay() === 0;
  const ultimoParcial = !fimDoGrao;

  // ---------- quebra generica ----------
  const quebra = (campo, rows, rowsAnt, rowsPar) => {
    const m = {}, mA = {}, mP = {};
    rows.forEach(r => { const o = m[r[campo]] || (m[r[campo]] = { total: 0, pedidos: 0 }); o.total += Number(r.total || 0); o.pedidos += Number(r.pedidos || 0); });
    rowsAnt.forEach(r => { const o = mA[r[campo]] || (mA[r[campo]] = { total: 0, pedidos: 0 }); o.total += Number(r.total || 0); o.pedidos += Number(r.pedidos || 0); });
    (rowsPar || rows).forEach(r => { mP[r[campo]] = (mP[r[campo]] || 0) + Number(r.total || 0); });
    return Object.entries(m).map(([k, o]) => ({ k, ...o, par: mP[k] || 0, ant: mA[k] || null }))
      .sort((a, b) => b.total - a.total);
  };
  const linhaQuebra = (x, totalGeral, tipo) => {
    const share = totalGeral ? x.total / totalGeral * 100 : 0;
    const tkx = x.pedidos ? x.total / x.pedidos : 0;
    const sel = tipo && EVOL_F[tipo] === x.k;
    const clic = tipo ? ` onclick="evolFiltrar('${tipo}','${String(x.k).replace(/'/g, "\'")}')" style="cursor:pointer;${sel ? 'background:var(--brand-wine);' : ''}" title="${sel ? 'clique para soltar o filtro' : 'clique para filtrar a tela por ' + (x.rot || x.k)}"` : '';
    return `<tr${clic}><td>${sel ? '<b>' : ''}${x.rot || x.k}${sel ? '</b> ✕' : ''}</td>
      <td>R$ ${fmt(x.total)}<span class="dre-av">${pct(share)}%</span></td>
      <td>${x.pedidos.toLocaleString('pt-BR')}</td>
      <td>R$ ${fmt(tkx)}</td>
      <td>${varTxt(x.par, x.ant && x.ant.total)}</td></tr>`;
  };
  // Cada quebra vira GRAFICO DE BARRA (o controle) + tabela (os numeros). Barra por
  // entidade usa UMA cor so: a identidade vem do rotulo do eixo, regra da skill
  // painel-visual. A barra selecionada fica na cor da marca.
  const tabela = (titulo, sub, id, itens, tipo, totalDim) => {
    const totD = totalDim === undefined ? tot : totalDim;
    const somaPed = itens.reduce((t, x) => t + x.pedidos, 0);
    return `
    <div class="section-label">${titulo}</div>
    <div class="caption-label" style="text-align:center;">${sub}${tipo ? ' <b>Clique na barra ou na linha para filtrar a tela inteira.</b>' : ''}</div>
    ${tipo ? `<div class="chart-box" style="height:${Math.max(130, 34 * itens.length + 40)}px;"><canvas id="chart${id}"></canvas></div>` : ''}
    <div id="${id}"><table>
      <tr><th>${titulo.split('—')[0].trim()}</th><th>Venda · % do total</th><th>Pedidos</th><th>Valor médio</th><th>vs período anterior</th></tr>
      ${itens.map(x => linhaQuebra(x, totD, tipo)).join('')}
      <tr class="liq"><td>TOTAL</td><td>R$ ${fmt(totD)}</td><td>${somaPed.toLocaleString('pt-BR')}</td><td>R$ ${fmt(somaPed ? totD / somaPed : 0)}</td><td>${varTxt(itens.reduce((t, x) => t + x.par, 0), itens.reduce((t, x) => t + (x.ant ? x.ant.total : 0), 0))}</td></tr>
    </table></div>`;
  };

  const FAIXA_ROT = { '1 MADRUGADA': 'Madrugada (0h–4h)', '2 MANHÃ': 'Manhã (5h–10h)', '3 ALMOÇO': 'Almoço (11h–14h)', '4 TARDE': 'Tarde (15h–17h)', '5 NOITE': 'Noite (18h–23h)' };
  const porCanal = quebra('canal', atualC, antC, parC).map(x => ({ ...x, rot: nomeCanal(x.k) }));
  const porFaixa = quebra('faixa', atualX, antX, parX).sort((a, b) => a.k < b.k ? -1 : 1).map(x => ({ ...x, rot: FAIXA_ROT[x.k] || x.k }));
  const porLoja = quebra('unidade', atualF, anteriorF, parF).map(x => ({ ...x, rot: UN_ROT[x.k] || x.k }));
  const totCanal = porCanal.reduce((t, x) => t + x.total, 0);
  const totFaixa = porFaixa.reduce((t, x) => t + x.total, 0);

  // ---------- matriz canal x faixa: a pergunta do dono ----------
  const canais = porCanal.map(x => x.k);
  const faixas = Object.keys(FAIXA_ROT);
  const cel = {};
  atual.forEach(r => { const k = r.canal + '|' + r.faixa; cel[k] = (cel[k] || 0) + Number(r.total || 0); });
  const celPar = {};
  atualPar.forEach(r => { const k = r.canal + '|' + r.faixa; celPar[k] = (celPar[k] || 0) + Number(r.total || 0); });
  const celAnt = {};
  anterior.forEach(r => { const k = r.canal + '|' + r.faixa; celAnt[k] = (celAnt[k] || 0) + Number(r.total || 0); });
  const matriz = `
    <div class="section-label">Onde a venda acontece — canal por faixa de horário</div>
    <div class="caption-label" style="text-align:center;">Cada célula é a venda do período, com a variação contra o período anterior embaixo.
      É esta tabela que responde se o almoço está crescendo em um canal e caindo em outro. <b>Clique numa célula para fixar o canal e a faixa de uma vez.</b></div>
    <div id="tabelaEvolMatriz"><table>
      <tr><th>Faixa</th>${canais.map(c => `<th>${nomeCanal(c)}</th>`).join('')}<th>Total</th></tr>
      ${faixas.filter(f => canais.some(c => cel[c + '|' + f])).map(f => {
        const linhaTot = canais.reduce((s, c) => s + (cel[c + '|' + f] || 0), 0);
        const linhaAnt = canais.reduce((s, c) => s + (celAnt[c + '|' + f] || 0), 0);
        const linhaPar = canais.reduce((s, c) => s + (celPar[c + '|' + f] || 0), 0);
        return `<tr><td>${FAIXA_ROT[f]}</td>${canais.map(c => {
          const v = cel[c + '|' + f] || 0, a = celAnt[c + '|' + f];
          // clicar na celula fixa os DOIS filtros de uma vez — e o atalho do cruzamento
          const selC = EVOL_F.canal === c && EVOL_F.faixa === f;
          const cl = v ? ` onclick="evolMatriz('${c}','${f}')" style="cursor:pointer;${selC ? 'background:var(--brand-wine);' : ''}" title="${selC ? 'clique para soltar' : 'clique para ver só ' + nomeCanal(c) + ' na ' + FAIXA_ROT[f]}"` : '';
          return `<td${cl}>${v ? 'R$ ' + fmt(v) : '—'}${v ? `<span class="dre-av">${varTxt(celPar[c + '|' + f] || 0, a)}</span>` : ''}</td>`;
        }).join('')}<td><b>R$ ${fmt(linhaTot)}</b><span class="dre-av">${varTxt(linhaPar, linhaAnt)}</span></td></tr>`;
      }).join('')}
      <tr class="liq"><td>TOTAL</td>${canais.map(c => {
        const v = porCanal.find(x => x.k === c);
        return `<td>R$ ${fmt(v.total)}</td>`;
      }).join('')}<td>R$ ${fmt(tot)}</td></tr>
    </table></div>`;

  // ---------- quebra por ITEM ----------
  // A tabela de itens anda em SEMANAS FECHADAS (segunda a domingo), porque a fonte é
  // semanal. Quando a janela começa no meio de uma semana — o caso do grão mês, que
  // começa no dia 1º — o recorte do item pode ficar alguns dias atrás do resto. Por
  // isso este bloco mostra o PRÓPRIO período em vez de herdar o do topo.
  // (semIni/semFim e o carregamento moram lá em cima, junto do modo item.)

  let blocoItens;
  if (!EVOL_ITENS || EVOL_ITENS.carregando) {
    blocoItens = `<div class="section-label">Por item</div>
      <div class="contexto">Carregando os itens do período...</div>`;
  } else if (EVOL_ITENS.erro) {
    blocoItens = `<div class="section-label">Por item</div>
      <div class="contexto" style="border-color:var(--farol-fora);">Não consegui carregar os itens: ${EVOL_ITENS.erro}</div>`;
  } else {
    // O bloco de itens obedece o MESMO filtro da tela (canal e faixa). O seletor
    // proprio de canal saiu: dois controles para a mesma coisa e' como a tela deixa
    // de ser confiavel. A view de item ganhou a faixa em 12/09 justamente para isto.
    const dentroIt = (r) => (!activeUnidades.size || activeUnidades.has(r.unidade))
      && (!EVOL_F.canal || r.canal === EVOL_F.canal)
      && (!EVOL_F.faixa || r.faixa === EVOL_F.faixa);
    // 22/10/2026 (Cardápio + Organizador): linha sem nome na base vem marcada fora_da_base, com a situacao — parte de
    // combo (escolha/adicional) ou fora do cardápio (histórico). Ela sai do ranking e dos totais por produto e aparece
    // em dois blocos à parte, com o valor, dizendo que o nome é o que veio do caixa.
    const somaIt = (rows) => {
      const m = {};
      rows.filter(dentroIt).filter(r => !r.fora_da_base).forEach(r => {
        const o = m[r.item] || (m[r.item] = { qtd: 0, receita: 0 });
        o.qtd += Number(r.qtd || 0); o.receita += Number(r.receita || 0);
      });
      return m;
    };
    const mA = somaIt(EVOL_ITENS.atual), mB = somaIt(EVOL_ITENS.anterior);
    const totIt = Object.values(mA).reduce((s, o) => s + o.receita, 0);
    const itens = Object.entries(mA).map(([item, o]) => ({ item, ...o, ant: mB[item] || null }))
      .sort((x, y) => y.receita - x.receita);

    // A LINHA DO ITEM E' CLICAVEL e fecha o cruzamento: fixa o item e a tela inteira
    // passa a falar dele. A lista de itens NAO se filtra por item — igual as barras de
    // canal e faixa, a dimensao escolhida continua inteira para dar como trocar.
    EVOL_LISTA_ITENS = itens.map(x => x.item);
    const idxIt = new Map(itens.map((x, i) => [x.item, i]));
    const trIt = (x) => {
      const sel = ITEM === x.item;
      return `<tr onclick="evolItemFiltrar(${idxIt.get(x.item)})" style="cursor:pointer;${sel ? 'background:var(--brand-wine);' : ''}" title="${sel ? 'clique para soltar o filtro' : 'clique para ver a tela inteira só deste item'}">
        <td>${sel ? '<b>' : ''}${x.item}${sel ? '</b> ✕' : ''}</td>
        <td>${x.qtd.toLocaleString('pt-BR', { maximumFractionDigits: 0 })}</td>
        <td>R$ ${fmt(x.receita)}<span class="dre-av">${pct(totIt ? x.receita / totIt * 100 : 0)}%</span></td>
        <td>R$ ${fmt(x.qtd ? x.receita / x.qtd : 0)}</td>
        <td>${varTxt(x.receita, x.ant && x.ant.receita)}</td></tr>`;
    };

    // Quem mais subiu e quem mais caiu, em R$. O piso de R$ 1.000 existe para item de
    // ponta não entrar como "subiu 300%" por causa de duas unidades a mais.
    const mov = itens.filter(x => Math.max(x.receita, x.ant ? x.ant.receita : 0) >= 1000 && x.ant)
      .map(x => ({ ...x, dif: x.receita - x.ant.receita }));
    const subiram = mov.filter(x => x.dif > 0).sort((a, b) => b.dif - a.dif).slice(0, 5);
    const cairam = mov.filter(x => x.dif < 0).sort((a, b) => a.dif - b.dif).slice(0, 5);
    const listaMov = (arr, rot) => arr.length ? `<div class="fx-tile" style="flex:1; min-width:280px;">
        <div class="fx-rotulo">${rot}</div>
        <ul class="fx-lista">${arr.map(x => `<li><span>${x.item}</span><b>${x.dif > 0 ? '+' : '−'} R$ ${fmt(Math.abs(x.dif))}</b></li>`).join('')}</ul>
      </div>` : '';

    // OS 10 MAIS E OS 10 MENOS (pedido do dono, 12/09/2026), com "abrir todos".
    // O "menos" precisa de PISO: sem ele a lista vira cauda de item que vendeu uma
    // unidade no periodo — informacao nenhuma. O corte e' 10 unidades vendidas, e a
    // tela diz qual e', para ninguem achar que e' o fundo do cardapio inteiro.
    const PISO_MENOS = 10;
    // FORA DO RANKING: item que saiu com RECEITA ZERO. Nao e' item que vende pouco, e'
    // item que nao foi vendido — brinde, acompanhamento que ja vem dentro do combo e
    // refeicao de funcionario. Sem esse corte o "menos venderam" virava a lista deles
    // (ALAIN PROST FUNCIONARIOS com 369 unidades e R$ 0, medido em 12/09/2026).
    // Eles aparecem numa linha propria embaixo, porque o consumo existe e e' informacao.
    const semPreco = itens.filter(x => x.receita < 0.005 && x.qtd > 0);
    const qtdSemPreco = semPreco.reduce((t, x) => t + x.qtd, 0);
    const doFundo = itens.filter(x => x.qtd >= PISO_MENOS && x.receita >= 0.005)
      .slice().sort((a, b) => a.receita - b.receita).slice(0, 10);
    const abertos = EVOL_ITEM_N >= itens.length;
    const nMostra = abertos ? itens.length : Math.min(EVOL_ITEM_N, itens.length);
    blocoItens = `
      <div class="section-label">Por item — ${ddmm(semIni)} a ${ddmm(maxData)}</div>
      <div class="caption-label" style="text-align:center;">
        O item como foi vendido: o combo conta como combo, não aberto em componentes.
        A receita aqui é <b>quantidade × preço do item</b>, antes do desconto do pedido e sem a taxa de serviço —
        por isso o total desta tabela fica 2 a 3% distante do das quebras acima, e isso não é erro.
        <b>Clique num item para a tela inteira falar só dele.</b>
        ${temBase ? '' : 'Sem período anterior para comparar.'}
      </div>
      ${subiram.length || cairam.length ? `<div style="display:flex; gap:12px; flex-wrap:wrap; margin-top:12px;">${listaMov(subiram, 'Os que mais subiram em R$')}${listaMov(cairam, 'Os que mais caíram em R$')}</div>` : ''}
      <div id="tabelaEvolItemTopo" style="margin-top:12px;"><table>
        <tr><th>Os 10 que mais venderam</th><th>Quantidade</th><th>Receita · % do total</th><th>Preço médio</th><th>vs período anterior</th></tr>
        ${itens.slice(0, 10).map(trIt).join('')}
      </table></div>
      ${doFundo.length ? `<div id="tabelaEvolItemFundo" style="margin-top:12px;"><table>
        <tr><th>Os 10 que menos venderam</th><th>Quantidade</th><th>Receita · % do total</th><th>Preço médio</th><th>vs período anterior</th></tr>
        ${doFundo.map(trIt).join('')}
      </table></div>
      <div class="caption-label">Entre os que venderam pelo menos <b>${PISO_MENOS} unidades</b> e saíram com preço. Sem o corte de quantidade a lista seria de itens com uma ou duas unidades; sem o corte de preço, seria a lista de brinde e refeição de funcionário.
        ${semPreco.length ? `Neste período <b>${semPreco.length} itens saíram com preço zero</b>, somando <b>${qtdSemPreco.toLocaleString('pt-BR', { maximumFractionDigits: 0 })} unidades</b> — é consumo, não venda, e por isso fica fora do ranking.` : ''}</div>` : ''}
      ${abertos ? `<div id="tabelaEvolItem" style="margin-top:12px;"><table>
        <tr><th>Todos os itens (${itens.length})</th><th>Quantidade</th><th>Receita · % do total</th><th>Preço médio</th><th>vs período anterior</th></tr>
        ${itens.slice(0, nMostra).map(trIt).join('')}
        <tr class="liq"><td>TOTAL</td>
          <td>${Object.values(mA).reduce((s, o) => s + o.qtd, 0).toLocaleString('pt-BR', { maximumFractionDigits: 0 })}</td>
          <td>R$ ${fmt(totIt)}</td><td>—</td>
          <td>${varTxt(totIt, Object.values(mB).reduce((s, o) => s + o.receita, 0))}</td></tr>
      </table></div>` : ''}
      <div style="text-align:center; margin-top:10px;"><button class="preset-btn" onclick="evolItemTodos()">${abertos ? 'fechar a lista completa' : `abrir todos os ${itens.length} itens`}</button></div>`;
    const aparte = (sit, rot, nota) => {
      const m = {};
      EVOL_ITENS.atual.filter(dentroIt).filter(r => r.fora_da_base && r.situacao === sit).forEach(r => {
        const o = m[r.item] || (m[r.item] = { qtd: 0, receita: 0 });
        o.qtd += Number(r.qtd || 0); o.receita += Number(r.receita || 0);
      });
      const L = Object.entries(m).map(([item, o]) => ({ item, ...o })).sort((a, b) => b.receita - a.receita || b.qtd - a.qtd);
      if (!L.length) return '';
      const tot = L.reduce((s, x) => s + x.receita, 0);
      return `<details style="margin-top:10px;"><summary style="cursor:pointer;"><b>${rot}</b> — ${L.length} ${L.length === 1 ? 'nome' : 'nomes'}, R$ ${fmt(tot)} · fora dos totais acima</summary>
        <div class="caption-label" style="text-align:left;">${nota}</div>
        <div id="tabelaEvolItem${sit}"><table><tr><th>Nome como veio do caixa</th><th>Quantidade</th><th>Receita</th></tr>
        ${L.map(x => `<tr><td>${trEscH(x.item)}</td><td>${x.qtd.toLocaleString('pt-BR', { maximumFractionDigits: 0 })}</td><td>R$ ${fmt(x.receita)}</td></tr>`).join('')}
        </table></div></details>`;
    };
    blocoItens += aparte('PARTE_DE_COMBO', 'Parte de combo (escolha/adicional)', 'Escolhas e adicionais vendidos dentro de um combo, com o nome do iFood: não são produto da nossa base.')
      + aparte('FORA_DO_CARDAPIO', 'Fora do cardápio (histórico)', 'Nomes que não estão na base de produtos: itens antigos ou que saíram do cardápio. Cada um que entrar na base passa para a lista principal sozinho.');
  }

  const seletor = (arr, atualIdx, fn, rot) => `<div class="periodo-presets" style="margin-top:10px;">`
    + arr.map((x, i) => `<button class="preset-btn ${atualIdx === (rot ? x[0] : i) ? 'active' : ''}" onclick="${fn}(${rot ? `'${x[0]}'` : i})">${rot ? x[1] : x[2]}</button>`).join('')
    + '</div>';

  alvo.innerHTML = `
    <div class="section-label" style="border-top:none; margin-top:0; padding-top:0;">Evolução de vendas${ITEM ? ' · ' + ITEM : ''} — ${ddmm(janIni)} a ${ddmm(maxData)}</div>
    <div class="caption-label" style="text-align:center;">
      A venda registrada no caixa das lojas (Saipos), por canal e por faixa de horário.
      ${unsComDado.length ? `<b>${unsComDado.map(u => UN_ROT[u] || u).join(', ')}</b>.` : ''}
      ${temBase ? `Comparando com ${ddmm(antIni)} a ${ddmm(antFim)}, do mesmo tamanho.` : 'Não há período anterior do mesmo tamanho na base para comparar.'}
      ${(() => { const lista = (o, suf) => Object.entries(o).filter(([, v]) => v > 0.005).sort().map(([k, v]) => { const [u, d] = k.split('|'); return (UN_ROT[u] || u) + ' ' + evolRotulo(d, 'dia') + ' R$ ' + fmt(v) + suf; });
        const f = [...lista(foraPar, ''), ...lista(foraParAnt, ', no período anterior')];
        return f.length ? `Fora da variação (loja fechada no mesmo dia do outro período; a venda continua nos totais): ${f.join(' · ')}.` : ''; })()}
    </div>
    ${seletor(EVOL_JANELAS, EVOL_JANELA, 'evolJanela')}
    ${(EVOL_F.canal || EVOL_F.faixa || ITEM) ? `<div class="contexto" style="border-color:var(--brand);">
      <b>Filtrando:</b>
      ${EVOL_F.canal ? `<button class="preset-btn active" onclick="evolFiltrar('canal','${EVOL_F.canal}')">canal ${nomeCanal(EVOL_F.canal)} ✕</button>` : ''}
      ${EVOL_F.faixa ? `<button class="preset-btn active" onclick="evolFiltrar('faixa','${EVOL_F.faixa}')">${FAIXA_ROT[EVOL_F.faixa] || EVOL_F.faixa} ✕</button>` : ''}
      ${ITEM ? `<button class="preset-btn active" onclick="evolLimparItem()">item ${ITEM} ✕</button>` : ''}
      <button class="preset-btn" onclick="evolLimparFiltros()">limpar</button>
      <div style="font-size:12px; color:var(--tx-3); margin-top:6px;">Os cards, o gráfico, a matriz e os itens estão neste recorte. As tabelas de canal, de faixa e de item continuam mostrando todas as opções, para você poder trocar.</div>
    </div>` : ''}
    ${ITEM ? `<div class="contexto" style="border-color:var(--amber-2);">
      <b>A tela inteira está falando de ${ITEM}.</b> Duas coisas mudam enquanto o item está fixado, porque a base do item é outra:
      o gráfico passa a andar de <b>semana em semana</b> (segunda a domingo), e o valor é a <b>receita bruta do item</b> —
      quantidade × preço, antes do desconto do pedido e sem a taxa de serviço. Por isso os números aqui não batem
      centavo a centavo com a tela sem item fixado. Os pedidos são os <b>pedidos que levaram este item</b>.
    </div>` : ''}

    <div class="cards">
      <div class="card blue"><div class="card-lbl">${ITEM ? 'Receita do item no período' : 'Venda no período'}</div>
        <div class="card-val">R$ ${fmt(tot)}</div><div class="card-pct">${varTxt(totP, totA)}</div></div>
      <div class="card neutral"><div class="card-lbl">${ITEM ? 'Pedidos com o item' : 'Pedidos'}</div>
        <div class="card-val">${ped.toLocaleString('pt-BR')}</div><div class="card-pct">${varTxt(pedP, pedA)}</div></div>
      <div class="card neutral"><div class="card-lbl">${ITEM ? 'Do item por pedido' : 'Valor médio por pedido'}</div>
        <div class="card-val">R$ ${fmt(tk)}</div><div class="card-pct">${varTxt(tkP, tkA)}</div></div>
      <div class="card neutral"><div class="card-lbl">${ITEM ? 'Receita por semana' : 'Venda por dia'}</div>
        <div class="card-val">R$ ${fmt(tot / nDias)}</div><div class="card-pct">média de ${nDias} ${ITEM ? 'semana(s)' : 'dia(s)'} com venda</div></div>
      ${ITEM ? '' : `<div class="card ${tot && canc / tot * 100 > 1.2 ? 'neg' : 'neutral'}"><div class="card-lbl">Cancelados</div>
        <div class="card-val">R$ ${fmt(canc)}</div>
        <div class="card-pct">${pct(tot ? canc / tot * 100 : 0)}% da venda · ${cancN.toLocaleString('pt-BR')} pedidos${piorCanc && piorCanc[1] > 0 ? ' · maior parte em ' + nomeCanal(piorCanc[0]) : ''}</div></div>`}
    </div>

    <div class="section-label">Como ${ITEM ? 'este item' : 'a venda'} evoluiu</div>
    <div class="caption-label" style="text-align:center;">Por ${grao === 'mes' ? 'mês' : grao === 'dia' ? 'dia' : 'semana (segunda a domingo)'}.${valoresAnt ? ' A linha tracejada é o período anterior, ponto a ponto na mesma escala — passe o mouse para ver as duas datas e os dois valores.' : ''}
      ${ultimoParcial ? `O último ponto é ${grao === 'mes' ? 'o mês' : grao === 'dia' ? 'o dia' : 'a semana'} em curso: fica vazado e com o traço pontilhado, porque ainda não fechou.` : ''}</div>
    ${seletor([['total', 'Venda'], ['pedidos', 'Pedidos'], ['ticket', 'Valor médio']], EVOL_MEDIDA, 'evolMedida', true)}
    <div class="chart-box" style="height:260px;"><canvas id="chartEvolucao"></canvas></div>

    ${tabela('Por canal', ITEM ? 'Por onde este item sai.' : 'Onde a venda entra.', 'tabelaEvolCanal', porCanal, 'canal', totCanal)}
    ${tabela('Por faixa de horário', 'A faixa sai da hora da venda registrada no Saipos, não do turno do cadastro.', 'tabelaEvolFaixa', porFaixa, 'faixa', totFaixa)}
    ${matriz}
    ${unsComDado.length > 1 ? tabela('Por loja', 'Para isolar uma loja, use o filtro de unidade lá em cima — é o mesmo controle do resto do painel.', 'tabelaEvolLoja', porLoja) : ''}
    ${blocoItens}

    <div class="caption-label" title="A faixa vem da hora da venda: no salão é a abertura da comanda, no delivery é a criação do pedido. O valor é o do PDV e não se compara direto com o bruto do portal do iFood. Ressalva aberta desde 20/08: o salão da Água Verde registra comandas antes das 11h com ticket alto — pendente de conferir na loja.">
      Caixa do Saipos (${ITEM ? 'vw_venda_item_semana' : 'vw_venda_evolucao'}), Água Verde, Ahú e São Braz. O Boqueirão não entra.
    </div>`;

  // Uma medida so, uma cor so: a identidade vem do rotulo do eixo, nao da cor.
  // O periodo em curso fica com a barra apagada para nao virar leitura de queda.
  // BARRAS CLICAVEIS de canal e faixa. Uma cor so (--info); a selecionada em --brand.
  // Barra horizontal porque o rotulo e' texto ("SITE PRÓPRIO", "Almoço (11h–14h)") e em
  // barra vertical ele deita e fica ilegivel.
  const barra = (idCanvas, itens, tipo) => {
    destroyChart(idCanvas);
    const el = document.getElementById(idCanvas);
    if (!el || !itens.length) return;
    chartInstances[idCanvas] = new Chart(el.getContext('2d'), {
      type: 'bar',
      data: {
        labels: itens.map(x => x.rot || x.k),
        datasets: [{
          data: itens.map(x => x.total),
          backgroundColor: itens.map(x => EVOL_F[tipo] === x.k ? corToken('--brand') : corTokenA('--info', 0.75)),
          borderRadius: 3,
          barThickness: 18,
        }],
      },
      options: {
        indexAxis: 'y',
        responsive: true, maintainAspectRatio: false,
        onClick: (_e, els) => { if (els.length) evolFiltrar(tipo, itens[els[0].index].k); },
        onHover: (e, els) => { e.native.target.style.cursor = els.length ? 'pointer' : 'default'; },
        plugins: {
          legend: { display: false },
          tooltip: { callbacks: {
            label: (c) => 'R$ ' + fmt(c.parsed.x),
            afterLabel: (c) => {
              const x = itens[c.dataIndex];
              return (EVOL_F[tipo] === x.k ? 'clique para soltar' : 'clique para filtrar a tela')
                + (x.ant ? ' · ' + varTxt(x.par, x.ant.total).replace(/<[^>]+>/g, '') : '');
            },
          } },
        },
        scales: {
          x: { beginAtZero: true, ticks: { callback: (v) => 'R$ ' + (v >= 1000 ? (v / 1000).toFixed(0) + ' mil' : v) } },
          y: { ticks: { autoSkip: false } },
        },
      },
    });
  };
  barra('charttabelaEvolCanal', porCanal, 'canal');
  barra('charttabelaEvolFaixa', porFaixa, 'faixa');

  destroyChart('chartEvolucao');
  const ctx = document.getElementById('chartEvolucao');
  if (ctx && chaves.length) {
    // DUAS LINHAS, uma por periodo (pedido do dono, 12/09/2026). Eram barras + linha
    // fantasma; virou linha contra linha porque e' comparacao de MESMA medida em dois
    // tempos, e linha e' o que o olho segue para ver onde uma descolou da outra —
    // ainda mais no grao dia, onde 28 barras viram ruido.
    //
    // COR: o periodo atual fica em --info (a cor de dado do painel) e o anterior em
    // --tx-4, tracejado. Nao usei --serie-1/2 de proposito: aquela paleta e' de ENTIDADE
    // (identidade de loja, ordem fixa) e aqui as duas series sao a MESMA medida em tempos
    // diferentes — dar peso igual as duas faz o olho comparar duas coisas em vez de ler
    // uma contra a referencia. Se um dia o dono quiser as duas fortes, e' trocar
    // corToken('--tx-4') por corToken('--serie-2') nas tres linhas abaixo.
    const corAtual = corToken('--info'), corAnt = corToken('--tx-4');
    const ultimo = chaves.length - 1;
    chartInstances['chartEvolucao'] = new Chart(ctx.getContext('2d'), {
      type: 'line',
      data: {
        labels: chaves.map(k => evolRotulo(k, grao)),
        datasets: [{
          label: 'Período atual',
          data: valores,
          borderColor: corAtual,
          backgroundColor: corTokenA('--info', 0.12),
          borderWidth: 2,
          fill: true,
          tension: .25,
          // o ponto em curso fica vazado e o traco ate ele, pontilhado
          pointRadius: chaves.map((_, i) => (ultimoParcial && i === ultimo) ? 5 : 3),
          pointBackgroundColor: chaves.map((_, i) => (ultimoParcial && i === ultimo) ? corToken('--surface') : corAtual),
          pointBorderColor: corAtual,
          pointBorderWidth: 2,
          segment: { borderDash: (c) => (ultimoParcial && c.p1DataIndex === ultimo) ? [4, 4] : undefined },
          order: 1,
        }].concat(valoresAnt ? [{
          label: 'Período anterior',
          data: valoresAnt,
          borderColor: corAnt,
          backgroundColor: corAnt,
          borderWidth: 2,
          borderDash: [5, 4],
          fill: false,
          tension: .25,
          pointRadius: 2,
          order: 2,
        }] : []),
      },
      options: {
        responsive: true, maintainAspectRatio: false,
        interaction: { mode: 'index', intersect: false },
        plugins: {
          legend: { display: !!valoresAnt, labels: { boxWidth: 14, boxHeight: 2, usePointStyle: false } },
          tooltip: {
            callbacks: {
              // O QUADRO MOSTRA OS DOIS, cada um com a SUA data (pedido do dono):
              // "sáb 06/09" em cima, e dentro "atual 06/09: R$ x" / "anterior 09/08: R$ y".
              title: (cs) => cs.length ? chaves.map(k => evolRotulo(k, grao))[cs[0].dataIndex] : '',
              label: (c) => {
                const v = EVOL_MEDIDA === 'pedidos'
                  ? Number(c.parsed.y).toLocaleString('pt-BR', { maximumFractionDigits: 0 }) + ' pedidos'
                  : 'R$ ' + fmt(c.parsed.y);
                const dt = c.datasetIndex === 0 ? evolRotulo(chaves[c.dataIndex], grao) : (rotAnt[c.dataIndex] || '');
                const quem = c.datasetIndex === 0 ? 'Atual' : 'Anterior';
                return `${quem} · ${dt}: ${v}`;
              },
              afterBody: (cs) => {
                if (!valoresAnt || !cs.length) return '';
                const i = cs[0].dataIndex, a = valores[i], b = valoresAnt[i];
                const linhas = [];
                if (b) {
                  const d = (a - b) / Math.abs(b) * 100;
                  linhas.push(Math.abs(d) < 0.05 ? 'igual ao anterior'
                    : (d > 0 ? 'subiu ' : 'caiu ') + Math.abs(d).toFixed(1).replace('.', ',') + '%'
                      + (EVOL_MEDIDA === 'pedidos' ? '' : ' (R$ ' + fmt(Math.abs(a - b)) + ')'));
                }
                if (ultimoParcial && i === ultimo) linhas.push(grao === 'dia' ? 'o dia ainda não fechou' : grao === 'mes' ? 'o mês ainda não fechou' : 'a semana ainda não fechou');
                return linhas.join(String.fromCharCode(10));
              },
            },
          },
        },
        scales: {
          x: { ticks: { maxRotation: 60, autoSkip: true } },
          y: { beginAtZero: true, ticks: { callback: (v) => EVOL_MEDIDA === 'pedidos' ? v.toLocaleString('pt-BR') : 'R$ ' + (v >= 1000 ? (v / 1000).toFixed(0) + ' mil' : v) } },
        },
      },
    });
  }
}

// 26/10/2026: tela de Custo e cardápio movida para docs/cardapio/cardapio.js (bloco 5 do painel em módulos).
// ------------------------------------------------------------------
// LUCRO POR UNIDADE (24/08/2026) — nasceu de uma pergunta do dono: "o saldo
// inicial da XP menos o final e o que sobrou no ano; quanto disso e bonificacao
// de comissao zero do iFood e quanto e lucro, por unidade?".
//
// A XP sozinha responde errado por dois motivos, e a tela mostra os dois:
//   1. a XP subiu MAIS do que a rede sobrou — as filiais esvaziaram a conta
//      delas para alimentar a matriz. So o caixa somado das 3 diz a verdade.
//   2. caixa nao e lucro: investimento, retirada de socio e rendimento
//      financeiro entram no meio do caminho. Por isso a ponte no fim da tela.
//
// O lucro vem de vw_fin_resultado_unidade, que ja elimina o intercompany: o
// repasse em dinheiro nao conta (virou FLUXO NAO OPERACIONAL no plano de contas
// em 24/08) e o custo da mercadoria entra por COMPETENCIA, pela lista fechada
// do mes. Antes disso o Ahu aparecia com 45% de margem tendo R$ 43,9 mil de
// materia prima em 7 meses — porque a compra dele na AV estava em INVESTIMENTOS.
//
// 01/10/2026 (dono): "Lucro por unidade deve trazer numeros reais e considerar
// tudo, ele nada mais e que uma DRE por filial resumida" e "todos os numeros de
// todos os modulos devem bater". Ate aqui a view somava so o realizado (sem as
// contas a pagar do mes) sobre a receita que caiu na conta, e a tela dizia por
// escrito que o numero nao era o da DRE; em setembro a Agua Verde aparecia com
// R$ 413 mil de lucro. Agora a view e' uma PROJECAO de vw_fin_resultado_fato, a
// mesma conta do modulo DRE: o lucro daqui bate com o resultado de la ao centavo.
// Nao volte a somar receita ou despesa nesta tela — a conta mora num lugar so.
// ------------------------------------------------------------------
let LUCROUNI = null;

// Recorte de periodo DA TELA (12/09/2026): 'mes' | 'tri' | 'ano' | 'placar'.
// Antes daqui a tela so conhecia dois estados — o recorte que o Placar mandou, ou
// TODO mes fechado desde jan/26. null = ninguem escolheu ainda: vale o do Placar
// quando ele veio, e o ano todo quando nao veio.
let LUCROUNI_PER = null;

// Escolher periodo SOLTA o recorte do Placar — a mesma regra de plcSoltaEAplica no
// resto do painel: dali em diante o recorte e' de quem esta olhando, e o chip nao
// pode continuar dizendo um periodo que a tela nao mostra mais. So 'placar' o mantem.
function lucrouniPer(p) {
  LUCROUNI_PER = p;
  if (p !== 'placar') plcCtxSolta('lucrouni');
  renderLucroUni();
}

async function entrarLucroUni() {
  // Cada entrada recomeca do recorte do Placar (ou do ano todo). Sem zerar, uma
  // escolha antiga faria a tela ignorar em silencio o recorte que o Placar acabou
  // de mandar — com o chip na tela dizendo o contrario.
  LUCROUNI_PER = null;
  const alvo = document.getElementById('view-lucrouni');
  if (!alvo) return;
  if (LUCROUNI === null) {
    alvo.innerHTML = '<div class="contexto">Carregando o resultado por unidade...</div>';
    const [res, contas, saldos, dfc] = await Promise.all([
      consultarTudo('vw_fin_resultado_unidade?select=*&order=mes'),
      consultarTudo('fin_contas?select=conta,unidade,saldo_inicial,data_saldo_inicial,ativa'),
      // saldo por MES (nao o saldo de hoje): o caixa precisa parar no mesmo mes
      // em que o lucro para, senao a ponte compara sete meses de lucro com oito
      // de caixa e a diferenca que sobra parece erro quando e' so a janela.
      consultarTudo('vw_fin_saldo_conta_mensal?select=mes,conta,movimento'),
      consultarTudo('vw_fin_dfc_mensal?select=mes,unidade,natureza,subtipo,credito,debito'),
    ]);
    LUCROUNI = { res, contas, saldos, dfc };
  }
  renderLucroUni();
}

function renderLucroUni() {
  const alvo = document.getElementById('view-lucrouni');
  if (!alvo || LUCROUNI === null) return;
  const { res, contas, saldos, dfc } = LUCROUNI;
  const nu = (v) => Number(v) || 0;
  const mesTxt = (m) => MESES_ABREV[Number(m.slice(5, 7)) - 1] + '/' + m.slice(2, 4);
  const rs = (v) => 'R$ ' + fmt(v);
  // fin_* grava a unidade sem acento; a tela do dono mostra o nome escrito certo
  const UN_NOME = { 'AGUA VERDE': 'ÁGUA VERDE', 'AHU': 'AHÚ', 'SAO BRAZ': 'SÃO BRAZ' };
  const un = (u) => UN_NOME[u] || u;

  if (!res.length) {
    alvo.innerHTML = '<div class="contexto">Sem resultado calculado — confira <b>vw_fin_resultado_unidade</b>.</div>';
    return;
  }

  // O mes corrente e SEMPRE parcial (nota fiscal e folha do mes ainda nao
  // lancadas), e mes parcial inflado vira decisao errada. Ele aparece na tabela
  // marcado, mas fica fora de todo total desta tela.
  // QUANDO A PESSOA CHEGA PELO PLACAR (12/09/2026) esta tela e' a quebra por loja de
  // "Resultado" e de "Caixa", e abre no MESMO recorte: os meses e a loja que o Placar
  // estava mostrando. O contexto e' so LIDO aqui — nada de escrever em lojaFin() nem em
  // activeUnidades, que sao globais e vazariam para as outras telas.
  // O fallback nao e' enfeite: mes do Placar que nao exista nesta view deixaria
  // `fechados` vazio, e ai mesTxt(undefined) estoura no meio do template — a tela
  // ficaria parada em "Carregando", sem erro na cara de ninguem.
  const ctx = plcCtx('lucrouni');
  const meses = [...new Set(res.map(r => r.mes))].sort();
  const mesAberto = meses[meses.length - 1];
  const doCtx = ctx && ctx.meses ? meses.filter(m => ctx.meses.includes(m)) : [];
  const fechadosTodos = meses.filter(m => m < mesAberto);
  // 'placar' so existe enquanto o recorte do Placar existir; sem ele a tela cai no
  // ano todo, que e' exatamente o que ela fazia antes do seletor.
  const per = doCtx.length ? (LUCROUNI_PER || 'placar')
                           : (LUCROUNI_PER && LUCROUNI_PER !== 'placar' ? LUCROUNI_PER : 'ano');
  const fechados = per === 'placar' ? doCtx
    : fechadosTodos.slice(-({ mes: 1, tri: 3 }[per] || fechadosTodos.length));
  const perBtn = (p, rot) => `<button class="preset-btn ${per === p ? 'active' : ''}" onclick="lucrouniPer('${p}')">${rot}</button>`;
  const seletorPeriodo = `<div class="periodo-presets" style="margin-top:10px;">${
    perBtn('mes', 'Último mês')}${perBtn('tri', 'Últimos 3 meses')}${perBtn('ano', 'Ano todo')}${
    doCtx.length ? perBtn('placar', 'Recorte do Placar') : ''}</div>`;
  const ctxLoja = lojaFin() !== 'REDE' ? lojaFin() : null;
  const unidades = [...new Set(res.map(r => r.unidade))].sort().filter(u => !ctxLoja || u === ctxLoja);

  const somaU = (u, campo) => res.reduce((s, r) =>
    s + (r.unidade === u && fechados.includes(r.mes) ? nu(r[campo]) : 0), 0);
  const somaRede = (campo) => unidades.reduce((s, u) => s + somaU(u, campo), 0);

  const lucroRede = somaRede('resultado');
  const benefRede = somaRede('beneficio_ifood');
  const semBenRede = lucroRede - benefRede;
  const pctBenef = lucroRede > 0 ? benefRede / lucroRede * 100 : 0;
  // O CAMINHO (12/09/2026): quanto o preco medio teria de subir para o lucro ficar
  // igual pagando comissao cheia. E' o MINIMO — supoe vender exatamente o mesmo
  // depois do aumento; se a venda cair, precisa subir mais. A receita e' a venda
  // bruta da DRE (PDV + outras receitas), a mesma base dos percentuais de la.
  // 07/10/2026: na Rede (sem loja escolhida) a lista entre lojas nao e' receita. A view ja
  // entrega receita_propria (= receita − lista recebida das filiais), a base da Rede na DRE.
  const receitaRede = ctxLoja ? somaRede('receita') : somaRede('receita_propria');
  const pctPreco = receitaRede > 0 ? benefRede / receitaRede * 100 : 0;

  // ---- caixa: onde o dinheiro esta hoje. Cartao de credito fica de fora — e
  // divida a pagar, nao caixa, e misturar os dois embaralha a leitura.
  const ehCartao = (c) => /^(CREDITO|CARTAO)/.test(c);
  // movimento acumulado ATE o ultimo mes fechado — mesma janela do lucro
  const movAte = {};
  // O QUE ENTROU ANTES DA JANELA (12/09/2026). Sem isto o caixa inicial e' sempre a
  // abertura da conta em janeiro, e com um recorte de um mes so a tela compararia a
  // variacao de caixa do ANO inteiro com o lucro de um MES. Enquanto a janela comeca
  // no primeiro mes da base, movAntes e' zero e nada muda em relacao ao que havia.
  const movAntes = {};
  saldos.forEach(s => {
    if (s.mes < fechados[0]) { movAntes[s.conta] = (movAntes[s.conta] || 0) + nu(s.movimento); return; }
    if (s.mes > fechados[fechados.length - 1]) return;
    movAte[s.conta] = (movAte[s.conta] || 0) + nu(s.movimento);
  });
  const caixaU = {};
  contas.filter(c => !ehCartao(c.conta) && (!ctxLoja || c.unidade === ctxLoja)).forEach(c => {
    const a = caixaU[c.unidade] || (caixaU[c.unidade] = { ini: 0, fim: 0 });
    const abre = nu(c.saldo_inicial) + (movAntes[c.conta] || 0);
    a.ini += abre;
    a.fim += abre + (movAte[c.conta] || 0);
  });
  // A XP e' reserva DA REDE e nao tem dono por loja: ela fica fora do corte de loja,
  // e o cartao diz isso quando a tela esta recortada numa unidade so.
  const xp = contas.find(c => c.conta === 'XP INVESTIMENTOS');
  const xpIni = (xp ? nu(xp.saldo_inicial) : 0) + (movAntes['XP INVESTIMENTOS'] || 0);
  const xpFim = xpIni + (movAte['XP INVESTIMENTOS'] || 0);
  // A XP entra no "caixa" desta tela — pode, pela regra do dono de 25/09/2026 ("para todo o
  // restante dos calculos esse valor pode ser considerado") —, mas o rotulo tem de dizer:
  // com o cartao "XP · reserva" do lado, quem le contava a XP duas vezes. Jan-ago/26 o cartao
  // dizia "Caixa da rede inteira +R$ 540 mil"; sem a XP o caixa caiu R$ 101,5 mil.
  const xpDentro = contas.some(c => c.conta === 'XP INVESTIMENTOS' && (!ctxLoja || c.unidade === ctxLoja));
  const caixaIni = Object.values(caixaU).reduce((s, a) => s + a.ini, 0);
  const caixaFim = Object.values(caixaU).reduce((s, a) => s + a.fim, 0);
  // 07/11/2026 (auditoria lote 1, resultado-26): o "sem a XP" é o MESMO perímetro do Placar
  // (vw_fin_ponte_mensal.variacao_caixa): bancos + cofres + cartões, sem a XP e sem as Participações
  // (aplicação: ITAU AV → PARTICIPACOES → XP). Antes tirava só a XP e deixava o cartão de fora.
  const APLIC_LU = ['XP INVESTIMENTOS', 'PARTICIPACOES'];
  const caixaSemXp = contas.filter(c => !APLIC_LU.includes(c.conta) && (!ctxLoja || c.unidade === ctxLoja))
    .reduce((s, c) => s + (movAte[c.conta] || 0), 0);

  // ---- a ponte: do lucro ate o caixa. Os mesmos meses fechados, lidos do DFC
  // (que e caixa por natureza) para nao comparar competencia com pagamento.
  const dfcU = (u, natureza) => dfc.reduce((s, r) => s + (
    r.unidade === u && fechados.includes(r.mes) && r.natureza === natureza
      ? nu(r.credito) - nu(r.debito) : 0), 0);
  const dfcRede = (natureza) => unidades.reduce((s, u) => s + dfcU(u, natureza), 0);
  const invest = dfcRede('INVESTIMENTOS');
  const retiradas = dfcRede('DISTRIBUICAO DE LUCROS');
  // Rendimento de aplicacao NAO entra mais na ponte (01/10/2026): o resultado da
  // DRE ja o inclui (resultado financeiro), e somar de novo contava duas vezes.
  const aporte = dfcRede('APORTE VALORES');   // repasse entre as unidades: soma ~0 na rede

  const cardsUni = unidades.map(u => {
    const l = somaU(u, 'resultado'), b = somaU(u, 'beneficio_ifood');
    const p = l > 0 ? b / l * 100 : 0;
    return `<div class="card ${p >= 30 ? 'neg' : 'neutral'}">
      <div class="card-lbl">${un(u)}</div>
      <div class="card-val">${rs(l)}</div>
      <div class="card-pct">de lucro no período</div>
      <div class="card-delta" style="color:${p >= 30 ? '#ff6b6b' : '#a5a49a'};">
        ${rs(b)} vieram do benefício iFood — ${p > 100 ? 'mais que o lucro inteiro' : pct(p) + '% do lucro'}</div>
    </div>`;
  }).join('');

  const linhaTab = (r) => {
    const l = nu(r.resultado), b = nu(r.beneficio_ifood);
    const aberto = r.mes === mesAberto;
    // lista do mes ainda sem CONGELAR (tr_conciliacao_mes): o valor por loja pode mudar
    const semLista = !aberto && r.lista_fechada === false;
    return `<tr${aberto ? ' style="opacity:.55;"' : ''}>
      <td>${mesTxt(r.mes)}${aberto ? ' <span style="color:#e8b04b;">· mês em aberto</span>' : ''}${semLista ? ' <span style="color:var(--amber-2);" title="A lista das filiais deste mês ainda está em revisão: o valor entre a Água Verde e a filial pode mudar até fechar. O total da rede não muda.">· lista em revisão</span>' : ''}</td>
      <td>${un(r.unidade)}</td>
      <td>${rs(nu(r.receita))}</td>
      <td>${nu(r.custo_lista_av) ? rs(nu(r.custo_lista_av)) : '—'}</td>
      <td class="${l < 0 ? 'negativo' : ''}"><b>${rs(l)}</b></td>
      <td>${rs(b)}</td>
      <td class="${l - b < 0 ? 'negativo' : ''}">${rs(l - b)}</td>
      <td>${l > 0 ? (b > l ? 'mais de 100%' : pct(b / l * 100) + '%') : '—'}</td>
    </tr>`;
  };

  const linhaPonte = (rotulo, v, nota) => `<tr>
    <td>${rotulo}${nota ? `<div style="color:#6f6e64; font-size:10.5px;">${nota}</div>` : ''}</td>
    <td class="${v < 0 ? 'negativo' : ''}">${rs(v)}</td></tr>`;

  const chegou = lucroRede + invest + retiradas + aporte;
  // meses do recorte em que a lista das filiais ainda nao fechou (aviso condicional)
  const semListaMeses = [...new Set(res.filter(r => fechados.includes(r.mes) && r.lista_fechada === false).map(r => r.mes))];
  const sobrouCaixa = caixaFim - caixaIni;

  alvo.innerHTML = `
    ${plcCabecalhoQuebra('lucrouni')}
    <div class="section-label" style="border-top:none; margin-top:0; padding-top:0;">
      Lucro por unidade${ctxLoja ? ' · ' + un(ctxLoja) : ''} · ${fechados.length === 1 ? mesTxt(fechados[0]) : mesTxt(fechados[0]) + ' a ' + mesTxt(fechados[fechados.length - 1])}</div>
    <div class="contexto">É a <a href="javascript:void(0)" onclick="mostrarModulo('dre')" style="color:var(--tx-3);">DRE</a> resumida por loja: o lucro daqui é o resultado de lá, mês a mês, e quanto dele é benefício do iFood.</div>
    ${semListaMeses.length ? `<div class="contexto" style="border-color:var(--amber-2);">Lista das filiais de ${semListaMeses.map(mesTxt).join(', ')} ainda em revisão: o lucro <b>por loja</b> desse mês pode mudar até ela fechar. O da rede não muda.</div>` : ''}

    ${seletorPeriodo}

    <div class="hero" style="border-color:${pctBenef >= 30 ? '#e8b04b' : '#3fb950'};">
      <div class="hero-lbl">De cada real de lucro da rede, quanto veio do benefício do iFood</div>
      <div class="hero-val">${pct(pctBenef)}%</div>
      <div class="hero-delta" style="color:#a5a49a;">
        ${rs(lucroRede)} de lucro · ${rs(benefRede)} de benefício · ${rs(semBenRede)} seriam o lucro pagando comissão cheia</div>
      <div class="hero-frase">
        O benefício não é dinheiro que entrou a mais: é comissão que o iFood <b>deixou de cobrar</b>,
        já diluída na receita. Ele acaba quando os R$ 500 mil forem consumidos — por isso o número
        que interessa para decidir preço é o da direita.</div>
      <div class="hero-frase" style="margin-top:8px;">
        <b>O caminho:</b> para dar o mesmo lucro pagando comissão cheia, o preço médio teria de
        subir <b>${pct(pctPreco)}%</b> — ${rs(benefRede)} sobre ${rs(receitaRede)} de receita no
        período. É o <b>mínimo</b>, não uma promessa: supõe vender exatamente o mesmo depois do
        aumento.
        <a href="javascript:void(0)" onclick="mostrarModulo('rateio')" style="color:var(--tx-3);"
           title="Preço alvo produto a produto, com a conta aberta: ingrediente, embalagem, impostos, iFood, entrega, fixos e pró-labore.">Ver preço alvo por produto →</a></div>
    </div>

    <div class="cards cards-3">${cardsUni}</div>

    <div class="section-label">Mês a mês</div>
    <div id="tabelaLucroUni"><table>
      <thead><tr><th>Mês</th><th>Unidade</th><th>Receita</th><th>Mercadoria da AV</th>
        <th>Lucro</th><th>Benefício iFood</th><th>Lucro sem o benefício</th><th>% do lucro</th></tr></thead>
      <tbody>${res.filter(r => fechados.includes(r.mes)
        && (!ctxLoja || r.unidade === ctxLoja)).map(linhaTab).join('')}</tbody>
    </table></div>
    <div class="contexto">
      <b>Mercadoria da AV</b> é o que a filial comprou da Água Verde no mês, pela lista fechada —
      e a mesma lista entra como receita da Água Verde. O dinheiro que a filial repassa além disso
      é lucro subindo para a XP, e por isso não aparece como receita de ninguém: contaria duas vezes.
    </div>

    <div class="section-label">O que sobrou em caixa, e por quê</div>
    <div class="cards cards-3">
      <div class="card blue">
        <div class="card-lbl">XP · reserva${ctxLoja ? ' (da rede)' : ''}</div>
        <div class="card-val">${rs(xpFim - xpIni)}</div>
        <div class="card-pct">${rs(xpIni)} → ${rs(xpFim)}${ctxLoja ? ' · a XP não tem dono por loja' : ''}</div>
      </div>
      <div class="card ${sobrouCaixa >= 0 ? 'pos' : 'neg'}">
        <div class="card-lbl">Caixa ${ctxLoja ? 'de ' + un(ctxLoja) : 'da rede inteira'}${xpDentro ? ' + XP' : ''}</div>
        <div class="card-val">${rs(sobrouCaixa)}</div>
        <div class="card-pct">${rs(caixaIni)} → ${rs(caixaFim)}${xpDentro ? ` · sem a XP (como no Placar): ${rs(caixaSemXp)}` : ''}</div>
      </div>
      <div class="card neutral">
        <div class="card-lbl">Lucro do período</div>
        <div class="card-val">${rs(lucroRede)}</div>
        <div class="card-pct">nos meses fechados</div>
      </div>
    </div>
    <div class="contexto">
      ${(() => {
        const caiu = unidades.filter(u => caixaU[u] && caixaU[u].fim < caixaU[u].ini);
        if (!caiu.length) return 'Todas as unidades terminaram o período com mais dinheiro em conta do que começaram.';
        const nomes = caiu.map(un).join(' e ');
        return `A XP subiu <b>mais</b> do que a rede sobrou: ${nomes} ${caiu.length > 1 ? 'terminaram' : 'terminou'}
          com menos dinheiro em conta do que ${caiu.length > 1 ? 'começaram' : 'começou'}, porque o caixa
          das filiais foi para a matriz. Olhar só a XP superestima o que a rede ganhou.`;
      })()}
    </div>

    <div id="tabelaPonteLucro" style="max-width:640px; margin:14px auto 0;"><table>
      <thead><tr><th>Do lucro até o caixa (rede)</th><th>Valor</th></tr></thead>
      <tbody>
        ${linhaPonte('Lucro do período', lucroRede)}
        ${linhaPonte('(−) Investimentos', invest, 'obra, máquina, equipamento — vira ativo, não some')}
        ${linhaPonte('(−) Retiradas dos sócios', retiradas)}
        ${Math.abs(aporte) > 0.005 ? linhaPonte('(±) Repasse entre as unidades', aporte, 'soma perto de zero na rede — só muda de bolso') : ''}
        <tr class="sub"><td><b>= deveria ter sobrado</b></td><td><b>${rs(chegou)}</b></td></tr>
        <tr class="liq"><td>Sobrou de verdade no caixa${xpDentro ? ' + XP' : ''}</td><td>${rs(sobrouCaixa)}</td></tr>
        <tr><td style="color:#8a897e;">Diferença de competência × caixa
              <div style="color:#6f6e64; font-size:10.5px;">nota lançada num mês, dinheiro que andou em outro</div></td>
            <td style="color:#8a897e;">${rs(sobrouCaixa - chegou)}</td></tr>
      </tbody>
    </table></div>
    <div class="contexto">
      A diferença que sobra vem de competência × caixa: o lucro conta a nota do mês em que ela
      aconteceu, o caixa conta o dia em que o dinheiro andou. O "sem a XP" é o caixa do Placar:
      bancos, cofres e cartão, sem a XP e as Participações.
    </div>

    <div class="footer">
      Lucro = resultado da DRE: por competência, com as contas do mês já lançadas (pagas ou a pagar) e o rendimento das aplicações. Benefício iFood
      = a comissão de 9,5% que o iFood deixou de cobrar nas lojas isentas (ficam fora o Boqueirão, a Comida
      Brasileira AV e, desde 06/10/2026, a Marmita da Jane). De 05/10/2026 em diante: 9,5% da venda de cada pedido
      (itens + entrega − desconto que a loja banca), como o iFood cobra. Até 04/10/2026: 9,5% do valor que o iFood
      depositou — dá uns 12% a menos e não será refeito. Não é extrato do iFood. Fonte: vw_fin_resultado_unidade, vw_fin_saldo_conta_mensal, vw_fin_dfc_mensal.
    </div>`;
  // encaixarTabela recebe o ELEMENTO (nao o id) — mede o fundo atras da tabela
  // e marca .rolavel para a coluna fixa ganhar sombra so quando de fato rola.
  ['tabelaLucroUni', 'tabelaPonteLucro'].forEach(id => {
    const d = document.getElementById(id);
    if (d && typeof encaixarTabela === 'function') encaixarTabela(d);
  });
}

// ------------------------------------------------------------------
// MODULO ESTA SEMANA — a home de decisao (12/08/2026).
// Regra da casa: nenhum numero sem comparacao, sem farol ou sem acao.
// Tres faixas: (A) o que precisa de gente AGORA; (B) a semana em curso
// vs os MESMOS dias da semana passada (fato_pedidos, fresco toda manha);
// (C) o placar de metas da ultima semana fechada — so o que NAO esta
// verde, cada item com a acao de uma linha. Reusa computeMetrics,
// computeKpisSemana e farolKpi — formulas novas aqui seriam bug.
let HOME_PEND = null;

// 12/09/2026: a acao deixou de ser so' frase. Cada uma diz TAMBEM qual tela
// resolve, e o mesmo objeto vira botao nos dois lugares que mostram meta —
// "Esta semana" (faixa C) e "Indicadores". Uma fonte, dois lugares: acao escrita
// em dois lugares e' acao que um dia diverge.
// `modulo: null` = nao ha tela que resolva (a acao acontece no app do iFood):
// segue como frase, porque botao que nao abre nada ensina a nao clicar.
const HOME_ACAO = {
  liquido_semana:       { modulo: 'resumo',        rot: 'Resumo do canal',
                          texto: 'abrir o DRE e o "para onde foi o dinheiro" no Resumo do canal' },
  pedidos_semana:       { modulo: 'resumo',        rot: 'Resumo do canal',
                          texto: 'abrir o Resumo do canal e ver no ranking por loja quem puxou' },
  margem_pct:           { modulo: 'resumo',        rot: 'Resumo do canal',
                          texto: 'abrir o Resumo do canal — custo iFood e marketing explicam quase sempre' },
  nota_media:           { modulo: 'avaliacoes',    rot: 'Avaliações',
                          texto: 'abrir Avaliações, piores lojas primeiro, e ler os comentários' },
  pct_notas_ruins:      { modulo: 'avaliacoes',    rot: 'Avaliações',
                          texto: 'abrir Avaliações e tratar as lojas com ' + NOTA_RUIM_ROT + ' da semana' },
  taxa_cancelamento:    { modulo: 'cancelamentos', rot: 'Cancelamentos',
                          texto: 'abrir Cancelamentos e ver o motivo dominante da semana' },
  neg_sem_resposta_pct: { modulo: null,            rot: '',
                          texto: 'responder as negociações no app HOJE — silêncio vira cancelamento' },
  neg_atraso_pct:       { modulo: 'negociacoes',   rot: 'Negociações',
                          texto: 'reforçar os turnos de pico — abrir Negociações para ver onde dói' },
  mkt_por_pedido:       { modulo: 'promocoes',     rot: 'Promoções',
                          texto: 'abrir Promoções — o teste em curso mexe neste número' },
  alavancagem:          { modulo: 'promocoes',     rot: 'Promoções',
                          texto: 'abrir Promoções: cortar mecânicas que o iFood banca pouco' },
  roa_promo:            { modulo: 'promocoes',     rot: 'Promoções',
                          texto: 'abrir Promoções e comparar mecânicas — cortar as de pior retorno' },
};

// A acao ja normalizada — aceita a forma antiga (so' texto) sem quebrar.
function acaoDe(chave) {
  const a = HOME_ACAO[chave];
  if (!a) return null;
  return typeof a === 'string' ? { texto: a, modulo: null, rot: '' } : a;
}

// O botao: rotulo de UMA linha (o nome da tela); a frase inteira vai no title.
function acaoBotao(chave) {
  const a = acaoDe(chave);
  if (!a || !a.modulo) return '';
  return '<button class="preset-btn" onclick="mostrarModulo(&#39;' + a.modulo + '&#39;)" title="'
       + String(a.texto).replace(/"/g, '&quot;') + '">' + (a.rot || 'abrir') + ' →</button>';
}

// Sem tela, a frase continua sendo a acao.
function acaoTexto(chave) {
  const a = acaoDe(chave);
  return a ? a.texto : '—';
}

// A linha pronta para o card de KPI: botao quando ha tela, frase quando nao ha,
// e nada quando o KPI nao tem acao escrita.
function acaoLinha(chave) {
  const a = acaoDe(chave);
  if (!a) return '';
  return '<div style="margin-top:6px;">'
       + (acaoBotao(chave) || '<span style="font-size:12px; color:var(--tx-3);">' + a.texto + '</span>')
       + '</div>';
}

// ---------------- A FAIXA DE ALERTAS, compartilhada (12/09/2026) ----------------
// Era o bloco A da tela "Esta semana" e, na revisão dos módulos, a decisão foi que
// ela vira a barra de alertas do PLACAR. Em vez de copiar, virou função: as duas
// telas chamam a MESMA. Regra da casa — alerta duplicado é alerta que um dia diverge.
// Ela é a única coisa do painel que diz "faça isto agora", não "isto aconteceu".
async function carregarAlertas() {
  if (NEGOCIACOES === null) await entrarNegociacoesSoDados();
  if (AVALIACOES === null) await entrarAvaliacoesSoDados();
  if (HOME_PEND === null) {
    const [pend, rot, concFresh] = await Promise.all([
      consultarTudo('vw_contestacoes_status?select=id_curto,nome_loja,valor,contestavel_ate,automatizavel&bloco=eq.A_CONTESTAR'),
      consultarTudo('vw_rotinas_status?select=rotina,status,inicio,resumo'),
      consultarTudo('mv_conciliacao_agregado?select=data&order=data.desc&limit=1'),
    ]);
    HOME_PEND = { pend, rot, concAte: concFresh.length ? concFresh[0].data : null };
  }
}

function alertasAgora() {
  if (!HOME_PEND || AVALIACOES === null || NEGOCIACOES === null) return null;
  const hoje = new Date(); hoje.setHours(0, 0, 0, 0);
  const ddmm = (v) => v ? String(v).slice(8, 10) + '/' + String(v).slice(5, 7) : '—';
  const pendManual = HOME_PEND.pend.filter(r => !r.automatizavel);
  const pendValor = pendManual.reduce((s, r) => s + Number(r.valor || 0), 0);
  const prazoMin = pendManual.map(r => r.contestavel_ate).filter(Boolean).sort()[0] || null;
  const rotinasRuins = HOME_PEND.rot.filter(r => r.status === 'FALHOU' || r.status === 'TRAVADA');
  const maxAv = AVALIACOES.length ? AVALIACOES.reduce((m, r) => r[1] > m ? r[1] : m, '') : null;
  const maxNeg = NEGOCIACOES.length ? NEGOCIACOES.reduce((m, r) => r[1] > m ? r[1] : m, '') : null;
  const idade = (v) => v ? Math.floor((hoje - new Date(String(v).slice(0, 10) + 'T00:00:00')) / 864e5) : null;

  const agora = [];
  if (pendManual.length) agora.push({ cor: '#ff6b6b', link: 'contestacoes',
    txt: '<b>Contestar à mão no portal:</b> ' + pendManual.length + ' pedido(s), R$ ' + fmt(pendValor) +
         (prazoMin ? ' — prazo mais curto ' + ddmm(prazoMin) : '') });
  if (rotinasRuins.length) agora.push({ cor: '#ff6b6b', link: 'rotinas',
    txt: '<b>Rotina com problema:</b> ' + rotinasRuins.map(r => {
      const m = String(r.resumo || '').match(/FALHOU:\s*([^;]+)/);
      return r.rotina + (m ? ' — não atualizou: ' + m[1].trim() : ' (' + r.status + ')');
    }).join(', ') });
  // Avaliações (desde a troca de fonte, 06/10/2026): vêm da API Review na importação diária
  // das 07:00 (e nas leituras extras, quando instaladas). A data é o dia do PEDIDO; a API
  // mostra a avaliação ~1 dia depois de feita: medido em 06/10, a idade era 2 logo depois da
  // carga e é 3 na manhã seguinte, antes de a carga terminar. Corte 4 (5+ dias = a importação
  // não trouxe) até haver 2 semanas de medição; com 3 o aviso acenderia em manhã normal ou
  // feriado. Loja parada sozinha e carga com falha aparecem antes, em Sistema → Rotinas.
  // Negociações seguem na rotina de TERÇA 14:00 (semana fechada): até 8 dias é o normal na
  // segunda; 9+ = a rotina de terça falhou.
  if (idade(maxAv) !== null && idade(maxAv) > 4) agora.push({ cor: '#f5a623', link: 'avaliacoes',
    txt: '<b>Fonte parada:</b> avaliações vão só até ' + ddmm(maxAv) + ' — a importação diária das 07:00 não trouxe; ver Sistema → Rotinas' });
  if (idade(maxNeg) !== null && idade(maxNeg) > 9) agora.push({ cor: '#f5a623', link: 'negociacoes',
    txt: '<b>Fonte parada:</b> negociações vão só até ' + ddmm(maxNeg) + ' — a rotina de terça 14:00 não trouxe; ver Sistema → Rotinas' });
  return agora;
}

function blocoAlertas(semLink) {
  const todos = alertasAgora();
  const agora = (todos && semLink) ? todos.filter(a => a.link !== semLink) : todos;
  if (agora === null) return '';
  return agora.length
    ? agora.map(a => '<div class="contexto" style="border-color:' + a.cor + '; margin-bottom:8px;' + (a.link ? ' cursor:pointer;' : '') + '"' +
        (a.link ? ' onclick="mostrarModulo(\'' + a.link + '\')"' : '') + '>' + a.txt + '</div>').join('')
    : '<div class="contexto" style="border-color:#3fb950;">Nada esperando ação sua neste momento. ✔</div>';
}

// A FAIXA C da Esta semana virou funcao em 15/10/2026: a Hoje na rede mostra a MESMA
// tabela de metas (regra da casa: o mesmo numero se calcula num lugar so). `titulo(ini, fim)`,
// quando vem, troca so o titulo. Texto movido sem mudar uma conta.
function blocoMetasSemanaFechada(titulo) {
  const iso = (d) => d.toISOString().slice(0, 10);
  const ddmm = (v) => v ? v.slice(8, 10) + '/' + v.slice(5, 7) : '—';
  // ---------- FAIXA C: placar da ultima semana fechada ----------
  const sem = ultimaSemanaCompleta();
  const antFim = new Date(sem.ini + 'T00:00:00'); antFim.setDate(antFim.getDate() - 1);
  const antIni = new Date(antFim); antIni.setDate(antIni.getDate() - 6);
  const atualK = computeKpisSemana(sem.ini, sem.fim);
  const antK = computeKpisSemana(iso(antIni), iso(antFim));

  const chips = (METAS_KPI || []).map(k => {
    const v = atualK[k.chave];
    const [cor, rotulo] = farolKpi(k, v);
    return { k, v, cor, rotulo, ant: antK[k.chave] };
  });
  const verdes = chips.filter(c => c.cor === '#3fb950').length;
  const atencao = chips.filter(c => c.cor !== '#3fb950');
  const nContam = chips.filter(c => !metaSoRede(c.k)).length;

  const concIncompleta = HOME_PEND.concAte && HOME_PEND.concAte < sem.fim;
  const avisoConc = concIncompleta
    ? '<div class="contexto" style="border-color:#f5a623;">Conciliação só até <b>' + ddmm(HOME_PEND.concAte) +
      '</b> — líquido, margem e marketing da semana fechada estão PROVISÓRIOS até o iFood liberar o ciclo (baixar o zip de agosto na sexta).</div>'
    : '';

  // A coluna "vs anterior" diz o FATO (subiu/caiu). Quem diz se isso e' bom ou ruim e' o
  // SENTIDO da meta, nunca o sinal da variacao: em meta "abaixo" (cancelamento, marketing
  // por pedido) subir e' piorar; em "acima" (nota, alavancagem) e' o contrario; em "faixa"
  // o que vale e' ter chegado mais perto ou mais longe dela. Por isso a marca compara
  // DISTANCIAS ate a meta, e nao os dois valores.
  const distDaMeta = (k, v) => {
    if (v === null || v === undefined) return null;
    const m = Number(k.meta);
    const m2 = (k.meta2 === null || k.meta2 === undefined || k.meta2 === '') ? null : Number(k.meta2);
    if (k.sentido === 'abaixo') return Math.max(0, v - m);
    if (k.sentido === 'acima') return Math.max(0, m - v);
    return Math.max(0, m - v, m2 === null ? 0 : v - m2);   // faixa: o quanto ficou fora dela
  };
  const marcaRumo = (c) => {
    // na visao Rede as metas nao valem (mesma regra de farolKpi) — sem regua, sem rumo
    if ((typeof PERIMETRO !== 'undefined' && PERIMETRO === 'rede') || metaSoRede(c.k)) return '';
    const da = distDaMeta(c.k, c.v), db = distDaMeta(c.k, c.ant);
    if (da === null || db === null) return '';
    const dif = da - db;
    if (Math.abs(dif) < Math.abs(Number(c.k.meta) || 1) * 0.005) return '';   // meio por cento da meta e' ruido
    const piorou = dif > 0;
    return ' <b style="color:var(--farol-' + (piorou ? 'fora' : 'ok') + ');"'
      + ' title="Comparado com a distância da meta na semana anterior.">'
      + (piorou ? 'piorou' : 'melhorou') + '</b>';
  };
  const linhasAtencao = atencao.length
    ? atencao.map(c =>
        '<tr><td><span class="dre-farol" style="background:' + c.cor + ';"></span>' + nomeMeta(c.k) + '</td>' +
        '<td>' + fmtKpi(c.k.unidade, c.v) + '</td>' +
        '<td>' + (metaSoRede(c.k) ? 'só da Rede' : fmtKpi(c.k.unidade, Number(c.k.meta)) + (c.k.meta2 !== null && c.k.meta2 !== undefined && c.k.meta2 !== '' ? ' a ' + fmtKpi(c.k.unidade, Number(c.k.meta2)) : '')) + '</td>' +
        '<td style="font-size:11.5px;">' + (c.ant === null || c.ant === undefined || c.v === null || c.v === undefined || !c.ant
          ? '—' : ((c.v - c.ant) / Math.abs(c.ant) * 100 >= 0 ? 'subiu' : 'caiu') + ' ' + Math.abs((c.v - c.ant) / Math.abs(c.ant) * 100).toFixed(1).replace('.', ',') + '%' + marcaRumo(c)) + '</td>' +
        '<td style="font-size:11.5px; color:#c3c2b7;">' + (acaoBotao(c.k.chave) || acaoTexto(c.k.chave)) + '</td></tr>'
      ).join('')
    : '';

  const blocoPlacar =
    '<div class="section-label">' + (titulo ? titulo(sem.ini, sem.fim) : 'Semana fechada ' + ddmm(sem.ini) + ' a ' + ddmm(sem.fim) + ' — o que pede atenção') + '</div>' +
    avisoConc +
    '<div class="contexto" style="border-color:#3fb950;"><b>' + verdes + ' de ' + nContam + ' metas no verde.</b> ' +
    (atencao.length ? 'As que não estão:' : 'Semana limpa — nada fora da meta.') + '</div>' +
    (atencao.length
      ? '<div id="tabelaHomeAtencao" class="cel-cartao"><table><tr><th>Meta</th><th>Semana</th><th>Alvo</th><th>vs anterior</th><th>O que fazer</th></tr>' + linhasAtencao + '</table></div>'
      : '') +
    '<div style="text-align:center; margin-top:10px;"><button class="navbtn" onclick="mostrarModulo(\'indicadores\')">placar completo de metas</button> ' +
    '<button class="navbtn" onclick="mostrarModulo(\'relatorios\')">resumo semanal</button></div>';
  return blocoPlacar;
}

// ==================================================================
//  HOJE NA REDE (15/10/2026) — a tela inicial da Gestao
//
//  Pedido do dono (15/10): o painel e' confuso "ate pra mim", e tem de se dividir em telas
//  que LANCAM (operacao) e telas que ACOMPANHAM e apontam correcao de rumo. Esta e' a
//  primeira tela do segundo tipo: a rede inteira numa pagina, de cima para baixo —
//  o que pede gente agora, a venda da semana de TODOS os canais, o caixa e as metas.
//
//  NAO TEM CONTA PROPRIA. Cada bloco le o que outra tela ja calcula:
//    alertas  -> blocoAlertas('rotinas')   (a faixa da Esta semana e do Placar, sem o de rotina)
//    venda    -> EVOL / vw_venda_evolucao  (a base da Evolucao de vendas, campo total)
//    caixa    -> projCalc('')              (os cartoes do Fluxo projetado, mesmos nomes)
//    rumo     -> plcAgrega / plcMeta       (o Placar = a DRE, por loja e Rede) + fin_meta_venda_loja
//    metas    -> blocoMetasSemanaFechada() (a tabela da Esta semana, so iFood)
//  Numero que precise mudar muda LA; esta tela acompanha sozinha.
//
//  So abre pela casca (docs/sistema.html) ate o dono validar: nao ha botao no menu deste
//  painel. Ver contexto/project_painel_em_modulos.md.
// ==================================================================
async function entrarHoje() {
  const alvo = document.getElementById('view-hoje');
  if (!alvo) return;
  alvo.innerHTML = '<div class="contexto">Montando o dia da rede...</div>';
  if (METAS_KPI === null) {
    try { METAS_KPI = await consultarTudo('metas_kpi?select=chave,nome,bloco,sentido,meta,meta2,unidade,descricao,ordem&ativo=eq.true&order=ordem'); }
    catch (e) { METAS_KPI = []; }
  }
  // cada fonte carrega sozinha: uma que falhe vira aviso no proprio bloco, nao derruba a tela.
  // O CAIXA e os ALERTAS se leem de novo a cada entrada (dono, 15/10: "a conciliação bancária e o
  // contas a pagar impactam totalmente nessa tela, precisava que ela atualizasse conforme esses
  // dois módulos avançam durante o dia"). Venda e semana fechada mudam uma vez por dia: cache.
  HOME_PEND = null;
  const erros = {};
  // 07/11/2026 (auditoria resultado-20/21): o ultimo dia completo e os dias de loja fechada, antes da venda
  await Promise.all([cargaDiaLer(), abertoDiaLer()]);
  await Promise.all([
    carregarAlertas().catch(e => { erros.alertas = e.message; }),
    (EVOL === null || evolVelho()
      ? consultarTudo('vw_venda_evolucao?select=data,unidade,canal,faixa,pedidos,total,canceladas,total_cancelado&order=data').then(r => { EVOL = r; EVOL_LIDO_EM = Date.now(); })
      : Promise.resolve()).catch(e => { erros.venda = e.message; }),
    // o motor do Fluxo projetado (sem desenhar a tela dele); daqui so se le o projCalc
    projCarregar().catch(e => { erros.caixa = e.message; }),
    // o mes da DRE (o mesmo do Placar e do Fechamento) e a meta de venda por loja
    (!FX_M ? fxCarregarM() : Promise.resolve()).catch(e => { erros.rumo = e.message; }),
    (HOJE_META_VENDA === null
      ? consultarTudo('fin_meta_venda_loja?select=unidade,vale_desde,receita_mes,resultado_meta_pct&order=vale_desde').then(r => { HOJE_META_VENDA = r; })
      : Promise.resolve()).catch(e => { erros.rumo = e.message; }),
    hojeLerFrescor().catch(() => {}),
    hojeLerFilas().catch(e => { erros.filas = e.message; }),
  ]);
  HOJE_ERROS = erros;
  HOJE_CONFERIDO = new Date();
  renderHoje();
  hojeLigarRelogio();
}

let HOJE_ERROS = {};

let HOJE_FRESCOR = null, HOJE_CONFERIDO = null, HOJE_RELOGIO = null, HOJE_META_VENDA = null;

// QUEM PRECISA FAZER O QUE (dono, 15/10/2026): o que esta aberto em cada fila (vw_painel_fila_hoje,
// que le as views das proprias telas) e quem cuida de cada uma (painel_fila_dono, respostas dele
// no artefato "Dono de cada fila"). Nome de pessoa e' DADO: nunca escrever nome aqui no codigo.
let HOJE_FILAS = null, HOJE_DONOS = null;

async function hojeLerFilas() {
  const [f, d] = await Promise.all([
    consultarTudo('vw_painel_fila_hoje?select=fila,unidade,qtd,valor,desde,detalhe&order=fila'),
    consultarTudo('painel_fila_dono?select=fila,unidade,rotulo,pessoa,observacao,tela'),
  ]);
  HOJE_FILAS = f; HOJE_DONOS = d;
}

// De quando e' o caixa: a hora da ultima carga do extrato do banco e dos lancamentos do Saipos
// (vw_painel_frescor, uma linha, 0,04 s). E' isto que a tela vigia.
async function hojeLerFrescor() {
  const r = await consultarTudo('vw_painel_frescor?select=extrato_em,lancamentos_em');
  HOJE_FRESCOR = r[0] || null;
}

// A cada 5 minutos, com a tela aberta e a aba visivel: pergunta ao banco de quando e' o extrato e
// o contas a pagar; se uma das duas horas mudou, rele o caixa e os alertas e redesenha. Sem
// mudanca, so atualiza a hora da conferencia. Um relogio so, ligado na primeira entrada.
async function hojeAtualizarAgora(forcar) {
  const antes = JSON.stringify(HOJE_FRESCOR);
  try { await hojeLerFrescor(); } catch (e) {}
  if (forcar || JSON.stringify(HOJE_FRESCOR) !== antes) {
    HOME_PEND = null;
    const [rc, ra] = await Promise.allSettled([projCarregar(), carregarAlertas()]);
    HOJE_ERROS.caixa = rc.status === 'rejected' ? rc.reason.message : null;
    HOJE_ERROS.alertas = ra.status === 'rejected' ? ra.reason.message : null;
  }
  // as filas de trabalho mudam o dia todo e a consulta e' leve (0,7 s): rele sempre
  try { await hojeLerFilas(); HOJE_ERROS.filas = null; } catch (e) { HOJE_ERROS.filas = e.message; }
  HOJE_CONFERIDO = new Date();
  if (MODULO_ATUAL === 'hoje') renderHoje();
}

function hojeLigarRelogio() {
  if (HOJE_RELOGIO) return;
  HOJE_RELOGIO = setInterval(() => {
    if (MODULO_ATUAL === 'hoje' && !document.hidden) hojeAtualizarAgora(false).catch(() => {});
  }, 5 * 60000);
}

function hojeVendaSemana() {
  if (!EVOL || !EVOL.length) return null;
  // 07/11/2026 (auditoria resultado-20): a semana vai ate o ultimo dia COMPLETO da carga do Saipos,
  // nao ate "ontem" (de madrugada o ontem ainda esta pela metade). Na segunda (ou enquanto o domingo
  // nao fechou) mostra a semana passada.
  const fimIso = cargaUltimoDia('saipos');
  const iniIso = fxSegunda(fimIso);
  const emCurso = iniIso === fxSegunda(trHoje());
  const menos7 = (s) => fxSomaDias(s, -7);
  const UN = [['AGUA VERDE', 'Água Verde'], ['AHU', 'Ahú'], ['SÃO BRAZ', 'São Braz']];
  // a VENDA e' a real (todos os dias); a VARIACAO so com os dias em que a loja abriu nas DUAS semanas
  // (auditoria resultado-21, regra §C3: o Ahu abriu 6 dias numa semana e 5 na outra e "subiu 9,2%",
  // quando nos dias abertos dos dois lados caiu 8,1%).
  const somar = (u, a, b, so) => EVOL.reduce((acc, r) => {
    if (r.unidade !== u || r.data < a || r.data > b || (so && !so(r.data))) return acc;
    acc.t += Number(r.total || 0); acc.p += Number(r.pedidos || 0); return acc;
  }, { t: 0, p: 0 });
  const linhas = UN.map(([u, nome]) => {
    // loja com dado atrasado compara so ate o ultimo dia que tem, nos dois periodos
    const ult = EVOL.reduce((m, r) => (r.unidade === u && r.data > m ? r.data : m), '');
    const ate = ult && ult < fimIso ? ult : fimIso;
    const par = (d) => lojaAbriu(u, d) && lojaAbriu(u, menos7(d));
    const parAnt = (d) => lojaAbriu(u, d) && lojaAbriu(u, fxSomaDias(d, 7));
    const a = somar(u, iniIso, ate), b = somar(u, menos7(iniIso), menos7(ate));
    const ca = somar(u, iniIso, ate, par), cb = somar(u, menos7(iniIso), menos7(ate), parAnt);
    const fora = [];
    for (let d = iniIso; d <= ate; d = fxSomaDias(d, 1)) if (!par(d) && (lojaAbriu(u, d) || lojaAbriu(u, menos7(d)))) fora.push(d);
    return { u, nome, a, b, ca, cb, fora, ate, atrasada: ate < fimIso };
  });
  const soma2 = (k) => linhas.reduce((x, l) => ({ t: x.t + l[k].t, p: x.p + l[k].p }), { t: 0, p: 0 });
  const rede = { a: soma2('a'), b: soma2('b'), ca: soma2('ca'), cb: soma2('cb') };
  return { iniIso, fimIso, emCurso, linhas, rede };
}

// Feriado dentro de um dos dois periodos explica o salto antes de alguem ler como
// crescimento: em 12/10/2026 (segunda, feriado) a Agua Verde vendeu R$ 30,2 mil contra
// R$ 11,8 mil na segunda anterior, e a semana "subiu 52%". Aviso curto e so quando acontece.
// Os feriados vem da tabela `feriados`, a mesma que o Fluxo projetado le (PROJ_FERIADOS).
function hojeFeriadoNota(V) {
  const F = (typeof PROJ_FERIADOS === 'object' && PROJ_FERIADOS) || {};
  const menos7 = (s) => { const d = new Date(s + 'T12:00:00'); d.setDate(d.getDate() - 7); return d.toISOString().slice(0, 10); };
  const SEM = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb'];
  const rot = (d) => SEM[new Date(d + 'T12:00:00').getDay()] + ' ' + d.slice(8, 10) + '/' + d.slice(5, 7);
  const achou = Object.keys(F).filter(d => (d >= V.iniIso && d <= V.fimIso) || (d >= menos7(V.iniIso) && d <= menos7(V.fimIso))).sort();
  if (!achou.length) return '';
  return '<div class="caption-label" style="text-align:center; color:var(--farol-perto);">Feriado na comparação: ' +
    achou.map(d => rot(d) + ' (' + F[d] + ')' + (d >= V.iniIso ? '' : ', na semana anterior')).join(' · ') +
    ' — a diferença vem em boa parte dele.</div>';
}

function renderHoje() {
  const alvo = document.getElementById('view-hoje');
  if (!alvo) return;
  const SEM = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb'];
  const ddmm = (v) => v ? v.slice(8, 10) + '/' + v.slice(5, 7) : '—';
  const diaRot = (v) => SEM[new Date(v + 'T12:00:00').getDay()] + ' ' + ddmm(v);
  const hojeIso = new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 10);
  const aviso = (txt) => '<div class="contexto" style="border-color:var(--farol-perto);">' + txt + '</div>';
  // palavra do fato, separada do juizo (regra da casa) — a mesma frase da Evolucao de vendas
  const varTxt = (a, b) => {
    if (!b) return '<span style="color:var(--tx-6);">sem base</span>';
    const v = (a - b) / Math.abs(b) * 100;
    return Math.abs(v) < 0.05 ? 'ficou igual' : (v > 0 ? 'subiu ' : 'caiu ') + Math.abs(v).toFixed(1).replace('.', ',') + '%';
  };
  const botao = (modulo, rot) => '<button class="preset-btn" onclick="mostrarModulo(\'' + modulo + '\')">' + rot + ' →</button>';

  // ---------- 1. quem precisa fazer o que (no lugar do "Precisa de voce agora") ----------
  // Dono, 15/10/2026: "um resumo do que depende de cada um e ações que devem ser feitas". Um cartao
  // por pessoa, so com o que esta ABERTO; cada linha leva para a tela onde se resolve. Os avisos de
  // fonte parada (avaliacoes, negociacoes) que nao sao fila de ninguem continuam embaixo, curtos.
  let b1;
  if (HOJE_ERROS.filas || !HOJE_FILAS || !HOJE_DONOS) {
    b1 = '<div class="section-label" style="border-top:none; margin-top:0; padding-top:0;">Quem precisa fazer o quê</div>' +
      aviso('Não consegui ler as filas de trabalho' + (HOJE_ERROS.filas ? ': ' + HOJE_ERROS.filas : '.'));
  } else {
    const NOME_U = { 'AGUA VERDE': 'Água Verde', 'AHU': 'Ahú', 'SÃO BRAZ': 'São Braz', 'BOQUEIRAO': 'Boqueirão' };
    const donoDe = (fila, u) => HOJE_DONOS.find(d => d.fila === fila && d.unidade === (u || '')) || HOJE_DONOS.find(d => d.fila === fila && d.unidade === '');
    const porPessoa = {};
    HOJE_FILAS.filter(f => !f.unidade || !finVazio() || f.unidade === finVazio()).forEach(f => {
      const d = donoDe(f.fila, f.unidade);
      const p = d ? d.pessoa : 'Sem dono';
      (porPessoa[p] = porPessoa[p] || []).push({ f, d });
    });
    const um = (v) => Number(v).toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
    const linha = ({ f, d }) => {
      const tela = d && d.tela;
      const loja = f.unidade ? NOME_U[f.unidade] || f.unidade : '';
      const desde = f.desde ? ' · desde ' + ddmm(String(f.desde).slice(0, 10)) : '';
      const valor = f.valor ? ' · R$ ' + (Math.abs(f.valor) >= 1000 ? um(f.valor / 1000) + ' mil' : fmt(f.valor)) : '';
      return '<div' + (tela ? ' onclick="mostrarModulo(\'' + tela + '\')" style="cursor:pointer;"' : '') +
        ' title="' + (d ? (d.rotulo + (d.observacao ? ' · ' + d.observacao : '')).replace(/"/g, '&quot;') : '') + (tela ? ' — clique para abrir a tela' : '') + '"' +
        ' class="hoje-fila-linha"><b>' + f.qtd + '</b> ' + (Number(f.qtd) === 1 ? String(f.detalhe).replace(/\((n?s)\)/g, '') : String(f.detalhe).replace(/m\(ns\)/g, 'ns').replace(/\(s\)/g, 's')) + (loja ? ' · <b>' + loja + '</b>' : '') + desde + valor + (tela ? ' →' : '') + '</div>';
    };
    const pessoas = Object.keys(porPessoa).sort((a, b) => porPessoa[b].length - porPessoa[a].length || a.localeCompare(b));
    const cartoes = pessoas.map(p => '<div class="card neutral hoje-fila-card"><div class="card-lbl">' + p + '</div>' +
      porPessoa[p].map(linha).join('') + '</div>').join('');
    // os avisos que nao sao fila de ninguem (fonte de dado parada) continuam, curtos
    const extras = (alertasAgora() || []).filter(a => !['rotinas', 'contestacoes'].includes(a.link));
    b1 = '<div class="section-label" style="border-top:none; margin-top:0; padding-top:0;">Quem precisa fazer o quê · o que está aberto agora</div>' +
      (pessoas.length ? '<div class="hoje-filas">' + cartoes + '</div>'
                      : '<div class="contexto" style="border-color:var(--farol-ok);">Nada esperando ninguém agora. ✔</div>') +
      extras.map(a => '<div class="contexto" style="border-color:' + a.cor + '; margin-top:8px;' + (a.link ? ' cursor:pointer;' : '') + '"' +
        (a.link ? ' onclick="mostrarModulo(\'' + a.link + '\')"' : '') + '>' + a.txt + '</div>').join('');
  }

  // ---------- 2. venda da semana, todos os canais ----------
  let b2;
  const V = HOJE_ERROS.venda ? null : hojeVendaSemana();
  if (!V) b2 = aviso('Não consegui ler a venda' + (HOJE_ERROS.venda ? ': ' + HOJE_ERROS.venda : '.'));
  else {
    // a venda e' a real; a variacao compara so os dias em que a loja abriu nas duas semanas (ca × cb)
    const linha = (nome, a, ca, cb, nota, forte) =>
      '<tr' + (forte ? ' class="liq"' : '') + '><td>' + nome + (nota ? ' <span style="color:var(--tx-5); font-size:11px;">' + nota + '</span>' : '') + '</td>' +
      '<td>R$ ' + fmt(a.t) + '<span class="so-cel">médio ' + (a.p ? 'R$ ' + fmt(a.t / a.p) : '—') + '</span></td><td>' + varTxt(ca.t, cb.t) + '</td>' +
      '<td>' + fxInt(a.p) + '</td><td>' + (a.p ? 'R$ ' + fmt(a.t / a.p) : '—') + '</td></tr>';
    // O QUE E' REDE E O QUE E' SO iFOOD VAI NO TITULO (dono, 15/10: a letra miuda ao lado "as
    // vezes passa batido por quem está lendo").
    b2 = '<div class="section-label">Venda ' + (V.emCurso ? 'da semana' : 'da semana passada') + ' · ' + (finVazio() ? lojaNome(finVazio()) : 'Rede e lojas') + ' · todos os canais · ' +
      diaRot(V.iniIso) + ' a ' + diaRot(V.fimIso) + '</div>' +
      '<div id="tabelaHojeVenda"><table><tr><th>Loja</th><th>Venda</th><th title="Os mesmos dias da semana anterior">vs semana anterior</th><th>Pedidos</th><th>Valor médio</th></tr>' +
      V.linhas.filter(l => !finVazio() || l.u === finVazio()).map(l => linha(l.nome, l.a, l.ca, l.cb,
        [l.atrasada ? 'dados até ' + ddmm(l.ate) : '', l.fora.length ? 'variação sem ' + l.fora.map(diaRot).join(', ') + ' (fechada numa das semanas)' : ''].filter(Boolean).join(' · '))).join('') +
      (finVazio() ? '' : linha('Rede (as três)', V.rede.a, V.rede.ca, V.rede.cb, '', true)) + '</table></div>' +
      hojeFeriadoNota(V) +
      '<div style="text-align:center; margin-top:8px;">' + botao('evolucao', 'Evolução de vendas') + '</div>';
  }

  // ---------- 3. caixa da rede ----------
  let b3;
  if (HOJE_ERROS.caixa || !PROJ_PAGAR || !PROJ_RECEB) b3 = '<div class="section-label">Caixa da rede</div>' + aviso('Não consegui ler o caixa' + (HOJE_ERROS.caixa ? ': ' + HOJE_ERROS.caixa : '.'));
  else {
    // 07/11/2026 (auditoria resultado-17, dinheiro-0, dinheiro-4): o caixa de hoje e o menor saldo vêm do
    // Fluxo projetado (fxlResumo, o mesmo numero do quadro e do grafico de la). O projCalc fica so para o
    // "A pagar (30 dias)" e a regua da cor. Sem o Fluxo, a conta de antes.
    const comFluxo = (u, Q) => {
      const F = fxlResumo(u || 'REDE');
      return F ? Object.assign({}, Q, { caixaOper: F.saldoInicial, caixaFimHoje: F.saldoFimHoje, menorSaldo: F.menorSaldo, menorDia: F.menorDia,
                                        dataExtrato: F.dataPartida, temAncora: true, doFluxo: true }) : Q;
    };
    const P = comFluxo(PROJ_RECEB_LOJA ? finVazio() : '', projCalc(PROJ_RECEB_LOJA ? finVazio() : ''));
    // a MESMA cor do cartao do Fluxo projetado: negativo = fora; abaixo de uma semana de receita = perto
    const corDe = (Q) => Q.menorSaldo < 0 ? 'var(--farol-fora)' : Q.menorSaldo < Q.mediaSemana ? 'var(--farol-perto)' : 'var(--farol-ok)';
    const corMenor = corDe(P);
    // POR LOJA (dono, 15/10/2026: "o Caixa de Rede é importante, mas eu ver diariamente o caixa por
    // loja também"). O mesmo projCalc, com a loja — é o que o "Saldo dia a dia" do Fluxo projetado
    // usa no seletor de loja. Só existe quando a receita por loja fecha com a da rede
    // (PROJ_RECEB_LOJA); se não fechar, a tabela some e fica só a rede, como lá.
    // O menor saldo da Rede NÃO é a soma das lojas: cada uma tem o seu pior dia, e o que as filiais
    // devem à Água Verde (listas, benefício) não é dinheiro novo na Rede (regra de 07/10).
    let tabLojas = '';
    if (PROJ_RECEB_LOJA && !finVazio()) {
      const lojas = [['AGUA VERDE', 'Água Verde'], ['AHU', 'Ahú'], ['SÃO BRAZ', 'São Braz']].map(([u, nome]) => ({ nome, Q: comFluxo(u, projCalc(u)) }));
      const lin = (nome, Q, forte) => '<tr' + (forte ? ' class="liq"' : '') + '><td>' + nome + '</td>' +
        '<td style="color:' + (Q.caixaOper < -0.005 ? 'var(--farol-fora)' : 'inherit') + ';">R$ ' + fmt(Q.caixaOper) + '</td>' +
        '<td style="color:' + corDe(Q) + '; font-weight:700;">R$ ' + fmt(Q.menorSaldo) + '</td><td>' + diaRot(Q.menorDia) + '</td></tr>';
      tabLojas = '<div id="tabelaHojeCaixa" style="margin-top:10px;"><table><tr><th>Loja</th><th>Caixa hoje</th><th>Menor saldo projetado</th><th>em</th></tr>' +
        lojas.map(l => lin(l.nome, l.Q)).join('') + lin('Rede (as três)', P, true) + '</table></div>';
    }
    // de quando e' o numero: as duas cargas que mexem no caixa, e a hora da ultima conferencia
    const hm = (v) => {
      if (!v) return '—';
      const d = new Date(v), hoje = new Date();
      const h = d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', timeZone: 'America/Sao_Paulo' });
      return d.toDateString() === hoje.toDateString() ? 'às ' + h : 'em ' + d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', timeZone: 'America/Sao_Paulo' }) + ' ' + h;
    };
    const frescor = '<div class="caption-label" style="text-align:center;">Atualiza sozinho durante o dia · extrato do banco lido ' +
      hm(HOJE_FRESCOR && HOJE_FRESCOR.extrato_em) + ' · contas a pagar (Saipos) ' + hm(HOJE_FRESCOR && HOJE_FRESCOR.lancamentos_em) +
      ' · conferido ' + hm(HOJE_CONFERIDO) +
      ' <button class="preset-btn" onclick="hojeAtualizarAgora(true)" title="Ler o caixa de novo agora">↻ atualizar agora</button></div>';
    b3 = '<div class="section-label">Caixa · ' + (finVazio() ? lojaNome(finVazio()) : 'Rede e lojas') + '</div>' + finSoRede() + frescor + '<div class="cards">' +
      '<div class="card blue"><div class="card-lbl">' + (P.doFluxo ? 'Caixa hoje · saldo inicial' : 'Caixa operacional hoje') + '</div><div class="card-val">R$ ' + fmt(P.caixaOper) + '</div>' +
        '<div class="card-pct">' + (P.doFluxo ? 'fim de ' + ddmm(P.dataExtrato) + ' (último extrato completo) · o mesmo do Fluxo projetado'
          : P.temAncora && P.dataExtrato ? 'extrato do banco de ' + ddmm(P.dataExtrato) : 'pelo Saipos') + '</div></div>' +
      '<div class="card ' + (P.vencidas > 0.005 ? 'neg' : '') + '"><div class="card-lbl">A pagar (30 dias)</div><div class="card-val">R$ ' + fmt(P.pagar30) + '</div>' +
        (P.vencidas > 0.005 ? '<div class="card-pct" style="color:var(--farol-fora);">R$ ' + fmt(P.vencidas) + ' vencidas de verdade!</div>' : '<div class="card-pct">nada vencido</div>') + '</div>' +
      '<div class="card" style="border-color:' + corMenor + ';"><div class="card-lbl">Menor saldo projetado</div>' +
        '<div class="card-val" style="color:' + corMenor + ';">R$ ' + fmt(P.menorSaldo) + '</div><div class="card-pct">em ' + diaRot(P.menorDia) + '</div></div>' +
      '</div>' + tabLojas + '<div style="text-align:center; margin-top:8px;">' + botao('projecao', 'Fluxo projetado') + ' ' + botao('contaspagar', 'Contas a pagar') + '</div>';
  }

  // ---------- 4. INDICADORES DE RUMO, por loja e Rede ----------
  // Dono, 15/10/2026: "tem que andar junto com os indicadores que necessitam de ação para corrigir
  // rumos errados, CMV é um deles, acredito que CMO seja outro, mostrar a margem final parcial ali
  // gera uma sensação que está sobrando mais dinheiro do que realmente está". A margem da semana saiu.
  // DUAS TABELAS, uma por janela, com a janela no TITULO (dono, 15/10: "a informação do mês corrente
  // e mês fechado tinha que aparecer com mais destaque, talvez no proprio titulo"):
  //  - MES EM ANDAMENTO: o realizado ate ontem (caixa das lojas) e a previsao ate o fim do mes. A DRE
  //    do mes aberto nao se le no meio do mes (em 15/10 a AV aparecia com 50% de pessoal e o Ahu com
  //    0,3% de CMV — a lista e' cobrada com atraso). Previsto = caixa ate ontem + ritmo das ultimas 4
  //    semanas ate o fim do mes + outras receitas (listas e atacado, so a AV) na media dos 3 meses
  //    fechados. CMO estimado = pessoal medio dos 3 meses fechados ÷ receita prevista.
  //  - ULTIMO MES FECHADO: a conta do Placar (plcAgrega), que e' a DRE — na Rede sem a lista entre lojas.
  // Lojas nas LINHAS, como na venda e no caixa: cabe na tela sem rolar para o lado (dono, 15/10).
  // Meta de receita = fin_meta_venda_loja (dono, 15/10: "a meta de venda sai do CMV de hoje"); na
  // Rede, a soma das lojas menos a lista entre lojas (media dos 3 meses), porque la ela nao conta.
  // O CMV do DIA (orcamento de compra do mes) e' do modulo de compras: ate ele entregar, a coluna diz.
  let b4s;
  try {
    if (HOJE_ERROS.rumo || !FX_M) throw new Error(HOJE_ERROS.rumo || 'sem dados');
    const um = (v) => Number(v).toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
    const mil1 = (v) => 'R$ ' + um(v / 1000) + ' mil';
    const fech = plcMesesFechados();
    const ult = fech[fech.length - 1], tres = fech.slice(-3);
    const MES = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];
    const nomeMes = (m) => MES[Number(String(m).slice(5, 7)) - 1] + '/' + String(m).slice(2, 4);
    const hojeD = new Date(); hojeD.setHours(12, 0, 0, 0);
    const isoD = (d) => d.toISOString().slice(0, 10);
    // 07/11/2026 (auditoria resultado-20): "ate ontem" = o ultimo dia COMPLETO da carga do Saipos
    const ontemIso = cargaUltimoDia('saipos');
    const mesIni = ontemIso.slice(0, 8) + '01';
    const fimMes = new Date(Number(ontemIso.slice(0, 4)), Number(ontemIso.slice(5, 7)), 0).getDate();
    const diaOntem = Number(ontemIso.slice(8, 10));
    const diasRest = fimMes - diaOntem;
    const corrido = diaOntem / fimMes * 100;
    const ritmoIni = fxSomaDias(ontemIso, -27);   // 28 dias completos, terminando no ultimo dia completo
    const pdv = (us, a, b) => (EVOL || []).reduce((s, r) => s + (us.includes(r.unidade) && r.data >= a && r.data <= b ? Number(r.total || 0) : 0), 0);
    const metaLoja = (u) => {
      const ms = (HOJE_META_VENDA || []).filter(m => m.unidade === u && m.vale_desde <= mesIni);
      return ms.length ? Number(ms[ms.length - 1].receita_mes) : null;
    };
    const unid = FX_TODAS;
    const linha = (u) => plcComLoja(u, () => {
      const us = u === 'REDE' ? unid : [u];
      const A = plcAgrega([ult]), T = plcAgrega(tres);
      const ateOntem = pdv(us, mesIni, ontemIso);
      const ritmoDia = pdv(us, ritmoIni, ontemIso) / 28;
      const outrasMes = T.outras / tres.length;
      const receitaPrev = ateOntem + ritmoDia * diasRest + outrasMes;
      // 07/11/2026 (auditoria resultado-22): a meta de pessoal e' % da receita da DRE, que tem a venda
      // CHEIA (caixa + promocao paga pela loja). O CMO estimado divide pela mesma base: o previsto do
      // caixa ganha a promocao na proporcao dos 3 meses fechados (venda cheia ÷ caixa). O "Previsto no
      // mes" fica como esta: a meta de venda (fin_meta_venda_loja) e' sem a promocao.
      const pdvTres = pdv(us, String(tres[0]).slice(0, 7) + '-01', String(tres[tres.length - 1]).slice(0, 7) + '-31');
      const fatorCheia = pdvTres > 0 && T.recBruta > pdvTres ? T.recBruta / pdvTres : 1;
      const receitaPrevDre = (ateOntem + ritmoDia * diasRest) * fatorCheia + outrasMes;
      const pct = (v) => A.base ? v / A.base * 100 : null;
      return {
        u, A, T, ateOntem, outrasMes, receitaPrev,
        cmoEst: receitaPrevDre ? Math.abs(T.grupos.PESSOAL) / tres.length / receitaPrevDre * 100 : null,
        cmv: pct(Math.abs(A.grupos.CUSTO)), cmo: pct(Math.abs(A.grupos.PESSOAL)),
        venda: pct(Math.abs(A.grupos.VENDA)), admin: pct(Math.abs(A.grupos.ADMIN)), res: pct(A.resultado),
      };
    });
    const L = unid.map(linha);
    const R = linha('REDE');
    const somaBaseLojas = L.reduce((s, l) => s + l.T.base, 0);
    const listaMedia = (somaBaseLojas - R.T.base) / tres.length;
    L.forEach(l => { l.meta = metaLoja(l.u); });
    R.meta = L.every(l => l.meta !== null) ? L.reduce((s, l) => s + l.meta, 0) - listaMedia : null;
    const cols = finVazio() ? L.filter(l => l.u === finVazio()) : L.concat([R]);
    const nomeU = lojaNome;
    // farol compacto: a cor no proprio numero e um ponto; o nome do farol no passar do mouse
    const COR = { ok: 'var(--farol-ok)', atencao: 'var(--farol-perto)', fora: 'var(--farol-fora)' };
    const farol = (txt, v, meta, sentido) => {
      if (v === null || v === undefined || meta === null || meta === undefined) return txt;
      const [k, rot] = fxFarol(v, meta, sentido);
      return '<span style="color:' + COR[k] + '; font-weight:700;" title="' + rot + '">● ' + txt + '</span>';
    };
    const sub = (t) => '<br><span style="font-weight:normal; text-transform:none;">' + t + '</span>';
    const tr = (c, cels) => '<tr' + (c.u === 'REDE' ? ' class="liq"' : '') + '><td>' + nomeU(c.u) + '</td>' + cels.map(x => '<td>' + x + '</td>').join('') + '</tr>';

    // ---- tabela 1: o mes em andamento ----
    const mPess = plcMeta('PESSOAL', [ult]);
    const t1 = '<div class="section-label">' + nomeMes(mesIni) + ' · mês em andamento · realizado até ' + ddmm(ontemIso) + ' e previsão até o fim do mês</div>' +
      '<div id="tabelaHojeRumoMes" class="cel-cartao"><table><tr><th>Loja</th>' +
      '<th>Vendido até ' + ddmm(ontemIso) + sub('caixa das lojas · ' + um(corrido) + '% do mês já passou') + '</th>' +
      '<th>Previsto no mês' + sub('no ritmo das últimas 4 semanas') + '</th>' +
      '<th>Meta do mês' + sub('a receita que dá 10% de resultado') + '</th>' +
      '<th>CMO estimado' + sub('meta até ' + (mPess ? um(mPess.meta) : '—') + '% · escala e horas') + '</th>' +
      '<th>CMV do dia' + sub('orçamento de compra') + '</th></tr>' +
      cols.map(c => tr(c, [
        mil1(c.ateOntem),
        farol(mil1(c.receitaPrev), c.receitaPrev, c.meta, 'acima') + (c.outrasMes > 500 ? sub('inclui ' + mil1(c.outrasMes) + ' de listas e atacado') : ''),
        c.meta ? mil1(c.meta) : '—',
        mPess ? farol(um(c.cmoEst) + '%', c.cmoEst, mPess.meta, mPess.sentido) : um(c.cmoEst) + '%',
        '<span style="color:var(--tx-5);">em construção</span>',
      ])).join('') + '</table></div>';

    // ---- tabela 2: o ultimo mes fechado ----
    const M = { CUSTO: plcMeta('CUSTO', [ult]), PESSOAL: mPess, VENDA: plcMeta('VENDA', [ult]), ADMIN: plcMeta('ADMIN', [ult]), RESULTADO: plcMeta('RESULTADO', [ult]) };
    const cabM = (rot, k, acao) => '<th>' + rot + sub((M[k] ? (M[k].sentido === 'abaixo' ? 'até ' : 'a partir de ') + um(M[k].meta) + '%' : '') + (acao ? ' · ' + acao : '')) + '</th>';
    const celM = (v, k) => v === null || v === undefined ? '—' : (M[k] ? farol(um(v) + '%', v, M[k].meta, M[k].sentido) : um(v) + '%');
    const t2 = '<div class="section-label">' + nomeMes(ult) + ' · último mês fechado · % da receita, a mesma conta da DRE</div>' +
      '<div id="tabelaHojeRumoFechado" class="cel-cartao"><table><tr><th>Loja</th>' +
      cabM('CMV', 'CUSTO', 'compras e fichas') + cabM('CMO', 'PESSOAL', 'escala') + cabM('Despesas de venda', 'VENDA', 'entrega e anúncios') +
      cabM('Administrativas', 'ADMIN', 'contratos da casa') + cabM('Resultado final', 'RESULTADO', 'o que sobrou') + '</tr>' +
      cols.map(c => tr(c, [celM(c.cmv, 'CUSTO'), celM(c.cmo, 'PESSOAL'), celM(c.venda, 'VENDA'), celM(c.admin, 'ADMIN'), celM(c.res, 'RESULTADO')])).join('') +
      '</table></div>' +
      '<div style="text-align:center; margin-top:8px;">' + botao('placar', 'O Placar') + ' ' + botao('dre', 'DRE') + '</div>';
    b4s = t1 + t2;
  } catch (e) {
    b4s = '<div class="section-label">Indicadores de rumo</div>' + aviso('Não consegui montar os indicadores: ' + e.message);
  }

  // ---------- 5. metas do iFood da semana fechada ----------
  // As metas seguem o filtro de loja do topo (como na Esta semana). Esta tela nao mostra o
  // filtro, entao avisa quando alguem o mudou em outra tela.
  const filtroMudou = !canalComSeletor() && typeof unidadesVisiveis === 'function' && activeUnidades.size !== unidadesVisiveis().length;
  let b4;
  try {
    b4 = (filtroMudou ? aviso('As metas abaixo estão filtradas por loja (filtro mudado em outra tela).') : '') +
      blocoMetasSemanaFechada((ini, fim) => 'Metas do iFood · só o iFood · ' + (finVazio() ? lojaNome(finVazio()) : 'lojas das três unidades') + ' · ' + ddmm(ini) + ' a ' + ddmm(fim));
  } catch (e) { b4 = '<div class="section-label">Metas da semana fechada</div>' + aviso('Não consegui montar as metas: ' + e.message); }

  alvo.innerHTML =
    '<div style="display:flex; align-items:baseline; gap:10px; flex-wrap:wrap; margin-bottom:6px;">' +
    '<h2 style="margin:0; font-size:20px;">Hoje na rede</h2>' +
    '<span style="color:var(--tx-5); font-size:13px;">' + diaRot(hojeIso) + ' · ' + (finVazio() ? lojaNome(finVazio()) : 'Água Verde, Ahú e São Braz') + '</span></div>' +
    // no celular a venda vem antes das filas, que ocupam quase uma tela inteira
    (matchMedia('(max-width:760px)').matches ? b2 + b1 : b1 + b2) + b3 + b4s + b4;
}

async function entrarEstaSemana() {
  const alvo = document.getElementById('view-estasemana');
  if (!alvo) return;
  alvo.innerHTML = '<div class="contexto">Montando a leitura da semana...</div>';
  try {
    if (METAS_KPI === null) {
      METAS_KPI = await consultarTudo('metas_kpi?select=chave,nome,bloco,sentido,meta,meta2,unidade,descricao,ordem&ativo=eq.true&order=ordem');
    }
    await Promise.all([carregarAlertas(), cargaDiaLer()]);
    renderEstaSemana();
  } catch (e) {
    alvo.innerHTML = '<div class="contexto" style="border-color:#ff6b6b;">Não consegui montar a home: ' + e.message + '</div>';
  }
}

function renderEstaSemana() {
  const alvo = document.getElementById('view-estasemana');
  const iso = (d) => d.toISOString().slice(0, 10);
  const ddmm = (v) => v ? v.slice(8, 10) + '/' + v.slice(5, 7) : '—';
  const hoje = new Date(); hoje.setHours(0, 0, 0, 0);
  const dow = (hoje.getDay() + 6) % 7; // 0 = segunda
  const segAtual = new Date(hoje); segAtual.setDate(segAtual.getDate() - dow);
  // 07/11/2026 (auditoria resultado-20): "ontem" = o ultimo dia COMPLETO da importacao do iFood (09:00).
  // De madrugada o ontem tinha so os pedidos ate 01:30 e o cartao dizia "caiu 13,9%".
  const ontem = new Date(cargaUltimoDia('ifood') + 'T00:00:00');
  const temSemanaEmCurso = ontem >= segAtual;

  // FAIXA A: precisa de gente agora. A conta mora em alertasAgora(), fora daqui,
  // porque o Placar mostra a MESMA faixa (decisao da revisao, 12/09/2026).
  const blocoAgora = blocoAlertas();

  // ---------- FAIXA B: semana em curso vs mesmos dias da anterior ----------
  let blocoEmCurso = '';
  if (temSemanaEmCurso) {
    const atual = computeMetrics(iso(segAtual), iso(ontem));
    const pIni = new Date(segAtual); pIni.setDate(pIni.getDate() - 7);
    const pFim = new Date(ontem); pFim.setDate(pFim.getDate() - 7);
    const antes = computeMetrics(iso(pIni), iso(pFim));

    const vs = (a, b, casas = 1) => {
      if (!b) return '<span style="color:#8a897e;">sem base</span>';
      const v = (a - b) / b * 100;
      return (v >= 0 ? 'subiu ' : 'caiu ') + Math.abs(v).toFixed(casas).replace('.', ',') + '%';
    };
    const metaDe = (chave) => (METAS_KPI || []).find(k => k.chave === chave) || null;
    const corMeta = (chave, v) => { const k = metaDe(chave); return k ? farolKpi(k, v)[0] : '#34332f'; };

    const cardHome = (lbl, valor, sub, cor) =>
      '<div class="card neutral" style="border:1px solid ' + (cor || '#34332f') + ';">' +
      '<div class="card-lbl">' + lbl + '</div><div class="card-val">' + valor + '</div>' +
      '<div class="card-pct">' + sub + '</div></div>';

    const ticketA = atual.totalPedidos ? atual.bruto / atual.totalPedidos : 0;
    const ticketB = antes.totalPedidos ? antes.bruto / antes.totalPedidos : 0;

    blocoEmCurso =
      '<div class="section-label">Semana em curso — seg ' + ddmm(iso(segAtual)) + ' a ' + ddmm(iso(ontem)) +
      ' <span style="text-transform:none; font-weight:normal; font-size:12px; color:#8a897e;">(vs os mesmos dias da semana passada)</span></div>' +
      '<div class="cards">' +
      cardHome('Pedidos no iFood', atual.totalPedidos, vs(atual.totalPedidos, antes.totalPedidos)) +
      cardHome('Bruto no iFood', 'R$ ' + fmt(atual.bruto), vs(atual.bruto, antes.bruto)) +
      cardHome('Ticket médio no iFood', 'R$ ' + fmt(ticketA), vs(ticketA, ticketB)) +
      cardHome('Cancelamento no iFood', pct(atual.nFullPct) + '%', vs(atual.nFullPct, antes.nFullPct) + ' · meta ' +
        (metaDe('taxa_cancelamento') ? fmtKpi('pct', Number(metaDe('taxa_cancelamento').meta)) : '—'),
        corMeta('taxa_cancelamento', atual.nFullPct)) +
      cardHome('Marketing por pedido no iFood', 'R$ ' + fmt(atual.custoMktPorPedido), vs(atual.custoMktPorPedido, antes.custoMktPorPedido),
        corMeta('mkt_por_pedido', atual.custoMktPorPedido)) +
      '</div>' +
      '<div class="caption-label" style="text-align:center;">Fonte: pedidos importados toda manhã (dados até ' + ddmm(iso(ontem)) + ', o último dia completo). ' +
      'Cores nos cards = farol da meta correspondente; cinza = sem meta para este número.</div>';
  } else {
    blocoEmCurso = '<div class="contexto">Ainda não há dia completo nesta semana — os números entram depois da importação da manhã (até 10:00).</div>';
  }

  const blocoPlacar = blocoMetasSemanaFechada();

  alvo.innerHTML =
    '<div class="section-label" style="border-top:none; margin-top:0; padding-top:0;">Precisa de você agora</div>' +
    blocoAgora + blocoEmCurso + blocoPlacar +
    '<div class="caption-label" style="text-align:center; margin-top:14px;">Esta página segue os filtros de loja do topo. ' +
    'Regra da casa: subiu/caiu é o fato; bom ou ruim depende da meta — o farol decide.</div>';
}

// Recorte desta tela (12/09/2026): "só o que não está no verde". Mesmo mecanismo
// de chip do resto do painel — o botao aceso diz onde voce esta, e o outro desfaz.
let IND_SO_FORA = false;

function indSoFora(v) { IND_SO_FORA = !!v; entrarIndicadores(); }

async function entrarIndicadores() {
  const alvo = document.getElementById('view-indicadores');
  alvo.innerHTML = '<div class="contexto">Carregando indicadores...</div>';
  if (METAS_KPI === null) {
    METAS_KPI = await consultarTudo('metas_kpi?select=chave,nome,bloco,sentido,meta,meta2,unidade,descricao,ordem&ativo=eq.true&order=ordem');
  }
  if (NEGOCIACOES === null) await entrarNegociacoesSoDados();
  if (AVALIACOES === null) await entrarAvaliacoesSoDados();

  const sem = ultimaSemanaCompleta();
  const antFim = new Date(sem.ini + 'T00:00:00'); antFim.setDate(antFim.getDate() - 1);
  const antIni = new Date(antFim); antIni.setDate(antIni.getDate() - 6);
  const iso = (d) => d.toISOString().slice(0, 10);
  const atual = computeKpisSemana(sem.ini, sem.fim);
  const anterior = computeKpisSemana(iso(antIni), iso(antFim));

  // AS 8 SEMANAS DE CADA KPI (12/09/2026). Com um ponto e uma comparacao nao da
  // para separar "ruim desde sempre" de "estragou esta semana", e sao dois
  // problemas diferentes. Nao entra consulta nova: computeKpisSemana le ROWS,
  // NEGOCIACOES e AVALIACOES, que ja estao na memoria — sao 8 execucoes das mesmas
  // contas. Semanas fechadas seg-dom, da mais antiga para a mais recente; a ultima
  // e' a mesma semana do placar acima.
  const N_SEMANAS_SPARK = 8;
  const semanasSpark = [];
  for (let k = N_SEMANAS_SPARK - 1; k >= 0; k--) {
    const f = new Date(sem.fim + 'T00:00:00'); f.setDate(f.getDate() - 7 * k);
    const i = new Date(f); i.setDate(i.getDate() - 6);
    semanasSpark.push({ ini: iso(i), fim: iso(f) });
  }
  const serieSpark = semanasSpark.map(s => computeKpisSemana(s.ini, s.fim));
  const rotSpark = semanasSpark.map(s => formatarDataCurta(s.ini));

  // 12/09/2026: o aviso disparava SEMPRE. Ele comparava com as 17 lojas da rede,
  // e a visao padrao ("Minha gestao") mostra 13 — entao abrir a tela ja acendia
  // o alerta vermelho sem ninguem ter filtrado nada. Agora a base de comparacao
  // e o proprio perimetro: so avisa quando a pessoa estreitou de verdade.
  const lojasDoPerimetro = LOJAS.filter((_, i) => lojaPermitida(i)).length;
  const filtroAtivo = activeLojas().size < lojasDoPerimetro;
  const aviso = filtroAtivo
    ? `<div class="contexto" style="border-color:#f5a623;">Atenção: há filtro de loja ativo — o placar abaixo
       é do recorte filtrado, mas as metas valem para o conjunto. Limpe os filtros para o placar oficial.</div>`
    : (PERIMETRO === 'rede'
      ? `<div class="contexto" style="border-color:#f5a623;">Você está na visão <b>Rede iFood completa</b>, que inclui o Boqueirão.
         As metas foram calibradas sem ele — compare com cuidado.</div>`
      : '');

  // Onde esta o gap (por loja) — para os KPIs operacionais
  const notaPorLoja = {};
  atual._avs.forEach(r => {
    (notaPorLoja[r[0]] = notaPorLoja[r[0]] || []).push(r[2]);
  });
  const lojasNotaBaixa = Object.entries(notaPorLoja)
    .map(([i, notas]) => [LOJAS[i], notas.reduce((s, n) => s + n, 0) / notas.length, notas.length])
    .filter(([, media, n]) => n >= 10 && media < 4.5)
    .sort((a, b) => a[1] - b[1]);
  const semRespPorLoja = {};
  atual._negs.filter(negSemResposta).forEach(r => { semRespPorLoja[r[0]] = (semRespPorLoja[r[0]] || 0) + 1; });
  const topSemResp = Object.entries(semRespPorLoja).map(([i, n]) => [LOJAS[i], n])
    .sort((a, b) => b[1] - a[1]).slice(0, 4);
  const atrasoPorLoja = {};
  atual._negs.filter(r => (r[4] || '').includes('ATRASO')).forEach(r => { atrasoPorLoja[r[0]] = (atrasoPorLoja[r[0]] || 0) + 1; });
  const topAtraso = Object.entries(atrasoPorLoja).map(([i, n]) => [LOJAS[i], n])
    .sort((a, b) => b[1] - a[1]).slice(0, 4);

  const gapDe = {
    nota_media: lojasNotaBaixa.length
      ? 'Lojas abaixo de 4,5 (10+ aval.): ' + lojasNotaBaixa.map(([n, m, q]) => `${n} (${m.toFixed(2).replace('.', ',')} em ${q})`).join(', ')
      : 'Nenhuma loja abaixo de 4,5 com 10+ avaliações.',
    neg_sem_resposta_pct: topSemResp.length
      ? 'Onde está o gap: ' + topSemResp.map(([n, q]) => `${n} (${q})`).join(', ')
      : 'Todas as negociações da semana foram respondidas.',
    neg_atraso_pct: topAtraso.length
      ? 'Onde está o gap: ' + topAtraso.map(([n, q]) => `${n} (${q})`).join(', ')
      : '',
  };

  // Dentro do bloco, a ordem passa a ser a DISTANCIA DA META: fora, perto, sem
  // dado, na meta. Quem abre esta tela abre para achar o que corrigir — na ordem
  // do banco (coluna `ordem`) os vermelhos ficam espalhados no meio dos verdes.
  // O rotulo vem de farolKpi, que e' quem decide o farol em todo o painel.
  const grauFarol = (k) => {
    const r = farolKpi(k, atual[k.chave])[1];
    return r.startsWith('fora') ? 0 : r.startsWith('perto') ? 1 : r.startsWith('na') ? 3 : 2;
  };
  const blocos = [...new Set(METAS_KPI.map(k => k.bloco))];
  let corpo = '';
  for (const bloco of blocos) {
    // "Só o que não está no verde" esconde apenas quem esta NA meta: sem dado
    // (e a visao Rede, onde o farol nao vale) continua aparecendo, senao o chip
    // esvaziaria a tela inteira e pareceria defeito.
    const doBloco = METAS_KPI.filter(k => k.bloco === bloco)
      .filter(k => !IND_SO_FORA || grauFarol(k) < 3)
      .sort((x, y) => grauFarol(x) - grauFarol(y));
    if (!doBloco.length) continue;
    corpo += `<div class="section-label">${bloco}</div>`;
    corpo += doBloco.map(k => {
      const v = atual[k.chave], va = anterior[k.chave];
      const [cor, rotulo] = farolKpi(k, v);
      let varTxt = '';
      if (v !== null && va !== null && va !== undefined && Math.abs(va) > 0.005) {
        const d = (v - va) / Math.abs(va) * 100;
        const palavra = d > 0.5 ? 'subiu' : d < -0.5 ? 'caiu' : 'estável';
        varTxt = `<span style="color:#8a897e;">· vs sem. anterior: ${palavra}${palavra !== 'estável' ? ' ' + pct(Math.abs(d)) + '%' : ''}</span>`;
      }
      const gap = gapDe[k.chave] ? `<div style="font-size:12px; color:#a5a49a; margin-top:4px;">${gapDe[k.chave]}</div>` : '';
      // Semana sem dado NAO vira zero — zero desenharia um tombo que nao houve.
      // Sem as 8 semanas inteiras o indicador fica so' com o numero, sem linha.
      const vals = serieSpark.map(s => s[k.chave]);
      const temSerie = vals.every(x => x !== null && x !== undefined && isFinite(x));
      const spark = temSerie
        ? `<div style="max-width:340px;" title="As ${N_SEMANAS_SPARK} últimas semanas fechadas (segunda a domingo), da mais antiga à mais recente. O último ponto é a semana do placar. Mesma conta do número acima, semana a semana.">${fxSpark(vals, rotSpark, x => fmtKpi(k.unidade, x))}</div>`
        : '';
      return `
      <div class="contexto" style="text-align:left; display:flex; gap:14px; align-items:flex-start;">
        <div style="width:14px; height:14px; border-radius:50%; background:${cor}; flex-shrink:0; margin-top:3px;" title="${rotulo}"></div>
        <div style="flex:1;">
          <b>${nomeMeta(k)}</b> <span style="color:#8a897e; font-size:12px;">(${k.bloco.toLowerCase()})</span><br>
          <span style="font-size:20px; font-weight:bold;">${fmtKpi(k.unidade, v)}</span>
          ${metaSoRede(k) ? '' : `<span style="color:#a5a49a;">/ meta ${fmtMeta(k)}</span>`}
          <span style="color:${cor}; font-weight:bold;">· ${rotulo}</span> ${varTxt}
          ${gap}
          ${spark}
          <div style="font-size:11px; color:#8a897e; margin-top:3px;">${k.descricao || ''}</div>
          ${acaoLinha(k.chave)}
        </div>
      </div>`;
    }).join('');
  }

  const naMeta = METAS_KPI.filter(k => farolKpi(k, atual[k.chave])[1].startsWith('na')).length;
  const foraDoVerde = METAS_KPI.length - naMeta;
  const chipsFarol = `<div style="text-align:center; margin:10px 0;">
    <button class="preset-btn ${IND_SO_FORA ? '' : 'active'}" onclick="indSoFora(false)">todas as ${METAS_KPI.length}</button>
    <button class="preset-btn ${IND_SO_FORA ? 'active' : ''}" onclick="indSoFora(true)"
      title="Esconde só as metas atingidas; o que está sem dado continua na lista.">só o que não está no verde ${foraDoVerde}</button>
  </div>`;
  alvo.innerHTML = `
  <div class="section-label" style="border-top:none; margin-top:0; padding-top:0;">Indicadores e metas</div>
  <div class="contexto" style="text-align:left;">
    <b>Placar da semana ${formatarDataCurta(sem.ini)} – ${formatarDataCurta(sem.fim)}</b>
    (última semana completa seg–dom) · <b style="color:${naMeta >= 6 ? '#3fb950' : naMeta >= 4 ? '#f5a623' : '#ff6b6b'}">${naMeta} de ${METAS_KPI.filter((k) => !metaSoRede(k)).length} metas atingidas</b><br>
    <span style="font-size:12px; color:#a5a49a;" title="A linha embaixo de cada indicador são as ${N_SEMANAS_SPARK} últimas semanas fechadas, da mais antiga à mais recente; o último ponto é esta semana. Indicador sem as 8 semanas completas aparece só com o número, sem linha.">As metas moram no banco (tabela metas_kpi) — o resumo de segunda-feira analisa como fechar cada gap. A linha em cada indicador são as ${N_SEMANAS_SPARK} últimas semanas.
    Líquido/margem dependem da conciliação da semana estar completa no iFood.</span>
  </div>
  ${aviso}
  ${chipsFarol}
  ${corpo}`;
}

const finVazio = () => (lojaFin() === 'REDE' ? '' : lojaFin());   // Fluxo projetado e Contas: '' = Rede

// a ordem que o dono pediu em 22/10 (Água Verde, São Braz, Ahú e, por último, a Rede); numa loja, só ela
const FIN_ORDEM = ['AGUA VERDE', 'SÃO BRAZ', 'AHU'];

const finLinhas = () => (lojaFin() === 'REDE' ? [...FIN_ORDEM, 'REDE'] : [lojaFin()]).map((u) => [u, lojaNome(u)]);

function finPedirLoja(u) { avisarCasca({ tipo: 'casca-loja-pedir', loja: u }); }

const finSoRede = () => (lojaFin() !== 'REDE' && !PROJ_RECEB_LOJA
  ? `<div class="contexto" style="border-color:var(--farol-perto);">Esta parte é só da Rede: a receita por loja não fechou com a da Rede hoje.</div>` : '');

const FIN_TELAS = new Set(['hoje', 'placar', 'fechamento', 'semana', 'dre', 'fluxo', 'despesas', 'lucrouni', 'concbanco', 'contaspagar', 'contasreceber', 'projecao']);

let DFC_RAW = null, DFC_CONTAS_RAW = null, DFC_MOV_RAW = null;

// vw_fin_fechamento_saldo_mensal: conferência de saldo por conta e mês fechado
// (03/09/2026) — BATEU / DIFERE / SEM EXTRATO contra o saldo do banco ou informado.
let DFC_CONF_RAW = null, DFC_CONF = null;

let DRE_RAW = null, DRE_VENDAS_RAW = null;

// Filtra pela loja escolhida. Em REDE soma as linhas equivalentes das unidades
// (mesma competencia, mesma linha do plano de contas).
function porLojaFin(linhas, chaves, somar) {
  if (!linhas) return linhas;
  if (lojaFin() !== 'REDE') return linhas.filter(r => r.unidade === lojaFin());
  const mapa = new Map();
  linhas.forEach(r => {
    const k = chaves.map(c => r[c]).join('');
    const acc = mapa.get(k);
    if (!acc) { mapa.set(k, Object.assign({}, r, { unidade: 'REDE' })); return; }
    somar.forEach(c => { acc[c] = Number(acc[c] || 0) + Number(r[c] || 0); });
  });
  return [...mapa.values()];
}

// Deriva as listas que os modulos ja usavam. Nada mais busca no servidor: trocar
// de loja e so refiltrar o que ja esta na memoria.
function aplicarLojaFin() {
  if (DFC_RAW) {
    DFC_MENSAL = porLojaFin(DFC_RAW, ['mes', 'natureza', 'tipo', 'subtipo', 'ordem'],
                            ['credito', 'debito']);
    DFC_MENSAL.forEach(r => { r.credito = Number(r.credito); r.debito = Number(r.debito); });
    // Conta pertence a uma unidade: em REDE entram todas, senao so as da loja.
    DFC_CONTAS = (lojaFin() === 'REDE' ? (DFC_CONTAS_RAW || [])
      : (DFC_CONTAS_RAW || []).filter(c => c.unidade === lojaFin())).map(c => c);
    DFC_CONTAS.forEach(c => { c.saldo_inicial = Number(c.saldo_inicial); });
    const minhas = new Set((DFC_CONTAS || []).map(c => c.conta));
    DFC_MOV = (DFC_MOV_RAW || []).filter(m => minhas.has(m.conta));
    DFC_MOV.forEach(r => { r.movimento = Number(r.movimento); });
    DFC_CONF = (DFC_CONF_RAW || []).filter(r => minhas.has(r.conta));
  }
  if (DRE_RAW) {
    DRE_FIN = porLojaFin(fxSemListaNaRede(DRE_RAW), ['mes', 'natureza', 'tipo', 'subtipo', 'ordem'],
                         ['credito', 'debito']);
    DRE_FIN.forEach(r => { r.credito = Number(r.credito); r.debito = Number(r.debito); });
    DRE_VENDAS = porLojaFin(DRE_VENDAS_RAW, ['mes', 'canal'], ['vendas', 'receita']);
    DRE_VENDAS.forEach(r => { r.receita = Number(r.receita); r.vendas = Number(r.vendas); });
  }
  if (DRE_BENEF_RAW) aplicarBenefLoja();
}

// sem botão de loja: a loja é a do topo. Fica só o aviso de que a Rede não conta a lista entre lojas.
function seletorLojaFin() {
  return lojaFin() === 'REDE' && ['dre', 'fechamento', 'placar', 'despesas'].includes(MODULO_ATUAL)
    ? '<div class="caption-label" style="text-align:center;">Somando as três lojas: a mercadoria que a Água Verde manda para as filiais não conta.</div>' : '';
}

function nomeLojaFin() { return lojaNome(lojaFin()); }

// ===== Fechamento do mes e A semana — em portugues, para a Jane e o Fabio (02/09/2026) =====
// Mesmos numeros das paginas "Agosto em uma pagina" e "A Semana das Lojas"
// (contexto/project_fechamento_para_leigos.md). Regras: um mes/semana contra o
// anterior; "de cada R$ 100"; farol em PALAVRA; fato separado de interpretacao.
// Fontes: views vw_fin_* e vw_sem_*/mv_sem_* (script/sql/fechamento_semana.sql).
const FX_TODAS = ['AGUA VERDE', 'AHU', 'SÃO BRAZ'];

const fxLojas = () => lojaFin() === 'REDE' ? FX_TODAS : [lojaFin()];

// LISTA ENTRE LOJAS NA REDE (dono, 07/10/2026: "pode tirar a lista inteira da visao Rede").
// A lista e' receita da Agua Verde (LISTAS AHU / LISTAS SAO BRAZ) e mercadoria da filial
// (MERCADORIAS AV) no MESMO valor: na soma das tres e' a rede vendendo para ela mesma. O
// resultado em reais nao muda; receita e mercadoria ficavam infladas (set/26: R$ 45.137,48 de
// cada lado, mercadoria 41,1% em vez de 38,1%). Os 19% do preco da lista saem junto: sao
// receita da AV e custo da filial, nenhum cliente pagou. POR LOJA NADA MUDA. Um predicado so,
// usado pela DRE, pelo Placar, pelo Fechamento e pela Analise de despesas; a copia em Python
// esta em script/gerar_dre_pagina.py (LISTA_INTERNA). Mudou aqui, muda la.
// RISCO CONHECIDO: o lado da filial e' reconhecido so pelo nome MERCADORIAS AV. Hoje esse subtipo
// so vem do ajuste das listas (credito na AV = debito na filial, todo mes). Se alguem lancar no
// Saipos uma despesa de filial nessa categoria, a Rede perde o custo sem perder a receita — o
// portao (conferir_numeros_painel.py, "listas: receita da AV x custo das filiais") acusa.
const fxListaInterna = (r) => (r.natureza === 'RECEITAS' && (r.subtipo === 'LISTAS AHU' || r.subtipo === 'LISTAS SAO BRAZ'))
  || r.subtipo === 'MERCADORIAS AV';

const fxSemListaNaRede = (linhas) => (lojaFin() === 'REDE' && linhas) ? linhas.filter(r => !fxListaInterna(r)) : linhas;

const fxN = v => Number(v) || 0;

const fxSoma = (rows, campo) => rows.reduce((s, r) => s + fxN(r[campo]), 0);

function fxMil(v) {
  const a = Math.abs(v), s = v < 0 ? '−' : '';
  if (a >= 1e6) return s + 'R$ ' + (a / 1e6).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' mi';
  if (a >= 1e5) return s + 'R$ ' + Math.round(a / 1e3).toLocaleString('pt-BR') + ' mil';
  if (a >= 1e4) return s + 'R$ ' + (a / 1e3).toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 }) + ' mil';
  return s + 'R$ ' + Math.round(a).toLocaleString('pt-BR');
}

const fxInt = v => Math.round(v).toLocaleString('pt-BR');

const fxPct1 = v => v.toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 }) + '%';

const fxR2 = v => 'R$ ' + v.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

function fxVar(a, b, rotAnt) {
  if (!b || Math.abs(b) < 0.005) return '';
  const d = (a - b) / Math.abs(b) * 100;
  if (Math.abs(d) < 0.5) return `<b>ficou igual</b> ${rotAnt}`;
  return `<b>${d > 0 ? 'subiu' : 'caiu'} ${fxPct1(Math.abs(d))}</b> ${rotAnt}`;
}

function fxFarol(valor, meta, sentido) {
  const dist = sentido === 'abaixo' ? valor - meta : meta - valor;
  if (dist <= 0) return ['ok', 'dentro da meta'];
  if (dist <= meta * 0.10) return ['atencao', 'perto da meta'];
  return ['fora', 'fora da meta'];
}

const fxHojeSP = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(new Date());

function fxSegunda(dataStr) { const d = new Date(dataStr + 'T12:00:00'); d.setDate(d.getDate() - ((d.getDay() + 6) % 7)); return d.toISOString().slice(0, 10); }

const fxDM = s => { const [, m, d] = s.split('-'); return `${Number(d)}/${m}`; };

const FX_MESES = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];

const FX_MESES_LONGO = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];

const fxMesRot = m => FX_MESES[Number(m.slice(5, 7)) - 1];

const fxMesLongo = m => FX_MESES_LONGO[Number(m.slice(5, 7)) - 1];

const fxSemRot = s => `${fxDM(s)} a ${fxDM(fxSomaDias(s, 6))}`;

// linha dos ultimos periodos: uma serie, uma cor, ponto final em destaque, titulo em cada ponto
function fxSpark(vals, rotulos, fmt) {
  if (!vals.length) return '';
  const W = 300, H = 50, P = 6, min = Math.min(...vals), max = Math.max(...vals);
  const y = v => max === min ? H / 2 : P + (H - 2 * P) * (1 - (v - min) / (max - min));
  const xs = vals.map((_, i) => P + i * (W - 2 * P) / Math.max(1, vals.length - 1));
  const pts = vals.map((v, i) => `${xs[i].toFixed(1)},${y(v).toFixed(1)}`);
  const area = `M${pts[0]} L${pts.join(' L')} L${xs[xs.length - 1].toFixed(1)},${H} L${xs[0].toFixed(1)},${H} Z`;
  const circ = vals.map((v, i) => `<circle cx="${xs[i].toFixed(1)}" cy="${y(v).toFixed(1)}" r="${i === vals.length - 1 ? 4 : 3}" fill="${i === vals.length - 1 ? '#c8102e' : 'var(--p-paper, #1a1a19)'}" stroke="#c8102e" stroke-width="${i === vals.length - 1 ? 0 : 1.5}"><title>${rotulos[i]}: ${fmt(v)}</title></circle>`).join('');
  const iMax = vals.indexOf(max);
  const lab = `<text x="${xs[iMax].toFixed(1)}" y="${(y(max) - 7).toFixed(1)}" text-anchor="${iMax > vals.length - 3 ? 'end' : iMax < 2 ? 'start' : 'middle'}" font-size="11" fill="var(--tx-3)">${rotulos[iMax]} ${fmt(max)}</text>`;
  return `<div class="fx-spark"><svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" role="img"><path d="${area}" fill="rgba(200,16,46,.14)"/><polyline points="${pts.join(' ')}" fill="none" stroke="#c8102e" stroke-width="2" stroke-linejoin="round" vector-effect="non-scaling-stroke"/>${lab}${circ}</svg><div class="fx-eixo"><span>${rotulos[0]}</span><span>${rotulos[rotulos.length - 1]}</span></div></div>`;
}

const fxTile = (r, v, varr, extra, sp, lista) => `<div class="fx-tile"><div class="fx-rotulo">${r}</div><div class="fx-valor${(typeof v === 'number' && v < 0) ? ' neg' : ''}">${typeof v === 'number' ? fxMil(v) : v}</div><div class="fx-var">${varr || ''}</div><div class="fx-extra">${extra || ''}</div>${lista || ''}${sp || ''}</div>`;

const fxPill = (f) => `<span class="fx-pill ${f[0]}">${f[1]}</span>`;

const fxSeg = (id, itens, sel) => `<div class="fx-seg" data-seg="${id}">${itens.map(([v, rot]) => `<button data-v="${v}" class="${v === sel ? 'ativo' : ''}">${rot}</button>`).join('')}</div>`;

// ---------------- FECHAMENTO DO MES ----------------
let FX_M = null;           // dados carregados uma vez

let FX_MES_SEL = null;

const FX_SUBT_PDV = ['RECEITAS CARTAO', 'RECEITAS ONLINE', 'RECEITAS DINHEIRO', 'RECEITAS FIADO'];

const FX_GRUPOS = { CUSTO: ['MATERIA PRIMA', 'USO E CONSUMO'], PESSOAL: ['PESSOAL', 'PRO LABORE'],
  VENDA: ['DESPESAS COMERCIAIS', 'DESPESAS LOGISTICA', 'DESPESAS MARKETING'],
  ADMIN: ['DESPESAS ADMINISTRATIVAS', 'DESPESAS MANUTENÇÃO', 'IMPOSTOS E TAXAS'] };

// O BALDE DA SECAO 2 ABRE (12/09/2026). Qual balde tem composicao pronta e de onde
// ela vem — sempre plcComposicao, a MESMA do Placar. OUTROS fica fora de proposito:
// juros, tarifas, IRPJ e o que sobrou sem classe vem de cinco cantos diferentes e
// nao ha uma lista unica que o explique; linha que abre vazia ensina a nao clicar.
const FX_COMPOSICAO = { CUSTO: 'merc', PESSOAL: 'pess', VENDA: 'venda', ADMIN: 'admin', TAXAS: 'canal' };

// O que NAO vem do plano de contas, para o total da abertura sempre fechar com o
// balde em vez de bater perto: em VENDA e' a entrega sob demanda (vem de
// vw_canal_custo_mes) e em TAXAS e' o ICMS (DEDUCOES DA RECEITA).
// 01/10/2026: os anuncios do iFood sairam de VENDA; estao em TAXAS, com nome, como na DRE.
const FX_RESTO_ROT = { VENDA: 'outros fretes cobrados pelo iFood',
                       TAXAS: 'ICMS e outras deduções da receita' };

let FX_BALDE = null;

function fxAbrirBalde(id) { FX_BALDE = (FX_BALDE === id) ? null : id; renderFechamento(); }

// A CARGA E' COMPARTILHADA (12/09/2026): o Fechamento do mes e o Placar leem o
// MESMO FX_M. Foi o jeito de garantir que as duas telas nao possam divergir —
// quem abre primeiro carrega, quem abre depois reusa.
// VENDA CHEIA (dono, 15/10/2026: "o ideal é trazer a linha da venda cheia e descontar as promos
// de mkt"). A venda do PDV no iFood já vem com a promoção paga pela loja descontada; aqui ela
// volta para a venda (canal IFOOD) e vira dedução nomeada (classe CANAL). O resultado não muda
// um centavo. Cópia SQL: vw_fin_resultado_fato (script/sql/venda_cheia_2026_10_15.sql); cópia
// Python: script/gerar_dre_pagina.py (venda_cheia). Mudou aqui, muda lá. Idempotente.
function fxVendaCheia(vendas, canal, campo) {
  const promo = {};
  (canal || []).forEach(r => {
    if (r.linha === 'PROMO_LOJA' && r.classe === 'INFO') {
      r.classe = 'CANAL'; r.rotulo = 'Promoções pagas pela loja no iFood';
      const k = r.mes + '|' + r.unidade; promo[k] = (promo[k] || 0) + Number(r.custo || 0);
    }
  });
  Object.entries(promo).forEach(([k, v]) => {
    const [mes, unidade] = k.split('|');
    let alvo = (vendas || []).find(x => x.mes === mes && x.unidade === unidade && x.canal === 'IFOOD');
    if (!alvo) { alvo = { mes, unidade, canal: 'IFOOD', pedidos: 0, vendas: 0 }; alvo[campo] = 0; vendas.push(alvo); }
    alvo[campo] = Number(alvo[campo] || 0) + v;
  });
}

async function fxCarregarM() {
  if (FX_M) return;
  {
    const [dre, vendas, canal, benef, ponte, metas, metasMes, prova] = await Promise.all([
      consultarTudo('vw_fin_dre_mensal?select=unidade,mes,natureza,tipo,subtipo,credito,debito&mes=gte.2026-01-01'),
      consultarTudo('vw_mes_vendas?select=mes,unidade,canal,pedidos,faturamento&mes=gte.2026-01-01'),
      // custo dos canais por FATO (12/09/2026): substitui a conta por diferenca e o extrato de anuncios so da AV
      consultarTudo('vw_canal_custo_mes?select=mes,unidade,linha,classe,rotulo,custo&mes=gte.2026-01-01'),
      consultarTudo('vw_fin_dre_beneficio?select=mes,unidade,beneficio_ifood'),
      consultarTudo('vw_fin_ponte_mensal?select=*'),
      consultarTudo('fin_metas_dre?select=chave,sentido,pct_meta'),
      // a meta do mes, quando ela muda mes a mes: o custo desce meio ponto por mes
      // ate 32 em fev/27 (decisao do dono, 02/09/2026). Sem isto o Placar mediria
      // um trimestre inteiro contra a meta de um mes so.
      consultarTudo('fin_metas_dre_mes?select=chave,mes,pct_meta').catch(() => []),
      // prova dos nove (04/09/2026): a venda do PDV conferida contra iFood, Rede e vales
      consultarTudo('vw_fechamento_prova_nove?select=mes,unidade,ordem,linha,fonte_a,fonte_b,valor_a,valor_b,diferenca,pct,tolerancia_pct,situacao,piso_ruido&order=mes,ordem').catch(() => []),
    ]);
    const metasMap = {}; metas.forEach(m => { metasMap[m.chave] = { sentido: m.sentido, meta: fxN(m.pct_meta) }; });
    const metasMesMap = {}; (metasMes || []).forEach(m => { metasMesMap[m.chave + '|' + m.mes] = fxN(m.pct_meta); });
    fxVendaCheia(vendas, canal, 'faturamento');   // 15/10/2026: venda cheia + promoção como dedução
    FX_M = { dre, vendas, canal, benef, ponte, metas: metasMap, metasMes: metasMesMap, prova: prova || [] };
    const meses = [...new Set(dre.map(r => r.mes))].sort().filter(m => m.slice(0, 7) < mesCorrenteSP());
    FX_MES_SEL = meses[meses.length - 1];
  }
}

async function entrarFechamento() {
  const alvo = document.getElementById('view-fechamento');
  if (!FX_M) {
    alvo.innerHTML = '<div class="contexto">Carregando o fechamento...</div>';
    await fxCarregarM();
  }
  renderFechamento();
  // "As contas batem com o banco?" le DFC_CONF, que so carrega por garantirDadosFin.
  // Ate 12/09/2026 o bloco so aparecia se outra tela financeira tivesse sido aberta antes.
  if (DFC_MENSAL === null) garantirDadosFin().then(() => { if (MODULO_ATUAL === 'fechamento') renderFechamento(); }).catch(() => {});
}

function fxMesCalc(mes) {
  const L = fxLojas();
  const rows = fxSemListaNaRede(FX_M.dre.filter(r => r.mes === mes && L.includes(r.unidade)));
  const s = (pred, sinal = 1) => rows.reduce((a, r) => a + (pred(r) ? (fxN(r.credito) - fxN(r.debito)) * sinal : 0), 0);
  const v = FX_M.vendas.filter(r => r.mes === mes && L.includes(r.unidade));
  const canais = {}; v.forEach(r => { canais[r.canal] = (canais[r.canal] || 0) + fxN(r.faturamento); });
  const recBruta = fxSoma(v, 'faturamento'), pedidos = fxSoma(v, 'pedidos');
  const recPdv = s(r => r.natureza === 'RECEITAS' && FX_SUBT_PDV.includes(r.subtipo));
  const outras = s(r => r.natureza === 'RECEITAS' && !FX_SUBT_PDV.includes(r.subtipo));
  const outrasDet = {}; rows.forEach(r => { if (r.natureza === 'RECEITAS' && !FX_SUBT_PDV.includes(r.subtipo)) outrasDet[r.subtipo] = (outrasDet[r.subtipo] || 0) + fxN(r.credito) - fxN(r.debito); });
  // custo dos canais por FATO (12/09/2026, decisao do dono): cada cobranca do
  // iFood e da Rede com nome, nas 3 lojas. Entrega sob demanda fica no balde
  // "entrega, comercial e marketing"; antecipacao da Rede em juros e tarifas.
  // A conta antiga (vendido − recebido) fica so de conferencia.
  // 01/10/2026 (dono: "o mesmo numero tem de ser o mesmo em toda tela"): a regua
  // e' a DRE (renderModuloDRE). Os ANUNCIOS do iFood ficam DENTRO do custo dos
  // canais (a classe CANAL inteira) e as COMISSOES de vendedores saem antes da
  // receita liquida — os dois moravam no balde VENDA. O resultado nao muda um
  // centavo; muda a margem de contribuicao, que tinha o mesmo nome e a mesma
  // meta nas duas telas e conteudo diferente (set/26, Agua Verde: R$ 30,5 mil
  // a mais aqui do que na DRE). A copia SQL desta conta e' vw_fin_resultado_fato
  // (script/sql/resultado_fato.sql): mudou aqui, muda la.
  const cf = FX_M.canal.filter(r => r.mes === mes && L.includes(r.unidade));
  const cs = (pred) => cf.reduce((a, r) => a + (pred(r) ? fxN(r.custo) : 0), 0);
  const sobDemanda = cs(r => r.classe === 'LOGISTICA'), antecip = cs(r => r.classe === 'FINANCEIRO');
  const temFato = cf.length > 0;
  const taxasCanais = temFato ? cs(r => r.classe === 'CANAL') : recBruta - recPdv;
  const defasagem = temFato ? recBruta - recPdv - taxasCanais - sobDemanda - antecip : 0;
  // comissoes de vendedores: deducao da receita, como na DRE (la desde 03/09/2026)
  const comissoes = s(r => r.natureza === 'DESPESAS' && r.subtipo === 'COMISSOES', -1);
  const deducoes = s(r => r.natureza === 'DEDUÇOES DA RECEITA' && r.subtipo !== 'IRPJ', -1);
  const irpj = s(r => r.natureza === 'DEDUÇOES DA RECEITA' && r.subtipo === 'IRPJ', -1);
  const grupos = {};
  // COMISSOES fica fora dos grupos (ja saiu la em cima, antes da receita liquida) — o mesmo predGrupo da DRE
  Object.entries(FX_GRUPOS).forEach(([k, tipos]) => { grupos[k] = s(r => r.natureza === 'DESPESAS' && r.tipo !== 'INVESTIMENTOS' && tipos.includes(r.tipo) && r.subtipo !== 'COMISSOES', -1); });
  grupos.VENDA += sobDemanda;
  const mapeados = Object.values(FX_GRUPOS).flat().concat(['DESPESAS FINANCEIRAS']);
  const outrasDesp = s(r => r.natureza === 'DESPESAS' && r.tipo !== 'INVESTIMENTOS' && !mapeados.includes(r.tipo), -1);
  const base = recBruta + outras;
  const recLiq = base - taxasCanais - comissoes - deducoes;
  const ebitda = recLiq - grupos.CUSTO - grupos.PESSOAL - grupos.VENDA - grupos.ADMIN - outrasDesp;
  const despFin = s(r => r.tipo === 'DESPESAS FINANCEIRAS', -1) + antecip, recFin = s(r => r.natureza === 'APLICAÇÕES' && r.subtipo === 'RENDIMENTOS');
  const semClass = s(r => r.natureza === 'SEM CLASSIFICACAO');
  const resultado = ebitda + recFin - despFin + semClass - irpj;
  const benef = FX_M.benef.filter(r => r.mes === mes && L.includes(r.unidade)).reduce((a, r) => a + fxN(r.beneficio_ifood), 0);
  return { mes, canais, recBruta, pedidos, ticket: pedidos ? recBruta / pedidos : 0, outras, outrasDet, taxasCanais, comissoes, defasagem, temFato, deducoes, irpj, base, recLiq, grupos, outrasDesp, ebitda, despFin, recFin, semClass, resultado, benef };
}

// PONTE SO VALE INTEIRA (12/09/2026). A view pode nao ter uma das lojas da visao num mes;
// somar o que houver daria o caixa de uma loja com o rotulo da Rede. Sem todas as lojas da
// visao, nao ha ponte — e as telas ja dizem isso ("sem ponte de caixa neste periodo").
// 25/09/2026: antes de agosto a ponte era so da Agua Verde, e a razao que estava escrita
// aqui ("o caixa das filiais entrou no Saipos em 01/08") era FALSA — o jan-jul das filiais
// existe desde 18/08 (SAIPOS_HIST) e o saldo bate com o extrato. Quem estava errada era a
// vw_fin_ponte_mensal, que lia a planilha (so AV). Corrigida; jan-jul agora tem as tres.
function fxPonte(mes) { const L = fxLojas(); const rows = FX_M.ponte.filter(r => r.mes === mes && L.includes(r.unidade)); if (!rows.length || L.some(u => !rows.some(r => r.unidade === u))) return null; const s = c => rows.reduce((a, r) => a + fxN(r[c]), 0); return { res: s('resultado_apurado'), comp: s('ajuste_competencia'), inv: s('investimentos'), ret: s('retiradas'), emp: s('emprestimos'), apo: s('aportes'), rend: s('aplicacoes'), xp: s('transferencias_liquidas'), sem: s('sem_classificacao'), v: s('variacao_caixa'), rendXp: s('rendimento_ficou_na_aplicacao'), pagoXp: s('pago_direto_pela_aplicacao') }; }

// ==================================================================
// O PLACAR — a camada 1 da revisão dos módulos (12/09/2026)
// ==================================================================
// O dono decidiu as 44 linhas da revisão e três telas foram marcadas PLACAR:
// "Esta semana", "A semana" e "Fechamento do mês". Elas não somem hoje — o Placar
// nasce ao lado e precisa provar que diz a mesma coisa antes de substituir
// qualquer uma. Enquanto as duas existirem, os números TÊM de bater: é por isso
// que este módulo não tem conta própria. Ele chama `fxMesCalc` e `fxPonte`, as
// MESMAS funções do Fechamento do mês, e só faz três coisas em cima:
//   1. SOMA vários meses (mês, trimestre, ano até aqui);
//   2. compara com o período anterior do mesmo tamanho E com a meta, juntos;
//   3. abre a quebra por loja, por período e por composição ao clicar no número.
//
// POR QUE MESES FECHADOS. A DRE é mensal e o mês em curso mente (compra do mês
// inteiro contra meia venda). O Fechamento já corta assim; o Placar copia o corte.
//
// A COMPARAÇÃO COM 2025 NÃO EXISTE e a tela diz: as vendas do Saipos começam em
// 02/01/2026. O financeiro vai mais atrás, mas comparar resultado sem venda
// daria meia comparação — pior que nenhuma.
//
// DIVERGÊNCIA DELIBERADA DO DESENHO APROVADO: o protótipo tinha um SELETOR de
// comparação (anterior / meta / 2025). Aqui as duas comparações que existem
// aparecem JUNTAS, porque o cartão tem duas linhas e esconder uma delas atrás de
// um botão só dava trabalho ao leitor. Se o dono quiser o seletor, é meia hora.
let PLC_GRAO = 'mes';        // 'mes' | 'tri' | 'ano'

let PLC_SEL = null;          // chave do periodo escolhido

let PLC_ABERTO = null;       // id do tile aberto na quebra

const PLC_GRAOS = [['mes', 'Mês'], ['tri', 'Trimestre'], ['ano', 'Ano até aqui']];

// Cada tile: o rotulo, como tirar o valor do agregado, se e gasto (gasto que
// sobe e' ruim) e qual meta da `fin_metas_dre` mede ele.
// `telas` e' a TERCEIRA CAMADA: de cada numero do Placar sai o caminho para as telas
// que ja existem e detalham ele. E' assim que o painel vira arvore em vez de lista —
// era a decisao da revisao ("clique num numero abre a quebra; a quebra abre a tela").
const PLC_TILES = [
  { id: 'fat',   rot: 'Faturamento',            un: 'R$', meta: null,          v: a => a.recBruta,
    telas: [['evolucao', 'Evolução de vendas'], ['resumo', 'Resumo do canal iFood']] },
  { id: 'ped',   rot: 'Pedidos',                un: 'n',  meta: null,          v: a => a.pedidos,
    telas: [['evolucao', 'Evolução de vendas'], ['cancelamentos', 'Cancelamentos']] },
  { id: 'merc',  rot: 'Mercadoria',             un: 'R$', meta: 'CUSTO',       v: a => a.grupos.CUSTO,
    telas: [['engcard', 'Engenharia de cardápio'], ['fichas', 'Fichas técnicas'], ['despesas', 'Análise de despesas']] },
  { id: 'canal', rot: 'Custo dos canais',       un: 'R$', meta: null,          v: a => a.taxas,
    def: 'Custo dos canais = o que o iFood e a Rede cobraram: promoções pagas pela loja, anúncios, comissão e taxas. A venda conta cheia, antes da promoção. ',
    telas: [['resumo', 'Resumo do canal iFood'], ['rede', 'Taxas da maquininha'], ['promocoes', 'Promoções']] },
  { id: 'pess',  rot: 'Pessoas',                un: 'R$', meta: 'PESSOAL',     v: a => a.grupos.PESSOAL,
    telas: [['despesas', 'Análise de despesas'], ['cargos', 'Cargos e salários'], ['pcalc', 'Cálculos da folha'], ['rh', 'Descontos em folha']] },
  { id: 'mc',    rot: 'Margem de contribuição', un: 'R$', meta: 'LUCRO_BRUTO', v: a => a.mc,
    def: 'Margem de contribuição = receita líquida − mercadoria, a mesma da DRE. A receita líquida já vem sem o custo dos canais (anúncios dentro), sem comissão de vendedor e sem ICMS. ',
    telas: [['dre', 'DRE'], ['rateio', 'Preço alvo por produto']] },
  { id: 'res',   rot: 'Resultado',              un: 'R$', meta: 'RESULTADO',   v: a => a.resultado,
    telas: [['fechamento', 'Fechamento do mês'], ['dre', 'DRE'], ['lucrouni', 'Lucro por unidade']] },
  { id: 'caixa', rot: 'Caixa',                  un: 'R$', meta: null,          v: a => a.caixa,
    def: 'Caixa = quanto subiu ou caiu na conta, pela ponte que fecha contra o banco. ',
    // lucrouni entra aqui tambem porque ele e' o caixa POR LOJA — a revisao pediu a
    // quebra por loja de Resultado E de Caixa, e e' a unica tela que mostra as duas juntas.
    telas: [['fluxo', 'Fluxo de caixa'], ['lucrouni', 'Caixa por loja'], ['projecao', 'Fluxo projetado'], ['concbanco', 'Conciliação bancária']] },
];

function plcGrao(g) { PLC_GRAO = g; PLC_SEL = null; renderPlacar(); }

function plcPeriodo(c) { PLC_SEL = c; renderPlacar(); }

function plcAbrir(id) { PLC_ABERTO = (PLC_ABERTO === id) ? null : id; renderPlacar(); }

// ---------- O PLACAR MANDA CONTEXTO PARA A CAMADA DE BAIXO (12/09/2026) ----------
// Abrir a tela de quebra sem dizer de QUAL periodo e de QUAL loja o numero veio e' o
// jeito mais rapido de o painel parecer errado: a pessoa clica em "Resultado de agosto"
// e cai numa tela aberta em setembro, com outro numero na cara. Entao o Placar entrega
// o recorte junto com o clique, a tela de baixo se posiciona nele, e um aviso diz de
// onde ela veio — sem o aviso, tela abrindo fora do padrao dela le como defeito.
//
// O contexto e' POR MODULO e sobrevive enquanto a tela continuar naquele recorte. Quem
// mexe no periodo da propria tela solta o contexto (plcCtxSolta), porque a partir dali
// o recorte e' escolha de quem esta olhando, nao heranca do Placar.
let PLC_CTX = {};        // modulo -> { tile, rotTile, meses, rotPeriodo, loja }

let PLC_VISTA = null;    // o recorte que o Placar esta mostrando agora (preenchido no render)

// O filtro de unidade de ANTES do Placar. activeUnidades e' global e e' lido por telas
// que nem mostram o filtro (Evolucao, Frete, Consolidada): sem devolver, a pessoa sai do
// Placar e fica com todas elas presas numa loja, sem ver onde desfazer.
let PLC_UNID_ANTES = null;

function plcAbrirTela(modulo, tileId) {
  const t = PLC_TILES.find(x => x.id === tileId);
  if (PLC_VISTA) PLC_CTX[modulo] = {
    tile: tileId, rotTile: t ? t.rot : '',
    meses: PLC_VISTA.meses.slice(), rotPeriodo: PLC_VISTA.rot, loja: lojaFin(),
  };
  mostrarModulo(modulo);
}

const plcCtx = (modulo) => PLC_CTX[modulo] || null;

const plcCtxSolta = (modulo) => {
  delete PLC_CTX[modulo];
  // quando o ultimo recorte cai, o filtro de unidade volta ao que a pessoa tinha
  if (PLC_UNID_ANTES && !Object.keys(PLC_CTX).length) {
    activeUnidades = PLC_UNID_ANTES; PLC_UNID_ANTES = null;
    renderTopNav(); rebuildLojaOptions();
  }
};

function plcVoltar() { mostrarModulo('placar'); }

// Clicar num preset de periodo SOLTA o recorte — e' escolha da pessoa a partir dali.
// Fica aqui, e nao dentro de aplicarJanela: mostrarModulo tambem chama aplicarJanela,
// e soltar la apagaria o contexto antes de a tela ter chance de ler.
function plcSoltaEAplica(id) { plcCtxSolta(MODULO_ATUAL); aplicarJanela(id); }

function plcCtxLimpar(modulo) { plcCtxSolta(modulo); mostrarModulo(modulo); }

// Quais numeros do Placar esta tela abre por dentro — sai do proprio PLC_TILES, ao
// contrario, entao a lista nunca discorda dos botoes da quebra.
const plcNumerosDaTela = (modulo) =>
  PLC_TILES.filter(t => (t.telas || []).some(([m]) => m === modulo)).map(t => t.rot);

// O cabecalho da tela de quebra. Duas formas: veio do Placar (o aviso do recorte) ou
// nao veio (uma linha dizendo de que numero ela e a quebra). A segunda existe para a
// arvore ficar visivel mesmo para quem entrou pelo menu — camada que so aparece quando
// se chega por um caminho especifico nao e camada, e' atalho.
function plcCabecalhoQuebra(modulo) {
  const c = plcCtx(modulo);
  if (c) return plcChip(modulo);
  const nums = plcNumerosDaTela(modulo);
  if (!nums.length) return '';
  return `<div class="caption-label" style="text-align:center;">Detalha <b>${nums.join('</b> e <b>')}</b>
    <button class="preset-btn" onclick="mostrarModulo('placar')">ver no Placar →</button></div>`;
}

// O aviso que a tela de quebra mostra no topo quando veio do Placar. Vazio quando
// nao veio — a tela continua funcionando sozinha, como sempre funcionou.
function plcChip(modulo) {
  const c = plcCtx(modulo);
  if (!c) return '';
  const loja = c.loja === 'REDE' ? 'Rede' : (({ 'AGUA VERDE': 'Água Verde', 'AHU': 'Ahú', 'SÃO BRAZ': 'São Braz' })[c.loja] || c.loja);
  return `<div class="contexto" style="border-color:var(--brand);">
    <b>${c.rotTile} · ${c.rotPeriodo} · ${loja}</b>
    <button class="preset-btn" onclick="plcVoltar()">← Placar</button>
    <button class="preset-btn" onclick="plcCtxLimpar('${modulo}')">limpar recorte</button>
    </div>`;
}

// Roda `fn` como se a loja escolhida fosse outra. Existe para a quebra por loja
// usar EXATAMENTE a mesma conta do cartao — `fxMesCalc` le `lojaFin()` de fora.
// E' sincrono do comeco ao fim e devolve o valor no `finally`, entao nao ha
// janela em que outra parte do painel veja a loja trocada.
function plcComLoja(loja, fn) {
  const antes = LOJA_PLC;
  LOJA_PLC = loja;
  try { return fn(); } finally { LOJA_PLC = antes; }
}

const plcMesesFechados = () =>
  [...new Set(FX_M.dre.map(r => r.mes))].sort().filter(m => m.slice(0, 7) < mesCorrenteSP());

// Os periodos do grao escolhido, do mais antigo ao mais novo. `completo` diz se o
// balde tem todos os meses que deveria — T3/26 com julho e agosto NAO tem, e
// comparar dois tercos de trimestre com um trimestre inteiro e' a mesma armadilha
// que a tela de Despesas tinha ("caiu 45%" que era so mes faltando).
const PLC_ESPERADO = { mes: 1, tri: 3, ano: 12 };

function plcPeriodos() {
  const ms = plcMesesFechados();
  const esp = PLC_ESPERADO[PLC_GRAO];
  const feito = (chave, rot, meses) => ({ chave, rot, meses, completo: meses.length >= esp });
  if (PLC_GRAO === 'mes') return ms.map(m => feito(m, fxMesRot(m) + '/' + m.slice(2, 4), [m]));
  const g = {};
  if (PLC_GRAO === 'tri') {
    ms.forEach(m => { const t = m.slice(0, 4) + '-T' + (Math.floor((Number(m.slice(5, 7)) - 1) / 3) + 1); (g[t] || (g[t] = [])).push(m); });
    return Object.keys(g).sort().map(t => feito(t, t.slice(5) + '/' + t.slice(2, 4), g[t]));
  }
  ms.forEach(m => { const a = m.slice(0, 4); (g[a] || (g[a] = [])).push(m); });
  return Object.keys(g).sort().map(a => feito(a, a, g[a]));
}

// O PERIODO ANTERIOR E' SEMPRE DO MESMO TAMANHO, colado — a mesma regra do resto
// do painel. Para um trimestre fechado isso da exatamente o trimestre anterior;
// para um trimestre pela metade da os DOIS meses imediatamente antes, que e' a
// unica comparacao honesta que existe. Devolve null quando nao ha meses bastantes.
function plcAnterior(meses) {
  const ms = plcMesesFechados();
  const i = ms.indexOf(meses[0]), n = meses.length;
  if (i < n) return null;
  const anteriores = ms.slice(i - n, i);
  const balde = plcPeriodos().find(p => p.meses.length === n && p.meses[0] === anteriores[0]);
  const rot = balde ? balde.rot
    : (n === 1 ? fxMesRot(anteriores[0]) + '/' + anteriores[0].slice(2, 4)
      : fxMesRot(anteriores[0]) + '–' + fxMesRot(anteriores[n - 1]) + '/' + anteriores[n - 1].slice(2, 4));
  return { meses: anteriores, rot };
}

// SOMA os meses do periodo. Quase tudo em fxMesCalc e aditivo; o que nao e —
// ticket e os percentuais — sai da divisao no fim, que e' a unica forma de nao
// cair na media de media.
function plcAgrega(meses) {
  const partes = meses.map(m => fxMesCalc(m));
  const som = f => partes.reduce((a, p) => a + (Number(f(p)) || 0), 0);
  const grupos = {};
  ['CUSTO', 'PESSOAL', 'VENDA', 'ADMIN'].forEach(k => { grupos[k] = som(p => p.grupos[k]); });
  const canais = {};
  partes.forEach(p => Object.entries(p.canais).forEach(([c, v]) => { canais[c] = (canais[c] || 0) + v; }));
  const recBruta = som(p => p.recBruta), pedidos = som(p => p.pedidos);
  const base = som(p => p.base), taxas = som(p => p.taxasCanais), deducoes = som(p => p.deducoes);
  // 01/10/2026: a receita liquida e' a da DRE — sai tambem a comissao de vendedor
  const comissoes = som(p => p.comissoes);
  const recLiq = base - taxas - comissoes - deducoes;
  const pontes = meses.map(m => fxPonte(m)).filter(Boolean);
  const ps = c => pontes.reduce((a, p) => a + p[c], 0);
  return {
    meses, recBruta, pedidos, ticket: pedidos ? recBruta / pedidos : 0,
    outras: som(p => p.outras), base, taxas, comissoes, deducoes, recLiq, grupos,
    mc: recLiq - grupos.CUSTO, ebitda: som(p => p.ebitda), resultado: som(p => p.resultado),
    benef: som(p => p.benef), temFato: partes.every(p => p.temFato), canais,
    caixa: pontes.length ? ps('v') : null,
    // 28/09/2026: desde que o ajuste de competencia passou a comparar o resultado com
    // (operacao + rendimentos), res + comp inclui o rendimento; tirando ele, sobra a operacao.
    caixaOper: pontes.length ? ps('res') + ps('comp') - ps('rend') : null,
    caixaFora: pontes.length ? ps('rend') + ps('rendXp') + ps('inv') + ps('ret') + ps('emp') + ps('apo') + ps('xp') + ps('pagoXp') + ps('sem') : null,
  };
}

// A meta de um periodo de varios meses e' a media das metas do mes PESADA PELA
// BASE: em fin_metas_dre_mes o custo desce meio ponto por mes ate 32 em fev/27,
// entao um trimestre nao tem uma meta so, tem tres. Media simples daria um
// numero que nao e' a meta de mes nenhum.
function plcMeta(chave, meses) {
  const def = FX_M.metas[chave];
  if (!def) return null;
  let num = 0, den = 0;
  meses.forEach(m => {
    const b = fxMesCalc(m).base;
    const pm = FX_M.metasMes ? FX_M.metasMes[chave + '|' + m] : undefined;
    num += (pm === undefined ? def.meta : pm) * b;
    den += b;
  });
  return den ? { meta: num / den, sentido: def.sentido } : null;
}

// A composicao de cada numero — o terceiro nivel da quebra.
function plcComposicao(id, meses) {
  const L = fxLojas();
  const linhasDre = fxSemListaNaRede(FX_M.dre.filter(r => meses.includes(r.mes) && L.includes(r.unidade)));
  const porTipo = (tipos) => {
    const m = {};
    linhasDre.forEach(r => {
      // COMISSOES nao e' de grupo nenhum desde 01/10/2026: e' deducao da receita (como na DRE)
      if (r.natureza !== 'DESPESAS' || r.tipo === 'INVESTIMENTOS' || !tipos.includes(r.tipo) || r.subtipo === 'COMISSOES') return;
      m[r.subtipo || r.tipo] = (m[r.subtipo || r.tipo] || 0) - (fxN(r.credito) - fxN(r.debito));
    });
    return Object.entries(m).map(([k, v]) => ({ k, v })).sort((a, b) => b.v - a.v);
  };
  if (id === 'fat') {
    const a = plcAgrega(meses);
    return Object.entries(a.canais).map(([k, v]) => ({ k, v })).sort((x, y) => y.v - x.v);
  }
  if (id === 'merc') return porTipo(FX_GRUPOS.CUSTO);
  if (id === 'pess') return porTipo(FX_GRUPOS.PESSOAL);
  // 12/09/2026: os dois baldes que faltavam, para o Fechamento do mes poder abrir
  // "do que e' feito" em todos. E' o MESMO porTipo — conta nova aqui seria a
  // segunda versao do mesmo numero.
  if (id === 'venda') return porTipo(FX_GRUPOS.VENDA);
  if (id === 'admin') return porTipo(FX_GRUPOS.ADMIN);
  if (id === 'canal') {
    // 01/10/2026: com os anuncios — o cartao e o balde agora sao a classe CANAL inteira,
    // e cada cobranca leva o mesmo nome que a DRE mostra ao abrir as deducoes (rotulo)
    const cf = FX_M.canal.filter(r => meses.includes(r.mes) && L.includes(r.unidade) && r.classe === 'CANAL');
    const m = {};
    cf.forEach(r => { const k = r.rotulo || r.linha; m[k] = (m[k] || 0) + fxN(r.custo); });
    return Object.entries(m).map(([k, v]) => ({ k, v })).sort((x, y) => y.v - x.v);
  }
  return null;
}

// 07/10/2026 (dono, Pauta de 06/10): a promocao paga pela loja no iFood saiu do custo dos
// canais — a venda do PDV ja vem com ela descontada — e fica VISIVEL como informativa,
// embaixo da abertura "do que e' feito" (Placar e Fechamento do mes), fora do total.
// So' conta linha de classe INFO: enquanto a view nao for corrigida, devolve zero e a
// promocao segue na lista de cima — nunca aparece nos dois lugares.
function fxPromoInfoHtml(meses) {
  const L = fxLojas();
  const v = FX_M.canal.filter(r => meses.includes(r.mes) && L.includes(r.unidade) && r.linha === 'PROMO_LOJA' && r.classe === 'INFO')
    .reduce((s, r) => s + fxN(r.custo), 0);
  return Math.abs(v) > 0.5 ? `<div class="caption-label" style="text-align:center;">Informativa, não entra no total: promoção paga pela loja no iFood, <b>${fxMil(v)}</b> — já descontada na venda.</div>` : '';
}

async function entrarPlacar() {
  const alvo = document.getElementById('view-placar');
  if (!alvo) return;
  if (!FX_M) {
    alvo.innerHTML = '<div class="contexto">Carregando o placar...</div>';
    await fxCarregarM();
  }
  renderPlacar();
  // A faixa de alertas chega depois, sem segurar os numeros: ela vem de outras
  // quatro fontes e o Placar nao pode esperar por elas para aparecer.
  carregarAlertas().then(renderPlacar).catch(() => {});
}

function renderPlacar() {
  const alvo = document.getElementById('view-placar');
  if (!alvo || !FX_M) return;
  const periodos = plcPeriodos();
  if (!periodos.length) { alvo.innerHTML = '<div class="contexto">Ainda não há mês fechado para montar o placar.</div>'; return; }
  if (!periodos.some(p => p.chave === PLC_SEL)) PLC_SEL = periodos[periodos.length - 1].chave;
  const i = periodos.findIndex(p => p.chave === PLC_SEL);
  const atual = periodos[i], anterior = plcAnterior(atual.meses);
  PLC_VISTA = { meses: atual.meses, rot: atual.rot };   // o recorte que vai junto com o clique

  const A = plcAgrega(atual.meses);
  const B = anterior ? plcAgrega(anterior.meses) : null;
  const rotAnt = anterior ? 'vs ' + anterior.rot : '';

  // a linha dos ultimos 8 periodos, por tile
  // O balde pela metade entra marcado: na linha e na tabela ele parece queda, e
  // nao e' — e' mes faltando. Marcar custa duas palavras e evita a leitura errada.
  const ultimos = periodos.slice(Math.max(0, i - 7), i + 1);
  const serie = ultimos.map(p => ({ rot: p.rot + (p.completo ? '' : ' (parcial)'), chave: p.chave,
                                    n: p.meses.length, completo: p.completo, ag: plcAgrega(p.meses) }));

  const valorDe = (t, ag) => { const v = t.v(ag); return v === null || v === undefined ? null : Number(v); };
  const fmtDe = (t, v) => v === null ? '—' : (t.un === 'n' ? fxInt(v) : fxMil(v));

  // QUAL CARTAO ESTA MAIS LONGE DA META. A ordem dos oito NAO muda: ela e' a leitura de
  // cima para baixo do negocio, e reordenar por distancia esconderia o faturamento. O que
  // muda e' uma marca no que esta mais fora. So quatro tiles tem meta (mercadoria,
  // pessoas, margem de contribuicao e resultado), entao a disputa e' entre esses. E a
  // distancia e' medida CONTRA A PROPRIA META, senao mercadoria (meta perto de 34)
  // ganharia sempre de resultado (meta perto de 10) so pelo tamanho do numero.
  let plcMaisFora = null, plcMaisForaD = 0;
  PLC_TILES.forEach(t => {
    if (!t.meta || t.un !== 'R$' || t.id === 'caixa' || !A.base) return;
    const m = plcMeta(t.meta, atual.meses), v = valorDe(t, A);
    if (!m || !Number(m.meta) || v === null) return;
    const p = Math.abs(v) / A.base * 100;
    const d = (m.sentido === 'abaixo' ? p - m.meta : m.meta - p) / m.meta;
    if (d > plcMaisForaD) { plcMaisForaD = d; plcMaisFora = t.id; }
  });

  const cartoes = PLC_TILES.map(t => {
    const v = valorDe(t, A), vb = B ? valorDe(t, B) : null;
    const meta = t.meta ? plcMeta(t.meta, atual.meses) : null;
    const pctBase = (t.un === 'R$' && t.id !== 'caixa' && A.base) ? Math.abs(v) / A.base * 100 : null;
    let extra = '';
    if (t.id === 'fat') extra = `outras entradas ${fxMil(A.outras)} · tudo que entrou <b>${fxMil(A.base)}</b>`;
    else if (t.id === 'ped') extra = `valor médio do pedido <b>${fxR2(A.ticket)}</b>${B && B.ticket ? ' · ' + fxVar(A.ticket, B.ticket, rotAnt).replace(/<\/?b>/g, '') : ''}`;
    else if (t.id === 'caixa') extra = A.caixa === null ? 'a ponte até o caixa não tem este período'
      : `operação ${fxMil(A.caixaOper)} · fora da operação ${fxMil(A.caixaFora)} (XP, rendimento, investimento, retirada, aporte, empréstimo)`;
    else if (pctBase !== null) extra = `<b>${fxPct1(pctBase)}</b> de cada R$ 100 que entraram`;
    if (meta && pctBase !== null) extra += ' ' + fxPill(fxFarol(pctBase, meta.meta, meta.sentido)) + ` <span style="opacity:.7;">meta ${meta.sentido === 'abaixo' ? 'até' : 'a partir de'} ${fxPct1(meta.meta)}</span>`;
    const vals = serie.map(s => valorDe(t, s.ag)).filter(x => x !== null);
    const rots = serie.filter(s => valorDe(t, s.ag) !== null).map(s => s.rot);
    const sp = vals.length > 2 ? fxSpark(vals, rots, x => t.un === 'n' ? fxInt(x) : fxMil(x)) : '';
    const sel = PLC_ABERTO === t.id;
    const maisFora = plcMaisFora === t.id;
    return `<div class="fx-tile${sel ? ' aberto' : ''}" onclick="plcAbrir('${t.id}')" style="cursor:pointer;${sel ? 'border-color:var(--brand);' : maisFora ? 'border-color:var(--farol-fora);' : ''}" title="${t.def ? t.def : ''}${maisFora ? 'É o número mais longe da meta neste período. ' : ''}${sel ? 'clique para fechar a quebra' : 'clique para abrir a quebra deste número'}">
      <div class="fx-rotulo">${t.rot}${maisFora ? ' <span style="color:var(--farol-fora); font-weight:700;">o mais fora</span>' : ''}${sel ? ' ✕' : ''}</div>
      <div class="fx-valor${v !== null && v < 0 ? ' neg' : ''}">${fmtDe(t, v)}</div>
      <div class="fx-var">${vb !== null && vb !== undefined ? fxVar(v, vb, rotAnt) : '<span style="opacity:.6;">sem período anterior</span>'}</div>
      <div class="fx-extra">${extra}</div>${sp}</div>`;
  }).join('');

  // ---------- a quebra ----------
  let quebra = '';
  if (PLC_ABERTO) {
    const t = PLC_TILES.find(x => x.id === PLC_ABERTO);
    // por loja: a MESMA conta, trocando a loja de fora
    const porLoja = (lojaFin() === 'REDE' ? FX_TODAS : [lojaFin()]).map(u => {
      const ag = plcComLoja(u, () => plcAgrega(atual.meses));
      const agB = anterior ? plcComLoja(u, () => plcAgrega(anterior.meses)) : null;
      const v = valorDe(t, ag), meta = t.meta ? plcComLoja(u, () => plcMeta(t.meta, atual.meses)) : null;
      const pct = (t.un === 'R$' && t.id !== 'caixa' && ag.base) ? Math.abs(v) / ag.base * 100 : null;
      return { u, v, vb: agB ? valorDe(t, agB) : null, pct, meta, base: ag.base };
    });
    const somaLoja = porLoja.reduce((s, l) => s + (l.v || 0), 0);
    // Na REDE a lista entre lojas nao conta (07/10/2026): a soma das tres lojas e o numero da
    // Rede diferem exatamente pela lista. A linha extra mostra essa diferenca em vez de esconder.
    // O numero da Rede e' calculado SEMPRE, com qualquer loja escolhida la em cima: a tabela
    // mostra as tres lojas e o total tem de ser o mesmo nos dois casos. So a mercadoria difere.
    const redeV = t.id === 'merc' && lojaFin() === 'REDE' ? valorDe(t, A) : null;
    const listaFora = redeV !== null ? somaLoja - redeV : 0;
    const temListaFora = Math.abs(listaFora) > 0.5;
    // CAIXA NAO TEM "de cada R$ 100" nem parte do total: ele pode ser negativo, e
    // "-36,8% do caixa da rede" nao quer dizer nada. Coluna vazia e' melhor que
    // numero que o leitor tenta interpretar. Medido na tela em 12/09: o Ahu deu
    // -R$ 5.161 e a coluna dizia -36,8%.
    const temPct = t.un === 'R$' && t.id !== 'caixa';
    const rotCol = temPct ? 'de cada R$ 100' : t.un === 'n' ? 'parte do total' : '';
    const tabLoja = `<div id="tabelaPlacarLoja"><table>
      <tr><th>Loja</th><th>${t.rot}</th><th>${rotCol || '&nbsp;'}</th><th>vs ${anterior ? anterior.rot : '—'}</th><th>meta</th></tr>
      ${porLoja.map(l => `<tr><td>${({ 'AGUA VERDE': 'Água Verde', 'AHU': 'Ahú', 'SÃO BRAZ': 'São Braz' })[l.u] || l.u}</td>
        <td>${fmtDe(t, l.v)}</td>
        <td>${temPct ? fxPct1(l.pct) : (t.un === 'n' && somaLoja > 0 ? fxPct1((l.v || 0) / somaLoja * 100) : '—')}</td>
        <td>${l.vb !== null && l.vb !== undefined ? fxVar(l.v, l.vb, '') : '—'}</td>
        <td>${l.meta && l.pct !== null ? fxPill(fxFarol(l.pct, l.meta.meta, l.meta.sentido)) : '—'}</td></tr>`).join('')}
      ${temListaFora ? `<tr><td>(−) mercadoria entre as lojas (não conta na Rede)</td><td>${fmtDe(t, -listaFora)}</td><td>—</td><td>—</td><td>—</td></tr>` : ''}
      ${lojaFin() === 'REDE' ? `<tr class="liq"><td>REDE (as três)</td><td>${fmtDe(t, temListaFora ? redeV : somaLoja)}</td><td>—</td><td>—</td><td>—</td></tr>` : ''}
    </table></div>`;

    const tabPer = `<div id="tabelaPlacarPeriodo"><table>
      <tr><th>${PLC_GRAO === 'mes' ? 'Mês' : PLC_GRAO === 'tri' ? 'Trimestre' : 'Ano'}</th><th>${t.rot}</th><th>${temPct ? 'de cada R$ 100' : '&nbsp;'}</th><th>vs anterior</th></tr>
      ${serie.map((s, k) => {
        const v = valorDe(t, s.ag);
        // so compara balde com balde do MESMO tamanho — senao a coluna vira mes faltando
        const mesmoTam = k > 0 && serie[k - 1].n === s.n;
        const ant = mesmoTam ? valorDe(t, serie[k - 1].ag) : null;
        const pct = (t.un === 'R$' && t.id !== 'caixa' && s.ag.base) ? Math.abs(v) / s.ag.base * 100 : null;
        // A LINHA DO PERIODO E' O BOTAO: clicar leva o Placar inteiro para aquele
        // periodo, com a quebra aberta no mesmo numero. A linha do periodo que ja esta
        // na tela nao clica, porque e' onde a pessoa esta.
        const eAtual = s.chave === atual.chave;
        return `<tr${eAtual ? ' class="sub"' : ''}${eAtual ? '' : ` onclick="plcPeriodo('${s.chave}')" style="cursor:pointer;"`} title="${eAtual ? 'É o período que o Placar está mostrando agora.' : 'Clique para levar o Placar inteiro para ' + s.rot + '.'}"><td>${s.rot}${s.completo ? '' : ` <span style="opacity:.7;">${s.n} de ${PLC_ESPERADO[PLC_GRAO]} meses</span>`}</td><td>${fmtDe(t, v)}</td>
          <td>${pct !== null ? fxPct1(pct) : '—'}</td><td>${ant !== null && ant !== undefined ? fxVar(v, ant, '') : '—'}</td></tr>`;
      }).join('')}
    </table></div>`;

    const comp = plcComposicao(t.id, atual.meses);
    const totComp = comp ? comp.reduce((s, c) => s + c.v, 0) : 0;
    const tabComp = comp && comp.length ? `<div class="section-label">Do que é feito</div>
      <div id="tabelaPlacarComp"><table>
        <tr><th>${t.id === 'fat' ? 'Canal' : t.id === 'canal' ? 'Cobrança' : 'Conta'}</th><th>Valor</th><th>parte do total</th></tr>
        ${comp.map(c => `<tr><td>${c.k}</td><td>${fxMil(c.v)}</td><td>${totComp ? fxPct1(c.v / totComp * 100) : '—'}</td></tr>`).join('')}
        <tr class="liq"><td>TOTAL</td><td>${fxMil(totComp)}</td><td>100,0%</td></tr>
      </table></div>` : '';

    quebra = `<div class="contexto" style="border-color:var(--brand);">
        <b>Abrindo ${t.rot}</b> — ${atual.rot}. <button class="preset-btn" onclick="plcAbrir('${t.id}')">fechar</button>
      </div>
      <div class="section-label">Por loja</div>
      <div class="caption-label" style="text-align:center;">A mesma conta do cartão, uma loja de cada vez. O filtro de loja lá em cima não muda esta tabela — ela mostra sempre as três.</div>
      ${tabLoja}
      <div class="section-label">Período a período</div>
      <div class="caption-label" style="text-align:center;" title="A linha troca o período do Placar inteiro: cartões, comparação e quebra vão junto.">Clique num período para o Placar inteiro ir até ele.</div>
      ${tabPer}
      ${tabComp}${t.id === 'canal' ? fxPromoInfoHtml(atual.meses) : ''}
      ${(t.telas || []).length ? `<div class="section-label">Onde ver por dentro</div>
        <div class="caption-label" style="text-align:center;" title="As telas que já existem e detalham este número; elas dizem no topo de qual período e de qual loja vieram.">Abrem no mesmo período e na mesma loja.</div>
        <div class="periodo-presets" style="margin-top:8px;">${t.telas.map(([m, rot]) =>
          `<button class="preset-btn" onclick="plcAbrirTela('${m}','${t.id}')">${rot} →</button>`).join('')}</div>` : ''}`;
  }

  const segGrao = PLC_GRAOS.map(([g, rot]) =>
    `<button class="preset-btn ${PLC_GRAO === g ? 'active' : ''}" onclick="plcGrao('${g}')">${rot}</button>`).join('');
  const segPer = periodos.slice(-14).map(p =>
    `<button class="preset-btn ${PLC_SEL === p.chave ? 'active' : ''}" onclick="plcPeriodo('${p.chave}')">${p.rot}</button>`).join('');

  // no celular os avisos e a explicação vêm depois dos números
  const plcCel = matchMedia('(max-width:760px)').matches;
  const plcAvisos = (() => { const b = blocoAlertas(); return b ? `<div class="section-label">O que precisa de você agora</div>
      <div class="caption-label" style="text-align:center;">A mesma faixa da tela "Esta semana" — aqui e lá ela é a mesma conta, não uma cópia. Clique no aviso para ir direto na tela dele.</div>${b}` : ''; })() + seletorLojaFin();
  alvo.innerHTML = `
    <div class="section-label" style="border-top:none; margin-top:0; padding-top:0;">O Placar — ${nomeLojaFin()} · ${atual.rot}</div>
    <div class="caption-label cel-esconde" style="text-align:center;">Contra o período anterior e contra a meta. <b>Clique num número para abrir.</b></div>
    ${plcCel ? '' : plcAvisos}
    <div class="periodo-presets" style="margin-top:10px;">${segGrao}</div>
    <div class="periodo-presets plc-per" style="margin-top:6px;">${segPer}</div>
    ${atual.completo ? '' : `<div class="contexto" style="border-color:var(--amber-2);">
      <b>${atual.rot} tem ${atual.meses.length} de ${PLC_ESPERADO[PLC_GRAO]} meses</b> (${atual.meses.map(m => fxMesRot(m)).join(', ')}).
      Por isso a comparação é com ${anterior ? anterior.rot : '—'}, do mesmo tamanho.</div>`}
    ${A.temFato ? '' : `<div class="contexto" style="border-color:var(--amber-2);">Custo dos canais neste período é vendido − recebido, não cobrança a cobrança.</div>`}
    <div class="fx-tiles">${cartoes}</div>
    ${plcCel ? plcAvisos : ''}
    ${lojaFin() === 'REDE' && plcCel ? `<div class="section-label">Lado a lado · ${atual.rot}</div>
    <div id="tabelaPlacarLado" class="plc-lado-cel"><table><tr><th>Em R$</th>${[...FX_TODAS, 'REDE'].map((u) => `<th>${u === 'REDE' ? 'Rede' : lojaNome(u)}</th>`).join('')}</tr>
      ${PLC_TILES.map((t) => `<tr><td>${t.rot}</td>${[...FX_TODAS, 'REDE'].map((u) => { const ag = u === 'REDE' ? A : plcComLoja(u, () => plcAgrega(atual.meses)); return `<td>${String(fmtDe(t, valorDe(t, ag))).replace('R$ ', '')}</td>`; }).join('')}</tr>`).join('')}</table></div>` : ''}
    ${lojaFin() === 'REDE' && !plcCel ? `<div class="section-label">Lado a lado · ${atual.rot}</div>
    <div id="tabelaPlacarLado" style="overflow-x:auto;"><table><tr><th>Loja</th>${PLC_TILES.map((t) => `<th>${t.rot}</th>`).join('')}</tr>
      ${FX_TODAS.map((u) => { const ag = plcComLoja(u, () => plcAgrega(atual.meses)); return `<tr><td>${lojaNome(u)}</td>${PLC_TILES.map((t) => `<td>${fmtDe(t, valorDe(t, ag))}</td>`).join('')}</tr>`; }).join('')}
      <tr class="liq"><td>${lojaNome('REDE')}</td>${PLC_TILES.map((t) => `<td>${fmtDe(t, valorDe(t, A))}</td>`).join('')}</tr></table></div>` : ''}
    ${quebra}
    <div class="caption-label" title="Sem comparação com 2025: a venda começa em 02/01/2026.">
      Só meses fechados — o último é ${fxMesLongo(plcMesesFechados()[plcMesesFechados().length - 1])}, na mesma conta do Fechamento do mês.
    </div>`;
  const plcPerAtivo = alvo.querySelector('.plc-per .active');   // no celular a fila de meses rola de lado: abre no escolhido
  if (plcPerAtivo) plcPerAtivo.parentElement.scrollLeft = plcPerAtivo.offsetLeft - plcPerAtivo.parentElement.offsetLeft - 40;
}

function renderFechamento() {
  const alvo = document.getElementById('view-fechamento');
  const meses = [...new Set(FX_M.dre.map(r => r.mes))].sort().filter(m => m.slice(0, 7) < mesCorrenteSP());
  if (!meses.includes(FX_MES_SEL)) FX_MES_SEL = meses[meses.length - 1];
  const mes = FX_MES_SEL, iM = meses.indexOf(mes), ant = meses[iM - 1];
  const a = fxMesCalc(mes), j = ant ? fxMesCalc(ant) : null;
  const rotAnt = ant ? `em relação a ${fxMesLongo(ant)}` : '';
  const serie = meses.map(fxMesCalc);
  const rots = meses.map(fxMesRot);
  // 01/10/2026 (dono: "o mesmo numero tem de ser o mesmo em toda tela"): a meta e' a DO
  // MES quando ela existe em fin_metas_dre_mes (o custo desce meio ponto por mes ate 32 em
  // fev/27), senao a geral — a mesma regra do Placar (plcMeta). Ate aqui o Fechamento lia
  // so a geral: de outubro em diante o mesmo mes sairia "dentro" aqui e "fora" no Placar.
  const M = {};
  Object.entries(FX_M.metas).forEach(([k, g]) => {
    const pm = FX_M.metasMes ? FX_M.metasMes[k + '|' + mes] : undefined;
    M[k] = { sentido: g.sentido, meta: pm === undefined ? g.meta : pm };
  });
  const cem = v => a.base ? v / a.base * 100 : 0;
  let h = seletorLojaFin();
  h += `<div class="fx-cab-topo"><div><div class="fx-rotulo">Fechamento do mês · ${nomeLojaFin()}</div><h2 class="fx-h1">${fxMesLongo(mes)[0].toUpperCase() + fxMesLongo(mes).slice(1)} de ${mes.slice(0, 4)} em uma página</h2>
    <div class="fx-sub">Quanto vendeu, para onde foi cada R$ 100, quanto sobrou e o caixa — sempre contra o mês anterior.</div></div>
    ${fxSeg('fxMes', meses.map(m => [m, fxMesRot(m)]), mes)}</div>`;
  // 1. quanto vendeu
  const maior = serie.reduce((m, x) => x.recBruta > m.recBruta ? x : m, serie[0]);
  h += `<div class="fx-secao"><h3>1. Quanto vendeu</h3><span>venda cheia: caixa das lojas + promoção paga pela loja</span></div><div class="fx-tiles">`
    + fxTile('Vendas do mês', a.recBruta, j ? fxVar(a.recBruta, j.recBruta, rotAnt) : '', `${j ? `${fxMesRot(ant)}: ${fxMil(j.recBruta)} · ` : ''}maior mês: ${fxMesRot(maior.mes)}, ${fxMil(maior.recBruta)}`, fxSpark(serie.map(x => x.recBruta), rots, fxMil),
      `<ul class="fx-lista">${Object.entries(a.canais).sort((x, y) => y[1] - x[1]).filter(([, v]) => v >= 1).map(([c, v]) => `<li><span>${c}</span><b>${fxMil(v)} · ${fxPct1(v / a.recBruta * 100)}</b></li>`).join('')}</ul>`)
    + fxTile('Pedidos', fxInt(a.pedidos), j ? fxVar(a.pedidos, j.pedidos, rotAnt) : '', j ? `${fxMesRot(ant)}: ${fxInt(j.pedidos)} pedidos` : '', fxSpark(serie.map(x => x.pedidos), rots, fxInt))
    + fxTile('Valor médio por pedido', fxR2(a.ticket), j ? fxVar(a.ticket, j.ticket, rotAnt) : '', j ? `${fxMesRot(ant)}: ${fxR2(j.ticket)}` : '', fxSpark(serie.map(x => x.ticket), rots, v => 'R$ ' + v.toFixed(0)))
    + '</div>';
  const nomesOutras = { 'RECEITAS REVENDA': 'atacado', 'LISTAS SAO BRAZ': 'mercadoria vendida ao São Braz', 'LISTAS AHU': 'mercadoria vendida ao Ahú', 'RECEITAS BOQUEIRAO': 'royalties do Boqueirão', 'OUTRAS RECEITAS': 'eventos e outros' };
  h += `<div class="fx-nota">${a.outras > 0.5 ? `Além das vendas, entraram <b>${fxMil(a.outras)}</b> de outras receitas (${Object.entries(a.outrasDet).filter(([, v]) => Math.abs(v) > 0.5).sort((x, y) => y[1] - x[1]).map(([k, v]) => `${nomesOutras[k] || k.toLowerCase()} ${fxMil(v)}`).join(', ')}). Somando tudo, o mês movimentou <b>${fxMil(a.base)}</b>; é sobre esse total que a seção 2 divide os R$ 100.` : `O total do mês é <b>${fxMil(a.base)}</b>; é sobre ele que a seção 2 divide os R$ 100.`}</div>`;
  // 2. de cada R$ 100
  const baldes = x => [['CUSTO', 'Mercadoria', 'insumos, bebidas, embalagens (inclusive as de envio)', x.grupos.CUSTO], ['PESSOAL', 'Pessoas', 'salários, encargos, pró-labore', x.grupos.PESSOAL],
    ['VENDA', 'Entrega, comercial e marketing', 'motoboys, marketing, fretes', x.grupos.VENDA], ['ADMIN', 'A casa', 'aluguel, energia, gás, manutenção, sistemas', x.grupos.ADMIN],
    // 01/10/2026: o balde TAXAS e' a linha "(−) DEDUCOES DA RECEITA" da DRE, inteira
    ['TAXAS', 'Taxas dos canais e impostos', 'anúncios, taxas do iFood e dos cartões, comissões, ICMS', x.taxasCanais + x.comissoes + x.deducoes],
    ['OUTROS', 'Juros, tarifas e outros', '', x.despFin - x.semClass + x.irpj + x.outrasDesp],
    // 28/09/2026 (dono): o rendimento vira linha propria, "entrada nao operacional". Antes ele
    // era descontado de "Juros, tarifas e outros" e deixava o balde negativo.
    ['REND', 'Rendimento aplicações', 'entrada não operacional: XP e contas correntes', -x.recFin]]
    // b[3] e' o "de cada R$ 100" que a secao mostra; b[4] guarda o mesmo balde em
    // REAIS, que e' o total com que a composicao tem de fechar. Sem ele a abertura
    // refaria a conta do balde — segunda versao do mesmo numero.
    .map(b => [b[0], b[1], b[2], x.base ? b[3] / x.base * 100 : 0, b[3]]);
  const ba = baldes(a), bj = j ? baldes(j) : null;
  const maxv = Math.max(...ba.map(b => Math.abs(b[3])), Math.abs(cem(a.resultado)), 1);
  const reais = v => (v < -0.5 ? '−R$ ' : 'R$ ') + Math.abs(Math.round(v));
  // O balde REND guarda o rendimento com o sinal dos baldes (entrada = negativo). Na tela ele
  // aparece com o sinal do dinheiro: + quando entrou, − quando o mes teve rendimento negativo.
  const reaisB = (id, v) => id === 'REND' ? (v > 0.5 ? '−R$ ' : '+R$ ') + Math.abs(Math.round(v)) : reais(v);
  let somaArr = 0;
  h += `<div class="fx-secao"><h3>2. De cada R$ 100 que entraram, para onde foram</h3><span>${fxMesLongo(mes)}${ant ? `, com ${fxMesLongo(ant)} ao lado` : ''}</span></div><div class="fx-cem">`;
  // QUAL BALDE ESTA MAIS LONGE DA META. A ordem das linhas nao muda (ela e' o tamanho do
  // balde, e trocar por distancia esconderia o maior gasto); o que entra e' uma marca na
  // linha. A distancia e' medida CONTRA A PROPRIA META, senao Mercadoria (meta perto de
  // 34,5) ganharia sempre de Pessoas (meta perto de 24) so por ser o balde maior.
  let piorBalde = null, piorDist = 0;
  ba.forEach(b => {
    const m = M[b[0]];
    if (!m || !Number(m.meta)) return;
    const d = (m.sentido === 'abaixo' ? b[3] - m.meta : m.meta - b[3]) / m.meta;
    if (d > piorDist) { piorDist = d; piorBalde = b[0]; }
  });
  // TAXAS so abre quando o mes tem o custo dos canais por FATO: sem ele o balde e'
  // a diferenca entre vendido e recebido, que nao tem composicao nenhuma.
  const podeAbrir = (id) => !!FX_COMPOSICAO[id] && (id !== 'TAXAS' || a.temFato);
  if (FX_BALDE && !podeAbrir(FX_BALDE)) FX_BALDE = null;
  ba.forEach((b, i) => {
    if ((b[0] === 'OUTROS' || b[0] === 'REND') && Math.abs(b[3]) < 0.5) return;
    somaArr += Math.round(b[3]);
    const m = M[b[0]]; const f = m ? fxFarol(b[3], m.meta, m.sentido) : null;
    const pior = b[0] === piorBalde;
    const abre = podeAbrir(b[0]);
    const aberto = FX_BALDE === b[0];
    const marca = aberto ? 'var(--brand)' : pior ? 'var(--farol-fora)' : null;
    const attr = (abre ? ` onclick="fxAbrirBalde('${b[0]}')"` : '')
      + ((abre || marca) ? ` style="${abre ? 'cursor:pointer;' : ''}${marca ? ` box-shadow:inset 3px 0 0 ${marca};` : ''}"` : '')
      + (abre ? ` title="${aberto ? 'Clique para fechar a composição deste balde.' : 'Clique para ver do que é feito este balde.'}"` : '');
    h += `<div class="fx-linha"${attr}><div class="fx-nome">${b[1]}${aberto ? ' ✕' : ''}<small>${b[2]}${m ? ` · meta: até R$ ${m.meta}` : ''}</small></div><div class="fx-num">${reaisB(b[0], b[3])}</div><div class="fx-barra"><i style="width:${Math.max(0, Math.abs(b[3])) / maxv * 100}%"></i></div><div class="fx-jul">${bj ? `${fxMesRot(ant)}: ${reaisB(b[0], bj[i][3])}` : ''}${f ? ' · ' + fxPill(f) : ''}${pior ? ' · <b style="color:var(--farol-fora);" title="Entre os baldes que têm meta, é o que está mais longe da sua.">o mais fora</b>' : ''}</div></div>`;
  });
  const fs = M.RESULTADO ? fxFarol(cem(a.resultado), M.RESULTADO.meta, M.RESULTADO.sentido) : ['neutro', ''];
  h += `<div class="fx-linha sobrou ${fs[0]}"><div class="fx-nome">Sobrou<small>meta: R$ ${M.RESULTADO ? M.RESULTADO.meta : '—'} ou mais de cada 100</small></div><div class="fx-num">R$ ${100 - somaArr}</div><div class="fx-barra"><i style="width:${Math.max(0, cem(a.resultado)) / maxv * 100}%"></i></div><div class="fx-jul">${j ? `${fxMesRot(ant)}: R$ ${Math.round(j.base ? j.resultado / j.base * 100 : 0)}` : ''} · ${fxPill(fs)}</div></div></div>`;
  h += `<div class="fx-nota">Valores arredondados para o real, por isso a soma fecha em 100 no "Sobrou" — o rendimento entra somando, as outras linhas saindo.${a.temFato ? ` As taxas dos canais são o que o iFood e a Rede cobraram de fato no mês (cada cobrança com nome), não a diferença entre vendido e recebido — por isso o mês não oscila com o atraso dos repasses.${Math.abs(a.defasagem) > 500 ? ` Conferência: caiu na conta ${fxMil(Math.abs(a.defasagem))} ${a.defasagem > 0 ? 'a menos' : 'a mais'} do que a venda do mês menos essas cobranças — é repasse atravessando a virada do mês (e a taxa dos vales, que ainda não tem fonte).` : ''}` : ''}</div>`;
  // "DO QUE E' FEITO ESTE BALDE" — abre embaixo da secao 2, no mesmo lugar para
  // qualquer balde, e fecha no ✕. A composicao vem de plcComposicao, a MESMA do
  // Placar. O que nao aparece na lista de contas entra numa linha de resto com nome
  // proprio, para o TOTAL fechar com o balde da linha de cima.
  if (FX_BALDE && podeAbrir(FX_BALDE)) {
    const bSel = ba.find(x => x[0] === FX_BALDE) || ['', FX_BALDE, '', 0, 0];
    const comp = (plcComposicao(FX_COMPOSICAO[FX_BALDE], [mes]) || []).filter(c => Math.abs(c.v) > 0.5);
    // 01/10/2026: a comissao de vendedor entra em TAXAS com nome proprio (como na DRE),
    // em vez de sumir na linha de resto junto com o ICMS.
    if (FX_BALDE === 'TAXAS' && Math.abs(a.comissoes) > 0.5) comp.push({ k: 'Comissões de vendedores', v: a.comissoes });
    // 09/10/2026 (dono): o frete do iFood entra em VENDA com o nome de cada linha (Full Service e sob
    // demanda), como na DRE, em vez de uma linha de resto chamada "entrega sob demanda".
    if (FX_BALDE === 'VENDA') {
      const fretes = {};
      FX_M.canal.filter(r => r.mes === mes && fxLojas().includes(r.unidade) && r.classe === 'LOGISTICA')
        .forEach(r => { const k = r.rotulo || r.linha; fretes[k] = (fretes[k] || 0) + fxN(r.custo); });
      Object.entries(fretes).forEach(([k, v]) => { if (Math.abs(v) > 0.5) comp.push({ k, v }); });
    }
    const resto = bSel[4] - comp.reduce((s, c) => s + c.v, 0);
    const linhasComp = Math.abs(resto) > 0.5
      ? comp.concat([{ k: FX_RESTO_ROT[FX_BALDE] || 'outros lançamentos deste balde', v: resto }])
      : comp;
    const totComp = linhasComp.reduce((s, c) => s + c.v, 0);
    h += `<div class="fx-secao"><h3>Do que é feito: ${bSel[1]}</h3><span>${fxMesLongo(mes)} de ${mes.slice(0, 4)} · ${nomeLojaFin()}</span></div>
      <div class="contexto" style="border-color:var(--brand);">
        <b>${bSel[1]}</b> — ${fxMil(totComp)} no mês, R$ ${Math.round(bSel[3])} de cada R$ 100 que entraram.
        <button class="preset-btn active" onclick="fxAbrirBalde('${FX_BALDE}')">${bSel[1]} ✕</button>
        <div style="font-size:12px; color:var(--tx-3); margin-top:6px;" title="É a mesma abertura que o Placar mostra ao abrir este número, no mesmo mês e na mesma loja escolhida aqui em cima. O total fecha com o balde: o que não vem do plano de contas aparece na última linha, com nome.">
          A mesma conta do balde, aberta conta a conta.
        </div>
      </div>
      <div id="tabelaFxBalde"><table>
        <tr><th>Conta</th><th>Valor</th><th>parte do balde</th><th title="O mesmo R$ de cada 100 da seção 2, agora conta a conta.">de cada R$ 100</th></tr>
        ${linhasComp.map(c => `<tr><td>${c.k}</td><td>${fxMil(c.v)}</td>
          <td>${totComp ? fxPct1(c.v / totComp * 100) : '—'}</td>
          <td>${a.base ? 'R$ ' + Math.round(c.v / a.base * 100) : '—'}</td></tr>`).join('')}
        <tr class="liq"><td>TOTAL</td><td>${fxMil(totComp)}</td><td>100,0%</td><td>${a.base ? 'R$ ' + Math.round(totComp / a.base * 100) : '—'}</td></tr>
      </table></div>${FX_BALDE === 'TAXAS' ? fxPromoInfoHtml([mes]) : ''}`;
  }
  // 3. quanto sobrou
  const serieRes = serie.map(x => x.resultado);
  h += `<div class="fx-secao"><h3>3. Quanto sobrou</h3><span>o resultado do mês</span></div><div class="fx-duas">
    <div class="fx-destaque"><div class="fx-rotulo">Sobrou em ${fxMesLongo(mes)}</div><div class="fx-valor-g${a.resultado < 0 ? ' neg' : ''}">${fxMil(a.resultado)}</div>
      <p>De cada R$ 100 que entraram, sobraram <b>R$ ${Math.round(cem(a.resultado))}</b>. A meta é R$ ${M.RESULTADO ? M.RESULTADO.meta : '—'} ou mais — ${fxPill(fs)}</p>
      ${j ? `<p>Em ${fxMesLongo(ant)} sobraram <b>${fxMil(j.resultado)}</b> (R$ ${Math.round(j.base ? j.resultado / j.base * 100 : 0)} de cada 100). O que sobrou ${fxVar(a.resultado, j.resultado, rotAnt)}.</p>` : ''}
      ${a.benef > 0.5 ? `<p><b>${fxMil(a.benef)}</b> desse valor é comissão que o iFood deixou de cobrar (a isenção, que pela estimativa acaba em dezembro). Sem a isenção, teria sobrado <b>${fxMil(a.resultado - a.benef)}</b>${a.resultado - a.benef < 0 ? ' — ou seja, faltaria dinheiro' : ''}.</p>` : ''}</div>
    <div class="fx-tile"><div class="fx-rotulo">Quanto sobrou, mês a mês</div><div class="fx-valor" style="font-size:20px">${serie.slice(-3).map(x => fxMil(x.resultado).replace('R$ ', '')).join(' · ')}</div><div class="fx-extra">últimos três meses</div>${fxSpark(serieRes, rots, fxMil)}<div class="fx-extra" style="margin-top:8px">Melhor mês: ${rots[serieRes.indexOf(Math.max(...serieRes))]} (${fxMil(Math.max(...serieRes))}). Pior: ${rots[serieRes.indexOf(Math.min(...serieRes))]} (${fxMil(Math.min(...serieRes))}).</div></div></div>`;
  // 4. caixa
  const p = fxPonte(mes);
  h += `<div class="fx-secao"><h3>4. E no caixa?</h3><span>o dinheiro de verdade nas contas e cofres do dia a dia</span></div>`;
  if (p) {
    // 12/09/2026: este rotulo dizia "o resultado da secao 3" e mostrava OUTRO numero
    // (ago/AV: 96,6 mil na secao 3 contra 60,4 mil aqui), porque a secao 3 migrou
    // para o custo dos canais POR FATO e a ponte tinha ficado nas deducoes lancadas.
    // A ponte foi migrada no mesmo dia (vw_fin_resultado_fato), entao os dois numeros
    // voltaram a ser o mesmo. O guarda continua: se um dia divergirem de novo, a tela
    // diz qual base e qual em vez de apontar para uma secao que mostra outra coisa.
    const difPonte = a.resultado - p.res;
    const bateSecao3 = Math.abs(difPonte) <= 500;
    const itens = [[bateSecao3 ? 'Sobrou no papel (o resultado da seção 3)' : 'Resultado por outra base',
      p.res, bateSecao3 ? (a.recFin > 0.5 ? `inclui ${fxMil(a.recFin)} de rendimento aplicações` : '') : 'base diferente da seção 3 — veja a nota abaixo'], ['Contas de outros meses pagas no mês, ou do mês ainda por pagar', p.comp, 'negativo = o mês pagou mais do que gerou de conta'],
      ['Investimentos (obras, máquinas, tecnologia)', p.inv, 'vira patrimônio, não some'], ['Retiradas dos sócios', p.ret, ''], ['Dinheiro entre as lojas (lucro e bônus repassados, aportes)', p.apo, ''],
      p.xp > 0.5
        ? ['Transferência sem contrapartida — conferir', p.xp, 'entrou como transferência e não saiu de nenhuma outra conta: costuma ser lançamento com categoria errada']
        : ['Lucro enviado para a XP', p.xp, 'o que sobra nas lojas vai para o Itaú AV, daí para a Participações e para a XP'],
      ['Rendimento aplicações que ficou na XP', p.rendXp, 'rendeu lá dentro e não passou pelas contas do dia a dia'],
      ['Pago direto pela XP', p.pagoXp, 'imposto, retirada ou compra paga da XP — já está nas linhas de cima'], ['Empréstimos', p.emp, ''], ['Sem classificação', p.sem, 'lançamento sem conta — deveria ser zero']].filter(([, x]) => Math.abs(x) > 0.5);
    h += `<div class="fx-caixa"><div class="fx-rotulo">O caixa do dia a dia em ${fxMesLongo(mes)}</div><div class="fx-valor${p.v < 0 ? ' neg' : ''}">${p.v >= 0 ? 'cresceu' : 'encolheu'} ${fxMil(Math.abs(p.v))}</div><ul>${itens.map(([n, x, s2]) => `<li><span>${n}${s2 ? `<small>${s2}</small>` : ''}</span><b>${x >= 0 ? '+ ' : '− '}${fxMil(Math.abs(x))}</b></li>`).join('')}<li class="res"><span><b>= caixa do dia a dia</b><small>bancos, cofres e cartões; XP e Participações ficam de fora</small></span><b>${p.v >= 0 ? '+ ' : '− '}${fxMil(Math.abs(p.v))}</b></li></ul></div>`;
    if (!bateSecao3) h += `<div class="fx-nota"><b>Por que a primeira linha não é o número da seção 3.</b>
      A seção 3 diz que sobraram <b>${fxMil(a.resultado)}</b> e esta conta começa em <b>${fxMil(p.res)}</b>.
      As duas contas descontam o que os canais cobraram de formas diferentes. A ponte fecha contra o movimento
      real das contas, então o caixa do fim está certo — mas as duas bases precisam voltar a ser a mesma.</div>`;
    else h += `<div class="fx-nota">Esta conta parte do mesmo resultado da seção 3 e termina na variação real das
      contas e cofres, sem sobra. Cada degrau é o que separa o que a operação gerou do dinheiro que de fato ficou.</div>`;
  } else h += '<div class="fx-nota">Sem ponte de caixa para esta loja neste mês.</div>';
  // As contas batem com o banco? (03/09/2026) — o mês só está fechado de verdade
  // se o saldo de cada conta no Saipos bate com o saldo declarado pelo banco no
  // fim do mês (a XP confere pelo saldo informado da corretora). É a conferência
  // que a planilha antiga fazia. Fonte: vw_fin_fechamento_saldo_mensal.
  const confMes = (DFC_CONF || []).filter(r => r.mes.slice(0, 7) === mes.slice(0, 7));
  if (confMes.length) {
    const comRef = confMes.filter(r => r.situacao !== 'SEM EXTRATO').sort((x, y) => x.ordem - y.ordem);
    const okC = comRef.filter(r => r.situacao === 'BATEU'), difC = comRef.filter(r => r.situacao === 'DIFERE');
    const semC = confMes.filter(r => r.situacao === 'SEM EXTRATO');
    const dd = s => s ? s.slice(8, 10) + '/' + s.slice(5, 7) : '';
    h += `<div class="fx-tile" style="margin-top:12px"><div class="fx-rotulo">As contas batem com o banco?</div>
      <div class="fx-valor${difC.length ? ' neg' : ''}" style="font-size:20px">${okC.length} de ${comRef.length} contas batem${difC.length ? ` · ${difC.length} difere${difC.length > 1 ? 'm' : ''}` : ''}</div>
      <div class="fx-extra">saldo do Saipos no fim do mês contra o saldo declarado pelo banco, conta a conta (a XP, contra o saldo da corretora). Conta que difere tem lançamento faltando ou sobrando — é o que a conferência da planilha antiga garantia.</div>
      <ul class="fx-lista">${comRef.map(r => { const d = Number(r.diferenca); return `<li><span>${r.conta_exibida}<small>saldo em ${dd(r.ref_fim_data)}${r.ancora_antes_do_fim ? ' — o extrato não cobre o fim do mês' : ''}${r.situacao === 'BATEU' && r.explicacao && Math.abs(d) > 0.015 ? ' — diferença de data já explicada: ' + r.explicacao : ''}</small></span><b>${r.situacao === 'BATEU' ? '✓ bate' : (d < 0 ? 'faltam R$ ' + fmt(-d) + ' de lançamento' : 'R$ ' + fmt(d) + ' lançados a mais')}</b></li>`; }).join('')}
      ${semC.length ? `<li><span>sem extrato para conferir<small>${semC.map(r => r.conta_exibida).join(', ')}</small></span><b>—</b></li>` : ''}</ul>
      ${difC.length ? `<div style="margin-top:10px;"><button class="preset-btn" onclick="mostrarModulo('concbanco')"
        title="Conta que difere tem lançamento faltando ou sobrando — a conciliação mostra linha a linha o que não casou.">abrir Conciliação bancária →</button></div>` : ''}</div>`;
  }
  // 4b. prova dos nove (decisao do dono, 04/09/2026): a venda do PDV, que e' a fonte da
  // DRE, conferida contra o iFood, a Rede e os vales — por loja; na REDE, cada linha soma
  // as tres lojas. Fonte: vw_fechamento_prova_nove.
  {
    const L = fxLojas();
    const pr = (FX_M.prova || []).filter(r => r.mes.slice(0, 7) === mes.slice(0, 7) && L.includes(r.unidade));
    if (pr.length) {
      // Por que a regra e refeita aqui em vez de ler `situacao` da view: na visao
      // Rede cada linha SOMA as tres lojas, e o veredito tem de ser do somado.
      // A regra e a mesma da view, e o piso vem de la (piso_ruido) — ate 12/09/2026
      // este trecho tinha R$ 1.000 chapado e, depois de a view passar ao piso
      // proporcional, painel e banco discordavam: cartoes do Ahu em agosto eram
      // "conferir" na view e "bate" na tela.
      const agr = {};
      pr.forEach(r => {
        const g = agr[r.ordem] || (agr[r.ordem] = { ...r, valor_a: 0, valor_b: 0, piso: 0 });
        g.valor_a += fxN(r.valor_a); g.valor_b += fxN(r.valor_b);
        g.piso += fxN(r.piso_ruido);   // somando lojas, soma-se o piso de cada uma
      });
      const linhas = Object.values(agr).sort((x, y) => x.ordem - y.ordem).map(g => {
        const pct = g.valor_b ? (g.valor_a - g.valor_b) / g.valor_b * 100 : null, tol = fxN(g.tolerancia_pct);
        const dif = Math.abs(g.valor_a - g.valor_b);
        const piso = Math.max(100, g.piso);   // socorro se a view nao trouxer a coluna
        // Mesma regra da view: passa pela tolerancia em %, ou e diferenca pequena
        // para o tamanho da loja E ainda perto da tolerancia (ate 3x). O limite de
        // 3x existe para o piso nao engolir sinal grande na Agua Verde.
        const sit = pct === null ? 'SEM FONTE'
          : Math.abs(pct) <= tol ? 'BATE'
          : (dif <= piso && Math.abs(pct) <= 3 * tol) ? 'BATE'
          : Math.abs(pct) <= 2 * tol ? 'ATENÇÃO' : 'CONFERIR';
        return { ...g, pct, sit };
      });
      const ruins = linhas.filter(l => l.sit === 'CONFERIR'), aten = linhas.filter(l => l.sit === 'ATENÇÃO');
      const pal = l => l.sit === 'BATE' ? '✓ bate' : l.sit === 'SEM FONTE' ? 'sem fonte' : `${l.sit.toLowerCase()}: ${l.pct > 0 ? 'PDV acima' : 'PDV abaixo'} ${fxPct1(Math.abs(l.pct))} (${fxMil(Math.abs(l.valor_a - l.valor_b))})`;
      h += `<div class="fx-tile" style="margin-top:12px"><div class="fx-rotulo">A venda bate com o iFood, a Rede, os vales e o ePadoca? (prova dos nove)</div>
        <div class="fx-valor${ruins.length ? ' neg' : ''}" style="font-size:20px">${ruins.length ? `${ruins.length} de ${linhas.length} linhas para conferir` : aten.length ? `${linhas.length - aten.length} de ${linhas.length} batem · ${aten.length} em atenção` : `${linhas.length} de ${linhas.length} batem`}</div>
        <div class="fx-extra">a venda bruta da DRE vem do PDV (Saipos); antes de o número sair, ela é conferida contra as fontes de fora, cada uma com a sua tolerância. "PDV acima" do iFood costuma ser cancelamento parcial contado pelo valor cheio; "PDV abaixo" da Rede é detalhe de pagamento faltando no Saipos.</div>
        <ul class="fx-lista">${linhas.map(l => `<li><span>${l.linha}<small>${l.fonte_a} ${fxMil(l.valor_a)} × ${l.fonte_b} ${fxMil(l.valor_b)} · tolerância ${fxPct1(fxN(l.tolerancia_pct))}</small></span><b>${pal(l)}</b></li>`).join('')}</ul>`;
      // A linha que nao bate tem tela: o de/para e' pela ORDEM da view (2 = iFood,
      // 3 e 4 = Rede), NAO pelo texto — o texto da linha muda e o botao sumiria em
      // silencio. A 1 (PDV interno) e a 5 (atacado/ePadoca) nao tem tela: sem botao.
      const TELA_PROVA = { 2: ['resumo', 'abrir Resumo do canal iFood'],
                           3: ['rede', 'abrir Taxas da maquininha'],
                           4: ['rede', 'abrir Taxas da maquininha'] };
      const acoesProva = [...new Map(linhas.filter(l => l.sit === 'CONFERIR' || l.sit === 'ATENÇÃO')
        .map(l => TELA_PROVA[l.ordem]).filter(Boolean).map(t => [t[0], t])).values()];
      h += `${acoesProva.length ? `<div style="margin-top:10px;">${acoesProva.map(([mod, rot]) =>
        `<button class="preset-btn" onclick="mostrarModulo('${mod}')" title="A linha que não bate se resolve nesta tela: é lá que a fonte de fora aparece aberta.">${rot} →</button>`).join(' ')}</div>` : ''}</div>`;
    }
  }
  h += `<div class="fx-rodape">Caixa das lojas (Saipos) e as contas do mês por competência, pelas mesmas views da DRE. Na Rede, a mercadoria que a Água Verde vende às filiais entra de um lado e sai do outro e se anula no "sobrou".</div>`;
  alvo.innerHTML = h;
}

// ---------------- A SEMANA ----------------
let FX_S = null, FX_SEM_SEL = null;

// Categoria de despesa aberta no bloco 6 (12/09/2026): clicar na linha abre, logo
// embaixo dela, a serie das mesmas 8 semanas da tela. "A manutencao subiu" termina
// na tela sem isso; com a serie, ve-se na hora se e pico ou tendencia — que e o
// que decide se alguem age. Clicar de novo fecha; so uma categoria por vez.
// O nome vai por INDICE, nunca como string dentro do onclick: e o mesmo cuidado
// que o modulo evolucao ja toma com nome de item.
let FX_DESP_SEL = null, FX_DESP_LISTA = [];

function fxDespAbrir(i) {
  const c = FX_DESP_LISTA[i];
  if (!c) return;
  FX_DESP_SEL = (FX_DESP_SEL === c) ? null : c;
  renderSemana();
}

async function entrarSemana() {
  const alvo = document.getElementById('view-semana');
  if (!FX_S) {
    alvo.innerHTML = '<div class="contexto">Carregando a semana...</div>';
    const hoje = fxHojeSP(), segAtual = fxSegunda(hoje);
    const desde = fxSomaDias(segAtual, -7 * 12);
    const [vendas, itens, ifood, anuncios, funil, compras, listas, despesas, recebido, caixa, contas, parcial] = await Promise.all([
      consultarTudo(`vw_sem_vendas?select=*&semana=gte.${desde}`), consultarTudo(`vw_sem_itens?select=*&semana=gte.${desde}`),
      consultarTudo(`mv_sem_ifood?select=*&semana=gte.${desde}`), consultarTudo(`mv_sem_anuncios?select=*&semana=gte.${desde}`),
      consultarTudo(`vw_sem_funil?select=*&semana=gte.${desde}`), consultarTudo(`vw_sem_compras?select=*&semana=gte.${desde}`),
      consultarTudo(`vw_tr_cmv_semanal?select=unidade,semana,valor&semana=gte.${desde}`), consultarTudo(`vw_sem_despesas?select=*&semana=gte.${desde}`),
      consultarTudo(`vw_sem_recebido?select=*&semana=gte.${desde}`), consultarTudo('vw_sem_caixa_hoje?select=*'),
      consultarTudo(`vw_fin_contas_pagar?select=unidade,sentido,situacao,vencimento,credito,debito,subtipo,origem&ativa=eq.true&vencimento=lt.${fxSomaDias(segAtual, 14)}`),
      consultarTudo('vw_mes_cmv_parcial?select=*'),
    ]);
    // Meta de mercadoria: DADO, nao constante. Ate 12/09/2026 esta tela tinha
    // META_CMV = 35 escrito no codigo enquanto fin_metas_dre ja dizia 34,5 e
    // fin_metas_dre_mes desce meio ponto por mes ate 32 em fev/27 (decisao do
    // dono em 02/09). O farol da semana pintava com a regua velha.
    const [metasGerais, metasMes] = await Promise.all([
      consultarTudo('fin_metas_dre?select=chave,sentido,pct_meta'),
      consultarTudo('fin_metas_dre_mes?select=chave,mes,pct_meta').catch(() => []),
    ]);
    FX_S = { hoje, segAtual, vendas, itens, ifood, anuncios, funil, compras, listas, despesas, recebido, caixa, contas, parcial,
             metasGerais, metasMes: metasMes || [] };
    // 07/11/2026 (auditoria resultado-17, dinheiro-0): o saldo de hoje vem do Fluxo projetado (fxlResumo)
    if (!FXL) await fxlCarregar();
    const fechadas = [...new Set(vendas.map(r => r.semana))].sort().filter(s => s < segAtual);
    FX_SEM_SEL = fechadas[fechadas.length - 1];
  }
  renderSemana();
}

function fxSemCalc(w) {
  const L = fxLojas(), f = arr => arr.filter(r => r.semana === w && L.includes(r.unidade));
  const v = f(FX_S.vendas); const canais = {}; v.forEach(r => { canais[r.canal] = (canais[r.canal] || 0) + fxN(r.faturamento); });
  const ifd = f(FX_S.ifood), an = fxSoma(f(FX_S.anuncios), 'anuncios'), fu = f(FX_S.funil), comp = f(FX_S.compras);
  // VENDA CHEIA (dono, 15/10/2026; aplicada aqui em 17/10): o PDV ja vem com a promocao paga
  // pela loja descontada e o custo iFood abaixo a desconta de novo — a margem saia ~R$ 17 mil
  // por semana menor na Rede. Venda = PDV + promocao da loja, a mesma regra de fxVendaCheia.
  const promoLojaSem = fxSoma(ifd, 'promo_loja');
  if (promoLojaSem) canais.IFOOD = (canais.IFOOD || 0) + promoLojaSem;
  const fat = fxSoma(v, 'faturamento') + promoLojaSem, ped = fxSoma(v, 'pedidos'), it = fxSoma(f(FX_S.itens), 'itens');
  const compMP = fxSoma(comp.filter(r => r.tipo === 'MATERIA PRIMA'), 'valor'), compUC = fxSoma(comp.filter(r => r.tipo === 'USO E CONSUMO'), 'valor');
  const listas = FX_S.listas.filter(r => r.semana === w);
  const enviadas = L.includes('AGUA VERDE') ? fxSoma(listas, 'valor') : 0;
  const recebidas = fxSoma(listas.filter(r => L.includes(r.unidade) && r.unidade !== 'AGUA VERDE'), 'valor');
  const custoIfood = fxSoma(ifd, 'promo_loja') + fxSoma(ifd, 'taxas') + an;
  const compras = compMP + compUC - enviadas + recebidas;
  return { w, fat, ped, it, ticket: ped ? fat / ped : 0, canais, ifPed: fxSoma(ifd, 'pedidos'), ifItens: fxSoma(ifd, 'itens'), promoLoja: fxSoma(ifd, 'promo_loja'), promoIfood: fxSoma(ifd, 'promo_ifood'),
    taxas: fxSoma(ifd, 'taxas'), frete: fxSoma(ifd, 'frete'), anuncios: an, custoIfood, visitas: fxSoma(fu, 'visitas'), concluidos: fxSoma(fu, 'concluidos'),
    compras, compMP, compUC, enviadas, recebidas, margem: fat - compras - custoIfood };
}

function fxCaixaLoja(u) {
  const cx = FX_S.caixa.filter(r => r.unidade === u);
  const cofre = fxSoma(cx.filter(r => r.tipo === 'COFRE'), 'saldo');
  // 07/11/2026 (auditoria resultado-17, dinheiro-0): bancos + cofre = o SALDO INICIAL do Fluxo projetado
  // (fim do ultimo dia com extrato completo), o mesmo numero da Hoje e do Fluxo. Sem o Fluxo, a view de antes.
  const F = fxlResumo(u);
  const banco = F ? F.saldoInicial - cofre : fxSoma(cx.filter(r => r.tipo === 'BANCO'), 'saldo');
  const fim = fxSomaDias(FX_S.segAtual, 6);
  const cs = FX_S.contas.filter(r => r.unidade === u);
  const pagarAte = cs.filter(r => r.sentido === 'PAGAR' && r.vencimento <= fim), pagarProx = cs.filter(r => r.sentido === 'PAGAR' && r.vencimento > fim);
  const receberAte = cs.filter(r => r.sentido === 'RECEBER' && r.vencimento <= fim);
  const venc = pagarAte.filter(r => r.situacao === 'VENCIDA');
  const semanas4 = [1, 2, 3, 4].map(n => fxSomaDias(FX_S.segAtual, -7 * n));
  const rec4 = FX_S.recebido.filter(r => r.unidade === u && semanas4.includes(r.semana));
  const mediaSem = rec4.length ? fxSoma(rec4, 'recebido') / rec4.length : 0;
  const diasRest = Math.max(0, Math.round((new Date(fim + 'T12:00:00') - new Date(FX_S.hoje + 'T12:00:00')) / 86400000) + 1);
  const esperado = mediaSem * diasRest / 7, recLanc = fxSoma(receberAte, 'credito'), pagar = fxSoma(pagarAte, 'debito');
  // o que esta loja recebe de OUTRA loja da Rede ate domingo: conta para ela, nao para a soma da Rede (07/10/2026)
  const recEntre = fxSoma(receberAte.filter(projEntreLojas), 'credito');
  return { u, banco, cofre, dataPartida: F ? F.dataPartida : null, recLanc, recEntre, esperado, pagar, vencidas: fxSoma(venc, 'debito'), nVenc: venc.length, pagarProx: fxSoma(pagarProx, 'debito'), sobra: banco + cofre + recLanc + esperado - pagar, diasRest, mediaSem, fim };
}

function renderSemana() {
  const alvo = document.getElementById('view-semana');
  const fechadas = [...new Set(FX_S.vendas.map(r => r.semana))].sort().filter(s => s < FX_S.segAtual).slice(-8);
  if (!fechadas.includes(FX_SEM_SEL)) FX_SEM_SEL = fechadas[fechadas.length - 1];
  const W = FX_SEM_SEL, iW = fechadas.indexOf(W), ANT = fechadas[iW - 1];
  const SEM = fechadas.slice(0, iW + 1).slice(-8);           // ate 8 semanas, terminando na escolhida
  const S = {}; SEM.forEach(w => { S[w] = fxSemCalc(w); });
  const a = S[W], j = ANT ? S[ANT] : null, rots = SEM.map(fxDM);
  const ra = 'vs semana anterior';
  const cmvPct = w => S[w].fat ? S[w].compras / S[w].fat * 100 : 0;
  const cmv4 = w => { const i = SEM.indexOf(w); const ws = SEM.slice(Math.max(0, i - 3), i + 1); const f = ws.reduce((s, x) => s + S[x].fat, 0), c = ws.reduce((s, x) => s + S[x].compras, 0); return f ? c / f * 100 : 0; };
  // A meta vale para o MES em que a semana escolhida termina; fin_metas_dre_mes
  // sobrepoe a geral quando tem linha para aquele mes (descida do CMV).
  const mesDaSemana = fxSomaDias(W, 6).slice(0, 8) + '01';
  const metaMesRow = (FX_S.metasMes || []).filter(m => m.chave === 'CUSTO' && m.mes <= mesDaSemana)
    .sort((a, b) => a.mes < b.mes ? -1 : 1).pop();
  const metaGeralRow = (FX_S.metasGerais || []).find(m => m.chave === 'CUSTO');
  const META_CMV = fxN(metaMesRow ? metaMesRow.pct_meta : (metaGeralRow ? metaGeralRow.pct_meta : 35));
  const metaTxt = META_CMV.toLocaleString('pt-BR', { maximumFractionDigits: 1 });
  let h = seletorLojaFin();
  h += `<div class="fx-cab-topo"><div><div class="fx-rotulo">A semana · ${nomeLojaFin()}</div><h2 class="fx-h1">Semana de ${fxSemRot(W)}</h2>
    <div class="fx-sub">O que vendeu, o que o iFood custou, quanto foi de mercadoria, a margem que fechou — e o caixa desta semana.</div></div>
    ${fxSeg('fxSem', fechadas.map(w => [w, fxDM(w)]), W)}</div>`;
  // 1
  const conv = a.visitas ? a.concluidos / a.visitas * 100 : null, convJ = j && j.visitas ? j.concluidos / j.visitas * 100 : null;
  h += `<div class="fx-secao"><h3>1. Quanto vendeu</h3><span>venda cheia: caixa das lojas (PDV) + promoções pagas pela loja no iFood, sem cancelados</span></div><div class="fx-tiles">`
    + fxTile('Vendas da semana', a.fat, j ? fxVar(a.fat, j.fat, ra) : '', j ? `semana anterior: ${fxMil(j.fat)}` : '', fxSpark(SEM.map(w => S[w].fat), rots, fxMil), `<ul class="fx-lista">${Object.entries(a.canais).sort((x, y) => y[1] - x[1]).filter(([, v]) => v >= 1).map(([c, v]) => `<li><span>${c}</span><b>${fxMil(v)} · ${fxPct1(v / a.fat * 100)}</b></li>`).join('')}</ul>`)
    + fxTile('Pedidos', fxInt(a.ped), j ? fxVar(a.ped, j.ped, ra) : '', j ? `semana anterior: ${fxInt(j.ped)}` : '', fxSpark(SEM.map(w => S[w].ped), rots, fxInt))
    + fxTile('Itens vendidos', fxInt(a.it), j ? fxVar(a.it, j.it, ra) : '', a.ped ? `${(a.it / a.ped).toLocaleString('pt-BR', { maximumFractionDigits: 1 })} itens por pedido` : '', fxSpark(SEM.map(w => S[w].it), rots, fxInt))
    + fxTile('Valor médio por pedido', fxR2(a.ticket), j ? fxVar(a.ticket, j.ticket, ra) : '', j ? `semana anterior: ${fxR2(j.ticket)}` : '', fxSpark(SEM.map(w => S[w].ticket), rots, v => 'R$ ' + v.toFixed(0)))
    + (conv !== null ? fxTile('Conversão do cardápio iFood', fxPct1(conv), convJ !== null ? `<b>${conv > convJ + 0.3 ? 'subiu' : conv < convJ - 0.3 ? 'caiu' : 'ficou igual'}</b> (anterior: ${fxPct1(convJ)})` : '', `${fxInt(a.visitas)} visitas viraram ${fxInt(a.concluidos)} pedidos`, fxSpark(SEM.map(w => S[w].visitas ? S[w].concluidos / S[w].visitas * 100 : 0), rots, fxPct1)) : '')
    + '</div>';
  // 2
  const cemIf = a.ifItens ? a.custoIfood / a.ifItens * 100 : 0, cemIfJ = j && j.ifItens ? j.custoIfood / j.ifItens * 100 : null;
  h += `<div class="fx-secao"><h3>2. O que o iFood custou</h3><span>pedido a pedido, pelo export do iFood + anúncios do extrato</span></div><div class="fx-tiles">`
    + fxTile('Custo iFood da semana', a.custoIfood, j ? fxVar(a.custoIfood, j.custoIfood, ra) : '', `de cada R$ 100 vendidos no iFood, <b>R$ ${Math.round(cemIf)}</b> ficaram com o iFood${cemIfJ !== null ? ` (anterior: R$ ${Math.round(cemIfJ)})` : ''}`, fxSpark(SEM.map(w => S[w].ifItens ? S[w].custoIfood / S[w].ifItens * 100 : 0), rots, v => 'R$ ' + v.toFixed(0)),
      `<ul class="fx-lista"><li><span>promoções pagas pela loja</span><b>${fxMil(a.promoLoja)}</b></li><li><span>comissão e taxas</span><b>${fxMil(a.taxas)}</b></li><li><span>anúncios</span><b>${fxMil(a.anuncios)}</b></li></ul>`)
    + fxTile('Venda no iFood', a.ifItens, j ? fxVar(a.ifItens, j.ifItens, ra) : '', `${fxInt(a.ifPed)} pedidos entregues`, fxSpark(SEM.map(w => S[w].ifItens), rots, fxMil))
    + fxTile('Entrega paga pelos clientes', a.frete, j ? fxVar(a.frete, j.frete, ra) : '', 'taxa de entrega cobrada no iFood — ajuda a pagar os motoboys; já está dentro das vendas', fxSpark(SEM.map(w => S[w].frete), rots, fxMil))
    + fxTile('Promoção paga pelo iFood', a.promoIfood, j ? fxVar(a.promoIfood, j.promoIfood, ra) : '', 'desconto que o iFood banca, não nós', fxSpark(SEM.map(w => S[w].promoIfood), rots, fxMil))
    + '</div><div class="fx-nota">A venda no iFood aqui é o valor dos itens pelo export do iFood; o PDV registra praticamente o mesmo número. Promoção paga pela loja é custo de verdade: o cliente pagou menos e o iFood desconta do repasse.</div>';
  // 3
  const p = cmvPct(W), pj = j ? cmvPct(ANT) : null, p4 = cmv4(W), fC = fxFarol(p4, META_CMV, 'abaixo');
  const parcial = FX_S.parcial.filter(r => fxLojas().includes(r.unidade)); const pv = fxSoma(parcial, 'vendas'), pc = fxSoma(parcial, 'compras');
  h += `<div class="fx-secao"><h3>3. Mercadoria (CMV de compras)</h3><span>notas de mercadoria emitidas na semana ÷ vendas da semana</span></div><div class="fx-tiles">`
    + fxTile('Mercadoria da semana', a.compras, j ? fxVar(a.compras, j.compras, ra) : '', `notas: insumos ${fxMil(a.compMP)} · uso e consumo ${fxMil(a.compUC)}${a.enviadas ? ` · − ${fxMil(a.enviadas)} mandados às filiais e Boqueirão` : ''}${a.recebidas ? ` · + ${fxMil(a.recebidas)} recebidos da Água Verde` : ''}`, fxSpark(SEM.map(w => S[w].compras), rots, fxMil))
    + fxTile('De cada R$ 100 vendidos, mercadoria levou', 'R$ ' + Math.round(p), pj !== null ? `semana anterior: R$ ${Math.round(pj)}` : '', 'compras oscilam de semana para semana — olhe a média ao lado', fxSpark(SEM.map(w => cmvPct(w)), rots, v => 'R$ ' + v.toFixed(0)))
    // 07/11/2026 (auditoria resultado-15): com a Água Verde na conta, a compra do atacado está no numerador e
    // a venda dele não está no divisor — a régua da DRE (que divide por tudo que entrou) não vale aqui.
    + fxTile('Média das últimas 4 semanas', 'R$ ' + Math.round(p4), fxLojas().includes('AGUA VERDE') ? 'sem farol: a compra do atacado está dentro e a venda dele não' : fxPill(fC) + ` · até R$ ${metaTxt}`, 'é este número que diz se a mercadoria está no lugar', fxSpark(SEM.map(w => cmv4(w)), rots, v => 'R$ ' + v.toFixed(0)))
    + (pv > 0.5 ? fxTile(`CMV parcial do mês (até ${fxDM(parcial[0].vendas_ate)})`, pc > 0 ? 'R$ ' + Math.round(pc / pv * 100) : '—', pc > 0 ? `compras ${fxMil(pc)} ÷ vendas ${fxMil(pv)}` : '', pc > 0 ? 'de cada R$ 100 vendidos no mês até agora; muda todo dia conforme as notas entram' : 'ainda sem nota de mercadoria lançada neste mês') : '')
    + '</div><div class="fx-nota">Mercadoria aqui é o que foi comprado (notas emitidas, lançadas no Saipos), não o que foi consumido — uma compra grande pesa na semana em que a nota entra; por isso a média de 4 semanas é a régua. A mercadoria mandada às filiais sai da Água Verde e entra na filial que recebeu. O CMV pela ficha técnica fica fora até ser auditado.</div>';
  // 4
  const cemM = a.fat ? a.margem / a.fat * 100 : 0, serieM = SEM.map(w => S[w].margem);
  h += `<div class="fx-secao"><h3>4. A margem que fechou</h3><span>vendas − mercadoria − custo iFood</span></div><div class="fx-duas">
    <div class="fx-destaque"><div class="fx-rotulo">Margem fechada da semana</div><div class="fx-valor-g${a.margem < 0 ? ' neg' : ''}">${fxMil(a.margem)}</div>
      <p>Vendas ${fxMil(a.fat)} − mercadoria ${fxMil(a.compras)} − custo iFood ${fxMil(a.custoIfood)}. De cada R$ 100 vendidos, <b>R$ ${Math.round(cemM)}</b> ficaram para pagar pessoas, entrega, a casa e sobrar.</p>
      ${j ? `<p>Semana anterior: ${fxMil(j.margem)} (R$ ${Math.round(j.fat ? j.margem / j.fat * 100 : 0)} de cada 100). A margem ${fxVar(a.margem, j.margem, ra)}.</p>` : ''}</div>
    <div class="fx-tile"><div class="fx-rotulo">Margem, semana a semana</div><div class="fx-valor" style="font-size:20px">${SEM.slice(-3).map(w => fxMil(S[w].margem).replace('R$ ', '')).join(' · ')}</div><div class="fx-extra">últimas três semanas</div>${fxSpark(serieM, rots, fxMil)}<div class="fx-extra" style="margin-top:8px">Melhor: ${fxSemRot(SEM[serieM.indexOf(Math.max(...serieM))])} (${fxMil(Math.max(...serieM))}). Pior: ${fxSemRot(SEM[serieM.indexOf(Math.min(...serieM))])} (${fxMil(Math.min(...serieM))}).</div></div></div>`;
  // 5 caixa
  const us = fxLojas(), cxs = us.map(fxCaixaLoja), fim = cxs[0].fim;
  h += `<div class="fx-secao"><h3>5. O caixa desta semana</h3><span>hoje ${fxDM(FX_S.hoje)} · semana de ${fxDM(FX_S.segAtual)} a ${fxDM(fim)} · saldo do banco = o do Fluxo projetado</span></div><div class="fx-tiles">`;
  cxs.forEach(c => { const nome = lojaNome(c.u);
    h += `<div class="fx-caixa"><h4>${nome}</h4><ul>
      <li><span>Nas contas do banco<small>${c.dataPartida ? `fim de ${fxDM(c.dataPartida)}, último extrato completo — o mesmo do Fluxo projetado` : 'pelo último extrato importado'}</small></span><b>${fxMil(c.banco)}</b></li>
      <li><span>No cofre</span><b>${fxMil(c.cofre)}</b></li>
      <li><span>A receber até domingo, já lançado</span><b>+ ${fxMil(c.recLanc)}</b></li>
      <li><span>Vendas que ainda devem cair até domingo<small>${c.diasRest} dias × média das últimas 4 semanas (${fxMil(c.mediaSem)}/semana)</small></span><b>+ ${fxMil(c.esperado)}</b></li>
      <li><span>A pagar até domingo<small>${c.nVenc ? `inclui ${c.nVenc} conta(s) vencida(s): ${fxMil(c.vencidas)}` : 'nenhuma vencida'}</small></span><b>− ${fxMil(c.pagar)}</b></li>
      <li class="res ${c.sobra >= 0 ? 'pos' : 'neg'}"><span>${c.sobra >= 0 ? 'Vai sobrar' : 'Vai faltar'}</span><b>${fxMil(Math.abs(c.sobra))}</b></li></ul>
      <div class="fx-mandar">${c.u !== 'AGUA VERDE' ? (c.sobra > 0 ? `Pode mandar para a Água Verde esta semana: <b>até ${fxMil(c.sobra)}</b>` : `Não pode mandar nada esta semana — faltam ${fxMil(Math.abs(c.sobra))}`) : `Próxima semana já tem <b>${fxMil(c.pagarProx)}</b> a pagar lançados.`}</div></div>`; });
  if (us.length > 1) { const entreL = cxs.reduce((s, c) => s + (c.recEntre || 0), 0); const sT = cxs.reduce((s, c) => s + c.sobra, 0) - entreL;
    h += `<div class="fx-caixa"><h4>Rede</h4><ul><li><span>Banco + cofres<small>saldo inicial do Fluxo projetado</small></span><b>${fxMil(cxs.reduce((s, c) => s + c.banco + c.cofre, 0))}</b></li><li><span>A receber até domingo (lançado + vendas esperadas)${entreL > 0.005 ? `<small>sem ${fxMil(entreL)} que a Água Verde recebe das filiais</small>` : ''}</span><b>+ ${fxMil(cxs.reduce((s, c) => s + c.recLanc + c.esperado, 0) - entreL)}</b></li><li><span>A pagar até domingo</span><b>− ${fxMil(cxs.reduce((s, c) => s + c.pagar, 0))}</b></li><li class="res ${sT >= 0 ? 'pos' : 'neg'}"><span>${sT >= 0 ? 'Vai sobrar' : 'Vai faltar'}</span><b>${fxMil(Math.abs(sT))}</b></li></ul><div class="fx-mandar">Filiais podem mandar para a AV: <b>${fxMil(cxs.filter(c => c.u !== 'AGUA VERDE' && c.sobra > 0).reduce((s, c) => s + c.sobra, 0))}</b> · próxima semana a pagar na rede: <b>${fxMil(cxs.reduce((s, c) => s + c.pagarProx, 0))}</b></div></div>`; }
  h += '</div><div class="fx-nota">XP, Participações e cartões de crédito ficam fora — é o caixa do dia a dia. "Vendas que ainda devem cair" é a média do que caiu nas contas nas últimas 4 semanas, proporcional aos dias que faltam; não é promessa. Conta a pagar só aparece se está lançada no Saipos.</div>';
  // 6 despesas
  const L = fxLojas(), at = FX_S.despesas.filter(r => r.semana === W && L.includes(r.unidade));
  const ws4 = SEM.slice(Math.max(0, iW - 4), iW).length ? fechadas.slice(Math.max(0, iW - 4), iW) : [];
  const ant4 = FX_S.despesas.filter(r => ws4.includes(r.semana) && L.includes(r.unidade));
  const cat = {}, catA = {}; at.forEach(r => { cat[r.subtipo] = (cat[r.subtipo] || 0) + fxN(r.valor); }); ant4.forEach(r => { catA[r.subtipo] = (catA[r.subtipo] || 0) + fxN(r.valor); });
  const nA = Math.max(1, ws4.length), totA = fxSoma(at, 'valor'), totN = fxSoma(ant4, 'valor') / nA;
  const leitura = (v, m) => m ? (Math.abs((v - m) / m * 100) < 15 ? 'no normal' : `${v > m ? 'acima' : 'abaixo'} do normal (${fxPct1(Math.abs((v - m) / m * 100))})`) : 'não tinha nas 4 anteriores';
  // A ordem e' o DESVIO EM REAIS contra a media das 4 semanas (|v − m|), nunca o
  // valor e nunca o desvio em %: a maior despesa e' a mesma toda semana (nao e'
  // noticia), e o percentual poe uma categoria de R$ 80 que dobrou na frente de
  // uma de R$ 4 mil que subiu um terco. Categoria que nao existia nas 4 anteriores
  // entra pelo proprio valor, que e' o desvio dela.
  const desvio = (c, v) => Math.abs(v - (catA[c] || 0) / nA);
  // A serie de 8 semanas da categoria, das MESMAS semanas do resto da tela (SEM),
  // pela mesma fonte da tabela (FX_S.despesas, que carrega 12 semanas).
  const despSerie = (c) => SEM.map(w => fxSoma(FX_S.despesas.filter(r => r.semana === w && r.subtipo === c && L.includes(r.unidade)), 'valor'));
  const catTop = Object.entries(cat).sort((x, y) => desvio(y[0], y[1]) - desvio(x[0], x[1])).slice(0, 8);
  FX_DESP_LISTA = catTop.map(([c]) => c);
  const linhaDesp = ([c, v], i) => {
    const ab = FX_DESP_SEL === c;
    let t = `<tr onclick="fxDespAbrir(${i})" style="cursor:pointer;${ab ? 'background:var(--brand-wine);' : ''}" title="${ab ? 'clique para fechar' : 'clique para ver as ' + SEM.length + ' semanas desta categoria'}"><td>${ab ? '▾ ' : '▸ '}${c}</td><td>${fxMil(v)}</td><td>${fxMil((catA[c] || 0) / nA)}</td><td class="esq">${leitura(v, (catA[c] || 0) / nA)}</td></tr>`;
    if (ab) {
      const se = despSerie(c), med = se.reduce((s, x) => s + x, 0) / se.length, mx = Math.max(...se);
      t += `<tr><td colspan="4" class="esq">${fxSpark(se, rots, fxMil)}<div class="fx-extra">${c} nas últimas ${se.length} semanas · média ${fxMil(med)} · maior ${fxMil(mx)} em ${fxSemRot(SEM[se.indexOf(mx)])}</div></td></tr>`;
    }
    return t;
  };
  h += `<div class="fx-secao"><h3>6. Onde o dinheiro foi</h3><span>as despesas que mais fugiram do normal das 4 semanas anteriores, em reais · clique numa categoria para ver as ${SEM.length} semanas dela</span></div><div class="fx-tabela"><table><tr><th>Categoria</th><th>Esta semana</th><th>Normal (média 4 sem.)</th><th class="esq">Leitura</th></tr>`
    + catTop.map(linhaDesp).join('')
    + `<tr class="tot"><td>Total pago na semana</td><td>${fxMil(totA)}</td><td>${fxMil(totN)}</td><td class="esq">${leitura(totA, totN)}</td></tr></table></div>`;
  h += `<div class="fx-rodape">Caixa das lojas (Saipos), semanas de segunda a domingo. O Boqueirão fica fora; a mercadoria do atacado ainda está dentro das compras da Água Verde.</div>`;
  alvo.innerHTML = h;
}

// seletores de mes/semana dos dois modulos (um listener so, como o da loja)
document.addEventListener('click', (e) => {
  const b = e.target && e.target.closest && e.target.closest('.fx-seg button');
  if (!b) return;
  const seg = b.closest('.fx-seg').dataset.seg;
  if (seg === 'fxMes') { FX_MES_SEL = b.dataset.v; renderFechamento(); }
  if (seg === 'fxSem') { FX_SEM_SEL = b.dataset.v; renderSemana(); }
});

// Carrega os dados financeiros uma vez so — compartilhados entre DFC e DRE.
async function garantirDadosFin() {
  if (DFC_MENSAL !== null) return;
  [DFC_RAW, DFC_CONTAS_RAW, DFC_MOV_RAW, DFC_CONF_RAW] = await Promise.all([
    consultarTudo("vw_fin_dfc_mensal?select=unidade,mes,natureza,tipo,subtipo,ordem,credito,debito&order=mes,ordem"),
    // ativa=is.true: BRADESCO e FABIO PESSOAL tem zero lancamento e zero
    // extrato. Antes apareciam com saldo 0,00, e conta morta em lista de saldo
    // faz a pessoa procurar o que nao existe.
    consultarTudo("fin_contas?select=conta,unidade,saldo_inicial,ordem,apelido&ativa=is.true&order=ordem"),
    consultarTudo("vw_fin_saldo_conta_mensal?select=mes,conta,movimento&order=mes,conta"),
    consultarTudo("vw_fin_fechamento_saldo_mensal?select=conta,conta_exibida,ordem,mes,situacao,diferenca,diferenca_aceita,diferenca_explicada,explicacao,ref_fim,ref_fim_data,ref_origem,ancora_antes_do_fim&order=mes,ordem"),
  ]);
  aplicarLojaFin();   // converte os números lá dentro: trocar de loja refaz as listas
}

async function entrarFluxo() {
  await carregarApelidos();
  const alvo = document.getElementById('view-fluxo');
  if (DFC_MENSAL === null) alvo.innerHTML = '<div class="contexto">Carregando fluxo de caixa...</div>';
  await garantirDadosFin();
  // TEM de vir depois do await: garantirDadosFin sai na primeira linha quando os dados
  // ja estao carregados, e nesse caminho o aplicarLojaFin interno dele nunca roda.
  aplicarLojaFin();
  renderModuloDFC();
}

// COLUNA FIXA DAS TABELAS LARGAS — parte dinamica (a parte estatica e' o CSS
// de div[id^="tabela"]). Para cada tabela visivel:
// 1. mede o fundo real atras dela (--fundo-tabela): algumas vivem dentro de
//    card e a celula fixa precisa ser opaca na cor certa;
// 2. marca .rolavel se ha rolagem (liga a sombra da costura) e aponta o
//    encaixe da rolagem (scroll-padding) para a borda da coluna fixa;
// 3. calcula um respiro a direita para o FIM da rolagem cair exatamente numa
//    borda de coluna — sem isso o limite fisico do scroll deixava uma coluna
//    cortada ao meio embaixo da coluna fixa.
// Recalculado apos cada render (observador de DOM: abrir grupo, trocar
// periodo ou modulo muda as larguras) e quando a janela muda de tamanho.
function encaixarTabela(div) {
  const tabela = div.querySelector('table');
  if (!tabela || !tabela.rows.length || !div.clientWidth) return;
  let el = div, fundo = '#111110';
  while (el) {
    const b = getComputedStyle(el).backgroundColor;
    if (b && b !== 'transparent' && !b.startsWith('rgba(0, 0, 0, 0')) { fundo = b; break; }
    el = el.parentElement;
  }
  div.style.setProperty('--fundo-tabela', fundo);
  div.style.paddingRight = '0px';
  const maxScroll = div.scrollWidth - div.clientWidth;
  div.classList.toggle('rolavel', maxScroll > 0);
  if (maxScroll <= 0) return;
  const fixa = tabela.rows[0].cells[0].getBoundingClientRect().width;
  div.style.scrollPaddingLeft = fixa + 'px';
  const costura = maxScroll + fixa;   // onde a borda da coluna fixa cai no fim da rolagem
  const borda = [...tabela.rows[0].cells].map(c => c.offsetLeft).find(x => x >= costura - 0.5);
  const respiro = borda === undefined ? 0 : Math.ceil(borda - costura);
  if (respiro > 0 && respiro < 250) div.style.paddingRight = respiro + 'px';
}

function encaixarColunaFixa(id) {   // atalho por id (DFC/DRE chamam direto no render)
  const div = document.getElementById(id);
  if (div) encaixarTabela(div);
}

function encaixarTodas() {
  document.querySelectorAll('div[id^="tabela"], #extratoFin').forEach(d => { if (d.clientWidth) encaixarTabela(d); });
}

function dfcToggle(chave) {
  if (dfcAberto.has(chave)) dfcAberto.delete(chave); else dfcAberto.add(chave);
  renderModuloDFC();
}

function renderModuloDFC() {
  const alvo = document.getElementById('view-fluxo');
  if (!DFC_MENSAL || !DFC_MENSAL.length) {
    // o cabecalho entra aqui tambem: loja sem lancamento nao pode ficar sem o
    // caminho de volta para o Placar
    alvo.innerHTML = plcCabecalhoQuebra('fluxo') + seletorLojaFin() +
      `<div class="contexto" style="border-color:#c8102e;">Sem lançamentos financeiros para esta loja.</div>`;
    return;
  }
  const ctxFluxo = plcCtx('fluxo');
  const mesAtual = mesCorrenteSP();
  const meses = [...new Set(DFC_MENSAL.map(r => r.mes))].sort().filter(m => m.slice(0, 7) <= mesAtual);
  const nM = meses.length;
  const idxMes = Object.fromEntries(meses.map((m, i) => [m, i]));
  const rotuloMes = (m) => { const [a, mm] = m.split('-'); return `${MESES_ABREV[Number(mm) - 1]}/${a.slice(2)}`; };

  // soma (credito-debito)*sinal por mes para as linhas que passam no predicado
  // (o guard de idxMes ignora lancamentos de meses futuros, cortados acima)
  const somar = (pred, sinal = 1) => {
    const v = Array(nM).fill(0);
    DFC_MENSAL.forEach(r => { if (pred(r) && idxMes[r.mes] !== undefined) v[idxMes[r.mes]] += (r.credito - r.debito) * sinal; });
    return v;
  };
  const somaArr = (arrs) => arrs.reduce((acc, a) => acc.map((x, i) => x + a[i]), Array(nM).fill(0));
  const total = (v) => v.reduce((s, x) => s + x, 0);
  // Com um mes fixado, `tot` le a COLUNA daquele mes em vez de somar a serie; e o
  // unico ponto por onde os cartoes e os dois graficos de origem e destino passam.
  // Mes que nao existe na loja escolhida (trocou de loja depois de fixar) cai
  // sozinho no periodo inteiro, porque indexOf devolve -1.
  const iSel = FLX_MES ? meses.indexOf(FLX_MES) : -1;
  const tot = (v) => iSel >= 0 ? v[iSel] : total(v);
  const iFim = iSel >= 0 ? iSel : nM - 1;

  // subtipos de um recorte, na ordem do plano de contas
  const subtiposDe = (pred) => {
    const vistos = new Map();
    DFC_MENSAL.forEach(r => { if (pred(r) && !vistos.has(r.subtipo)) vistos.set(r.subtipo, r.ordem); });
    return [...vistos.entries()].sort((a, b) => a[1] - b[1]).map(([s]) => s);
  };

  // ---- blocos do DFC (mesma estrutura da planilha) ----
  const ehInvest = (r) => r.tipo === 'INVESTIMENTOS';
  const receitas   = somar(r => r.natureza === 'RECEITAS');
  const deducoes   = somar(r => r.natureza === 'DEDUÇOES DA RECEITA', -1);
  const despesas   = somar(r => r.natureza === 'DESPESAS' && !ehInvest(r), -1);
  const invest     = somar(r => ehInvest(r), -1);
  const retiradas  = somar(r => r.natureza === 'DISTRIBUICAO DE LUCROS', -1);
  const naoOper    = somar(r => r.natureza === 'APORTE VALORES');
  const emprest    = somar(r => r.natureza === 'EMPRESTIMOS');
  const aplicacoes = somar(r => r.natureza === 'APLICAÇÕES');
  const semClass   = somar(r => r.natureza === 'SEM CLASSIFICACAO');
  const transf     = somar(r => r.natureza === 'TRANSFERENCIAS');

  const resultOper = receitas.map((_, i) => receitas[i] - deducoes[i] - despesas[i]);
  const resultInv  = resultOper.map((v, i) => v - invest[i]);
  const resultRet  = resultInv.map((v, i) => v - retiradas[i]);
  const resultFim  = resultRet.map((v, i) => v + naoOper[i] + emprest[i] + aplicacoes[i] + semClass[i] + transf[i]);

  // ---- saldos por conta (saldo inicial + movimentos acumulados) ----
  const contas = [...DFC_CONTAS].sort((a, b) => (a.ordem || 99) - (b.ordem || 99));
  const movPorConta = {};
  contas.forEach(c => { movPorConta[c.conta] = Array(nM).fill(0); });
  DFC_MOV.forEach(r => { if (movPorConta[r.conta] && idxMes[r.mes] !== undefined) movPorConta[r.conta][idxMes[r.mes]] += r.movimento; });
  const saldoIniConta = {}, saldoFimConta = {};
  contas.forEach(c => {
    let acum = c.saldo_inicial;
    saldoIniConta[c.conta] = []; saldoFimConta[c.conta] = [];
    for (let i = 0; i < nM; i++) {
      saldoIniConta[c.conta].push(acum);
      acum += movPorConta[c.conta][i];
      saldoFimConta[c.conta].push(acum);
    }
  });
  const saldoIni = meses.map((_, i) => contas.reduce((s, c) => s + saldoIniConta[c.conta][i], 0));
  const saldoFim = meses.map((_, i) => contas.reduce((s, c) => s + saldoFimConta[c.conta][i], 0));

  // ---- montagem do HTML ----
  const receitasTot = total(receitas);
  // % da receita junto do valor, so nas linhas de FLUXO (celRS, de saldo,
  // fica intacta: saldo e estoque, % da receita do mes nao significa nada).
  // mostra=-1: linha de SAIDA exibe o numero com sinal de menos (pedido do dono,
  // 16/08) — o calculo e o % continuam positivos, so a exibicao inverte.
  // Mesmo padrao de celula da DRE (16/08 a noite): % da receita ao lado do
  // numero, variacao vs mes anterior embaixo.
  const cel = (v, i, mostra = 1, vAnt = null) => {
    const base = i === 'tot' ? receitasTot : receitas[i];
    const p = base ? (v / base * 100) : null;
    const vM = v * mostra;
    let sub = '';
    if (vAnt !== null && Math.abs(vAnt) > 0.005) {
      const d = (v - vAnt) / Math.abs(vAnt) * 100;
      sub = `<div class="dre-sub">${d > 0.5 ? '▲' : d < -0.5 ? '▼' : '•'} ${pct(Math.abs(d))}% vs mês ant.</div>`;
    }
    return `<td><div class="${vM < -0.005 ? 'negativo' : ''}">${fmt(vM)}${p === null ? '' : `<span class="dre-av">${pct(p)}%</span>`}</div>${sub}</td>`;
  };
  const celRS = (v) => `<td class="${v < -0.005 ? 'negativo' : ''}">${fmt(v)}</td>`;

  // linha de fluxo: valores por mes + total (em R$ ou % da receita)
  const linha = (classe, label, vals, chave = null, mostra = 1) => {
    const seta = chave ? (dfcAberto.has(chave) ? '▼ ' : '▶ ') : '';
    const attrs = chave ? ` class="${classe} clicavel" onclick="dfcToggle('${chave}')"` : ` class="${classe}"`;
    return `<tr${attrs}><td>${seta}${label}</td>${vals.map((v, i) => cel(v, i, mostra, i > 0 ? vals[i - 1] : null)).join('')}${cel(total(vals), 'tot', mostra)}</tr>`;
  };
  // linha de saldo: sempre em R$; coluna Total mostra o saldo na ponta do periodo
  const linhaSaldo = (classe, label, vals, chave = null, totalPonta = null) => {
    const seta = chave ? (dfcAberto.has(chave) ? '▼ ' : '▶ ') : '';
    const attrs = chave ? ` class="${classe} clicavel" onclick="dfcToggle('${chave}')"` : ` class="${classe}"`;
    return `<tr${attrs}><td>${seta}${label}</td>${vals.map(v => celRS(v)).join('')}${celRS(totalPonta === null ? vals[vals.length - 1] : totalPonta)}</tr>`;
  };

  let corpo = '';

  // SALDO INICIAL (abre por conta)
  corpo += linhaSaldo('dfc-saldo', 'SALDO INICIAL', saldoIni, 'SALDO_INI', saldoIni[0]);
  if (dfcAberto.has('SALDO_INI')) contas.forEach(c => {
    corpo += linhaSaldo('dfc-conta', nomeConta(c.conta), saldoIniConta[c.conta], null, saldoIniConta[c.conta][0]);
  });

  // bloco expansivel de subtipos (saida herda o sinal de menos na exibicao)
  const blocoSubtipos = (chave, pred, sinal) => {
    if (!dfcAberto.has(chave)) return '';
    return subtiposDe(pred).map(s =>
      linha('dfc-linha', s, somar(r => pred(r) && r.subtipo === s, sinal), null, sinal < 0 ? -1 : 1)
    ).join('');
  };

  corpo += linha('dfc-bloco', 'RECEITAS', receitas, 'RECEITAS');
  corpo += blocoSubtipos('RECEITAS', r => r.natureza === 'RECEITAS', 1);

  corpo += linha('dfc-bloco', '(−) DEDUÇÕES DA RECEITA', deducoes, 'DEDUCOES', -1);
  corpo += blocoSubtipos('DEDUCOES', r => r.natureza === 'DEDUÇOES DA RECEITA', -1);

  corpo += linha('dfc-bloco', '(−) DESPESAS', despesas, 'DESPESAS', -1);
  if (dfcAberto.has('DESPESAS')) {
    const tiposDesp = [...new Set(DFC_MENSAL.filter(r => r.natureza === 'DESPESAS' && !ehInvest(r)).map(r => r.tipo))]
      .sort((a, b) => {
        const ia = DFC_ORDEM_TIPOS.indexOf(a), ib = DFC_ORDEM_TIPOS.indexOf(b);
        return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib);
      });
    tiposDesp.forEach(t => {
      const predT = (r) => r.natureza === 'DESPESAS' && r.tipo === t;
      corpo += linha('dfc-grupo', t, somar(predT, -1), 'DESP:' + t, -1);
      corpo += blocoSubtipos('DESP:' + t, predT, -1);
    });
  }

  // 01/10/2026 (dono: "todos os numeros devem bater"): "Resultado operacional" e' o nome de
  // uma linha da DRE (competencia, sem despesa financeira). Aqui e' dinheiro que entrou menos
  // dinheiro que saiu na operacao — outro numero, entao outro nome.
  corpo += linha('dfc-resultado', '(=) SOBRA DE CAIXA DA OPERAÇÃO', resultOper);

  corpo += linha('dfc-bloco', '(−) INVESTIMENTOS', invest, 'INVEST', -1);
  corpo += blocoSubtipos('INVEST', ehInvest, -1);
  corpo += linha('dfc-resultado', '(=) RESULTADO APÓS INVESTIMENTOS', resultInv);

  corpo += linha('dfc-bloco', '(−) DISTRIBUIÇÃO DE LUCROS', retiradas, 'RETIRADAS', -1);
  corpo += blocoSubtipos('RETIRADAS', r => r.natureza === 'DISTRIBUICAO DE LUCROS', -1);
  corpo += linha('dfc-resultado', '(=) RESULTADO APÓS RETIRADAS', resultRet);

  corpo += linha('dfc-bloco', '(+) FLUXO NÃO OPERACIONAL', naoOper, 'NAOOP');
  corpo += blocoSubtipos('NAOOP', r => r.natureza === 'APORTE VALORES', 1);

  if (emprest.some(v => Math.abs(v) > 0.005)) {
    corpo += linha('dfc-bloco', '(+) EMPRÉSTIMOS SÓCIOS', emprest, 'EMPREST');
    corpo += blocoSubtipos('EMPREST', r => r.natureza === 'EMPRESTIMOS', 1);
  }

  corpo += linha('dfc-bloco', '(+) FLUXO APLICAÇÕES', aplicacoes, 'APLIC');
  corpo += blocoSubtipos('APLIC', r => r.natureza === 'APLICAÇÕES', 1);

  if (semClass.some(v => Math.abs(v) > 0.005)) {
    corpo += linha('dfc-bloco', 'SEM CLASSIFICAÇÃO (revisar)', semClass);
  }
  if (transf.some(v => Math.abs(v) > 0.005)) {
    corpo += linha('dfc-bloco', 'TRANSFERÊNCIAS (líquido)', transf);
  }

  corpo += linha('dfc-resultado', '(=) RESULTADO FINAL', resultFim);

  // 28/09/2026: o saldo final soma a XP (regra do dono: fora do Fluxo projetado, pode entrar
  // nos demais calculos) — o rotulo diz, e as linhas logo abaixo separam em conta x aplicado.
  const temAplic = contas.some(c => c.conta === 'XP INVESTIMENTOS' || c.conta === 'PARTICIPACOES');
  const temCartaoSaldo = contas.some(c => c.conta.startsWith('CREDITO'));   // 07/11/2026 (auditoria dinheiro-23): o rótulo diz que o cartão soma
  const rotSaldoFim = temAplic && temCartaoSaldo ? 'SALDO FINAL (com a XP e o cartão)' : temAplic ? 'SALDO FINAL (com a XP)'
    : temCartaoSaldo ? 'SALDO FINAL (com o cartão)' : 'SALDO FINAL';
  corpo += linhaSaldo('dfc-saldo', rotSaldoFim, saldoFim, 'SALDO_FIM', saldoFim[nM - 1]);
  // Conferência com o extrato (03/09/2026, pedido do dono): a planilha antiga
  // tinha saldo inicial e final por conta batendo com o banco, e isso garantia
  // que todo centavo estava lançado. Cada conta ganha a marca do mês fechado:
  // ✓ bate com o saldo declarado (OFX, ou informado no caso da XP), ≠ difere
  // (com o valor), · sem extrato para conferir (cofres e cartões, por ora).
  // Fonte: vw_fin_fechamento_saldo_mensal — só meses fechados, por isso o mês
  // em curso fica sem marca.
  const confDe = (conta, mes) => (DFC_CONF || []).find(r => r.conta === conta && r.mes.slice(0, 7) === mes.slice(0, 7));
  const ddmm = s => s ? s.slice(8, 10) + '/' + s.slice(5, 7) : '';
  const marcaConf = (r) => {
    if (!r) return '';
    const ref = r.ref_origem === 'INFORMADO' ? 'informado' : 'do banco';
    if (r.situacao === 'BATEU') return `<span class="dfc-conf ok" title="bate com o saldo ${ref} em ${ddmm(r.ref_fim_data)}${r.diferenca_aceita ? ' (diferença aceita de R$ ' + fmt(Number(r.diferenca_aceita)) + ')' : ''}${r.explicacao && Math.abs(Number(r.diferenca)) > 0.015 ? ' — diferença de R$ ' + fmt(Number(r.diferenca)) + ' explicada: ' + r.explicacao : ''}">✓</span>`;
    if (r.situacao === 'DIFERE') {
      const d = Number(r.diferenca);
      return `<span class="dfc-conf dif" title="${d < 0 ? 'faltam lançamentos: o saldo ' + ref + ' tem R$ ' + fmt(-d) + ' a mais que o Saipos' : 'o Saipos tem R$ ' + fmt(d) + ' acima do saldo ' + ref} (em ${ddmm(r.ref_fim_data)})">≠ ${fmt(Math.abs(d))}</span>`;
    }
    return '<span class="dfc-conf sem" title="sem extrato nem saldo informado para conferir">·</span>';
  };
  if (dfcAberto.has('SALDO_FIM')) contas.forEach(c => {
    const vals = saldoFimConta[c.conta];
    corpo += `<tr class="dfc-conta"><td>${nomeConta(c.conta)}</td>${vals.map((v, i) => `<td class="${v < -0.005 ? 'negativo' : ''}">${fmt(v)}${marcaConf(confDe(c.conta, meses[i]))}</td>`).join('')}${celRS(vals[nM - 1])}</tr>`;
  });
  // resumo do mês: quantas contas com extrato bateram (sempre visível)
  const resumoConf = meses.map(m => {
    const rs = contas.map(c => confDe(c.conta, m)).filter(r => r && r.situacao !== 'SEM EXTRATO');
    if (!rs.length) return '';
    const ok = rs.filter(r => r.situacao === 'BATEU').length;
    const dif = rs.filter(r => r.situacao === 'DIFERE');
    if (ok === rs.length) return `<span class="dfc-conf ok">✓ ${ok} de ${rs.length} contas batem</span>`;
    const soma = dif.reduce((s, r) => s + Math.abs(Number(r.diferenca)), 0);
    return `<span class="dfc-conf dif" title="${dif.map(r => nomeConta(r.conta) + ': ' + fmt(Number(r.diferenca))).join(' · ')}">${ok} de ${rs.length} batem · R$ ${fmt(soma)} a explicar</span>`;
  });
  if (resumoConf.some(x => x)) corpo += `<tr class="dfc-conta dfc-confer"><td>conferência com o extrato</td>${resumoConf.map(x => `<td>${x}</td>`).join('')}<td></td></tr>`;
  // saldo separado por natureza (proposta do financeiro, 13/08): o total
  // sozinho dava impressao de folga — a maior parte esta aplicada e nao
  // paga conta. Mesma separacao que o Projetado ja faz.
  const APLICACAO = ['XP INVESTIMENTOS', 'PARTICIPACOES'];
  const somaContas = (filtro) => meses.map((_, i) =>
    contas.filter(filtro).reduce((s, c) => s + saldoFimConta[c.conta][i], 0));
  const saldoEmConta  = somaContas(c => !APLICACAO.includes(c.conta) && !c.conta.startsWith('CREDITO'));
  const saldoAplicado = somaContas(c => APLICACAO.includes(c.conta));
  const saldoCartao   = somaContas(c => c.conta.startsWith('CREDITO'));
  corpo += linhaSaldo('dfc-conta', 'em conta (paga as contas)', saldoEmConta, null, saldoEmConta[nM - 1]);
  corpo += linhaSaldo('dfc-conta', 'aplicado (XP e Participações)', saldoAplicado, null, saldoAplicado[nM - 1]);
  if (saldoCartao.some(v => Math.abs(v) > 0.005))
    corpo += linhaSaldo('dfc-conta', 'no cartão de crédito', saldoCartao, null, saldoCartao[nM - 1]);   // 07/11/2026: soma no saldo total (auditoria dinheiro-23)

  // distribuição "de onde vem / pra onde vai" (proposta do financeiro, 13/08)
  const entradasPorSub = subtiposDe(r => r.natureza === 'RECEITAS')
    .map(s => [s, tot(somar(r => r.natureza === 'RECEITAS' && r.subtipo === s))])
    .filter(x => x[1] > 0).sort((a, b) => b[1] - a[1]);
  const saidasPorTipo = [...new Set(DFC_MENSAL
      .filter(r => r.natureza === 'DESPESAS' && r.tipo !== 'INVESTIMENTOS').map(r => r.tipo))]
    .map(t => [t, tot(somar(r => r.natureza === 'DESPESAS' && r.tipo === t, -1))])
    .filter(x => x[1] > 0).sort((a, b) => b[1] - a[1]);

  const nSemClass = Math.abs(total(semClass));
  alvo.innerHTML = plcCabecalhoQuebra('fluxo') + seletorLojaFin() + `
  <div class="section-label" style="border-top:none; margin-top:0; padding-top:0;">Fluxo de Caixa — ${nomeLojaFin()}</div>
  <div class="caption-label" style="text-align:center;" title="Clique nas linhas com ▶ para abrir o detalhe.">
    Caixa realizado mês a mês, todos os canais da loja escolhida no botão acima — os filtros de período e
    loja do topo <b>não valem aqui</b>, eles são só do iFood.
  </div>
  ${iSel >= 0 ? `<div class="contexto" style="border-color:var(--brand);">
    <b>Filtrando:</b>
    <button class="preset-btn active" onclick="fluxoFixarMes('${meses[iSel]}')">${rotuloMes(meses[iSel])} ✕</button>
    <div style="font-size:12px; color:var(--tx-3); margin-top:6px;">Os quatro cartões e os dois gráficos de origem e destino falam deste mês. A tabela continua mostrando todos os meses, para você trocar.</div>
  </div>` : ''}
  <div class="cards">
    <div class="card blue"><div class="card-lbl">Receitas ${iSel >= 0 ? 'em ' + rotuloMes(meses[iSel]) : 'no ano'}</div><div class="card-val">R$ ${fmt(tot(receitas))}</div></div>
    <div class="card ${tot(resultOper) >= 0 ? 'pos' : 'neg'}"><div class="card-lbl">Sobra de caixa da operação</div><div class="card-val">R$ ${fmt(tot(resultOper))}</div>
      <div class="card-pct">${tot(receitas) ? pct(tot(resultOper) / tot(receitas) * 100) : 0}% da receita</div></div>
    <div class="card ${tot(resultFim) >= 0 ? 'pos' : 'neg'}"><div class="card-lbl">Resultado final (caixa)</div><div class="card-val">R$ ${fmt(tot(resultFim))}</div></div>
    <div class="card highlight"><div class="card-lbl">${Math.abs(saldoAplicado[iFim]) > 0.005 ? 'Saldo total, com a XP' : 'Saldo'} (${rotuloMes(meses[iFim])})</div><div class="card-val">R$ ${fmt(saldoFim[iFim])}</div>${Math.abs(saldoAplicado[iFim]) > 0.005 || Math.abs(saldoCartao[iFim]) > 0.005 ? `<div class="card-pct">em conta R$ ${fmt(saldoEmConta[iFim])} · aplicado R$ ${fmt(saldoAplicado[iFim])}${Math.abs(saldoCartao[iFim]) > 0.005 ? ` · cartão R$ ${fmt(saldoCartao[iFim])}` : ''}</div>` : ''}</div>
  </div>
  ${nSemClass > 0.005 ? `<div class="contexto" style="border-color:#c8102e;">
    <b>R$ ${fmt(nSemClass)}</b> em lançamentos ainda <b>sem classificação</b> (linha "SEM CLASSIFICAÇÃO" abaixo) —
    classifique na origem e reimporte para o DFC ficar 100% detalhado.</div>` : ''}
  <div style="height:260px; margin:14px 0 4px;"><canvas id="chartFluxoEvolucao"></canvas></div>
  <div style="height:150px; margin:0 0 14px;"><canvas id="chartFluxoSaldo"></canvas></div>
  <div id="tabelaDFC">
    <table>
      <tr><th></th>${meses.map(m => {
        // o mes que veio do Placar fica marcado: a tabela tem 9 colunas e sem a
        // marca a pessoa clica em "Caixa de agosto" e precisa procurar agosto
        const doPlacar = ctxFluxo && ctxFluxo.meses.includes(m);
        // clicar na coluna fixa o mes nos cartoes e nos dois graficos; de novo, solta
        const fixo = m === FLX_MES;
        const est = fixo ? 'color:var(--brand); border-bottom:2px solid var(--brand); background:var(--brand-wine);'
          : doPlacar ? 'color:var(--brand); border-bottom:2px solid var(--brand);' : '';
        return `<th onclick="fluxoFixarMes('${m}')" style="cursor:pointer;${est}" title="${fixo ? 'clique para soltar o mês' : 'clique para os cartões e os dois gráficos falarem só de ' + rotuloMes(m)}">${rotuloMes(m)}${m.slice(0, 7) === mesAtual ? '<div class="th-emcurso">em curso</div>' : ''}${doPlacar ? '<div class="th-emcurso" style="color:var(--brand);">do Placar</div>' : ''}${fixo ? '<div class="th-emcurso" style="color:var(--brand);">fixado ✕</div>' : ''}</th>`;
      }).join('')}<th>Total</th></tr>
      ${corpo}
    </table>
  </div>
  <div class="section-label">De onde vem e para onde vai o dinheiro${iSel >= 0 ? ' — ' + rotuloMes(meses[iSel]) : ''}</div>
  <div style="display:grid; grid-template-columns:repeat(auto-fit,minmax(320px,1fr)); gap:16px;">
    <div><div class="caption-label">Entradas por origem</div>
      <div style="height:${Math.max(200, entradasPorSub.length * 30)}px;">
        <canvas id="chartOrigemEntradas"></canvas></div></div>
    <div><div class="caption-label">Saídas por grupo</div>
      <div style="height:${Math.max(200, saidasPorTipo.length * 30)}px;">
        <canvas id="chartDestinoSaidas"></canvas></div></div>
  </div>
  <div class="caption-label" title="Aplicado é dinheiro da empresa, mas não está disponível para o dia a dia. A XP entra no Saipos pela saída do Itaú e pelo rendimento de cada mês (decisão de 03/09/2026). Jan a jul/2026 vieram da planilha de fluxo realizado, validados linha a linha; de agosto em diante a base vem do Saipos. Clique em SALDO INICIAL/FINAL para ver conta a conta.">Nas linhas de fluxo, o percentual cinza é a fatia da receita do mês.
  Nos saldos, a coluna Total mostra o saldo na ponta do período (não a soma dos meses).</div>`;

  // ---- graficos (proposta do chat financeiro, 13/08/2026) ----
  // Evolucao: barras receita x despesa. O saldo do fim do mes MOROU AQUI DENTRO ate
  // 12/09/2026, numa linha com eixo Y proprio a direita. Dois eixos Y fazem "subiu
  // ou caiu" depender de qual deles o olho pegou: a mesma linha parece furar as
  // barras num mes e passar longe noutro so pela escala. Duas medidas de grandeza
  // diferente viram DOIS graficos, na mesma sequencia de meses, um debaixo do outro.
  destroyChart('chartFluxoEvolucao');
  chartInstances['chartFluxoEvolucao'] = new Chart(
    document.getElementById('chartFluxoEvolucao').getContext('2d'), {
    data: {
      labels: meses.map(rotuloMes),
      datasets: [
        // FAROL E STATUS, NAO SERIE (12/09/2026). O verde aqui dizia "bom" sobre
        // um numero que e so MEDIDA. A dupla passa a ser --info para o que entra
        // e --brand para o que sai, a mesma do par de graficos logo abaixo.
        { type: 'bar', label: 'Receitas', data: receitas,
          backgroundColor: corTokenA('--info', 0.75) },
        { type: 'bar', label: 'Despesas', data: despesas,
          backgroundColor: corTokenA('--brand', 0.75) },
      ],
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      interaction: { mode: 'index', intersect: false },
      plugins: { tooltip: { callbacks: { label: (c) => `${c.dataset.label}: R$ ${fmt(c.parsed.y)}` } } },
      scales: { y: { title: { display: true, text: 'Receita e despesa (R$)' } } },
    },
  });

  // O saldo sozinho, na mesma escala de tempo e com escala propria de valor: uma
  // serie, um eixo, sem competir com as barras. Neutro de texto porque o saldo aqui
  // e o CONTEXTO do grafico de cima, nao uma terceira entidade.
  destroyChart('chartFluxoSaldo');
  chartInstances['chartFluxoSaldo'] = new Chart(
    document.getElementById('chartFluxoSaldo').getContext('2d'), {
    type: 'line',
    data: {
      labels: meses.map(rotuloMes),
      datasets: [{ label: (temAplic ? 'Saldo no fim do mês, com a XP' : 'Saldo no fim do mês') + (saldoCartao.some(v => Math.abs(v) > 0.005) ? ' e o cartão' : ''), data: saldoFim,
        borderColor: corToken('--tx-creme'), backgroundColor: corToken('--tx-creme'),
        borderWidth: 2, tension: 0.25, pointRadius: 3 }],
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      interaction: { mode: 'index', intersect: false },
      plugins: { tooltip: { callbacks: { label: (c) => `${c.dataset.label}: R$ ${fmt(c.parsed.y)}` } } },
      scales: { y: { title: { display: true, text: 'Saldo (R$)' } } },
    },
  });

  [['chartOrigemEntradas', entradasPorSub, corToken('--info')],
   ['chartDestinoSaidas', saidasPorTipo, corToken('--brand')]].forEach(([id, dados, cor]) => {
    destroyChart(id);
    chartInstances[id] = new Chart(document.getElementById(id).getContext('2d'), {
      type: 'bar',
      data: { labels: dados.map(d => d[0]), datasets: [{ data: dados.map(d => d[1]),
              backgroundColor: cor, borderRadius: 4 }] },
      options: {
        indexAxis: 'y', responsive: true, maintainAspectRatio: false,
        layout: { padding: { right: 80 } },
        plugins: { legend: { display: false },
                   tooltip: { callbacks: { label: (c) => `R$ ${fmt(c.parsed.x)}` } } },
        scales: { x: { beginAtZero: true } },
      },
      plugins: [pluginRotulosBarra((i) => 'R$ ' + fmt(dados[i][1]))],
    });
  });
  encaixarColunaFixa('tabelaDFC');
}

// ------------------------------------------------------------------
// Modulo DRE — demonstrativo de resultado gerencial da Agua Verde.
// Mesma base do DFC (fin_lancamentos), reorganizada em formato DRE:
// receita liquida, custo, lucro bruto, despesas por funcao, EBITDA e
// resultado. E' regime de caixa gerencial (nao e' a DRE contabil):
// receita quando o dinheiro entra, despesa de cartao no ciclo da fatura.
// Cada celula traz R$ + analise vertical (AV, % da receita liquida) e
// horizontal (AH, variacao vs mes anterior). As linhas estruturais tem
// farol contra as metas de fin_metas_dre (editavel no banco, sem deploy).
// ------------------------------------------------------------------
let drePeriodo = 'ano';  // 'ano' | '6m' | '3m' | 'custom' (De/Ate escolhidos na tela)

let dreDe = null, dreAte = null;  // janela personalizada (mes 'AAAA-MM-DD' da view)

// Mes do bloco Fechamento e da ponte DRE x DFC. null = o ultimo mes fechado DENTRO da
// janela exibida; clicar no cabecalho de uma coluna fixa aquele mes, clicar de novo solta.
let DRE_MES_FIXO = null;

const dreAberto = new Set();

let DRE_METAS = null;    // fin_metas_dre: chave -> {sentido, meta}

let DRE_METAS_MES = null; // fin_metas_dre_mes: 'chave|mes' -> % (01/10/2026: a meta do mes, quando existe)

let DRE_FIN = null;      // vw_fin_dre_mensal: financeiro Saipos por COMPETENCIA (desde jan/26)

let DRE_VENDAS = null;   // vw_vendas_canal_mensal: receita bruta por canal (PDV Saipos)

let DRE_CANAL = null;    // vw_canal_custo_mes (3 lojas): custo dos canais por FATO, cada cobranca com nome

// 07/10/2026 (dono, Pauta de 06/10): linhas de classe INFO que a tela MOSTRA sem somar.
// A promocao paga pela loja no iFood saiu das deducoes (a venda do PDV ja vem com ela
// descontada) e fica visivel como informativa. Outra INFO so aparece se entrar nesta lista.
// 15/10/2026: a promocao voltou a ser deducao (venda cheia, fxVendaCheia) — a lista fica vazia.
const DRE_INFO_VISIVEL = [];

// Agrupamento das funcoes da DRE -> tipos do plano de contas
// Estrutura do fechamento do Matheus (MA Consultoria), decisao do dono em
// 03/09/2026: "somente a estrutura, os calculos de cada linha sao nossos".
// Ordem de exibicao: CMV -> margem de contribuicao -> pessoal -> administrativas
// e imovel -> comerciais -> resultado operacional. A ORDEM DESTE ARRAY nao muda
// (a ponte papel x caixa e os cards do fechamento indexam por posicao).
// Anuncios do iFood e comissoes de vendedores sairam de VENDA e viraram
// DEDUCOES DA RECEITA (posicao do Matheus; substitui a decisao de 16/08 que
// tratava anuncio como marketing). O resultado operacional nao muda com isso.
const DRE_GRUPOS = [
  ['CUSTO',   '(−) CMV — MERCADORIA (insumos, embalagens, uso e consumo)', ['MATERIA PRIMA', 'USO E CONSUMO']],
  ['PESSOAL', '(−) PESSOAL (salários e encargos, diretoria)',        ['PESSOAL', 'PRO LABORE']],
  ['VENDA',   '(−) COMERCIAIS (motoboys, marketing, fretes)', ['DESPESAS COMERCIAIS', 'DESPESAS LOGISTICA', 'DESPESAS MARKETING']],
  ['ADMIN',   '(−) ADMINISTRATIVAS E IMÓVEL (aluguel, energia, manutenção, sistemas)', ['DESPESAS ADMINISTRATIVAS', 'DESPESAS MANUTENÇÃO', 'IMPOSTOS E TAXAS']],
];

// rotulos dos tipos dentro de cada grupo, na lingua do fechamento do Matheus
const DRE_TIPO_ROTULO = { 'PESSOAL': 'SALÁRIOS, ENCARGOS E BENEFÍCIOS', 'PRO LABORE': 'DIRETORIA (PRÓ-LABORE)',
  'DESPESAS LOGISTICA': 'ENTREGA (MOTOBOYS)', 'DESPESAS MARKETING': 'MARKETING', 'DESPESAS COMERCIAIS': 'COMERCIAIS (fretes, atendimento)',
  'DESPESAS ADMINISTRATIVAS': 'ADMINISTRATIVAS E IMÓVEL', 'DESPESAS MANUTENÇÃO': 'MANUTENÇÃO', 'IMPOSTOS E TAXAS': 'IMPOSTOS E TAXAS',
  'MATERIA PRIMA': 'MATÉRIA-PRIMA', 'USO E CONSUMO': 'EMBALAGENS, DESCARTÁVEIS, GÁS E USO' };

// ---------------------------------------------------------------
// Farol do beneficio de R$ 500 mil do iFood (aplicado da fila em 16/08/2026).
// O iFood isentou a comissao de 9,5% nas lojas que nao pagam comissao (12 ate 05/10/2026, 11 depois) ate somar
// R$ 500 mil. Que loja entra na conta mora no banco: beneficio_ifood_loja_fora + vw_beneficio_ifood_pedido.
// Quando acabar, os 9,5% voltam de uma vez — o painel avisa antes.
// Fonte: vw_beneficio_ifood_farol (uma linha) e vw_beneficio_ifood_semana.
let BENEF_FAROL = null;   // { f, semanas }

let DRE_BENEF = null;     // mes -> beneficio_ifood JA FILTRADO pela loja escolhida

let DRE_BENEF_RAW = null; // vw_fin_dre_beneficio cru: uma linha por mes E unidade

// O beneficio segue a loja do seletor: em REDE soma as tres, senao pega so a
// dela. Antes de 24/08/2026 isso nao existia e o mapa era montado sobrescrevendo
// o mes — sobrava o beneficio de uma unidade qualquer.
function aplicarBenefLoja() {
  DRE_BENEF = {};
  (DRE_BENEF_RAW || []).forEach(b => {
    if (lojaFin() !== 'REDE' && b.unidade !== lojaFin()) return;
    DRE_BENEF[b.mes] = (DRE_BENEF[b.mes] || 0) + (Number(b.beneficio_ifood) || 0);
  });
}

async function carregarBeneficioIfood() {
  const [farol, semanas] = await Promise.all([
    consultarTudo('vw_beneficio_ifood_farol?select=*'),
    consultarTudo('vw_beneficio_ifood_semana?select=semana,beneficio,acumulado,restante&order=semana.asc'),
  ]);
  return { f: farol[0] || null, semanas };
}

function blocoBeneficioIfood({ f, semanas }) {
  if (!f) return '';
  const cor = { VERDE:'#3fb950', AMBAR:'#f5a623', VERMELHO:'#ff6b6b' }[f.farol] || '#8a897e';
  const reais = (v) => 'R$ ' + Number(v).toLocaleString('pt-BR', { minimumFractionDigits:2, maximumFractionDigits:2 });
  const dia = (v) => v ? new Date(v + 'T12:00:00').toLocaleDateString('pt-BR', { day:'2-digit', month:'long', year:'numeric' }) : '—';
  const pctB = Number(f.pct_consumido);

  // barra de consumo: uma leitura so, sem precisar ler numero
  const barra =
    '<div style="background:#34332f; border-radius:8px; height:14px; overflow:hidden; margin:10px 0 6px 0;">' +
      '<div style="width:' + Math.min(pctB,100) + '%; height:100%; background:' + cor + ';"></div>' +
    '</div>' +
    '<div style="display:flex; justify-content:space-between; font-size:11px; color:#a5a49a;">' +
      '<span>usado até agora (estimativa) ' + reais(f.consumido) + '</span>' +
      '<span>ainda restam (estimativa) ' + reais(f.restante) + '</span>' +
    '</div>';

  // ultimas 8 semanas, para ver se o ritmo esta acelerando
  const ult = semanas.slice(-8).map(s =>
    '<tr><td style="padding:3px 8px; color:#a5a49a;">' +
      new Date(s.semana + 'T12:00:00').toLocaleDateString('pt-BR', { day:'2-digit', month:'2-digit' }) +
    '</td><td style="padding:3px 8px; text-align:right;">' + reais(s.beneficio) +
    '</td><td style="padding:3px 8px; text-align:right; color:#a5a49a;">' + reais(s.restante) + '</td></tr>').join('');

  // Compacto por padrao (arrumacao de 16/08 a pedido do dono): barra + uma linha
  // de leitura sempre visiveis; cards, explicacao e semanas dobram num <details>.
  return `
  <div class="section-label">Isenção de comissão do iFood — quanto dos R$ 500 mil já foi usado (estimativa)</div>
  ${barra}
  <div class="caption-label" style="text-align:center;">
    <b style="color:${cor};">${pctB.toLocaleString('pt-BR')}% usado (estimativa)</b> ·
    acaba por volta de <b style="color:${cor};">${dia(f.fim_previsto)}</b>
    (${Number(f.semanas_restantes).toLocaleString('pt-BR')} semanas no ritmo atual) —
    quando acabar, os 9,5% de comissão voltam de uma vez. O número oficial é o do portal do iFood.
  </div>
  <details style="margin-top:6px;">
    <summary style="cursor:pointer; color:#a5a49a; font-size:12px;">detalhes da isenção</summary>
    <div class="cards" style="margin-top:10px;">
      <div class="card" style="border:1px solid ${cor};">
        <div style="font-size:26px; font-weight:700; color:${cor};">${pctB.toLocaleString('pt-BR')}%</div>
        <div style="font-size:12px; color:#a5a49a;">dos R$ 500 mil já usados (estimativa)</div>
      </div>
      <div class="card">
        <div style="font-size:26px; font-weight:700;">${reais(f.restante)}</div>
        <div style="font-size:12px; color:#a5a49a;">ainda disponível</div>
      </div>
      <div class="card">
        <div style="font-size:26px; font-weight:700;">${reais(f.ritmo_semanal)}</div>
        <div style="font-size:12px; color:#a5a49a;">usado por semana<br>(média das 8 últimas)</div>
      </div>
      <div class="card" style="border:1px solid ${cor};">
        <div style="font-size:20px; font-weight:700; color:${cor};">${dia(f.fim_previsto)}</div>
        <div style="font-size:12px; color:#a5a49a;">acaba por volta de<br>(${Number(f.semanas_restantes).toLocaleString('pt-BR')} semanas)</div>
      </div>
    </div>
    <div class="caption-label">
      O iFood deixou de cobrar a comissão de 9,5% em 11 lojas, até somar R$ 500 mil.
      Loja que paga comissão fica fora da conta: as do Boqueirão, a Comida Brasileira AV e,
      desde 06/10/2026, a Marmita da Jane (antiga Veganete Água Verde), que passou a usar a
      entrega do iFood — nesse plano os 9,5% voltam a ser cobrados.
      A data se move com o volume: <b>vender mais consome o benefício mais rápido</b>.
      <b>Esta barra é uma estimativa de quanto o iFood já usou dos R$ 500 mil:</b> 9,5% da venda de
      cada pedido (itens + entrega − desconto que a loja banca), do jeito que o iFood cobra a comissão
      nas lojas que pagam, desde 02/04/2026. <b>Não é o que foi enviado para a XP:</b> até 04/10/2026 o
      envio foi calculado sobre o valor que o iFood depositou, que dá uns 12% a menos, e não será refeito
      (o quadro do envio está no Fluxo projetado).
      <b>O número oficial é o do portal do iFood:</b> conferir lá antes de decidir pela data.
    </div>
    <table style="width:100%; font-size:12px; margin-top:8px;">
      <tr style="color:var(--tx-4);"><td style="padding:3px 8px;">semana</td>
        <td style="padding:3px 8px; text-align:right;">usado na semana (estimativa)</td>
        <td style="padding:3px 8px; text-align:right;">restava (estimativa)</td></tr>
      ${ult}
    </table>
  </details>`;
}

async function entrarDre() {
  const alvo = document.getElementById('view-dre');
  if (DRE_RAW === null) {   // DRE_FIN e derivado; quem diz se ja buscou e o cru
    alvo.innerHTML = '<div class="contexto">Carregando DRE...</div>';
    let metas, benefMes, metasMes;
    [DRE_RAW, DRE_VENDAS_RAW, metas, BENEF_FAROL, benefMes, DRE_CANAL, metasMes] = await Promise.all([
      consultarTudo('vw_fin_dre_mensal?select=unidade,mes,natureza,tipo,subtipo,ordem,credito,debito&order=mes,ordem'),
      consultarTudo('vw_vendas_canal_mensal?select=unidade,mes,canal,vendas,receita&order=mes'),
      consultarTudo('fin_metas_dre?select=chave,sentido,pct_meta&order=ordem'),
      carregarBeneficioIfood(),
      // com unidade: a view tem UMA LINHA POR MES E UNIDADE, e sem ela o
      // DRE_BENEF sobrescrevia o mes e mostrava o beneficio de uma loja so
      // (achado 24/08/2026 — a linha do beneficio ficava menor que a verdade
      // no consolidado e trocada de loja quando o dono filtrava).
      consultarTudo('vw_fin_dre_beneficio?select=mes,unidade,beneficio_ifood&order=mes'),
      // custo dos canais por FATO nas 3 lojas (vw_canal_custo_mes, 03/09/2026):
      // cada cobranca do iFood e da Rede com nome — abre a linha de deducoes
      consultarTudo('vw_canal_custo_mes?select=mes,unidade,linha,classe,rotulo,custo&mes=gte.2026-01-01'),
      // a meta do mes (01/10/2026), a mesma consulta do Fechamento/Placar; sem a tabela, segue so com a geral
      consultarTudo('fin_metas_dre_mes?select=chave,mes,pct_meta').catch(() => []),
      garantirDadosFin(),   // DFC (caixa) para a ponte DRE x DFC do mes fechado
    ]);
    fxVendaCheia(DRE_VENDAS_RAW, DRE_CANAL, 'receita');   // 15/10/2026: venda cheia + promoção como dedução
    // A mercadoria que a filial compra da AV entra por COMPETENCIA e ja vem
    // dentro de vw_fin_dre_mensal (fin_dre_ajuste, 25/08/2026) — nao buscar a
    // lista de novo aqui: somar por fora dobrava o efeito por loja (corrigido
    // em 27/08/2026).
    aplicarLojaFin();   // deriva DRE_FIN e DRE_VENDAS da loja escolhida
    DRE_METAS = {};
    metas.forEach(m => { DRE_METAS[m.chave] = { sentido: m.sentido, meta: Number(m.pct_meta) }; });
    DRE_METAS_MES = {};
    (metasMes || []).forEach(m => { DRE_METAS_MES[m.chave + '|' + m.mes] = Number(m.pct_meta); });
    DRE_BENEF_RAW = benefMes;
    aplicarBenefLoja();
  }
  renderModuloDRE();
}

function dreToggle(chave) {
  if (dreAberto.has(chave)) dreAberto.delete(chave); else dreAberto.add(chave);
  renderModuloDRE();
}

function drePeriodoSet(p) { drePeriodo = p; dreDe = dreAte = null; DRE_MES_FIXO = null; renderModuloDRE(); }

// Clique no cabecalho de um mes: fixa aquele mes no Fechamento e na ponte DRE x DFC
// la embaixo. Clicar no mes ja fixado solta e volta ao ultimo mes fechado da janela.
function dreFixarMes(m) { DRE_MES_FIXO = (DRE_MES_FIXO === m) ? null : m; renderModuloDRE(); }

function dreRangeSet() {
  dreDe = document.getElementById('dreSelDe').value;
  dreAte = document.getElementById('dreSelAte').value;
  drePeriodo = 'custom';
  renderModuloDRE();
}

function renderModuloDRE() {
  const alvo = document.getElementById('view-dre');
  if (!DRE_FIN || !DRE_FIN.length) {
    alvo.innerHTML = seletorLojaFin() +
      `<div class="contexto" style="border-color:#c8102e;">Sem lançamentos financeiros para esta loja.</div>`;
    return;
  }
  const mesAtual = mesCorrenteSP();
  const meses = [...new Set([...DRE_FIN.map(r => r.mes), ...DRE_VENDAS.map(r => r.mes)])].sort()
    .filter(m => m.slice(0, 7) <= mesAtual);
  const nM = meses.length;
  const idxMes = Object.fromEntries(meses.map((m, i) => [m, i]));
  const rotuloMes = (m) => { const [a, mm] = m.split('-'); return `${MESES_ABREV[Number(mm) - 1]}/${a.slice(2)}`; };

  const somar = (pred, sinal = 1) => {
    const v = Array(nM).fill(0);
    DRE_FIN.forEach(r => { if (pred(r) && idxMes[r.mes] !== undefined) v[idxMes[r.mes]] += (r.credito - r.debito) * sinal; });
    return v;
  };
  const menos = (a, b) => a.map((x, i) => x - b[i]);
  const total = (v) => v.reduce((s, x) => s + x, 0);
  const subtiposDe = (pred) => {
    const vistos = new Map();
    DRE_FIN.forEach(r => { if (pred(r) && !vistos.has(r.subtipo)) vistos.set(r.subtipo, r.ordem); });
    return [...vistos.entries()].sort((a, b) => a[1] - b[1]).map(([s]) => s);
  };

  // ---- receitas: vendas do PDV por canal (bruto) + recebimentos fora do PDV ----
  const canais = [...new Set(DRE_VENDAS.map(r => r.canal))]
    .sort((a, b) => DRE_VENDAS.filter(r => r.canal === b).reduce((s, r) => s + r.receita, 0)
                  - DRE_VENDAS.filter(r => r.canal === a).reduce((s, r) => s + r.receita, 0));
  const porCanal = {};
  canais.forEach(c => { porCanal[c] = Array(nM).fill(0); });
  DRE_VENDAS.forEach(r => { if (idxMes[r.mes] !== undefined) porCanal[r.canal][idxMes[r.mes]] += r.receita; });
  const recBruta = meses.map((_, i) => canais.reduce((s, c) => s + porCanal[c][i], 0));

  // recebimentos do PDV no financeiro (líquidos de comissão) x demais receitas
  const SUBT_PDV = ['RECEITAS CARTAO', 'RECEITAS ONLINE', 'RECEITAS DINHEIRO', 'RECEITAS FIADO'];
  const recPdvFin = somar(r => r.natureza === 'RECEITAS' && SUBT_PDV.includes(r.subtipo));
  const outrasRec = somar(r => r.natureza === 'RECEITAS' && !SUBT_PDV.includes(r.subtipo));
  // Custo dos canais por FATO (vw_canal_custo_mes, 03/09/2026): cada cobranca do
  // iFood (anuncios, taxa de transacao, comissao, retencoes, ressarcimentos) e
  // da Rede (MDR, antecipacao) com nome, nas 3 lojas.
  // 07/10/2026: a promocao paga pela loja e a entrega cobrada do cliente sairam
  // da soma (classe INFO na view) — a venda do PDV ja vem com a promocao
  // descontada e a entrega somada; contar de novo era deducao dupla.
  // 12/09/2026 (decisao do dono): a linha-MAE das deducoes passou a ser a SOMA
  // DO FATO (classe CANAL), e nao mais o "plug" (vendido no PDV − recebido no
  // financeiro). O plug misturava custo com defasagem de caixa (repasse do
  // iFood em ~1 semana, vales em ~30 dias) e fazia o resultado do mes oscilar
  // sem a operacao mudar (jul/26 dava taxa negativa; ago/26 escondia 32 mil).
  // A diferenca vendido × recebido continua visivel como CONFERENCIA, fora da
  // conta. Classe LOGISTICA (entrega sob demanda) vai para COMERCIAIS e classe
  // FINANCEIRO (antecipacao da Rede) para DESPESAS FINANCEIRAS — sao custos
  // reais que antes viviam dentro do plug. Mes sem fato (antes de 2026) segue
  // no plug. Estrutura do Matheus, calculo nosso.
  const canalLinha = {}, canalRotulo = {}, canalClasse = {}, canalOrdem = [];
  const canalInfo = {}, canalInfoRotulo = {};   // INFO que a tela mostra sem somar (DRE_INFO_VISIVEL)
  (DRE_CANAL || []).forEach(r => {
    if (lojaFin() !== 'REDE' && r.unidade !== lojaFin()) return;
    const i = idxMes[r.mes];
    if (r.classe === 'INFO') {   // linha informativa: nao e' deducao, nunca entra em soma nenhuma
      if (i !== undefined && DRE_INFO_VISIVEL.includes(r.linha)) {
        if (!canalInfo[r.linha]) { canalInfo[r.linha] = Array(nM).fill(0); canalInfoRotulo[r.linha] = r.rotulo; }
        canalInfo[r.linha][i] += Number(r.custo);
      }
      return;
    }
    if (i === undefined) return;
    if (!canalLinha[r.linha]) { canalLinha[r.linha] = Array(nM).fill(0); canalRotulo[r.linha] = r.rotulo; canalClasse[r.linha] = r.classe; canalOrdem.push(r.linha); }
    canalLinha[r.linha][i] += Number(r.custo);
  });
  const anunciosIf = canalLinha.ANUNCIOS || Array(nM).fill(0);
  const somaClasse = (cl) => meses.map((_, i) => canalOrdem.filter(k => canalClasse[k] === cl).reduce((s, k) => s + canalLinha[k][i], 0));
  const linhasCanal   = canalOrdem.filter(k => canalClasse[k] === 'CANAL');
  const somaCanalFato = somaClasse('CANAL');        // deducoes da receita, por fato
  const sobDemandaIf  = somaClasse('LOGISTICA');    // entrega sob demanda do iFood -> COMERCIAIS
  const antecipRede   = somaClasse('FINANCEIRO');   // antecipacao de recebiveis da Rede -> FINANCEIRAS
  // a conta antiga (plug): vendido no PDV − recebido no financeiro. Fica como
  // conferencia; so entra na DRE no mes em que nao ha fato nenhum.
  const plugCanais = menos(recBruta, recPdvFin);
  const temFato    = meses.map((_, i) => canalOrdem.some(k => Math.abs(canalLinha[k][i]) > 0.005));
  const taxasCanais = meses.map((_, i) => temFato[i] ? somaCanalFato[i] : plugCanais[i]);
  const defasagem   = meses.map((_, i) => temFato[i] ? plugCanais[i] - somaCanalFato[i] - sobDemandaIf[i] - antecipRede[i] : 0);
  // comissoes de vendedores: deducao da receita na estrutura do Matheus (03/09/2026)
  const comissoesVend = somar(r => r.natureza === 'DESPESAS' && r.subtipo === 'COMISSOES', -1);

  const ehInvest = (r) => r.tipo === 'INVESTIMENTOS';
  // classico: IRPJ e' imposto sobre o LUCRO, nao sobre a venda — sai das
  // deducoes e desce para logo antes do resultado liquido (Lei 11.638)
  const deducoes = somar(r => r.natureza === 'DEDUÇOES DA RECEITA' && r.subtipo !== 'IRPJ', -1);
  const irpj     = somar(r => r.natureza === 'DEDUÇOES DA RECEITA' && r.subtipo === 'IRPJ', -1);
  const recLiq   = meses.map((_, i) => recBruta[i] + outrasRec[i] - taxasCanais[i] - comissoesVend[i] - deducoes[i]);
  const deducoesTot = meses.map((_, i) => taxasCanais[i] + comissoesVend[i] + deducoes[i]);
  // base dos percentuais (AV, metas, fechamento) = receita BRUTA (vendas + outras
  // receitas), decisao do dono em 16/08: e' o numero que o operador conhece, o que
  // os benchmarks de restaurante usam, e nao oscila com a defasagem dos repasses
  // (em jul/26 a liquida ficou MAIOR que a bruta por causa da linha estimada).
  const baseAV = meses.map((_, i) => recBruta[i] + outrasRec[i]);

  // COMISSOES (de vendedores) saiu de COMERCIAIS: e' deducao da receita (03/09/2026)
  const predGrupo = (tipos) => (r) => r.natureza === 'DESPESAS' && !ehInvest(r) && tipos.includes(r.tipo) && r.subtipo !== 'COMISSOES';
  const gruposVals = DRE_GRUPOS.map(([chave, rotulo, tipos]) => [chave, rotulo, tipos, somar(predGrupo(tipos), -1)]);
  // entrega sob demanda do iFood (descontada no repasse, nao e' lancamento): custo de entrega, vai em COMERCIAIS (12/09/2026)
  gruposVals.forEach(g => { if (g[0] === 'VENDA') g[3] = g[3].map((v, i) => v + sobDemandaIf[i]); });
  // tipos de despesa que nao entraram em nenhum grupo (menos financeiras, tratadas abaixo)
  const tiposMapeados = DRE_GRUPOS.flatMap(g => g[2]).concat(['DESPESAS FINANCEIRAS']);
  const outrasDesp = somar(r => r.natureza === 'DESPESAS' && !ehInvest(r) && !tiposMapeados.includes(r.tipo), -1);

  const lucroBruto = menos(recLiq, gruposVals[0][3]);
  const ebitda = gruposVals.slice(1).reduce((acc, g) => menos(acc, g[3]), lucroBruto).map((v, i) => v - outrasDesp[i]);

  // Mercadoria entre unidades: desde 25/08/2026 a lista fechada do mes ja vem
  // DENTRO de vw_fin_dre_mensal (fin_dre_ajuste): LISTAS AHU/SB como receita da
  // AV e MERCADORIAS AV no CMV da filial. Nao somar de novo por fora — a linha
  // derivada de vw_tr_conta_listas_mensal dobrava o efeito por loja (na REDE os
  // dois lados se anulavam e escondiam o erro).

  // antecipacao de recebiveis da Rede (desconto por receber antes) e' custo financeiro, nao do canal (dono, 02/09/2026)
  const despFin = somar(r => r.tipo === 'DESPESAS FINANCEIRAS', -1).map((v, i) => v + antecipRede[i]);
  const recFin  = somar(r => r.natureza === 'APLICAÇÕES' && r.subtipo === 'RENDIMENTOS');
  const resFin  = menos(recFin, despFin);
  const semClass = somar(r => r.natureza === 'SEM CLASSIFICACAO');
  const resultadoAntes = ebitda.map((v, i) => v + resFin[i] + semClass[i]);
  const resultado = resultadoAntes.map((v, i) => v - irpj[i]);

  // abaixo da linha (nao entram no resultado — sao destino do lucro, nao custo dele)
  const invest    = somar(r => ehInvest(r) || r.natureza === 'INVESTIMENTOS', -1);
  const retiradas = somar(r => r.natureza === 'DISTRIBUICAO DE LUCROS', -1);
  const naoOper   = somar(r => r.natureza === 'APORTE VALORES');

  // ---- janela de exibicao (o calculo usa sempre a serie completa; so a
  // exibicao e' recortada — assim a AH do 1o mes visivel ainda compara
  // com o mes anterior, mesmo oculto). Presets sempre terminam no mes
  // corrente; De/Ate permite qualquer janela (pedido do dono, 16/08). ----
  let ini0, fim0 = nM - 1;
  if (drePeriodo === 'custom' && dreDe && dreAte) {
    let a = meses.indexOf(dreDe), b = meses.indexOf(dreAte);
    if (a < 0) a = 0;
    if (b < 0) b = nM - 1;
    ini0 = Math.min(a, b); fim0 = Math.max(a, b);
  } else {
    const nExib = drePeriodo === '3m' ? 3 : drePeriodo === '6m' ? 6 : nM;
    ini0 = Math.max(0, nM - nExib);
  }
  const cols = meses.slice(ini0, fim0 + 1);
  // ---- 01/10/2026 (dono: "o mesmo numero tem de ser o mesmo em toda tela") ----
  // O TOTAL SOMA SO MESES FECHADOS, como o Placar. O mes em curso continua na tabela
  // como coluna ("em curso"), mas fora da soma: ele tem a despesa do mes inteiro contra
  // meia venda e puxava o Total, e o % do Total, para um numero que nenhuma outra tela
  // mostra. Janela sem nenhum mes fechado: a coluna Total fica com traco.
  const mesFechado = (i) => meses[i].slice(0, 7) < mesAtual;
  const totalJan = (v) => { let s = 0; for (let i = ini0; i <= fim0; i++) if (mesFechado(i)) s += v[i]; return s; };
  const temFechadoJan = cols.some((_, k) => mesFechado(ini0 + k));
  const baseAVTot = totalJan(baseAV);
  // iF = o mes do bloco Fechamento la embaixo: o ultimo ja fechado dentro de [ini0, fim0];
  // DRE_MES_FIXO (clique no cabecalho da coluna) manda quando cai dentro da janela. Subiu
  // para ca porque o rotulo da meta de cada linha precisa dele antes de a tabela ser montada.
  let iF = -1;
  meses.forEach((m, i) => { if (i >= ini0 && i <= fim0 && m.slice(0, 7) < mesAtual) iF = i; });
  if (DRE_MES_FIXO) {
    const jF = meses.indexOf(DRE_MES_FIXO);
    if (jF >= ini0 && jF <= fim0 && meses[jF].slice(0, 7) < mesAtual) iF = jF;
  }
  // A META E' A DO MES quando ela existe em fin_metas_dre_mes (o custo desce meio ponto
  // por mes ate 32 em fev/27), senao a geral — a mesma regra do Placar (plcMeta). No Total,
  // a media das metas dos meses somados PESADA PELA BASE, tambem como o Placar: media
  // simples daria um numero que nao e' a meta de mes nenhum.
  const metaTemMes = (chave, i) => !!DRE_METAS_MES && DRE_METAS_MES[chave + '|' + meses[i]] !== undefined;
  const metaMes = (chave, i) => {
    const g = DRE_METAS && DRE_METAS[chave];
    if (!g) return null;
    return { sentido: g.sentido, meta: metaTemMes(chave, i) ? DRE_METAS_MES[chave + '|' + meses[i]] : g.meta };
  };
  const metaTotal = (chave) => {
    const g = DRE_METAS && DRE_METAS[chave];
    if (!g) return null;
    let num = 0, den = 0;
    for (let i = ini0; i <= fim0; i++) if (mesFechado(i)) { num += metaMes(chave, i).meta * baseAV[i]; den += baseAV[i]; }
    return den ? { sentido: g.sentido, meta: num / den } : g;
  };

  // farol da analise vertical contra a meta (fin_metas_dre)
  const corFarol = (m, av) => {
    if (!m || av === null) return null;
    const dist = m.sentido === 'abaixo' ? av - m.meta : m.meta - av;   // >0 = fora da meta
    if (dist <= 0) return 'var(--farol-ok)';
    if (dist <= m.meta * 0.10) return 'var(--farol-perto)';
    return 'var(--farol-fora)';
  };

  // celula: R$ em cima; embaixo AV e AH em cinza discreto. Cor e' EXCEÇÃO:
  // so aparece quando uma linha com meta esta fora dela (ambar = ate 10% de
  // distancia, vermelho = alem) — dentro da meta, nada pisca (decisao do
  // usuario: a versao com verde/vermelho em toda celula ficou carnavalesca).
  const celula = (v, base, vAnt, kind, meta) => {
    // linha de saida mostra o numero com sinal de menos (pedido do dono, 16/08:
    // "o olho le o numero, nao o titulo") — o % segue positivo.
    // Layout 16/08 a noite: % da receita AO LADO do numero, colorido pelo farol
    // (verde = dentro da meta); embaixo, a variacao vs mes anterior.
    const vMostra = kind === 'custo' ? -v : v;
    let avHtml = '';
    if (base) {
      const av = v / base * 100;
      const cor = meta ? corFarol(meta, av) : null;
      avHtml = `<span class="dre-av"${cor ? ` style="color:${cor}; font-weight:700;"` : ''}>${pct(av)}%</span>`;
    }
    const valorHtml = `<div class="${vMostra < -0.005 ? 'negativo' : ''}">${fmt(vMostra)}${avHtml}</div>`;
    let sub = '';
    if (vAnt !== null && Math.abs(vAnt) > 0.005) {
      const d = (v - vAnt) / Math.abs(vAnt) * 100;
      sub = `<div class="dre-sub">${d > 0.5 ? '▲' : d < -0.5 ? '▼' : '•'} ${pct(Math.abs(d))}% vs mês ant.</div>`;
    }
    return `<td>${valorHtml}${sub}</td>`;
  };

  const linha = (classe, label, vals, opts = {}) => {
    const { chave = null, kind = null, metaChave = null } = opts;
    const seta = chave ? (dreAberto.has(chave) ? '▼ ' : '▶ ') : '';
    const attrs = chave ? ` class="${classe} clicavel" onclick="dreToggle('${chave}')"` : ` class="${classe}"`;
    let tds = '';
    for (let i = ini0; i <= fim0; i++) {
      tds += celula(vals[i], baseAV[i], i > 0 ? vals[i - 1] : null, kind, metaChave ? metaMes(metaChave, i) : null);
    }
    tds += temFechadoJan ? celula(totalJan(vals), baseAVTot, null, kind, metaChave ? metaTotal(metaChave) : null) : '<td>—</td>';
    // a meta de referencia mora no rotulo da linha (fica visivel mesmo rolando
    // os meses) — nas celulas so aparece o farol quando ela e' estourada.
    // 01/10/2026: quando a meta muda mes a mes, o rotulo mostra a do mes que esta no
    // Fechamento la embaixo (sem mes fechado na janela, a da ultima coluna) e diz de que
    // mes ela e'; cada coluna continua pintada contra a meta do proprio mes.
    const iRot = iF >= 0 ? iF : fim0;
    const m = metaChave ? metaMes(metaChave, iRot) : null;
    const doMes = !!m && metaTemMes(metaChave, iRot);
    const metaTxt = m ? `<div><span class="meta-pill"${doMes ? ' title="A meta desta linha muda mês a mês: cada coluna é pintada contra a meta do próprio mês."' : ''}>🎯 meta${doMes ? ' de ' + rotuloMes(meses[iRot]) : ''}: ${m.sentido === 'abaixo' ? 'até' : ''} ${pct(m.meta)}%${m.sentido === 'abaixo' ? '' : ' ou mais'} da receita</span></div>` : '';
    return `<tr${attrs}><td>${seta}${label}${metaTxt}</td>${tds}</tr>`;
  };
  const blocoSubtipos = (chave, pred, sinal, kind = null) => {
    if (!dreAberto.has(chave)) return '';
    return subtiposDe(pred).map(s =>
      linha('dfc-linha', s, somar(r => pred(r) && r.subtipo === s, sinal), { kind })
    ).join('');
  };

  let corpo = '';
  corpo += linha('dfc-bloco', 'RECEITA BRUTA DE VENDAS (por canal)', recBruta, { chave: 'RECBRUTA', kind: 'ganho' });
  if (dreAberto.has('RECBRUTA')) canais.forEach(c => {
    corpo += linha('dfc-linha', c, porCanal[c], { kind: 'ganho' });
  });
  corpo += linha('dfc-bloco', lojaFin() === 'REDE' ? '(+) OUTRAS RECEITAS DA OPERAÇÃO (atacado, empresas, royalties)'
    : '(+) OUTRAS RECEITAS DA OPERAÇÃO (atacado, empresas, listas às filiais, royalties)', outrasRec, { chave: 'OUTREC', kind: 'ganho' });
  corpo += blocoSubtipos('OUTREC', r => r.natureza === 'RECEITAS' && !SUBT_PDV.includes(r.subtipo), 1, 'ganho');
  // Bloco de deducoes na estrutura do Matheus (03/09/2026): o que os canais e
  // o fisco levam antes de a receita ser nossa. A linha-mae e' a nossa conta
  // (vendido no PDV − recebido) + comissoes de vendedores + ICMS/devolucoes;
  // aberta, mostra cada cobranca pelo nome (fato) e a diferenca que sobra.
  corpo += linha('dfc-bloco', '(−) DEDUÇÕES DA RECEITA (anúncios, taxas iFood, cartões, comissões, ICMS)', deducoesTot, { chave: 'DEDUC', kind: 'custo' });
  if (dreAberto.has('DEDUC')) {
    linhasCanal.forEach(k => {
      if (!canalLinha[k].some(v => Math.abs(v) > 0.005)) return;
      corpo += linha('dfc-linha', canalRotulo[k] || k, canalLinha[k], { kind: 'custo' });
    });
    // 07/10/2026 (dono): informativa, FORA da conta — a promocao paga pela loja no iFood,
    // "ja descontada na venda". Mesmo desenho da linha de conferencia logo abaixo.
    DRE_INFO_VISIVEL.forEach(k => {
      if (!canalInfo[k] || !canalInfo[k].some(v => Math.abs(v) > 0.005)) return;
      corpo += linha('dfc-linha', `<i>Informativa, não entra na conta: ${canalInfoRotulo[k] || k}</i>`, canalInfo[k], {});
    });
    if (temFato.some(t => !t)) corpo += linha('dfc-linha', 'Taxas por diferença (vendido − recebido) — só nos meses sem fato', meses.map((_, i) => temFato[i] ? 0 : plugCanais[i]), { kind: 'custo' });
    // conferencia, fora da conta: o que a conta antiga (plug) daria a mais ou a
    // menos = defasagem dos repasses + taxa de vale sem fonte. Positivo = caiu
    // menos na conta do que o fato explica (repasse ainda por vir).
    corpo += linha('dfc-linha', '<i>Conferência, não entra na conta: vendido − recebido no mês − linhas acima (defasagem dos repasses; taxa dos vales ainda sem fonte)</i>', defasagem, {});
    if (comissoesVend.some(v => Math.abs(v) > 0.005)) corpo += linha('dfc-linha', 'Comissões de vendedores', comissoesVend, { kind: 'custo' });
    corpo += blocoSubtipos('DEDUC', r => r.natureza === 'DEDUÇOES DA RECEITA' && r.subtipo !== 'IRPJ', -1, 'custo');
  }
  corpo += linha('dfc-resultado', '(=) RECEITA LÍQUIDA', recLiq, { kind: 'ganho' });

  // ordem de exibicao do Matheus: CMV -> margem de contribuicao -> pessoal ->
  // administrativas e imovel -> comerciais -> resultado operacional
  const blocoGrupo = (gi) => {
    const [chave, rotulo, tipos, vals] = gruposVals[gi];
    corpo += linha('dfc-bloco', rotulo, vals, { chave: 'G:' + chave, kind: 'custo', metaChave: chave });
    if (dreAberto.has('G:' + chave)) {
      tipos.forEach(t => {
        const predT = predGrupo([t]);
        corpo += linha('dfc-grupo', DRE_TIPO_ROTULO[t] || t, somar(predT, -1), { chave: 'GT:' + t, kind: 'custo' });
        corpo += blocoSubtipos('GT:' + t, predT, -1, 'custo');
      });
      // 09/10/2026 (dono): "uma linha frete iFood e outra do frete sob demanda" — cada linha da classe
      // LOGISTICA sai com o nome que vem do banco (Full Service: comissao por raio e taxa de entrega
      // repassada; sob demanda), como ja e' feito com a classe CANAL nas deducoes. A soma nao muda.
      if (chave === 'VENDA') canalOrdem.filter(k => canalClasse[k] === 'LOGISTICA').forEach(k => {
        if (canalLinha[k].some(v => Math.abs(v) > 0.005)) corpo += linha('dfc-grupo', (canalRotulo[k] || k) + ' — descontado no repasse', canalLinha[k], { kind: 'custo' });
      });
    }
  };
  blocoGrupo(0);
  corpo += linha('dfc-resultado', '(=) MARGEM DE CONTRIBUIÇÃO (receita líquida − mercadoria)', lucroBruto, { kind: 'ganho', metaChave: 'LUCRO_BRUTO' });
  blocoGrupo(1);
  blocoGrupo(3);
  blocoGrupo(2);
  if (outrasDesp.some(v => Math.abs(v) > 0.005)) {
    corpo += linha('dfc-bloco', '(−) OUTRAS DESPESAS', outrasDesp, { kind: 'custo' });
  }
  corpo += linha('dfc-resultado', '(=) RESULTADO OPERACIONAL', ebitda, { kind: 'ganho', metaChave: 'EBITDA' });

  // (o bloco do beneficio iFood desceu para depois do RESULTADO LIQUIDO em 01/10/2026)

  // 28/09/2026 (dono): "o rendimento da XP deve entrar em uma linha separada como entradas
  // nao operacionais chamada rendimento aplicacoes, pode somar com os rendimentos automaticos
  // das contas correntes". Antes os dois ficavam liquidos num "(±) FINANCEIRAS" so.
  corpo += linha('dfc-bloco', '(+) RENDIMENTO APLICAÇÕES (entradas não operacionais)', recFin, { kind: 'ganho' });
  corpo += linha('dfc-bloco', '(−) JUROS E TARIFAS', despFin.map(v => -v), { chave: 'FIN', kind: 'ganho' });
  if (dreAberto.has('FIN')) {
    if (antecipRede.some(v => Math.abs(v) > 0.005)) corpo += linha('dfc-linha', 'sendo antecipação de recebíveis da Rede (descontada no repasse)', antecipRede.map(v => -v), { kind: 'ganho' });
  }
  if (semClass.some(v => Math.abs(v) > 0.005)) {
    corpo += linha('dfc-bloco', '(±) SEM CLASSIFICAÇÃO (revisar)', semClass);
  }
  if (irpj.some(v => Math.abs(v) > 0.005)) {
    corpo += linha('dfc-resultado', '(=) RESULTADO ANTES DO IMPOSTO DE RENDA', resultadoAntes, { kind: 'ganho' });
    corpo += linha('dfc-linha', '(−) Imposto de renda (IRPJ)', irpj, { kind: 'custo' });
  }
  corpo += linha('dfc-resultado', '(=) RESULTADO LÍQUIDO', resultado, { kind: 'ganho', metaChave: 'RESULTADO' });

  // Linha do beneficio iFood (aplicado da fila em 16/08/2026): o beneficio nao
  // e receita nova — e comissao que o iFood deixou de cobrar, diluida em
  // RECEITAS ONLINE. Lancar seria duplicar; por isso e linha DERIVADA de
  // fato_pedidos (vw_fin_dre_beneficio), como ajuste de leitura.
  // 01/10/2026 (dono: "o mesmo numero tem de ser o mesmo em toda tela"): o
  // recorrente e' o resultado LIQUIDO menos o beneficio — a mesma conta do
  // Fechamento do mes ("pagando comissao cheia, teria sobrado") e do Lucro por
  // unidade (resultado_sem_beneficio). Ate aqui a DRE tirava o beneficio do
  // resultado OPERACIONAL, e o mesmo nome dava dois numeros.
  const benefVals = meses.map(m => DRE_BENEF ? (DRE_BENEF[m] || 0) : 0);
  if (benefVals.some(v => v > 0.005)) {
    corpo += linha('dfc-linha', '(−) Comissão que o iFood deixou de cobrar (isenção)', benefVals, { kind: 'custo' });
    corpo += linha('dfc-resultado', '(=) RESULTADO SEM A ISENÇÃO DO IFOOD', resultado.map((v, i) => v - benefVals[i]), { kind: 'ganho' });
  }

  // ---- Abaixo do resultado (estrutura do Matheus, 03/09/2026): o que nao e'
  // resultado da operacao da loja mas mexe no dinheiro dela. ----
  // Lucro repassado pelas filiais = REGRA DO DONO (03/09/2026): o TOTAL que a
  // filial mandou no mes (bruto, com o bonus do iFood, que ele manda contar
  // como lucro da filial) menos a lista do mes. Na AV: creditos de RECEITAS
  // AHU/SAO BRAZ + BONUS − LISTAS AHU/SB. Na filial, o espelho: −(FILIAL AGUA
  // VERDE + BONUS) + MERCADORIAS AV. Na REDE os dois lados se anulam — o que
  // sobrar e' repasse sem contrapartida (ex.: cofre do SB, R$ 3.077 em ago/26).
  const somaCol = (pred, col) => {
    const v = Array(nM).fill(0);
    DRE_FIN.forEach(r => { if (pred(r) && idxMes[r.mes] !== undefined) v[idxMes[r.mes]] += r[col]; });
    return v;
  };
  const SUBT_ENTRADA_FILIAL = ['RECEITAS AHU', 'RECEITAS SAO BRAZ', 'BONUS COMISSAO IFOOD'];
  const SUBT_SAIDA_FILIAL = ['FILIAL AGUA VERDE', 'BONUS COMISSAO IFOOD'];
  const entFil = somaCol(r => r.natureza === 'APORTE VALORES' && SUBT_ENTRADA_FILIAL.includes(r.subtipo), 'credito');
  const saiFil = somaCol(r => r.natureza === 'APORTE VALORES' && SUBT_SAIDA_FILIAL.includes(r.subtipo), 'debito');
  const listasRec = somaCol(r => ['LISTAS AHU', 'LISTAS SAO BRAZ'].includes(r.subtipo), 'credito');
  const listasCusto = somaCol(r => r.subtipo === 'MERCADORIAS AV', 'debito');
  const lucroFiliais = meses.map((_, i) => entFil[i] - saiFil[i] - listasRec[i] + listasCusto[i]);
  const SUBT_FILIAL_TODOS = [...SUBT_ENTRADA_FILIAL, ...SUBT_SAIDA_FILIAL];
  const outrosNaoOper = somar(r => r.natureza === 'APORTE VALORES' && !SUBT_FILIAL_TODOS.includes(r.subtipo));

  corpo += `<tr class="dfc-saldo"><td colspan="${cols.length + 2}" style="text-align:left; font-weight:normal;">
    Abaixo do resultado (não é resultado da operação desta loja — é destino ou origem do dinheiro):</td></tr>`;
  if (lucroFiliais.some(v => Math.abs(v) > 0.005)) {
    corpo += linha('dfc-bloco', lojaFin() === 'AGUA VERDE' ? '(+) Lucro repassado pelas filiais (enviado − lista do mês)'
      : lojaFin() === 'REDE' ? '(±) Lucro repassado entre lojas (deveria zerar na rede)' : '(−) Lucro enviado à Água Verde (enviado − lista do mês)', lucroFiliais, { chave: 'INFOLUC' });
    if (dreAberto.has('INFOLUC')) {
      if (entFil.some(v => v > 0.005)) corpo += linha('dfc-linha', 'Recebido das filiais (listas, lucro e bônus do iFood)', entFil);
      if (saiFil.some(v => v > 0.005)) corpo += linha('dfc-linha', 'Enviado à Água Verde (listas, lucro e bônus do iFood)', saiFil.map(v => -v));
      if (listasRec.some(v => v > 0.005)) corpo += linha('dfc-linha', '− Listas do mês (já na receita acima)', listasRec.map(v => -v));
      if (listasCusto.some(v => v > 0.005)) corpo += linha('dfc-linha', '+ Listas do mês (já no CMV acima)', listasCusto);
    }
  }
  corpo += linha('dfc-bloco', '(−) Investimentos no período', invest.map(v => -v), { chave: 'INFOINV' });
  corpo += blocoSubtipos('INFOINV', r => ehInvest(r) || r.natureza === 'INVESTIMENTOS', -1);
  corpo += linha('dfc-bloco', '(−) Distribuição de lucros / retiradas', retiradas.map(v => -v), { chave: 'INFORET' });
  corpo += blocoSubtipos('INFORET', r => r.natureza === 'DISTRIBUICAO DE LUCROS', -1);
  if (outrosNaoOper.some(v => Math.abs(v) > 0.005)) {
    corpo += linha('dfc-bloco', '(±) Outros movimentos entre empresas e aportes', outrosNaoOper, { chave: 'INFONOP' });
    corpo += blocoSubtipos('INFONOP', r => r.natureza === 'APORTE VALORES' && !SUBT_FILIAL_TODOS.includes(r.subtipo), 1);
  }

  // ---- FECHAMENTO DO MES (estrutura absorvida do fechamento do consultor
  // Matheus em 16/08/2026 — foto de UM mes fechado vs o anterior, status em
  // PALAVRA com a regua visivel, Prime Cost e ponto de equilibrio. Os numeros
  // sao 100% do Saipos: as fontes nunca se misturam, so a ideia veio de la.) ----
  // iF (o mes que esta no Fechamento) e' calculado la em cima, junto da janela, desde
  // 01/10/2026: o rotulo da meta de cada linha e o cabecalho da tabela precisam dele.
  let fechHtml = '', ponteHtml = '';
  {
    // O Fechamento OBEDECE A JANELA exibida (presets e De/Até). Antes ele varria a
    // serie inteira: com De/Até em jun/26 a tabela terminava em junho e o Fechamento
    // embaixo continuava sendo agosto.
    if (iF >= 0 && recLiq[iF] > 0.005) {
      // ---- PONTE DRE x DFC (ultima ideia absorvida do fechamento do Matheus,
      // 16/08/2026): o lucro do papel virou caixa? Mesmos predicados nas duas
      // views (competencia = vw_fin_dre_mensal, caixa = vw_fin_dfc_mensal). ----
      if (DFC_MENSAL && DFC_MENSAL.length) {
        const mesF = meses[iF];
        const somaMes = (rows, pred, sinal = 1) => rows.reduce((s, r) =>
          s + (r.mes === mesF && pred(r) ? ((r.credito || 0) - (r.debito || 0)) * sinal : 0), 0);
        const predG = (gi) => { const tipos = DRE_GRUPOS[gi][2]; return (r) => r.natureza === 'DESPESAS' && r.tipo !== 'INVESTIMENTOS' && tipos.includes(r.tipo); };
        const tiposMap = DRE_GRUPOS.flatMap(g => g[2]).concat(['DESPESAS FINANCEIRAS']);
        const linhasPonte = [
          ['Recebimentos das vendas', r => r.natureza === 'RECEITAS', 1, 'rec'],
          ['Impostos sobre venda (ICMS etc.)', r => r.natureza === 'DEDUÇOES DA RECEITA', -1, 'desp'],
          ['Mercadoria + uso e consumo', predG(0), -1, 'desp'],
          ['Pessoal (inclui pró-labore)', predG(1), -1, 'desp'],
          ['Despesas de venda', predG(2), -1, 'desp'],
          ['Administrativas', predG(3), -1, 'desp'],
          ['Financeiras (juros e tarifas)', r => r.natureza === 'DESPESAS' && r.tipo === 'DESPESAS FINANCEIRAS', -1, 'desp'],
          ['Outras despesas', r => r.natureza === 'DESPESAS' && r.tipo !== 'INVESTIMENTOS' && !tiposMap.includes(r.tipo), -1, 'desp'],
        ];
        let compTot = 0, caixaTot = 0;
        const tr = linhasPonte.map(([rotulo, pred, sinal, natu]) => {
          const comp = somaMes(DRE_FIN, pred, sinal);
          const caixa = somaMes(DFC_MENSAL, pred, sinal);
          if (Math.abs(comp) < 0.005 && Math.abs(caixa) < 0.005) return '';
          const efeito = natu === 'rec' ? 1 : -1;   // sinal com que entra no resultado
          compTot += comp * efeito; caixaTot += caixa * efeito;
          const dif = caixa - comp;
          const alinhado = Math.abs(dif) < Math.max(500, Math.abs(comp) * 0.02);
          const leitura = alinhado ? 'alinhado'
            : natu === 'rec'
              ? (dif > 0 ? 'caiu na conta MAIS do que o mês gerou (repasses de semanas anteriores)' : 'parte da venda ainda não caiu na conta')
              : (dif > 0 ? 'pagou também contas de meses anteriores' : 'parte ficou para pagar depois — vai pesar num próximo mês');
          return `<tr><td>${rotulo}</td><td>${fmt(comp)}</td><td>${fmt(caixa)}</td>
            <td class="${dif < -0.005 && natu === 'rec' || dif > 0.005 && natu === 'desp' ? 'negativo' : ''}">${dif >= 0 ? '+' : '−'} ${fmt(Math.abs(dif))}</td>
            <td style="text-align:left; white-space:normal; color:${alinhado ? 'var(--tx-4)' : 'var(--tx-2)'};">${leitura}</td></tr>`;
        }).join('');
        const difTot = caixaTot - compTot;
        ponteHtml = `
        <div class="section-label" style="margin-top:26px;">O lucro virou caixa? — ponte de ${rotuloMes(mesF)}</div>
        <div class="caption-label" style="text-align:center;">
          "No papel" = contas do mês (competência, como na DRE acima). "No caixa" = o que de fato entrou e saiu no mês.
          A diferença é capital de giro: o que o mês quitou de trás ou empurrou para frente.
        </div>
        <div id="tabelaPonte">
          <table>
            <tr><th>Linha</th><th>No papel (R$)</th><th>No caixa (R$)</th><th>Diferença</th><th>O que significa</th></tr>
            ${tr}
            <tr class="liq"><td>Resultado do mês</td><td>${fmt(compTot)}</td><td>${fmt(caixaTot)}</td>
              <td>${difTot >= 0 ? '+' : '−'} ${fmt(Math.abs(difTot))}</td>
              <td style="text-align:left; white-space:normal;">${
                Math.abs(difTot) < Math.max(2000, Math.abs(compTot) * 0.05) ? 'papel e caixa andaram juntos — mês saudável'
                : difTot > 0 ? 'o caixa rendeu mais que o papel: entrou dinheiro de meses anteriores ou ficou conta para depois'
                : 'o caixa rendeu menos que o papel: o mês pagou contas antigas ou tem venda ainda por cair'}</td></tr>
          </table>
        </div>
        <div class="caption-label" style="text-align:center;">
          "Pra onde foi o dinheiro" — do resultado do mês até o que sobrou nos bancos e cofres —
          é a mesma conta, na mesma view, da seção <b>4. E no caixa?</b> do
          <a href="javascript:void(0)" onclick="mostrarModulo('fechamento')" style="color:var(--info);">Fechamento do mês</a>.
          Um cálculo, um dono: mora lá.
        </div>`;
      }
      const iA = iF - 1;
      const custo = gruposVals[0][3], pessoal = gruposVals[1][3], venda = gruposVals[2][3], admin = gruposVals[3][3];
      // custos fixos = o que sustenta a casa fora mercadoria e gente (venda+adm+outras);
      // estrutura do PE = custos fixos + pessoal (tudo que nao varia com o prato vendido)
      const cfArr = meses.map((_, i) => venda[i] + admin[i] + outrasDesp[i]);
      const estrutura = pessoal[iF] + cfArr[iF];
      const sobre = (arr, i) => baseAV[i] > 0.005 ? arr[i] / baseAV[i] * 100 : null;
      const mcArr = lucroBruto, mcPct = sobre(lucroBruto, iF);
      const primeArr = meses.map((_, i) => custo[i] + pessoal[i]);
      const primePct = sobre(primeArr, iF);
      const cmvPct = sobre(custo, iF), folhaPct = sobre(pessoal, iF), cfPct = sobre(cfArr, iF);
      const ebitdaPct = sobre(ebitda, iF);
      const resPct = sobre(resultado, iF);
      const pe = mcPct > 0.5 ? estrutura / (mcPct / 100) : null;
      const folga = pe ? (baseAV[iF] / pe - 1) * 100 : null;
      // status em palavra: mesma regra do farol da tabela (ate 10% da meta = perto)
      const statusDe = (valPct, meta) => {
        if (!meta || valPct === null) return '';
        const dist = meta.sentido === 'abaixo' ? valPct - meta.meta : meta.meta - valPct;
        const [cor, palavra] = dist <= 0 ? ['var(--farol-ok)', 'NA META'] : dist <= meta.meta * 0.10 ? ['var(--farol-perto)', 'PERTO DA META'] : ['var(--farol-fora)', 'FORA DA META'];
        return `<div class="card-pct"><b style="color:${cor};">${palavra}</b> · meta ${meta.sentido === 'abaixo' ? '≤' : '≥'} ${pct(meta.meta)}%</div>`;
      };
      // 01/10/2026: a meta do MES do Fechamento (iF), a mesma regra das colunas da tabela
      const mPrime = metaMes('CUSTO', iF) && metaMes('PESSOAL', iF)
        ? { sentido: 'abaixo', meta: metaMes('CUSTO', iF).meta + metaMes('PESSOAL', iF).meta } : null;
      const mCf = DRE_METAS && DRE_METAS.VENDA && DRE_METAS.ADMIN
        ? { sentido: 'abaixo', meta: DRE_METAS.VENDA.meta + DRE_METAS.ADMIN.meta } : null;
      // variacao vs mes anterior: palavra do fato, sem juizo (o status ja julga)
      const varRS = (arr) => iA < 0 || Math.abs(arr[iA]) < 0.005 ? '' :
        `<div class="card-pct">vs ${rotuloMes(meses[iA])}: ${arr[iF] > arr[iA] * 1.005 ? 'subiu' : arr[iF] < arr[iA] * 0.995 ? 'caiu' : 'estável'} ${pct(Math.abs((arr[iF] - arr[iA]) / Math.abs(arr[iA]) * 100))}%</div>`;
      const varPP = (vAtu, vAnt) => iA < 0 || vAnt === null ? '' :
        `<div class="card-pct">vs ${rotuloMes(meses[iA])}: ${vAtu > vAnt + 0.05 ? 'subiu' : vAtu < vAnt - 0.05 ? 'caiu' : 'estável'} ${pct(Math.abs(vAtu - vAnt))} ponto${Math.abs(vAtu - vAnt) >= 1.95 ? 's' : ''}</div>`;
      const antDe = (arr) => iA >= 0 ? sobre(arr, iA) : null;
      // sequencia dos indicadores = fechamento do Matheus (pedido do dono, 16/08);
      // valores e definicoes 100% nossos, % sempre sobre a receita liquida
      // Corte de 16/08 a noite (decisao do dono): com o % colorido pela meta em
      // CADA linha da tabela, os cards por grupo viraram eco. Ficam so os tres
      // que a tabela NAO tem: Prime Cost, ponto de equilibrio e a manchete.
      fechHtml = `
      <div class="section-label">Fechamento de ${rotuloMes(meses[iF])}${DRE_MES_FIXO === meses[iF] ? ' — mês fixado no clique' : ' — último mês fechado do período escolhido'}</div>
      <div class="cards cards-3">
        <div class="card ${resultado[iF] >= 0 ? 'pos' : 'neg'}"><div class="card-lbl">Resultado líquido do mês</div><div class="card-val">R$ ${fmt(resultado[iF])}</div>
          ${statusDe(resPct, metaMes('RESULTADO', iF))}${varRS(resultado)}</div>
        <div class="card"><div class="card-lbl">Prime Cost (CMV + pessoal)</div><div class="card-val">${pct(primePct)}%</div>
          ${statusDe(primePct, mPrime)}${varPP(primePct, antDe(primeArr))}</div>
        ${pe ? `<div class="card"><div class="card-lbl">Ponto de equilíbrio</div><div class="card-val">R$ ${fmt(pe)}</div>
          <div class="card-pct" style="color:${folga >= 0 ? 'var(--farol-ok)' : 'var(--farol-fora)'};">vendeu ${pct(Math.abs(folga))}% ${folga >= 0 ? 'acima' : 'ABAIXO'} do ponto</div></div>` : ''}
      </div>
      <div class="caption-label" style="text-align:center;">
        Os demais indicadores estão na própria tabela: o % ao lado de cada número é a fatia de tudo que entrou
        (venda cheia + outras receitas da operação: atacado, listas das filiais, Boqueirão),
        colorido pela meta (verde dentro, âmbar perto, vermelho fora). Prime Cost = CMV + pessoal, os dois maiores
        custos da casa. Ponto de equilíbrio = (pessoal + comerciais + administrativas + outras) ÷ margem de
        contribuição % — quanto precisava faturar para empatar. Metas editáveis na tabela <b>fin_metas_dre</b>;
        quando a meta muda mês a mês, vale a do mês (<b>fin_metas_dre_mes</b>), a mesma do Placar e do Fechamento do mês.
      </div>`;
    }
  }

  alvo.innerHTML = seletorLojaFin() + `
  ${fechHtml}
  ${blocoBeneficioIfood(BENEF_FAROL || { f: null, semanas: [] })}
  <div class="section-label">DRE Gerencial — ${nomeLojaFin()}</div>
  <div class="caption-label" style="text-align:center;">
    Resultado mês a mês da empresa inteira, direto do Saipos desde jan/2026 — <b>não segue os filtros do topo</b>.
    Receitas = venda cheia por canal (caixa das lojas + promoção paga pela loja); despesas por <b>competência</b> (data de emissão da NF).
    Em cada célula: valor, <b>%</b> sobre tudo que entrou (venda cheia + outras receitas: atacado, listas das filiais, Boqueirão)
    e <b>▲▼</b> (variação vs mês anterior). Na Água Verde a mercadoria inclui o que foi comprado para produzir as listas e o atacado;
    nas filiais, a lista paga à Água Verde está dentro da mercadoria (linha Mercadorias AV).
    Na visão Rede a lista entre as lojas não entra na receita nem na mercadoria: é a rede vendendo para ela mesma.
    Marcação colorida só aparece quando a linha está <b>fora da meta</b> (âmbar = perto, vermelho = longe) —
    sem marcação, está tudo dentro. Clique nas linhas com ▶ para abrir o detalhe.
  </div>
  <div class="periodo-presets" style="margin-top:14px; display:flex; align-items:center; flex-wrap:wrap; gap:8px;">
    <button class="preset-btn ${drePeriodo === 'ano' ? 'active' : ''}" onclick="drePeriodoSet('ano')">Ano completo</button>
    <button class="preset-btn ${drePeriodo === '6m' ? 'active' : ''}" onclick="drePeriodoSet('6m')">Últimos 6 meses</button>
    <button class="preset-btn ${drePeriodo === '3m' ? 'active' : ''}" onclick="drePeriodoSet('3m')">Últimos 3 meses</button>
    <span style="color:var(--tx-4); font-size:12px;">ou escolha:</span>
    <select id="dreSelDe" class="preset-sel" onchange="dreRangeSet()">
      ${meses.map(m => `<option value="${m}" ${m === cols[0] ? 'selected' : ''}>${rotuloMes(m)}</option>`).join('')}
    </select>
    <span style="color:var(--tx-4); font-size:12px;">até</span>
    <select id="dreSelAte" class="preset-sel" onchange="dreRangeSet()">
      ${meses.map(m => `<option value="${m}" ${m === cols[cols.length - 1] ? 'selected' : ''}>${rotuloMes(m)}</option>`).join('')}
    </select>
  </div>
  ${cols[cols.length - 1] && cols[cols.length - 1].slice(0, 7) === mesAtual ? `<div class="contexto" style="margin-top:12px;">
    <b>${rotuloMes(cols[cols.length - 1])} está em curso:</b> as despesas do mês entram quase todas de uma vez
    (competência já lançada), mas as vendas ainda estão acontecendo — <b>o mês fecha melhor do que aparece aqui</b>.
    Por isso a coluna <b>Total</b> soma só os meses fechados, como o Placar.
    Compromissos já lançados para os próximos meses não entram nesta tabela: estão no <b>Fluxo projetado</b>.</div>` : ''}
  <details class="detalhes-extra" style="margin-top:12px;">
    <summary>📖 O que significa cada linha (guia rápido)</summary>
    <div style="font-size:12.5px; color:var(--tx-2); line-height:1.8; margin-top:10px;">
      <b>Receita bruta de vendas</b> — tudo que os clientes pagaram nos canais (iFood, salão, balcão, site), antes das taxas. No iFood é a venda cheia: o valor do PDV mais a promoção paga pela loja, que o PDV já registra descontada (com a entrega somada).<br>
      <b>(+) Outras receitas da operação</b> — o que a loja vende fora do balcão: atacado, vendas para empresas, listas para as filiais e royalties do Boqueirão.<br>
      <b>(−) Deduções da receita</b> — o que os canais e o fisco levam antes de o dinheiro ser nosso: promoções do iFood, anúncios, taxas do iFood, tarifas de cartão, comissões de vendedores e ICMS. Abra a linha para ver cada cobrança pelo nome. A primeira é a promoção paga pela loja no iFood: a venda entra cheia lá em cima e a promoção sai aqui.<br>
      <b>(=) Receita líquida</b> — o que sobrou de verdade para pagar a operação.<br>
      <b>(−) CMV</b> — mercadoria: insumos, embalagens (inclusive as de envio, desde 03/09/2026), descartáveis, gás e uso e consumo.<br>
      <b>(=) Margem de contribuição</b> — receita líquida menos mercadoria; é o que cada venda deixa para pagar a casa. (Chamava-se lucro bruto até 03/09/2026.)<br>
      <b>(−) Pessoal</b> — salários, encargos e benefícios da equipe, mais a diretoria (pró-labore).<br>
      <b>(−) Administrativas e imóvel</b> — o que mantém a casa aberta: aluguel, energia, gás, manutenção, sistemas, honorários.<br>
      <b>(−) Comerciais</b> — o que gastamos para entregar e vender: motoboys, marketing, fretes.<br>
      <b>(=) Resultado operacional</b> — o que a operação gera sozinha, antes de banco e imposto sobre o lucro.<br>
      <b>(+) Rendimento aplicações</b> — o que a XP e as contas correntes renderam; entrada não operacional.<br>
      <b>(−) Juros e tarifas</b> — juros, tarifas de banco e a antecipação da Rede.<br>
      <b>(−) Imposto de renda (IRPJ)</b> — imposto sobre o LUCRO (o imposto sobre a venda ficou lá em cima, nas deduções).<br>
      <b>(=) Resultado líquido</b> — o que sobrou no fim do mês: lucro ou prejuízo.<br>
      <b>(=) Resultado sem a isenção do iFood</b> — o mesmo mês se o iFood tivesse cobrado os 9,5%. De 05/10/2026 em diante a conta é 9,5% da venda (itens + entrega − desconto que a loja banca); até 04/10 foi sobre o valor depositado e fica como está.<br>
      <b>Abaixo do resultado</b> — o que não é resultado da operação da loja, mas mexe no dinheiro dela: o lucro que as filiais repassam (total enviado menos a lista do mês, com o bônus do iFood dentro), investimentos, retiradas e aportes. A ordem e os nomes seguem o fechamento da MA Consultoria (03/09/2026); os cálculos são nossos.
    </div>
  </details>
  <div id="tabelaDRE">
    <table>
      <tr><th></th>${cols.map(m => {
        if (m.slice(0, 7) === mesAtual) return `<th>${rotuloMes(m)}<div class="th-emcurso">em curso</div></th>`;
        return `<th style="cursor:pointer;" onclick="dreFixarMes('${m}')" title="clique para o Fechamento e a ponte lá embaixo mostrarem este mês">${rotuloMes(m)}${meses[iF] === m ? '<div class="th-emcurso">no fechamento</div>' : ''}</th>`;
      }).join('')}<th>Total${cols.some(m => m.slice(0, 7) === mesAtual) ? '<div class="th-emcurso">só meses fechados</div>' : ''}</th></tr>
      ${corpo}
    </table>
  </div>
  ${ponteHtml}
  <div class="caption-label" title="Investimentos, retiradas e aportes ficam fora do resultado (são o destino do lucro). Meses futuros já lançados ficam no Fluxo projetado. A bolinha âmbar aparece a até 10% da meta e a vermelha além disso; as metas são editáveis em fin_metas_dre.">
  Lançamentos e vendas do Saipos desde jan/2026. Desde 12/09/2026 as <b>taxas de canais</b> saem cobrança a cobrança da conciliação, não mais pela diferença entre vendido e recebido.
  O <b>mês corrente parece pior do que vai fechar</b>: as despesas já estão quase todas lançadas e as vendas ainda estão acontecendo.</div>`;
  encaixarColunaFixa('tabelaDRE');
}

// ------------------------------------------------------------------
// Modulo Fluxo Projetado — para onde o caixa vai nos proximos 45 dias.
// Saidas = contas a pagar LANCADAS no Saipos (fonte SAIPOS_PREV, ja com
// vencimento) — desde 10/09/2026 isso INCLUI as compras de cartao a vencer,
// cada uma na data da fatura e por categoria; a "fatura estimada" pelo saldo
// dos cartoes saiu (somava 6 meses de recorrentes: R$ 58 mil contra R$ 11,5
// mil reais). Entradas = contas a receber lancadas + receita
// projetada pela media por dia da semana das ultimas 4 semanas de
// recebimentos REAIS. O que nao foi lancado no Saipos nao aparece aqui.
// ------------------------------------------------------------------
let PROJ_PAGAR = null;    // vw_fin_contas_pagar

// COBRANCA ENTRE LOJAS DA REDE (dono, 07/10/2026: "pode tirar do a receber na projecao da Rede").
// A cobranca de lista e de beneficio que a Agua Verde tem contra o Ahu e o Sao Braz entra em
// vw_fin_contas_pagar como A RECEBER (origem LISTAS) e a saida da filial NAO existe do outro
// lado. Para uma loja sozinha e' dinheiro de verdade; na conta da REDE e' dinheiro que so troca
// de bolso (07/10: R$ 47.878,79 a mais na projecao). O Boqueirao NAO e' da Rede: a cobranca
// dele (RECEITAS BOQUEIRAO) continua contando. Um predicado so, usado pela projecao de 45 dias,
// pelo total de "Pagar as contas de hoje" e pelo cartao Rede de "A semana".
// 21/10/2026 (proposta provisao-listas-filiais; dono 19/10: "sai da filial e entra na AV na mesma data dentro do
// projetado"): a PROVISAO da lista do Ahu e do Sao Braz tem as DUAS pontas — a entrada na Agua Verde (RECEITAS AHU /
// RECEITAS SAO BRAZ) e a saida da filial (FILIAL AGUA VERDE). Na Rede as duas ficam fora (somam zero); por loja, cada
// uma conta onde esta. A cobranca real (LISTAS) ainda so tem a ponta da Agua Verde.
const projEntreLojas = (r) => (r.origem === 'LISTAS' && r.subtipo !== 'RECEITAS BOQUEIRAO' && Number(r.credito) > 0)
  // 23/10/2026 (Financeiro): o lado da FILIAL da cobranca de lista e de bonus (debito, sai da filial no mesmo dia em que entra na AV)
  || (r.origem === 'LISTAS' && ['FILIAL AGUA VERDE', 'BONUS COMISSAO IFOOD'].includes(r.subtipo) && Number(r.debito) > 0)
  || (r.origem === 'PROVISAO' && ((['RECEITAS AHU', 'RECEITAS SAO BRAZ'].includes(r.subtipo) && Number(r.credito) > 0)
                                  || (r.subtipo === 'FILIAL AGUA VERDE' && Number(r.debito) > 0)));

let PROJ_BENEF = null;    // benefício iFood semanal (quadro da Hellen)

let PROJ_PECAS = null;   // fin_provisao_regra (peca, ativo): o que deixou de ser média (Financeiro, 23/10/2026)

function projPeca(p) { return !!(PROJ_PECAS || []).find(x => x.peca === p && x.ativo); }

// a frase do que entra estimado, montada pelas chaves ligadas; null = tudo pela média, como antes
function projEntraFrase() {
  const ifood = projPeca('IFOOD'), cartao = projPeca('CARTAO_REDE'), atac = projPeca('ATACADO_EPADOCA');
  if (!ifood && !cartao && !atac) return null;
  const pelo = [ifood && 'iFood', cartao && 'cartão'].filter(Boolean);
  const partes = [];
  if (pelo.length) partes.push(`${pelo.join(' e ')} pelo que já foi vendido`);
  if (atac) partes.push('atacado pelo pedido do portal ainda sem boleto (D+2)');
  partes.push(`${cartao ? '' : 'cartão, '}dinheiro, PIX, site e o resto pela média do dia da semana (4 semanas)`);
  return partes.join('; ');
}

function projAplicarPecas() {
  if (typeof CR_ROTULO === 'undefined') return;
  CR_ROTULO['RECEITAS ONLINE'][1] = projPeca('IFOOD') ? 'iFood pelo que já foi vendido; site pela média' : 'média das 4 semanas';
  CR_ROTULO['RECEITAS CARTAO'][1] = projPeca('CARTAO_REDE') ? 'pelo que já foi vendido' : 'média das 4 semanas';
  CR_ROTULO['RECEITAS REVENDA'][1] = projPeca('ATACADO_EPADOCA') ? 'boleto lançado; sem boleto, o pedido do portal em D+2' : 'boletos do ePadoca ou a média, o maior';
}

let PROJ_RECEITA_PREV = null; // vw_fin_receita_prevista: { unidade ('' = Rede): { dia: {media, sem_atacado} } } — a receita pela media no BANCO (16/10/2026)

// FERIADO NA MEDIA (dono, 16/10/2026: "eles distorcem ela pra cima"): o feriado e o 1o dia util depois dele (que recebe o
// dinheiro do feriado) ficam fora da media por dia da semana — a mesma regra de fin_receita_prevista no banco.
function projDistorcido(dIso) {
  const fer = PROJ_FERIADOS || {};
  if (fer[dIso]) return true;
  const dow = new Date(dIso + 'T12:00:00').getDay();
  if (dow === 0 || dow === 6) return false;
  // e' o 1o dia util depois de um feriado? (o dia util anterior, pulando fim de semana, foi feriado)
  let y = fxSomaDias(dIso, -1);
  while ([0, 6].includes(new Date(y + 'T12:00:00').getDay())) y = fxSomaDias(y, -1);
  return !!fer[y];
}

let PROJ_BONUS_PREV = null;   // vw_fin_bonus_previsto: o bonus por quinta (era quarta ate 19/10), calculado no BANCO (16/10/2026) — o Fluxo le daqui

let PROJ_RITMO_BONUS = null;   // vw_beneficio_ifood_farol: { ritmo, restante } — para estimar a semana que ainda nao fechou

let PROJ_RECEB = null;    // vw_fin_receitas_diarias (ultimas semanas)

let PROJ_ANCORA = null;   // vw_fin_saldo_banco_atual: saldo REAL do banco (OFX diario)

let PROJ_VENC = null;     // vw_fin_vencidas_status: vencida ja saiu do banco ou nao

let PROJ_RECEB_SUB = null; // vw_fin_receitas_diarias_subtipo: a mesma media, aberta por tipo

let PROJ_CAIXA = null;    // vw_fin_caixa_do_dia: saldo x o que vence, conta a conta

let PROJ_COM_ATACADO = null; // vw_comissao_atacado_semanal: 7,5% Jane + 7,5% Fabio sobre a revenda

let PROJ_COM_PAG = null;     // vw_comissao_atacado_pagamento: pago no Saipos e no banco, por semana e pessoa (16/10/2026)

let PROJ_ATACADO_RECEBER = null; // vw_atacado_receber: boletos do atacado em aberto no portal do ePadoca (04/09/2026)

let PROJ_FILTRO = { conta: '' };  // filtros do quadro de pagamento

// Saldo dia a dia (10/10/2026): o que o bloco precisa alem do que a tela ja baixava
let PROJ_RECEB_LOJA = null;   // vw_fin_receitas_diarias_conta -> { loja: { 'AAAA-MM-DD': recebido } }; null = sem seletor de loja

let PROJ_FERIADOS = {};       // feriados -> { 'AAAA-MM-DD': nome }

let PROJ_DIA = { aberto: {} };   // estado do bloco: os dias abertos

// O que costuma sair + limite do banco + atacado sem contar em dobro + saldo de partida do meio do dia (10/10/2026).
// As leituras sao OPCIONAIS: sem elas (objeto ainda nao instalado no banco, erro, login que nao le) a tela fica como
// era — sem a coluna, sem a linha pontilhada, sem a faixa, sem os avisos novos e com a media de entrada inteira.
let PROJ_COSTUMA = null;        // vw_fin_saida_costuma_sair -> { loja: { 'AAAA-MM-DD': { cheia, ritmo, MERCADORIA, MOTOBOYS, DIARISTAS, RESTO } } }

let PROJ_COSTUMA_INFO = null;   // por loja: { porSemana: { peca: R$ }, janela: [de, ate], pagaAV: R$ por semana que a filial paga a Agua Verde }

let PROJ_LIMITE = null;         // { cfg: fin_limite_conta, dias: vw_fin_limite_dia, meses: vw_fin_limite_mes (meses do banco ja fechados) }

let PROJ_ATACADO = null;        // vw_fin_receitas_diarias_conta.recebido_atacado -> { porLoja: { loja: { dia: R$ } }, rede: { dia: R$ } }; null = sem a coluna

let PROJ_FORA_EXTRATO = null;   // vw_fin_pago_fora_do_extrato -> uma linha por conta de caixa com extrato (o que o Saipos ja pagou e o extrato ainda nao mostra); null = sem a view

// O BOQUEIRAO FORA DA MEDIA (dono, 18/10/2026: "a provisão do Boqueirão tem que ser mensal mesmo, todo dia 20, não tem
// que fazer pela média, projeta o valor de acordo com a media mensal, e quando fechar a lista, substitue essa provisão
// pelo valor real, ou se ele passar da média, já pode virar projeção"). A regra mora no banco (fin_receita_fora_da_media):
// a media do banco (fin_receita_prevista) ja vem sem ele e a provisao do mes entra pelos titulos (vw_fin_contas_pagar:
// origem PROVISAO = estimativa; LISTAS = a cobranca real, menos o que ja foi pago), calculada em vw_fin_receita_mensal_prevista.
// Aqui a tela so tira a MESMA parte das contas que ainda faz sozinha (media por dia da semana, abertura por tipo, Contas a
// receber) e mostra a frase. null = sem os objetos no banco: a tela fica como era.
let PROJ_FORA_MEDIA = null;   // { subtipos: Set, rede: { dia: R$ }, porLoja: { loja: { dia: R$ } }, prov: [vw_fin_receita_mensal_prevista] }

const projForaDaMedia = (sub) => !!(PROJ_FORA_MEDIA && PROJ_FORA_MEDIA.subtipos.has(sub));

// A frase — UMA, para o Fluxo projetado e o Contas a receber. loja '' = Rede (todas); loja = so a que recebe.
function projProvisaoFrase(loja) {
  if (!PROJ_FORA_MEDIA || !PROJ_FORA_MEDIA.prov.length) return '';
  const dm = (s) => String(s || '').slice(8, 10) + '/' + String(s || '').slice(5, 7);
  const MES = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];
  const mes = (s) => MES[Number(String(s || '').slice(5, 7)) - 1] || '';
  const grupos = {};
  PROJ_FORA_MEDIA.prov.filter(p => !loja || p.unidade === loja)
    .forEach(p => { (grupos[p.nome_tela] = grupos[p.nome_tela] || []).push(p); });
  return Object.entries(grupos).map(([nome, ps]) => {
    const partes = ps.slice().sort((a, b) => (a.mes_referencia < b.mes_referencia ? -1 : 1)).map(p => {
      const falta = Number(p.falta) || 0, m = `lista de ${mes(p.mes_referencia)}`;
      const quando = dm(p.dia) + (p.feriado_movido ? ` (${dm(p.vencimento)} é feriado)` : '');
      if (falta <= 0.005) return Number(p.ja_pago) > 0.005 ? `${m}: já paga${p.ultimo_pagamento ? ' em ' + dm(p.ultimo_pagamento) : ''} (R$ ${fmt(Number(p.valor_mes))}) — fora da conta` : '';
      if (p.origem_valor === 'COBRANCA') return `${m}: a cobrança (${p.cobranca_status === 'EM VALIDACAO' ? 'em validação' : 'em aberto'}), R$ ${fmt(falta)} em ${quando}`;
      if (p.origem_valor === 'ACUMULADO') return `${m}: R$ ${fmt(falta)} em ${quando} — o que as listas do mês já somam, acima da média (R$ ${fmt(Number(p.media_mensal))})`;
      return `${m}: R$ ${fmt(falta)} em ${quando}, pela média do que ele pagou pelas listas de ${mes(p.media_de)} a ${mes(p.media_ate)}` +
        (p.acumulado != null ? ` (as listas do mês somam R$ ${fmt(Number(p.acumulado))} até agora; se passarem da média, vale o que somarem)` : '');
    }).filter(Boolean);
    return `<b>${trEscH(nome)} não entra pela média:</b> uma provisão por mês, que vira o valor da cobrança quando a lista do mês fecha (decisão de 18/10). ${partes.join(' · ').replace(/^./, c => c.toUpperCase())}.`;
  }).join(' ');
}

// contas que nao sao caixa operacional (investimentos, pessoais e cartoes)
const PROJ_FORA_CAIXA = ['XP INVESTIMENTOS', 'PARTICIPACOES', 'FABIO PESSOAL'];

// ------------------------------------------------------------------
// CAIXA DE HOJE — o topo do Fluxo projetado (dono, 21/10/2026: "me mostre de forma fácil quanto tem de saldo, o que tem
// pra pagar, o que tem pra receber e quanto vai sobrar, simples assim"; "essa tabela pode ir pra tela de fluxo projetado").
// O saldo vale "após conciliação": por isso, ANTES da tabela, o que falta conciliar (vw_fin_conciliacao_a_fazer).
// NÃO FAZ CONTA: lê o motor (projCalc) por loja e na Rede. Sobra = saldo − a pagar + a receber, a mesma linha do Saldo
// dia a dia. A pagar inclui o bônus do iFood que vai para a aplicação (sai do caixa na quinta).
// ------------------------------------------------------------------
let CXH_CONC = null;   // vw_fin_conciliacao_a_fazer (null = sem a leitura: o bloco sai sem o aviso)

function cxhAbrir(u) {
  finPedirLoja(u || 'REDE');
  const w = document.getElementById('projDiaWrap');
  if (w) w.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function blocoCaixaHoje() {
  if (!PROJ_PAGAR) return '';
  const mil = (v) => (Math.abs(v) < 0.5 ? '0' : (v < 0 ? '−' : '') + fmt(Math.abs(v)).replace(/,\d\d$/, ''));
  const dm = (s) => String(s || '').slice(8, 10) + '/' + String(s || '').slice(5, 7);
  // ordem do dono (22/10): Água Verde, São Braz, Ahú e, por último, a Rede (em destaque)
  const linhas = (PROJ_RECEB_LOJA ? finLinhas() : [['REDE', lojaNome('REDE')]]).map(([u, nome]) => {
    const loja = u === 'REDE' ? '' : u;
    const P = projCalc(loja);
    const h = projJanela(P, 0, 0), s = projJanela(P, 0, 7);
    const cofre = (P.partida || []).filter((p) => /COFRE/i.test(p.conta)).reduce((a, p) => a + p.saldo, 0);
    return { loja, nome, bancos: P.caixaOper - cofre, cofre, total: P.caixaOper,
             pagarH: h.sai, bonusH: h.bonus, receberH: h.entra, sobraH: P.serieSaldo[0],
             pagar7: s.sai, bonus7: s.bonus, receber7: s.entra, sobra7: P.serieSaldo[Math.min(7, P.serieSaldo.length - 1)], ate: s.ate };
  });
  const daRede = new Set(FX_TODAS);
  const falta = (CXH_CONC || []).filter(c => c.em_dia === false && daRede.has(c.unidade));
  const faltaLoja = new Set(falta.map(c => c.unidade));
  const nomeConta = (c) => ((DFC_CONTAS_RAW || []).find(x => x.conta === c) || {}).apelido || c;
  const extratoVelho = (PROJ_ANCORA || []).filter(a => Number(a.idade_dias) > 1 && !PROJ_FORA_CAIXA.includes(a.conta));
  const avisos = [
    ...falta.map(c => `${trEscH(c.conta_exibida || c.conta)} conciliado até ${dm(c.ultimo_ok)}`),
    ...extratoVelho.map(a => `${trEscH(nomeConta(a.conta))} com extrato de ${dm(a.data_saldo)}`),
  ];
  const aviso = avisos.length ? `<div class="contexto" style="text-align:left; border-color:var(--farol-perto);">
      <b style="color:var(--farol-perto);">O saldo pode não ser o de hoje:</b> ${avisos.join(' · ')}.
      <a href="javascript:void(0)" onclick="mostrarModulo('concbanco')" style="color:var(--brand);">Abrir a conciliação ›</a></div>` : '';
  const forte = (v) => v < -0.5 ? ' style="color:var(--farol-fora); font-weight:700;"' : ' style="font-weight:700;"';
  const nomeTd = (l) => `<td><a href="javascript:void(0)" onclick="cxhAbrir('${l.loja}')" style="color:var(--tx-1);" title="ver o dia a dia desta loja"><b>${l.nome}</b></a>${faltaLoja.has(l.loja) ? ' <span style="color:var(--farol-perto); font-size:11px;" title="falta conciliar">⚠</span>' : ''}</td>`;
  const lk = (v, tela, loja, foco, dica) => `<a href="javascript:void(0)" onclick="cxhIr('${tela}','${loja}','${foco}')" style="color:inherit; text-decoration:underline dotted;" title="${dica}">${mil(v)}</a>`;
  const linhaCls = (l) => l.loja ? '' : ' class="liq"';
  // TABELA ÚNICA (dono, 22/10/2026: "volta a tabela anterior e tira os quadros que se repetiam"; depois: "pode somar o
  // saldo ... no hoje fica Saldo - A pagar - A receber - Sobra, muda a cor do cabeçalho e repete a conta pra 7 dias, o bonus
  // guardado ... colocar só no final, tipo saldo final com bonus e sem bonus"). A sobra de hoje e de 7 dias é a da
  // OPERAÇÃO (sem o bônus); no fim, o saldo em 7 dias com o bônus ainda na conta e depois de guardá-lo.
  const corHoje = corTokenA('--info', 0.22), cor7 = corTokenA('--amber-2', 0.22);
  const thH = (txt, extra) => `<th style="background:${corHoje};${extra || ''}">${txt}</th>`;
  const th7 = (txt, extra) => `<th style="background:${cor7};${extra || ''}">${txt}</th>`;
  return `
    <div class="section-label">Caixa de hoje — ${dm(trHoje())}</div>
    ${finSoRede()}${aviso}
    <div id="tabelaCaixaHoje" style="overflow-x:auto;"><table>
      <thead><tr><th rowspan="2">Loja</th><th rowspan="2">Saldo</th>
        ${thH('Hoje', ' text-align:center;" colspan="3')}
        ${th7(`Até ${linhas[0] ? dm(linhas[0].ate) : ''} (7 dias)`, ' text-align:center;" colspan="3')}
        <th colspan="2" style="text-align:center;">No fim dos 7 dias</th></tr>
        <tr>${thH('A pagar')}${thH('A receber')}${thH('Sobra')}${th7('A pagar')}${th7('A receber')}${th7('Sobra')}
          <th>Bônus para XP</th><th>Saldo final</th></tr></thead>
      <tbody>${linhas.map((l) => {
        const saldo = l.bancos + l.cofre;
        const sobraH = saldo - l.pagarH + l.receberH;
        const sobra7 = saldo - l.pagar7 + l.receber7;
        return `<tr${linhaCls(l)}>${nomeTd(l)}
        <td title="bancos R$ ${fmt(l.bancos)} + cofre R$ ${fmt(l.cofre)}">${mil(saldo)}</td>
        <td>${lk(l.pagarH, 'contaspagar', l.loja, 'hoje', 'ver as contas a pagar')}</td>
        <td>${lk(l.receberH, 'contasreceber', l.loja, 'hoje', 'ver o que vai entrar')}</td>
        <td${forte(sobraH)}>${mil(sobraH)}</td>
        <td>${lk(l.pagar7, 'contaspagar', l.loja, 'semana', 'ver as contas a pagar')}</td>
        <td>${lk(l.receber7, 'contasreceber', l.loja, 'semana', 'ver o que vai entrar')}</td>
        <td${forte(sobra7)}>${mil(sobra7)}</td>
        <td title="o bônus do iFood que vai para a XP toda quarta: dinheiro guardado, não é conta da operação">${mil(l.bonus7)}</td>
        <td${forte(l.sobra7)}>${mil(l.sobra7)}</td></tr>`; }).join('')}</tbody></table></div>
    <div class="caption-label" style="text-align:left;">Em R$. Saldo = bancos + cofre. Sobra = saldo − a pagar + a receber. Saldo final = sobra dos 7 dias − o bônus do iFood que vai para a XP (sai da conta toda quarta). Clique num valor para ver o detalhe.</div>`;
}

// clique num valor: abre Contas a pagar / a receber já na loja e no bloco certo (dono, 22/10/2026)
let CXH_IR = null;

function cxhIr(tela, loja, foco) { CXH_IR = { tela, foco }; finPedirLoja(loja || 'REDE'); mostrarModulo(tela); }

function cxhAplicarIr(tela, tentativa) {
  if (!CXH_IR || CXH_IR.tela !== tela) return;
  // o Contas a pagar pode ainda estar carregando (outra leitura em curso): tenta de novo por alguns segundos
  if (!CP || !CP.itens) { if ((tentativa || 0) < 30) setTimeout(() => cxhAplicarIr(tela, (tentativa || 0) + 1), 300); return; }
  const { foco } = CXH_IR; CXH_IR = null;
  const procura = tela === 'contaspagar' ? (foco === 'hoje' ? 'Pagar hoje, conta a conta' : 'Os próximos dias, por grupo de conta')
                                         : 'O que vai entrar, de onde';
  setTimeout(() => {
    const el = [...document.querySelectorAll('#view-' + tela + ' .section-label')].find(x => x.textContent.includes(procura));
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, 60);
}

async function entrarProjecao() {
  // A Projecao e' FUTURO: os proximos 45 dias, sempre. O recorte de mes fechado que o
  // Placar manda junto com o clique nao existe aqui, entao ela o SOLTA na entrada e fica
  // so com o caminho de volta (o cabecalho da quebra). Sem isso, a tela herdaria um chip
  // anunciando um mes fechado que ela nao mostra, e ficaria presa na loja do Placar.
  plcCtxSolta('projecao');
  const alvo = document.getElementById('view-projecao');
  if (PROJ_PAGAR === null) alvo.innerHTML = '<div class="contexto">Carregando projeção...</div>';
  // 21/10/2026: o que falta conciliar, para o bloco Caixa de hoje (opcional: sem ela o bloco sai sem o aviso)
  const [, conc] = await Promise.all([projCarregar(),
    consultarTudo('vw_fin_conciliacao_a_fazer?select=conta,conta_exibida,unidade,ultimo_ok,dia_a_conciliar,em_dia').catch(() => null)]);
  CXH_CONC = conc;
  renderModuloProjecao();
}

// A CARGA DO MOTOR, sem desenhar nada (16/10/2026). Fluxo projetado, Contas a pagar, Contas a receber
// e Hoje na rede leem o MESMO motor (projCalc): o que entra e o que sai nos proximos dias e' um numero
// so nas quatro telas.
async function projCarregar() {
  await carregarApelidos();
  const corte = new Date(); corte.setDate(corte.getDate() - 35);
  const corteIso = corte.toISOString().slice(0, 10);
  // ate onde a tela projeta (90 dias, com um dia de folga; era 45 ate 19/10/2026): so esse pedaco da estimativa e' pedido;
  // e de onde pedir o mes do banco (62 dias para tras: sempre traz INTEIRO o mes do banco que fechou por ultimo)
  const fimProj = new Date(); fimProj.setDate(fimProj.getDate() + 91);
  const fimProjIso = fimProj.toISOString().slice(0, 10);
  const corteLim = new Date(); corteLim.setDate(corteLim.getDate() - 62);
  const corteLimIso = corteLim.toISOString().slice(0, 10);
  const [pagar, receb, ancora, vencStatus, caixaDia, comAtacado, recebSub, benefSem, benefXp, benefCobr, _fin, atacadoReceber, recebConta, feriados, costumaSair, limiteCfg, limiteDias, limiteMeses, recebAtacado, foraExtrato] = await Promise.all([
    consultarTudo('vw_fin_contas_pagar?select=vencimento,conta,conta_exibida,unidade,situacao,dias_vencida,sentido,subtipo,tipo,natureza,descricao,credito,debito,origem&order=vencimento'),
    consultarTudo(`vw_fin_receitas_diarias?select=data,recebido&data=gte.${corteIso}&order=data`),
    consultarTudo('vw_fin_saldo_banco_atual?select=conta,data_saldo,saldo_banco,idade_dias,saldo_saipos,diferenca'),
    consultarTudo('vw_fin_vencidas_status?select=vencimento,conta,subtipo,tipo,descricao,debito,dias_vencida,data_debito_banco,achou_no_banco,aguarda_extrato'),
    consultarTudo('vw_fin_caixa_do_dia?select=*&order=ordem'),
    consultarTudo('vw_comissao_atacado_semanal?select=*&order=semana_ini.desc&limit=6'),
    consultarTudo(`vw_fin_receitas_diarias_subtipo?select=data,subtipo,recebido&data=gte.${corteIso}&order=data`),
    // Benefício do iFood (comissão zero): quadro semanal para a Hellen acompanhar
    // e mandar para a XP toda quarta (regra do Fabio: não é dinheiro do fluxo).
    consultarTudo('vw_beneficio_semanal?select=*&order=semana'),
    consultarTudo('vw_beneficio_xp_pendente?select=semana,repasse_quarta,valor,falta'),
    consultarTudo('tr_cobrancas?select=unidade,tipo,valor_total,vencimento,status&tipo=in.(BENEFICIO,ACERTO)'),
    garantirDadosFin(),
    // contas a receber do atacado, lido do portal do ePadoca (rotina atacado-epadoca-portal)
    consultarTudo('vw_atacado_receber?select=pedido,cliente,status,valor,data_pedido,vencimento,dias_atraso,faixa,capturado_em&order=vencimento').catch(() => []),
    // Saldo dia a dia (10/10/2026): a MESMA receita de vw_fin_receitas_diarias, aberta pela loja da
    // conta (so para o seletor de loja; se a view faltar, o bloco mostra so a Rede), e os feriados
    consultarTudo(`vw_fin_receitas_diarias_conta?select=data,unidade,recebido&data=gte.${corteIso}&order=data`).catch(() => null),
    consultarTudo(`feriados?select=data,nome&data=gte.${corteIso}&order=data`).catch(() => []),
    // O que costuma sair e ninguem lanca antes (ESTIMATIVA calculada no banco) e o limite do banco. Opcionais.
    consultarTudo(`vw_fin_saida_costuma_sair?select=unidade,dia,peca,estimativa,estimativa_ritmo_pago,por_semana,janela_ini,janela_fim,paga_agua_verde_por_semana&dia=lte.${fimProjIso}&order=dia,unidade,peca`).catch(() => null),
    consultarTudo('fin_limite_conta?select=*&order=conta').catch(() => null),
    consultarTudo(`vw_fin_limite_dia?select=conta,dia,mes_banco_ini,mes_banco_fim,dia_util,fato,sem_extrato,saldo,data_extrato,extrato_lido_em,extrato_parcial&mes_banco_ini=gte.${corteLimIso}&order=conta,dia`).catch(() => null),
    consultarTudo('vw_fin_limite_mes?select=conta,mes_banco_ini,mes_banco_fim,dias_negativo,dias_sem_extrato,juros_pela_conta,juros_debitado,data_debito,erro_pct&order=conta,mes_banco_ini').catch(() => null),
    // Atacado sem contar em dobro: a parte de ATACADO da receita que caiu na conta (o banco e' quem diz o que e' atacado). Opcional.
    consultarTudo(`vw_fin_receitas_diarias_conta?select=data,unidade,recebido_atacado&recebido_atacado=neq.0&data=gte.${corteIso}&order=data`).catch(() => null),
    // Saldo de partida do meio do dia: o que o Saipos ja tem pago na conta e o extrato ainda nao mostra (a conta e' do banco). Opcional.
    consultarTudo('vw_fin_pago_fora_do_extrato?select=conta,unidade,data_extrato,extrato_lido_em,extrato_parcial,extrato_antigo,pago_fora_do_extrato,pagamentos&order=conta').catch(() => null),
  ]);
  PROJ_COSTUMA = null; PROJ_COSTUMA_INFO = null;
  if (costumaSair && costumaSair.length) {
    const porLoja = {}, info = {};
    costumaSair.forEach(r => {
      const doDia = (porLoja[r.unidade] = porLoja[r.unidade] || {});
      const x = (doDia[r.dia] = doDia[r.dia] || { cheia: 0, ritmo: 0 });
      const v = Number(r.estimativa) || 0;
      x[r.peca] = (x[r.peca] || 0) + v;
      x.cheia += v;
      x.ritmo += Number(r.estimativa_ritmo_pago) || 0;
      const i = (info[r.unidade] = info[r.unidade] || { porSemana: {}, janela: null, pagaAV: 0 });
      if (r.por_semana != null) { i.porSemana[r.peca] = Number(r.por_semana); i.janela = [r.janela_ini, r.janela_fim]; }
      if (r.paga_agua_verde_por_semana != null) i.pagaAV = Number(r.paga_agua_verde_por_semana);
    });
    PROJ_COSTUMA = porLoja; PROJ_COSTUMA_INFO = info;
  }
  PROJ_LIMITE = (limiteCfg && limiteCfg.length && limiteDias && limiteDias.length) ? { cfg: limiteCfg, dias: limiteDias, meses: limiteMeses || [] } : null;
  PROJ_ATACADO = null;
  if (recebAtacado) {
    const porLoja = {}, rede = {};
    recebAtacado.forEach(r => {
      const v = Number(r.recebido_atacado) || 0;
      if (r.unidade) { const u = porLoja[r.unidade] || (porLoja[r.unidade] = {}); u[r.data] = (u[r.data] || 0) + v; }
      rede[r.data] = (rede[r.data] || 0) + v;
    });
    PROJ_ATACADO = { porLoja, rede };
  }
  PROJ_FORA_EXTRATO = foraExtrato || null;
  await fxlCarregar();   // 23/10/2026: o Fluxo limpo (sem as views novas, FXL = null e a tela de antes)
  // 23/10/2026: quais provisões estão ligadas — muda só o texto (os números já vêm do banco)
  try { PROJ_PECAS = await consultarTudo('fin_provisao_regra?select=peca,ativo&order=peca'); } catch (e) { PROJ_PECAS = null; }
  projAplicarPecas();
  PROJ_FERIADOS = {};
  (feriados || []).forEach(f => { PROJ_FERIADOS[f.data] = f.nome; });
  PROJ_RECEB_LOJA = null;
  if (recebConta) {
    const porLoja = {}, somaDia = {};
    recebConta.forEach(r => {
      const v = Number(r.recebido), u = porLoja[r.unidade] || (porLoja[r.unidade] = {});
      u[r.data] = (u[r.data] || 0) + v;
      somaDia[r.data] = (somaDia[r.data] || 0) + v;
    });
    // as lojas somadas TEM de dar a receita da Rede, dia a dia; se nao der, o seletor nao aparece
    const fecha = receb.every(r => Math.abs((somaDia[r.data] || 0) - Number(r.recebido)) < 0.01);
    console.assert(fecha, 'receita por loja nao fecha com vw_fin_receitas_diarias');
    if (fecha) PROJ_RECEB_LOJA = porLoja;
  }
  PROJ_ATACADO_RECEBER = (atacadoReceber || []).map(r => ({ ...r, valor: Number(r.valor), dias_atraso: Number(r.dias_atraso) }));
  PROJ_BENEF = { sem: benefSem || [], xp: benefXp || [], cobr: benefCobr || [] };
  // o ritmo do bonus (o mesmo numero do aviso dos R$ 500 mil) estima a semana que ainda nao fechou
  const [farolBonus, comPag, bonusPrev, receitaPrev, foraMediaRegra, provMensal, foraMediaDia] = await Promise.all([
    consultarTudo('vw_beneficio_ifood_farol?select=ritmo_semanal,restante').catch(() => []),
    consultarTudo('vw_comissao_atacado_pagamento?select=semana_ini,pagamento,pessoa,devido,pago,lancado_em,saiu_banco_em,diferenca,situacao,ajuste').catch(() => null),
    consultarTudo('vw_fin_bonus_previsto?select=dia,valor,estimativa,semana,texto&order=dia,semana').catch(() => null),
    consultarTudo('vw_fin_receita_prevista?select=unidade,dia,media,sem_atacado,feriado_movido&order=unidade,dia').catch(() => null),
    // o Boqueirao fora da media (18/10/2026): a regra, a provisao de cada mes e a parte de cada dia que saiu da media. Opcionais.
    consultarTudo('fin_receita_fora_da_media?select=subtipo,unidade,nome_tela').catch(() => null),
    consultarTudo('vw_fin_receita_mensal_prevista?select=*&order=mes_referencia').catch(() => null),
    consultarTudo(`vw_fin_receitas_diarias_conta?select=data,unidade,recebido_fora_media&recebido_fora_media=neq.0&data=gte.${corteIso}&order=data`).catch(() => null),
  ]);
  PROJ_COM_PAG = comPag;
  PROJ_BONUS_PREV = bonusPrev;
  PROJ_RECEITA_PREV = null;
  if (receitaPrev && receitaPrev.length) {
    PROJ_RECEITA_PREV = {};
    receitaPrev.forEach(r => { (PROJ_RECEITA_PREV[r.unidade || ''] = PROJ_RECEITA_PREV[r.unidade || ''] || {})[r.dia] = r; });
  }
  // a parte de cada dia que entra pela provisao mensal (a coluna nova do banco; sem ela = null e nada muda na tela)
  PROJ_FORA_MEDIA = null;
  if (foraMediaDia) {
    const rede = {}, porLoja = {};
    foraMediaDia.forEach(r => {
      const v = Number(r.recebido_fora_media) || 0;
      if (r.unidade) { const u = porLoja[r.unidade] || (porLoja[r.unidade] = {}); u[r.data] = (u[r.data] || 0) + v; }
      rede[r.data] = (rede[r.data] || 0) + v;
    });
    PROJ_FORA_MEDIA = { subtipos: new Set([...(foraMediaRegra || []), ...(provMensal || [])].map(r => r.subtipo)),
                        rede, porLoja, prov: provMensal || [] };
  }
  PROJ_RITMO_BONUS = farolBonus[0] ? { ritmo: Number(farolBonus[0].ritmo_semanal), restante: Number(farolBonus[0].restante) } : null;
  PROJ_RECEB_SUB = recebSub;
  PROJ_RECEB_SUB.forEach(r => { r.recebido = Number(r.recebido); });
  PROJ_ANCORA = ancora;
  PROJ_VENC = vencStatus;
  PROJ_COM_ATACADO = comAtacado || [];
  PROJ_CAIXA = (caixaDia || []).map(r => Object.fromEntries(Object.entries(r).map(
    ([k, v]) => [k, ['conta','conta_exibida','unidade'].includes(k) ? v : Number(v)])));
  PROJ_VENC.forEach(r => { r.debito = Number(r.debito); });
  PROJ_PAGAR = pagar;
  PROJ_PAGAR.forEach(r => { r.credito = Number(r.credito); r.debito = Number(r.debito); });
  PROJ_RECEB = receb;
  PROJ_RECEB.forEach(r => { r.recebido = Number(r.recebido); });
}

// o que o motor diz que ENTRA e SAI entre o dia `de` e o dia `ate` (0 = hoje, com as vencidas).
// Entra = a media + o que esta lancado a receber, sem o atacado em dobro (a mesma conta da linha do
// Saldo dia a dia). Sai = contas lancadas; o bonus que vai para a aplicacao vem separado.
function projJanela(P, de, ate) {
  let entra = 0, media = 0, lancado = 0, sai = 0, bonus = 0;
  for (let i = de; i <= Math.min(ate, P.dias.length - 1); i++) {
    const d = P.dias[i], semAt = (P.serieSemAtacado || [])[i] || 0;
    media += P.serieMedia[i] - semAt;
    lancado += P.receberDia[d] || 0;
    sai += P.pagarDia[d] || 0;
    bonus += (P.bonusDia || {})[d] || 0;
  }
  entra = media + lancado;
  return { entra, media, lancado, sai, bonus, ate: P.dias[Math.min(ate, P.dias.length - 1)] };
}

// ------------------------------------------------------------------
// Modulo CONTAS A PAGAR (30/09/2026, pedido do dono) — UMA lista de tudo que esta
// em aberto, da mesma base que o Fluxo projetado le (vw_fin_contas_pagar): Saipos,
// Pagamento fora da folha, cobrancas das listas e boletos do ePadoca. O projetado
// continua sendo o saldo dia a dia; aqui e' a lista para agir. A baixa de cada
// origem continua onde sempre foi (coluna "Baixa" diz onde) — o fora da folha
// baixa sozinho quando o Saipos traz o valor exato.
// ------------------------------------------------------------------
let CP = null;

const CP_ORIGEM = {
  'SAIPOS':        { rot: 'Saipos',        baixa: 'no Saipos' },
  'FORA DA FOLHA': { rot: 'Fora da folha', baixa: 'automática pelo Saipos', tela: 'pcalc', aba: 'fora' },
  'LISTAS':        { rot: 'Listas',        baixa: 'Listas · Financeiro', tela: 'listasfin' },
  'EPADOCA':       { rot: 'ePadoca',       baixa: 'automática (portal)' },
  // 18/10/2026: a provisao mensal do Boqueirao enquanto a lista do mes nao fecha (estimativa, vw_fin_receita_mensal_prevista)
  'PROVISAO':      { rot: 'Provisão',      baixa: 'some sozinha quando o pagamento entra' },
};

// A CARGA dos titulos, igual para as duas telas (16/10/2026). O motor do Fluxo projetado vem junto:
// Contas a pagar le dele o "pagar hoje, conta a conta", as maiores contas ate o aperto, a comissao e o
// bonus; Contas a receber, o que vai entrar por origem — os mesmos numeros do Fluxo.
const cpFiltroVazio = () => ({ situacao: '', origem: '', unidade: '', faixa: null });

async function cpCarregar() {
  await carregarApelidos();
  try { await trRpc('rh_ff_baixa_automatica', {}); } catch (e) {}   // sem acesso a pessoal: ignora
  const [linhas, venc, imp, motor] = await Promise.all([
    consultarTudo('vw_fin_contas_pagar?select=vencimento,conta_exibida,unidade,situacao,dias_vencida,subtipo,tipo,descricao,credito,debito,origem,id_titulo,titulo,fornecedor&order=vencimento'),
    consultarTudo('vw_fin_vencidas_status?select=vencimento,descricao,debito,data_debito_banco,achou_no_banco,aguarda_extrato').catch(() => []),
    consultarTudo('vw_fin_ultima_importacao?select=fonte,importado_em').catch(() => []),
    // 07/11/2026: a projeção do fluxo (~20 consultas) NÃO segura mais a lista. Com o servidor cheio ela passava de 30 s e a
    // tela ficava em "Carregando contas a pagar..."; agora a lista sai já, e os quadros que dependem dela entram quando ela chega
    false,
  ]);
  const saiu = {};
  (venc || []).filter(v => v.achou_no_banco).forEach(v => { saiu[`${v.vencimento}|${Number(v.debito)}|${v.descricao || ''}`] = v.data_debito_banco; });
  // 16/10/2026 (dono): "conta que ainda aguarda o extrato aparece como 'aguardando o extrato', não
  // como vencida". A regra e' do banco (vw_fin_vencidas_status.aguarda_extrato): o extrato daquela
  // conta ainda nao cobre o dia do vencimento — a mesma do Fluxo projetado e da Hoje na rede.
  const aguarda = {};
  (venc || []).filter(v => v.aguarda_extrato).forEach(v => { aguarda[`${v.vencimento}|${Number(v.debito)}|${v.descricao || ''}`] = true; });
  const impSaipos = (imp || []).find(i => i.fonte === 'SAIPOS_PREV');
  CP = { itens: cpTitulos(linhas || [], saiu, aguarda),
         filtros: CP ? CP.filtros : { PAGAR: cpFiltroVazio(), RECEBER: cpFiltroVazio() },
         tudo: CP ? CP.tudo : false,
         ordem: CP ? CP.ordem : { col: 'conta', dir: 1 },   // dono, 16/10/2026: por banco e, no banco, do menor valor para o maior
         agrupar: CP ? CP.agrupar : { PAGAR: 'dia', RECEBER: 'dia' },   // como a lista se agrupa (16/10/2026)
         abertos: CP ? CP.abertos : new Set(),                       // grupos que a pessoa abriu
         loja: CP ? CP.loja : '',                                    // '' = Rede; vale para a tela inteira (16/10/2026)
         lidoEm: new Date(), saiposEm: impSaipos ? new Date(impSaipos.importado_em) : null, temMotor: motor };
  const cpAgora = CP;
  projCarregar().then(() => true).catch(() => false).then((ok) => {
    if (!ok || CP !== cpAgora) return;
    CP.temMotor = true;
    if (['contaspagar', 'contasreceber'].includes(MODULO_ATUAL)) cpRender();
  });
}

async function entrarContasPagar() {
  const alvo = document.getElementById('view-contaspagar');
  if (!alvo) return;
  if (!CP) alvo.innerHTML = '<div class="contexto">Carregando contas a pagar...</div>';
  await cpCarregar();
  renderContasPagar();
  cxhAplicarIr('contaspagar');
}

async function entrarContasReceber() {
  const alvo = document.getElementById('view-contasreceber');
  if (!alvo) return;
  if (!CP) alvo.innerHTML = '<div class="contexto">Carregando contas a receber...</div>';
  await cpCarregar();
  renderContasReceber();
  cxhAplicarIr('contasreceber');
}

// UM TITULO = UMA LINHA (dono, 01/10/2026: "o titulo a pagar no valor total, sem o
// rateio por conta"). A view entrega um lancamento por categoria do rateio (a NF da
// Facil vem em Embalagens + Descartaveis + Limpeza — e' o que a DRE e o projetado
// precisam); aqui as partes do mesmo id_titulo do Saipos somam. O sentido sai do
// LIQUIDO do titulo. Sem id_titulo (fora da folha, listas, ePadoca) a linha ja e' o titulo.
function cpTitulos(linhas, saiu, aguarda) {
  const mapa = new Map();
  linhas.forEach((r, i) => {
    const credito = Number(r.credito), debito = Number(r.debito);
    const k = r.id_titulo ? `${r.origem}|${r.id_titulo}|${r.vencimento}|${r.conta_exibida}` : `linha${i}`;
    let t = mapa.get(k);
    if (!t) {
      // 07/11/2026 (dono: "sempre espere o tempo de conciliação"): o banco já diz 'AGUARDANDO CONCILIACAO' — mesma faixa do 'aguardando'
      t = { vencimento: r.vencimento, situacao: r.situacao === 'AGUARDANDO CONCILIACAO' ? 'AGUARDANDO EXTRATO' : r.situacao, dias_vencida: r.dias_vencida, origem: r.origem,
            unidade: r.unidade, conta_exibida: r.conta_exibida || '', descricao: String(r.titulo || r.descricao || '').replace(/\s*\(parc\.[^)]*\)\s*$/i, ''),
            fornecedor: r.fornecedor || '', liquido: 0, partes: [], saiuTodas: true, saiuBanco: undefined, aguardaTodas: true };
      mapa.set(k, t);
    }
    if (!t.fornecedor && r.fornecedor) t.fornecedor = r.fornecedor;
    t.liquido += credito - debito;
    t.partes.push({ subtipo: r.subtipo || '', tipo: r.tipo || '', valor: credito - debito });
    const s = r.situacao === 'VENCIDA' && debito > 0 ? saiu[`${r.vencimento}|${debito}|${r.descricao || ''}`] : undefined;
    if (s) t.saiuBanco = t.saiuBanco || s; else if (debito > 0) t.saiuTodas = false;
    if (debito > 0 && !(aguarda || {})[`${r.vencimento}|${debito}|${r.descricao || ''}`]) t.aguardaTodas = false;
  });
  const lista = [...mapa.values()];
  lista.forEach(t => {
    t.sentido = t.liquido < 0 ? 'PAGAR' : 'RECEBER';
    t.valor = Math.abs(Math.round(t.liquido * 100) / 100);
    if (!t.saiuTodas) t.saiuBanco = undefined;
    // vencida cujas partes todas ainda aguardam o extrato: nao e' vencida de verdade (16/10/2026)
    if (t.situacao === 'VENCIDA' && t.sentido === 'PAGAR' && !t.saiuBanco && t.aguardaTodas) t.situacao = 'AGUARDANDO EXTRATO';
    const cats = [...new Set(t.partes.map(p => p.subtipo))];
    t.categoria = cats.join(' + ');
    t.rateio = t.partes.length > 1 ? t.partes.map(p => `${p.subtipo}: ${fmt(Math.abs(p.valor))}`).join(' · ') : '';
  });
  return lista;
}

// as duas telas dividem a carga e a lista; cada uma guarda os proprios filtros
function cpSentidoAtual() { return MODULO_ATUAL === 'contasreceber' ? 'RECEBER' : 'PAGAR'; }

function cpRender() { if (cpSentidoAtual() === 'RECEBER') renderContasReceber(); else renderContasPagar(); }

function cpIrParaLista() { const el = document.getElementById('cpLista'); if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' }); }

function cpFiltro(campo, valor) {
  const f = CP.filtros[cpSentidoAtual()];
  f[campo] = f[campo] === valor ? '' : valor;
  cpRender();
  if (campo === 'situacao' && f[campo]) cpIrParaLista();
}

// um periodo de vencimento (as linhas da tabela "os proximos dias"); clicar de novo solta
function cpFaixa(de, ate, rot) {
  const f = CP.filtros[cpSentidoAtual()];
  f.faixa = f.faixa && f.faixa.de === de && f.faixa.ate === ate ? null : { de, ate, rot };
  cpRender();
  if (f.faixa) cpIrParaLista();
}

function cpTudo() { CP.tudo = !CP.tudo; cpRender(); }

// Ordenar pelo titulo da coluna: 1o clique no sentido natural (texto A→Z, valor do
// maior para o menor), 2o clique inverte. Empate cai no vencimento.
const CP_COLUNAS = [
  ['vencimento', 'Vencimento', t => t.vencimento, 1],
  ['descricao', 'Título', t => t.descricao, 1],
  ['fornecedor', null, t => t.fornecedor, 1],          // rotulo depende de pagar/receber
  ['origem', 'Origem', t => (CP_ORIGEM[t.origem] || { rot: t.origem || '' }).rot, 1],
  ['conta', 'Conta', t => t.conta_exibida, 1],
  ['categoria', 'Categoria', t => t.categoria, 1],
  ['valor', 'Valor', t => t.valor, -1],
];

function cpOrdenar(col) {
  const natural = (CP_COLUNAS.find(c => c[0] === col) || [])[3] || 1;
  CP.ordem = CP.ordem.col === col ? { col, dir: -CP.ordem.dir } : { col, dir: natural };
  cpRender();
}

// ATUALIZAR PUXA O SAIPOS (dono, 01/10/2026). O painel nao roda Python: o botao grava
// um pedido tipo SAIPOS_COMPLETO na fila que ja existia (fin_conciliacao_pedido) e o
// atender_conciliacao.py, na maquina das rotinas, roda a carga completa (2-3 min).
// Enquanto isso a tela continua usavel — o estado mora em CP_PEDIDO, fora do CP,
// porque cada clique de filtro redesenha o botao.
let CP_PEDIDO = null;   // { estado: 'PEDINDO'|'PENDENTE'|'RODANDO', desde } enquanto ha pedido vivo

let CP_AVISO = '';      // ultima resposta do pedido que precisa ficar na tela

function cpRotuloAtualizar() {
  if (!CP_PEDIDO) return '↻ Atualizar';
  const s = Math.round((Date.now() - CP_PEDIDO.desde) / 1000);
  const t = s >= 60 ? Math.floor(s / 60) + 'min' + String(s % 60).padStart(2, '0') : s + 's';
  return CP_PEDIDO.estado === 'RODANDO' ? `puxando o Saipos… ${t}` : `na fila… ${t}`;
}

function cpPintarBotao() {
  const b = document.getElementById('cpBtnAtualizar');
  if (b) { b.textContent = cpRotuloAtualizar(); b.disabled = !!CP_PEDIDO; }
}

async function cpAtualizar() {
  if (CP_PEDIDO) return;
  CP_PEDIDO = { estado: 'PEDINDO', desde: Date.now() };
  CP_AVISO = '';
  cpPintarBotao();
  let fim = '';
  try {
    await rmbGarantirTokenValido();
    const pede = () => fetch(`${SUPABASE_URL}/rest/v1/fin_conciliacao_pedido`, {
      method: 'POST', headers: rmbHeaders({ Prefer: 'return=representation' }),
      body: JSON.stringify({ quem: (rmbSessao() || {}).email || 'PAINEL', tipo: 'SAIPOS_COMPLETO' }),
    });
    let r = await pede();
    if (r.status === 401) { await rmbRenovarSeExpirado(r); r = await pede(); }
    if (!r.ok) throw new Error((await r.text()).slice(0, 120));
    const pedido = (await r.json())[0];
    CP_PEDIDO.estado = 'PENDENTE';
    (cpSentidoAtual() === 'RECEBER' ? entrarContasReceber() : entrarContasPagar());   // o que ja esta no banco aparece na hora; o Saipos vem depois
    // a carga leva 2-3 min; o atendedor desiste aos 16. Pendente por 90s = ninguem atendendo.
    const limite = Date.now() + 17 * 60000;
    let linha = null;
    while (Date.now() < limite) {
      await new Promise(s => setTimeout(s, 3000));
      const q = await fetch(`${SUPABASE_URL}/rest/v1/fin_conciliacao_pedido?id=eq.${pedido.id}&select=status,resumo`, { headers: rmbHeaders() });
      if (q.ok) linha = (await q.json())[0] || linha;
      if (linha) CP_PEDIDO.estado = linha.status;
      cpPintarBotao();
      if (linha && (linha.status === 'OK' || linha.status === 'ERRO')) break;
      if (CP_PEDIDO.estado === 'PENDENTE' && Date.now() - CP_PEDIDO.desde > 90000) break;
    }
    const resumo = (linha && linha.resumo) || '';
    if (!linha || linha.status === 'PENDENTE') fim = 'O pedido entrou na fila, mas ninguém atendeu — a máquina das rotinas pode estar desligada. A lista abaixo é a da última carga.';
    else if (linha.status === 'ERRO') fim = 'O Saipos não respondeu: ' + resumo + '. A lista abaixo é a da última carga.';
    else if (linha.status === 'RODANDO') fim = 'A carga do Saipos ainda está rodando — clique de novo em alguns minutos.';
    // atendedor que ainda nao foi reiniciado trata o pedido como conciliacao (janela de 7 dias)
    else if (!resumo.includes('Saipos completo')) fim = 'Atendido pela versão antiga do atendedor: só os últimos 7 dias do Saipos foram relidos. Reinicie a tarefa "Painel - Atender conciliacao" na máquina das rotinas.';
  } catch (e) {
    fim = 'Não consegui pedir a atualização: ' + e.message;
  }
  CP_PEDIDO = null;
  CP_AVISO = fim;
  await (cpSentidoAtual() === 'RECEBER' ? entrarContasReceber() : entrarContasPagar());
}

// ---- pecas comuns das duas telas ----
const CP_SIT = {
  PAGAR: [['VENCIDA', 'Vencidas', 'neg'], ['AGUARDANDO EXTRATO', 'Aguardando conciliação', 'neutral'], ['VENCE HOJE', 'Vence hoje', 'highlight'], ['PROXIMOS 7 DIAS', 'Próximos 7 dias', 'blue'], ['DEPOIS', null, 'neutral']],
  RECEBER: [['VENCIDA', 'Atrasados', 'neg'], ['VENCE HOJE', 'Vence hoje', 'highlight'], ['PROXIMOS 7 DIAS', 'Próximos 7 dias', 'blue'], ['DEPOIS', null, 'neutral']],
};

// O SELETOR DE LOJA (16/10/2026): um so, embaixo do titulo, para a tela inteira — cartoes, pagar hoje, proximos
// dias, maiores contas, o que vai entrar e a lista.
function cpSinc() {
  const u = finVazio();
  if (CP.loja === u) return;
  CP.loja = u;
  CP.filtros.PAGAR.unidade = u; CP.filtros.RECEBER.unidade = u;
  PROJ_FILTRO.conta = '';
}

const cpNomeLoja = () => lojaNome(lojaFin());

const cpDaLoja = (r) => !CP.loja || r.unidade === CP.loja;

function cpLimIso() { const lim = new Date(trHoje() + 'T12:00:00'); lim.setDate(lim.getDate() + 45); return lim.toLocaleDateString('en-CA'); }

function cpDoSentido(sentido) { const lim = cpLimIso(); return CP.itens.filter(r => r.sentido === sentido && r.valor > 0 && (CP.tudo || r.vencimento <= lim)); }

// cada dimensao conta com os OUTROS filtros aplicados (padrao da Evolucao)
function cpPassa(f, r, sem) {
  return (sem === 'situacao' || !f.situacao || r.situacao === f.situacao)
      && (sem === 'origem' || !f.origem || r.origem === f.origem)
      && (sem === 'unidade' || !f.unidade || (r.unidade || '—') === f.unidade)
      && (sem === 'faixa' || !f.faixa || (r.vencimento >= f.faixa.de && r.vencimento <= f.faixa.ate));
}

const cpSoma = (l) => l.reduce((s, r) => s + r.valor, 0);

const cpMil = (v) => Math.abs(v) < 50 ? '—' : (v / 1000).toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 });

function cpBarra() {
  const hoje = trHoje();
  const hora = (d) => d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', timeZone: 'America/Sao_Paulo' });
  return `<div style="display:flex; gap:6px; flex-wrap:wrap; align-items:center; margin-bottom:10px;">
      <button class="preset-btn ${CP.tudo ? 'active' : ''}" onclick="cpTudo()" title="por padrão a lista vai até 45 dias à frente">${CP.tudo ? 'até 45 dias' : 'ver tudo'}</button>
      <span style="flex:1;"></span>
      <span class="caption-label" style="margin:0;" title="O botão pede uma carga completa do Saipos à máquina das rotinas (2 a 3 minutos) e relê a lista quando ela termina.">lido às ${hora(CP.lidoEm)}${CP.saiposEm ? ` · Saipos carregado ${CP.saiposEm.toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' }) === hoje ? 'hoje' : 'em ' + CP.saiposEm.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', timeZone: 'America/Sao_Paulo' })} às ${hora(CP.saiposEm)}` : ''}</span>
      <button class="preset-btn" id="cpBtnAtualizar" onclick="cpAtualizar()" ${CP_PEDIDO ? 'disabled' : ''} title="puxa o Saipos de novo (2 a 3 minutos) e relê as contas, mantendo filtros e ordem">${cpRotuloAtualizar()}</button>
    </div>${CP_AVISO ? `<div class="contexto" style="text-align:left; border-color:var(--amber-2); margin-bottom:10px;">${CP_AVISO}</div>` : ''}`;
}

// os cartoes de situacao: clicar filtra a lista la embaixo
function cpCartoes(sentido) {
  const f = CP.filtros[sentido];
  const base = cpDoSentido(sentido).filter(r => cpPassa(f, r, 'situacao'));
  let h = '<div class="cards">';
  for (const [k, rot0, cls] of CP_SIT[sentido]) {
    const rot = rot0 || (CP.tudo ? 'Depois' : 'Até 45 dias');
    const l = base.filter(r => r.situacao === k);
    const saiuBanco = k === 'VENCIDA' ? l.filter(r => r.saiuBanco) : [];
    h += `<div class="card ${cls}" style="cursor:pointer; ${f.situacao === k ? 'outline:2px solid var(--brand);' : ''}" onclick="cpFiltro('situacao','${k}')">
      <div class="card-lbl">${rot}</div><div class="card-val">R$ ${fmt(cpSoma(l))}</div>
      <div class="card-pct">${l.length} título(s)${saiuBanco.length ? ` · <span style="color:var(--amber-2);">${saiuBanco.length} já ${saiuBanco.length === 1 ? 'saiu' : 'saíram'} do banco, falta a baixa</span>` : ''}</div></div>`;
  }
  return h + '</div>';
}

// a lista completa, com os chips de origem e unidade e a ordem pela coluna
function cpTabela(sentido) {
  const f = CP.filtros[sentido];
  const doSentido = cpDoSentido(sentido);
  const verbo = sentido === 'PAGAR' ? 'a pagar' : 'a receber';
  const chips = (campo, chave, rotulo) => {
    const g = {};
    doSentido.filter(r => cpPassa(f, r, campo)).forEach(r => { const c = chave(r); g[c] = (g[c] || 0) + r.valor; });
    return Object.entries(g).sort((a, b) => b[1] - a[1]).map(([c, v]) =>
      `<button class="preset-btn ${f[campo] === c ? 'active' : ''}" onclick="cpFiltro('${campo}', '${c.replace(/'/g, "\\'")}')">${rotulo(c)} · R$ ${fmt(v)}${f[campo] === c ? ' ✕' : ''}</button>`).join(' ');
  };
  let h = `<div id="cpLista" style="display:flex; gap:6px; flex-wrap:wrap; margin:10px 0 4px;"><span class="caption-label" style="margin:0 4px 0 0;">Origem</span>${chips('origem', r => r.origem, c => (CP_ORIGEM[c] || { rot: c }).rot)}</div>
    <div style="display:flex; gap:6px; flex-wrap:wrap; margin:4px 0 10px;">
    ${f.faixa ? `<button class="preset-btn active" onclick="cpFaixa('${f.faixa.de}','${f.faixa.ate}','')">Vencimento: ${f.faixa.rot} ✕</button>` : ''}
    ${f.situacao ? `<button class="preset-btn active" onclick="cpFiltro('situacao','${f.situacao}')">${((CP_SIT[sentido].find(x => x[0] === f.situacao) || [])[1]) || 'Situação'} ✕</button>` : ''}</div>`;
  const lista = doSentido.filter(r => cpPassa(f, r));
  // LISTA EM GRUPOS (dono, 16/10/2026: "pra ficar menor, faz essa lista com listas agrupadas"). Cada grupo e' uma
  // linha com quantos titulos e quanto soma; clicar abre os titulos dele. Por padrao, por DIA de vencimento (o que ja
  // venceu num grupo so, no topo); tambem por fornecedor (ou de quem) e por grupo de conta (ou origem, no a receber).
  const AGR = sentido === 'PAGAR'
    ? [['dia', 'Dia'], ['fornecedor', 'Fornecedor'], ['grupo', 'Grupo de conta']]
    : [['dia', 'Dia'], ['fornecedor', 'De quem'], ['origem', 'Origem']];
  const agr = (CP.agrupar || {})[sentido] || 'dia';
  const hoje = trHoje();
  const SEM = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb'];
  const grupoConta = (r) => {
    const v = CP_GRUPOS.map(() => 0);
    r.partes.forEach(p => { v[CP_GRUPOS.findIndex(g => g[1](p.tipo))] += Math.abs(p.valor); });
    return CP_GRUPOS[v.indexOf(Math.max(...v))][0];
  };
  const chaveDe = (r) => agr === 'dia' ? (r.vencimento < hoje ? '0000-00-00' : r.vencimento)
    : agr === 'fornecedor' ? (r.fornecedor || r.categoria || '—')
    : agr === 'grupo' ? grupoConta(r)
    : (CP_ORIGEM[r.origem] || { rot: r.origem || '—' }).rot;
  const rotuloDe = (k) => agr !== 'dia' ? trEscH(k)
    : k === '0000-00-00' ? (sentido === 'PAGAR' ? 'Já venceu' : 'Atrasados')
    : `${ffDdmm(k)} (${SEM[new Date(k + 'T12:00:00').getDay()]})${k === hoje ? ' · hoje' : ''}`;
  const grupos = new Map();
  lista.forEach(r => { const k = chaveDe(r); if (!grupos.has(k)) grupos.set(k, []); grupos.get(k).push(r); });
  const ordem = [...grupos.entries()].map(([k, l]) => ({ k, l, tot: cpSoma(l) }))
    .sort((a, b) => agr === 'dia' ? a.k.localeCompare(b.k) : b.tot - a.tot);
  const limpa = (t) => String(t || '').replace(/\s*\(parc\. 100000\/100000\)/, '');
  const cat = (c) => { const p = String(c || '').split(' + '); return p.length > 2 ? `${p.slice(0, 2).join(' + ')} +${p.length - 2}` : p.join(' + '); };
  const linha = (r, comData) => {
    const og = CP_ORIGEM[r.origem] || { rot: r.origem || '—', baixa: '—' };
    const cor = r.situacao === 'VENCIDA' ? 'var(--farol-fora)' : r.situacao === 'VENCE HOJE' ? 'var(--amber-2)' : 'inherit';
    const venc = `${ffDdmm(r.vencimento)}${r.situacao === 'VENCIDA' ? ` · ${r.dias_vencida}d` : ''}`;
    const nota = r.situacao === 'AGUARDANDO EXTRATO' ? '<span style="color:var(--tx-3);" title="o extrato do banco desta conta ainda não cobre o dia do vencimento">aguardando o extrato</span>' : '';
    // "no Saipos" e' o caso comum: so aparece a baixa quando ela foge disso
    const baixa = r.origem === 'SAIPOS' && !r.saiuBanco ? '' : r.saiuBanco
      ? `<span style="color:var(--amber-2);" title="o débito já apareceu no extrato do banco">saiu do banco em ${ffDdmm(r.saiuBanco)} — dar baixa no Saipos</span>`
      : og.tela ? `<a href="javascript:void(0)" style="color:var(--tx-3);" onclick="${og.aba ? `sessionStorage.setItem('pesAbaPedida','${og.aba}');` : ''}mostrarModulo('${og.tela}')">${og.baixa} ›</a>`
      : `<span style="color:var(--tx-3);">${og.baixa}</span>`;
    const jaNoTitulo = r.fornecedor && String(r.descricao || '').toUpperCase().includes(String(r.fornecedor).toUpperCase());
    const sub = [agr !== 'fornecedor' && !jaNoTitulo ? r.fornecedor : '', cat(r.categoria), agr !== 'origem' && r.origem !== 'SAIPOS' ? og.rot : '']
      .filter(Boolean).map(trEscH).join(' · ');
    return `<tr>${comData ? `<td class="cp-venc" style="white-space:nowrap; color:${cor}; width:1%;">${venc}${nota ? '<br>' + nota : ''}</td>` : ''}
      <td class="cp-desc" style="text-align:left; white-space:normal;"${r.rateio ? ` title="rateio: ${trEscH(r.rateio)}"` : ''}>${trEscH(limpa(r.descricao))}
        <div style="font-size:11px; color:var(--tx-4);">${sub}${!comData && nota ? ' · ' + nota : ''}</div></td>
      <td class="cp-banco" style="width:1%; white-space:nowrap;">${trEscH(r.conta_exibida || '—')}</td>
      <td class="cp-val" style="width:1%; white-space:nowrap;"><b>${fmt(r.valor)}</b></td><td class="cp-baixa" style="text-align:left; font-size:12px; width:1%;">${baixa}</td></tr>`;
  };
  // DENTRO DE CADA GRUPO (dono, 16/10/2026: "ordena por banco e depois por valor, do menor para o maior, se der pra
  // colocar as colunas com ordenação quando clica"): o titulo da coluna ordena; o empate cai no banco e no menor valor.
  const o = CP.ordem || { col: 'conta', dir: 1 };
  const VAL = { conta: r => r.conta_exibida || '', valor: r => r.valor, descricao: r => limpa(r.descricao), vencimento: r => r.vencimento };
  const ordena = (l) => l.slice().sort((a, b) => {
    const fv = VAL[o.col] || VAL.conta, va = fv(a), vb = fv(b);
    const c = typeof va === 'number' ? va - vb : String(va).localeCompare(String(vb), 'pt-BR');
    return c * o.dir || (a.conta_exibida || '').localeCompare(b.conta_exibida || '', 'pt-BR') || a.valor - b.valor;
  });
  const th = (col, rot) => `<th onclick="cpOrdenar('${col}')" style="cursor:pointer; user-select:none;${o.col === col ? ' color:var(--tx-1);' : ''}" title="ordenar por esta coluna">${rot}${o.col === col ? (o.dir > 0 ? ' ▲' : ' ▼') : ''}</th>`;
  const cab = (comData) => `<tr>${comData ? th('vencimento', 'Vence') : ''}${th('descricao', sentido === 'PAGAR' ? 'Conta a pagar' : 'Título')}${th('conta', 'Banco')}${th('valor', 'Valor')}<th></th></tr>`;
  const so1 = ordem.length === 1;
  h += `<div style="display:flex; gap:6px; flex-wrap:wrap; align-items:center; margin:4px 0 6px;"><span class="caption-label" style="margin:0 4px 0 0;">Agrupar por</span>
      ${AGR.map(([k, rot]) => `<button class="preset-btn ${agr === k ? 'active' : ''}" onclick="cpAgrupar('${k}')">${rot}</button>`).join(' ')}</div>
    <div class="caption-label" style="text-align:left;"><b>R$ ${fmt(cpSoma(lista))} ${verbo}</b> em ${lista.length} título(s), ${ordem.length} grupo(s) · clique num grupo para ver os títulos.</div>
    <div id="tabelaContasPagar">${ordem.map(({ k, l, tot }) => {
      const id = `${sentido}|${agr}|${k}`;
      const aberto = so1 || CP.abertos.has(id);
      const atraso = agr === 'dia' && k === '0000-00-00';
      return `<details class="cp-grupo cel-cartao"${aberto ? ' open' : ''} data-k="${trEscH(id)}" ontoggle="cpAbre(this)">
        <summary><span class="cp-grupo-nome"${atraso ? ' style="color:var(--farol-fora);"' : ''}>${rotuloDe(k)}</span>
          <span class="cp-grupo-n">${l.length} título${l.length === 1 ? '' : 's'}</span>
          <b class="cp-grupo-v"${atraso ? ' style="color:var(--farol-fora);"' : ''}>R$ ${fmt(tot)}</b></summary>
        <table>${cab(agr !== 'dia' || atraso)}${ordena(l).map(r => linha(r, agr !== 'dia' || atraso)).join('')}</table>
      </details>`; }).join('')}</div>`;
  return h;
}

function cpAgrupar(k) { CP.agrupar[cpSentidoAtual()] = k; cpRender(); }

function cpAbre(el) { const k = el.dataset.k; if (el.open) CP.abertos.add(k); else CP.abertos.delete(k); }

// ---- CONTAS A PAGAR — "o que eu pago hoje e nesta semana?" (dono, 16/10/2026: so a pagar; o a receber
// ganhou tela propria). Ordem: situacao -> pagar hoje conta a conta -> os proximos dias por grupo ->
// as maiores contas ate o aperto -> a lista inteira -> o que e' de lancar (recolhido).
// os grupos do plano de contas em quatro colunas (o resto cai em "Fixas e outras")
const CP_GRUPOS = [
  ['Pessoas', t => ['PESSOAL', 'PRO LABORE', 'RETIRADAS'].includes(t)],
  ['Mercadoria e consumo', t => ['MATERIA PRIMA', 'USO E CONSUMO'].includes(t)],
  ['Impostos', t => ['DEDUÇOES DA RECEITA', 'IMPOSTOS E TAXAS'].includes(t)],
  ['Fixas e outras', () => true],
];

// ---- CONTAS A PAGAR NA CONTA DO FLUXO LIMPO (dono, 23/10/2026: as telas ficam, "usarem os mesmos cálculos do projetado").
// O que é saldo, a pagar e a receber do dia sai de FXL (o mesmo do Fluxo projetado); a lista de títulos continua a de sempre.
const cpFxlLoja = () => CP.loja || 'REDE';

function cpHojeLimpo() {
  if (!FXL || !FXL.dias.length) return '';
  const mil = (v) => (Math.abs(v) < 0.5 ? '0' : (v < 0 ? '−' : '') + fmt(Math.abs(v)).replace(/,\d\d$/, ''));
  const d0 = FXL.dias[0];
  const lojas = finLinhas();
  const lk = (k, v) => `<a href="javascript:void(0)" data-fxl="1" onclick="cpHojeAbrir('${k}')" style="color:inherit; text-decoration:underline dotted;" title="ver o que compõe">${mil(v)}</a>`;
  let h = `<div class="section-label">Hoje — ${String(d0.dia).slice(8, 10)}/${String(d0.dia).slice(5, 7)}, pela conta do Fluxo projetado</div>
    <div id="tabelaCpHoje" class="cel-cartao" style="overflow-x:auto;"><table><thead><tr><th>Loja</th><th>Saldo inicial</th><th>A receber</th><th>A pagar</th><th>Saldo final</th></tr></thead><tbody>`;
  lojas.forEach(([u, nome]) => {
    const x = d0.unidades[u];
    h += `<tr${u === 'REDE' ? ' class="liq"' : ''}><td>${nome}</td><td>${mil(x.saldo_inicial)}</td>
      <td>${lk(`${u}|RECEBER`, x.a_receber)}</td><td>${lk(`${u}|PAGAR`, x.a_pagar)}</td>
      <td style="font-weight:700; color:${x.saldo_final < 0 ? 'var(--farol-fora)' : 'inherit'};">${mil(x.saldo_final)}</td></tr>`;
  });
  h += `</tbody></table></div>
    <div class="caption-label" style="text-align:left;">Em R$. O mesmo número do Fluxo projetado: saldo do fim de ontem (extrato); a pagar e a receber = os títulos que vencem até hoje (em aberto ou já pagos hoje no Saipos) + o previsto do dia que ainda não tem título. Clique num valor para ver o que o compõe.</div>`;
  if (CP.fxlAberto) {
    const [u, lado] = CP.fxlAberto.split('|');
    const nome = lojaNome(u);
    h += fxlComposicao(d0.unidades[u].composicao.filter((c) => c.lado === lado), `${lado === 'PAGAR' ? 'A pagar' : 'A receber'} · ${nome} · hoje`);
  }
  return h;
}

function cpHojeAbrir(k) { CP.fxlAberto = CP.fxlAberto === k ? null : k; const a = document.getElementById('cpHojeWrap'); if (a) a.innerHTML = cpHojeLimpo(); }

// o previsto SEM título (o que o Fluxo conta e a lista não tem) a pagar, de um dia a outro, na loja escolhida
function cpPrevistoSemTitulo(de, ate) {
  if (!FXL) return 0;
  const u = cpFxlLoja();
  return FXL.dias.filter((d) => d.dia >= de && d.dia <= ate)
    .reduce((s, d) => s + d.unidades[u].composicao.filter((c) => c.lado === 'PAGAR' && c.tem_titulo === false).reduce((a, c) => a + c.valor, 0), 0);
}

function cpFluxoPagar(de, ate) {
  if (!FXL) return null;
  const u = cpFxlLoja(), ds = FXL.dias.filter((d) => d.dia >= de && d.dia <= ate);
  return ds.length ? ds.reduce((s, d) => s + d.unidades[u].a_pagar, 0) : null;
}

function cpProximosDias() {
  const hoje = trHoje(), d = (n) => fxSomaDias(hoje, n);
  const SEM = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb'];
  const rotDia = (s) => `${ffDdmm(s)} (${SEM[new Date(s + 'T12:00:00').getDay()]})`;
  // o que ainda vai sair do banco: a pagar, sem o que ja saiu e so falta a baixa
  const itens = CP.itens.filter(r => r.sentido === 'PAGAR' && r.valor > 0 && !r.saiuBanco && cpDaLoja(r));
  const grupoDe = (tipo) => CP_GRUPOS.findIndex(g => g[1](tipo));
  const faixas = [['0000-01-01', d(-1), 'Já venceu', 'vencidas e as que aguardam o extrato'], [hoje, hoje, 'Hoje', '']];
  for (let i = 1; i <= 7; i++) faixas.push([d(i), d(i), rotDia(d(i)), '']);
  faixas.push([d(8), d(30), `${ffDdmm(d(8))} a ${ffDdmm(d(30))}`, '']);
  faixas.push([d(31), d(45), `${ffDdmm(d(31))} a ${ffDdmm(d(45))}`, '']);
  const tot = CP_GRUPOS.map(() => 0);
  let totPrev = 0;
  const f = CP.filtros.PAGAR;
  const linhas = faixas.map(([de, ate, rot, dica]) => {
    const v = CP_GRUPOS.map(() => 0);
    let n = 0;
    itens.filter(r => r.vencimento >= de && r.vencimento <= ate).forEach(r => {
      n++;
      r.partes.forEach(p => { v[grupoDe(p.tipo)] -= p.valor; });
    });
    const soma = v.reduce((a, x) => a + x, 0);
    const prev = de < hoje ? 0 : cpPrevistoSemTitulo(de, ate);
    if (n === 0 && de !== hoje && prev < 50) return '';
    v.forEach((x, i) => { tot[i] += x; });
    totPrev += prev;
    const fx = de < hoje ? null : cpFluxoPagar(de, ate);
    const ativa = f.faixa && f.faixa.de === de && f.faixa.ate === ate;
    return `<tr onclick="cpFaixa('${de}','${ate}','${rot}')" style="cursor:pointer;${ativa ? ' outline:2px solid var(--brand);' : ''}" title="${n} conta(s)${dica ? ' · ' + dica : ''} — clique para ver a lista">
      <td><b${de < hoje && soma > 50 ? ' style="color:var(--farol-fora);"' : ''}>${rot}</b> <span style="color:var(--tx-5); font-size:11px;">${n}</span></td>
      <td><b>${cpMil(soma)}</b></td>${v.map(x => `<td>${cpMil(x)}</td>`).join('')}${FXL ? `<td style="color:var(--tx-4);">${cpMil(prev)}</td><td>${de < hoje ? '<span style="color:var(--tx-5); font-size:11px;">no hoje</span>' : `<b>${fx == null ? '—' : cpMil(fx)}</b>`}</td>` : ''}</tr>`;
  }).join('');
  const total = tot.reduce((a, x) => a + x, 0);
  return `
  <div class="section-label">Os próximos dias, por grupo de conta</div>
  <div id="tabelaCpDias" class="cel-cartao"><table>
    <thead><tr><th>Vence</th><th>${FXL ? 'Títulos' : 'Total'}</th>${CP_GRUPOS.map(g => `<th>${g[0]}</th>`).join('')}${FXL ? '<th title="o que o Fluxo prevê e ainda não virou título: mercadoria por fornecedor, motoboys, diaristas, bônus">Previsto sem título</th><th title="o mesmo A pagar do Fluxo projetado nesses dias">A pagar no Fluxo</th>' : ''}</tr></thead>
    <tbody>${linhas}
    <tr style="border-top:2px solid var(--line);"><td><b>Até ${ffDdmm(d(45))}</b></td><td><b>${cpMil(total)}</b></td>${tot.map(x => `<td><b>${cpMil(x)}</b></td>`).join('')}${FXL ? `<td><b>${cpMil(totPrev)}</b></td><td></td>` : ''}</tr></tbody></table></div>
  <div class="caption-label" style="text-align:left;">Em R$ mil. Clique numa linha para ver as contas dela na lista lá embaixo. Pessoas = folha, pró-labore e retiradas.
    Fora: o que já saiu do banco e só falta a baixa no Saipos. ${FXL ? '<b>Previsto sem título</b> = o que o Fluxo prevê e ainda não tem título (mercadoria por fornecedor, motoboys, diaristas, bônus); <b>A pagar no Fluxo</b> = o mesmo total do Fluxo projetado nesses dias (hoje inclui o que já venceu e o que foi pago hoje no Saipos).' : 'O que costuma sair e ninguém lança antes (mercadoria, motoboys, diaristas) não está aqui — está como estimativa no Fluxo projetado.'}</div>`;
}

// as maiores contas ate o dia mais apertado do caixa: cada uma e' uma decisao (adiar, renegociar, conferir)
function cpMaioresAteAperto() {
  const hoje = trHoje();
  let ate = fxSomaDias(hoje, 7), porque = 'nos próximos 7 dias';
  if (CP.temMotor && FXL) {
    const u = cpFxlLoja();
    const pior = FXL.dias.slice(0, 46).reduce((m, d) => (!m || d.unidades[u].saldo_final < m.unidades[u].saldo_final ? d : m), null);
    const v = pior && pior.unidades[u].saldo_final;
    if (pior && v < 0 && pior.dia > hoje) { ate = pior.dia; porque = `até ${ffDdmm(pior.dia)}, o dia mais apertado do caixa (${fxMil(v)})`; }
  } else if (CP.temMotor) {
    const P = projCalc(PROJ_RECEB_LOJA ? CP.loja : '');   // o dia mais apertado DA LOJA escolhida
    if (P.menorSaldo < 0 && P.menorDia > hoje) { ate = P.menorDia; porque = `até ${ffDdmm(P.menorDia)}, o dia mais apertado do caixa (${fxMil(P.menorSaldo)})`; }
  }
  const l = CP.itens.filter(r => r.sentido === 'PAGAR' && r.valor > 0 && !r.saiuBanco && cpDaLoja(r) && r.vencimento <= ate)
    .sort((a, b) => b.valor - a.valor).slice(0, 5);
  if (!l.length) return '';
  return `
  <div class="section-label">As 5 maiores contas ${porque}</div>
  <div id="tabelaCpMaiores" class="cel-cartao"><table>
    <thead><tr><th>Vence</th><th>Valor</th><th>Conta</th><th>Fornecedor</th></tr></thead>
    <tbody>${l.map(r => `<tr><td style="white-space:nowrap;">${ffDdmm(r.vencimento)}</td><td><b>${fmt(r.valor)}</b></td>
      <td style="text-align:left; white-space:normal;">${trEscH(r.descricao.replace(/\s*\(parc\. 100000\/100000\)/, ''))}</td><td style="text-align:left; white-space:normal;">${trEscH(r.fornecedor || '—')}</td></tr>`).join('')}</tbody></table></div>
  <div class="caption-label" style="text-align:left;">Adiar, renegociar ou conferir uma delas é o que muda o caixa nesse período.</div>`;
}

function renderContasPagar() {
  if (CP) cpSinc();
  const alvo = document.getElementById('view-contaspagar');
  if (!alvo || !CP) return;
  // recolhidos: o titulo vai no proprio "abrir" (sem repetir o titulo do bloco por dentro)
  const semTitulo = (h) => h.replace(/<div class="section-label"[^>]*>[\s\S]*?<\/div>/, '');
  const comissao = CP.temMotor ? semTitulo(blocoComissaoAtacado()) : '';
  const bonus = CP.temMotor ? semTitulo(blocoBeneficio()) : '';
  alvo.innerHTML = `
  <div class="section-label" style="border-top:none; margin-top:0; padding-top:0;">Contas a pagar — o que pagar hoje e nos próximos dias · ${cpNomeLoja()}</div>
  ${cpBarra()}
  ${cpCartoes('PAGAR')}
  ${CP.temMotor ? (FXL ? `<div id="cpHojeWrap">${cpHojeLimpo()}</div>` : `<div id="projCaixaWrap">${blocoCaixaDoDia()}</div>`) : ''}
  ${cpProximosDias()}
  ${cpMaioresAteAperto()}
  <div class="section-label">Todas as contas a pagar</div>
  ${cpTabela('PAGAR')}
  ${comissao ? `<details class="detalhes-extra"><summary>Comissão do atacado — ${(() => { const pend = (PROJ_COM_PAG || []).filter(x => ['EM_ABERTO', 'PAGO_DIFERENTE', 'PAGO_SEM_BANCO'].includes(x.situacao)).length;
        return !PROJ_COM_PAG ? 'o valor da semana para lançar no Saipos' : pend ? `<span style="color:var(--amber-2);">${pend} pendência${pend > 1 ? 's' : ''}</span>` : '<span style="color:var(--farol-ok);">✓ tudo pago até a última semana fechada</span>'; })()}</summary>${comissao}</details>` : ''}
  ${bonus ? `<details class="detalhes-extra"><summary>Bônus do iFood — o que vai para a aplicação, semana a semana</summary>${bonus}</details>` : ''}`;
}

// ---- CONTAS A RECEBER — "o que vai entrar, de quem, e quem está atrasado?" (dono, 16/10/2026).
// O que vai entrar vem do MESMO motor do Fluxo projetado (projCalc): a media do que cai na conta, aberta
// pelo tipo de receita, mais o que esta lancado a receber — a coluna "hoje ate D+7" fecha ao centavo
// com o cartao "Entra" do Fluxo. As cobrancas da Agua Verde contra o Ahu e o Sao Braz ficam numa linha
// a parte: na Rede nao e' dinheiro novo (projEntreLojas).
const CR_ROTULO = {
  'RECEITAS ONLINE': ['iFood e pedidos online', 'média das 4 semanas'],
  'RECEITAS CARTAO': ['Cartão na maquininha', 'média das 4 semanas'],
  'RECEITAS DINHEIRO': ['Dinheiro', 'média das 4 semanas'],
  'RECEITAS BOQUEIRAO': ['Boqueirão', 'média das 4 semanas + cobrança lançada'],
  'RECEITAS REVENDA': ['Atacado', 'boletos do ePadoca ou a média, o maior'],
};

function crPorOrigem(P, porTipo) {
  const JAN = [[0, 7], [8, 14], [15, 30]];
  // a media por dia da semana de cada tipo de receita, na MESMA janela e do MESMO jeito do motor
  const datas = P.janelaReceb.map(r => r.data), set = new Set(datas);
  const diasPorDow = {};
  datas.forEach(d => { const w = new Date(d + 'T00:00:00').getDay(); (diasPorDow[w] = diasPorDow[w] || []).push(d); });
  const porSubDia = {};
  (PROJ_RECEB_SUB || []).filter(r => set.has(r.data) && !projForaDaMedia(r.subtipo)).forEach(r => {   // o Boqueirao entra pela provisao mensal (18/10/2026)
    const m = (porSubDia[r.subtipo] = porSubDia[r.subtipo] || {}); m[r.data] = (m[r.data] || 0) + r.recebido;
  });
  const subDow = {};
  Object.keys(porSubDia).forEach(sub => {
    subDow[sub] = {};
    for (let w = 0; w < 7; w++) { const ds = diasPorDow[w] || []; subDow[sub][w] = ds.length ? ds.reduce((s, d) => s + (porSubDia[sub][d] || 0), 0) / ds.length : 0; }
  });
  const linhas = {};   // rotulo -> { v:[3 janelas], como }
  const soma = (rot, como, j, v) => { const x = (linhas[rot] = linhas[rot] || { v: [0, 0, 0], como }); x.v[j] += v; };
  JAN.forEach(([de, ate], j) => {
    for (let i = de; i <= Math.min(ate, P.dias.length - 1); i++) {
      const d = P.dias[i], w = new Date(d + 'T00:00:00').getDay();
      if (i > 0) {
        // a media do dia, sem o atacado (o atacado tem linha propria, pela regra do maior)
        const atMedia = P.atacado ? P.atacado.dow[w] : ((subDow['RECEITAS REVENDA'] || {})[w] || 0);
        let resto = P.mediaDow[w] - atMedia;
        Object.keys(porTipo ? subDow : {}).filter(sub => sub !== 'RECEITAS REVENDA').forEach(sub => {
          const v = subDow[sub][w]; resto -= v;
          const [rot, como] = CR_ROTULO[sub] || ['Outras receitas', 'média das 4 semanas'];
          soma(rot, como, j, v);
        });
        if (Math.abs(resto) > 0.001) soma(porTipo ? 'Outras receitas' : 'Vendas que caem na conta (iFood, cartão, dinheiro)', 'média das 4 semanas', j, resto);
        soma('Atacado', CR_ROTULO['RECEITAS REVENDA'][1], j, atMedia);
      }
      soma('Atacado', CR_ROTULO['RECEITAS REVENDA'][1], j, -(((P.serieSemAtacado || [])[i]) || 0));
      (P.itensDia[d] || []).filter(r => r.origem !== 'BONUS' && r.credito > 0).forEach(r => {
        if (r.origem === 'EPADOCA') soma('Atacado', CR_ROTULO['RECEITAS REVENDA'][1], j, r.credito);
        else if (r.subtipo === 'RECEITAS BOQUEIRAO') soma('Boqueirão', projForaDaMedia(r.subtipo) ? 'provisão mensal no dia 20: a média dos últimos meses ou as listas do mês; a cobrança quando a lista fecha' : CR_ROTULO['RECEITAS BOQUEIRAO'][1], j, r.credito);
        else if (projEntreLojas(r)) soma('Ahú e São Braz (listas e bônus)', r.origem === 'PROVISAO' ? 'provisão pela média das listas; a cobrança quando a lista fecha' : 'cobrança lançada', j, r.credito);   // so aparece na Agua Verde: na Rede fica fora
        else soma(r.subtipo === 'EMPRESTIMOS A FUNCIONARIOS' ? 'Parcelas de empréstimo a funcionários' : 'Outros lançados no Saipos', 'lançado no Saipos', j, r.credito);
      });
    }
  });
  // o que a Agua Verde recebe das filiais: fora da conta da Rede
  const entre = [0, 0, 0];
  (PROJ_PAGAR || []).filter(projEntreLojas).forEach(r => {
    const dia = r.vencimento < P.hojeIso ? P.hojeIso : r.vencimento;
    const i = P.dias.indexOf(dia);
    JAN.forEach(([de, ate], j) => { if (i >= de && i <= ate) entre[j] += r.credito; });
  });
  return { JAN, linhas, entre };
}

let CR_FXL = null;   // 24/10/2026: a tabela "de onde" do Contas a receber, lida do Fluxo limpo

function crFxlAbrir(k) { CP.crAberto = CP.crAberto === k ? null : k; renderContasReceber(); }

function renderContasReceber() {
  if (CP) cpSinc();
  const alvo = document.getElementById('view-contasreceber');
  if (!alvo || !CP) return;
  const hoje = trHoje();
  const reais = (v) => 'R$ ' + fmt(v);
  let topo = '', tabela = '';
  // o que esta atrasado: titulo a receber com o vencimento ja passado (um numero so: cartao e tabela)
  const atrasados = CP.itens.filter(r => r.sentido === 'RECEBER' && r.valor > 0 && r.situacao === 'VENCIDA' && cpDaLoja(r));
  const totAtr = cpSoma(atrasados);
  const filial = (r) => r.origem === 'LISTAS' && /^Filial /.test(r.fornecedor || '');
  const atrFilial = cpSoma(atrasados.filter(filial));
  // 07/11/2026 (auditoria lote 1, dinheiro-13): os cartões mostram só a cobrança LANÇADA; a provisão das listas
  // que ainda não existem (origem PROVISAO) fica no Fluxo projetado.
  const entreLancado = (r) => projEntreLojas(r) && r.origem !== 'PROVISAO';
  const entreAberto = (PROJ_PAGAR || []).filter(entreLancado).reduce((s, r) => s + r.credito, 0);
  // a filial: o que ela deve a Agua Verde (o titulo mora na Agua Verde; do lado da filial e' conta a pagar)
  const SUB_FILIAL = { 'AHU': 'RECEITAS AHU', 'SÃO BRAZ': 'RECEITAS SAO BRAZ' };
  const deveAV = SUB_FILIAL[CP.loja] ? (PROJ_PAGAR || []).filter(r => entreLancado(r) && r.subtipo === SUB_FILIAL[CP.loja]) : [];
  const hojeIso = trHoje();
  if (CP.temMotor && FXL) {
    // 24/10/2026: a MESMA composição do Fluxo limpo, por origem e janela
    const u = CP.loja || 'REDE', ds = FXL.dias, JAN = [[0, 7], [8, 14], [15, 30]];
    const ate7 = ds[Math.min(7, ds.length - 1)].dia;
    const rot = (c) => {
      if (c.origem === 'MEDIA') return ['Vendas pela média (cartão, PIX, dinheiro, site)', 'média do mesmo dia da semana nas últimas 4 semanas, sem o que tem previsão própria'];
      if (c.origem === 'PROVISAO_RECEITA') return /ifood/i.test(c.descricao) ? ['iFood', 'pelo que já foi vendido (repasse de quarta)']
        : /epadoca|atacado/i.test(c.descricao) ? ['Atacado', 'pedido do portal ainda sem boleto (D+2)'] : ['Previsto pelo vendido', 'pelo que já foi vendido'];
      if (c.origem === 'EPADOCA') return ['Atacado', 'boleto do ePadoca'];
      if (/BOQUEIRAO/i.test((c.subtipo || '') + ' ' + (c.descricao || ''))) return ['Boqueirão', 'provisão mensal no dia 20; vira a cobrança quando a lista do mês fecha'];
      if (c.entre_lojas || c.origem === 'LISTAS') return ['Ahú e São Braz (listas e bônus)', 'cobrança lançada ou provisão das listas'];
      if (/EMPRESTIMO/i.test(c.subtipo || '') || /EMPRESTIMO/i.test(c.descricao || '')) return ['Parcelas de empréstimo a funcionários', 'lançado no Saipos · pode não cair'];
      if (c.origem === 'SAIPOS') return ['Outros lançados no Saipos', 'título a receber no Saipos'];
      return [FXL_ORIGEM[c.origem] || String(c.origem || '').toLowerCase(), 'previsto'];
    };
    const linhas = {}, fora = { v: [0, 0, 0], itens: [[], [], []] };
    JAN.forEach(([de, ate], j) => ds.slice(de, ate + 1).forEach((d) => {
      d.unidades[u].composicao.filter((c) => c.lado === 'RECEBER').forEach((c) => {
        const [r, como] = rot(c);
        const x = (linhas[r] = linhas[r] || { v: [0, 0, 0], como, itens: [[], [], []] });
        x.v[j] += c.valor; x.itens[j].push(c);
      });
      if (u === 'REDE') d.unidades['AGUA VERDE'].composicao.filter((c) => c.lado === 'RECEBER' && c.entre_lojas).forEach((c) => { fora.v[j] += c.valor; fora.itens[j].push(c); });
    }));
    CR_FXL = { linhas, fora, u };
    const ordem = Object.entries(linhas).filter(([, x]) => x.v.some((v) => Math.abs(v) > 0.5)).sort((a, b) => (b[1].v[0] + b[1].v[1] + b[1].v[2]) - (a[1].v[0] + a[1].v[1] + a[1].v[2]));
    const totJ = [0, 1, 2].map((j) => ordem.reduce((s, [, x]) => s + x.v[j], 0));
    const entra7 = ds.slice(0, 8).reduce((s, d) => s + d.unidades[u].a_receber, 0);
    console.assert(Math.abs(totJ[0] - entra7) < 0.05, 'Contas a receber: a 1a coluna nao fecha com o A receber do Fluxo');
    const rotJ = JAN.map(([de, ate]) => de === 0 ? `Hoje a ${ffDdmm(ds[Math.min(ate, ds.length - 1)].dia)}` : `${ffDdmm(ds[Math.min(de, ds.length - 1)].dia)} a ${ffDdmm(ds[Math.min(ate, ds.length - 1)].dia)}`);
    const cel = (k, v) => Math.abs(v) < 0.5 ? '<td>—</td>' : `<td><a href="javascript:void(0)" data-fxl="1" onclick="crFxlAbrir('${k}')" style="color:inherit; text-decoration:underline dotted;">${cpMil(v)}</a></td>`;
    topo = `<div class="cards cards-3">
      <div class="card pos" style="cursor:pointer;" onclick="mostrarModulo('projecao')" title="abrir o Fluxo projetado"><div class="card-lbl">A receber até ${ffDdmm(ate7)}</div><div class="card-val">${reais(entra7)}</div>
        <div class="card-pct">títulos + previsto: o mesmo do Fluxo projetado</div></div>
      <div class="card ${totAtr > 0.005 ? 'neg' : 'pos'}" style="cursor:pointer;" onclick="cpFiltro('situacao','VENCIDA')"><div class="card-lbl">Atrasado</div><div class="card-val">${reais(totAtr)}</div>
        <div class="card-pct">${atrasados.length ? `${atrasados.length} título(s)${atrFilial > 0.005 ? ` · ${reais(atrFilial)} das filiais` : ''}` : 'ninguém atrasado'}</div></div>
      ${SUB_FILIAL[CP.loja]
        ? `<div class="card neutral"><div class="card-lbl">Esta loja deve à Água Verde</div><div class="card-val">${reais(deveAV.reduce((s2, r) => s2 + r.credito, 0))}</div>
          <div class="card-pct">listas e bônus já cobrados${deveAV.some(r => r.vencimento < hojeIso) ? ` · ${reais(deveAV.filter(r => r.vencimento < hojeIso).reduce((s2, r) => s2 + r.credito, 0))} atrasado` : ''} · é conta a pagar da loja</div></div>`
        : `<div class="card neutral"><div class="card-lbl">${CP.loja === 'AGUA VERDE' ? 'O Ahú e o São Braz devem a esta loja' : 'As filiais devem à Água Verde'}</div><div class="card-val">${reais(entreAberto)}</div>
          <div class="card-pct">listas e bônus já cobrados · ${CP.loja === 'AGUA VERDE' ? 'já está no "A receber"' : 'na Rede não conta: só troca de bolso'}</div></div>`}
    </div>`;
    let det = '';
    if (CP.crAberto) {
      const [r, j] = CP.crAberto.split('|');
      const x = r === '__fora' ? fora : linhas[r];
      if (x) det = fxlComposicao(x.itens[Number(j)], `${r === '__fora' ? 'Filiais pagam à Água Verde' : r} · ${rotJ[Number(j)]}`);
    }
    tabela = `
    <div class="section-label">O que vai entrar, de onde</div>
    <div id="tabelaCrOrigem"><table>
      <thead><tr><th>De onde</th>${rotJ.map(r => `<th>${r}</th>`).join('')}<th>Como sabemos</th></tr></thead>
      <tbody>${ordem.map(([r, x]) => `<tr><td><b>${r}</b></td>${x.v.map((v, j) => cel(`${r.replace(/'/g, '')}|${j}`, v)).join('')}
        <td style="text-align:left; white-space:normal; color:var(--tx-3); font-size:12px;">${x.como}</td></tr>`).join('')}
      <tr class="liq"><td><b>Total${u === 'REDE' ? ' na Rede' : ''}</b></td>${totJ.map(v => `<td><b>${cpMil(v)}</b></td>`).join('')}<td></td></tr>
      ${u === 'REDE' && fora.v.some(v => v > 0.005) ? `<tr style="opacity:.75;"><td>Filiais pagam à Água Verde <span style="color:var(--tx-5); font-size:11px;">fora da Rede</span></td>${fora.v.map((v, j) => cel(`__fora|${j}`, v)).join('')}
        <td style="text-align:left; white-space:normal; color:var(--tx-3); font-size:12px;">cobrança das listas e do bônus</td></tr>` : ''}</tbody></table></div>
    <div id="crFxlDet">${det}</div>
    <div class="caption-label" style="text-align:left;">Em R$ mil. A primeira coluna é o mesmo "A receber" do Fluxo projetado, hoje até ${ffDdmm(ate7)}. Clique num valor para ver o que o compõe.</div>`;
  } else if (CP.temMotor) {
    const lj = PROJ_RECEB_LOJA ? CP.loja : '';
    const P = projCalc(lj);
    const j7 = projJanela(P, 0, 7);
    const O = crPorOrigem(P, !lj);
    const ordem = Object.entries(O.linhas).filter(([, x]) => x.v.some(v => Math.abs(v) > 0.5)).sort((a, b) => (b[1].v[0] + b[1].v[1] + b[1].v[2]) - (a[1].v[0] + a[1].v[1] + a[1].v[2]));
    const totJ = [0, 1, 2].map(j => ordem.reduce((s, [, x]) => s + x.v[j], 0));
    console.assert(Math.abs(totJ[0] - j7.entra) < 0.05, 'Contas a receber: a 1a coluna nao fecha com o Entra do Fluxo projetado');
    const rotJ = O.JAN.map(([de, ate]) => de === 0 ? `Hoje a ${ffDdmm(P.dias[ate])}` : `${ffDdmm(P.dias[de])} a ${ffDdmm(P.dias[ate])}`);
    topo = `<div class="cards cards-3">
      <div class="card pos" style="cursor:pointer;" onclick="mostrarModulo('projecao')" title="abrir o Fluxo projetado"><div class="card-lbl">Entra até ${ffDdmm(j7.ate)}</div><div class="card-val">${reais(j7.entra)}</div>
        <div class="card-pct">${reais(j7.media)} pela média + ${reais(j7.lancado)} lançado</div></div>
      <div class="card ${totAtr > 0.005 ? 'neg' : 'pos'}" style="cursor:pointer;" onclick="cpFiltro('situacao','VENCIDA')"><div class="card-lbl">Atrasado</div><div class="card-val">${reais(totAtr)}</div>
        <div class="card-pct">${atrasados.length ? `${atrasados.length} título(s)${atrFilial > 0.005 ? ` · ${reais(atrFilial)} das filiais` : ''}` : 'ninguém atrasado'}</div></div>
      ${SUB_FILIAL[CP.loja]
        ? `<div class="card neutral"><div class="card-lbl">Esta loja deve à Água Verde</div><div class="card-val">${reais(deveAV.reduce((s2, r) => s2 + r.credito, 0))}</div>
          <div class="card-pct">listas e bônus já cobrados${deveAV.some(r => r.vencimento < hojeIso) ? ` · ${reais(deveAV.filter(r => r.vencimento < hojeIso).reduce((s2, r) => s2 + r.credito, 0))} atrasado` : ''} · é conta a pagar da loja</div></div>`
        : `<div class="card neutral"><div class="card-lbl">${CP.loja === 'AGUA VERDE' ? 'O Ahú e o São Braz devem a esta loja' : 'As filiais devem à Água Verde'}</div><div class="card-val">${reais(entreAberto)}</div>
          <div class="card-pct">listas e bônus já cobrados · ${CP.loja === 'AGUA VERDE' ? 'já está no "Entra"' : 'na Rede não conta: só troca de bolso'}</div></div>`}
    </div>`;
    tabela = `
    <div class="section-label">O que vai entrar, de onde</div>
    <div id="tabelaCrOrigem"><table>
      <thead><tr><th>De onde</th>${rotJ.map(r => `<th>${r}</th>`).join('')}<th>Como sabemos</th></tr></thead>
      <tbody>${ordem.map(([rot, x]) => `<tr><td><b>${rot}</b></td>${x.v.map(v => `<td>${cpMil(v)}</td>`).join('')}
        <td style="text-align:left; white-space:normal; color:var(--tx-3); font-size:12px;">${x.como}</td></tr>`).join('')}
      <tr style="border-top:2px solid var(--line);"><td><b>Total${lj ? '' : ' na Rede'}</b></td>${totJ.map(v => `<td><b>${cpMil(v)}</b></td>`).join('')}<td></td></tr>
      ${!lj && O.entre.some(v => v > 0.005) ? `<tr style="opacity:.75;"><td>Filiais pagam à Água Verde <span style="color:var(--tx-5); font-size:11px;">fora da Rede</span></td>${O.entre.map(v => `<td>${cpMil(v)}</td>`).join('')}
        <td style="text-align:left; white-space:normal; color:var(--tx-3); font-size:12px;">cobrança das listas e do bônus</td></tr>` : ''}</tbody></table></div>
    <div class="caption-label" style="text-align:left;">Em R$ mil. A primeira coluna é o mesmo "Entra" do Fluxo projetado. <b>Média</b> = o que caiu na conta naquele dia da semana nas últimas 4 semanas —
      é estimativa; lançado e boleto têm data e valor.${projEntraFrase() ? ` Hoje a conta é: ${projEntraFrase()}.` : ''} O boleto do atacado conta no dia em que o dinheiro cai (vencimento + 2 dias).</div>
    ${projProvisaoFrase(lj) ? `<div class="caption-label" style="text-align:left;">${projProvisaoFrase(lj)}</div>` : ''}`;
  }
  // quem esta atrasado, por quem deve
  const porQuem = {};
  atrasados.forEach(r => {
    const k = r.fornecedor || r.descricao;
    const g = porQuem[k] || (porQuem[k] = { n: 0, v: 0, desde: r.vencimento, origem: r.origem, dias: 0 });
    g.n++; g.v += r.valor; if (r.vencimento < g.desde) g.desde = r.vencimento; g.dias = Math.max(g.dias, Number(r.dias_vencida) || 0);
  });
  const quem = Object.entries(porQuem).sort((a, b) => b[1].v - a[1].v);
  const blocoAtraso = `
  <div class="section-label">Quem está atrasado</div>
  ${quem.length ? `<div id="tabelaCrAtraso"><table>
    <thead><tr><th>De quem</th><th>Valor</th><th>Títulos</th><th>Venceu em</th><th>Onde cobrar</th></tr></thead>
    <tbody>${quem.map(([k, g]) => { const og = CP_ORIGEM[g.origem] || { rot: g.origem, baixa: '—' };
      return `<tr><td style="text-align:left; white-space:normal;"><b>${trEscH(k)}</b> <span style="color:var(--tx-5); font-size:11px;">${og.rot}</span></td>
      <td class="negativo"><b>${fmt(g.v)}</b></td><td>${g.n}</td><td>${ffDdmm(g.desde)} · ${g.dias}d</td>
      <td style="text-align:left;">${og.tela ? `<a href="javascript:void(0)" style="color:var(--brand);" onclick="${og.aba ? `sessionStorage.setItem('pesAbaPedida','${og.aba}');` : ''}mostrarModulo('${og.tela}')">${og.baixa} ›</a>` : og.baixa}</td></tr>`; }).join('')}</tbody></table></div>`
    : '<div class="contexto" style="border-color:var(--farol-ok);">Ninguém atrasado. ✔</div>'}`;
  alvo.innerHTML = `
  <div class="section-label" style="border-top:none; margin-top:0; padding-top:0;">Contas a receber — o que vai entrar, de quem, e quem está atrasado · ${cpNomeLoja()}</div>
  ${cpBarra()}
  ${topo}
  ${tabela}
  ${blocoAtraso}
  <div class="section-label">Todos os títulos a receber</div>
  ${cpCartoes('RECEBER')}
  ${cpTabela('RECEBER')}
  <div class="caption-label" style="text-align:left;">Aqui só o que tem título: boletos do atacado, cobranças das filiais e do Boqueirão e o que está lançado a receber no Saipos.
    iFood, cartão e dinheiro não têm título — ${projEntraFrase() ? projEntraFrase() : 'entram pela média'}, na tabela de cima.${PROJ_FORA_MEDIA ? ' A provisão mensal do Boqueirão (origem “Provisão”) é estimativa: vira a cobrança quando a lista do mês fecha e some quando o pagamento entra.' : ''}</div>`;
}

// Quadro semanal do benefício do iFood (comissão zero) — feito para a Hellen:
// quanto cada loja "deixou de pagar" na semana, o que as filiais devem à AV e
// o total que a AV manda para a XP na quarta. Regra do Fabio: não é dinheiro do fluxo.
// Atacado: o que está para receber e quem está atrasado, lido do portal do ePadoca
// (rotina atacado-epadoca-portal, 04/09/2026 — pedido do dono: "placar da inadimplência").
// Os boletos em aberto já entram no fluxo dia a dia (vw_fin_contas_pagar); aqui é o placar.
function blocoAtacadoReceber() {
  const L = PROJ_ATACADO_RECEBER || [];
  if (!L.length) return '';
  const reais = (v) => 'R$ ' + fmt(Number(v || 0));
  const soma = (arr) => arr.reduce((s, r) => s + r.valor, 0);
  const vencidos = L.filter(r => r.dias_atraso > 0), aVencer = L.filter(r => r.dias_atraso <= 0);
  const sete = aVencer.filter(r => r.dias_atraso >= -7);
  const porCliente = {};
  vencidos.forEach(r => { const c = r.cliente.split(' - ')[0]; const g = porCliente[c] || (porCliente[c] = { valor: 0, n: 0, maior: 0 }); g.valor += r.valor; g.n += 1; g.maior = Math.max(g.maior, r.dias_atraso); });
  const lidoEm = L.reduce((m, r) => r.capturado_em > m ? r.capturado_em : m, '');
  const dd = (s) => s ? s.slice(8, 10) + '/' + s.slice(5, 7) : '';
  return `
  <div class="section-label">Atacado — a receber e inadimplência (portal do ePadoca)</div>
  <div class="caption-label" style="text-align:center;">Boletos do atacado em aberto no portal do ePadoca, por vencimento. Prazo padrão 7 dias (Quermesse Bom Retiro 7/14).
    Os boletos já estão somados no fluxo dia a dia acima, no dia em que o dinheiro cai na conta: vencimento + 2 dias (o tempo do repasse; fim de semana e feriado passam para o dia útil seguinte).
    Boleto pago que ainda não caiu continua no fluxo como "pago, aguardando repasse". Ficam de fora os boletos já dados como perda ou pagos por fora do portal —
    lá eles continuam em aberto, então o total do portal pode ser maior. Portal lido em ${lidoEm ? dd(lidoEm) + ' ' + lidoEm.slice(11, 16) : '—'}.</div>
  <div class="cards cards-3">
    <div class="card"><div class="card-lbl">A receber (boletos em aberto)</div><div class="card-val">${reais(soma(L))}</div><div class="card-pct">${L.length} boleto${L.length > 1 ? 's' : ''}</div></div>
    <div class="card"><div class="card-lbl">Vence nos próximos 7 dias</div><div class="card-val">${reais(soma(sete))}</div><div class="card-pct">${sete.length} boleto${sete.length !== 1 ? 's' : ''}</div></div>
    <div class="card ${vencidos.length ? 'neg' : 'pos'}"><div class="card-lbl">Vencido sem pagamento</div><div class="card-val">${reais(soma(vencidos))}</div><div class="card-pct">${vencidos.length ? `${vencidos.length} boleto${vencidos.length > 1 ? 's' : ''} · ${Object.keys(porCliente).length} cliente${Object.keys(porCliente).length > 1 ? 's' : ''}` : 'ninguém atrasado'}</div></div>
  </div>
  ${vencidos.length ? `<div id="tabelaAtacadoInadimplencia"><table>
    <tr><th>Cliente</th><th>Boletos vencidos</th><th>Valor</th><th>Maior atraso</th></tr>
    ${Object.entries(porCliente).sort((a, b) => b[1].valor - a[1].valor).map(([c, g]) => `<tr><td>${c}</td><td>${g.n}</td><td class="negativo">${reais(g.valor)}</td><td>${g.maior} dia${g.maior > 1 ? 's' : ''}</td></tr>`).join('')}
  </table></div>` : ''}`;
}

function blocoBeneficio() {
  if (!PROJ_BENEF || !PROJ_BENEF.sem.length) return '';
  const reais = (v) => 'R$ ' + fmt(Number(v || 0));
  const ddmm = (iso) => iso.slice(8, 10) + '/' + iso.slice(5, 7);
  const semanas = [...new Set(PROJ_BENEF.sem.map(r => r.semana))].sort();
  const pendentes = new Set(PROJ_BENEF.xp.map(r => r.semana));
  // `falta` e o que sobrou da semana depois da TEF que ja saiu; `valor` e a
  // semana inteira. Somar `valor` mostrava a mais quando uma TEF cobriu
  // parte de uma semana — foi o caso de 29/07, que pagou 478,59 da seguinte.
  const totalXp = PROJ_BENEF.xp.reduce((a, r) => a + Number(r.falta ?? r.valor), 0);
  const cobrAbertas = PROJ_BENEF.cobr.filter(c => c.status === 'EM ABERTO');
  const linhas = semanas.map(sem => {
    const rs = PROJ_BENEF.sem.filter(r => r.semana === sem);
    const v = (u) => Number((rs.find(r => r.unidade === u) || {}).beneficio || 0);
    const tot = v('AGUA VERDE') + v('AHU') + v('SÃO BRAZ');
    const fechada = rs.every(r => r.semana_fechada);
    const status = !fechada ? '<span style="color:#8a897e">em andamento</span>'
      : (pendentes.has(sem) ? '<span style="color:#e8b04b;font-weight:700">pendente → XP</span>'
                            : '<span style="color:#3fb950">enviada à XP</span>');
    return `<tr><td>${ddmm(sem)} a ${ddmm(new Date(new Date(sem + 'T12:00:00').getTime() + 6 * 86400000).toISOString())}</td>
      <td style="text-align:right">${reais(v('AGUA VERDE'))}</td><td style="text-align:right">${reais(v('AHU'))}</td>
      <td style="text-align:right">${reais(v('SÃO BRAZ'))}</td><td style="text-align:right;font-weight:700">${reais(tot)}</td>
      <td>${status}</td></tr>`;
  }).join('');
  return `
  <div class="section-label">Bônus de comissão do iFood — o que vai para a XP, semana a semana</div>
  <div class="contexto">A comissão que o iFood deixou de cobrar em cada loja. <b>Da semana de 05/10/2026 em diante: 9,5% da
    venda</b> (itens + entrega − desconto que a loja banca), como o iFood cobra — dá uns 12% a mais.
    <b>Até a semana de 28/09: 9,5% do valor depositado; já foram pagas e não serão refeitas.</b> Pela regra do Fabio,
    <b>não é dinheiro do fluxo</b>: as filiais pagam a parte delas à Água Verde (cobranças abaixo) e a AV manda o
    total para a XP toda quarta. ${totalXp > 0 ? `<b style="color:#e8b04b">Pendente para a XP agora: ${reais(totalXp)}.</b>` : '<b style="color:#3fb950">Nada pendente para a XP.</b>'}</div>
  <div id="tabelaBeneficio" style="overflow-x:auto"><table>
    <thead><tr><th>Semana</th><th style="text-align:right">Água Verde</th><th style="text-align:right">Ahú</th>
    <th style="text-align:right">São Braz</th><th style="text-align:right">Total</th><th>Situação</th></tr></thead>
    <tbody>${linhas}</tbody></table></div>
  ${cobrAbertas.length ? `<div class="contexto" style="margin-top:8px">Cobranças das filiais em aberto: ${cobrAbertas.map(c =>
    `${c.unidade} ${reais(c.valor_total)} (vence ${ddmm(c.vencimento)})`).join(' · ')}.</div>` : ''}`;
}

// ------------------------------------------------------------------
// PAGAR AS CONTAS DO DIA — a hora da Hellen.
// A rotina dela e: concilia, bate os saldos, e AI vai pagar. Nesse momento ela
// precisa de tres respostas que o Projetado agrupava demais (pedido do dono,
// 25/08/2026): o que ja venceu, o que vence hoje, e se o saldo da conta cobre
// isso — para saber se sobra dinheiro para mandar a XP.
// A conta e feita no banco (vw_fin_caixa_do_dia), nao aqui: dia virado pelo
// horario de Sao Paulo, e `sobra` = saldo - vencido - vence hoje.
// SOBRA NEGATIVA NAO E SOBRA MENOR, e falta de caixa — por isso ela grita.
// ------------------------------------------------------------------
function projCaixaLinhas() {
  if (!PROJ_CAIXA) return [];
  return PROJ_CAIXA.filter(r =>
    (!finVazio() || r.unidade === finVazio()) &&
    (!PROJ_FILTRO.conta   || r.conta   === PROJ_FILTRO.conta));
}

function projCaixaFiltrar(campo, valor) {
  PROJ_FILTRO[campo] = valor;
  // redesenha o bloco inteiro (quadro + lista), porque os dois seguem o filtro
  const alvo = document.getElementById('projCaixaWrap');
  if (alvo) alvo.innerHTML = blocoCaixaDoDia();
}

function projCaixaTabela() {
  const reais = (v) => 'R$ ' + fmt(Number(v || 0));
  const linhas = projCaixaLinhas();
  if (!linhas.length) return '<tbody id="projCaixaCorpo"><tr><td colspan="6" style="opacity:.7">Nenhuma conta com esse filtro.</td></tr></tbody>';
  // A REGRA DO DONO (25/09/2026): "a XP so nao deve constar como saldo do fluxo projetado,
  // pois o dinheiro que vai pra la e aplicacao e sai do fluxo de caixa". Ate hoje este Total
  // somava a XP: dizia R$ 1,45 milhao de sobra hoje e +R$ 1,36 milhao na semana, quando o
  // caixa que paga conta tinha R$ 27 mil e fechava a semana em -R$ 62 mil.
  // A linha da XP CONTINUA na tabela, embaixo do total: esta aqui desde 25/08 para a Hellen
  // ver quanto ha aplicado na hora de decidir uma transferencia (script/caixa_do_dia.sql).
  // Do cartao entra so o que VENCE (sai do banco no dia da fatura); o saldo dele nao e dinheiro.
  const aplic = (r) => PROJ_FORA_CAIXA.includes(r.conta);
  const cartao = (r) => String(r.conta || '').startsWith('CREDITO');
  const doDia = linhas.filter(r => !aplic(r));
  const parte = (r, c) => {
    const v = Number(r[c] || 0);
    if (!cartao(r)) return v;
    if (c === 'saldo') return 0;
    if (c === 'sobra_hoje' || c === 'sobra_7_dias') return v - Number(r.saldo || 0);
    return v;
  };
  const soma = (c) => doDia.reduce((s, r) => s + parte(r, c), 0);
  // TOTAL SEM FILTRO = a Rede: o que uma loja tem a receber da outra em ate 7 dias nao e'
  // dinheiro novo (07/10/2026). Com unidade ou conta escolhida, vale para aquela conta.
  const entre7 = (!finVazio() && !PROJ_FILTRO.conta && PROJ_PAGAR)
    ? PROJ_PAGAR.filter(r => projEntreLojas(r) && ['VENCIDA', 'VENCE HOJE', 'PROXIMOS 7 DIAS'].includes(r.situacao))
        .reduce((s, r) => s + Number(r.credito), 0) : 0;
  const linhaConta = (r, fora) => {
    const falta = r.sobra_hoje < -0.005;
    const venc  = r.vencido > 0.005;
    return `<tr${fora ? ' style="opacity:.6"' : ''}>
      <td><b>${r.conta_exibida}</b> <span style="opacity:.55;font-size:11px">${r.unidade || ''}</span></td>
      <td style="text-align:right">${reais(r.saldo)}</td>
      <td style="text-align:right;${venc ? 'color:#f85149;font-weight:700' : 'opacity:.55'}">${venc ? reais(r.vencido) + ` <span style="font-weight:400">(${r.qtd_vencida})</span>` : '—'}</td>
      <td style="text-align:right;${r.vence_hoje > 0.005 ? 'color:#e8b04b;font-weight:700' : 'opacity:.55'}">${r.vence_hoje > 0.005 ? reais(r.vence_hoje) + ` <span style="font-weight:400">(${r.qtd_hoje})</span>` : '—'}</td>
      <td style="text-align:right;font-weight:700;${falta ? 'color:#f85149' : (r.sobra_hoje > 0.005 ? 'color:#3fb950' : '')}">${reais(r.sobra_hoje)}</td>
      <td style="text-align:right;${r.sobra_7_dias < -0.005 ? 'color:#f85149' : 'opacity:.8'}">${reais(r.sobra_7_dias)}</td></tr>`;
  };
  const corpo = doDia.map(r => linhaConta(r, false)).join('');
  const aplicadas = linhas.filter(aplic);
  const fora = aplicadas.length
    ? `<tr><td colspan="6" class="caption-label" style="text-align:left; padding-top:10px;">Aplicação — fora do caixa do dia</td></tr>`
      + aplicadas.map(r => linhaConta(r, true)).join('')
    : '';
  return `<tbody id="projCaixaCorpo">${corpo}
    <tr style="border-top:2px solid #45443f">
      <td><b>Total em conta (paga as contas)</b></td>
      <td style="text-align:right"><b>${reais(soma('saldo'))}</b></td>
      <td style="text-align:right;${soma('vencido') > 0.005 ? 'color:#f85149' : ''}"><b>${reais(soma('vencido'))}</b></td>
      <td style="text-align:right"><b>${reais(soma('vence_hoje'))}</b></td>
      <td style="text-align:right;${soma('sobra_hoje') < -0.005 ? 'color:#f85149' : ''}"><b>${reais(soma('sobra_hoje'))}</b></td>
      <td style="text-align:right"><b>${reais(soma('sobra_7_dias') - entre7)}</b>${entre7 > 0.005 ? `<div style="font-weight:400;font-size:11px;opacity:.7">sem ${reais(entre7)} que uma loja recebe da outra</div>` : ''}</td></tr>${fora}</tbody>`;
}

// A LISTA QUE COMPOE OS NUMEROS DE CIMA. O quadro diz "R$ 41.753,76 vencidos";
// aqui ela ve QUAIS contas sao, por data. Sem isso ela abre o Saipos so para
// descobrir o que somar — que e o trabalho que este modulo existe para tirar.
// So o que ela vai PAGAR: as entradas ficam de fora (a coluna sentido separa).
function projListaContas() {
  if (!PROJ_PAGAR) return '';
  const reais = (v) => 'R$ ' + fmt(Number(v || 0));
  const ddmm = (iso) => iso ? iso.slice(8, 10) + '/' + iso.slice(5, 7) : '—';
  const linhas = PROJ_PAGAR
    .filter(r => r.sentido === 'PAGAR' && Number(r.debito) > 0.005)
    .filter(r => ['VENCIDA', 'VENCE HOJE', 'PROXIMOS 7 DIAS'].includes(r.situacao))
    .filter(r => (!finVazio() || r.unidade === finVazio()) &&
                 (!PROJ_FILTRO.conta   || r.conta   === PROJ_FILTRO.conta))
    // dentro do dia: por CONTA e, na conta, do maior para o menor valor —
    // pedido do dono, 26/08/2026: e a ordem em que se paga (abre uma conta no
    // banco, liquida as maiores primeiro), nao a ordem em que se lancou.
    .sort((a, b) => (a.vencimento || '').localeCompare(b.vencimento || '')
      || (a.conta_exibida || a.conta || '').localeCompare(b.conta_exibida || b.conta || '')
      || Number(b.debito) - Number(a.debito));
  if (!linhas.length) return `<div class="contexto" style="margin-top:10px">Nada a pagar com esse filtro.</div>`;
  const total = linhas.reduce((s, r) => s + Number(r.debito), 0);
  let dataAtual = null;
  const corpo = linhas.map(r => {
    let cabecalho = '';
    if (r.vencimento !== dataAtual) {
      dataAtual = r.vencimento;
      const doDia = linhas.filter(x => x.vencimento === dataAtual);
      const somaDia = doDia.reduce((s, x) => s + Number(x.debito), 0);
      const cor = r.situacao === 'VENCIDA' ? '#f85149' : (r.situacao === 'VENCE HOJE' ? '#e8b04b' : '#a5a49a');
      const rotulo = r.situacao === 'VENCIDA' ? `VENCIDA há ${r.dias_vencida} dia(s)`
                   : (r.situacao === 'VENCE HOJE' ? 'VENCE HOJE' : 'a vencer');
      cabecalho = `<tr style="background:var(--surface)"><td colspan="4" style="border-left:3px solid ${cor}">
        <b style="color:${cor}">${ddmm(dataAtual)} — ${rotulo}</b>
        <span style="opacity:.7">· ${doDia.length} conta(s) · ${reais(somaDia)}</span></td></tr>`;
    }
    return cabecalho + `<tr>
      <td style="padding-left:22px">${r.descricao || ''}</td>
      <td>${r.subtipo || ''}</td>
      <td>${r.conta_exibida || r.conta}</td>
      <td style="text-align:right;font-weight:600">${reais(r.debito)}</td></tr>`;
  }).join('');
  return `
  <div class="section-label" style="margin-top:14px">O que compõe esses valores</div>
  <div class="contexto">Cada conta a pagar, agrupada pela data de vencimento. Segue o mesmo filtro do quadro acima.
    <b>${linhas.length} conta(s), ${reais(total)}</b> até 7 dias.</div>
  <div id="tabelaContasDia" style="overflow-x:auto"><table>
    <thead><tr><th>Descrição</th><th>Categoria</th><th>Conta</th><th style="text-align:right">Valor</th></tr></thead>
    <tbody>${corpo}</tbody></table></div>`;
}

// COMISSAO DO ATACADO — rotina que o dono passou em 26/08/2026: somar o que
// entrou no banco como RECEITAS REVENDA na semana (quinta a quarta), calcular
// 7,5% para a Jane e 7,5% para o Fabio, pagamento no dia seguinte (quinta).
// As linhas semanais fixas no Saipos sao PROVISAO pelo ultimo valor pago; o
// numero daqui e o REAL, que a Hellen lanca por cima — e que o robo vai lancar
// sozinho quando a automacao chegar.
function blocoComissaoAtacado() {
  if (!PROJ_COM_ATACADO || !PROJ_COM_ATACADO.length) return '';
  const reais = (v) => 'R$ ' + fmt(Number(v || 0));
  const ddmm = (iso) => iso ? iso.slice(8, 10) + '/' + iso.slice(5, 7) : '';
  const fech = PROJ_COM_ATACADO.filter(r => r.semana_fechada);
  const aberta = PROJ_COM_ATACADO.find(r => !r.semana_fechada);
  const ult = fech[0];
  if (!ult && !aberta) return '';
  // 10/09/2026: o PIX do iFood Pago chega ao extrato de manha e so vira
  // lancamento no Saipos quando o robo da conciliacao roda (~12h). Nessa
  // janela a base do Saipos fica pela metade; a view ja soma o que esta no
  // banco sem lancamento (no_banco_sem_saipos) e entrega o numero final
  // (comissao_prevista_cada). O quadro mostra o final e avisa o que falta.
  const pend = (r) => Number(r.no_banco_sem_saipos || 0);
  const cada = (r) => pend(r) > 0 ? r.comissao_prevista_cada : r.comissao_jane;
  // O CHECK (16/10/2026): pago no Saipos e saido do banco, por semana e pessoa — a view cruza sozinha a cada carga
  // do Saipos e do extrato (a rotina da conciliacao); ninguem marca nada a mao.
  const comPag = (sem, pessoa) => (PROJ_COM_PAG || []).find(x => x.semana_ini === sem && x.pessoa === pessoa);
  const comTexto = (x) => x.situacao === 'PAGO' ? `pago ${ddmm(x.saiu_banco_em)}`
    : x.situacao === 'PAGO_SEM_BANCO' ? `lançado como pago em ${ddmm(x.lancado_em)}, o PIX não apareceu no extrato`
    : x.situacao === 'PAGO_DIFERENTE' ? (Number(x.diferenca) > 0 ? `pago ${reais(x.pago)}, faltam ${reais(x.diferenca)}` : `pago ${reais(x.pago)}, ${reais(-x.diferenca)} a mais`)
    : x.situacao === 'EM_ABERTO' ? `em aberto, venceu ${ddmm(x.pagamento)}`
    : x.situacao === 'A_PAGAR' ? `a pagar em ${ddmm(x.pagamento)}` : '';
  const COR_COM = { PAGO: 'var(--farol-ok)', PAGO_SEM_BANCO: 'var(--amber-2)', PAGO_DIFERENTE: 'var(--amber-2)', EM_ABERTO: 'var(--farol-fora)', A_PAGAR: 'var(--tx-3)' };
  const comMarca = (sem, pessoa) => {
    const x = comPag(sem, pessoa);
    if (!x || x.situacao === 'EM_ANDAMENTO') return '';
    return `<div style="font-size:11px; font-weight:400; color:${COR_COM[x.situacao] || 'var(--tx-3)'};">${x.situacao === 'PAGO' ? '✓ ' : ''}${comTexto(x)}</div>`;
  };
  // semana que o dono fixou (ex.: 24/09, "ajusta os valores pelo que foi pago") mostra o valor dele
  const comAjuste = (sem, pessoa) => { const x = comPag(sem, pessoa); return x && x.ajuste ? x : null; };
  const comValor = (r, pessoa) => { const x = comAjuste(r.semana_ini, pessoa); return x ? Number(x.devido) : cada(r); };
  const pendCom = (PROJ_COM_PAG || []).filter(x => ['EM_ABERTO', 'PAGO_DIFERENTE', 'PAGO_SEM_BANCO'].includes(x.situacao));
  const ultPaga = ult && ['JANE', 'FABIO'].every(pe => (comPag(ult.semana_ini, pe) || {}).situacao === 'PAGO')
    ? [comPag(ult.semana_ini, 'JANE').saiu_banco_em, comPag(ult.semana_ini, 'FABIO').saiu_banco_em].sort().pop() : null;
  const linhas = PROJ_COM_ATACADO.slice(0, 5).map(r => `<tr>
      <td>${ddmm(r.semana_ini)} a ${ddmm(r.semana_fim)}${r.semana_fechada ? '' : ' <span style="color:#8a897e">(em andamento)</span>'}</td>
      <td style="text-align:right">${reais(r.base_revenda)}${pend(r) > 0 ? `<br><span style="color:#e8b04b;font-size:11px" title="PIX do iFood Pago já no extrato, ainda sem lançamento no Saipos">+ ${reais(pend(r))} no banco</span>` : ''}</td>
      <td style="text-align:right;font-weight:${r.semana_fechada ? 700 : 400}"${comAjuste(r.semana_ini, 'JANE') ? ` title="${trEscH(comAjuste(r.semana_ini, 'JANE').ajuste)}"` : ''}>${reais(comValor(r, 'JANE'))}${comMarca(r.semana_ini, 'JANE')}</td>
      <td style="text-align:right;font-weight:${r.semana_fechada ? 700 : 400}"${comAjuste(r.semana_ini, 'FABIO') ? ` title="${trEscH(comAjuste(r.semana_ini, 'FABIO').ajuste)}"` : ''}>${reais(comValor(r, 'FABIO'))}${comMarca(r.semana_ini, 'FABIO')}</td>
      <td>${ddmm(r.pagamento)}</td></tr>`).join('');
  return `
  <div class="section-label">Comissão do atacado — 7,5% Jane + 7,5% Fabio sobre a revenda</div>
  <div class="contexto">Base: o que entrou no banco como <b>Receitas Revenda</b> na semana (quinta a quarta).
    <b>O número de uma semana só é final na quinta</b> — os valores do último dia entram
    durante a tarde de quarta, e é por isso que o pagamento é na quinta.
    ${ultPaga ? `Última semana fechada (${ddmm(ult.semana_ini)} a ${ddmm(ult.semana_fim)}): <b style="color:var(--farol-ok)">✓ paga</b> à Jane e ao Fabio
      (saiu do banco em ${ddmm(ultPaga)}).` : ''}
    ${pendCom.length ? `<br><b style="color:var(--amber-2)">Pendente:</b> ${pendCom.map(x => `${x.pessoa === 'JANE' ? 'Jane' : 'Fabio'}, semana de ${ddmm(x.semana_ini)} — ${comTexto(x)}`).join(' · ')}.` : ''}
    ${ult && !ultPaga ? `Última semana fechada (${ddmm(ult.semana_ini)} a ${ddmm(ult.semana_fim)}):
    <b>lançar ${reais(cada(ult))} para a Jane e ${reais(cada(ult))} para o Fabio</b>,
    vencimento ${ddmm(ult.pagamento)}. A linha de provisão daquela semana no Saipos deve ser ajustada para esse valor.` : ''}
    ${ult && pend(ult) > 0 ? `<br><b style="color:#e8b04b">Atenção:</b> ${reais(pend(ult))} do iFood Pago já entrou no banco nessa semana e
    ainda não está lançado no Saipos (o robô da conciliação lança por volta do meio-dia). O valor acima já conta com ele;
    no Saipos a base ainda aparece como ${reais(ult.base_revenda)}.` : ''}</div>
  <div id="tabelaComAtacado" style="overflow-x:auto"><table>
    <thead><tr><th>Semana</th><th style="text-align:right">Base revenda</th>
    <th style="text-align:right">Jane (7,5%)</th><th style="text-align:right">Fabio (7,5%)</th><th>Pagar em</th></tr></thead>
    <tbody>${linhas}</tbody></table></div>`;
}

function blocoCaixaDoDia() {
  if (!PROJ_CAIXA || !PROJ_CAIXA.length) return '';
  const reais = (v) => 'R$ ' + fmt(Number(v || 0));
  const totVenc = PROJ_CAIXA.reduce((s, r) => s + Number(r.vencido || 0), 0);
  const qtdVenc = PROJ_CAIXA.reduce((s, r) => s + Number(r.qtd_vencida || 0), 0);
  const totHoje = PROJ_CAIXA.reduce((s, r) => s + Number(r.vence_hoje || 0), 0);
  const qtdHoje = PROJ_CAIXA.reduce((s, r) => s + Number(r.qtd_hoje || 0), 0);
  const faltando = PROJ_CAIXA.filter(r => r.sobra_hoje < -0.005 && !String(r.conta || '').startsWith('CREDITO') && !PROJ_FORA_CAIXA.includes(r.conta));
  const unidades = [...new Set(PROJ_CAIXA.map(r => r.unidade).filter(Boolean))].sort();
  const contas = PROJ_CAIXA.filter(r => !finVazio() || r.unidade === finVazio());
  const sel = 'background:var(--surface-2);border:1px solid var(--line-2);color:inherit;border-radius:6px;padding:5px 8px;font-size:13px';
  return `
  <div class="section-label">Pagar hoje, conta a conta</div>
  <div class="contexto" style="text-align:left; border-color:var(${faltando.length ? '--farol-fora' : '--farol-ok'});">
    ${faltando.length ? `<b style="color:var(--farol-fora)">Sem saldo para pagar o que venceu e vence hoje:</b> ${faltando.map(r =>
      `${r.conta_exibida} (falta ${reais(Math.abs(r.sobra_hoje))})`).join(' · ')}.`
      : '<b>Toda conta do banco tem saldo para o que venceu e vence hoje.</b>'}
  </div>
  <div style="display:flex;gap:10px;align-items:center;margin:8px 0;flex-wrap:wrap">
    <span class="caption-label" style="text-align:left">Conta</span>
    <select id="projCaixaConta" style="${sel}" onchange="projCaixaFiltrar('conta', this.value)">
      <option value="">todas</option>${contas.map(r => `<option value="${r.conta}"${PROJ_FILTRO.conta === r.conta ? ' selected' : ''}>${r.conta_exibida}</option>`).join('')}</select>
  </div>
  <div id="tabelaCaixaDia" style="overflow-x:auto"><table>
    <thead><tr><th>Conta</th><th style="text-align:right">Saldo</th><th style="text-align:right">Vencido</th>
      <th style="text-align:right">Vence hoje</th><th style="text-align:right">Sobra hoje</th>
      <th style="text-align:right">Sobra em 7 dias</th></tr></thead>
    ${projCaixaTabela()}</table></div>
  <div class="caption-label" style="text-align:left">
    <b>Sobra hoje</b> = saldo menos o que já venceu e o que vence hoje. É o que pode ir para a XP.
    O total não soma a XP (aplicação) nem o saldo do cartão — do cartão entra só a fatura que vence.
    <b>Sobra em 7 dias</b> considera também o que vence e o que entra na semana. <b>Vencido</b> inclui o que ainda aguarda o extrato.
  </div>`;
}

// ------------------------------------------------------------------
// SALDO DIA A DIA (dono, 10/10/2026: "qual a projeção do saldo dia a dia até 21/10, isso que
// preciso ver claramente no fluxo projetado"). Uma linha por dia, de hoje ate o SEGUNDO repasse
// de quarta. ESTE BLOCO NAO FAZ CONTA: tudo vem de projCalc(), o motor dos cartoes e do grafico —
// o saldo de cada linha E' o ponto do grafico naquele dia. No seletor de loja o MESMO motor roda
// so com as contas, os titulos e os recebimentos daquela loja; as tres lojas somadas so diferem
// da Rede pelo que uma loja deve a outra (projEntreLojas), que na Rede nao e' dinheiro novo.
// Por LOJA, e nao por conta de banco: a conta da folha e o cartao sao pagos pela conta principal
// da loja, e a transferencia entre elas nao esta lancada antes — conta sozinha mentiria.
// ------------------------------------------------------------------
function projDiaPintar() { const a = document.getElementById('projDiaWrap'); if (a) a.innerHTML = blocoSaldoDiaADia(); }

function projDiaAbrir(dIso) { PROJ_DIA.aberto[dIso] = !PROJ_DIA.aberto[dIso]; projDiaPintar(); }

function blocoSaldoDiaADia() {
  if (!PROJ_PAGAR || !PROJ_RECEB) return '';
  const loja = PROJ_RECEB_LOJA ? finVazio() : '';   // sem a receita por loja, so a Rede
  const P = projCalc(loja);
  const nomeLoja = lojaNome(loja || 'REDE');
  const SEM = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb'];
  const dm = (s) => s.slice(8, 10) + '/' + s.slice(5, 7);
  const dow = (s) => new Date(s + 'T00:00:00').getDay();
  const rot = (s) => `${dm(s)} (${SEM[dow(s)]})`;
  const reais = (v) => (v < -0.005 ? '−' : '') + 'R$ ' + fmt(Math.abs(v));   // negativo sempre com o sinal na frente
  const bonusDia = P.bonusDia || {};   // so existe quando o bonus entra no motor (fase 3)
  // a ESTIMATIVA do que costuma sair e ninguem lanca antes (vem do banco, pelo motor); sem ela o bloco fica como era
  const temCostuma = !!P.costumaDia;
  const costumaDia = P.costumaDia || {};
  const reaisInt = (v) => (v < -0.5 ? '−' : '') + 'R$ ' + fxInt(Math.abs(v));   // estimativa vai sem centavos
  const PECAS_EST = [['MERCADORIA', 'mercadoria que ainda não está lançada'], ['MOTOBOYS', 'motoboys'], ['DIARISTAS', 'diaristas'],
                     ['RESTO', 'o resto (rescisão, complemento de salário, férias, manutenção e outros)']];

  // de hoje ate o SEGUNDO repasse de quarta: de 9 a 15 linhas
  let fim = 0;
  for (let i = 1, quartas = 0; i < P.dias.length && quartas < 2; i++) { if (dow(P.dias[i]) === 3) quartas++; fim = i; }
  const jan = P.dias.slice(0, fim + 1).map((d, i) => ({ d, i, saldo: P.serieSaldo[i],
    costuma: temCostuma ? P.serieCostuma[i] : null, ritmo: temCostuma ? P.serieRitmo[i] : null }));
  const ultimo = jan[jan.length - 1].d;
  const pior = jan.reduce((a, b) => (b.saldo < a.saldo ? b : a));
  const volta = jan.find(x => x.d > pior.d && x.saldo >= 0);
  const fechado = (s) => dow(s) === 0 || dow(s) === 6 || !!PROJ_FERIADOS[s];
  const uteis = jan.filter(x => !fechado(x.d));
  const uteisNeg = uteis.filter(x => x.saldo < -0.005).length;

  // a frase: o pior dia e quando volta ao azul
  // na Rede, quando o pior dia daqui e' o mesmo "menor saldo" do topo da tela, nao repetir o numero
  const repete = !loja && pior.d === P.menorDia && Math.abs(pior.saldo - P.menorSaldo) < 0.01;
  const frase = pior.saldo < -0.005
    ? `${repete ? '' : `<b style="font-size:15px;">Pior dia: ${rot(pior.d)}, com ${reais(pior.saldo)}.</b>`}
       ${volta ? `Volta ao azul em <b>${rot(volta.d)}</b>.` : `<b>Não volta ao azul até ${rot(ultimo)}.</b>`}
       Fecha no negativo em ${uteisNeg} dos ${uteis.length} dias úteis até ${dm(ultimo)}.`
    : `<b style="font-size:15px;">Não fica negativo até ${rot(ultimo)}.</b>
       Dia mais apertado: ${rot(pior.d)}, com ${reais(pior.saldo)}.`;
  // a mesma pergunta com a ESTIMATIVA do que costuma sair. Dois numeros = do saldo com a estimativa menor de saida ao
  // saldo com a maior; cada ponta tem o SEU pior dia (podem ser dias diferentes).
  const piorC = temCostuma ? jan.reduce((a, b) => (b.costuma < a.costuma ? b : a)) : null;   // com a estimativa maior
  const piorR = temCostuma ? jan.reduce((a, b) => (b.ritmo < a.ritmo ? b : a)) : null;       // com a estimativa menor
  const voltaC = piorC ? jan.find(x => x.d > piorC.d && x.costuma >= 0) : null;
  const fraseCostuma = !piorC ? '' : `<div style="margin-top:6px;"><b>Com o que costuma sair</b> <span style="color:var(--amber-2);">estimativa</span>:
       ${piorC.costuma < -0.005
         ? `${Math.abs(piorR.ritmo - piorC.costuma) < 500 ? `pior dia ${rot(piorC.d)}, com ${fxMil(piorC.costuma)}`
              : (piorR.d === piorC.d ? `pior dia ${rot(piorC.d)}, de ${fxMil(piorR.ritmo)} a ${fxMil(piorC.costuma)}`
                                     : `no pior dia, ${fxMil(piorR.ritmo)} em ${dm(piorR.d)} ou ${fxMil(piorC.costuma)} em ${dm(piorC.d)}`)}.
            ${voltaC ? `Volta ao azul em <b>${rot(voltaC.d)}</b>.` : `<b>Não volta ao azul até ${rot(ultimo)}.</b>`}`
         : `não fica negativo até ${rot(ultimo)}; dia mais apertado ${rot(piorC.d)}, com ${fxMil(piorC.costuma)}.`}</div>`;

  const seletor = finSoRede();

  // de onde parte: o mesmo "Caixa operacional hoje" do cartao (na Rede), conta a conta ao passar o mouse
  const partidaTxt = P.partida.map(c => `${c.conta}: ${fmt(c.saldo)}${c.doBanco ? '' : ' (pelo Saipos)'}`).join(' · ');
  const linhaPartida = `<tr title="${trEscH(partidaTxt)}">
      <td><b>Caixa agora</b> <span style="color:var(--tx-5); font-size:11px;">${P.temAncora && P.dataExtrato ? 'extrato do banco de ' + dm(P.dataExtrato) : 'pelo Saipos'}</span></td>
      <td></td><td></td>
      <td style="font-weight:700; color:var(${P.caixaOper < -0.005 ? '--farol-fora' : '--farol-ok'});">${reais(P.caixaOper)}</td>${temCostuma ? '<td></td>' : ''}</tr>`;

  const nome = (r) => trEscH((r.origem === 'BONUS' ? 'Bônus do iFood guardado — ' : '') + (r.descricao || r.subtipo || '').slice(0, 60));
  const item = (txt, v, conta) => `<div style="display:flex; justify-content:space-between; gap:10px; padding:2px 0; font-size:12px;">
      <span>${txt}${conta && !loja ? ` <span style="color:var(--tx-5);">· ${trEscH(conta)}</span>` : ''}</span>
      <span style="white-space:nowrap; color:var(${v > 0 ? '--farol-ok' : '--tx-2'});">${v > 0 ? '+' : '−'} ${reais(Math.abs(v))}</span></div>`;

  const linhas = jan.map(({ d, i, saldo }) => {
    const media = P.serieMedia[i], rec = P.receberDia[d] || 0, bonus = bonusDia[d] || 0, est = costumaDia[d] || {};
    const semAtac = (P.serieSemAtacado || [])[i] || 0;   // atacado que a media e os boletos contariam duas vezes neste dia (o motor ja tirou do saldo)
    const dicaEst = PECAS_EST.filter(([k]) => (est[k] || 0) > 0.5).map(([k, n]) => `${n.split(' (')[0]}: ${reaisInt(est[k])}`).join(' · ');
    const sai = (P.pagarDia[d] || 0) + bonus;
    const itens = (P.itensDia[d] || []).slice().sort((a, b) => (b.debito - b.credito) - (a.debito - a.credito));
    const saidas = itens.filter(r => r.debito > r.credito), entradas = itens.filter(r => r.credito > r.debito);
    const dica = saidas.slice(0, 3).map(r => `${(r.descricao || r.subtipo || '').slice(0, 40)}: ${reais(r.debito - r.credito)}`).join(' · ');
    const marcas = [];
    if (i === 0) marcas.push(P.vencidas > 0.005 ? `hoje · com ${reais(P.vencidas)} já vencidos` : 'hoje');
    if (PROJ_FERIADOS[d]) marcas.push('feriado · banco fechado');
    else if (dow(d) === 3 && i > 0) marcas.push('dia do repasse do iFood');
    const ePior = d === pior.d && pior.saldo < -0.005;
    const detalhe = !PROJ_DIA.aberto[d] ? '' : `<tr><td colspan="${temCostuma ? 5 : 4}" style="text-align:left; white-space:normal; padding:8px 12px 10px 22px; color:var(--tx-3);">
        ${media > 0.005 ? item(projEntraFrase() ? `Entrada estimada — ${SEM[dow(d)]}: ${projEntraFrase()}` : `Entrada pela média — ${SEM[dow(d)]}, 4 semanas`, media, '') : ''}
        ${semAtac > 0.005 ? item(`Atacado que a média e os boletos contariam duas vezes <span style="color:var(--tx-5);">· vale o maior dos dois, somado desde hoje</span>`, -semAtac, '') : ''}
        ${entradas.map(r => item(nome(r), r.credito - r.debito, r.conta_exibida)).join('')}
        ${saidas.slice(0, 15).map(r => item(nome(r), r.credito - r.debito, r.conta_exibida)).join('')}
        ${saidas.length > 15 ? item(`e mais ${saidas.length - 15} conta(s) menores`, -saidas.slice(15).reduce((s, r) => s + r.debito - r.credito, 0), '') : ''}
        ${media <= 0.005 && !itens.length ? 'Nada lançado para este dia.' : ''}
        ${PECAS_EST.filter(([k]) => (est[k] || 0) > 0.5).map(([k, n]) => item(`<span style="color:var(--amber-2);">estimativa</span> — ${n}`, -est[k], '')).join('')}
      </td></tr>`;
    return `<tr id="proj-sd-${d}" onclick="projDiaAbrir('${d}')" style="cursor:pointer;${fechado(d) && i > 0 ? ' opacity:.7;' : ''}">
        <td><b>${rot(d)}</b>${marcas.length ? ` <span style="color:var(--tx-5); font-size:11px;">${marcas.join(' · ')}</span>` : ''}${ePior ? ` <b style="color:var(--farol-fora); font-size:11px;">pior dia</b>` : ''}</td>
        <td>${media + rec - semAtac > 0.005 ? reais(media + rec - semAtac) : '—'}</td>
        <td title="${trEscH(dica)}">${sai > 0.005 ? reais(sai) : '—'}${bonus > 0.005 ? `<div style="font-size:11px; color:var(--amber-2);">com ${reais(bonus)} de bônus para a XP</div>` : ''}</td>
        <td style="font-weight:700; color:var(${saldo < -0.005 ? '--farol-fora' : '--farol-ok'});">${reais(saldo)}</td>${temCostuma
          ? `<td title="${trEscH(dicaEst ? 'Estimativa do dia — ' + dicaEst : 'Sem estimativa para este dia')}" style="font-weight:700; color:var(${jan[i].costuma < -0.005 ? '--farol-fora' : '--farol-ok'});">${reaisInt(jan[i].costuma)}</td>` : ''}</tr>${detalhe}`;
  }).join('');

  // avisos de UMA linha, so quando o caso acontece
  const avisos = [];
  jan.filter(x => PROJ_FERIADOS[x.d] && dow(x.d) >= 1 && dow(x.d) <= 5).forEach(x =>
    avisos.push(`<b>${rot(x.d)} é feriado</b> (${trEscH(PROJ_FERIADOS[x.d])}): banco fechado — boleto e depósito desse dia passam para o dia útil seguinte.`));
  const bonusJan = jan.reduce((s, x) => s + (bonusDia[x.d] || 0), 0);
  const pendXp = ((PROJ_BENEF && PROJ_BENEF.xp) || []).reduce((s, r) => s + Number(r.falta != null ? r.falta : r.valor), 0);
  if (P.bonusDia) {
    if (bonusJan > 0.005) avisos.push(`Conta com ${reais(bonusJan)} de bônus do iFood para a XP nas quartas; a semana que ainda não fechou é estimativa.`);
  } else if (pendXp > 0.005 && loja !== 'AHU' && loja !== 'SÃO BRAZ') {
    avisos.push(`<b style="color:var(--amber-2);">Ainda não desconta o bônus do iFood para a XP:</b> ${reais(pendXp)} já fechados, mais a semana em curso, na quarta.`);
  }
  // a filial nao tem, do lado dela, a conta do que deve a Agua Verde (so existe o a receber na AV)
  const SUB_FILIAL = { 'AHU': 'RECEITAS AHU', 'SÃO BRAZ': 'RECEITAS SAO BRAZ' };
  if (SUB_FILIAL[loja]) {
    const deve = PROJ_PAGAR.filter(r => projEntreLojas(r) && r.subtipo === SUB_FILIAL[loja]);
    const tot = deve.reduce((s, r) => s + r.credito, 0);
    if (tot > 0.005) avisos.push(`Fora desta conta: ${reais(tot)} que a loja deve à Água Verde pelas listas e pelo bônus (vence ${dm(deve.map(r => r.vencimento).sort()[0])}).`);
  }
  if (loja === 'AGUA VERDE') {
    const recebe = PROJ_PAGAR.filter(r => projEntreLojas(r) && r.vencimento <= ultimo).reduce((s, r) => s + r.credito, 0);
    if (recebe > 0.005) avisos.push(`Conta com ${reais(recebe)} que o Ahú e o São Braz pagam à Água Verde até ${dm(ultimo)}.`);
  }
  if (loja === 'AGUA VERDE') avisos.push('Água Verde = Itaú AV + conta da folha + Santander + cofre (a conta da folha e o cartão são pagos pelo Itaú AV).');
  // atacado sem contar em dobro: a regra em UMA frase, com os dois numeros (do motor)
  if (P.atacado && projPeca('ATACADO_EPADOCA')) {
    avisos.push('<b>O atacado vem do ePadoca:</b> boleto lançado entra no dia em que o dinheiro cai; pedido do portal ainda sem boleto entra em D+2. Nunca os dois.');
  } else if (P.atacado && P.atacado.fora > 0.005) {
    avisos.push(`<b>O atacado não conta duas vezes:</b> de hoje até cada dia, a projeção soma o que for maior — os boletos a receber (${reais(P.atacado.boletos)}) ou o que costuma entrar de atacado pela média (${fxMil(P.atacado.semana)} por semana). Nunca os dois.`);
  }
  // o Boqueirao fora da media, provisao mensal no dia 20 (18/10/2026): na Rede e na loja que recebe (a mesma frase do Contas a receber)
  const provisaoTxt = projProvisaoFrase(loja);
  if (provisaoTxt) avisos.push(provisaoTxt);
  // saldo de partida do meio do dia: quanto o Saipos ja tem pago que o extrato ainda nao mostra (o numero vem do banco,
  // de vw_fin_pago_fora_do_extrato). So aviso: o saldo de partida e a regra "ja saiu do banco" nao mudam. Vai primeiro na lista.
  const DE_QUEM = { 'AGUA VERDE': 'da Água Verde', 'AHU': 'do Ahú', 'SÃO BRAZ': 'do São Braz' };
  const foraExt = projForaDoExtrato(loja);
  if (foraExt && foraExt.total > 0.005) {
    const lojasFora = Object.keys(foraExt.porLoja);
    const deQuem = loja ? `${DE_QUEM[loja] || 'desta loja'} e da Rede`
      : (lojasFora.length === 1 ? `${DE_QUEM[lojasFora[0]] || 'da loja'} e da Rede`
        : `da Rede (${lojasFora.map(u => `${lojaNome(u)} ${reais(foraExt.porLoja[u])}`).join(' · ')})`);
    avisos.unshift(projForaDoExtratoFrase(foraExt, deQuem));
  }
  if (temCostuma && PROJ_COSTUMA_INFO) {
    // extrato atrasado: dizer ate que dia o saldo de partida enxerga (conta com extrato de antes do ultimo dia util)
    let ultUtil = fxSomaDias(P.hojeIso, -1);
    while (fechado(ultUtil)) ultUtil = fxSomaDias(ultUtil, -1);
    const atrasadas = P.partida.filter(c => c.dataSaldo && c.dataSaldo < ultUtil);
    if (atrasadas.length) avisos.push(`<b style="color:var(--amber-2);">Saldo de partida com extrato antigo:</b> ${atrasadas.map(c => `${trEscH(c.conta)} até ${dm(c.dataSaldo)}`).join(' · ')}. O que entrou ou saiu depois disso e antes de hoje não está nesta conta.`);
    // quanto cada peca costuma somar por semana (o numero que a view devolve), para conferir de cabeca
    const lojasInfo = loja ? [loja] : Object.keys(PROJ_COSTUMA_INFO);
    const porSem = (k) => lojasInfo.reduce((s, u) => s + (((PROJ_COSTUMA_INFO[u] || {}).porSemana || {})[k] || 0), 0);
    const info0 = PROJ_COSTUMA_INFO[lojasInfo[0]] || {};
    const jn = info0.janela;
    const pagoDe = jn ? ` (pago de ${dm(jn[0])} a ${dm(jn[1])})` : '';
    avisos.push(`Costuma sair por semana${pagoDe}: mercadoria ${fxMil(porSem('MERCADORIA'))} · motoboys ${fxMil(porSem('MOTOBOYS'))} · diaristas ${fxMil(porSem('DIARISTAS'))}. A coluna usa a estimativa maior de saída; onde aparecem dois números, vão da menor à maior.`);
    // a filial: a coluna nova NAO tem o que a loja costuma pagar a Agua Verde pela lista e pelo bonus. O numero vem do
    // banco e so conta o que casa dos dois lados (saiu da filial e entrou na Agua Verde, mesmo dia e mesmo valor)
    if (SUB_FILIAL[loja] && info0.pagaAV > 0.005) avisos.push(`<b style="color:var(--amber-2);">Fora da coluna “Com o que costuma sair”:</b> o que a loja costuma pagar à Água Verde pela lista e pelo bônus — ${fxMil(info0.pagaAV)} por semana${pagoDe}.`);
    // HOJE: o extrato de hoje ja fechou o dia (a estimativa de hoje sai) ou e' do meio do dia (a estimativa fica, e a tela diz)
    const estHoje = (costumaDia[P.hojeIso] || {}).cheia || 0;
    if (P.costumaForaHoje > 0.5) avisos.push(`O extrato de hoje já fechou o dia: a estimativa de hoje (${fxMil(P.costumaForaHoje)}) ficou de fora, para não contar duas vezes o que já saiu.`);
    else if (P.extratoParcialHoje && estHoje > 0.5) avisos.push(`<b style="color:var(--amber-2);">O extrato de hoje é do meio do dia:</b> a estimativa de hoje (${fxMil(estHoje)}) continua na conta. O que já saiu hoje pode estar contado duas vezes: por esse lado, o saldo de hoje pode estar pior do que o real.`);
    // titulo a pagar sem classificacao no plano de contas: esta no saldo, mas nao abate a estimativa
    const semClasse = PROJ_PAGAR.filter(r => (!loja || r.unidade === loja) && r.debito > 0 && (r.natureza === 'SEM CLASSIFICACAO' || r.tipo === 'SEM CLASSIFICACAO'))
      .reduce((s, r) => s + r.debito, 0);
    if (semClasse > 0.005) avisos.push(`<b style="color:var(--amber-2);">${reais(semClasse)} a pagar sem classificação no Saipos:</b> estão no saldo, mas não abatem a estimativa — pode estar contando duas vezes. Classificar no Saipos.`);
  }
  if (loja) avisos.push('Só este bloco muda de loja; o resto da tela continua da Rede.');
  avisos.push('O quadro "Pagar hoje, conta a conta" (em Contas a pagar) não conta o que entra na semana: por isso a "sobra em 7 dias" de lá é bem menor que o saldo daqui.');

  return `
  <div class="section-label">Saldo dia a dia até ${dm(ultimo)} — ${nomeLoja}</div>
  ${!loja ? '' : `<div class="contexto" style="text-align:left; border-color:var(${pior.saldo < -0.005 || (piorC && piorC.costuma < -0.005) ? '--farol-fora' : '--farol-ok'});">${frase}${fraseCostuma}</div>`}
  ${seletor}
  <div id="tabelaSaldoDia"><table>
    <thead><tr><th>Dia</th><th>Entra</th><th>Sai</th><th>Saldo no fim do dia</th>${temCostuma ? '<th>Com o que costuma sair <span style="font-weight:400; color:var(--amber-2);">estimativa</span></th>' : ''}</tr></thead>
    <tbody>${linhaPartida}${linhas}</tbody></table></div>
  <div class="caption-label" style="text-align:left;">
    <b>Entra</b> = ${projEntraFrase() ? projEntraFrase() : 'média do que caiu na conta nesse dia da semana (4 semanas)'} + o que está lançado a receber.
    ${temCostuma
      ? `<b>Sai</b> e <b>Saldo</b> = só as contas já lançadas. <b>Com o que costuma sair</b> = o mesmo saldo menos a <b>estimativa</b> do que sai todo mês e ninguém lança antes: ${projPeca('MERCADORIA_NF') ? 'mercadoria por fornecedor (a compra de cada semana, no vencimento de cada um; quando a NF entra, ela substitui a previsão), motoboys e diaristas (média das 4 últimas semanas pagas)' : 'mercadoria, motoboys e diaristas (média das 4 últimas semanas pagas)'} e o resto (média de 3 meses), sempre descontado o que já está lançado. Clique no dia para ver as contas.`
      : `<b>Sai</b> = contas já lançadas (compra que ainda não chegou, motoboy e diária dos próximos dias não entram). Clique no dia para ver as contas.`}
    ${avisos.length ? `<details style="margin-top:6px;"><summary style="cursor:pointer;">${avisos.length} ${avisos.length === 1 ? 'aviso' : 'avisos'} sobre esta conta</summary>
      ${avisos.map(a => `<div style="margin-top:4px;">${a}</div>`).join('')}</details>` : ''}
  </div>
  ${projFaixaLimite(loja)}`;
}

// ------------------------------------------------------------------
// BONUS DO IFOOD QUE VAI PARA A APLICACAO, como saida de quarta (passo 2 do plano das telas;
// dono, 01/10 e 10/10/2026: vai toda semana, de qualquer forma — nunca condicionar ao saldo).
// NAO calcula bonus: le o que a tela ja baixa. FATO = semana fechada e ainda nao enviada
// (vw_beneficio_xp_pendente, coluna falta): sai na quarta do repasse dela ou, se essa ja passou,
// na proxima quarta. ESTIMATIVA = a semana em curso e as seguintes, pelo ritmo_semanal de
// vw_beneficio_ifood_farol (o numero do aviso dos R$ 500 mil) — ou o que a semana ja apurou, se
// for maior — ate acabar o `restante` da isencao (quando ela acaba, o bonus para de sair).
// ------------------------------------------------------------------
function projBonusQuartas(hojeIso, horizonte) {
  // O PREVISTO NUM LUGAR SO (16/10/2026): a conta mora no banco (fin_bonus_previsto, a mesma regra que estava aqui).
  // O calculo abaixo fica so de reserva, para quando a leitura falhar.
  if (PROJ_BONUS_PREV) {
    const fimIso = fxSomaDias(hojeIso, horizonte);
    return PROJ_BONUS_PREV.filter(r => r.dia <= fimIso)
      .map(r => ({ dia: r.dia, v: Number(r.valor), estimativa: !!r.estimativa, txt: r.texto.replace(/^semana /, 'semana ') }));
  }
  const B = PROJ_BENEF;
  if (!B) return [];
  const out = [];
  const dm = (s) => s.slice(8, 10) + '/' + s.slice(5, 7);
  let proxQuarta = hojeIso;
  while (new Date(proxQuarta + 'T12:00:00').getDay() !== 3) proxQuarta = fxSomaDias(proxQuarta, 1);   // quarta (dono, 29/10/2026)
  const fimIso = fxSomaDias(hojeIso, horizonte);
  const pend = new Set();
  (B.xp || []).forEach(r => {
    pend.add(r.semana);
    const quarta = r.repasse_quarta ? r.repasse_quarta : fxSomaDias(r.semana, 9);   // a quarta (dono, 29/10/2026; antes quinta)
    const v = Number(r.falta != null ? r.falta : r.valor);
    if (v > 0.005) out.push({ dia: quarta > proxQuarta ? quarta : proxQuarta, v, estimativa: false,
                              txt: `semana de ${dm(r.semana)}, já fechada e ainda não enviada` });
  });
  const total = {}, fechada = {};
  (B.sem || []).forEach(r => {
    total[r.semana] = (total[r.semana] || 0) + Number(r.beneficio || 0);
    fechada[r.semana] = (r.semana in fechada ? fechada[r.semana] : true) && !!r.semana_fechada;
  });
  const ult4 = Object.keys(total).filter(s => fechada[s]).sort().slice(-4);
  const ritmo = PROJ_RITMO_BONUS && PROJ_RITMO_BONUS.ritmo > 0 ? PROJ_RITMO_BONUS.ritmo
    : (ult4.length ? ult4.reduce((s, x) => s + total[x], 0) / ult4.length : 0);
  let resta = PROJ_RITMO_BONUS ? PROJ_RITMO_BONUS.restante : Infinity;
  // o bonus sai na QUARTA = a segunda da semana + 9 dias (dono, 29/10/2026; a mesma regra de fin_bonus_previsto no banco)
  for (let seg = fxSegunda(hojeIso); fxSomaDias(seg, 9) <= fimIso; seg = fxSomaDias(seg, 7)) {
    if (pend.has(seg) || fechada[seg]) continue;   // ja entrou como fato, ou ja foi enviada
    const jaApurado = total[seg] || 0;
    const falta = Math.min(Math.max(ritmo - jaApurado, 0), Math.max(resta, 0));
    resta -= falta;
    if (jaApurado + falta > 0.005) out.push({ dia: fxSomaDias(seg, 9), v: jaApurado + falta, estimativa: true,
                                              txt: `semana de ${dm(seg)} (estimativa pelo ritmo das últimas semanas)` });
  }
  return out;
}

// ------------------------------------------------------------------
// O QUE COSTUMA SAIR E NINGUEM LANCA ANTES (passo 6 do plano das telas; dono, 10/10/2026: "pode sim incluir
// todas as projecoes de despesas"). A conta NAO e' feita aqui: quem calcula e' o banco, na view
// vw_fin_saida_costuma_sair (mercadoria, motoboys e diaristas pela media das 4 ultimas semanas pagas; "o resto"
// pela media de 3 meses; sempre menos o que ja esta lancado, nunca negativo). A tela so SOMA, dia a dia, por cima
// do saldo lancado. '' = Rede = as lojas todas somadas (o que uma loja paga a outra nao esta na view).
// Devolve { dias: { 'AAAA-MM-DD': { cheia, ritmo, MERCADORIA, MOTOBOYS, DIARISTAS, RESTO } }, foraHoje } ou null
// (view nao instalada). cheia = a estimativa MAIOR de saida (cada conta completa o que costuma somar);
// ritmo = a MENOR (titulo lancado acima do costume abate o que falta).
// REDE = TODAS as lojas com conta de caixa: se a view nao trouxe alguma (login que so ve a propria loja), a Rede
// fica SEM a coluna — soma pela metade nao aparece como se fosse a Rede.
// HOJE SEM DOBRO: a estimativa de hoje de uma loja so fica de fora quando o extrato de HOJE ja FECHOU o dia em todas
// as contas de banco dela (lojasFechadasHoje, que vem do motor) — ai o que saiu hoje ja esta no saldo. Com extrato do
// MEIO do dia a estimativa de hoje FICA inteira (lado prudente). O que ficou de fora volta em foraHoje.
// ------------------------------------------------------------------
function projCostumaDia(unidade, hojeIso, lojasFechadasHoje) {
  if (!PROJ_COSTUMA) return null;
  const lojas = unidade ? [unidade] : [...new Set((DFC_CONTAS_RAW || [])
    .filter(c => c.unidade && !c.conta.startsWith('CREDITO') && !PROJ_FORA_CAIXA.includes(c.conta)).map(c => c.unidade))];
  if (!lojas.length || lojas.some(u => !PROJ_COSTUMA[u])) return null;
  const dias = {};
  let foraHoje = 0;
  lojas.forEach(u => Object.keys(PROJ_COSTUMA[u]).forEach(dia => {
    const x = PROJ_COSTUMA[u][dia];
    if (dia === hojeIso && lojasFechadasHoje && lojasFechadasHoje.has(u)) { foraHoje += x.cheia; return; }
    const s = (dias[dia] = dias[dia] || { cheia: 0, ritmo: 0 });
    Object.keys(x).forEach(k => { s[k] = (s[k] || 0) + x[k]; });
  }));
  return { dias, foraHoje };
}

// ------------------------------------------------------------------
// SALDO DE PARTIDA DO MEIO DO DIA (10/10/2026). O saldo de partida e' o do ultimo extrato. Quando o extrato foi
// baixado antes de o dia fechar, o que saiu da conta depois nao esta nele — e o que ja foi baixado no Saipos saiu da
// lista de contas a pagar: some dos dois lados, e a projecao fica melhor que o real ate o proximo extrato.
// QUANTO: quem diz e' o banco, na view vw_fin_pago_fora_do_extrato (o que esta pago no Saipos na conta, do dia do
// extrato em diante, e ainda nao aparece nele). A tela NAO mexe no saldo de partida: so avisa, com o numero.
// So entra a conta cuja linha da view fala do MESMO extrato do saldo de partida. Conta com extrato antigo vem sem
// numero (la falta tambem o que entrou depois) e continua no aviso de extrato antigo. '' = Rede.
// Devolve { total, contas: [{ nome, unidade, valor, dia, hora, parcial }], porLoja: { loja: R$ } } ou null (sem a view).
// ------------------------------------------------------------------
function projForaDoExtrato(unidade) {
  if (!PROJ_FORA_EXTRATO) return null;
  const ancora = {};
  (PROJ_ANCORA || []).forEach(a => { ancora[a.conta] = a; });
  const contas = [], porLoja = {};
  let total = 0;
  (DFC_CONTAS_RAW || []).forEach(c => {
    if (c.conta.startsWith('CREDITO') || PROJ_FORA_CAIXA.includes(c.conta)) return;
    if (unidade && c.unidade !== unidade) return;
    const a = ancora[c.conta], r = PROJ_FORA_EXTRATO.find(x => x.conta === c.conta);
    if (!a || !r || r.data_extrato !== a.data_saldo || r.pago_fora_do_extrato == null) return;
    const valor = Number(r.pago_fora_do_extrato) || 0;
    if (valor < 0.005) return;
    contas.push({ nome: c.apelido || c.conta, unidade: c.unidade, valor, dia: r.data_extrato,
                  hora: String(r.extrato_lido_em || '').slice(11, 16).replace(':', 'h'), parcial: !!r.extrato_parcial });
    porLoja[c.unidade] = (porLoja[c.unidade] || 0) + valor;
    total += valor;
  });
  return { total, contas, porLoja };
}

// A frase do aviso — um jeito so, para o bloco e para a faixa do limite. deQuem = de quem sao os numeros ("da Água Verde e da Rede").
function projForaDoExtratoFrase(F, deQuem) {
  if (!F || F.total < 0.005) return '';
  const SEM = ['domingo', 'segunda', 'terça', 'quarta', 'quinta', 'sexta', 'sábado'];
  const dia = (s) => `${SEM[new Date(s + 'T00:00:00').getDay()]} ${s.slice(8, 10)}/${s.slice(5, 7)}`;
  const quando = (c) => c.parcial && c.hora ? `das ${c.hora} de ${dia(c.dia)}` : `de ${dia(c.dia)}`;
  const fim = `o próximo extrato, os números ${deQuem} estão esse tanto, ou mais, melhores que o real. O que saiu do banco depois do extrato e ainda não foi lançado no Saipos não entra nesta conta.`;
  if (F.contas.length === 1) {
    const c = F.contas[0];
    return `<b style="color:var(--amber-2);">O saldo de ${trEscH(c.nome)} é do extrato ${quando(c)}.</b> Depois dele o Saipos tem pelo menos <b>R$ ${fmt(c.valor)}</b> pagos nessa conta que ainda não aparecem no banco: até ${fim}`;
  }
  return `<b style="color:var(--amber-2);">O saldo de partida não tem tudo o que o Saipos já pagou.</b> São pelo menos <b>R$ ${fmt(F.total)}</b> pagos que ainda não aparecem no banco — ${F.contas.map(c => `${trEscH(c.nome)} (extrato ${quando(c)}): R$ ${fmt(c.valor)}`).join(' · ')}. Até ${fim}`;
}

// ------------------------------------------------------------------
// LIMITE DO BANCO (dono, 10/10/2026: "o limite tem uma regra ... pensa nisso tambem no fluxo" e, com o print dos
// juros, "nao posso mais deixar isso acontecer"). Os DADOS do limite moram em fin_limite_conta (limite, taxa, dias
// sem juros, dia em que o mes do banco vira, renovacao, fonte e data); o calendario do mes do banco e o saldo com
// que o banco FECHOU cada dia vem de vw_fin_limite_dia. Aqui so se conta dia e se soma saldo:
//   - FATO = o dia passado em que a view sabe o saldo (dia util com saldo carregado do proprio dia; sabado, domingo
//     e feriado valem o ultimo dia util — e' assim que o banco conta os dias);
//   - SEM EXTRATO = dia passado sem saldo carregado: NAO e' fato; entra pelo ultimo saldo conhecido, como estimativa,
//     e a faixa diz quantos sao;
//   - de hoje em diante e' a projecao da LOJA da conta (o mesmo projCalc do bloco: a conta da folha e o cartao sao
//     pagos por ela), e dia com o banco fechado repete o ultimo dia util;
//   - juros = saldo negativo de cada dia x taxa do mes / 30, parando no limite. Ate N dias no mes do banco nao
//     cobra; passou de N, cobra de todos (cobra_de_todos) ou so dos que passaram.
// Tres series por dia: lanc (so o lancado), bom (com a estimativa MENOR de saida) e ruim (com a MAIOR). Sem a view
// da estimativa, as tres sao o lancado. Cada serie tem o SEU dia mais fundo — e FATO e PROJECAO tem cada um o seu:
// piorFato = o dia mais fundo que o banco ja fechou (saldo da CONTA); piorProj = o mais fundo de hoje em diante
// (saldo da LOJA). A faixa nunca mistura os dois na mesma frase.
// ------------------------------------------------------------------
function projLimiteCalc(cfg) {
  const hoje = new Date(); hoje.setHours(0, 0, 0, 0);
  const hojeIso = hoje.toISOString().slice(0, 10);
  const conta = (DFC_CONTAS_RAW || []).find(c => c.conta === cfg.conta);
  const loja = conta ? conta.unidade : '';   // '' = a conta do limite nao esta entre as contas ativas do painel
  const P = (loja && PROJ_RECEB_LOJA) ? projCalc(loja) : null;
  const idx = {};
  if (P) P.dias.forEach((d, i) => { idx[d] = i; });
  const limite = Number(cfg.limite), taxaDia = Number(cfg.taxa_mes_pct) / 100 / 30, gratis = Number(cfg.dias_sem_juros);
  const meses = [];
  let ult = null;   // o saldo do ultimo dia com banco aberto
  PROJ_LIMITE.dias.filter(d => d.conta === cfg.conta).forEach(d => {
    let x, tipo;
    if (d.fato || d.sem_extrato) {
      if (d.saldo == null) return;              // dia passado sem nenhum saldo antes dele
      const s = Number(d.saldo);
      x = ult = { lanc: s, bom: s, ruim: s };
      tipo = d.fato ? 'fato' : 'semExtrato';
    } else if (!P || !(d.dia in idx)) {
      return;                                   // depois de onde a tela projeta
    } else if (d.dia_util || !ult) {
      const i = idx[d.dia], lanc = P.serieSaldo[i];
      x = ult = { lanc, bom: P.costumaDia ? P.serieRitmo[i] : lanc, ruim: P.costumaDia ? P.serieCostuma[i] : lanc };
      tipo = 'proj';
    } else {
      x = ult;                                  // banco fechado: vale o saldo do ultimo dia util
      tipo = 'proj';
    }
    let m = meses[meses.length - 1];
    if (!m || m.ini !== d.mes_banco_ini) meses.push(m = { ini: d.mes_banco_ini, fim: d.mes_banco_fim, dias: [] });
    m.dias.push({ dia: d.dia, tipo, extrato: d.data_extrato || null, parcial: !!d.extrato_parcial, lidoEm: d.extrato_lido_em || null, lanc: x.lanc, bom: x.bom, ruim: x.ruim });
  });
  const maisFundo = (ds, k) => ds.length ? ds.reduce((a, b) => (b[k] < a[k] ? b : a), ds[0]) : null;
  const resumo = (m, k) => {
    const neg = m.dias.filter(d => d[k] < -0.005);
    const cobrados = neg.length <= gratis ? [] : (cfg.cobra_de_todos === false ? neg.slice(gratis) : neg);
    return { dias: neg.length,
             juros: cobrados.reduce((s, d) => s + Math.min(-d[k], limite), 0) * taxaDia,
             pior: maisFundo(m.dias, k),                                        // o dia mais fundo DESTA serie, no mes inteiro
             piorProj: maisFundo(m.dias.filter(d => d.tipo === 'proj'), k) };   // so de HOJE em diante (null = nao ha projecao no mes)
  };
  meses.forEach(m => {
    const fatos = m.dias.filter(d => d.tipo === 'fato');
    m.negFato = fatos.filter(d => d.lanc < -0.005).length;                 // dias fechados no negativo: so FATO
    m.ultFato = fatos.length ? fatos[fatos.length - 1].dia : null;         // ate que dia essa contagem vai
    m.piorFato = maisFundo(fatos, 'lanc');                                 // o dia mais fundo que o banco ja fechou (saldo da CONTA)
    m.ultExtrato = fatos.reduce((a, d) => (d.extrato && (!a || d.extrato > a) ? d.extrato : a), null);   // ate que dia ha saldo carregado
    m.semExtrato = m.dias.filter(d => d.tipo === 'semExtrato').length;     // dias passados sem extrato (fora do fato)
    // o ultimo saldo foi lido no proprio dia dele? entao e' o saldo do MEIO do dia: o que saiu depois nao esta nele
    const uf = fatos[fatos.length - 1];
    m.extratoParcial = uf && uf.parcial && uf.extrato ? { dia: uf.extrato, hora: String(uf.lidoEm || '').slice(11, 16).replace(':', 'h') } : null;
    m.ultimo = m.dias[m.dias.length - 1].dia;
    m.completo = m.ultimo >= m.fim;
    m.temProj = m.dias.some(d => d.tipo === 'proj');
    m.lanc = resumo(m, 'lanc'); m.bom = resumo(m, 'bom'); m.ruim = resumo(m, 'ruim');
  });
  return { hojeIso, loja, limite, gratis, temProj: !!P, temCostuma: !!(P && P.costumaDia),
           contas: P ? P.partida.map(c => c.conta) : [], meses };
}

// A faixa na tela: uma por conta com limite; aparece na Rede e na loja da conta.
function projFaixaLimite(lojaBloco) {
  if (!PROJ_LIMITE || !PROJ_PAGAR || !PROJ_RECEB) return '';
  const SEM = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb'];
  const dm = (s) => s.slice(8, 10) + '/' + s.slice(5, 7);
  const rot = (s) => `${dm(s)} (${SEM[new Date(s + 'T00:00:00').getDay()]})`;
  const diasEntre = (a, b) => Math.round((new Date(b + 'T00:00:00') - new Date(a + 'T00:00:00')) / 86400000);
  const perto = (a, b) => Math.abs(a - b) < 500;
  const faixa = (a, b) => perto(a, b) ? fxMil(b) : `de ${fxMil(a)} a ${fxMil(b)}`;
  const nDias = (a, b) => { const lo = Math.min(a, b), hi = Math.max(a, b); return lo === hi ? `${hi} ${hi === 1 ? 'dia' : 'dias'}` : `${lo} a ${hi} dias`; };
  // juros so em MILHARES arredondados: a conta nao tem precisao para mais do que isso (ver "errou de ... a ...")
  const jurosMil = (a, b) => {
    const lo = Math.min(a, b), hi = Math.max(a, b), rl = Math.round(lo / 1000), rh = Math.round(hi / 1000);
    if (hi < 500) return 'menos de R$ 1 mil';
    if (rl === rh) return `perto de R$ ${rh} mil`;
    return rl === 0 ? `até R$ ${rh} mil` : `de R$ ${rl} mil a R$ ${rh} mil`;
  };
  const pequeno = 'font-size:12px; color:var(--tx-3);';
  return PROJ_LIMITE.cfg.map(cfg => {
    const L = projLimiteCalc(cfg);
    if (lojaBloco && lojaBloco !== L.loja) return '';
    const iAtual = L.meses.findIndex(m => m.ini <= L.hojeIso && L.hojeIso <= m.fim);   // o mes do banco em que hoje cai
    const atual = L.meses[iAtual];
    if (!atual) return '';
    const prox = L.meses[iAtual + 1] || null;
    const ant = iAtual > 0 ? L.meses[iAtual - 1] : null;
    const g = L.gratis;
    const taxa = fmt(Number(cfg.taxa_mes_pct));
    const fechados = (PROJ_LIMITE.meses || []).filter(r => r.conta === cfg.conta);   // meses do banco ja fechados (vw_fin_limite_mes)
    const juros = (m) => m.ruim.juros < 0.5 ? 'sem juros' : `juros <b>${jurosMil(m.bom.juros, m.ruim.juros)}</b>`;
    // PROJECAO: o ponto mais fundo de HOJE em diante (nunca um dia que ja passou) e quanto sobra ou falta do limite
    const fundoProj = (m) => {
      const pb = m.bom.piorProj, pr = m.ruim.piorProj;         // o dia mais fundo de CADA ponta da estimativa
      if (!pb || !pr) return '';
      const sb = L.limite + pb.bom, sr = L.limite + pr.ruim;   // quanto sobra (+) ou falta (-) do limite em cada ponta
      const onde = pb.dia === pr.dia ? `em ${rot(pr.dia)}: ${faixa(pb.bom, pr.ruim)}`
        : `${fxMil(pb.bom)} em ${dm(pb.dia)} ou ${fxMil(pr.ruim)} em ${dm(pr.dia)}`;
      const sobra = sr >= 0 ? `sobram ${perto(sr, sb) ? fxMil(sr) : `de ${fxMil(sr)} a ${fxMil(sb)}`} do limite`
        : (sb >= 0 ? `do limite, vai de ${fxMil(sb)} de sobra a ${fxMil(-sr)} de falta`
                   : `<b style="color:var(--farol-fora);">faltam ${perto(sb, sr) ? fxMil(-sr) : `de ${fxMil(-sb)} a ${fxMil(-sr)}`} para caber no limite</b>`);
      return `ponto mais fundo ${onde} — ${sobra}`;
    };
    // passa do limite? (a ponta mais funda da projecao, ou o que o banco ja fechou)
    const passa = (m) => !!m && ((m.ruim.piorProj && L.limite + m.ruim.piorProj.ruim < -0.005) || (m.piorFato && L.limite + m.piorFato.lanc < -0.005));
    const estourou = atual.negFato > g;
    const vaiEstourar = atual.ruim.dias > g || (prox && prox.ruim.dias > g);
    const passaLimite = passa(atual) || passa(prox);
    const semExt = (m) => m.semExtrato ? ` <span style="${pequeno}">${nDias(m.semExtrato, m.semExtrato)} sem extrato do banco: fora desta contagem.</span>` : '';
    const linhas = [];
    // 0) o mes do banco que acabou de fechar fica na tela por 7 dias: e' quando o banco debita os juros dele
    if (ant && diasEntre(ant.fim, L.hojeIso) <= 7) {
      const f = fechados.find(r => r.mes_banco_ini === ant.ini);
      const deb = f && f.juros_debitado != null ? Number(f.juros_debitado) : null;
      linhas.push(`Mês do banco que fechou em ${dm(ant.fim)}: <b>${nDias(ant.negFato, ant.negFato)} no negativo</b>.${semExt(ant)} ${deb != null
        ? `O banco debitou <b>R$ ${fmt(deb)}</b> de juros${f.data_debito ? ` em ${dm(f.data_debito)}` : ''}.`
        : (ant.ruim.juros < 0.5 ? `Não passou dos ${g} dias: sem juros.`
                                : `O banco debita os juros desse mês nos próximos dias: <b>${jurosMil(ant.ruim.juros, ant.ruim.juros)}</b>, pela taxa de hoje.`)}`);
    }
    // 1) o FATO: quantos dias o banco ja contou neste mes do banco (a contagem e a data falam do mesmo dia) e o dia
    //    mais fundo que ele ja fechou — saldo da CONTA, em frase so de fato
    const pf = atual.piorFato;
    linhas.push(atual.ultFato
      ? `<b>${nDias(atual.negFato, atual.negFato)} no negativo</b> de ${dm(atual.ini)} a ${dm(atual.ultFato)} <span style="${pequeno}">(extrato do banco até ${dm(atual.ultExtrato || atual.ultFato)}${atual.extratoParcial ? `, lido às ${atual.extratoParcial.hora} desse dia: o saldo de ${dm(atual.extratoParcial.dia)} ainda pode mudar` : ''}${atual.ultExtrato && atual.ultExtrato < atual.ultFato ? '; sábado, domingo e feriado repetem o último dia útil' : ''})</span> — ${estourou
          ? `já passou dos ${g} dias sem juros.`
          : (atual.negFato === g ? `acabaram os ${g} dias sem juros: mais um dia no negativo e o banco cobra.` : `ainda ${nDias(g - atual.negFato, g - atual.negFato)} sem juros.`)}${pf && pf.lanc < -0.005 ? ` O dia mais fundo que o banco já fechou foi ${rot(pf.dia)}: ${fxMil(pf.lanc)} na conta${L.limite + pf.lanc < -0.005 ? ` — <b style="color:var(--farol-fora);">${fxMil(-(L.limite + pf.lanc))} além do limite</b>` : ''}.` : ''}${semExt(atual)}`
      : `O mês do banco começou em ${dm(atual.ini)}: ainda nenhum dia fechado com extrato.${semExt(atual)}`);
    // 1b) o saldo de partida e' do meio do dia? quanto o Saipos ja tem pago que o extrato ainda nao mostra (numero do banco)
    const fora = L.loja ? projForaDoExtratoFrase(projForaDoExtrato(L.loja), 'desta faixa') : '';
    if (fora && L.temProj) linhas.push(fora);
    // 2) ate o fim do mes do banco, pela projecao (frase so de projecao: o ponto mais fundo e' de hoje em diante)
    if (L.temProj && atual.temProj) {
      const fp = fundoProj(atual);
      linhas.push(`Até ${dm(atual.ultimo)}${atual.completo ? '' : ' (até onde esta tela projeta)'} deve fechar com <b>${nDias(atual.bom.dias, atual.ruim.dias)} no negativo</b> <span style="${pequeno}">(${L.temCostuma ? `${atual.lanc.dias} só com o que está lançado` : 'só com o que está lançado'})</span>, ${juros(atual)}.${fp ? ` De hoje até lá, ${fp}.` : ''}`);
    }
    // 3) o mes do banco seguinte, ate onde a tela projeta
    if (L.temProj && prox && prox.temProj) {
      const fp = fundoProj(prox);
      linhas.push(`Mês seguinte, de ${dm(prox.ini)} a ${dm(prox.ultimo)}${prox.completo ? '' : ' (até onde esta tela projeta)'}, ${prox.dias.length} dias: <b>${nDias(prox.bom.dias, prox.ruim.dias)} no negativo</b>, ${juros(prox)}${fp ? `; ${fp}` : ''}.`);
    }
    // de que saldo a faixa fala: o da LOJA da conta (nao so a conta do banco) — e na Rede ela fala so dessa loja.
    // Sem a projecao (falta a receita por loja, ou a conta do limite nao esta entre as ativas) a faixa mostra so o
    // que o banco ja fechou, e diz isso.
    const nomeLoja = lojaNome(L.loja);
    const deQuem = !L.loja
      ? `A conta do limite (${trEscH(cfg.conta)}) não está entre as contas ativas do painel: aqui aparece só o que o banco já fechou, sem projeção.`
      : (!L.temProj
        ? `Sem a receita por loja, aqui aparece só o que o banco já fechou na conta: a projeção da ${trEscH(nomeLoja)} não entra nesta faixa.`
        : `De hoje em diante a conta é feita com o saldo da <b>loja ${trEscH(nomeLoja)}</b>${L.contas.length ? ` (${L.contas.map(trEscH).join(' + ')})` : ''}, não só com a conta do banco.${lojaBloco ? '' : ` <b>Esta faixa fala só da ${trEscH(nomeLoja)}</b>: os números dela não são os da tabela da Rede, logo abaixo.`}`);
    // juros: pela taxa de hoje, a renovacao e quanto a mesma conta ja errou nos meses que o banco cobrou
    const ren = cfg.renovacao || null;
    const renTxt = !ren ? '' : (ren >= L.hojeIso
      ? ` O limite renova em ${dm(ren)} e a taxa pode mudar${!L.temProj ? '' : (ren <= atual.fim ? ': daí em diante os juros estão pela taxa de antes'
            : (prox && ren <= prox.fim ? ': os juros do mês seguinte estão pela taxa de antes' : ''))}.`
      : ` O limite renovou em ${dm(ren)}: conferir no aplicativo se a taxa mudou.`);
    const erros = fechados.filter(r => r.erro_pct != null).map(r => Number(r.erro_pct));
    const eMin = erros.length ? Math.min.apply(null, erros) : 0, eMax = erros.length ? Math.max.apply(null, erros) : 0;
    const erroTxt = !erros.length ? '' : ` Nos ${erros.length === 1 ? 'mês' : erros.length + ' meses'} que o banco já cobrou, esta mesma conta errou ${eMin < 0 && eMax > 0
      ? `de ${Math.round(-eMin)}% para menos a ${Math.round(eMax)}% para mais`
      : (eMax <= 0 ? `de ${Math.round(-eMax)}% a ${Math.round(-eMin)}% para menos` : `de ${Math.round(eMin)}% a ${Math.round(eMax)}% para mais`)}: por isso os juros vão arredondados, em milhares.`;
    const regra = cfg.cobra_de_todos === false
      ? `passou de ${g} dias no negativo, o banco cobra só os dias além do ${g}º`
      : `passou de ${g} dias no negativo, o banco cobra de todos os dias do mês`;
    const nome = trEscH(cfg.nome_tela || ('Limite — ' + cfg.conta));
    return `<div class="contexto" style="text-align:left; border-color:var(${estourou || passaLimite ? '--farol-fora' : (vaiEstourar ? '--farol-perto' : '--farol-ok')});">
      <b style="font-size:15px;">${nome}</b>
      <span style="${pequeno}"> · limite de R$ ${fmt(L.limite)} · mês do banco de ${dm(atual.ini)} a ${dm(atual.fim)} · até ${g} dias no negativo não paga juros · passou disso, ${taxa}% ao mês</span>
      ${linhas.map(l => `<div style="margin-top:5px;">${l}</div>`).join('')}
      <details style="margin-top:6px; display:none;"><summary style="cursor:pointer; ${pequeno}">como esta conta é feita</summary>
      <div style="margin-top:6px; ${pequeno}">${deQuem}</div>
      <div style="margin-top:4px; ${pequeno}">${L.temProj ? `Juros pela taxa de hoje, ${taxa}% ao mês.${renTxt}${erroTxt}` : `Taxa de hoje: ${taxa}% ao mês.${renTxt}`}</div>
      <div style="margin-top:4px; ${pequeno}">${L.temProj ? `Daqui para a frente, dias e juros são <b>estimativa</b>${L.temCostuma ? ': os dois números são o saldo com a estimativa menor e com a maior do que costuma sair' : ', só com o que está lançado'}; o IOF não está na conta.
        ` : ''}Regra${L.temProj ? ' usada' : ' do banco'}: ${regra}${cfg.regra_confirmada ? '.' : ' — é como o extrato e o aplicativo mostram, <b>ainda não confirmado com o banco</b>.'}
        Dados do limite: ${trEscH(cfg.fonte || '')}.</div></details>
    </div>`;
  }).join('');
}

// ------------------------------------------------------------------
// O MOTOR DA PROJECAO (tirado de dentro de renderModuloProjecao em 10/10/2026, sem mudar a conta).
// UMA conta so: os cartoes, a frase, o grafico, a agenda e o bloco "Saldo dia a dia" leem daqui.
// unidade '' = a Rede (o que a tela sempre mostrou). 'AGUA VERDE' | 'AHU' | 'SÃO BRAZ' = o mesmo
// motor so com as contas, os titulos e os recebimentos daquela loja; ai a cobranca entre lojas
// CONTA (para a loja e' dinheiro de verdade) — na Rede ela continua fora (projEntreLojas).
// ------------------------------------------------------------------
function projCalc(unidade) {
  const hoje = new Date(); hoje.setHours(0, 0, 0, 0);
  const iso = (d) => d.toISOString().slice(0, 10);
  const hojeIso = iso(hoje);
  const HORIZONTE = 90;   // dono, 19/10/2026: "vamos aumentar essa tela para uns 90 dias" (era 45)

  // ---- saldo atual por conta: ANCORADO NO BANCO quando ha extrato OFX
  // (peca 1 do plano do dono, aplicada da fila em 17/08/2026). Conta sem
  // OFX (ex.: COFRE AV) segue pelo Saipos, e a legenda diz isso. ----
  const ancoraPorConta = {};
  (PROJ_ANCORA || []).forEach(a => { ancoraPorConta[a.conta] = a; });
  // A PROJECAO E' DA REDE, SEMPRE (12/09/2026). Tudo que ela projeta ja era das
  // tres lojas — PROJ_PAGAR e PROJ_RECEB sao carregados sem filtro de unidade —,
  // mas o caixa de partida lia DFC_CONTAS/DFC_MOV, que o seletor de loja FILTRA.
  // Com "Agua Verde" escolhido noutra tela, "Caixa operacional hoje" era de uma
  // loja e "A pagar (30 dias)" era das tres: quem lesse o menor saldo projetado
  // lia uma conta que nao existe. Aqui le-se o RAW, todas as contas, e o titulo
  // da tela diz Rede. Number() em tudo: aplicarLojaFin so converte os numeros das
  // contas da loja escolhida, entao no RAW as outras ainda sao TEXTO — e texto
  // mais numero, em JavaScript, vira texto grudado em vez de soma.
  const movTotal = {};
  (DFC_MOV_RAW || []).forEach(r => { movTotal[r.conta] = (movTotal[r.conta] || 0) + Number(r.movimento); });
  let caixaOper = 0, investido = 0;
  let atrasoSaipos = 0, idadeMax = 0, dataExtrato = null;
  const partida = [];   // de que contas sai o caixa de partida (o bloco Saldo dia a dia mostra)
  (DFC_CONTAS_RAW || []).forEach(c => {
    const a = ancoraPorConta[c.conta];
    const s = a ? Number(a.saldo_banco) : Number(c.saldo_inicial) + (movTotal[c.conta] || 0);
    if (c.conta.startsWith('CREDITO')) return;   // cartao nao e caixa; a fatura a vencer ja vem em PROJ_PAGAR
    if (unidade && c.unidade !== unidade) return;   // por loja: so as contas dela
    if (PROJ_FORA_CAIXA.includes(c.conta)) investido += s;
    else {
      caixaOper += s;
      partida.push({ conta: c.apelido || c.conta, saldo: s, doBanco: !!a, dataSaldo: a ? a.data_saldo : null });
      if (a) {
        atrasoSaipos += Number(a.diferenca);
        if (Number(a.idade_dias) > idadeMax) idadeMax = Number(a.idade_dias);
        if (!dataExtrato || a.data_saldo > dataExtrato) dataExtrato = a.data_saldo;
      }
    }
  });
  const temAncora = Object.keys(ancoraPorConta).length > 0;

  // ---- media de recebimento por dia da semana (ultimas 4 semanas) ----
  const janelaReceb = PROJ_RECEB.filter(r => r.data < hojeIso).slice(-28);
  // por loja: a MESMA janela de datas da Rede; dia em que a loja nao recebeu conta zero —
  // assim a media das tres lojas somada e' a da Rede
  // 18/10/2026: menos a parte que entra pela provisao mensal (o Boqueirao) — a mesma conta de fin_receita_prevista no banco
  const foraDoDia = (r) => !PROJ_FORA_MEDIA ? 0
    : (unidade ? (PROJ_RECEB_LOJA ? ((PROJ_FORA_MEDIA.porLoja[unidade] || {})[r.data] || 0) : 0) : (PROJ_FORA_MEDIA.rede[r.data] || 0));
  const recebDoDia = (r) => (unidade ? (((PROJ_RECEB_LOJA || {})[unidade] || {})[r.data] || 0) : r.recebido) - foraDoDia(r);
  const porDow = {};
  janelaReceb.forEach(r => {
    if (projDistorcido(r.data)) return;            // feriado e o dia que recebe por ele (16/10/2026)
    const dow = new Date(r.data + 'T00:00:00').getDay();
    (porDow[dow] = porDow[dow] || []).push(recebDoDia(r));
  });
  const mediaDow = {};
  for (let d = 0; d < 7; d++) {
    const v = porDow[d] || [];
    mediaDow[d] = v.length ? v.reduce((s, x) => s + x, 0) / v.length : 0;
  }
  const mediaSemana = Object.values(mediaDow).reduce((s, x) => s + x, 0);
  // a media daqui e a do banco sao a MESMA conta (18/10/2026): em todo dia sem feriado movido tem de bater
  if (PROJ_FORA_MEDIA) Object.values(((PROJ_RECEITA_PREV || {})[unidade || '']) || {}).forEach(r => {
    if (r.dia > hojeIso && r.feriado_movido === false)
      console.assert(Math.abs(Number(r.media) - mediaDow[new Date(r.dia + 'T00:00:00').getDay()]) < 0.01, `media da tela (${unidade || 'Rede'}) nao bate com a do banco em ${r.dia}`);
  });

  // ---- ATACADO SEM CONTAR EM DOBRO: A REGRA DO MAIOR ACUMULADO (a outra metade do passo 2 do plano das telas; 10/10/2026) ----
  // O boleto do ePadoca a receber ja entra como FATO (PROJ_PAGAR, origem EPADOCA) e a media de entrada acima tem a
  // revenda do atacado dentro: o mesmo dinheiro duas vezes. A REGRA: contando A PARTIR DE HOJE, o atacado que a projecao
  // soma ATE CADA DIA e' o MAIOR entre (a) os boletos a receber ate aquele dia e (b) o que costuma entrar de atacado ate
  // aquele dia pela media; a entrada de atacado do dia e' o AUMENTO desse acumulado (nunca negativa). Assim o atacado
  // nunca conta duas vezes e nunca fica abaixo do ritmo normal. (A regra anterior, "sem a media ate o ultimo boleto",
  // deixava um boleto solto de R$ 1.246,25 tirar R$ 13 mil de entrada de 22/10 em diante.)
  // Quem diz o que e' atacado e' o banco (coluna recebido_atacado da view da receita por conta).
  // A MEDIA POR DIA DA SEMANA do atacado ainda e' feita AQUI, na MESMA janela e do MESMO jeito da media de entrada logo
  // acima: AS DUAS MEDIAS VAO JUNTAS PARA O BANCO NO PASSO 5 DO PLANO DAS TELAS ("a media que sobra calculada num lugar
  // so", contexto/project_contas_fluxo_geradores_2026_10.md) — quem mexer numa mexe na outra.
  // Sem a coluna (PROJ_ATACADO = null) nada muda: nao ha ajuste nenhum.
  const atacadoDoDia = (r) => !PROJ_ATACADO ? 0
    : (unidade ? ((PROJ_ATACADO.porLoja[unidade] || {})[r.data] || 0) : (PROJ_ATACADO.rede[r.data] || 0));
  const atacadoDow = {};
  for (let d = 0; d < 7; d++) atacadoDow[d] = 0;
  janelaReceb.forEach(r => {
    if (projDistorcido(r.data)) return;
    const dow = new Date(r.data + 'T00:00:00').getDay();
    atacadoDow[dow] += atacadoDoDia(r) / porDow[dow].length;
  });
  // nunca negativa nem maior que a media do dia
  for (let d = 0; d < 7; d++) atacadoDow[d] = Math.min(Math.max(atacadoDow[d], 0), Math.max(mediaDow[d], 0));
  const atacadoSemana = Object.values(atacadoDow).reduce((s, x) => s + x, 0);

  // ---- contas a pagar/receber por dia (vencidas caem em hoje) ----
  // Peca 2: vencida que JA SAIU do banco (achou_no_banco) sai da projecao —
  // o debito ja esta dentro do saldo ancorado; subtrair de novo contaria
  // duas vezes. So vale com ancora; sem OFX, volta ao comportamento antigo.
  const jaSaiuBanco = new Set();
  if (temAncora) (PROJ_VENC || []).filter(v => v.achou_no_banco)
    .forEach(v => jaSaiuBanco.add(`${v.vencimento}|${v.debito}|${v.descricao || ''}`));
  // 16/10/2026 (dono): vencida "de verdade" so quando o extrato ja cobre o dia do vencimento;
  // antes disso ela aguarda o extrato e nao entra no cartao de vencidas (a regra e' do banco).
  const aguardaExtrato = new Set();
  (PROJ_VENC || []).filter(v => v.aguarda_extrato)
    .forEach(v => aguardaExtrato.add(`${v.vencimento}|${v.debito}|${v.descricao || ''}`));
  const pagarDia = {}, receberDia = {}, itensDia = {};
  let vencidas = 0, jaPagasSemBaixa = 0, entreLojasFora = 0;
  const boletoDia = {};                       // boletos do atacado a receber, no dia em que a projecao os poe
  let ultBoleto = null, boletosAtacado = 0;   // o ultimo dia com boleto do atacado a receber, e quanto ha
  PROJ_PAGAR.forEach(r => {
    if (unidade && r.unidade !== unidade) return;   // por loja: so o que esta lancado nas contas dela
    // a projecao e' da Rede: o que uma loja tem a receber da outra nao e' dinheiro novo
    // (para UMA loja e' dinheiro de verdade: ali ele conta)
    if (!unidade && projEntreLojas(r)) { entreLojasFora += r.credito; return; }
    // 19/10/2026: sem a media do banco (vw_fin_receita_prevista) E sem a parte de cada dia que saiu dela (recebido_fora_media),
    // a media desta tela ainda leva o Boqueirao — ai a provisao dele nao entra, senao contaria duas vezes. So acontece se as
    // duas leituras falharem juntas (banco fora); a tela fica como era antes de 18/10.
    if (r.origem === 'PROVISAO' && !PROJ_RECEITA_PREV && !PROJ_FORA_MEDIA) { console.warn('Fluxo: provisao do Boqueirao fora da conta (sem a media do banco)'); return; }
    if (r.vencimento < hojeIso && jaSaiuBanco.has(`${r.vencimento}|${r.debito}|${r.descricao || ''}`)) {
      jaPagasSemBaixa += r.debito - r.credito;
      return;
    }
    // 19/10/2026 (dono): o A RECEBER vencido que a conciliacao nao achou (emprestimos dos motoboys e do Pinho, cobrancas)
    // passa para o DIA SEGUINTE, todo dia, ate entrar — nunca conta como dinheiro de hoje. A pagar vencida continua em hoje.
    // 21/10/2026: entre lojas, a ponta que sai da filial anda junto com a que entra na Agua Verde (as duas para amanha)
    const receberVencido = r.vencimento < hojeIso && ((r.credito > 0 && !(r.debito > 0)) || projEntreLojas(r));
    const dia = receberVencido ? fxSomaDias(hojeIso, 1) : (r.vencimento < hojeIso ? hojeIso : r.vencimento);
    if (r.vencimento < hojeIso && !receberVencido && !aguardaExtrato.has(`${r.vencimento}|${r.debito}|${r.descricao || ''}`)) vencidas += r.debito - r.credito;
    pagarDia[dia] = (pagarDia[dia] || 0) + r.debito;
    receberDia[dia] = (receberDia[dia] || 0) + r.credito;
    (itensDia[dia] = itensDia[dia] || []).push(r);
    if (r.origem === 'EPADOCA' && r.credito > 0) {
      boletoDia[dia] = (boletoDia[dia] || 0) + r.credito;
      boletosAtacado += r.credito;
      if (!ultBoleto || dia > ultBoleto) ultBoleto = dia;
    }
  });

  // ---- bonus do iFood que vai para a aplicacao: sai toda QUINTA (dono, 19/10/2026; era quarta) — a data vem do banco.
  // Fica FORA de pagarDia de proposito: nao e' conta a pagar, e o cartao "A pagar (30 dias)" nao muda.
  // Quem manda e' a Agua Verde: entra na Rede e na Agua Verde; nas filiais, nao. ----
  const bonusDia = {};
  if (!unidade || unidade === 'AGUA VERDE') projBonusQuartas(hojeIso, HORIZONTE).forEach(b => {
    bonusDia[b.dia] = (bonusDia[b.dia] || 0) + b.v;
    (itensDia[b.dia] = itensDia[b.dia] || []).push({ origem: 'BONUS', subtipo: 'BÔNUS DO IFOOD → APLICAÇÃO',
      descricao: b.txt, conta_exibida: 'Itaú AV', debito: b.v, credito: 0, estimativa: b.estimativa });
  });

  // (a "fatura de cartao estimada" que ficava aqui saiu em 10/09/2026: as compras
  // a vencer chegam como SAIPOS_PREV e ja estao em PROJ_PAGAR, na data da fatura)

  // ---- o que costuma sair e ninguem lanca antes (ESTIMATIVA; passo 6 do plano das telas). A conta e' do banco
  // (vw_fin_saida_costuma_sair); aqui ela so e' somada, dia a dia, por cima do saldo lancado — que continua sendo
  // o saldo dos cartoes, da frase, da agenda e da linha cheia do grafico. Sem a view: costumaDia = null.
  // HOJE SEM DOBRO: a estimativa de hoje de uma loja so fica de fora quando o extrato de HOJE ja FECHOU o dia em
  // TODAS as contas de banco dela. Extrato do MEIO do dia (lido no proprio dia: vw_fin_pago_fora_do_extrato diz) nao
  // tira nada — a estimativa de hoje fica inteira, que e' o lado prudente, e o bloco avisa. Sem essa view nao da
  // para dizer que o dia fechou: vale como extrato do meio do dia. ----
  const lojasFechadasHoje = new Set(), lojasParcialHoje = new Set(), bancoDaLoja = {};
  (DFC_CONTAS_RAW || []).forEach(c => {
    const a = ancoraPorConta[c.conta];
    if (!a || c.conta.startsWith('CREDITO') || PROJ_FORA_CAIXA.includes(c.conta)) return;
    const x = (bancoDaLoja[c.unidade] = bancoDaLoja[c.unidade] || { contas: 0, fechouHoje: 0, parcialHoje: 0 });
    x.contas++;
    if (a.data_saldo !== hojeIso) return;
    const r = (PROJ_FORA_EXTRATO || []).find(k => k.conta === c.conta && k.data_extrato === a.data_saldo);
    if (r && r.extrato_parcial === false) x.fechouHoje++; else x.parcialHoje++;
  });
  Object.keys(bancoDaLoja).forEach(u => {
    const x = bancoDaLoja[u];
    if (x.fechouHoje === x.contas) lojasFechadasHoje.add(u);
    else if (x.fechouHoje + x.parcialHoje > 0) lojasParcialHoje.add(u);
  });
  const costuma = projCostumaDia(unidade, hojeIso, lojasFechadasHoje);
  const costumaDia = costuma ? costuma.dias : null;
  const extratoParcialHoje = unidade ? lojasParcialHoje.has(unidade) : lojasParcialHoje.size > 0;
  const serieCostuma = [], serieRitmo = [], serieSemAtacado = [];
  let estCheia = 0, estRitmo = 0, atacadoFora = 0;
  let acBoleto = 0, acMediaAt = 0, acAtacado = 0;   // atacado, somado desde hoje: os boletos, a media e o MAIOR dos dois

  // ---- projecao dia a dia ----
  const dias = [], serieSaldo = [], serieMedia = [];
  let saldo = caixaOper, menorSaldo = caixaOper, menorDia = hojeIso;
  let pagar30 = 0;
  for (let i = 0; i <= HORIZONTE; i++) {
    const d = new Date(hoje); d.setDate(d.getDate() + i);
    const dIso = iso(d);
    const rpd = ((PROJ_RECEITA_PREV || {})[unidade || ''] || {})[dIso];   // a receita do dia, calculada no banco
    const mediaDoDia = i === 0 ? 0 : (rpd ? Number(rpd.media) : mediaDow[d.getDay()]);
    // atacado, pela regra do MAIOR ACUMULADO: o dia entra com a media inteira e com os boletos, MENOS o que os dois
    // contariam em dobro (semAtacado >= 0). O que fica de atacado no dia e' so o aumento do maior acumulado.
    let semAtacado = 0;
    if (rpd) {
      semAtacado = i === 0 ? 0 : Number(rpd.sem_atacado);         // a regra do atacado tambem no banco (dia 0: fora, ver a media)
    } else if (PROJ_ATACADO) {
      const bol = boletoDia[dIso] || 0, atMedia = i === 0 ? 0 : atacadoDow[d.getDay()];
      acBoleto += bol; acMediaAt += atMedia;
      const maior = Math.max(acBoleto, acMediaAt);
      semAtacado = Math.max(bol + atMedia - (maior - acAtacado), 0);
      acAtacado = maior;
    }
    const entradas = mediaDoDia + (receberDia[dIso] || 0) - semAtacado;
    let saidas = (pagarDia[dIso] || 0) + (bonusDia[dIso] || 0);   // o bonus sai junto, na quinta
    saldo += entradas - saidas;
    if (i <= 30) pagar30 += pagarDia[dIso] || 0;
    dias.push(dIso);
    serieSaldo.push(saldo);
    serieMedia.push(mediaDoDia);
    serieSemAtacado.push(semAtacado);
    atacadoFora += semAtacado;
    const est = costumaDia && costumaDia[dIso];
    if (est) { estCheia += est.cheia; estRitmo += est.ritmo; }
    serieCostuma.push(costumaDia ? saldo - estCheia : null);   // com a estimativa MAIOR de saida
    serieRitmo.push(costumaDia ? saldo - estRitmo : null);     // com a estimativa MENOR de saida
    if (saldo < menorSaldo) { menorSaldo = saldo; menorDia = dIso; }
  }
  return { hoje, iso, hojeIso, HORIZONTE, caixaOper, investido, atrasoSaipos, idadeMax, dataExtrato, temAncora,
           partida, janelaReceb, mediaDow, mediaSemana, pagarDia, receberDia, itensDia, vencidas, entreLojasFora,
           dias, serieSaldo, serieMedia, menorSaldo, menorDia, pagar30, bonusDia,
           costumaDia, costumaForaHoje: costuma ? costuma.foraHoje : 0, extratoParcialHoje, serieCostuma, serieRitmo, serieSemAtacado,
           atacado: PROJ_ATACADO ? { dow: atacadoDow, semana: atacadoSemana, ate: ultBoleto, fora: atacadoFora, boletos: boletosAtacado } : null };
}

// ------------------------------------------------------------------
// FLUXO LIMPO (dono, 23/10/2026): saldo inicial, a receber, a pagar e saldo final por dia, UMA conta só (títulos do
// Saipos + provisões, a provisão só do que não tem título) e o mesmo número no quadro e nas linhas. A CONTA É DO BANCO:
// vw_fin_saldo_partida (saldo de ontem), vw_fin_dia0_titulos (o devido até hoje), vw_fin_previsto_detalhe (o resto,
// linha a linha). A tela só soma por dia e por loja. FXL.dias = [{dia, unidades: {AGUA VERDE|AHU|SÃO BRAZ|REDE: {
// saldo_inicial, a_receber, a_pagar, saldo_final, composicao: [{unidade, conta, lado, origem, situacao, descricao,
// valor, efeito, vencimento}]}}}]
// ------------------------------------------------------------------
let FXL = null;   // null = sem as views novas: a tela de antes

const FXL_DIA0_PREV = ['MEDIA', 'PROVISAO_RECEITA', 'PROVISAO_NF', 'COSTUMA_SAIR', 'BONUS'];

const FXL_ORIGEM = { SAIPOS: 'título do Saipos', SAIPOS_PAGO: 'pago no Saipos depois do extrato', MEDIA: 'média de vendas',
  PROVISAO_RECEITA: 'previsto pelo vendido', PROVISAO_NF: 'mercadoria prevista (fornecedor)', COSTUMA_SAIR: 'costuma sair',
  BONUS: 'bônus para a XP', EPADOCA: 'boleto do atacado', LISTAS: 'lista entre lojas', PROVISAO: 'provisão mensal',
  'FORA DA FOLHA': 'fora da folha', FATURA_CARTAO: 'fatura do cartão',
  RH_PREVISAO: 'folha prevista', NF_SEM_TITULO: 'nota sem título', BONUS_FILIAL: 'bônus das filiais',
  EXTRATO: 'no banco, sem lançamento' };

function fxlDiasAte() {
  // até a SEGUNDA quarta-feira, como o dia a dia de antes
  const hoje = prdHoje(); let q = 0, d = hoje, n = 0;
  while (n < 20) { const w = new Date(d + 'T12:00:00').getDay(); if (w === 3 && d !== hoje) { q++; if (q === 2) break; } d = fxSomaDias(d, 1); n++; }
  return n;
}

async function fxlCarregar() {
  // 23/10/2026 (Financeiro): UMA chamada, a mesma foto das tres partes. A leitura paginada de antes (order=dia, nao unico)
  // podia repetir uma linha e perder outra entre as paginas — o quadro somaria errado.
  try {
    const r = await trRpc('fin_fluxo_limpo', { p_dias: 90 });
    if (r.ok) { const j = await r.json(); FXL = fxlMontar(j.partida || [], j.dia0 || [], j.detalhe || []); await fxlMarcas(j.partida); return; }
    console.warn('fin_fluxo_limpo respondeu', r.status, '— leitura de reserva');
  } catch (e) { console.warn('fin_fluxo_limpo falhou — leitura de reserva:', e.message); }
  try {
    const [par, tit, det] = await Promise.all([
      consultarTudo('vw_fin_saldo_partida?select=conta,unidade,data_partida,saldo_partida'),
      consultarTudo('vw_fin_dia0_titulos?select=*'),
      consultarTudo(`vw_fin_previsto_detalhe?select=*&dia=lte.${fxSomaDias(prdHoje(), 90)}&order=dia,unidade,conta,origem,id_titulo,descricao_tela,valor`),
    ]);
    FXL = fxlMontar(par, tit, det);
    await fxlMarcas();
  } catch (e) { console.warn('Fluxo limpo sem as views novas:', e.message); FXL = null; }
}

// 24/10/2026: as contas cujo saldo inicial vem de extrato PARCIAL ou atrasado. Desde a correção do Financeiro (24/10, tarde),
// extrato parcial faz a partida RECUAR ao último dia completo (o número está certo, o aviso só explica de que dia ele vem);
// atrasado é dado faltando de verdade. A parte `partida` da RPC já traz os campos; a leitura de reserva lê a view.
async function fxlMarcas(par) {
  if (!FXL) return;
  try {
    const m = (par && par.length && 'partida_parcial' in par[0]) ? par
      : await consultarTudo('vw_fin_saldo_partida?select=conta,unidade,data_partida,partida_parcial,extrato_atrasado,fonte_partida,hora_extrato,ultimo_extrato_parcial_dia');
    FXL.parcial = (m || []).filter((p) => !fxlConta(p.conta) && p.fonte_partida !== 'SAIPOS' && (p.partida_parcial || p.extrato_atrasado));
  } catch (e) { FXL.parcial = null; }
}

function fxlConta(c) { return c && (String(c).startsWith('CREDITO') || PROJ_FORA_CAIXA.includes(c)); }

// 07/11/2026 (auditoria dos numeros, lote 1 — resultado-17, dinheiro-0, dinheiro-4): o "caixa de hoje" e o
// "menor saldo projetado" das outras telas (Hoje, A semana) saem DAQUI, do mesmo Fluxo projetado — antes
// cada tela tinha a sua conta (R$ 112,3 mil na Hoje, R$ 112,0 mil na A semana, R$ 106,2 mil no Fluxo, e o
// menor saldo da Rede +R$ 11,3 mil na Hoje contra −R$ 27,8 mil no grafico do Fluxo). Null sem o Fluxo.
function fxlResumo(u) {
  if (!FXL || !FXL.dias || !FXL.dias.length || !FXL.dias[0].unidades[u]) return null;
  let menorSaldo = Infinity, menorDia = null;
  FXL.dias.forEach((d) => { const v = d.unidades[u].saldo_final; if (v < menorSaldo) { menorSaldo = v; menorDia = d.dia; } });
  const x0 = FXL.dias[0].unidades[u];
  return { saldoInicial: x0.saldo_inicial, saldoFimHoje: x0.saldo_final, dataPartida: FXL.dataPartida, menorSaldo, menorDia };
}

function fxlMontar(par, tit, det) {
  const hoje = prdHoje(), N = 90;   // o grafico vai a 90 dias; a tabela, ate a segunda quarta (fxlDiasAte)
  const us = ['AGUA VERDE', 'AHU', 'SÃO BRAZ'];
  const inicial = {}; us.forEach((u) => { inicial[u] = 0; });
  let dataPartida = null;
  (par || []).filter((p) => !fxlConta(p.conta)).forEach((p) => {
    inicial[p.unidade] = (inicial[p.unidade] || 0) + Number(p.saldo_partida || 0);
    // a data do saldo e' a do extrato do banco; o cofre vem do Saipos com a data de hoje-1 e nao conta
    if (!/^COFRE/.test(p.conta) && (!dataPartida || p.data_partida > dataPartida)) dataPartida = p.data_partida;
  });
  const lin = (r, dia) => ({ unidade: r.unidade, conta: r.conta, lado: (r.sentido === 'PAGAR' || Number(r.efeito) < 0) ? 'PAGAR' : 'RECEBER',
    origem: r.origem, entre_lojas: r.entre_lojas === true || (r.entre_lojas == null && (r.origem === 'LISTAS' || projEntreLojas(r))), situacao: r.situacao || 'PREVISTO', descricao: String(r.descricao_tela || r.descricao || r.subtipo || '').replace(/\s*\(parc\.[^)]*\)\s*$/i, ''),   // dono 05/11: "(parc. …)" é da nossa carga, não está no Saipos
    subtipo: r.subtipo, tem_titulo: r.tem_titulo == null ? !!r.situacao && r.situacao !== 'PREVISTO' : r.tem_titulo,
    valor: Math.abs(Number(r.valor || r.efeito || 0)), efeito: Number(r.efeito || 0), vencimento: r.vencimento || dia });
  const porDia = {};
  for (let i = 0; i <= N; i++) porDia[fxSomaDias(hoje, i)] = [];
  (tit || []).filter((r) => !fxlConta(r.conta)).forEach((r) => porDia[hoje].push(lin(r, hoje)));
  (det || []).filter((r) => !fxlConta(r.conta) && porDia[r.dia]).forEach((r) => {
    // o que entra no dia 0 o banco marca (no_dia0); sem a marca, a lista de origens do Financeiro de 23/10
    if (r.dia === hoje && !(r.no_dia0 != null ? r.no_dia0 : FXL_DIA0_PREV.includes(r.origem))) return;   // o resto de hoje já está nos títulos
    porDia[r.dia].push(lin(r, r.dia));
  });
  const dias = [], saldo = { ...inicial };
  saldo.REDE = us.reduce((s, u) => s + (inicial[u] || 0), 0);
  Object.keys(porDia).sort().forEach((dia) => {
    const unidades = {};
    [...us, 'REDE'].forEach((u) => {
      // a Rede não conta o que uma loja paga à outra (entre_lojas: as duas pontas somam zero no dia)
      const comp = porDia[dia].filter((x) => u === 'REDE' ? (us.includes(x.unidade) && !x.entre_lojas) : x.unidade === u);
      const rec = comp.filter((x) => x.lado === 'RECEBER').reduce((s, x) => s + x.valor, 0);
      const pag = comp.filter((x) => x.lado === 'PAGAR').reduce((s, x) => s + x.valor, 0);
      const ini = saldo[u] || 0;
      unidades[u] = { saldo_inicial: ini, a_receber: rec, a_pagar: pag, saldo_final: ini + rec - pag, composicao: comp };
      saldo[u] = ini + rec - pag;
    });
    dias.push({ dia, unidades });
  });
  return { dias, dataPartida, aberto: null };
}

// o bônus que vai para a XP no dia (sai junto com o a pagar; em amarelo, como antes)
function fxlBonus(x) { return (x.composicao || []).filter((c) => c.lado === 'PAGAR' && /^BONUS/.test(c.origem || '')).reduce((s, c) => s + c.valor, 0); }

// clicar fora de um detalhe fecha o detalhe (dono, 23/10/2026)
document.addEventListener('click', (e) => {
  if (!FXL || (e.target.closest && e.target.closest('[data-fxl]'))) return;   // clique dentro de um detalhe ou num valor: nao fecha
  if (FXL.aberto) { FXL.aberto = null; const a = document.getElementById('fxlWrap'); if (a) a.innerHTML = blocoFluxoLimpo(); }
  if (typeof CP !== 'undefined' && CP && CP.fxlAberto) { CP.fxlAberto = null; const c = document.getElementById('cpHojeWrap'); if (c) c.innerHTML = cpHojeLimpo(); }
  if (typeof CP !== 'undefined' && CP && CP.crAberto) { CP.crAberto = null; if (document.getElementById('crFxlDet')) renderContasReceber(); }
});

// o grafico le os MESMOS numeros da tabela (saldo final de cada dia da loja escolhida)
function fxlGrafico() {
  const el = document.getElementById('chartProjecao');
  if (!FXL || !el) return;
  const u = lojaFin(), ds = FXL.dias, v = ds.map((d) => d.unidades[u].saldo_final);
  const bon = ds.map((d) => fxlBonus(d.unidades[u]) > 0.005);
  const lo = Math.min(0, ...v), hi = Math.max(0, ...v), folga = Math.max(5000, (hi - lo) * 0.1);
  destroyChart('chartProjecao');
  chartInstances['chartProjecao'] = new Chart(el.getContext('2d'), {
    type: 'line',
    data: { labels: ds.map((d) => d.dia.slice(8, 10) + '/' + d.dia.slice(5, 7)),
      datasets: [{ label: 'Saldo final do dia', data: v, borderColor: corToken('--info'), backgroundColor: corTokenA('--info', 0.12),
        fill: true, tension: 0.25, pointRadius: bon.map((b) => b ? 5 : 2),
        pointBackgroundColor: v.map((x, i) => x < 0 ? corToken('--farol-fora') : bon[i] ? corToken('--amber-2') : corToken('--info')) }] },
    options: { responsive: true, maintainAspectRatio: false, interaction: { mode: 'index', intersect: false },
      plugins: { legend: { display: false },
        tooltip: { callbacks: { label: (c) => `${c.parsed.y < -0.005 ? '−' : ''}R$ ${fmt(Math.abs(c.parsed.y))}${bon[c.dataIndex] ? ' · sai bônus para a XP' : ''}` } } },
      onClick: (_e, els) => { if (!els.length) return; const r = document.getElementById('fxl-dia-' + ds[els[0].index].dia); if (r) r.scrollIntoView({ behavior: 'smooth', block: 'center' }); },
      scales: { y: { title: { display: true, text: 'R$' }, min: Math.floor((lo - folga) / 5000) * 5000, max: Math.ceil((hi + folga) / 5000) * 5000,
                     grid: { color: (ctx) => ctx.tick.value === 0 ? 'rgba(255,107,107,0.45)' : undefined } },
                x: { ticks: { maxRotation: 60, autoSkip: true } } } },
  });
}

function fxlAbrir(k) { FXL.aberto = FXL.aberto === k ? null : k; const a = document.getElementById('fxlWrap'); if (a) a.innerHTML = blocoFluxoLimpo(); }

function fxlLoja(u) { FXL.aberto = null; finPedirLoja(u); }

function fxlComposicao(itens, titulo) {
  const reais = (v) => 'R$ ' + fmt(v);
  const dm = (s) => s ? String(s).slice(8, 10) + '/' + String(s).slice(5, 7) : '';
  const l = itens.slice().sort((a, b) => b.valor - a.valor);
  const grupos = {};
  l.forEach((x) => { const g = FXL_ORIGEM[x.origem] || String(x.origem || '').toLowerCase(); (grupos[g] = grupos[g] || []).push(x); });
  const ordem = Object.keys(grupos).sort((a, b) => grupos[b].reduce((s, x) => s + x.valor, 0) - grupos[a].reduce((s, x) => s + x.valor, 0));
  return `<div class="contexto" data-fxl="1" style="text-align:left; margin:6px 0 10px;"><b>${titulo}</b> · ${l.length} ${l.length === 1 ? 'item' : 'itens'} · ${reais(l.reduce((s, x) => s + x.valor, 0))}
    ${ordem.map((g) => `<div style="margin-top:8px; font-weight:700;">${trEscH(g)} <span style="font-weight:400; color:var(--tx-4);">· ${reais(grupos[g].reduce((s, x) => s + x.valor, 0))}</span></div>
      ${grupos[g].map((x) => {
        const incerto = /EMPRESTIMO/i.test(x.subtipo || '') || /EMPRESTIMO/i.test(x.descricao || '');
        return `<div style="display:flex; justify-content:space-between; gap:12px; font-size:12.5px; padding:2px 0 2px 10px; border-bottom:1px solid var(--line);">
          <span>${trEscH(x.descricao)}${x.situacao && x.situacao !== 'PREVISTO' ? ` <span style="color:var(--tx-5); font-size:11px;">· ${trEscH(x.situacao.toLowerCase())}${x.situacao === 'EM ABERTO' && x.vencimento ? ', venceu ' + dm(x.vencimento) : ''}</span>` : ''}${
            incerto ? ' <span style="color:var(--amber-2); font-size:11px;">· pode não cair</span>' : ''}${x.unidade && lojaFin() === 'REDE' ? ` <span style="color:var(--tx-5); font-size:11px;">· ${trEscH(x.unidade)}</span>` : ''}</span>
          <b style="white-space:nowrap;">${reais(x.valor)}</b></div>`; }).join('')}`).join('')}
  </div>`;
}

function blocoFluxoLimpo() {
  if (!FXL || !FXL.dias.length) return '';
  const reais = (v) => (v < -0.005 ? '−' : '') + 'R$ ' + fmt(Math.abs(v));
  const mil = (v) => (Math.abs(v) < 0.5 ? '0' : (v < 0 ? '−' : '') + fmt(Math.abs(v)).replace(/,\d\d$/, ''));
  const SEM = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb'];
  const dm = (s) => String(s).slice(8, 10) + '/' + String(s).slice(5, 7);
  const rot = (s) => `${dm(s)} (${SEM[new Date(s + 'T12:00:00').getDay()]})`;
  const d0 = FXL.dias[0], d7 = FXL.dias[Math.min(7, FXL.dias.length - 1)];
  const soma = (u, de, ate, campo) => FXL.dias.slice(de, ate + 1).reduce((s, d) => s + d.unidades[u][campo], 0);
  const k7 = Math.min(7, FXL.dias.length - 1);
  const lk = (k, v, cor) => `<a href="javascript:void(0)" data-fxl="1" onclick="fxlAbrir('${k}')" style="color:${cor || 'inherit'}; text-decoration:underline dotted;" title="ver o que compõe">${mil(v)}</a>`;
  const corHoje = corTokenA('--info', 0.22), cor7 = corTokenA('--amber-2', 0.22);
  // ---- o quadro: por loja, hoje e 7 dias ----
  let h = `<div class="section-label">Caixa de hoje — ${dm(d0.dia)}</div>
    <div id="tabelaFxlQuadro" style="overflow-x:auto;"><table><thead>
      <tr><th rowspan="2">Loja</th><th rowspan="2">Saldo inicial</th><th colspan="3" style="background:${corHoje}; text-align:center;">Hoje</th>
        <th colspan="3" style="background:${cor7}; text-align:center;">Até ${dm(d7.dia)} (7 dias)</th></tr>
      <tr><th style="background:${corHoje};">A receber</th><th style="background:${corHoje};">A pagar</th><th style="background:${corHoje};">Saldo final</th>
        <th style="background:${cor7};">A receber</th><th style="background:${cor7};">A pagar</th><th style="background:${cor7};">Saldo final</th></tr></thead><tbody>`;
  finLinhas().forEach(([u, nome]) => {
    const x0 = d0.unidades[u], x7 = d7.unidades[u];
    const rede = u === 'REDE';
    h += `<tr${rede ? ' class="liq"' : ''}>
      <td><a href="javascript:void(0)" onclick="fxlLoja('${u}')" style="color:inherit;">${nome}</a></td>
      <td>${mil(x0.saldo_inicial)}</td>
      <td>${lk(`Q|${u}|0|0|RECEBER`, x0.a_receber)}</td><td>${lk(`Q|${u}|0|0|PAGAR`, x0.a_pagar)}</td>
      <td style="font-weight:700; color:${x0.saldo_final < 0 ? 'var(--farol-fora)' : 'inherit'};">${mil(x0.saldo_final)}</td>
      <td>${lk(`Q|${u}|0|${k7}|RECEBER`, soma(u, 0, k7, 'a_receber'))}</td><td>${lk(`Q|${u}|0|${k7}|PAGAR`, soma(u, 0, k7, 'a_pagar'))}</td>
      <td style="font-weight:700; color:${x7.saldo_final < 0 ? 'var(--farol-fora)' : 'inherit'};">${mil(x7.saldo_final)}</td></tr>`;
  });
  h += `</tbody></table></div>
    ${(() => {
      const ps = FXL.parcial || [], atr = ps.filter((p) => p.extrato_atrasado), parc = ps.filter((p) => !p.extrato_atrasado && p.partida_parcial);
      const hhmm = (t) => t ? String(t).slice(11, 16).replace(':', 'h') : '';
      // contas com o mesmo extrato parcial (mesmo dia e hora) numa frase só
      const grupos = {};
      parc.forEach((p) => { const k = `${p.ultimo_extrato_parcial_dia || ''}|${p.hora_extrato || ''}|${p.data_partida}`; (grupos[k] = grupos[k] || []).push(p); });
      const frasesParc = Object.values(grupos).map((g) => {
        const p = g[0];
        return `${g.map((x) => trEscH(x.conta)).join(', ')}: o extrato de ${p.ultimo_extrato_parcial_dia ? dm(p.ultimo_extrato_parcial_dia) : 'hoje'} é parcial${p.hora_extrato ? ` (baixado às ${hhmm(p.hora_extrato)} de ${dm(String(p.hora_extrato).slice(0, 10))})` : ''}, então o saldo inicial é o do fim de ${dm(p.data_partida)}, e o que o Saipos mostra pago ou recebido depois disso entra em hoje.`;
      });
      return (frasesParc.length ? `<div class="contexto" style="text-align:left;">${frasesParc.join('<br>')}</div>` : '')
        + (atr.length ? `<div class="contexto" style="text-align:left; border-color:var(--amber-2);"><b style="color:var(--amber-2);">Extrato atrasado:</b>
          ${atr.map((p) => `${trEscH(p.conta)} — o último é de ${dm(p.data_partida)}`).join(' · ')}. O que entrou e saiu depois disso ainda não está no número.</div>` : '');
    })()}
    <div class="caption-label" style="text-align:left;">Em R$. <b>Saldo inicial</b> = bancos + cofre no fim do último dia com extrato completo de cada conta; o que o Saipos mostra pago ou recebido depois disso entra em hoje.
      <b>A receber</b> e <b>A pagar</b> = os títulos do Saipos + o que está previsto e ainda não tem título (nada conta duas vezes; o que já mexeu no banco hoje não entra).
      <b>Saldo final</b> = inicial + a receber − a pagar. É o mesmo número das linhas abaixo. Clique num valor para ver o que o compõe.</div>`;
  const ab = FXL.aberto && FXL.aberto.startsWith('Q|') && FXL.aberto.split('|');
  if (ab) {
    const [, u, de, ate, lado] = ab;
    const itens = FXL.dias.slice(Number(de), Number(ate) + 1).flatMap((d) => d.unidades[u].composicao.filter((x) => x.lado === lado));
    const nome = lojaNome(u);
    h += fxlComposicao(itens, `${lado === 'PAGAR' ? 'A pagar' : 'A receber'} · ${nome} · ${de === ate ? 'hoje' : 'hoje até ' + dm(FXL.dias[Number(ate)].dia)}`);
  }
  // ---- as linhas, por dia ----
  const u = lojaFin();
  const nomeU = lojaNome(u);
  const diasTab = FXL.dias.slice(0, Math.min(FXL.dias.length, fxlDiasAte() + 1));
  h += `<div class="section-label">Dia a dia até ${dm(diasTab[diasTab.length - 1].dia)} — ${nomeU}</div>
    <div id="tabelaFxlDias" style="overflow-x:auto;"><table><thead><tr><th>Dia</th><th>Saldo inicial</th><th>A receber</th><th>A pagar</th><th>Saldo final</th></tr></thead><tbody>`;
  diasTab.forEach((d, i) => {
    const x = d.unidades[u];
    const kR = `L|${u}|${i}|RECEBER`, kP = `L|${u}|${i}|PAGAR`;
    h += `<tr id="fxl-dia-${d.dia}"><td style="white-space:nowrap;"><b>${rot(d.dia)}</b>${i === 0 ? ' <span style="color:var(--tx-5); font-size:11px;">hoje</span>' : ''}</td>
      <td>${reais(x.saldo_inicial)}</td>
      <td><a href="javascript:void(0)" data-fxl="1" onclick="fxlAbrir('${kR}')" style="color:inherit; text-decoration:underline dotted;">${x.a_receber > 0.005 ? reais(x.a_receber) : '—'}</a></td>
      <td><a href="javascript:void(0)" data-fxl="1" onclick="fxlAbrir('${kP}')" style="color:inherit; text-decoration:underline dotted;">${x.a_pagar > 0.005 ? reais(x.a_pagar) : '—'}</a>${
        fxlBonus(x) > 0.005 ? `<div style="font-size:11px; color:var(--amber-2);">com ${reais(fxlBonus(x))} de bônus para a XP</div>` : ''}</td>
      <td style="font-weight:700; color:${x.saldo_final < 0 ? 'var(--farol-fora)' : 'var(--farol-ok)'};">${reais(x.saldo_final)}</td></tr>`;
    if (FXL.aberto === kR || FXL.aberto === kP) {
      const lado = FXL.aberto === kR ? 'RECEBER' : 'PAGAR';
      h += `<tr><td colspan="5" style="white-space:normal;">${fxlComposicao(x.composicao.filter((c) => c.lado === lado), `${lado === 'PAGAR' ? 'A pagar' : 'A receber'} · ${nomeU} · ${rot(d.dia)}`)}</td></tr>`;
    }
  });
  h += `</tbody></table></div>`;
  return h;
}

function renderModuloProjecao() {
  const alvo = document.getElementById('view-projecao');
  // a Rede, sempre: e' a conta que esta tela mostra desde 12/09/2026
  const { hoje, iso, hojeIso, HORIZONTE, caixaOper, investido, atrasoSaipos, idadeMax, dataExtrato, temAncora,
          janelaReceb, mediaDow, mediaSemana, pagarDia, receberDia, itensDia, vencidas, entreLojasFora,
          dias, serieSaldo, serieMedia, serieSemAtacado, menorSaldo, menorDia, pagar30, bonusDia, costumaDia, serieCostuma, atacado } = projCalc('');
  // atacado sem contar em dobro (regra do maior acumulado): ha o que tirar? (false = sem boleto a receber, ou a leitura nao veio)
  const temAtacado = !!(atacado && atacado.fora > 0.005);
  // a media sem o atacado, em centavos fechados (para o texto do cartao bater com os dois numeros que estao na tela)
  const mediaSemAtacado = temAtacado ? (Math.round(mediaSemana * 100) - Math.round(atacado.semana * 100)) / 100 : mediaSemana;

  // ---- agenda de vencimentos (dias com lancamento, proximos 30) ----
  const fmtDia = (dIso) => {
    const d = new Date(dIso + 'T00:00:00');
    return `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')} (${['dom','seg','ter','qua','qui','sex','sáb'][d.getDay()]})`;
  };
  let agenda = '';
  Object.keys(itensDia).sort().forEach(dia => {
    if (dia > iso(new Date(hoje.getTime() + 30 * 86400000))) return;
    const itens = itensDia[dia];
    const tot = (pagarDia[dia] || 0) + (bonusDia[dia] || 0) - (receberDia[dia] || 0);
    const eHoje = dia === hojeIso;
    agenda += `
    <details id="proj-dia-${dia}" style="border-bottom:1px solid #232321;">
      <summary style="cursor:pointer; padding:7px 4px; display:flex; justify-content:space-between;">
        <span>${fmtDia(dia)}${eHoje && vencidas > 0.005 ? ' <span style="color:#ff6b6b;">(inclui vencidas)</span>' : ''}</span>
        <b class="${tot > 0 ? 'negativo' : ''}" style="${tot > 0 ? '' : 'color:#3fb950;'}">${tot > 0 ? '−' : '+'} R$ ${fmt(Math.abs(tot))}</b>
      </summary>
      ${itens.sort((a, b) => (b.debito - b.credito) - (a.debito - a.credito)).map(r => `
        <div style="display:flex; justify-content:space-between; padding:3px 4px 3px 22px; font-size:12px; color:#a5a49a;">
          <span>${r.subtipo}${r.descricao ? ' — ' + r.descricao.slice(0, 60) : ''}</span>
          <span class="${r.debito > r.credito ? 'negativo' : ''}">${r.debito > r.credito ? '−' : '+'} R$ ${fmt(Math.abs(r.debito - r.credito))}</span>
        </div>`).join('')}
    </details>`;
  });
  const corMenor = menorSaldo < 0 ? corToken('--farol-fora') : menorSaldo < mediaSemana ? corToken('--farol-perto') : corToken('--farol-ok');

  // ---- aplicado da proposta do chat financeiro (13/08/2026), decisoes do
  // dono: XP fora do fluxo diario, frase de sobra/falta, de onde vem a
  // entrada projetada e o a-pagar resumido por grupo ----
  const diasAteMenor = Math.round((new Date(menorDia + 'T00:00:00') - hoje) / 86400000);

  // ---- peca 4 (aplicada da fila em 17/08/2026): conta aberta do menor saldo ----
  // A soma fecha com menorSaldo POR CONSTRUCAO (mesmos numeros do loop da projecao);
  // o console.assert e' o guarda disso se alguem mexer no loop e esquecer daqui.
  let entAteMenor = receberDia[hojeIso] || 0, comprPeriodo = 0;
  for (let i = 1; i <= diasAteMenor; i++) {
    const d = new Date(hoje); d.setDate(d.getDate() + i);
    entAteMenor += serieMedia[i] + (receberDia[iso(d)] || 0) - ((serieSemAtacado || [])[i] || 0);   // a entrada que o motor USOU no dia (sem contar o atacado duas vezes)
  }
  Object.keys(pagarDia).forEach(dia => { if (dia <= menorDia) comprPeriodo += pagarDia[dia]; });
  comprPeriodo -= vencidas;   // vencidas de verdade ganham linha propria
  let bonusPeriodo = 0;       // o bonus que vai para a aplicacao ate o dia do aperto: linha propria
  Object.keys(bonusDia).forEach(dia => { if (dia <= menorDia) bonusPeriodo += bonusDia[dia]; });
  console.assert(Math.abs(caixaOper + entAteMenor - vencidas - comprPeriodo - bonusPeriodo - menorSaldo) < 0.01);

  const linhasConta = [
    ['Caixa hoje' + (temAncora ? ' (extrato do banco)' : ''), caixaOper, ''],
    [`+ entradas previstas até ${fmtDia(menorDia)}`, entAteMenor, 'color:#3fb950;'],
    vencidas > 0.005 ? ['− já vencido (sem débito no banco)', -vencidas, 'color:#ff6b6b;'] : null,
    [`− contas que vencem até ${fmtDia(menorDia)}`, -comprPeriodo, ''],
    bonusPeriodo > 0.005 ? [`− bônus do iFood guardado até ${fmtDia(menorDia)}`, -bonusPeriodo, ''] : null,
  ].filter(Boolean);
  const contaAberta = `<table style="width:100%; font-size:12.5px; margin-top:6px;">
    ${linhasConta.map(([t, v, cor]) => `<tr><td>${t}</td>
      <td style="text-align:right; ${cor}">R$ ${fmt(v)}</td></tr>`).join('')}
    <tr style="border-top:1px solid #45443f;"><td><b>= menor saldo, em ${fmtDia(menorDia)}</b></td>
      <td style="text-align:right;"><b style="color:${corMenor};">R$ ${fmt(menorSaldo)}</b></td></tr>
  </table>`;

  // a frase ganha o MOTIVO: o maior dos 3 componentes do aperto
  const componentes = [
    [vencidas, 'do que já venceu e ainda não saiu do banco — cobrar ou quitar'],
    [comprPeriodo, 'de contas que vencem no período (as faturas de cartão já estão aqui, na data de cada uma) — dá para conversar data com fornecedor'],
  ].sort((a, b) => b[0] - a[0]);
  const motivo = componentes[0][0] > 0.005
    ? `O maior peso vem ${componentes[0][1]} (R$ ${fmt(componentes[0][0])}).` : '';

  // 22/10/2026: a pergunta "vai faltar?" responde pela conta REALISTA (com o que costuma sair e ninguém lança antes),
  // na MESMA janela do Saldo dia a dia (até a segunda quarta-feira), para os dois números serem um só; as duas pontas da
  // estimativa dão a faixa. Sem a estimativa, fica a frase de antes.
  const P30 = projCalc('');
  const dowP = (s) => new Date(s + 'T00:00:00').getDay();
  let n30 = 0;
  for (let k = 1, quartas = 0; k < dias.length && quartas < 2; k++) { if (dowP(dias[k]) === 3) quartas++; n30 = k; }
  n30 = Math.min(n30 + 1, (P30.serieCostuma || []).length);
  let fraseReal = '';
  if (P30.serieCostuma && P30.serieRitmo && n30) {
    let iC = 0, iR = 0;
    for (let k = 0; k < n30; k++) { if (P30.serieCostuma[k] < P30.serieCostuma[iC]) iC = k; if (P30.serieRitmo[k] < P30.serieRitmo[iR]) iR = k; }
    const lo = Math.min(P30.serieCostuma[iC], P30.serieRitmo[iR]), hi = Math.max(P30.serieCostuma[iC], P30.serieRitmo[iR]);
    const diaPior = fmtDia(dias[iC]);
    const volta = (() => { for (let k = iC + 1; k < P30.serieCostuma.length; k++) if (P30.serieCostuma[k] >= 0) return fmtDia(dias[k]); return null; })();
    const faixaTxt = Math.abs(hi - lo) < 500 ? `R$ ${fxInt(Math.abs(lo))}` : `entre R$ ${fxInt(Math.abs(hi))} e R$ ${fxInt(Math.abs(lo))}`;
    fraseReal = lo < 0
      ? `<div class="contexto" style="border-color:var(--farol-fora); text-align:left;">
           <b style="font-size:15px;">Vai faltar dinheiro: ${faixaTxt} por volta de ${diaPior}.</b>
           ${volta ? `Volta ao azul em ${volta}.` : `Não volta ao azul até ${fmtDia(dias[n30 - 1])}.`}<br>
           <span style="font-size:12px; color:var(--tx-3);">Contando o que costuma sair e ainda não foi lançado (mercadoria, motoboys, diaristas). Para cobrir: adiar pagamento ou antecipar recebível.
           Só com o que já está lançado, o dia mais apertado é ${fmtDia(menorDia)}, com R$ ${fmt(menorSaldo)}.</span>
         </div>`
      : `<div class="contexto" style="border-color:var(--farol-ok); text-align:left;">
           <b style="font-size:15px;">Não falta dinheiro até ${fmtDia(dias[n30 - 1])}.</b>
           Dia mais apertado: ${diaPior}, com cerca de R$ ${fxInt(hi)}, contando o que costuma sair.
         </div>`;
  }
  const fraseDecisao = fraseReal ? fraseReal : menorSaldo < 0
    ? `<div class="contexto" style="border-color:#ff6b6b; text-align:left;">
         <b style="font-size:15px;">Vai faltar R$ ${fmt(Math.abs(menorSaldo))} em ${fmtDia(menorDia)}</b>
         (daqui a ${diasAteMenor} dias). ${motivo}<br>
         <span style="font-size:12px; color:#a5a49a;">Para cobrir: adiar
         pagamento ou antecipar recebível. O valor é o pior momento do período, não o fim dele.</span>
         ${contaAberta}
       </div>`
    : `<div class="contexto" style="border-color:#3fb950; text-align:left;">
         <b style="font-size:15px;">O caixa se sustenta nos próximos ${HORIZONTE} dias.</b>
         Momento mais apertado: R$ ${fmt(menorSaldo)} em ${fmtDia(menorDia)}.
         ${contaAberta}
       </div>`;

  // as alavancas: as maiores saidas ate o dia do aperto (cada linha e' uma decisao)
  const maioresSaidas = Object.keys(itensDia).filter(d => d <= menorDia)
    .flatMap(d => itensDia[d].filter(r => r.origem !== 'BONUS')   // o bonus vai de qualquer forma: nao e' alavanca
      .map(r => ({ dia: d, txt: `${r.subtipo}${r.descricao ? ' — ' + r.descricao.slice(0, 40) : ''}`, v: r.debito - r.credito })))
    .filter(x => x.v > 0);
  maioresSaidas.sort((a, b) => b.v - a.v);
  const alavancas = maioresSaidas.length ? `
    <div class="contexto" style="text-align:left;">
      <b>As maiores saídas até lá</b> — adiar, renegociar ou conferir uma delas muda o quadro:
      <div style="margin-top:6px;">
        ${maioresSaidas.slice(0, 5).map(x => `<div style="display:flex; justify-content:space-between; gap:10px; padding:3px 0; font-size:12.5px;">
          <span style="color:#a5a49a;">${fmtDia(x.dia)} · ${x.txt}</span>
          <b style="white-space:nowrap;">R$ ${fmt(x.v)}</b></div>`).join('')}
      </div>
    </div>` : '';

  const faixaAplicacao = `<div class="contexto" style="text-align:left; border-color:#58a6ff;">
     <b>Aplicação (XP + Participações): R$ ${fmt(investido)}</b> — fora do fluxo diário.
     <div style="font-size:12px; color:#a5a49a; margin-top:4px;">
       No Saipos lançamos apenas a <b>saída do Itaú para a aplicação</b>; o que acontece lá dentro
       (rendimento, IR, IOF) é controlado pelo Fabio, fora deste painel. Por isso este valor não
       entra no saldo projetado nem cobre as contas a pagar.
     </div>
   </div>`;

  const DIAS_SEM = ['domingo','segunda','terça','quarta','quinta','sexta','sábado'];

  // ---- a conta aberta da media, POR TIPO de receita (pedido do dono 17/08:
  // conferir se as medias e as classificacoes estao coerentes). Usa EXATAMENTE
  // a mesma janela de 28 dias da projecao — o TOTAL fecha com mediaSemana por
  // construcao, e o console.assert e' o guarda disso. ----
  const datasJanela = janelaReceb.map(r => r.data).filter(d => !projDistorcido(d));   // sem feriado e o dia que recebe por ele
  const setDatas = new Set(datasJanela);
  const blocos = [0, 1, 2, 3].map(i => datasJanela.slice(i * 7, i * 7 + 7));
  const rotuloBloco = (b) => b.length ? `${b[0].slice(8,10)}/${b[0].slice(5,7)}–${b[b.length-1].slice(8,10)}/${b[b.length-1].slice(5,7)}` : '—';
  const porSub = {};
  const porSubDia = {};
  (PROJ_RECEB_SUB || []).filter(r => setDatas.has(r.data) && !projForaDaMedia(r.subtipo)).forEach(r => {   // o Boqueirao entra pela provisao mensal, nao pela media (18/10/2026)
    const p = porSub[r.subtipo] || (porSub[r.subtipo] = [0, 0, 0, 0]);
    const i = blocos.findIndex(b => b.includes(r.data));
    if (i >= 0) p[i] += r.recebido;
    (porSubDia[r.subtipo] = porSubDia[r.subtipo] || {})[r.data] =
      ((porSubDia[r.subtipo] || {})[r.data] || 0) + r.recebido;
  });
  // media semanal POR SUBTIPO calculada DO JEITO DO MOTOR: media por dia da
  // semana (dia presente sem aquele subtipo conta como zero), somada nos 7
  // dias — a soma dos subtipos fecha com mediaSemana EXATAMENTE.
  const diasPorDow = {};
  datasJanela.forEach(d => { const w = new Date(d + 'T00:00:00').getDay(); (diasPorDow[w] = diasPorDow[w] || []).push(d); });
  const mediaMotorSub = (sub) => Object.values(diasPorDow).reduce((acc, ds) =>
    acc + ds.reduce((s, d) => s + ((porSubDia[sub] || {})[d] || 0), 0) / ds.length, 0);
  const subsOrdenados = Object.entries(porSub)
    .map(([s, v]) => ({ s, v, total: v.reduce((a, x) => a + x, 0), media: mediaMotorSub(s) }))
    .sort((a, b) => b.media - a.media);
  const somaMedias = subsOrdenados.reduce((a, x) => a + x.media, 0);
  console.assert(Math.abs(somaMedias - mediaSemana) < 0.05, 'media por subtipo nao fecha com a da projecao');
  const composicaoSub = `
    <div class="section-label">De onde vem a entrada projetada — por tipo de receita</div>
    <div class="caption-label" style="text-align:center;">As mesmas 4 semanas que alimentam a média da projeção,
      abertas tipo a tipo — para conferir se as médias e as classificações fazem sentido. Recebimentos
      que <b>caíram na conta</b>, não vendas.</div>
    <div id="tabelaProjReceitas"><table>
      <tr><th>Tipo de receita</th>${blocos.map(b => `<th>${rotuloBloco(b)}</th>`).join('')}<th>Média / semana (a da projeção)</th><th>% da entrada</th></tr>
      ${subsOrdenados.map(x => `<tr><td>${x.s}</td>
        ${x.v.map(v => `<td>R$ ${fmt(v)}</td>`).join('')}
        <td><b>R$ ${fmt(x.media)}</b></td>
        <td>${somaMedias ? pct(x.media / somaMedias * 100) : 0}%</td></tr>`).join('')}
      <tr class="liq"><td>TOTAL</td>${blocos.map((b, i) => `<td>R$ ${fmt(subsOrdenados.reduce((a, x) => a + x.v[i], 0))}</td>`).join('')}
        <td><b>R$ ${fmt(mediaSemana)}</b></td><td>100%</td></tr>
    </table></div>
    <div class="caption-label">As 4 colunas de datas são os últimos 28 dias com recebimento, em blocos de 7 — por isso
      um bloco pode atravessar mais de 7 dias de calendário. A média da direita é calculada como o motor da projeção
      calcula: <b>média por dia da semana</b> — por isso ela não é a soma das colunas ÷ 4. O TOTAL fecha ao centavo
      com a "Receita projetada / semana" do card lá em cima.${temAtacado ? ` <b>O atacado não conta duas vezes:</b> a projeção não soma
      a média dele (R$ ${fmt(atacado.semana)} por semana) com os boletos a receber (R$ ${fmt(atacado.boletos)}) — de hoje até cada dia, vale o maior dos dois.` : ''}${projProvisaoFrase('') ? ' ' + projProvisaoFrase('') : ''}</div>`;

  const composicao = `
    ${composicaoSub}
    <details class="detalhes-extra">
      <summary>A mesma média, por dia da semana (é assim que ela entra na projeção)</summary>
      <table style="width:100%; font-size:12.5px; margin-top:8px;">
        <tr><th style="text-align:left;">Dia da semana</th><th>Média das últimas 4 semanas</th></tr>
        ${[1,2,3,4,5,6,0].map(d => `<tr><td>${DIAS_SEM[d]}</td>
          <td>R$ ${fmt(mediaDow[d] || 0)}</td></tr>`).join('')}
        <tr style="border-top:1px solid #45443f;"><td><b>Semana</b></td>
          <td><b>R$ ${fmt(mediaSemana)}</b></td></tr>
      </table>
      <div style="font-size:12px; color:#a5a49a; margin-top:6px;">
        Contas a receber já lançadas no Saipos entram por cima disso, na data do vencimento —
        R$ ${fmt(dias.reduce((s, d) => s + (receberDia[d] || 0), 0))} nos próximos ${HORIZONTE} dias.
        ${entreLojasFora > 0.005 ? `Ficam de fora as cobranças em aberto da Água Verde contra o Ahú e o São Braz (listas e benefício): R$ ${fmt(entreLojasFora)} — na Rede é dinheiro que só troca de bolso.` : ''}
      </div>
    </details>`;

  const porGrupo = {};
  PROJ_PAGAR.filter(r => r.debito > 0).forEach(r => {
    porGrupo[r.tipo] = (porGrupo[r.tipo] || 0) + r.debito;
  });
  const resumoPagar = Object.entries(porGrupo).sort((a, b) => b[1] - a[1]);
  const blocoPagar = `<div class="section-label">O que tem para pagar (por grupo)</div>
   <div class="contexto" style="text-align:left;">
     ${resumoPagar.map(([g, v]) => `<div style="display:flex; justify-content:space-between; padding:3px 0;">
        <span>${g}</span><b>R$ ${fmt(v)}</b></div>`).join('')}
     <div style="display:flex; justify-content:space-between; padding:6px 0 0; border-top:1px solid #45443f;">
       <b>Total lançado</b><b>R$ ${fmt(resumoPagar.reduce((s, x) => s + x[1], 0))}</b></div>
   </div>`;

  // FLUXO PROJETADO ENXUTO (dono, 16/10/2026: "o foco aqui é visualizar facilmente ... prioriza a ordem
  // das informações mais importante de cima pra baixo"). A tela responde UMA pergunta — vai faltar dinheiro,
  // quando e quanto. O que e' lista de pagar foi para Contas a pagar (pagar hoje conta a conta, vencidas,
  // agenda, por grupo, maiores contas, comissao e bonus); o que e' a receber foi para Contas a receber
  // (atacado, filiais). A conta por tras fica recolhida em "Como a conta e' feita".
  const j7 = projJanela({ dias, serieMedia, receberDia, serieSemAtacado, pagarDia, bonusDia }, 0, 7);
  const ate7 = fmtDia(j7.ate);
  const cartao = (cls, rot, val, sub, tela, estilo) => `<div class="card ${cls}"${tela ? ` style="cursor:pointer;${estilo || ''}" onclick="mostrarModulo('${tela}')" title="abrir ${tela === 'contaspagar' ? 'Contas a pagar' : 'Contas a receber'}"` : (estilo ? ` style="${estilo}"` : '')}>
      <div class="card-lbl">${rot}</div><div class="card-val"${cls === '' && estilo ? ` style="color:${corMenor};"` : ''}>${val}</div><div class="card-pct">${sub}</div></div>`;
  alvo.innerHTML = plcCabecalhoQuebra('projecao') + `
  <div class="section-label" style="border-top:none; margin-top:0; padding-top:0;">Fluxo projetado</div>
  <div class="caption-label" style="text-align:center;">Quanto tem, o que sai e o que entra, por loja e na Rede.</div>
  ${FXL ? `<div id="fxlWrap">${blocoFluxoLimpo()}</div><div id="projDiaWrap" style="display:none;"></div>` : `${blocoCaixaHoje()}
  <div id="projDiaWrap">${blocoSaldoDiaADia()}</div>`}
  <div class="section-label">${FXL ? `Saldo final de cada dia — próximos ${FXL.dias.length - 1} dias` : `Os próximos ${HORIZONTE} dias`}</div>
  <div style="height:260px; margin:6px 0 14px;"><canvas id="chartProjecao"></canvas></div>
  <div class="caption-label" style="text-align:left;">${FXL ? 'Os mesmos números da tabela, da loja escolhida acima. Ponto amarelo: dia em que sai bônus para a XP; vermelho: saldo negativo. Clique num dia para ir à linha dele.' : 'Clique num dia do gráfico para abrir as contas dele na tabela acima (até a segunda quarta-feira).'}</div>
`;

  if (FXL) { fxlGrafico(); return; }   // 23/10/2026: o grafico do Fluxo limpo le os mesmos numeros da tabela
  destroyChart('chartProjecao');
  chartInstances['chartProjecao'] = new Chart(document.getElementById('chartProjecao').getContext('2d'), {
    type: 'line',
    data: {
      labels: dias.map(d => d.slice(8, 10) + '/' + d.slice(5, 7)),
      datasets: [{
        label: costumaDia ? 'Só com o que está lançado' : 'Saldo projetado',
        data: serieSaldo,
        borderColor: corToken('--info'),
        backgroundColor: corTokenA('--info', 0.12),
        fill: true, tension: 0.25,
        pointRadius: dias.map(d => d === menorDia ? 5 : 2),
        pointBackgroundColor: dias.map(d => d === menorDia ? corMenor : corToken('--info')),
      }].concat(costumaDia ? [{
        // ESTIMATIVA: o mesmo saldo menos o que costuma sair e ninguem lanca antes (a conta vem do banco, pelo motor)
        label: 'Com o que costuma sair (estimativa)',
        data: serieCostuma,
        borderColor: corToken('--tx-2'),
        borderDash: [6, 4], borderWidth: 2,
        fill: false, tension: 0.25, pointRadius: 0,
      }] : []),
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      // Clicar no dia abre a linha dele na agenda logo abaixo (12/09/2026). A
      // agenda tem so os 30 primeiros dias e so os dias COM lancamento, enquanto
      // o grafico vai ate HORIZONTE=45: nos dias sem destino o cursor nao vira
      // mao, entao o clique que nao leva a lugar nenhum nem chega a ser
      // oferecido. `index`/`intersect:false` para pegar o dia pela coluna — o
      // ponto tem 2px e ninguem acerta nele.
      interaction: { mode: 'index', intersect: false },
      onClick: (_e, els) => {
        if (!els.length) return;
        const dia = dias[els[0].index];
        if (!document.getElementById('proj-sd-' + dia)) return;
        PROJ_DIA.aberto[dia] = true;
        projDiaPintar();
        const linha = document.getElementById('proj-sd-' + dia);
        if (linha) linha.scrollIntoView({ behavior: 'smooth', block: 'center' });
      },
      onHover: (e, els) => {
        const temDestino = els.length && document.getElementById('proj-sd-' + dias[els[0].index]);
        e.native.target.style.cursor = temDestino ? 'pointer' : 'default';
      },
      plugins: {
        legend: { display: !!costumaDia },   // duas linhas pedem legenda
        // com as duas linhas: o nome de cada uma, negativo com o sinal na frente, e a estimativa sem centavos
        tooltip: { callbacks: { label: (c) => !costumaDia ? `R$ ${fmt(c.parsed.y)}`
          : `${c.dataset.label}: ${c.parsed.y < -0.005 ? '−' : ''}R$ ${c.datasetIndex === 1 ? fxInt(Math.abs(c.parsed.y)) : fmt(Math.abs(c.parsed.y))}` } },
      },
      scales: {
        // a linha do zero so aparece quando a escala cruza o zero — que e'
        // exatamente quando importa (peca 4)
        y: { title: { display: true, text: 'R$' },
             ...(costumaDia ? (() => { const v = serieCostuma.concat(serieSaldo.slice(0, 15)); const lo = Math.min(0, ...v), hi = Math.max(...serieCostuma, 0);
                                       const folga = Math.max(10000, (hi - lo) * 0.15); return { min: Math.floor((lo - folga) / 10000) * 10000, max: Math.ceil((hi + folga) / 10000) * 10000 }; })() : {}),
             grid: { color: (ctx) => ctx.tick.value === 0 ? 'rgba(255,107,107,0.45)' : undefined } },
        x: { ticks: { maxRotation: 60, autoSkip: true } },
      },
    },
  });
}

// ------------------------------------------------------------------
// Modulo Analise de Despesas — onde o dinheiro esta indo e o que mudou.
// Base: vw_fin_despesas_detalhe (competencia, ate o fornecedor).
// A pergunta que ele responde nao e' "quanto gastei" (isso a DRE ja diz),
// e sim "o que saiu do padrao" — por isso toda linha compara com a media
// dos meses anteriores, e o destaque vai para as maiores VARIACOES.
// ------------------------------------------------------------------
let DESP_DET = null;      // vw_fin_despesas_detalhe

let despMes = null;       // mes selecionado (YYYY-MM-01) ou 'ano'

const despAberto = new Set();

// Guarda o recorte que veio do Placar para saber quando ele MUDOU. Sem isso, trocar
// de numero no Placar (Mercadoria -> Pessoas) traria os grupos abertos do anterior.
let despCtxChave = null;

async function entrarDespesas() {
  const alvo = document.getElementById('view-despesas');
  if (DESP_DET === null) {
    alvo.innerHTML = '<div class="contexto">Carregando despesas...</div>';
    DESP_DET = await consultarTudo('vw_fin_despesas_detalhe?select=mes,unidade,tipo,subtipo,fornecedor,lancamentos,valor&order=mes');
    DESP_DET.forEach(r => { r.valor = Number(r.valor); r.lancamentos = Number(r.lancamentos); });
    // 07/11/2026 (auditoria lote 1, resultado-31): as comissões de vendedores saem da RECEITA na DRE,
    // então não ficam dentro de "DESPESAS COMERCIAIS" (que na DRE é só fretes e atendimento): linha à parte.
    DESP_DET.forEach(r => { if (r.tipo === 'DESPESAS COMERCIAIS' && r.subtipo === 'COMISSOES') r.tipo = 'COMISSÕES (saem da receita na DRE)'; });
  }
  renderModuloDespesas();
}

function despToggle(chave) {
  if (despAberto.has(chave)) despAberto.delete(chave); else despAberto.add(chave);
  renderModuloDespesas();
}

// Clicar em "O que saiu do padrao" abre a arvore no grupo e na categoria daquela
// linha e rola ate ela (12/09/2026). Ate aqui o alerta dizia o que mudou e a
// pessoa tinha de procurar a linha na arvore a mao. O GRUPO vem do proprio
// DESP_DET (um subtipo pertence a um tipo so): sem o 'T:' aberto, a linha do
// subtipo nem chega a ser desenhada. O nome viaja no onclick em
// encodeURIComponent para nao quebrar o atributo em categoria com apostrofo.
function despIrPara(subEnc) {
  const sub = decodeURIComponent(subEnc);
  const reg = (DESP_DET || []).find(r => (lojaFin() === 'REDE' || r.unidade === lojaFin()) && r.subtipo === sub);
  if (reg) despAberto.add('T:' + reg.tipo);
  despAberto.add('S:' + sub);
  renderModuloDespesas();
  // a linha e achada pelo texto da primeira celula ('▼ NOME'), que e o proprio
  // nome do subtipo — assim nao e preciso inventar uma id para cada categoria
  const linha = [...document.querySelectorAll('#tabelaDespesas tr.dfc-grupo')]
    .find(tr => tr.cells[0].textContent.replace(/^[▼▶]\s*/, '').trim() === sub);
  if (linha) linha.scrollIntoView({ behavior: 'smooth', block: 'center' });
}

// Escolher o periodo na mao SOLTA o contexto do Placar: dali em diante o recorte e'
// de quem esta olhando, e o aviso "voce veio do Placar, de agosto" mentiria.
function despMesSet(m) { plcCtxSolta('despesas'); despMes = m; despAberto.clear(); renderModuloDespesas(); }

function renderModuloDespesas() {
  const alvo = document.getElementById('view-despesas');
  if (!DESP_DET || !DESP_DET.length) {
    alvo.innerHTML = `<div class="contexto" style="border-color:#f5a623;">Sem despesas importadas ainda.</div>`;
    return;
  }
  // A VIEW GANHOU `unidade` EM 12/09/2026 e a tela passou a obedecer o seletor de loja
  // do bloco financeiro. Antes ela somava as três lojas com "Água Verde" escrito no
  // cabeçalho — e é por isso que ela nunca batia com a DRE nem com o Placar. Conferido
  // depois da mudança: ago/26 na Água Verde dá mercadoria R$ 286.448,48 e pessoas
  // R$ 165.890,05, exatamente os dois números do Placar.
  const DESP = fxSemListaNaRede(DESP_DET.filter(r => lojaFin() === 'REDE' || r.unidade === lojaFin()));
  const ctx = plcCtx('despesas');
  const chaveCtx = ctx ? ctx.tile + '|' + ctx.meses.join(',') + '|' + ctx.loja : null;
  if (chaveCtx !== despCtxChave) { despCtxChave = chaveCtx; despAberto.clear(); }
  const meses = [...new Set(DESP.map(r => r.mes))].sort();
  const mesCorrente = mesCorrenteSP() + '-01';
  // 12/09/2026 (auditoria): abria no MES CORRENTE e comparava com a media dos
  // meses cheios. No dia 12, "Carnes R$ 34 mil contra media de R$ 146 mil" lia
  // como economia de R$ 112 mil e era so mes pela metade. Agora abre no ultimo
  // mes FECHADO; o corrente continua no seletor, com aviso de que esta em curso.
  // o mes escolhido tem de existir NESTA loja: trocar de loja pode deixar para tras
  // um mes que so a outra tinha, e ai a tela zeraria sem dizer por que
  if (despMes === null || (despMes !== 'ano' && !meses.includes(despMes))) {
    const fechados = meses.filter(m => m < mesCorrente);
    despMes = fechados.length ? fechados[fechados.length - 1]
            : (meses.includes(mesCorrente) ? mesCorrente : meses[meses.length - 1]);
  }
  const rotuloMes = (m) => { const [a, mm] = m.split('-'); return `${MESES_ABREV[Number(mm) - 1]}/${a.slice(2)}`; };

  // PERIODO: do Placar quando veio de la (pode ser um trimestre, varios meses), do
  // proprio seletor quando nao veio. Um rotulo SO para a tela inteira — a armadilha
  // que a revisao achou aqui foi justamente numero de um periodo com nome de outro.
  // O fallback existe porque o mes do Placar pode nao ter despesa nesta loja.
  const doCtx = ctx ? meses.filter(m => ctx.meses.includes(m)) : [];
  const mesesSel = doCtx.length ? doCtx : (despMes === 'ano' ? meses : [despMes]);
  const rotPer = (ctx && doCtx.length) ? ctx.rotPeriodo
               : (despMes === 'ano' ? 'no ano' : 'em ' + rotuloMes(despMes));
  const mesEmCurso = mesesSel.length === 1 && mesesSel[0] === mesCorrente;

  const noPeriodo = (r) => mesesSel.includes(r.mes);
  const anteriores = mesesSel.length ? meses.filter(m => m < mesesSel[0]) : [];
  const nAnt = anteriores.length;

  // soma no periodo e media/mes nos anteriores, para qualquer recorte
  const soma = (pred) => DESP.filter(r => noPeriodo(r) && pred(r)).reduce((s, r) => s + r.valor, 0);
  // A media dos meses anteriores vale por UM mes; quando o periodo escolhido tem
  // varios (um trimestre vindo do Placar), ela e' multiplicada pelo tamanho, senao a
  // tela compara a soma de tres meses com a media de um e tudo aparece como "gastou
  // muito mais". E' a mesma regra do Placar: periodo anterior do MESMO tamanho.
  const mediaAnt = (pred) => nAnt === 0 ? null :
    DESP.filter(r => anteriores.includes(r.mes) && pred(r)).reduce((s, r) => s + r.valor, 0) / nAnt * mesesSel.length;

  const totalPeriodo = soma(() => true);
  const totalMediaAnt = mediaAnt(() => true);

  // celula de variacao vs media dos meses anteriores (em despesa, subir e' ruim)
  const varia = (v, base) => {
    if (base === null || Math.abs(base) < 0.005) return '';
    const d = (v - base) / Math.abs(base) * 100;
    if (Math.abs(d) < 3) return `<span style="color:#7d8590;">≈ média</span>`;
    const cor = d > 0 ? '#ff6b6b' : '#3fb950';
    return `<span style="color:${cor};">${d > 0 ? '▲' : '▼'} ${pct(Math.abs(d))}% vs média</span>`;
  };

  const grupos = [...new Set(DESP.filter(noPeriodo).map(r => r.tipo))]
    .map(t => [t, soma(r => r.tipo === t), mediaAnt(r => r.tipo === t)])
    .sort((a, b) => b[1] - a[1]);

  let corpo = '';
  grupos.forEach(([tipo, valor, media]) => {
    const abertoT = despAberto.has('T:' + tipo);
    corpo += `
    <tr class="dfc-bloco clicavel" onclick="despToggle('T:${tipo}')">
      <td>${abertoT ? '▼ ' : '▶ '}${tipo}</td>
      <td>${fmt(-valor)}<span class="dre-av">${totalPeriodo ? pct(valor / totalPeriodo * 100) : 0}%</span></td>
      <td>${varia(valor, media)}</td>
    </tr>`;
    if (!abertoT) return;
    const subs = [...new Set(DESP.filter(r => noPeriodo(r) && r.tipo === tipo).map(r => r.subtipo))]
      .map(s => [s, soma(r => r.subtipo === s), mediaAnt(r => r.subtipo === s)])
      .sort((a, b) => b[1] - a[1]);
    subs.forEach(([sub, v, m]) => {
      const abertoS = despAberto.has('S:' + sub);
      corpo += `
      <tr class="dfc-grupo clicavel" onclick="despToggle('S:${sub.replace(/'/g, "\\'")}')">
        <td>${abertoS ? '▼ ' : '▶ '}${sub}</td>
        <td>${fmt(-v)}<span class="dre-av">${totalPeriodo ? pct(v / totalPeriodo * 100) : 0}%</span></td>
        <td>${varia(v, m)}</td>
      </tr>`;
      if (!abertoS) return;
      const forns = DESP.filter(r => noPeriodo(r) && r.subtipo === sub)
        .reduce((acc, r) => { acc[r.fornecedor] = (acc[r.fornecedor] || 0) + r.valor; return acc; }, {});
      Object.entries(forns).sort((a, b) => b[1] - a[1]).forEach(([f, v2]) => {
        corpo += `<tr class="dfc-linha"><td>${f}</td>
                  <td>${fmt(-v2)}<span class="dre-av">${v ? pct(v2 / v * 100) : 0}% do grupo</span></td>
                  <td>${varia(v2, mediaAnt(r => r.subtipo === sub && r.fornecedor === f))}</td></tr>`;
      });
    });
  });

  // top fornecedores do periodo (ignora o balde "(sem fornecedor)", que
  // mistura folha, impostos e tudo que nao tem NF de fornecedor)
  const porForn = DESP.filter(noPeriodo).reduce((acc, r) => {
    if (r.fornecedor === '(sem fornecedor)') return acc;
    acc[r.fornecedor] = (acc[r.fornecedor] || 0) + r.valor;
    return acc;
  }, {});
  const topForn = Object.entries(porForn).sort((a, b) => b[1] - a[1]).slice(0, 12);

  // maiores variacoes do periodo (o que realmente mudou)
  const variacoes = [...new Set(DESP.filter(noPeriodo).map(r => r.subtipo))]
    .map(s => { const v = soma(r => r.subtipo === s), m = mediaAnt(r => r.subtipo === s);
                return [s, v, m, m === null ? 0 : v - m]; })
    .filter(x => x[2] !== null && Math.abs(x[3]) > 500)
    .sort((a, b) => Math.abs(b[3]) - Math.abs(a[3])).slice(0, 6);

  // QUEM PUXOU A VARIACAO. "Carnes subiu R$ 40 mil" manda a pessoa abrir a arvore
  // para descobrir que foi um frigorifico so; quando um fornecedor responde
  // sozinho por 60% ou mais da diferenca, o nome dele ja entra na linha do alerta.
  // Olha os fornecedores do periodo E dos meses anteriores — senao quem PAROU de
  // aparecer (o lado da queda) ficaria de fora. "(sem fornecedor)" fica de fora de
  // proposito: ali caem folha, imposto e taxa, e apontar esse balde nao diz nada.
  const culpadoDa = (s, d) => {
    if (!d) return null;
    const nomes = [...new Set(DESP.filter(r => (noPeriodo(r) || anteriores.includes(r.mes)) && r.subtipo === s)
      .map(r => r.fornecedor))].filter(f => f !== '(sem fornecedor)');
    let melhor = null;
    nomes.forEach(f => {
      const base = mediaAnt(r => r.subtipo === s && r.fornecedor === f);
      const dif = soma(r => r.subtipo === s && r.fornecedor === f) - (base === null ? 0 : base);
      if (dif * d > 0 && (melhor === null || Math.abs(dif) > Math.abs(melhor[1]))) melhor = [f, dif];
    });
    return (melhor && Math.abs(melhor[1]) >= Math.abs(d) * 0.6) ? melhor : null;
  };
  const quemPuxou = {};
  variacoes.forEach(x => { const q = culpadoDa(x[0], x[3]); if (q) quemPuxou[x[0]] = q; });

  alvo.innerHTML = plcCabecalhoQuebra('despesas') + seletorLojaFin() + `
  <div class="section-label" style="border-top:none; margin-top:0; padding-top:0;">Análise de Despesas — ${nomeLojaFin()}</div>
  <div class="caption-label" style="text-align:center;">
    Vermelho = gastou mais que ${mesesSel.length > 1 ? 'o período anterior do mesmo tamanho' : 'a média dos meses anteriores'}. Inclui investimento, que o Placar deixa de fora.
  </div>
  <div class="periodo-presets" style="margin-top:10px;">
    ${meses.map(m => `<button class="preset-btn ${!ctx && despMes === m ? 'active' : ''}" onclick="despMesSet('${m}')">${rotuloMes(m)}${m === mesCorrente ? ' ·' : ''}</button>`).join('')}
    <button class="preset-btn ${!ctx && despMes === 'ano' ? 'active' : ''}" onclick="despMesSet('ano')">Ano todo</button>
  </div>
  ${mesEmCurso ? `<div class="contexto" style="border-color:#f5a623;"><b>${rotuloMes(mesesSel[0])} está em curso.</b>
    A comparação com a média é de mês inteiro contra mês pela metade — toda categoria vai aparecer como "gastou menos".
    Para ler economia de verdade, escolha o último mês fechado.</div>` : ''}
  <div class="cards">
    <div class="card blue"><div class="card-lbl">Total ${rotPer}</div>
      <div class="card-val">R$ ${fmt(totalPeriodo)}</div>
      ${totalMediaAnt !== null ? `<div class="card-pct">${varia(totalPeriodo, totalMediaAnt)}</div>` : ''}</div>
    <div class="card"><div class="card-lbl">Maior grupo</div><div class="card-val">R$ ${fmt(grupos[0] ? grupos[0][1] : 0)}</div>
      <div class="card-pct">${grupos[0] ? grupos[0][0] : '—'}</div></div>
    <div class="card"><div class="card-lbl">Maior fornecedor</div><div class="card-val">R$ ${fmt(topForn[0] ? topForn[0][1] : 0)}</div>
      <div class="card-pct">${topForn[0] ? topForn[0][0].slice(0, 30) : '—'}</div></div>
    <div class="card"><div class="card-lbl">Fornecedores no período</div><div class="card-val">${Object.keys(porForn).length}</div>
      <div class="card-pct">com NF lançada no Saipos</div></div>
  </div>
  ${variacoes.length ? `
  <div class="section-label">O que saiu do padrão</div>
  <div class="contexto" style="text-align:left;">
    ${variacoes.map(([s, v, m, d]) => `
      <div onclick="despIrPara('${encodeURIComponent(s)}')" title="abrir este grupo no detalhe abaixo" style="display:flex; justify-content:space-between; padding:4px 0; border-bottom:1px solid #34332f; cursor:pointer;">
        <span><b>${s}</b> <span style="color:#7d8590;">R$ ${fmt(v)} (média R$ ${fmt(m)})${quemPuxou[s] ? ` · ${d > 0 ? 'puxado por' : 'a queda veio de'} <b title="R$ ${fmt(Math.abs(quemPuxou[s][1]))} da diferença vêm deste fornecedor">${quemPuxou[s][0]}</b>` : ''}</span></span>
        <span style="color:${d > 0 ? '#ff6b6b' : '#3fb950'};">${d > 0 ? '+' : '−'} R$ ${fmt(Math.abs(d))}</span>
      </div>`).join('')}
    <div style="font-size:11px; color:#6e7681; margin-top:6px;">Diferença entre o período e a média dos meses anteriores (acima de R$ 500).</div>
  </div>` : ''}
  <div class="section-label">Detalhe por grupo → categoria → fornecedor</div>
  <div id="tabelaDespesas">
    <table>
      <tr><th></th><th>Valor · % do total</th><th>vs média dos meses anteriores</th></tr>
      ${corpo}
      <tr class="dfc-resultado"><td>TOTAL</td><td>${fmt(-totalPeriodo)}<span class="dre-av">100%</span></td><td>${totalMediaAnt !== null ? varia(totalPeriodo, totalMediaAnt) : ''}</td></tr>
    </table>
  </div>
  <div class="section-label">Top fornecedores ${ctx ? rotPer : (despMes === 'ano' ? 'do ano' : 'de ' + rotuloMes(despMes))}</div>
  <div style="height:${Math.max(220, topForn.length * 26)}px;"><canvas id="chartFornecedores"></canvas></div>
  <div class="caption-label">Fornecedor vem do cadastro da NF no Saipos; folha, impostos e taxas caem em "(sem fornecedor)"
  no detalhe e ficam fora do ranking. Inclui contas a pagar já lançadas (competência), então o mês corrente cresce até fechar.</div>`;

  destroyChart('chartFornecedores');
  chartInstances['chartFornecedores'] = new Chart(document.getElementById('chartFornecedores').getContext('2d'), {
    type: 'bar',
    data: {
      labels: topForn.map(f => f[0].length > 34 ? f[0].slice(0, 32) + '…' : f[0]),
      datasets: [{ data: topForn.map(f => f[1]), backgroundColor: corToken('--info'), borderRadius: 4 }],
    },
    options: {
      indexAxis: 'y', responsive: true, maintainAspectRatio: false,
      layout: { padding: { right: 70 } },
      plugins: { legend: { display: false }, tooltip: { callbacks: { label: (c) => `R$ ${fmt(c.parsed.x)}` } } },
      scales: { x: { beginAtZero: true, title: { display: true, text: 'R$' } } },
    },
    plugins: [pluginRotulosBarra((i) => 'R$ ' + fmt(topForn[i][1]))],
  });
}

// ------------------------------------------------------------------
// Modulo Conferencia — a base do painel esta batendo com a realidade?
// A conciliacao com o extrato e' feita no Saipos (que ja importa OFX). O
// campo "conciliated" da API vem SEMPRE 'N', mesmo em meses ja conciliados,
// entao ele nao serve para medir a fila — em vez de mostrar um numero
// errado, aqui rodamos as conferencias que a base permite provar:
//   1. saldo por conta (para bater no extrato/no Saipos)
//   2. transferencias que nao fecham (toda saida tem de ter uma entrada)
//   3. lancamentos sem classificacao
// ------------------------------------------------------------------
let CONF_SALDOS = null, CONF_TRANSF = null, CONF_SEMCLASS = null;

let CONF_IMPORT = null, CONF_GENERICAS = null, CONF_DIVERG = null, CONF_CARTOES = null;

let CONF_FATURAS = null;  // vw_fin_cartao_fatura_conferencia: fatura lancada x compras x extrato, por cartao e mes (10/09/2026)

let CONF_ACEITAS = null;   // fin_divergencias_aceitas: divergências já conferidas pelo dono

// ---- ACEITAR UMA DIVERGÊNCIA PELA TELA (12/09/2026) ----
// A lista dizia "estas R$ X não têm explicação" e parava ali; para a linha sumir era
// preciso sair do painel e escrever no banco. Agora grava daqui, com o e-mail de quem
// aceitou e a data. A lista vai por ÍNDICE no onclick: nome de conta tem espaço e
// acento, e escapar isso dentro de atributo HTML é onde quebra em silêncio.
let CONF_DIVERG_LISTA = [];

// Só o dono aceita — a policy do banco (eh_dono) manda de verdade; isto aqui é só para
// não mostrar um botão que vai falhar. O e-mail do dono é o mesmo que o Plano já usa.
const confPodeAceitar = () => {
  const s = rmbSessao();
  return !!(s && s.email && typeof souODono === 'function' && souODono());
};

async function confAceitar(i) {
  const d = CONF_DIVERG_LISTA[i];
  if (!d) return;
  const nome = nomeConta(d.conta);
  const motivo = prompt(
    `Aceitar a diferença de R$ ${fmt(d.pendente)} em ${nome}?\n\n` +
    'Escreva o que você conferiu. Este texto fica na tela, em "Já conferidas", ' +
    'e é o que explica a diferença para quem olhar depois.');
  if (motivo === null) return;
  if (!motivo.trim()) { alert('Sem o motivo escrito o aceite não entra: uma linha que some sem explicação é pior que a divergência.'); return; }
  const email = (rmbSessao() || {}).email || '';
  // POST com merge-duplicates = upsert: a chave é a CONTA, uma linha por conta. Aceitar
  // de novo substitui o valor aceito, que é o desenho da tabela ("o aceite é um valor de
  // estrutura, não uma lista de exceções").
  const r = await fetch(SUPABASE_URL + '/rest/v1/fin_divergencias_aceitas', {
    method: 'POST',
    headers: Object.assign({}, rmbHeaders(), { Prefer: 'resolution=merge-duplicates,return=representation' }),
    body: JSON.stringify({
      conta: d.conta, valor: Number(d.pendente), fonte_correta: 'SAIPOS',
      motivo: motivo.trim(), aceito_por: email,
      verificado_em: new Date(Date.now() - 3 * 36e5).toISOString().slice(0, 10),
    }),
  });
  if (!r.ok) {
    alert(r.status === 401 || r.status === 403
      ? 'O banco recusou: aceitar divergência é do dono. Entre com a conta dele pelo Plano.'
      : 'Não consegui gravar (' + r.status + ').');
    return;
  }
  // recarrega do banco em vez de adivinhar o resultado. Tem de ser CONF_SALDOS: e' ele
  // que entrarConciliacao olha para decidir se busca tudo de novo.
  CONF_SALDOS = null;
  entrarConciliacao();
}

async function entrarConciliacao() {
  await carregarApelidos();
  await carregarEmailDono();   // decide se aparece o botao "ja conferi" (so o dono aceita)
  const alvo = document.getElementById('view-conciliacao');
  if (CONF_SALDOS === null) {
    alvo.innerHTML = '<div class="contexto">Carregando conferências...</div>';
    [CONF_SALDOS, CONF_TRANSF, CONF_SEMCLASS, CONF_IMPORT, CONF_GENERICAS, CONF_DIVERG,
     CONF_CARTOES, CONF_ACEITAS, CONF_FATURAS] = await Promise.all([
      // Esta view sai de fin_contas, nao do movimento: sem o filtro ela traz as
      // duas contas desativadas com saldo 0,00. (aviso do chat da conciliacao)
      consultarTudo('vw_fin_saldo_conta?select=conta,conta_exibida,ativa,ordem,saldo,ultimo_lancamento,lancamentos&ativa=is.true&order=ordem'),
      consultarTudo('vw_fin_transf_conferencia?select=mes,diferenca,lancamentos&order=mes'),
      consultarTudo('vw_fin_sem_classificacao?select=data,conta,descricao,credito,debito&order=data.desc'),
      consultarTudo('vw_fin_ultima_importacao?select=fonte,importado_em,ultimo_lancamento,lancamentos'),
      consultarTudo('vw_fin_categorias_genericas?select=mes,subtipo,lancamentos,valor&order=mes.desc'),
      consultarTudo('vw_fin_divergencia_fontes?select=conta,planilha,saipos,diferenca,aceito,pendente,motivo'),
      consultarTudo('vw_fin_cartoes?select=conta,saldo_inicial,saldo,ultimo_lancamento'),
      consultarTudo('fin_divergencias_aceitas?select=conta,valor,motivo,verificado_em&order=conta'),
      consultarTudo('vw_fin_cartao_fatura_conferencia?select=unidade,conta,conta_exibida,mes,data_ref,fatura_lancada,compras_lancadas,n_compras,diferenca,extrato_valor,situacao&mes=gte.2026-08-01&order=mes.desc,ordem'),
    ]);
    CONF_SALDOS.forEach(r => { r.saldo = Number(r.saldo); r.lancamentos = Number(r.lancamentos); });
    CONF_TRANSF.forEach(r => { r.diferenca = Number(r.diferenca); });
    CONF_GENERICAS.forEach(r => { r.valor = Number(r.valor); r.lancamentos = Number(r.lancamentos); });
    CONF_DIVERG.forEach(r => {
      r.diferenca = Number(r.diferenca); r.planilha = Number(r.planilha);
      r.saipos = Number(r.saipos); r.pendente = Number(r.pendente); r.aceito = Number(r.aceito);
    });
    CONF_CARTOES.forEach(r => { r.saldo = Number(r.saldo); r.saldo_inicial = Number(r.saldo_inicial); });
    (CONF_FATURAS || []).forEach(r => { ['fatura_lancada', 'compras_lancadas', 'diferenca', 'extrato_valor'].forEach(k => { r[k] = r[k] === null ? null : Number(r[k]); }); });
  }
  renderModuloConciliacao();
}

function renderModuloConciliacao() {
  const alvo = document.getElementById('view-conciliacao');
  const hojeIso = new Date().toISOString().slice(0, 10);
  const rotuloMes = (m) => { const [a, mm] = m.split('-'); return `${MESES_ABREV[Number(mm) - 1]}/${a.slice(2)}`; };
  const fmtData = (d) => d ? `${d.slice(8, 10)}/${d.slice(5, 7)}` : '—';
  const diasDesde = (d) => d ? Math.round((new Date(hojeIso) - new Date(d)) / 86400000) : null;

  const ativas = CONF_SALDOS.filter(c => c.lancamentos > 0);
  const negativas = ativas.filter(c => c.saldo < -0.005 && !c.conta.startsWith('CREDITO'));
  const paradas = ativas.filter(c => diasDesde(c.ultimo_lancamento) > 7 && !c.conta.startsWith('CREDITO'));
  const transfRuins = CONF_TRANSF.filter(t => Math.abs(t.diferenca) > 0.005);

  // a rotina das 07:30 rodou? base velha = tudo o que se vê aqui esta velho
  const impSaipos = (CONF_IMPORT || []).find(r => r.fonte === 'SAIPOS');
  const horasDesdeImport = impSaipos
    ? Math.round((Date.now() - new Date(impSaipos.importado_em)) / 3600000) : null;
  const importAtrasada = horasDesdeImport === null || horasDesdeImport > 30;

  // categorias "balde" no mes corrente: escondem o que foi realmente gasto
  const mesAtual = hojeIso.slice(0, 8) + '01';
  const genericasMes = (CONF_GENERICAS || []).filter(g => g.mes === mesAtual);
  const valorGenerico = genericasMes.reduce((s, g) => s + g.valor, 0);

  // enquanto planilha e Saipos convivem, as duas tem de contar a mesma historia.
  // A view ja exclui o que o dono conferiu e aceitou (fin_divergencias_aceitas).
  const divergentes = (CONF_DIVERG || []).filter(d => Math.abs(d.pendente) > 0.005);

  // cartao com saldo positivo e' impossivel: fatura paga sem as compras lancadas
  const cartoesPositivos = (CONF_CARTOES || []).filter(c => c.saldo > 0.005);
  // fatura a fatura (10/09/2026): o que o banco pagou x a transferencia lancada x as compras
  const faturasRuins = (CONF_FATURAS || []).filter(r => !['OK', 'A VENCER'].includes(r.situacao));

  const alertas = negativas.length + paradas.length + transfRuins.length + CONF_SEMCLASS.length
                + (importAtrasada ? 1 : 0) + (valorGenerico > 0.005 ? 1 : 0)
                + divergentes.length + cartoesPositivos.length + faturasRuins.length;

  // A soma escondia a composicao (12/09/2026): "11 pontos de atencao" nao diz se
  // sao 11 lancamentos sem classificar ou 11 contas negativas — coisas de tamanho
  // muito diferente. Uma linha por tipo, com a contagem e o R$ de quem tem R$; a
  // soma continua sendo o card, isto aqui e a abertura dela. A ORDEM E' A DOS
  // BLOCOS ABAIXO (importacao, negativas, transferencias, paradas, divergencias,
  // cartao positivo, faturas, genericas, sem classificacao): indice fora de ordem
  // faz procurar.
  const tiposAtencao = [
    { nome: 'Importação do Saipos atrasada', n: importAtrasada ? 1 : 0, valor: null },
    { nome: 'Contas com saldo negativo', n: negativas.length, valor: negativas.reduce((t, c) => t + c.saldo, 0) },
    { nome: 'Transferências que não fecham', n: transfRuins.length, valor: transfRuins.reduce((t, x) => t + x.diferenca, 0) },
    { nome: 'Contas sem movimento recente', n: paradas.length, valor: null },
    { nome: 'Planilha × Saipos (jan–jul)', n: divergentes.length, valor: divergentes.reduce((t, d) => t + d.pendente, 0) },
    { nome: 'Cartão com saldo positivo', n: cartoesPositivos.length, valor: cartoesPositivos.reduce((t, c) => t + c.saldo, 0) },
    { nome: 'Faturas de cartão fora do lugar', n: faturasRuins.length, valor: faturasRuins.reduce((t, x) => t + Number(x.diferenca || 0), 0) },
    { nome: 'Categorias genéricas no mês', n: valorGenerico > 0.005 ? 1 : 0, valor: valorGenerico },
    { nome: 'Lançamentos sem classificação', n: CONF_SEMCLASS.length, valor: CONF_SEMCLASS.reduce((t, x) => t + Number(x.debito) - Number(x.credito), 0) },
  ].filter(x => x.n > 0);
  const saldoTotal = ativas.filter(c => !c.conta.startsWith('CREDITO')).reduce((s, c) => s + c.saldo, 0);

  let blocos = '';

  if (importAtrasada) {
    blocos += `
    <div class="section-label">Importação do Saipos</div>
    <div class="contexto" style="border-color:#ff6b6b; text-align:left;">
      <b>A base pode estar desatualizada.</b> Última importação:
      ${impSaipos ? new Date(impSaipos.importado_em).toLocaleString('pt-BR') + ` (${horasDesdeImport}h atrás)` : 'nunca'}.
      <div style="font-size:12px; color:#a5a49a; margin-top:6px;">
        A rotina roda todo dia às 07:30 (tarefa "Painel - Importar Saipos DFC"). Se o PC estiver desligado nesse horário,
        rode manualmente o <b>importar_saipos.bat</b> — enquanto isso, tudo o que aparece no painel é do último dia importado.
      </div>
    </div>`;
  }

  if (negativas.length) {
    blocos += `
    <div class="section-label">Contas com saldo negativo no painel</div>
    <div class="contexto" style="border-color:#ff6b6b; text-align:left;">
      ${negativas.map(c => `<div style="padding:3px 0;"><b>${nomeConta(c.conta)}</b>: <span class="negativo">R$ ${fmt(c.saldo)}</span></div>`).join('')}
      <div style="font-size:12px; color:#9aa4af; margin-top:6px;">
        Se o extrato real não está negativo, faltam <b>recebimentos lançados no Saipos</b> (ex.: repasse que caiu no banco
        mas ainda não foi baixado) — é exatamente o que a conciliação no Saipos resolve.
      </div>
    </div>`;
  }

  if (transfRuins.length) {
    blocos += `
    <div class="section-label">Transferências que não fecham</div>
    <div class="contexto" style="border-color:#f5a623; text-align:left;">
      ${transfRuins.map(t => `<div style="display:flex; justify-content:space-between; padding:3px 0;">
        <span>${rotuloMes(t.mes)} — ${t.lancamentos} lançamentos</span>
        <b class="negativo">R$ ${fmt(t.diferenca)}</b></div>`).join('')}
      <div style="font-size:12px; color:#9aa4af; margin-top:6px;">
        Transferência entre contas próprias tem de somar zero (toda saída tem uma entrada). Diferente de zero =
        perna faltando ou valor divergente entre as duas contas. Não muda o resultado, mas distorce o saldo das contas.
      </div>
    </div>`;
  }

  if (paradas.length) {
    blocos += `
    <div class="section-label">Contas sem movimento recente</div>
    <div class="contexto" style="border-color:#f5a623; text-align:left;">
      ${paradas.map(c => `<div style="display:flex; justify-content:space-between; padding:3px 0;">
        <span>${nomeConta(c.conta)}</span><span style="color:#9aa4af;">último lançamento em ${fmtData(c.ultimo_lancamento)}
        (${diasDesde(c.ultimo_lancamento)} dias)</span></div>`).join('')}
      <div style="font-size:12px; color:#9aa4af; margin-top:6px;">
        Pode ser normal (conta pouco usada) ou sinal de que os lançamentos dessa conta pararam de ser feitos no Saipos.
      </div>
    </div>`;
  }

  if (divergentes.length) {
    blocos += `
    <div class="section-label">Planilha × Saipos (jan–jul) — as duas contam a mesma história?</div>
    <div class="contexto" style="border-color:#f5a623; text-align:left;">
      <table style="width:100%; font-size:12.5px;">
        <tr><th style="text-align:left;">Conta</th><th>Planilha</th><th>Saipos</th><th>Falta resolver</th><th></th></tr>
        ${(() => {
          // O BOTAO DE ACEITAR (12/09/2026): era a unica acao que esta tela pedia e nao
          // oferecia. Quem conferia tinha de sair do painel e escrever no banco a mao —
          // e' assim que as linhas de hoje entraram. So o dono grava (policy eh_dono).
          CONF_DIVERG_LISTA = divergentes.slice().sort((a, b) => Math.abs(b.pendente) - Math.abs(a.pendente));
          return CONF_DIVERG_LISTA.map((d, i) => `
          <tr><td>${nomeConta(d.conta)}</td><td>${fmt(d.planilha)}</td><td>${fmt(d.saipos)}</td>
          <td class="negativo">${fmt(d.pendente)}</td>
          <td style="text-align:right;">${confPodeAceitar()
            ? `<button class="preset-btn" onclick="confAceitar(${i})" title="Grava esta diferença como conferida: ela sai da lista e passa a aparecer em 'Já conferidas', com o seu e-mail e a data.">já conferi</button>`
            : ''}</td></tr>`).join('');
        })()}
        <tr style="border-top:1px solid #45443f;"><td colspan="3"><b>Total pendente</b></td>
          <td class="negativo"><b>${fmt(divergentes.reduce((s, d) => s + d.pendente, 0))}</b></td><td></td></tr>
      </table>
      <div style="font-size:12px; color:#a5a49a; margin-top:6px;">
        Movimento de jan a jul nas duas fontes. Enquanto houver pendência, o DFC continua na planilha —
        quando esta lista zerar, a base pode virar 100% Saipos. Nos cartões, a diferença é a medida do que
        ainda falta lançar de compras no Saipos (a fatura foi paga, mas as saídas não foram conciliadas lá).
      </div>
      ${(CONF_ACEITAS || []).length ? `<div style="font-size:12px; color:#a5a49a; margin-top:8px; border-top:1px solid #34332f; padding-top:8px;">
        <b>Já conferidas</b> (fora da conta acima):<br>
        ${CONF_ACEITAS.map(a => `• ${nomeConta(a.conta)}: R$ ${fmt(Number(a.valor))} — ${a.motivo}`).join('<br>')}
      </div>` : ''}
    </div>`;
  }

  if (cartoesPositivos.length) {
    blocos += `
    <div class="section-label">Cartão com saldo positivo</div>
    <div class="contexto" style="border-color:#ff6b6b; text-align:left;">
      ${cartoesPositivos.map(c => `<div style="display:flex; justify-content:space-between; padding:3px 0;">
        <span>${nomeConta(c.conta)}</span><b>R$ ${fmt(c.saldo)}</b></div>`).join('')}
      <div style="font-size:12px; color:#a5a49a; margin-top:6px;">
        Cartão só pode estar zerado ou devedor. Saldo positivo = fatura paga cujas <b>compras não foram lançadas</b> no Saipos —
        some sozinho quando o cartão for conciliado lá.
      </div>
    </div>`;
  }

  if (faturasRuins.length) {
    const SIT = {
      'FALTAM COMPRAS': ['fatura paga maior que as compras lançadas — faltam compras no Saipos', '#f5a623'],
      'FATURA MENOR QUE AS COMPRAS': ['compras lançadas maiores que a fatura — transferência na conta errada ou compra fora do ciclo', '#f5a623'],
      'FATURA NAO LANCADA': ['o banco pagou (BUSINESS no extrato) e o Saipos não tem a transferência para o cartão', '#ff6b6b'],
      'COMPRAS SEM FATURA': ['compras vencidas sem fatura lançada e sem pagamento no extrato', '#ff6b6b'],
    };
    blocos += `
    <div class="section-label">Faturas de cartão que não fecham (fatura × compras × extrato)</div>
    <div class="contexto" style="border-color:#f5a623; text-align:left;">
      ${faturasRuins.map(r => `<div style="padding:4px 0; border-bottom:1px solid rgba(128,128,128,.15);">
        <div style="display:flex; justify-content:space-between; gap:8px;">
          <span><b>${nomeConta(r.conta)}</b> · ${rotuloMes(r.mes)}${r.data_ref ? ' · fatura de ' + r.data_ref.slice(8, 10) + '/' + r.data_ref.slice(5, 7) : ''}</span>
          <b style="color:${(SIT[r.situacao] || ['', ''])[1]};">${r.situacao}</b></div>
        <div style="font-size:12px; color:#a5a49a;">
          lançada R$ ${fmt(r.fatura_lancada)} · compras R$ ${fmt(r.compras_lancadas)} (${r.n_compras}) ·
          banco ${r.extrato_valor === null ? '—' : 'R$ ' + fmt(r.extrato_valor)} · diferença <b>R$ ${fmt(r.diferenca)}</b>
          — ${(SIT[r.situacao] || [''])[0]}</div>
      </div>`).join('')}
      <div style="font-size:12px; color:#a5a49a; margin-top:6px;">
        Regra do dono (19/08): a fatura é uma transferência Itaú → cartão, e o que prova é a linha <b>BUSINESS</b> do extrato.
        Cada cartão tem um contrato no memo (0503-3179 = AV 6950, 4005-3752 = AV 1540, 4004-1773 = Ahú, 7502-4440 = São Braz).
        Fonte: vw_fin_cartao_fatura_conferencia.
      </div>
    </div>`;
  }

  if (valorGenerico > 0.005) {
    blocos += `
    <div class="section-label">Despesas em categorias genéricas (${rotuloMes(mesAtual)})</div>
    <div class="contexto" style="border-color:#f5a623; text-align:left;">
      ${genericasMes.map(g => `<div style="display:flex; justify-content:space-between; padding:3px 0;">
        <span>${g.subtipo} <span style="color:#8a897e;">(${g.lancamentos} lançamentos)</span></span>
        <b>R$ ${fmt(g.valor)}</b></div>`).join('')}
      <div style="font-size:12px; color:#a5a49a; margin-top:6px;">
        Lançados no Saipos como "Consumo" ou "Fornecedores", sem dizer o que foi comprado — entram no total certo,
        mas somem da análise por categoria. Detalhe a categoria no Saipos para eles aparecerem no lugar certo.
      </div>
    </div>`;
  }

  if (CONF_SEMCLASS.length) {
    blocos += `
    <div class="section-label">Lançamentos sem classificação</div>
    <div id="tabelaSemClass"><table>
      <tr><th>Data</th><th>Conta</th><th>Descrição</th><th>Valor</th></tr>
      ${CONF_SEMCLASS.slice(0, 30).map(r => `<tr><td>${fmtData(r.data)}</td><td>${nomeConta(r.conta)}</td>
        <td>${(r.descricao || '').slice(0, 60)}</td>
        <td class="negativo">R$ ${fmt(Number(r.debito) - Number(r.credito))}</td></tr>`).join('')}
      <tr class="liq"><td>TOTAL${CONF_SEMCLASS.length > 30 ? ' (' + CONF_SEMCLASS.length + ' lançamentos, 30 listados)' : ''}</td><td></td><td></td>
        <td>R$ ${fmt(CONF_SEMCLASS.reduce((s, r) => s + Number(r.debito) - Number(r.credito), 0))}</td></tr>
    </table></div>`;
  }

  alvo.innerHTML = `
  <div class="section-label" style="border-top:none; margin-top:0; padding-top:0;">Conferência da base — Água Verde, Ahú e São Braz</div>
  <div class="caption-label" style="text-align:center;">
    Checagem diária da base: <b>se algo não bater, aparece aqui.</b> A conciliação com o extrato do banco é feita
    fora do painel (Saipos/OFX) — aqui conferimos a consistência interna e apontamos o que provavelmente falta lançar lá.
  </div>
  <div class="cards">
    <div class="card ${alertas === 0 ? 'pos' : 'neg'}"><div class="card-lbl">Pontos de atenção</div>
      <div class="card-val">${alertas}</div><div class="card-pct">${alertas === 0 ? 'base consistente' : 'detalhes abaixo'}</div></div>
    <div class="card blue"><div class="card-lbl">Saldo em conta (painel)</div>
      <div class="card-val">R$ ${fmt(saldoTotal)}</div><div class="card-pct">bancos, cofre e investimentos</div></div>
    <div class="card"><div class="card-lbl">Contas ativas</div><div class="card-val">${ativas.length}</div>
      <div class="card-pct">com lançamentos no ano</div></div>
    <div class="card ${CONF_SEMCLASS.length ? 'neg' : 'pos'}"><div class="card-lbl">Sem classificação</div>
      <div class="card-val">${CONF_SEMCLASS.length}</div><div class="card-pct">lançamentos sem categoria</div></div>
  </div>
  ${alertas ? `<div class="contexto" style="text-align:left;">
    <b>Os ${alertas} pontos de atenção, um tipo por linha</b>
    ${tiposAtencao.map(x => `<div style="display:flex; justify-content:space-between; gap:10px; padding:3px 0;">
      <span>${x.nome}</span>
      <span>${x.n}${x.valor === null ? '' : ` · <b>R$ ${fmt(x.valor)}</b>`}</span></div>`).join('')}
    <div style="display:flex; justify-content:space-between; gap:10px; padding:6px 0 0; margin-top:4px; border-top:1px solid var(--line);">
      <b>Total</b><b>${alertas}</b></div>
    <div style="font-size:12px; color:var(--tx-3); margin-top:6px;">
      A contagem é de casos, não de reais — cada tipo pesa diferente. O R$ aparece onde existe valor
      em jogo; nos outros, o que falta é o lançamento, não o tamanho dele. Cada tipo está detalhado abaixo.
    </div>
  </div>` : ''}
  ${alertas === 0 ? '<div class="contexto" style="border-color:#3fb950;">Nenhuma inconsistência encontrada na base. 🎉</div>' : blocos}
  <div class="section-label">Saldo por conta (para bater com o extrato)</div>
  <div id="tabelaSaldos"><table>
    <tr><th>Conta</th><th>Saldo no Saipos</th><th>Último lançamento</th><th>Lançamentos</th></tr>
    ${CONF_SALDOS.map(c => `<tr class="${c.lancamentos ? '' : 'dfc-linha'}">
      <td>${nomeConta(c.conta)}</td>
      <td class="${c.saldo < -0.005 ? 'negativo' : ''}">R$ ${fmt(c.saldo)}</td>
      <td>${fmtData(c.ultimo_lancamento)}</td>
      <td>${c.lancamentos || '—'}</td></tr>`).join('')}
    <tr class="liq"><td>TOTAL<div style="font-size:11px; font-weight:400; opacity:.75;">inclui a XP e a Participações: R$ ${fmt(CONF_SALDOS.filter(c => PROJ_FORA_CAIXA.includes(c.conta)).reduce((s, c) => s + Number(c.saldo || 0), 0))}</div></td>
      <td>R$ ${fmt(CONF_SALDOS.reduce((s, c) => s + Number(c.saldo || 0), 0))}</td>
      <td></td><td>${CONF_SALDOS.reduce((s, c) => s + Number(c.lancamentos || 0), 0).toLocaleString('pt-BR')}</td></tr>
  </table></div>
  <div class="caption-label" title="O painel não vê o extrato do banco: se um recebimento nunca foi lançado no Saipos, aqui ele só aparece indiretamente (saldo negativo ou conta parada) — a confirmação vem da conciliação bancária.">Saldo = saldo inicial de 01/01 + todos os lançamentos de caixa (planilha até jul, Saipos depois).
  Cartões aparecem com saldo negativo enquanto a fatura não é paga — é o normal.</div>`;
}

// O MIOLO DO mostrarModulo (05/11/2026): MOVIDO do painel, igual. O painel antigo e a página da Gestão chamam o mesmo.
// Devolve false quando a tela não pode abrir (tela do financeiro sem loja).
function prepararTela(nome) {
  MODULO_ATUAL = nome; // usado pelo setPerimetro para reentrar no modulo atual
  avisarCasca({ tipo: 'casca-modulo', nome });   // a casca acende o item certo do menu dela
  registrarUso(nome);                            // quais telas sao abertas (15/10/2026)
  abrirGrupoDoModulo(nome);
  const rodape = document.querySelector('.footer');
  if (rodape) rodape.style.display = MODULOS_COM_RODAPE.has(nome) ? '' : 'none';
  const filtros = document.getElementById('filtrosTopo');
  if (filtros) filtros.style.display = MODULOS_COM_FILTRO_TOPO.has(nome) ? 'flex' : 'none';
  // Atendimento e' tela de ferramenta do delivery: a visao de rede e o "Limpar
  // filtros" nao agem nela, e para quem esta atendendo sao so ruido no topo.
  const barraPerim = document.getElementById('perimetroBar');
  if (barraPerim) barraPerim.style.display = TELAS_SEM_BARRA_FILTRO.includes(nome) ? 'none' : 'flex';
  limparFiltrosVer(nome);
  const modulos = {
    estasemana: ['modulo-estasemana', 'navBtnEstaSemana'],
    hoje: ['modulo-hoje', 'navBtnHoje'],   // so pela casca, ver entrarHoje
    resumo: ['modulo-resumo', 'navBtnResumo'],
    cancelamentos: ['modulo-cancelamentos', 'navBtnCancelamentos'],
    promocoes: ['modulo-promocoes', 'navBtnPromocoes'],
    negociacoes: ['modulo-negociacoes', 'navBtnNegociacoes'],
    avaliacoes: ['modulo-avaliacoes', 'navBtnAvaliacoes'],
    relatorios: ['modulo-relatorios', 'navBtnRelatorios'],
    contestacoes: ['modulo-contestacoes', 'navBtnContestacoes'],
    atendimento: ['modulo-atendimento', 'navBtnAtendimento'],
    cardapio: ['modulo-cardapio', 'navBtnCardapio'],
    clientes: ['modulo-clientes', 'navBtnClientes'],
    site: ['modulo-site', 'navBtnSite'],
    fluxo: ['modulo-fluxo', 'navBtnFluxo'],
    dre: ['modulo-dre', 'navBtnDre'],
    semana: ['modulo-semana', 'navBtnSemana'],
    fechamento: ['modulo-fechamento', 'navBtnFechamento'],
    projecao: ['modulo-projecao', 'navBtnProjecao'],
    contaspagar: ['modulo-contaspagar', 'navBtnContaspagar'],
    contasreceber: ['modulo-contasreceber', 'navBtnContasreceber'],
    despesas: ['modulo-despesas', 'navBtnDespesas'],
    conciliacao: ['modulo-conciliacao', 'navBtnConciliacao'],
    indicadores: ['modulo-indicadores', 'navBtnIndicadores'],
    rotinas: ['modulo-rotinas', 'navBtnRotinas'],
    telas: ['modulo-telas', 'navBtnTelas'],
    qualidade: ['modulo-qualidade', 'navBtnQualidade'],
    evolucao: ['modulo-evolucao', 'navBtnEvolucao'],
    placar: ['modulo-placar', 'navBtnPlacar'],
    atrasos: ['modulo-atrasos', 'navBtnAtrasos'],
    logfin: ['modulo-logfin', 'navBtnLogfin'],
    frete: ['modulo-frete', 'navBtnFrete'],
    listas: ['modulo-listas', 'navBtnListas'],
    listasfin: ['modulo-listasfin', 'navBtnListasFin'],
    contagem: ['modulo-contagem', 'navBtnContagem'],
    processos: ['modulo-processos', 'navBtnProcessos'],
    plprod: ['modulo-plprod', 'navBtnPlprod'],
    separacao: ['modulo-separacao', 'navBtnSeparacao'],
    ordens: ['modulo-ordens', 'navBtnOrdens'],
    producao: ['modulo-producao', 'navBtnProducao'],
    fechaturno: ['modulo-fechaturno', 'navBtnFechaturno'],
    comprateto: ['modulo-comprateto', 'navBtnComprateto'],
    prodhist: ['modulo-prodhist', 'navBtnProdhist'],
    conferencias: ['modulo-conferencias', 'navBtnConferencias'],
    controle: ['modulo-controle', 'navBtnControle'],
    posicao: ['modulo-posicao', 'navBtnPosicao'],
    // rateio ficou de fora do mapa quando o modulo nasceu (22/08): entrarRateio()
    // buscava os dados e o div nunca era exibido — a tela abria vazia.
    rateio: ['modulo-rateio', 'navBtnRateio'],
    lucrouni: ['modulo-lucrouni', 'navBtnLucrouni'],
    fichas: ['modulo-fichas', 'navBtnFichas'],
    engcard: ['modulo-engcard', 'navBtnEngcard'],
    plano: ['modulo-plano', 'navBtnPlano'],
    reembolsos: ['modulo-reembolsos', 'navBtnReembolsos'],
    rh: ['modulo-rh', 'navBtnRh'],
    // forafolha nasceu 04/09 fora deste mapa e abriu em branco — mesma armadilha do rateio.
    forafolha: ['modulo-forafolha', 'navBtnForafolha'],
    cargos: ['modulo-cargos', 'navBtnCargos'],
    phoje: ['modulo-phoje', 'navBtnPhoje'],
    pcalc: ['modulo-pcalc', 'navBtnPcalc'],
    pferias: ['modulo-pferias', 'navBtnPferias'],
    macertos: ['modulo-macertos', 'navBtnMacertos'],
    presc: ['modulo-presc', 'navBtnPresc'],
    penvio: ['modulo-penvio', 'navBtnPenvio'],
    pconf: ['modulo-pconf', 'navBtnPconf'],
    pcusto: ['modulo-pcusto', 'navBtnPcusto'],
    orcamentos: ['modulo-orcamentos', 'navBtnOrcamentos'],
    lojaempresas: ['modulo-lojaempresas', 'navBtnLojaempresas'],
    pacertos: ['modulo-pacertos', 'navBtnPacertos'],
    flash: ['modulo-flash', 'navBtnFlash'],
    concbanco: ['modulo-concbanco', 'navBtnConcbanco'],
    caixa: ['modulo-caixa', 'navBtnCaixa'],
    rede: ['modulo-rede', 'navBtnRede'],
  };
  Object.entries(modulos).forEach(([chave, [idDiv, idBtn]]) => {
    // Tolerante a botao/div ausente: o menu e mexido com frequencia e um id
    // fora do mapa nao pode derrubar a navegacao inteira.
    const div = document.getElementById(idDiv);
    if (div) div.style.display = (chave === nome) ? 'block' : 'none';
    const btn = document.getElementById(idBtn);
    if (btn) btn.classList.toggle('active', chave === nome);
  });
  if (FIN_TELAS.has(nome) && !lojaFin()) {
    const v = document.getElementById('view-' + nome);
    if (v) v.innerHTML = `<div class="contexto">${typeof LOJA_INFO !== 'undefined' && LOJA_INFO ? 'Sem loja cadastrada — fale com o Neto.' : '✗ Não consegui ler a sua loja. Recarregue a página.'}</div>`;
    return false;
  }
  // Periodo pertence ao modulo: entrar num modulo REINICIA a janela dele
  // para o padrao (fim do filtro pegajoso). Modulo sem janela esconde a barra.
  // VINDO DO PLACAR, a janela do modulo e' a do recorte, nao o padrao dele.
  // CUIDADO REGISTRADO: NAO soltar o contexto dentro de aplicarJanela. MODULO_ATUAL ja
  // vale `nome` aqui, entao um plcCtxSolta la apagaria o contexto ANTES de a tela ler —
  // o caminho nunca funcionaria e o defeito seria invisivel. Quem solta e' o clique da
  // pessoa num preset (renderJanelas) e o seletor de loja.
  const janPadrao = JANELA_DO_MODULO[nome];
  const ctxJan = plcCtx(nome);
  if (ctxJan && ctxJan.meses && ctxJan.meses.length) {
    // o mes do Placar vem 'AAAA-MM-DD'; o slice(0,7) serve nos dois formatos
    const mIni = String(ctxJan.meses[0]).slice(0, 7);
    const mFim = String(ctxJan.meses[ctxJan.meses.length - 1]).slice(0, 7);
    const ud = new Date(Number(mFim.slice(0, 4)), Number(mFim.slice(5, 7)), 0);
    const ini = mIni + '-01';
    const fim = `${ud.getFullYear()}-${String(ud.getMonth() + 1).padStart(2, '0')}-${String(ud.getDate()).padStart(2, '0')}`;
    const iniOk = ini < DATAS[0] ? DATAS[0] : ini;
    const fimOk = fim > ULTIMO_DIA() ? ULTIMO_DIA() : fim;
    if (fimOk < iniOk) { plcCtxSolta(nome); if (janPadrao) aplicarJanela(janPadrao); else renderJanelas(); }
    else {
      fDataIni.value = iniOk; fDataFim.value = fimOk;
      JANELA_ATUAL = null;
      // A loja: filtra pela lista REAL de unidades, nunca pela grafia de uma constante.
      // Se a grafia divergir, a tela zeraria em silencio — entao cai para o padrao.
      if (!PLC_UNID_ANTES) PLC_UNID_ANTES = new Set(activeUnidades);
      const alvo = ctxJan.loja === 'REDE' ? UNIDADES.filter(u => FX_TODAS.includes(u))
                                          : UNIDADES.filter(u => u === ctxJan.loja);
      activeUnidades = alvo.length ? new Set(alvo) : new Set(unidadesVisiveis());
      renderTopNav(); rebuildLojaOptions();   // sem rebuild, activeLojas() le checkbox velho
      renderJanelas(); renderAll();
    }
  }
  else if (janPadrao) { aplicarJanela(janPadrao); } else { renderJanelas(); }
  return true;
}

// O PEDAÇO DO mostrarModulo QUE É DA GESTÃO (05/11/2026): o que cada tela faz ao entrar.
function entrarTelaGestao(nome) {
  if (nome === 'estasemana') entrarEstaSemana();
  if (nome === 'hoje') entrarHoje();
  if (nome === 'evolucao') entrarEvolucao();
  if (nome === 'placar') entrarPlacar();
  if (nome === 'concbanco') entrarConcbanco();
  if (nome === 'rede') entrarRede();
  if (nome === 'fluxo') entrarFluxo();
  if (nome === 'dre') entrarDre();
  if (nome === 'semana') entrarSemana();
  if (nome === 'fechamento') entrarFechamento();
  if (nome === 'lucrouni') entrarLucroUni();
  if (nome === 'projecao') entrarProjecao();
  if (nome === 'contaspagar') entrarContasPagar();
  if (nome === 'contasreceber') entrarContasReceber();
  if (nome === 'despesas') entrarDespesas();
  if (nome === 'conciliacao') entrarConciliacao();
  if (nome === 'indicadores') entrarIndicadores();
}

// O PEDAÇO DO renderAll QUE É DA GESTÃO (05/11/2026): só redesenha se as fontes da tela já carregaram.
function renderAllGestao(ativo) {
  if (ativo === 'estasemana' && HOME_PEND !== null && METAS_KPI !== null
      && NEGOCIACOES !== null && AVALIACOES !== null) renderEstaSemana();
  if (ativo === 'evolucao' && EVOL !== null) renderModuloEvolucao();
}
