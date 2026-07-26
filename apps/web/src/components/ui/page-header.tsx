import * as React from "react";

/** Cabeçalho padrão de página: título + subtítulo + ações à direita. */
export function PageHeader({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle?: string;
  children?: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between sm:gap-4">
      <div className="min-w-0">
        <h1 className="text-2xl font-semibold tracking-tight text-primary">{title}</h1>
        {/* max-w no subtítulo: sem isso, o texto longo reivindica a largura de UMA linha e espreme as
            ações no desktop (fazendo um botão pular de linha). Capado, sobra espaço para as ações. */}
        {subtitle && <p className="mt-1 max-w-2xl text-sm text-muted-foreground">{subtitle}</p>}
      </div>
      {children && <div className="flex flex-wrap items-center gap-2 sm:justify-end">{children}</div>}
    </div>
  );
}
