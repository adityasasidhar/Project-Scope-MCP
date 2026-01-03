import * as fs from "fs/promises";
import * as path from "path";
import pkg from "fast-glob";
const { glob } = pkg;
import { detectLanguage, SupportedLanguage } from "../utils/language-detector.js";
import { createParser } from "../parsers/parser-factory.js";
import Parser from "tree-sitter";

// Ignore patterns
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

// ============================================
// Shared Types
// ============================================

export interface FileChange {
    filePath: string;
    startLine: number;
    endLine: number;
    originalContent: string;
    newContent: string;
}

export interface RefactorResult {
    success: boolean;
    preview: boolean;
    changes: FileChange[];
    summary: string;
    visualization: string;
}

// ============================================
// TOOL 1: Refactor Rename
// ============================================

export interface RefactorRenameParams {
    repoPath: string;
    filePath: string;
    symbolName: string;
    newName: string;
    apply?: boolean;
}

export async function refactorRename(params: RefactorRenameParams): Promise<RefactorResult> {
    const { repoPath, filePath, symbolName, newName, apply = false } = params;

    // Validate new name (basic identifier check)
    if (!/^[a-zA-Z_$][a-zA-Z0-9_$]*$/.test(newName)) {
        throw new Error(`Invalid identifier name: ${newName}`);
    }

    // Find all references
    const changes: FileChange[] = [];
    const supportedExtensions = [
        "**/*.js", "**/*.jsx", "**/*.mjs", "**/*.cjs",
        "**/*.ts", "**/*.tsx",
        "**/*.py",
        "**/*.java",
        "**/*.go",
    ];

    const files = await glob(supportedExtensions, {
        cwd: repoPath,
        ignore: IGNORE_PATTERNS,
        absolute: false,
    });

    for (const file of files) {
        const language = detectLanguage(file);
        if (language === "unknown") continue;

        try {
            const fullPath = path.join(repoPath, file);
            const sourceCode = await fs.readFile(fullPath, "utf-8");
            const parser = createParser(language);
            if (!parser) continue;

            const tree = parser.parse(sourceCode);
            const lines = sourceCode.split("\n");
            const references = findIdentifierReferences(tree, symbolName);

            if (references.length === 0) continue;

            // Group references by line for efficient replacement
            const lineChanges = new Map<number, { col: number; length: number }[]>();
            for (const ref of references) {
                if (!lineChanges.has(ref.line)) {
                    lineChanges.set(ref.line, []);
                }
                lineChanges.get(ref.line)!.push({ col: ref.column, length: symbolName.length });
            }

            // Create changes for each affected line
            for (const [lineNum, cols] of lineChanges) {
                const originalLine = lines[lineNum];
                let newLine = originalLine;

                // Apply replacements from right to left to preserve column positions
                const sortedCols = cols.sort((a, b) => b.col - a.col);
                for (const { col, length } of sortedCols) {
                    newLine = newLine.slice(0, col) + newName + newLine.slice(col + length);
                }

                changes.push({
                    filePath: file,
                    startLine: lineNum + 1,
                    endLine: lineNum + 1,
                    originalContent: originalLine,
                    newContent: newLine,
                });
            }
        } catch (error) {
            continue;
        }
    }

    // Apply changes if requested
    if (apply && changes.length > 0) {
        await applyChanges(repoPath, changes);
    }

    return {
        success: true,
        preview: !apply,
        changes,
        summary: `Found ${changes.length} occurrences of '${symbolName}' to rename to '${newName}'`,
        visualization: createRenameVisualization(symbolName, newName, changes, apply),
    };
}

function findIdentifierReferences(tree: Parser.Tree, symbolName: string): { line: number; column: number }[] {
    const references: { line: number; column: number }[] = [];

    function traverse(node: Parser.SyntaxNode) {
        if (node.type === "identifier" && node.text === symbolName) {
            references.push({
                line: node.startPosition.row,
                column: node.startPosition.column,
            });
        }
        for (let i = 0; i < node.childCount; i++) {
            traverse(node.child(i)!);
        }
    }

    traverse(tree.rootNode);
    return references;
}

