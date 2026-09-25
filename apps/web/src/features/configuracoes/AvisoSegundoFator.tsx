import { Link } from "@tanstack/react-router";
import { ShieldAlert, ArrowRight } from "lucide-react";
import { segundoFatorRecomendadoPara } from "@app/shared";
import { trpc } from "../../lib/trpc";
import { useAuth } from "../../lib/auth-context";

/**
 * AVISO PERSISTENTE no Início para ADMIN/ROOT sem verificação em duas etapas (onda 4C).
 *
 * Persistente de propósito — sem "dispensar": é o convite enquanto o 2FA for opcional
 * (`SEGUNDO_FATOR_OBRIGATORIO`, em `@app/shared`). Some sozinho quando a pessoa ativa.
 *
 * Com o servidor sem a `TOTP_CRYPTO_KEY`, ADMIN não tem o que fazer com o aviso (não consegue
 * ativar), então ele só aparece para ROOT — que é quem pode pedir a chave a quem hospeda.
 */
export function AvisoSegundoFator() {
  const { user } = useAuth();
  const convidado = segundoFatorRecomendadoPara(user.role);
  const q = trpc.auth.segundoFator.status.useQuery(undefined, { enabled: convidado, staleTime: 60_000 });
  const s = q.data;
  if (!convidado || !s || s.ativo) return null;
  if (!s.disponivel && user.role !== "ROOT") return null;

  return (
    <Link
      to="/configuracoes"
      className="flex items-center gap-3 rounded-xl border border-warning/40 bg-warning/5 px-4 py-3 transition-colors hover:border-warning/60"
    >
      <ShieldAlert className="h-5 w-5 shrink-0 text-warning" />
      <div className="min-w-0 flex-1 text-sm">
        <span className="font-medium">Ative a verificação em duas etapas.</span>{" "}
        <span className="text-muted-foreground">
          {s.disponivel
            ? "Sua conta pode mexer em dinheiro e em acessos: com ela, uma senha vazada não basta para entrar."
            : "Ainda não está configurada neste servidor — falta definir a TOTP_CRYPTO_KEY."}
        </span>
      </div>
      <ArrowRight className="h-4 w-4 shrink-0 text-muted-foreground" />
    </Link>
  );
}
