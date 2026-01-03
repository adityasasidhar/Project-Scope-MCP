import { simpleGit, SimpleGit, LogResult, StatusResult, BranchSummary } from 'simple-git';
import * as path from 'path';
import * as fs from 'fs/promises';

// Initialize git instance for a given path
function getGit(repoPath: string): SimpleGit {
    return simpleGit(repoPath);
}

// Validate if path is a git repository
async function validateGitRepo(repoPath: string): Promise<void> {
    try {
        await fs.access(repoPath);
        const git = getGit(repoPath);
        await git.status();
    } catch (error) {
        throw new Error(`Not a valid git repository: ${repoPath}`);
    }
}

// ============================================
// TOOL 1: Git Branch Status
// ============================================

export interface BranchInfo {
    name: string;
    current: boolean;
    commit: string;
    label: string;
    linkedWorkTree: boolean;
}

export interface BranchStatusResult {
    currentBranch: string;
    branches: BranchInfo[];
    totalBranches: number;
    visualization: string;
}

export async function gitBranchStatus(repoPath: string): Promise<BranchStatusResult> {
    await validateGitRepo(repoPath);
    const git = getGit(repoPath);

    const branchSummary: BranchSummary = await git.branch(['-a', '-v']);
    const branches: BranchInfo[] = [];

    // Convert branch summary to array
    for (const [name, branch] of Object.entries(branchSummary.branches)) {
        branches.push({
            name,
            current: branch.current,
            commit: branch.commit,
            label: branch.label,
            linkedWorkTree: branch.linkedWorkTree,
        });
    }

    // Create visualization
    const currentBranchName = branchSummary.current || 'unknown';
    const visualization = createBranchVisualization(branches, currentBranchName);

    return {
        currentBranch: currentBranchName,
        branches,
        totalBranches: branches.length,
        visualization,
    };
}

function createBranchVisualization(branches: BranchInfo[], currentBranch: string): string {
    let viz = '--------------------------------------------------\n\n';

    // Sort: current first, then local, then remote
    const sortedBranches = branches.sort((a, b) => {
        if (a.current) return -1;
        if (b.current) return 1;
        if (a.name.startsWith('remotes/') && !b.name.startsWith('remotes/')) return 1;
        if (!a.name.startsWith('remotes/') && b.name.startsWith('remotes/')) return -1;
        return a.name.localeCompare(b.name);
    });

    for (const branch of sortedBranches) {
        const marker = branch.current ? '-> * ' : '    ';
        const icon = branch.name.startsWith('remotes/') ? '[Remote] ' : '[Local] ';
        const shortCommit = branch.commit.substring(0, 7);

        viz += `${marker}${icon} ${branch.name}\n`;
        viz += `      L- ${shortCommit} - ${branch.label}\n\n`;
    }

    return viz;
}

// ============================================
// TOOL 2: Git Commit History
// ============================================

export interface CommitInfo {
    hash: string;
    date: string;
    message: string;
    author: string;
    body: string;
}

export interface CommitHistoryParams {
    repoPath: string;
    maxCount?: number;
    filePath?: string;
    author?: string;
    since?: string;
    until?: string;
}

export interface CommitHistoryResult {
    commits: CommitInfo[];
    totalCommits: number;
    visualization: string;
}

export async function gitCommitHistory(params: CommitHistoryParams): Promise<CommitHistoryResult> {
    const { repoPath, maxCount = 10, filePath, author, since, until } = params;
    await validateGitRepo(repoPath);
    const git = getGit(repoPath);

    const options: any = {
        maxCount,
        format: {
            hash: '%H',
            date: '%ai',
            message: '%s',
            author: '%an',
            body: '%b',
        },
    };

    if (filePath) {
        options.file = filePath;
    }
    if (author) {
        options['--author'] = author;
    }
    if (since) {
        options['--since'] = since;
    }
    if (until) {
        options['--until'] = until;
    }

    const log: LogResult = await git.log(options);

    const commits: CommitInfo[] = log.all.map((commit: any) => ({
        hash: commit.hash,
        date: commit.date,
        message: commit.message,
        author: commit.author,
        body: commit.body,
    }));

    const visualization = createCommitVisualization(commits, filePath);

    return {
        commits,
        totalCommits: commits.length,
        visualization,
    };
}

