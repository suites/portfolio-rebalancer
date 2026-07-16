# Runner and configuration

- GitHub-hosted `ubuntu-latest`
- Node.js 22
- `packageManager`에 고정된 pnpm 10.28.0
- `pnpm install --frozen-lockfile`
- job timeout 30분
- `contents: read` 최소 권한
- 외부 Action은 확인한 release tag의 전체 commit SHA로 고정
- CI에는 운영 secret을 주입하지 않으며 모든 핵심 테스트는 네트워크 없이 실행
