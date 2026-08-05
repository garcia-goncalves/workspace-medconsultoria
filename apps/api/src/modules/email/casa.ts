import { prisma } from "@app/db";
import { normalizarEndereco } from "./enderecos.js";

/**
 * Endereços que pertencem à CASA — os que **nunca** podem virar chave de uma consulta escolhida
 * pelo cadastro (ADR-97).
 *
 * O problema que este arquivo existe para fechar: `Cliente.email` e `Contato.email` são graváveis
 * por qualquer FUNCIONARIO, e o cliente do Portal edita o próprio e-mail. Como a ficha resolve o
 * vínculo por JOIN no endereço, **quem edita o cadastro escolhe a chave da consulta**. Sem trava,
 * basta pôr um endereço nosso no cadastro de um cliente descartável para ler, pela ficha, o
 * metadado e o trecho da correspondência de um colega — ou, pelo Portal, os e-mails transacionais
 * mandados a uma conta interna.
 *
 * Por endereço exato NÃO basta: `comercial@`, `contato@`, `financeiro@`, um apelido (`thiago@` ao
 * lado de `thiago.garcia@`) e o `fulano+algo@` não têm `User` nem caixa plugada e passariam.
 * Por isso a regra é por **domínio**: endereço em domínio da casa nunca é chave. Cliente de
 * verdade não tem e-mail no nosso domínio — quem tiver está cadastrado errado, e o preço de
 * recusá-lo é uma ficha vazia, não uma caixa alheia aberta.
 */

/**
 * Provedor público jamais vira "domínio da casa" — senão, no dia em que alguém plugar (ou logar
 * com) um Gmail, TODO cliente com Gmail sumiria da ficha de uma vez.
 */
const PROVEDORES_PUBLICOS = new Set([
  "gmail.com",
  "googlemail.com",
  "hotmail.com",
  "hotmail.com.br",
  "outlook.com",
  "outlook.com.br",
  "live.com",
  "msn.com",
  "yahoo.com",
  "yahoo.com.br",
  "icloud.com",
  "me.com",
  "uol.com.br",
  "bol.com.br",
  "terra.com.br",
  "ig.com.br",
  "globo.com",
]);

function dominioDe(endereco: string): string {
  return endereco.slice(endereco.lastIndexOf("@") + 1);
}

export interface Casa {
  enderecos: Set<string>;
  dominios: Set<string>;
}

/**
 * `role: { not: CLIENTE }` NÃO é detalhe: o cliente do Portal também tem `User`, e sem esse filtro
 * a ficha de todo cliente com acesso ao Portal ficaria vazia. Ninguém se esconde aqui criando um
 * `User` CLIENTE com o e-mail de um colega — `User.email` é único.
 *
 * Caixa desplugada e usuário desativado continuam contando de propósito: endereço que um dia foi
 * da casa não pode ser reciclado como chave.
 */
export async function carregarCasa(): Promise<Casa> {
  const [users, caixas] = await Promise.all([
    prisma.user.findMany({ where: { role: { not: "CLIENTE" } }, select: { email: true } }),
    prisma.caixaEmail.findMany({ select: { email: true, usuario: true } }),
  ]);

  const enderecos = new Set<string>();
  const dominios = new Set<string>();
  for (const bruto of [...users.map((u) => u.email), ...caixas.flatMap((c) => [c.email, c.usuario])]) {
    const e = bruto ? normalizarEndereco(bruto) : "";
    if (!e) continue;
    enderecos.add(e);
    // Usuário de login sem `@` (alguns servidores usam só o nome) não diz nada sobre domínio.
    if (!e.includes("@")) continue;
    const d = dominioDe(e);
    if (d && !PROVEDORES_PUBLICOS.has(d)) dominios.add(d);
  }
  return { enderecos, dominios };
}

export function ehEnderecoDaCasa(endereco: string, casa: Casa): boolean {
  const e = normalizarEndereco(endereco);
  return casa.enderecos.has(e) || casa.dominios.has(dominioDe(e));
}

/** Atalho para quem tem UM endereço a conferir (o `para` do histórico automático). */
export async function ehDaCasa(endereco: string | null | undefined): Promise<boolean> {
  if (!endereco) return false;
  return ehEnderecoDaCasa(endereco, await carregarCasa());
}

/** Tira os endereços da casa e aplica o teto. Lista vazia aqui = nenhuma consulta lá na frente. */
export async function soDeFora(enderecos: string[], maximo: number): Promise<string[]> {
  if (enderecos.length === 0) return [];
  const casa = await carregarCasa();
  return enderecos.filter((e) => !ehEnderecoDaCasa(e, casa)).slice(0, maximo);
}
