/**
 * scripts/check-security.mjs
 * --------------------------
 * `npm run sec` 로 실행하는 정적 보안 점검 (의존성 없이 node stdlib만 사용).
 * 검사 항목:
 *  1. 하드코딩된 시크릿 (API 키, 토큰, 클라이언트 시크릿 패턴)
 *  2. .env / msal-cache.json / store.json 이 .gitignore에 있는지
 *  3. renderer CSP 메타태그 존재 여부
 *  4. main 프로세스 보안 기본값 (contextIsolation on, nodeIntegration off)
 *  5. ESM-only 의존성의 CJS require 여부 (이번 크래시 재발 방지)
 * 하나라도 실패하면 exit 1.
 */
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
let failures = 0;

function fail(msg) {
  failures++;
  console.error(`[FAIL] ${msg}`);
}
function pass(msg) {
  console.log(`[ok] ${msg}`);
}
function read(p) {
  return readFileSync(join(root, p), 'utf-8');
}

// 1. 하드코딩 시크릿 스캔 (src 전체)
const secretPatterns = [
  /sk-[A-Za-z0-9]{8,}/, // OpenAI 키
  /gho_[A-Za-z0-9_]+/, // GitHub 토큰
  /xox[bpas]-[A-Za-z0-9-]+/, // Slack
  /AIza[A-Za-z0-9_-]{10,}/, // Google API 키
  /client[_-]?secret\s*[:=]\s*['"][^'"]+['"]/i,
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/
];
const { execSync } = await import('node:child_process');
let tracked = [];
try {
  tracked = execSync('git ls-files src package.json', { cwd: root, encoding: 'utf-8' })
    .split('\n')
    .map((s) => s.trim())
    .filter(Boolean);
} catch {
  tracked = [];
}
if (tracked.length === 0) fail('git 추적 파일을 읽지 못했습니다 (git ls-files 실패)');
for (const f of tracked) {
  const content = read(f);
  for (const re of secretPatterns) {
    if (re.test(content)) fail(`${f} 에 시크릿 패턴(${re}) 발견`);
  }
}
pass('하드코딩 시크릿 스캔 완료');

// 2. 민감 파일 gitignore 확인 + 실제 커밋 여부
const gi = existsSync(join(root, '.gitignore')) ? read('.gitignore') : '';
for (const must of ['.env', 'msal-cache.json']) {
  if (!gi.split('\n').some((l) => l.trim() && !l.trim().startsWith('#') && l.includes(must))) {
    fail(`.gitignore에 ${must} 규칙 없음`);
  }
}
let allFiles = '';
try {
  allFiles = execSync('git ls-files', { cwd: root, encoding: 'utf-8' });
} catch {
  allFiles = '';
}
const sensitiveTracked = allFiles
  .split('\n')
  .map((s) => s.trim())
  .filter((f) => /(^|\/)\.env(\.local)?$/.test(f) || /(^|\/)msal-cache\.json$/.test(f) || /(^|\/)store\.json$/.test(f));
if (sensitiveTracked.length > 0) fail(`민감 파일이 git에 커밋됨:\n${sensitiveTracked.join('\n')}`);
else pass('민감 파일(.env, 토큰 캐시) 미커밋 + gitignore OK');

// 3. CSP
const html = read('src/renderer/index.html');
if (!html.includes('Content-Security-Policy')) fail('renderer index.html에 CSP 메타태그 없음');
else pass('renderer CSP 존재');

// 4. main 보안 기본값
const mainSrc = read('src/main/index.ts');
if (!/contextIsolation:\s*true/.test(mainSrc)) fail('contextIsolation:true 없음');
if (!/nodeIntegration:\s*false/.test(mainSrc)) fail('nodeIntegration:false 없음');
if (/nodeIntegration:\s*true/.test(mainSrc)) fail('nodeIntegration:true 발견!');
pass('main webPreferences 기본값 OK');

// 5. CJS/ESM 크래시 재발 방지: main 번들에 require()되는 외부 dep이 ESM-only인지 검사
const pkg = JSON.parse(read('package.json'));
const mainDeps = ['electron-store'];
for (const d of mainDeps) {
  if (pkg.dependencies?.[d] || pkg.devDependencies?.[d]) {
    fail(`${d} 의존성 발견 — ESM-only 패키지는 main(CJS)에서 크래시 유발. src/main/store.ts 사용`);
  }
}
pass('ESM-only 위험 의존성 없음');

if (failures > 0) {
  console.error(`\n보안 점검 실패: ${failures}건`);
  process.exit(1);
}
console.log('\n보안 점검 통과');
