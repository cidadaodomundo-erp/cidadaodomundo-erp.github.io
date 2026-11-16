import { readFile, writeFile, rename, mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import { randomBytes, createHash } from "node:crypto";

export async function lerJsonOpcional(caminho) {
  try {
    return JSON.parse(await readFile(caminho, "utf8"));
  } catch (erro) {
    if (erro.code === "ENOENT") return null;
    throw erro;
  }
}

export async function gravarJsonAtomico(caminho, objeto) {
  await mkdir(dirname(caminho), { recursive: true });
  const tmp = `${caminho}.${randomBytes(6).toString("hex")}.tmp`;
  await writeFile(tmp, JSON.stringify(objeto, null, 2), { encoding: "utf8", mode: 0o600 });
  await rename(tmp, caminho);
}

export function sha256Json(objeto) {
  return createHash("sha256").update(JSON.stringify(objeto)).digest("hex");
}
