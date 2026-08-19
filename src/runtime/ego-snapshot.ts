export type SnapshotNode = {
  ref: number;
  role: string;
  name: string;
  raw: string;
};

type ParsedLine = {
  indent: number;
  role: string;
  /** 同一行引号内的可访问名（若有） */
  inlineName: string;
  /** [ref=N, loc=…] 中的 N，无则 undefined */
  ref?: number;
  raw: string;
};

/**
 * 拆分 ego 的一行 snapshot。真实格式形如：
 *   `anchor [ref=8, loc=href:/a, url=http://x/a]`
 *   `textbox "姓名" [ref=1, loc=css:input[aria-label="姓名"]]`
 *   `text "审批列表"`
 * `[ref=` 之后全是元数据（loc/url），不能参与 role/name 解析。
 */
function parseLine(line: string): ParsedLine | null {
  const withoutTabs = line.replace(/\t/g, '  ');
  const trimmed = withoutTabs.trim();
  if (!trimmed) return null;

  const indent = withoutTabs.length - withoutTabs.trimStart().length;

  // 兼容旧式 `@12 [button] "提交"` 与真实式 `button [ref=12, loc=…]`
  const refMatch = trimmed.match(/\[ref=(\d+)/i) || trimmed.match(/^@(\d+)\b/);
  const ref = refMatch ? Number(refMatch[1]) : undefined;

  // 只保留元数据方括号之前的部分作为 role/name 来源
  const metaIndex = trimmed.search(/\[(?:ref=|loc=|url=)/i);
  let head = metaIndex >= 0 ? trimmed.slice(0, metaIndex) : trimmed;
  head = head.replace(/^@\d+\s*/, '').trim();

  // 旧式 role 方括号：`[button] "提交"`
  let role = '';
  const roleBracket = head.match(/^\[([^\]]+)\]/);
  if (roleBracket) {
    role = roleBracket[1].trim().toLowerCase();
    head = head.slice(roleBracket[0].length).trim();
  }

  let inlineName = '';
  const quoted = head.match(/"([^"]*)"/) || head.match(/'([^']*)'/);
  if (quoted) {
    inlineName = quoted[1].trim();
    head = head.slice(0, quoted.index ?? head.length).trim();
  }

  if (!role) {
    const roleToken = head.match(/^([A-Za-z][\w-]*)/);
    if (roleToken) role = roleToken[1].toLowerCase();
  }

  if (!role && ref === undefined && !inlineName) return null;
  return { indent, role, inlineName, ref, raw: trimmed };
}

/** 该 role 本身就承载可见文案（用于给父节点补名） */
function isTextRole(role: string): boolean {
  return role === 'text' || role === 'statictext' || role === 'label' || role === 'paragraph';
}

/** 解析 ego snapshotText（缩进树）为带 ref 的节点列表 */
export function parseSnapshotText(snapshot: string): SnapshotNode[] {
  const lines: ParsedLine[] = [];
  for (const line of snapshot.split(/\r?\n/)) {
    const parsed = parseLine(line);
    if (parsed) lines.push(parsed);
  }

  const nodes: SnapshotNode[] = [];
  const seen = new Set<number>();

  for (let i = 0; i < lines.length; i++) {
    const cur = lines[i];
    if (cur.ref === undefined || !Number.isFinite(cur.ref) || seen.has(cur.ref)) continue;

    // 收集后代文本：缩进更深、且遇到同级/更浅缩进即停
    const descendantTexts: string[] = [];
    for (let j = i + 1; j < lines.length; j++) {
      const next = lines[j];
      if (next.indent <= cur.indent) break;
      if (isTextRole(next.role) && next.inlineName) descendantTexts.push(next.inlineName);
    }

    let name = cur.inlineName;
    if (!name && descendantTexts.length > 0) {
      name = descendantTexts.every((t) => t.length <= 2)
        ? descendantTexts.join('')
        : descendantTexts.join(' ');
    }

    // 无名控件（如 checkbox [ref=4]）常由紧邻的同级 text 兄弟做标签
    if (!name) {
      const sibling = lines[i + 1];
      if (sibling && sibling.indent === cur.indent && isTextRole(sibling.role) && sibling.inlineName) {
        name = sibling.inlineName;
      }
    }

    const rawParts = [cur.raw, ...descendantTexts.map((t) => `text "${t}"`)];
    seen.add(cur.ref);
    nodes.push({
      ref: cur.ref,
      role: cur.role,
      name: name.trim().slice(0, 200),
      raw: rawParts.join(' | '),
    });
  }

  return nodes;
}

