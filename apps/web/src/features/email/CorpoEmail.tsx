import { useState } from "react";
import { Button } from "../../components/ui/button";

/**
 * Camadas 2 e 3 da defesa contra HTML hostil (a 1 é a higienização no servidor):
 *  - `sandbox` SEM `allow-scripts` e SEM `allow-same-origin` → mesmo que algo escape da camada 1,
 *    não alcança a sessão da aplicação.
 *  - imagem remota fica bloqueada até a pessoa pedir (o pixel invisível é como quem manda spam
 *    confirma que o endereço existe e foi lido).
 *
 * O corpo vem de uma ROTA (`/email-corpo/:id`), não de `srcdoc`: documento `srcdoc` herda a CSP
 * da página que o embute, e a CSP da app (`img-src 'self' data: blob:`) bloquearia a imagem
 * remota mesmo depois do clique em "Mostrar imagens" — o botão seria uma promessa não cumprida
 * em produção. Pela rota, o documento tem CSP própria: `default-src 'none'`, e `https:` em
 * `img-src` só quando as imagens foram pedidas.
 *
 * NUNCA usar `dangerouslySetInnerHTML` aqui.
 */
export function CorpoEmail({
  mensagemId,
  temHtml,
  texto,
  imagensBloqueadas,
}: {
  mensagemId: string;
  temHtml: boolean;
  texto: string | null;
  imagensBloqueadas: number;
}) {
  const [mostrarImagens, setMostrarImagens] = useState(false);

  // Sem corpo HTML não vale abrir iframe nenhum — texto puro é mais legível e mais seguro.
  if (!temHtml) {
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
        // A `key` força recarregar quando as imagens são liberadas: é outra URL, outra CSP.
        key={mostrarImagens ? "com-imagens" : "sem-imagens"}
        title="Conteúdo do e-mail"
        sandbox=""
        src={`/email-corpo/${mensagemId}${mostrarImagens ? "?imagens=1" : ""}`}
        className="min-h-0 w-full flex-1 border-0 bg-white"
      />
    </div>
  );
}
