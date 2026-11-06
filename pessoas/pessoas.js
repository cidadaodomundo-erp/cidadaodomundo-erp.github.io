// Pessoas (RH) do painel Cidadão do Mundo: Reembolsos, Pagamento fora da folha, Cargos e salários (VT/VA, folha,
// adiantamento, bonificação), Correções na Flash e Descontos em folha. Saiu de docs/dashboard.html em 26/10/2026 (bloco 4
// do painel em módulos): MOVIDO, não copiado, em três trechos aqui em sequência. Carregado pelo dashboard.html e por
// docs/pessoas/index.html, depois do nucleo.js (consultarTudo, fmt, rmbSessao, rmbFazerLogin, ffDdmm, trFetch, trRpc,
// souODono). mostrarModulo é de cada página. Dado pessoal: quem lê o quê decide o banco (frente RH conferiu em 26/10).
// Quem mexe aqui: o chat "Telas do painel"; os dados são da frente RH.

// ------------------------------------------------------------------
// MODULO REEMBOLSOS (aplicado da fila em 16/08/2026). O pagamento ja
// vinha do Saipos; o que nao existia era a FILA — quanto a empresa deve
// agora e ha quantos dias. Fonte: vw_rmb_*. A ESCRITA (lancar gasto,
// foto da nota, aprovar) usa login individual do Supabase: policies no
// banco decidem quem pode o que (o status de nascimento e do gatilho,
// nao do navegador). anon segue so leitura. Pre-requisito: os 4 usuarios
// criados no Supabase e rmb_pessoas.email preenchido (REEMBOLSOS-PAINEL.md).
let REEMBOLSOS = null;
const RMB_SUBTIPOS = ['TAXAS COZINHA', 'MOTOBOY', 'TAXAS SALAO', 'SISTEMA DE GESTAO',
                      'USO E CONSUMO', 'MANUTENCAO', 'DESPESAS ADMINISTRATIVAS'];
// 26/10/2026: EMAIL_DONO, carregarEmailDono e souODono moram no nucleo.js (o Caixa usa, o painel também).



function rmbSair() { localStorage.removeItem('rmbSessao'); renderModuloReembolsos(REEMBOLSOS); }

// Cada modulo trata o pos-login do seu jeito. A funcao compartilhada so
// autentica e devolve true/false.
async function reembolsosLogin() {
  if (!(await rmbFazerLogin())) return;   // o erro ja esta escrito na tela
  await entrarReembolsos();
}





async function rmbEnviarGasto() {
  const msg = document.getElementById('rmbFormMsg');
  const pessoa = document.getElementById('rmbPessoa').value;
  const data = document.getElementById('rmbData').value;
  const valor = Number(String(document.getElementById('rmbValor').value).replace(',', '.'));
  const descricao = document.getElementById('rmbDesc').value.trim();
  const subtipo = document.getElementById('rmbSubtipo').value || null;
  const arquivo = document.getElementById('rmbNota').files[0] || null;
  if (!pessoa || !data || !valor || !descricao) {
    msg.textContent = 'Preencha quem, quando, quanto e o que foi.'; msg.style.display = 'block'; return;
  }
  msg.textContent = 'Enviando...'; msg.style.display = 'block';
  try {
    let caminho = null;
    if (arquivo) {
      caminho = `${pessoa}/${Date.now()}-${arquivo.name.replace(/[^a-zA-Z0-9_.-]/g, '_')}`;
      let up = await fetch(`${SUPABASE_URL}/storage/v1/object/comprovantes/${caminho}`, {
        method: 'POST',
        headers: { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${rmbSessao().access_token}` },
        body: arquivo,
      });
      if (await rmbRenovarSeExpirado(up)) {
        up = await fetch(`${SUPABASE_URL}/storage/v1/object/comprovantes/${caminho}`, {
          method: 'POST',
          headers: { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${rmbSessao().access_token}` },
          body: arquivo,
        });
      }
      if (!up.ok) throw new Error('a foto da nota não subiu (' + up.status + ')');
    }
    let r = await fetch(`${SUPABASE_URL}/rest/v1/rmb_gastos`, {
      method: 'POST',
      headers: rmbHeaders({ Prefer: 'return=minimal' }),
      body: JSON.stringify({ pessoa, data_gasto: data, valor, descricao, subtipo,
                             unidade: 'AGUA VERDE', comprovante_url: caminho, origem: 'PAINEL' }),
    });
    if (await rmbRenovarSeExpirado(r)) {
      r = await fetch(`${SUPABASE_URL}/rest/v1/rmb_gastos`, {
        method: 'POST', headers: rmbHeaders({ Prefer: 'return=minimal' }),
        body: JSON.stringify({ pessoa, data_gasto: data, valor, descricao, subtipo,
                               unidade: 'AGUA VERDE', comprovante_url: caminho, origem: 'PAINEL' }),
      });
    }
    if (!r.ok) throw new Error((await r.text()).slice(0, 160));
    REEMBOLSOS = null;
    await entrarReembolsos();
  } catch (e) {
    msg.textContent = 'Não gravou: ' + e.message + ' — o banco recusa gasto lançado em nome de outra pessoa (só o Neto pode).';
    msg.style.display = 'block';
  }
}

async function rmbDecidir(id, status) {
  let r = await fetch(`${SUPABASE_URL}/rest/v1/rmb_gastos?id=eq.${id}`, {
    method: 'PATCH',
    headers: rmbHeaders({ Prefer: 'return=minimal' }),
    body: JSON.stringify({ status, aprovado_por: 'NETO', aprovado_em: new Date().toISOString() }),
  });
  if (await rmbRenovarSeExpirado(r)) {
    r = await fetch(`${SUPABASE_URL}/rest/v1/rmb_gastos?id=eq.${id}`, {
      method: 'PATCH', headers: rmbHeaders({ Prefer: 'return=minimal' }),
      body: JSON.stringify({ status, aprovado_por: 'NETO', aprovado_em: new Date().toISOString() }),
    });
  }
  if (!r.ok) { alert('Não gravou a decisão — só o dono aprova (policy do banco).'); return; }
  REEMBOLSOS = null;
  await entrarReembolsos();
}

async function rmbVerNota(caminho) {
  const s = await fetch(`${SUPABASE_URL}/storage/v1/object/sign/comprovantes/${caminho}`, {
    method: 'POST', headers: rmbHeaders(), body: JSON.stringify({ expiresIn: 3600 }),
  });
  const d = await s.json();
  if (d.signedURL) window.open(`${SUPABASE_URL}/storage/v1${d.signedURL}`, '_blank');
  else alert('Não consegui abrir a nota (o bucket é privado — precisa estar logado).');
}

async function carregarReembolsos() {
  const [saldo, fila, orfaos] = await Promise.all([
    consultarTudo('vw_rmb_saldo_pessoa?select=*&order=a_receber.desc'),
    consultarTudo('vw_rmb_fila?select=*&order=data_gasto.asc'),
    consultarTudo('vw_rmb_sem_registro?select=debito'),
  ]);
  return { saldo, fila, orfaos };
}

// ------------------------------------------------------------------
// Cartao & maquininha (Rede, adquirente do Itau). Fonte: API da Rede em
// producao, lida pela nossa conciliadora VICENTE E IKOMA. Ligado ao painel em
// 18/08/2026 — o que a rede paga de MDR e de aluguel de maquininha, por loja e
// por bandeira, direto da fonte. Views: vw_rede_taxas_efetivas (venda x MDR) e
// vw_rede_aluguel (cobranca de aluguel por loja/mes). Ambas ja medidas seguras
// no timeout de 3s do anon (rede_vendas ~15k linhas, nada perto de fato_pedidos).
// 26/10/2026: o mergulho do dia do Fechamento de Caixas (conciliação de cartão) mora em docs/caixa/caixa.js.


async function entrarReembolsos() {
  const alvo = document.getElementById('view-reembolsos');
  if (!alvo) return;
  await carregarEmailDono();   // decide se aparecem os botoes de aprovar
  if (REEMBOLSOS === null) {
    alvo.innerHTML = '<div class="contexto">Carregando os reembolsos...</div>';
    REEMBOLSOS = await carregarReembolsos();
  }
  renderModuloReembolsos(REEMBOLSOS);
}

function renderModuloReembolsos(dados) {
  const { saldo, fila, orfaos } = dados || {};   // aceita nulo: ver bug do login de 21/08
  const alvo  = document.getElementById('view-reembolsos');
  if (!alvo) return;
  const reais = (v) => 'R$ ' + Number(v).toLocaleString('pt-BR', { minimumFractionDigits:2, maximumFractionDigits:2 });
  const ddmm  = (d) => new Date(d + 'T12:00:00').toLocaleDateString('pt-BR', { day:'2-digit', month:'2-digit' });
  const sessao = rmbSessao();
  const souDono = souODono();

  const totalAberto = saldo.reduce((a, p) => a + Number(p.a_receber), 0);
  const orfaoValor  = orfaos.reduce((a, l) => a + Number(l.debito), 0);

  // Um card por pessoa: quanto devemos e ha quantos dias espera.
  const cards = saldo.map(p => {
    const dias = p.espera_mais_antiga_dias;
    // a cor e fato (esta esperando ha muito), nao julgamento
    const cor = dias == null ? '#8a897e' : dias > 30 ? '#ff6b6b' : dias > 15 ? '#f5a623' : '#3fb950';
    return `<div class="card" style="border:1px solid ${cor};">
      <div style="font-size:12px; color:#a5a49a; text-transform:uppercase;">${p.pessoa}</div>
      <div style="font-size:26px; font-weight:700;">${reais(p.a_receber)}</div>
      <div style="font-size:12px; color:#a5a49a;">${
        Number(p.a_receber) === 0 ? 'nada em aberto'
        : `${p.gastos_em_aberto} gasto${p.gastos_em_aberto > 1 ? 's' : ''} · o mais antigo espera <b style="color:${cor};">${dias} dias</b>`
      }</div>
      <div style="font-size:11px; color:#8a897e; margin-top:4px;">já devolvido: ${reais(p.ja_reembolsado_total)}</div>
    </div>`;
  }).join('');

  const linhas = fila.map(g => {
    const badge  = { PENDENTE:'#f5a623', APROVADO:'#3fb950', REVISAR:'#ff6b6b' }[g.status] || '#8a897e';
    const rotulo = { PENDENTE:'esperando você', APROVADO:'pode pagar', REVISAR:'revisar' }[g.status] || g.status;
    // Aprovar/recusar saiu em 21/08/2026 junto com as regras do banco: o modulo
    // volta ao assunto mais para a frente, com o desenho refeito. Deixar o botao
    // sem a policy por tras so entregaria erro a quem clicasse. (souDono segue
    // calculado porque o resto da tela usa.)
    const acoes = '';
    return `<tr>
      <td style="padding:5px 8px; color:#a5a49a;">${ddmm(g.data_gasto)}</td>
      <td style="padding:5px 8px;">${g.pessoa}</td>
      <td style="padding:5px 8px;">${g.descricao}</td>
      <td style="padding:5px 8px; color:#a5a49a;">${g.subtipo || 'sem classificação'}</td>
      <td style="padding:5px 8px; text-align:right; font-weight:600;">${reais(g.valor)}</td>
      <td style="padding:5px 8px; text-align:right; color:#a5a49a;">${g.dias_esperando} d</td>
      <td style="padding:5px 8px;"><span style="color:${badge}; border:1px solid ${badge}; border-radius:12px; padding:2px 8px; font-size:11px;">${rotulo}</span>${acoes}</td>
      <td style="padding:5px 8px;">${g.comprovante_url
        ? (sessao ? `<a href="javascript:void(0)" onclick="rmbVerNota('${g.comprovante_url}')" style="color:#a5a49a;">nota</a>`
                  : '<span style="color:#8a897e;" title="entre para ver">nota 🔒</span>')
        : '<span style="color:#8a897e;">sem nota</span>'}</td>
    </tr>`;
  }).join('');

  const hoje = new Date().toISOString().slice(0, 10);
  const blocoEntrar = sessao
    ? `<div class="contexto" style="text-align:left;">
        logado como <b>${sessao.email}</b> · <a href="javascript:void(0)" onclick="rmbSair()" style="color:#a5a49a;">sair</a>
        <div class="contexto" style="border-color:#e8b04b; margin-top:10px;">
          <b>Lançamento pausado.</b> As regras de quem lança e de quem aprova saíram do banco
          em 21/08/2026, a pedido do dono — elas foram desenhadas antes de o painel ter login
          por pessoa. O módulo segue mostrando a fila e o histórico; lançar volta quando o
          assunto for retomado. Enquanto isso, gasto novo entra pelo importador, como sempre
          entrou.</div>
      </div>`
    : `<div class="contexto" style="text-align:left;">
        <a href="javascript:void(0)" onclick="document.getElementById('rmbLoginBox').style.display='block'; this.style.display='none';" style="color:#a5a49a;">Entrar para lançar um gasto ou ver as notas →</a>
        <div id="rmbLoginBox" style="display:none; margin-top:8px;">
          <div style="display:flex; gap:8px; flex-wrap:wrap;">
            <input id="rmbEmail" type="email" placeholder="e-mail" style="flex:1; min-width:180px; background:#232321; border:1px solid #34332f; color:#fff; border-radius:8px; padding:8px;">
            <input id="rmbSenha" type="password" placeholder="senha" style="flex:1; min-width:140px; background:#232321; border:1px solid #34332f; color:#fff; border-radius:8px; padding:8px;">
            <button onclick="reembolsosLogin()" style="background:#c8102e; border:none; color:#fff; font-weight:700; border-radius:8px; padding:8px 18px; cursor:pointer;">Entrar</button>
          </div>
          <div id="rmbLoginErro" style="display:none; color:#ff6b6b; font-size:12px; margin-top:6px;"></div>
        </div>
      </div>`;

  alvo.innerHTML = `
    <div class="section-label" style="border-top:none; margin-top:0; padding-top:0;">Reembolsos</div>
    <div class="caption-label" style="text-align:center;">
      Quanto a empresa deve para quem gastou do próprio bolso, e há quanto tempo essa pessoa espera.
    </div>
    ${blocoEntrar}
    <div class="cards">${cards}</div>
    ${totalAberto > 0
      ? `<div class="caption-label" style="text-align:center;">Em aberto agora: <b>${reais(totalAberto)}</b>.</div>`
      : `<div class="caption-label" style="text-align:center;">Nada em aberto — todo reembolso registrado já foi devolvido.</div>`}
    ${linhas ? `
      <div class="section-label">A fila</div>
      <table style="width:100%; font-size:13px;">
        <tr style="color:#8a897e; font-size:11px; text-transform:uppercase;">
          <td style="padding:5px 8px;">gasto em</td><td style="padding:5px 8px;">quem</td>
          <td style="padding:5px 8px;">o que foi</td><td style="padding:5px 8px;">categoria</td>
          <td style="padding:5px 8px; text-align:right;">valor</td>
          <td style="padding:5px 8px; text-align:right;">esperando</td>
          <td style="padding:5px 8px;">situação</td><td style="padding:5px 8px;">comprovante</td>
        </tr>${linhas}
      </table>` : ''}
    ${orfaoValor > 0 ? `
      <div class="contexto" style="border-color:#f5a623;">
        <b>${orfaos.length} pagamentos de reembolso (${reais(orfaoValor)}) apareceram no financeiro sem passar pela fila.</b>
        Ou é uma pessoa ainda não cadastrada, ou alguém foi pago por fora do combinado —
        conferir antes de concluir. Cadastrar é um INSERT em <code>rmb_pessoas</code>.
      </div>` : ''}
    <div class="caption-label">A <b>Jane</b> também tem crédito no módulo <a href="javascript:void(0)" onclick="mostrarModulo('rh')" style="color:#a5a49a;">Descontos em folha</a>
    (dinheiro que ela emprestou a funcionários) — são dívidas de origens diferentes e não estão somadas aqui.</div>`;
}

// ------------------------------------------------------------------
// MODULO DESCONTOS EM FOLHA (aplicado da fila em 16/08/2026).
// Vales e emprestimos que a empresa adianta ao funcionario e recupera
// no contracheque. Fonte: tabelas rh_* (planilha GASTOS FUNCIONARIOS
// DESCONTAR, aba Base). A tela responde tres perguntas, nesta ordem:
// quanto sai da proxima folha, quanto devemos a quem emprestou do
// bolso, e o que esta travado.
// ------------------------------------------------------------------
let RH = null;
// Pessoa fixada (12/09/2026): a tela era a unica do grupo sem nenhuma interacao —
// cinco tabelas empilhadas que nao conversam, e para saber tudo de uma pessoa
// cruzava-se quatro listas com o olho. Clicar num nome recorta a tela nele, clicar
// de novo solta. A lista de nomes fica INTEIRA de proposito: e por ela que se troca
// de pessoa. Mesmo mecanismo do modulo evolucao.
let RH_PESSOA = null;
// O nome vai por INDICE, nunca como string dentro do onclick: nome com apostrofo
// quebraria o atributo em silencio.
let RH_NOMES = [];
function rhFixar(i) {
  const nome = RH_NOMES[i];
  if (!nome) return;
  RH_PESSOA = (RH_PESSOA === nome) ? null : nome;
  renderModuloRh();
}
function rhSoltar() { RH_PESSOA = null; renderModuloRh(); }


// ===== PAGAMENTO FORA DA FOLHA (04/09/2026) =====
// Quem fica um tempo sem registro recebe por calculo proprio: adiantamento no
// dia 20 (ou o dia util anterior) e o saldo no 5o dia util do mes seguinte.
// Parametros da pessoa em rh_ff_pessoas; o que muda por mes (gratificacao do
// salao, ajuste) em rh_ff_meses — e a Hellen quem informa; a baixa fica em
// rh_ff_pagamentos. As parcelas em aberto entram sozinhas no Fluxo projetado
// (vw_fin_contas_pagar). Le e grava como a pessoa logada: RLS pode_ver_pessoal
// (Neto, Fabio, Hellen); quem nao tem acesso ve a tela vazia.
let FF = null;
const ffAlvo = () => document.getElementById('cgFora') || document.getElementById('view-forafolha');
async function entrarForaFolha() {
  const alvo = ffAlvo();
  if (!alvo) return;
  if (!FF) alvo.innerHTML = '<div class="contexto">Carregando o pagamento fora da folha...</div>';
  // Baixa automatica (30/09/2026): o que o Saipos ja pagou AO CENTAVO fecha antes
  // de a tela abrir. Tambem roda no fim de toda carga do import_saipos.py; aqui e'
  // so para nao esperar a proxima carga. Falhar nao impede a tela.
  try { await trRpc('rh_ff_baixa_automatica', {}); } catch (e) {}
  const [rp, rm, rc, rs] = await Promise.all([
    trFetch('rh_ff_pessoas?select=*&order=nome'),
    // futuro: desde 19/10/2026 a view vai 90 dias a frente (Fluxo projetado e robo); a tela fica ate o mes corrente
    trFetch('vw_rh_ff_meses?select=*&futuro=is.false&order=nome,mes.desc'),
    trFetch('vw_rh_ff_casamento_saipos?select=*'),
    trFetch('vw_rh_saipos_acertos?select=quem,competencia,descricao,valor_saipos,id_titulo,acao&tipo=eq.FORA_DA_FOLHA'),
  ]);
  if (!rp.ok || !rm.ok) {
    alvo.innerHTML = `<div class="contexto" style="border-color:#ff6b6b;">Não consegui carregar: ${await trErroDe(rp.ok ? rm : rp)}.
      Esta tela precisa de login (Neto, Fabio ou Hellen).</div>`;
    return;
  }
  FF = { pessoas: await rp.json(), meses: await rm.json(), saipos: rc.ok ? await rc.json() : [], lancado: rs.ok ? await rs.json() : null, editando: FF ? FF.editando : null };
  renderForaFolha();
}
// quem lança, altera e baixa no Saipos é o robô (dono, 02/11/2026): a tela só mostra como está
function ffNoSaipos(p, x) {
  if (x.pagoEm) return '<span style="color:var(--tx-4);">—</span>';
  if (!FF.lancado) return '<span style="color:var(--tx-4);">não consegui ler</span>';
  const tipo = x.nome === 'SALDO' ? 'SALARIO' : 'ADIANTAMENTO';
  const L = FF.lancado.find((s) => s.competencia === x.m.mes && String(s.descricao || '').startsWith(tipo) && String(p.nome).startsWith(s.quem) && s.id_titulo != null);
  if (!L) return '<span style="color:var(--farol-perto);">falta lançar</span>';
  return Number(L.valor_saipos) === Number(x.valor) ? '<span style="color:var(--farol-ok);">✓ lançado</span>' : `<span style="color:var(--farol-perto);">valor diferente: R$ ${fmt(Number(L.valor_saipos))}</span>`;
}
function ffOutroValor(id) { const e = document.getElementById(id); if (e) e.hidden = !e.hidden; }
function ffMesTxt(d) { return new Date(d + 'T12:00:00').toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' }); }
// Aceita "3.261,66", "3261,66", "298.19" e "298" — o campo mostra em pt-BR, mas
// quem digita costuma usar ponto como decimal (foi assim que o 298,19 entrou).
function ffNum(v) {
  let s = String(v ?? '').trim().replace(/\s|R\$/g, '');
  if (!s) return 0;
  if (s.includes(',')) s = s.replace(/\./g, '').replace(',', '.');
  else if (/^-?\d{1,3}(\.\d{3})+$/.test(s)) s = s.replace(/\./g, '');   // 3.261 = milhar
  return Number(s) || 0;
}
function ffDecidir(v) { return v === null || v === undefined ? '<i style="color:#e3b341;">a decidir</i>' : (Number(v) ? 'R$ ' + fmt(Number(v)) : 'não entra'); }

function renderForaFolha() {
  const alvo = ffAlvo();
  if (!alvo || !FF) return;
  const hoje = trHoje();
  if (!FF.pessoas.length) {
    alvo.innerHTML = '<div class="contexto">Ninguém cadastrado para receber fora da folha — ou este login não tem acesso a dados de pessoal (é do Neto, do Fabio e da Hellen).</div>';
    return;
  }
  // 05/11/2026 (dono, chat RH): sem "Como funciona" nem parâmetros — os valores vêm das bases; a pessoa vira UMA linha
  // por mês nas colunas da Conferência da folha, com a origem de cada valor no título (passar o mouse)
  let h = '<span id="ffMsg"></span>';

  // O TAMANHO DA SEMANA ANTES DAS PESSOAS (12/09/2026). O loop abaixo mostra uma
  // pessoa de cada vez; quem abre a tela precisa saber primeiro quanto sai nos
  // proximos 7 dias, em quantas parcelas e o que ja passou do vencimento — sem
  // isso e preciso somar de cabeca rolando a tela. Mesmas regras do card de cada
  // pessoa (adiantamento so conta se houver valor; saldo conta ate ser baixado).
  const emSeteDias = new Date(hoje + 'T12:00:00');
  emSeteDias.setDate(emSeteDias.getDate() + 7);
  const limite7 = emSeteDias.toLocaleDateString('en-CA');
  const todasAbertas = [];
  FF.pessoas.forEach(pp => {
    FF.meses.filter(m => m.pessoa_id === pp.id).forEach(m => {
      if (Number(m.adiantamento) > 0 && !m.adiantamento_pago_em)
        todasAbertas.push({ pid: pp.id, nome: pp.nome, venc: m.vence_adiantamento, valor: Number(m.adiantamento) });
      if (!m.saldo_pago_em)
        todasAbertas.push({ pid: pp.id, nome: pp.nome, venc: m.vence_saldo, valor: Number(m.saldo) });
    });
  });
  todasAbertas.sort((a, b) => a.venc.localeCompare(b.venc));
  const ate7 = todasAbertas.filter(a => a.venc <= limite7);
  const atrasadas = todasAbertas.filter(a => a.venc < hoje);
  if (todasAbertas.length) h += `<div class="contexto" style="text-align:left; margin-top:10px;">
    <b>R$ ${fmt(ate7.reduce((s, a) => s + a.valor, 0))} a pagar nos próximos 7 dias</b>
    · ${ate7.length} parcela(s) · ${atrasadas.length
      ? `<a href="javascript:void(0)" style="color:var(--farol-fora);" title="ir para ${atrasadas[0].nome}, a vencida mais antiga" onclick="document.getElementById('ff-p${atrasadas[0].pid}').scrollIntoView({ behavior: 'smooth', block: 'start' })">${atrasadas.length} vencida(s)</a>`
      : 'nenhuma vencida'}
    <span style="color:var(--tx-3);">· R$ ${fmt(todasAbertas.reduce((s, a) => s + a.valor, 0))} em aberto no total</span></div>`;

  for (const p of FF.pessoas) {
    const meses = FF.meses.filter(m => m.pessoa_id === p.id);
    const abertas = [];
    meses.forEach(m => {
      if (Number(m.adiantamento) > 0 && !m.adiantamento_pago_em) abertas.push({ venc: m.vence_adiantamento, valor: Number(m.adiantamento), o_que: 'adiantamento de ' + ffMesTxt(m.mes) });
      if (!m.saldo_pago_em) abertas.push({ venc: m.vence_saldo, valor: Number(m.saldo), o_que: 'saldo de ' + ffMesTxt(m.mes) });
    });
    abertas.sort((a, b) => a.venc.localeCompare(b.venc));
    const prox = abertas[0];
    const vencidas = abertas.filter(a => a.venc < hoje);

    h += `<div class="contexto" id="ff-p${p.id}" style="margin-top:14px;">
      <div style="display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:8px;">
        <div><b style="font-size:15px;">${p.nome}</b> <span style="color:var(--tx-3);">· ${p.unidade} · sem registro desde ${ffDdmm(p.inicio)}/${p.inicio.slice(0, 4)} · sai da conta ${p.conta}</span></div>
      </div>
      <div class="cards" style="margin-top:10px;">
        <div class="card ${vencidas.length ? 'red' : 'blue'}"><div class="card-lbl">Próximo pagamento</div>
          <div class="card-val">${prox ? 'R$ ' + fmt(prox.valor) : '—'}</div>
          <div class="card-pct">${prox ? ffDdmm(prox.venc) + ' · ' + prox.o_que + (prox.venc < hoje ? ' · VENCIDA' : '') : 'nada em aberto'}</div></div>
        <div class="card neutral"><div class="card-lbl">Em aberto</div>
          <div class="card-val">R$ ${fmt(abertas.reduce((s, a) => s + a.valor, 0))}</div>
          <div class="card-pct">${abertas.length} parcela(s)${vencidas.length ? ' · ' + vencidas.length + ' vencida(s)' : ''}</div></div>
      </div>`;

    if (false) {   // 05/11/2026 (dono): sem campos editáveis aqui — os valores vêm das bases (vw_rh_ff_meses)
      const inp = (id, v, extra = '') => `<input id="${id}" value="${v ?? ''}" ${extra} style="background:#232321; border:1px solid #34332f; border-radius:6px; color:#fff; padding:5px 8px; width:120px;">`;
      h += `<div class="contexto" style="margin-top:10px; max-width:760px;">
        <b>Parâmetros do cálculo</b> (valores mensais, em reais — copiados do último holerite cheio)
        <div style="display:grid; grid-template-columns:auto auto; gap:6px 14px; align-items:center; margin-top:8px;">
          <span>Salário base</span>${inp('ffSal' + p.id, p.salario_base)}
          <span>Gratificação fixa</span>${inp('ffGra' + p.id, p.gratificacao)}
          <span>Adiantamento (dia 20)</span>${inp('ffAdi' + p.id, p.adiantamento)}
          <span>Desconto consumo <small style="color:#a5a49a;">(vazio = a decidir · 0 = não entra)</small></span>${inp('ffCon' + p.id, p.desconto_consumo)}
          <span>Vale transporte (parte dela) <small style="color:#a5a49a;">(vazio = a decidir · 0 = não entra)</small></span>${inp('ffVt' + p.id, p.vale_transporte)}
          <span>Fora da folha desde</span>${inp('ffIni' + p.id, p.inicio, 'type="date"')}
          <span>Até <small style="color:#a5a49a;">(vazio = segue até avisar)</small></span>${inp('ffFim' + p.id, p.fim, 'type="date"')}
          <span>Observação</span>${inp('ffObs' + p.id, p.observacao, 'style="width:360px;"')}
          <span>Empregador (sai no recibo)</span>${inp('ffEmp' + p.id, p.empregador, 'style="width:360px;"')}
          <span>CNPJ (sai no recibo)</span>${inp('ffCnpj' + p.id, p.cnpj, 'style="width:200px;"')}
        </div>
        <div style="margin-top:8px;"><button class="preset-btn" onclick="ffSalvarPessoa(${p.id})">salvar parâmetros</button></div>
      </div>`;
    }

    // Duas tabelas, de proposito: o CALCULO do mes (numeros numa linha so, com o
    // salao e o ajuste editaveis) e as PARCELAS a pagar (uma linha por parcela,
    // com baixa e recibo). Tudo junto dava 11 colunas e linhas de 3 andares.
    const inp = (id, v, ph, w, borda) => `<input id="${id}" value="${v ?? ''}" placeholder="${ph}" style="background:#232321; border:1px solid ${borda || '#34332f'}; border-radius:6px; color:#fff; padding:4px 6px; width:${w}px; text-align:right;">`;
    const temConsumo = meses.some(m => m.desconto_consumo === null || Number(m.desconto_consumo) > 0);
    const temDivida = meses.some(m => Number(m.desconto_divida) > 0);
    const desc = (v) => v === null ? '<i style="color:#e3b341;">a decidir</i>' : (Number(v) ? '−' + fmt(Number(v)) : '—');
    // 05/11/2026 (dono, chat RH): "os cálculos vem da folha, não faz sentido ter campos editáveis aqui" — só leitura,
    // nas colunas da Conferência da folha, com a origem de cada valor no título (passar o mouse)
    const temAjuste = meses.some(m => Number(m.ajuste));
    const ori = { sal: 'cadastro (Cargos e salários)', gra: '40% do salário: a gratificação de função da gerente na folha', salao: 'aba Gratificações salão',
      vt: 'fixo do cadastro (6,13 por passagem)', adi: 'lista do adiantamento do painel', div: p.desconto_divida_motivo || 'dívida' };
    h += `<div class="caption-label" style="margin-top:14px;"><b>Cálculo do mês</b> — passe o mouse no valor para ver de onde ele sai.</div>
      <div id="tabelaFfCalculo" style="overflow-x:auto;"><table style="white-space:nowrap;">
      <tr><th>Mês</th><th title="${ori.sal}">Salário</th><th title="${ori.gra}">Gratificação</th><th title="${ori.salao}">Salão</th>
          ${temAjuste ? '<th>Ajuste</th>' : ''}${temConsumo ? '<th>Consumo</th>' : ''}<th title="${ori.vt}">VT</th><th title="${ori.adi}">Adiantamento</th>
          ${temDivida ? `<th title="${ori.div}">Dívida</th>` : ''}<th title="bruto menos VT, adiantamento e dívida: o que se paga no 5º dia útil">Saldo</th></tr>`;
    for (const m of meses) {
      const key = `${p.id}_${m.mes.slice(0, 7)}`;
      h += `<tr>
        <td><b>${ffMesTxt(m.mes)}</b>${Number(m.fracao) < 1 ? `<br><small style="color:#e3b341;">${m.dias}/30 dias (${ffDdmm(m.periodo_ini)} a ${ffDdmm(m.periodo_fim)})</small>` : ''}
</td>
        <td title="${ori.sal}">${fmt(Number(m.salario))}</td>
        <td title="${ori.gra}">${fmt(Number(m.gratificacao_fixa))}</td>
        <td title="${ori.salao}">${m.gratificacao_salao === null ? '<span style="color:var(--farol-perto);">aguardando</span>' : fmt(Number(m.gratificacao_salao))}</td>
        ${temAjuste ? `<td title="${trEscH(m.ajuste_motivo || '')}">${Number(m.ajuste) ? fmt(Number(m.ajuste)) : '—'}</td>` : ''}
        ${temConsumo ? `<td>${desc(m.desconto_consumo)}</td>` : ''}
        <td title="${ori.vt}">${desc(m.vale_transporte)}</td>
        <td title="${ori.adi}">−${fmt(Number(m.adiantamento))}</td>
        ${temDivida ? `<td title="${ori.div}">${desc(m.desconto_divida)}</td>` : ''}
        <td><b>${fmt(Number(m.saldo))}</b>${(m.pendencias || []).length ? '<br><small style="color:var(--farol-perto);">' + m.pendencias.map((t) => /sal[aã]o.*n[aã]o informad/i.test(t) ? 'aguardando as gratificações do salão do mês' : t).join('<br>') + '</small>' : ''}</td>
      </tr>`;
    }
    h += `</table></div>
      <div class="caption-label" style="margin-top:14px;"><b>Parcelas a pagar</b> — marque como paga quando o dinheiro sair; o recibo abre pronto para imprimir ou salvar em PDF.</div>
      <div style="overflow-x:auto;"><table style="white-space:nowrap;">
      <tr><th>Mês</th><th>Parcela</th><th>Vencimento</th><th style="text-align:right;">Valor</th><th>Situação</th><th>Baixa</th><th>No Saipos</th><th>Recibo</th></tr>`;
    const parcelas = [];
    meses.forEach(m => {
      if (Number(m.adiantamento) > 0) parcelas.push({ m, nome: 'ADIANTAMENTO', rot: 'Adiantamento', venc: m.vence_adiantamento, valor: Number(m.adiantamento), pagoEm: m.adiantamento_pago_em, valorPago: m.adiantamento_pago });
      parcelas.push({ m, nome: 'SALDO', rot: 'Saldo do mês', venc: m.vence_saldo, valor: Number(m.saldo), pagoEm: m.saldo_pago_em, valorPago: m.saldo_pago });
    });
    // Do mais NOVO para o mais velho, igual a tabela de calculo do mes logo
    // acima (que vem do banco em mes.desc). As duas tabelas sao da mesma pessoa e
    // liam em ordens opostas — quem conferia uma na outra lia de baixo para cima
    // numa delas. O `abertas` do card continua crescente: la a pergunta e qual e
    // a PROXIMA a vencer.
    parcelas.sort((a, b) => b.venc.localeCompare(a.venc));
    for (const x of parcelas) {
      const key = `${p.id}_${x.m.mes.slice(0, 7)}`;
      const vencida = !x.pagoEm && x.venc < hoje;
      const hojeVence = !x.pagoEm && x.venc === hoje;
      const origem = x.nome === 'SALDO' ? x.m.saldo_origem : x.m.adiantamento_origem;
      const doSaipos = origem && origem.startsWith('SAIPOS');
      // pagamento do Saipos que NAO bateu ao centavo: so baixa com o "confirmar" (regra do dono, 30/09)
      const cand = !x.pagoEm && (FF.saipos || []).find(c => c.pessoa_id === p.id && c.mes === x.m.mes && c.parcela === x.nome);
      h += `<tr>
        <td>${ffMesTxt(x.m.mes)}</td><td>${x.rot}</td>
        <td style="color:${vencida ? '#ff6b6b' : hojeVence ? '#e3b341' : 'inherit'}; font-weight:${vencida || hojeVence ? 'bold' : 'normal'};">${ffDdmm(x.venc)}/${x.venc.slice(0, 4)}${vencida ? ' · VENCIDA' : hojeVence ? ' · HOJE' : ''}</td>
        <td style="text-align:right;"><b>R$ ${fmt(x.valor)}</b></td>
        <td>${x.pagoEm ? `<span style="color:#3fb950;">paga em ${ffDdmm(x.pagoEm)} (R$ ${fmt(Number(x.valorPago))})</span>${doSaipos ? ` <small style="color:#a5a49a;" title="baixa pelo pagamento lançado no Saipos">· ${origem === 'SAIPOS_AUTO' ? 'Saipos, automática' : 'Saipos, confirmada'}</small>` : ''}` : 'em aberto'}</td>
        <td>${x.pagoEm
            ? `<a href="javascript:void(0)" style="color:#a5a49a;" onclick="ffDesfazer(${p.id}, '${x.m.mes}', '${x.nome}')">desfazer</a>`
            : cand
            ? `<span style="color:#e3b341;" title="${cand.saipos_descricao}">Saipos pagou R$ ${fmt(Number(cand.saipos_valor))} em ${ffDdmm(cand.saipos_data)} · ${Number(cand.diferenca) > 0 ? '+' : '−'}${fmt(Math.abs(Number(cand.diferenca)))}</span>
               <button class="preset-btn" onclick="ffConfirmarSaipos(${p.id}, '${x.m.mes}', '${x.nome}')">confirmar</button>`
            : `<a href="javascript:void(0)" style="color:#a5a49a;" onclick="ffOutroValor('ffOut_${key}_${x.nome}')">pago com outro valor</a>
               <span id="ffOut_${key}_${x.nome}" hidden><input type="date" id="ffDt_${key}_${x.nome}" value="${hoje}" style="background:#232321; border:1px solid #34332f; border-radius:6px; color:#fff; padding:3px 5px;">
               <input id="ffVl_${key}_${x.nome}" inputmode="decimal" value="${fmt(x.valor)}" style="width:84px; background:#232321; border:1px solid #34332f; border-radius:6px; color:#fff; padding:3px 5px;">
               <button class="preset-btn" onclick="ffBaixar(${p.id}, '${x.m.mes}', '${x.nome}', ${x.valor})">marcar paga</button></span>`}</td>
        <td>${ffNoSaipos(p, x)}</td>
        <td><a href="javascript:void(0)" style="color:#a5a49a;" title="abre o recibo pronto para imprimir ou salvar em PDF" onclick="ffRecibo(${p.id}, '${x.m.mes}', '${x.nome}')">🧾 recibo</a></td>
      </tr>`;
    }
    h += `</table></div>
    </div>`;
  }
  h += `<div class="caption-label" style="max-width:820px; margin-top:10px;" title="O 5º dia útil conta de segunda a sábado, fora de feriado — tabela feriados: nacional, Paraná e Curitiba.">Saldo = salário + gratificação fixa + salão + ajuste − consumo − VT − dívida − adiantamento.
    Mês em que a pessoa entra ou sai no meio é proporcional em trintavos.</div>`;
  alvo.innerHTML = h;
}
// Valor por extenso em reais (recibo). Cobre ate 999 milhoes.
function ffExtenso(valor) {
  const u = ['', 'um', 'dois', 'três', 'quatro', 'cinco', 'seis', 'sete', 'oito', 'nove', 'dez', 'onze', 'doze', 'treze', 'quatorze', 'quinze', 'dezesseis', 'dezessete', 'dezoito', 'dezenove'];
  const d = ['', '', 'vinte', 'trinta', 'quarenta', 'cinquenta', 'sessenta', 'setenta', 'oitenta', 'noventa'];
  const c = ['', 'cento', 'duzentos', 'trezentos', 'quatrocentos', 'quinhentos', 'seiscentos', 'setecentos', 'oitocentos', 'novecentos'];
  const ate999 = (n) => {
    if (n === 0) return '';
    if (n === 100) return 'cem';
    const p = [];
    if (n >= 100) p.push(c[Math.floor(n / 100)]);
    const r = n % 100;
    if (r >= 20) { p.push(d[Math.floor(r / 10)]); if (r % 10) p.push(u[r % 10]); }
    else if (r > 0) p.push(u[r]);
    return p.join(' e ');
  };
  const inteiro = (n) => {
    if (n === 0) return 'zero';
    const partes = [];
    const mi = Math.floor(n / 1e6), mil = Math.floor((n % 1e6) / 1000), resto = n % 1000;
    if (mi) partes.push(mi === 1 ? 'um milhão' : ate999(mi) + ' milhões');
    if (mil) partes.push(mil === 1 ? 'mil' : ate999(mil) + ' mil');
    if (resto) partes.push(ate999(resto));
    // "e" antes do ultimo bloco quando ele e' menor que cem ou redondo de centena
    if (partes.length > 1 && (resto < 100 || resto % 100 === 0) && resto) { const ult = partes.pop(); return partes.join(', ') + ' e ' + ult; }
    return partes.join(', ');
  };
  const cent = Math.round(Math.abs(valor) * 100);
  const reais = Math.floor(cent / 100), cents = cent % 100;
  let s = reais ? inteiro(reais) + (reais === 1 ? ' real' : ' reais') : '';
  if (cents) s += (s ? ' e ' : '') + inteiro(cents) + (cents === 1 ? ' centavo' : ' centavos');
  return s || 'zero reais';
}

// Recibo da parcela (adiantamento ou saldo) pronto para imprimir / salvar em PDF —
// mesmo mecanismo da lista de separacao: janela nova + print(). O demonstrativo
// e' o calculo do mes que a tela mostra; nada e' recalculado aqui.
function ffRecibo(pessoaId, mes, parcela) {
  const p = FF.pessoas.find(x => x.id === pessoaId);
  const m = FF.meses.find(x => x.pessoa_id === pessoaId && x.mes === mes);
  if (!p || !m) return;
  const n = (v) => Number(v) || 0;
  const dLong = (iso) => new Date(iso + 'T12:00:00').toLocaleDateString('pt-BR', { day: '2-digit', month: 'long', year: 'numeric' });
  const mesLong = ffMesTxt(mes);
  const saldo = parcela === 'SALDO';
  const valor = saldo ? n(m.saldo) : n(m.adiantamento);
  const pagoEm = saldo ? m.saldo_pago_em : m.adiantamento_pago_em;
  const venc = saldo ? m.vence_saldo : m.vence_adiantamento;
  const dataRecibo = pagoEm || (venc <= trHoje() ? venc : trHoje());
  const titulo = saldo ? 'RECIBO DE PAGAMENTO' : 'RECIBO DE ADIANTAMENTO SALARIAL';
  const referente = saldo
    ? `ao pagamento do saldo de <b>${mesLong}</b>, conforme demonstrativo abaixo`
    : `ao adiantamento salarial de <b>${mesLong}</b>, a ser descontado no pagamento do saldo do mês`;
  const linha = (rot, v, neg) => v ? `<tr><td>${rot}</td><td class="v">${neg ? '−' : ''}${fmt(Math.abs(v))}</td></tr>` : '';
  const demonstrativo = saldo ? `
    <h2>Demonstrativo de ${mesLong}${n(m.fracao) < 1 ? ` (${m.dias}/30 dias)` : ''}</h2>
    <table>
      ${linha('Salário', n(m.salario))}
      ${linha('Gratificação', n(m.gratificacao_fixa))}
      ${linha('Gratificação salão', n(m.gratificacao_salao))}
      ${n(m.ajuste) > 0 ? linha('Ajuste' + (m.ajuste_motivo ? ' — ' + m.ajuste_motivo : ''), n(m.ajuste)) : ''}
      <tr class="tot"><td>Total de vencimentos</td><td class="v">${fmt(n(m.salario) + n(m.gratificacao_fixa) + n(m.gratificacao_salao) + Math.max(0, n(m.ajuste)))}</td></tr>
      ${n(m.ajuste) < 0 ? linha('Ajuste' + (m.ajuste_motivo ? ' — ' + m.ajuste_motivo : ''), n(m.ajuste), true) : ''}
      ${linha('Desconto consumo', n(m.desconto_consumo), true)}
      ${linha('Vale transporte', n(m.vale_transporte), true)}
      ${linha('Desconto dívida' + (m.desconto_divida_motivo ? ' — ' + m.desconto_divida_motivo : ''), n(m.desconto_divida), true)}
      ${linha('Adiantamento salarial' + (m.adiantamento_pago_em ? ' (pago em ' + ffDdmm(m.adiantamento_pago_em) + ')' : ''), n(m.adiantamento), true)}
      <tr class="tot"><td>Valor líquido</td><td class="v">${fmt(valor)}</td></tr>
    </table>` : '';
  const w = window.open('', '_blank');
  if (!w) { alert('O navegador bloqueou a janela do recibo — libere pop-ups para este site.'); return; }
  w.document.write(`<!DOCTYPE html><html><head><meta charset="utf-8"><title>Recibo — ${p.nome} — ${mesLong}</title><style>
    body { font-family:Arial, sans-serif; color:#000; margin:36px 48px; max-width:720px; font-size:14px; line-height:1.5; }
    h1 { font-size:18px; letter-spacing:1px; text-align:center; margin:0 0 4px; }
    .valor { text-align:right; font-size:16px; margin-bottom:18px; }
    h2 { font-size:12px; text-transform:uppercase; border-bottom:1.5px solid #000; padding-bottom:2px; margin:22px 0 6px; }
    table { width:100%; border-collapse:collapse; }
    td { padding:4px 6px; border-bottom:1px solid #ccc; }
    td.v { text-align:right; white-space:nowrap; width:130px; }
    tr.tot td { font-weight:bold; border-bottom:2px solid #000; }
    .ass { margin-top:60px; }
    .ass .linha { border-top:1px solid #000; width:320px; padding-top:4px; }
    @media print { .naoimprime { display:none; } body { margin:0; } }
  </style></head><body>
    <button class="naoimprime" onclick="window.print()" style="float:right; padding:8px 14px;">Imprimir / salvar PDF</button>
    <h1>${titulo}</h1>
    <div class="valor"><b>R$ ${fmt(valor)}</b></div>
    <p>Recebi de <b>${p.empregador || '(empregador não informado — preencha em "editar parâmetros")'}</b>${p.cnpj ? `, CNPJ ${p.cnpj},` : ''}
      a importância de <b>R$ ${fmt(valor)}</b> (${ffExtenso(valor)}), referente ${referente}.</p>
    ${demonstrativo}
    <p style="margin-top:24px;">Curitiba, ${dLong(dataRecibo)}.</p>
    <div class="ass"><div class="linha"><b>${p.nome}</b></div></div>
  </body></html>`);
  w.document.close();
  w.focus();
  setTimeout(() => { try { w.print(); } catch (e) {} }, 400);
}

function ffAviso(txt, ok) {
  // 29/10/2026: o recado vai à barra do resultado (fixa no pé, com a hora; não some no redesenho)
  if (ok) return avisoAcao('ok', `✓ ${txt.replace(/\.$/, '')} — às ${avisoHora()}.`);
  return avisoAcao(/^Não deu/.test(txt) ? 'erro' : 'atencao', /^Não deu/.test(txt) ? `✗ Não gravou: ${txt.replace(/^Não deu: /, '')}. Tente de novo.` : `! ${txt}`);
}
function ffEditar(id) { FF.editando = FF.editando === id ? null : id; renderForaFolha(); }
async function ffInformar(pessoa, mes) {
  const key = `${pessoa}_${mes.slice(0, 7)}`;
  const salaoTxt = document.getElementById('ffSalao_' + key).value.trim();
  avisoAcao('enviando', 'Gravando…');
  const r = await trRpcSeguro('rh_ff_informar_mes', {
    p_pessoa: pessoa, p_mes: mes,
    p_salao: salaoTxt === '' ? null : ffNum(salaoTxt),
    p_ajuste: ffNum(document.getElementById('ffAj_' + key).value),
    p_motivo: document.getElementById('ffMot_' + key).value,
  });
  if (!r.ok) { ffAviso('Não deu: ' + await trErroDe(r), false); return; }
  await entrarForaFolha();
  ffAviso('Mês salvo — o saldo já foi recalculado.', true);
}
async function ffBaixar(pessoa, mes, parcela, valor) {
  const dt = document.getElementById(`ffDt_${pessoa}_${mes.slice(0, 7)}_${parcela}`);
  const vl = document.getElementById(`ffVl_${pessoa}_${mes.slice(0, 7)}_${parcela}`);
  if (vl) valor = ffNum(vl.value);
  avisoAcao('enviando', 'Gravando…');
  const r = await trRpcSeguro('rh_ff_baixar', { p_pessoa: pessoa, p_mes: mes, p_parcela: parcela, p_pago_em: (dt && dt.value) || trHoje(), p_valor: valor });
  if (!r.ok) { ffAviso('Não deu: ' + await trErroDe(r), false); return; }
  await entrarForaFolha();
  ffAviso('Marcada como paga — saiu do Fluxo projetado.', true);
}
async function ffConfirmarSaipos(pessoa, mes, parcela) {
  avisoAcao('enviando', 'Gravando…');
  const r = await trRpcSeguro('rh_ff_confirmar_saipos', { p_pessoa: pessoa, p_mes: mes, p_parcela: parcela });
  if (!r.ok) { ffAviso('Não deu: ' + await trErroDe(r), false); return; }
  await entrarForaFolha();
  ffAviso('Baixa confirmada com o valor do Saipos. Se a diferença tem motivo, lance como ajuste do mês.', true);
}
async function ffDesfazer(pessoa, mes, parcela) {
  avisoAcao('enviando', 'Gravando…');
  const r = await trRpcSeguro('rh_ff_desfazer_baixa', { p_pessoa: pessoa, p_mes: mes, p_parcela: parcela });
  if (!r.ok) { ffAviso('Não deu: ' + await trErroDe(r), false); return; }
  await entrarForaFolha();
  ffAviso('Baixa desfeita — a parcela voltou para o Fluxo projetado.', true);
}
async function ffSalvarPessoa(id) {
  const v = (s) => document.getElementById(s + id).value.trim();
  const opc = (s) => v(s) === '' ? null : ffNum(v(s));   // vazio = a decidir; 0 = nao entra
  avisoAcao('enviando', 'Gravando…');
  const r = await trRpcSeguro('rh_ff_salvar_pessoa', {
    p_id: id, p_salario: ffNum(v('ffSal')), p_gratificacao: ffNum(v('ffGra')), p_adiantamento: ffNum(v('ffAdi')),
    p_consumo: opc('ffCon'), p_vt: opc('ffVt'), p_inicio: v('ffIni'), p_fim: v('ffFim') || null, p_observacao: v('ffObs'),
    p_empregador: v('ffEmp'), p_cnpj: v('ffCnpj'),
  });
  if (!r.ok) { ffAviso('Não deu: ' + await trErroDe(r), false); return; }
  FF.editando = null;
  await entrarForaFolha();
  ffAviso('Parâmetros salvos — todos os meses foram recalculados.', true);
}

// ------------------------------------------------------------------
// CARGOS E SALÁRIOS (22/09/2026; refeito 19/10/2026) — o controle da folha dentro do painel.
// Dono, 19/10: "eliminar minhas planilhas e trazer todo o controle pra dentro do painel ... plano de cargos e
// salários atualizado, composição do custo por funcionário envolvendo todos os gastos, rateio por setor atualizado
// (que alimenta o custo dos canais), cálculo mensal de VT e VA no último dia útil do mês e a lista de quem pega
// adiantamento no dia 20". O cadastro (rh_pessoa) se edita AQUI por rh_pessoa_salvar; o custo realizado vem do
// contas a pagar (vw_rh_custo_*), o mesmo número da DRE; o setor de cada pessoa mantém o rateio dos canais.
// Quem vê e grava: pode_ver_pessoal (dono, Fabio, Hellen). A aba Correções na Flash também abre sozinha como a
// tela 'flash', para a Arissa (sem salário). Banco: script/sql/rh_pessoas_modulo.sql.
// ------------------------------------------------------------------
let CARGOS = null;
let CARGOS_F = { tela: 'cargos', aba: 'pessoas', unidade: null, setor: null, mes: null, desligados: false, editando: null, formando: null };
// 29/10/2026: a ordem segue o trabalho do mês (dono: uma página com as atividades em abas no alto)
const CG_ABAS = [['pessoas', 'Cargos e salários'], ['vtva', 'VT e VA'], ['folha', 'Conferência da folha'], ['ferias', 'Férias'], ['adt', 'Adiantamento'],
                 ['bonif', 'Bonificação'], ['tabela', 'Tabela de cargos'], ['custo', 'Custo por pessoa'], ['setor', 'Por setor'],
                 ['saipos', 'Acertos no Saipos'], ['flash', 'Correções na Flash']];
// 29/10/2026 (dono): os passos do mês, na ordem do trabalho (período 26 a 25). Calcular ≠ conferir: o passo 2 é o que a casa
// calcula; o passo 4 é a conferência do que a contabilidade devolveu.
const CG_PASSOS = [
  { n: 1, rot: 'Cadastro', leg: 'quem é quem', abas: [['pessoas', 'Cargos e salários'], ['tabela', 'Tabela de cargos']] },
  { n: 2, rot: 'Cálculos', leg: 'a casa calcula', abas: [['vtva', 'VT e VA'], ['adt', 'Adiantamento'], ['dez', 'Gratificações salão'], ['bonif', 'Bonificação trimestral'], ['ferias', 'Férias']] },
  { n: 3, rot: 'Envio à contabilidade', leg: 'arquivo e planilha', abas: [['envio', 'Envio à contabilidade']] },
  { n: 4, rot: 'Conferência da folha', leg: 'o que voltou', abas: [['folha', 'Conferência da folha']] },
];
const CG_ACOMP = [['custo', 'Custo por pessoa'], ['setor', 'Por setor'], ['saipos', 'Acertos no Saipos'], ['flash', 'Correções na Flash']];
// 29/10/2026 13:51 (dono): cada passo é uma tela do menu Pessoas. Cada tela mostra só as suas abas (o código é o mesmo).
const CG_TELAS = {
  // 06/11/2026 (dono: "Cargos e salários e custos da folha ... juntar em uma só"; desenho do RH): o custo de verdade ao lado do cadastro
  cargos: { titulo: 'Cargos, salários e custo', leg: 'A Flash é a base oficial da folha: aqui aparecem as diferenças entre ela, o nosso cadastro e a folha da contabilidade.',
            abas: [['pessoas', 'Pessoas'], ['custo', 'Custo do mês'], ['setor', 'Por setor'], ['tabela', 'Tabela de cargos']] },
  // 02/11/2026 (dono): as Pendências da Flash ganham tela própria, junto com o resto do que está pendente no módulo
  phoje: { titulo: 'O que fazer hoje', abas: [['hoje', 'O que fazer hoje']] },
  // 29/10/2026 14:24 (dono): o que era "Acompanhar" virou tela própria (custo) ou foi para o Financeiro (acertos)
  pcusto: { titulo: 'Custo da folha', leg: 'Quanto a folha custou de verdade (contas a pagar), por pessoa e por setor. Só consulta.', abas: [['custo', 'Custo por pessoa'], ['setor', 'Por setor']] },
  pacertos: { titulo: 'Acertos da folha no Saipos', leg: 'As provisões de adiantamento, VT e VA que o robô acerta no Saipos.', abas: [['saipos', 'Acertos no Saipos']] },
  pcalc: { titulo: 'Cálculos da folha', leg: 'O que a casa calcula para a folha, na ordem de vencimento.',
           abas: [['adt', 'Adiantamento · paga dia 20'], ['dez', 'Gratificações salão · fecha a partir do dia 25'], ['vtva', 'VT e VA · último dia útil'], ['bonif', 'Bonificação trimestral · mês fechado'], ['ffcalc', 'Cálculos por fora']] },
  pferias: { titulo: 'Férias', leg: 'As que vão vencer e as já lançadas. O simulador de valores e a projeção no contas a pagar entram aqui.', abas: [['ferias', 'Férias']] },
  presc: { titulo: 'Rescisões', leg: 'Simulador e conferência das rescisões enviadas pela contabilidade, com projeção no contas a pagar.', abas: [['resc', 'Rescisões']] },
  penvio: { titulo: 'Envio à contabilidade', leg: 'Os nossos cálculos + as horas da Flash: conferir e montar o que vai para a contabilidade.', abas: [['envio', 'Envio à contabilidade']] },
  pconf: { titulo: 'Conferência da folha', leg: 'Tudo o que enviamos, conferido contra a folha que a contabilidade devolveu.', abas: [['folha', 'Conferência da folha']] },
};
function cgAlvo() { return document.getElementById('view-' + (CARGOS_F.tela || 'cargos')) || document.getElementById('view-cargos'); }
let CG_ABA_PEDIDA = new URLSearchParams(location.search).get('aba');   // link direto na aba (sistema.html#cargos/fcaixa): vale uma vez
function cgEntrarTela(t) {
  if (t === 'pcusto') { if (!CG_ABA_PEDIDA) CG_ABA_PEDIDA = 'custo'; t = 'cargos'; }   // 06/11/2026: Custo da folha entrou em Cargos, salários e custo
  if (t === 'cargos' && CG_ABA_PEDIDA === 'fcaixa') { CG_ABA_PEDIDA = null; mostrarModulo('phoje'); return; }   // link antigo, já enviado à Hellen
  CARGOS_F.tela = t;
  // pedido de outra tela (Contas a pagar → Pagamento por fora): vale uma vez
  try { const a = sessionStorage.getItem('pesAbaPedida'); if (a) { CG_ABA_PEDIDA = a; sessionStorage.removeItem('pesAbaPedida'); } } catch (e) {}
  const ok = CG_TELAS[t].abas.map(([k]) => k).concat(CG_TELAS[t].acomp ? CG_ACOMP.map(([k]) => k) : []);
  // 05/11/2026 (dono 19:52): o histórico do por fora voltou como "Cálculos por fora" (última aba dos Cálculos); o link antigo cai nela
  if (CG_ABA_PEDIDA === 'fora') CG_ABA_PEDIDA = 'ffcalc';
  if (CG_ABA_PEDIDA && ok.includes(CG_ABA_PEDIDA)) CARGOS_F.aba = CG_ABA_PEDIDA;
  CG_ABA_PEDIDA = null;
  if (!ok.includes(CARGOS_F.aba)) CARGOS_F.aba = CG_TELAS[t].abas[0][0];
  return entrarCargos();
}
const entrarPesHoje = () => cgEntrarTela('phoje'), entrarPesCargos = () => cgEntrarTela('cargos'), entrarPesCalc = () => cgEntrarTela('pcalc'), entrarPesFerias = () => cgEntrarTela('pferias'),
      entrarPesResc = () => cgEntrarTela('presc'), entrarPesEnvio = () => cgEntrarTela('penvio'), entrarPesConf = () => cgEntrarTela('pconf'),
      entrarPesCusto = () => cgEntrarTela('pcusto'), entrarPesAcertos = () => cgEntrarTela('pacertos');

const CG_SETORES = ['ADMIN', 'COZINHA', 'DELIVERY', 'PRODUÇÃO', 'SALÃO'];
const CG_DEPTOS = ['ATENDIMENTO', 'COZINHA', 'PRODUÇÃO', 'OPERACIONAL', 'LIMPEZA', 'ADMINISTRATIVO'];
const CG_EMPRESAS = { 'AGUA VERDE': ['FF AGUA VERDE', 'CIDADAO AV'], 'AHU': ['CIDADAO AHU'], 'SÃO BRAZ': ['FF SAO BRAZ'] };

const cgN = (v) => Number(v) || 0;
const cgR = (v) => cgN(v).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const cgR0 = (v) => cgN(v).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 });
const cgEsc = (s) => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');
const cgNome = (s) => String(s || '').toLowerCase().replace(/(^|\s)\(?\S/g, (c) => c.toUpperCase());
const cgData = (d) => d ? new Date(String(d).slice(0, 10) + 'T12:00:00').toLocaleDateString('pt-BR') : '–';
const cgMesRot = (d) => d ? new Date(String(d).slice(0, 10) + 'T12:00:00').toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' }) : '';
function cgMesIso(delta) { const h = new Date(); const d = new Date(h.getFullYear(), h.getMonth() + delta, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`; }

// 28/10/2026 (seletor de loja único): a loja vem do topo da casca (nucleo/loja.js); Rede = todas. Sem o loja.js (painel
// antigo) os chips de loja da própria tela continuam.
let PES_OUVE_LOJA = false;
function pesComSeletor() { return typeof lojaAtual === 'function' && typeof LOJA_INFO !== 'undefined' && !!LOJA_INFO; }
function pesLojaVista() { if (!pesComSeletor()) return null; const l = lojaAtual(); return l && l !== 'REDE' ? l : null; }
async function pesLojaPreparar() {
  if (typeof lojaCarregar !== 'function') return;
  await lojaCarregar();
  if (PES_OUVE_LOJA) return;
  PES_OUVE_LOJA = true;
  aoMudarLoja(() => { if (typeof window.reentrarTela === 'function') window.reentrarTela(); else if (CARGOS) renderModuloCargos(); });
}
async function entrarCargos() {
  await pesLojaPreparar();
  const alvo = cgAlvo();
  if (!alvo) return;
  if (CARGOS) { renderModuloCargos(); return; }
  alvo.innerHTML = '<div class="contexto">Carregando a folha...</div>';
  try {
    const desde = cgMesIso(-5);
    const [pessoas, tabela, custo, setor, conf, vtva, adt, flash, saipos, bonif, cs, faltasFF, foraCadastro, adm, comb] = await Promise.all([
      consultarTudo('vw_rh_pessoas?select=*&order=unidade,nome'),
      consultarTudo('vw_rh_cargos_tabela?select=*&order=unidade,familia,nivel,horas'),
      consultarTudo(`vw_rh_custo_pessoa_mes?select=*&mes=gte.${desde}&mes=lte.${cgMesIso(0)}&order=unidade,nome`),
      consultarTudo(`vw_rh_custo_setor_mes?select=*&mes=gte.${desde}&mes=lte.${cgMesIso(0)}&order=unidade,setor`),
      consultarTudo(`vw_rh_custo_mes_conferencia?select=*&mes=gte.${desde}&mes=lte.${cgMesIso(0)}`),
      consultarTudo(`vw_rh_vt_va_mes?select=*&mes=gte.${cgMesIso(-1)}&order=unidade,nome`),
      consultarTudo(`vw_rh_adiantamento_mes?select=*&mes=gte.${cgMesIso(-1)}&order=unidade,nome`),
      consultarTudo('vw_rh_flash_pendencias?select=*&order=unidade,nome,ordem'),
      consultarTudo('vw_rh_saipos_acertos?select=*&order=vencimento,tipo,unidade_pagadora,quem').catch(() => []),
      consultarTudo('vw_rh_bonificacao_ciclo?select=*&order=unidade,nome').catch(() => []),
      consultarTudo('vw_rh_cargos_salarios?select=*').catch(() => []),
      consultarTudo('vw_rh_faltas_flash_folha?select=*&order=mes.desc,unidade,nome').catch(() => []),
      consultarTudo('vw_rh_ferias?select=nome&situacao=like.fora%20do%20cadastro*&order=nome').catch(() => []),
      consultarTudo('rh_admissao?select=*&order=criado_em.desc').catch(() => []),
      // 05/11/2026 (dono, chat RH): o combinado além da folha se muda na ficha da pessoa, não na conferência
      consultarTudo('rh_folha_combinado?select=*&order=pessoa_id').catch(() => []),
    ]);
    CARGOS = { pessoas, tabela, custo, setor, conf, vtva, adt, flash, saipos, bonif, adm: adm || [], comb: new Map((comb || []).map((c) => [c.pessoa_id, c])),
               cs: new Map((cs || []).map((x) => [x.pessoa_id, x])), mov: {}, faltasFF: faltasFF || [], foraCadastro: [...new Set((foraCadastro || []).map((x) => x.nome))] };
  } catch (e) {
    alvo.innerHTML = `<div class="contexto">Não consegui carregar a folha: ${cgEsc(e.message)}</div>`;
    return;
  }
  if (!CARGOS.pessoas.length) {
    alvo.innerHTML = '<div class="contexto">Nada para mostrar — este login não vê dados de pessoal.</div>';
    return;
  }
  // 01/11/2026: um erro ao desenhar deixava "Carregando a folha..." para sempre (Envio à contabilidade, desde 29/10)
  try { renderModuloCargos(); }
  catch (e) { alvo.innerHTML = `<div class="contexto">✗ Não consegui montar esta tela: ${cgEsc(e.message)}</div>`; }
}
async function cgRecarregar(aviso) { CARGOS = null; await entrarCargos(); if (aviso) cgAviso(aviso, true); }
function cgAviso(txt, ok) {
  // 29/10/2026: o recado vai à barra do resultado (fixa no pé, com a hora; não some no redesenho)
  if (ok) return avisoAcao('ok', `✓ ${txt.replace(/\.$/, '')} — às ${avisoHora()}.`);
  return avisoAcao(/^Não deu/.test(txt) ? 'erro' : 'atencao', /^Não deu/.test(txt) ? `✗ Não gravou: ${txt.replace(/^Não deu: /, '')}. Tente de novo.` : `! ${txt}`);
}
function cargosAba(a) { CARGOS_F.aba = a; CARGOS_F.editando = null; CARGOS_F.formando = null; renderModuloCargos(); }
function cargosFiltrar(campo, valor) { CARGOS_F[campo] = (CARGOS_F[campo] === valor) ? null : valor; renderModuloCargos(); }
function cargosLimpar() { CARGOS_F.unidade = null; CARGOS_F.setor = null; renderModuloCargos(); }
function cargosMes(m) { CARGOS_F.mes = m; renderModuloCargos(); }

function cgChip(rot, ativo, onclick) {
  return `<button type="button" class="preset-btn ${ativo ? 'active' : ''}" onclick="${onclick}" style="padding:3px 10px;">${cgEsc(rot)}${ativo ? ' ✕' : ''}</button>`;
}
// 06/11/2026 (dono): o período dos Cálculos se escolhe numa lista suspensa, do mais antigo ao mais novo. ops = [[valor, rótulo]];
// ao escolher roda `fn(valor)` (nome de função global ou trecho que recebe v)
function cgSelPeriodo(rot, ops, atual, fn) {
  return `<label style="display:inline-flex;align-items:center;gap:8px;margin:4px 0 8px;font-size:13px;color:var(--tx-3);">${rot}
    <select onchange="(${fn})(this.value)" style="padding:6px 8px;background:var(--surface-2);color:var(--tx-1);border:1px solid var(--line);border-radius:6px;font-size:13px;">
    ${ops.map(([v, r]) => `<option value="${cgEsc(v)}" ${v === atual ? 'selected' : ''}>${cgEsc(r)}</option>`).join('')}</select></label>`;
}
function cgFiltroUnidade(lista) {
  const F = CARGOS_F;
  if (pesComSeletor()) return F.setor ? `<div style="margin:8px 0 12px;"><a href="javascript:void(0)" onclick="cargosLimpar()" style="font-size:12px;color:var(--tx-4);">limpar o setor</a></div>` : '';
  const us = [...new Set(lista.map(x => x.unidade))];
  return `<div style="display:flex;flex-wrap:wrap;gap:6px;margin:8px 0 12px;align-items:center;">
    ${us.map(u => cgChip(u, F.unidade === u, `cargosFiltrar('unidade','${cgEsc(u)}')`)).join('')}
    ${F.unidade || F.setor ? `<a href="javascript:void(0)" onclick="cargosLimpar()" style="font-size:12px;color:var(--tx-4);margin-left:6px;">limpar</a>` : ''}</div>`;
}
function cgSeletorMes(meses, atual) {
  return `<div style="display:flex;flex-wrap:wrap;gap:6px;margin:8px 0;">${meses.map(m =>
    `<button type="button" class="preset-btn ${m === atual ? 'active' : ''}" onclick="cargosMes('${m}')">${cgMesRot(m)}</button>`).join('')}</div>`;
}

function renderModuloCargos() {
  const alvo = cgAlvo();
  if (!alvo || CARGOS === null) return;
  const F = CARGOS_F;
  if (pesComSeletor()) F.unidade = pesLojaVista();
  const flashN = cgFlashDaLoja(CARGOS.flash).length;
  // 29/10/2026 (dono): as atividades do RH em abas no alto, no formato da tela de Conferências
  // 29/10/2026 (dono): o módulo é Pessoas; a tela da folha segue os passos do mês, numerados, e o que não é passo fica em Acompanhar
  const T = CG_TELAS[F.tela || 'cargos'] || CG_TELAS.cargos;
  const btAba = (k, r, ativo, grande) => `<button type="button" onclick="cargosAba('${k}')" style="background:none;border:none;border-bottom:3px solid ${ativo ? 'var(--marca-amarelo)' : 'transparent'};color:${ativo ? 'var(--tx-1)' : 'var(--tx-3)'};font:inherit;font-weight:700;font-size:${grande ? 14 : 13}px;padding:${grande ? '9px 12px' : '6px 10px'};cursor:pointer;text-align:left;">${r}</button>`;
  let h = `<h2>${T.titulo}</h2>
    ${''/* 29/10/2026 (dono): sem legenda — a tela se explica pelo título, colunas e alertas */}
    ${T.abas.length > 1 ? `<div style="display:flex;flex-wrap:wrap;gap:2px;border-bottom:1px solid var(--line);margin:0 0 10px;">${T.abas.map(([k, r]) => btAba(k, r, F.aba === k, true)).join('')}</div>` : ''}
    ${T.acomp ? `<div style="display:flex;flex-wrap:wrap;gap:4px;align-items:center;justify-content:flex-end;margin:0 0 12px;font-size:12px;color:var(--tx-4);">Acompanhar:
      ${CG_ACOMP.map(([k, r]) => `<a href="javascript:void(0)" onclick="cargosAba('${k}')" style="color:${F.aba === k ? 'var(--tx-1)' : 'var(--tx-3)'};font-weight:${F.aba === k ? 700 : 400};margin-left:8px;">${r}${k === 'flash' && flashN ? ` (${flashN})` : ''}</a>`).join('')}</div>` : ''}
    <div id="cgMsg" style="font-size:12px;min-height:16px;margin-bottom:4px;"></div>`;
  if (F.aba === 'pessoas') h += cgAbaPessoas();
  else if (F.aba === 'tabela') h += cgAbaTabela();
  else if (F.aba === 'custo') h += cgAbaCusto();
  else if (F.aba === 'setor') h += cgAbaSetor();
  else if (F.aba === 'vtva') h += cgAbaVtVa();
  else if (F.aba === 'folha') h += cgAbaFolha();
  else if (F.aba === 'ferias') h += cgAbaFerias();
  else if (F.aba === 'hoje') h += cgAbaHoje();
  // 02/11/2026 (dono): o Pagamento fora da folha é uma aba dos Cálculos; o desenho segue em renderForaFolha
  else if (F.aba === 'fora') { h += '<div id="cgFora"><div class="contexto">Carregando o pagamento por fora…</div></div>'; Promise.resolve().then(entrarForaFolha); }
  else if (F.aba === 'adt') h += cgAbaAdt();
  else if (F.aba === 'bonif') h += cgAbaBonif();
  else if (F.aba === 'ffcalc') h += cgAbaFfCalc();
  else if (F.aba === 'saipos') h += cgAbaSaipos();
  else if (F.aba === 'flash') h += cgListaFlash(CARGOS.flash);
  // 29/10/2026 18:19 (dono): o nome é "Gratificações salão" em todo lugar
  else if (F.aba === 'dez') h += cgAbaDez();
  else if (F.aba === 'resc') h += cgAbaResc();
  else if (F.aba === 'envio') h += cgAbaEnvio();
  alvo.innerHTML = h;
}

// ---------- PESSOAS (o cadastro) ----------
function cgAlertaCurto(s) { const x = String(s || '').split(/[:(;]/)[0].trim(); return x.length > 38 ? x.slice(0, 36) + '…' : x; }
// o que o cadastro acusa sozinho; a observação do RH é anotação, não pendência (fica só nos alertas de Cargos)
function cgAlertasCadastro(p) {
  const L = cgLista((CARGOS.cs.get(p.id) || {}).conferencia).map((x) => ({ t: cgAlertaCurto(x), todo: x }));
  if (p.situacao_tabela === 'DIFERENTE DA TABELA') L.push({ t: `tabela diz ${cgR(p.salario_tabela)}`, todo: 'salário diferente da tabela de cargos' });
  if (p.situacao_tabela === 'CARGO SEM CÉLULA') L.push({ t: 'cargo fora da tabela', todo: 'o cargo não existe na tabela de cargos' });
  if (p.ativo && !p.setor_rateio) L.push({ t: 'sem setor', todo: 'sem setor: não entra no custo dos canais' });
  return L;
}
function cgAbaPessoas() {
  // 29/10/2026 (dono): consulta e alertas, como num ERP — sem textos longos, sem edição (a base é a Flash)
  const F = CARGOS_F;
  const cs = (p) => CARGOS.cs.get(p.id) || null;
  const curto = cgAlertaCurto;
  // 05/11/2026 (RH): a observação do RH é anotação, não alerta — "MUDOU PARA NIVEL 3 EM AGOSTO" contava como pendência.
  // Fica na mesma coluna, em cinza, e não entra no "Com alerta".
  const alertas = (p) => cgAlertasCadastro(p);
  const nota = (p) => p.obs_rh ? `<span title="${cgEsc(p.obs_rh)}" style="display:inline-block;font-size:11.5px;color:var(--tx-3);margin:1px 0;">${cgEsc(curto(p.obs_rh))}</span>` : '';
  const base = CARGOS.pessoas.filter((p) => (F.desligados ? !p.ativo : p.ativo) && (!F.unidade || p.unidade === F.unidade));
  const nAl = base.filter((p) => alertas(p).length).length;
  const vis = F.soConferir ? base.filter((p) => alertas(p).length) : base;
  const comLoja = !F.unidade;
  const card = (rot, val, ativo, onclick, alerta) => `<div class="card ${alerta ? 'highlight' : 'neutral'}" style="cursor:pointer;${ativo ? ' outline:2px solid var(--marca-amarelo);' : ''}" onclick="${onclick}">
      <div class="card-lbl">${rot}</div><div class="card-val">${val}</div></div>`;
  let h = `${CARGOS.foraCadastro.length && !F.desligados ? `<div class="contexto" style="text-align:left;border-color:var(--farol-perto);"><b style="color:var(--farol-perto);">Na programação de férias da contabilidade e fora do cadastro:</b> ${CARGOS.foraCadastro.map((n) => cgEsc(cgNome(n))).join(', ')}</div>` : ''}
    <div class="cards" style="max-width:520px;">
      ${card(F.desligados ? 'Desligados' : 'Pessoas', base.length, !F.soConferir, 'CARGOS_F.soConferir=false;renderModuloCargos()', false)}
      ${card('Com alerta', nAl, F.soConferir, 'CARGOS_F.soConferir=true;renderModuloCargos()', nAl > 0)}
    </div>
    <div style="display:flex;justify-content:space-between;align-items:center;gap:8px;margin:-6px 0 8px;"><button type="button" class="preset-btn active" onclick="cgFormAbrir(0)">+ Novo registro</button><a href="javascript:void(0)" style="font-size:12px;color:var(--tx-4);" onclick="CARGOS_F.desligados=!CARGOS_F.desligados;CARGOS_F.soConferir=false;renderModuloCargos()">${F.desligados ? 'ver quem está na folha' : 'ver desligados'}</a></div>
    ${F.formando === 0 ? `<div class="section-label" style="text-align:left;">Novo registro</div>${cgFormPessoa(null)}` : ''}
    ${cgAdmAndamento()}`;
  h += `<div id="tabelaCgPessoas" class="cel-cartao"><table>
    <thead><tr><th></th>${comLoja ? '<th>Loja</th>' : ''}<th>Nome</th><th>Cargo</th><th>Setor</th><th>Turno</th><th style="text-align:right;">Jornada</th><th style="text-align:right;">Salário</th><th style="text-align:right;" title="o que a pessoa custou de verdade em ${cgMesRot(cgMesCustoFechado())} (contas a pagar, com encargos e rateios)">Custo no mês</th><th>Alerta</th></tr></thead>
    <tbody>${vis.map((p) => { const A = alertas(p), ab = F.editando === p.id;
      return `<tr style="cursor:pointer;" onclick="cgEditar(${p.id})">
        <td class="cg-seta" style="color:var(--tx-3);font-size:12px;font-weight:600;white-space:nowrap;">${ab ? '▾ Fechar detalhes' : '▸ Ver detalhes'}</td>
        ${comLoja ? `<td>${cgEsc(p.unidade)}</td>` : ''}
        <td class="cg-nome">${cgEsc(cgNome(p.nome))}${p.contrato !== 'CLT' ? ` <span style="font-size:10px;color:var(--farol-perto);">${cgEsc(String(p.contrato).toLowerCase())}</span>` : ''}</td>
        <td style="white-space:normal;">${cgEsc(cgNome(p.cargo_completo || p.cargo))}</td>
        <td>${p.setor_rateio ? cgEsc(p.setor_rateio) : '–'}</td><td>${cgEsc(p.turno || '–')}</td>
        <td style="text-align:right;">${p.horas ? p.horas + 'h' : '–'}</td>
        <td class="cg-sal" style="text-align:right;">${cgR(p.salario)}</td>
        <td style="text-align:right;">${(() => { const c = cgCustoDaPessoa(p.id).find((x) => String(x.mes).slice(0, 10) === cgMesCustoFechado()); return c ? cgR(c.total) : '<span style="color:var(--tx-5);">–</span>'; })()}</td>
        <td class="cg-al" style="white-space:normal;min-width:160px;">${A.map((a) => `<span title="${cgEsc(a.todo)}" style="display:inline-block;font-size:11.5px;font-weight:700;color:var(--farol-perto);border:1px solid var(--farol-perto);border-radius:999px;padding:1px 8px;margin:1px 3px 1px 0;">${cgEsc(a.t)}</span>`).join('')}${nota(p)}</td></tr>
        ${ab ? `<tr><td colspan="${comLoja ? 10 : 9}">${cgDetalhePessoa(p)}</td></tr>` : ''}`; }).join('')}</tbody></table></div>`;
  if (F.soConferir && cgFlashDaLoja(CARGOS.flash).length) h += `<div class="section-label" style="text-align:left;">Corrigir na Flash</div>` + cgListaFlash(CARGOS.flash);
  return h;
}
// a pessoa aberta (dono, 31/10/2026): as movimentações, das folhas fechadas e do cadastro, e o que a casa paga além do salário
function cgDetalhePessoa(p) {
  if (CARGOS_F.formando === p.id) return cgFormPessoa(p);
  const adm = cgAdmDaPessoa(p.id);
  return `${adm ? `<div style="font-size:12.5px;margin:2px 0 8px;">${cgAdmEtapas(adm)}</div>` : ''}<div style="display:flex;flex-wrap:wrap;align-items:center;gap:8px 12px;font-size:12.5px;margin:2px 0 8px;">
      <span><b>Admissão</b> ${p.admissao ? cgData(p.admissao) : '–'}</span>
      <span><b>VT</b> ${p.vt_por_dia ? `${p.vt_por_dia} por dia` : 'não pega'}</span><span><b>VA</b> ${p.recebe_va ? 'sim' : 'não'}</span>
      <span><b>Adiantamento</b> ${p.pega_adiantamento && p.contrato === 'CLT' ? 'sim' : 'não'}</span>${p.desligamento ? `<span><b>Saiu</b> ${cgData(p.desligamento)}</span>` : ''}
      <button type="button" class="preset-btn" onclick="cgFormAbrir(${p.id})">Editar</button></div>
    ${cgCombinadoFicha(p)}
    ${cgCustoPessoaHtml(p)}
    ${cgMovHtml(p)}`;
}
function cgCustoPessoaHtml(p) {
  const L = cgCustoDaPessoa(p.id).slice(-6);
  if (!L.length) return '';
  const col = [['salario', 'Salário e adiant.'], ['vt', 'VT'], ['va', 'VA'], ['rescisao_ferias_13', 'Rescisão, férias, 13º'], ['bonificacao', 'Bonificação'], ['encargos_rateados', 'Encargos'], ['outros', 'Outros'], ['total', 'Total']];
  const v = (c, k) => k === 'outros' ? cgN(c.outros_rateados) + cgN(c.outros_diretos) : cgN(c[k]);
  return `<div style="font-size:12.5px;margin:4px 0 8px;"><b>Custo mês a mês</b>
    <div style="overflow-x:auto;"><table style="font-size:12.5px;"><thead><tr><th>Mês</th>${col.map(([, r]) => `<th>${r}</th>`).join('')}</tr></thead><tbody>
    ${L.map((c) => { const m = String(c.mes).slice(0, 10), prev = CARGOS.conf.some((x) => String(x.mes).slice(0, 10) === m && x.tem_previsto);
      return `<tr><td>${cgMesRot(m)}${prev ? ' <span style="font-size:11px;color:var(--tx-4);">previsto</span>' : ''}</td>${col.map(([k]) => `<td${k === 'total' ? ' style="font-weight:700;"' : ''}>${cgR(v(c, k))}</td>`).join('')}</tr>`; }).join('')}</tbody></table></div></div>`;
}
// Custo do mês → a pessoa na aba Pessoas
function cgAbrirPessoa(id) {
  const p = CARGOS.pessoas.find((x) => x.id === id);
  CARGOS_F.aba = 'pessoas'; CARGOS_F.desligados = p ? !p.ativo : false; CARGOS_F.soConferir = false; CARGOS_F.editando = null;
  cgEditar(id);
  setTimeout(() => { const el = cgAlvo() && cgAlvo().querySelector('.cg-seta'); const r = [...(cgAlvo() || document).querySelectorAll('#tabelaCgPessoas tr')].find((t) => /Fechar detalhes/.test(t.textContent)); if (r) r.scrollIntoView({ block: 'center' }); }, 50);
}
// "Combinado além da folha" (dono 05/11/2026, chat RH): valor total combinado (paga a diferença do líquido) ou acréscimo
// fixo. Quem muda é esta ficha; a Conferência da folha só mostra (rh_folha_combinado / rh_folha_combinado_salvar).
function cgCombinadoFicha(p) {
  const c = (CARGOS.comb || new Map()).get(p.id), ab = CARGOS_F.combEd === p.id;
  const txt = c ? `${c.tipo === 'TOTAL' ? 'valor total combinado' : 'acréscimo fixo'} ${cgR(c.valor)} — ${cgEsc(c.motivo || '')}` : 'nenhum';
  let h = `<div style="font-size:12.5px;margin:2px 0 8px;"><b>Combinado além da folha</b> ${txt}
    <a href="javascript:void(0)" onclick="CARGOS_F.combEd=CARGOS_F.combEd===${p.id}?null:${p.id};renderModuloCargos()" style="color:var(--tx-4);margin-left:6px;">${ab ? 'fechar' : (c ? 'mudar' : 'combinar')}</a></div>`;
  if (!ab) return h;
  const t = c ? c.tipo : '';
  return h + `<div style="display:flex;flex-wrap:wrap;gap:8px;align-items:center;padding:8px 10px;border:1px solid var(--line);border-radius:8px;max-width:820px;margin-bottom:8px;">
    <select id="cgCombTipo" style="padding:6px 8px;background:var(--surface-2);color:var(--tx-1);border:1px solid var(--line);border-radius:6px;">
      <option value="TOTAL"${t === 'TOTAL' ? ' selected' : ''}>valor total combinado (paga a diferença do líquido)</option>
      <option value="ACRESCIMO"${t === 'ACRESCIMO' ? ' selected' : ''}>acréscimo fixo</option></select>
    <input id="cgCombValor" type="number" step="0.01" min="0" value="${c ? cgN(c.valor) : ''}" placeholder="valor" style="width:120px;padding:6px 8px;background:var(--surface-2);color:var(--tx-1);border:1px solid var(--line);border-radius:6px;">
    <input id="cgCombMotivo" type="text" value="${cgEsc(c ? c.motivo || '' : '')}" placeholder="motivo (obrigatório)" style="flex:1 1 200px;padding:6px 8px;background:var(--surface-2);color:var(--tx-1);border:1px solid var(--line);border-radius:6px;">
    ${cgBotaoPasso('Gravar', `cgFolhaCombSalvar(${p.id},false)`)}
    ${c ? cgBotaoPasso('Tirar o combinado', `cgFolhaCombSalvar(${p.id},true)`, true) : ''}</div>`;
}
function cgEmMontagem(titulo, texto) {
  return `<div class="contexto" style="text-align:left;border-color:var(--farol-perto);"><b>${cgEsc(titulo)} — em montagem.</b><div style="margin-top:6px;">${cgEsc(texto)}</div>
    <div style="margin-top:6px;color:var(--tx-4);font-size:12px;">Os números estão sendo conferidos pelo RH; esta parte entra aqui quando estiverem prontos.</div></div>`;
}
function cgEditar(id) {
  CARGOS_F.editando = CARGOS_F.editando === id ? null : id; CARGOS_F.formando = null; renderModuloCargos();
  if (CARGOS_F.editando && CARGOS.mov[id] === undefined) cgMovCarregar(id);
}
function cgFormAbrir(id) { CARGOS_F.formando = id; renderModuloCargos(); if (id) cgSugerirSalario(id); }
function cgFormFechar() { CARGOS_F.formando = null; CG_ADM = null; renderModuloCargos(); }
// As folhas de antes da leitura completa estão em rh_folha_historico; as demais, em rh_folha_mensal. Mesmas colunas.
async function cgMovCarregar(id) {
  CARGOS.mov[id] = null;
  const col = 'select=competencia,empresa,matricula,situacao,admissao,cargo,salario,horas&pessoa_id=eq.' + id;
  try {
    const [hist, mens, cad] = await Promise.all([consultarTudo('rh_folha_historico?' + col + '&order=competencia'), consultarTudo('rh_folha_mensal?' + col + '&order=competencia'),
      consultarTudo(`rh_pessoa_hist?select=quando,quem,antes,depois&pessoa_id=eq.${id}&order=quando`)]);
    CARGOS.mov[id] = { linhas: cgMovimentos([...hist, ...mens], cad) };
  } catch (e) { CARGOS.mov[id] = { erro: e.message }; }
  if (CARGOS_F.editando === id) renderModuloCargos();
}
// "AUXILIAR DE COZINHA II" e "Auxiliar de Cozinha Nivel 2" são o mesmo cargo: só nome diferente não é movimentação
function cgCargoIgual(c) {
  return String(c || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase().replace(/\bNIVEL\b/g, ' ')
    .replace(/\bIII\b/g, '3').replace(/\bII\b/g, '2').replace(/\bI\b/g, '1').replace(/\bDE\b|\bDA\b|\bDO\b/g, ' ').replace(/\s+/g, ' ').trim();
}
const cgEmpresaCurta = (e) => String(e || '').replace(/^\d+\s*-\s*/, '');
function cgMovimentos(folhas, cad) {
  const L = [], ts = (x) => String(x).slice(0, 10);
  const F = folhas.slice().sort((a, b) => ts(a.competencia).localeCompare(ts(b.competencia)));
  let ant = null;
  for (const f of F) {
    const q = ts(f.competencia), mes = cgMesRot(q), add = (o, de, para) => L.push({ q, quando: mes, o, de, para, fonte: 'Folha' });
    if (!ant) {
      const entrou = f.admissao && ts(f.admissao).slice(0, 7) === q.slice(0, 7);
      add(entrou ? 'Entrou' : 'Primeira folha guardada', '', [cgNome(f.cargo || ''), cgR(f.salario), f.horas ? cgN(f.horas) + 'h' : '', cgEmpresaCurta(f.empresa)].filter(Boolean).join(' · '));
    } else {
      if (cgEmpresaCurta(ant.empresa) !== cgEmpresaCurta(f.empresa)) add('Empresa', cgEmpresaCurta(ant.empresa), cgEmpresaCurta(f.empresa));
      if (cgCargoIgual(ant.cargo) !== cgCargoIgual(f.cargo)) add('Cargo', cgNome(ant.cargo || ''), cgNome(f.cargo || ''));
      if (cgN(ant.salario) !== cgN(f.salario)) add('Salário', cgR(ant.salario), `${cgR(f.salario)} (${cgN(f.salario) > cgN(ant.salario) ? '+' : ''}${String(Math.round((cgN(f.salario) / cgN(ant.salario) - 1) * 1000) / 10).replace('.', ',')}%)`);
      if (f.horas && ant.horas && cgN(ant.horas) !== cgN(f.horas)) add('Jornada', cgN(ant.horas) + 'h', cgN(f.horas) + 'h');
      if (f.situacao === 'Demitido' && ant.situacao !== 'Demitido') add('Saiu', '', cgEmpresaCurta(f.empresa));
    }
    // mês lido do holerite não traz jornada nem situação: vale a última conhecida
    ant = { ...f, horas: f.horas || (ant && ant.horas), situacao: f.situacao || (ant && ant.situacao) };
  }
  const CAMPOS = [['salario', 'Salário', cgR], ['cargo_completo', 'Cargo', cgNome], ['horas', 'Jornada', (v) => v + 'h'], ['unidade', 'Loja', String], ['setor_rateio', 'Setor', String],
    ['turno', 'Turno', String], ['contrato', 'Contrato', String], ['empresa', 'Empresa', String], ['desligamento', 'Saída', cgData]];
  for (const h of cad) {
    if (!h.antes || !h.depois) continue;
    for (const [k, rot, fmt] of CAMPOS) {
      const a = h.antes[k], d = h.depois[k];
      if (String(a ?? '') === String(d ?? '') || (k === 'salario' && cgN(a) === cgN(d))) continue;
      if (k === 'cargo_completo' && (a == null || cgCargoIgual(a) === cgCargoIgual(d))) continue;
      L.push({ q: ts(h.quando), quando: cgData(h.quando), o: rot, de: a == null || a === '' ? '–' : fmt(a), para: d == null || d === '' ? '–' : fmt(d),
               fonte: /@/.test(h.quem || '') ? 'Cadastro · ' + String(h.quem).split('@')[0] : 'Cadastro' });
    }
  }
  return L.sort((a, b) => b.q.localeCompare(a.q));
}
function cgMovHtml(p) {
  const x = CARGOS.mov[p.id];
  if (x === undefined || x === null) return '<div class="contexto" style="text-align:left;">Lendo as movimentações…</div>';
  if (x.erro) return `<div class="contexto" style="text-align:left;">✗ Não consegui ler: ${cgEsc(x.erro)} <button type="button" class="preset-btn" onclick="cgMovCarregar(${p.id})">Tentar de novo</button></div>`;
  if (!x.linhas.length) return '<div class="contexto" style="text-align:left;">Sem movimentações nas folhas guardadas.</div>';
  return `<div id="tabelaCgMov" class="cel-cartao" style="max-width:980px;"><table><thead><tr><th>Quando</th><th>O que mudou</th><th style="white-space:normal;">De</th><th style="white-space:normal;">Para</th><th>Origem</th></tr></thead><tbody>
    ${x.linhas.map((l) => `<tr><td>${cgEsc(l.quando)}</td><td><b>${cgEsc(l.o)}</b></td><td style="white-space:normal;">${cgEsc(l.de)}</td><td style="white-space:normal;">${cgEsc(l.para)}</td><td style="color:var(--tx-4);">${cgEsc(l.fonte)}</td></tr>`).join('')}
    </tbody></table></div>`;
}
function cgLista(v) { return Array.isArray(v) ? v.filter(Boolean) : v ? String(v).split(';').map((s) => s.trim()).filter(Boolean) : []; }
// as três colunas da conferência: o salário que a folha pagou, a Flash e o que não bate (textos da vw_rh_cargos_salarios)
function cgColunasConferir(c, p) {
  if (!c) return '<td></td><td></td><td></td>';
  const fs = c.folha_salario == null ? '<span style="color:var(--tx-5);">–</span>'
    : `${cgR(c.folha_salario)}${cgN(c.folha_salario) === cgN(p.salario) ? ' <span style="color:var(--farol-ok);">✓</span>' : ''}`;
  const fl = !c.flash_status ? '<span style="color:var(--tx-5);">–</span>'
    : c.flash_status === 'ACTIVE' ? '<span style="color:var(--farol-ok);">✓ ativo</span>' : `<span style="color:var(--farol-perto);">${cgEsc(String(c.flash_status).toLowerCase())}</span>`;
  const cf = cgLista(c.conferencia);
  return `<td style="text-align:right;white-space:nowrap;">${fs}</td><td style="white-space:nowrap;">${fl}</td>
    <td style="font-size:11.5px;color:var(--farol-perto);white-space:normal;min-width:140px;">${cf.map(cgEsc).join('<br>')}</td>`;
}
// ---------- ADMISSÃO (dono, 02/11/2026; proposta 2026-11-02-rh-admissao.md): o Novo registro cadastra na Flash e vai à contabilidade. O robô envia. ----------
let CG_ADM = null;   // { id da pessoa, docs já gravados, novos a subir }
const CG_ADM_MAX = 15 * 1048576, CG_ADM_MAX_EMAIL = 22 * 1048576;
const CG_ADM_DOCS = ['CTPS', 'RG', 'CPF', 'Título de eleitor', 'CNH', 'Comprovante de endereço (até 90 dias)', 'PIS', 'Certidão de nascimento ou casamento', 'Certidão e CPF dos dependentes', 'Exame admissional', 'Termo de opção sindical', 'Dados bancários', 'Foto 3x4'];
const CG_ADM_BLOCOS = [
  ['Pessoais', [['cpf', 'CPF *'], ['nascimento', 'Nascimento *', 'date'], ['nome_mae', 'Nome da mãe *'], ['nome_pai', 'Nome do pai'], ['municipio_nascimento', 'Município de nascimento'],
    ['sexo', 'Sexo', ['', 'MASCULINO', 'FEMININO']], ['estado_civil', 'Estado civil', ['', 'SOLTEIRO', 'CASADO', 'DIVORCIADO', 'VIÚVO', 'UNIÃO ESTÁVEL']], ['raca_cor', 'Raça/cor', ['', 'BRANCO', 'PARDO', 'AMARELO', 'NEGRO', 'NÃO INFORMADO']],
    ['grau_instrucao', 'Grau de instrução', ['', 'ENSINO FUNDAMENTAL INCOMPLETO', 'ENSINO FUNDAMENTAL COMPLETO', 'ENSINO MÉDIO INCOMPLETO', 'ENSINO MÉDIO COMPLETO', 'ENSINO SUPERIOR INCOMPLETO', 'ENSINO SUPERIOR COMPLETO']]]],
  ['Endereço e contato', [['telefone', 'Telefone *'], ['email', 'E-mail'], ['cep', 'CEP'], ['rua', 'Rua'], ['numero', 'Número'], ['complemento', 'Complemento'], ['bairro', 'Bairro'], ['cidade', 'Cidade']]],
  ['Contrato', [['experiencia_dias', 'Experiência (dias)', 'number'], ['prorrogavel_dias', 'Prorrogável (dias)', 'number'], ['tipo_salario', 'Salário por', ['MENSAL', 'HORA']], ['entrada', 'Entrada', 'time'], ['intervalo', 'Intervalo'], ['saida', 'Saída', 'time'], ['folga', 'Folga']]],
  ['Documentos', [['pis', 'PIS'], ['ctps', 'CTPS'], ['ctps_serie', 'Série'], ['ctps_uf', 'UF'], ['ctps_data', 'Data da CTPS', 'date'], ['rg', 'RG'], ['rg_orgao', 'Órgão'], ['rg_data', 'Data do RG', 'date'], ['titulo', 'Título'], ['titulo_zona', 'Zona'], ['titulo_secao', 'Seção'], ['cnh', 'CNH'], ['cnh_categoria', 'Categoria']]],
  ['Benefícios', [['vt_itinerario', 'Itinerário do VT'], ['vt_valor_passagem', 'Valor da passagem', 'number'], ['va_valor_dia', 'VA por dia', 'number']]],
  ['Banco', [['banco', 'Banco'], ['agencia', 'Agência'], ['conta', 'Conta']]],
];
function cgAdmDaPessoa(id) { return (CARGOS.adm || []).find((a) => a.pessoa_id === id) || null; }
function cgFormAdmissao(a, id) {
  if (!CG_ADM || CG_ADM.id !== id) CG_ADM = { id, docs: (a.documentos || []).slice(), novos: [] };
  const campo = (rot, html) => `<label style="display:flex;flex-direction:column;gap:2px;font-size:11px;color:var(--tx-4);">${rot}${html}</label>`;
  const ctl = ([c, , t]) => {
    const atual = a[c] == null ? '' : String(a[c]);
    if (Array.isArray(t)) return `<select id="cgA_${c}" style="width:100%">${(t.includes(atual) || !atual ? t : [...t, atual]).map((o) => `<option value="${cgEsc(o)}" ${o === atual ? 'selected' : ''}>${cgEsc(o === '' ? '—' : o)}</option>`).join('')}</select>`;
    return `<input id="cgA_${c}" type="${t || 'text'}" value="${cgEsc(t === 'date' ? atual.slice(0, 10) : atual)}" style="width:100%">`;
  };
  const titulo = (t) => `<div style="font-size:13px;font-weight:800;color:var(--tx-1);margin:14px 0 6px;">${t}</div>`;
  setTimeout(() => { (a.dependentes || []).forEach(cgAdmDepAdd); cgAdmDocsPintar(); });
  return `<div id="cgAdmAlerta"></div>
    ${CG_ADM_BLOCOS.map(([t, cs]) => `${titulo(t)}<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(170px,1fr));gap:8px;">${cs.map((c) => campo(c[1], ctl(c))).join('')}</div>`).join('')}
    <label style="display:inline-flex;gap:4px;align-items:center;margin-top:8px;font-size:12px;"><input id="cgA_va_no_local" type="checkbox" ${a.va_no_local ? 'checked' : ''}>faz a refeição no local</label>
    ${titulo('Dependentes')}<div id="cgAdmDeps"></div><button type="button" class="preset-btn" onclick="cgAdmDepAdd()">+ Dependente</button>
    ${titulo('Documentos anexos')}
    <div style="display:flex;flex-wrap:wrap;gap:8px;align-items:center;"><select id="cgAdmDocTipo" style="max-width:100%;">${CG_ADM_DOCS.map((d) => `<option>${cgEsc(d)}</option>`).join('')}</select>
      <input type="file" accept=".pdf,.jpg,.jpeg,.png" style="max-width:100%;" onchange="cgAdmDocEscolher(this)"></div>
    <div id="cgAdmDocs" style="margin-top:6px;font-size:12.5px;"></div>
    ${campo('<span style="margin-top:12px;">Observação para a contabilidade</span>', `<input id="cgA_obs" value="${cgEsc(a.obs || '')}" style="width:100%">`)}`;
}
function cgAdmData(v) {
  const el = document.getElementById('cgAdmAlerta');
  if (!el) return;
  const hoje = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' });
  el.innerHTML = v && v <= hoje ? '<div class="contexto" style="text-align:left;border-color:var(--farol-perto);margin:8px 0;"><b style="color:var(--farol-perto);">A admissão deve ser enviada antes do início do trabalho, por causa do e-Social.</b></div>' : '';
}
function cgAdmDepAdd(d) {
  const v = d || {}, box = document.getElementById('cgAdmDeps');
  if (!box) return;
  const e = document.createElement('div');
  e.className = 'cg-adm-dep';
  e.style.cssText = 'display:grid;grid-template-columns:repeat(auto-fit,minmax(130px,1fr));gap:6px;margin-bottom:6px;';
  e.innerHTML = `<input data-c="nome" placeholder="Nome" value="${cgEsc(v.nome || '')}"><input data-c="nascimento" type="date" title="Nascimento" value="${cgEsc(v.nascimento || '')}">
    <input data-c="cpf" placeholder="CPF" value="${cgEsc(v.cpf || '')}"><input data-c="parentesco" placeholder="Parentesco" value="${cgEsc(v.parentesco || '')}">
    <button type="button" class="preset-btn" onclick="this.parentNode.remove()">Tirar</button>`;
  box.appendChild(e);
}
function cgAdmDocEscolher(inp) {
  const f = inp.files && inp.files[0];
  if (!f) return;
  inp.value = '';
  if (!/^(application\/pdf|image\/jpeg|image\/png)$/.test(f.type)) return avisoAcao('atencao', '! O documento precisa ser PDF, JPG ou PNG.');
  if (f.size > CG_ADM_MAX) return avisoAcao('atencao', '! Documento maior que 15 MB. Use um menor.');
  CG_ADM.novos.push({ tipo: document.getElementById('cgAdmDocTipo').value, arquivo: f });
  cgAdmDocsPintar();
}
function cgAdmDocTirar(i, novo) { (novo ? CG_ADM.novos : CG_ADM.docs).splice(i, 1); cgAdmDocsPintar(); }
function cgAdmDocsPintar() {
  const el = document.getElementById('cgAdmDocs');
  if (!el || !CG_ADM) return;
  const linha = (t, n, i, novo) => `<div style="display:flex;flex-wrap:wrap;gap:8px;align-items:center;margin-bottom:4px;">✓ <b>${cgEsc(t)}</b> <span style="color:var(--tx-3);overflow-wrap:anywhere;">${cgEsc(n)}</span> <a href="javascript:void(0)" style="color:var(--tx-3);" onclick="cgAdmDocTirar(${i},${novo})">tirar</a></div>`;
  const soma = CG_ADM.novos.reduce((s, n) => s + n.arquivo.size, 0);
  el.innerHTML = CG_ADM.docs.map((d, i) => linha(d.tipo, d.nome, i, false)).join('') + CG_ADM.novos.map((n, i) => linha(n.tipo, n.arquivo.name, i, true)).join('')
    + (soma > CG_ADM_MAX_EMAIL ? '<div style="color:var(--farol-perto);font-weight:700;">Mais de 22 MB: pode não caber num e-mail só.</div>' : '');
}
// sobe uma vez só: Tentar de novo reaproveita o que já subiu. O nome do anexo no e-mail é o tipo com a extensão.
async function cgAdmSubirDocs() {
  await rmbGarantirTokenValido();
  const pedir = (url, opt) => fetch(url, { ...opt, headers: { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${rmbSessao().access_token}`, ...opt.headers } });
  for (const n of CG_ADM.novos) {
    if (n.link) continue;
    const ext = { 'application/pdf': 'pdf', 'image/jpeg': 'jpg', 'image/png': 'png' }[n.arquivo.type];
    if (!n.caminho) n.caminho = `${crypto.randomUUID()}.${ext}`;
    const up = await pedir(`${SUPABASE_URL}/storage/v1/object/rh-admissao/${n.caminho}`, { method: 'POST', headers: { 'Content-Type': n.arquivo.type }, body: n.arquivo });
    if (!up.ok && !/duplicate|already exists/i.test(await up.text().catch(() => ''))) throw new Error(`o documento ${n.tipo} não subiu (${up.status})`);
    const sg = await pedir(`${SUPABASE_URL}/storage/v1/object/sign/rh-admissao/${n.caminho}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ expiresIn: 2592000 }) });
    const d = sg.ok ? await sg.json() : {};
    if (!d.signedURL) throw new Error(`o documento ${n.tipo} não subiu (${sg.status})`);
    n.link = `${SUPABASE_URL}/storage/v1${d.signedURL}`;
    n.nome = `${n.tipo.split(' (')[0]}.${ext}`;
  }
  return [...CG_ADM.docs, ...CG_ADM.novos.map((n) => ({ tipo: n.tipo, nome: n.nome, caminho: n.caminho, link: n.link }))];
}
function cgAdmColher() {
  const a = {};
  for (const [, cs] of CG_ADM_BLOCOS) for (const [c] of cs) a[c] = document.getElementById('cgA_' + c).value.trim();
  a.va_no_local = document.getElementById('cgA_va_no_local').checked;
  a.obs = document.getElementById('cgA_obs').value.trim();
  a.dependentes = [...document.querySelectorAll('.cg-adm-dep')].map((e) => Object.fromEntries([...e.querySelectorAll('input')].map((i) => [i.dataset.c, i.value.trim()]))).filter((d) => d.nome);
  return a;
}
function cgAdmEtapa(rot, sit, em, motivo, a, etapa) {
  const tentar = `<button type="button" class="preset-btn" onclick="cgAdmTentar(${a.id},'${etapa}')">Tentar de novo</button>`;
  if (sit === 'OK') return `<span style="color:var(--farol-ok);font-weight:700;">✓ ${rot}${em ? ` em ${new Date(em).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }).replace(',', ' às')}` : ''}</span>${etapa === 'CONTABILIDADE' ? ` <button type="button" class="preset-btn" onclick="cgAdmTentar(${a.id},'${etapa}')">Reenviar</button>` : ''}`;
  if (sit === 'ERRO') return `<span style="color:var(--farol-fora);font-weight:700;">✗ ${rot}: ${cgEsc(motivo || 'não chegou')}</span> ${tentar}`;
  if (sit === 'NAO_SE_APLICA') return `<span style="color:var(--tx-4);">${rot}: não vai</span>`;
  return `<span style="color:var(--tx-3);">${rot}: enviando…</span>`;
}
function cgAdmEtapas(a) {
  return `<div style="display:flex;flex-wrap:wrap;gap:6px 16px;align-items:center;white-space:normal;">${cgAdmEtapa('Flash', a.flash_situacao, a.flash_em, a.flash_motivo, a, 'FLASH')}${cgAdmEtapa('Contabilidade', a.contab_situacao, a.contab_em, a.contab_motivo, a, 'CONTABILIDADE')}</div>
    ${a.flash_aviso ? `<div style="color:var(--farol-perto);font-weight:700;white-space:normal;margin-top:4px;">${cgEsc(a.flash_aviso)}</div>` : ''}`;
}
// fica à vista enquanto faltar alguma etapa; nada some sozinho antes do ✓
function cgAdmAndamento() {
  const L = (CARGOS.adm || []).filter((a) => a.flash_situacao === 'ENVIANDO' || a.contab_situacao === 'ENVIANDO' || a.flash_situacao === 'ERRO' || a.contab_situacao === 'ERRO' || a.flash_aviso);
  if (!L.length) return '';
  const nome = (a) => (CARGOS.pessoas.find((p) => p.id === a.pessoa_id) || {}).nome || '';
  return `<div class="section-label" style="text-align:left;">Admissões em andamento</div>${L.map((a) => `<div class="contexto" style="text-align:left;margin:6px 0;"><b>${cgEsc(cgNome(nome(a)))}</b><div style="margin-top:4px;font-size:13px;">${cgAdmEtapas(a)}</div></div>`).join('')}`;
}
async function cgAdmTentar(id, etapa) {
  avisoAcao('enviando', 'Pedindo o envio…');
  const r = await trRpcSeguro('rh_admissao_tentar_de_novo', { p_id: id, p_etapa: etapa });
  if (!r.ok) return avisoAcao('erro', `✗ Não gravou: ${await trErroDe(r)}.`, () => cgAdmTentar(id, etapa));
  await cgRecarregar(`Pedido de envio registrado: ${etapa === 'FLASH' ? 'Flash' : 'contabilidade'}.`);
}
function cgFormPessoa(p) {
  const v = p || { unidade: CARGOS_F.unidade || 'AGUA VERDE', contrato: 'CLT', horas: 220, recebe_va: true, pega_adiantamento: true, recebe_bonificacao: true, usa_ponto: true, no_plano: true, vt_por_dia: 2, vt_dias: 24, apelidos: [] };
  const id = p ? p.id : 0;
  const adm = p ? cgAdmDaPessoa(p.id) : {};   // registro novo e quem veio por admissão levam a ficha; o resto do cadastro segue sem ela
  const cargos = [...new Set(CARGOS.tabela.map(t => t.cargo))].sort();
  const sel = (nome, opcoes, atual) => `<select id="cgF_${nome}_${id}" style="width:100%">${(atual == null || opcoes.map(String).includes(String(atual)) ? opcoes : [...opcoes, atual]).map(o =>
    `<option value="${cgEsc(o)}" ${String(o) === String(atual == null ? '' : atual) ? 'selected' : ''}>${cgEsc(o === '' ? '—' : o)}</option>`).join('')}</select>`;
  const inp = (nome, atual, tipo = 'text') => `<input id="cgF_${nome}_${id}" type="${tipo}" value="${cgEsc(atual == null ? '' : atual)}" style="width:100%">`;
  const chk = (nome, atual, rot) => `<label style="display:inline-flex;gap:4px;align-items:center;margin-right:12px;"><input id="cgF_${nome}_${id}" type="checkbox" ${atual ? 'checked' : ''}>${rot}</label>`;
  const campo = (rot, html) => `<label style="display:flex;flex-direction:column;gap:2px;font-size:11px;color:var(--tx-4);">${rot}${html}</label>`;
  return `<div style="background:var(--surface-2);border:1px solid var(--line);border-radius:6px;padding:12px;margin:8px 0;">
    <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(170px,1fr));gap:8px;">
      ${campo('Nome completo', inp('nome', v.nome))}
      ${campo('Loja', sel('unidade', ['AGUA VERDE', 'AHU', 'SÃO BRAZ'], v.unidade))}
      ${campo('Empresa da folha', sel('empresa', ['', 'FF AGUA VERDE', 'CIDADAO AV', 'CIDADAO AHU', 'FF SAO BRAZ'], v.empresa))}
      ${campo('Contrato', sel('contrato', ['CLT', 'INTERMITENTE', 'SEM REGISTRO'], v.contrato))}
      ${campo('Cargo do plano', `<input id="cgF_cargo_${id}" list="cgCargos" value="${cgEsc(v.cargo || '')}" style="width:100%" onchange="cgSugerirSalario(${id})"><datalist id="cgCargos">${cargos.map(c => `<option value="${cgEsc(c)}">`).join('')}</datalist>`)}
      ${campo('Setor no nome do cargo', sel('departamento', ['', ...CG_DEPTOS], v.departamento))}
      ${campo('Nome do cargo com setor', inp('cargo_completo', v.cargo_completo))}
      ${campo('Jornada (horas/mês)', `<select id="cgF_horas_${id}" style="width:100%" onchange="cgSugerirSalario(${id})">${[...new Set(['180', '220', String(v.horas ?? '220')])].map((o) => `<option value="${o}" ${o === String(v.horas ?? '220') ? 'selected' : ''}>${o}</option>`).join('')}</select>`)}
      ${campo('Salário base', inp('salario', v.salario, 'number'))}
      ${campo('Setor do rateio dos canais', sel('setor_rateio', ['', ...CG_SETORES], v.setor_rateio))}
      ${campo('Turno', sel('turno', ['', 'DIA', 'NOITE', 'DIA/ NOITE'], v.turno))}
      ${campo('VT por dia', inp('vt_por_dia', v.vt_por_dia, 'number'))}
      ${campo('Dias de trabalho no mês', inp('vt_dias', v.vt_dias, 'number'))}
      ${campo(p ? 'Admissão' : 'Admissão *', inp('admissao', v.admissao ? String(v.admissao).slice(0, 10) : '', 'date').replace('<input ', '<input onchange="cgAdmData(this.value)" '))}
      ${p ? campo('Desligamento', inp('desligamento', v.desligamento ? String(v.desligamento).slice(0, 10) : '', 'date')) : ''}
      ${p ? campo('Matrícula', inp('matricula', v.matricula)) : ''}
      ${campo('Como aparece no contas a pagar', inp('apelidos', [v.apelido, ...(v.apelidos || [])].filter(Boolean).join(', ')))}
      ${campo('Observação para o RH', inp('obs_rh', v.obs_rh))}
    </div>
    <div style="margin-top:8px;font-size:12px;">${chk('recebe_va', v.recebe_va, 'recebe VA')}${chk('pega_adiantamento', v.pega_adiantamento, 'pega adiantamento')}${chk('recebe_bonificacao', v.recebe_bonificacao, 'recebe bonificação')}${chk('usa_ponto', v.usa_ponto, 'bate ponto na Flash')}${chk('no_plano', v.no_plano, 'está no plano de cargos')}</div>
    <div id="cgSug_${id}" style="font-size:12px;color:var(--tx-4);margin-top:6px;"></div>
    ${adm ? cgFormAdmissao(adm, id) : ''}
    <div style="margin-top:12px;display:flex;gap:8px;"><button type="button" class="preset-btn active" onclick="cgSalvar(${id})">${p ? 'Salvar' : 'Salvar e enviar à Flash e à contabilidade'}</button><button type="button" class="preset-btn" onclick="cgFormFechar()">Cancelar</button></div>
  </div>`;
}
function cgSugerirSalario(id) {
  const g = (n) => document.getElementById(`cgF_${n}_${id}`);
  const cargo = (g('cargo').value || '').toUpperCase().trim();
  const und = g('unidade').value === 'SÃO BRAZ' ? 'SÃO BRAZ' : 'AGUA VERDE';
  const t = CARGOS.tabela.find(x => x.unidade === und && x.cargo === cargo && String(x.horas) === g('horas').value);
  const el = document.getElementById('cgSug_' + id);
  if (t && !g('salario').value) g('salario').value = t.salario;
  if (t) { el.innerHTML = `Tabela de cargos: ${cgR(t.salario)} <a href="javascript:void(0)" onclick="document.getElementById('cgF_salario_${id}').value='${t.salario}'">usar</a>`; }
  else el.textContent = '';
}
async function cgSalvar(id) {
  const g = (n) => document.getElementById(`cgF_${n}_${id}`);
  const nomes = g('apelidos').value.split(',').map(s => s.trim().toUpperCase()).filter(Boolean);
  const cargo = g('cargo').value.toUpperCase().trim();
  const m = cargo.match(/^([A-ZÇÃÕÁÉÍÓÚÂÊ]+).*?NIVEL\s*(\d)/);
  const corpo = {
    nome: g('nome').value, unidade: g('unidade').value, empresa: g('empresa').value, contrato: g('contrato').value,
    cargo, cargo_completo: g('cargo_completo').value, departamento: g('departamento').value,
    ...(m ? { familia: m[1].replace(/^COZINHEIR.*/, 'COZINHEIRO'), nivel: m[2] } : {}),
    horas: g('horas').value, salario: g('salario').value, setor_rateio: g('setor_rateio').value, turno: g('turno').value,
    vt_por_dia: g('vt_por_dia').value, vt_dias: g('vt_dias').value, admissao: g('admissao').value,
    desligamento: g('desligamento') ? g('desligamento').value : '', matricula: g('matricula') ? g('matricula').value : '', obs_rh: g('obs_rh').value,
    apelido: nomes[0] || '', apelidos: nomes.slice(1),
    recebe_va: g('recebe_va').checked, pega_adiantamento: g('pega_adiantamento').checked, recebe_bonificacao: g('recebe_bonificacao').checked,
    usa_ponto: g('usa_ponto').checked, no_plano: g('no_plano').checked,
  };
  if (!corpo.nome || !cargo || !corpo.salario) { cgAviso('Preencha nome, cargo e salário.', false); return; }
  avisoAcao('enviando', 'Gravando…');
  const adm = id ? cgAdmDaPessoa(id) : {};
  if (adm) {
    try {
      const documentos = await cgAdmSubirDocs();
      const ra = await trRpcSeguro('rh_admissao_salvar', { p_id: adm.id || null, p: { cadastro: corpo, admissao: { ...cgAdmColher(), documentos } } });
      if (!ra.ok) throw new Error(await trErroDe(ra));
      adm.id = adm.id || await ra.json();
    } catch (e) { avisoAcao('erro', `✗ Não gravou: ${e.message}`, () => cgSalvar(id)); return; }
    CARGOS_F.formando = null; CG_ADM = null;
    await cgRecarregar('Registro salvo. O robô envia à Flash e à contabilidade; a situação de cada um fica em Admissões em andamento.');
    // sem apelido o contas a pagar não acha a pessoa: o banco põe o primeiro nome quando está livre na empresa
    const pid = ((CARGOS.adm || []).find((a) => a.id === adm.id) || {}).pessoa_id;
    const nova = CARGOS.pessoas.find((x) => x.id === pid);
    if (nova && !nova.apelido) avisoAcao('atencao', `! Registro salvo, mas falta o apelido de ${cgNome(nova.nome)}: abra o cadastro e preencha "Como aparece no contas a pagar".`);
    return;
  }
  const r = await trRpcSeguro('rh_pessoa_salvar', { p_id: id || null, p: corpo });
  if (!r.ok) { cgAviso('Não deu: ' + await trErroDe(r), false); return; }
  CARGOS_F.formando = null;
  await cgRecarregar('Salvo. O setor já vale para o rateio dos canais; o custo realizado se atualiza com a próxima carga do contas a pagar.');
}

// ---------- TABELA DE CARGOS ----------
function cgAbaTabela() {
  const ordem = ['AUXILIAR', 'ASSISTENTE', 'COZINHEIRO', 'ESTOQUISTA', 'LIDER', 'SUPERVISOR', 'GERENTE'];
  const unid = [...new Set(CARGOS.tabela.map(t => t.unidade))];
  const ocup = {};
  for (const p of CARGOS.pessoas.filter(p => p.ativo && p.no_plano)) {
    const u = p.unidade === 'SÃO BRAZ' ? 'SÃO BRAZ' : 'AGUA VERDE';
    const k = `${u}|${p.familia}|${p.nivel}|${p.horas}`; ocup[k] = (ocup[k] || 0) + 1;
  }
  let h = `<div class="caption-label" style="text-align:left;margin:0 0 8px;" title="Salário base bruto depois do dissídio de 6,11%. O setor (Atendimento, Cozinha, Produção, Operacional, Limpeza) entra só no nome do cargo — o salário é o do cargo.">Tabela de cargos · vigência ${cgMesRot(CARGOS.tabela[0] && CARGOS.tabela[0].vigencia)} · Ahú usa a da Água Verde</div>
    <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(330px,1fr));gap:14px;">`;
  for (const u of unid) {
    const linhas = {};
    for (const t of CARGOS.tabela.filter(t => t.unidade === u)) (linhas[t.cargo] = linhas[t.cargo] || { fam: t.familia, nivel: t.nivel, cargo: t.cargo })[t.horas] = t.salario;
    const ord = Object.values(linhas).sort((a, b) => (ordem.indexOf(a.fam) - ordem.indexOf(b.fam)) || (cgN(a.nivel) - cgN(b.nivel)));
    const cel = (l, hs) => { const n = ocup[`${u}|${l.fam}|${l.nivel}|${hs}`]; return l[hs] != null ? `${cgR(l[hs])}${n ? ` <span style="color:var(--tx-4);font-size:11px;">· ${n} ${n === 1 ? 'pessoa' : 'pessoas'}</span>` : ''}` : '–'; };
    h += `<div><div style="font-size:12px;color:var(--tx-4);margin-bottom:4px;">${cgEsc(u)}</div>
      <div id="tabelaCgTabela${u.replace(/\W/g, '')}"><table><thead><tr><th>Cargo</th><th style="text-align:right;">180 h</th><th style="text-align:right;">220 h</th></tr></thead>
      <tbody>${ord.map(l => `<tr><td>${cgEsc(cgNome(l.cargo))}</td><td style="text-align:right;">${cel(l, 180)}</td><td style="text-align:right;">${cel(l, 220)}</td></tr>`).join('')}</tbody></table></div></div>`;
  }
  return h + '</div>';
}

// ---------- CUSTO REALIZADO POR PESSOA ----------
function cgMesesCusto() { return [...new Set(CARGOS.conf.map(c => String(c.mes).slice(0, 10)))].sort().reverse(); }
function cgSelMesCusto(meses, mes) {
  return cgSelPeriodo('Mês', [...meses].sort().map((m) => [m, cgMesRot(m) + (CARGOS.conf.some((c) => String(c.mes).slice(0, 10) === m && c.tem_previsto) ? ' (previsto)' : '')]), mes,
    "(v) => { CARGOS_F.mes = v; renderModuloCargos(); }");
}
// custo de cada pessoa por mês (vw_rh_custo_pessoa_mes.pessoa_id)
function cgCustoDaPessoa(id) { return (CARGOS.custo || []).filter((c) => c.pessoa_id === id).sort((a, b) => String(a.mes).localeCompare(String(b.mes))); }
function cgMesCustoFechado() { const m = cgMesesCusto(); return m[1] || m[0]; }
function cgAbaCusto() {
  const F = CARGOS_F;
  const meses = cgMesesCusto();
  const mes = meses.includes(F.mes) ? F.mes : (meses[1] || meses[0]);   // padrão: o último mês fechado
  const linhas = CARGOS.custo.filter(c => String(c.mes).slice(0, 10) === mes && (!F.unidade || c.unidade === F.unidade) && (!F.semSetor || !c.setor_rateio || c.setor_rateio === 'SEM SETOR'))
                             .sort((a, b) => cgN(b.total) - cgN(a.total));
  const conf = CARGOS.conf.filter(c => String(c.mes).slice(0, 10) === mes && (!F.unidade || c.unidade === F.unidade));
  const soma = (k) => linhas.reduce((s, c) => s + cgN(c[k]), 0);
  const total = soma('total'), prev = conf.some(c => c.tem_previsto);
  const ex = linhas.filter(c => c.fora_do_cadastro);
  let h = cgSelMesCusto(meses, mes) + cgFiltroUnidade(CARGOS.conf) + `
    ${F.semSetor ? `<div style="margin:0 0 8px;"><button type="button" class="preset-btn active" onclick="CARGOS_F.semSetor=false;renderModuloCargos()">só quem está sem setor ✕</button></div>` : ''}
    <div class="cards">
      <div class="card blue"><div class="card-lbl">Custo da folha no mês</div><div class="card-val">${cgR0(total)}</div><div class="card-pct">${prev ? 'ainda com provisões do Saipos' : 'tudo pago'}</div></div>
      <div class="card neutral"><div class="card-lbl">Pessoas com lançamento</div><div class="card-val">${linhas.length}</div><div class="card-pct">${ex.length ? `${ex.length} fora do cadastro (ex-funcionários)` : 'todas no cadastro'}</div></div>
      <div class="card neutral"><div class="card-lbl">Guias e gastos rateados</div><div class="card-val">${cgR0(soma('encargos_rateados') + soma('outros_rateados'))}</div><div class="card-pct">INSS, FGTS, medicina, uniforme…</div></div>
      ${(() => { const fo = conf.reduce((s, c) => s + cgN(c.emprestimos_fora), 0);   // 06/11/2026 (dono): vale é salário adiantado; fora só o golpe
        return fo > 0.005 ? `<div class="card neutral"><div class="card-lbl">Fora da folha (golpe)</div><div class="card-val">${cgR0(fo)}</div><div class="card-pct">não entra no custo</div></div>` : ''; })()}
    </div>
    <div id="tabelaCgCusto" style="overflow-x:auto;"><table>
      <thead><tr><th>Loja</th><th>Nome</th><th>Setor</th><th style="text-align:right;">Salário e adiant.</th><th style="text-align:right;">VT</th><th style="text-align:right;">VA</th><th style="text-align:right;">Rescisão, férias, 13º</th><th style="text-align:right;">Bonificação</th><th style="text-align:right;" title="INSS, FGTS, medicina… repartidos pela parte do salário de cada um no mês">Encargos (rateio)</th><th style="text-align:right;" title="gasto coletivo (uniforme etc.) repartido pela parte do salário; do contas a pagar, os 18 subtipos de folha da DRE, menos empréstimos e vales">Outros (rateio)</th><th style="text-align:right;">Total</th></tr></thead>
      <tbody>${linhas.map(c => `<tr>
        <td>${cgEsc(c.unidade)}</td><td>${c.pessoa_id ? `<a href="javascript:void(0)" onclick="cgAbrirPessoa(${c.pessoa_id})" title="abrir o cadastro">${cgEsc(cgNome(c.nome))}</a>` : cgEsc(cgNome(c.nome))}${c.fora_do_cadastro ? ' <span style="font-size:10px;color:var(--tx-4);">ex-funcionário</span>' : ''}</td>
        <td>${cgEsc(c.setor_rateio || '–')}</td>
        <td style="text-align:right;">${cgR(c.salario)}</td><td style="text-align:right;">${cgR(c.vt)}</td><td style="text-align:right;">${cgR(c.va)}</td>
        <td style="text-align:right;">${cgR(c.rescisao_ferias_13)}</td><td style="text-align:right;">${cgR(c.bonificacao)}</td>
        <td style="text-align:right;color:var(--tx-4);">${cgR(c.encargos_rateados)}</td><td style="text-align:right;color:var(--tx-4);">${cgR(cgN(c.outros_rateados) + cgN(c.outros_diretos))}</td>
        <td style="text-align:right;font-weight:600;">${cgR(c.total)}</td></tr>`).join('')}</tbody>
      <tfoot><tr class="sub"><td colspan="3">Total</td><td style="text-align:right;">${cgR(soma('salario'))}</td><td style="text-align:right;">${cgR(soma('vt'))}</td><td style="text-align:right;">${cgR(soma('va'))}</td><td style="text-align:right;">${cgR(soma('rescisao_ferias_13'))}</td><td style="text-align:right;">${cgR(soma('bonificacao'))}</td><td style="text-align:right;">${cgR(soma('encargos_rateados'))}</td><td style="text-align:right;">${cgR(soma('outros_rateados') + soma('outros_diretos'))}</td><td style="text-align:right;">${cgR(total)}</td></tr></tfoot>
    </table></div>`;
  return h;
}

// ---------- POR SETOR (o rateio dos canais) ----------
function cgAbaSetor() {
  const F = CARGOS_F;
  const meses = cgMesesCusto();
  const mes = meses.includes(F.mes) ? F.mes : (meses[1] || meses[0]);
  const linhas = CARGOS.setor.filter(s => String(s.mes).slice(0, 10) === mes && (!F.unidade || s.unidade === F.unidade));
  const tot = linhas.reduce((s, x) => s + cgN(x.total), 0);
  const sem = linhas.filter(s => s.setor === 'SEM SETOR').reduce((s, x) => s + cgN(x.total), 0);
  const soma = (k) => cgR(linhas.reduce((s, x) => s + cgN(x[k]), 0));
  return cgSelMesCusto(meses, mes) + cgFiltroUnidade(CARGOS.conf) + `
    ${sem > 0.5 ? `<div class="contexto" style="border-color:var(--farol-perto);cursor:pointer;" onclick="CARGOS_F.semSetor=true;CARGOS_F.aba='custo';renderModuloCargos()">${cgR0(sem)} sem setor neste mês — <u>ver quem</u></div>` : ''}
    <div id="tabelaCgSetor" style="overflow-x:auto;"><table>
      <thead><tr><th>Loja</th><th title="é o setor de cada pessoa no cadastro que reparte a folha entre os canais em Resultado por canal">Setor</th><th style="text-align:right;">Pessoas</th><th style="text-align:right;">Salário</th><th style="text-align:right;">VT e VA</th><th style="text-align:right;">Outros diretos</th><th style="text-align:right;">Rateados</th><th style="text-align:right;">Total</th><th style="text-align:right;">% da loja</th></tr></thead>
      <tbody>${linhas.map(s => `<tr${s.setor === 'SEM SETOR' ? ` style="cursor:pointer;color:var(--farol-perto);${F.realceSemSetor ? 'outline:2px solid var(--farol-perto);' : ''}" onclick="CARGOS_F.semSetor=true;CARGOS_F.aba='custo';renderModuloCargos()" title="ver quem está sem setor"` : ''}><td>${cgEsc(s.unidade)}</td><td>${cgEsc(s.setor)}</td><td style="text-align:right;">${cgN(s.pessoas)}</td>
        <td style="text-align:right;">${cgR(s.salario)}</td><td style="text-align:right;">${cgR(s.beneficios)}</td><td style="text-align:right;">${cgR(s.outros_diretos)}</td>
        <td style="text-align:right;color:var(--tx-4);">${cgR(s.rateados)}</td><td style="text-align:right;font-weight:600;">${cgR(s.total)}</td>
        <td style="text-align:right;">${(100 * cgN(s.share)).toFixed(0)}%</td></tr>`).join('')}</tbody>
      <tfoot><tr class="sub"><td colspan="3">Total</td><td style="text-align:right;">${soma('salario')}</td><td style="text-align:right;">${soma('beneficios')}</td><td style="text-align:right;">${soma('outros_diretos')}</td><td style="text-align:right;">${soma('rateados')}</td><td style="text-align:right;">${cgR(tot)}</td><td></td></tr></tfoot>
    </table></div>`;
}

// ---------- VT E VA DO MÊS ----------
// 29/10/2026 (dono): o esqueleto dos cálculos — situação em etiquetas e UM botão do próximo passo
function cgPassos(lista) {
  return `<div style="display:flex;gap:6px;align-items:center;flex-wrap:wrap;margin:6px 0 12px;">${lista.map(([rot, feito, quando], i) =>
    `${i ? '<span style="color:var(--tx-5);">→</span>' : ''}<span style="font-size:12px;font-weight:700;border-radius:999px;padding:3px 10px;border:1px solid ${feito ? 'var(--farol-ok)' : 'var(--line)'};color:${feito ? 'var(--farol-ok)' : 'var(--tx-4)'};">${feito ? '✓ ' : ''}${rot}${feito && quando ? ' ' + quando : ''}</span>`).join('')}</div>`;
}
function cgBotaoPasso(rot, onclick, secundario) {
  return `<button type="button" class="preset-btn${secundario ? '' : ' active'}" style="${secundario ? '' : 'font-size:14px;padding:10px 18px;'}" onclick="${onclick}">${rot}</button>`;
}
function cgHojeIso() { return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(new Date()); }
function cgDiaMes(s) { return s ? String(s).slice(8, 10) + '/' + String(s).slice(5, 7) : ''; }
function cgAbaVtVa() {
  const F = CARGOS_F;
  const meses = [...new Set(CARGOS.vtva.map((v) => String(v.mes).slice(0, 10)))].sort().reverse();
  const prox = cgMesIso(1);
  if (!meses.includes(prox)) meses.unshift(prox);
  const mes = meses.includes(F.mes) ? F.mes : prox;   // abre no próximo vencimento (o VT do mês que vem)
  const linhas = CARGOS.vtva.filter((v) => String(v.mes).slice(0, 10) === mes && (!F.unidade || v.unidade === F.unidade));
  const fechado = linhas.length && linhas.every((v) => v.fechado_em);
  const totVt = linhas.reduce((s, v) => s + cgN(v.vt_valor), 0), totVa = linhas.reduce((s, v) => s + cgN(v.va_valor), 0);
  // 30/10/2026 (Hellen, regra do dono): quem é pago por fora da Flash fica no cálculo, com o total separado. Nunca escrever "Pix": não está confirmado como recebem.
  const soma = (L) => L.reduce((s, v) => s + cgN(v.vt_valor) + cgN(v.va_valor), 0);
  const pelaFlash = linhas.filter((v) => !v.pago_fora_flash), fora = linhas.filter((v) => v.pago_fora_flash);
  const totFlash = soma(pelaFlash), totFora = soma(fora), nFlash = pelaFlash.filter((v) => cgN(v.vt_valor) + cgN(v.va_valor) > 0).length;
  const dt = (k) => linhas.map((v) => v[k]).filter(Boolean).sort().pop();
  const ca = dt('calculado_em'), fe = dt('fechado_em'), en = dt('enviado_em');
  let h = `${cgSelPeriodo('Mês', [...meses].sort().map((m) => [m, cgMesRot(m)]), mes, "(v) => { CARGOS_F.mes = v; renderModuloCargos(); }")}
    <h3 style="margin:8px 0 0;">VT e VA de ${cgMesRot(mes)} · fecha no último dia útil de ${cgMesRot(cgMesIso(0)).split(' ')[0]}</h3>
    ${cgPassos([['calculado', !!ca, cgDiaMes(ca)], ['fechado', !!fe, cgDiaMes(fe)], ['enviado', !!en, cgDiaMes(en)]])}
    <div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap;margin-bottom:12px;">
      ${fechado ? cgBotaoPasso('reabrir', `cgVtFechar('${mes}', true)`, true)
        : `${cgBotaoPasso(linhas.length ? 'Recalcular' : 'Calcular', `cgVtCalcular('${mes}')`, linhas.length > 0)}${linhas.length ? cgBotaoPasso('Fechar o mês', `cgVtFechar('${mes}', false)`) : ''}`}
    </div>
    <div class="cards" style="max-width:900px;">
      <div class="card neutral"><div class="card-lbl">VT + VA</div><div class="card-val">${cgR(totVt + totVa)}</div><div class="card-pct">VT ${cgR(totVt)} · VA ${cgR(totVa)}</div></div>
      <div class="card neutral"><div class="card-lbl">Pela Flash</div><div class="card-val">${cgR(totFlash)}</div><div class="card-pct">${nFlash} ${nFlash === 1 ? 'pessoa' : 'pessoas'}</div></div>
      <div class="card neutral"><div class="card-lbl">Por fora da Flash</div><div class="card-val">${cgR(totFora)}</div><div class="card-pct">${fora.map((v) => cgEsc(cgNome(v.nome || v.apelido).replace(/\s*\(.*$/, ''))).join(', ') || 'ninguém'}</div></div>
      <div class="card neutral"><div class="card-lbl">Pessoas</div><div class="card-val">${linhas.length}</div></div>
    </div>`;
  if (!linhas.length) return h + cgFaltasFFHtml(mes, fechado, linhas);
  h += `<div id="tabelaCgVtVa"><table>
    <thead><tr><th>Loja</th><th>Nome</th><th style="text-align:right;">Dias</th><th style="text-align:right;">Faltas</th><th style="text-align:right;">VT por dia</th><th style="text-align:right;">VT</th><th style="text-align:right;">VA</th><th style="text-align:right;">Total</th></tr></thead>
    <tbody>${linhas.map((v) => `<tr>
      <td>${cgEsc(v.unidade)}</td><td>${cgEsc(cgNome(v.nome))}${v.pago_fora_flash ? ` <div style="font-size:11px;color:var(--tx-2);white-space:normal;">por fora da Flash</div>` : ''}${v.editado ? ` <div style="font-size:11px;color:var(--farol-perto);white-space:normal;">ajustado${v.motivo ? ': ' + cgEsc(v.motivo) : ''}</div>` : ''}</td>
      <td style="text-align:right;">${v.vt_dias}</td><td style="text-align:right;">${v.faltas}</td><td style="text-align:right;">${v.vt_por_dia}</td>
      <td style="text-align:right;">${cgR(v.vt_valor)}</td><td style="text-align:right;">${cgR(v.va_valor)}</td>
      <td style="text-align:right;font-weight:600;">${cgR(cgN(v.vt_valor) + cgN(v.va_valor))}</td></tr>`).join('')}</tbody>
    <tfoot><tr class="sub"><td colspan="5">Total</td><td style="text-align:right;">${cgR(totVt)}</td><td style="text-align:right;">${cgR(totVa)}</td><td style="text-align:right;">${cgR(totVt + totVa)}</td></tr></tfoot>
  </table></div>`;
  h += cgFaltasFFHtml(mes, fechado, linhas);
  return h;
}
// 29/10/2026 (chat RH): a falta que a contabilidade descontou na folha e a Flash não passou ao VT (vw_rh_faltas_flash_folha)
function cgFaltasFFHtml(mes, fechado, linhas) {
  const F = CARGOS_F;
  const L = (CARGOS.faltasFF || []).filter((x) => x.usa_ponto !== false && cgLista(x.conferencia).length && (!F.unidade || x.unidade === F.unidade));
  if (!(CARGOS.faltasFF || []).length) return '';
  return `<details ${L.length ? 'open' : ''} style="margin-top:14px;"><summary style="cursor:pointer;font-weight:700;">Faltas: Flash × folha ${L.length ? `<span style="color:var(--farol-perto);">(${L.length} para olhar)</span>` : '<span style="color:var(--farol-ok);">— batem</span>'}</summary>
    ${L.length ? `<div id="tabelaCgFaltasFF" style="overflow-x:auto;"><table><thead><tr><th>Mês</th><th>Nome</th><th style="text-align:right;">Flash</th><th style="text-align:right;">Folha</th><th>O que não bate</th></tr></thead><tbody>
      ${L.map((x) => `<tr><td>${cgMesRot(x.mes)}</td><td>${cgEsc(cgNome(x.nome || x.apelido))}</td>
          <td style="text-align:right;">${cgN(x.dias_flash)} ${cgN(x.dias_flash) === 1 ? 'dia' : 'dias'}</td>
          <td style="text-align:right;">${cgN(x.dias_folha)} ${cgN(x.dias_folha) === 1 ? 'dia' : 'dias'}${cgN(x.valor_descontado_folha) ? ` <span style="color:var(--tx-4);">(${cgR(x.valor_descontado_folha)})</span>` : ''}</td>
          <td style="font-size:12px;color:var(--farol-perto);white-space:normal;">${cgLista(x.conferencia).map(cgEsc).join('<br>')}</td></tr>`).join('')}
    </tbody></table></div>` : ''}</details>`;
}
async function cgVtCalcular(mes) {
  avisoAcao('enviando', `Calculando o VT e o VA de ${cgMesRot(mes)}…`);
  const r = await trRpcSeguro('rh_vt_va_calcular', { p_mes: mes });
  if (!r.ok) { cgAviso('Não deu: ' + await trErroDe(r), false); return; }
  CARGOS_F.mes = mes; await cgRecarregar(`VT e VA de ${cgMesRot(mes)} calculados`);
}
async function cgVtFechar(mes, reabrir) {
  if (reabrir && !confirm(`Reabrir o VT e o VA de ${cgMesRot(mes)}? O valor fechado deixa de valer até fechar de novo.`)) return;
  avisoAcao('enviando', reabrir ? 'Reabrindo…' : `Fechando o VT e o VA de ${cgMesRot(mes)}…`);
  const r = await trRpcSeguro('rh_vt_va_fechar', { p_mes: mes, p_reabrir: !!reabrir });
  if (!r.ok) { cgAviso('Não deu: ' + await trErroDe(r), false); return; }
  CARGOS_F.mes = mes; await cgRecarregar(reabrir ? `VT e VA de ${cgMesRot(mes)} reabertos` : `VT e VA de ${cgMesRot(mes)} fechados — o robô acerta as provisões do Saipos por este valor`);
}

// ---------- CONFERÊNCIA DA FOLHA (29/10/2026, chat RH) ----------
// A folha fechada da contabilidade (Extrato Mensal, lido por script/rh_folha_mensal.py com prova ao centavo) contra as guias
// e o cadastro: vw_rh_folha_conferencia_empresa e _pessoa. Só consulta. Lida na primeira vez que a aba abre.
const CG_PESOU = [['horas_extras', 'horas extras'], ['adicional_noturno', 'adicional noturno'], ['dez_por_cento', 'gratificações salão'],
                  ['confianca', 'gratificação de confiança'], ['faltas_valor', 'faltas descontadas'], ['adiantamento', 'adiantamento descontado']];
async function cgFolhaCarregar() {
  CARGOS.folha = null;
  try {
    const [emp, pes, arq] = await Promise.all([consultarTudo('vw_rh_folha_conferencia_empresa?select=*&order=competencia.desc,empresa'),
                                          consultarTudo('vw_rh_folha_conferencia_pessoa?select=*&order=competencia.desc,unidade,nome'),
                                          consultarTudo('rh_folha_mensal?select=competencia,arquivo&arquivo=ilike.PREVIA*').catch(() => [])]);
    // 05/11/2026 (RH): outubro entrou como PRÉVIA da contabilidade; a folha final regrava o mês. A prévia é marcada pelo arquivo.
    const previa = new Set(arq.map((x) => String(x.competencia).slice(0, 10)));
    // 05/11/2026 (RH): os dois quadros (por dentro até o líquido; por fora depois dele) e a validação da conferência
    const [quadro, pag, valid] = await Promise.all([
      consultarTudo('vw_rh_folha_quadro?select=*&order=competencia.desc,empresa,matricula').catch(() => null),
      consultarTudo('vw_rh_pagamento_mes?select=*&order=competencia.desc,empresa,nome,pessoa_id').catch(() => null),
      consultarTudo('rh_folha_validada?select=*&order=competencia').catch(() => [])]);
    // 05/11/2026 (dono, chat RH): correções para a contabilidade (lista + mensagem pronta) e horas base de cada um
    const [corr, corrTxt, hbase] = await Promise.all([
      consultarTudo('vw_rh_folha_correcao?select=*&order=competencia.desc,empresa_cod,nome,chave').catch(() => null),
      // 05/11/2026 (dono): UMA mensagem só, separada por empresa, curta e dizendo o que fazer
      consultarTudo('vw_rh_folha_correcao_mensagem?select=*&order=competencia.desc').catch(() => null),
      consultarTudo('vw_rh_folha_horas_base?select=competencia,empresa_cod,matricula,carga,horas_normais,horas_ferias_afastamento,mes_cheio&order=competencia.desc,empresa_cod,matricula').catch(() => null)]);
    CARGOS.folha = { emp, pes, rub: {}, previa, quadro, pag, valid, corr, corrTxt, hbase };
  } catch (e) { CARGOS.folha = { erro: e.message }; }
  if (CARGOS_F.aba === 'folha') renderModuloCargos();
}
function cgAbaFolha() {
  const F = CARGOS_F;
  if (CARGOS.folha === undefined) { cgFolhaCarregar(); return '<div class="contexto">Lendo a folha da contabilidade…</div>'; }
  if (CARGOS.folha === null) return '<div class="contexto">Lendo a folha da contabilidade…</div>';
  if (CARGOS.folha.erro) return `<div class="contexto">Não consegui ler a folha: ${cgEsc(CARGOS.folha.erro)}</div>`;
  const { emp, pes } = CARGOS.folha;
  const comps = [...new Set(emp.map((x) => String(x.competencia).slice(0, 10)))].sort().reverse();
  if (!comps.length) return '<div class="contexto">Nenhuma folha fechada da contabilidade no banco ainda.</div>';
  const comp = comps.includes(F.folhaComp) ? F.folhaComp : comps[0];
  const E = emp.filter((x) => String(x.competencia).slice(0, 10) === comp);
  const P = pes.filter((x) => String(x.competencia).slice(0, 10) === comp && (!F.unidade || x.unidade === F.unidade));
  const ok = (a, b) => Math.abs(cgN(a) - cgN(b)) < 0.01;
  let h = `<div style="display:flex;flex-wrap:wrap;gap:6px;margin:4px 0 10px;">${comps.slice(0, 6).reverse().map((c) =>
      `<button type="button" class="preset-btn ${c === comp ? 'active' : ''}" onclick="CARGOS_F.folhaComp='${c}';CARGOS_F.folhaCol=null;CARGOS_F.folhaAberta=null;renderModuloCargos()">${cgMesRot(c)}${(CARGOS.folha.previa || new Set()).has(c) ? ' (prévia)' : ''}</button>`).join('')}</div>
    ${cgFolhaImportarHtml()}
    ${(CARGOS.folha.previa || new Set()).has(comp)
      ? `<div class="contexto" style="text-align:left; border-color:var(--farol-perto);"><b>${cgMesRot(comp)} é a PRÉVIA da contabilidade.</b> Os números podem mudar quando a folha final chegar; o que está em "conferir" já vale para pedir à contabilidade.</div>`
      : `<div class="caption-label" style="text-align:left;">A folha fechada que a contabilidade devolveu, conferida contra as guias do mês e o cadastro. Só consulta.</div>`}
    <div class="cards">${E.map((x) => `<div class="card ${cgLista(x.conferencia).length ? 'highlight' : 'neutral'}" style="text-align:left;">
      <div class="card-lbl">${cgEsc(String(x.empresa).replace(/^\d+\s*-\s*/, ''))}</div>
      <div class="card-val" style="font-size:18px;">${cgR0(x.liquido)} <span style="font-size:12px;color:var(--tx-4);font-weight:600;">líquido · ${cgN(x.pessoas)} pessoas</span></div>
      <div class="card-pct" style="line-height:1.6;">proventos ${cgR0(x.proventos)}<br>
        FGTS folha ${cgR(x.fgts_folha)} × guia ${x.fgts_guia == null ? '—' : cgR(x.fgts_guia)} ${x.fgts_guia != null && ok(x.fgts_folha, x.fgts_guia) ? '<span style="color:var(--farol-ok);">✓</span>' : ''}<br>
        consignado ${cgR(x.consignado_folha)} × ${x.consignado_guia == null ? '—' : cgR(x.consignado_guia)} ${x.consignado_guia != null && ok(x.consignado_folha, x.consignado_guia) ? '<span style="color:var(--farol-ok);">✓</span>' : ''}<br>
        INSS da guia ${x.inss_guia == null ? '—' : cgR(x.inss_guia)}${x.guia_vencimento ? ` · vence ${cgData(x.guia_vencimento)}` : ''}</div>
      ${cgLista(x.conferencia).length ? `<div style="font-size:11.5px;color:var(--farol-perto);margin-top:4px;">${cgLista(x.conferencia).map(cgEsc).join('<br>')}</div>` : ''}</div>`).join('')}</div>
    ${cgFolhaValidacaoHtml(comp)}
    ${cgFolhaCorrecoesHtml(comp)}
    ${cgFiltroUnidade(CARGOS.pessoas)}`;
  // 05/11/2026 (dono, chat RH): "o que entra por dentro da folha até o líquido [...] e um quadro novo abaixo com o por fora"
  h += cgFolhaQuadroDentro(comp, P) + cgFolhaQuadroFora(comp);
  return h;
}
// ---- Conferência da folha em dois quadros + validação (RH 05/11/2026: 2026-11-05-rh-conferencia-dois-quadros.md e
// 2026-11-05-rh-validar-conferencia.md). Só depois de validar o robô atualiza o Saipos e a lista de pagamento (dono, 12:47).
const CG_Q_PROV = [['salario', 'Salário'], ['horas_extras', 'Horas extras'], ['noturno', 'Noturno'], ['gratif_salao', 'Gratif. salão'], ['gratif_confianca', 'Gratif. confiança'],
  ['ferias', 'Férias'], ['afastamento', 'Afastamento'], ['rescisao_proventos', 'Rescisão'], ['outros_proventos', 'Outros']];
const CG_Q_DESC = [['inss', 'INSS'], ['irrf', 'IRRF'], ['vt', 'VT'], ['adiantamento', 'Adiantamento'], ['adiant_ferias', 'Adiant. férias'], ['faltas', 'Faltas'],
  ['consignado', 'Consignado'], ['sindical', 'Sindical'], ['rescisao_descontos', 'Rescisão'], ['outros_descontos', 'Outros']];
function cgFolhaGrupo() {
  try { const g = JSON.parse(localStorage.getItem('cgFolhaGrupo') || 'null'); if (g && typeof g === 'object') return { prov: !!g.prov, desc: !!g.desc }; } catch (e) {}
  return { prov: false, desc: false };
}
function cgFolhaGrupoTroca(b) {
  const g = cgFolhaGrupo(); g[b] = !g[b];
  try { localStorage.setItem('cgFolhaGrupo', JSON.stringify(g)); } catch (e) {}
  renderModuloCargos();
}
// CORREÇÕES PARA A CONTABILIDADE (dono 05/11/2026: "as diferenças me manda em texto pra eu passar pra contabilidade [...] se houver
// erro deles, enviamos a correção, eles devolvem corrigida e vc confere"). A situação muda sozinha quando a folha é relida.
const CG_CORR_SIT = { 'A ENVIAR': 'var(--farol-perto)', 'ENVIADO': 'var(--tx-3)', 'CORRIGIDO': 'var(--farol-ok)', 'NÃO CORRIGIDO': 'var(--farol-fora)', 'NAO CORRIGIDO': 'var(--farol-fora)' };
function cgFolhaCorrecoesHtml(comp) {
  const C0 = (CARGOS.folha.corr || []).filter((x) => String(x.competencia).slice(0, 10) === comp);
  if (CARGOS.folha.corr === null) return '<div class="contexto">Não consegui ler as correções para a contabilidade (vw_rh_folha_correcao).</div>';
  if (!C0.length) return '';
  // 05/11/2026 (dono, chat RH): à contabilidade só vai ERRO PROVADO deles; o que depende de conferir na nossa ponta (Flash) é da Hellen
  const H = C0.filter((x) => x.para === 'HELLEN'), C = C0.filter((x) => x.para !== 'HELLEN');
  const T = (CARGOS.folha.corrTxt || []).filter((x) => String(x.competencia).slice(0, 10) === comp);
  const aEnviar = C.filter((x) => x.situacao === 'A ENVIAR').length;
  const sitTxt = (x) => x.situacao === 'ENVIADO' && x.enviado_em ? `ENVIADO em ${cgData(x.enviado_em)}` : /N[ÃA]O CORRIGIDO/.test(x.situacao) && x.folha_lida_em ? `NÃO CORRIGIDO (folha relida em ${cgData(x.folha_lida_em)})` : x.situacao;
  const quem = (x) => `${x.nome ? cgEsc(cgNome(x.nome)) : 'todos'}<div style="font-size:11px;color:var(--tx-4);">${cgEsc(String(x.empresa || '').replace(/^\d+\s*-\s*/, ''))}</div>`;
  let h = '';
  if (H.length) h += `<div class="contexto" style="text-align:left;border-color:var(--farol-perto);"><b>Para a Hellen conferir antes de mandar</b> — ${H.length} ${H.length === 1 ? 'item' : 'itens'}. Não vai à contabilidade: o erro pode ser nosso.
    <div id="tabelaCgCorrHellen" style="overflow-x:auto;margin-top:6px;"><table><thead><tr><th>Quem</th><th>O que aconteceu</th><th>O que fazer</th></tr></thead><tbody>
    ${H.map((x) => `<tr><td>${quem(x)}</td><td style="white-space:normal;min-width:200px;">${cgEsc(x.texto || x.item || '')}</td>
      <td style="white-space:normal;min-width:220px;font-weight:600;">${cgEsc(x.para_hellen || '')}</td></tr>`).join('')}
    </tbody></table></div></div>`;
  if (!C.length) return h;
  h += `<div class="contexto" style="text-align:left;border-color:${aEnviar ? 'var(--farol-perto)' : 'var(--line)'};"><b>Erros da contabilidade</b> — ${C.length} ${C.length === 1 ? 'item' : 'itens'}${aEnviar ? `, ${aEnviar} a enviar` : ''}. Quando a folha corrigida volta, a situação muda sozinha.
    <div id="tabelaCgCorr" style="overflow-x:auto;margin-top:6px;"><table><thead><tr><th>Quem</th><th>O quê</th><th>Esperado</th><th>Na folha</th><th>Situação</th></tr></thead><tbody>
    ${C.map((x) => `<tr><td>${quem(x)}</td>
      <td style="white-space:normal;min-width:220px;">${cgEsc(x.texto || x.item || '')}</td><td>${cgEsc(x.esperado == null ? '–' : x.esperado)}</td><td>${cgEsc(x.na_folha == null ? '–' : x.na_folha)}</td>
      <td><span style="font-size:11.5px;font-weight:700;border-radius:999px;padding:2px 8px;border:1px solid ${CG_CORR_SIT[x.situacao] || 'var(--line)'};color:${CG_CORR_SIT[x.situacao] || 'var(--tx-3)'};white-space:nowrap;">${cgEsc(sitTxt(x))}</span></td></tr>`).join('')}
    </tbody></table></div>`;
  const M = T[0];
  if (M && M.texto) h += `<div style="margin-top:10px;"><b style="font-size:12.5px;">Mensagem para a contabilidade</b> (uma só, por empresa; só o que falta corrigir)</div>
    <div style="margin-top:6px;padding:8px 10px;border:1px solid var(--line);border-radius:8px;">
      <pre id="cgCorrTxt0" style="white-space:pre-wrap;font-family:inherit;font-size:12.5px;margin:0 0 8px;">${cgEsc(M.texto)}</pre>
      ${cgBotaoPasso('Copiar mensagem', 'cgFolhaCorrCopiar(0)', true)} ${cgBotaoPasso('Marquei como enviado', `cgFolhaCorrEnviada('${comp}',null)`, true)}</div>`;
  return h + '</div>';
}
async function cgFolhaCorrCopiar(i) {
  const el = document.getElementById('cgCorrTxt' + i);
  try { await navigator.clipboard.writeText(el ? el.textContent : ''); avisoAcao('ok', `✓ Mensagem copiada — às ${avisoHora()}. Cole no WhatsApp ou no e-mail da contabilidade e depois clique em "Marquei como enviado".`); }
  catch (e) { avisoAcao('erro', '✗ Não copiou. Selecione o texto com o mouse e copie.', () => cgFolhaCorrCopiar(i)); }
}
async function cgFolhaCorrEnviada(comp, emp) {
  avisoAcao('atencao', '… marcando como enviado');
  const r = await trRpcSeguro('rh_folha_correcao_marcar_enviada', { p_competencia: comp, p_empresa_cod: emp || null });
  if (!r.ok) return avisoAcao('erro', `✗ Não gravou: ${await trErroDe(r)}`, () => cgFolhaCorrEnviada(comp, emp));
  const n = await r.json().catch(() => null);
  await cgFolhaCarregar();
  avisoAcao('ok', `✓ ${n != null ? `${n} ${Number(n) === 1 ? 'item marcado' : 'itens marcados'}` : 'Marcado'} como enviado à contabilidade — às ${avisoHora()}. Quando a folha corrigida voltar, a situação muda sozinha.`);
}
// IMPORTAR FOLHA (05/11/2026, proposta do RH 2026-11-05-rh-importar-folha-e-por-fora-sem-baixa-manual.md; dono: "igual temos no OFX")
// O PDF vai em base64 para rh_folha_arquivo; o robô do RH (5 em 5 min) lê, grava e responde em vw_rh_folha_importacao.
function cgFolhaImportarHtml() {
  if (CARGOS.folhaImp === undefined) { CARGOS.folhaImp = null; cgFolhaImpCarregar(); }
  const L = (CARGOS.folhaImp || []).slice(0, 4);
  const linha = (x) => {
    const q = String(x.quem || '').split('@')[0], em = x.enviado_em ? new Date(x.enviado_em).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }).replace(',', ' às') : '';
    const st = x.situacao === 'LENDO' ? `<span style="color:var(--farol-perto);font-weight:700;">⏳ ${x.resultado ? cgEsc(x.resultado) : 'lendo (até 5 min)'}</span>`
      : x.situacao === 'LIDA' ? `<span style="color:var(--farol-ok);font-weight:700;">✓ ${cgEsc(x.resultado || 'lida e gravada')}</span>`
      : `<span style="color:var(--farol-fora);font-weight:700;">✗ ${cgEsc(x.resultado || 'não lida')}</span> — confira se é o Extrato Mensal da Folha e envie de novo`;
    return `<div style="font-size:12.5px;margin-top:4px;">${cgEsc(x.nome || '')} <span style="color:var(--tx-4);">· ${cgEsc(q)} ${em}</span> — ${st}</div>`;
  };
  return `<div class="contexto" style="text-align:left;margin-bottom:10px;">
    <label class="preset-btn" style="cursor:pointer;display:inline-block;">📄 Importar folha da contabilidade (PDF)
      <input type="file" accept=".pdf,application/pdf" multiple style="display:none;" onchange="cgFolhaImportar(this)"></label>
    <span class="caption-label" style="margin-left:8px;">o robô lê em até 5 min e a conferência atualiza sozinha</span>
    ${L.map(linha).join('')}</div>`;
}
async function cgFolhaImpCarregar() {
  try { const r = await trFetch('vw_rh_folha_importacao?select=id,nome,quem,enviado_em,atendido_em,ok,resultado,situacao&order=enviado_em.desc,id.desc&limit=4');
    CARGOS.folhaImp = r.ok ? await r.json() : []; }
  catch (e) { CARGOS.folhaImp = []; }
  const lendo = CARGOS.folhaImp.some((x) => x.situacao === 'LENDO');
  if (CARGOS.folhaImpLendo && !lendo) { CARGOS.folhaImpLendo = false; await cgFolhaCarregar(); return; }
  CARGOS.folhaImpLendo = lendo;
  if (CARGOS_F.aba === 'folha') renderModuloCargos();
  clearTimeout(CARGOS.folhaImpT);
  if (lendo) CARGOS.folhaImpT = setTimeout(cgFolhaImpCarregar, 20000);
}
async function cgFolhaImportar(inp) {
  const arqs = [...inp.files]; inp.value = '';
  if (!arqs.length) return;
  const b64 = (f) => new Promise((ok, erro) => { const r = new FileReader(); r.onload = () => ok(String(r.result)); r.onerror = () => erro(new Error('não consegui ler ' + f.name)); r.readAsDataURL(f); });
  try {
    await rmbGarantirTokenValido();
    for (let i = 0; i < arqs.length; i++) {
      avisoAcao('enviando', `Enviando a folha ${arqs.length > 1 ? (i + 1) + ' de ' + arqs.length : ''} (${arqs[i].name})…`);
      if (arqs[i].size > 15000000) throw new Error(arqs[i].name + ' é grande demais para ser a folha');
      const conteudo = await b64(arqs[i]);
      const envia = () => fetch(`${SUPABASE_URL}/rest/v1/rh_folha_arquivo`, { method: 'POST', headers: rmbHeaders({ 'Content-Type': 'application/json', Prefer: 'return=minimal' }),
        body: JSON.stringify({ nome: arqs[i].name, conteudo }) });
      let r = await envia();
      if (r.status === 401) { await rmbRenovarSeExpirado(r); r = await envia(); }
      if (!r.ok) throw new Error((await r.text()).slice(0, 160));
    }
    avisoAcao('ok', `✓ ${arqs.length === 1 ? 'Folha enviada' : arqs.length + ' folhas enviadas'} às ${avisoHora()} — o robô lê em até 5 min; o resultado aparece no quadro de importação.`);
    CARGOS.folhaImpLendo = true;
    await cgFolhaImpCarregar();
  } catch (e) { avisoAcao('erro', '✗ Não consegui enviar a folha: ' + e.message + '. Tente de novo.'); }
}
function cgFolhaValidacaoHtml(comp) {
  const v = (CARGOS.folha.valid || []).find((x) => String(x.competencia).slice(0, 10) === comp);
  if (v) return `<div class="contexto" style="text-align:left;border-color:var(--farol-ok);"><b style="color:var(--farol-ok);">✓ Conferência validada por ${cgEsc(cgNome(String(v.validado_por || '').split('@')[0]))} em ${cgEsc(cgEnvQuando(v.validado_em))}.</b>
    ${v.obs ? `<span style="color:var(--tx-3);">${cgEsc(v.obs)}</span>` : ''} O robô já pode atualizar o Saipos e a lista de pagamento.
    <a href="javascript:void(0)" onclick="cgFolhaValidar('${comp}',false)" style="color:var(--tx-4);margin-left:6px;">desfazer</a></div>`;
  return `<div class="contexto" style="text-align:left;border-color:var(--farol-perto);"><b>Conferência de ${cgEsc(cgMesRot(comp))} ainda não validada.</b>
    Depois de validar, o robô atualiza o Saipos (salários e bonificação) e a lista de pagamento.
    <div style="display:flex;flex-wrap:wrap;gap:8px;align-items:center;margin-top:8px;">
      <input id="cgFolhaObs" type="text" placeholder="observação (opcional)" style="flex:1 1 220px;padding:6px 8px;background:var(--surface-2);color:var(--tx-1);border:1px solid var(--line);border-radius:6px;">
      ${cgBotaoPasso('Validar conferência', `cgFolhaValidar('${comp}',true)`)}</div></div>`;
}
async function cgFolhaValidar(comp, sim) {
  const el = document.getElementById('cgFolhaObs'), obs = sim && el ? el.value.trim() || null : null;
  avisoAcao('atencao', sim ? '… validando a conferência' : '… desfazendo a validação');
  const r = await trRpcSeguro('rh_folha_validar', { p_competencia: comp, p_validar: sim, p_obs: obs });
  if (!r.ok) return avisoAcao('erro', `✗ Não gravou: ${await trErroDe(r)}`, () => cgFolhaValidar(comp, sim));
  await cgFolhaCarregar();
  avisoAcao('ok', sim ? `✓ Conferência de ${cgMesRot(comp)} validada às ${avisoHora()}: o robô já pode atualizar o Saipos e a lista de pagamento.` : `✓ Validação de ${cgMesRot(comp)} desfeita às ${avisoHora()}.`);
}
function cgFolhaQuadroDentro(comp, Pconf) {
  const F = CARGOS_F, Qall = CARGOS.folha.quadro;
  if (!Qall) return '<div class="contexto">Não consegui ler o quadro da folha (vw_rh_folha_quadro).</div>';
  const conf = new Map(Pconf.map((x) => [`${x.empresa}|${x.matricula}`, cgLista(x.conferencia)]));
  const alertas = (x) => (conf.get(`${x.empresa}|${x.matricula}`) || []).concat(x.fecha === false ? ['as rubricas não somam o extrato'] : [],
    cgLista(x.rubricas_sem_grupo).map((r) => 'rubrica nova: ' + r), x.conferir_texto ? [x.conferir_texto] : []);
  const Q = Qall.filter((x) => String(x.competencia).slice(0, 10) === comp && (!F.unidade || x.unidade === F.unidade));
  // 05/11/2026 (dono): "um agrupar igual do excel" — fechado (padrão) mostra só o total do bloco; a escolha fica guardada
  const G = cgFolhaGrupo();
  const PV = G.prov ? CG_Q_PROV.filter(([k]) => Q.some((x) => cgN(x[k]))) : [], DS = G.desc ? CG_Q_DESC.filter(([k]) => Q.some((x) => cgN(x[k]))) : [];
  // horas base (dono: "pegar os erros da contabilidade"): normais + férias/afastamento contra a carga do contrato
  const HB = new Map((CARGOS.folha.hbase || []).filter((h) => String(h.competencia).slice(0, 10) === comp).map((h) => [`${h.empresa_cod}|${h.matricula}`, h]));
  const temHB = HB.size > 0;
  const hbCel = (x) => {
    if (!temHB) return '';
    const h = HB.get(`${String(x.empresa).slice(0, 3)}|${x.matricula}`);
    if (!h) return '<td style="color:var(--tx-5);">–</td>';
    const fz = (v) => { const n = cgN(v); return Number.isInteger(n) ? String(n) : n.toLocaleString('pt-BR', { maximumFractionDigits: 2 }); };
    const tot = cgN(h.horas_normais) + cgN(h.horas_ferias_afastamento), ok = Math.abs(tot - cgN(h.carga)) < 0.01;
    const marca = h.mes_cheio === false ? '' : ok ? ' <span style="color:var(--farol-ok);">✓</span>' : ' <span style="color:var(--farol-fora);font-weight:700;">✗</span>';
    return `<td title="normais ${fz(h.horas_normais)} + férias/afastamento ${fz(h.horas_ferias_afastamento)} · carga ${fz(h.carga)}${h.mes_cheio === false ? ' · entrou ou saiu no mês' : ''}" style="${!ok && h.mes_cheio !== false ? 'color:var(--farol-fora);' : ''}">${fz(tot)}/${fz(h.carga)}${marca}</td>`;
  };
  const nConf = Q.filter((x) => alertas(x).length).length;
  const vis = Q.filter((x) => F.folhaCol !== 'conf' || alertas(x).length);
  const v0 = (v) => cgN(v) ? cgR(v) : '<span style="color:var(--tx-5);">–</span>';
  const soma = (arr, k) => arr.reduce((a, x) => a + cgN(x[k]), 0);
  // 05/11/2026 (dono, ajuste): "os por fora entrar na mesma tabela após o líquido CLT, a soma final que a Hellen deve pagar
  // para cada um seria o CLT + os por fora" — combinado · empréstimo/vale · bonificação → A pagar (vw_rh_folha_quadro)
  const comFora = Q.some((x) => 'valor_a_pagar' in x);
  const ncol = PV.length + DS.length + 5 + (comFora ? 4 : 0) + (temHB ? 1 : 0);
  const foraTot = (arr) => comFora ? `<td>${cgR(soma(arr, 'acrescimo_combinado'))}</td><td>− ${cgR(soma(arr, 'desconto_emprestimo'))}</td><td>${cgR(soma(arr, 'bonificacao'))}</td><td>${cgR(soma(arr, 'valor_a_pagar'))}</td>` : '';
  const linhaTot = (rot, arr, cls) => `<tr class="${cls}"><td>${rot}</td>${temHB ? '<td></td>' : ''}${PV.map(([k]) => `<td>${cgR(soma(arr, k))}</td>`).join('')}<td>${cgR(soma(arr, 'proventos'))}</td>
    ${DS.map(([k]) => `<td>${cgR(soma(arr, k))}</td>`).join('')}<td>${cgR(soma(arr, 'descontos'))}</td><td>${cgR(soma(arr, 'liquido'))}</td>${foraTot(arr)}<td></td></tr>`;
  const socio = (x) => x.vinculo && /diretor/i.test(x.vinculo), saiu = (x) => /demiti|rescis|deslig/i.test(String(x.situacao || ''));
  const foraCel = (x) => {
    if (!comFora) return '';
    if (socio(x)) return '<td colspan="4" style="color:var(--tx-4);">sócio: pró-labore, sem por fora</td>';
    if (x.valor_a_pagar == null && saiu(x)) return '<td colspan="4" style="color:var(--tx-4);">saiu: a rescisão paga</td>';
    return `<td>${v0(x.acrescimo_combinado)}${x.combinado_tipo ? `<div style="font-size:11px;color:var(--tx-4);white-space:normal;min-width:140px;">${x.combinado_tipo === 'TOTAL' ? 'total combinado' : 'acréscimo fixo'}${x.combinado_motivo ? ' — ' + cgEsc(x.combinado_motivo) : ''}</div>` : ''}</td>
      <td>${cgN(x.desconto_emprestimo) ? '− ' + cgR(x.desconto_emprestimo) : v0(0)}${x.desconto_detalhe ? `<div style="font-size:11px;color:var(--tx-4);white-space:normal;">${cgEsc(x.desconto_detalhe)}</div>` : ''}</td>
      <td>${v0(x.bonificacao)}</td><td style="font-weight:700;">${x.valor_a_pagar == null ? '–' : cgR(x.valor_a_pagar)}</td>`;
  };
  let h = `<div class="section-label" style="margin-top:14px;">${comFora ? 'Folha da contabilidade e o que a Hellen paga a cada um' : 'Folha da contabilidade (por dentro) — até o líquido'}</div>
    <div style="display:flex;flex-wrap:wrap;gap:6px;margin:0 0 10px;align-items:center;">${nConf
      ? `<button type="button" class="preset-btn ${F.folhaCol === 'conf' ? 'active' : ''}" style="border-color:var(--farol-perto);" onclick="CARGOS_F.folhaCol=CARGOS_F.folhaCol==='conf'?null:'conf';renderModuloCargos()">a conferir ${nConf}${F.folhaCol === 'conf' ? ' ✕' : ''}</button>`
      : '<span style="font-size:12px;color:var(--farol-ok);">✓ todas as rubricas entraram e cada pessoa fecha com o extrato</span>'}</div>
    <div id="tabelaCgFolha" style="overflow-x:auto;"><table><thead>
      <tr><th rowspan="2">Nome</th>${temHB ? '<th rowspan="2" title="horas normais + férias/afastamento na folha, contra a carga do contrato">Horas base</th>' : ''}<th colspan="${PV.length + 1}" style="text-align:center;cursor:pointer;" title="${G.prov ? 'fechar' : 'abrir'} o bloco" onclick="cgFolhaGrupoTroca('prov')">${G.prov ? '⊟' : '⊞'} Proventos</th><th colspan="${DS.length + 1}" style="text-align:center;cursor:pointer;" title="${G.desc ? 'fechar' : 'abrir'} o bloco" onclick="cgFolhaGrupoTroca('desc')">${G.desc ? '⊟' : '⊞'} Descontos</th><th rowspan="2">Líquido CLT</th>${comFora ? '<th colspan="4" style="text-align:center;">Depois do líquido</th>' : ''}<th rowspan="2">Conferir</th></tr>
      <tr>${PV.map(([, r]) => `<th>${r}</th>`).join('')}<th>${G.prov ? 'Total' : 'Proventos'}</th>${DS.map(([, r]) => `<th>${r}</th>`).join('')}<th>${G.desc ? 'Total' : 'Descontos'}</th>${comFora ? '<th>Combinado</th><th>Empréstimo / vale</th><th>Bonificação</th><th>A pagar</th>' : ''}</tr></thead><tbody>`;
  const emps = [...new Set(vis.map((x) => x.empresa))];
  emps.forEach((e) => {
    const lin = vis.filter((x) => x.empresa === e).sort((a, b) => String(a.nome || a.apelido).localeCompare(String(b.nome || b.apelido)));
    h += `<tr class="sub"><td colspan="${ncol}"><b>${cgEsc(String(e).replace(/^\d+\s*-\s*/, ''))}</b></td></tr>`;
    lin.forEach((x) => {
      const k = `${x.empresa}|${x.matricula}`, ab = F.folhaAberta === k, al = alertas(x);
      const sit = String(x.situacao || '').toLowerCase();
      h += `<tr style="cursor:pointer;" onclick='cgFolhaAbrir(${cgEsc(JSON.stringify(k))})'>
        <td>${cgEsc(cgNome(x.nome || x.apelido))} <span style="font-size:11px;color:var(--tx-5);">${cgEsc(x.unidade || '')}${sit && sit !== 'trabalhando' ? ' · ' + cgEsc(sit) : ''}${x.vinculo && /diretor/i.test(x.vinculo) ? ' · sócio' : ''}</span></td>${hbCel(x)}
        ${PV.map(([kk]) => `<td>${v0(x[kk])}</td>`).join('')}<td style="font-weight:600;">${cgR(x.proventos)}</td>
        ${DS.map(([kk]) => `<td>${v0(x[kk])}</td>`).join('')}<td style="font-weight:600;">${cgR(x.descontos)}</td>
        <td style="font-weight:700;">${cgR(x.liquido)}</td>${foraCel(x)}
        <td style="font-size:11.5px;color:var(--farol-perto);white-space:normal;min-width:160px;"${x.saipos_salario != null ? ` title="título de salário no Saipos: ${cgR(x.saipos_salario)}"` : ''}>${al.map(cgEsc).join('<br>')}</td></tr>
        ${ab ? `<tr><td colspan="${ncol}">${cgFolhaRubHtml(x)}</td></tr>` : ''}`;
    });
    h += linhaTot(`Subtotal ${cgEsc(String(e).replace(/^\d+\s*-\s*/, ''))}`, lin, 'sub');
  });
  h += `</tbody><tfoot>${linhaTot(`Total · ${vis.length} ${vis.length === 1 ? 'pessoa' : 'pessoas'}`, vis, 'liq')}</tfoot></table></div>`;
  return h;
}
// 05/11/2026 (dono 19:47): a conta de quem é por fora, campo a campo até o valor pago (proposta 2026-11-05-rh-rita-conta-detalhada)
function cgFfDoMes(x, comp) {
  if (x.liquido_folha != null) return null;
  if (CARGOS.adtFora === undefined) { cgAdtForaCarregar(); return null; }
  const nm = String(x.nome || '').trim().toUpperCase();
  return (CARGOS.adtFora || []).find((y) => String(y.nome || '').trim().toUpperCase() === nm && String(y.mes).slice(0, 10) === comp) || null;
}
function cgFfDescontos(ff) {   // vw_rh_a_descontar: a parcela da dívida que cai neste pagamento e os descontos marcados para depois
  const pn = String(ff.nome || '').trim().toUpperCase().split(/\s+/)[0], ven = String(ff.vence_saldo || '').slice(0, 10), mesV = ven.slice(0, 7);
  const D = (CARGOS.ffDescontar || []).filter((y) => String(y.colaborador || '').trim().toUpperCase() === pn && String(y.mes).slice(0, 7) === mesV);
  const divida = D.find((y) => y.credor !== 'EMPRESA' && String(y.data_desconto).slice(0, 10) <= ven) || null;
  const fora = D.filter((y) => String(y.data_desconto).slice(0, 10) > ven);
  return { divida, fora };
}
// 05/11/2026 (dono 19:52): "por coluna, cada coluna traz um numero e compoem o valor na horizontal" — a mesma régua na
// Conferência (Só por fora) e na aba Cálculos por fora. Sinal: 1 soma, −1 desconta, 0 resultado; o ajuste leva o próprio sinal.
const CG_FF_COLS = [['salario', 'Salário', 1], ['gratificacao_fixa', 'Gratif. fixa', 1], ['gratificacao_salao', 'Gratif. salão', 1], ['ajuste', 'Ajuste', 1],
  ['vale_transporte', '(−) VT', -1], ['desconto_consumo', '(−) Consumo', -1], ['adiantamento', '(−) Adiantamento', -1], ['desconto_divida', '(−) Reembolso / dívida', -1],
  ['saldo', '= Saldo por fora', 0], ['bonif', '(+) Bonificação', 1], ['apagar', '= A pagar', 0]];
function cgFfValores(ff, bonif, aPagar) {   // {chave: número} de uma linha; sem ff (não achou o mês) só o que o pagamento traz
  const o = {}; CG_FF_COLS.forEach(([k]) => { o[k] = ff && k in ff ? cgN(ff[k]) : 0; });
  o.bonif = cgN(bonif); o.apagar = aPagar != null ? cgN(aPagar) : o.saldo + o.bonif; return o;
}
function cgFfCelulas(ff, V, extraAPagar) {
  const sub = (t) => t ? `<div style="font-size:11px;font-weight:400;color:var(--tx-4);white-space:normal;">${t}</div>` : '';
  const pd = ff ? cgFfDescontos(ff).divida : null;
  return CG_FF_COLS.map(([k, , sg]) => {
    const v = V[k], neg = sg < 0 || (k === 'ajuste' && v < 0);
    const num = v ? `${neg ? '− ' : ''}${cgR(Math.abs(v))}` : '<span style="color:var(--tx-5);">–</span>';
    let s = '';
    if (ff && k === 'salario' && Number(ff.dias) < 30) s = `${ff.dias}/30 dias`;
    if (ff && k === 'adiantamento' && v) s = ff.adiantamento_pago_em ? `pago ${cgDiaMes(String(ff.adiantamento_pago_em))}` : ff.vence_adiantamento ? `vence ${cgDiaMes(String(ff.vence_adiantamento))}` : '';
    if (ff && k === 'desconto_divida' && v) s = pd ? `${cgEsc(cgNome(pd.credor))} ${pd.parcela}/${pd.parcelas_no_plano}` : '';
    if (k === 'apagar' && ff && ff.vence_saldo && !extraAPagar) s = `vence ${cgDiaMes(String(ff.vence_saldo))}`;
    const tit = ff && k === 'ajuste' && ff.ajuste_motivo ? ` title="${cgEsc(ff.ajuste_motivo)}"` : ff && k === 'desconto_divida' && ff.desconto_divida_motivo ? ` title="${cgEsc(ff.desconto_divida_motivo)}"` : '';
    return `<td${tit}${sg === 0 ? ' style="font-weight:700;"' : ''}>${num}${sub(s)}${k === 'apagar' ? extraAPagar || '' : ''}</td>`;
  }).join('');
}
function cgFfTotais(Vs) {
  return CG_FF_COLS.map(([k, , sg]) => { const v = Vs.reduce((a, V) => a + V[k], 0), neg = sg < 0 || (k === 'ajuste' && v < 0);
    return `<td>${v ? `${neg ? '− ' : ''}${cgR(Math.abs(v))}` : '–'}</td>`; }).join('');
}
function cgFfRecibos(ff, mes) {
  if (!ff) return '';
  const b = [];
  if (ff.adiantamento_pago_em) b.push(`<button type="button" class="preset-btn" style="margin:2px 4px 0 0;" onclick="ffReciboAbrir(${ff.pessoa_id},'${mes}','ADIANTAMENTO')">🧾 Adiantamento</button>`);
  if (ff.saldo_pago_em) b.push(`<button type="button" class="preset-btn" style="margin:2px 4px 0 0;" onclick="ffReciboAbrir(${ff.pessoa_id},'${mes}','SALDO')">🧾 Saldo</button>`);
  return b.join('');
}
function cgFolhaQuadroForaCols(comp, R) {
  if (CARGOS.adtFora === undefined) cgAdtForaCarregar();
  if (!CARGOS.adtFora) return '<div class="section-label" style="margin-top:18px;">Só por fora (sem registro)</div><div class="contexto">Lendo a conta de quem é por fora…</div>';
  const F = CARGOS_F, mp = R.find((x) => x.mes_pagamento) || {};
  const Q = (CARGOS.folha.quadro || []).filter((x) => String(x.competencia).slice(0, 10) === comp && (!F.unidade || x.unidade === F.unidade));
  const L = R.map((x) => { const ff = cgFfDoMes(x, comp); return { x, ff, V: cgFfValores(ff, x.bonificacao, x.valor_a_pagar) }; });
  const totPagina = Q.reduce((a, x) => a + cgN(x.valor_a_pagar), 0) + L.reduce((a, l) => a + l.V.apagar, 0);
  const nc = CG_FF_COLS.length + 2;
  let h = `<div class="section-label" style="margin-top:18px;">Só por fora (sem registro)${mp.mes_pagamento ? ` — paga em ${cgEsc(cgMesRot(mp.mes_pagamento))}` : ''}</div>
    <div id="tabelaCgFora" style="overflow-x:auto;"><table><thead><tr><th>Nome</th>${CG_FF_COLS.map(([, r]) => `<th>${r}</th>`).join('')}<th>Conferir</th></tr></thead><tbody>`;
  [...new Set(L.map((l) => l.x.empresa))].forEach((e) => {
    const G = L.filter((l) => l.x.empresa === e);
    h += `<tr class="sub"><td colspan="${nc}"><b>${cgEsc(e)}</b></td></tr>`;
    G.forEach(({ x, ff, V }) => {
      const extra = x.saiu ? '<div style="font-size:11px;font-weight:400;color:var(--tx-4);">saiu: a rescisão paga</div>'
        : ff ? `<div style="font-size:11px;font-weight:400;color:var(--tx-4);">${ffSituacaoTxt(ff, 'SALDO')}</div>${ff.saldo_pago_em ? `<button type="button" class="preset-btn" style="margin-top:4px;" onclick="ffReciboAbrir(${ff.pessoa_id},'${comp}','SALDO')">🧾 Recibo</button>` : ''}` : '';
      const fora = ff ? cgFfDescontos(ff).fora : [];
      h += `<tr><td>${cgEsc(cgNome(x.nome))} <span style="font-size:11px;color:var(--tx-5);">${cgEsc(x.unidade || '')}</span></td>${cgFfCelulas(ff, V, extra)}
        <td style="font-size:11.5px;white-space:normal;min-width:170px;" title="título de salário no Saipos: ${x.saipos_salario == null ? 'nenhum' : cgR(x.saipos_salario)}"><span style="color:var(--farol-perto);">${cgEsc(x.conferir_texto || '')}</span>
          ${fora.map((y) => `<div style="color:var(--tx-5);">${cgEsc(String(y.descricao || '').toLowerCase())} ${cgR(y.valor)}: desconto marcado para ${cgDiaMes(String(y.data_desconto))}, fora deste pagamento</div>`).join('')}</td></tr>`;
    });
    h += `<tr class="sub"><td>Subtotal ${cgEsc(e)}</td>${cgFfTotais(G.map((l) => l.V))}<td></td></tr>`;
  });
  return h + `</tbody><tfoot><tr class="liq"><td>Total · ${L.length} ${L.length === 1 ? 'pessoa' : 'pessoas'}</td>${cgFfTotais(L.map((l) => l.V))}<td></td></tr></tfoot></table></div>
    <div class="contexto" style="text-align:left;margin-top:10px;"><b>Total a pagar no mês: ${cgR(totPagina)}</b> <span style="color:var(--tx-3);">(a tabela de cima + só por fora)</span></div>`;
}
// Cálculos da folha › Cálculos por fora (05/11/2026, dono 19:52): o histórico mês a mês de quem é por fora, só leitura
function cgAbaFfCalc() {
  if (CARGOS.adtFora === undefined) { cgAdtForaCarregar(); return '<div class="contexto">Lendo os cálculos por fora…</div>'; }
  if (!CARGOS.adtFora) return '<div class="contexto">Lendo os cálculos por fora…</div>';
  const F = CARGOS_F, M = CARGOS.adtFora.filter((x) => !x.futuro && (!F.unidade || x.unidade === F.unidade));
  if (!M.length) return `${cgFiltroUnidade(CARGOS.pessoas)}<div class="contexto">Ninguém por fora com mês calculado.</div>`;
  const nc = CG_FF_COLS.length + 3;
  let h = cgFiltroUnidade(CARGOS.pessoas);
  [...new Set(M.map((x) => x.pessoa_id))].forEach((pid) => {
    const P = M.filter((x) => x.pessoa_id === pid).sort((a, b) => String(a.mes).localeCompare(String(b.mes))), p0 = P[0];
    const nm = String(p0.nome || '').trim().toUpperCase();
    const Ls = P.map((ff) => { const mes = String(ff.mes).slice(0, 10);
      const pg = (CARGOS.ffPag || []).find((y) => String(y.competencia).slice(0, 10) === mes && (y.pessoa_id === pid || String(y.nome || '').trim().toUpperCase() === nm));
      return { ff, mes, V: cgFfValores(ff, pg ? pg.bonificacao : 0, pg ? pg.valor_a_pagar : null) }; });
    h += `<div class="section-label" style="margin-top:14px;">${cgEsc(cgNome(p0.nome))} <span style="font-weight:400;color:var(--tx-4);">· ${cgEsc(p0.unidade || '')} · sem registro · sai da conta ${cgEsc(p0.conta || '–')}</span></div>
      <div id="tabelaCgFfCalc${pid}" style="overflow-x:auto;"><table><thead><tr><th>Mês</th>${CG_FF_COLS.map(([, r]) => `<th>${r}</th>`).join('')}<th>Pago</th><th>Recibo</th></tr></thead><tbody>
      ${Ls.map(({ ff, mes, V }) => `<tr><td><b>${cgEsc(cgMesRot(mes))}</b></td>${cgFfCelulas(ff, V)}
        <td style="font-size:11.5px;white-space:normal;min-width:150px;"><div>adiant.: ${ffSituacaoTxt(ff, 'ADIANTAMENTO')}</div><div>saldo: ${ffSituacaoTxt(ff, 'SALDO')}</div></td>
        <td>${cgFfRecibos(ff, mes) || '<span style="color:var(--tx-5);">–</span>'}</td></tr>`).join('')}
      </tbody><tfoot><tr class="liq"><td>Total · ${Ls.length} ${Ls.length === 1 ? 'mês' : 'meses'}</td>${cgFfTotais(Ls.map((l) => l.V))}<td colspan="2"></td></tr></tfoot></table></div>`;
  });
  return h;
}
function cgFolhaQuadroFora(comp) {
  const F = CARGOS_F, Rall = CARGOS.folha.pag;
  if (!Rall) return '<div class="contexto">Não consegui ler o pagamento do mês (vw_rh_pagamento_mes).</div>';
  // 05/11/2026 (dono): "no quadro abaixo somente o que for por fora" — quem tem folha já está na tabela de cima
  const soFora = (CARGOS.folha.quadro || []).some((x) => 'valor_a_pagar' in x);
  const R = Rall.filter((x) => String(x.competencia).slice(0, 10) === comp && (!F.unidade || x.unidade === F.unidade) && (!soFora || x.liquido_folha == null));
  if (!R.length) return '';
  if (soFora) return cgFolhaQuadroForaCols(comp, R);
  const mp = R.find((x) => x.mes_pagamento) || {};
  const v0 = (v, neg) => cgN(v) ? (neg ? '− ' : '') + cgR(v) : '<span style="color:var(--tx-5);">–</span>';
  const soma = (arr, k) => arr.reduce((a, x) => a + cgN(x[k]), 0);
  const tot = (rot, arr, cls) => `<tr class="${cls}"><td>${rot}</td><td>${cgR(soma(arr, 'liquido_folha'))}</td><td>${cgR(soma(arr, 'acrescimo_combinado'))}</td><td>${cgR(soma(arr, 'saldo_fora'))}</td>
    <td>− ${cgR(soma(arr, 'desconto_emprestimo'))}</td><td>${cgR(soma(arr, 'bonificacao'))}</td><td>${cgR(soma(arr, 'valor_a_pagar'))}</td><td></td></tr>`;
  const Q = (CARGOS.folha.quadro || []).filter((x) => String(x.competencia).slice(0, 10) === comp && (!F.unidade || x.unidade === F.unidade));
  const totPagina = soFora ? Q.reduce((a, x) => a + cgN(x.valor_a_pagar), 0) + soma(R, 'valor_a_pagar') : null;
  let h = `<div class="section-label" style="margin-top:18px;">${soFora ? 'Só por fora (sem registro)' : 'Depois do líquido (por fora)'}${mp.mes_pagamento ? ` — paga em ${cgEsc(cgMesRot(mp.mes_pagamento))}` : ''}</div>
    <div id="tabelaCgFora" style="overflow-x:auto;"><table><thead><tr><th>Nome</th><th>Líquido da folha</th><th>Acréscimo combinado</th><th>Saldo por fora</th><th>Empréstimo / vale</th><th>Bonificação</th><th>A pagar</th><th>Conferir</th></tr></thead><tbody>`;
  [...new Set(R.map((x) => x.empresa))].forEach((e) => {
    const lin = R.filter((x) => x.empresa === e);
    h += `<tr class="sub"><td colspan="8"><b>${cgEsc(e)}</b></td></tr>`;
    lin.forEach((x) => {
      h += `<tr><td>${cgEsc(cgNome(x.nome))} <span style="font-size:11px;color:var(--tx-5);">${cgEsc(x.unidade || '')}</span></td>
        <td>${v0(x.liquido_folha)}</td>
        <td>${v0(x.acrescimo_combinado)}${x.combinado_tipo ? `<div style="font-size:11px;color:var(--tx-4);white-space:normal;">${x.combinado_tipo === 'TOTAL' ? 'total combinado ' + cgR(x.combinado_valor) : 'acréscimo fixo'}${x.combinado_motivo ? ' — ' + cgEsc(x.combinado_motivo) : ''}</div>` : ''}</td>
        <td>${v0(x.saldo_fora)}</td>
        <td title="${cgEsc(x.desconto_detalhe || '')}">${v0(x.desconto_emprestimo, true)}${x.desconto_detalhe ? `<div style="font-size:11px;color:var(--tx-4);white-space:normal;">${cgEsc(x.desconto_detalhe)}</div>` : ''}</td>
        <td>${v0(x.bonificacao)}</td>
        <td style="font-weight:700;">${x.saiu ? '<span style="font-weight:400;color:var(--tx-4);">saiu: a rescisão paga</span>' : cgR(x.valor_a_pagar)}${(() => {
          if (x.liquido_folha != null) return '';
          if (CARGOS.adtFora === undefined) cgAdtForaCarregar();
          const nm = String(x.nome || '').trim().toUpperCase();
          const f = (CARGOS.adtFora || []).find((y) => String(y.nome || '').trim().toUpperCase() === nm && String(y.mes).slice(0, 10) === comp);
          if (!f) return '';
          return `<div style="font-size:11px;font-weight:400;color:var(--tx-4);">${ffSituacaoTxt(f, 'SALDO')}</div>${f.saldo_pago_em ? `<button type="button" class="preset-btn" style="margin-top:4px;" onclick="ffReciboAbrir(${f.pessoa_id},'${comp}','SALDO')">🧾 Recibo</button>` : ''}`;
        })()}</td>
        <td style="font-size:11.5px;color:var(--farol-perto);white-space:normal;min-width:160px;" title="título de salário no Saipos: ${x.saipos_salario == null ? 'nenhum' : cgR(x.saipos_salario)}">${cgEsc(x.conferir_texto || '')}</td></tr>
`;
    });
    h += tot(`Subtotal ${cgEsc(e)}`, lin, 'sub');
  });
  return h + `</tbody><tfoot>${tot(`Total · ${R.length} ${R.length === 1 ? 'pessoa' : 'pessoas'}`, R, 'liq')}</tfoot></table></div>
    ${totPagina != null ? `<div class="contexto" style="text-align:left;margin-top:10px;"><b>Total a pagar no mês: ${cgR(totPagina)}</b> <span style="color:var(--tx-3);">(a tabela de cima + só por fora)</span></div>` : ''}`;
}
function cgFolhaCombForm(x) {
  const t = x.combinado_tipo || '';
  return `<div style="display:flex;flex-wrap:wrap;gap:8px;align-items:center;padding:8px 10px;border:1px solid var(--line);border-radius:8px;max-width:820px;">
    <b>${cgEsc(cgNome(x.nome))}</b>
    <select id="cgCombTipo" style="padding:6px 8px;background:var(--surface-2);color:var(--tx-1);border:1px solid var(--line);border-radius:6px;">
      <option value="TOTAL"${t === 'TOTAL' ? ' selected' : ''}>valor total combinado (paga a diferença do líquido)</option>
      <option value="ACRESCIMO"${t === 'ACRESCIMO' ? ' selected' : ''}>acréscimo fixo</option></select>
    <input id="cgCombValor" type="number" step="0.01" min="0" value="${x.combinado_valor != null ? cgN(x.combinado_valor) : ''}" placeholder="valor" style="width:120px;padding:6px 8px;background:var(--surface-2);color:var(--tx-1);border:1px solid var(--line);border-radius:6px;">
    <input id="cgCombMotivo" type="text" value="${cgEsc(x.combinado_motivo || '')}" placeholder="motivo" style="flex:1 1 200px;padding:6px 8px;background:var(--surface-2);color:var(--tx-1);border:1px solid var(--line);border-radius:6px;">
    ${cgBotaoPasso('Gravar', `cgFolhaCombSalvar(${x.pessoa_id},false)`)}
    ${t ? cgBotaoPasso('Tirar o combinado', `cgFolhaCombSalvar(${x.pessoa_id},true)`, true) : ''}</div>`;
}
async function cgFolhaCombSalvar(pessoa, tirar) {
  const tipo = tirar ? null : document.getElementById('cgCombTipo').value;
  const vEl = document.getElementById('cgCombValor'), valor = tirar ? null : (vEl && vEl.value !== '' ? Number(vEl.value) : null);
  const motivo = tirar ? null : (document.getElementById('cgCombMotivo').value || '').trim() || null;
  if (!tirar && valor == null) return avisoAcao('atencao', '! Escreva o valor combinado antes de gravar.');
  avisoAcao('atencao', '… gravando o combinado');
  const r = await trRpcSeguro('rh_folha_combinado_salvar', { p_pessoa: pessoa, p_tipo: tipo, p_valor: valor, p_motivo: motivo });
  if (!r.ok) return avisoAcao('erro', `✗ Não gravou: ${await trErroDe(r)}`, () => cgFolhaCombSalvar(pessoa, tirar));
  CARGOS_F.combEd = null;
  CARGOS.comb = new Map((await consultarTudo('rh_folha_combinado?select=*&order=pessoa_id').catch(() => [])).map((c) => [c.pessoa_id, c]));
  if (CARGOS.folha) await cgFolhaCarregar(); else renderModuloCargos();
  avisoAcao('ok', `✓ ${tirar ? 'Combinado tirado' : 'Combinado gravado'}: o valor a pagar já mudou — às ${avisoHora()}.`);
}
async function cgFolhaAbrir(k) {
  CARGOS_F.folhaAberta = CARGOS_F.folhaAberta === k ? null : k; renderModuloCargos();
  const comp = CARGOS_F.folhaComp || [...new Set(CARGOS.folha.emp.map((x) => String(x.competencia).slice(0, 10)))].sort().pop();
  const kk = comp + '|' + k;
  if (!CARGOS_F.folhaAberta || CARGOS.folha.rub[kk] !== undefined) return;
  CARGOS.folha.rub[kk] = null;
  const [empresa, matricula] = k.split('|');
  try { CARGOS.folha.rub[kk] = await consultarTudo(`rh_folha_rubrica?select=*&competencia=eq.${comp}&empresa=eq.${encodeURIComponent(empresa)}&matricula=eq.${encodeURIComponent(matricula)}&order=ordem`); }
  catch (e) { CARGOS.folha.rub[kk] = { erro: e.message }; }
  renderModuloCargos();
}
function cgFolhaRubHtml(x) {
  const kk = String(x.competencia).slice(0, 10) + '|' + x.empresa + '|' + x.matricula, R = CARGOS.folha.rub[kk];
  if (!R) return '<span style="color:var(--tx-4);">Lendo as rubricas…</span>';
  if (R.erro) return `Não consegui ler: ${cgEsc(R.erro)}`;
  return `<div id="tabelaCgFolhaRub" style="overflow-x:auto;max-width:680px;"><table><thead><tr><th>Rubrica</th><th style="text-align:right;">Referência</th><th style="text-align:right;">Provento</th><th style="text-align:right;">Desconto</th></tr></thead><tbody>
    ${R.map((r) => `<tr><td>${cgEsc(r.codigo)} · ${cgEsc(r.rubrica)}</td><td style="text-align:right;color:var(--tx-4);">${cgEsc(r.referencia || '')}</td>
      <td style="text-align:right;color:var(--farol-ok);">${r.tipo === 'P' ? cgR(r.valor) : ''}</td><td style="text-align:right;color:var(--tx-3);">${r.tipo === 'D' ? cgR(r.valor) : ''}</td></tr>`).join('')}
    </tbody><tfoot><tr class="sub"><td colspan="4">Proventos ${cgR(x.proventos)} · descontos ${cgR(x.descontos)} · <b>líquido ${cgR(x.liquido)}</b></td></tr></tfoot></table></div>`;
}

// ---------- GRATIFICAÇÕES SALÃO (05/11/2026, proposta do RH 2026-11-05-rh-gratificacoes-salao.md; regra do dono 29/10) ----------
// Taxa de serviço do salão (26 a 25) − 30% da casa − fixo = parte dos funcionários, dividida igual entre os ativos,
// proporcional aos dias. Só consulta: a conta é do banco e o arquivo da contabilidade sai pelo Envio à contabilidade.
async function cgDezCarregar() {
  CARGOS.dez = null;
  try {
    const [res, pes] = await Promise.all([consultarTudo('vw_rh_dez_por_cento_resumo?select=*&order=competencia.desc,unidade'),
      consultarTudo('vw_rh_dez_por_cento?select=*&order=competencia.desc,unidade,nome,pessoa_id')]);
    CARGOS.dez = { res, pes };
  } catch (e) { CARGOS.dez = { erro: e.message }; }
  if (CARGOS_F.aba === 'dez') renderModuloCargos();
}
function cgAbaDez() {
  const F = CARGOS_F;
  if (CARGOS.dez === undefined) { cgDezCarregar(); return '<div class="contexto">Lendo as gratificações do salão…</div>'; }
  if (CARGOS.dez === null) return '<div class="contexto">Lendo as gratificações do salão…</div>';
  if (CARGOS.dez.erro) return `<div class="contexto" style="text-align:left;border-color:var(--farol-fora);">✗ Não consegui ler as gratificações: ${cgEsc(CARGOS.dez.erro)}
    <button type="button" class="preset-btn" onclick="CARGOS.dez=undefined;renderModuloCargos()">Tentar de novo</button></div>`;
  const { res, pes } = CARGOS.dez, d10 = (v) => String(v || '').slice(0, 10);
  const comps = [...new Set(res.map((x) => d10(x.competencia)))].sort().reverse();
  if (!comps.length) return '<div class="contexto">Nenhuma competência calculada ainda.</div>';
  const fechadas = comps.filter((c) => res.some((x) => d10(x.competencia) === c && x.periodo_fechado));
  const comp = comps.includes(F.dezComp) ? F.dezComp : (fechadas[0] || comps[0]);
  const R = res.filter((x) => d10(x.competencia) === comp && (!F.unidade || x.unidade === F.unidade));
  const P = pes.filter((x) => d10(x.competencia) === comp && (!F.unidade || x.unidade === F.unidade));
  const parcial = R.length && R.every((x) => !x.periodo_fechado);
  let h = `${cgSelPeriodo('Mês', [...comps].sort().map((c) => [c, cgMesRot(c) + (res.some((x) => d10(x.competencia) === c && x.periodo_fechado) ? '' : ' (parcial)')]), comp, "(v) => { CARGOS_F.dezComp = v; renderModuloCargos(); }")}
    ${R[0] ? `<div class="caption-label" style="text-align:left;">Período ${cgData(R[0].periodo_inicio)} a ${cgData(R[0].periodo_fim)}${parcial ? ' — <b>parcial até hoje</b>: a conta muda até o dia 25' : ''}.</div>` : ''}`;
  if (!R.length) return h + '<div class="contexto">Nenhuma unidade com gratificação nesta competência.</div>';
  const linhaEsc = (rot, v, forte, neg) => `<div style="display:flex;justify-content:space-between;gap:12px;${forte ? 'font-weight:700;border-top:1px solid var(--line);padding-top:3px;margin-top:3px;' : ''}"><span>${rot}</span><span>${neg ? '− ' : ''}${cgR(v)}</span></div>`;
  h += `<div class="cards">${R.map((r) => {
    const doGrupo = P.filter((x) => x.unidade === r.unidade), cotas = doGrupo.length ? cgN(doGrupo[0].cotas_do_grupo) : 0;
    const cota = cotas ? cgN(r.parte_funcionarios) / cotas : null;
    return `<div class="card neutral" style="text-align:left;${parcial ? 'opacity:.75;' : ''}">
      <div class="card-lbl">${cgEsc(r.unidade)}${parcial ? ' · parcial' : ''}</div>
      <div style="font-size:12.5px;line-height:1.7;margin-top:4px;">
        ${linhaEsc(`taxa de serviço do salão <span style="color:var(--tx-4);">(${cgN(r.vendas_salao)} vendas, ${cgR0(r.venda_bruta_salao)})</span>`, r.taxa_servico)}
        ${linhaEsc('casa 30%', r.parte_casa, false, true)}
        ${linhaEsc('fixo da casa', r.desconto_fixo, false, true)}
        ${cgN(r.quebra_salao) ? linhaEsc('quebra do salão', r.quebra_salao, false, true) : ''}
        ${linhaEsc('= parte dos funcionários', r.parte_funcionarios, true)}
        ${cota != null ? `<div style="display:flex;justify-content:space-between;gap:12px;"><span>÷ ${cotas.toLocaleString('pt-BR', { maximumFractionDigits: 2 })} cotas = <b>cota cheia</b></span><b>${cgR(cota)}</b></div>` : ''}
      </div></div>`; }).join('')}</div>`;
  if (!P.length) return h + (parcial ? '<div class="contexto">A lista por pessoa sai quando o período fechar (dia 25).</div>' : '');
  h += cgFiltroUnidade(CARGOS.pessoas);
  const unids = [...new Set(P.map((x) => x.unidade))];
  h += `<div id="tabelaCgDez" style="overflow-x:auto;"><table><thead><tr><th>Nome</th><th>Dias</th><th>Valor</th><th>Pago na folha</th><th>Observação</th></tr></thead><tbody>`;
  unids.forEach((u) => {
    const L = P.filter((x) => x.unidade === u).sort((a, b) => (cgN(b.valor) > 0) - (cgN(a.valor) > 0) || String(a.nome || a.apelido).localeCompare(String(b.nome || b.apelido)));
    h += `<tr class="sub"><td colspan="5"><b>${cgEsc(u)}</b></td></tr>`;
    L.forEach((x) => {
      const zero = !cgN(x.valor), frac = cgN(x.fracao) < 1 && cgN(x.dias_periodo);
      const pago = x.pago_na_folha == null ? '<span style="color:var(--tx-5);">–</span>'
        : Math.abs(cgN(x.pago_na_folha) - cgN(x.valor)) < 0.01 ? `<span style="color:var(--farol-ok);">✓ ${cgR(x.pago_na_folha)}</span>`
        : `<span style="color:var(--farol-fora);font-weight:700;">✗ ${cgR(x.pago_na_folha)} (${cgN(x.pago_na_folha) > cgN(x.valor) ? '+' : '−'}${cgR(Math.abs(cgN(x.pago_na_folha) - cgN(x.valor)))})</span>`;
      h += `<tr style="${zero ? 'color:var(--tx-4);' : ''}"><td>${cgEsc(cgNome(x.nome || x.apelido))}</td>
        <td>${frac ? `${cgN(x.dias_trabalhados)}/${cgN(x.dias_periodo)}` : ''}</td>
        <td style="${zero ? '' : 'font-weight:700;'}">${cgR(x.valor)}</td><td>${pago}</td>
        <td style="white-space:normal;font-size:12px;color:var(--tx-3);">${cgEsc(x.observacao || '')}</td></tr>`;
    });
    h += `<tr class="sub"><td colspan="2">Subtotal ${cgEsc(u)}</td><td>${cgR(L.reduce((a, x) => a + cgN(x.valor), 0))}</td><td>${cgR(L.reduce((a, x) => a + cgN(x.pago_na_folha), 0))}</td><td></td></tr>`;
  });
  return h + `</tbody></table></div>`;
}

// ---------- ENVIO À CONTABILIDADE (05/11/2026, proposta do RH de 29/10: contexto/propostas-telas/2026-10-29-rh-fechamento-folha.md) ----------
// Lê vw_rh_fechamento_folha (uma linha por lançamento). Horas da Flash: horas DECIMAIS (ver cgEnvMin). Na tela vira HH:MM e a
// soma é em minutos; o arquivo leva o número cru (× 1000).
const CG_ENV_COLS = [
  ['he100', 'HE 100%', (x) => x.rubrica === '0200'],
  ['he70', 'HE 70%', (x) => x.medida === 'horas' && (x.rubrica === '0205' || x.rubrica === '0209')],
  ['not', 'Ad. noturno', (x) => x.rubrica === '0025'],
  ['falta', 'Faltas', (x) => x.rubrica === '0040'],
  ['atraso', 'Atrasos', (x) => x.rubrica === '8069'],
  ['grat', 'Gratif. salão', (x) => x.medida === 'R$' && (x.rubrica === '0203' || x.rubrica === '0205')],
  ['vt', 'VT do mês', (x) => x.rubrica === '0048'],
  ['adt', 'Adiantamento', (x) => x.rubrica === '0981'],
  // 05/11/2026 (dono): dias de falta sem atestado do ciclo, para o desconto do DSR (datas em `origem`)
  ['dsr', 'Dias de falta p/ DSR', (x) => x.rubrica === 'DSR'],
];
// 05/11/2026 (dono): "os campos que vem da Flash, baixamos de lá, o restante [...] em outro arquivo" — dois blocos
const CG_ENV_FLASH = ['he100', 'he70', 'not', 'falta', 'atraso'], CG_ENV_PAINEL = ['grat', 'vt', 'adt', 'dsr'];
// 05/11/2026 ~16h (RH, CORRIGIDO): as horas da Flash são DECIMAIS — minutos = valor × 60 (7,85 = 7:51; 18,80 = 18:48). A API da
// Flash dá, para o mesmo lançamento, 10.27 e 10:16. A leitura "hora + minutos" (48.99 = 49:39) estava errada.
function cgEnvMin(v) { return Math.round(cgN(v) * 60); }
function cgEnvHM(min) { if (!min) return ''; return Math.floor(min / 60) + ':' + String(min % 60).padStart(2, '0'); }
async function cgEnvioCarregar() {
  CARGOS.envio = null;
  try {
    const [lin, prev] = await Promise.all([consultarTudo('vw_rh_fechamento_folha?select=*&order=competencia.desc,empresa_codigo,matricula,rubrica,medida'),
      // 05/11/2026 (RH): o adiantamento do painel confere com o que a contabilidade descontou na folha (prévia ou fechada)
      consultarTudo('vw_rh_folha_conferencia_pessoa?select=competencia,empresa,matricula,nome,adiantamento&order=competencia,empresa,matricula').catch(() => [])]);
    // 05/11/2026 (RH): "Hellen conferiu" (um por competência) e o dia de cada falta (uma linha por dia)
    const [conf, fdias] = await Promise.all([consultarTudo('rh_fechamento_conferido?select=*&order=competencia').catch(() => []),
      consultarTudo('rh_falta_data?select=competencia,pessoa_id,data&order=competencia,pessoa_id,data').catch(() => [])]);
    CARGOS.envio = { lin, prev, conf, fdias };
  }
  catch (e) { CARGOS.envio = { erro: e.message }; }
  if (CARGOS_F.aba === 'envio') renderModuloCargos();
}
function cgEnvioDoMes() {
  const F = CARGOS_F, L = CARGOS.envio.lin;
  const comps = [...new Set(L.map((x) => String(x.competencia).slice(0, 10)))].sort().reverse();
  // abre no mês mais recente que já tem o txt da Flash (é ele que define o fechamento)
  const comFlash = comps.filter((c) => L.some((x) => String(x.competencia).slice(0, 10) === c && x.medida === 'horas'));
  const comp = comps.includes(F.envioComp) ? F.envioComp : (comFlash[0] || comps[0]);
  const M = L.filter((x) => String(x.competencia).slice(0, 10) === comp && (!F.unidade || x.unidade === F.unidade));
  return { comps, comp, M };
}
function cgEnvioPessoas(M) {
  const P = new Map();
  M.forEach((x) => {
    const k = x.empresa_codigo + '|' + x.matricula;
    if (!P.has(k)) P.set(k, { k, pid: x.pessoa_id, empresa: x.empresa_codigo, matricula: x.matricula, nome: x.nome, unidade: x.unidade, fora: !x.pessoa_id, lin: [] });
    const p = P.get(k); p.lin.push(x);
    const c = CG_ENV_COLS.find(([, , f]) => f(x));
    if (c) p[c[0]] = (p[c[0]] || 0) + (x.medida === 'horas' ? cgEnvMin(x.valor) : cgN(x.valor));
    if (c && c[0] === 'dsr') p.dsrOrigem = x.origem;
    // 05/11/2026 (dono): o 0048 vai à contabilidade como "desconta 5%" (medida %), não em reais — o VT é pago por nós
    if (c && c[0] === 'vt' && x.medida === '%') { p.vt = cgN(x.valor); p.vtPct = true; }
  });
  return [...P.values()].sort((a, b) => String(a.nome).localeCompare(String(b.nome)));
}
function cgEnvVal(k, v, pct) {
  if (!v) return '<span style="color:var(--tx-5);">–</span>';
  if (k === 'vt' && pct) return `${String(v).replace('.', ',')}%`;
  if (k === 'dsr') return `${cgN(v)} ${cgN(v) === 1 ? 'dia' : 'dias'}`;
  return ['grat', 'vt', 'adt'].includes(k) ? cgR(v) : cgEnvHM(v);
}
function cgAbaEnvio() {
  const F = CARGOS_F;
  if (CARGOS.envio === undefined) { cgEnvioCarregar(); return '<div class="contexto">Lendo o fechamento da folha…</div>'; }
  if (CARGOS.envio === null) return '<div class="contexto">Lendo o fechamento da folha…</div>';
  // 05/11/2026: a prévia ainda não abre para o login do painel (o RH está liberando a leitura do adiantamento)
  if (CARGOS.envio.erro && /permission denied/i.test(CARGOS.envio.erro)) return `<div class="contexto" style="text-align:left;border-color:var(--farol-perto);"><b>Envio à contabilidade — o RH está liberando os números deste mês.</b>
    <div style="margin-top:6px;">Assim que liberar, aparecem aqui as horas da Flash, as gratificações, o VT e o adiantamento de cada pessoa, com o arquivo e a planilha para baixar.</div></div>`;
  if (CARGOS.envio.erro) return `<div class="contexto" style="text-align:left;border-color:var(--farol-fora);">✗ Não consegui ler o fechamento da folha: ${cgEsc(CARGOS.envio.erro)}
    <div style="margin-top:6px;"><button type="button" class="preset-btn" onclick="CARGOS.envio=undefined;renderModuloCargos()">Tentar de novo</button></div></div>`;
  const { comps, comp, M } = cgEnvioDoMes();
  if (!comps.length) return '<div class="contexto">Nenhum fechamento no banco ainda: falta carregar o txt da Flash do mês.</div>';
  const emps = [...new Set(M.map((x) => x.empresa_codigo))].sort();
  const ini = new Date(comp + 'T12:00:00'); const de = new Date(ini.getFullYear(), ini.getMonth() - 1, 26), ate = new Date(ini.getFullYear(), ini.getMonth(), 25);
  const tem = (f) => M.some(f);
  const empsFlash = new Set(M.filter((x) => x.medida === 'horas').map((x) => x.empresa_codigo));
  const conf = (CARGOS.envio.conf || []).find((x) => String(x.competencia).slice(0, 10) === comp);
  // Dias das faltas ✓ quando toda pessoa com falta (0040) no arquivo da Flash tem a linha DSR (RH 05/11)
  const PT = cgEnvioPessoas(M), fComF = PT.filter((p) => p.falta).length, fPend = PT.filter((p) => p.falta && !p.dsr).length;
  let h = `<div style="display:flex;flex-wrap:wrap;gap:6px;margin:4px 0 6px;">${comps.slice(0, 6).reverse().map((c) =>
      `<button type="button" class="preset-btn ${c === comp ? 'active' : ''}" onclick="CARGOS_F.envioComp='${c}';CARGOS_F.envioEmp=null;CARGOS_F.envioAberta=null;renderModuloCargos()">${cgMesRot(c)}</button>`).join('')}</div>
    <div class="caption-label" style="text-align:left;">Período ${de.toLocaleDateString('pt-BR')} a ${ate.toLocaleDateString('pt-BR')}.</div>
    ${cgPassos([[`Horas da Flash${empsFlash.size ? ` (${empsFlash.size} ${empsFlash.size === 1 ? 'empresa' : 'empresas'})` : ''}`, empsFlash.size > 0],
                ['Gratificações salão', tem((x) => CG_ENV_COLS[5][2](x))], ['VT', tem((x) => x.rubrica === '0048')], ['Adiantamento', tem((x) => x.rubrica === '0981')],
                [`Dias das faltas${fPend ? ` (faltam ${fPend})` : ''}`, !fPend && (fComF > 0 || empsFlash.size > 0)], [conf ? `Conferido por ${cgEnvQuem(conf.conferido_por)}` : 'Conferido', !!conf, conf ? cgEnvQuando(conf.conferido_em) : '']])}
    <div style="display:flex;flex-wrap:wrap;gap:8px;align-items:center;margin:-4px 0 12px;">${conf
      ? `<span style="font-size:12.5px;color:var(--farol-ok);">✓ Conferido — pode enviar à contabilidade.</span> ${cgBotaoPasso('Desfazer a conferência', `cgEnvioConferir('${comp}',false)`, true)}`
      : cgBotaoPasso('Marcar como conferido', `cgEnvioConferir('${comp}',true)`)}</div>`;
  // um cartão por empresa: clicar filtra a tabela
  h += `<div class="cards">${emps.map((e) => {
      const L = M.filter((x) => x.empresa_codigo === e), P = cgEnvioPessoas(L), ativo = F.envioEmp === e;
      const us = [...new Set(L.map((x) => x.unidade).filter(Boolean))].join(' · ');
      const soma = (k) => P.reduce((a, p) => a + (p[k] || 0), 0);
      return `<div class="card ${ativo ? 'highlight' : 'neutral'}" style="text-align:left;cursor:pointer;" onclick="CARGOS_F.envioEmp=CARGOS_F.envioEmp==='${cgEsc(e)}'?null:'${cgEsc(e)}';CARGOS_F.envioAberta=null;renderModuloCargos()">
        <div class="card-lbl">Empresa ${cgEsc(e)}${us ? ' · ' + cgEsc(us) : ''}${ativo ? ' ✕' : ''}</div>
        <div class="card-val" style="font-size:18px;">${P.length} <span style="font-size:12px;color:var(--tx-4);font-weight:600;">${P.length === 1 ? 'pessoa' : 'pessoas'} · ${L.length} lançamentos</span></div>
        <div class="card-pct" style="line-height:1.6;">horas extras ${cgEnvHM(soma('he100') + soma('he70')) || '–'} · faltas ${cgEnvHM(soma('falta') + soma('atraso')) || '–'}<br>
          gratificações ${cgR0(soma('grat'))} · VT ${P.some((p) => p.vtPct) ? P.filter((p) => p.vt).length + ' com desconto' : cgR0(soma('vt'))} · adiantamento ${cgR0(soma('adt'))}</div></div>`; }).join('')}</div>`;
  h += cgFiltroUnidade(CARGOS.pessoas);
  const P = cgEnvioPessoas(M.filter((x) => !F.envioEmp || x.empresa_codigo === F.envioEmp));
  const fora = P.filter((p) => p.fora).length;
  // adiantamento: o do painel × o que a folha da contabilidade descontou (só quando a folha do mês já voltou)
  const prevC = (CARGOS.envio.prev || []).filter((x) => String(x.competencia).slice(0, 10) === comp
    && (!F.envioEmp || String(x.empresa).split(' ')[0] === F.envioEmp));
  const adtDif = [];
  if (prevC.length) {
    const pm = new Map(P.map((p) => [p.k, p]));
    const prevK = new Map(prevC.map((x) => [String(x.empresa).split(' ')[0] + '|' + x.matricula, x]));
    new Set([...prevK.keys(), ...P.filter((p) => p.adt).map((p) => p.k)]).forEach((k) => {
      const p = pm.get(k), x = prevK.get(k), a = (p && p.adt) || 0, b = cgN(x && x.adiantamento);
      if (F.unidade && !p) return;
      if (Math.abs(a - b) >= 0.01) adtDif.push({ k, nome: (p && p.nome) || (x && x.nome), a, b });
    });
  }
  const adtDifK = new Set(adtDif.map((d) => d.k));
  const avisos = `${fora ? `<div class="contexto" style="text-align:left;border-color:var(--farol-perto);">${fora} ${fora === 1 ? 'matrícula da Flash não está' : 'matrículas da Flash não estão'} no cadastro: conferir antes de enviar.</div>` : ''}
    ${adtDif.length ? `<div class="contexto" style="text-align:left;border-color:var(--farol-perto);"><b>Adiantamento: o painel e a folha da contabilidade não batem em ${adtDif.length} ${adtDif.length === 1 ? 'pessoa' : 'pessoas'}.</b>
      <div style="margin-top:4px;">${adtDif.map((d) => `${cgEsc(cgNome(d.nome))}: painel ${d.a ? cgR(d.a) : 'sem adiantamento'} × contabilidade ${d.b ? cgR(d.b) : 'sem desconto'}`).join('<br>')}</div></div>` : ''}`;
  const tabela = (id, ks) => {
    const C = CG_ENV_COLS.filter(([k]) => ks.includes(k)), Q = P.filter((p) => ks.some((k) => p[k]));
    if (!Q.length) return '<div class="contexto">Nada neste mês.</div>';
    return `<div id="${id}" style="overflow-x:auto;"><table><thead><tr><th>Nome</th><th>Empresa · matr.</th>${C.map(([, r]) => `<th>${r}</th>`).join('')}</tr></thead><tbody>
    ${Q.map((p) => { const ab = F.envioAberta === id + p.k;
      return `<tr style="cursor:pointer;" onclick='CARGOS_F.envioAberta=CARGOS_F.envioAberta===${cgEsc(JSON.stringify(id + p.k))}?null:${cgEsc(JSON.stringify(id + p.k))};renderModuloCargos()'>
        <td>${cgEsc(cgNome(p.nome))} <span style="font-size:11px;color:var(--tx-5);">${cgEsc(p.unidade || '')}</span>${p.fora ? ' <span style="font-size:11px;color:var(--farol-perto);">fora do cadastro</span>' : ''}</td>
        <td style="color:var(--tx-4);">${cgEsc(p.empresa)} · ${cgEsc(p.matricula)}</td>
        ${C.map(([k]) => `<td${k === 'adt' && adtDifK.has(p.k) ? ' style="color:var(--farol-perto);font-weight:700;" title="não bate com a folha da contabilidade"'
          : k === 'dsr' && p.dsrOrigem ? ` title="${cgEsc(p.dsrOrigem)}"` : k === 'falta' && p.falta && !p.dsr ? ' style="color:var(--farol-perto);" title="falta sem a linha de dias para o DSR"' : ''}>${cgEnvVal(k, p[k], p.vtPct)}${k === 'dsr' && p.dsrOrigem ? `<div style="font-size:11px;color:var(--tx-4);white-space:normal;">${cgEsc(String(p.dsrOrigem).replace(/^.*?:\s*/, ''))}</div>` : ''}</td>`).join('')}</tr>
        ${ab ? `<tr><td colspan="${C.length + 2}">${cgEnvioLinhasHtml({ ...p, lin: p.lin.filter((x) => { const c = CG_ENV_COLS.find(([, , f]) => f(x)); return c && ks.includes(c[0]); }) })}</td></tr>` : ''}`; }).join('')}
    </tbody><tfoot><tr class="sub"><td colspan="2">${Q.length} ${Q.length === 1 ? 'pessoa' : 'pessoas'}</td>
      ${C.map(([k]) => { const pct = k === 'vt' && Q.some((p) => p.vtPct), n = Q.filter((p) => p[k]).length;
        return `<td>${pct ? `${n} ${n === 1 ? 'pessoa' : 'pessoas'}` : cgEnvVal(k, Q.reduce((a, p) => a + (p[k] || 0), 0))}</td>`; }).join('')}</tr></tfoot></table></div>`;
  };
  h += avisos + `<div class="section-label" style="margin-top:14px;">1 · Arquivo da Flash — baixar na Flash</div>
    <div class="caption-label" style="text-align:left;line-height:1.7;">Flash › Controle de jornada › Integrações › Domínio › <b>Exportar arquivo</b> › código da empresa (945 / 944 / 413) › Período fechado (mês/ano) ›
      conjunto "Exportação para contabilidade" › Selecionar pessoas: <b>só os registrados da empresa que batem ponto</b>${comp >= '2026-11-01' ? ' › "Exportar apenas funcionários com espelho de ponto FECHADO" = <b>Sim</b>' : ''}.
      Cidadão AV (350) não tem arquivo. O txt baixado é o que vale: a Conferência da folha compara com ele.</div>
    ${tabela('tabelaCgEnvioFlash', CG_ENV_FLASH)}
    <div class="section-label" style="margin-top:18px;">2 · Arquivo do painel — enviar à contabilidade</div>
    <div style="display:flex;flex-wrap:wrap;gap:8px;align-items:center;margin:4px 0 10px;">
      ${cgBotaoPasso('Gerar arquivo para a contabilidade (.xlsx)', 'cgEnvioXlsx()')}
      <span class="caption-label" style="margin:0;">uma aba por empresa: matrícula, nome, rubrica, descrição e valor, com o total por rubrica</span></div>
    ${tabela('tabelaCgEnvioPainel', CG_ENV_PAINEL)}`;
  return h;
}
function cgEnvioLinhasHtml(p) {
  return `<div id="tabelaCgEnvioLin" style="overflow-x:auto;max-width:760px;"><table><thead><tr><th>Rubrica</th><th>Valor</th><th>Na Flash</th><th>De onde vem</th></tr></thead><tbody>
    ${p.lin.map((x) => `<tr><td>${cgEsc(x.rubrica)} · ${cgEsc(x.descricao)}</td>
      <td>${x.medida === 'horas' ? cgEnvHM(cgEnvMin(x.valor)) : cgR(x.valor)}</td>
      <td style="color:var(--tx-4);">${x.medida === 'horas' ? cgEsc(cgN(x.valor).toFixed(2)) : ''}</td>
      <td style="color:var(--tx-4);">${cgEsc(x.origem)}</td></tr>`).join('')}</tbody></table></div>`;
}
// ---- dia de cada falta (rh_falta_data) e "conferido" (rh_fechamento_conferido), do RH em 05/11/2026 ----
function cgEnvDias(comp, pid) { return (CARGOS.envio.fdias || []).filter((x) => String(x.competencia).slice(0, 10) === comp && x.pessoa_id === pid).map((x) => String(x.data).slice(0, 10)).sort(); }
function cgEnvQuem(e) { return cgNome(String(e || '').split('@')[0]) || '–'; }
function cgEnvQuando(t) { if (!t) return ''; const d = new Date(t); return d.toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit' }) + ' ' + d.toLocaleTimeString('pt-BR', { timeZone: 'America/Sao_Paulo', hour: '2-digit', minute: '2-digit' }); }
function cgEnvDiasRot(comp, pid) {
  const n = cgEnvDias(comp, pid).length;
  return n ? `<div style="font-size:11px;color:var(--tx-4);">${n} ${n === 1 ? 'dia' : 'dias'}</div>` : '<div style="font-size:11px;color:var(--farol-perto);">falta o dia</div>';
}
function cgEnvDiasHtml(comp, p) {
  const ds = cgEnvDias(comp, p.pid), ini = new Date(comp + 'T12:00:00');
  const iso = (d) => d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  const de = iso(new Date(ini.getFullYear(), ini.getMonth() - 1, 26)), ate = iso(new Date(ini.getFullYear(), ini.getMonth(), 25));
  return `<div onclick="event.stopPropagation()" style="margin:4px 0 10px;padding:8px 10px;border:1px solid var(--line);border-radius:8px;max-width:760px;">
    <b style="font-size:12.5px;">Dias das faltas</b> <span style="font-size:12px;color:var(--tx-4);">— ${cgEnvHM(p.falta)} de falta na Flash</span>
    <div style="display:flex;flex-wrap:wrap;gap:6px;align-items:center;margin-top:6px;">
      ${ds.map((d) => `<span class="preset-btn" style="cursor:default;">${cgData(d)} <a href="javascript:void(0)" title="tirar este dia" onclick="cgEnvDiasSalvar('${comp}',${p.pid},${cgEsc(JSON.stringify(ds.filter((x) => x !== d)))})" style="color:var(--tx-4);margin-left:4px;">✕</a></span>`).join('') || '<span style="font-size:12px;color:var(--farol-perto);">nenhum dia informado</span>'}
      <input type="date" id="cgEnvDia_${p.pid}" min="${de}" max="${ate}" style="padding:5px 8px;background:var(--surface-2);color:var(--tx-1);border:1px solid var(--line);border-radius:6px;">
      ${cgBotaoPasso('Acrescentar o dia', `cgEnvDiaMais('${comp}',${p.pid})`, true)}</div></div>`;
}
function cgEnvDiaMais(comp, pid) {
  const el = document.getElementById('cgEnvDia_' + pid), d = el && el.value;
  if (!d) return avisoAcao('atencao', '! Escolha o dia da falta no calendário e clique em "Acrescentar o dia".');
  const ds = cgEnvDias(comp, pid);
  if (ds.includes(d)) return avisoAcao('atencao', `! O dia ${cgData(d)} já está na lista.`);
  cgEnvDiasSalvar(comp, pid, ds.concat(d).sort());
}
async function cgEnvDiasSalvar(comp, pid, dias) {
  avisoAcao('atencao', '… gravando os dias da falta');
  const r = await trRpcSeguro('rh_falta_datas_salvar', { p_competencia: comp, p_pessoa_id: pid, p_datas: dias });
  if (!r.ok) return avisoAcao('erro', `✗ Não gravou: ${await trErroDe(r)}`, () => cgEnvDiasSalvar(comp, pid, dias));
  CARGOS.envio.fdias = (CARGOS.envio.fdias || []).filter((x) => !(String(x.competencia).slice(0, 10) === comp && x.pessoa_id === pid))
    .concat(dias.map((d) => ({ competencia: comp, pessoa_id: pid, data: d })));
  renderModuloCargos();
  avisoAcao('ok', `✓ ${dias.length ? `${dias.length} ${dias.length === 1 ? 'dia de falta gravado' : 'dias de falta gravados'}` : 'Dias de falta apagados'} às ${avisoHora()}.`);
}
async function cgEnvioConferir(comp, sim) {
  avisoAcao('atencao', sim ? '… marcando como conferido' : '… desfazendo a conferência');
  const r = await trRpcSeguro('rh_fechamento_conferir', { p_competencia: comp, p_conferido: sim });
  if (!r.ok) return avisoAcao('erro', `✗ Não gravou: ${await trErroDe(r)}`, () => cgEnvioConferir(comp, sim));
  const quando = sim ? await r.json().catch(() => null) : null;
  CARGOS.envio.conf = (CARGOS.envio.conf || []).filter((x) => String(x.competencia).slice(0, 10) !== comp)
    .concat(sim ? [{ competencia: comp, conferido_por: ((typeof rmbSessao === 'function' && rmbSessao()) || {}).email || '', conferido_em: quando || new Date().toISOString() }] : []);
  renderModuloCargos();
  avisoAcao('ok', sim ? `✓ ${cgMesRot(comp)} marcado como conferido às ${avisoHora()}.` : `✓ Conferência de ${cgMesRot(comp)} desfeita às ${avisoHora()}.`);
}
function cgEnvioBaixar(nome, texto, tipo) {
  const url = URL.createObjectURL(new Blob([texto], { type: tipo }));
  const a = document.createElement('a'); a.href = url; a.download = nome; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}
// Layout do txt da Flash (43 caracteres): "10" · matrícula (10) · AAAAMM · rubrica (4) · "11" · valor (10) · empresa (9).
// Horas: o número cru da Flash × 1000. R$: × 100 — é TESTE (dono 29/10 12:59): a contabilidade diz se o Domínio aceita R$ no mesmo arquivo.
function cgEnvioArquivo(emp) {
  try {
    const { comp, M } = cgEnvioDoMes();
    const L = M.filter((x) => x.empresa_codigo === emp && cgN(x.valor));
    if (!L.length) return avisoAcao('atencao', `! A empresa ${emp} não tem lançamento neste mês: nada a gerar.`);
    const am = comp.slice(0, 4) + comp.slice(5, 7), z = (v, n) => String(v).padStart(n, '0');
    const ruins = L.filter((x) => !/^\d+$/.test(String(x.matricula)) || !/^\d{4}$/.test(String(x.rubrica)));
    if (ruins.length) return avisoAcao('erro', `✗ Não gerou: ${ruins.length} lançamento(s) sem matrícula ou rubrica válida (ex.: ${ruins[0].nome}). Corrija o cadastro e tente de novo.`, () => cgEnvioArquivo(emp));
    const txt = L.map((x) => '10' + z(x.matricula, 10) + am + x.rubrica + '11'
      + z(Math.round(cgN(x.valor) * (x.medida === 'horas' ? 1000 : 100)), 10) + z(emp, 9)).join('\r\n') + '\r\n';
    cgEnvioBaixar(`contabilidade-${emp}-${am}-TESTE.txt`, txt, 'text/plain');
    avisoAcao('ok', `✓ Arquivo de TESTE da empresa ${emp} gerado (${L.length} linhas) às ${avisoHora()}. Está na pasta de downloads.`);
  } catch (e) { avisoAcao('erro', `✗ Não gerou o arquivo: ${e.message}.`, () => cgEnvioArquivo(emp)); }
}
// ---- .xlsx montado no navegador (zip sem compressão + SpreadsheetML), sem biblioteca (05/11/2026) ----
function cgCrc32(b) {
  let t = cgCrc32.t; if (!t) { t = cgCrc32.t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } }
  let c = 0xFFFFFFFF; for (let i = 0; i < b.length; i++) c = t[(c ^ b[i]) & 0xFF] ^ (c >>> 8); return (c ^ 0xFFFFFFFF) >>> 0;
}
function cgZip(arquivos) {   // [{nome, texto}] → Blob (método 0 = guardado)
  const enc = new TextEncoder(), partes = [], central = []; let pos = 0;
  const u16 = (v) => [v & 255, (v >>> 8) & 255], u32 = (v) => [v & 255, (v >>> 8) & 255, (v >>> 16) & 255, (v >>> 24) & 255];
  arquivos.forEach((a) => {
    const nome = enc.encode(a.nome), dado = enc.encode(a.texto), crc = cgCrc32(dado);
    const loc = new Uint8Array([...u32(0x04034b50), ...u16(20), ...u16(0x0800), ...u16(0), ...u16(0), ...u16(0x21), ...u32(crc), ...u32(dado.length), ...u32(dado.length), ...u16(nome.length), ...u16(0)]);
    central.push(new Uint8Array([...u32(0x02014b50), ...u16(20), ...u16(20), ...u16(0x0800), ...u16(0), ...u16(0), ...u16(0x21), ...u32(crc), ...u32(dado.length), ...u32(dado.length),
      ...u16(nome.length), ...u16(0), ...u16(0), ...u16(0), ...u16(0), ...u32(0), ...u32(pos)]), nome);
    partes.push(loc, nome, dado); pos += loc.length + nome.length + dado.length;
  });
  const tamC = central.reduce((a, x) => a + x.length, 0);
  const fim = new Uint8Array([...u32(0x06054b50), ...u16(0), ...u16(0), ...u16(arquivos.length), ...u16(arquivos.length), ...u32(tamC), ...u32(pos), ...u16(0)]);
  return new Blob([...partes, ...central, fim], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
}
function cgXlsx(abas) {   // [{nome, linhas: [[valor]]}]; número vira célula numérica, o resto texto
  const x = (v) => String(v == null ? '' : v).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const col = (i) => { let s = ''; i++; while (i) { const m = (i - 1) % 26; s = String.fromCharCode(65 + m) + s; i = Math.floor((i - 1) / 26); } return s; };
  const folha = (L) => `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${L.map((r, i) =>
    `<row r="${i + 1}">${r.map((v, j) => typeof v === 'number' ? `<c r="${col(j)}${i + 1}"><v>${v}</v></c>` : `<c r="${col(j)}${i + 1}" t="inlineStr"><is><t xml:space="preserve">${x(v)}</t></is></c>`).join('')}</row>`).join('')}</sheetData></worksheet>`;
  const nomes = abas.map((a) => x(String(a.nome).replace(/[\\/?*[\]:]/g, ' ').slice(0, 31)));
  return cgZip([
    { nome: '[Content_Types].xml', texto: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>${abas.map((a, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('')}</Types>` },
    { nome: '_rels/.rels', texto: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>` },
    { nome: 'xl/workbook.xml', texto: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>${nomes.map((n, i) => `<sheet name="${n}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join('')}</sheets></workbook>` },
    { nome: 'xl/_rels/workbook.xml.rels', texto: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${abas.map((a, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join('')}</Relationships>` },
    ...abas.map((a, i) => ({ nome: `xl/worksheets/sheet${i + 1}.xml`, texto: folha(a.linhas) })),
  ]);
}
// "Arquivo do painel" para a contabilidade: uma aba por empresa, só as rubricas do painel (gratificação, VT, adiantamento, DSR)
function cgEnvioXlsx() {
  try {
    const { comp, M } = cgEnvioDoMes();
    const ehPainel = (x) => { const c = CG_ENV_COLS.find(([, , f]) => f(x)); return c && CG_ENV_PAINEL.includes(c[0]); };
    const L = M.filter((x) => ehPainel(x) && cgN(x.valor));
    if (!L.length) return avisoAcao('atencao', '! Nada do painel a enviar neste mês (gratificação, VT, adiantamento ou dias de falta).');
    const emps = [...new Set(L.map((x) => x.empresa_codigo))].sort();
    const abas = emps.map((e) => {
      const E = L.filter((x) => x.empresa_codigo === e).sort((a, b) => String(a.nome).localeCompare(String(b.nome)) || String(a.rubrica).localeCompare(String(b.rubrica)));
      const linhas = [[`Empresa ${e} · ${cgMesRot(comp)}`], [], ['Matrícula', 'Nome', 'Rubrica', 'Descrição', 'Valor', 'Observação']];
      E.forEach((x) => linhas.push([String(x.matricula), cgNome(x.nome), String(x.rubrica), x.descricao || '', Math.round(cgN(x.valor) * 100) / 100,
        x.rubrica === 'DSR' ? `${cgN(x.valor)} dia(s) — ${String(x.origem || '').replace(/^.*?:\s*/, '')}` : x.medida === '%' ? '%' : 'R$']));
      linhas.push([], ['Total por rubrica']);
      [...new Set(E.map((x) => x.rubrica))].forEach((r) => { const R = E.filter((x) => x.rubrica === r);
        if (R[0].medida === '%') { linhas.push(['', '', String(r), R[0].descricao || '', R.length, 'pessoas']); return; }
        linhas.push(['', '', String(r), R[0].descricao || '', Math.round(R.reduce((a, x) => a + cgN(x.valor), 0) * 100) / 100, r === 'DSR' ? 'dias' : 'R$']); });
      return { nome: 'Empresa ' + e, linhas };
    });
    const blob = cgXlsx(abas), url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url; a.download = `contabilidade-painel-${comp.slice(0, 7)}.xlsx`; document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
    avisoAcao('ok', `✓ Arquivo gerado às ${avisoHora()} (${emps.length} ${emps.length === 1 ? 'empresa' : 'empresas'}, ${L.length} linhas). Está na pasta de downloads.`);
  } catch (e) { avisoAcao('erro', `✗ Não gerou o arquivo: ${e.message}.`, cgEnvioXlsx); }
}
function cgEnvioPlanilha() {
  try {
    const F = CARGOS_F, { comp, M } = cgEnvioDoMes();
    const L = M.filter((x) => !F.envioEmp || x.empresa_codigo === F.envioEmp);
    if (!L.length) return avisoAcao('atencao', '! Nada a pôr na planilha neste mês.');
    const q = (s) => '"' + String(s == null ? '' : s).replace(/"/g, '""') + '"', br = (v) => cgN(v).toFixed(2).replace('.', ',');
    const cab = ['Competência', 'Empresa', 'Matrícula', 'Nome', 'Unidade', 'Rubrica', 'Descrição', 'Medida', 'Valor (horas em HH:MM)', 'Valor da Flash', 'De onde vem'];
    const lin = L.map((x) => [cgMesRot(comp), x.empresa_codigo, x.matricula, x.nome, x.unidade, x.rubrica, x.descricao, x.medida,
      x.medida === 'horas' ? cgEnvHM(cgEnvMin(x.valor)) : br(x.valor), x.medida === 'horas' ? br(x.valor) : '', x.origem].map(q).join(';'));
    cgEnvioBaixar(`conferencia-folha-${comp.slice(0, 7)}${F.envioEmp ? '-' + F.envioEmp : ''}.csv`, '﻿' + [cab.map(q).join(';')].concat(lin).join('\r\n'), 'text/csv;charset=utf-8');
    avisoAcao('ok', `✓ Planilha de conferência gerada (${L.length} linhas) às ${avisoHora()}. Está na pasta de downloads.`);
  } catch (e) { avisoAcao('erro', `✗ Não gerou a planilha: ${e.message}.`, cgEnvioPlanilha); }
}

// ---------- FÉRIAS (29/10/2026, chat RH) ----------
// Período aquisitivo contado da admissão do registro; prazo de gozo = fim do concessivo (depois dele, dobro). Valor é estimativa:
// (salário + média de HE, ad. noturno, confiança e 10% das folhas no banco) ÷ 30 × dias × 4/3. Programar é na Flash (Hellen).
// situação da vw_rh_ferias (refeita 29/10 a partir da programação da contabilidade): vale o começo do texto
const CG_FER_COR = [['em dobro', 'var(--farol-fora)'], ['obrigatória', 'var(--farol-perto)'], ['pode dar', 'var(--tx-1)'], ['programada', 'var(--farol-ok)'],
                    ['em formação', 'var(--tx-4)'], ['fora do cadastro', 'var(--farol-perto)'], ['saiu', 'var(--tx-4)']];
async function cgFeriasCarregar() {
  CARGOS.ferias = null;
  try {
    const [per, gozo, aPagar] = await Promise.all([consultarTudo('vw_rh_ferias?select=*&order=limite_gozo.nullslast,nome'),
                                           consultarTudo('vw_rh_ferias_gozo?select=*&order=inicio.desc').catch(() => []),
                                           consultarTudo('vw_rh_previsao_a_pagar?select=dia,unidade,valor,confianca&tipo=eq.FERIAS').catch(() => null)]);
    CARGOS.ferias = { per, gozo, aPagar };
  } catch (e) { CARGOS.ferias = { erro: e.message }; }
  if (CARGOS_F.aba === 'ferias') renderModuloCargos();
}
function cgAbaFerias() {
  const F = CARGOS_F;
  if (CARGOS.ferias === undefined) { cgFeriasCarregar(); return '<div class="contexto">Lendo as férias…</div>'; }
  if (CARGOS.ferias === null) return '<div class="contexto">Lendo as férias…</div>';
  if (CARGOS.ferias.erro) return `<div class="contexto">Não consegui ler as férias: ${cgEsc(CARGOS.ferias.erro)}</div>`;
  const { per, gozo } = CARGOS.ferias;
  const sit = (x) => String(x.situacao || '');
  const cor = (s) => (CG_FER_COR.find(([k]) => s.startsWith(k)) || [null, 'var(--tx-3)'])[1];
  const alerta = (x) => /^(em dobro|obrigatória)/.test(sit(x));
  // 30/10/2026: quem precisa começar em menos de 90 dias e não tem nada marcado na Flash
  const perto = (x) => /^pode dar/.test(sit(x)) && !cgN(x.dias_programados) && cgN(x.dias_ate_o_limite) < 90;
  const formacao = (x) => /^em formação/.test(sit(x));
  const marcada = (x) => cgN(x.dias_programados) > 0;
  // quem saiu vai para Rescisões; quem está fora do cadastro vira alerta em Cargos e salários
  const U = per.filter((x) => !/^(saiu|fora do cadastro)/.test(sit(x)) && (!F.unidade || x.unidade === F.unidade));
  const podem = U.filter((x) => /^(pode dar|obrigatória|em dobro)/.test(sit(x)));
  const A = U.filter((x) => alerta(x) || perto(x));
  const dataBase = per.map((x) => x.data_base).filter(Boolean).sort().pop();
  let h = dataBase ? `<h3 style="margin:8px 0;">Programação da contabilidade de ${cgData(dataBase)}</h3>` : '';
  if (A.length) h += `<div class="contexto" style="text-align:left;border-color:${A.some(alerta) ? 'var(--farol-fora)' : 'var(--farol-perto)'};">${A.map((x) =>
      `<div style="color:${alerta(x) ? cor(sit(x)) : 'var(--farol-perto)'};font-weight:700;">${cgEsc(cgNome(x.nome || x.apelido))} — ${cgN(x.dias_a_gozar)} dias — começar até ${cgData(x.limite_gozo)} — ${alerta(x) ? cgEsc(sit(x)) : 'perto do limite'}</div>`).join('')}</div>`;
  else h += `<div class="contexto" style="text-align:left;border-color:var(--farol-ok);"><b style="color:var(--farol-ok);">✓ Nenhuma férias em dobro, obrigatória ou perto do limite agora.</b></div>`;
  const card = (id, rot, L, pe) => `<div class="card neutral" style="cursor:pointer;${F.ferCard === id ? ' outline:2px solid var(--marca-amarelo);' : ''}" onclick="CARGOS_F.ferCard=CARGOS_F.ferCard==='${id}'?null:'${id}';renderModuloCargos()"><div class="card-lbl">${rot}</div><div class="card-val">${L.length}</div><div class="card-pct">${pe}</div></div>`;
  const totalDe = (L) => cgR0(L.reduce((a, x) => a + cgN(x.valor_estimado), 0));
  // 30/10/2026 (dono): marcada na Flash entra como provisão (a aprovar) e vira despesa depois de aprovada
  const ate60 = new Date(Date.now() + 60 * 864e5).toLocaleDateString('sv-SE', { timeZone: 'America/Sao_Paulo' });
  const P60 = CARGOS.ferias.aPagar && CARGOS.ferias.aPagar.filter((x) => String(x.dia) <= ate60 && (!F.unidade || x.unidade === F.unidade));
  const soma60 = (c) => P60.filter((x) => !c || x.confianca === c).reduce((a, x) => a + cgN(x.valor), 0);
  h += `<div class="cards">
      ${card('podem', 'Podem tirar', podem, totalDe(podem))}
      ${card('marcadas', 'Marcadas na Flash', U.filter(marcada), cgR0(U.filter(marcada).reduce((a, x) => a + cgN(x.valor_programado), 0)))}
      ${card('formacao', 'Em formação', U.filter(formacao), `provisão ${totalDe(U.filter(formacao))}`)}
      ${P60 ? `<div class="card neutral"><div class="card-lbl">A pagar em 60 dias</div><div class="card-val">${cgR0(soma60())}</div><div class="card-pct">provisão ${cgR0(soma60('ESTIMATIVA'))} · despesa ${cgR0(soma60('CALCULADO'))}</div></div>` : ''}
    </div>
    ${cgFiltroUnidade(CARGOS.pessoas)}`;
  const vis = F.ferCard === 'podem' ? podem : F.ferCard === 'marcadas' ? U.filter(marcada) : F.ferCard === 'formacao' ? U.filter(formacao) : U.filter((x) => !formacao(x) || marcada(x));
  const goz = (pid) => (gozo || []).filter((g) => g.pessoa_id === pid);
  h += `<div id="tabelaCgFerias" style="overflow-x:auto;"><table><thead><tr><th>Nome</th><th>Loja</th><th>Período aquisitivo</th><th>Limite para começar</th>
      <th style="text-align:right;">Dias a gozar</th><th>Marcado na Flash</th><th style="text-align:right;">Valor estimado</th><th>Situação</th></tr></thead><tbody>
    ${vis.map((x) => { const k = `${x.pessoa_id}|${x.aquisitivo_inicio}`, ab = F.ferAberta === k, G = goz(x.pessoa_id);
      return `<tr style="cursor:pointer;" onclick="CARGOS_F.ferAberta=CARGOS_F.ferAberta==='${k}'?null:'${k}';renderModuloCargos()">
        <td>${cgEsc(cgNome(x.nome || x.apelido))}</td><td>${cgEsc(x.unidade || '')}</td>
        <td>${cgData(x.aquisitivo_inicio)} a ${cgData(x.aquisitivo_fim)}</td><td>${cgData(x.limite_gozo)}</td>
        <td style="text-align:right;">${cgN(x.dias_a_gozar)}${cgN(x.dias_gozados) || cgN(x.faltas) ? ` <span style="font-size:11px;color:var(--tx-4);">de ${cgN(x.dias_direito)}</span>` : ''}</td>
        <td style="font-size:12px;">${cgN(x.dias_programados) ? cgEsc(cgFerMarcado(x)) : '<span style="color:var(--tx-5);">nada</span>'}</td>
        <td style="text-align:right;">${marcada(x) ? cgR(x.valor_programado) : cgN(x.valor_estimado) ? cgR(x.valor_estimado) : '–'}</td>
        <td style="color:${cor(sit(x))};font-weight:700;white-space:normal;">${cgEsc(sit(x))}</td></tr>
        ${ab ? `<tr><td colspan="8"><b>Férias conhecidas de ${cgEsc(cgNome(x.nome || x.apelido))}:</b> ${G.length ? G.map((g) => `${cgData(g.inicio)} a ${cgData(g.fim)} (${cgN(g.dias_quitados)} dias · ${cgEsc(g.origem || '')})`).join(' · ') : 'nenhuma registrada.'}${cgN(x.dias_afastamento) ? ` · afastamento de ${cgN(x.dias_afastamento)} dias estica o limite` : ''}${cgN(x.faltas) ? ` · ${cgN(x.faltas)} faltas reduzem os dias` : ''}${cgFerSimHtml(x)}</td></tr>` : ''}`; }).join('')}
    </tbody></table></div>`;
  return h;
}
// O QUE FAZER HOJE (dono, 02/11/2026): tudo o que está pendente em Pessoas, numa lista só, por urgência. Inclui as Pendências da Flash
// (dono, 30/10/2026 16:14; proposta do chat RH): a Hellen acompanha aqui para entrar o mínimo na Flash; a ação é abrir a Flash ou copiar o PIX; pagar é dela.
async function cgHojeCarregar() {
  CARGOS.hoje = null;
  const ler = (q) => consultarTudo(q).catch((e) => ({ erro: e.message }));
  try {
    const [L, r, calc, fer] = await Promise.all([ler('vw_rh_flash_caixa?select=*&order=faltam_dias.asc.nullslast,parado_dias.desc.nullslast'), trRpcSeguro('rh_flash_caixa_leitura', {}),
      ler('vw_rh_calculos_mes?select=*&order=data_limite'), ler('vw_rh_ferias_alertas?select=*&order=limite_gozo')]);
    if (!r.ok) throw new Error(await trErroDe(r));
    CARGOS.hoje = { L, calc, fer, leitura: (await r.json())[0] || {} };
  } catch (e) { CARGOS.hoje = { erro: e.message }; }
  if (CARGOS_F.aba === 'hoje') renderModuloCargos();
}
function cgFaltamDias(iso) {
  if (!iso) return null;
  const hoje = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' });
  return Math.round((Date.parse(String(iso).slice(0, 10)) - Date.parse(hoje)) / 86400000);
}
function cgFcPrazo(x) {
  const f = x.faltam_dias === null || x.faltam_dias === undefined ? null : Number(x.faltam_dias), p = cgN(x.parado_dias), ferias = x.tipo === 'FERIAS', L = [];
  if (f !== null) {
    const v = ferias ? ['começa', 'começou'] : ['vence', 'venceu'];
    L.push(f === 0 ? `${v[0]} hoje` : f > 0 ? `${v[0]} em ${f} ${f === 1 ? 'dia' : 'dias'}` : `${v[1]} há ${-f} ${f === -1 ? 'dia' : 'dias'}`);
  }
  if (p) L.push(`parado há ${p} ${p === 1 ? 'dia' : 'dias'}`);
  const alerta = (/^FERIAS/.test(x.tipo || '') && f !== null && f <= 15) || p >= 3 || (f !== null && f <= 3);
  return `<span style="${alerta ? 'color:var(--farol-perto);font-weight:700;' : ''}">${L.join(' · ') || '–'}</span>`;
}
function cgHojeItens() {
  const F = CARGOS_F, H = CARGOS.hoje, itens = [];
  // 06/11/2026 (dono): cada linha leva à aba certa — a aba vai por pesAbaPedida (cgEntrarTela lê uma vez)
  const irPara = (tela, r, aba) => `<button type="button" class="preset-btn" onclick="${aba ? `try{sessionStorage.setItem('pesAbaPedida','${aba}')}catch(e){};` : ''}mostrarModulo('${tela}')">${r}</button>`;
  const CALC_ABA = { ADIANTAMENTO: 'adt', DEZ_POR_CENTO: 'dez', VT_VA: 'vtva', BONIFICACAO: 'bonif' };
  const daLoja = (u) => !F.unidade || !u || u === F.unidade;
  // 06/11/2026 (dono: "direcionar para a tela certa dentro da Flash"): a Flash abre na empresa do ?company=; sem ele cai na última usada
  // e a pendência de São Braz aparecia na lista vazia da Água Verde. Com o id do ponto (flash_ponto_id) abre o espelho da própria pessoa.
  const FLASH_EMPRESA = { 'AGUA VERDE': 'rqnYiy_xbQ_tEHSWtt8Xo', 'SÃO BRAZ': 'u7u6gvHUmX6DcouyfNIir', 'SAO BRAZ': 'u7u6gvHUmX6DcouyfNIir', 'AHU': 'dJDYVezbaM-6JxDuDK4aP' };
  const linkFlash = (x) => {
    const emp = FLASH_EMPRESA[String(x.empresa || '').toUpperCase()], q = emp ? `company=${emp}` : '';
    if (x.flash_ponto_id && /^PONTO|^EVENTO/.test(x.tipo || '')) { const r = String(x.referencia || cgHojeIso()).slice(0, 10);
      return `https://hros.flashapp.com.br/time-and-attendance/person-details/${x.flash_ponto_id}/timesheet?month=${Number(r.slice(5, 7))}&year=${r.slice(0, 4)}${q ? '&' + q : ''}`; }
    return x.link_flash ? x.link_flash + (q ? (x.link_flash.includes('?') ? '&' : '?') + q : '') : '';
  };
  const acaoFlash = (x) => {
    const emp = `<div style="font-size:11px;color:var(--tx-4);">${cgEsc(x.empresa || '')}</div>`;
    if (x.grupo === 'Pagar' && x.pix_copia_cola) return `<b>${cgR(x.valor)}</b> <button type="button" class="preset-btn" data-pix="${cgEsc(x.pix_copia_cola)}" onclick="cgFcCopiar(this)">Copiar PIX</button>`;
    return `${x.grupo === 'Pagar' ? `<b>${cgR(x.valor)}</b> ` : ''}${linkFlash(x) ? `<a class="preset-btn" style="text-decoration:none;display:inline-block;" href="${cgEsc(linkFlash(x))}" target="_blank" rel="noopener">Abrir na Flash</a>` : ''}${emp}`;
  };
  if (Array.isArray(H.L)) for (const x of H.L) if (daLoja(x.empresa)) itens.push({ ...x, sub: [x.empresa, x.gestor ? 'gestor: ' + cgNome(x.gestor) : ''].filter(Boolean).join(' · '), acao: acaoFlash(x) });
  for (const i of cgFlashDaLoja(CARGOS.flash)) itens.push({ grupo: 'Corrigir', o_que: 'Flash: ' + (CG_FLASH_TIPO[i.tipo] || i.tipo), nome: i.nome, sub: i.empresa || i.unidade, detalhe: i.o_que_fazer, acao: `<a class="preset-btn" style="text-decoration:none;display:inline-block;" href="https://hros.flashapp.com.br/employees${FLASH_EMPRESA[String(i.empresa || i.unidade || '').toUpperCase()] ? '?company=' + FLASH_EMPRESA[String(i.empresa || i.unidade || '').toUpperCase()] : ''}" target="_blank" rel="noopener">Abrir na Flash</a>` });
  for (const p of CARGOS.pessoas) if (p.ativo && daLoja(p.unidade)) for (const a of cgAlertasCadastro(p)) itens.push({ grupo: 'Cadastro', o_que: 'Cadastro', nome: p.nome, sub: p.unidade, detalhe: a.todo, acao: irPara('cargos', 'Abrir cadastro') });
  for (const a of CARGOS.adm || []) {
    const p = CARGOS.pessoas.find((x) => x.id === a.pessoa_id) || {};
    if (!daLoja(p.unidade)) continue;
    const motivo = [a.flash_situacao === 'ERRO' ? `Flash: ${a.flash_motivo || 'não chegou'}` : '', a.contab_situacao === 'ERRO' ? `Contabilidade: ${a.contab_motivo || 'não chegou'}` : '', a.flash_aviso || ''].filter(Boolean).join(' · ');
    if (motivo) itens.push({ grupo: 'Admissão', o_que: 'Admissão', nome: p.nome, sub: p.unidade, detalhe: motivo, faltam_dias: 0, acao: irPara('cargos', 'Abrir cadastro') });
  }
  // adiantamento não tem marca de envio no banco: depois do prazo não dá para dizer que ficou por fazer
  if (Array.isArray(H.calc)) for (const c of H.calc) {
    const f = cgFaltamDias(c.data_limite);
    if (c.fechado_em || c.enviado_em || f === null || f > 30 || (c.calculo === 'ADIANTAMENTO' && f < 0)) continue;
    itens.push({ grupo: 'Folha', o_que: c.nome, detalhe: c.calculado_em ? `calculado: ${cgN(c.pessoas)} pessoas, ${cgR(c.total)}` : 'ainda não calculado', faltam_dias: f, acao: irPara('pcalc', 'Abrir cálculos', CALC_ABA[c.calculo]) });
  }
  // 05/11/2026: férias já programadas vencem no PAGAMENTO (2 dias antes do início, a mesma data que a mensagem diz),
  // não no primeiro dia — "pagamento até 08/11 vence em 5 dias" contava até 10/11. E "30.00 dias" vira "30 dias".
  if (Array.isArray(H.fer)) for (const x of H.fer) if (daLoja(x.unidade)) {
    // 05/11/2026 (RH): programada vence no PAGAMENTO, que o banco já dá em pagar_ate (dia útil: a sexta 06/11, não o domingo 08/11)
    const prog = x.situacao === 'programada' && (x.pagar_ate || x.limite_gozo);
    const ref = prog ? (x.pagar_ate || new Date(Date.parse(String(x.limite_gozo).slice(0, 10)) - 2 * 86400000).toISOString().slice(0, 10)) : x.limite_gozo;
    itens.push({ grupo: prog ? 'Pagar' : 'Férias', tipo: 'FERIAS_ALERTA', o_que: prog ? 'Pagar as férias' : 'Férias', nome: x.nome, sub: x.unidade, valor: prog ? x.valor_estimado : null,
      detalhe: String(x.mensagem || '').replace(/(\d+)\.00\b/g, '$1'), faltam_dias: cgFaltamDias(ref),
      acao: prog ? `${x.valor_estimado != null ? `<b>cerca de ${cgR(x.valor_estimado)}</b><div style="font-size:11px;color:var(--tx-4);">o valor certo é o do recibo</div>` : ''}${irPara('pferias', 'Abrir férias')}` : irPara('pferias', 'Abrir férias') });
  }
  // 06/11/2026 (dono: "ordenar por ordem de prioridade"): 0 vence hoje ou venceu · 1 parado há 3+ dias ou vence em até 3 ·
  // 2 qualquer parado, férias/pagamento em até 15 dias · 3 o resto (prazo longe, sem prazo); dentro da faixa, o prazo mais perto e depois o mais parado
  const fd = (x) => (x.faltam_dias === null || x.faltam_dias === undefined ? null : Number(x.faltam_dias));
  const faixa = (x) => { const f = fd(x), p = cgN(x.parado_dias);
    if (f !== null && f <= 0) return 0;
    if (p >= 3 || (f !== null && f <= 3)) return 1;
    if (p > 0 || (f !== null && f <= 15 && (x.grupo === 'Pagar' || /FERIAS/.test(x.tipo || '')))) return 2;   // parado é ação de agora
    return 3; };
  return itens.sort((a, b) => faixa(a) - faixa(b) || (fd(a) ?? 999) - (fd(b) ?? 999) || cgN(b.parado_dias) - cgN(a.parado_dias));
}
function cgAbaHoje() {
  const F = CARGOS_F;
  if (CARGOS.hoje === undefined) { cgHojeCarregar(); return '<div class="contexto">Lendo as pendências…</div>'; }
  if (CARGOS.hoje === null) return '<div class="contexto">Lendo as pendências…</div>';
  if (CARGOS.hoje.erro) return `<div class="contexto" style="color:var(--farol-fora);">✗ Não consegui ler as pendências: ${cgEsc(CARGOS.hoje.erro)} <button type="button" class="preset-btn" onclick="cgHojeCarregar()">Tentar de novo</button></div>`;
  const H = CARGOS.hoje;
  const { lido_em: lido, atrasada } = H.leitura;
  // 05/11/2026 (dono, chat RH): "Atualizar na Flash" no TOPO, em destaque, com o "lida em" junto (não mais no rodapé)
  const topoFlash = `<div style="display:flex;flex-wrap:wrap;gap:10px;align-items:center;margin:0 0 12px;">${cgFlashPedidoHtml()}
    <span class="caption-label" style="margin:0;">${lido ? `Flash lida em ${new Date(lido).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }).replace(',', ' às')}` : 'Flash ainda não lida'}</span></div>`;
  const rodape = '';
  // com a leitura atrasada ou uma fonte fora, "nada pendente" não pode ser afirmado
  const falhou = [[H.L, 'a Flash'], [H.calc, 'os cálculos da folha'], [H.fer, 'as férias']].filter(([v]) => v && v.erro).map(([, r]) => r);
  const atraso = (atrasada ? '<div class="contexto" style="text-align:left;border-color:var(--farol-perto);"><b style="color:var(--farol-perto);">Leitura da Flash atrasada: pode faltar pendência nesta lista.</b></div>' : '')
    + (falhou.length ? `<div class="contexto" style="text-align:left;border-color:var(--farol-fora);"><b style="color:var(--farol-fora);">✗ Não consegui ler ${falhou.join(', ')}: pode faltar pendência.</b> <button type="button" class="preset-btn" onclick="cgHojeCarregar()">Tentar de novo</button></div>` : '');
  const T = cgHojeItens();
  if (!T.length) return `${topoFlash}${atraso}${atrasada || falhou.length ? '' : '<div class="contexto" style="text-align:left;border-color:var(--farol-ok);"><b style="color:var(--farol-ok);">✓ Nada pendente em Pessoas.</b></div>'}${rodape}`;
  const de = (g) => T.filter((x) => x.grupo === g);
  const card = (g) => { const n = de(g), pe = g === 'Pagar' ? cgR(n.reduce((a, x) => a + cgN(x.valor), 0)) : ''; return n.length ? `<div class="card neutral" style="cursor:pointer;${F.fcGrupo === g ? ' outline:2px solid var(--marca-amarelo);' : ''}" onclick="CARGOS_F.fcGrupo=CARGOS_F.fcGrupo==='${g}'?null:'${g}';renderModuloCargos()"><div class="card-lbl">${g}</div><div class="card-val">${n.length}</div>${pe ? `<div class="card-pct">${pe}</div>` : ''}</div>` : ''; };
  const vis = F.fcGrupo && de(F.fcGrupo).length ? de(F.fcGrupo) : T;
  return `${topoFlash}${atraso}<div class="cards">${['Aprovar', 'Corrigir', 'Pagar', 'Admissão', 'Cadastro', 'Folha', 'Férias'].map(card).join('')}</div>
    <div id="tabelaCgHoje" style="overflow-x:auto;"><table><thead><tr><th>O quê</th><th>Quem</th><th>Detalhe</th><th>Prazo</th><th>Ação</th></tr></thead><tbody>
    ${vis.map((x) => `<tr><td>${cgEsc(x.o_que || '')}</td>
      <td>${x.nome ? cgEsc(cgNome(x.nome)) : '–'}${x.sub ? `<div style="font-size:11px;color:var(--tx-4);white-space:normal;">${cgEsc(x.sub)}</div>` : ''}</td>
      <td style="white-space:normal;">${cgEsc(x.detalhe || '')}</td><td>${cgFcPrazo(x)}</td><td>${x.acao}</td></tr>`).join('')}
    </tbody></table></div>${rodape}`;
}
// LER A FLASH AGORA (dono 05/11/2026: "se conseguirmos efetivar essas mudanças de forma mais rápida seria uma boa"). O pedido vai
// para rh_flash_leitura_pedido; o robô do mini PC atende em até 5 min. A tela relê o pedido de 30 em 30 s.
let CG_FLASH_PED = null, CG_FLASH_TIMER = null;
const cgHM = (t) => t ? new Date(t).toLocaleTimeString('pt-BR', { timeZone: 'America/Sao_Paulo', hour: '2-digit', minute: '2-digit' }) : '';
function cgFlashPedidoHtml() {
  const P = CG_FLASH_PED;
  if (P && P.estado === 'pedido') return `<span style="color:var(--info);">pedido às ${cgHM(P.em)} — o robô lê em até 5 min</span>`;
  if (P && P.estado === 'falhou') return `<span style="color:var(--farol-fora);">✗ não consegui ler a Flash</span> ${cgBotaoPasso('Tentar de novo', 'cgFlashLerAgora()', true)}`;
  return `${cgBotaoPasso('↻ Atualizar na Flash', 'cgFlashLerAgora()')}${P && P.estado === 'ok' ? ` <span style="color:var(--farol-ok);">✓ Flash lida às ${cgHM(P.em)}</span>` : ''}`;
}
async function cgFlashLerAgora() {
  const r = await trRpcSeguro('rh_flash_ler_agora', {});
  if (!r.ok) return avisoAcao('erro', `✗ Não pedi a leitura: ${await trErroDe(r)}`, cgFlashLerAgora);
  const em = await r.json().catch(() => null);
  CG_FLASH_PED = { estado: 'pedido', em: em || new Date().toISOString() };
  avisoAcao('ok', `✓ Leitura da Flash pedida às ${cgHM(CG_FLASH_PED.em)} — o robô lê em até 5 min; esta tela atualiza sozinha.`);
  renderModuloCargos();
  clearInterval(CG_FLASH_TIMER);
  CG_FLASH_TIMER = setInterval(cgFlashPedidoVer, 30000);
}
async function cgFlashPedidoVer() {
  try {
    const r = await trFetch('rh_flash_leitura_pedido?select=id,pedido_em,atendido_em,resultado&order=id.desc&limit=1');
    if (!r.ok) return;
    const x = (await r.json())[0];
    if (!x || !x.atendido_em) return;
    clearInterval(CG_FLASH_TIMER); CG_FLASH_TIMER = null;
    if (/^FALHOU/i.test(String(x.resultado || ''))) { CG_FLASH_PED = { estado: 'falhou' }; avisoAcao('erro', '✗ Não consegui ler a Flash.', cgFlashLerAgora); renderModuloCargos(); return; }
    CG_FLASH_PED = { estado: 'ok', em: x.atendido_em };
    await cgHojeCarregar();
    avisoAcao('ok', `✓ Flash lida às ${cgHM(x.atendido_em)}: as pendências já estão atualizadas.`);
  } catch (e) {}
}
async function cgFcCopiar(b) {
  try {
    await navigator.clipboard.writeText(b.dataset.pix);
    b.textContent = '✓ copiado';
    avisoAcao('ok', `✓ PIX copiado — às ${avisoHora()}.`);
  } catch (e) { avisoAcao('erro', '✗ Não copiou o PIX. Tente de novo.', () => cgFcCopiar(b)); }
}
// "25/01/27 (20d, a aprovar)" com 30 dias marcados vira "25/01 · 20 dias + 10 vendidos · a aprovar": 30 dias sozinho parece que tira 30
function cgFerMarcado(x) {
  const m = String(x.programado_na_flash || '').match(/^(\d\d\/\d\d)\/\d\d \((\d+)d(?:, *([^)]*))?\)$/);
  if (!m) return `${cgN(x.dias_programados)} dias${x.programado_na_flash ? ' · ' + x.programado_na_flash : ''}`;
  const vendidos = cgN(x.dias_programados) - Number(m[2]);
  return [m[1], `${m[2]} dias${vendidos > 0 ? ` + ${vendidos} vendidos` : ''}`, m[3]].filter(Boolean).join(' · ');
}
// Simulador (30/10/2026): só simula, a conta é da rh_ferias_simular e marcar continua sendo na Flash. A lei não deixa começar nos 2 dias antes de feriado ou folga.
let CG_FER_SIM = null, CG_FER_CAL;
const CG_DOW = ['domingo', 'segunda', 'terça', 'quarta', 'quinta', 'sexta', 'sábado'];
function cgFerSimDe(x) {
  const k = `${x.pessoa_id}|${x.aquisitivo_inicio}`;
  if (!CG_FER_SIM || CG_FER_SIM.k !== k) CG_FER_SIM = { k, pessoa: x.pessoa_id, n: cgN(x.dias_a_gozar) || 30, inicio: '', formato: 'todos', dias: '', res: null, erro: null, lendo: false, seq: 0 };
  return CG_FER_SIM;
}
function cgFerSimHtml(x) {
  const s = cgFerSimDe(x);
  const bt = (f, r) => `<button type="button" class="preset-btn ${s.formato === f ? 'active' : ''}" onclick="cgFerSimCampo('formato','${f}',true)">${r}</button>`;
  const cx = 'padding:6px 8px;border-radius:6px;background:var(--surface-2);color:var(--tx-1);border:1px solid var(--line);font:inherit;font-size:13px;';
  return `<div style="margin-top:10px;white-space:normal;">
      <div style="display:flex;flex-wrap:wrap;gap:8px;align-items:center;"><b>Simular:</b>
        <label style="font-size:12px;">Início <input type="date" style="${cx}" value="${cgEsc(s.inicio)}" onchange="cgFerSimCampo('inicio',this.value)"></label>
        ${bt('todos', `${s.n} dias`)}${s.n === 30 ? bt('venda', '20 + 10 vendidos') : ''}${bt('dividido', 'dividido')}
        ${s.formato === 'dividido' ? `<label style="font-size:12px;">Dias agora <input type="number" min="5" max="${s.n}" style="${cx}width:70px;" value="${cgEsc(s.dias)}" oninput="cgFerSimCampo('dias',this.value)"></label>` : ''}
      </div>
      <div id="cgFerSimRes" style="margin-top:8px;">${cgFerSimResHtml()}</div></div>`;
}
function cgFerSimResHtml() {
  const s = CG_FER_SIM;
  if (!s || !s.inicio) return '<span style="color:var(--tx-4);">Escolha a data de início.</span>';
  if (s.formato === 'dividido' && !Number(s.dias)) return '<span style="color:var(--tx-4);">Informe os dias.</span>';
  if (s.erro) return `<div style="color:var(--farol-fora);">✗ Não calculou: ${cgEsc(s.erro)}</div>`;
  if (!s.res) return '<span style="color:var(--tx-4);">Calculando…</span>';
  const P = s.res.filter((r) => r.tipo === 'provento'), pagar = s.res.find((r) => r.ordem === 10), per = s.res.find((r) => r.ordem === 11);
  const avisos = cgFerSimAvisos();
  if (per && /ATENÇÃO/.test(per.referencia)) avisos.unshift(per.referencia.split('— ATENÇÃO:')[1].trim().replace(/^./, (c) => c.toUpperCase()));
  return `<div style="font-weight:700;">Total ${cgR(P.reduce((a, r) => a + cgN(r.valor), 0))}${pagar ? ` · pagar até ${cgEsc(pagar.referencia.split(' ')[0])}` : ''}</div>
    <div style="font-size:12px;color:var(--tx-3);">${P.map((r) => `${cgEsc(r.verba)} ${cgR(r.valor)}`).join(' · ')}</div>
    ${per ? `<div style="font-size:12px;color:var(--tx-3);">${cgEsc(per.referencia.split(' — ATENÇÃO')[0].replace(/\.00 dias/, ' dias'))}</div>` : ''}
    ${avisos.map((a) => `<div style="color:var(--farol-perto);font-weight:700;">! ${cgEsc(a)}</div>`).join('')}`;
}
function cgFerSimAvisos() {
  const s = CG_FER_SIM, L = [], ini = new Date(s.inicio + 'T12:00:00');
  const iso = (d) => d.toLocaleDateString('en-CA');
  const pagar = new Date(ini); pagar.setDate(ini.getDate() - 2);
  if (iso(pagar) < new Date().toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' })) L.push('O dia de pagar já passou.');
  if (s.formato === 'dividido') { const r = s.n - Number(s.dias); if (r > 0 && r < 5) L.push(`Sobram ${r} dias: cada parte precisa ter ao menos 5.`); }
  if (CG_FER_CAL === undefined) return L;
  if (!CG_FER_CAL) { L.push('Não consegui conferir feriado e folga: confira antes de marcar.'); return L; }
  const dow = CG_FER_CAL.folga.get(s.pessoa);
  for (const n of [1, 2]) {
    const d = new Date(ini); d.setDate(ini.getDate() + n);
    const f = CG_FER_CAL.feriados.get(iso(d));
    if (f) L.push(`Começa a menos de 2 dias de ${f} (${cgData(iso(d))}): a lei não deixa.`);
    if (dow && dow.includes(d.getDay())) L.push(`Começa a menos de 2 dias da folga (${CG_DOW[d.getDay()]}): a lei não deixa.`);
  }
  if (!dow || !dow.length) L.push('A folga desta pessoa não está no sistema: confira antes de marcar.');
  return L;
}
async function cgFerSimCalendario() {
  if (CG_FER_CAL !== undefined) return;
  const hoje = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' });
  try {
    const [fer, r, fixa] = await Promise.all([consultarTudo(`feriados?select=data,nome&data=gte.${hoje}`), trRpcSeguro('rh_folga_semanal', { p_ate: hoje }), consultarTudo('rh_pessoa?select=id,folga_fixa_dow&folga_fixa_dow=not.is.null')]);
    if (!r.ok) throw new Error(await trErroDe(r));
    const folga = new Map((await r.json()).map((x) => [x.pessoa_id, x.folga_dow || []]));
    fixa.forEach((x) => folga.set(x.id, x.folga_fixa_dow));
    CG_FER_CAL = { feriados: new Map(fer.map((x) => [String(x.data).slice(0, 10), x.nome])), folga };
  } catch (e) { CG_FER_CAL = null; }
}
function cgFerSimCampo(c, v, redesenha) {
  const s = CG_FER_SIM; if (!s) return;
  s[c] = v; s.res = null; s.erro = null;
  if (redesenha) renderModuloCargos(); else { const e = document.getElementById('cgFerSimRes'); if (e) e.innerHTML = cgFerSimResHtml(); }
  clearTimeout(cgFerSimCampo._t); cgFerSimCampo._t = setTimeout(cgFerSimCalcular, 300);
}
async function cgFerSimCalcular() {
  const s = CG_FER_SIM; if (!s || !s.inicio) return;
  const dias = s.formato === 'venda' ? 20 : s.formato === 'dividido' ? Number(s.dias) : s.n;
  if (!dias) return;
  const seq = ++s.seq;
  const [r] = await Promise.all([trRpcSeguro('rh_ferias_simular', { p_pessoa: s.pessoa, p_inicio: s.inicio, p_dias: dias, p_vende_terco: s.formato === 'venda' }), cgFerSimCalendario()]);
  if (s !== CG_FER_SIM || seq !== s.seq) return;
  if (r.ok) { s.res = await r.json(); s.erro = null; } else { s.res = null; s.erro = await trErroDe(r); }
  const e = document.getElementById('cgFerSimRes'); if (e) e.innerHTML = cgFerSimResHtml();
}

// ---------- RESCISÕES: SIMULADOR (dono, 30/10/2026 12:40: "ali no simulador vc coloca os parametros que precisa pra fazer o calculo
// mais preciso possível"; proposta do chat RH) ----------
// Pessoa, data, tipo e aviso chamam rh_rescisao_parametros, que preenche o formulário; o campo que a pessoa editou não é sobrescrito
// quando muda a data, o tipo ou o aviso. Cada mudança recalcula em rh_rescisao_calcular e redesenha só o resultado, sem tirar o foco.
const RESC = { pessoa: '', saida: '', tipo: 'sem_justa_causa', aviso: 'trabalhado', a: null, fontes: {}, editados: new Set(), res: null, erro: null, seq: 0 };
const RESC_TIPOS = [['sem_justa_causa', 'Sem justa causa'], ['pedido', 'Pedido de demissão'], ['acordo', 'Acordo'], ['justa_causa', 'Justa causa']];
const RESC_AVISOS = [['trabalhado', 'Trabalhado'], ['indenizado', 'Indenizado'], ['dispensado', 'Dispensado'], ['descontado', 'Descontado']];
// grupo, campos: [chave, rótulo, tipo, em branco]
const RESC_CAMPOS = [
  ['Aviso', [['data_aviso', 'Data do aviso', 'date'], ['reducao', 'Redução no aviso (não muda o valor)', 'reducao'], ['anos_aviso', 'Anos para o aviso', 'num', 'na data do aviso']]],
  ['Salário', [['salario', 'Salário', 'num'], ['adicionais', 'Adicionais', 'num'], ['media_variavel', 'Média variável', 'num'], ['dias_saldo', 'Dias de saldo', 'num'], ['faltas_dias', 'Faltas (dias)', 'num']]],
  ['Férias e 13º', [['ferias_vencidas_dias', 'Férias vencidas (dias)', 'num'], ['avos_ferias', 'Avos de férias', 'num', 'calcula'], ['avos13', 'Avos do 13º', 'num', 'calcula'], ['decimo_pago', '13º já pago', 'num']]],
  ['Descontos', [['adiantamentos', 'Adiantamentos', 'num'], ['descontos', 'Outros descontos', 'num'], ['descontos_motivo', 'Motivo dos descontos', 'txt'], ['pega_vt', 'Desconta VT', 'sim'], ['va_rescisao', 'VA na rescisão', 'num']]],
  ['FGTS', [['saldo_fgts', 'Saldo do FGTS', 'num']]],
];
const RESC_INPUT = 'width:100%;box-sizing:border-box;padding:6px 8px;border-radius:6px;background:var(--surface-2);color:var(--tx-1);border:1px solid var(--line);font:inherit;font-size:13px;';
function cgRescPessoas() {
  const hoje = trHoje(), limite = new Date(Date.now() - 90 * 864e5).toISOString().slice(0, 10);
  return (CARGOS.pessoas || []).filter((p) => (!CARGOS_F.unidade || p.unidade === CARGOS_F.unidade) && (!p.desligamento || String(p.desligamento) >= limite) && (p.desligamento || p.ativo !== false))
    .sort((x, y) => String(cgNome(x.nome)).localeCompare(String(cgNome(y.nome)), 'pt-BR')).map((p) => ({ id: p.id, rot: cgNome(p.nome) + (p.desligamento && String(p.desligamento) <= hoje ? ' (saiu)' : '') }));
}
function cgRescOpcoes(L, v) { return L.map(([k, r]) => `<option value="${k}"${k === v ? ' selected' : ''}>${r}</option>`).join(''); }
function cgAbaResc() {
  if (!RESC.saida) RESC.saida = trHoje();
  let h = `<div class="cards" style="display:grid;grid-template-columns:repeat(auto-fit,minmax(170px,1fr));gap:10px;align-items:end;text-align:left;margin-bottom:12px;">
      <label style="font-size:12px;color:var(--tx-3);">Pessoa<select style="${RESC_INPUT}" onchange="cgRescEscolher('pessoa', this.value)"><option value="">escolha</option>${cgRescPessoas().map((p) => `<option value="${p.id}"${String(p.id) === String(RESC.pessoa) ? ' selected' : ''}>${cgEsc(p.rot)}</option>`).join('')}</select></label>
      <label style="font-size:12px;color:var(--tx-3);">Data da rescisão<input type="date" style="${RESC_INPUT}" value="${cgEsc(RESC.saida)}" onchange="cgRescEscolher('saida', this.value)"></label>
      <label style="font-size:12px;color:var(--tx-3);">Tipo<select style="${RESC_INPUT}" onchange="cgRescEscolher('tipo', this.value)">${cgRescOpcoes(RESC_TIPOS, RESC.tipo)}</select></label>
      <label style="font-size:12px;color:var(--tx-3);">Aviso<select style="${RESC_INPUT}" onchange="cgRescEscolher('aviso', this.value)">${cgRescOpcoes(RESC_AVISOS, RESC.aviso)}</select></label>
    </div>`;
  if (!RESC.pessoa) return h;
  if (!RESC.a) return h + '<div class="contexto">Lendo os dados da pessoa…</div>';
  h += `<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(340px,1fr));gap:18px;align-items:start;">
      <div>${RESC_CAMPOS.map(([g, C]) => `<h4 style="margin:0 0 6px;font-size:13px;">${g}</h4>
        <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:8px;margin-bottom:14px;">${C.map(cgRescCampoHtml).join('')}</div>`).join('')}</div>
      <div id="rescResultado">${cgRescResultadoHtml()}</div></div>`;
  return h;
}
function cgRescCampoHtml([k, rot, tipo, branco]) {
  const a = RESC.a, v = a[k] == null ? '' : a[k];
  const fonte = RESC.editados.has(k) ? 'editado aqui' : (RESC.fontes[k] || '');
  const cor = /^ESTIMADO/.test(fonte) ? 'var(--farol-perto)' : 'var(--tx-4)';
  const muda = `onchange="cgRescCampo('${k}', '${tipo}', this)"`;
  const campo = tipo === 'sim' ? `<select style="${RESC_INPUT}" ${muda}><option value="1"${a[k] ? ' selected' : ''}>Sim</option><option value="0"${a[k] ? '' : ' selected'}>Não</option></select>`
    : tipo === 'reducao' ? `<select style="${RESC_INPUT}" ${muda}>${cgRescOpcoes([['', 'Nenhuma'], ['2_horas', '2 horas por dia'], ['7_dias', '7 dias corridos']], String(v))}</select>`
    : `<input style="${RESC_INPUT}" type="${tipo === 'date' ? 'date' : tipo === 'num' ? 'number' : 'text'}"${tipo === 'num' ? ' step="0.01" min="0"' : ''} value="${cgEsc(v)}"${branco ? ` placeholder="${cgEsc(branco)}"` : ''} ${muda}>`;
  return `<label style="font-size:12px;color:var(--tx-3);display:block;">${rot}${campo}${fonte ? `<div style="font-size:10.5px;line-height:1.25;margin-top:2px;color:${cor};">${cgEsc(fonte)}</div>` : ''}</label>`;
}
function cgRescTotais() {
  const L = RESC.res || [], soma = (f) => L.filter(f).reduce((s, x) => s + cgN(x.valor), 0);
  const liquido = soma((x) => Number(x.ordem) === 90), guia = soma((x) => x.tipo === 'guia');
  return { liquido, guia, total: liquido + guia };
}
function cgRescDataFluxo() { const d = new Date(RESC.saida + 'T12:00:00'); d.setDate(d.getDate() + 10); return d.toISOString().slice(0, 10); }
function cgRescResultadoHtml() {
  if (RESC.erro) return `<div class="contexto" style="color:var(--farol-fora);">✗ Não calculou: ${cgEsc(RESC.erro)}</div>`;
  if (!RESC.res) return '<div class="contexto">Calculando…</div>';
  const T = cgRescTotais(), ver = RESC.res.filter((x) => Number(x.ordem) !== 90 && x.tipo !== 'informativo'), base = RESC.res.filter((x) => Number(x.ordem) !== 90 && x.tipo === 'informativo');
  const cor = (x) => x.tipo === 'desconto' ? 'var(--farol-fora)' : x.tipo === 'guia' ? 'var(--tx-3)' : 'var(--tx-1)';
  return `<div class="cards" style="margin-top:0;">
      <div class="card neutral"><div class="card-lbl">Líquido</div><div class="card-val">${cgR0(T.liquido)}</div></div>
      <div class="card neutral"><div class="card-lbl">Guia do FGTS</div><div class="card-val">${cgR0(T.guia)}</div></div>
      <div class="card blue"><div class="card-lbl">Custo total</div><div class="card-val">${cgR0(T.total)}</div></div></div>
    <div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap;margin:0 0 10px;">${cgBotaoPasso(`Levar ao fluxo · ${cgR(T.total)} em ${cgData(cgRescDataFluxo())}`, 'cgRescFluxo()')}</div>
    <div id="tabelaRescVerbas"><table><thead><tr><th>Verba</th><th>Referência</th><th style="text-align:right;">Valor</th></tr></thead><tbody>
      ${ver.map((x) => `<tr><td style="white-space:normal;">${cgEsc(x.verba)}</td><td>${cgEsc(x.referencia || '')}</td><td style="text-align:right;color:${cor(x)};">${x.tipo === 'desconto' ? '− ' : ''}${cgR(x.valor)}</td></tr>`).join('')}
      ${base.map((x) => `<tr><td colspan="2" style="white-space:normal;color:var(--tx-4);">${cgEsc(x.verba)}${x.referencia ? ' · ' + cgEsc(x.referencia) : ''}</td><td style="text-align:right;color:var(--tx-4);">${cgR(x.valor)}</td></tr>`).join('')}
    </tbody><tfoot><tr class="sub"><td colspan="2">Líquido</td><td style="text-align:right;">${cgR(T.liquido)}</td></tr></tfoot></table></div>
    <div class="caption-label" style="text-align:left;margin-top:6px;">Estimativa. O valor oficial é o da contabilidade (TRCT).</div>`;
}
function cgRescEscolher(campo, valor) {
  RESC[campo] = valor;
  if (campo === 'pessoa') { RESC.a = null; RESC.res = null; RESC.erro = null; RESC.editados = new Set(); RESC.fontes = {}; }
  cgRescParametros();
}
async function cgRescParametros() {
  const seq = ++RESC.seq;
  if (!RESC.pessoa || !RESC.saida) { renderModuloCargos(); return; }
  if (!RESC.a) renderModuloCargos();
  const r = await trRpcSeguro('rh_rescisao_parametros', { p_pessoa: Number(RESC.pessoa), p_saida: RESC.saida, p_tipo: RESC.tipo, p_aviso: RESC.aviso });
  if (seq !== RESC.seq) return;
  if (!r.ok) { avisoAcao('erro', `✗ Não consegui ler os dados da pessoa: ${await trErroDe(r)}.`, cgRescParametros); return; }
  const p = await r.json();
  const a = RESC.a || {};
  Object.keys(p).forEach((k) => { if (k !== 'fontes' && !RESC.editados.has(k)) a[k] = p[k]; });
  RESC.a = a; RESC.fontes = p.fontes || {};
  avisoAcao(null);
  renderModuloCargos();
  cgRescCalcular();
}
function cgRescCampo(k, tipo, el) {
  const v = el.value;
  RESC.a[k] = tipo === 'sim' ? v === '1' : v === '' ? null : tipo === 'num' ? Number(v) : v;
  RESC.editados.add(k);
  const f = el.parentElement.querySelector('div');
  if (f) { f.textContent = 'editado aqui'; f.style.color = 'var(--tx-4)'; }
  cgRescCalcular();
}
async function cgRescCalcular() {
  const seq = ++RESC.seq;
  const r = await trRpcSeguro('rh_rescisao_calcular', { p_pessoa: Number(RESC.pessoa), a: RESC.a });
  if (seq !== RESC.seq) return;
  if (r.ok) { RESC.res = await r.json(); RESC.erro = null; }
  else { RESC.res = null; RESC.erro = await trErroDe(r); }
  const c = document.getElementById('rescResultado');
  if (c) c.innerHTML = cgRescResultadoHtml();
}
async function cgRescFluxo() {
  const T = cgRescTotais(), data = cgRescDataFluxo();
  if (T.total <= 0) return avisoAcao('atencao', '! Sem valor para levar ao fluxo.');
  const pes = cgRescPessoas().find((p) => String(p.id) === String(RESC.pessoa)) || {};
  avisoAcao('enviando', 'Levando ao fluxo…');
  const r = await trRpcSeguro('rh_previsao_gravar', { p_tipo: 'RESCISAO', p_pessoa: Number(RESC.pessoa), p_data: data, p_valor: T.total,
    p_obs: `VALOR SIMULADO: líquido ${cgR(T.liquido)} + guia ${cgR(T.guia)}; rescisão em ${cgData(RESC.saida)}` });
  if (!r.ok) return avisoAcao('erro', `✗ NÃO foi ao fluxo: ${await trErroDe(r)}.`, cgRescFluxo);
  avisoAcao('ok', `✓ ${pes.rot || 'Rescisão'}: ${cgR(T.total)} no fluxo em ${cgData(data)} — às ${avisoHora()}.`);
}

// ---------- ADIANTAMENTO DO DIA 20 ----------
function cgAbaAdt() {
  const F = CARGOS_F;
  const meses = [...new Set(CARGOS.adt.map((a) => String(a.mes).slice(0, 10)))];
  const atual = cgMesIso(0), prox = cgMesIso(1);
  for (const m of [prox, atual]) if (!meses.includes(m)) meses.push(m);
  meses.sort().reverse();
  // abre no próximo vencimento: o do mês, até o dia 20; depois, o do mês que vem
  const proxVenc = new Date().getDate() <= 20 ? atual : prox;
  const mes = meses.includes(F.mesAdt) ? F.mesAdt : proxVenc;
  const linhas = CARGOS.adt.filter((a) => String(a.mes).slice(0, 10) === mes && (!F.unidade || a.unidade === F.unidade));
  // 05/11/2026 (dono): quem é por fora entra NA MESMA lista, marcado "por fora", e soma no total que a Hellen paga
  if (CARGOS.adtFora === undefined) cgAdtForaCarregar();
  const fora = (CARGOS.adtFora || []).filter((x) => String(x.mes).slice(0, 10) === mes && cgN(x.adiantamento) > 0 && (!F.unidade || x.unidade === F.unidade));
  const tot = linhas.reduce((s, a) => s + cgN(a.valor), 0) + fora.reduce((s, x) => s + cgN(x.adiantamento), 0);
  const enviado = linhas.find((a) => a.enviado_em);
  const dia = (linhas[0] && linhas[0].dia_pagamento) || (mes.slice(0, 8) + '20');
  const pago = cgHojeIso() > String(dia).slice(0, 10);
  const travado = !!enviado || pago;
  let h = `${cgSelPeriodo('Mês', [...meses].sort().map((m) => [m, cgMesRot(m)]), mes, "(v) => { CARGOS_F.mesAdt = v; renderModuloCargos(); }")}
    <h3 style="margin:8px 0 0;">Adiantamento de ${cgMesRot(mes)} · paga ${cgData(dia)}</h3>
    ${cgPassos([['calculado', linhas.length > 0], ['enviado ao RH', !!enviado, enviado ? cgDiaMes(enviado.enviado_em) : ''], ['pago', pago, cgDiaMes(dia)]])}
    <div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap;margin-bottom:12px;">
      ${travado ? '' : cgBotaoPasso(linhas.length ? 'Recalcular' : 'Calcular', `cgAdtGerar('${mes}')`, linhas.length > 0)}
    </div>
    <div class="cards" style="max-width:520px;">
      <div class="card neutral"><div class="card-lbl">Total</div><div class="card-val">${cgR0(tot)}</div></div>
      <div class="card neutral"><div class="card-lbl">Pessoas</div><div class="card-val">${linhas.length + fora.length}</div>${fora.length ? `<div class="card-pct">${fora.length} por fora</div>` : ''}</div>
    </div>`;
  if (!linhas.length && !fora.length) return h;
  h += `<div id="tabelaCgAdt"><table>
    <thead><tr><th>Loja</th><th>Nome</th><th>Cargo</th><th style="text-align:right;">Salário</th><th style="text-align:right;">Dias</th><th style="text-align:right;">Adiantamento</th></tr></thead>
    <tbody>${linhas.map((a) => `<tr>
      <td>${cgEsc(a.unidade)}</td><td>${cgEsc(cgNome(a.nome))}${a.editado ? ` <div style="font-size:11px;color:var(--farol-perto);white-space:normal;">ajustado${a.motivo ? ': ' + cgEsc(a.motivo) : ''}</div>` : ''}</td>
      <td>${cgEsc(cgNome(a.cargo))}</td><td style="text-align:right;">${cgR(a.salario)}</td><td style="text-align:right;">${a.dias}/30</td>
      <td style="text-align:right;font-weight:600;">${cgR(a.valor)}</td></tr>`).join('')}
    ${fora.map((x) => `<tr><td>${cgEsc(x.unidade || '')}</td><td>${cgEsc(cgNome(x.nome))} <span title="sem registro: sai da conta ${cgEsc(x.conta || '')}, não pela folha" style="font-size:11px;font-weight:700;border:1px solid var(--line-2);border-radius:999px;padding:1px 7px;color:var(--tx-2);">por fora</span>
        <div style="font-size:11px;color:var(--tx-4);">${ffSituacaoTxt(x, 'ADIANTAMENTO')}</div></td>
      <td>–</td><td style="text-align:right;">${cgR(x.salario)}</td><td style="text-align:right;">${x.dias != null ? x.dias + '/30' : ''}</td>
      <td style="text-align:right;font-weight:600;">${cgR(x.adiantamento)}${x.adiantamento_pago_em ? ` <button type="button" class="preset-btn" style="margin-left:6px;" onclick="ffReciboAbrir(${x.pessoa_id},'${String(x.mes).slice(0, 10)}','ADIANTAMENTO')">🧾 Recibo</button>` : ''}</td></tr>`).join('')}</tbody>
    <tfoot><tr class="sub"><td colspan="5">Total${fora.length ? ' (com quem é por fora)' : ''}</td><td style="text-align:right;">${cgR(tot)}</td></tr></tfoot>
  </table></div>`;
  return h;
}
async function cgAdtForaCarregar() {
  CARGOS.adtFora = null;
  try {
    const [m, p, d, b] = await Promise.all([consultarTudo('vw_rh_ff_meses?select=pessoa_id,mes,salario,dias,gratificacao_fixa,gratificacao_salao,ajuste,ajuste_motivo,desconto_consumo,vale_transporte,desconto_divida,desconto_divida_motivo,adiantamento,vence_adiantamento,adiantamento_pago_em,adiantamento_pago,saldo,vence_saldo,saldo_pago_em,saldo_pago,futuro&order=pessoa_id,mes'),
      consultarTudo('rh_ff_pessoas?select=id,nome,unidade,conta&order=id'),
      consultarTudo('vw_rh_a_descontar?select=mes,data_desconto,colaborador,descricao,credor,parcela,parcelas_no_plano,valor,chave&order=data_desconto.asc,chave').catch(() => []),
      consultarTudo('vw_rh_pagamento_mes?select=competencia,nome,pessoa_id,bonificacao,valor_a_pagar&liquido_folha=is.null&order=competencia,nome,pessoa_id').catch(() => [])]);
    CARGOS.ffPag = b || [];
    CARGOS.adtFora = m.map((x) => { const q = p.find((y) => y.id === x.pessoa_id) || {}; return { ...x, nome: q.nome, unidade: q.unidade, conta: q.conta }; });
    CARGOS.ffDescontar = d || [];
  } catch (e) { CARGOS.adtFora = []; }
  if (['adt', 'folha', 'ffcalc'].includes(CARGOS_F.aba)) renderModuloCargos();
}
// situação da parcela por fora: a baixa é do robô (rh_ff_baixa_automatica, mesmo com diferença — dono 05/11)
function ffSituacaoTxt(x, parcela) {
  const ad = parcela === 'ADIANTAMENTO', em = ad ? x.adiantamento_pago_em : x.saldo_pago_em;
  const valor = cgN(ad ? x.adiantamento : x.saldo), pago = ad ? x.adiantamento_pago : x.saldo_pago;
  if (!em) return 'vence ' + cgData(ad ? x.vence_adiantamento : x.vence_saldo);
  const dif = pago != null ? Math.round((cgN(pago) - valor) * 100) / 100 : 0;
  return `<span style="color:var(--farol-ok);">✓ pago em ${cgData(em)} (Saipos)</span>${Math.abs(dif) >= 0.01 ? ` <span style="color:var(--farol-perto);">pago ${cgR(pago)}, diferença ${cgR(dif)}</span>` : ''}`;
}
// o Recibo abre das linhas onde a Hellen paga (Adiantamento e Conferência); usa o mesmo gerador (ffRecibo)
async function ffReciboAbrir(pessoaId, mes, parcela) {
  try {
    if (!FF || !FF.meses.some((m) => m.pessoa_id === pessoaId && m.mes === mes)) {
      avisoAcao('enviando', 'Montando o recibo…');
      const [pp, mm] = await Promise.all([consultarTudo('rh_ff_pessoas?select=*&order=id'), consultarTudo('vw_rh_ff_meses?select=*&order=pessoa_id,mes')]);
      FF = { pessoas: pp, meses: mm, saipos: [], lancado: null, editando: null };
    }
    if (!FF.meses.some((m) => m.pessoa_id === pessoaId && m.mes === mes)) throw new Error('não achei a parcela de ' + cgMesRot(mes));
    ffRecibo(pessoaId, mes, parcela);
    avisoAcao('ok', `✓ Recibo aberto às ${avisoHora()} — imprima ou salve em PDF.`);
  } catch (e) { avisoAcao('erro', '✗ Não consegui abrir o recibo: ' + e.message, () => ffReciboAbrir(pessoaId, mes, parcela)); }
}
async function cgAdtGerar(mes) {
  avisoAcao('enviando', 'Gravando…');
  const r = await trRpcSeguro('rh_adiantamento_gerar', { p_mes: mes });
  if (!r.ok) { cgAviso('Não deu: ' + await trErroDe(r), false); return; }
  CARGOS_F.mes = mes; await cgRecarregar('Lista montada pelo cadastro.');
}

// ---------- BONIFICAÇÃO TRIMESTRAL (vw_rh_bonificacao_ciclo; proposta da frente RH, 19/10/2026) ----------
// Dono, 19/10: "sempre atualizadas com a lista da última folha ... 600 (200 de cada mês) ... lançar pelo valor cheio
// de cada mês trabalhado"; 22/08: proporcional no mês em que a pessoa entra. A conta é toda do banco
// (script/sql/rh_bonificacao.sql); a tela só soma. As horas de falta da Flash aparecem para conferir — ainda não descontam.
function cargosCiclo(c) { CARGOS_F.ciclo = c; CARGOS_F.bonifCel = null; renderModuloCargos(); }

// ---------- BONIFICAÇÃO MÊS A MÊS (05/11/2026, proposta do RH 2026-11-05-rh-bonificacao-mes-a-mes.md) ----------
// O modelo é a aba "Bonificacoes" da planilha de pagamento do dono: por empresa, uma linha por pessoa, os 3 meses (26 a 25)
// e o total; cada célula pintada pelo motivo. Desde 05/11 (dono) conta por MÊS FECHADO (1º ao último dia). Fonte vw_rh_bonificacao_mes; ajuste por rh_bonificacao_ajustar.
// Enquanto a view não existir no banco, a aba segue com a tela do ciclo (cgAbaBonifCiclo).
const CG_BON_COR = {
  FORA_REGISTRO: ['var(--bonif-fora)', 'Fora do período de registro (admitido no mês: proporcional)'],
  FALTA_ATESTADO: ['var(--bonif-falta)', 'Perda por falta ou atestado'],
  FERIAS: ['var(--bonif-ferias)', 'Férias'],
  ADVERTENCIA: ['var(--bonif-adv)', 'Advertência ou suspensão'],
  AJUSTE: ['var(--bonif-ajuste)', 'Zerado pelo gestor (azul claro)'],
};
async function cgBonifMesCarregar() {
  CARGOS.bonifMes = null;
  try { CARGOS.bonifMes = { lin: await consultarTudo('vw_rh_bonificacao_mes?select=*&order=pagamento,empresa,nome,n') }; }
  catch (e) { CARGOS.bonifMes = { erro: e.message }; }
  if (CARGOS_F.aba === 'bonif') renderModuloCargos();
}
function cgAbaBonif() {
  if (CARGOS.bonifMes === undefined) { cgBonifMesCarregar(); return '<div class="contexto">Lendo a bonificação…</div>'; }
  if (CARGOS.bonifMes === null) return '<div class="contexto">Lendo a bonificação…</div>';
  if (CARGOS.bonifMes.erro || !CARGOS.bonifMes.lin.length) return cgAbaBonifCiclo();
  const F = CARGOS_F, L = CARGOS.bonifMes.lin, hoje = trHoje(), d10 = (v) => String(v || '').slice(0, 10);
  const pags = [...new Set(L.map((x) => d10(x.pagamento)))].sort();
  const pag = pags.includes(F.bonifPag) ? F.bonifPag : (pags.find((p) => p >= hoje) || pags[pags.length - 1]);
  const doPag = L.filter((x) => d10(x.pagamento) === pag && (!F.unidade || !x.unidade || x.unidade === F.unidade));
  const meses = [1, 2, 3].map((n) => doPag.find((x) => Number(x.n) === n)).filter(Boolean);
  const mesRot = (x) => new Date(d10(x.mes) + 'T12:00:00').toLocaleDateString('pt-BR', { month: 'short' }).replace('.', '').toUpperCase();
  const pk = (x) => String(x.pessoa_id != null ? x.pessoa_id : x.nome);
  const emps = [...new Set(doPag.map((x) => x.empresa))];
  const soma = (arr) => arr.reduce((a, x) => a + cgN(x.valor), 0);
  // com MANTER a view devolve cor nula: a cor original sai do motivo, com a marca "mantido" (RH 05/11)
  const corDoMotivo = (m) => /ADVERTENCIA|SUSPENSAO/.test(m || '') ? 'ADVERTENCIA' : /FALTA|ATESTADO/.test(m || '') ? 'FALTA_ATESTADO' : /FERIAS/.test(m || '') ? 'FERIAS' : null;
  const corDe = (x) => x.ajuste === 'ZERAR' ? 'AJUSTE' : x.ajuste === 'MANTER' ? corDoMotivo(x.motivo) : x.cor;
  const cel = (x) => {
    if (!x) return '<td style="color:var(--tx-5);">–</td>';
    const c = CG_BON_COR[corDe(x)], k = pk(x) + '|' + x.n, sel = F.bonifCel === k;
    const est = c ? `background:${c[0]};color:var(--bg);` : '';
    const tit = x.ajuste === 'ZERAR' ? `zerado por ${String(x.ajuste_por || '').split('@')[0] || 'gestor'}${x.ajuste_motivo ? ': ' + x.ajuste_motivo : ''}${x.motivo ? ' · ' + x.motivo : ''}` : (x.motivo || '');
    return `<td title="${cgEsc(tit)}" style="cursor:pointer;${est}${sel ? 'outline:2px solid var(--brand);outline-offset:-2px;' : ''}" onclick="CARGOS_F.bonifCel=CARGOS_F.bonifCel==='${cgEsc(k)}'?null:'${cgEsc(k)}';renderModuloCargos()">${cgR(x.valor)}${x.ajuste === 'MANTER' ? ' <span style="font-size:10.5px;font-weight:700;">mantido</span>' : ''}</td>`;
  };
  const triRot = (p) => { const M = [1, 2, 3].map((n) => L.find((x) => d10(x.pagamento) === p && Number(x.n) === n)).filter(Boolean);
    return `paga ${cgData(p)}${M.length ? ` · ${M.map((m) => mesRot(m)).join(', ')}` : ''}`; };
  let h = `${cgSelPeriodo('Trimestre', pags.map((p) => [p, triRot(p)]), pag, "(v) => { CARGOS_F.bonifPag = v; CARGOS_F.bonifCel = null; renderModuloCargos(); }")}
    <div class="cards">${emps.map((e) => { const l = doPag.filter((x) => x.empresa === e); const np = new Set(l.map(pk)).size;
      return `<div class="card neutral"><div class="card-lbl">${cgEsc(cgEmpresaCurta(e))}</div><div class="card-val">${cgR0(soma(l))}</div><div class="card-pct">${np} ${np === 1 ? 'pessoa' : 'pessoas'}</div></div>`; }).join('')}
      <div class="card blue"><div class="card-lbl">Total geral</div><div class="card-val">${cgR0(soma(doPag))}</div><div class="card-pct">paga ${cgData(pag)}</div></div></div>
    ${cgFiltroUnidade(CARGOS.pessoas)}
    <div id="tabelaCgBonifMes" style="overflow-x:auto;"><table><thead><tr><th>Nome</th>
      ${meses.map((m) => `<th>${mesRot(m)} <span style="font-weight:400;color:var(--tx-4);">${cgDiaMes(d10(m.periodo_ini))}–${cgDiaMes(d10(m.periodo_fim))}</span></th>`).join('')}<th>Total</th></tr></thead><tbody>`;
  emps.forEach((e) => {
    const l = doPag.filter((x) => x.empresa === e), ps = [...new Set(l.map(pk))];
    h += `<tr class="sub"><td colspan="${meses.length + 2}"><b>${cgEsc(cgEmpresaCurta(e))}</b></td></tr>`;
    ps.forEach((p) => {
      const lp = l.filter((x) => pk(x) === p);
      h += `<tr><td>${cgEsc(cgNome(lp[0].nome))}</td>${meses.map((m) => cel(lp.find((x) => Number(x.n) === Number(m.n)))).join('')}<td style="font-weight:700;">${cgR(soma(lp))}</td></tr>`;
      const aberta = lp.find((x) => F.bonifCel === pk(x) + '|' + x.n);
      if (aberta) h += `<tr><td colspan="${meses.length + 2}">${cgBonifDetalhe(aberta)}</td></tr>`;
    });
    h += `<tr class="sub"><td>Subtotal ${cgEsc(cgEmpresaCurta(e))}</td>${meses.map((m) => `<td>${cgR(soma(l.filter((x) => Number(x.n) === Number(m.n))))}</td>`).join('')}<td>${cgR(soma(l))}</td></tr>`;
  });
  h += `</tbody><tfoot><tr class="liq"><td>Total geral</td>${meses.map((m) => `<td>${cgR(soma(doPag.filter((x) => Number(x.n) === Number(m.n))))}</td>`).join('')}<td>${cgR(soma(doPag))}</td></tr></tfoot></table></div>
    <div style="display:flex;flex-wrap:wrap;gap:12px;margin-top:10px;font-size:12px;color:var(--tx-3);">${Object.entries(CG_BON_COR).map(([k, [c, r]]) =>
      `<span><span style="display:inline-block;width:12px;height:12px;border-radius:3px;background:${c};border:1px solid var(--line);vertical-align:-2px;margin-right:4px;"></span>${r}</span>`).join('')}</div>`;
  return h;
}
function cgBonifDetalhe(x) {
  const d10 = (v) => String(v || '').slice(0, 10), id = `cgBonMot_${String(x.pessoa_id)}_${x.n}`;
  const pessoa = x.pessoa_id != null ? x.pessoa_id : 'null', mes = d10(x.mes);
  return `<div style="padding:8px 10px;border:1px solid var(--line);border-radius:8px;max-width:760px;">
    <b>${cgEsc(cgNome(x.nome))}</b> · período ${cgData(x.periodo_ini)} a ${cgData(x.periodo_fim)} · <b>${cgR(x.valor)}</b>${cgN(x.perdido) ? ` <span style="color:var(--farol-perto);">(perdeu ${cgR(x.perdido)})</span>` : ''}
    <div style="margin-top:4px;color:var(--tx-2);">${x.motivo ? cgEsc(x.motivo) : 'Mês cheio, sem motivo de desconto.'}</div>
    ${x.ajuste ? `<div style="margin-top:4px;color:var(--tx-3);">${x.ajuste === 'ZERAR' ? 'Zerado' : 'Mantido'} por ${cgEsc(String(x.ajuste_por || '').split('@')[0])}${x.ajuste_em ? ' em ' + cgData(x.ajuste_em) : ''}: ${cgEsc(x.ajuste_motivo || '')}</div>` : ''}
    <div style="display:flex;flex-wrap:wrap;gap:8px;align-items:center;margin-top:8px;">
      ${x.ajuste ? cgBotaoPasso('Desfazer ajuste', `cgBonifAjustar(${pessoa},'${mes}',null)`, true)
        : `<input id="${id}" type="text" placeholder="motivo (obrigatório)" style="flex:1 1 220px;padding:6px 8px;background:var(--surface-2);color:var(--tx-1);border:1px solid var(--line);border-radius:6px;">
           ${cgBotaoPasso('Zerar o mês', `cgBonifAjustar(${pessoa},'${mes}','ZERAR','${id}')`, true)}
           ${x.motivo ? cgBotaoPasso('Manter o mês', `cgBonifAjustar(${pessoa},'${mes}','MANTER','${id}')`, true) : ''}`}</div></div>`;
}
async function cgBonifAjustar(pessoa, mes, acao, idMotivo) {
  const el = idMotivo && document.getElementById(idMotivo), motivo = el ? el.value.trim() : null;
  if (acao && !motivo) return avisoAcao('atencao', '! Escreva o motivo antes de zerar ou manter o mês.');
  avisoAcao('atencao', '… gravando o ajuste da bonificação');
  const r = await trRpcSeguro('rh_bonificacao_ajustar', { p_pessoa: pessoa, p_mes: mes, p_tipo: acao, p_motivo: motivo });
  if (!r.ok) return avisoAcao('erro', `✗ Não gravou: ${await trErroDe(r)}`, () => cgBonifAjustar(pessoa, mes, acao, idMotivo));
  CARGOS.bonif = await consultarTudo('vw_rh_bonificacao_ciclo?select=*&order=unidade,nome').catch(() => CARGOS.bonif);
  await cgBonifMesCarregar();
  avisoAcao('ok', `✓ ${acao === 'ZERAR' ? 'Mês zerado' : acao === 'MANTER' ? 'Mês mantido (paga cheio)' : 'Ajuste desfeito'}: o total já mudou — às ${avisoHora()}.`);
}
function cgAbaBonifCiclo() {
  const F = CARGOS_F;
  const todos = CARGOS.bonif || [];
  if (!todos.length) return '<div class="contexto">A bonificação ainda não tem ciclo calculado.</div>';
  const hoje = trHoje();
  const ciclos = [...new Set(todos.map(b => String(b.ciclo_inicio).slice(0, 10)))].sort();
  const aPagar = ciclos.find(c => todos.some(b => String(b.ciclo_inicio).slice(0, 10) === c && String(b.pagamento).slice(0, 10) >= hoje)) || ciclos[ciclos.length - 1];
  const ciclo = ciclos.includes(F.ciclo) ? F.ciclo : aPagar;
  const doCiclo = todos.filter(b => String(b.ciclo_inicio).slice(0, 10) === ciclo);
  const linhas = doCiclo.filter(b => !F.unidade || b.unidade === F.unidade);
  const mesRot = (k) => { const d = new Date(ciclo + 'T12:00:00'); d.setMonth(d.getMonth() + k); return d.toLocaleDateString('pt-BR', { month: 'short' }).replace('.', ''); };
  const nomeCiclo = (c) => { const b = todos.find(x => String(x.ciclo_inicio).slice(0, 10) === c); const d = new Date(c + 'T12:00:00');
    const m = (k) => { const x = new Date(d); x.setMonth(d.getMonth() + k); return x.toLocaleDateString('pt-BR', { month: 'short' }).replace('.', ''); };
    return `${m(0)}–${m(1)}–${m(2)} · paga ${b ? cgData(b.pagamento) : ''}`; };
  const pag = doCiclo[0] ? doCiclo[0].pagamento : null;
  const unids = [...new Set(doCiclo.map(b => b.unidade))];
  const soma = (l) => l.reduce((s, b) => s + cgN(b.total), 0);
  const temDesc = linhas.some(b => cgN(b.desconto) !== 0);
  const falta = (hh) => cgN(hh) ? `<div style="font-size:11px;color:var(--tx-4);">falta ${String(Math.round(cgN(hh) * 10) / 10).replace('.', ',')} h</div>` : '';
  const mesCel = (v, hh) => `<td>${cgR(v)}${falta(hh)}</td>`;
  const naoRecebem = CARGOS.pessoas.filter(p => p.ativo && p.contrato === 'CLT' && (!F.unidade || p.unidade === F.unidade) && !linhas.some(b => b.pessoa_id === p.id));
  let h = `<div style="display:flex;flex-wrap:wrap;gap:6px;margin:8px 0;">${ciclos.map(c =>
      `<button type="button" class="preset-btn ${c === ciclo ? 'active' : ''}" onclick="cargosCiclo('${c}')">${nomeCiclo(c)}</button>`).join('')}</div>
    ${cgFiltroUnidade(doCiclo)}
    <div class="cards">
      ${unids.map(u => { const l = doCiclo.filter(b => b.unidade === u); return `<div class="card neutral"><div class="card-lbl">${cgEsc(u)}</div><div class="card-val">${cgR0(soma(l))}</div><div class="card-pct">${l.length} ${l.length === 1 ? 'pessoa' : 'pessoas'}</div></div>`; }).join('')}
      <div class="card blue"><div class="card-lbl">Rede</div><div class="card-val">${cgR0(soma(doCiclo))}</div><div class="card-pct">${doCiclo.length} pessoas${pag ? ` · paga ${cgData(pag)}` : ''}</div></div>
    </div>
    <div id="tabelaCgBonif" style="overflow-x:auto;"><table>
      <thead><tr><th>Loja</th><th>Nome</th><th>Admissão</th><th>${mesRot(0)}</th><th>${mesRot(1)}</th><th>${mesRot(2)}</th>${temDesc ? '<th>Desconto</th>' : ''}<th>Total</th></tr></thead>
      <tbody>${linhas.map(b => `<tr>
        <td>${cgEsc(b.unidade)}</td><td>${cgEsc(cgNome(b.nome))}</td><td>${cgData(b.admissao)}</td>
        ${mesCel(b.mes1, b.falta_h_mes1)}${mesCel(b.mes2, b.falta_h_mes2)}${mesCel(b.mes3, b.falta_h_mes3)}
        ${temDesc ? `<td>${cgN(b.desconto) ? cgR(-cgN(b.desconto)) : '–'}</td>` : ''}
        <td style="font-weight:600;">${cgR(b.total)}</td></tr>`).join('')}</tbody>
      <tfoot><tr class="sub"><td colspan="3">Total</td><td>${cgR(linhas.reduce((s, b) => s + cgN(b.mes1), 0))}</td><td>${cgR(linhas.reduce((s, b) => s + cgN(b.mes2), 0))}</td><td>${cgR(linhas.reduce((s, b) => s + cgN(b.mes3), 0))}</td>${temDesc ? `<td>${cgR(-linhas.reduce((s, b) => s + cgN(b.desconto), 0))}</td>` : ''}<td>${cgR(soma(linhas))}</td></tr></tfoot>
    </table></div>
    ${naoRecebem.length ? `<div class="contexto" style="margin-top:8px;">Não recebem neste ciclo: ${naoRecebem.map(p => cgEsc(cgNome(p.nome))).join(', ')}. Para mudar, marque "recebe bonificação" na aba Pessoas.</div>` : ''}`;
  return h;
}

// ---------- ACERTOS NO SAIPOS (a parte da folha da fila do robô, vw_rh_saipos_acertos) ----------
const CG_SAIPOS_ACAO = { ALTERAR: 'Trocar o valor', ABRIR: 'Abrir a provisão', JA_CERTO: 'Já certo', PARE: 'Parado' };
// 05/11/2026 (Financeiro, com o "Pode" do dono): SEM_PROVISAO com vencimento por vir é ABRIR e o robô abre; excluir título
// é a única coisa que fica com a Hellen (apaga sem volta) e o robô avisa. Regra do dono (05/11): o número do título não
// aparece no Saipos — para achar, conta · data · descrição · valor.
const CG_SAIPOS_MOTIVO = { SEM_PROVISAO: 'o robô abre a provisão', PROVISAO_SOBRANDO: 'provisão para quem não recebe: a Hellen exclui',
  DESLIGADO_SOBRANDO: 'provisão de quem saiu: a Hellen exclui', NAO_FECHADO: 'esperando fechar o VT/VA no painel',
  PAGO_DIFERENTE: 'já pago com outro valor: o robô não mexe em título pago', SEM_TITULO_VENCIDO: 'venceu sem provisão: o robô não abre (pagaria em dobro)' };
const cgSaiposExcluir = (s) => s.acao === 'PARE' && /SOBRANDO$/.test(s.motivo_codigo || '');
const cgSaiposAchar = (s) => [s.conta, cgData(s.vencimento), String(s.descricao || '').replace(/\s*\(parc\.[^)]*\)\s*$/i, ''), cgR(s.valor_saipos)].filter(Boolean).join(' · ');
function cgAbaSaipos() {
  const F = CARGOS_F;
  const todas = (CARGOS.saipos || []).filter(s => !F.unidade || s.unidade_pagadora === F.unidade);
  const nCerto = todas.filter(s => s.acao === 'JA_CERTO').length;
  const linhas = todas.filter(s => s.acao !== 'JA_CERTO');   // "já certo" não pede nada: só a contagem embaixo
  if (!linhas.length) return `<div class="contexto">Nada da folha esperando acerto no Saipos${nCerto ? ` (${nCerto} lançamentos já certos)` : ''}.</div>`;
  const n = (a, m) => linhas.filter(s => s.acao === a && (!m || s.motivo_codigo === m)).length;
  // a mesma recorrência (pessoa + tipo + conta) sai inteira com "excluir este e os próximos" na primeira: as seguintes
  // não contam e dizem "sai junto" (Financeiro 05/11; o aviso do robô à Hellen já agrupa assim)
  const grupoExcl = {}, junto = new Map(), temMais = new Set();
  [...linhas].filter(cgSaiposExcluir).sort((a, b) => String(a.vencimento).localeCompare(String(b.vencimento))).forEach((s) => {
    const k = [s.quem, s.tipo, s.conta].join('|');
    if (grupoExcl[k]) { junto.set(s, grupoExcl[k]); temMais.add(grupoExcl[k]); } else grupoExcl[k] = s;
  });
  const nExcl = Object.keys(grupoExcl).length, nAbrir = linhas.filter(s => s.acao === 'ABRIR').length;
  const nParado = linhas.filter(s => s.acao === 'PARE' && !cgSaiposExcluir(s) && s.motivo_codigo !== 'NAO_FECHADO').length;
  const rot = { FOLHA_ADIANTAMENTO: 'Adiantamento', FOLHA_VT: 'Vale-transporte', FOLHA_VA: 'Vale-alimentação', FOLHA_BONIFICACAO: 'Bonificação', FORA_DA_FOLHA: 'Salário por fora', FOLHA_SALARIO: 'Salário' };
  const ordem = (s) => cgSaiposExcluir(s) ? 0 : s.acao === 'PARE' && s.motivo_codigo !== 'NAO_FECHADO' ? 1 : s.acao === 'ALTERAR' ? 2 : s.acao === 'ABRIR' ? 3 : 4;
  const ord = [...linhas].sort((a, b) => ordem(a) - ordem(b) || String(a.vencimento).localeCompare(String(b.vencimento)));
  return cgFiltroUnidade(linhas.map(s => ({ unidade: s.unidade_pagadora }))) + `
    <div class="cards">
      <div class="card ${n('ALTERAR') ? 'highlight' : 'neutral'}"><div class="card-lbl">Trocar o valor</div><div class="card-val">${n('ALTERAR')}</div><div class="card-pct">provisão com valor velho; o robô faz</div></div>
      <div class="card neutral"><div class="card-lbl">Abrir a provisão</div><div class="card-val">${nAbrir}</div><div class="card-pct">o robô abre</div></div>
      <div class="card ${nExcl ? 'highlight' : 'neutral'}"><div class="card-lbl">Excluir no Saipos</div><div class="card-val">${nExcl}</div><div class="card-pct">a Hellen exclui — o robô avisa</div></div>
      ${nParado ? `<div class="card highlight"><div class="card-lbl">Parado</div><div class="card-val">${nParado}</div><div class="card-pct">o robô não mexe: conferir</div></div>` : ''}
      <div class="card neutral"><div class="card-lbl">Esperando fechar</div><div class="card-val">${n('PARE', 'NAO_FECHADO')}</div><div class="card-pct">VT e VA do mês seguinte</div></div>
    </div>
    <div id="tabelaCgSaipos" style="overflow-x:auto;"><table>
      <thead><tr><th>Vence</th><th>O quê</th><th>Loja</th><th>Quem</th><th style="text-align:right;">No painel</th><th style="text-align:right;">No Saipos</th><th>Ação</th></tr></thead>
      <tbody>${ord.map(s => `<tr>
        <td>${cgData(s.vencimento)}</td><td>${cgEsc(rot[s.tipo] || s.tipo)}</td><td>${cgEsc(s.unidade_pagadora)}</td><td>${cgEsc(cgNome(s.quem))}</td>
        <td style="text-align:right;">${cgR(s.valor_painel)}</td><td style="text-align:right;color:var(--tx-4);">${s.valor_saipos != null ? cgR(s.valor_saipos) : '–'}</td>
        <td style="font-size:12px;white-space:normal;">${s.acao === 'PARE' ? `<span style="color:var(--farol-perto);">${cgEsc(CG_SAIPOS_MOTIVO[s.motivo_codigo] || s.motivo || 'parado')}</span>` : s.acao === 'ABRIR' ? 'o robô abre' : cgEsc(CG_SAIPOS_ACAO[s.acao] || s.acao)}${cgSaiposExcluir(s) ? (junto.has(s)
          ? `<div style="margin-top:3px;color:var(--tx-3);">sai junto com a de ${cgData(junto.get(s).vencimento)} (mesma recorrência)</div>`
          : `<div style="margin-top:3px;color:var(--tx-2);" title="título ${cgEsc(s.id_titulo || '')}">No Saipos: <b>${cgEsc(cgSaiposAchar(s))}</b>${temMais.has(s) ? ` — excluir "este e os próximos"` : ''}</div>`) : ''}</td></tr>`).join('')}</tbody>
    </table></div>
    <div class="contexto" style="margin-top:8px;">É a fila que o robô do contas a pagar lê: ele troca valores e abre provisão; excluir é só da Hellen, e o robô avisa no aviso do dia.${nCerto ? ` ${nCerto} lançamentos já estão certos.` : ''} O Saipos mostra a troca na hora, a carga do painel só umas 2 horas depois.</div>`;
}

// ---------- CORREÇÕES NA FLASH (também a tela 'flash', da Arissa) ----------
const CG_FLASH_TIPO = { 'NAO ESTA NA FLASH': 'Cadastrar', 'INATIVO NA FLASH': 'Reativar', 'DESLIGADO ATIVO NA FLASH': 'Desativar',
  'EMPRESA': 'Empresa', 'CARGO': 'Cargo', 'DEPARTAMENTO': 'Departamento', 'MATRICULA': 'Matrícula', 'ADMISSAO': 'Admissão',
  'ATIVO NA FLASH FORA DO CADASTRO': 'Fora da folha' };
function cgFlashDaLoja(lista) { const v = pesLojaVista(); return v ? (lista || []).filter((i) => i.unidade === v) : (lista || []); }
function cgListaFlash(lista) {
  lista = cgFlashDaLoja(lista);
  if (!lista.length) return '<div class="contexto">A Flash bate com a folha do painel. Nada a corrigir.</div>';
  const pessoas = {};
  for (const i of lista) (pessoas[i.nome] = pessoas[i.nome] || { unidade: i.unidade, itens: [] }).itens.push(i);
  const porTipo = {};
  for (const i of lista) porTipo[i.tipo] = (porTipo[i.tipo] || 0) + 1;
  const lido = lista[0].flash_lido_em;
  return `<div class="cards">
      <div class="card highlight"><div class="card-lbl">Correções na Flash</div><div class="card-val">${lista.length}</div><div class="card-pct">em ${Object.keys(pessoas).length} pessoas</div></div>
      ${[['Só pela tela da Flash', lista.filter((i) => i.como === 'PORTAL')], ['Pela API (com o sim do dono)', lista.filter((i) => i.como !== 'PORTAL')]].filter(([, L]) => L.length).map(([rot, L]) => {
        // 05/11/2026: a legenda era fixa ("admissão, empresa, cadastro") e o "O resto" repetia todos os tipos; agora cada
        // cartão conta só o que é dele, por tipo
        const t = {}; for (const i of L) t[i.tipo] = (t[i.tipo] || 0) + 1;
        return `<div class="card neutral"><div class="card-lbl">${rot}</div><div class="card-val">${L.length}</div><div class="card-pct">${Object.entries(t).map(([k, n]) => `${(CG_FLASH_TIPO[k] || k).toLowerCase()}: ${n}`).join(' · ')}</div></div>`;
      }).join('')}
    </div>
    <div class="contexto">A folha do painel manda; a Flash tem de ficar igual. Corrigiu na Flash, o item some sozinho na leitura seguinte (Flash lida ${lido ? new Date(lido).toLocaleString('pt-BR') : '–'}).</div>
    <div id="tabelaCgFlash" style="overflow-x:auto;"><table>
      <thead><tr><th>Loja</th><th>Pessoa</th><th>O quê</th><th>Na Flash</th><th>Tem de ficar</th><th>O que fazer</th><th>Quem faz</th></tr></thead>
      <tbody>${Object.entries(pessoas).map(([nome, p]) => p.itens.map((i, k) => `<tr>
        ${k === 0 ? `<td rowspan="${p.itens.length}">${cgEsc(p.unidade)}</td><td rowspan="${p.itens.length}" style="font-weight:600;">${cgEsc(cgNome(nome))}</td>` : ''}
        <td>${cgEsc(CG_FLASH_TIPO[i.tipo] || i.tipo)}</td><td style="color:var(--tx-4);">${cgEsc(i.na_flash || '–')}</td>
        <td>${cgEsc(i.no_painel || '–')}</td><td style="font-size:12px;">${cgEsc(i.o_que_fazer)}</td>
        <td style="font-size:12px;white-space:nowrap;">${i.como === 'API' ? '<span style="color:var(--tx-4);">API (com o sim do dono)</span>' : '<b>Hellen, na tela da Flash</b>'}</td></tr>`).join('')).join('')}</tbody>
    </table></div>`;
}
let FLASHRH = null;
async function entrarFlashRh() {
  const alvo = document.getElementById('view-flash');
  if (!alvo) return;
  await pesLojaPreparar();
  alvo.innerHTML = '<div class="contexto">Carregando a lista...</div>';
  try { FLASHRH = await consultarTudo('vw_rh_flash_pendencias?select=*&order=unidade,nome,ordem'); }
  catch (e) { alvo.innerHTML = `<div class="contexto">Não consegui carregar: ${cgEsc(e.message)}</div>`; return; }
  alvo.innerHTML = `<div class="section-label" style="border-top:none;margin-top:0;padding-top:0;">Correções na Flash</div>` + cgListaFlash(FLASHRH);
}

async function entrarRh() {
  const alvo = document.getElementById('view-rh');
  if (!alvo) return;
  if (RH) { renderModuloRh(); return; }
  alvo.innerHTML = '<div class="contexto">Carregando os descontos em folha...</div>';
  try {
    // 06/11/2026 (dono 11:44, proposta 2026-11-06-rh-descontos-ativos-historico-nome-completo): base ativa × histórico de quem saiu,
    // depósito da Rita à parte, conferência "sai na folha" e nome completo (o vale de um Alexandre caiu no outro pelo primeiro nome)
    const [colab, aberto, credor, credorDet, diverg, conf, hist, dep] = await Promise.all([
      consultarTudo('vw_rh_colaboradores?select=*&order=a_descontar.desc,colaborador'),
      consultarTudo('vw_rh_a_descontar?select=*&order=data_desconto.asc,colaborador,chave,parcela_n'),
      consultarTudo('vw_rh_credor?select=*&order=devolver_agora.desc,credor'),
      consultarTudo('vw_rh_credor_detalhe?select=*&order=data_concessao.asc,chave'),
      consultarTudo('vw_rh_divergencias?select=*&order=diferenca.desc,chave'),
      consultarTudo('vw_rh_desconto_conferencia?select=*&order=mes_pagamento,nome_completo,pessoa_id').catch(() => []),
      consultarTudo('vw_rh_desconto_historico?select=*&order=nome_completo,data_concessao,chave').catch(() => []),
      consultarTudo('vw_rh_a_receber_deposito?select=*&order=data_deposito,chave').catch(() => []),
    ]);
    const lida = await consultarTudo('rh_descontos?select=atualizado_em&order=atualizado_em.desc.nullslast&limit=1').catch(() => []);
    RH = { colab, aberto, credor, credorDet, diverg, conf, hist, dep, lidaEm: (lida[0] || {}).atualizado_em || null };
  } catch (e) {
    alvo.innerHTML = `<div class="contexto">Não consegui carregar os descontos em folha: ${cgEsc(e.message)}</div>`;
    return;
  }
  renderModuloRh();
}
let RH_ABA = 'ativos', RH_DIA = null, RH_CREDOR = null;
function rhIr(campo, v) {
  if (campo === 'aba') { RH_ABA = v; RH_PESSOA = null; }
  else if (campo === 'dia') RH_DIA = RH_DIA === v ? null : v;
  else if (campo === 'credor') RH_CREDOR = RH_CREDOR === v ? null : v;
  else if (campo === 'pessoa') RH_PESSOA = RH_PESSOA === v ? null : v;
  renderModuloRh();
}
function renderModuloRh() {
  const alvo = document.getElementById('view-rh');
  if (!alvo || RH === null) return;
  const n = (v) => Number(v) || 0;
  const R = (v) => 'R$ ' + fmt(n(v));
  const ddmm = (d) => d ? String(d).slice(8, 10) + '/' + String(d).slice(5, 7) : '—';
  const mesTxt = (d) => d ? new Date(String(d).slice(0, 10) + 'T12:00:00').toLocaleDateString('pt-BR', { month: 'short', year: '2-digit' }).replace('.', '') : '—';
  const NC = (x) => cgEsc(cgNome(x.nome_completo || x.colaborador || ''));   // nome completo do cadastro, nunca o primeiro nome
  const js = (v) => cgEsc(JSON.stringify(v));
  const hoje = cgHojeIso();
  const lida = (() => {
    if (!RH.lidaEm) return '<span style="color:var(--farol-perto);font-weight:700;">planilha sem data de leitura</span>';
    const d = new Date(RH.lidaEm), dias = Math.floor((Date.now() - d.getTime()) / 86400000);
    return `<span title="${dias > 7 ? `há ${dias} dias: o que mudou depois não está aqui` : ''}" style="${dias > 7 ? 'color:var(--farol-fora);font-weight:700;' : 'color:var(--tx-4);'}">planilha lida ${d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', timeZone: 'America/Sao_Paulo' })}</span>`;
  })();
  const ativos = RH.colab.filter((c) => c.situacao_base !== 'HISTORICO');
  const histC = RH.colab.filter((c) => c.situacao_base === 'HISTORICO' && n(c.a_descontar_historico) > 0);
  const P = RH_PESSOA && RH.colab.some((c) => c.colaborador === RH_PESSOA) ? RH_PESSOA : null;
  const cP = P ? RH.colab.find((c) => c.colaborador === P) : null;
  const soP = (arr) => P ? arr.filter((r) => r.colaborador === P) : arr;
  const abas = `<div style="display:flex;gap:6px;flex-wrap:wrap;align-items:center;margin:0 0 10px;">
    <button type="button" class="preset-btn ${RH_ABA === 'ativos' ? 'active' : ''}" onclick="rhIr('aba','ativos')">Em dia (ativos)</button>
    <button type="button" class="preset-btn ${RH_ABA === 'hist' ? 'active' : ''}" onclick="rhIr('aba','hist')">Histórico (saíram) · ${histC.length}</button>
    <span style="margin-left:auto;font-size:12px;">${lida}</span></div>
    ${P ? `<div style="margin:0 0 10px;"><button type="button" class="preset-btn active" onclick="rhIr('pessoa',null)">${cgEsc(cgNome(cP.nome_completo || P))} ✕</button></div>` : ''}`;
  const titulo = '<div class="section-label" style="border-top:none;margin-top:0;padding-top:0;">Descontos em folha</div>';

  if (RH_ABA === 'hist') {
    const H = RH.hist, tot = histC.reduce((a, c) => a + n(c.a_descontar_historico), 0);
    const pessoa = (c) => H.filter((h) => h.colaborador === c.colaborador);
    let h = `${titulo}${abas}<div class="cards"><div class="card neutral"><div class="card-lbl">Ficou em aberto</div><div class="card-val">${R(tot)}</div>
      <div class="card-pct">${histC.length} ${histC.length === 1 ? 'pessoa que saiu' : 'pessoas que saíram'} · só consulta</div></div></div>
      <div id="tabelaRhHist" style="overflow-x:auto;"><table><thead><tr><th>Nome completo</th><th>Ficou devendo</th><th>Último desconto pago</th><th>Quem emprestou</th></tr></thead><tbody>`;
    histC.forEach((c) => {
      const L = pessoa(c), ult = L.map((x) => x.ultimo_pago).filter(Boolean).sort().pop();
      const cred = [...new Set(L.filter((x) => n(x.a_descontar) > 0).map((x) => x.credor === 'EMPRESA' ? 'empresa' : cgNome(x.credor)))].join(', ');
      const ab = P === c.colaborador;
      h += `<tr style="cursor:pointer;${ab ? 'background:var(--surface-2);' : ''}" onclick='rhIr("pessoa",${js(c.colaborador)})'><td>${ab ? '▾ ' : '▸ '}${NC(c)}</td><td>${R(c.a_descontar_historico)}</td><td>${ult ? cgData(ult) : '—'}</td><td>${cgEsc(cred || '—')}</td></tr>`;
      if (ab) h += `<tr><td colspan="4"><table style="font-size:12.5px;"><thead><tr><th>Empréstimo</th><th>Data</th><th>Valor</th><th>Descontado</th><th>Ficou</th><th>Último pago</th></tr></thead><tbody>
        ${L.sort((a, b) => n(b.a_descontar) - n(a.a_descontar)).map((x) => `<tr style="${n(x.a_descontar) > 0 ? '' : 'color:var(--tx-4);'}"><td>${cgEsc(x.descricao || '')}${x.credor && x.credor !== 'EMPRESA' ? ` <span style="font-size:11px;color:var(--tx-4);">de ${cgEsc(cgNome(x.credor))}</span>` : ''}</td>
          <td>${cgData(x.data_concessao)}</td><td>${R(x.valor_total)}</td><td>${R(x.descontado)}</td><td>${n(x.a_descontar) ? R(x.a_descontar) : 'quitado'}</td><td>${x.ultimo_pago ? cgData(x.ultimo_pago) : '—'}</td></tr>`).join('')}</tbody></table></td></tr>`;
    });
    h += `</tbody><tfoot><tr class="liq"><td>Total</td><td>${R(tot)}</td><td></td><td></td></tr></tfoot></table></div>`;
    // 06/11/2026 (dono): "pode tirar esses avisos de falta parcela" — o histórico é só consulta, sem conferência de parcelas
    alvo.innerHTML = h;
    return;
  }

  // ---------------- aba Em dia (ativos) ----------------
  const aberto = soP(RH.aberto);
  const dias = [...new Set(RH.aberto.map((r) => String(r.data_desconto).slice(0, 10)))].sort();
  const prox = dias.find((d) => d >= hoje) || dias[dias.length - 1] || null;
  const dia = RH_DIA && dias.includes(RH_DIA) ? RH_DIA : prox;
  const mesPag = dia ? dia.slice(0, 7) + '-01' : null;
  const pidP = cP ? cP.pessoa_id : null;
  const confDia = (RH.conf || []).filter((x) => String(x.mes_pagamento).slice(0, 10) === mesPag && (!P || x.pessoa_id === pidP));
  const naoBate = confDia.filter((x) => x.situacao === 'DIFERENTE');
  const doDia = aberto.filter((r) => String(r.data_desconto).slice(0, 10) === dia);
  const totDia = doDia.reduce((a, r) => a + n(r.valor), 0), pesDia = new Set(doDia.map((r) => r.colaborador)).size;
  const ativosP = P ? ativos.filter((c) => c.colaborador === P) : ativos.filter((c) => n(c.a_descontar) > 0);
  const falta = ativosP.reduce((a, c) => a + n(c.a_descontar), 0), ultima = ativosP.map((c) => c.quitacao_prevista).filter(Boolean).sort().pop();
  const depAll = soP(RH.dep || []), depAb = depAll.filter((d) => d.status !== 'PAGO');
  // 06/11/2026 (dono 12:54): só o futuro aberto na planilha — o que se repassa a quem emprestou conforme desconta
  const credor = RH.credor.filter((c) => n(c.a_reembolsar) > 0), devolver = credor.reduce((a, c) => a + n(c.a_reembolsar), 0);
  const situacaoConf = !confDia.length ? (dia && dia <= hoje ? '' : 'a conferir quando o pagamento entrar')
    : naoBate.length ? `<span style="color:var(--farol-fora);font-weight:700;">✗ ${naoBate.length} não ${naoBate.length === 1 ? 'bate' : 'batem'}</span>`
    : confDia.every((x) => x.situacao === 'CONFERE') ? '<span style="color:var(--farol-ok);font-weight:700;">✓ bate com o pagamento</span>' : 'previsto';
  let h = `${titulo}${abas}<div class="cards">
    <div class="card blue"><div class="card-lbl">Sai na folha de ${ddmm(dia)}</div><div class="card-val">${R(totDia)}</div><div class="card-pct">${pesDia} ${pesDia === 1 ? 'pessoa' : 'pessoas'}${situacaoConf ? ' · ' + situacaoConf : ''}</div></div>
    <div class="card neutral"><div class="card-lbl">Falta descontar</div><div class="card-val">${R(falta)}</div><div class="card-pct">${ativosP.length} ${ativosP.length === 1 ? 'pessoa' : 'pessoas'}${ultima ? ` · última parcela em ${mesTxt(ultima)}` : ''}</div></div>
    ${depAb.length ? `<div class="card neutral"><div class="card-lbl">Rita deposita</div><div class="card-val">${R(depAb.reduce((a, d) => a + n(d.valor), 0))}</div><div class="card-pct">em ${depAb.map((d) => ddmm(d.data_deposito)).join(' e ')}</div></div>` : ''}
    ${devolver > 0 && !P ? `<div class="card neutral"><div class="card-lbl">A repassar à ${credor.map((c) => cgNome(c.credor)).join(' e ao ')}</div><div class="card-val">${R(devolver)}</div><div class="card-pct">conforme desconta</div></div>` : ''}
  </div>`;

  // Bloco 1: a folha do dia escolhido, parcela a parcela, com a conferência por pessoa
  const confDe = (r) => confDia.find((x) => x.pessoa_id === r.pessoa_id);
  const visto = new Set();
  h += `<div class="section-label">Folha de ${ddmm(dia)}${dia ? '/' + dia.slice(2, 4) : ''}: quanto sai de cada um${RH_DIA && RH_DIA !== prox ? ` <button type="button" class="preset-btn active" style="margin-left:8px;" onclick="rhIr('dia',null)">${ddmm(RH_DIA)} ✕</button>` : ''}</div>
    <div id="tabelaRhFolha" style="overflow-x:auto;"><table><thead><tr><th>Nome completo</th><th>O quê</th><th>Parcela</th><th>Valor</th><th>Sai de</th><th>No pagamento</th><th>Confere</th></tr></thead><tbody>
    ${doDia.map((r) => { const c = confDe(r), pri = !visto.has(r.colaborador); visto.add(r.colaborador);
      const okTxt = !c ? '<span style="color:var(--tx-5);">–</span>' : c.situacao === 'CONFERE' ? '<span style="color:var(--farol-ok);">✓</span>' : c.situacao === 'DIFERENTE' ? `<span style="color:var(--farol-fora);font-weight:700;">✗ ${R(c.diferenca)}</span>` : '<span style="color:var(--tx-4);">previsto</span>';
      return `<tr><td>${pri ? NC(r) : ''}</td><td>${cgEsc(r.descricao || '')}${r.credor && r.credor !== 'EMPRESA' ? ` <span style="font-size:11px;color:var(--tx-4);">de ${cgEsc(cgNome(r.credor))}</span>` : ''}</td>
        <td>${r.parcela_n ? `${r.parcela_n} de ${r.parcelas_total}` : '—'}</td><td>${R(r.valor)}</td><td>${r.onde === 'POR FORA' ? 'por fora' : cgEsc(r.onde || '—')}</td>
        <td>${pri && c && c.situacao !== 'PREVISTO' ? R(c.no_pagamento) : ''}</td><td>${pri ? okTxt : ''}</td></tr>`; }).join('') || '<tr><td colspan="7">Nada nesta folha.</td></tr>'}
    </tbody><tfoot><tr class="liq"><td>Total · ${pesDia} ${pesDia === 1 ? 'pessoa' : 'pessoas'}</td><td></td><td></td><td>${R(totDia)}</td><td></td><td>${confDia.some((x) => x.situacao !== 'PREVISTO') ? R(confDia.reduce((a, x) => a + n(x.no_pagamento), 0)) : ''}</td><td></td></tr></tfoot></table></div>`;

  // Bloco 2: próximas folhas, uma barra por dia de desconto (o clique troca o bloco 1)
  const futuros = dias.filter((d) => d >= (prox || hoje));
  const porDia = futuros.map((d) => [d, aberto.filter((r) => String(r.data_desconto).slice(0, 10) === d).reduce((a, r) => a + n(r.valor), 0)]).filter(([, v]) => v > 0);
  const maxV = Math.max(1, ...porDia.map(([, v]) => v));
  if (porDia.length > 1) h += `<div class="section-label">Próximas folhas</div><div style="display:flex;flex-direction:column;gap:4px;max-width:640px;">
    ${porDia.map(([d, v]) => `<div onclick="rhIr('dia','${d}')" style="display:flex;align-items:center;gap:8px;cursor:pointer;font-size:12.5px;" title="ver quem sai na folha de ${ddmm(d)}">
      <span style="width:62px;color:${d === dia ? 'var(--tx-1)' : 'var(--tx-3)'};font-weight:${d === dia ? 700 : 400};">${mesTxt(d)}</span>
      <span style="flex:1;background:var(--surface-2);border-radius:3px;height:14px;"><span style="display:block;height:14px;border-radius:3px;width:${Math.max(2, v / maxV * 100)}%;background:${d === dia ? 'var(--brand)' : 'var(--info)'};"></span></span>
      <span style="width:96px;">${R(v)}</span></div>`).join('')}</div>`;

  // Bloco 3: quem deve (o seletor da tela)
  // o depósito da Rita não é parcela de folha; e só o empréstimo com parcela aberta (dono 06/11 12:54: o passado é só consulta)
  const chavesAbertas = new Set(RH.aberto.map((r) => r.chave));
  const dvA = RH.diverg.filter((d) => d.situacao_base === 'ATIVO' && d.forma !== 'DEPOSITO' && chavesAbertas.has(d.chave));
  // 06/11/2026 (RH, dono): a coluna Situação saiu — a diferença da planilha era de parcelas já pagas (Alyson), o futuro está certo
  const sit = (c) => { const D = dvA.filter((d) => d.colaborador === c.colaborador); if (!D.length) return '<span style="color:var(--farol-ok);">em dia</span>';
    const fp = D.filter((d) => d.tipo === 'FALTA PARCELA').reduce((a, d) => a + n(d.diferenca), 0), pm = D.filter((d) => d.tipo !== 'FALTA PARCELA').reduce((a, d) => a + Math.abs(n(d.diferenca)), 0);
    return [fp ? `<span style="color:var(--farol-perto);" title="sobrou valor sem parcela lançada: ninguém está cobrando">falta parcela ${R(fp)}</span>` : '', pm ? `<span style="color:var(--farol-perto);" title="quase sempre vale replanejado com a parcela antiga ainda na planilha">parcela a mais ${R(pm)}</span>` : ''].filter(Boolean).join('<br>'); };
  const quem = ativos.filter((c) => n(c.a_descontar) > 0);
  h += `<div class="section-label">Quem deve</div><div id="tabelaRhColab" style="overflow-x:auto;"><table><thead><tr><th>Nome completo</th><th>Falta</th><th>Parcelas que faltam</th><th>Próxima</th><th>Última</th></tr></thead><tbody>
    ${quem.map((c) => { const ab = P === c.colaborador;
      let t = `<tr style="cursor:pointer;${ab ? 'background:var(--surface-2);' : ''}" onclick='rhIr("pessoa",${js(c.colaborador)})' title="${ab ? 'clique para soltar' : 'clique para a tela falar só desta pessoa'}">
        <td>${ab ? '▾ ' : '▸ '}${NC(c)}${c.onde === 'POR FORA' ? ' <span style="font-size:11px;color:var(--tx-4);">por fora</span>' : ''}</td><td>${R(c.a_descontar)}</td><td>${n(c.parcelas_abertas)}</td><td>${cgData(c.proximo_desconto)}</td><td>${mesTxt(c.quitacao_prevista)}</td></tr>`;
      if (ab) { const E = [...new Set(RH.aberto.filter((r) => r.colaborador === c.colaborador).map((r) => r.chave))].map((k) => RH.aberto.filter((r) => r.chave === k && r.colaborador === c.colaborador));
        t += `<tr><td colspan="5"><div class="caption-label" style="text-align:left;margin:2px 0;">Empréstimos de ${NC(c)}</div><table style="font-size:12.5px;"><thead><tr><th>Empréstimo</th><th>Parcelas que faltam</th><th>Falta</th><th>Próxima</th><th>Última</th></tr></thead><tbody>
          ${E.map((L) => `<tr><td>${cgEsc(L[0].descricao || '')}${L[0].credor && L[0].credor !== 'EMPRESA' ? ` <span style="font-size:11px;color:var(--tx-4);">de ${cgEsc(cgNome(L[0].credor))}</span>` : ''}</td>
            <td>${L.length}${L[0].parcelas_total ? ` (de ${L[0].parcelas_total})` : ''}</td><td>${R(L.reduce((a, r) => a + n(r.valor), 0))}</td><td>${cgData(L[0].data_desconto)}</td><td>${cgData(L[L.length - 1].data_desconto)}</td></tr>`).join('')}</tbody></table></td></tr>`; }
      return t; }).join('')}
    </tbody><tfoot><tr class="liq"><td>Total · ${quem.length} ${quem.length === 1 ? 'pessoa' : 'pessoas'}</td><td>${R(quem.reduce((a, c) => a + n(c.a_descontar), 0))}</td><td>${quem.reduce((a, c) => a + n(c.parcelas_abertas), 0)}</td><td></td><td></td></tr></tfoot></table></div>`;

  // Bloco 4: depósitos da Rita (Vales Cidadão) — ela deposita na conta, não sai da folha
  if (depAll.length) h += `<div class="section-label">Depósitos da Rita (Vales Cidadão)</div><div id="tabelaRhDeposito" style="overflow-x:auto;"><table><thead><tr><th>Data</th><th>Nome completo</th><th>Valor</th><th>Situação</th></tr></thead><tbody>
    ${depAll.map((d) => `<tr><td>${cgData(d.data_deposito)}</td><td>${NC(d)}</td><td>${R(d.valor)}</td><td>${d.status === 'PAGO' ? '<span style="color:var(--farol-ok);">✓ depositou</span>' : (String(d.data_deposito).slice(0, 10) < hoje ? '<span style="color:var(--farol-perto);font-weight:700;">aguardando (passou da data)</span>' : 'aguardando')}</td></tr>`).join('')}</tbody></table></div>`;

  // Bloco 5: devolver a quem emprestou (só quando há o que devolver; o detalhe abre no clique)
  if (credor.length && !P) h += `<div class="section-label">A repassar a quem emprestou</div><div id="tabelaRhCredor" style="overflow-x:auto;"><table><thead><tr><th>Quem emprestou</th><th>Emprestado</th><th>A repassar (conforme desconta)</th></tr></thead><tbody>
    ${credor.map((c) => { const ab = RH_CREDOR === c.credor;
      let t = `<tr style="cursor:pointer;" onclick='rhIr("credor",${js(c.credor)})'><td>${ab ? '▾ ' : '▸ '}${cgEsc(cgNome(c.credor))}</td><td>${R(c.emprestado)}</td><td style="font-weight:700;">${R(c.a_reembolsar)}</td></tr>`;
      if (ab) t += `<tr><td colspan="3"><table style="font-size:12.5px;"><thead><tr><th>Funcionário</th><th>O quê</th><th>Falta descontar (a repassar)</th></tr></thead><tbody>
        ${RH.credorDet.filter((d) => d.credor === c.credor && n(d.a_reembolsar) > 0).map((d) => { const pc = RH.colab.find((x) => x.colaborador === d.colaborador) || d;
          return `<tr><td>${NC(pc)}</td><td>${cgEsc(d.descricao || '')} <span style="font-size:11px;color:var(--tx-4);">${cgData(d.data_concessao)}</span></td><td>${R(d.a_reembolsar)}</td></tr>`; }).join('')}</tbody></table></td></tr>`;
      return t; }).join('')}</tbody></table></div>`;
  alvo.innerHTML = h;
}

// ---------------------------------------------------------------- Acertos dos motoboys
// 30/10/2026 (dono): "Vamos começar a registrar os acertos da Hellen pra chegar na conta correta". Só registra o que já foi feito no Pix;
// não é a tela do Pagar Motoboys. Proposta: contexto/propostas-telas/2026-10-30-acertos-motoboys.md. A pessoa é o id_entregador, nunca o nome.
const MB_MOTIVOS = ['Pedido não achado', 'Refrigerante', 'Comida de pedido cancelado', 'Acerto de outro dia'];
const mbDataSP = (delta) => { const d = new Date(new Date().toLocaleDateString('sv-SE', { timeZone: 'America/Sao_Paulo' }) + 'T12:00:00'); d.setDate(d.getDate() + delta); return d.toLocaleDateString('sv-SE'); };
const MB = { dia: mbDataSP(-1), de: mbDataSP(-30), ate: mbDataSP(0), opcoes: null, lista: null, erro: null, semAcesso: false, chave: '', sentido: null, valor: '', motivo: '', cancelando: null, motivoCancela: '', enviando: false };
const mbAlvo = () => document.getElementById('view-macertos');
const mbNumero = (t) => { t = String(t).trim(); return Number(t.includes(',') ? t.replace(/\./g, '').replace(',', '.') : t); };
async function mbLerDia() {
  MB.opcoes = null;
  const r = await trRpcSeguro('motoboy_do_dia', { p_dia: MB.dia });
  if (r.ok) { MB.opcoes = await r.json(); return; }
  const m = await trErroDe(r);
  if (/permiss/i.test(m)) MB.semAcesso = true; else MB.erro = m;
}
async function mbLerLista() {
  try { MB.lista = await consultarTudo(`motoboy_acerto?select=*&dia=gte.${MB.de}&dia=lte.${MB.ate}&order=lancado_em.desc`); MB.erro = null; }
  catch (e) { MB.erro = e.message; }
}
async function entrarMotoboyAcertos() {
  await pesLojaPreparar();
  const alvo = mbAlvo(); if (!alvo) return;
  alvo.innerHTML = '<div class="contexto">Lendo os acertos…</div>';
  MB.semAcesso = false; MB.erro = null;
  await mbLerLista();
  await mbLerDia();
  mbRender();
}
function mbMudarDia(v) { if (!v) return; MB.dia = v; MB.chave = ''; mbLerDia().then(mbRender); }
function mbMudarPeriodo(campo, v) { if (!v) return; MB[campo] = v; mbLerLista().then(mbRender); }
function mbMarcar(campo, v) { MB[campo] = v; mbRender(); }
function mbRender() {
  const alvo = mbAlvo(); if (!alvo) return;
  if (MB.semAcesso) { alvo.innerHTML = '<div class="contexto">Nada para mostrar — este login não vê dados de pessoal.</div>'; return; }
  const loja = pesLojaVista(), daLoja = (x) => !loja || x.unidade === loja;
  const ops = (MB.opcoes || []).filter(daLoja), V = (MB.lista || []).filter(daLoja), vivos = V.filter((x) => !x.cancelado_em);
  const soma = (f) => vivos.filter(f).reduce((a, x) => a + cgN(x.valor), 0);
  const bt = (on, txt, click) => `<button type="button" class="preset-btn${on ? ' active' : ''}" onclick="${click}">${txt}</button>`;
  const rot = 'style="display:block;font-size:12px;color:var(--tx-3);margin-bottom:4px;"';
  alvo.innerHTML = `<h2 style="margin:0 0 12px;">Acertos dos motoboys</h2>
    ${MB.erro ? `<div class="contexto" style="color:var(--farol-fora);">✗ Não consegui ler: ${cgEsc(MB.erro)}</div>` : ''}
    <div style="display:flex;flex-wrap:wrap;gap:14px;align-items:flex-end;margin-bottom:10px;">
      <div><label for="mbDia" ${rot}>Dia do trabalho</label><input id="mbDia" type="date" max="${mbDataSP(0)}" value="${MB.dia}" onchange="mbMudarDia(this.value)"></div>
      <div style="min-width:280px;flex:1;"><label for="mbQuem" ${rot}>Motoboy</label><select id="mbQuem" style="width:100%;" onchange="MB.chave=this.value">
        <option value="">${MB.opcoes === null ? 'Sem lista deste dia' : ops.length ? 'Escolha' : 'Nenhuma entrega neste dia'}</option>
        ${ops.map((o) => { const k = `${o.id_entregador}|${o.unidade}`; return `<option value="${cgEsc(k)}"${MB.chave === k ? ' selected' : ''}>${cgEsc(cgNome(o.motoboy))} · ${cgEsc(o.unidade)} · ${cgN(o.entregas)} entregas · ${cgR(o.taxas)}</option>`; }).join('')}</select></div>
      <div><span ${rot}>O que foi feito</span>${bt(MB.sentido === -1, 'Descontou', "mbMarcar('sentido',-1)")} ${bt(MB.sentido === 1, 'Pagou a mais', "mbMarcar('sentido',1)")}</div>
      <div><label for="mbValor" ${rot}>Valor</label><input id="mbValor" type="text" inputmode="decimal" value="${cgEsc(MB.valor)}" style="width:90px;text-align:right;" oninput="MB.valor=this.value"></div>
    </div>
    <div style="margin-bottom:6px;"><label for="mbMotivo" ${rot}>Motivo</label><input id="mbMotivo" type="text" maxlength="300" value="${cgEsc(MB.motivo)}" style="width:100%;" oninput="MB.motivo=this.value"></div>
    <div style="display:flex;flex-wrap:wrap;gap:6px;align-items:center;margin-bottom:16px;">${MB_MOTIVOS.map((m) => bt(MB.motivo === m, m, `mbMarcar('motivo','${m}')`)).join('')}
      <button type="button" class="preset-btn active" style="margin-left:auto;" onclick="mbLancar()"${MB.enviando ? ' disabled' : ''}>Registrar acerto</button></div>
    <div class="cards"><div class="card neutral"><div class="card-lbl">Descontado</div><div class="card-val">${cgR(Math.abs(soma((x) => cgN(x.valor) < 0)))}</div></div>
      <div class="card neutral"><div class="card-lbl">Pago a mais</div><div class="card-val">${cgR(soma((x) => cgN(x.valor) > 0))}</div></div></div>
    <div style="display:flex;gap:12px;align-items:flex-end;margin:6px 0 10px;"><div><label for="mbDe" ${rot}>Dia de</label><input id="mbDe" type="date" value="${MB.de}" onchange="mbMudarPeriodo('de',this.value)"></div>
      <div><label for="mbAte" ${rot}>até</label><input id="mbAte" type="date" value="${MB.ate}" onchange="mbMudarPeriodo('ate',this.value)"></div></div>
    ${V.length ? `<div id="tabelaMbAcertos" style="overflow-x:auto;"><table><thead><tr><th>Dia</th><th>Motoboy</th><th>Loja</th><th style="text-align:right;">Valor</th><th>Motivo</th><th>Quem lançou</th><th>Quando</th><th></th></tr></thead><tbody>${V.map(mbLinha).join('')}</tbody></table></div>`
      : `<div class="contexto">${MB.lista === null ? 'Lendo…' : 'Nenhum acerto neste período.'}</div>`}`;
}
function mbLinha(x) {
  const risco = x.cancelado_em ? 'text-decoration:line-through;color:var(--tx-4);' : '';
  const quem = (e) => cgEsc(cgNome(String(e || '').split('@')[0]));
  const hora = (t) => new Date(t).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
  const fim = x.cancelado_em ? `<span style="font-size:12px;color:var(--tx-3);white-space:normal;">cancelado por ${quem(x.cancelado_por)} em ${hora(x.cancelado_em)}: ${cgEsc(x.motivo_cancelamento)}</span>`
    : MB.cancelando === x.id ? `<input id="mbCancMotivo" type="text" maxlength="300" placeholder="Motivo do cancelamento" value="${cgEsc(MB.motivoCancela)}" style="width:180px;" oninput="MB.motivoCancela=this.value"> <button type="button" class="preset-btn active" onclick="mbCancelar(${x.id})">Confirmar</button> <button type="button" class="preset-btn" onclick="MB.cancelando=null;mbRender()">Voltar</button>`
    : `<button type="button" class="preset-btn" onclick="MB.cancelando=${x.id};MB.motivoCancela='';mbRender()">Cancelar</button>`;
  return `<tr><td style="${risco}">${cgData(x.dia)}</td><td style="${risco}">${cgEsc(cgNome(x.motoboy))}</td><td style="${risco}">${cgEsc(x.unidade)}</td><td style="text-align:right;${risco}">${cgR(x.valor)}</td><td style="white-space:normal;${risco}">${cgEsc(x.motivo)}</td><td style="${risco}">${quem(x.lancado_por)}</td><td style="${risco}">${hora(x.lancado_em)}</td><td>${fim}</td></tr>`;
}
async function mbLancar() {
  if (MB.enviando) return;
  const o = (MB.opcoes || []).find((x) => `${x.id_entregador}|${x.unidade}` === MB.chave), v = mbNumero(MB.valor), motivo = MB.motivo.trim();
  const falta = !o ? 'escolha o motoboy' : !MB.sentido ? 'marque Descontou ou Pagou a mais' : !(v > 0) ? 'digite o valor' : !motivo ? 'diga o motivo' : '';
  if (falta) return avisoAcao('erro', `✗ Não registrou: ${falta}.`);
  MB.enviando = true; mbRender();
  avisoAcao('enviando', 'Registrando o acerto…');
  const r = await trRpcSeguro('motoboy_acerto_lancar', { p_dia: MB.dia, p_id_entregador: o.id_entregador, p_motoboy: o.motoboy, p_unidade: o.unidade, p_valor: MB.sentido * v, p_motivo: motivo });
  MB.enviando = false;
  if (!r.ok) { avisoAcao('erro', `✗ Não registrou: ${await trErroDe(r)}.`, mbLancar); mbRender(); return; }
  avisoAcao('ok', `✓ Registrado: ${cgNome(o.motoboy)}, ${MB.sentido < 0 ? 'descontou' : 'pagou a mais'} ${cgR(v)}, dia ${cgData(MB.dia)} — às ${avisoHora()}.`);
  MB.chave = ''; MB.sentido = null; MB.valor = ''; MB.motivo = '';
  await mbLerLista(); mbRender();
}
async function mbCancelar(id) {
  const m = MB.motivoCancela.trim();
  if (m.length < 3) return avisoAcao('erro', '✗ Não cancelou: diga o motivo do cancelamento.');
  avisoAcao('enviando', 'Cancelando o acerto…');
  const r = await trRpcSeguro('motoboy_acerto_cancelar', { p_id: id, p_motivo: m });
  if (!r.ok) return avisoAcao('erro', `✗ Não cancelou: ${await trErroDe(r)}.`, () => mbCancelar(id));
  avisoAcao('ok', `✓ Acerto cancelado — às ${avisoHora()}.`);
  MB.cancelando = null; await mbLerLista(); mbRender();
}
