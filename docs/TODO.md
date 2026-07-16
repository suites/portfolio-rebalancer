# 구현 TODO

## Phase 0 — 프로젝트 기반

- [x] 기술 스택과 런타임 결정
- [x] 패키지 구조와 의존성 방향 정의
- [x] 포맷터, 린터, 단위 테스트 구성
- [x] V8 테스트 coverage 실행 의존성과 workspace 명령 구성
- [ ] 설정 스키마와 예제 설정 작성
- [ ] 첫 운영 시장을 한국으로 고정하는 ADR 작성
- [x] Web, engine, Prisma migration별 `.env.local` 로딩 규칙과 `.gitignore` 구성
- [x] Vercel Supabase Integration의 pooled runtime URL과 direct migration URL 자동 인식
- [ ] 오류 코드와 구조화 로그 형식 정의
- [x] 실제 read-only 자격증명과 PostgreSQL을 사용하는 Quick Start 작성
- [ ] `setup`, `doctor`, `check`, `plan`, `run`, `status` CLI 골격 구현
- [ ] 완전한 `config.example.yaml`과 안내형 설정 흐름 작성
- [ ] 한국어 결과 상태와 오류 행동 지침 형식 정의

## Phase 1 — 순수 도메인 계산

- [ ] 통화, 금액, 수량, 비중 값 객체 구현
- [x] 목표 비중 합 검증
- [ ] 자산군 내부 종목 비중 검증
- [x] 합성 평가액 기반 포트폴리오 비중 계산기 구현
- [x] 자산 ID 고유성과 비어 있지 않은 ID 검증
- [x] `bigint` 교차곱으로 1bp 미만 밴드 이탈 판정
- [x] 대시보드 허용 범위와 관리 현금·`CASH` 자산 일치 검증
- [x] `MIXED_V1` 절대·상대 혼합 허용 범위와 고급 CUSTOM 계약 구현
- [ ] `band_edge`와 `target` 복귀 정책 구현
- [ ] 신규 현금 우선 배분 규칙 구현
- [ ] 최소 주문금액과 수량 반올림 구현
- [ ] 반올림 후 예상 비중 재검증
- [x] 현재 비중 계산과 목표 합계 차단의 결정론 테스트
- [x] 밴드 상·하한과 1bp 미만 이탈 경계 테스트
- [ ] property-based 테스트

## Phase 2 — 상태 저장소

- [x] Prisma/PostgreSQL 스키마와 초기 migration 구성
- [ ] 실행, 계획, 주문과 상태 이력 테이블 확장
- [x] 수집 실행, redacted 원본 응답과 불변 스냅샷 테이블 구현
- [x] 원본 스냅샷 ID·digest를 포함한 설정 해시와 애플리케이션 버전 저장
- [x] 버전형 관리 현금 정책과 주식 평가액·관리 현금·총액 DB 불변식 저장
- [x] 전역 Toss 수집 lease와 fencing token 구현
- [x] 수집 lease heartbeat, 만료 takeover와 owner·fencing token 기반 안전 해제 구현
- [ ] `logical_order_id` UNIQUE 제약 구현
- [ ] 일일 거래한도 예약과 주문 계획 저장을 하나의 트랜잭션으로 구현
- [ ] append-only 주문 상태 이력 구현
- [ ] 재시작 후 미완료 실행 복구 테스트
- [ ] 로그와 저장 데이터의 비밀정보 마스킹 테스트
- [ ] `status`, `explain`, `recover`가 DB 직접 수정 없이 상태를 처리하도록 구현

## Phase 3 — 토스증권 조회 어댑터

### Phase 3A — 공식 OpenAPI 전송 계층

