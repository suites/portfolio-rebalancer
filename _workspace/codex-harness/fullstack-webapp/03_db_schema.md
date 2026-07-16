# Database

Prisma models: BrokerAccount, TargetConfig/Version/Allocation/Instrument, CollectionRun,
RawBrokerResponse, PortfolioSnapshot, HoldingSnapshot, BuyingPowerSnapshot, SnapshotCheck,
RuntimeLease.

- accountNo는 저장하지 않는다.
- external account reference는 HMAC, UI 표시는 마지막 4자리 마스크만 사용한다.
- 원본 응답은 redaction 후 JSONB로 저장한다.
- snapshot/evidence/check는 append-only이다.
- `BuyingPowerSnapshot`은 통화, 원문 amount, 원화 참고값, 관측 시각과
  `valuationEligible=false`를 저장하며 관리 현금과 분리한다.
- `TargetAllocation.bandPolicy` JSONB는 `AUTO/MIXED_V1` 또는 versioned CUSTOM 정책을
  확정 lower/upper와 함께 보존한다. 기존 행은 `CUSTOM/LEGACY_V1`으로 migration한다.
- `TargetConfigVersion.cashPolicy` JSONB는 `UNSET`, `EXCLUDED`, `FIXED_KRW` 정책을
  버전과 함께 보존한다.
- `TargetAllocation.compositionPolicy` JSONB는 `PRESERVE_CURRENT_V1`, `CASH_V1` 또는
  legacy 단일 종목 정책을 보존한다.
- `TargetInstrument.configVersionId`와 복합 FK는 부모 allocation의 버전 일치를 보장하고,
  `(configVersionId, marketCountry, symbol)` UNIQUE가 버전 내 복수 자산군 배정을 막는다.
- `PortfolioSnapshot.securitiesValueMinor`는 주식 평가액이고 DB CHECK가
  `totalValueMinor = securitiesValueMinor + COALESCE(managedCashMinor, 0)`을 보장한다.
- snapshot의 target version ID와 managed cash는 같은 fenced transaction에서 결정한다.
- `HoldingSnapshot.marketCountry`와 `TargetInstrument.marketCountry`는 기존 `market`
  DB 열을 정규 국가 키로 해석한다. `TargetInstrument.listingMarket`은 별도 nullable
  metadata 열이다.
- RuntimeLease는 Vercel 수평 실행의 중복 Toss 수집을 막는다.
- 새 테이블은 추가하지 않는다. 기존 TargetConfig 계열에 immutable version을 추가하고 이전 ACTIVE를 RETIRED로 전환한다.
- TargetConfigVersion.source와 contentHash는 초안 원본 snapshot ID·digest를 포함한다.
- dashboard는 최신 ACTIVE 설정을 과거 snapshot에 덮어쓰지 않고 snapshot.targetConfigVersionId가 가리키는 버전만 사용한다.
- 주문·체결·복구 원장은 아직 없으므로 UI에서도 존재하는 것처럼 표현하지 않는다.

향후 추가할 핵심 모델은 RebalanceRun, OrderPlan, LogicalOrder, OrderStateTransition,
DailyLimitReservation, ManualApproval과 KillSwitch다. 해당 migration은 Shadow 계획과
Risk Gate 설계가 고정된 뒤 별도 커밋으로 추가한다.
