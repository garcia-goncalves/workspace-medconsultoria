import { z } from "zod";
import { recorrenciaEnum } from "./evento";

const textoOpcional = z.string().trim().max(2000).optional().or(z.literal(""));
const idOpcional = z.string().optional().or(z.literal(""));
// Data opcional vinda de <input type="date"> ("" quando vazia).
const dataOpcional = z.preprocess((v) => (v === "" || v == null ? undefined : v), z.coerce.date().optional());

export const contaTipoEnum = z.enum(["PAGAR", "RECEBER"]);
export type ContaTipo = z.infer<typeof contaTipoEnum>;

export const categoriaTipoEnum = z.enum(["RECEITA", "DESPESA"]);
export type CategoriaTipo = z.infer<typeof categoriaTipoEnum>;

export const CATEGORIA_TIPO_LABEL: Record<CategoriaTipo, string> = {
  RECEITA: "Receita",
  DESPESA: "Despesa",
};

// ── Carteira (Empresa × Pessoal) ─────────────────────────
/** Escopo de uma conta/categoria: livros da empresa (compartilhados) ou finanças pessoais (privadas). */
export const escopoEnum = z.enum(["EMPRESA", "PESSOAL"]);
export type Escopo = z.infer<typeof escopoEnum>;
export const ESCOPO_LABEL: Record<Escopo, string> = {
  EMPRESA: "Empresa",
  PESSOAL: "Pessoal",
};
/** Visão da página: uma carteira específica ou o consolidado das duas. */
export const carteiraEnum = z.enum(["EMPRESA", "PESSOAL", "TUDO"]);
export type Carteira = z.infer<typeof carteiraEnum>;
export const carteiraInputSchema = z.object({ carteira: carteiraEnum.default("EMPRESA") });
export type CarteiraInput = z.infer<typeof carteiraInputSchema>;

// ── Conta ────────────────────────────────────────────────
export const createContaSchema = z.object({
  tipo: contaTipoEnum,
  escopo: escopoEnum.default("EMPRESA"),
  descricao: z.string().trim().min(1, "Informe a descrição"),
  valor: z.coerce.number().positive("O valor deve ser maior que zero"),
  vencimento: z.coerce.date({ message: "Informe o vencimento" }),
  categoriaId: idOpcional,
  clienteId: idOpcional,
  recorrencia: recorrenciaEnum.default("NENHUMA"),
  recorrenciaAte: dataOpcional,
  observacoes: textoOpcional,
});
export type CreateContaInput = z.infer<typeof createContaSchema>;

export const updateContaSchema = createContaSchema.partial().extend({ id: z.string().min(1) });
export type UpdateContaInput = z.infer<typeof updateContaSchema>;

/**
 * Valor especial do filtro de categoria: "sem categoria". Existe porque `categoriaId` nulo é
 * justamente o que sobra quando alguém exclui uma categoria (`onDelete: SetNull`) — e achar
 * essas contas para reclassificar é a primeira coisa que se quer fazer depois.
 */
export const SEM_CATEGORIA = "__sem__";

/** Dia "AAAA-MM-DD" (o que o `<input type="date">` e a URL carregam). */
const diaIso = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Data inválida");

/**
 * O RECORTE da lista de contas — o mesmo para a tela e para a exportação ao contador.
 *
 * ⚠️ Um schema só para os dois de propósito: se a exportação tivesse o próprio, bastaria um
 * filtro novo entrar na tela e não na planilha para o contador receber MAIS contas do que a
 * pessoa via — sem aviso nenhum, porque o botão diz "exportar o filtro".
 */
export const filtroContasSchema = z.object({
  carteira: carteiraEnum.default("EMPRESA"),
  tipo: contaTipoEnum.optional(),
  status: z.enum(["TODAS", "PENDENTES", "PAGAS"]).default("TODAS"),
  clienteId: z.string().min(1).max(64).optional(),
  /** Id da categoria, ou `SEM_CATEGORIA`. */
  categoriaId: z.string().min(1).max(64).optional(),
  /** Vencimento a partir de (inclusive). */
  vencimentoDe: diaIso.optional(),
  /** Vencimento até (inclusive). */
  vencimentoAte: diaIso.optional(),
  /** Busca na descrição. Mesmo teto de 120 das outras buscas da casa. */
  busca: z.string().trim().max(120).optional(),
});
export type FiltroContasInput = z.infer<typeof filtroContasSchema>;

/**
 * Lista paginada NO SERVIDOR: a recorrência faz a tabela crescer sozinha, mês a mês, e mandar
 * tudo ao navegador a cada abertura da página só piora com o tempo.
 */
export const listContasSchema = filtroContasSchema.extend({
  pagina: z.number().int().min(1).max(10_000).default(1),
  porPagina: z.number().int().min(1).max(200).default(50),
});
export type ListContasInput = z.infer<typeof listContasSchema>;

/** Relatório mês a mês (regime de caixa) — quantos meses para trás, contando o corrente. */
export const relatorioMensalSchema = z.object({
  carteira: carteiraEnum.default("EMPRESA"),
  meses: z.number().int().min(1).max(24).default(12),
});
export type RelatorioMensalInput = z.infer<typeof relatorioMensalSchema>;

/** Projeção de caixa — quantos meses à frente, contando o corrente. */
export const projecaoCaixaSchema = z.object({
  carteira: carteiraEnum.default("EMPRESA"),
  meses: z.number().int().min(1).max(12).default(3),
});
export type ProjecaoCaixaInput = z.infer<typeof projecaoCaixaSchema>;

export const marcarPagaSchema = z.object({ id: z.string().min(1), pago: z.boolean() });

// ── Categoria ────────────────────────────────────────────
export const listCategoriasSchema = z.object({ escopo: escopoEnum.default("EMPRESA") });
export type ListCategoriasInput = z.infer<typeof listCategoriasSchema>;

export const createCategoriaSchema = z.object({
  nome: z.string().trim().min(1, "Informe o nome"),
  tipo: categoriaTipoEnum,
  escopo: escopoEnum.default("EMPRESA"),
  cor: textoOpcional,
});
export type CreateCategoriaInput = z.infer<typeof createCategoriaSchema>;

export const updateCategoriaSchema = createCategoriaSchema.partial().extend({
  id: z.string().min(1),
});
export type UpdateCategoriaInput = z.infer<typeof updateCategoriaSchema>;
