# Auditoria de layout/responsividade — grupo "Configuração"

Escopo: `apps/web/src/features/ajustes/`, `apps/web/src/features/configuracoes/`,
`apps/web/src/features/sistema/`, mais os componentes compartilhados que essas telas usam
(`components/ui/modal.tsx`, `tabs.tsx`, `table.tsx`, `data-table.tsx`, `page-header.tsx`).
Só leitura — nenhum arquivo foi alterado.

Arquivos lidos por completo: `AjustesPage.tsx`, `IdentidadeDialog.tsx`, `ConfiguracoesPage.tsx`,
`ConviteLinkDialog.tsx`, `ExcluirUsuarioDialog.tsx`, `UsuarioFormDialog.tsx`, `UsuariosPage.tsx`,
`AbaAuditoria.tsx`, `MiniChart.tsx`, `SistemaPage.tsx` (1609 linhas, as 11 abas — não são 9 como
o enunciado estimava: Visão geral, Incidentes, Desempenho, Banco, Operação, Erros, Sessões,
Atividade, Manutenção, Auditoria, Privacidade). Também lidos, por serem a base de tudo: `modal.tsx`,
`tabs.tsx`, `table.tsx`, `page-header.tsx`.

**Achado de método, antes dos de layout:** `e2e/responsividade-total.spec.ts` cobre `/ajustes`,
`/usuarios`, `/configuracoes` e `/sistema` — mas só a carga inicial de cada rota. O arquivo não
clica em nenhuma aba do Sistema (só "Visão geral" roda nos 5 tamanhos; as outras 10 nunca são
medidas) nem abre nenhum dos diálogos de Ajustes (Categorias, Origens, Operadoras, Identidade) nem
os de Equipe e acessos (Convidar/Editar usuário, Excluir usuário). Ver achado A1.

---

## Achados de layout/responsividade

### [ALTO] A1 — a rede de responsividade nunca mede 10 das 11 abas de Sistema, nem os diálogos de Ajustes/Equipe
**Onde:** `e2e/responsividade-total.spec.ts` (não clica em nada, ver `grep` por `click`/`TabsTrigger` = vazio).

O teste carrega `/sistema` e mede só o que está visível por padrão — a aba "Visão geral". As
outras dez abas (Incidentes, Desempenho, Banco, Operação, Erros, Sessões, Atividade, Manutenção,
Auditoria, Privacidade) só entram na rede de proteção se alguém clicar nelas primeiro, e o
arquivo não clica. O mesmo vale para `/ajustes`: os quatro diálogos que ele abre (Categorias,
Origens, Operadoras, Identidade) nunca são medidos, nem o formulário de usuário (`UsuarioFormDialog`)
nem a exclusão (`ExcluirUsuarioDialog`) em `/usuarios`.

Isso importa porque pelo menos dois achados abaixo (A3, o `<code>` da lista de migrações; e B1,
o rótulo de configuração) só aparecem justamente nessas abas que a régua não visita — e são do
padrão que já causou bug real no projeto (ADR-129/130/136/143).

**Direção da correção:** ou o teste passa a clicar em cada `TabsTrigger` de `/sistema` antes de
medir (um `test.step` por aba, reaproveitando as mesmas 5 verificações), ou — mais barato — os
componentes fixos (`AbaManutencao`, `AbaAuditoria` etc.) ganham teste de unidade/snapshot próprio
que force a renderização com string longa. O mesmo para os diálogos de `/ajustes` e `/usuarios`:
abrir cada um com `getByRole("button", { name: ... }).click()` antes das checagens de overflow.

---

### [MÉDIO] A2 — nome de migração sem `min-w-0`: `truncate` presente mas inoperante
**Onde:** `apps/web/src/features/sistema/SistemaPage.tsx:1586-1590` (`AbaManutencao`, seção "Migrações do banco").

```tsx
<li key={mg.nome} className="flex items-center justify-between gap-3 px-4 py-2.5 text-sm">
  <code className="truncate text-xs">{mg.nome}</code>
  <span className="shrink-0 text-xs text-muted-foreground">
    {mg.aplicadaEm ? dataHora(mg.aplicadaEm) : "pendente"}
  </span>
</li>
```

