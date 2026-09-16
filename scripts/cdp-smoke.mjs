/**
 * scripts/cdp-smoke.mjs
 * ---------------------
 * `npm run smoke` — 빌드된 앱을 실제로 띄우고 CDP로 renderer에서
 * window.todo 브릿지(설정/MS/LLM IPC)를 end-to-end 호출해 검증합니다.
 * 헤드리스 CI나 GPU 없는 환경에서도 --disable-gpu로 동작합니다.
 */
import { spawn } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import WebSocket from 'ws';

const PORT = 9333;
const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const electronBin = join(root, 'node_modules', 'electron', 'dist', 'electron.exe');

async function getPageTarget() {
  for (let i = 0; i < 60; i++) {
    try {
      const res = await fetch(`http://127.0.0.1:${PORT}/json`);
      const targets = await res.json();
      const page = targets.find((t) => t.type === 'page' && t.url.includes('index.html'));
      if (page) return page;
    } catch {
      /* 아직 기동 중 */
    }
    await sleep(1000);
  }
  throw new Error('page target을 찾지 못했습니다');
}

function connect(wsUrl) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(wsUrl, { maxPayload: 64 * 1024 * 1024 });
    ws.once('open', () => resolve(ws));
    ws.once('error', reject);
  });
}

let msgId = 0;
const pending = new Map();
function send(ws, method, params = {}) {
  const id = ++msgId;
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject });
    ws.send(JSON.stringify({ id, method, params }));
  });
}

async function evaluate(ws, expression) {
  const res = await send(ws, 'Runtime.evaluate', {
    expression,
    awaitPromise: true,
    returnByValue: true
  });
  if (res.exceptionDetails) {
    throw new Error(`evaluate 실패: ${JSON.stringify(res.exceptionDetails).slice(0, 500)}`);
  }
  return res.result?.value;
}

const checks = [
  ['settings()에 키 본문 없음', `await window.todo.settings().then(d => ({...d, _noKey: !('llmApiKey' in d)}))`],
  ['authStatus() memory 모드', `await window.todo.authStatus()`],
  ['testLlm(mock) 성공', `await window.todo.testLlm({provider:'mock'})`],
  ['saveSettings 라운드트립', `await window.todo.saveSettings({llmProvider:'mock', llmModel:'llama3.1'})`],
  ['todo CRUD', `await window.todo.add({title:'smoke-' + Date.now()}).then(t => window.todo.complete(t.id).then(() => window.todo.remove(t.id)).then(() => 'crud-ok'))`],
  ['agent(mock) 동작', `await window.todo.agent('스모크 테스트').then(r => typeof r.reply === 'string' ? 'agent-ok' : 'agent-bad')`],
  ['미니바 접기/펼치기', `await window.todo.collapse().then(() => window.todo.expand()).then(() => 'mini-ok')`]
];

async function main() {
  const child = spawn(electronBin, ['out/main/index.js', `--remote-debugging-port=${PORT}`, '--disable-gpu'], {
    cwd: root,
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true
  });
  let stdout = '';
  child.stdout.on('data', (d) => (stdout += d.toString()));
  let failures = 0;
  try {
    const page = await getPageTarget();
    console.log(`[ok] 페이지 로드: ${page.title} :: ${page.url}`);
    if (stdout.includes('Renderer process crashed')) {
      console.error('[FAIL] 렌더러 크래시 발생');
      failures++;
    }
    const ws = await connect(page.webSocketDebuggerUrl);
    ws.on('message', (raw) => {
      const m = JSON.parse(raw.toString());
      if (m.id && pending.has(m.id)) {
        const { resolve, reject } = pending.get(m.id);
        pending.delete(m.id);
        if (m.error) reject(new Error(m.error.message));
        else resolve(m.result);
      }
    });
    for (const [name, expr] of checks) {
      try {
        const value = await evaluate(ws, `(async () => (${expr}))()`);
        console.log(`[ok] ${name}: ${JSON.stringify(value).slice(0, 300)}`);
      } catch (e) {
        failures++;
        console.error(`[FAIL] ${name}: ${String(e).slice(0, 300)}`);
      }
    }
    ws.close();
  } catch (e) {
    failures++;
    console.error(`[FAIL] ${String(e).slice(0, 500)}`);
  } finally {
    child.kill();
    await sleep(1000);
    try {
      process.platform === 'win32' && (await import('node:child_process')).execSync('taskkill /F /IM electron.exe');
    } catch {
      /* 이미 종료됨 */
    }
  }
  if (failures > 0) {
    console.error(`\n스모크 실패: ${failures}건`);
    process.exit(1);
  }
  console.log('\n스모크 통과');
}

main();
