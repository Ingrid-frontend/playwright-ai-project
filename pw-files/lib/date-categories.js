const fs = require('fs');
const path = require('path');
const { send, logLine, errText } = require('./ws-safe');

const DATE_CATEGORIES_REL = 'config/date-categories.json';

function resolveDateCategoriesPath(repoRoot) {
  const abs = path.resolve(repoRoot, DATE_CATEGORIES_REL);
  const base = path.resolve(repoRoot, 'config');
  if (!abs.startsWith(base + path.sep) && abs !== base) {
    throw new Error('路径超出 config 目录');
  }
  return abs;
}

function loadDateCategoriesFile(repoRoot) {
  const abs = resolveDateCategoriesPath(repoRoot);
  if (!fs.existsSync(abs)) {
    return {
      dateCategories: [],
      description:
        '日期分类配置，文件会根据创建日期归类到对应的文件夹。规则：早于第一个日期的文件归到第一个文件夹，在两个日期之间的文件归到后一个日期的文件夹。',
      example: { fileDate: '2026-03-16', category: '260313', reason: '早于 2026-03-13' },
      note: '目录名为 YYMMDD（6 位），如 260313；分类按完整日历日比较',
    };
  }
  const raw = fs.readFileSync(abs, 'utf8');
  const parsed = JSON.parse(raw);
  if (!Array.isArray(parsed.dateCategories)) {
    throw new Error('date-categories.json 缺少 dateCategories 数组');
  }
  return parsed;
}

async function configGetDateCategories(ws, deps) {
  const { resolveRepoRoot, normalizeDateCategoryList } = deps;
  const repoRoot = resolveRepoRoot();
  if (!fs.existsSync(path.join(repoRoot, 'playwright.config.ts'))) {
    send(ws, 'error', { message: '未找到项目根，无法读取日期分类' });
    return;
  }
  try {
    const config = loadDateCategoriesFile(repoRoot);
    const dateCategories = normalizeDateCategoryList(config.dateCategories);
    send(ws, 'config:date-categories:done', {
      dateCategories,
      description: config.description || '',
      configPath: DATE_CATEGORIES_REL,
      repoRoot,
    });
  } catch (e) {
    send(ws, 'error', { message: `读取失败: ${errText(e)}` });
  }
}

async function configSaveDateCategories(ws, msg, deps) {
  const { resolveRepoRoot, normalizeDateCategoryList } = deps;
  const repoRoot = resolveRepoRoot();
  if (!fs.existsSync(path.join(repoRoot, 'playwright.config.ts'))) {
    send(ws, 'error', { message: '未找到项目根，无法保存日期分类' });
    return;
  }
  try {
    const dateCategories = normalizeDateCategoryList(msg.dateCategories);
    const existing = loadDateCategoriesFile(repoRoot);
    const next = { ...existing, dateCategories };
    const abs = resolveDateCategoriesPath(repoRoot);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, `${JSON.stringify(next, null, 2)}\n`, 'utf8');
    send(ws, 'config:date-categories:saved', { dateCategories, configPath: DATE_CATEGORIES_REL });
    logLine(ws, `[config] 已保存 ${DATE_CATEGORIES_REL}`, 'ok');
  } catch (e) {
    send(ws, 'error', { message: errText(e) });
  }
}

module.exports = {
  DATE_CATEGORIES_REL,
  resolveDateCategoriesPath,
  loadDateCategoriesFile,
  configGetDateCategories,
  configSaveDateCategories,
};