- [x] 공식 OpenAPI `1.2.4` 스냅샷 고정
- [x] OAuth를 포함한 30개 operation 타입과 manifest 생성
- [x] 조회용 GET business operation 23개 호출 표면 구현
- [x] 계좌 변경 operation 6개의 타입·명시적 메서드와 하드 차단 구현
- [x] OAuth 토큰 메모리 캐시와 동시 발급 single-flight 구현
- [x] 공식 origin 상수 고정과 임의 `baseUrl` 주입 제거
- [x] 공통 10초 timeout과 네트워크·HTTP 안전 오류 정규화
- [x] `401` 응답 시 OAuth 토큰 캐시 무효화
- [x] `429`의 `Retry-After`, rate-limit group과 request ID 메타데이터 추출
- [x] 고정 명세와 명시적 호출 메서드의 parity 테스트
- [x] 생성 산출물을 임시 디렉터리에서 완성한 뒤 각 대상 파일로 원자적으로 교체
- [x] Toss transport descriptor를 18개 read-only capability로 정의하고 write capability 제외
- [x] 계좌·보유·시세·호가·종목·캘린더·일반/조건주문·pretrade 중립 조회 포트 정의
- [ ] 토스 원본 응답을 증권사 중립 모델로 변환하는 어댑터 구현
- [ ] 공식 명세 변경 감지와 검토를 CI에 연결

### Phase 3B — 운영 가능한 조회 어댑터

- [x] engine HTTP 계층을 NestJS 11 모듈·DI·Controller·Guard 구조로 전환
- [x] engine을 feature-first Nest 표준 폴더와 PrismaModule 구조로 재구성
- [x] Vercel zero-config `src/main.ts`, platform `PORT`와 Prisma 생성 단계 구성
- [x] 수동 serverless handler와 별도 bundle 없이 단일 Nest bootstrap 배포 구성
- [x] Vercel 함수 추적용 workspace 패키지 production export와 CommonJS 사전 컴파일 구성
- [x] Vercel 민감 환경변수에서 OAuth 자격증명을 로딩하는 운영 구성
- [x] 계좌 및 보유 주식 조회
- [ ] 가격, 종목, 시장 캘린더 조회
- [x] 미국 보유자산이 있을 때 USD/KRW 환율 조회와 bigint 환산
- [x] 통화별 매수 가능 금액을 관리 현금과 분리해 조회·불변 저장
- [x] 사용자 고정 원화 관리금액 또는 현금 제외 정책을 목표 버전과 함께 저장
- [ ] 매도 가능 수량 조회
- [ ] 평가용 현금 source of truth와 buying power의 차이를 실계좌 표본으로 검증
- [x] 관리 현금 정책 `UNSET` 또는 스냅샷 미반영 시 거래 결론 차단 테스트
- [ ] 수수료 및 종목 경고 조회
- [x] 계좌·보유·환율 응답 스키마 검증
- [x] rate-limit과 request ID 응답 헤더 메타데이터 추출
- [ ] 그룹별 client-side limiter 구현
- [ ] 429 백오프와 jitter 구현
- [x] timeout, 네트워크, 4xx와 5xx 안전 오류 분류
- [ ] request ID 감사 로그 저장
- [x] Vercel Static IPs 또는 Secure Compute 기반 고정 출구 IP 방식 결정
- [ ] `doctor`에서 토큰, 허용 IP, 계좌 및 조회 API를 주문 없이 점검
- [x] collection lease heartbeat와 fencing token 기반 최종 쓰기 검증

## Phase 4 — Shadow 모드

- [x] 실제 조회 데이터로 불변 PostgreSQL 스냅샷 생성
- [ ] 데이터 freshness 규칙 적용
- [x] 설정 외 자산 탐지 및 차단
- [ ] 주문 없이 리밸런싱 계획 생성
- [ ] 사람이 계산한 표본과 결과 대조
- [ ] 최소 2주간 일일 shadow 실행 관찰
- [ ] `NO_ACTION`과 차단 이유 보고서 구현
- [ ] 종목·비중 변경 전 config diff와 주문 영향 preview 구현
- [ ] 초보 사용자가 이해할 수 있는 한국어 실행 결과 예시 검증

## Phase 5 — 위험 차단기

- [ ] 수동 킬 스위치 구현
- [ ] 일일 총거래금액과 회전율 제한
- [ ] 단일 주문금액 제한
- [ ] 종목 및 자산군 최대 비중 제한
- [ ] 미체결 및 `UNKNOWN` 주문 차단
- [ ] 가격 급변과 stale quote 차단
- [ ] 장 상태와 거래 제한 차단
- [ ] 반대 방향 주문 충돌 차단
- [ ] fail-closed 통합 테스트

## Phase 6 — Paper 실행기

