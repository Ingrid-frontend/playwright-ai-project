import fs from 'fs';
import path from 'path';

const IMG_EXT_MIME: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
};

function mimeFor(filePath: string): string {
  return IMG_EXT_MIME[path.extname(filePath).toLowerCase()] || 'image/png';
}

/**
 * 把客户报告 HTML 中引用的 `-assets/` 图片内嵌为 base64 data URI，
 * 让报告可以脱离仓库目录单独打开/发送而不裂图。
 *
 * 注意：此函数应在 sanitizeCustomerReportHtml 之后调用，因为 sanitize 已把
 * 图片复制到 `<slug>-assets/` 并使用相对路径；内嵌只处理该目录下的引用。
 */
export function inlineCustomerReportAssets(html: string, outputPath: string): string {
  const htmlDir = path.dirname(path.resolve(outputPath));
  const slug = path.basename(outputPath).replace(/\.html?$/i, '');
  const assetsDir = `${slug}-assets`;

  // 匹配 <slug>-assets/ 下的图片引用（src / data-screenshot）
  const re = new RegExp(`(src|data-screenshot)="${assetsDir}/([^"]+)"`, 'g');
  const refs = new Map<string, string>();
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) {
    const attr = m[1]!;
    const assetName = m[2]!;
    refs.set(`${attr}="${assetsDir}/${assetName}"`, assetName);
  }

  let out = html;
  for (const [marker, assetName] of refs) {
    const filePath = path.join(htmlDir, assetsDir, assetName);
    let dataUri: string;
    if (fs.existsSync(filePath)) {
      const buf = fs.readFileSync(filePath);
      dataUri = `data:${mimeFor(filePath)};base64,${buf.toString('base64')}`;
    } else {
      // 文件缺失时保留原引用，让浏览器显示裂图而不是报错；
      // 正常流程 sanitize 已保证文件存在
      continue;
    }
    // marker 形如 src="ui-regression-customer-assets/img-xxx.png"
    // 替换为 src="data:image/png;base64,..."
    const attr = marker.split('=')[0]!;
    out = out.split(marker).join(`${attr}="${dataUri}"`);
  }

  return out;
}
