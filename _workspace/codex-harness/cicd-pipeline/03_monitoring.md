# CI monitoring

GitHub branch protection의 필수 check 이름은 `Verify / Format, OpenAPI, lint, test, build`로
사용한다. 배포가 없는 현재 단계에서는 DORA 배포 지표를 만들지 않는다.

실패 시 첫 실패 명령이 로그에 그대로 남고, concurrency가 같은 ref의 오래된 실행을
취소해 잡음과 runner 낭비를 줄인다.
