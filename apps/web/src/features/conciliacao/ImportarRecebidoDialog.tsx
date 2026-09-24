import { useState } from "react";
import { FileSpreadsheet } from "lucide-react";
import { trpc } from "../../lib/trpc";
import { Modal } from "../../components/ui/modal";
import { Button } from "../../components/ui/button";
import { UploadArquivo, type ArquivoEnviado } from "../../components/ui/upload-arquivo";
import { toast } from "../../components/ui/toast";
import { formatBRL } from "../../lib/masks";
import { data as dataBrasilia, dataUTC } from "../../lib/format-date";
import { Aviso } from "./partes";

/**
 * Os dois caminhos do RECEBIDO, com o mesmo fluxo de sempre: enviar → conferir → gravar.
 *
 * - `repasse`: o "Repasses para Terceiros (Pagamentos Realizados)" do TASY, exportado em planilha.
 *   Casa pelo número do atendimento.
 * - `planilha`: a planilha de conciliação que o sistema exporta, preenchida fora e devolvida.
 *   Casa pelo Nº Cirurgia; célula vazia não apaga o que já está gravado.
 */
export function ImportarRecebidoDialog({
  tipo,
  clienteId,
  clienteNome,
  onClose,
  onImportado,
}: {
  tipo: "repasse" | "planilha";
  clienteId: string;
  clienteNome: string;
  onClose: () => void;
  onImportado: () => void;
}) {
  const [arquivo, setArquivo] = useState<ArquivoEnviado | null>(null);
  const titulo = tipo === "repasse" ? "Importar repasse (TASY)" : "Importar planilha de conciliação preenchida";

  // ⚠️ Sem toast nas duas prévias, de propósito: um arquivo do relatório errado (ex.: a
  // planilha modelo no importador de repasse) é recusado com a dica de para onde levar o
  // arquivo — e um toast some sozinho em ~5s, deixando o modal vazio sem explicação nenhuma. O
  // erro fica visível e FIXO no corpo do modal (`erroDaPrevia` abaixo), até a pessoa trocar de
  // arquivo ou fechar.
  // ⚠️ O `onError` vazio NÃO é descuido: sem ele, a rede de segurança global de mutações
  // (`main.tsx`) acende um toast com a MESMA frase que o aviso fixo do modal já mostra.
  const previaRepasse = trpc.conciliacao.previsualizarRepasse.useMutation({ onError: () => {} });
  const previaPlanilha = trpc.conciliacao.previsualizarPlanilha.useMutation({ onError: () => {} });
  const importarRepasse = trpc.conciliacao.importarRepasse.useMutation({
    onSuccess: (r) => {
      toast(
        `${r.linhas} linha(s) de repasse importada(s) — ${formatBRL(r.total)}` +
          (r.semProducao.linhas > 0 ? `, das quais ${formatBRL(r.semProducao.total)} sem cirurgia correspondente.` : "."),
        "success",
      );
      onImportado();
      onClose();
    },
    onError: (e) => toast(e.message),
  });
  const importarPlanilha = trpc.conciliacao.importarPlanilha.useMutation({
    onSuccess: (r) => {
      toast(
        `${r.atualizadas} cirurgia(s) atualizada(s)` +
          (r.desconhecidas > 0 ? `; ${r.desconhecidas} não encontrada(s) neste cliente.` : "."),
        "success",
      );
      onImportado();
      onClose();
    },
    onError: (e) => toast(e.message),
  });

  function aoEnviar(a: ArquivoEnviado) {
    setArquivo(a);
    if (tipo === "repasse") previaRepasse.mutate({ clienteId, arquivoId: a.id });
    else previaPlanilha.mutate({ clienteId, arquivoId: a.id });
  }

  const pr = previaRepasse.data;
  const pp = previaPlanilha.data;
  // A substituição do período só é oferecida quando o servidor recusou por conflito — a pessoa lê
  // o que vai trocar antes de confirmar.
  const conflito = importarRepasse.error?.data?.code === "CONFLICT" ? importarRepasse.error.message : null;
  const erroDaPrevia = (tipo === "repasse" ? previaRepasse.error : previaPlanilha.error)?.message ?? null;
  const lendo = previaRepasse.isPending || previaPlanilha.isPending;
  const gravando = importarRepasse.isPending || importarPlanilha.isPending;
  const pode = !!arquivo && (tipo === "repasse" ? !!pr && pr.linhas > 0 && !pr.jaImportado : !!pp && pp.aplicaveis > 0);

  function gravar(substituir?: boolean) {
    if (!arquivo) return;
    if (tipo === "repasse") importarRepasse.mutate({ clienteId, arquivoId: arquivo.id, substituir });
    else importarPlanilha.mutate({ clienteId, arquivoId: arquivo.id });
  }

  return (
    <Modal
      open
      onClose={onClose}
      title={titulo}
      size="lg"
      footer={
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>
            Cancelar
          </Button>
          {/* Só quando o conflito é de PERÍODO — arquivo repetido não se "substitui". */}
          {conflito && /substitui/i.test(conflito) && (
            <Button variant="destructive" disabled={gravando} onClick={() => gravar(true)}>
              Substituir o período
            </Button>
          )}
          <Button disabled={!pode || gravando || !!conflito} onClick={() => gravar()}>
            {gravando ? "Importando…" : "Importar"}
          </Button>
        </div>
      }
    >
      <div className="space-y-3">
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
                <span className="text-muted-foreground">
                  {tipo === "repasse"
                    ? "Envie o relatório de repasse exportado do TASY (CSV ou XLSX)."
                    : "Envie a planilha de conciliação exportada daqui, já preenchida."}
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

        {lendo && <p className="text-sm text-muted-foreground">Lendo o arquivo…</p>}
        {erroDaPrevia && <Aviso tom="erro">{erroDaPrevia}</Aviso>}

        {tipo === "repasse" && pr && (
          <>
            {pr.jaImportado && <Aviso tom="erro">Este repasse já foi importado em {dataBrasilia(pr.jaImportado.em)}. Nada mudaria.</Aviso>}
            <p className="text-sm">
              <strong>{pr.linhas}</strong> linha(s) · <strong>{formatBRL(pr.total)}</strong>
              {pr.periodoPagamento && (
                <>
                  {" "}
                  · pagamentos de {dataUTC(pr.periodoPagamento.inicio)} a {dataUTC(pr.periodoPagamento.fim)}
                </>
              )}
            </p>
            <ul className="space-y-1 text-sm">
              <li>
                Casam com cirurgias: <strong>{pr.casadas.linhas}</strong> linha(s), {formatBRL(pr.casadas.total)}
              </li>
              <li className={pr.semProducao.linhas > 0 ? "text-warning" : "text-muted-foreground"}>
                Sem cirurgia correspondente (incremento, acordo, atendimento fora do mapa): <strong>{pr.semProducao.linhas}</strong>{" "}
                linha(s), {formatBRL(pr.semProducao.total)} — entram e aparecem à parte.
              </li>
            </ul>
            {pr.jaNoPeriodo > 0 && !conflito && (
              <Aviso tom="atencao">
                Já há {pr.jaNoPeriodo} linha(s) de repasse pagas neste período. Importar vai pedir confirmação para substituí-las — o mesmo
                pagamento nunca conta duas vezes.
              </Aviso>
            )}
            {pr.colunasAusentes.length > 0 && (
              <Aviso tom="atencao">Colunas que o arquivo não trouxe: {pr.colunasAusentes.join(", ")}.</Aviso>
            )}
            <p className="text-xs text-muted-foreground">Valores brutos do repasse, antes do imposto retido.</p>
          </>
        )}

        {tipo === "planilha" && pp && (
          <>
            <p className="text-sm">
              <strong>{pp.aplicaveis}</strong> cirurgia(s) com algo preenchido · {pp.comCobrado} com cobrado · {pp.comRecebido} com recebido
              · {pp.semAlteracao} sem nada preenchido
            </p>
            {pp.desconhecidas.length > 0 && (
              <Aviso tom="atencao">
                {pp.desconhecidas.length} número(s) de cirurgia não existem neste cliente e ficam de fora
                {pp.desconhecidas.length <= 5 && `: ${pp.desconhecidas.join(", ")}`}. Confira se a planilha é deste cliente.
              </Aviso>
            )}
            <p className="text-xs text-muted-foreground">
              Só o que está preenchido é gravado — célula vazia não apaga o que já existe. O valor digitado passa a mandar sobre o do
              repasse.
            </p>
          </>
        )}

        {((pr && pr.ignoradas.length > 0) || (pp && pp.ignoradas.length > 0)) && (
          <Aviso tom="erro">
            Linhas que não serão importadas:
            <ul tabIndex={0} className="mt-1 max-h-24 list-disc overflow-y-auto pl-5">
              {(pr?.ignoradas ?? pp?.ignoradas ?? []).slice(0, 20).map((i) => (
                <li key={i.linha}>
                  Linha {i.linha}: {i.motivo}
                </li>
              ))}
            </ul>
          </Aviso>
        )}
        {conflito && <Aviso tom="erro">{conflito}</Aviso>}
      </div>
    </Modal>
  );
}
