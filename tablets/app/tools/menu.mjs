// Converte o cadastro do totem (gama-cardapio.json) no formato de menu do tablet (o mesmo que src/core.js indexa).
// Puro: sem rede, sem disco. Usado pelo build (HTML standalone) e pelo servidor do salao (tablets/servidor).
// Precos exatamente como no cadastro (centavos inteiros).

export function gruposValidos(j, p) {
  return p.grupos.map((id) => j.grupos.find((g) => g.id === id))
    .filter((g) => g && g.ativo !== 0 && j.opcoes.some((o) => o.adicional === g.id && o.ativo !== 0));
}

// escolhidos: lista de produtos do cadastro (objetos de j.produtos), na ordem desejada.
export function montarMenu(j, escolhidos) {
  const grupoIds = new Set();
  const produtos = escolhidos.map((p) => {
    const gs = gruposValidos(j, p).map((g) => g.id);
    gs.forEach((id) => grupoIds.add(id));
    return { id: p.id, nome: p.nome, descricao: p.descricao || "", categoria: p.categoria, variacoes: p.variacoes.map((v) => ({ indice: v.indice, nome: v.nome, centavos: v.centavos })),
      grupos: gs, ingredientes: p.ingredientes || [], ocultarObservacao: !!p.ocultarObservacao, ocultarQuantidade: !!p.ocultarQuantidade };
  });
  const grupos = j.grupos.filter((g) => grupoIds.has(g.id)).map((g) => ({ id: g.id, nome: g.nome, minimo: g.minimo, maximo: g.maximo, permitirQuantidade: !!g.permitir_quantidade }));
  const opcoes = j.opcoes.filter((o) => grupoIds.has(o.adicional) && o.ativo !== 0).map((o) => ({ id: o.id, nome: o.nome, grupo: o.adicional, descricao: o.descricao || "", centavos: o.centavos, posicao: o.posicao }));
  const catIds = new Set(escolhidos.map((p) => p.categoria));
  const categorias = j.categorias.filter((c) => catIds.has(c.id)).sort((a, b) => a.posicao - b.posicao).map((c) => ({ id: c.id, nome: c.nome }));
  const brt = new Date(Date.parse(j.fonte.consultadoEm) - 3 * 3600e3);
  const pad = (n) => String(n).padStart(2, "0");
  const consultaData = `${pad(brt.getUTCDate())}/${pad(brt.getUTCMonth() + 1)}/${brt.getUTCFullYear()}`;
  return {
    meta: { origem: j.fonte.origem, consultadoEm: j.fonte.consultadoEm, consultaData, sha256: j.fonte.sha256, totalProdutosSnapshot: j.produtos.length, amostra: produtos.length },
    categorias, produtos, grupos, opcoes,
  };
}
