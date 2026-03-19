/**
 * cc-cmux Installer — main orchestrator.
 *
 * Exports:
 *   run()       — Interactive setup wizard
 *   status()    — Quick health check
 *   uninstall() — Remove hooks and config
 *   test()      — Fire synthetic events
 */

import * as p from '@clack/prompts';
import pc from 'picocolors';
import {
  existsSync,
  mkdirSync,
  copyFileSync,
  writeFileSync,
  rmSync,
  readFileSync,
} from 'node:fs';
import { join, dirname } from 'node:path';
import { homedir } from 'node:os';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { detectCmux, detectClaude, detectNode } from './detect.js';
import { runPrompts } from './prompts.js';
import { generateHooks, allCcCmuxEvents } from './hooks-gen.js';
import {
  mergeHooksIntoSettings,
  removeCcCmuxHooks,
  resolveSettingsPath,
} from './merge.js';
import { verifyInstallation } from './verify.js';

// ---------------------------------------------------------------------------
// Paths
// ---------------------------------------------------------------------------

const CC_CMUX_DIR = join(homedir(), '.cc-cmux');
const HANDLER_DEST = join(CC_CMUX_DIR, 'handler.cjs');
const WORKER_DEST = join(CC_CMUX_DIR, 'tab-title-worker.cjs');
const CONFIG_DEST = join(CC_CMUX_DIR, 'config.json');

/**
 * Resolve the dist/ directory relative to this file.
 * In the bundled installer.mjs, __dirname equivalent is needed.
 */
function getDistDir(): string {
  // When running from the built installer.mjs in dist/
  try {
    const thisFile = fileURLToPath(import.meta.url);
    return dirname(thisFile);
  } catch {
    // Fallback: assume we're in the project root
    return join(process.cwd(), 'dist');
  }
}

// =========================================================================
// run() — Interactive setup wizard
// =========================================================================

