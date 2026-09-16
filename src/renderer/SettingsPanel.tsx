import { useEffect, useState } from 'react';

const bridge = () => (window as unknown as { todo?: Window['todo'] }).todo;
const err = (e: unknown) => (e instanceof Error ? e.message : String(e));

export function SettingsPanel({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const [dto, setDto] = useState<SettingsDTO | null>(null);
  const [auth, setAuth] = useState<AuthStatus | null>(null);
  const [f, setF] = useState({ todoBackend: 'memory', azureClientId: '', azureTenantId: 'consumers', llmProvider: 'mock', llmBaseUrl: '', llmModel: '', llmApiKey: '' });
  const [code, setCode] = useState<DeviceCodeInfo | null>(null);
  const [msg, setMsg] = useState('');
  const [testRes, setTestRes] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const b = bridge();
    if (!b) return;
    b.settings().then((d) => {
      setDto(d);
      setF({ todoBackend: d.todoBackend, azureClientId: d.azureClientId, azureTenantId: d.azureTenantId, llmProvider: d.llmProvider, llmBaseUrl: d.llmBaseUrl, llmModel: d.llmModel, llmApiKey: '' });
    }).catch((e) => setMsg(`설정 로드 실패: ${err(e)}`));
    b.authStatus().then(setAuth).catch(() => undefined);
    const off = b.onAuthEvent?.((kind, payload) => {
      if (kind === 'changed') {
        setAuth(payload as AuthStatus);
        setCode(null);
        onSaved();
      } else if (kind === 'device-code') {
        setCode(payload as DeviceCodeInfo);
      }
    });
    return () => off?.();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
    setF((p) => ({ ...p, [k]: e.target.value }));

  const doSave = async () => {
    const b = bridge();
    if (!b) return;
    setBusy(true);
    try {
      const d = await b.saveSettings({ ...f, llmApiKey: f.llmApiKey || undefined });
      setDto(d);
      setF((p) => ({ ...p, llmApiKey: '' }));
      setMsg('저장됨. 백엔드/LLM에 즉시 적용됐습니다.');
      const st = await b.authStatus();
      setAuth(st);
      onSaved();
    } catch (e) {
      setMsg(`저장 실패: ${err(e)}`);
    } finally {
      setBusy(false);
    }
  };

  const doTest = async () => {
    const b = bridge();
    if (!b) return;
    setBusy(true);
    setTestRes('연결 중…');
    try {
      const r = await b.testLlm({ provider: f.llmProvider, baseUrl: f.llmBaseUrl, apiKey: f.llmApiKey || undefined, model: f.llmModel });
      setTestRes(r.ok ? `성공 (${r.provider}): ${r.reply}` : `실패: ${r.error}`);
    } catch (e) {
      setTestRes(`실패: ${err(e)}`);
    } finally {
      setBusy(false);
    }
  };

  const doBrowserLogin = async () => {
    const b = bridge();
    if (!b) return;
    setBusy(true);
    setMsg('브라우저가 열리면 로그인하세요…');
    try {
      const r = await b.loginInteractive();
      setMsg(`로그인됨: ${r.username}`);
    } catch (e) {
      setMsg(`로그인 실패: ${err(e)}`);
    } finally {
      setBusy(false);
    }
  };

  const doDeviceLogin = async () => {
    const b = bridge();
    if (!b) return;
    setBusy(true);
    setMsg('코드 발급 중…');
    try {
      const info = await b.loginDevice();
      setCode(info);
      setMsg('아래 코드를 브라우저에 입력하세요.');
    } catch (e) {
      setMsg(`실패: ${err(e)}`);
    } finally {
      setBusy(false);
    }
  };

  const doLogout = async () => {
    const b = bridge();
    if (!b) return;
    await b.logout();
    setAuth(await b.authStatus());
    setMsg('로그아웃됨.');
  };

  const doCopy = async (t: string) => {
    try {
      await bridge()?.copyText(t);
      setMsg('복사됨.');
    } catch (e) {
      setMsg(`복사 실패: ${err(e)}`);
    }
  };

  return (
    <div className="settings">
      <div className="settings-head">
        <strong>설정</strong>
        <button onClick={onClose}>✕</button>
      </div>
      <div className="settings-scroll">
        <section>
          <h4>Microsoft To Do</h4>
          <label>백엔드
            <select value={f.todoBackend} onChange={set('todoBackend')}>
              <option value="memory">로컬 (로그인 불필요)</option>
              <option value="mstodo">Microsoft To Do</option>
            </select>
          </label>
          {f.todoBackend === 'mstodo' && (
            <>
              <label>Client ID (Entra 앱 등록)
                <input value={f.azureClientId} onChange={set('azureClientId')} placeholder="00000000-…" spellCheck={false} />
              </label>
              <label>Tenant
                <select value={f.azureTenantId} onChange={set('azureTenantId')}>
                  <option value="consumers">consumers (개인)</option>
                  <option value="organizations">organizations (회사/학교)</option>
                  <option value="common">common (둘 다)</option>
                </select>
              </label>
            </>
          )}
          <div className="statusline">
            {auth?.backend === 'mstodo'
              ? auth.loggedIn ? `로그인됨: ${auth.username}` : '로그아웃 상태'
              : '로컬 모드 (MS 로그인 불필요)'}
          </div>
          {f.todoBackend === 'mstodo' && (
            <div className="btnrow">
              {!auth?.loggedIn ? (
                <>
                  <button onClick={doBrowserLogin} disabled={busy}>브라우저로 로그인</button>
                  <button onClick={doDeviceLogin} disabled={busy}>코드로 로그인</button>
                </>
              ) : (
                <button onClick={doLogout}>로그아웃</button>
              )}
            </div>
          )}
          {code && (
            <div className="codebox">
              <div><a href={code.verificationUri} onClick={(e) => e.preventDefault()}>{code.verificationUri}</a> 로 이동 후</div>
              <div className="bigcode">{code.userCode} <button onClick={() => doCopy(code.userCode)}>복사</button></div>
              <div className="hint">입력하면 자동으로 로그인됩니다.</div>
            </div>
          )}
        </section>
        <section>
          <h4>AI (LLM)</h4>
          <label>공급자
            <select value={f.llmProvider} onChange={set('llmProvider')}>
              <option value="mock">mock (테스트용)</option>
              <option value="ollama">Ollama (로컬)</option>
              <option value="openai">OpenAI</option>
              <option value="compatible">OpenAI 호환 (vLLM/LM Studio 등)</option>
            </select>
          </label>
          {f.llmProvider !== 'mock' && (
            <>
              <label>Base URL
                <input value={f.llmBaseUrl} onChange={set('llmBaseUrl')} spellCheck={false} />
              </label>
              <label>API 키 {dto?.hasLlmKey && <span className="hint">(저장됨·{dto.keyProtection === 'os-keychain' ? 'OS 키체인 암호화' : '평문'}) — 비워두면 유지</span>}
                <input type="password" value={f.llmApiKey} onChange={set('llmApiKey')} placeholder={dto?.hasLlmKey ? '•••••• (유지)' : 'sk-… / ollama는 비워둠'} />
              </label>
              <label>모델
                <input value={f.llmModel} onChange={set('llmModel')} spellCheck={false} />
              </label>
              <div className="btnrow">
                <button onClick={doTest} disabled={busy}>연결 테스트</button>
                {dto?.hasLlmKey && (
                  <button onClick={async () => { await bridge()?.clearLlmKey(); setDto(await bridge()!.settings()); setMsg('API 키 삭제됨.'); }}>키 삭제</button>
                )}
              </div>
              {testRes && <div className="statusline">{testRes}</div>}
            </>
          )}
        </section>
        <div className="btnrow">
          <button className="primary" onClick={doSave} disabled={busy}>저장 후 적용</button>
        </div>
        {msg && <div className="statusline">{msg}</div>}
      </div>
    </div>
  );
}
