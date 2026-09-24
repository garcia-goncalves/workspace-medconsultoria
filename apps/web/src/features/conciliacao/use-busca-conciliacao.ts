import { useCallback } from "react";
import { useNavigate, useSearch } from "@tanstack/react-router";
import { limparBusca, type BuscaConciliacao } from "./busca-na-url";

/**
 * Lê e escreve o estado da Conciliação na URL (ver `busca-na-url.ts`).
 *
 * ⚠️ UMA chamada de `atualizar` por gesto, com tudo o que muda junto. Duas chamadas seguidas
 * (limpar o mês e depois a operadora, por exemplo) podem ler o MESMO endereço de partida, e a
 * segunda desfaz a primeira — o filtro "volta" sozinho sem ninguém entender por quê.
 *
 * Filtro SUBSTITUI a entrada do histórico (voltar não desfaz filtro por filtro); escolher o
 * cliente cria entrada nova, para o "voltar" do navegador devolver a visão geral.
 *
 * Arquivo separado de `busca-na-url.ts` de propósito: aquele é importado pelo roteador, e este
 * lê os tipos do roteador — juntos, formariam um ciclo de tipos.
 */
export function useBuscaConciliacao() {
  const busca = useSearch({ from: "/conciliacao" });
  const navigate = useNavigate({ from: "/conciliacao" });

  const atualizar = useCallback(
    (mudancas: BuscaConciliacao, opcoes?: { novaEntrada?: boolean; substituirTudo?: boolean }) => {
      void navigate({
        search: (atual: BuscaConciliacao) => limparBusca(opcoes?.substituirTudo ? mudancas : { ...atual, ...mudancas }),
        replace: !opcoes?.novaEntrada,
      });
    },
    [navigate],
  );

  return [busca, atualizar] as const;
}
