// Produção e estoque (Contagem, Planejar, Apontar, Controle, Posição) do painel Cidadão do Mundo.
// Saiu de docs/dashboard.html em 24/10/2026 (bloco 2 do painel em módulos): MOVIDO, não copiado.
// Carregado pelo dashboard.html e por docs/estoque/index.html, depois do nucleo.js (de onde vêm consultarTudo, fmt,
// rmbSessao, rmbHeaders, trFetch, trRpc, trErroDe, trEscH, fxSomaDias). mostrarModulo('producao') é de cada página.
// Quem mexe aqui: o chat "Telas do painel".

// ==================================================================
//  CONTAGEM DE ESTOQUE — a quarta-feira (12/09/2026)
//
//  CONTAGEM CEGA E REGRA, NAO DETALHE DE TELA. Enquanto a folha esta ABERTA o
//  painel NAO mostra o esperado. Se ele aparecer antes de a pessoa digitar, ela
//  digita o esperado — e o painel passa a produzir um numero que confirma a si
//  mesmo. O esperado so aparece depois de FECHAR, junto com a diferenca.
//
//  O esperado sai de vw_est_inventario_conferencia, que ancora na ultima
//  contagem FECHADA e IGNORA o ajuste do Saipos (a regra de ouro do
//  script/estoque_inventario.sql: o ajuste E o fechamento da contagem la, e se
//  entrar na conta a nossa contagem bate sempre e mede nada).
//
//  Primeira contagem de um item nao tem esperado, e isso e correto: ela e o
//  ponto de partida. Hoje 187 dos 410 itens tem saldo acumulado negativo no
//  razao, porque ele comeca em 02/01/2026 sem saldo de abertura.
// ==================================================================
let CTG = null;   // { papel, unidade, folha, escopo, itens, contado, conf }

function ctgHoje() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(new Date());
}

async function ctgFetch(caminho, opcoes) {
  // 21/10/2026: o login vencia no meio da contagem ("JWT expired" ao abrir a folha) — renova antes e, se o
  // banco ainda assim recusar por login vencido (401), renova e tenta de novo uma vez.
  await rmbGarantirTokenValido();
  const chama = () => fetch(`${SUPABASE_URL}/rest/v1/${caminho}`,
                        { headers: rmbHeaders((opcoes || {}).extra || {}), ...(opcoes || {}) });
  let r = await chama();
  if (await rmbRenovarSeExpirado(r)) r = await chama();
  if (!r.ok) throw new Error((await r.text()).slice(0, 200));
  return r;
}

async function entrarContagem() {
  const alvo = document.getElementById('view-contagem');
  if (!alvo) return;
  const sessao = rmbSessao();
  if (!sessao) { alvo.innerHTML = `<div class="contexto">Entre no painel para contar o estoque.</div>`; return; }
  alvo.innerHTML = `<div class="contexto">Carregando…</div>`;
  try {
    if (!CTG || !CTG.papel) {
      const [rp, ru] = await Promise.all([trRpc('tr_meu_papel'), trRpc('tr_minha_unidade')]);
      const papel = rp.ok ? await rp.json() : null;
      if (!papel) {
        alvo.innerHTML = `<div class="contexto">Você está logado como <b>${sessao.email}</b>, mas este login ainda
          não tem papel na operação. Fale com o Neto para liberar.</div>`;
        return;
      }
      CTG = { papel, unidade: null };
    }
    const uT = await estLojaDaTela(alvo, entrarContagem); if (!uT) return;
    if (CTG.unidade !== uT) { CTG.unidade = uT; CTG.folha = null; }
    await ctgCarregar();
    ctgPendentesVer();
  } catch (e) {
    alvo.innerHTML = `<div class="contexto" style="border-color:var(--farol-fora);">Não consegui abrir a contagem: ${e.message}</div>`;
  }
}

// 27/10/2026: o nome da pessoa pelo login (vw_nome_do_login: apelido do RH → cadastro dos módulos → prefixo do e-mail)
let EST_NOMES = null;
async function estNomesCarregar() {
  if (EST_NOMES) return;
  try { EST_NOMES = new Map((await consultarTudo('vw_nome_do_login?select=email,nome')).map((r) => [String(r.email || '').toLowerCase(), r.nome])); }
  catch (e) { EST_NOMES = new Map(); }
}
function estNome(email) {
  const e = String(email || '').toLowerCase();
  if (!e) return '';
  const n = EST_NOMES && EST_NOMES.get(e);
  const s = n || e.split('@')[0];
  return s.charAt(0).toUpperCase() + s.slice(1).toLowerCase();
}
async function ctgCarregar() {
  await estNomesCarregar();
  const u = encodeURIComponent(CTG.unidade);
  const folhas = await consultarTudo(`est_inventario?select=*&unidade=eq.${u}&order=data.desc&limit=12`);
  CTG.folha = folhas.find((f) => f.status === 'ABERTA') || folhas[0] || null;
  CTG.folhas = folhas;
  CTG.itens = [];
  CTG.conf = [];
  if (CTG.folha) {
    if (CTG.folha.status === 'ABERTA') {
      // ABERTA le so o que foi digitado — nunca a conferencia (contagem cega)
      CTG.itens = await consultarTudo(`est_inventario_itens?select=*&id_inventario=eq.${CTG.folha.id}`);
    } else {
      CTG.conf = await consultarTudo(`vw_est_inventario_conferencia?select=*&id_inventario=eq.${CTG.folha.id}&order=diferenca_reais.asc`);
    }
  }
  CTG.escopo = await consultarTudo(
    `vw_est_curva?select=nome_saipos,insumo,un,curva,custo,custo_fonte,dinheiro&unidade=eq.${u}&order=dinheiro.desc`);
  // a base do retrato serve a folha impressa (o grupo de cada item) e ao select da foto
  if (!CTG.base) {
    CTG.base = (await consultarTudo(`vw_est_folha_contagem?select=nome_base,nome_saipos_conta,nomes_saipos,etiquetas,qtd,un,tipo,situacao,grupo,ordem_grupo&unidade=eq.${u}&order=ordem_grupo,grupo,nome_base`)).map(ctgDaFolha);
    CTG._grupoDe = null;   // o grupo de cada item sai daqui; base nova, mapa novo
  }
  CTG.foraBase = CTG.folha ? await consultarTudo(`vw_est_contagem_fora_da_base?select=nome_saipos,nome_base,problema,quem,o_que_fazer&id_inventario=eq.${CTG.folha.id}`).catch(() => []) : [];
  CTG.fotos = [];
  CTG.fotoLinhas = [];
  if (CTG.leituraRapida === undefined) {
    // prova = a própria rotina rápida já registrou execução (foto lida à mão em poucos minutos não conta)
    const L = await consultarTudo('rotinas_execucao?select=id&rotina=eq.transcricao-contagem-rapida&limit=1').catch(() => []);
    CTG.leituraRapida = L.length > 0;
  }
  if (CTG.folha && CTG.folha.status === 'ABERTA') {
    CTG.fotos = await consultarTudo(
      `est_contagem_foto?select=*&id_inventario=eq.${CTG.folha.id}&order=criado_em.desc`);
    const ids = CTG.fotos.map((f) => f.id);
    if (ids.length) {
      CTG.fotoLinhas = await consultarTudo(
        `est_contagem_foto_linha?select=*&id_foto=in.(${ids.join(',')})&order=linha`);
      // 21/10/2026: a unidade de cada item (Saipos x nossa) e a lista fechada para propor correcao
      try {
        const [uc, uv] = await Promise.all([
          consultarTudo(`vw_est_unidade_conferir?select=nome_base,nome_saipos_conta,un_contagem,un_nossa,un_decidida,situacao,proposta_id,un_proposta,proposta_quem,proposta_em&unidade=eq.${u}`),
          consultarTudo('vw_est_unidade_valida?select=*')]);
        CTG.unConf = new Map(uc.map((x) => [x.nome_saipos_conta, x]));
        CTG.unValidas = uv.map((x) => x.un || x.unidade || Object.values(x)[0]);
      } catch (e) { CTG.unConf = null; CTG.unValidas = null; }
    }
    // EM BRANCO NO PAPEL (dono, 22/10/2026: "esses itens que vêm em branco na contagem deveriam aparecer na grade de
    // conferência pra Rita; se realmente não tinha, ela preenche zero, caso contrário preenche o valor contado").
    // Célula em branco não gera linha na leitura da foto: a grade do Estoque (vw_est_contagem_grade) é que sabe.
    // 04/11/2026 (Organizador: FRANGO GRELHADO RECEITA, folha 19 — a foto leu 16,7 mas a linha foi gravada vazia e ficou
    // sem lugar): entra também a linha LIDA e não gravada. Quem decide se já está contado é ctgHtmlBrancos (pela contagem).
    CTG.brancos = await consultarTudo(`vw_est_contagem_grade?select=linha,grupo,ordem_grupo,nome,nome_saipos_conta,un,situacao,qtd_lida,id_foto` +
      `&id_inventario=eq.${CTG.folha.id}&situacao=in.(%22EM%20BRANCO%20NA%20FOTO%22,%22EM%20BRANCO%20NO%20FIM%20DA%20PAGINA%22,%22ESPERANDO%20CONFERENCIA%22)&order=ordem_grupo,linha`).catch(() => []);   // 22/10: o Estoque criou as linhas vazias (ESPERANDO CONFERENCIA, sem quantidade)
    // 05/11/2026 (proposta 2026-10-21-grade-da-contagem-folha-inteira.md): página fotografada pela metade e item que saiu
    // da folha depois de impressa. A página sem foto nenhuma já está no quadro de páginas.
    CTG.gradeAviso = await consultarTudo(`vw_est_contagem_grade?select=linha,grupo,ordem_grupo,nome,situacao` +
      `&id_inventario=eq.${CTG.folha.id}&situacao=in.(%22FALTA%20A%20FOTO%20DO%20COMECO%20DA%20PAGINA%22,%22NAO%20CONTA%20MAIS%22)&order=ordem_grupo,linha`).catch(() => []);
  } else { CTG.brancos = []; CTG.gradeAviso = []; }
  // 28/10/2026: notas com data até a contagem, lançadas no Saipos depois dela — a mercadoria já estava na prateleira?
  CTG.nfDepois = await consultarTudo(`vw_est_nf_apos_contagem?select=*&unidade=eq.${u}&order=data_da_nota,nf`).catch(() => null);
  CTG.nfTodasAgora = false;
  ctgRender();
}

// 28/10/2026 (dono, 19:06): com nota pendente o quadro fica no topo, só com as pendentes; tudo marcado = sai do topo e
// vira uma linha recolhida no fim da tela (ctgNfMarcadasHtml), com o desfazer
function ctgNfDepoisHtml(soMarcadas) {
  const L = CTG.nfDepois;
  if (!L || !L.length) return '';
  const pend = L.filter((n) => !n.decisao), feitas = L.filter((n) => n.decisao);
  if (!soMarcadas && !pend.length) return CTG.nfTodasAgora
    ? `<div class="contexto" style="text-align:left; border-color:var(--farol-ok);"><b style="color:var(--farol-ok);">✓ ${feitas.length === 1 ? 'A nota está marcada' : 'Todas as ' + feitas.length + ' notas marcadas'}.</b> A lista foi para o fim da tela.</div>` : '';
  if (soMarcadas && pend.length) return '';
  const dm = (s) => s ? String(s).slice(8, 10) + '/' + String(s).slice(5, 7) : '—';
  const soma = (A) => A.reduce((s, n) => s + Number(n.valor || 0), 0);
  const arg = (n) => trEscH(JSON.stringify(n.nf));
  const linha = (n) => `<tr>
      <td style="white-space:nowrap;">${dm(n.data_da_nota)}</td><td style="white-space:nowrap;">${trEscH(String(n.nf || '').replace(/^NF:\s*/, ''))}</td>
      <td style="white-space:normal; font-size:12px;">${trEscH(n.o_que_veio || '')}</td>
      <td style="white-space:nowrap;">R$ ${fmt(Number(n.valor || 0))}</td>
      <td style="white-space:nowrap;">${n.decisao
        ? `<span style="color:${n.decisao === 'ESTAVA_NA_CONTAGEM' ? 'var(--info)' : 'var(--farol-ok)'}; font-weight:700;">${n.decisao === 'ESTAVA_NA_CONTAGEM' ? 'já estava' : 'chegou depois'}</span>
           <span style="font-size:11px; color:var(--tx-4);">${trEscH(estNome(n.decidido_por) || '')}</span>
           <a href="javascript:void(0)" style="font-size:11px; color:var(--tx-4); margin-left:4px;" onclick="ctgNfMarcar(${arg(n)}, null)">desfazer</a>`
        : `<button class="preset-btn est-ciclo" onclick="ctgNfMarcar(${arg(n)}, 'ESTAVA_NA_CONTAGEM')" title="a mercadoria já estava na prateleira na hora da contagem: a nota não entra de novo no saldo">Já estava na prateleira</button>
           <button class="preset-btn est-ciclo" onclick="ctgNfMarcar(${arg(n)}, 'CHEGOU_DEPOIS')" title="a mercadoria chegou depois da contagem: a nota entra no saldo">Chegou depois da contagem</button>`}</td></tr>`;
  if (soMarcadas) return `<details style="margin-top:18px;"><summary style="cursor:pointer; font-size:13px; color:var(--tx-3);">Notas lançadas depois da contagem de ${dm(L[0].contagem_de)}: <b>${feitas.length} ${feitas.length === 1 ? 'marcada' : 'marcadas'}</b> (ver)</summary>
      <span id="ctgNfMsg" style="font-size:12px;"></span>
      <div id="tabelaNfDepois" style="overflow-x:auto; margin-top:8px;"><table><thead><tr><th>Data</th><th>Nota</th><th>O que veio</th><th>Valor</th><th></th></tr></thead>
        <tbody>${feitas.map(linha).join('')}</tbody></table></div></details>`;
  return `<div class="section-label">Notas lançadas depois da contagem de ${dm(L[0].contagem_de)}</div>
    <div class="contexto" style="text-align:left; border-color:${pend.length ? 'var(--farol-perto)' : 'var(--line)'};">
      ${pend.length ? `<b>${pend.length} nota(s) para marcar</b> (R$ ${fmt(soma(pend))}).` : '<b>Todas marcadas.</b>'}
      Esta nota já estava na prateleira na hora da contagem?
      <span id="ctgNfMsg" style="font-size:12px;"></span>
      <div id="tabelaNfDepois" style="overflow-x:auto; margin-top:8px;"><table><thead><tr><th>Data</th><th>Nota</th><th>O que veio</th><th>Valor</th><th></th></tr></thead>
        <tbody>${pend.map(linha).join('')}</tbody></table></div></div>`;
}
async function ctgNfMarcar(nf, decisao) {
  if (!estTravar(true)) return;
  const msg = document.getElementById('ctgNfMsg');
  try {
    const r = await trRpc('est_nf_contagem_marcar', { p_unidade: CTG.unidade, p_nf: nf, p_decisao: decisao });
    if (!r.ok) { avisoAcao('erro', `✗ A nota NÃO foi marcada: ${await trErroDe(r)}. Tente de novo.`); return; }
    avisoAcao('ok', `✓ Nota ${decisao ? 'marcada' : 'desmarcada'} — às ${avisoHora()}.`);
    const antes = (CTG.nfDepois || []).filter((n) => !n.decisao).length;
    CTG.nfDepois = await consultarTudo(`vw_est_nf_apos_contagem?select=*&unidade=eq.${encodeURIComponent(CTG.unidade)}&order=data_da_nota,nf`).catch(() => CTG.nfDepois);
    CTG.nfTodasAgora = antes > 0 && !(CTG.nfDepois || []).some((n) => !n.decisao);
    ctgRender();
  } finally { estTravar(false); }
}
function ctgRender() {
  const alvo = document.getElementById('view-contagem');
  const f = CTG.folha;
  const aberta = f && f.status === 'ABERTA';
  const hoje = ctgHoje();
  const dia = new Date(hoje + 'T12:00:00').getDay();   // 3 = quarta

  let h = `<h2>Contagem de estoque</h2>`;
  h += ctgNfDepoisHtml();

  h += `<div class="contexto" style="display:flex; gap:10px; align-items:center; flex-wrap:wrap;">
      <b>${CTG.unidade}</b>
      ${f ? `<span>folha de <b>${f.data.split('-').reverse().join('/')}</b> · ${f.escopo === 'CURVA_A' ? 'só os de maior valor' : 'tudo'} · ${aberta ? 'aberta' : 'fechada'}</span>` : '<span>nenhuma folha ainda</span>'}
      ${aberta ? '' : `<button class="preset-btn" onclick="ctgAbrir('CURVA_A')">Contar só os de maior valor</button>
                       <button class="preset-btn" onclick="ctgAbrir('GERAL')">Contar tudo</button>`}
      ${dia !== 3 && !aberta ? `<span style="color:var(--tx-4);">hoje não é quarta</span>` : ''}
    </div>`;

  if (!f) {
    h += `<div class="contexto">A contagem é toda quarta: a curva A na semana (<b>${CTG.escopo.filter((i) => i.curva === 'A').length} itens</b>,
      80% do dinheiro) e a geral uma vez por mês. Abra a folha e conte — o esperado só aparece depois de fechar.</div>`;
    alvo.innerHTML = h;
    ctgGuia(false);
    return;
  }

  h += aberta ? ctgHtmlContar(f) : ctgHtmlConferencia(f);
  h += ctgNfDepoisHtml(true);
  alvo.innerHTML = h;
  ctgGuia(aberta);
}
// GUIA DE PRIMEIRO ACESSO (09/11/2026, dono: "pode sim, eu gostei do formato"; mecanismo no nucleo.js). Os passos
// dependem da folha (aberta = o trabalho de contar; fechada = o resultado). Abre sozinho uma vez por carga da página:
// a tela redesenha a cada clique e o guia não pode recomeçar no meio. Registrar de novo só atualiza o "?".
const EST_GUIA_TENTOU = {};
function estGuia(tela, passos) {
  if (typeof guiaRegistrar !== 'function') return;
  guiaRegistrar(tela, passos);
  if (!EST_GUIA_TENTOU[tela]) { EST_GUIA_TENTOU[tela] = true; guiaTalvez(tela); }
}
function ctgGuia(aberta) {
  estGuia('contagem', aberta ? [
    { sel: '#view-contagem button[onclick^="ctgMarcarHora"]', texto: 'Toque em <b>▶ Comecei</b> quando começar a contar e em <b>■ Terminei</b> quando acabar. O topo mostra quanto tempo levou.' },
    { sel: '#view-contagem button[onclick^="ctgImprimir"]', texto: '<b>🖨️ Imprimir tudo</b>: cada grupo sai numa folha. Conte na prateleira e escreva o número no papel.' },
    { sel: '#view-contagem button[onclick^="ctgAbrirCamera"]', texto: '<b>📷 Tirar foto da folha</b> preenchida. O painel lê os números e o quadro mostra quais páginas já chegaram.' },
    { sel: '#ctgConferir', texto: '<b>3 · Conferir e corrigir</b>: compare com o papel, corrija o que veio errado e marque o que você conferiu.' },
    { sel: '#view-contagem button[onclick^="ctgFechar"]', texto: '<b>🔒 Fechar a contagem</b> no fim. Sem fechar, a contagem não vale; depois aparece o esperado contra o contado.' },
  ] : [
    { sel: '#view-contagem button[onclick^="ctgAbrir("]', texto: 'Para começar uma contagem: <b>Contar só os de maior valor</b> (toda quarta) ou <b>Contar tudo</b> (uma vez por mês).' },
    { sel: '#view-contagem .cards', texto: 'O resultado da última contagem: quanto <b>falta na prateleira</b>, quanto <b>sobra</b> e quantos itens esperam explicação.' },
    { sel: '#tabelaConferencia', texto: '<b>Item a item</b>: diferença acima de R$ 500 precisa de motivo. Toque em <b>explicar</b> e escreva o que aconteceu.' },
  ]);
}

// ---- A FOTO DA FOLHA (dono, 08/10/2026: "vamos tentar com o esquema do painel abrir a camera
// e ela mandar a foto direto por la"). O celular abre a camera, o painel reduz a imagem (a
// internet da cozinha e ruim), sobe para o balde que ja existe e guarda um LINK ASSINADO — e por
// ele que eu baixo para transcrever, porque nao existe chave de servico neste projeto.
// O que eu leio NAO vira contagem sozinho: fica em est_contagem_foto_linha ate alguem conferir.
async function ctgReduzirFoto(arquivo, maxLado, qualidade) {
  const url = URL.createObjectURL(arquivo);
  try {
    const img = await new Promise((ok, erro) => {
      const im = new Image(); im.onload = () => ok(im); im.onerror = erro; im.src = url;
    });
    const f = Math.min(1, maxLado / Math.max(img.width, img.height));
    const c = document.createElement('canvas');
    c.width = Math.round(img.width * f); c.height = Math.round(img.height * f);
    c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
    const blob = await new Promise((ok) => c.toBlob(ok, 'image/jpeg', qualidade));
    return blob || arquivo;          // navegador sem toBlob: sobe o original
  } catch (e) {
    return arquivo;                  // foto que o navegador não abriu: sobe como veio
  } finally { URL.revokeObjectURL(url); }
}

// 28/10/2026 (dono, 18:50: "todas as telas de usuários têm que ter cliques limpos e mensagens claras se o processo deu
// certo ou não"). Nesse dia 7 páginas da AV não chegaram e a tela não deixou claro — a Rita mandou algumas duas vezes.
// Agora: uma faixa grande que não some (enviando / chegou / não chegou + tentar de novo); 60 s de prazo no envio; a foto
// fica guardada no aparelho (IndexedDB) até o registro gravar e volta a subir ao reabrir a tela; e a câmera que abriu e
// não devolveu foto (o Android costuma recarregar a página na volta) vira aviso vermelho.
let CTG_ENVIO = null;   // { estado: 'enviando' | 'ok' | 'erro', texto, chave }
let CTG_PEND_VISTO = false;
const CTG_CAMERA = 'ctgCameraAberta';
const CTG_MEMORIA = new Map();   // sem IndexedDB (aba anônima): a foto fica só enquanto a tela está aberta
function ctgEnvioHtml() {
  const e = CTG_ENVIO;
  if (!e) return '';
  const cor = e.estado === 'ok' ? 'var(--farol-ok)' : e.estado === 'erro' ? 'var(--farol-fora)' : 'var(--info)';
  return `<div style="border:2px solid ${cor}; border-radius:10px; padding:12px 14px; font-size:15px; color:var(--tx-1); display:flex; gap:10px; align-items:center; flex-wrap:wrap;">
    <div style="flex:1 1 220px; min-width:0;">${e.texto}</div>
    ${e.estado === 'erro' && e.chave != null ? `<button class="preset-btn" style="font-size:14px; padding:10px 14px; border-color:${cor};" onclick="ctgReenviar(${Number(e.chave)})">Tentar de novo</button>` : ''}
    ${e.estado !== 'enviando' ? `<a href="javascript:void(0)" style="font-size:12px; color:var(--tx-4);" onclick="ctgEnvioPintar(null)">fechar aviso</a>` : ''}</div>`;
}
function ctgEnvioPintar(estado, texto, chave) {
  CTG_ENVIO = estado ? { estado, texto, chave: chave == null ? null : chave } : null;
  const el = document.getElementById('ctgFotoMsg');
  if (el) el.innerHTML = ctgEnvioHtml();
}
// a transcrição roda quarta e quinta de hora em hora (08:00–23:00); nos outros dias o boletim das 13:00 e das 18:00 confere.
// UM lugar só para a hora prevista: quando a leitura mudar de horário (Estoque, 28/10), muda-se aqui e vale para toda a tela.
// 28/10/2026 (Estoque): na quarta, das 14:00 às 21:55, a leitura roda de 5 em 5 min — mas só se promete depois de provado
// (CTG.leituraRapida, em ctgCarregar: a rotina transcricao-contagem-rapida já tem registro em rotinas_execucao).
function ctgProximaLeitura() {
  const agora = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/Sao_Paulo' }));
  if (CTG && CTG.leituraRapida && agora.getDay() === 3 && agora.getHours() >= 14 && agora.getHours() <= 21) return 'em até 5 minutos';
  const amanha = new Date(agora.getTime() + 86400000).toDateString();
  for (let i = 1; i <= 96; i++) {
    const d = new Date(agora.getTime() + i * 3600000), h = d.getHours(), dw = d.getDay();
    if (((dw === 3 || dw === 4) && h >= 8) || h === 13 || h === 18) {
      const dia = d.toDateString() === agora.toDateString() ? '' : d.toDateString() === amanha ? 'amanhã, '
        : d.toLocaleDateString('pt-BR', { weekday: 'long' }) + ', ';
      return `${dia}por volta das ${String(h).padStart(2, '0')}:00`;
    }
  }
  return 'em breve';
}

// a foto guardada no aparelho até chegar
function ctgIdb() {
  return new Promise((ok, erro) => {
    if (!window.indexedDB) return erro(new Error('sem IndexedDB'));
    const r = indexedDB.open('painel-contagem', 1);
    r.onupgradeneeded = () => r.result.createObjectStore('fotos', { keyPath: 'chave', autoIncrement: true });
    r.onsuccess = () => ok(r.result); r.onerror = () => erro(r.error);
  });
}
async function ctgIdbFaz(modo, fn) {
  const db = await ctgIdb();
  try {
    return await new Promise((ok, erro) => {
      const tx = db.transaction('fotos', modo), req = fn(tx.objectStore('fotos'));
      tx.oncomplete = () => ok(req && req.result); tx.onerror = tx.onabort = () => erro(tx.error);
    });
  } finally { db.close(); }
}
async function ctgGuardar(reg) {
  try { return await ctgIdbFaz('readwrite', (s) => s.add(reg)); }
  catch (e) { const k = -(CTG_MEMORIA.size + 1); CTG_MEMORIA.set(k, { ...reg, chave: k }); return k; }
}
async function ctgGuardada(k) {
  if (k < 0) return CTG_MEMORIA.get(k) || null;
  try { return (await ctgIdbFaz('readonly', (s) => s.get(k))) || null; } catch (e) { return null; }
}
async function ctgEsquecer(k) {
  if (k < 0) { CTG_MEMORIA.delete(k); return; }
  try { await ctgIdbFaz('readwrite', (s) => s.delete(k)); } catch (e) {}
}
async function ctgGuardadas() {
  try { return (await ctgIdbFaz('readonly', (s) => s.getAll())) || []; } catch (e) { return []; }
}

async function ctgComPrazo(url, opcoes, ms) {
  const ctl = new AbortController(), t = setTimeout(() => ctl.abort(), ms);
  try { return await fetch(url, { ...opcoes, signal: ctl.signal }); }
  catch (e) { throw new Error(e.name === 'AbortError' ? `a internet não deu conta em ${Math.round(ms / 1000)} segundos` : 'o celular está sem internet'); }
  finally { clearTimeout(t); }
}
// sobe a imagem, pega o link assinado e grava o registro. Reenvio da mesma foto não duplica: o caminho é o mesmo.
async function ctgSubir(reg) {
  await rmbGarantirTokenValido();
  const ja = await consultarTudo(`est_contagem_foto?select=id&caminho=eq.${encodeURIComponent(reg.caminho)}`).catch(() => []);
  if (ja.length) return;
  const url = `${SUPABASE_URL}/storage/v1/object/comprovantes/${reg.caminho}`;
  const sobe = () => ctgComPrazo(url, { method: 'POST', headers: { apikey: SUPABASE_ANON_KEY,
    Authorization: `Bearer ${rmbSessao().access_token}`, 'Content-Type': 'image/jpeg' }, body: reg.blob }, 60000);
  let up = await sobe();
  if (await rmbRenovarSeExpirado(up)) up = await sobe();
  if (!up.ok) {
    const txt = await up.text().catch(() => '');
    if (!/duplicate|already exists/i.test(txt)) throw new Error(`o servidor recusou a foto (${up.status})`);   // já subiu antes: segue
  }
  // link assinado: 30 dias. É por ele que a transcrição baixa a imagem.
  const dias = 30;
  let link = null;
  try {
    const sg = await ctgComPrazo(`${SUPABASE_URL}/storage/v1/object/sign/comprovantes/${reg.caminho}`, {
      method: 'POST', headers: { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${rmbSessao().access_token}`,
                                 'Content-Type': 'application/json' },
      body: JSON.stringify({ expiresIn: 60 * 60 * 24 * dias }) }, 30000);
    const d = sg.ok ? await sg.json() : {};
    link = d.signedURL ? `${SUPABASE_URL}/storage/v1${d.signedURL}` : null;
  } catch (e) {}
  try {
    await ctgFetch('est_contagem_foto', {
      method: 'POST', extra: { Prefer: 'return=minimal' },
      body: JSON.stringify({ id_inventario: reg.folha, unidade: reg.unidade, grupo: reg.grupo,
        caminho: reg.caminho, url_assinada: link, quem: (rmbSessao() || {}).email,
        assinada_ate: new Date(Date.now() + dias * 86400000).toISOString() }),
    });
  } catch (e) { throw new Error('a imagem subiu, mas o registro não gravou (' + e.message.slice(0, 80) + ')'); }
}
async function ctgMandar(chave, reg) {
  ctgEnvioPintar('enviando', `Enviando a foto (${Math.round(reg.blob.size / 1024)} KB)… <b>não feche a tela</b>.`);
  try { await ctgSubir(reg); }
  catch (e) {
    ctgEnvioPintar('erro', `<b>✗ A foto NÃO chegou:</b> ${trEscH(e.message)}. Ela ficou guardada neste celular — toque em <b>Tentar de novo</b>.`, chave);
    return false;
  }
  await ctgEsquecer(chave);
  const hora = ctgHora(Date.now());   // ctgHora(v) é a da conferência, mais abaixo
  ctgEnvioPintar('ok', `<b>✓ A foto chegou às ${hora}.</b>`);
  try { await ctgCarregar(); } catch (e) {}
  const n = (CTG.fotos || []).filter((f) => f.status !== 'DESCARTADA').length;
  ctgEnvioPintar('ok', `<b>✓ A foto chegou às ${hora}.</b> Agora são ${n} ${n === 1 ? 'foto' : 'fotos'} nesta folha. A leitura sai ${ctgProximaLeitura()}.`);
  return true;
}
function ctgAbrirCamera() {
  try { localStorage.setItem(CTG_CAMERA, JSON.stringify({ folha: CTG.folha && CTG.folha.id, ts: Date.now() })); } catch (e) {}
  document.getElementById('ctgFotoArq').click();
}
// a câmera abriu e nenhuma foto voltou para a tela (o Android recarrega a página, ou a pessoa cancelou)
function ctgCameraConferir(esperaMs) {
  setTimeout(() => {
    if (document.hidden || !CTG || !CTG.folha) return;   // ainda na câmera
    let m = null;
    try { m = JSON.parse(localStorage.getItem(CTG_CAMERA) || 'null'); } catch (e) {}
    if (!m || m.folha !== CTG.folha.id) return;
    try { localStorage.removeItem(CTG_CAMERA); } catch (e) {}
    if (Date.now() - m.ts > 30 * 60000 || (CTG_ENVIO && CTG_ENVIO.estado === 'enviando')) return;
    ctgEnvioPintar('erro', `<b>✗ Nenhuma foto voltou da câmera</b> (aberta às ${ctgHora(m.ts)}). Se você tirou a foto, ela <b>NÃO chegou</b>
      — o celular às vezes recarrega a tela na volta da câmera. Toque em 📷 e tire de novo.`);
  }, esperaMs);
}
['visibilitychange', 'focus'].forEach((ev) => (ev === 'focus' ? window : document).addEventListener(ev, () => {
  if (!document.hidden && document.getElementById('ctgFotoArq')) ctgCameraConferir(2500);
}));
// ao abrir a tela: a foto que ficou guardada sobe de novo; a da folha desta loja que já fechou não serve mais
async function ctgPendentesVer() {
  if (!CTG.folha || CTG.folha.status !== 'ABERTA') return;
  ctgCameraConferir(3000);
  if (CTG_PEND_VISTO) return;
  CTG_PEND_VISTO = true;
  const L = await ctgGuardadas();
  L.filter((r) => r.unidade === CTG.unidade && r.folha !== CTG.folha.id).forEach((r) => ctgEsquecer(r.chave));
  const daqui = L.filter((r) => r.folha === CTG.folha.id);
  if (!daqui.length) return;
  try { localStorage.removeItem(CTG_CAMERA); } catch (e) {}
  ctgEnvioPintar('enviando', `Você tinha ${daqui.length === 1 ? '1 foto que não chegou' : daqui.length + ' fotos que não chegaram'}. Enviando agora… <b>não feche a tela</b>.`);
  for (const r of daqui) { if (!(await ctgMandar(r.chave, r))) return; }
}
async function ctgReenviar(chave) {
  const reg = await ctgGuardada(chave);
  if (!reg) { ctgEnvioPintar('erro', '<b>✗ A foto não está mais guardada neste celular.</b> Toque em 📷 e tire de novo.'); return; }
  if (!CTG.folha || reg.folha !== CTG.folha.id) {
    await ctgEsquecer(chave);
    ctgEnvioPintar('erro', '<b>✗ A folha desta foto já fechou.</b> A foto não entra mais.'); return;
  }
  await ctgMandar(chave, reg);
}

async function ctgEnviarFoto(el) {
  const arquivo = (el.files || [])[0];
  el.value = '';
  try { localStorage.removeItem(CTG_CAMERA); } catch (e) {}
  if (!arquivo || !CTG.folha) return;
  const grupo = (document.getElementById('ctgFotoGrupo') || {}).value || null;
  ctgEnvioPintar('enviando', 'Preparando a foto… <b>não feche a tela</b>.');
  let chave, reg;
  try {
    const blob = await ctgReduzirFoto(arquivo, 1800, 0.72);
    reg = { folha: CTG.folha.id, unidade: CTG.unidade, grupo, blob, criado: Date.now(),
      caminho: `contagem/${CTG.folha.id}/${Date.now()}-${(grupo || 'folha').replace(/[^A-Za-z0-9]/g, '_')}.jpg` };
    chave = await ctgGuardar(reg);
  } catch (e) {
    ctgEnvioPintar('erro', `<b>✗ A foto NÃO chegou:</b> o celular não conseguiu preparar a imagem (${trEscH(e.message)}). Toque em 📷 e tire de novo.`);
    return;
  }
  await ctgMandar(chave, reg);
}

async function ctgDescartarFoto(id) {
  if (!confirm('Descartar esta foto? (ficou tremida, cortada, folha errada)')) return;
  avisoAcao('enviando', 'Descartando a foto…');
  try {
    await ctgFetch(`est_contagem_foto?id=eq.${id}`, {
      method: 'PATCH', extra: { Prefer: 'return=minimal' }, body: JSON.stringify({ status: 'DESCARTADA' }) });
  } catch (e) { return avisoAcao('erro', `✗ A foto NÃO foi descartada: ${e.message}. Tente de novo.`); }
  avisoAcao('ok', `✓ Foto descartada — às ${avisoHora()}.`);
  await ctgCarregar();
}

// Grava na contagem o que a transcricao leu, DEPOIS da conferencia na tela.
async function ctgAplicarFoto(id, semPergunta) {
  const linhas = (CTG.fotoLinhas || []).filter((l) => l.id_foto === id);
  if (!linhas.length) { avisoAcao('atencao', '! Esta foto ainda não tem leitura.'); return; }
  const campos = linhas.map((l) => {
    const el = document.getElementById('fl_' + l.id);
    return { nome_saipos: l.nome_saipos, qtd: el && el.value !== '' ? Number(String(el.value).replace(',', '.')) : null };
  });
  const ruim = campos.find((c) => c.qtd !== null && !isFinite(c.qtd));
  if (ruim) { avisoAcao('atencao', '! Tem número inválido em ' + ruim.nome_saipos); return; }
  const gravar = campos.filter((c) => c.qtd !== null);
  if (!gravar.length) { avisoAcao('atencao', '! Nenhum número para gravar.'); return; }
  // 04/11/2026: linha que fica vazia não some calada — vai para o quadro "ainda sem contagem", e a pergunta diz isso
  const vazias = campos.length - gravar.length;
  const avisoVazias = vazias ? `\n\n${vazias} ${vazias === 1 ? 'linha está vazia e não vai ser gravada' : 'linhas estão vazias e não vão ser gravadas'}: ${vazias === 1 ? 'ela fica' : 'elas ficam'} no quadro "ainda sem contagem", para digitar depois.` : '';
  if (!semPergunta && !confirm(`Gravar ${gravar.length} itens contados na folha ${CTG.folha.id}?${avisoVazias}`)) return;
  avisoAcao('enviando', `Gravando ${gravar.length} ${gravar.length === 1 ? 'item' : 'itens'} da foto…`);
  try {
    await ctgFetch('est_inventario_itens?on_conflict=id_inventario,nome_saipos', {
      method: 'POST', extra: { Prefer: 'resolution=merge-duplicates,return=minimal' },
      body: JSON.stringify(gravar.map((c) => {
        const i = ctgEscopoDe(c.nome_saipos) || {};   // a foto já traz o nome da base; o custo é traduzido
        return { id_inventario: CTG.folha.id, nome_saipos: c.nome_saipos, un: i.un || null,
                 qtd_contada: c.qtd, custo: i.custo || null, custo_fonte: i.custo_fonte || null,
                 contado_por: (rmbSessao() || {}).email };
      })),
    });
    await ctgFetch(`est_contagem_foto?id=eq.${id}`, {
      method: 'PATCH', extra: { Prefer: 'return=minimal' }, body: JSON.stringify({ status: 'APLICADA' }) });
  } catch (e) { avisoAcao('erro', `✗ Os itens da foto NÃO gravaram: ${e.message}. Tente de novo.`); return false; }
  avisoAcao('ok', `✓ ${gravar.length} ${gravar.length === 1 ? 'item gravado' : 'itens gravados'} na folha ${CTG.folha.id} — às ${avisoHora()}.`);
  if (!semPergunta) await ctgCarregar();
  return true;
}

// FAIXA "PARA VOCÊ APROVAR" na contagem (dono, 20/10/2026: "quanto menos cliques melhor" — ele não achou onde validar,
// e não havia nada dele: as 2 fotos paradas esperavam a transcrição). Diz primeiro se há algo para quem aprova; as fotos
// lidas sem nenhuma dúvida gravam todas num clique; as com dúvida seguem conferidas linha a linha logo abaixo.
function ctgFotosLidas() {
  return (CTG.fotos || []).filter((f) => f.status === 'TRANSCRITA').map((f) => {
    const ls = (CTG.fotoLinhas || []).filter((l) => l.id_foto === f.id);
    return { id: f.id, grupo: f.grupo, n: ls.length, duvidas: ls.filter((l) => l.duvida).length };
  }).filter((f) => f.n);
}
function ctgFaixa(fotos, faltando) {
  const lidas = ctgFotosLidas();
  const sem = lidas.filter((f) => !f.duvidas), com = lidas.filter((f) => f.duvidas);
  const esperando = fotos.filter((f) => f.status === 'AGUARDANDO');
  const desde = esperando.length ? new Date(Math.min(...esperando.map((f) => new Date(f.criado_em))))
    .toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit' }) : '';
  const nItens = lidas.reduce((s, f) => s + f.n, 0), nSem = sem.reduce((s, f) => s + f.n, 0);
  const linha = (t, acao) => `<div style="display:flex; flex-wrap:wrap; gap:8px; align-items:center; padding:6px 0; border-top:1px solid var(--line);"><div style="flex:1 1 240px; min-width:0;">${t}</div>${acao || ''}</div>`;
  if (!lidas.length && !esperando.length) return '';   // nada lido nem esperando: a faixa nao aparece
  let h = `<div class="contexto" style="text-align:left;${lidas.length ? ' border-color:var(--farol-perto);' : ''}">
    <b>${lidas.length ? `Para você aprovar: ${nItens} ${nItens === 1 ? 'item lido' : 'itens lidos'} em ${lidas.length} ${lidas.length === 1 ? 'foto' : 'fotos'}` : 'Nada para você aprovar agora.'}</b>`;
  if (sem.length) h += linha(`${sem.length} ${sem.length === 1 ? 'foto' : 'fotos'} sem nenhuma dúvida (${nSem} itens)`,
    `<button class="preset-btn" style="border-color:var(--farol-ok); color:var(--tx-1);" onclick="ctgAplicarSemDuvida()">gravar ${sem.length === 1 ? 'esta foto' : 'as ' + sem.length + ' fotos'}</button>`);
  if (com.length) h += linha(`<span style="color:var(--farol-perto);">${com.length} ${com.length === 1 ? 'foto' : 'fotos'} com dúvida (${com.reduce((s, f) => s + f.duvidas, 0)} linhas em âmbar)</span>: confira logo abaixo e grave cada uma`);
  if (esperando.length) h += linha(`<span style="color:var(--tx-3);">${esperando.length === 1 ? '1 foto chegou e está sendo lida' : esperando.length + ' fotos chegaram e estão sendo lidas'} (desde ${desde}) — o resultado sai ${ctgProximaLeitura()}; não precisa mandar de novo</span>`);
  // 21/10/2026: as paginas que faltam ja estao no quadro de paginas logo abaixo — nao se repetem aqui
  return h + '</div>';
}
// as fotos sem dúvida, todas de uma vez: uma pergunta só; grava cada uma pelo mesmo caminho do botão da foto
async function ctgAplicarSemDuvida() {
  const sem = ctgFotosLidas().filter((f) => !f.duvidas);
  if (!sem.length) return;
  const n = sem.reduce((s, f) => s + f.n, 0);
  if (!confirm(`Gravar ${n} itens de ${sem.length} ${sem.length === 1 ? 'foto' : 'fotos'} na folha ${CTG.folha.id}?\n(só as fotos em que não fiquei em dúvida; vale o número que está no campo)`)) return;
  let feitas = 0;
  for (const f of sem) { if (!(await ctgAplicarFoto(f.id, true))) break; feitas++; }
  if (feitas === sem.length) avisoAcao('ok', `✓ ${n} itens de ${sem.length} ${sem.length === 1 ? 'foto gravados' : 'fotos gravados'} na folha — às ${avisoHora()}.`);
  else if (feitas) avisoAcao('erro', `✗ Só ${feitas} de ${sem.length} fotos gravaram; as outras continuam na lista — clique de novo para gravar o resto.`);
  await ctgCarregar();
}

function ctgHtmlFotos() {
  const fotos = (CTG.fotos || []).filter((f) => f.status !== 'DESCARTADA');
  const grupos = [...new Set((CTG.base || []).map(ctgGrupoDe))].sort();
  // 21/10/2026: o titulo do quadro e' o "2 · Mandar a foto" de fora; aqui so o botao (antes repetia titulo e frase)
  let h = `    <div class="contexto" style="display:flex; gap:10px; align-items:center; flex-wrap:wrap;">
      <input type="file" accept="image/*" capture="environment" id="ctgFotoArq" style="display:none" onchange="ctgEnviarFoto(this)">
      <button class="preset-btn" onclick="ctgAbrirCamera()">📷 Tirar foto da folha</button>
      <div id="ctgFotoMsg" style="flex:1 1 100%;">${ctgEnvioHtml()}</div>
    </div>`;

  // QUAIS PAGINAS JA CHEGARAM (dono, 15/10/2026). Antes a pessoa escolhia o grupo numa lista
  // antes de fotografar — um passo a mais e uma chance de errar. Agora EU identifico a pagina
  // pelas linhas que transcrevo (grupo_das_linhas, em script/fotos_contagem.py) e este quadro
  // mostra o que ja entrou e o que falta. Em 14/10 duas paginas nunca foram fotografadas
  // (PAES e OUTROS, 20 itens) e so se descobriu no fim — era exatamente isto que faltava ver.
  const enviados = new Set(fotos.map((f) => f.grupo).filter(Boolean));
  const faltando = grupos.filter((g) => !enviados.has(g));
  const semPagina = fotos.filter((f) => !f.grupo && f.status === 'AGUARDANDO');
  const aLer = semPagina.length;
  h = ctgFaixa(fotos, faltando) + h;   // 20/10/2026: o que é para aprovar vem primeiro
  if (grupos.length) {
    // 28/10/2026 (dono, 19:30): um aviso só, coerente com a grade. Foto que chegou e ainda não foi lida pode ser a página
    // que "falta" — então, enquanto houver foto esperando leitura, não se pede para mandar de novo.
    const ultima = aLer ? ctgHora(semPagina.map((f) => f.criado_em).sort().pop()) : '';
    h += `<div class="contexto" style="text-align:left; ${aLer ? 'border-color:var(--info);' : faltando.length ? 'border-color:var(--farol-perto);' : ''}">
      <b>${grupos.length - faltando.length} de ${grupos.length} páginas já identificadas.</b>
      ${aLer ? `<div style="margin-top:4px;"><b style="color:var(--info);">✓ ${aLer === 1 ? '1 foto chegou' : aLer + ' fotos chegaram'} (${aLer === 1 ? 'às' : 'a última às'} ${ultima}) e ${aLer === 1 ? 'está sendo lida' : 'estão sendo lidas'}.</b>
          A página ${aLer === 1 ? 'dela' : 'de cada uma'} aparece aqui depois da leitura, ${ctgProximaLeitura()}. <b>Não precisa mandar de novo.</b>
          ${faltando.length ? `Se depois da leitura ainda faltar página, este quadro diz qual.` : ''}</div>`
        : faltando.length ? ` Falta${faltando.length === 1 ? '' : 'm'}: <b style="color:var(--farol-perto);">${faltando.join(' · ')}</b>.
          <div style="margin-top:4px;">Nenhuma foto chegou ${faltando.length === 1 ? 'desta página' : 'destas páginas'}. <b>Se você já mandou, mande de novo.</b></div>`
        : ' <span style="color:var(--farol-ok);">A folha está completa.</span>'}</div>`;
  }
  if (!fotos.length) return h;
  // A COLUNA DO ✓ (dono, 15/10/2026): "colocar um sinal ao lado de cada foto enviada, pro
  // usuário ter certeza que deu certo o envio". Quem está com o celular na mão precisa saber
  // que a foto CHEGOU — isso é uma pergunta, e o que ela vira depois é outra. Por isso o ✓
  // verde fala só da chegada, em toda linha, e a Situação conta o resto.
  // E a tabela entrou num `div id="tabela..."`: sem isso ela nasce sem a grade padrão (bordas,
  // cabeçalho, zebra) e a tela ficava com as colunas desalinhadas.
  h += `<div id="tabelaFotosContagem"><table><thead><tr>
      <th style="width:1%;"></th><th>Enviada</th><th>Página</th><th>Situação</th><th></th></tr></thead><tbody>`;
  fotos.forEach((f) => {
    const lidas = (CTG.fotoLinhas || []).filter((l) => l.id_foto === f.id).length;
    const quando = new Date(f.criado_em).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' });
    const cor = f.status === 'APLICADA' ? 'var(--farol-ok)'
              : f.status === 'TRANSCRITA' ? 'var(--info)' : 'var(--tx-4)';
    h += `<tr><td style="color:var(--farol-ok); font-size:15px;"
             title="A foto chegou ao painel e está guardada">✓</td>
      <td style="white-space:nowrap;">${quando}<span class="caption-label"> · ${estNome(f.quem)}</span></td>
      <td>${f.grupo ? f.grupo : `<span style="color:var(--tx-5);">a identificar</span>`}</td>
      <td style="color:${cor};">${f.status === 'AGUARDANDO' ? `✓ chegou · sendo lida — ${f.grupo ? 'resultado' : 'a página aparece'} ${ctgProximaLeitura()}`
            : f.status === 'TRANSCRITA' ? `<b>lida · ${lidas} ${lidas === 1 ? 'item' : 'itens'} — confira abaixo</b>` : 'gravada na contagem'}</td>
      <td>${f.status === 'AGUARDANDO' ? `<button class="preset-btn" onclick="ctgDescartarFoto(${f.id})">descartar</button>` : ''}</td></tr>`;
  });
  h += `</tbody></table></div>
    <div class="caption-label" style="margin-top:6px;">
      <span style="color:var(--farol-ok);">✓</span> chegou ao painel · nenhuma foto se perde depois deste sinal.</div>`;

  (CTG.fotos || []).filter((f) => f.status === 'TRANSCRITA').forEach((f) => {
    const linhas = (CTG.fotoLinhas || []).filter((l) => l.id_foto === f.id);
    if (!linhas.length) return;
    h += `<div class="section-label">Confira o que eu li na foto de ${f.grupo || 'toda a folha'}</div>
      <div class="caption-label">O que está em âmbar é onde eu fiquei em dúvida. Corrija o que precisar e grave.</div>
      <div id="tabelaConfereFoto"><table><thead><tr><th style="width:1%;">#</th><th>Item</th><th>Li na foto</th><th>Unidade</th><th>Corrigir unidade</th><th></th></tr></thead><tbody>`;
    linhas.forEach((l) => {
      h += `<tr${l.duvida ? ' style="background:var(--surface-2);"' : ''}>
        <td style="color:var(--tx-5);">${l.linha == null ? '' : l.linha}</td>
        <td>${ctgNomeHtml(l.nome_saipos)}${l.nota ? `<div class="caption-label" style="color:var(--farol-perto);">${l.nota}</div>` : ''}</td>
        <td><input type="number" step="0.001" id="fl_${l.id}" value="${l.qtd_lida == null ? '' : l.qtd_lida}"
             style="width:110px; background:var(--surface-2); border:1px solid ${l.duvida ? 'var(--farol-perto)' : 'var(--line)'}; border-radius:8px; color:var(--tx-1); padding:6px 8px;"></td>
        ${ctgUnidadeCelulas(l.nome_saipos)}
        <td style="color:${l.duvida ? 'var(--farol-perto)' : 'var(--tx-5)'};">${l.duvida ? 'confira' : ''}</td></tr>`;
    });
    h += `</tbody></table></div><div class="contexto"><button class="preset-btn" onclick="ctgAplicarFoto(${f.id})">Gravar estes itens na contagem</button></div>`;
  });
  return h;
}

// ---- A FOLHA IMPRESSA (dono, 08/10/2026: "vamos criar uma listagem impressa que possamos
// separar por grupo, pra facilitar"). A pessoa conta com o papel na mao, anota, e a folha volta
// para o painel — digitada aqui ou pela foto, que eu transcrevo e ela confere antes de gravar.
// A folha e CEGA de proposito: nao traz o esperado. E cada linha tem NUMERO, que e o que torna a
// transcricao da foto conferivel ("linha 14 = 3,5") sem depender de ler o nome escrito a mao.
const CTG_GRUPO_ORDEM = ['CARNES', 'CONGELADOS', 'LATICINIOS', 'HORTIFRUTI', 'SECOS', 'PAES',
  'BEBIDAS', 'CHOPES', 'DOCES', 'VEGANOS'];

// 21/10/2026: a folha vem de vw_est_folha_contagem — UMA linha por nome da base (as etiquetas do Saipos que viram o
// mesmo nome somam numa linha), com o grupo e a ordem decididos no banco. nome_saipos aqui e' a etiqueta que RECEBE a
// contagem (nome_saipos_conta); a tela mostra so o nome da base.
// 04/11/2026 (Organizador: "ficou em branco" gravava o nome velho do Saipos e dobrou 17 itens na folha 19 da AV):
// a contagem grava SEMPRE o nome da base. O custo (vw_est_curva) ainda vem pelo nome do Saipos, então a busca
// traduz: o próprio nome; senão o item da folha com aquele nome_base → nome_saipos_conta / nomes_saipos.
function ctgEscopoDe(nome) {
  const esc = CTG.escopo || [];
  const e = esc.find((x) => x.nome_saipos === nome);
  if (e) return e;
  const b = (CTG.base || []).find((x) => x.nome_base === nome);
  if (!b) return null;
  const nomes = [b.nome_saipos].concat(Array.isArray(b.nomes_saipos) ? b.nomes_saipos : String(b.nomes_saipos || '').split(/\s*[,;|]\s*/));
  return esc.find((x) => nomes.includes(x.nome_saipos)) || null;
}
function ctgDaFolha(r) {
  return { nome_saipos: r.nome_saipos_conta, nome_base: r.nome_base, nomes_saipos: r.nomes_saipos, un_saipos: r.un,
           qtd: r.qtd, tipo: r.tipo, situacao: r.situacao, grupo: r.grupo, ordem_grupo: r.ordem_grupo };
}
function ctgGrupoDe(i) {
  if (i.grupo) return i.grupo;
  if (i.subgrupo) return i.subgrupo;
  if (i.grupo_receita) return 'PREPAROS · ' + i.grupo_receita;
  if (i.tipo === 'RECEITA') return 'PREPAROS';
  return 'OUTROS';
}

// `soEsteGrupo` imprime um grupo só (dono, 14/10/2026: "quero a opção de imprimir elas por
// grupo"). Sem ele, sai a folha inteira. **A NUMERAÇÃO É SEMPRE A DA FOLHA INTEIRA**: a
// transcrição da foto acha o item pelo número da linha, e se cada grupo recomeçasse no 1 a mesma
// "linha 14" significaria um item em cada folha. Por isso a contagem corre sobre todos os grupos
// e só a impressão é filtrada.
async function ctgImprimir(soEsteGrupo) {
  const f = CTG.folha;
  if (!f) { alert('Abra a folha de contagem primeiro.'); return; }
  let base = CTG.base;
  if (!base) {
    const u = encodeURIComponent(CTG.unidade);
    base = CTG.base = (await consultarTudo(`vw_est_folha_contagem?select=nome_base,nome_saipos_conta,nomes_saipos,etiquetas,qtd,un,tipo,situacao,grupo,ordem_grupo&unidade=eq.${u}&order=ordem_grupo,grupo,nome_base`)).map(ctgDaFolha);
    CTG._grupoDe = null;
  }
  const itens = ctgListaDoPapel(f);
  if (!itens.length) { alert('Nada para imprimir nesta folha.'); return; }

  // ordem FIXA dentro do grupo: a numeracao impressa e o que a transcricao da foto usa para
  // saber de que item e cada numero. Se a ordem variar, "linha 14" deixa de significar algo.
  const { porGrupo, grupos: todos } = ctgPorGrupo(itens);
  const grupos = soEsteGrupo ? todos.filter((g) => g === soEsteGrupo) : todos;
  if (!grupos.length) { alert('Grupo não encontrado nesta folha: ' + soEsteGrupo); return; }
  // de onde cada grupo comeca a numerar, contando a folha inteira
  const comeca = {};
  let acumulado = 0;
  todos.forEach((g) => { comeca[g] = acumulado; acumulado += porGrupo[g].length; });

  const w = window.open('', '_blank');
  if (!w) { alert('O navegador bloqueou a janela de impressão — libere pop-ups para este site.'); return; }
  let n = 0;
  w.document.write(`<!DOCTYPE html><html><head><meta charset="utf-8">
    <title>Contagem ${f.data} — ${CTG.unidade}</title><style>
    body { font-family:Arial, sans-serif; color:#000; margin:18px 24px; }
    .cab { display:flex; justify-content:space-between; align-items:flex-start; border-bottom:2px solid #000; padding-bottom:6px; }
    h1 { font-size:18px; margin:0; }
    .cod { font-size:26px; font-weight:bold; letter-spacing:1px; }
    .sub { font-size:11.5px; color:#45443f; margin:3px 0 0; }
    .assina { font-size:12px; margin:10px 0 0; }
    .assina span { display:inline-block; border-bottom:1px solid #000; width:190px; margin:0 18px 0 4px; }
    h2 { font-size:13px; text-transform:uppercase; background:#e8e6dc; border:1px solid #9c9b90;
         padding:4px 6px; margin:0 0 4px; page-break-after:avoid; }
    /* QUEM DECIDE A QUEBRA E O JS, nao o seletor: o primeiro grupo sai sem a classe .quebra e
       os outros saem com ela. Ja erramos duas vezes aqui. Era .grupo:first-of-type, que
       nunca pegava: o cabecalho e a linha de assinatura tambem sao <div>, entao o primeiro
       .grupo nao e o primeiro div do corpo — e saia uma folha em branco na frente da lista
       (dono, 14/10/2026, com o print da previa); depois .grupo + .grupo, que e correto mas
       depende de os grupos serem irmaos diretos. Marcar no HTML nao depende de nada. */
    .grupo { padding-top:10px; }
    .quebra { page-break-before:always; break-before:page; }
    table { width:100%; border-collapse:collapse; page-break-inside:auto; }
    td, th { border-bottom:1px solid #bbb; padding:5px 6px; font-size:12.5px; text-align:left; }
    tr { page-break-inside:avoid; }
    th { font-size:10px; text-transform:uppercase; color:#45443f; }
    .n { width:30px; color:#45443f; font-size:11px; }
    .un { width:46px; }
    .box { width:120px; border:1px solid #000 !important; height:26px; }
    @media print { .naoimprime { display:none; } body { margin:10px 14px; } }
  </style></head><body>
    <button class="naoimprime" onclick="window.print()" style="float:right; padding:8px 14px;">Imprimir / salvar PDF</button>
    <div class="cab">
      <div><h1>Contagem de estoque — ${CTG.unidade}</h1>
        <div class="sub">${soEsteGrupo ? `grupo <b>${soEsteGrupo}</b>` : (f.escopo === 'CURVA_A' ? 'curva A' : 'folha inteira')} ·
          ${grupos.reduce((a, g) => a + porGrupo[g].length, 0)} itens · conte e escreva o número na caixa ·
          item que não existe mais, risque · <b>o número da linha é o que vale na foto</b></div></div>
      <div style="text-align:right;"><div class="cod">FOLHA ${f.id}</div>
        <div class="sub">${f.data.split('-').reverse().join('/')}</div></div>
    </div>
    <div class="assina">Contado por:<span></span> Conferido por:<span></span> Hora:<span style="width:90px;"></span></div>
    ${grupos.map((g, iG) => `<div class="grupo${iG ? ' quebra' : ''}"><h2>${g} — ${porGrupo[g].length} itens · linhas ${comeca[g] + 1} a ${comeca[g] + porGrupo[g].length}</h2><table>
      <tr><th class="n">#</th><th>Item</th><th class="un">Un</th><th class="box">Contado</th></tr>
      ${porGrupo[g].map((i, k) => { n = comeca[g] + k + 1; return `<tr><td class="n">${n}</td>
        <td>${i.nome_base || i.nome_saipos}</td>
        <td class="un">${(i.un_saipos || '').toLowerCase()}</td><td class="box"></td></tr>`; }).join('')}
    </table></div>`).join('')}
  </body></html>`);
  w.document.close();
  w.focus();
  setTimeout(() => { try { w.print(); } catch (e) {} }, 400);
}

// TUDO NO PAPEL (dono, 14/10/2026, mudando o plano do mesmo dia): "vamos somente com as folhas
// impressas, quero a opção de imprimir elas por grupo e que fiquem em ordem alfabética" e
// "podemos eliminar por ora a contagem direto pela tela". A tela deixou de ter campo de digitar:
// ela imprime, recebe a foto e mostra o que foi lido para conferir e corrigir.
// O que o papel leva: a folha CURVA_A leva os itens de maior valor; a GERAL leva tudo. Fica de
// fora o que não se conta (baixado, fora de controle, "não usa").
// ⚠️ A MESMA regra está em script/fotos_contagem.py (folha_numerada): a transcrição da foto acha
// o item pelo NÚMERO da linha, então as duas listas têm de ser idênticas. Mudou uma, muda a outra.
// NOME DA BASE (dono: "o que vale é a base daqui para tudo que o portal mostra"; proposta de 21/10/2026): a linha
// mostra SÓ o nome padrão da base (dono, 21/10/2026: "No estoque não precisa trazer nome do Saipos, a regra é clara, usar
// somente a base daqui"). A ORDEM e a NUMERAÇÃO da folha não mudam (a transcrição da foto acha o item pelo número da linha).
function ctgNomeHtml(nomeSaipos) {
  if (CTG._nomeBaseDe !== CTG.base) {
    CTG._nomeBase = new Map();
    (CTG.base || []).forEach((i) => {
      CTG._nomeBase.set(i.nome_saipos, i.nome_base);
      String(i.nomes_saipos || '').split(' + ').filter(Boolean).forEach((e) => CTG._nomeBase.set(e, i.nome_base));
    });
    CTG._nomeBaseDe = CTG.base;
  }
  const b = CTG._nomeBase.get(nomeSaipos);
  return `<b>${b || nomeSaipos}</b>`;   // dono, 21/10/2026: "No estoque não precisa trazer nome do Saipos ... usar somente a base daqui"
}
// UNIDADE NA CONFERENCIA DA FOTO (dono, 21/10/2026: "aqui pode trazer uma coluna com a unidade, e um campo para
// correção, assim já matamos itens que estejam com a unidade errada na base"). Mostra a unidade em que se conta (a do
// Saipos, a da etiqueta) e, quando a nossa (ft_insumos.un_uso) discorda sem decisão, as duas. O campo NÃO muda a base:
// grava uma PROPOSTA (est_propor_unidade) que o chat do Estoque aplica com antes e depois.
function ctgUnidadeDe(nomeSaipos) {
  if (!CTG.unConf) return null;
  if (CTG.unConf.has(nomeSaipos)) return CTG.unConf.get(nomeSaipos);
  const linha = (CTG.base || []).find((i) => String(i.nomes_saipos || '').split(' + ').includes(nomeSaipos));
  if (linha) return CTG.unConf.get(linha.nome_saipos) || null;
  // a transcricao da foto grava ora a etiqueta do Saipos, ora o nome da base: acha pelos dois
  if (CTG._unPorBaseDe !== CTG.unConf) { CTG._unPorBase = new Map([...CTG.unConf.values()].map((v) => [v.nome_base, v])); CTG._unPorBaseDe = CTG.unConf; }
  return CTG._unPorBase.get(nomeSaipos) || null;
}
function ctgUnidadeCelulas(nomeSaipos) {
  const x = ctgUnidadeDe(nomeSaipos);
  if (!x) return '<td style="color:var(--tx-5);">—</td><td></td>';
  const dm = (t) => String(t || '').slice(8, 10) + '/' + String(t || '').slice(5, 7);
  const disc = x.situacao === 'DISCORDAM, SEM DECISAO';
  // A NOSSA unidade manda (dono, 21/10); sem a nossa, mostra a do Saipos e pede a proposta (Estoque, 22/10: 39 itens)
  const un = `<b>${trEscH(x.un_nossa || x.un_decidida || x.un_contagem || '—')}</b>` +
    (!x.un_nossa ? `<div class="caption-label" style="color:var(--farol-perto);">sem unidade na base (a do Saipos): proponha a certa</div>`
      : x.situacao === 'L = KG' ? `<div class="caption-label">L = KG, na mesma proporção</div>`
      : disc ? `<div class="caption-label" style="color:var(--farol-perto);">no Saipos: ${trEscH(x.un_contagem)}</div>` : '');
  const opcoes = (CTG.unValidas || []).map((v) => `<option value="${trEscH(v)}"${x.un_proposta === v ? ' selected' : ''}>${trEscH(v)}</option>`).join('');
  const prop = x.proposta_id ? `<div class="caption-label">proposta: ${trEscH(x.un_proposta)} · ${trEscH(estNome(x.proposta_quem))} ${dm(x.proposta_em)}</div>` : '';
  return `<td>${un}</td><td><select onchange="ctgProporUnidade(this, '${trEscH(x.nome_saipos_conta).replace(/'/g, '&#39;')}')"
      style="background:var(--surface-2); border:1px solid var(--line); border-radius:8px; color:var(--tx-1); padding:5px 6px; font:inherit;">
      <option value="">${x.proposta_id ? '' : 'está certa'}</option>${opcoes}</select>${prop}</td>`;
}
async function ctgProporUnidade(sel, nomeSaipos) {
  const v = sel.value;
  if (!v) return;
  try {
    await ctgFetch('rpc/est_propor_unidade', {
      method: 'POST', extra: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ p_unidade: CTG.unidade, p_nome_saipos: nomeSaipos, p_un_proposta: v, p_obs: 'conferência da foto da contagem' }),
    });
    const x = CTG.unConf && CTG.unConf.get(nomeSaipos);
    if (x) { x.proposta_id = -1; x.un_proposta = v; x.proposta_quem = (rmbSessao() || {}).email || ''; x.proposta_em = new Date().toISOString(); }
    sel.insertAdjacentHTML('afterend', `<div class="caption-label" style="color:var(--farol-ok);">✓ proposta ${trEscH(v)} enviada</div>`);
  } catch (e) { avisoAcao('erro', `✗ A proposta NÃO foi enviada: ${e.message}. Escolha de novo.`); sel.value = ''; }
}
// o que da folha não bate com a base (vw_est_contagem_fora_da_base): só aparece quando há linha
function ctgFaixaForaBase() {
  const L = CTG.foraBase || [];
  if (!L.length) return '';
  return `<div class="contexto" style="text-align:left; border-color:var(--farol-perto);"><b>${L.length} ${L.length === 1 ? 'item da folha não bate' : 'itens da folha não batem'} com a base</b>${
    L.map((r) => `<div style="font-size:12.5px; margin-top:4px;">${ctgNomeHtml(r.nome_saipos)}<span style="color:var(--tx-3);">${r.o_que_fazer ? ' — ' + r.o_que_fazer : ''}${r.quem === 'DONO' ? ' (decisão do Neto)' : ' (o Neto acerta; não muda a contagem)'}</span></div>`).join('')}</div>`;
}

function ctgListaDoPapel(f) {
  const fora = ['BAIXADO POR ELE', 'FORA DO CONTROLE DE ESTOQUE', 'MARCADO NAO USA'];
  const curvaA = new Set(CTG.escopo.filter((i) => i.curva === 'A').map((i) => i.nome_saipos));
  return (CTG.base || []).filter((i) => !fora.includes(i.situacao))
                         .filter((i) => f.escopo === 'GERAL' || curvaA.has(i.nome_saipos));
}

// Os itens agrupados, na ordem da folha impressa e em ordem alfabética dentro do grupo.
function ctgPorGrupo(lista) {
  const porGrupo = {};
  // 21/10/2026: a ordem e' a do banco (ordem_grupo, grupo, nome_base) — a mesma que o fotos_contagem.py numera
  lista.slice().sort((a, b) => (a.nome_base || a.nome_saipos || '').localeCompare(b.nome_base || b.nome_saipos || '', 'pt-BR'))
       .forEach((i) => { const g = ctgGrupoDe(i); (porGrupo[g] = porGrupo[g] || []).push(i); });
  const ordemDe = {};
  lista.forEach((i) => { const g = ctgGrupoDe(i); if (i.ordem_grupo != null && ordemDe[g] == null) ordemDe[g] = Number(i.ordem_grupo); });
  const ordem = (g) => { if (ordemDe[g] != null) return ordemDe[g]; const k = CTG_GRUPO_ORDEM.indexOf(g); return k < 0 ? 50 : k; };
  return { porGrupo, grupos: Object.keys(porGrupo).sort((a, b) => ordem(a) - ordem(b) || a.localeCompare(b, 'pt-BR')) };
}

// A TELA EM TRÊS QUADROS (dono, 14/10/2026): "vai ter um quadro com um botão pra impressão das
// listas, um quadro com um botão pra subir as fotos e um quadro com a lista gerada com a contagem
// pra conferência e correção". É a ordem do trabalho: imprime, conta no papel, fotografa, confere.
function ctgHtmlContar(f) {
  const papel = ctgListaDoPapel(f);
  const feito = new Map(CTG.itens.map((i) => [i.nome_saipos, i]));
  const n = CTG.itens.length;
  const { porGrupo, grupos } = ctgPorGrupo(papel);

  let h = ctgFaixaForaBase() + ctgProximoPassoHtml(f) + ctgHorarioHtml(f) + `<div class="cards">
      <div class="card ${n >= papel.length && papel.length ? 'pos' : 'neutral'}"><div class="card-lbl">Contados</div>
        <div class="card-val">${n} de ${papel.length}</div>
        <div class="card-pct">${CTG.itens.filter((x) => x.conferido_em).length} conferidos · ${grupos.length} ${grupos.length === 1 ? 'grupo' : 'grupos'} na folha</div></div>
    </div>`;   // 12/11/2026 (auditoria 07/11): o card "Fotos a transcrever" saiu — o Próximo passo e o quadro das páginas já dizem

  // ---------------- QUADRO 1: imprimir as listas ----------------
  // 21/10/2026 (dono): "mantemos somente a impressão de todas as listas de uma só vez" — saem os botões por grupo
  // (cada grupo continua saindo numa folha própria dentro da impressão). O check de contados vem depois.
  h += `<div class="section-label">1 · Imprimir as listas</div>
    <div class="caption-label">Cada grupo sai numa folha, com os itens em ordem alfabética.</div>
    <div style="margin:10px 0 2px;"><button class="preset-btn" onclick="ctgImprimir()"
      style="font-size:14px; padding:11px 16px;">🖨️ Imprimir tudo — ${papel.length} ${papel.length === 1 ? 'item' : 'itens'}</button></div>`;

  // ---------------- QUADRO 2: subir as fotos ----------------
  h += `<div class="section-label">2 · Mandar a foto da folha preenchida</div>`;
  h += ctgHtmlFotos();

  // ---------------- QUADRO 3: conferir e corrigir ----------------
  h += `<div class="section-label">3 · A contagem, para conferir e corrigir${n ? ` — ${n} ${n === 1 ? 'item' : 'itens'}` : ''}</div>
    <div id="ctgConferir">${ctgHtmlConferir()}</div>`;

  // ---------------- QUADRO 4: fechar (29/10/2026: o passo que faltava na tela) ----------------
  // 12/11/2026 (auditoria 07/11): um botão Fechar só na tela — com tudo contado e conferido ele está no Próximo passo, no alto
  const conf = CTG.itens.filter((x) => x.conferido_em).length;
  const pronto = n && conf >= n && n >= papel.length;
  h += `<div class="section-label">4 · Fechar a contagem</div>
    <div class="contexto" style="text-align:left;"><b>Sem fechar, a contagem não vale.</b> Fechada, aparece o esperado contra o contado.
      <div style="margin-top:10px;">${pronto ? '<span style="color:var(--tx-3);">Tudo contado e conferido: o botão 🔒 Fechar a contagem está no Próximo passo, no alto.</span>'
        : `<button class="preset-btn" onclick="ctgFechar()" style="font-size:14px; padding:11px 18px;">🔒 Fechar a contagem</button>`}</div></div>`;
  return h;
}
// 29/10/2026 (dono 17:02): quando a contagem começou e terminou — dois cliques, o topo mostra "Contagem: HH:MM → HH:MM"
function ctgHorarioHtml(f) {
  const hm = (v) => v ? new Date(v).toLocaleTimeString('pt-BR', { timeZone: 'America/Sao_Paulo', hour: '2-digit', minute: '2-digit' }) : '--:--';
  const ini = f.contagem_inicio, fim = f.contagem_fim;
  const dur = ini && fim ? Math.round((new Date(fim) - new Date(ini)) / 60000) : null;
  return `<div class="contexto" style="text-align:left; display:flex; gap:10px; align-items:center; flex-wrap:wrap;">
      <b style="font-size:15px;">Contagem: ${hm(ini)} → ${hm(fim)}</b>${dur != null ? `<span style="color:var(--tx-4);">${Math.floor(dur / 60) ? Math.floor(dur / 60) + ' h ' : ''}${dur % 60} min</span>` : ''}
      <span style="flex:1;"></span>
      <button class="preset-btn${ini ? '' : ' active'}" onclick="ctgMarcarHora('INICIO')">${ini ? 'corrigir início' : '▶ Comecei'}</button>
      <button class="preset-btn${ini && !fim ? ' active' : ''}" onclick="ctgMarcarHora('FIM')">${fim ? 'corrigir fim' : '■ Terminei'}</button></div>`;
}
async function ctgMarcarHora(qual) {
  const f = CTG.folha;
  if (!f) return;
  if ((qual === 'INICIO' ? f.contagem_inicio : f.contagem_fim) && !confirm(`Marcar o ${qual === 'INICIO' ? 'início' : 'fim'} de novo, com a hora de agora?`)) return;
  avisoAcao('enviando', qual === 'INICIO' ? 'Marcando o início…' : 'Marcando o fim…');
  const r = await trRpcSeguro('est_contagem_marcar', { p_id: f.id, p_evento: qual });
  if (!r.ok) return avisoAcao('erro', `✗ NÃO marcou: ${await trErroDe(r)}. Tente de novo.`, () => ctgMarcarHora(qual));
  const v = await r.json().catch(() => null), x = Array.isArray(v) ? v[0] : v;
  if (x) { f.contagem_inicio = x.contagem_inicio; f.contagem_fim = x.contagem_fim; }
  avisoAcao('ok', `✓ ${qual === 'INICIO' ? 'Início' : 'Fim'} da contagem marcado — às ${avisoHora()}.`);
  ctgRender();
}
// 29/10/2026 (dono): UM próximo passo no alto da contagem aberta — o que falta para a contagem valer, na ordem
function ctgProximoPassoHtml(f) {
  const papel = ctgListaDoPapel(f), n = CTG.itens.length, conf = CTG.itens.filter((x) => x.conferido_em).length;
  const lendo = (CTG.fotos || []).filter((x) => x.status === 'AGUARDANDO').length;
  const caixa = (cor, txt, bt) => `<div class="contexto" style="text-align:left; border:2px solid ${cor}; display:flex; gap:12px; align-items:center; flex-wrap:wrap;">
      <div style="flex:1 1 260px;"><div style="font-size:11px; font-weight:700; color:var(--tx-4); text-transform:uppercase;">Próximo passo</div>
        <div style="font-size:16px; font-weight:800; color:${cor};">${txt}</div></div>${bt || ''}</div>`;
  if (n && conf >= n && n >= papel.length)
    return caixa('var(--marca-amarelo)', `✓ Tudo contado e conferido (${n} ${n === 1 ? 'item' : 'itens'}). Falta fechar a contagem.`,
      `<button class="preset-btn" onclick="ctgFechar()" style="font-size:15px; padding:12px 20px; border-color:var(--marca-amarelo);">🔒 Fechar a contagem</button>`);
  if (lendo) return caixa('var(--info)', `${lendo} ${lendo === 1 ? 'foto está sendo lida' : 'fotos estão sendo lidas'} — depois, conferir os números (passo 3).`);
  if (n < papel.length) return caixa('var(--farol-perto)', `Faltam ${papel.length - n} de ${papel.length} itens sem número — mande a foto da folha (passo 2) ou digite no passo 3.`);
  return caixa('var(--farol-perto)', `Falta conferir ${n - conf} ${n - conf === 1 ? 'item' : 'itens'} (passo 3). Depois, fechar a contagem.`);
}

// A contagem direto na tela saiu em 14/10/2026 ("podemos eliminar por ora a contagem direto pela
// tela"): tudo vai pelo papel e volta pela foto. O que sobrou do caminho antigo — ctgSalvar e
// ctgHtmlConferir — continua servindo a CORRECAO no quadro 3, que e onde se digita hoje.

function ctgHtmlConferencia(f) {
  const c = CTG.conf;
  const falta = c.filter((x) => x.situacao === 'FALTA');
  const sobra = c.filter((x) => x.situacao === 'SOBRA');
  const partida = c.filter((x) => x.situacao === 'PONTO DE PARTIDA');
  const explicar = c.filter((x) => x.precisa_explicar && !Number(x.explicado_reais || 0));
  const rs = (a) => a.reduce((s, x) => s + Number(x.diferenca_reais || 0), 0);

  let h = `<div class="cards cards-3">
      <div class="card ${falta.length ? 'neg' : 'pos'}"><div class="card-lbl">Falta na prateleira</div>
        <div class="card-val">R$ ${fmt(Math.abs(rs(falta)))}</div><div class="card-pct">${falta.length} itens</div></div>
      <div class="card neutral"><div class="card-lbl">Sobra</div>
        <div class="card-val">R$ ${fmt(rs(sobra))}</div><div class="card-pct">${sobra.length} itens</div></div>
      <div class="card ${explicar.length ? 'highlight' : 'pos'}"><div class="card-lbl">Esperando explicação</div>
        <div class="card-val">${explicar.length}</div><div class="card-pct">diferença acima de R$ 500</div></div>
    </div>`;

  if (partida.length) {
    h += `<div class="contexto">${partida.length} ${partida.length === 1 ? 'item está sendo contado' : 'itens estão sendo contados'}
      pela primeira vez — ${partida.length === 1 ? 'ele é' : 'eles são'} o ponto de partida e não ${partida.length === 1 ? 'tem' : 'têm'} diferença.</div>`;
  }

  h += `<div class="section-label">Item a item</div>
    <div class="caption-label">Diferença acima de R$ 500 precisa de motivo escrito; o resto aparece para você ver.</div>
    <div id="tabelaConferencia"><table><thead><tr>
      <th>Item</th><th>Contado</th><th>Esperado</th>
      <th>Diferença</th><th>Diferença em R$</th><th>Situação</th><th></th></tr></thead><tbody>`;
  // 12/11/2026 (auditoria 07/11): números à esquerda, a unidade junto e a situação na palavra do operador
  const SIT_CTG = { FALTA: 'falta', SOBRA: 'sobra', BATEU: 'bateu', 'PONTO DE PARTIDA': 'primeira contagem' };
  c.forEach((x) => {
    const cor = x.situacao === 'FALTA' ? 'var(--farol-fora)'
              : x.situacao === 'SOBRA' ? 'var(--amber-2)'
              : x.situacao === 'BATEU' ? 'var(--farol-ok)' : 'var(--tx-5)';
    const temNome = Number(x.explicado_reais || 0) !== 0;
    const un = x.un ? ` <span style="color:var(--tx-4); font-size:11px;">${trEscH(x.un)}</span>` : '';
    h += `<tr><td>${ctgNomeHtml(x.nome_saipos)}</td>
      <td style="white-space:nowrap;">${fmt(Number(x.qtd_contada))}${un}</td>
      <td style="white-space:nowrap;">${x.esperado === null ? '—' : fmt(Number(x.esperado)) + un}</td>
      <td style="white-space:nowrap; color:${cor};">${x.diferenca === null ? '—' : fmt(Number(x.diferenca)) + un}</td>
      <td style="white-space:nowrap; color:${cor};">${x.diferenca_reais === null ? '—' : 'R$ ' + fmt(Number(x.diferenca_reais))}</td>
      <td style="color:${cor};">${trEscH(SIT_CTG[x.situacao] || String(x.situacao || '').toLowerCase())}</td>
      <td>${x.precisa_explicar && !temNome ? `<button class="preset-btn" onclick="ctgExplicar(${x.id}, ${x.diferenca}, ${x.diferenca_reais})">explicar</button>`
            : temNome ? '<span style="color:var(--farol-ok);">explicado</span>' : ''}</td></tr>`;
  });
  h += `</tbody></table></div>`;
  return h;
}

async function ctgAbrir(escopo) {
  const s = rmbSessao();
  try {
    await ctgFetch('est_inventario', {
      method: 'POST', extra: { Prefer: 'return=representation' },
      body: JSON.stringify({ unidade: CTG.unidade, local: 'ESTOQUE', data: ctgHoje(), escopo, aberta_por: s.email }),
    });
    await ctgCarregar();
  } catch (e) { avisoAcao('erro', `✗ A folha NÃO abriu: ${e.message}. Tente de novo.`); }
}

async function ctgSalvar(campo, nome, un, custo, custoFonte) {
  if (campo.value === '') return;
  const s = rmbSessao();
  campo.style.borderColor = 'var(--line)';
  try {
    await ctgFetch('est_inventario_itens?on_conflict=id_inventario,nome_saipos', {
      method: 'POST', extra: { Prefer: 'resolution=merge-duplicates,return=minimal' },
      body: JSON.stringify({ id_inventario: CTG.folha.id, nome_saipos: nome, un: un || null,
        qtd_contada: Number(campo.value), custo, custo_fonte: custoFonte || null, contado_por: s.email,
        // numero corrigido volta a NAO conferido: ninguem olhou o valor novo ainda
        conferido_em: null, conferido_por: null }),
    });
    campo.style.borderColor = 'var(--farol-ok)';
    // a cópia local tem de acompanhar a CORREÇÃO também, senão a lista de conferir mostra o
    // número velho até alguém recarregar a tela
    const ja = CTG.itens.find((i) => i.nome_saipos === nome);
    const agora = new Date().toISOString();
    if (ja) { ja.qtd_contada = Number(campo.value); ja.contado_em = agora; ja.contado_por = s.email; }
    else CTG.itens.push({ nome_saipos: nome, un: un || null, qtd_contada: Number(campo.value),
                          contado_em: agora, contado_por: s.email });
    const conf = document.getElementById('ctgConferir');
    if (conf) conf.innerHTML = ctgHtmlConferir();
    avisoAcao('ok', `✓ ${nome}: ${campo.value} ${un || ''} gravado — às ${avisoHora()}.`);
  } catch (e) {
    campo.style.borderColor = 'var(--farol-fora)';
    avisoAcao('erro', `✗ ${nome} NÃO gravou: ${e.message}. O número continua no campo (borda vermelha) — tente de novo.`, () => ctgSalvar(campo, nome, un, custo, custoFonte));
  }
}

// APAGAR A LINHA QUE FOI PARAR NO ITEM ERRADO (dono, 14/10/2026, depois de testar com a Rita:
// "pode acontecer da pessoa colocar o valor errado"). Corrigir o número é digitar por cima;
// apagar é para quando o número foi lançado no item errado. Só vale com a folha ABERTA — folha
// fechada já é o ponto de partida do saldo, e o banco barra pela policy.
async function ctgApagar(nome) {
  const j = CTG.itens.find((i) => i.nome_saipos === nome);
  if (!j) return;
  if (!confirm(`Apagar a contagem de ${nome} (${fmt(Number(j.qtd_contada))} ${j.un || ''})?\n\n`
             + `A linha some da folha e o item volta a aparecer como não contado.`)) return;
  try {
    await ctgFetch(`est_inventario_itens?id_inventario=eq.${CTG.folha.id}`
                   + `&nome_saipos=eq.${encodeURIComponent(nome)}`,
                   { method: 'DELETE', extra: { Prefer: 'return=minimal' } });
    CTG.itens = CTG.itens.filter((i) => i.nome_saipos !== nome);
    avisoAcao('ok', `✓ ${nome} apagado da folha — volta a aparecer como não contado. Às ${avisoHora()}.`);
    ctgRender();
  } catch (e) { avisoAcao('erro', `✗ ${nome} NÃO foi apagado: ${e.message}. Tente de novo.`); }
}

// A hora vem do banco em UTC (armadilha conhecida do projeto). Na tela, sempre São Paulo.
function ctgHora(v) {
  if (!v) return '';
  return new Date(v).toLocaleTimeString('pt-BR',
    { hour: '2-digit', minute: '2-digit', timeZone: 'America/Sao_Paulo' });
}

// CONFERIR E CORRIGIR — a lista do que já foi digitado, para revisar antes de fechar.
// O CHECK DE CONFERÊNCIA (dono, 14/10/2026: "pode ser check de marcação e um só ok no final").
// O número do quadro 3 nasceu da LEITURA DE UMA FOTO, e leitura de foto erra: enquanto ninguém
// marcar, ele está no sistema sem ter passado por olho humano. Marcar é local; o OK do fim é que
// grava quem conferiu e quando.
function ctgMarcar(nome, ligado) {
  CTG.marcados = CTG.marcados || new Set();
  CTG.okMsg = null;
  if (ligado) CTG.marcados.add(nome); else CTG.marcados.delete(nome);
  const bt = document.getElementById('ctgBtOk');
  if (bt) {
    const n = CTG.marcados.size;
    bt.textContent = n ? `✓ OK — conferi ${n} ${n === 1 ? 'item' : 'itens'}` : '✓ OK — marque os itens conferidos';
    bt.style.borderColor = n ? 'var(--marca-amarelo)' : 'var(--line)';
  }
}
function ctgMarcarTodos(ligado) {
  CTG.marcados = new Set(ligado ? CTG.itens.filter((i) => !i.conferido_em).map((i) => i.nome_saipos) : []);
  ctgRender();
}
// 28/10/2026 (dono, 18:50): o resultado do OK fica escrito ao lado do botão — não some e não é alert
function ctgOkMsgHtml() {
  const m = CTG.okMsg;
  if (!m) return '';
  return `<span style="font-size:14px; font-weight:700; color:${m.ok ? 'var(--farol-ok)' : 'var(--farol-fora)'};">${m.texto}</span>`;
}
async function ctgConferirOk() {
  const nomes = [...(CTG.marcados || new Set())];
  if (!nomes.length) { CTG.okMsg = { ok: false, texto: '✗ Marque primeiro os itens que você conferiu.' }; ctgRender(); return; }
  const bt = document.getElementById('ctgBtOk');
  if (bt) { bt.disabled = true; bt.textContent = 'Gravando…'; }
  const s = rmbSessao();
  const agora = new Date().toISOString();
  try {
    const lista = nomes.map((n) => `"${n.replace(/"/g, '\\"')}"`).join(',');
    await ctgFetch(`est_inventario_itens?id_inventario=eq.${CTG.folha.id}&nome_saipos=in.(${encodeURIComponent(lista)})`, {
      method: 'PATCH', extra: { Prefer: 'return=minimal' },
      body: JSON.stringify({ conferido_em: agora, conferido_por: s.email }),
    });
    CTG.itens.forEach((i) => { if (nomes.includes(i.nome_saipos)) { i.conferido_em = agora; i.conferido_por = s.email; } });
    CTG.marcados = new Set();
    CTG.okMsg = { ok: true, texto: `✓ Conferido: ${nomes.length} ${nomes.length === 1 ? 'item' : 'itens'} às ${ctgHora(agora)}.` };
    ctgRender();
    // 29/10/2026 (dono): conferir tudo e fechar são o mesmo trabalho — o último OK já oferece fechar (um clique a menos)
    const papel = ctgListaDoPapel(CTG.folha);
    if (CTG.itens.length >= papel.length && CTG.itens.every((i) => i.conferido_em)
        && confirm(`Tudo contado e conferido (${CTG.itens.length} itens).\n\nFechar a contagem agora? Os números viram o ponto de partida do saldo.`)) {
      await ctgFechar();
      return;
    }
  } catch (e) {
    CTG.okMsg = { ok: false, texto: `✗ Não gravou: ${trEscH(e.message.slice(0, 120))}. As marcas continuam — tente de novo.` };
    ctgRender();
  }
}

// o que ficou em branco no papel e ainda não foi preenchido aqui (some da lista assim que grava)
// as linhas em branco que ainda esperam resposta (0 ou o valor contado)
function ctgBrancosPendentes() {
  // 04/11/2026: grava e compara pelo NOME DA BASE (b.nome da vw_est_contagem_grade), nunca pelo nome_saipos_conta.
  // Linha antiga gravada com o nome do Saipos também conta como preenchida (não reaparece para digitar de novo).
  const ja = new Set(CTG.itens.map((i) => i.nome_saipos));
  // linha de foto ainda esperando "Gravar estes itens" já tem campo na conferência da foto: não repete aqui
  const fotoPendente = new Set((CTG.fotos || []).filter((f) => f.status === 'TRANSCRITA').map((f) => f.id));
  return (CTG.brancos || []).filter((b) => !ja.has(b.nome) && !ja.has(b.nome_saipos_conta)
    && !(b.qtd_lida != null && fotoPendente.has(b.id_foto)));
}
// 05/11/2026: página com o começo fora da foto (vermelho, com o botão da câmera) e item que saiu da folha (cinza).
function ctgHtmlGradeAviso() {
  const A = CTG.gradeAviso || [];
  const ja = new Set(CTG.itens.map((i) => i.nome_saipos));
  const falta = A.filter((x) => x.situacao === 'FALTA A FOTO DO COMECO DA PAGINA' && !ja.has(x.nome));
  const fora = A.filter((x) => x.situacao === 'NAO CONTA MAIS');
  let h = '';
  if (falta.length) {
    const lendo = (CTG.fotos || []).some((f) => f.status === 'AGUARDANDO');
    const grupos = [...new Set(falta.map((x) => x.grupo))];
    h += `<div class="contexto" style="text-align:left; border-color:${lendo ? 'var(--info)' : 'var(--farol-fora)'}; margin-bottom:10px;">
      <b style="color:${lendo ? 'var(--tx-1)' : 'var(--farol-fora)'};">A foto não pegou o começo de ${grupos.length === 1 ? 'uma página' : grupos.length + ' páginas'}: ${falta.length} ${falta.length === 1 ? 'item ficou' : 'itens ficaram'} sem leitura</b>
      ${grupos.map((g) => { const l = falta.filter((x) => x.grupo === g), n = l.map((x) => x.linha).filter((v) => v != null);
        return `<div style="font-size:12.5px; margin-top:4px;"><b>${trEscH(g || 'sem página')}</b>${n.length ? ` — linhas ${Math.min(...n)} a ${Math.max(...n)}` : ''} (${l.length} ${l.length === 1 ? 'item' : 'itens'})</div>`; }).join('')}
      <div style="font-size:12.5px; margin-top:6px;">${lendo ? `Chegou foto que ainda está sendo lida (resultado ${ctgProximaLeitura()}). Se ela for desta parte, <b>não precisa mandar de novo</b>.`
        : 'Fotografe o começo da página (a parte de cima, com os números das linhas) e mande.'}</div>
      ${lendo ? '' : `<div style="margin-top:8px;"><button class="preset-btn" style="border-color:var(--farol-fora); color:var(--tx-1); font-size:14px; padding:9px 14px;" onclick="ctgAbrirCamera()">📷 Mandar a foto que falta</button></div>`}</div>`;
  }
  if (fora.length) h += `<div class="caption-label" style="text-align:left; margin-bottom:10px;">Saíram da folha depois de impressa e não contam mais: <s>${fora.map((x) => trEscH(x.nome)).join(', ')}</s>.</div>`;
  return h;
}
function ctgHtmlBrancos() {
  const L = ctgBrancosPendentes();
  if (!L.length) return '';
  const nLidas = L.filter((b) => b.qtd_lida != null).length;
  let h = `<div class="contexto" style="text-align:left; border-color:var(--farol-perto); margin-bottom:10px;">
    <b style="color:var(--farol-perto);">${L.length} ${L.length === 1 ? 'item ainda sem contagem' : 'itens ainda sem contagem'}</b>
    <div style="font-size:12.5px; margin-top:2px;">${nLidas === L.length ? 'A foto leu, mas o número não foi gravado.'
      : nLidas ? 'Ficaram em branco no papel, ou a foto leu e o número não foi gravado.' : 'Ficaram em branco no papel.'}
      Se não tinha, digite <b>0</b>; se tinha, digite o que foi contado. Grava ao sair do campo.</div>
    <div id="tabelaBrancos" style="margin-top:6px;"><table><thead><tr><th style="width:1%;">#</th><th>Item</th><th>Página</th><th>Contado</th></tr></thead><tbody>`;
  L.forEach((b) => {
    const nome = JSON.stringify(b.nome).replace(/"/g, '&quot;');
    const e = ctgEscopoDe(b.nome) || (CTG.escopo || []).find((x) => x.nome_saipos === b.nome_saipos_conta) || {};
    h += `<tr><td style="color:var(--tx-5);">${b.linha == null ? '' : b.linha}</td>
      <td><b>${trEscH(b.nome)}</b>${b.situacao === 'EM BRANCO NO FIM DA PAGINA' ? '<div class="caption-label">no fim da página</div>' : ''}${
        b.qtd_lida != null ? `<div class="caption-label" style="color:var(--farol-perto);">a foto leu ${fmt(Number(b.qtd_lida))} ${trEscH(b.un || '')} — confira e digite</div>` : ''}</td>
      <td style="color:var(--tx-4);">${trEscH(b.grupo || '')}</td>
      <td style="white-space:nowrap;"><input type="number" step="0.001" min="0" inputmode="decimal" placeholder="0 ou o valor"
           onchange="ctgSalvar(this, ${nome}, ${JSON.stringify(b.un || '').replace(/"/g, '&quot;')}, ${e.custo || 'null'}, ${JSON.stringify(e.custo_fonte || '').replace(/"/g, '&quot;')})"
           style="width:120px; background:var(--surface-2); border:1px solid var(--farol-perto); border-radius:8px; color:var(--tx-1); padding:8px;">
        <span style="color:var(--tx-5); font-size:11.5px;"> ${trEscH(b.un || '')}</span></td></tr>`;
  });
  return h + `</tbody></table></div></div>`;
}

function ctgHtmlConferir() {
  // 12/11/2026 (auditoria 07/11): na ORDEM DA FOLHA impressa (a mesma numeração de ctgImprimir), com o # e a página —
  // quem confere segue o papel na mão. O que não está na folha vai para o fim, pela hora.
  const lin = new Map();
  if (CTG.folha) {
    const { porGrupo, grupos } = ctgPorGrupo(ctgListaDoPapel(CTG.folha));
    let k = 0;
    grupos.forEach((g) => porGrupo[g].forEach((i) => { k++; const v = { linha: k, grupo: g };
      if (i.nome_saipos && !lin.has(i.nome_saipos)) lin.set(i.nome_saipos, v);
      if (i.nome_base && !lin.has(i.nome_base)) lin.set(i.nome_base, v); }));
  }
  const L = (j) => lin.get(j.nome_saipos) || null;
  const feitos = CTG.itens.slice().sort((a, b) => ((L(a) || {}).linha || 1e9) - ((L(b) || {}).linha || 1e9)
                                               || (b.contado_em || '').localeCompare(a.contado_em || ''));
  const brancos = ctgHtmlGradeAviso() + ctgHtmlBrancos();
  if (!feitos.length) {
    return brancos || `<div class="caption-label">Nada ainda — o que vier da foto aparece aqui para conferir e corrigir.</div>`;
  }
  const porNome = new Map(CTG.escopo.map((i) => [i.nome_saipos, i]));
  CTG.marcados = CTG.marcados || new Set();
  const jaConferidos = feitos.filter((j) => j.conferido_em).length;
  const faltam = feitos.length - jaConferidos;

  let h = brancos + `<div class="caption-label">Na ordem da folha. Corrija o número aqui, marque o que está certo e dê o OK.
      ${jaConferidos ? `<b>${jaConferidos} de ${feitos.length} já conferidos.</b>` : ''}</div>`;
  // 28/10/2026 (dono, 19:08): o OK fica no INÍCIO da tabela, junto do "marcar os que faltam" — um botão só
  if (faltam || CTG.okMsg) {
    h += `<div style="margin:8px 0 6px; display:flex; gap:8px; align-items:center; flex-wrap:wrap;">
      ${faltam ? `<button class="preset-btn" id="ctgBtOk" onclick="ctgConferirOk()"
      style="font-size:14px; padding:11px 18px;${CTG.marcados.size ? ' border-color:var(--marca-amarelo);' : ''}">${
      CTG.marcados.size ? `✓ OK — conferi ${CTG.marcados.size} ${CTG.marcados.size === 1 ? 'item' : 'itens'}`
                        : '✓ OK — marque os itens conferidos'}</button>` : ''}
      ${faltam > 1 ? `<button class="preset-btn" onclick="ctgMarcarTodos(true)">marcar os ${faltam} que faltam</button>` : ''}
      ${CTG.marcados.size ? `<button class="preset-btn" onclick="ctgMarcarTodos(false)">limpar as marcas</button>` : ''}
      ${ctgOkMsgHtml()}</div>`;
  }
  h += `<div id="tabelaConferir"><table><thead><tr>
      <th style="width:34px;">✓</th><th style="width:1%;">#</th><th>Item</th><th>Página</th><th>Contado</th><th>Hora</th><th></th></tr></thead><tbody>`;
  feitos.forEach((j) => {
    const i = porNome.get(j.nome_saipos) || ctgEscopoDe(j.nome_saipos) || {};   // linha pelo nome da base: custo traduzido
    const id = btoa(unescape(encodeURIComponent(j.nome_saipos))).replace(/[^A-Za-z0-9]/g, '');
    const lf = L(j) || {};
    h += `<tr${j.conferido_em ? ' style="opacity:.72;"' : ''}>
      <td>${j.conferido_em
            ? `<span style="color:var(--farol-ok); font-weight:700;" title="Conferido por ${estNome(j.conferido_por)} às ${ctgHora(j.conferido_em)}">✓</span>`
            : `<input type="checkbox" id="ctgc_${id}" ${CTG.marcados.has(j.nome_saipos) ? 'checked' : ''}
                 onchange="ctgMarcar(${JSON.stringify(j.nome_saipos).replace(/"/g, '&quot;')}, this.checked)"
                 style="width:20px; height:20px;">`}</td>
      <td style="color:var(--tx-5);">${lf.linha || ''}</td>
      <td>${ctgNomeHtml(j.nome_saipos)}</td>
      <td style="color:var(--tx-4); font-size:12px;">${trEscH(lf.grupo || 'fora da folha')}</td>
      <td style="white-space:nowrap;"><input type="number" step="0.001" inputmode="decimal"
           id="ctgr_${id}" value="${j.qtd_contada}"
           onchange="ctgSalvar(this, ${JSON.stringify(j.nome_saipos).replace(/"/g, '&quot;')}, ${JSON.stringify(j.un || i.un || '').replace(/"/g, '&quot;')}, ${i.custo || 'null'}, ${JSON.stringify(i.custo_fonte || '').replace(/"/g, '&quot;')})"
           style="width:104px; background:var(--surface-2); border:1px solid var(--line); border-radius:8px; color:var(--tx-1); padding:8px;">
        <span style="color:var(--tx-5); font-size:11.5px;"> ${j.un || i.un || ''}</span></td>
      <td style="color:var(--tx-4); font-size:12px;">${ctgHora(j.contado_em)}</td>
      <td><button class="preset-btn" onclick="ctgApagar(${JSON.stringify(j.nome_saipos).replace(/"/g, '&quot;')})"
            title="Apagar esta linha da folha">apagar</button></td></tr>`;
  });
  h += `</tbody></table></div>`;
  return h;
}

// Fechar é o instante em que o ESPERADO é carimbado em cada linha, a partir do nosso saldo —
// por isso quem fecha é a função do banco (est_fechar_contagem), e não um PATCH de status.
// Depois do fechamento a própria contagem vira o ponto de partida do saldo: se o esperado não
// fosse gravado aqui, ele seria irrecuperável e toda diferença daria zero.
async function ctgFechar() {
  // 05/11/2026 (proposta da grade, 22/10): linha em branco sem resposta não deixa fechar — 0 é resposta, vazio não
  const vazios = ctgBrancosPendentes().length;
  if (vazios) return avisoAcao('atencao', `! A folha não fechou: ${vazios} ${vazios === 1 ? 'item ficou' : 'itens ficaram'} em branco no papel. Digite 0 se não tinha, ou o valor contado, no quadro "ainda sem contagem", e feche de novo.`);
  const esperados = ctgListaDoPapel(CTG.folha).length;
  const n = CTG.itens.length;
  if (n < esperados && !confirm(`Faltam ${esperados - n} itens sem contar. Fechar assim mesmo?`)) return;
  const semConferir = CTG.itens.filter((i) => !i.conferido_em).length;
  if (semConferir && !confirm(`${semConferir} ${semConferir === 1 ? 'item veio da foto e não foi conferido' : 'itens vieram da foto e não foram conferidos'}.

`
      + `Depois de fechar, o número vira o ponto de partida do saldo e não se corrige mais. Fechar assim mesmo?`)) return;
  avisoAcao('enviando', 'Fechando a folha…');
  let res;
  try {
    const r = await ctgFetch('rpc/est_fechar_contagem', {
      method: 'POST', extra: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ p_id: CTG.folha.id }),
    });
    res = (await r.json())[0] || {};
  } catch (e) { return avisoAcao('erro', `✗ A folha NÃO fechou: ${e.message}. Ela continua aberta — tente de novo.`, ctgFechar); }
  delete EST_CTG_ABERTA[CTG.unidade];
  avisoAcao('ok', `✓ Folha fechada — às ${avisoHora()}.` + (res.sem_esperado
    ? ` ${res.com_esperado} ${res.com_esperado === 1 ? 'item tem' : 'itens têm'} comparação; ${res.sem_esperado} ${res.sem_esperado === 1 ? 'é' : 'são'} ponto de partida (o sistema ainda não conhecia esse saldo).` : ''));
  {
    // 23/10/2026: sem esperar — leva até 17 s a frio e a resposta pode se perder no pooler; o banco termina sozinho
    ctgFetch('rpc/est_refazer_extrato', { method: 'POST', extra: { 'Content-Type': 'application/json' }, body: '{}' })
      .catch((e) => console.warn('extrato do controle nao refeito:', e.message));
    await ctgCarregar();
  }
}

const CTG_TIPOS = [
  ['TRANSFERENCIA_NAO_LANCADA', 'Foi para a filial e ninguém baixou'],
  ['PRODUCAO_NAO_APONTADA', 'Virou preparo e não foi apontado'],
  ['ATACADO', 'Saiu para venda de atacado'],
  ['PERDA', 'Estragou, quebrou ou venceu'],
  ['ERRO_DE_CADASTRO', 'Unidade ou conversão errada no cadastro'],
  ['CONTAGEM_ERRADA', 'Contamos errado'],
  ['CONSUMO_INTERNO', 'Refeição da equipe, teste ou cortesia'],
  ['OUTRO', 'Outro'],
];

async function ctgExplicar(idItem, dif, difRs) {
  const s = rmbSessao();
  const opcoes = CTG_TIPOS.map(([k, t], i) => `${i + 1}. ${t}`).join('\n');
  const escolha = prompt(`Diferença de ${fmt(dif)} (R$ ${fmt(difRs)}).\nO que aconteceu?\n\n${opcoes}\n\nDigite o número:`);
  if (!escolha) return;
  const tipo = (CTG_TIPOS[Number(escolha) - 1] || [])[0];
  if (!tipo) { avisoAcao('atencao', '! Número inválido.'); return; }
  const obs = prompt('Alguma observação? (pode deixar em branco)') || null;
  const resp = tipo === 'PERDA' || tipo === 'CONSUMO_INTERNO'
    ? (prompt('Quem responde? (pode deixar em branco — a regra de desconto ainda não existe)') || null) : null;
  avisoAcao('enviando', 'Gravando a explicação…');
  try {
    await ctgFetch('est_quebra', {
      method: 'POST', extra: { Prefer: 'return=minimal' },
      body: JSON.stringify({ id_item: idItem, tipo, qtd: dif, valor: difRs, responsavel: resp, observacao: obs, quem: s.email }),
    });
  } catch (e) { return avisoAcao('erro', `✗ A explicação NÃO gravou: ${e.message}. Clique em explicar de novo.`); }
  avisoAcao('ok', `✓ Explicação gravada — às ${avisoHora()}.`);
  await ctgCarregar();
}

// ==================================================================
// APONTAR PRODUCAO — 08/10/2026
// ------------------------------------------------------------------
// Por que a tela existe: o motor do saldo (vw_est_movimento) tem duas pernas de producao —
// ENTRA a receita pronta e SAEM os ingredientes dela, pela NOSSA ficha (decisao do dono em
// 08/10: a venda tira a receita pronta; a producao tira o ingrediente). Sem alguem apontar,
// a receita so CAI com a venda e nunca sobe: saldo negativo de receita e o alarme de que
// faltou apontar, nao defeito da conta.
// O que o BANCO impoe (script/estoque_apontar_producao.sql), e por isso a tela nao precisa
// policiar: aponta-se no proprio nome, na propria loja, com data de ate 7 dias atras; desfazer
// so vale no que a propria pessoa lancou nas ultimas 12 horas; e apontamento gravado nao se
// edita — correcao depois disso e lancamento novo, para o historico nao sumir.
// ==================================================================
// ======================= PLANEJAR PRODUÇÃO (PLP) — 10/10/2026 =======================
// Pedido do dono (08/10/2026): "com base no saldo de estoque X volume de vendas, o modulo
// tenha condicoes de planejar o que precisamos produzir, criar uma ficha de separacao de
// insumos para o estoque separar e entregar para a producao".
// O HORIZONTE vem da decisao dele de 10/10/2026: "contagem vai ser toda quarta" — o plano
// fecha de quarta a quarta.
// A CONTA MORA NO BANCO (vw_est_plano_producao e vw_est_separacao). Esta tela nao recalcula
// nada: e por isso que o saldo daqui e o mesmo da tela de Contagem e do Estoque.
let PLP = null;   // { unidade, plano, separacao, idade, filtro, busca }

// 27/10/2026 (dono): telas de LANÇAMENTO no tema claro (.papel.lanc): cabeçalho e título de grupo escuros, produto claro
(function estTemaLancamento() {
  if (document.getElementById('estTemaLanc')) return;
  const s = document.createElement('style');
  s.id = 'estTemaLanc';
  s.textContent = `
    .papel.lanc div[id^="tabela"] th, .papel.lanc div[id^="tabela"] th:first-child { background:var(--p-ink) !important; color:var(--tx-1) !important; border-color:var(--p-ink) !important; }
    .papel.lanc div[id^="tabela"] tr.grp td { background:var(--p-ink) !important; color:var(--tx-1) !important; border-color:var(--p-ink) !important; }
    .papel.lanc div[id^="tabela"] tr.grp td span { color:var(--tx-5) !important; }
    .papel.lanc div[id^="tabela"] tr.sub td { font-weight:700; }`;
  document.head.appendChild(s);
})();

// ---- O CICLO EM QUATRO TELAS (dono, 27/10/2026): Planejar → Separação → Ordens → Apontar, cada uma com o histórico ----
// 28/10/2026 (seletor de loja único): a loja de cada tela é a do topo da casca (nucleo/loja.js). Estoque é por loja —
// lançar, apontar e o kardex não se somam —, então na Rede a tela pede a loja em vez de mostrar um total que não existe.
// Sem o loja.js (painel antigo) vale a loja do login (tr_minha_unidade), como antes.
let EST_REENTRAR = null, EST_OUVE_LOJA = false;
async function estUnidade() {
  if (typeof lojaCarregar === 'function' && await lojaCarregar()) {
    if (!EST_OUVE_LOJA) {
      EST_OUVE_LOJA = true;
      aoMudarLoja(() => { if (typeof window.reentrarTela === 'function') window.reentrarTela(); else if (EST_REENTRAR) EST_REENTRAR(); });
    }
    return lojaAtual();                                  // loja | 'REDE' | null (login sem loja cadastrada)
  }
  const ru = await trRpc('tr_minha_unidade');
  return (ru.ok ? await ru.json() : null) || 'AGUA VERDE';
}
// 29/10/2026 (dono): enquanto a contagem da loja estiver aberta, as outras telas do Estoque lembram — fechar é o que faz valer
const EST_CTG_ABERTA = {};
async function estContagemAbertaAviso(u) {
  const naContagem = () => { const m = document.getElementById('modulo-contagem'); return !!(m && m.style.display !== 'none'); };
  let b = document.getElementById('estCtgAberta');
  try {
    const c = EST_CTG_ABERTA[u];
    if (!c || Date.now() - c.em > 300000)
      EST_CTG_ABERTA[u] = { em: Date.now(), f: (await consultarTudo(`est_inventario?select=id,data,status&unidade=eq.${encodeURIComponent(u)}&status=eq.ABERTA&order=data.desc&limit=1`))[0] || null };
  } catch (e) { return; }
  const f = EST_CTG_ABERTA[u].f;
  if (!f || naContagem()) { if (b) b.remove(); return; }
  if (!b) {
    b = document.createElement('div'); b.id = 'estCtgAberta';
    b.style.cssText = 'margin:0 0 10px; padding:10px 14px; border:2px solid var(--marca-amarelo); border-radius:10px; display:flex; gap:10px; align-items:center; flex-wrap:wrap; font-weight:700;';
    const wrap = document.querySelector('.wrap') || document.body; wrap.insertBefore(b, wrap.firstChild);
  }
  b.innerHTML = `<span style="flex:1 1 240px;">📋 A contagem de ${String(f.data).split('-').reverse().join('/')} de ${trEscH(estNomeLoja(u))} está aberta — ela só vale depois de fechada.</span>
    <button class="preset-btn" onclick="mostrarModulo('contagem')">Abrir a Contagem</button>`;
}
async function estLojaDaTela(alvo, reentrar) {
  EST_REENTRAR = reentrar;
  const u = await estUnidade();
  if (u && u !== LOJA_REDE_EST) { estContagemAbertaAviso(u); return u; }
  alvo.innerHTML = u === LOJA_REDE_EST
    ? `<div class="contexto" style="text-align:left;"><b>Estoque e produção são por loja.</b> Na Rede não há um número só para lançar,
        apontar ou conferir o estoque. Escolha a loja:
        <div style="display:flex; gap:8px; flex-wrap:wrap; margin-top:10px;">${(LOJA_INFO.lojas || []).filter((l) => l !== LOJA_REDE_EST)
          .map((l) => `<button class="preset-btn active" onclick="estEscolherLoja('${trEscH(l)}')">${trEscH(lojaNome(l))}</button>`).join('')}</div></div>`
    : `<div class="contexto" style="border-color:var(--farol-fora);">Sem loja cadastrada para este login — fale com o Neto.</div>`;
  return null;
}
const LOJA_REDE_EST = 'REDE';
function estNomeLoja(u) { return typeof lojaNome === 'function' ? lojaNome(u) : u; }
// troca pedida de dentro da tela: na casca, quem troca é o seletor do topo (ele avisa todas as telas abertas)
function estEscolherLoja(u) {
  if (window.parent !== window) { try { parent.postMessage({ tipo: 'casca-loja-pedir', loja: u }, location.origin); } catch (e) {} return; }
  if (typeof lojaEscolher === 'function') lojaEscolher(u);
}
let EST_TELA = null;      // a tela do ciclo aberta agora: plprod | separacao | ordens | producao
let EST_FILA = null;      // vw_est_fila_do_dia da loja
async function estFilaCarregar(unidade) {
  try { EST_FILA = (await consultarTudo(`vw_est_fila_do_dia?select=*&unidade=eq.${encodeURIComponent(unidade)}`))[0] || null; }
  catch (e) { EST_FILA = null; }
}
// a tira do topo: onde está o trabalho de agora; cada número leva à tela que resolve
function estFilaHtml() { return estFilaHtmlSo(); }
function estFilaHtmlSo() {
  const f = EST_FILA;
  const etapas = [['processos', 'Processos'], ['plprod', 'Planejar'], ['separacao', 'Separação'], ['ordens', 'Ordens'], ['producao', 'Apontar']];
  const abas = `<div style="display:flex; gap:6px; flex-wrap:wrap; margin:2px 0 8px;">${etapas.map(([k, r], i) =>
    `<button class="preset-btn${EST_TELA === k ? ' active' : ''}" onclick="${EST_TELA === k ? '' : `mostrarModulo('${k}')`}">${i}. ${r}</button>`).join('<span style="color:var(--tx-5); align-self:center;">›</span>')}
    <a href="javascript:void(0)" onclick="mostrarModulo('prodhist')" style="align-self:center; margin-left:auto; color:var(--tx-4); font-size:12.5px;">Históricos ›</a></div>`;
  if (!f) return abas;
  const n = (v) => Number(v) || 0;
  const it = (tela, qtd, rot, cor) => `<a href="javascript:void(0)" onclick="${EST_TELA === tela ? '' : `mostrarModulo('${tela}')`}"
      style="color:${qtd ? cor : 'var(--tx-5)'}; ${qtd ? 'font-weight:700;' : ''} text-decoration:none; white-space:nowrap;">${qtd} ${rot}</a>`;
  const sit = String(f.plano_de_amanha || '').toUpperCase();
  const plano = `<a href="javascript:void(0)" onclick="${EST_TELA === 'plprod' ? '' : "mostrarModulo('plprod')"}" style="text-decoration:none; color:${sit === 'FECHADO' ? 'var(--farol-ok)' : 'var(--farol-perto)'}; font-weight:700; white-space:nowrap;">plano de ${ffDdmm(f.planejando_para)}: ${sit ? sit.toLowerCase() : 'não começou'}</a>`;
  return abas + `<div class="contexto" style="text-align:left; display:flex; flex-wrap:wrap; gap:4px 14px; font-size:13px;">
      <span style="color:var(--tx-4);">Onde está o trabalho:</span> ${plano}
      · ${it('separacao', n(f.listas_a_separar), 'a separar', 'var(--farol-perto)')}
      · ${it('separacao', n(f.listas_a_conferir), 'a conferir', 'var(--farol-perto)')}
      · ${it('separacao', n(f.listas_a_virar_ordem), 'a virar ordem', 'var(--farol-perto)')}
      · ${it('ordens', n(f.ordens_a_iniciar), 'ordem a iniciar', 'var(--farol-perto)')}
      · ${it('ordens', n(f.ordens_correndo), 'ordem correndo', 'var(--farol-ok)')}
      · ${it('ordens', n(f.receitas_sem_apontar), 'receita sem apontar', 'var(--farol-fora)')}</div>`;
}
function estQuando(ts) {
  if (!ts) return '—';
  const d = new Date(ts);
  return isNaN(d) ? '—' : d.toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }).replace(',', '');
}
// histórico: as últimas linhas, com "ver mais"
const EST_HIST = {};
async function estHistCarregar(chave, view, unidade, ordem) {
  const lim = (EST_HIST[chave] && EST_HIST[chave].lim) || 30;
  try {
    const porLoja = unidade ? `&unidade=eq.${encodeURIComponent(unidade)}` : '';
    const rows = await consultarTudo(`${view}?select=*${porLoja}&order=${ordem}&limit=${lim + 1}`);
    const ant = EST_HIST[chave] || {};
    EST_HIST[chave] = { lim, rows: rows.slice(0, lim), mais: rows.length > lim, aberto: ant.aberto, det: ant.det, dets: {} };
  } catch (e) { EST_HIST[chave] = { lim, erro: e.message, rows: [], aberto: (EST_HIST[chave] || {}).aberto }; }
}
function estHistHtml(chave, titulo, legenda, cols, linhaFn) {
  const H = EST_HIST[chave];
  if (!H) return '';
  const aberto = !!H.aberto;
  const n = (H.rows || []).length;
  let h = `<div class="contexto" style="text-align:left; padding:8px 12px;">
    <a href="javascript:void(0)" onclick="estHistToggle('${chave}')" style="text-decoration:none; color:var(--tx-1); font-weight:700;">
      ${aberto ? '▾' : '▸'} ${titulo} <span style="color:var(--tx-4); font-weight:400;">· ${n}${H.mais ? '+' : ''} ${n === 1 ? 'registro' : 'registros'}</span></a>`;
  if (!aberto) return h + `</div>`;
  h += `<div class="caption-label" style="text-align:left;">${legenda}${EST_HIST_DET[chave] ? ' Clique numa linha para ver o detalhe.' : ''}</div>`;
  if (H.erro) return h + `<div style="color:var(--amber-2);">Não consegui ler o histórico agora: ${trEscH(H.erro)}</div></div>`;
  if (!n) return h + `<div style="color:var(--tx-4);">Nada registrado ainda.</div></div>`;
  const clicavel = !!EST_HIST_DET[chave];
  h += `<div id="tabelaHist_${chave}"><table><thead><tr>${cols.map((c) => `<th>${c}</th>`).join('')}</tr></thead><tbody>
    ${H.rows.map((r) => {
      let tr = linhaFn(r);
      if (clicavel) {
        const sel = H.det === r.id;
        const at = `onclick="estHistAbrir('${chave}', ${Number(r.id)})" title="${sel ? 'clique para fechar' : 'clique para ver o detalhe'}"`;
        tr = /^<tr style="/.test(tr) ? tr.replace('<tr style="', `<tr ${at} style="cursor:pointer; ${sel ? 'background:var(--surface-2);' : ''}`)
                                     : tr.replace('<tr', `<tr ${at} style="cursor:pointer; ${sel ? 'background:var(--surface-2);' : ''}"`);
        if (sel) tr += `<tr><td colspan="${cols.length}" style="white-space:normal; padding:8px 12px 12px; background:var(--surface-2);">${(H.dets || {})[r.id] || 'Carregando…'}</td></tr>`;
      }
      return tr;
    }).join('')}</tbody></table></div>`;
  if (H.mais) h += `<div style="text-align:center; margin:8px 0;"><button class="preset-btn" onclick="estHistMais('${chave}')">ver mais antigos</button></div>`;
  return h + `</div>`;
}
// 27/10/2026 (dono): os históricos moram na tela Históricos da produção — as definições num lugar só
const EST_HIST_DEF = {
  // 27/10/2026: o "por que a grade mudou" — cada mudança feita na tela Processos da produção
  grade: ['grade', 'Mudanças nos processos', 'Cada mudança na grade de dias e processos: quem, quando, em qual receita e de → para.',
    ['Quando', 'Quem', 'Receita', 'O que mudou', 'De', 'Para'],
    (g) => `<tr><td style="white-space:nowrap;">${estQuando(g.quando)}</td><td>${trEscH(estNome(g.quem))}</td><td>${trEscH(g.nome_base || '')}</td>
      <td>${trEscH(g.o_que || '')}</td><td style="color:var(--tx-4); white-space:normal;">${trEscH(g.de || '—')}</td><td style="white-space:normal;">${trEscH(g.para || '—')}</td></tr>`],
  plano: ['plano', 'Histórico dos planos', 'Cada plano: quem planejou, quantas listas gerou e quantas ordens já encerraram.',
    ['Para', 'Situação', 'Planejou', 'Receitas', 'Listas', 'Viraram ordem', 'Ordens encerradas', 'Leitura'],
    (p) => `<tr><td><b>${ffDdmm(p.data_para)}</b></td><td>${trEscH(String(p.situacao || '').toLowerCase())}</td>
      <td>${p.quem_planejou ? trEscH(estNome(p.quem_planejou)) : '—'} <span style="color:var(--tx-5); font-size:11px;">${estQuando(p.fechado_em || p.criado_em)}</span></td>
      <td>${Number(p.receitas_decididas) || 0}${p.receitas_no_plano != null ? ' de ' + p.receitas_no_plano : ''}</td>
      <td>${Number(p.listas_geradas) || 0}</td><td>${Number(p.listas_que_viraram_ordem) || 0}</td>
      <td>${Number(p.ordens_encerradas) || 0} de ${Number(p.ordens) || 0}</td>
      <td style="font-size:12px; color:${EST_LEIT_COR(p.leitura)};">${trEscH(p.leitura || '')}</td></tr>`],
  sep: ['sep', 'Histórico das separações', 'Cada lista: quem separou, quem conferiu e em que ordem ela virou.',
    ['Lista', 'Para', 'Família', 'Separou', 'Conferiu', 'Insumos', 'Virou a ordem', 'Situação'],
    (s) => `<tr><td><b>${trEscH(s.numero)}</b></td><td>${ffDdmm(s.data_para)}</td><td>${trEscH(String(s.familia || 'individual').toLowerCase())}</td>
      <td>${s.separado_por ? `${trEscH(estNome(s.separado_por))} <span style="color:var(--tx-5); font-size:11px;">${estQuando(s.separada_em)}</span>` : '—'}</td>
      <td>${s.conferido_por ? `${trEscH(estNome(s.conferido_por))} <span style="color:var(--tx-5); font-size:11px;">${estQuando(s.conferida_em)}</span>` : '—'}</td>
      <td>${Number(s.insumos_registrados) || 0} de ${Number(s.insumos) || 0}</td>
      <td>${s.virou_a_ordem ? `<a href="javascript:void(0)" style="color:var(--brand);" onclick="mostrarModulo('ordens')">${trEscH(s.virou_a_ordem)}</a>` : '—'}</td>
      <td style="font-size:12px; color:${EST_LEIT_COR(s.leitura)};">${trEscH(s.leitura || '')}</td></tr>`],
  ordem: ['ordem', 'Histórico das ordens', 'Cada ordem: de que lista nasceu, o tempo de produção e quantas receitas foram apontadas.',
    ['Ordem', 'Para', 'Família', 'Da lista', 'Iniciou', 'Encerrou', 'Produção', 'Pausa', 'Apontadas', 'Situação'],
    (o) => `<tr><td><b>${trEscH(o.numero)}</b></td><td>${ffDdmm(o.data_para)}</td><td>${trEscH(String(o.familia || 'individual').toLowerCase())}</td>
      <td>${o.veio_da_separacao ? `<a href="javascript:void(0)" style="color:var(--brand);" onclick="mostrarModulo('separacao')">${trEscH(o.veio_da_separacao)}</a>` : '—'}</td>
      <td>${o.quem_iniciou ? trEscH(estNome(o.quem_iniciou)) : '—'} <span style="color:var(--tx-5); font-size:11px;">${estQuando(o.iniciada_em)}</span></td>
      <td>${o.quem_fechou ? trEscH(estNome(o.quem_fechou)) : '—'} <span style="color:var(--tx-5); font-size:11px;">${o.fechada_em ? estQuando(o.fechada_em) : ''}</span></td>
      <td style="font-variant-numeric:tabular-nums;">${prdHms(o.segundos_producao)}</td><td style="font-variant-numeric:tabular-nums;">${prdHms(o.segundos_pausada_total)}</td>
      <td>${Number(o.receitas_apontadas) || 0} de ${Number(o.receitas) || 0}</td>
      <td style="font-size:12px; color:${EST_LEIT_COR(o.leitura)};">${trEscH(o.leitura || '')}</td></tr>`],
  apont: ['apont', 'Histórico dos apontamentos', 'Tudo o que foi apontado, de que ordem veio (ou produção livre) e quanto saiu do planejado.',
    ['Quando', 'Receita', 'Saiu', 'Perdeu', 'Do planejado', 'Quem', 'Ordem', 'Leitura'],
    (a) => `<tr style="${a.foi_corrigido ? 'text-decoration:line-through; opacity:.55;' : ''}">
      <td style="white-space:nowrap;">${estQuando(a.criado_em)}</td><td>${trEscH(a.nome_base || '')}${a.e_correcao ? ' <span style="color:var(--info); font-size:11px;">correção</span>' : ''}</td>
      <td style="white-space:nowrap;">${fmt(Number(a.qtd))} ${trEscH(a.un || '')}</td>
      <td>${Number(a.perda) ? `${fmt(Number(a.perda))} <span style="color:var(--tx-5); font-size:11px;">${trEscH(String(a.perda_motivo || '').toLowerCase())}</span>` : '—'}</td>
      <td>${a.porcento_do_planejado == null ? '—' : Math.round(Number(a.porcento_do_planejado)) + '%'}</td>
      <td>${trEscH(estNome(a.quem))}</td><td>${a.ordem ? trEscH(a.ordem) : '<span style="color:var(--tx-5);">livre</span>'}</td>
      <td style="font-size:12px; color:${EST_LEIT_COR(a.leitura)};">${trEscH(a.leitura || '')}</td></tr>`],
};

function estRender() {
  if (EST_TELA === 'processos') return prcRender();
  if (EST_TELA === 'prodhist') return histRender();
  if (EST_TELA === 'separacao') return sepRender();
  if (EST_TELA === 'ordens' || EST_TELA === 'producao') return prdRender();
  return plpRender();
}
function estHistToggle(chave) { EST_HIST[chave].aberto = !EST_HIST[chave].aberto; estRender(); }
async function estHistAbrir(chave, id) {
  const H = EST_HIST[chave];
  if (H.det === id) { H.det = null; return estRender(); }
  H.det = id; H.dets = H.dets || {};
  estRender();
  if (!H.dets[id]) {
    try { H.dets[id] = await EST_HIST_DET[chave](id); }
    catch (e) { H.dets[id] = `<span style="color:var(--farol-fora);">Não consegui ler o detalhe: ${trEscH(e.message)}</span>`; }
    if (H.det === id) estRender();
  }
}
// o detalhe de cada histórico (só leitura)
const estMini = (cols, linhas) => `<table style="width:100%; border-collapse:collapse; font-size:12.5px;"><thead><tr>${cols.map((c) =>
  `<th style="text-align:left; padding:3px 8px; color:var(--tx-4); font-size:11px; text-transform:uppercase; border-bottom:1px solid var(--line);">${c}</th>`).join('')}</tr></thead>
  <tbody>${linhas.map((l) => `<tr>${l.map((c) => `<td style="padding:3px 8px; border-bottom:1px solid var(--line);">${c}</td>`).join('')}</tr>`).join('')}</tbody></table>`;
const EST_HIST_DET = {
  plano: async (id) => {
    const [itens, seps, ords] = await Promise.all([
      consultarTudo(`est_plano_item?select=nome_base,qtd,un,sugerido,observacao&id_plano=eq.${id}&order=nome_base`),
      consultarTudo(`vw_est_historico_separacao?select=id,numero,familia,leitura,virou_a_ordem&id_plano=eq.${id}&order=numero`).catch(() => []),
      consultarTudo(`vw_est_historico_ordem?select=id,numero,familia,leitura,receitas,receitas_apontadas&id_plano=eq.${id}&order=numero`).catch(() => []),
    ]);
    let h = `<b>Receitas decididas (${itens.length})</b>` + (itens.length ? estMini(['Receita', 'Planejado', 'Sugestão na hora'],
      itens.map((i) => [trEscH(i.nome_base), `${fmt(Number(i.qtd))} ${trEscH(i.un || '')}`, i.sugerido == null ? '—' : fmt(Number(i.sugerido))])) : '<div style="color:var(--tx-4);">nenhuma</div>');
    h += `<div style="margin-top:8px;"><b>Listas de separação (${seps.length})</b></div>` + (seps.length ? estMini(['Lista', 'Família', 'Situação', 'Virou a ordem'],
      seps.map((s) => [trEscH(s.numero), trEscH(String(s.familia || 'individual').toLowerCase()), trEscH(s.leitura || ''), trEscH(s.virou_a_ordem || '—')])) : '<div style="color:var(--tx-4);">nenhuma gerada</div>');
    h += `<div style="margin-top:8px;"><b>Ordens de produção (${ords.length})</b></div>` + (ords.length ? estMini(['Ordem', 'Família', 'Receitas apontadas', 'Situação'],
      ords.map((o) => [trEscH(o.numero), trEscH(String(o.familia || 'individual').toLowerCase()), `${Number(o.receitas_apontadas) || 0} de ${Number(o.receitas) || 0}`, trEscH(o.leitura || '')])) : '<div style="color:var(--tx-4);">nenhuma ainda</div>');
    return h;
  },
  sep: async (id) => {
    const ls = await consultarTudo(`vw_est_separacao_lista?select=nome_base,un,qtd_prevista,qtd_separada,etapa,observacao,o_que_produzir&id=eq.${id}&order=nome_base`);
    ls.sort((a, b) => (a.etapa === 'CORTE' ? 0 : 1) - (b.etapa === 'CORTE' ? 0 : 1));
    return (ls[0] && ls[0].o_que_produzir ? `<div style="color:var(--tx-3); margin-bottom:4px;">produzir: ${trEscH(ls[0].o_que_produzir)}</div>` : '')
      + estMini(['Insumo', 'Previsto', 'Separado', 'Observação'], ls.map((l) => [
        (l.etapa === 'CORTE' ? '<b style="color:var(--amber-2);">[corte]</b> ' : '') + trEscH(l.nome_base),
        Number(l.qtd_prevista) ? `${fmt(Number(l.qtd_prevista))} ${trEscH(l.un || '')}` : 'a informar', l.qtd_separada == null ? '—' : `${fmt(Number(l.qtd_separada))} ${trEscH(l.un || '')}`,
        trEscH(l.observacao || '')]));
  },
  ordem: async (id) => {
    const its = await consultarTudo(`vw_est_ordem_item?select=nome_base,qtd,un,ja_apontado,perda_apontada,leitura&id_ordem=eq.${id}&order=nome_base`);
    return estMini(['Receita', 'A ordem mandou', 'Apontado', 'Perda', 'Situação'], its.map((i) => [trEscH(i.nome_base),
      `${fmt(Number(i.qtd))} ${trEscH(i.un || '')}`, fmt(Number(i.ja_apontado || 0)), Number(i.perda_apontada) ? fmt(Number(i.perda_apontada)) : '—',
      trEscH(String(i.leitura || '').toLowerCase().replace('nao', 'não'))]));
  },
};
async function estHistMais(chave) { EST_HIST[chave].lim += 30; await estRecarregar(); }
// depois de uma ação, recarrega a tela do ciclo que está aberta
async function estRecarregar() {
  if (EST_TELA === 'processos') return prcCarregar();
  if (EST_TELA === 'prodhist') return histCarregar();
  if (EST_TELA === 'separacao') return sepCarregar();
  if (EST_TELA === 'ordens' || EST_TELA === 'producao') return prdCarregar();
  return PLP && PLP.manual ? plpManCarregar() : plpCarregar();
}
const EST_LEIT_COR = (l) => /esperando|falta|sem apontar|a separar|a conferir|aberto/i.test(l || '') ? 'var(--farol-perto)'
  : /cancel/i.test(l || '') ? 'var(--tx-5)' : 'var(--tx-3)';

// ---- SEPARAÇÃO (tela própria, 27/10/2026): as listas em aberto + o histórico ----
async function entrarSeparacao() {
  const alvo = document.getElementById('view-separacao');
  if (!alvo) return;
  EST_TELA = 'separacao';
  if (!rmbSessao()) { alvo.innerHTML = `<div class="contexto">Entre no painel para ver a separação.</div>`; return; }
  alvo.innerHTML = `<div class="contexto">Carregando…</div>`;
  try {
    const uT = await estLojaDaTela(alvo, entrarSeparacao); if (!uT) return;
    if (!PLP || PLP.unidade !== uT) PLP = { unidade: uT, filtro: null, busca: '' };
    await sepCarregar();
  } catch (e) {
    alvo.innerHTML = `<div class="contexto" style="border-color:var(--farol-fora);">Não consegui abrir a tela: ${e.message}</div>`;
  }
}
async function sepCarregar() {
  await estNomesCarregar();
  const u = encodeURIComponent(PLP.unidade);
  const [seps] = await Promise.all([
    consultarTudo(`vw_est_separacao_lista?select=*&unidade=eq.${u}&situacao=in.(ABERTA,SEPARADA,CONFERIDA)&order=data_para,numero,nome_base`).catch(() => null),
    estFilaCarregar(PLP.unidade),
  ]);
  PLP.seps = seps;
  PLP.sepSaldo = 'lendo';
  sepRender();
  sepSaldoCarregar(seps);
}
// 28/10/2026: o "no estoque" passa pelo motor do saldo (~1,3 s) — vem depois e preenche só a coluna, sem apagar o que foi digitado
async function sepSaldoCarregar(seps) {
  const ids = [...new Set((seps || []).map((l) => l.id))];
  if (!ids.length) { PLP.sepSaldo = 'ok'; return; }
  let sd = null;
  try { sd = await consultarTudo(`vw_est_separacao_saldo?select=id_item,saldo,situacao_do_saldo&id_separacao=in.(${ids.join(',')})`); } catch (e) { sd = null; }
  if (PLP.seps !== seps) return;   // a tela recarregou no meio do caminho
  PLP.sepSaldo = sd ? 'ok' : 'erro';
  const m = new Map((sd || []).map((r) => [r.id_item, r]));
  seps.forEach((l) => { const r = m.get(l.id_item); if (r) { l.saldo = r.saldo; l.situacao_do_saldo = r.situacao_do_saldo; } });
  seps.forEach((l) => { const td = document.getElementById(`sepSd_${l.id_item}`); if (td) td.outerHTML = sepSaldoTd(l); });
}
function sepSaldoTd(l) {
  if (PLP.sepSaldo === 'lendo' && l.situacao_do_saldo == null) return `<td id="sepSd_${l.id_item}" style="font-size:12px; color:var(--tx-5);">lendo…</td>`;
  if (PLP.sepSaldo === 'erro' && l.situacao_do_saldo == null) return `<td id="sepSd_${l.id_item}" style="font-size:12px; color:var(--tx-5);" title="o saldo não respondeu agora; a lista vale assim mesmo">—</td>`;
  return `<td id="sepSd_${l.id_item}" style="font-size:12px; color:${/NEGATIV|FALTA/.test(l.situacao_do_saldo || '') ? 'var(--farol-perto)' : 'var(--tx-4)'};">${l.saldo == null ? '' : fmt(Number(l.saldo))} ${trEscH(String(l.situacao_do_saldo || '').toLowerCase())}</td>`;
}
function sepRender() {
  const alvo = document.getElementById('view-separacao');
  if (!alvo) return;
  let h = `<h2>Separação</h2>` + estFilaHtml() + `<span id="plpMsg" style="font-size:12.5px;"></span>`;
  h += plpSepsHtml(null);
  alvo.innerHTML = h;
}

// ---- PROCESSOS DA PRODUÇÃO (passo zero do ciclo, 27/10/2026; dono: a Rita detalha por receita o dia, os processos e os
// pré-preparos; o Planejar lê daqui). Leitura vw_est_processo_receita; gravação só pelas funções est_processo_*.
let PRC = null;   // { linhas, aberta, filtro, praca, busca, msg }
const PRC_DIAS = [[1, 'segunda'], [2, 'terça'], [3, 'quarta'], [4, 'quinta'], [5, 'sexta'], [6, 'sábado'], [7, 'domingo']];
const PRC_RITMO = [['SEMANAL', 'dia fixo na semana'], ['DIARIA', 'todo dia'], ['QUINZENAL', 'duas vezes por mês'],
                   ['MENSAL', 'uma vez por mês'], ['SE_NECESSARIO', 'quando o saldo pedir']];
const PRC_LEIT = { 'SEM NADA DEFINIDO': ['sem nada definido', 'var(--farol-fora)'], 'TEM DUVIDA': ['tem dúvida', 'var(--amber-2)'],
                   'SEM DIA FIXO': ['sem dia fixo', 'var(--info)'], 'DIA SEM PROCESSO': ['dia sem processo', 'var(--farol-perto)'],
                   'COMPLETO': ['completo', 'var(--farol-ok)'],
                   // 28/10/2026 (dono, via Estoque): ficha automática — desce pelo rendimento da ficha, sem apontar; não é pendência
                   'AUTOMATICA': ['automática — desce pela ficha, sem apontar', 'var(--tx-4)'] };
async function entrarProcessos() {
  const alvo = document.getElementById('view-processos');
  if (!alvo) return;
  EST_TELA = 'processos';
  if (!rmbSessao()) { alvo.innerHTML = `<div class="contexto">Entre no painel para ver os processos.</div>`; return; }
  alvo.innerHTML = `<div class="contexto">Carregando…</div>`;
  try {
    const uT = await estLojaDaTela(alvo, entrarProcessos); if (!uT) return;
    if (!PLP || PLP.unidade !== uT) PLP = { unidade: uT, filtro: null, busca: '' };
    PRC = PRC || { aberta: null, filtro: null, praca: null, busca: '' };
    await prcCarregar();
  } catch (e) {
    alvo.innerHTML = `<div class="contexto" style="border-color:var(--farol-fora);">Não consegui abrir a tela: ${e.message}</div>`;
  }
}
async function prcCarregar() {
  await estNomesCarregar();
  const [linhas] = await Promise.all([
    consultarTudo('vw_est_processo_receita?select=*&order=nome_base'),
    estFilaCarregar(PLP.unidade),
  ]);
  PRC.linhas = linhas;
  prcRender();
}
const prcHora = (t) => t ? String(t).slice(0, 5) : '';
const prcPraca = (p) => p === 'PRODUÇÃO' ? 'Produção' : p === 'LANCHES' ? 'Lanches' : p === 'PRATOS' ? 'Pratos' : (p ? p.charAt(0) + p.slice(1).toLowerCase() : 'Sem praça');
function prcRender() {
  const alvo = document.getElementById('view-processos');
  if (!alvo || !PRC || !PRC.linhas) return;
  const foco = document.activeElement && document.activeElement.id === 'prcBusca';
  // 28/10/2026 (dono): a receita que sai dentro de outra não é processo próprio — não aparece (nem em nota, 14:24)
  const L = PRC.linhas.filter((r) => r.leitura !== 'DENTRO DE OUTRA RECEITA');
  let vis = L.filter((r) => (!PRC.filtro || r.leitura === PRC.filtro) && (!PRC.praca || (r.praca || 'SEM PRAÇA') === PRC.praca));
  if (PRC.busca) { const b = PRC.busca.toLowerCase(); vis = vis.filter((r) => r.nome_base.toLowerCase().includes(b)); }
  let h = `<h2>Processos da produção</h2>` + estFilaHtml()
    + `<div class="caption-label" style="text-align:left;">Por receita: em que dia se faz, o processo e a hora. O Planejar lê daqui. Clique na receita para mudar.</div>`;
  if (PRC.msg) h += `<div class="contexto" style="text-align:left; border-color:${PRC.msg.cor};">${trEscH(PRC.msg.txt)}</div>`;
  // filtros: situação e praça
  h += `<div style="display:flex; flex-wrap:wrap; gap:8px; align-items:center; margin:10px 0;">`;
  Object.keys(PRC_LEIT).forEach((k) => {
    const n = L.filter((r) => r.leitura === k).length;
    if (n) h += `<button class="preset-btn${PRC.filtro === k ? ' active' : ''}" onclick="PRC.filtro=PRC.filtro==='${k}'?null:'${k}'; prcRender();"
      style="${PRC.filtro === k ? '' : `color:${PRC_LEIT[k][1]};`}">${PRC_LEIT[k][0]} · ${n}</button>`;
  });
  ['PRODUÇÃO', 'LANCHES', 'PRATOS'].forEach((p) => {
    const n = L.filter((r) => r.praca === p).length;
    if (n) h += `<button class="preset-btn${PRC.praca === p ? ' active' : ''}" onclick="PRC.praca=PRC.praca==='${p}'?null:'${p}'; prcRender();">${prcPraca(p)} · ${n}</button>`;
  });
  h += `<input id="prcBusca" value="${trEscH(PRC.busca || '')}" oninput="PRC.busca=this.value; prcRender();" placeholder="procurar receita"
      style="flex:1; min-width:160px; background:var(--p-paper, var(--surface-2)); border:1px solid var(--p-line, var(--line)); color:var(--p-ink, var(--tx-1)); border-radius:6px; padding:7px 10px; font-size:13px;"></div>`;
  // por praça
  // as automáticas (descem pela ficha, sem apontar) num bloco à parte, no fim
  const ordem = { 'PRODUÇÃO': 1, 'LANCHES': 2, 'PRATOS': 3, 'AUTOMÁTICAS — DESCEM PELA FICHA, SEM APONTAR': 99 };
  const porPraca = new Map();
  vis.forEach((r) => { const p = r.leitura === 'AUTOMATICA' ? 'AUTOMÁTICAS — DESCEM PELA FICHA, SEM APONTAR' : (r.praca || 'SEM PRAÇA');
    if (!porPraca.has(p)) porPraca.set(p, []); porPraca.get(p).push(r); });
  // a moldura da receita aberta: linha dela + edição, nas células (a borda da linha não vence a grade padrão)
  h += `<style>#tabelaProcessos tr.prc-sel > td { border-top:2px solid var(--p-ink, var(--line-2)) !important; }
    #tabelaProcessos tr.prc-sel > td:first-child { border-left:2px solid var(--p-ink, var(--line-2)) !important; }
    #tabelaProcessos tr.prc-sel > td:last-child { border-right:2px solid var(--p-ink, var(--line-2)) !important; }</style>`;
  h += `<div id="tabelaProcessos"><table><thead><tr><th>Receita</th><th>Ritmo</th><th>Dias e processos</th><th>Pré-preparos (da ficha)</th><th>Situação</th></tr></thead><tbody>`;
  if (!vis.length) h += `<tr><td colspan="5">Nenhuma receita neste filtro.</td></tr>`;
  [...porPraca.keys()].sort((a, b) => (ordem[a] || 9) - (ordem[b] || 9)).forEach((p) => {
    const rs = porPraca.get(p);
    h += `<tr class="grp"><td colspan="5" style="font-weight:800; letter-spacing:.6px;">${trEscH(prcPraca(p).toUpperCase())}
      <span style="color:var(--tx-4); font-weight:400;">· ${rs.length}</span></td></tr>`;
    rs.forEach((r) => {
      const dias = r.dias || [];
      const ab = PRC.aberta === r.nome_base;
      const [lt, lc] = PRC_LEIT[r.leitura] || [String(r.leitura || '').toLowerCase(), 'var(--tx-4)'];
      // 27/10/2026 (dono): o contorno pega a linha da receita e a edição juntas — tudo ali é desse cadastro
      h += `<tr class="${ab ? 'sub prc-sel' : ''}" style="cursor:pointer;" onclick="prcAbrir(${trEscH(JSON.stringify(r.nome_base))})" title="${ab ? 'clique para fechar' : 'clique para mudar'}">
        <td><b>${trEscH(r.nome_base)}</b>${r.familia && r.familia !== 'NENHUMA' ? ` <span style="color:var(--tx-5); font-size:11px;">${trEscH(String(r.familia).toLowerCase())}</span>` : ''}</td>
        <td>${trEscH(r.ritmo_em_palavras || '—')}</td>
        <td style="white-space:normal; font-size:12.5px;">${dias.length ? dias.map((d) => `<span style="white-space:nowrap;">${d.dia ? `<b>${trEscH(d.dia.slice(0, 3))}</b> ` : ''}${trEscH(d.etapa || '')}${d.hora_desde || d.hora_ate ? ` <span style="color:var(--tx-4);">${prcHora(d.hora_desde)}${d.hora_ate ? '–' + prcHora(d.hora_ate) : ''}</span>` : ''}${d.duvida ? ' <span style="color:var(--amber-2);">(?)</span>' : ''}</span>`).join(' · ') : '<span style="color:var(--tx-5);">—</span>'}</td>
        <td style="white-space:normal; font-size:12px; color:var(--tx-3);">${(r.pre_preparos || []).map((x) => trEscH(x.nome_base)).join(', ') || '—'}</td>
        <td style="font-size:12px; color:${lc}; font-weight:700;">${lt}</td></tr>`;
      if (ab) h += `<tr><td colspan="5" style="white-space:normal; padding:12px 16px 16px; border:2px solid var(--p-ink, var(--line-2)); border-top:1px solid var(--p-line, var(--line));">${prcEditorHtml(r)}</td></tr>`;
    });
  });
  h += `</tbody></table></div>`;
  alvo.innerHTML = h;
  if (foco) { const i = document.getElementById('prcBusca'); if (i) { i.focus(); i.setSelectionRange(i.value.length, i.value.length); } }
}
function prcAbrir(nome) { PRC.aberta = PRC.aberta === nome ? null : nome; PRC.msg = null; prcRender(); }
function prcEditorHtml(r) {
  // 27/10/2026 (dono): tema claro "papel" e grade com linhas — campo branco, linha fina, tinta escura
  const campo = 'background:var(--p-paper, var(--surface-2)); border:1px solid var(--p-line, var(--line)); border-radius:6px; color:var(--p-ink, var(--tx-1)); padding:5px 8px;';
  const k = trEscH(JSON.stringify(r.nome_base));
  const ritmoAt = r.ritmo || 'SEMANAL';
  let h = `<div style="display:flex; flex-wrap:wrap; gap:8px; align-items:center;">
      <b>Praça</b> <select id="prcPraca" style="${campo}">${['PRODUÇÃO', 'LANCHES', 'PRATOS'].map((p) => `<option value="${p}"${r.praca === p ? ' selected' : ''}>${prcPraca(p)}</option>`).join('')}</select>
      <b style="margin-left:8px;">Ritmo</b> <select id="prcRitmo" style="${campo}">${PRC_RITMO.map(([v, t]) => `<option value="${v}"${ritmoAt === v ? ' selected' : ''}>${t}</option>`).join('')}</select>
      <button class="preset-btn est-ciclo" onclick="event.stopPropagation(); prcDefinir(${k})">Gravar praça e ritmo</button></div>`;
  const dias = r.dias || [];
  h += `<div style="margin-top:12px; padding-top:10px; border-top:1px solid var(--p-line, var(--line));"><b>Dias e processos</b></div>`;
  if (dias.length) {
    h += `<div id="tabelaPrcDias" style="margin-top:4px;"><table><thead><tr><th>Dia</th><th>Processo</th><th>Hora</th><th></th></tr></thead><tbody>${dias.map((d) => `<tr>
        <td style="width:90px;"><b>${trEscH(d.dia || 'sem dia fixo')}</b></td>
        <td>${trEscH(d.etapa || '')}</td>
        <td style="white-space:nowrap;">de <input type="time" value="${prcHora(d.hora_desde)}" style="${campo}" onchange="prcHoraGravar(${k}, ${d.dia_semana == null ? 'null' : Number(d.dia_semana)}, ${trEscH(JSON.stringify(d.etapa || ''))}, this.value, null, ${trEscH(JSON.stringify(d.frequencia || ritmoAt))}, ${trEscH(JSON.stringify(d.praca || r.praca || ''))}, ${trEscH(JSON.stringify(prcHora(d.hora_ate)))})">
          até <input type="time" value="${prcHora(d.hora_ate)}" style="${campo}" onchange="prcHoraGravar(${k}, ${d.dia_semana == null ? 'null' : Number(d.dia_semana)}, ${trEscH(JSON.stringify(d.etapa || ''))}, ${trEscH(JSON.stringify(prcHora(d.hora_desde)))}, this.value, ${trEscH(JSON.stringify(d.frequencia || ritmoAt))}, ${trEscH(JSON.stringify(d.praca || r.praca || ''))}, null)"></td>
        <td style="white-space:nowrap;"><label style="font-size:12px; color:${d.duvida ? 'var(--amber-2)' : 'var(--tx-4)'};" title="${trEscH(d.duvida_qual || '')}"><input type="checkbox"${d.duvida ? ' checked' : ''} onchange="prcDuvida(${Number(d.id)}, this.checked)"> dúvida</label>
          <button class="preset-btn est-ciclo" onclick="event.stopPropagation(); prcTirar(${Number(d.id)}, ${trEscH(JSON.stringify((d.dia || 'sem dia fixo') + ' · ' + (d.etapa || '')))})">Tirar</button></td></tr>`).join('')}</tbody></table></div>`;
  } else h += `<div style="color:var(--tx-4);">Nenhum dia definido ainda.</div>`;
  h += `<div style="display:flex; flex-wrap:wrap; gap:8px; align-items:center; margin-top:10px; padding-top:10px; border-top:1px solid var(--p-line, var(--line));">
      <b>Pôr um dia</b>
      <select id="prcNovoDia" style="${campo}">${PRC_DIAS.map(([n, t]) => `<option value="${n}">${t}</option>`).join('')}<option value="">sem dia fixo</option></select>
      <input id="prcNovaEtapa" placeholder="processo (ex.: defumar e assar)" style="flex:1 1 200px; ${campo}">
      de <input id="prcNovaDe" type="time" style="${campo}"> até <input id="prcNovaAte" type="time" style="${campo}">
      <button class="preset-btn active est-ciclo" onclick="event.stopPropagation(); prcPorDia(${k}, ${trEscH(JSON.stringify(r.praca || ''))}, ${trEscH(JSON.stringify(ritmoAt))})">Pôr</button></div>`;
  const pp = r.pre_preparos || [];
  h += `<div style="margin-top:12px; padding-top:10px; border-top:1px solid var(--p-line, var(--line));"><b>Pré-preparos</b> <span style="color:var(--tx-5); font-size:12px;">vêm da ficha; cada um tem a própria linha nesta tela</span></div>`
    + (pp.length ? `<div style="display:flex; flex-wrap:wrap; gap:6px; margin-top:4px;">${pp.map((x) => `<a href="javascript:void(0)" onclick="event.stopPropagation(); prcIrPara(${trEscH(JSON.stringify(x.nome_base))})"
        style="color:var(--brand); font-size:12.5px;">${trEscH(x.nome_base)} <span style="color:var(--tx-5);">${fmt(Number(x.qtd_ft))} ${trEscH(x.un || '')}</span></a>`).join(' · ')}</div>` : `<div style="color:var(--tx-4);">nenhum</div>`);
  return `<div onclick="event.stopPropagation()">${h}</div>`;
}
function prcIrPara(nome) { PRC.aberta = nome; PRC.filtro = null; PRC.praca = null; PRC.busca = ''; PRC.msg = null; prcRender();
  setTimeout(() => { const el = [...document.querySelectorAll('#tabelaProcessos tr')].find((t) => t.textContent.trim().startsWith(nome)); if (el) el.scrollIntoView({ block: 'center' }); }, 50); }
async function prcGravar(fn, args, ok) {
  if (!estTravar(true)) return;
  let r;
  try { r = await trRpc(fn, Object.assign(args, { p_quem: ((rmbSessao() || {}).email || '') })); }
  catch (e) { estTravar(false); PRC.msg = { txt: 'Não consegui gravar: ' + e.message, cor: 'var(--farol-fora)' }; return prcRender(); }
  estTravar(false);
  if (!r.ok) { PRC.msg = { txt: await trErroDe(r), cor: 'var(--farol-fora)' }; return prcRender(); }
  PRC.msg = { txt: ok, cor: 'var(--farol-ok)' };
  await prcCarregar();
}
function prcDefinir(nome) {
  const praca = (document.getElementById('prcPraca') || {}).value || null;
  const ritmo = (document.getElementById('prcRitmo') || {}).value || null;
  return prcGravar('est_processo_definir', { p_nome_base: nome, p_praca: praca, p_frequencia: ritmo }, `✓ ${nome}: praça e ritmo gravados.`);
}
function prcPorDia(nome, praca, ritmo) {
  const dv = (document.getElementById('prcNovoDia') || {}).value;
  const etapa = ((document.getElementById('prcNovaEtapa') || {}).value || '').trim();
  const de = (document.getElementById('prcNovaDe') || {}).value || null, ate = (document.getElementById('prcNovaAte') || {}).value || null;
  if (!etapa) { PRC.msg = { txt: 'Escreva o processo (o que se faz nesse dia).', cor: 'var(--farol-perto)' }; return prcRender(); }
  const dia = dv === '' ? null : Number(dv);
  const freq = dia == null ? (['MENSAL', 'QUINZENAL', 'SE_NECESSARIO'].includes(ritmo) ? ritmo : 'SE_NECESSARIO') : (ritmo === 'DIARIA' ? 'DIARIA' : 'SEMANAL');
  return prcGravar('est_processo_dia_por', { p_nome_base: nome, p_dia_semana: dia, p_etapa: etapa, p_hora_desde: de, p_hora_ate: ate,
    p_frequencia: freq, p_praca: praca || null }, `✓ ${nome}: ${dia == null ? 'sem dia fixo' : PRC_DIAS[dia - 1][1]} · ${etapa}.`);
}
function prcHoraGravar(nome, dia, etapa, de, ate, freq, praca, outra) {
  // mesmo dia + mesmo processo: a função atualiza a hora
  const deF = de === null ? (outra || null) : (de || null), ateF = ate === null ? (outra || null) : (ate || null);
  return prcGravar('est_processo_dia_por', { p_nome_base: nome, p_dia_semana: dia, p_etapa: etapa, p_hora_desde: deF, p_hora_ate: ateF,
    p_frequencia: freq, p_praca: praca || null }, `✓ ${nome}: hora gravada.`);
}
function prcTirar(id, rot) {
  if (!confirm(`Tirar ${rot} da grade? Fica registrado no histórico.`)) return;
  return prcGravar('est_processo_dia_tirar', { p_id: id }, `✓ ${rot} saiu da grade.`);
}
function prcDuvida(id, marcada) {
  let qual = null;
  if (marcada) { qual = prompt('Qual é a dúvida? (fica registrada)'); if (qual === null) return prcRender(); qual = qual.trim() || null; }
  return prcGravar('est_processo_duvida', { p_id: id, p_duvida: marcada, p_qual: qual }, marcada ? '✓ dúvida marcada.' : '✓ dúvida tirada.');
}

// ---- HISTÓRICOS DA PRODUÇÃO (tela própria, 27/10/2026): planos, separações, ordens e apontamentos já feitos ----
async function entrarProdHist() {
  const alvo = document.getElementById('view-prodhist');
  if (!alvo) return;
  EST_TELA = 'prodhist';
  if (!rmbSessao()) { alvo.innerHTML = `<div class="contexto">Entre no painel para ver os históricos.</div>`; return; }
  alvo.innerHTML = `<div class="contexto">Carregando…</div>`;
  try {
    const uT = await estLojaDaTela(alvo, entrarProdHist); if (!uT) return;
    if (!PLP || PLP.unidade !== uT) PLP = { unidade: uT, filtro: null, busca: '' };
    if (!EST_HIST.plano) EST_HIST.plano = { aberto: true };
    await histCarregar();
  } catch (e) {
    alvo.innerHTML = `<div class="contexto" style="border-color:var(--farol-fora);">Não consegui abrir a tela: ${e.message}</div>`;
  }
}
async function histCarregar() {
  await estNomesCarregar();
  await Promise.all([
    estHistCarregar('plano', 'vw_est_historico_plano', PLP.unidade, 'data_para.desc'),
    estHistCarregar('sep', 'vw_est_historico_separacao', PLP.unidade, 'criado_em.desc'),
    estHistCarregar('ordem', 'vw_est_historico_ordem', PLP.unidade, 'criado_em.desc'),
    estHistCarregar('apont', 'vw_est_historico_apontamento', PLP.unidade, 'criado_em.desc'),
    estHistCarregar('grade', 'est_processo_historico', null, 'quando.desc'),
  ]);
  histRender();
}
function histRender() {
  const alvo = document.getElementById('view-prodhist');
  if (!alvo) return;
  let h = `<h2>Históricos da produção</h2>
    <div class="caption-label" style="text-align:left;">Tudo o que já foi feito, do plano ao apontamento. Clique no título para abrir; clique numa linha para ver o detalhe.</div>`;
  ['plano', 'sep', 'ordem', 'apont', 'grade'].forEach((ch) => { h += estHistHtml(...EST_HIST_DEF[ch]); });
  alvo.innerHTML = h;
}

// ---- ORDENS (tela própria, 27/10/2026): as ordens com o relógio e o apontar na linha + o histórico ----
// ---------- FECHAR O TURNO (dono, 23/10/2026; proposta 2026-10-23-fechamento-do-turno.md) ----------
// O líder confirma com o próprio login, no tablet da praça. O que o banco já sabe só aparece; marcar é só o que não se deduz. Nunca trava o ponto.
let TURNO = null;
const turnoHora = (t) => new Date(t).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo', hour: '2-digit', minute: '2-digit' });
async function entrarFechaTurno() {
  const alvo = document.getElementById('view-fechaturno');
  if (!alvo) return;
  EST_TELA = 'fechaturno';
  if (!rmbSessao()) { alvo.innerHTML = `<div class="contexto">Entre no painel para fechar o turno.</div>`; return; }
  alvo.innerHTML = `<div class="contexto">Carregando…</div>`;
  try {
    const [P, rl, ro, u] = await Promise.all([consultarTudo('vw_est_turno_pendencia?select=*&order=unidade,setor,turno,ordem'), trRpc('rh_eu_lider'), trRpc('est_pode_operar_producao'), estUnidade(), estNomesCarregar()]);
    // o líder vê só o turno dele; Rita e Habrahan veem todos, para fechar por quem não fechou
    const meus = rl.ok && !(ro.ok && (await ro.json()) === true) ? await rl.json() : [];
    const chave = (x) => `${x.unidade}|${x.setor}|${x.turno}`;
    const minhas = new Set(meus.map(chave));
    const grupos = new Map();
    for (const l of P) {
      if (minhas.size ? !minhas.has(chave(l)) : (u && u !== LOJA_REDE_EST && l.unidade !== u)) continue;
      if (!grupos.has(chave(l))) grupos.set(chave(l), []);
      grupos.get(chave(l)).push(l);
    }
    // o aviso só conta da publicação da tela em diante: antes dela ninguém tinha por onde fechar
    const avisos = minhas.size ? [] : (await consultarTudo('vw_est_turno_aviso?select=data,unidade,setor,turno,nome,apelido,aviso&data=gte.2026-11-02&order=data.desc,unidade').catch(() => []))
      .filter((a) => /SEM FECHAR|ORDEM|DEPOIS DE SAIR|NAO FECHADO/.test(a.aviso || '') && (!u || u === LOJA_REDE_EST || a.unidade === u));
    TURNO = { grupos: [...grupos.values()].sort((a, b) => Number(a[0].turno_fechado) - Number(b[0].turno_fechado)), avisos };
    turnoDesenhar(alvo);
  } catch (e) {
    alvo.innerHTML = `<div class="contexto" style="border-color:var(--farol-fora);">✗ Não consegui abrir a tela: ${trEscH(e.message)} <button class="preset-btn" onclick="entrarFechaTurno()">Tentar de novo</button></div>`;
  }
}
function turnoDesenhar(alvo) {
  let h = `<h2>Fechar o turno</h2>`;
  if (!TURNO.grupos.length) h += `<div class="contexto" style="text-align:left;">Nenhum turno para fechar neste login.</div>`;
  TURNO.grupos.forEach((ls, g) => {
    const c = ls[0];
    h += `<div class="contexto" style="text-align:left; margin:10px 0;">
      <div style="font-size:17px; font-weight:800;">${trEscH(c.setor)} · ${trEscH(c.turno)} <span style="font-size:13px; font-weight:400; color:var(--tx-3);">${trEscH(estNomeLoja(c.unidade))}</span></div>
      ${ls.map((t, k) => t.como_confere === 'CONFIRMA' && !c.turno_fechado
        ? `<label style="display:flex; align-items:center; gap:10px; min-height:44px; cursor:pointer;"><input type="checkbox" id="tnoC_${g}_${k}" ${t.feita ? 'checked' : ''} style="width:22px; height:22px; flex:none;"><span>${trEscH(t.descricao)}</span></label>`
        : `<div style="display:flex; align-items:center; gap:10px; min-height:36px;"><b style="width:22px; flex:none; text-align:center; color:${t.feita ? 'var(--farol-ok)' : 'var(--farol-fora)'};">${t.feita ? '✓' : '✗'}</b><span>${trEscH(t.descricao)}</span></div>`).join('')}
      ${c.turno_fechado
        ? `<div style="margin-top:8px; font-weight:700; color:var(--farol-ok);">✓ Turno fechado às ${turnoHora(c.fechado_em)} por ${trEscH(estNome(c.fechado_por) || c.fechado_por || '')}</div>`
        : `<input id="tnoO_${g}" placeholder="Observação (opcional)" maxlength="300" style="display:block; width:100%; margin:8px 0; min-height:42px; padding:8px; font:inherit; border-radius:8px; border:1px solid var(--line); background:var(--surface-2); color:var(--tx-1);">
           <button class="preset-btn active est-ciclo" style="min-height:46px; padding:0 22px; font-size:15px;" onclick="turnoFechar(${g})">Fechar o turno</button>`}
    </div>`;
  });
  if (TURNO.avisos.length) {
    h += `<div class="section-label" style="text-align:left;">Turnos que pedem atenção</div>
      <div id="tabelaTurnoAviso" style="overflow-x:auto;"><table><thead><tr><th>Dia</th><th>Loja</th><th>Setor e turno</th><th>Líder</th><th>Aviso</th></tr></thead><tbody>
      ${TURNO.avisos.map((a) => `<tr><td>${trEscH(plpDm(a.data).slice(0, 5))}</td><td>${trEscH(estNomeLoja(a.unidade))}</td><td>${trEscH(a.setor)} · ${trEscH(a.turno)}</td><td>${trEscH(a.nome || a.apelido || '–')}</td><td style="white-space:normal; color:var(--farol-perto); font-weight:700;">${trEscH(a.aviso)}</td></tr>`).join('')}
      </tbody></table></div>`;
  }
  alvo.innerHTML = h;
}
async function turnoFechar(g) {
  const ls = TURNO.grupos[g], c = ls[0];
  const confirmou = ls.filter((t, k) => { const e = document.getElementById(`tnoC_${g}_${k}`); return e && e.checked; }).map((t) => t.codigo);
  const obs = ((document.getElementById(`tnoO_${g}`) || {}).value || '').trim();
  if (!estTravar(true)) return;
  avisoAcao('enviando', 'Fechando o turno…');
  let r;
  try { r = await trRpcSeguro('est_turno_fechar', { p_unidade: c.unidade, p_setor: c.setor, p_turno: c.turno, p_confirmou: confirmou, p_observacao: obs || null }); }
  catch (e) { estTravar(false); return avisoAcao('erro', `✗ NÃO fechou: ${e.message}.`, () => turnoFechar(g)); }
  estTravar(false);
  if (!r.ok) return avisoAcao('erro', `✗ NÃO fechou: ${await trErroDe(r)}.`, () => turnoFechar(g));
  avisoAcao('ok', `✓ Turno fechado: ${c.setor} ${c.turno} — às ${avisoHora()}.`);
  await entrarFechaTurno();
}

// ---------- TETO DE COMPRA DO MÊS (dono, 02/11/2026; proposta 2026-11-02-compras-teto-e-producao.md) ----------
let CPT = { abertas: new Set() };
async function entrarCompraTeto() {
  const alvo = document.getElementById('view-comprateto');
  if (!alvo) return;
  EST_TELA = 'comprateto';
  if (!rmbSessao()) { alvo.innerHTML = `<div class="contexto">Entre no painel para ver o teto de compra.</div>`; return; }
  alvo.innerHTML = `<div class="contexto">Carregando…</div>`;
  try {
    const [L, u] = await Promise.all([consultarTudo('compra_orcamento_foto?select=*&order=mes.desc,unidade,grupo'), estUnidade()]);
    CPT.linhas = L.filter((x) => L[0] && x.mes === L[0].mes);
    CPT.unidade = u;
    cptDesenhar();
  } catch (e) {
    alvo.innerHTML = `<div class="contexto" style="border-color:var(--farol-fora);">✗ Não consegui ler o teto de compra: ${trEscH(e.message)} <button class="preset-btn" onclick="entrarCompraTeto()">Tentar de novo</button></div>`;
  }
}
function cptAbrir(u) { if (CPT.abertas.has(u)) CPT.abertas.delete(u); else CPT.abertas.add(u); cptDesenhar(); }
function cptDesenhar() {
  const alvo = document.getElementById('view-comprateto');
  if (!alvo) return;
  let h = `<h2>Teto de compra do mês</h2>`;
  if (!CPT.linhas.length) { alvo.innerHTML = h + `<div class="contexto" style="text-align:left;">Disponível para quem compra.</div>`; return; }
  const umaLoja = CPT.unidade && CPT.unidade !== LOJA_REDE_EST;
  const r$ = (v) => `R$ ${fmt(Number(v) || 0)}`;
  const cor = { 'ACIMA DO TETO': 'var(--farol-fora)', 'ACIMA DO RITMO': 'var(--farol-perto)', DENTRO: 'var(--farol-ok)' };
  const celulas = (x) => `<td style="text-align:right;">${r$(x.pode_comprar)}</td><td style="text-align:right;">${r$(x.comprado)}</td>
    <td style="text-align:right; ${Number(x.falta_comprar) < 0 ? 'color:var(--farol-fora); font-weight:700;' : ''}">${r$(x.falta_comprar)}</td>
    <td style="text-align:right; white-space:nowrap;">${fmt(Number(x.usado_pct) || 0)}% <span style="color:var(--tx-4);">· mês ${fmt(Number(x.mes_corrido_pct) || 0)}%</span></td>
    <td style="color:${cor[x.situacao] || 'var(--tx-3)'}; font-weight:700;">${trEscH(x.situacao || '')}</td>`;
  const totais = CPT.linhas.filter((x) => x.grupo === 'TOTAL' && (umaLoja ? x.unidade === CPT.unidade : true))
    .sort((a, b) => (a.unidade === LOJA_REDE_EST ? -1 : b.unidade === LOJA_REDE_EST ? 1 : 0));
  const m = CPT.linhas[0];
  const quando = new Date(m.calculado_em).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }).replace(',', ' às');
  h += `<div class="caption-label" style="text-align:left; margin-bottom:8px;">${new Date(String(m.mes).slice(0, 10) + 'T12:00:00').toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' })} em andamento, estimativa · calculado em ${quando}</div>
    <div id="tabelaCompraTeto" style="overflow-x:auto;"><table><thead><tr><th></th><th>Loja</th><th style="text-align:right;">Pode comprar</th><th style="text-align:right;">Comprado</th><th style="text-align:right;">Falta comprar</th><th style="text-align:right;">Usado</th><th>Situação</th><th>Notas lançadas até</th></tr></thead><tbody>
    ${totais.map((t) => {
      const ab = CPT.abertas.has(t.unidade) || umaLoja;
      const gr = CPT.linhas.filter((x) => x.unidade === t.unidade && x.grupo !== 'TOTAL');
      return `<tr${gr.length ? ` style="cursor:pointer;" onclick="cptAbrir(this.dataset.u)" data-u="${trEscH(t.unidade)}"` : ''}><td style="color:var(--tx-3); font-size:12px; font-weight:600; white-space:nowrap;">${gr.length && !umaLoja ? (ab ? '▾ Fechar grupos' : '▸ Ver grupos') : ''}</td>
          <td><b>${trEscH(t.unidade === LOJA_REDE_EST ? 'Rede' : estNomeLoja(t.unidade))}</b></td>${celulas(t)}<td>${t.notas_ate ? trEscH(plpDm(t.notas_ate).slice(0, 5)) : 'nenhuma nota no mês'}</td></tr>
        ${ab ? gr.map((x) => `<tr><td></td><td style="padding-left:16px; color:var(--tx-2);">${trEscH(x.grupo)}</td>${celulas(x)}<td>${x.notas_ate ? trEscH(plpDm(x.notas_ate).slice(0, 5)) : '–'}</td></tr>`).join('') : ''}`;
    }).join('')}</tbody></table></div>`;
  alvo.innerHTML = h;
}

async function entrarOrdens() {
  EST_TELA = 'ordens';
  return entrarProducao();
}


const PLP_SIT = [
  ['SEM SALDO - FALTA APONTAR', 'Sem saldo', 'neg'],
  ['ACABA ANTES DA QUARTA', 'Acaba antes da quarta', 'neg'],
  ['DA ATE A QUARTA', 'Dá até a quarta', 'pos'],
  ['PARADO', 'Parado', 'blue'],
  ['SEM VENDA MEDIDA', 'Sem venda medida', 'neutral'],
  ['MEDIDA A CONFIRMAR', 'Medida a confirmar', 'neutral'],
];

async function entrarPlprod() {
  const alvo = document.getElementById('view-plprod');
  if (!alvo) return;
  EST_TELA = 'plprod';
  const sessao = rmbSessao();
  if (!sessao) { alvo.innerHTML = `<div class="contexto">Entre no painel para ver o plano de produção.</div>`; return; }
  alvo.innerHTML = `<div class="contexto">Carregando…</div>`;
  try {
    const uT = await estLojaDaTela(alvo, entrarPlprod); if (!uT) return;
    if (!PLP || PLP.unidade !== uT) PLP = { unidade: uT, filtro: null, busca: '' };
    // 12/11/2026 (dono, 11/11 23:42): o plano manual não passa pelo motor do saldo
    if (PLP.manual) await plpManCarregar(); else await plpCarregar();
  } catch (e) {
    // a sugestão pesa (motor do saldo); se ela cair, o plano manual continua a um clique
    alvo.innerHTML = `<div class="contexto" style="border-color:var(--farol-fora);">Não consegui abrir a tela: ${trEscH(e.message)}
      ${PLP && !PLP.manual ? `<button class="preset-btn active" onclick="plpManual(true)">Montar o plano à mão</button>` : ''}</div>`;
  }
}

async function plpCarregar() {
  await estNomesCarregar();
  const u = encodeURIComponent(PLP.unidade);
  // 26/10/2026: em etapas — as views do plano recalculam o motor do saldo cada uma, e as quatro juntas passavam do teto
  // de 8 s (o dono viu o 57014 às 15:50). Primeiro o plano, depois separação + plano do dia, por último a grade.
  const [plano, idade] = await Promise.all([
    consultarTudo(`vw_est_plano_producao?select=*&unidade=eq.${u}&order=falta_em_reais.desc.nullslast`),
    consultarTudo(`vw_est_consumo_idade?select=*`),
  ]);
  // 27/10/2026 (dono): a ficha semanal (vw_est_separacao) saiu da tela; a separação mora na tela Separação
  const separacao = [];
  const [doDia] = await Promise.all([
    // 23/10/2026: o plano de AMANHÃ (sugestão × decisão), só receitas da base — etapa 1 do ciclo de produção
    consultarTudo(`vw_est_plano_do_dia?select=nome_base,grupo_receita,un,sugerido,id_plano,data_para,situacao_plano,planejado,leitura&unidade=eq.${u}`)
      .catch(() => null),
  ]);
  // 27/10/2026 (dono): as listas moram na tela Separação; aqui só a fila do dia e o histórico dos planos
  await estFilaCarregar(PLP.unidade);
  // 26/10/2026 (dono): a grade de dias da praça — o que é do dia, o que completa e o que é de outro dia (conta do banco)
  const grade = await consultarTudo(`vw_est_plano_sugestao?select=data_do_plano,dia_da_semana,nome_base,un,sugerido,etapas_do_dia,hora_desde,hora_ate,dias_na_grade,leitura,ordem_na_tela,praca,duvida,duvida_qual,frequencia,ordem_praca,praca_da_receita,grupo_na_praca,tem_dia_na_grade,proxima_vez&unidade=eq.${u}&order=ordem_praca,grupo_na_praca,ordem_na_tela,nome_base`)
    .catch(() => null);
  PLP.grade = grade && grade.length ? new Map(grade.map((g) => [g.nome_base, g])) : null;
  PLP.gradeLista = grade || [];
  PLP.dia = doDia ? new Map(doDia.map((d) => [d.nome_base, d])) : null;
  // 23/10/2026 (etapa 2): a ordem que já nasceu deste plano, se houver
  PLP.ordem = null;
  const idPl = doDia && (doDia.find((d) => d.id_plano) || {}).id_plano;
  if (idPl) {
    try {
      const ords = await consultarTudo(`vw_est_ordem?select=id,numero,situacao&id_plano=eq.${idPl}&situacao=neq.CANCELADA&order=numero`);
      // 26/10/2026 (dono): uma ordem por família de proteína; a família de cada uma vem de vw_est_ordem_familia
      const fam = ords.length ? await consultarTudo(`vw_est_ordem_familia?select=id,familia,e_individual,receitas,precisa_cortar&id=in.(${ords.map((o) => o.id).join(',')})`).catch(() => []) : [];
      const famDe = new Map(fam.map((f) => [f.id, f]));
      PLP.ordens = ords.map((o) => ({ ...o, ...(famDe.get(o.id) || {}) }));
      PLP.ordem = PLP.ordens[0] || null;
    } catch (e) { PLP.ordem = null; PLP.ordens = []; }
  }
  PLP.dig = PLP.dig || {};
  PLP.plano = plano;
  PLP.separacao = separacao;
  PLP.idade = (idade || [])[0] || null;
  plpRender();
}

function plpFiltro(sit) {
  PLP.filtro = (PLP.filtro === sit) ? null : sit;
  plpRender();
}
function plpBusca(v) { PLP.busca = v; plpRender(); }

function plpRender() {
  const alvo = document.getElementById('view-plprod');
  if (!alvo || !PLP.plano) return;
  const foco = document.activeElement && document.activeElement.id === 'plpBusca';
  const plano = PLP.plano;
  const conta = (s) => plano.filter((p) => p.situacao === s).length;
  const soma = (s, campo) => plano.filter((p) => p.situacao === s)
                                  .reduce((a, p) => a + (Number(p[campo]) || 0), 0);
  const faltaTotal = plano.reduce((a, p) => a + (Number(p.falta_em_reais) || 0), 0);
  const nAcaba = conta('ACABA ANTES DA QUARTA') + conta('SEM SALDO - FALTA APONTAR');
  const quarta = (plano[0] && plano[0].proxima_quarta) || '';
  const dias = (plano[0] && plano[0].dias_ate_quarta) || 0;

  // o que a tela mostra agora: tudo, ou só o quadro clicado (27/10/2026, dono: o quadro é o filtro)
  const noFiltro = (p) => PLP.filtro === 'FALTA' ? ['ACABA ANTES DA QUARTA', 'SEM SALDO - FALTA APONTAR'].includes(p.situacao)
                                                 : p.situacao === PLP.filtro;
  let vis = PLP.filtro ? plano.filter(noFiltro) : plano;
  // 26/10/2026 (dono): a praça da receita — PRODUÇÃO, LANCHES, PRATOS (vw_est_plano_sugestao, conta do banco)
  const pracaDe = (p) => ((PLP.grade && PLP.grade.get(p.nome_base)) || {}).praca_da_receita || 'SEM PRAÇA';
  const grpDe = pracaDe;
  if (PLP.grupo) vis = vis.filter((p) => grpDe(p) === PLP.grupo);
  if (PLP.busca) {
    const b = PLP.busca.toLowerCase();
    vis = vis.filter((p) => (p.nome_saipos || '').toLowerCase().includes(b)
                         || (p.nome_base || '').toLowerCase().includes(b));
  }

  let h = `<div style="display:flex; flex-wrap:wrap; gap:8px; align-items:center; justify-content:space-between;"><h2>Planejar produção</h2>
      <button class="preset-btn active" onclick="plpManual(true)" title="Escolher as receitas e digitar a quantidade, sem a sugestão">✎ Plano manual</button></div>` + estFilaHtml();

  // aviso CONDICIONAL: retrato velho faz a tela mentir sem avisar
  if (PLP.idade && PLP.idade.retrato_atrasado) {
    // 12/11/2026 (auditoria 07/11, operacao-27): sem comando de programador na tela da cozinha
    h += `<div class="contexto" style="border-color:var(--farol-fora);">Consumo calculado até <b>${plpDm(PLP.idade.retrato_ate).slice(0, 5)}</b>
      (já há venda até ${plpDm(PLP.idade.venda_ate).slice(0, 5)}): o que falta pode estar baixo. Avise o Neto.</div>`;
  }
  // 12/11/2026 (auditoria 07/11): a decisão (o plano de amanhã e o botão Fechar) vem logo abaixo do título
  h += plpBlocoPlano();

  const cartao = (f) => `style="cursor:pointer; ${PLP.filtro === f ? 'outline:2px solid var(--info); outline-offset:2px;' : ''}"
      onclick="plpFiltro('${f}')" title="${PLP.filtro === f ? 'clique de novo para ver tudo' : 'clique para ver só estas na grade'}"`;
  h += `<div class="cards cards-3">
    <div class="card ${faltaTotal > 0 ? 'neg' : 'pos'}" ${cartao('FALTA')}>
      <div class="card-lbl">Falta produzir até quarta</div>
      <div class="card-val">R$ ${fmt(faltaTotal)}</div>
      <div class="card-pct">${nAcaba} ${nAcaba === 1 ? 'receita' : 'receitas'} não chega${nAcaba === 1 ? '' : 'm'} lá</div>
    </div>
    <div class="card ${conta('SEM SALDO - FALTA APONTAR') ? 'neg' : 'neutral'}" ${cartao('SEM SALDO - FALTA APONTAR')}>
      <div class="card-lbl">Sem saldo no sistema</div>
      <div class="card-val">${conta('SEM SALDO - FALTA APONTAR')}</div>
      <div class="card-pct">vende R$ ${fmt(soma('SEM SALDO - FALTA APONTAR', 'sai_por_dia_em_reais'))}/dia · falta apontar produção</div>
    </div>
    <div class="card blue" ${cartao('PARADO')}>
      <div class="card-lbl">Parado há mais de 45 dias</div>
      <div class="card-val">R$ ${fmt(soma('PARADO', 'valor_no_estoque'))}</div>
      <div class="card-pct">${conta('PARADO')} ${conta('PARADO') === 1 ? 'receita' : 'receitas'} de giro lento</div>
    </div>
  </div>`;

  h += `<div class="caption-label" style="text-align:left;">Conta até quarta ${plpDm(quarta).slice(0, 5)}${dias ? ` (${dias} ${dias === 1 ? 'dia' : 'dias'})` : ''} · "Sai por dia" = balcão + filiais, média de 28 dias · clique num quadro ou numa praça para filtrar.</div>`;

  h += `<div style="display:flex;flex-wrap:wrap;gap:8px;align-items:center;margin:14px 0 10px;">`;
  if (PLP.grade) {
    [['PRODUÇÃO', 'Produção'], ['LANCHES', 'Lanches'], ['PRATOS', 'Pratos']].forEach(([g, rot]) => {
      const n = plano.filter((p) => grpDe(p) === g).length;
      if (n) h += `<button class="preset-btn${PLP.grupo === g ? ' active' : ''}" onclick="PLP.grupo=PLP.grupo==='${g}'?null:'${g}'; plpRender();"
                     title="Ver só esta praça">${rot} · ${n}</button>`;
    });
  }
  h += `<input id="plpBusca" value="${(PLP.busca || '').replace(/"/g, '&quot;')}" oninput="plpBusca(this.value)"
          placeholder="procurar receita" style="flex:1;min-width:160px;background:var(--p-paper, var(--surface-2));
          border:1px solid var(--p-line, var(--line));color:var(--p-ink, var(--tx-1));border-radius:6px;padding:7px 10px;font-size:13px;">
    </div>`;

  // POR GRUPO, EM ORDEM ALFABÉTICA DENTRO DELE (dono, 14/10/2026). O grupo é a FAMÍLIA DA
  // PROTEÍNA quando a receita tem uma — a cadeia que ele decidiu em 08/10, "sempre que essa
  // proteína entrar na produção, no apontamento ela se divide em vários produtos e receitas" —
  // e, quando não tem, o grupo da receita (PRATOS, LANCHES, PRODUCAO). Quem decide isso é a
  // base, não a tela: a coluna grupo_da_tela vem de ft_receita_base por vw_est_item.
  // 26/10/2026 (dono): por PRAÇA (produção 1, lanches 2, pratos 3) e, na produção, pela família da proteína
  const gInfo = (p) => (PLP.grade && PLP.grade.get(p.nome_base)) || null;
  const blocos = new Map();
  vis.slice().sort((a, b) => (a.nome_base || a.nome_saipos || '').localeCompare(b.nome_base || b.nome_saipos || '', 'pt-BR'))
     .forEach((p) => {
       const g = gInfo(p);
       const praca = (g && g.praca_da_receita) || 'SEM PRAÇA';
       const ordem = (g && Number(g.ordem_praca)) || 9;
       const fam = (g && g.grupo_na_praca && g.grupo_na_praca !== praca) ? g.grupo_na_praca : (g ? '' : (p.grupo_da_tela || ''));
       if (!blocos.has(praca)) blocos.set(praca, { ordem, fams: new Map() });
       const b = blocos.get(praca);
       if (!b.fams.has(fam)) b.fams.set(fam, []);
       b.fams.get(fam).push(p);
     });
  // 26/10/2026 (dono): primeiro o que é do dia; o que é de outro dia (e aguenta até lá) vai para o fim, apagado
  if (PLP.grade) blocos.forEach((b) => b.fams.forEach((arr) => arr.sort((x, y) => plpFaixa(x.nome_base).ord - plpFaixa(y.nome_base).ord)));
  const pracasOrd = [...blocos.keys()].sort((a, b) => blocos.get(a).ordem - blocos.get(b).ordem || a.localeCompare(b, 'pt-BR'));
  const famOrd = (m) => [...m.keys()].sort((a, b) => (/^SEM FAM/.test(a) ? 1 : 0) - (/^SEM FAM/.test(b) ? 1 : 0) || a.localeCompare(b, 'pt-BR'));
  const nomePracaT = (p) => p === 'PRODUÇÃO' ? 'Produção' : p === 'LANCHES' ? 'Lanches' : p === 'PRATOS' ? 'Pratos' : p.charAt(0) + p.slice(1).toLowerCase();

  // 12/11/2026 (auditoria 07/11): a coluna da decisão logo depois da Receita, cabeçalho curto, datas sem o ano
  h += `<div id="tabelaPlanoProducao"><table><thead><tr>
      <th>Receita</th>${PLP.dia ? `<th title="o que a cozinha decidiu produzir; vazio = ainda não decidido">Amanhã (${plpDm(plpAmanha()).slice(0, 5)})</th>` : ''}<th>Tem hoje</th>
      <th title="A venda do balcão (descendo a nossa ficha) MAIS o que sai em lista para o Ahú e o São Braz. Média dos últimos 28 dias.">Sai por dia</th>
      <th>Dura até</th><th title="o que o estoque de hoje não cobre até a próxima quarta: é a sugestão">Falta (sugerido)</th>
      <th>R$ a produzir</th><th>Situação</th></tr></thead><tbody>`;
  const nCol = PLP.dia ? 8 : 7;
  if (!vis.length) {
    h += `<tr><td colspan="${nCol}">Nada nesta situação.</td></tr>`;
  }
  const somaR = (arr) => arr.reduce((s, p) => s + (Number(p.falta_em_reais) || 0), 0);
  pracasOrd.forEach((praca) => {
    const b = blocos.get(praca);
    const todos = [...b.fams.values()].flat();
    const rsP = somaR(todos);
    const bd = 'border-bottom:2px solid var(--line-2);';
    h += `<tr class="grp"><td style="font-weight:800; font-size:15px; letter-spacing:.6px; padding-top:14px; white-space:nowrap; ${bd}">${trEscH(nomePracaT(praca).toUpperCase())}
        <span style="color:var(--tx-4); font-weight:400; font-size:12.5px;">· ${todos.length} ${todos.length === 1 ? 'receita' : 'receitas'}</span></td>
      ${PLP.dia ? `<td style="${bd}"></td>` : ''}<td colspan="4" style="${bd}"></td>
      <td style="font-weight:800; padding-top:14px; ${bd}">${rsP ? 'R$ ' + fmt(rsP) : ''}</td><td style="${bd}"></td></tr>`;
   famOrd(b.fams).forEach((fam) => {
    const itens = b.fams.get(fam);
    if (fam) {
      const rs = somaR(itens);
      h += `<tr class="sub"><td style="font-weight:700; letter-spacing:.4px; padding-left:14px; white-space:nowrap;">${trEscH(fam.length <= 3 ? fam : fam.charAt(0) + fam.slice(1).toLowerCase())}
          <span style="color:var(--tx-4); font-weight:400;">· ${itens.length}</span></td>
        ${PLP.dia ? '<td></td>' : ''}<td colspan="4"></td><td style="font-weight:700;">${rs ? 'R$ ' + fmt(rs) : ''}</td><td></td></tr>`;
    }
    itens.forEach((p) => {
      const cor = p.situacao === 'DA ATE A QUARTA' ? 'var(--farol-ok)'
                : (p.situacao === 'ACABA ANTES DA QUARTA' || p.situacao === 'SEM SALDO - FALTA APONTAR')
                  ? 'var(--farol-fora)'
                : p.situacao === 'PARADO' ? 'var(--info)' : 'var(--tx-4)';
      const rot = (PLP_SIT.find((s) => s[0] === p.situacao) || [null, p.situacao])[1];
      h += `<tr${PLP.grade && plpFaixa(p.nome_base).f === 'OUTRO' ? ' style="opacity:.5;"' : ''}>
        <td>${p.nome_base || p.nome_saipos}${p.de_onde_vem_o_custo ? ` <span style="color:var(--tx-5);font-size:11px;">(${p.de_onde_vem_o_custo})</span>` : ''}${
          (gInfo(p) || {}).tem_dia_na_grade === false && !/^SEM GRADE/.test((gInfo(p) || {}).leitura || '') ? ` <span style="font-size:11px; color:var(--amber-2);" title="é desta praça, mas a grade ainda não diz o dia em que se faz">· sem dia definido</span>` : ''}</td>
        ${PLP.dia ? plpCelulaPlano(p) : ''}
        <td style="${Number(p.saldo) <= 0 ? 'color:var(--farol-fora);font-weight:700;' : ''}">${fmt(Number(p.saldo))} ${p.un || ''}${
          p.saldo_negativo ? ` <span style="display:block;color:var(--tx-5);font-size:11px;" title="O sistema está negativo porque ninguém apontou a produção. A conta do que falta parte de zero, não deste número.">falta apontar</span>` : ''}</td>
        <td>${p.por_dia_28 == null ? '—' : fmt(Number(p.por_dia_28))}${
          Number(p.por_dia_28_transf) > 0 ? `<span style="display:block;color:var(--tx-5);font-size:11px;white-space:normal;">${fmt(Number(p.por_dia_28_venda))} balcão + ${fmt(Number(p.por_dia_28_transf))} filiais</span>` : ''}</td>
        <td style="white-space:nowrap;">${p.dura_ate ? plpDm(p.dura_ate).slice(0, 5) : '—'}</td>
        <td style="font-weight:700;">${p.falta == null ? '—' : fmt(Number(p.falta)) + ' ' + (p.un || '')}</td>
        <td>${p.falta_em_reais == null ? '—' : 'R$ ' + fmt(Number(p.falta_em_reais))}</td>
        <td style="color:${cor};font-size:12px;white-space:normal;min-width:80px;">${rot}</td></tr>`;
    });
   });
  });
  // 12/11/2026 (auditoria 07/11): o total do que está na tela (segue o filtro)
  if (vis.length) h += `<tr class="liq"><td><b>Total · ${vis.length} ${vis.length === 1 ? 'receita' : 'receitas'}</b></td>${PLP.dia ? '<td></td>' : ''}<td colspan="4"></td>
      <td><b>R$ ${fmt(somaR(vis))}</b></td><td></td></tr>`;
  h += `</tbody></table></div>`;

  // 27/10/2026 (dono): o histórico dos planos

  alvo.innerHTML = h;
  if (foco) {
    const i = document.getElementById('plpBusca');
    if (i) { i.focus(); i.setSelectionRange(i.value.length, i.value.length); }
  }
}

// PLANO DE AMANHÃ (etapa 1 do ciclo de produção; dono aprovou o desenho em 22/10/2026). A sugestão é o que falta até a
// quarta; a decisão é da cozinha e mora em est_plano (só por função). Vazio = ainda não decidido, NUNCA zero; digitar 0
// tira a receita do plano. Fechado, o plano vira a base da ordem de produção (etapa 2); para mudar, reabre-se
// (rpc/est_plano_reabrir, com motivo) — o banco recusa se já houver ordem viva: aí cancela-se a ordem primeiro.
function plpAmanha() { return fxSomaDias(prdHoje(), 1); }
// dd/mm/aaaa em toda a tela (dono, 23/10/2026)
function plpDm(iso) { const s = String(iso || ''); return s.length >= 10 ? s.slice(8, 10) + '/' + s.slice(5, 7) + '/' + s.slice(0, 4) : s; }
function plpQtd(v) { const n = Number(v); return Number.isInteger(n) ? String(n) : fmt(n); }
function plpFechado() {
  const um = PLP.dia && [...PLP.dia.values()].find((d) => d.id_plano);
  return um && /FECHAD/i.test(um.situacao_plano || '') ? um : null;
}
// 26/10/2026 (dono, opção A): a grade manda no Preencher; de outro dia só entra se o estoque acaba antes do dia dela.
// A próxima data do dia dela vem pronta da view (proxima_vez), não de conta da tela.
function plpFaixa(nome) {
  const g = PLP.grade && PLP.grade.get(nome);
  const l = (g && g.leitura) || '';
  if (/^DO DIA/.test(l)) return { f: 'DIA', ord: 0 };
  // 26/10/2026 (Estoque): ritmo sem dia fixo (mensal, quinzenal, se necessário) e o estoque pedindo
  if (/^O SALDO PEDE|^COMPLETA/.test(l)) return { f: 'SALDO', ord: 2 };
  if (/^SEM GRADE/.test(l)) return { f: 'SEMDIA', ord: 2 };
  if (/^DE OUTRO DIA/.test(l)) {
    const prox = g.proxima_vez || null;
    const p = (PLP.plano || []).find((x) => x.nome_base === nome) || {};
    const acaba = p.dura_ate || null;
    if (prox && (!acaba || acaba < prox)) return { f: 'ADIANTAR', ord: 1, prox, acaba };
    return { f: 'OUTRO', ord: 4, prox };
  }
  return { f: 'NADA', ord: 3 };
}
function plpCelulaPlano(p) {
  const d = PLP.dia.get(p.nome_base);
  if (!d) return '<td style="color:var(--tx-5);">—</td>';
  const fechado = !!plpFechado();
  const k = d.nome_base;
  const v = PLP.dig[k] !== undefined ? PLP.dig[k] : (d.planejado == null ? '' : plpQtd(d.planejado));
  const mudou = PLP.dig[k] !== undefined && String(PLP.dig[k]) !== (d.planejado == null ? '' : plpQtd(d.planejado));
  const LEIT = { 'AINDA NAO DECIDIDO': ['ainda não decidido', 'var(--tx-5)'],
                 'PLANEJADO COBRE O QUE FALTA': ['cobre o que falta', 'var(--farol-ok)'],
                 'PLANEJADO MENOR QUE O QUE FALTA': ['menor que o que falta', 'var(--farol-perto)'],
                 'PLANEJADO SEM O MOTOR PEDIR': ['sem o estoque pedir', 'var(--info)'] };
  const [lt, lc] = LEIT[d.leitura] || [String(d.leitura || '').toLowerCase(), 'var(--tx-5)'];
  const g = PLP.grade && PLP.grade.get(k);
  const tagGrade = !g ? '' : /^DO DIA/.test(g.leitura) ? `<div style="font-size:11px; color:var(--farol-ok);" title="na grade de dias da praça">do dia${g.etapas_do_dia ? ' · ' + trEscH(g.etapas_do_dia) : ''}</div>`
    : /^O SALDO PEDE|^COMPLETA/.test(g.leitura) ? `<div style="font-size:11px; color:var(--info);" title="não tem dia fixo na semana (mensal, quinzenal ou quando precisar) e o estoque está pedindo">o saldo pede · sem dia fixo</div>`
    : /^DE OUTRO DIA/.test(g.leitura) ? (() => { const fx = plpFaixa(k);
        return fx.f === 'ADIANTAR'
          ? `<div style="font-size:11px; color:var(--farol-fora); font-weight:700;" title="na grade o dia dela é outro, mas o estoque não aguenta até lá">adiantar: ${fx.acaba ? 'acaba ' + plpDm(fx.acaba).slice(0, 5) : 'sem saldo — falta apontar'}, o dia dela é ${plpDm(fx.prox).slice(0, 5)}</div>`
          : `<div style="font-size:11px; color:var(--tx-5);" title="na grade o dia dela é outro e o estoque aguenta até lá">dia dela: ${trEscH(g.dias_na_grade || '')}${fx.prox ? ' (' + plpDm(fx.prox).slice(0, 5) + ')' : ''}</div>`; })()
    : /^SEM GRADE/.test(g.leitura) ? `<div style="font-size:11px; color:var(--amber-2);" title="precisa e não está na grade de nenhuma praça">sem dia na grade</div>` : '';
  const tagDuv = g && g.duvida ? `<div style="font-size:11px; color:var(--amber-2);" title="${trEscH(g.duvida_qual || '')}">(?) dúvida na grade</div>` : '';
  return `<td style="white-space:nowrap;"><input type="number" step="0.001" min="0" inputmode="decimal" value="${v}"
      ${fechado ? 'disabled' : ''} placeholder="${Number(d.sugerido) > 0 ? plpQtd(Math.ceil(Number(d.sugerido) * 100) / 100) : ''}"
      oninput="PLP.dig[${trEscH(JSON.stringify(k))}]=this.value;" onchange="plpSalvarUm(${trEscH(JSON.stringify(k))})"
      style="width:76px; background:var(--p-paper, var(--surface-2)); border:1px solid ${mudou ? 'var(--farol-perto)' : 'var(--info)'}; border-radius:8px; color:var(--p-ink, var(--tx-1)); padding:5px 8px; font-weight:700;">
      <span style="color:var(--tx-4); font-size:11px;">${d.un || ''}</span>
      <div id="${plpIdK(k)}" style="font-size:11px; color:${mudou ? 'var(--farol-perto)' : lc};">${mudou ? 'salvando…' : lt}</div>${tagGrade}${tagDuv}</td>`;
}
// 26/10/2026: o que a grade de dias da praça manda fazer no dia do plano (vw_est_plano_sugestao; foto do dono)
function plpQuadroGrade() {
  if (!PLP.gradeLista || !PLP.gradeLista.length) return '';
  const G = PLP.gradeLista, dia = (G[0] || {}).dia_da_semana || '';
  const qtd = (g) => Number(g.sugerido) > 0 ? ` <span style="color:var(--tx-4);">${plpQtd(Math.ceil(Number(g.sugerido) * 100) / 100)} ${trEscH(g.un || '')}</span>` : '';
  const hora = (g) => g.hora_ate ? ` <span style="color:var(--tx-5);">até ${String(g.hora_ate).slice(0, 5)}</span>` : g.hora_desde ? ` <span style="color:var(--tx-5);">a partir de ${String(g.hora_desde).slice(0, 5)}</span>` : '';
  // 26/10/2026: a dúvida não esconde a linha — aparece marcada, com o texto do banco
  const duv = (g) => g.duvida ? ` <span style="color:var(--amber-2); font-weight:700;" title="${trEscH(g.duvida_qual || 'linha da grade com dúvida')}">(?)</span>` : '';
  const freq = (g) => g.frequencia === 'DIARIA' ? ' <span style="color:var(--tx-5);">· todo dia</span>' : g.frequencia === 'SE_NECESSARIO' ? ' <span style="color:var(--tx-5);">· se necessário</span>' : '';
  const linha = (g) => `<div style="font-size:13px;">${trEscH(g.nome_base)}${duv(g)}${g.etapas_do_dia ? ` <span style="color:var(--tx-3);">· ${trEscH(g.etapas_do_dia)}</span>` : ''}${freq(g)}${hora(g)}${qtd(g)}</div>`;
  const doDia = G.filter((g) => /^DO DIA/.test(g.leitura));
  const ordP = (p) => { const x = G.find((g) => (g.praca_da_receita || g.praca) === p); return (x && Number(x.ordem_praca)) || 9; };
  const pracas = [...new Set(doDia.map((g) => g.praca_da_receita || g.praca || 'PRODUÇÃO'))].sort((a, b) => ordP(a) - ordP(b) || a.localeCompare(b));
  const semGrade = G.filter((g) => /^SEM GRADE/.test(g.leitura));
  const completa = G.filter((g) => /^O SALDO PEDE|^COMPLETA/.test(g.leitura));
  const outro = G.filter((g) => /^DE OUTRO DIA/.test(g.leitura));
  const comDuvida = G.filter((g) => g.duvida && /^DO DIA/.test(g.leitura));
  const col = (titulo, cor, arr, f) => `<div><div style="color:${cor}; font-weight:700; font-size:12.5px;">${titulo} (${arr.length})</div>
      ${arr.length ? arr.map(f).join('') : '<div style="color:var(--tx-5);">nada</div>'}</div>`;
  const nomePraca = (p) => p === 'PRODUÇÃO' ? 'Produção' : p === 'LANCHES' ? 'Lanches' : p === 'PRATOS' ? 'Pratos' : p.charAt(0) + p.slice(1).toLowerCase();
  return `<div class="contexto" style="text-align:left;">
      <b>O que a grade manda fazer na ${trEscH(dia)}</b> <span style="color:var(--tx-5); font-size:12px;">(a folha dos dias de cada praça; o número é o que falta até a quarta)</span>
      <div style="display:grid; grid-template-columns:repeat(auto-fit, minmax(240px, 1fr)); gap:10px 18px; margin-top:8px;">
        ${pracas.map((p) => col('Do dia · ' + nomePraca(p), 'var(--farol-ok)', doDia.filter((g) => (g.praca_da_receita || g.praca || 'PRODUÇÃO') === p), linha)).join('')}
        ${col('Precisa, mas é de outro dia', 'var(--farol-perto)', outro, (g) => `<div style="font-size:13px;">${trEscH(g.nome_base)}${duv(g)} <span style="color:var(--tx-5);">· ${trEscH(g.dias_na_grade || '')}</span>${qtd(g)}</div>`)}
        ${completa.length ? col('O saldo pede (sem dia fixo)', 'var(--info)', completa, (g) => `<div style="font-size:13px;">${trEscH(g.nome_base)}${qtd(g)}</div>`) : ''}
      </div>
      ${semGrade.length ? `<div style="margin-top:10px; padding:8px 10px; border:1px solid var(--amber-2); border-radius:8px;">
        <div style="color:var(--amber-2); font-weight:700; font-size:12.5px;">Precisa e a grade ainda não diz o dia (${semGrade.length})</div>
        <div style="display:flex; flex-wrap:wrap; gap:2px 16px;">${semGrade.map((g) => `<span style="font-size:13px;">${trEscH(g.nome_base)} <span style="color:var(--tx-5);">· ${trEscH(nomePraca(g.praca_da_receita || 'sem praça'))}</span>${qtd(g)}</span>`).join('')}</div>
        <div class="caption-label" style="text-align:left; margin-top:4px;">A praça já é conhecida; falta o dia na grade dela.</div></div>` : ''}
      ${comDuvida.length ? `<div class="caption-label" style="text-align:left; margin-top:6px;"><span style="color:var(--amber-2); font-weight:700;">(?)</span> linha da grade com dúvida — passe o mouse para ver qual: ${comDuvida.map((g) => trEscH(g.nome_base)).join(', ')}.</div>` : ''}
    </div>`;
}
function plpMudancas() {
  return Object.entries(PLP.dig || {}).filter(([k, v]) => {
    const d = PLP.dia && PLP.dia.get(k);
    return d && String(v).trim() !== '' && String(v) !== (d.planejado == null ? '' : plpQtd(d.planejado));
  });
}
function plpPintarSalvar() {
  const b = document.getElementById('plpSalvarBtn');
  const n = plpMudancas().length;
  if (b) { b.disabled = !n; b.textContent = n ? `Salvar o plano (${n} ${n === 1 ? 'mudança' : 'mudanças'})` : 'Salvar o plano'; }
}
function plpBlocoPlano() {
  if (!PLP.dia) return `<div class="contexto" style="border-color:var(--amber-2);">Não consegui ler o plano de amanhã agora; a sugestão abaixo continua valendo.
      <button class="preset-btn" onclick="plpManual(true)">✎ Montar o plano à mão</button></div>`;
  const linhas = [...PLP.dia.values()];
  const dec = linhas.filter((d) => d.planejado != null);
  const fech = plpFechado();
  const amanha = plpAmanha();
  let h = `<div class="section-label">Plano de amanhã — ${plpDm(amanha)}</div>`;
  if (fech) {
    h += `<div class="contexto" style="border-color:var(--farol-ok);"><b>Plano de ${plpDm(fech.data_para || amanha)} fechado</b> com
      ${dec.length} ${dec.length === 1 ? 'receita' : 'receitas'}. Agora: separar e conferir cada lista; a ordem de produção nasce da lista conferida.
      <button class="preset-btn" onclick="plpReabrir(${fech.id_plano})" title="Volta o plano para edição. Se já existe lista separada ou ordem dele, desfaça antes.">Reabrir o plano</button>
      <span id="plpMsg" style="font-size:12.5px;"></span></div>`;
    const f = EST_FILA || {};
    const nL = (Number(f.listas_a_separar) || 0) + (Number(f.listas_a_conferir) || 0) + (Number(f.listas_a_virar_ordem) || 0);
    h += `<div class="contexto" style="text-align:left;">${nL ? `<b>${nL} ${nL === 1 ? 'lista' : 'listas'}</b> deste plano esperando na Separação.` : 'As listas deste plano já andaram — veja na Separação e nas Ordens.'}
      <button class="preset-btn active" onclick="mostrarModulo('separacao')">Abrir a Separação ›</button></div>`;
    return h;
  }
  // 12/11/2026 (auditoria 07/11): o quadro da grade repete as etiquetas da coluna Amanhã — fica recolhido, a um clique
  const qg = plpQuadroGrade();
  if (qg) h += `<details style="margin:4px 0 8px;"><summary style="cursor:pointer; font-size:13px; color:var(--tx-3);">Ver o que a grade de dias manda fazer amanhã</summary>${qg}</details>`;
  h += `<div class="caption-label" style="text-align:left;"><b>${dec.length} de ${linhas.length}</b> decididas · digite na coluna Amanhã (grava sozinho; cinza = sugestão; 0 tira do plano).</div>
    <div style="display:flex; flex-wrap:wrap; gap:8px; margin:6px 0 12px;">
      <button class="preset-btn" onclick="plpUsarSugerido()" title="Põe e grava a sugestão no que é do dia, no que não tem dia na grade e no que é de outro dia mas acaba antes dele">Preencher os vazios com o sugerido</button>
      <button class="preset-btn active est-ciclo" onclick="plpFecharEGerar()" ${dec.length || plpMudancas().length ? '' : 'disabled title="Decida ao menos uma receita antes"'}>Fechar o plano e gerar as listas de separação</button>
      <span id="plpMsg" style="align-self:center; font-size:12.5px;"></span>
    </div>`;
  return h;
}
// 26/10/2026: menos cliques — a quantidade grava ao sair do campo; um botão fecha o plano e gera as listas
function plpIdK(k) { return 'plpSt_' + btoa(unescape(encodeURIComponent(k))).replace(/[^A-Za-z0-9]/g, ''); }
// 26/10/2026: UMA receita por chamada — a função lê a view do plano por receita (~2,4 s cada) e várias juntas passavam
// do teto de 8 s (o dono viu o "statement timeout" no Preencher e no Fechar). Em sequência, com o andamento na tela.
async function plpGravarItens(itens) {
  const msg = document.getElementById('plpMsg');
  let idp = null;
  for (let n = 0; n < itens.length; n++) {
    const i = itens[n];
    if (itens.length > 1) avisoAcao('enviando', `Gravando ${n + 1} de ${itens.length}…`);
    const r = await trRpcSeguro('est_plano_salvar', { p_unidade: PLP.unidade, p_data_para: plpAmanha(), p_itens: [i],
                                                p_quem: ((rmbSessao() || {}).email || '') });
    if (!r.ok) throw new Error(`${i.nome_base}: ${await trErroDe(r)}` + (n ? ` (as ${n} anteriores ficaram gravadas)` : ''));
    idp = await r.json();
    const d = PLP.dia.get(i.nome_base); if (d) { d.planejado = i.qtd; } delete PLP.dig[i.nome_base];
    [...PLP.dia.values()].forEach((x) => { if (idp) x.id_plano = idp; });
  }
  return idp;
}
async function plpSalvarUm(k) {
  const v = String(PLP.dig[k] == null ? '' : PLP.dig[k]).trim();
  const d = PLP.dia && PLP.dia.get(k);
  const st = document.getElementById(plpIdK(k));
  if (!d || v === '' || v === (d.planejado == null ? '' : plpQtd(d.planejado))) return;
  const qtd = Number(v.replace(',', '.'));
  if (!isFinite(qtd) || qtd < 0) { if (st) { st.style.color = 'var(--farol-fora)'; st.textContent = 'não é número'; } return; }
  if (st) { st.style.color = 'var(--tx-4)'; st.textContent = 'salvando…'; }
  try {
    await plpGravarItens([{ nome_base: k, qtd, un: d.un }]);
    if (st) { st.style.color = 'var(--farol-ok)'; st.textContent = '✓ salvo'; }
  } catch (e) { if (st) { st.style.color = 'var(--farol-fora)'; st.textContent = 'não salvou: ' + e.message; } }
}
async function plpFecharEGerar() {
  if (EST_OCUPADO) return;
  const msg = document.getElementById('plpMsg');
  const diz = (t, cor) => avisoAcao(cor ? 'erro' : 'enviando', cor ? `✗ ${t}. Tente de novo.` : t);
  try {
    const pend = plpMudancas().map(([k, v]) => ({ nome_base: k, qtd: Number(String(v).replace(',', '.')), un: PLP.dia.get(k).un }));
    if (pend.some((i) => !isFinite(i.qtd) || i.qtd < 0)) { avisoAcao('atencao', '! Há quantidade que não é número. Corrija antes.'); return; }
    if (pend.length) { diz('Salvando…'); await plpGravarItens(pend); }
    const um = [...PLP.dia.values()].find((d) => d.id_plano);
    if (!um) { avisoAcao('atencao', '! Decida ao menos uma receita antes de fechar.'); return; }
    const dec = [...PLP.dia.values()].filter((d) => Number(d.planejado) > 0);
    await plpFecharGerar(um.id_plano, plpAmanha(), dec.length);
  } catch (e) { estTravar(false); diz(e.message, 'var(--farol-fora)'); }
}
// 12/11/2026: o mesmo fechar + gerar as listas serve à sugestão (amanhã) e ao plano manual (a data escolhida)
async function plpFecharGerar(idPlano, data, nRec) {
  const diz = (t, cor) => avisoAcao(cor ? 'erro' : 'enviando', cor ? `✗ ${t}. Tente de novo.` : t);
  if (!confirm(`Fechar o plano de ${plpDm(data)} com ${nRec} ${nRec === 1 ? 'receita' : 'receitas'} e gerar as listas de separação (uma por família)?\n\nPara mudar depois, é preciso reabrir o plano.`)) return;
  try {
    diz('Fechando…');
    estTravar(true);
    let r = await trRpc('est_plano_fechar', { p_id: idPlano });
    if (!r.ok) throw new Error(await trErroDe(r));
    diz('Gerando as listas…');
    r = await trRpc('est_separacao_gerar', { p_id_plano: idPlano, p_quem: ((rmbSessao() || {}).email || '') });
    if (!r.ok) throw new Error(await trErroDe(r));
    estTravar(false);
    avisoAcao('ok', `✓ Plano de ${plpDm(data)} fechado e listas de separação geradas — às ${avisoHora()}.`);
    // 27/10/2026: próximo passo é separar — abre a Separação
    mostrarModulo('separacao');
    await (PLP.manual ? plpManCarregar() : plpCarregar());
  } catch (e) { estTravar(false); diz(e.message, 'var(--farol-fora)'); }
}
// as listas de separação do plano fechado (vw_est_separacao_lista + o saldo depois, vw_est_separacao_saldo): separar → conferir → gerar a ordem
function plpSepsHtml(fech) {
  if (PLP.seps === null) return `<div class="contexto" style="border-color:var(--amber-2);">Não consegui ler as listas de separação agora.</div>`;
  const porSep = new Map();
  (PLP.seps || []).forEach((l) => { if (!porSep.has(l.id)) porSep.set(l.id, []); porSep.get(l.id).push(l); });
  if (!porSep.size) return fech ? `<div class="contexto">Plano fechado, mas nenhuma lista de separação gerada.
      <button class="preset-btn active est-ciclo" onclick="plpGerarSeps(${fech.id_plano})">Gerar as listas de separação</button></div>`
    : `<div class="section-label">Listas em aberto</div><div class="contexto">Nenhuma lista esperando separação, conferência ou ordem. As listas nascem quando o plano é fechado, em Planejar.</div>`;
  const SIT = { ABERTA: ['a separar', 'var(--tx-3)'], SEPARADA: ['separada — falta conferir', 'var(--farol-perto)'],
                CONFERIDA: ['conferida — pode gerar a ordem', 'var(--farol-ok)'], VINCULADA: ['virou ordem de produção', 'var(--info)'] };
  const campo = 'background:var(--p-paper, var(--surface-2)); border:1px solid var(--p-line, var(--line)); border-radius:8px; color:var(--p-ink, var(--tx-1)); padding:4px 6px;';
  let h = `<div class="section-label">Listas em aberto</div>
    <div class="caption-label" style="text-align:left;">Uma lista por família de proteína (receita sem família, lista própria). Quem separa marca o que saiu de verdade;
      quem separou ou outra pessoa confere; da lista conferida nasce a ordem de produção.</div>`;
  [...porSep.entries()].forEach(([id, ls]) => {
    const c = ls[0];
    const [st, cor] = SIT[c.situacao] || [String(c.situacao || '').toLowerCase(), 'var(--tx-4)'];
    const aberta = c.situacao === 'ABERTA';
    const rows = ls.slice().sort((a, b) => (a.etapa === 'CORTE' ? 0 : 1) - (b.etapa === 'CORTE' ? 0 : 1) || String(a.nome_base).localeCompare(String(b.nome_base), 'pt-BR'));
    h += `<div class="contexto" style="text-align:left; margin:8px 0;">
      <div style="display:flex; flex-wrap:wrap; gap:10px; align-items:center; justify-content:space-between;">
        <div><b style="font-size:16px;">${trEscH(c.numero)}</b>
          <span style="font-size:12px; border:1px solid var(--line-2); border-radius:10px; padding:1px 8px; color:var(--tx-2);">${c.e_individual ? 'individual' : 'família ' + trEscH(String(c.familia || '').toLowerCase())}</span>
          <span style="font-size:12px; color:var(--tx-4);">para ${plpDm(c.data_para).slice(0, 5)}</span>
          <span style="font-size:12px; color:${cor}; font-weight:700;">${st}</span>
          <div style="font-size:12px; color:var(--tx-3);">produzir: ${trEscH(c.o_que_produzir || '')}</div>
          <div style="font-size:12px; color:var(--tx-4);">${c.separado_por ? `separou ${trEscH(estNome(c.separado_por))}` : ''}${c.conferido_por ? ` · conferiu ${trEscH(estNome(c.conferido_por))}` : ''}</div></div>
        <div style="display:flex; gap:6px; flex-wrap:wrap;">
          <button class="preset-btn" onclick="plpSepImprimir(${id})">🖨️ Imprimir a folha</button>
          ${aberta ? `<button class="preset-btn active est-ciclo" onclick="plpSepSeparar(${id})">Marcar como separada</button>` : ''}
          ${c.situacao === 'SEPARADA' ? `<button class="preset-btn active est-ciclo" onclick="plpSepConferir(${id})">Conferir</button>` : ''}
          ${c.situacao === 'CONFERIDA' ? `<button class="preset-btn active est-ciclo" onclick="plpSepOrdem(${id})">Gerar a ordem de produção</button>` : ''}
          ${c.situacao === 'VINCULADA' ? `<a href="javascript:void(0)" style="color:var(--brand); align-self:center;" onclick="mostrarModulo('ordens')">${c.numero_ordem ? trEscH(c.numero_ordem) + ' — ' : ''}abrir em Ordens ›</a>` : ''}
        </div></div>
      <div id="tabelaSep${id}" style="overflow-x:auto; margin-top:6px;"><table><thead><tr><th>Insumo</th><th>Previsto</th><th>Separado de verdade</th><th>Diferença</th><th>Observação</th><th>No estoque</th></tr></thead><tbody>
        ${rows.map((l, k) => `<tr><td>${l.etapa === 'CORTE' ? '<b style="color:var(--amber-2);">[corte]</b> ' : ''}${trEscH(l.nome_base)}
              <div style="font-size:11px; color:var(--tx-5);">${trEscH(l.vem_de || '')}</div></td>
            <td style="white-space:nowrap;">${Number(l.qtd_prevista) ? `${fmt(Number(l.qtd_prevista))} ${trEscH(l.un || '')}` : '<span style="color:var(--tx-4);">a informar</span>'}</td>
            <td style="white-space:nowrap;">${aberta ? `<input type="number" step="0.001" min="0" inputmode="decimal" id="plpSq_${id}_${k}" value="${l.qtd_separada != null ? Number(l.qtd_separada) : Number(l.qtd_prevista) || ''}" style="width:84px; ${campo}">` : (l.qtd_separada == null ? '—' : fmt(Number(l.qtd_separada)))} ${trEscH(l.un || '')}</td>
            ${''/* 02/11/2026: previsto 0 é o que a Rita informa (burger: acém, desossa, gordura), não é separação a mais */}
            <td style="color:${Number(l.diferenca) && Number(l.qtd_prevista) ? 'var(--farol-perto)' : 'var(--tx-5)'};">${l.diferenca == null || !Number(l.diferenca) || !Number(l.qtd_prevista) ? '—' : fmt(Number(l.diferenca))}</td>
            <td>${aberta ? `<input id="plpSo_${id}_${k}" value="${trEscH(l.observacao || '')}" placeholder="opcional" style="width:150px; ${campo}">` : trEscH(l.observacao || '')}</td>
            ${sepSaldoTd(l)}</tr>`).join('')}
      </tbody></table></div></div>`;
  });
  return h;
}
function plpSepLinhas(id) {
  return (PLP.seps || []).filter((l) => l.id === id).sort((a, b) => (a.etapa === 'CORTE' ? 0 : 1) - (b.etapa === 'CORTE' ? 0 : 1) || String(a.nome_base).localeCompare(String(b.nome_base), 'pt-BR'));
}
// 27/10/2026: um clique só — os botões do ciclo (plano, separação, ordem) se desligam até a resposta do banco
let EST_OCUPADO = false;
function estTravar(on) {
  if (on && EST_OCUPADO) return false;
  EST_OCUPADO = on;
  document.querySelectorAll('button.est-ciclo').forEach((b) => { b.disabled = on; b.style.opacity = on ? '.5' : ''; });
  return true;
}
async function plpSepAcao(fn, args, ok) {
  if (!estTravar(true)) return;
  avisoAcao('enviando', 'Gravando…');
  let r;
  try { r = await trRpcSeguro(fn, args); } finally { estTravar(false); }
  if (!r.ok) return avisoAcao('erro', `✗ NÃO gravou: ${await trErroDe(r)}. Tente de novo.`);
  avisoAcao('ok', `${ok || '✓ Gravado'} — às ${avisoHora()}.`);
  await estRecarregar();
}
async function plpGerarSeps(idPlano) { await plpSepAcao('est_separacao_gerar', { p_id_plano: idPlano, p_quem: ((rmbSessao() || {}).email || '') }, '✓ listas geradas'); }
async function plpSepSeparar(id) {
  const ls = plpSepLinhas(id);
  const itens = ls.map((l, k) => {
    const q = (document.getElementById(`plpSq_${id}_${k}`) || {}).value;
    const o = ((document.getElementById(`plpSo_${id}_${k}`) || {}).value || '').trim();
    return { nome_base: l.nome_base, qtd_separada: q === '' || q == null ? null : Number(String(q).replace(',', '.')), observacao: o || null };
  });
  if (itens.some((i) => i.qtd_separada == null || !isFinite(i.qtd_separada) || i.qtd_separada < 0)) { avisoAcao('atencao', '! Preencha o separado de verdade em todas as linhas (0 se não saiu nada).'); return; }
  if (!confirm(`Marcar a ${ls[0].numero} como separada?`)) return;
  await plpSepAcao('est_separacao_separar', { p_id: id, p_itens: itens, p_quem: ((rmbSessao() || {}).email || '') }, `✓ ${ls[0].numero} separada`);
}
async function plpSepConferir(id) {
  const c = plpSepLinhas(id)[0] || {};
  // 27/10/2026 (dono): mostrar os dois nomes — o texto da regra parecia recusa
  const eu = ((rmbSessao() || {}).email || '').toLowerCase();
  const nome = (e) => estNome(e) || '?';
  // 11/11/2026 23:42 (dono, teste de 12/11): "O próprio Habrahan pode finalizar a separação" — quem separou também confere
  if (!confirm(`Conferir a ${c.numero}?

Você está conferindo como ${nome(eu)}. Quem separou foi ${nome(c.separado_por)}.`)) return;
  await plpSepAcao('est_separacao_conferir', { p_id: id, p_quem: ((rmbSessao() || {}).email || '') }, `✓ ${c.numero} conferida`);
}
async function plpSepOrdem(id) {
  const c = plpSepLinhas(id)[0] || {};
  await plpSepAcao('est_ordem_gerar', { p_id_separacao: id, p_quem: ((rmbSessao() || {}).email || '') }, `✓ ordem gerada da ${c.numero} — abra em Apontar produção`);
}
function plpSepImprimir(id) {
  const ls = plpSepLinhas(id), c = ls[0] || {};
  const w = window.open('', '_blank');
  if (!w) { alert('O navegador bloqueou a janela de impressão — libere pop-ups para este site.'); return; }
  w.document.write(`<!DOCTYPE html><html><head><meta charset="utf-8"><title>${c.numero} — separação</title><style>
    body { font-family:Arial, sans-serif; color:#000; margin:18px 24px; }
    .cab { display:flex; justify-content:space-between; border-bottom:2px solid #000; padding-bottom:6px; }
    h1 { font-size:18px; margin:0; } .cod { font-size:26px; font-weight:bold; } .sub { font-size:11.5px; color:#45443f; margin:3px 0 0; }
    .assina { font-size:12px; margin:10px 0 0; } .assina span { display:inline-block; border-bottom:1px solid #000; width:190px; margin:0 18px 0 4px; }
    table { width:100%; border-collapse:collapse; margin-top:10px; } td, th { border-bottom:1px solid #bbb; padding:5px 6px; font-size:12.5px; text-align:left; }
    th { font-size:10px; text-transform:uppercase; color:#45443f; } .q { text-align:right; font-weight:bold; } .box { width:96px; border:1px solid #000 !important; height:26px; }
    @media print { body { margin:10px 14px; } }
  </style></head><body>
    <div class="cab"><div><h1>Separação — ${PLP.unidade}${c.familia ? ' · família ' + c.familia : c.e_individual ? ' · individual' : ''}</h1>
      <p class="sub">Produção de ${plpDm(c.data_para)} · ${ls.length} ${ls.length === 1 ? 'insumo' : 'insumos'} · impressa em ${new Date().toLocaleString('pt-BR')}</p>
      <p class="sub"><b>Produzir:</b> ${c.o_que_produzir || ''}</p>
      <p class="assina">Separou:<span></span>Conferiu:<span></span></p></div><div class="cod">${c.numero}</div></div>
    <table><thead><tr><th>#</th><th>Insumo</th><th class="q">Previsto</th><th>Separado de verdade</th></tr></thead><tbody>
    ${ls.map((l, k) => `<tr><td>${k + 1}</td><td>${l.etapa === 'CORTE' ? '<b>[corte]</b> ' : ''}${l.nome_base}</td><td class="q">${Number(l.qtd_prevista) ? `${fmt(Number(l.qtd_prevista))} ${l.un || ''}` : 'a informar'}</td><td class="box"></td></tr>`).join('')}
    </tbody></table></body></html>`);
  w.document.close();
  setTimeout(() => w.print(), 300);
}
function plpUsarSugerido() {
  [...PLP.dia.values()].forEach((d) => {
    // 26/10/2026 (dono, opção A): de outro dia fica vazio, salvo se acaba antes do dia dela
    if (PLP.grade && plpFaixa(d.nome_base).f === 'OUTRO') return;
    if (d.planejado == null && PLP.dig[d.nome_base] === undefined && Number(d.sugerido) > 0)
      PLP.dig[d.nome_base] = plpQtd(Math.ceil(Number(d.sugerido) * 100) / 100);
  });
  // 26/10/2026: grava junto (sem botão Salvar)
  const pend = plpMudancas().map(([k, v]) => ({ nome_base: k, qtd: Number(String(v).replace(',', '.')), un: PLP.dia.get(k).un }));
  if (!pend.length) { plpRender(); return; }
  plpGravarItens(pend).then(() => { avisoAcao('ok', `✓ Sugerido aplicado: ${pend.length} ${pend.length === 1 ? 'receita salva' : 'receitas salvas'} — às ${avisoHora()}.`); plpRender(); })
    .catch((e) => { plpRender(); avisoAcao('erro', `✗ NÃO salvou: ${e.message}. Tente de novo.`); });
}
async function plpSalvar() {
  const itens = plpMudancas().map(([k, v]) => ({ nome_base: k, qtd: Number(String(v).replace(',', '.')), un: PLP.dia.get(k).un }));
  if (!itens.length) return;
  if (itens.some((i) => !isFinite(i.qtd) || i.qtd < 0)) { avisoAcao('atencao', '! Há quantidade que não é número. Corrija antes de salvar.'); return; }
  const msg = document.getElementById('plpMsg');
  avisoAcao('enviando', 'Salvando o plano…');
  const r = await trRpcSeguro('est_plano_salvar', { p_unidade: PLP.unidade, p_data_para: plpAmanha(), p_itens: itens,
                                              p_quem: ((rmbSessao() || {}).email || '') });
  if (!r.ok) return avisoAcao('erro', `✗ O plano NÃO foi salvo: ${await trErroDe(r)}. O que você digitou continua na tela — tente de novo.`, plpSalvar);
  avisoAcao('ok', `✓ ${itens.length} ${itens.length === 1 ? 'receita salva' : 'receitas salvas'} no plano de ${plpDm(plpAmanha())} — às ${avisoHora()}.`);
  PLP.dig = {};
  await plpCarregar();
}
async function plpFechar() {
  const um = [...PLP.dia.values()].find((d) => d.id_plano);
  if (!um) return;
  if (plpMudancas().length) { avisoAcao('atencao', '! Há mudança não salva. Salve o plano antes de fechar.'); return; }
  if (!confirm(`Fechar o plano de ${plpDm(plpAmanha())}?\n\nFechado, ele vira a base da ordem de produção. Para mudar depois, é preciso reabrir (e, se já houver ordem, cancelá-la antes).`)) return;
  avisoAcao('enviando', 'Fechando o plano…');
  const r = await trRpcSeguro('est_plano_fechar', { p_id: um.id_plano });
  if (!r.ok) return avisoAcao('erro', `✗ O plano NÃO fechou: ${await trErroDe(r)}. Tente de novo.`);
  avisoAcao('ok', `✓ Plano de ${plpDm(plpAmanha())} fechado — às ${avisoHora()}.`);
  await plpCarregar();
}

async function plpGerarOrdem(id) {
  avisoAcao('enviando', 'Gerando a ordem…');
  const r = await trRpcSeguro('est_ordem_gerar', { p_id_plano: id, p_quem: ((rmbSessao() || {}).email || '') });
  if (!r.ok) return avisoAcao('erro', `✗ A ordem NÃO foi gerada: ${await trErroDe(r)}. Tente de novo.`);
  avisoAcao('ok', `✓ Ordem gerada — abra em Apontar produção. Às ${avisoHora()}.`);
  await plpCarregar();
}
async function plpReabrir(id) {
  const motivo = (prompt('Por que reabrir o plano? (fica registrado)') || '').trim();
  if (!motivo) return;
  avisoAcao('enviando', 'Reabrindo o plano…');
  const r = await trRpcSeguro('est_plano_reabrir', { p_id: id, p_motivo: motivo });
  if (!r.ok) return avisoAcao('erro', `✗ O plano NÃO reabriu: ${await trErroDe(r)}. Tente de novo.`);
  avisoAcao('ok', `✓ Plano reaberto — já dá para mudar. Às ${avisoHora()}.`);
  await (PLP && PLP.manual ? plpManCarregar() : plpCarregar());
}

// PLANO MANUAL (dono, qua 11/11/2026 23:42, para o teste de qui 12/11; livro chat-frente-estoque/respostas/teste-producao-12-11-decisoes).
// A sugestão ainda não serve (o saldo de partida não bate): a cozinha escolhe as receitas e digita a quantidade.
// Catálogo = vw_est_plano_receitas (leve, sem o motor do saldo); o que já está no plano da data = vw_est_plano_itens;
// grava por est_plano_salvar (uma receita por chamada, em fila); fecha e gera as listas como a sugestão (plpFecharGerar).
// A data escolhida manda (hoje ou amanhã) — a sugestão segue só em amanhã (vw_est_plano_do_dia).
async function plpManual(on) {
  if (!PLP) return;
  PLP.manual = !!on;
  const alvo = document.getElementById('view-plprod');
  try { await (on ? plpManCarregar() : plpCarregar()); }
  catch (e) {
    if (alvo) alvo.innerHTML = `<div class="contexto" style="border-color:var(--farol-fora);">Não consegui abrir: ${trEscH(e.message)}
      <button class="preset-btn" onclick="plpManual(${on ? 'false' : 'true'})">${on ? 'Voltar à sugestão' : 'Montar o plano à mão'}</button></div>`;
  }
}
async function plpManCarregar() {
  const alvo = document.getElementById('view-plprod');
  if (!alvo || !PLP) return;
  const M = PLP.man || (PLP.man = { data: prdHoje(), grupo: null, fam: null, busca: '', soPlano: false, dig: {} });
  if (M.data < prdHoje()) M.data = prdHoje();
  if (!M.cat) alvo.innerHTML = `<div class="contexto">Carregando…</div>`;
  const u = encodeURIComponent(PLP.unidade);
  const [cat, itens] = await Promise.all([
    M.cat ? Promise.resolve(M.cat) : consultarTudo(`vw_est_plano_receitas?select=nome_base,grupo_receita,familia,un&order=nome_base`),
    consultarTudo(`vw_est_plano_itens?select=id_plano,situacao_plano,nome_base,planejado,un,forma,insumo_mp,qtd_mp,un_mp&unidade=eq.${u}&data_para=eq.${M.data}`),
    estFilaCarregar(PLP.unidade),
  ]);
  plpMpCarregar();
  M.cat = cat || [];
  M.itens = new Map((itens || []).map((i) => [i.nome_base, i]));
  const um = (itens || []).find((i) => i.id_plano);
  M.idPlano = um ? um.id_plano : null;
  M.sit = um ? um.situacao_plano : null;
  plpManRender();
}
function plpManData(d) { const M = PLP.man; if (!M || M.data === d) return; M.data = d; M.dig = {}; plpManual(true); }
function plpManChip(campo, v) { const M = PLP.man; M[campo] = M[campo] === v ? null : v; if (campo === 'grupo') M.fam = null; plpManRender(); }
function plpManBusca(v) { PLP.man.busca = v; plpManRender(); }
const PLP_MAN_GRUPO = { LANCHES: 'Lanches', PRATOS: 'Pratos', PRODUCAO: 'Produção', 'PRE PREPARO': 'Pré-preparo' };
function plpManNomeG(g) { return !g ? 'Sem categoria' : PLP_MAN_GRUPO[g] || g.charAt(0) + g.slice(1).toLowerCase(); }
function plpManNomeF(f) { return !f ? 'Sem família' : f.length <= 3 ? f : f.charAt(0) + f.slice(1).toLowerCase(); }
function plpManNoPlano() { return [...(PLP.man.itens || new Map()).values()].filter((i) => Number(i.planejado) > 0); }
function plpManResumoHtml() {
  const n = plpManNoPlano().length;
  return n ? `<b>${n} ${n === 1 ? 'receita' : 'receitas'}</b> no plano de ${plpDm(PLP.man.data).slice(0, 5)}` : `Nenhuma receita no plano de ${plpDm(PLP.man.data).slice(0, 5)} ainda`;
}
function plpManPintar() {
  const r = document.getElementById('plpManResumo'); if (r) r.innerHTML = plpManResumoHtml();
  const b = document.getElementById('plpManFecharBtn'); if (b && !EST_OCUPADO) b.disabled = !plpManNoPlano().length && !Object.keys(PLP.man.dig).length;
}
function plpManRender() {
  const alvo = document.getElementById('view-plprod');
  const M = PLP && PLP.man;
  if (!alvo || !M) return;
  const foco = document.activeElement && document.activeElement.id === 'plpManBusca';
  const hoje = prdHoje(), amanha = plpAmanha();
  const fechado = /FECHAD/i.test(M.sit || '');
  // o catálogo da base + o que já está no plano e saiu da base (não some da tela)
  const todas = M.cat.slice();
  M.itens.forEach((i, k) => { if (!todas.some((r) => r.nome_base === k)) todas.push({ nome_base: k, grupo_receita: null, familia: null, un: i.un }); });
  const noPl = (r) => M.itens.has(r.nome_base) || M.dig[r.nome_base] !== undefined;
  let vis = todas;
  if (M.soPlano) vis = vis.filter(noPl);
  if (M.grupo !== null) vis = vis.filter((r) => (r.grupo_receita || '') === M.grupo);
  const antesFam = vis;
  const fams = [...new Set(antesFam.map((r) => r.familia || ''))].sort((a, b) => (a ? 0 : 1) - (b ? 0 : 1) || a.localeCompare(b, 'pt-BR'));
  if (M.fam !== null) vis = vis.filter((r) => (r.familia || '') === M.fam);
  if (M.busca) { const b = M.busca.toLowerCase(); vis = vis.filter((r) => String(r.nome_base).toLowerCase().includes(b)); }
  const grupos = [...new Set(todas.map((r) => r.grupo_receita || ''))].sort((a, b) => (a ? 0 : 1) - (b ? 0 : 1) || a.localeCompare(b, 'pt-BR'));
  const chip = (ativo, onclick, rot, titulo) => `<button class="preset-btn${ativo ? ' active' : ''}" onclick="${onclick}"${titulo ? ` title="${titulo}"` : ''}>${rot}</button>`;
  const js = (v) => trEscH(JSON.stringify(v));

  let h = `<div style="display:flex; flex-wrap:wrap; gap:8px; align-items:center; justify-content:space-between;"><h2>Planejar produção — plano manual</h2>
      <button class="preset-btn" onclick="plpManual(false)" title="A tela com a sugestão do que falta até a quarta">‹ Voltar à sugestão</button></div>` + estFilaHtml();
  h += `<div style="display:flex; flex-wrap:wrap; gap:8px; align-items:center; margin:6px 0 10px;">
      <span style="color:var(--tx-3); font-weight:700;">Plano para</span>
      ${chip(M.data === hoje, `plpManData('${hoje}')`, `Hoje · ${plpDm(hoje).slice(0, 5)}`)}
      ${chip(M.data === amanha, `plpManData('${amanha}')`, `Amanhã · ${plpDm(amanha).slice(0, 5)}`)}
      <span id="plpManResumo" style="margin-left:8px;">${plpManResumoHtml()}</span></div>`;
  if (fechado) {
    const f = EST_FILA || {};
    const nL = (Number(f.listas_a_separar) || 0) + (Number(f.listas_a_conferir) || 0) + (Number(f.listas_a_virar_ordem) || 0);
    h += `<div class="contexto" style="border-color:var(--farol-ok); text-align:left;"><b>Plano de ${plpDm(M.data)} fechado.</b>
      ${nL ? `${nL} ${nL === 1 ? 'lista espera' : 'listas esperam'} na Separação.` : 'As listas dele estão na Separação e nas Ordens.'}
      <button class="preset-btn active" onclick="mostrarModulo('separacao')">Abrir a Separação ›</button>
      <button class="preset-btn" onclick="plpReabrir(${M.idPlano})" title="Volta o plano para edição. Se já existe lista separada ou ordem dele, desfaça antes.">Reabrir o plano</button></div>`;
  } else {
    h += `<div style="display:flex; flex-wrap:wrap; gap:8px; align-items:center; margin:0 0 10px;">
      <button id="plpManFecharBtn" class="preset-btn active est-ciclo" onclick="plpManFechar()" ${plpManNoPlano().length || Object.keys(M.dig).length ? '' : 'disabled title="Digite a quantidade de ao menos uma receita antes"'}>Fechar o plano e gerar as listas de separação</button>
      <span class="caption-label" style="text-align:left;">Digite a quantidade: grava ao sair do campo · 0 tira do plano.</span></div>`;
  }
  // filtros: categoria, família (da categoria escolhida), só o que está no plano, busca
  h += `<div style="display:flex; flex-wrap:wrap; gap:6px; align-items:center; margin:4px 0;">
      ${chip(M.grupo === null && !M.soPlano, `PLP.man.grupo=null; PLP.man.fam=null; PLP.man.soPlano=false; plpManRender();`, `Todas · ${todas.length}`)}
      ${grupos.map((g) => chip(M.grupo === g, `plpManChip('grupo', ${js(g)})`, `${trEscH(plpManNomeG(g))} · ${todas.filter((r) => (r.grupo_receita || '') === g).length}`)).join('')}
      ${chip(M.soPlano, `PLP.man.soPlano=!PLP.man.soPlano; plpManRender();`, `Só o que está no plano · ${todas.filter(noPl).length}`)}
      <input id="plpManBusca" value="${trEscH(M.busca || '')}" oninput="plpManBusca(this.value)" placeholder="procurar receita"
        style="flex:1; min-width:160px; background:var(--p-paper, var(--surface-2)); border:1px solid var(--p-line, var(--line)); color:var(--p-ink, var(--tx-1)); border-radius:6px; padding:7px 10px; font-size:13px;"></div>`;
  if (fams.length > 1) {
    h += `<div style="display:flex; flex-wrap:wrap; gap:6px; align-items:center; margin:4px 0 10px;"><span style="color:var(--tx-4); font-size:12.5px;">Família:</span>
      ${fams.map((f) => chip(M.fam === f, `plpManChip('fam', ${js(f)})`, `${trEscH(plpManNomeF(f))} · ${antesFam.filter((r) => (r.familia || '') === f).length}`)).join('')}</div>`;
  }
  const campo = 'width:84px; background:var(--p-paper, var(--surface-2)); border-radius:8px; color:var(--p-ink, var(--tx-1)); padding:5px 8px; font-weight:700;';
  h += `<div id="tabelaPlanoManual" style="overflow-x:auto;"><table><thead><tr><th>Receita</th><th>Família</th><th>Quantidade</th></tr></thead><tbody>`;
  if (!vis.length) h += `<tr><td colspan="3">Nenhuma receita neste filtro.</td></tr>`;
  const porG = new Map();
  vis.slice().sort((a, b) => (a.familia ? 0 : 1) - (b.familia ? 0 : 1) || String(a.familia || '').localeCompare(String(b.familia || ''), 'pt-BR')
                           || String(a.nome_base).localeCompare(String(b.nome_base), 'pt-BR'))
     .forEach((r) => { const g = r.grupo_receita || ''; if (!porG.has(g)) porG.set(g, []); porG.get(g).push(r); });
  grupos.filter((g) => porG.has(g)).forEach((g) => {
    const arr = porG.get(g);
    h += `<tr class="grp"><td colspan="3" style="font-weight:800; letter-spacing:.6px; padding-top:12px; border-bottom:2px solid var(--line-2);">${trEscH(plpManNomeG(g).toUpperCase())}
        <span style="color:var(--tx-4); font-weight:400; font-size:12.5px;">· ${arr.length}</span></td></tr>`;
    arr.forEach((r) => {
      const k = r.nome_base, it = M.itens.get(k);
      const salvo = it && it.planejado != null ? plpQtd(it.planejado) : '';
      const v = M.dig[k] !== undefined ? M.dig[k] : salvo;
      const un = (it && it.un) || r.un || '';
      const temMp = !fechado && M.mp && M.mp.has(k), mpAb = temMp && M.mpAberto && M.mpAberto[k];
      const pelaMp = salvo && it && it.forma === 'MATERIA_PRIMA' && it.qtd_mp != null
        ? ` <span style="font-size:11px; color:var(--tx-4);">pelos ${trEscH(plpQtd(it.qtd_mp))} ${trEscH(String(it.un_mp || '').toLowerCase())} de ${trEscH(it.insumo_mp || '')}</span>` : '';
      h += `<tr><td>${trEscH(k)}${temMp ? `<div><button type="button" class="preset-btn${mpAb ? ' active' : ''}" style="font-size:11.5px; padding:2px 8px; margin-top:3px;" onclick="plpMpAbrir(${js(k)})"
            title="Quando você sabe quanto tem de matéria-prima e não quanto vai render">${mpAb ? '× fechar' : 'Tenho X kg de matéria-prima ›'}</button></div>` : ''}</td><td style="color:var(--tx-3);">${trEscH(plpManNomeF(r.familia))}</td>
        <td style="white-space:nowrap;"><input type="number" step="0.001" min="0" inputmode="decimal" value="${trEscH(v)}" ${fechado ? 'disabled' : ''}
            oninput="PLP.man.dig[${js(k)}]=this.value; plpManPintar();" onchange="plpManSalvarUm(${js(k)})"
            style="${campo} border:1px solid ${salvo ? 'var(--farol-ok)' : 'var(--info)'};">
          <span style="color:var(--tx-4); font-size:11px;">${trEscH(un)}</span>
          <span id="${plpIdK('m' + k)}" style="font-size:11px; color:${salvo ? 'var(--farol-ok)' : 'var(--tx-5)'};">${salvo ? 'no plano' : ''}</span>${pelaMp}</td></tr>`;
      if (mpAb) h += plpMpLinhaHtml(k);
    });
  });
  h += `</tbody></table></div>`;
  alvo.innerHTML = h;
  if (foco) { const i = document.getElementById('plpManBusca'); if (i) { i.focus(); i.setSelectionRange(i.value.length, i.value.length); } }
}
// uma receita por chamada e em FILA (a função lê a view do plano por receita; várias juntas passavam do teto de 8 s)
function plpManSalvarUm(k) {
  const M = PLP.man;
  M.fila = (M.fila || Promise.resolve()).then(() => plpManGravar(k)).catch(() => {});
  return M.fila;
}
async function plpManGravar(k) {
  const M = PLP.man;
  if (M.dig[k] === undefined) return;
  const v = String(M.dig[k]).trim();
  const it = M.itens.get(k);
  const salvo = it && it.planejado != null ? plpQtd(it.planejado) : '';
  const st = document.getElementById(plpIdK('m' + k));
  const diz = (t, cor) => { if (st) { st.style.color = cor; st.textContent = t; } };
  if (v === salvo || (v === '' && !it)) { delete M.dig[k]; diz(salvo ? 'no plano' : '', salvo ? 'var(--farol-ok)' : 'var(--tx-5)'); plpManPintar(); return; }
  if (v === '') { diz('para tirar, digite 0', 'var(--farol-perto)'); return; }
  const qtd = Number(v.replace(',', '.'));
  if (!isFinite(qtd) || qtd < 0) { diz('não é número', 'var(--farol-fora)'); avisoAcao('atencao', `! ${k}: a quantidade não é número. Corrija.`); return; }
  const r0 = M.cat.find((r) => r.nome_base === k) || {};
  const un = (it && it.un) || r0.un || null;
  diz('salvando…', 'var(--tx-4)');
  avisoAcao('enviando', `Gravando ${k}…`);
  const r = await trRpcSeguro('est_plano_salvar', { p_unidade: PLP.unidade, p_data_para: M.data, p_itens: [{ nome_base: k, qtd, un }],
                                                    p_quem: ((rmbSessao() || {}).email || '') });
  if (!r.ok) {
    const erro = await trErroDe(r);
    diz('não salvou', 'var(--farol-fora)');
    avisoAcao('erro', `✗ ${k} NÃO foi para o plano: ${erro}. O número continua na tela — tente de novo.`, () => plpManSalvarUm(k));
    return;
  }
  const idp = await r.json().catch(() => null);
  if (idp) M.idPlano = idp;
  if (!M.sit) M.sit = 'ABERTO';
  if (qtd > 0) M.itens.set(k, { id_plano: M.idPlano, situacao_plano: M.sit, nome_base: k, planejado: qtd, un });
  else M.itens.delete(k);
  delete M.dig[k];
  diz(qtd > 0 ? '✓ salvo' : '✓ tirado', 'var(--farol-ok)');
  avisoAcao('ok', `✓ ${k}: ${qtd > 0 ? plpQtd(qtd) + ' ' + (un || '') + ' no' : 'tirado do'} plano de ${plpDm(M.data).slice(0, 5)} — às ${avisoHora()}.`);
  plpManPintar();
}
async function plpManFechar() {
  if (EST_OCUPADO) return;
  const M = PLP.man;
  // o que ficou digitado sem sair do campo grava antes
  Object.keys(M.dig).forEach((k) => plpManSalvarUm(k));
  await M.fila;
  if (Object.keys(M.dig).length) { avisoAcao('atencao', '! Há quantidade que não gravou (veja a linha marcada). Corrija antes de fechar.'); return; }
  const n = plpManNoPlano().length;
  if (!M.idPlano || !n) { avisoAcao('atencao', '! Digite a quantidade de ao menos uma receita antes de fechar.'); return; }
  await plpFecharGerar(M.idPlano, M.data, n);
}

// PLANEJAR PELA MATÉRIA-PRIMA (dono, qui 12/11/2026 03:05: "às vezes ela tem só X kg de acém e não sabe quanto vai render";
// livro chat-frente-estoque/respostas/plano-pela-materia-prima; proposta contexto/propostas-telas/2026-11-12-plano-pela-materia-prima.md).
// "Tenho X kg de [insumo ▾]": o rendimento aparece na hora (est_plano_pela_mp) e grava por est_plano_salvar_pela_mp.
// Os insumos de cada receita vêm de vw_est_plano_receita_mp, lida uma vez (≈2 s) sem segurar a tela.
function plpMpCarregar() {
  const M = PLP && PLP.man;
  if (!M || M.mp || M.mpLendo) return;
  M.mpLendo = consultarTudo('vw_est_plano_receita_mp?select=nome_base,insumo,un_insumo,posicao,e_principal,principal_clara,rende_por_un_insumo,un_receita&order=nome_base,posicao')
    .then((rows) => {
      const mp = new Map();
      (rows || []).forEach((x) => { if (!mp.has(x.nome_base)) mp.set(x.nome_base, []); mp.get(x.nome_base).push(x); });
      M.mp = mp;
    })
    .catch(() => { M.mp = new Map(); })
    .then(() => {
      M.mpLendo = null;
      // não tirar o foco de quem está digitando: redesenha no próximo desenho
      const a = document.activeElement;
      if (a && a.closest && a.closest('#tabelaPlanoManual')) return;
      if (PLP.manual) plpManRender();
    });
}
function plpMpEstado(k) {
  const M = PLP.man;
  M.mpDig = M.mpDig || {};
  if (!M.mpDig[k]) {
    const ops = M.mp.get(k) || [];
    const p = ops.find((o) => o.e_principal);
    const clara = ops.length && ops.every((o) => o.principal_clara !== false);
    M.mpDig[k] = { qtd: '', insumo: clara && p ? p.insumo : '', res: null, erro: null };
  }
  return M.mpDig[k];
}
function plpMpAbrir(k) {
  const M = PLP.man;
  M.mpAberto = M.mpAberto || {};
  M.mpAberto[k] = !M.mpAberto[k];
  plpManRender();
  if (M.mpAberto[k]) { const i = document.getElementById(plpIdK('mpq' + k)); if (i) i.focus(); }
}
function plpMpLinhaHtml(k) {
  const M = PLP.man, s = plpMpEstado(k), ops = M.mp.get(k) || [];
  const js = (v) => trEscH(JSON.stringify(v));
  const op = ops.find((o) => o.insumo === s.insumo);
  const unMp = op ? String(op.un_insumo || '').toLowerCase() : 'kg';
  const sel = `<select id="${plpIdK('mps' + k)}" onchange="plpMpDig(${js(k)}, 'insumo', this.value)"
      style="background:var(--p-paper, var(--surface-2)); border:1px solid var(--p-line, var(--line)); color:var(--p-ink, var(--tx-1)); border-radius:6px; padding:5px 8px; max-width:260px;">
      ${s.insumo ? '' : '<option value="">escolha a matéria-prima</option>'}
      ${ops.map((o) => `<option value="${trEscH(o.insumo)}"${o.insumo === s.insumo ? ' selected' : ''}>${trEscH(o.insumo)}${o.e_principal && o.principal_clara !== false ? ' (principal)' : ''}</option>`).join('')}</select>`;
  return `<tr class="plp-mp"><td colspan="3" style="border-left:3px solid var(--info); padding:8px 10px;">
      <div style="display:flex; flex-wrap:wrap; gap:8px; align-items:center;">
        <b>Tenho</b>
        <input id="${plpIdK('mpq' + k)}" type="number" step="0.001" min="0" inputmode="decimal" value="${trEscH(s.qtd)}"
          oninput="plpMpDig(${js(k)}, 'qtd', this.value)"
          style="width:84px; background:var(--p-paper, var(--surface-2)); border:1px solid var(--info); border-radius:8px; color:var(--p-ink, var(--tx-1)); padding:5px 8px; font-weight:700;">
        <span id="${plpIdK('mpu' + k)}" style="color:var(--tx-4);">${trEscH(unMp)}</span> de ${sel}
        <button type="button" class="preset-btn active" onclick="plpMpSalvar(${js(k)})">Pôr no plano</button>
      </div>
      <div id="${plpIdK('mpr' + k)}" style="margin-top:6px; text-align:left;">${plpMpResHtml(k)}</div></td></tr>`;
}
function plpMpResHtml(k) {
  const M = PLP.man, s = plpMpEstado(k);
  if (s.erro) return `<span style="color:var(--farol-fora);">${trEscH(s.erro)}</span>`;
  if (!s.insumo) return `<span style="color:var(--farol-perto);">Esta receita tem dois insumos quase do mesmo peso: escolha qual matéria-prima você tem.</span>`;
  if (!s.res) return `<span style="color:var(--tx-4);">${s.lendo ? 'Calculando…' : 'Digite quanto você tem: o rendimento aparece aqui.'}</span>`;
  const L = s.res, l0 = L[0] || {};
  const un = String(l0.un_receita || '').toUpperCase();
  const q = (v, u) => `${Number(v || 0).toLocaleString('pt-BR', { maximumFractionDigits: 3 })} ${String(u || '').toLowerCase()}`;
  const rende = un === 'KG' || un === 'L' ? q(l0.planejar, un) : `${Math.floor(Number(l0.planejar || 0))} ${un.toLowerCase()}`;
  let h = `<b style="color:var(--farol-ok);">Rende ${trEscH(rende)} de ${trEscH(k)}.</b>`;
  const outros = L.filter((x) => !x.e_a_mp && Number(x.qtd_ingrediente) > 0);
  // a principal, quando a matéria-prima escolhida não é ela
  const ops = M.mp.get(k) || [], p = ops.find((o) => o.e_principal);
  const princ = !l0.mp_e_a_principal && p ? outros.find((x) => x.ingrediente === p.insumo) : null;
  if (princ) h += ` <span>Vai pedir <b>${trEscH(q(princ.qtd_ingrediente, princ.un_ingrediente))} de ${trEscH(princ.ingrediente)}</b>.</span>`;
  const resto = outros.filter((x) => x !== princ);
  if (resto.length) h += `<div style="font-size:12.5px; color:var(--tx-3); margin-top:3px;">Vai pedir também: ${resto.map((x) => `${trEscH(x.ingrediente)} ${trEscH(q(x.qtd_ingrediente, x.un_ingrediente))}`).join(' · ')}</div>`;
  if (l0.rendimento_real != null) {
    const n = Number(l0.apontamentos_reais || 0);
    h += `<div style="font-size:12px; color:var(--tx-4); margin-top:3px;">Pela ficha, 1 ${trEscH(String(l0.un_mp || '').toLowerCase())} rende ${trEscH(q(l0.rendimento_ficha, un))} · nas últimas ${n} ${n === 1 ? 'produção' : 'produções'} rendeu ${trEscH(q(l0.rendimento_real, un))}</div>`;
  }
  return h;
}
function plpMpPintar(k) {
  const el = document.getElementById(plpIdK('mpr' + k)); if (el) el.innerHTML = plpMpResHtml(k);
  const s = plpMpEstado(k), op = (PLP.man.mp.get(k) || []).find((o) => o.insumo === s.insumo);
  const u = document.getElementById(plpIdK('mpu' + k)); if (u) u.textContent = op ? String(op.un_insumo || '').toLowerCase() : 'kg';
}
function plpMpDig(k, campo, v) {
  const s = plpMpEstado(k);
  s[campo] = v; s.res = null; s.erro = null;
  clearTimeout(s.t);
  const qtd = Number(String(s.qtd).replace(',', '.'));
  if (!s.insumo || !(qtd > 0)) { plpMpPintar(k); return; }
  s.lendo = true; plpMpPintar(k);
  s.t = setTimeout(async () => {
    const pedido = (s.pedido || 0) + 1; s.pedido = pedido;
    const r = await trRpcSeguro('est_plano_pela_mp', { p_nome_base: k, p_qtd_mp: qtd, p_insumo: s.insumo });
    if (pedido !== s.pedido) return;   // já digitou outro número
    s.lendo = false;
    if (r.ok) s.res = await r.json().catch(() => []); else s.erro = await trErroDe(r);
    plpMpPintar(k);
  }, 300);
}
function plpMpSalvar(k) {
  const M = PLP.man;
  M.fila = (M.fila || Promise.resolve()).then(() => plpMpGravar(k)).catch(() => {});
  return M.fila;
}
async function plpMpGravar(k) {
  const M = PLP.man, s = plpMpEstado(k);
  const qtd = Number(String(s.qtd).replace(',', '.'));
  if (!s.insumo) { avisoAcao('atencao', `! ${k}: escolha qual matéria-prima você tem.`); return; }
  if (!(qtd > 0)) { avisoAcao('atencao', `! ${k}: digite quanto você tem de ${s.insumo}.`); return; }
  avisoAcao('enviando', `Gravando ${k} pelos ${plpQtd(qtd)} de ${s.insumo}…`);
  const r = await trRpcSeguro('est_plano_salvar_pela_mp', { p_unidade: PLP.unidade, p_data_para: M.data, p_nome_base: k, p_qtd_mp: qtd,
                                                            p_insumo: s.insumo, p_quem: ((rmbSessao() || {}).email || '') });
  if (!r.ok) {
    const erro = await trErroDe(r);
    s.erro = erro; plpMpPintar(k);
    avisoAcao('erro', `✗ ${k} NÃO foi para o plano: ${erro}. O número continua na tela — tente de novo.`, () => plpMpSalvar(k));
    return;
  }
  const g = ((await r.json().catch(() => [])) || [])[0] || {};
  if (g.id_plano) M.idPlano = g.id_plano;
  if (!M.sit) M.sit = 'ABERTO';
  M.itens.set(k, { id_plano: M.idPlano, situacao_plano: M.sit, nome_base: k, planejado: g.planejado, un: g.un,
                   forma: 'MATERIA_PRIMA', insumo_mp: g.insumo_mp || s.insumo, qtd_mp: g.qtd_mp != null ? g.qtd_mp : qtd, un_mp: g.un_mp });
  delete M.dig[k]; delete M.mpDig[k]; if (M.mpAberto) delete M.mpAberto[k];
  avisoAcao('ok', `✓ ${k}: ${plpQtd(g.planejado)} ${g.un || ''} no plano de ${plpDm(M.data).slice(0, 5)}, pelos ${plpQtd(qtd)} de ${s.insumo} — às ${avisoHora()}.`);
  plpManRender();
}

// A folha impressa segue o molde da folha de contagem: grupo por grupo, na ordem em que se
// anda pelo estoque, e uma caixa EM BRANCO para quem pesa escrever o que realmente saiu.
// Esse numero escrito e o que vai valer quando o dono decidir quem baixa o estoque — a
// separacao pesada ou a ficha teorica.
async function plpImprimir() {
  const sep = PLP && PLP.separacao;
  if (!sep || !sep.length) { alert('Nada a separar: nenhuma receita está faltando até a próxima quarta.'); return; }
  const porGrupo = {};
  sep.slice().sort((a, b) => (a.nome_base || a.nome_saipos || '').localeCompare(b.nome_base || b.nome_saipos || '', 'pt-BR'))
     .forEach((s) => { const g = s.grupo || 'OUTROS'; (porGrupo[g] = porGrupo[g] || []).push(s); });
  const ordem = (g) => { const k = CTG_GRUPO_ORDEM.indexOf(g); return k < 0 ? 50 : k; };
  const grupos = Object.keys(porGrupo).sort((a, b) => ordem(a) - ordem(b) || a.localeCompare(b));
  const p0 = (PLP.plano || [])[0] || {};
  const receitas = (PLP.plano || []).filter((p) => Number(p.falta) > 0);

  const w = window.open('', '_blank');
  if (!w) { alert('O navegador bloqueou a janela de impressão — libere pop-ups para este site.'); return; }
  w.document.write(`<!DOCTYPE html><html><head><meta charset="utf-8">
    <title>Separação ${plpDm(p0.proxima_quarta)} — ${PLP.unidade}</title><style>
    body { font-family:Arial, sans-serif; color:#000; margin:18px 24px; }
    .cab { display:flex; justify-content:space-between; align-items:flex-start; border-bottom:2px solid #000; padding-bottom:6px; }
    h1 { font-size:18px; margin:0; }
    .cod { font-size:26px; font-weight:bold; letter-spacing:1px; }
    .sub { font-size:11.5px; color:#45443f; margin:3px 0 0; }
    .assina { font-size:12px; margin:10px 0 0; }
    .assina span { display:inline-block; border-bottom:1px solid #000; width:190px; margin:0 18px 0 4px; }
    h2 { font-size:13px; text-transform:uppercase; background:#e8e6dc; border:1px solid #9c9b90;
         padding:4px 6px; margin:14px 0 4px; page-break-after:avoid; }
    table { width:100%; border-collapse:collapse; page-break-inside:auto; }
    td, th { border-bottom:1px solid #bbb; padding:5px 6px; font-size:12.5px; text-align:left; }
    tr { page-break-inside:avoid; }
    th { font-size:10px; text-transform:uppercase; color:#45443f; }
    .n { width:30px; color:#45443f; font-size:11px; }
    .q { width:92px; text-align:right; font-weight:bold; }
    .box { width:96px; border:1px solid #000 !important; height:26px; }
    .plano { font-size:11.5px; color:#45443f; margin:6px 0 0; }
    @media print { body { margin:10px 14px; } }
  </style></head><body>
    <div class="cab"><div>
      <h1>Ficha de separação — ${PLP.unidade}</h1>
      <p class="sub">Para a produção até a contagem de ${p0.proxima_quarta ? plpDm(p0.proxima_quarta) : 'quarta'} ·
        ${sep.length} ${sep.length === 1 ? 'item' : 'itens'} · impressa em ${new Date().toLocaleString('pt-BR')}</p>
      <p class="assina">Separou:<span></span>Conferiu:<span></span></p>
    </div><div class="cod">SEP</div></div>
    <p class="plano"><b>O plano:</b> ${receitas.map((r) => `${r.nome_base || r.nome_saipos} ${fmt(Number(r.falta))} ${r.un || ''}`).join(' · ') || '—'}</p>`);
  let n = 0;
  grupos.forEach((g) => {
    w.document.write(`<h2>${g}</h2><table><thead><tr><th class="n">#</th><th>Item</th>
      <th class="q">Pedido</th><th class="q">Tem</th><th>Separado de verdade</th></tr></thead><tbody>`);
    porGrupo[g].forEach((s) => {
      n += 1;
      w.document.write(`<tr><td class="n">${n}</td><td>${s.nome_base || s.nome_saipos}</td>
        <td class="q">${fmt(Number(s.qtd_a_separar))} ${s.un || ''}</td>
        <td class="q">${s.tem_no_estoque == null ? '—' : fmt(Number(s.tem_no_estoque)) + ' ' + (s.un_do_estoque || '')}</td>
        <td class="box"></td></tr>`);
    });
    w.document.write(`</tbody></table>`);
  });
  w.document.write(`</body></html>`);
  w.document.close();
  w.focus();
  w.print();
}

let PRD = null;   // { papel, unidade, data, receitas, lancamentos, busca, aberta, ingredientes }

// prdHoje mora no núcleo desde 05/11/2026 (o Fluxo projetado também usa)
function prdDiasAtras(n) {
  const d = new Date(prdHoje() + 'T12:00:00');
  d.setDate(d.getDate() - n);
  return new Intl.DateTimeFormat('en-CA').format(d);
}
function prdId(nome) {
  return 'prd_' + btoa(unescape(encodeURIComponent(nome))).replace(/[^A-Za-z0-9]/g, '');
}
function prdTxt(v) { return JSON.stringify(v == null ? '' : v).replace(/"/g, '&quot;'); }

async function prdFetch(caminho, opcoes) {
  // 21/10/2026: o login vencia no meio da contagem ("JWT expired" ao abrir a folha) — renova antes e, se o
  // banco ainda assim recusar por login vencido (401), renova e tenta de novo uma vez.
  await rmbGarantirTokenValido();
  const chama = () => fetch(`${SUPABASE_URL}/rest/v1/${caminho}`,
                        { headers: rmbHeaders((opcoes || {}).extra || {}), ...(opcoes || {}) });
  let r = await chama();
  if (await rmbRenovarSeExpirado(r)) r = await chama();
  if (!r.ok) throw new Error((await r.text()).slice(0, 200));
  return r;
}

// ------------------------------------------------------------------
// CONTROLE DE ESTOQUE (dono, 22/10/2026: as movimentações para conferência, item a item, como a Movimentação do
// Saipos). Lê o NOSSO motor já consolidado por nome da base (est_controle_extrato, refeito a cada carga do Saipos):
// vw_est_controle_item é o cabeçalho de cada item e vw_est_controle o extrato. A tela não soma nada: o saldo de cada
// linha (saldo_depois) e o de hoje (saldo_hoje) vêm do banco e fecham entre si. Linha antes da partida (a última
// contagem) vem sem saldo: é histórico, mostrada apagada, com um corte na partida.
// ------------------------------------------------------------------
let CTL = null;
const CTL_TIPOS = ['Contagem', 'Compra (nota fiscal)', 'Transferencia recebida (lista)', 'Producao: entrou a receita',
  'Producao: saiu o ingrediente', 'Transferencia enviada (lista)', 'Venda (baixa pela ficha)'];
async function entrarControle() {
  const alvo = document.getElementById('view-controle');
  if (!alvo) return;
  if (!rmbSessao()) { alvo.innerHTML = `<div class="contexto">Entre no painel para ver o controle de estoque.</div>`; return; }
  alvo.innerHTML = `<div class="contexto">Carregando…</div>`;
  try {
    if (!CTL) {
      CTL = { unidade: null, busca: '', tipo: '', de: '', ate: '', item: null, extrato: null,
              ord: 'dinheiro', desc: true, curva: '', grupo: '', soNeg: false };
    }
    const uT = await estLojaDaTela(alvo, entrarControle); if (!uT) return;
    if (CTL.unidade !== uT) { CTL.unidade = uT; CTL.item = null; CTL.extrato = null; }
    await ctlCarregar();
  } catch (e) {
    alvo.innerHTML = `<div class="contexto" style="border-color:var(--farol-fora);">Não consegui abrir a tela: ${trEscH(e.message)}</div>`;
  }
}
async function ctlCarregar() {
  await estNomesCarregar();
  const u = encodeURIComponent(CTL.unidade);
  const [itens, idade] = await Promise.all([
    consultarTudo(`vw_est_controle_item?select=*&unidade=eq.${u}&order=nome_base`),
    // 26/10/2026: a idade do retrato (conta movimento mais novo que ele, não só o relógio)
    consultarTudo('vw_est_controle_idade?select=*').catch(() => null),
  ]);
  CTL.itens = itens;
  CTL.idade = (idade || [])[0] || null;
  CTL.item = null; CTL.extrato = null;
  ctlRender();
}
// 26/10/2026: o retrato do controle e a idade dele (vw_est_controle_idade). "Atualizar agora" = est_refazer_extrato,
// a mesma função da carga das 05:40 e do fechamento da contagem.
function ctlIdadeHtml() {
  const i = CTL.idade;
  if (!i) return '';
  const velho = !/^EM DIA/.test(i.situacao || '');
  return `<div class="caption-label" style="text-align:left; ${velho ? 'color:var(--amber-2);' : ''}">${trEscH(i.recado || '')}${velho
    ? ` — ${Number(i.movimentos_mais_novos) || 0} ${Number(i.movimentos_mais_novos) === 1 ? 'movimento mais novo' : 'movimentos mais novos'} que este retrato.
       <button class="preset-btn" id="ctlAtualizar" onclick="ctlAtualizar()">Atualizar agora</button>` : ''}</div>`;
}
async function ctlAtualizar() {
  const b = document.getElementById('ctlAtualizar');
  if (b) { b.disabled = true; b.textContent = 'Atualizando… (uns 10 s)'; }
  try {
    const r = await ctgFetch('rpc/est_refazer_extrato', { method: 'POST', extra: { 'Content-Type': 'application/json' }, body: '{}' });
    if (!r.ok) throw new Error(await trErroDe(r));
    avisoAcao('ok', `✓ Retrato atualizado — às ${avisoHora()}.`);
  } catch (e) { avisoAcao('erro', `✗ O retrato NÃO atualizou: ${e.message}. Tente de novo.`, ctlAtualizar); }
  await ctlCarregar();
}
async function ctlAbrir(nome) {
  if (CTL.item === nome && CTL.extrato) { CTL.item = null; CTL.extrato = null; ctlRender(); return; }   // clicar de novo fecha
  CTL.item = nome; CTL.extrato = null; CTL.tipo = ''; CTL.de = ''; CTL.ate = ''; CTL.periodo = false;
  ctlRender();
  const u = encodeURIComponent(CTL.unidade);
  // KARDEX (dono, 22/10/2026): implantação = contagem de 21/10 às 19:00; 1ª linha o saldo inicial, depois cada entrada e
  // saída com o saldo correndo; nada antes da implantação. A ordem e o saldo vêm prontos de vw_est_kardex.
  // 29/10/2026 (dono 17:02): o kardex padrão também pela est_kardex_periodo — a linha da contagem vem com a conta inteira
  const it = (CTL.itens || []).find((x) => x.nome_base === nome) || {};
  const rp = await trRpcSeguro('est_kardex_periodo', { p_unidade: CTL.unidade, p_item: nome, p_de: it.partida_de ? String(it.partida_de).slice(0, 10) : null, p_ate: null });
  CTL.extrato = rp.ok ? await rp.json() : await consultarTudo(`vw_est_kardex?select=dia,ordem,tipo,movimento,documento,entrada,saida,un,saldo` +
    `&unidade=eq.${u}&nome_base=eq.${encodeURIComponent(nome)}&order=ordem,dia,tipo,documento`);
  ctlRender();
  const w = document.getElementById('ctlExtrato');
  if (w) w.scrollIntoView({ behavior: 'smooth', block: 'start' });
}
function ctlNum(v, un) {
  if (v == null || v === '') return '';
  const n = Number(v);
  const casas = (un === 'KG' || un === 'L' || un === 'LT') ? 3 : (Number.isInteger(n) ? 0 : 2);
  return n.toLocaleString('pt-BR', { minimumFractionDigits: 0, maximumFractionDigits: casas });
}
function ctlDm(s) { return s ? String(s).slice(8, 10) + '/' + String(s).slice(5, 7) : '—'; }
const CTL_SEL = 'background:var(--surface-2); border:1px solid var(--line); border-radius:8px; color:var(--tx-1); padding:6px 8px; font:inherit;';
function ctlRender() {
  const alvo = document.getElementById('view-controle');
  if (!alvo || !CTL) return;
  const busca = (CTL.busca || '').trim().toUpperCase();
  // dono, 22/10/2026: "pode ter as colunas com ordenação, e filtros com Curva ABC, por grupo e itens negativos".
  // curva e grupo vêm do banco (colunas de vw_est_controle_item); sem a coluna, o filtro não aparece.
  const temCurva = (CTL.itens || []).some((i) => i.curva), temGrupo = (CTL.itens || []).some((i) => i.grupo);
  // O VALOR mora em outro módulo (dono, 22/10/2026: "um modulo chamado posição de estoque ... assim toda a análise de
  // valores de estoque fica separado do controle de unidades de estoque"). Aqui é só quantidade.
  // FORA DA BASE à parte (22/10/2026): item sem nome na nossa base vem com o nome do Saipos e fora_da_base = true.
  // Não some (o movimento existiu), mas não se mistura com a base: só aparece quando se pede para ver.
  const nFora = (CTL.itens || []).filter((i) => i.fora_da_base).length;
  const itens = (CTL.itens || []).filter((i) => (CTL.verFora ? i.fora_da_base : !i.fora_da_base) && (!busca || String(i.nome_base).toUpperCase().includes(busca))
      && (!CTL.curva || i.curva === CTL.curva) && (!CTL.grupo || (CTL.grupo === '__fora' ? !i.grupo : i.grupo === CTL.grupo)) && (!CTL.soNeg || Number(i.saldo_hoje) < 0))
    .sort((a, b) => {
      const va = a[CTL.ord], vb = b[CTL.ord];
      const num = ['qtd_partida', 'entrou', 'saiu', 'saldo_hoje', 'dinheiro'].includes(CTL.ord);
      const r = num ? Number(va || 0) - Number(vb || 0) : String(va || '').localeCompare(String(vb || ''), 'pt-BR');
      // dono, 22/10/2026: "o filtro das tabelas deve sempre ordenar do maior valor para o menor" — empate (mesma curva,
      // mesmo grupo) cai no valor, do maior para o menor (o mesmo dinheiro que forma a curva ABC)
      return (CTL.desc ? -r : r) || Number(b.dinheiro || 0) - Number(a.dinheiro || 0);
    });
  // grupo na ordem da folha de contagem; item sem grupo = fora da folha (saiu da base ou o dono tirou da contagem)
  const ordemG = {};
  (CTL.itens || []).forEach((i) => { if (i.grupo && ordemG[i.grupo] == null) ordemG[i.grupo] = Number(i.ordem_grupo); });
  const grupos = Object.keys(ordemG).sort((a, b) => ordemG[a] - ordemG[b] || a.localeCompare(b, 'pt-BR'));
  const temFora = temGrupo && (CTL.itens || []).some((i) => !i.grupo);
  const daBase = (CTL.itens || []).filter((i) => !i.fora_da_base);
  const comMov = daBase.filter((i) => Number(i.movimentos) > 0).length;
  const negativos = daBase.filter((i) => Number(i.saldo_hoje) < 0).length;

  let h = `<div class="section-label" style="border-top:none; margin-top:0; padding-top:0;">Controle de estoque — ${trEscH(estNomeLoja(CTL.unidade))}</div>
    <div class="caption-label" style="text-align:left;">Clique no item para ver o kardex, com o saldo linha a linha.</div>
    ${ctlIdadeHtml()}
    <div class="cards cards-3">
      <div class="card neutral"><div class="card-lbl">Itens no estoque</div><div class="card-val">${daBase.length}</div><div class="card-pct">nomes da base nesta loja</div></div>
      <div class="card neutral"><div class="card-lbl">Com movimento</div><div class="card-val">${comMov}</div><div class="card-pct">desde a implantação</div></div>
      <div class="card ${negativos ? 'highlight' : 'pos'}"><div class="card-lbl">Saldo negativo</div><div class="card-val">${negativos}</div><div class="card-pct">saiu mais do que tinha: conferir</div></div>
    </div>
    <div class="contexto" style="display:flex; gap:10px; align-items:center; flex-wrap:wrap;">
      <span>Loja <b>${trEscH(estNomeLoja(CTL.unidade))}</b></span>
      <datalist id="ctlItensLista">${(CTL.itens || []).filter((x) => !x.fora_da_base).map((x) => `<option value="${trEscH(x.nome_base)}">`).join('')}</datalist>
      <input id="ctlBusca" list="ctlItensLista" placeholder="Procurar item…" value="${trEscH(CTL.busca || '')}" oninput="ctlBuscar(this.value)"
             style="flex:1 1 220px; ${CTL_SEL}">
      ${temCurva ? `<select onchange="CTL.curva=this.value; CTL.ord='dinheiro'; CTL.desc=true; ctlRender();" style="${CTL_SEL}"><option value="">curva: todas</option>${['A', 'B', 'C'].map((c) => `<option${c === CTL.curva ? ' selected' : ''}>${c}</option>`).join('')}</select>` : ''}
      ${temGrupo ? `<select onchange="CTL.grupo=this.value; CTL.ord='dinheiro'; CTL.desc=true; ctlRender();" style="${CTL_SEL}"><option value="">grupo: todos</option>${grupos.map((g) => `<option${g === CTL.grupo ? ' selected' : ''}>${trEscH(g)}</option>`).join('')}${temFora ? `<option value="__fora"${CTL.grupo === '__fora' ? ' selected' : ''}>fora da folha de contagem</option>` : ''}</select>` : ''}
      ${nFora ? `<label style="display:flex; gap:6px; align-items:center;" title="itens sem nome na nossa base: aparecem com o nome do Saipos"><input type="checkbox"${CTL.verFora ? ' checked' : ''} onchange="CTL.verFora=this.checked; CTL.ord='dinheiro'; CTL.desc=true; ctlRender();"> ver os ${nFora} fora da base</label>` : ''}
      <label style="display:flex; gap:6px; align-items:center;"><input type="checkbox"${CTL.soNeg ? ' checked' : ''} onchange="CTL.soNeg=this.checked; CTL.ord='dinheiro'; CTL.desc=true; ctlRender();"> só negativos</label>
      <span class="caption-label">${itens.length} de ${(CTL.itens || []).length}</span>
    </div>`;
  if (CTL.verFora) h += `<div class="contexto" style="text-align:left; border-color:var(--farol-perto);"><b style="color:var(--farol-perto);">Fora da base: o nome aqui é o do Saipos.</b> São itens que tiveram movimento e ainda não têm nome na nossa base. Cada um que entrar na base sai desta lista sozinho.</div>`;
  const th = (col, rot, dir) => `<th style="cursor:pointer;${dir ? ' text-align:right;' : ''}" onclick="ctlOrdenarPor('${col}')" title="ordenar">${rot}${CTL.ord === col ? (CTL.desc ? ' ▼' : ' ▲') : ''}</th>`;
  h += `<div id="tabelaControleItens"><table><thead><tr>${th('nome_base', 'Item')}${temCurva ? th('curva', 'Curva') : ''}${temGrupo ? th('grupo', 'Grupo') : ''}${th('partida_de', 'Saldo inicial em')}${th('qtd_partida', 'Contado', 1)}
      ${th('entrou', 'Entrou', 1)}${th('saiu', 'Saiu', 1)}${th('saldo_hoje', 'Saldo hoje', 1)}<th>Un</th></tr></thead><tbody>`;
  itens.forEach((i) => {
    const neg = Number(i.saldo_hoje) < 0;
    h += `<tr data-nome="${trEscH(i.nome_base)}" style="cursor:pointer;${i.nome_base === CTL.item ? ' background:var(--surface-2);' : ''}" onclick="ctlAbrir(${JSON.stringify(i.nome_base).replace(/"/g, '&quot;')})" title="ver o extrato">
      <td><b>${trEscH(i.nome_base)}</b>${Number(i.movimentos) ? '' : ' <span class="caption-label">sem movimento</span>'}</td>
      ${temCurva ? `<td>${trEscH(i.curva || '')}</td>` : ''}${temGrupo ? `<td style="color:var(--tx-4);">${i.grupo ? trEscH(i.grupo) : '<i>fora da folha</i>'}</td>` : ''}
      <td>${ctlDm(i.partida_de)}</td><td style="text-align:right;">${ctlNum(i.qtd_partida, i.un)}</td>
      <td style="text-align:right;">${ctlNum(i.entrou, i.un)}</td><td style="text-align:right;">${ctlNum(i.saiu, i.un)}</td>
      <td style="text-align:right;${neg ? ' color:var(--farol-fora);' : ''}"><b>${ctlNum(i.saldo_hoje, i.un)}</b></td><td style="color:var(--tx-4);">${trEscH(i.un || '')}</td></tr>`;
    // 29/10/2026 (dono): o kardex abre logo abaixo do item clicado
    if (i.nome_base === CTL.item) h += `<tr><td colspan="${7 + (temCurva ? 1 : 0) + (temGrupo ? 1 : 0)}" style="white-space:normal; background:var(--bg);">${ctlHtmlExtrato()}</td></tr>`;
  });
  h += `</tbody></table></div>`;
  alvo.innerHTML = h;
}
// a busca: escolher um item da lista abre o kardex dele; digitar filtra (sem redesenhar a cada tecla)
function ctlBuscar(v) {
  CTL.busca = v;
  const it = (CTL.itens || []).find((x) => x.nome_base === v);
  if (it) { ctlAbrir(it.nome_base); return; }
  const b = String(v || '').trim().toUpperCase();
  document.querySelectorAll('#tabelaControleItens tbody tr[data-nome]').forEach((tr) => { tr.style.display = !b || tr.dataset.nome.toUpperCase().includes(b) ? '' : 'none'; });
}
function ctlOrdenarPor(col) {
  if (CTL.ord === col) CTL.desc = !CTL.desc;
  else { CTL.ord = col; CTL.desc = ['qtd_partida', 'entrou', 'saiu', 'saldo_hoje', 'dinheiro'].includes(col); }
  ctlRender();
}
// 29/10/2026 (dono): De/Até desde qualquer data — a função do banco refaz o saldo de abertura e põe as contagens do meio
async function ctlPeriodo(de, ate) {
  CTL.de = de || ''; CTL.ate = ate || '';
  if (!CTL.de && !CTL.ate) { CTL.periodo = false; return ctlAbrirDeNovo(); }
  avisoAcao('enviando', 'Buscando o período…');
  const r = await trRpcSeguro('est_kardex_periodo', { p_unidade: CTL.unidade, p_item: CTL.item, p_de: CTL.de || null, p_ate: CTL.ate || null });
  if (r.ok) { CTL.extrato = await r.json(); CTL.periodo = true; avisoAcao(null); }
  else { CTL.periodo = false; avisoAcao('erro', `✗ Não consegui buscar o período: ${await trErroDe(r)}. Tente de novo.`); }
  ctlRender();
}
async function ctlAbrirDeNovo() { const n = CTL.item; CTL.item = null; await ctlAbrir(n); }
const CTL_TIPO_ROT = { SAIDA_VENDA: 'Venda', PRODUCAO_SAI: 'Producao: saiu o ingrediente', PRODUCAO_ENTRA: 'Producao: entrou a receita', ENTRADA_NF: 'Compra (nota fiscal)', AJUSTE_CONTAGEM: 'Contagem' };
function ctlHtmlExtrato() {
  const i = (CTL.itens || []).find((x) => x.nome_base === CTL.item) || {};
  let h = `<div id="ctlExtrato" class="section-label">${trEscH(CTL.item)} — kardex</div>`;
  if (!CTL.extrato) return h + `<div class="contexto">Carregando o kardex…</div>`;
  const L = CTL.extrato.filter((r) => Number(r.ordem) === 0 || ((!CTL.tipo || r.tipo === CTL.tipo) && (CTL.periodo || ((!CTL.de || r.dia >= CTL.de) && (!CTL.ate || r.dia <= CTL.ate)))));
  const tipos = [...new Map(CTL.extrato.filter((r) => Number(r.ordem) !== 0).map((r) => [r.tipo, CTL_TIPO_ROT[r.tipo] || String(r.movimento || r.tipo).split(':')[0]])).entries()];
  h += `<div class="contexto" style="text-align:left;">${CTL.periodo ? `<b>${CTL.de ? ctlDm(CTL.de) : 'início'} a ${CTL.ate ? ctlDm(CTL.ate) : 'hoje'}</b>` : `Saldo inicial em ${ctlDm(i.partida_de)}`} · entrou <b>${ctlNum(i.entrou || 0, i.un)}</b> ·
      saiu <b>${ctlNum(i.saiu || 0, i.un)}</b> · saldo hoje <b>${ctlNum(i.saldo_hoje, i.un)} ${trEscH(i.un || '')}</b>
      <div style="display:flex; gap:8px; flex-wrap:wrap; margin-top:8px; align-items:center;">
        ${tipos.length ? `<select onchange="CTL.tipo=this.value; ctlRender();" style="${CTL_SEL}"><option value="">todos os movimentos</option>${tipos.map(([k, r]) => `<option value="${trEscH(k)}"${k === CTL.tipo ? ' selected' : ''}>${trEscH(r)}</option>`).join('')}</select>` : ''}
        <label>de <input type="date" id="ctlDe" value="${CTL.de}" style="${CTL_SEL}"></label>
        <label>até <input type="date" id="ctlAte" value="${CTL.ate}" style="${CTL_SEL}"></label>
        <button class="preset-btn active" onclick="ctlPeriodo(document.getElementById('ctlDe').value, document.getElementById('ctlAte').value)">Aplicar</button>
        ${CTL.periodo ? `<button class="preset-btn" onclick="ctlPeriodo('', '')">limpar</button>` : ''}
        <button class="preset-btn" onclick="CTL.item=null; ctlRender();">fechar</button></div></div>
    <div id="tabelaControleExtrato"><table><thead><tr><th>Dia</th><th>Movimento</th><th>Documento</th>
      <th style="text-align:right;">Entrada</th><th style="text-align:right;">Saída</th><th style="text-align:right;">Saldo</th></tr></thead><tbody>`;
  L.forEach((r) => {
    const abre = Number(r.ordem) === 0;
    h += `<tr${abre ? ' style="background:var(--surface-2);"' : ''}>
      <td style="white-space:nowrap;">${ctlDm(r.dia)}</td><td style="white-space:normal;overflow-wrap:anywhere;">${abre ? '<b>' + trEscH(r.movimento) + '</b>' : trEscH(r.movimento)}</td><td style="color:var(--tx-4);white-space:normal;overflow-wrap:anywhere;">${trEscH(r.documento || '')}</td>
      <td style="text-align:right; color:var(--farol-ok);">${r.entrada != null ? '+' + ctlNum(r.entrada, r.un) : ''}</td>
      <td style="text-align:right; color:var(--farol-fora);">${r.saida != null ? '−' + ctlNum(r.saida, r.un) : ''}</td>
      <td style="text-align:right;"><b>${ctlNum(r.saldo, r.un)}</b></td></tr>`;
  });
  if (L.length === 1) h += `<tr><td colspan="6" class="caption-label">Nenhum movimento ${CTL.periodo ? 'no período' : 'desde o saldo inicial'}.</td></tr>`;
  return h + `</tbody></table></div>`;
}

// ------------------------------------------------------------------
// POSIÇÃO DE ESTOQUE (dono, 22/10/2026: "um modulo chamado posição de estoque, que traga o valor de cada item, um
// histórico com a foto de outros dias, filtros, assim toda a análise de valores de estoque fica separado do controle
// de unidades de estoque"). Lê a FOTO diária do banco (vw_est_posicao por item, vw_est_posicao_dia por dia), tirada
// por est_tirar_foto_posicao() no fim da carga do Saipos e ao fechar contagem. A tela não multiplica nada.
// O histórico começa em 21/10 (antes disso a quantidade não é fiel). Dia RECONSTRUIDO usa o custo de hoje: ali a
// variação de valor é só de quantidade; a de preço aparece nos dias DIA.
// ------------------------------------------------------------------
let POS = null;
async function entrarPosicao() {
  const alvo = document.getElementById('view-posicao');
  if (!alvo) return;
  if (!rmbSessao()) { alvo.innerHTML = `<div class="contexto">Entre no painel para ver a posição de estoque.</div>`; return; }
  alvo.innerHTML = `<div class="contexto">Carregando…</div>`;
  try {
    if (!POS) {
      POS = { unidade: null, dia: null, busca: '', curva: '', grupo: '', semCusto: false,
              ord: 'valor', desc: true };
    }
    const uT = await estLojaDaTela(alvo, entrarPosicao); if (!uT) return;
    if (POS.unidade !== uT) { POS.unidade = uT; POS.dia = null; }
    await posCarregarDias();
  } catch (e) {
    alvo.innerHTML = `<div class="contexto" style="border-color:var(--farol-fora);">Não consegui abrir a tela: ${trEscH(e.message)}</div>`;
  }
}
async function posCarregarDias() {
  POS.dias = await consultarTudo(`vw_est_posicao_dia?select=*&unidade=eq.${encodeURIComponent(POS.unidade)}&order=dia`);
  if (!POS.dia || !POS.dias.some((d) => d.dia === POS.dia)) POS.dia = POS.dias.length ? POS.dias[POS.dias.length - 1].dia : null;
  await posCarregarItens();
}
async function posCarregarItens() {
  POS.itens = POS.dia ? await consultarTudo(`vw_est_posicao?select=*&unidade=eq.${encodeURIComponent(POS.unidade)}&dia=eq.${POS.dia}`) : [];
  posRender();
}
function posOrdenarPor(col) {
  if (POS.ord === col) POS.desc = !POS.desc;
  else { POS.ord = col; POS.desc = ['saldo', 'custo_unitario', 'valor'].includes(col); }
  posRender();
}
function posRender() {
  const alvo = document.getElementById('view-posicao');
  if (!alvo || !POS) return;
  const dm = (s) => s ? String(s).slice(8, 10) + '/' + String(s).slice(5, 7) : '—';
  const sel = 'background:var(--surface-2); border:1px solid var(--line); border-radius:8px; color:var(--tx-1); padding:6px 8px; font:inherit;';
  // 07/11/2026 (auditoria dos números, lote 2, operacao-6): loja sem foto (a foto só existe depois da primeira contagem
  // fechada) mostrava "R$ 0,00 · em 0 itens", Curva A 0% e "Sem custo 0" em verde — parecia estoque zerado e tudo certo.
  if (!(POS.dias || []).length) {
    alvo.innerHTML = `<div class="section-label" style="border-top:none; margin-top:0; padding-top:0;">Posição de estoque — ${trEscH(estNomeLoja(POS.unidade))}</div>
      <div class="contexto" style="border-color:var(--farol-perto);">Sem posição para ${trEscH(estNomeLoja(POS.unidade))}: a primeira contagem da loja ainda não fechou. O valor parado aparece a partir dela.</div>`;
    return;
  }
  const D = (POS.dias || []).find((d) => d.dia === POS.dia) || {};
  const k = (POS.dias || []).findIndex((d) => d.dia === POS.dia);
  const ant = k > 0 ? POS.dias[k - 1] : null;
  const varTxt = ant ? (() => { const v = Number(D.valor) - Number(ant.valor); return Math.abs(v) < 0.5 ? 'igual ao dia anterior' : `${v > 0 ? 'subiu' : 'caiu'} R$ ${fmt(Math.abs(v))} desde ${dm(ant.dia)}`; })() : 'primeiro dia do histórico';
  const busca = (POS.busca || '').trim().toUpperCase();
  const itens = (POS.itens || []).filter((i) => (!busca || String(i.nome_base).toUpperCase().includes(busca))
      && (!POS.curva || i.curva === POS.curva) && (!POS.grupo || (POS.grupo === '__fora' ? !i.grupo : i.grupo === POS.grupo))
      // "sem custo" que tira do total = sem valor E com mercadoria (Estoque, 22/10: sem custo com saldo zero não tira um centavo)
      && (!POS.semCusto || (i.valor == null && Number(i.saldo || 0) !== 0))
      && (!POS.soNeg || Number(i.saldo) < 0))
    .sort((a, b) => {
      const num = ['saldo', 'custo_unitario', 'valor'].includes(POS.ord);
      const va = a[POS.ord], vb = b[POS.ord];
      const r = num ? (va == null ? -Infinity : Number(va)) - (vb == null ? -Infinity : Number(vb)) : String(va || '').localeCompare(String(vb || ''), 'pt-BR');
      return (POS.desc ? -r : r) || Number(b.valor || 0) - Number(a.valor || 0);   // empate: maior valor primeiro (dono, 22/10)
    });
  // 07/11/2026 (auditoria operacao-7, Estoque): o valor parado soma só o saldo positivo; o negativo vem à parte (valor_negativo)
  const grupos = [...new Set((POS.itens || []).map((i) => i.grupo).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'pt-BR'));
  const comValor = Number(D.itens || 0) - Number(D.itens_sem_valor || 0);
  const semCustoN = Number(D.itens_sem_custo_com_saldo != null ? D.itens_sem_custo_com_saldo : D.itens_sem_valor || 0);
  // 12/11/2026 (auditoria 07/11, operacao-25): as legendas viraram dica (title) ou saíram; fica a das cores, numa linha
  let h = `<div class="section-label" style="border-top:none; margin-top:0; padding-top:0;" title="saldo do sistema × custo da nossa base, numa foto por dia">Posição de estoque — ${trEscH(estNomeLoja(POS.unidade))} · ${dm(POS.dia)}</div>
    <div class="cards${Number(D.valor_negativo) < 0 ? '' : ' cards-3'}">
      <div class="card neutral"><div class="card-lbl">Valor parado</div><div class="card-val">R$ ${fmt(Number(D.valor || 0))}</div><div class="card-pct">em ${comValor} itens · ${varTxt}</div></div>
      <div class="card neutral"><div class="card-lbl">Curva A</div><div class="card-val">R$ ${fmt(Number(D.valor_curva_a || 0))}</div><div class="card-pct">${D.valor ? Math.round(100 * Number(D.valor_curva_a) / Number(D.valor)) : 0}% do valor parado</div></div>
      <div class="card ${semCustoN ? 'highlight' : 'pos'}" style="cursor:pointer;" onclick="POS.semCusto=true; POS.ord='valor'; POS.desc=true; posRender();" title="ver a lista">
        <div class="card-lbl">Sem custo na base</div><div class="card-val">${semCustoN}</div>
        <div class="card-pct">com mercadoria, fora do total · ver a lista</div></div>
      ${Number(D.valor_negativo) < 0 ? `<div class="card neg" style="cursor:pointer;" onclick="POS.soNeg=true; POS.ord='valor'; POS.desc=false; posRender();" title="ver a lista">
        <div class="card-lbl">Saldo negativo</div><div class="card-val">−R$ ${fmt(Math.abs(Number(D.valor_negativo)))}</div>
        <div class="card-pct">em ${Number(D.itens_negativos || 0)} ${Number(D.itens_negativos) === 1 ? 'item' : 'itens'} · entrada ou produção a lançar · ver a lista</div></div>` : ''}
    </div>`;
  // histórico: uma linha por dia
  h += `<div id="tabelaPosicaoDias"><table><thead><tr><th title="o histórico começa em 21/10, o primeiro dia com a contagem como ponto de partida">Dia</th><th title="remontada: dia refeito com o custo de hoje, então a diferença é só de quantidade">Foto</th><th style="text-align:right;">Valor parado</th><th style="text-align:right;">Curva A</th><th style="text-align:right;">Sem custo, com mercadoria</th><th>Saldo negativo</th></tr></thead><tbody>`;
  (POS.dias || []).slice().reverse().forEach((d) => {
    h += `<tr style="cursor:pointer;${d.dia === POS.dia ? ' background:var(--surface-2);' : ''}" onclick="POS.dia='${d.dia}'; posCarregarItens();" title="ver a foto deste dia">
      <td><b>${dm(d.dia)}</b></td>
      <td style="color:var(--tx-4);" title="${d.origem === 'DIA' ? 'foto tirada no próprio dia' : 'remontado do extrato com o custo de hoje: a variação é só de quantidade'}">${d.origem === 'DIA' ? 'do dia' : 'remontada'}</td>
      <td style="text-align:right;">R$ ${fmt(Number(d.valor))}</td><td style="text-align:right;">R$ ${fmt(Number(d.valor_curva_a))}</td>
      <td style="text-align:right;">${Number(d.itens_sem_custo_com_saldo != null ? d.itens_sem_custo_com_saldo : d.itens_sem_valor)}</td>
      <td style="${Number(d.valor_negativo) < 0 ? 'color:var(--farol-fora);' : 'color:var(--tx-5);'}">${Number(d.valor_negativo) < 0 ? `−R$ ${fmt(Math.abs(Number(d.valor_negativo)))} · ${Number(d.itens_negativos || 0)}` : '—'}</td></tr>`;
  });
  h += `</tbody></table></div>`;
  h += `<div class="contexto" style="display:flex; gap:10px; align-items:center; flex-wrap:wrap;">
      <span>Loja <b>${trEscH(estNomeLoja(POS.unidade))}</b></span>
      <input id="posBusca" placeholder="Procurar item…" value="${trEscH(POS.busca || '')}" oninput="POS.busca=this.value; posRender(); const c=document.getElementById('posBusca'); if (c) { c.focus(); c.setSelectionRange(c.value.length, c.value.length); }" style="flex:1 1 200px; ${sel}">
      <select onchange="POS.curva=this.value; POS.ord='valor'; POS.desc=true; posRender();" style="${sel}"><option value="">curva: todas</option>${['A', 'B', 'C'].map((c) => `<option${c === POS.curva ? ' selected' : ''}>${c}</option>`).join('')}</select>
      <select onchange="POS.grupo=this.value; POS.ord='valor'; POS.desc=true; posRender();" style="${sel}"><option value="">grupo: todos</option>${grupos.map((g) => `<option${g === POS.grupo ? ' selected' : ''}>${trEscH(g)}</option>`).join('')}<option value="__fora"${POS.grupo === '__fora' ? ' selected' : ''}>fora da folha de contagem</option></select>
      <label style="display:flex; gap:6px; align-items:center;"><input type="checkbox"${POS.soNeg ? ' checked' : ''} onchange="POS.soNeg=this.checked; posRender();"> só saldo negativo</label>
      <label style="display:flex; gap:6px; align-items:center;"><input type="checkbox"${POS.semCusto ? ' checked' : ''} onchange="POS.semCusto=this.checked; POS.ord='valor'; POS.desc=true; posRender();"> só sem custo</label>
      <span class="caption-label">${itens.length} de ${(POS.itens || []).length}</span>
    </div>`;
  const th = (col, rot, dir) => `<th style="cursor:pointer;${dir ? ' text-align:right;' : ''}" onclick="posOrdenarPor('${col}')" title="ordenar">${rot}${POS.ord === col ? (POS.desc ? ' ▼' : ' ▲') : ''}</th>`;
  h += `<div id="tabelaPosicaoItens"><table><thead><tr>${th('nome_base', 'Item')}${th('curva', 'Curva')}${th('grupo', 'Grupo')}${th('saldo', 'Saldo', 1)}${th('custo_unitario', 'Custo', 1)}${th('valor', 'Valor parado', 1)}</tr></thead><tbody>`;
  itens.forEach((i) => {
    const neg = Number(i.valor) < 0;
    const cor = i.valor == null ? '' : neg ? ' color:var(--farol-fora);' : i.custo_confiavel === false ? ' color:var(--farol-perto);' : '';
    h += `<tr><td><b>${trEscH(i.nome_base)}</b></td><td>${trEscH(i.curva || '')}</td><td style="color:var(--tx-4);">${i.grupo ? trEscH(i.grupo) : '<i>fora da folha</i>'}</td>
      <td style="text-align:right; white-space:nowrap;${Number(i.saldo) < 0 ? ' color:var(--farol-fora);' : ''}">${ctlNum(i.saldo, i.un)} <span style="color:var(--tx-4); font-size:11px;">${trEscH(i.un || '')}</span></td>
      <td style="text-align:right;">${i.custo_unitario == null ? '' : 'R$ ' + fmt(Number(i.custo_unitario))}</td>
      <td style="text-align:right;${cor}"${i.valor == null ? ' title="sem custo na nossa base — fora do total"' : i.custo_confiavel === false ? ' title="custo ainda não confiável em alguma etiqueta"' : ''}>${i.valor == null ? '<span style="color:var(--tx-5);">sem custo</span>' : '<b>R$ ' + fmt(Number(i.valor)) + '</b>'}</td></tr>`;
  });
  h += `</tbody></table></div>
    <div class="caption-label" style="text-align:left;">Âmbar: custo ainda não confiável · vermelho: saldo negativo (em geral, produção não apontada).</div>`;
  alvo.innerHTML = h;
}

function prdAlvo() { return document.getElementById(EST_TELA === 'ordens' ? 'view-ordens' : 'view-producao'); }
async function entrarApontar() { EST_TELA = 'producao'; return entrarProducao(); }
async function entrarProducao() {
  if (EST_TELA !== 'ordens') EST_TELA = 'producao';
  const alvo = prdAlvo();
  if (!alvo) return;
  const sessao = rmbSessao();
  if (!sessao) { alvo.innerHTML = `<div class="contexto">Entre no painel para apontar produção.</div>`; return; }
  alvo.innerHTML = `<div class="contexto">Carregando…</div>`;
  try {
    if (!PRD || !PRD.papel) {
      const [rp, ru] = await Promise.all([trRpc('tr_meu_papel'), trRpc('tr_minha_unidade')]);
      const papel = rp.ok ? await rp.json() : null;
      // 02/11/2026: o Habrahan e os líderes operam a produção sem papel em tr_usuarios (o banco confere em cada ação)
      let opera = !!papel;
      if (!opera) {
        const [ro, rl] = await Promise.all([trRpc('est_pode_operar_producao'), trRpc('rh_eu_lider')]);
        opera = (ro.ok && (await ro.json()) === true) || (rl.ok && (await rl.json()).length > 0);
      }
      if (!opera) {
        alvo.innerHTML = `<div class="contexto">Você está logado como <b>${sessao.email}</b>, mas este login ainda
          não tem papel na operação — sem isso o banco não aceita o apontamento. Quem cadastra é o Neto, em <b>tr_usuarios</b>.</div>`;
        return;
      }
      PRD = { papel: papel || 'OPERA', unidade: null,
              data: prdHoje(), busca: '', aberta: null, ingredientes: {} };
    }
    const uT = await estLojaDaTela(alvo, EST_TELA === 'ordens' ? entrarOrdens : entrarApontar); if (!uT) return;
    if (PRD.unidade !== uT) { PRD.unidade = uT; PRD.aberta = null; PRD.ingredientes = {}; }
    await prdCarregar();
  } catch (e) {
    alvo.innerHTML = `<div class="contexto" style="border-color:var(--farol-fora);">Não consegui abrir a tela: ${e.message}</div>`;
  }
}

async function prdCarregar() {
  await estNomesCarregar();
  const u = encodeURIComponent(PRD.unidade);
  const [receitas, lancamentos, base, move, perdas, itensEst, naHora] = await Promise.all([
    consultarTudo(`vw_est_producao_receita?select=*&unidade=eq.${u}&order=receita.asc`),
    // 21/10/2026: o lote com perda, entrou no estoque, planejado, rendimento e a marca de corrigida (vw_est_producao_lote)
    consultarTudo(`vw_est_producao_lote?select=*&unidade=eq.${u}&data=eq.${PRD.data}&order=criado_em.desc`),
    // 22/10/2026 (dono): só RECEITA da base em uso; água, refri e brownie de revenda tinham "ficha" de si mesmos
    consultarTudo('ft_receita_base?select=nome_base,grupo_receita,nao_usa&order=nome_base'),
    // 24/10/2026 (Estoque): por receita, se apontar move o saldo e por quê; e se é receita de fato (a regra é do banco)
    consultarTudo(`vw_est_receita_move?select=nome_base,move,motivo,e_receita&unidade=eq.${u}&order=nome_base`).catch(() => null),
    // 24/10/2026: perda fora da produção (estragou, venceu, caiu, voltou do salão) registrada no dia
    consultarTudo(`vw_est_perda?select=*&unidade=eq.${u}&data=eq.${PRD.data}&order=criado_em.desc`).catch(() => null),
    PRD.itensEst ? Promise.resolve(PRD.itensEst)
      : consultarTudo(`vw_est_controle_item?select=nome_base,un,saldo_hoje,fora_da_base&unidade=eq.${u}&order=nome_base`).catch(() => null),
    // 12/11/2026 (Estoque): "feita na hora" é a regra do motor, por loja (FICHA: e sem item de estoque NA LOJA)
    consultarTudo(`vw_est_receita_feita_na_hora?select=nome_base,rotulo&unidade=eq.${u}`).catch(() => []),
  ]);
  const grupoDe = new Map(base.filter((b) => !b.nao_usa && b.nome_base).map((b) => [b.nome_base, b.grupo_receita || 'SEM GRUPO']));
  const moveDe = move && move.length ? new Map(move.map((m) => [m.nome_base, m])) : null;
  PRD.receitas = receitas.filter((r) => grupoDe.has(r.nome_base) && !(moveDe && moveDe.get(r.nome_base) && moveDe.get(r.nome_base).e_receita === false))
    .map((r) => { const m = moveDe && moveDe.get(r.nome_base); return { ...r, grupo: grupoDe.get(r.nome_base), move: m ? m.move : null, move_motivo: m ? m.motivo : null }; });
  // 12/11/2026 (Estoque, proposta 2026-11-12-apontar-feito-na-hora): a venda já baixa a matéria-prima dessas receitas.
  // Apontar vale para o plano e o rendimento, sem mexer no saldo: etiqueta, sem alerta. Quem decide é a view (por loja).
  PRD.naHora = new Set((Array.isArray(naHora) ? naHora : []).map((x) => x.nome_base));
  PRD.perdas = perdas;
  PRD.itensEst = itensEst;
  PRD.lancamentos = lancamentos;
  await Promise.all([prdOrdensCarregar(), estFilaCarregar(PRD.unidade)]);
  prdRender();
}

function prdOrdensTela() {
  const alvo = prdAlvo();
  let h = `<h2>Ordens de produção</h2>` + estFilaHtml();
  h += prdOrdensHtml();
  alvo.innerHTML = h;
}
function prdRender() {
  if (EST_TELA === 'ordens') return prdOrdensTela();
  const alvo = prdAlvo();
  const foco = document.activeElement && document.activeElement.id === 'prdBusca'
    ? document.activeElement.selectionStart : null;
  prdGuardarDigitado();
  const busca = (PRD.busca || '').trim().toLowerCase();
  const lista = PRD.receitas.filter((r) => (!PRD.grupo || r.grupo === PRD.grupo)
    && (!busca || r.receita.toLowerCase().includes(busca) || (r.nome_base || '').toLowerCase().includes(busca)));
  const parciais = PRD.receitas.filter((r) => Number(r.ingredientes_fora_do_estoque || 0) > 0);
  const hoje = prdHoje();
  const email = ((rmbSessao() || {}).email || '').toLowerCase();

  // 12/11/2026 (auditoria 07/11): saem a legenda do topo e o card "Receitas da casa" (inventário, não ação; a contagem
  // continua no botão "todas N" da grade)
  let h = `<h2>Apontar produção</h2>` + estFilaHtml();

  h += `<div class="cards">
      <div class="card ${PRD.lancamentos.length ? 'pos' : 'neutral'}"><div class="card-lbl">Apontado no dia</div>
        <div class="card-val">${PRD.lancamentos.length}</div>
        <div class="card-pct">${PRD.data === hoje ? 'hoje' : PRD.data.split('-').reverse().join('/')}</div></div>
      <div class="card ${parciais.length ? 'highlight' : 'pos'}"><div class="card-lbl">Baixam só em parte</div>
        <div class="card-val">${parciais.length}</div>
        <div class="card-pct">receita com ingrediente fora do estoque</div></div>
    </div>`;

  h += `<div class="contexto" style="display:flex; gap:10px; align-items:center; flex-wrap:wrap;">
      <b>${PRD.unidade}</b>
      <label style="display:flex; gap:6px; align-items:center;">Dia
        <input type="date" value="${PRD.data}" min="${prdDiasAtras(7)}" max="${prdHoje()}"
               onchange="PRD.data=this.value; prdCarregar();"
               style="background:var(--p-paper, var(--surface-2)); border:1px solid var(--p-line, var(--line)); border-radius:8px; color:var(--p-ink, var(--tx-1)); padding:6px 8px;"></label>
      <input id="prdBusca" placeholder="Procurar receita…" value="${(PRD.busca || '').replace(/"/g, '&quot;')}"
             oninput="PRD.busca=this.value; prdRender();"
             style="flex:1 1 200px; background:var(--p-paper, var(--surface-2)); border:1px solid var(--p-line, var(--line)); border-radius:8px; color:var(--p-ink, var(--tx-1)); padding:6px 10px;">
    </div>`;

  // 27/10/2026 (dono): as ordens moram na tela Ordens; aqui só o aviso de que há ordem viva
  const vivas = ((PRD.ordens && PRD.ordens.rel) || []).filter((o) => PRD_ORD_VIVA.includes(o.situacao));
  if (vivas.length) h += `<div class="contexto" style="text-align:left;">${vivas.length} ${vivas.length === 1 ? 'ordem aberta' : 'ordens abertas'}
      (${vivas.map((o) => trEscH(o.numero)).join(', ')}): o que nasceu de ordem se aponta na própria ordem.
      <button class="preset-btn active" onclick="mostrarModulo('ordens')">Abrir Ordens ›</button></div>`;

  if (PRD.lancamentos.length) {
    // 21/10/2026: produziu, perdeu, entrou no estoque e o rendimento contra o planejado; corrigir = linha nova que
    // substitui esta (a original fica riscada, fora do saldo). Uma correcao por linha; correcao nao se corrige.
    const nomeR = (rec) => (PRD.receitas.find((x) => x.receita === rec) || {}).nome_base || rec;
    h += `<div class="section-label">Já apontado neste dia</div>
      <div id="tabelaPrdLotes" style="overflow-x:auto;"><table><thead><tr><th>Receita</th><th>Produziu</th><th>Perdeu</th><th>Entrou no estoque</th>
        <th>Planejado</th><th>Rendimento</th><th>Quem</th><th></th></tr></thead><tbody>`;
    PRD.lancamentos.forEach((l) => {
      const meu = (l.quem || '').toLowerCase() === email;
      const horas = (Date.now() - new Date(l.criado_em).getTime()) / 3600000;
      const risca = l.fora_da_conta ? ' style="opacity:.5; text-decoration:line-through;"' : '';
      const rend = l.rendimento_pct == null ? '—' : `${String(Math.round(Number(l.rendimento_pct) * 10) / 10).replace('.', ',')}%`;
      const corRend = l.situacao_rendimento && /ABAIXO|ACIMA/.test(l.situacao_rendimento) ? 'var(--farol-perto)' : 'var(--tx-2)';
      const podeCorrigir = !l.fora_da_conta && !l.corrige_id && !l.corrigida_por;
      h += `<tr${risca}><td>${nomeR(l.receita)}${l.corrige_id ? ` <span style="color:var(--tx-5); font-size:11px;">correção da linha ${l.corrige_id}</span>` : ''}${l.fora_da_conta ? ` <span style="color:var(--tx-5); font-size:11px;">corrigida</span>` : ''}${l.observacao ? ` <span style="color:var(--tx-5);">· ${l.observacao}</span>` : ''}</td>
        <td>${fmt(Number(l.produziu))} ${l.un || ''}</td>
        <td>${Number(l.perdeu) ? `${fmt(Number(l.perdeu))} <span style="color:var(--tx-5); font-size:11px;">${(l.perda_motivo || '').toLowerCase()}</span>` : '—'}</td>
        <td>${fmt(Number(l.entrou_no_estoque))}</td>
        <td>${l.planejado == null ? '—' : fmt(Number(l.planejado))}</td>
        <td style="color:${corRend};" title="${l.situacao_rendimento || ''}">${rend}</td>
        <td style="color:var(--tx-5);">${estNome(l.quem)}</td>
        <td style="white-space:nowrap;">${podeCorrigir ? `<button class="preset-btn" onclick="prdCorrigirAbrir(${l.id})">corrigir</button>` : ''}
          ${meu && horas < 12 && !l.corrige_id && !l.corrigida_por ? `<button class="preset-btn" onclick="prdDesfazer(${l.id})">desfazer</button>` : ''}</td></tr>`;
      if (PRD.corrigindo === l.id) {
        h += `<tr><td colspan="8" style="background:var(--p-paper, var(--surface-2));"><div style="display:flex; flex-wrap:wrap; gap:8px; align-items:center;">
          <b>Corrigir:</b> produziu <input type="number" step="0.001" min="0" inputmode="decimal" id="prdC_q" value="${Number(l.produziu)}" style="width:100px; background:var(--p-paper, var(--surface-2)); border:1px solid var(--p-line, var(--line)); border-radius:8px; color:var(--p-ink, var(--tx-1)); padding:6px 8px;">
          perdeu <input type="number" step="0.001" min="0" inputmode="decimal" id="prdC_p" value="${Number(l.perdeu) || ''}" style="width:90px; background:var(--p-paper, var(--surface-2)); border:1px solid var(--p-line, var(--line)); border-radius:8px; color:var(--p-ink, var(--tx-1)); padding:6px 8px;">
          ${prdMotivoSelect('prdC_m', l.perda_motivo)}
          <input id="prdC_o" placeholder="por que corrigir (obrigatório)" style="flex:1 1 180px; background:var(--p-paper, var(--surface-2)); border:1px solid var(--p-line, var(--line)); border-radius:8px; color:var(--p-ink, var(--tx-1)); padding:6px 8px;">
          <button class="preset-btn" onclick="prdCorrigirGravar(${l.id})">gravar correção</button>
          <button class="preset-btn" onclick="PRD.corrigindo=null; prdRender();">cancelar</button></div>
          <div class="caption-label" style="text-align:left; margin-top:4px;">A linha original fica guardada e sai do saldo; a correção entra no lugar dela. Cada linha só se corrige uma vez.</div></td></tr>`;
      }
    });
    h += `</tbody></table></div>`;
  }

  // 22/10/2026 (dono): por grupo da base (PRODUCAO, PRATOS, LANCHES), filtro pelo mesmo grupo e toda coluna ordenável
  const GRP = [['PRODUCAO', 'Produção'], ['PRATOS', 'Pratos'], ['LANCHES', 'Lanches']];
  const nomeGrp = (g) => (GRP.find((x) => x[0] === g) || [g, g])[1];
  const nGrp = (g) => PRD.receitas.filter((r) => r.grupo === g).length;
  const gruposTodos = [...new Set(PRD.receitas.map((r) => r.grupo))]
    .sort((a, b) => (GRP.findIndex((x) => x[0] === a) + 99) % 99 - (GRP.findIndex((x) => x[0] === b) + 99) % 99 || a.localeCompare(b));
  const ord = PRD.ordem || { col: 'receita', asc: true };
  const valOrd = (r) => ({ receita: r.nome_base || r.receita, un: r.un || '', rende: Number(r.rendimento) || 0,
    ingredientes: Number(r.ingredientes) || 0, custo: Number(r.custo_un) || 0,
    ultima: r.ultima_producao || '' })[ord.col];
  const cmp = (a, b) => {
    const x = valOrd(a), y = valOrd(b);
    const c = typeof x === 'number' ? x - y : String(x).localeCompare(String(y), 'pt-BR');
    return (ord.asc ? c : -c) || (a.nome_base || a.receita).localeCompare(b.nome_base || b.receita, 'pt-BR');
  };
  const th = (col, rot) => `<th style="cursor:pointer; white-space:nowrap; user-select:none;" onclick="prdOrdenar('${col}')"
      title="clique para ordenar por ${rot.toLowerCase()}">${rot} <span style="color:${ord.col === col ? 'var(--info)' : 'var(--tx-5)'}; font-size:11px;">${
      ord.col === col ? (ord.asc ? '▲' : '▼') : '⇅'}</span></th>`;
  const qtd = (v) => { const n = Number(v); return Number.isInteger(n) ? String(n) : fmt(n); };
  const campo = 'background:var(--p-paper, var(--surface-2)); border:1px solid var(--p-line, var(--line)); border-radius:8px; color:var(--p-ink, var(--tx-1)); padding:5px 8px;';
  h += `<div class="section-label">O que a cozinha produziu — sem precisar de ordem</div>
    <div class="caption-label">Fora de ordem: digite quanto saiu e toque em Apontar (o que nasceu de ordem se aponta na tela Ordens) · toque na receita para ver a ficha e o custo.</div>
    <div style="text-align:center; margin:8px 0 10px;">
      <button class="preset-btn ${PRD.grupo ? '' : 'active'}" onclick="PRD.grupo=null; prdRender();">todas ${PRD.receitas.length}</button>
      ${gruposTodos.map((g) => `<button class="preset-btn ${PRD.grupo === g ? 'active' : ''}" onclick="PRD.grupo='${g}'; prdRender();">${nomeGrp(g)} ${nGrp(g)}</button>`).join(' ')}
    </div>
    <div id="tabelaPrdGrade" style="overflow-x:auto;"><table><thead><tr>${th('receita', 'Receita')}${th('rende', 'Rende')}
      ${th('ultima', 'Última vez')}
      <th style="white-space:nowrap;" title="o que veio do plano (ou o lote da ficha); troque se o plano do dia for outro">Planejado</th>
      <th style="white-space:nowrap;">Produziu</th><th style="white-space:nowrap;" title="só se houve perda: quanto e o motivo">Perdeu</th><th></th></tr></thead><tbody>`;
  (PRD.grupo ? [PRD.grupo] : gruposTodos).forEach((g) => {
    const doGrupo = lista.filter((r) => r.grupo === g).sort(cmp);
    if (!doGrupo.length) return;
    h += `<tr class="grp"><td colspan="7" style="font-weight:800; letter-spacing:.5px;">${nomeGrp(g).toUpperCase()}
        <span style="color:var(--tx-4); font-weight:400;">· ${doGrupo.length} ${doGrupo.length === 1 ? 'receita' : 'receitas'}</span></td></tr>`;
  doGrupo.forEach((r) => {
    const id = prdId(r.receita);
    const dias = r.ultima_producao
      ? Math.round((new Date(hoje + 'T12:00:00') - new Date(r.ultima_producao + 'T12:00:00')) / 86400000) : null;
    h += `<tr><td style="min-width:180px;"><a href="#" onclick="prdVer(${prdTxt(r.receita)}); return false;" style="color:var(--p-ink, var(--tx-1)); text-decoration:none; font-weight:600; font-size:13px;"
          title="ver o que sai do estoque">${r.nome_base || r.receita}</a>
        ${prdNaHora(r.nome_base) ? prdNaHoraTag() : Number(r.ingredientes_fora_do_estoque || 0) > 0
          ? `<div style="color:var(--farol-perto); font-size:11px;" title="Ao apontar, esses ingredientes não saem do estoque: não têm linha de estoque (falta o de/para). Toque na receita para ver quais.">${
              r.ingredientes_fora_do_estoque} ${Number(r.ingredientes_fora_do_estoque) === 1 ? 'ingrediente' : 'ingredientes'} sem estoque</div>` : ''}
        ${r.move === false && !prdNaHora(r.nome_base) ? `<div style="color:var(--farol-perto); font-size:11px;" title="Apontar esta receita fica registrado, mas não mexe no saldo: nem entra a receita nem saem os ingredientes.">não mexe no saldo · ${trEscH(r.move_motivo || '')}</div>` : ''}</td>
      <td style="white-space:nowrap;">${r.rendimento ? qtd(r.rendimento) : '—'} <span style="color:var(--tx-4); font-size:11px;">${r.un || ''}</span></td>
      <td style="color:var(--tx-5); font-size:12px; line-height:1.2;${dias === null ? ' opacity:.6;' : ' white-space:nowrap;'}">${dias === null ? 'nunca apontada' : dias === 0 ? 'hoje' : dias === 1 ? 'ontem' : `há ${dias} dias`}</td>
      <td><input type="number" step="0.001" min="0" inputmode="decimal" id="${id}_pl" value="${r.rendimento ? Math.round(Number(r.rendimento) * 100) / 100 : ''}"
           title="o que veio do plano (ou o lote da ficha); troque se o plano do dia for outro"
           style="width:74px; background:transparent; border:1px dashed var(--line); border-radius:8px; color:var(--tx-4); padding:5px 8px;"></td>
      <td><input type="number" step="0.001" min="0" inputmode="decimal" id="${id}"
           onkeydown="if(event.key==='Enter'){prdApontar(${prdTxt(r.receita)}, ${prdTxt(r.un)});}"
           style="width:76px; background:var(--p-paper, var(--surface-2)); border:1px solid var(--info); border-radius:8px; color:var(--p-ink, var(--tx-1)); padding:5px 8px; font-weight:700;"></td>
      <td style="white-space:nowrap;"><input type="number" step="0.001" min="0" inputmode="decimal" id="${id}_p" placeholder="0"
           style="width:48px; ${campo}"> ${prdMotivoSelect(id + '_m', null).replace('padding:6px 8px;', 'padding:5px 2px; width:86px; color:var(--tx-4);')}</td>
      <td><button class="preset-btn" onclick="prdApontar(${prdTxt(r.receita)}, ${prdTxt(r.un)})">Apontar</button></td></tr>`;
    if (PRD.aberta === r.receita) {
      const ing = PRD.ingredientes[r.receita];
      h += `<tr><td colspan="7" style="background:var(--p-paper, var(--surface-2));">`;
      // 12/11/2026 (auditoria 07/11): custo e nº de ingredientes saíram da grade e moram aqui, a um toque
      h += `<div class="caption-label" style="text-align:left;">Custo por ${trEscH(r.un || 'unidade')}: <b>${r.custo_un == null ? '—' : 'R$ ' + fmt(Number(r.custo_un))}</b>
        · ${r.ingredientes == null ? '—' : r.ingredientes} ${Number(r.ingredientes) === 1 ? 'ingrediente' : 'ingredientes'} na ficha</div>`;
      if (!ing) h += `<span style="color:var(--tx-5);">carregando a ficha…</span>`;
      else if (!ing.length) h += `<span style="color:var(--tx-5);">esta receita não tem ingrediente na ficha — nada sai do estoque.</span>`;
      else {
        h += `<div class="caption-label">Por 1 ${r.un || 'unidade'} produzido sai:</div>`;
        h += ing.map((i) => `<div>${i.no_estoque ? '' : '<span style="color:var(--farol-perto);">fora do estoque · </span>'}${i.materia_prima_nome_base || i.materia_prima}
             <b>${fmt(i.qtd_por_unidade)}</b> ${(i.un || '').toLowerCase()}</div>`).join('');
      }
      h += `</td></tr>`;
    }
  });
  });
  h += `</tbody></table></div>`;
  if (!lista.length) h += `<div class="contexto">Nenhuma receita com esse nome${PRD.grupo ? ' neste grupo' : ''}.</div>`;

  h += prdPerdaHtml();
  // 27/10/2026 (dono): o histórico dos apontamentos; correção aparece riscada, nunca some
  alvo.innerHTML = h;
  prdDevolverDigitado();
  if (foco !== null) {
    const b = document.getElementById('prdBusca');
    if (b) { b.focus(); try { b.setSelectionRange(foco, foco); } catch (e) {} }
  }
  prdGuia();
}
// GUIA DE PRIMEIRO ACESSO da tela Apontar produção (09/11/2026; estGuia fica junto da contagem)
function prdGuia() {
  estGuia('producao', [
    { sel: '#prdBusca', texto: '<b>Procurar receita</b>: digite parte do nome. Os botões logo abaixo filtram por grupo (Produção, Pratos, Lanches).' },
    { sel: '#tabelaPrdGrade input[onkeydown]', texto: 'Na coluna <b>Produziu</b>, digite quanto saiu pronto. Se perdeu parte, ponha em <b>Perdeu</b> com o motivo.' },
    { sel: '#tabelaPrdGrade button[onclick^="prdApontar"]', texto: '<b>Apontar</b> grava: a receita entra no estoque e os ingredientes da ficha saem. Toque no nome da receita para ver o que sai.' },
    { sel: '#tabelaPrdLotes', texto: '<b>Já apontado neste dia</b>: errou? <b>corrigir</b> troca a linha (a antiga fica riscada); <b>desfazer</b> vale para o que você lançou nas últimas 12 h.' },
    { sel: '#prdPerdaItem', texto: '<b>Perda fora da produção</b>: o que estragou, venceu, caiu ou voltou do salão. Escolha o item, quanto e o motivo, e toque em <b>Registrar perda</b>.' },
  ]);
}

function prdOrdenar(col) {
  const o = PRD.ordem || { col: 'receita', asc: true };
  // número e data começam do maior; texto começa do A
  PRD.ordem = o.col === col ? { col, asc: !o.asc } : { col, asc: col === 'receita' || col === 'un' };
  prdRender();
}
// filtrar e ordenar redesenham a grade: o que já foi digitado (produziu, perdeu, motivo, planejado trocado) volta no lugar
function prdGuardarDigitado() {
  const alvo = prdAlvo();
  if (!alvo) return;
  PRD.digitado = PRD.digitado || {};
  alvo.querySelectorAll('tbody input[id], tbody select[id]').forEach((c) => {
    if (c.id.startsWith('prdC_')) return;
    if (c.value !== c.defaultValue || c.tagName === 'SELECT') PRD.digitado[c.id] = c.value; else delete PRD.digitado[c.id];
  });
}
function prdDevolverDigitado() {
  Object.entries(PRD.digitado || {}).forEach(([id, v]) => { const c = document.getElementById(id); if (c) c.value = v; });
}

// ---- ORDENS DE PRODUÇÃO NO TOPO DO APONTAR (etapas 2 e 3 do ciclo; dono aprovou o desenho em 22/10/2026) ----
// Mostra as ordens do dia escolhido e as que ainda estão vivas (ABERTA, EM_PRODUCAO, PAUSADA) de qualquer dia: ordem
// esquecida aberta é exatamente o que o aviso de turno quer pegar. O relógio separa os três tempos de propósito.
const PRD_ORD_VIVA = ['ABERTA', 'EM_PRODUCAO', 'PAUSADA'];
async function prdOrdensCarregar() {
  const u = encodeURIComponent(PRD.unidade);
  try {
    const rel = await consultarTudo(`vw_est_ordem_relogio?select=*&unidade=eq.${u}`
      + `&situacao=in.(${PRD_ORD_VIVA.join(',')})&order=data_para,numero`);   // 27/10/2026: só as em aberto; as encerradas estão em Históricos
    const t0 = Date.now(); rel.forEach((o) => { o._t0 = t0; });
    const ids = rel.map((o) => o.id);
    const [itens, contas] = ids.length ? await Promise.all([
      consultarTudo(`vw_est_ordem_item?select=*&id_ordem=in.(${ids.join(',')})&order=nome_base`),
      consultarTudo(`vw_est_ordem?select=id,ingredientes,ingredientes_faltando,observacao&id=in.(${ids.join(',')})`),
    ]) : [[], []];
    // 26/10/2026: a família de cada ordem (uma por família de proteína; sem família = individual)
    const fam = ids.length ? await consultarTudo(`vw_est_ordem_familia?select=id,familia,e_individual,itens_finais,itens_com_fator,precisa_cortar&id=in.(${ids.join(',')})`).catch(() => []) : [];
    // o motivo de cada item final que o apontamento não confere (a ação é diferente para cada motivo)
    if (!PRD.semFator) PRD.semFator = await consultarTudo("vw_est_item_final_sem_fator?select=familia,item_final,situacao&situacao=neq.TEM FATOR&order=familia,item_final").catch(() => []);
    PRD.ordens = { rel, itens, contas: new Map(contas.map((c) => [c.id, c])), fam: new Map(fam.map((f) => [f.id, f])), sep: (PRD.ordens && PRD.ordens.sep) || {} };
  } catch (e) { PRD.ordens = { erro: e.message, rel: [], itens: [], contas: new Map(), sep: {} }; }
}
// 27/10/2026 (dono): relógio correndo em hh:mm:ss. O banco manda os segundos e se está correndo; a tela conta sozinha.
function prdHms(s) {
  if (s == null || !isFinite(s)) return '—';
  s = Math.max(0, Math.floor(s));
  return [Math.floor(s / 3600), Math.floor(s % 3600 / 60), s % 60].map((n) => String(n).padStart(2, '0')).join(':');
}
function prdRelSpan(seg, horas, correndo, t0) {
  const s = seg != null ? Number(seg) : (horas != null ? Math.round(Number(horas) * 3600) : null);
  return `<span class="prdRel" data-s="${s == null ? '' : s}" data-c="${correndo ? 1 : 0}" data-t0="${t0}">${prdHms(s)}</span>`;
}
function prdRelTique() {
  document.querySelectorAll('.prdRel').forEach((el) => {
    if (el.dataset.c !== '1' || el.dataset.s === '') return;
    el.textContent = prdHms(Number(el.dataset.s) + (Date.now() - Number(el.dataset.t0)) / 1000);
  });
}
if (!window.__prdRelTimer) window.__prdRelTimer = setInterval(prdRelTique, 1000);
function prdHoras(h) {
  if (h == null) return '—';
  const n = Number(h), hh = Math.floor(n), mm = Math.round((n - hh) * 60);
  return `${hh} h${mm ? ' ' + String(mm).padStart(2, '0') + ' min' : ''}`;
}
function prdOrdensHtml() {
  const O = PRD.ordens;
  if (!O) return '';
  if (O.erro) return `<div class="contexto" style="border-color:var(--amber-2);">Não consegui ler as ordens de produção agora: ${trEscH(O.erro)}</div>`;
  if (!O.rel.length) return `<div class="section-label">Ordens de produção</div>
    <div class="caption-label">Nenhuma ordem em aberto. A ordem nasce da lista conferida, na Separação; as encerradas estão em Históricos da produção.</div>`;
  const dm = (s) => String(s || '').slice(8, 10) + '/' + String(s || '').slice(5, 7);
  // 27/10/2026 (dono): "Encerrar" — "fechar" confundia com fechar a tela. O passo no banco continua FECHAR.
  const BOT = { ABERTA: [['INICIAR', 'Iniciar']], EM_PRODUCAO: [['PAUSAR', 'Pausar'], ['FECHAR', 'Encerrar']],
                PAUSADA: [['RETOMAR', 'Retomar'], ['FECHAR', 'Encerrar']] };
  let h = `<div class="section-label">Ordens de produção</div>
    <div class="caption-label">O relógio grande conta só o tempo de produção (horas:minutos:segundos); a pausa e o tempo desde que abriu aparecem embaixo, separados.</div>
    <div id="prdOrdMsg" style="font-size:12.5px; margin:4px 0;"></div>`;
  O.rel.forEach((o) => {
    const c = O.contas.get(o.id) || {};
    const turno = /MAIS DE UM TURNO/.test(o.leitura || '');
    const leit = String(o.leitura || '').replace('ABERTA HA MAIS DE UM TURNO: fechar', 'aberta há mais de um turno: feche a ordem')
      .replace('AINDA NAO COMECOU', 'ainda não começou').replace('EM PRODUCAO', 'em produção')
      .replace('PAUSADA', 'pausada').replace('FECHADA', 'fechada').replace('CANCELADA', 'cancelada');
    const its = O.itens.filter((i) => i.id_ordem === o.id);
    const aberta = PRD.ordAberta === o.id;
    // 27/10/2026: a ordem em produção (ou pausada) aponta dela mesma — o apontamento nasce ligado à ordem
    const viva = o.situacao === 'EM_PRODUCAO' || o.situacao === 'PAUSADA';
    const campoO = 'background:var(--p-paper, var(--surface-2)); border:1px solid var(--p-line, var(--line)); border-radius:8px; color:var(--p-ink, var(--tx-1)); padding:5px 8px;';
    h += `<div class="contexto" style="text-align:left; margin:8px 0; ${turno ? 'border-color:var(--farol-fora);' : ''}">
      <div style="display:flex; flex-wrap:wrap; gap:14px; align-items:center; justify-content:space-between;">
        <div><b style="font-size:16px;">${trEscH(o.numero)}</b> ${prdOrdemFamiliaTag(o.id)} <span style="color:var(--tx-4);">· para ${dm(o.data_para)} · ${o.receitas} ${Number(o.receitas) === 1 ? 'receita' : 'receitas'}</span>${prdOrdemFamiliaNota(o.id)}
          <div style="font-size:12px; color:${turno ? 'var(--farol-fora)' : 'var(--tx-4)'}; ${turno ? 'font-weight:700;' : ''}">${leit}${o.quem_iniciou ? ` · iniciou ${trEscH(estNome(o.quem_iniciou))}` : ''}</div></div>
        <div style="text-align:right;">
          <div style="font-size:26px; font-weight:800; line-height:1; font-variant-numeric:tabular-nums; ${o.correndo ? 'color:var(--farol-ok);' : ''}" title="tempo de produção: desde que iniciou, menos as pausas">${prdRelSpan(o.segundos_producao, o.horas_de_producao, o.correndo, o._t0)}</div>
          <div style="font-size:11.5px; color:var(--tx-4); font-variant-numeric:tabular-nums;">produção${o.correndo ? ' (correndo)' : ''} · pausada <span style="${o.pausa_correndo ? 'color:var(--farol-perto); font-weight:700;' : ''}">${prdRelSpan(o.segundos_pausada_total, o.horas_pausada, o.pausa_correndo, o._t0)}</span> · desde que abriu ${prdRelSpan(o.segundos_desde_que_abriu, o.horas_desde_que_abriu, o.correndo || o.pausa_correndo, o._t0)}</div></div>
        <div style="display:flex; gap:6px; flex-wrap:wrap;">
          ${(BOT[o.situacao] || []).map(([p, r]) => `<button class="preset-btn est-ciclo${p === 'FECHAR' ? '' : ' active'}" onclick="prdOrdemAndar(${o.id}, '${p}')">${r}</button>`).join('')}
          ${o.situacao === 'ABERTA' ? `<button class="preset-btn" onclick="prdOrdemCancelar(${o.id})" title="tira a ordem da separação; o motivo fica registrado">Cancelar</button>` : ''}
        </div></div>
      <div id="tabelaPrdOrd${o.id}" style="overflow-x:auto; margin-top:8px;"><table><thead><tr><th>Receita</th><th>A ordem manda</th><th>Já apontado</th><th>Falta apontar</th><th>Perda</th><th>Situação</th>${viva ? '<th title="quanto saiu pronto agora">Saiu agora</th><th title="só se houve perda: quanto e o motivo">Perdeu</th>' : ''}</tr></thead><tbody>
        ${its.map((i, k) => `<tr><td>${trEscH(i.nome_base)}${prdNaHora(i.nome_base) ? prdNaHoraTag() : ''}${i.familia && i.familia !== 'NENHUMA' ? ` <span style="color:var(--tx-5); font-size:11px;">família ${trEscH(i.familia)}</span>` : ''}</td>
          <td>${fmt(Number(i.qtd))} ${trEscH(i.un || '')}</td><td>${fmt(Number(i.ja_apontado || 0))}</td>
          <td style="font-weight:700;">${fmt(Number(i.falta_apontar || 0))}</td><td>${Number(i.perda_apontada) ? fmt(Number(i.perda_apontada)) : '—'}</td>
          <td style="font-size:12px; color:${i.leitura === 'APONTADO' ? 'var(--farol-ok)' : i.leitura === 'APONTADO EM PARTE' ? 'var(--farol-perto)' : 'var(--tx-4)'};">${String(i.leitura || '').toLowerCase().replace('nao', 'não')}</td>
          ${viva ? `<td style="white-space:nowrap;"><input id="prdOq_${o.id}_${k}" type="number" step="0.001" min="0" inputmode="decimal" placeholder="${Number(i.falta_apontar) > 0 ? fmt(Number(i.falta_apontar)) : ''}" style="width:84px; ${campoO}"> <span style="color:var(--tx-4); font-size:11px;">${trEscH(i.un || '')}</span></td>
          <td style="white-space:nowrap;"><input id="prdOp_${o.id}_${k}" type="number" step="0.001" min="0" inputmode="decimal" placeholder="0" style="width:64px; ${campoO}"> ${prdMotivoSelect(`prdOm_${o.id}_${k}`, null)}</td>` : ''}</tr>`).join('')
          || `<tr><td colspan="${viva ? 8 : 6}">—</td></tr>`}
      </tbody></table></div>
      ${viva && its.length ? `<div style="margin-top:6px; display:flex; gap:8px; flex-wrap:wrap; align-items:center;">
        <button class="preset-btn active est-ciclo" onclick="prdOrdemRegistrar(${o.id})">Registrar o que saiu</button>
        <span class="caption-label" style="text-align:left;">Anote quanto saiu de cada receita. Pode registrar aos poucos; o <b>Encerrar</b> grava o que estiver preenchido e fecha a ordem.</span></div>` : ''}
      <div style="margin-top:6px; display:flex; gap:8px; flex-wrap:wrap; align-items:center;">
        <button class="preset-btn" onclick="prdOrdemSep(${o.id})">${aberta ? 'Esconder a separação' : 'Ver a separação'}</button>
        <span style="font-size:12px; color:${Number(c.ingredientes_faltando) ? 'var(--farol-perto)' : 'var(--tx-4)'};">${c.ingredientes == null ? '' : `${c.ingredientes} ${Number(c.ingredientes) === 1 ? 'ingrediente' : 'ingredientes'}${Number(c.ingredientes_faltando) ? `, ${c.ingredientes_faltando} sem o suficiente no estoque` : ', todos com saldo'}`}</span></div>
      ${aberta ? prdOrdemSepHtml(o) : ''}
    </div>`;
  });
  return h;
}
const PRD_SEP_ORDEM = { 'SALDO NEGATIVO: conferir o registro': 0, 'SEM SALDO NO ESTOQUE': 1, 'ZERADO': 2, 'TEM MENOS DO QUE PRECISA': 3, 'TEM': 4 };
function prdSepCor(s) {
  return /NEGATIVO/.test(s) ? 'var(--amber-2)' : s === 'TEM' ? 'var(--farol-ok)' : 'var(--farol-perto)';
}
function prdSepTexto(s) {
  return ({ 'SALDO NEGATIVO: conferir o registro': 'saldo negativo: o registro está devendo, confira',
            'SEM SALDO NO ESTOQUE': 'sem saldo no estoque', 'ZERADO': 'zerado',
            'TEM MENOS DO QUE PRECISA': 'tem menos do que precisa', 'TEM': 'tem' })[s] || String(s || '').toLowerCase();
}
function prdOrdemSepHtml(o) {
  const sep = PRD.ordens.sep[o.id];
  if (!sep) return `<div class="caption-label" style="text-align:left;">carregando a separação…</div>`;
  if (sep.erro) return `<div class="caption-label" style="text-align:left; color:var(--farol-fora);">${trEscH(sep.erro)}</div>`;
  const l = sep.slice().sort((a, b) => (a.etapa === 'CORTE' ? 0 : 1) - (b.etapa === 'CORTE' ? 0 : 1) || (PRD_SEP_ORDEM[a.situacao] ?? 9) - (PRD_SEP_ORDEM[b.situacao] ?? 9) || a.nome_base.localeCompare(b.nome_base, 'pt-BR'));
  const custo = l.reduce((s, x) => s + (Number(x.custo) || 0), 0);
  const temCorte = l.some((x) => x.etapa === 'CORTE');
  const sub = (txt) => `<tr class="sub"><td colspan="7" style="font-weight:800; letter-spacing:.5px;">${txt}</td></tr>`;
  return `<div class="caption-label" style="text-align:left; margin-top:8px;">Uma linha por ingrediente, somando todas as receitas da família${temCorte ? '; o que passa pelo corte vem primeiro' : ''}.
      ${l.length} ${l.length === 1 ? 'item' : 'itens'} · R$ ${fmt(custo)}.
      <button class="preset-btn" onclick="prdOrdemImprimir(${o.id})">🖨️ Imprimir a separação</button></div>
    <div id="tabelaPrdSep${o.id}" style="overflow-x:auto;"><table><thead><tr><th>Ingrediente</th><th>Precisa</th><th>Tem no estoque</th><th>Falta</th><th>Custo</th><th>Situação</th><th>Para as receitas</th></tr></thead><tbody>
      ${l.map((s, k) => `${temCorte && (k === 0 || (l[k - 1].etapa === 'CORTE') !== (s.etapa === 'CORTE')) ? sub(s.etapa === 'CORTE' ? 'ANTES: O CORTE DA PROTEÍNA' : 'O RESTO DA FAMÍLIA') : ''}<tr><td>${trEscH(s.nome_base)}</td><td style="font-weight:700;">${fmt(Number(s.qtd_precisa))} ${trEscH(s.un || '')}</td>
        <td style="${Number(s.saldo) < 0 ? 'color:var(--amber-2);' : ''}">${fmt(Number(s.saldo))}</td><td>${Number(s.falta) ? fmt(Number(s.falta)) : '—'}</td>
        <td>R$ ${fmt(Number(s.custo) || 0)}</td><td style="font-size:12px; color:${prdSepCor(s.situacao)}; white-space:normal;">${prdSepTexto(s.situacao)}</td>
        <td style="font-size:11.5px; color:var(--tx-4); white-space:normal;">${trEscH(s.vem_de || '')}</td></tr>`).join('')}
    </tbody></table></div>`;
}
// 26/10/2026: a família da ordem (vw_est_ordem_familia) — etiqueta no título e o aviso do que o apontamento não confere
function prdOrdemFamiliaTag(id) {
  const f = PRD.ordens && PRD.ordens.fam && PRD.ordens.fam.get(id);
  if (!f) return '';
  return `<span style="font-size:12px; border:1px solid var(--line-2); border-radius:10px; padding:1px 8px; color:var(--tx-2);">${f.e_individual ? 'individual' : 'família ' + trEscH(String(f.familia || '').toLowerCase())}</span>`;
}
function prdOrdemFamiliaNota(id) {
  const f = PRD.ordens && PRD.ordens.fam && PRD.ordens.fam.get(id);
  if (!f) return '';
  const partes = [];
  if (f.precisa_cortar) partes.push(`antes: cortar ${trEscH(String(f.precisa_cortar).toLowerCase())}`);
  const MOT = (s) => /SEM RECEITA AMARRADA/.test(s) ? 'espera decisão do dono (corte porcionado)'
    : /NAO TEM UNIDADE/.test(s) ? 'sem linha de estoque' : /SEM FATOR/.test(s) ? 'falta medir quantas peças saem' : String(s || '').toLowerCase();
  const sem = (PRD.semFator || []).filter((x) => x.familia === f.familia);
  const lista = sem.length ? `<div style="font-size:12px; color:var(--tx-4);">O apontamento não confere: ${sem.map((x) => `${trEscH(x.item_final)} <span style="color:var(--tx-5);">(${MOT(x.situacao)})</span>`).join(' · ')}</div>` : '';
  return (partes.length ? `<div style="font-size:12px; color:var(--tx-3);">${partes.join(' · ')}</div>` : '') + lista;
}
async function prdOrdemSep(id) {
  PRD.ordAberta = PRD.ordAberta === id ? null : id;
  prdRender();
  if (PRD.ordAberta && !PRD.ordens.sep[id]) {
    try { PRD.ordens.sep[id] = await consultarTudo(`vw_est_ordem_separacao?select=*&id_ordem=eq.${id}`); }
    catch (e) { PRD.ordens.sep[id] = { erro: 'Não consegui ler a separação: ' + e.message }; }
    prdRender();
  }
}
// 29/10/2026: o aviso das ordens vai para a barra do resultado (o quadro da ordem se redesenha e apagava o recado)
function prdOrdemAvisa(t, cor) {
  avisoAcao(cor === 'var(--farol-ok)' ? 'ok' : cor === 'var(--farol-fora)' ? 'erro' : 'atencao', t);
}
async function prdOrdemAndar(id, passo) {
  const o = (PRD.ordens.rel || []).find((x) => x.id === id) || {};
  let motivo = null;
  if (passo === 'PAUSAR') {
    motivo = prompt(`Por que pausar a ${o.numero || 'ordem'}? (fica registrado)`);
    if (motivo === null) return;
    motivo = motivo.trim() || null;
  }
  // 27/10/2026 (dono): o Encerrar leva ao apontamento final — grava o que estiver preenchido e só então encerra
  if (passo === 'FECHAR') {
    const its = (PRD.ordens.itens || []).filter((i) => i.id_ordem === id);
    const preenchidos = its.filter((i, k) => ((document.getElementById(`prdOq_${id}_${k}`) || {}).value || '') !== '').length;
    const jaTem = its.some((i) => Number(i.ja_apontado) > 0);
    if (!preenchidos && !jaTem) {
      prdOrdemAvisa(`Antes de encerrar a ${o.numero || 'ordem'}, anote em "Saiu agora" quanto saiu de cada receita (ou cancele a ordem, se nada foi produzido).`, 'var(--farol-perto)');
      const c0 = document.getElementById(`prdOq_${id}_0`); if (c0) { c0.scrollIntoView({ block: 'center' }); c0.focus(); }
      return;
    }
    const faltam = its.filter((i, k) => Number(i.falta_apontar) > 0 && ((document.getElementById(`prdOq_${id}_${k}`) || {}).value || '') === '').map((i) => i.nome_base);
    if (!confirm(`Encerrar a ${o.numero || 'ordem'}?${preenchidos ? `\n\nVou registrar o que saiu de ${preenchidos} ${preenchidos === 1 ? 'receita' : 'receitas'} e parar o relógio.` : ' O relógio para aqui.'}${faltam.length ? `\n\nFica sem registro: ${faltam.join(', ')}.` : ''}`)) return;
  }
  if (!estTravar(true)) return;
  const FEITO = { INICIAR: 'iniciada', PAUSAR: 'pausada', RETOMAR: 'retomada', FECHAR: 'encerrada' };
  avisoAcao('enviando', `Registrando: ${o.numero || 'ordem'} ${FEITO[passo] || passo.toLowerCase()}…`);
  let r;
  try {
    if (passo === 'FECHAR') {
      const n = await prdOrdemGravarCampos(id);
      if (n == null) return;
    }
    r = await trRpcSeguro('est_ordem_andar', { p_id: id, p_passo: passo, p_quem: ((rmbSessao() || {}).email || ''), p_motivo: motivo });
  } catch (e) { return avisoAcao('erro', `✗ NÃO registrou: ${e.message}. Tente de novo.`, () => prdOrdemAndar(id, passo)); }
  finally { estTravar(false); }
  if (!r) return;
  if (!r.ok) return avisoAcao('erro', `✗ ${o.numero || 'A ordem'} NÃO foi ${FEITO[passo] || 'registrada'}: ${await trErroDe(r)}. Tente de novo.`, () => prdOrdemAndar(id, passo));
  avisoAcao('ok', `✓ ${o.numero || 'Ordem'} ${FEITO[passo] || 'registrada'} — às ${avisoHora()}.`);
  await prdOrdensCarregar();
  prdRender();
}
// 27/10/2026: lê os campos da ordem e grava cada receita preenchida em est_producao com id_ordem. Devolve quantas gravou,
// ou null se algum campo estava errado (o aviso já foi dado).
async function prdOrdemGravarCampos(id) {
  const its = (PRD.ordens.itens || []).filter((i) => i.id_ordem === id);
  const num = (k) => { const v = (document.getElementById(k) || {}).value; return v === '' || v == null ? null : Number(String(v).replace(',', '.')); };
  const linhas = [];
  for (let k = 0; k < its.length; k++) {
    const i = its[k];
    const qtd = num(`prdOq_${id}_${k}`), perda = num(`prdOp_${id}_${k}`);
    const motivo = (document.getElementById(`prdOm_${id}_${k}`) || {}).value || null;
    if (qtd == null && !(perda > 0)) continue;
    if (!(qtd > 0)) { avisoAcao('atencao', `! ${i.nome_base}: digite quanto saiu pronto (maior que zero).`); return null; }
    if (perda != null && (perda < 0 || perda > qtd)) { avisoAcao('atencao', `! ${i.nome_base}: a perda vai de zero até o que foi produzido.`); return null; }
    if (perda > 0 && !motivo) { avisoAcao('atencao', `! ${i.nome_base}: escolha o motivo da perda.`); return null; }
    const r = (PRD.receitas || []).find((x) => x.nome_base === i.nome_base);
    if (!r) { avisoAcao('atencao', `! ${i.nome_base}: não achei a receita desta loja para registrar.`); return null; }
    linhas.push({ p_unidade: PRD.unidade, p_data: PRD.data, p_receita: r.receita, p_qtd: qtd, p_un: i.un || r.un || null,
                  p_quem: (rmbSessao() || {}).email || null, p_perda: perda > 0 ? perda : null, p_perda_motivo: perda > 0 ? motivo : null,
                  p_planejado: Number(i.qtd) || null, p_id_ordem: id });
  }
  // pela função est_apontar (o vínculo com a ordem, a trava de clique duplo e a mensagem em português moram nela)
  let n = 0;
  for (const l of linhas) {
    const r = await trRpc('est_apontar', l);
    if (!r.ok) throw new Error(`${(its.find((i) => (PRD.receitas || []).some((x) => x.receita === l.p_receita && x.nome_base === i.nome_base)) || {}).nome_base || l.p_receita}: ${await trErroDe(r)}` + (n ? ` (${n} já ficaram registradas)` : ''));
    n++;
  }
  return n;
}
async function prdOrdemRegistrar(id) {
  if (!estTravar(true)) return;
  avisoAcao('enviando', 'Registrando o que saiu…');
  let n;
  try { n = await prdOrdemGravarCampos(id); }
  catch (e) { estTravar(false); return avisoAcao('erro', `✗ NÃO registrou: ${e.message}. Tente de novo.`, () => prdOrdemRegistrar(id)); }
  estTravar(false);
  if (n == null) return;
  if (!n) return prdOrdemAvisa('Nada preenchido: anote quanto saiu de cada receita na tabela da ordem.', 'var(--farol-perto)');
  await prdCarregar();
  avisoAcao('ok', `✓ ${n} ${n === 1 ? 'receita registrada' : 'receitas registradas'} na ordem — às ${avisoHora()}.`);
}
async function prdOrdemCancelar(id) {
  const o = (PRD.ordens.rel || []).find((x) => x.id === id) || {};
  const motivo = (prompt(`Cancelar a ${o.numero || 'ordem'}? Ela sai da separação e o motivo fica registrado.\n\nMotivo:`) || '').trim();
  if (!motivo) return;
  avisoAcao('enviando', `Cancelando a ${o.numero || 'ordem'}…`);
  const r = await trRpcSeguro('est_ordem_cancelar', { p_id: id, p_motivo: motivo });
  if (!r.ok) return avisoAcao('erro', `✗ ${o.numero || 'A ordem'} NÃO foi cancelada: ${await trErroDe(r)}. Tente de novo.`);
  avisoAcao('ok', `✓ ${o.numero || 'Ordem'} cancelada — às ${avisoHora()}.`);
  await prdOrdensCarregar();
  prdRender();
}
// a folha para levar à câmara: o número da OP no cabeçalho, uma linha por ingrediente, caixa em branco para o que foi pesado
function prdOrdemImprimir(id) {
  const o = (PRD.ordens.rel || []).find((x) => x.id === id) || {};
  const sep = (PRD.ordens.sep[id] || []).slice().sort((a, b) => (a.etapa === 'CORTE' ? 0 : 1) - (b.etapa === 'CORTE' ? 0 : 1) || (PRD_SEP_ORDEM[a.situacao] ?? 9) - (PRD_SEP_ORDEM[b.situacao] ?? 9) || a.nome_base.localeCompare(b.nome_base, 'pt-BR'));
  const famO = (PRD.ordens.fam && PRD.ordens.fam.get(id)) || {};
  const its = (PRD.ordens.itens || []).filter((i) => i.id_ordem === id);
  const w = window.open('', '_blank');
  if (!w) { alert('O navegador bloqueou a janela de impressão — libere pop-ups para este site.'); return; }
  const dm = (s) => String(s || '').slice(8, 10) + '/' + String(s || '').slice(5, 7);
  w.document.write(`<!DOCTYPE html><html><head><meta charset="utf-8"><title>${o.numero} — separação</title><style>
    body { font-family:Arial, sans-serif; color:#000; margin:18px 24px; }
    .cab { display:flex; justify-content:space-between; align-items:flex-start; border-bottom:2px solid #000; padding-bottom:6px; }
    h1 { font-size:18px; margin:0; } .cod { font-size:26px; font-weight:bold; letter-spacing:1px; }
    .sub { font-size:11.5px; color:#45443f; margin:3px 0 0; } .assina { font-size:12px; margin:10px 0 0; }
    .assina span { display:inline-block; border-bottom:1px solid #000; width:190px; margin:0 18px 0 4px; }
    table { width:100%; border-collapse:collapse; margin-top:10px; } td, th { border-bottom:1px solid #bbb; padding:5px 6px; font-size:12.5px; text-align:left; }
    th { font-size:10px; text-transform:uppercase; color:#45443f; } .q { width:92px; text-align:right; font-weight:bold; }
    .box { width:96px; border:1px solid #000 !important; height:26px; } .neg { font-weight:bold; }
    @media print { body { margin:10px 14px; } }
  </style></head><body>
    <div class="cab"><div><h1>Separação da ordem — ${PRD.unidade}${famO.familia ? ' · família ' + famO.familia : famO.e_individual ? ' · individual' : ''}</h1>
      <p class="sub">Produção de ${dm(o.data_para)} · ${sep.length} ${sep.length === 1 ? 'item' : 'itens'} · impressa em ${new Date().toLocaleString('pt-BR')}</p>
      <p class="sub"><b>A ordem:</b> ${its.map((i) => `${i.nome_base} ${fmt(Number(i.qtd))} ${i.un || ''}`).join(' · ')}</p>
      <p class="assina">Separou:<span></span>Conferiu:<span></span></p></div><div class="cod">${o.numero}</div></div>
    <table><thead><tr><th>#</th><th>Ingrediente</th><th class="q">Precisa</th><th class="q">Tem</th><th>Situação</th><th>Separado de verdade</th></tr></thead><tbody>
    ${sep.map((s, k) => `<tr><td>${k + 1}</td><td>${s.etapa === 'CORTE' ? '<b>[corte]</b> ' : ''}${s.nome_base}</td><td class="q">${fmt(Number(s.qtd_precisa))} ${s.un || ''}</td>
      <td class="q">${fmt(Number(s.saldo))}</td><td class="${/NEGATIVO/.test(s.situacao) ? 'neg' : ''}">${prdSepTexto(s.situacao)}</td><td class="box"></td></tr>`).join('')}
    </tbody></table></body></html>`);
  w.document.close();
  setTimeout(() => w.print(), 300);
}

async function prdVer(receita) {
  PRD.aberta = PRD.aberta === receita ? null : receita;
  prdRender();
  if (PRD.aberta && !PRD.ingredientes[receita]) {
    PRD.ingredientes[receita] = await consultarTudo(
      `vw_est_producao_ingrediente?select=*&receita=eq.${encodeURIComponent(receita)}&order=custo_un.desc`);
    prdRender();
  }
}

function prdNaHora(nome) { return !!(PRD && PRD.naHora && nome && PRD.naHora.has(nome)); }
function prdNaHoraTag() {
  return `<div style="color:var(--tx-4); font-size:11px;" title="No Saipos esta receita é ficha: a venda já baixa a matéria-prima. Apontar serve para o plano do dia e o rendimento, sem mexer no saldo.">feita na hora — o estoque baixa pela venda</div>`;
}
async function prdApontar(receita, un) {
  const campo = document.getElementById(prdId(receita));
  const qtd = Number((campo.value || '').replace(',', '.'));
  if (!campo.value || !isFinite(qtd) || qtd <= 0) { avisoAcao('atencao', '! Digite quanto saiu pronto, em número maior que zero.'); campo.focus(); return; }
  const r = PRD.receitas.find((x) => x.receita === receita) || {};
  if (r.rendimento && qtd > Number(r.rendimento) * 10
      && !confirm(`${fmt(qtd)} ${un || ''} é ${Math.round(qtd / Number(r.rendimento))} vezes o lote da ficha (${fmt(r.rendimento)}). Confirma?`)) return;
  // 21/10/2026: perda (opcional, com motivo, ate o produzido) e o planejado do lote
  const val = (sufixo) => { const el = document.getElementById(prdId(receita) + sufixo); return el && el.value !== '' ? Number(String(el.value).replace(',', '.')) : null; };
  const perda = val('_p'), planejado = val('_pl');
  const motivo = (document.getElementById(prdId(receita) + '_m') || {}).value || null;
  if (perda != null && (!isFinite(perda) || perda < 0 || perda > qtd)) { avisoAcao('atencao', '! A perda vai de zero até o que foi produzido.'); return; }
  if (perda > 0 && !motivo) { avisoAcao('atencao', '! Escolha o motivo da perda.'); return; }
  if (planejado != null && !(planejado > 0)) { avisoAcao('atencao', '! O planejado tem de ser maior que zero (ou deixe em branco).'); return; }
  const s = rmbSessao();
  avisoAcao('enviando', `Gravando o apontamento de ${receita}…`);
  try {
    await prdFetch('est_producao', {
      method: 'POST', extra: { Prefer: 'return=minimal' },
      body: JSON.stringify({ unidade: PRD.unidade, data: PRD.data, receita, qtd, un: un || null, quem: s.email,
                             perda: perda > 0 ? perda : null, perda_motivo: perda > 0 ? motivo : null, planejado }),
    });
  } catch (e) {
    return avisoAcao('erro', `✗ O apontamento de ${receita} NÃO gravou: ${e.message}. O número continua no campo — tente de novo.`, () => prdApontar(receita, un));
  }
  campo.value = '';
  avisoAcao('ok', `✓ Apontado: ${fmt(qtd)} ${un || ''} de ${receita}${perda > 0 ? ` (perda ${fmt(perda)})` : ''} — às ${avisoHora()}.`);
  await prdCarregar();
}

const PRD_MOTIVOS = [['QUEIMOU', 'queimou'], ['SOBROU', 'sobrou'], ['CAIU', 'caiu'], ['DEVOLUCAO', 'devolução'],
                     ['VALIDADE', 'validade'], ['ERRO DE RECEITA', 'erro de receita'], ['OUTRO', 'outro']];   // a lista do banco
function prdMotivoSelect(id, atual) {
  return `<select id="${id}" style="background:var(--p-paper, var(--surface-2)); border:1px solid var(--p-line, var(--line)); border-radius:8px; color:var(--p-ink, var(--tx-1)); padding:6px 8px;"><option value="">motivo</option>${PRD_MOTIVOS.map(([v, r]) =>
    `<option value="${v}"${v === atual ? ' selected' : ''}>${r}</option>`).join('')}</select>`;
}
function prdCorrigirAbrir(id) { PRD.corrigindo = PRD.corrigindo === id ? null : id; prdRender(); }
async function prdCorrigirGravar(id) {
  const l = (PRD.lancamentos || []).find((x) => x.id === id);
  if (!l) return;
  const num = (k) => { const v = (document.getElementById(k) || {}).value; return v === '' || v == null ? null : Number(String(v).replace(',', '.')); };
  const qtd = num('prdC_q'), perda = num('prdC_p');
  const motivo = (document.getElementById('prdC_m') || {}).value || null;
  const porque = ((document.getElementById('prdC_o') || {}).value || '').trim();
  if (!(qtd > 0)) { avisoAcao('atencao', '! Produziu tem de ser maior que zero.'); return; }
  if (perda != null && (perda < 0 || perda > qtd)) { avisoAcao('atencao', '! A perda vai de zero até o que foi produzido.'); return; }
  if (perda > 0 && !motivo) { avisoAcao('atencao', '! Escolha o motivo da perda.'); return; }
  if (!porque) { avisoAcao('atencao', '! Escreva por que está corrigindo.'); return; }
  if (!confirm(`Corrigir a linha ${id}: produziu ${fmt(qtd)}${perda > 0 ? `, perdeu ${fmt(perda)}` : ''}?\nA linha original sai do saldo e fica guardada.`)) return;
  avisoAcao('enviando', `Gravando a correção da linha ${id}…`);
  try {
    await prdFetch('est_producao', { method: 'POST', extra: { Prefer: 'return=minimal' },
      body: JSON.stringify({ unidade: PRD.unidade, data: l.data, receita: l.receita, qtd, un: l.un || null,
        quem: (rmbSessao() || {}).email, perda: perda > 0 ? perda : null, perda_motivo: perda > 0 ? motivo : null,
        planejado: l.planejado == null ? null : Number(l.planejado), corrige_id: id, observacao: 'correção: ' + porque }) });
  } catch (e) { return avisoAcao('erro', `✗ A correção NÃO gravou: ${e.message}. Tente de novo.`, () => prdCorrigirGravar(id)); }
  avisoAcao('ok', `✓ Correção da linha ${id} gravada: produziu ${fmt(qtd)}${perda > 0 ? `, perdeu ${fmt(perda)}` : ''} — às ${avisoHora()}.`);
  PRD.corrigindo = null;
  await prdCarregar();
}

// ---- PERDA FORA DA PRODUÇÃO (24/10/2026; dono, 08/10: o desperdício vem do apontamento da cozinha) ----
// O que estragou, venceu, caiu ou voltou do salão sem ser de um lote. Só pela função est_perder: ela confere o motivo
// (a lista fechada, a mesma da perda de lote) e põe a praça de quem registra. Corrigir é linha nova (p_corrige_id).
function prdPerdaHtml() {
  const campo = 'background:var(--p-paper, var(--surface-2)); border:1px solid var(--p-line, var(--line)); border-radius:8px; color:var(--p-ink, var(--tx-1)); padding:6px 8px;';
  const hoje = prdHoje();
  let h = `<div class="section-label">Perda fora da produção</div>
    <div class="caption-label">O que estragou, venceu, caiu ou voltou do salão e não é de um lote (perda de lote vai na coluna Perdeu, acima).
      Sai do estoque pelo custo de hoje.</div>`;
  if (PRD.perdas === null) return h + `<div class="contexto">A perda ainda não está disponível no banco.</div>`;
  const itens = PRD.itensEst || [];
  h += `<datalist id="prdPerdaItens">${itens.filter((i) => !i.fora_da_base).map((i) => `<option value="${trEscH(i.nome_base)}">`).join('')}</datalist>
    <div class="contexto" style="display:flex; gap:8px; align-items:center; flex-wrap:wrap; text-align:left;">
      <input id="prdPerdaItem" list="prdPerdaItens" placeholder="item (nome da base)" oninput="prdPerdaUn()" style="flex:1 1 220px; ${campo}">
      <input id="prdPerdaQtd" type="number" step="0.001" min="0" inputmode="decimal" placeholder="quanto" style="width:90px; ${campo}">
      <span id="prdPerdaUn" style="color:var(--tx-4); min-width:24px;"></span>
      ${prdMotivoSelect('prdPerdaMotivo', null)}
      <input id="prdPerdaObs" placeholder="observação (opcional)" style="flex:1 1 160px; ${campo}">
      <button class="preset-btn" onclick="prdPerdaGravar()">Registrar perda</button>
      ${PRD.data !== hoje ? `<span style="color:var(--tx-5); font-size:12px;">registra em hoje (${hoje.split('-').reverse().join('/')})</span>` : ''}
    </div>`;
  const ps = PRD.perdas || [];
  if (!ps.length) return h + `<div class="caption-label">Nenhuma perda fora da produção ${PRD.data === hoje ? 'hoje' : 'neste dia'}.</div>`;
  const tot = ps.filter((p) => !p.foi_corrigida).reduce((s, p) => s + Number(p.custo || 0), 0);
  h += `<div id="tabelaPrdPerda" style="overflow-x:auto;"><table><thead><tr><th>Item</th><th>Quanto</th><th>Motivo</th><th>Custo</th>
      <th>Estoque</th><th>Quem</th><th></th></tr></thead><tbody>`;
  ps.forEach((p) => {
    const risca = p.foi_corrigida ? ' style="opacity:.5; text-decoration:line-through;"' : '';
    const baixou = /^BAIXOU/.test(p.leitura || '');
    const pode = !p.foi_corrigida && !p.corrige_id;
    h += `<tr${risca}><td>${trEscH(p.nome_base || p.item)}${p.corrige_id ? ` <span style="color:var(--tx-5); font-size:11px;">correção da linha ${p.corrige_id}</span>` : ''}${p.observacao ? ` <span style="color:var(--tx-5);">· ${trEscH(p.observacao)}</span>` : ''}</td>
      <td style="white-space:nowrap;">${fmt(Number(p.qtd))} ${trEscH(p.un || '')}</td>
      <td>${trEscH(((PRD_MOTIVOS.find(([v]) => v === p.motivo) || [p.motivo, p.motivo])[1]) || '')}</td>
      <td style="white-space:nowrap;">${p.custo == null ? '—' : 'R$ ' + fmt(Number(p.custo))}</td>
      <td style="color:${p.foi_corrigida ? 'var(--tx-5)' : baixou ? 'var(--tx-2)' : 'var(--farol-perto)'}; font-size:12px;">${trEscH((p.leitura || '').toLowerCase())}</td>
      <td style="color:var(--tx-5);">${trEscH(estNome(p.quem))}</td>
      <td>${pode ? `<button class="preset-btn" onclick="PRD.perdaCorrigindo=PRD.perdaCorrigindo===${Number(p.id)}?null:${Number(p.id)}; prdRender();">corrigir</button>` : ''}</td></tr>`;
    if (PRD.perdaCorrigindo === p.id) {
      h += `<tr><td colspan="7" style="background:var(--p-paper, var(--surface-2));"><div style="display:flex; flex-wrap:wrap; gap:8px; align-items:center;">
        <b>Corrigir:</b> quanto <input type="number" step="0.001" min="0" inputmode="decimal" id="prdPC_q" value="${Number(p.qtd)}" style="width:100px; ${campo}">
        ${prdMotivoSelect('prdPC_m', p.motivo)}
        <input id="prdPC_o" placeholder="por que corrigir (obrigatório)" style="flex:1 1 180px; ${campo}">
        <button class="preset-btn" onclick="prdPerdaCorrigir(${Number(p.id)})">gravar correção</button>
        <button class="preset-btn" onclick="PRD.perdaCorrigindo=null; prdRender();">cancelar</button></div>
        <div class="caption-label" style="text-align:left; margin-top:4px;">A linha original fica guardada e sai da conta; a correção entra no lugar dela. Cada perda só se corrige uma vez.</div></td></tr>`;
    }
  });
  h += `<tr class="liq"><td colspan="3"><b>Total do dia</b></td><td><b>R$ ${fmt(tot)}</b></td><td colspan="3"></td></tr></tbody></table></div>`;
  return h;
}
function prdPerdaUn() {
  const nome = ((document.getElementById('prdPerdaItem') || {}).value || '').trim();
  const it = (PRD.itensEst || []).find((i) => i.nome_base === nome);
  const el = document.getElementById('prdPerdaUn');
  if (el) el.textContent = it ? (it.un || '') : '';
}
async function prdPerdaGravar() {
  const v = (id) => ((document.getElementById(id) || {}).value || '').trim();
  const item = v('prdPerdaItem'), motivo = v('prdPerdaMotivo'), obs = v('prdPerdaObs');
  const qtd = Number(v('prdPerdaQtd').replace(',', '.'));
  const it = (PRD.itensEst || []).find((i) => i.nome_base === item);
  if (!it) { avisoAcao('atencao', '! Escolha o item na lista (o nome da base).'); return; }
  if (!(qtd > 0)) { avisoAcao('atencao', '! Digite quanto se perdeu, em número maior que zero.'); return; }
  if (!motivo) { avisoAcao('atencao', '! Escolha o motivo da perda.'); return; }
  if (!confirm(`Registrar a perda de ${fmt(qtd)} ${it.un || ''} de ${item} (${motivo.toLowerCase()})?`)) return;
  avisoAcao('enviando', `Registrando a perda de ${item}…`);
  const r = await trRpcSeguro('est_perder', { p_unidade: PRD.unidade, p_item: item, p_qtd: qtd, p_motivo: motivo, p_un: it.un || null,
    p_quem: (rmbSessao() || {}).email || null, p_observacao: obs || null });
  if (!r.ok) return avisoAcao('erro', `✗ A perda NÃO foi registrada: ${await trErroDe(r)}. O que você digitou continua nos campos — tente de novo.`, prdPerdaGravar);
  avisoAcao('ok', `✓ Perda registrada: ${fmt(qtd)} ${it.un || ''} de ${item} (${motivo.toLowerCase()}) — às ${avisoHora()}.`);
  await prdCarregar();
}
async function prdPerdaCorrigir(id) {
  const p = (PRD.perdas || []).find((x) => x.id === id);
  if (!p) return;
  const qtd = Number(((document.getElementById('prdPC_q') || {}).value || '').replace(',', '.'));
  const motivo = (document.getElementById('prdPC_m') || {}).value || '';
  const porque = ((document.getElementById('prdPC_o') || {}).value || '').trim();
  if (!(qtd > 0)) { avisoAcao('atencao', '! Quanto tem de ser maior que zero.'); return; }
  if (!motivo) { avisoAcao('atencao', '! Escolha o motivo da perda.'); return; }
  if (!porque) { avisoAcao('atencao', '! Escreva por que está corrigindo.'); return; }
  if (!confirm(`Corrigir a perda ${id}: ${fmt(qtd)} ${p.un || ''} de ${p.item}?\nA linha original sai da conta e fica guardada.`)) return;
  avisoAcao('enviando', `Gravando a correção da perda ${id}…`);
  const r = await trRpcSeguro('est_perder', { p_unidade: p.unidade, p_item: p.item, p_qtd: qtd, p_motivo: motivo, p_un: p.un || null,
    p_quem: (rmbSessao() || {}).email || null, p_observacao: 'correção: ' + porque, p_corrige_id: id });
  if (!r.ok) return avisoAcao('erro', `✗ A correção da perda NÃO gravou: ${await trErroDe(r)}. Tente de novo.`, () => prdPerdaCorrigir(id));
  avisoAcao('ok', `✓ Correção da perda ${id} gravada: ${fmt(qtd)} ${p.un || ''} de ${p.item} — às ${avisoHora()}.`);
  PRD.perdaCorrigindo = null;
  await prdCarregar();
}

async function prdDesfazer(id) {
  if (!confirm('Desfazer este apontamento?')) return;
  avisoAcao('enviando', 'Desfazendo o apontamento…');
  try { await prdFetch(`est_producao?id=eq.${id}`, { method: 'DELETE', extra: { Prefer: 'return=minimal' } }); }
  catch (e) { return avisoAcao('erro', `✗ NÃO desfez: ${e.message}. O apontamento continua — tente de novo.`, () => prdDesfazer(id)); }
  avisoAcao('ok', `✓ Apontamento desfeito — às ${avisoHora()}.`);
  await prdCarregar();
}


// ==================================================================
// CONFERÊNCIA DE EMBALAGEM (29/10/2026; dono, 11:17: "temos que criar uma conferencia, no mesmo formato das receitas,
// pra Rita e Lana conferirem"; proposta contexto/propostas-telas/2026-10-29-conferencia-de-embalagem.md).
// Uma linha por família × embalagem (vw_est_embalagem_conferir), as famílias que mais vendem no delivery primeiro.
// Grava só pela est_embalagem_conferir: quem conferiu vem do login; corrigir de novo é linha nova (vale a última).
// A tela é da rede (a embalagem é a mesma nas lojas) — não segue o seletor de loja.
// ==================================================================
let EMB = null;   // { linhas, escolhas, regra, editando, filtro }
async function entrarEmbalagem() {
  const alvo = document.getElementById('view-embalagem');
  if (!alvo) return;
  if (!rmbSessao()) { alvo.innerHTML = `<div class="contexto">Entre no painel para conferir a embalagem.</div>`; return; }
  alvo.innerHTML = `<div class="contexto">Carregando…</div>`;
  EMB = EMB || { linhas: null, escolhas: [], regra: null, editando: null, filtro: 'falta' };
  try { await embCarregar(); }
  catch (e) {
    const falta = /does not exist|não existe|PGRST205|Could not find/i.test(e.message);
    alvo.innerHTML = `<div class="contexto" style="border-color:var(--farol-perto);">${falta
      ? 'A conferência de embalagem ainda não está no banco. Assim que estiver, esta tela abre sozinha.'
      : 'Não consegui abrir a tela: ' + trEscH(e.message)}</div>`;
  }
}
async function embCarregar() {
  const [linhas, escolhas, regra] = await Promise.all([
    consultarTudo('vw_est_embalagem_conferir?select=*&order=vendas_30d.desc.nullslast,nome_exibido,embalagem_atual'),
    consultarTudo('vw_est_embalagem_escolhas?select=nome_base,subgrupo&order=nome_base'),
    consultarTudo('vw_est_embalagem_regra?select=*').catch(() => []),
  ]);
  EMB.linhas = linhas; EMB.escolhas = escolhas;
  EMB.regra = (regra || []).find((r) => r.chave === 'SOS_BURGER_PEQUENO_ATE') || null;
  embRender();
}
function embQuando(ts) {
  return ts ? new Date(ts).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }).replace(',', '') : '';
}
function embQtd(v) { const n = Number(v); return v == null ? '—' : Number.isInteger(n) ? String(n) : fmt(n); }
function embFamilias() {
  const m = new Map();
  (EMB.linhas || []).forEach((l, ix) => {
    if (!m.has(l.nome_exibido)) m.set(l.nome_exibido, { nome: l.nome_exibido, vendas: Number(l.vendas_30d || 0), obs: l.obs, linhas: [] });
    m.get(l.nome_exibido).linhas.push(Object.assign({ ix }, l));
  });
  const fs = [...m.values()];
  fs.forEach((f) => { f.feita = f.linhas.every((l) => l.decisao); });
  return fs.sort((a, b) => b.vendas - a.vendas || a.nome.localeCompare(b.nome));
}
function embRender() {
  const alvo = document.getElementById('view-embalagem');
  if (!alvo || !EMB || !EMB.linhas) return;
  const fs = embFamilias(), feitas = fs.filter((f) => f.feita).length;
  const ver = EMB.filtro === 'falta' ? fs.filter((f) => !f.feita) : fs;
  const campo = 'background:var(--surface-2); border:1px solid var(--line); border-radius:8px; color:var(--tx-1); padding:6px 8px;';
  const sos = EMB.regra && EMB.regra.valor != null ? Number(EMB.regra.valor) : null;
  let h = `<div class="caption-label">O que vai em cada item vendido no <b>delivery</b>. Confira família por família: <b>está certo</b>, <b>corrigir</b> ou <b>não vai embalagem</b>.
      Depois de conferida, a embalagem passa a sair do estoque na venda de delivery (salão e balcão não baixam).</div>
    <div class="contexto" style="text-align:left;">
      <b>Regras que o Neto já deu (17/09):</b>
      <div style="margin-top:4px;">• Nenhuma embalagem vai em 100% dos pedidos: não existe sacola ou lacre fixo por pedido — a embalagem é por item vendido.</div>
      <div>• Marmita leva a caixa <b>da marca que vendeu</b> (Cidadão, Famosa ou Baixa) e não leva o saco SOS.</div>
      <div style="display:flex; gap:8px; align-items:center; flex-wrap:wrap; margin-top:2px;">• Burger: o saco SOS é pequeno ou grande pela quantidade de lanches. Até
        <input id="embSos" type="number" min="1" max="20" step="1" inputmode="numeric" value="${sos == null ? '' : sos}" placeholder="?" style="width:64px; ${campo}">
        lanches vai o <b>pequeno</b>; acima, o grande.
        <button class="preset-btn" onclick="embSosGravar()">gravar</button>
        <span style="font-size:12px; color:var(--tx-4);">${sos == null ? 'ainda não definido' : `gravado por ${trEscH(estNome(EMB.regra.quem) || EMB.regra.quem || '?')} em ${embQuando(EMB.regra.criado_em)}`}</span></div>
    </div>
    <div style="display:flex; gap:10px; align-items:center; flex-wrap:wrap; margin:10px 0;">
      <b style="font-size:16px; color:${feitas === fs.length ? 'var(--farol-ok)' : 'var(--tx-1)'};">${feitas} de ${fs.length} famílias conferidas</b>
      <button class="preset-btn${EMB.filtro === 'falta' ? ' active' : ''}" onclick="EMB.filtro='falta'; embRender();">falta conferir (${fs.length - feitas})</button>
      <button class="preset-btn${EMB.filtro === 'todas' ? ' active' : ''}" onclick="EMB.filtro='todas'; embRender();">todas</button>
    </div>
    <datalist id="embEscolhas">${(EMB.escolhas || []).map((e) => `<option value="${trEscH(e.nome_base)}">`).join('')}</datalist>`;
  if (!ver.length) h += `<div class="contexto" style="border-color:var(--farol-ok);"><b style="color:var(--farol-ok);">✓ Todas as famílias estão conferidas.</b> Para rever, clique em "todas".</div>`;
  const ORIGEM = { PROPOSTA: 'proposta antiga', RESPOSTA_1709: 'respondido pelo Neto em 17/09', CONFERENCIA: 'acrescentada na conferência', 'A DEFINIR': 'ainda sem embalagem' };
  const editor = (chave, emb, qtd) => `<div style="display:flex; gap:8px; align-items:center; flex-wrap:wrap;">
      <input id="embE" list="embEscolhas" value="${trEscH(emb || '')}" placeholder="embalagem (nome da base)" style="flex:1 1 260px; ${campo}">
      <input id="embQ" type="number" min="0" step="0.5" inputmode="decimal" value="${qtd == null ? '' : Number(qtd)}" placeholder="quantas" style="width:80px; ${campo}">
      <span style="color:var(--tx-4); font-size:12px;">por item vendido</span>
      <input id="embO" placeholder="observação (opcional)" style="flex:1 1 160px; ${campo}">
      <button class="preset-btn" style="border-color:var(--marca-amarelo);" onclick='embGravar(${trEscH(JSON.stringify(chave))}, "CORRIGIDO")'>gravar</button>
      <button class="preset-btn" onclick="EMB.editando=null; embRender();">cancelar</button></div>`;
  ver.forEach((f) => {
    h += `<div class="contexto" style="text-align:left; margin:10px 0; ${f.feita ? '' : 'border-color:var(--farol-perto);'}">
      <div style="display:flex; gap:10px; align-items:baseline; flex-wrap:wrap; justify-content:space-between;">
        <b style="font-size:15px;">${trEscH(f.nome)}</b>
        <span style="font-size:12px; color:var(--tx-4);">${f.vendas ? fmt0(f.vendas) + ' vendidos no delivery em 30 dias' : 'sem venda no delivery em 30 dias'}${f.feita ? ' · <span style="color:var(--farol-ok); font-weight:700;">✓ conferida</span>' : ''}</span></div>
      ${f.obs ? `<div style="font-size:12.5px; color:var(--info); margin-top:2px;">Regra: ${trEscH(f.obs)}</div>` : ''}
      <div id="tabelaEmb" style="overflow-x:auto; margin-top:6px;"><table><thead><tr><th>Embalagem</th><th>Por item</th><th>De onde veio</th><th>Conferência</th></tr></thead><tbody>`;
    f.linhas.forEach((l) => {
      const chave = l.chave, semEmb = !l.embalagem_atual;
      const ed = EMB.editando === chave;
      const res = l.decisao === 'CERTO' ? `<span style="color:var(--farol-ok); font-weight:700;">✓ está certo</span>`
        : l.decisao === 'CORRIGIDO' ? `<span style="color:var(--farol-ok); font-weight:700;">✓ corrigido: ${trEscH(l.embalagem_nova || '')} × ${embQtd(l.qtd_nova)}</span>`
        : l.decisao === 'NAO_VAI' ? `<span style="color:var(--farol-ok); font-weight:700;">✓ não vai embalagem</span>` : '';
      const acoes = `${semEmb ? '' : `<button class="preset-btn" onclick='embGravar(${trEscH(JSON.stringify(chave))}, "CERTO")'>está certo</button>`}
          <button class="preset-btn" onclick='EMB.editando=${trEscH(JSON.stringify(chave))}; embRender();'>${semEmb ? 'dizer qual vai' : 'corrigir'}</button>
          <button class="preset-btn" onclick='embGravar(${trEscH(JSON.stringify(chave))}, "NAO_VAI")'>não vai embalagem</button>`;
      h += `<tr><td style="white-space:normal;">${semEmb ? '<span style="color:var(--tx-4);">— a definir —</span>' : trEscH(l.embalagem_atual)}</td>
        <td>${semEmb ? '' : embQtd(l.qtd_atual)}</td>
        <td style="font-size:12px; color:var(--tx-4);">${trEscH(ORIGEM[l.origem_atual] || (l.origem_atual || '').toLowerCase())}</td>
        <td style="white-space:normal;">${l.decisao
          ? `${res} <span style="font-size:11.5px; color:var(--tx-4);">${trEscH(estNome(l.conferido_por) || l.conferido_por || '')} · ${embQuando(l.conferido_em)}</span>
             <a href="javascript:void(0)" style="font-size:11.5px; color:var(--tx-4); margin-left:4px;" onclick='EMB.editando=${trEscH(JSON.stringify('mudar:' + chave))}; embRender();'>mudar</a>
             ${EMB.editando === 'mudar:' + chave ? `<div style="margin-top:6px; display:flex; gap:6px; flex-wrap:wrap;">${acoes}</div>` : ''}`
          : `<div style="display:flex; gap:6px; flex-wrap:wrap;">${acoes}</div>`}</td></tr>`;
      if (ed) h += `<tr><td colspan="4" style="background:var(--surface-2);">${editor(chave, l.embalagem_nova || l.embalagem_atual, l.qtd_nova != null ? l.qtd_nova : l.qtd_atual)}</td></tr>`;
    });
    const nova = f.nome + ' | ';
    if (f.linhas.some((l) => l.embalagem_atual)) {
      h += EMB.editando === 'novo:' + f.nome
        ? `<tr><td colspan="4" style="background:var(--surface-2);"><b>Acrescentar embalagem em ${trEscH(f.nome)}:</b>${editor(nova, '', 1)}</td></tr>`
        : `<tr><td colspan="4"><a href="javascript:void(0)" style="font-size:12.5px;" onclick='EMB.editando=${trEscH(JSON.stringify('novo:' + f.nome))}; embRender();'>+ acrescentar embalagem que falta</a></td></tr>`;
    }
    h += `</tbody></table></div></div>`;
  });
  alvo.innerHTML = h;
}
function fmt0(v) { return Number(v || 0).toLocaleString('pt-BR', { maximumFractionDigits: 0 }); }
async function embGravar(chave, decisao) {
  let emb = null, qtd = null, obs = null;
  if (decisao === 'CORRIGIDO') {
    emb = ((document.getElementById('embE') || {}).value || '').trim();
    const q = ((document.getElementById('embQ') || {}).value || '').trim().replace(',', '.');
    obs = ((document.getElementById('embO') || {}).value || '').trim() || null;
    if (!(EMB.escolhas || []).some((e) => e.nome_base === emb)) return avisoAcao('atencao', '! Escolha a embalagem na lista (o nome da base).');
    qtd = Number(q);
    if (!q || !(qtd > 0)) return avisoAcao('atencao', '! Diga quantas vão por item vendido (maior que zero).');
  }
  const fam = chave.split(' | ')[0];
  const oque = decisao === 'CERTO' ? 'está certo' : decisao === 'NAO_VAI' ? 'não vai embalagem' : `${emb} × ${embQtd(qtd)}`;
  avisoAcao('enviando', `Gravando ${fam}: ${oque}…`);
  const r = await trRpcSeguro('est_embalagem_conferir', { p_chave: chave, p_decisao: decisao, p_embalagem: emb, p_qtd: qtd, p_obs: obs });
  if (!r.ok) return avisoAcao('erro', `✗ ${fam} NÃO gravou: ${await trErroDe(r)}. Tente de novo.`, () => embGravar(chave, decisao));
  avisoAcao('ok', `✓ ${fam}: ${oque} — gravado às ${avisoHora()}.`);
  EMB.editando = null;
  await embCarregar().catch(() => embRender());
  confAbasPintar();
}
async function embSosGravar() {
  const n = Number(((document.getElementById('embSos') || {}).value || '').trim());
  if (!Number.isInteger(n) || n < 1 || n > 20) return avisoAcao('atencao', '! Diga até quantos lanches vai o saco pequeno (de 1 a 20).');
  avisoAcao('enviando', 'Gravando a regra do saco SOS…');
  const r = await trRpcSeguro('est_embalagem_sos_limite', { p_n: n });
  if (!r.ok) return avisoAcao('erro', `✗ A regra do saco SOS NÃO gravou: ${await trErroDe(r)}. Tente de novo.`, embSosGravar);
  avisoAcao('ok', `✓ Saco SOS: até ${n} ${n === 1 ? 'lanche vai' : 'lanches vai'} o pequeno — gravado às ${avisoHora()}.`);
  await embCarregar().catch(() => embRender());
}

// ==================================================================
// CONFERÊNCIAS — uma tela só, com as conferências em abas no alto (dono, 29/10/2026 12:12: "uma tela só de conferencias,
// dentro do modulo estoque, lá após histórico", formato do portal do Fabio; desenho aprovado 12:22). Conferida vira cadastro
// da ficha técnica. Receitas, Produtos e Bebidas ainda moram nas páginas soltas até o banco delas chegar (pedido ao
// Estoque em 29/10); a aba leva para lá. Embalagem já é daqui.
// ==================================================================
const CONF_ABAS = [
  { id: 'embalagem', rotulo: 'Embalagem', leg: 'o que vai no delivery' },
  { id: 'receitas', rotulo: 'Receitas', leg: 'preparos da cozinha', pagina: 'conferencia-receitas.html' },
  { id: 'produtos', rotulo: 'Produtos', leg: 'o que se vende', pagina: 'conferencia-fichas.html' },
  { id: 'bebidas', rotulo: 'Bebidas', leg: 'doses e drinks', pagina: 'conferencia-bebidas.html' },
  // 12/11/2026 (dono 14:54, livro chat-frente-telas/respostas/custo-nota-e-itens-fora-da-base-nas-conferencias): as duas
  // filas que eram artefato viram abas daqui e item na agenda da Rita (o estoque_check.py cria e fecha sozinho).
  { id: 'custonota', rotulo: 'Custo pela nota', leg: 'nota × custo de hoje' },
  { id: 'itemfora', rotulo: 'Itens fora da base', leg: 'nome novo na nota ou venda' },
];
let CONF_ABA = (() => { try { const a = new URLSearchParams(location.search).get('aba'); return ['custonota', 'itemfora', 'receitas', 'produtos', 'bebidas'].includes(a) ? a : 'embalagem'; } catch (e) { return 'embalagem'; } })();
// 12/11/2026 (Estoque): "Mudar esta receita → Conferências" da tela Fichas chega com a ficha já aberta
let CF_PEDIDA = (() => { try { const f = sessionStorage.getItem('confFichaPedida'); if (f) sessionStorage.removeItem('confFichaPedida'); return f; } catch (e) { return null; } })();
async function entrarConferencias() {
  const alvo = document.getElementById('view-conferencias');
  if (!alvo) return;
  EST_TELA = 'conferencias';
  if (!rmbSessao()) { alvo.innerHTML = `<div class="contexto">Entre no painel para fazer as conferências.</div>`; return; }
  confRender();
  if (CONF_ABA === 'embalagem') await entrarEmbalagem();
  else if (CONF_ABA === 'custonota') await cnEntrar();
  else if (CONF_ABA === 'itemfora') await ifEntrar();
  else await cfEntrar(CONF_ABA);
  confAbasPintar();
}
function confRaiz() { return /\/(estoque|listas|caixa|pessoas|cardapio)\//.test(location.pathname) ? '../' : ''; }
// o "N/M" de cada aba, quando a aba já foi lida
function confAbasPintar() {
  CONF_ABAS.forEach((x) => {
    const el = document.getElementById('confN_' + x.id); if (!el) return;
    let f = null, n = null;
    if (x.id === 'embalagem') { if (EMB && EMB.linhas) { const fs = embFamilias(); f = fs.filter((y) => y.feita).length; n = fs.length; } }
    else if (x.id === 'custonota') { if (CN.linhas) { el.textContent = CN.linhas.length ? ` ${CN.linhas.length}` : ' ✓'; el.style.color = CN.linhas.length ? 'var(--farol-perto)' : 'var(--farol-ok)'; } return; }
    else if (x.id === 'itemfora') { if (IFB.linhas) { const n2 = IFB.linhas.filter((l) => !l.resposta).length; el.textContent = n2 ? ` ${n2}` : ' ✓'; el.style.color = n2 ? 'var(--farol-perto)' : 'var(--farol-ok)'; } return; }
    else { const c = CONF_FICHA[x.id], L = CF.fila[c.aba]; if (L) { n = L.length; f = L.filter((i) => cfFeito(c, i)).length; } }
    el.textContent = n == null ? '' : ` ${f}/${n}`; el.style.color = n && f === n ? 'var(--farol-ok)' : 'var(--tx-3)';
  });
}
function confAba(id) { CONF_ABA = id; CF.aberto = null; CF.busca = ''; entrarConferencias(); }
function confRender() {
  const alvo = document.getElementById('view-conferencias');
  const a = CONF_ABAS.find((x) => x.id === CONF_ABA) || CONF_ABAS[0];
  const cap = a.id === 'custonota' ? 'A nota trouxe um preço diferente do custo de hoje: aplique o da nota ou mantenha o de hoje.'
    : a.id === 'itemfora' ? 'Nome que apareceu na nota ou na venda e não está na base: diga o que ele é.'
    : a.id === 'receitas' ? 'Conferida, a receita vira cadastro. Para mudar depois, abra aqui e clique em Conferir de novo.'
    : `Confira cada ficha uma vez. Conferida, ela vira <b>cadastro</b> e entra na base — dali em diante a mudança é feita
      só na ficha (Rita, Lana e Neto), e o Fabio é avisado pelo WhatsApp.`;
  alvo.innerHTML = `<h2>Conferências</h2>
    <div class="caption-label">${cap}</div>
    <div style="display:flex; gap:4px; flex-wrap:wrap; border-bottom:1px solid var(--line); margin:10px 0 14px;">${CONF_ABAS.map((x) =>
      `<button onclick="confAba('${x.id}')" style="background:none; border:none; border-bottom:3px solid ${x.id === a.id ? 'var(--marca-amarelo)' : 'transparent'};
        color:${x.id === a.id ? 'var(--tx-1)' : 'var(--tx-3)'}; font:inherit; font-weight:700; font-size:14px; padding:10px 14px; cursor:pointer; text-align:left;">${x.rotulo}<span id="confN_${x.id}"></span>
        <span style="display:block; font-weight:600; font-size:11.5px; color:var(--tx-4);">${x.leg}</span></button>`).join('')}</div>
    ${a.id === 'embalagem' ? '<div id="view-embalagem"></div>' : '<div id="cfCorpo"></div>'}`;
}

// ---- aba Custo pela nota (12/11/2026): lê est_conf_custo_nota_lista(), grava est_conf_custo_nota_responder(insumo,
// APLICAR|MANTER, quem). APLICAR já roda ft_aplicar_custo_compra() no banco; a decisão vale para aquela nota. Só papel DONO
// (Rita, compras, Neto); quem não pode recebe a frase do banco. Banco: script/sql/conferencias_custo_nota_itens_fora_2026_11_12.sql
const CN = { linhas: null };
const cnMoeda = (v, u) => v == null ? '—' : 'R$ ' + Number(v).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 4 }) + (u ? ' / ' + trEscH(u) : '');
const cnDm = (d) => d ? String(d).slice(8, 10) + '/' + String(d).slice(5, 7) : '';
const cnQuem = () => ((rmbSessao() || {}).email || '');
async function cnEntrar() {
  const alvo = document.getElementById('cfCorpo'); if (!alvo) return;
  if (!CN.linhas) alvo.innerHTML = `<div class="contexto">Carregando…</div>`;
  const r = await trRpcSeguro('est_conf_custo_nota_lista', {});
  if (!r.ok) { alvo.innerHTML = `<div class="contexto">Não deu para abrir o Custo pela nota: ${trEscH(await trErroDe(r))}</div>`; return; }
  CN.linhas = await r.json();
  cnRender(); confAbasPintar();
}
function cnRender() {
  const alvo = document.getElementById('cfCorpo'); if (!alvo || CONF_ABA !== 'custonota') return;
  const L = CN.linhas || [];
  if (!L.length) { alvo.innerHTML = `<div class="contexto" style="color:var(--farol-ok);">✓ Nenhuma nota esperando decisão de custo.</div>`; return; }
  alvo.innerHTML = `<div style="margin-bottom:8px; color:var(--tx-3); font-size:13px;">${L.length} ${L.length === 1 ? 'insumo espera' : 'insumos esperam'} decisão · primeiro os que mais entram nas fichas</div>
  <div id="tabelaConfCustoNota"><table><tr><th>Insumo</th><th>Custo hoje</th><th>Última nota</th><th>Diferença</th><th>Por que parou</th><th>Ação</th></tr>
  ${L.map((l, i) => { const d = l.diferenca_pct == null ? null : Number(l.diferenca_pct);
    return `<tr><td><b>${trEscH(l.insumo)}</b><div style="font-size:11.5px; color:var(--tx-4);">${l.usado_em_fichas ? 'em ' + l.usado_em_fichas + (l.usado_em_fichas === 1 ? ' ficha' : ' fichas') : 'em nenhuma ficha'}</div></td>
      <td>${cnMoeda(l.custo_atual, l.un_atual)}</td>
      <td>${cnMoeda(l.custo_nota, l.un_nota)}<div style="font-size:11.5px; color:var(--tx-4);">${trEscH(l.loja_nota || '')}${l.data_nota ? ' · ' + cnDm(l.data_nota) : ''}${l.nota ? ' · ' + trEscH(/^nf/i.test(l.nota) ? l.nota : 'NF ' + l.nota) : ''}</div></td>
      <td style="color:${d != null && Math.abs(d) >= 20 ? 'var(--farol-fora)' : 'var(--tx-2)'};">${d == null ? '—' : (d > 0 ? '+' : '') + d.toLocaleString('pt-BR', { maximumFractionDigits: 1 }) + '%'}</td>
      <td style="font-size:12.5px;">${trEscH(l.o_que_e || '')}</td>
      <td style="white-space:nowrap;"><button class="preset-btn" onclick="cnResponder(${i}, 'APLICAR')">Usar o da nota</button>
        <button class="preset-btn" onclick="cnResponder(${i}, 'MANTER')">Manter o de hoje</button></td></tr>`; }).join('')}
  </table></div>`;
}
async function cnResponder(i, dec) {
  const l = (CN.linhas || [])[i]; if (!l) return;
  const oque = dec === 'APLICAR' ? 'usar o custo da nota' : 'manter o custo de hoje';
  avisoAcao('enviando', `Gravando ${l.insumo}: ${oque}…`);
  const r = await trRpcSeguro('est_conf_custo_nota_responder', { p_insumo: l.insumo, p_decisao: dec, p_quem: cnQuem() });
  if (!r.ok) return avisoAcao('erro', `✗ ${l.insumo} NÃO gravou: ${await trErroDe(r)}`, () => cnResponder(i, dec));
  avisoAcao('ok', `✓ ${l.insumo}: ${oque} — gravado às ${avisoHora()}.`);
  await cnEntrar();
}

// ---- aba Itens fora da base (12/11/2026): lê est_conf_item_fora_lista(), busca est_conf_item_base_busca(texto), grava
// est_conf_item_fora_responder(nome_saipos, NOVO|IGUAL|NAO_USA, nome_base, subgrupo, quem). A resposta entra na base pelo
// gravar_base_itens.py na próxima rodada do estoque_check.py; até lá a linha fica "respondido".
const IFB = { linhas: null, aberto: null, grupos: null, achados: [], tBusca: null };
const IF_RESP = { NOVO: 'item novo', IGUAL: 'igual a', NAO_USA: 'não usamos' };
async function ifEntrar() {
  const alvo = document.getElementById('cfCorpo'); if (!alvo) return;
  if (!IFB.linhas) alvo.innerHTML = `<div class="contexto">Carregando…</div>`;
  const r = await trRpcSeguro('est_conf_item_fora_lista', {});
  if (!r.ok) { alvo.innerHTML = `<div class="contexto">Não deu para abrir os itens fora da base: ${trEscH(await trErroDe(r))}</div>`; return; }
  IFB.linhas = await r.json();
  if (!IFB.grupos) {
    const g = await consultarTudo('ft_item_base?select=subgrupo&order=subgrupo').catch(() => []);
    IFB.grupos = [...new Set(g.map((x) => x.subgrupo).filter(Boolean))].sort();
  }
  ifRender(); confAbasPintar();
}
function ifRespTexto(l) {
  if (l.resposta === 'IGUAL') return 'igual a ' + trEscH(l.nome_base || '');
  if (l.resposta === 'NOVO') return 'item novo: ' + trEscH(l.nome_base || '') + (l.subgrupo ? ' (' + trEscH(l.subgrupo) + ')' : '');
  return 'não usamos';
}
function ifRender() {
  const alvo = document.getElementById('cfCorpo'); if (!alvo || CONF_ABA !== 'itemfora') return;
  const L = IFB.linhas || [], falta = L.filter((l) => !l.resposta).length;
  if (!L.length) { alvo.innerHTML = `<div class="contexto" style="color:var(--farol-ok);">✓ Nenhum item fora da base.</div>`; return; }
  const ab = IFB.aberto;
  alvo.innerHTML = `<div style="margin-bottom:8px; color:var(--tx-3); font-size:13px;">${falta ? falta + (falta === 1 ? ' item falta responder' : ' itens faltam responder') : '✓ todos respondidos'} · de ${L.length}</div>
  <div id="tabelaConfItemFora"><table><tr><th>Item (nome do Saipos)</th><th>Onde apareceu</th><th>Valor em 2026 (R$)</th><th>Resposta</th><th>Ação</th></tr>
  ${L.map((l, i) => `<tr><td><b>${trEscH(l.nome_saipos)}</b>${l.grupo_saipos ? `<div style="font-size:11.5px; color:var(--tx-4);">${trEscH(l.grupo_saipos)}</div>` : ''}</td>
      <td>${trEscH(l.onde_apareceu || '')}<div style="font-size:11.5px; color:var(--tx-4);">${trEscH(l.lojas || '')}${l.ultima ? ' · última ' + cnDm(l.ultima) : ''}</div></td>
      <td>${l.valor_2026 == null ? '—' : Number(l.valor_2026).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
      <td>${l.resposta ? `<span style="color:var(--farol-ok);">respondido — entra na base na próxima rodada</span><div style="font-size:11.5px; color:var(--tx-4);">${ifRespTexto(l)}${l.respondido_por ? ' · ' + trEscH(String(l.respondido_por).split('@')[0]) : ''}</div>`
        : '<span style="color:var(--farol-perto);">falta</span>'}</td>
      <td style="white-space:nowrap;">${['NOVO', 'IGUAL', 'NAO_USA'].map((m) => `<button class="preset-btn${ab && ab.i === i && ab.modo === m ? ' active' : ''}" onclick="ifAbrir(${i}, '${m}')">${m === 'IGUAL' ? 'Igual a…' : m === 'NOVO' ? 'Item novo' : 'Não usamos'}</button>`).join(' ')}</td></tr>
    ${ab && ab.i === i ? `<tr><td colspan="5" style="background:var(--surface-2);">${ifEditor(l, ab.modo)}</td></tr>` : ''}`).join('')}
  </table></div>`;
  const foco = document.getElementById(ab && ab.modo === 'IGUAL' ? 'ifBusca' : 'ifNome'); if (foco) foco.focus();
}
function ifEditor(l, modo) {
  if (modo === 'NAO_USA') return `<b>${trEscH(l.nome_saipos)}</b> não é item nosso: sai da lista. <button class="preset-btn" onclick="ifGravar()">Gravar: não usamos</button>
    <button class="preset-btn" onclick="ifAbrir(-1)">Cancelar</button>`;
  if (modo === 'IGUAL') return `É o mesmo que <input id="ifBusca" list="ifLista" placeholder="digite para buscar na base" autocomplete="off" oninput="ifBuscar(this.value)"
      style="min-width:280px; padding:6px 8px; background:var(--surface); color:var(--tx-1); border:1px solid var(--line-2); border-radius:6px;">
    <datalist id="ifLista">${IFB.achados.map((x) => `<option value="${trEscH(x.nome_base)}">${trEscH(x.subgrupo || '')}</option>`).join('')}</datalist>
    <button class="preset-btn" onclick="ifGravar()">Gravar: é igual a este</button> <button class="preset-btn" onclick="ifAbrir(-1)">Cancelar</button>`;
  return `Nome na base <input id="ifNome" value="${trEscH(String(l.nome_saipos || '').toUpperCase())}" autocomplete="off"
      style="min-width:240px; padding:6px 8px; background:var(--surface); color:var(--tx-1); border:1px solid var(--line-2); border-radius:6px;">
    grupo <select id="ifGrupo" style="padding:6px 8px; background:var(--surface); color:var(--tx-1); border:1px solid var(--line-2); border-radius:6px;">
      <option value="">escolha…</option>${(IFB.grupos || []).map((g) => `<option>${trEscH(g)}</option>`).join('')}</select>
    <button class="preset-btn" onclick="ifGravar()">Gravar item novo</button> <button class="preset-btn" onclick="ifAbrir(-1)">Cancelar</button>`;
}
function ifAbrir(i, modo) { IFB.aberto = i < 0 ? null : { i, modo }; IFB.achados = []; ifRender(); }
function ifBuscar(t) {
  clearTimeout(IFB.tBusca);
  IFB.tBusca = setTimeout(async () => {
    if (String(t || '').trim().length < 2) return;
    const r = await trRpcSeguro('est_conf_item_base_busca', { p_texto: t });
    if (!r.ok) return;
    IFB.achados = await r.json();
    const dl = document.getElementById('ifLista');
    if (dl) dl.innerHTML = IFB.achados.map((x) => `<option value="${trEscH(x.nome_base)}">${trEscH(x.subgrupo || '')}</option>`).join('');
  }, 250);
}
async function ifGravar() {
  const ab = IFB.aberto; if (!ab) return;
  const l = (IFB.linhas || [])[ab.i]; if (!l) return;
  let nome = null, grupo = null;
  if (ab.modo === 'IGUAL') { nome = ((document.getElementById('ifBusca') || {}).value || '').trim(); if (!nome) return avisoAcao('atencao', '! Escolha na lista o item da base que é igual.'); }
  if (ab.modo === 'NOVO') {
    nome = ((document.getElementById('ifNome') || {}).value || '').trim(); grupo = (document.getElementById('ifGrupo') || {}).value || '';
    if (!nome) return avisoAcao('atencao', '! Escreva o nome do item novo.');
    if (!grupo) return avisoAcao('atencao', '! Escolha o grupo do item novo.');
  }
  avisoAcao('enviando', `Gravando ${l.nome_saipos}: ${IF_RESP[ab.modo]}…`);
  const r = await trRpcSeguro('est_conf_item_fora_responder', { p_nome_saipos: l.nome_saipos, p_resposta: ab.modo, p_nome_base: nome, p_subgrupo: grupo, p_quem: cnQuem() });
  if (!r.ok) return avisoAcao('erro', `✗ ${l.nome_saipos} NÃO gravou: ${await trErroDe(r)}`, ifGravar);
  avisoAcao('ok', `✓ ${l.nome_saipos}: ${IF_RESP[ab.modo]}${nome ? ' ' + nome : ''} — gravado às ${avisoHora()}. Entra na base na próxima rodada.`);
  IFB.aberto = null;
  await ifEntrar();
}

// ---- as abas de ficha (Receitas, Produtos, Bebidas): o mesmo preenchimento das páginas soltas, agora com login ----
// Fila = vw_ft_conferencia_fila (os geradores script/gerar_conferencia_* gravam os cartões); feito = vw_ft_conferencia_feita
// (o último envio de cada ficha, em qualquer aparelho); grava pela ft_conferencia_gravar (quem conferiu = login; só
// Rita, Lana e Neto — ft_pode_mudar_ficha). O rascunho continua nas MESMAS chaves do aparelho que as páginas soltas
// usavam: o que a Rita digitou lá e não enviou aparece aqui sozinho (dono, 29/10 12:12).
const CONF_FICHA = {
  receitas: { aba: 'RECEITAS', chave: 'conferencia_receitas', escala: 'LOTE', rende: true, naofaz: false,
              st: { confere: 'planilha e Saipos batem', diferente: 'planilha e Saipos diferentes', sem_lote: 'sem lote no Saipos', sem_ficha: 'sem ficha' } },
  produtos: { aba: 'PRODUTOS', chave: 'conferencia_produtos', escala: null, rende: false, naofaz: true,
              st: { vende: 'vendeu nos últimos 90 dias', atacado: 'atacado', parado: 'sem venda em 90 dias', sem_ficha: 'sem ficha — escrever' } },
  bebidas: { aba: 'BEBIDAS', chave: 'conferencia_bebidas', escala: null, rende: false, naofaz: true,
             st: { vende: 'vendeu nos últimos 90 dias' } },
};
const CF = { fila: {}, feita: {}, nomes: null, aberto: null, filtro: 'falta', busca: '', ordem: 'venda', venda: undefined };
const CF_META_LANA = 30;   // dono, 06/10 (livro pauta-da-semana/respostas/meta-lana)
// venda de 30 dias do produto (rede), pelo nome da base e, se não achar, pelo nome da ficha
function cfVendeu(i) { if (!CF.venda) return 0; return CF.venda.get(i.nb) || CF.venda.get(i.f) || 0; }
// segunda-feira desta semana, meia-noite de Curitiba
function cfSegunda() {
  const p = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' }).split('-').map(Number);
  const d = new Date(Date.UTC(p[0], p[1] - 1, p[2])); d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
  return { quando: new Date(d.toISOString().slice(0, 10) + 'T00:00:00-03:00'), dm: d.toISOString().slice(8, 10) + '/' + d.toISOString().slice(5, 7) };
}
const cfFmt = (v) => v == null || v === '' ? '' : Number(v).toLocaleString('pt-BR', { maximumFractionDigits: 3, useGrouping: false });
const cfNum = (t) => { const s = String(t == null ? '' : t).trim(); if (s === '') return null; if (!/^\d+([.,]\d+)?$/.test(s)) return NaN; return Number(s.replace(',', '.')); };
function cfUn(u) {
  const s = String(u == null ? '' : u).trim().toLowerCase().replace(/[.]$/, '');
  if (['g', 'gr', 'grs', 'grama', 'gramas'].includes(s)) return 'g'; if (['ml', 'mls'].includes(s)) return 'ml';
  if (['kg', 'kgs', 'quilo', 'quilos', 'kilo', 'kilos'].includes(s)) return 'kg'; if (['l', 'lt', 'lts', 'litro', 'litros'].includes(s)) return 'lt';
  if (['un', 'und', 'unid', 'unidade', 'unidades'].includes(s)) return 'un'; return s;
}
// o aparelho: as mesmas chaves das páginas soltas (rascunho a cada tecla; respostas = o que foi digitado por cartão)
function cfLer(k) { try { return JSON.parse(localStorage.getItem(k) || '{}'); } catch (e) { return {}; } }
function cfGuardar(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} }
function cfRasc(c) { return cfLer(c.chave + '_rascunho'); }
function cfResp(c) { return cfLer(c.chave + '_respostas'); }
function cfFeito(c, i) { return (CF.feita[c.aba] || new Map()).get(i.f || i.nb); }
function cfComecada(c, i, rasc, resp) {
  if (cfFeito(c, i)) return false;
  const r = resp[i.id];
  return Object.keys(rasc).some((k) => k.startsWith(i.id + '|')) || !!(r && ((r.itens && Object.keys(r.itens).length) || (r.extras || []).length || r.obs));
}
async function cfCarregar(c) {
  const [fila, feita] = await Promise.all([
    consultarTudo(`vw_ft_conferencia_fila?select=*&aba=eq.${c.aba}&order=ordem`),
    consultarTudo(`vw_ft_conferencia_feita?select=*&escala=${c.escala ? 'eq.' + c.escala : 'is.null'}&order=ficha`),
  ]);
  CF.fila[c.aba] = fila.map((l) => Object.assign({}, l.cartao_completo || {}, { id: l.id, nb: l.nb, f: l.f, gr: l.gr, fam: l.fam, g: l.g, mot: l.mot,
    r: l.r, ru: l.ru, rs: l.rs, i: Array.isArray(l.itens) ? l.itens : [] }));
  CF.feita[c.aba] = new Map(feita.map((x) => [x.ficha, x]));
  if (c.aba === 'RECEITAS') await cfReceitasAoVivo(c);
  await cfEstadoCarregar();
  // 12/11/2026 (dono, 06/10, livro pauta-da-semana/respostas/meta-lana: "30 produtos por semana, começando pelos que mais
  // saem"): a venda de 30 dias é a mesma da tela Preço alvo (vw_margem_produto.qtd_vendida), somada por nome da base.
  if (c.aba === 'PRODUTOS' && CF.venda === undefined) {
    const v = await consultarTudo('vw_margem_produto?select=nome_base,produto,qtd_vendida').catch(() => null);
    if (!v) CF.venda = null;
    else { CF.venda = new Map(); v.forEach((x) => { const k = x.nome_base || x.produto; if (k) CF.venda.set(k, (CF.venda.get(k) || 0) + (Number(x.qtd_vendida) || 0)); }); }
  }
  if (!CF.nomes) {
    const [a, b] = await Promise.all([consultarTudo('ft_item_base?select=nome_base&order=nome_base').catch(() => []),
                                      consultarTudo('ft_receita_base?select=nome_base&order=nome_base').catch(() => [])]);
    CF.nomes = [...new Set([...a, ...b].map((x) => x.nome_base).filter(Boolean))].sort();
  }
}
// 12/11/2026 (dono 19:30: "Quando ela altera e aperta conferir de novo, deve alterar, ou avisar porque não alterou"): a aba
// Receitas mostra a ficha que está VALENDO — lote (qtd_receita) e rendimento lidos ao vivo de vw_ft_conferencia_receita_viva,
// o mesmo número que o aplicar_conferencia_equipe.py compara — e não o cartão gerado em 29/10. Ingrediente agrupado pelo
// nome padrão, como o aplicador agrupa. Se a lista de ingredientes mudou, o rascunho do aparelho (guardado por linha) era da
// ficha velha e é descartado; a observação fica.
async function cfReceitasAoVivo(c) {
  const L = CF.fila[c.aba] || [], fs = [...new Set(L.map((i) => i.f).filter(Boolean))];
  if (!fs.length) return;
  const q = fs.map((n) => '"' + String(n).replace(/"/g, '') + '"').join(',');
  const rows = await consultarTudo(`vw_ft_conferencia_receita_viva?select=ficha,materia_prima,materia_prima_nome_base,un_uso,qtd_receita,rendimento&ficha=in.(${encodeURIComponent(q)})&order=ficha,materia_prima`).catch(() => null);
  if (!rows) return;   // sem a leitura ao vivo, fica o cartão gerado
  const por = new Map(); rows.forEach((l) => { if (!por.has(l.ficha)) por.set(l.ficha, []); por.get(l.ficha).push(l); });
  const rasc = cfRasc(c), resp = cfResp(c); let mexeu = false;
  L.forEach((i) => {
    const R = por.get(i.f); if (!R || !R.length) return;
    const velhos = i.i || [], grupos = new Map();
    R.forEach((l) => { const nb = l.materia_prima_nome_base || l.materia_prima, g = grupos.get(nb) || { nb, orig: [], lote: 0, un: l.un_uso };
      g.orig.push(l.materia_prima); g.lote += Number(l.qtd_receita) || 0; grupos.set(nb, g); });
    const novos = [...grupos.values()].map((g) => {
      const v = velhos.find((it) => it.mp === g.nb || (it.orig || []).some((o) => g.orig.includes(o))) || null;
      const uv = v ? cfUn(v.un) : '', U = String(g.un || '').toUpperCase(), mil = (uv === 'g' && U === 'KG') || (uv === 'ml' && U === 'LT');
      return { mp: g.nb, orig: g.orig, un: mil ? v.un : (g.un || (v && v.un)), qf: +(mil ? g.lote * 1000 : g.lote).toFixed(3), qs: v ? v.qs : null, ix: v ? velhos.indexOf(v) : 999 };
    }).sort((a, b) => a.ix - b.ix);
    novos.forEach((x) => { delete x.ix; });
    const mudou = novos.map((x) => x.mp).join('|') !== velhos.map((x) => x.mp).join('|');
    i.i = novos; i.r = Number(R[0].rendimento) || i.r;
    if (mudou) {
      Object.keys(rasc).filter((k) => k.startsWith(i.id + '|') && k !== i.id + '|o').forEach((k) => { delete rasc[k]; mexeu = true; });
      const r = resp[i.id];
      if (r && (r.removidos || r.itens || r.rende != null)) { delete r.removidos; delete r.itens; delete r.rende; mexeu = true; }
    }
  });
  if (mexeu) { cfGuardar(c.chave + '_rascunho', rasc); cfGuardar(c.chave + '_respostas', resp); }
}
// 12/11/2026 (dono 19:31: "se nada aparecer eles acham que nada aconteceu e clicam novamente"): o estado de cada envio vem
// de vw_ft_conferencia_estado (Estoque): ENTROU, NA_FILA, PARADO (com o motivo), SUBSTITUIDO. Vale o último envio da ficha.
async function cfEstadoCarregar(ficha) {
  const q = ficha ? `&ficha=eq.${encodeURIComponent(ficha)}` : '';
  const L = await consultarTudo(`vw_ft_conferencia_estado?select=ficha,enviado_em,estado,mensagem,entrou_em${q}&order=ficha,enviado_em.desc`).catch(() => null);
  if (!L) return;
  if (!CF.estado || !ficha) CF.estado = new Map();
  if (ficha) CF.estado.delete(ficha);
  L.forEach((x) => { if (!CF.estado.has(x.ficha)) CF.estado.set(x.ficha, x); });
}
// a mensagem do banco em palavra de operador: sai a instrução técnica de quem resolve
const cfMsgOperador = (m) => String(m || '').replace(/;\s*se estiver certo[^—]*/i, ' ').replace(/\s*\(grama no lugar[^)]*\)/i, '').replace(/alguem le antes:?\s*/i, '').replace(/:\s*—/, ' —').replace(/\s+/g, ' ').trim();
// o que aconteceu com o último envio: entrou na ficha, parado (com o motivo) ou na fila
function cfEstadoEnvio(c, fe, i) {
  const est = CF.estado && i ? CF.estado.get(i.f || i.nb) : null;
  if (est && est.estado !== 'SUBSTITUIDO') {
    const cor = est.estado === 'ENTROU' ? 'var(--farol-ok)' : est.estado === 'PARADO' ? 'var(--farol-perto)' : 'var(--tx-3)';
    return `<span style="font-size:12px; font-weight:700; color:${cor}; white-space:normal;">${trEscH(cfMsgOperador(est.mensagem))}</span>`;
  }
  if (!fe || fe.nao_fazemos_mais) return '';
  const alvo = c.aba === 'RECEITAS' ? 'receita' : 'ficha';
  if (fe.aplicado) return `<span style="font-size:12px; font-weight:700; color:var(--farol-ok);">✓ aplicada na ${alvo}${fe.aplicado_em ? ' ' + embQuando(fe.aplicado_em) : ''}</span>`;
  if (fe.trava_motivo) return `<span style="font-size:12px; font-weight:700; color:var(--farol-fora); white-space:normal;">✗ não entrou: ${trEscH(fe.trava_motivo)} — já avisamos</span>`;
  return `<span style="font-size:12px; font-weight:700; color:var(--farol-perto);">⏳ recebida, entra na ${alvo} na próxima passada (até 2 h)</span>`;
}
async function cfEntrar(id) {
  const c = CONF_FICHA[id], alvo = document.getElementById('cfCorpo');
  if (!alvo) return;
  if (!CF.fila[c.aba]) {
    alvo.innerHTML = `<div class="contexto">Carregando…</div>`;
    try { await cfCarregar(c); }
    catch (e) {
      const falta = /does not exist|não existe|PGRST205|Could not find/i.test(e.message);
      const pag = (CONF_ABAS.find((x) => x.id === id) || {}).pagina;
      alvo.innerHTML = `<div class="contexto" style="text-align:left;">${falta
        ? `A conferência de ${id} ainda não chegou ao banco. Até lá, continue pela página de hoje:` : 'Não consegui abrir: ' + trEscH(e.message)}
        ${pag ? `<div style="margin-top:8px;"><a class="preset-btn" href="${confRaiz()}${pag}" target="_blank" rel="noopener" style="display:inline-block; text-decoration:none;">abrir a conferência de ${id} ↗</a></div>` : ''}</div>`;
      return;
    }
  }
  cfRender(id);
}
// o valor do campo: rascunho do aparelho > o que foi digitado e guardado > o que foi enviado por último > o da ficha
function cfValQ(c, i, j, rasc, resp) {
  const k = i.id + '|' + j; if (rasc[k] != null) return rasc[k];
  const r = resp[i.id]; if (r && r.itens && r.itens[j] != null) return r.itens[j];
  const it = i.i[j], fe = cfFeito(c, i);
  if (fe && !fe.nao_fazemos_mais) {
    const l = (fe.linhas || []).find((x) => x.mp === (it.mpo || it.mp));
    if (l && l.qtd_medida != null) { const u = cfUn(it.un); return cfFmt(['g', 'ml'].includes(u) && /^(KG|LT)$/.test(l.un || '') ? Number(l.qtd_medida) * 1000 : l.qtd_medida); }
  }
  return i.g === 'sem_ficha' || it.qf == null ? '' : cfFmt(it.qf);
}
function cfValR(c, i, rasc, resp) {
  const k = i.id + '|r'; if (rasc[k] != null) return rasc[k];
  const r = resp[i.id]; if (r && r.rende != null) return r.rende;
  return i.g === 'sem_ficha' ? '' : cfFmt(i.r);
}
function cfRender(id) {
  const c = CONF_FICHA[id], alvo = document.getElementById('cfCorpo');
  if (!alvo) return;
  const L = CF.fila[c.aba] || [], rasc = cfRasc(c), resp = cfResp(c);
  if (CF_PEDIDA && L.length) {
    const p = L.find((i) => i.f === CF_PEDIDA || i.nb === CF_PEDIDA);
    if (p) { CF.aberto = p.id; CF.filtro = 'todas'; CF.busca = p.nb || ''; CF.enviada = null; }
    else avisoAcao('atencao', `! ${CF_PEDIDA} não está na lista desta conferência.`);
    CF_PEDIDA = null;
  }
  const feitas = L.filter((i) => cfFeito(c, i)).length;
  const comecadas = L.filter((i) => cfComecada(c, i, rasc, resp));
  const b = CF.busca.toLowerCase();
  let lista = L.filter((i) => (CF.filtro === 'todas' || (CF.filtro === 'feitas') === !!cfFeito(c, i)) && (!b || (i.nb || '').toLowerCase().includes(b)));
  const ehProd = id === 'produtos', porVenda = ehProd && CF.venda && CF.ordem === 'venda';
  if (porVenda) lista = [...lista].sort((x, y) => cfVendeu(y) - cfVendeu(x));
  const campo = 'background:var(--surface-2); border:1px solid var(--line); border-radius:8px; color:var(--tx-1); padding:6px 8px;';
  const J = (v) => trEscH(JSON.stringify(v));
  let h = `<div style="display:flex; justify-content:space-between; align-items:baseline; flex-wrap:wrap; gap:8px;">
      <b style="font-size:16px; color:${feitas === L.length && L.length ? 'var(--farol-ok)' : 'var(--tx-1)'};">${feitas} de ${L.length} conferidas</b>
      <span style="font-size:12px; color:var(--tx-4);">quem conferiu e quando vêm do login de cada uma</span></div>
    <div style="height:8px; background:var(--surface-2); border-radius:6px; overflow:hidden; margin:6px 0 10px;"><div style="height:100%; width:${L.length ? Math.round(feitas / L.length * 100) : 0}%; background:var(--farol-ok);"></div></div>`;
  if (ehProd) {
    const s = cfSegunda();
    const semana = L.filter((i) => { const fe = cfFeito(c, i); return fe && /lana/i.test(fe.quem || '') && fe.conferido_em && new Date(fe.conferido_em) >= s.quando; }).length;
    const ok = semana >= CF_META_LANA;
    h += `<div class="contexto" style="text-align:left; border-color:${ok ? 'var(--farol-ok)' : 'var(--farol-perto)'};">
      <b style="color:${ok ? 'var(--farol-ok)' : 'var(--tx-1)'};">Meta da Lana: ${semana} de ${CF_META_LANA} nesta semana${ok ? ' ✓' : ''}</b>
      <span style="font-size:12px; color:var(--tx-4);"> · desde seg ${s.dm} · ${CF.venda ? 'os que mais vendem primeiro' : 'a venda não abriu, lista em ordem alfabética'}</span></div>`;
  }
  // 12/11/2026 (Estoque): o envio fica à vista; antes parecia que não tinha salvado e a Rita mandou 5 vezes
  if (CF.enviada && CF.enviada.aba === c.aba) { const est = CF.estado && CF.estado.get(CF.enviada.f);
    h += `<div class="contexto" style="text-align:left; border-color:var(--farol-ok);"><b style="color:var(--farol-ok);">✓ Recebido: ${trEscH(CF.enviada.nb)} às ${CF.enviada.hora}</b>${est && est.estado !== 'SUBSTITUIDO' && new Date(est.enviado_em) >= new Date(CF.enviada.quando) ? ' — ' + trEscH(cfMsgOperador(est.mensagem)) : ` — entra na ${id === 'receitas' ? 'receita' : 'ficha'} na próxima passada (até 2 h). Não precisa mandar de novo.`}</div>`; }
  if (comecadas.length) h += `<div class="contexto" style="text-align:left; border-color:var(--farol-perto);"><b>${comecadas.length} ${comecadas.length === 1 ? 'conferência começada' : 'conferências começadas'} neste aparelho e ainda não ${comecadas.length === 1 ? 'enviada' : 'enviadas'}.</b>
      Os números que você digitou já estão nos campos — abra, confira e clique em <b>Marcar como conferida</b>.
      <a href="javascript:void(0)" onclick='CF.filtro="falta"; CF.busca=""; CF.aberto=${J(comecadas[0].id)}; cfRender("${id}");'>abrir a primeira</a></div>`;
  h += `<div style="display:flex; gap:8px; flex-wrap:wrap; align-items:center; margin-bottom:6px;">
      ${[['falta', 'falta conferir', L.length - feitas], ['feitas', 'conferidas', feitas], ['todas', 'todas', L.length]].map(([k, r, n]) => `<button class="preset-btn${CF.filtro === k ? ' active' : ''}" onclick="CF.filtro='${k}'; cfRender('${id}');">${r} · ${n}</button>`).join('')}
      ${ehProd && CF.venda ? `<button class="preset-btn" onclick="CF.ordem=CF.ordem==='venda'?'az':'venda'; cfRender('${id}');">ordem: ${porVenda ? 'mais vendidos' : 'A–Z'} ⇅</button>` : ''}
      <input id="cfBusca" placeholder="buscar pelo nome" value="${trEscH(CF.busca)}" oninput="cfBuscar('${id}', this.value)" style="flex:1 1 200px; ${campo}"></div>
    <datalist id="cfNomes">${(CF.nomes || []).map((n) => `<option value="${trEscH(n)}">`).join('')}</datalist>`;
  if (!lista.length) h += `<div class="contexto" style="border-color:var(--farol-ok);"><b style="color:var(--farol-ok);">${CF.filtro === 'falta' && !b ? '✓ Nada falta conferir aqui.' : 'Nada com esse filtro.'}</b></div>`;
  lista.slice(0, 60).forEach((i) => {
    const fe = cfFeito(c, i), ab = CF.aberto === i.id, com = cfComecada(c, i, rasc, resp), r = resp[i.id] || {};
    const fora = new Set(r.removidos || []);
    h += `<div class="contexto" style="text-align:left; margin:8px 0; ${fe ? 'border-color:var(--farol-ok);' : ''}">
      <div style="display:flex; gap:10px; align-items:center; flex-wrap:wrap; justify-content:space-between; cursor:pointer;" onclick='cfAbrir("${id}", ${J(i.id)})'>
        <div><b style="font-size:14.5px;">${trEscH(i.nb)}</b>
          <div style="font-size:12px; color:var(--tx-4);">${trEscH([i.gr, i.fam].filter(Boolean).join(' · '))}${i.mot ? ' · ' + trEscH(i.mot) : ''}${i.f && i.f !== i.nb ? ' · ficha: ' + trEscH(i.f) : ''}</div></div>
        <div style="display:flex; gap:6px; align-items:center; flex-wrap:wrap;">
          ${fe ? `<span style="font-size:12px; font-weight:700; color:var(--tx-2);">${fe.nao_fazemos_mais ? '✓ não fazemos mais' : 'enviada'} · ${trEscH(estNome(fe.quem) || fe.quem || '')} · ${embQuando(fe.conferido_em)}</span> ${cfEstadoEnvio(c, fe, i)}`
               : com ? `<span style="font-size:12px; font-weight:700; color:var(--farol-perto);">começada, não enviada</span>`
               : `<span style="font-size:12px; color:var(--tx-3);">${trEscH(c.st[i.g] || i.g || '')}</span>`}
          ${ehProd && CF.venda ? `<span style="font-size:12px; color:var(--tx-3);">${cfVendeu(i).toLocaleString('pt-BR', { maximumFractionDigits: 0 })} vendidos em 30 dias</span>` : ''}
          <span style="font-size:12px; color:var(--tx-4);">${i.i.length} ${i.i.length === 1 ? 'ingrediente' : 'ingredientes'} ${ab ? '▾' : '▸'}</span></div></div>`;
    if (ab) {
      const saipos = c.rende && i.g !== 'sem_lote';
      h += `<div id="tabelaCf" style="margin-top:8px; overflow-x:auto;"><table><thead><tr><th>Ingrediente</th><th style="text-align:right;">${i.g === 'sem_ficha' ? 'Referência' : 'Ficha'}</th>${saipos ? '<th style="text-align:right;">Saipos</th>' : ''}<th style="text-align:right;">Conferido</th><th></th></tr></thead><tbody>
        ${i.i.map((it, j) => { const tira = fora.has(j); return `<tr style="${tira ? 'opacity:.5; text-decoration:line-through;' : ''}">
          <td style="white-space:normal;">${trEscH(it.mp)} <span style="font-size:11.5px; color:var(--tx-4);">${trEscH((it.un || '').toLowerCase())}</span>${it.mpo && it.mpo !== it.mp ? `<div style="font-size:11px; color:var(--tx-5);">na ficha: ${trEscH(it.mpo)}</div>` : ''}</td>
          <td style="text-align:right; color:var(--tx-3);">${it.qf == null ? '—' : cfFmt(it.qf)}</td>
          ${saipos ? `<td style="text-align:right; color:var(--tx-3);">${it.qs == null ? '—' : cfFmt(it.qs)}</td>` : ''}
          <td style="text-align:right;"><input inputmode="decimal" ${tira ? 'disabled' : ''} data-cf="${trEscH(i.id)}|${j}" value="${tira ? '' : trEscH(cfValQ(c, i, j, rasc, resp))}" oninput="cfDigitou('${id}', this)" style="width:90px; text-align:right; ${campo}"></td>
          <td><button class="preset-btn" title="${tira ? 'voltar este ingrediente' : 'tirar este ingrediente da ficha'}" onclick='cfTirar("${id}", ${J(i.id)}, ${j})'>${tira ? '↺' : '×'}</button></td></tr>`; }).join('')}
        ${(r.extras || []).map((x, k) => `<tr><td><input list="cfNomes" data-cfx="${trEscH(i.id)}|${k}|mp" value="${trEscH(x.mp || '')}" oninput="cfExtra('${id}', this)" placeholder="ingrediente (nome da base)" style="width:100%; ${campo}"></td>
          <td></td>${saipos ? '<td></td>' : ''}<td style="text-align:right; white-space:nowrap;"><input inputmode="decimal" data-cfx="${trEscH(i.id)}|${k}|q" value="${trEscH(x.q || '')}" oninput="cfExtra('${id}', this)" placeholder="qtd" style="width:70px; text-align:right; ${campo}">
            <input data-cfx="${trEscH(i.id)}|${k}|un" value="${trEscH(x.un || '')}" oninput="cfExtra('${id}', this)" placeholder="un" style="width:44px; ${campo}"></td>
          <td><button class="preset-btn" onclick='cfExtraTirar("${id}", ${J(i.id)}, ${k})'>×</button></td></tr>`).join('')}
        ${c.rende ? `<tr><td><b>Rende</b> <span style="font-size:11.5px; color:var(--tx-4);">${trEscH((i.ru || '').toLowerCase())}</span></td><td style="text-align:right; color:var(--tx-3);">${i.r == null ? '—' : cfFmt(i.r)}</td>
          ${saipos ? `<td style="text-align:right; color:var(--tx-3);">${i.rs == null ? '—' : cfFmt(i.rs)}</td>` : ''}
          <td style="text-align:right;"><input inputmode="decimal" data-cf="${trEscH(i.id)}|r" value="${trEscH(cfValR(c, i, rasc, resp))}" oninput="cfDigitou('${id}', this)" style="width:90px; text-align:right; ${campo}"></td><td></td></tr>` : ''}
        </tbody></table></div>
        <div style="margin:6px 0;"><a href="javascript:void(0)" style="font-size:12.5px;" onclick='cfExtraPor("${id}", ${J(i.id)})'>+ ingrediente que falta</a></div>
        <textarea data-cf="${trEscH(i.id)}|o" oninput="cfDigitou('${id}', this)" placeholder="Observação (opcional)" style="width:100%; min-height:44px; ${campo}">${trEscH(rasc[i.id + '|o'] != null ? rasc[i.id + '|o'] : (r.obs || ''))}</textarea>
        <div style="display:flex; gap:8px; flex-wrap:wrap; margin-top:8px;">
          <button class="preset-btn" id="cfOk" style="font-size:14px; padding:10px 16px; border-color:var(--marca-amarelo);" onclick='cfEnviar("${id}", ${J(i.id)}, false)'>${fe ? '✓ Conferir de novo' : '✓ Marcar como conferida'}</button>
          ${c.naofaz ? `<button class="preset-btn" onclick='cfEnviar("${id}", ${J(i.id)}, true)'>Não fazemos mais</button>` : ''}</div>`;
    }
    h += `</div>`;
  });
  if (lista.length > 60) h += `<div style="font-size:12px; color:var(--tx-4); text-align:center;">mostrando 60 de ${lista.length} — use a busca</div>`;
  alvo.innerHTML = h;
}
function cfAbrir(id, iid) { CF.aberto = CF.aberto === iid ? null : iid; CF.enviada = null; cfRender(id); }
function cfBuscar(id, v) {
  CF.busca = v; clearTimeout(window._cfB);
  window._cfB = setTimeout(() => { cfRender(id); const e = document.getElementById('cfBusca'); if (e) { e.focus(); e.setSelectionRange(e.value.length, e.value.length); } }, 350);
}
// digitar guarda no aparelho a cada tecla (nas mesmas chaves das páginas soltas); só o botão envia ao banco
function cfDigitou(id, el) {
  const c = CONF_FICHA[id], rasc = cfRasc(c);
  rasc[el.dataset.cf] = el.value; cfGuardar(c.chave + '_rascunho', rasc);
}
function cfMexeResp(id, iid, fn) { const c = CONF_FICHA[id], resp = cfResp(c); resp[iid] = resp[iid] || {}; fn(resp[iid]); cfGuardar(c.chave + '_respostas', resp); }
function cfTirar(id, iid, j) { cfMexeResp(id, iid, (r) => { const s = new Set(r.removidos || []); s.has(j) ? s.delete(j) : s.add(j); r.removidos = [...s]; }); cfRender(id); }
function cfExtraPor(id, iid) { cfMexeResp(id, iid, (r) => { r.extras = [...(r.extras || []), { mp: '', q: '', un: '' }]; }); cfRender(id); }
function cfExtraTirar(id, iid, k) { cfMexeResp(id, iid, (r) => { r.extras = (r.extras || []).filter((_, x) => x !== k); }); cfRender(id); }
function cfExtra(id, el) {
  const p = el.dataset.cfx.split('|'), campo = p.pop(), k = +p.pop(), iid = p.join('|');
  cfMexeResp(id, iid, (r) => { r.extras = r.extras || []; r.extras[k] = Object.assign({}, r.extras[k], { [campo]: el.value }); });
}
// as linhas no formato de ft_conferencia (o mesmo das páginas soltas): grama e ml viram quilo e litro
function cfLinhas(c, i, naofaz) {
  if (naofaz) return [{ materia_prima: 'NAO FAZEMOS MAIS', qtd_ficha: null, qtd_medida: 0, un: null }];
  const rasc = cfRasc(c), resp = cfResp(c), r = resp[i.id] || {}, fora = new Set(r.removidos || []), out = [];
  const base = (v, un) => { const u = cfUn(un), U = u ? u.toUpperCase() : null;
    if (v == null) return { v: null, un: u === 'g' ? 'KG' : u === 'ml' ? 'LT' : U };
    if (u === 'g') return { v: +(v / 1000).toFixed(6), un: 'KG' }; if (u === 'ml') return { v: +(v / 1000).toFixed(6), un: 'LT' }; return { v, un: U }; };
  const poe = (mp, qf, v, un) => { const a = base(v, un), b = base(qf == null ? null : qf, un);
    out.push({ materia_prima: String(mp).slice(0, 200), qtd_ficha: b.v, qtd_medida: a.v, un: a.un || null }); };
  for (let j = 0; j < i.i.length; j++) {
    const it = i.i[j], v = fora.has(j) ? 0 : cfNum(cfValQ(c, i, j, rasc, resp));
    if (Number.isNaN(v)) throw new Error(`${it.mp}: não entendi o número — use só algarismos e vírgula`);
    if (v === null) { if (c.rende && i.g !== 'sem_ficha' && it.qf != null) throw new Error(`${it.mp} ficou em branco — se não vai, ponha 0 ou tire com ×`); continue; }
    poe(it.mpo || it.mp, i.g === 'sem_ficha' ? (it.qs ?? null) : (it.qf ?? null), v, it.un);
  }
  for (const x of (r.extras || [])) {
    const nm = String(x.mp || '').trim(), q = cfNum(x.q);
    if (!nm && (x.q == null || x.q === '')) continue;
    if (!nm) throw new Error('falta o nome do ingrediente acrescentado');
    if (q === null || Number.isNaN(q)) throw new Error(`falta a quantidade de ${nm} (só algarismos e vírgula)`);
    poe(nm, null, q, x.un);
  }
  if (c.rende) {
    const rv = cfNum(cfValR(c, i, rasc, resp));
    if (Number.isNaN(rv) || rv === 0) throw new Error('confira o rendimento');
    if (rv === null && (i.g !== 'sem_ficha' || out.length)) throw new Error('falta quanto rende');
    if (rv !== null) poe('RENDIMENTO', i.r ?? null, rv, i.ru);
  }
  const obs = String(rasc[i.id + '|o'] != null ? rasc[i.id + '|o'] : (r.obs || '')).trim();
  if (!out.length && obs) poe('RECEITA EM TEXTO', null, 0, null);
  if (!out.length) throw new Error('escreva as quantidades antes de enviar');
  return out;
}
async function cfEnviar(id, iid, naofaz) {
  const c = CONF_FICHA[id], i = (CF.fila[c.aba] || []).find((x) => x.id === iid);
  if (!i) return;
  let linhas;
  try { linhas = cfLinhas(c, i, naofaz); } catch (e) { return avisoAcao('atencao', `! ${i.nb}: ${e.message}.`); }
  if (c.rende && i.r && !naofaz) {
    const rv = (linhas.find((l) => l.materia_prima === 'RENDIMENTO') || {}).qtd_medida;
    if (rv && (rv > i.r * 10 || rv < i.r / 10) && !confirm(`Rende ${cfFmt(rv)} contra ${cfFmt(i.r)} da ficha. Está certo?`)) return;
  }
  const rasc = cfRasc(c), obs = String(rasc[i.id + '|o'] != null ? rasc[i.id + '|o'] : ((cfResp(c)[i.id] || {}).obs || '')).trim() || null;
  const bt = document.getElementById('cfOk'); if (bt) { bt.disabled = true; bt.textContent = 'Enviando…'; }
  avisoAcao('enviando', `Enviando ${i.nb}…`);
  const r = await trRpcSeguro('ft_conferencia_gravar', { p_aba: c.aba, p_ficha: String(i.f || i.nb).slice(0, 200), p_linhas: linhas, p_obs: obs });
  if (!r.ok) {
    if (bt) { bt.disabled = false; bt.textContent = '✓ Marcar como conferida'; }
    return avisoAcao('erro', `✗ ${i.nb} NÃO chegou: ${await trErroDe(r)}. O que você digitou continua aqui — tente de novo.`, () => cfEnviar(id, iid, naofaz));
  }
  const volta = await r.json().catch(() => []);
  if (volta && volta[0]) CF.feita[c.aba].set(volta[0].ficha, volta[0]);
  // o aparelho esquece o rascunho do que já chegou ao banco (e a página solta passa a ver "feito")
  const ra = cfRasc(c); Object.keys(ra).filter((k) => k.startsWith(i.id + '|')).forEach((k) => delete ra[k]); cfGuardar(c.chave + '_rascunho', ra);
  cfMexeResp(id, iid, (x) => { x.feito = true; x.enviado_em = new Date().toISOString(); delete x.itens; delete x.extras; delete x.obs; delete x.rende; delete x.removidos; });
  CF.aberto = null;
  CF.enviada = { aba: c.aba, f: i.f || i.nb, nb: i.nb + (naofaz ? ' (não fazemos mais)' : ''), hora: avisoHora(), quando: new Date(Date.now() - 60000).toISOString() };
  avisoAcao('ok', `✓ ${i.nb}${naofaz ? ' — não fazemos mais' : ''}: recebida às ${CF.enviada.hora} — entra na ${id === 'receitas' ? 'receita' : 'ficha'} na próxima passada (até 2 h).`);
  cfRender(id);
  confAbasPintar();
  // o estado do envio que acabou de chegar (na fila, ou parado com o motivo), sem esperar recarregar a tela
  await cfEstadoCarregar(i.f || i.nb);
  if (CONF_ABA === id) cfRender(id);
}

// ==================================================================
// REQUISIÇÃO DE MATERIAL (dono, 05/11/2026: "os usuários do delivery, salão e cozinhas farão pedido por esse canal";
// proposta contexto/propostas-telas/2026-10-29-requisicao-de-material.md). Duas telas:
//   reqpedir   — o líder pede o que a praça precisa (a praça vem de quem ele é: rh_eu_lider; quem separa escolhe a praça)
//   reqseparar — Habrahan, Rita e o dono: a lista do dia somada por item, cada requisição com o que saiu, e os itens fora
//                da base, que vão ao dono.
// Banco do chat Estoque: est_requisicao_pedir / _separar / _cancelar, vw_est_requisicao(_item, _do_dia, _fora_da_base).
// Regra do dono (29/10 13:15): a praça pede TUDO; o que sai pela ficha aparece na linha mas não baixa. Enquanto o banco
// não marcar sai_por_ficha, a tela mostra o rótulo pela classe da base (MP e EMBALAGEM) e repete a recusa do banco.
// ==================================================================
// 05/11/2026 ~02:30: banco aplicado (requisicao_pede_tudo_sai_por_ficha). A lista vem de vw_est_requisicao_catalogo (cada login
// vê a própria loja), e "sai pela ficha" vem do banco em cada linha (catálogo, item, lista do dia). A praça vem do login
// (est_requisicao_quem_pede ou o setor do líder); só quem separa escolhe a praça.
const REQ = { itens: null, sai: {}, carrinho: {}, busca: '', manda: false, lider: null, praca: '', minhas: [], unidade: null };
const REQ_PRACAS = ['COZINHA', 'DELIVERY', 'SALÃO', 'PRODUÇÃO'];
const reqSaiPelaFicha = (nb) => !!REQ.sai[nb];
const reqFmt = (v) => v == null || v === '' ? '' : Number(v).toLocaleString('pt-BR', { maximumFractionDigits: 3 });
function reqQuando(ts) { if (!ts) return ''; const d = new Date(ts); return d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', timeZone: 'America/Sao_Paulo' }) + ' ' + d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', timeZone: 'America/Sao_Paulo' }); }
function reqSituacao(r) {
  const s = String(r.leitura || r.situacao || '');
  const cor = /CANCEL/.test(s) ? 'var(--tx-4)' : /SEPARADA|ENTREGUE/.test(s) ? 'var(--farol-ok)' : 'var(--farol-perto)';
  return `<span style="color:${cor}; font-weight:700;">${trEscH(s.toLowerCase())}</span>`;
}

async function entrarReqPedir() {
  const alvo = document.getElementById('view-reqpedir');
  if (!alvo) return;
  EST_TELA = 'reqpedir';
  if (!rmbSessao()) { alvo.innerHTML = `<div class="contexto">Entre no painel para pedir material.</div>`; return; }
  alvo.innerHTML = `<div class="contexto">Carregando…</div>`;
  const u = await estLojaDaTela(alvo, entrarReqPedir); if (!u) return;
  try {
    const [itens, rl, rm] = await Promise.all([
      consultarTudo(`vw_est_requisicao_catalogo?select=nome_base,un,sai_por_ficha&unidade=eq.${encodeURIComponent(u)}&order=nome_base`),
      trRpcSeguro('rh_eu_lider', {}), trRpcSeguro('est_vejo_todas_as_pracas', {})]);
    const vistos = new Set();
    REQ.itens = itens.filter((x) => x.nome_base && !vistos.has(x.nome_base) && vistos.add(x.nome_base));
    REQ.sai = {}; for (const x of REQ.itens) if (x.sai_por_ficha) REQ.sai[x.nome_base] = true;
    const lid = rl.ok ? await rl.json() : [];
    REQ.lider = (Array.isArray(lid) ? lid : []).find((x) => x.unidade === u) || null;
    REQ.manda = rm.ok ? !!(await rm.json()) : false;
    REQ.unidade = u;
    if (!REQ.praca) REQ.praca = REQ.lider ? REQ.lider.setor : '';
    await reqMinhasCarregar();
    reqPedirDesenhar();
  } catch (e) {
    alvo.innerHTML = `<div class="contexto" style="border-color:var(--farol-fora);">✗ Não consegui abrir a requisição: ${trEscH(e.message)} <button class="preset-btn" onclick="entrarReqPedir()">Tentar de novo</button></div>`;
  }
}
async function reqMinhasCarregar() {
  // o banco mostra a cada login as requisições da praça dele (quem separa vê todas)
  REQ.minhas = await consultarTudo(`vw_est_requisicao?select=*&unidade=eq.${encodeURIComponent(REQ.unidade)}&order=criado_em.desc&limit=20`).catch(() => []);
}
function reqPedirDesenhar() {
  const alvo = document.getElementById('view-reqpedir');
  if (!alvo) return;
  const podePedir = true;   // quem pede é o banco que decide (líder, est_requisicao_quem_pede ou quem separa); a recusa vem no aviso
  const b = REQ.busca.trim().toLowerCase();
  const noCarrinho = Object.entries(REQ.carrinho).filter(([, q]) => Number(q) > 0);
  const lista = b.length < 2 ? [] : REQ.itens.filter((x) => x.nome_base.toLowerCase().includes(b)).slice(0, 40);
  const campo = 'background:var(--surface-2); border:1px solid var(--line); border-radius:8px; color:var(--tx-1); padding:8px 10px; font:inherit;';
  const linhaItem = (nb, un) => {
    const q = REQ.carrinho[nb] || '';
    return `<div style="display:flex; gap:8px; align-items:center; padding:6px 0; border-bottom:1px solid var(--line);">
      <div style="flex:1 1 auto; min-width:0;"><b>${trEscH(nb)}</b>${reqSaiPelaFicha(nb) ? ' <span style="font-size:11.5px; color:var(--tx-4);">· sai pela ficha</span>' : ''}</div>
      <input inputmode="decimal" value="${trEscH(q)}" placeholder="qtd" oninput='reqQtd(${JSON.stringify(nb)}, this.value)' style="width:76px; text-align:right; ${campo}">
      <span style="width:34px; font-size:12px; color:var(--tx-3);">${trEscH(String(un || '').toLowerCase())}</span></div>`;
  };
  const unDe = (nb) => (REQ.itens.find((x) => x.nome_base === nb) || {}).un || '';
  alvo.innerHTML = `<h2>Pedir material</h2>
    <div class="caption-label">${trEscH(estNomeLoja(REQ.unidade))}${REQ.praca ? ' · praça <b>' + trEscH(REQ.praca) + '</b>' : ''}. Peça tudo o que a praça precisa; quem separa entrega e dá a baixa no estoque.</div>
    ${REQ.manda ? `<div style="margin:8px 0;">Praça: ${REQ_PRACAS.map((p) => `<button class="preset-btn${REQ.praca === p ? ' active' : ''}" onclick='REQ.praca=${JSON.stringify(p)}; reqPedirDesenhar();'>${trEscH(p.toLowerCase())}</button>`).join(' ')}</div>` : ''}
    <input id="reqBusca" type="search" placeholder="buscar o item (2 letras ou mais)" value="${trEscH(REQ.busca)}" oninput="reqBuscar(this.value)" style="width:100%; max-width:420px; margin:8px 0; ${campo}">
    <div id="reqLista">${lista.map((x) => linhaItem(x.nome_base, x.un)).join('') || (b.length >= 2 ? `<div class="caption-label">Nenhum item com "${trEscH(REQ.busca)}" na base desta loja. <a href="javascript:void(0)" onclick="reqForaDaBase()">Pedir mesmo assim (vai para o Neto validar)</a></div>` : '')}</div>
    <div class="section-label" style="margin-top:14px;">No pedido: ${noCarrinho.length} ${noCarrinho.length === 1 ? 'item' : 'itens'}</div>
    ${noCarrinho.map(([nb]) => linhaItem(nb, unDe(nb))).join('')}
    <textarea id="reqObs" placeholder="observação (opcional)" style="width:100%; min-height:44px; margin-top:8px; ${campo}"></textarea>
    <div style="margin:10px 0;"><button class="preset-btn" id="reqBtPedir" ${noCarrinho.length && podePedir ? '' : 'disabled'} style="font-size:15px; padding:10px 18px; border-color:var(--marca-amarelo);" onclick="reqEnviar()">Pedir</button></div>
    <div class="section-label" style="margin-top:18px;">${REQ.manda ? 'Requisições desta loja' : 'Requisições da sua praça'}</div>
    ${REQ.minhas.length ? `<div id="tabelaReqMinhas" style="overflow-x:auto;"><table><thead><tr><th>Número</th><th>Quando</th><th>Praça</th><th style="text-align:right;">Itens</th><th>Situação</th></tr></thead><tbody>
      ${REQ.minhas.map((r) => `<tr><td>${trEscH(r.numero)}</td><td>${trEscH(reqQuando(r.criado_em))}</td><td>${trEscH(String(r.praca || '').toLowerCase())}</td><td style="text-align:right;">${r.itens}${r.itens_a_menos ? ` <span style="color:var(--farol-perto);">(${r.itens_a_menos} a menos)</span>` : ''}</td><td>${reqSituacao(r)}${r.situacao === 'ABERTA' ? ` <button class="preset-btn" onclick='reqCancelar(${r.id}, ${JSON.stringify(r.numero)})'>cancelar</button>` : ''}</td></tr>`).join('')}
    </tbody></table></div>` : '<div class="caption-label">Nenhuma requisição ainda.</div>'}`;
}
function reqBuscar(v) {
  REQ.busca = v; clearTimeout(window._reqB);
  window._reqB = setTimeout(() => { reqPedirDesenhar(); const e = document.getElementById('reqBusca'); if (e) { e.focus(); e.setSelectionRange(e.value.length, e.value.length); } }, 250);
}
function reqQtd(nb, v) {
  const s = String(v).trim();
  if (s === '') delete REQ.carrinho[nb]; else REQ.carrinho[nb] = s.replace(',', '.');
  const n = Object.values(REQ.carrinho).filter((q) => Number(q) > 0).length;
  const bt = document.getElementById('reqBtPedir'); if (bt) bt.disabled = !n;
}
function reqForaDaBase() {
  const nome = REQ.busca.trim().toUpperCase(); if (!nome) return;
  if (!REQ.itens.some((x) => x.nome_base === nome)) REQ.itens.push({ nome_base: nome, un: '', fora: true });
  REQ.busca = nome.toLowerCase(); reqPedirDesenhar();
  avisoAcao('atencao', `! "${nome}" não está na base: digite a quantidade. Ele vai no pedido e o Neto valida antes de sair do estoque.`);
}
async function reqEnviar() {
  const itens = Object.entries(REQ.carrinho).filter(([, q]) => Number(q) > 0)
    .map(([nb, q]) => ({ item: nb, qtd: Number(q) }));   // sem "un": a baixa usa a medida do estoque (Estoque, 05/11)
  if (!itens.length) return avisoAcao('atencao', '! Digite a quantidade de pelo menos um item.');
  if (itens.some((x) => !(x.qtd > 0))) return avisoAcao('atencao', '! Quantidade tem de ser um número maior que zero.');
  if (REQ.manda && !REQ.praca) return avisoAcao('atencao', '! Escolha a praça que está pedindo.');
  const obs = (document.getElementById('reqObs') || {}).value || null;
  const bt = document.getElementById('reqBtPedir'); if (bt) { bt.disabled = true; bt.textContent = 'Enviando…'; }
  avisoAcao('enviando', 'Enviando a requisição…');
  const r = await trRpcSeguro('est_requisicao_pedir', { p_unidade: REQ.unidade, p_itens: itens, p_praca: REQ.manda ? REQ.praca : null, p_observacao: obs ? obs.trim() || null : null });
  if (!r.ok) {
    if (bt) { bt.disabled = false; bt.textContent = 'Pedir'; }
    return avisoAcao('erro', `✗ A requisição NÃO chegou: ${await trErroDe(r)}. O que você digitou continua aqui.`, reqEnviar);
  }
  const x = ((await r.json()) || [])[0] || {};
  REQ.carrinho = {}; REQ.busca = '';
  avisoAcao('ok', `✓ Requisição ${x.numero || ''} enviada às ${avisoHora()}, ${x.itens} ${x.itens === 1 ? 'item' : 'itens'}${x.fora_da_base ? ` (${x.fora_da_base} fora da base: o Neto valida)` : ''}.`);
  await reqMinhasCarregar(); reqPedirDesenhar();
}
async function reqCancelar(id, numero) {
  const motivo = prompt(`Cancelar ${numero}? Diga o motivo:`); if (motivo === null) return;
  avisoAcao('enviando', `Cancelando ${numero}…`);
  const r = await trRpcSeguro('est_requisicao_cancelar', { p_id: id, p_motivo: motivo.trim() || null });
  if (!r.ok) return avisoAcao('erro', `✗ ${numero} NÃO foi cancelada: ${await trErroDe(r)}.`, () => reqCancelar(id, numero));
  avisoAcao('ok', `✓ ${numero} cancelada às ${avisoHora()}.`);
  if (EST_TELA === 'reqseparar') entrarReqSeparar(); else { await reqMinhasCarregar(); reqPedirDesenhar(); }
}

// ---- Separar: quem entrega (Habrahan, Rita, dono) ----
const REQS = { abertas: [], itens: [], dia: [], fora: [], separado: {}, unidade: null };
async function entrarReqSeparar() {
  const alvo = document.getElementById('view-reqseparar');
  if (!alvo) return;
  EST_TELA = 'reqseparar';
  if (!rmbSessao()) { alvo.innerHTML = `<div class="contexto">Entre no painel para separar as requisições.</div>`; return; }
  alvo.innerHTML = `<div class="contexto">Carregando…</div>`;
  const u = await estLojaDaTela(alvo, entrarReqSeparar); if (!u) return;
  try {
    const q = encodeURIComponent(u);
    const [ab, dia, fora] = await Promise.all([
      consultarTudo(`vw_est_requisicao?select=*&unidade=eq.${q}&situacao=eq.ABERTA&order=criado_em`),
      consultarTudo(`vw_est_requisicao_do_dia?select=*&unidade=eq.${q}&order=nome_base`).catch(() => []),
      consultarTudo('vw_est_requisicao_fora_da_base?select=*&order=ultima_vez.desc').catch(() => [])]);
    REQS.abertas = ab; REQS.dia = dia; REQS.fora = fora; REQS.unidade = u;
    REQS.itens = ab.length ? await consultarTudo(`vw_est_requisicao_item?select=*&id_requisicao=in.(${ab.map((r) => r.id).join(',')})&order=id`) : [];
    reqSepararDesenhar();
  } catch (e) {
    alvo.innerHTML = `<div class="contexto" style="border-color:var(--farol-fora);">✗ Não consegui ler as requisições: ${trEscH(e.message)} <button class="preset-btn" onclick="entrarReqSeparar()">Tentar de novo</button></div>`;
  }
}
function reqSepararDesenhar() {
  const alvo = document.getElementById('view-reqseparar');
  if (!alvo) return;
  const campo = 'background:var(--surface-2); border:1px solid var(--line); border-radius:8px; color:var(--tx-1); padding:6px 8px; font:inherit;';
  const diaAberto = REQS.dia.filter((x) => !x.situacao || /ABERT|SEPARAR/i.test(x.situacao));
  alvo.innerHTML = `<h2>Separar requisições</h2>
    <div class="caption-label">${trEscH(estNomeLoja(REQS.unidade))}: ${REQS.abertas.length} ${REQS.abertas.length === 1 ? 'requisição esperando' : 'requisições esperando'}. Separe, ajuste a quantidade que saiu e clique em <b>Entreguei</b>: a baixa no estoque é pelo que saiu.</div>
    ${diaAberto.length ? `<div class="section-label">Somado por item</div><div id="tabelaReqDia" style="overflow-x:auto;"><table><thead><tr><th>Item</th><th style="text-align:right;">Pedido</th><th style="text-align:right;">Saldo</th><th>Praças</th></tr></thead><tbody>
      ${diaAberto.map((x) => `<tr><td>${trEscH(x.nome_base)}${x.sai_por_ficha ? ' <span style="font-size:11px; color:var(--tx-4);">· sai pela ficha</span>' : ''}</td><td style="text-align:right;">${reqFmt(x.qtd_pedida)} ${trEscH(String(x.un || '').toLowerCase())}</td>
        <td style="text-align:right;${Number(x.saldo) < Number(x.qtd_pedida) ? ' color:var(--farol-fora); font-weight:700;' : ''}">${x.saldo == null ? '–' : reqFmt(x.saldo)}</td><td style="white-space:normal;">${trEscH(String(x.pracas || '').toLowerCase())}</td></tr>`).join('')}
    </tbody></table></div>` : ''}
    ${REQS.abertas.map((r) => {
      const L = REQS.itens.filter((i) => i.id_requisicao === r.id);
      return `<div class="contexto" style="text-align:left; margin:12px 0;">
        <div style="display:flex; justify-content:space-between; gap:8px; flex-wrap:wrap;"><b>${trEscH(r.numero)} · ${trEscH(String(r.praca || '').toLowerCase())}</b>
          <span style="font-size:12px; color:var(--tx-4);">${trEscH(String(r.pedido_por || '').split('@')[0])} · ${trEscH(reqQuando(r.criado_em))}</span></div>
        ${r.observacao ? `<div style="font-size:12.5px; color:var(--tx-3); margin-top:2px;">${trEscH(r.observacao)}</div>` : ''}
        <div id="tabelaReq${r.id}" style="overflow-x:auto; margin-top:6px;"><table><thead><tr><th>Item</th><th style="text-align:right;">Pedido</th><th style="text-align:right;">Saiu</th></tr></thead><tbody>
          ${L.map((i) => `<tr><td style="white-space:normal;">${trEscH(i.nome_base || i.nome_pedido)}${i.fora_da_base ? ' <span style="font-size:11px; color:var(--farol-perto);">· fora da base: não sai, o Neto valida</span>' : i.sai_por_ficha ? ' <span style="font-size:11px; color:var(--tx-4);">· sai pela ficha (não baixa aqui)</span>' : ''}</td>
            <td style="text-align:right;">${reqFmt(i.qtd_pedida)} ${trEscH(String(i.un || '').toLowerCase())}</td>
            <td style="text-align:right;">${i.fora_da_base ? '–' : `<input inputmode="decimal" value="${trEscH(REQS.separado[i.id] != null ? REQS.separado[i.id] : reqFmt(i.qtd_pedida))}" oninput="REQS.separado[${i.id}]=this.value" style="width:76px; text-align:right; ${campo}">`}</td></tr>`).join('')}
        </tbody></table></div>
        <div style="margin-top:8px; display:flex; gap:8px; flex-wrap:wrap;"><button class="preset-btn" style="border-color:var(--marca-amarelo);" onclick="reqEntregar(${r.id})">Entreguei</button>
          <button class="preset-btn" onclick='reqCancelar(${r.id}, ${JSON.stringify(r.numero)})'>cancelar</button></div></div>`;
    }).join('') || '<div class="contexto">Nenhuma requisição esperando nesta loja.</div>'}
    ${REQS.fora.length ? `<div class="section-label" style="margin-top:18px;">Pedidos fora da base: o Neto valida</div><div id="tabelaReqFora" style="overflow-x:auto;"><table><thead><tr><th>Como pediram</th><th style="text-align:right;">Vezes</th><th>Desde</th><th>Quem pediu</th></tr></thead><tbody>
      ${REQS.fora.map((x) => `<tr><td style="white-space:normal;">${trEscH(x.nome_pedido)}</td><td style="text-align:right;">${x.vezes_pedido}</td><td>${trEscH(reqQuando(x.primeira_vez))}</td><td style="white-space:normal;">${trEscH(String(x.quem_pediu || '').replace(/@[^,\s]+/g, ''))}</td></tr>`).join('')}
    </tbody></table></div>` : ''}`;
}
async function reqEntregar(id) {
  const r0 = REQS.abertas.find((r) => r.id === id) || {};
  const L = REQS.itens.filter((i) => i.id_requisicao === id && !i.fora_da_base);
  const sep = [];
  for (const i of L) {
    const s = REQS.separado[i.id];
    if (s == null) continue;
    const t = String(s).trim(), n = Number(t.includes(',') ? t.replace(/\./g, '').replace(',', '.') : t);
    if (String(s).trim() === '' || !(n >= 0)) return avisoAcao('atencao', `! A quantidade que saiu de ${i.nome_base} não é um número.`);
    sep.push({ id_item: i.id, qtd: n });
  }
  avisoAcao('enviando', `Gravando a entrega de ${r0.numero || ''}…`);
  const r = await trRpcSeguro('est_requisicao_separar', { p_id: id, p_separado: sep, p_quem: null });
  if (!r.ok) return avisoAcao('erro', `✗ A entrega de ${r0.numero || ''} NÃO foi gravada: ${await trErroDe(r)}.`, () => reqEntregar(id));
  const x = ((await r.json()) || [])[0] || {};
  L.forEach((i) => delete REQS.separado[i.id]);
  avisoAcao('ok', `✓ ${x.numero || r0.numero} entregue às ${avisoHora()}: ${x.itens} ${x.itens === 1 ? 'item' : 'itens'}${x.nao_atendidos ? `, ${x.nao_atendidos} sem sair` : ''}. A baixa no estoque já conta.`);
  entrarReqSeparar();
}