function createCommitVisualization(commits: CommitInfo[], filePath?: string): string {
    let viz = '\n COMMIT HISTORY\n';
    viz += '-'.repeat(50) + '\n';
    if (filePath) {
        viz += `File: ${filePath}\n`;
        viz += '--------------------------------------------------\n';
    }
    viz += '\n';

    for (let i = 0; i < commits.length; i++) {
        const commit = commits[i];
        const shortHash = commit.hash.substring(0, 7);
        const date = new Date(commit.date).toLocaleString();
        const isLast = i === commits.length - 1;
        const connector = isLast ? '*-' : '|-';

        viz += `${connector}* ${shortHash} - ${commit.author}\n`;
        viz += `${isLast ? '  ' : '| '} Date: ${date}\n`;
        viz += `${isLast ? '  ' : '| '} Message: ${commit.message}\n`;

        if (commit.body && commit.body.trim()) {
            const bodyLines = commit.body.trim().split('\n');
            bodyLines.forEach(line => {
                viz += `${isLast ? '  ' : '| '}    ${line}\n`;
            });
        }

        viz += '\n';
    }

    return viz;
}

// ============================================
// TOOL 3: Git Show Changes
// ============================================

export interface FileChange {
    path: string;
    status: string; // 'modified', 'added', 'deleted', 'renamed', etc.
    staged: boolean;
    insertions?: number;
    deletions?: number;
}

export interface GitChangesResult {
    branch: string;
    staged: FileChange[];
    unstaged: FileChange[];
    untracked: string[];
    totalChanges: number;
    visualization: string;
    detailedDiff?: string;
}

export interface ShowChangesParams {
    repoPath: string;
    includeUntracked?: boolean;
    showDiff?: boolean;
    filePath?: string;
}

export async function gitShowChanges(params: ShowChangesParams): Promise<GitChangesResult> {
    const { repoPath, includeUntracked = true, showDiff = false, filePath } = params;
    await validateGitRepo(repoPath);
    const git = getGit(repoPath);

    const status: StatusResult = await git.status();

    const staged: FileChange[] = [];
    const unstaged: FileChange[] = [];
    const untracked: string[] = includeUntracked ? status.not_added : [];

    // Process staged files
    for (const file of status.staged) {
        staged.push({
            path: file as string,
            status: 'staged',
            staged: true,
        });
    }

    // Process modified files
    for (const file of status.modified) {
        unstaged.push({
            path: file,
            status: 'modified',
            staged: false,
        });
    }

    // Process created files (unstaged new files)
    for (const file of status.created) {
        staged.push({
            path: file,
            status: 'added',
            staged: true,
        });
    }

    // Process deleted files
    for (const file of status.deleted) {
        unstaged.push({
            path: file,
            status: 'deleted',
            staged: false,
        });
    }

    // Get detailed diff if requested
    let detailedDiff: string | undefined;
    if (showDiff) {
        if (filePath) {
            detailedDiff = await git.diff([filePath]);
        } else {
            detailedDiff = await git.diff();
        }
    }

    const totalChanges = staged.length + unstaged.length + untracked.length;
    const branchName = status.current || 'unknown';
    const visualization = createChangesVisualization(branchName, staged, unstaged, untracked);

    return {
        branch: branchName,
        staged,
        unstaged,
        untracked,
        totalChanges,
        visualization,
        detailedDiff,
    };
}

function createChangesVisualization(
    branch: string,
    staged: FileChange[],
    unstaged: FileChange[],
    untracked: string[]
): string {
    let viz = '--------------------------------------------------\n';
    viz += `Branch: ${branch}\n`;
    viz += '='.repeat(50) + '\n\n';

    if (staged.length > 0) {
        viz += 'STAGED CHANGES:\n';
        for (const file of staged) {
            const icon = file.status === 'added' ? '[New]' : file.status === 'deleted' ? '[Deleted]' : '[Modified]';
            viz += `   ${icon} ${file.path} (${file.status})\n`;
        }
        viz += '\n';
    }

    if (unstaged.length > 0) {
        viz += 'UNSTAGED CHANGES:\n';
        for (const file of unstaged) {
            const icon = file.status === 'deleted' ? '[Deleted]' : '[Modified]';
            viz += `   ${icon} ${file.path} (${file.status})\n`;
        }
        viz += '\n';
    }

    if (untracked.length > 0) {
        viz += 'UNTRACKED FILES:\n';
        for (const file of untracked) {
            viz += `   [Untracked] ${file}\n`;
        }
        viz += '\n';
    }

    if (staged.length === 0 && unstaged.length === 0 && untracked.length === 0) {
        viz += 'Working directory clean - no changes\n\n';
    }

    return viz;
}

