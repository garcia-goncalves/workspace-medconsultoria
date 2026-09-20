import { useEffect, useState } from "react";

/**
 * O que a pessoa digitou, e o que de fato vai para o servidor — separados por uma pausa.
 *
 * ⚠️ Existe por causa da Conciliação, e o motivo é mais caro do que "uma requisição a mais por
 * tecla": para responder a busca, o servidor **monta a conciliação inteira e soma os totais antes
 * de paginar**. Digitar "Maria" eram cinco varreduras completas do cliente, num pool de 13
 * conexões que já esgotou em produção.
 *
 * E o efeito na tela era pior que o custo: sem valor anterior preservado, a tabela voltava ao
 * esqueleto a cada tecla e o "Nenhuma cirurgia" piscava no meio da digitação — que se lê como
 * "não achei", quando na verdade ainda não se procurou.
 *
 * Devolve `[texto, setTexto, textoAdiado]`: o campo usa os dois primeiros (para responder na
 * hora), a consulta usa o terceiro.
 */
export function useBuscaAdiada(pausaMs = 350): [string, (v: string) => void, string] {
  const [texto, setTexto] = useState("");
  const [adiado, setAdiado] = useState("");

  useEffect(() => {
    // Campo limpo não espera: apagar a busca precisa devolver a lista cheia na hora, senão
    // parece que o "limpar" não funcionou.
    if (texto === "") {
      setAdiado("");
      return;
    }
    const t = setTimeout(() => setAdiado(texto), pausaMs);
    return () => clearTimeout(t);
  }, [texto, pausaMs]);

  return [texto, setTexto, adiado];
}
