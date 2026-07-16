# Input

Portfolio Rebalancer의 Vercel 운영 저장소를 Prisma 7 + PostgreSQL로 구성한다.

## 2026-07-16 Broker Request Attempt slice

Toss read transport의 성공·HTTP 오류·timeout·network·schema 오류를 workflow correlation,
operation ordinal과 retry attempt 단위로 append-only 저장한다. 계좌번호·token·인증 header는
저장하지 않고 redacted request summary만 허용한다.

## 2026-07-17 Market snapshot payload provenance slice

- DBMS: PostgreSQL 17
- 범위: immutable broker/market evidence only
- 마이그레이션: `20260716165000_market_snapshot_payload_provenance`
- 제약: 적용된 migration 수정 금지, statement 단위 재시작 가능, engine/application 변경 및 commit 금지
- 필수 가드: trigger lookup 고정, 응답 payload 일치, 요청 완료시각 일치, 캘린더 날짜 일치, `TRUNCATE` 거부, `ENABLE ALWAYS`

## 2026-07-17 Restricted runtime database role slice

- DBMS: PostgreSQL 17
- migration 연결: `DATABASE_URL`, object owner/direct connection
- engine 연결: `DATABASE_RUNTIME_URL`, 별도 제한 LOGIN role
- 목표: runtime이 application table/function/trigger를 소유하거나 public schema에 DDL을 만들지 못하게 한다.
- 허용: app table SELECT/INSERT, 명시된 행 잠금·단조 UPDATE, runtime lease DELETE
- 차단: `_prisma_migrations` 접근, TRUNCATE, trigger disable/drop, `session_replication_role`, 임의 role/database/schema 생성
- 제약: 주문 schema와 service 로직을 변경하지 않고 bootstrap/config/client/test 범위에서 구현한다.

## 2026-07-17 Live dispatch DB safety slice

- DBMS: PostgreSQL 17
- 마이그레이션: `20260716171000_live_dispatch_db_safety`
- B 직전 계좌 행 잠금 아래 최신 ACTIVE config ID/hash/payload, 최신 GRANTED promotion,
  DISENGAGED kill switch를 authorization evidence와 재대조한다.
- operational config activation, promotion, kill event, B claim은 같은 broker account 행 잠금을
  직렬화 지점으로 사용한다.
- 새 pre-submit은 fresh PASSED `getAccounts` validation으로 HMAC/mask/type 단일 계좌를 재결합한다.
- A 이전 LIVE PLANNED 고착은 append-only proof로만 REJECTED 처리하고 예약을 전액 해제한다.
- broker account runtime UPDATE는 masked metadata와 `last_seen_at`으로 제한한다.
- 기존 migration 수정, 실제 계좌/주문 호출, repository service 변경, commit은 범위 밖이다.
