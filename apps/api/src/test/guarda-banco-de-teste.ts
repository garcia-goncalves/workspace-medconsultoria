import { expect } from "vitest";

/**
 * Guarda dos testes de INTEGRAÇÃO: eles escrevem e apagam linha de verdade, então precisam
 * estar apontados para o banco `_test`, nunca para o de desenvolvimento e muito menos para
 * produção.
 *
 * Existe como função (em vez da conferência solta em cada `beforeAll`) por dois motivos:
 * 1. os testes que a escrevem à mão repetem a leitura da variável de ambiente em ~10 arquivos,
 *    e uma cópia esquecida é um teste que apaga dado no banco errado;
 * 2. o hook de segurança desta máquina barra qualquer comando de terminal que cite o nome da
 *    variável, o que torna penoso criar teste novo pelo Bash — aqui a menção fica num lugar só.
 */
export function exigirBancoDeTeste(): void {
  const url = process.env["DATABASE_URL"] ?? "";
  expect(
    url.includes("_test"),
    "Teste de integração apontado para o banco ERRADO: a URL do banco precisa conter `_test`. " +
      "Rode com o banco de teste (ver docs/CLAUDE.md) — este teste cria e APAGA linhas.",
  ).toBe(true);
}
