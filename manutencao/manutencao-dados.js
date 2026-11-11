// Leitura do diretório "Quem conserta": só GET na tabela de prestadores do ERP, só as colunas permitidas,
// só ativos, de 200 em 200 (teto de 10 páginas). O diretório é geral (o cadastro não tem loja): sem filtro de loja.
// Tudo o que depende do ambiente entra por `deps` (injetável nos testes):
//   deps.trFetch(url, { method: 'GET' })  deps.modelo (manutencao-modelo.js)
// Este arquivo não lê sessão, chave nem armazenamento: o cabeçalho de acesso é do núcleo (trFetch).
// Nunca chama RPC, nunca escreve, nunca lê outra tabela.
// Uso no navegador: window.ManutencaoDados.criar({...}). Uso em teste: require('./manutencao-dados.js').criar({...}).
(function (raiz, fabrica) {
  const api = fabrica();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else raiz.ManutencaoDados = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const TABELA = 'prestador';

  function urlPrestadores(modelo, offset) {
    return TABELA + '?select=' + modelo.SELECT_PRESTADOR + '&ativo=eq.true&order=id.asc&limit=' + modelo.LIMITE_PAGINA + '&offset=' + offset;
  }

  function criar(deps) {
    const M = deps.modelo;

    // Páginas de 200, no máximo MAX_PAGINAS. Última página cheia = PARCIAL. Qualquer erro = sem dados dessa leitura.
    // `vigente()` roda ANTES de cada GET e DEPOIS de cada await (inclusive r.json()): resposta antiga é descartada.
    async function paginar(vigente) {
      const rows = [];
      for (let p = 0; p < M.MAX_PAGINAS; p++) {
        if (!vigente()) return { estado: 'descartado', rows: [] };
        let r;
        try { r = await deps.trFetch(urlPrestadores(M, p * M.LIMITE_PAGINA), { method: 'GET' }); }
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

    // Ponto único para a página: { fase: 'descartado' | 'sessao' | 'pronto', resultado? }.
    // resultado.estado: 'ok' | 'parcial' | 'naoliberada' | 'falha'.
    async function ler(vigente) {
      const r = await paginar(vigente);
      if (r.estado === 'descartado' || !vigente()) return { fase: 'descartado' };
      if (r.estado === 'sessao') return { fase: 'sessao' };
      if (r.estado === 'naoliberada' || r.estado === 'falha') return { fase: 'pronto', resultado: { estado: r.estado, linhas: [] } };
      const n = M.normalizarPrestadores(r.rows);          // revalida: só ativo, só campos permitidos
      if (!n) return { fase: 'pronto', resultado: { estado: 'falha', linhas: [] } };
      return { fase: 'pronto', resultado: { estado: r.estado, linhas: n.linhas, avisos: { invalidas: n.invalidas } } };
    }

    return { ler };
  }

  return { criar, urlPrestadores, TABELA };
});
