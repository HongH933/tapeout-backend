export type ErrorCode =
  | "CONFIG_MISMATCH" | "WRITE_API_DISABLED" | "PRICE_NOT_PARTIAL_FILL_SAFE"
  | "INVALID_QUANTITY" | "UINT256_OVERFLOW" | "INVALID_STRUCTURE" | "INVALID_ASSET"
  | "INVALID_SIGNATURE" | "SMART_ACCOUNT_NOT_SUPPORTED" | "INVALID_COUNTER"
  | "INVALID_BALANCE" | "INVALID_APPROVAL" | "ORDER_CANCELLED" | "ORDER_FILLED"
  | "ORDER_EXPIRED" | "VALIDATOR_REJECTED" | "NOT_FOUND" | "RATE_LIMITED";

export class DomainError extends Error {
  constructor(public readonly code: ErrorCode, message: string, public readonly statusCode = 400, public readonly details?: unknown) {
    super(message);
    this.name = "DomainError";
  }
}