- [ ] `OrderExecutor` 인터페이스 정의
- [ ] 결정적 `clientOrderId` 생성
- [ ] 시장가 슬리피지 모델 구현
- [ ] 지정가 체결 규칙 구현
- [ ] 수수료 모델 구현
- [ ] 부분체결 시뮬레이션 구현
- [ ] 주문 상태 머신 구현
- [ ] 브로커 원본 상태와 내부 정규화 상태 분리
- [ ] 10분 멱등성 경계 9:59/10:01 테스트
- [ ] `clientOrderId` 36자 및 허용 문자 제약 테스트
- [ ] 10분 이후 `UNKNOWN_BLOCKED` 자동 재제출 금지 테스트
- [ ] 매도 체결 후 매수 계획 재계산
- [ ] Phase A 매도와 Phase B 매수 saga 및 계획 버전 구현
- [ ] 네트워크 오류와 모호한 응답 시나리오 모의 테스트
- [ ] paper 결과 재생 가능한 fixture 저장

## Phase 7 — 알림과 운영

- [ ] Discord webhook 알림
- [ ] 리밸런싱, 차단, 주문 상태별 메시지 템플릿
- [ ] 알림에서 계좌와 비밀정보 마스킹
- [ ] 알림 실패와 주문 흐름 분리
- [ ] SIGTERM, 스냅샷 저장 실패 및 알림 실패 시 lock/lease 복구 테스트
- [ ] 일일 실행 요약
- [ ] 운영 상태 및 마지막 성공 시각 확인 방법
- [ ] 백업과 복원 절차 문서화
- [ ] 킬 스위치 운영 런북 작성

## Phase 8 — 실거래 검토 게이트

아래 항목은 실제 운영에 필요한 필수 승격 조건입니다. 모두 완료하고 별도 설계 검토를 통과해야 실거래를 활성화할 수 있습니다.

- [ ] paper와 shadow 결과의 장기 비교
- [ ] 부분체결, 정정, 취소 및 타임아웃 복구 검증
- [ ] 중복 실행과 프로세스 강제 종료 테스트
- [ ] 계좌 허용 목록과 다중 활성화 조건 설계
- [ ] 주문별·일별 극소액 한도 설계
- [ ] 수동 승인 흐름 설계
- [ ] 장애 대응과 주문 정합성 런북
- [ ] 세금, 환전 및 계좌 유형 제약 확인
- [ ] 실거래 코드 독립 리뷰
- [ ] 한 종목·극소액·수동 승인 실거래 검증
- [ ] 실계좌 결과와 주문 원장 대사
- [ ] 운영자가 `status`, `explain`, `recover`만으로 장애 대응 가능한지 검증

## 문서 백로그

- [x] 기술 스택과 합성 데이터 Web GUI 로컬 개발 가이드 작성
- [ ] 설정 레퍼런스 작성
- [ ] 토스증권 어댑터 오류 매핑 문서 작성
- [ ] 데이터 모델과 ER 다이어그램 추가
- [ ] paper 체결 모델의 가정과 한계 문서화
- [ ] 실거래 검토 시 보안 위협 모델 작성

## Web GUI 구현 트랙

### UI-0 — UX 프로토타입

- [x] 반응형 정적 HTML/CSS 프로토타입 작성
- [x] primitive·semantic 시각 토큰 초안 작성
- [x] 정상, 계획 있음, 거래 차단과 실행 완료 상태 전환 구현
- [x] 금액 숨김과 모바일 내비게이션 구현
- [x] 데스크톱과 390px 모바일 렌더링 검증
- [x] 프로토타입, 토큰과 Web GUI 행동 명세의 기준 분리
- [ ] 사용자 피드백을 반영한 시각 기준 확정

### UI-1 — 디자인 시스템과 App Shell

- [x] primitive·semantic·component 토큰 정의
- [x] 상태 토큰 `정상/확인 필요/차단/확인 중/알 수 없음` 정의
- [x] 첫 화면의 App shell, 내비게이션과 `GlobalSafetyBar` 구현
- [x] 초기 미구현 내비게이션을 비활성 `준비 중` 상태로 표현하고 실제 라우트로 교체
- [x] 공통 UI 컴포넌트 정적 렌더링 계약 테스트
- [x] 금액·비중·시간 표기 유틸리티 구현
- [ ] 공통 loading, empty, stale, blocked, unknown 상태 구현
- [ ] Storybook과 접근성 검사 기반 구성

### UI-1.1 — 사이드바 메뉴 실제 구현

