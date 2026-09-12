import type { ReactNode } from "react";
import { useState } from "react";
import { AlertTriangle, CheckCircle2, FileSpreadsheet } from "lucide-react";
import { trpc } from "../../lib/trpc";
import { Modal } from "../../components/ui/modal";
import { Button } from "../../components/ui/button";
import { Label } from "../../components/ui/label";
import { Select } from "../../components/ui/select";
import { Table, THead, TH, TR, TD } from "../../components/ui/table";
import { UploadArquivo, type ArquivoEnviado } from "../../components/ui/upload-arquivo";
import { toast } from "../../components/ui/toast";
import { dataUTC } from "../../lib/format-date";

/**
 * Importar o relatório de produção — em três passos, nesta ordem: **enviar → conferir → gravar**.
 *
 * A conferência no meio não é enfeite. O arquivo vem de outro sistema, muda de formato sem aviso,
 * e uma coluna deslocada entra como número certo e errado ao mesmo tempo. Aqui a pessoa vê o que
 * foi entendido — competência, linhas, o que será ignorado e o que falta ligar — **antes** de
 * qualquer coisa tocar o banco.
 */

const TIPO_LABEL: Record<string, string> = {
  CONSULTA: "Consulta",
  CORTESIA: "Cortesia",
  SEM_VINCULO_AGENDA: "Sem vínculo",
  OUTRO: "Outro",
};

