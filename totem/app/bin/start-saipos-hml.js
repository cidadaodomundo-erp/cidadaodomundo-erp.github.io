#!/usr/bin/env node
// Uso manual: CONNECTOR_ENV_PATH=<abs> node bin/start-saipos-hml.js --sandbox
// Opcional (TV automatica, opt-in): TV_WEBHOOK_CONFIG_PATH=<abs JSON privado {segredo,porta?,prontoAoConcluirHml?: boolean (so HML, padrao false)}>
// Sobe a ponte HML em 127.0.0.1:4654 (+ receptor 127.0.0.1 separado se opt-in). Ctrl+C/SIGTERM encerram os dois; 2h limite. Sem daemon.
// Nunca imprime segredo/URL do webhook; segredo jamais por argv.

import { criarServidorHml } from "../src/saipos-hml.js";
import { lerConfigWebhook } from "../src/webhook-tv.js";

const PORTA = 4654;
const LIMITE_MS = 2 * 60 * 60 * 1000;

if (!process.argv.includes("--sandbox")) {
  console.error("Falta a opção --sandbox. Nada foi iniciado.");
  process.exit(2);
}
const envPath = process.env.CONNECTOR_ENV_PATH;
if (!envPath) {
  console.error("Defina CONNECTOR_ENV_PATH (caminho absoluto da configuração privada). Nada foi iniciado.");
  process.exit(2);
}

let tvAutomatica = null;
if (process.env.TV_WEBHOOK_CONFIG_PATH !== undefined) {
  try {
    tvAutomatica = { webhook: await lerConfigWebhook(process.env.TV_WEBHOOK_CONFIG_PATH) };
  } catch {
    console.error("Não iniciou: configuração do receptor HML inválida.");
    process.exit(1);
  }
}

let server;
try {
  server = await criarServidorHml({ envPath, ...(tvAutomatica ? { tvAutomatica } : {}) });
} catch (erro) {
  // Mensagens do conector nao carregam segredo; qualquer outra coisa e generica.
  console.error(erro?.codigo ? `Não iniciou: ${erro.codigo} - ${erro.message}` : "Não iniciou: falha inesperada.");
  process.exit(1);
}

let encerrando = false;
function encerrar(codigo = 0) {
  if (encerrando) return;
  encerrando = true;
  const forcar = setTimeout(() => process.exit(codigo), 3000); // rede de seguranca
  forcar.unref();
  server.closeAllConnections?.();
  server.close(() => { clearTimeout(forcar); process.exit(codigo); }); // close() tambem fecha o receptor
}
process.on("SIGINT", () => encerrar(0));
process.on("SIGTERM", () => encerrar(0));
setTimeout(() => encerrar(0), LIMITE_MS).unref();

// Falha ao escutar (ex.: porta ocupada): nenhum dos dois listeners fica aberto; sem detalhes que possam vazar.
server.once("error", () => {
  console.error("Não iniciou: não foi possível abrir a porta local.");
  encerrar(1);
});

server.listen(PORTA, () => {
  console.log(`http://127.0.0.1:${PORTA}/`);
  if (tvAutomatica) console.log("Receptor HML ligado.");
});
