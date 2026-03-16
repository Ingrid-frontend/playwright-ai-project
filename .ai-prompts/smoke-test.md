# 冒烟测试意图 (Smoke Test Intent)

## 测试场景描述

作为用户，我要登录系统并验证登录功能是否正常工作。

## 预期行为

1. 访问登录页面
2. 输入有效的用户名和密码
3. 点击登录按钮
4. 验证成功跳转到首页或仪表板
5. 验证登录失败时显示错误提示

## AI Agent 指令

请使用 Playwright Planner Agent 探索 Web 应用并生成 Markdown 格式的具体测试步骤。

## 注意事项

- 使用语义化定位符（Role 和 Label）
- 优先使用视觉回归测试（screenshot comparison）
- 如果定位符失效，Healer Agent 会自动修复
