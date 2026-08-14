function buildHtmlReport(data, code) {
  return `<!DOCTYPE html>
<html lang="zh-CN">
<head><meta charset="UTF-8"><title>Playwright Studio Report</title>
<style>
body{font-family:monospace;background:#0a0c10;color:#e8edf5;padding:32px;max-width:900px;margin:0 auto}
h1{font-size:24px;margin-bottom:24px;color:#00d97e}
.grid{display:grid;grid-template-columns:repeat(4,1fr);gap:12px;margin-bottom:24px}
.card{background:#151921;border-radius:10px;padding:16px;border:1px solid rgba(255,255,255,.07)}
.val{font-size:28px;font-weight:700;margin-bottom:4px}
.lbl{font-size:11px;color:#6b7a99}
.ok{color:#00d97e}.fail{color:#ff4d6a}.info{color:#4d9fff}.warn{color:#f5a623}
pre{background:#151921;border-radius:10px;padding:20px;overflow-x:auto;font-size:11px;line-height:1.7;border:1px solid rgba(255,255,255,.07)}
.meta{color:#6b7a99;font-size:11px;margin-bottom:24px}
</style></head>
<body>
<h1>📊 Playwright Studio Report</h1>
<div class="meta">生成时间: ${new Date().toLocaleString('zh-CN')}</div>
<div class="grid">
<div class="card"><div class="val ok">${data.passed}</div><div class="lbl">通过</div></div>
<div class="card"><div class="val fail">${data.failed}</div><div class="lbl">失败</div></div>
<div class="card"><div class="val info">${data.total}</div><div class="lbl">总用例</div></div>
<div class="card"><div class="val warn">${data.duration}s</div><div class="lbl">耗时</div></div>
</div>
<h2 style="font-size:14px;margin-bottom:12px;color:#6b7a99">优化后脚本</h2>
<pre>${code.replace(/</g,'&lt;')}</pre>
</body></html>`;
}

module.exports = { buildHtmlReport };
