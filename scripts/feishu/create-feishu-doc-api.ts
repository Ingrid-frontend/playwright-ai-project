import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';
import { fetchWithRetry } from './index.js';

dotenv.config();

const sensitiveLogsEnabled = process.env.ENABLE_SENSITIVE_LOGS === '1';

export interface FeishuDocConfig {
  appId: string;
  appSecret: string;
}

export interface CreateDocResult {
  success: boolean;
  message: string;
  documentUrl?: string;
  documentId?: string;
}

export interface FeishuDocBlock {
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

export interface FeishuDocElement {
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

export interface FeishuDocCell {
    column: number;
    row: number;
    content?: FeishuDocBlock[];
}

export async function getAccessToken(config: FeishuDocConfig): Promise<string> {
  console.log('🔑 获取飞书访问令牌...');
  
  const response = await fetchWithRetry('https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal', {
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
  
  if (sensitiveLogsEnabled) {
    console.log('📥 飞书 API 响应:', cleanedResponseText.substring(0, 200));
  } else {
    console.log('📥 飞书 API 响应: (已隐藏，设置 ENABLE_SENSITIVE_LOGS=1 查看)');
  }
  console.log('📊 响应长度:', cleanedResponseText.length);
  
  let data;
  try {
    data = JSON.parse(cleanedResponseText);
  } catch (error) {
    console.error('❌ JSON 解析失败');
    console.error('📝 错误信息:', error);
    if (sensitiveLogsEnabled) {
      console.error('📄 响应内容（前 500 字符）:');
      console.error(cleanedResponseText.substring(0, 500));
      console.error('📄 响应内容（完整）:');
      console.error(cleanedResponseText);
    } else {
      console.error('📄 响应内容: (已隐藏，设置 ENABLE_SENSITIVE_LOGS=1 查看)');
    }
    throw new Error(`解析飞书 API 响应失败: ${error}`);
  }
  
  if (data.code !== 0) {
    throw new Error(`获取访问令牌失败: ${data.msg}`);
  }

  console.log('✅ 访问令牌获取成功');
  return data.tenant_access_token;
}

export async function uploadImageToFeishu(imagePath: string, accessToken: string): Promise<string> {
  console.log(`📤 上传图片: ${path.basename(imagePath)}`);
  
  const imageBuffer = fs.readFileSync(imagePath);
  const fileName = path.basename(imagePath);
  const fileSize = imageBuffer.length;

  const formData = new FormData();
  const ext = path.extname(fileName).toLowerCase();
  const mimeType = ext === '.jpg' || ext === '.jpeg' ? 'image/jpeg' : ext === '.gif' ? 'image/gif' : 'image/png';
  formData.append('file', new Blob([imageBuffer], { type: mimeType }), fileName);
  formData.append('file_type', 'image');

  const response = await fetchWithRetry(`https://open.feishu.cn/open-apis/drive/v1/medias/upload_all?size=${fileSize}`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${accessToken}`
    },
    body: formData
  });

  const responseText = await response.text();
  
  if (sensitiveLogsEnabled) {
    console.log(`📥 图片上传响应: ${responseText.substring(0, 200)}`);
  } else {
    console.log('📥 图片上传响应: (已隐藏，设置 ENABLE_SENSITIVE_LOGS=1 查看)');
  }
  
  let data;
  try {
    data = JSON.parse(responseText);
  } catch {
    throw new Error(`上传图片失败: 无法解析响应 - ${responseText.substring(0, 200)}`);
  }
  
  if (data.code !== 0) {
    throw new Error(`上传图片失败: ${data.msg}`);
  }

  console.log(`✅ 图片上传成功: ${data.file.token ? '已返回 token（已隐藏）' : '成功'}`);
  return data.file.token;
}

export async function getDocumentIdFromUrl(url: string): Promise<string | null> {
  try {
    const match = url.match(/docx\/([a-zA-Z0-9_-]+)/);
    return match ? match[1] : null;
  } catch {
    return null;
  }
}

export async function getDocumentInfo(documentId: string, accessToken: string): Promise<any> {
  console.log(`🔍 检查文档是否存在: ${documentId}`);
  
  const response = await fetchWithRetry(`https://open.feishu.cn/open-apis/docx/v1/documents/${documentId}`, {
    method: 'GET',
    headers: {
      'Authorization': `Bearer ${accessToken}`
    }
  });

  const responseText = await response.text();
  
  // 移除 BOM（Byte Order Mark）
  const cleanedResponseText = responseText.replace(/^\uFEFF/, '');
  
  if (sensitiveLogsEnabled) {
    console.log('📥 飞书 API 响应:', cleanedResponseText.substring(0, 200));
  } else {
    console.log('📥 飞书 API 响应: (已隐藏，设置 ENABLE_SENSITIVE_LOGS=1 查看)');
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

export async function getDocumentBlocks(documentId: string, accessToken: string): Promise<string[]> {
  console.log('🔍 获取文档内容块...');
  
  const response = await fetchWithRetry(`https://open.feishu.cn/open-apis/docx/v1/documents/${documentId}/blocks`, {
    method: 'GET',
    headers: {
      'Authorization': `Bearer ${accessToken}`
    }
  });

  const responseText = await response.text();
  
  // 移除 BOM（Byte Order Mark）
  const cleanedResponseText = responseText.replace(/^\uFEFF/, '');
  
  if (sensitiveLogsEnabled) {
    console.log('📥 飞书 API 响应:', cleanedResponseText.substring(0, 200));
  } else {
    console.log('📥 飞书 API 响应: (已隐藏，设置 ENABLE_SENSITIVE_LOGS=1 查看)');
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

export async function clearDocumentBlocks(documentId: string, accessToken: string): Promise<void> {
  console.log('🗑️ 清空文档内容...');
  
  const blockIds = await getDocumentBlocks(documentId, accessToken);
  
  if (blockIds.length === 0) {
    console.log('✅ 文档已经是空的');
    return;
  }

  const response = await fetchWithRetry(`https://open.feishu.cn/open-apis/docx/v1/documents/${documentId}/blocks/batch_delete`, {
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
  
  if (sensitiveLogsEnabled) {
    console.log('📥 飞书 API 响应:', cleanedResponseText.substring(0, 200));
  } else {
    console.log('📥 飞书 API 响应: (已隐藏，设置 ENABLE_SENSITIVE_LOGS=1 查看)');
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
    console.log('⚠️ 清空文档失败，可能需要手动删除内容块');
    return;
  }
  
  if (data.code !== 0) {
    console.log('⚠️ 清空文档失败，可能需要手动删除内容块');
  } else {
    console.log('✅ 文档内容已清空');
  }
}

export async function createFeishuDocument(accessToken: string): Promise<string> {
  console.log('📄 创建飞书文档...');
  
  const createBody: { title: string; folder_token?: string } = {
    title: 'Playwright 截图对比报告',
  };
  const folderToken = process.env.FEISHU_DOC_FOLDER_TOKEN?.trim();
  if (folderToken) createBody.folder_token = folderToken;

  const response = await fetchWithRetry('https://open.feishu.cn/open-apis/docx/v1/documents', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${accessToken}`
    },
    body: JSON.stringify(createBody),
  });

  const responseText = await response.text();
  
  // 移除 BOM（Byte Order Mark）
  const cleanedResponseText = responseText.replace(/^\uFEFF/, '');
  
  if (sensitiveLogsEnabled) {
    console.log('📥 飞书 API 响应:', cleanedResponseText.substring(0, 200));
  } else {
    console.log('📥 飞书 API 响应: (已隐藏，设置 ENABLE_SENSITIVE_LOGS=1 查看)');
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
    throw new Error(`创建文档失败: JSON 解析错误`);
  }
  
  if (data.code !== 0) {
    throw new Error(`创建文档失败: ${data.msg}`);
  }

  console.log(`✅ 文档创建成功: ${data.data.document.document_id}`);
  return data.data.document.document_id;
}

export async function addBlocksToDocument(documentId: string, blocks: FeishuDocBlock[], accessToken: string): Promise<void> {
  console.log(`📝 添加 ${blocks.length} 个内容块到文档...`);
  
  // 首先获取文档的根 block ID
  console.log('🔍 获取文档根 block ID...');
  const docResponse = await fetchWithRetry(`https://open.feishu.cn/open-apis/docx/v1/documents/${documentId}`, {
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

  if (sensitiveLogsEnabled) {
    console.log('📤 请求体:', JSON.stringify(requestBody));
    console.log('📤 请求体长度:', JSON.stringify(requestBody).length);
  } else {
    console.log('📤 请求体: (已隐藏，设置 ENABLE_SENSITIVE_LOGS=1 查看)');
  }
    
    const response = await fetchWithRetry(`https://open.feishu.cn/open-apis/docx/v1/documents/${documentId}/blocks/${rootBlockId}/descendant`, {
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
    
    if (sensitiveLogsEnabled) {
      console.log('📥 飞书 API 响应:', cleanedResponseText.substring(0, 200));
    } else {
      console.log('📥 飞书 API 响应: (已隐藏，设置 ENABLE_SENSITIVE_LOGS=1 查看)');
    }
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

export async function shareDocument(documentId: string, accessToken: string): Promise<string> {
  console.log('🔗 分享文档...');
  
  const response = await fetchWithRetry(`https://open.feishu.cn/open-apis/drive/v1/files/${documentId}/share`, {
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
  
  if (sensitiveLogsEnabled) {
    console.log('📥 飞书 API 响应:', cleanedResponseText.substring(0, 200));
  } else {
    console.log('📥 飞书 API 响应: (已隐藏，设置 ENABLE_SENSITIVE_LOGS=1 查看)');
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
    throw new Error(`分享文档失败: JSON 解析错误`);
  }
  
  if (data.code !== 0) {
    throw new Error(`分享文档失败: ${data.msg}`);
  }

  console.log('✅ 文档分享成功');
  return data.share_url;
}
