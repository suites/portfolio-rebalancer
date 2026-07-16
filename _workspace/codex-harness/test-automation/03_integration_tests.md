# 통합·계약 테스트 기록

## Toss 전송 계약

- 고정 버전 `1.2.4`
- 총 30 operations
- GET business 23, 계좌 변경 6
- 모든 business operation과 `TossReadApi`/`TossTradingApi` 명시적 메서드 parity
- Toss transport descriptor의 대표 read-only capability와 write capability 미제공
- 6개 계좌 변경 메서드가 네트워크 전에 `TOSS_LIVE_TRADING_DISABLED`로 거부
- request timeout이 `TOSS_API_TIMEOUT`으로 변환
- `429`의 retry/rate-limit/request ID 메타데이터 추출
- `401` 이후 token cache 무효화와 다음 호출 재발급

## Web route

`GET /api/v1/system/health` handler가 다음 안전 기본값을 반환하는지 확인합니다.

- `status: ok`
- `mode: paper`
- `liveOrdersEnabled: false`

`GET /api/v1/brokers` route 함수 계약도 transport-only·미연결·live 비활성 상태를 검증합니다. 실제 HTTP 서버 통합 테스트와 자동 브라우저 E2E는 아직 없습니다.

## Restricted PostgreSQL runtime role

- 격리 test DB에서 unique LOGIN role을 bootstrap하고 실제 runtime URL로 재접속
- role flags, session/current identity, schema CREATE, TEMP와 TRUNCATE 부재 확인
- runtime startup guard가 제한 role은 허용하고 migration owner는 거부하는지 확인
- startup guard가 예상 밖 role membership, allowlist 밖 UPDATE와 보호 테이블 DELETE drift를 fail closed 하는 unit contract 확인
- broker account upsert, running collection, raw evidence INSERT, lease upsert/update/delete, terminal collection update 성공
- raw evidence UPDATE/DELETE/TRUNCATE 실패
- trigger DISABLE/DROP, `session_replication_role=replica`, `_prisma_migrations` SELECT 실패
- trigger 함수 직접 실행은 실패하고 명시 allowlist의 순수 validation 함수만 실행 성공
- 행 잠금 때문에 UPDATE grant가 있는 operational config도 append-only trigger가 변경 거부
- database별 access role을 사용해 동일 cluster의 다른 database 권한 group과 분리
- 데이터는 runtime transaction rollback, test LOGIN role은 종료 시 제거

## Live dispatch DB safety

- wrong/missing getAccounts account validation 거부와 exact validation 성공
- A 이후 새 ACTIVE config activation, promotion REVOKED, kill ENGAGED 각각에서 B 거부
- 별도 connection이 broker account를 잠근 동안 B statement timeout, lock 해제 뒤 B 성공
- A 이전 LIVE PLANNED+exact RESERVED reservation proof가 REJECTED와 release를 원자 생성
- proof 이후 A, SUBMIT broker evidence, proof UPDATE 거부
- runtime role은 account mask/type/last-seen refresh만 성공하고 HMAC/broker/first-seen UPDATE는 42501
- owner도 stable account identity 변경은 ALWAYS trigger에서 23514
