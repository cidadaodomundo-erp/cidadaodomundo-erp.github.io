#!/usr/bin/env node
// Inicio MANUAL do servidor do salao (modo teste). Sem daemon; encerra com Ctrl+C ou sozinho em 10 h.
//   node tablets/servidor/bin/start-salao.js                 -> so a cozinha de teste (sem Saipos), neste computador
//   node tablets/servidor/bin/start-salao.js --rede          -> idem, aberto para os tablets do Wi-Fi do salao
//   CONNECTOR_ENV_PATH=<abs> node tablets/servidor/bin/start-salao.js --sandbox [--rede]
//                                                            -> tambem envia para a loja TESTE do Saipos (HML 93936)
// Opcional: --porta 4662 · --saipos-mesa (manda para a MESA no Saipos, modo TABLE; exige mesas cadastradas na loja TESTE)
// Senha da equipe (trocar mesa / fechar conta): SALAO_PIN=246810 ou a gerada no 1o uso e guardada em servidor/dados/pin-equipe.txt
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { randomInt } from "node:crypto";
import { criarServidorSalao, ipsDaRede } from "../src/salao.js";

const DADOS = join(fileURLToPath(new URL(".", import.meta.url)), "..", "dados");
function lerPin() {
  if (process.env.SALAO_PIN) return process.env.SALAO_PIN.trim();
  const arq = join(DADOS, "pin-equipe.txt");
  if (existsSync(arq)) return readFileSync(arq, "utf8").trim();
  const novo = String(randomInt(0, 1000000)).padStart(6, "0");
  mkdirSync(DADOS, { recursive: true });
  writeFileSync(arq, novo + "\n", { mode: 0o600 });
  return novo;
}

const args = process.argv.slice(2);
const sandbox = args.includes("--sandbox");
const rede = args.includes("--rede");
const iPorta = args.indexOf("--porta");
const porta = iPorta >= 0 ? Number(args[iPorta + 1]) : 4662;
if (!Number.isInteger(porta) || porta < 1024 || porta > 65535) { console.error("Porta inválida."); process.exit(2); }
if (sandbox && !process.env.CONNECTOR_ENV_PATH) { console.error("Para --sandbox defina CONNECTOR_ENV_PATH (configuração privada da loja TESTE). Nada foi iniciado."); process.exit(2); }

const ips = rede ? ipsDaRede() : [];
// Pix da loja (chave oficial): arquivo dados/pix.json com {"chave": "...", "nome": "...", "cidade": "CURITIBA"}. Sem o arquivo, o pagamento continua simulado.
const arqPix = join(DADOS, "pix.json");
let pix = null;
if (existsSync(arqPix)) { try { pix = JSON.parse(readFileSync(arqPix, "utf8")); } catch { console.error("dados/pix.json com erro de digitação. Nada foi iniciado."); process.exit(2); } }
let server;
try {
  server = await criarServidorSalao({ modo: sandbox ? "saipos" : "local", modoSaipos: args.includes("--saipos-mesa") ? "TABLE" : "TICKET", pagarAntes: !args.includes("--pagar-na-saida"), pix, pin: lerPin(), envPath: process.env.CONNECTOR_ENV_PATH, hostsExtras: ips });
} catch (e) {
  console.error(e?.codigo ? `Não iniciou: ${e.codigo} - ${e.message}` : "Não iniciou: falha inesperada.");
  process.exit(1);
}
server.listen(porta, rede ? "0.0.0.0" : "127.0.0.1", () => {
  console.log(`Servidor do salão (TESTE${sandbox ? ` + Saipos loja TESTE, ${server.salao.modoSaipos === "TABLE" ? "na MESA" : "como ficha"}` : ", sem Saipos"}) ligado.`);
  console.log(server.salao.pagarAntes ? "  Pagamento: o cliente paga no tablet ou no celular ANTES; só então a rodada vai para a cozinha (TESTE: simulado, nada é cobrado)." : "  Pagamento: no fim, na conta (como hoje).");
  if (server.salao.pixLigado) console.log("  Pix da loja LIGADO: o tablet mostra o QR do Pix com o valor; a equipe confere no app do banco e toca em 'Pix recebido' na tela da cozinha.");
  console.log(`  Senha da equipe: ${lerPin()}  (6 números: entrar na cozinha, trocar a mesa e fechar a conta)`);
  console.log(`  Tablet:  http://127.0.0.1:${porta}/tablet`);
  console.log(`  Cozinha: http://127.0.0.1:${porta}/cozinha`);
  for (const ip of ips) console.log(`  Nos tablets do Wi-Fi: http://${ip}:${porta}/tablet?mesa=1  (troque 1 pelo número da mesa) · cozinha: http://${ip}:${porta}/cozinha`);
  console.log(`  ${server.salao.cardapio.menu.produtos.length} produtos com foto no cardápio${server.salao.permitidos ? `, ${server.salao.permitidos.size} ligados à loja TESTE` : ""}.`);
});
const encerrar = () => { server.closeAllConnections?.(); server.close(() => process.exit(0)); setTimeout(() => process.exit(0), 3000).unref(); };
process.on("SIGINT", encerrar);
process.on("SIGTERM", encerrar);
setTimeout(encerrar, 10 * 60 * 60 * 1000).unref();
