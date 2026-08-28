import { useEffect, useMemo } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import {
  createEventoSchema,
  EVENTO_TIPO_LABEL,
  RECORRENCIA_LABEL,
  type CreateEventoInput,
  type EventoTipo,
  type Recorrencia,
} from "@app/shared";
import { avisoDeSerie } from "./aviso-serie";
import { trpc } from "../../lib/trpc";
import { useAuth } from "../../lib/auth-context";
import { Modal } from "../../components/ui/modal";
import { Button } from "../../components/ui/button";
import { Input } from "../../components/ui/input";
import { Label } from "../../components/ui/label";
import { Textarea } from "../../components/ui/textarea";
import { Select } from "../../components/ui/select";
import { Combobox } from "../../components/ui/combobox";
import { useConfirmar } from "../../components/ui/confirm-dialog";
import { CalendarPlus, AlertTriangle, Users } from "lucide-react";
import { hora } from "../../lib/format-date";

export interface EventoEditavel {
  id: string;
  titulo: string;
  descricao: string | null;
  tipo: EventoTipo;
  escopo: "PESSOAL" | "EMPRESA";
  inicio: Date;
  fim: Date | null;
  diaInteiro: boolean;
  local: string | null;
  linkReuniao: string | null;
  recorrencia: Recorrencia;
  recorrenciaAte: Date | null;
  clienteId: string | null;
  projetoId: string | null;
  participanteIds: string[];
  /** Início da ocorrência clicada na tela — só difere de `inicio` em série recorrente. */
  ocorrenciaClicada?: Date | null;
}