export async function run(): Promise<void> {
  p.intro(pc.bgCyan(pc.black(' cc-cmux setup ')));

  // Step 1: Environment detection
  const spin = p.spinner();
  spin.start('Detecting environment...');

  const cmux = detectCmux();
  const claude = detectClaude();
  const node = detectNode();

  spin.stop('Environment detected');

  // Step 2: Interactive prompts (shows detection + collects choices)
  const choices = await runPrompts(cmux, claude, node);

  if (!choices.confirmed) {
    p.cancel('Setup cancelled.');
    return;
  }

  // Step 3: Generate config
  const spin2 = p.spinner();
  spin2.start('Writing configuration...');

  const config = {
    features: {
      statusPills: choices.features.includes('statusPills'),
      progress: choices.features.includes('progress'),
      logs: choices.features.includes('logs'),
      notifications: choices.features.includes('notifications'),
      tabTitles: choices.features.includes('tabTitles'),
      gitIntegration: choices.features.includes('gitIntegration'),
      subagentTracking: choices.features.includes('subagentTracking'),
      visibleAgentPanes: choices.features.includes('visibleAgentPanes'),
    },
    notifications: choices.notifications,
    tabTitle: {
      style: choices.tabTitleStyle,
    },
  };

  mkdirSync(CC_CMUX_DIR, { recursive: true });
  writeFileSync(CONFIG_DEST, JSON.stringify(config, null, 2) + '\n', 'utf-8');

  // Invalidate config cache
  try {
    const cachePath = '/tmp/cc-cmux/config.cache.json';
    if (existsSync(cachePath)) {
      rmSync(cachePath);
    }
  } catch {
    // Non-critical
  }

  spin2.stop('Configuration written');

  // Step 4: Copy handler files
  const spin3 = p.spinner();
  spin3.start('Installing handler files...');

  const distDir = getDistDir();
  const handlerSrc = join(distDir, 'handler.cjs');
  const workerSrc = join(distDir, 'tab-title-worker.cjs');

  let handlerCopied = false;
  let workerCopied = false;

  if (existsSync(handlerSrc)) {
    copyFileSync(handlerSrc, HANDLER_DEST);
    handlerCopied = true;
  }

  if (existsSync(workerSrc)) {
    copyFileSync(workerSrc, WORKER_DEST);
    workerCopied = true;
  }

  if (handlerCopied && workerCopied) {
    spin3.stop('Handler files installed');
  } else if (handlerCopied) {
    spin3.stop('Handler installed (tab-title-worker not found in dist/)');
  } else {
    spin3.stop(pc.yellow('Handler files not found in dist/ — run "npm run build" first'));
  }

  // Step 5: Generate hooks (use tilde path for portability across users)
  const hooks = generateHooks(choices, '~/.cc-cmux/handler.cjs');

  // Step 6: Merge hooks into settings
  const spin4 = p.spinner();
  const settingsPath = resolveSettingsPath(choices.installTarget);
  spin4.start(`Merging hooks into ${settingsPath}...`);

  const mergeResult = mergeHooksIntoSettings(settingsPath, hooks);

  if (mergeResult.merged) {
    spin4.stop('Hooks merged');
  } else {
    spin4.stop(pc.red('Failed to merge hooks'));
  }

  // Step 6b: Disable cmux's built-in Claude hooks (they conflict with ours)
  try {
    execSync('defaults write com.cmuxterm.app claudeCodeHooksEnabled -bool false', {
      timeout: 3000,
    });
    p.log.info('Disabled cmux built-in Claude hooks (conflicts with cc-cmux)');
  } catch {
    // Non-critical — cmux might not be installed or using a different bundle ID
  }

  // Step 7: Show merge report
  const reportLines: string[] = [];

  if (mergeResult.added.length > 0) {
    reportLines.push(
      `${pc.green('Added:')} ${mergeResult.added.join(', ')}`,
    );
  }
  if (mergeResult.updated.length > 0) {
    reportLines.push(
      `${pc.yellow('Updated:')} ${mergeResult.updated.join(', ')}`,
    );
  }
  if (mergeResult.preserved.length > 0) {
    reportLines.push(
      `${pc.blue('Preserved user hooks:')} ${mergeResult.preserved.join(', ')}`,
    );
  }
  if (mergeResult.backup) {
    reportLines.push(
      `${pc.dim(`Backup: ${mergeResult.backup}`)}`,
    );
  }

  if (reportLines.length > 0) {
    p.note(reportLines.join('\n'), 'Merge Report');
  }

  // Step 8: Verification
  const spin5 = p.spinner();
  spin5.start('Verifying installation...');

  const verify = await verifyInstallation(HANDLER_DEST);

  spin5.stop('Verification complete');

  // Show verification results
  const verifyLines = verify.checks.map((c) => {
    const icon = c.passed ? pc.green('\u2713') : pc.red('\u2717');
    return `${icon} ${c.name}: ${pc.dim(c.detail)}`;
  });
  p.note(verifyLines.join('\n'), 'Verification');

  // Step 9: Add cmux socket symlink to shell profile (for SSH forwarding)
  const shellProfile = join(homedir(), '.zshrc');
  try {
    const profileContent = existsSync(shellProfile) ? readFileSync(shellProfile, 'utf-8') : '';
    if (!profileContent.includes('cmux-local.sock')) {
      const symBlock = [
        '',
        '# cc-cmux: symlink cmux socket (spaces in path break SSH -R)',
        'if [ -S "$CMUX_SOCKET_PATH" ]; then',
        '  ln -sf "$CMUX_SOCKET_PATH" /tmp/cmux-local.sock 2>/dev/null',
        'fi',
      ].join('\n');
      writeFileSync(shellProfile, profileContent + symBlock + '\n', 'utf-8');
      p.log.info('Added cmux socket symlink to ~/.zshrc');
    }
  } catch {
    // Non-critical
  }

  // Step 10: Optional SSH remote setup
  const wantSSH = await p.confirm({
    message: 'Set up SSH remote integration? (sidebar works over SSH)',
    initialValue: false,
  });

  if (!p.isCancel(wantSSH) && wantSSH) {
    const remoteHost = await p.text({
      message: 'SSH host name (as in ~/.ssh/config):',
      placeholder: 'myserver',
      validate: (v) => (v.trim() ? undefined : 'Host name required'),
    });

    if (!p.isCancel(remoteHost) && remoteHost) {
      const host = (remoteHost as string).trim();

      // Add RemoteForward + SendEnv to SSH config
      const sshConfigPath = join(homedir(), '.ssh', 'config');
      try {
        let sshContent = existsSync(sshConfigPath) ? readFileSync(sshConfigPath, 'utf-8') : '';
        const hostPattern = new RegExp(`^\\s*Host\\s+${host.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*$`, 'm');
        const hasHost = hostPattern.test(sshContent);

        if (hasHost) {
          // Check if RemoteForward already present
          if (!sshContent.includes('/tmp/cmux-fwd.sock')) {
            sshContent = sshContent.replace(
              hostPattern,
              `Host ${host}\n    RemoteForward /tmp/cmux-fwd.sock /tmp/cmux-local.sock\n    SendEnv CMUX_WORKSPACE_ID CMUX_SURFACE_ID CMUX_TAB_ID CMUX_PANEL_ID`,
            );
            writeFileSync(sshConfigPath, sshContent, 'utf-8');
            p.log.info(`Added RemoteForward + SendEnv to SSH config for ${host}`);
          } else {
            p.log.info(`SSH config for ${host} already has socket forwarding`);
          }
        } else {
          // Append new Host block
          const block = [
            '',
            `# cc-cmux: socket + env forwarding for sidebar integration`,
            `Host ${host}`,
            `    RemoteForward /tmp/cmux-fwd.sock /tmp/cmux-local.sock`,
            `    SendEnv CMUX_WORKSPACE_ID CMUX_SURFACE_ID CMUX_TAB_ID CMUX_PANEL_ID`,
          ].join('\n');
          mkdirSync(join(homedir(), '.ssh'), { recursive: true, mode: 0o700 } as any);
          writeFileSync(sshConfigPath, sshContent + block + '\n', 'utf-8');
          p.log.info(`Added Host ${host} with socket forwarding to SSH config`);
        }
      } catch {
        p.log.warn('Could not update SSH config. Add manually to ~/.ssh/config');
      }

      // Offer to deploy handler to remote
      const deployRemote = await p.confirm({
        message: `Deploy handler to ${host}?`,
        initialValue: true,
      });

      if (!p.isCancel(deployRemote) && deployRemote) {
        try {
          execSync(`ssh ${host} 'mkdir -p ~/.cc-cmux'`, { timeout: 10000 });
          execSync(`scp ~/.cc-cmux/handler.cjs ${host}:~/.cc-cmux/handler.cjs`, { timeout: 30000 });
          p.log.info(`Handler deployed to ${host}:~/.cc-cmux/handler.cjs`);
        } catch {
          p.log.warn(`Could not deploy to ${host}. Copy manually: scp ~/.cc-cmux/handler.cjs ${host}:~/.cc-cmux/`);
        }
      }

      // Show remaining manual steps
      p.note(
        [
          `On ${host}, run:`,
          '',
          `  # Accept env vars + allow socket reuse (needs sudo)`,
          `  echo "AcceptEnv CMUX_WORKSPACE_ID CMUX_SURFACE_ID CMUX_TAB_ID CMUX_PANEL_ID" | sudo tee -a /etc/ssh/sshd_config`,
          `  echo "StreamLocalBindUnlink yes" | sudo tee -a /etc/ssh/sshd_config`,
          `  sudo launchctl kickstart -k system/com.openssh.sshd  # macOS`,
          `  # sudo systemctl restart sshd                         # Linux`,
          '',
          `  # Add to remote ~/.zshrc:`,
          `  if [ -S /tmp/cmux-fwd.sock ]; then`,
          `    export CMUX_SOCKET_PATH=/tmp/cmux-fwd.sock`,
          `    [ -z "$CMUX_WORKSPACE_ID" ] && [ -f /tmp/cmux-fwd.env ] && . /tmp/cmux-fwd.env`,
          `  fi`,
          '',
          `  # Or run: bash remote-setup.sh`,
        ].join('\n'),
        `Remote setup for ${host}`,
      );
    }
  }

  // Step 11: Outro
  if (verify.allPassed) {
    p.outro(pc.green('cc-cmux is installed and ready!'));
  } else {
    const failCount = verify.checks.filter((c) => !c.passed).length;
    p.outro(
      pc.yellow(`Installed with ${failCount} warning(s). Run "cc-cmux status" to check later.`),
    );
  }
}

