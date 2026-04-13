# 飞书 Webhook 配置（速查）

目标：配置 `FEISHU_WEBHOOK_URL`，让测试流程可发送飞书通知（可选）。

## 1) 获取 Webhook URL

在飞书群聊添加「自定义机器人」并复制 Webhook URL。

## 2) 本地配置（推荐使用环境变量）

```bash
export FEISHU_WEBHOOK_URL="https://open.feishu.cn/open-apis/bot/v2/hook/xxxxxxxxxxxxxxxx"
```

可选（如果你的机器人启用了签名校验）：

```bash
export FEISHU_WEBHOOK_SECRET="xxxxxxxx"
```

## 3) 验证（使用项目脚本）

```bash
# 测试 webhook 是否可用
npm run test-feishu-webhook
```

## 4) 在流程中使用

```bash
# 默认飞书卡片通知
npm run auto-test

# 纯文本通知
npm run auto-test:feishu-text

# 卡片 + 链接（并创建飞书文档）
npm run auto-test:feishu-links
```

## 常见问题

### Q1: Webhook URL 泄露了怎么办？

**A**: 如果 Webhook URL 泄露了，建议：

1. 立即在飞书中删除该机器人
2. 创建新的机器人，获取新的 Webhook URL
3. 更新本地配置

### Q2: 消息发送失败怎么办？

**A**: 检查以下几点：

1. **Webhook URL 是否正确**
   - 确保没有多余的空格或换行符
   - 确保使用的是完整的 URL

2. **网络连接是否正常**
   - 检查是否能访问飞书 API
   - 检查是否有防火墙或代理限制

3. **消息格式是否正确**
   - 确保消息格式符合飞书 API 规范
   - 检查 JSON 格式是否正确

### Q3: 如何查看发送历史？

**A**: 飞书群聊中会显示所有机器人发送的消息，你可以：

1. 在群聊中向上滚动查看历史消息
2. 使用飞书的搜索功能搜索机器人发送的消息

### Q4: 可以发送哪些类型的消息？

**A**: 飞书机器人支持以下消息类型：

1. **文本消息** (`text`)
2. **富文本消息** (`post`)
3. **交互式卡片** (`interactive`)
4. **图片消息** (`image`)
5. **文件消息** (`file`)
6. **音频消息** (`audio`)
7. **视频消息** (`video`)
8. **分享卡片** (`share_card`)

本项目使用的是 **交互式卡片** (`interactive`)。

### Q5: 如何限制机器人发送频率？

**A**: 飞书对机器人发送频率有限制：

- **单机器人**：每分钟最多 20 条消息
- **单群聊**：每分钟最多 60 条消息

如果超过限制，会收到错误提示。

### Q6: 如何调试发送失败的问题？

**A**: 调试步骤：

1. **查看日志输出**
   ```bash
   npm run send-html-to-feishu
   ```
   查看控制台输出的错误信息

2. **检查网络连接**
   ```bash
   curl https://open.feishu.cn
   ```

3. **测试 Webhook URL**
   ```bash
   curl -X POST https://open.feishu.cn/open-apis/bot/v2/hook/YOUR_WEBHOOK_URL \
     -H "Content-Type: application/json" \
     -d '{"msg_type":"text","content":{"text":"测试消息"}}'
   ```

4. **查看飞书群聊**
   - 检查机器人是否在群聊中
   - 检查机器人是否被禁用

### Q7: 如何在 GitHub Actions 中配置？

**A**: 在 GitHub Actions 中配置：

1. **添加 Secret**
   - 进入 GitHub 仓库设置
   - 选择 **"Secrets and variables"** → **"Actions"**
   - 点击 **"New repository secret"**
   - Name: `FEISHU_WEBHOOK_URL`
   - Value: 你的 Webhook URL
   - 点击 **"Add secret"**

2. **在 workflow 中使用**
   ```yaml
   env:
     FEISHU_WEBHOOK_URL: ${{ secrets.FEISHU_WEBHOOK_URL }}
   ```

### Q8: 如何自定义消息内容？

**A**: 你可以修改 `scripts/feishu/send-html-to-feishu.ts` 文件来自定义消息内容：

1. 修改 `convertHtmlToFeishuMarkdown` 函数来调整 HTML 转换逻辑
2. 修改 `sendToFeishu` 函数中的 `message` 对象来调整消息格式
3. 修改卡片样式和按钮配置

---

（其余资料链接与检查清单已省略：以本文“速查命令”与常见问题为准）
