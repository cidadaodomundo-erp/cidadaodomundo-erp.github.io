// Testes do servidor do salao: servidor real em loopback; Saipos FAKE (fetch falso) e credenciais FAKE em pasta temporaria.
// Sem rede externa, sem segredos reais.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { mkdtemp, writeFile, readFile, rm, mkdir, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { criarServidorSalao, notaSaipos, SENHA_INICIAL, STATUS, COD_STORE_TESTE, FORMAS_PAGAMENTO } from "../src/salao.js";
import { dtoFixtureV2, catalogoHmlV2, mapaFixtureV2, itemBurger, itemCerveja, TOTAL_REFERENCIA, AS_12H, AS_01H } from "../../../totem/app/test/fixture-cardapio.js";

const SEGREDO = "FAKE-SECRET-aaaa1111";
const PARCEIRO = "FAKE-PARTNER-bbbb2222";
const TOKEN = "FAKE.TOKEN.cccc3333";
const LINK = "https://saipos-integration-services-catalog-production.s3.us-east-1.amazonaws.com/catalog/catalog-1.json";
const K = (n) => `aaaaaaaa-0000-4000-8000-${String(n).padStart(12, "0")}`;
const MESA = { modalidade: "mesa", mesa: 7, comanda: null };

const dirs = [];
const servers = [];
after(async () => {
  for (const s of servers) { s.closeAllConnections?.(); s.close(); }
  for (const d of dirs) await rm(d, { recursive: true, force: true });
});

const resp = (status, obj) => ({ status, text: async () => JSON.stringify(obj) });
function criarFetch({ ordem } = {}) {
  const chamadas = [];
  const f = async (url, init = {}) => {
    chamadas.push({ url, corpo: init.body });
    if (url.endsWith("/auth")) return resp(200, { token: TOKEN });
    if (url.endsWith("/v2/catalog")) return resp(200, { url: LINK });
    if (url === LINK) return resp(200, { data: catalogoHmlV2() });
    if (url.endsWith("/order")) return ordem ? ordem(init) : resp(200, {});
    throw new Error("url inesperada");
  };
  f.pedidos = () => chamadas.filter((c) => c.url.endsWith("/order"));
  return f;
}

