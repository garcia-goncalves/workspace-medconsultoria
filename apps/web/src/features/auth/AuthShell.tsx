import { type ReactNode } from "react";

/**
 * Moldura das telas de autenticação (login, definir senha) e da captação pública.
 * O painel de marca aceita textos próprios: as telas da EQUIPE usam o discurso do produto
 * (padrão abaixo); a captação de LEADS passa um texto voltado ao cliente e esconde o
 * rótulo interno "Workspace" — para não expor o nome do painel administrativo a quem chega de fora.
 */
export function AuthShell({
  children,
  eyebrow = "Workspace",
  titulo,
  descricao,
}: {
  children: ReactNode;
  eyebrow?: string | null;
  titulo?: ReactNode;
  descricao?: ReactNode;
}) {
  const tituloPainel = titulo ?? (
    <>
      A operação da MedConsultoria,
      <br />
      organizada em um só ambiente.
    </>
  );
  const descricaoPainel =
    descricao ??
    "Clientes, projetos, agenda, finanças e documentos reunidos com segurança — para uma gestão mais clara e produtiva.";
  return (
    <div className="flex min-h-screen bg-background">
      {/* Painel da marca (desktop) */}
      <aside className="relative hidden w-1/2 flex-col justify-between overflow-hidden bg-gradient-to-br from-brand-blueDark via-[#012a6b] to-brand-blueText p-12 text-white lg:flex xl:p-16">
        <div className="pointer-events-none absolute -left-24 -top-24 h-96 w-96 rounded-full bg-brand-blueLight/20 blur-3xl" />
        <div className="pointer-events-none absolute -bottom-32 -right-16 h-[28rem] w-[28rem] rounded-full bg-brand-green/15 blur-3xl" />
        <div className="pointer-events-none absolute right-16 top-1/3 h-64 w-64 rounded-full bg-white/5 blur-3xl" />

        <div className="relative flex items-center gap-3">
          <img src="/simbolo.png" alt="" className="h-11 w-11" />
          <div className="leading-tight">
            {eyebrow && <div className="text-[11px] font-medium uppercase tracking-[0.22em] text-white/60">{eyebrow}</div>}
            <div className="text-lg font-semibold">MedConsultoria</div>
          </div>
        </div>

        <div className="relative max-w-md">
          <h1 className="text-3xl font-semibold leading-tight xl:text-4xl">{tituloPainel}</h1>
          <p className="mt-4 text-base leading-relaxed text-white/70">{descricaoPainel}</p>
        </div>

        <div className="relative text-sm text-white/45">
          © {new Date().getFullYear()} MedConsultoria. Todos os direitos reservados.
        </div>
      </aside>

      {/* Área central (formulário/conteúdo) */}
      <main className="flex w-full items-center justify-center px-6 py-10 sm:px-10 lg:w-1/2">
        <div className="w-full max-w-sm animate-fade-in">
          <div className="mb-8 flex justify-center lg:hidden">
            <img src="/logo.png" alt="MedConsultoria" className="h-16 w-auto" />
          </div>
          {children}
        </div>
      </main>
    </div>
  );
}
