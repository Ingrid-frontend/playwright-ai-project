/**
 * 迭代目录码：配置与文件夹使用 YYMMDD（如 260116）；分类比较按完整日历日（等同 20260116）。
 * 兼容历史 YYYYMMDD 配置与目录名。
 */
const fs = require("fs");
const path = require("path");

function parseDateCategoryToDate(code) {
  const s = String(code || "").trim();
  if (/^\d{6}$/.test(s)) {
    const y = 2000 + parseInt(s.slice(0, 2), 10);
    const m = parseInt(s.slice(2, 4), 10) - 1;
    const d = parseInt(s.slice(4, 6), 10);
    return new Date(y, m, d);
  }
  if (/^\d{8}$/.test(s)) {
    const y = parseInt(s.slice(0, 4), 10);
    const m = parseInt(s.slice(4, 6), 10) - 1;
    const d = parseInt(s.slice(6, 8), 10);
    return new Date(y, m, d);
  }
  throw new Error(`无效日期分类：${code}`);
}

function toShortDateCategoryCode(input) {
  const s = String(input || "").trim();
  if (/^\d{6}$/.test(s)) return validateShortDateCategoryCode(s);
  if (/^\d{8}$/.test(s)) return validateShortDateCategoryCode(s.slice(2));
  throw new Error(`日期格式须为 6 位 YYMMDD，如 260717：${s || "(空)"}`);
}

/** 校验 6 位 YYMMDD 是否为合法日历日 */
function validateShortDateCategoryCode(input) {
  const s = String(input || "").trim();
  if (!/^\d{6}$/.test(s)) {
    throw new Error(`日期格式须为 6 位 YYMMDD，如 260717：${s || "(空)"}`);
  }
  const y = 2000 + parseInt(s.slice(0, 2), 10);
  const m = parseInt(s.slice(2, 4), 10);
  const d = parseInt(s.slice(4, 6), 10);
  if (m < 1 || m > 12) throw new Error(`月份无效：${s}`);
  const dt = new Date(y, m - 1, d);
  if (dt.getFullYear() !== y || dt.getMonth() !== m - 1 || dt.getDate() !== d) {
    throw new Error(`日期无效：${s}`);
  }
  return s;
}

function isDateCategoryDirSegment(seg) {
  return /^\d{6}$/.test(seg) || /^\d{8}$/.test(seg);
}

function compareDateCategoryCodes(a, b) {
  return parseDateCategoryToDate(a).getTime() - parseDateCategoryToDate(b).getTime();
}

function normalizeDateCategoryList(list) {
  if (!Array.isArray(list)) throw new Error("dateCategories 须为数组");
  const out = [];
  const seen = new Set();
  for (const item of list) {
    const short = toShortDateCategoryCode(item);
    const timeKey = String(parseDateCategoryToDate(short).getTime());
    if (seen.has(timeKey)) throw new Error(`重复日期：${short}`);
    seen.add(timeKey);
    out.push({ short, time: parseDateCategoryToDate(short).getTime() });
  }
  if (!out.length) throw new Error("至少保留一个日期分类");
  out.sort((a, b) => a.time - b.time);
  return out.map((x) => x.short);
}

function formatDateCategoryCalendarLabel(code) {
  const d = parseDateCategoryToDate(code);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/** @param {string} dateKey YYYY-MM-DD 或 YYYYMMDD */
function getDateCategoryForCalendarDay(dateKey, configPath) {
  let fileDate;
  if (/^\d{4}-\d{2}-\d{2}$/.test(dateKey)) {
    const [y, m, d] = dateKey.split("-").map(Number);
    fileDate = new Date(y, m - 1, d);
  } else if (/^\d{8}$/.test(dateKey)) {
    const y = parseInt(dateKey.slice(0, 4), 10);
    const m = parseInt(dateKey.slice(4, 6), 10) - 1;
    const d = parseInt(dateKey.slice(6, 8), 10);
    fileDate = new Date(y, m, d);
  } else {
    console.warn(`⚠️  无法解析日期分类键: ${dateKey}`);
    return "default";
  }

  const abs =
    configPath || path.join(process.cwd(), "config", "date-categories.json");
  if (!fs.existsSync(abs)) {
    console.warn(`⚠️  配置文件不存在: ${abs}`);
    return "default";
  }

  try {
    const config = JSON.parse(fs.readFileSync(abs, "utf-8"));
    const categories = normalizeDateCategoryList(config.dateCategories || []);

    for (const category of categories) {
      const categoryDate = parseDateCategoryToDate(category);
      if (fileDate <= categoryDate) {
        return category;
      }
    }

    return categories[categories.length - 1];
  } catch (error) {
    console.warn(`⚠️  读取 date-categories 失败: ${error}`);
    return "default";
  }
}

module.exports = {
  parseDateCategoryToDate,
  validateShortDateCategoryCode,
  toShortDateCategoryCode,
  isDateCategoryDirSegment,
  compareDateCategoryCodes,
  normalizeDateCategoryList,
  formatDateCategoryCalendarLabel,
  getDateCategoryForCalendarDay,
};
