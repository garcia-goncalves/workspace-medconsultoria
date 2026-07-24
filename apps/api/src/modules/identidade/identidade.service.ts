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
  };
  return prisma.identidadeInstitucional.upsert({
    where: { id: ID },
    update: dados,
    create: { id: ID, ...dados },
  });
}
