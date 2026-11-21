// Início manual do laboratório. NÃO é serviço de longa duração automático:
// só deve ser executado manualmente, por decisão humana/Codex, após revisão.
// Escuta apenas em 127.0.0.1, porta fixa 4650, sem CORS, sem acesso externo.
//
// Uso:
//   node bin/start.js                     -> usa data/pedidos.json (padrão)
//   node bin/start.js --data /caminho/abs/arquivo.json  -> usa caminho absoluto (ex.: QA/work)

import { Store } from "../src/store.js";
import { iniciarServidorEfemero } from "../src/server.js";
import { join, isAbsolute } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = fileURLToPath(new URL(".", import.meta.url));

function resolverCaminhoDados() {
  const idx = process.argv.indexOf("--data");
  if (idx === -1) {
    return join(__dirname, "..", "data", "pedidos.json");
  }
  const caminho = process.argv[idx + 1];
  if (!caminho || !isAbsolute(caminho)) {
    console.error("Erro: --data exige um caminho absoluto. Ex.: node bin/start.js --data C:\\caminho\\abs\\pedidos.json");
    process.exit(1);
  }
  return caminho;
}

const dataPath = resolverCaminhoDados();
const store = new Store(dataPath);
await store.carregar();

const porta = 4650;
const servidor = await iniciarServidorEfemero(store, porta);
console.log(`Laboratório totem rodando em http://127.0.0.1:${porta} (TESTE SEPARADO, SEM Saipos, SEM cobrança real)`);
console.log(`Dados em: ${dataPath}`);
console.log("Pressione Ctrl+C para encerrar.");

process.on("SIGINT", () => {
  servidor.close(() => process.exit(0));
});
