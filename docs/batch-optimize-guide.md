# 批量优化测试脚本指南

## 目标

用一条命令把录制脚本批量/单个优化到 `tests/optimized/`，减少手工处理。

## 📖 使用方法

### 1. 单个文件优化

```bash
npm run optimize -- tests/deprecated/2026-03-09_12-01-22.spec.ts
```

**输出示例**:
```
🔍 分析到 4 个操作
✅ 优化完成: tests/optimized/2026-03-09_12-01-22.optimized.spec.ts
```

### 2. 批量文件夹优化

```bash
npm run optimize -- tests/deprecated/
```

**输出示例**:
```
📁 批量处理文件夹: tests/deprecated/
📊 找到 31 个测试文件
🔍 分析到 4 个操作
✅ 优化完成: tests/optimized/2026-01-26_08-31-41.optimized.spec.ts
🔍 分析到 13 个操作
✅ 优化完成: tests/optimized/2026-01-26_09-29-08.optimized.spec.ts
...
🎉 批量优化完成! 共处理 31 个文件
```

### 3. 错误处理

**不提供参数（默认目录）**:
```bash
npm run optimize
```

**输出**:
```
📁 批量处理文件夹: tests/raw-recordings/
```

**文件不存在**:
```bash
npm run optimize -- tests/nonexistent/
```

**输出**:
```
❌ 路径不存在或不是文件/文件夹
```

**非.spec.ts文件**:
```bash
npm run optimize -- package.json
```

**输出**:
```
❌ 文件必须以 .spec.ts 结尾
```

## 🎯 批量优化特性

### 1. 自动过滤

- ✅ 只处理 `.spec.ts` 文件
- ✅ 忽略其他文件（如 `.pom.spec.ts`, `.optimized.spec.ts`）

### 2. 文件排序

- ✅ 按文件名字母顺序排序
- ✅ 确保处理顺序一致性

### 3. 进度显示

- ✅ 显示文件夹路径
- ✅ 显示找到的文件数量
- ✅ 显示每个文件的处理进度
- ✅ 显示完成统计

### 4. 错误处理

- ✅ 单个文件失败不影响其他文件
- ✅ 详细的错误信息
- ✅ 友好的使用提示

## 📊 实际使用示例

### 示例1: 优化所有deprecated测试

```bash
npm run optimize -- tests/deprecated/
```

**结果**:
- 扫描 `tests/deprecated/` 文件夹
- 找到所有 `.spec.ts` 文件
- 逐个优化并保存到 `tests/optimized/`

### 示例2: 优化特定日期的测试

```bash
npm run optimize -- tests/deprecated/2026-03-09_*.spec.ts
```

**注意**: 这会失败，因为只支持文件夹路径，不支持通配符

### 示例3: 优化单个新录制的测试

```bash
npm run optimize -- tests/raw-recordings/2026-03-09_15-51-01.spec.ts
```

**结果**:
- 优化单个文件
- 保存到 `tests/optimized/2026-03-09_15-51-01.optimized.spec.ts`

## 🔍 优化内容

每个文件优化包括：

### 1. 导入优化
- ✅ 添加必要的导入（`fs`, `screenshotWhenStable`）
- ✅ 移除未使用的导入

### 2. 存储状态配置
- ✅ 添加 `storageState` 配置
- ✅ 支持多环境

### 3. 截图功能
- ✅ 每个操作前后自动截图
- ✅ 记录路由信息
- ✅ 支持多种操作类型

### 4. 测试步骤包装
- ✅ 使用 `test.step()` 包装操作
- ✅ 添加描述性步骤名称
- ✅ 改进测试可读性

### 5. 定位符优化
- ✅ CSS选择器 → 语义化定位符
- ✅ 添加可见性过滤
- ✅ 添加滚动到元素

### 6. 等待和断言
- ✅ 添加适当的等待时间
- ✅ 添加URL验证断言
- ✅ 提高测试稳定性

## 📁 输出结构

优化后的文件保存在 `tests/optimized/` 目录：

