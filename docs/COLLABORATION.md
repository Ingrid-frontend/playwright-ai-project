# Playwright AI 项目协作指南

## 🎬 录制与协作

### 录制限制说明

**重要**：Playwright 的录制功能（`playwright codegen`）需要在有图形界面的环境中运行：

- ✅ 本地开发环境（macOS, Windows, Linux Desktop）
- ❌ CI/CD 环境（无图形界面）
- ❌ 远程服务器（无图形界面）

### 协作方案

我们采用 **"本地录制 + 版本控制"** 的协作模式：

1. **团队成员各自在本地录制测试**
2. **将录制的脚本提交到 Git 仓库**
3. **CI/CD 使用已录制的脚本运行测试**

## 💻 本地开发流程

### 1. 环境准备

```bash
# 安装依赖
npm install
```

### 2. 录制测试脚本

```bash
# 录制测试脚本
npm run record

# 录制完成后，脚本会保存在 tests/raw-recordings/ 目录
```

### 3. 优化测试脚本

```bash
# 优化录制的脚本
npm run optimize -- tests/raw-recordings/your-script.spec.ts

# 优化后的脚本会保存在 tests/optimized/ 目录
```

### 4. 运行测试

```bash
# 运行优化后的测试
npm run test

# 运行完整的自动化流程
npm run auto-test
```

### 5. 提交代码

```bash
# 提交录制的脚本
git add tests/raw-recordings/
git add tests/optimized/
git commit -m "feat: 新增 XXX 场景用例"
git push
```

## 维护 Runbook

| 场景 | 命令 |
|------|------|
| raw 备份 → optimized | `npm run test:pipeline -- tests/raw-recordings/original/...` |
| 补全 spec-meta | `npm run migrate:backfill-spec-meta` |
| 路径加 env 段 | `npm run migrate:test-env-paths` |
| 按日期整理录制 | `npm run organize-files-by-date` |
| 重命名录制文件 | `npm run rename-recordings` |
| 校验 meta 一致性 | `node scripts/verify/verify-spec-meta-flow.cjs` |
| 追加 UI mask 区域 | `npm run ui-regression:add-mask -- --script=... --region=x,y,w,h` |
| POM（可选，稳定核心页） | `ENABLE_POM=1 npm run generate-pom -- <raw.spec.ts>` |

目录约定：

- CLI 录制：`tests/raw-recordings/<dateCategory>/` + 备份 `original/`
- Studio 入库：`tests/raw-recordings/original/<env>/<dateCategory>/`
- 预处理产物：`.../processed/*.spec.ts`
- 可执行用例：`tests/optimized/<env>/<dateCategory>/*.optimized.spec.ts`

## 👥 团队协作流程

### 1. 分工协作

- **测试用例设计**：团队成员共同讨论测试场景
- **录制测试**：各自负责不同的测试场景
- **代码审查**：互相审查录制的脚本
- **持续改进**：基于测试结果优化脚本

### 2. 版本控制

```bash
# 创建功能分支
git checkout -b feature/test-xxx

# 录制和优化测试
npm run record
npm run optimize -- tests/raw-recordings/xxx.spec.ts

# 提交代码
git add .
git commit -m "feat: 新增 XXX 场景用例"
git push origin feature/test-xxx

# 创建 Pull Request
# 等待代码审查
# 合并到主分支
```

### 3. 代码审查要点

- [ ] 测试场景是否覆盖完整
- [ ] 测试步骤是否清晰
- [ ] 断言是否充分
- [ ] 错误处理是否完善
- [ ] 代码风格是否一致

## 🤖 CI/CD 流程

### 1. 自动触发

CI/CD 会在以下情况自动运行：

- 推送到 `main` 或 `develop` 分支
- 创建 Pull Request
- 手动触发

### 2. CI/CD 流程

1. **跳过录制步骤**（CI/CD 环境无图形界面）
2. **使用已录制的脚本**
3. **优化测试脚本**
4. **执行优化后的测试**（headless 模式）
5. **生成截图对比报告**
6. **发送飞书通知**（如果配置）

### 3. 查看测试结果

- 访问 GitHub Actions 页面
- 查看测试运行日志
- 下载测试报告和截图

## 🔍 故障排查

### 1. 录制失败

**问题**：无法启动录制

**解决方案**：
- 确保在本地环境运行（有图形界面）
- 检查浏览器是否已安装
- 检查网络连接

### 2. 测试失败

**问题**：测试在 CI/CD 环境中失败

**解决方案**：
- 查看测试日志
- 检查环境变量配置
- 查看截图对比报告
- 使用 Trace Viewer 分析问题

### 3. 协作冲突

**问题**：多个团队成员修改同一个测试文件

**解决方案**：
- 使用 Git 分支管理
- 及时沟通和同步
- 代码审查
- 使用 Git 的合并工具

## 📚 最佳实践

### 1. 测试脚本命名

- 使用描述性的文件名
- 包含测试场景信息
- 使用连字符命名法

**示例**：
```
tests/raw-recordings/login-flow.spec.ts
tests/raw-recordings/create-expense.spec.ts
tests/raw-recordings/approve-reimbursement.spec.ts
```

### 2. 测试步骤设计

- 每个测试步骤应该清晰明确
- 避免过于复杂的测试场景
- 使用有意义的断言

### 3. 错误处理

- 添加适当的等待和重试逻辑
- 处理网络超时和加载延迟
- 记录详细的错误信息

### 4. 维护和更新

- 定期更新测试脚本
- 删除过时的测试
- 优化测试性能

## 🎯 总结

通过 **"本地录制 + 版本控制"** 的协作模式，我们可以：

1. ✅ 充分利用 Playwright 的录制功能
2. ✅ 支持团队协作开发
3. ✅ 利用 Git 的版本控制
4. ✅ 自动化 CI/CD 流程
5. ✅ 及时反馈测试结果

## 📞 联系方式

如有问题，请联系：
- 项目负责人：XXX
- 技术支持：XXX
