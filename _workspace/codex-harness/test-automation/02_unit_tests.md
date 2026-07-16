# 단위 테스트 기록

## 도메인

- decimal 문자열을 지정 scale의 `bigint`로 변환
- 허용 정밀도 초과, 지수 표기와 비정상 선행 0 거부
- 평가액 합, 현재 비중과 목표 대비 이탈 계산
- 목표 basis point 합계가 10,000이 아니면 차단
- 비어 있거나 중복된 자산 ID 차단
- 교차곱으로 1bp 미만 상·하한 이탈 판정

## 애플리케이션과 계약

- dashboard DTO가 bigint를 노출하지 않고 직렬화 가능
- `VERIFIED`와 밴드 이탈에서 `REBALANCE_REQUIRED` 도출
- 검증된 관리 현금 부재 시 `BLOCKED` 도출
- 허용 범위와 검증 현금·cash 자산 불일치 거부
- Zod 계약이 범위 밖 basis point를 거부

## 브로커와 OAuth

- 미지원 capability가 `BROKER_CAPABILITY_UNAVAILABLE`로 fail closed
- 동시에 토큰을 요청해도 fetch 한 번만 호출
- 공식 origin만 사용하고 비어 있거나 비정상인 token 응답 거부
- 자격증명이 upstream 메시지에 있어도 `[REDACTED]` 처리
- JSON이 아닌 인증 실패를 안전한 오류로 변환

## UI

- `AllocationBand` 이탈을 `attention`으로 표시하고 접근 가능한 범위 설명 제공
- Button의 native disabled 속성
- StatusBanner의 영역과 제목을 고유 accessible ID로 연결

## Runtime DB role

- migration URL은 `DATABASE_URL`, runtime URL은 `DATABASE_RUNTIME_URL`만 선택
- local 기본 owner/runtime username 분리
- 같은 DB principal URL 차단과 Supabase pooler suffix 정규화
- safe runtime role row 허용
- owner session, superuser, CREATEROLE, object owner, public CREATE, TRUNCATE, migration ledger 접근 거부
- bootstrap SQL의 INSERT/UPDATE/DELETE allowlist와 future default revoke 정적 계약
