// Leitura dos dados de Chegada e Escala do Delivery. Só leituras (GET) pelo núcleo do portal, só os campos mínimos.
// Tudo o que depende do ambiente entra por `deps` (injetável nos testes):
//   deps.trFetch(url, { method: 'GET' })  deps.modelo (operacao-modelo.js)  deps.lojaCarregar()  deps.lojaAtual()
// Este arquivo não lê sessão, chave nem armazenamento do navegador: o cabeçalho de acesso é do núcleo.
// Uso no navegador: window.DeliveryDados.criar({...}). Uso em teste: require('./operacao-dados.js').criar({...}).
(function (raiz, fabrica) {
  const api = fabrica();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else raiz.DeliveryDados = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const LIMITE = 250;
  const MAX_PAGINAS = 8;
  const SELECT_ESCALA = 'dia,unidade,turno,nome_na_escala,inicio,fim,gravado_em';
  const ORDEM_ESCALA = 'dia.asc,unidade.asc,turno.asc,nome_na_escala.asc,inicio.asc,fim.asc,gravado_em.asc';
  const FONTES = {
    foody: {
      tabela: 'foody_entregas', ordem: 'uid.asc',
      select: 'data_local,unidade,turno,entregador,coleta,despacho,entrega,importado_em'
    },
    trackeat: {
      tabela: 'trackeat_api_entregas', ordem: 'id_delivery.asc',
      select: 'data_local,unidade,turno,entregador,coleta,saida,entrega,importado_em'
    }
  };
  const MSG_ESCALA_NAO_LIBERADA = 'A leitura da escala ainda não foi liberada';
  const enc = encodeURIComponent;

  function urlEscala(dia, loja, offset) {
    return 'motoboy_escala?select=' + SELECT_ESCALA + '&dia=eq.' + enc(dia) + '&unidade=eq.' + enc(loja) +
      '&order=' + ORDEM_ESCALA + '&limit=' + LIMITE + '&offset=' + offset;
  }
  function urlAtividade(fonte, dia, loja, offset) {
    const f = FONTES[fonte];
    return f.tabela + '?select=' + f.select + '&data_local=eq.' + enc(dia) + '&unidade=eq.' + enc(loja) +
      '&order=' + f.ordem + '&limit=' + LIMITE + '&offset=' + offset;
  }

  // Junta o resultado de várias lojas (Rede = uma consulta por loja concreta).
  function combinar(resultados) {
    if (resultados.some((r) => r.estado === 'descartado')) return { estado: 'descartado', rows: [] };
    if (resultados.some((r) => r.estado === 'sessao')) return { estado: 'sessao', rows: [] };
    const com = resultados.filter((r) => r.estado === 'ok' || r.estado === 'parcial');
    if (!com.length) {
      return { estado: resultados.some((r) => r.estado === 'naoliberada') ? 'naoliberada' : 'falha', rows: [] };
    }
    const rows = [].concat(...com.map((r) => r.rows));
    return { estado: com.length === resultados.length && com.every((r) => r.estado === 'ok') ? 'ok' : 'parcial', rows };
  }

  function criar(deps) {
    const M = deps.modelo;

    // Uma loja, páginas de 250, no máximo 8. Última página cheia = PARCIAL. Qualquer erro = sem dados daquela leitura.
    async function paginar(montar, vigente) {
      const rows = [];
      for (let p = 0; p < MAX_PAGINAS; p++) {
        if (!vigente()) return { estado: 'descartado', rows: [] };
        let r;
        try { r = await deps.trFetch(montar(p * LIMITE), { method: 'GET' }); } catch (e) { return { estado: vigente() ? 'falha' : 'descartado', rows: [] }; }
        if (!vigente()) return { estado: 'descartado', rows: [] };
        if (r.status === 401) return { estado: 'sessao', rows: [] };
        if (r.status === 403) return { estado: 'naoliberada', rows: [] };
        if (!r.ok) return { estado: 'falha', rows: [] };
        let j;
        try { j = await r.json(); } catch (e) { return { estado: vigente() ? 'falha' : 'descartado', rows: [] }; }
        if (!vigente()) return { estado: 'descartado', rows: [] };
        if (!Array.isArray(j)) return { estado: 'falha', rows: [] };
        for (const x of j) rows.push(x);
        if (j.length < LIMITE) return { estado: 'ok', rows };
      }
      return { estado: 'parcial', rows };
    }

    async function lerPorLoja(montar, ctx, vigente) {
      const res = [];
      for (const loja of ctx.lojas) {
        const r = await paginar((off) => montar(loja, off), vigente);
        res.push(r);
        if (r.estado === 'descartado' || r.estado === 'sessao') break;
      }
      return combinar(res);
    }

    // Quem pode ver o quê: lista de lojas autorizadas (resposta de lojaCarregar) + loja escolhida + dia válido.
    async function contexto(dia) {
      if (!M.validarDia(dia)) return { estado: 'dia_invalido', mensagem: 'Escolha um dia válido.' };
      let info = null;
      try { info = await deps.lojaCarregar(); } catch (e) { info = null; }
      if (!info || !Array.isArray(info.lojas)) return { estado: 'carregando_lojas', mensagem: 'Carregando as lojas autorizadas' };
      if (!info.lojas.length) return { estado: 'sem_cadastro', mensagem: 'Esta conta não tem loja cadastrada para ver o Delivery.' };
      const loja = deps.lojaAtual();
      const lojas = M.lojasPermitidas(info.lojas, loja);
      if (!lojas.length) return { estado: 'sem_loja', mensagem: 'Escolha uma das lojas autorizadas para ver esta tela.' };
      return { estado: 'ok', dia, loja, allowlist: info.lojas.slice(), lojas };
    }

    async function lerEscala(ctx, vigente) {
      if (!ctx || ctx.estado !== 'ok' || !ctx.lojas.length) return { estado: 'falha', linhas: [], parcial: true };
      const r = await lerPorLoja((loja, off) => urlEscala(ctx.dia, loja, off), ctx, vigente);
      if (r.estado === 'descartado' || r.estado === 'sessao') return { estado: r.estado, linhas: [], parcial: false };
      if (r.estado === 'naoliberada') return { estado: 'naoliberada', linhas: [], parcial: false, mensagem: MSG_ESCALA_NAO_LIBERADA };
      if (r.estado === 'falha') return { estado: 'falha', linhas: [], parcial: true };
      const n = M.normalizarEscala(r.rows);
      const linhas = M.filtrarEscala(n.linhas, { allowlist: ctx.allowlist, lojaEscolhida: ctx.loja, dia: ctx.dia });
      const parcial = r.estado === 'parcial' || n.parcial;
      return { estado: parcial ? 'parcial' : 'ok', linhas, parcial };
    }

    // Chegada: SEMPRE as duas fontes (cada uma pode falhar ou vir vazia sem cortar a outra).
    async function lerAtividade(ctx, vigente) {
      if (!ctx || ctx.estado !== 'ok' || !ctx.lojas.length) return { estado: 'falha', linhas: [], fontes: {}, parcial: true };
      const nomes = Object.keys(FONTES);
      const rs = await Promise.all(nomes.map((f) => lerPorLoja((loja, off) => urlAtividade(f, ctx.dia, loja, off), ctx, vigente)));
      if (rs.some((r) => r.estado === 'descartado')) return { estado: 'descartado', linhas: [], fontes: {}, parcial: false };
      if (rs.some((r) => r.estado === 'sessao')) return { estado: 'sessao', linhas: [], fontes: {}, parcial: false };
      const fontes = {}, estados = {};
      nomes.forEach((f, i) => {
        const usavel = rs[i].estado === 'ok' || rs[i].estado === 'parcial';
        fontes[f] = usavel ? rs[i].rows : null;
        estados[f] = rs[i].estado;
      });
      const g = M.agruparAtividade(fontes, { allowlist: ctx.allowlist, lojaEscolhida: ctx.loja, dia: ctx.dia, estados });
      const final = {};
      nomes.forEach((f) => { final[f] = { estado: g.fontes[f].estado }; });
      const nenhuma = nomes.every((f) => final[f].estado !== 'ok' && final[f].estado !== 'parcial');
      return { estado: nenhuma ? 'falha' : (g.parcial ? 'parcial' : 'ok'), fontes: final, linhas: g.linhas, parcial: g.parcial };
    }

    // Ponto único para a página: { fase: 'aviso' | 'pronto' | 'sessao' | 'descartado', mensagem?, resultado? }.
    async function ler(aba, dia, vigente) {
      const c = await contexto(dia);
      if (!vigente()) return { fase: 'descartado' };
      if (c.estado !== 'ok') return { fase: 'aviso', mensagem: c.mensagem };
      if (deps.lojaAtual() !== c.loja) return { fase: 'descartado' };
      const vig = () => vigente() && deps.lojaAtual() === c.loja;
      const r = aba === 'escala' ? await lerEscala(c, vig) : await lerAtividade(c, vig);
      if (r.estado === 'descartado' || !vig()) return { fase: 'descartado' };
      if (r.estado === 'sessao') return { fase: 'sessao' };
      return { fase: 'pronto', resultado: r };
    }

    return { contexto, lerEscala, lerAtividade, ler };
  }

  return { criar, LIMITE, MAX_PAGINAS, MSG_ESCALA_NAO_LIBERADA, urlEscala, urlAtividade };
});
