import path from 'path';
import { type FeishuDocBlock } from './create-feishu-doc-api.js';

export async function convertHtmlToFeishuBlocks(htmlContent: string, accessToken: string): Promise<FeishuDocBlock[]> {
  void accessToken;
  console.log('🔄 转换 HTML 为飞书文档格式...');
  
  const blocks: FeishuDocBlock[] = [];

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
  }

  const paragraphs = htmlContent.split(/<h[1-6][^>]*>.*?<\/h[1-6]>/gi);
  for (const paragraph of paragraphs) {
    const cleanParagraph = paragraph
      .replace(/<style[^>]*>.*?<\/style>/gis, '')
      .replace(/<script[^>]*>.*?<\/script>/gis, '')
      .replace(/<link[^>]*>.*?>/gis, '')
      .replace(/<meta[^>]*>.*?>/gis, '')
      .replace(/<!--[\s\S]*?-->/g, '');

    const imgMatches = cleanParagraph.matchAll(/<img[^>]+>/gi);
    for (const imgMatch of imgMatches) {
      const srcMatch = imgMatch[0].match(/src=["']([^"']+)["']/);
      if (srcMatch && srcMatch[1]) {
        const imagePath = srcMatch[1];
        const imageName = path.basename(imagePath);
        
        console.log(`🔍 处理图片: ${imagePath}`);
        console.log(`  - 是否以 ../screenshots/ 开头: ${imagePath.startsWith('../screenshots/')}`);
        console.log(`  - 是否以 screenshots/ 开头: ${imagePath.startsWith('screenshots/')}`);
        console.log(`  - 是否以 diffs/ 开头: ${imagePath.startsWith('diffs/')}`);
        
        const githubEnabled = process.env.ENABLE_GITHUB === '1';
        const publicAssetBaseUrl = (githubEnabled ? process.env.PUBLIC_ASSET_BASE_URL : '') || '';

        let fullImageUrl = '';
        if (publicAssetBaseUrl) {
          const base = publicAssetBaseUrl.replace(/\/$/, '');
          if (imagePath.startsWith('../screenshots/')) {
            fullImageUrl = `${base}/screenshots/${imagePath.replace('../screenshots/', '')}`;
          } else if (imagePath.startsWith('screenshots/')) {
            fullImageUrl = `${base}/screenshots/${imagePath.replace('screenshots/', '')}`;
          } else if (imagePath.startsWith('diffs/')) {
            fullImageUrl = `${base}/results/${imagePath}`;
          }
        }

        if (!fullImageUrl) {
          console.log(
            `  - ℹ️  未配置公开图片链接（ENABLE_GITHUB!=1 或未提供 PUBLIC_ASSET_BASE_URL），仅记录本地路径`,
          );
          fullImageUrl = imagePath;
        }

        console.log(`  - 最终 URL/路径: ${fullImageUrl}`);
        
        blocks.push({
          block_type: 2,
          text: {
            elements: [{
              text_run: {
                content: `📷 图片: ${imageName}`,
                text_element_style: {
                  link: {
                    url: fullImageUrl
                  }
                }
              }
            }]
          }
        });
      }
    }

    const textContent = cleanParagraph
      .replace(/<img[^>]+>/gi, '')
      .replace(/<[^>]+>/g, '')
      .replace(/&nbsp;/g, ' ')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&amp;/g, '&')
      .replace(/\s+/g, ' ')
      .trim();

    if (textContent.length > 0) {
      blocks.push({
        block_type: 2,
        text: {
          elements: [{
            text_run: {
              content: textContent
            }
          }]
        }
      });
    }
  }

  console.log(`✅ 转换完成，生成 ${blocks.length} 个内容块`);
  return blocks;
}
