// SISTEMA (05/11/2026, último bloco da migração): MOVIDO do docs/dashboard.html, sem mudar nada.
// Plano, Rotinas e Telas do painel. Quem carrega: o painel antigo e docs/sistema/index.html.
// Quem mexe: o chat "Telas do painel".

// ------------------------------------------------------------------
// Modulo Rotinas: o que esta rodando agora e como terminou da ultima vez.
// As rotinas gravam inicio/fim em rotinas_execucao (ver rotinas/REGISTRO-EXECUCAO.md),
// entao o painel responde "ja rodou?" sem precisar perguntar no chat.
// 12/11/2026 (auditoria de usabilidade): a LISTA da tela vem do banco — toda rotina que gravou em rotinas_execucao nos
// últimos 35 dias (o mini PC tem 29 do Claude). Esta constante só dá NOME e HORÁRIO às conhecidas; rotina nova aparece
// sozinha com o nome do registro. Horários: contexto/project_cronograma_rotinas.md.
const ROTINAS_JANELA_DIAS = 35;
const ROTINAS_CONHECIDAS = [
  // Grade vigente (24/08/2026) — fonte: contexto/project_cronograma_rotinas.md
  { id: 'manutencao-mensal-banco',           nome: 'Manutenção do banco',    quando: 'Dia 1º, 03:20' },
  { id: 'importacao-diaria-apis',            nome: 'Importação de APIs',     quando: 'Todo dia 08:00' },
  // Lembrete, nao execucao: avisa o dono de trocar Anuncios e Campanha Inteligente.
  // Nao toca o portal, por isso pode rodar antes das 10:00 sem ferir a regra do dono.
  { id: 'alerta-troca-promocoes',            nome: 'Aviso de troca de promos', quando: 'Seg e sex 09:00' },
  { id: 'extracao-diaria-pedidos',           nome: 'Extração de pedidos',    quando: 'desligada desde 30/10' },
  { id: 'contestacao-diaria-cancelamentos',  nome: 'Contestação',            quando: 'Todo dia 11:30' },
  // 01/09/2026: o id estava em 'conciliacao-bancaria-diaria', rotina REVOGADA em
  // 28/08 quando ela e a de lançamento viraram uma só. Resultado: a linha da
  // conciliação aparecia como "nunca registrada" e a rotina que roda de verdade
  // não aparecia — cinco dias de execuções invisíveis nesta tela.
  { id: 'conciliacao-e-lancamento-diario',   nome: 'Conciliação e lançamento', quando: 'Seg–sex, de 10 em 10 min' },
  { id: 'extracao-diaria-promocoes',         nome: 'Extração de promoções',  quando: 'Todo dia 12:30' },
  // 08/10/2026: exporta do Saipos a Movimentacao de estoque das 3 lojas e carrega no banco
  // (rotinas/extracao-diaria-estoque-saipos.md). Sem esta linha, PARCIAL e PULADA dela nao
  // entram em "Pedindo atencao agora" (a tela so olha as rotinas desta lista).
  { id: 'extracao-diaria-estoque-saipos',    nome: 'Estoque do Saipos',      quando: 'Todo dia 05:40 (reserva 17:40)' },
  { id: 'extracao-semanal-cardapio',         nome: 'Extração de cardápio',   quando: 'Segunda 14:00' },
  { id: 'resumo-semanal-ifood',              nome: 'Resumo semanal',         quando: 'Segunda 17:00' },
  { id: 'extracao-semanal-relatorios-rede',  nome: 'Relatórios da rede',     quando: 'Terça 14:00' },
  { id: 'extracao-semanal-conciliacao',      nome: 'Conciliação iFood',      quando: 'Quinta 14:00' },
  { id: 'extracao-mensal-clientes',          nome: 'Extração de clientes',   quando: 'Dia 03, 13:30' },
  { id: 'boletim-rotinas',                   nome: 'Boletim das rotinas',    quando: 'Todo dia 13:00 e 18:00' },
];
// nome da rotina: o da lista acima ou o id do registro em português corrido ("extracao-semanal-x" → "Extracao semanal x")
const rotNome = (id) => (ROTINAS_CONHECIDAS.find((r) => r.id === id) || {}).nome
  || String(id || '').replace(/[-_]+/g, ' ').replace(/^\w/, (c) => c.toUpperCase());
let ROT_SO_PROBLEMAS = false;

let ROTINAS_TIMER = null;

async function entrarRotinas() {
  const alvo = document.getElementById('view-rotinas');
  if (!alvo.innerHTML) alvo.innerHTML = '<div class="contexto">Carregando rotinas...</div>';
  await carregarRotinas();
  // Enquanto o modulo estiver aberto, atualiza sozinho — e assim que uma rotina
  // abre o registro, ela aparece como "rodando agora" sem recarregar a pagina.
  if (ROTINAS_TIMER) clearInterval(ROTINAS_TIMER);
  ROTINAS_TIMER = setInterval(() => {
    const visivel = document.getElementById('modulo-rotinas').style.display !== 'none';
    if (visivel) carregarRotinas(); else { clearInterval(ROTINAS_TIMER); ROTINAS_TIMER = null; }
  }, 30000);
}

async function carregarRotinas() {
  const [status, historico, batimento] = await Promise.all([
    consultarTudo('vw_rotinas_status?select=rotina,inicio,fim,status,resumo,detalhe,duracao_seg,falhas_30d'),
    consultarTudo('rotinas_execucao?select=rotina,inicio,fim,status,resumo,detalhe&order=inicio.desc&limit=40'),
    // Batimento (01/09/2026): a conciliação acorda 13x por dia e sai em silêncio
    // quando não há extrato. Sem isso, "acordou e saiu" e "não acordou" ficam
    // idênticos na tela — e foi assim que um dia inteiro se perdeu sem ninguém ver.
    consultarTudo('vw_rotinas_batimento?select=rotina,situacao,motivo,acordou_em,ha_seg'),
  ]);
  renderModuloRotinas(status, historico, batimento || []);
}

