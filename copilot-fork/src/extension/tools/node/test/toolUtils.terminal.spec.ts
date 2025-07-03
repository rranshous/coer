/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { deepStrictEqual, ok } from 'assert';
import { afterEach, beforeEach, describe, it, vi } from 'vitest';
import { ConfigKey, IConfigurationService } from '../../../../platform/configuration/common/configurationService';
import { IEnvService, OperatingSystem } from '../../../../platform/env/common/envService';
import { DisposableStore } from '../../../../util/vs/base/common/lifecycle';
import { IInstantiationService } from '../../../../util/vs/platform/instantiation/common/instantiation';
import { createExtensionUnitTestingServices } from '../../../test/node/services';
import { CommandLineAutoApprover, extractInlineSubCommands, isPowerShell, splitCommandLineIntoSubCommands } from '../toolUtils.terminal';

describe('CommandLineAutoApprover', () => {
	let store: DisposableStore;
	let instantiationService: IInstantiationService;
	let configurationService: IConfigurationService;
	let envService: IEnvService;

	beforeEach(() => {
		store = new DisposableStore();

		const accessor = store.add(createExtensionUnitTestingServices()).createTestingAccessor();
		instantiationService = accessor.get(IInstantiationService);
		configurationService = accessor.get(IConfigurationService);
		envService = accessor.get(IEnvService);
	});

	afterEach(() => {
		store.dispose();
	});

	describe('allowList without a denyList', () => {
		it('should auto-approve exact command match', () => {
			configurationService.setConfig(ConfigKey.TerminalAllowList, {
				"echo": true
			});
			const commandLineAutoApprover = instantiationService.createInstance(CommandLineAutoApprover);

			ok(commandLineAutoApprover.isAutoApproved('echo'));
		});

		it('should auto-approve command with arguments', () => {
			configurationService.setConfig(ConfigKey.TerminalAllowList, {
				"echo": true
			});
			const commandLineAutoApprover = instantiationService.createInstance(CommandLineAutoApprover);

			ok(commandLineAutoApprover.isAutoApproved('echo hello world'));
		});

		it('should not auto-approve when there is no match', () => {
			configurationService.setConfig(ConfigKey.TerminalAllowList, {
				"echo": true
			});
			const commandLineAutoApprover = instantiationService.createInstance(CommandLineAutoApprover);

			ok(!commandLineAutoApprover.isAutoApproved('ls'));
		});

		it('should not auto-approve partial command matches', () => {
			configurationService.setConfig(ConfigKey.TerminalAllowList, {
				"echo": true
			});
			const commandLineAutoApprover = instantiationService.createInstance(CommandLineAutoApprover);

			ok(!commandLineAutoApprover.isAutoApproved('echotest'));
		});

		it('should handle multiple commands in allowList', () => {
			configurationService.setConfig(ConfigKey.TerminalAllowList, {
				"echo": true,
				"ls": true,
				"pwd": true
			});
			const commandLineAutoApprover = instantiationService.createInstance(CommandLineAutoApprover);

			ok(commandLineAutoApprover.isAutoApproved('echo'));
			ok(commandLineAutoApprover.isAutoApproved('ls -la'));
			ok(commandLineAutoApprover.isAutoApproved('pwd'));
			ok(!commandLineAutoApprover.isAutoApproved('rm'));
		});
	});

	describe('denyList without an allowList', () => {
		it('should deny commands in denyList', () => {
			configurationService.setConfig(ConfigKey.TerminalAllowList, {});
			configurationService.setConfig(ConfigKey.TerminalDenyList, {
				"rm": true,
				"del": true
			});
			const commandLineAutoApprover = instantiationService.createInstance(CommandLineAutoApprover);

			ok(!commandLineAutoApprover.isAutoApproved('rm file.txt'));
			ok(!commandLineAutoApprover.isAutoApproved('del file.txt'));
		});

		it('should not auto-approve safe commands when no allowList is present', () => {
			configurationService.setConfig(ConfigKey.TerminalAllowList, {});
			configurationService.setConfig(ConfigKey.TerminalDenyList, {
				"rm": true
			});
			const commandLineAutoApprover = instantiationService.createInstance(CommandLineAutoApprover);

			ok(!commandLineAutoApprover.isAutoApproved('echo hello'));
			ok(!commandLineAutoApprover.isAutoApproved('ls'));
		});
	});

	describe('allowList with denyList', () => {
		it('should deny commands in denyList even if in allowList', () => {
			configurationService.setConfig(ConfigKey.TerminalAllowList, {
				"echo": true,
				"rm": true
			});
			configurationService.setConfig(ConfigKey.TerminalDenyList, {
				"rm": true
			});
			const commandLineAutoApprover = instantiationService.createInstance(CommandLineAutoApprover);

			ok(commandLineAutoApprover.isAutoApproved('echo hello'));
			ok(!commandLineAutoApprover.isAutoApproved('rm file.txt'));
		});

		it('should auto-approve allowList commands not in denyList', () => {
			configurationService.setConfig(ConfigKey.TerminalAllowList, {
				"echo": true,
				"ls": true,
				"pwd": true
			});
			configurationService.setConfig(ConfigKey.TerminalDenyList, {
				"rm": true,
				"del": true
			});
			const commandLineAutoApprover = instantiationService.createInstance(CommandLineAutoApprover);

			ok(commandLineAutoApprover.isAutoApproved('echo'));
			ok(commandLineAutoApprover.isAutoApproved('ls'));
			ok(commandLineAutoApprover.isAutoApproved('pwd'));
			ok(!commandLineAutoApprover.isAutoApproved('rm'));
			ok(!commandLineAutoApprover.isAutoApproved('del'));
		});
	});

	describe('regex patterns', () => {
		it('should handle regex patterns in allowList', () => {
			configurationService.setConfig(ConfigKey.TerminalAllowList, {
				"/^echo/": true,
				"/^ls/": true,
				"pwd": true
			});
			const commandLineAutoApprover = instantiationService.createInstance(CommandLineAutoApprover);

			ok(commandLineAutoApprover.isAutoApproved('echo hello'));
			ok(commandLineAutoApprover.isAutoApproved('ls -la'));
			ok(commandLineAutoApprover.isAutoApproved('pwd'));
			ok(!commandLineAutoApprover.isAutoApproved('rm file'));
		});

		it('should handle regex patterns in denyList', () => {
			configurationService.setConfig(ConfigKey.TerminalAllowList, {
				"echo": true,
				"rm": true
			});
			configurationService.setConfig(ConfigKey.TerminalDenyList, {
				"/^rm\\s+/": true,
				"/^del\\s+/": true
			});
			const commandLineAutoApprover = instantiationService.createInstance(CommandLineAutoApprover);

			ok(commandLineAutoApprover.isAutoApproved('echo hello'));
			ok(commandLineAutoApprover.isAutoApproved('rm'));
			ok(!commandLineAutoApprover.isAutoApproved('rm file.txt'));
			ok(!commandLineAutoApprover.isAutoApproved('del file.txt'));
		});

		it('should handle complex regex patterns', () => {
			configurationService.setConfig(ConfigKey.TerminalAllowList, {
				"/^(echo|ls|pwd)\\b/": true,
				"/^git (status|show\\b.*)$/": true
			});
			configurationService.setConfig(ConfigKey.TerminalDenyList, {
				"/rm|del|kill/": true
			});
			const commandLineAutoApprover = instantiationService.createInstance(CommandLineAutoApprover);

			ok(commandLineAutoApprover.isAutoApproved('echo test'));
			ok(commandLineAutoApprover.isAutoApproved('ls -la'));
			ok(commandLineAutoApprover.isAutoApproved('pwd'));
			ok(commandLineAutoApprover.isAutoApproved('git status'));
			ok(commandLineAutoApprover.isAutoApproved('git show'));
			ok(commandLineAutoApprover.isAutoApproved('git show HEAD'));
			ok(!commandLineAutoApprover.isAutoApproved('rm file'));
			ok(!commandLineAutoApprover.isAutoApproved('del file'));
			ok(!commandLineAutoApprover.isAutoApproved('kill process'));
		});
	});

	describe('edge cases', () => {
		it('should handle empty allowList and denyList', () => {
			configurationService.setConfig(ConfigKey.TerminalAllowList, {});
			configurationService.setConfig(ConfigKey.TerminalDenyList, {});
			const commandLineAutoApprover = instantiationService.createInstance(CommandLineAutoApprover);

			ok(!commandLineAutoApprover.isAutoApproved('echo hello'));
			ok(!commandLineAutoApprover.isAutoApproved('ls'));
			ok(!commandLineAutoApprover.isAutoApproved('rm file'));
		});

		it('should handle empty command strings', () => {
			configurationService.setConfig(ConfigKey.TerminalAllowList, {
				"echo": true
			});
			const commandLineAutoApprover = instantiationService.createInstance(CommandLineAutoApprover);

			ok(!commandLineAutoApprover.isAutoApproved(''));
			ok(!commandLineAutoApprover.isAutoApproved('   '));
		});

		it('should handle whitespace in commands', () => {
			configurationService.setConfig(ConfigKey.TerminalAllowList, {
				"echo": true
			});
			const commandLineAutoApprover = instantiationService.createInstance(CommandLineAutoApprover);

			ok(commandLineAutoApprover.isAutoApproved('echo   hello   world'));
			ok(!commandLineAutoApprover.isAutoApproved('  echo hello'));
		});

		it('should be case-sensitive by default', () => {
			configurationService.setConfig(ConfigKey.TerminalAllowList, {
				"echo": true
			});
			const commandLineAutoApprover = instantiationService.createInstance(CommandLineAutoApprover);

			ok(commandLineAutoApprover.isAutoApproved('echo hello'));
			ok(!commandLineAutoApprover.isAutoApproved('ECHO hello'));
			ok(!commandLineAutoApprover.isAutoApproved('Echo hello'));
		});

		// https://github.com/microsoft/vscode/issues/252411
		it('should handle string-based values with special regex characters', () => {
			configurationService.setConfig(ConfigKey.TerminalAllowList, {
				"pwsh.exe -File D:\\foo.bar\\a-script.ps1": true
			});
			const commandLineAutoApprover = instantiationService.createInstance(CommandLineAutoApprover);

			ok(commandLineAutoApprover.isAutoApproved('pwsh.exe -File D:\\foo.bar\\a-script.ps1'));
			ok(commandLineAutoApprover.isAutoApproved('pwsh.exe -File D:\\foo.bar\\a-script.ps1 -AnotherArg'));
		});
	});

	describe('PowerShell-specific commands', () => {
		beforeEach(() => {
			vi.spyOn(envService, 'shell', 'get').mockReturnValue('pwsh');
		});

		it('should handle Windows PowerShell commands', () => {
			configurationService.setConfig(ConfigKey.TerminalAllowList, {
				"Get-ChildItem": true,
				"Get-Content": true,
				"Get-Location": true
			});
			configurationService.setConfig(ConfigKey.TerminalDenyList, {
				"Remove-Item": true,
				"del": true
			});
			const commandLineAutoApprover = instantiationService.createInstance(CommandLineAutoApprover);

			ok(commandLineAutoApprover.isAutoApproved('Get-ChildItem'));
			ok(commandLineAutoApprover.isAutoApproved('Get-Content file.txt'));
			ok(commandLineAutoApprover.isAutoApproved('Get-Location'));
			ok(!commandLineAutoApprover.isAutoApproved('Remove-Item file.txt'));
		});

		it('should handle ( prefixes', () => {
			configurationService.setConfig(ConfigKey.TerminalAllowList, {
				"Get-Content": true
			});
			const commandLineAutoApprover = instantiationService.createInstance(CommandLineAutoApprover);

			ok(commandLineAutoApprover.isAutoApproved('Get-Content file.txt'));
			ok(commandLineAutoApprover.isAutoApproved('(Get-Content file.txt'));
			ok(!commandLineAutoApprover.isAutoApproved('[Get-Content'));
			ok(!commandLineAutoApprover.isAutoApproved('foo'));
		});
	});
});

