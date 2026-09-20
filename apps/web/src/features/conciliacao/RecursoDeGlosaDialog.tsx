import { useState } from "react";
import { trpc } from "../../lib/trpc";
import { Modal } from "../../components/ui/modal";
import { Button } from "../../components/ui/button";
import { Input } from "../../components/ui/input";
import { Label } from "../../components/ui/label";
import { Select } from "../../components/ui/select";
import { Textarea } from "../../components/ui/textarea";
import { Skeleton } from "../../components/ui/skeleton";
import { QueryError } from "../../components/ui/query-error";
import { toast } from "../../components/ui/toast";
import { formatBRL } from "../../lib/masks";
import { dataUTC } from "../../lib/format-date";
import { ROTULO_RECURSO } from "./partes";
import type { CirurgiaConciliada } from "./EditarCirurgiaDialog";

const hojeISO = () => new Date().toISOString().slice(0, 10);

/**
 * O RECURSO DE GLOSA de uma cirurgia — abrir, registrar a resposta da operadora, e o histórico
 * das tentativas anteriores.
 *
 * ⚠️ **Não há campo de valor aqui, e é de propósito.** Quando a operadora acata, o dinheiro entra
 * por um repasse novo e a glosa se recalcula sozinha; um valor digitado aqui seria uma segunda
 * fonte do mesmo número, e as duas divergiriam no primeiro pagamento diferente do que foi
 * respondido. Aqui mora o processo: quando, por onde, com qual protocolo, e o desfecho.
 */
