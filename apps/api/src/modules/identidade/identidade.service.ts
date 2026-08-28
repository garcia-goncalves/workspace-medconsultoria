import { prisma } from "@app/db";
import { INSTITUCIONAL } from "@app/shared";

/** Linha única (singleton). Sempre a mesma chave — a identidade é uma só. */
const ID = "default";

/** Valores iniciais: os dados de contato reais; os jurídicos ficam nulos até a Thaís preencher. */
const PADRAO = {
  nome: INSTITUCIONAL.nome,
  tagline: INSTITUCIONAL.tagline,
  site: INSTITUCIONAL.site,
  siteUrl: INSTITUCIONAL.siteUrl,
  email: INSTITUCIONAL.email,
  telefone: INSTITUCIONAL.telefone,
  cidade: INSTITUCIONAL.cidade,
  instagram: INSTITUCIONAL.instagram,
  instagramUrl: INSTITUCIONAL.instagramUrl,
};

/**
 * Identidade institucional editável (Ajustes → Dados da empresa). Semeia a linha na primeira
 * leitura, com os dados de contato reais; jurídicos (razão social/CNPJ/endereço/foro) começam
 * nulos de propósito — ninguém inventa CNPJ; a Thaís preenche.
 */
export async function getIdentidade() {
  return prisma.identidadeInstitucional.upsert({
    where: { id: ID },
    update: {},
    create: { id: ID, ...PADRAO },
  });
}

export type IdentidadeInput = {
  nome: string;
  tagline: string;
  site: string;
  siteUrl: string;
  email: string;
  telefone: string;
  cidade: string;
  instagram: string;
  instagramUrl: string;
  razaoSocial: string | null;
  cnpj: string | null;
  enderecoCompleto: string | null;
  foro: string | null;
  /** Dados para pagamento — saem no bloco `{{dadosPagamento}}` das propostas (ADR-127). */
  bancoNome: string | null;
  bancoAgencia: string | null;
  bancoConta: string | null;
  bancoTitular: string | null;
  pixChave: string | null;
  /** Dias sem andar até um credenciamento pedir atenção no painel (padrão 60, da Thaís). */
  credenciamentoPrazoDias: number;
  /** LGPD (ADR-141) — prazos de guarda e encarregado de dados. */
  retencaoCorpoEmailDias: number;
  retencaoAcervoAnos: number;
  encarregadoNome: string | null;
  encarregadoEmail: string | null;
};

/** Normaliza vazio → null nos campos jurídicos (para o contrato mostrar o marcador, não string vazia). */
const ouNull = (v: string | null | undefined) => {
  const t = (v ?? "").trim();
  return t.length ? t : null;
};

export async function atualizarIdentidade(input: IdentidadeInput) {
  const dados = {
    nome: input.nome.trim(),
    tagline: input.tagline.trim(),
    site: input.site.trim(),
    siteUrl: input.siteUrl.trim(),
    email: input.email.trim(),
    telefone: input.telefone.trim(),
    cidade: input.cidade.trim(),
    instagram: input.instagram.trim(),
    instagramUrl: input.instagramUrl.trim(),
    razaoSocial: ouNull(input.razaoSocial),
    cnpj: ouNull(input.cnpj),
    enderecoCompleto: ouNull(input.enderecoCompleto),
    foro: ouNull(input.foro),
    bancoNome: ouNull(input.bancoNome),
    bancoAgencia: ouNull(input.bancoAgencia),
    bancoConta: ouNull(input.bancoConta),
    retencaoCorpoEmailDias: input.retencaoCorpoEmailDias,
    retencaoAcervoAnos: input.retencaoAcervoAnos,
    encarregadoNome: ouNull(input.encarregadoNome),
    encarregadoEmail: ouNull(input.encarregadoEmail),
    bancoTitular: ouNull(input.bancoTitular),
    pixChave: ouNull(input.pixChave),
    credenciamentoPrazoDias: input.credenciamentoPrazoDias,
  };
  return prisma.identidadeInstitucional.upsert({
    where: { id: ID },
    update: dados,
    create: { id: ID, ...dados },
  });
}

/**
 * O que a página PÚBLICA de privacidade mostra (ADR-141). Endpoint separado de propósito:
 * `get` é da equipe e devolve a conta bancária da empresa — abrir aquele para o mundo por
 * comodidade seria exatamente a segunda porta da ADR-140. Aqui só sai o que já vai
 * impresso em todo contrato, mais os prazos declarados e o canal do encarregado.
 */
export async function getPrivacidadePublica() {
  const i = await getIdentidade();
  return {
    nome: i.nome,
    razaoSocial: i.razaoSocial,
    cnpj: i.cnpj,
    enderecoCompleto: i.enderecoCompleto,
    email: i.email,
    site: i.site,
    siteUrl: i.siteUrl,
    retencaoCorpoEmailDias: i.retencaoCorpoEmailDias,
    retencaoAcervoAnos: i.retencaoAcervoAnos,
    // Sem encarregado indicado, o canal é o e-mail institucional — e a página diz isso,
    // em vez de inventar um nome. Mesma regra do "[A PREENCHER]" do foro.
    encarregadoNome: i.encarregadoNome,
    encarregadoEmail: i.encarregadoEmail ?? i.email,
  };
}