// =========================================================================
// status() — Quick health check
// =========================================================================

export async function status(): Promise<void> {
  p.intro(pc.bgCyan(pc.black(' cc-cmux status ')));

  const checks: Array<{ name: string; ok: boolean; detail: string }> = [];

  // 1. Handler exists
  checks.push({
    name: 'Handler',
    ok: existsSync(HANDLER_DEST),
    detail: existsSync(HANDLER_DEST) ? HANDLER_DEST : 'Not installed',
  });

  // 2. Config exists
  checks.push({
    name: 'Config',
    ok: existsSync(CONFIG_DEST),
    detail: existsSync(CONFIG_DEST) ? CONFIG_DEST : 'Not found',
  });

  // 3. Socket ping
  const cmux = detectCmux();
  checks.push({
    name: 'Socket',
    ok: cmux.socketOk,
    detail: cmux.socketOk
      ? `Connected (${cmux.latencyMs}ms)`
      : cmux.socketPath
        ? 'Not responding'
        : 'Not found',
  });

  // 4. Hooks registered
  const claude = detectClaude();
  const ccCmuxHooks: string[] = [];
  if (claude.settingsExists) {
    try {
      const raw = readFileSync(claude.settingsPath, 'utf-8');
      const settings = JSON.parse(raw);
      if (settings.hooks && typeof settings.hooks === 'object') {
        for (const [eventName, entries] of Object.entries(settings.hooks)) {
          if (Array.isArray(entries)) {
            const hasCcCmux = (entries as Record<string, unknown>[]).some(
              (e) => typeof e['description'] === 'string' && (e['description'] as string).startsWith('cc-cmux:'),
            );
            if (hasCcCmux) {
              ccCmuxHooks.push(eventName);
            }
          }
        }
      }
    } catch {
      // Ignore
    }
  }

  checks.push({
    name: 'Hooks',
    ok: ccCmuxHooks.length > 0,
    detail:
      ccCmuxHooks.length > 0
        ? `${ccCmuxHooks.length} events: ${ccCmuxHooks.join(', ')}`
        : 'No cc-cmux hooks registered',
  });

  // Display
  const lines = checks.map((c) => {
    const icon = c.ok ? pc.green('\u2713') : pc.red('\u2717');
    return `${icon} ${c.name}: ${pc.dim(c.detail)}`;
  });

  p.note(lines.join('\n'), 'Health Check');

  const allOk = checks.every((c) => c.ok);
  if (allOk) {
    p.outro(pc.green('All systems operational'));
  } else {
    const issues = checks.filter((c) => !c.ok).length;
    p.outro(pc.yellow(`${issues} issue(s) detected. Run "cc-cmux setup" to fix.`));
  }
}

