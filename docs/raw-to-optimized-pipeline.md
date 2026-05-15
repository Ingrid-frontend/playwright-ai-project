# Raw 录制 → 预处理 → optimize-raw-recordings 流水线

## 1. 目标

- 在**不修改** `optimize-raw-recordings` 核心逻辑的前提下，增加**预处理**层。
- 将 `tests/raw-recordings/original/<batch>/` 中的备份（可含首行中文标题）转为合法 `.spec.ts`，写入 **`tests/raw-recordings/<batch>/processed/`**，再交给现有优化脚本生成 `tests/optimized/**.optimized.spec.ts`。
- `playwright.config` 已忽略 `**/raw-recordings/**`，中间产物不会进入默认 `npm test`。

---

## 2. 目录约定

| 路径 | 含义 |
|------|------|
| `tests/raw-recordings/original/<batch>/*.spec.ts` | 人工 / codegen 原始备份（`optimize-raw-recordings` **默认不递归 `original`**） |
| `tests/raw-recordings/<batch>/processed/*.spec.ts` | 预处理后、可供优化的合法 spec |
| `tests/optimized/<日期分类>/*.optimized.spec.ts` | 最终用例（由 `optimize-raw-recordings` 生成，子目录规则见该脚本） |

---

## 3. npm 脚本

| 脚本 | 作用 |
|------|------|
| `npm run preprocess-raw-recordings` | 默认处理 `tests/raw-recordings/original` 下全部 `.spec.ts`，无参数时等于该目录 |
| `npm run preprocess-raw-recordings -- <目录或单文件>` | 只处理指定路径 |
| `npm run pipeline-raw-to-optimized` | 先 `preprocess`，再对每个生成的 `processed` 目录执行 `optimize-raw-recordings` |
| `npm run pipeline-raw-to-optimized -- <目录或单文件>` | 同上，限定输入范围 |
| `npm run optimize-raw-recordings -- <目录>` | 仅第二步（需已有 `processed` 产物） |

**示例**

```bash
npm run preprocess-raw-recordings -- tests/raw-recordings/original/20260512
npm run optimize-raw-recordings -- tests/raw-recordings/20260512/processed
# 或一条命令
npm run pipeline-raw-to-optimized -- tests/raw-recordings/original/20260512
```

---

## 4. 预处理做了什么（代码位置）

实现文件：`scripts/preprocess/preprocess-raw-recordings.ts`

| 步骤 | 函数 | 行为 |
|------|------|------|
| ① | `stripBom` | 去 UTF-8 BOM |
| ② | `stripLeadingRecordingTitle` | 若首条非空行为「标题样式」（无 `import`/`()` 等），且后续出现 `import`，则删除该行 |
| ③ | `ensurePlaywrightImport` | 若无 `from '@playwright/test'`，补充 `import { test, expect }` |
| ④ | `ensureTestWrapper` | 若无 `test('...')` 且存在 `await page.`，则用标准 `test` 包一层 |

输出路径：`resolveProcessedOutputPath` — `tests/raw-recordings/original/<batch>/x.spec.ts` → `tests/raw-recordings/<batch>/processed/x.spec.ts`。  
若输入不在 `original` 下，则落在同目录 `processed/<basename>`。

流水线：`scripts/preprocess/pipeline-raw-to-optimized.ts`（先调预处理，再对对应 `processed` 目录调 `optimize-raw-recordings.ts`）。

---

## 5. 调整记录（实现步骤日志）

| 序号 | 调整项 | 说明 |
|------|--------|------|
| 1 | 新增 `scripts/preprocess/preprocess-raw-recordings.ts` | 实现 BOM/标题剥离、import、test 壳、写出 `processed` |
| 2 | 新增 `scripts/preprocess/pipeline-raw-to-optimized.ts` | 串联预处理与 `optimize-raw-recordings`，按 `processed` 目录去重调用 |
| 3 | 修改 `package.json` | 增加 `preprocess-raw-recordings`、`pipeline-raw-to-optimized` |
| 4 | 仅作为 CLI 时执行 `main` | 通过 `process.argv` 匹配本脚本路径，避免被 pipeline `import` 时副作用执行 |
| 5 | 新增本文档 `docs/raw-to-optimized-pipeline.md` | 记录用法与每一步变更 |
| 6 | 验证 | 对 `original/20260512` 跑通预处理 + 优化，生成 `tests/optimized/.../*.optimized.spec.ts`（具体子目录由优化脚本内日期分类逻辑决定） |

---

## 6. 风险与后续可做

| 项 | 说明 |
|----|------|
| `setInputFiles` 相对路径 | 预处理未自动改写；需在仓库中放置附件或后续加 `testdata` / TODO 标注 |
| 与优化器重复去重 | 噪声/重复步骤仍以 `optimize-raw-recordings` 为主；预处理不做同类合并，避免双次删除 |
| `processed` 是否入库 | 可由团队决定提交或 `.gitignore`；流水线在 CI 中可「只生成不落库」 |

---

## 7. 变更履历（按时间追加）

| 日期 | 变更 |
|------|------|
| 2026-05-12 | 首版：预处理脚本、pipeline、`package.json`、本文档；验证 `20260512` 三份 original → processed → optimized |
