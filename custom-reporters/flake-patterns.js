/** flake 错误特征（error-reporter / flow-shared 共用） */
export const FLAKE_PATTERNS = [
  /timeout/i,
  /timed out/i,
  /detached/i,
  /Target closed/i,
  /Execution context was destroyed/i,
  /net::ERR_/i,
  /Navigation failed/i,
];

export function isFlakeError(text) {
  if (!text) return false;
  return FLAKE_PATTERNS.some((re) => re.test(text));
}
