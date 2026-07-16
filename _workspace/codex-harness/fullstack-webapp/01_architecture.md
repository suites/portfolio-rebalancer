# Architecture

```text
Browser -> apps/web (Next.js, Vercel)
             -> apps/engine (NestJS 11 + Fastify adapter, icn1, Static IP)
                  -> Toss OpenAPI read APIs
                  -> packages/database -> Neon PostgreSQL
```

- web은 `ENGINE_INTERNAL_URL`과 service token만 소유한다.
- engine은 Toss 자격증명, Prisma, 수집 lease와 Cron을 소유한다.
- service token과 Cron secret은 별도 Guard로 검증하고 provider는 Vercel warm instance에서 재사용한다.
- engine root에는 main/bootstrap/AppModule만 두고 common, config, Prisma infrastructure, system/portfolio feature module로 구성한다.
- PostgreSQL client lifecycle은 singleton PrismaService가 관리하고 portfolio persistence adapter는 Prisma repository로 구현한다.
- PostgreSQL snapshot은 append-only trigger로 UPDATE/DELETE를 거부한다.
- 목표 설정이 없으면 실제 보유는 표시하되 계획과 주문을 차단한다.
- Next App Router의 공통 App Shell을 모든 콘솔 페이지가 재사용하고, 현재 경로 판별만 작은 client island로 둔다.
- 홈·포트폴리오·리밸런싱·기초 진단은 하나의 dashboard 계약을 재사용한다.
- 주문·기록은 현재 계좌로 제한한 CollectionRun과 SnapshotCheck의 안전한 요약만 조회하고 redacted 원문도 전달하지 않는다.
- 목표 설정은 현재 보유 종목만 허용하고 합계 10000bp, 고유 asset key, 하한 <= 목표 <= 상한을 engine에서 검증한다.
- 목표 초안은 원본 snapshot ID와 digest를 source/hash에 포함하고 저장·적용 transaction에서 최신 snapshot을 다시 확인한다.
- 활성 설정은 새 수집에서 snapshot의 targetConfigVersionId로 고정하며 과거 snapshot을 새 설정으로 재해석하지 않는다.
- 설정 저장 후 새 snapshot이 없으면 리밸런싱과 주문 계획을 계속 차단한다.
