#!/usr/bin/env node
// Inicio MANUAL do servidor do salao (modo teste). Sem daemon; encerra com Ctrl+C ou sozinho em 10 h.
//   node tablets/servidor/bin/start-salao.js                 -> so a cozinha de teste (sem Saipos), neste computador
//   node tablets/servidor/bin/start-salao.js --rede          -> idem, aberto para os tablets do Wi-Fi do salao
//   CONNECTOR_ENV_PATH=<abs> node tablets/servidor/bin/start-salao.js --sandbox [--rede]
//                                                            -> tambem envia para a loja TESTE do Saipos (HML 93936)
// Opcional: --porta 4660
import { criarServidorSalao, ipsDaRede } from "../src/salao.js";

const args = process.argv.slice(2);
const sandbox = args.includes("--sandbox");
const rede = args.includes("--rede");
const iPorta = args.indexOf("--porta");
const porta = iPorta >= 0 ? Number(args[iPorta + 1]) : 4660;
if (!Number.isInteger(porta) || porta < 1024 || porta > 65535) { console.error("Porta inválida."); process.exit(2); }
if (sandbox && !process.env.CONNECTOR_ENV_PATH) { console.error("Para --sandbox defina CONNECTOR_ENV_PATH (configuração privada da loja TESTE). Nada foi iniciado."); process.exit(2); }

const ips = rede ? ipsDaRede() : [];
let server;
try {
  server = await criarServidorSalao({ modo: sandbox ? "saipos" : "local", envPath: process.env.CONNECTOR_ENV_PATH, hostsExtras: ips });
} catch (e) {
  console.error(e?.codigo ? `Não iniciou: ${e.codigo} - ${e.message}` : "Não iniciou: falha inesperada.");
  process.exit(1);
}
server.listen(porta, rede ? "0.0.0.0" : "127.0.0.1", () => {
  console.log(`Servidor do salão (TESTE${sandbox ? " + Saipos loja TESTE" : ", sem Saipos"}) ligado.`);
  console.log(`  Tablet:  http://127.0.0.1:${porta}/tablet`);
  console.log(`  Cozinha: http://127.0.0.1:${porta}/cozinha`);
  for (const ip of ips) console.log(`  Nos tablets do Wi-Fi: http://${ip}:${porta}/tablet   (cozinha: http://${ip}:${porta}/cozinha)`);
  console.log(`  ${server.salao.cardapio.menu.produtos.length} produtos com foto no cardápio${server.salao.permitidos ? `, ${server.salao.permitidos.size} ligados à loja TESTE` : ""}.`);
});
const encerrar = () => { server.closeAllConnections?.(); server.close(() => process.exit(0)); setTimeout(() => process.exit(0), 3000).unref(); };
process.on("SIGINT", encerrar);
process.on("SIGTERM", encerrar);
setTimeout(encerrar, 10 * 60 * 60 * 1000).unref();
