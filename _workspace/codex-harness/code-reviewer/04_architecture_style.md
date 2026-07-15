# Architecture and Usability

권장 단계:

1. V0 오프라인 계산기: 단순 YAML, fixture, Decimal, 콘솔 보고서
2. V1 read-only shadow: 토스 조회, 수동 실행, JSON 스냅샷
3. V2 basic paper: 시장가, 즉시 전량 체결, 고정 슬리피지·수수료
4. V3 운영 UX: doctor, status, explain, kill switch, scheduler, Discord
5. Live hardening: UNKNOWN 대사, idempotency, 부분체결, 정정·취소, saga, lease

웹 UI, Docker, Redis, 메시지 큐와 비동기 워커는 필요하지 않다.
