import { useCallback } from "react";
import { useNavigate, useSearch } from "@tanstack/react-router";
import { limparBusca, type BuscaFinanceiro } from "./busca-na-url";

/**
 * Lê e escreve o estado do Financeiro na URL (ver `busca-na-url.ts`).
 *
 * ⚠️ UMA chamada de `atualizar` por gesto, com tudo o que muda junto (ex.: trocar o filtro E
 * voltar para a página 1). Duas chamadas seguidas podem ler o MESMO endereço de partida, e a
 * segunda desfaz a primeira — o filtro "volta" sozinho sem ninguém entender por quê.
 *
 * Filtro SUBSTITUI a entrada do histórico (voltar não desfaz filtro por filtro); trocar de aba
 * cria entrada nova, para o "voltar" do navegador devolver a aba anterior.
 *
 * Arquivo separado de `busca-na-url.ts` de propósito: aquele é importado pelo roteador, e este
 * lê os tipos do roteador — juntos, formariam um ciclo de tipos.
 */
export function useBuscaFinanceiro() {
  const busca = useSearch({ from: "/financeiro" });
  const navigate = useNavigate({ from: "/financeiro" });

  const atualizar = useCallback(
    (mudancas: BuscaFinanceiro, opcoes?: { novaEntrada?: boolean }) => {
      void navigate({
        search: (atual: BuscaFinanceiro) => limparBusca({ ...atual, ...mudancas }),
        replace: !opcoes?.novaEntrada,
      });
    },
    [navigate],
  );

  return [busca, atualizar] as const;
}
