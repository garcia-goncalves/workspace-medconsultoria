/**
 * IDENTIDADE INSTITUCIONAL — fonte única da verdade.
 *
 * Tudo aqui foi **transcrito** de fontes verificadas (o site público
 * https://medconsultoria.com.br e a pasta `brand/`), nunca inventado. Documentos, e-mails e
 * telas cliente-facing devem importar destas constantes em vez de repetir texto solto —
 * assim, quando a Thaís revisar um dado, ele muda em um lugar só.
 *
 * ⚠️ Campos ainda NÃO fornecidos (razão social completa, CNPJ, endereço) estão em
 * `PENDENTE_THAIS` e **não têm valor padrão de propósito**: um CNPJ inventado num contrato
 * seria um problema jurídico real. Ver "Conteúdo real necessário" no
 * AUDITORIA_FUNCIONAL_COMPLETA.md.
 */
export const INSTITUCIONAL = {
  /** Nome fantasia, como aparece na marca. */
  nome: "MedConsultoria",
  /** Posicionamento do site: "gestão estratégica para clínicas". */
  tagline: "Gestão estratégica para clínicas e consultórios",
  /** Site público — é este que vai em documento/e-mail para o cliente. */
  site: "medconsultoria.com.br",
  siteUrl: "https://medconsultoria.com.br",
  /** E-mail comercial divulgado no site. */
  email: "comercial@medconsultoria.com.br",
  telefone: "(11) 94072-3055",
  cidade: "São Paulo, SP",
  instagram: "@med.consultoria",
  instagramUrl: "https://instagram.com/med.consultoria",
  /** Endereço do workspace interno — NUNCA usar em material cliente-facing. */
  workspaceUrl: "https://workspace.medconsultoria.com.br",
} as const;

/**
 * Dados que só a Thaís pode fornecer. Enquanto forem `null`, quem consome deve OMITIR o campo
 * — jamais preencher com exemplo. Um CNPJ fictício num contrato assinado é um risco jurídico.
 */
export const PENDENTE_THAIS = {
  razaoSocial: null,
  cnpj: null,
  enderecoCompleto: null,
  /** Foro de eleição dos contratos. */
  foro: null,
} as const;

/**
 * Dados da identidade que a Thaís edita em Ajustes → Dados da empresa (modelo
 * `IdentidadeInstitucional`). Os consumidores (contrato, e-mail) recebem a linha do banco;
 * quando não recebem nada, caem nas constantes acima como padrão. Tudo opcional para o
 * chamador poder passar só o que tem.
 */
export type DadosInstitucionais = Partial<{
  nome: string;
  email: string;
  telefone: string;
  site: string;
  cidade: string;
  razaoSocial: string | null;
  cnpj: string | null;
  enderecoCompleto: string | null;
  foro: string | null;
}>;

/**
 * Linha de rodapé para documentos e e-mails: só dados verificados, na ordem de leitura.
 * Aceita os dados do banco (editados pela Thaís); sem eles, usa as constantes reais.
 */
export function rodapeInstitucional(d: DadosInstitucionais = {}): string {
  return [
    d.nome ?? INSTITUCIONAL.nome,
    d.email ?? INSTITUCIONAL.email,
    d.telefone ?? INSTITUCIONAL.telefone,
    d.site ?? INSTITUCIONAL.site,
  ].join(" · ");
}

/** Marcador visível para dado que só a Thaís pode preencher. Nunca some silenciosamente. */
const aPreencher = (campo: string) => `**[A PREENCHER: ${campo}]**`;

/**
 * Qualificação da CONTRATADA para contratos.
 *
 * Um contrato precisa qualificar **as duas** partes — antes só a CONTRATANTE era qualificada
 * (nome, documento, e-mail) e a CONTRATADA aparecia como um nome solto. Os dados vêm de Ajustes →
 * Dados da empresa (editáveis pela Thaís); o que ela já preencheu entra, o que ainda falta aparece
 * como marcador **visível em negrito**, para ela enxergar o que resta antes de assinar (em vez de
 * o campo sumir sem ninguém notar). Sem dados do banco, cai nas constantes/pendências padrão.
 */
export function qualificacaoContratada(d: DadosInstitucionais = {}): string {
  const razaoSocial = d.razaoSocial ?? PENDENTE_THAIS.razaoSocial;
  const cnpj = d.cnpj ?? PENDENTE_THAIS.cnpj;
  const endereco = d.enderecoCompleto ?? PENDENTE_THAIS.enderecoCompleto;
  return [
    `a ${razaoSocial ?? aPreencher("RAZÃO SOCIAL")}`,
    `nome fantasia **${d.nome ?? INSTITUCIONAL.nome}**`,
    `inscrita no CNPJ sob o nº ${cnpj ?? aPreencher("CNPJ")}`,
    `com sede em ${endereco ?? aPreencher("ENDEREÇO COMPLETO")}, ${d.cidade ?? INSTITUCIONAL.cidade}`,
    `e-mail ${d.email ?? INSTITUCIONAL.email}`,
    `telefone ${d.telefone ?? INSTITUCIONAL.telefone}`,
  ].join(", ");
}