`mg.nome` é o nome de arquivo da migração — uma única "palavra" sem espaço, e comprida de
verdade: o próprio `docs/CLAUDE.md` deste projeto cita nomes como
`20260902000000_faturamento_percentual_e_condicao_pagamento` (56 caracteres). Em flexbox, um item
sem `min-w-0` mantém como largura mínima o seu min-content — que para uma string sem ponto de
quebra é a string inteira — mesmo tendo `truncate` (`overflow-hidden`+`text-overflow:ellipsis`+
`whitespace-nowrap`) na classe. Resultado: em 360/390px o `<code>` empurra a `<li>` e estoura a
largura do cartão/página em vez de cortar com reticências — exatamente o padrão que a ADR-129
("`min-width:auto` do Flexbox") e a ADR-143 já documentaram como causa raiz de vazamento.

Este é um dos casos que a lacuna A1 esconde: a aba "Manutenção" nunca é visitada pela suíte de
responsividade.

**Direção da correção:** `<code className="min-w-0 flex-1 truncate text-xs">` (mesma receita já
usada em `OperadorasDialog.tsx:237` — `min-w-0 flex-1 truncate`).

---

### [BAIXO] B1 — mesmo padrão, risco menor: `ConfigLinha` (aba Manutenção)
**Onde:** `apps/web/src/features/sistema/SistemaPage.tsx:1602-1608`.

```tsx
function ConfigLinha({ rotulo, valor }: { rotulo: string; valor: string }) {
  return (
    <div className="flex items-center justify-between gap-3 border-b border-dashed py-1 last:border-0 sm:border-0">
      <span className="text-muted-foreground">{rotulo}</span>
      <span className="truncate font-medium">{valor}</span>
    </div>
  );
}
```

Mesma falta de `min-w-0` no `<span>` de `valor`. Um dos valores é
`conf.data.webOrigin` (linha 1564), que em produção é uma URL como
`https://workspace.medconsultoria.com.br` — uma palavra sem quebra, ~38 caracteres. Em 360px,
dentro do grid de uma coluna (o `sm:grid-cols-2` só liga a partir de 640px), a linha some da
largura confortável e o valor pode não caber, sem cortar como o `truncate` promete. Gravidade
baixa porque a string cabe folgada na maioria dos tamanhos, mas é o mesmo defeito estrutural do
A2 — e também vive numa aba que a rede de e2e não visita (A1).

**Direção da correção:** `<span className="min-w-0 flex-1 truncate text-right font-medium">`, e
`<span className="shrink-0 text-muted-foreground">{rotulo}</span>` no primeiro (para o rótulo não
disputar espaço).

---

### [BAIXO] B2 — texto de atividade sem `min-w-0` (risco só teórico)
**Onde:** `apps/web/src/features/sistema/SistemaPage.tsx:1231-1238` (`AbaAtividade`).

```tsx
<li key={a.id} className="flex items-center gap-3 px-4 py-2.5 text-sm">
  <Activity className="h-4 w-4 shrink-0 text-muted-foreground" />
  <span className="flex-1">
    <span className="font-medium">{a.user?.nome ?? "Sistema"}</span>{" "}
    <span className="text-muted-foreground">{a.acao}</span>
    {a.entidadeTipo && <span className="text-muted-foreground"> · {a.entidadeTipo}</span>}
  </span>
  <span className="shrink-0 text-xs text-muted-foreground">{haQuanto(a.createdAt)}</span>
</li>
```

`flex-1` sem `min-w-0`. Diferente de A2/B1, aqui o conteúdo é frase em português com espaços
(nome + ação + entidade), então o texto quebra linha normalmente em vez de forçar overflow — só
estouraria com uma "palavra" isolada anormalmente longa (ex.: nome de e-mail gigante sem espaço).
Registro por precaução/consistência, não por reprodução confirmada.

**Direção da correção:** acrescentar `min-w-0` ao `<span className="flex-1">` por hábito
defensivo (custo zero, consistente com o padrão do resto do projeto).

---

## O que foi conferido e está correto (vale registrar, para não repetir a varredura)

- **`Modal`** (`components/ui/modal.tsx`): estrutura cabeçalho fixo / corpo rolável / rodapé fixo,
  `max-h-[95vh]`, botão de fechar com alvo de 44px no celular (`h-11 w-11 ... md:h-8 md:w-8`).
  Nenhum modal do grupo (`IdentidadeDialog` `size="lg"`, `UsuarioFormDialog`, `ExcluirUsuarioDialog`,
  `ConviteLinkDialog`) tem largura fixa nem conteúdo que não caiba em 360px — todos usam
  `grid sm:grid-cols-N` que colapsa para uma coluna abaixo de 640px.
