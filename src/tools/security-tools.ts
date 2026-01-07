/**
 * MCP Security Tools
 * 
 * Security validation tools to protect coding agents from injection attacks,
 * malicious dependencies, and tool exploitation based on real 2025 attack patterns.
 */

import * as path from "path";
import * as fs from "fs/promises";
import { InferenceClient } from "@huggingface/inference";
import pkg from "fast-glob";
const { glob } = pkg;

// ============================================
// Shared Types & Configuration
// ============================================

export interface SecurityConfig {
    mode: 'strict' | 'advisory';
    projectRoot?: string;
    allowlist?: {
        commands?: string[];
        paths?: string[];
        sql_keywords?: string[];
    };
    sensitivity: 'high' | 'medium' | 'low';
    // LLM-based detection options
    huggingfaceToken?: string;
    useGuardModel?: boolean;
}

const DEFAULT_CONFIG: SecurityConfig = {
    mode: 'strict',
    sensitivity: 'medium',
};

type RiskLevel = 'critical' | 'high' | 'medium' | 'low';

// ============================================
// Context Detection for Smart Scanning
// ============================================

export interface ScanContext {
    fileType: 'source' | 'template' | 'config' | 'runtime' | 'unknown';
    language?: string;
    shouldScanForPatterns: boolean;
    shouldScanStrings: boolean;
    filePath?: string;
}

// Source code extensions where patterns are expected (don't scan)
const SOURCE_CODE_EXTENSIONS = new Set([
    'ts', 'tsx', 'js', 'jsx', 'mjs', 'cjs',
    'py', 'pyi', 'java', 'go', 'rs',
    'c', 'cpp', 'cc', 'cxx', 'h', 'hpp',
    'cs', 'rb', 'php', 'swift', 'kt', 'scala',
    'm', 'mm', 'r', 'jl', 'nim'
]);

// Template file extensions (scan carefully, context-aware)
const TEMPLATE_EXTENSIONS = new Set([
    'hbs', 'handlebars', 'jinja', 'jinja2', 'j2',
    'erb', 'ejs', 'pug', 'jade', 'twig',
    'mustache', 'liquid', 'eta'
]);

// Config file extensions (limited scanning)
const CONFIG_EXTENSIONS = new Set([
    'json', 'yaml', 'yml', 'toml', 'ini',
    'env', 'config', 'conf', 'xml'
]);

/**
 * Detect file context from file path
 */
function detectFileContext(filePath: string): ScanContext {
    const ext = path.extname(filePath).slice(1).toLowerCase();
    const basename = path.basename(filePath).toLowerCase();

    // Detect source code files
    if (SOURCE_CODE_EXTENSIONS.has(ext)) {
        return {
            fileType: 'source',
            language: ext,
            shouldScanForPatterns: false, // Don't scan source code!
            shouldScanStrings: false,
            filePath
        };
    }

    // Detect template files
    if (TEMPLATE_EXTENSIONS.has(ext)) {
        return {
            fileType: 'template',
            language: ext,
            shouldScanForPatterns: true,
            shouldScanStrings: false, // Templates have expected syntax
            filePath
        };
    }

    // Detect config files - very limited scanning
    if (CONFIG_EXTENSIONS.has(ext) || basename.includes('config')) {
        return {
            fileType: 'config',
            shouldScanForPatterns: false, // Config files have legitimate special chars
            shouldScanStrings: true,      // But do scan string values
            filePath
        };
    }

    // Runtime input or unknown - scan everything
    return {
        fileType: 'runtime',
        shouldScanForPatterns: true,
        shouldScanStrings: true,
        filePath
    };
}

/**
 * Check if a line is a comment
 */
function isCommentLine(line: string): boolean {
    const trimmed = line.trim();
    if (!trimmed) return false;

    // Single-line comments
    if (trimmed.startsWith('//') ||
        trimmed.startsWith('#') ||
        trimmed.startsWith('*') ||
        trimmed === '/**' ||
        trimmed === '*/') {
        return true;
    }

    // SQL comments
    if (trimmed.startsWith('--')) {
        return true;
    }

    // Multi-line comment markers
    if (trimmed.startsWith('/*') || trimmed.endsWith('*/')) {
        return true;
    }

    return false;
}

/**
 * Check if line contains import/export statement
 */
function isImportExport(line: string): boolean {
    const trimmed = line.trim();
    return trimmed.startsWith('import ') ||
        trimmed.startsWith('export ') ||
        trimmed.startsWith('from ') ||
        trimmed.startsWith('require(');
}

/**
 * Check if line is a type/interface definition
 */
function isTypeDefinition(line: string): boolean {
    const trimmed = line.trim();
    return trimmed.startsWith('interface ') ||
        trimmed.startsWith('type ') ||
        trimmed.startsWith('enum ') ||
        trimmed.startsWith('class ') ||
        trimmed.includes(': {') ||
        /^(public|private|protected)\s/.test(trimmed);
}

// ============================================
// Cached Regex Patterns (compiled once for performance)
// ============================================

