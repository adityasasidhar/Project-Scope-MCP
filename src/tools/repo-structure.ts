import pkg from "fast-glob";
const { glob } = pkg;
import * as path from "path";
import * as fs from "fs/promises";

export interface FileNode {
    name: string;
    type: "file" | "directory";
    path: string;
    children?: FileNode[];
    size?: number;
}

interface RepoStructure {
    root: string;
    tree: FileNode;
    totalFiles: number;
    totalDirectories: number;
    format: string;
}

type OutputFormat = 'tree' | 'simple' | 'json';

// Common patterns to ignore (LLM is aware of these)
const DEFAULT_IGNORE_PATTERNS = [
    "**/node_modules/**",
    "**/.git/**",
    "**/dist/**",
    "**/build/**",
    "**/.next/**",
    "**/.nuxt/**",
    "**/coverage/**",
    "**/__pycache__/**",
    "**/*.pyc",
    "**/venv/**",
    "**/env/**",
    "**/.venv/**",
    "**/target/**", // Java/Rust build output
    "**/bin/**",
    "**/obj/**",
    "**/.idea/**",
    "**/.vscode/**",
    "**/.DS_Store",
    "**/Thumbs.db",
    "**/*.log",
    "**/tmp/**",
    "**/temp/**",
];

export async function getRepoStructure(
    rootPath: string,
    format: OutputFormat = 'json'
): Promise<string | RepoStructure> {
    // Validate path exists
    try {
        await fs.access(rootPath);
    } catch {
        throw new Error(`Path does not exist: ${rootPath}`);
    }

    // Get all files and directories
    const entries = await glob("**/*", {
        cwd: rootPath,
        ignore: DEFAULT_IGNORE_PATTERNS,
        dot: true, // Include hidden files (but .git is already ignored)
        markDirectories: true,
        onlyFiles: false,
    });

    // Build the tree structure
    const tree = await buildTree(rootPath, entries);

    // Count files and directories
    const stats = countNodes(tree);

    const repoStructure: RepoStructure = {
        root: rootPath,
        tree,
        totalFiles: stats.files,
        totalDirectories: stats.directories,
        format,
    };

    // Return based on format
    switch (format) {
        case 'tree':
            return formatAsTree(repoStructure);
        case 'simple':
            return formatAsSimpleList(entries, repoStructure);
        case 'json':
        default:
            return repoStructure;
    }
}

function formatAsTree(structure: RepoStructure): string {
    let output = `[Dir] ${structure.root}\n`;
    output += `Total: ${structure.totalFiles} files, ${structure.totalDirectories} directories\n\n`;

    function printNode(node: FileNode, prefix: string = '', isLast: boolean = true): string {
        let result = '';
        const connector = isLast ? 'L-- ' : '|-- ';
        const icon = node.type === 'directory' ? '[Dir]' : '[File]';
        const sizeInfo = node.size ? ` (${formatBytes(node.size)})` : '';

        result += `${prefix}${connector}${icon} ${node.name}${sizeInfo}\n`;

        if (node.children && node.children.length > 0) {
            const newPrefix = prefix + (isLast ? '    ' : '|   ');
            node.children.forEach((child, index) => {
                const childIsLast = index === node.children!.length - 1;
                result += printNode(child, newPrefix, childIsLast);
            });
        }

        return result;
    }

    if (structure.tree.children) {
        structure.tree.children.forEach((child, index) => {
            const isLast = index === structure.tree.children!.length - 1;
            output += printNode(child, '', isLast);
        });
    }

    return output;
}

function formatAsSimpleList(entries: string[], structure: RepoStructure): string {
    let output = `Repository: ${structure.root}\n`;
    output += `Total: ${structure.totalFiles} files, ${structure.totalDirectories} directories\n\n`;
    output += 'Files and Directories:\n';
    output += entries.sort().map(entry => `  ${entry}`).join('\n');
    return output;
}

function formatBytes(bytes: number): string {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return Math.round(bytes / Math.pow(k, i) * 100) / 100 + ' ' + sizes[i];
}

async function buildTree(
    rootPath: string,
    entries: string[]
): Promise<FileNode> {
    const root: FileNode = {
        name: path.basename(rootPath) || rootPath,
        type: "directory",
        path: "",
        children: [],
    };

    // Sort entries to process directories before files
    const sortedEntries = entries.sort();

    for (const entry of sortedEntries) {
        const parts = entry.split(path.sep);
        let currentNode = root;

        for (let i = 0; i < parts.length; i++) {
            const part = parts[i];
            const isLast = i === parts.length - 1;
            const currentPath = parts.slice(0, i + 1).join(path.sep);

            // Check if this part already exists in children
            let childNode = currentNode.children?.find((child) => child.name === part);

            if (!childNode) {
                // Determine if it's a file or directory
                const isDirectory = entry.endsWith("/") || !isLast;

                childNode = {
                    name: part,
                    type: isDirectory ? "directory" : "file",
                    path: currentPath,
                };

                if (isDirectory) {
                    childNode.children = [];
                } else {
                    // Get file size
                    try {
                        const fullPath = path.join(rootPath, currentPath);
                        const stats = await fs.stat(fullPath);
                        childNode.size = stats.size;
                    } catch {
                        // If we can't get size, just skip it
                    }
                }

                currentNode.children?.push(childNode);
            }

            if (childNode.type === "directory") {
                currentNode = childNode;
            }
        }
    }

    // Sort children: directories first, then files, both alphabetically
    sortChildren(root);

    return root;
}

function sortChildren(node: FileNode): void {
    if (!node.children) return;

    node.children.sort((a, b) => {
        // Directories before files
        if (a.type !== b.type) {
            return a.type === "directory" ? -1 : 1;
        }
        // Alphabetically
        return a.name.localeCompare(b.name);
    });

    // Recursively sort children
    node.children.forEach(sortChildren);
}

function countNodes(node: FileNode): { files: number; directories: number } {
    let files = 0;
    let directories = 0;

    if (node.type === "file") {
        files = 1;
    } else if (node.type === "directory") {
        directories = 1;
        if (node.children) {
            for (const child of node.children) {
                const childStats = countNodes(child);
                files += childStats.files;
                directories += childStats.directories;
            }
        }
    }

    return { files, directories };
}