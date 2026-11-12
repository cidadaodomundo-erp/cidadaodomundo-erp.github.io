// VENDAS AGORA (01/11/2026, dono: "pode fazer; Boqueirão à parte"): o dia até a última leitura, como o app do Saipos.
// Proposta: contexto/propostas-telas/2026-11-01-vendas-agora.md. Dados: vendas_agora (de 15 em 15 min; o motor não lê das
// 02:00 às 09:59) e vw_vendas_agora_semana_passada. O banco já limita a loja de cada login; aqui só se escolhe o que mostrar.
// Carregado por docs/vendas/index.html depois do nucleo.js (fmt, trFetch, trEscH, trHoje, fxSomaDias) e do loja.js.

const VA_A_PARTE = 'BOQUEIRAO';                       // linha à parte e fora do total da Rede, quando houver o token
const VA_TIPOS = ['Entrega', 'Balcão', 'Ficha', 'Salão'];
const VA_TURNOS = ['Madrugada', 'Dia', 'Noite'];
const VA_ATRASO_MIN = 40;                             // sem leitura há mais que isso com a loja aberta: aviso em destaque
const VA_RELER_MS = 2 * 60000;
const VA = { dia: null, linhas: [], base: [], aberto: {}, filtro: {}, falha: null, ouve: false };

const vaBrl = (v) => 'R$ ' + fmt(Number(v) || 0);
const vaInt = (v) => (Number(v) || 0).toLocaleString('pt-BR');
const vaPed = (v) => vaInt(v) + (Number(v) === 1 ? ' pedido' : ' pedidos');
const vaHora = (t) => new Date(t).toLocaleTimeString('pt-BR', { timeZone: 'America/Sao_Paulo', hour: '2-digit', minute: '2-digit' });
const vaDdmm = (d) => d.slice(8, 10) + '/' + d.slice(5, 7);
const vaSemana = (d) => new Date(d + 'T12:00:00').toLocaleDateString('pt-BR', { weekday: 'long' });
const vaPassado = (d) => { const s = vaSemana(d); return s + (s.endsWith('feira') ? ' passada' : ' passado'); };
const vaCanal = (c) => ({ IFOOD: 'iFood', 'VNDX TECNOLOGIA': 'VNDX' })[c] || c;
// 12/11/2026 (regra nova: venda de R$ 0 não é pedido): o motor agrupa por tipo, canal, marca, turno e cancelada, e a venda de
// R$ 0 do balcão/salão vem quase sempre sem marca, num grupo só dela (valor 0). Esse grupo não conta em "pedidos". Grupo que
// misture R$ 0 com venda paga ainda conta a de R$ 0 — só o motor (script/vendas_agora.py) separa de vez.
const vaSoma = (ls, campo) => ls.reduce((s, l) => s + (campo === 'pedidos' && !(Number(l.valor) > 0) ? 0 : (Number(l[campo]) || 0)), 0);

