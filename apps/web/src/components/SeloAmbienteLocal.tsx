/**
 * Selo "AMBIENTE LOCAL" — o que impede confundir ensaio com realidade.
 *
 * Regra do CLAUDE.md global §0.8: a aplicação que roda no computador do dono avisa, na
 * TELA, que é local e que os dados são de mentira. Aviso em documentação não serve: quem
 * está prestes a apagar um cliente não está lendo o README.
 *
 * `import.meta.env.DEV` é resolvido pelo Vite em tempo de BUILD e vale `false` em
 * qualquer build de produção — o selo não tem como vazar para o ar por engano de
 * configuração, porque nem chega no pacote publicado.
 *
 * Fica `fixed` e `pointer-events-none` de propósito: a barra lateral tem um teste que
 * proíbe rolagem (`e2e/menu-sem-scroll.spec.ts`) e as telas de altura fixa calculam
 * `100dvh − 4rem` do cabeçalho. Uma faixa no fluxo da página quebraria as duas contas;
 * um selo flutuante não entra em conta nenhuma e não rouba clique de ninguém.
 */
export function SeloAmbienteLocal() {
  if (!import.meta.env.DEV) return null;
  return (
    <div
      className="pointer-events-none fixed bottom-3 left-1/2 z-[100] -translate-x-1/2 select-none rounded-full border border-amber-500/40 bg-amber-500/95 px-3 py-1 text-[11px] font-semibold tracking-wide text-amber-950 shadow-lg"
      role="status"
    >
      AMBIENTE LOCAL — dados de teste
    </div>
  );
}
