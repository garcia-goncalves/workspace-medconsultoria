import * as React from "react";
import { cn } from "@app/ui";

/**
 * Tabela padrão (já embrulhada em card com borda, sombra e overflow).
 *
 * `rotulo` vira o nome acessível da tabela. Numa tela com duas ou três tabelas — e a Conciliação
 * tem —, o leitor de tela anuncia todas como "tabela" e quem ouve não sabe qual é qual.
 */
export function Table({ className, children, rotulo }: { className?: string; children: React.ReactNode; rotulo?: string }) {
  return (
    // `data-rolagem-horizontal`: a tabela larga rola AQUI dentro de propósito. A marca diz isso
    // ao `e2e/responsividade-total.spec.ts`, que sem ela reprovaria a rolagem e induziria alguém a
    // "consertar" tirando-a.
    //
    // `tabIndex`: contêiner que rola precisa receber foco, senão quem navega por teclado não
    // consegue rolá-lo (WCAG 2.1.1). Com `aria-label` ele vira uma região anunciada; sem rótulo,
    // fica focável mas sem nome, que é o comportamento de antes.
    <div data-rolagem-horizontal tabIndex={0} aria-label={rotulo} className="overflow-x-auto rounded-xl border bg-card shadow-sm">
      <table aria-label={rotulo} className={cn("w-full text-sm", className)}>
        {children}
      </table>
    </div>
  );
}

export function THead(props: React.HTMLAttributes<HTMLTableSectionElement>) {
  return <thead className="border-b bg-muted/40 text-left text-[11px] uppercase tracking-wider text-muted-foreground" {...props} />;
}

export function TH({ className, ...props }: React.ThHTMLAttributes<HTMLTableCellElement>) {
  return <th className={cn("px-4 py-3 font-semibold", className)} {...props} />;
}

export function TR({ className, ...props }: React.HTMLAttributes<HTMLTableRowElement>) {
  return <tr className={cn("border-b border-border/60 transition-colors last:border-0 hover:bg-accent/40", className)} {...props} />;
}

export function TD({ className, ...props }: React.TdHTMLAttributes<HTMLTableCellElement>) {
  return <td className={cn("px-4 py-3 align-middle", className)} {...props} />;
}
