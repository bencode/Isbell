#!/bin/sh
# Stand-in for the herdr CLI in tests: `terminal session <mode> <target> --cols C --rows R`.
# Appends its arguments and every command it reads to $FAKE_HERDR_LOG.
log="${FAKE_HERDR_LOG:?}"
echo "args $*" >> "$log"

frame() {
    printf '{"type":"terminal.frame","seq":1,"encoding":"ansi","width":80,"height":24,"full":%s,"bytes":"%s"}\n' \
        "$1" "$(printf '%s' "$2" | base64)"
}

frame true hello
if [ "$3" = observe ]; then
    exec sleep 60
fi
while IFS= read -r line; do
    echo "$line" >> "$log"
    case "$line" in
        *terminal.release*) printf '{"type":"terminal.closed","reason":"released"}\n'; exit 0 ;;
        *terminal.input*) frame false ok ;;
    esac
done
