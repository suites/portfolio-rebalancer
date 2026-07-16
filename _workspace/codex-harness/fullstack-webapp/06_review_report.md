# Review

## 2026-07-16 전체 실행 재개

- 전체 TODO와 대화 요구사항을 Live까지 구현 범위에 포함했다.
- 자동 검증 중 실제 주문은 보내지 않으며 실계좌 소액 검증은 최종 별도 실행 게이트다.
- 첫 수직 슬라이스에서 neutral buying-power 포트를 account+currency로 바로잡았다.
- 통화별 buying-power를 불변 저장하고 `valuationEligible=false`로 고정했다.
- 보유주식 평가액, 매수 가능 금액과 관리 현금을 UI에서 분리했다.
- 로컬 PostgreSQL `127.0.0.1:15432/portfolio_rebalancer`에 migration을 적용했다.
- `pnpm verify`는 변경 후 107개 테스트를 포함해 통과했다.
- collection fencing/heartbeat와 최신 수집 계좌 범위 고정을 완료했다.
- 목표 입력을 서버 확정 `AUTO/MIXED_V1` 밴드로 단순화하고 policy version을 저장한다.
- `marketCountry + symbol` 정규 키와 별도 `listingMarket` metadata를 분리했다.

- 실제 주문 전송 차단 유지: 통과
- 브라우저/Next의 Toss secret 접근 금지: 통과
- accountNo DB 저장 금지: 통과
- target 미설정 시 fail closed: 통과
- Vercel 고정 출구 IP 확인 gate: 통과
- PostgreSQL migration fresh replay: 통과
- 실제 read-only 계좌/보유 snapshot: 통과
- NestJS Guard 분리와 기존 HTTP 응답 계약: 통과
- feature-first 폴더와 singleton PrismaService 구성: 통과
- Vercel `src/main.ts` zero-config 진입점: 로컬 검증 통과, Preview 배포 확인 필요
- collection lease fencing/heartbeat: owner·token heartbeat와 최종 transaction 재검증 통과
- 홈 외 실제 라우트와 모바일 내비게이션: 통과, 6개 SSR 경로 HTTP 200
- 버전형 목표 설정 UI와 snapshot 고정: 통과, DRAFT/ACTIVE 분리와 ID·digest 경쟁 조건 차단
- 수집 기록과 fail-closed 진단 화면: 통과, 현재 계좌 제한과 첫 실패 기록 포함
- 주문 계획·원장·paper 체결·복구: 이번 범위 밖, 화면에서 안전한 빈 상태 유지
- URL query만으로 설정·재점검 성공 표시 불가: 통과
- `pnpm verify` format/lint/typecheck/test/build: 통과
- 계약 5, engine 34, web 8를 포함한 전체 workspace 단위 테스트: 통과
- 실제 브라우저 수동 320px·VoiceOver 검증: 실행 가능한 브라우저 연결이 없어 UI-5 후속으로 유지
- 실제 PostgreSQL 동시성 통합 테스트와 6개 라우트 브라우저 E2E: 후속 보강 필요
