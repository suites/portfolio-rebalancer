# Security review

- workflow 권한은 `contents: read`만 허용한다.
- third-party Action은 mutable major tag가 아니라 전체 SHA로 고정한다.
- 운영 Toss·DB secret을 CI에 넣지 않는다.
- install은 lockfile 불일치 시 실패한다.
- 현재 변경은 배포·artifact publish·외부 쓰기 권한을 포함하지 않는다.

SCA와 secret scanning은 GitHub 저장소 정책 및 후속 보안 감사에서 별도 게이트로
추가한다. 네트워크 registry 상태에 따라 흔들리는 `pnpm audit`를 핵심 verify job에
섞지 않는다.
