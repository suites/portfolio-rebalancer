# Review Scope

- 대상: `apps/engine`의 수동 serverless 잔재와 NestJS 프로젝트 완결성
- 검토 파일: engine 진입점, Module/Controller/Guard/Provider, package scripts, TypeScript build, `vercel.json`, Prisma lifecycle와 테스트
- 목적: 일반 Nest 애플리케이션 코드와 Vercel zero-config 배포 경계를 분리하고 실제 production 실행 경로까지 검증
- 제외: live 주문, Toss write operation, 데이터 모델 변경과 환경변수 실제 값 열람
- 검토 방식: correctness/security, architecture, tests/maintainability 세 lane의 읽기 전용 병렬 리뷰 후 주 에이전트가 수정 통합
- 기준: Vercel NestJS 공식 문서, Nest bootstrap 관례, 로컬 전체 검증과 실제 Vercel build 로그