function createRenameVisualization(oldName: string, newName: string, changes: FileChange[], applied: boolean): string {
    let viz = "\n REFACTOR RENAME\n";
    viz += "-".repeat(50) + "\n\n";
    viz += `Rename: ${oldName} → ${newName}\n`;
    viz += `Status: ${applied ? "[APPLIED]" : "[PREVIEW]"}\n`;
    viz += `Total changes: ${changes.length}\n\n`;

    // Group by file
    const byFile = new Map<string, FileChange[]>();
    for (const change of changes) {
        if (!byFile.has(change.filePath)) {
            byFile.set(change.filePath, []);
        }
        byFile.get(change.filePath)!.push(change);
    }

    for (const [file, fileChanges] of byFile) {
        viz += `📄 ${file} (${fileChanges.length} changes)\n`;
        for (const change of fileChanges.slice(0, 3)) {
            viz += `   L${change.startLine}: ${change.originalContent.trim()}\n`;
            viz += `       → ${change.newContent.trim()}\n`;
        }
        if (fileChanges.length > 3) {
            viz += `   ... and ${fileChanges.length - 3} more\n`;
        }
        viz += "\n";
    }

    return viz;
}

// ============================================
// TOOL 2: Extract Function
// ============================================

export interface ExtractFunctionParams {
    repoPath: string;
    filePath: string;
    startLine: number;
    endLine: number;
    functionName: string;
    apply?: boolean;
}

export async function refactorExtractFunction(params: ExtractFunctionParams): Promise<RefactorResult> {
    const { repoPath, filePath, startLine, endLine, functionName, apply = false } = params;

    const fullPath = path.join(repoPath, filePath);
    const sourceCode = await fs.readFile(fullPath, "utf-8");
    const lines = sourceCode.split("\n");
    const language = detectLanguage(filePath);

    if (startLine < 1 || endLine > lines.length || startLine > endLine) {
        throw new Error("Invalid line range");
    }

    // Extract the selected lines
    const extractedLines = lines.slice(startLine - 1, endLine);
    const extractedCode = extractedLines.join("\n");

    // Detect indentation
    const baseIndent = extractedLines[0].match(/^(\s*)/)?.[1] || "";

    // Find variables used in the extracted code (simple heuristic)
    const parser = createParser(language);
    if (!parser) throw new Error(`Unsupported language: ${language}`);

    const tree = parser.parse(extractedCode);
    const identifiers = new Set<string>();
    collectIdentifiers(tree.rootNode, identifiers);

    // Generate the new function based on language
    let newFunction: string;
    let functionCall: string;
    const params_list = Array.from(identifiers).slice(0, 5).join(", "); // Limit params

    switch (language) {
        case "python":
            newFunction = `def ${functionName}(${params_list}):\n${extractedLines.map(l => "    " + l.trimStart()).join("\n")}\n`;
            functionCall = `${baseIndent}${functionName}(${params_list})`;
            break;
        case "typescript":
        case "javascript":
            newFunction = `function ${functionName}(${params_list}) {\n${extractedLines.map(l => "    " + l.trimStart()).join("\n")}\n}\n`;
            functionCall = `${baseIndent}${functionName}(${params_list});`;
            break;
        case "go":
            newFunction = `func ${functionName}(${params_list}) {\n${extractedLines.map(l => "\t" + l.trimStart()).join("\n")}\n}\n`;
            functionCall = `${baseIndent}${functionName}(${params_list})`;
            break;
        case "java":
            newFunction = `private void ${functionName}(${params_list}) {\n${extractedLines.map(l => "    " + l.trimStart()).join("\n")}\n}\n`;
            functionCall = `${baseIndent}${functionName}(${params_list});`;
            break;
        default:
            throw new Error(`Extract function not supported for ${language}`);
    }

    // Create the new file content
    const newLines = [...lines];
    newLines.splice(startLine - 1, endLine - startLine + 1, functionCall);

    // Insert the new function at the appropriate place (before the current function or at top)
    const insertPosition = findFunctionInsertPosition(lines, startLine, language);
    newLines.splice(insertPosition, 0, newFunction);

    const changes: FileChange[] = [{
        filePath,
        startLine,
        endLine,
        originalContent: extractedCode,
        newContent: functionCall + "\n\n" + newFunction,
    }];

    if (apply) {
        await fs.writeFile(fullPath, newLines.join("\n"), "utf-8");
    }

    return {
        success: true,
        preview: !apply,
        changes,
        summary: `Extracted ${endLine - startLine + 1} lines into function '${functionName}'`,
        visualization: createExtractVisualization(functionName, extractedCode, newFunction, functionCall, apply),
    };
}

