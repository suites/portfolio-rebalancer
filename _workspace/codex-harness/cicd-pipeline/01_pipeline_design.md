# Pipeline design

단일 `verify` job이 잠금 파일 설치 후 저장소의 공식 `pnpm verify`를 실행한다.
pull request와 main push를 같은 게이트로 검증하며, 같은 ref의 오래된 실행은 취소한다.

OpenAPI 변경 감지는 네트워크의 `latest` 문서가 아니라 커밋된 1.2.4 스냅샷을 다시
생성해 manifest와 타입 생성물이 정확히 같은지 확인한다. 공식 스냅샷 갱신은 별도
검토 작업으로 유지한다.
