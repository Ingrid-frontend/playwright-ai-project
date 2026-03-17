import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';

dotenv.config();

interface FeishuDocConfig {
  appId: string;
  appSecret: string;
}

interface CreateDocResult {
  success: boolean;
  message: string;
  documentUrl?: string;
  documentId?: string;
}

interface ScreenshotInfo {
  timestamp: string;
  browser: string;
  sessionId: string;
  steps: {
    stepNumber: number;
    actionType: string;
    page: string;
    beforeImage?: string;
    afterImage?: string;
  }[];
}

interface FeishuDocBlock {
  block_type: number;
  text?: {
    elements: FeishuDocElement[];
  };
  heading1?: {
    elements: FeishuDocElement[];
  };
  heading2?: {
    elements: FeishuDocElement[];
  };
  heading3?: {
    elements: FeishuDocElement[];
  };
  image?: {
    token: string;
  };
  table?: {
    table_property: {
      column_size: number;
      row_size: number;
    };
    cells: FeishuDocCell[];
  };
}

interface FeishuDocElement {
  text_run: {
    content: string;
    text_element_style?: {
      bold?: boolean;
      italic?: boolean;
      underline?: boolean;
      strike_through?: boolean;
      code?: boolean;
      link?: {
        url: string;
      };
    };
  };
}

interface FeishuDocCell {
    column: number;
    row: number;
    content?: FeishuDocBlock[];
}

async function getAccessToken(config: FeishuDocConfig): Promise<string> {
  console.log('🔑 获取飞书访问令牌...');
  
  const response = await fetch('https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      app_id: config.appId,
      app_secret: config.appSecret
    })
  });

  const responseText = await response.text();
  
  // 移除 BOM（Byte Order Mark）
  const cleanedResponseText = responseText.replace(/^\uFEFF/, '');
  
  console.log('📥 飞书 API 响应:', cleanedResponseText.substring(0, 200));
  console.log('📊 响应长度:', cleanedResponseText.length);
  
  let data;
  try {
    data = JSON.parse(cleanedResponseText);
  } catch (error) {
    console.error('❌ JSON 解析失败');
    console.error('📝 错误信息:', error);
    console.error('📄 响应内容（前 500 字符）:');
    console.error(cleanedResponseText.substring(0, 500));
    console.error('📄 响应内容（完整）:');
    console.error(cleanedResponseText);
    throw new Error(`解析飞书 API 响应失败: ${error}`);
  }
  
  if (data.code !== 0) {
    throw new Error(`获取访问令牌失败: ${data.msg}`);
  }

  console.log('✅ 访问令牌获取成功');
  return data.tenant_access_token;
}

async function uploadImageToFeishu(imagePath: string, accessToken: string): Promise<string> {
  console.log(`📤 上传图片: ${path.basename(imagePath)}`);
  
  const imageBuffer = fs.readFileSync(imagePath);
  const formData = new FormData();
  formData.append('file', new Blob([imageBuffer]), path.basename(imagePath));
  formData.append('file_type', 'image');

  const response = await fetch('https://open.feishu.cn/open-apis/drive/v1/medias/upload_all', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${accessToken}`
    },
    body: formData
  });

  const data = await response.json();
  
  if (data.code !== 0) {
    throw new Error(`上传图片失败: ${data.msg}`);
  }

  console.log(`✅ 图片上传成功: ${data.file.token}`);
  return data.file.token;
}

async function getDocumentIdFromUrl(url: string): Promise<string | null> {
  try {
    const match = url.match(/docx\/([a-zA-Z0-9_-]+)/);
    return match ? match[1] : null;
  } catch (error) {
    return null;
  }
}

async function getDocumentInfo(documentId: string, accessToken: string): Promise<any> {
  console.log(`🔍 检查文档是否存在: ${documentId}`);
  
  const response = await fetch(`https://open.feishu.cn/open-apis/docx/v1/documents/${documentId}`, {
    method: 'GET',
    headers: {
      'Authorization': `Bearer ${accessToken}`
    }
  });

  const responseText = await response.text();
  
  // 移除 BOM（Byte Order Mark）
  const cleanedResponseText = responseText.replace(/^\uFEFF/, '');
  
  console.log('📥 飞书 API 响应:', cleanedResponseText.substring(0, 200));
  
  let data;
  try {
    data = JSON.parse(cleanedResponseText);
  } catch (error) {
    console.error('❌ JSON 解析失败');
    console.error('📝 错误信息:', error);
    console.error('📄 响应内容（前 500 字符）:');
    console.error(cleanedResponseText.substring(0, 500));
    console.error('📄 响应内容（完整）:');
    console.error(cleanedResponseText);
    return null;
  }
  
  if (data.code === 0) {
    console.log('✅ 文档已存在');
    return data.data;
  } else {
    console.log('⚠️  文档不存在');
    return null;
  }
}

