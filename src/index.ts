#!/usr/bin/env node
import yargs from 'yargs/yargs';
import { hideBin } from 'yargs/helpers';
import fs from 'fs';
import https from 'https';
import * as core from '@actions/core';
import { CtrfReport } from '../types/ctrf';
import { write, generateSummaryDetailsTable, generateTestDetailsTable, generateFailedTestsDetailsTable, generateFlakyTestsDetailsTable, annotateFailed } from './summary';

interface Arguments {
    _: (string | number)[];
    file?: string;
    postComment?: boolean;
}

const argv: Arguments = yargs(hideBin(process.argv))
    .command(['$0 <file>', 'all <file>'], 'Generate all tables from the specified CTRF file', (yargs) => {
        return yargs.positional('file', {
            describe: 'Path to the CTRF file',
            type: 'string',
            demandOption: true
        });
    })
    .command('summary <file>', 'Generate test summary from a CTRF report', (yargs) => {
        return yargs.positional('file', {
            describe: 'Path to the CTRF file',
            type: 'string'
        });
    })
    .command('tests <file>', 'Generate test details from a CTRF report', (yargs) => {
        return yargs.positional('file', {
            describe: 'Path to the CTRF file',
            type: 'string'
        });
    })
    .command('failed <file>', 'Generate fail test report from a CTRF report', (yargs) => {
        return yargs.positional('file', {
            describe: 'Path to the CTRF file',
            type: 'string'
        });
    })
    .command('flaky <file>', 'Generate flaky test report from a CTRF report', (yargs) => {
        return yargs.positional('file', {
            describe: 'Path to the CTRF file',
            type: 'string'
        });
    })
    .command('annotate <file>', 'Annotate failed tests from a CTRF report', (yargs) => {
        return yargs.positional('file', {
            describe: 'Path to the CTRF file',
            type: 'string'
        });
    })
    .option('post-comment', {
        type: 'boolean',
        description: 'Post a comment on the PR with a link to the summary',
        default: false
    })
    .help()
    .alias('help', 'h')
    .parseSync();
// Extract the command used or default to an empty string if none provided
const commandUsed = argv._[0] || '';

// Check if the command is 'all' or no specific command was given
if ((commandUsed === 'all' || commandUsed === '') && argv.file) {
    try {
        const data = fs.readFileSync(argv.file, 'utf8');
        const report = validateCtrfFile(argv.file)
        if (report !== null) {
            generateSummaryDetailsTable(report);
            generateTestDetailsTable(report.results.tests);
            generateFailedTestsDetailsTable(report.results.tests);
            generateFlakyTestsDetailsTable(report.results.tests);
            annotateFailed(report);
            write();
            if (argv.postComment) {
                postSummaryComment(report);
            }
        }
    } catch (error) {
        console.error('Failed to read file:', error);
    }
} else if (argv._.includes('summary') && argv.file) {
    try {
        const data = fs.readFileSync(argv.file, 'utf8');
        const report = validateCtrfFile(argv.file)
        if (report !== null) {
            generateSummaryDetailsTable(report);
            write();
        }
    } catch (error) {
        console.error('Failed to read file:', error);
    }
} else if (argv._.includes('tests') && argv.file) {
    try {
        const data = fs.readFileSync(argv.file, 'utf8');
        const report = validateCtrfFile(argv.file)
        if (report !== null) {
            generateTestDetailsTable(report.results.tests);
            write();
        }
    } catch (error) {
        console.error('Failed to read file:', error);
    }
} else if (argv._.includes('failed') && argv.file) {
    try {
        const data = fs.readFileSync(argv.file, 'utf8');
        const report = validateCtrfFile(argv.file)
        if (report !== null) {
            generateFailedTestsDetailsTable(report.results.tests);
            write();
        }
    } catch (error) {
        console.error('Failed to read file:', error);
    }
} else if (argv._.includes('flaky') && argv.file) {
    try {
        const data = fs.readFileSync(argv.file, 'utf8');
        const report = validateCtrfFile(argv.file)
        if (report !== null) {
            generateFlakyTestsDetailsTable(report.results.tests);
            write();
        }
    } catch (error) {
        console.error('Failed to read file:', error);
    }
}
else if (argv._.includes('annotate') && argv.file) {
    try {
        const data = fs.readFileSync(argv.file, 'utf8');
        const report = validateCtrfFile(argv.file)
        if (report !== null) {
            annotateFailed(report);
        }
    } catch (error) {
        console.error('Failed to read file:', error);
    }
}
else {
}
function validateCtrfFile(filePath: string): CtrfReport | null {
    try {
        const fileContent = fs.readFileSync(filePath, 'utf8');
        const jsonData: CtrfReport = JSON.parse(fileContent);

        if (!jsonData.results || !jsonData.results.summary || !jsonData.results.tests) {
            console.warn('Warning: The file does not contain valid CTRF data.');
            core.setFailed('Invalid CTRF file format.');
            return null;
        }
        return jsonData;
    } catch (error) {
        console.error('Failed to read or process the file:', error);
        core.setFailed(`Error processing the file: ${error instanceof Error ? error.message : 'Unknown error'}`);
        return null;
    }
}

