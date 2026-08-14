import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';
import {
  addBlocksToDocument,
  clearDocumentBlocks,
  getAccessToken,
  type CreateDocResult,
  type FeishuDocConfig,
} from './create-feishu-doc-api.js';
import { convertHtmlToFeishuBlocks } from './create-feishu-doc-html.js';

dotenv.config();

async function createFeishuDoc(htmlFilePath: string, config: FeishuDocConfig, targetDocumentId: string): Promise<CreateDocResult> {
  try {
    console.log('🎬 飞书文档生成工具');
    console.log('');
    console.log(`📁 文件路径: ${htmlFilePath}`);
    console.log(`🆔 目标文档 ID: ${targetDocumentId}`);
    console.log(`🔑 App ID: ${config.appId ? '已配置' : '未配置'}`);
    console.log('');

    if (!config.appId || !config.appSecret) {
      return {
        success: false,
        message: '未配置飞书开放平台应用信息（App ID 和 App Secret）'
      };
    }

    const htmlContent = fs.readFileSync(htmlFilePath, 'utf-8');
    const fileName = path.basename(htmlFilePath);
    
    console.log(`📄 文件名: ${fileName}`);
    console.log(`📏 文件大小: ${htmlContent.length} 字符`);
    console.log('');

    const accessToken = await getAccessToken(config);
    
    // 清空文档内容
    console.log('🗑️ 清空文档内容...');
    await clearDocumentBlocks(targetDocumentId, accessToken);
    console.log('✅ 文档内容已清空');

    const blocks = await convertHtmlToFeishuBlocks(htmlContent, accessToken);
    await addBlocksToDocument(targetDocumentId, blocks, accessToken);
    
    // 跳过分享步骤，直接构造文档 URL
    // const shareUrl = await shareDocument(documentId, accessToken);
    const shareUrl = `https://feishu.cn/docx/${targetDocumentId}`;
    console.log('✅ 文档 URL 构造成功:', shareUrl);

    return {
      success: true,
      message: '文档更新成功',
      documentUrl: shareUrl,
      documentId: targetDocumentId
    };

  } catch (error) {
    console.error('❌ 创建文档失败:', error);
    return {
      success: false,
      message: `创建文档失败: ${error}`
    };
  }
}

async function main() {
  const args = process.argv.slice(2);
  let htmlFilePath = 'results/screenshot-comparison.html';
  let targetDocumentId = 'X6YrdHcYuoRywZxP1gscOiMwnzf';
  
  for (let i = 0; i < args.length; i++) {
    if (args[i].startsWith('--doc-id=')) {
      targetDocumentId = args[i].split('=')[1];
    } else if (args[i].startsWith('--html=')) {
      htmlFilePath = args[i].split('=')[1];
    } else if (!args[i].startsWith('--')) {
      htmlFilePath = args[i];
    }
  }

  if (!fs.existsSync(htmlFilePath)) {
    console.error(`❌ 文件不存在: ${htmlFilePath}`);
    process.exit(1);
  }

  const config: FeishuDocConfig = {
    appId: process.env.FEISHU_APP_ID || '',
    appSecret: process.env.FEISHU_APP_SECRET || ''
  };

  if (!config.appId || !config.appSecret) {
    try {
      const configPath = 'feishu-config.json';
      const configContent = fs.readFileSync(configPath, 'utf-8');
      const configData = JSON.parse(configContent);
      config.appId = configData.appId || '';
      config.appSecret = configData.appSecret || '';
    } catch {
      console.log('📝 未找到 feishu-config.json 文件');
    }
  }

  const result = await createFeishuDoc(htmlFilePath, config, targetDocumentId);

  if (result.success) {
    console.log('');
    console.log('✅ 文档创建成功！');
    console.log(`📄 文档链接: ${result.documentUrl}`);
    console.log(`🆔 文档 ID: ${result.documentId}`);
    console.log('');
    
    // 保存文档 URL 到文件
    const urlFilePath = 'results/feishu-doc-url.txt';
    fs.writeFileSync(urlFilePath, result.documentUrl || '', 'utf-8');
    console.log(`💾 文档链接已保存到: ${urlFilePath}`);
    console.log('');
    
    console.log('💡 提示：');
    console.log('  1. 可以将链接分享给团队成员');
    console.log('  2. 可以在飞书中查看和编辑文档');
    console.log('  3. 文档会自动更新（如果文件名相同）');
  } else {
    console.log('');
    console.log('❌ 文档创建失败');
    console.log(`📝 错误信息: ${result.message}`);
    console.log('');
    console.log('💡 解决方案：');
    console.log('  1. 检查飞书开放平台应用配置');
    console.log('  2. 确认应用有文档创建权限');
    console.log('  3. 检查网络连接');
    console.log('  4. 查看飞书开放平台文档：https://open.feishu.cn');
  }
}

main();
