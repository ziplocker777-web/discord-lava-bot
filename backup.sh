#!/bin/sh
# Daily copy of everything this bot cannot rebuild.
#
# The stores are the only record of who bought what and which licence key is
# whose. lava.top can rebuild purchases if pushed, but nothing outside this
# machine knows the keys, the reviews, or which emails were refunded -- and the
# stores are gitignored, correctly, because they hold customers' email
# addresses. So git is not a backup either.
#
# Fourteen days kept. Small files; the whole history is under a megabyte.

set -eu

HERE="/root/discord-lava-bot"
DEST="/root/backups/discord-lava-bot"
STAMP="$(date +%Y-%m-%d)"

mkdir -p "$DEST"

# .env too: it holds the API keys and channel ids, and losing it means
# reassembling the whole configuration by hand.
tar -czf "$DEST/$STAMP.tar.gz" -C "$HERE" \
    purchaseStore.json \
    watermarkStore.json \
    vouchStore.json \
    panelStore.json \
    winbackStore.json \
    refundedEmails.json \
    refundedInvoices.json \
    revokeExempt.json \
    presetsStore.json \
    supportLog.json \
    .env

# Anything older than a fortnight goes. Keeping more would not help: a mistake
# nobody noticed in two weeks is one nobody is going to unpick from a tarball.
find "$DEST" -name '*.tar.gz' -mtime +14 -delete

echo "$(date '+%Y-%m-%d %H:%M') backed up to $DEST/$STAMP.tar.gz ($(du -h "$DEST/$STAMP.tar.gz" | cut -f1))"
