# Bitbucket MCP Server

Connect AI assistants (Claude, Cursor, Cline, etc.) to Bitbucket — Cloud and Data Center — via the [Model Context Protocol](https://modelcontextprotocol.io).

## Requirements

- **Node.js** 18+ (for npx / stdio mode)
- **Docker** (for containerised / HTTP mode)
- A **Bitbucket Cloud** account or a **Bitbucket Data Center / Server** instance

## Quick Start

### Step 1 — Get credentials

#### Bitbucket Data Center / Server

1. Log in to your DC instance
2. Go to **Profile → Manage Account → Personal Access Tokens**
3. Create a token with **Project: Read** + **Repository: Read** (add Write for PR/comment creation)
4. Note your instance URL (e.g. `https://bitbucket.company.com`)

#### Bitbucket Cloud — Scoped API Token (recommended)

> App Passwords are deprecated and will be removed in **June 2026**. Use Scoped API Tokens for new setups.

1. Go to [Atlassian API Tokens](https://id.atlassian.com/manage-profile/security/api-tokens)
2. Click **Create API token with scopes** → select **Bitbucket**
3. Add scopes: `repository`, `workspace` (add `pullrequest` for PR management)
4. Copy the token (starts with `ATATT`) — use with your Atlassian account email

#### Bitbucket Cloud — App Password (legacy)

1. Go to [Bitbucket App Passwords](https://bitbucket.org/account/settings/app-passwords/)
2. Create a password with: **Workspaces: Read**, **Repositories: Read**, **Pull Requests: Read** (add Write as needed)

---

### Step 2 — Run the server

Choose **npx** (stdio, AI assistant config) or **Docker** (HTTP, team/server deployments).

#### npx — Bitbucket Data Center

```bash
export BITBUCKET_DC_BASE_URL="https://bitbucket.company.com"
export BITBUCKET_DC_TOKEN="your_personal_access_token"

npx -y @Fanatic-zer0/mcp-server-atlassian-bitbucket
```

#### npx — Bitbucket Cloud

```bash
# Scoped API Token (recommended)
export ATLASSIAN_USER_EMAIL="your.email@company.com"
export ATLASSIAN_API_TOKEN="your_scoped_api_token"

# OR legacy App Password
export ATLASSIAN_BITBUCKET_USERNAME="your_username"
export ATLASSIAN_BITBUCKET_APP_PASSWORD="your_app_password"

npx -y @Fanatic-zer0/mcp-server-atlassian-bitbucket
```

#### Docker — Bitbucket Data Center

```bash
docker run -p 3000:3000 \
  -e BITBUCKET_DC_BASE_URL=https://bitbucket.company.com \
  -e BITBUCKET_DC_TOKEN=your_personal_access_token \
  mcp-server-atlassian-bitbucket
```

Optional flags:
```bash
  -e NODE_TLS_REJECT_UNAUTHORIZED=0   # self-signed / private CA certificate
  -e HTTPS_PROXY=http://proxy.company.com:8080  # corporate proxy
  -e NO_PROXY=localhost,127.0.0.1
  -e BITBUCKET_READ_ONLY=true         # disable all write tools
```

#### Docker — Bitbucket Cloud

```bash
docker run -p 3000:3000 \
  -e ATLASSIAN_USER_EMAIL=your@email.com \
  -e ATLASSIAN_API_TOKEN=your_scoped_api_token \
  -e NODE_TLS_REJECT_UNAUTHORIZED=0  #### if SSL issue.
  -e BITBUCKET_READ_ONLY=true
  mcp-server-atlassian-bitbucket
```

#### Docker Compose

Create a `.env` file next to `docker-compose.yml`:

```dotenv
# DC mode
BITBUCKET_DC_BASE_URL=https://bitbucket.company.com
BITBUCKET_DC_TOKEN=your_personal_access_token

# OR Cloud mode
ATLASSIAN_USER_EMAIL=your@email.com
ATLASSIAN_API_TOKEN=your_scoped_api_token

# Optional
BITBUCKET_DEFAULT_WORKSPACE=MY_PROJECT_KEY
BITBUCKET_READ_ONLY=true
```

Then:
```bash
docker compose up
```

The MCP endpoint is available at `http://localhost:3000/mcp`.

---

## Connect to AI Assistants

### Claude Desktop

Add to `~/.claude/claude_desktop_config.json`:

**Bitbucket Data Center**
```json
{
  "mcpServers": {
    "bitbucket": {
      "command": "npx",
      "args": ["-y", "@Fanatic-zer0/mcp-server-atlassian-bitbucket],
      "env": {
        "BITBUCKET_DC_BASE_URL": "https://bitbucket.company.com",
        "BITBUCKET_DC_TOKEN": "your_personal_access_token"
      }
    }
  }
}
```

**Bitbucket Cloud — Scoped API Token**
```json
{
  "mcpServers": {
    "bitbucket": {
      "command": "npx",
      "args": ["-y", "@Fanatic-zer0/mcp-server-atlassian-bitbucket"],
      "env": {
        "ATLASSIAN_USER_EMAIL": "your.email@company.com",
        "ATLASSIAN_API_TOKEN": "your_scoped_api_token"
      }
    }
  }
}
```

**Bitbucket Cloud — App Password (legacy)**
```json
{
  "mcpServers": {
    "bitbucket": {
      "command": "npx",
      "args": ["-y", "npx -y @Fanatic-zer0/mcp-server-atlassian-bitbucket"],
      "env": {
        "ATLASSIAN_BITBUCKET_USERNAME": "your_username",
        "ATLASSIAN_BITBUCKET_APP_PASSWORD": "your_app_password"
      }
    }
  }
}
```

Restart Claude Desktop after saving.


### Config File (system-wide)

Create `~/.mcp/configs.json`:

```json
{
  "bitbucket": {
    "environments": {
      "BITBUCKET_DC_BASE_URL": "https://bitbucket.company.com",
      "BITBUCKET_DC_TOKEN": "your_personal_access_token",
      "BITBUCKET_DEFAULT_WORKSPACE": "MY_PROJECT_KEY"
    }
  }
}
```

---

## Available Tools

All tools work transparently for both Bitbucket Cloud and Data Center. The `workspace` parameter is the **workspace slug** on Cloud (e.g. `myteam`) or the **project key** on DC (e.g. `MYPROJ`).

### Read-only tools

| Tool | Description | Key Parameters |
|---|---|---|
| `list_projects` | List Cloud workspaces or DC projects | `limit?`, `start?`, `jq?` |
| `list_repositories` | List repos in a workspace/project | `workspace?`, `query?`, `limit?`, `start?`, `jq?` |
| `list_branches` | List branches in a repo | `workspace`, `repoSlug`, `filterText?`, `limit?`, `start?`, `jq?` |
| `list_commits` | List commits on a branch | `workspace`, `repoSlug`, `branch?`, `author?`, `limit?`, `start?`, `jq?` |
| `list_pull_requests` | List pull requests | `workspace`, `repoSlug`, `state?`, `author?`, `direction?`, `limit?`, `start?`, `jq?` |
| `get_pull_request` | Get details of a single PR | `workspace`, `repoSlug`, `pullRequestId`, `jq?` |
| `get_diff` | Get unified diff of a PR | `workspace`, `repoSlug`, `pullRequestId`, `contextLines?`, `maxLinesPerFile?` |
| `get_branch_diff` | Compare two branches directly | `workspace`, `repoSlug`, `sourceBranch`, `targetBranch?`, `contextLines?`, `maxLinesPerFile?` |
| `get_reviews` | Get PR reviewer/approval status | `workspace`, `repoSlug`, `pullRequestId`, `jq?` |
| `get_activities` | Get PR activity timeline | `workspace`, `repoSlug`, `pullRequestId`, `limit?`, `start?`, `jq?` |
| `get_comments` | Get PR comments | `workspace`, `repoSlug`, `pullRequestId`, `limit?`, `start?`, `jq?` |
| `search` | Search code/files across repos | `query`, `type?`, `workspace?`, `repoSlug?`, `limit?`, `start?`, `jq?` |
| `get_file_content` | Get raw file content | `workspace`, `repoSlug`, `path`, `branch?`, `limit?`, `start?` |
| `browse_repository` | Browse directory structure | `workspace`, `repoSlug`, `path?`, `branch?`, `limit?`, `jq?` |

### Write tools (disabled when `BITBUCKET_READ_ONLY=true`)

| Tool | Description | Key Parameters |
|---|---|---|
| `create_pull_request` | Create a new PR | `workspace`, `repoSlug`, `title`, `sourceBranch`, `targetBranch`, `description?`, `reviewers?` |
| `merge_pull_request` | Merge a PR | `workspace`, `repoSlug`, `pullRequestId`, `strategy?`, `message?`, `version?` (DC) |
| `decline_pull_request` | Decline a PR | `workspace`, `repoSlug`, `pullRequestId`, `message?`, `version?` (DC) |
| `approve_pull_request` | Approve a PR | `workspace`, `repoSlug`, `pullRequestId` |
| `unapprove_pull_request` | Remove PR approval | `workspace`, `repoSlug`, `pullRequestId` |
| `add_comment` | Add a PR comment | `workspace`, `repoSlug`, `pullRequestId`, `text`, `parentId?` |
| `delete_branch` | Delete a branch | `workspace`, `repoSlug`, `branch` |

### Parameter reference

**Pagination** — all list tools support:
- `limit` — max items per page (default: 25, max: 1000)
- `start` — 0-based offset (default: 0)

**Output**:
- `jq` — JMESPath expression to filter/transform the response (recommended to reduce token cost)
- `outputFormat` — `"toon"` (default, 30–60% fewer tokens) or `"json"`

**Diffs** (`get_diff`, `get_branch_diff`):
- `contextLines` — lines of context around each change (default: 10)
- `maxLinesPerFile` — truncate large files; shows first 60% + last 40% of the limit. Falls back to `BITBUCKET_DIFF_MAX_LINES_PER_FILE` env var.

**PRs**:
- `strategy` (`merge_pull_request`) — `"merge-commit"` (default), `"squash"`, `"fast-forward"`
- `direction` (`list_pull_requests`) — `"INCOMING"` (default) or `"OUTGOING"`
- `version` (DC only) — PR version for optimistic locking, read from `get_pull_request`
- `parentId` (`add_comment`) — parent comment ID for threaded replies

**Search**:
- `type` — `"code"` (default, full-text) or `"file"` (exact filename match)

---

## Environment Variables

| Variable | Description |
|---|---|
| `BITBUCKET_DC_BASE_URL` | Enables DC mode. Set to your DC instance URL (e.g. `https://bitbucket.company.com`) |
| `BITBUCKET_DC_TOKEN` | DC Personal Access Token (preferred for DC) |
| `BITBUCKET_DC_USERNAME` | DC username for Basic auth |
| `BITBUCKET_DC_PASSWORD` | DC password for Basic auth |
| `ATLASSIAN_USER_EMAIL` | Cloud: Atlassian account email |
| `ATLASSIAN_API_TOKEN` | Cloud: Scoped API Token (starts with `ATATT`) |
| `ATLASSIAN_BITBUCKET_USERNAME` | Cloud: legacy App Password username |
| `ATLASSIAN_BITBUCKET_APP_PASSWORD` | Cloud: legacy App Password |
| `BITBUCKET_DEFAULT_WORKSPACE` | Default workspace/project key (used when `workspace` is omitted) |
| `BITBUCKET_READ_ONLY` | Set `"true"` to disable all write tools at startup |
| `BITBUCKET_DIFF_MAX_LINES_PER_FILE` | Default per-file line limit for diffs |
| `HTTPS_PROXY` / `HTTP_PROXY` | Corporate proxy URL |
| `NO_PROXY` | Comma-separated hostnames to bypass the proxy |
| `NODE_TLS_REJECT_UNAUTHORIZED` | Set `"0"` to allow self-signed certificates (DC only) |
| `DEBUG` | Set `"true"` for verbose request/response logging |

---

## Building Docker Image

```bash
docker build -t mcp-server-atlassian-bitbucket .
```

---

## Troubleshooting

### "Authentication credentials are missing"

| Deployment | Required variables |
|---|---|
| DC — Personal Access Token | `BITBUCKET_DC_BASE_URL` + `BITBUCKET_DC_TOKEN` |
| DC — Basic auth | `BITBUCKET_DC_BASE_URL` + `BITBUCKET_DC_USERNAME` + `BITBUCKET_DC_PASSWORD` |
| Cloud — Scoped API Token | `ATLASSIAN_USER_EMAIL` + `ATLASSIAN_API_TOKEN` |
| Cloud — App Password | `ATLASSIAN_BITBUCKET_USERNAME` + `ATLASSIAN_BITBUCKET_APP_PASSWORD` |

Verify credentials are visible inside a Docker container:
```bash
docker exec <container_id> printenv | grep -E 'BITBUCKET|ATLASSIAN'
```

### "403 Forbidden" or "Authentication failed"

- **DC**: Token must not be expired and have at least **Repository: Read**
- **Cloud Scoped Token**: needs scopes `repository` + `workspace`; token starts with `ATATT`
- **Cloud App Password**: check permissions at [Bitbucket App Passwords](https://bitbucket.org/account/settings/app-passwords/)

### TLS / certificate errors (Docker + DC)

Docker's Alpine image trusts only public CAs. Options:

```bash
# Quick workaround (not for production)
-e NODE_TLS_REJECT_UNAUTHORIZED=0

# Proper fix — add your corporate CA to the image
COPY company-ca.crt /usr/local/share/ca-certificates/
RUN apk add --no-cache ca-certificates && update-ca-certificates
```

### "404 Not Found"

- **Cloud**: workspace slug is case-sensitive; use the slug from the URL (e.g. `myteam`, not `My Team`)
- **DC**: use the project **key** (e.g. `MYPROJ`), not the project name

### Claude Desktop — server not appearing

1. Verify config file is valid JSON
2. Restart Claude Desktop completely
3. Check logs: `~/Library/Logs/Claude/mcp*.log` (macOS) or `%APPDATA%\Claude\logs` (Windows)

---

## Tips

- **Use `jq` on every call** — unfiltered responses can be large and costly in tokens
- **TOON format is the default** — 30–60% fewer tokens than JSON; override with `outputFormat: "json"` if needed
- **`list_repositories` workspace is optional** — set `BITBUCKET_DEFAULT_WORKSPACE` once and omit it from every call
- **Enable `DEBUG=true`** to see exact HTTP requests/responses when something is not working

---
