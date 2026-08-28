import { podeAgirNoPortal, type AcaoDoPortal } from "@app/shared";
import { useAuth } from "../../lib/auth-context";

/**
 * A TRAVA DE PAPEL, VISTA PELA TELA — antes do clique, não depois.
 *
 * Quatro botões do Portal chamam ações que a secretária (papel EQUIPE, ADR-131) e a sessão de
 * suporte da Med (ADR-128) não podem executar: encerrar o atendimento, retomá-lo, solicitar
 * serviços e cancelar um serviço. O servidor sempre recusou — mas a recusa chegava **depois**
 * de clicar, ler um modal e confirmar. Do lado de quem usa, isso se lê como sistema quebrado.
 *
 * ⚠️ **Esconder o botão E pôr a frase no lugar dele.** Botão que some sem explicação é o defeito
 * que se relata como "sumiu a opção"; botão desabilitado em silêncio é o mesmo com mais um
 * clique. E o ITEM continua visível — a trava é sobre agir, não sobre ver: a secretária precisa
 * saber que existe um serviço contratado para avisar quem cancela.
 *
 * A régua é a função pura do `@app/shared`, a MESMA que o `portalProcedure` chama no servidor.
 */

/** A frase que ocupa o lugar do botão, por ação. Curta: cabe ao lado do item, a 360px. */
const SO_RESPONSAVEL_FAZ: Record<string, string> = {
  desistir: "Só o responsável pela clínica encerra o atendimento",
  retomar: "Só o responsável pela clínica retoma o atendimento",
  solicitarServicos: "Só o responsável pela clínica solicita serviços",
  cancelarServico: "Só o responsável pela clínica cancela um serviço",
};

/** Em sessão de suporte a frase é outra: quem está vendo não é da clínica, é da Med. */
const EM_MODO_DE_SUPORTE = "Modo de suporte — só leitura";

export interface VereditoNaTela {
  /** Mostra o botão? */
  pode: boolean;
  /** O que escrever no lugar dele quando não pode. Vazio quando pode. */
  frase: string;
}

/**
 * Decide, para a sessão atual, se cada ação do Portal deve aparecer como botão.
 *
 * O nome da ação é o caminho tRPC **sem** o prefixo `portal.` — o mesmo texto que o servidor
 * recebe. Um nome só, sem tradução no meio, porque tradução no meio é onde as duas listas
 * divergem.
 */
export function usePodeNoPortal(): (acao: AcaoDoPortal) => VereditoNaTela {
  const { user } = useAuth();
  return (acao) => {
    const veredito = podeAgirNoPortal(user, acao);
    if (veredito.pode) return { pode: true, frase: "" };
    return {
      pode: false,
      frase:
        veredito.motivo === "SUPORTE_SO_LEITURA"
          ? EM_MODO_DE_SUPORTE
          : (SO_RESPONSAVEL_FAZ[acao] ?? "Só o responsável pela clínica faz isso"),
    };
  };
}
