# Architecture

## 2026-07-16 전체 구현 순서

```text
정확한 값 객체·정책
  -> 자산군/종목/현금 설정
  -> 중립 조회 어댑터와 불변 스냅샷
  -> Shadow 계획
  -> 주문 원장과 Risk Gate
  -> Paper 실행·대사·복구
  -> 운영·접근성·보안 검증
  -> 다중 승격 조건을 갖춘 제한적 Live
```

- 첫 주문 가능 시장은 KR로 제한한다. KR·US 데이터는 Shadow에서 함께 조회할 수 있지만,
  US 주문이 필요한 계획은 부분 실행하지 않고 전체를 차단한다.
- 정규 종목 식별자는 `broker + marketCountry + symbol`이며 `listingMarket`은 별도
  metadata로 관리한다.
- `TargetAllocation`은 자산군이고 `TargetInstrument[]`는 그 자산군의 구성 상품이다.
- Toss `getStocks`는 정확한 심볼 검증에만 사용한다. 종목명 검색은 출처와 라이선스가
  확인된 서버 카탈로그를 사용한다.
- 토스 `cashBuyingPower`, 계좌 현금과 사용자가 선택한 관리 현금은 서로 다른 값이다.
- Live는 환경변수 하나로 열지 않는다. 계좌 allowlist, 킬 스위치, 계획 hash에 묶인
  일회용 승인, 주문별·일별 한도, 최신 데이터, 원장 예약과 대사를 모두 요구한다.
- 자동 테스트와 일반 개발 검증은 실제 주문 transport를 호출하지 않는다.

## 현재 첫 수직 슬라이스

- KRW 계좌는 KRW, USD 보유 계좌는 KRW·USD `buying-power`를 조회한다.
- 통화별 관측값을 `valuationEligible=false`인 불변 자식 스냅샷으로 저장한다.
- 이 관측값은 관리 현금이나 보유주식 평가액에 합산하지 않는다.
- Web은 총 관리 자산, 통화별 매수 가능 금액과 사용자 지정 관리 현금을 분리한다.
- 관리 현금 정책은 `EXCLUDED/CASH_V1` 또는 `FIXED_KRW/CASH_V1`이며 목표 버전에 저장한다.
- 최종 fenced snapshot 트랜잭션이 고정할 ACTIVE 버전의 정책과 ID를 함께 읽어
  `securities + managed cash = total`을 확정한다.
- 목표 입력은 기본 `AUTO/MIXED_V1`이며 server domain 함수가 확정 범위를 만든다.
- 목표 설정 버전은 밴드 정책 모드·버전과 확정 lower/upper를 함께 저장한다.
- 보유·목표·대사 키에서 KOSPI/NASDAQ 같은 listing market을 사용하지 않는다.

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
- PostgreSQL snapshot과 buying-power 관측은 append-only trigger로 UPDATE/DELETE를 거부한다.
- 목표 설정이 없으면 실제 보유는 표시하되 계획과 주문을 차단한다.
- Next App Router의 공통 App Shell을 모든 콘솔 페이지가 재사용하고, 현재 경로 판별만 작은 client island로 둔다.
- 홈·포트폴리오·리밸런싱·기초 진단은 하나의 dashboard 계약을 재사용한다.
- 주문·기록은 현재 계좌로 제한한 CollectionRun과 SnapshotCheck의 안전한 요약만 조회하고 redacted 원문도 전달하지 않는다.
- 현재 목표 설정은 모든 보유 종목과 `CASH`를 요구하고 합계 10000bp, 고유 asset key,
  하한 <= 목표 <= 상한과 현금 정책을 engine에서 검증한다.
- 목표 초안은 원본 snapshot ID와 digest를 source/hash에 포함하고 저장·적용 transaction에서 최신 snapshot을 다시 확인한다.
- 활성 설정은 새 수집에서 snapshot의 targetConfigVersionId로 고정하며 과거 snapshot을 새 설정으로 재해석하지 않는다.
- 설정 저장 후 새 snapshot이 없으면 리밸런싱과 주문 계획을 계속 차단한다.
