import { useState } from "react";
import { Mail, ChevronDown, CheckCircle2, AlertCircle } from "lucide-react";
import { cn } from "@app/ui";
import { dataHora } from "../lib/format-date";

export interface EmailEnviadoItem {
  id: string;
  para: string;
  assunto: string;
  templateLabel: string;
  /**
   * Texto do e-mail. **Opcional de propósito**: na ficha do cliente/lead e no Portal a API não
   * devolve o corpo (era por ele que vazava o link com token de redefinição de senha). Sem corpo,
   * o item não abre — mostra assunto, tipo, data e entrega.
   */
  corpo?: string | null;
  status: "ENVIADO" | "FALHOU";
  erro?: string | null;
  createdAt: string | Date;
}

/** Lista de e-mails enviados (histórico). Onde há corpo, cada item abre para ler o conteúdo. */
export function EmailsEnviadosList({
  emails,
  mostrarPara = false,
  mostrarStatus = true,
  vazio = "Nenhum e-mail enviado ainda.",
}: {
  emails: EmailEnviadoItem[];
  /** Mostra o destinatário (para visões que juntam vários), ex.: a aba de supervisão. */
  mostrarPara?: boolean;
  /** Selo de entrega (enviado/falhou). Ocultado no Portal — o cliente RECEBEU, não enviou. */
  mostrarStatus?: boolean;
  vazio?: string;
}) {
  const [aberto, setAberto] = useState<string | null>(null);
  if (emails.length === 0) return <p className="px-1 py-2 text-sm text-muted-foreground">{vazio}</p>;

  return (
    <div className="space-y-1.5">
      {emails.map((e) => {
        const abre = !!e.corpo;
        const open = abre && aberto === e.id;
        return (
          <div key={e.id} className="overflow-hidden rounded-lg border">
            <button
              type="button"
              disabled={!abre}
              onClick={() => setAberto(open ? null : e.id)}
              className={cn(
                "flex w-full items-center gap-2.5 p-2.5 text-left transition-colors",
                abre ? "hover:bg-accent/40" : "cursor-default",
              )}
            >
              <Mail className="h-4 w-4 shrink-0 text-muted-foreground" />
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-medium">{e.assunto}</div>
                <div className="flex flex-wrap items-center gap-x-1.5 text-[11px] text-muted-foreground">
                  <span>{e.templateLabel}</span>
                  <span>·</span>
                  <span className="tabular-nums">{dataHora(e.createdAt)}</span>
                  {mostrarPara && (
                    <>
                      <span>·</span>
                      <span className="truncate">{e.para}</span>
                    </>
                  )}
                </div>
                {/* Motivo da falha SEMPRE visível (sem precisar expandir) nas visões internas. */}
                {mostrarStatus && e.status === "FALHOU" && (
                  <div className="mt-1 flex items-start gap-1.5 rounded-md bg-destructive/10 px-2 py-1 text-[11px] leading-snug text-destructive">
                    <AlertCircle className="mt-[1px] h-3 w-3 shrink-0" />
                    <span className="min-w-0 break-words">
                      <span className="font-semibold">Por que falhou:</span>{" "}
                      {e.erro || "Motivo não registrado (falha anterior ao registro do detalhe)."}
                    </span>
                  </div>
                )}
              </div>
              {mostrarStatus &&
                (e.status === "FALHOU" ? (
                  <span className="inline-flex shrink-0 items-center gap-1 rounded bg-destructive/10 px-1.5 py-0.5 text-[10px] font-semibold text-destructive">
                    <AlertCircle className="h-3 w-3" /> falhou
                  </span>
                ) : (
                  <span className="inline-flex shrink-0 items-center gap-1 rounded bg-success/10 px-1.5 py-0.5 text-[10px] font-semibold text-success">
                    <CheckCircle2 className="h-3 w-3" /> enviado
                  </span>
                ))}
              {abre && (
                <ChevronDown className={cn("h-4 w-4 shrink-0 text-muted-foreground transition-transform", open && "rotate-180")} />
              )}
            </button>
            {open && (
              <div className="border-t bg-muted/30 p-3">
                <p className="whitespace-pre-wrap text-sm leading-relaxed text-muted-foreground">{e.corpo}</p>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
