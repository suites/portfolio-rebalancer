# CI input

- 저장소: pnpm 10 monorepo, Node.js 22, TypeScript
- CI 도구: GitHub Actions
- 범위: 배포 없는 pull request 및 main 검증
- 필수 게이트: format, 고정 Toss OpenAPI parity, lint, typecheck, unit tests, production build
- 비밀정보: CI에 Toss 자격증명·계좌·운영 DB URL을 주입하지 않음
