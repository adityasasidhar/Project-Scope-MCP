import * as path from "path";

export type SupportedLanguage =
    | "javascript"
    | "typescript"
    | "python"
    | "java"
    | "go"
    | "html"
    | "css"
    | "unknown";

export function detectLanguage(filePath: string): SupportedLanguage {
    const ext = path.extname(filePath).toLowerCase();

    const extensionMap: Record<string, SupportedLanguage> = {
        ".js": "javascript",
        ".jsx": "javascript",
        ".mjs": "javascript",
        ".cjs": "javascript",
        ".ts": "typescript",
        ".tsx": "typescript",
        ".py": "python",
        ".pyw": "python",
        ".java": "java",
        ".go": "go",
        ".html": "html",
        ".htm": "html",
        ".css": "css",
    };

    return extensionMap[ext] || "unknown";
}