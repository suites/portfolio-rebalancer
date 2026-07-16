# 운영 설정 레퍼런스

`config.example.yaml`은 주문 실행 정책의 버전형 입력 계약을 보여 주는 예제입니다.
실제 제품에서는 `setup` UI/CLI가 질문형 흐름으로 값을 받고 같은 Zod 계약으로 검증한
뒤 설정을 생성합니다. 사용자가 YAML 키, basis point 또는 minor unit 구조를 외워
손으로 편집하는 흐름은 정상 운영 경로가 아닙니다.

현재 저장소에는 설정 계약과 예제 검증까지 구현되어 있습니다. 설정 파일을 런타임에
적용하는 `setup`, `check`, `plan`, `run` 서비스와 live executor는 아직 연결되지
않았습니다. 따라서 예제의 `mode`나 `live.enabled`를 바꾸는 것만으로 실거래가
활성화되지 않으며, 현재 Toss 쓰기 전송 하드 차단도 해제되지 않습니다.

## 계약 버전과 형식

최상위 `schemaVersion`은 현재 `OPERATIONAL_CONFIG_V1`만 허용합니다. 루트와 모든
하위 객체는 strict schema이므로 오탈자나 알 수 없는 키가 있으면 설정 전체를
거부합니다. YAML은 JSON으로 표현 가능한 문자열, 정수, boolean, 배열과 객체만
사용합니다.

금액 필드는 부동소수점 오차를 피하기 위해 음수가 아닌 minor-unit 정수 문자열로
기록합니다. 첫 live 시장은 KRW이므로 현재 `"10000"`은 10,000원을 뜻합니다.
비중과 회전율은 `10000bp = 100%`인 정수 basis point입니다.

## 최상위 안전 상태

| 필드            | 의미                                                   |
| --------------- | ------------------------------------------------------ |
| `schemaVersion` | 운영 설정 계약 버전. 현재 `OPERATIONAL_CONFIG_V1` 고정 |
| `mode`          | `PAPER` 또는 `LIVE`. 생략 시 `PAPER`                   |
| `killSwitch`    | `true`이면 신규 주문 실행을 차단하는 운영 킬 스위치    |

`killSwitch`에는 기본값을 숨겨 두지 않습니다. 설정 생성 화면에서 현재 상태와 보호
효과를 보여 준 뒤 명시적으로 저장해야 합니다.

## 데이터 신선도

`freshness.quote.planMaxAgeSeconds`는 계획 생성에 사용할 quote의 최대 나이이고,
`preSubmitMaxAgeSeconds`는 주문 제출 직전 재검증 한도입니다. 주문 직전 값은 계획
생성 값보다 같거나 작아야 합니다.

`freshness.quote.futureToleranceSeconds`와
`freshness.calendar.futureToleranceSeconds`는 외부 관측 시각이 로컬 시각보다
미래로 보일 때 허용할 최대 시계 오차입니다. 캘린더에는 별도의
`calendar.maxAgeSeconds`를 설정합니다. 나이 또는 미래 오차를 확인할 수 없으면
Risk Gate는 값을 현재 상태로 추정하지 않고 거래를 차단해야 합니다.

V1 계약은 안전 규칙을 설정값으로 무력화할 수 없도록 다음 상한을 고정합니다.

- 계획 quote 최대 나이: 300초
- 주문 직전 quote 최대 나이: 30초
- 캘린더 최대 나이: 172,800초
- 외부 시각의 미래 허용 오차: 60초

## 일반 위험 한도

`limits`는 Paper와 향후 Live에 공통으로 적용할 상한입니다.

| 필드                                | 의미                                               |
| ----------------------------------- | -------------------------------------------------- |
| `minimumOrderGrossMinor`            | 이 값보다 작은 주문 후보를 제출하지 않는 최소 금액 |
| `feeBufferMinor`                    | 가용 현금 계산에서 먼저 제외하는 수수료 안전 여유  |
| `maxSingleOrderGrossMinor`          | 한 주문의 최대 총금액                              |
| `maxDailyGrossMinor`                | 한국 거래일 기준 일일 총거래금액 상한              |
| `maxDailyTurnoverBasisPoints`       | 첫 유효 일일 포트폴리오 대비 체결·예약 회전율 상한 |
| `maxAbsolutePriceChangeBasisPoints` | 직전 관측 가격 대비 허용할 최대 절대 변동 폭       |
| `maxInstrumentWeightBasisPoints`    | 한 종목의 주문 후 최대 비중                        |
| `maxAssetClassWeightBasisPoints`    | 한 자산군의 주문 후 최대 비중                      |
| `maxRiskyWeightBasisPoints`         | 전체 위험자산의 주문 후 최대 비중                  |

