#!/usr/bin/env node

import fs from 'fs/promises';
import path from 'path';
import crypto from 'crypto';
import chalk from 'chalk';
import { diffLines } from 'diff';
import { Command } from 'commander';

const program = new Command();

class Gix {
    constructor(repoPath = '.') {
        this.repoPath = path.join(repoPath, '.gix');
        this.objectPath = path.join(this.repoPath, 'objects');
        this.refsPath = path.join(this.repoPath, 'refs', 'heads');
        this.headPath = path.join(this.repoPath, 'HEAD');
        this.indexPath = path.join(this.repoPath, 'index');
        this.ready = this.init();
    }

    async init() {
        await fs.mkdir(this.objectPath, { recursive: true });
        await fs.mkdir(this.refsPath, { recursive: true });
        try {
            await fs.writeFile(this.headPath, 'ref: refs/heads/master', { flag: 'wx' });
            await fs.writeFile(this.indexPath, JSON.stringify([]), { flag: 'wx' });
            await fs.writeFile(path.join(this.refsPath, 'master'), '', { flag: 'wx' });
            console.log("Repo initialized ✅");
        } catch (error) {
            if (error.code === 'EEXIST') {
                console.log("Repo already initialized.");
            } else {
                throw error;
            }
        }
    }

    hashObject(content) {
        return crypto.createHash('sha1').update(content, 'utf-8').digest('hex');
    }

    async add(filePath) {
        const data = await fs.readFile(filePath, 'utf-8');
        const hash = this.hashObject(data);
        const objectPath = path.join(this.objectPath, hash);
        await fs.writeFile(objectPath, data);
        await this.updateIndex(filePath, hash);
        console.log(`Added: ${filePath}`);
    }

    async updateIndex(filePath, hash) {
        const index = JSON.parse(await fs.readFile(this.indexPath, 'utf-8'));
        const filtered = index.filter(entry => entry.path !== filePath);
        filtered.push({ path: filePath, hash });
        await fs.writeFile(this.indexPath, JSON.stringify(filtered));
    }

    async commit(message) {
        const index = JSON.parse(await fs.readFile(this.indexPath, 'utf-8'));
        const parent = (await this.getCurrentHead())?.trim() || null;

        if (index.length === 0) return console.log("No changes to commit.");

        let previous = [];
        if (parent) {
            try {
                const previousData = JSON.parse(await fs.readFile(path.join(this.objectPath, parent), 'utf-8'));
                previous = previousData.files || [];
            } catch (error) {
                console.error(chalk.red(`Warning: Parent commit ${parent} not found. Continuing with no previous files.`));
            }
        }

        const unchanged = index.length === previous.length &&
            index.every(i => previous.some(p => p.path === i.path && p.hash === i.hash));
        if (unchanged) return console.log("No changes: working tree clean.");

        const commit = {
            timeStamp: new Date().toISOString(),
            message,
            files: index,
            parent
        };

        const hash = this.hashObject(JSON.stringify(commit));
        await fs.writeFile(path.join(this.objectPath, hash), JSON.stringify(commit));

        const headContent = (await fs.readFile(this.headPath, 'utf-8')).trim();
        if (!headContent.startsWith('ref: ')) {
            await fs.writeFile(this.headPath, hash);
            console.log("Warning: Detached HEAD. Commit points to a raw hash.");
        } else {
            const branchRefPath = path.join(this.repoPath, headContent.substring(5));
            await fs.writeFile(branchRefPath, hash);
        }

        await fs.writeFile(this.indexPath, JSON.stringify([]));
        console.log(`Committed ✔️: ${hash}`);
    }

    async getCurrentHead() {
        try {
            const headContent = (await fs.readFile(this.headPath, 'utf-8')).trim();
            if (headContent.startsWith('ref: ')) {
                const branchRefPath = path.join(this.repoPath, headContent.substring(5));
                return (await fs.readFile(branchRefPath, 'utf-8')).trim();
            } else {
                return headContent;
            }
        } catch {
            return null;
        }
    }

    async log() {
        let head = (await this.getCurrentHead())?.trim();
        if (!head) return console.log("No commits yet.");

        console.log("\n📜 Commit History:\n");
        while (head) {
            const commit = JSON.parse(await fs.readFile(path.join(this.objectPath, head), 'utf-8'));
            console.log("=".repeat(50));
            console.log(`Commit : ${head}`);
            console.log(`Date   : ${commit.timeStamp}`);
            console.log(`Message: ${commit.message}`);
            console.log("=".repeat(50) + "\n");
            head = commit.parent;
        }
    }

    async showDiff(hash) {
        const commitText = await this.getCommitData(hash);
        if (!commitText) return console.log("❌ Commit not found");

        const commit = JSON.parse(commitText);
        const parentHash = commit.parent;

        for (const file of commit.files) {
            console.log(chalk.blue(`\n📝 File: ${file.path}`));
            const newContent = await this.getFileContent(file.hash);

            if (!parentHash) {
                console.log(chalk.green(newContent));
                console.log(chalk.gray("(First commit — nothing to diff)"));
                continue;
            }

            const parent = JSON.parse(await this.getCommitData(parentHash));
            const parentFile = parent.files.find(f => f.path === file.path);
            const oldContent = parentFile ? await this.getFileContent(parentFile.hash) : "";

            const diff = diffLines(oldContent, newContent);
            for (const part of diff) {
                if (part.added) process.stdout.write(chalk.green(`++${part.value}`));
                else if (part.removed) process.stdout.write(chalk.red(`--${part.value}`));
                else process.stdout.write(chalk.grey(part.value));
            }
        }
    }

    async getCommitData(hash) {
        try {
            return await fs.readFile(path.join(this.objectPath, hash), 'utf-8');
        } catch {
            return null;
        }
    }

