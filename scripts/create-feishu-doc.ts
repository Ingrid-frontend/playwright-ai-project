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

  const data = await response.json();
  
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

  const data = await response.json();
  
  if (data.code !== 0) {
    throw new Error(`创建文档失败: ${data.msg}`);
  }

  console.log(`✅ 文档创建成功: ${data.data.document.document_id}`);
  return data.data.document.document_id;
}

async function addBlocksToDocument(documentId: string, blocks: FeishuDocBlock[], accessToken: string): Promise<void> {
  console.log(`📝 添加 ${blocks.length} 个内容块到文档...`);
  
  const response = await fetch(`https://open.feishu.cn/open-apis/docx/v1/documents/${documentId}/blocks/batch_create`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${accessToken}`
    },
    body: JSON.stringify({
      requests: blocks.map((block, index) => ({
        create_block: {
          block_id: `${index}`,
          parent_id: '',
          index: index,
          block_type: block.block_type,
          paragraph: block.paragraph,
          heading1: block.heading1,
          heading2: block.heading2,
          heading3: block.heading3,
          image: block.image,
          table: block.table
        }
      }))
    })
  });

  const data = await response.json();
  
  if (data.code !== 0) {
    throw new Error(`添加内容块失败: ${data.msg}`);
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

  const data = await response.json();
  
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
      block_type: 2,
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
      block_type: 3,
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
      block_type: 4,
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
      .replace(/<[^>]+>/g, '')
      .replace(/&nbsp;/g, ' ')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&amp;/g, '&')
      .trim();

    if (cleanParagraph.length > 0) {
      blocks.push({
        block_type: 1,
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
    const documentId = await createFeishuDocument(accessToken);
    const blocks = convertHtmlToFeishuBlocks(htmlContent, accessToken);
    await addBlocksToDocument(documentId, blocks, accessToken);
    const shareUrl = await shareDocument(documentId, accessToken);

    return {
      success: true,
      message: '文档创建成功',
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
