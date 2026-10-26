console.error(
  "실행 ZIP 배포는 Windows 보안 경고 조사 중이므로 중단되어 있습니다. " +
    "이 명령은 파일을 생성하거나 기존 조사 자료를 덮어쓰지 않습니다. " +
    "docs/SECURITY-STATUS.md와 docs/CODESPACES.md를 확인해 주세요.",
);
process.exitCode = 1;
