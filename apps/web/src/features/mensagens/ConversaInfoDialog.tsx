import { useEffect, useState } from "react";
import { Link } from "@tanstack/react-router";
import { UserPlus, X, LogOut, ExternalLink, Loader2, Check, Trash2 } from "lucide-react";
import { cn } from "@app/ui";
import { CHAMADO_STATUS_LABEL, CHAMADO_PRIORIDADE_LABEL, type ChamadoStatus, type ChamadoPrioridade } from "@app/shared";
import { trpc } from "../../lib/trpc";
import { Modal } from "../../components/ui/modal";
import { Button } from "../../components/ui/button";
import { Input } from "../../components/ui/input";
import { Label } from "../../components/ui/label";
import { Select } from "../../components/ui/select";
import { useConfirm } from "../../components/ui/confirm-dialog";
import { Avatar } from "../../components/ui/avatar";

const STATUS: ChamadoStatus[] = ["ABERTO", "EM_ANDAMENTO", "RESOLVIDO"];
const statusCor: Record<ChamadoStatus, string> = {
  ABERTO: "bg-warning/15 text-warning border-warning/40",
  EM_ANDAMENTO: "bg-brand-blueLight/15 text-brand-blueText border-brand-blueLight/40",
  RESOLVIDO: "bg-success/15 text-success border-success/40",
};

