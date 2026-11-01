// A holdout file collects named checks; each one passes unless it throws.
//
//   import { suite } from "../lib/check.mjs";
//   export default suite(async (check, { url }) => {
//     await check("home", async () => { ... throw new Error("why it failed") ... });
//   });
export function suite(body) {
  return async (ctx) => {
    const results = [];
    const check = async (id, fn) => {
      try {
        const message = await fn();
        results.push({ id, pass: true, message: typeof message === "string" ? message : "" });
      } catch (err) {
        results.push({ id, pass: false, message: String(err?.message ?? err).split("\n")[0].slice(0, 200) });
      }
    };
    await body(check, ctx);
    return results;
  };
}

/** Throws `message` unless `condition` holds. */
export function assert(condition, message) {
  if (!condition) throw new Error(message);
}
