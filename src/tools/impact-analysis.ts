import * as fs from "fs/promises";
import * as path from "path";
import pkg from "fast-glob";
const { glob } = pkg;
import { detectLanguage, SupportedLanguage } from "../utils/language-detector.js";
import { createParser } from "../parsers/parser-factory.js";
import { findJavaScriptReferences, Reference } from "../parsers/language-parsers/javascript-analyzer.js";
import { findTypeScriptReferences } from "../parsers/language-parsers/typescript-analyzer.js";
import { findPythonReferences } from "../parsers/language-parsers/python-analyzer.js";
import { findJavaReferences } from "../parsers/language-parsers/java-analyzer.js";
import { findGoReferences } from "../parsers/language-parsers/go-analyzer.js";
import { findHTMLReferences } from "../parsers/language-parsers/html-analyzer.js";
import { findCSSReferences } from "../parsers/language-parsers/css-analyzer.js";

interface AnalyzeImpactParams {
    rootPath: string;
    filePath: string;
    symbolName: string;
    line?: number;
}

interface FileImpact {
    filePath: string;
    language: SupportedLanguage;
    references: Reference[];
    referenceCount: number;
}

interface ImpactAnalysisResult {
    symbolName: string;
    sourceFile: string;
    totalReferences: number;
    affectedFiles: number;
    impacts: FileImpact[];
}

// Ignore patterns for impact analysis
const IGNORE_PATTERNS = [
    "**/node_modules/**",
    "**/.git/**",
    "**/dist/**",
    "**/build/**",
    "**/.next/**",
    "**/coverage/**",
    "**/__pycache__/**",
    "**/venv/**",
    "**/target/**",
];

export async function analyzeImpact(
    params: AnalyzeImpactParams
): Promise<ImpactAnalysisResult> {
    const { rootPath, filePath, symbolName, line } = params;

    // Validate paths
    try {
        await fs.access(rootPath);
        await fs.access(path.join(rootPath, filePath));
    } catch {
        throw new Error(`Invalid path: ${rootPath} or ${filePath}`);
    }

    // Detect the language of the source file
    const sourceLanguage = detectLanguage(filePath);

    if (sourceLanguage === "unknown") {
        throw new Error(`Unsupported file type: ${filePath}`);
    }

    // Get all files in the repository with supported extensions
    const supportedExtensions = [
        "**/*.js",
        "**/*.jsx",
        "**/*.mjs",
        "**/*.cjs",
        "**/*.ts",
        "**/*.tsx",
        "**/*.py",
        "**/*.java",
        "**/*.go",
        "**/*.html",
        "**/*.css",
    ];

    const files = await glob(supportedExtensions, {
        cwd: rootPath,
        ignore: IGNORE_PATTERNS,
        absolute: false,
    });

    // Analyze each file for references
    const impacts: FileImpact[] = [];
    let totalReferences = 0;

    for (const file of files) {
        const language = detectLanguage(file);

        if (language === "unknown") {
            continue;
        }

        try {
            const fullPath = path.join(rootPath, file);
            const sourceCode = await fs.readFile(fullPath, "utf-8");

            // Parse the file
            const parser = createParser(language);

            if (!parser) {
                continue;
            }

            const tree = parser.parse(sourceCode);

            // Find references based on language
            let references: Reference[] = [];

            switch (language) {
                case "javascript":
                    references = findJavaScriptReferences(tree, sourceCode, symbolName);
                    break;
                case "typescript":
                    references = findTypeScriptReferences(tree, sourceCode, symbolName);
                    break;
                case "python":
                    references = findPythonReferences(tree, sourceCode, symbolName);
                    break;
                case "java":
                    references = findJavaReferences(tree, sourceCode, symbolName);
                    break;
                case "go":
                    references = findGoReferences(tree, sourceCode, symbolName);
                    break;
                case "html":
                    references = findHTMLReferences(tree, sourceCode, symbolName);
                    break;
                case "css":
                    references = findCSSReferences(tree, sourceCode, symbolName);
                    break;
            }

            // If we found references, add to impacts
            if (references.length > 0) {
                impacts.push({
                    filePath: file,
                    language,
                    references,
                    referenceCount: references.length,
                });

                totalReferences += references.length;
            }
        } catch (error) {
            // Skip files that can't be parsed
            console.error(`Error analyzing ${file}:`, error);
            continue;
        }
    }

    // Sort impacts by reference count (descending)
    impacts.sort((a, b) => b.referenceCount - a.referenceCount);

    return {
        symbolName,
        sourceFile: filePath,
        totalReferences,
        affectedFiles: impacts.length,
        impacts,
    };
}