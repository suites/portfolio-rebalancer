# Correctness Findings

## P1 — Root Directory는 `apps/engine`이어야 함

첨부 화면은 상위 `apps` 라디오가 선택된 것으로 보인다. Engine 프로젝트의 Root Directory는 펼친 목록의 `apps/engine` 자체여야 `src/main.ts`, `package.json`, `vercel.json`이 프로젝트 루트에 놓인다.

## P1 — Framework 감지를 명시적으로 고정하지 않음

Vercel은 `src/main.ts`와 `app.listen()`을 공식 NestJS zero-config 진입점으로 지원하므로 현재 코드 형태는 맞다. 다만 Dashboard에서 NestJS가 보이지 않는 상태를 제거하려면 `apps/engine/vercel.json`에 `"framework": "nestjs"`를 명시해야 한다. `Other` 정적 프로젝트로 처리되면 현재 `tsc --noEmit` build는 배포 산출물을 만들지 않는다.

## P2 — PORT 호환성 실배포 검증 필요

공식 예시는 `process.env.PORT`로 listen하지만 현재 코드는 `ENGINE_PORT` 기본값 4100을 사용한다. Vercel의 Nest 변환기가 listen을 처리할 가능성이 높지만, 최초 Preview에서 health route로 확인하기 전에는 확정하지 않는다.
