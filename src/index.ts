import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
    ListToolsRequestSchema,
    CallToolRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { getRepoStructure } from "./tools/repo-structure.js";
import { analyzeImpact } from "./tools/impact-analysis.js";
import { gitBranchStatus, gitCommitHistory, gitShowChanges, gitCompareBranches, gitInit, gitStatus } from "./tools/git-tools.js";
import { refactorRename, refactorExtractFunction, refactorMoveToFile, refactorInlineVariable, findDeadCode } from "./tools/refactoring-tools.js";
import { validateShellInput, validateSqlQuery, validateFilePath, detectTemplateInjection, detectPromptInjectionAsync, createSecurityVisualization, scanFileForThreats, scanRepoForThreats } from "./tools/security-tools.js";
import * as fs from "fs/promises";

const server = new Server(
    {
        name: "project-scope-mcp",
        version: "1.0.0",
    },
    {
        capabilities: {
            tools: {},
        },
    }
);

// List available tools
server.setRequestHandler(ListToolsRequestSchema, async () => {
    return {
        tools: [
            {
                name: "get_repo_structure",
                description:
                    "Map the complete file structure of a repository. Automatically respects .gitignore rules. Use 'tree' format for visual hierarchy, 'simple' for flat file lists, or 'json' for programmatic access. Best practice: Run this first when encountering a new codebase.",
                inputSchema: {
                    type: "object",
                    properties: {
                        path: {
                            type: "string",
                            description: "Root path of the repository",
                        },
                        format: {
                            type: "string",
                            enum: ["tree", "simple", "json"],
                            description: "Output format: 'tree' (visual tree), 'simple' (flat list), or 'json' (structured data)",
                            default: "json",
                        },
                    },
                    required: ["path"],
                },
            },
            {
                name: "analyze_impact",
                description:
                    "Predict the blast radius of renaming a symbol. Uses AST analysis (not text search) to find all legitimate references across the codebase. Use before refactoring to understand dependencies and prevent breaking changes.",
                inputSchema: {
                    type: "object",
                    properties: {
                        path: {
                            type: "string",
                            description: "Root path of the repository",
                        },
                        filePath: {
                            type: "string",
                            description: "Path to the file containing the symbol to analyze",
                        },
                        symbolName: {
                            type: "string",
                            description: "Name of the variable/function to analyze",
                        },
                        line: {
                            type: "number",
                            description: "Line number where the symbol is defined (optional)",
                        },
                    },
                    required: ["path", "filePath", "symbolName"],
                },
            },
            {
                name: "git_branch_status",
                description: "Display all Git branches with their tracking status and current HEAD. Useful for understanding repository state before making commits or merges.",
                inputSchema: {
                    type: "object",
                    properties: {
                        path: {
                            type: "string",
                            description: "Root path of the git repository",
                        },
                    },
                    required: ["path"],
                },
            },
            {
                name: "git_commit_history",
                description: "View commit history with powerful filtering (by file, author, or date range). Returns structured data including commit hashes, timestamps, and messages. Use to understand code evolution or trace when bugs were introduced.",
                inputSchema: {
                    type: "object",
                    properties: {
                        path: {
                            type: "string",
                            description: "Root path of the git repository",
                        },
                        maxCount: {
                            type: "number",
                            description: "Maximum number of commits to retrieve (default: 10)",
                        },
                        filePath: {
                            type: "string",
                            description: "Optional: filter commits by specific file path",
                        },
                        author: {
                            type: "string",
                            description: "Optional: filter commits by author name",
                        },
                        since: {
                            type: "string",
                            description: "Optional: show commits since date (e.g., '2024-01-01', '2 weeks ago')",
                        },
                        until: {
                            type: "string",
                            description: "Optional: show commits until date",
                        },
                    },
                    required: ["path"],
                },
            },
            {
                name: "git_show_changes",
                description: "Show current working directory changes including staged, unstaged, and untracked files. Optionally show detailed diff.",
                inputSchema: {
                    type: "object",
                    properties: {
                        path: {
                            type: "string",
                            description: "Root path of the git repository",
                        },
                        includeUntracked: {
                            type: "boolean",
                            description: "Include untracked files (default: true)",
                        },
                        showDiff: {
                            type: "boolean",
                            description: "Include detailed diff output (default: false)",
                        },
                        filePath: {
                            type: "string",
                            description: "Optional: show diff for specific file only",
                        },
                    },
                    required: ["path"],
                },
            },
            {
                name: "git_compare_branches",
                description: "Compare two Git branches showing unique commits in each branch, common ancestor, and files that differ. Optionally show full diff.",
                inputSchema: {
                    type: "object",
                    properties: {
                        path: {
                            type: "string",
                            description: "Root path of the git repository",
                        },
                        branch1: {
                            type: "string",
                            description: "First branch name to compare",
                        },
                        branch2: {
                            type: "string",
                            description: "Second branch name to compare",
                        },
                        showDiff: {
                            type: "boolean",
                            description: "Include full diff between branches (default: false)",
                        },
                    },
                    required: ["path", "branch1", "branch2"],
                },
            },
            {
                name: "git_init",
                description: "Initialize a new Git repository. Creates a .git directory and sets up the repository structure.",
                inputSchema: {
                    type: "object",
                    properties: {
                        path: {
                            type: "string",
                            description: "Path where the repository should be initialized",
                        },
                        initialBranch: {
                            type: "string",
                            description: "Name of the initial branch (default: 'main')",
                        },
                        bare: {
                            type: "boolean",
                            description: "Create a bare repository (default: false)",
                        },
                    },
                    required: ["path"],
                },
            },
            {
                name: "git_status",
                description: "Get a quick overview of the repository status including current branch, staged/unstaged/untracked file counts, and remote tracking info.",
                inputSchema: {
                    type: "object",
                    properties: {
                        path: {
                            type: "string",
                            description: "Root path of the git repository",
                        },
                    },
                    required: ["path"],
                },
            },
            {
                name: "refactor_rename",
                description: "Rename a symbol (variable, function, class) across the entire codebase. Returns preview of changes, optionally applies them.",
                inputSchema: {
                    type: "object",
                    properties: {
                        path: { type: "string", description: "Root path of the repository" },
                        filePath: { type: "string", description: "Path to file containing the symbol" },
                        symbolName: { type: "string", description: "Current name of the symbol" },
                        newName: { type: "string", description: "New name for the symbol" },
                        apply: { type: "boolean", description: "Apply changes (default: false, preview only)" },
                    },
                    required: ["path", "filePath", "symbolName", "newName"],
                },
            },
            {
                name: "refactor_extract_function",
                description: "Extract a block of code into a new function. Detects parameters and generates function call.",
                inputSchema: {
                    type: "object",
                    properties: {
                        path: { type: "string", description: "Root path of the repository" },
                        filePath: { type: "string", description: "Path to the file" },
                        startLine: { type: "number", description: "Starting line of code to extract" },
                        endLine: { type: "number", description: "Ending line of code to extract" },
                        functionName: { type: "string", description: "Name for the new function" },
                        apply: { type: "boolean", description: "Apply changes (default: false)" },
                    },
                    required: ["path", "filePath", "startLine", "endLine", "functionName"],
                },
            },
            {
                name: "refactor_move_to_file",
                description: "Move a function or class to a different file. Updates imports automatically.",
                inputSchema: {
                    type: "object",
                    properties: {
                        path: { type: "string", description: "Root path of the repository" },
                        sourceFile: { type: "string", description: "Path to source file" },
                        symbolName: { type: "string", description: "Name of function/class to move" },
                        targetFile: { type: "string", description: "Path to target file" },
                        apply: { type: "boolean", description: "Apply changes (default: false)" },
                    },
                    required: ["path", "sourceFile", "symbolName", "targetFile"],
                },
            },
            {
                name: "refactor_inline_variable",
                description: "Inline a variable by replacing all usages with its value and removing the declaration.",
                inputSchema: {
                    type: "object",
                    properties: {
                        path: { type: "string", description: "Root path of the repository" },
                        filePath: { type: "string", description: "Path to the file" },
                        variableName: { type: "string", description: "Name of the variable to inline" },
                        line: { type: "number", description: "Line number of the variable declaration" },
                        apply: { type: "boolean", description: "Apply changes (default: false)" },
                    },
                    required: ["path", "filePath", "variableName", "line"],
                },
            },
            {
                name: "find_dead_code",
                description: "Identify dead code (unused exports and functions). Helps reduce bundle size and improve maintainability. Run periodically to clean up legacy code.",
                inputSchema: {
                    type: "object",
                    properties: {
                        path: { type: "string", description: "Root path of the repository" },
                    },
                    required: ["path"],
                },
            },
            // Security Validation Tools
            {
                name: "validate_shell_input",
                description: "Prevent command injection (RCE). Validates shell input for dangerous metacharacters (&, |, ;, $(), backticks), environment variable tricks, and encoding bypasses. Run this before executing any shell command generated by an LLM or received from user input.",
                inputSchema: {
                    type: "object",
                    properties: {
                        input: { type: "string", description: "The shell command or string to validate" },
                        mode: { type: "string", enum: ["strict", "advisory"], description: "Validation mode: 'strict' blocks threats, 'advisory' provides warnings (default: strict)" },
                        sensitivity: { type: "string", enum: ["high", "medium", "low"], description: "Detection sensitivity: high=aggressive, medium=balanced, low=high-confidence only (default: medium)" },
                        allowedCommands: { type: "array", items: { type: "string" }, description: "List of allowed commands to exclude from threat detection (e.g., ['ls', 'cat', 'echo'])" },
                    },
                    required: ["input"],
                },
            },
            {
                name: "validate_sql_query",
                description: "Prevent SQL injection. Detects UNION attacks, stacked queries (DROP TABLE), comment injection (--), boolean/time-based blind SQLi, and encoding tricks. Validate all dynamically constructed SQL before execution.",
                inputSchema: {
                    type: "object",
                    properties: {
                        query: { type: "string", description: "The SQL query string to validate" },
                        mode: { type: "string", enum: ["strict", "advisory"], description: "Validation mode (default: strict)" },
                        sensitivity: { type: "string", enum: ["high", "medium", "low"], description: "Detection sensitivity (default: medium)" },
                        allowedKeywords: { type: "array", items: { type: "string" }, description: "SQL keywords to allow (e.g., ['SELECT', 'INSERT', 'UPDATE'])" },
                    },
                    required: ["query"],
                },
            },
            {
                name: "validate_file_path",
                description: "Prevent path traversal (LFI). Detects ../ sequences, URL/double encoding, null bytes, and ensures paths stay within projectRoot. Use when processing user-provided file paths to prevent unauthorized file access.",
                inputSchema: {
                    type: "object",
                    properties: {
                        filePath: { type: "string", description: "The file path to validate" },
                        projectRoot: { type: "string", description: "Project root directory to check containment against" },
                        mode: { type: "string", enum: ["strict", "advisory"], description: "Validation mode (default: strict)" },
                        sensitivity: { type: "string", enum: ["high", "medium", "low"], description: "Detection sensitivity (default: high)" },
                    },
                    required: ["filePath"],
                },
            },
            {
                name: "detect_template_injection",
                description: "Prevent Server-Side Template Injection (SSTI). Identifies dangerous template syntax from Jinja2, Handlebars, ERB, and others. Flags RCE payloads like {{config.__class__}}. Scan user-provided templates or dynamic content before rendering.",
                inputSchema: {
                    type: "object",
                    properties: {
                        content: { type: "string", description: "The string or code content to analyze" },
                        mode: { type: "string", enum: ["strict", "advisory"], description: "Validation mode (default: strict)" },
                        sensitivity: { type: "string", enum: ["high", "medium", "low"], description: "Detection sensitivity (default: high)" },
                    },
                    required: ["content"],
                },
            },
            {
                name: "detect_prompt_injection",
                description: "Defend against AI jailbreaks and prompt injection. Detects role-switching ('You are now DAN'), instruction override ('Ignore previous'), tool manipulation, and hidden payloads. Hybrid detection: Fast regex + optional Llama Prompt Guard 2 (LLM). Use when reading untrusted content (files, web pages, user input).",
                inputSchema: {
                    type: "object",
                    properties: {
                        content: { type: "string", description: "The text content to analyze (from files, web pages, user input, tool descriptions)" },
                        mode: { type: "string", enum: ["strict", "advisory"], description: "Validation mode (default: strict)" },
                        sensitivity: { type: "string", enum: ["high", "medium", "low"], description: "Detection sensitivity (default: high)" },
                        useGuardModel: { type: "boolean", description: "Enable Llama Prompt Guard 2 LLM-based detection (default: false)" },
                        huggingfaceToken: { type: "string", description: "HuggingFace API token (required if useGuardModel is true)" },
                    },
                    required: ["content"],
                },
            },
            // File and Repo Scanning Tools
            {
                name: "scan_file_for_threats",
                description: "Deep-scan a single file for all 5 threat types (shell, SQL, path, template, prompt injection). Returns exact line numbers and risk levels. Use when generating new code or processing uploaded files to ensure safety before execution.",
                inputSchema: {
                    type: "object",
                    properties: {
                        filePath: { type: "string", description: "Path to the file to scan" },
                        mode: { type: "string", enum: ["strict", "advisory"], description: "Validation mode (default: strict)" },
                        sensitivity: { type: "string", enum: ["high", "medium", "low"], description: "Detection sensitivity (default: high)" },
                    },
                    required: ["filePath"],
                },
            },
            {
                name: "scan_repo_for_threats",
                description: "Audit an entire repository for security risks. Multi-threaded regex scanning (no API costs). Automatically skips node_modules, .git, and binary files. Can scan 10k+ files in seconds. Run this before making changes to untrusted repositories.",
                inputSchema: {
                    type: "object",
                    properties: {
                        path: { type: "string", description: "Root path of the repository to scan" },
                        excludePatterns: { type: "array", items: { type: "string" }, description: "Additional glob patterns to exclude (node_modules, .git already excluded)" },
                        mode: { type: "string", enum: ["strict", "advisory"], description: "Validation mode (default: strict)" },
                        sensitivity: { type: "string", enum: ["high", "medium", "low"], description: "Detection sensitivity (default: high)" },
                    },
                    required: ["path"],
                },
            },
        ],
    };
});

