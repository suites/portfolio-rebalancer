# Review Scope

- 대상: `apps/engine`의 Vercel NestJS 배포 가능성
- 검토 파일: engine 진입점, Nest/Fastify bootstrap, package scripts, `vercel.json`, pnpm workspace, Prisma lifecycle, Cron/lease
- 목적: Vercel Dashboard Root Directory와 Framework Preset 선택, zero-config 감지, 운영상 배포 차단 요인 확인
- 제외: Vercel Project 생성·연결·배포, 제품 코드 수정, 실제 환경변수 값 열람
- 기준: Vercel NestJS·Monorepo·Functions 최신 공식 문서와 로컬 typecheck/test/build
