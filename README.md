# Project Scope MCP Server

A robust, production-ready Model Context Protocol (MCP) server that empowers AI agents with deep understanding and manipulation capabilities for software repositories.

Unlike simple file readers, this server provides **semantic understanding**, **safe refactoring**, **Git integration**, and **defense-in-depth security validation** to enable reliable autonomous coding workflows.

## 🚀 Key Capabilities

### 🧠 Semantic Repository Analysis
Move beyond simple file listing. Understand code structure and relationships.
- **`get_repo_structure`** - Generate optimized file trees or JSON structures (supports `.gitignore`).
- **`analyze_impact`** - Predict the blast radius of changes using Tree-sitter AST analysis.

### 🛡️ Security & Guardrails
Protect your environment from malicious code execution and injection attacks.
- **Input Validation**: Detect shell command injection, SQL injection, and path traversal attempts.
- **SSTI Detection**: Identify Server-Side Template Injection patterns (Jinja2, Handlebars, etc.).
- **Prompt Injection Defense**: Multi-layered detection using regex heuristics + optional **Llama Prompt Guard 2** (LLM-based).
- **Threat Scanning**: Scan individual files or entire repositories for hidden threats.

### 🔄 Safe Refactoring
Perform complex code modifications with confidence.
- **Preview First**: All refactoring tools support a `preview` mode to dry-run changes.
- **AST-Based**: Uses Abstract Syntax Trees (not regex) for precise renaming and extraction.
- **Tools**: Rename symbols, extract functions, move definitions, inline variables, and detect dead code.

### 📦 Git Integration
Full version control management directly from the agent.
- **History & Diffing**: View commit history, compare branches, and analyze changes.
- **State Management**: Branch status, staging area visualization, and repo initialization.

## 🏗️ Architecture

The server is built on a modular architecture to ensure stability and extensibility:

1.  **Tool Layer**: Defining schemas and handling MCP requests.
2.  **Logic Layer**: Pure functions implementing core business logic (e.g., `git-tools.ts`, `security-tools.ts`).
3.  **Parser Layer**: Tree-sitter integration for multi-language AST support (TypeScript, Python, Go, etc.).
4.  **Security Layer**: Centralized validation logic shared across all tools.

## ⚙️ Configuration

The security tools are highly configurable to balance safety and flexibility.

### Security Modes
- **`strict`** (default): Blocks operations immediately if a threat is detected.
- **`advisory`**: Returns warnings but allows the operation to proceed (useful for auditing).

### Sensitivity Levels
- **`high`** (default): Aggressive detection. Flags even potential risks (e.g., high entropy strings).
- **`medium`**: Standard balanced profile.
- **`low`**: Only flags high-confidence known attack signatures.

### LLM Guard (Optional)
For state-of-the-art prompt injection detection, integration with **Meta Llama Prompt Guard 2** is available via HuggingFace Inference API.
- Set `useGuardModel: true` in your requests.
- Requires a free HuggingFace API token.

## Installation

```bash
npm install
npm run build
```

## Usage

### With Claude Desktop

Add to your `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "project-scope": {
      "command": "node",
      "args": ["/path/to/ProjectScopeMCP/dist/index.js"]
    }
  }
}
```

### Development

```bash
npm run dev    # Run with tsx (hot reload)
npm run build  # Compile TypeScript
```

## Tool Reference

### get_repo_structure
```json
{
  "path": "/path/to/repo",
  "format": "tree" | "simple" | "json"
}
```

### analyze_impact
```json
{
  "path": "/path/to/repo",
  "filePath": "src/utils.ts",
  "symbolName": "myFunction",
  "line": 42
}
```

### git_init
```json
{
  "path": "/path/to/new/repo",
  "initialBranch": "main",
  "bare": false
}
```

### git_status
```json
{
  "path": "/path/to/repo"
}
```