export function ImportarProducaoDialog({
  clienteId,
  open,
  onClose,
  onImportado,
}: {
  clienteId: string;
  open: boolean;
  onClose: () => void;
  onImportado: () => void;
}) {
  const [arquivo, setArquivo] = useState<ArquivoEnviado | null>(null);
  const [competencia, setCompetencia] = useState("");

  const previa = trpc.conciliacao.previsualizar.useMutation({
    onSuccess: (p) => setCompetencia(p.competenciaSugerida ?? ""),
    onError: (e) => toast(e.message),
  });

  const importar = trpc.conciliacao.importar.useMutation({
    onSuccess: (r) => {
      const extras = [
        r.profissionaisLigadosAutomaticamente > 0
          ? `${r.profissionaisLigadosAutomaticamente} profissional(is) ligado(s) automaticamente`
          : null,
        r.linhasIgnoradas > 0 ? `${r.linhasIgnoradas} linha(s) ignorada(s)` : null,
      ].filter(Boolean);
      toast(
        `${r.linhasImportadas} atendimento(s) de ${r.competencia} importado(s)` + (extras.length ? ` — ${extras.join(", ")}.` : "."),
        "success",
      );
      fechar();
      onImportado();
    },
    onError: (e) => toast(e.message),
  });

  function fechar() {
    setArquivo(null);
    setCompetencia("");
    previa.reset();
    importar.reset();
    onClose();
  }

  function aoEnviar(enviado: ArquivoEnviado) {
    setArquivo(enviado);
    previa.mutate({ clienteId, arquivoId: enviado.id });
  }

  const p = previa.data;
  const podeImportar = !!arquivo && !!p && !!competencia && p.totalLinhas > 0;

  // A substituição só é oferecida DEPOIS de o servidor recusar por conflito — a pessoa lê o que
  // vai perder antes de confirmar, em vez de encontrar um interruptor "substituir" já ligado numa
  // tela onde ela nem sabia que aquele mês existia.
  const conflito = importar.error?.data?.code === "CONFLICT" ? importar.error.message : null;
  const jaImportado = p?.jaImportado ?? null;

  return (
    <Modal
      open={open}
      onClose={fechar}
      title="Importar produção de consultas"
      size="xl"
      footer={
        <div className="flex items-center justify-end gap-2">
          <Button variant="ghost" onClick={fechar}>
            Cancelar
          </Button>
          {conflito && (
            <Button
              variant="destructive"
              disabled={importar.isPending}
              onClick={() => arquivo && importar.mutate({ clienteId, competencia, arquivoId: arquivo.id, substituir: true })}
            >
              Substituir mesmo assim
            </Button>
          )}
          <Button
            disabled={!podeImportar || importar.isPending || !!conflito}
            onClick={() => arquivo && importar.mutate({ clienteId, competencia, arquivoId: arquivo.id })}
          >
            {importar.isPending ? "Importando…" : "Importar"}
          </Button>
        </div>
      }
    >
      <div className="space-y-4">
        <div className="rounded-lg border border-dashed p-4">
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-2 text-sm">
              <FileSpreadsheet className="h-4 w-4 shrink-0 text-muted-foreground" />
              {arquivo ? (
                <span className="font-medium">{arquivo.nome}</span>
              ) : (
                <span className="text-muted-foreground">
                  Envie a planilha do relatório — aceita CSV, XLSX e o &quot;.xls&quot; que os sistemas exportam.
                </span>
              )}
            </div>
            <UploadArquivo
              campos={{ clienteId }}
              onDone={aoEnviar}
              label={arquivo ? "Trocar arquivo" : "Escolher arquivo"}
              aceitos=".csv,.xls,.xlsx"
            />
          </div>
        </div>

        {previa.isPending && <p className="text-sm text-muted-foreground">Lendo o arquivo…</p>}

        {p && (
          <>
            {jaImportado && (
              <Aviso tom="atencao">
                Este arquivo já foi importado em {dataUTC(jaImportado.em)} (competência {jaImportado.competencia}). Importar de novo será
                recusado.
              </Aviso>
            )}

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div className="space-y-1">
                <Label htmlFor="competencia">Competência *</Label>
                <Select id="competencia" value={competencia} onChange={(e) => setCompetencia(e.target.value)}>
                  <option value="">Selecione…</option>
                  {p.porCompetencia.map((c) => (
                    <option key={c.competencia} value={c.competencia}>
                      {c.competencia} — {c.linhas} atendimento(s)
                    </option>
                  ))}
                </Select>
              </div>
              <div className="space-y-1">
                <Label>O que foi lido</Label>
                <p className="pt-1.5 text-sm">
                  <strong>{p.totalLinhas}</strong> atendimento(s) · formato <strong>{p.formato}</strong> · cabeçalho na linha{" "}
                  {p.cabecalhoNaLinha}
                </p>
              </div>
            </div>

            {/* Mais de uma competência é sinal, não erro: mostra que o relatório tem atendimento
                pingando de outro mês, e só o mês escolhido vai entrar. */}
            {p.porCompetencia.length > 1 && (
              <Aviso tom="atencao">
                Este arquivo tem atendimentos de {p.porCompetencia.length} meses diferentes. Só os da competência escolhida serão
                importados; os outros ficam de fora e aparecem no resultado.
              </Aviso>
            )}

            {p.colunasAusentes.length > 0 && <Aviso tom="atencao">Colunas que o arquivo não trouxe: {p.colunasAusentes.join(", ")}.</Aviso>}

            {p.ignoradas.length > 0 && (
              <Aviso tom="erro">
                {p.ignoradas.length} linha(s) não serão importadas:
                <ul className="mt-1 max-h-24 list-disc overflow-y-auto pl-5">
                  {p.ignoradas.slice(0, 20).map((i) => (
                    <li key={i.linha}>
                      Linha {i.linha}: {i.motivo}
                    </li>
                  ))}
                </ul>
              </Aviso>
            )}

            {(p.conveniosNovos.length > 0 || p.profissionaisNovos.length > 0) && (
              <Aviso tom="atencao">
                Depois de importar, ligue o que é novo em <strong>Pendências</strong>:
                {p.conveniosNovos.length > 0 && <> {p.conveniosNovos.length} convênio(s)</>}
                {p.conveniosNovos.length > 0 && p.profissionaisNovos.length > 0 && " e"}
                {p.profissionaisNovos.length > 0 && <> {p.profissionaisNovos.length} profissional(is)</>}. Sem isso, o resumo por operadora
                fica incompleto.
              </Aviso>
            )}

            {conflito && <Aviso tom="erro">{conflito}</Aviso>}

            <div>
              <p className="mb-1.5 text-sm font-medium">Primeiras linhas, como o sistema entendeu</p>
              <div className="max-h-64 overflow-auto rounded-lg border">
                <Table>
                  <THead>
                    <TR>
                      <TH>Linha</TH>
                      <TH>Atendimento</TH>
                      <TH>Paciente</TH>
                      <TH>Tipo</TH>
                      <TH>Convênio</TH>
                      <TH>Profissional</TH>
                    </TR>
                  </THead>
                  <tbody>
                    {p.amostra.map((l) => (
                      <TR key={l.linha}>
                        <TD className="text-muted-foreground">{l.linha}</TD>
                        <TD>{dataUTC(l.dataAtendimento)}</TD>
                        <TD>{l.pacienteNome}</TD>
                        <TD>{TIPO_LABEL[l.tipoAtendimento] ?? l.tipoAtendimentoBruto}</TD>
                        <TD>{l.convenioBruto}</TD>
                        <TD>{l.profissionalBruto}</TD>
                      </TR>
                    ))}
                  </tbody>
                </Table>
              </div>
              {/* CPF, telefone e e-mail entram no banco cifrados e NÃO são exibidos (spec §5). */}
              <p className="mt-1.5 text-xs text-muted-foreground">
                CPF, telefone e e-mail do paciente são guardados cifrados e não aparecem em nenhuma tela.
              </p>
            </div>
          </>
        )}
      </div>
    </Modal>
  );
}

function Aviso({ tom, children }: { tom: "atencao" | "erro"; children: ReactNode }) {
  const cor = tom === "erro" ? "border-destructive/30 bg-destructive/5" : "border-warning/30 bg-warning/5";
  const Icone = tom === "erro" ? AlertTriangle : CheckCircle2;
  const corIcone = tom === "erro" ? "text-destructive" : "text-warning";
  return (
    <div className={`flex gap-2 rounded-lg border p-3 text-sm ${cor}`}>
      <Icone className={`mt-0.5 h-4 w-4 shrink-0 ${corIcone}`} />
      <div>{children}</div>
    </div>
  );
}
