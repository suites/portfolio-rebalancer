# 테스트 계획

## 현재 자동화

- 도메인: decimal 스케일 변환, 비중 계산, 고유 ID, 목표 합계와 1bp 미만 정밀 밴드 경계
- 애플리케이션: dashboard DTO, 밴드 이탈 결론, 허용 범위와 검증 현금 일치 검사
- 계약: basis point 범위
- 브로커: 미지원 capability fail-closed와 Toss read-only transport descriptor
- Toss: OpenAPI parity, 쓰기 하드 차단, timeout, `429` 메타데이터와 `401` 토큰 무효화
- OAuth: 고정 origin, single-flight, 토큰 응답 검증과 자격증명 마스킹
- UI: Button·StatusBanner·AllocationBand 정적 렌더링 계약
- Web: health route의 paper 기본값과 live 비활성 상태

## 검증 순서

```bash
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test
pnpm build
```

루트에서는 이 순서를 `pnpm verify`로 실행합니다. coverage는 별도로 `pnpm test:coverage`를 사용합니다.

## 다음 고위험 테스트

1. 중립 Toss adapter의 런타임 응답 검증과 합성 fixture
2. 자동 재시도 없는 현재 정책과 향후 rate-limit limiter 경계
3. 실계좌 현금 source of truth와 합성 fixture 검증
4. SQLite UNIQUE, transaction, lease와 재시작 복구
5. band edge/target 정책, 수량 반올림과 비용
6. 9분 59초/10분 1초 멱등성 및 `UNKNOWN_BLOCKED`
7. 접근성 자동 검사와 모바일·키보드 E2E
