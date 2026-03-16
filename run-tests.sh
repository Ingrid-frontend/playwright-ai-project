#!/bin/bash

# Playwright 并发测试执行脚本
# 用法: ./run-tests.sh [选项]

# 默认参数
WORKERS=1
PROJECT=""
TEST_FILE=""
HEADED=false

# 解析命令行参数
while [[ $# -gt 0 ]]; do
  case $1 in
    -w|--workers)
      WORKERS="$2"
      shift 2
      ;;
    -p|--project)
      PROJECT="$2"
      shift 2
      ;;
    -f|--file)
      TEST_FILE="$2"
      shift 2
      ;;
    -h|--headed)
      HEADED=true
      shift
      ;;
    --help)
      echo "用法: $0 [选项]"
      echo ""
      echo "选项:"
      echo "  -w, --workers NUM    设置并发数 (默认: 1)"
      echo "  -p, --project NAME   指定项目 (chromium, firefox, webkit, optimized)"
      echo "  -f, --file PATH      指定测试文件"
      echo "  -h, --headed         显示浏览器界面"
      echo "  --help               显示帮助信息"
      echo ""
      echo "示例:"
      echo "  $0 -w 1 -p optimized                    # 单线程运行优化测试"
      echo "  $0 -w 2 -p chromium -f test.spec.ts  # 双线程运行指定文件"
      echo "  $0 -w 1 -p chromium --headed            # 单线程显示浏览器运行"
      exit 0
      ;;
    *)
      echo "未知选项: $1"
      echo "使用 --help 查看帮助"
      exit 1
      ;;
  esac
done

# 构建命令
CMD="npx playwright test"

if [ -n "$PROJECT" ]; then
  CMD="$CMD --project=$PROJECT"
fi

if [ -n "$TEST_FILE" ]; then
  CMD="$CMD $TEST_FILE"
fi

if [ "$HEADED" = true ]; then
  CMD="$CMD --headed"
fi

# 设置并发数
export WORKERS=$WORKERS
CMD="$CMD --workers=$WORKERS"

echo "🚀 执行命令: $CMD"
echo "📊 并发数: $WORKERS"
echo "📁 项目: ${PROJECT:-所有项目}"
echo "📄 文件: ${TEST_FILE:-所有文件}"
echo ""

# 执行测试
eval $CMD