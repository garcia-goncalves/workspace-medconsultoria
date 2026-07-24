import { useState } from "react";
import { Link } from "@tanstack/react-router";
import { Briefcase, Mail, UserCog, Send, FileText, Tags, Compass, Building2, Landmark, ChevronRight, type LucideIcon } from "lucide-react";
import { hasRoleLevel, type Role } from "@app/shared";
import { useAuth } from "../../lib/auth-context";
import { PageHeader } from "../../components/ui/page-header";
import { CategoriasDialog } from "../financeiro/CategoriasDialog";
import { OrigensDialog } from "../crm/leads/OrigensDialog";
import { OperadorasDialog } from "../documentos/OperadorasDialog";
import { IdentidadeDialog } from "./IdentidadeDialog";

type DialogId = "categorias" | "origens" | "operadoras" | "identidade";

interface AjusteItem {
  icon: LucideIcon;
  label: string;
  desc: string;
  /** Ou navega para uma página (`to`), ou abre um diálogo de catálogo aqui mesmo (`dialog`). */
  to?: string;
  dialog?: DialogId;
  /** Papel mínimo para ver o item (omitido = todos da equipe). */
  minRole?: Role;
}

/**
 * Ajustes — a "porta única" do que se configura uma vez e o sistema usa sozinho.
 * Junta os painéis administrativos que antes poluíam o menu principal.
 */
const SECOES: { titulo: string; descricao: string; itens: AjusteItem[] }[] = [
  {
    titulo: "Automações",
    descricao: "O que você configura uma vez e o sistema usa sozinho.",
    itens: [
      {
        icon: Briefcase,
        label: "Serviços",
        desc: "O catálogo de serviços e o que cada um dispara: passos da venda, o que o cliente precisa enviar e as tarefas da equipe.",
        to: "/servicos",
      },
      {
        icon: FileText,
        label: "Modelos de documento",
        desc: "Os textos-base de proposta, contrato, ata e recibo. Os documentos de cada cliente você gera na ficha dele; vê todos em Documentos.",
        to: "/modelos",
      },
      {
        icon: Mail,
        label: "Mensagens automáticas",
        desc: "Os textos dos e-mails e avisos que o sistema envia sozinho — com a marca da empresa.",
        to: "/emails",
      },
    ],
  },
  {
    titulo: "Catálogos",
    descricao: "Listas reutilizáveis pelo sistema. Ficam também onde são usadas — aqui você acha todas num lugar só.",
    itens: [
      {
        icon: Tags,
        label: "Categorias financeiras",
        desc: "As categorias de entradas e saídas — por carteira Empresa e Pessoal — usadas no Financeiro.",
        dialog: "categorias",
      },
      {
        icon: Compass,
        label: "Origens de leads",
        desc: "De onde vêm seus contatos (indicação, site, anúncio…), usadas no funil de Vendas.",
        dialog: "origens",
      },
      {
        icon: Building2,
        label: "Operadoras e convênios",
        desc: "O catálogo de operadoras usado nas propostas de credenciamento.",
        dialog: "operadoras",
      },
    ],
  },
  {
    titulo: "Administração",
    descricao: "Os bastidores da empresa — acesso restrito.",
    itens: [
      {
        icon: Landmark,
        label: "Dados da empresa",
        desc: "Marca, contato e dados jurídicos (razão social, CNPJ, endereço, foro) que entram nos contratos, propostas e e-mails.",
        dialog: "identidade",
        minRole: "ADMIN",
      },
      {
        icon: UserCog,
        label: "Equipe e acessos",
        desc: "Quem entra no sistema e o que cada pessoa pode fazer (equipe e acessos do Portal).",
        to: "/usuarios",
      },
      {
        icon: Send,
        label: "E-mails enviados",
        desc: "Histórico de todos os e-mails que o sistema mandou — entregas, falhas e o motivo de cada falha.",
        to: "/emails-enviados",
      },
    ],
  },
];

export function AjustesPage() {
  const { user } = useAuth();
  const [dialog, setDialog] = useState<DialogId | null>(null);
  const podeVer = (it: AjusteItem) => !it.minRole || hasRoleLevel(user.role, it.minRole);

  return (
    <div className="flex h-full flex-col gap-5">
      <PageHeader
        title="Ajustes"
        subtitle="Tudo que você configura uma vez e o sistema usa sozinho, num lugar só. Você raramente precisa entrar aqui."
      />
      <div className="min-h-0 flex-1 space-y-6 overflow-y-auto pr-1">
        {SECOES.map((secao) => {
          const itens = secao.itens.filter(podeVer);
          if (itens.length === 0) return null;
          return (
          <section key={secao.titulo}>
            <div className="mb-2.5">
              <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">{secao.titulo}</h2>
              <p className="text-xs text-muted-foreground">{secao.descricao}</p>
            </div>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {itens.map((it) => {
                const cls =
                  "group flex items-start gap-3 rounded-xl border bg-card p-4 text-left shadow-sm transition-all hover:border-primary/40 hover:shadow-md";
                const inner = (
                  <>
                    <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
                      <it.icon className="h-5 w-5" />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="flex items-center gap-1 font-semibold">
                        {it.label}
                        <ChevronRight className="h-4 w-4 text-muted-foreground transition-transform group-hover:translate-x-0.5" />
                      </span>
                      <span className="mt-0.5 block text-sm text-muted-foreground">{it.desc}</span>
                    </span>
                  </>
                );
                return it.to ? (
                  <Link key={it.label} to={it.to} className={cls}>
                    {inner}
                  </Link>
                ) : (
                  <button key={it.label} type="button" onClick={() => it.dialog && setDialog(it.dialog)} className={cls}>
                    {inner}
                  </button>
                );
              })}
            </div>
          </section>
          );
        })}
      </div>

      {/* Catálogos abertos a partir de Ajustes (mesmos diálogos usados em Financeiro/Vendas/Documentos). */}
      <CategoriasDialog open={dialog === "categorias"} onClose={() => setDialog(null)} />
      <OrigensDialog open={dialog === "origens"} onClose={() => setDialog(null)} />
      <OperadorasDialog open={dialog === "operadoras"} onClose={() => setDialog(null)} />
      <IdentidadeDialog open={dialog === "identidade"} onClose={() => setDialog(null)} />
    </div>
  );
}
