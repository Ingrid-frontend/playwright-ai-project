# GitHub 部署配置指南

## 🚀 GitHub Secrets 配置

在GitHub仓库中配置以下Secrets：

### 1. 进入仓库设置
- 进入 GitHub 仓库页面
- 点击 `Settings` → `Secrets and variables` → `Actions`

### 2. 添加以下Secrets

| Secret名称 | 说明 | 示例值 |
|-----------|------|--------|
| `TEST_USERNAME` | 测试账号用户名 | `test@example.com` |
| `TEST_PASSWORD` | 测试账号密码 | `your-password-here` |

### 3. 配置步骤

1. 点击 `New repository secret`
2. Name: `TEST_USERNAME`
3. Secret: 输入你的测试用户名
4. 点击 `Add secret`

重复上述步骤添加 `TEST_PASSWORD`

## 📁 本地开发配置

### 1. 创建本地账号配置文件

```bash
# 复制示例文件
cp datasource/accounts.json.example datasource/accounts.json

# 编辑文件，填入真实的测试账号信息
vim datasource/accounts.json
```

### 2. 文件结构

```
datasource/
├── accounts.json          # 本地开发使用（已在.gitignore中）
└── accounts.json.example  # 示例文件（提交到Git）

storage/
└── loginState/
    ├── .gitkeep          # 占位文件（提交到Git）
    ├── dev.json          # 开发环境登录状态（已在.gitignore中）
    ├── uat.json          # UAT环境登录状态（已在.gitignore中）
    ├── stage9084.json    # Stage 9084环境登录状态（已在.gitignore中）
    └── stage.json        # Stage环境登录状态（已在.gitignore中）
```

## 🔐 安全注意事项

### 已排除的敏感文件

以下文件已在 `.gitignore` 中排除，不会提交到Git：

- `datasource/accounts.json` - 包含测试账号密码
- `storage/loginState/*.json` - 包含登录token和敏感信息

### GitHub Actions 工作流

GitHub Actions 会自动处理登录：

1. **首次运行**：自动登录并生成状态文件
2. **后续运行**：使用缓存的状态文件（如果有效）
3. **Token过期**：自动重新登录并更新状态

## 🧪 测试环境切换

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

编辑 `.github/workflows/playwright.yml`:
```yaml
env:
  NODE_ENV: stage  # 修改为 dev/uat/stage9084
```

## 📊 工作流说明

### Playwright Tests (push/PR)
- **触发时机**: 推送到 main/develop 分支或创建PR
- **超时时间**: 60分钟
- **环境**: stage
- **产物保留**: 
  - 测试报告: 30天
  - 测试视频: 7天

### Scheduled Tests
- **触发时机**: 每天凌晨2点 (UTC)
- **超时时间**: 60分钟
- **环境**: stage
- **产物保留**:
  - 测试结果: 30天
  - 截图: 7天

## 🔧 故障排查

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

## 📝 最佳实践

1. **定期更新密码**: 建议每3个月更新一次测试账号密码
2. **环境隔离**: 不同环境使用不同的测试账号
3. **监控登录状态**: 定期检查登录状态是否有效
4. **敏感信息保护**: 绝不将真实密码提交到Git

## 🎯 快速开始

### 本地开发

```bash
# 1. 安装依赖
npm install

# 2. 配置测试账号
cp datasource/accounts.json.example datasource/accounts.json
# 编辑 datasource/accounts.json 填入真实账号

# 3. 运行测试
npm test
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