function collectIdentifiers(node: Parser.SyntaxNode, identifiers: Set<string>) {
    if (node.type === "identifier" && node.text.length > 1 && !/^[A-Z]/.test(node.text)) {
        identifiers.add(node.text);
    }
    for (let i = 0; i < node.childCount; i++) {
        collectIdentifiers(node.child(i)!, identifiers);
    }
}

function findFunctionInsertPosition(lines: string[], currentLine: number, language: SupportedLanguage): number {
    // Simple heuristic: insert at the beginning of the file or before the current function
    for (let i = currentLine - 2; i >= 0; i--) {
        const line = lines[i];
        if (language === "python" && /^def\s/.test(line)) return i;
        if ((language === "javascript" || language === "typescript") && /^(function|const|let|var)\s/.test(line)) return i;
        if (language === "go" && /^func\s/.test(line)) return i;
        if (language === "java" && /^\s*(public|private|protected)\s/.test(line)) return i;
    }
    return 0;
}

function createExtractVisualization(name: string, original: string, func: string, call: string, applied: boolean): string {
    let viz = "\n EXTRACT FUNCTION\n";
    viz += "-".repeat(50) + "\n\n";
    viz += `Function name: ${name}\n`;
    viz += `Status: ${applied ? "[APPLIED]" : "[PREVIEW]"}\n\n`;

    viz += "EXTRACTED CODE:\n";
    viz += "```\n" + original.split("\n").slice(0, 5).join("\n");
    if (original.split("\n").length > 5) viz += "\n...";
    viz += "\n```\n\n";

    viz += "NEW FUNCTION:\n";
    viz += "```\n" + func + "```\n\n";

    viz += "CALL SITE:\n";
    viz += "```\n" + call + "\n```\n";

    return viz;
}

// ============================================
// TOOL 3: Move to File
// ============================================

export interface MoveToFileParams {
    repoPath: string;
    sourceFile: string;
    symbolName: string;
    targetFile: string;
    apply?: boolean;
}

export async function refactorMoveToFile(params: MoveToFileParams): Promise<RefactorResult> {
    const { repoPath, sourceFile, symbolName, targetFile, apply = false } = params;

    const sourcePath = path.join(repoPath, sourceFile);
    const targetPath = path.join(repoPath, targetFile);
    const sourceCode = await fs.readFile(sourcePath, "utf-8");
    const language = detectLanguage(sourceFile);

    const parser = createParser(language);
    if (!parser) throw new Error(`Unsupported language: ${language}`);

    const tree = parser.parse(sourceCode);
    const lines = sourceCode.split("\n");

    // Find the function/class definition
    const definition = findDefinition(tree.rootNode, symbolName, language);
    if (!definition) {
        throw new Error(`Could not find definition of '${symbolName}'`);
    }

    const definitionCode = lines.slice(definition.startLine, definition.endLine + 1).join("\n");

    // Create import statement for source file
    const relativePath = getRelativePath(sourceFile, targetFile);
    let importStatement: string;
    let exportStatement: string;

    switch (language) {
        case "javascript":
        case "typescript":
            importStatement = `import { ${symbolName} } from '${relativePath}';\n`;
            exportStatement = `export ${definitionCode}`;
            break;
        case "python":
            importStatement = `from ${relativePath.replace(/\//g, ".").replace(/\.py$/, "")} import ${symbolName}\n`;
            exportStatement = definitionCode;
            break;
        default:
            throw new Error(`Move to file not fully supported for ${language}`);
    }

    // Remove from source, add import
    const newSourceLines = [...lines];
    newSourceLines.splice(definition.startLine, definition.endLine - definition.startLine + 1);

    // Add import at top (after existing imports)
    const importInsertPos = findImportInsertPosition(newSourceLines, language);
    newSourceLines.splice(importInsertPos, 0, importStatement);

    // Add to target file
    let targetCode = "";
    try {
        targetCode = await fs.readFile(targetPath, "utf-8");
    } catch {
        // File doesn't exist, that's ok
    }
    const newTargetCode = targetCode + "\n\n" + exportStatement;

    const changes: FileChange[] = [
        {
            filePath: sourceFile,
            startLine: definition.startLine + 1,
            endLine: definition.endLine + 1,
            originalContent: definitionCode,
            newContent: importStatement,
        },
        {
            filePath: targetFile,
            startLine: 1,
            endLine: 1,
            originalContent: "",
            newContent: exportStatement,
        },
    ];

    if (apply) {
        await fs.writeFile(sourcePath, newSourceLines.join("\n"), "utf-8");
        await fs.writeFile(targetPath, newTargetCode, "utf-8");
    }

    return {
        success: true,
        preview: !apply,
        changes,
        summary: `Moving '${symbolName}' from ${sourceFile} to ${targetFile}`,
        visualization: createMoveVisualization(symbolName, sourceFile, targetFile, importStatement, exportStatement, apply),
    };
}

