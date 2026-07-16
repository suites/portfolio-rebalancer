# Migration Plan

- Prisma schema와 migration SQL을 함께 커밋한다.
- 운영에서는 pooled runtime URL과 direct migration URL을 분리한다.
- 배포 승격 전에 `prisma migrate deploy`를 실행한다.
- rollback은 schema down이 아니라 이전 앱 배포 복귀와 forward migration을 기본으로 한다.