// =========================================================================
// uninstall() — Remove hooks and configuration
// =========================================================================

export async function uninstall(): Promise<void> {
  p.intro(pc.bgRed(pc.white(' cc-cmux uninstall ')));

  const confirmed = await p.confirm({
    message: 'Remove all cc-cmux hooks and configuration?',
    initialValue: false,
  });

  if (p.isCancel(confirmed) || !confirmed) {
    p.cancel('Uninstall cancelled.');
    return;
  }

  // 1. Remove hooks from settings.json
  const spin = p.spinner();
  spin.start('Removing hooks...');

  const globalSettings = join(homedir(), '.claude', 'settings.json');
  const projectSettings = join(process.cwd(), '.claude', 'settings.json');
  const projectLocalSettings = join(process.cwd(), '.claude', 'settings.local.json');

  const removedFrom: string[] = [];

  for (const settingsPath of [globalSettings, projectSettings, projectLocalSettings]) {
    if (existsSync(settingsPath)) {
      const result = removeCcCmuxHooks(settingsPath);
      if (result.removed.length > 0) {
        removedFrom.push(`${settingsPath} (${result.removed.join(', ')})`);
      }
    }
  }

  if (removedFrom.length > 0) {
    spin.stop(`Hooks removed from ${removedFrom.length} file(s)`);
    for (const path of removedFrom) {
      p.log.info(`Cleaned: ${path}`);
    }
  } else {
    spin.stop('No cc-cmux hooks found');
  }

  // 2. Remove ~/.cc-cmux/ directory
  const spin2 = p.spinner();
  spin2.start('Removing configuration...');

  if (existsSync(CC_CMUX_DIR)) {
    try {
      rmSync(CC_CMUX_DIR, { recursive: true, force: true });
      spin2.stop('Configuration removed');
    } catch {
      spin2.stop(pc.yellow('Failed to remove ~/.cc-cmux/'));
    }
  } else {
    spin2.stop('No configuration directory found');
  }

  // 3. Re-enable cmux's built-in Claude hooks
  try {
    execSync('defaults delete com.cmuxterm.app claudeCodeHooksEnabled', {
      timeout: 3000,
    });
    p.log.info('Re-enabled cmux built-in Claude hooks');
  } catch {
    // Non-critical
  }

  // 4. Clean up temp files
  try {
    const tmpDir = '/tmp/cc-cmux';
    if (existsSync(tmpDir)) {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  } catch {
    // Non-critical
  }

  p.outro(pc.green('cc-cmux has been uninstalled.'));
}

// =========================================================================
// test() — Fire synthetic events through the handler
// =========================================================================

export async function test(): Promise<void> {
  p.intro(pc.bgMagenta(pc.white(' cc-cmux test ')));

  if (!existsSync(HANDLER_DEST)) {
    p.cancel('Handler not installed. Run "cc-cmux setup" first.');
    return;
  }

  // Check for cmux environment
  const cmux = detectCmux();
  if (!cmux.available) {
    p.cancel('cmux is not available. Run inside a cmux terminal.');
    return;
  }

  const sessionId = `test-${Date.now()}`;
  const baseEvent = {
    session_id: sessionId,
    transcript_path: '/tmp/cc-cmux/test-transcript.json',
    cwd: process.cwd(),
    permission_mode: 'default',
  };

  const fireEvent = (event: Record<string, unknown>): void => {
    try {
      const json = JSON.stringify(event);
      execSync(
        `echo '${json.replace(/'/g, "'\\''")}' | node "${HANDLER_DEST}"`,
        { timeout: 5000, encoding: 'utf-8', env: process.env },
      );
    } catch {
      // Swallow — handler might exit 0 but exec might see it as error
    }
  };

  const sleep = (ms: number): Promise<void> =>
    new Promise((resolve) => setTimeout(resolve, ms));

  await p.tasks([
    {
      title: 'SessionStart',
      task: async () => {
        fireEvent({
          ...baseEvent,
          hook_event_name: 'SessionStart',
          source: 'test',
          model: 'test-model',
        });
        await sleep(500);
        return 'Fired';
      },
    },
    {
      title: 'UserPromptSubmit',
      task: async () => {
        fireEvent({
          ...baseEvent,
          hook_event_name: 'UserPromptSubmit',
          prompt: 'Test prompt from cc-cmux test command',
        });
        await sleep(500);
        return 'Fired';
      },
    },
    {
      title: 'PreToolUse (Edit)',
      task: async () => {
        fireEvent({
          ...baseEvent,
          hook_event_name: 'PreToolUse',
          tool_name: 'Edit',
          tool_input: { file_path: '/tmp/test.txt' },
          tool_use_id: 'test-tool-1',
        });
        await sleep(500);
        return 'Fired';
      },
    },
    {
      title: 'PostToolUse (Edit)',
      task: async () => {
        fireEvent({
          ...baseEvent,
          hook_event_name: 'PostToolUse',
          tool_name: 'Edit',
          tool_input: { file_path: '/tmp/test.txt' },
          tool_response: 'OK',
          tool_use_id: 'test-tool-1',
        });
        await sleep(500);
        return 'Fired';
      },
    },
    {
      title: 'Stop',
      task: async () => {
        fireEvent({
          ...baseEvent,
          hook_event_name: 'Stop',
          stop_hook_active: false,
          last_assistant_message: 'Test completed successfully.',
        });
        await sleep(2000);
        return 'Fired';
      },
    },
    {
      title: 'SessionEnd (cleanup)',
      task: async () => {
        fireEvent({
          ...baseEvent,
          hook_event_name: 'SessionEnd',
        });
        await sleep(500);
        return 'Fired';
      },
    },
  ]);

  p.outro(pc.green('Test events fired. Check your cmux sidebar!'));
}
