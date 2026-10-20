#!/bin/zsh
# Script per pubblicare qualsiasi modifica direttamente sul sito online (GitHub -> Render)
cd "$(dirname "$0")"
git add .
git commit -m "Aggiornamento sito $(date '+%Y-%m-%d %H:%M')" || echo "Nessuna nuova modifica da salvare"
git push -f -u origin main
echo "✅ Modifiche inviate a GitHub! Render aggiornerà il sito online tra ~60 secondi."
