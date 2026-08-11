import { useState } from "react";
import { Building2, Loader2, RotateCcw } from "lucide-react";
import {
  STATUS_CREDENCIAMENTO,
  STATUS_CREDENCIAMENTO_AJUDA,
  STATUS_CREDENCIAMENTO_LABEL,
  transicaoCredenciamentoPermitida,
  type StatusCredenciamento,
} from "@app/shared";
import { trpc } from "../../../lib/trpc";
import { Card, CardHeader, CardTitle } from "../../../components/ui/card";
import { Button } from "../../../components/ui/button";
import { Modal } from "../../../components/ui/modal";
import { Label } from "../../../components/ui/label";
import { Select } from "../../../components/ui/select";
import { Textarea } from "../../../components/ui/textarea";
import { formatBRL } from "../../../lib/masks";
import { data as formatarData } from "../../../lib/format-date";
import { toast } from "../../../components/ui/toast";

/**
 * O ANDAMENTO de cada credenciamento — médico por médico, operadora por operadora.
 *
 * A grade nasce no construtor da proposta; aqui ela vira acompanhamento: onde cada processo
 * está, o que a operadora respondeu e quando. É a tela que responde "e o credenciamento do
 * Dr. Fulano na Omint, como está?" sem a Thaís abrir e-mail nenhum.
 *
 * O card só aparece quando existe grade — cliente sem credenciamento não ganha um card vazio.
 */

const COR: Record<StatusCredenciamento, string> = {
  A_PROTOCOLAR: "bg-muted text-muted-foreground",
  PROTOCOLADO: "bg-primary/10 text-primary",
  EM_ANALISE: "bg-warning/10 text-warning",
  APROVADO: "bg-success/10 text-success",
  NEGADO: "bg-destructive/10 text-destructive",
  ENCERRADO: "bg-muted text-muted-foreground",
};

type Celula = {
  id: string;
  profissionalId: string;
  operadoraId: string;
  valor: number;
  status: StatusCredenciamento;
  tentativa: number;
  motivoNegativa: string | null;
  observacoes: string | null;
  aprovadoEm: Date | string | null;
  negadoEm: Date | string | null;
  protocoladoEm: Date | string | null;
  emAnaliseEm: Date | string | null;
};