// Handle tool calls
server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;

    try {
        if (name === "get_repo_structure") {
            if (!args) throw new Error("Arguments are required");
            const result = await getRepoStructure(
                args.path as string,
                (args.format as 'tree' | 'simple' | 'json') || 'json'
            );
            return {
                content: [{
                    type: "text",
                    text: typeof result === 'string' ? result : JSON.stringify(result, null, 2)
                }],
            };
        }
        else if (name === "analyze_impact") {
            if (!args) throw new Error("Arguments are required");
            const result = await analyzeImpact({
                rootPath: args.path as string,
                filePath: args.filePath as string,
                symbolName: args.symbolName as string,
                line: args.line as number | undefined,
            });
            return {
                content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
            };
        }
        else if (name === "git_branch_status") {
            if (!args) throw new Error("Arguments are required");
            const result = await gitBranchStatus(args.path as string);
            return {
                content: [{ type: "text", text: result.visualization }],
            };
        }
        else if (name === "git_commit_history") {
            if (!args) throw new Error("Arguments are required");
            const result = await gitCommitHistory({
                repoPath: args.path as string,
                maxCount: args.maxCount as number | undefined,
                filePath: args.filePath as string | undefined,
                author: args.author as string | undefined,
                since: args.since as string | undefined,
                until: args.until as string | undefined,
            });
            return {
                content: [{ type: "text", text: result.visualization }],
            };
        }
        else if (name === "git_show_changes") {
            if (!args) throw new Error("Arguments are required");
            const result = await gitShowChanges({
                repoPath: args.path as string,
                includeUntracked: args.includeUntracked as boolean | undefined,
                showDiff: args.showDiff as boolean | undefined,
                filePath: args.filePath as string | undefined,
            });
            return {
                content: [{ type: "text", text: result.visualization + (result.detailedDiff ? "\n\nDETAILED DIFF:\n" + result.detailedDiff : "") }],
            };
        }
        else if (name === "git_compare_branches") {
            if (!args) throw new Error("Arguments are required");
            const result = await gitCompareBranches({
                repoPath: args.path as string,
                branch1: args.branch1 as string,
                branch2: args.branch2 as string,
                showDiff: args.showDiff as boolean | undefined,
            });
            return {
                content: [{ type: "text", text: result.visualization + (result.diff ? "\n\nDETAILED DIFF:\n" + result.diff : "") }],
            };
        }
        else if (name === "git_init") {
            if (!args) throw new Error("Arguments are required");
            const result = await gitInit({
                path: args.path as string,
                initialBranch: args.initialBranch as string | undefined,
                bare: args.bare as boolean | undefined,
            });
            return {
                content: [{ type: "text", text: result.visualization }],
            };
        }
        else if (name === "git_status") {
            if (!args) throw new Error("Arguments are required");
            const result = await gitStatus(args.path as string);
            return {
                content: [{ type: "text", text: result.visualization }],
            };
        }
        else if (name === "refactor_rename") {
            if (!args) throw new Error("Arguments are required");
            const result = await refactorRename({
                repoPath: args.path as string,
                filePath: args.filePath as string,
                symbolName: args.symbolName as string,
                newName: args.newName as string,
                apply: args.apply as boolean | undefined,
            });
            return {
                content: [{ type: "text", text: result.visualization }],
            };
        }
        else if (name === "refactor_extract_function") {
            if (!args) throw new Error("Arguments are required");
            const result = await refactorExtractFunction({
                repoPath: args.path as string,
                filePath: args.filePath as string,
                startLine: args.startLine as number,
                endLine: args.endLine as number,
                functionName: args.functionName as string,
                apply: args.apply as boolean | undefined,
            });
            return {
                content: [{ type: "text", text: result.visualization }],
            };
        }
        else if (name === "refactor_move_to_file") {
            if (!args) throw new Error("Arguments are required");
            const result = await refactorMoveToFile({
                repoPath: args.path as string,
                sourceFile: args.sourceFile as string,
                symbolName: args.symbolName as string,
                targetFile: args.targetFile as string,
                apply: args.apply as boolean | undefined,
            });
            return {
                content: [{ type: "text", text: result.visualization }],
            };
        }
        else if (name === "refactor_inline_variable") {
            if (!args) throw new Error("Arguments are required");
            const result = await refactorInlineVariable({
                repoPath: args.path as string,
                filePath: args.filePath as string,
                variableName: args.variableName as string,
                line: args.line as number,
                apply: args.apply as boolean | undefined,
            });
            return {
                content: [{ type: "text", text: result.visualization }],
            };
        }
        else if (name === "find_dead_code") {
            if (!args) throw new Error("Arguments are required");
            const result = await findDeadCode({
                repoPath: args.path as string,
            });
            return {
                content: [{ type: "text", text: result.visualization }],
            };
        }
        // Security Tool Handlers
        else if (name === "validate_shell_input") {
            if (!args) throw new Error("Arguments are required");
            const result = validateShellInput(
                args.input as string,
                {
                    mode: (args.mode as 'strict' | 'advisory') || 'strict',
                    sensitivity: (args.sensitivity as 'high' | 'medium' | 'low') || 'medium',
                    allowlist: args.allowedCommands ? { commands: args.allowedCommands as string[] } : undefined,
                }
            );
            const viz = createSecurityVisualization("Shell Command Validator", result);
            return {
                content: [{ type: "text", text: viz + "\n" + JSON.stringify(result, null, 2) }],
            };
        }
        else if (name === "validate_sql_query") {
            if (!args) throw new Error("Arguments are required");
            const result = validateSqlQuery(
                args.query as string,
                {
                    mode: (args.mode as 'strict' | 'advisory') || 'strict',
                    sensitivity: (args.sensitivity as 'high' | 'medium' | 'low') || 'medium',
                    allowlist: args.allowedKeywords ? { sql_keywords: args.allowedKeywords as string[] } : undefined,
                }
            );
            const viz = createSecurityVisualization("SQL Injection Detector", result);
            return {
                content: [{ type: "text", text: viz + "\n" + JSON.stringify(result, null, 2) }],
            };
        }
        else if (name === "validate_file_path") {
            if (!args) throw new Error("Arguments are required");
            const result = validateFilePath(
                args.filePath as string,
                args.projectRoot as string | undefined,
                {
                    mode: (args.mode as 'strict' | 'advisory') || 'strict',
                    sensitivity: (args.sensitivity as 'high' | 'medium' | 'low') || 'high',
                }
            );
            const viz = createSecurityVisualization("Path Traversal Validator", result);
            return {
                content: [{ type: "text", text: viz + "\n" + JSON.stringify(result, null, 2) }],
            };
        }
        else if (name === "detect_template_injection") {
            if (!args) throw new Error("Arguments are required");
            const result = detectTemplateInjection(
                args.content as string,
                {
                    mode: (args.mode as 'strict' | 'advisory') || 'strict',
                    sensitivity: (args.sensitivity as 'high' | 'medium' | 'low') || 'high',
                }
            );
            const viz = createSecurityVisualization("Template Injection Detector", result);
            return {
                content: [{ type: "text", text: viz + "\n" + JSON.stringify(result, null, 2) }],
            };
        }
        else if (name === "detect_prompt_injection") {
            if (!args) throw new Error("Arguments are required");
            const result = await detectPromptInjectionAsync(
                args.content as string,
                {
                    mode: (args.mode as 'strict' | 'advisory') || 'strict',
                    sensitivity: (args.sensitivity as 'high' | 'medium' | 'low') || 'high',
                    useGuardModel: args.useGuardModel as boolean | undefined,
                    huggingfaceToken: args.huggingfaceToken as string | undefined,
                }
            );
            const vizTitle = result.llm_guard
                ? "Prompt Injection Detector (LLM Enhanced)"
                : "Prompt Injection Detector";
            const viz = createSecurityVisualization(vizTitle, result);
            return {
                content: [{ type: "text", text: viz + "\n" + JSON.stringify(result, null, 2) }],
            };
        }
        // File and Repo Scanning Handlers
        else if (name === "scan_file_for_threats") {
            if (!args) throw new Error("Arguments are required");
            const filePath = args.filePath as string;
            const content = await fs.readFile(filePath, 'utf-8');
            const result = await scanFileForThreats(
                filePath,
                content,
                {
                    mode: (args.mode as 'strict' | 'advisory') || 'strict',
                    sensitivity: (args.sensitivity as 'high' | 'medium' | 'low') || 'high',
                }
            );
            const status = result.threats_detected ? 'THREATS_FOUND' : 'SAFE';
            const summary = `${result.summary.critical}C ${result.summary.high}H ${result.summary.medium}M ${result.summary.low}L`;
            return {
                content: [{ type: "text", text: `[File Scan] ${status} | ${summary}\n${JSON.stringify(result, null, 2)}` }],
            };
        }
        else if (name === "scan_repo_for_threats") {
            if (!args) throw new Error("Arguments are required");
            const result = await scanRepoForThreats(
                args.path as string,
                (args.excludePatterns as string[]) || [],
                {
                    mode: (args.mode as 'strict' | 'advisory') || 'strict',
                    sensitivity: (args.sensitivity as 'high' | 'medium' | 'low') || 'high',
                }
            );
            const status = result.threats_detected ? 'THREATS_FOUND' : 'SAFE';
            const summary = `${result.files_scanned} files | ${result.files_with_threats} with threats | ${result.summary.critical}C ${result.summary.high}H ${result.summary.medium}M ${result.summary.low}L`;
            return {
                content: [{ type: "text", text: `[Repo Scan] ${status} | ${summary}\n${JSON.stringify(result, null, 2)}` }],
            };
        } else {
            throw new Error(`Unknown tool: ${name}`);
        }
    } catch (error) {
        return {
            content: [
                {
                    type: "text",
                    text: `Error: ${error instanceof Error ? error.message : String(error)}`,
                },
            ],
            isError: true,
        };
    }
});

// Start the server
async function main() {
    const transport = new StdioServerTransport();
    await server.connect(transport);
    console.error("Project Scope MCP Server running on stdio");
}

main().catch((error) => {
    console.error("Fatal error:", error);
    process.exit(1);
});