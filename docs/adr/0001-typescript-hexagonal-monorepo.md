# ADR 0001: TypeScript 헥사고날 모노레포

- 상태: 채택
- 결정일: 2026-07-16

## 배경

Portfolio Rebalancer는 Web GUI와 향후 CLI가 같은 금융 계산, Risk Gate와 주문 원장을 사용해야 합니다. 토스증권 공식 API 전체를 활용하되 다른 증권사를 추가할 수 있어야 하고, 증권사 DTO나 프런트엔드 표현이 도메인 계산을 오염시키면 안 됩니다. 금액·수량의 정밀도, 기본 paper 모드와 fail-closed 동작도 컴파일 및 테스트 경계에서 유지해야 합니다.

현재 팀은 TypeScript 생태계에서 Web UI, 서버 조합과 OpenAPI 타입 생성을 함께 유지할 수 있습니다. 첫 수직 슬라이스는 자격증명 없이 빠르게 실행되어야 하지만 향후 SQLite, paper 체결과 운영 복구가 추가됩니다.

## 결정

Node.js 22와 pnpm workspace 위에 TypeScript 헥사고날 모노레포를 사용합니다.

```text
apps/web
  -> packages/application
  -> packages/contracts
  -> packages/ui
  -> 서버 조합에서 broker adapter 선택

packages/application -> packages/domain + packages/broker
packages/broker       -> packages/domain
packages/broker-toss  -> packages/broker + packages/domain
packages/contracts    -> 독립된 런타임 경계 스키마
packages/ui           -> 금융 판단이 없는 표현 컴포넌트
```

각 패키지 책임은 다음과 같습니다.

- `domain`: `bigint`, decimal 문자열, basis point와 교차곱 기반 순수 값·계산
- `broker`: 증권사 중립 모델, 세분화된 capability와 좁은 조회 포트
- `broker-toss`: 고정 OpenAPI·공식 origin, 생성 타입, OAuth와 안전 오류 전송 계층
- `application`: 포트를 조합하는 유스케이스와 화면용 DTO 생성
- `contracts`: 서버 경계의 Zod 런타임 계약
- `ui`: primitive·semantic·component 토큰과 접근 가능한 표현 컴포넌트
- `apps/web`: Next.js App Router, server-only 조합과 브라우저 UI

토스 공식 명세는 저장소에 고정하고 생성 파일을 검토 후 커밋합니다. origin은 공식 주소 상수로 고정하고 timeout·네트워크·HTTP 오류를 안전한 공통 오류로 변환합니다. 브라우저는 브로커 패키지나 비밀정보에 접근하지 않습니다. 쓰기 메서드의 타입 표면은 유지하되 현재 전송은 `TOSS_LIVE_TRADING_DISABLED`로 네트워크 전에 무조건 차단합니다. Toss transport descriptor는 18개 read-only capability만 설명하며 write capability와 활성화 경로는 안전한 executor와 ledger를 설계하기 전에는 만들지 않습니다. 실제 제품 capability는 중립 어댑터와 연결 상태가 갖춰진 뒤 별도로 구성합니다.

SQLite와 데이터 접근 기술은 아직 결정·구현하지 않습니다. 원장, lease, append-only 상태와 트랜잭션 요구사항을 먼저 확정한 뒤 별도 ADR로 선택합니다.

## 이유

- 도메인 계산을 Next.js, 저장소와 증권사 SDK에서 독립시켜 네트워크 없이 검증할 수 있습니다.
- 증권사 차이를 capability로 드러내므로 최소 공통분모나 거짓 기본값으로 안전 조건을 약화하지 않습니다.
- OpenAPI 생성 타입으로 30개 operation 누락을 자동 검출할 수 있습니다.
- UI와 서버가 같은 TypeScript 계약을 공유하되 Zod로 런타임 경계를 다시 검증할 수 있습니다.
- 패키지 단위 테스트와 점진적인 수직 슬라이스가 가능합니다.

## 결과

긍정적 결과:

- 다른 증권사는 별도 어댑터 패키지와 composition 변경으로 추가할 수 있습니다.
- 금융 계산과 외부 I/O의 테스트 경계가 명확합니다.
- Web GUI와 향후 CLI가 동일한 애플리케이션 서비스를 사용할 수 있습니다.
- 생성 명세와 수동 중립 모델을 분리해 공식 API 변화의 영향을 제한합니다.

비용과 제약:

- 패키지와 변환 계층이 늘어 초기 파일 수가 많습니다.
- OpenAPI 정적 타입만으로 런타임 외부 응답을 신뢰할 수 없어 경계 검증을 별도로 구현해야 합니다.
- 브로커별 기능 차이를 capability와 오류로 계속 관리해야 합니다.
- workspace source export는 현재 개발 속도에 유리하지만, 독립 패키지 배포가 필요해지면 build artifact와 exports 정책을 추가해야 합니다.

## 기각한 대안

### Web 앱에서 토스 클라이언트 직접 호출

비밀정보가 브라우저로 유출되고 금융 판단이 프런트엔드에 복제될 수 있어 기각했습니다.

### 토스 DTO를 공통 도메인 모델로 사용

다른 증권사 확장과 공식 명세 변경이 전체 애플리케이션으로 전파되므로 기각했습니다.

### 처음부터 마이크로서비스로 분리

단일 사용자·단일 호스트의 현재 규모에서 배포와 정합성 복잡성만 증가시키므로 모듈형 모노레포를 우선합니다.

## 후속 결정

- 한국 시장 첫 운영 범위와 미국 시장 승격 조건
- SQLite 라이브러리, 마이그레이션과 트랜잭션 경계
- 구성·비밀정보 로딩 방식
- paper 체결 모델
- live 활성화 다중 조건과 승인 수명
