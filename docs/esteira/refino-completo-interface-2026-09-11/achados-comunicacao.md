# Achados de responsividade — grupo Comunicação (E-mail / Mensagens)

Auditoria só de leitura, 11/09/2026. Escopo: `apps/web/src/features/email/`,
`apps/web/src/features/emails/`, `apps/web/src/features/mensagens/`, mais os componentes
compartilhados que essas telas usam (`components/ui/modal.tsx`, `components/EmailsEnviadosList.tsx`).

Arquivos lidos por completo: `EmailPage.tsx`, `CorpoEmail.tsx`, `Escrever.tsx`,
`AdicionarCaixaDialog.tsx`, `ReconectarCaixaDialog.tsx`, `EmailsAdminPage.tsx`,
`EmailsEnviadosMonitorPage.tsx`, `MensagensPage.tsx`, `NovaConversaDialog.tsx`,
`ConversaInfoDialog.tsx`, `EmailsEnviadosList.tsx`, `modal.tsx`, e
`e2e/responsividade-total.spec.ts`.

**Resumo do estado geral:** este grupo já passou por refino de responsividade em rodadas
anteriores (ADR-129/136/143) — as duas telas principais (`EmailPage`, `MensagensPage`) seguem
corretamente o padrão de duas/três colunas que colapsa para uma no celular (`md:flex`/`hidden
md:flex`, divisor arrastável só em desktop, `Sheet` no lugar do `aside` no celular). Não há
vazamento clássico de card nem `<select>` com `w-auto` neste grupo. Os achados reais são mais
sutis: uma ação que fica **inalcançável no toque** (não é só cosmético) e uma lacuna na régua de
teste automatizado.

---

## 🔴 ALTA — ação inacessível em tela de toque (bug funcional, não só visual)

### 1. Editar/apagar a própria mensagem é impossível no celular e no tablet

`apps/web/src/features/mensagens/MensagensPage.tsx:409-414`

```tsx
{minha && !apagada && !editando && (
  <div className="flex gap-0.5 self-center opacity-0 transition-opacity group-hover/msg:opacity-100">
    <button onClick={() => (setEditId(m.id), setEditTexto(m.conteudo))} ...><Pencil .../></button>
    <button onClick={() => confirmarApagarMsg(m)} ...><Trash2 .../></button>
  </div>
)}
```

Os dois botões (editar e remover a própria mensagem) só aparecem em `:hover` do balão
(`group-hover/msg`), **sem nenhum gate de breakpoint**. Dispositivo de toque não tem `:hover`
persistente — o navegador simula um hover fantasma no primeiro toque, que geralmente é
consumido pelo próprio toque que teria que acionar o botão. Na prática, em celular/tablet os
dois botões nunca ficam visíveis o suficiente para o dedo mirar neles: a pessoa não consegue
editar nem apagar a própria mensagem pelo toque.

A prova de que isto é evitável está na própria página: o botão "⋮" (Opções) da lista de
conversas, 130 linhas acima, resolve exatamente o mesmo problema com o padrão certo:

```
apps/web/src/features/mensagens/MensagensPage.tsx:278
className="... opacity-100 hover:bg-accent md:opacity-0 md:group-hover:opacity-100"
```

Visível por padrão (`opacity-100`) e só vira "hover-only" a partir de `md:`. O
editar/apagar da mensagem deveria seguir o mesmo padrão.

**Direção da correção:** trocar `opacity-0 ... group-hover/msg:opacity-100` por
`opacity-100 md:opacity-0 transition-opacity md:group-hover/msg:opacity-100` (ou, melhor ainda
para toque, exibir ao tocar a própria mensagem — mas o mínimo que já resolve é o mesmo padrão do
botão de opções). Também vale medir o alvo de toque resultante: hoje cada botão é `rounded p-1`
com ícone `h-3 w-3` — por volta de 20×20px, bem abaixo do alvo mínimo de ~44px que o resto do
app usa (`h-11`/`min-h-11`); ao tornar os botões visíveis por padrão no celular, aumentar o
padding junto.

---

## 🟡 MÉDIA

### 2. Mensagem sem espaço (URL longa, código, etc.) pode estourar o balão

`apps/web/src/features/mensagens/MensagensPage.tsx:439`

```tsx
<p className="whitespace-pre-wrap">{m.conteudo}</p>
```

O balão tem `max-w-[72%]` (linha 418), mas é filho de um contêiner `flex` (`flex items-end
gap-2`, linha 408) sem `min-w-0` nele — e o próprio balão tampouco tem `break-words`/
`overflow-wrap`. Um flex item, por padrão, tem `min-width: auto`, ou seja, o navegador nunca o
encolhe abaixo do conteúdo intrínseco. `whitespace-pre-wrap` só quebra linha em espaços — uma
mensagem de uma palavra só (uma URL longa, um hash, um número de protocolo colado sem espaço)
não quebra e força o balão para além dos 72%, criando rolagem horizontal **dentro** da área de
mensagens (que tem `overflow-auto`, então não vaza para a página inteira, mas produz uma barra
de rolagem lateral dentro do chat e corta a leitura). É o mesmo padrão de defeito da
ADR-129/143 (`min-w-0` ausente em filho de flex/grid), agora em texto de usuário livre em vez de
card de sistema.

