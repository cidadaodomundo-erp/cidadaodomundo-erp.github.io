// Cardápio fictício fixo, apenas para demonstração local. Preços em centavos, rotulados FICTÍCIO.

export const PRODUTOS = [
  {
    id: "p1",
    nome: "Sanduíche Fictício",
    precoBase: 1500,
    adicionaisPermitidos: ["a1", "a2", "a3"],
    ingredientesRemoviveis: ["ing1", "ing2"],
  },
  {
    id: "p2",
    nome: "Refrigerante Fictício",
    precoBase: 600,
    adicionaisPermitidos: [],
    ingredientesRemoviveis: [],
  },
  {
    id: "p3",
    nome: "Porção Fictícia",
    precoBase: 2200,
    adicionaisPermitidos: ["a1", "a3"],
    ingredientesRemoviveis: ["ing2"],
  },
];

export const ADICIONAIS = [
  { id: "a1", nome: "Bacon fictício", preco: 400 },
  { id: "a2", nome: "Queijo extra fictício", preco: 300 },
  { id: "a3", nome: "Molho especial fictício", preco: 200 },
];

export const INGREDIENTES = [
  { id: "ing1", nome: "Cebola" },
  { id: "ing2", nome: "Picles" },
];

export function buscarProduto(id) {
  return PRODUTOS.find((p) => p.id === id) || null;
}

export function buscarAdicional(id) {
  return ADICIONAIS.find((a) => a.id === id) || null;
}

export function ingredienteExiste(id) {
  return INGREDIENTES.some((i) => i.id === id);
}
