import { Home, FileText, Stethoscope, Package, LifeBuoy, type LucideIcon } from "lucide-react";

/**
 * AS SEÇÕES DA BARRA DO PORTAL — quatro coringas e uma vaga.
 *
 * A premissa original era "cinco seções fixas". O dono a recusou com a razão certa:
 * *"nem todos nossos clientes tem convênios. Nem todos tem credenciamento tbm."* Uma barra
 * com um item que não serve para metade dos clientes gasta 20% do espaço da tela mais escassa
 * que temos (360px de largura) com uma seção vazia.
 *
 * Então: **Início · Documentos · [vaga] · Serviços · Suporte**. Os quatro de fora valem para
 * todo cliente. A 3ª posição é uma VAGA, preenchida pela primeira candidata que se aplicar
 * àquele cliente. Sem candidata, a barra tem quatro itens e fica simétrica — nunca cinco com
 * um buraco, nunca um item morto.
 *
 * ⚠️ **A vaga é uma LISTA DE CANDIDATAS, nunca um `if (temCredenciamento)` dentro da barra.**
 * A diferença aparece na próxima frente de trabalho: quando o Faturamento ganhar tela própria,
 * ela entra acrescentando UMA LINHA em `CANDIDATAS_DA_VAGA` — sem abrir o componente da barra,
 * sem mexer em posicionamento, sem risco de a barra virar seis itens por descuido. Com um `if`,
 * cada frente nova teria de negociar espaço na barra outra vez.
 *
 * Hoje há **uma** candidata, e isso é fato do repositório, não escolha: `PortalCredenciamento`
 * é a única tela de frente que existe.
 */

/** Qual contador (pílula âmbar) o item mostra. `null` = seção sem contador, de propósito. */
export type ChaveDeContador = "convenios" | "servicos" | "suporte";

export interface SecaoDoPortal {
  /** Identificador estável, para chave de lista e teste. */
  chave: string;
  /** O que aparece embaixo do ícone. Curto: 68px de largura útil a 360px. */
  rotulo: string;
  /** Caminho declarado em `apps/web/src/app/portal-router.tsx`. */
  rota: string;
  icone: LucideIcon;
  contador: ChaveDeContador | null;
}

/**
 * As quatro que valem para TODO cliente.
 *
 * Início e Documentos não têm contador de propósito: o Início *é* a fila do que precisa de
 * atenção (um número em cima da fila seria a fila contando a si mesma), e Documentos não tem
 * fonte de pendência própria — o que falta enviar já é contado em Serviços e em Convênios.
 */
export const SECOES_FIXAS: readonly SecaoDoPortal[] = [
  { chave: "inicio", rotulo: "Início", rota: "/portal", icone: Home, contador: null },
  { chave: "documentos", rotulo: "Documentos", rota: "/portal/documentos", icone: FileText, contador: null },
  { chave: "servicos", rotulo: "Serviços", rota: "/portal/servicos", icone: Package, contador: "servicos" },
  { chave: "suporte", rotulo: "Suporte", rota: "/portal/suporte", icone: LifeBuoy, contador: "suporte" },
];

/** O que a régua da vaga precisa saber sobre este cliente. Um campo por candidata. */
export interface DadosDaVaga {
  /** `portal.credenciamento` devolveu algo? O servidor devolve `null` para quem não tem. */
  temCredenciamento: boolean;
}

export interface CandidataDaVaga extends SecaoDoPortal {
  /** Esta candidata serve para este cliente? A primeira que responder `true` fica com a vaga. */
  aplica: (dados: DadosDaVaga) => boolean;
}

/**
 * As candidatas à vaga, EM ORDEM DE PRIORIDADE. A primeira aplicável fica com o lugar.
 *
 * ⚠️ O rótulo é **Convênios**, não "Credenciamento": a palavra tem 14 caracteres e não cabe
 * nos 68px de um item de barra num aparelho de 360px — ela quebraria em duas linhas ou seria
 * cortada no meio. "Convênios" é como o médico chama isto de qualquer forma.
 */
export const CANDIDATAS_DA_VAGA: readonly CandidataDaVaga[] = [
  {
    chave: "credenciamento",
    rotulo: "Convênios",
    rota: "/portal/credenciamento",
    icone: Stethoscope,
    contador: "convenios",
    aplica: (dados) => dados.temCredenciamento,
  },
];

/** A vaga é a 3ª posição (índice 2) — o meio da barra, o lugar mais fácil de alcançar com o polegar. */
export const POSICAO_DA_VAGA = 2;

/**
 * A lista final de seções para ESTE cliente.
 *
 * No máximo **uma** candidata entra, e ela entra na 3ª posição. Sem candidata aplicável, a
 * barra tem exatamente as quatro coringas.
 */
export function montarSecoes(dados: DadosDaVaga): SecaoDoPortal[] {
  const candidata = CANDIDATAS_DA_VAGA.find((c) => c.aplica(dados));
  if (!candidata) return [...SECOES_FIXAS];
  const { aplica: _aplica, ...secao } = candidata;
  return [...SECOES_FIXAS.slice(0, POSICAO_DA_VAGA), secao, ...SECOES_FIXAS.slice(POSICAO_DA_VAGA)];
}
