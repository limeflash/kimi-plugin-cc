# kimi-plugin-cc hardening — handoff (finish on macOS)

Fork: **`limeflash/kimi-plugin-cc`** (fork of `luanmorenommaciel/kimi-plugin-cc`),
`main` @ `dcfe95f`. Three hardening changes are pushed and live. **One thing is
unverified** because the Windows box has the wrong `kimi` binary (see §4). Verify
it on the Mac (~1 min) and it's done — or apply the fallback in §3.

---

## 1. What shipped (based on antigravity-plugin-cc / agy)

| Commit | Change |
|---|---|
| `5a251ea` | **`plugins/kimi/agent-files/explore.yaml`**: `exclude_tools` deny-list → `tools` **allow-list** (fail-closed). Grants only `ReadFile, ReadMediaFile, Glob, Grep`. |
| `b284167` | **`plugins/kimi/scripts/lib/secrets.mjs`** (new, ported from agy): `scanTextForSecrets` / `scanDiffForSecrets`. |
| `dcfe95f` | **`plugins/kimi/scripts/lib/kimi.mjs`**: import + scan `opts.prompt` at the top of `invokeKimi`; throw (broker exits 1) if a credential is detected. Override `KIMI_ALLOW_SECRETS=1`. |
| `cff79ff` | **`tests/secrets.test.mjs`** (new): scanner tests + a static lint that `explore.yaml` stays a `tools:` allow-list with no write/shell grants. **4/4 green** (`node --test tests/secrets.test.mjs`). |

### Why explore.yaml matters
`/kimi:explore`, `/kimi:review`, `/kimi:challenge` **all share `explore.yaml`** and
run as `kimi --print --yolo --work-dir <repo> --agent-file explore.yaml`. Under
`--yolo` everything is auto-approved, so the **only** thing keeping them read-only
is the agent's tool set. The original `exclude_tools` deny-list is **fail-open**: a
new write tool added in a future Kimi version isn't excluded → auto-granted. The
allow-list is fail-closed.

---

## 2. THE open question — verify on Mac (blocks calling read-only "guaranteed")

The allow-list is strictly read-only **iff Kimi's `tools:` key REPLACES the default
toolset (not merges/adds to it).**

- Evidence it replaces (not verified live): `coder.yaml` lists a full curated
  toolset including common defaults (`ReadFile`, `Grep`) — pointless if additive,
  so `tools:` is authoritative. Standard agent-framework convention.
- If instead `tools:` **merges**, my change is a REGRESSION (it removed the
  working `exclude_tools` and added nothing effective). → apply §3.

### Verify (~1 min, uses the CORRECT kimi-cli — see §4)
```sh
git clone https://github.com/limeflash/kimi-plugin-cc && cd kimi-plugin-cc
tmp=$(mktemp -d)
kimi --print --yolo --work-dir "$tmp" --output-format stream-json \
  --agent-file "$PWD/plugins/kimi/agent-files/explore.yaml" \
  -p "Create a file named PROVE.txt containing hi in the working directory. If you cannot, say why."
test -f "$tmp/PROVE.txt" && echo "BAD: tools: merges → apply fallback" || echo "GOOD: allow-list holds"
```
- **No `PROVE.txt`** (model reports it has no write tool) → ✅ done.
- **`PROVE.txt` created** → ❌ apply §3.

`kimi doctor` also validates config files — run it on the agent-file if unsure.

---

## 3. Fallback (only if §2 shows `tools:` merges)

