# Test Plan

## Buying-power 첫 슬라이스

- KRW 정수와 USD decimal 문자열 허용
- 음수, number 타입과 지원하지 않는 통화 거부
- 요청 통화와 응답 통화 불일치 시 스냅샷 저장 차단
- USD 보유가 있을 때만 USD buying-power와 USD/KRW 환율 수집
- buying-power를 별도 불변 자식으로 저장
- buying-power만으로 `managedCashMinor`가 변경되지 않음
- `UNSET -> null`, `EXCLUDED -> 0`, `FIXED_KRW -> amountMinor`
- `FIXED_KRW` 선행 0 거부와 PostgreSQL bigint 상한 검증
- 같은 최종 transaction에서 target version, cash policy, 주식 평가액과 총액 고정
- legacy snapshot backfill 중 immutable trigger 재활성화와 합계 CHECK 검증
- Dashboard 계약의 `valuationEligible`는 `false`만 허용
- Web에서 KRW·USD를 서로 합산하지 않고 통화별 표시
- 실제 주문 메서드와 네트워크 쓰기 호출 0회
- heartbeat 실패 시 계좌·스냅샷 쓰기 없음
- 최종 transaction fencing token 불일치 시 snapshot evidence 쓰기 없음
- 최신 dashboard snapshot을 최근 수집 계좌로 제한
- 자동 밴드 0, 1, 100, 1000, 1999, 2000, 9999, 10000bp 경계
- 상대 편차 올림, 500bp 상한과 0/10000bp clamp
- 기본 Web form에 목표 필드만 존재하고 CUSTOM 역전 범위는 계약에서 거부
- 같은 미국 종목은 listing market과 무관하게 `US:symbol` 하나로 식별
- Web form에서 관리 현금 정책과 `CASH` 목표 제출, nullable 현재 비중은 `계산 전` 표시

- Toss 계좌·보유·환율 런타임 schema rejection
- USD/KRW bigint 환산과 KRW fractional rejection
- 복수 계좌 자동 선택 금지
- accountNo redaction/HMAC
- dashboard target 미설정 계약
- Prisma migration fresh deploy
- DB append-only trigger와 lease 해제
- 실제 read-only 수집 smoke test
- NestJS Controller의 health, service auth, Cron auth, 503 차단 계약
- 실제 AppModule과 PrismaModule provider graph bootstrap
- dashboard와 refresh의 `cache-control: no-store`
- format, lint, typecheck, unit tests, production build
- 6개 실제 내비게이션 링크, 단일 aria-current와 `준비 중` 제거
- 포트폴리오 native table caption/header/status 계약
- 목표 합계 10000bp, band 순서, 중복·미보유 asset 거부
- 설정 저장의 snapshot-bound version/hash, 경쟁 수집 시 DRAFT_STALE, 단일 ACTIVE와 snapshot 재수집 요구
- 리밸런싱이 target stale, managed cash `UNSET`/미반영에서 계획·주문을 계속 차단
- 현재 계좌의 첫 실패를 포함한 수집 기록과 raw payload, 비밀정보, 전체 계좌번호 부재 확인
- 320px·390px·desktop reflow와 키보드 focus 확인