const PIN = "4321";
async function subir({ modo = "local", inicio = AS_12H, ordem, dir, modoSaipos = "TICKET", pagarAntes = false } = {}) {
  if (!dir) {
    dir = await mkdtemp(join(tmpdir(), "salao-test-"));
    dirs.push(dir);
    await writeFile(join(dir, "gama.json"), JSON.stringify(dtoFixtureV2()));
    await mkdir(join(dir, "fotos"));
    for (const id of [10, 11, 12, 20, 21, 30, 31]) await writeFile(join(dir, "fotos", `p${id}.webp`), "RIFF-FAKE");
    if (modo === "saipos") {
      await mkdir(join(dir, "priv"));
      await writeFile(join(dir, "priv", ".env"), `SAIPOS_SECRET=${SEGREDO}\n`);
      await writeFile(join(dir, "priv", "test-store.json"), JSON.stringify({ storeId: "93936", environment: "desenvolvimento", testStoreVerified: true, expectedName: "Cidadão do Mundo - HML", codStore: COD_STORE_TESTE, idPartner: PARCEIRO }));
      await writeFile(join(dir, "priv", "gama-hml-map.json"), JSON.stringify(mapaFixtureV2()));
    }
  }
  const relogio = { t: inicio };
  const f = criarFetch({ ordem });
  const server = await criarServidorSalao({
    modo, modoSaipos, pin: PIN, envPath: modo === "saipos" ? join(dir, "priv", ".env") : undefined, fetchImpl: f, timeoutMs: 300,
    gamaPath: join(dir, "gama.json"), fotosDir: join(dir, "fotos"), statePath: modo === "local" ? join(dir, "estado.json") : undefined, agora: () => relogio.t, pagarAntes,
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  servers.push(server);
  const porta = server.address().port;
  const pagina = await chamar(porta, { caminho: "/tablet" });
  const csrf = JSON.parse(/<script type="application\/json" id="cfgEnvio">([^<]*)<\/script>/.exec(pagina.texto)[1]).csrf;
  return { dir, f, server, porta, relogio, csrf, pagina, coz: server.salao.cozinhaToken, esperar: () => server.salao.esperarSaipos() };
}

function chamar(porta, { metodo = "GET", caminho = "/", headers = {}, corpo, host } = {}) {
  return new Promise((ok, fail) => {
    const dados = corpo === undefined ? undefined : typeof corpo === "string" ? corpo : JSON.stringify(corpo);
    const h = { host: host ?? `127.0.0.1:${porta}`, ...headers };
    if (dados !== undefined) h["content-length"] = Buffer.byteLength(dados);
    const r = http.request({ host: "127.0.0.1", port: porta, method: metodo, path: caminho, headers: h }, (res) => {
      let t = "";
      res.on("data", (d) => (t += d));
      res.on("end", () => { let json = null; try { json = JSON.parse(t); } catch { /* texto */ } ok({ status: res.statusCode, headers: res.headers, texto: t, json }); });
    });
    r.on("error", fail);
    r.end(dados);
  });
}
const post = (s, caminho, corpo, extra = {}) => chamar(s.porta, { metodo: "POST", caminho, corpo, headers: { "content-type": "application/json", "x-cdm-csrf": s.csrf, ...extra } });
const postC = (s, caminho, corpo, extra = {}) => post(s, caminho, corpo, { "x-cdm-cozinha": s.coz, ...extra });
const painelDe = (s) => chamar(s.porta, { caminho: "/api/cozinha", headers: { "x-cdm-cozinha": s.coz } });
const rodada = (n, itens, extra = {}) => ({ idempotencyKey: K(n), ocupacao: MESA, numero: 1, itens, ...extra });

test("tablet: pagina do modo teste com cardapio, fotos por URL e CSP so desta origem", async () => {
  const s = await subir({ inicio: AS_01H });
  assert.equal(s.pagina.status, 200);
  assert.match(s.pagina.headers["content-security-policy"], /connect-src 'self'/);
  assert.match(s.pagina.texto, /MODO TESTE — pedidos vão para a tela da cozinha de teste/);
  assert.doesNotMatch(s.pagina.texto, /DEMONSTRAÇÃO — pedidos não chegam/);
  const dados = JSON.parse(/<script type="application\/json" id="dados">([\s\S]*?)<\/script>/.exec(s.pagina.texto)[1]);
  assert.equal(dados.fotos[10], "/fotos/p10.webp");
  assert.ok(!dados.produtos.some((p) => p.id === 20), "feijoada fora do horario nao aparece");
  assert.equal((await chamar(s.porta, { caminho: "/fotos/p10.webp" })).status, 200);
  assert.equal((await chamar(s.porta, { caminho: "/fotos/p99.webp" })).status, 404);
  assert.equal((await chamar(s.porta, { caminho: "/../estado.json" })).status, 404);
});

test("local: rodada chega a cozinha com total do SERVIDOR; reenvio com a mesma chave nao duplica", async () => {
  const s = await subir();
  const r1 = await post(s, "/api/rodada", rodada(1, [itemBurger({ obs: "sem cebola" }), itemCerveja()]));
  assert.equal(r1.status, 200, r1.texto);
  assert.equal(r1.json.ok, true);
  assert.equal(r1.json.totalCentavos, TOTAL_REFERENCIA);
  assert.equal(r1.json.status, STATUS.local);
  const r2 = await post(s, "/api/rodada", rodada(1, [itemBurger({ obs: "sem cebola" }), itemCerveja()]));
  assert.equal(r2.json.id, r1.json.id);
  const outra = await post(s, "/api/rodada", rodada(1, [itemCerveja()]));
  assert.equal(outra.status, 409);
  const painel = (await painelDe(s)).json;
  assert.equal(painel.rodadas.length, 1);
  const r = painel.rodadas[0];
  assert.equal(r.rotulo, "MESA 7");
  assert.equal(r.itens[0].obs, "sem cebola");
  assert.deepEqual(r.itens[0].opcoes.map((o) => o.nome), ["Aneis", "Molho Especial"]);
  assert.equal(r.saipos, null);
  // persistido em disco
  const disco = JSON.parse(await readFile(join(s.dir, "estado.json"), "utf8"));
  assert.equal(disco.rodadas.length, 1);
});

test("local: recusa preco/campo do cliente, opcao invalida, minimo nao cumprido e item fora do horario", async () => {
  const s = await subir({ inicio: AS_01H });
  assert.equal((await post(s, "/api/rodada", rodada(2, [{ ...itemCerveja(), precoCentavos: 1 }]))).status, 400);
  assert.equal((await post(s, "/api/rodada", rodada(3, [itemBurger({ opcoes: [{ opcao: 22, quantidade: 1 }] })]))).status, 400, "molho obrigatorio");
  assert.equal((await post(s, "/api/rodada", rodada(4, [itemBurger({ opcoes: [{ opcao: 25, quantidade: 1 }, { opcao: 91, quantidade: 1 }] })]))).status, 400, "opcao inativa");
  assert.equal((await post(s, "/api/rodada", rodada(5, [{ produto: 20, variacao: 1, quantidade: 1, opcoes: [] }]))).status, 409, "fora do horario");
  assert.equal((await post(s, "/api/rodada", rodada(6, [itemCerveja()], { ocupacao: { modalidade: "mesa", mesa: 999, comanda: null } }))).status, 400);
  assert.equal((await painelDe(s)).json.rodadas.length, 0);
});

test("seguranca: host, origem, csrf e tipo de conteudo", async () => {
  const s = await subir();
  assert.equal((await chamar(s.porta, { caminho: "/tablet", host: "evil.example:80" })).status, 421);
  assert.equal((await post(s, "/api/rodada", rodada(7, [itemCerveja()]), { "x-cdm-csrf": "errado" })).status, 403);
  assert.equal((await post(s, "/api/rodada", rodada(8, [itemCerveja()]), { origin: "http://evil.example" })).status, 403);
  assert.equal((await post(s, "/api/rodada", rodada(9, [itemCerveja()]), { "content-type": "text/plain" })).status, 415);
});

test("cozinha: preparando -> pronta -> entregue; nao volta etapa; avisos de atendente e conta", async () => {
  const s = await subir();
  const r = await post(s, "/api/rodada", rodada(10, [itemCerveja()]));
  const id = r.json.id;
  assert.equal((await postC(s, `/api/cozinha/rodada/${id}/pronto`, {})).json.preparo, "PRONTO");
  assert.equal((await postC(s, `/api/cozinha/rodada/${id}/preparando`, {})).status, 409);
  assert.equal((await postC(s, `/api/cozinha/rodada/${id}/entregue`, {})).json.preparo, "ENTREGUE");
  const p = (await painelDe(s)).json;
  assert.equal(p.rodadas.length, 0);
  assert.equal(p.entregues.length, 1);
  const a = await post(s, "/api/aviso", { tipo: "conta", ocupacao: MESA, idempotencyKey: K(11) });
  assert.equal(a.json.ok, true);
  await post(s, "/api/aviso", { tipo: "conta", ocupacao: MESA, idempotencyKey: K(11) }); // repetido
  const av = (await painelDe(s)).json.avisos;
  assert.equal(av.length, 1);
  assert.equal(av[0].rotulo, "MESA 7");
  await postC(s, `/api/cozinha/aviso/${av[0].id}/visto`, {});
  assert.equal((await painelDe(s)).json.avisos.length, 0);
  assert.equal((await chamar(s.porta, { caminho: "/cozinha" })).status, 200);
});

test("saipos (FAKE): rodada vira ficha TICKET na loja TESTE com mesa/rodada na nota, total do servidor e pagamento zero de cobranca", async () => {
  const s = await subir({ modo: "saipos" });
  const dados = JSON.parse(/<script type="application\/json" id="dados">([\s\S]*?)<\/script>/.exec(s.pagina.texto)[1]);
  assert.deepEqual(dados.produtos.map((p) => p.id).sort(), [10, 11], "so produtos ligados a loja TESTE");
  const r = await post(s, "/api/rodada", rodada(20, [itemBurger({ obs: "ponto da carne" }), itemCerveja()]));
  assert.equal(r.status, 200, r.texto);
  assert.equal(r.json.status, STATUS.enviando, "tablet recebe resposta na hora; Saipos segue na fila propria");
  await s.esperar();
  const fim = await post(s, "/api/rodada", rodada(20, [itemBurger({ obs: "ponto da carne" }), itemCerveja()]));
  assert.equal(fim.json.status, STATUS.saipos);
  assert.match(fim.json.mensagem, new RegExp(`ficha ${SENHA_INICIAL}`));
  const pedidos = s.f.pedidos();
  assert.equal(pedidos.length, 1);
  const body = JSON.parse(pedidos[0].corpo);
  assert.equal(body.cod_store, COD_STORE_TESTE);
  assert.equal(body.order_method.mode, "TICKET");
  assert.equal(body.display_id, String(SENHA_INICIAL));
  assert.match(body.notes, /^TESTE-NAO PRODUZIR/);
  assert.equal(body.items[0].integration_code, "501");
  assert.equal(body.items[0].notes, "TESTE MESA 7 R1 | ponto da carne");
  assert.equal(body.items[1].notes, "TESTE MESA 7 R1");
  assert.deepEqual(body.items[0].choice_items.map((c) => c.integration_code), ["501.22", "501.25"]);
  assert.equal(Math.round(body.payment_types[0].amount * 100), TOTAL_REFERENCIA);
  assert.ok(!r.texto.includes(TOKEN) && !r.texto.includes(PARCEIRO) && !r.texto.includes("501"), "nada de segredo/codigo Saipos na resposta");
  // reenvio da mesma rodada: nenhum POST novo
  await post(s, "/api/rodada", rodada(20, [itemBurger({ obs: "ponto da carne" }), itemCerveja()]));
  assert.equal(s.f.pedidos().length, 1);
  const painel = (await painelDe(s)).json;
  assert.deepEqual(painel.rodadas[0].saipos, { estado: "aceito", ficha: SENHA_INICIAL });
  assert.ok(!JSON.stringify(painel).includes("HML-"), "orderId nao vai para a tela");
});

test("saipos (FAKE): falha/timeout fica 'a conferir', a rodada continua na cozinha e NUNCA reenvia sozinha", async () => {
  const s = await subir({ modo: "saipos", ordem: async () => resp(503, {}) });
  const r = await post(s, "/api/rodada", rodada(30, [itemCerveja()]));
  assert.equal(r.json.ok, true);
  await s.esperar();
  assert.equal((await post(s, "/api/rodada", rodada(30, [itemCerveja()]))).json.status, STATUS.conferir);
  assert.equal(s.f.pedidos().length, 1);
  const painel = (await painelDe(s)).json;
  assert.equal(painel.rodadas[0].saipos.estado, "ambiguo");
  // reinicio no meio de um envio => ambiguo, sem novo POST
  const estadoPath = join(s.dir, "priv", "salao-hml-state.json");
  const est = JSON.parse(await readFile(estadoPath, "utf8"));
  est.rodadas[0].saipos.estado = "enviando";
  await writeFile(estadoPath, JSON.stringify(est));
  const s2 = await subir({ modo: "saipos", dir: s.dir });
  assert.equal((await painelDe(s2)).json.rodadas[0].saipos.estado, "ambiguo");
  assert.equal(s2.f.pedidos().length, 0);
});

test("saipos: recusa subir com loja que nao e a TESTE", async () => {
  const dir = await mkdtemp(join(tmpdir(), "salao-test-"));
  dirs.push(dir);
  await writeFile(join(dir, "gama.json"), JSON.stringify(dtoFixtureV2()));
  await mkdir(join(dir, "priv"));
  await writeFile(join(dir, "priv", ".env"), `SAIPOS_SECRET=${SEGREDO}\n`);
  await writeFile(join(dir, "priv", "test-store.json"), JSON.stringify({ storeId: "93936", environment: "desenvolvimento", testStoreVerified: true, expectedName: "Cidadão do Mundo - HML", codStore: "00000000-0000-4000-8000-000000000000", idPartner: PARCEIRO }));
  const f = criarFetch();
  await assert.rejects(criarServidorSalao({ modo: "saipos", pin: PIN, envPath: join(dir, "priv", ".env"), fetchImpl: f, gamaPath: join(dir, "gama.json"), fotosDir: dir }));
  assert.equal(f.pedidos().length, 0);
});

test("nota da ficha: mesa/comanda + rodada + observacao, ate 110 caracteres", () => {
  assert.equal(notaSaipos({ modalidade: "comanda", comanda: "A12" }, 3, { obs: "x".repeat(200) }).length, 110);
  assert.equal(notaSaipos({ modalidade: "mesa", mesa: 4 }, 2, { obs: "" }), "MESA 4 R2");
});

test("equipe: senha confere no servidor, bloqueia apos 5 erros; servidor nao sobe sem senha valida", async () => {
  const s = await subir();
  assert.equal((await post(s, "/api/equipe/pin", { pin: PIN })).status, 200);
  for (let i = 0; i < 5; i++) assert.equal((await post(s, "/api/equipe/pin", { pin: "0000" })).status, 403);
  assert.equal((await post(s, "/api/equipe/pin", { pin: PIN })).status, 429, "bloqueado mesmo com a senha certa");
  await assert.rejects(criarServidorSalao({ pin: "12", gamaPath: join(s.dir, "gama.json"), fotosDir: join(s.dir, "fotos"), statePath: join(s.dir, "x.json") }));
});

test("mesa fixa pelo endereco; andamento por id; fechar conta libera o tablet e nao reabre", async () => {
  const s = await subir();
  const pg = await chamar(s.porta, { caminho: "/tablet?mesa=7" });
  assert.match(pg.texto, /"mesaFixa":7/);
  assert.equal((await chamar(s.porta, { caminho: "/tablet?mesa=999" })).status, 400);
  const r1 = await post(s, "/api/rodada", rodada(40, [itemCerveja()]));
  const r2 = await post(s, "/api/rodada", rodada(41, [itemCerveja()], { numero: 2 }));
  await postC(s, `/api/cozinha/rodada/${r1.json.id}/pronto`, {});
  const ids = `${r1.json.id},${r2.json.id}`;
  let est = (await chamar(s.porta, { caminho: `/api/tablet/estado?ids=${ids}` })).json;
  assert.deepEqual(est.rodadas.map((x) => [x.preparo, x.fechada]), [["PRONTO", false], ["NOVO", false]]);
  let painel = (await painelDe(s)).json;
  assert.deepEqual(painel.mesas.map((m) => [m.rotulo, m.rodadas, m.totalCentavos]), [["MESA 7", 2, 4200]]);
  // tablet sem token da cozinha precisa da senha certa
  assert.equal((await post(s, "/api/cozinha/mesa/fechar", { ocupacao: "mesa:7", pin: "999999" })).status, 403);
  assert.equal((await post(s, "/api/cozinha/mesa/fechar", { ocupacao: "mesa:7", pin: PIN })).json.ok, true);
  est = (await chamar(s.porta, { caminho: `/api/tablet/estado?ids=${ids}` })).json;
  assert.ok(est.rodadas.every((x) => x.fechada));
  painel = (await painelDe(s)).json;
  assert.equal(painel.mesas.length, 0);
  assert.equal(painel.rodadas.length, 0, "rodadas da conta fechada saem da fila da cozinha");
  // reenvio de chave antiga (de conta fechada) nao reabre a conta
  assert.equal((await post(s, "/api/rodada", rodada(40, [itemCerveja()]))).status, 409);
  assert.equal((await painelDe(s)).json.mesas.length, 0);
  // relogio do servidor voltando para tras nao reabre nada; nova rodada abre conta nova
  s.relogio.t = new Date(s.relogio.t.getTime() - 3_600_000);
  const r3 = await post(s, "/api/rodada", rodada(42, [itemCerveja()]));
  painel = (await painelDe(s)).json;
  assert.deepEqual(painel.mesas.map((m) => m.rodadas), [1]);
  // cozinha com token fecha sem senha
  assert.equal((await postC(s, "/api/cozinha/mesa/fechar", { ocupacao: "mesa:7" })).json.ok, true);
  assert.equal((await chamar(s.porta, { caminho: `/api/tablet/estado?ids=${r3.json.id},bbbbbbbb-0000-4000-8000-000000000000` })).json.rodadas.every((x) => x.fechada), true, "id desconhecido conta como fechado");
});

test("cozinha: sem token da equipe nao ve nem mexe; entrar com a senha devolve o token", async () => {
  const s = await subir();
  const r = await post(s, "/api/rodada", rodada(70, [itemCerveja()]));
  assert.equal((await chamar(s.porta, { caminho: "/api/cozinha" })).status, 401);
  assert.equal((await post(s, `/api/cozinha/rodada/${r.json.id}/pronto`, {})).status, 401);
  assert.equal((await post(s, "/api/cozinha/entrar", { pin: "000000" })).status, 403);
  const e = await post(s, "/api/cozinha/entrar", { pin: PIN });
  assert.equal(e.json.token, s.coz);
  assert.equal((await post(s, `/api/cozinha/rodada/${r.json.id}/pronto`, {}, { "x-cdm-cozinha": e.json.token })).json.preparo, "PRONTO");
  // o token sobrevive ao reinicio (cozinha nao precisa digitar de novo)
  const s2 = await subir({ dir: s.dir });
  assert.equal(s2.coz, s.coz);
});

test("saipos TABLE (FAKE, nao homologado): rodada vai para a MESA (desc_table) com notas e sem pagamento", async () => {
  const s = await subir({ modo: "saipos", modoSaipos: "TABLE" });
  const r = await post(s, "/api/rodada", rodada(50, [itemBurger({ obs: "bem passado" }), itemCerveja()]));
  assert.equal(r.json.ok, true, r.texto);
  await s.esperar();
  assert.equal((await post(s, "/api/rodada", rodada(50, [itemBurger({ obs: "bem passado" }), itemCerveja()]))).json.status, STATUS.saipos);
  const body = JSON.parse(s.f.pedidos()[0].corpo);
  assert.equal(body.order_method.mode, "TABLE");
  assert.deepEqual(body.table, { desc_table: "7" });
  assert.match(body.order_id, /^MESA-\d{14}-[0-9a-f]{8}$/);
  assert.ok(body.order_id.length <= 40);
  assert.equal(body.notes, "TESTE-NAO PRODUZIR | MESA 7 R1");
  assert.equal(body.items[0].notes, "bem passado");
  assert.equal(body.items[1].notes, undefined);
  assert.equal("payment_types" in body, false);
  const total = body.items.reduce((t, it) => t + Math.round(it.unit_price * 100 + (it.choice_items || []).reduce((a, c) => a + Math.round(c.aditional_price * 100) * c.quantity, 0)) * it.quantity, 0);
  assert.equal(total, TOTAL_REFERENCIA);
  const ledger = await readdir(join(s.dir, "priv", "ledger"));
  assert.equal(ledger.length, 1);
  // comanda vai em desc_order_pad
  await post(s, "/api/rodada", { idempotencyKey: K(51), ocupacao: { modalidade: "comanda", mesa: null, comanda: "A7" }, numero: 1, itens: [itemCerveja()] });
  await s.esperar();
  assert.deepEqual(JSON.parse(s.f.pedidos()[1].corpo).table, { desc_order_pad: "A7" });
});

test("saipos TABLE (FAKE): recusa 4xx fica 'a conferir' e nao reenvia", async () => {
  const s = await subir({ modo: "saipos", modoSaipos: "TABLE", ordem: async () => resp(400, { errorCode: 908 }) });
  await post(s, "/api/rodada", rodada(60, [itemCerveja()]));
  await s.esperar();
  assert.equal((await post(s, "/api/rodada", rodada(60, [itemCerveja()]))).json.status, STATUS.conferir);
  assert.equal(s.f.pedidos().length, 1);
  assert.equal((await painelDe(s)).json.rodadas[0].saipos.estado, "recusado");
});

test("paga antes: rodada so vai para a cozinha e o Saipos depois do pagamento aprovado; pagar 2x nao duplica", async () => {
  const s = await subir({ modo: "saipos", pagarAntes: true });
  assert.match(s.pagina.texto, /"pagarAntes":true/);
  const r = await post(s, "/api/rodada", rodada(80, [itemBurger({ obs: "sem picles" }), itemCerveja()]));
  assert.equal(r.status, 200, r.texto);
  assert.equal(r.json.status, STATUS.aguardandoPagamento);
  const t = r.json.pagamento.token;
  assert.match(t, /^[0-9a-f]{32}$/);
  await s.esperar();
  assert.equal(s.f.pedidos().length, 0, "nada no Saipos antes de pagar");
  assert.equal((await painelDe(s)).json.rodadas.length, 0, "nada na cozinha antes de pagar");
  assert.equal((await postC(s, `/api/cozinha/rodada/${r.json.id}/pronto`, {})).status, 404, "cozinha nao mexe em rodada nao paga");
  // reenvio da mesma rodada: mesmo pagamento
  assert.equal((await post(s, "/api/rodada", rodada(80, [itemBurger({ obs: "sem picles" }), itemCerveja()]))).json.pagamento.token, t);
  // pagina do celular
  assert.equal((await chamar(s.porta, { caminho: `/pagar?t=${t}` })).status, 200);
  assert.equal((await chamar(s.porta, { caminho: "/pagar?t=" + "0".repeat(32) })).status, 404);
  const v = (await chamar(s.porta, { caminho: `/api/pagamento?t=${t}` })).json;
  assert.equal(v.estado, "aguardando"); assert.equal(v.totalCentavos, TOTAL_REFERENCIA); assert.equal(v.rotulo, "MESA 7");
  assert.ok(!JSON.stringify(v).includes("501"), "sem codigo Saipos na tela do celular");
  // recusado: continua fora da cozinha
  assert.equal((await post(s, "/api/pagamento/simular", { token: t, forma: "credito", resultado: "recusado" })).json.estado, "recusado");
  assert.equal((await painelDe(s)).json.rodadas.length, 0);
  // sem csrf (outro site) nao paga
  assert.equal((await post(s, "/api/pagamento/simular", { token: t, forma: "pix", resultado: "aprovado" }, { "x-cdm-csrf": "x" })).status, 403);
  // aprovado: cozinha + Saipos
  const a = await post(s, "/api/pagamento/simular", { token: t, forma: "applepay", resultado: "aprovado" });
  assert.equal(a.json.estado, "aprovado");
  await s.esperar();
  assert.equal(s.f.pedidos().length, 1);
  const p = (await painelDe(s)).json;
  assert.equal(p.rodadas.length, 1);
  assert.equal(p.rodadas[0].pago, FORMAS_PAGAMENTO.applepay);
  assert.deepEqual(p.mesas.map((m) => m.totalCentavos), [TOTAL_REFERENCIA]);
  // pagar de novo e reenviar: nada duplica
  await post(s, "/api/pagamento/simular", { token: t, forma: "pix", resultado: "aprovado" });
  const fim = await post(s, "/api/rodada", rodada(80, [itemBurger({ obs: "sem picles" }), itemCerveja()]));
  assert.equal(fim.json.status, STATUS.saipos);
  assert.match(fim.json.mensagem, /Pagamento aprovado \(teste, Apple Pay\)/);
  await s.esperar();
  assert.equal(s.f.pedidos().length, 1);
  assert.equal((await painelDe(s)).json.rodadas.length, 1);
  assert.equal((await post(s, "/api/pagamento/cancelar", { token: t })).status, 409, "pago nao cancela");
});

test("paga antes: cancelar na mesa nao manda nada; fechar a conta cancela pagamento esquecido; reinicio mantem", async () => {
  const s = await subir({ pagarAntes: true });
  const r = await post(s, "/api/rodada", rodada(90, [itemCerveja()]));
  const t = r.json.pagamento.token;
  assert.equal((await post(s, "/api/pagamento/cancelar", { token: t })).json.ok, true);
  assert.equal((await post(s, "/api/pagamento/simular", { token: t, forma: "pix", resultado: "aprovado" })).status, 409);
  assert.equal((await post(s, "/api/rodada", rodada(90, [itemCerveja()]))).status, 409, "chave do pagamento cancelado nao volta");
  assert.equal((await painelDe(s)).json.rodadas.length, 0);
  // pagamento esquecido + conta paga de outra rodada; reinicio no meio
  const r2 = await post(s, "/api/rodada", rodada(91, [itemCerveja()]));
  await post(s, "/api/pagamento/simular", { token: r2.json.pagamento.token, forma: "pix", resultado: "aprovado" });
  const r3 = await post(s, "/api/rodada", rodada(92, [itemCerveja()], { numero: 2 }));
  const s2 = await subir({ dir: s.dir, pagarAntes: true });
  assert.equal((await chamar(s2.porta, { caminho: `/api/pagamento?t=${r3.json.pagamento.token}` })).json.estado, "aguardando");
  assert.deepEqual((await painelDe(s2)).json.mesas.map((m) => m.rodadas), [1]);
  assert.equal((await postC(s2, "/api/cozinha/mesa/fechar", { ocupacao: "mesa:7" })).json.ok, true);
  assert.equal((await chamar(s2.porta, { caminho: `/api/pagamento?t=${r3.json.pagamento.token}` })).json.estado, "cancelado");
});
