# 运行优化测试套件

目标：批量执行 `tests/optimized/` 下的用例，并生成截图对比报告。

## 速查

```bash
npm run run-optimized-tests
```

常用参数（npm 透传用 `--`）：

```bash
npm run run-optimized-tests -- --verbose
npm run run-optimized-tests -- --clean
npm run run-optimized-tests -- --stop
```

## 输出

- 对比报告：`results/screenshot-comparison.html`

## 参数说明

- `--verbose` / `-v`：显示更详细的执行输出
- `--stop` / `-s`：遇到错误时停止（默认继续执行后续文件）
- `--clean`：清理失败测试的截图（保留成功测试截图用于对比）

1. **测试超时**
   - 每个测试的超时时间为 120 秒
   - 如果测试超时，会记录错误并继续（如果使用 --continue 参数）

2. **错误处理**
   - 默认情况下，遇到错误会继续执行后续测试
   - 使用 `--stop` 参数可以在遇到错误时停止执行

3. **截图对比报告**
   - 报告生成在 `results/screenshot-comparison.html`
   - 可以在浏览器中打开查看

4. **浏览器选择**
   - 以 `playwright.config.ts` 的 project 为准（推荐 `optimized`）

## 故障排除

### 问题：测试超时
**解决方案**：
- 检查测试是否需要更长的等待时间
- 修改脚本中的 `timeout: 120000` 增加超时时间

### 问题：测试失败
**解决方案**：
- 使用 `--verbose` 参数查看详细错误信息
- 检查 `test-results` 目录下的错误日志
- 默认遇到错误会继续执行，如需停止请使用 `--stop` 参数

### 问题：对比报告生成失败
**解决方案**：
- 检查是否有截图文件生成
- 确保 `npm run compare-screenshots` 命令可以正常运行
- 使用 `--verbose` 参数查看详细错误信息

## 相关命令

- `npm run optimize`: 优化录制的测试
- `npm run compare-screenshots`: 生成截图对比报告
- `npm run test:optimized`: 执行优化后的测试