function findDefinition(node: Parser.SyntaxNode, name: string, language: SupportedLanguage): { startLine: number; endLine: number } | null {
    const funcTypes = ["function_declaration", "function_definition", "method_definition", "arrow_function"];
    const classTypes = ["class_declaration", "class_definition"];

    function traverse(node: Parser.SyntaxNode): { startLine: number; endLine: number } | null {
        if (funcTypes.includes(node.type) || classTypes.includes(node.type)) {
            const nameNode = node.childForFieldName("name");
            if (nameNode?.text === name) {
                return {
                    startLine: node.startPosition.row,
                    endLine: node.endPosition.row,
                };
            }
        }
        for (let i = 0; i < node.childCount; i++) {
            const result = traverse(node.child(i)!);
            if (result) return result;
        }
        return null;
    }

    return traverse(node);
}

function getRelativePath(from: string, to: string): string {
    const fromDir = path.dirname(from);
    let relative = path.relative(fromDir, to);
    if (!relative.startsWith(".")) relative = "./" + relative;
    return relative.replace(/\.(ts|js)$/, "");
}

function findImportInsertPosition(lines: string[], language: SupportedLanguage): number {
    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        if (language === "python" && !line.startsWith("import") && !line.startsWith("from") && line.trim()) {
            return i;
        }
        if ((language === "javascript" || language === "typescript") && !line.startsWith("import") && line.trim()) {
            return i;
        }
    }
    return 0;
}

function createMoveVisualization(symbol: string, from: string, to: string, imp: string, exp: string, applied: boolean): string {
    let viz = "\n MOVE TO FILE\n";
    viz += "-".repeat(50) + "\n\n";
    viz += `Symbol: ${symbol}\n`;
    viz += `From: ${from}\n`;
    viz += `To: ${to}\n`;
    viz += `Status: ${applied ? "[APPLIED]" : "[PREVIEW]"}\n\n`;

    viz += "SOURCE FILE CHANGES:\n";
    viz += `   - Removed ${symbol} definition\n`;
    viz += `   + Added: ${imp.trim()}\n\n`;

    viz += "TARGET FILE:\n";
    viz += `   + Added ${symbol} definition\n`;

    return viz;
}

// ============================================
// TOOL 4: Inline Variable
// ============================================

export interface InlineVariableParams {
    repoPath: string;
    filePath: string;
    variableName: string;
    line: number;
    apply?: boolean;
}

export async function refactorInlineVariable(params: InlineVariableParams): Promise<RefactorResult> {
    const { repoPath, filePath, variableName, line, apply = false } = params;

    const fullPath = path.join(repoPath, filePath);
    const sourceCode = await fs.readFile(fullPath, "utf-8");
    const lines = sourceCode.split("\n");
    const language = detectLanguage(filePath);

    const parser = createParser(language);
    if (!parser) throw new Error(`Unsupported language: ${language}`);

    const tree = parser.parse(sourceCode);

    // Find the variable declaration and its value
    const declaration = findVariableDeclaration(tree.rootNode, variableName, line - 1);
    if (!declaration) {
        throw new Error(`Could not find variable declaration for '${variableName}' at line ${line}`);
    }

    // Find all usages
    const usages = findVariableUsages(tree.rootNode, variableName, line - 1);

    const changes: FileChange[] = [];
    const newLines = [...lines];

    // Replace usages from bottom to top
    for (const usage of usages.sort((a, b) => b.line - a.line)) {
        const originalLine = newLines[usage.line];
        const newLine = originalLine.slice(0, usage.column) + declaration.value + originalLine.slice(usage.column + variableName.length);

        changes.push({
            filePath,
            startLine: usage.line + 1,
            endLine: usage.line + 1,
            originalContent: originalLine,
            newContent: newLine,
        });

        newLines[usage.line] = newLine;
    }

    // Remove the declaration
    changes.push({
        filePath,
        startLine: line,
        endLine: line,
        originalContent: lines[line - 1],
        newContent: "[REMOVED]",
    });
    newLines.splice(line - 1, 1);

    if (apply) {
        await fs.writeFile(fullPath, newLines.join("\n"), "utf-8");
    }

    return {
        success: true,
        preview: !apply,
        changes,
        summary: `Inlined '${variableName}' (value: ${declaration.value}) at ${usages.length} usage sites`,
        visualization: createInlineVisualization(variableName, declaration.value, changes, apply),
    };
}