export function ConversaInfoDialog({ conversaId, onClose, onSaiu }: { conversaId: string; onClose: () => void; onSaiu: () => void }) {
  const utils = trpc.useUtils();
  const confirm = useConfirm();
  const info = trpc.mensagens.info.useQuery({ conversaId });
  const equipe = trpc.usuarios.equipe.useQuery();
  const usuarios = trpc.mensagens.usuarios.useQuery();
  const [nomeGrupo, setNomeGrupo] = useState("");
  const [assunto, setAssunto] = useState("");
  const [addOpen, setAddOpen] = useState(false);

  useEffect(() => {
    if (info.data) {
      setNomeGrupo(info.data.nome ?? "");
      setAssunto(info.data.assunto ?? "");
    }
  }, [info.data]);

  const refetch = () => {
    utils.mensagens.info.invalidate({ conversaId });
    utils.mensagens.listConversas.invalidate();
  };
  const renomear = trpc.mensagens.renomearGrupo.useMutation({ onSuccess: refetch });
  const addPart = trpc.mensagens.addParticipantes.useMutation({ onSuccess: () => (refetch(), setAddOpen(false)) });
  const removerPart = trpc.mensagens.removerParticipante.useMutation({ onSuccess: refetch });
  const sair = trpc.mensagens.sair.useMutation({ onSuccess: () => (utils.mensagens.listConversas.invalidate(), onSaiu()) });
  const apagar = trpc.mensagens.apagar.useMutation({ onSuccess: () => (utils.mensagens.listConversas.invalidate(), onSaiu()) });
  const setStatus = trpc.mensagens.setStatus.useMutation({ onSuccess: refetch });
  const setResp = trpc.mensagens.setResponsavel.useMutation({ onSuccess: refetch });
  const setAssuntoM = trpc.mensagens.setAssunto.useMutation({ onSuccess: refetch });
  const setPrio = trpc.mensagens.setPrioridade.useMutation({ onSuccess: refetch });

  const d = info.data;
  const isGrupo = d?.tipo === "GRUPO";
  const isChamado = d?.tipo === "CLIENTE";
  const memberIds = new Set((d?.participantes ?? []).map((p) => p.id));
  const naoMembros = (usuarios.data ?? []).filter((u) => !memberIds.has(u.id));

  const confirmarSair = async () => {
    if (await confirm({ title: "Sair da conversa", description: "Você deixará de receber as mensagens desta conversa.", confirmText: "Sair", variant: "destructive" })) sair.mutate({ conversaId });
  };
  const confirmarApagar = async () => {
    if (await confirm({ title: "Apagar conversa", description: isChamado ? "O chamado será removido para todos." : "O grupo será apagado para todos os participantes.", confirmText: "Apagar", variant: "destructive" })) apagar.mutate({ conversaId });
  };

  const titulo = isChamado ? `Chamado ${d?.numero ? `#${d.numero}` : ""}` : isGrupo ? "Detalhes do grupo" : "Detalhes da conversa";

  const footer = d ? (
    <>
      {isGrupo && (
        <Button variant="outline" size="sm" onClick={confirmarSair} className="text-muted-foreground">
          <LogOut className="h-4 w-4" /> Sair
        </Button>
      )}
      {((isGrupo && d.podeGerir) || (isChamado && d.ehAdmin)) && (
        <Button variant="outline" size="sm" onClick={confirmarApagar} className="text-destructive hover:bg-destructive/10">
          <Trash2 className="h-4 w-4" /> Apagar {isChamado ? "chamado" : "grupo"}
        </Button>
      )}
    </>
  ) : null;

  return (
    <Modal open onClose={onClose} title={titulo} footer={footer}>
      {info.isLoading || !d ? (
        <div className="flex justify-center py-10">
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        </div>
      ) : (
        <div className="space-y-4">
          {isChamado && (
            <>
              <div className="flex items-center justify-between rounded-lg border bg-muted/20 p-3">
                <div>
                  <div className="font-medium">{d.cliente?.nome}</div>
                  <div className="text-xs text-muted-foreground">Chamado de suporte {d.resolvidoEm ? "· resolvido" : ""}</div>
                </div>
                {d.clienteId && (
                  <Link to="/clientes/$clienteId" params={{ clienteId: d.clienteId }} className="inline-flex items-center gap-1 text-sm text-primary hover:underline">
                    Ver ficha <ExternalLink className="h-3.5 w-3.5" />
                  </Link>
                )}
              </div>

              <div className="space-y-1.5">
                <Label hint="Um resumo curto do que o cliente precisa.">Assunto</Label>
                <div className="flex gap-2">
                  <Input value={assunto} onChange={(e) => setAssunto(e.target.value)} placeholder="Ex.: Dúvida sobre faturamento" />
                  <Button variant="outline" size="sm" disabled={!assunto.trim() || setAssuntoM.isPending} onClick={() => setAssuntoM.mutate({ conversaId, assunto })}>
                    {setAssuntoM.isSuccess ? <Check className="h-4 w-4" /> : "Salvar"}
                  </Button>
                </div>
              </div>

              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label hint="Situação atual do chamado: aberto, em andamento ou resolvido.">Status</Label>
                  <div className="flex flex-wrap gap-1.5">
                    {STATUS.map((s) => (
                      <button key={s} onClick={() => setStatus.mutate({ conversaId, status: s })} className={cn("rounded-full border px-2.5 py-1 text-xs font-medium transition-colors", d.status === s ? statusCor[s] : "border-border text-muted-foreground hover:bg-accent")}>
                        {CHAMADO_STATUS_LABEL[s]}
                      </button>
                    ))}
                  </div>
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="prio" hint="Quão urgente é este chamado.">Prioridade</Label>
                  <Select id="prio" value={d.prioridade} onChange={(e) => setPrio.mutate({ conversaId, prioridade: e.target.value as ChamadoPrioridade })}>
                    {(Object.keys(CHAMADO_PRIORIDADE_LABEL) as ChamadoPrioridade[]).map((p) => (
                      <option key={p} value={p}>
                        {CHAMADO_PRIORIDADE_LABEL[p]}
                      </option>
                    ))}
                  </Select>
                </div>
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="resp" hint="Quem da equipe vai atender este chamado.">Responsável</Label>
                <Select id="resp" value={d.responsavel?.id ?? ""} onChange={(e) => setResp.mutate({ conversaId, responsavelId: e.target.value || null })}>
                  <option value="">Sem responsável</option>
                  {(equipe.data ?? []).map((u) => (
                    <option key={u.id} value={u.id}>
                      {u.nome}
                    </option>
                  ))}
                </Select>
              </div>
            </>
          )}

          {isGrupo && d.podeGerir && (
            <div className="space-y-1.5">
              <Label hint="O nome que todos os participantes verão na lista de conversas.">Nome do grupo</Label>
              <div className="flex gap-2">
                <Input value={nomeGrupo} onChange={(e) => setNomeGrupo(e.target.value)} />
                <Button variant="outline" size="sm" disabled={!nomeGrupo.trim() || renomear.isPending} onClick={() => renomear.mutate({ conversaId, nome: nomeGrupo })}>
                  {renomear.isSuccess ? <Check className="h-4 w-4" /> : "Salvar"}
                </Button>
              </div>
            </div>
          )}

          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <Label hint="Pessoas que fazem parte desta conversa e podem ver as mensagens.">Participantes ({d.participantes.length})</Label>
              {isGrupo && d.podeGerir && (
                <button onClick={() => setAddOpen((v) => !v)} className="inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline">
                  <UserPlus className="h-3.5 w-3.5" /> Adicionar
                </button>
              )}
            </div>

            {addOpen && isGrupo && (
              <div className="max-h-40 space-y-1 overflow-auto rounded-md border p-1">
                {naoMembros.length === 0 && <p className="px-2 py-3 text-center text-xs text-muted-foreground">Todos já estão no grupo.</p>}
                {naoMembros.map((u) => (
                  <button key={u.id} onClick={() => addPart.mutate({ conversaId, userIds: [u.id] })} className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-sm hover:bg-accent">
                    <UserPlus className="h-3.5 w-3.5 text-muted-foreground" /> {u.nome}
                  </button>
                ))}
              </div>
            )}

            <div className="max-h-48 space-y-0.5 overflow-auto rounded-md border">
              {d.participantes.map((p) => (
                <div key={p.id} className="flex items-center gap-2 px-3 py-2 text-sm">
                  <Avatar id={p.id} nome={p.nome} avatarUrl={p.avatarUrl} className="h-7 w-7" text="text-xs" />
                  <span className="flex-1">{p.nome}</span>
                  <span className="text-[10px] uppercase text-muted-foreground">{p.role === "CLIENTE" ? "cliente" : p.role.toLowerCase()}</span>
                  {isGrupo && d.podeGerir && (
                    <button
                      onClick={async () => {
                        if (
                          await confirm({
                            title: "Remover participante",
                            description: `Remover ${p.nome} do grupo?`,
                            confirmText: "Remover",
                            variant: "destructive",
                          })
                        )
                          removerPart.mutate({ conversaId, userId: p.id });
                      }}
                      className="rounded p-1 text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                      title="Remover"
                    >
                      <X className="h-3.5 w-3.5" />
                    </button>
                  )}
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </Modal>
  );
}
