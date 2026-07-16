# Architecture and Deployment Settings

현재 engine은 일반 Nest 애플리케이션 경계를 갖는다.

- 진입점: `src/main.ts`의 단일 `bootstrap()`
- root module: `AppModule`
- 기능 경계: `SystemModule`, `PortfolioModule`
- HTTP: Nest Controller와 Guard, Fastify platform adapter
- 인프라: `PrismaModule`의 singleton lifecycle provider
- 배포 설정: `vercel.json`의 framework, region과 Cron만 유지
- production build: Nest CLI + custom webpack workspace alias
- production 실행: `dist/main.cjs`를 Node로 직접 실행

Vercel Dashboard 확인값:

1. Root Directory `apps/engine`
2. 외부 workspace source 포함 활성화
3. Framework Preset `NestJS`
4. Build Command와 Output Directory override 없음

Vercel 공식 Nest 지원은 전체 애플리케이션을 플랫폼 Function으로 변환하지만, 애플리케이션 소스에는 handler나 Lambda adapter를 두지 않는다.
