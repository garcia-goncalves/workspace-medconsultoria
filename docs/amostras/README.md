# docs/amostras — arquivos reais do cliente (NÃO versionados)

Esta pasta é o lugar onde ficam as **amostras reais** dos relatórios que alimentam o módulo
de Conciliação. Tudo aqui, exceto este README, está no `.gitignore`.

**Por quê:** os relatórios trazem nome, **CPF, telefone e e-mail de paciente**. Commitar um
deles põe dado de gente de verdade no histórico do git para sempre — `rm` não desfaz. Mesma
decisão já tomada para `brand/identidade/` em 11/08/2026.

## O que colocar aqui

Da reunião de 11/09/2026 (grupo DVS), os dois documentos que a Thaís enviou:

| Arquivo                                | O que é                            | De onde sai             |
| -------------------------------------- | ---------------------------------- | ----------------------- |
| `consultas-<AAAA-MM>.<xlsx\|csv\|pdf>` | Relatório de produção de consultas | "plataforma das Nuvens" |
| `descricao-cirurgica-<referência>.pdf` | Descrição Cirúrgica (2 páginas)    | TASY                    |

Se vierem como print/imagem, ponha a imagem mesmo — ela já diz o cabeçalho e o formato, e
isso é o que trava o importador.

## O que vai para o repositório

Só **fixture sintética**: `apps/api/src/test/fixtures/`, com as mesmas colunas e CPF/telefone/
e-mail inventados. É contra ela que os testes do parser rodam.
