# Arquitetura das extensões

## Princípio

A base existente do portal é preservada. Módulos, rotas, permissões e contratos de dados já em produção não são alterados pelas extensões.

## Extensões migradas

Telas trazidas do portal anterior são marcadas no menu (`casca/menu.js`) com `origem: 'migracao'`. Na interface, essas telas recebem o selo **Migrado** e um destaque visual discreto, o que permite distinguir o que veio da migração durante a convergência.

Telas migradas atualmente: Delivery do dia, Reservas (GetIn), Produtos pausados, Consulta de ponto, Ponto ao Vivo e Eventos e ausências.

## Integração controlada

- Cada tela migrada entra como item novo de menu e página própria, sem sobrepor módulos existentes.
- As telas são somente de leitura e consultam apenas funções e tabelas já autorizadas pelas regras de acesso do banco.
- Mudanças de acesso, banco ou automações são tratadas como etapas administrativas separadas, fora do código das telas.

## Objetivo

Convergir para um produto único: à medida que cada tela migrada for validada, o selo de origem pode ser retirado e a tela passa a ser mantida como módulo regular do portal.