async function getDocumentBlocks(documentId: string, accessToken: string): Promise<string[]> {
  console.log('🔍 获取文档内容块...');
  
  const response = await fetch(`https://open.feishu.cn/open-apis/docx/v1/documents/${documentId}/blocks`, {
    method: 'GET',
    headers: {
      'Authorization': `Bearer ${accessToken}`
    }
  });

  const responseText = await response.text();
  
  // 移除 BOM（Byte Order Mark）
  const cleanedResponseText = responseText.replace(/^\uFEFF/, '');
  
  console.log('📥 飞书 API 响应:', cleanedResponseText.substring(0, 200));
  
  let data;
  try {
    data = JSON.parse(cleanedResponseText);
  } catch (error) {
    console.error('❌ JSON 解析失败');
    console.error('📝 错误信息:', error);
    console.error('📄 响应内容（前 500 字符）:');
    console.error(cleanedResponseText.substring(0, 500));
    console.error('📄 响应内容（完整）:');
    console.error(cleanedResponseText);
    return [];
  }
  
  if (data.code !== 0) {
    console.log('⚠️  获取文档内容块失败');
    return [];
  }

  const blockIds = data.data.items.map((item: any) => item.block_id);
  console.log(`✅ 找到 ${blockIds.length} 个内容块`);
  return blockIds;
}

async function clearDocumentBlocks(documentId: string, accessToken: string): Promise<void> {
  console.log('🗑️ 清空文档内容...');
  
  const blockIds = await getDocumentBlocks(documentId, accessToken);
  
  if (blockIds.length === 0) {
    console.log('✅ 文档已经是空的');
    return;
  }

  const response = await fetch(`https://open.feishu.cn/open-apis/docx/v1/documents/${documentId}/blocks/batch_delete`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${accessToken}`
    },
    body: JSON.stringify({
      block_ids: blockIds
    })
  });

  const responseText = await response.text();
  
  // 移除 BOM（Byte Order Mark）
  const cleanedResponseText = responseText.replace(/^\uFEFF/, '');
  
  console.log('📥 飞书 API 响应:', cleanedResponseText.substring(0, 200));
  
  let data;
  try {
    data = JSON.parse(cleanedResponseText);
  } catch (error) {
    console.error('❌ JSON 解析失败');
    console.error('📝 错误信息:', error);
    console.error('📄 响应内容（前 500 字符）:');
    console.error(cleanedResponseText.substring(0, 500));
    console.error('📄 响应内容（完整）:');
    console.error(cleanedResponseText);
    console.log('⚠️ 清空文档失败，可能需要手动删除内容块');
    return;
  }
  
  if (data.code !== 0) {
    console.log('⚠️ 清空文档失败，可能需要手动删除内容块');
  } else {
    console.log('✅ 文档内容已清空');
  }
}

async function createFeishuDocument(accessToken: string): Promise<string> {
  console.log('📄 创建飞书文档...');
  
  const response = await fetch('https://open.feishu.cn/open-apis/docx/v1/documents', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${accessToken}`
    },
    body: JSON.stringify({
      title: 'Playwright 截图对比报告',
      folder_token: ''
    })
  });

  const responseText = await response.text();
  
  // 移除 BOM（Byte Order Mark）
  const cleanedResponseText = responseText.replace(/^\uFEFF/, '');
  
  console.log('📥 飞书 API 响应:', cleanedResponseText.substring(0, 200));
  
  let data;
  try {
    data = JSON.parse(cleanedResponseText);
  } catch (error) {
    console.error('❌ JSON 解析失败');
    console.error('📝 错误信息:', error);
    console.error('📄 响应内容（前 500 字符）:');
    console.error(cleanedResponseText.substring(0, 500));
    console.error('📄 响应内容（完整）:');
    console.error(cleanedResponseText);
    throw new Error(`创建文档失败: JSON 解析错误`);
  }
  
  if (data.code !== 0) {
    throw new Error(`创建文档失败: ${data.msg}`);
  }

  console.log(`✅ 文档创建成功: ${data.data.document.document_id}`);
  return data.data.document.document_id;
}

