export type MaybePromise<Value> = Value | Promise<Value>;

/**
 * The type of a member that a query or configuration does not allow. It has no call signatures,
 * so calling the member fails with the reason near the start of the error:
 * `This expression is not callable. Type 'Unavailable<"…">' has no call signatures.`
 */
export type Unavailable<Reason extends string> = { readonly [Key in Reason]: never };
