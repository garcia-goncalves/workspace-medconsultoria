/**
 * QUEM É AVISADO QUANDO A EQUIPE RESPONDE UM CHAMADO (M8).
 *
 * O canal de suporte tinha só o caminho de IDA: o cliente escreve e a equipe recebe aviso
 * (`suporte`). A volta não existia — o cliente só descobria a resposta se voltasse ao Portal
 * por conta própria, e quem abre chamado costuma abrir e sair. O trabalho era feito e ficava
 * invisível para quem pediu.
 *
 * A régua é pura, e não uma consulta espalhada no serviço, porque ela responde à MESMA
 * pergunta que o painel de pessoas, o `destinatarioDeAssinatura` e a trava do responsável já
 * respondem — e a resposta certa não é `ativo`:
 *
 * ⚠️ **`ativo = false` É AMBÍGUO (ADR-131).** Conta convidada que ainda não criou senha também
 * é inativa. Quem teve o acesso ENCERRADO é quem tem `acessoRevogadoEm`. Filtrar por `ativo`
 * calaria justamente com quem foi convidado e ainda nem sabe que o Portal existe.
 */
export interface ParticipanteDoChamado {
  userId: string;
  nome: string;
  email: string | null;
  role: string;
  ativo: boolean;
  acessoRevogadoEm: Date | null;
}

export interface DestinoDoAviso {
  nome: string;
  email: string;
}

export function destinatariosDaRespostaAoCliente(
  participantes: ParticipanteDoChamado[],
  autorId: string,
): DestinoDoAviso[] {
  const vistos = new Set<string>();
  const out: DestinoDoAviso[] = [];
  for (const p of participantes) {
    if (p.role !== "CLIENTE") continue; // gente da casa já tem a conversa na tela
    if (p.userId === autorId) continue;
    if (p.acessoRevogadoEm) continue;
    const email = p.email?.trim();
    // `deleted+` é o tombstone de quem foi excluído: endereço que não é de ninguém.
    if (!email || email.startsWith("deleted+")) continue;
    const chave = email.toLowerCase();
    if (vistos.has(chave)) continue;
    vistos.add(chave);
    out.push({ nome: p.nome, email });
  }
  return out;
}
