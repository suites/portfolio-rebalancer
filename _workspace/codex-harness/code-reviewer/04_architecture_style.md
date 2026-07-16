# Architecture and Deployment Settings

현재 구조는 NestJS zero-config의 기본 조건을 충족한다.

- 진입점: `apps/engine/src/main.ts`
- 서버 시작: `app.listen(...)`
- adapter: NestJS Fastify
- 배포 단위: 전체 Nest 앱을 하나의 Vercel Function으로 변환
- workspace: pnpm workspace와 명시적인 내부 package dependency
- Prisma Client: database workspace postinstall에서 생성
- Cron: `/internal/v1/cron/portfolio`, 평일 00:00 UTC

권장 Dashboard 설정:

1. Root Directory: `apps/engine`
2. Include source files outside Root Directory: Enabled
3. Framework: NestJS 또는 repo config의 `framework: nestjs`
4. Build Command: 자동 감지, override 없음
5. Output Directory: 비움, `dist` 지정 금지
6. Install Command: 자동 감지
7. Node.js: 22.x
