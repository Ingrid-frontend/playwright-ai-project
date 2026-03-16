# 飞书 Webhook URL 配置指南

## 📋 目录
1. [创建飞书群聊机器人](#创建飞书群聊机器人)
2. [获取 Webhook URL](#获取-webhook-url)
3. [本地配置](#本地配置)
4. [测试配置](#测试配置)
5. [常见问题](#常见问题)

---

## 🤖 创建飞书群聊机器人

### 步骤 1：打开飞书群聊

1. 在飞书中打开你想要接收通知的群聊
2. 确保你有管理员权限

### 步骤 2：添加群机器人

1. 点击群聊右上角的 **"..."** 菜单
2. 选择 **"群设置"**
3. 点击 **"群机器人"**
4. 点击 **"添加机器人"**
5. 选择 **"自定义机器人"**

### 步骤 3：配置机器人

1. **机器人名称**：输入一个名称，例如 `Playwright 测试通知`
2. **机器人描述**：输入描述，例如 `自动发送测试结果通知`
3. **机器人头像**：选择一个头像（可选）
4. 点击 **"添加"**

---

## 🔗 获取 Webhook URL

### 步骤 1：复制 Webhook URL

1. 添加机器人后，会显示 Webhook URL
2. 点击 **"复制"** 按钮复制 URL
3. URL 格式类似：
   ```
   https://open.feishu.cn/open-apis/bot/v2/hook/xxxxxxxxxxxxxxxx
   ```

### 步骤 2：保存 Webhook URL

将 Webhook URL 保存到安全的地方，不要泄露给他人。

---

## 💻 本地配置

### 方式 1：使用 .env 文件（推荐）

#### 步骤 1：创建 .env 文件

在项目根目录创建 `.env` 文件：

```bash
touch .env
```

#### 步骤 2：添加环境变量

在 `.env` 文件中添加：

```env
# 飞书 Webhook URL
FEISHU_WEBHOOK_URL=https://open.feishu.cn/open-apis/bot/v2/hook/xxxxxxxxxxxxxxxx
```

#### 步骤 3：确保 .env 文件被忽略

检查 `.gitignore` 文件是否包含 `.env`：

```gitignore
# 环境变量
.env
.env.local
.env.*.local
```

### 方式 2：使用环境变量

#### macOS / Linux

在 `~/.zshrc` 或 `~/.bashrc` 中添加：

```bash
export FEISHU_WEBHOOK_URL="https://open.feishu.cn/open-apis/bot/v2/hook/xxxxxxxxxxxxxxxx"
```

然后重新加载配置：

```bash
source ~/.zshrc
# 或
source ~/.bashrc
```

#### Windows (PowerShell)

在 PowerShell 中运行：

```powershell
$env:FEISHU_WEBHOOK_URL="https://open.feishu.cn/open-apis/bot/v2/hook/xxxxxxxxxxxxxxxx"
```

或者永久设置：

```powershell
[System.Environment]::SetEnvironmentVariable('FEISHU_WEBHOOK_URL', 'https://open.feishu.cn/open-apis/bot/v2/hook/xxxxxxxxxxxxxxxx', 'User')
```

### 方式 3：使用配置文件

#### 步骤 1：创建配置文件

在项目根目录创建 `feishu-config.json` 文件：

```json
{
  "webhookUrl": "https://open.feishu.cn/open-apis/bot/v2/hook/xxxxxxxxxxxxxxxx"
}
```

#### 步骤 2：确保配置文件被忽略

检查 `.gitignore` 文件是否包含 `feishu-config.json`：

```gitignore
# 飞书配置
feishu-config.json
```

---

## 🧪 测试配置

### 测试 1：发送简单消息

创建测试脚本 `test-feishu-webhook.js`：

```javascript
const webhookUrl = process.env.FEISHU_WEBHOOK_URL || 'YOUR_WEBHOOK_URL';

const message = {
  msg_type: 'text',
  content: {
    text: '🎉 飞书 Webhook 配置测试成功！'
  }
};

fetch(webhookUrl, {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json'
  },
  body: JSON.stringify(message)
})
  .then(response => response.json())
  .then(data => {
    console.log('✅ 发送成功:', data);
  })
  .catch(error => {
    console.error('❌ 发送失败:', error);
  });
```

运行测试：

```bash
node test-feishu-webhook.js
```

### 测试 2：使用项目脚本

运行项目中的飞书发送脚本：

```bash
# 发送 HTML 到飞书
npm run send-html-to-feishu

# 或者手动指定文件路径
npm run send-html-to-feishu results/screenshot-comparison.html
```

### 测试 3：完整流程测试

运行完整的自动测试流程：

```bash
npm run auto-test
```

---

## ❓ 常见问题

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

**A**: 你可以修改 `scripts/send-html-to-feishu.ts` 文件来自定义消息内容：

1. 修改 `convertHtmlToFeishuMarkdown` 函数来调整 HTML 转换逻辑
2. 修改 `sendToFeishu` 函数中的 `message` 对象来调整消息格式
3. 修改卡片样式和按钮配置

---

## 📚 相关文档

- [飞书开放平台文档](https://open.feishu.cn/document/ukTMukTMukTM/ucTM5YjL3ETO24yNkjE3)
- [飞书机器人开发指南](https://open.feishu.cn/document/ukTMukTMukTM/uYjNwUjL2YDM14iN2ATN)
- [飞书消息类型说明](https://open.feishu.cn/document/ukTMukTMukTM/uYjNwUjL2YDM14iN2ATN)

---

## 🎯 快速开始

### 1 分钟快速配置

```bash
# 1. 创建 .env 文件
echo "FEISHU_WEBHOOK_URL=你的WebhookURL" > .env

# 2. 测试配置
npm run send-html-to-feishu

# 3. 检查飞书群聊，查看是否收到消息
```

---

## ✅ 配置检查清单

- [ ] 已创建飞书群聊机器人
- [ ] 已复制 Webhook URL
- [ ] 已创建 .env 文件
- [ ] 已添加 FEISHU_WEBHOOK_URL 环境变量
- [ ] 已确保 .env 文件在 .gitignore 中
- [ ] 已测试发送消息
- [ ] 已在飞书群聊中收到测试消息
- [ ] 已配置 GitHub Actions Secret（如果需要）

---

## 🆘 需要帮助？

如果配置过程中遇到问题，可以：

1. 查看飞书开放平台文档
2. 检查项目日志输出
3. 联系飞书技术支持

---

**祝你配置顺利！** 🎉
