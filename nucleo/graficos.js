// GRÁFICOS (05/11/2026, bloco 6 da migração): MOVIDO do docs/dashboard.html, sem mudar nada.
// A cor dos gráficos sai dos tokens do :root (corToken), o tema escuro do Chart.js e o registro dos gráficos abertos.
// Página com gráfico carrega o Chart.js e depois este arquivo.

// Cor de grafico vem do :root, como todo o resto do painel.
// Chart.js pinta em CANVAS, e canvas nao resolve var(): a cor tem que chegar como string
// pronta. Por isso estas duas funcoes leem o token na hora de montar o grafico — assim
// trocar a cor no :root passa a mudar os graficos junto, em vez de deixar copia velha
// espalhada pelo JS (eram 21 hex copiados a mao ate 12/09/2026).
// Regra de qual token usar em cada caso: skill painel-visual.
function corToken(token, alternativa) {
  const v = getComputedStyle(document.documentElement).getPropertyValue(token).trim();
  return v || alternativa || '#8a897e';
}

// Mesma cor com transparencia (area sob a linha, barra translucida).
function corTokenA(token, alpha) {
  let h = corToken(token).replace('#', '');
  if (h.length === 3) h = h.split('').map(c => c + c).join('');
  const n = parseInt(h.slice(0, 6), 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`;
}

// Tema escuro para os graficos, combinando com o resto do dashboard.
if (window.Chart) {
  Chart.defaults.color = corToken('--tx-3');
  Chart.defaults.borderColor = corToken('--line');
  Chart.defaults.font.family = "'Segoe UI', system-ui, -apple-system, sans-serif";

}

// Escreve o valor na ponta de cada barra horizontal, pra nao depender do mouse pra ler o
// numero. Feito na mao (em vez de usar outra biblioteca externa) pra nao criar mais uma
// dependencia de CDN — se ela sair do ar, o painel inteiro para.
// Entregue como plugin *local* do grafico (array `plugins` da config): o Chart.js trata
// funcao dentro de options.plugins como "opcao scriptable" e quebra ao tentar resolve-la.
function pluginRotulosBarra(formatar) {
  return {
    id: 'rotulosBarra',
    afterDatasetsDraw(chart) {
      const ctx = chart.ctx;
      ctx.save();
      ctx.font = 'bold 11px ' + Chart.defaults.font.family;
      ctx.fillStyle = '#c3c2b7';
      ctx.textAlign = 'left';
      ctx.textBaseline = 'middle';
      chart.getDatasetMeta(0).data.forEach((barra, i) => {
        ctx.fillText(formatar(i), barra.x + 6, barra.y);
      });
      ctx.restore();
    },
  };
}

// ------------------------------------------------------------------
// Graficos de evolucao (mesma logica financeira, agrupada no tempo)
// ------------------------------------------------------------------
let chartInstances = {};

function destroyChart(id) {
  if (chartInstances[id]) { chartInstances[id].destroy(); delete chartInstances[id]; }
}
