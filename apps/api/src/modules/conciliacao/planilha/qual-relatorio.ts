import { acharColunaExata, localizarCabecalho, type Grade } from "./index.js";
import { COLUNAS_EXIGIDAS, COLUNAS_OPCIONAIS } from "../producao-consultas.js";
import { COLUNAS_EXIGIDAS_CIRURGIA, COLUNAS_OPCIONAIS_CIRURGIA } from "../producao-cirurgias.js";
import { COLUNAS_EXIGIDAS_REPASSE, COLUNAS_OPCIONAIS_REPASSE, COLUNAS_DA_PLANILHA } from "../recebido.js";

/**
 * Qual dos quatro relatórios da Conciliação é este arquivo — e onde fica o botão dele.
 *
 * Existe por um motivo só: quando um importador recusa um arquivo, ele diz "não reconheci este
 * arquivo" e lista as colunas que faltam. Isso ACUSA QUEM ENVIOU por um erro que é de endereço, e
 * o sistema tinha como saber — os quatro leitores estão todos aqui. Em 21/09/2026 a planilha
 * MODELO exportada pelo próprio sistema foi parar no importador de consultas e ouviu que não era
 * um relatório de produção, sem nenhuma pista de onde ela deveria ter entrado.
 *
 * ⚠️ NÃO confundir com `./formato.js`, que responde outra pergunta: se o arquivo é CSV, XLSX ou
 * tabela HTML. Aquilo é a EMBALAGEM; isto é o CONTEÚDO.
 *
 * ⚠️ NÃO importe este módulo de dentro dos leitores. Ele depende dos quatro; eles não dependem
 * dele. Inverter isso fecha um ciclo de importação.
 */

/** A chave é o identificador estável; `nome` e `onde` é o que a pessoa lê na tela. */
export type TipoDeRelatorio = "consultas" | "cirurgias" | "repasse" | "planilha";

interface Relatorio {
  tipo: TipoDeRelatorio;
  nome: string;
  /** O caminho na tela, palavra por palavra como os botões estão escritos. */
  onde: string;
  exigidas: readonly string[];
  opcionais: readonly string[];
  /** Quando existe, o arquivo só é DESTE tipo se trouxer ao menos uma destas colunas. */
  umaDentre?: readonly string[];
}

/**
 * ⚠️ A ORDEM É A REGRA, e vai do mais específico para o mais genérico.
 *
 * O casamento de coluna aceita prefixo (ver `localizarCabecalho`), então `Status conciliação` casa
 * com `Status` — e a planilha MODELO, que também traz Data, Paciente, Nº Cirurgia, Convênio,
 * Médico e Procedimento, passa INTEIRA na régua do mapa cirúrgico. Testada nesta ordem, ela é
 * reconhecida como planilha antes de chegar lá.
 *
 * Reordenar isto faz a dica mandar a pessoa para a porta errada — com a autoridade de uma
 * instrução do sistema, que é pior do que não dizer nada. Há teste que reprova a inversão.
 */
const RELATORIOS: readonly Relatorio[] = [
  {
    tipo: "planilha",
    nome: "a planilha de conciliação preenchida",
    onde: "Cirurgias (TASY) → Importar planilha preenchida",
    exigidas: ["Nº Cirurgia"],
    opcionais: COLUNAS_DA_PLANILHA,
    umaDentre: COLUNAS_DA_PLANILHA,
  },
  {
    tipo: "cirurgias",
    nome: "o mapa cirúrgico do TASY",
    onde: "Cirurgias (TASY) → Importar cirurgias",
    exigidas: COLUNAS_EXIGIDAS_CIRURGIA,
    opcionais: COLUNAS_OPCIONAIS_CIRURGIA,
  },
  {
    tipo: "consultas",
    nome: "o relatório de produção de consultas",
    onde: "Consultas → Importar produção",
    exigidas: COLUNAS_EXIGIDAS,
    opcionais: COLUNAS_OPCIONAIS,
  },
  {
    // Por último de propósito: exige só duas colunas, então é o mais fácil de casar por acidente.
    tipo: "repasse",
    nome: "o relatório de repasse do TASY",
    onde: "Cirurgias (TASY) → Importar repasse",
    exigidas: COLUNAS_EXIGIDAS_REPASSE,
    opcionais: COLUNAS_OPCIONAIS_REPASSE,
  },
];

/** O primeiro relatório que reconhece esta grade, na ordem acima. `null` se nenhum reconhece. */
export function identificarRelatorio(grade: Grade): TipoDeRelatorio | null {
  for (const r of RELATORIOS) {
    const cab = localizarCabecalho(grade.linhas, r.exigidas, { opcionais: r.opcionais });
    if (!cab) continue;
    if (r.umaDentre) {
      // ⚠️ Igualdade, nunca `cab.colunas.has` — o casamento do `localizarCabecalho` é tolerante a
      // prefixo NOS DOIS SENTIDOS, então `Data` daria `Data pagamento` e todo mapa cirúrgico cru
      // seria confundido com a planilha preenchida. Mesmo defeito que a guarda de
      // `interpretarPlanilhaConciliacao` tinha até 21/09/2026.
      const celulas = grade.linhas[cab.indice] ?? [];
      if (!r.umaDentre.some((n) => acharColunaExata(celulas, n) !== -1)) continue;
    }
    return r.tipo;
  }
  return null;
}

/**
 * A frase que se acrescenta à recusa: "este arquivo é X, e o lugar dele é Y".
 *
 * `null` quando não há o que dizer — nenhum tipo reconhece o arquivo, ou o que reconhece é o
 * próprio importador que recusou. Neste segundo caso o problema é outro (cabeçalho além da linha
 * 30, ou uma coluna faltando de verdade), e mandar a pessoa de volta para onde ela já está seria
 * pior que calar.
 */
export function dicaDeRota(grade: Grade, recusadoPor: TipoDeRelatorio): string | null {
  const achado = identificarRelatorio(grade);
  if (achado === null || achado === recusadoPor) return null;
  const r = RELATORIOS.find((x) => x.tipo === achado)!;
  return `Pelo cabeçalho, este arquivo é ${r.nome}. Importe-o em: ${r.onde}.`;
}