function renderModuloRotinas(status, historico, batimento = []) {
  const alvo = document.getElementById('view-rotinas');
  const porId = Object.fromEntries(status.map(r => [r.rotina, r]));
  // a lista: o que rodou na janela (ou está rodando), problema primeiro, depois pelo nome
  const limite = Date.now() - ROTINAS_JANELA_DIAS * 86400000;
  const PESO = { TRAVADA: 0, FALHOU: 1, PARCIAL: 2, PULADA: 3, RODANDO: 4 };
  const lista = status.filter(r => r.status === 'RODANDO' || (r.inicio && Date.parse(r.inicio) >= limite))
    .map(r => ({ id: r.rotina, nome: rotNome(r.rotina), quando: (ROTINAS_CONHECIDAS.find(c => c.id === r.rotina) || {}).quando || '—' }))
    .sort((a, b) => (PESO[porId[a.id].status] ?? 9) - (PESO[porId[b.id].status] ?? 9) || a.nome.localeCompare(b.nome, 'pt-BR'));
  const porBatimento = Object.fromEntries(batimento.map(b => [b.rotina, b]));

  const dtHora = (v) => v ? new Date(v).toLocaleString('pt-BR', { day:'2-digit', month:'2-digit', hour:'2-digit', minute:'2-digit' }) : '—';
  const dur = (s) => s == null ? '—' : (s < 60 ? `${s}s` : `${Math.floor(s/60)}min`);
  // Dia LOCAL: o banco grava em UTC e, sem converter, execucao da noite cai no dia
  // seguinte — a mesma armadilha do current_date.
  const diaLocal = (v) => v ? new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(new Date(v)) : '';
  // Dois numeros no alto (12/09/2026): a tabela ja tem tudo, mas obriga a ler 11
  // linhas para saber se o dia foi bem. Estes dois respondem de cara.
  const hojeLocal = diaLocal(new Date());
  const situacoes = lista.map(r => porId[r.id]).filter(Boolean);
  const okHoje = situacoes.filter(x => x.status === 'OK' && diaLocal(x.inicio) === hojeLocal).length;
  // O denominador e' quem RODOU hoje, nunca a lista toda: parte e' semanal ou mensal.
  const rodaramHoje = situacoes.filter(x => diaLocal(x.inicio) === hojeLocal).length;
  const pedemAtencao = situacoes.filter(x => ['FALHOU', 'TRAVADA', 'PARCIAL', 'PULADA'].includes(x.status)).length;
  const badge = (st) => ({
    RODANDO:  '<span style="color:var(--farol-perto); font-weight:bold;">● rodando agora</span>',
    OK:       '<span style="color:var(--farol-ok); font-weight:bold;">✔ concluída</span>',
    FALHOU:   '<span style="color:var(--farol-fora); font-weight:bold;">✖ falhou</span>',
    PULADA:   '<span style="color:var(--tx-4); font-weight:bold;">— pulada</span>',
    // PARCIAL (01/09/2026): fez o trabalho mas não deixou a prova no banco —
    // rastro, aviso ou conferência faltando. Quem grava é fechar_execucao.py,
    // que rebaixa o OK em vez de aceitar a palavra da rotina.
    PARCIAL:  '<span style="color:var(--farol-perto); font-weight:bold;">◐ sem prova completa</span>',
    TRAVADA:  '<span style="color:var(--farol-fora); font-weight:bold;">✖ não finalizou</span>',
  }[st] || `<span style="color:var(--tx-4);">${st}</span>`);

  // Coluna "o que fazer" (12/09/2026): situacao ruim sem a acao ao lado obriga a
  // lembrar o conserto de cabeca. Duas regras, as duas com conserto conhecido:
  // TRAVADA = morreu com o registro aberto (reinicio da maquina, medido em 01/09)
  // e PULADA com "dono logar" = o Chrome do mini PC esta deslogado. A RODANDO
  // aberta antes do ultimo boot nao precisa de regra propria aqui: a propria
  // vw_rotinas_status ja a devolve como TRAVADA.
  const oQueFazer = (s) => {
    const txt = `${s.resumo || ''} ${s.detalhe || ''}`.toLowerCase();
    // 12/11/2026 (auditoria): ação de operador, sem comando técnico — a faxina roda sozinha antes de cada fila (§A6)
    if (s.status === 'TRAVADA') return 'parou num reinício do mini PC — o robô limpa sozinho na próxima rodada';
    if (s.status === 'PULADA' && txt.includes('dono logar')) return 'logar o Chrome do mini PC (o boletim avisa quando)';
    return '';
  };

  const rodando = lista.filter(r => porId[r.id] && porId[r.id].status === 'RODANDO');

  // O batimento normal e' silencio. Situacoes de repouso (rotinas_batimento):
  // FIM = pegou o dia e fechou; SAIU = acordou e nao tinha trabalho; RODANDO =
  // esta trabalhando agora — e rotina longa aqui e' legitima (a conciliacao de
  // 31/08 rodou 5h44 e terminou OK), por isso RODANDO nao e' atraso. Atraso e'
  // mais de 24h sem acordar, ou parada em ACORDOU (acordou e nao decidiu nada).
  // Com tudo em ordem o bloco vira UMA linha que abre num clique: colapsa, nunca
  // esconde — e no dia em que uma atrasar ele ja nasce aberto.
  const batAtrasado = batimento.filter(b => {
    const s = String(b.situacao || '').toUpperCase();
    return Number(b.ha_seg) >= 86400 || !(s === 'FIM' || s === 'SAIU' || s === 'RODANDO');
  });
  const batOk = batimento.length > 0 && batAtrasado.length === 0;
  // Esta tela se redesenha SOZINHA a cada 30s (ROTINAS_TIMER). Sem guardar o
  // estado, o bloco que a pessoa abriu fecharia na cara dela no meio da leitura.
  // Neste ponto o desenho anterior ainda esta na tela, entao da para perguntar a
  // ele; atraso continua mandando abrir.
  const batAntes = document.getElementById('batDetalhe');
  const batAberto = !batOk || (batAntes ? batAntes.open : false);

  alvo.innerHTML = `
  <div class="section-label" style="border-top:none; margin-top:0; padding-top:0;">Rotinas automáticas</div>
  <div class="caption-label" style="text-align:center;">atualiza a cada 30 s · as ${lista.length} que rodaram nos últimos ${ROTINAS_JANELA_DIAS} dias</div>

  <div class="cards">
    <div class="card ${rodaramHoje && okHoje === rodaramHoje ? 'pos' : 'neutral'}"><div class="card-lbl">Terminaram bem hoje</div>
      <div class="card-val">${okHoje}</div>
      <div class="card-pct" title="Rotinas cuja última execução começou hoje e terminou bem, de quantas rodaram hoje (as semanais e mensais não rodam todo dia).">de ${rodaramHoje} que rodaram hoje</div></div>
    <div class="card ${pedemAtencao ? 'neg' : 'pos'}"><div class="card-lbl">Pedindo atenção agora</div>
      <div class="card-val">${pedemAtencao}</div>
      <div class="card-pct" title="Última execução em FALHOU, TRAVADA (não finalizou), PARCIAL (sem prova completa) ou PULADA.">${pedemAtencao ? 'na tabela abaixo' : 'nada pendente'}</div></div>
  </div>

  ${rodando.length ? `<div class="contexto" style="border-color:var(--farol-perto);">
    <b>Acontecendo agora:</b> ${rodando.map(r => r.nome).join(', ')} —
    começou ${dtHora(porId[rodando[0].id].inicio)}, já faz ${dur(porId[rodando[0].id].duracao_seg)}.
  </div>` : ''}

  ${batimento.length ? `<div class="contexto"${batOk ? '' : ' style="border-color:var(--farol-perto);"'}>
    <details id="batDetalhe"${batAberto ? ' open' : ''}><summary style="cursor:pointer;">
      <b>Último batimento</b> — ${batOk
        ? `as ${batimento.length} acordaram nas últimas 24 horas e estão em ordem`
        : `${batAtrasado.length} de ${batimento.length} sem acordar ou paradas no meio`}
      <span style="color:var(--tx-5);">· clique para ver uma a uma</span></summary>
    <div style="margin-top:6px;">Rotina que acorda várias vezes por dia e sai em silêncio
    quando não tem trabalho. Aqui dá para ver a diferença entre <i>saiu</i> e <i>não acordou</i>:</div>
    <ul style="margin:6px 0 0 0;">
      ${batimento.map(b => `<li style="font-size:12px;">
        <b>${b.rotina}</b> — ${b.situacao} em ${dtHora(b.acordou_em)}
        <span style="color:${Number(b.ha_seg) > 86400 ? 'var(--farol-fora)' : 'var(--tx-4)'};">
          (há ${dur(Number(b.ha_seg))})</span>
        ${b.motivo ? `<br><span style="color:var(--tx-4);">${b.motivo}</span>` : ''}
      </li>`).join('')}
    </ul></details>
  </div>` : ''}

  <div id="tabelaRotinas"><table>
    <thead><tr><th>Rotina</th><th>Agenda</th><th>Situação</th><th>Última execução</th><th>Duração</th><th>Resultado</th><th>O que fazer</th></tr></thead><tbody>
    ${lista.map(r => {
      const s = porId[r.id];
      const fazer = oQueFazer(s);
      return `<tr>
        <td>${r.nome}</td>
        <td style="font-size:11.5px;">${r.quando}</td>
        <td>${badge(s.status)}${Number(s.falhas_30d) ? ` <span style="font-size:10px; color:var(--farol-fora);">(${s.falhas_30d} falha(s) em 30d)</span>` : ''}</td>
        <td>${dtHora(s.inicio)}</td>
        <td>${dur(s.duracao_seg)}</td>
        <td style="font-size:11.5px;">${s.resumo || '—'}${s.detalhe ? `<br><span style="font-size:11px; color:var(--tx-4);">${s.detalhe}</span>` : ''}</td>
        <td style="font-size:11.5px;${fazer ? ' color:var(--farol-perto);' : ''}" title="O conserto conhecido dessa situação. Vazio quer dizer que não há ação fixa: leia o resultado ao lado.">${fazer || '—'}</td>
      </tr>`;
    }).join('')}
  </tbody></table></div>

  <div class="section-label">Histórico</div>
  ${historico.length ? `<div style="margin:4px 2px 6px; font-size:13px;">
    <button type="button" class="preset-btn ${ROT_SO_PROBLEMAS ? '' : 'active'}" onclick="ROT_SO_PROBLEMAS=false; carregarRotinas();">todas</button>
    <button type="button" class="preset-btn ${ROT_SO_PROBLEMAS ? 'active' : ''}" onclick="ROT_SO_PROBLEMAS=true; carregarRotinas();">só problemas</button></div>
  <div id="tabelaRotinasHist"><table>
    <thead><tr><th>Quando</th><th>Rotina</th><th>Situação</th><th>Resultado</th></tr></thead><tbody>
    ${(ROT_SO_PROBLEMAS ? historico.filter(h => ['FALHOU', 'TRAVADA', 'PARCIAL', 'PULADA'].includes(h.status)) : historico).map(h => `<tr>
      <td>${dtHora(h.inicio)}</td>
      <td style="font-size:11.5px;">${rotNome(h.rotina)}</td>
      <td>${badge(h.status)}</td>
      <td style="font-size:11.5px;">${h.resumo || '—'}${h.detalhe ? `<br><span style="font-size:11px; color:var(--tx-4);">${h.detalhe}</span>` : ''}</td>
    </tr>`).join('') || '<tr><td colspan="4">nenhum problema nas últimas 40 execuções</td></tr>'}
  </tbody></table></div>` : '<div class="contexto">Nenhuma execução registrada ainda.</div>'}`;
}

// ============ PLANO ============
// Unifica numa lista so o roadmap, o cronograma e o plano de saida do Neto —
// que antes moravam em docs/plano.html e numa pagina estatica com estado em
// localStorage (ou seja: so existia no navegador de quem marcou).
//
// O CONTEUDO NAO PODE ESTAR NO HTML. O repo docs/ e PUBLICO: qualquer um le o
// codigo-fonte no GitHub sem passar pela tela de senha, e o plano tem nome de
// fornecedor, nome de funcionario e faturamento por loja. Por isso tudo vem do
// Supabase com RLS exigindo `authenticated` — o anon nao tem nem permissao de
// SELECT na tabela. Sem sessao o modulo mostra o login, nunca uma lista vazia
// (lista vazia sem explicacao parece defeito).
let PLANO = null;

let PLANO_DONO = null;   // filtro por pessoa

let PLANO_ESTADO_F = null;   // filtro por estado: pendente | andando | feito | na

let PLANO_VER_ARQ = false;   // 22/10/2026: o arquivo (fase_ordem >= 90) fica fora da frente; o link do rodapé mostra

let PLANO_RECADOS = null;   // recados de todos os itens, numa lista so

let PLANO_APROVACOES = null;  // aprovacao linha a linha (tabela dentro do detalhe)

let PLANO_ITEM_ABERTO = null;   // qual item esta com os recados abertos

let PLANO_SO_VEZ = false;       // aviso de recados clicado: so as conversas que esperam por mim

let PLANO_EDITANDO = null;      // item cujo texto esta aberto para ajuste

// Detalhe recolhido (12/09/2026). VARIAVEL PROPRIA, de proposito: reusar
// PLANO_ITEM_ABERTO faria detalhe e recados se excluirem — abrir um fecharia o
// outro. A chave so passa a existir depois do clique; sem clique vale o padrao,
// e o padrao ABRE o item que tem aprovacao pendente, porque o sim/nao do dono
// (planoAprCelulas) mora DENTRO do detalhe: recolher esconderia a decisao dele.
let PLANO_DET_ABERTO = {};