export function CredenciamentoGradeCard({ clienteId }: { clienteId: string }) {
  const utils = trpc.useUtils();
  const q = trpc.credenciamento.grade.useQuery({ clienteId });
  const [mudando, setMudando] = useState<Celula | null>(null);
  const [retentando, setRetentando] = useState<Celula | null>(null);

  const dados = q.data;
  if (!dados || dados.celulas.length === 0) return null;

  const nomeProf = (id: string) => dados.profissionais.find((p) => p.id === id)?.nome ?? "Profissional";
  const nomeOp = (id: string) => dados.operadoras.find((o) => o.id === id)?.nome ?? "Operadora";

  // Uma seção por médico, com os credenciamentos dele dentro — a leitura que a Thaís faz.
  const porMedico = dados.profissionais
    .map((p) => ({ profissional: p, celulas: dados.celulas.filter((c) => c.profissionalId === p.id) }))
    .filter((g) => g.celulas.length > 0);

  const aprovados = dados.celulas.filter((c) => c.status === "APROVADO").length;

  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <Building2 className="h-4 w-4 text-muted-foreground" /> Credenciamentos em andamento
        </CardTitle>
        <span className="text-xs text-muted-foreground">
          {aprovados} de {dados.celulas.length} aprovado(s) · em curso {formatBRL(dados.total)}
        </span>
      </CardHeader>

      <div className="space-y-3 p-5 pt-0">
        {porMedico.map(({ profissional: p, celulas }) => (
          <div key={p.id} className="rounded-lg border">
            <div className="border-b bg-muted/30 px-3 py-2">
              <p className="flex flex-wrap items-center gap-1.5 text-sm font-semibold">
                {p.nome}
                {/* Médico tirado da lista que ainda tem processo correndo. Ele continua aqui de
                    propósito: o credenciamento existe no mundo (e pode já ter virado cobrança),
                    e some-lo da tela era perder o único lugar onde se age sobre ele. */}
                {!p.ativo && (
                  <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] font-semibold uppercase text-muted-foreground">
                    Fora da lista
                  </span>
                )}
              </p>
              {p.especialidade && <p className="text-xs text-muted-foreground">{p.especialidade}</p>}
            </div>
            <ul className="divide-y">
              {celulas.map((c) => (
                <li key={c.id} className="flex flex-wrap items-center gap-2 px-3 py-2">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm">
                      {nomeOp(c.operadoraId)}
                      {c.tentativa > 1 && (
                        <span className="ml-1.5 rounded bg-muted px-1 py-0.5 text-[10px] font-semibold uppercase text-muted-foreground">
                          {c.tentativa}ª tentativa
                        </span>
                      )}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {formatBRL(c.valor)}
                      {c.aprovadoEm ? ` · aprovado em ${formatarData(c.aprovadoEm)}` : ""}
                      {c.negadoEm ? ` · negado em ${formatarData(c.negadoEm)}` : ""}
                      {/* A data que vale é a do estado ATUAL: em análise mostra quando entrou
                          em análise; antes disso, quando foi protocolado. */}
                      {!c.aprovadoEm && !c.negadoEm && c.emAnaliseEm
                        ? ` · em análise desde ${formatarData(c.emAnaliseEm)}`
                        : ""}
                      {!c.aprovadoEm && !c.negadoEm && !c.emAnaliseEm && c.protocoladoEm
                        ? ` · protocolado em ${formatarData(c.protocoladoEm)}`
                        : ""}
                    </p>
                    {c.motivoNegativa && <p className="mt-0.5 text-xs text-destructive">Motivo: {c.motivoNegativa}</p>}
                    {/* O acordo da nova tentativa e o que a Thaís anotou sobre o processo eram
                        gravados e nunca lidos — o campo existia só no banco. */}
                    {c.observacoes && <p className="mt-0.5 text-xs text-muted-foreground">{c.observacoes}</p>}
                  </div>
                  <span className={`rounded px-2 py-1 text-xs font-semibold ${COR[c.status]}`}>
                    {STATUS_CREDENCIAMENTO_LABEL[c.status]}
                  </span>
                  {c.status === "NEGADO" || c.status === "ENCERRADO" ? (
                    <Button size="sm" variant="outline" onClick={() => setRetentando(c)}>
                      <RotateCcw className="h-3.5 w-3.5" /> Nova tentativa
                    </Button>
                  ) : (
                    <Button size="sm" variant="outline" onClick={() => setMudando(c)}>
                      Atualizar
                    </Button>
                  )}
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>

      {mudando && (
        <MudarStatusDialog
          celula={mudando}
          titulo={`${nomeProf(mudando.profissionalId)} · ${nomeOp(mudando.operadoraId)}`}
          onClose={() => setMudando(null)}
          onSaved={() => {
            utils.credenciamento.grade.invalidate({ clienteId });
            // A aprovação cria uma conta a receber — o Financeiro precisa saber disso agora.
            // São DUAS telas: a página Financeiro e o card "Financeiro" da própria ficha, que
            // lê de `clientes.relacionados`. Sem a segunda, a Thaís aprovava e via, ao lado,
            // "Nenhuma conta vinculada" — concluindo que a cobrança não tinha nascido.
            utils.financeiro.invalidate();
            utils.clientes.relacionados.invalidate({ id: clienteId });
            setMudando(null);
          }}
        />
      )}

      {retentando && (
        <NovaTentativaDialog
          celula={retentando}
          titulo={`${nomeProf(retentando.profissionalId)} · ${nomeOp(retentando.operadoraId)}`}
          onClose={() => setRetentando(null)}
          onSaved={() => {
            utils.credenciamento.grade.invalidate({ clienteId });
            setRetentando(null);
          }}
        />
      )}
    </Card>
  );
}

/**
 * Reusado pelo Painel de Credenciamentos (`/credenciamentos`), por isso pede o MÍNIMO de que
 * precisa em vez da célula inteira da grade: o painel tem as mesmas três informações, com
 * outro formato em volta. Um segundo diálogo faria as mesmas travas viverem em dois lugares.
 */
export function MudarStatusDialog({
  celula,
  titulo,
  onClose,
  onSaved,
}: {
  celula: Pick<Celula, "id" | "status" | "observacoes" | "valor">;
  titulo: string;
  onClose: () => void;
  onSaved: () => void;
}) {
  // Só os destinos que a regra permite entram na lista — o que não pode não aparece, em vez
  // de aparecer e dar erro depois de a pessoa escolher.
  const destinos = STATUS_CREDENCIAMENTO.filter((s) => transicaoCredenciamentoPermitida(celula.status, s));
  const [status, setStatus] = useState<StatusCredenciamento>(destinos[0] ?? celula.status);
  const [motivo, setMotivo] = useState("");
  const [observacoes, setObservacoes] = useState(celula.observacoes ?? "");

  const mutar = trpc.credenciamento.mudarStatus.useMutation({
    onSuccess: () => {
      toast(
        status === "APROVADO"
          ? "Aprovado! A conta a receber do honorário foi criada no Financeiro."
          : "Andamento atualizado.",
        "success",
      );
      onSaved();
    },
    onError: (e) => toast(e.message, "error"),
  });

  return (
    <Modal
      open
      onClose={onClose}
      title="Atualizar andamento"
      size="sm"
      footer={
        <>
          <Button variant="outline" onClick={onClose} disabled={mutar.isPending}>
            Cancelar
          </Button>
          <Button
            disabled={mutar.isPending || destinos.length === 0 || (status === "NEGADO" && !motivo.trim())}
            onClick={() =>
              mutar.mutate({
                id: celula.id,
                status,
                motivoNegativa: motivo.trim() || undefined,
                observacoes: observacoes.trim(),
              })
            }
          >
            {mutar.isPending && <Loader2 className="h-4 w-4 animate-spin" />} Salvar
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        <p className="text-sm text-muted-foreground">{titulo}</p>

        <div className="space-y-1">
          <Label htmlFor="cred-status">Como está agora? *</Label>
          <Select id="cred-status" value={status} onChange={(e) => setStatus(e.target.value as StatusCredenciamento)}>
            {destinos.map((s) => (
              <option key={s} value={s}>
                {STATUS_CREDENCIAMENTO_LABEL[s]}
              </option>
            ))}
          </Select>
          <p className="text-xs text-muted-foreground">{STATUS_CREDENCIAMENTO_AJUDA[status]}</p>
        </div>

        {status === "NEGADO" && (
          <div className="space-y-1">
            <Label htmlFor="cred-motivo" hint="É o que sustenta pedir uma nova tentativa depois — e o que explica ao cliente.">
              Motivo da negativa *
            </Label>
            <Textarea id="cred-motivo" rows={2} value={motivo} onChange={(e) => setMotivo(e.target.value)} />
          </div>
        )}

        <div className="space-y-1">
          <Label
            htmlFor="cred-obs"
            hint="Fica guardado neste credenciamento e aparece na ficha — ex.: 'protocolo 4471, falar com a Renata do credenciamento'."
          >
            Anotações sobre este processo
          </Label>
          <Textarea id="cred-obs" rows={2} value={observacoes} onChange={(e) => setObservacoes(e.target.value)} />
        </div>

        {status === "APROVADO" && (
          <p className="rounded-lg border border-success/30 bg-success/5 p-2.5 text-xs text-foreground">
            Ao salvar, o honorário de <strong>{formatBRL(celula.valor)}</strong> entra no Financeiro como conta a
            receber. É aqui que a cobrança nasce — não no aceite da proposta.
          </p>
        )}
      </div>
    </Modal>
  );
}

function NovaTentativaDialog({
  celula,
  titulo,
  onClose,
  onSaved,
}: {
  celula: Celula;
  titulo: string;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [motivo, setMotivo] = useState("");
  const mutar = trpc.credenciamento.novaTentativa.useMutation({
    onSuccess: () => {
      toast("Nova tentativa aberta. A anterior continua registrada.", "success");
      onSaved();
    },
    onError: (e) => toast(e.message, "error"),
  });

  return (
    <Modal
      open
      onClose={onClose}
      title="Abrir nova tentativa"
      size="sm"
      footer={
        <>
          <Button variant="outline" onClick={onClose} disabled={mutar.isPending}>
            Cancelar
          </Button>
          <Button
            disabled={mutar.isPending || !motivo.trim()}
            onClick={() => mutar.mutate({ id: celula.id, motivo: motivo.trim() })}
          >
            {mutar.isPending && <Loader2 className="h-4 w-4 animate-spin" />} Abrir tentativa
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        <p className="text-sm text-muted-foreground">{titulo}</p>
        <p className="rounded-lg border bg-muted/30 p-2.5 text-xs text-foreground">
          Uma negativa encerra o credenciamento, salvo acordo com o cliente. A tentativa anterior continua no
          histórico, com o motivo da recusa — nada é apagado.
        </p>
        <div className="space-y-1">
          <Label htmlFor="cred-acordo" hint="Ex.: 'Cliente enviou o alvará atualizado e autorizou novo protocolo em 10/08.'">
            Qual foi o acordo? *
          </Label>
          <Textarea id="cred-acordo" rows={3} value={motivo} onChange={(e) => setMotivo(e.target.value)} />
        </div>
      </div>
    </Modal>
  );
}
