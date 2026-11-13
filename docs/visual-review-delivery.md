# 申请单视觉复核自动交付

> 索引：[docs/README.md](./README.md)

本链路复用流程截图比较结果，自动生成视觉复核图文报告并写入独立「视觉复核记录」表。不会调用旧客户验收交付，不写「UI 验收明细」，不改权限、不发通知。

## 1. 从指定运行生成预览

```bash
npm run report:flow-customer -- results/visual-review/request-source.html \
  --script-key=request-flow/dev/golden-regression/by-account/menma_comic_com \
  --run=2026-10-15T02-00-01-626Z \
  --visual-review \
  --review-out=results/visual-review/request-dev-20261015
```

下一次运行将 `--run`、账号目录及输出目录替换为实际值。需要显式单账号运行，不允许与多运行 `--batch-id` 混用；不自动选择最新批次。

产物：

- `index.html`：本地预览，短结论 / 待办 → 红色差异 → 带「基线 / 当前」标签整页并排 → 最多两个局部对比 → 范围与限制。
- `visual-review.json`：绑定运行、内容及图片字节哈希的发布载荷。
- PNG：自动生成证据图。局部图使用已有差异区域裁剪，不沿用样例手写的菜单 / 图标坐标。

不使用旧自动「需要修复 / 无需处理」结论。存在像素变化或缺少基线的非过程截图进入待复核清单；其余状态列在检查范围。公共局部证据仅在坐标、基线像素、当前像素全部一致时集中展示，最多三个代表区域，标注关联状态；各状态完整差异图和整页证据仍保留，独有局部最多两个。未选为局部图的区域仍能在完整差异图中查看。局部截图不放大原始像素，避免窄区域拉成长图。分组数量不等于缺陷数量，不按整页相似度或差异百分比合并页面。当前不自动识别“新增某个菜单”这类业务语义，也不纳入工具定位异常记录；自动文案保持中性，人工复核结论在表中填写。

## 2. 检查预览及发布目标

### 搜索 / 筛选截图状态迁移

Golden 用例现在在结果断言成功后截图，再恢复默认列表。新截图标识为 `request-search-result`（单号搜索结果）与 `request-filter-result`（事由筛选结果）；旧标识仍保留历史展示名称，不将旧图改称结果态。

新标识不能沿用旧默认列表基线。首次采集后须人工核对结果态及基线，再进行比较；不要因缺少基线就自动批准。现有已发布批次不会随代码修改而变成新结果态。本轮仅做静态顺序回归和 Playwright 用例发现验证，尚未重新采集线上页面。

```bash
npm run deliver:visual-review -- \
  --manifest=results/visual-review/request-dev-20261015/visual-review.json
```

默认仅检查本地文件并显示哈希，不鉴权、不调用远端接口。查看 HTML 后确认截图、文字、范围及局部裁剪是否合适。

飞书环境配置（鉴权复用现有 `FEISHU_APP_ID` / `FEISHU_APP_SECRET` 或本地应用配置）：

```dotenv
FEISHU_VISUAL_REVIEW_APP_TOKEN=IheGbk3AdaEiaRsnNbtcvekMnDD
FEISHU_VISUAL_REVIEW_TABLE_ID=tbl7vXEpOjuogHO4
FEISHU_VISUAL_REVIEW_ORIGIN=https://blxv28dmue.feishu.cn
```

不从旧 `FEISHU_BITABLE_DETAIL_TABLE_ID` 读取目标；发布前回读核对新表字段类型，不自动建表、改字段或视图。可选复用 `FEISHU_DOC_FOLDER_TOKEN` 创建到既有报告文件夹；不修改分享权限，实际可见性遵循文件夹及飞书权限。

## 3. 明确批准后发布

```bash
npm run deliver:visual-review -- \
  --manifest=results/visual-review/request-dev-20261015/visual-review.json \
  --apply --approve-hash=<上一步显示的完整哈希>
```

每次正式交付创建独立文档、逐张内嵌图片，写入独立表附件，并建立双向链接。新记录初始为「待确认」，不写「复核结论」「复核人」。发布结束回读核对图片 token、附件及双向链接，再更新固定「申请单视觉复核 · 报告入口」。运行用例、生成本地报告不创建飞书文档。

固定入口仅展示最新正式交付（按首次发布顺序）和历史链接，不覆盖各次报告正文。相同目标共用一个入口，首次正式发布时创建，以后更新其专属文本块；不影响用户在入口添加的其他内容。重试历史交付不会将它提升为最新。最多登记 100 次交付，超过后明确提示需要归档，不静默丢弃历史。入口同步失败时，交付报告仍保留，重新执行可重试索引同步。

## 恢复与边界

- 交付回执集中保存在 `results/visual-review-deliveries/<目标哈希>/`，以运行交付 ID 定位；`index.json` 保存固定入口与历史。可用 `FEISHU_VISUAL_REVIEW_STATE_DIR` 指定持久目录。不要删除回执再重发，运行产物清理不得清理交付状态。
- 同一运行同一目标跨输出目录复用回执；内容哈希绑定图片字节、文案和文件名，不绑定输出绝对目录。相同运行的内容发生变化会拒绝覆盖，不会悄悄创建另一份。已有载荷需重新生成以使用新哈希规则；旧版同目录回执存在时首次发布会迁入集中目录，内容不匹配仍阻断，需人工核对。
- 同一内容、目标及回执可重复执行：复用文档和正文，不重复创建记录，不更新既有人工状态或结论。
- 正文 / 记录创建前写入 `pending`。超时等导致结果未知时停止自动恢复，不重放 POST；需人工核对远端，根据实际结果修复回执再继续。不能确认结果时，不要清除 pending。
- 图片替换是幂等操作；上传失败可再次执行，可能产生未引用的上传文件，但不会伪装成交付成功。
- 同一目标的本机并发通过集中目录的排他锁阻止。进程异常退出留下 `.lock` 时，确认没有发布进程后才能人工移除。不同机器必须持久同步回执并避免并发，不能将本机去重视为全局分布式保证。
- 同一交付内容 / 证据发生变化时拒绝使用旧回执；复测应选新运行，正式内容修订尚无专用版本命令，不能只换输出目录绕过去重。已发布文档不要一边手工编辑一边重试未完成的发布。
- 不自动在 Golden 运行后写飞书：采集 / 生成与外部发布分开，避免未经预览的批次直接发出。

## 验证

```bash
npm run verify:visual-review
npm run typecheck
```

专项验证覆盖运行与账号绑定、整页 / 局部图片生成、HTML 转义、证据篡改、重复执行、人工结论保护及创建超时阻断。

2026-10-15 已通过新入口实际发布指定历史批次并回读核验图片、附件及双向链接：

- [本次独立报告](https://blxv28dmue.feishu.cn/docx/AIuCdolAzoCPJsxi8ANcTlp3ngK)
- [固定报告入口](https://blxv28dmue.feishu.cn/docx/ZXA4dA3XqoXAc3xulfncmMhUngg)

这是旧截图状态的报告，不代表新结果态已经采集或基线已获批准；API 核验不代替非作者可读性试用。
