// Persistência local em arquivo JSON com transação serializada.
// Toda mutação passa por transacao(fn): clona o estado, aplica fn no clone,
// só grava no disco (tmp + rename) e só promove o clone para a memória
// DEPOIS de a gravação em disco ter sucesso. Se fn lançar erro, nada é
// gravado e a memória permanece no estado anterior (sem mutação parcial).
// Falha de gravação nunca corrompe o arquivo anterior (grava em tmp e só
// troca pelo rename atômico). JSON corrompido ou schema inválido faz o
// carregamento falhar fechado (erro), nunca sobrescreve/apaga o arquivo.

import { readFile, writeFile, rename, mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import { randomUUID } from "node:crypto";

const SCHEMA_VERSAO = 1;

function estadoVazio() {
  return { version: SCHEMA_VERSAO, pedidos: {}, contadorSenha: 0 };
}

function validarSchema(estado) {
  if (!estado || typeof estado !== "object") {
    throw new Error("Schema inválido: raiz não é objeto.");
  }
  if (estado.version !== SCHEMA_VERSAO) {
    throw new Error(`Schema inválido: version=${estado.version} (esperado ${SCHEMA_VERSAO}).`);
  }
  if (typeof estado.pedidos !== "object" || estado.pedidos === null) {
    throw new Error("Schema inválido: campo 'pedidos' ausente ou inválido.");
  }
  if (!Number.isSafeInteger(estado.contadorSenha) || estado.contadorSenha < 0) {
    throw new Error("Schema inválido: campo 'contadorSenha' ausente ou inválido.");
  }
}

export class Store {
  constructor(filePath) {
    this.filePath = filePath;
    this._estado = null;
    this._fila = Promise.resolve();
  }

  async carregar() {
    await mkdir(dirname(this.filePath), { recursive: true });
    let conteudo;
    try {
      conteudo = await readFile(this.filePath, "utf8");
    } catch (erro) {
      if (erro.code === "ENOENT") {
        this._estado = estadoVazio();
        await this._gravarDisco(this._estado);
        return this._estado;
      }
      throw erro;
    }

    let estado;
    try {
      estado = JSON.parse(conteudo);
      validarSchema(estado);
    } catch (erro) {
      // Falha fechado: nunca sobrescreve/apaga um arquivo corrompido ou com schema inválido.
      throw new Error(
        `Dados corrompidos ou schema inválido em ${this.filePath}: ${erro.message}. ` +
          `Arquivo NÃO foi alterado/apagado. Inspecione manualmente antes de continuar.`
      );
    }
    this._estado = estado;
    return this._estado;
  }

  async _gravarDisco(estado) {
    const tmpPath = `${this.filePath}.${randomUUID()}.tmp`;
    await writeFile(tmpPath, JSON.stringify(estado, null, 2), "utf8");
    await rename(tmpPath, this.filePath);
  }

  _garantirCarregado() {
    if (!this._estado) {
      throw new Error("Store não carregado. Chame carregar() antes de usar.");
    }
  }

  // Executa fn(clone) de forma serializada (uma transação por vez, na ordem
  // de chegada). Só grava em disco e só promove o clone para a memória se fn
  // não lançar erro. Garante senha/contador únicos mesmo sob chamadas
  // concorrentes, porque cada transação só começa depois da anterior terminar.
  transacao(fn) {
    const execucao = this._fila.then(async () => {
      this._garantirCarregado();
      const clone = structuredClone(this._estado);
      const resultado = fn(clone);
      await this._gravarDisco(clone);
      this._estado = clone;
      return structuredClone(resultado);
    });
    // Mantém a fila viva mesmo se esta transação falhar, sem travar as próximas.
    this._fila = execucao.catch(() => {});
    return execucao;
  }

  listarPedidos() {
    this._garantirCarregado();
    return structuredClone(Object.values(this._estado.pedidos)).sort((a, b) =>
      a.criadoEm < b.criadoEm ? -1 : 1
    );
  }

  obterPedido(id) {
    this._garantirCarregado();
    return structuredClone(this._estado.pedidos[id] || null);
  }

  obterPedidoPorIdempotencyKey(chave) {
    this._garantirCarregado();
    return (
      Object.values(this._estado.pedidos).find((p) => p.idempotencyKey === chave) || null
    );
  }
}
