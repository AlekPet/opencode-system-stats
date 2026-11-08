# Example themes

Ready-made sample themes. Copy one into your theme directory and point
`SYSTEM_STATS_THEME_DIR` at it to use it:

```bash
mkdir -p "$HOME/.config/system-stats-themes"
cp "$HOME/.opencode-system-stats/examples/themes/c64.yaml" \
   "$HOME/.config/system-stats-themes/"
export SYSTEM_STATS_THEME_DIR="$HOME/.config/system-stats-themes"
# then restart OpenCode (service + TUI)
```

Each `.yaml` file is exactly one theme. The format is documented in the plugin
README under [Custom themes (YAML)](../.opencode/plugins/opencode-system-stats/README.md#custom-themes-yaml).

| File        | Look                                             |
| ----------- | ------------------------------------------------ |
| `sunset.yaml` | Warm amber "Sunset CRT" phosphor screen        |
| `c64.yaml`    | Commodore 64 — deep-blue background, violet text |