/** 提取 snapshot 中所有可见文案（节点名 + text 行），排除 loc=/url= 等元数据 */
export function extractVisibleTexts(snapshot: string): string[] {
  const out: string[] = [];
  for (const line of snapshot.split(/\r?\n/)) {
    const parsed = parseLine(line);
    if (parsed?.inlineName) out.push(parsed.inlineName);
  }
  for (const node of parseSnapshotText(snapshot)) {
    if (node.name) out.push(node.name);
  }
  return out;
}

export function findCandidates(
  nodes: SnapshotNode[],
  description: string,
  opts: { roles?: string[] } = {},
): SnapshotNode[] {
  const needle = description.trim().toLowerCase();
  if (!needle) return [];

  const roleSet = opts.roles?.map((r) => r.toLowerCase());
  const scored = nodes
    .filter((n) => !roleSet || !n.role || roleSet.includes(n.role))
    .map((n) => {
      const hay = `${n.name} ${n.raw}`.toLowerCase();
      let score = 0;
      if (n.name.toLowerCase() === needle) score = 100;
      else if (n.name.toLowerCase().includes(needle)) score = 80;
      else if (hay.includes(needle)) score = 50;
      else if (needle.split(/\s+/).every((p) => p && hay.includes(p))) score = 40;
      return { n, score };
    })
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score);

  return scored.map((x) => x.n);
}

/**
 * 断言：Snapshot 的「可见文案」是否包含期望内容（程序化，不经 LLM）。
 * 只匹配解析出的可见文本，避免命中 loc=css:input[placeholder="…"] 之类元数据造成假阳性。
 * 相邻 text 节点会拼接后再匹配（如「审批」+「意见」）。
 */
export function snapshotContainsText(snapshot: string, expected: string): boolean {
  const needle = expected.trim().toLowerCase().replace(/\s+/g, '');
  if (!needle) return false;
  const texts = extractVisibleTexts(snapshot)
    .map((text) => text.toLowerCase().replace(/\s+/g, ''))
    .filter(Boolean);
  if (texts.some((text) => text.includes(needle))) return true;
  for (let i = 0; i < texts.length; i++) {
    let acc = texts[i];
    for (let j = i + 1; j < Math.min(texts.length, i + 4); j++) {
      acc += texts[j];
      if (acc.includes(needle)) return true;
    }
  }
  return false;
}

export function summarizeSnapshot(snapshot: string, maxChars = 12_000): string {
  const text = snapshot.trim();
  if (text.length <= maxChars) return text;
  return `${text.slice(0, maxChars)}\n…(truncated truncated)`;
}

export function formatNodesForPrompt(nodes: SnapshotNode[], limit = 80): string {
  return nodes
    .slice(0, limit)
    .map((n) => `@${n.ref} [${n.role || '?'}] "${n.name}"`)
    .join('\n');
}

const CONTROL_ROLES = new Set([
  'button',
  'anchor',
  'link',
  'menuitem',
  'menuitemcheckbox',
  'menuitemradio',
  'tab',
  'checkbox',
  'radio',
  'combobox',
  'option',
  'switch',
]);

/** Snapshot 里可点控件的可见名，供断言失败时对照真实按钮 */
export function listVisibleControlNames(snapshot: string, limit = 12): string[] {
  const seen = new Set<string>();
  const names: string[] = [];
  for (const n of parseSnapshotText(snapshot)) {
    if (!n.name || (n.role && !CONTROL_ROLES.has(n.role))) continue;
    const name = n.name.trim();
    if (!name || name.length > 40) continue;
    const key = name.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    names.push(name);
    if (names.length >= limit) break;
  }
  return names;
}

/** 列表行常见操作；更长短语在前，避免「审批」误点「我的审批」 */
export const LIST_ROW_ACTIONS = ['审批记录', '流程图', '查看', '详情', '处理', '日志', '审批'] as const;

export function isListActionProbe(description: string): boolean {
  const d = description.trim();
  if (!d) return false;
  if (LIST_ROW_ACTIONS.some((a) => d === a || d === `${a}操作`)) return true;
  return /列表/.test(d) && /(查看|详情|操作)/.test(d);
}

/** 按 Snapshot 真实按钮挑选列表操作：指定文案没有则改点同类可见项 */
export function pickVisibleListAction(
  nodes: SnapshotNode[],
  description: string,
  opts: { roles?: string[] } = {},
): SnapshotNode | null {
  const roleSet = opts.roles?.map((r) => r.toLowerCase());
  const controls = nodes.filter((n) => n.name && (!roleSet || !n.role || roleSet.includes(n.role)));
  const wanted = LIST_ROW_ACTIONS.filter((a) => description.includes(a));
  const order = [...wanted, ...LIST_ROW_ACTIONS.filter((a) => !wanted.includes(a))];
  for (const name of order) {
    const hit = controls.find((n) => n.name.trim() === name);
    if (hit) return hit;
  }
  return null;
}
