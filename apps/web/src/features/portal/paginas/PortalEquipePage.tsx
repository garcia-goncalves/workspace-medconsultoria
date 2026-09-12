import { PortalMinhaEquipe } from "../PortalMinhaEquipe";

/**
 * EQUIPE DA CLÍNICA — quem, de dentro da clínica, entra no Portal (ADR-131).
 *
 * Fica no menu do avatar, e não na barra de seções, porque é **configuração**: quem entra aqui
 * mexe nisso uma vez e volta ao que veio fazer. Um lugar na barra — que tem quatro ou cinco no
 * total — sairia caro para uma tela que se visita uma vez por semestre.
 */
export function PortalEquipePage() {
  return (
    <div className="space-y-6">
      <div className="space-y-1">
        <h1 className="text-2xl font-semibold text-primary">Equipe da clínica</h1>
        <p className="text-muted-foreground">Cada médico e cada secretária com o próprio acesso.</p>
      </div>
      <PortalMinhaEquipe />
    </div>
  );
}
