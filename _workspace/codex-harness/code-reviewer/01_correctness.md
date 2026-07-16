# Correctness Findings

## P1 — 루트 `.env`를 Web이 읽지 않음

Engine과 Prisma CLI는 루트 `.env`를 명시적으로 읽지만 `apps/web`의 Next.js는 프로젝트 루트의 환경 파일을 읽는다. `ENGINE_SERVICE_TOKEN`을 루트에만 추가하면 Engine은 인증을 요구하고 Web은 토큰 없이 호출해 대시보드가 실패할 수 있다.

## P1 — 빈 `DATABASE_DIRECT_URL`이 fallback을 막음

Prisma 설정이 null 병합 연산자를 사용하므로 `DATABASE_DIRECT_URL=`은 `DATABASE_URL`로 fallback하지 않고 빈 URL로 선택된다.

## P2 — Optional 예시의 빈 문자열

Engine 설정 스키마에서 optional은 누락을 허용하지만 빈 문자열은 일부 최소 길이 검증에 실패한다. 사용하지 않는 optional 키는 예제에서 주석 처리하거나 빈 문자열을 누락으로 정규화해야 한다.
