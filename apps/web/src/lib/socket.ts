import { io, type Socket } from "socket.io-client";

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
} as const;

let socket: Socket | null = null;

/** Cliente Socket.IO (singleton) — mesma origem; o cookie de sessão autentica o handshake. */
export function getSocket(): Socket {
  if (!socket) {
    socket = io({ withCredentials: true });
  }
  return socket;
}
