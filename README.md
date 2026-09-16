# Floating To Do — MS To Do 플로팅 앱 (Windows / Linux)

항상 위에 떠 있는 작은 TODO 창 + **LLM 붙이기 쉬운 구조**가 목표입니다.

- `TODO_BACKEND=memory` → 설치 없이 바로 실행 (기본값)
- `TODO_BACKEND=mstodo` → 진짜 Microsoft To Do(Graph API) 연동
- `LLM_PROVIDER=mock` → 키 없이 테스트 / `ollama`·`openai`로 바꾸면 진짜 LLM
- 외부 LLM(Claude Desktop, Cursor 등)은 `npm run mcp` MCP 서버로 연결

```
src/
  core/        TodoBackend, LlmProvider 인터페이스 (계약)
  backends/    MemoryBackend, MsTodoBackend, BackendFactory
  llm/         MockProvider, OpenAICompatibleProvider, factory
  agent/       TODO_TOOLS(함수 스키마 단일소스) + TodoAgent
  mcp/         server.ts — 외부 LLM용 MCP stdio 서버
  main/        Electron 창/트레이/IPC
  preload/     renderer 브릿지
  renderer/    React 플로팅 UI
  shared/      IPC 타입
```

## 1. 실행 (Windows / Linux 공통)

```bash
npm install
cp .env.example .env   # 리눅스: cp, 윈도우: copy .env.example .env
npm run dev            # 개발 실행
npm run typecheck      # 타입 체크
npm run build          # 빌드
```

배포 파일 만들기:

```bash
npm run dist:win    # Windows: dist/*.exe
npm run dist:linux  # Linux: dist/*.AppImage, *.deb
```

단축키: `Ctrl+Shift+T` 숨기기/보이기.

## 2. Microsoft To Do 연결 — UI에서 로그인

`.env` 없이 앱 내 **⚙ 설정 → Microsoft To Do**에서 전부 됩니다.

1. 백엔드를 `Microsoft To Do`로 바꾸고 **Client ID** 입력
   (Entra → App registrations → New registration, 권한 `Tasks.ReadWrite` + `offline_access`)
2. **저장 후 적용** → **브라우저로 로그인** (기본 브라우저가 열림)
   - 회사망/loopback이 막히면 **코드로 로그인**: 표시된 코드를 `microsoft.com/devicelogin`에 입력
3. 상태 표시줄에 계정이 뜨면 완료. 이후 토큰은 OS 앱 데이터 경로에 자동 갱신 저장.

CLI/수동 설정을 선호하면 `.env`도 그대로 지원 (`TODO_BACKEND`, `AZURE_CLIENT_ID`, `AZURE_TENANT_ID`).

## 3. LLM 연결

### 3-1. 앱 안에서 (⚙ 설정 → AI)

공급자 선택 → Base URL/모델 입력 → API 키 입력 → **연결 테스트** → **저장 후 적용**.
API 키는 OS 키체인(DPAPI 등)으로 암호화 저장되며, 연결 테스트 외에는 본문이 외부로 나가지 않습니다.

Ollama 예시 (무료/로컬): 공급자 `Ollama`, Base URL `http://localhost:11434/v1`, 모델 `llama3.1`, 키 비워둠.

```ini
LLM_PROVIDER=ollama
LLM_BASE_URL=http://localhost:11434/v1
LLM_API_KEY=ollama
LLM_MODEL=llama3.1
```

```bash
ollama pull llama3.1
ollama serve
npm run dev
# 입력창에: "내일 보고서 제출 추가해줘"
```

OpenAI는 `LLM_PROVIDER=openai`, `LLM_BASE_URL=https://api.openai.com/v1`, `LLM_API_KEY=sk-...` 로 바꾸면 됩니다.
Azure/vLLM/LM Studio/Groq도 OpenAI 호환 엔드포인트면 동일하게 됩니다.

코드에서 직접 쓰는 법:

```ts
import { getBackend } from './src/backends/BackendFactory.js';
import { createLlmProvider } from './src/llm/factory.js';
import { TodoAgent } from './src/agent/TodoAgent.js';

const agent = new TodoAgent(getBackend(), createLlmProvider());
const { reply, tasks } = await agent.run('내일 회의 준비 추가해줘');
```

새 LLM을 붙이고 싶으면 `LlmProvider` 인터페이스(`src/core/llm-types.ts`)만 구현해서 `src/llm/factory.ts`에 한 줄 추가하면 됩니다.
새 도구가 필요하면 `src/agent/tools.ts`의 `TODO_TOOLS` + `TodoAgent.executeTool()`에만 추가하세요. UI·MCP에 자동 반영됩니다.

### 3-2. 외부 LLM에서 조종 (MCP)

```bash
TODO_BACKEND=memory npm run mcp
```

Claude Desktop `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "floating-todo": {
      "command": "npx",
      "args": ["tsx", "C:/절대경로/floating_todo/src/mcp/server.ts"]
    }
  }
}
```

제공 도구: `list_tasks`, `add_task`, `complete_task`, `delete_task`.

## 4. 파이프라인 테스트 (LLM 없이)

```bash
npm run agent:demo -- "보고서 끝냈어"
npm run smoke   # 빌드된 앱을 띄워 IPC 전체를 CDP로 end-to-end 검증
```

## 5. 문제 해결

| 증상 | 해결 |
|---|---|
| `AZURE_CLIENT_ID가 필요합니다` | `.env`에 Client ID 설정했는지 확인 |
| Device login 후 401 | Entra API 권한 `Tasks.ReadWrite` 확인, 테넌트 ID가 `consumers`인지 확인 (개인 계정) |
| Linux에서 창이 뒤로 감 | 사용 중인 WM 확인. `setVisibleOnAllWorkspaces` 적용済, 타일링 WM은 floating 규칙에 앱 추가 |
| Ollama 연결 실패 | `ollama serve` 실행 중인지, `LLM_BASE_URL` 오타 확인 |
| 원격데스크톱/VM에서 빈 화면 | 렌더러 GPU 크래시 시 `--disable-gpu`로 자동 재시작됨. 그래도 안 되면 수동 실행: `npx electron out/main/index.js --disable-gpu` |
| 최소화하면 사라짐 | 타이틀바 `—`는 최소화(작업표시줄 유지). 완전히 숨기려면 트레이 아이콘 우클릭 → 보이기/숨기기, `Ctrl+Shift+T`로 복귀 |

## 6. 보안

- `npm run sec` — 정적 보안 점검 (하드코딩 시크릿, .env/토큰커밋 여부, CSP, webPreferences, ESM/CJS 크래시 재발 방지)
- MS 토큰 캐시(`msal-cache.json`)와 설정 저장소는 OS 앱 데이터 경로에 0600 권한으로 저장, `.gitignore`로 커밋 차단
- renderer는 `contextIsolation: true` + `nodeIntegration: false` + CSP, main 프로세스에서 모든 IPC 입력 길이/형식 검증
- 알려진 이슈: `npm audit`에서 `@azure/msal-node → uuid` moderate 2건. 수정에 msal-node 메이저 업그레이드(v6)가 필요해 보류 중. MS 로그인에만 영향, 로컬 모드와 무관.

## 라이선스

MIT
