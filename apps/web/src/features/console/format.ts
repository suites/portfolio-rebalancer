export function formatWon(valueMinor: string): string {
  return `₩${BigInt(valueMinor).toLocaleString("ko-KR")}`;
}

export function formatBasisPoints(value: number): string {
  const whole = Math.trunc(value / 100);
  const fraction = value % 100;
  return fraction === 0 ? `${whole}%` : `${whole}.${fraction.toString().padStart(2, "0")}%`;
}

export function formatCurrentWeight(value: number): string {
  const whole = Math.trunc(value / 10_000);
  const fraction = value % 10_000;
  return fraction === 0
    ? `${whole}%`
    : `${whole}.${fraction.toString().padStart(4, "0").replace(/0+$/, "")}%`;
}

export function formatObservedAt(value: string | null): string {
  if (!value) return "아직 수집되지 않음";
  return new Intl.DateTimeFormat("ko-KR", {
    dateStyle: "long",
    timeStyle: "short",
    timeZone: "Asia/Seoul",
  }).format(new Date(value));
}
