# GitHub 部署/CI 配置（速查）

目标：让仓库在 GitHub Actions 里可跑（含登录态、可选飞书通知）。

## 1) 配置 Secrets（必需）

在仓库 `Settings` → `Secrets and variables` → `Actions` 添加：

| Secret 名称 | 用途 |
|---|---|
| `TEST_USERNAME` | 测试账号 |
| `TEST_PASSWORD` | 测试密码 |

可选：

| Secret 名称 | 用途 |
|---|---|
| `FEISHU_WEBHOOK_URL` | 飞书群机器人 webhook |

## 2) 本地账号配置（仅本地）

```bash
cp datasource/accounts.json.example datasource/accounts.json
```

说明：
- `datasource/accounts.json` 与 `storage/loginState/*.json` 均在 `.gitignore`，不要提交

## 3) 环境切换

### 本地开发

```bash
# Stage环境（默认）
npm test

# 开发环境
NODE_ENV=dev npm test

# UAT环境
NODE_ENV=uat npm test

# Stage 9084环境
NODE_ENV=stage9084 npm test
```

### GitHub Actions

工作流默认使用 `stage` 环境，如需修改：

编辑 `.github/workflows/playwright.yml`（或对应的 `.disabled` 文件）:
```yaml
env:
  NODE_ENV: stage  # 修改为 dev/uat/stage9084
```

## 4) 常见排错

### 问题1: GitHub Actions 登录失败

**解决方案**:
1. 检查 Secrets 是否正确配置
2. 确认测试账号密码是否正确
3. 检查目标环境是否可访问

### 问题2: 本地测试无法登录

**解决方案**:
1. 确认 `datasource/accounts.json` 文件存在
2. 检查文件格式是否正确
3. 删除 `storage/loginState/*.json` 重新生成

### 问题3: Token过期

**解决方案**:
```bash
# 删除过期的状态文件
rm storage/loginState/stage.json

# 重新运行测试，会自动登录
NODE_ENV=stage npm test
```

### GitHub部署

```bash
# 1. 配置GitHub Secrets（见上方说明）

# 2. 推送代码
git add .
git commit -m "feat: add GitHub deployment configuration"
git push origin main

# 3. GitHub Actions 自动运行测试
```

## 📚 相关文档

- [Playwright官方文档 - storageState](https://playwright.dev/docs/auth#basic-authentication)
- [GitHub Actions Secrets文档](https://docs.github.com/en/actions/security-guides/encrypted-secrets)
- [项目README](../README.md)
