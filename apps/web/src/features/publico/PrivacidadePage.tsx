import type { ReactNode } from "react";
import { AlertTriangle, Loader2 } from "lucide-react";
import { AVISO_PRIVACIDADE_VERSAO } from "@app/shared";
import { trpc } from "../../lib/trpc";

/**
 * Aviso de privacidade — a página pública que não existia (LGPD, ADR-141).
 *
 * ⚠️ NADA AQUI É INVENTADO. Razão social, CNPJ, endereço, prazos de guarda e o canal do
 * encarregado vêm do banco (Ajustes → Dados da empresa), pela mesma regra do "[A PREENCHER]"
 * do foro: o sistema não fabrica dado jurídico. O que a empresa promete aqui é exatamente o
 * que o expurgo automático cumpre — mudar o prazo na tela muda os dois lados juntos.
 *
 * ⚠️ QUEM EDITAR ESTE TEXTO PRECISA SUBIR `AVISO_PRIVACIDADE_VERSAO` (@app/shared). O aceite
 * do lead grava data MAIS versão; sem subir, a prova do consentimento aponta para um texto
 * que não é mais o que ele leu.
 */
export function PrivacidadePage() {
  const q = trpc.identidade.privacidade.useQuery();

  if (q.isLoading) {
    return (
      <Casca>
        <div className="flex items-center justify-center py-16">
          <Loader2 className="h-6 w-6 animate-spin text-primary" />
        </div>
      </Casca>
    );
  }

  // Falha de rede não pode virar uma página de privacidade em branco: a pessoa concluiria
  // que a empresa não tem política nenhuma. Diz o que houve e oferece tentar de novo.
  if (q.isError || !q.data) {
    return (
      <Casca>
        <div className="rounded-xl border bg-background p-8 text-center">
          <AlertTriangle className="mx-auto mb-3 h-8 w-8 text-warning" />
          <h1 className="text-lg font-semibold">Não conseguimos carregar o aviso</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Foi a conexão com o nosso servidor que falhou. Tente de novo em alguns instantes.
          </p>
          <button
            type="button"
            onClick={() => void q.refetch()}
            className="mt-4 rounded-lg border px-4 py-2 text-sm font-medium hover:bg-muted"
          >
            Tentar de novo
          </button>
        </div>
      </Casca>
    );
  }

  const d = q.data;

  return (
    <Casca>
      <article className="space-y-6 rounded-xl border bg-background p-6 sm:p-8">
        <header className="space-y-1">
          <h1 className="text-xl font-semibold">Aviso de privacidade</h1>
          <p className="text-sm text-muted-foreground">
            Versão {AVISO_PRIVACIDADE_VERSAO}. Escrito para ser lido por quem não é advogado.
          </p>
        </header>

        <Bloco titulo="Quem trata os seus dados">
          <p>
            {d.razaoSocial ?? d.nome}
            {d.cnpj ? `, CNPJ ${d.cnpj}` : ""}
            {d.enderecoCompleto ? `, com sede em ${d.enderecoCompleto}` : ""}. Contato:{" "}
            <a className="underline" href={`mailto:${d.email}`}>
              {d.email}
            </a>
            .
          </p>
        </Bloco>

        <Bloco titulo="Que dados coletamos, e para quê">
          <ul className="list-disc space-y-1 pl-5">
            <li>
              <strong>Do formulário do site:</strong> nome, e-mail, telefone, empresa e o que você
              escreveu — para retornar o seu contato e preparar uma proposta.
            </li>
            <li>
              <strong>Do cliente contratante:</strong> razão social, CNPJ, endereço e dados de
              contato — para emitir contrato, nota e cobrança.
            </li>
            <li>
              <strong>Dos médicos, no credenciamento:</strong> nome, número do conselho, diploma e
              demais documentos exigidos pela operadora — para protocolar o credenciamento.
            </li>
          </ul>
          <p className="mt-2">
            Não tratamos prontuário, diagnóstico nem qualquer dado de paciente. Este sistema é
            administrativo.
          </p>
        </Bloco>

        <Bloco titulo="Com que base legal">
          <p>
            Execução de contrato e procedimentos preliminares a ele (LGPD, art. 7º, V) para o
            atendimento comercial e a prestação do serviço; cumprimento de obrigação legal (art. 7º,
            II) para a guarda fiscal e contratual; e o seu consentimento, quando você envia o
            formulário do site — registramos a data e a versão deste aviso que estava no ar.
          </p>
        </Bloco>

        <Bloco titulo="Por quanto tempo guardamos">
          <ul className="list-disc space-y-1 pl-5">
            <li>
              <strong>Texto dos e-mails enviados:</strong> {d.retencaoCorpoEmailDias} dias. Depois
              disso o conteúdo é apagado automaticamente; fica apenas o registro de que houve um
              envio.
            </li>
            <li>
              <strong>Documentos de credenciamento:</strong> até {d.retencaoAcervoAnos} anos após o
              fim do contrato. Passado o prazo, o sistema avisa a nossa equipe; a exclusão é
              conferida por uma pessoa, nunca automática.
            </li>
            <li>
              <strong>Contratos, notas e registros contábeis:</strong> pelo prazo exigido em lei.
              Estes não podem ser apagados a pedido, e é por isso que existe a anonimização
              descrita abaixo.
            </li>
          </ul>
        </Bloco>

        <Bloco titulo="Com quem compartilhamos">
          <p>
            Com as operadoras de saúde, quando você nos contrata para credenciar — é a finalidade do
            serviço. Com o provedor do nosso servidor de e-mail, para entregar as mensagens. E com a
            OpenAI, quando alguém da nossa equipe usa um recurso de assistência por inteligência
            artificial: antes do envio, o sistema substitui automaticamente CPF, CNPJ, número de
            conselho, RG, telefone, e-mail e CEP por marcadores, de modo que esses dados não saem
            daqui.
          </p>
          <p className="mt-2">
            Não vendemos dado pessoal, nem o cedemos para publicidade de terceiros.
          </p>
        </Bloco>

        <Bloco titulo="Os seus direitos">
          <p>
            Você pode pedir acesso, correção, portabilidade, informação sobre compartilhamentos e
            eliminação dos seus dados. Onde a lei nos obriga a guardar o documento — contrato, nota
            fiscal, processo na operadora —, atendemos o pedido de eliminação por{" "}
            <strong>anonimização</strong>: o registro contábil continua existindo, mas deixa de
            identificar você.
          </p>
        </Bloco>

        <Bloco titulo="Como falar conosco sobre dados">
          <p>
            {d.encarregadoNome ? (
              <>
                Encarregado de dados: <strong>{d.encarregadoNome}</strong>.{" "}
              </>
            ) : null}
            Escreva para{" "}
            <a className="underline" href={`mailto:${d.encarregadoEmail}`}>
              {d.encarregadoEmail}
            </a>
            . Respondemos todo pedido sobre dados pessoais por esse canal.
          </p>
        </Bloco>
      </article>
    </Casca>
  );
}

function Bloco({ titulo, children }: { titulo: string; children: ReactNode }) {
  return (
    <section className="space-y-2">
      <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
        {titulo}
      </h2>
      <div className="text-sm leading-relaxed">{children}</div>
    </section>
  );
}

function Casca({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-screen bg-muted/30 px-4 py-10">
      <div className="mx-auto w-full max-w-2xl">{children}</div>
    </div>
  );
}
