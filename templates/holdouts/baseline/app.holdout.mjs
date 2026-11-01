// Baseline: checks every version of the app must pass. Replace this one with your own.
import { assert, suite } from "../lib/check.mjs";
import { get } from "../lib/http.mjs";

export default suite(async (check, { url }) => {
  await check("responds", async () => {
    const { status } = await get(url, "/");
    assert(status < 500, `GET / answered ${status}`);
  });
});