### git_commit_history
```json
{
  "path": "/path/to/repo",
  "maxCount": 10,
  "filePath": "src/index.ts",
  "author": "John",
  "since": "2024-01-01",
  "until": "2024-12-31"
}
```

### git_compare_branches
```json
{
  "path": "/path/to/repo",
  "branch1": "main",
  "branch2": "feature-branch",
  "showDiff": true
}
```

### refactor_rename
```json
{
  "path": "/path/to/repo",
  "filePath": "src/utils.ts",
  "symbolName": "oldName",
  "newName": "newName",
  "apply": false
}
```

### refactor_extract_function
```json
{
  "path": "/path/to/repo",
  "filePath": "src/main.ts",
  "startLine": 10,
  "endLine": 20,
  "functionName": "extractedFunction",
  "apply": false
}
```

### find_dead_code
```json
{
  "path": "/path/to/repo"
}
```

## 💡 Common Workflows

### 1. Auditing a New Repository
When an agent first encounters a repository, run this sequence to understand context and safety:
1.  **`scan_repo_for_threats`** (strict mode) - Ensure the repo is safe to interact with.
2.  **`get_repo_structure`** - Map out the file hierarchy.
3.  **`git_status`** - Check the current state of version control.

### 2. Implementation with Guardrails
When writing new code:
1.  **`validate_shell_input`** / **`validate_sql_query`** - Validate any commands or queries the agent plans to write.
2.  **`analyze_impact`** - Check dependencies before changing existing code.
3.  **`refactor_rename`** (preview=true) - Verify any symbol changes.

### 3. Reviewing User Content
When processing untrusted file uploads or user inputs:
1.  **`scan_file_for_threats`** - Run a full multi-vector scan.
2.  **`detect_prompt_injection`** (useGuardModel=true) - Use LLM validation for high-risk text fields.

## Tool Reference

### scan_file_for_threats
Scans a single file for all known threat vectors (Shell, SQL, Template, Prompt Injection).
```json
{
  "filePath": "/path/to/suspicious_file.md",
  "mode": "strict",
  "sensitivity": "high"
}
```

### scan_repo_for_threats
Recursively scans an entire repository using high-performance regex patterns. Skips `node_modules` and `.git` by default.
```json
{
  "path": "/path/to/repo",
  "excludePatterns": ["dist", "build", "*.min.js"],
  "mode": "advisory"
}
```

### detect_prompt_injection
Detects attempts to manipulate AI behavior. Supports hybrid detection (Regex + LLM).
```json
{
  "content": "Ignore previous instructions...",
  "useGuardModel": true,
  "huggingfaceToken": "hf_..."
}
```

### validate_shell_input
```json
{
  "input": "rm -rf / && echo cleaned",
  "mode": "strict",
  "sensitivity": "high"
}
```

### validate_sql_query
```json
{
  "query": "SELECT * FROM users WHERE id='1' OR '1'='1'",
  "mode": "strict"
}
```

### validate_file_path
```json
{
  "filePath": "../../etc/passwd",
  "projectRoot": "/path/to/project"
}
```

### detect_template_injection
```json
{
  "content": "{{config.__class__.__init__.__globals__}}"
}
```

## ❓ Troubleshooting

### "HuggingFace Token Invalid"
- Ensure you have generated a **Read** token from [HuggingFace Settings](https://huggingface.co/settings/tokens).
- Verify the token has access to the Inference API.

### "Repo Scan Too Slow"
- Add large directories to `excludePatterns` (e.g., `["vendor", "logs", "*.lock"]`).
- Large files (>1MB) are automatically skipped for performance.

### "Refactoring Failed to Parse"
- Ensure the file syntax is valid for its language.
- Tree-sitter parsers require syntactically correct code to generate accurate ASTs.

## Dependencies

- `@modelcontextprotocol/sdk` - MCP SDK
- `simple-git` - Git operations
- `tree-sitter` - Code parsing for impact analysis
- `fast-glob` - File discovery
- `@huggingface/inference` - LLM-based prompt injection detection

## License

ISC