- **`TabsList`** (`components/ui/tabs.tsx`): já tem `data-rolagem-horizontal` correto e
  `overflow-x-auto` com scrollbar escondida — as 11 abas de Sistema rolam de lado em vez de
  quebrar linha ou estourar. Comportamento certo, mesmo sem prova por e2e (A1).
- **`Table`/`THead`/`TH`/`TR`/`TD`** (`components/ui/table.tsx`), usado cru em `AbaAuditoria.tsx`
  (as tabelas "Quem pode chamar o quê" e "Por onde começar"): já embrulhado em
  `<div data-rolagem-horizontal className="overflow-x-auto ...">`. Correto.
- **`DataTable`** (usado em `UsuariosPage`, `AbaDesempenho`/`AbaBanco`/`AbaSessoes`/`AbaPrivacidade`
  de Sistema): colunas menos essenciais marcadas `ocultaEmCelular`, coluna principal com `truncate`
  onde precisa — nenhuma coluna nova quebra o padrão já estabelecido.
- **`ConviteLinkDialog`**: link comprido tratado certo — `min-w-0 flex-1 truncate` no `<code>`
  (linha 57) já segue a receita correta.
- **`PageHeader`** com os 4 botões de `/sistema` (Diagnóstico IA, Varredura, Copiar diagnóstico,
  Baixar diagnóstico): `flex-wrap` + `sm:justify-end`, testado mentalmente contra 360px — os 4
  botões quebram em duas linhas sem cortar texto nem vazar.
- **`ConfiguracoesPage`**: toggle de e-mail com alvo de toque ampliado via pseudo-elemento
  (`before:-inset-2.5`) para bater 44px sem alargar o visual — boa prática já presente.
- **Grade de uptime 90 dias** (`AbaIncidentes`, linha 595): `flex items-end gap-[3px]` com 90
  `<span>` vazios `flex-1` — sem risco de vazamento porque não há conteúdo/texto dentro, só cor.

## Achados de regra de negócio (fora do escopo de layout, registrados à parte)

- **`AbaAuditoria.tsx` é um "documento carimbado"** datado de **22 de agosto de 2026** (constante
  `DATA`), mas a sessão atual do projeto (ver `docs/CLAUDE.md`) já está em 11 de setembro, com
  múltiplas publicações e ADRs posteriores (a IA trocou de OpenAI para Gemini, por exemplo — texto
  disso só aparece remendado dentro do array `PLANO`, linha 259, como nota entre colchetes). Isso é
  intencional por desenho (o comentário no topo do arquivo explica que é instantâneo, não painel ao
  vivo) — não é bug de layout, mas vale um aviso: o arquivo está ~3 semanas mais velho que o antes
  do texto sugere, e a nota de "[SUPERADO...]" colada dentro de uma frase é uma forma frágil de
  manter isso atualizado. Fora do escopo desta auditoria (só layout); repasso para quem cuidar de
  conteúdo/precisão factual.

---

## Resumo

**4 achados de layout** (nenhum crítico): 1 alto (lacuna de cobertura de teste — A1), 1 médio
(vazamento real de `min-w-0`/`truncate` na aba Manutenção — A2), 2 baixos (mesmo padrão, risco
menor — B1, B2). Mais 1 achado de conteúdo (fora do escopo de layout) sobre a data da auditoria
carimbada.

**Os mais graves:**
1. **A1** — a suíte `responsividade-total.spec.ts` só mede a aba padrão de `/sistema` e a tela
   inicial de `/ajustes`/`/usuarios`; as outras 10 abas do Sistema e os 6 diálogos nunca são
   medidos em nenhum dos 5 tamanhos — é por isso que A2 sobreviveu sem ser pego.
2. **A2** — nome de migração (`<code>{mg.nome}</code>`) sem `min-w-0` na aba Manutenção: `truncate`
   está presente mas não funciona em flexbox sem ele, e o texto real do projeto (nomes de migração
   de 50+ caracteres) é exatamente o caso que estoura em 360/390px.
3. **B1** — mesmo defeito estrutural em `ConfigLinha` (valor `webOrigin`), risco menor por a
   string normalmente caber.

O resto do grupo (Modal, Tabs, Table, DataTable, os formulários de usuário, ConviteLinkDialog,
PageHeader) já segue os padrões corretos estabelecidos pelas ADR-129/130/136/143.
