#!/usr/bin/env node
// DEMONSTRACAO do totem de ponta a ponta, 100% simulada:
//   cardapio real (data/gama-cardapio.json) -> carrinho -> pagamento (Pix ou cartao SIMULADOS)
//   -> pedido para uma "loja Saipos" FALSA (nada sai deste computador) -> cozinha -> TV.
// Nenhuma cobranca real, nenhuma chamada ao Saipos, nenhuma senha. Pode rodar em qualquer PC:
//   node bin/start-demo.js            (abre em http://127.0.0.1:4660)
// Opcoes: --porta 4660  --pix-segundos 8  --cartao-segundos 5  --recusar-primeiro-cartao

import { mkdtemp, writeFile, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { criarServidorHml, COD_STORE_TESTE } from "../src/saipos-hml.js";
import { adaptadorPorForma } from "../src/pagamento.js";
import { adaptadorPix, bancoPixSimulado } from "../src/pix.js";
import { adaptadorTef, tefSimulado } from "../src/tef.js";

const AQUI = fileURLToPath(new URL(".", import.meta.url));
const DTO = join(AQUI, "..", "data", "gama-cardapio.json");
const LINK = "https://saipos-integration-services-catalog-production.s3.us-east-1.amazonaws.com/catalog/catalog-1.json";

function opcao(nome, padrao) {
  const i = process.argv.indexOf(nome);
  const v = i > 0 ? Number(process.argv[i + 1]) : padrao;
  return Number.isFinite(v) && v >= 0 ? v : padrao;
}
const PORTA = opcao("--porta", 4660);
const PIX_S = opcao("--pix-segundos", 8);
const CARTAO_S = opcao("--cartao-segundos", 5);
const RECUSA_1 = process.argv.includes("--recusar-primeiro-cartao"); // para treinar/mostrar o fluxo de recusa

// Catalogo e mapa FALSOS gerados a partir do cardapio real: cada variacao vira um item da "loja demo".
export function gerarCatalogoDemo(dto) {
  const catalogo = [{ tipo: "PRATO", codigo_saipos: "40101353", item: "Diversos", price: 0, store_item_enabled: "Y", id_store_item: 1, item_type: "simples" }];
  const mapa = { schema: "gama-hml-map", version: 2, storeUuid: COD_STORE_TESTE, itens: [], opcoes: [], grupos: [], comentario: "DEMO gerado automaticamente; nao e a loja real" };
  const grupos = new Map(dto.grupos.map((g) => [g.id, g]));
  let idItem = 100;
  for (const p of dto.produtos) {
    for (const v of p.variacoes) {
      idItem += 1;
      const codigo = `D${p.id}V${v.indice}`;
      catalogo.push({ tipo: "PRATO", codigo_saipos: codigo, item: p.nome, price: v.centavos / 100, store_item_enabled: "Y", id_store_item: idItem, item_type: "simples", tamanho: v.nome, codigo_interno: `GAMA${p.id}` });
      mapa.itens.push({ produto: p.id, variacao: v.indice, codigoHml: codigo, precoCentavos: v.centavos });
      for (const gid of p.grupos) {
        const g = grupos.get(gid);
        if (!g) continue;
        for (const o of dto.opcoes.filter((x) => x.adicional === gid)) {
          const cod = `${codigo}.${o.id}`;
          catalogo.push({
            tipo: "COMPLEMENTO", codigo_saipos: cod, complemento_item: o.nome, price: o.centavos / 100,
            store_choice_item_enabled: "Y", store_choice_enabled: "Y", store_item_enabled: "Y",
            id_store_item: idItem, id_store_choice: gid, min_choices: g.minimo, max_choices: g.maximo, item_type: "simples",
            tamanho: v.nome, complemento: g.nome,
          });
          mapa.opcoes.push({ produto: p.id, variacao: v.indice, opcao: o.id, codigoHml: cod, precoCentavos: o.centavos });
        }
      }
    }
  }
  return { catalogo, mapa };
}

// "Saipos" de mentira: responde como a loja de teste, sem rede.
export function fetchDemo(catalogo, aoPedido = () => {}, ordem) {
  const resp = (status, obj) => ({ status, text: async () => JSON.stringify(obj) });
  return async (url, init = {}) => {
    if (url.endsWith("/auth")) return resp(200, { token: "DEMO.SEM.TOKEN" });
    if (url.endsWith("/v2/catalog")) return resp(200, { url: LINK });
    if (url === LINK) return resp(200, { data: catalogo });
    if (url.endsWith("/order")) {
      if (ordem) return ordem(init, resp);
      aoPedido(init.body);
      return resp(200, {});
    }
    throw new Error("demo: endereco inesperado");
  };
}

// Banco Pix simulado que "recebe" o pagamento sozinho depois de alguns segundos.
function bancoQuePagaSozinho(segundos) {
  const banco = bancoPixSimulado();
  const criar = banco.criarCobranca.bind(banco);
  banco.criarCobranca = async (txid, corpo) => {
    const antes = banco.criadas;
    const r = await criar(txid, corpo);
    if (banco.criadas > antes) setTimeout(() => banco.pagar(txid), segundos * 1000).unref();
    return r;
  };
  return banco;
}

// Opcoes extras (testes): dir (reaproveita a pasta = "reiniciar o PC"), ordem (resposta falsa do /order), codigosSaipos.
export async function subirDemo({ porta = PORTA, pixSegundos = PIX_S, cartaoSegundos = CARTAO_S, log = console.log, dir, ordem, aoPedido, codigosSaipos, pagamento: pagExtra, recusarPrimeiroCartao = RECUSA_1 } = {}) {
  const dto = JSON.parse(await readFile(DTO, "utf8"));
  const { catalogo, mapa } = gerarCatalogoDemo(dto);
  const reaproveita = !!dir;
  dir = dir ?? await mkdtemp(join(tmpdir(), "totem-demo-"));
  if (!reaproveita) await writeFile(join(dir, ".env"), "SAIPOS_SECRET=DEMO-SEM-SEGREDO\n");
  if (!reaproveita) await writeFile(join(dir, "test-store.json"), JSON.stringify({
    storeId: "93936", environment: "desenvolvimento", testStoreVerified: true,
    expectedName: "Cidadão do Mundo - HML", codStore: COD_STORE_TESTE, idPartner: "DEMO-PARCEIRO",
  }));
  if (!reaproveita) await writeFile(join(dir, "gama-hml-map.json"), JSON.stringify(mapa));

  const tef = adaptadorTef({ provedor: tefSimulado({ aprovarDepoisMs: cartaoSegundos * 1000, decidir: (c, n) => (recusarPrimeiroCartao && n === 1 ? "recusado" : "aprovado") }) });
  const pix = adaptadorPix({ banco: bancoQuePagaSozinho(pixSegundos), chavePix: "chave-pix-demo" });
  const pagamento = pagExtra ?? { adaptador: adaptadorPorForma({ pix, debito: tef, credito: tef }), ...(codigosSaipos ? { codigosSaipos } : {}) };

  const server = await criarServidorHml({
    envPath: join(dir, ".env"), gamaPath: DTO, timeoutMs: 2000, pagamento,
    fetchImpl: fetchDemo(catalogo, (corpo) => { log("  -> pedido chegou na loja DEMO (simulada)"); aoPedido?.(corpo); }, ordem),
  });
  await new Promise((ok, falha) => { server.once("error", falha); server.listen(porta, ok); });
  const p = server.address().port;
  log(`\nTOTEM DEMO ligado (tudo simulado, nada é cobrado):`);
  log(`  Totem:   http://127.0.0.1:${p}/`);
  log(`  Cozinha: http://127.0.0.1:${p}/cozinha-hml.html`);
  log(`  TV:      http://127.0.0.1:${p}/tv-hml.html`);
  log(`  Pix aprova sozinho em ${pixSegundos}s; cartão em ${cartaoSegundos}s.\n`);
  return { server, porta: p, dir };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  subirDemo().catch((e) => { console.error("Não foi possível ligar a demonstração:", e.message); process.exit(1); });
}
