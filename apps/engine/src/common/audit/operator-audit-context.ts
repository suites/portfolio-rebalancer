export interface EngineOperatorAuditContext {
  readonly actor: "local-console";
}

export function localConsoleAuditContext(): EngineOperatorAuditContext {
  return { actor: "local-console" };
}

export function operatorAuditActor(context: EngineOperatorAuditContext): string {
  return context.actor;
}
