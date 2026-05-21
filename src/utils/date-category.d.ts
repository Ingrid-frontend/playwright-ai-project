export function parseDateCategoryToDate(code: string): Date;
export function validateShortDateCategoryCode(input: string): string;
export function toShortDateCategoryCode(input: string): string;
export function isDateCategoryDirSegment(seg: string): boolean;
export function compareDateCategoryCodes(a: string, b: string): number;
export function normalizeDateCategoryList(list: string[]): string[];
export function formatDateCategoryCalendarLabel(code: string): string;
export function getDateCategoryForCalendarDay(dateKey: string, configPath?: string): string;