function findVariableDeclaration(node: Parser.SyntaxNode, name: string, line: number): { value: string } | null {
    function traverse(node: Parser.SyntaxNode): { value: string } | null {
        if (node.startPosition.row === line) {
            if (node.type === "variable_declarator" || node.type === "assignment") {
                const nameNode = node.childForFieldName("name") || node.child(0);
                const valueNode = node.childForFieldName("value") || node.child(2);
                if (nameNode?.text === name && valueNode) {
                    return { value: valueNode.text };
                }
            }
        }
        for (let i = 0; i < node.childCount; i++) {
            const result = traverse(node.child(i)!);
            if (result) return result;
        }
        return null;
    }
    return traverse(node);
}

function findVariableUsages(node: Parser.SyntaxNode, name: string, declarationLine: number): { line: number; column: number }[] {
    const usages: { line: number; column: number }[] = [];

    function traverse(node: Parser.SyntaxNode) {
        if (node.type === "identifier" && node.text === name && node.startPosition.row > declarationLine) {
            usages.push({
                line: node.startPosition.row,
                column: node.startPosition.column,
            });
        }
        for (let i = 0; i < node.childCount; i++) {
            traverse(node.child(i)!);
        }
    }

    traverse(node);
    return usages;
}

function createInlineVisualization(name: string, value: string, changes: FileChange[], applied: boolean): string {
    let viz = "\n INLINE VARIABLE\n";
    viz += "-".repeat(50) + "\n\n";
    viz += `Variable: ${name}\n`;
    viz += `Value: ${value}\n`;
    viz += `Status: ${applied ? "[APPLIED]" : "[PREVIEW]"}\n`;
    viz += `Replacements: ${changes.length - 1}\n\n`;

    for (const change of changes.slice(0, 5)) {
        if (change.newContent === "[REMOVED]") {
            viz += `   [REMOVED] L${change.startLine}: ${change.originalContent.trim()}\n`;
        } else {
            viz += `   L${change.startLine}: ${change.originalContent.trim()}\n`;
            viz += `         → ${change.newContent.trim()}\n`;
        }
    }
    if (changes.length > 5) viz += `   ... and ${changes.length - 5} more\n`;

    return viz;
}

// ============================================
// TOOL 5: Find Dead Code
// ============================================

export interface FindDeadCodeParams {
    repoPath: string;
}

export interface DeadCodeResult {
    deadExports: { file: string; symbol: string; line: number }[];
    totalScanned: number;
    visualization: string;
}

export async function findDeadCode(params: FindDeadCodeParams): Promise<DeadCodeResult> {
    const { repoPath } = params;

    const supportedExtensions = [
        "**/*.js", "**/*.jsx", "**/*.mjs",
        "**/*.ts", "**/*.tsx",
    ];

    const files = await glob(supportedExtensions, {
        cwd: repoPath,
        ignore: IGNORE_PATTERNS,
        absolute: false,
    });

    // Collect all exports
    const exports: { file: string; symbol: string; line: number }[] = [];
    // Collect all imports
    const imports = new Set<string>();

    for (const file of files) {
        const language = detectLanguage(file);
        if (language !== "javascript" && language !== "typescript") continue;

        try {
            const fullPath = path.join(repoPath, file);
            const sourceCode = await fs.readFile(fullPath, "utf-8");
            const parser = createParser(language);
            if (!parser) continue;

            const tree = parser.parse(sourceCode);

            // Find exports
            findExports(tree.rootNode, file, exports);

            // Find imports
            findImports(tree.rootNode, imports);
        } catch {
            continue;
        }
    }

    // Find dead exports (exported but never imported)
    const deadExports = exports.filter(exp => !imports.has(exp.symbol));

    // Filter out common false positives
    const filteredDead = deadExports.filter(exp => {
        // Keep if not a lifecycle method or main export
        const ignoredNames = ["default", "main", "init", "setup", "configure", "App", "index"];
        return !ignoredNames.includes(exp.symbol);
    });

    return {
        deadExports: filteredDead,
        totalScanned: files.length,
        visualization: createDeadCodeVisualization(filteredDead, files.length, exports.length),
    };
}

