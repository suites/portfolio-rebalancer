# Input

- 기존 pnpm 모노레포에서 실제 토스증권 read-only 데이터를 사용한다.
- Next.js Web과 NestJS 11/Fastify adapter engine을 분리하고 두 앱을 Vercel Project로 운영한다.
- engine HTTP 계층을 Module, Controller, Guard와 singleton Provider로 현대화한다.
- Prisma 7과 PostgreSQL을 사용한다.
- 제품 런타임의 합성·더미 데이터는 제거한다.
- 주문 쓰기 API는 계속 하드 차단한다.
- 홈 외 5개 `준비 중` 자리표시자를 실제 라우트로 전환한다.
- 메뉴는 포트폴리오, 리밸런싱, 주문·기록, 문제 해결, 설정 순서로 구현한다.
- 계획·주문·복구 모델이 없는 상태를 가짜 데이터로 보완하지 않고 안전한 빈 상태로 표시한다.
- 기존 Prisma 목표 설정 모델을 사용해 목표 비중을 버전으로 저장하되 저장이 계획이나 주문을 만들지 않게 한다.