// ============================================
// TOOL 4: Git Compare Branches
// ============================================

export interface BranchComparison {
    branch1: string;
    branch2: string;
    commonAncestor: string;
    commitsOnlyInBranch1: CommitInfo[];
    commitsOnlyInBranch2: CommitInfo[];
    filesChanged: string[];
    visualization: string;
    diff?: string;
}

export interface CompareBranchesParams {
    repoPath: string;
    branch1: string;
    branch2: string;
    showDiff?: boolean;
}

export async function gitCompareBranches(params: CompareBranchesParams): Promise<BranchComparison> {
    const { repoPath, branch1, branch2, showDiff = false } = params;
    await validateGitRepo(repoPath);
    const git = getGit(repoPath);

    // Find merge base (common ancestor)
    const mergeBase = await git.raw(['merge-base', branch1, branch2]);
    const commonAncestor = mergeBase.trim();

    // Get commits only in branch1
    const log1: LogResult = await git.log({
        from: branch2,
        to: branch1,
    });

    // Get commits only in branch2
    const log2: LogResult = await git.log({
        from: branch1,
        to: branch2,
    });

    const commitsOnlyInBranch1: CommitInfo[] = log1.all.map((commit: any) => ({
        hash: commit.hash,
        date: commit.date,
        message: commit.message,
        author: commit.author_name,
        body: commit.body,
    }));

    const commitsOnlyInBranch2: CommitInfo[] = log2.all.map((commit: any) => ({
        hash: commit.hash,
        date: commit.date,
        message: commit.message,
        author: commit.author_name,
        body: commit.body,
    }));

    // Get files that differ
    const diffSummary = await git.diffSummary([branch1, branch2]);
    const filesChanged = diffSummary.files.map(f => f.file);

    // Get full diff if requested
    let diff: string | undefined;
    if (showDiff) {
        diff = await git.diff([branch1, branch2]);
    }

    const visualization = createComparisonVisualization(
        branch1,
        branch2,
        commonAncestor.substring(0, 7),
        commitsOnlyInBranch1,
        commitsOnlyInBranch2,
        filesChanged
    );

    return {
        branch1,
        branch2,
        commonAncestor,
        commitsOnlyInBranch1,
        commitsOnlyInBranch2,
        filesChanged,
        visualization,
        diff,
    };
}

function createComparisonVisualization(
    branch1: string,
    branch2: string,
    commonAncestor: string,
    commits1: CommitInfo[],
    commits2: CommitInfo[],
    filesChanged: string[]
): string {
    let viz = '\n BRANCH COMPARISON\n';
    viz += '-'.repeat(50) + '\n\n';

    viz += `Comparing: ${branch1} <-> ${branch2}\n`;
    viz += `Common ancestor: ${commonAncestor}\n\n`;

    viz += '-'.repeat(50) + '\n';
    viz += `SUMMARY:\n`;
    viz += `   ${branch1}: ${commits1.length} unique commits\n`;
    viz += `   ${branch2}: ${commits2.length} unique commits\n`;
    viz += `   Files changed: ${filesChanged.length}\n`;
    viz += '-'.repeat(50) + '\n\n';

    if (commits1.length > 0) {
        viz += `COMMITS ONLY IN ${branch1}:\n`;
        for (const commit of commits1.slice(0, 5)) {
            const shortHash = commit.hash.substring(0, 7);
            viz += `   * ${shortHash} - ${commit.message}\n`;
            viz += `     Author: ${commit.author}\n`;
        }
        if (commits1.length > 5) {
            viz += `   ... and ${commits1.length - 5} more commits\n`;
        }
        viz += '\n';
    }

    if (commits2.length > 0) {
        viz += `COMMITS ONLY IN ${branch2}:\n`;
        for (const commit of commits2.slice(0, 5)) {
            const shortHash = commit.hash.substring(0, 7);
            viz += `   * ${shortHash} - ${commit.message}\n`;
            viz += `     Author: ${commit.author}\n`;
        }
        if (commits2.length > 5) {
            viz += `   ... and ${commits2.length - 5} more commits\n`;
        }
        viz += '\n';
    }

    if (filesChanged.length > 0) {
        viz += `FILES CHANGED BETWEEN BRANCHES:\n`;
        for (const file of filesChanged.slice(0, 10)) {
            viz += `   ${file}\n`;
        }
        if (filesChanged.length > 10) {
            viz += `   ... and ${filesChanged.length - 10} more files\n`;
        }
        viz += '\n';
    }

    return viz;
}