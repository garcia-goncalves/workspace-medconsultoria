import { useEffect, useRef } from "react";
import type { Socket } from "socket.io-client";

/**
 * TEMPO REAL. Em produção a hospedagem (LiteSpeed/TineHost) não faz upgrade de WebSocket e
 * bufferiza o long-polling do Socket.IO — então o tempo real é entregue por POLLING (ver `POLL`),
 * o mesmo mecanismo que Início/Sistema/Vendas já usam. O Socket.IO fica LIGADO em dev/testes (onde
 * funciona) como reforço instantâneo e DESLIGADO no build de produção, para não abrir conexões
 * long-poll que ficam penduradas no LiteSpeed sem entregar nada. Para religá-lo (ao contratar uma
 * VPS ou um serviço de tempo real externo), defina `VITE_REALTIME=1` no build.
 */
export const REALTIME_SOCKET_ENABLED = !import.meta.env.PROD || import.meta.env.VITE_REALTIME === "1";

/** Intervalos de atualização automática (ms). Curto onde a conversa está aberta; mais folgado nas listas. */
export const POLL = {
  /** Mensagens da conversa aberta — é onde o usuário está olhando agora. */
  conversaAberta: 4_000,
  /** Lista de conversas (prévia + não lidas). */
  listaConversas: 8_000,
  /** Chamado de suporte aberto no Portal do cliente. */
  suporteThread: 6_000,
  /** Lista de chamados de suporte. */
  suporteLista: 15_000,
  /** Chamados do cliente vistos pela equipe, na ficha do cliente. */
  chamadosCliente: 15_000,
  /** Sininho de notificações. */
  notificacoes: 20_000,
  /** Lista de e-mails com a página aberta. O IMAP não empurra (sem IDLE) — ver ADR-84. */
  emailLista: 30_000,
  /** Pastas: contador de não lidos. Muda devagar. */
  emailPastas: 60_000,
} as const;

let socket: Socket | null = null;
let carregando: Promise<Socket> | null = null;

/**
 * Cliente Socket.IO (singleton) — mesma origem; o cookie de sessão autentica o handshake.
 *
 * O import é DINÂMICO de propósito (19/08/2026). Antes era estático no topo deste arquivo, e
 * como o `POLL` mora aqui também, qualquer tela que só queria os intervalos arrastava a
 * biblioteca junto — inclusive o `NotificationBell`, que vive no layout e portanto está SEMPRE
 * carregado. Resultado: 93 kB de `socket.io-client` + `engine.io-client` no pacote principal de
 * PRODUÇÃO, onde o socket está desligado e nunca abre conexão. Agora o módulo só é buscado
 * quando alguém de fato liga o tempo real; em produção ele nunca é baixado.
 */
export async function getSocket(): Promise<Socket> {
  if (socket) return socket;
  carregando ??= import("socket.io-client").then(({ io }) => {
    socket = io({ withCredentials: true });
    return socket;
  });
  return carregando;
}

/**
 * Assina um evento de tempo real, com o gate de produção embutido.
 *
 * Os quatro consumidores repetiam o mesmo bloco — checar o gate, pegar o socket, `.on`, e
 * `.off` na limpeza. Repetição de guarda é guarda que um dia alguém esquece; aqui é impossível
 * assinar sem passar pelo `REALTIME_SOCKET_ENABLED`.
 *
 * O `aoReceber` vai por ref: o efeito não precisa dele nas dependências, então não há mais
 * `eslint-disable exhaustive-deps` nos consumidores, e o callback nunca fica velho.
 */
export function useEventoRealtime<P = unknown>(evento: string, aoReceber: (payload: P) => void): void {
  const ref = useRef(aoReceber);
  ref.current = aoReceber;

  useEffect(() => {
    if (!REALTIME_SOCKET_ENABLED) return; // em produção o polling entrega; ver POLL acima
    let vivo = true;
    let s: Socket | undefined;
    // O socket tipa o ouvinte como `(...args: any[])`; o cast estreita para o payload que o
    // chamador declarou, num ponto só, em vez de espalhar `any` pelos consumidores.
    const ouvinte = ((payload: P) => ref.current(payload)) as (...args: unknown[]) => void;

    // O import é assíncrono: a tela pode desmontar antes de resolver. Sem o `vivo`, ficaria um
    // ouvinte pendurado num socket que ninguém mais desliga.
    void getSocket().then((sock) => {
      if (!vivo) return;
      s = sock;
      sock.on(evento, ouvinte);
    });

    return () => {
      vivo = false;
      s?.off(evento, ouvinte);
    };
  }, [evento]);
}
