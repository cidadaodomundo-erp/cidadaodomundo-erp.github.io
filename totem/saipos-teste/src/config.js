// Caminhos privados, leitura minima do .env e validacao do test-store.json.
// Nada aqui imprime valores de segredo.

import { readFile, writeFile, mkdir } from "node:fs/promises";
import { isAbsolute, resolve, dirname, join, relative } from "node:path";
import { ErroConector } from "./erros.js";

export const META_EXIGIDA = {
  storeId: "93936",
  environment: "desenvolvimento",
  expectedName: "Cidadão do Mundo - HML",
};

function dentroDe(base, alvo) {
  const rel = relative(base, alvo);
  return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel));
}

// Falha fechado: sem CONNECTOR_ENV_PATH absoluto nao adivinha diretorio.
export function resolverCaminhos(env, pacoteDir) {
  const informado = env.CONNECTOR_ENV_PATH;
  if (!informado) {
    throw new ErroConector(
      "ENV_PATH_AUSENTE",
      "Defina CONNECTOR_ENV_PATH com o caminho absoluto do .env (ex.: work/private-saipos/.env)."
    );
  }
  if (!isAbsolute(informado)) {
    throw new ErroConector("ENV_PATH_RELATIVO", "CONNECTOR_ENV_PATH precisa ser caminho absoluto.");
  }
  const envPath = resolve(informado);
  const outputsDir = dirname(resolve(pacoteDir));
  if (dentroDe(outputsDir, envPath)) {
    throw new ErroConector(
      "ENV_PATH_DENTRO_DE_OUTPUTS",
      "O .env e os dados privados devem ficar fora de outputs/ (ex.: work/private-saipos/)."
    );
  }
  const dir = dirname(envPath);
  return {
    envPath,
    dir,
    metaPath: join(dir, "test-store.json"),
    tokenPath: join(dir, "token-cache.json"),
    ledgerDir: join(dir, "ledger"),
    payloadsDir: join(dir, "payloads"),
    catalogPath: join(dir, "catalogo-teste.json"),
  };
}

// Cria .env vazio somente se ausente. Nunca sobrescreve, nunca le.
export async function setup(caminhos) {
  await mkdir(caminhos.dir, { recursive: true });
  try {
    await writeFile(caminhos.envPath, "SAIPOS_SECRET=\n", { flag: "wx", mode: 0o600 });
    return { path: caminhos.envPath, criado: true };
  } catch (erro) {
    if (erro.code === "EEXIST") return { path: caminhos.envPath, criado: false };
    throw erro;
  }
}

export async function lerSegredo(envPath) {
  let conteudo;
  try {
    conteudo = await readFile(envPath, "utf8");
  } catch (erro) {
    if (erro.code === "ENOENT") {
      throw new ErroConector("ENV_AUSENTE", "Arquivo .env ausente. Rode 'setup' e preencha SAIPOS_SECRET.");
    }
    throw new ErroConector("ENV_ILEGIVEL", "Nao foi possivel ler o .env.");
  }
  for (const linha of conteudo.split(/\r?\n/)) {
    const m = linha.match(/^\s*SAIPOS_SECRET\s*=\s*(.*)$/);
    if (!m) continue;
    let valor = m[1].trim();
    if (/^(".*"|'.*')$/.test(valor)) valor = valor.slice(1, -1);
    if (valor) return valor;
  }
  throw new ErroConector("SECRET_NAO_PREENCHIDO", "SAIPOS_SECRET vazio ou ausente no .env.");
}

function textoNaoVazio(v) {
  return typeof v === "string" && v.trim().length > 0;
}

export async function carregarMeta(metaPath) {
  let bruto;
  try {
    bruto = JSON.parse(await readFile(metaPath, "utf8"));
  } catch (erro) {
    if (erro.code === "ENOENT") {
      throw new ErroConector(
        "META_AUSENTE",
        "test-store.json ausente ao lado do .env. O Codex deve preencher a partir da UI do Developer (veja test-store.example.json)."
      );
    }
    throw new ErroConector("META_INVALIDA", "test-store.json ilegivel ou JSON invalido.");
  }
  const falhas = [];
  if (String(bruto?.storeId) !== META_EXIGIDA.storeId) falhas.push("storeId");
  if (bruto?.environment !== META_EXIGIDA.environment) falhas.push("environment");
  if (bruto?.testStoreVerified !== true) falhas.push("testStoreVerified");
  if (bruto?.expectedName !== META_EXIGIDA.expectedName) falhas.push("expectedName");
  if (!textoNaoVazio(bruto?.codStore)) falhas.push("codStore");
  if (!textoNaoVazio(bruto?.idPartner)) falhas.push("idPartner");
  if (falhas.length) {
    throw new ErroConector("META_REPROVADA", `test-store.json reprovado nos campos: ${falhas.join(", ")}.`, { campos: falhas });
  }
  return {
    storeId: META_EXIGIDA.storeId,
    codStore: bruto.codStore.trim(),
    idPartner: bruto.idPartner.trim(),
    expectedName: bruto.expectedName,
  };
}
