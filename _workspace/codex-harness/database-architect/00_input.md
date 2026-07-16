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