**Direção da correção:** acrescentar `break-words` (ou `overflow-wrap: anywhere`) na classe do
balão de mensagem — mesma técnica já usada, por exemplo, em `guardarAnexo`/anexos do e-mail
(`truncate` + `max-w`), só que aqui a mensagem precisa **quebrar**, não truncar (não dá para
cortar o conteúdo de uma conversa). O texto citado do e-mail encaminhado tem o mesmo risco
(`EmailsEnviadosList.tsx:96` e `CorpoEmail.tsx:34`, o `<pre>` do corpo em texto puro), mas
nesses dois casos o contêiner pai tem `overflow-hidden`, então o efeito fica contido — ainda
assim vale considerar `break-words` ali também, para não cortar texto útil em silêncio.

### 3. `e2e/responsividade-total.spec.ts` não roda a checagem de alvo de toque nas rotas internas — inclusive `/email` e `/mensagens`

`e2e/responsividade-total.spec.ts:272-278`

```ts
const ehMobile = vp.w === 360 || vp.w === 390;
if (opts.portal && ehMobile) {
  await verificarAlvosDeToque(page, url, vp.nome);
}
if (opts.portal && vp.w === 360) {
  await verificarTextoNaoCortado(page, url, vp.nome);
}
```

`/email` e `/mensagens` **estão** na lista de rotas internas (`ROTAS_INTERNAS`, linhas 72-73) e
são exercidas nos 5 tamanhos para overflow/estouro/console — mas a checagem de **alvo de toque
mínimo (44×44px)** e a de **texto cortado** só rodam quando `opts.portal === true`, isto é,
nunca para a área interna. Isso explica por que os botões pequenos deste grupo (o "Desconectar"
da caixa, o link "Reconectar", o "⋮" das conversas) nunca foram pegos por teste: a régua que os
pegaria simplesmente não roda ali. E o achado 1 acima (`opacity-0` sem hover em toque) não seria
pego de qualquer forma — o `getBoundingClientRect` do Playwright devolve tamanho não-zero mesmo
com `opacity: 0`, então nem a checagem de toque, se estivesse ligada, apontaria o problema (é
questão de visibilidade condicional, não de tamanho).

**Direção da correção:** não é escopo desta auditoria decidir se a checagem de toque deve
valer para toda a área interna (pode ter sido decisão deliberada, para não reprovar dezenas de
telas de uma vez) — mas vale registrar como lacuna consciente: enquanto ficar restrita ao
Portal, a área interna (E-mail e Mensagens inclusas) não tem rede de proteção nenhuma contra
alvo de toque pequeno.

---

## 🟢 BAIXA

### 4. Botões pequenos abaixo do padrão de alvo de toque do resto do app

- `apps/web/src/features/email/EmailPage.tsx:407-415` — botão "Desconectar" da caixa
  (`Unplug`), `p-2` no celular (`sm:p-1.5` no desktop) → por volta de 30×30px com o ícone
  `h-3.5 w-3.5`. Ação destrutiva (remove a senha guardada), vale mirar no `h-11`/`min-h-11` que
  o resto do app usa para toque.
- `apps/web/src/features/email/EmailPage.tsx:437-447` — link "Reconectar" (texto pequeno,
  `text-xs`, sem padding vertical definido) para o estado de caixa com senha recusada. É a única
  saída da tela para aquele estado; um alvo maior ajudaria.
- `apps/web/src/features/mensagens/MensagensPage.tsx:278-280` — botão "⋮" (Opções da
  conversa), `p-1` com ícone `h-3.5 w-3.5` → também abaixo de 44px, mesmo já usando o padrão
  correto de visibilidade (`md:opacity-0`/`opacity-100` no celular).

Nenhum destes é "vazamento" de tela — são alvos pequenos numa área que já usa `h-11` em outros
lugares (ex.: `EmailsEnviadosMonitorPage.tsx`), então o padrão do próprio projeto sugere a régua
a seguir.

---

## Fora do escopo (regra de negócio, não layout)

Nada encontrado nesta rodada que fosse regra de negócio disfarçada de defeito de tela — os
comportamentos condicionais vistos (ex.: `podeGerir`, `ehAdmin`, trava de participante único em
`sobraResponsavel`, o estado `AUTENTICACAO_FALHOU` da caixa) já estão documentados em ADRs
anteriores e são intencionais.

---

## Resumo

- **4 achados** (1 alto, 1 médio de UI + 1 médio de cobertura de teste, 3 baixos agrupados num item).
- Os dois mais graves: **(1)** editar/apagar a própria mensagem é inacessível por toque
  (`MensagensPage.tsx:409-414` — falta o gate `md:` que o botão de opções da própria página já
  usa) e **(3)** a checagem de alvo de toque do `e2e/responsividade-total.spec.ts` nunca roda
  para rotas internas, incluindo `/email` e `/mensagens`, então nada disto seria pego
  automaticamente hoje.
- Terceiro em gravidade: **(2)** mensagem/URL sem espaço pode estourar o balão do chat por
  faltar `break-words` num filho de flex sem `min-w-0` — o mesmo padrão de bug já visto em
  ADR-129/143, agora em conteúdo livre do usuário.
