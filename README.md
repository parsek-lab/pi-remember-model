# pi-remember-model

Pi extension that remembers the last selected model and thinking level for new sessions.

## License

Licensed under the GNU General Public License v3.0 only (`GPL-3.0-only`). See [LICENSE](LICENSE) for the full terms.

## Compatibility

Targets `@earendil-works/pi-coding-agent` **1.5.2** and Node.js **22.18 or newer**. Other Pi versions are not declared compatible until verified.

## Behavior and embedded hosts

- In interactive TUI sessions, restore the saved model and thinking level on a fresh startup or `/new`.
- Explicit startup `--model`, `--provider`, or `--models` arguments take precedence (including `--flag=value` forms). These startup flags do not prevent restoration on a later `/new`.
- Resumed sessions, forks, reloads, and startup sessions with existing messages retain their own model.
- Invalid or incomplete saved state is ignored.
- RPC, JSON, and print modes neither restore nor save global model state. This prevents embedded/non-interactive hosts from having their model choices overwritten.

Pi's extension context does not indicate whether an SDK caller supplied a model explicitly. SDK/Herdr hosts that bind extensions in **TUI mode** must set `PI_REMEMBER_MODEL_DISABLE=1` in the child process environment **before loading extensions** if they own the model selection. This disables the extension entirely, including state writes. There is no automatic Herdr-specific detection; the mode guard and opt-out are covered by unit tests, not an end-to-end Herdr test.

## Install from npm

Run `pi install npm:pi-remember-model`, then use `pi list` to check the installed source.

## Install locally (development)

From this repository, run `pi install .` (user-level; do not pass `--local`). Pi loads the package directly from this checkout, so edits to `extensions/remember-model.ts` can be tested with `/reload` or a fresh Pi process. Use `pi list` to check the installed source. No copy into Pi's extensions directory is needed.

## Development

Edit `extensions/remember-model.ts` in this checkout. The `pi.extensions` manifest in `package.json` selects that file. Pi provides `@earendil-works/pi-coding-agent` at runtime; local packages are not modified by `pi install`.

Run the tests with:

```
npm test
```

The unit tests use only Node's built-in test runner and a stub for the host's `getAgentDir()` import: no Pi installation, personal paths, credentials, or network access are required. Temporary state directories are removed after the suite, and process arguments/environment are restored between tests. Coverage includes startup precedence, lifecycle exclusions, JSON validation, persistence, all thinking levels, unavailable models, non-interactive modes, and the embedded-host opt-out. These are unit tests, not a complete runtime integration test.

The extension reads and writes `last-model.json` in Pi's user agent directory. That state file is **not** part of this repository. Keep credentials, personal settings, and session files outside the repository as well.
