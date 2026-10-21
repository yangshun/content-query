import { describe, expect, test, vi } from "vite-plus/test";
import { decode, encode } from "../shared/values.ts";
import { createPayloadLoaders } from "./payloads.ts";

describe("lazy payload loaders", () => {
  test("loads a chunk once on demand", async () => {
    const payloads = Object.fromEntries([
      ["first", encode({ body: "Unicode 🦋 <tag> & \u0000\n" })],
      ["__proto__", encode({ body: "Prototype-like identity" })],
    ]);
    const load = vi.fn(async () => ({
      default: payloads,
    }));
    const loaders = createPayloadLoaders([{ ids: Object.keys(payloads), load }]);
    expect(load).not.toHaveBeenCalled();
    const [first, special, repeated] = await Promise.all([
      loaders.first!(),
      loaders.__proto__!(),
      loaders.first!(),
    ]);
    expect(decode(first.default)).toEqual({ body: "Unicode 🦋 <tag> & \u0000\n" });
    expect(decode(special.default)).toEqual({ body: "Prototype-like identity" });
    expect(repeated).toEqual(first);
    expect(load).toHaveBeenCalledOnce();
  });

  test("retries a rejected chunk import without retaining a failed promise", async () => {
    const load = vi
      .fn<() => Promise<{ default: Record<string, string> }>>()
      .mockRejectedValueOnce(new Error("Unavailable chunk"))
      .mockResolvedValue({ default: { first: encode({ body: "Recovered" }) } });
    const loaders = createPayloadLoaders([{ ids: ["first"], load }]);
    await expect(loaders.first!()).rejects.toThrow("Unavailable chunk");
    expect(decode((await loaders.first!()).default)).toEqual({ body: "Recovered" });
    expect(load).toHaveBeenCalledTimes(2);
  });
});
