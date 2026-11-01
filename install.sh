#!/bin/sh
# Temper installer for macOS and Linux.
#
#   curl -fsSL https://raw.githubusercontent.com/pfrocha06/temper/main/install.sh | sh
#
# Re-running it updates an existing install. Settings (all optional):
#   TEMPER_DIR      where the checkout lives       (default: ~/.temper/src)
#   TEMPER_BIN_DIR  where the `temper` command goes (default: ~/.local/bin)
#   TEMPER_REPO     git URL or path to install from (default: GitHub)
#   TEMPER_REF      branch, tag or commit           (default: main)
#   TEMPER_NO_DEPS  set to 1 to skip installing the Linux sandbox packages
set -eu

REPO="${TEMPER_REPO:-https://github.com/pfrocha06/temper.git}"
REF="${TEMPER_REF:-main}"
HOME_DIR="${TEMPER_HOME:-$HOME/.temper}"
DIR="${TEMPER_DIR:-$HOME_DIR/src}"
BIN_DIR="${TEMPER_BIN_DIR:-$HOME/.local/bin}"
OS="$(uname -s)"

if [ -t 1 ]; then
  B="$(printf '\033[1m')"; DIM="$(printf '\033[2m')"; R="$(printf '\033[0m')"
  GREEN="$(printf '\033[32m')"; YELLOW="$(printf '\033[33m')"; RED="$(printf '\033[31m')"; ORANGE="$(printf '\033[38;5;208m')"
else
  B=""; DIM=""; R=""; GREEN=""; YELLOW=""; RED=""; ORANGE=""
fi

step() { printf '\n%s==>%s %s%s%s\n' "$ORANGE" "$R" "$B" "$1" "$R"; }
ok() { printf '  %s✓%s %s\n' "$GREEN" "$R" "$1"; }
warn() { printf '  %s!%s %s\n' "$YELLOW" "$R" "$1"; WARNINGS=$((WARNINGS + 1)); }
die() { printf '\n  %s✗ %s%s\n\n' "$RED" "$1" "$R" >&2; exit 1; }
has() { command -v "$1" >/dev/null 2>&1; }
WARNINGS=0

# Runs as root directly, otherwise through sudo (which prompts on the terminal even when piped).
as_root() {
  if [ "$(id -u)" = 0 ]; then "$@"; elif has sudo; then sudo "$@"; else return 1; fi
}

printf '\n%s  ▲ temper%s  %sthe local software factory%s\n' "$ORANGE$B" "$R" "$DIM" "$R"

case "$OS" in
  Darwin | Linux) ;;
  *) die "unsupported system: $OS (on Windows, use install.ps1)" ;;
esac

# ---------------------------------------------------------------------------------------------
step "Checking prerequisites"

has git || die "git is required: https://git-scm.com/downloads"
ok "git $(git --version | awk '{print $3}')"

has node || die "Node.js 22.18 or later is required: https://nodejs.org"
# Temper runs its TypeScript directly, which needs Node's built-in type stripping.
if [ "$(node -p 'Boolean(process.features.typescript)' 2>/dev/null)" != "true" ]; then
  die "Node.js $(node --version) is too old: Temper needs 22.18 or later (https://nodejs.org)"
fi
ok "node $(node --version)"

if has claude; then ok "claude CLI found"; else warn "Claude Code CLI not found: install it from https://docs.claude.com/en/docs/claude-code and sign in"; fi
if has gh; then ok "GitHub CLI found"; else warn "GitHub CLI not found: install it from https://cli.github.com and run 'gh auth login'"; fi

# ---------------------------------------------------------------------------------------------
step "Getting Temper"

if [ -d "$DIR/.git" ]; then
  git -C "$DIR" fetch -q origin
  if git -C "$DIR" rev-parse -q --verify "refs/remotes/origin/$REF" >/dev/null; then
    git -C "$DIR" checkout -q "$REF"
    git -C "$DIR" merge -q --ff-only "origin/$REF" || die "$DIR has local changes on $REF; commit or reset them, then re-run"
  else
    git -C "$DIR" checkout -q "$REF"
  fi
  ok "updated $DIR"
elif [ -e "$DIR" ]; then
  die "$DIR exists and is not a git checkout; move it away or set TEMPER_DIR"
else
  mkdir -p "$(dirname "$DIR")"
  git clone -q "$REPO" "$DIR"
  git -C "$DIR" checkout -q "$REF"
  ok "cloned into $DIR"
fi
ok "at $(git -C "$DIR" rev-parse --short HEAD) ($REF)"

# ---------------------------------------------------------------------------------------------
step "Installing dependencies"