function planoDetAberto(i) {
  if (!i || !i.detalhe) return false;
  if (Object.prototype.hasOwnProperty.call(PLANO_DET_ABERTO, i.id)) return PLANO_DET_ABERTO[i.id];
  // Aprovacao pendente abre sozinha — e FICA aberta. Responder a ultima linha tira
  // o 'pendente', e planoAprovarLinha redesenha o modulo a cada resposta (o onblur
  // de planoSalvarMudanca tambem): sem gravar aqui, o detalhe se fecharia na cara de
  // quem acabou de responder, no meio do trabalho.
  const pend = (PLANO_APROVACOES || []).some(a => a.item_id === i.id && (!a.estado || a.estado === 'pendente'));
  if (pend) PLANO_DET_ABERTO[i.id] = true;
  return pend;
}

function planoDetalheAlternar(id) {
  const it = (PLANO || []).find(x => x.id === id);
  PLANO_DET_ABERTO[id] = !planoDetAberto(it);
  renderModuloPlano();
}

const PLANO_ESTADOS = [
  ['andando', 'andando',      '#f6c63e'],
  ['feito',   'feito',        'var(--farol-ok)'],
  ['na',      'não se aplica','#8a897e'],
];

async function entrarPlano() {
  const alvo = document.getElementById('view-plano');
  if (!alvo) return;
  if (!rmbSessao()) { renderPlanoLogin(); return; }
  if (PLANO === null) {
    alvo.innerHTML = '<div class="contexto">Carregando o plano...</div>';
    const r = await fetch(`${SUPABASE_URL}/rest/v1/transicao_itens?select=*&order=fase_ordem,ordem`,
                          { headers: rmbHeaders() });
    if (!r.ok) {
      if (r.status === 401) { localStorage.removeItem('rmbSessao'); renderPlanoLogin(); return; }
      alvo.innerHTML = `<div class="contexto" style="border-color:var(--farol-fora);">Não consegui carregar (${r.status}).</div>`;
      return;
    }
    PLANO = await r.json();
  }
  await carregarEmailDono();   // decide quem pode marcar recado como lido
  if (PLANO_RECADOS === null && Array.isArray(PLANO) && PLANO.length) {
    const rr = await fetch(`${SUPABASE_URL}/rest/v1/transicao_recados?select=*&order=criado_em`,
                           { headers: rmbHeaders() });
    PLANO_RECADOS = rr.ok ? await rr.json() : [];
  }
  if (PLANO_APROVACOES === null && Array.isArray(PLANO) && PLANO.length) {
    const ra = await fetch(`${SUPABASE_URL}/rest/v1/transicao_aprovacoes?select=*&order=ordem`,
                           { headers: rmbHeaders() });
    PLANO_APROVACOES = ra.ok ? await ra.json() : [];
  }
  // Lista vazia AQUI nunca e' "nao ha o que fazer": o plano tem 61 itens. E o
  // banco dizendo que esta pessoa nao esta na lista de quem ve o Plano
  // (rmb_config.emails_plano). A policy devolve 200 com zero linhas, nao 401 —
  // sem este recado a pessoa veria "0 de 0 resolvidos" e acharia que quebrou.
  if (Array.isArray(PLANO) && PLANO.length === 0) { renderPlanoSemAcesso(); return; }
  renderModuloPlano();
}

// De quem e' a vez, derivado de quem escreveu por ultimo — nao de uma coluna
// de estado que alguem precisa lembrar de atualizar. Conversa encerrada nao
// espera ninguem.
function vezDaConversa(recados) {
  const vivos = recados.filter(r => !r.encerrado_em);
  if (!vivos.length) return null;
  const ultimo = vivos[vivos.length - 1];
  const doDono = (ultimo.quem || '').toLowerCase() === String(EMAIL_DONO || '').toLowerCase();
  // se o ultimo a falar foi o dono, a bola esta com quem propos; senao, com o dono
  return doDono ? { quem: 'autor', nome: (vivos[0].quem || '').split('@')[0] }
                : { quem: 'dono',  nome: (String(EMAIL_DONO || '')).split('@')[0] };
}

// Recados de um item: o historico + a caixa de escrever. Fica fechado por
// padrao — 61 itens com caixa de texto aberta viram uma parede.
// Recado que ninguem le nao serve para nada: a contagem fica no topo do
// modulo, antes da barra de progresso.
// Os itens cuja conversa esta esperando POR MIM. Saiu de dentro do aviso para a lista
// poder filtrar pelos MESMOS ids — dois lugares lendo a mesma conta, nao duas contas
// parecidas que um dia discordam.
function planoMinhaVez() {
  const eu = ((rmbSessao() || {}).email || '').toLowerCase();
  const itens = [...new Set((PLANO_RECADOS || []).filter(r => !r.encerrado_em).map(r => r.item_id))];
  return itens.filter(id => {
    const vez = vezDaConversa((PLANO_RECADOS || []).filter(r => r.item_id === id));
    if (!vez) return false;
    return vez.quem === 'dono' ? souODono()
                               : (PLANO_RECADOS || []).filter(r => r.item_id === id)[0].quem.toLowerCase() === eu;
  });
}

// O aviso E' o filtro: clicar deixa na tela so as conversas que esperam por mim,
// clicar de novo devolve a lista inteira.
function planoFiltrarVez() { PLANO_SO_VEZ = !PLANO_SO_VEZ; renderModuloPlano(); }

function avisoRecados(esc) {
  // conversas vivas em que a vez e' minha — e' isso que a pessoa precisa ver ao
  // abrir o modulo, nao a contagem geral de mensagens
  const minhaVez = planoMinhaVez();
  if (!minhaVez.length) return '';
  const nomes = minhaVez.map(id => {
    const it = (PLANO || []).find(i => i.id === id);
    return it ? it.titulo : id;
  });
  return `<div class="plano-aviso-recados" onclick="planoFiltrarVez()" style="cursor:pointer;" title="${PLANO_SO_VEZ ? 'Clique para voltar a ver a lista inteira.' : 'Clique para deixar na tela só estes itens.'}">
    <b>${minhaVez.length} ${minhaVez.length > 1 ? 'conversas esperam' : 'conversa espera'} você</b>
    — ${esc(nomes.join(' · '))}.
    <b>${PLANO_SO_VEZ ? '✕ mostrando só estes' : 'ver só estes →'}</b></div>`;
}

function blocoRecados(item, esc, sess) {
  const meus = (PLANO_RECADOS || []).filter(r => r.item_id === item.id);
  const eu = ((sess && sess.email) || '').toLowerCase();
  // "sem ler" e' o que os OUTROS escreveram e ninguem marcou como lido
  const novos = meus.filter(r => !r.visto_em && (r.quem || '').toLowerCase() !== eu).length;
  const vez = vezDaConversa(meus);
  const aberto = PLANO_ITEM_ABERTO === item.id;
  const etiqueta = vez
    ? `<span class="plano-vez${vez.quem === 'dono' && souODono() ? ' minha' : ''}">${
        vez.quem === 'dono'
          ? (souODono() ? 'esperando voc\u00ea' : 'esperando ' + esc(vez.nome))
          : 'esperando ' + esc(vez.nome)}</span>`
    : '';
  const rotulo = meus.length
    ? `${meus.length} recado${meus.length > 1 ? 's' : ''}${novos ? ' · ' + novos + ' sem ler' : ''}`
    : 'escrever um recado';

  const gatilho = `<button class="plano-recado-bt${novos ? ' tem-novo' : ''}"
      onclick="planoRecadosAlternar('${esc(item.id)}')">${aberto ? '\u25be' : '\u25b8'} ${rotulo}</button>${etiqueta}`;
  if (!aberto) return `<div class="plano-recados-linha">${gatilho}</div>`;

  const souDono = souODono();
  if (PLANO_EDITANDO === item.id) return `<div class="plano-recados-linha">${gatilho}${editorDoItem(item, esc)}</div>`;
  const linhas = meus.map(r => `
    <div class="plano-recado${r.visto_em ? ' lido' : ''}">
      <div class="plano-recado-cab">
        <b>${esc((r.quem || '').split('@')[0])}</b>
        <span>${new Date(r.criado_em).toLocaleDateString('pt-BR')} ${new Date(r.criado_em).toLocaleTimeString('pt-BR', {hour:'2-digit', minute:'2-digit'})}</span>
        ${r.visto_em ? '<span class="plano-recado-lido">lido</span>'
                     : (souDono ? `<button class="plano-recado-visto" onclick="planoRecadoVisto(${r.id})">marcar lido</button>` : '')}
      </div>
      <div class="plano-recado-txt">${esc(r.texto)}</div>
    </div>`).join('') || '<div class="plano-recado-vazio">Nenhum recado neste item ainda.</div>';

  // O aceite so aparece para o dono e so quando ha proposta esperando ele: e' o
  // "concordo" que vira mudanca no plano, em vez de virar mais uma mensagem.
  const aceite = (souDono && vez && vez.quem === 'dono')
    ? `<button class="preset-btn active" onclick="planoAceitar('${esc(item.id)}')">Concordo \u2014 ajustar o item</button>
       <button class="preset-btn" onclick="planoEncerrar('${esc(item.id)}')">Encerrar sem mudar</button>`
    : '';

  return `<div class="plano-recados-linha">${gatilho}
    <div class="plano-recados">
      ${linhas}
      <textarea id="planoRecadoTexto" rows="2" placeholder="${souDono
        ? 'Responder \u2014 a pergunta volta para quem escreveu'
        : 'O que voc\u00ea mudaria nesta atividade? (fica salvo para todo mundo do plano)'}"></textarea>
      <div class="plano-recado-envio">
        <button class="preset-btn active" onclick="planoRecadoEnviar('${esc(item.id)}')">${souDono ? 'Responder' : 'Enviar recado'}</button>
        ${aceite}
        <span id="planoRecadoMsg"></span>
      </div>
    </div></div>`;
}

