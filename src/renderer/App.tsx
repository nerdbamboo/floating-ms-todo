import { useCallback, useEffect, useState } from 'react';
import { SettingsPanel } from './SettingsPanel';

interface Task {
  id: string;
  listId: string;
  title: string;
  isCompleted: boolean;
  dueDate?: string | null;
}

const bridge = () => (window as unknown as { todo?: Window['todo'] }).todo;

export function App() {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [input, setInput] = useState('');
  const [agentInput, setAgentInput] = useState('');
  const [reply, setReply] = useState('자연어로 입력해보세요. 예: "내일 보고서 추가해줘"');
  const [opacity, setOpacity] = useState(0.95);
  const [busy, setBusy] = useState(false);
  const [showSettings, setShowSettings] = useState(false);

  const refresh = useCallback(async () => {
    const b = bridge();
    if (!b) {
      // 브라우저 미리보기용 더미
      setTasks([{ id: '1', listId: 'd', title: '(프리뷰) Electron에서 실행하세요: npm run dev', isCompleted: false }]);
      return;
    }
    try {
      setTasks(await b.list());
    } catch (e) {
      setReply(`목록 조회 실패: ${e instanceof Error ? e.message : String(e)}`);
    }
  }, []);

  useEffect(() => {
    refresh();
    const t = setInterval(refresh, 30_000);
    return () => clearInterval(t);
  }, [refresh]);

  const onAdd = async () => {
    const title = input.trim();
    if (!title || !bridge()) return;
    setBusy(true);
    try {
      await bridge()!.add({ title });
      setInput('');
      await refresh();
    } finally {
      setBusy(false);
    }
  };

  const onAgent = async () => {
    const text = agentInput.trim();
    if (!text || !bridge()) return;
    setBusy(true);
    try {
      const res = await bridge()!.agent(text);
      setReply(res.reply);
      setTasks(res.tasks);
      setAgentInput('');
    } catch (e) {
      setReply(`에이전트 실패: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setBusy(false);
    }
  };

  const toggle = async (t: Task) => {
    if (!bridge()) return;
    if (t.isCompleted) await bridge()!.uncomplete(t.id);
    else await bridge()!.complete(t.id);
    await refresh();
  };

  const openMsLoginHint = () => {
    setShowSettings(true);
  };

  return (
    <div className="float-card">
      <div className="titlebar">
        <span>☁️ Floating To Do</span>
        <div className="btns">
          <button title="MS 연결 안내" onClick={openMsLoginHint}>⚙</button>
          <button title="최소화 (작업표시줄에 유지)" onClick={() => bridge()?.minimize()}>—</button>
        </div>
      </div>
      <div className="body">
        {showSettings ? (
          <SettingsPanel onClose={() => setShowSettings(false)} onSaved={() => refresh()} />
        ) : (
        <>
        <div className="agent-row">
          <input
            value={agentInput}
            onChange={(e) => setAgentInput(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && onAgent()}
            placeholder='AI에게 말하기 (예: "내일 회의 준비 추가해줘")'
          />
          <button onClick={onAgent} disabled={busy}>✨</button>
        </div>
        <div className="reply">{reply}</div>
        <div className="add-row">
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && onAdd()}
            placeholder="직접 추가 + Enter"
          />
          <button onClick={onAdd} disabled={busy} style={{ border: '1px solid #d4d4d8', borderRadius: 8, background: 'white', cursor: 'pointer' }}>＋</button>
        </div>
        <div className="task-list">
          {tasks.filter((t) => !t.isCompleted).map((t) => (
            <TaskRow key={t.id} task={t} onToggle={() => toggle(t)} onDelete={async () => { await bridge()?.remove(t.id); await refresh(); }} />
          ))}
          {tasks.some((t) => t.isCompleted) && <div style={{ fontSize: 11, color: '#94a3b8' }}>완료됨</div>}
          {tasks.filter((t) => t.isCompleted).map((t) => (
            <TaskRow key={t.id} task={t} onToggle={() => toggle(t)} onDelete={async () => { await bridge()?.remove(t.id); await refresh(); }} />
          ))}
          {tasks.length === 0 && <div style={{ fontSize: 12, color: '#94a3b8' }}>할 일이 없습니다. 위에서 추가해보세요.</div>}
        </div>
        <div className="footer">
          <span>투명도</span>
          <input
            type="range" min={0.4} max={1} step={0.05} value={opacity}
            onChange={(e) => {
              const v = Number(e.target.value);
              setOpacity(v);
              bridge()?.setOpacity(v);
            }}
          />
          <button onClick={() => refresh()} style={{ cursor: 'pointer' }}>↻</button>
        </div>
        </>
        )}
      </div>
    </div>
  );
}

function TaskRow({ task, onToggle, onDelete }: { task: Task; onToggle: () => void; onDelete: () => void }) {
  return (
    <div className={`task ${task.isCompleted ? 'done' : ''}`}>
      <input type="checkbox" checked={task.isCompleted} onChange={onToggle} />
      <span className="t" onClick={onToggle}>{task.title}</span>
      {task.dueDate && <span className="due">~{task.dueDate}</span>}
      <button onClick={onDelete} title="삭제">×</button>
    </div>
  );
}
