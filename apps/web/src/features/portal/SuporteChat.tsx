import { useEffect, useRef, useState } from "react";
import { Send, Loader2, LifeBuoy } from "lucide-react";
import { cn } from "@app/ui";
import { Button } from "../../components/ui/button";
import { dataHora } from "../../lib/format-date";

export interface SuporteMsg {
  id: string;
  conteudo: string;
  createdAt: Date;
  autor: { id: string; nome: string; role: string } | null;
}

/** Chat de suporte (Portal ↔ equipe). `meuLado` alinha os balões do lado certo. */
export function SuporteChat({
  mensagens,
  meuLado,
  onEnviar,
  enviando,
  isLoading,
  ancorarAcimaDaBarra,
}: {
  mensagens: SuporteMsg[];
  meuLado: "equipe" | "cliente";
  onEnviar: (corpo: string) => void;
  enviando: boolean;
  isLoading?: boolean;
  /** Gruda o campo de escrita acima da barra de seções do Portal. */
  ancorarAcimaDaBarra?: boolean;
}) {
  const [texto, setTexto] = useState("");
  const bottomRef = useRef<HTMLDivElement>(null);
  const campoRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [mensagens.length]);

  /*
   * O campo cresce com o texto — até quatro linhas, e daí em diante rola por dentro.
   *
   * Era um campo de UMA linha, e mensagem de suporte raramente cabe numa: quem escrevia três
   * frases só via a última, sem forma de reler antes de mandar. O teto de quatro linhas existe
   * porque, no celular, um campo que cresce sem limite empurra a conversa inteira para fora da
   * tela — e a pessoa perde de vista justamente o que está respondendo.
   */
  const LINHAS_MAX = 4;
  useEffect(() => {
    const el = campoRef.current;
    if (!el) return;
    el.style.height = "auto";
    const linha = parseFloat(getComputedStyle(el).lineHeight || "20") || 20;
    const teto = linha * LINHAS_MAX + 16; // 16px = o respiro vertical do campo
    el.style.height = `${Math.min(el.scrollHeight, teto)}px`;
    el.style.overflowY = el.scrollHeight > teto ? "auto" : "hidden";
  }, [texto]);

  const enviar = () => {
    if (texto.trim()) {
      onEnviar(texto.trim());
      setTexto("");
    }
  };

  return (
    <div className="flex flex-col">
      {/* No Portal a conversa cresce com a página (a rolagem é a da tela, como em qualquer
          aplicativo de mensagem); nas outras telas ela fica contida numa caixa de 320px, para
          não empurrar o resto do conteúdo. */}
      <div
        className={cn(
          "min-h-40 flex-1 space-y-2 p-3",
          ancorarAcimaDaBarra ? "" : "max-h-80 overflow-auto",
        )}
      >
        {isLoading ? (
          <div className="flex h-32 items-center justify-center">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        ) : mensagens.length === 0 ? (
          <div className="flex flex-col items-center gap-2 py-10 text-center text-sm text-muted-foreground">
            <LifeBuoy className="h-6 w-6 text-muted-foreground/40" />
            {meuLado === "cliente"
              ? "Precisa de algo? Envie uma mensagem para a nossa equipe."
              : "Nenhuma mensagem de suporte com este cliente ainda."}
          </div>
        ) : (
          mensagens.map((m) => {
            const daEquipe = m.autor?.role !== "CLIENTE";
            const minha = (meuLado === "equipe") === daEquipe;
            return (
              <div key={m.id} className={cn("flex", minha ? "justify-end" : "justify-start")}>
                <div
                  className={cn(
                    // 85% a 360px: o balão respira e ainda mostra de que lado está.
                    "max-w-[85%] rounded-2xl px-3.5 py-2 text-sm shadow-sm",
                    minha ? "bg-primary text-primary-foreground" : "bg-muted text-foreground",
                  )}
                >
                  {!minha && (
                    <div className="mb-0.5 text-[11px] font-semibold opacity-80">
                      {daEquipe ? (m.autor?.nome ?? "Equipe MedConsultoria") : (m.autor?.nome ?? "Cliente")}
                    </div>
                  )}
                  <p className="whitespace-pre-wrap">{m.conteudo}</p>
                  <div
                    className={cn(
                      "mt-0.5 text-right text-[10px]",
                      minha ? "text-primary-foreground/70" : "text-muted-foreground",
                    )}
                  >
                    {dataHora(m.createdAt)}
                  </div>
                </div>
              </div>
            );
          })
        )}
        <div ref={bottomRef} />
      </div>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          enviar();
        }}
        className={cn(
          "flex items-end gap-2 border-t bg-muted/20 p-3",
          // No Portal, o campo fica GRUDADO acima da barra de seções enquanto se rola a
          // conversa. Sem isto, responder uma conversa longa exige rolar até o fim para
          // achar onde escrever — e no celular a barra de baixo ainda cobriria o campo.
          // No computador a barra não é fixa e não há nada para o campo evitar: `md:static`
          // devolve o comportamento normal, senão ele ficaria preso ao fundo da JANELA numa
          // tela de 1920px com três mensagens — flutuando sem motivo.
          ancorarAcimaDaBarra &&
            "sticky bottom-[calc(var(--portal-tabbar-h)+env(safe-area-inset-bottom))] z-10 md:static",
        )}
      >
        <textarea
          ref={campoRef}
          rows={1}
          value={texto}
          onChange={(e) => setTexto(e.target.value)}
          onKeyDown={(e) => {
            // Enter manda, Shift+Enter pula linha — o costume de todo aplicativo de conversa.
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              enviar();
            }
          }}
          placeholder="Escreva uma mensagem…"
          className="min-h-10 w-full resize-none rounded-2xl border border-input bg-card px-3.5 py-2 text-sm outline-none transition-colors placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-primary/40"
        />
        <Button type="submit" size="icon" disabled={enviando || !texto.trim()} className="shrink-0 rounded-full">
          <Send className="h-4 w-4" />
        </Button>
      </form>
    </div>
  );
}