// O editor do texto do item. Abre no "Concordo": aceitar uma proposta e' mudar
// o plano, nao responder "ok". O banco so deixa o dono chegar aqui (trigger
// trg_transicao_item_texto).
function editorDoItem(item, esc) {
  return `<div class="plano-recados plano-editor">
    <div class="plano-editor-tit">Ajustando o item \u2014 o que ficar aqui vale para todo mundo</div>
    <label>t\u00edtulo<input id="planoEdTitulo" type="text" value="${esc(item.titulo || '')}"></label>
    <label>detalhe<textarea id="planoEdDetalhe" rows="3">${esc(item.detalhe || '')}</textarea></label>
    <div class="plano-editor-linha">
      <label>dono<input id="planoEdQuem" type="text" value="${esc(item.quem || '')}"></label>
      <label>depende de<input id="planoEdDep" type="text" value="${esc(item.dependencia || '')}"></label>
    </div>
    <div class="plano-recado-envio">
      <button class="preset-btn active" onclick="planoSalvarItem('${esc(item.id)}')">Salvar e encerrar a conversa</button>
      <button class="preset-btn" onclick="planoCancelarEdicao()">Cancelar</button>
      <span id="planoRecadoMsg"></span>
    </div>
  </div>`;
}

function planoAceitar(id) { PLANO_EDITANDO = id; PLANO_ITEM_ABERTO = id; renderModuloPlano(); }

function planoCancelarEdicao() { PLANO_EDITANDO = null; renderModuloPlano(); }

async function planoSalvarItem(id) {
  const msg = document.getElementById('planoRecadoMsg');
  const item = (PLANO || []).find(i => i.id === id);
  if (!item) return;
  const novo = {
    titulo: document.getElementById('planoEdTitulo').value.trim(),
    detalhe: document.getElementById('planoEdDetalhe').value.trim() || null,
    quem: document.getElementById('planoEdQuem').value.trim() || null,
    dependencia: document.getElementById('planoEdDep').value.trim() || null,
    atualizado_em: new Date().toISOString(),
    atualizado_por: (rmbSessao() || {}).email || null,
  };
  if (!novo.titulo) { if (msg) msg.textContent = 'O t\u00edtulo n\u00e3o pode ficar vazio.'; return; }
  if (msg) msg.textContent = 'salvando...';
  const r = await fetch(`${SUPABASE_URL}/rest/v1/transicao_itens?id=eq.${encodeURIComponent(id)}`, {
    method: 'PATCH', headers: rmbHeaders({ Prefer: 'return=representation' }),
    body: JSON.stringify(novo),
  });
  if (!r.ok) { if (msg) msg.textContent = 'n\u00e3o deu (' + r.status + '): ' + (await r.text()).slice(0, 90); return; }
  const [atualizado] = await r.json();
  PLANO = PLANO.map(i => i.id === id ? (atualizado || i) : i);
  // fica escrito na conversa o que mudou, e ela se encerra
  const mudou = ['titulo','detalhe','quem','dependencia']
    .filter(c => (item[c] || '') !== (novo[c] || ''))
    .map(c => c === 'quem' ? 'dono' : c);
  await planoRecadoCriar(id, mudou.length
    ? 'Aceito e aplicado no item: ' + mudou.join(', ') + '.'
    : 'Aceito \u2014 sem mudar o texto do item.');
  await planoEncerrar(id, true);
  PLANO_EDITANDO = null;
  renderModuloPlano();
}

// Encerra a conversa do item: some a etiqueta de "esperando fulano".
async function planoEncerrar(id, silencioso) {
  const abertos = (PLANO_RECADOS || []).filter(r => r.item_id === id && !r.encerrado_em);
  if (!abertos.length) { if (!silencioso) renderModuloPlano(); return; }
  const agora = new Date().toISOString();
  const quem = (rmbSessao() || {}).email || null;
  const r = await fetch(`${SUPABASE_URL}/rest/v1/transicao_recados?item_id=eq.${encodeURIComponent(id)}&encerrado_em=is.null`, {
    method: 'PATCH', headers: rmbHeaders({ Prefer: 'return=minimal' }),
    body: JSON.stringify({ encerrado_em: agora, encerrado_por: quem,
                           visto_em: agora, visto_por: quem }),
  });
  if (r.ok) {
    PLANO_RECADOS = (PLANO_RECADOS || []).map(x =>
      (x.item_id === id && !x.encerrado_em)
        ? { ...x, encerrado_em: agora, encerrado_por: quem, visto_em: x.visto_em || agora }
        : x);
  }
  if (!silencioso) renderModuloPlano();
}

function planoRecadosAlternar(id) {
  PLANO_ITEM_ABERTO = (PLANO_ITEM_ABERTO === id) ? null : id;
  renderModuloPlano();
  const cx = document.getElementById('planoRecadoTexto');
  if (cx) cx.focus();
}

// `quem` vai do lado de ca, mas quem manda e' o banco: a policy exige que seja
// o e-mail do proprio token, entao ninguem assina por outra pessoa.
async function planoRecadoCriar(itemId, texto) {
  const sess = rmbSessao();
  if (!sess) { exigirLogin('Entre de novo para escrever.'); return null; }
  const r = await fetch(`${SUPABASE_URL}/rest/v1/transicao_recados`, {
    method: 'POST',
    headers: rmbHeaders({ Prefer: 'return=representation' }),
    body: JSON.stringify({ item_id: itemId, quem: sess.email, texto }),
  });
  if (!r.ok) return { erro: r.status + ': ' + (await r.text()).slice(0, 90) };
  const [novo] = await r.json();
  PLANO_RECADOS = (PLANO_RECADOS || []).concat(novo ? [novo] : []);
  return novo;
}

async function planoRecadoEnviar(itemId) {
  const cx = document.getElementById('planoRecadoTexto');
  const msg = document.getElementById('planoRecadoMsg');
  const texto = (cx ? cx.value : '').trim();
  if (!texto) { if (msg) msg.textContent = 'Escreva alguma coisa primeiro.'; return; }
  if (msg) msg.textContent = 'enviando...';
  const novo = await planoRecadoCriar(itemId, texto);
  if (novo && novo.erro) { if (msg) msg.textContent = 'n\u00e3o deu (' + novo.erro + ')'; return; }
  renderModuloPlano();
}