PNPM_VERSION="$(node -p "require('$DIR/package.json').packageManager.split('@')[1]")"
if ! has pnpm; then
  # `temper deploy` calls pnpm itself, so it has to end up on PATH, not just be runnable here.
  if has corepack && corepack enable pnpm 2>/dev/null && has pnpm; then
    ok "enabled pnpm through corepack"
  elif npm install -g --silent "pnpm@$PNPM_VERSION" >/dev/null 2>&1 && has pnpm; then
    ok "installed pnpm $PNPM_VERSION with npm"
  else
    die "could not install pnpm; run 'npm install -g pnpm@$PNPM_VERSION' (with sudo if needed), then re-run"
  fi
fi
(cd "$DIR" && pnpm install --frozen-lockfile --silent) || die "pnpm install failed"
ok "packages installed"
(cd "$DIR" && pnpm --silent --filter @temper/web build >/dev/null) || die "building the console failed"
ok "console built"

# ---------------------------------------------------------------------------------------------
step "Setting up the gate sandbox"

if [ "$OS" = Darwin ]; then
  ok "macOS sandbox is built in"
else
  missing=""
  has bwrap || missing="$missing bubblewrap"
  has socat || missing="$missing socat"
  has rg || missing="$missing ripgrep"
  if [ -n "$missing" ]; then
    # Same package names on every major distribution.
    if has apt-get; then install="apt-get install -y"
    elif has dnf; then install="dnf install -y"
    elif has pacman; then install="pacman -S --noconfirm --needed"
    elif has zypper; then install="zypper install -y"
    elif has apk; then install="apk add"
    else install=""; fi
    if [ "${TEMPER_NO_DEPS:-}" = 1 ] || [ -z "$install" ]; then
      warn "missing:$missing; install them with your package manager"
    else
      printf '  %sinstalling%s %s\n' "$DIM" "$missing" "$R"
      if [ "$install" = "apt-get install -y" ]; then as_root apt-get update -qq >/dev/null || true; fi
      # shellcheck disable=SC2086 # word splitting is intended for both lists
      if as_root $install $missing >/dev/null; then ok "installed$missing"; else warn "could not install$missing; run: sudo $install$missing"; fi
    fi
  else
    ok "bubblewrap, socat and ripgrep found"
  fi
  if has bwrap && ! bwrap --ro-bind / / --unshare-user --unshare-net true >/dev/null 2>&1; then
    if [ "$(cat /proc/sys/kernel/apparmor_restrict_unprivileged_userns 2>/dev/null)" = 1 ]; then
      warn "this kernel blocks the user namespaces bubblewrap needs (Ubuntu 24.04+). Allow them with:"
      printf '      sudo sysctl -w kernel.apparmor_restrict_unprivileged_userns=0\n'
      printf "      echo kernel.apparmor_restrict_unprivileged_userns=0 | sudo tee /etc/sysctl.d/60-temper-userns.conf\n"
    else
      warn "bubblewrap cannot create a sandbox here; see https://github.com/containers/bubblewrap"
    fi
  elif has bwrap; then
    ok "bubblewrap can create sandboxes"
  fi
fi

# ---------------------------------------------------------------------------------------------
step "Installing the temper command"

mkdir -p "$BIN_DIR"
cat >"$BIN_DIR/temper" <<EOF
#!/bin/sh
# Installed by Temper's install.sh; re-run the installer to update.
exec node "$DIR/apps/server/src/cli.ts" "\$@"
EOF
chmod +x "$BIN_DIR/temper"
"$BIN_DIR/temper" help >/dev/null || die "the temper command does not run; see the output above"
ok "$BIN_DIR/temper"

case ":$PATH:" in
  *":$BIN_DIR:"*) ;;
  *)
    case "${SHELL:-}" in */zsh) rc="~/.zshrc" ;; */bash) rc="~/.bashrc" ;; *) rc="your shell profile" ;; esac
    warn "$BIN_DIR is not on your PATH. Add this line to $rc:"
    printf '      export PATH="%s:$PATH"\n' "$BIN_DIR"
    ;;
esac

# ---------------------------------------------------------------------------------------------
if [ "$WARNINGS" = 0 ]; then
  printf '\n%s✓ Temper is installed.%s\n' "$GREEN$B" "$R"
else
  printf '\n%s✓ Temper is installed%s, with %s warning(s) above to fix first.\n' "$GREEN$B" "$R" "$WARNINGS"
fi
if [ "$OS" = Darwin ]; then
  start="temper deploy           build, verify and start the background service"
else
  start="temper serve            start the server (run it under systemd to keep it up)"
fi
cat <<EOF

  Next:
    $start
    temper open             open the console, signed in as the board
    temper probe-isolation --holdouts <dir>
                            prove agents cannot read your holdouts or secrets
    temper help             every command

  Docs: ${B}https://github.com/pfrocha06/temper#running-temper${R}

EOF
