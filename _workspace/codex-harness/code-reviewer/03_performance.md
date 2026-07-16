# Performance and Operations Review

## P1 — Lease TTL과 Function 제한이 모두 120초

수집 lease가 2분이고 Function `maxDuration`도 120초다. Heartbeat와 최종 fencing 검사가 없어 timeout 경계에서 lease 만료 후 후속 invocation과 겹칠 수 있다.

## P1 — Fluid compute에서 memory 설정 위치 불일치

현재 `vercel.json`은 `memory: 1024`를 설정한다. 최신 Vercel 문서는 Fluid compute가 활성화된 경우 memory를 `vercel.json`에서 설정하지 말고 Dashboard Functions 설정을 사용하라고 안내한다.

## P2 — DB pool 확장성

Prisma singleton과 instance당 최대 연결 2개는 현재 저빈도 호출에 합리적이다. 다만 Function instance가 늘면 연결 수도 증가하므로 pooled `DATABASE_URL`을 유지하고 연결 수를 관찰한다. Vercel의 `attachDatabasePool` 적용 가능성도 후속 검토한다.