async function addBlocksToDocument(documentId: string, blocks: FeishuDocBlock[], accessToken: string): Promise<void> {
  console.log(`📝 添加 ${blocks.length} 个内容块到文档...`);
  
  // 首先获取文档的根 block ID
  console.log('🔍 获取文档根 block ID...');
  const docResponse = await fetch(`https://open.feishu.cn/open-apis/docx/v1/documents/${documentId}`, {
    method: 'GET',
    headers: {
      'Authorization': `Bearer ${accessToken}`
    }
  });

  const docResponseText = await docResponse.text();
  const cleanedDocResponseText = docResponseText.replace(/^\uFEFF/, '');
  
  let docData;
  try {
    docData = JSON.parse(cleanedDocResponseText);
  } catch (error) {
    console.error('❌ JSON 解析失败');
    console.error('📝 错误信息:', error);
    console.error('📄 响应内容（前 500 字符）:');
    console.error(cleanedDocResponseText.substring(0, 500));
    throw new Error(`获取文档信息失败: JSON 解析错误`);
  }
  
  if (docData.code !== 0) {
    throw new Error(`获取文档信息失败: ${docData.msg}`);
  }

  const rootBlockId = docData.data.document.document_id;
  console.log(`✅ 获取到根 block ID: ${rootBlockId}`);

  // 飞书 API 不支持批量创建，需要逐个创建
  // 飞书 API 频率限制：每秒 3 次，需要添加延迟
  for (let i = 0; i < blocks.length; i++) {
    const block = blocks[i];
    console.log(`📝 添加第 ${i + 1}/${blocks.length} 个内容块...`);
    
    // 添加延迟，避免触发频率限制
    if (i > 0) {
      console.log('⏳ 等待 500ms 避免触发频率限制...');
      await new Promise(resolve => setTimeout(resolve, 500));
    }
    
    const blockId = `block_${i}`;
    
    const descendant: any = {
      block_id: blockId,
      block_type: block.block_type,
      children: []
    };
    
    if (block.text) {
      descendant.text = block.text;
    }
    if (block.heading1) {
      descendant.heading1 = block.heading1;
    }
    if (block.heading2) {
      descendant.heading2 = block.heading2;
    }
    if (block.heading3) {
      descendant.heading3 = block.heading3;
    }
    if (block.image) {
      descendant.image = block.image;
    }
    if (block.table) {
      descendant.table = block.table;
    }
    
    const requestBody = {
      index: -1,
      children_id: [blockId],
      descendants: [descendant]
    };

    console.log('📤 请求体:', JSON.stringify(requestBody));
    console.log('📤 请求体长度:', JSON.stringify(requestBody).length);
    
    const response = await fetch(`https://open.feishu.cn/open-apis/docx/v1/documents/${documentId}/blocks/${rootBlockId}/descendant`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${accessToken}`
      },
      body: JSON.stringify(requestBody)
    });

    const responseText = await response.text();
    
    // 移除 BOM（Byte Order Mark）
    const cleanedResponseText = responseText.replace(/^\uFEFF/, '');
    
    console.log('📥 飞书 API 响应:', cleanedResponseText.substring(0, 200));
    console.log('📊 响应长度:', cleanedResponseText.length);
    console.log('📊 HTTP 状态码:', response.status);
    
    // 检查响应是否为空
    if (cleanedResponseText.length === 0) {
      console.error('❌ 飞书 API 返回空响应');
      console.error('📝 可能原因：');
      console.error('  1. 触发频率限制（每秒 3 次）');
      console.error('  2. 网络连接问题');
      console.error('  3. API 服务异常');
      throw new Error(`飞书 API 返回空响应`);
    }
    
    let data;
    try {
      data = JSON.parse(cleanedResponseText);
    } catch (error) {
      console.error('❌ JSON 解析失败');
      console.error('📝 错误信息:', error);
      console.error('📄 响应内容（前 500 字符）:');
      console.error(cleanedResponseText.substring(0, 500));
      console.error('📄 响应内容（完整）:');
      console.error(cleanedResponseText);
      throw new Error(`添加内容块失败: JSON 解析错误`);
    }
    
    if (data.code !== 0) {
      console.error('❌ 添加内容块失败');
      console.error('📝 错误码:', data.code);
      console.error('📝 错误信息:', data.msg);
      throw new Error(`添加内容块失败: ${data.msg}`);
    }
  }

  console.log('✅ 内容块添加成功');
}

async function shareDocument(documentId: string, accessToken: string): Promise<string> {
  console.log('🔗 分享文档...');
  
  const response = await fetch(`https://open.feishu.cn/open-apis/drive/v1/files/${documentId}/share`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${accessToken}`
    },
    body: JSON.stringify({
      share_entity_type: 'docx',
      share_to_client: {
        share_client_type: 'link',
        link_share_setting: {
          share_link_allow_copy: true,
          share_link_allow_comment: true,
          share_link_allow_view: true,
          share_link_public: true
        }
      }
    })
  });

  const responseText = await response.text();
  
  // 移除 BOM（Byte Order Mark）
  const cleanedResponseText = responseText.replace(/^\uFEFF/, '');
  
  console.log('📥 飞书 API 响应:', cleanedResponseText.substring(0, 200));
  
  let data;
  try {
    data = JSON.parse(cleanedResponseText);
  } catch (error) {
    console.error('❌ JSON 解析失败');
    console.error('📝 错误信息:', error);
    console.error('📄 响应内容（前 500 字符）:');
    console.error(cleanedResponseText.substring(0, 500));
    console.error('📄 响应内容（完整）:');
    console.error(cleanedResponseText);
    throw new Error(`分享文档失败: JSON 解析错误`);
  }
  
  if (data.code !== 0) {
    throw new Error(`分享文档失败: ${data.msg}`);
  }

  console.log('✅ 文档分享成功');
  return data.share_url;
}

