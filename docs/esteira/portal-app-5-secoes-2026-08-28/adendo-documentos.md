# Adendo — a seção Documentos tem DOIS acervos, não um

- **slug:** portal-app-5-secoes-2026-08-28 · **data:** 2026-08-28
- **Origem:** ordem do dono, 28/08/2026, depois do portão visual.

## O que o dono disse

> "Não se esqueça que temos 2 tipos de DOCUMENTOS (documentos do cliente
> (clínica/médico - RG, alvará, CRM, mini currículo, etc) e documentos da
> MedConsultoria (briefing, contrato, proposta, etc))"

## Conferido no código — a distinção JÁ EXISTE, e é de fonte, não de rótulo

| | Documentos **do cliente** | Documentos **da MedConsultoria** |
|---|---|---|
| O que é | RG, CPF, CRM, alvará, mini currículo, diploma, comprovantes | briefing, proposta, contrato, recibo, escopo, ata |
| Quem produz | a clínica / o médico envia | a equipe da Med prepara |
| De onde vem | `portal.arquivos` → `PortalMeusDocumentos.tsx:17` | `portal.resumo` → `r.documentos`, usado em `PortalHome.tsx:435-442` |
| O que o cliente faz | **envia** e **remove** (`portal.removerArquivo`) | **lê**, **aceita** e **assina** |
| Já tem contexto por médico? | sim — `requisito.titulo` + médico + frente/verso (`PortalMeusDocumentos.tsx:56-60`, cicatriz da ADR-105: seis "Diploma" idênticos) | não se aplica |

O comentário de cabeçalho de `PortalMeusDocumentos.tsx:9-13` já registra a diferença por
escrito. **O redesenho não inventa a distinção — ele para de escondê-la:** hoje os dois
acervos são dois cartões distantes um do outro na mesma página comprida (linha 435 e linha
477), e o cliente não tem como saber que a lista de cima é "o que a Med te mandou" e a de
baixo é "o que você mandou para a Med".

## O que a seção `/portal/documentos` precisa fazer

1. **Dois grupos rotulados, na mesma página, nesta ordem:**
   - **"Da MedConsultoria para você"** — o que a Med preparou: ler, aceitar, assinar. Vem
     primeiro porque é o que pode estar esperando uma ação com prazo.
   - **"Seus documentos"** — o que a clínica enviou: enviar, conferir, remover.
2. **O que ainda falta enviar é um terceiro estado, dentro do segundo grupo** — não um
   grupo novo. O pedido por serviço já aparece em *Meus serviços* com o contexto; aqui ele
   entra como a lista do que a Med está esperando, para o cliente não precisar caçar.
3. ⚠️ **Nunca misture os dois numa lista só ordenada por data.** As ações são opostas —
   assinar um contrato e apagar um RG na mesma lista, com o mesmo peso visual, é como o
   cliente apaga o que não devia. A separação é a proteção, não a estética.
4. ⚠️ **O contexto por médico não pode se perder** ao mover o bloco de lugar. É a correção
   da ADR-105; sem ele a lista volta a ser seis "Diploma" iguais e o cliente remove o errado.
5. **O contador de pendência da seção**, que a `spec.md` deu como sem fonte, tem fonte para
   metade: `r.paraAssinar.length` e `r.propostas.length` (documentos da Med esperando o
   cliente). O que falta enviar já é contado em *Meus serviços* e em *Convênios* — repetir
   o mesmo número em três ícones ensina o cliente a ignorar os três.

## O que isto NÃO muda

Nenhuma regra de negócio, nenhuma consulta nova no servidor, nenhuma migração. Os dois
procedimentos tRPC já existem e já devolvem o que a tela precisa: `portal.arquivos` e
`portal.resumo`. É trabalho de organização de tela.
