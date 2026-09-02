/** Build room-scoped authorization headers while preserving legacy jam-bot use. */
export function helperAuthHeaders(roomToken, legacySecret) {
  if (roomToken) return { Authorization: `Bearer ${roomToken}` };
  if (legacySecret) return { "X-Turntable-Secret": legacySecret };
  return {};
}