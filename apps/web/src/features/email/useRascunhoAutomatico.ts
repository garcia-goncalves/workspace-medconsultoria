import { useRef } from "react";

export type RascunhoComposicao = {
  caixaId: string;
  para: string[];
  cc: string[];
  cco: string[];
  assunto: string;
  corpoHtml: string;
};

export type SalvarRascunhoFn = (input: RascunhoComposicao & { uidAnterior?: number }) => Promise<{ uid: number | null }>;
export type DescartarRascunhoFn = (uid: number) => Promise<void>;

const ATRASO_MS = 5000;

/**
 * Gravação automática de rascunho na pasta Drafts do servidor. Extraído de `Escrever.tsx` para
 * testar isolado (funções `salvar`/`descartar` dubladas + timers falsos), sem precisar montar
 * tRPC/react-query no teste — foi o que faltou na primeira rodada e escondeu os 3 achados abaixo.
 *
 * 1. `emVoo` garante que NUNCA duas gravações rodam ao mesmo tempo (achado da rodada 1) — sem
 *    isto, fechar a tela enquanto a gravação do timer ainda está em voo (6-7s medidos contra IMAP
 *    real) dispara uma segunda gravação com `uidAnterior` desatualizado, duplicando o rascunho.
 * 2. Se `emVoo` for true quando alguém pede uma gravação (`aoFechar`, ou o timer disparando de
 *    novo), ela não é descartada — fica marcada em `pendente` e é REFEITA assim que a gravação em
 *    voo termina (`.finally`). Sem isto, digitar durante os ~6s de uma gravação e fechar em
 *    seguida perderia essas últimas edições: o rascunho no servidor ficaria na versão anterior,
 *    contra a prioridade do brief (perder texto é pior que não salvar).
 * 3. `enviando` (ligado em `aoComecarEnvio`, antes de `enviar.mutate`) cobre o envio inteiro, não
 *    só o clique: enquanto ele estiver true, nenhuma gravação NOVA começa (`salvarAgora` retorna
 *    cedo), e qualquer gravação que JÁ estivesse em voo quando o envio começou tem o UID
 *    DESCARTADO assim que resolve, em vez de guardado. Isto fecha o buraco real da rodada 2: uma
 *    gravação de ~6s que já estava em voo quando a pessoa clicou Enviar — cenário comum, não raro,
 *    já que reler o e-mail por alguns segundos antes de mandar é o padrão — não deixa mais um
 *    rascunho quase idêntico ao e-mail enviado sobrevivendo, reabrível e reenviável, em Rascunhos.
 *    Os campos do formulário não ficam desabilitados durante o envio (só o botão Enviar), então
 *    digitar durante o "Enviando…" também é coberto: o efeito de debounce re-agenda, mas
 *    `enviando` barra a NOVA gravação de sequer começar.
 *    `aoEnvioFalhou` desliga `enviando` de novo se o envio falhar — a pessoa continua na tela e os
 *    rascunhos precisam voltar a gravar normalmente.
 *
 * `opts` fica numa `ref` atualizada a cada render (`optsRef`) — não só o valor inicial —, porque
 * a gravação "refeita" do item 2 pode rodar depois que várias renderizações já aconteceram (a
 * pessoa continuou digitando enquanto a gravação original estava em voo): sem isto, a gravação
 * adiada usaria `compor()`/`temConteudo()` presos no render em que a gravação ORIGINAL começou,
 * não o conteúdo mais recente.
 */
export function useRascunhoAutomatico(opts: {
  /** Há conteúdo de verdade para justificar uma gravação (ver `temConteudoParaRascunho`). */
  temConteudo: () => boolean;
  /** Monta o payload ATUAL (sem `uidAnterior` — o hook decide isso sozinho). */
  compor: () => RascunhoComposicao;
  salvar: SalvarRascunhoFn;
  descartar: DescartarRascunhoFn;
}) {
  const optsRef = useRef(opts);
  optsRef.current = opts;

  const uidRef = useRef<number | null>(null);
  const emVooRef = useRef(false);
  const pendenteRef = useRef(false);
  const enviandoRef = useRef(false);
  const timerRef = useRef<number | null>(null);

  const salvarAgora = () => {
    timerRef.current = null;
    if (emVooRef.current) {
      pendenteRef.current = true; // adia — a versão mais nova ainda chega ao servidor (achado 2)
      return;
    }
    if (enviandoRef.current) return; // e-mail saindo (ou já saiu) — nenhuma gravação nova (achado 3)
    if (!optsRef.current.temConteudo()) return; // nada digitado — não cria rascunho em branco
    emVooRef.current = true;
    optsRef.current
      .salvar({ ...optsRef.current.compor(), uidAnterior: uidRef.current ?? undefined })
      .then((r) => {
        if (enviandoRef.current) {
          // Esta gravação já estava em voo quando o envio começou — terminou só agora. O
          // rascunho que acabou de nascer é quase idêntico ao e-mail que já saiu; descarta na
          // hora, não guarda (achado 1 da rodada 2).
          if (r.uid !== null) optsRef.current.descartar(r.uid).catch(() => {});
          uidRef.current = null;
        } else {
          uidRef.current = r.uid;
        }
      })
      .catch(() => {
        /* rascunho é detalhe: a próxima tentativa (5s depois, ou ao fechar) resolve sozinha */
      })
      .finally(() => {
        emVooRef.current = false;
        if (pendenteRef.current) {
          pendenteRef.current = false;
          salvarAgora(); // refaz com o conteúdo mais recente — nunca perde o que ficou pendente
        }
      });
  };

  const cancelarPendente = () => {
    if (timerRef.current !== null) {
      window.clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  };

  /** Reinicia o timer de 5s — chamar de um `useEffect` cujas dependências são os campos do e-mail. */
  const agendar = () => {
    cancelarPendente();
    timerRef.current = window.setTimeout(salvarAgora, ATRASO_MS);
  };

  /** Cancela o timer pendente e tenta uma última gravação síncrona — Cancelar, X, Esc, clique fora. */
  const aoFechar = () => {
    cancelarPendente();
    salvarAgora();
  };

  /**
   * Chamar ANTES de mandar o e-mail (achados 1 e 3 da rodada 2): cancela o timer pendente e liga
   * `enviando` — nenhuma gravação nova nasce daqui em diante, e a que já estiver em voo tem o UID
   * descartado assim que resolver, em vez de guardado.
   */
  const aoComecarEnvio = () => {
    cancelarPendente();
    enviandoRef.current = true;
  };

  /** Chamar no `onError` do envio: ele falhou, a pessoa continua na tela — rascunhos voltam ao normal. */
  const aoEnvioFalhou = () => {
    enviandoRef.current = false;
  };

  /** Chamar no `onSuccess` do envio (achado 2 da rodada 1): apaga o rascunho já gravado, se houver. */
  const descartarAposEnvio = () => {
    cancelarPendente();
    const uid = uidRef.current;
    uidRef.current = null;
    if (uid !== null) {
      optsRef.current.descartar(uid).catch(() => {
        /* órfão cosmético — não vale falhar um envio que já saiu por causa disso */
      });
    }
  };

  return { agendar, cancelarPendente, aoFechar, aoComecarEnvio, aoEnvioFalhou, descartarAposEnvio };
}
