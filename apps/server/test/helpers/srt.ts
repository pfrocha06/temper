// Whether the real sandbox (srt) can run here. It needs sandbox-exec (macOS, built in),
// bubblewrap + socat + ripgrep (Linux) or `srt windows-install` (Windows); TEMPER_TEST_SRT=1 says
// they are installed.
export const srtAvailable = process.platform === "darwin" || process.env.TEMPER_TEST_SRT === "1";

// CI installs the sandbox on every platform. There a sandbox test that would skip means the
// install broke, not that isolation holds: fail instead (SEC-04).
if (process.env.CI && !srtAvailable) {
  throw new Error("CI must run the sandbox tests: install srt's dependencies and set TEMPER_TEST_SRT=1 (see .github/workflows/ci.yml)");
}
