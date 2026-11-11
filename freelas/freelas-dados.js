// Leitura de Taxas e Freelas: só GET no ERP, só as colunas permitidas, de 200 em 200 (teto de 10 páginas).
// Tudo o que depende do ambiente entra por `deps` (injetável nos testes):
//   deps.trFetch(url, { method: 'GET' })  deps.modelo (freelas-modelo.js)  deps.lojaCarregar()  deps.lojaAtual()
// Este arquivo não lê sessão, chave nem armazenamento: o cabeçalho de acesso é do núcleo (trFetch).
// Nunca chama RPC, nunca escreve, nunca lê tabela fora de freela_contato e freela_valor_hora.
// Uso no navegador: window.FreelasDados.criar({...}). Uso em teste: require('./freelas-dados.js').criar({...}).
(function (raiz, fabrica) {
  const api = fabrica();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else raiz.FreelasDados = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const TABELA_CONTATO = 'freela_contato';
  const TABELA_VALOR = 'freela_valor_hora';
  const MSG_SEM_LOJA = 'O cadastro de loja desta conta ainda está pendente. Nada foi consultado.';
  const MSG_SEM_ESCOLHA = 'Escolha uma das lojas autorizadas para ver esta tela. Nada foi consultado.';
  const MSG_LOJAS_FALHA = 'Não foi possível carregar as lojas autorizadas agora. Nada foi consultado.';
  const enc = encodeURIComponent;

  function filtroLoja(variantes) {
    return 'loja=in.' + enc('(' + variantes.map((v) => '"' + v + '"').join(',') + ')');
  }
  function urlContatos(modelo, variantes, offset) {
    return TABELA_CONTATO + '?select=' + modelo.SELECT_CONTATO + '&ativo=eq.true&' + filtroLoja(variantes) +
      '&order=id.asc&limit=' + modelo.LIMITE_PAGINA + '&offset=' + offset;
  }
  function urlValores(modelo, variantes, offset) {
    return TABELA_VALOR + '?select=' + modelo.SELECT_VALOR + '&' + filtroLoja(variantes) +
      '&order=loja.asc,atualizado_em.asc,valor_hora.asc&limit=' + modelo.LIMITE_PAGINA + '&offset=' + offset;
  }

  function criar(deps) {
    const M = deps.modelo;

    // Páginas de 200, no máximo MAX_PAGINAS. Última página cheia = PARCIAL. Qualquer erro = sem dados dessa leitura.
    // `vigente()` roda ANTES de cada GET e DEPOIS de cada await (inclusive r.json()): resposta antiga é descartada.
    async function paginar(montar, vigente) {
      const rows = [];
      for (let p = 0; p < M.MAX_PAGINAS; p++) {
        if (!vigente()) return { estado: 'descartado', rows: [] };
        let r;
        try { r = await deps.trFetch(montar(p * M.LIMITE_PAGINA), { method: 'GET' }); }
        catch (e) { return { estado: vigente() ? 'falha' : 'descartado', rows: [] }; }
        if (!vigente()) return { estado: 'descartado', rows: [] };
        if (r.status === 401) return { estado: 'sessao', rows: [] };
        if (r.status === 403) return { estado: 'naoliberada', rows: [] };
        if (!r.ok) return { estado: 'falha', rows: [] };
        let j;
        try { j = await r.json(); } catch (e) { return { estado: vigente() ? 'falha' : 'descartado', rows: [] }; }
        if (!vigente()) return { estado: 'descartado', rows: [] };
        if (!Array.isArray(j)) return { estado: 'falha', rows: [] };
        for (const x of j) rows.push(x);
        if (j.length < M.LIMITE_PAGINA) return { estado: 'ok', rows };
      }
      return { estado: 'parcial', rows };
    }

    // Allowlist REAL (lojaCarregar) + loja escolhida. Falha ao carregar NÃO é lista vazia.
    async function contexto() {
      let info = null;
      try { info = await deps.lojaCarregar(); } catch (e) { info = null; }
      if (!info || !Array.isArray(info.lojas)) return { estado: 'falha_lojas', mensagem: MSG_LOJAS_FALHA };
      const loja = deps.lojaAtual();
      const rec = M.resolverRecorte(info.lojas, loja);
      if (rec.estado === 'sem_loja') return { estado: 'sem_loja', mensagem: MSG_SEM_LOJA };
      if (rec.estado !== 'ok') return { estado: 'sem_escolha', mensagem: MSG_SEM_ESCOLHA };
      return { estado: 'ok', loja, recorte: rec, variantes: M.variantesServidor(rec.lojas) };
    }

    async function lerAba(aba, ctx, vigente) {
      const contato = aba === 'contatos';
      const r = await paginar((off) => (contato ? urlContatos(M, ctx.variantes, off) : urlValores(M, ctx.variantes, off)), vigente);
      if (r.estado === 'descartado' || r.estado === 'sessao') return { estado: r.estado, linhas: [] };
      if (r.estado === 'naoliberada' || r.estado === 'falha') return { estado: r.estado, linhas: [] };
      // revalida localmente: só loja do recorte, só ativo, só campos permitidos
      const n = contato ? M.normalizarContatos(r.rows, ctx.recorte) : M.normalizarValores(r.rows, ctx.recorte);
      if (!n) return { estado: 'falha', linhas: [] };
      return {
        estado: r.estado, // 'ok' | 'parcial'
        linhas: n.linhas,
        lojas: ctx.recorte.lojas.slice(),
        avisos: { semLoja: n.semLoja, invalidas: n.invalidas, fora: n.fora }
      };
    }

    // Ponto único para a página: { fase: 'aviso' | 'pronto' | 'sessao' | 'descartado', mensagem?, resultado? }.
    async function ler(aba, vigente) {
      if (aba !== 'contatos' && aba !== 'valores') return { fase: 'aviso', mensagem: 'Aba desconhecida.' };
      const c = await contexto();
      if (!vigente()) return { fase: 'descartado' };
      if (c.estado !== 'ok') return { fase: 'aviso', estado: c.estado, mensagem: c.mensagem };
      if (deps.lojaAtual() !== c.loja) return { fase: 'descartado' };
      const vig = () => vigente() && deps.lojaAtual() === c.loja;
      const r = await lerAba(aba, c, vig);
      if (r.estado === 'descartado' || !vig()) return { fase: 'descartado' };
      if (r.estado === 'sessao') return { fase: 'sessao' };
      return { fase: 'pronto', resultado: r };
    }

    return { contexto, ler };
  }

  return { criar, urlContatos, urlValores, MSG_SEM_LOJA, MSG_SEM_ESCOLHA, MSG_LOJAS_FALHA, TABELA_CONTATO, TABELA_VALOR };
});
