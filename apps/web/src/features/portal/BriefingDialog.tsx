import { useEffect, useState } from "react";
import { Download, Loader2, Send } from "lucide-react";
import { trpc } from "../../lib/trpc";
import { escapeHtml } from "../../lib/escape-html";
import { Modal } from "../../components/ui/modal";
import { Button } from "../../components/ui/button";
import { Input } from "../../components/ui/input";
import { Textarea } from "../../components/ui/textarea";
import { toast } from "../../components/ui/toast";

type Valor = string | string[];
type Campo = { id: string; rotulo: string; tipo: string; obrigatorio: boolean; opcoes: string[]; ajuda: string | null };

/** Formata o valor de um campo para o texto do "baixar" (impressão/PDF). */
const valorTexto = (v: Valor | undefined) => (Array.isArray(v) ? v.join(", ") : v || "—");

/**
 * Preenchimento de um briefing/formulário ONLINE pelo cliente (Portal). Salva rascunho,
 * envia, e permite BAIXAR (imprimir/PDF) — o cliente escolhe fazer na tela ou baixar.
 */
export function BriefingDialog({ requisitoId, onClose, onSaved }: { requisitoId: string; onClose: () => void; onSaved?: () => void }) {
  const utils = trpc.useUtils();
  const q = trpc.portal.briefing.get.useQuery({ requisitoId });
  const [valores, setValores] = useState<Record<string, Valor>>({});

  useEffect(() => {
    if (q.data?.resposta) setValores(q.data.resposta.respostas as Record<string, Valor>);
  }, [q.data]);

  const salvar = trpc.portal.briefing.salvar.useMutation({
    onSuccess: (_r, vars) => {
      utils.portal.meusServicos.invalidate();
      onSaved?.();
      if (vars.enviar) {
        toast("Formulário enviado! Nossa equipe já recebeu. 🙌", "success");
        onClose();
      } else {
        toast("Rascunho salvo.", "success");
      }
    },
  });

  const campos = (q.data?.campos ?? []) as Campo[];
  const set = (id: string, v: Valor) => setValores((p) => ({ ...p, [id]: v }));
  const enviado = q.data?.resposta?.status === "ENVIADO";

  const faltamObrig = campos
    .filter((c) => c.obrigatorio)
    .some((c) => {
      const v = valores[c.id];
      return Array.isArray(v) ? v.length === 0 : !v?.trim();
    });

  const baixar = () => {
    // Escapa rótulos/respostas/título — nunca renderizar HTML ativo na janela de impressão (XSS #6).
    const linhas = campos
      .map(
        (c) =>
          `<div style="margin-bottom:14px"><div style="font-weight:600">${escapeHtml(c.rotulo)}</div><div style="white-space:pre-wrap">${escapeHtml(valorTexto(valores[c.id]))}</div></div>`,
      )
      .join("");
    const w = window.open("", "_blank");
    if (!w) return;
    w.document.write(
      `<html><head><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'"><title>${escapeHtml(q.data?.titulo ?? "Formulário")}</title></head><body style="font-family:Arial,sans-serif;max-width:640px;margin:24px auto;color:#111"><h1 style="color:#002463">${escapeHtml(q.data?.titulo ?? "")}</h1>${linhas}</body></html>`,
    );
    w.document.close();
    w.focus();
    w.print();
  };

  const footer = q.data ? (
    <>
      <Button variant="outline" size="sm" className="min-h-11" onClick={onClose} disabled={salvar.isPending}>
        Cancelar
      </Button>
      <Button variant="outline" size="sm" className="min-h-11" onClick={baixar}>
        <Download className="h-4 w-4" /> Baixar
      </Button>
      <Button
        variant="outline"
        size="sm"
        className="min-h-11"
        disabled={salvar.isPending}
        onClick={() => salvar.mutate({ requisitoId, respostas: valores, enviar: false })}
      >
        Salvar rascunho
      </Button>
      <Button
        size="sm"
        className="min-h-11"
        disabled={salvar.isPending || faltamObrig}
        onClick={() => salvar.mutate({ requisitoId, respostas: valores, enviar: true })}
      >
        <Send className="h-4 w-4" /> Enviar
      </Button>
    </>
  ) : null;

  return (
    <Modal open onClose={onClose} title={q.data?.titulo ?? "Formulário"} footer={footer}>
      {q.isLoading ? (
        <div className="flex items-center gap-2 py-8 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> Carregando…
        </div>
      ) : (
        <div className="space-y-4">
          {q.data?.descricao && <p className="text-sm text-muted-foreground">{q.data.descricao}</p>}
          {enviado && (
            <div className="rounded-md border border-success/40 bg-success/5 px-3 py-2 text-xs text-success">
              Você já enviou este formulário. Pode revisar e reenviar se precisar.
            </div>
          )}

          <div className="max-h-[52vh] space-y-4 overflow-y-auto pr-1">
            {campos.map((c) => (
              <div key={c.id} className="space-y-1.5">
                <label className="text-sm font-medium text-foreground">
                  {c.rotulo}
                  {c.obrigatorio && <span className="ml-0.5 text-destructive">*</span>}
                </label>
                {c.ajuda && <p className="text-xs text-muted-foreground">{c.ajuda}</p>}
                {c.tipo === "TEXTO_LONGO" ? (
                  <Textarea rows={3} value={(valores[c.id] as string) ?? ""} onChange={(e) => set(c.id, e.target.value)} />
                ) : c.tipo === "NUMERO" ? (
                  <Input type="number" value={(valores[c.id] as string) ?? ""} onChange={(e) => set(c.id, e.target.value)} />
                ) : c.tipo === "DATA" ? (
                  <Input type="date" value={(valores[c.id] as string) ?? ""} onChange={(e) => set(c.id, e.target.value)} />
                ) : c.tipo === "SIM_NAO" ? (
                  <div className="flex gap-2">
                    {["Sim", "Não"].map((op) => (
                      <button
                        key={op}
                        type="button"
                        onClick={() => set(c.id, op)}
                        className={
                          "min-h-11 rounded-md border px-3 py-1.5 text-sm transition-colors " +
                          (valores[c.id] === op ? "border-primary bg-primary/10 font-medium text-primary" : "hover:bg-accent")
                        }
                      >
                        {op}
                      </button>
                    ))}
                  </div>
                ) : c.tipo === "ESCOLHA" ? (
                  <div className="space-y-1">
                    {c.opcoes.map((op) => (
                      <label key={op} className="flex min-h-11 cursor-pointer items-center gap-2 text-sm">
                        <input type="radio" name={c.id} checked={valores[c.id] === op} onChange={() => set(c.id, op)} className="accent-[var(--primary)]" />
                        {op}
                      </label>
                    ))}
                  </div>
                ) : c.tipo === "MULTIPLA" ? (
                  <div className="space-y-1">
                    {c.opcoes.map((op) => {
                      const arr = (valores[c.id] as string[]) ?? [];
                      return (
                        <label key={op} className="flex min-h-11 cursor-pointer items-center gap-2 text-sm">
                          <input
                            type="checkbox"
                            checked={arr.includes(op)}
                            onChange={(e) => set(c.id, e.target.checked ? [...arr, op] : arr.filter((x) => x !== op))}
                            className="accent-[var(--primary)]"
                          />
                          {op}
                        </label>
                      );
                    })}
                  </div>
                ) : (
                  <Input value={(valores[c.id] as string) ?? ""} onChange={(e) => set(c.id, e.target.value)} />
                )}
              </div>
            ))}
          </div>
          {faltamObrig && <p className="text-right text-xs text-muted-foreground">Preencha os campos obrigatórios (*) para enviar.</p>}
        </div>
      )}
    </Modal>
  );
}
