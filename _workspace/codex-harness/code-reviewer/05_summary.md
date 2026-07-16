# Review Summary

현재 루트 `.env` 하나는 초기 로컬 개발에는 편하지만 실제 로딩 방식과 Vercel의 최소 권한 모델에 맞지 않는다.

권고:

1. Web, Engine, migration의 3개 스코프로 분리한다.
2. Web에는 Engine URL과 서비스 토큰만 둔다.
3. Engine에는 runtime secret과 pooled DB URL만 둔다.
4. Direct DB URL은 migration CI에만 둔다.
5. Preview에는 운영 Toss/DB credential을 주입하지 않는다.
6. 분리 구현 시 빈 문자열 처리, Engine origin 검증, production 필수값 검증을 함께 보강한다.
