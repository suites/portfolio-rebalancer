# Review Scope

- 대상: 루트 및 앱별 환경변수 로딩 경로, Vercel 프로젝트별 권한 경계
- 검토 파일: `.env.example`, `.gitignore`, `apps/engine/src/config/engine.config.ts`, `apps/web/src/server/engine-dashboard.ts`, `packages/database/prisma.config.ts`
- 목적: 로컬 개발과 Vercel 운영에서 비밀정보 최소 권한, 설정 일관성, 실패 안전성 검토
- 제외: 실제 `.env` 값 열람, 환경변수 재배치 구현, Vercel 설정 변경
