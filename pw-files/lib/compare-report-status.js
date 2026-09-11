const fs = require('fs');
const path = require('path');
const { send, logLine } = require('./ws-safe');

const COMPARE_REPORT_REL = path.join('results', 'screenshot-comparison.html');
/** @deprecated 历史混环境文件名，客户报告必须使用 env 后缀路径 */
const CUSTOMER_REPORT_REL = path.join('results', 'ui-regression-customer.html');

function customerReportRelForEnv(envId) {
  const id = String(envId || '').trim();
  if (!id) return '';
  return path.join('results', `ui-regression-customer-${id}.html`);
}

function repoHasScreenshotPng(dir) {
  if (!fs.existsSync(dir)) return false;
  let found = false;
  const walk = (current) => {
    if (found) return;
    let entries;
    try {
      entries = fs.readdirSync(current, { withFileTypes: true });
    } catch {
      return;
    }
    for (const ent of entries) {
      if (found) break;
      if (ent.name.startsWith('.')) continue;
      const full = path.join(current, ent.name);
      if (ent.isFile() && /\.png$/i.test(ent.name)) {
        found = true;
        break;
      }
      if (ent.isDirectory()) walk(full);
    }
  };
  walk(dir);
  return found;
}

function compareReportOpenPath() {
  return `/repo-report/${COMPARE_REPORT_REL.split(path.sep).join('/')}`;
}

function customerReportOpenPath(envId) {
  const rel = customerReportRelForEnv(envId) || CUSTOMER_REPORT_REL;
  return `/repo-report/${rel.split(path.sep).join('/')}`;
}

function sendCompareReportReady(ws, extra = {}) {
  send(ws, 'repo:compare-report:done', { ok: true, openPath: compareReportOpenPath(), ...extra });
  logLine(ws, `[repo] 对比报告就绪: ${compareReportOpenPath()}`, 'ok');
}

function sendCustomerReportReady(ws, extra = {}) {
  const envId = extra.envId;
  const openPath = extra.openPath || customerReportOpenPath(envId);
  send(ws, 'repo:customer-report:done', { ok: true, openPath, ...extra });
  logLine(ws, `[repo] 客户报告就绪: ${openPath}`, 'ok');
}

function readUiIssuesSummary(repoRoot) {
  const p = path.join(repoRoot, 'results/ui-issues.json');
  if (!fs.existsSync(p)) return null;
  try {
    const data = JSON.parse(fs.readFileSync(p, 'utf-8'));
    return data.summary || null;
  } catch {
    return null;
  }
}

function getCompareReportStatus(repoRoot, envId) {
  const absReport = path.join(repoRoot, COMPARE_REPORT_REL);
  const customerRel = customerReportRelForEnv(envId);
  const absCustomer = customerRel ? path.join(repoRoot, customerRel) : '';
  const hasReport = fs.existsSync(absReport);
  const hasCustomerReport = Boolean(absCustomer && fs.existsSync(absCustomer));
  const hasScreenshots = repoHasScreenshotPng(path.join(repoRoot, 'screenshots'));
  return {
    hasReport,
    hasCustomerReport,
    hasScreenshots,
    openPath: hasReport ? compareReportOpenPath() : null,
    customerOpenPath: hasCustomerReport ? customerReportOpenPath(envId) : null,
    reportRel: COMPARE_REPORT_REL,
    customerReportRel: customerRel || null,
    customerEnv: String(envId || '').trim() || null,
    uiIssues: readUiIssuesSummary(repoRoot),
  };
}

function isAllowedRepoPublicPath(fromRoot) {
  const parts = fromRoot.split('/');
  const top = parts[0];
  if (top === 'results' || top === 'screenshots' || top === 'screenshots-baseline') return true;
  if (top === 'public-reports') return true;
  if (top === 'playwright-report') return true;
  if ((top === 'request-flow' || top === 'approval-flow') && parts[1] === 'playwright-report') return true;
  return false;
}

/** 仅允许通过 Studio 暴露仓库内白名单目录 */
function resolveRepoPublicReadFile(repoRoot, urlRel) {
  const rel = decodeURIComponent(String(urlRel || '').replace(/\\/g, '/')).replace(/^\/+/, '');
  if (!rel || rel.split('/').some((s) => !s || s === '..')) return null;
  const abs = path.normalize(path.join(repoRoot, ...rel.split('/')));
  const root = path.resolve(repoRoot);
  if (!abs.startsWith(root + path.sep)) return null;
  const fromRoot = path.relative(root, abs).replace(/\\/g, '/');
  if (!isAllowedRepoPublicPath(fromRoot)) return null;
  return abs;
}

async function sendRepoUiIssues(ws, resolveRepoRoot) {
  const repoRoot = resolveRepoRoot();
  const p = path.join(repoRoot, 'results/ui-issues.json');
  if (!fs.existsSync(p)) {
    send(ws, 'repo:ui-issues', { ok: true, issues: [], summary: null });
    return;
  }
  try {
    const data = JSON.parse(fs.readFileSync(p, 'utf-8'));
    send(ws, 'repo:ui-issues', { ok: true, ...data });
  } catch (e) {
    send(ws, 'error', { message: `读取 ui-issues.json 失败: ${e.message}` });
    send(ws, 'repo:ui-issues', { ok: false });
  }
}

function sendCompareReportStatus(ws, repoRoot, envId) {
  send(ws, 'repo:compare-report:status', getCompareReportStatus(repoRoot, envId));
}

module.exports = {
  COMPARE_REPORT_REL,
  CUSTOMER_REPORT_REL,
  customerReportRelForEnv,
  repoHasScreenshotPng,
  compareReportOpenPath,
  customerReportOpenPath,
  readUiIssuesSummary,
  getCompareReportStatus,
  sendCompareReportReady,
  sendCustomerReportReady,
  resolveRepoPublicReadFile,
  sendRepoUiIssues,
  sendCompareReportStatus,
};