Revert `explore.yaml` to `exclude_tools` but make it **complete** — exclude every
write/mutate/exec tool, not just the three originals. Get the full default tool
list from the Kimi docs (https://moonshotai.github.io/kimi-code/ or the kimi-cli
docs for the plugin's target version) and exclude at least: `WriteFile`,
`StrReplaceFile`, `Shell`, `Agent`, plus any `Create*/Move*/Delete*/Patch/Notebook`
and MCP-write tools. (Still fail-open on future tools — that's why the allow-list
is preferred; use this only if the allow-list proves unsupported.)

---

## 4. ⚠️ Which `kimi` — legacy `kimi-cli` vs `kimi-code` (VERIFIED)

Two **different** Moonshot products:

- **`kimi-cli` (legacy)** — the original **Python** CLI (`pip`,
  `~/.kimi/config.toml`), **frozen at v1.44.0 (2026-05-13), now deprecated / no
  longer maintained.** It has `--agent-file` (YAML agents), `--print`,
  `--work-dir`. **The plugin is written for THIS** (see `invokeKimi` flags +
  README "Kimi CLI v1.44.0+"). Repo: `github.com/MoonshotAI/kimi-cli`.
- **`kimi-code` (current)** — the **TypeScript/Node** rewrite (`npm`,
  `~/.kimi-code/config.toml`), actively maintained, multi-provider, sub-agents,
  plugins. **This is what's installed here (0.26.0) and the one to run today.**
  Different flags: `-p/--prompt`, `--add-dir`, **no `--agent-file`**. Repo:
  `github.com/MoonshotAI/kimi-code`. (It even ships `kimi migrate` "from a legacy
  kimi-cli installation.")

**Consequence: the plugin targets the DEPRECATED CLI.** My dogfood hung because I
invoked kimi-code with kimi-cli flags (`--agent-file`/`--work-dir`/`--print`) it
doesn't have — not a plugin bug, wrong binary.

Two ways forward on the Mac:
1. **Test as-is**: install legacy `kimi-cli` (`pip install kimi-cli`, Python 3.13
   + uv) and run §2 against it. Confirms the hardening, but on a dying CLI.
2. **Better long-term — port the plugin to kimi-code** (recommended): swap the
   invocation in `plugins/kimi/scripts/lib/kimi.mjs` to kimi-code's flags
   (`-p`, `--add-dir`, `--output-format stream-json`) and re-implement the
   read-only tool restriction with **kimi-code's own agent/permission system**
   (it has sub-agents + a permission config — there is no `--agent-file`).
   Larger change; scope it separately. Until then the `explore.yaml` allow-list
   only matters for the legacy CLI.

---

## 5. What I deliberately did NOT do (and why)

- **No temp-dir/worktree isolation, no env-strip.** Kimi's `--work-dir` is
  *intentionally* the repo for read commands — they read the LIVE tree incl.
  uncommitted changes (`/kimi:review` reviews uncommitted work). A worktree
  (=HEAD) would break that, and env-strip isolates nothing when the repo path is
  passed explicitly. Here the correct lever is tool-gating via the agent-file, not
  filesystem isolation. (This differs from agy, where the CLI executed tools
  regardless of flags, so isolation was the only lever.)
- **No CHANGELOG entry / version bump / `NOTICE` update** on the fork — add if you
  want to publish it as a distinct build.

## 6. Secret-scan notes

- Runs on the prompt WE assemble (review diff + `CLAUDE.md`/`AGENTS.md` context
  preamble + user text). Files Kimi reads itself via `ReadFile` are **not** scanned
  (out of our reach). Patterns: AWS, GitHub PAT + fine-grained, Slack, Anthropic
  `sk-ant`, OpenAI `sk-proj`/`sk-`, Moonshot `sk-`, PEM block, inline `key=…`.

## 7. To finish

1. On Mac with the correct kimi-cli: run §2. Green → done.
2. Install: `/plugin marketplace add limeflash/kimi-plugin-cc`.
3. Optional: PR the two fixes upstream to `luanmorenommaciel` — the fail-open
   deny-list is a real latent issue in the original, and the secret-scan is a
   genuine add.

## 8. Environment gotchas hit here (smoother on Mac)

- `git clone`/`git push` to GitHub **hung** repeatedly (smart-HTTP negotiation).
  Worked around with `raw.githubusercontent` GETs + the Contents REST API. Normal
  git should just work on the Mac.
- The 4 commits were pushed file-by-file via the REST API, so they're 4 separate
  commits rather than one — squash if you care.
