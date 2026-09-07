# UI 验收报告「结论 / 衰退明细 / 检测范围」修复记录

## 诊断结论

用户反馈报告不清晰、问题难定位、普通用户难理解。核对报告生成链路与真实产物（9-4 / 9-3 报告 + 两份 summary JSON）后，定位为 **分析/口径问题为主（约七成），数据完备性为辅（约三成）**，不是「算法判错」。

| # | 根因 | 类型 |
|---|---|---|
| 1 | 「通过率 100%」但 35% 步骤未覆盖，`passRate` 分母只算已检测步骤 | 口径 |
| 2 | summary JSON 与 HTML 各自硬编码 headline，飞书消息与网页结论打架 | 口径 |
| 3 | 未覆盖占比高时 verdict 仍给绿色、shipAdvice 仍说「可发版」 | 口径 |
| 4 | `clusterKeyFor()` 混入 stepName，跨步骤分组永远失效，问题永远「影响 1 步」 | 分析 |
| 5 | reason 文案含「逐像素比对」「18x14」「成块变化」「抗锯齿」等黑话 | 表达 |
| 6 | 术语不一致（验收基线 vs 上次验收标准）、expense-list 英文泄漏 | 表达 |
| 7 | 未覆盖项按「页面 × 环境」平铺重复、approval-flow 4 步无 run 数据 | 数据 |

## 已修复

- **P0 口径**：`buildHeadline()` 统一结论标题；`COVERAGE_GAP_RATIO=0.3` 驱动 verdict 颜色与发版建议降级；`buildActionItems` 与发版建议口径对齐；verdict-foot 去掉误导性「通过率 100%」。
- **P1 分组**：`clusterKeyFor()` 去掉 stepName，恢复跨步骤根因归并。
- **P2 表达**：reason/图例/plainText 去技术黑话；补 expense-flow slug；未覆盖说明增加「去重后 N 个页面」。

## 验证结果

- `tsc --noEmit`：改动文件无新增类型错误（既有 3 处属 9-01 遗留批次）。
- `smoke-report-modules`：全绿（同步更新 2 处断言）。
- 重新生成报告：headline 一致、verdict 由绿转琥珀、shipAdvice 降级 baseline、actionItems 一致、`expense-list` 0 次泄漏。
- 分组聚合临时脚本验证：两个不同 stepName 同根因 slot 正确合并为 1 组、`affectedSteps=2`。

## 遗留（需决策）

- **P3** 差异框业务语义（「审批单标题」「表格表头」）需接 DOM/选择器数据，工作量大，单独排期。
- **数据完备性**：approval-flow 4 步无采集数据、request-flow 多环境无基线，属数据侧需补。
