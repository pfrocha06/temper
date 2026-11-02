# Temper installer for Windows (PowerShell 5.1 or later).
#
#   irm https://raw.githubusercontent.com/pfrocha06/temper/main/install.ps1 | iex
#
# Re-running it updates an existing install. Settings (all optional, as environment variables):
#   TEMPER_DIR      where the checkout lives       (default: ~\.temper\src)
#   TEMPER_BIN_DIR  where the `temper` command goes (default: ~\.temper\bin, added to your PATH)
#   TEMPER_REPO     git URL or path to install from (default: GitHub)
#   TEMPER_REF      branch, tag or commit           (default: main)
#   TEMPER_NO_DEPS  set to 1 to skip installing the Windows sandbox (asks for admin once)
#
# Kept ASCII-only: `irm | iex` on Windows PowerShell 5.1 can mis-decode anything else.

function Install-Temper {
  $ErrorActionPreference = "Stop"
  $script:Warnings = 0

  function Step($text) { Write-Host ""; Write-Host "==> " -ForegroundColor DarkYellow -NoNewline; Write-Host $text -ForegroundColor White }
  function Ok($text) { Write-Host "  ok   " -ForegroundColor Green -NoNewline; Write-Host $text }
  function Warn($text) { Write-Host "  warn " -ForegroundColor Yellow -NoNewline; Write-Host $text; $script:Warnings++ }
  function Fail($text) { throw "temper install: $text" }
  function Has($name) { [bool](Get-Command $name -ErrorAction SilentlyContinue) }
  function Env($name, $default) { $v = [Environment]::GetEnvironmentVariable($name); if ($v) { $v } else { $default } }
  # Native commands report failure through the exit code, not exceptions.
  function Native { & $args[0] $args[1..($args.Length - 1)]; if ($LASTEXITCODE -ne 0) { Fail "'$($args -join ' ')' failed (exit $LASTEXITCODE)" } }
  # Same, but silent and returning success; PowerShell 5.1 throws on redirected stderr under "Stop".
  function Succeeds { $ErrorActionPreference = "Continue"; & $args[0] $args[1..($args.Length - 1)] *> $null; $LASTEXITCODE -eq 0 }
  # Prefer npm-style .cmd shims: the .ps1 ones next to them fail under a Restricted execution policy.
  function Cmd($name) { $c = Get-Command "$name.cmd" -ErrorAction SilentlyContinue; if ($c) { $c.Source } else { $name } }

  $repo = Env "TEMPER_REPO" "https://github.com/pfrocha06/temper.git"
  $ref = Env "TEMPER_REF" "main"
  $homeDir = Env "TEMPER_HOME" (Join-Path $HOME ".temper")
  $dir = Env "TEMPER_DIR" (Join-Path $homeDir "src")
  $binDir = Env "TEMPER_BIN_DIR" (Join-Path $homeDir "bin")

  Write-Host ""
  Write-Host "  /\ temper" -ForegroundColor DarkYellow -NoNewline
  Write-Host "  the local software factory" -ForegroundColor DarkGray

  # -------------------------------------------------------------------------------------------
  Step "Checking prerequisites"

  if (-not (Has git)) { Fail "git is required: https://git-scm.com/download/win" }
  Ok ((git --version) -replace "git version ", "git ")

  if (-not (Has node)) { Fail "Node.js 22.18 or later is required: https://nodejs.org" }
  # Temper runs its TypeScript directly, which needs Node's built-in type stripping.
  if ((node -p "Boolean(process.features.typescript)") -ne "true") { Fail "Node.js $(node --version) is too old: Temper needs 22.18 or later (https://nodejs.org)" }
  Ok "node $(node --version)"

  if (Has claude) { Ok "claude CLI found" } else { Warn "Claude Code CLI not found: install it from https://docs.claude.com/en/docs/claude-code and sign in" }
  if (Has gh) { Ok "GitHub CLI found" } else { Warn "GitHub CLI not found: install it from https://cli.github.com and run 'gh auth login'" }
  if (Has gitleaks) { Ok "gitleaks found" } else { Warn "gitleaks not found: Temper pushes no changes without it. Install it with: winget install gitleaks" }

  # -------------------------------------------------------------------------------------------
  Step "Getting Temper"

  if (Test-Path (Join-Path $dir ".git")) {
    Native git -C $dir fetch -q origin
    $isBranch = Succeeds git -C $dir rev-parse -q --verify "refs/remotes/origin/$ref"
    Native git -C $dir checkout -q $ref
    if ($isBranch) {
      if (-not (Succeeds git -C $dir merge -q --ff-only "origin/$ref")) { Fail "$dir has local changes on $ref; commit or reset them, then re-run" }
    }
    Ok "updated $dir"
  } elseif (Test-Path $dir) {
    Fail "$dir exists and is not a git checkout; move it away or set TEMPER_DIR"
  } else {
    New-Item -ItemType Directory -Force (Split-Path $dir) | Out-Null
    Native git clone -q $repo $dir
    Native git -C $dir checkout -q $ref
    Ok "cloned into $dir"
  }
  Ok "at $(git -C $dir rev-parse --short HEAD) ($ref)"

  # -------------------------------------------------------------------------------------------
  Step "Installing dependencies"

  $pnpmVersion = node -p "require(process.argv[1]).packageManager.split('@')[1]" (Join-Path $dir "package.json")
  if (-not (Has pnpm)) {
    # `temper deploy` calls pnpm itself, so it has to end up on PATH, not just be runnable here.
    if (Has corepack) { Succeeds (Cmd corepack) enable pnpm | Out-Null }
    if (Has pnpm) { Ok "enabled pnpm through corepack" }
    else {
      Succeeds (Cmd npm) install -g --silent "pnpm@$pnpmVersion" | Out-Null
      if (-not (Has pnpm)) { Fail "could not install pnpm; run 'npm install -g pnpm@$pnpmVersion', then re-run" }
      Ok "installed pnpm $pnpmVersion with npm"
    }
  }
  $pnpm = Cmd pnpm
  Push-Location $dir
  try {
    Native $pnpm install --frozen-lockfile --silent
    Ok "packages installed"
    Native $pnpm --silent --filter "@temper/web" build | Out-Null
    Ok "console built"

    # -----------------------------------------------------------------------------------------
    Step "Setting up the gate sandbox"

    if (Succeeds net user srt-sandbox) {
      Ok "sandbox account srt-sandbox already set up"
    } elseif ((Env "TEMPER_NO_DEPS" "") -eq "1") {
      Warn "sandbox not set up; run 'pnpm --filter @temper/server exec srt windows-install' in $dir"
    } else {
      Write-Host "  The gate sandbox runs Builder code as a separate local account, srt-sandbox, behind" -ForegroundColor DarkGray
      Write-Host "  firewall rules. Creating it needs admin rights once: approve the prompt that opens." -ForegroundColor DarkGray
      $ErrorActionPreference = "Continue"
      & $pnpm --silent --filter "@temper/server" exec srt windows-install
      $installed = $LASTEXITCODE -eq 0
      $ErrorActionPreference = "Stop"
      if ($installed) { Ok "sandbox account and firewall rules installed" }
      else { Warn "sandbox not set up; run 'pnpm --filter @temper/server exec srt windows-install' in $dir" }
    }
  } finally { Pop-Location }

  # -------------------------------------------------------------------------------------------
  Step "Installing the temper command"

  New-Item -ItemType Directory -Force $binDir | Out-Null
  $cli = Join-Path $dir "apps\server\src\cli.ts"
  Set-Content -Encoding ascii (Join-Path $binDir "temper.cmd") "@rem Installed by Temper's install.ps1; re-run the installer to update.`r`n@node `"$cli`" %*"
  & (Join-Path $binDir "temper.cmd") help | Out-Null
  if ($LASTEXITCODE -ne 0) { Fail "the temper command does not run; see the output above" }
  Ok (Join-Path $binDir "temper.cmd")

  $userPath = [Environment]::GetEnvironmentVariable("Path", "User")
  if (-not (($userPath -split ";") -contains $binDir)) {
    [Environment]::SetEnvironmentVariable("Path", (($userPath, $binDir) | Where-Object { $_ }) -join ";", "User")
    Ok "added $binDir to your PATH (new terminals pick it up)"
  }
  if (-not (($env:Path -split ";") -contains $binDir)) { $env:Path = "$env:Path;$binDir" }

  # -------------------------------------------------------------------------------------------
  Write-Host ""
  if ($script:Warnings -eq 0) { Write-Host "Temper is installed." -ForegroundColor Green }
  else { Write-Host "Temper is installed, with $($script:Warnings) warning(s) above to fix first." -ForegroundColor Green }
  Write-Host @"

  Next:
    temper serve            start the server (run it as a scheduled task to keep it up)
    temper open             open the console, signed in as the board
    temper probe-isolation --holdouts <dir>
                            prove agents cannot read your holdouts or secrets
    temper help             every command

  Docs: https://github.com/pfrocha06/temper#running-temper

"@
}

Install-Temper