설정은 `minimumOrderGrossMinor` ≤ `maxSingleOrderGrossMinor` ≤
`maxDailyGrossMinor` 순서를 만족해야 합니다. 이 설정 검증은 실제 주문 시점의 누적
예약, 미체결 주문과 새 스냅샷 재검증을 대신하지 않습니다.

## 제한적 Live 승격 설정

첫 live 범위는 다음 값으로 고정되어 변경할 수 없습니다.

- `marketCountry: KR`
- `allowedSession: REGULAR_MARKET`
- `orderType: LIMIT`
- `timeInForce: DAY`

미국 시장, 프리·애프터마켓, 단일가 구간, 시장가, GTC와 조건주문은 새 계약 버전과
별도 승격 검토 없이 허용되지 않습니다.

`live.enabled: true`가 유효하려면 다음 조건을 모두 만족해야 합니다.

- `accountAllowlistHmacs`에 하나 이상의 64자리 SHA-256 HMAC이 있음
- `manualApprovalRequired: true`
- 최상위 `killSwitch: false`가 명시됨
- live 단일·일일 한도가 일반 한도 이하임
- `tinyLiveMaxGrossMinor`가 최소 주문금액 이상이며 live 단일 주문 한도 이하임

V1의 첫 live 안전 상한은 단일 주문 100,000원, 일일 총거래 300,000원,
극소액 검증 주문 50,000원, 승인 유효시간 600초입니다. 이 값은 사용자가 넓힐 수
없습니다. 이는 최종 운영 한도를 확정했다는 뜻이 아니라, Phase 8의 독립 실거래
리뷰와 극소액 검증이 끝나기 전 코드 경로가 넘을 수 없는 임시 상한입니다. 상한을
넓히려면 새 계약 버전, 위협 모델, 실거래 리뷰와 migration이 모두 필요합니다.

`mode: LIVE`는 추가로 `live.enabled: true`를 요구합니다. 반대로 이 두 값이
유효하더라도 주문 원장, 멱등성, 현재 장 상태, 최신 quote, 일일 예약, 수동 승인과
별도 live 승격 상태 중 하나라도 확인되지 않으면 실행은 차단되어야 합니다.

`approvalTtlSeconds`는 사람이 검토한 계획 승인이 유효한 최대 시간입니다. 설정 자체에
승인 토큰이나 서명을 저장하지 않습니다. `tinyLiveMaxGrossMinor`는 별도 설계 검토 뒤
한 종목 극소액 검증에만 사용할 추가 상한이며 일반 live 한도를 넓힐 수 없습니다.

## 계좌와 비밀정보

설정에는 전체 계좌 식별자, API client secret, access token 또는 승인 서명을 넣지
않습니다. `setup`은 engine 내부의 승인된 계좌 참조와 별도 비밀 키를 사용해 HMAC을
만들고 `accountAllowlistHmacs`만 기록해야 합니다. 사용자가 HMAC을 직접 계산하거나
계좌 식별자를 YAML에 복사하도록 요구하면 안 됩니다.

## 개발 중 검증

루트 예제는 contracts 테스트에서 실제 YAML로 파싱한 뒤
`OperationalConfigSchema`로 검증합니다.

```bash
pnpm --filter @portfolio-rebalancer/contracts test
```

TypeScript 경계에서는 다음 계약을 사용합니다.

```ts
import { OperationalConfigSchema } from "@portfolio-rebalancer/contracts";

const config = OperationalConfigSchema.parse(untrustedYamlValue);
```

운영 로더는 검증 전 값을 사용하거나 실패한 설정의 일부만 적용해서는 안 됩니다.
