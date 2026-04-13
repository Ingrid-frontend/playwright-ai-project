import fs from 'fs';
import path from 'path';

interface FeishuConfig {
  appId: string;
  appSecret: string;
  tenantKey?: string;
}

interface UploadResult {
  success: boolean;
  message: string;
  documentUrl?: string;
}

async function uploadToFeishuCloud(htmlFilePath: string, config: FeishuConfig): Promise<UploadResult> {
  try {
    console.log('📤 开始上传到飞书云文档...');
    console.log(`📁 文件路径: ${htmlFilePath}`);
    console.log(`🔑 App ID: ${config.appId}`);

    const htmlContent = fs.readFileSync(htmlFilePath, 'utf-8');
    const fileName = path.basename(htmlFilePath);
    
    console.log(`📄 文件名: ${fileName}`);
    console.log(`📏 文件大小: ${htmlContent.length} 字符`);

    console.log('⚠️  飞书云文档 API 需要以下配置：');
    console.log('  1. 飞书开放平台应用');
    console.log('  2. App ID 和 App Secret');
    console.log('  3. 文档上传权限');
    console.log('');
    console.log('📋 配置方式：');
    console.log('  方式 1: 环境变量');
    console.log('    FEISHU_APP_ID=your_app_id');
    console.log('    FEISHU_APP_SECRET=your_app_secret');
    console.log('');
    console.log('  方式 2: 配置文件');
    console.log('    创建 feishu-config.json');
    console.log('    {');
    console.log('      "appId": "your_app_id",');
    console.log('      "appSecret": "your_app_secret"');
    console.log('    }');

    return {
      success: false,
      message: '需要配置飞书开放平台应用信息'
    };

  } catch (error) {
    console.error('❌ 上传失败:', error);
    return {
      success: false,
      message: `上传失败: ${error}`
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

  console.log('🎬 飞书云文档上传工具');
  console.log('');

  const config: FeishuConfig = {
    appId: process.env.FEISHU_APP_ID || '',
    appSecret: process.env.FEISHU_APP_SECRET || '',
    tenantKey: process.env.FEISHU_TENANT_KEY || ''
  };

  if (!config.appId || !config.appSecret) {
    const configPath = 'feishu-config.json';
    if (fs.existsSync(configPath)) {
      const configContent = fs.readFileSync(configPath, 'utf-8');
      const configData = JSON.parse(configContent);
      config.appId = configData.appId || '';
      config.appSecret = configData.appSecret || '';
      config.tenantKey = configData.tenantKey || '';
    }
  }

  const result = await uploadToFeishuCloud(htmlFilePath, config);

  if (result.success) {
    console.log('');
    console.log('✅ 上传成功！');
    console.log(`📄 文档链接: ${result.documentUrl}`);
    console.log('');
    console.log('💡 提示：');
    console.log('  1. 可以将链接分享给团队成员');
    console.log('  2. 可以在飞书中查看和编辑文档');
    console.log('  3. 文档会自动更新（如果文件名相同）');
  } else {
    console.log('');
    console.log('❌ 上传失败');
    console.log(`📝 错误信息: ${result.message}`);
    console.log('');
    console.log('💡 解决方案：');
    console.log('  1. 检查飞书开放平台应用配置');
    console.log('  2. 确认应用有文档上传权限');
    console.log('  3. 检查网络连接');
  }
}

main();
