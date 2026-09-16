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

## 2. Microsoft To Do 연결

1. https://entra.microsoft.com → **App registrations** → New registration
   - Supported account types: 개인 계정이면 `Personal Microsoft accounts only`
   - Redirect URI: 필요 없음 (Device Code Flow)
2. **API permissions** → Add → `Tasks.ReadWrite` (Delegated) + `offline_access` → Grant admin consent(개인 계정은 생략 가능)
3. **Overview**에서 Application (client) ID 복사
4. `.env` 설정:

```ini
TODO_BACKEND=mstodo
AZURE_CLIENT_ID=복사한ID
AZURE_TENANT_ID=consumers   # 개인: consumers / 회사: organizations / 둘다: common
```

5. `npm run dev` → 터미널에 `https://microsoft.com/devicelogin` + 코드 출력 → 브라우저에서 1회 로그인.
   이후 토큰은 `msal-cache.json`에 캐시되어 자동 갱신됩니다. (이 파일은 절대 커밋하지 마세요.)

## 3. LLM 연결

### 3-1. 앱 안에서 (Ollama 예시 — 무료/로컬)

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
```

## 5. 문제 해결

| 증상 | 해결 |
|---|---|
| `AZURE_CLIENT_ID가 필요합니다` | `.env`에 Client ID 설정했는지 확인 |
| Device login 후 401 | Entra API 권한 `Tasks.ReadWrite` 확인, 테넌트 ID가 `consumers`인지 확인 (개인 계정) |
| Linux에서 창이 뒤로 감 | 사용 중인 WM 확인. `setVisibleOnAllWorkspaces` 적용済, 타일링 WM은 floating 규칙에 앱 추가 |
| Ollama 연결 실패 | `ollama serve` 실행 중인지, `LLM_BASE_URL` 오타 확인 |

## 라이선스

MIT