// Shell injection patterns
const SHELL_PATTERNS = {
    metacharacters: /[;|&`$()<>]/,
    commandSubstitution: /\$\([^)]+\)|`[^`]+`/,
    envVariable: /\$\{[^}]+\}/,
    escapedChars: /\\[;|&`]/,
    nullByte: /\x00|%00/i,
    newlines: /[\n\r]/,
    pipeChain: /\|{1,2}/,
    andOr: /&&|\|\|/,
    redirects: />>{1,2}|<<{1,2}/,
    subshell: /\(\s*[^)]+\s*\)/,
    backgroundExec: /&\s*$/,
    // Advanced patterns
    processSubstitution: /<\([^)]+\)|>\([^)]+\)/,
    hereDoc: /<<-?\s*['"]?\w+['"]?/,
    braceExpansion: /\{[^}]*,[^}]*\}|\{\.\.|\.\.\}/,
    arithmeticExpansion: /\$\(\([^)]+\)\)/,
    commandGrouping: /\{\s*[^}]+;\s*\}/,
    globbing: /\*{2,}|\/\*|[?*\[\]]/,
    tilde: /~[a-z_][a-z0-9_-]*/i,
};

// SQL injection patterns
const SQL_PATTERNS = {
    classicInjection: /'(\s*OR\s*'[^']*'\s*=\s*'[^']*'|\s*OR\s+\d+\s*=\s*\d+)/i,
    unionBased: /UNION\s+(ALL\s+)?SELECT/i,
    stackedQueries: /;\s*(DROP|DELETE|INSERT|UPDATE|TRUNCATE|ALTER|CREATE|EXEC)/i,
    commentInjection: /--|\/\*|#|;%00/,
    timeBased: /WAITFOR\s+DELAY|SLEEP\s*\(|BENCHMARK\s*\(/i,
    booleanBased: /\s+AND\s+\d+\s*=\s*\d+|\s+OR\s+'[^']*'\s*=\s*'[^']*'/i,
    hexEncoding: /0x[0-9a-fA-F]+|CHAR\s*\(|HEX\s*\(/i,
    outOfBand: /xp_cmdshell|LOAD_FILE\s*\(|INTO\s+OUTFILE|INTO\s+DUMPFILE/i,
    adminComment: /admin\s*'?\s*--/i,
    tautology: /'?\s*=\s*'|1\s*=\s*1|'a'\s*=\s*'a'/i,
    // Advanced patterns
    nosqlOperators: /\$where|\$ne|\$gt|\$lt|\$regex|\$in|\$nin|\$exists/i,
    nosqlInjection: /\{\s*\$(?:where|ne|gt|lt|regex|in|nin)\s*:/i,
    xmlInjection: /extractvalue\s*\(|updatexml\s*\(|xmltype\s*\(/i,
    polyglot: /<script>|<img\s+src=|javascript:|onerror\s*=/i,
    secondOrder: /INSERT\s+INTO.*VALUES.*['"].*[<>{}]/i,
    ormBypass: /findOne\s*\(|find\s*\(\s*\{|\$or\s*:\s*\[/i,
    mssqlSpecific: /xp_|sp_|master\.\.|sysobjects|syscolumns/i,
    postgresSpecific: /pg_sleep\s*\(|pg_read_file\s*\(/i,
};

// Path traversal patterns
const PATH_PATTERNS = {
    basicTraversal: /\.\.[\\/]/,
    doubleTraversal: /\.\.\.\.\/\//,
    urlEncoded: /%2e%2e[%2f%5c]/i,
    doubleUrlEncoded: /%252e%252e%252f/i,
    unicode: /\.\.%c0%af|\.\.%c1%9c/i,
    nullByte: /%00|\x00/,
    uncPath: /^\\\\[^\\]+\\|^\/\/[^/]+\//,
    mixedSeparators: /\.\.\\\/|\.\.\/\\/,
    absoluteLinux: /^\/(?:etc|proc|sys|dev|root|home|usr|var|tmp)(?:\/|$)/i,
    absoluteWindows: /^[A-Za-z]:\\(?:Windows|Program Files|Users|System32)/i,
    // Advanced patterns
    windowsShortName: /~\d+|PROGRA~1|SYSTEM~1/i,
    caseVariation: /\.\.[%]5[Cc]/,
    longPath: /.{261,}/,
    wildcardTraversal: /\.\.[\\/]\*[\\/]\.\./,
};

// Template injection patterns
const TEMPLATE_PATTERNS = {
    jinja2: /\{\{[^}]*\}\}|\{%[^%]*%\}/,
    jinjaConfig: /\{\{\s*config\s*\}\}|\{\{\s*request\s*\}\}|\{\{\s*self\s*\}\}/i,
    jinjaMath: /\{\{\s*\d+\s*\*\s*\d+\s*\}\}/,
    handlebars: /\{\{\{[^}]*\}\}\}|\{\{#[^}]+\}\}/,
    erb: /<% [=-]?[^%]*%>/,
    freemarker: /\$\{[^}]+\}|<#[^>]+>/,
    velocity: /#set\s*\(|#foreach\s*\(/,
    thymeleaf: /\[\[\$\{|\*\{[^}]+\}/,
    pug: /#\{[^}]+\}|=\s+[^;]+/,
    ssti: /__class__|__mro__|__globals__|__builtins__|__import__|getattr|popen/,
    evalExpr: /eval\s*\(|exec\s*\(|compile\s*\(/,
    // Advanced patterns
    pythonFormat: /\{0\.__class__|\{\w+\.__/,
    twigSyntax: /\{\{\s*_self\s*\}\}|\{\{\s*_context\s*\}\}/i,
    smarty: /\{php\}|\{literal\}|\{\$smarty/i,
    jspJstl: /<c:out|<jsp:|\$\{param\./i,
    angularjs: /\{\{constructor\.constructor|\{\{\[]['"]/,
};

// Prompt injection patterns
const PROMPT_PATTERNS = {
    roleSwitching: /you\s+are\s+now|act\s+as|pretend\s+(you\s+are|to\s+be)|imagine\s+you\s+are|roleplay\s+as/i,
    instructionOverride: /ignore\s+(all\s+)?previous|forget\s+(all\s+)?(above|instructions)|disregard\s+(all|everything)/i,
    contextEscape: /\n{3,}|---{2,}|#{3,}\s*$/,
    newInstructions: /^(new\s+task|system|assistant|human|user)\s*:|<\|[^|]+\|>/im,
    payloadMarkers: /\[INST\]|<\|endoftext\|>|<\/s>|<\|im_start\|>|<\|im_end\|>/,
    invisibleChars: /[\u200B-\u200F\u2028-\u2029\u202A-\u202E\uFEFF]/,
    dataExfiltration: /send\s+(this\s+)?(to|via)|email\s+this|post\s+to|upload\s+to|webhook/i,
    toolManipulation: /use\s+tool|execute|run\s+command|call\s+function|invoke/i,
    memoryPoisoning: /remember\s+that|always\s+respond\s+with|from\s+now\s+on/i,
    developerMode: /developer\s+mode|jailbreak|DAN|do\s+anything\s+now/i,
    base64Pattern: /[A-Za-z0-9+\/]{20,}={0,2}/,
    rot13Pattern: /[A-Za-z]{10,}\s+[A-Za-z]{10,}/,
    unicodeEscape: /\\u[0-9a-fA-F]{4}|\\x[0-9a-fA-F]{2}/,
    multilingualBypass: /[\u4E00-\u9FFF\uAC00-\uD7AF\u0400-\u04FF]{3,}/,
    tokenSmuggling: /(\w+\s*){20,}/,
    systemExtraction: /repeat\s+your\s+(instructions|prompt|system)|what\s+(are|were)\s+your\s+instructions/i,
    cotManipulation: /let'?s\s+think\s+step\s+by\s+step.*?(ignore|disregard)/i,
};

// ============================================
// TOOL 1: Shell Command Validator
// ============================================

export interface ShellValidationResult {
    safe: boolean;
    threats_found: string[];
    sanitized_input: string | null;
    risk_level: RiskLevel;
}

export function validateShellInput(
    input: string,
    config: Partial<SecurityConfig> = {}
): ShellValidationResult {
    const cfg = { ...DEFAULT_CONFIG, ...config };
    const threats: string[] = [];

    if (!input || typeof input !== 'string') {
        return { safe: true, threats_found: [], sanitized_input: input || null, risk_level: 'low' };
    }

    // Check for null byte injection
    if (SHELL_PATTERNS.nullByte.test(input)) {
        threats.push('null_byte_injection');
    }

    // Check for command substitution
    if (SHELL_PATTERNS.commandSubstitution.test(input)) {
        threats.push('command_substitution');
    }

    // Check for environment variable manipulation
    if (SHELL_PATTERNS.envVariable.test(input)) {
        threats.push('environment_variable_manipulation');
    }

    // Check for escaped metacharacters
    if (SHELL_PATTERNS.escapedChars.test(input)) {
        threats.push('escaped_metacharacter');
    }

    // Check for pipe operators
    if (SHELL_PATTERNS.pipeChain.test(input)) {
        threats.push('pipe_operator');
    }

    // Check for && or ||
    if (SHELL_PATTERNS.andOr.test(input)) {
        threats.push('command_chaining');
    }

    // Check for redirects
    if (SHELL_PATTERNS.redirects.test(input)) {
        threats.push('output_redirect');
    }

    // Check for subshell
    if (SHELL_PATTERNS.subshell.test(input)) {
        threats.push('subshell_execution');
    }

    // Check for semicolon (command separator)
    if (input.includes(';')) {
        threats.push('command_separator');
    }

    // Check for backticks (legacy command substitution)
    if (input.includes('`')) {
        threats.push('backtick_substitution');
    }

    // Check for newlines
    if (SHELL_PATTERNS.newlines.test(input)) {
        threats.push('newline_injection');
    }

    // Check for background execution
    if (SHELL_PATTERNS.backgroundExec.test(input)) {
        threats.push('background_execution');
    }

    // Check for process substitution
    if (SHELL_PATTERNS.processSubstitution.test(input)) {
        threats.push('process_substitution');
    }

    // Check for here-documents
    if (SHELL_PATTERNS.hereDoc.test(input)) {
        threats.push('here_document');
    }

    // Check for brace expansion
    if (SHELL_PATTERNS.braceExpansion.test(input)) {
        threats.push('brace_expansion');
    }

    // Check for arithmetic expansion
    if (SHELL_PATTERNS.arithmeticExpansion.test(input)) {
        threats.push('arithmetic_expansion');
    }

    // Check for command grouping
    if (SHELL_PATTERNS.commandGrouping.test(input)) {
        threats.push('command_grouping');
    }

    // Check for globbing patterns
    if (SHELL_PATTERNS.globbing.test(input)) {
        threats.push('globbing_pattern');
    }

    // Check for tilde expansion
    if (SHELL_PATTERNS.tilde.test(input)) {
        threats.push('tilde_expansion');
    }

    // Check allowlist if in advisory mode
    if (cfg.mode === 'advisory' && cfg.allowlist?.commands) {
        const command = input.split(/\s+/)[0];
        if (cfg.allowlist.commands.includes(command)) {
            // Reduce threat level for allowlisted commands
            threats.length = 0; // Clear threats for allowlisted
        }
    }

    // Attempt sanitization
    let sanitized: string | null = null;
    if (threats.length > 0 && cfg.mode === 'advisory') {
        sanitized = input
            .replace(/[;|&`$()<>\n\r]/g, '')
            .replace(/\$\{[^}]+\}/g, '')
            .replace(/\$\([^)]+\)/g, '');
    }

    // Calculate risk level
    let riskLevel: RiskLevel = 'low';
    if (threats.length > 0) {
        if (threats.includes('null_byte_injection') || threats.includes('command_substitution')) {
            riskLevel = 'high';
        } else if (threats.length >= 2) {
            riskLevel = 'high';
        } else {
            riskLevel = 'medium';
        }
    }

    return {
        safe: threats.length === 0,
        threats_found: threats,
        sanitized_input: threats.length > 0 ? sanitized : input,
        risk_level: riskLevel,
    };
}

// ============================================
// TOOL 2: SQL Injection Detector
// ============================================

export interface SqlValidationResult {
    safe: boolean;
    injection_type: string[];
    suspicious_keywords: string[];
    risk_level: RiskLevel;
}

export function validateSqlQuery(
    query: string,
    config: Partial<SecurityConfig> = {}
): SqlValidationResult {
    const cfg = { ...DEFAULT_CONFIG, ...config };
    const injectionTypes: string[] = [];
    const suspiciousKeywords: string[] = [];

    if (!query || typeof query !== 'string') {
        return { safe: true, injection_type: [], suspicious_keywords: [], risk_level: 'low' };
    }

    const upperQuery = query.toUpperCase();

    // Check for classic injection
    if (SQL_PATTERNS.classicInjection.test(query)) {
        injectionTypes.push('classic_injection');
    }

    // Check for tautology
    if (SQL_PATTERNS.tautology.test(query)) {
        injectionTypes.push('tautology');
    }

    // Check for admin comment bypass
    if (SQL_PATTERNS.adminComment.test(query)) {
        injectionTypes.push('comment_bypass');
        suspiciousKeywords.push('admin--');
    }

    // Check for union-based injection
    if (SQL_PATTERNS.unionBased.test(query)) {
        injectionTypes.push('union_based');
        suspiciousKeywords.push('UNION SELECT');
    }

    // Check for stacked queries
    if (SQL_PATTERNS.stackedQueries.test(query)) {
        injectionTypes.push('stacked_queries');
        const dangerousKeywords = ['DROP', 'DELETE', 'INSERT', 'UPDATE', 'TRUNCATE', 'ALTER', 'CREATE', 'EXEC'];
        dangerousKeywords.forEach(kw => {
            if (upperQuery.includes(kw)) suspiciousKeywords.push(kw);
        });
    }

    // Check for comment injection
    if (SQL_PATTERNS.commentInjection.test(query)) {
        injectionTypes.push('comment_injection');
        if (query.includes('--')) suspiciousKeywords.push('--');
        if (query.includes('/*')) suspiciousKeywords.push('/*');
        if (query.includes('#')) suspiciousKeywords.push('#');
    }

    // Check for time-based blind injection
    if (SQL_PATTERNS.timeBased.test(query)) {
        injectionTypes.push('time_based_blind');
        if (upperQuery.includes('WAITFOR')) suspiciousKeywords.push('WAITFOR DELAY');
        if (upperQuery.includes('SLEEP')) suspiciousKeywords.push('SLEEP()');
        if (upperQuery.includes('BENCHMARK')) suspiciousKeywords.push('BENCHMARK()');
    }

    // Check for boolean-based blind injection
    if (SQL_PATTERNS.booleanBased.test(query)) {
        injectionTypes.push('boolean_based_blind');
    }

    // Check for hex encoding tricks
    if (SQL_PATTERNS.hexEncoding.test(query)) {
        injectionTypes.push('encoding_evasion');
        if (upperQuery.includes('CHAR')) suspiciousKeywords.push('CHAR()');
        if (upperQuery.includes('HEX')) suspiciousKeywords.push('HEX()');
        if (/0x[0-9a-fA-F]+/.test(query)) suspiciousKeywords.push('0x notation');
    }

    // Check for out-of-band attacks
    if (SQL_PATTERNS.outOfBand.test(query)) {
        injectionTypes.push('out_of_band');
        if (upperQuery.includes('XP_CMDSHELL')) suspiciousKeywords.push('xp_cmdshell');
        if (upperQuery.includes('LOAD_FILE')) suspiciousKeywords.push('LOAD_FILE()');
    }

    // Check for NoSQL injection
    if (SQL_PATTERNS.nosqlOperators.test(query) || SQL_PATTERNS.nosqlInjection.test(query)) {
        injectionTypes.push('nosql_injection');
        suspiciousKeywords.push('$operator');
    }

    // Check for XML injection
    if (SQL_PATTERNS.xmlInjection.test(query)) {
        injectionTypes.push('xml_injection');
        if (upperQuery.includes('EXTRACTVALUE')) suspiciousKeywords.push('extractvalue()');
        if (upperQuery.includes('UPDATEXML')) suspiciousKeywords.push('updatexml()');
    }

    // Check for polyglot payloads
    if (SQL_PATTERNS.polyglot.test(query)) {
        injectionTypes.push('polyglot_sqli_xss');
        suspiciousKeywords.push('<script>');
    }

    // Check for second-order injection markers
    if (SQL_PATTERNS.secondOrder.test(query)) {
        injectionTypes.push('second_order_marker');
    }

    // Check for ORM bypass patterns
    if (SQL_PATTERNS.ormBypass.test(query)) {
        injectionTypes.push('orm_bypass');
    }

    // Check for database-specific vectors
    if (SQL_PATTERNS.mssqlSpecific.test(query)) {
        injectionTypes.push('mssql_specific');
        suspiciousKeywords.push('xp_/sp_');
    }

    if (SQL_PATTERNS.postgresSpecific.test(query)) {
        injectionTypes.push('postgres_specific');
        suspiciousKeywords.push('pg_sleep');
    }

    // Apply allowlist filtering
    if (cfg.allowlist?.sql_keywords && cfg.mode === 'advisory') {
        const allowedUpper = cfg.allowlist.sql_keywords.map(k => k.toUpperCase());
        // Filter out allowed keywords from suspicious list
        const filtered = suspiciousKeywords.filter(kw =>
            !allowedUpper.includes(kw.toUpperCase().replace(/[()]/g, ''))
        );
        suspiciousKeywords.length = 0;
        suspiciousKeywords.push(...filtered);
    }

    // Calculate risk level
    let riskLevel: RiskLevel = 'low';
    if (injectionTypes.length > 0) {
        if (injectionTypes.includes('out_of_band') || injectionTypes.includes('stacked_queries')) {
            riskLevel = 'critical';
        } else if (injectionTypes.includes('union_based') || injectionTypes.includes('time_based_blind')) {
            riskLevel = 'high';
        } else if (injectionTypes.length >= 2) {
            riskLevel = 'high';
        } else {
            riskLevel = 'medium';
        }
    }

    return {
        safe: injectionTypes.length === 0,
        injection_type: injectionTypes,
        suspicious_keywords: [...new Set(suspiciousKeywords)],
        risk_level: riskLevel,
    };
}

// ============================================
// TOOL 3: Path Traversal Validator
// ============================================

export interface PathValidationResult {
    safe: boolean;
    normalized_path: string | null;
    traversal_detected: boolean;
    outside_project: boolean;
    risk_level: RiskLevel;
}

export function validateFilePath(
    filePath: string,
    projectRoot?: string,
    config: Partial<SecurityConfig> = {}
): PathValidationResult {
    const cfg = { ...DEFAULT_CONFIG, ...config };
    const effectiveRoot = projectRoot || cfg.projectRoot;

    if (!filePath || typeof filePath !== 'string') {
        return {
            safe: false,
            normalized_path: null,
            traversal_detected: false,
            outside_project: true,
            risk_level: 'medium',
        };
    }

    let traversalDetected = false;
    let outsideProject = false;
    const threats: string[] = [];

    // Check for null byte injection
    if (PATH_PATTERNS.nullByte.test(filePath)) {
        threats.push('null_byte');
        traversalDetected = true;
    }

    // Check for basic traversal patterns
    if (PATH_PATTERNS.basicTraversal.test(filePath)) {
        threats.push('basic_traversal');
        traversalDetected = true;
    }

    // Check for double traversal
    if (PATH_PATTERNS.doubleTraversal.test(filePath)) {
        threats.push('double_traversal');
        traversalDetected = true;
    }

    // Check for URL-encoded traversal
    if (PATH_PATTERNS.urlEncoded.test(filePath)) {
        threats.push('url_encoded_traversal');
        traversalDetected = true;
    }

    // Check for double URL-encoded traversal
    if (PATH_PATTERNS.doubleUrlEncoded.test(filePath)) {
        threats.push('double_url_encoded_traversal');
        traversalDetected = true;
    }

    // Check for unicode tricks
    if (PATH_PATTERNS.unicode.test(filePath)) {
        threats.push('unicode_traversal');
        traversalDetected = true;
    }

    // Check for UNC paths (Windows network paths)
    if (PATH_PATTERNS.uncPath.test(filePath)) {
        threats.push('unc_path');
        outsideProject = true;
    }

    // Check for mixed separators
    if (PATH_PATTERNS.mixedSeparators.test(filePath)) {
        threats.push('mixed_separators');
        traversalDetected = true;
    }

    // Check for sensitive Linux paths
    if (PATH_PATTERNS.absoluteLinux.test(filePath)) {
        threats.push('sensitive_linux_path');
        outsideProject = true;
    }

    // Check for sensitive Windows paths
    if (PATH_PATTERNS.absoluteWindows.test(filePath)) {
        threats.push('sensitive_windows_path');
        outsideProject = true;
    }

    // Try to normalize the path
    let normalizedPath: string | null = null;
    try {
        // Decode URL encoding first
        let decoded = filePath;
        try {
            decoded = decodeURIComponent(filePath);
            // Try double decoding
            decoded = decodeURIComponent(decoded);
        } catch {
            // Keep original if decoding fails
        }

        // Remove null bytes
        decoded = decoded.replace(/\x00/g, '');

        // Normalize path
        normalizedPath = path.normalize(decoded);

        // Check if normalized path stays within project root
        if (effectiveRoot) {
            const absoluteNormalized = path.isAbsolute(normalizedPath)
                ? normalizedPath
                : path.resolve(effectiveRoot, normalizedPath);
            const absoluteRoot = path.resolve(effectiveRoot);

            if (!absoluteNormalized.startsWith(absoluteRoot + path.sep) &&
                absoluteNormalized !== absoluteRoot) {
                outsideProject = true;
            }
        }
    } catch {
        normalizedPath = null;
        outsideProject = true;
    }

    // Check allowlist
    if (cfg.allowlist?.paths && cfg.mode === 'advisory') {
        for (const allowedPath of cfg.allowlist.paths) {
            if (normalizedPath?.startsWith(allowedPath)) {
                outsideProject = false;
                break;
            }
        }
    }

    // Calculate risk level
    let riskLevel: RiskLevel = 'low';
    if (threats.length > 0 || outsideProject) {
        if (threats.includes('null_byte') || threats.includes('double_url_encoded_traversal')) {
            riskLevel = 'high';
        } else if (outsideProject && traversalDetected) {
            riskLevel = 'high';
        } else if (outsideProject || traversalDetected) {
            riskLevel = 'medium';
        }
    }

    return {
        safe: !traversalDetected && !outsideProject && threats.length === 0,
        normalized_path: threats.length === 0 ? normalizedPath : null,
        traversal_detected: traversalDetected,
        outside_project: outsideProject,
        risk_level: riskLevel,
    };
}

// ============================================
// TOOL 4: Template Injection Detector
// ============================================

export interface TemplateInjectionResult {
    safe: boolean;
    template_syntax: string[];
    detected_patterns: string[];
    potential_rce: boolean;
    risk_level: RiskLevel;
}

export function detectTemplateInjection(
    content: string,
    config: Partial<SecurityConfig> = {}
): TemplateInjectionResult {
    const cfg = { ...DEFAULT_CONFIG, ...config };
    const templateSyntax: string[] = [];
    const detectedPatterns: string[] = [];
    let potentialRce = false;

    if (!content || typeof content !== 'string') {
        return {
            safe: true,
            template_syntax: [],
            detected_patterns: [],
            potential_rce: false,
            risk_level: 'low',
        };
    }

    // Check for Jinja2/Flask syntax
    if (TEMPLATE_PATTERNS.jinja2.test(content)) {
        templateSyntax.push('jinja2');
        const matches = content.match(TEMPLATE_PATTERNS.jinja2);
        if (matches) detectedPatterns.push(...matches.slice(0, 3));
    }

    // Check for dangerous Jinja2 patterns
    if (TEMPLATE_PATTERNS.jinjaConfig.test(content)) {
        templateSyntax.push('jinja2');
        const matches = content.match(TEMPLATE_PATTERNS.jinjaConfig);
        if (matches) detectedPatterns.push(...matches);
        potentialRce = true;
    }

    // Check for Jinja2 math (common SSTI test)
    if (TEMPLATE_PATTERNS.jinjaMath.test(content)) {
        templateSyntax.push('jinja2');
        const matches = content.match(TEMPLATE_PATTERNS.jinjaMath);
        if (matches) detectedPatterns.push(...matches);
    }

    // Check for Handlebars
    if (TEMPLATE_PATTERNS.handlebars.test(content)) {
        templateSyntax.push('handlebars');
        const matches = content.match(TEMPLATE_PATTERNS.handlebars);
        if (matches) detectedPatterns.push(...matches.slice(0, 3));
    }

    // Check for ERB (Ruby)
    if (TEMPLATE_PATTERNS.erb.test(content)) {
        templateSyntax.push('erb');
        const matches = content.match(TEMPLATE_PATTERNS.erb);
        if (matches) detectedPatterns.push(...matches.slice(0, 3));
    }

    // Check for Freemarker
    if (TEMPLATE_PATTERNS.freemarker.test(content)) {
        templateSyntax.push('freemarker');
        const matches = content.match(TEMPLATE_PATTERNS.freemarker);
        if (matches) detectedPatterns.push(...matches.slice(0, 3));
    }

    // Check for Velocity
    if (TEMPLATE_PATTERNS.velocity.test(content)) {
        templateSyntax.push('velocity');
        const matches = content.match(TEMPLATE_PATTERNS.velocity);
        if (matches) detectedPatterns.push(...matches.slice(0, 3));
    }

    // Check for Thymeleaf
    if (TEMPLATE_PATTERNS.thymeleaf.test(content)) {
        templateSyntax.push('thymeleaf');
        const matches = content.match(TEMPLATE_PATTERNS.thymeleaf);
        if (matches) detectedPatterns.push(...matches.slice(0, 3));
    }

    // Check for Pug/Jade
    if (TEMPLATE_PATTERNS.pug.test(content)) {
        templateSyntax.push('pug');
        const matches = content.match(TEMPLATE_PATTERNS.pug);
        if (matches) detectedPatterns.push(...matches.slice(0, 3));
    }

    // Check for SSTI payloads (Python object traversal)
    if (TEMPLATE_PATTERNS.ssti.test(content)) {
        potentialRce = true;
        const matches = content.match(TEMPLATE_PATTERNS.ssti);
        if (matches) detectedPatterns.push(...matches.slice(0, 3));
    }

    // Check for eval/exec
    if (TEMPLATE_PATTERNS.evalExpr.test(content)) {
        potentialRce = true;
        const matches = content.match(TEMPLATE_PATTERNS.evalExpr);
        if (matches) detectedPatterns.push(...matches.slice(0, 3));
    }

    // Deduplicate
    const uniqueSyntax = [...new Set(templateSyntax)];
    const uniquePatterns = [...new Set(detectedPatterns)];

    // Calculate risk level
    let riskLevel: RiskLevel = 'low';
    if (uniqueSyntax.length > 0 || potentialRce) {
        if (potentialRce) {
            riskLevel = 'critical';
        } else if (uniqueSyntax.length >= 2) {
            riskLevel = 'high';
        } else {
            riskLevel = 'medium';
        }
    }

    // Apply sensitivity adjustment
    if (cfg.sensitivity === 'low' && !potentialRce) {
        riskLevel = 'low';
    }

    return {
        safe: uniqueSyntax.length === 0 && !potentialRce,
        template_syntax: uniqueSyntax,
        detected_patterns: uniquePatterns,
        potential_rce: potentialRce,
        risk_level: riskLevel,
    };
}

// ============================================
// TOOL 5: Prompt Injection Detector
// ============================================

// LLM Guard Model Result
export interface LLMGuardResult {
    label: 'BENIGN' | 'MALICIOUS' | 'JAILBREAK' | 'INJECTION';
    score: number;
    model: string;
}

/**
 * Call Llama Prompt Guard 2 via HuggingFace Inference API
 */
export async function detectWithPromptGuard(
    content: string,
    huggingfaceToken: string,
    model: string = 'meta-llama/Prompt-Guard-2-86M'
): Promise<LLMGuardResult | null> {
    try {
        const client = new InferenceClient(huggingfaceToken);

        const result = await client.textClassification({
            model,
            inputs: content,
        });

        if (result && result.length > 0) {
            // Get the highest scoring label
            const topResult = result.reduce((prev, curr) =>
                curr.score > prev.score ? curr : prev
            );

            return {
                label: topResult.label as LLMGuardResult['label'],
                score: topResult.score,
                model,
            };
        }

        return null;
    } catch (error) {
        // Fail gracefully - LLM detection is optional enhancement
        console.error('Prompt Guard API error:', error);
        return null;
    }
}

export interface PromptInjectionResult {
    safe: boolean;
    injection_likelihood: number;
    detected_techniques: string[];
    flagged_phrases: string[];
    encoded_content_found: boolean;
    risk_level: RiskLevel;
    recommendation: string;
    // LLM Guard results (when enabled)
    llm_guard?: LLMGuardResult;
}

/**
 * Calculate Shannon entropy of a string to detect encoded/obfuscated content
 */
function calculateEntropy(str: string): number {
    if (!str || str.length === 0) return 0;

    const freq: { [key: string]: number } = {};
    for (const char of str) {
        freq[char] = (freq[char] || 0) + 1;
    }

    let entropy = 0;
    const len = str.length;
    for (const char in freq) {
        const p = freq[char] / len;
        entropy -= p * Math.log2(p);
    }

    return entropy;
}

/**
 * Check if content might be Base64 encoded
 */
function detectBase64(content: string): boolean {
    // Look for Base64 patterns (strings of valid base64 chars with length divisible by 4)
    const base64Pattern = /[A-Za-z0-9+/]{20,}={0,2}/;
    if (!base64Pattern.test(content)) return false;

    const matches = content.match(/[A-Za-z0-9+/]{20,}={0,2}/g);
    if (!matches) return false;

    for (const match of matches) {
        try {
            const decoded = Buffer.from(match, 'base64').toString('utf8');
            // Check if decoded content has readable ASCII
            if (/[a-zA-Z]{3,}/.test(decoded)) {
                return true;
            }
        } catch {
            continue;
        }
    }
    return false;
}

export function detectPromptInjection(
    content: string,
    config: Partial<SecurityConfig> = {}
): PromptInjectionResult {
    const cfg = { ...DEFAULT_CONFIG, ...config };
    const detectedTechniques: string[] = [];
    const flaggedPhrases: string[] = [];
    let encodedContentFound = false;
    let score = 0;

    if (!content || typeof content !== 'string') {
        return {
            safe: true,
            injection_likelihood: 0,
            detected_techniques: [],
            flagged_phrases: [],
            encoded_content_found: false,
            risk_level: 'low',
            recommendation: 'No content to analyze',
        };
    }

    // Check for role switching
    if (PROMPT_PATTERNS.roleSwitching.test(content)) {
        detectedTechniques.push('role_switching');
        const matches = content.match(PROMPT_PATTERNS.roleSwitching);
        if (matches) flaggedPhrases.push(...matches.slice(0, 3));
        score += 25;
    }

    // Check for instruction override
    if (PROMPT_PATTERNS.instructionOverride.test(content)) {
        detectedTechniques.push('instruction_override');
        const matches = content.match(PROMPT_PATTERNS.instructionOverride);
        if (matches) flaggedPhrases.push(...matches.slice(0, 3));
        score += 35;
    }

    // Check for context escape patterns
    if (PROMPT_PATTERNS.contextEscape.test(content)) {
        detectedTechniques.push('context_escape');
        score += 15;
    }

    // Check for new instruction markers
    if (PROMPT_PATTERNS.newInstructions.test(content)) {
        detectedTechniques.push('instruction_markers');
        const matches = content.match(PROMPT_PATTERNS.newInstructions);
        if (matches) flaggedPhrases.push(...matches.slice(0, 3));
        score += 20;
    }

    // Check for known payload markers
    if (PROMPT_PATTERNS.payloadMarkers.test(content)) {
        detectedTechniques.push('payload_markers');
        const matches = content.match(PROMPT_PATTERNS.payloadMarkers);
        if (matches) flaggedPhrases.push(...matches.slice(0, 3));
        score += 30;
    }

    // Check for invisible/control characters
    if (PROMPT_PATTERNS.invisibleChars.test(content)) {
        detectedTechniques.push('invisible_characters');
        score += 25;
    }

    // Check for data exfiltration attempts
    if (PROMPT_PATTERNS.dataExfiltration.test(content)) {
        detectedTechniques.push('data_exfiltration');
        const matches = content.match(PROMPT_PATTERNS.dataExfiltration);
        if (matches) flaggedPhrases.push(...matches.slice(0, 3));
        score += 20;
    }

    // Check for tool manipulation
    if (PROMPT_PATTERNS.toolManipulation.test(content)) {
        detectedTechniques.push('tool_manipulation');
        const matches = content.match(PROMPT_PATTERNS.toolManipulation);
        if (matches) flaggedPhrases.push(...matches.slice(0, 3));
        score += 25;
    }

    // Check for memory poisoning
    if (PROMPT_PATTERNS.memoryPoisoning.test(content)) {
        detectedTechniques.push('memory_poisoning');
        const matches = content.match(PROMPT_PATTERNS.memoryPoisoning);
        if (matches) flaggedPhrases.push(...matches.slice(0, 3));
        score += 20;
    }

    // Check for developer mode / jailbreak attempts
    if (PROMPT_PATTERNS.developerMode.test(content)) {
        detectedTechniques.push('jailbreak_attempt');
        const matches = content.match(PROMPT_PATTERNS.developerMode);
        if (matches) flaggedPhrases.push(...matches.slice(0, 3));
        score += 30;
    }

    // Check for encoded content
    if (detectBase64(content)) {
        encodedContentFound = true;
        detectedTechniques.push('base64_encoding');
        score += 15;
    }

    // Check entropy for potential ROT13, hex, or other encoding
    const entropy = calculateEntropy(content);
    if (entropy > 4.5 && content.length > 50) {
        // High entropy might indicate encoding
        const hasHighEntropySegment = content.split(/\s+/).some(word =>
            word.length > 20 && calculateEntropy(word) > 4.0
        );
        if (hasHighEntropySegment) {
            encodedContentFound = true;
            detectedTechniques.push('suspicious_encoding');
            score += 10;
        }
    }

    // Normalize score to 0-1 range
    const likelihood = Math.min(score / 100, 1);

    // Determine risk level
    let riskLevel: RiskLevel = 'low';
    if (likelihood >= 0.7) {
        riskLevel = 'critical';
    } else if (likelihood >= 0.5) {
        riskLevel = 'high';
    } else if (likelihood >= 0.25) {
        riskLevel = 'medium';
    }

    // Generate recommendation
    let recommendation = 'Content appears safe';
    if (riskLevel === 'critical') {
        recommendation = 'Block execution - high confidence injection attempt detected';
    } else if (riskLevel === 'high') {
        recommendation = 'Block execution - multiple injection indicators detected';
    } else if (riskLevel === 'medium') {
        recommendation = 'Review content manually before proceeding';
    }

    // Apply sensitivity adjustment
    if (cfg.sensitivity === 'low') {
        if (riskLevel === 'medium') riskLevel = 'low';
        if (riskLevel === 'high') riskLevel = 'medium';
    } else if (cfg.sensitivity === 'high') {
        if (detectedTechniques.length > 0 && riskLevel === 'low') {
            riskLevel = 'medium';
        }
    }

    return {
        safe: detectedTechniques.length === 0,
        injection_likelihood: Math.round(likelihood * 100) / 100,
        detected_techniques: [...new Set(detectedTechniques)],
        flagged_phrases: [...new Set(flaggedPhrases)],
        encoded_content_found: encodedContentFound,
        risk_level: riskLevel,
        recommendation,
    };
}

/**
 * Async version of prompt injection detector with optional LLM-based detection
 * using Llama Prompt Guard 2 via HuggingFace Inference API
 */
export async function detectPromptInjectionAsync(
    content: string,
    config: Partial<SecurityConfig> = {}
): Promise<PromptInjectionResult> {
    // First run regex-based detection
    const regexResult = detectPromptInjection(content, config);

    // If LLM guard is enabled and token provided, enhance with LLM detection
    if (config.useGuardModel && config.huggingfaceToken) {
        const llmResult = await detectWithPromptGuard(
            content,
            config.huggingfaceToken
        );

        if (llmResult) {
            // Combine regex and LLM scores
            const llmIsMalicious = llmResult.label !== 'BENIGN';
            const llmScore = llmIsMalicious ? llmResult.score : 0;

            // Weighted combination: 40% regex, 60% LLM (LLM is more accurate)
            const combinedLikelihood = Math.min(
                regexResult.injection_likelihood * 0.4 + llmScore * 0.6,
                1
            );

            // Determine final risk level based on combined score
            let finalRiskLevel: RiskLevel = 'low';
            if (combinedLikelihood >= 0.7 || (llmIsMalicious && llmResult.score >= 0.9)) {
                finalRiskLevel = 'critical';
            } else if (combinedLikelihood >= 0.5 || (llmIsMalicious && llmResult.score >= 0.7)) {
                finalRiskLevel = 'high';
            } else if (combinedLikelihood >= 0.25 || llmIsMalicious) {
                finalRiskLevel = 'medium';
            }

            // Add LLM-specific technique if detected
            const techniques = [...regexResult.detected_techniques];
            if (llmIsMalicious && !techniques.includes('llm_guard_detection')) {
                techniques.push('llm_guard_detection');
            }

            // Generate updated recommendation
            let recommendation = 'Content appears safe';
            if (finalRiskLevel === 'critical') {
                recommendation = 'Block execution - LLM guard confirms high-confidence injection';
            } else if (finalRiskLevel === 'high') {
                recommendation = 'Block execution - combined analysis indicates injection attempt';
            } else if (finalRiskLevel === 'medium') {
                recommendation = 'Review content manually - potential injection patterns detected';
            }

            return {
                safe: !llmIsMalicious && regexResult.detected_techniques.length === 0,
                injection_likelihood: Math.round(combinedLikelihood * 100) / 100,
                detected_techniques: techniques,
                flagged_phrases: regexResult.flagged_phrases,
                encoded_content_found: regexResult.encoded_content_found,
                risk_level: finalRiskLevel,
                recommendation,
                llm_guard: llmResult,
            };
        }
    }

    // Return regex-only result if LLM is not enabled or failed
    return regexResult;
}

// ============================================
// Visualization Helpers
// ============================================

export function createSecurityVisualization(
    toolName: string,
    result: ShellValidationResult | SqlValidationResult | PathValidationResult |
        TemplateInjectionResult | PromptInjectionResult
): string {
    const status = result.safe ? 'SAFE' : 'THREAT_DETECTED';
    const riskEmoji = {
        'critical': '🔴',
        'high': '🟠',
        'medium': '🟡',
        'low': '🟢',
    }[result.risk_level] || '⚪';

    return `[${toolName}] ${status} | Risk: ${riskEmoji} ${result.risk_level.toUpperCase()}`;
}

// ============================================
// TOOL 6: File Threat Scanner
// ============================================

export interface ThreatFinding {
    type: 'shell_injection' | 'sql_injection' | 'path_traversal' | 'template_injection' | 'prompt_injection';
    line: number;
    content: string;
    risk_level: RiskLevel;
    details: string[];
}

export interface FileScanResult {
    threats_detected: boolean;
    file: string;
    findings: ThreatFinding[];
    summary: { critical: number; high: number; medium: number; low: number };
}

export interface RepoScanResult {
    threats_detected: boolean;
    files_scanned: number;
    files_with_threats: number;
    findings: (ThreatFinding & { file: string })[];
    summary: { critical: number; high: number; medium: number; low: number };
}

/**
 * Scan a single file for all types of security threats with line-level detection
 */
export async function scanFileForThreats(
    filePath: string,
    fileContent: string,
    config: Partial<SecurityConfig> = {}
): Promise<FileScanResult> {
    const findings: ThreatFinding[] = [];
    const lines = fileContent.split('\n');

    // Detect file context
    const context = filePath ? detectFileContext(filePath) : {
        fileType: 'runtime' as const,
        shouldScanForPatterns: true,
        shouldScanStrings: true
    };

    // Skip scanning source code files entirely
    if (context.fileType === 'source') {
        return {
            threats_detected: false,
            file: filePath || 'unknown',
            findings: [],
            summary: {
                critical: 0,
                high: 0,
                medium: 0,
                low: 0,
            },
        };
    }

    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        const lineNum = i + 1;

        // Skip empty lines
        if (!line.trim()) continue;

        // Skip comments
        if (isCommentLine(line)) continue;

        // Skip import/export statements
        if (isImportExport(line)) continue;

        // Skip type definitions
        if (isTypeDefinition(line)) continue;

        // Only scan if context allows
        if (!context.shouldScanForPatterns) continue;

        // Check for shell injection
        const shellResult = validateShellInput(line, config);
        if (!shellResult.safe) {
            findings.push({
                type: 'shell_injection',
                line: lineNum,
                content: line.substring(0, 100),
                risk_level: shellResult.risk_level,
                details: shellResult.threats_found,
            });
        }

        // Check for SQL injection
        const sqlResult = validateSqlQuery(line, config);
        if (!sqlResult.safe) {
            findings.push({
                type: 'sql_injection',
                line: lineNum,
                content: line.substring(0, 100),
                risk_level: sqlResult.risk_level,
                details: sqlResult.injection_type,
            });
        }

        // Check for path traversal
        const pathResult = validateFilePath(line, config.projectRoot, config);
        if (!pathResult.safe && pathResult.traversal_detected) {
            findings.push({
                type: 'path_traversal',
                line: lineNum,
                content: line.substring(0, 100),
                risk_level: pathResult.risk_level,
                details: ['traversal_detected'],
            });
        }

        // Check for template injection (context-aware)
        if (context.fileType !== 'template') {
            const templateResult = detectTemplateInjection(line, config);
            if (!templateResult.safe) {
                findings.push({
                    type: 'template_injection',
                    line: lineNum,
                    content: line.substring(0, 100),
                    risk_level: templateResult.risk_level,
                    details: templateResult.template_syntax,
                });
            }
        }

        // Check for prompt injection
        const promptResult = detectPromptInjection(line, config);
        if (!promptResult.safe) {
            findings.push({
                type: 'prompt_injection',
                line: lineNum,
                content: line.substring(0, 100),
                risk_level: promptResult.risk_level,
                details: promptResult.detected_techniques,
            });
        }
    }

    // Calculate summary
    const summary = { critical: 0, high: 0, medium: 0, low: 0 };
    findings.forEach(f => summary[f.risk_level]++);

    return {
        threats_detected: findings.length > 0,
        file: filePath,
        findings,
        summary,
    };
}

// ============================================
// TOOL 7: Repository Threat Scanner
// ============================================

const DEFAULT_EXCLUDE_PATTERNS = [
    '**/node_modules/**',
    '**/.git/**',
    '**/dist/**',
    '**/build/**',
    '**/.next/**',
    '**/coverage/**',
    '**/__pycache__/**',
    '**/venv/**',
    '**/*.min.js',
    '**/*.min.css',
    '**/package-lock.json',
    '**/yarn.lock',
];

const SCANNABLE_EXTENSIONS = [
    '.js', '.ts', '.jsx', '.tsx', '.py', '.rb', '.php', '.go', '.java',
    '.sh', '.bash', '.zsh', '.sql', '.md', '.txt', '.yaml', '.yml',
    '.json', '.html', '.htm', '.xml', '.env', '.conf', '.ini',
];

/**
 * Scan an entire repository for security threats (regex-only, no API calls)
 */
export async function scanRepoForThreats(
    repoPath: string,
    excludePatterns: string[] = [],
    config: Partial<SecurityConfig> = {}
): Promise<RepoScanResult> {
    const allExcludes = [...DEFAULT_EXCLUDE_PATTERNS, ...excludePatterns];

    // Find all scannable files
    const files = await glob('**/*', {
        cwd: repoPath,
        absolute: true,
        ignore: allExcludes,
        onlyFiles: true,
    });

    // Filter by extension
    const scannableFiles = files.filter(f =>
        SCANNABLE_EXTENSIONS.some(ext => f.endsWith(ext))
    );

    const allFindings: (ThreatFinding & { file: string })[] = [];
    let filesWithThreats = 0;

    // Scan each file
    for (const file of scannableFiles) {
        try {
            const content = await fs.readFile(file, 'utf-8');

            // Skip very large files (>1MB)
            if (content.length > 1_000_000) continue;

            const relativePath = path.relative(repoPath, file);
            const result = await scanFileForThreats(relativePath, content, {
                ...config,
                projectRoot: repoPath,
            });

            if (result.findings.length > 0) {
                filesWithThreats++;
                result.findings.forEach(f => {
                    allFindings.push({ ...f, file: relativePath });
                });
            }
        } catch {
            // Skip files that can't be read
            continue;
        }
    }

    // Calculate summary
    const summary = { critical: 0, high: 0, medium: 0, low: 0 };
    allFindings.forEach(f => summary[f.risk_level]++);

    return {
        threats_detected: allFindings.length > 0,
        files_scanned: scannableFiles.length,
        files_with_threats: filesWithThreats,
        findings: allFindings,
        summary,
    };
}
