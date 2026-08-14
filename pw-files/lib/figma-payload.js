const fs = require('fs');
const path = require('path');

function mapFigmaCropUrls(base, crops) {
  if (!Array.isArray(crops)) return crops;
  return crops.map((c) => ({
    ...c,
    designUrl: c.designUrl || (c.designCrop ? `${base}/${c.designCrop}` : undefined),
    liveUrl: c.liveUrl || (c.liveCrop ? `${base}/${c.liveCrop}` : undefined),
    diffUrl: c.diffUrl || (c.diffCrop ? `${base}/${c.diffCrop}` : undefined),
  }));
}

function buildFigmaResultPayload(repoRoot, outRel) {
  const rel = String(outRel || '').replace(/^\/+/, '');
  if (!rel || rel.includes('..')) return null;
  const abs = path.join(repoRoot, rel);
  if (!fs.existsSync(abs)) return null;
  const base = '/' + rel.split(path.sep).join('/');
  const metaPath = path.join(abs, 'result.json');
  let meta = {};
  if (fs.existsSync(metaPath)) {
    try { meta = JSON.parse(fs.readFileSync(metaPath, 'utf-8')); } catch { /* ignore */ }
  }
  return {
    ok: true,
    outRel: rel,
    ...meta,
    designUrl: base + '/design.png',
    liveUrl: base + '/live.png',
    diffUrl: fs.existsSync(path.join(abs, 'diff.png')) ? base + '/diff.png' : undefined,
    reportUrl: fs.existsSync(path.join(abs, 'report.html')) ? base + '/report.html' : undefined,
    reportMdUrl: fs.existsSync(path.join(abs, 'report.md')) ? base + '/report.md' : undefined,
    specJsonUrl: fs.existsSync(path.join(abs, 'design-spec.json')) ? base + '/design-spec.json' : undefined,
    crops: mapFigmaCropUrls(base, meta.crops),
  };
}

function listFigmaResultDirs(root, requireReport = false) {
  if (!fs.existsSync(root)) return [];
  return fs
    .readdirSync(root)
    .filter((n) => {
      try {
        const abs = path.join(root, n);
        if (!fs.statSync(abs).isDirectory()) return false;
        const hasMeta = fs.existsSync(path.join(abs, 'result.json'));
        const hasReport = fs.existsSync(path.join(abs, 'report.html'));
        if (requireReport) return hasReport;
        return hasMeta || hasReport;
      } catch {
        return false;
      }
    })
    .map((n) => {
      const abs = path.join(root, n);
      let ts = fs.statSync(abs).mtimeMs;
      try {
        const metaPath = path.join(abs, 'result.json');
        if (fs.existsSync(metaPath)) {
          const meta = JSON.parse(fs.readFileSync(metaPath, 'utf-8'));
          if (meta.generatedAt) ts = new Date(meta.generatedAt).getTime();
        }
      } catch {
        /* 无 result.json 时回退目录 mtime */
      }
      return { name: n, mtime: ts };
    })
    .sort((a, b) => b.mtime - a.mtime);
}

module.exports = { mapFigmaCropUrls, buildFigmaResultPayload, listFigmaResultDirs };
