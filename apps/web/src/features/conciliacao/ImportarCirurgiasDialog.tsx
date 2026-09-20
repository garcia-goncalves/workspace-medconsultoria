import { useState } from "react";
import { FileSpreadsheet } from "lucide-react";
import { trpc } from "../../lib/trpc";
import { Modal } from "../../components/ui/modal";
import { Button } from "../../components/ui/button";
import { Table, THead, TH, TR, TD } from "../../components/ui/table";
import { UploadArquivo, type ArquivoEnviado } from "../../components/ui/upload-arquivo";
import { toast } from "../../components/ui/toast";
import { dataUTC } from "../../lib/format-date";
import { Aviso } from "./partes";

/**
 * Importar o mapa cirúrgico do TASY — **enviar → conferir → gravar**, como as consultas.
 *
 * Sem seletor de competência: o TASY manda um período, e a cirurgia é reconhecida pelo próprio
 * número. Reimportar um período que se sobrepõe atualiza o que já existe em vez de duplicar — a
 * conferência mostra quantas são novas e quantas só serão atualizadas, antes de gravar.
 */
export function ImportarCirurgiasDialog({
  clienteId,
  clienteNome,
  open,
  onClose,
  onImportado,
}: {
  clienteId: string;
  /** Mostrado em destaque: importar o mapa de um médico na ficha de outra clínica não tem desfazer. */
  clienteNome: string;
  open: boolean;
  onClose: () => void;
  onImportado: () => void;
}) {
  const [arquivo, setArquivo] = useState<ArquivoEnviado | null>(null);

  const previa = trpc.conciliacao.previsualizarCirurgias.useMutation({ onError: (e) => toast(e.message) });
  const importar = trpc.conciliacao.importarCirurgias.useMutation({
    onSuccess: (r) => {
      const extras = [
        r.atualizadas > 0 ? `${r.atualizadas} atualizada(s)` : null,
        r.mantidas > 0 ? `${r.mantidas} mantida(s) por virem de arquivo mais recente` : null,
        r.semAtendimento > 0 ? `${r.semAtendimento} sem número de atendimento` : null,
        r.linhasIgnoradas > 0 ? `${r.linhasIgnoradas} linha(s) ignorada(s)` : null,
      ].filter(Boolean);
      toast(`${r.novas} cirurgia(s) nova(s) importada(s)` + (extras.length ? ` — ${extras.join(", ")}.` : "."), "success");
      fechar();
      onImportado();
    },
    onError: (e) => toast(e.message),
  });

  function fechar() {
    setArquivo(null);
    previa.reset();
    importar.reset();
    onClose();
  }

  function aoEnviar(enviado: ArquivoEnviado) {
    setArquivo(enviado);
    previa.mutate({ clienteId, arquivoId: enviado.id });
  }

  const p = previa.data;
  const podeImportar = !!arquivo && !!p && p.totalLinhas > 0 && !p.jaImportado;

  return (
    <Modal
      open={open}
      onClose={fechar}
      title="Importar cirurgias (TASY)"
      size="xl"
      footer={
        <div className="flex items-center justify-end gap-2">
          <Button variant="ghost" onClick={fechar}>
            Cancelar
          </Button>
          <Button
            disabled={!podeImportar || importar.isPending}
            onClick={() => arquivo && importar.mutate({ clienteId, arquivoId: arquivo.id })}
          >
            {importar.isPending ? "Importando…" : "Importar"}
          </Button>
        </div>
      }
    >
      <div className="space-y-4">
        <p className="text-sm">
          Cliente: <strong>{clienteNome || "—"}</strong>
        </p>
        <div className="rounded-lg border border-dashed p-4">
          <div className="flex items-center justify-between gap-3">
            <div className="flex min-w-0 items-center gap-2 text-sm">
              <FileSpreadsheet className="h-4 w-4 shrink-0 text-muted-foreground" />
              {arquivo ? (
                <span className="truncate font-medium">{arquivo.nome}</span>
              ) : (
                <span className="text-muted-foreground">Envie o mapa cirúrgico exportado do TASY (CSV ou XLSX).</span>
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
            {p.jaImportado && <Aviso tom="erro">Este arquivo já foi importado em {dataUTC(p.jaImportado.em)}. Nada mudaria.</Aviso>}

            <p className="text-sm">
              <strong>{p.totalLinhas}</strong> cirurgia(s)
              {p.periodo && (
                <>
                  {" "}
                  de <strong>{dataUTC(p.periodo.inicio)}</strong> a <strong>{dataUTC(p.periodo.fim)}</strong>
                </>
              )}{" "}
              · <strong>{p.novas}</strong> nova(s) · <strong>{p.jaExistentes}</strong> já no sistema (serão atualizadas) · formato{" "}
              {p.formato}
            </p>

            {/* Sem o número do atendimento, a cirurgia não casa com o repasse — importa, mas a
                pessoa precisa saber quantas ficam de fora da conciliação. */}
            {p.semAtendimento > 0 && (
              <Aviso tom="atencao">
                {p.semAtendimento} cirurgia(s) sem número de atendimento. Elas entram, mas não vão casar com o relatório de repasse enquanto
                o TASY não trouxer o número.
              </Aviso>
            )}
            {p.mantidas > 0 && (
              <Aviso tom="atencao">
                {p.mantidas} cirurgia(s) já vieram de um arquivo mais recente e ficam como estão — este arquivo é mais antigo e só
                acrescenta o que falta.
              </Aviso>
            )}
            {p.naoExecutadas > 0 && (
              <Aviso tom="atencao">
                {p.naoExecutadas} cirurgia(s) não executada(s) (ex.: reservada). Aparecem na lista, fora dos totais.
              </Aviso>
            )}
            {p.colunasAusentes.length > 0 && <Aviso tom="atencao">Colunas que o arquivo não trouxe: {p.colunasAusentes.join(", ")}.</Aviso>}
            {p.ignoradas.length > 0 && (
              <Aviso tom="erro">
                {p.ignoradas.length} linha(s) não serão importadas:
                <ul tabIndex={0} className="mt-1 max-h-24 list-disc overflow-y-auto pl-5">
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
                {p.profissionaisNovos.length > 0 && <> {p.profissionaisNovos.length} profissional(is)</>}.
              </Aviso>
            )}

            <div>
              <p className="mb-1.5 text-sm font-medium">Primeiras linhas, como o sistema entendeu</p>
              <div className="max-h-64 overflow-auto rounded-lg border">
                <Table rotulo="Prévia das cirurgias lidas">
                  <THead>
                    <TR>
                      <TH>Data</TH>
                      <TH>Cirurgia</TH>
                      <TH>Atendimento</TH>
                      <TH>Paciente</TH>
                      <TH>Procedimento</TH>
                      <TH>Convênio</TH>
                      <TH>Médico</TH>
                    </TR>
                  </THead>
                  <tbody>
                    {p.amostra.map((l) => (
                      <TR key={l.linha}>
                        <TD>{dataUTC(l.dataCirurgia)}</TD>
                        <TD className="text-muted-foreground">{l.numeroCirurgia}</TD>
                        <TD>{l.atendimento ?? <span className="text-warning">—</span>}</TD>
                        <TD>{l.pacienteNome}</TD>
                        <TD>{l.procedimento}</TD>
                        <TD>{l.convenioBruto}</TD>
                        <TD>{l.profissionalBruto}</TD>
                      </TR>
                    ))}
                  </tbody>
                </Table>
              </div>
              <p className="mt-1.5 text-xs text-muted-foreground">
                Prontuário, código da pessoa e leito não entram na produção. O arquivo original — com esses campos — fica guardado no acervo
                do cliente.
              </p>
            </div>
          </>
        )}
      </div>
    </Modal>
  );
}
