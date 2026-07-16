# Input

- 기존 pnpm 모노레포에서 실제 토스증권 read-only 데이터를 사용한다.
- Next.js Web과 NestJS 11/Fastify adapter engine을 분리하고 두 앱을 Vercel Project로 운영한다.
- engine HTTP 계층을 Module, Controller, Guard와 singleton Provider로 현대화한다.
- Prisma 7과 PostgreSQL을 사용한다.
- 제품 런타임의 합성·더미 데이터는 제거한다.
- 주문 쓰기 API는 계속 하드 차단한다.