function generateHtmlFromScreenshots(): string {
  console.log('🔍 扫描 screenshots 文件夹...');
  
  const screenshotsDir = 'screenshots';
  if (!fs.existsSync(screenshotsDir)) {
    console.error('❌ screenshots 文件夹不存在');
    process.exit(1);
  }

  const timestampDirs = fs.readdirSync(screenshotsDir)
    .filter(dir => fs.statSync(path.join(screenshotsDir, dir)).isDirectory())
    .sort()
    .reverse();

  if (timestampDirs.length === 0) {
    console.error('❌ screenshots 文件夹为空');
    process.exit(1);
  }

  const latestTimestampDir = timestampDirs[0];
  const latestDirPath = path.join(screenshotsDir, latestTimestampDir);
  const browserDirs = fs.readdirSync(latestDirPath)
    .filter(dir => fs.statSync(path.join(latestDirPath, dir)).isDirectory());

  console.log(`📁 找到 ${timestampDirs.length} 个时间戳文件夹`);
  console.log(`📁 使用最新的文件夹: ${latestTimestampDir}`);
  console.log(`📁 找到 ${browserDirs.length} 个浏览器文件夹`);

  let html = `
<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>📸 截图对比报告</title>
  <style>
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', 'PingFang SC', 'Microsoft YaHei', sans-serif;
      line-height: 1.6;
      color: #333;
      max-width: 1200px;
      margin: 0 auto;
      padding: 20px;
    }
    .container {
      display: flex;
      flex-direction: column;
      gap: 40px;
    }
    .timestamp-section {
      border: 1px solid #e0e0e0;
      border-radius: 8px;
      padding: 20px;
      background: #f9f9f9;
    }
    .timestamp-title {
      font-size: 24px;
      font-weight: bold;
      margin-bottom: 20px;
      color: #1a1a1a;
    }
    .browser-section {
      margin-bottom: 30px;
    }
    .browser-title {
      font-size: 18px;
      font-weight: bold;
      margin-bottom: 15px;
      color: #2c3e50;
    }
    .step {
      margin-bottom: 20px;
      padding: 15px;
      background: #ffffff;
      border-radius: 6px;
      box-shadow: 0 1px 3px rgba(0,0,0,0.1);
    }
    .step-title {
      font-size: 16px;
      font-weight: bold;
      margin-bottom: 10px;
      color: #1a1a1a;
    }
    .step-images {
      display: flex;
      gap: 20px;
      margin-top: 10px;
    }
    .step-image {
      flex: 1;
      max-width: 45%;
    }
    .step-image img {
      width: 100%;
      border-radius: 4px;
      border: 1px solid #e0e0e0;
    }
    .step-label {
      font-size: 14px;
      color: #666;
      margin-bottom: 5px;
    }
  </style>
</head>
<body>
  <div class="container">
    <h1>📸 截图对比报告</h1>
`;

  for (const timestampDir of timestampDirs) {
    const timestampPath = path.join(screenshotsDir, timestampDir);
    const timestampBrowserDirs = fs.readdirSync(timestampPath)
      .filter(dir => fs.statSync(path.join(timestampPath, dir)).isDirectory());

    html += `
    <div class="timestamp-section">
      <div class="timestamp-title">📅 ${timestampDir}</div>
    `;

    for (const browserDir of timestampBrowserDirs) {
      const browserPath = path.join(timestampPath, browserDir);
      const imageFiles = fs.readdirSync(browserPath)
        .filter(file => file.endsWith('.png'));

      const stepMatches: any[] = [];
      
      for (const imageFile of imageFiles) {
        const match = imageFile.match(/^step-(\d+)-(before|after)-(.+?)__(.+)\.png$/);
        if (match) {
          const stepNumber = parseInt(match[1]);
          const actionType = match[2];
          const page = match[4];
          
          let existingStep = stepMatches.find(s => s.stepNumber === stepNumber && s.actionType === actionType && s.page === page);
          if (!existingStep) {
            existingStep = {
              stepNumber,
              actionType,
              page
            };
            stepMatches.push(existingStep);
          }
          
          if (actionType === 'before') {
            existingStep.beforeImage = path.join(browserPath, imageFile);
          } else {
            existingStep.afterImage = path.join(browserPath, imageFile);
          }
        }
      }

      const sortedSteps = stepMatches.sort((a, b) => a.stepNumber - b.stepNumber);

      html += `
      <div class="browser-section">
        <div class="browser-title">🌐 ${browserDir}</div>
      `;

      for (const step of sortedSteps) {
        html += `
        <div class="step">
          <div class="step-title">步骤 ${step.stepNumber}: ${step.actionType === 'before' ? '操作前' : '操作后'} - ${step.page}</div>
          <div class="step-images">
            ${step.beforeImage ? `
              <div class="step-image">
                <div class="step-label">操作前</div>
                <img src="${step.beforeImage}" alt="操作前截图">
              </div>
            ` : ''}
            ${step.afterImage ? `
              <div class="step-image">
                <div class="step-label">操作后</div>
                <img src="${step.afterImage}" alt="操作后截图">
              </div>
            ` : ''}
          </div>
        </div>
        `;
      }

      html += `
      </div>
      `;
    }

    html += `
    </div>
    `;
  }

  html += `
  </div>
</body>
</html>
  `;

  console.log('✅ HTML 生成完成');
  return html;
}