요청된 메뉴 순서대로 진행하되, 주문 원장이나 복구 모델이 없는 기능을 가짜 데이터로 채우지 않는다.
각 화면은 실제 엔진 상태를 표시하고 확인되지 않은 금융 동작은 fail closed 상태로 유지한다.

- [x] 1. 공통 App Shell을 분리하고 6개 실제 링크·현재 경로·모바일 내비게이션 구현
- [x] 2. `/portfolio` 실제 스냅샷 비중·금액·목표 범위와 접근 가능한 표 구현
- [x] 3. `/rebalancing` 판단 이유·현재/목표 비교·주문 없는 안전 검사 구현
- [x] 4. `/orders` 실제 수집 기록 타임라인과 주문 원장 안전 빈 상태 구현
- [x] 5. `/troubleshooting` 현재 차단 원인·보호 조치·다음 행동과 read-only 재점검 구현
- [x] 6. `/settings` 버전형 목표 비중 조회·검증·저장과 새 스냅샷 요구 상태 구현
- [x] 7. 6개 SSR 라우트·계약·설정 안전성·접근성 구조·반응형 CSS 자동 검증과 문서 동기화
- [x] 8. 모바일 최상위 섹션 간격 통일과 내부 구현 설명의 제품용 문구 정리

### UI-2 — 읽기 전용 운영 화면

- [ ] GUI와 CLI가 공통 애플리케이션 서비스를 사용하는 BFF/API 경계 구현
- [x] 실제 토스 서버 스냅샷을 공통 애플리케이션 서비스와 Zod 계약으로 전달
- [x] 홈 상태 요약과 최근 활동
- [x] 포트폴리오 `AllocationBand`와 텍스트 대체 설명
- [x] 포트폴리오 접근 가능한 표
- [ ] 보유자산 계층과 관리되지 않는 자산 표시
- [ ] 리밸런싱 이유와 Before/After 비교
- [x] 주문 없는 위험 검사 결과 표시

### UI-3 — 설정과 계획 검토

- [ ] 첫 실행 설정 마법사
- [ ] 토스 연결·허용 IP·계좌 진단 화면
- [x] 목표 비중 합계와 필드 오류 안내
- [x] 관리 현금 포함·제외 선택과 `CASH` 목표 입력
- [ ] 설정 변경 Diff와 거래 영향 미리보기
- [ ] 주문 계획 표와 위험 검사 체크리스트
- [ ] 설정 변경 시 기존 계획 자동 무효화

### UI-4 — 실행·기록·복구

- [ ] Paper·Live 구분과 금융 거래 최종 확인
- [ ] 실행 영수증과 주문 상태 타임라인
- [ ] 부분체결·거부·취소·상태 불명 UI
- [ ] 감사 로그와 입력 스냅샷 상세
- [ ] `doctor`, `explain`, `recover` 문제 해결 화면
- [ ] 킬 스위치 활성화와 안전한 해제 흐름

### UI-5 — 접근성과 릴리스 검증

- [ ] WCAG 2.2 AA 자동 검사
- [x] skip link focus, `focus-visible`과 reduced-motion 기본 스타일
- [ ] 키보드 전용 핵심 흐름 검증
- [ ] macOS VoiceOver와 Safari 검증
- [ ] 200% 확대·320px reflow·forced-colors 검증
- [ ] 설정, 점검, 계획, Paper, Live 확인과 UNKNOWN 복구 E2E
- [ ] 중요한 상태가 색상과 토스트에만 의존하지 않는지 검증
- [x] 개발·production start를 `127.0.0.1`에 고정
- [ ] 사설 네트워크와 외부 배포 경계 검증
- [ ] 비밀정보가 브라우저 저장소·응답·클라이언트 로그에 없는지 검증
- [ ] 세션 쿠키, CSRF와 CSP 정책 검증
- [ ] 새로고침·뒤로 가기·중복 클릭·네트워크 재시도 중복 주문 테스트
- [ ] 계획 만료·설정 변경·새 스냅샷 후 오래된 계획 실행 차단 테스트
- [ ] `UNKNOWN`·부분체결·기존 미체결 상태의 신규 주문 및 수동 재제출 차단 테스트
- [ ] 새 사용자의 설정 → 점검 → 계획 검토 → Paper 실행 → 결과 확인 사용성 테스트
