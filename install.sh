#!/bin/sh
# Tycho 설치 · 업데이트:  curl -fsSL https://agent-orbit-app.vercel.app/install.sh | sh
# 설치 위치 ~/.agent-orbit, 로그인할 때 자동 실행. 지우기: tycho uninstall
set -eu

BASE="${AGENT_ORBIT_BASE:-https://agent-orbit-app.vercel.app}"
DIR="${AGENT_ORBIT_HOME:-$HOME/.agent-orbit}"
FILES="agent_orbit.py index.html app.js"

fail() { printf 'tycho: %s\n' "$*" >&2; exit 1; }

case "$(uname -s)" in
  Darwin | Linux) ;;
  *) fail "macOS 와 Linux 만 지원합니다." ;;
esac
command -v curl >/dev/null 2>&1 || fail "curl 이 필요합니다."

PY="$(command -v python3 || true)"
if [ -z "$PY" ] || ! "$PY" -c 'import sys; sys.exit(sys.version_info < (3, 9))' >/dev/null 2>&1; then
  if [ "$(uname -s)" = Darwin ]; then
    fail "Python 3.9 이상이 필요합니다. 터미널에서 xcode-select --install 을 실행해 개발자 도구를 설치한 뒤 다시 실행하세요."
  fi
  fail "Python 3.9 이상이 필요합니다. 패키지 관리자로 python3 를 설치한 뒤 다시 실행하세요."
fi

mkdir -p "$DIR/bin"
for f in $FILES; do
  curl -fsSL "$BASE/$f" -o "$DIR/$f.download" || fail "$BASE/$f 를 내려받지 못했습니다."
done
for f in $FILES; do mv "$DIR/$f.download" "$DIR/$f"; done

cat > "$DIR/bin/tycho" <<EOF
#!/bin/sh
exec "$PY" "$DIR/agent_orbit.py" "\$@"
EOF
chmod +x "$DIR/bin/tycho"
ln -sf "$DIR/bin/tycho" "$DIR/bin/agent-orbit"  # 예전 이름도 그대로 동작
# 터미널에서 tycho 만 쳐도 되게: PATH 에 있고 쓸 수 있는 첫 폴더에 바로가기 (sudo 없이)
for d in "$HOME/.local/bin" "$HOME/bin" /opt/homebrew/bin /usr/local/bin; do
  case ":$PATH:" in
    *":$d:"*) if [ -d "$d" ] && [ -w "$d" ]; then ln -sf "$DIR/bin/tycho" "$d/tycho"; ln -sf "$DIR/bin/tycho" "$d/agent-orbit"; break; fi ;;
  esac
done

exec "$PY" "$DIR/agent_orbit.py" setup