function findExports(node: Parser.SyntaxNode, file: string, exports: { file: string; symbol: string; line: number }[]) {
    if (node.type === "export_statement") {
        const declaration = node.childForFieldName("declaration");
        if (declaration) {
            const nameNode = declaration.childForFieldName("name");
            if (nameNode) {
                exports.push({
                    file,
                    symbol: nameNode.text,
                    line: node.startPosition.row + 1,
                });
            }
        }
        // Named exports
        const specifiers = node.descendantsOfType("export_specifier");
        for (const spec of specifiers) {
            const name = spec.childForFieldName("name") || spec.child(0);
            if (name) {
                exports.push({
                    file,
                    symbol: name.text,
                    line: node.startPosition.row + 1,
                });
            }
        }
    }

    for (let i = 0; i < node.childCount; i++) {
        findExports(node.child(i)!, file, exports);
    }
}

function findImports(node: Parser.SyntaxNode, imports: Set<string>) {
    if (node.type === "import_statement") {
        const specifiers = node.descendantsOfType("import_specifier");
        for (const spec of specifiers) {
            const name = spec.childForFieldName("name") || spec.child(0);
            if (name) imports.add(name.text);
        }
        // Default import
        const defaultImport = node.descendantsOfType("identifier").find(n =>
            n.parent?.type === "import_clause"
        );
        if (defaultImport) imports.add(defaultImport.text);
    }

    for (let i = 0; i < node.childCount; i++) {
        findImports(node.child(i)!, imports);
    }
}

function createDeadCodeVisualization(dead: { file: string; symbol: string; line: number }[], totalFiles: number, totalExports: number): string {
    let viz = "\n DEAD CODE ANALYSIS\n";
    viz += "-".repeat(50) + "\n\n";
    viz += `Files scanned: ${totalFiles}\n`;
    viz += `Exports found: ${totalExports}\n`;
    viz += `Potentially unused: ${dead.length}\n\n`;

    if (dead.length === 0) {
        viz += "[Clean] No obviously dead exports found.\n";
    } else {
        viz += "POTENTIALLY UNUSED EXPORTS:\n\n";

        // Group by file
        const byFile = new Map<string, typeof dead>();
        for (const d of dead) {
            if (!byFile.has(d.file)) byFile.set(d.file, []);
            byFile.get(d.file)!.push(d);
        }

        for (const [file, symbols] of byFile) {
            viz += `📄 ${file}\n`;
            for (const sym of symbols) {
                viz += `   L${sym.line}: ${sym.symbol}\n`;
            }
            viz += "\n";
        }

        viz += "\n> [!NOTE]\n";
        viz += "> These exports may be used dynamically or externally.\n";
        viz += "> Review before removing.\n";
    }

    return viz;
}

// ============================================
// Shared Utilities
// ============================================

async function applyChanges(repoPath: string, changes: FileChange[]): Promise<void> {
    // Group changes by file
    const byFile = new Map<string, FileChange[]>();
    for (const change of changes) {
        if (!byFile.has(change.filePath)) {
            byFile.set(change.filePath, []);
        }
        byFile.get(change.filePath)!.push(change);
    }

    for (const [file, fileChanges] of byFile) {
        const fullPath = path.join(repoPath, file);
        const sourceCode = await fs.readFile(fullPath, "utf-8");
        const lines = sourceCode.split("\n");

        // Sort changes by line number (descending) to preserve line numbers
        const sortedChanges = fileChanges.sort((a, b) => b.startLine - a.startLine);

        for (const change of sortedChanges) {
            lines[change.startLine - 1] = change.newContent;
        }

        await fs.writeFile(fullPath, lines.join("\n"), "utf-8");
    }
}
