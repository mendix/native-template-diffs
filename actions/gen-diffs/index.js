const fs = require('fs');
const os = require('os');
const util = require('util');
const {spawn} = require('child_process');
const core = require('@actions/core');
const rimraf = require('rimraf');

const cd = process.chdir;
const writeFile = util.promisify(fs.writeFile);

(async function () {
    try {
        const workSpaceDir = process.env.GITHUB_WORKSPACE;
        if (!workSpaceDir) {
            core.error('Needs a `GITHUB_WORKSPACE` environment variable')
            process.exit(1);
            return;
        }

        core.startGroup('Check out to diffs branch')
        await cmd('git', ['checkout', 'diffs']);
        core.endGroup();

        core.startGroup('Cloning repository')
        const cloneDir = os.tmpdir() + '/native-template';
        rimraf.sync(cloneDir);
        await cmd('git', ['clone', 'https://github.com/mendix/native-template.git', cloneDir]);
        cd(cloneDir);
        core.endGroup();

        core.startGroup('Fetching releases')
        const count = parseInt(core.getInput('count'), 10);
        core.info(`Process ${count} latest releases`);
        const releases = (await cmd('git', ['tag', '-l'])).split('\n').filter((release) => {
            return Boolean(release) && !(new RegExp('beta|alpha|rc|master').test(release));
        }).reverse();
        core.endGroup();

        core.startGroup('Generating diffs')
        const diffsDir = `${workSpaceDir}/diffs`;
        const writeableActions = [];
        for (const from of releases) {
            for (const to of releases) {
                const filePath = `${diffsDir}/${from}..${to}.diff`;
                if (to === from || fs.existsSync(filePath)) {
                    continue;
                }
                writeableActions.push({
                    filePath,
                    to,
                    from,
                });
            }
        }
        core.endGroup();

        if (!writeableActions.length) {
            core.info('No new changes to commit');
            process.exit(0);
        }

        core.startGroup('Writing to File system')
        const writeFileActions = writeableActions.slice(0, count);
        await Promise.all(writeFileActions.map(({filePath, from, to}) => {
            return cmd('git', ['diff', '--binary', `tags/${from}..tags/${to}`]).then((value) => writeFile(filePath, value))
        }));
        core.endGroup()

        core.info(`Generated ${writeFileActions.length} of ${writeableActions.length} new diffs`);
        cd(workSpaceDir);
        await cmd('git', ['config', '--global', 'user.email', '41898282+github-actions[bot]@users.noreply.github.com']);
        await cmd('git', ['config', '--global', 'user.name', 'github-action']);
        await cmd('git', ['add', '-A', 'diffs']);
        await cmd('git', ['commit', '-m', 'Update diffs']);
        await cmd('git', ['push', 'origin', 'diffs']);

        core.info('Done.');
        process.exit(0);
    } catch (error) {
        core.info(error.message);
        core.setFailed(error.message);
        process.exit(1);
    }
})()

async function cmd(cmd, args) {
    return new Promise((resolve, reject) => {
        core.info(cmd + ' ' + args.join(' '));
        const process = spawn(cmd, args);
        let commandReturn = "";
        let errorReturn = "";

        process.stdout.on("data", (line) => {
            commandReturn += line.toString();
        });
        process.stderr.on("data", (line) => {
            errorReturn += line.toString();
        });
        process.on("close", (exitCode, signal) => {
            if (exitCode === 0) {
                resolve(commandReturn);
                return;
            }
            reject(errorReturn);
        });
    });
}
