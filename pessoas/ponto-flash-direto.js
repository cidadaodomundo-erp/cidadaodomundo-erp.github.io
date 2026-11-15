// LEITURA DO DIA DIRETO NO FLASH para a Consulta de ponto (pcartao). Só GET à Edge Function fabio-ponto-leitura, a mesma
// do Ponto ao Vivo, com o JWT da pessoa logada: nenhum segredo no navegador, nada grava. Resposta: { batidas, lidoEm, ... }.
(function () {
  'use strict';
  window.pontoFlashDireto = async function ({ dia, unidade }) {
    const s = rmbSessao();
    if (!s || !s.access_token) throw Object.assign(new Error('Sessão vencida ou ausente (401)'), { status: 401 });
    const lim = new AbortController(); const h = setTimeout(() => lim.abort(), 25000);
    try {
      const r = await fetch(SUPABASE_URL + '/functions/v1/fabio-ponto-leitura?dia=' + encodeURIComponent(dia) + '&unidade=' + encodeURIComponent(unidade),
        { method: 'GET', headers: { apikey: SUPABASE_ANON_KEY, Authorization: 'Bearer ' + s.access_token }, signal: lim.signal });
      if (!r.ok) throw Object.assign(new Error('HTTP ' + r.status), { status: r.status });
      return await r.json();
    } finally { clearTimeout(h); }
  };
})();
