/**
 * Marca as contas de teste como "já definiram a própria senha" (ADR-91).
 *
 * Sem isto, TODA conta interna do seed cai na página "defina sua senha" logo após o login —
 * que é justamente o comportamento desejado em produção, mas cega a suíte E2E: o
 * `auth.setup.ts` valida o login checando que o campo de senha some da tela, e a página de
 * troca tem campos de senha. A suíte inteira quebraria por um motivo que não é bug.
 *
 * O fluxo de primeiro acesso NÃO fica sem cobertura: `e2e/flows-primeiro-acesso.spec.ts`
 * cria a própria conta DENTRO do teste, depois desta marcação — então nasce sem
 * `senhaTrocadaEm` e exercita a página de verdade.
 *
 * Roda depois de `db:seed` + `db:demo`, no E2E isolado e no CI. Nunca em produção — só toca
 * um banco de teste (é chamado só pelos scripts de E2E).
 */
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const { count } = await prisma.user.updateMany({
  where: { role: { not: "CLIENTE" }, senhaTrocadaEm: null },
  data: { senhaTrocadaEm: new Date() },
});

console.log(`✓ ${count} conta(s) de teste marcada(s) com senha já definida (E2E).`);
await prisma.$disconnect();
