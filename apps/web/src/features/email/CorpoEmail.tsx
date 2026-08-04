import { useMemo, useState } from "react";
import { Button } from "../../components/ui/button";

/**
 * Camadas 2 e 3 da defesa contra HTML hostil (a 1 é a higienização no servidor):
 *  - `sandbox` SEM `allow-scripts` e SEM `allow-same-origin` → mesmo que algo escape da camada 1,
 *    não alcança a sessão da aplicação.
 *  - imagem remota fica bloqueada até a pessoa pedir (o pixel invisível é como quem manda spam
 *    confirma que o endereço existe e foi lido).
 * NUNCA usar `dangerouslySetInnerHTML` aqui.
 */
export function CorpoEmail({
  html,
  texto,
  imagensBloqueadas,
}: {
  html: string | null;
  texto: string | null;
  imagensBloqueadas: number;
}) {
  const [mostrarImagens, setMostrarImagens] = useState(false);

  const documento = useMemo(() => {
    if (!html) return null;
    const corpo = mostrarImagens ? html.replace(/data-src-bloqueada=/g, "src=") : html;
    return `<!doctype html><meta charset="utf-8"><base target="_blank">
<style>body{margin:0;padding:12px;font:14px/1.5 Montserrat,system-ui,sans-serif;color:#111;word-break:break-word}img{max-width:100%;height:auto}table{max-width:100%}</style>
${corpo}`;
  }, [html, mostrarImagens]);

  if (!documento) {
    return <pre className="whitespace-pre-wrap p-3 text-sm">{texto ?? "(sem conteúdo)"}</pre>;
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {imagensBloqueadas > 0 && !mostrarImagens && (
        <div className="flex items-center justify-between gap-3 border-b bg-amber-50 px-3 py-2 text-xs text-amber-900">
          <span>
            {imagensBloqueadas === 1 ? "1 imagem foi bloqueada" : `${imagensBloqueadas} imagens foram bloqueadas`} para
            que o remetente não saiba que você abriu.
          </span>
          <Button type="button" size="sm" variant="outline" onClick={() => setMostrarImagens(true)}>
            Mostrar imagens
          </Button>
        </div>
      )}
      <iframe
        title="Conteúdo do e-mail"
        sandbox=""
        srcDoc={documento}
        className="min-h-0 w-full flex-1 border-0 bg-white"
      />
    </div>
  );
}
