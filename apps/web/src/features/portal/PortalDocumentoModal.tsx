import { FileDown, FileText, Loader2 } from "lucide-react";
import { trpc } from "../../lib/trpc";
import { Button } from "../../components/ui/button";
import { Modal } from "../../components/ui/modal";
import {
  DocumentoBranded,
  imprimirDocumento,
  baixarWordDocumento,
  type DocumentoBrandedProps,
} from "../documentos/DocumentoBranded";

/**
 * Abre um documento da MedConsultoria (proposta, contrato, ata…) dentro do `Modal` padrão —
 * antes era um overlay próprio, sem prender o foco do teclado (achado da revisão de
 * responsividade). O `Modal` já traz Esc, clique fora, foco preso e devolução de foco.
 */
export function PortalDocumentoModal({ id, onClose }: { id: string; onClose: () => void }) {
  const doc = trpc.portal.documento.useQuery({ id });
  const carregando = doc.isLoading || !doc.data;
  const props: DocumentoBrandedProps | null = doc.data
    ? { titulo: doc.data.titulo, conteudoMarkdown: doc.data.conteudo }
    : null;

  return (
    <Modal
      open
      onClose={onClose}
      title={doc.data?.titulo ?? "Documento"}
      size="xl"
      footer={
        props && (
          <>
            <Button size="sm" className="min-h-11" variant="outline" onClick={() => imprimirDocumento(props)}>
              <FileDown className="h-4 w-4" />
              PDF
            </Button>
            <Button size="sm" className="min-h-11" variant="outline" onClick={() => baixarWordDocumento(props)}>
              <FileText className="h-4 w-4" />
              Word
            </Button>
          </>
        )
      }
    >
      {carregando ? (
        <div className="flex h-48 items-center justify-center">
          <Loader2 className="h-6 w-6 animate-spin text-primary" />
        </div>
      ) : (
        <div className="bg-muted/30 p-2 sm:p-4">
          <DocumentoBranded {...props!} />
        </div>
      )}
    </Modal>
  );
}
