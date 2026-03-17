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

interface FeishuDocBlock {
  block_type: number;
  paragraph?: {
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
  for (let i = 0; i < blocks.length; i++) {
    const block = blocks[i];
    console.log(`📝 添加第 ${i + 1}/${blocks.length} 个内容块...`);
    
    const requestBody = {
      block_type: block.block_type,
      paragraph: block.paragraph,
      heading1: block.heading1,
      heading2: block.heading2,
      heading3: block.heading3,
      image: block.image,
      table: block.table
    };

    console.log('📤 请求体:', JSON.stringify(requestBody).substring(0, 200));
    
    const response = await fetch(`https://open.feishu.cn/open-apis/docx/v1/documents/${documentId}/blocks/${rootBlockId}/children`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${accessToken}`
      },
      body: JSON.stringify({
        children: [requestBody],
        index: i
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
  
  const response = await fetch(`https://open.feishu.cn/open-apis/drive/v1/permissions/${documentId}/share`, {
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
        paragraph: {
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
    }

    const htmlContent = fs.readFileSync(htmlFilePath, 'utf-8');
    const fileName = path.basename(htmlFilePath);
    
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
    const shareUrl = await shareDocument(documentId, accessToken);

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
