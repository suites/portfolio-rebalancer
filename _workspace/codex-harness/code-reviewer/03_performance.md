# Performance and Operations Review

## 해결 — 중복 Nest bootstrap

실제 main과 테스트용 bootstrap이 각각 `NestFactory.create()`를 수행해 옵션과 adapter가 어긋날 수 있었다. helper와 중복 테스트를 제거하고 실제 `AppModule` 통합 테스트로 교체했다.

## 해결 — production artifact 부재

webpack bundle은 내부 workspace 소스만 포함하고 Nest, Fastify, Prisma와 pg 같은 외부 npm dependency는 external로 유지한다. 현재 산출물은 약 203KB이며 dependency 중복 번들을 피한다.

## 유지 — DB 수명주기

Prisma client와 Toss runtime은 Nest singleton provider로 유지해 warm runtime에서 재사용한다. 다중 runtime 동시 수집은 PostgreSQL lease가 담당한다.

## 후속 개선

수집 lease heartbeat와 최종 fencing 검사는 별도 phase에서 구현해야 한다. pooled `DATABASE_URL`의 connection 수 역시 운영 관찰 대상이다.
