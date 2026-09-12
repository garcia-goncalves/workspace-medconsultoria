import { config } from "../config.js";
import { apelidoHmac, cifrarCom, decifrarCom, lerChave, subchave } from "./cripto.js";

/**
 * Dado pessoal de PACIENTE que vem no relatório de produção — CPF, telefone e e-mail.
 *
 * Regra que este arquivo existe para cumprir (reunião de 11/09/2026, spec
 * `docs/superpowers/specs/2026-09-11-conciliacao-producao-design.md` §5): o arquivo é importado
 * como vem, **tudo é guardado**, e o que é dado pessoal do paciente fica **cifrado em repouso** e
 * **nunca aparece no retorno do tRPC**. O Sérgio não quer esse dado no sistema; o acordo foi
 * guardar e não exibir. Cifrar é o que faz "não exibir" valer também para um dump do banco.
 *
 * O **nome** do paciente NÃO passa por aqui: ele é exibido na tela (é o que identifica o
 * atendimento) e um nome cifrado não se ordena nem se busca. Ele é PII igualmente — fica atrás
 * da mesma autenticação do resto, e não entra em log.
 */

const FALTA_CHAVE =
  "PACIENTE_CRYPTO_KEY não configurada — o módulo de Conciliação está desligado. " +
  "Gere com: node -e \"console.log(require('crypto').randomBytes(32).toString('base64'))\"";

/** Cifra e HMAC usam subchaves DIFERENTES derivadas da mesma env — ver `subchave` em cripto.ts. */
function chaveDe(proposito: "cifra" | "apelido"): Buffer {
  const raiz = lerChave(config.PACIENTE_CRYPTO_KEY, "PACIENTE_CRYPTO_KEY", FALTA_CHAVE);
  return subchave(raiz, `conciliacao:paciente:${proposito}`);
}

/**
 * Cifra um dado pessoal do paciente. Vazio/ausente devolve `null` — a coluna fica nula em vez de
 * guardar a cifra de uma string vazia, que ocuparia espaço e mentiria dizendo "tem dado aqui".
 */
export function cifrarDadoPaciente(texto: string | null | undefined): string | null {
  const limpo = texto?.trim();
  if (!limpo) return null;
  return cifrarCom(chaveDe("cifra"), limpo);
}

/**
 * Decifra. **Não há chamador em tela para isto na Fase 1** — existe para o caso legítimo de
 * precisar devolver o dado ao próprio cliente (é dele) e para provar em teste que a ida e volta
 * fecha. Todo uso novo desta função é uma decisão de privacidade, não uma chamada de rotina.
 */
export function decifrarDadoPaciente(guardado: string): string {
  return decifrarCom(chaveDe("cifra"), guardado, {
    formato: "Formato de dado de paciente desconhecido — a linha precisa ser reimportada.",
    ilegivel:
      "O dado de paciente guardado não pôde ser aberto — a PACIENTE_CRYPTO_KEY foi trocada. " +
      "Reimporte a competência com a chave atual.",
  });
}

/**
 * Apelido determinístico do CPF, para casar o mesmo paciente entre relatórios (produção × repasse)
 * sem guardar o número em claro nem poder voltar dele para o CPF.
 *
 * Normaliza para só dígitos antes: o mesmo CPF chega `123.456.789-00` num relatório e
 * `12345678900` no outro, e sem isso os dois apelidos seriam diferentes — a conciliação não
 * casaria e ninguém saberia por quê.
 */
export function apelidoCpf(cpf: string | null | undefined): string | null {
  const digitos = (cpf ?? "").replace(/\D/g, "");
  if (!digitos) return null;
  return apelidoHmac(chaveDe("apelido"), digitos);
}
