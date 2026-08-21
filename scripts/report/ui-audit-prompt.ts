import type { StepMeta } from './structure-check.js';

export interface AuditStepContext {
  /** 脚本标识，如 intent/dev/审批列表页可见 */
  scriptKey: string;
  stepName: string;
  stepNumber?: number;
  /** 业务期望（可选），来自 Test Spec 或配置 */
  expect?: string[];
}

/** 严格 JSON 输出契约 —— 单独抽出便于自测断言 */
export const AUDIT_RESULT_CONTRACT = `{
  "score": 0-100 的整数,
  "verdict": "pass" | "review" | "fail",
  "issues": [
    {
      "type": "overflow|occlusion|truncation|layout|whitespace|component|missing-element|console|other",
      "severity": "blocker|warning|noise",
      "selector": "CSS 选择器或空字符串",
      "bbox": { "x": 数字, "y": 数字, "width": 数字, "height": 数字 },
      "description": "不超过 60 字的中文说明",
      "confidence": 0 到 1 的小数
    }
  ]
}`;

export function buildAuditSystemPrompt(): string {
  return `你是资深 UI 审查工程师，负责判断一张页面截图是否存在**有意义的 UI 缺陷**。

你会收到四部分输入：截图、DOM 摘要、元素几何信息、测试步骤上下文。

只报告以下真实缺陷类型：
- overflow：内容溢出容器或横向溢出视口
- occlusion：元素被遮挡、重叠
- truncation：文字被截断（出现异常省略、半个字）
- layout：错位、对不齐、控件跑到异常位置
- whitespace：异常大面积空白、内容区塌陷
- component：控件渲染异常（表格空、按钮变形、图片裂图）
- missing-element：应存在的关键元素缺失
- console：运行时报错导致的渲染问题

严格禁止：
1. 不做审美评价（配色好不好看、间距美不美）
2. 不猜测业务逻辑正确性
3. 不把正常的动态数据（时间、数字、头像）当缺陷
4. 没有把握就不报，或用低 confidence + severity=noise

bbox 必须使用**截图视口坐标系**（左上角为原点，单位 px）。无法定位时 bbox 用 null。

severity 判定：
- blocker：功能不可用/关键内容不可读/页面明显错乱
- warning：影响观感或局部错位，但功能仍可用
- noise：轻微、疑似渲染噪声

只输出 JSON，不要 markdown 代码块，不要任何解释文字。格式：
${AUDIT_RESULT_CONTRACT}`;
}

function fmtBBox(b?: { x: number; y: number; width: number; height: number }): string {
  if (!b) return '无几何信息';
  return `x=${Math.round(b.x)}, y=${Math.round(b.y)}, w=${Math.round(b.width)}, h=${Math.round(b.height)}`;
}

/** 从 StepMeta 组装 DOM 摘要 + 元素几何 */
function buildDomSection(meta: StepMeta): string {
  const lines: string[] = [];
  const selectors = meta.selectors ?? {};
  const entries = Object.entries(selectors);

  if (entries.length === 0) {
    lines.push('（本步骤未配置关键选择器检查）');
  } else {
    for (const [key, info] of entries) {
      if (!info) continue;
      const status = info.exists ? '存在' : '**缺失**';
      const geo = info.exists ? fmtBBox(info.bbox) : '—';
      lines.push(`- ${key}: ${status}, ${geo}`);
    }
  }

  const texts = meta.textSections ?? [];
  if (texts.length > 0) {
    lines.push('');
    lines.push('文本区域内容：');
    for (const t of texts.slice(0, 8)) {
      const text = (t.text || '').replace(/\s+/g, ' ').slice(0, 120);
      lines.push(`- ${t.key}(${t.charCount}字): ${text || '(空)'}`);
    }
  }

  return lines.join('\n');
}

export function buildAuditUserPrompt(meta: StepMeta, ctx: AuditStepContext): string {
  const vp = meta.viewport;
  const imgW = meta.imageWidth ?? vp?.width ?? 0;
  const imgH = meta.imageHeight ?? vp?.height ?? 0;
  const layout = meta.layout ?? {};
  const overflow =
    layout.horizontalOverflow && layout.scrollWidth && layout.innerWidth
      ? `是（scrollWidth=${layout.scrollWidth} > innerWidth=${layout.innerWidth}，溢出 ${layout.scrollWidth - layout.innerWidth}px）`
      : '否';

  const errs = [...(meta.pageErrors ?? []), ...(meta.consoleErrors ?? [])];
  const errSection =
    errs.length > 0
      ? errs
          .slice(0, 5)
          .map((e) => `- ${String(e).slice(0, 160)}`)
          .join('\n')
      : '无';

  const expectSection =
    ctx.expect && ctx.expect.length > 0 ? ctx.expect.map((e) => `- ${e}`).join('\n') : '（未声明）';

  return `【测试步骤】
- 脚本: ${ctx.scriptKey}
- 步骤: ${ctx.stepNumber != null ? `#${ctx.stepNumber} ` : ''}${ctx.stepName}
- 页面地址: ${meta.url ?? '未知'}
- 页面标题: ${meta.title ?? '未知'}
- 视口: ${vp?.width ?? '?'}x${vp?.height ?? '?'}
- 截图像素尺寸: ${imgW}x${imgH}
- 横向溢出: ${overflow}

【业务期望】
${expectSection}

【DOM 摘要 / 元素几何】
${buildDomSection(meta)}

【运行时错误】
${errSection}

请审查截图，按约定 JSON 输出审计结果。注意 bbox 使用视口坐标系（视口宽 ${vp?.width ?? imgW}px）。`;
}