async function planoRecadoVisto(id) {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/transicao_recados?id=eq.${id}`, {
    method: 'PATCH',
    headers: rmbHeaders({ Prefer: 'return=representation' }),
    body: JSON.stringify({ visto_em: new Date().toISOString(),
                           visto_por: (rmbSessao() || {}).email || null }),
  });
  if (!r.ok) return;
  const [atualizado] = await r.json();
  PLANO_RECADOS = (PLANO_RECADOS || []).map(x => x.id === id ? (atualizado || x) : x);
  renderModuloPlano();
}

// ---------------------------------------------------------------- Telas do painel
// Onde mora o acompanhamento dos modulos. O Plano diz o que FAZER; esta tela diz o
// que EXISTE, o que cada coisa responde e para onde ela vai quando o Neto sair.
// `destino` e' a unica decisao aqui — e boa parte fica com ele na consultoria.
let TELAS = null;

let TELAS_FILTRO = null;

let TELAS_CAMADA_FILTRO = null;   // segundo recorte, ao lado do destino: a camada

const TELAS_DESTINOS = [
  ['equipe',      'passa',       'var(--farol-ok)'],
  ['consultoria', 'consultoria', 'var(--info)'],
  ['morre',       'morre',       'var(--tx-4)'],
  ['a definir',   'a definir',   ''],
];
// 12/11/2026 (usabilidade, telas): a consultoria acabou em 15/10 — o botão só aparece se alguma tela ainda estiver nele
function telasDestinos() {
  return TELAS_DESTINOS.filter(([v]) => v !== 'consultoria' || (TELAS || []).some((t) => t.destino === 'consultoria'));
}

// CAMADA — decidida pelo dono em 12/09/2026, nas 44 linhas da revisao dos modulos.
// Nao e' botao: ja esta decidido, e o que a tela faz e' MOSTRAR a decisao para nao se
// perder. Nao confundir com `destino`, que e' a sucessao e continua sendo escolha dele.
const TELAS_CAMADAS = {
  PLACAR:     ['vira o Placar',      'var(--brand)',      'o conteúdo vira o Placar, com período e comparação'],
  QUEBRA:     ['vira quebra',        'var(--info)',       'é o que abre ao clicar num número do Placar'],
  DETALHE:    ['detalhe',            'var(--farol-ok)',   'alcançada pela quebra; continua existindo, com dono'],
  FERRAMENTA: ['ferramenta',         'var(--tx-4)',       'alguém opera nela: lança, marca, confere'],
  CONSERTO:   ['conserto',           'var(--amber-2)',    'fica, mas tem defeito medido para corrigir antes'],
  APOSENTAR:  ['aposentada',         'var(--farol-fora)', 'saiu do menu'],
};

async function entrarTelas() {
  const alvo = document.getElementById('view-telas');
  if (!alvo) return;
  if (!rmbSessao()) {
    alvo.innerHTML = '<div class="contexto">Entre no painel para ver esta tela.</div>';
    return;
  }
  if (TELAS === null) {
    alvo.innerHTML = '<div class="contexto">Carregando as telas...</div>';
    const r = await fetch(SUPABASE_URL + '/rest/v1/painel_telas?select=*&order=ordem',
                          { headers: rmbHeaders() });
    if (!r.ok) {
      alvo.innerHTML = '<div class="contexto" style="border-color:var(--farol-fora);">Nao consegui carregar (' + r.status + ').</div>';
      return;
    }
    TELAS = await r.json();
  }
  renderModuloTelas();
}

async function telasGravar(chave, campos) {
  const corpo = Object.assign({}, campos, {
    atualizado_em: new Date().toISOString(),
    atualizado_por: (rmbSessao() || {}).email || ''
  });
  // 12/11/2026 (usabilidade): enviando → ✓/✗ na barra do núcleo, no lugar do alert e da borda verde que sumia
  const tela = (TELAS.find(t => t.chave === chave) || {}).rotulo || chave;
  const deNovo = () => telasGravar(chave, campos).then((v) => { if (v) renderModuloTelas(); });
  avisoAcao('enviando', 'Salvando ' + tela + '…');
  let r;
  try {
    r = await fetch(SUPABASE_URL + '/rest/v1/painel_telas?chave=eq.' + encodeURIComponent(chave), {
      method: 'PATCH',
      headers: Object.assign({}, rmbHeaders(), { 'Content-Type': 'application/json', Prefer: 'return=representation' }),
      body: JSON.stringify(corpo)
    });
  } catch (e) { avisoAcao('erro', '✗ ' + tela + ' NÃO foi salva: sem conexão.', deNovo); return null; }
  if (!r.ok) { avisoAcao('erro', '✗ ' + tela + ' NÃO foi salva (' + r.status + ').', deNovo); return null; }
  const volta = await r.json();
  const i = TELAS.findIndex(t => t.chave === chave);
  if (i >= 0 && volta.length) TELAS[i] = volta[0];
  if (!volta.length) { avisoAcao('erro', '✗ ' + tela + ' NÃO foi salva (sem permissão).', deNovo); return null; }
  avisoAcao('ok', '✓ ' + tela + ' salva às ' + avisoHora() + '.');
  return volta[0];
}

async function telasDestino(chave, destino) {
  await telasGravar(chave, { destino: destino });
  renderModuloTelas();
}

// Salva ao sair do campo, e NAO redesenha: quem edita uma linha costuma editar a de
// baixo em seguida, e redesenhar a tabela rouba o foco. O aviso e' a barra do nucleo (✓/✗, nao some sozinho).
async function telasCampo(chave, campo, el) {
  const atual = TELAS.find(t => t.chave === chave);
  const txt = el.value.trim();
  if (!atual || (atual[campo] || '') === txt) return;
  const d = {};
  d[campo] = txt || null;
  await telasGravar(chave, d);
}

function telasFiltrar(d) {
  TELAS_FILTRO = (TELAS_FILTRO === d) ? null : d;
  renderModuloTelas();
}

// Mesmo mecanismo do filtro de destino, num segundo eixo: clicar de novo no chip
// aceso desliga. Os dois recortes se somam (destino E camada).
function telasCamada(c) {
  TELAS_CAMADA_FILTRO = (TELAS_CAMADA_FILTRO === c) ? null : c;
  renderModuloTelas();
}

function renderModuloTelas() {
  const alvo = document.getElementById('view-telas');
  if (!alvo || TELAS === null) return;
  const esc = (x) => String(x == null ? '' : x).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/'/g, '&#39;');
  const campo = (t, nome, ph, linhas) =>
    '<textarea class="telas-campo" rows="' + linhas + '" placeholder="' + ph + '" '
    + 'onblur="telasCampo(&#39;' + esc(t.chave) + '&#39;,&#39;' + nome + '&#39;,this)">'
    + esc(t[nome] || '') + '</textarea>';

  // Os dois recortes se somam (destino E camada); qualquer um deles vazio nao filtra.
  const lista = TELAS.filter(t => (!TELAS_FILTRO || t.destino === TELAS_FILTRO)
                               && (!TELAS_CAMADA_FILTRO || t.camada === TELAS_CAMADA_FILTRO));
  const decididas = TELAS.filter(t => t.destino !== 'a definir').length;
  const pct = TELAS.length ? decididas / TELAS.length * 100 : 0;
  // Linha sem "o que esta tela responde" ou sem "quem olha" nao da para decidir:
  // fica marcada em ambar na tabela e a contagem aparece ao lado da barra.
  // Marca, nunca esconde — some da vista e' como esse campo ficou vazio.
  const semBase = TELAS.filter(t => !String(t.responde || '').trim() || !String(t.quem || '').trim()).length;

  let grupo = null;
  const linhas = lista.map(t => {
    let cab = '';
    if (t.grupo !== grupo) {
      grupo = t.grupo;
      cab = '<tr class="telas-grupo"><td colspan="6">' + esc(grupo) + '</td></tr>';
    }
    const dest = telasDestinos().map(([v, rot, cor]) =>
      '<button class="' + (t.destino === v ? 'sel' : '') + '" '
      + 'style="' + (t.destino === v && cor ? 'color:' + cor + ';border-color:' + cor + ';' : '') + '" '
      + 'onclick="telasDestino(&#39;' + esc(t.chave) + '&#39;,&#39;' + v + '&#39;)">' + rot + '</button>').join('');
    const carimbo = t.atualizado_em
      ? '<div style="font-size:10px;color:var(--tx-4);margin-top:3px;">'
        + esc((t.atualizado_por || '').split('@')[0]) + ' · '
        + new Date(t.atualizado_em).toLocaleDateString('pt-BR') + '</div>'
      : '';
    const cam = TELAS_CAMADAS[t.camada];
    const selo = cam
      ? '<div style="font-size:10px; letter-spacing:.06em; text-transform:uppercase; color:' + cam[1]
        + '; margin-top:3px;" title="' + esc(cam[2]) + '">' + cam[0] + '</div>'
      : '';
    const faltas = [!String(t.responde || '').trim() ? 'o que esta tela responde' : '',
                    !String(t.quem || '').trim() ? 'quem olha' : ''].filter(Boolean);
    const marcaFalta = faltas.length
      ? ' style="border-left:3px solid var(--farol-perto);" title="Falta preencher: ' + faltas.join(' e ') + '"'
      : '';
    return cab + '<tr>'
      + '<td' + marcaFalta + '>' + esc(t.rotulo) + selo + '</td>'
      + '<td style="min-width:230px;">' + campo(t, 'responde', 'o que esta tela responde', 2) + '</td>'
      + '<td style="min-width:110px;">' + campo(t, 'quem', 'quem olha', 1) + '</td>'
      + '<td style="min-width:95px;">' + campo(t, 'cadencia', 'frequencia', 1) + '</td>'
      + '<td style="min-width:155px;"><div class="telas-dest">' + dest + '</div>' + carimbo + '</td>'
      + '<td style="min-width:150px;">' + campo(t, 'nota', '', 2) + '</td>'
      + '</tr>';
  }).join('');

  // Cada dimensao conta DENTRO do recorte da outra, e nunca dentro do proprio: e' a
  // regra da Evolucao — a dimensao filtrada continua mostrando todas as categorias,
  // senao o chip aceso vira "12 de 12" e some o caminho de volta.
  const porCamada = TELAS_CAMADA_FILTRO ? TELAS.filter(t => t.camada === TELAS_CAMADA_FILTRO) : TELAS;
  const porDestino = TELAS_FILTRO ? TELAS.filter(t => t.destino === TELAS_FILTRO) : TELAS;
  const chips = telasDestinos().map(([v, rot]) => {
    const n = porCamada.filter(t => t.destino === v).length;
    return '<button class="preset-btn ' + (TELAS_FILTRO === v ? 'active' : '') + '" '
         + 'onclick="telasFiltrar(&#39;' + v + '&#39;)">' + rot + ' ' + n + '</button>';
  }).join(' ');

  const chipsCamada = Object.entries(TELAS_CAMADAS).map(([k, c]) => {
    const n = porDestino.filter(t => t.camada === k).length;
    return '<button class="preset-btn ' + (TELAS_CAMADA_FILTRO === k ? 'active' : '') + '" '
         + 'style="color:' + c[1] + ';" title="' + esc(c[2]) + '" '
         + 'onclick="telasCamada(&#39;' + k + '&#39;)">' + c[0] + ' ' + n + '</button>';
  }).join(' ');

  alvo.innerHTML =
      '<div class="section-label" style="border-top:none; margin-top:0; padding-top:0;">Telas do painel</div>'
    + '<div class="caption-label" style="text-align:center;">Escolha o <b>destino</b> de cada tela; o campo salva ao sair dele.</div>'
    + '<div class="plano-barra">'
    + '<div class="plano-contagem"><b>' + decididas + '</b> de ' + TELAS.length + ' com destino definido'
    + (semBase ? ' <span style="color:var(--farol-perto);" title="São as linhas marcadas em âmbar na tabela: sem o que a tela responde, ou sem quem olha.">· ' + semBase + ' sem o básico preenchido</span>' : '')
    + '</div>'
    + '<div class="plano-trilho"><div class="plano-preenche" style="width:' + pct.toFixed(1) + '%;"></div></div></div>'
    + '<div style="text-align:center; margin:10px 0;">'
    + '<button class="preset-btn ' + (TELAS_FILTRO ? '' : 'active') + '" onclick="telasFiltrar(null)">todas ' + porCamada.length + '</button> '
    + chips
    + '<span style="display:inline-block; width:16px;"></span>'
    + '<button class="preset-btn ' + (TELAS_CAMADA_FILTRO ? '' : 'active') + '" onclick="telasCamada(null)">todas as camadas</button> '
    + chipsCamada + '</div>'
    + '<div id="tabelaTelas" class="telas-rolo"><table class="telas-tab"><thead><tr>'
    + '<th>Tela</th><th>O que responde</th><th>Quem olha</th><th>Cadência</th><th>Destino</th><th>Nota</th>'
    + '</tr></thead><tbody>' + linhas + '</tbody></table></div>';
}

function renderPlanoSemAcesso() {
  const alvo = document.getElementById('view-plano');
  // esc local, como nas demais telas: nao existe um esc global neste arquivo
  const esc = (x) => String(x == null ? '' : x).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/'/g,'&#39;');
  const quem = (rmbSessao() || {}).email || '';
  alvo.innerHTML = `
    <div class="section-label" style="border-top:none; margin-top:0; padding-top:0;">Plano</div>
    <div class="contexto" style="max-width:520px; margin:22px auto; text-align:left;">
      <p style="margin:0 0 10px;"><b>Este módulo é restrito.</b> Você está logado
         normalmente${quem ? ' como ' + esc(quem) : ''} e o resto do painel funciona — só o Plano
         que não abre para a sua conta.</p>
      <p style="margin:0; color:var(--tx-3);">Se você precisa acompanhar o plano, fale com o Neto:
         é uma linha de configuração, resolve em um minuto.</p>
    </div>`;
}

function renderPlanoLogin() {
  const alvo = document.getElementById('view-plano');
  alvo.innerHTML = `
    <div class="section-label" style="border-top:none; margin-top:0; padding-top:0;">Plano</div>
    <div class="caption-label" style="text-align:center;">
      Tudo que precisa acontecer, com dono e estado. <b>Precisa entrar para ver</b> — o plano
      tem nome de fornecedor, de funcionário e faturamento por loja, e este painel é público.</div>
    <div class="contexto" style="max-width:420px; margin:16px auto; text-align:left;">
      <div style="margin-bottom:8px;"><input id="planoEmail" type="text" autocapitalize="none" autocorrect="off" spellcheck="false" placeholder="seu nome (ex.: rita)"
        style="width:100%; padding:8px 10px; background:#171716; color:#f2f0e9; border:1px solid #45443f; border-radius:6px;"></div>
      <div style="margin-bottom:10px;"><input id="planoSenha" type="password" placeholder="senha"
        onkeydown="if(event.key==='Enter')planoLogin()"
        style="width:100%; padding:8px 10px; background:#171716; color:#f2f0e9; border:1px solid #45443f; border-radius:6px;"></div>
      <button class="preset-btn active" onclick="planoLogin()">Entrar</button>
      <div id="planoLoginErro" class="contexto" style="display:none; border-color:var(--farol-fora); margin-top:10px;"></div>
    </div>`;
}

async function planoLogin() {
  if (!(await rmbFazerLogin('plano'))) return;   // sem sessao, o erro fica na tela
  PLANO = null;
  entrarPlano();
}

function planoSair() { rmbSair(); PLANO = null; entrarPlano(); }

function planoFiltrar(quem) { PLANO_DONO = (PLANO_DONO === quem) ? null : quem; renderModuloPlano(); }

// O mesmo mecanismo do filtro de pessoa, agora por estado: clicar liga, clicar de novo solta.
function planoFiltrarEstado(e) { PLANO_ESTADO_F = (PLANO_ESTADO_F === e) ? null : e; renderModuloPlano(); }

async function planoMarcar(id, estado) {
  const it = PLANO.find(x => x.id === id);
  if (!it) return;
  const novo = (it.estado === estado) ? 'pendente' : estado;
  const antes = it.estado;
  it.estado = novo;                    // pinta na hora; desfaz se o banco recusar
  renderModuloPlano();
  const r = await fetch(`${SUPABASE_URL}/rest/v1/transicao_itens?id=eq.${encodeURIComponent(id)}`, {
    method: 'PATCH', headers: rmbHeaders({ Prefer: 'return=representation' }),
    body: JSON.stringify({ estado: novo }),
  });
  if (!r.ok) {
    it.estado = antes;
    renderModuloPlano();
    alert('Não consegui salvar (' + r.status + '). O item voltou como estava.');
    return;
  }
  const [salvo] = await r.json();
  if (salvo) { it.atualizado_por = salvo.atualizado_por; it.atualizado_em = salvo.atualizado_em; }
  renderModuloPlano();
}

// O detalhe do item aceita TABELA: linha que comeca com "|" vira linha de
// tabela, e "|---" marca o cabecalho. O resto e' texto, com quebra de linha
// preservada. Nasceu em 22/08/2026 do item que pede aprovacao da distribuicao
// dos grupos: em texto corrido eram dez pessoas numa parede de palavras e o
// Neto disse, com razao, que assim nao se decide.
// Celula de aprovacao de UMA linha. Fica colada na propria linha de proposito:
// aprovar num campo separado obriga a pessoa a repetir de qual linha esta falando,
// e foi por isso que a aprovacao anterior travou (pedido do Neto, 24/08).
function planoAprCelulas(apr, esc) {
  if (!apr) return '<td class="plano-apr"></td><td class="plano-apr"></td>';
  const ok  = apr.estado === 'aprovado';
  const mud = apr.estado === 'mudar';
  const carimbo = apr.atualizado_em
    ? '<div class="plano-apr-carimbo">' + esc((apr.atualizado_por || '').split('@')[0])
      + ' \u00b7 ' + new Date(apr.atualizado_em).toLocaleDateString('pt-BR') + '</div>'
    : '';
  return '<td class="plano-apr">'
     + '<div class="plano-apr-bts">'
     + '<button class="plano-apr-bt' + (ok ? ' ok' : '') + '" onclick="planoAprovarLinha(\'' + esc(apr.id) + '\',\'aprovado\')">'
     + (ok ? '\u2713 aprovado' : 'aprovar') + '</button>'
     + '<button class="plano-apr-bt' + (mud ? ' mud' : '') + '" onclick="planoAprovarLinha(\'' + esc(apr.id) + '\',\'mudar\')">mudar</button>'
     + '</div>' + carimbo
     + '</td><td class="plano-apr">'
     + '<textarea id="apr-' + esc(apr.id) + '" rows="2" placeholder="o que mudar" '
     + 'onblur="planoSalvarMudanca(\'' + esc(apr.id) + '\')">' + esc(apr.mudanca || '') + '</textarea>'
     + '</td>';
}

async function planoAprovarLinha(id, estado) {
  const campo = document.getElementById('apr-' + id);
  const corpo = { estado: estado, atualizado_em: new Date().toISOString(),
                  atualizado_por: (rmbSessao() || {}).email || '' };
  if (estado === 'aprovado') corpo.mudanca = null;
  else if (campo) corpo.mudanca = campo.value.trim() || null;
  const r = await fetch(SUPABASE_URL + '/rest/v1/transicao_aprovacoes?id=eq.' + encodeURIComponent(id), {
    method: 'PATCH',
    headers: Object.assign({}, rmbHeaders(), { 'Content-Type': 'application/json', Prefer: 'return=representation' }),
    body: JSON.stringify(corpo)
  });
  if (!r.ok) { alert('Nao consegui gravar (' + r.status + ').'); return; }
  const volta = await r.json();
  const i = (PLANO_APROVACOES || []).findIndex(a => a.id === id);
  if (i >= 0 && volta.length) PLANO_APROVACOES[i] = volta[0];
  renderModuloPlano();
}

// Grava o texto ao sair do campo, e escrever ja marca a linha como "mudar":
// quem digita uma mudanca esta discordando, nao precisa clicar em dois lugares.
async function planoSalvarMudanca(id) {
  const campo = document.getElementById('apr-' + id);
  if (!campo) return;
  const atual = (PLANO_APROVACOES || []).find(a => a.id === id);
  const txt = campo.value.trim();
  if (!atual || (atual.mudanca || '') === txt) return;
  await planoAprovarLinha(id, txt ? 'mudar' : 'pendente');
}

// mesma celula, para aprovacao que nao tem linha de tabela
function planoAprCelulasSoltas(apr, esc) {
  return '<table style="border:0;width:100%"><tr>'
       + planoAprCelulas(apr, esc).replace(/class="plano-apr"/g,
           'class="plano-apr" style="border:0;padding:0 6px 0 0"')
       + '</tr></table>';
}

function planoDetalhe(texto, esc, aprovacoes) {
  const linhas = String(texto).split('\n');
  const saida = [];
  let bloco = [];        // linhas de texto acumuladas
  let tabela = null;     // {cab: [], linhas: [[]]}
  const aprs = Array.isArray(aprovacoes) ? aprovacoes.slice() : [];
  const usadas = new Set();
  const achaApr = (rotulo) => {
    const chave = String(rotulo || '').trim().toLowerCase();
    const a = aprs.find(x => !usadas.has(x.id) && String(x.linha).trim().toLowerCase() === chave);
    if (a) usadas.add(a.id);
    return a;
  };

  const fechaTexto = () => {
    if (bloco.length) { saida.push('<span class="plano-txt">' + esc(bloco.join('\n')) + '</span>'); bloco = []; }
  };
  const fechaTabela = () => {
    if (!tabela) return;
    // so ganha colunas de aprovacao se ALGUMA linha casar com um rotulo do banco
    const pares = tabela.linhas.map(l => achaApr(l[0]));
    const temApr = aprs.length && pares.some(Boolean);
    const cab = tabela.cab
      ? '<thead><tr>' + tabela.cab.map(c => '<th>' + esc(c) + '</th>').join('')
        + (temApr ? '<th>Aprova?</th><th>O que mudar</th>' : '') + '</tr></thead>' : '';
    const corpo = tabela.linhas
      .map((l, n) => '<tr>' + l.map(c => '<td>' + esc(c) + '</td>').join('')
                   + (temApr ? planoAprCelulas(pares[n], esc) : '') + '</tr>').join('');
    const tab = '<table class="plano-tab' + (temApr ? ' plano-tab-apr' : '') + '">' + cab + '<tbody>' + corpo + '</tbody></table>';
    saida.push(temApr ? '<div class="plano-tab-rolo">' + tab + '</div>' : tab);
    tabela = null;
  };

  for (const linha of linhas) {
    const t = linha.trim();
    if (t.startsWith('|')) {
      fechaTexto();
      const celulas = t.replace(/^\|/, '').replace(/\|$/, '').split('|').map(x => x.trim());
      if (celulas.every(x => /^-{2,}$/.test(x))) {          // separador: o que veio antes era cabecalho
        if (tabela && tabela.linhas.length) { tabela.cab = tabela.linhas.shift(); }
        continue;
      }
      if (!tabela) tabela = { cab: null, linhas: [] };
      tabela.linhas.push(celulas);
    } else {
      fechaTabela();
      bloco.push(linha);
    }
  }
  fechaTabela();
  fechaTexto();
  // Aprovacao sem linha de tabela (os blocos de texto: o que morre, o que fica
  // fora) tambem precisa de sim/nao — senao fica decidida por omissao.
  const sobra = aprs.filter(a => !usadas.has(a.id));
  if (sobra.length) {
    saida.push('<div style="margin-top:10px;">' + sobra.map(a =>
      '<div class="plano-apr-solta"><b>' + esc(a.linha) + '</b>'
      + '<div>' + planoAprCelulasSoltas(a, esc) + '</div></div>').join('') + '</div>');
  }
  return saida.join('');
}

// EM DESENVOLVIMENTO (dono, sáb 07/11/2026 03:54 e 03:59: o Fabio acompanha "o que estou desenvolvendo com vc e a evolução";
// "Plano: manter, alimentado automaticamente"). O plano já se atualiza sozinho (rotina atualizar-plano-saida, 20:00: commits,
// decisões do livro, rotinas e, desde 07/11, o que o dono resolveu na agenda). Aqui, em cima: quanto de cada fase está
// pronto e o que andou nos últimos 7 dias. Só título, fase e andamento — nunca nota do dono.
function planoEmDesenvolvimento(ativos, esc) {
  if (!ativos.length) return '';
  const pronto = (i) => i.estado === 'feito' || i.estado === 'na';
  const fases = {};
  ativos.forEach((i) => { (fases[i.fase_ordem] = fases[i.fase_ordem] || { titulo: i.fase_titulo, quando: i.fase_quando, itens: [] }).itens.push(i); });
  const cartoes = Object.keys(fases).sort((a, b) => a - b).map((k) => {
    const f = fases[k], n = f.itens.length, ok = f.itens.filter(pronto).length, and = f.itens.filter((i) => i.estado === 'andando').length;
    // os itens só viram "feito" perto de 31/12: a evolução está no que já saiu do papel (andando) — barra em três partes
    const p = (x) => n ? (x / n * 100).toFixed(1) : 0, falta = n - ok - and;
    return `<div class="card neutral" style="text-align:left;"><div class="card-lbl" style="white-space:normal;">${esc(f.titulo)}</div>
      <div class="card-val">${ok + and} de ${n}</div>
      <div title="pronto · andando · a começar" style="display:flex;height:8px;border-radius:4px;overflow:hidden;background:var(--line);margin:4px 0 6px;">
        <div style="width:${p(ok)}%;background:var(--farol-ok);"></div><div style="width:${p(and)}%;background:var(--farol-perto);"></div></div>
      <div class="card-pct">${ok ? `<span style="color:var(--farol-ok);">${ok} pronto${ok === 1 ? '' : 's'}</span> · ` : ''}${and} andando${falta ? ` · ${falta} a começar` : ''}${f.quando ? ` · ${esc(f.quando)}` : ''}</div></div>`;
  }).join('');
  const hoje = new Date(new Date().toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' }) + 'T12:00:00');
  const corte = new Date(hoje); corte.setDate(corte.getDate() - 7);
  const dataDe = (i) => String(i.andamento_em || '').slice(0, 10);
  const semana = ativos.filter((i) => i.andamento && dataDe(i) && new Date(dataDe(i) + 'T12:00:00') >= corte)
    .sort((a, b) => dataDe(b).localeCompare(dataDe(a)) || Number(a.fase_ordem) - Number(b.fase_ordem));
  const dm = (d) => d.slice(8, 10) + '/' + d.slice(5, 7);
  const linhas = semana.map((i) => {
    const [feito, falta] = String(i.andamento).split(/EM CONSTRU[ÇC][ÃA]O:\s*/i);
    return `<div style="padding:9px 0;border-top:1px solid var(--line);">
      <div style="display:flex;gap:10px;justify-content:space-between;align-items:baseline;"><b>${esc(i.titulo)}</b><span style="font-size:11.5px;color:var(--tx-4);white-space:nowrap;">${dm(dataDe(i))}${pronto(i) ? ' · <span style="color:var(--farol-ok);">✓ pronto</span>' : ''}</span></div>
      <div style="font-size:13px;color:var(--tx-2);margin-top:3px;">${esc(feito.trim())}</div>
      ${falta ? `<div style="font-size:12.5px;color:var(--farol-perto);margin-top:3px;">Em construção: ${esc(falta.trim())}</div>` : ''}</div>`;
  }).join('');
  let aberto = true; try { aberto = sessionStorage.getItem('planoSemanaFechada') !== '1'; } catch (e) {}
  return `<div class="cards" style="grid-template-columns:repeat(auto-fit,minmax(200px,1fr));margin-bottom:14px;">${cartoes}</div>
    <details${aberto ? ' open' : ''} ontoggle="try{sessionStorage.setItem('planoSemanaFechada',this.open?'0':'1')}catch(e){}" style="text-align:left;margin:0 0 18px;padding:10px 14px;border:1px solid var(--line);border-radius:10px;background:var(--surface);">
      <summary style="cursor:pointer;font-weight:700;">Andou nos últimos 7 dias <span style="font-weight:400;color:var(--tx-4);font-size:12px;">· ${semana.length} ${semana.length === 1 ? 'frente' : 'frentes'}, atualizado todo dia às 20:00</span></summary>
      ${linhas || '<div class="contexto" style="margin-top:8px;">Nada andou nos últimos 7 dias.</div>'}</details>`;
}

function renderModuloPlano() {
  const alvo = document.getElementById('view-plano');
  if (!alvo || PLANO === null) return;
  const esc = (x) => String(x == null ? '' : x).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/'/g,'&#39;');
  const sess = rmbSessao();

  // FILTROS LIMPOS (dono, 22/10/2026). O arquivo da revisão de 22/10 (fase_ordem >= 90) sai da frente; a pessoa é a
  // dono_curto (uma por item), não o texto inteiro do "quem", que dava ~50 botões.
  const ativos = PLANO.filter(i => Number(i.fase_ordem) < 90);
  const nArq = PLANO.length - ativos.length;
  const universo = PLANO_VER_ARQ ? PLANO.filter(i => Number(i.fase_ordem) >= 90) : ativos;
  const pessoaDe = (i) => i.dono_curto || (i.quem || '').split(/[ (·]/)[0] || '—';
  const donos = [...new Set(universo.map(pessoaDe))].sort((a, b) => universo.filter(i => pessoaDe(i) === b).length - universo.filter(i => pessoaDe(i) === a).length || a.localeCompare(b));
  // 'pendente' e' o estado de quem ainda nao foi tocado: o banco pode trazer vazio e os
  // botoes gravam essa palavra quando a pessoa desmarca. Um lugar so decide qual e'.
  const estadoDe = (i) => i.estado || 'pendente';
  const baseEstado = PLANO_DONO ? universo.filter(i => pessoaDe(i) === PLANO_DONO) : universo;
  const lista = PLANO_ESTADO_F ? baseEstado.filter(i => estadoDe(i) === PLANO_ESTADO_F) : baseEstado;
  const feitos = lista.filter(i => i.estado === 'feito' || i.estado === 'na').length;
  const pct = lista.length ? feitos / lista.length * 100 : 0;

  // O QUE JA FOI FEITO SAI DA FRENTE (pedido do dono, 24/08/2026): fica num
  // bloco recolhido no topo, que abre com um clique. Com 1 em cada 4 itens
  // resolvido, deixar tudo na mesma lista fazia o que esta ANDANDO se perder
  // no meio do que ja acabou.
  const estaFeito = (i) => i.estado === 'feito' || i.estado === 'na';
  // O aviso "N conversas esperam voce" e' um filtro: clicado, a lista fica so com esses
  // itens — os ja resolvidos tambem, senao uma conversa viva num item marcado feito
  // sumiria justamente de quem precisa responder. Lista vazia nunca vira filtro.
  const soVez = PLANO_SO_VEZ ? planoMinhaVez() : null;
  const naVez = (i) => !soVez || !soVez.length || soVez.includes(i.id);
  const emAberto = lista.filter(i => !estaFeito(i) && naVez(i));
  const jaFeitos = lista.filter(i => estaFeito(i) && naVez(i));

  const porFase = (arr) => {
    const f = {};
    arr.forEach(i => { (f[i.fase_ordem] = f[i.fase_ordem] || { quando: i.fase_quando, titulo: i.fase_titulo, itens: [] }).itens.push(i); });
    return f;
  };

  const montarBlocos = (fases) => Object.keys(fases).sort((a,b) => a-b).map(k => {
    const f = fases[k];
    const linhas = f.itens.map(i => {
      const cor = (PLANO_ESTADOS.find(e => e[0] === i.estado) || [])[2];
      const botoes = PLANO_ESTADOS.map(([v, rot, c]) => `
        <button class="plano-bt${i.estado === v ? ' sel' : ''}" style="${i.estado === v ? 'border-color:'+c+'; color:'+c+';' : ''}"
                onclick="planoMarcar('${esc(i.id)}','${v}')">${rot}</button>`).join('');
      const quando = i.atualizado_em
        ? `<div class="plano-carimbo">${esc((i.atualizado_por||'').split('@')[0])} · ${new Date(i.atualizado_em).toLocaleDateString('pt-BR')}</div>` : '';
      const rotulo = (PLANO_ESTADOS.find(e => e[0] === i.estado) || [])[1];
      const selo = cor ? `<span class="plano-selo" style="color:${cor};">${rotulo}</span>` : '';
      // O detalhe e' longo (tabelas inteiras). Fica atras de um gatilho igual ao dos
      // recados — menos quando ha aprovacao esperando: essa abre sozinha.
      const aprsItem = (PLANO_APROVACOES || []).filter(a => a.item_id === i.id);
      const aprPend = aprsItem.filter(a => !a.estado || a.estado === 'pendente').length;
      const detAberto = planoDetAberto(i);
      const detGatilho = i.detalhe
        ? `<div class="plano-recados-linha"><button class="plano-recado-bt${aprPend ? ' tem-novo' : ''}"
             onclick="planoDetalheAlternar('${esc(i.id)}')">${detAberto ? '▾' : '▸'} ${
             detAberto ? 'esconder o detalhe' : 'ver o detalhe'}${aprPend ? ' · ' + aprPend + ' esperando você' : ''}</button></div>`
        : '';
      return `<div class="plano-item" style="${cor ? 'border-left-color:'+cor+';' : ''}">
        <div class="plano-topo">
          <span class="plano-nome">${esc(i.titulo)}</span>
          <span class="plano-quem">${esc(i.quem || '—')}</span>
          ${selo}
        </div>
        ${detGatilho}
        ${i.detalhe && detAberto ? '<div class="plano-det">' + planoDetalhe(i.detalhe, esc, aprsItem) + '</div>' : ''}
        ${i.andamento && !estaFeito(i) ? '<div class="plano-dep" style="color:var(--tx-2);">andou' + (i.andamento_em ? ' em ' + new Date(i.andamento_em).toLocaleDateString('pt-BR') : '') + ': ' + esc(i.andamento) + '</div>' : ''}
        ${i.evidencia && estaFeito(i) ? '<div class="plano-dep">' + (i.resolvido_em ? 'resolvido em ' + new Date(i.resolvido_em).toLocaleDateString('pt-BR') + ': ' : 'prova: ') + esc(i.evidencia) + '</div>' : ''}
        ${i.dependencia ? '<div class="plano-dep">depende de: ' + esc(i.dependencia) + '</div>' : ''}
        <div class="plano-acoes">${botoes}${quando}</div>
        ${blocoRecados(i, esc, sess)}
      </div>`;
    }).join('');
    return `<div class="plano-fase">
        <span class="plano-fase-quando">${esc(f.quando)}</span>
        <span class="plano-fase-titulo">${esc(f.titulo)}</span>
      </div>${linhas}`;
  }).join('');

  // 05/11/2026 (dono, 23/10): "deixar mais claro os já resolvidos [...] e o que está em andamento, separar melhor isso" e
  // "juntar tudo que já foi resolvido nessa tela" — em andamento e a fazer separados; o resolvido (desta fase e o arquivo
  // da revisão de 22/10) vai para o fim, em blocos fechados.
  const andando = emAberto.filter(i => i.estado === 'andando'), aFazer = emAberto.filter(i => i.estado !== 'andando');
  const titBloco = (t, n) => `<div class="section-label" style="margin-top:14px;">${t} <span style="color:var(--tx-4);font-weight:400;">${n}</span></div>`;
  const blocos = PLANO_VER_ARQ ? montarBlocos(porFase(emAberto))
    : (andando.length ? titBloco('Em andamento', andando.length) + montarBlocos(porFase(andando)) : '')
      + (aFazer.length ? titBloco('A fazer', aFazer.length) + montarBlocos(porFase(aFazer)) : '');
  const arq = PLANO.filter(i => Number(i.fase_ordem) >= 90 && naVez(i));
  const arqFeitos = arq.filter(i => i.estado === 'feito'), arqFora = arq.filter(i => i.estado !== 'feito');
  const fechado = (rot, arr, aberto) => arr.length ? `<details class="plano-feitos" style="margin-top:8px;"${aberto ? ' open' : ''}><summary><b>${arr.length}</b> ${rot}</summary>
      <div style="margin-top:10px;">${montarBlocos(porFase(arr))}</div></details>` : '';
  const blocoResolvido = PLANO_VER_ARQ ? '' : titBloco('Já resolvido', jaFeitos.length + arqFeitos.length + arqFora.length)
    + fechado('prontos nesta fase', jaFeitos, !!PLANO_ESTADO_F)
    + (PLANO_DONO || PLANO_ESTADO_F ? '' : fechado('resolvidos antes de 22/10', arqFeitos) + fechado('saíram do plano na revisão de 22/10', arqFora));
  // Com filtro POR ESTADO ligado, o bloco recolhido perde o sentido: a pessoa pediu
  // justamente para ver aquele estado, entao ele ja abre.
  const blocoFeitos = jaFeitos.length ? `
    <details class="plano-feitos"${PLANO_ESTADO_F ? ' open' : ''}>
      <summary><b>${jaFeitos.length}</b> ${jaFeitos.length === 1 ? 'item já resolvido' : 'itens já resolvidos'} — clique para ver</summary>
      <div style="margin-top:10px;">${montarBlocos(porFase(jaFeitos))}</div>
    </details>` : '';

  const chips = donos.map(d => {
    const n = universo.filter(i => pessoaDe(i) === d).length;
    return `<button class="preset-btn ${PLANO_DONO === d ? 'active' : ''}" onclick="planoFiltrar('${esc(d)}')">${esc(d)} ${n}</button>`;
  }).join(' ');

  // Os mesmos chips, agora por ESTADO. 'pendente' entra na lista porque nao esta em
  // PLANO_ESTADOS (que so tem os tres que os botoes gravam) e e' justamente o que a
  // pessoa quer ver primeiro. A contagem respeita o filtro de pessoa que estiver
  // ligado, para o numero do chip ser o que ela vai encontrar ao clicar.
  const chipsEstado = [['pendente', 'pendente']].concat(PLANO_ESTADOS.filter(e => e[0] !== 'na').map(e => [e[0], e[1]])).map(([v, rot]) => {
    const n = baseEstado.filter(i => estadoDe(i) === v).length;
    if (!n) return '';
    return `<button class="preset-btn ${PLANO_ESTADO_F === v ? 'active' : ''}" onclick="planoFiltrarEstado('${v}')" title="Mostra só os itens em ${rot}.">${rot} ${n}</button>`;
  }).join(' ');

  alvo.innerHTML = `
    <div class="section-label" style="border-top:none; margin-top:0; padding-top:0;">Em desenvolvimento</div>
    <div class="caption-label" style="text-align:center;" title="Marcar aqui vale para todo mundo — não fica só no seu navegador.">
      Tudo que precisa acontecer, com dono e estado. Entrou como <b>${esc((sess && sess.email) || '')}</b>.
      <button class="preset-btn" onclick="planoSair()">sair</button></div>
    ${avisoRecados(esc)}
    ${PLANO_VER_ARQ ? '' : planoEmDesenvolvimento(ativos, esc)}
    <div class="section-label" style="margin-top:6px;">O plano, item a item</div>
    <div class="plano-barra">
      <div class="plano-contagem">${PLANO_VER_ARQ ? `<b>${feitos}</b> de ${lista.length} resolvidos` : `<b>${andando.length}</b> em andamento · <b>${aFazer.length}</b> a fazer · <b>${feitos}</b> ${feitos === 1 ? 'pronto' : 'prontos'} nesta fase${PLANO_DONO ? ' (' + esc(PLANO_DONO) + ')' : ` · ${arqFeitos.length} resolvidos antes de 22/10`}`}</div>
      <div class="plano-trilho"><div class="plano-preenche" style="width:${pct.toFixed(1)}%;"></div></div>
    </div>
    ${PLANO_VER_ARQ ? `<div class="contexto" style="text-align:center;">Você está vendo o <b>arquivo</b>: ${nArq} itens fora do plano de saída (revisão de 22/10). <button class="preset-btn" onclick="PLANO_VER_ARQ=false; PLANO_DONO=null; PLANO_ESTADO_F=null; renderModuloPlano();">voltar ao plano</button></div>` : ''}
    <div style="text-align:center; margin:10px 0;">
      <button class="preset-btn ${PLANO_DONO ? '' : 'active'}" onclick="planoFiltrar(null)">todos ${universo.length}</button>
      ${chips}
      <span style="color:var(--tx-5); margin:0 6px;">|</span>
      <button class="preset-btn ${PLANO_ESTADO_F ? '' : 'active'}" onclick="planoFiltrarEstado(null)">qualquer estado</button>
      ${chipsEstado}
    </div>
    ${PLANO_VER_ARQ ? blocoFeitos : ''}
    ${blocos || (jaFeitos.length ? '<div class="contexto">Tudo o que está nesta lista já foi resolvido.</div>' : '<div class="contexto">Nada aqui.</div>')}
    ${blocoResolvido}
    ${false && !PLANO_VER_ARQ && nArq ? `<div class="caption-label" style="text-align:center; margin-top:14px;"><a href="javascript:void(0)" style="color:var(--tx-4);" onclick="PLANO_VER_ARQ=true; PLANO_DONO=null; PLANO_ESTADO_F=null; renderModuloPlano();">${nArq} itens fora do plano (revisão de 22/10) — ver</a></div>` : ''}`;
}

// O PEDAÇO DO mostrarModulo QUE É DO SISTEMA (05/11/2026).
function entrarTelaSistema(nome) {
  if (nome === 'plano') entrarPlano();
  if (nome === 'telas') entrarTelas();
  if (nome === 'rotinas') entrarRotinas();
}
