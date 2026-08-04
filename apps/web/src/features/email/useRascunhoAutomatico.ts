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
 * 1. `aoComecarEnvio` cancela o timer de 5s ANTES do e-mail sair — sem isto, um envio lento (SMTP
 *    + cópia em Enviados + marcar respondida, medido em 6-7s contra o servidor real) deixa o
 *    timer disparar NO MEIO do envio e gravar um rascunho que ninguém mais remove.
 * 2. `descartarAposEnvio` apaga, no servidor, o rascunho da composição que acabou de sair — sem
 *    isto, todo e-mail que passou 5s parado antes de enviar (inclusive só de pré-preenchimento de
 *    Responder/Encaminhar, ou a pessoa pausando pra pensar) deixa uma cópia desatualizada para
 *    sempre em Rascunhos — que dá pra reabrir no webmail e reenviar pela metade.
 * 3. `emVoo` garante que NUNCA duas gravações rodam ao mesmo tempo — sem isto, fechar a tela
 *    enquanto a gravação do timer ainda está em voo (6-7s contra IMAP real) dispara uma segunda
 *    gravação com `uidAnterior` desatualizado (ou ainda `null`), duplicando o rascunho no servidor.
 *
 * Limitação aceita, não resolvida aqui (fora do que a revisão pediu): se uma gravação já estava
 * em voo no exato instante do clique em "Enviar" — a única forma de isso acontecer é o debounce
 * disparar nos ~5s finais antes do clique —, ela pode terminar DEPOIS do `descartarAposEnvio` já
 * ter rodado, deixando o rascunho dela órfão. Resolver isso por completo pediria um token de
 * geração (marcar toda gravação em voo como "obsoleta" assim que o envio começa) — engenharia a
 * mais para uma janela de milissegundos que a revisão não apontou.
 */
export function useRascunhoAutomatico(opts: {
  /** Há conteúdo de verdade para justificar uma gravação (ver `temConteudoParaRascunho`). */
  temConteudo: () => boolean;
  /** Monta o payload ATUAL (sem `uidAnterior` — o hook decide isso sozinho). */
  compor: () => RascunhoComposicao;
  salvar: SalvarRascunhoFn;
  descartar: DescartarRascunhoFn;
}) {
  const uidRef = useRef<number | null>(null);
  const emVooRef = useRef(false);
  const timerRef = useRef<number | null>(null);

  const salvarAgora = () => {
    timerRef.current = null;
    if (emVooRef.current) return; // já tem gravação em voo — nunca sobrepõe (achado 3)
    if (!opts.temConteudo()) return; // nada digitado — não cria rascunho em branco
    emVooRef.current = true;
    opts
      .salvar({ ...opts.compor(), uidAnterior: uidRef.current ?? undefined })
      .then((r) => {
        uidRef.current = r.uid;
      })
      .catch(() => {
        /* rascunho é detalhe: a próxima tentativa (5s depois, ou ao fechar) resolve sozinha */
      })
      .finally(() => {
        emVooRef.current = false;
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

  /** Chamar ANTES de mandar o e-mail (achado 1): nenhuma gravação nova pode nascer após o clique. */
  const aoComecarEnvio = () => {
    cancelarPendente();
  };

  /** Chamar no `onSuccess` do envio (achado 2): apaga o rascunho da composição que acabou de sair. */
  const descartarAposEnvio = () => {
    cancelarPendente();
    const uid = uidRef.current;
    uidRef.current = null;
    if (uid !== null) {
      opts.descartar(uid).catch(() => {
        /* órfão cosmético — não vale falhar um envio que já saiu por causa disso */
      });
    }
  };

  return { agendar, cancelarPendente, aoFechar, aoComecarEnvio, descartarAposEnvio };
}