function postSummaryComment(report: CtrfReport) {
    // Get the GitHub token
    const token = process.env.GITHUB_TOKEN;
    if (!token) {
        console.error('GITHUB_TOKEN is not set. This is required for post-comment argument');
        return;
    }

    // Read the event context from GITHUB_EVENT_PATH
    const eventPath = process.env.GITHUB_EVENT_PATH;
    if (!eventPath) {
        console.error('GITHUB_EVENT_PATH is not set. This is required to determine context.');
        return;
    }

    let context;
    try {
        const eventData = fs.readFileSync(eventPath, 'utf8');
        context = JSON.parse(eventData);
    } catch (error) {
        console.error('Failed to read or parse event data:', error);
        return;
    }

    // Extract owner, repo, and pull number from context
    const repo = context.repository.full_name;
    const pull_number = context.pull_request?.number;

    if (!pull_number) {
        console.log('Action is not running in a pull request context. Skipping comment.');
        return;
    }

    // Use GITHUB_RUN_ID to get the run ID
    const run_id = process.env.GITHUB_RUN_ID;

    // Build a prettier comment body with summary details
    const summaryUrl = `https://github.com/${repo}/actions/runs/${run_id}#summary`;
    const summary = report.results.summary;

    const summaryMarkdown = generateSummaryMarkdown(report);

    const commentBody = `${summaryMarkdown}\n\nYou can view the detailed summary [here](https://github.com/${repo}/actions/runs/${run_id}#summary).\n [A ctrf plugin](https://github.com/ctrf-io/github-actions-ctrf)`;

    const data = JSON.stringify({ body: commentBody.trim() });

    const apiPath = `/repos/${repo}/issues/${pull_number}/comments`;

    const options = {
        hostname: 'api.github.com',
        path: apiPath,
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${token}`,
            'Accept': 'application/vnd.github+json',
            'Content-Type': 'application/json',
            'X-GitHub-Api-Version': '2022-11-28',
            'User-Agent': 'github-actions-ctrf'
        }
    };

    const req = https.request(options, (res) => {
        let responseBody = '';

        res.on('data', (chunk) => {
            responseBody += chunk;
        });

        res.on('end', () => {
            console.log(`Response Status Code: ${res.statusCode}`);
            console.log(`Response Body: ${responseBody}`);
            if (res.statusCode && res.statusCode >= 200 && res.statusCode < 300) {
                console.log('Comment posted successfully.');
            } else {
                console.error(`Failed to post comment: ${res.statusCode} - ${responseBody}`);
            }
        });
    });

    req.on('error', (error) => {
        console.error(`Failed to post comment: ${error.message}`);
    });

    req.write(data);
    req.end();
}


export function generateSummaryMarkdown(report: CtrfReport): string {
    const durationInSeconds = (report.results.summary.stop - report.results.summary.start) / 1000;
    const durationFormatted = durationInSeconds < 1
        ? "<1s"
        : `${new Date(durationInSeconds * 1000).toISOString().substr(11, 8)}`;

    const flakyCount = report.results.tests.filter(test => test.flaky).length;

    return `
### 🎉 Test Summary 🎉

| **Tests 📝** | **Passed ✅** | **Failed ❌** | **Skipped ⏭️** | **Pending ⏳** | **Other ❓** | **Flaky 🍂** | **Duration ⏱️** |
| --- | --- | --- | --- | --- | --- | --- | --- |
| ${report.results.summary.tests} |  ${report.results.summary.passed} |  ${report.results.summary.failed} |  ${report.results.summary.skipped} |  ${report.results.summary.pending} |  ${report.results.summary.other} |  ${flakyCount} |  ${durationFormatted} |
    `;
}