function convertHtmlToFeishuBlocks(htmlContent: string, accessToken: string): FeishuDocBlock[] {
  console.log('🔄 转换 HTML 为飞书文档格式...');
  
  const blocks: FeishuDocBlock[] = [];
  let index = 0;

  const titleMatch = htmlContent.match(/<h1[^>]*>(.*?)<\/h1>/i);
  if (titleMatch) {
    blocks.push({
      block_type: 3,
      heading1: {
        elements: [{
          text_run: {
            content: titleMatch[1].trim(),
            text_element_style: {
              bold: true
            }
          }
        }]
      }
    });
    index++;
  }

  const h2Matches = htmlContent.matchAll(/<h2[^>]*>(.*?)<\/h2>/gi);
  for (const match of h2Matches) {
    blocks.push({
      block_type: 4,
      heading2: {
        elements: [{
          text_run: {
            content: match[1].trim(),
            text_element_style: {
              bold: true
            }
          }
        }]
      }
    });
    index++;
  }

  const h3Matches = htmlContent.matchAll(/<h3[^>]*>(.*?)<\/h3>/gi);
  for (const match of h3Matches) {
    blocks.push({
      block_type: 5,
      heading3: {
        elements: [{
          text_run: {
            content: match[1].trim(),
            text_element_style: {
              bold: true
            }
          }
        }]
      }
    });
    index++;
  }

  const paragraphs = htmlContent.split(/<h[1-6][^>]*>.*?<\/h[1-6]>/gi);
  for (const paragraph of paragraphs) {
    const cleanParagraph = paragraph
      .replace(/<style[^>]*>.*?<\/style>/gis, '')
      .replace(/<script[^>]*>.*?<\/script>/gis, '')
      .replace(/<link[^>]*>.*?>/gis, '')
      .replace(/<meta[^>]*>.*?>/gis, '')
      .replace(/<!--[\s\S]*?-->/g, '')
      .replace(/<[^>]+>/g, '')
      .replace(/&nbsp;/g, ' ')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&amp;/g, '&')
      .replace(/\s+/g, ' ')
      .trim();

    if (cleanParagraph.length > 0) {
      blocks.push({
        block_type: 2,
        text: {
          elements: [{
            text_run: {
              content: cleanParagraph
            }
          }]
        }
      });
      index++;
    }
  }

  console.log(`✅ 转换完成，生成 ${blocks.length} 个内容块`);
  return blocks;
}