describe('splitCommandLineIntoSubCommands', () => {
	it('should split command line into subcommands', () => {
		const commandLine = 'echo "Hello World" && ls -la || pwd';
		const expectedSubCommands = ['echo "Hello World"', 'ls -la', 'pwd'];
		const actualSubCommands = splitCommandLineIntoSubCommands(commandLine, 'zsh', OperatingSystem.Linux);
		deepStrictEqual(actualSubCommands, expectedSubCommands);
	});

	describe('bash/sh shell', () => {
		it('should split on logical operators', () => {
			const commandLine = 'echo test && ls -la || pwd';
			const expectedSubCommands = ['echo test', 'ls -la', 'pwd'];
			const actualSubCommands = splitCommandLineIntoSubCommands(commandLine, 'bash', OperatingSystem.Linux);
			deepStrictEqual(actualSubCommands, expectedSubCommands);
		});

		it('should split on pipes', () => {
			const commandLine = 'ls -la | grep test | wc -l';
			const expectedSubCommands = ['ls -la', 'grep test', 'wc -l'];
			const actualSubCommands = splitCommandLineIntoSubCommands(commandLine, 'sh', OperatingSystem.Linux);
			deepStrictEqual(actualSubCommands, expectedSubCommands);
		});

		it('should split on semicolons', () => {
			const commandLine = 'cd /tmp; ls -la; pwd';
			const expectedSubCommands = ['cd /tmp', 'ls -la', 'pwd'];
			const actualSubCommands = splitCommandLineIntoSubCommands(commandLine, 'sh', OperatingSystem.Linux);
			deepStrictEqual(actualSubCommands, expectedSubCommands);
		});

		it('should split on background operator', () => {
			const commandLine = 'sleep 5 & echo done';
			const expectedSubCommands = ['sleep 5', 'echo done'];
			const actualSubCommands = splitCommandLineIntoSubCommands(commandLine, 'sh', OperatingSystem.Linux);
			deepStrictEqual(actualSubCommands, expectedSubCommands);
		});

		it('should split on redirection operators', () => {
			const commandLine = 'echo test > output.txt && cat output.txt';
			const expectedSubCommands = ['echo test', 'output.txt', 'cat output.txt'];
			const actualSubCommands = splitCommandLineIntoSubCommands(commandLine, 'sh', OperatingSystem.Linux);
			deepStrictEqual(actualSubCommands, expectedSubCommands);
		});

		it('should split on stderr redirection', () => {
			const commandLine = 'command 2> error.log && echo success';
			const expectedSubCommands = ['command', 'error.log', 'echo success'];
			const actualSubCommands = splitCommandLineIntoSubCommands(commandLine, 'sh', OperatingSystem.Linux);
			deepStrictEqual(actualSubCommands, expectedSubCommands);
		});

		it('should split on append redirection', () => {
			const commandLine = 'echo line1 >> file.txt && echo line2 >> file.txt';
			const expectedSubCommands = ['echo line1', 'file.txt', 'echo line2', 'file.txt'];
			const actualSubCommands = splitCommandLineIntoSubCommands(commandLine, 'sh', OperatingSystem.Linux);
			deepStrictEqual(actualSubCommands, expectedSubCommands);
		});
	});

	describe('zsh shell', () => {
		it('should split on zsh-specific operators', () => {
			const commandLine = 'echo test <<< "input" && ls';
			const expectedSubCommands = ['echo test', '"input"', 'ls'];
			const actualSubCommands = splitCommandLineIntoSubCommands(commandLine, 'zsh', OperatingSystem.Linux);
			deepStrictEqual(actualSubCommands, expectedSubCommands);
		});

		it('should split on process substitution', () => {
			const commandLine = 'diff <(ls dir1) <(ls dir2)';
			const expectedSubCommands = ['diff', 'ls dir1)', 'ls dir2)'];
			const actualSubCommands = splitCommandLineIntoSubCommands(commandLine, 'zsh', OperatingSystem.Linux);
			deepStrictEqual(actualSubCommands, expectedSubCommands);
		});

		it('should split on bidirectional redirection', () => {
			const commandLine = 'command <> file.txt && echo done';
			const expectedSubCommands = ['command', 'file.txt', 'echo done'];
			const actualSubCommands = splitCommandLineIntoSubCommands(commandLine, 'zsh', OperatingSystem.Linux);
			deepStrictEqual(actualSubCommands, expectedSubCommands);
		});

		it('should handle complex zsh command chains', () => {
			const commandLine = 'ls | grep test && echo found || echo not found';
			const expectedSubCommands = ['ls', 'grep test', 'echo found', 'echo not found'];
			const actualSubCommands = splitCommandLineIntoSubCommands(commandLine, 'zsh', OperatingSystem.Linux);
			deepStrictEqual(actualSubCommands, expectedSubCommands);
		});
	});

	describe('PowerShell', () => {
		it('should not split on PowerShell logical operators', () => {
			const commandLine = 'Get-ChildItem -and Get-Location -or Write-Host "test"';
			const expectedSubCommands = ['Get-ChildItem -and Get-Location -or Write-Host "test"'];
			const actualSubCommands = splitCommandLineIntoSubCommands(commandLine, 'powershell', OperatingSystem.Linux);
			deepStrictEqual(actualSubCommands, expectedSubCommands);
		});

		it('should split on PowerShell pipes', () => {
			const commandLine = 'Get-Process | Where-Object Name -eq "notepad" | Stop-Process';
			const expectedSubCommands = ['Get-Process', 'Where-Object Name -eq "notepad"', 'Stop-Process'];
			const actualSubCommands = splitCommandLineIntoSubCommands(commandLine, 'powershell.exe', OperatingSystem.Windows);
			deepStrictEqual(actualSubCommands, expectedSubCommands);
		});

		it('should split on PowerShell redirection', () => {
			const commandLine = 'Get-Process > processes.txt && Get-Content processes.txt';
			const expectedSubCommands = ['Get-Process', 'processes.txt', 'Get-Content processes.txt'];
			const actualSubCommands = splitCommandLineIntoSubCommands(commandLine, 'pwsh.exe', OperatingSystem.Windows);
			deepStrictEqual(actualSubCommands, expectedSubCommands);
		});
	});

	describe('edge cases', () => {
		it('should return single command when no operators present', () => {
			const commandLine = 'echo "hello world"';
			const expectedSubCommands = ['echo "hello world"'];
			const actualSubCommands = splitCommandLineIntoSubCommands(commandLine, 'bash', OperatingSystem.Linux);
			deepStrictEqual(actualSubCommands, expectedSubCommands);
		});

		it('should handle empty command', () => {
			const commandLine = '';
			const expectedSubCommands = [''];
			const actualSubCommands = splitCommandLineIntoSubCommands(commandLine, 'zsh', OperatingSystem.Linux);
			deepStrictEqual(actualSubCommands, expectedSubCommands);
		});

		it('should trim whitespace from subcommands', () => {
			const commandLine = 'echo test   &&   ls -la   ||   pwd';
			const expectedSubCommands = ['echo test', 'ls -la', 'pwd'];
			const actualSubCommands = splitCommandLineIntoSubCommands(commandLine, 'sh', OperatingSystem.Linux);
			deepStrictEqual(actualSubCommands, expectedSubCommands);
		});

		it('should handle multiple consecutive operators', () => {
			const commandLine = 'echo test && && ls';
			const expectedSubCommands = ['echo test', '', 'ls'];
			const actualSubCommands = splitCommandLineIntoSubCommands(commandLine, 'bash', OperatingSystem.Linux);
			deepStrictEqual(actualSubCommands, expectedSubCommands);
		});

		it('should handle unknown shell as sh', () => {
			const commandLine = 'echo test && ls -la';
			const expectedSubCommands = ['echo test', 'ls -la'];
			const actualSubCommands = splitCommandLineIntoSubCommands(commandLine, 'unknown-shell', OperatingSystem.Linux);
			deepStrictEqual(actualSubCommands, expectedSubCommands);
		});
	});

	describe('shell type detection', () => {
		it('should detect PowerShell variants', () => {
			const commandLine = 'Get-Process ; Get-Location';
			const expectedSubCommands = ['Get-Process', 'Get-Location'];

			deepStrictEqual(splitCommandLineIntoSubCommands(commandLine, 'powershell', OperatingSystem.Linux), expectedSubCommands);
			deepStrictEqual(splitCommandLineIntoSubCommands(commandLine, 'powershell.exe', OperatingSystem.Windows), expectedSubCommands);
			deepStrictEqual(splitCommandLineIntoSubCommands(commandLine, 'pwsh', OperatingSystem.Linux), expectedSubCommands);
			deepStrictEqual(splitCommandLineIntoSubCommands(commandLine, 'pwsh.exe', OperatingSystem.Windows), expectedSubCommands);
			deepStrictEqual(splitCommandLineIntoSubCommands(commandLine, 'powershell-preview', OperatingSystem.Linux), expectedSubCommands);
		});

		it('should detect zsh specifically', () => {
			const commandLine = 'echo test <<< input';
			const expectedSubCommands = ['echo test', 'input'];
			const actualSubCommands = splitCommandLineIntoSubCommands(commandLine, 'zsh', OperatingSystem.Linux);
			deepStrictEqual(actualSubCommands, expectedSubCommands);
		});

		it('should default to sh for other shells', () => {
			const commandLine = 'echo test && ls';
			const expectedSubCommands = ['echo test', 'ls'];

			deepStrictEqual(splitCommandLineIntoSubCommands(commandLine, 'bash', OperatingSystem.Linux), expectedSubCommands);
			deepStrictEqual(splitCommandLineIntoSubCommands(commandLine, 'dash', OperatingSystem.Linux), expectedSubCommands);
			deepStrictEqual(splitCommandLineIntoSubCommands(commandLine, 'fish', OperatingSystem.Linux), expectedSubCommands);
		});
	});

	describe('complex command combinations', () => {
		it('should handle mixed operators in order', () => {
			const commandLine = 'ls | grep test && echo found > result.txt || echo failed';
			const expectedSubCommands = ['ls', 'grep test', 'echo found', 'result.txt', 'echo failed'];
			const actualSubCommands = splitCommandLineIntoSubCommands(commandLine, 'bash', OperatingSystem.Linux);
			deepStrictEqual(actualSubCommands, expectedSubCommands);
		});

		it.skip('should handle subshells and braces', () => {
			const commandLine = '(cd /tmp && ls) && { echo done; }';
			const expectedSubCommands = ['(cd /tmp', 'ls)', '{ echo done', '}'];
			const actualSubCommands = splitCommandLineIntoSubCommands(commandLine, 'zsh', OperatingSystem.Linux);
			deepStrictEqual(actualSubCommands, expectedSubCommands);
		});

		it('should handle here documents', () => {
			const commandLine = 'cat << EOF && echo done';
			const expectedSubCommands = ['cat', 'EOF', 'echo done'];
			const actualSubCommands = splitCommandLineIntoSubCommands(commandLine, 'sh', OperatingSystem.Linux);
			deepStrictEqual(actualSubCommands, expectedSubCommands);
		});
	});
});

