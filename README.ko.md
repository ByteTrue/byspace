# BySpace

[![BySpace](https://img.shields.io/badge/BySpace-AI_Agent_Orchestration-1a1a2e?style=for-the-badge&logo=github&logoColor=white)](https://github.com/ByteTrue/byspace)

웹과 CLI에서 로컬 AI 코딩 에이전트를 모니터링하고 제어하세요.

> **개발 중:** API와 동작은 아직 변경될 수 있습니다.

<p align="center">
  <img src="docs/assets/byspace-screenshot.png" alt="BySpace 스크린샷" width="900" />
</p>

## 지원 에이전트

BySpace는 다음 에이전트를 직접 지원합니다.

- **Claude Code**
- **Codex**
- **OpenCode**
- **Pi**
- **ACP 호환 에이전트**

## 아키텍처

BySpace는 로컬 우선 방식입니다. 호스팅된 웹 앱은 직접 연결하거나 종단 간 암호화된 릴레이를 통해 데몬에 연결합니다. 코드와 에이전트 실행은 데몬이 실행되는 컴퓨터에 남아 있습니다.

npm 워크스페이스 모노레포 구성:

- `packages/server` — 에이전트 수명 주기, WebSocket API, MCP 서버를 담당하는 데몬
- `packages/app` — Expo + React Native Web 기반 브라우저 클라이언트
- `packages/cli` — Docker 스타일 CLI (`byspace run/ls/logs/wait`)
- `packages/relay` — 원격 접속용 종단 간 암호화 릴레이

## 빠른 시작

```bash
npm install
npm run dev
```

다른 터미널에서 웹 앱을 실행합니다.

```bash
npm run dev:app
```

기본 개발 데몬 주소는 `http://localhost:6768`입니다.

## CLI

```bash
npm run cli -- ls -a -g
npm run cli -- run --provider claude --cwd . --prompt "이 저장소를 설명해 줘"
npm run cli -- logs -f <agent-id>
```

## 검증

```bash
npm run typecheck
npm run lint
npm run format:check
```

## 문서

시스템 설계, 개발 워크플로, 테스트, 릴리스 절차는 [`docs/`](docs/)에서 확인할 수 있습니다.

## 보안

릴레이 위협 모델, 종단 간 암호화, DNS 리바인딩 방어와 인증 경계는 [`SECURITY.md`](SECURITY.md)를 참조하세요.

## 라이선스

BySpace는 [Apache License 2.0](LICENSE)에 따라 배포됩니다.