```
tests/optimized/
├── 2026-01-26_08-31-41.optimized.spec.ts
├── 2026-01-26_09-29-08.optimized.spec.ts
├── 2026-01-26_09-42-58.optimized.spec.ts
├── 2026-01-26_09-44-37.optimized.spec.ts
├── 2026-01-26_11-42-52.optimized.spec.ts
├── 2026-03-02_06-24-48.optimized.spec.ts
├── 2026-03-02_09-33-19.optimized.spec.ts
├── 2026-03-02_10-20-26.optimized.spec.ts
├── 2026-03-02_10-20-26.optimized.spec.ts
├── 2026-03-02_10-20-26.pom.optimized.spec.ts
├── 2026-03-05_15-30-12.optimized.spec.ts
├── 2026-03-05_15-30-12.pom.optimized.spec.ts
├── 2026-03-05_15-30-12.optimized.spec.ts
├── 2026-03-06_10-54-03.optimized.spec.ts
├── 2026-03-06_11-27-50.optimized.spec.ts
├── 2026-03-06_11-27-50.optimized.spec.ts
├── 2026-03-06_15-24-39.optimized.spec.ts
├── 2026-03-06_15-24-39.optimized.spec.ts
├── 2026-03-06_18-07-33.optimized.spec.ts
├── 2026-03-06_18-07-33.optimized.spec.ts
├── 2026-03-06_18-26-58.optimized.spec.ts
├── 2026-03-06_18-26-58.optimized.spec.ts
├── 2026-03-09_10-14-06.optimized.spec.ts
├── 2026-03-09_10-14-06.optimized.spec.ts
├── 2026-03-09_12-01-22.optimized.spec.ts
├── 2026-03-09_12-01-22.optimized.spec.ts
├── 2026-03-09_14-56-24.optimized.spec.ts
├── 2026-03-09_14-56-24.optimized.spec.ts
├── last-record.optimized.spec.ts
└── optimized-example.optimized.spec.ts
```

## 🎯 最佳实践

### 1. 定期批量优化

```bash
# 每周批量优化一次新录制的测试
npm run optimize -- tests/raw-recordings/
```

### 2. 分批处理大量文件

如果有大量文件，可以分批处理：

```bash
# 只优化特定日期的文件
mkdir -p tests/deprecated/2026-03-09
mv tests/deprecated/2026-03-09_*.spec.ts tests/deprecated/2026-03-09/
npm run optimize -- tests/deprecated/2026-03-09/
```

### 3. 验证优化结果

```bash
# 运行优化后的测试
npm run test:optimized

# 查看测试报告
npm run report
```

### 4. 对比优化前后

```bash
# 生成截图对比
npm run compare-screenshots
```

## 🐛 故障排查

### 问题1: 批量优化时某个文件失败

**现象**: 部分文件优化成功，部分失败

**解决方案**:
- 查看错误信息，定位失败文件
- 单独优化失败文件：`npm run optimize -- tests/deprecated/failing-file.spec.ts`
- 检查文件语法是否正确

### 问题2: 输出目录权限错误

**现象**: `EACCES: permission denied`

**解决方案**:
```bash
# 确保输出目录存在且有写权限
mkdir -p tests/optimized
chmod 755 tests/optimized
```

### 问题3: 内存不足

**现象**: 批量处理大量文件时内存溢出

**解决方案**:
- 分批处理文件
- 减少同时处理的文件数量
- 增加Node.js内存限制：`NODE_OPTIONS="--max-old-space-size=4096" npm run optimize -- tests/deprecated/`

## 📈 性能优化建议

### 1. 并行处理（未来优化）

当前是串行处理，未来可以支持并行：

```typescript
// 伪代码
const chunks = chunk(files, 4);
await Promise.all(chunks.map(chunk => processChunk(chunk)));
```

### 2. 增量处理

对于超大文件夹，可以支持增量处理：

```bash
# 只优化最近7天的文件
npm run optimize -- tests/deprecated/ --since=7days
```

### 3. 跳过已优化文件

避免重复优化：

```bash
# 跳过已存在的.optimized.spec.ts文件
npm run optimize -- tests/deprecated/ --skip-existing
```

## 📚 相关文档

- [README.md](../README.md) - 项目主文档
- [优化工具说明](../README.md#录制脚本优化指南) - 优化功能详解
- [截图对比工具](../README.md#截图对比工具) - 截图对比功能

## 🎉 总结

批量优化功能已实现，支持：

✅ **单个文件优化**: 快速优化特定文件
✅ **批量文件夹优化**: 一次优化整个文件夹
✅ **智能过滤**: 只处理.spec.ts文件
✅ **进度显示**: 实时显示处理进度
✅ **错误处理**: 友好的错误提示
✅ **文件排序**: 确保处理顺序一致

现在可以高效地批量优化测试脚本了！🚀
