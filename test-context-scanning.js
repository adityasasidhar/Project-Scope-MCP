#!/usr/bin/env node

/**
 * Test context-aware security scanning
 * Verify zero false positives on source code files
 */

import { scanFileForThreats } from './dist/tools/security-tools.js';
import * as fs from 'fs/promises';

console.log('🧪 Testing Context-Aware Security Scanning\n');
console.log('='.repeat(60) + '\n');

async function testFile(filePath, description) {
    console.log(`Test: ${description}`);
    console.log(`File: ${filePath}`);

    const content = await fs.readFile(filePath, 'utf-8');
    const result = await scanFileForThreats(filePath, content, { sensitivity: 'medium' });

    const status = result.threats_detected ? '❌ FAIL' : '✅ PASS';
    console.log(`  ${status} - Threats detected: ${result.threats_detected}`);
    console.log(`  Findings: ${result.findings.length}`);

    if (result.findings.length > 0) {
        console.log(`  Details:`);
        result.findings.slice(0, 3).forEach(f => {
            console.log(`    Line ${f.line}: ${f.type} (${f.risk_level})`);
        });
    }
    console.log('');

    return !result.threats_detected;
}

async function testRuntimeInput(input, description, shouldDetect = true) {
    console.log(`Test: ${description}`);
    console.log(`Input: "${input.substring(0, 50)}..."`);

    // Test as runtime input (no file path)
    const result = await scanFileForThreats('', input, { sensitivity: 'medium' });

    const expected = shouldDetect ? '✅ DETECTED' : '❌ MISSED';
    const actual = result.threats_detected ? 'DETECTED' : 'NOT DETECTED';
    const status = (result.threats_detected === shouldDetect) ? '✅ PASS' : '❌ FAIL';

    console.log(`  ${status} - Expected: ${expected}, Got: ${actual}`);
    console.log('');

    return result.threats_detected === shouldDetect;
}

async function runTests() {
    let passed = 0;
    let failed = 0;

    console.log('📁 TESTING SOURCE CODE FILES (should have ZERO false positives)\n');

    // Test 1: TypeScript source file with patterns
    if (await testFile(
        './src/tools/security-tools.ts',
        'TypeScript source file with regex patterns'
    )) {
        passed++;
    } else {
        failed++;
    }

    // Test 2: TypeScript index file
    if (await testFile(
        './src/index.ts',
        'TypeScript index file with tool definitions'
    )) {
        passed++;
    } else {
        failed++;
    }

    // Test 3: Configuration file
    if (await testFile(
        './tsconfig.json',
        'TypeScript configuration file'
    )) {
        passed++;
    } else {
        failed++;
    }

    console.log('\n🚨 TESTING RUNTIME INPUT (should DETECT threats)\n');

    // Test 4: Shell injection
    if (await testRuntimeInput(
        'rm -rf / && echo hacked',
        'Shell command injection',
        true
    )) {
        passed++;
    } else {
        failed++;
    }

    // Test 5: SQL injection
    if (await testRuntimeInput(
        "SELECT * FROM users WHERE id = '1' OR '1'='1'",
        'SQL injection attempt',
        true
    )) {
        passed++;
    } else {
        failed++;
    }

    // Test 6: Path traversal
    if (await testRuntimeInput(
        '../../etc/passwd',
        'Path traversal attempt',
        true
    )) {
        passed++;
    } else {
        failed++;
    }

    // Test 7: Benign runtime input
    if (await testRuntimeInput(
        'Hello, how can I help you today?',
        'Benign user input',
        false
    )) {
        passed++;
    } else {
        failed++;
    }

    console.log('='.repeat(60));
    console.log(`\n📊 Test Results: ${passed} passed, ${failed} failed\n`);

    if (failed === 0) {
        console.log('✅ All tests passed! Context-aware scanning works perfectly.\n');
    } else {
        console.log('❌ Some tests failed. Review the output above.\n');
        process.exit(1);
    }
}

runTests().catch(err => {
    console.error('Error running tests:', err);
    process.exit(1);
});
