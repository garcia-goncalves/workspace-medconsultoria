import { useState } from "react";
import { LifeBuoy, Plus, ArrowLeft, ChevronRight, Loader2 } from "lucide-react";
import { cn } from "@app/ui";
import { CHAMADO_STATUS_LABEL, type ChamadoStatus } from "@app/shared";
import { trpc } from "../../lib/trpc";
import { POLL, useEventoRealtime } from "../../lib/socket";
import { data } from "../../lib/format-date";
import { Card, CardHeader, CardTitle } from "../../components/ui/card";
import { Button } from "../../components/ui/button";
import { Input } from "../../components/ui/input";
import { Label } from "../../components/ui/label";
import { Textarea } from "../../components/ui/textarea";
import { Modal } from "../../components/ui/modal";
import { EmptyState } from "../../components/ui/empty-state";
import { toast } from "../../components/ui/toast";
import { SuporteChat } from "./SuporteChat";

const statusBadge: Record<ChamadoStatus, string> = {
  ABERTO: "bg-warning/15 text-warning",
  EM_ANDAMENTO: "bg-brand-blueLight/15 text-brand-blueText",
  RESOLVIDO: "bg-success/15 text-success",
};

export function PortalSuporte() {
  const utils = trpc.useUtils();
  const [sel, setSel] = useState<string | null>(null);
  const [abrir, setAbrir] = useState(false);
  const [assunto, setAssunto] = useState("");
  const [mensagem, setMensagem] = useState("");

  const chamados = trpc.portal.suporte.listChamados.useQuery(undefined, { refetchInterval: POLL.suporteLista });
  const thread = trpc.portal.suporte.mensagens.useQuery(
    { conversaId: sel ?? "" },
    { enabled: !!sel, refetchInterval: sel ? POLL.suporteThread : false },
  );
  const enviar = trpc.portal.suporte.enviar.useMutation({
    onSuccess: () => {
      if (sel) utils.portal.suporte.mensagens.invalidate({ conversaId: sel });
      utils.portal.suporte.listChamados.invalidate();
    },
  });
  const criar = trpc.portal.suporte.abrir.useMutation({
    onSuccess: (c) => {
      utils.portal.suporte.listChamados.invalidate();
      setAbrir(false);
      setAssunto("");
      setMensagem("");
      setSel(c.id);
      toast("Chamado aberto! Nossa equipe já foi avisada. 🙌", "success");
    },
  });

  useEventoRealtime("mensagem", () => {
    utils.portal.suporte.listChamados.invalidate();
    if (sel) utils.portal.suporte.mensagens.invalidate({ conversaId: sel });
  });

  const chamado = chamados.data?.find((c) => c.id === sel);

  return (
    <Card className="border-primary/30 shadow-sm ring-1 ring-primary/5">
      <CardHeader>
        <div className="min-w-0">
          <CardTitle>
            <LifeBuoy className="h-4 w-4 text-primary" /> Suporte
          </CardTitle>
          <span className="text-xs text-muted-foreground">Precisa de algo? Fale direto com a nossa equipe.</span>
        </div>
        {sel ? (
          <button onClick={() => setSel(null)} className="inline-flex items-center gap-1 text-xs text-primary hover:underline">
            <ArrowLeft className="h-3.5 w-3.5" /> Meus chamados
          </button>
        ) : (
          <Button size="sm" onClick={() => setAbrir(true)}>
            <Plus className="h-4 w-4" /> Abrir chamado
          </Button>
        )}
      </CardHeader>

      {sel ? (
        <div>
          <div className="flex items-center gap-2 border-b bg-muted/20 px-4 py-2 text-sm">
            <span className="font-medium">{chamado?.assunto ?? thread.data?.assunto}</span>
            {thread.data?.numero && <span className="text-xs text-muted-foreground">#{thread.data.numero}</span>}
            {thread.data?.status && <span className={cn("ml-auto rounded-full px-2 py-0.5 text-[10px] font-semibold", statusBadge[thread.data.status])}>{CHAMADO_STATUS_LABEL[thread.data.status]}</span>}
          </div>
          <SuporteChat
            mensagens={thread.data?.mensagens ?? []}
            meuLado="cliente"
            onEnviar={(corpo) => sel && enviar.mutate({ conversaId: sel, corpo })}
            enviando={enviar.isPending}
            isLoading={thread.isLoading}
            ancorarAcimaDaBarra
          />
        </div>
      ) : chamados.isLoading ? (
        <div className="flex justify-center py-10">
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        </div>
      ) : chamados.data && chamados.data.length > 0 ? (
        <div className="divide-y">
          {chamados.data.map((c) => (
            <button key={c.id} onClick={() => setSel(c.id)} className="flex w-full items-center gap-3 px-5 py-3 text-left hover:bg-accent/40">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="truncate text-sm font-medium">{c.assunto ?? "Chamado"}</span>
                  <span className="text-[10px] text-muted-foreground">#{c.numero}</span>
                  {c.status && <span className={cn("rounded-full px-2 py-0.5 text-[10px] font-semibold", statusBadge[c.status])}>{CHAMADO_STATUS_LABEL[c.status]}</span>}
                </div>
                <div className="truncate text-xs text-muted-foreground">{c.ultimaMensagem?.conteudo ?? "Sem mensagens"} · {data(c.updatedAt)}</div>
              </div>
              {c.naoLidas > 0 && <span className="flex h-5 min-w-5 items-center justify-center rounded-full bg-destructive px-1 text-[10px] font-semibold text-destructive-foreground">{c.naoLidas}</span>}
              <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
            </button>
          ))}
        </div>
      ) : (
        /* Vazio com uma saída, não um aviso. Antes a tela dizia "abra um chamado" e o botão
           ficava lá em cima, no cabeçalho do card — a instrução e a ação em lugares diferentes. */
        <div className="p-4">
          <EmptyState
            icon={LifeBuoy}
            title="Nenhum chamado aberto"
            description="Precisa de alguma coisa? Abra um chamado que a nossa equipe responde por aqui."
          >
            <Button onClick={() => setAbrir(true)}>
              <Plus className="h-4 w-4" /> Abrir chamado
            </Button>
          </EmptyState>
        </div>
      )}

      <Modal
        open={abrir}
        onClose={() => setAbrir(false)}
        title="Abrir chamado"
        footer={
          <>
            <Button variant="outline" onClick={() => setAbrir(false)}>Cancelar</Button>
            <Button disabled={!assunto.trim() || criar.isPending} onClick={() => criar.mutate({ assunto, mensagem: mensagem.trim() || undefined })}>Abrir chamado</Button>
          </>
        }
      >
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="assunto" hint="Um resumo curto do que você precisa, para a equipe entender rápido.">Assunto *</Label>
            <Input id="assunto" autoFocus value={assunto} onChange={(e) => setAssunto(e.target.value)} placeholder="Ex.: Dúvida sobre a minha fatura" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="msg" hint="Explique com mais detalhes o que você precisa (opcional).">Mensagem</Label>
            <Textarea id="msg" value={mensagem} onChange={(e) => setMensagem(e.target.value)} placeholder="Conte pra gente o que você precisa…" />
          </div>
        </div>
      </Modal>
    </Card>
  );
}
