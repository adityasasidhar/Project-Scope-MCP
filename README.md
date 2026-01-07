# Project Scope MCP Server

**A robust, production-ready Model Context Protocol (MCP) server empowering AI agents with deep semantic understanding and safe manipulation of software repositories.**

---

## Overview

Project Scope moves beyond simple file reading to provide **semantic analysis**, **AST-based refactoring**, **Git integration**, and **defense-in-depth security validation**. It allows Large Language Models (LLMs) to interact with codebases reliably and safely, bridging the gap between chat interfaces and complex development workflows.

## Key Features

- **Semantic Repository Analysis**: Parse and understand code structure, dependencies, and relationships using Tree-sitter.
- **Context-Aware Security**: Advanced scanner with zero false positives on source code, detecting SQLi, XSS, and RCE attempts in runtime inputs.
- **Safe Refactoring**: AST-based renaming and extraction tools with "preview first" capabilities to prevent syntax errors.
- **Git Integration**: Comprehensive version control management including history, diffing, and branch operations.
- **Defense-in-Depth**: Multi-layered protection including Prompt Injection detection (Regex + LLM Guard), input validation, and file access controls.

---

## Table of Contents

- [Installation](#installation)
- [Configuration](#configuration)
- [Security Architecture](#security-architecture)
- [Connecting Clients](#connecting-clients)
- [Tool Reference](#tool-reference)
  - [Repository Analysis](#repository-analysis)
  - [Security Scanning](#security-scanning)
  - [Refactoring](#refactoring)
  - [Git Operations](#git-operations)
- [Troubleshooting](#troubleshooting)
- [License](#license)

---

[![npm version](https://badge.fury.io/js/%40adityasasidhar%2Fproject-scope-mcp.svg)](https://badge.fury.io/js/%40adityasasidhar%2Fproject-scope-mcp)

---

## Quick Start

Run instantly with `npx`:

```bash
npx -y @adityasasidhar/project-scope-mcp
```

---

## Installation (Source)

To build from source:

```bash
# Install dependencies
npm install

# Build the project
npm run build
```

---

## Configuration

Security is a primary focus of Project Scope. The server is highly customizable to match your risk profile.

### Security Modes
- **`strict`** (default): Blocks operations immediately if a potential threat is detected.
- **`advisory`**: Logs and warnings are generated, but operations are allowed to proceed (useful for initial audits).

### Sensitivity Levels
- **`high`**: Aggressive detection, useful for untrusted user inputs.
- **`medium`** (default): Balanced profile for standard development.
- **`low`**: Only flags high-confidence known attack signatures.

### LLM Guard (Optional)
For state-of-the-art protection against prompt injection attacks, enable **Meta Llama Prompt Guard 2**:
- Set `useGuardModel: true` in your requests.
- Requires a valid HuggingFace API token.

---

## Security Architecture

The server features a **Context-Aware Security Scanner** designed to eliminate false positives while maintaining rigorous threat detection.

## Intelligent Context Detection

The scanner uses file categorization to determine the appropriate validation strategy:

| File Type | Extension | Scanning Strategy | Reason |
|-----------|-----------|-------------------|--------|
| **Source Code** | `.ts`, `.py`, `.go` | **Skipped** | Source code syntax (semi-colons, pipes) mimics attack patterns. |
| **Templates** | `.hbs`, `.jinja2` | **Syntax-Aware** | Validates usage but allows standard template tokens. |
| **Config** | `.json`, `.yaml` | **Minimal** | Allows standard configuration strings. |
| **Runtime Input** | (None) | **Strict** | Full regex and heuristic scanning for malicious payloads. |

### Line-Level Filtering

Within analyzed files, the engine intelligently ignores:
- **Comments**: `//`, `/*`, `#`
- **Imports**: `import`, `require`
- **Definitions**: `interface`, `type`, `class`

This ensures that *documenting* a security vulnerability in a comment or test file does not trigger a false alarm, while *executing* or *receiving* a malicious payload is caught.

---

## 🔌 Connecting Clients

### Claude Desktop

1. Open your configuration file:
   - macOS: `~/Library/Application Support/Claude/claude_desktop_config.json`
   - Windows: `%APPDATA%\Claude\claude_desktop_config.json`

2. Add the server definition:
```json
{
  "mcpServers": {
    "project-scope": {
      "command": "node",
      "args": ["/absolute/path/to/ProjectScopeMCP/dist/index.js"]
    }
  }
}
```

### Claude Code (CLI)

The official [Claude Code CLI](https://docs.anthropic.com/en/docs/agents-and-tools/claude-code/overview) supports MCP natively.

1.  **Add the server:**
    Run the following command in your terminal:
    ```bash
    claude mcp add project-scope -- npx -y @adityasasidhar/project-scope-mcp
    ```

2.  **Verify:**
    Run `claude` and type `/mcp` to see the connected servers.

### Codex CLI

[Codex CLI](https://github.com/openai/codex-cli) (if applicable) supports MCP via its TOML configuration.

1.  **Edit Configuration:**
    Open `~/.codex/config.toml`.

2.  **Add Server:**
    ```toml
    [mcp.servers.project-scope]
    command = "npx"
    args = ["-y", "@adityasasidhar/project-scope-mcp"]
    ```

### Gemini CLI

[Gemini CLI](https://github.com/google/gemini-cli) supports MCP via its JSON configuration.

1.  **Edit Configuration:**
    Open `~/.gemini/settings.json` (create if it doesn't exist).

2.  **Add Server:**
    ```json
    {
      "mcpServers": {
        "project-scope": {
          "command": "npx",
          "args": ["-y", "@adityasasidhar/project-scope-mcp"]
        }
      }
    }
    ```

### Generic Clients

For any other client that supports MCP (like **Windsurf**, **Smithery**, **Goose**, or custom implementations), use the standard stdio configuration:

```bash
npx -y @adityasasidhar/project-scope-mcp
```

### Cursor

1. Open **Cursor Settings** (Cmd/Ctrl + Shift + J).
2. Navigate to **Features** > **MCP Servers**.
3. Click **+ Add New MCP Server**.
4. Configure:
   - **Name**: `project-scope`
   - **Type**: `command`
   - **Command**: `node /absolute/path/to/ProjectScopeMCP/dist/index.js`
   *(Or use `npm run start` if preferred)*


### GitHub Copilot (VS Code)

1.  Open **GitHub Copilot Chat** in VS Code.
2.  Click the **Attach Context** (paperclip) or **Tools** icons.
3.  Select **Connect to MCP Server...**
4.  Choose **Command** (or similar) and enter:
    - **Command**: `npx`
    - **Args**: `-y @adityasasidhar/project-scope-mcp`

*Note: Requires GitHub Copilot Agent Mode enabled in VS Code settings.*
---

##  Tool Reference

### Repository Analysis

#### `get_repo_structure`
Generates a hierarchical map of the repository, respecting `.gitignore`.
- **input**: `{ "path": "/path/to/repo", "format": "tree" }`

#### `analyze_impact`
Predicts the "blast radius" of changing a symbol (function, variable) by finding all references via AST.
- **input**: `{ "path": "...", "filePath": "src/utils.ts", "symbolName": "processData", "line": 42 }`

### Security Scanning

#### `scan_repo_for_threats`
Audits the entire repository for security risks (secrets, injection patterns). Skips ignored files for performance.
- **input**: `{ "path": "/path/to/repo", "excludePatterns": ["dist"] }`

#### `scan_file_for_threats`
Deep-scans a single file or string with the context-aware engine.
- **input**: `{ "filePath": "/path/to/file.ts", "mode": "strict" }`

#### `validate_shell_input`
Validates shell commands for injection risks before execution.
- **input**: `{ "input": "rm -rf /", "mode": "strict" }`

### Refactoring

#### `refactor_rename`
Semantically renames a symbol across the project.
- **input**: `{ "path": "...", "filePath": "...", "oldName": "foo", "newName": "bar", "apply": false }`
- **Note**: Always use `"apply": false` first to preview changes.

#### `refactor_extract_function`
Extracts selected lines of code into a new function.
- **input**: `{ "path": "...", "filePath": "...", "startLine": 10, "endLine": 20, "functionName": "newFunc" }`

### Git Operations

Includes standard Git tools for agentic workflows:
- `git_status`
- `git_commit_history`
- `git_compare_branches`
- `git_init`

---

## Troubleshooting

**"Repo Scan Too Slow"**
- Add large directories (e.g., `vendor`, `node_modules`) to `excludePatterns`. 
- Large files (>1MB) are automatically skipped.

**"Refactoring Failed to Parse"**
- Ensure the code is syntactically valid before refactoring. Tree-sitter parsers typically require valid syntax to generate accurate ASTs.

---

## License

This project is licensed under the **ISC License**.
