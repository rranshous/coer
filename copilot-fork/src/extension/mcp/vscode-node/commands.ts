/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
import * as vscode from 'vscode';
import { ChatFetchResponseType } from '../../../platform/chat/common/commonTypes';
import { JsonSchema } from '../../../platform/configuration/common/jsonSchema';
import { ITelemetryService } from '../../../platform/telemetry/common/telemetry';
import { extractCodeBlocks } from '../../../util/common/markdown';
import { mapFindFirst } from '../../../util/vs/base/common/arraysFind';
import { DeferredPromise, raceCancellation } from '../../../util/vs/base/common/async';
import { CancellationTokenSource } from '../../../util/vs/base/common/cancellation';
import { Disposable, toDisposable } from '../../../util/vs/base/common/lifecycle';
import { cloneAndChange } from '../../../util/vs/base/common/objects';
import { generateUuid } from '../../../util/vs/base/common/uuid';
import { IInstantiationService } from '../../../util/vs/platform/instantiation/common/instantiation';
import { ChatLocation as VsCodeChatLocation } from '../../../vscodeTypes';
import { Conversation, Turn } from '../../prompt/common/conversation';
import { McpToolCallingLoop } from './mcpToolCallingLoop';
import { McpPickRef } from './mcpToolCallingTools';

type PackageType = 'npm' | 'pip' | 'docker';

interface IValidatePackageArgs {
	type: PackageType;
	name: string;
	targetConfig: JsonSchema;
}

interface PromptStringInputInfo {
	id: string;
	type: 'promptString';
	description: string;
	default?: string;
	password?: boolean;
}

type ValidatePackageResult = { state: 'ok'; publisher: string; version?: string } | { state: 'error'; error: string };

interface NpmPackageResponse {
	maintainers?: Array<{ name: string }>;
	readme?: string;
	'dist-tags'?: { latest?: string };
}

interface PyPiPackageResponse {
	info?: {
		author?: string;
		author_email?: string;
		description?: string;
		version?: string;
	};
}

interface DockerHubResponse {
	user?: string;
	name?: string;
	namespace?: string;
	description?: string;
	full_description?: string;
}

export class McpSetupCommands extends Disposable {
	private pendingSetup?: {
		cts: CancellationTokenSource;
		name: string;
		canPrompt: DeferredPromise<void>;
		done: Promise<unknown>;
	};

	constructor(
		@ITelemetryService readonly telemetryService: ITelemetryService,
		@IInstantiationService readonly instantiationService: IInstantiationService,
	) {
		super();
		this._register(toDisposable(() => this.pendingSetup?.cts.dispose(true)));
		this._register(vscode.commands.registerCommand('github.copilot.chat.mcp.setup.flow', (args: { name: string }) => {
			if (this.pendingSetup?.name !== args.name) {
				return undefined;
			}

			this.pendingSetup.canPrompt.complete(undefined);
			return this.pendingSetup.done;
		}));
		this._register(vscode.commands.registerCommand('github.copilot.chat.mcp.setup.validatePackage', async (args: IValidatePackageArgs): Promise<ValidatePackageResult> => {
			return this.validatePackageRegistry(args);
		}));
		this._register(vscode.commands.registerCommand('github.copilot.chat.mcp.setup.check', () => {
			return 1;
		}));
	}