    async getFileContent(hash) {
        return await fs.readFile(path.join(this.objectPath, hash), 'utf-8');
    }

    // === Branching Methods ===
    async createBranch(branchName) {
        const currentHeadCommit = await this.getCurrentHead();
        if (!currentHeadCommit) {
            return console.log("Cannot create branch: No commits yet.");
        }

        const branchFilePath = path.join(this.refsPath, branchName);
        try {
            await fs.writeFile(branchFilePath, currentHeadCommit, { flag: 'wx' });
            console.log(`Branch '${branchName}' created pointing to ${currentHeadCommit.substring(0, 7)}`);
        } catch (error) {
            if (error.code === 'EEXIST') {
                console.log(`Branch '${branchName}' already exists.`);
            } else {
                throw error;
            }
        }
    }

    async listBranches() {
        try {
            const branchFiles = await fs.readdir(this.refsPath);
            const currentHeadContent = (await fs.readFile(this.headPath, 'utf-8')).trim();
            let currentBranchName = null;
            if (currentHeadContent.startsWith('ref: refs/heads/')) {
                currentBranchName = currentHeadContent.substring('ref: refs/heads/'.length);
            }

            console.log("\n📚 Branches:");
            if (branchFiles.length === 0) {
                console.log("  No branches found.");
                return;
            }

            for (const branchFile of branchFiles) {
                const branchName = branchFile;
                const prefix = (branchName === currentBranchName) ? chalk.green('* ') : '  ';
                let commitHash = '';
                try {
                    commitHash = (await fs.readFile(path.join(this.refsPath, branchFile), 'utf-8')).trim();
                } catch (error) {
                    commitHash = " (empty/unresolved)";
                }
                console.log(`${prefix}${branchName} (${commitHash.substring(0, 7)})`);
            }
        } catch (error) {
            console.error("Error listing branches:", error.message);
        }
    }

    async checkout(branchName) {
        const branchFilePath = path.join(this.refsPath, branchName);
        try {
            const newCommitHash = (await fs.readFile(branchFilePath, 'utf-8')).trim();
            if (!newCommitHash) {
                return console.log(`Branch '${branchName}' has no commits.`);
            }

            const newCommitData = JSON.parse(await fs.readFile(path.join(this.objectPath, newCommitHash), 'utf-8'));
            const newFiles = newCommitData.files || [];

            const currentHeadCommitHash = await this.getCurrentHead();
            let currentFiles = [];
            if (currentHeadCommitHash) {
                try {
                    const currentCommitData = JSON.parse(await fs.readFile(path.join(this.objectPath, currentHeadCommitHash), 'utf-8'));
                    currentFiles = currentCommitData.files || [];
                } catch (error) {
                    console.error(chalk.red(`Warning: Current HEAD commit ${currentHeadCommitHash} not found. Skipping old file cleanup.`));
                }
            }

            for (const file of currentFiles) {
                const newFileExists = newFiles.some(nf => nf.path === file.path);
                if (!newFileExists) {
                    try {
                        await fs.unlink(file.path);
                        console.log(chalk.red(`Deleted: ${file.path}`));
                    } catch (error) {
                        if (error.code !== 'ENOENT') console.error(`Error deleting ${file.path}: ${error.message}`);
                    }
                }
            }

            for (const file of newFiles) {
                const fileContent = await this.getFileContent(file.hash);
                await fs.mkdir(path.dirname(file.path), { recursive: true });
                await fs.writeFile(file.path, fileContent);
                console.log(chalk.green(`Restored: ${file.path}`));
            }

            await fs.writeFile(this.headPath, `ref: refs/heads/${branchName}`);
            await fs.writeFile(this.indexPath, JSON.stringify([]));

            console.log(`Switched to branch '${branchName}' (commit ${newCommitHash.substring(0, 7)}) ✅`);

        } catch (error) {
            if (error.code === 'ENOENT') {
                console.log(`Branch '${branchName}' not found.`);
            } else {
                console.error(`Error checking out branch '${branchName}':`, error.message);
            }
        }
    }
}

// === CLI Commands Helper ===
// This helper abstracts the common Gix initialization and readiness
const withGix = (action) => async (...args) => {
    const gix = new Gix();
    await gix.ready;
    return action(gix, ...args); // Pass the gix instance and original arguments
};

// === CLI Commands ===

program
    .name('gix')
    .description('A mini git-like tool')
    .version('1.0.0');

program
    .command('init')
    .description('Initialize a new gix repo')
    .action(withGix(async (gix) => {
        // gix is already initialized and ready here
        // No additional code needed in init's action, as init() is called in constructor.
        // The console.log from init() inside Gix class already handles the output.
    }));

program
    .command('add <file>')
    .description('Add file to staging')
    .action(withGix(async (gix, file) => {
        await gix.add(file);
    }));

program
    .command('commit <message>')
    .description('Commit changes with message')
    .action(withGix(async (gix, message) => {
        await gix.commit(message);
    }));

program
    .command('log')
    .description('Show commit history')
    .action(withGix(async (gix) => {
        await gix.log();
    }));

program
    .command('show <hash>')
    .description('Show diff of a commit')
    .action(withGix(async (gix, hash) => {
        await gix.showDiff(hash);
    }));

program
    .command('branch [name]')
    .description('Create a new branch or list branches')
    .action(withGix(async (gix, name) => {
        if (name) {
            await gix.createBranch(name);
        } else {
            await gix.listBranches();
        }
    }));

program
    .command('checkout <branchName>')
    .description('Switch to a different branch')
    .action(withGix(async (gix, branchName) => {
        await gix.checkout(branchName);
    }));

program.parse(process.argv);