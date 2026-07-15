# 실행과 배포 가이드

## 로컬 개발

요구사항은 Node.js 22 이상과 pnpm 10.28.0입니다.

```bash
pnpm install
pnpm dev
```

`http://127.0.0.1:3000`에서 합성 데이터 화면을 확인합니다. `dev`와 `start`는 모두 `127.0.0.1`에만 바인딩됩니다. 현재 실행에는 Toss 자격증명이 필요하지 않으며 외부 계좌나 주문 endpoint를 호출하지 않습니다.

프로덕션 빌드 확인:

```bash
pnpm verify
pnpm --filter @portfolio-rebalancer/web start
```

## 현재 배포 상태

배포 설정과 CI/CD는 아직 구현하지 않았습니다. 실제 금융 데이터를 다루는 production 배포로 간주하지 않습니다. 공개 인터넷 배포 전에 다음이 필요합니다.

- localhost 또는 인증된 사설 네트워크 경계
- 서버 전용 secret store와 고정 출구 IP
- CSP, CSRF, secure session과 최근 인증 정책
- 로그·오류·응답의 비밀정보 마스킹
- SQLite 백업·복구와 단일 writer 운영 정책
- health, request ID, rate limit과 장애 알림
- live 기능이 빌드·설정만으로 켜지지 않는 독립 검증

Toss secret와 실제 계좌 식별자를 저장소, 브라우저 환경변수 또는 외부 배포 서비스에 업로드하지 않습니다.