describe('extractInlineSubCommands', () => {
	function assertSubCommandsUnordered(result: Set<string>, expectedSubCommands: string[]) {
		deepStrictEqual(Array.from(result).sort(), expectedSubCommands.sort());
	}

	describe('POSIX shells (bash, zsh, sh)', () => {
		it('should extract command substitution with $()', () => {
			const commandLine = 'echo "Current date: $(date)"';
			const result = extractInlineSubCommands(commandLine, '/bin/bash', OperatingSystem.Linux);
			assertSubCommandsUnordered(result, ['date']);
		});

		it('should extract command substitution with backticks', () => {
			const commandLine = 'echo "Current date: `date`"';
			const result = extractInlineSubCommands(commandLine, '/bin/bash', OperatingSystem.Linux);
			assertSubCommandsUnordered(result, ['date']);
		});

		it('should extract process substitution with <()', () => {
			const commandLine = 'diff <(cat file1.txt) <(cat file2.txt)';
			const result = extractInlineSubCommands(commandLine, '/bin/bash', OperatingSystem.Linux);
			assertSubCommandsUnordered(result, ['cat file1.txt', 'cat file2.txt']);
		});

		it('should extract process substitution with >()', () => {
			const commandLine = 'tee >(wc -l) >(grep pattern) < input.txt';
			const result = extractInlineSubCommands(commandLine, '/bin/bash', OperatingSystem.Linux);
			assertSubCommandsUnordered(result, ['wc -l', 'grep pattern']);
		});

		it('should extract multiple inline commands', () => {
			const commandLine = 'echo "Today is $(date) and user is $(whoami)"';
			const result = extractInlineSubCommands(commandLine, '/bin/bash', OperatingSystem.Linux);
			assertSubCommandsUnordered(result, ['date', 'whoami']);
		});

		it('should extract nested inline commands', () => {
			const commandLine = 'echo "$(echo "Inner: $(date)")"';
			const result = extractInlineSubCommands(commandLine, '/bin/bash', OperatingSystem.Linux);
			assertSubCommandsUnordered(result, ['echo "Inner: $(date)"', 'date']);
		});

		it('should handle mixed substitution types', () => {
			const commandLine = 'echo "Date: $(date)" && cat `which ls` | grep <(echo pattern)';
			const result = extractInlineSubCommands(commandLine, '/bin/bash', OperatingSystem.Linux);
			assertSubCommandsUnordered(result, ['date', 'which ls', 'echo pattern']);
		});

		it('should handle empty substitutions', () => {
			const commandLine = 'echo $() test ``';
			const result = extractInlineSubCommands(commandLine, '/bin/bash', OperatingSystem.Linux);
			assertSubCommandsUnordered(result, []);
		});

		it('should handle commands with whitespace', () => {
			const commandLine = 'echo "$( ls -la | grep test )"';
			const result = extractInlineSubCommands(commandLine, '/bin/bash', OperatingSystem.Linux);
			assertSubCommandsUnordered(result, ['ls -la | grep test']);
		});
	});

	describe('PowerShell (pwsh)', () => {
		it('should extract command substitution with $()', () => {
			const commandLine = 'Write-Host "Current date: $(Get-Date)"';
			const result = extractInlineSubCommands(commandLine, 'powershell.exe', OperatingSystem.Windows);
			assertSubCommandsUnordered(result, ['Get-Date']);
		});

		it('should extract array subexpression with @()', () => {
			const commandLine = 'Write-Host @(Get-ChildItem | Where-Object {$_.Name -like "*.txt"})';
			const result = extractInlineSubCommands(commandLine, 'pwsh.exe', OperatingSystem.Windows);
			assertSubCommandsUnordered(result, ['Get-ChildItem | Where-Object {$_.Name -like "*.txt"}']);
		});

		it('should extract call operator with &()', () => {
			const commandLine = 'Write-Host &(Get-Command git)';
			const result = extractInlineSubCommands(commandLine, 'powershell.exe', OperatingSystem.Windows);
			assertSubCommandsUnordered(result, ['Get-Command git']);
		});

		it('should extract multiple PowerShell substitutions', () => {
			const commandLine = 'Write-Host "User: $(whoami) and date: $(Get-Date)"';
			const result = extractInlineSubCommands(commandLine, 'pwsh.exe', OperatingSystem.Windows);
			assertSubCommandsUnordered(result, ['whoami', 'Get-Date']);
		});

		it('should extract nested PowerShell commands', () => {
			const commandLine = 'Write-Host "$(Write-Host "Inner: $(Get-Date)")"';
			const result = extractInlineSubCommands(commandLine, 'powershell.exe', OperatingSystem.Windows);
			assertSubCommandsUnordered(result, ['Write-Host "Inner: $(Get-Date)"', 'Get-Date']);
		});

		it('should handle mixed PowerShell substitution types', () => {
			const commandLine = 'Write-Host "$(Get-Date)" @(Get-ChildItem) &(Get-Command ls)';
			const result = extractInlineSubCommands(commandLine, 'pwsh.exe', OperatingSystem.Windows);
			assertSubCommandsUnordered(result, ['Get-Date', 'Get-ChildItem', 'Get-Command ls']);
		});

		it('should handle PowerShell commands with complex expressions', () => {
			const commandLine = 'Write-Host "$((Get-ChildItem).Count)"';
			const result = extractInlineSubCommands(commandLine, 'powershell.exe', OperatingSystem.Windows);
			assertSubCommandsUnordered(result, ['(Get-ChildItem).Count']);
		});

		it('should handle empty PowerShell substitutions', () => {
			const commandLine = 'Write-Host $() @() &()';
			const result = extractInlineSubCommands(commandLine, 'pwsh', OperatingSystem.Linux);
			assertSubCommandsUnordered(result, []);
		});
	});

	describe('Shell detection', () => {
		it('should detect PowerShell from various shell paths', () => {
			const commandLine = 'Write-Host "$(Get-Date)"';

			const powershellShells = [
				'powershell.exe',
				'pwsh.exe',
				'powershell',
				'pwsh',
				'powershell-preview',
				'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe',
				'/usr/bin/pwsh'
			];

			for (const shell of powershellShells) {
				const result = extractInlineSubCommands(commandLine, shell, commandLine.match(/\.exe/) ? OperatingSystem.Windows : OperatingSystem.Linux);
				assertSubCommandsUnordered(result, ['Get-Date']);
			}
		});

		it('should treat non-PowerShell shells as POSIX', () => {
			const commandLine = 'echo "$(date)"';

			const posixShells = [
				'/bin/bash',
				'/bin/sh',
				'/bin/zsh',
				'/usr/bin/fish',
				'bash',
				'sh',
				'zsh'
			];

			for (const shell of posixShells) {
				const result = extractInlineSubCommands(commandLine, shell, OperatingSystem.Linux);
				assertSubCommandsUnordered(result, ['date']);
			}
		});
	});

	describe('Edge cases', () => {
		it('should handle commands with no inline substitutions', () => {
			const result1 = extractInlineSubCommands('echo hello world', '/bin/bash', OperatingSystem.Linux);
			deepStrictEqual(Array.from(result1), []);

			const result2 = extractInlineSubCommands('Write-Host "hello world"', 'pwsh', OperatingSystem.Linux);
			deepStrictEqual(Array.from(result2), []);
		});

		it('should handle malformed substitutions gracefully', () => {
			const commandLine = 'echo $( incomplete';
			const result = extractInlineSubCommands(commandLine, '/bin/bash', OperatingSystem.Linux);
			assertSubCommandsUnordered(result, []);
		});

		it('should handle escaped substitutions (should still extract)', () => {
			// Note: This implementation doesn't handle escaping - that would be a future enhancement
			const commandLine = 'echo \\$(date)';
			const result = extractInlineSubCommands(commandLine, '/bin/bash', OperatingSystem.Linux);
			assertSubCommandsUnordered(result, ['date']);
		});

		it('should handle empty command line', () => {
			const result = extractInlineSubCommands('', '/bin/bash', OperatingSystem.Linux);
			assertSubCommandsUnordered(result, []);
		});

		it('should handle whitespace-only command line', () => {
			const result = extractInlineSubCommands('   \t  \n  ', '/bin/bash', OperatingSystem.Linux);
			assertSubCommandsUnordered(result, []);
		});
	});
});

