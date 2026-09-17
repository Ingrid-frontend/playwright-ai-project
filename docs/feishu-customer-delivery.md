# 客户验收报告 · 飞书交付（多维表 + 文档）

> 索引：[docs/README.md](./README.md)

> 面向对象：要把验收结论发给客户的人。
> 什么时候看这篇：本地 HTML 报告用来自己核对，**发给客户走这条链路**——图片进飞书多维表，正文进飞书文档，客户拿到的是一个链接。

---

## 1. 为什么不用本地 HTML

`results/ui-regression-customer.html` 里的 300 多张对比图全部是**相对路径**（`../screenshots/...`），
单独把 HTML 发出去，客户打开只会看到一片裂图。而且报告产物目录是 gitignore 的，没有可分享的链接。

飞书交付链路解决的就是这件事：**图片先上传飞书拿到 `file_token`，再挂到多维表记录和文档里**，
客户打开链接就能看到图，不需要任何本地文件。

| 环节 | 产物 | 客户看到什么 |
|---|---|---|
| 图片上传 | `drive/v1/medias/upload_all`（`parent_type=bitable_image`）→ `file_token` | 多维表三列附件（基线/本次/差异） |
| 多维表 | 「UI 验收明细」表，一行一个检测项 | 可筛选、可排序的明细清单（含三张证据图） |
| 飞书文档 | 结论 → 问题与证据 → 建议操作 → 检测范围 | 一份可以直接读、可以评论的验收报告 |
| 通知 | 群里的文字消息 + 报告链接 | 结论摘要 + 一键直达 |

> 图片只进多维表附件，**不内嵌进文档**：docx 批量创建块接口（descendant）不支持
> `image`/`divider` 块（错误 1770029 / 1770001），文档正文用文字列出结论，证据图指向明细表对应行。

---

## 2. 三步跑通

```bash
# 0. 一键生成交付预览包（报告 + 校验 + 预览，不写入飞书）
npm run deliver:ready -- --env=stage9084
open results/feishu-delivery-preview.html

# 1. 或分步执行
npm run report:customer -- --env=stage9084
npm run deliver:preview -- --env=stage9084

# 2. 确认预览无误后写入飞书（必须带 --env=）
npm run deliver:feishu -- --env=stage9084

# 3. 要顺带发群通知
npm run deliver:feishu:notify -- --env=stage9084
```

Golden Job / Studio 在 `deliveryPreview: true` 时会自动跑到 `deliver:ready`，**不会**自动 `deliver:feishu --apply`。

`deliver:preview` 产出两个文件，用来在写进飞书之前核对：

- `results/feishu-delivery-preview.html` — 与飞书文档同结构的本地预览（图片走本地路径）
- `results/feishu-delivery-plan.json` — 将要写入的条目与图片清单

---

## 3. 数据从哪来

```
report:customer
   └─ 比对 → CustomerReportModel
          ├─ results/ui-regression-customer.html      本地 HTML（自己看）
          ├─ results/customer-report-summary.json     摘要（飞书卡片用）
          └─ results/customer-delivery.json           ★ 交付载荷（飞书链路用）
                                                          │
deliver:preview / deliver:feishu ─────────────────────────┘
   ├─ 建飞书文档 → 写入正文块 → 分享链接
   └─ 写多维表「UI 验收明细」
        └─ 先并发上传证据图（file_token 带本地缓存）再写行
```

交付载荷 `customer-delivery.json` 是**唯一数据源**。飞书链路只读它，不重新跑像素比对，
所以 `report:customer` 之外不用再等一次扫描。

载荷里已做三件脱敏：

- **流程标签去掉测试账号**：`UAT环境 · 申请单流程 · 199702_comic_com` → `UAT环境 · 申请单流程`
- **不输出内部 run 时间戳**、脚本路径等工程信息（与 `ui-regression-report-for-customer.md` §4 一致）
- **多维表唯一键哈希化**：`item_key` 存原始键（含本地目录/账号）的 sha256 前 16 位，upsert 幂等保持、不外泄内部路径

---

## 4. 命令参数

| 参数 | 作用 |
|---|---|
| `--apply` | 真正写入飞书。不加就是预览模式 |
| `--no-doc` | 只写多维表，不建文档 |
| `--no-bitable` | 只建文档，不写多维表 |
| `--dedupe` | 同一页面只保留最新一条记录；默认每次运行追加一批，保留历史 |
| `--notify` | 写完后往群里发一条文字通知（带文档链接） |
| `--concurrency=N` | 图片上传并发数，默认 4 |
| `--payload=路径` | 指定其他载荷文件，默认 `results/customer-delivery.json` |

控制交付条目数量：

```bash
DELIVERY_MAX_ITEMS=6 npm run report:customer   # 载荷里最多 6 条（默认 20）
```

---

## 5. 需要的配置