export function RecursoDeGlosaDialog({
  clienteId,
  cirurgia: c,
  onClose,
  onSalvo,
}: {
  clienteId: string;
  cirurgia: CirurgiaConciliada;
  onClose: () => void;
  onSalvo: () => void;
}) {
  const historico = trpc.conciliacao.recursosDaCirurgia.useQuery({ clienteId, cirurgiaId: c.id });
  const utils = trpc.useUtils();

  const recarregar = () => {
    void utils.conciliacao.recursosDaCirurgia.invalidate({ clienteId, cirurgiaId: c.id });
    onSalvo();
  };

  const abrir = trpc.conciliacao.abrirRecurso.useMutation({
    onSuccess: (r) => {
      toast(`Recurso aberto (tentativa ${r.tentativa}).`, "success");
      recarregar();
    },
    onError: (e) => toast(e.message),
  });
  const responder = trpc.conciliacao.responderRecurso.useMutation({
    onSuccess: () => {
      toast("Resposta da operadora registrada.", "success");
      recarregar();
    },
    onError: (e) => toast(e.message),
  });

  const emAberto = historico.data?.find((r) => r.status === "ABERTO") ?? null;

  return (
    <Modal open onClose={onClose} title={`Recurso de glosa — cirurgia ${c.numeroCirurgia}`} size="lg">
      <div className="space-y-4">
        <div className="rounded-lg bg-muted/40 p-3 text-sm">
          <p className="font-medium">{c.pacienteNome}</p>
          <p className="text-muted-foreground">
            {dataUTC(c.dataCirurgia)} · {c.procedimento} · {c.convenioBruto}
          </p>
          <p className="mt-1 font-medium text-destructive">
            Glosa de {formatBRL(c.glosa ?? 0)}
            <span className="font-normal text-muted-foreground">
              {" "}
              · cobrado {formatBRL(c.cobrado)}, recebido {formatBRL(c.recebido)}
            </span>
          </p>
        </div>

        {historico.isPending ? (
          <Skeleton className="h-24 w-full" />
        ) : historico.error ? (
          <QueryError message={historico.error.message} onRetry={() => void historico.refetch()} />
        ) : emAberto ? (
          <FormularioDeResposta
            recurso={emAberto}
            pendente={responder.isPending}
            onResponder={(dados) => responder.mutate({ clienteId, recursoId: emAberto.id, ...dados })}
          />
        ) : (
          <FormularioDeAbertura
            tentativa={(historico.data[0]?.tentativa ?? 0) + 1}
            pendente={abrir.isPending}
            onAbrir={(dados) => abrir.mutate({ clienteId, cirurgiaId: c.id, ...dados })}
          />
        )}

        {historico.data && historico.data.length > 0 && (
          <div>
            <p className="text-xs font-medium uppercase text-muted-foreground">Tentativas</p>
            <ul className="mt-1 space-y-2">
              {historico.data.map((r) => (
                <li key={r.id} className="rounded-lg border p-2 text-sm">
                  <p>
                    <strong>Tentativa {r.tentativa}</strong> · {ROTULO_RECURSO[r.status].rotulo} · aberto em {dataUTC(r.abertoEm)}
                    {r.respondidoEm && ` · respondido em ${dataUTC(r.respondidoEm)}`}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {[r.canal, r.protocolo && `protocolo ${r.protocolo}`, r.criadoPor?.nome && `por ${r.criadoPor.nome}`]
                      .filter(Boolean)
                      .join(" · ") || "sem canal ou protocolo registrado"}
                  </p>
                  {r.motivoDaGlosa && <p className="mt-1 text-xs">Alegação da operadora: {r.motivoDaGlosa}</p>}
                  {r.observacao && <p className="mt-1 text-xs text-muted-foreground">{r.observacao}</p>}
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </Modal>
  );
}

function FormularioDeAbertura({
  tentativa,
  pendente,
  onAbrir,
}: {
  tentativa: number;
  pendente: boolean;
  onAbrir: (d: { abertoEm: string; canal: string | null; protocolo: string | null; motivoDaGlosa: string | null }) => void;
}) {
  const [abertoEm, setAbertoEm] = useState(hojeISO());
  const [canal, setCanal] = useState("");
  const [protocolo, setProtocolo] = useState("");
  const [motivo, setMotivo] = useState("");

  return (
    <div className="space-y-3 rounded-lg border p-3">
      <p className="text-sm font-medium">{tentativa === 1 ? "Abrir recurso" : `Recorrer de novo (tentativa ${tentativa})`}</p>
      {tentativa > 1 && (
        // ⚠️ A tentativa anterior NÃO é apagada: é ela que prova o que a operadora respondeu, e é
        // isso que se leva de volta para a operadora.
        <p className="text-xs text-muted-foreground">A tentativa anterior fica registrada — é a prova do que já foi respondido.</p>
      )}

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div className="space-y-1">
          <Label htmlFor="rg-data">Data do protocolo</Label>
          <Input id="rg-data" type="date" value={abertoEm} max={hojeISO()} onChange={(e) => setAbertoEm(e.target.value)} />
        </div>
        <div className="space-y-1">
          <Label htmlFor="rg-canal">Por onde</Label>
          <Input
            id="rg-canal"
            value={canal}
            maxLength={60}
            onChange={(e) => setCanal(e.target.value)}
            placeholder="Portal da operadora, e-mail…"
          />
        </div>
        <div className="space-y-1">
          <Label htmlFor="rg-protocolo">Protocolo</Label>
          <Input id="rg-protocolo" value={protocolo} maxLength={60} onChange={(e) => setProtocolo(e.target.value)} />
        </div>
      </div>

      <div className="space-y-1">
        <Label htmlFor="rg-motivo">O que a operadora alegou para glosar</Label>
        <Textarea
          id="rg-motivo"
          rows={2}
          maxLength={2000}
          value={motivo}
          onChange={(e) => setMotivo(e.target.value)}
          placeholder="Ex.: OPME não autorizado, guia sem assinatura…"
        />
      </div>

      <Button
        disabled={pendente || !abertoEm}
        onClick={() =>
          onAbrir({
            abertoEm,
            canal: canal.trim() || null,
            protocolo: protocolo.trim() || null,
            motivoDaGlosa: motivo.trim() || null,
          })
        }
      >
        {pendente ? "Abrindo…" : "Registrar recurso"}
      </Button>
    </div>
  );
}

function FormularioDeResposta({
  recurso,
  pendente,
  onResponder,
}: {
  recurso: { tentativa: number; abertoEm: Date | string; protocolo: string | null };
  pendente: boolean;
  onResponder: (d: { status: "ACATADO" | "NEGADO" | "ENCERRADO"; respondidoEm: string; observacao: string | null }) => void;
}) {
  const [status, setStatus] = useState<"ACATADO" | "NEGADO" | "ENCERRADO">("ACATADO");
  const [respondidoEm, setRespondidoEm] = useState(hojeISO());
  const [observacao, setObservacao] = useState("");

  return (
    <div className="space-y-3 rounded-lg border border-warning/40 bg-warning/5 p-3">
      <p className="text-sm font-medium">
        Recurso aberto em {dataUTC(recurso.abertoEm)}
        {recurso.protocolo && ` · protocolo ${recurso.protocolo}`}
      </p>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div className="space-y-1">
          <Label htmlFor="rg-status">O que a operadora respondeu</Label>
          <Select id="rg-status" value={status} onChange={(e) => setStatus(e.target.value as typeof status)}>
            <option value="ACATADO">Acatou — vai pagar</option>
            <option value="NEGADO">Negou</option>
            <option value="ENCERRADO">Encerrado sem resposta dela</option>
          </Select>
        </div>
        <div className="space-y-1">
          <Label htmlFor="rg-resp">Data da resposta</Label>
          <Input id="rg-resp" type="date" value={respondidoEm} max={hojeISO()} onChange={(e) => setRespondidoEm(e.target.value)} />
        </div>
      </div>

      <div className="space-y-1">
        <Label htmlFor="rg-obs">Observação</Label>
        <Textarea id="rg-obs" rows={2} maxLength={2000} value={observacao} onChange={(e) => setObservacao(e.target.value)} />
      </div>

      {/* ⚠️ O dinheiro NÃO entra por aqui, nem quando a operadora acata: ele vem no próximo
          repasse, e é de lá que a glosa se recalcula sozinha. */}
      {status === "ACATADO" && (
        <p className="text-xs text-muted-foreground">
          Acatado não dá o dinheiro por recebido: ele entra quando o pagamento aparecer no próximo repasse importado, e a glosa se recalcula
          sozinha.
        </p>
      )}

      <Button
        disabled={pendente || !respondidoEm}
        onClick={() => onResponder({ status, respondidoEm, observacao: observacao.trim() || null })}
      >
        {pendente ? "Registrando…" : "Registrar resposta"}
      </Button>
    </div>
  );
}