describe('isPowerShell', () => {
	describe('PowerShell executables', () => {
		it('should detect powershell.exe', () => {
			ok(isPowerShell('powershell.exe', OperatingSystem.Windows));
			ok(isPowerShell('powershell', OperatingSystem.Linux));
		});

		it('should detect pwsh.exe', () => {
			ok(isPowerShell('pwsh.exe', OperatingSystem.Windows));
			ok(isPowerShell('pwsh', OperatingSystem.Linux));
		});

		it('should detect powershell-preview', () => {
			ok(isPowerShell('powershell-preview.exe', OperatingSystem.Windows));
			ok(isPowerShell('powershell-preview', OperatingSystem.Linux));
		});

		it('should detect pwsh-preview', () => {
			ok(isPowerShell('pwsh-preview.exe', OperatingSystem.Windows));
			ok(isPowerShell('pwsh-preview', OperatingSystem.Linux));
		});
	});

	describe('PowerShell with full paths', () => {
		it('should detect Windows PowerShell with full path', () => {
			ok(isPowerShell('C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe', OperatingSystem.Windows));
		});

		it('should detect PowerShell Core with full path', () => {
			ok(isPowerShell('C:\\Program Files\\PowerShell\\7\\pwsh.exe', OperatingSystem.Windows));
		});

		it('should detect PowerShell on Linux/macOS with full path', () => {
			ok(isPowerShell('/usr/bin/pwsh', OperatingSystem.Linux));
		});

		it('should detect PowerShell preview with full path', () => {
			ok(isPowerShell('/opt/microsoft/powershell/7-preview/pwsh-preview', OperatingSystem.Linux));
		});

		it('should detect nested path with powershell', () => {
			ok(isPowerShell('/some/deep/path/to/powershell.exe', OperatingSystem.Windows));
		});
	});

	describe('Case sensitivity', () => {
		it('should detect PowerShell regardless of case', () => {
			ok(isPowerShell('PowerShell.exe', OperatingSystem.Windows));
			ok(isPowerShell('POWERSHELL.EXE', OperatingSystem.Windows));
			ok(isPowerShell('Pwsh.exe', OperatingSystem.Windows));
		});
	});

	describe('Non-PowerShell shells', () => {
		it('should not detect bash', () => {
			ok(!isPowerShell('bash', OperatingSystem.Linux));
		});

		it('should not detect zsh', () => {
			ok(!isPowerShell('zsh', OperatingSystem.Linux));
		});

		it('should not detect sh', () => {
			ok(!isPowerShell('sh', OperatingSystem.Linux));
		});

		it('should not detect fish', () => {
			ok(!isPowerShell('fish', OperatingSystem.Linux));
		});

		it('should not detect cmd.exe', () => {
			ok(!isPowerShell('cmd.exe', OperatingSystem.Windows));
		});

		it('should not detect command.com', () => {
			ok(!isPowerShell('command.com', OperatingSystem.Windows));
		});

		it('should not detect dash', () => {
			ok(!isPowerShell('dash', OperatingSystem.Linux));
		});

		it('should not detect tcsh', () => {
			ok(!isPowerShell('tcsh', OperatingSystem.Linux));
		});

		it('should not detect csh', () => {
			ok(!isPowerShell('csh', OperatingSystem.Linux));
		});
	});

	describe('Non-PowerShell shells with full paths', () => {
		it('should not detect bash with full path', () => {
			ok(!isPowerShell('/bin/bash', OperatingSystem.Linux));
		});

		it('should not detect zsh with full path', () => {
			ok(!isPowerShell('/usr/bin/zsh', OperatingSystem.Linux));
		});

		it('should not detect cmd.exe with full path', () => {
			ok(!isPowerShell('C:\\Windows\\System32\\cmd.exe', OperatingSystem.Windows));
		});

		it('should not detect git bash', () => {
			ok(!isPowerShell('C:\\Program Files\\Git\\bin\\bash.exe', OperatingSystem.Windows));
		});
	});

	describe('Edge cases', () => {
		it('should handle empty string', () => {
			ok(!isPowerShell('', OperatingSystem.Windows));
		});

		it('should handle paths with spaces', () => {
			ok(isPowerShell('C:\\Program Files\\PowerShell\\7\\pwsh.exe', OperatingSystem.Windows));
			ok(!isPowerShell('C:\\Program Files\\Git\\bin\\bash.exe', OperatingSystem.Windows));
		});

		it('should not match partial strings', () => {
			ok(!isPowerShell('notpowershell', OperatingSystem.Linux));
			ok(!isPowerShell('powershellish', OperatingSystem.Linux));
			ok(!isPowerShell('mypwsh', OperatingSystem.Linux));
			ok(!isPowerShell('pwshell', OperatingSystem.Linux));
		});

		it('should handle strings containing powershell but not as basename', () => {
			ok(!isPowerShell('/powershell/bin/bash', OperatingSystem.Linux));
			ok(!isPowerShell('/usr/pwsh/bin/zsh', OperatingSystem.Linux));
			ok(!isPowerShell('C:\\powershell\\cmd.exe', OperatingSystem.Windows));
		});

		it('should handle special characters in path', () => {
			ok(isPowerShell('/path/with-dashes/pwsh.exe', OperatingSystem.Windows));
			ok(isPowerShell('/path/with_underscores/powershell', OperatingSystem.Linux));
			ok(isPowerShell('C:\\path\\with spaces\\pwsh.exe', OperatingSystem.Windows));
		});

		it('should handle relative paths', () => {
			ok(isPowerShell('./powershell.exe', OperatingSystem.Windows));
			ok(isPowerShell('../bin/pwsh', OperatingSystem.Linux));
			ok(isPowerShell('bin/powershell', OperatingSystem.Linux));
		});

		it('should not match similar named tools', () => {
			ok(!isPowerShell('powertool', OperatingSystem.Linux));
			ok(!isPowerShell('shell', OperatingSystem.Linux));
			ok(!isPowerShell('power', OperatingSystem.Linux));
			ok(!isPowerShell('pwshconfig', OperatingSystem.Linux));
		});
	});
});