	private async enqueuePendingSetup(targetSchema: JsonSchema, packageName: string, packageType: PackageType, packageReadme: string | undefined, packageVersion: string | undefined) {
		const cts = new CancellationTokenSource();
		const canPrompt = new DeferredPromise<void>();
		const pickRef = new McpPickRef(raceCancellation(canPrompt.p, cts.token));

		// we start doing the prompt in the background so the first call is speedy
		const done = (async () => {
			const fakePrompt = `Generate an MCP configuration for ${packageName}`;
			const mcpLoop = this.instantiationService.createInstance(McpToolCallingLoop, {
				toolCallLimit: 5,
				conversation: new Conversation(generateUuid(), [new Turn(undefined, { type: 'user', message: fakePrompt })]),
				request: {
					attempt: 0,
					enableCommandDetection: false,
					isParticipantDetected: false,
					location: VsCodeChatLocation.Panel,
					command: undefined,
					location2: undefined,
					// note: this is not used, model is hardcoded in the McpToolCallingLoop
					model: (await vscode.lm.selectChatModels())[0],
					prompt: fakePrompt,
					references: [],
					toolInvocationToken: generateUuid() as never,
					toolReferences: [],
					tools: new Map(),
					id: '1'
				},
				props: {
					targetSchema,
					packageName,
					packageVersion,
					packageType,
					pickRef,
					packageReadme: packageReadme || '<empty>',
				},
			});

			const toolCallLoopResult = await mcpLoop.run(undefined, cts.token);
			if (toolCallLoopResult.response.type !== ChatFetchResponseType.Success) {
				vscode.window.showErrorMessage(`Failed to generate MCP configuration for ${packageName}: ${toolCallLoopResult.response.reason}`);
				return undefined;
			}

			const { name, ...server } = mapFindFirst(extractCodeBlocks(toolCallLoopResult.response.value), block => {
				try {
					const j = JSON.parse(block.code);

					// Unwrap if the model returns `mcpServers` in a wrapper object
					if (j && typeof j === 'object' && j.hasOwnProperty('mcpServers')) {
						const [name, obj] = Object.entries(j.mcpServers)[0] as [string, object];
						return { ...obj, name };
					}

					return j;
				} catch {
					return undefined;
				}
			});

			const inputs: PromptStringInputInfo[] = [];
			let inputValues: Record<string, string> | undefined;
			const extracted = cloneAndChange(server, value => {
				if (typeof value === 'string') {
					const fromInput = pickRef.picks.find(p => p.choice === value);
					if (fromInput) {
						inputs.push({ id: fromInput.id, type: 'promptString', description: fromInput.title });
						inputValues ??= {};
						const replacement = '${input:' + fromInput.id + '}';
						inputValues[replacement] = value;
						return replacement;
					}
				}
			});

			return { name, server: extracted, inputs, inputValues };
		})().finally(() => {
			cts.dispose();
			pickRef.dispose();
		});

		this.pendingSetup?.cts.dispose(true);
		this.pendingSetup = { cts, name: packageName, canPrompt, done };
	}

	private async validatePackageRegistry(args: IValidatePackageArgs): Promise<ValidatePackageResult> {
		try {
			if (args.type === 'npm') {
				const response = await fetch(`https://registry.npmjs.org/${encodeURIComponent(args.name)}`);
				if (!response.ok) {
					return { state: 'error', error: `Package ${args.name} not found in npm registry` };
				}
				const data = await response.json() as NpmPackageResponse;
				const version = data['dist-tags']?.latest;
				this.enqueuePendingSetup(args.targetConfig, args.name, args.type, data.readme, version);
				return { state: 'ok', publisher: data.maintainers?.[0]?.name || 'unknown', version };
			} else if (args.type === 'pip') {
				const response = await fetch(`https://pypi.org/pypi/${encodeURIComponent(args.name)}/json`);
				if (!response.ok) {
					return { state: 'error', error: `Package ${args.name} not found in PyPI registry` };
				}
				const data = await response.json() as PyPiPackageResponse;
				const version = data.info?.version;
				this.enqueuePendingSetup(args.targetConfig, args.name, args.type, data.info?.description, version);
				return { state: 'ok', publisher: data.info?.author || data.info?.author_email || 'unknown', version };
			} else if (args.type === 'docker') {
				// Docker Hub API uses namespace/repository format
				// Handle both formats: 'namespace/repository' or just 'repository' (assumes 'library/' namespace)
				const [namespace, repository] = args.name.includes('/')
					? args.name.split('/', 2)
					: ['library', args.name];

				const response = await fetch(`https://hub.docker.com/v2/repositories/${encodeURIComponent(namespace)}/${encodeURIComponent(repository)}`);
				if (!response.ok) {
					return { state: 'error', error: `Docker image ${args.name} not found in Docker Hub registry` };
				}
				const data = await response.json() as DockerHubResponse;
				this.enqueuePendingSetup(args.targetConfig, args.name, args.type, data.full_description || data.description, undefined);
				return { state: 'ok', publisher: data.namespace || data.user || 'unknown' };
			}
			return { state: 'error', error: `Unsupported package type: ${args.type}` };
		} catch (error) {
			return { state: 'error', error: `Error querying package: ${(error as Error).message}` };
		}
	}
}
