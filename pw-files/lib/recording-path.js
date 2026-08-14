const fs = require('fs');
const path = require('path');
const { stripAnsi } = require('./ws-safe');

function resolveRecordingPathViaRepo(repoRoot, { code, name, description, target = 'original', playwrightEnv }, spawn) {
  return new Promise((resolve, reject) => {
    const script = path.join(repoRoot, 'scripts/recording/resolve-recording-path.ts');
    if (!fs.existsSync(script)) {
      reject(new Error('未找到 scripts/recording/resolve-recording-path.ts'));
      return;
    }
    const npx = process.platform === 'win32' ? 'npx.cmd' : 'npx';
    const proc = spawn(npx, ['tsx', script, '--json'], {
      cwd: repoRoot,
      env: process.env,
      shell: false,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    let out = '';
    let err = '';
    proc.stdout.on('data', (d) => {
      out += d.toString();
    });
    proc.stderr.on('data', (d) => {
      err += d.toString();
    });
    proc.on('error', reject);
    proc.on('close', (exitCode) => {
      if (exitCode !== 0) {
        reject(new Error(stripAnsi(err || out || `resolve-recording-path 退出码 ${exitCode}`)));
        return;
      }
      try {
        resolve(JSON.parse(out.trim()));
      } catch (e) {
        reject(new Error(`解析保存路径 JSON 失败: ${e.message}`));
      }
    });
    proc.stdin.write(
      JSON.stringify({
        code: String(code || ''),
        name: name || undefined,
        description: description || undefined,
        target,
        playwrightEnv: playwrightEnv || undefined,
      }),
    );
    proc.stdin.end();
  });
}

module.exports = { resolveRecordingPathViaRepo };