### 应用凭证（必需）

```bash
FEISHU_APP_ID=cli_xxx
FEISHU_APP_SECRET=xxx
FEISHU_DOC_FOLDER_TOKEN=     # 可选，文档落到指定文件夹
```

权限：
- **建文档/写块**：`docs:doc` 或 `docx:document`（实测已有即可）
- **上传素材**：`drive/v1/medias/upload_all`（实测可用）
- **拿公开分享链接**：至少 `drive:drive` / `drive:file` / `docs:doc` 之一。
  **当前应用未开通时**分享降级：文档照建照写，但 `doc_url` 返回 `https://feishu.cn/docx/{id}`，
  需在飞书内手动「分享」后才可给客户访问。
- 报权限错先看 [feishu-permissions-guide.md](./feishu-permissions-guide.md)。

### 多维表（图片上传 + 明细表必需，缺了会跳过）

```bash
FEISHU_BITABLE_APP_TOKEN=xxx
# deliveryTableId 可不配：表不存在时会自动建「UI 验收明细」并补齐字段
```

> 图片按 `parent_type=bitable_image` + `parent_node=<BITABLE_APP_TOKEN>` 上传，
> 因此**只要链路要传图，就必须配置此 token**（文档正文已不嵌图）。
> `--no-bitable` 只建文档时则不需要。

已有表想指定：`FEISHU_BITABLE_DELIVERY_TABLE_ID=tbl_xxx`。
配法详见 [feishu-bitable-dashboard.md](./feishu-bitable-dashboard.md)。

> 建表后记得把应用加为协作者，否则读写会报 403：
> `npm run feishu:grant-bitable-editor`

### 通知（可选）

`FEISHU_CHAT_ID` 或 `FEISHU_WEBHOOK_URL`，配法见 [feishu-webhook-setup.md](./feishu-webhook-setup.md)。

---

## 6. 多维表字段

表名 `UI 验收明细`，一行一个检测项：

| 字段 | 类型 | 说明 |
|---|---|---|
| 页面 | 文本 | 索引列，客户可读的页面名 |
| `item_key` | 文本 | 唯一键（原始键哈希，upsert 依据，不外泄路径/账号） |
| `generated_at` / `env` / `release_tag` | 文本 | 生成时间、环境、版本 |
| `verdict` | 文本 | 需要修复 / 无需处理 / 完全一致 / 待建基线 |
| `flow` / `step` / `step_number` / `browser` | 文本/数字 | 定位信息 |
| `difference` | 文本 | 差异率 |
| `affected_steps` | 数字 | 同一根因影响了几个步骤 |
| `actionable` | 文本 | 是否需要客户动手（只有「需要修复」才是「是」） |
| `reason` | 文本 | 人话判定依据 |
| `baseline_image` / `current_image` / `diff_image` | **附件** | 验收基线 / 本次截图 / 差异标注 |
| `doc_url` | 链接 | 回指飞书文档 |

图片上传失败的条目，附件列留空但文字结论照常写入——不会因为一张图失败丢掉整条记录。

---

## 7. 已知边界

- **网络参数**：deliver 三个 npm script 内置 `NODE_OPTIONS=--dns-result-order=ipv4first`。
  本机 IPv6 不通时直连飞书会卡死（fetch 无响应），勿去掉此前缀。
- **分享链接权限**：拿「公开可访问」链接需要应用开通 `drive:drive` / `drive:file` / `docs:doc`。
  未开通时交付正常结束，但 `doc_url` 是基础地址，需人工在飞书内分享后再发客户。
- **文档正文不嵌图**：descendant 不支持 `image`（1770029）与 `divider`（1770001）块，
  分隔用空行文本；证据图全部以附件形式在多维表行内。
- **图片缓存**：`results/feishu-media-cache.json` 按「大小 + 修改时间」判断同一张图是否已传过。
  换飞书租户（换 appId）后 token 不通用，需要删掉这个缓存文件重传。
- **首次上传量**：20 个条目 × 3 张图 = 60 张。第一次慢，之后再跑基本全命中缓存。
- **单次写入上限**：飞书文档内容块按 20 个一批提交，条目过多时耗时线性增长，
  建议用 `DELIVERY_MAX_ITEMS` 控制在 10~20 条。
- **多环境**：当前载荷会把所有环境的数据混在一起（`envLabel` 是多个环境拼的）。
  只交付单个环境之前，先只跑该环境的 golden，详见 [ui-regression-report-for-customer.md](./ui-regression-report-for-customer.md) §7。

---

## 8. 校验

```bash
node scripts/verify/verify-customer-delivery.cjs
```

检查四件事：标签脱敏（不泄漏测试账号）、载荷结构完整、图片路径可解析、文档块与多维表字段正确。
没生成过 `customer-delivery.json` 时只跑单元断言，不阻塞。
