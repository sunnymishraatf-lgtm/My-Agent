#!/usr/bin/env sh
set -eu

PKG="${NEUTRON_PACKAGE:-neutron-agent}"
MIN_NODE=20

say() { printf '%s\n' "$*"; }
die() { printf 'error: %s\n' "$*" >&2; exit 1; }

command -v node >/dev/null 2>&1 || die "Node.js ${MIN_NODE}+ is required (https://nodejs.org)"
command -v npm >/dev/null 2>&1 || die "npm is required (it ships with Node.js)"

NODE_MAJOR="$(node -p "process.versions.node.split('.')[0]")"
[ "$NODE_MAJOR" -ge "$MIN_NODE" ] 2>/dev/null || die "Node.js ${MIN_NODE}+ required (found $(node -v))"

if npm install -g "$PKG"; then
  :
elif [ -f "package.json" ] && [ -d "src" ]; then
  say "Global install failed; building from the current source tree instead..."
  npm install
  npm run build
  npm link
else
  die "Could not install ${PKG} from npm. If it is not published yet, clone the repo and run this script from its root."
fi

say ""
say "Installed. Try:"
say "  neutron --version"
say "  neutron config"
say "  neutron chat"
