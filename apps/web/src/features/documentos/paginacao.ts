/**
 * COMO O DOCUMENTO SE PARTE EM FOLHAS A4.
 *
 * Separado do componente de propósito: aqui não há navegador, DOM nem medição — só a
 * DECISÃO de o que fica e o que desce. É a regra que o cliente da Thaís vê impressa, e
 * por isso ela é testada (`paginacao.test.ts`) em vez de depender de olhar a tela.
 *
 * Quem MEDE as alturas é o `DocumentoBranded`, no navegador; ele entrega os blocos já
 * medidos para cá.
 */

export interface LinhaMedida {
  html: string;
  h: number;
}

export type BlocoMedido =
  | { tipo: "atomo"; html: string; h: number; titulo?: boolean }
  | {
      tipo: "tabela";
      /** A tag de abertura da tabela, ex.: `<table>` — cada fatia reabre a tabela. */
      abre: string;
      cabecalho: string;
      cabH: number;
      linhas: LinhaMedida[];
      h: number;
    };

export interface AlturasDaFolha {
  /** Altura útil da PRIMEIRA folha — já sem o cabeçalho da marca, o título e o rodapé. */
  primeira: number;
  /** Altura útil das demais — já sem o cabeçalho corrido e o rodapé. */
  demais: number;
}

/**
 * Quanto do bloco seguinte precisa caber junto com um título para ele não ficar órfão no
 * pé da folha. Equivale a ~duas linhas de texto: título sozinho embaixo, com o assunto
 * dele virando a página, é o defeito mais visível de documento mal paginado.
 */
const ORFAO_MINIMO = 48;

function montarTabela(abre: string, cabecalho: string, linhas: LinhaMedida[]): string {
  return `${abre}${cabecalho}<tbody>${linhas.map((l) => l.html).join("")}</tbody></table>`;
}

/**
 * Quanto do bloco seguinte precisa caber junto com o título para ele não ficar órfão.
 *
 * ⚠️ A resposta depende de o bloco poder ou não ser partido. Parágrafo, lista e tabela pequena
 * são INDIVISÍVEIS: ou cabem inteiros embaixo do título, ou o título fica sozinho no pé — pedir
 * "duas linhas" ali não resolve nada (foi exatamente o que deixou *Prazos e rotina de
 * faturamento* sozinho no pé da folha 2 da proposta 0230). Só quando o bloco é maior que uma
 * folha inteira — aí ele vai ser partido de qualquer jeito — basta o começo dele.
 */
function inicioDe(b: BlocoMedido, alturaDaFolha: number): number {
  if (b.h <= alturaDaFolha) return b.h;
  if (b.tipo === "atomo") return Math.min(b.h, ORFAO_MINIMO);
  const primeira = b.linhas[0];
  return b.cabH + (primeira ? primeira.h : 0);
}

/**
 * Distribui os blocos medidos em folhas. Devolve o HTML INTERNO do corpo de cada folha —
 * sempre pelo menos uma, mesmo que vazia.
 */
export function empacotarBlocos(blocos: BlocoMedido[], alturas: AlturasDaFolha): string[] {
  const paginas: string[] = [];
  let cur = "";
  let sobra = alturas.primeira;

  const quebrar = () => {
    paginas.push(cur);
    cur = "";
    sobra = alturas.demais;
  };

  for (let i = 0; i < blocos.length; i++) {
    const b = blocos[i]!;

    if (b.tipo === "atomo") {
      // Título carrega consigo o começo do que vem abaixo; os demais blocos só a si mesmos.
      // Um título carrega consigo TODA a fila de títulos abaixo dele mais o começo do primeiro
      // bloco de conteúdo. Olhar só o vizinho imediato não basta: "Como funciona o nosso
      // serviço" é seguido de outro título, então a conta dava "cabe" e os dois acabavam
      // sozinhos no pé da folha, com o texto deles na seguinte.
      let precisa = b.h;
      if (b.titulo) {
        let j = i + 1;
        while (j < blocos.length) {
          const seguinte = blocos[j]!;
          if (seguinte.tipo === "atomo" && seguinte.titulo) {
            precisa += seguinte.h;
            j++;
            continue;
          }
          precisa += inicioDe(seguinte, alturas.demais);
          break;
        }
      }
      if (cur && precisa > sobra) quebrar();
      cur += b.html;
      sobra -= b.h;
      continue;
    }

    // Tabela que cabe no que sobrou: entra inteira.
    if (b.h <= sobra) {
      cur += montarTabela(b.abre, b.cabecalho, b.linhas);
      sobra -= b.h;
      continue;
    }

    // Tabela que cabe numa folha inteira desce INTEIRA em vez de ser fatiada. É o que impede
    // a assinatura de sair partida (traço numa folha, nome na outra).
    //
    // ⚠️ A exceção é a folha ainda VAZIA (`cur === ""`), que só acontece na primeira — onde o
    // cabeçalho da marca e o título comem parte do espaço. Ali quebrar produziria uma folha com
    // o título e mais nada, e a tabela começaria na folha 2: pior do que fatiar. Na prática só
    // alcança tabela ENORME (mais de ~75% de uma folha) logo abaixo do título; o bloco de
    // assinatura, que é o motivo desta regra existir, tem três linhas e nunca cai aqui.
    if (b.h <= alturas.demais && cur) {
      quebrar();
      cur += montarTabela(b.abre, b.cabecalho, b.linhas);
      sobra -= b.h;
      continue;
    }

    // Tabela maior que a folha: fatiada por LINHAS INTEIRAS, cada fatia repetindo o cabeçalho.
    let idx = 0;
    while (idx < b.linhas.length) {
      const primeira = b.linhas[idx]!;
      // Cabeçalho sozinho no pé da folha não serve para nada: quebra antes.
      if (cur && sobra < b.cabH + primeira.h) quebrar();
      const fatia: LinhaMedida[] = [];
      let usado = b.cabH;
      while (idx < b.linhas.length) {
        const l = b.linhas[idx]!;
        // `fatia.length === 0` garante progresso quando UMA linha é maior que a folha.
        if (usado + l.h > sobra && fatia.length > 0) break;
        fatia.push(l);
        usado += l.h;
        idx++;
      }
      cur += montarTabela(b.abre, b.cabecalho, fatia);
      sobra -= usado;
      if (idx < b.linhas.length) quebrar();
    }
  }

  paginas.push(cur);
  return paginas;
}
