// Teste da tela com banco FICTÍCIO em memória (RLS imitada pelo token). Rodar: python3 -m http.server 8765 &  node acessos/teste-tela.js
const { chromium } = require('playwright');
const BASE = 'http://localhost:8765';
// banco fictício em memória; RLS imitada pelo token: só 'tok-dono' lê e grava
let L = [ { id: 1, unidade: 'AHU', categoria: 'modem', nome: 'Modem fictício', descricao: 'teste', responsavel: 'Fulano Teste', situacao: 'OK', depende_erp: 'NAO', ref_cofre: 'Cofre › Internet › Modem fictício', atualizado_em: '2026-11-28T10:00:00Z' },
          { id: 2, unidade: 'REDE', categoria: 'robo', nome: 'robo-ficticio', descricao: null, responsavel: 'Beltrano', situacao: 'A_CONFERIR', depende_erp: 'SIM', ref_cofre: null, atualizado_em: '2026-11-28T10:00:00Z' } ];
let prox = 3;
async function rotas(page, tok) {
  await page.route('**/rtmgzsikwglsvpopbfbw.supabase.co/**', async (route) => {
    const req = route.request(), url = new URL(req.url()), dono = (req.headers()['authorization'] || '').includes('tok-dono');
    if (!url.pathname.startsWith('/rest/v1/mapa_acesso')) return route.fulfill({ status: 200, contentType: 'application/json', body: url.pathname.includes('/rpc/') ? 'null' : '[]' });
    const m = req.method(), idq = url.searchParams.get('id'), id = idq ? Number(idq.replace('eq.', '')) : null;
    if (m === 'GET') { const u = (url.searchParams.get('unidade') || '').replace('eq.', ''); if (!u || !url.searchParams.get('limit')) throw new Error('leitura sem filtro de unidade ou sem limit');
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(dono ? L.filter((r) => r.unidade === u) : []) }); }
    if (!dono) return route.fulfill({ status: m === 'POST' ? 403 : 200, contentType: 'application/json', body: m === 'POST' ? JSON.stringify({ message: 'new row violates row-level security policy' }) : '[]' });
    const b = req.postData() ? JSON.parse(req.postData()) : {};
    if (m === 'POST') { const x = { id: prox++, ...b }; L.push(x); return route.fulfill({ status: 201, contentType: 'application/json', body: JSON.stringify([x]) }); }
    if (m === 'PATCH') { const x = L.find((r) => r.id === id); Object.assign(x, b); return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([x]) }); }
    if (m === 'DELETE') { const x = L.find((r) => r.id === id); L = L.filter((r) => r.id !== id); return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(x ? [{ id }] : []) }); }
  });
  await page.addInitScript((t) => localStorage.setItem('rmbSessao', JSON.stringify({ access_token: t.tok, refresh_token: 'r', email: t.email, expira_em: Date.now() + 3600e3 })), tok);
}
const ok = (c, msg) => { if (!c) { console.log('FALHOU:', msg); process.exitCode = 1; } else console.log('OK', msg); };
(async () => {
  const br = await chromium.launch();
  // 1) proprietário: vê, cadastra, edita, apaga; o que grava persiste numa nova abertura
  let p = await br.newPage(); await rotas(p, { tok: 'tok-dono', email: 'x@exemplo.test' });
  const erros = []; p.on('pageerror', (e) => erros.push(e.message));
  await p.goto(BASE + '/acessos/index.html'); await p.waitForSelector('text=robo-ficticio');
  ok(!(await p.isVisible('text=Modem fictício')), 'abre na Rede toda, só com os itens dela');
  await p.click('button:has-text("Ahú")'); await p.waitForSelector('text=Modem fictício');
  ok(!(await p.isVisible('text=robo-ficticio')), 'dono troca de unidade e vê só os itens do Ahú');
  await p.click('text=+ Cadastrar item'); await p.fill('#maNome', 'Câmera fictícia da porta'); await p.selectOption('#maUnidade', 'BOQUEIRAO');
  await p.selectOption('#maCategoria', 'camera'); await p.fill('#maCofre', 'senha: 1234'); await p.click('#maSalvar');
  ok(await p.isVisible('text=parece senha'), 'tela recusa senha antes de enviar'); ok(L.length === 2, 'nada foi enviado com senha');
  await p.fill('#maCofre', 'Cofre › Câmeras › Boqueirão'); await p.fill('#maResp', 'Ciclano'); await p.click('#maSalvar');
  await p.waitForSelector('text=Câmera fictícia da porta'); ok(L.length === 3 && L[2].unidade === 'BOQUEIRAO', 'dono cadastrou (gravou no banco fictício)');
  await p.reload(); await p.waitForSelector('text=robo-ficticio'); await p.click('button:has-text("Boqueirão")'); await p.waitForSelector('text=Câmera fictícia da porta'); ok(true, 'persistiu depois de recarregar');
  await p.screenshot({ path: (process.env.S || '/tmp') + '/tela-dono.png', fullPage: true });
  const linha = p.locator('tr', { hasText: 'Câmera fictícia da porta' }); await linha.getByText('Editar').click();
  await p.selectOption('#maSituacao', 'A_TROCAR'); await p.click('#maSalvar'); await p.waitForSelector('.ma-sit.A_TROCAR >> text=A trocar');
  ok(L[2].situacao === 'A_TROCAR', 'dono editou');
  await p.locator('tr', { hasText: 'Câmera fictícia da porta' }).getByText('Editar').click();
  await p.click('text=Apagar este item'); await p.click('text=Clique de novo para apagar'); await p.waitForSelector('text=Câmera fictícia da porta', { state: 'detached' });
  ok(L.length === 2, 'dono apagou (com confirmação em dois cliques)');
  ok(!erros.length, 'sem erro de JavaScript: ' + erros.join(' | '));
  // 2) outro perfil: o servidor devolve 0 linhas e recusa gravar
  p = await br.newPage(); await rotas(p, { tok: 'tok-gerente', email: 'gerente@exemplo.test' });
  await p.goto(BASE + '/acessos/index.html'); await p.waitForSelector('text=ou este login não é do proprietário');
  ok(!(await p.isVisible('text=Modem fictício')), 'outro perfil não vê nenhum item');
  await p.click('text=+ Cadastrar o primeiro item'); await p.fill('#maNome', 'invasor'); await p.click('#maSalvar');
  await p.waitForSelector('text=Não gravou'); ok(L.length === 2, 'outro perfil não grava (servidor recusou e a tela disse)');
  await p.screenshot({ path: (process.env.S || '/tmp') + '/tela-outro.png', fullPage: true });
  await br.close();
})();
