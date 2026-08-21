/**
 * TLS do SMTP transacional — separado do `email.ts` para poder ser testado sem abrir socket.
 *
 * ⛔ POR QUE ISTO EXISTE (21/08/2026). Até esta data **nenhum e-mail transacional jamais saiu
 * de produção**: o monitor `/emails-enviados`, filtrado por "Enviados" + "Todo o período",
 * respondia "Nenhum e-mail encontrado", e cada uma das falhas trazia a mesma mensagem:
 *
 *     Hostname/IP does not match certificate's altnames:
 *     Host: localhost. is not in the cert's altnames: DNS:atena.hostsrv.org
 *
 * O `.env` do servidor aponta `SMTP_HOST=localhost`, porque na TineHost o servidor de e-mail
 * roda na MESMA máquina da aplicação. Só que o certificado apresentado no STARTTLS é o da
 * máquina física (`atena.hostsrv.org`), não "localhost" — então a checagem de nome do
 * nodemailer reprova e a conexão nem chega a autenticar. Não era senha, não era porta, não
 * era firewall: era o nome no certificado.
 *
 * O conserto NÃO é desligar a verificação de certificado. Isso trocaria "e-mail que não sai"
 * por "e-mail que pode sair para o servidor errado" — e o segundo é pior, porque é silencioso.
 * A dispensa vale **só para loopback**, onde os bytes não chegam a entrar numa rede: para
 * interceptar `127.0.0.1` já é preciso estar dentro da máquina, e quem está dentro da máquina
 * lê o `.env` direto. Para qualquer host remoto a conferência continua inteira.
 *
 * ⚠️ NÃO aplicar isto ao transporte de `modules/email/smtp.ts` (a caixa pessoal de cada
 * pessoa). Lá o host é o servidor de e-mail de verdade e a senha do webmail atravessa a
 * rede — a validação inteira é justamente o que protege aquela senha.
 */

/** Nomes que significam "a própria máquina". Comparados de forma exata, nunca por `includes`. */
const LOOPBACK = new Set(["localhost", "127.0.0.1", "::1", "[::1]", "0.0.0.0"]);

/**
 * O host configurado aponta para a própria máquina?
 *
 * Normaliza antes de comparar porque o erro real de produção veio como `localhost.` — **com
 * ponto final** (a forma absoluta de um nome DNS). Um `=== "localhost"` ingênuo não pegaria.
 * A comparação é contra um conjunto fechado: `"localhost.evil.com"` é um endereço de internet
 * de verdade e precisa continuar sendo tratado como remoto.
 */
export function ehHostLocal(host: string | undefined | null): boolean {
  if (!host) return false;
  const normalizado = host.trim().toLowerCase().replace(/\.$/, "");
  return LOOPBACK.has(normalizado);
}

/**
 * As opções de TLS do transporte, decididas pelo host.
 *
 * Devolve `{}` (nenhuma opção) para host remoto de propósito: é o padrão do nodemailer, que
 * valida cadeia **e** nome. Devolver um objeto vazio, em vez de `rejectUnauthorized: true`
 * explícito, mantém a decisão nas mãos da biblioteca caso ela endureça o padrão no futuro.
 */
export function opcoesTls(host: string | undefined | null): { tls?: { rejectUnauthorized: false } } {
  return ehHostLocal(host) ? { tls: { rejectUnauthorized: false } } : {};
}
