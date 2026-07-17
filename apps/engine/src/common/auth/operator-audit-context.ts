export interface EngineOperatorAuditContext {
  readonly actor: "tailscale-operator";
}

export function tailscaleOperatorAuditContext(): EngineOperatorAuditContext {
  return { actor: "tailscale-operator" };
}

export function operatorAuditActor(context: EngineOperatorAuditContext): string {
  return context.actor;
}