function vaHoraSP() {
  const p = new Intl.DateTimeFormat('en-GB', { timeZone: 'America/Sao_Paulo', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date());
  return Number(p.slice(0, 2)) * 60 + Number(p.slice(3, 5));
}
// O turno de depois da meia-noite é do dia anterior. O motor lê das 10:00 às 02:00: antes de 10:40 ainda não dá para cobrar.
function vaLojaDeveriaLer(u) {
  const m = vaHoraSP();
  if (m >= 120 && m < 640) return false;
  const dia = m < 120 ? fxSomaDias(trHoje(), -1) : trHoje();
  return (VA.aberto[dia] || {})[u] !== false;
}
function vaUltimaLeitura(u) {
  const ls = VA.linhas.filter((l) => l.unidade === u);
  return ls.length ? ls.reduce((m, l) => (l.atualizado_em > m ? l.atualizado_em : m), ls[0].atualizado_em) : null;
}
function vaAtrasoMin(u) {
  if (!vaLojaDeveriaLer(u)) return 0;
  const t = vaUltimaLeitura(u);
  if (!t) return Infinity;
  const min = (Date.now() - new Date(t).getTime()) / 60000;
  return min > VA_ATRASO_MIN ? min : 0;
}
function vaLojasRede() {
  const ls = (LOJA_INFO.lojas || []).filter((l) => l !== LOJA_REDE && l !== VA_A_PARTE);
  VA.linhas.forEach((l) => { if (l.unidade !== VA_A_PARTE && !ls.includes(l.unidade)) ls.push(l.unidade); });
  return ls;
}
function vaPassaFiltro(l) {
  const f = VA.filtro;
  return (!f.canal || l.canal === f.canal) && (!f.marca || l.marca === f.marca) && (!f.turno || l.turno === f.turno) && (!f.tipo || l.tipo === f.tipo);
}
function vaDelta(hoje, antes, txt) {
  if (!antes) return '';
  const d = (hoje - antes) / antes * 100;
  const n = Math.abs(d).toLocaleString('pt-BR', { maximumFractionDigits: 0 });
  const seta = Math.round(d) === 0 ? '<b>igual</b>' : d > 0 ? `<span class="va-sobe">▲ ${n}%</span>` : `<span class="va-desce">▼ ${n}%</span>`;
  return `${seta} · ${txt}`;
}
// A comparação de um conjunto de lojas: loja fechada no dia da semana passada não entra (§C3).
function vaComparacao(lojas) {
  const bases = VA.base.filter((b) => lojas.includes(b.unidade));
  const abertas = bases.filter((b) => b.aberta_no_dia_base);
  const fechadas = bases.filter((b) => !b.aberta_no_dia_base);
  const hoje = VA.linhas.filter((l) => !l.cancelada && abertas.some((b) => b.unidade === l.unidade));
  return { abertas, fechadas, valorHoje: vaSoma(hoje, 'valor'), pedHoje: vaSoma(hoje, 'pedidos'), valorBase: vaSoma(abertas, 'valor'), pedBase: vaSoma(abertas, 'pedidos') };
}
function vaLegendaComparacao(c) {
  const ref = c.abertas[0] || c.fechadas[0];
  if (!ref) return '';
  const quando = vaDdmm(ref.dia_base);
  const sem = c.fechadas.map((b) => lojaNome(b.unidade)).join(', ');
  if (!c.abertas.length) return (c.fechadas.length > 1 ? 'Lojas fechadas' : 'Loja fechada') + ` em ${quando}: sem comparação.`;
  if (!c.valorBase) return `Sem venda em ${quando} para comparar.`;
  return `Comparado com ${vaPassado(ref.dia_base)} (${quando}) até esta hora.` + (sem ? ` Sem ${sem}, fechada em ${quando}.` : '');
}

function vaNumeros(ped, valor, comp) {
  const med = ped ? valor / ped : 0;
  const c = comp && comp.valorBase ? comp : null;
  const medHoje = c && c.pedHoje ? c.valorHoje / c.pedHoje : 0, medBase = c && c.pedBase ? c.valorBase / c.pedBase : 0;
  // loja fechada na semana passada está no total e fora da comparação: o "era" ao lado do total pareceria contradição
  const sem = c && c.fechadas.length ? 'sem ' + c.fechadas.map((b) => lojaNome(b.unidade)).join(', ') : '';
  const era = (txt) => sem || 'era ' + txt;
  const cartao = (rot, val, delta) => `<div class="va-num"><div class="va-num-rot">${rot}</div><div class="va-num-val">${val}</div><div class="va-delta">${delta || '&nbsp;'}</div></div>`;
  return `<div class="va-numeros">` +
    cartao('Faturamento', vaBrl(valor), c ? vaDelta(c.valorHoje, c.valorBase, era(vaBrl(c.valorBase))) : '') +
    cartao('Pedidos', vaInt(ped), c ? vaDelta(c.pedHoje, c.pedBase, era(vaInt(c.pedBase))) : '') +
    cartao('Valor médio', vaBrl(med), c ? vaDelta(medHoje, medBase, era(vaBrl(medBase))) : '') + `</div>`;
}
function vaAvisoAtraso(lojas) {
  const atras = lojas.map((u) => ({ u, min: vaAtrasoMin(u) })).filter((x) => x.min);
  if (!atras.length) return '';
  const txt = atras.map(({ u, min }) => {
    const t = vaUltimaLeitura(u);
    if (!t) return `${lojaNome(u)}: nenhuma leitura neste dia`;
    return `${lojaNome(u)}: número das ${vaHora(t)}, sem leitura há ${min >= 90 ? Math.round(min / 60) + ' h' : Math.round(min) + ' min'}`;
  }).join(' · ');
  return `<div class="va-alerta">Número atrasado. ${trEscH(txt)}</div>`;
}
function vaRede(el, cab) {
  const lojas = vaLojasRede();
  const ok = VA.linhas.filter((l) => !l.cancelada && lojas.includes(l.unidade));
  const comp = vaComparacao(lojas);
  const dados = lojas.map((u) => {
    const ls = ok.filter((l) => l.unidade === u);
    return { u, valor: vaSoma(ls, 'valor'), ped: vaSoma(ls, 'pedidos'), base: VA.base.find((b) => b.unidade === u) };
  }).sort((a, b) => b.valor - a.valor);
  const linha = (d, podeTocar) => {
    const t = vaUltimaLeitura(d.u);
    let cmp = '';
    if (d.base && !d.base.aberta_no_dia_base) cmp = `loja fechada em ${vaDdmm(d.base.dia_base)}`;
    else if (d.base && Number(d.base.valor)) cmp = vaDelta(d.valor, Number(d.base.valor), 'era ' + vaBrl(d.base.valor));
    const hora = !t ? 'sem leitura' : (vaAtrasoMin(d.u) ? `<span class="va-velho">número das ${vaHora(t)}</span>` : `às ${vaHora(t)}`);
    return `<button class="va-loja" ${podeTocar ? `onclick="vaPedirLoja('${trEscH(d.u)}')"` : 'disabled'}>
      <b>${trEscH(lojaNome(d.u))}</b><span class="va-loja-val">${vaBrl(d.valor)}</span>
      <small>${vaPed(d.ped)} · médio ${vaBrl(d.ped ? d.valor / d.ped : 0)} · ${hora}</small><small>${cmp}</small></button>`;
  };
  const partes = VA.linhas.filter((l) => !l.cancelada && l.unidade === VA_A_PARTE);
  const aparte = partes.length ? `<div class="va-titulo">Fora do total</div>` +
    linha({ u: VA_A_PARTE, valor: vaSoma(partes, 'valor'), ped: vaSoma(partes, 'pedidos'), base: null }, (LOJA_INFO.lojas || []).includes(VA_A_PARTE)) : '';
  el.innerHTML = cab(lojas) + vaAvisoAtraso(lojas) + vaNumeros(vaSoma(ok, 'pedidos'), vaSoma(ok, 'valor'), comp) +
    `<div class="va-comp">${vaLegendaComparacao(comp)}</div>` +
    `<div class="va-titulo">Por loja</div>` + dados.map((d) => linha(d, true)).join('') + aparte;
}
function vaOpcoes(valores, atual, nomeTodos, rotulo) {
  return `<option value="">${nomeTodos}</option>` + valores.map((v) =>
    `<option value="${trEscH(v)}"${v === atual ? ' selected' : ''}>${trEscH(rotulo ? rotulo(v) : v)}</option>`).join('');
}
function vaLoja(el, cab, u) {
  const daLoja = VA.linhas.filter((l) => l.unidade === u);
  const f = VA.filtro;
  ['canal', 'marca', 'turno'].forEach((k) => { if (f[k] && !daLoja.some((l) => l[k] === f[k])) delete f[k]; });
  const distintos = (k) => [...new Set(daLoja.map((l) => l[k]))].filter(Boolean).sort((a, b) => a.localeCompare(b, 'pt-BR'));
  const turnos = VA_TURNOS.filter((t) => daLoja.some((l) => l.turno === t));
  const filtradas = daLoja.filter(vaPassaFiltro);
  const ok = filtradas.filter((l) => !l.cancelada), canc = filtradas.filter((l) => l.cancelada);
  const temFiltro = Object.keys(f).some((k) => f[k]);
  const comp = temFiltro ? null : vaComparacao([u]);
  // os blocos seguem canal, marca e turno, mas não o próprio clique: tocar num bloco não pode apagar os outros
  const paraBlocos = daLoja.filter((l) => !l.cancelada && (!f.canal || l.canal === f.canal) && (!f.marca || l.marca === f.marca) && (!f.turno || l.turno === f.turno));
  const blocos = VA_TIPOS.map((t) => {
    const ls = paraBlocos.filter((l) => l.tipo === t);
    const ped = vaSoma(ls, 'pedidos'), val = vaSoma(ls, 'valor');
    return `<button class="va-tipo${f.tipo === t ? ' ativo' : ''}" onclick="vaFiltroTipo('${t}')"><b>${t}</b><span>${vaBrl(val)}</span><small>${vaPed(ped)} · médio ${vaBrl(ped ? val / ped : 0)}</small></button>`;
  }).join('');
  const linha = (rot, val) => `<div class="va-linha"><span>${rot}</span><b>${val}</b></div>`;
  el.innerHTML = cab([u]) + vaAvisoAtraso([u]) + vaNumeros(vaSoma(ok, 'pedidos'), vaSoma(ok, 'valor'), comp) +
    `<div class="va-comp">${comp ? vaLegendaComparacao(comp) : 'Com filtro, sem comparação com a semana passada.'}</div>` +
    `<div class="va-filtros">
      <label>Canal<select onchange="vaFiltro('canal', this.value)">${vaOpcoes(distintos('canal'), f.canal, 'Todos', vaCanal)}</select></label>
      <label>Marca<select onchange="vaFiltro('marca', this.value)">${vaOpcoes(distintos('marca'), f.marca, 'Todas')}</select></label>
      <label>Turno<select onchange="vaFiltro('turno', this.value)">${vaOpcoes(turnos, f.turno, 'Todos')}</select></label>
    </div>` +
    `<div class="va-titulo">Por tipo de venda</div><div class="va-tipos">${blocos}</div>` +
    `<div class="va-titulo">Cancelados</div><div class="va-linhas">${linha(vaPed(vaSoma(canc, 'pedidos')), vaBrl(vaSoma(canc, 'valor')))}</div>` +
    `<div class="va-titulo">Composição</div><div class="va-linhas">` +
      linha('Valor dos itens', vaBrl(vaSoma(ok, 'valor_itens'))) + linha('Taxa de serviço', vaBrl(vaSoma(ok, 'taxa_servico'))) +
      linha('Taxa de entrega', vaBrl(vaSoma(ok, 'taxa_entrega'))) + linha('Acréscimos', vaBrl(vaSoma(ok, 'acrescimo'))) +
      linha('Descontos', vaBrl(vaSoma(ok, 'desconto'))) + `</div>` +
    `<div class="va-titulo">Cupons fiscais</div><div class="va-linhas">` +
      linha('Emitidos', vaInt(vaSoma(ok, 'cupons_emitidos'))) + linha('Valor', vaBrl(vaSoma(ok, 'valor_cupons'))) + `</div>`;
}
function vaDesenhar() {
  const el = document.getElementById('view-vendasagora');
  if (!el) return;
  const loja = lojaAtual();
  if (!loja) {
    el.innerHTML = `<h1>Vendas agora</h1><div class="contexto" style="margin-top:12px;">${LOJA_INFO ? 'Sem loja cadastrada — fale com o Neto.' : '✗ Não consegui ler a sua loja. <button class="preset-btn" onclick="vaLer()">Tentar de novo</button>'}</div>`;
    return;
  }
  const cab = (lojas) => {
    const horas = lojas.map(vaUltimaLeitura).filter(Boolean).sort();
    const nome = loja === LOJA_REDE ? 'Rede' : lojaNome(loja);
    const dia = VA.dia ? `${vaSemana(VA.dia)} ${vaDdmm(VA.dia)}` : '';
    return `<h1>Vendas agora</h1><div class="va-sub">${trEscH(nome)}${dia ? ' · ' + dia : ''}${horas.length ? ' · atualizado às ' + vaHora(horas[0]) : ''}</div>` +
      (VA.falha ? `<div class="va-alerta va-falha">✗ Não consegui atualizar agora: ${trEscH(VA.falha)}. Os números abaixo são da leitura anterior. <button class="preset-btn" onclick="vaLer()">Tentar de novo</button></div>` : '');
  };
  if (!VA.dia) {
    el.innerHTML = cab([]) + (VA.falha ? '' : '<div class="contexto">Ainda não há leitura de vendas.</div>');
    return;
  }
  if (loja === LOJA_REDE) vaRede(el, cab); else vaLoja(el, cab, loja);
}
function vaFiltro(k, v) { if (v) VA.filtro[k] = v; else delete VA.filtro[k]; vaDesenhar(); }
function vaFiltroTipo(t) { if (VA.filtro.tipo === t) delete VA.filtro.tipo; else VA.filtro.tipo = t; vaDesenhar(); }
function vaPedirLoja(u) {
  if (NA_CASCA) avisarCasca({ tipo: 'casca-loja-pedir', loja: u });
  else lojaEscolher(u);
}
async function vaJson(url) {
  const r = await trFetch(url);
  if (!r.ok) throw new Error(await trErroDe(r));
  return r.json();
}
async function vaLer() {
  try {
    const ult = await vaJson('vendas_agora?select=dia&order=dia.desc&limit=1');
    const dia = ult.length ? ult[0].dia : null;
    const ontem = fxSomaDias(trHoje(), -1);
    const [linhas, base, abertos] = dia ? await Promise.all([
      vaJson(`vendas_agora?select=*&dia=eq.${dia}`),
      vaJson('vw_vendas_agora_semana_passada?select=*'),
      vaJson(`dim_unidade_dia?select=unidade,dia,aberto&dia=in.(${ontem},${trHoje()})`),
    ]) : [[], [], []];
    VA.aberto = {};
    abertos.forEach((a) => { (VA.aberto[a.dia] = VA.aberto[a.dia] || {})[a.unidade] = a.aberto; });
    Object.assign(VA, { dia, linhas, base: base.map((b) => ({ ...b, valor: Number(b.valor) || 0, pedidos: Number(b.pedidos) || 0 })), falha: null });
  } catch (e) {
    VA.falha = e.message || 'sem conexão';
  }
  vaDesenhar();
}
async function entrarVendasAgora() {
  const el = document.getElementById('view-vendasagora');
  if (!VA.dia && !VA.linhas.length) el.innerHTML = '<h1>Vendas agora</h1><div class="va-sub">carregando…</div>';
  await lojaCarregar();
  if (!VA.ouve) {
    VA.ouve = true;
    aoMudarLoja(() => { VA.filtro = {}; vaDesenhar(); });
    setInterval(() => { if (!document.hidden) vaLer(); }, VA_RELER_MS);
    document.addEventListener('visibilitychange', () => { if (!document.hidden) vaLer(); });
  }
  await vaLer();
}