const toLocalInput = (d?: Date | null): string => {
  if (!d) return "";
  const dt = new Date(d);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${dt.getFullYear()}-${p(dt.getMonth() + 1)}-${p(dt.getDate())}T${p(dt.getHours())}:${p(dt.getMinutes())}`;
};
const toDateInput = (d?: Date | null): string => (d ? new Date(d).toISOString().slice(0, 10) : "");
const parseLocal = (s?: string | null): Date | null => {
  if (!s) return null;
  const d = new Date(s);
  return isNaN(d.getTime()) ? null : d;
};

export function EventoFormDialog({
  open,
  onClose,
  evento,
  inicioPadrao,
}: {
  open: boolean;
  onClose: () => void;
  evento?: EventoEditavel;
  inicioPadrao?: Date;
}) {
  const utils = trpc.useUtils();
  const confirmar = useConfirmar();
  const { user } = useAuth();
  const isEdit = !!evento;
  const clientes = trpc.clientes.list.useQuery(undefined, { enabled: open });
  const projetos = trpc.projetos.list.useQuery(undefined, { enabled: open });
  const equipe = trpc.usuarios.equipe.useQuery(undefined, { enabled: open });

  const {
    register,
    handleSubmit,
    reset,
    watch,
    setValue,
    formState: { errors },
  } = useForm<CreateEventoInput>({
    resolver: zodResolver(createEventoSchema),
    defaultValues: { tipo: "COMPROMISSO", escopo: "EMPRESA", recorrencia: "NENHUMA", participanteIds: [] },
  });

  useEffect(() => {
    if (!open) return;
    reset({
      titulo: evento?.titulo ?? "",
      descricao: evento?.descricao ?? "",
      tipo: evento?.tipo ?? "COMPROMISSO",
      escopo: evento?.escopo ?? "EMPRESA",
      inicio: toLocalInput(evento?.inicio ?? inicioPadrao) as unknown as CreateEventoInput["inicio"],
      fim: toLocalInput(evento?.fim) as unknown as CreateEventoInput["fim"],
      diaInteiro: evento?.diaInteiro ?? false,
      local: evento?.local ?? "",
      linkReuniao: evento?.linkReuniao ?? "",
      recorrencia: evento?.recorrencia ?? "NENHUMA",
      recorrenciaAte: toDateInput(evento?.recorrenciaAte) as unknown as CreateEventoInput["recorrenciaAte"],
      clienteId: evento?.clienteId ?? "",
      projetoId: evento?.projetoId ?? "",
      participanteIds: evento?.participanteIds ?? [],
    });
  }, [open, evento, inicioPadrao, reset]);

  const invalidate = () => utils.agenda.list.invalidate();
  const create = trpc.agenda.create.useMutation({ onSuccess: () => (invalidate(), onClose()) });
  const update = trpc.agenda.update.useMutation({ onSuccess: () => (invalidate(), onClose()) });
  const pending = create.isPending || update.isPending;

  // Série recorrente: o formulário mostra a 1ª ocorrência e salvar muda todas.
  const avisoSerie = isEdit
    ? avisoDeSerie({
        recorrencia: evento.recorrencia,
        ocorrenciaClicada: evento.ocorrenciaClicada,
        baseInicio: evento.inicio,
      })
    : null;

  const clienteId = watch("clienteId");
  const projetoId = watch("projetoId");
  const participanteIds = watch("participanteIds") ?? [];
  const inicioStr = watch("inicio") as unknown as string;
  const fimStr = watch("fim") as unknown as string;
  const diaInteiro = watch("diaInteiro");

  // Projetos do cliente escolhido primeiro (facilita a associação).
  const projetoOpts = useMemo(() => {
    const lista = projetos.data ?? [];
    const ordenada = clienteId ? [...lista].sort((a, b) => Number(b.clienteId === clienteId) - Number(a.clienteId === clienteId)) : lista;
    return ordenada.map((p) => ({ value: p.id, label: p.cliente ? `${p.nome} · ${p.cliente.nome}` : p.nome }));
  }, [projetos.data, clienteId]);

  const equipeOutros = (equipe.data ?? []).filter((u) => u.id !== user.id);
  const toggleParticipante = (id: string) => {
    const set = new Set(participanteIds);
    if (set.has(id)) set.delete(id);
    else set.add(id);
    setValue("participanteIds", [...set], { shouldDirty: true });
  };

  // Conflito de horário — na sua agenda E na dos participantes convidados (só com hora e início válido).
  const inicioDate = parseLocal(inicioStr);
  const fimDate = parseLocal(fimStr);
  const conflitos = trpc.agenda.conflitos.useQuery(
    { inicio: inicioDate ?? new Date(), fim: fimDate, ignorarId: evento?.id, participanteIds },
    { enabled: open && !!inicioDate && !diaInteiro },
  );
  const temConflito = (conflitos.data?.length ?? 0) > 0;

  const onSubmit = async (data: CreateEventoInput) => {
    const cli = data.clienteId ? clientes.data?.find((c) => c.id === data.clienteId) : undefined;
    if (evento) {
      // Reagendou (mudou o início) um evento com cliente → oferece re-avisar por e-mail.
      const mudouInicio = toLocalInput(evento.inicio) !== (data.inicio as unknown as string);
      if (cli && mudouInicio) {
        const temEmail = !!cli.email?.trim();
        const { confirmado, marcado } = await confirmar({
          title: "Salvar e avisar o cliente?",
          description: `"${data.titulo.trim()}" foi remarcado para outro horário.`,
          confirmText: "Salvar",
          icon: CalendarPlus,
          checkbox: {
            label: "Avisar o cliente por e-mail",
            hint: temEmail ? `${cli.nome} recebe um e-mail com o novo horário.` : "Este cliente não tem e-mail cadastrado — nada será enviado.",
            default: temEmail,
          },
        });
        if (!confirmado) return;
        update.mutate({ id: evento.id, ...data, avisarCliente: marcado });
        return;
      }
      update.mutate({ id: evento.id, ...data });
      return;
    }
    // Novo evento com cliente vinculado: pergunta se avisa o cliente por e-mail.
    if (cli) {
      const temEmail = !!cli.email?.trim();
      const { confirmado, marcado } = await confirmar({
        title: "Criar evento na agenda?",
        description: `"${data.titulo.trim()}" será agendado${cli.nome ? ` para ${cli.nome}` : ""}.`,
        confirmText: "Criar evento",
        icon: CalendarPlus,
        checkbox: {
          label: "Avisar o cliente por e-mail",
          hint: temEmail
            ? `${cli.nome} recebe um e-mail com a data e o link da reunião (se houver).`
            : "Este cliente não tem e-mail cadastrado — nada será enviado.",
          default: temEmail,
        },
      });
      if (!confirmado) return;
      create.mutate({ ...data, avisarCliente: marcado });
    } else {
      create.mutate(data);
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={isEdit ? "Editar evento" : "Novo evento"}
      size="lg"
      footer={
        <>
          <Button type="button" variant="outline" onClick={onClose}>
            Cancelar
          </Button>
          <Button type="submit" form="evento-form" disabled={pending}>
            {isEdit ? "Salvar" : "Criar evento"}
          </Button>
        </>
      }
    >
      <form id="evento-form" onSubmit={handleSubmit(onSubmit)} className="space-y-2" noValidate>
        {avisoSerie && (
          <div className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900">
            <p className="font-semibold">{avisoSerie.titulo}</p>
            {avisoSerie.detalhe && <p className="mt-0.5">{avisoSerie.detalhe}</p>}
          </div>
        )}
        <div className="space-y-1">
          <Label htmlFor="titulo">Título *</Label>
          <Input id="titulo" autoFocus autoComplete="off" {...register("titulo")} />
          {errors.titulo && <p className="text-xs text-destructive">{errors.titulo.message}</p>}
        </div>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div className="space-y-1">
            <Label htmlFor="tipo" hint="Compromisso, retorno ao cliente ou reunião — organiza os eventos por tipo.">Tipo</Label>
            <Select id="tipo" {...register("tipo")}>
              {(Object.keys(EVENTO_TIPO_LABEL) as EventoTipo[]).map((t) => (
                <option key={t} value={t}>
                  {EVENTO_TIPO_LABEL[t]}
                </option>
              ))}
            </Select>
          </div>
          <div className="space-y-1">
            <Label htmlFor="escopo" hint="Empresa = evento do negócio. Pessoal = evento particular, só seu.">Escopo</Label>
            <Select id="escopo" {...register("escopo")}>
              <option value="EMPRESA">Empresa</option>
              <option value="PESSOAL">Pessoal</option>
            </Select>
          </div>
        </div>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div className="space-y-1">
            <Label htmlFor="inicio">Início *</Label>
            <Input id="inicio" type="datetime-local" autoComplete="off" {...register("inicio")} />
            {errors.inicio && <p className="text-xs text-destructive">{errors.inicio.message}</p>}
          </div>
          <div className="space-y-1">
            <Label htmlFor="fim">Fim</Label>
            <Input id="fim" type="datetime-local" autoComplete="off" {...register("fim")} />
            {errors.fim && <p className="text-xs text-destructive">{errors.fim.message}</p>}
          </div>
        </div>

        {/* Aviso de conflito de horário — na sua agenda e na dos participantes. Só avisa, não bloqueia. */}
        {temConflito && (
          <div className="flex items-start gap-2 rounded-lg border border-warning/40 bg-warning/10 px-3 py-2 text-xs text-warning">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
            <div className="space-y-0.5">
              <p className="font-medium">Conflito de horário</p>
              {conflitos.data!.map((c, i) => (
                <p key={i} className="text-warning/90">
                  {c.participante ? `${c.participante} já tem` : "Você já tem"} “{c.titulo}” ({hora(c.inicio)}
                  {c.fim ? `–${hora(c.fim)}` : ""}) nesse horário.
                </p>
              ))}
            </div>
          </div>
        )}

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div className="space-y-1">
            <Label htmlFor="linkReuniao" hint="Link do Meet/Zoom/Jitsi — vai junto no e-mail se o cliente for avisado.">Link da reunião</Label>
            <Input id="linkReuniao" placeholder="Meet/Zoom/Jitsi — https://…" autoComplete="off" {...register("linkReuniao")} />
            {errors.linkReuniao && <p className="text-xs text-destructive">{errors.linkReuniao.message}</p>}
          </div>
          <div className="space-y-1">
            <Label htmlFor="local">Local</Label>
            <Input id="local" placeholder="Endereço ou sala (opcional)" autoComplete="off" {...register("local")} />
          </div>
        </div>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div className="space-y-1">
            <Label htmlFor="recorrencia" hint="Repete o evento automaticamente (diário, semanal, etc.).">Repetição</Label>
            <Select id="recorrencia" {...register("recorrencia")}>
              {(Object.keys(RECORRENCIA_LABEL) as Recorrencia[]).map((r) => (
                <option key={r} value={r}>
                  {RECORRENCIA_LABEL[r]}
                </option>
              ))}
            </Select>
          </div>
          <div className="space-y-1">
            <Label htmlFor="recorrenciaAte" hint="Data em que a repetição do evento para.">Repetir até</Label>
            <Input id="recorrenciaAte" type="date" autoComplete="off" {...register("recorrenciaAte")} />
          </div>
        </div>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div className="space-y-1">
            <Label htmlFor="clienteId" hint="Vincula o evento a um cliente e permite avisá-lo por e-mail.">Cliente</Label>
            <Combobox
              id="clienteId"
              value={clienteId ?? ""}
              onChange={(v) => setValue("clienteId", v, { shouldDirty: true })}
              options={(clientes.data ?? []).map((c) => ({ value: c.id, label: c.nome }))}
              placeholder="Buscar cliente…"
              emptyText="Nenhum cliente encontrado."
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="projetoId" hint="Vincula o evento a um projeto específico (opcional).">Projeto</Label>
            <Combobox
              id="projetoId"
              value={projetoId ?? ""}
              onChange={(v) => setValue("projetoId", v, { shouldDirty: true })}
              options={projetoOpts}
              placeholder="Buscar projeto…"
              emptyText="Nenhum projeto encontrado."
            />
          </div>
        </div>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {/* Participantes da equipe (além de você — convidados veem o evento e recebem o lembrete). */}
          <div className="space-y-1">
            <Label hint="Colegas convidados veem o evento na agenda deles e recebem lembrete.">
              <Users className="mr-1 inline h-3.5 w-3.5" />
              Participantes da equipe
            </Label>
            <div className="flex max-h-[56px] flex-wrap gap-1.5 overflow-y-auto rounded-lg border bg-muted/20 p-2">
              {equipeOutros.length === 0 && <span className="text-xs text-muted-foreground">Nenhum outro membro da equipe.</span>}
              {equipeOutros.map((u) => {
                const on = participanteIds.includes(u.id);
                return (
                  <button
                    key={u.id}
                    type="button"
                    onClick={() => toggleParticipante(u.id)}
                    className={
                      "h-fit rounded-full border px-2.5 py-1 text-xs font-medium transition-colors " +
                      (on ? "border-primary bg-primary/10 text-primary" : "border-border text-muted-foreground hover:bg-accent")
                    }
                  >
                    {u.nome}
                  </button>
                );
              })}
            </div>
          </div>

          <div className="space-y-1">
            <div className="flex items-center justify-between">
              <Label htmlFor="descricao">Descrição</Label>
              <label className="flex items-center gap-2 text-sm font-medium">
                <input type="checkbox" {...register("diaInteiro")} className="h-4 w-4" />
                Dia inteiro
              </label>
            </div>
            <Textarea id="descricao" rows={2} placeholder="Pauta, observações… (opcional)" autoComplete="off" {...register("descricao")} />
          </div>
        </div>

        {(create.error || update.error) && (
          <p className="text-sm text-destructive">{create.error?.message ?? update.error?.message}</p>
        )}
      </form>
    </Modal>
  );
}