async function createFeishuDoc(htmlFilePath: string, config: FeishuDocConfig): Promise<CreateDocResult> {
  try {
    console.log('🎬 飞书文档生成工具');
    console.log('');
    console.log(`📁 文件路径: ${htmlFilePath}`);
    console.log(`🔑 App ID: ${config.appId ? '已配置' : '未配置'}`);
    console.log('');

    if (!config.appId || !config.appSecret) {
      return {
        success: false,
        message: '未配置飞书开放平台应用信息（App ID 和 App Secret）'
      };

    const htmlContent = generateHtmlFromScreenshots();
    const fileName = 'screenshots-comparison-report.html';
    
    console.log(`📄 文件名: ${fileName}`);
    console.log(`📏 文件大小: ${htmlContent.length} 字符`);
    console.log('');

    const accessToken = await getAccessToken(config);
    
    // 检查是否存在之前的文档 URL
    const urlFilePath = 'results/feishu-doc-url.txt';
    let documentId: string | null = null;
    let isNewDocument = true;

    if (fs.existsSync(urlFilePath)) {
      try {
        const savedUrl = fs.readFileSync(urlFilePath, 'utf-8').trim();
        const savedDocumentId = await getDocumentIdFromUrl(savedUrl);
        
        if (savedDocumentId) {
          const docInfo = await getDocumentInfo(savedDocumentId, accessToken);
          if (docInfo) {
            console.log('🔄 检测到已存在的文档，将更新内容...');
            documentId = savedDocumentId;
            isNewDocument = false;
            
            // 清空文档内容
            await clearDocumentBlocks(documentId, accessToken);
          }
        }
      } catch (error) {
        console.log('⚠️  读取保存的文档 URL 失败，将创建新文档');
      }
    }

    // 如果没有找到现有文档，创建新文档
    if (isNewDocument || !documentId) {
      console.log('🆕 未找到现有文档，将创建新文档...');
      documentId = await createFeishuDocument(accessToken);
    }

    const blocks = convertHtmlToFeishuBlocks(htmlContent, accessToken);
    await addBlocksToDocument(documentId, blocks, accessToken);
    
    // 跳过分享步骤，直接构造文档 URL
    // const shareUrl = await shareDocument(documentId, accessToken);
    const shareUrl = `https://feishu.cn/docx/${documentId}`;
    console.log('✅ 文档 URL 构造成功:', shareUrl);

    return {
      success: true,
      message: isNewDocument ? '文档创建成功' : '文档更新成功',
      documentUrl: shareUrl,
      documentId: documentId
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
  
  if (args.length > 0) {
    htmlFilePath = args[0];
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
    } catch (error) {
      console.log('📝 未找到 feishu-config.json 文件');
    }
  }

  const result = await createFeishuDoc(htmlFilePath, config);

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
