import { useMemo, useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Loader2, User, Mail, Phone, Building2, MessageSquare, ArrowRight, AlertCircle, CheckCircle2 } from "lucide-react";
import { capturaLeadSchema, type CapturaLeadInput } from "@app/shared";
import { trpc } from "../../lib/trpc";
import { Button } from "../../components/ui/button";
import { Input } from "../../components/ui/input";
import { MaskedInput } from "../../components/ui/masked-input";
import { maskTelefone } from "../../lib/masks";
import { Label } from "../../components/ui/label";
import { Textarea } from "../../components/ui/textarea";
import { AuthShell } from "../auth/AuthShell";
import { ServicosPicker } from "../crm/leads/ServicosPicker";

export function CapturaLeadPage() {
  const capturar = trpc.leads.capturar.useMutation();
  const servicos = trpc.servicos.publicos.useQuery();
  const [selecionados, setSelecionados] = useState<string[]>([]);
  // Rastreamento de atribuição: captura de onde o visitante veio (UTM + referência).
  const rastreio = useMemo(() => {
    const p = new URLSearchParams(window.location.search);
    const g = (k: string) => p.get(k) || undefined;
    return {
      utmSource: g("utm_source"),
      utmMedium: g("utm_medium"),
      utmCampaign: g("utm_campaign"),
      utmTerm: g("utm_term"),
      utmContent: g("utm_content"),
      gclid: g("gclid"),
      fbclid: g("fbclid"),
      referrer: document.referrer || undefined,
      landing: window.location.href.slice(0, 500),
    };
  }, []);
  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<CapturaLeadInput>({ resolver: zodResolver(capturaLeadSchema) });

  if (capturar.isSuccess) {
    return (
      <AuthShell>
        <div className="text-center">
          <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-success/10 text-success">
            <CheckCircle2 className="h-6 w-6" />
          </div>
          <h2 className="text-xl font-semibold text-foreground">Recebemos seu contato!</h2>
          <p className="mt-2 text-sm text-muted-foreground">
            Obrigado pelo interesse. Nossa equipe vai analisar e retornar em breve.
          </p>
        </div>
      </AuthShell>
    );
  }

  return (
    <AuthShell>
      <div className="mb-8">
        <h2 className="text-2xl font-semibold tracking-tight text-foreground">Fale com a MedConsultoria</h2>
        <p className="mt-1.5 text-sm text-muted-foreground">
          Deixe seus dados e conte rapidamente o que você precisa — retornaremos em breve.
        </p>
      </div>

      <form
        onSubmit={handleSubmit((d) => capturar.mutate({ ...d, servicoIds: selecionados, ...rastreio }))}
        className="space-y-4"
        noValidate
      >
        {/* Honeypot anti-spam: escondido de humanos, ignorado pelo servidor se preenchido. */}
        <input
          type="text"
          tabIndex={-1}
          autoComplete="off"
          aria-hidden="true"
          className="absolute left-[-9999px] h-0 w-0 opacity-0"
          {...register("website")}
        />

        <div className="space-y-1.5">
          <Label htmlFor="nome">Nome *</Label>
          <div className="relative">
            <User className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input id="nome" autoFocus autoComplete="name" placeholder="Seu nome" className="pl-10" {...register("nome")} />
          </div>
          {errors.nome && <p className="text-xs text-destructive">{errors.nome.message}</p>}
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="email">E-mail *</Label>
          <div className="relative">
            <Mail className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              id="email"
              type="email"
              autoComplete="email"
              placeholder="voce@email.com"
              className="pl-10"
              {...register("email")}
            />
          </div>
          {errors.email && <p className="text-xs text-destructive">{errors.email.message}</p>}
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="telefone">Telefone</Label>
            <div className="relative">
              <Phone className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <MaskedInput id="telefone" inputMode="tel" autoComplete="tel" format={maskTelefone} placeholder="(11) 90000-0000" className="pl-10" {...register("telefone")} />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="empresa">Empresa</Label>
            <div className="relative">
              <Building2 className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input id="empresa" autoComplete="organization" placeholder="Sua clínica/empresa" className="pl-10" {...register("empresa")} />
            </div>
          </div>
        </div>

        {servicos.data && servicos.data.length > 0 && (
          <div className="space-y-1.5">
            <Label hint="Marque tudo que se aplica — assim já sabemos por onde começar.">Quais serviços você precisa?</Label>
            <ServicosPicker servicos={servicos.data} value={selecionados} onChange={setSelecionados} />
          </div>
        )}

        <div className="space-y-1.5">
          <Label htmlFor="mensagem">Como podemos ajudar?</Label>
          <div className="relative">
            <MessageSquare className="pointer-events-none absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
            <Textarea
              id="mensagem"
              rows={3}
              autoComplete="off"
              placeholder="Conte rapidamente o que você precisa…"
              className="pl-10"
              {...register("mensagem")}
            />
          </div>
        </div>

        {capturar.error && (
          <div className="flex items-start gap-2 rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2.5 text-sm text-destructive">
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
            <span>{capturar.error.message}</span>
          </div>
        )}

        <Button type="submit" size="lg" className="w-full" disabled={capturar.isPending}>
          {capturar.isPending ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin" />
              Enviando…
            </>
          ) : (
            <>
              Enviar contato
              <ArrowRight className="h-4 w-4" />
            </>
          )}
        </Button>
      </form>

      <p className="mt-6 text-center text-xs text-muted-foreground">
        Seus dados são usados apenas para retorno comercial, conforme a LGPD.
      </p>
    </AuthShell>
  );
}
