# Correctness Findings

## 해결 — 수동 Function glob이 Nest zero-config와 충돌

실제 Vercel 로그에서 `functions["src/main.ts"]`가 `api` Function 패턴과 일치하지 않아 빌드가 즉시 실패했다. `vercel.json`의 `functions`, memory와 duration override를 제거했다.

## 해결 — 실제 진입점이 Nest를 간접 import

`src/main.ts`가 로컬 bootstrap helper만 import하면 Vercel detector가 Nest 엔트리포인트로 인정하지 않았다. 실제 로그는 `No entrypoint found which imports nestjs`였다. `main.ts`가 `@nestjs/core`를 직접 import하고 하나의 `bootstrap()`에서 `NestFactory.create()`와 `app.listen()`을 호출하도록 통합했다.

## 해결 — build가 산출물을 만들지 않음

기존 `build`와 `typecheck`가 모두 `tsc --noEmit`이었다. Nest CLI와 webpack으로 workspace 내부 TypeScript 패키지를 포함하는 `dist/main.cjs` build와 `start:prod`를 추가하고 Node 직접 실행 및 health 200을 확인했다.

## 해결 — Vercel builder 타입 이식성

engine tsconfig에 DOM Fetch API lib를 명시하고 `CollectionResult`를 property 존재 검사로 좁혀 Vercel builder의 별도 TypeScript 단계에서도 안정적으로 해석되게 했다.
