import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';
import { canSendFeishuNotify, sendFeishuNotify } from './index.js';

dotenv.config();

interface UploadResult {
  success: boolean;
  message: string;
  documentUrl?: string;
}

function convertHtmlToFeishuMarkdown(htmlContent: string): string {
  console.log('🔄 转换 HTML 为飞书富文本格式...');

  let markdown = htmlContent;

  markdown = markdown.replace(/<h1[^>]*>(.*?)<\/h1>/gi, '**$1**\n\n');
  markdown = markdown.replace(/<h2[^>]*>(.*?)<\/h2>/gi, '### $1\n\n');
  markdown = markdown.replace(/<h3[^>]*>(.*?)<\/h3>/gi, '#### $1\n\n');
  markdown = markdown.replace(/<strong[^>]*>(.*?)<\/strong>/gi, '**$1**');
  markdown = markdown.replace(/<b[^>]*>(.*?)<\/b>/gi, '**$1**');
  markdown = markdown.replace(/<em[^>]*>(.*?)<\/em>/gi, '*$1*');
  markdown = markdown.replace(/<i[^>]*>(.*?)<\/i>/gi, '*$1*');
  markdown = markdown.replace(/<br\s*\/?>/gi, '\n');
  markdown = markdown.replace(/<p[^>]*>(.*?)<\/p>/gi, '$1\n\n');
  markdown = markdown.replace(/<div[^>]*>(.*?)<\/div>/gi, '$1\n');
  markdown = markdown.replace(/<img[^>]*src="([^"]*)"[^>]*>/gi, '![]($1)');
  markdown = markdown.replace(/<a[^>]*href="([^"]*)"[^>]*>(.*?)<\/a>/gi, '[$2]($1)');
  markdown = markdown.replace(/<[^>]+>/g, '');
  markdown = markdown.replace(/<\/[^>]+>/g, '');

  markdown = markdown.replace(/\n{3,}/g, '\n\n');

  console.log('✅ 转换完成');
  return markdown;
}

async function sendToFeishu(htmlFilePath: string): Promise<UploadResult> {
  try {
    console.log('📤 发送到飞书...');
    console.log(`📁 文件路径: ${htmlFilePath}`);

    if (!canSendFeishuNotify()) {
      return {
        success: false,
        message: '未配置 FEISHU_CHAT_ID+应用凭证，也未配置 FEISHU_WEBHOOK_URL',
      };
    }

    const htmlContent = fs.readFileSync(htmlFilePath, 'utf-8');
    const fileName = path.basename(htmlFilePath);
    
    console.log(`📄 文件名: ${fileName}`);
    console.log(`📏 文件大小: ${htmlContent.length} 字符`);

    const markdownContent = convertHtmlToFeishuMarkdown(htmlContent);
    
    const maxLength = 20000;
    let truncatedContent = markdownContent;
    let isTruncated = false;
    
    if (markdownContent.length > maxLength) {
      truncatedContent = markdownContent.substring(0, maxLength);
      truncatedContent += '\n\n...(内容过长，已截断)...';
      isTruncated = true;
    }

    const githubEnabled = process.env.ENABLE_GITHUB === '1';
    const publicReportUrl = githubEnabled
      ? (process.env.PUBLIC_REPORT_URL || '')
      : '';

    const message = {
      msg_type: 'interactive' as const,
      card: {
        header: {
          title: {
            tag: 'plain_text',
            content: '📊 截图对比报告'
          },
          template: 'blue'
        },
        elements: [
          {
            tag: 'div',
            text: {
              tag: 'lark_md',
              content: `**文件名**: ${fileName}\n**文件大小**: ${htmlContent.length} 字符${isTruncated ? '\n\n⚠️ 内容过长，已截断' : ''}`
            }
          },
          {
            tag: 'div',
            text: {
              tag: 'lark_md',
              content: truncatedContent.substring(0, 1000)
            }
          },
          {
            ...(publicReportUrl
              ? {
                  tag: 'action',
                  actions: [
                    {
                      tag: 'button',
                      text: { tag: 'plain_text', content: '📥 打开完整报告' },
                      type: 'primary',
                      url: publicReportUrl,
                    },
                  ],
                }
              : {
                  tag: 'div',
                  text: {
                    tag: 'lark_md',
                    content: '（未配置公开报告链接：如需生成外链，请设置 `ENABLE_GITHUB=1` 并提供 `PUBLIC_REPORT_URL`）',
                  },
                }),
          } as any
        ]
      }
    };

    console.log('📤 发送飞书消息...');
    console.log('  - 消息类型: interactive');
    console.log('  - 内容长度: ' + truncatedContent.length);
    console.log('  - 是否截断: ' + isTruncated);

    const ok = await sendFeishuNotify(message);
    if (ok) {
      return {
        success: true,
        message: '发送成功',
        documentUrl: publicReportUrl || undefined
      };
    }
    return {
      success: false,
      message: '发送失败'
    };

  } catch (error) {
    console.error('❌ 发送失败:', error);
    return {
      success: false,
      message: `发送失败: ${error}`
    };
  }
}

async function main() {
  const args = process.argv.slice(2);
  let htmlFilePath = 'results/screenshot-comparison.html';
  
  if (args.length > 0) {
    htmlFilePath = args[0];
  }

  if (!fs.existsSync(htmlFilePath)) {
    console.error(`❌ 文件不存在: ${htmlFilePath}`);
    process.exit(1);
  }

  console.log('🎬 飞书文档发送工具');
  console.log('');

  const result = await sendToFeishu(htmlFilePath);

  if (result.success) {
    console.log('');
    console.log('✅ 发送成功！');
    if (result.documentUrl) {
      console.log(`📄 文档链接: ${result.documentUrl}`);
    }
    console.log('');
    console.log('💡 提示：');
    console.log('  1. 飞书消息中包含完整的报告内容');
    console.log('  2. 点击"📥 下载完整报告"按钮查看完整报告');
    console.log('  3. 报告会自动更新（每次测试后）');
  } else {
    console.log('');
    console.log('❌ 发送失败');
    console.log(`📝 错误信息: ${result.message}`);
    console.log('');
    console.log('💡 解决方案：');
    console.log('  1. 检查 FEISHU_CHAT_ID + FEISHU_APP_ID/SECRET，或 FEISHU_WEBHOOK_URL');
    console.log('  2. 确认网络连接正常');
    console.log('  3. 检查文件路径是否正确');
  }
}

main();
