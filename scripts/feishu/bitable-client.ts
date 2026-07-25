import type { BitableRuntimeConfig } from './bitable-schema.js';
import { fetchWithRetry } from './feishu-utils.js';

export type BitableFieldValue = string | number | boolean | { link: string; text?: string };

export type BitableRecordFields = Record<string, BitableFieldValue | null | undefined>;

export type BitableUpsertResult = {
  recordId: string;
  created: boolean;
};

type FeishuApiResponse<T> = {
  code: number;
  msg?: string;
  data?: T;
};

type SearchRecordItem = {
  record_id: string;
  fields?: Record<string, unknown>;
};

type SearchRecordsData = {
  items?: SearchRecordItem[];
};

type CreateRecordData = {
  record?: { record_id: string };
};

export class BitableClient {
  private token: string | null = null;

  constructor(private readonly config: BitableRuntimeConfig) {}

  async upsertRecord(tableId: string, uniqueField: string, uniqueValue: string, fields: BitableRecordFields): Promise<BitableUpsertResult> {
    const existingRecordId = await this.findRecordId(tableId, uniqueField, uniqueValue);
    if (existingRecordId) {
      await this.updateRecord(tableId, existingRecordId, fields);
      return { recordId: existingRecordId, created: false };
    }

    const recordId = await this.createRecord(tableId, fields);
    return { recordId, created: true };
  }

  private async getAccessToken(): Promise<string> {
    if (this.token) return this.token;
    const response = await fetchWithRetry('https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ app_id: this.config.appId, app_secret: this.config.appSecret }),
    });
    const data = await response.json() as FeishuApiResponse<{ tenant_access_token?: string }> & { tenant_access_token?: string };
    const token = data.tenant_access_token ?? data.data?.tenant_access_token;
    if (data.code !== 0 || !token) {
      throw new Error(`获取飞书访问令牌失败: ${data.msg || '未知错误'}`);
    }
    this.token = token;
    return token;
  }

  private async request<T>(url: string, init: RequestInit = {}): Promise<T> {
    const token = await this.getAccessToken();
    const response = await fetchWithRetry(url, {
      ...init,
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        ...(init.headers ?? {}),
      },
    });
    const text = await response.text();
    const data = JSON.parse(text.replace(/^\uFEFF/, '')) as FeishuApiResponse<T>;
    if (!response.ok || data.code !== 0) {
      throw new Error(`飞书多维表 API 失败: HTTP ${response.status}, code=${data.code}, msg=${data.msg || text.slice(0, 200)}`);
    }
    return data.data as T;
  }

  private tableUrl(tableId: string, suffix: string): string {
    return `https://open.feishu.cn/open-apis/bitable/v1/apps/${this.config.appToken}/tables/${tableId}${suffix}`;
  }

  private appUrl(suffix: string): string {
    return `https://open.feishu.cn/open-apis/bitable/v1/apps/${this.config.appToken}${suffix}`;
  }

  async listFields(tableId: string): Promise<Array<{ field_id: string; field_name: string; type: number }>> {
    const data = await this.request<{ items?: Array<{ field_id: string; field_name: string; type: number }> }>(
      this.tableUrl(tableId, '/fields?page_size=500'),
    );
    return data.items ?? [];
  }

  async createField(
    tableId: string,
    spec: { name: string; type: number; property?: Record<string, unknown> },
  ): Promise<void> {
    await this.request<unknown>(this.tableUrl(tableId, '/fields'), {
      method: 'POST',
      body: JSON.stringify({
        field_name: spec.name,
        type: spec.type,
        property: spec.property ?? {},
      }),
    });
  }

  async listDashboards(): Promise<Array<{ block_id: string; name: string }>> {
    const data = await this.request<{ dashboards?: Array<{ block_id: string; name: string }> }>(
      this.appUrl('/dashboards?page_size=50'),
    );
    return data.dashboards ?? [];
  }

  async listAllRecordIds(tableId: string): Promise<string[]> {
    const ids: string[] = [];
    let pageToken = '';
    for (;;) {
      const query = new URLSearchParams({ page_size: '500' });
      if (pageToken) query.set('page_token', pageToken);
      const data = await this.request<SearchRecordsData & { has_more?: boolean; page_token?: string }>(
        `${this.tableUrl(tableId, '/records')}?${query.toString()}`,
      );
      for (const item of data.items ?? []) {
        if (item.record_id) ids.push(item.record_id);
      }
      if (!data.has_more || !data.page_token) break;
      pageToken = data.page_token;
    }
    return ids;
  }

  async deleteRecords(tableId: string, recordIds: string[]): Promise<number> {
    let deleted = 0;
    for (let i = 0; i < recordIds.length; i += 500) {
      const batch = recordIds.slice(i, i + 500);
      await this.request<unknown>(this.tableUrl(tableId, '/records/batch_delete'), {
        method: 'POST',
        body: JSON.stringify({ records: batch }),
      });
      deleted += batch.length;
    }
    return deleted;
  }

  async clearTable(tableId: string): Promise<number> {
    const ids = await this.listAllRecordIds(tableId);
    if (!ids.length) return 0;
    return this.deleteRecords(tableId, ids);
  }

  private async findRecordId(tableId: string, uniqueField: string, uniqueValue: string): Promise<string | null> {
    const data = await this.request<SearchRecordsData>(this.tableUrl(tableId, '/records/search?page_size=1'), {
      method: 'POST',
      body: JSON.stringify({
        filter: {
          conjunction: 'and',
          conditions: [
            {
              field_name: uniqueField,
              operator: 'is',
              value: [uniqueValue],
            },
          ],
        },
      }),
    });
    return data.items?.[0]?.record_id ?? null;
  }

  private async createRecord(tableId: string, fields: BitableRecordFields): Promise<string> {
    const data = await this.request<CreateRecordData>(this.tableUrl(tableId, '/records'), {
      method: 'POST',
      body: JSON.stringify({ fields: cleanFields(fields) }),
    });
    const recordId = data.record?.record_id;
    if (!recordId) throw new Error('飞书多维表创建记录成功但未返回 record_id');
    return recordId;
  }

  private async updateRecord(tableId: string, recordId: string, fields: BitableRecordFields): Promise<void> {
    await this.request<unknown>(this.tableUrl(tableId, `/records/${recordId}`), {
      method: 'PUT',
      body: JSON.stringify({ fields: cleanFields(fields) }),
    });
  }
}

function cleanFields(fields: BitableRecordFields): Record<string, BitableFieldValue> {
  const cleaned: Record<string, BitableFieldValue> = {};
  for (const [key, value] of Object.entries(fields)) {
    if (value === null || value === undefined) continue;
    cleaned[key] = value;
  }
  return cleaned;
}
