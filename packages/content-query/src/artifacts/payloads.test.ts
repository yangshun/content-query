import { gzipSync } from "node:zlib";
import { describe, expect, test, vi } from "vite-plus/test";
import { decode, encode } from "../shared/values.ts";
import { createPayloadLoaders } from "./payloads.ts";

describe("lazy payload loaders", () => {
  test.each([false, true])("loads a chunk once on demand, compressed=%s", async (compressed) => {
    const payloads = Object.fromEntries([
      ["first", encode({ body: "Unicode 🦋 <tag> & \u0000\n" })],
      ["__proto__", encode({ body: "Prototype-like identity" })],
    ]);
    const load = vi.fn(async () => ({
      default: compressed ? gzipSync(JSON.stringify(payloads)).toString("base64") : payloads,
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

  test("retries malformed compressed content and keeps separate chunks independent", async () => {
    const load = vi
      .fn<() => Promise<{ default: string }>>()
      .mockResolvedValueOnce({ default: "not base64!" })
      .mockResolvedValueOnce({ default: Buffer.from("not gzip").toString("base64") })
      .mockResolvedValue({
        default: gzipSync(JSON.stringify({ first: encode({ body: "Recovered" }) })).toString(
          "base64",
        ),
      });
    const untouched = vi.fn(async () => ({ default: { second: encode({ body: "Other" }) } }));
    const loaders = createPayloadLoaders([
      { ids: ["first"], load },
      { ids: ["second"], load: untouched },
    ]);
    await expect(loaders.first!()).rejects.toThrow();
    await expect(loaders.first!()).rejects.toThrow();
    expect(decode((await loaders.first!()).default)).toEqual({ body: "Recovered" });
    expect(load).toHaveBeenCalledTimes(3);
    expect(untouched).not.toHaveBeenCalled();
    expect(decode((await loaders.second!()).default)).toEqual({ body: "Other" });
    expect(untouched).toHaveBeenCalledOnce();
  });
});
