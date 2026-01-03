# Project Scope MCP

A Model Context Protocol (MCP) server that provides powerful tools for repository analysis and Git operations. Designed to help AI assistants understand and navigate codebases efficiently.

## Features

### Repository Analysis
- **`get_repo_structure`** - Get complete file structure with tree, simple, or JSON output formats
- **`analyze_impact`** - Analyze the impact of renaming variables/functions across the codebase

### Git Operations
- **`git_init`** - Initialize a new Git repository
- **`git_status`** - Quick overview of repository status (branch, staged/unstaged counts, remote tracking)
- **`git_branch_status`** - Visual representation of all branches and their status
- **`git_commit_history`** - View commit history with filtering by file, author, or date range
- **`git_show_changes`** - Show staged, unstaged, and untracked files with optional diff
- **`git_compare_branches`** - Compare two branches showing unique commits and changed files

### Refactoring
- **`refactor_rename`** - Rename a symbol across the entire codebase (preview + apply)
- **`refactor_extract_function`** - Extract code block into a new function
- **`refactor_move_to_file`** - Move function/class to a different file with import updates
- **`refactor_inline_variable`** - Inline a variable by replacing usages with its value
- **`find_dead_code`** - Detect potentially unused exports and functions

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

## Dependencies

- `@modelcontextprotocol/sdk` - MCP SDK
- `simple-git` - Git operations
- `tree-sitter` - Code parsing for impact analysis
- `fast-glob` - File discovery

## License

ISC
