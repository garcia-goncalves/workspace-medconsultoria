import { Loader2, Sparkles } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "@app/ui";
import { Button, type ButtonProps } from "../ui/button";

/** Frase do botão de IA desligado — ele fica À VISTA, desabilitado, e diz o porquê (ADR-156). */
export const IA_DESLIGADA = "IA desligada: falta configurar a chave";

/**
 * Botão de IA compartilhado por toda a aplicação (ex-componente local do editor da Proposta
 * Personalizada, extraído no W5/Onda 1). NUNCA some quando a IA está indisponível — antes das
 * telas antigas (Cliente, Lead, Documento, Formulários…) usarem este componente, o botão só
 * aparecia com `ia.data?.disponivel &&`, e sem `GEMINI_API_KEY` no servidor ele simplesmente
 * desaparecia, sem explicação nenhuma. Aqui ele fica desabilitado, com a explicação em TEXTO
 * VISÍVEL ao lado — não só no `title` (que o leitor de tela não lê de forma confiável).
 */
export function BotaoIA({
  iaDisponivel,
  pendente,
  onClick,
  children,
  disabled,
  ocupado,
  variant = "outline",
  size = "sm",
  className,
}: {
  iaDisponivel: boolean | undefined;
  pendente: boolean;
  onClick: () => void;
  children: ReactNode;
  disabled?: boolean;
  /** Outra chamada de IA em andamento: só uma por vez (quando a mutation é compartilhada). */
  ocupado?: boolean;
  variant?: ButtonProps["variant"];
  size?: ButtonProps["size"];
  className?: string;
}) {
  const motivo = iaDisponivel === undefined ? "Verificando se a IA está ligada…" : iaDisponivel ? null : IA_DESLIGADA;
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Button
        type="button"
        variant={variant}
        size={size}
        className={cn("min-h-11", className)}
        disabled={!iaDisponivel || pendente || disabled || ocupado}
        onClick={onClick}
        title={motivo ?? undefined}
      >
        {pendente ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
        {children}
      </Button>
      {motivo && <span className="text-xs text-muted-foreground">{motivo}</span>}
    </div>
  );
}
