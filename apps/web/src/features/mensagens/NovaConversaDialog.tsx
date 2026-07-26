import { useEffect, useMemo, useState } from "react";
import { Search, User, Users, Headset, ArrowLeft } from "lucide-react";
import { cn } from "@app/ui";
import { CHAMADO_PRIORIDADE_LABEL, type ChamadoPrioridade } from "@app/shared";
import { trpc } from "../../lib/trpc";
import { Modal } from "../../components/ui/modal";
import { Button } from "../../components/ui/button";
import { Input } from "../../components/ui/input";
import { Label } from "../../components/ui/label";
import { Select } from "../../components/ui/select";
import { Avatar } from "../../components/ui/avatar";

type Modo = "PESSOA" | "GRUPO" | "CHAMADO";

export function NovaConversaDialog({ open, onClose, onCreated }: { open: boolean; onClose: () => void; onCreated: (conversaId: string) => void }) {
  const utils = trpc.useUtils();
  const [modo, setModo] = useState<Modo>("PESSOA");
  const [nome, setNome] = useState("");
  const [busca, setBusca] = useState("");
  const [sel, setSel] = useState<string[]>([]);
  const [cliente, setCliente] = useState<{ id: string; nome: string } | null>(null);
  const [assunto, setAssunto] = useState("");
  const [prioridade, setPrioridade] = useState<ChamadoPrioridade>("NORMAL");

  const usuarios = trpc.mensagens.usuarios.useQuery(undefined, { enabled: open && modo !== "CHAMADO" });
  const clientes = trpc.mensagens.clientes.useQuery({ busca }, { enabled: open && modo === "CHAMADO" && !cliente });

  const reset = () => {
    setNome("");
    setBusca("");
    setSel([]);
    setCliente(null);
    setAssunto("");
    setPrioridade("NORMAL");
  };
  useEffect(() => {
    if (open) {
      setModo("PESSOA");
      reset();
    }
  }, [open]);

  const done = (conversaId: string) => {
    utils.mensagens.listConversas.invalidate();
    onCreated(conversaId);
    onClose();
  };
  const startInd = trpc.mensagens.startIndividual.useMutation({ onSuccess: (c) => done(c.id) });
  const createGrupo = trpc.mensagens.createGrupo.useMutation({ onSuccess: (c) => done(c.id) });
  const iniciarChamado = trpc.mensagens.iniciarChamado.useMutation({ onSuccess: (c) => done(c.id) });

  const toggle = (id: string) => setSel((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]));
  const usuariosFiltrados = useMemo(() => {
    const q = busca.trim().toLowerCase();
    return (usuarios.data ?? []).filter((u) => !q || u.nome.toLowerCase().includes(q));
  }, [usuarios.data, busca]);

  const MODOS: { id: Modo; label: string; icon: typeof User }[] = [
    { id: "PESSOA", label: "Pessoa", icon: User },
    { id: "GRUPO", label: "Grupo", icon: Users },
    { id: "CHAMADO", label: "Chamado", icon: Headset },
  ];

  const footer =
    modo === "CHAMADO" && cliente ? (
      <>
        <Button variant="outline" onClick={onClose}>
          Cancelar
        </Button>
        <Button disabled={!assunto.trim() || iniciarChamado.isPending} onClick={() => iniciarChamado.mutate({ clienteId: cliente.id, assunto, prioridade })}>
          Abrir chamado
        </Button>
      </>
    ) : modo === "GRUPO" ? (
      <>
        <span className="mr-auto text-xs text-muted-foreground">{sel.length} selecionado(s)</span>
        <Button variant="outline" onClick={onClose}>
          Cancelar
        </Button>
        <Button disabled={!nome.trim() || sel.length === 0 || createGrupo.isPending} onClick={() => createGrupo.mutate({ nome, participantIds: sel })}>
          Criar grupo
        </Button>
      </>
    ) : null;

  return (
    <Modal open={open} onClose={onClose} title="Nova conversa" footer={footer}>
      <div className="mb-3 inline-flex w-full gap-1 rounded-lg border bg-muted/40 p-0.5">
        {MODOS.map((mm) => (
          <button
            key={mm.id}
            onClick={() => (setModo(mm.id), reset())}
            className={cn("flex flex-1 items-center justify-center gap-1.5 rounded-md px-2 py-1.5 text-sm font-medium transition-colors", modo === mm.id ? "bg-card text-primary shadow-sm" : "text-muted-foreground hover:text-foreground")}
          >
            <mm.icon className="h-4 w-4" />
            {mm.label}
          </button>
        ))}
      </div>

      {/* CHAMADO — passo 2: assunto + prioridade */}
      {modo === "CHAMADO" && cliente ? (
        <div className="space-y-3">
          <button onClick={() => setCliente(null)} className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground">
            <ArrowLeft className="h-3.5 w-3.5" /> trocar cliente
          </button>
          <div className="rounded-lg border bg-muted/20 p-2.5 text-sm font-medium">{cliente.nome}</div>
          <div className="space-y-1.5">
            <Label htmlFor="assunto" hint="Um resumo curto do que o cliente precisa.">Assunto do chamado *</Label>
            <Input id="assunto" autoFocus value={assunto} onChange={(e) => setAssunto(e.target.value)} placeholder="Ex.: Dúvida sobre faturamento" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="prio" hint="Quão urgente é este chamado.">Prioridade</Label>
            <Select id="prio" value={prioridade} onChange={(e) => setPrioridade(e.target.value as ChamadoPrioridade)}>
              {(Object.keys(CHAMADO_PRIORIDADE_LABEL) as ChamadoPrioridade[]).map((p) => (
                <option key={p} value={p}>
                  {CHAMADO_PRIORIDADE_LABEL[p]}
                </option>
              ))}
            </Select>
          </div>
        </div>
      ) : (
        <>
          {modo === "GRUPO" && (
            <div className="mb-3 space-y-1.5">
              <Label htmlFor="nomeGrupo" hint="O nome que todos os participantes verão na lista de conversas.">Nome do grupo *</Label>
              <Input id="nomeGrupo" value={nome} onChange={(e) => setNome(e.target.value)} placeholder="Ex.: Equipe Comercial" />
            </div>
          )}

          <div className="relative mb-2">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input value={busca} onChange={(e) => setBusca(e.target.value)} placeholder={modo === "CHAMADO" ? "Buscar cliente ou lead…" : "Buscar pessoa…"} className="pl-8" />
          </div>

          <div className="max-h-64 space-y-1 overflow-auto rounded-md border p-1">
            {modo === "CHAMADO" ? (
              <>
                {clientes.isLoading && <p className="px-3 py-4 text-center text-sm text-muted-foreground">Buscando…</p>}
                {clientes.data?.length === 0 && <p className="px-3 py-4 text-center text-sm text-muted-foreground">Nenhum cliente encontrado.</p>}
                {clientes.data?.map((c) => (
                  <button key={c.id} onClick={() => setCliente({ id: c.id, nome: c.nome })} className="flex w-full items-center gap-2 rounded px-3 py-2 text-left text-sm hover:bg-accent">
                    <span className="flex h-7 w-7 items-center justify-center rounded-full bg-brand-blueText/10 text-xs font-semibold text-brand-blueText">{c.nome.charAt(0).toUpperCase()}</span>
                    <span className="flex-1 font-medium">{c.nome}</span>
                    <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] text-muted-foreground">{c.situacaoComercial}</span>
                  </button>
                ))}
              </>
            ) : (
              <>
                {usuariosFiltrados.length === 0 && <p className="px-3 py-4 text-center text-sm text-muted-foreground">Nenhuma pessoa encontrada.</p>}
                {usuariosFiltrados.map((u) => (
                  <button
                    key={u.id}
                    onClick={() => (modo === "PESSOA" ? startInd.mutate({ outroUserId: u.id }) : toggle(u.id))}
                    className={cn("flex w-full items-center gap-2 rounded px-3 py-2 text-left text-sm hover:bg-accent", modo === "GRUPO" && sel.includes(u.id) && "bg-accent")}
                  >
                    {modo === "GRUPO" && <input type="checkbox" readOnly checked={sel.includes(u.id)} className="h-4 w-4" />}
                    <Avatar id={u.id} nome={u.nome} avatarUrl={u.avatarUrl} className="h-7 w-7" text="text-xs" />
                    <span className="font-medium">{u.nome}</span>
                  </button>
                ))}
              </>
            )}
          </div>
        </>
      )}
    </Modal>
  );
}
