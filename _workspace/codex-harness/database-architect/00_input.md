# Input

Portfolio Rebalancer의 Vercel 운영 저장소를 Prisma 7 + PostgreSQL로 구성한다.

## 2026-07-16 Broker Request Attempt slice

Toss read transport의 성공·HTTP 오류·timeout·network·schema 오류를 workflow correlation,
operation ordinal과 retry attempt 단위로 append-only 저장한다. 계좌번호·token·인증 header는
저장하지 않고 redacted request summary만 허용한다.
