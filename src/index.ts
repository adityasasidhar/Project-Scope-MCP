#!/usr/bin/env node

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
    ListToolsRequestSchema,
    CallToolRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { getRepoStructure } from "./tools/repo-structure.js";
import { analyzeImpact } from "./tools/impact-analysis.js";
import { gitBranchStatus, gitCommitHistory, gitShowChanges, gitCompareBranches } from "./tools/git-tools.js";

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
                    "Get the complete file structure of a repository, excluding common ignore patterns like node_modules, .git, etc. Supports multiple output formats: 'tree' for visual tree representation, 'simple' for flat list, 'json' for structured data.",
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
                    "Analyze the impact of changing a variable/function name. Returns which files would be affected and the total number of references.",
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
                description: "Show Git branch information including current branch, all branches, and their status. Provides a visual representation of the branch structure.",
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
                description: "Show commit history with optional filtering by file, author, or date range. Provides detailed commit information including hash, author, date, and message.",
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