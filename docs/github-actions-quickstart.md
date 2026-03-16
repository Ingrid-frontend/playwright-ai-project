# GitHub Actions 快速开始指南

## 🚀 快速部署到GitHub

### 步骤1: 初始化Git仓库

```bash
# 如果还没有初始化Git
git init

# 添加所有文件
git add .

# 提交
git commit -m "feat: initial commit with GitHub Actions configuration"
```

### 步骤2: 创建GitHub仓库

1. 访问 https://github.com/new
2. 输入仓库名称（例如：`playwright-ai-project`）
3. 选择 `Public` 或 `Private`
4. **不要**初始化README（避免冲突）
5. 点击 `Create repository`

### 步骤3: 关联远程仓库

```bash
# 添加远程仓库
git remote add origin https://github.com/your-username/playwright-ai-project.git

# 推送到GitHub
git branch -M main
git push -u origin main
```

### 步骤4: 配置GitHub Secrets

1. 进入GitHub仓库页面
2. 点击 `Settings` → `Secrets and variables` → `Actions`
3. 点击 `New repository secret`
4. 添加以下Secrets：

| Secret名称 | 说明 | 示例值 |
|-----------|------|--------|
| `TEST_USERNAME` | 测试账号用户名 | `test@example.com` |
| `TEST_PASSWORD` | 测试账号密码 | `your-password-here` |

### 步骤5: 验证GitHub Actions

推送代码后，GitHub Actions会自动运行测试：

```bash
# 查看Actions运行状态
# 访问: https://github.com/your-username/playwright-ai-project/actions
```

## 📊 GitHub Actions 工作流说明

### Playwright Tests (push/PR)

**触发时机**:
- 推送到 `main` 或 `develop` 分支
- 创建Pull Request到 `main` 或 `develop` 分支
- 手动触发（workflow_dispatch）

**配置特点**:
- ✅ **依赖缓存**: 使用npm缓存，加速依赖安装
- ✅ **浏览器缓存**: 缓存Playwright浏览器，减少下载时间
- ✅ **矩阵测试**: 4个分片并行运行，提高执行速度
- ✅ **失败通知**: 测试失败时发送通知
- ✅ **超时时间**: 90分钟，确保复杂测试有足够时间
- ✅ **产物保留**: 
  - 测试报告: 30天
  - 测试视频: 7天（仅失败时）
  - 截图: 7天（仅失败时）

**执行流程**:
```
1. Checkout代码
2. 设置Node.js 18（带缓存）
3. 缓存Playwright浏览器
4. 安装依赖（npm ci）
5. 安装Playwright浏览器
6. 运行测试（4个分片并行）
7. 上传测试结果（总是）
8. 上传测试视频（失败时）
9. 上传截图（失败时）
10. 发送失败通知（失败时）
```

### Scheduled Tests

**触发时机**:
- 每天凌晨2点（UTC时间）
- 手动触发（workflow_dispatch）

**配置特点**:
- ✅ **定时执行**: 每天自动运行，监控系统稳定性
- ✅ **产物保留**: 
  - 测试结果: 30天
  - 截图: 7天

## 🎯 GitHub Actions 优化点

### 1. 依赖缓存

```yaml
- name: Setup Node.js
  uses: actions/setup-node@v4
  with:
    node-version: '18'
    cache: 'npm'  # 启用npm缓存
```

**优势**: 减少依赖安装时间，从5分钟降至30秒

### 2. 浏览器缓存

```yaml
- name: Cache Playwright Browsers
  uses: actions/cache@v4
  with:
    path: ~/.cache/ms-playwright
    key: ${{ runner.os }}-playwright-${{ hashFiles('**/package-lock.json') }}
    restore-keys: |
      ${{ runner.os }}-playwright-
```

**优势**: 避免每次都下载浏览器，节省2-3分钟

### 3. 矩阵测试

```yaml
strategy:
  fail-fast: false  # 不快速失败，运行所有分片
  matrix:
    shard: [1, 2, 3, 4]  # 4个分片并行
```

**优势**: 
- 并行执行，减少总运行时间
- `fail-fast: false` 确保看到所有分片的结果

### 4. 智能产物上传

```yaml
- name: Upload test videos
  if: failure()  # 仅失败时上传
  uses: actions/upload-artifact@v4
```

**优势**: 节省存储空间，仅上传失败的产物

## 🔍 查看测试结果

### 1. GitHub Actions页面

访问: `https://github.com/your-username/playwright-ai-project/actions`

**信息展示**:
- ✅ 工作流运行状态
- ✅ 每个分片的执行情况
- ✅ 测试通过/失败统计
- ✅ 执行时间

### 2. 下载测试报告

1. 进入失败的workflow运行
2. 滚动到 `Artifacts` 部分
3. 下载需要的产物：
   - `playwright-report-shard-1` (测试报告)
   - `test-videos-shard-1` (测试视频)
   - `screenshots-shard-1` (失败截图)

### 3. 本地查看测试报告

```bash
# 下载并解压产物
unzip playwright-report-shard-1.zip

# 打开报告
cd playwright-report
npx playwright show-report
```

## 🐛 故障排查

### 问题1: Actions运行失败 - "npm ci failed"

**原因**: `package-lock.json` 不存在或不同步

**解决方案**:
```bash
# 生成本地lock文件
npm install

# 提交到Git
git add package-lock.json
git commit -m "chore: add package-lock.json"
git push
```

### 问题2: Actions运行失败 - "TEST_USERNAME not found"

**原因**: GitHub Secrets未配置

**解决方案**:
1. 进入仓库 `Settings` → `Secrets and variables` → `Actions`
2. 添加 `TEST_USERNAME` 和 `TEST_PASSWORD`

### 问题3: Actions运行超时

**原因**: 测试执行时间超过90分钟

**解决方案**:
1. 优化测试用例，减少等待时间
2. 增加超时时间（修改workflow中的 `timeout-minutes`）
3. 使用分片并行执行

### 问题4: 缓存未命中

**原因**: `package-lock.json` 发生变化

**解决方案**:
```bash
# 清除GitHub Actions缓存
# 1. 进入仓库 Settings → Actions → Caches
# 2. 删除相关缓存
# 3. 重新运行workflow
```

## 📈 性能优化建议

### 1. 减少测试数量

```bash
# 只运行特定测试
npx playwright test tests/e2e/login.spec.ts

# 只运行特定项目
npx playwright test --project=chromium
```

### 2. 增加并行度

修改 `playwright.config.ts`:
```typescript
workers: process.env.CI ? 4 : 1  // CI环境使用4个worker
```

### 3. 优化测试用例

- 使用语义化定位符（`getByRole`, `getByLabel`）
- 添加适当的等待（`waitForLoadState`）
- 避免不必要的截图和视频

## 🔐 安全最佳实践

### 1. Secrets管理

- ✅ 使用GitHub Secrets存储敏感信息
- ✅ 定期更新密码
- ✅ 不要在代码中硬编码密码
- ✅ 使用环境变量优先级

### 2. 依赖安全

```bash
# 定期检查依赖漏洞
npm audit

# 自动修复漏洞
npm audit fix
```

### 3. 访问控制

- 设置仓库为Private（如果包含敏感信息）
- 使用Branch Protection保护main分支
- 要求PR审核才能合并

## 📚 相关文档

- [GitHub部署配置指南](github-deployment.md)
- [Playwright官方文档](https://playwright.dev/)
- [GitHub Actions文档](https://docs.github.com/en/actions)
