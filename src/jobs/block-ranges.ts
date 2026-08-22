export function* blockRanges(from: bigint, latest: bigint, rangeSizeValue: number) {
  if (!Number.isSafeInteger(rangeSizeValue) || rangeSizeValue <= 0) throw new Error("LOG_SCAN_BLOCK_RANGE must be a positive safe integer");
  const rangeSize = BigInt(rangeSizeValue);
  for (let start = from; start <= latest; start += rangeSize) {
    const candidateEnd = start + rangeSize - 1n;
    yield { start, end: candidateEnd > latest ? latest : candidateEnd };
  }
}
