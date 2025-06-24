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
        this.headPath = path.join(this.repoPath, 'HEAD');
        this.indexPath = path.join(this.repoPath, 'index');
        this.ready = this.init();
    }

    async init() {
        await fs.mkdir(this.objectPath, { recursive: true });
        try {
            await fs.writeFile(this.headPath, '', { flag: 'wx' });
            await fs.writeFile(this.indexPath, JSON.stringify([]), { flag: 'wx' });
            console.log("Repo initialized ✅");
        } catch {
            console.log("Repo already initialized.");
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
            const previousData = JSON.parse(await fs.readFile(path.join(this.objectPath, parent), 'utf-8'));
            previous = previousData.files || [];
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
        await fs.writeFile(this.headPath, hash);
        await fs.writeFile(this.indexPath, JSON.stringify([]));
        console.log(`Committed ✔️: ${hash}`);
    }

    async getCurrentHead() {
        try {
            return await fs.readFile(this.headPath, 'utf-8');
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
}

// === CLI Commands ===

program
    .name('gix')
    .description('A mini git-like tool')
    .version('1.0.0');

program
    .command('init')
    .description('Initialize a new gix repo')
    .action(async () => {
        const gix = new Gix();
        await gix.ready;
    });

program
    .command('add <file>')
    .description('Add file to staging')
    .action(async (file) => {
        const gix = new Gix();
        await gix.ready;
        await gix.add(file);
    });

program
    .command('commit <message>')
    .description('Commit changes with message')
    .action(async (message) => {
        const gix = new Gix();
        await gix.ready;
        await gix.commit(message);
    });

program
    .command('log')
    .description('Show commit history')
    .action(async () => {
        const gix = new Gix();
        await gix.ready;
        await gix.log();
    });

program
    .command('show <hash>')
    .description('Show diff of a commit')
    .action(async (hash) => {
        const gix = new Gix();
        await gix.ready;
        await gix.showDiff(hash);
    });

program.parse(process.argv);
