import { useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { AlertTriangle, CheckCircle2, Clock, Pencil, Stethoscope, Trash2, UserPlus } from "lucide-react";
import {
  createProfissionalSchema,
  CONSELHOS,
  CONSELHO_LABEL,
  type CreateProfissionalInput,
  type VereditoTriagem,
} from "@app/shared";
import { trpc } from "../../../lib/trpc";
import { Card, CardHeader, CardTitle } from "../../../components/ui/card";
import { Button } from "../../../components/ui/button";
import { Modal } from "../../../components/ui/modal";
import { Input } from "../../../components/ui/input";
import { Label } from "../../../components/ui/label";
import { Select } from "../../../components/ui/select";
import { useConfirm } from "../../../components/ui/confirm-dialog";
import { toast } from "../../../components/ui/toast";

/**
 * "Pode credenciar?" — a triagem do credenciamento na ficha do cliente.
 *
 * O ganho não é a proposta mais bonita, é **não começar um trabalho impossível**. O card
 * responde antes de a Thaís escrever qualquer coisa: `INAPTO` é fato que papelada nenhuma
 * resolve hoje (não vender); `PENDENTE` é documento que falta (cobrar e seguir).
 *
 * Ele **avisa, não bloqueia**: gerar a proposta assim mesmo continua possível. Trava dura
 * erraria toda vez que a realidade estivesse na frente do cadastro — e o sistema seria
 * contornado por fora, que é onde o caos mora.
 */

const SELO: Record<VereditoTriagem, { texto: string; classe: string; Icone: typeof CheckCircle2 }> = {
  APTO: { texto: "Pode credenciar", classe: "bg-success/10 text-success", Icone: CheckCircle2 },
  PENDENTE: { texto: "Falta documento", classe: "bg-warning/10 text-warning", Icone: Clock },
  INAPTO: { texto: "Ainda não dá para credenciar", classe: "bg-destructive/10 text-destructive", Icone: AlertTriangle },
};

type Profissional = {
  id: string;
  nome: string;
  conselho: string;
  conselhoNumero: string | null;
  conselhoUf: string | null;
  especialidade: string | null;
  anoFormatura: number | null;
  tituloEspecialista: boolean;
  responsavelTecnico: boolean;
};

export function CredenciamentoCard({ clienteId }: { clienteId: string }) {
  const utils = trpc.useUtils();
  const confirm = useConfirm();
  const q = trpc.credenciamento.porCliente.useQuery({ clienteId });
  const [editando, setEditando] = useState<Profissional | null>(null);
  const [abrindo, setAbrindo] = useState(false);

  // Mexer no cadastro de um médico muda as DUAS visões da ficha: a papelada (esta) e o
  // andamento na operadora (`CredenciamentoGradeCard`, que lê `credenciamento.grade`). Sem
  // invalidar a segunda, o card ao lado continuava com o nome antigo — ou com a linha de um
  // médico que acabou de sair — até alguém recarregar a página.
  const invalidate = () => {
    utils.credenciamento.porCliente.invalidate({ clienteId });
    utils.credenciamento.grade.invalidate({ clienteId });
  };
  const remover = trpc.credenciamento.removerProfissional.useMutation({
    onSuccess: (r) => {
      invalidate();
      toast(
        r.desativado
          ? "Profissional desativado. Os documentos e os credenciamentos dele foram preservados."
          : "Profissional removido.",
        "success",
      );
    },
  });

  const dados = q.data;
  // Sem o serviço contratado e sem nenhum médico cadastrado, credenciamento não é assunto
  // deste cliente — o card some em vez de pedir alvará a quem só faz marketing.
  if (!dados?.emCurso) return null;

  const { triagem, progresso, porProfissional } = dados;
  const selo = SELO[triagem.veredito];

  const onRemover = async (p: Profissional) => {
    const ok = await confirm({
      title: `Remover ${p.nome}?`,
      description:
        "Se já houver documento enviado por ele — ou credenciamento registrado em alguma operadora — o cadastro é apenas desativado, e continua aparecendo em 'Credenciamentos em andamento'. Nada do que já foi feito se perde.",
      confirmText: "Remover",
      variant: "destructive",
    });
    if (ok) remover.mutate({ id: p.id });
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <Stethoscope className="h-4 w-4 text-muted-foreground" /> Credenciamento
        </CardTitle>
        <Button size="sm" variant="outline" onClick={() => setAbrindo(true)}>
          <UserPlus className="h-3.5 w-3.5" /> Novo profissional
        </Button>
      </CardHeader>

      <div className="space-y-3 p-5 pt-0">
        <div className="flex flex-wrap items-center gap-2">
          <span className={`inline-flex items-center gap-1.5 rounded px-2 py-1 text-xs font-semibold ${selo.classe}`}>
            <selo.Icone className="h-3.5 w-3.5" /> {selo.texto}
          </span>
          {progresso.total > 0 && (
            <span className="text-xs text-muted-foreground">
              Papelada: {progresso.atendidas} de {progresso.total} ({progresso.percentual}%)
            </span>
          )}
        </div>

        {triagem.motivos.length > 0 && (
          <ul className="space-y-1">
            {triagem.motivos.map((m, i) => (
              <li key={`${m.regra}-${m.profissionalId ?? i}`} className="flex items-start gap-2 text-sm">
                {m.nivel === "INAPTO" ? (
                  <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-destructive" />
                ) : (
                  <Clock className="mt-0.5 h-3.5 w-3.5 shrink-0 text-warning" />
                )}
                <span className="text-foreground">{m.texto}</span>
              </li>
            ))}
          </ul>
        )}

        {porProfissional.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Nenhum profissional cadastrado. O credenciamento é por pessoa — cadastre cada médico ou dentista para saber
            o que falta de cada um.
          </p>
        ) : (
          <ul className="divide-y rounded-lg border">
            {porProfissional.map(({ profissional: p, requisitos }) => {
              const vagas = requisitos.flatMap((r) => r.vagas);
              const entregues = vagas.filter((v) => v.arquivo).length;
              return (
                <li key={p.id} className="flex flex-wrap items-center gap-2 p-2.5">
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium text-foreground">
                      {p.nome}
                      {p.responsavelTecnico && (
                        <span className="ml-1.5 rounded bg-muted px-1 py-0.5 text-[10px] font-semibold uppercase text-muted-foreground">
                          Responsável técnico
                        </span>
                      )}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {CONSELHO_LABEL[p.conselho as keyof typeof CONSELHO_LABEL] ?? p.conselho}
                      {p.conselhoNumero ? ` ${p.conselhoNumero}` : ""}
                      {p.conselhoUf ? `/${p.conselhoUf}` : ""}
                      {p.especialidade ? ` · ${p.especialidade}` : ""}
                      {p.anoFormatura ? ` · formado em ${p.anoFormatura}` : ""}
                      {` · ${entregues}/${vagas.length} documentos`}
                    </p>
                  </div>
                  <button
                    onClick={() => setEditando(p)}
                    title="Editar"
                    className="text-muted-foreground/70 hover:text-foreground"
                  >
                    <Pencil className="h-3.5 w-3.5" />
                  </button>
                  <button
                    onClick={() => onRemover(p)}
                    title="Remover"
                    className="text-muted-foreground/70 hover:text-destructive"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      {(abrindo || editando) && (
        <ProfissionalFormDialog
          clienteId={clienteId}
          profissional={editando}
          onClose={() => {
            setAbrindo(false);
            setEditando(null);
          }}
          onSaved={invalidate}
        />
      )}
    </Card>
  );
}

function ProfissionalFormDialog({
  clienteId,
  profissional,
  onClose,
  onSaved,
}: {
  clienteId: string;
  profissional: Profissional | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const isEdit = !!profissional;
  const {
    register,
    handleSubmit,
    reset,
    formState: { errors },
  } = useForm<CreateProfissionalInput>({
    resolver: zodResolver(createProfissionalSchema),
    defaultValues: { clienteId, conselho: "CRM", tituloEspecialista: false, responsavelTecnico: false },
  });

  useEffect(() => {
    reset({
      clienteId,
      nome: profissional?.nome ?? "",
      conselho: (profissional?.conselho as CreateProfissionalInput["conselho"]) ?? "CRM",
      conselhoNumero: profissional?.conselhoNumero ?? "",
      conselhoUf: profissional?.conselhoUf ?? "",
      especialidade: profissional?.especialidade ?? "",
      anoFormatura: profissional?.anoFormatura ?? null,
      tituloEspecialista: profissional?.tituloEspecialista ?? false,
      responsavelTecnico: profissional?.responsavelTecnico ?? false,
    });
  }, [profissional, clienteId, reset]);

  const criar = trpc.credenciamento.criarProfissional.useMutation({
    onSuccess: () => {
      onSaved();
      toast("Profissional cadastrado.", "success");
      onClose();
    },
  });
  const atualizar = trpc.credenciamento.atualizarProfissional.useMutation({
    onSuccess: () => {
      onSaved();
      toast("Dados atualizados.", "success");
      onClose();
    },
  });
  const salvando = criar.isPending || atualizar.isPending;

  const onSubmit = (dados: CreateProfissionalInput) => {
    if (isEdit && profissional) atualizar.mutate({ ...dados, id: profissional.id });
    else criar.mutate(dados);
  };

  return (
    <Modal
      open
      onClose={onClose}
      title={isEdit ? "Editar profissional" : "Novo profissional"}
      footer={
        <>
          <Button variant="outline" onClick={onClose} disabled={salvando}>
            Cancelar
          </Button>
          <Button form="form-profissional" type="submit" disabled={salvando}>
            {salvando ? "Salvando…" : "Salvar"}
          </Button>
        </>
      }
    >
      <form id="form-profissional" onSubmit={handleSubmit(onSubmit)} className="space-y-2.5">
        <div className="space-y-1">
          <Label htmlFor="nome">Nome *</Label>
          <Input id="nome" {...register("nome")} placeholder="Dra. Carina Lottenberg" />
          {errors.nome && <p className="text-xs text-destructive">{errors.nome.message}</p>}
        </div>

        <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-3">
          <div className="space-y-1">
            <Label htmlFor="conselho">Conselho *</Label>
            <Select id="conselho" {...register("conselho")}>
              {CONSELHOS.map((c) => (
                <option key={c} value={c}>
                  {CONSELHO_LABEL[c]}
                </option>
              ))}
            </Select>
          </div>
          <div className="space-y-1">
            <Label htmlFor="conselhoNumero">Número</Label>
            <Input id="conselhoNumero" {...register("conselhoNumero")} placeholder="123456" />
          </div>
          <div className="space-y-1">
            <Label htmlFor="conselhoUf">UF</Label>
            <Input id="conselhoUf" {...register("conselhoUf")} placeholder="SP" maxLength={2} />
            {errors.conselhoUf && <p className="text-xs text-destructive">{errors.conselhoUf.message}</p>}
          </div>
        </div>

        <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
          <div className="space-y-1">
            <Label htmlFor="especialidade" hint="Entra na proposta, junto do nome — 'cardiologista'.">
              Especialidade
            </Label>
            <Input id="especialidade" {...register("especialidade")} placeholder="Cardiologista" />
          </div>
          <div className="space-y-1">
            <Label htmlFor="anoFormatura" hint="As operadoras exigem 5 anos de formado. O sistema calcula sozinho.">
              Ano de formatura
            </Label>
            <Input
              id="anoFormatura"
              type="number"
              placeholder="2015"
              {...register("anoFormatura", { setValueAs: (v) => (v === "" || v === null ? null : Number(v)) })}
            />
            {errors.anoFormatura && <p className="text-xs text-destructive">{errors.anoFormatura.message}</p>}
          </div>
        </div>

        <label className="flex items-center gap-2 text-sm text-foreground">
          <input type="checkbox" {...register("tituloEspecialista")} className="h-4 w-4" />
          Tem título de especialista
        </label>
        <label className="flex items-center gap-2 text-sm text-foreground">
          <input type="checkbox" {...register("responsavelTecnico")} className="h-4 w-4" />
          É o responsável técnico da clínica
        </label>
      </form>
    </Modal>
  );
}
