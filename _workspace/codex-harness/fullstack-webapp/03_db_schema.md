# Database

Prisma models: BrokerAccount, TargetConfig/Version/Allocation/Instrument, CollectionRun,
RawBrokerResponse, PortfolioSnapshot, HoldingSnapshot, SnapshotCheck, RuntimeLease.

- accountNo는 저장하지 않는다.
- external account reference는 HMAC, UI 표시는 마지막 4자리 마스크만 사용한다.
- 원본 응답은 redaction 후 JSONB로 저장한다.
- snapshot/evidence/check는 append-only이다.
- RuntimeLease는 Vercel 수평 실행의 중복 Toss 수집을 막는다.
